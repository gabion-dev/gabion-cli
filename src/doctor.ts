// src/doctor.ts

import { existsSync } from "fs";
import { join } from "path";
import { readInstalledVersion } from "./config.js";
import { MIN_NODE_MAJOR, RUNTIME_DIR } from "./constants.js";
import { delegateToFullCli } from "./delegate.js";
import { detectWsl } from "./preflight.js";
import { runExternal } from "./run-external.js";

export const DOCTOR_USAGE =
  "Usage: gabion doctor\n\n" +
  "Checks the prerequisites and, once the runtime is installed, the installation\n" +
  "itself (the runtime's own doctor answers then). Reports facts and a verdict per\n" +
  "check; exits 1 when a blocking check failed.";

/**
 * Probe a command and return its first output line, or null if absent.
 * windowsShim is always on: probes target commands that may be .cmd
 * shims on Windows (npm), and their argument lists are fixed flags,
 * which shim mode requires. Real executables tolerate it — the shell
 * is only engaged on Windows for the probe's fixed arguments.
 */
function probe(command: string, args: readonly string[]): string | null {
  const res = runExternal(command, args, {
    stdio: "capture",
    windowsShim: true,
  });
  if (!res.ok) {
    return null;
  }
  const combined = `${res.stdout}${res.stderr}`.trim();
  return combined.split("\n")[0] ?? combined;
}

/** True when the command PATH resolves to lives on a Windows drive mounted into WSL. */
function resolvesUnderMnt(command: string): boolean {
  const res = runExternal("sh", ["-c", `command -v ${command}`], { stdio: "capture" });
  return res.ok && res.stdout.trim().startsWith("/mnt/");
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
  const npmFromWindows = wsl.kind === "wsl2" && npmLine !== null && resolvesUnderMnt("npm");
  if (npmFromWindows) {
    // Interop lets a Linux shell run Windows's npm, and `npm install -g`
    // then installs into Windows while reporting success — the very
    // program that answered here cannot install anything for Linux.
    console.log(
      "❌ npm: the npm in PATH is Windows's, reached through WSL interop — it installs into Windows. " +
        "Install Node.js inside the distribution (gabion install from Windows brings one), then restart the terminal",
    );
    failures++;
  } else if (npmLine !== null) {
    console.log(`✅ npm: ${npmLine}`);
  } else {
    // On Windows the most common cause is not a missing npm but
    // PowerShell ExecutionPolicy blocking the npm.ps1 shim. The policy
    // never applies to .cmd shims, so routing through cmd.exe is a fix
    // an agent can execute without changing any machine setting;
    // Set-ExecutionPolicy is the human-side alternative.
    const npmHint =
      process.platform === "win32"
        ? "not found or blocked. If PowerShell reports 'running scripts is " +
          "disabled', invoke npm through cmd.exe (cmd /c npm ...) — " +
          "ExecutionPolicy does not apply to .cmd shims. Alternatively a " +
          "human can run: Set-ExecutionPolicy RemoteSigned -Scope CurrentUser. " +
          "If npm is genuinely absent, install Node.js and restart the terminal"
        : "not found — install Node.js (which provides npm) and restart the terminal";
    console.log(`❌ npm: ${npmHint}`);
    failures++;
  }

  // Git is a degradable dependency, not a prerequisite: projects work
  // without it, only module modification tracking (git baselines) is
  // unavailable. Mirrors the verdict of the full runtime doctor.
  const gitLine = probe("git", ["--version"]);
  if (gitLine !== null) {
    console.log(`✅ Git: ${gitLine}`);
  } else {
    const hint =
      process.platform === "win32"
        ? "winget install Git.Git, then restart the terminal"
        : "install git via your system package manager";
    console.log(
      `⚠️  Git: not found — modules install without change tracking. To enable: ${hint}`,
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