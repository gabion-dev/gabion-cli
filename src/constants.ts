// src/constants.ts

import { homedir } from "os";
import { join } from "path";

export const DEFAULT_API_URL = "https://api.gabion.dev";

export const GABION_HOME = join(homedir(), ".gabion");

export const AUTH_CONFIG_PATH = join(GABION_HOME, "auth.json");

export const VERSION_JSON_PATH = join(GABION_HOME, "version.json");

export const RUNTIME_DIR = join(GABION_HOME, "runtime");

export const ENGINES_DIR = join(GABION_HOME, ".engines");

export const TEMPLATE_DIR = join(GABION_HOME, "template");

export const BIN_DIR = join(GABION_HOME, "bin");

export const NODE_MODULES_LINK = join(GABION_HOME, "node_modules");

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