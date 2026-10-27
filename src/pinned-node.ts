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
// MIRROR NOTICE: the runtime's own downloader (formwork/setup/
// download-node.ts) performs the same installation for `gabion install`
// run from a repository checkout. The two cannot share code — the thin
// CLI cannot import a runtime it has not yet got running. Change both or
// neither.

import { spawnSync } from "child_process";
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

/** Where nodejs.org publishes every release and its checksum file. */
export const NODE_DIST_BASE = "https://nodejs.org/dist";

/** The name of the checksum file published beside every release's archives. */
export const NODE_SHASUMS_FILENAME = "SHASUMS256.txt";

const STAMP_FILENAME = ".installed-version";

/** Directory of the pinned Node; mirrors pinnedNodeDir() in the runtime. */
export const PINNED_NODE_DIR = join(ENGINES_DIR, "node");

/** The pinned Node binary; mirrors pinnedNodeBinary() in the runtime. */
export const PINNED_NODE_BINARY = join(PINNED_NODE_DIR, "bin", "node");

/**
 * npm as it ships inside a Node release: its command-line entry, run on
 * that very Node. The `bin/npm` link beside the binary resolves `node`
 * from PATH through its shebang, and the Node in PATH is whatever the
 * user has — or, inside WSL without a Linux Node, Windows's npm reached
 * through interop. Naming the entry and the Node explicitly keeps the
 * runtime's dependencies installed by the Node that will run them.
 */
export function npmCliOf(nodeDir: string): string {
  return join(nodeDir, "lib", "node_modules", "npm", "bin", "npm-cli.js");
}

/** The archive name as nodejs.org publishes it; tar.gz, which every system tar reads. */
export function nodeArchiveName(
  os: "linux" | "darwin",
  arch: "x64" | "arm64",
  version: string,
): string {
  return `node-v${version}-${os}-${arch}.tar.gz`;
}

/** The address of a release's file on nodejs.org. */
export function nodeDistUrl(version: string, file: string): string {
  return `${NODE_DIST_BASE}/v${version}/${file}`;
}

/**
 * The archive for this machine. Preflight admits only Linux and macOS on
 * x64 and arm64 to any command that gets here, so another platform is a
 * programming error, not a user condition.
 */
function platformArchiveName(version: string): string {
  const os = process.platform;
  const arch = process.arch;
  if ((os !== "linux" && os !== "darwin") || (arch !== "x64" && arch !== "arm64")) {
    throw new Error(
      `pinned Node requested on ${os}/${arch}, which preflight does not admit`,
    );
  }
  return nodeArchiveName(os, arch, version);
}

async function publishedSha256(version: string, archive: string): Promise<string> {
  const url = nodeDistUrl(version, NODE_SHASUMS_FILENAME);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${NODE_SHASUMS_FILENAME} request failed: HTTP ${String(response.status)} (${url})`);
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
 * Start the extracted Node once before trusting it. The release links
 * against system libraries its archive does not carry — libatomic.so.1 on
 * Linux among them — and a machine without one gets a binary that cannot
 * start: found here, with the library named, instead of as a failure of
 * the first runtime process. The stamp is written only after this passes,
 * so a rerun after installing the library downloads and checks again.
 */
function assertNodeStarts(binary: string, version: string): void {
  const run = spawnSync(binary, ["--version"], { encoding: "utf-8" });
  if (run.status === 0 && run.stdout.trim() === `v${version}`) return;
  const stderr = (run.stderr ?? "").trim();
  const missing = /error while loading shared libraries: (\S+?): cannot open shared object file/.exec(stderr)?.[1];
  if (missing !== undefined) {
    const debianHint = missing === "libatomic.so.1" ? " (Debian and Ubuntu: libatomic1)" : "";
    throw new Error(
      `Node ${version} cannot start: this system lacks the shared library ${missing}. ` +
        `Install the system package that provides it${debianHint}, then run the installation again.`,
    );
  }
  if (run.status === 0) {
    throw new Error(`The extracted Node reports ${run.stdout.trim()}, not v${version}`);
  }
  throw new Error(`Node ${version} does not start: ${run.error?.message ?? (stderr || `exit ${String(run.status)}`)}`);
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
  await downloadFile(nodeDistUrl(version, archive), archivePath);
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
  assertNodeStarts(PINNED_NODE_BINARY, version);
  writeFileSync(join(PINNED_NODE_DIR, STAMP_FILENAME), version, "utf-8");
  console.log(`   Node ${version} installed: ${PINNED_NODE_BINARY}`);
  return PINNED_NODE_BINARY;
}
