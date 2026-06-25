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