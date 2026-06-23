// src/doctor.ts

import { existsSync } from "fs";
import { spawnSync } from "child_process";
import { join } from "path";
import { readInstalledVersion } from "./config.js";
import { MIN_NODE_MAJOR, RUNTIME_DIR } from "./constants.js";
import { delegateToFullCli } from "./delegate.js";

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

  const javaResult = spawnSync("java", ["-version"], { encoding: "utf-8" });
  if (javaResult.error === undefined && javaResult.status === 0) {
    const javaOutput = `${javaResult.stdout}${javaResult.stderr}`.trim();
    const firstLine = javaOutput.split("\n")[0] ?? javaOutput;
    console.log(`✅ Java: ${firstLine}`);
  } else {
    console.log("⚠️  Java: not found (will use portable JDK after install)");
  }

  const npmResult = spawnSync("npm", ["--version"], { encoding: "utf-8" });
  if (npmResult.error === undefined && npmResult.status === 0) {
    console.log(`✅ npm: ${npmResult.stdout.trim()}`);
  } else {
    console.log("❌ npm: not found");
    failures++;
  }

  const gitResult = spawnSync("git", ["--version"], { encoding: "utf-8" });
  if (gitResult.error === undefined && gitResult.status === 0) {
    console.log(`✅ Git: ${gitResult.stdout.trim()}`);
  } else {
    console.log("❌ Git: not found");
    failures++;
  }

  const version = readInstalledVersion();
  if (version !== null) {
    console.log(`✅ Runtime: v${version.version}`);
  } else {
    console.log("⚠️  Runtime: not installed (run: gabion install)");
  }

  console.log("");
  if (failures > 0) {
    console.error("Some blocking checks failed.");
    return 1;
  }
  console.log("Basic checks passed. Install runtime for full diagnostics.");
  return 0;
}