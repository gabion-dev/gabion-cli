// src/wsl-gabion-home.ts
/**
 * Where Gabion lives inside WSL, seen from Windows — and the access token
 * kept there.
 *
 * On Windows the token has one home once Gabion is installed: the
 * distribution, where the runtime renews its license with it. Before the
 * installation the token waits in the Windows ~/.gabion/auth.json — the
 * installation needs it before WSL even exists — and the installation
 * carries it inside and removes the Windows file (windows-install.ts).
 * From then on `gabion auth`, `--status`, `--remove` and `--revoke` typed
 * in PowerShell act on the copy inside, and `gabion install` run again takes
 * the token from there. A token entered inside and one entered in
 * PowerShell are the same file; two copies drifted both ways — a token
 * entered in PowerShell never reached the runtime, and a reinstallation
 * put the older Windows token back over a newer one inside, which, a
 * token having one active machine, moved the seat without a word.
 *
 * Which distribution: the one the installation went into, recorded on
 * the Windows side (WSL_HOME_RECORD_PATH). The default distribution may
 * change after the installation, and a lookup by "default" would then go
 * where Gabion is not. An installation by an earlier CLI left no record;
 * the distribution is then chosen the way the installation chooses it.
 * Either way Gabion's presence inside is checked, never assumed.
 *
 * Every call wakes the distribution (wsl.exe --exec); a stopped one
 * starts first.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { parseAuthConfig, serializeAuthConfig } from "./config.js";
import { WSL_HOME_RECORD_PATH } from "./constants.js";
import type { AuthConfig, WslDistribution, WslGabionHome } from "./types.js";
import {
  announceStartIfStopped,
  describeWsl,
  isWslInstalled,
  listDistributions,
  wslCapture,
  wslConsole,
} from "./wsl-exe.js";
import { WSL_PATHS, writeFileLines } from "./wsl-provision.js";

/** Distributions Docker Desktop registers for itself; never a home for Gabion. */
const DOCKER_DESKTOP_DISTRIBUTIONS: ReadonlySet<string> = new Set([
  "docker-desktop",
  "docker-desktop-data",
]);

/** Exit code of an inside read when the file (token, version stamp) is not there — an answer, not a failure. */
const NO_TOKEN_EXIT = 3;

/** The CLI copy the installation leaves inside; its manifest marks Gabion as installed there. */
const INSTALLED_MARKER = `${WSL_PATHS.thinCliDir}/package.json`;

/**
 * The distribution Gabion goes into or lives in: the recorded one while
 * it is registered, else the default one, unless it belongs to Docker
 * Desktop.
 */
export function chooseDistribution(
  distributions: readonly WslDistribution[],
  recorded: string | null,
): WslDistribution | null {
  const candidates = distributions.filter((d) => !DOCKER_DESKTOP_DISTRIBUTIONS.has(d.name));
  return (
    candidates.find((d) => d.name === recorded) ??
    candidates.find((d) => d.isDefault) ??
    candidates[0] ??
    null
  );
}

/** What the installation recorded, or null when it recorded nothing; a damaged record is an error. */
export function readWslHomeRecord(): WslGabionHome | null {
  if (!existsSync(WSL_HOME_RECORD_PATH)) return null;
  const refuse = (why: string): Error =>
    new Error(`${WSL_HOME_RECORD_PATH} ${why} — run gabion install again to rewrite it`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(WSL_HOME_RECORD_PATH, "utf-8"));
  } catch (err: unknown) {
    throw refuse(`is not valid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  if (typeof raw !== "object" || raw === null) throw refuse("is not a record of the installation");
  const { distribution, user } = raw as Record<string, unknown>;
  if (typeof distribution !== "string" || distribution === "" || typeof user !== "string" || user === "") {
    throw refuse("names no distribution and user");
  }
  return { distribution, user };
}

export function writeWslHomeRecord(home: WslGabionHome): void {
  mkdirSync(dirname(WSL_HOME_RECORD_PATH), { recursive: true });
  writeFileSync(WSL_HOME_RECORD_PATH, `${JSON.stringify(home, null, 2)}\n`, "utf-8");
}

export type WslGabionLocation =
  | { readonly kind: "installed"; readonly home: WslGabionHome }
  | { readonly kind: "not-installed" }
  | { readonly kind: "unreadable"; readonly reason: string };

/**
 * Whether Gabion is installed inside WSL, and where. The user is the
 * recorded one for the recorded distribution, else the distribution's
 * default user — the one the installation installs for.
 */
export function locateWslGabion(): WslGabionLocation {
  if (!isWslInstalled()) return { kind: "not-installed" };
  const listing = listDistributions();
  if (listing.kind === "unreadable") {
    return { kind: "unreadable", reason: `wsl.exe --list answered:\n${listing.output.trim()}` };
  }
  const record = readWslHomeRecord();
  const distribution = chooseDistribution(listing.distributions, record?.distribution ?? null);
  if (distribution === null) return { kind: "not-installed" };

  const asUser = record !== null && record.distribution === distribution.name ? ["-u", record.user] : [];
  // The first command inside: a stopped distribution starts here, and
  // every command typed in PowerShell comes through this function first.
  announceStartIfStopped(distribution);
  const probe = wslCapture([
    "-d",
    distribution.name,
    ...asUser,
    "--exec",
    "sh",
    "-c",
    `id -un; if [ -f "${INSTALLED_MARKER}" ]; then echo installed; else echo absent; fi`,
  ]);
  if (!probe.ok) {
    return { kind: "unreadable", reason: `could not look inside ${distribution.name}: ${describeWsl(probe)}` };
  }
  const [user, state] = probe.stdout.trim().split("\n").map((line) => line.trim());
  if (user === undefined || user === "" || (state !== "installed" && state !== "absent")) {
    return { kind: "unreadable", reason: `${distribution.name} answered "${probe.stdout.trim()}"` };
  }
  return state === "installed"
    ? { kind: "installed", home: { distribution: distribution.name, user } }
    : { kind: "not-installed" };
}

/** The runtime's version stamp inside, as text; null when there is none, a reason when it cannot be read. */
export function readVersionStampInside(home: WslGabionHome): { readonly text: string | null } | { readonly unreadable: string } {
  const result = wslCapture([
    "-d",
    home.distribution,
    "-u",
    home.user,
    "--exec",
    "sh",
    "-c",
    `f="${WSL_PATHS.versionFile}"; [ -f "$f" ] || exit ${String(NO_TOKEN_EXIT)}; cat "$f"`,
  ]);
  if (result.status === NO_TOKEN_EXIT) return { text: null };
  return result.ok ? { text: result.stdout } : { unreadable: describeWsl(result) };
}

/** How the token file inside is named in messages. */
export function describeTokenInside(home: WslGabionHome): string {
  return `~/.gabion/auth.json inside ${home.distribution} (user ${home.user})`;
}

export type TokenInside =
  | { readonly kind: "present"; readonly config: AuthConfig }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly reason: string };

export function readTokenInside(home: WslGabionHome): TokenInside {
  const result = wslCapture([
    "-d",
    home.distribution,
    "-u",
    home.user,
    "--exec",
    "sh",
    "-c",
    `f="${WSL_PATHS.authFile}"; [ -f "$f" ] || exit ${String(NO_TOKEN_EXIT)}; cat "$f"`,
  ]);
  if (result.status === NO_TOKEN_EXIT) return { kind: "absent" };
  if (!result.ok) return { kind: "unreadable", reason: describeWsl(result) };
  try {
    return { kind: "present", config: parseAuthConfig(result.stdout, describeTokenInside(home)) };
  } catch (err: unknown) {
    return { kind: "unreadable", reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Write the token inside, readable by its user only; null when written, else why not. */
export function writeTokenInside(home: WslGabionHome, config: AuthConfig): string | null {
  const script = [
    "set -eu",
    "umask 077",
    `mkdir -p "${WSL_PATHS.gabionHome}"`,
    writeFileLines(WSL_PATHS.authFile, Buffer.from(serializeAuthConfig(config), "utf-8")),
    "",
  ].join("\n");
  const result = wslConsole(["-d", home.distribution, "-u", home.user, "--exec", "sh", "-s"], { script });
  return result.ok ? null : describeWsl(result);
}

/** Remove the token inside; null when it is gone (or was never there), else why not. */
export function removeTokenInside(home: WslGabionHome): string | null {
  const result = wslCapture([
    "-d",
    home.distribution,
    "-u",
    home.user,
    "--exec",
    "sh",
    "-c",
    `rm -f "${WSL_PATHS.authFile}"`,
  ]);
  return result.ok ? null : describeWsl(result);
}
