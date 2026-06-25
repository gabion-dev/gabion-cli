// src/uninstall.ts
/**
 * `gabion uninstall` — remove the machine-global Gabion runtime from ~/.gabion/.
 *
 * Lives in the thin CLI because the uninstall command must not depend on the
 * artifact it removes. A broken runtime (corrupted node_modules, missing tsx)
 * must not prevent its own removal.
 *
 * Preserved: auth.json (use `gabion auth --revoke` to remove separately).
 * Never touched: per-project files under user's workspace.
 */

import { existsSync, readFileSync, rmSync } from "fs";
import { createInterface } from "readline";
import {
  BIN_DIR,
  ENGINES_DIR,
  GABION_HOME,
  INSTANCES_JSON_PATH,
  NODE_MODULES_LINK,
  RUNTIME_DIR,
  TEMPLATE_DIR,
  VERSION_JSON_PATH,
} from "./constants.js";
import type { RegistryInstanceEntry } from "./types.js";

/**
 * Paths removed during uninstall. Order is not significant — rmSync
 * handles missing entries gracefully.
 *
 * auth.json is deliberately excluded: re-installation should not force
 * the user to re-authenticate. Per-project directories (~/projects/foo/.gabion/)
 * are outside GABION_HOME and are never touched.
 */
const REMOVABLE_PATHS: readonly string[] = [
  RUNTIME_DIR,
  ENGINES_DIR,
  TEMPLATE_DIR,
  BIN_DIR,
  NODE_MODULES_LINK,
  VERSION_JSON_PATH,
  INSTANCES_JSON_PATH,
];

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

  const hasAnything = REMOVABLE_PATHS.some((p) => existsSync(p));
  if (!hasAnything) {
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
    console.error(
      "\n  Stop all instances first:\n\n" +
        "       gabion stop\n\n" +
        "  Then re-run:\n\n" +
        "       gabion uninstall\n",
    );
    return 1;
  }

  if (!force) {
    console.log(
      "This will remove the Gabion runtime, engines, and bin shim from ~/.gabion/.\n" +
        "Your authentication token and project files are not affected.\n",
    );

    const confirmed = await askConfirmation("Continue? (y/N) ");
    if (!confirmed) {
      console.log("Aborted.");
      return 0;
    }
    console.log("");
  }

  let removedCount = 0;
  for (const targetPath of REMOVABLE_PATHS) {
    if (existsSync(targetPath)) {
      rmSync(targetPath, { recursive: true, force: true });
      removedCount++;
    }
  }

  console.log(`✅ Gabion uninstalled (${String(removedCount)} items removed)`);
  console.log("   To re-install: gabion install");
  console.log("   To remove auth token: gabion auth --revoke");

  return 0;
}