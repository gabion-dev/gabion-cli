// src/delegate.ts

import { existsSync } from "fs";
import { join } from "path";
import { CLI_ENTRY, RUNTIME_DIR } from "./constants.js";
import { PINNED_NODE_BINARY } from "./pinned-node.js";
import { runExternal, describeRunFailure } from "./run-external.js";

/**
 * Delegate a command to the full Gabion CLI installed at ~/.gabion/runtime/:
 * its bytecode behind the CLI entry's loader, run on the pinned Node the
 * installation downloaded — never on the Node this thin CLI runs on,
 * which may be any release. Sets CWD to the runtime directory so the
 * loader resolves bytenode from runtime/node_modules/, and passes
 * GABION_ORIGINAL_CWD so the full CLI restores the user's actual working
 * directory.
 *
 * A spawn-level failure (which cannot come from the delegated command
 * itself) prints its concrete reason instead of silently exiting 1.
 */
export function delegateToFullCli(args: readonly string[]): number {
  const runtimeNodeModules = join(RUNTIME_DIR, "node_modules");

  if (!existsSync(runtimeNodeModules)) {
    console.error(
      "Gabion runtime is not installed.\n\n" +
      "  Install it first:\n\n" +
      "       gabion install\n",
    );
    return 1;
  }

  if (!existsSync(CLI_ENTRY)) {
    console.error(
      "Gabion CLI entry point is missing. Re-install the runtime:\n\n" +
      "       gabion install\n",
    );
    return 1;
  }
  if (!existsSync(PINNED_NODE_BINARY)) {
    console.error(
      "The Node release the runtime runs on is missing. Re-install the runtime:\n\n" +
      "       gabion install\n",
    );
    return 1;
  }

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    GABION_ORIGINAL_CWD: process.cwd(),
  };

  const result = runExternal(
    PINNED_NODE_BINARY,
    [CLI_ENTRY, ...args],
    { cwd: RUNTIME_DIR, stdio: "inherit", env },
  );

  if (result.error !== null) {
    console.error(`gabion: ${describeRunFailure("node", result)}`);
  }

  return result.status ?? 1;
}