// src/auth.ts

import { verifyToken } from "./api-client.js";
import {
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
import { readHiddenLine, readStandardInput } from "./secret-input.js";

const STDIN_FLAG = "--stdin";

export const AUTH_USAGE =
  "Usage: gabion auth            asks for the token; what you paste is not shown\n" +
  `       gabion auth ${STDIN_FLAG}    reads the token from standard input (scripts, CI)\n` +
  "       gabion auth --status\n" +
  "       gabion auth --revoke\n\n" +
  "Verifies the access token with the platform and saves it in ~/.gabion/auth.json;\n" +
  "gabion install and self-update download the runtime with it. On Windows the\n" +
  "token is carried into the WSL distribution by gabion install.\n\n" +
  "The token is never taken on the command line: there it would stay on the\n" +
  "screen, in the shell's history file and in the process list.";

/** The first characters of a token and a fixed mask — enough to tell tokens apart, not to use one. */
function maskToken(token: string): string {
  return `${token.slice(0, 8)}${"*".repeat(8)}`;
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
  return readHiddenLine("Paste your access token and press Enter (it is not shown): ");
}

export async function runAuth(args: readonly string[]): Promise<number> {
  if (args.includes("--revoke")) {
    removeAuthConfig();
    console.log("Token removed.");
    return 0;
  }

  if (args.includes("--status")) {
    return printStatus();
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

    writeAuthConfig({
      token,
      apiUrl: DEFAULT_API_URL,
      lastVerifiedAt: new Date().toISOString(),
    });

    console.log(`Authenticated as ${result.name ?? "unknown"}.`);
    console.log(`Token saved to ${AUTH_CONFIG_PATH}`);
    return 0;
  } catch (err: unknown) {
    console.error(
      `Failed to verify token: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
}

function printStatus(): number {
  const config = readAuthConfig();
  if (config === null) {
    console.log("Not authenticated. Run: gabion auth");
    return 0;
  }

  console.log(`Token:    ${maskToken(config.token)}`);
  console.log(`API:      ${config.apiUrl}`);
  if (config.lastVerifiedAt !== null) {
    console.log(`Verified: ${config.lastVerifiedAt}`);
  }
  return 0;
}
