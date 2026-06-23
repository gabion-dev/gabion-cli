// src/self-update.ts

import { readAuthConfig, readInstalledVersion } from "./config.js";
import { requestRuntimeDownload } from "./api-client.js";
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
    console.error("Not authenticated. Run: gabion auth <token>");
    return 1;
  }

  const versionInfo = readInstalledVersion();
  if (versionInfo === null) {
    console.error("Gabion runtime not installed. Run: gabion install");
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