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

export async function runAuth(args: readonly string[]): Promise<number> {
  if (args.includes("--revoke")) {
    removeAuthConfig();
    console.log("Token removed.");
    return 0;
  }

  if (args.includes("--status")) {
    return printStatus();
  }

  const token = args[0];
  if (token === undefined || token === "") {
    console.error("Usage: gabion auth <token>");
    console.error("       gabion auth --status");
    console.error("       gabion auth --revoke");
    return 1;
  }

  if (!token.startsWith(TOKEN_PREFIX) || token.length < MIN_TOKEN_LENGTH) {
    console.error(
      `Invalid token format. Tokens start with "${TOKEN_PREFIX}" and are at least ${String(MIN_TOKEN_LENGTH)} characters.`,
    );
    return 1;
  }

  console.log("Verifying token...");

  try {
    const result = await verifyToken(token);
    if (!result.valid) {
      console.error(`Token rejected: ${result.reason ?? "unknown reason"}`);
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
    console.log("Not authenticated. Run: gabion auth <token>");
    return 0;
  }

  const masked = `${config.token.slice(0, 8)}${"*".repeat(8)}`;
  console.log(`Token:    ${masked}`);
  console.log(`API:      ${config.apiUrl}`);
  if (config.lastVerifiedAt !== null) {
    console.log(`Verified: ${config.lastVerifiedAt}`);
  }
  return 0;
}