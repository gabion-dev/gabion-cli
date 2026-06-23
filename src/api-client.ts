// src/api-client.ts

import type {
  VerifyResponse,
  RuntimeDownloadResult,
  LatestResponse,
} from "./types.js";
import { DEFAULT_API_URL } from "./constants.js";

/**
 * Structured error from API calls. Carries the HTTP status and,
 * when the server returned a JSON body with a "reason" field,
 * the machine-readable reason string (e.g. "revoked", "expired",
 * "not_found").
 */
export class ApiError extends Error {
  readonly status: number;
  readonly reason: string;

  constructor(status: number, reason: string) {
    const msg =
      reason !== ""
        ? `${reason} (HTTP ${String(status)})`
        : `HTTP ${String(status)}`;
    super(msg);
    this.name = "ApiError";
    this.status = status;
    this.reason = reason;
  }
}

const TOKEN_REJECTION_MESSAGES: Readonly<Record<string, string>> = {
  revoked:
    "Access token revoked. Your access to Gabion has been terminated.\n\n" +
    "  To remove the runtime:\n\n" +
    "       gabion uninstall\n\n" +
    "  Project files are not affected.",
  expired:
    "Access token expired.\n\n" +
    "  1. Request a new token from the project author\n" +
    "  2. Authenticate with the new token:\n\n" +
    "       gabion auth YOUR_TOKEN",
  not_found:
    "Access token not recognized.\n\n" +
    "  Authenticate with a valid token:\n\n" +
    "       gabion auth YOUR_TOKEN",
};

/**
 * Format a human-readable error message from an ApiError whose reason
 * corresponds to a token rejection (revoked, expired, not_found).
 * Falls back to a generic message for unknown reasons.
 */
export function formatTokenError(error: ApiError): string {
  if (error.reason !== "") {
    return TOKEN_REJECTION_MESSAGES[error.reason] ?? `Token rejected: ${error.reason}`;
  }
  return `API request failed (HTTP ${String(error.status)})`;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let reason = "";
    try {
      const errorBody = (await response.json()) as Record<string, unknown>;
      if (typeof errorBody["reason"] === "string") {
        reason = errorBody["reason"];
      }
    } catch {
      // Response body is not parseable JSON — reason stays empty
    }
    throw new ApiError(response.status, reason);
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
    throw new ApiError(response.status, "");
  }
  return (await response.json()) as LatestResponse;
}