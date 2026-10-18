// src/pinned-node.ts
//
// The Node release the installed runtime runs on.
//
// The runtime arrives as V8 bytecode, and bytecode runs only on the exact
// V8 that compiled it. The archive names that release in its version.json
// ("node"); this module installs it to ~/.gabion/.engines/node before the
// thin CLI hands control to the runtime for the first time, and every
// later launch of the runtime — delegation of a command, the finalizing
// install step — uses this binary, never the Node the thin CLI itself
// happens to run on.
//
// Direct addresses on nodejs.org/dist, checked against the release's
// SHASUMS256.txt before extraction. A stamp file records the installed
// release so a rerun with the same release downloads nothing.
//
// MIRROR NOTICE: the runtime's own downloader (framework/setup/
// download-node.ts) performs the same installation for `gabion install`
// run from a repository checkout. The two cannot share code — the thin
// CLI cannot import a runtime it has not yet got running. Change both or
// neither.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { ENGINES_DIR } from "./constants.js";
import { downloadFile, sha256OfFile, extractTarGz } from "./archive-fetch.js";

const DIST_BASE = "https://nodejs.org/dist";
const STAMP_FILENAME = ".installed-version";

/** Directory of the pinned Node; mirrors pinnedNodeDir() in the runtime. */
export const PINNED_NODE_DIR = join(ENGINES_DIR, "node");

/** The pinned Node binary; mirrors pinnedNodeBinary() in the runtime. */
export const PINNED_NODE_BINARY = join(PINNED_NODE_DIR, "bin", "node");

function platformArchiveName(version: string): string {
  if (process.platform !== "linux" && process.platform !== "darwin") {
    throw new Error(
      `${process.platform} is not a supported platform (Linux, WSL and macOS are)`,
    );
  }
  if (process.arch !== "x64" && process.arch !== "arm64") {
    throw new Error(`${process.arch} is not a supported architecture`);
  }
  return `node-v${version}-${process.platform}-${process.arch}.tar.gz`;
}

async function publishedSha256(version: string, archive: string): Promise<string> {
  const url = `${DIST_BASE}/v${version}/SHASUMS256.txt`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`SHASUMS256.txt request failed: HTTP ${String(response.status)} (${url})`);
  }
  for (const line of (await response.text()).split("\n")) {
    const [sum, name] = line.trim().split(/\s+/);
    if (name === archive && sum !== undefined) return sum;
  }
  throw new Error(`${url} lists no checksum for ${archive}`);
}

function installedVersion(): string | null {
  const stamp = join(PINNED_NODE_DIR, STAMP_FILENAME);
  if (!existsSync(stamp) || !existsSync(PINNED_NODE_BINARY)) return null;
  return readFileSync(stamp, "utf-8").trim();
}

/**
 * Install the given Node release unless it is already installed. Returns
 * the binary path. Throws with the concrete reason on any failure — a
 * runtime without its Node cannot run, so there is nothing to degrade to.
 */
export async function ensurePinnedNode(version: string): Promise<string> {
  if (installedVersion() === version) {
    console.log(`   Node ${version} already installed`);
    return PINNED_NODE_BINARY;
  }

  const archive = platformArchiveName(version);
  const parent = dirname(PINNED_NODE_DIR);
  mkdirSync(parent, { recursive: true });
  const archivePath = join(parent, archive);
  const extractDir = join(parent, "node-extract");

  console.log(`   Node ${version} (${process.platform}/${process.arch})`);
  const expected = await publishedSha256(version, archive);
  await downloadFile(`${DIST_BASE}/v${version}/${archive}`, archivePath);
  const actual = sha256OfFile(archivePath);
  if (actual !== expected) {
    rmSync(archivePath, { force: true });
    throw new Error(`${archive}: SHA-256 ${actual} does not match the published ${expected}`);
  }

  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  extractTarGz(archivePath, extractDir);
  rmSync(archivePath, { force: true });

  const [topLevel, ...others] = readdirSync(extractDir);
  if (topLevel === undefined || others.length > 0) {
    throw new Error(`${archive} did not extract to a single top-level directory`);
  }
  rmSync(PINNED_NODE_DIR, { recursive: true, force: true });
  renameSync(join(extractDir, topLevel), PINNED_NODE_DIR);
  rmSync(extractDir, { recursive: true, force: true });

  if (!existsSync(PINNED_NODE_BINARY)) {
    throw new Error(`Node binary not found after extraction: ${PINNED_NODE_BINARY}`);
  }
  writeFileSync(join(PINNED_NODE_DIR, STAMP_FILENAME), version, "utf-8");
  console.log(`   Node ${version} installed: ${PINNED_NODE_BINARY}`);
  return PINNED_NODE_BINARY;
}
