// src/wsl-exe.ts
/**
 * The one place that launches wsl.exe — Windows's command for the Windows
 * Subsystem for Linux — and reads what it answers.
 *
 * Why not run-external.ts: wsl.exe has two habits no other program here
 * has. Its output is UTF-16LE by default; WSL_UTF8=1 in its environment
 * switches it to UTF-8, but the inbox stub that stands in for an
 * uninstalled WSL does not know the variable and still answers in
 * UTF-16LE — so the raw bytes are read and the encoding is judged per
 * answer, which a text-mode runner cannot do. And with a console on its
 * stdin the stub answers a listing by waiting a minute for a key press
 * that would start installing WSL — so stdin is a closed device for every
 * management command, and inherited for the stub's own `--install` (which
 * installs only from a console and asks for elevation at once, without
 * that wait) and for programs run inside a distribution for the user (its
 * first-run setup, the installation itself).
 *
 * Argument passing: Node quotes arguments for Windows's CommandLineToArgvW
 * and wsl.exe parses them back with the same function; after `--exec`
 * they reach the Linux program as given, with no shell in between. After
 * `--` wsl.exe would hand the rest to the distribution's shell as one
 * string — quotes and `$` interpreted there — so `--exec` is the only
 * form used, and a script travels on stdin (`--exec bash -s`), never on
 * the command line.
 *
 * Signal rule as in run-external.ts: while a child with an inherited
 * console runs, this process ignores the keyboard interrupt and only
 * relays the child's outcome.
 */

import { spawnSync, type SpawnSyncReturns } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { describeRunFailure } from "./run-external.js";
import type { RunExternalResult, WslDistribution } from "./types.js";

const WSL_EXE = "wsl.exe";

/** The packaged WSL; its absence means WSL is not installed and only the inbox stub answers. */
export const PACKAGED_WSL_EXE = join(
  process.env["ProgramFiles"] ?? "C:\\Program Files",
  "WSL",
  "wsl.exe",
);

/** Whether WSL itself is installed — the packaged wsl.exe, not the inbox stub. */
export function isWslInstalled(): boolean {
  return existsSync(PACKAGED_WSL_EXE);
}

/** wsl.exe answers in UTF-8 with this variable set (the inbox stub ignores it). */
const WSL_UTF8_ENVIRONMENT: Readonly<Record<string, string>> = { WSL_UTF8: "1" };

/**
 * Decode what wsl.exe wrote. UTF-16LE text either opens with its byte-order
 * mark (FF FE) or, when its first character is ASCII — every wsl.exe
 * message and the listing header — has a zero byte in second position;
 * UTF-8 text never contains a zero byte. The mark is dropped, Windows line
 * ends are normalized.
 */
export function decodeWslOutput(bytes: Buffer): string {
  const utf16 =
    bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || bytes[1] === 0);
  const text = utf16 ? bytes.toString("utf16le") : bytes.toString("utf-8");
  return text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
}

function toResult(res: SpawnSyncReturns<Buffer>): RunExternalResult {
  return {
    ok: res.error === undefined && res.status === 0,
    status: res.status,
    signal: res.signal,
    error: res.error ?? null,
    stdout: Buffer.isBuffer(res.stdout) ? decodeWslOutput(res.stdout) : "",
    stderr: Buffer.isBuffer(res.stderr) ? decodeWslOutput(res.stderr) : "",
  };
}

function wslEnvironment(): Record<string, string> {
  return { ...(process.env as Record<string, string>), ...WSL_UTF8_ENVIRONMENT };
}

/** Run wsl.exe and capture its answer; stdin is a closed device. */
export function wslCapture(args: readonly string[]): RunExternalResult {
  return toResult(
    spawnSync(WSL_EXE, [...args], {
      env: wslEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}

/**
 * Run wsl.exe with the console for its output. stdin is closed for
 * management commands and inherited for a program inside a distribution
 * that talks to the user; a script for `bash -s` is given as stdin text.
 */
export function wslConsole(
  args: readonly string[],
  stdin: "ignore" | "inherit" | { readonly script: string },
): RunExternalResult {
  const ignoreSignal = (): void => {
    // Deliberately no-op: the foreground child owns the interrupt.
  };
  process.on("SIGINT", ignoreSignal);
  process.on("SIGTERM", ignoreSignal);
  try {
    const script = typeof stdin === "object" ? stdin.script : undefined;
    return toResult(
      spawnSync(WSL_EXE, [...args], {
        env: wslEnvironment(),
        stdio: [typeof stdin === "object" ? "pipe" : stdin, "inherit", "inherit"],
        input: script,
      }),
    );
  } finally {
    process.off("SIGINT", ignoreSignal);
    process.off("SIGTERM", ignoreSignal);
  }
}

/**
 * Parse the answer of `wsl.exe --list --verbose`. The header and the
 * states are English constants of wsl.exe, not localized; the default
 * distribution carries "*" in the first column; the version is the last
 * column. Null when a line does not fit — the caller then shows the raw
 * answer instead of guessing.
 */
export function parseDistributionList(text: string): readonly WslDistribution[] | null {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const [header, ...rows] = lines;
  if (header === undefined || !/^NAME\s+STATE\s+VERSION$/.test(header)) return null;
  const distributions: WslDistribution[] = [];
  for (const row of rows) {
    const isDefault = row.startsWith("*");
    const tokens = (isDefault ? row.slice(1) : row).trim().split(/\s+/);
    if (tokens.length < 3) return null;
    const version = Number(tokens[tokens.length - 1]);
    if (version !== 1 && version !== 2) return null;
    distributions.push({ name: tokens.slice(0, -2).join(" "), version, isDefault });
  }
  return distributions;
}

/** What wsl.exe answered, for a message: how it ended and what it said. */
export function describeWsl(result: RunExternalResult): string {
  const output = `${result.stdout}${result.stderr}`.trim();
  return output === ""
    ? describeRunFailure("wsl.exe", result)
    : `${describeRunFailure("wsl.exe", result)}\n${output}`;
}

export type DistributionListing =
  | { readonly kind: "listed"; readonly distributions: readonly WslDistribution[] }
  | { readonly kind: "unreadable"; readonly output: string };

/**
 * The registered distributions. `--list --quiet` answers an empty list
 * with nothing and exit 0; `--list --verbose` on an empty list fails with
 * a message, so the quiet form decides emptiness and the verbose form
 * supplies versions and the default.
 */
export function listDistributions(): DistributionListing {
  const quiet = wslCapture(["--list", "--quiet"]);
  if (!quiet.ok) return { kind: "unreadable", output: describeWsl(quiet) };
  if (quiet.stdout.trim() === "") return { kind: "listed", distributions: [] };
  const verbose = wslCapture(["--list", "--verbose"]);
  if (!verbose.ok) return { kind: "unreadable", output: describeWsl(verbose) };
  const distributions = parseDistributionList(verbose.stdout);
  if (distributions === null) return { kind: "unreadable", output: verbose.stdout };
  return { kind: "listed", distributions };
}
