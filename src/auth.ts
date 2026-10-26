// src/auth.ts

import { ApiError, revokeToken, verifyToken } from "./api-client.js";
import {
  confirmedNow,
  readAuthConfig,
  writeAuthConfig,
  removeAuthConfig,
} from "./config.js";
import {
  AUTH_CONFIG_PATH,
  DEFAULT_API_URL,
  TOKEN_PREFIX,
  MIN_TOKEN_LENGTH,
} from "./constants.js";
import { askLine, readMaskedLine, readStandardInput } from "./secret-input.js";
import type { AuthConfig, WslGabionHome } from "./types.js";
import {
  describeTokenInside,
  locateWslGabion,
  readTokenInside,
  removeTokenInside,
  writeTokenInside,
} from "./wsl-gabion-home.js";

const STDIN_FLAG = "--stdin";
const REMOVE_FLAG = "--remove";
const REVOKE_FLAG = "--revoke";

/**
 * Characters of a token shown as they are — by every message, by the prompt
 * as the token is pasted, and by the platform's panel: enough to tell tokens
 * apart, not to use one.
 */
const SHOWN_PREFIX_LENGTH = 8;

/** Characters of the token typed back to confirm a revocation — the ones every message shows. */
const CONFIRM_PREFIX_LENGTH = SHOWN_PREFIX_LENGTH;

export const AUTH_USAGE =
  "Usage: gabion auth            asks for the token; what you paste shows masked\n" +
  `       gabion auth ${STDIN_FLAG}    reads the token from standard input (scripts, CI)\n` +
  "       gabion auth --status      asks the platform whether the saved token is accepted now\n" +
  `       gabion auth ${REMOVE_FLAG}    removes the token from this machine; it stays valid\n` +
  `       gabion auth ${REVOKE_FLAG}    revokes the token on the platform, for every machine\n\n` +
  "Verifies the access token with the platform and saves it in ~/.gabion/auth.json;\n" +
  "gabion install and self-update download the runtime with it. On Windows the\n" +
  "token waits in Windows until gabion install carries it into the WSL\n" +
  "distribution; from then on it is kept there only, and these commands typed in\n" +
  "PowerShell act on that copy.\n\n" +
  `${REMOVE_FLAG} is for a machine you leave: the token keeps working elsewhere.\n` +
  `${REVOKE_FLAG} is for a token that leaked (a chat, a commit, a CI log, a lost\n` +
  "machine): the platform stops honouring it everywhere, at once and for good —\n" +
  "a new token comes from the project author. It revokes the token saved here, or\n" +
  "asks for the token when none is saved; you confirm by typing its first\n" +
  `${String(CONFIRM_PREFIX_LENGTH)} characters. The machine's license seat is separate: gabion license release.\n\n` +
  "The token is never taken on the command line: there it would stay on the\n" +
  "screen, in the shell's history file and in the process list.";

/** The first characters of a token and a fixed mask — enough to tell tokens apart, not to use one. */
function maskToken(token: string): string {
  return `${token.slice(0, SHOWN_PREFIX_LENGTH)}${"*".repeat(8)}`;
}

/** The token from the terminal prompt or from standard input; null when none was given. */
async function readToken(fromStdin: boolean): Promise<string | null> {
  if (fromStdin) return readStandardInput();
  if (!process.stdin.isTTY) {
    console.error(
      "gabion auth: there is no terminal to ask for the token in.\n" +
        `  Pipe it to standard input instead:  <command printing the token> | gabion auth ${STDIN_FLAG}`,
    );
    return null;
  }
  return readMaskedLine("Paste your access token and press Enter (shown masked): ", SHOWN_PREFIX_LENGTH);
}

type TokenHome = { readonly kind: "here" } | { readonly kind: "wsl"; readonly home: WslGabionHome };

/**
 * Where this machine keeps its token: here, or — on Windows once Gabion is
 * installed inside WSL — in the distribution, its one home from then on
 * (wsl-gabion-home.ts). Null, with the reason printed, when Windows cannot
 * tell: acting on the Windows file then could create the second copy this
 * arrangement exists to avoid.
 */
function tokenHome(): TokenHome | null {
  if (process.platform !== "win32") return { kind: "here" };
  const located = locateWslGabion();
  if (located.kind === "installed") return { kind: "wsl", home: located.home };
  if (located.kind === "not-installed") return { kind: "here" };
  console.error(
    `gabion auth: could not tell whether Gabion is installed inside WSL, so the token was not touched.\n  ${located.reason}\n`,
  );
  return null;
}

/** Remove the saved token wherever this machine keeps it; null when removed, else why not. */
function removeSaved(where: TokenHome): string | null {
  if (where.kind === "wsl") {
    const failure = removeTokenInside(where.home);
    if (failure !== null) return `could not remove ${describeTokenInside(where.home)}: ${failure}`;
  }
  // On Windows a copy from before the installation is not a token this
  // machine uses either.
  removeAuthConfig();
  return null;
}

function describeHome(where: TokenHome): string {
  return where.kind === "wsl" ? describeTokenInside(where.home) : AUTH_CONFIG_PATH;
}

/** The token saved where this machine keeps it, null when none is; a string when it cannot be read. */
function readSaved(where: TokenHome): AuthConfig | null | string {
  if (where.kind === "here") return readAuthConfig();
  const inside = readTokenInside(where.home);
  if (inside.kind === "unreadable") return `could not read ${describeTokenInside(where.home)}: ${inside.reason}`;
  return inside.kind === "present" ? inside.config : null;
}

function remove(): number {
  const where = tokenHome();
  if (where === null) return 1;
  const failure = removeSaved(where);
  if (failure !== null) {
    console.error(`gabion auth ${REMOVE_FLAG}: ${failure}`);
    return 1;
  }
  console.log(
    `Token removed from ${describeHome(where)}.\n` +
      "It stays valid on the platform; to stop it everywhere: gabion auth --revoke",
  );
  return 0;
}

/**
 * Revoke a token on the platform: the saved one, or one typed in when this
 * machine has none (the case of a lost machine). Typed back by its first
 * characters to confirm — the revocation is final — then the local copy
 * goes too. Nothing local changes unless the platform confirmed.
 */
async function revoke(): Promise<number> {
  const where = tokenHome();
  if (where === null) return 1;
  if (!process.stdin.isTTY) {
    console.error(
      `gabion auth ${REVOKE_FLAG}: a revocation is final and is confirmed on a terminal; there is none here.`,
    );
    return 1;
  }
  const saved = readSaved(where);
  if (typeof saved === "string") {
    console.error(`gabion auth ${REVOKE_FLAG}: ${saved}`);
    return 1;
  }
  let token: string;
  if (saved !== null) {
    token = saved.token;
  } else {
    console.log("No token is saved on this machine. Paste the token to revoke.");
    const typed = await readMaskedLine("Token (shown masked): ", SHOWN_PREFIX_LENGTH);
    if (typed === null || typed === "") {
      console.error("No token was entered; nothing was revoked.");
      return 1;
    }
    if (!typed.startsWith(TOKEN_PREFIX) || typed.length < MIN_TOKEN_LENGTH) {
      console.error(
        `Invalid token format. Tokens start with "${TOKEN_PREFIX}" and are at least ${String(MIN_TOKEN_LENGTH)} characters.`,
      );
      return 1;
    }
    token = typed;
  }

  const prefix = token.slice(0, CONFIRM_PREFIX_LENGTH);
  console.log(
    `\nThis revokes token ${maskToken(token)} on the platform, for good: every machine using it\n` +
      "stops at its next license renewal, and a new token comes only from the project author.\n",
  );
  const typedPrefix = (await askLine(`Type the token's first ${String(CONFIRM_PREFIX_LENGTH)} characters to confirm: `)).trim();
  if (typedPrefix !== prefix) {
    console.error("Not confirmed; nothing was revoked.");
    return 1;
  }

  let revokedAt: string;
  let already: boolean;
  try {
    ({ revokedAt, already } = await revokeToken(token, saved?.apiUrl ?? DEFAULT_API_URL));
  } catch (err: unknown) {
    const why =
      err instanceof ApiError && err.reason === "not_found"
        ? "the platform does not know this token, so there is nothing to revoke"
        : `the platform could not be asked: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`gabion auth ${REVOKE_FLAG}: ${why}. Nothing was changed on this machine.`);
    return 1;
  }
  console.log(
    already
      ? `Token ${maskToken(token)} was already revoked (${revokedAt}).`
      : `Token ${maskToken(token)} revoked on the platform (${revokedAt}).`,
  );
  if (saved !== null) {
    const failure = removeSaved(where);
    if (failure !== null) {
      console.error(`gabion auth ${REVOKE_FLAG}: the token is revoked, but ${failure}`);
      return 1;
    }
    console.log(`Removed from ${describeHome(where)}.`);
  }
  console.log("To keep working, ask the project author for a new token, then: gabion auth");
  return 0;
}

/** Write a config where this machine keeps its token; null when written, else why not. */
function persist(where: TokenHome, config: AuthConfig): string | null {
  if (where.kind === "wsl") {
    const failure = writeTokenInside(where.home, config);
    if (failure !== null) return `could not save the token in ${describeTokenInside(where.home)}: ${failure}`;
    removeAuthConfig();
    return null;
  }
  writeAuthConfig(config);
  return null;
}

/** Save a verified token where this machine keeps it; the exit code. */
function save(config: AuthConfig): number {
  const where = tokenHome();
  if (where === null) return 1;
  const failure = persist(where, config);
  if (failure !== null) {
    console.error(`Could not save the token: ${failure}`);
    return 1;
  }
  if (where.kind === "wsl") {
    console.log(`Token saved to ${describeTokenInside(where.home)} — the one copy on this machine.`);
    return 0;
  }
  console.log(`Token saved to ${AUTH_CONFIG_PATH}`);
  if (process.platform === "win32") {
    console.log("gabion install carries it into the WSL distribution and keeps it there.");
  }
  return 0;
}

export async function runAuth(args: readonly string[]): Promise<number> {
  if (args.includes(REMOVE_FLAG)) {
    return remove();
  }

  if (args.includes(REVOKE_FLAG)) {
    return revoke();
  }

  if (args.includes("--status")) {
    return status();
  }

  const unexpected = args.filter((arg) => arg !== STDIN_FLAG);
  if (unexpected.length > 0) {
    const tokenOnCommandLine = unexpected.some((arg) => arg.startsWith(TOKEN_PREFIX));
    console.error(
      tokenOnCommandLine
        ? "gabion auth does not take the token on the command line: it would stay on the\n" +
            "screen, in the shell's history file and in the process list. Run gabion auth\n" +
            "and paste the token when it asks.\n\n" +
            "  The line you just typed is in your shell's history; remove it there.\n"
        : AUTH_USAGE,
    );
    return 1;
  }

  const token = await readToken(args.includes(STDIN_FLAG));
  if (token === null) return 1;
  if (token === "") {
    console.error("No token was entered.");
    return 1;
  }

  if (!token.startsWith(TOKEN_PREFIX) || token.length < MIN_TOKEN_LENGTH) {
    console.error(
      `Invalid token format. Tokens start with "${TOKEN_PREFIX}" and are at least ${String(MIN_TOKEN_LENGTH)} characters.`,
    );
    return 1;
  }

  console.log(`Verifying token ${maskToken(token)} (${String(token.length)} characters)...`);

  try {
    const result = await verifyToken(token);
    if (!result.valid) {
      console.error(`Token rejected: ${result.reason}`);
      return 1;
    }

    console.log(`Authenticated as ${result.name ?? "unknown"}.`);
    return save(confirmedNow({ token, apiUrl: DEFAULT_API_URL, lastVerifiedAt: null }));
  } catch (err: unknown) {
    console.error(
      `Failed to verify token: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
}

/**
 * Whether the saved token is accepted by the platform NOW — the question
 * a status is asked for. The platform is the one owner of that fact; the
 * saved confirmation time is only what this machine knew last, shown when
 * the platform cannot be asked and never in its place (a token revoked
 * yesterday would still carry yesterday's "verified").
 *
 * Exit codes: 0 — accepted (or nothing saved: not a failure of anything);
 * 1 — the platform refused the token; 2 — the platform could not be asked.
 */
async function status(): Promise<number> {
  const where = tokenHome();
  if (where === null) return 1;
  const config = readSaved(where);
  if (typeof config === "string") {
    console.error(`gabion auth --status: ${config}`);
    return 1;
  }
  if (config === null) {
    console.log("Not authenticated. Run: gabion auth");
    return 0;
  }

  if (where.kind === "wsl") console.log(`Saved in: ${describeTokenInside(where.home)}`);
  console.log(`Token:    ${maskToken(config.token)}`);
  console.log(`API:      ${config.apiUrl}`);

  const lastConfirmed =
    config.lastVerifiedAt === null ? "never confirmed by this machine" : `last confirmed ${config.lastVerifiedAt}`;
  try {
    const result = await verifyToken(config.token, config.apiUrl);
    if (!result.valid) {
      console.log(`Status:   rejected by the platform — ${result.reason} (${lastConfirmed})`);
      console.log("          Ask the project author for a new token, then: gabion auth");
      return 1;
    }
    console.log(`Status:   valid — holder ${result.name ?? "unknown"}`);
    const failure = persist(where, confirmedNow(config));
    if (failure !== null) {
      // The answer stands; only the record of it did not. Said, not hidden.
      console.error(`gabion auth --status: ${failure}`);
    }
    return 0;
  } catch (err: unknown) {
    console.log(
      `Status:   unknown — the platform could not be reached: ${err instanceof Error ? err.message : String(err)} (${lastConfirmed})`,
    );
    return 2;
  }
}
