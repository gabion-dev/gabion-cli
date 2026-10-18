// src/archive-fetch.ts
//
// Fetching an archive and getting it onto disk: download with progress,
// checksum verification, extraction with the system tar. Shared by the
// runtime download and the pinned Node download — one implementation of
// "fetch a tar.gz and trust it only after its checksum matches".

import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { runExternal, describeRunFailure } from "./run-external.js";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${String(response.status)} (${url})`);
  }

  const totalStr = response.headers.get("content-length");
  const totalBytes = totalStr !== null ? parseInt(totalStr, 10) : 0;
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new Error("No response body");
  }

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    receivedBytes += value.length;

    if (totalBytes > 0) {
      const pct = Math.round((receivedBytes / totalBytes) * 100);
      process.stdout.write(
        `\r\x1B[K   Downloading... ${String(pct)}% (${formatBytes(receivedBytes)} / ${formatBytes(totalBytes)})`,
      );
    } else {
      process.stdout.write(
        `\r\x1B[K   Downloading... ${formatBytes(receivedBytes)}`,
      );
    }
  }
  process.stdout.write("\n");

  writeFileSync(destPath, Buffer.concat(chunks));
}

/** SHA-256 of a file, hex. */
export function sha256OfFile(filePath: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

export function verifySha256(filePath: string, expected: string): void {
  const actual = sha256OfFile(filePath);
  if (actual !== expected) {
    throw new Error(
      `SHA-256 mismatch: expected ${expected}, got ${actual}`,
    );
  }
}

/**
 * Extract a tar.gz archive with the system tar (present on Linux and
 * macOS; tar is a real executable, no shim mode). The failure reason
 * (spawn error, exit status, or signal) is part of the thrown message —
 * a child's error channel never ends in a generic string.
 */
export function extractTarGz(archivePath: string, destDir: string): void {
  const res = runExternal("tar", ["-xzf", archivePath, "-C", destDir], {
    stdio: "inherit",
  });
  if (!res.ok) {
    throw new Error(`tar extraction failed: ${describeRunFailure("tar", res)}`);
  }
}
