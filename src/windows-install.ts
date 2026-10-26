// src/windows-install.ts
/**
 * `gabion install` run in Windows: Gabion works inside WSL 2 only, and
 * this command takes the machine from whatever state it is in to Gabion
 * installed inside a Linux distribution — without the user typing a Linux
 * command. The state is read afresh on every run, so after a restart (or
 * an interruption) the same command continues where the machine stands.
 *
 * The states, in the order a clean Windows passes through them:
 *
 *   1. WSL is not installed — the packaged wsl.exe is absent. The inbox
 *      stub's `wsl.exe --install --no-distribution` installs WSL and
 *      enables the Windows components. From a non-elevated process it
 *      prints "The requested operation requires elevation" and relaunches
 *      itself elevated — one Windows approval dialog (Yes/No for a user in
 *      the Administrators group; a standard user is asked for an
 *      administrator's password). The components need a restart, which
 *      the exit code does not reveal (it is 0 either way), so the restart
 *      is asked for by the state that follows: no distribution appears.
 *   2. WSL is installed, no distribution — `wsl.exe --install Ubuntu
 *      --no-launch` registers Ubuntu without elevation and without starting
 *      it. Before the restart it registers nothing and asks for the
 *      restart; the listing is read again to tell the two apart.
 *   3. The distribution runs on WSL 1 — refused with the one command that
 *      moves it to WSL 2 (the runtime's Node does not start on WSL 1).
 *   4. The distribution has no Linux user — its default user is root and
 *      no account with uid 1000 or above exists. WSL runs the
 *      distribution's own first-run setup only on a launch without a
 *      command; this installer runs that very program itself (its path is
 *      in /etc/wsl-distribution.conf, [oobe] command) as root with the
 *      console inherited, so the distribution asks for the name and the
 *      password in its own words. The setup records the default user in
 *      /etc/wsl.conf, but WSL takes the default user from its registry,
 *      which only `wsl.exe --manage <distribution> --set-default-user`
 *      writes outside a first launch — so that follows.
 *   5. The distribution has its user — git inside learns who commits
 *      (from Windows's git when it knows, else asked here: the process
 *      inside has no terminal to ask), the prerequisites go in
 *      (wsl-provision.ts), then `gabion install` runs inside through the
 *      copy of this CLI, and this side prints the next step.
 *
 * Every wsl.exe call goes through wsl-exe.ts (encoding, stdin closed but
 * for the stub's installation and programs that talk to the user, `--exec`
 * only). Docker Desktop's own distributions are never chosen as
 * the home for Gabion. Where Gabion went is recorded, and the access
 * token's one home becomes the distribution (wsl-gabion-home.ts).
 */

import { FROM_WINDOWS_FLAG } from "./constants.js";
import { removeAuthConfig, serializeAuthConfig } from "./config.js";
import { packageRoot } from "./package-location.js";
import { describeRunFailure } from "./run-external.js";
import { wslSetVersionCommand } from "./preflight.js";
import type { AuthConfig, RunExternalResult, WslDistribution, WslLinuxUser } from "./types.js";
import {
  describeWsl,
  isWslInstalled,
  listDistributions,
  PACKAGED_WSL_EXE,
  wslCapture,
  wslConsole,
} from "./wsl-exe.js";
import { chooseDistribution, readWslHomeRecord, writeWslHomeRecord } from "./wsl-gabion-home.js";
import { buildProvisioningScript, WSL_GABION_WRAPPER } from "./wsl-provision.js";
import {
  askGitIdentity,
  configureGitIdentity,
  GIT_IDENTITY_HINT,
  gitIdentity,
} from "./git-identity.js";
import { runExternal } from "./run-external.js";

/** The distribution installed when the machine has none — WSL's own default. */
const DISTRIBUTION_TO_INSTALL = "Ubuntu";

/** Where a distribution names its first-run setup and the uid it gives the user. */
const DISTRIBUTION_CONF = "/etc/wsl-distribution.conf";

/** The first uid of regular accounts on Debian-family systems; below it are system accounts. */
const FIRST_REGULAR_UID = 1000;

/** Login shells of accounts that are not for logging in. */
const NO_LOGIN_SHELLS = /\/(nologin|false|sync)$/;

function step(message: string): void {
  console.log(`\n→ ${message}`);
}

function fail(message: string): number {
  console.error(`\ngabion install: ${message}`);
  return 1;
}

/**
 * Printed whenever the installer could not read the machine's state: the
 * four conditions the installation needs, so the user (or the agent
 * driving it) can check each by hand.
 */
function stateUnreadable(output: string): number {
  console.error(output.trim());
  return fail(
    "could not read the state of WSL from `wsl.exe --list` (its answer is above).\n\n" +
      "  Gabion needs, in this order:\n" +
      "    1. WSL 2 installed — gabion install does it; Windows then needs a restart;\n" +
      `    2. a Linux distribution registered — gabion install installs ${DISTRIBUTION_TO_INSTALL};\n` +
      "    3. the distribution on WSL 2, not WSL 1 — wsl --set-version <distribution> 2;\n" +
      "    4. a Linux user in it — its first run asks for a name and a password.\n\n" +
      "  Check with:  wsl --list --verbose     then run gabion install again.",
  );
}

function restartRequired(): number {
  console.log(
    "\nWindows needs a restart to finish setting up WSL 2.\n\n" +
      "  Restart Windows, then open PowerShell and run again:\n\n" +
      "       gabion install\n\n" +
      "  The installation continues from here.",
  );
  return 1;
}

// ==========================================
// WSL itself
// ==========================================

/**
 * The one wsl.exe call that needs the console: the inbox stub installs
 * only from a console. Without one it answers "The Windows Subsystem for
 * Linux is not installed. You can install by running 'wsl.exe --install'"
 * with exit 1 and installs nothing; with one it asks for elevation at once
 * and installs, without the key-press wait it puts before other commands.
 */
function installWsl(): number {
  step("WSL is not installed — installing it (Windows asks for administrator approval in a separate window)");
  const result = wslConsole(["--install", "--no-distribution"], "inherit");
  if (!isWslInstalled()) {
    if (!result.ok) console.error(`   ${describeWsl(result)}`);
    return fail(
      "WSL was not installed — the approval was declined or the installation failed (its messages are above).\n" +
        "  Run gabion install again to retry.",
    );
  }
  // The exit code is 0 whether or not Windows needs a restart; the
  // components it enabled take effect only after one.
  return restartRequired();
}

// ==========================================
// Distributions
// ==========================================

/**
 * The distribution to install into, installing one when the machine has
 * none — or the exit code of this run. A distribution an earlier
 * installation went into is taken again even if another became the
 * default since (wsl-gabion-home.ts).
 */
function ensureDistribution(): WslDistribution | { readonly exitCode: number } {
  const listing = listDistributions();
  if (listing.kind === "unreadable") return { exitCode: stateUnreadable(listing.output) };
  const recorded = readWslHomeRecord()?.distribution ?? null;
  const existing = chooseDistribution(listing.distributions, recorded);
  if (existing !== null) return existing;

  step(`No Linux distribution — installing ${DISTRIBUTION_TO_INSTALL}`);
  const install = wslConsole(["--install", DISTRIBUTION_TO_INSTALL, "--no-launch"], "ignore");
  if (!install.ok) {
    return {
      exitCode: fail(
        `${DISTRIBUTION_TO_INSTALL} was not installed: ${describeWsl(install)}\n  Run gabion install again to retry.`,
      ),
    };
  }
  const after = listDistributions();
  if (after.kind === "unreadable") return { exitCode: stateUnreadable(after.output) };
  const installed = chooseDistribution(after.distributions, null);
  // A WSL whose components are not yet active says the distribution was
  // installed and registers nothing: the restart has not happened.
  return installed ?? { exitCode: restartRequired() };
}

// ==========================================
// The Linux user
// ==========================================

/** Run a command inside the distribution as the given user (or its default user) and capture the answer. */
function inside(
  distribution: string,
  user: string | null,
  command: readonly string[],
): RunExternalResult {
  const asUser = user === null ? [] : ["-u", user];
  return wslCapture(["-d", distribution, ...asUser, "--exec", ...command]);
}

/** Regular accounts of the distribution, lowest uid first, as the distribution's own setup counts them. */
function regularUsers(distribution: string): readonly WslLinuxUser[] | { readonly failure: string } {
  const passwd = inside(distribution, "root", ["getent", "passwd"]);
  if (!passwd.ok) return { failure: describeWsl(passwd) };
  const users: WslLinuxUser[] = [];
  for (const line of passwd.stdout.split("\n")) {
    const fields = line.split(":");
    const [name, , uidText, , , home, shell] = fields;
    if (name === undefined || uidText === undefined || home === undefined || shell === undefined) continue;
    const uid = Number(uidText);
    if (!Number.isInteger(uid) || uid < FIRST_REGULAR_UID) continue;
    if (NO_LOGIN_SHELLS.test(shell)) continue;
    users.push({ name, uid, home });
  }
  return users.sort((a, b) => a.uid - b.uid);
}

/** The uid wsl.exe runs commands as when no user is named: the distribution's default user. */
function defaultUid(distribution: string): number | { readonly failure: string } {
  const id = inside(distribution, null, ["id", "-u"]);
  if (!id.ok) return { failure: describeWsl(id) };
  const uid = Number(id.stdout.trim());
  return Number.isInteger(uid) ? uid : { failure: `\`id -u\` answered "${id.stdout.trim()}"` };
}

interface FirstRunSetup {
  readonly command: string;
  readonly defaultUid: number | null;
}

/** The first-run setup the distribution declares, or null when it declares none. */
function readFirstRunSetup(distribution: string): FirstRunSetup | null {
  const conf = inside(distribution, "root", ["cat", DISTRIBUTION_CONF]);
  if (!conf.ok) return null;
  let section = "";
  let command: string | null = null;
  let uid: number | null = null;
  for (const raw of conf.stdout.split("\n")) {
    const line = raw.trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header !== null) {
      section = header[1] ?? "";
      continue;
    }
    if (section !== "oobe") continue;
    const pair = /^([^=]+?)\s*=\s*(.*)$/.exec(line);
    if (pair === null) continue;
    const [, key, value] = pair;
    if (key === "command" && value !== undefined && value !== "") command = value;
    if (key === "defaultUid" && value !== undefined && Number.isInteger(Number(value))) uid = Number(value);
  }
  return command === null ? null : { command, defaultUid: uid };
}

function setDefaultUser(distribution: string, user: WslLinuxUser): number | null {
  const result = wslCapture(["--manage", distribution, "--set-default-user", user.name]);
  if (!result.ok) {
    return fail(`could not make ${user.name} the default user of ${distribution}: ${describeWsl(result)}`);
  }
  console.log(`   ${user.name} is the default user of ${distribution}`);
  return null;
}

/**
 * The Linux user Gabion is installed for: the distribution's default user,
 * made so by its first-run setup when none exists yet. Returns the user,
 * or the exit code of this run.
 */
function ensureUser(distribution: string): WslLinuxUser | { readonly exitCode: number } {
  const uid = defaultUid(distribution);
  if (typeof uid !== "number") {
    return { exitCode: fail(`could not start ${distribution}: ${uid.failure}`) };
  }
  const users = regularUsers(distribution);
  if ("failure" in users) {
    return { exitCode: fail(`could not list the users of ${distribution}: ${users.failure}`) };
  }

  if (uid !== 0) {
    const current = users.find((u) => u.uid === uid);
    if (current === undefined) {
      return {
        exitCode: fail(
          `the default user of ${distribution} (uid ${String(uid)}) is not a regular account with a login shell.\n` +
            `  Make a regular user the default — in PowerShell: wsl --manage ${distribution} --set-default-user <name> — then run gabion install again.`,
        ),
      };
    }
    step(`Linux user: ${current.name} (${distribution})`);
    return current;
  }

  // Root by default. An account may exist already — a setup that was
  // interrupted before the default user was recorded — and is then taken.
  let user = users[0];
  if (user === undefined) {
    const setup = readFirstRunSetup(distribution);
    if (setup === null) {
      return {
        exitCode: fail(
          `${distribution} has no Linux user yet and declares no first-run setup to create one.\n` +
            `  Open it once to create the user — in PowerShell: wsl -d ${distribution} — then run gabion install again.`,
        ),
      };
    }
    step(
      `${distribution} has no Linux user yet — it now asks for your account inside ${distribution}:\n` +
        "  a user name (a suggested name is accepted with Enter) and a password, typed twice and not shown.\n",
    );
    const setupRun = wslConsole(["-d", distribution, "-u", "root", "--exec", setup.command], "inherit");
    if (!setupRun.ok) {
      return {
        exitCode: fail(
          `the first-run setup of ${distribution} did not complete: ${describeRunFailure("wsl.exe", setupRun)}\n  Run gabion install again to retry.`,
        ),
      };
    }
    const created = regularUsers(distribution);
    if ("failure" in created) {
      return { exitCode: fail(`could not list the users of ${distribution}: ${created.failure}`) };
    }
    user = created.find((u) => u.uid === setup.defaultUid) ?? created[0];
    if (user === undefined) {
      return {
        exitCode: fail(
          `the first-run setup of ${distribution} created no user. Run gabion install again to retry.`,
        ),
      };
    }
  }
  const exitCode = setDefaultUser(distribution, user);
  return exitCode === null ? user : { exitCode };
}

// ==========================================
// Git's identity inside
// ==========================================

/**
 * Make git inside the distribution know who commits, before the
 * installation runs there (git-identity.ts). The two gits keep separate
 * configurations (%UserProfile%\.gitconfig and ~/.gitconfig inside), so
 * an identity Windows's git already knows is copied inside; else it is
 * asked for here, on this terminal — the inner process has none — or,
 * without a terminal, named to whoever drives the command. A distribution
 * without git is left alone: the installation inside says what is lost.
 */
async function ensureGitIdentityInside(distribution: string, user: WslLinuxUser): Promise<number | null> {
  const insideGit = (args: readonly string[]): RunExternalResult =>
    inside(distribution, user.name, ["git", ...args]);
  const state = gitIdentity(insideGit, false);
  if (state.kind === "no-git") return null;
  if (state.kind === "configured") {
    step(`Git inside ${distribution} knows you: ${state.name} <${state.email}>`);
    return null;
  }

  const windows = gitIdentity((args) => runExternal("git", args, { stdio: "capture" }));
  let identity: { readonly name: string; readonly email: string };
  if (windows.kind === "configured") {
    step(`Git inside ${distribution} gets your identity from Windows's git: ${windows.name} <${windows.email}>`);
    identity = windows;
  } else if (process.stdin.isTTY) {
    step(`Git inside ${distribution} does not know who you are yet`);
    identity = await askGitIdentity();
  } else {
    return fail(
      `git inside ${distribution} does not know who you are, and no terminal is here to ask.\n` +
        `  ${GIT_IDENTITY_HINT}\n\n` +
        "  Set it in Windows (git config --global …, with Git for Windows) or inside the\n" +
        `  distribution (wsl -d ${distribution} -- git config --global …), then run gabion install again.`,
    );
  }
  const failure = configureGitIdentity(identity.name, identity.email, insideGit);
  if (failure !== null) {
    return fail(`git inside ${distribution} did not save the identity: ${failure}\n  Run gabion install again to retry.`);
  }
  console.log(`   Git identity inside ${distribution}: ${identity.name} <${identity.email}>`);
  return null;
}

// ==========================================
// Gabion inside
// ==========================================

/** Machine names `uname -m` gives for the architectures Gabion ships, in Node's naming. */
const LINUX_MACHINE_ARCHITECTURES: Readonly<Record<string, "x64" | "arm64">> = {
  x86_64: "x64",
  aarch64: "arm64",
};

/**
 * The architecture of the distribution itself, asked inside. Not the
 * architecture of this process: the Node that runs this CLI on Windows
 * may run under emulation — an x64 Node on ARM Windows reports x64 — and
 * the Node.js and the runtime archive installed inside must match the
 * Linux that runs them.
 */
function distributionArchitecture(distribution: string): { readonly arch: "x64" | "arm64" } | { readonly failure: string } {
  const probe = wslCapture(["-d", distribution, "--exec", "uname", "-m"]);
  if (!probe.ok) return { failure: `could not ask ${distribution} for its architecture: ${describeWsl(probe)}` };
  const machine = probe.stdout.trim();
  const arch = LINUX_MACHINE_ARCHITECTURES[machine];
  return arch !== undefined
    ? { arch }
    : { failure: `${distribution} runs on ${machine}; Gabion runs on x86_64 and aarch64` };
}

function provision(distribution: string, user: WslLinuxUser, auth: AuthConfig): number | null {
  step(`Installing the Gabion CLI and Node.js into ${distribution} for ${user.name}`);
  const machine = distributionArchitecture(distribution);
  if ("failure" in machine) return fail(machine.failure);
  const { arch } = machine;
  const script = buildProvisioningScript({
    arch,
    authJson: serializeAuthConfig(auth),
    packageRoot: packageRoot(),
  });
  const result = wslConsole(["-d", distribution, "-u", user.name, "--exec", "bash", "-s"], { script });
  if (!result.ok) {
    return fail(
      `the prerequisites did not install inside ${distribution} (${describeRunFailure("wsl.exe", result)}) — see the messages above.\n` +
        "  Run gabion install again to retry.",
    );
  }
  return null;
}

/**
 * `gabion install` inside, through a login shell of the user so PATH is
 * what their own shell has (their Node, if they have one), with
 * ~/.local/bin first so the command and the Node.js just installed are
 * found whatever the shell profile does.
 */
function installInside(distribution: string, user: WslLinuxUser): number | null {
  step(`Installing Gabion inside ${distribution}\n`);
  const result = wslConsole(
    [
      "-d",
      distribution,
      "-u",
      user.name,
      "--exec",
      "bash",
      "-lc",
      `PATH="$HOME/.local/bin:$PATH" exec "${WSL_GABION_WRAPPER}" install ${FROM_WINDOWS_FLAG}`,
    ],
    "inherit",
  );
  if (!result.ok) {
    return fail(
      `the installation inside ${distribution} stopped (${describeRunFailure("wsl.exe", result)}) — see the messages above.\n` +
        "  After fixing the cause, run gabion install again: it repeats only what is missing.",
    );
  }
  return null;
}

/** Whether the user's own login shell finds the gabion command — the shell they will type into. */
function gabionOnPath(distribution: string, user: WslLinuxUser): boolean {
  const result = inside(distribution, user.name, ["bash", "-lc", "command -v gabion"]);
  return result.ok && result.stdout.trim() === `${user.home}/.local/bin/gabion`;
}

function printNextStep(distribution: string, user: WslLinuxUser): void {
  console.log(`\n✅ Gabion is installed inside ${distribution} for ${user.name}.`);
  if (!gabionOnPath(distribution, user)) {
    console.log(
      `\n   Your shell inside ${distribution} does not put ${user.home}/.local/bin on PATH;\n` +
        "   add it in your shell profile, or call the command by its path.",
    );
  }
  console.log(
    `\n  Open ${distribution} (Start menu → ${distribution}, or in PowerShell: wsl -d ${distribution}).\n` +
      "  The first time, it finishes its own setup for a moment.\n" +
      "  Create your project in your Linux home — not under /mnt/c, where file watching does not work:\n\n" +
      "       cd ~\n" +
      "       gabion init my-project\n",
  );
}

/** The whole installation from Windows; the token was read by the caller. */
export async function installFromWindows(auth: AuthConfig): Promise<number> {
  console.log(
    "gabion install — preparing WSL 2 (Gabion itself is installed inside the Linux distribution)",
  );

  if (!isWslInstalled()) return installWsl();
  step("WSL is installed");

  const distribution = ensureDistribution();
  if ("exitCode" in distribution) return distribution.exitCode;
  if (distribution.version !== 2) {
    return fail(
      `${distribution.name} runs on WSL 1, and Gabion needs WSL 2 — the runtime's Node.js does not start on WSL 1.\n` +
        `  Move it to WSL 2, in PowerShell:\n\n       ${wslSetVersionCommand(distribution.name)}\n\n  Then run gabion install again.`,
    );
  }
  step(`Distribution: ${distribution.name} (WSL 2)`);

  const user = ensureUser(distribution.name);
  if ("exitCode" in user) return user.exitCode;

  const identity = await ensureGitIdentityInside(distribution.name, user);
  if (identity !== null) return identity;

  const provisioned = provision(distribution.name, user, auth);
  if (provisioned !== null) return provisioned;
  // The token is inside from here on: a rerun after a failure below finds
  // the distribution by this record and takes the token from there.
  writeWslHomeRecord({ distribution: distribution.name, user: user.name });

  const installed = installInside(distribution.name, user);
  if (installed !== null) return installed;

  // The token's one home on this machine is the distribution now; a
  // Windows copy left beside it would drift from the one the runtime uses.
  removeAuthConfig();
  console.log(
    `   The access token is kept inside ${distribution.name} only; gabion auth in PowerShell changes it there.`,
  );

  printNextStep(distribution.name, user);
  return 0;
}
