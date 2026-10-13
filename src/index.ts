#!/usr/bin/env node
// src/index.ts

import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

import type { CommandHandler } from "./types.js";
import { runAuth } from "./auth.js";
import { runInstall } from "./install.js";
import { runSelfUpdate } from "./self-update.js";
import { runDoctor } from "./doctor.js";
import { runUninstall } from "./uninstall.js";
import { delegateToFullCli } from "./delegate.js";

/** Commands handled directly by the thin CLI. */
const LOCAL_COMMANDS: Readonly<Record<string, CommandHandler>> = {
  auth: runAuth,
  install: runInstall,
  uninstall: runUninstall,
  "self-update": runSelfUpdate,
  doctor: runDoctor,
};

function printVersion(): void {
  const __filename = fileURLToPath(import.meta.url);
  const pkgPath = join(dirname(__filename), "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };

  console.log(`gabion ${pkg.version} (${describeInstalledRuntime()})`);
}

/**
 * The installed runtime's version as the version line shows it. The
 * file is written by `gabion install`; a damaged one is named rather
 * than crashing the version line or printing "undefined".
 */
function describeInstalledRuntime(): string {
  const versionPath = join(homedir(), ".gabion", "version.json");
  if (!existsSync(versionPath)) return "runtime not installed";
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(versionPath, "utf-8"));
  } catch {
    return `runtime version unknown: ${versionPath} is not valid JSON`;
  }
  if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
    const { version } = parsed;
    if (typeof version === "string" && version !== "") return `runtime ${version}`;
  }
  return `runtime version unknown: ${versionPath} has no "version"`;
}

function printUsage(): void {
  console.log("Usage: gabion <command> [options]");
  console.log("");
  console.log("Setup:");
  console.log("  auth <token>     Authenticate with a Gabion access token");
  console.log("  auth --status    Show current authentication status");
  console.log("  auth --revoke    Remove saved token");
  console.log("  install          Download and install the Gabion runtime");
  console.log("  uninstall        Remove the Gabion runtime from this machine");
  console.log("  self-update      Check for and install runtime updates");
  console.log("  doctor           Check system prerequisites and installation");
  console.log("");
  console.log("Development (delegated to full runtime CLI):");
  console.log("  dev              Start the development instance");
  console.log("  check            Ask the running stand whether its verdict covers the tree");
  console.log("                   and nothing blocks (exit 0 clean, 1 blocking findings,");
  console.log("                   2 the check could not be performed)");
  console.log("  verify-jar       Start the built JAR as a server would: production profile,");
  console.log("                   empty directory, throwaway database (exit 0 healthy,");
  console.log("                   1 the JAR refused to start, 2 the check could not be performed)");
  console.log("  init <name>      Create a new project");
  console.log("  stop             Stop the running instance");
  console.log("  restart          Restart the current instance");
  console.log("  instances        List all registered instances");
  console.log("  uninstance <n>   Force-stop an instance by name");
  console.log("  gateway status   Show gateway health, name resolution, instances");
  console.log("  gateway start    Start the machine-global gateway");
  console.log("  gateway stop     Stop the machine-global gateway");
  console.log("");
  console.log("Module management (delegated to full runtime CLI):");
  console.log("  module install          Install a module from template or platform");
  console.log("  module remove           Remove an installed module");
  console.log("  module restore          Restore a standard module from template");
  console.log("  module replace          Atomically replace one module with another");
  console.log("  module export           Export module files for a public repository");
  console.log("  module status           Show modification status of installed modules");
  console.log("  module package          Build a distributable module archive");
  console.log("  module list             List installed modules and contracts");
  console.log("");
  console.log("Checker rules (delegated to full runtime CLI):");
  console.log("  rules init [dir]        Create a rule bundle authoring directory");
  console.log("  rules export <dir>      Build a distributable .gabion-rules file");
  console.log("  rules import <file>     Install a bundle into the machine pool");
  console.log("  rules list              List installed bundles");
  console.log("  rules remove <id>       Remove a bundle from the machine pool");
  console.log("  rules require <file>    Pin a bundle in the project manifest");
  console.log("  rules unrequire <id>    Remove a bundle pin from the manifest");
  console.log("");
  console.log("Starter management (delegated to full runtime CLI):");
  console.log("  starter replace         Replace the visual starter");
  console.log("  starter package         Build a distributable starter archive");
  console.log("");
  console.log("Solution management (delegated to full runtime CLI):");
  console.log("  solution install        Install a solution from platform or local path");
  console.log("  solution remove         Remove a solution and restore replaced modules");
  console.log("  solution package        Build a distributable solution archive");
  console.log("  solution export         Export solution files for a public repository");
  console.log("  solution list           List installed solutions");
  console.log("");
  console.log("Documentation layer (delegated to full runtime CLI):");
  console.log("  context init            Create the documentation layer (ai-context/, work-context/)");
  console.log("  context check           Verify documentation structural integrity");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const commandName = args[0];

  if (commandName === "--version" || commandName === "-v") {
    printVersion();
    process.exit(0);
  }

  if (
    commandName === undefined ||
    commandName === "--help" ||
    commandName === "-h"
  ) {
    printUsage();
    process.exit(commandName === undefined ? 1 : 0);
  }

  const localHandler = LOCAL_COMMANDS[commandName];
  if (localHandler !== undefined) {
    const code = await localHandler(args.slice(1));
    process.exit(code);
  }

  // Everything else delegates to the full CLI at ~/.gabion/runtime/.
  const code = delegateToFullCli(args);
  process.exit(code);
}

main().catch((err: unknown) => {
  console.error(
    `gabion: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});