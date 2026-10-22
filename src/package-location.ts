// src/package-location.ts
/**
 * Where this CLI's own package lies on disk, and whether it is the copy
 * `gabion install` run in Windows placed inside a WSL distribution.
 *
 * The npm-installed package resolves its files relative to this module
 * (dist/ beside package.json). The copy inside a distribution has the same
 * layout under ~/.gabion/thin-cli and runs on the Node.js the installer
 * brought, through the ~/.local/bin/gabion wrapper; it is recognised by
 * its location, because its lifecycle differs — it is replaced by the
 * Windows side, never by npm.
 */

import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { GABION_HOME, WSL_THIN_CLI_DIR_NAME } from "./constants.js";

/** Root of this CLI's package: the directory holding package.json and dist/. */
export function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

/** True when this process runs the copy placed inside a WSL distribution by the Windows installer. */
export function isWslCopy(): boolean {
  return packageRoot() === join(GABION_HOME, WSL_THIN_CLI_DIR_NAME);
}
