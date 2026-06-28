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

  const versionPath = join(homedir(), ".gabion", "version.json");
  if (existsSync(versionPath)) {
    const runtime = JSON.parse(readFileSync(versionPath, "utf-8")) as { version: string };
    console.log(`gabion ${pkg.version} (runtime ${runtime.version})`);
  } else {
    console.log(`gabion ${pkg.version} (runtime not installed)`);
  }
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
  console.log("  init <name>      Create a new project");
  console.log("  stop             Stop the running instance");
  console.log("  restart          Restart the current instance");
  console.log("  instances        List all registered instances");
  console.log("  uninstance <n>   Force-stop an instance by name");
  console.log("");
  console.log("Module management (delegated to full runtime CLI):");
  console.log("  module install   Install a module from template or platform");
  console.log("  module remove    Remove an installed module");
  console.log("  module restore   Restore a standard module from template");
  console.log("  module list      List installed modules and contracts");
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