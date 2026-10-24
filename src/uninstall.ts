// src/uninstall.ts
/**
 * `gabion uninstall` — remove the machine-global Gabion runtime from ~/.gabion/.
 *
 * Lives in the thin CLI because the uninstall command must not depend on the
 * artifact it removes. A broken runtime (corrupted node_modules, missing tsx)
 * must not prevent its own removal.
 *
 * Strategy: remove everything inside ~/.gabion/ EXCEPT what is not the
 * installation (constants.ts, UNINSTALL_PRESERVED_ENTRIES). This is more
 * robust than maintaining a whitelist of paths — any future artifacts
 * (caches, logs, stamps) are cleaned automatically. When nothing survives,
 * the home directory itself is removed too — an empty ~/.gabion would be
 * the last trace of the installation.
 *
 * Preserved: auth.json (use `gabion auth --remove` to remove separately);
 * inside a WSL distribution set up from Windows, the copy of this CLI and
 * the Node.js the Windows installer brought for the developer — the
 * counterparts of the npm-installed CLI and the developer's own Node,
 * which this command never touched on Linux either.
 * Never touched: per-project files under user's workspace.
 */

import { spawnSync } from "child_process";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "fs";
import { homedir } from "os";
import { createInterface } from "readline";
import { join } from "path";
import {
  GABION_HOME,
  INSTANCES_JSON_PATH,
  UNINSTALL_PRESERVED_ENTRIES,
  WSL_NODEJS_DIR_NAME,
  WSL_THIN_CLI_DIR_NAME,
} from "./constants.js";
import { isWslCopy } from "./package-location.js";
import type { RegistryInstanceEntry } from "./types.js";

export const UNINSTALL_USAGE =
  "Usage: gabion uninstall [--force]\n\n" +
  "Removes the Gabion runtime from this machine: everything under ~/.gabion except\n" +
  "the access token (gabion auth --remove removes it) and, inside a WSL distribution\n" +
  "set up from Windows, the CLI copy and the Node.js it brought. Refuses while an\n" +
  "instance runs; --force skips the confirmation. Project files are not affected.";

/**
 * Gateway constants, duplicated from the runtime's port-layout on
 * purpose: the thin CLI must not depend on the artifact it removes
 * (same reasoning as GABION_HOME living in this package's constants).
 */
const GATEWAY_HTTP_PORT = 8099;

/**
 * Autostart identifiers, duplicated from the runtime's autostart module
 * on purpose: the thin CLI must not depend on the artifact it removes.
 */
const GATEWAY_UNIT_NAME = "gabion-gateway.service";
const LAUNCHD_LABEL = "dev.gabion.gateway";
const WINDOWS_RUN_VALUE_NAME = "GabionGateway";
const WINDOWS_RUN_KEY_PATH =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

/** macOS resolver hook file written by `gabion install` (sudo). */
const MACOS_RESOLVER_PATH = "/etc/resolver/gabion.localhost";

/**
 * Bound for probing a possibly-foreign socket. This is not a readiness
 * gate (nothing is being awaited to become ready) — it is a liveness
 * probe of a port that may be held by an unrelated hung process, and an
 * unbounded wait there would hang uninstall forever.
 */
const GATEWAY_PROBE_TIMEOUT_MS = 3_000;

/**
 * Stop a running gateway before the runtime it executes from is
 * removed. The gateway may legitimately be alive with zero instances
 * (machine-global, survives supervisors by design).
 *
 * The /health response shape is validated first so a foreign process
 * squatting on the port is never sent a shutdown request — mirrors the
 * validation ensure-running performs. Both loopback literals are probed:
 * the gateway binds 127.0.0.1 and ::1, and a foreign process holding
 * one literal says nothing about the other — the probe moves on to it.
 */
async function stopGatewayIfRunning(): Promise<void> {
  for (const host of ["127.0.0.1", "[::1]"]) {
    const base = `http://${host}:${String(GATEWAY_HTTP_PORT)}`;
    try {
      const healthRes = await fetch(`${base}/health`, {
        signal: AbortSignal.timeout(GATEWAY_PROBE_TIMEOUT_MS),
      });
      const body: unknown = await healthRes.json();
      const record =
        typeof body === "object" && body !== null
          ? (body as Record<string, unknown>)
          : null;
      const looksLikeGateway =
        record !== null &&
        record["status"] === "ready" &&
        typeof record["version"] === "string";
      if (!looksLikeGateway) {
        console.warn(
          `   ⚠️  ${host}:${String(GATEWAY_HTTP_PORT)} is held by a foreign process — not touching it`,
        );
        continue;
      }
      await fetch(`${base}/internal/shutdown`, {
        method: "POST",
        signal: AbortSignal.timeout(GATEWAY_PROBE_TIMEOUT_MS),
      });
      console.log("   Gateway stopped");
      return;
    } catch {
      // Connection refused or timed out on this literal — nothing of
      // ours is listening there; try the next literal.
    }
  }
}

/**
 * Remove the per-OS autostart installed by `gabion install`. Tool
 * failures are ignored deliberately: absence of the mechanism (no user
 * systemd, key never written) is an expected environment, not an error
 * channel — file artifacts are still removed when present.
 */
function removeGatewayAutostart(): void {
  if (process.platform === "linux") {
    // disable --now also stops a systemd-owned gateway; a detached one
    // was already stopped via /internal/shutdown above.
    spawnSync("systemctl", ["--user", "disable", "--now", GATEWAY_UNIT_NAME], {
      stdio: "ignore",
    });
    const unitPath = join(
      homedir(),
      ".config",
      "systemd",
      "user",
      GATEWAY_UNIT_NAME,
    );
    if (pathOrLinkExists(unitPath)) {
      rmSync(unitPath, { force: true });
      spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
      console.log("   Autostart unit removed");
    }
    return;
  }

  if (process.platform === "darwin") {
    const plistPath = join(
      homedir(),
      "Library",
      "LaunchAgents",
      `${LAUNCHD_LABEL}.plist`,
    );
    if (typeof process.getuid === "function") {
      spawnSync(
        "launchctl",
        ["bootout", `gui/${String(process.getuid())}/${LAUNCHD_LABEL}`],
        { stdio: "ignore" },
      );
    }
    if (pathOrLinkExists(plistPath)) {
      rmSync(plistPath, { force: true });
      console.log("   Autostart agent removed");
    }
    return;
  }

  if (process.platform === "win32") {
    // reg delete /f exits non-zero when the value does not exist, so
    // the exit status IS the fact "a key was actually removed" — the
    // message is tied to it, matching the linux/darwin branches which
    // only report when the artifact existed.
    const res = spawnSync(
      "reg",
      ["delete", WINDOWS_RUN_KEY_PATH, "/v", WINDOWS_RUN_VALUE_NAME, "/f"],
      { stdio: "ignore" },
    );
    // The VBS launcher lives inside ~/.gabion/bin — the blanket removal
    // below deletes it with the rest of the runtime.
    if (res.status === 0) {
      console.log("   Autostart Run key removed");
    }
  }
}

/**
 * Remove the macOS resolver hook. It was written with sudo, so its
 * removal needs sudo too; stdio is inherited so sudo can prompt. A
 * declined prompt degrades to a warning — a stale hook pointing at a
 * dead port is inert (the resolver falls through when nothing answers).
 */
function removeMacResolverHook(): void {
  if (process.platform !== "darwin") {
    return;
  }
  if (!pathOrLinkExists(MACOS_RESOLVER_PATH)) {
    return;
  }
  const res = spawnSync("sudo", ["rm", "-f", MACOS_RESOLVER_PATH], {
    stdio: "inherit",
  });
  if (res.status === 0) {
    console.log("   Resolver hook removed");
  } else {
    console.warn(
      `   ⚠️  Could not remove ${MACOS_RESOLVER_PATH} (sudo declined) — remove it manually`,
    );
  }
}

/**
 * Check whether a path exists, including broken symlinks.
 * Unlike existsSync, lstatSync does not follow symlinks — a dangling
 * symlink (target deleted) still returns true, allowing rmSync to remove it.
 */
function pathOrLinkExists(target: string): boolean {
  try {
    lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether a process with the given PID is alive.
 * signal-0 probe: does not send a signal, only checks existence.
 * EPERM (permission denied) means the process exists.
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read ~/.gabion/instances.json and return entries whose supervisor PID
 * is still alive. Defensive parsing: a corrupted or missing file returns
 * an empty array rather than throwing.
 */
function findRunningInstances(): readonly RegistryInstanceEntry[] {
  if (!existsSync(INSTANCES_JSON_PATH)) {
    return [];
  }

  try {
    const raw: unknown = JSON.parse(readFileSync(INSTANCES_JSON_PATH, "utf-8"));
    if (typeof raw !== "object" || raw === null) {
      return [];
    }

    const obj = raw as Record<string, unknown>;
    if (!Array.isArray(obj["instances"])) {
      return [];
    }

    const alive: RegistryInstanceEntry[] = [];

    for (const entry of obj["instances"] as readonly unknown[]) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as Record<string, unknown>;
      if (typeof record["name"] !== "string") continue;
      if (typeof record["supervisorPid"] !== "number") continue;

      if (isPidAlive(record["supervisorPid"])) {
        alive.push({
          name: record["name"],
          supervisorPid: record["supervisorPid"],
        });
      }
    }

    return alive;
  } catch {
    return [];
  }
}

/**
 * Prompt the user for a yes/no confirmation via stdin.
 * Returns true only for explicit "y" or "yes" (case-insensitive).
 */
function askConfirmation(question: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === "y" || normalized === "yes");
    });
  });
}

export async function runUninstall(args: readonly string[]): Promise<number> {
  const force = args.includes("--force");

  if (!existsSync(GABION_HOME)) {
    console.log("Nothing to uninstall — Gabion is not installed.");
    return 0;
  }

  const entries = readdirSync(GABION_HOME);
  const removable = entries.filter((name) => !UNINSTALL_PRESERVED_ENTRIES.has(name));

  if (removable.length === 0) {
    console.log("Nothing to uninstall — Gabion runtime is not installed.");
    return 0;
  }

  console.log("gabion uninstall — removing Gabion runtime\n");

  const running = findRunningInstances();
  if (running.length > 0) {
    console.error("✖ Cannot uninstall while instances are running:\n");
    for (const instance of running) {
      console.error(
        `  • ${instance.name} (PID ${String(instance.supervisorPid)})`,
      );
    }
    // `gabion stop` addresses the instance of the CURRENT project only;
    // instances listed above may live in other directories. `uninstance`
    // addresses each by the name just printed, from anywhere.
    console.error(
      "\n  Stop each one by its listed name:\n\n" +
        "       gabion uninstance <name>\n\n" +
        "  Then re-run:\n\n" +
        "       gabion uninstall\n",
    );
    return 1;
  }

  if (!force) {
    console.log(
      "This will remove everything under ~/.gabion/: the runtime, engines,\n" +
        "project template, bin shim, machine settings, and the machine pool\n" +
        "of checker rule bundles.\n" +
        "Your authentication token and project files are not affected." +
        (isWslCopy()
          ? "\nThe Gabion CLI copy and the Node.js that gabion install brought from Windows stay.\n"
          : "\n"),
    );

    const confirmed = await askConfirmation("Continue? (y/N) ");
    if (!confirmed) {
      console.log("Aborted.");
      return 0;
    }
    console.log("");
  }

  // Stop the gateway and remove its autostart BEFORE deleting the
  // runtime: the gateway process executes from the files about to be
  // removed, and the autostart unit lives outside ~/.gabion (in
  // ~/.config/systemd/user/), so the blanket removal below never
  // reaches it.
  await stopGatewayIfRunning();
  removeGatewayAutostart();
  removeMacResolverHook();

  let removedCount = 0;
  for (const name of removable) {
    const fullPath = join(GABION_HOME, name);
    if (pathOrLinkExists(fullPath)) {
      rmSync(fullPath, { recursive: true, force: true });
      removedCount++;
    }
  }

  // The home directory stays only while it still holds something (the
  // preserved auth.json). Empty, it would be a contentless trace — the
  // machine returns to its pre-install state instead.
  const leftover = readdirSync(GABION_HOME);
  if (leftover.length === 0) {
    rmSync(GABION_HOME, { recursive: true, force: true });
  }

  console.log(`✅ Gabion uninstalled (${String(removedCount)} items removed)`);
  console.log("   To re-install: gabion install");
  if (leftover.includes("auth.json")) {
    console.log("   To remove auth token: gabion auth --remove");
  }
  if (isWslCopy()) {
    const kept = [WSL_THIN_CLI_DIR_NAME, WSL_NODEJS_DIR_NAME]
      .filter((name) => leftover.includes(name))
      .map((name) => join(GABION_HOME, name));
    console.log(
      `   To remove the CLI copy and its Node.js too: rm -r ${[...kept, join(homedir(), ".local", "bin", "gabion")].join(" ")}`,
    );
    console.log("   (node, npm and npx in ~/.local/bin point into that Node.js; your projects use them)");
  } else {
    console.log("   To remove the CLI itself: npm uninstall -g gabion");
  }
  console.log(
    `   If your shell profile adds ${join(GABION_HOME, "bin")} to PATH, drop that entry`,
  );

  return 0;
}