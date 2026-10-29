// src/run-external.ts
/**
 * Single owner of one-shot external command execution for the thin CLI,
 * and of the Windows shim launch strategy (resolveWindowsShim).
 *
 * MIRROR NOTICE: this file deliberately duplicates the signal rule and
 * the error channel rule of formwork/shared/run-external.ts in the
 * runtime repository. The duplication is forced: the thin CLI's job is
 * to install the runtime, so it cannot import from a runtime that may
 * not exist yet. When changing either rule here, change it there — and
 * vice versa. The shim launch strategy below is the thin CLI's own: it
 * runs in Windows PowerShell, the runtime runs only on Linux, macOS and
 * WSL 2 and spawns every command directly.
 *
 * Why this exists: on Windows, npm installs as a .cmd shim, and
 * Node >= 20 refuses to spawn those without a shell — spawn returns
 * EINVAL before the process starts. On POSIX the same commands are real
 * executables and spawn directly. Callers declare shim-ness explicitly
 * (windowsShim) instead of a blanket per-platform policy.
 *
 * Shim launch strategy: a shim is launched through an EXPLICIT
 * `cmd.exe /c <shim> <args...>` argument vector, never through the
 * `shell: true` spawn option. With `shell: true` Node concatenates
 * arguments into a single line without escaping them (deprecated as
 * DEP0190 for exactly that reason), leaving quoting at the mercy of
 * cmd.exe line parsing. With the explicit vector every argument stays
 * a separate array element and Node performs its own quoting.
 *
 * cmd.exe still parses the line after /c, so shim mode remains legal
 * only for fixed argument lists without user input. assertShellSafe
 * enforces this loudly inside the resolver: if a shim ever needs
 * arguments containing whitespace or cmd metacharacters, the correct
 * move is to resolve the shim's full path (e.g. via `where`) and hand
 * it to a dedicated launcher — not to weaken the assertion.
 *
 * Signal rule: a child launched with inherited stdio shares the terminal's
 * foreground process group and receives the keyboard interrupt itself;
 * for its lifetime this process ignores SIGINT/SIGTERM and only relays
 * the child's outcome — a wrapper that dies first hands the prompt back
 * while the child is still shutting down (see runExternal).
 *
 * Error channel rule: a child's failure reason must reach the user.
 * describeRunFailure turns a result into a concrete reason (spawn error
 * code and message, exit status, or signal) — callers must print it (or
 * a superset of it) in every failure branch, never a bare generic string.
 */

import { spawnSync } from "child_process";
import type {
  ResolvedCommand,
  RunExternalOptions,
  RunExternalResult,
} from "./types.js";

const IS_WINDOWS = process.platform === "win32";

/**
 * Characters that cmd.exe would interpret on the line after /c
 * (whitespace, metacharacters, expansion triggers). Their presence in
 * shim mode is a programming error, not a runtime condition.
 */
const SHELL_UNSAFE_PATTERN = /[\s"'&|<>^%!()]/;

function assertShellSafe(command: string, args: readonly string[]): void {
  for (const token of [command, ...args]) {
    if (SHELL_UNSAFE_PATTERN.test(token)) {
      throw new Error(
        `resolveWindowsShim: shim mode cannot pass "${token}" — it ` +
          "contains characters that cmd.exe would interpret. Resolve the " +
          "shim's full path (e.g. via `where`) and spawn it without a " +
          "shell instead.",
      );
    }
  }
}

/**
 * Resolve a command that is a .cmd/.bat shim on Windows into a spawnable
 * command vector. On POSIX the vector passes through unchanged. This is
 * the single place in the thin CLI that knows about `cmd.exe /c`; every
 * spawner of a shim (sync or async) must go through it instead of
 * setting `shell: true` or hand-building the cmd invocation.
 */
export function resolveWindowsShim(
  command: string,
  args: readonly string[],
): ResolvedCommand {
  if (!IS_WINDOWS) {
    return { command, args: [...args] };
  }
  assertShellSafe(command, args);
  return { command: "cmd.exe", args: ["/c", command, ...args] };
}

/** Run a one-shot external command synchronously. */
export function runExternal(
  command: string,
  args: readonly string[],
  options: RunExternalOptions,
): RunExternalResult {
  const resolved: ResolvedCommand = (options.windowsShim ?? false)
    ? resolveWindowsShim(command, args)
    : { command, args: [...args] };

  // A child with inherited stdio sits in the terminal's foreground process
  // group, so an interrupt from the keyboard reaches it directly and the
  // child decides what the interrupt means (a dev session shuts down in
  // order, a package manager stops). This wrapper has no decision to make
  // and only one job: outlive the child and relay its outcome. Without a
  // listener Node's default disposition kills the wrapper on the spot,
  // the shell sees its direct child exit and prints the prompt while the
  // child is still shutting down and writing to the terminal. The
  // listeners are deliberately no-ops and live exactly as long as the
  // child; captured-stdio probes keep the default disposition.
  const transparent = options.stdio === "inherit";
  const ignoreSignal = (): void => {
    // Deliberately no-op: the foreground child owns the interrupt.
  };
  if (transparent) {
    process.on("SIGINT", ignoreSignal);
    process.on("SIGTERM", ignoreSignal);
  }

  try {
    const res = spawnSync(resolved.command, [...resolved.args], {
      cwd: options.cwd,
      env: options.env,
      encoding: "utf-8",
      stdio: transparent ? "inherit" : ["ignore", "pipe", "pipe"],
    });

    return {
      ok: res.error === undefined && res.status === 0,
      status: res.status,
      signal: res.signal,
      error: res.error ?? null,
      stdout: typeof res.stdout === "string" ? res.stdout : "",
      stderr: typeof res.stderr === "string" ? res.stderr : "",
    };
  } finally {
    if (transparent) {
      process.off("SIGINT", ignoreSignal);
      process.off("SIGTERM", ignoreSignal);
    }
  }
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