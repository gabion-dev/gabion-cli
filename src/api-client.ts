// src/api-client.ts

import type {
  VerifyResponse,
  RuntimeDownloadResult,
  LatestResponse,
} from "./types.js";
import { DEFAULT_API_URL } from "./constants.js";

function apiUrl(config: { apiUrl: string } | null): string {
  return config?.apiUrl ?? DEFAULT_API_URL;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`API request failed: HTTP ${String(response.status)}`);
  }
  return (await response.json()) as T;
}

export async function verifyToken(
  token: string,
  baseUrl?: string,
): Promise<VerifyResponse> {
  const url = `${baseUrl ?? DEFAULT_API_URL}/api/auth/verify`;
  return postJson<VerifyResponse>(url, { token });
}

export async function requestRuntimeDownload(
  token: string,
  currentVersion: string | null,
  baseUrl?: string,
): Promise<RuntimeDownloadResult> {
  const url = `${baseUrl ?? DEFAULT_API_URL}/api/runtime/download`;
  return postJson<RuntimeDownloadResult>(url, { token, currentVersion });
}

export async function fetchLatestVersion(
  baseUrl?: string,
): Promise<LatestResponse> {
  const url = `${baseUrl ?? DEFAULT_API_URL}/api/runtime/latest`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API request failed: HTTP ${String(response.status)}`);
  }
  return (await response.json()) as LatestResponse;
}