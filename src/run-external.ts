// src/run-external.ts
/**
 * Single owner of one-shot external command execution for the thin CLI.
 *
 * MIRROR NOTICE: this file deliberately duplicates
 * framework/shared/run-external.ts in the runtime repository. The
 * duplication is forced: the thin CLI's job is to install the runtime,
 * so it cannot import from a runtime that may not exist yet. When
 * changing the spawn policy here, change it there — and vice versa.
 *
 * Why this exists: on Windows, npm installs as a .cmd shim, and
 * Node >= 20 refuses to spawn those without a shell — spawn returns
 * EINVAL before the process starts. A shell resolves the shim via
 * PATHEXT. On POSIX the same commands are real executables and no
 * shell is involved. Callers declare shim-ness explicitly (windowsShim)
 * instead of a blanket per-platform shell: with a shell active, Node
 * does NOT quote arguments, so paths with spaces would silently break
 * for real executables that never needed a shell in the first place.
 *
 * Shell mode is only legal for fixed argument lists without user input.
 * assertShellSafe enforces this loudly: if a shim ever needs arguments
 * containing whitespace or shell metacharacters, the correct move is to
 * resolve the shim's full path via `where` and spawn it without a shell
 * — not to weaken the assertion.
 *
 * Error channel rule: a child's failure reason must reach the user.
 * describeRunFailure turns a result into a concrete reason (spawn error
 * code and message, exit status, or signal) — callers must print it (or
 * a superset of it) in every failure branch, never a bare generic string.
 */

import { spawnSync } from "child_process";
import type { RunExternalOptions, RunExternalResult } from "./types.js";

const IS_WINDOWS = process.platform === "win32";

/**
 * Characters that would require shell quoting (whitespace, cmd.exe
 * metacharacters and expansion triggers). Their presence in shell mode
 * is a programming error, not a runtime condition.
 */
const SHELL_UNSAFE_PATTERN = /[\s"'&|<>^%!()]/;

function assertShellSafe(command: string, args: readonly string[]): void {
  for (const token of [command, ...args]) {
    if (SHELL_UNSAFE_PATTERN.test(token)) {
      throw new Error(
        `runExternal: shim mode cannot pass "${token}" — it contains ` +
          "characters that need shell quoting. Resolve the shim's full " +
          "path (e.g. via `where`) and spawn it without a shell instead.",
      );
    }
  }
}

/** Run a one-shot external command synchronously. */
export function runExternal(
  command: string,
  args: readonly string[],
  options: RunExternalOptions,
): RunExternalResult {
  const useShell = IS_WINDOWS && (options.windowsShim ?? false);
  if (useShell) {
    assertShellSafe(command, args);
  }

  const res = spawnSync(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    shell: useShell,
    encoding: "utf-8",
    stdio: options.stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
  });

  return {
    ok: res.error === undefined && res.status === 0,
    status: res.status,
    signal: res.signal,
    error: res.error ?? null,
    stdout: typeof res.stdout === "string" ? res.stdout : "",
    stderr: typeof res.stderr === "string" ? res.stderr : "",
  };
}

/**
 * Human-readable failure reason for a failed runExternal result.
 * Distinguishes "never started" (spawn error with code) from "started
 * and failed" (exit status) from "killed" (signal).
 */
export function describeRunFailure(
  command: string,
  res: RunExternalResult,
): string {
  if (res.error !== null) {
    const code = (res.error as NodeJS.ErrnoException).code;
    const codeSuffix = code === undefined ? "" : ` (${code})`;
    return `${command} failed to start${codeSuffix}: ${res.error.message}`;
  }
  if (res.status !== null) {
    return `${command} exited with status ${String(res.status)}`;
  }
  if (res.signal !== null) {
    return `${command} was terminated by signal ${res.signal}`;
  }
  return `${command} failed without a status or signal`;
}