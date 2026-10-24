// src/install.ts
/**
 * `gabion install` — the runtime archive onto this machine.
 *
 * One installation runs as two processes, and the user sees two phases,
 * each with its own header and its own step counter:
 *
 *   Phase 1 (this CLI): the archive is downloaded, checked and unpacked,
 *   the Node release it was built for is installed, the runtime's
 *   dependencies go in — then control is handed to the runtime's own
 *   installer, which this CLI cannot contain (it is the artifact being
 *   installed) and whose step list this CLI does not know.
 *
 *   Phase 2 (the runtime, `install --post-download`): engines, the Java
 *   builds, the gateway, verification, the license. Its output is the
 *   runtime's own and streams through untouched — on macOS it asks the
 *   user questions, so it cannot be captured or re-numbered here.
 *
 * Every counter's total is derived from the list of steps the phase
 * performs, never written as a literal; steps a phase does not perform
 * are not printed as "skipped" — they belong to the other producer of the
 * same installation (the repository checkout), not to this one. The
 * summary line is the runtime's (it knows whether the license came); the
 * hint about the next action is printed by whoever accepted the command
 * — `install` says `gabion init`, `self-update` says what was updated,
 * and the Windows side, which drives an installation inside WSL, prints
 * the WSL-specific step itself.
 *
 * On Windows the command does not install here: Gabion runs inside WSL 2,
 * and the Windows side prepares the distribution and installs there
 * (windows-install.ts).
 *
 * Idempotent by construction: every step derives its work from the
 * filesystem (fresh temp dir, wipe-and-recopy of runtime/template,
 * version-stamped engine downloads inside phase 2). A rerun after any
 * failure redoes only real work — no step trusts a position in a previous
 * run.
 */

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readAuthConfig } from "./config.js";
import {
  requestRuntimeDownload,
  verifyToken,
  ApiError,
  formatTokenError,
  describeTokenRefusal,
} from "./api-client.js";
import { runExternal, describeRunFailure } from "./run-external.js";
import { downloadFile, verifySha256, extractTarGz } from "./archive-fetch.js";
import { ensurePinnedNode, npmCliOf, PINNED_NODE_DIR } from "./pinned-node.js";
import { installFromWindows } from "./windows-install.js";
import { approveRuntimeScripts } from "./runtime-manifest.js";
import { ensureGitIdentityBeforeInstall } from "./git-identity.js";
import {
  ARCHIVE_PREFIX,
  CLI_ENTRY,
  ENGINES_DIR,
  FROM_WINDOWS_FLAG,
  GABION_HOME,
  GRADLE_SOURCE_ENGINES,
  HEADLESS_ENGINE,
  RUNTIME_DIR,
  TEMPLATE_BUILD_CACHE_DIR,
  TEMPLATE_DIR,
  VERSION_JSON_PATH,
} from "./constants.js";
import type { DownloadResponse, InstallStep, RuntimeDownloadResult } from "./types.js";

/** The steps of phase 1, in order. The counter's total is this list's length. */
const PHASE_ONE_STEPS = [
  { id: "download", title: "Downloading the runtime archive" },
  { id: "checksum", title: "Verifying SHA-256 checksum" },
  { id: "extract", title: "Extracting archive" },
  { id: "pinned-node", title: "Installing the Node release the runtime runs on" },
  { id: "runtime-files", title: "Installing runtime files" },
  { id: "dependencies", title: "Installing runtime dependencies" },
  { id: "symlinks", title: "Creating workspace symlinks" },
  { id: "handover", title: "Handing over to the runtime's installer (phase 2)" },
] as const satisfies readonly InstallStep[];

type PhaseOneStepId = (typeof PHASE_ONE_STEPS)[number]["id"];

/** Print a step of phase 1 with its position in the list; the detail follows the title. */
function logStep(id: PhaseOneStepId, detail = ""): void {
  const index = PHASE_ONE_STEPS.findIndex((step) => step.id === id);
  const step = PHASE_ONE_STEPS[index];
  if (step === undefined) throw new Error(`"${id}" is not a step of phase 1`);
  console.log(
    `\n→ [${String(index + 1)}/${String(PHASE_ONE_STEPS.length)}] ${step.title}${detail === "" ? "" : ` ${detail}`}`,
  );
}

export const INSTALL_USAGE =
  "Usage: gabion install\n\n" +
  "Downloads the Gabion runtime for the saved access token (gabion auth)\n" +
  "and installs it under ~/.gabion: the archive and the Node.js release it runs\n" +
  "on, then — through the runtime's own installer — engines, verification and the\n" +
  "license for this machine. Running it again repeats only what is missing.\n\n" +
  "On Windows: prepares WSL 2 (installs it and a Linux distribution when absent,\n" +
  "creates the Linux user) and installs Gabion inside the distribution.";

function fail(commandName: string, message: string): number {
  console.error(`\ngabion ${commandName}: ${message}`);
  return 1;
}

function isDownloadResponse(
  result: RuntimeDownloadResult,
): result is DownloadResponse {
  return "url" in result;
}

/** The "node" release named by an archive's version.json, or null when absent. */
function readPinnedNodeVersion(versionJsonPath: string): string | null {
  if (!existsSync(versionJsonPath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(versionJsonPath, "utf-8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const node = (parsed as Record<string, unknown>)["node"];
  return typeof node === "string" && node !== "" ? node : null;
}

/**
 * Entries of a Gradle engine directory that the machine produces by
 * building it and that never travel with its sources: Gradle's build
 * output (the jar and its record among it), Gradle's own history of the
 * build, and the class output an editor's Java support writes. The
 * archive ships the engines without them.
 */
const JAVA_ENGINE_BUILD_STATE: readonly string[] = ["build", ".gradle", "bin"];

/**
 * Remove an engine's sources and keep what building them produced, so
 * that another copy of the sources can be laid in. An update replaces
 * the sources wholesale — a file the new version no longer has must not
 * linger, Gradle would compile it — but the jar stays: phase 2 judges it
 * by its record against the new sources, and unchanged sources then cost
 * no build at all. Wiping the directory whole took the jar and its record
 * with it, so every update rebuilt both engines from scratch even when
 * not one source had changed. Gradle's history stays with the jar, so
 * sources that did change are recompiled incrementally.
 *
 * MIRROR NOTICE: this function and JAVA_ENGINE_BUILD_STATE are a copy of
 * the runtime's formwork/shared/java-engine-jar.ts — this CLI cannot
 * import the runtime it is installing. When changing either, change it
 * there too.
 */
function removeJavaEngineSources(engineDir: string): void {
  if (!existsSync(engineDir)) return;
  for (const name of readdirSync(engineDir)) {
    if (!JAVA_ENGINE_BUILD_STATE.includes(name)) {
      rmSync(join(engineDir, name), { recursive: true, force: true });
    }
  }
}

/**
 * Copy engine SOURCE code from the extracted archive into the installed
 * engines directory. Gradle source engines get their sources replaced
 * and keep their build state — phase 2 rebuilds a jar only when its
 * record no longer matches the sources. Headless source files are merged
 * with cpSync so binary artifacts (browser/, lib/) survive. Binary-only
 * engines (gitleaks, mailpit, etc.) are not in the archive and are
 * untouched.
 */
function copyEngineSourcesFromArchive(
  archiveEngines: string,
  destEngines: string,
): void {
  if (!existsSync(archiveEngines)) return;
  mkdirSync(destEngines, { recursive: true });

  for (const engine of GRADLE_SOURCE_ENGINES) {
    const src = join(archiveEngines, engine);
    const dest = join(destEngines, engine);
    if (!existsSync(src)) continue;
    removeJavaEngineSources(dest);
    cpSync(src, dest, { recursive: true });
  }

  const headlessSrc = join(archiveEngines, HEADLESS_ENGINE);
  const headlessDest = join(destEngines, HEADLESS_ENGINE);
  if (existsSync(headlessSrc)) {
    mkdirSync(headlessDest, { recursive: true });
    cpSync(headlessSrc, headlessDest, { recursive: true, force: true });
  }
}

/**
 * Phase 1 and the handover to phase 2, shared by `gabion install` and
 * `gabion self-update`. `commandName` is the command the user typed — it
 * names the headers and the failure messages. Prints no hint about the
 * next action: that is the caller's, which knows what the user asked for.
 */
export async function downloadAndInstall(
  download: DownloadResponse,
  commandName: string,
): Promise<number> {
  const { version, url, sha256 } = download;

  console.log("Phase 1 of 2 — the runtime archive, its Node.js and dependencies");
  logStep("download", `v${version}`);
  const tempDir = mkdtempSync(join(tmpdir(), "gabion-"));

  try {
    const archiveName = `${ARCHIVE_PREFIX}-${version}.tar.gz`;
    const archivePath = join(tempDir, archiveName);
    await downloadFile(url, archivePath);

    logStep("checksum");
    verifySha256(archivePath, sha256);
    console.log("   Checksum OK");

    logStep("extract");
    extractTarGz(archivePath, tempDir);
    const archiveRoot = join(tempDir, `${ARCHIVE_PREFIX}-${version}`);

    if (!existsSync(join(archiveRoot, "runtime"))) {
      return fail(commandName, "archive missing runtime/ directory");
    }

    // The archive names the Node release its bytecode was compiled for;
    // an archive without it is from before closed builds and cannot be
    // run by this CLI at all.
    const pinnedNodeVersion = readPinnedNodeVersion(join(archiveRoot, "version.json"));
    if (pinnedNodeVersion === null) {
      return fail(
        commandName,
        'archive version.json names no "node" release — this runtime archive predates closed builds',
      );
    }

    logStep("pinned-node");
    const pinnedNode = await ensurePinnedNode(pinnedNodeVersion);

    logStep("runtime-files");
    mkdirSync(GABION_HOME, { recursive: true });

    if (existsSync(RUNTIME_DIR)) {
      rmSync(RUNTIME_DIR, { recursive: true, force: true });
    }
    cpSync(join(archiveRoot, "runtime"), RUNTIME_DIR, { recursive: true });

    copyEngineSourcesFromArchive(join(archiveRoot, ".engines"), ENGINES_DIR);

    // The template keeps its file timestamps: it carries generated types
    // and the API specification they came from, and the runtime decides
    // on first run whether they are current by comparing modification
    // times. tar restored the archive's times; a copy stamped with the
    // time of copying would make every new project regenerate types it
    // already has.
    const archiveTemplate = join(archiveRoot, "template");
    if (existsSync(archiveTemplate)) {
      if (existsSync(TEMPLATE_DIR)) {
        rmSync(TEMPLATE_DIR, { recursive: true, force: true });
      }
      cpSync(archiveTemplate, TEMPLATE_DIR, {
        recursive: true,
        preserveTimestamps: true,
      });
    }

    // The template's build cache travels with the template it was
    // compiled from: replaced together, so `gabion init` never lays the
    // classes of one release beside the sources of another.
    const archiveTemplateCache = join(archiveRoot, "template-build-cache");
    rmSync(TEMPLATE_BUILD_CACHE_DIR, { recursive: true, force: true });
    if (existsSync(archiveTemplateCache)) {
      cpSync(archiveTemplateCache, TEMPLATE_BUILD_CACHE_DIR, { recursive: true });
    }

    copyFileSync(join(archiveRoot, "version.json"), VERSION_JSON_PATH);

    // MIRROR NOTICE: this sequence (approveRuntimeScripts + npm install on
    // the pinned Node + node_modules junction; steps 6–7 here) also exists
    // in the runtime's own formwork/cli/commands/install.ts (repository
    // mode, step 5). The duplication is forced — the thin CLI cannot
    // import a runtime it is installing. When changing this sequence,
    // change it there too.
    logStep("dependencies");
    approveRuntimeScripts(RUNTIME_DIR);
    // npm of the pinned Node, run on the pinned Node: the dependencies are
    // installed by the Node that will run them, not by whatever npm PATH
    // has (inside WSL without a Linux Node, that is Windows's npm).
    const npmResult = runExternal(
      pinnedNode,
      [npmCliOf(PINNED_NODE_DIR), "install", "--omit=dev", "--no-fund", "--no-audit"],
      { cwd: RUNTIME_DIR, stdio: "inherit" },
    );
    if (!npmResult.ok) {
      return fail(
        commandName,
        `the runtime's dependencies did not install (${describeRunFailure("npm", npmResult)}) — see npm's messages above.\n` +
          `  After fixing the cause, run gabion ${commandName} again.`,
      );
    }

    logStep("symlinks");
    const topNodeModules = join(GABION_HOME, "node_modules");
    rmSync(topNodeModules, { recursive: true, force: true });
    symlinkSync(join(RUNTIME_DIR, "node_modules"), topNodeModules, "junction");

    logStep("handover");
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      GABION_ORIGINAL_CWD: process.cwd(),
    };
    // The runtime runs on its pinned Node, as bytecode behind the CLI
    // entry's loader — the same launch the delegation uses. Its output is
    // its own: phase 2 prints its header and counter.
    console.log("");
    const postResult = runExternal(
      pinnedNode,
      [CLI_ENTRY, "install", "--post-download"],
      { cwd: RUNTIME_DIR, stdio: "inherit", env },
    );
    if (!postResult.ok) {
      if (postResult.error !== null) {
        return fail(
          commandName,
          `the runtime's installer could not start: ${describeRunFailure("node", postResult)}`,
        );
      }
      return fail(
        commandName,
        `phase 2 stopped (${describeRunFailure("the runtime's installer", postResult)}) — see its messages above.\n` +
          `  After fixing the cause, run gabion ${commandName} again: it repeats only what is missing.`,
      );
    }
    return 0;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/** What to do next after an installation; printed by the command that accepted `install`. */
function printInstallHint(): void {
  console.log(
    "\n  To create a new project:\n\n" +
      "       gabion init my-project\n\n" +
      "  Or initialize in the current directory:\n\n" +
      "       gabion init\n",
  );
}

/**
 * The saved token as the platform sees it now: null when it is accepted,
 * otherwise what to tell the user. An unreachable platform is a problem
 * too — the installation downloads everything it installs.
 */
async function checkTokenBeforeWindowsInstall(token: string, apiUrl: string): Promise<string | null> {
  try {
    const result = await verifyToken(token, apiUrl);
    return result.valid ? null : describeTokenRefusal(result.reason);
  } catch (err: unknown) {
    if (err instanceof ApiError && err.reason !== "") return formatTokenError(err);
    return (
      `Could not check the access token with the platform: ${err instanceof Error ? err.message : String(err)}\n\n` +
      "  The installation downloads everything it installs; check the network and run gabion install again."
    );
  }
}

export async function runInstall(args: readonly string[]): Promise<number> {
  const fromWindows = args.includes(FROM_WINDOWS_FLAG);

  const auth = readAuthConfig();
  if (auth === null) {
    console.error(
      "Gabion requires an access token to download the runtime.\n\n" +
      "  1. Get your token from the project author\n" +
      "  2. Authenticate:\n\n" +
      "       gabion auth\n\n" +
      "  3. Then re-run:\n\n" +
      "       gabion install\n",
    );
    return 1;
  }

  if (process.platform === "win32") {
    // From Windows the token is first used inside the distribution, after
    // WSL, the distribution and its user are set up — minutes, and maybe a
    // restart, later. It is checked here, before anything changes, so a
    // token the platform refuses stops the run at once with its action.
    const tokenProblem = await checkTokenBeforeWindowsInstall(auth.token, auth.apiUrl);
    if (tokenProblem !== null) {
      console.error(`\n✖ ${tokenProblem}`);
      return 1;
    }
    return installFromWindows(auth);
  }

  console.log("gabion install — installing the Gabion runtime under ~/.gabion\n");

  // Git's identity before the download: the runtime's own installer
  // settles it too, but a refusal here costs nothing (git-identity.ts).
  const identityRefusal = await ensureGitIdentityBeforeInstall("install");
  if (identityRefusal !== null) {
    console.error(identityRefusal);
    return 1;
  }

  const currentVersion = null;

  let result: RuntimeDownloadResult;
  try {
    result = await requestRuntimeDownload(
      auth.token,
      currentVersion,
      auth.apiUrl,
    );
  } catch (err: unknown) {
    if (err instanceof ApiError && err.reason !== "") {
      console.error(`\n✖ ${formatTokenError(err)}`);
      return 1;
    }
    return fail(
      "install",
      `API request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!isDownloadResponse(result)) {
    console.log("Runtime is already up to date.");
    return 0;
  }

  const code = await downloadAndInstall(result, "install");
  // The Windows side that drives an installation inside WSL prints the
  // next step itself — the WSL-specific one.
  if (code === 0 && !fromWindows) printInstallHint();
  return code;
}
