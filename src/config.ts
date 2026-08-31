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

export function readAuthConfig(): AuthConfig | null {
  if (!existsSync(AUTH_CONFIG_PATH)) {
    return null;
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(AUTH_CONFIG_PATH, "utf-8"));
    if (typeof raw !== "object" || raw === null) {
      return null;
    }
    const obj = raw as Record<string, unknown>;
    if (typeof obj["token"] !== "string" || obj["token"] === "") {
      return null;
    }
    return {
      token: obj["token"],
      apiUrl:
        typeof obj["apiUrl"] === "string" ? obj["apiUrl"] : DEFAULT_API_URL,
      lastVerifiedAt:
        typeof obj["lastVerifiedAt"] === "string"
          ? obj["lastVerifiedAt"]
          : null,
    };
  } catch {
    return null;
  }
}

export function writeAuthConfig(config: AuthConfig): void {
  mkdirSync(dirname(AUTH_CONFIG_PATH), { recursive: true });
  const payload = {
    token: config.token,
    apiUrl: config.apiUrl,
    lastVerifiedAt: config.lastVerifiedAt,
  };
  writeFileSync(
    AUTH_CONFIG_PATH,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf-8",
  );
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