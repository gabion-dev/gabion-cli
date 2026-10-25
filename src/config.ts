// src/config.ts

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { dirname } from "path";
import {
  AUTH_CONFIG_PATH,
  DEFAULT_API_URL,
  GABION_HOME,
  VERSION_JSON_PATH,
} from "./constants.js";
import type { AuthConfig, VersionInfo } from "./types.js";

/**
 * The content of an auth.json as a config. `where` names the file in the
 * error. A file that is there but holds no token is an error, not "not
 * authenticated": read as absent, a damaged file would send the user to
 * `gabion auth` without saying why the saved token stopped counting.
 */
export function parseAuthConfig(text: string, where: string): AuthConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err: unknown) {
    throw new Error(
      `${where} is not valid JSON (${err instanceof Error ? err.message : String(err)}) — ` +
        "save the token again with: gabion auth",
    );
  }
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`${where} is not a token file — save the token again with: gabion auth`);
  }
  const obj = raw as Record<string, unknown>;
  const token = obj["token"];
  if (typeof token !== "string" || token === "") {
    throw new Error(`${where} holds no token — save the token again with: gabion auth`);
  }
  return {
    token,
    apiUrl: typeof obj["apiUrl"] === "string" ? obj["apiUrl"] : DEFAULT_API_URL,
    lastVerifiedAt: typeof obj["lastVerifiedAt"] === "string" ? obj["lastVerifiedAt"] : null,
  };
}

/**
 * The config as it is after the platform accepted the token just now: the
 * one place the confirmation time is taken. Every command that gets the
 * platform's acceptance (gabion auth, auth --status, install,
 * self-update) records it through here, so "last confirmed" always means
 * the latest confirmation by any of them — never the date of one command.
 */
export function confirmedNow(config: AuthConfig): AuthConfig {
  return { ...config, lastVerifiedAt: new Date().toISOString() };
}

/** The saved token of this machine's ~/.gabion, or null when none is saved. */
export function readAuthConfig(): AuthConfig | null {
  if (!existsSync(AUTH_CONFIG_PATH)) {
    return null;
  }
  return parseAuthConfig(readFileSync(AUTH_CONFIG_PATH, "utf-8"), AUTH_CONFIG_PATH);
}

/**
 * The content of auth.json for a config — the one serializer, whether the
 * file is written here or into a WSL distribution from Windows
 * (wsl-gabion-home.ts), where the same CLI reads it back.
 */
export function serializeAuthConfig(config: AuthConfig): string {
  const payload = {
    token: config.token,
    apiUrl: config.apiUrl,
    lastVerifiedAt: config.lastVerifiedAt,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function writeAuthConfig(config: AuthConfig): void {
  mkdirSync(dirname(AUTH_CONFIG_PATH), { recursive: true });
  writeFileSync(AUTH_CONFIG_PATH, serializeAuthConfig(config), "utf-8");
}

export function removeAuthConfig(): void {
  if (existsSync(AUTH_CONFIG_PATH)) {
    rmSync(AUTH_CONFIG_PATH);
  }
  // After uninstall the home directory survives only for auth.json;
  // revoking the token may leave it empty, and an empty ~/.gabion is a
  // contentless trace. rmdirSync refuses non-empty directories by
  // contract, so an installed runtime is never touched here.
  if (existsSync(GABION_HOME) && readdirSync(GABION_HOME).length === 0) {
    rmdirSync(GABION_HOME);
  }
}

export function readInstalledVersion(): VersionInfo | null {
  if (!existsSync(VERSION_JSON_PATH)) {
    return null;
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(VERSION_JSON_PATH, "utf-8"));
    if (typeof raw !== "object" || raw === null) {
      return null;
    }
    const obj = raw as Record<string, unknown>;
    if (typeof obj["version"] !== "string") {
      return null;
    }
    return {
      version: obj["version"],
      builtAt: typeof obj["builtAt"] === "string" ? obj["builtAt"] : "",
    };
  } catch {
    return null;
  }
}

export function ensureGabionHome(): void {
  mkdirSync(GABION_HOME, { recursive: true });
}