// src/wsl-provision.ts
/**
 * The script that puts Gabion's prerequisites into a WSL distribution for
 * one Linux user: Node.js for the developer and for the copy of this CLI,
 * the CLI copy itself, the `gabion` command, and the access token. Built
 * in Windows from this CLI's own files, run inside through
 * `wsl.exe --exec bash -s` with the script on stdin — one artifact, every
 * action a Linux action with Linux tools (curl, sha256sum, tar, base64;
 * all in the Ubuntu image WSL installs).
 *
 * Why the CLI is copied, not installed with npm: there is no npm inside
 * yet; the Node.js brought along would have to be in PATH for npm's
 * shebang; and a copy is the same release as the CLI driving the
 * installation by construction — including a release never published,
 * which is what a trial installation runs.
 *
 * Why Node.js is brought at all when the runtime has its own: the
 * developer's projects run `npm install` and the type generation on the
 * Node found in PATH, and a fresh distribution has none — its PATH shows
 * only Windows's npm through interop, which installs into Windows. The
 * release is exposed as node, npm and npx in ~/.local/bin, which the
 * Ubuntu image's login shell puts on PATH when the directory exists — no
 * shell profile is edited — unless the login shell already resolves a
 * Linux node: a developer's own Node is left alone.
 *
 * Idempotent: the release is skipped when its stamp matches; the copy,
 * the links and the token are rewritten.
 */

import { readdirSync, readFileSync } from "fs";
import { join, sep } from "path";
import {
  GABION_HOME_DIR_NAME,
  WSL_NODEJS_DIR_NAME,
  WSL_NODE_VERSION,
  WSL_THIN_CLI_DIR_NAME,
} from "./constants.js";
import { NODE_SHASUMS_FILENAME, nodeArchiveName, nodeDistUrl } from "./pinned-node.js";

/** Heredoc delimiter; base64 text cannot contain it. */
const HEREDOC = "GABION_FILE";

/** Files of this package that the copy inside the distribution consists of. */
const PACKAGE_ROOT_FILES: readonly string[] = ["package.json", "README.md", "LICENSE"];
const PACKAGE_CODE_DIR = "dist";

export interface ProvisioningInput {
  /** The distribution's architecture — the Windows one, which WSL shares. */
  readonly arch: "x64" | "arm64";
  /** The content of auth.json, serialized by its owner (config.ts). */
  readonly authJson: string;
  /** Root of this CLI's package, copied inside. */
  readonly packageRoot: string;
}

/** Linux-side paths, relative to the user's home, as the script spells them. */
export const WSL_PATHS = {
  gabionHome: `$HOME/${GABION_HOME_DIR_NAME}`,
  nodejsDir: `$HOME/${GABION_HOME_DIR_NAME}/${WSL_NODEJS_DIR_NAME}`,
  thinCliDir: `$HOME/${GABION_HOME_DIR_NAME}/${WSL_THIN_CLI_DIR_NAME}`,
  binDir: "$HOME/.local/bin",
} as const;

/** The gabion command inside: this CLI's entry on the Node.js the installer brought. */
export const WSL_GABION_WRAPPER = `${WSL_PATHS.binDir}/gabion`;

function* walk(root: string, dir: string): Generator<string> {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) yield* walk(root, path);
    else if (entry.isFile()) yield path;
  }
}

/** Relative paths (with "/") of every file the copy consists of. */
function packageFiles(packageRoot: string): readonly string[] {
  const files: string[] = [];
  for (const name of PACKAGE_ROOT_FILES) {
    try {
      readFileSync(join(packageRoot, name));
      files.push(name);
    } catch {
      // README and LICENSE are part of the published package; a checkout
      // without one of them still works — only package.json and dist/
      // are needed to run.
      if (name === "package.json") throw new Error(`${join(packageRoot, name)} is missing`);
    }
  }
  for (const path of walk(packageRoot, PACKAGE_CODE_DIR)) {
    files.push(path.split(sep).join("/"));
  }
  return files;
}

function writeFileLines(target: string, content: Buffer): string {
  return [`base64 -d > "${target}" <<'${HEREDOC}'`, content.toString("base64"), HEREDOC].join("\n");
}

/** Shell-quote a string for a single-quoted literal. */
function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildProvisioningScript(input: ProvisioningInput): string {
  const archive = nodeArchiveName("linux", input.arch, WSL_NODE_VERSION);
  const lines: string[] = [
    "#!/bin/bash",
    "set -euo pipefail",
    "",
    `gabion_home="${WSL_PATHS.gabionHome}"`,
    `nodejs_dir="${WSL_PATHS.nodejsDir}"`,
    `cli_dir="${WSL_PATHS.thinCliDir}"`,
    `bin_dir="${WSL_PATHS.binDir}"`,
    `node_version=${quote(WSL_NODE_VERSION)}`,
    `archive=${quote(archive)}`,
    `archive_url=${quote(nodeDistUrl(WSL_NODE_VERSION, archive))}`,
    `shasums_url=${quote(nodeDistUrl(WSL_NODE_VERSION, NODE_SHASUMS_FILENAME))}`,
    "",
    'mkdir -p "$gabion_home" "$bin_dir"',
    "",
    "# Node.js for the developer and for the CLI copy, checked against the release's published checksums.",
    'stamp="$nodejs_dir/.installed-version"',
    'if [ -x "$nodejs_dir/bin/node" ] && [ "$(cat "$stamp" 2>/dev/null)" = "$node_version" ]; then',
    '  echo "   Node.js $node_version already in $nodejs_dir"',
    "else",
    `  echo "   Downloading Node.js $node_version (linux/${input.arch}) from nodejs.org"`,
    '  work="$(mktemp -d)"',
    '  curl -fL --progress-bar -o "$work/$archive" "$archive_url"',
    `  curl -fsSL -o "$work/${NODE_SHASUMS_FILENAME}" "$shasums_url"`,
    `  if ! awk -v name="$archive" '$2 == name' "$work/${NODE_SHASUMS_FILENAME}" | grep -q .; then`,
    `    echo "${NODE_SHASUMS_FILENAME} lists no checksum for $archive" >&2`,
    "    exit 1",
    "  fi",
    `  (cd "$work" && awk -v name="$archive" '$2 == name' ${NODE_SHASUMS_FILENAME} | sha256sum --check --quiet -)`,
    '  rm -rf "$nodejs_dir"',
    '  mkdir -p "$nodejs_dir"',
    '  tar -xzf "$work/$archive" -C "$nodejs_dir" --strip-components=1',
    '  rm -rf "$work"',
    '  "$nodejs_dir/bin/node" --version > /dev/null',
    '  printf \'%s\' "$node_version" > "$stamp"',
    '  echo "   Node.js $node_version installed in $nodejs_dir"',
    "fi",
    "",
    "# node, npm and npx for the developer's shell — unless a Linux node is already there.",
    "existing=\"$(bash -lc 'command -v node' 2>/dev/null || true)\"",
    'case "$existing" in',
    '  ""|/mnt/*)',
    '    ln -sfn "$nodejs_dir/bin/node" "$bin_dir/node"',
    '    ln -sfn "$nodejs_dir/bin/npm" "$bin_dir/npm"',
    '    ln -sfn "$nodejs_dir/bin/npx" "$bin_dir/npx"',
    '    echo "   node, npm and npx: $bin_dir (Node.js $node_version)"',
    "    ;;",
    "  *)",
    '    echo "   Your shell already has node ($existing) — left as is"',
    "    ;;",
    "esac",
    "",
    "# The CLI copy: this very release of the gabion package.",
    'rm -rf "$cli_dir"',
  ];

  const directories = new Set<string>();
  const files = packageFiles(input.packageRoot);
  for (const file of files) {
    const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
    directories.add(dir);
  }
  lines.push(
    `mkdir -p ${[...directories].map((dir) => `"$cli_dir${dir === "" ? "" : `/${dir}`}"`).join(" ")}`,
  );
  for (const file of files) {
    lines.push(writeFileLines(`$cli_dir/${file}`, readFileSync(join(input.packageRoot, file))));
  }
  lines.push(`echo "   Gabion CLI copied to $cli_dir"`);

  lines.push(
    "",
    "# The gabion command: the copy on the Node.js above, never on whatever node PATH has.",
    `cat > "${WSL_GABION_WRAPPER}" <<'${HEREDOC}'`,
    "#!/bin/sh",
    "# Written by `gabion install` run in Windows: the Gabion CLI inside this",
    "# distribution, on the Node.js the installer brought. Both are replaced by",
    "# running `gabion install` in Windows again.",
    `exec "${WSL_PATHS.nodejsDir}/bin/node" "${WSL_PATHS.thinCliDir}/${PACKAGE_CODE_DIR}/index.js" "$@"`,
    HEREDOC,
    `chmod 755 "${WSL_GABION_WRAPPER}"`,
    `echo "   gabion command: ${WSL_GABION_WRAPPER}"`,
    "",
    "# The access token, readable by this user only.",
    "umask 077",
    writeFileLines('$gabion_home/auth.json', Buffer.from(input.authJson, "utf-8")),
    'echo "   Access token saved in $gabion_home/auth.json"',
    "",
  );
  return `${lines.join("\n")}\n`;
}
