// src/api-client.ts

import type {
  RevokeResponse,
  VerifyResponse,
  RuntimeDownloadResult,
} from "./types.js";
import { DEFAULT_API_URL } from "./constants.js";

/**
 * Structured error from API calls. Carries the HTTP status and, when
 * the server returned a JSON body, its machine-readable fields: "reason"
 * names a token refusal ("revoked", "expired", "not_found"), "error" a
 * failure of the request itself ("no_versions_published"). Either is
 * empty when the body does not carry it.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly reason: string;
  readonly error: string;

  constructor(status: number, reason: string, error: string) {
    const code = reason !== "" ? reason : error;
    const msg =
      code !== ""
        ? `${code} (HTTP ${String(status)})`
        : `HTTP ${String(status)}`;
    super(msg);
    this.name = "ApiError";
    this.status = status;
    this.reason = reason;
    this.error = error;
  }
}

const TOKEN_REJECTION_MESSAGES: Readonly<Record<string, string>> = {
  revoked:
    "Access token revoked — by the project author, or by its holder (gabion auth --revoke).\n\n" +
    "  To keep working, ask the project author for a new token, then:\n\n" +
    "       gabion auth\n\n" +
    "  To remove the runtime instead:\n\n" +
    "       gabion uninstall\n\n" +
    "  Project files are not affected.\n",
  expired:
    "Access token expired.\n\n" +
    "  1. Request a new token from the project author\n" +
    "  2. Authenticate with the new token:\n\n" +
    "       gabion auth\n",
  not_found:
    "Access token not recognized.\n\n" +
    "  Authenticate with a valid token:\n\n" +
    "       gabion auth\n",
};

/** What to tell the user for a token refusal reason (revoked, expired, not_found). */
export function describeTokenRefusal(reason: string): string {
  return TOKEN_REJECTION_MESSAGES[reason] ?? `Token rejected: ${reason}`;
}

/**
 * Format a human-readable error message from an ApiError whose reason
 * corresponds to a token rejection (revoked, expired, not_found).
 * Falls back to a generic message for unknown reasons.
 */
export function formatTokenError(error: ApiError): string {
  if (error.reason !== "") {
    return describeTokenRefusal(error.reason);
  }
  return `API request failed (HTTP ${String(error.status)})`;
}

// ==========================================
// Response shape checks
// ==========================================
//
// Every answer of the service is checked before it is acted on: the
// service is deployed apart from this CLI, and an answer cast to its
// type unchecked surfaces as a crash or a misleading message far from
// its cause — an invalid URL, a checksum compared against "undefined".
// A field this CLI does not know is passed over; a missing or malformed
// one is refused with its name. Checked by hand, because the thin CLI
// carries no runtime dependency.

/** SHA-256 as the archive's checksum file carries it: 64 lowercase hex digits. */
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** An answer of the service that is not the shape its endpoint promises. */
export class ResponseShapeError extends Error {
  constructor(url: string, problem: string) {
    super(`Unexpected response from ${url}: ${problem}`);
    this.name = "ResponseShapeError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  url: string,
  body: Record<string, unknown>,
  field: string,
): string {
  const value = body[field];
  if (typeof value !== "string" || value === "") {
    throw new ResponseShapeError(url, `"${field}" is not a non-empty string`);
  }
  return value;
}

function readVerifyResponse(url: string, body: unknown): VerifyResponse {
  if (!isRecord(body)) throw new ResponseShapeError(url, "not a JSON object");
  if (body["valid"] === true) {
    const name = body["name"];
    if (name !== undefined && typeof name !== "string") {
      throw new ResponseShapeError(url, `"name" is not a string`);
    }
    return name === undefined ? { valid: true } : { valid: true, name };
  }
  if (body["valid"] === false) {
    return { valid: false, reason: requireString(url, body, "reason") };
  }
  throw new ResponseShapeError(url, `"valid" is not a boolean`);
}

function readRuntimeDownloadResult(url: string, body: unknown): RuntimeDownloadResult {
  if (!isRecord(body)) throw new ResponseShapeError(url, "not a JSON object");
  const version = requireString(url, body, "version");
  if (body["upToDate"] === true) {
    return { upToDate: true, version };
  }
  const sha256 = requireString(url, body, "sha256");
  if (!SHA256_HEX_PATTERN.test(sha256)) {
    throw new ResponseShapeError(url, `"sha256" is not 64 lowercase hex digits`);
  }
  return { version, url: requireString(url, body, "url"), sha256 };
}

function readRevokeResponse(url: string, body: unknown): RevokeResponse {
  if (!isRecord(body)) throw new ResponseShapeError(url, "not a JSON object");
  if (body["revoked"] !== true) throw new ResponseShapeError(url, `"revoked" is not true`);
  const already = body["already"];
  if (typeof already !== "boolean") throw new ResponseShapeError(url, `"already" is not a boolean`);
  return { revokedAt: requireString(url, body, "revokedAt"), already };
}

async function postJson<T>(
  url: string,
  body: unknown,
  readAnswer: (url: string, answer: unknown) => T,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let reason = "";
    let error = "";
    try {
      const errorBody: unknown = await response.json();
      if (isRecord(errorBody)) {
        if (typeof errorBody["reason"] === "string") reason = errorBody["reason"];
        if (typeof errorBody["error"] === "string") error = errorBody["error"];
      }
    } catch {
      // A refusal that is not JSON (a gateway's own error page) carries
      // nothing beyond its status — the status is the whole message.
    }
    throw new ApiError(response.status, reason, error);
  }
  let answer: unknown;
  try {
    answer = await response.json();
  } catch {
    throw new ResponseShapeError(url, "not JSON");
  }
  return readAnswer(url, answer);
}

export async function verifyToken(
  token: string,
  baseUrl?: string,
): Promise<VerifyResponse> {
  const url = `${baseUrl ?? DEFAULT_API_URL}/api/auth/verify`;
  return postJson(url, { token }, readVerifyResponse);
}

export async function requestRuntimeDownload(
  token: string,
  currentVersion: string | null,
  baseUrl?: string,
): Promise<RuntimeDownloadResult> {
  const url = `${baseUrl ?? DEFAULT_API_URL}/api/runtime/download`;
  return postJson(url, { token, currentVersion }, readRuntimeDownloadResult);
}

/**
 * Revoke the token on the platform, for every machine at once — the
 * holder's own revocation (gabion auth --revoke). Final: a new token comes
 * from the project author.
 */
export async function revokeToken(token: string, baseUrl?: string): Promise<RevokeResponse> {
  const url = `${baseUrl ?? DEFAULT_API_URL}/api/auth/revoke`;
  return postJson(url, { token }, readRevokeResponse);
}
