// src/git-identity.ts
/**
 * Does git know who makes commits on this machine — set by the user, not
 * guessed by git from the account and host names?
 *
 * The runtime commits in the user's project (the initial commit of
 * `gabion init`, the baselines module change tracking measures from), and
 * refuses to when git has no identity; git without one either refuses
 * the commit (an empty account name in a fresh WSL Ubuntu, no address it
 * can make up on a host without a domain) or invents an address that
 * belongs to nobody. The installation therefore settles the identity
 * before the download: asked on a terminal and written to the user's
 * global configuration — the way GitHub Desktop does — or, without a
 * terminal, named to whoever drives the command, who relays it to the
 * user: the name and the address are theirs to choose. Gabion's own name
 * is never written: it would sign every later commit of the user.
 *
 * From Windows the identity inside the distribution is taken from
 * Windows's git when it has one (the two gits keep separate
 * configurations), else asked for here, and written inside before the
 * installation runs there — the inner process has no terminal to ask.
 *
 * MIRROR NOTICE: formwork/shared/git-identity.ts in the runtime is the
 * owner of the detection, the hint and the questions; this is its copy —
 * the thin CLI cannot import a runtime it is installing. Change both or
 * neither.
 */

import { createInterface } from "readline";
import { describeRunFailure, runExternal } from "./run-external.js";
import type { GitIdentityState, RunExternalResult } from "./types.js";

/** The marker the runtime's doctor puts on a failure only the human can resolve. */
const HUMAN_ACTION_MARKER = "[ask your user to act]";

export const GIT_IDENTITY_HINT =
  "Git does not know who you are: user.name or user.email is not set.\n" +
  "  Gabion commits in your projects — the initial commit of gabion init and the\n" +
  "  baselines module change tracking measures from — and so do you. Set your\n" +
  "  identity once, for every repository on this machine:\n\n" +
  '       git config --global user.name "Your Name"\n' +
  '       git config --global user.email "you@example.com"\n\n' +
  "  Use your real name and the email of your GitHub account (or other git host),\n" +
  "  so the commits count as yours; GitHub's noreply address\n" +
  "  (ID+USERNAME@users.noreply.github.com) works too. The name and the address\n" +
  `  are yours to choose ${HUMAN_ACTION_MARKER}`;

const GIT_IDENTITY_QUESTION_PREFACE =
  "   Git does not know who you are yet. Gabion commits in your projects (the\n" +
  "   initial commit, the baselines module change tracking measures from), and\n" +
  "   so do you — a name and an email are needed. Use your real name and the\n" +
  "   email of your GitHub account (or other git host); GitHub's noreply\n" +
  "   address works too. Saved once for every repository on this machine\n" +
  "   (git config --global).";

/** Run git and capture its answer; the caller reads the fields it needs. */
type GitRunner = (args: readonly string[]) => RunExternalResult;

const localGit: GitRunner = (args) => runExternal("git", args, { stdio: "capture" });

function configured(key: string, git: GitRunner): string | null | "no-git" {
  const res = git(["config", "--get", key]);
  if (res.error !== null) return "no-git";
  const value = res.stdout.trim();
  return res.ok && value !== "" ? value : null;
}

function environmentPair(first: string, second: string): string | null {
  const a = process.env[first]?.trim() ?? "";
  const b = process.env[second]?.trim() ?? "";
  return a !== "" && b !== "" ? a : null;
}

/**
 * Who git would record as author and committer, when that is explicit.
 * `git` runs git where the identity is asked about: this machine, or a
 * user inside a WSL distribution; the environment pairs count only for
 * this machine's own git.
 */
export function gitIdentity(git: GitRunner = localGit, withEnvironment = true): GitIdentityState {
  const probe = git(["--version"]);
  if (!probe.ok) return { kind: "no-git" };

  const name =
    (withEnvironment ? environmentPair("GIT_AUTHOR_NAME", "GIT_COMMITTER_NAME") : null) ??
    configured("user.name", git) ??
    (configured("author.name", git) !== null ? configured("committer.name", git) : null);
  const email =
    (withEnvironment ? environmentPair("GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL") : null) ??
    configured("user.email", git) ??
    (configured("author.email", git) !== null ? configured("committer.email", git) : null);
  if (name === "no-git" || email === "no-git") return { kind: "no-git" };

  const missing: ("user.name" | "user.email")[] = [];
  if (name === null) missing.push("user.name");
  if (email === null) missing.push("user.email");
  if (name === null || email === null) return { kind: "unconfigured", missing };
  return { kind: "configured", name, email };
}

export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(value);
}

/** Write the identity to the global configuration of the git `git` runs. Null when written. */
export function configureGitIdentity(name: string, email: string, git: GitRunner = localGit): string | null {
  for (const [key, value] of [["user.name", name], ["user.email", email]] as const) {
    const res = git(["config", "--global", key, value]);
    if (!res.ok) {
      const said = res.stderr.trim();
      return `${describeRunFailure(`git config --global ${key}`, res)}${said === "" ? "" : `: ${said}`}`;
    }
  }
  return null;
}

/** One line typed on the terminal, shown as typed. The caller checks process.stdin.isTTY first. */
function askLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/** Ask for a name and an address on the terminal until both are usable. */
export async function askGitIdentity(): Promise<{ readonly name: string; readonly email: string }> {
  console.log(GIT_IDENTITY_QUESTION_PREFACE);
  let name = "";
  while (name === "") {
    name = (await askLine("   Your name: ")).trim();
    if (name === "") console.log("   A name is needed — or press Ctrl+C to stop here.");
  }
  let email = "";
  while (!isPlausibleEmail(email)) {
    email = (await askLine("   Your email: ")).trim();
    if (!isPlausibleEmail(email)) console.log("   An email address is needed, like you@example.com.");
  }
  return { name, email };
}

/**
 * Settle git's identity on this machine before an installation: nothing
 * when it is set, the questions on a terminal, otherwise the hint for
 * whoever drives the command. Null when the installation may go on,
 * otherwise the refusal. A machine without git is not refused: git is a
 * degradable dependency, and the doctor says what is lost without it.
 */
export async function ensureGitIdentityBeforeInstall(commandName: string): Promise<string | null> {
  const state = gitIdentity();
  if (state.kind !== "unconfigured") return null;
  if (!process.stdin.isTTY) {
    return `gabion ${commandName}: ${GIT_IDENTITY_HINT}\n\n  Then run gabion ${commandName} again.`;
  }
  const { name, email } = await askGitIdentity();
  const failure = configureGitIdentity(name, email);
  if (failure !== null) {
    return `gabion ${commandName}: git did not save the identity (${failure}).\n  ${GIT_IDENTITY_HINT}`;
  }
  console.log(`   Git identity saved: ${name} <${email}>`);
  return null;
}
