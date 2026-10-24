// src/constants.ts

import { homedir } from "os";
import { join } from "path";

export const DEFAULT_API_URL = "https://api.gabion.dev";

/** Name of the Gabion home directory inside the user's home, on every platform. */
export const GABION_HOME_DIR_NAME = ".gabion";

// Deliberately homedir()-anchored on every platform (no %APPDATA%/XDG
// split) — mirrors runtime-paths.ts in the runtime; change both or neither.
export const GABION_HOME = join(homedir(), GABION_HOME_DIR_NAME);

export const AUTH_CONFIG_PATH = join(GABION_HOME, "auth.json");

export const VERSION_JSON_PATH = join(GABION_HOME, "version.json");

export const RUNTIME_DIR = join(GABION_HOME, "runtime");

/**
 * Where a new runtime is prepared beside the installed one, and where the
 * previous one waits for removal during the switch (install.ts). Mirror
 * of the runtime's STAGED_RUNTIME_DIR_NAME and RETIRED_RUNTIME_DIR_NAME
 * (formwork/shared/runtime-replacement.ts) — change both or neither.
 */
export const STAGED_RUNTIME_DIR = join(GABION_HOME, "runtime.new");
export const RETIRED_RUNTIME_DIR = join(GABION_HOME, "runtime.old");

/**
 * The CLI entry of the installed runtime: the loader of its bytecode,
 * run on the pinned Node (pinned-node.ts). Mirrors the "cli/gabion"
 * entry of the runtime's launch owner (formwork/config/runtime-entries.ts).
 */
export const CLI_ENTRY = join(RUNTIME_DIR, "cli", "gabion.cjs");

export const ENGINES_DIR = join(GABION_HOME, ".engines");

export const TEMPLATE_DIR = join(GABION_HOME, "template");

/**
 * The template's compiled classes as a Gradle build cache entry, laid into
 * the stand's cache by `gabion init`. Mirror of the runtime's
 * templateBuildCacheDir() (formwork/config/stand-gradle.ts) — change both
 * or neither.
 */
export const TEMPLATE_BUILD_CACHE_DIR = join(GABION_HOME, "template-build-cache");

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

// ==========================================
// Installation from Windows into a WSL distribution (windows-install.ts)
// ==========================================
//
// `gabion install` run in Windows installs Gabion inside a WSL 2
// distribution, where the developer has no Node.js of their own yet. The
// installer brings one — for the copy of this CLI it places there and for
// the developer's projects, which run `npm install` and the type
// generation on the Node found in PATH. Both live under the Linux
// ~/.gabion and survive `gabion uninstall`, exactly as the npm-installed
// CLI and the developer's own Node survive it on Linux.

/**
 * The Node.js release installed inside the distribution for the CLI copy
 * and the developer's projects: the active LTS line at the time of this
 * CLI release. Bumped with the CLI; the runtime keeps its own pinned Node
 * (named by the archive) beside it and never runs on this one.
 */
export const WSL_NODE_VERSION = "24.22.1";

/** Directory name under ~/.gabion of the Node.js brought for the developer. */
export const WSL_NODEJS_DIR_NAME = "nodejs";

/** Directory name under ~/.gabion of the copy of this CLI inside the distribution. */
export const WSL_THIN_CLI_DIR_NAME = "thin-cli";

/**
 * Entries of ~/.gabion that `gabion uninstall` keeps: the token (it is not
 * part of the installation) and what the Windows installer brought for the
 * developer — the CLI copy and its Node.js, the Linux counterparts of the
 * npm-installed CLI and the developer's own Node, which uninstall never
 * touched on Linux either.
 */
export const UNINSTALL_PRESERVED_ENTRIES: ReadonlySet<string> = new Set([
  "auth.json",
  WSL_THIN_CLI_DIR_NAME,
  WSL_NODEJS_DIR_NAME,
]);

/**
 * Windows side only: where `gabion install` put Gabion — the distribution
 * and its Linux user (wsl-gabion-home.ts). Written by the installation,
 * read by `gabion auth` and by the next `gabion install`, which go to the
 * distribution Gabion is in, not to whichever is the default by then.
 */
export const WSL_HOME_RECORD_PATH = join(GABION_HOME, "wsl-home.json");

/**
 * Hidden flag of `gabion install`: the command was accepted by this CLI
 * running in Windows, which drives the installation inside the
 * distribution and prints the next step itself. Never shown in help.
 */
export const FROM_WINDOWS_FLAG = "--from-windows";
