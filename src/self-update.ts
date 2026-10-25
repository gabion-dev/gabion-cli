// src/self-update.ts
/**
 * `gabion self-update` — a newer runtime for the saved token, installed
 * the same way `gabion install` installs the first one (install.ts). The
 * runtime's installer prints the summary; this command, having accepted
 * the user's request, says what changed.
 */

import { confirmedNow, readAuthConfig, readInstalledVersion, writeAuthConfig } from "./config.js";
import { requestRuntimeDownload, ApiError, formatTokenError } from "./api-client.js";
import { downloadAndInstall } from "./install.js";
import { ensureGitIdentityBeforeInstall } from "./git-identity.js";
import type { DownloadResponse, RuntimeDownloadResult } from "./types.js";

export const SELF_UPDATE_USAGE =
  "Usage: gabion self-update\n\n" +
  "Asks the platform for a newer runtime than the installed one and installs it\n" +
  "the way gabion install does. Projects keep working: they use the runtime from\n" +
  "~/.gabion at every start.";

function isDownloadResponse(
  result: RuntimeDownloadResult,
): result is DownloadResponse {
  return "url" in result;
}

export async function runSelfUpdate(
  _args: readonly string[],
): Promise<number> {
  const auth = readAuthConfig();
  if (auth === null) {
    console.error(
      "Gabion requires an access token to check for updates.\n\n" +
      "  1. Get your token from the project author\n" +
      "  2. Authenticate:\n\n" +
      "       gabion auth\n\n" +
      "  3. Then re-run:\n\n" +
      "       gabion self-update\n",
    );
    return 1;
  }

  const versionInfo = readInstalledVersion();
  if (versionInfo === null) {
    console.error(
      "Gabion runtime is not installed.\n\n" +
      "  Install it first:\n\n" +
      "       gabion install\n",
    );
    return 1;
  }

  console.log(`gabion self-update — installed runtime ${versionInfo.version}, checking for a newer one\n`);

  // As at install: the runtime's installer refuses without git's identity,
  // and here the refusal comes before the download (git-identity.ts).
  const identityRefusal = await ensureGitIdentityBeforeInstall("self-update");
  if (identityRefusal !== null) {
    console.error(identityRefusal);
    return 1;
  }

  let result: RuntimeDownloadResult;
  try {
    result = await requestRuntimeDownload(
      auth.token,
      versionInfo.version,
      auth.apiUrl,
    );
  } catch (err: unknown) {
    if (err instanceof ApiError && err.reason !== "") {
      console.error(`\n✖ ${formatTokenError(err)}`);
      return 1;
    }
    console.error(
      `gabion self-update: API request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }

  // The platform answered the token: a confirmation, recorded as such
  // (config.ts) — `gabion auth --status` shows it when the platform
  // cannot be asked.
  writeAuthConfig(confirmedNow(auth));

  if (!isDownloadResponse(result)) {
    console.log("Already running the latest version.");
    return 0;
  }

  console.log(`New version available: ${result.version}\n`);
  const code = await downloadAndInstall(result, "self-update");
  if (code === 0) {
    console.log(`\n  Updated the runtime from ${versionInfo.version} to ${result.version}.\n`);
  }
  return code;
}
