// src/types.ts

export interface AuthConfig {
  readonly token: string;
  readonly apiUrl: string;
  readonly lastVerifiedAt: string | null;
}

/** Answer of /api/auth/verify: the token's holder, or why it was refused. */
export type VerifyResponse =
  | { readonly valid: true; readonly name?: string }
  | { readonly valid: false; readonly reason: string };

/** Answer of /api/runtime/download when a newer runtime exists. */
export interface DownloadResponse {
  readonly version: string;
  readonly url: string;
  readonly sha256: string;
}

/** Answer of /api/runtime/download when the current version is the latest. */
export interface UpToDateResponse {
  readonly upToDate: true;
  readonly version: string;
}

export type RuntimeDownloadResult = DownloadResponse | UpToDateResponse;

export interface VersionInfo {
  readonly version: string;
  readonly builtAt: string;
}

/** Minimal shape of an entry in ~/.gabion/instances.json for PID checking. */
export interface RegistryInstanceEntry {
  readonly name: string;
  readonly supervisorPid: number;
}

export type CommandHandler = (args: readonly string[]) => Promise<number>;

// ==========================================
// External command runner (run-external.ts)
// ==========================================

/**
 * Platform-resolved command vector, ready to spawn WITHOUT the shell
 * option. On Windows a .cmd/.bat shim resolves to an explicit
 * `cmd.exe /c <shim> <args...>` vector; on POSIX the input passes
 * through unchanged. Produced only by resolveWindowsShim.
 */
export interface ResolvedCommand {
  readonly command: string;
  readonly args: readonly string[];
}

/** Options for running a one-shot external command. */
export interface RunExternalOptions {
  /** Working directory for the child process. */
  readonly cwd?: string;
  /** Environment for the child; defaults to the parent environment. */
  readonly env?: Record<string, string>;
  /**
   * "inherit" streams the child's output to the parent terminal and makes
   * the parent transparent to terminal interrupts for the child's lifetime
   * — the child, sitting in the same foreground process group, owns the
   * interrupt; "capture" collects stdout/stderr into the result (probes).
   */
  readonly stdio: "inherit" | "capture";
  /**
   * True when the command is installed as a .cmd/.bat shim on Windows
   * (npm). Shims cannot be spawned directly (Node >= 20 returns EINVAL)
   * and are resolved through resolveWindowsShim into an explicit
   * `cmd.exe /c` argument vector. Real executables (node, java, git,
   * tar) must not set this — they spawn directly on every platform.
   */
  readonly windowsShim?: boolean;
}

/** Outcome of a one-shot external command. */
export interface RunExternalResult {
  /** True only when the process started and exited with status 0. */
  readonly ok: boolean;
  /** Exit status; null when the process never started or died by signal. */
  readonly status: number | null;
  /** Terminating signal, if any. */
  readonly signal: NodeJS.Signals | null;
  /** Spawn-level failure (e.g. ENOENT, EINVAL); null when the process started. */
  readonly error: Error | null;
  /** Captured stdout ("" in inherit mode). */
  readonly stdout: string;
  /** Captured stderr ("" in inherit mode). */
  readonly stderr: string;
}
// ==========================================
// Installation steps (install.ts)
// ==========================================

/**
 * One step of an installation phase, in the order the phase runs them.
 * The phase derives its step count from its list, so the "[n/total]"
 * indicator can never claim a total the code does not perform.
 */
export interface InstallStep {
  readonly id: string;
  readonly title: string;
}

// ==========================================
// WSL (preflight.ts, wsl-exe.ts, windows-install.ts)
// ==========================================

/** Which WSL this Linux is, judged by the kernel release string. */
export type WslDetection =
  | { readonly kind: "not-wsl" }
  | { readonly kind: "wsl1" | "wsl2"; readonly distribution: string | null };

/** Where a path lives, as WSL's own path translation (wslpath) sees it. */
export type WslPathLocation =
  /** In the distribution's own file system — or not under WSL at all. */
  | { readonly kind: "linux" }
  /** On a Windows drive or share mounted into the distribution. */
  | { readonly kind: "windows"; readonly windowsPath: string }
  /** The translation could not be asked; the reason says why. */
  | { readonly kind: "unknown"; readonly reason: string };

/** A registered distribution as `wsl.exe --list --verbose` lists it. */
export interface WslDistribution {
  readonly name: string;
  /** 1 or 2 — the VERSION column. */
  readonly version: number;
  /** Marked with "*" in the listing. */
  readonly isDefault: boolean;
}

/** A Linux user of a distribution, as getent passwd lists it. */
export interface WslLinuxUser {
  readonly name: string;
  readonly uid: number;
  readonly home: string;
}
