// src/constants.ts

import { homedir } from "os";
import { join } from "path";

export const DEFAULT_API_URL = "https://api.gabion.dev";

// Deliberately homedir()-anchored on every platform (no %APPDATA%/XDG
// split) — mirrors runtime-paths.ts in the runtime; change both or neither.
export const GABION_HOME = join(homedir(), ".gabion");

export const AUTH_CONFIG_PATH = join(GABION_HOME, "auth.json");

export const VERSION_JSON_PATH = join(GABION_HOME, "version.json");

export const RUNTIME_DIR = join(GABION_HOME, "runtime");

/**
 * The CLI entry of the installed runtime: the loader of its bytecode,
 * run on the pinned Node (pinned-node.ts). Mirrors the "cli/gabion"
 * entry of the runtime's launch owner (framework/config/runtime-entries.ts).
 */
export const CLI_ENTRY = join(RUNTIME_DIR, "cli", "gabion.cjs");

export const ENGINES_DIR = join(GABION_HOME, ".engines");

export const TEMPLATE_DIR = join(GABION_HOME, "template");

export const INSTANCES_JSON_PATH = join(GABION_HOME, "instances.json");

export const TOKEN_PREFIX = "gbt_";

export const MIN_TOKEN_LENGTH = 16;

export const MIN_NODE_MAJOR = 18;

export const ARCHIVE_PREFIX = "gabion-runtime";

/** Source engine directories included in the runtime archive. */
export const GRADLE_SOURCE_ENGINES: readonly string[] = [
  "analysis-server",
  "postgres-server",
];

export const HEADLESS_ENGINE = "headless-browser-server";