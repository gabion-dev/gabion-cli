// src/delegate.ts

import { existsSync } from "fs";
import { join } from "path";
import { RUNTIME_DIR } from "./constants.js";
import { runExternal, describeRunFailure } from "./run-external.js";

/**
 * Delegate a command to the full Gabion CLI installed at ~/.gabion/runtime/.
 * Sets CWD to the runtime directory so Node resolves the tsx loader from
 * runtime/node_modules/, and passes GABION_ORIGINAL_CWD so the full CLI
 * restores the user's actual working directory.
 *
 * process.execPath is the real node binary — no shim mode. A spawn-level
 * failure (which cannot come from the delegated command itself) prints
 * its concrete reason instead of silently exiting 1.
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

  const cliEntry = join(RUNTIME_DIR, "cli", "gabion.ts");
  if (!existsSync(cliEntry)) {
    console.error(
      "Gabion CLI entry point is missing. Re-install the runtime:\n\n" +
      "       gabion install\n",
    );
    return 1;
  }

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    GABION_ORIGINAL_CWD: process.cwd(),
  };

  const result = runExternal(
    process.execPath,
    ["--import", "tsx", cliEntry, ...args],
    { cwd: RUNTIME_DIR, stdio: "inherit", env },
  );

  if (result.error !== null) {
    console.error(`gabion: ${describeRunFailure("node", result)}`);
  }

  return result.status ?? 1;
}