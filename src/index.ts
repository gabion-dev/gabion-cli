#!/usr/bin/env node
// src/index.ts

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
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const commandName = args[0];

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