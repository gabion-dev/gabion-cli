// src/self-update.ts

import { readAuthConfig, readInstalledVersion } from "./config.js";
import { requestRuntimeDownload, ApiError, formatTokenError } from "./api-client.js";
import { downloadAndInstall } from "./install.js";
import type { DownloadResponse, RuntimeDownloadResult } from "./types.js";

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
      "       gabion auth YOUR_TOKEN\n\n" +
      "  3. Then re-run:\n\n" +
      "       gabion self-update",
    );
    return 1;
  }

  const versionInfo = readInstalledVersion();
  if (versionInfo === null) {
    console.error(
      "Gabion runtime is not installed.\n\n" +
      "  Install it first:\n\n" +
      "       gabion install",
    );
    return 1;
  }

  console.log(`Current version: ${versionInfo.version}`);
  console.log("Checking for updates...\n");

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
      `API request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }

  if (!isDownloadResponse(result)) {
    console.log("Already running the latest version.");
    return 0;
  }

  console.log(`New version available: ${result.version}`);
  return downloadAndInstall(result);
}