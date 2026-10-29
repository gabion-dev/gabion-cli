// src/doctor.ts

import { existsSync } from "fs";
import { join } from "path";
import { readInstalledVersion } from "./config.js";
import { MIN_NODE_MAJOR, RUNTIME_DIR } from "./constants.js";
import { delegateToFullCli } from "./delegate.js";
import { detectWsl, locateWslPath } from "./preflight.js";
import { runExternal } from "./run-external.js";
import { gitIdentity, gitIdentityMissingHint } from "./git-identity.js";
import type { WslPathLocation } from "./types.js";

export const DOCTOR_USAGE =
  "Usage: gabion doctor\n\n" +
  "Checks the prerequisites and, once the runtime is installed, the installation\n" +
  "itself (the runtime's own doctor answers then). Reports facts and a verdict per\n" +
  "check; exits 1 when a blocking check failed.";

/**
 * Probe a command and return its first output line, or null if absent.
 * doctor runs on Linux and macOS only (on Windows the preflight sends it
 * into the distribution), where every probed command is an executable.
 */
function probe(command: string, args: readonly string[]): string | null {
  const res = runExternal(command, args, { stdio: "capture" });
  if (!res.ok) {
    return null;
  }
  const combined = `${res.stdout}${res.stderr}`.trim();
  return combined.split("\n")[0] ?? combined;
}

/**
 * Where the command PATH resolves to lives, by WSL's own path translation
 * — a Windows drive is where Windows's programs are reached through
 * interop. Null when the shell finds no such command.
 */
function locateCommand(command: string): WslPathLocation | null {
  const res = runExternal("sh", ["-c", `command -v ${command}`], { stdio: "capture" });
  const path = res.stdout.trim();
  return res.ok && path !== "" ? locateWslPath(path) : null;
}

export async function runDoctor(args: readonly string[]): Promise<number> {
  if (existsSync(join(RUNTIME_DIR, "node_modules"))) {
    return delegateToFullCli(["doctor", ...args]);
  }

  console.log("gabion doctor — basic environment checks\n");
  console.log("(Runtime not installed — showing basic checks only)\n");

  let failures = 0;

  // Inside WSL the version is the fact that decides whether Gabion runs
  // here at all; WSL 1 never reaches this line (preflight refuses it).
  const wsl = detectWsl();
  if (wsl.kind === "wsl2") {
    console.log(`✅ WSL: version 2 (${wsl.distribution ?? "distribution name unknown"})`);
  }

  const nodeMajor = parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (nodeMajor >= MIN_NODE_MAJOR) {
    console.log(`✅ Node.js: v${process.versions.node}`);
  } else {
    console.log(
      `❌ Node.js: v${process.versions.node} (need >= ${String(MIN_NODE_MAJOR)})`,
    );
    failures++;
  }

  const javaLine = probe("java", ["-version"]);
  if (javaLine !== null) {
    console.log(`✅ Java: ${javaLine}`);
  } else {
    console.log("⚠️  Java: not found (will use portable JDK after install)");
  }

  const npmLine = probe("npm", ["--version"]);
  const npmLocation = wsl.kind === "wsl2" && npmLine !== null ? locateCommand("npm") : null;
  if (npmLocation?.kind === "windows") {
    // Interop lets a Linux shell run Windows's npm, and `npm install -g`
    // then installs into Windows while reporting success — the very
    // program that answered here cannot install anything for Linux.
    console.log(
      "❌ npm: the npm in PATH is Windows's, reached through WSL interop — it installs into Windows. " +
        "Install Node.js inside the distribution (gabion install from Windows brings one), then restart the terminal",
    );
    failures++;
  } else if (npmLocation?.kind === "unknown") {
    console.log(`✅ npm: ${npmLine ?? ""} (could not tell whether it is Windows's: ${npmLocation.reason})`);
  } else if (npmLine !== null) {
    console.log(`✅ npm: ${npmLine}`);
  } else {
    console.log("❌ npm: not found — install Node.js (which provides npm) and restart the terminal");
    failures++;
  }

  // Git is a degradable dependency, not a prerequisite: projects work
  // without it, only module modification tracking (git baselines) is
  // unavailable. Mirrors the verdict of the full runtime doctor.
  const gitLine = probe("git", ["--version"]);
  if (gitLine !== null) {
    console.log(`✅ Git: ${gitLine}`);
    // Who git records as the author — set by the user, never guessed:
    // the runtime refuses to create a project or a module baseline
    // without it, and its doctor shows the same line. The name and the
    // address are the human's to choose, so the marker says so.
    const identity = gitIdentity();
    if (identity.kind === "configured") {
      console.log(`✅ Git identity: ${identity.name} <${identity.email}>`);
    } else if (identity.kind === "unconfigured") {
      console.log(`❌ Git identity: ${gitIdentityMissingHint(identity.missing)}`);
      failures++;
    }
  } else {
    console.log(
      "⚠️  Git: not found — modules install without change tracking. " +
        "To enable: install git via your system package manager",
    );
  }

  const version = readInstalledVersion();
  if (version !== null) {
    console.log(`✅ Runtime: v${version.version}`);
  } else {
    console.log("⚠️  Runtime: not installed (run: gabion install)");
  }

  console.log("");
  if (failures > 0) {
    console.error("Some blocking checks failed — see ❌ above.");
    return 1;
  }
  console.log("Basic checks passed. Install runtime for full diagnostics.");
  return 0;
}