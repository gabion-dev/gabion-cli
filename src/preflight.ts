// src/preflight.ts
/**
 * The check every command runs first — before the token is read, before
 * any request leaves the machine: can Gabion work where this process is
 * running at all? A refusal here costs the user nothing; a refusal after
 * the token was saved and the archive downloaded (where the platform used
 * to be judged) costs the download and sends the user to WSL only then.
 *
 * Three questions, in order:
 *
 *   1. Platform. Linux and macOS run Gabion; Windows runs it inside WSL 2
 *      only — on Windows this CLI accepts the two commands that lead into
 *      WSL (`auth`, which saves the token the installation carries inside,
 *      and `install`, which prepares WSL 2 and installs Gabion in the
 *      distribution) and points every other command at the distribution.
 *   2. Architecture. x64 and arm64, as the runtime archives are built.
 *   3. WSL 1. A Linux that is WSL 1 is refused: the runtime's pinned Node
 *      does not even start there (the ELF loader of WSL 1 rejects its
 *      segment alignment), there is no systemd and so no machine id for
 *      the license. The fix is one command in Windows, printed here.
 *
 * How WSL 1 and WSL 2 are told apart: the kernel release string. WSL 1 has
 * no Linux kernel; its emulated release reads "4.4.0-<build>-Microsoft" —
 * "Microsoft" capitalised, the very test WSL's own init applies. WSL 2 runs
 * a real kernel released as "<version>-microsoft-standard-WSL2". A release
 * with neither "microsoft" nor "WSL" in any case is not WSL. Rejected
 * markers: the WSLInterop binfmt entry (present in both versions),
 * WSL_INTEROP (absent whenever interop is disabled) and
 * systemd-detect-virt (the same answer for both).
 *
 * MIRROR NOTICE: formwork/shared/wsl.ts in the runtime applies the same
 * test and the same path translation (locateWslPath) — the runtime cannot
 * be imported by the CLI that installs it. Change both or neither.
 */

import { release } from "os";
import { describeRunFailure, runExternal } from "./run-external.js";
import type { WslDetection, WslPathLocation } from "./types.js";

/** The commands this CLI runs on Windows itself; everything else lives inside WSL. */
const COMMANDS_ON_WINDOWS: ReadonlySet<string> = new Set(["auth", "install"]);

const SUPPORTED_ARCHITECTURES: ReadonlySet<string> = new Set(["x64", "arm64"]);

/** Which WSL this Linux is, judged by the kernel release string. */
export function detectWsl(): WslDetection {
  if (process.platform !== "linux") return { kind: "not-wsl" };
  const kernel = release();
  const distribution = process.env["WSL_DISTRO_NAME"] ?? null;
  if (kernel.includes("Microsoft")) return { kind: "wsl1", distribution };
  if (/microsoft|wsl/i.test(kernel)) return { kind: "wsl2", distribution };
  return { kind: "not-wsl" };
}

/**
 * The prefix wslpath gives every path of the distribution's own file
 * system (\\wsl.localhost\<distribution>\…).
 */
const DISTRIBUTION_SHARE_PREFIX = "\\\\wsl.localhost\\";

/**
 * Where WSL's own path translation places a path: `wslpath -w` answers
 * C:\… for a Windows drive mounted into the distribution and
 * \\wsl.localhost\<distribution>\… for its own file system. WSL mounts
 * Windows drives several ways (9p, virtiofs) under a mount root that is a
 * setting, so neither the mount table read here nor the name /mnt/ would
 * be the same answer WSL gives.
 */
export function locateWslPath(path: string): WslPathLocation {
  if (detectWsl().kind === "not-wsl") return { kind: "linux" };
  const res = runExternal("wslpath", ["-w", path], { stdio: "capture" });
  if (!res.ok) {
    const said = res.stderr.trim();
    const failure = describeRunFailure("wslpath", res);
    return { kind: "unknown", reason: said === "" ? failure : `${failure}: ${said}` };
  }
  const windowsPath = res.stdout.trim();
  if (windowsPath === "") return { kind: "unknown", reason: "wslpath answered nothing" };
  if (windowsPath.startsWith(DISTRIBUTION_SHARE_PREFIX)) return { kind: "linux" };
  return { kind: "windows", windowsPath };
}

/** The Windows command that moves a distribution to WSL 2. */
export function wslSetVersionCommand(distribution: string | null): string {
  return `wsl --set-version ${distribution ?? "<distribution>"} 2`;
}

function windowsRefusal(commandName: string): string {
  return (
    `gabion ${commandName}: Gabion runs inside WSL 2 (Windows Subsystem for Linux), not on Windows itself.\n\n` +
    "  Open your Linux distribution (Start menu → Ubuntu) and run the command there.\n\n" +
    "  No distribution yet? Run in Windows:\n\n" +
    "       gabion install\n\n" +
    "  It prepares WSL 2 and installs Gabion inside the distribution.\n"
  );
}

function wsl1Refusal(commandName: string, distribution: string | null): string {
  const name = distribution ?? "this distribution";
  return (
    `gabion ${commandName}: ${name} runs on WSL 1, and Gabion needs WSL 2 — ` +
    "the runtime's Node.js does not start on WSL 1, and WSL 1 has no systemd to identify the machine for the license.\n\n" +
    "  Move the distribution to WSL 2, in Windows PowerShell:\n\n" +
    `       ${wslSetVersionCommand(distribution)}\n\n` +
    "  Then run the command again here.\n"
  );
}

/**
 * The refusal for running `commandName` here, or null when this machine
 * can run it. `--version` and help never reach this check: they describe
 * the CLI and work everywhere.
 */
export function preflight(commandName: string): string | null {
  if (process.platform === "win32") {
    if (!COMMANDS_ON_WINDOWS.has(commandName)) return windowsRefusal(commandName);
  } else if (process.platform !== "linux" && process.platform !== "darwin") {
    return (
      `gabion ${commandName}: ${process.platform} is not a supported platform — ` +
      "Gabion runs on Linux, macOS and Windows through WSL 2.\n"
    );
  }
  if (!SUPPORTED_ARCHITECTURES.has(process.arch)) {
    return (
      `gabion ${commandName}: ${process.arch} is not a supported architecture — ` +
      "Gabion runs on x64 and arm64.\n"
    );
  }
  const wsl = detectWsl();
  if (wsl.kind === "wsl1") return wsl1Refusal(commandName, wsl.distribution);
  return null;
}
