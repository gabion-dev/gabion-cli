// src/doctor.ts

import { existsSync } from "fs";
import { join } from "path";
import { readInstalledVersion } from "./config.js";
import { MIN_NODE_MAJOR, RUNTIME_DIR } from "./constants.js";
import { delegateToFullCli } from "./delegate.js";
import { runExternal } from "./run-external.js";

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

export async function runDoctor(args: readonly string[]): Promise<number> {
  if (existsSync(join(RUNTIME_DIR, "node_modules"))) {
    return delegateToFullCli(["doctor", ...args]);
  }

  console.log("gabion doctor — basic environment checks\n");
  console.log("(Runtime not installed — showing basic checks only)\n");

  let failures = 0;

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
  if (npmLine !== null) {
    console.log(`✅ npm: ${npmLine}`);
  } else {
    console.log(
      "❌ npm: not found — install Node.js (which provides npm) and restart the terminal",
    );
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