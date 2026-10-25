#!/usr/bin/env node
// src/index.ts

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

import type { CommandHandler } from "./types.js";
import { runAuth, AUTH_USAGE } from "./auth.js";
import { runInstall, INSTALL_USAGE } from "./install.js";
import { runSelfUpdate, SELF_UPDATE_USAGE } from "./self-update.js";
import { runDoctor, DOCTOR_USAGE } from "./doctor.js";
import { runUninstall, UNINSTALL_USAGE } from "./uninstall.js";
import { delegateToFullCli } from "./delegate.js";
import { preflight } from "./preflight.js";
import { packageRoot } from "./package-location.js";

/** Commands handled directly by the thin CLI, each with the help its `--help` prints. */
const LOCAL_COMMANDS: Readonly<Record<string, { readonly run: CommandHandler; readonly usage: string }>> = {
  auth: { run: runAuth, usage: AUTH_USAGE },
  install: { run: runInstall, usage: INSTALL_USAGE },
  uninstall: { run: runUninstall, usage: UNINSTALL_USAGE },
  "self-update": { run: runSelfUpdate, usage: SELF_UPDATE_USAGE },
  doctor: { run: runDoctor, usage: DOCTOR_USAGE },
};

function isHelpFlag(arg: string | undefined): boolean {
  return arg === "--help" || arg === "-h";
}

function printVersion(): void {
  const pkg = JSON.parse(readFileSync(join(packageRoot(), "package.json"), "utf-8")) as { version: string };
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
  console.log("  auth             Authenticate: asks for the access token (not shown)");
  console.log("  auth --status    Show current authentication status");
  console.log("  auth --remove    Remove the token from this machine (it stays valid)");
  console.log("  auth --revoke    Revoke the token on the platform, for every machine");
  console.log("  install          Download and install the Gabion runtime");
  console.log("                   (on Windows: prepare WSL 2 and install inside the distribution)");
  console.log("  uninstall        Remove the Gabion runtime from this machine");
  console.log("  self-update      Check for and install runtime updates");
  console.log("  doctor           Check system prerequisites and installation");
  console.log("  <command> --help Describe one of the commands above");
  console.log("");
  console.log("Development (delegated to full runtime CLI):");
  console.log("  dev              Start the development instance");
  console.log("  build            Ask the stand for the verdict, build the production JAR with");
  console.log("                   Gradle, start it as a server would (exit 0 built, 1 a gate or");
  console.log("                   Gradle refused, 2 the build could not be performed)");
  console.log("  clean            Remove the build outputs: backend build, generated types,");
  console.log("                   bundles (refused while this project's stand is running)");
  console.log("  check            Ask the running stand whether its verdict covers the tree");
  console.log("                   and nothing blocks (exit 0 clean, 1 blocking findings,");
  console.log("                   2 the check could not be performed)");
  console.log("  verify-jar       Start the built JAR as a server would: production profile,");
  console.log("                   empty directory, throwaway database (exit 0 healthy,");
  console.log("                   1 the JAR refused to start, 2 the check could not be performed)");
  console.log("  java-home        Print the home of the Java this machine resolves to, for a");
  console.log("                   ./gradlew call of your own: JAVA_HOME=\"$(gabion java-home)\"");
  console.log("  init <name>      Create a new project");
  console.log("  stop             Stop the running instance");
  console.log("  restart          Restart the current instance");
  console.log("  instances        List all registered instances");
  console.log("  uninstance <n>   Force-stop an instance by name");
  console.log("  gateway status   Show gateway health, name resolution, instances");
  console.log("  gateway start    Start the machine-global gateway");
  console.log("  gateway stop     Stop the machine-global gateway");
  console.log("");
  console.log("License (a token has one active machine; delegated to full runtime CLI):");
  console.log("  license status   Show the license on this machine");
  console.log("  license activate Take the token's seat for this machine (the other stops)");
  console.log("  license release  Give the seat up from this machine");
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
  console.log("");
  console.log("Platforms: Linux, macOS, Windows through WSL 2.");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const commandName = args[0];

  if (commandName === "--version" || commandName === "-v") {
    printVersion();
    process.exit(0);
  }

  if (commandName === undefined || isHelpFlag(commandName)) {
    printUsage();
    process.exit(commandName === undefined ? 1 : 0);
  }

  // Before the token, before the network: can Gabion work here at all?
  const refusal = preflight(commandName);
  if (refusal !== null) {
    console.error(refusal);
    process.exit(1);
  }

  const local = LOCAL_COMMANDS[commandName];
  if (local !== undefined) {
    if (isHelpFlag(args[1])) {
      console.log(local.usage);
      process.exit(0);
    }
    const code = await local.run(args.slice(1));
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
