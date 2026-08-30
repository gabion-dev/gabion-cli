// src/types.ts

export interface AuthConfig {
  readonly token: string;
  readonly apiUrl: string;
  readonly lastVerifiedAt: string | null;
}

export interface VerifyResponse {
  readonly valid: boolean;
  readonly name?: string;
  readonly permissions?: readonly string[];
  readonly reason?: string;
}

export interface DownloadResponse {
  readonly version: string;
  readonly url: string;
  readonly sha256: string;
}

export interface UpToDateResponse {
  readonly upToDate: true;
}

export type RuntimeDownloadResult = DownloadResponse | UpToDateResponse;

export interface LatestResponse {
  readonly version: string;
  readonly minNodeVersion?: string;
}

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