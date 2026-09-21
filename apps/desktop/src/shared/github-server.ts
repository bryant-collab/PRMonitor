/**
 * Provider-neutral contracts for the F05 GitHub server/profile boundary.
 *
 * This module is intentionally renderer-safe. It contains canonical server
 * identity and bounded status data, but never a credential, credential
 * reference, encrypted value, or secure-store path.
 */

export const GITHUB_SERVER_SCHEMA_VERSION = 1 as const;
export const MAX_GITHUB_SERVER_URL_BYTES = 2_048;
export const MAX_GITHUB_SERVER_DISPLAY_NAME_BYTES = 120;
export const MAX_GITHUB_SERVER_REASON_BYTES = 512;
export const MAX_GITHUB_SERVER_LOGIN_BYTES = 256;

export type GithubServerKind = "GITHUB_COM" | "GHES";

export type GithubServerStatus =
  | "UNVERIFIED"
  | "TESTING"
  | "VERIFIED"
  | "NEEDS_ATTENTION"
  | "SECURE_STORAGE_UNAVAILABLE"
  | "RECOVERY_REQUIRED"
  | "REMOVED";

export type GithubSecureStoreState =
  | "AVAILABLE"
  | "UNAVAILABLE"
  | "WEAK"
  | "NOT_READY";

export type GithubReasonCategory =
  | "VALIDATION"
  | "SECURE_STORAGE"
  | "AUTHENTICATION"
  | "AUTHORIZATION"
  | "RATE_LIMIT"
  | "NETWORK"
  | "TLS"
  | "TIMEOUT"
  | "CANCELLED"
  | "REDIRECT"
  | "PROTOCOL"
  | "RECOVERY"
  | "UNKNOWN";

export type GithubReasonNextAction =
  | "FIX_INPUT"
  | "ENABLE_SECURE_STORAGE"
  | "REPLACE_ACCESS"
  | "RETRY"
  | "WAIT"
  | "CLEAN_UP"
  | "REVIEW_ENDPOINT"
  | "CONTACT_ADMIN"
  | "NONE";

export type GithubReasonCode =
  | "INVALID_SERVER_URL"
  | "INVALID_DISPLAY_NAME"
  | "DUPLICATE_SERVER"
  | "MISSING_ACCESS"
  | "STORE_UNAVAILABLE"
  | "STORE_WEAK"
  | "STORE_NOT_READY"
  | "STORE_WRITE_FAILED"
  | "STORE_READ_FAILED"
  | "STORE_RETIRE_FAILED"
  | "STORE_CLEANUP_FAILED"
  | "AUTHENTICATION_FAILED"
  | "AUTHORIZATION_FAILED"
  | "RATE_LIMITED"
  | "NETWORK_FAILED"
  | "TLS_FAILED"
  | "REQUEST_TIMEOUT"
  | "REQUEST_CANCELLED"
  | "REDIRECT_REJECTED"
  | "CROSS_ORIGIN_REDIRECT"
  | "INSECURE_ENDPOINT"
  | "PROTOCOL_MISMATCH"
  | "MALFORMED_RESPONSE"
  | "RESPONSE_TOO_LARGE"
  | "UNEXPECTED_RESPONSE"
  | "OPERATION_INTERRUPTED"
  | "RECOVERY_REQUIRED"
  | "PROFILE_CHANGED"
  | "PROFILE_REMOVED";

export interface GithubSafeReason {
  readonly code: GithubReasonCode;
  readonly category: GithubReasonCategory;
  readonly message: string;
  readonly nextAction: GithubReasonNextAction;
  readonly correlationId: string;
}

export interface GithubServerIdentity {
  readonly kind: GithubServerKind;
  readonly webOrigin: string;
  readonly apiBaseUrl: string;
  readonly host: string;
}

export interface GithubServerProfileView extends GithubServerIdentity {
  readonly schemaVersion: typeof GITHUB_SERVER_SCHEMA_VERSION;
  readonly id: string;
  readonly displayName: string;
  readonly status: GithubServerStatus;
  readonly version: number;
  readonly activeRevision?: number;
  readonly candidateRevision?: number;
  readonly accountLogin?: string;
  readonly accountName?: string;
  readonly verifiedAt?: string;
  readonly lastTestAt?: string;
  readonly reason?: GithubSafeReason;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GithubCredentialOperationView {
  readonly schemaVersion: typeof GITHUB_SERVER_SCHEMA_VERSION;
  readonly id: string;
  readonly profileId: string;
  readonly kind: "SAVE_AND_TEST" | "TEST_CONNECTION" | "REMOVE";
  readonly phase:
    | "INTENT"
    | "CANDIDATE_STORED"
    | "TESTING"
    | "VERIFIED"
    | "ACTIVATED"
    | "CLEANUP_PENDING"
    | "COMPLETED"
    | "FAILED"
    | "CANCELLED"
    | "RECOVERY_REQUIRED";
  readonly candidateRevision?: number;
  readonly reason?: GithubSafeReason;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GithubServerSettingsView {
  readonly schemaVersion: typeof GITHUB_SERVER_SCHEMA_VERSION;
  readonly secureStore: {
    readonly state: GithubSecureStoreState;
    readonly reason?: GithubSafeReason;
  };
  readonly profiles: readonly GithubServerProfileView[];
  readonly operations: readonly GithubCredentialOperationView[];
}

export interface GithubServerProfileInput {
  readonly displayName: string;
  readonly serverUrl: string;
  readonly expectedVersion?: number;
}

export interface GithubServerValidationFailure {
  readonly code: "INVALID_SERVER_URL" | "INVALID_DISPLAY_NAME";
  readonly message: string;
  readonly nextAction: "FIX_INPUT";
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function validBoundedText(
  value: string,
  maximum: number,
): boolean {
  return (
    value.length > 0 &&
    byteLength(value) <= maximum &&
    !hasControlCharacter(value)
  );
}

export function validateGithubDisplayName(
  value: string,
): GithubServerValidationFailure | undefined {
  const displayName = value.trim();
  if (!validBoundedText(displayName, MAX_GITHUB_SERVER_DISPLAY_NAME_BYTES)) {
    return {
      code: "INVALID_DISPLAY_NAME",
      message: "Enter a display name between 1 and 120 bytes.",
      nextAction: "FIX_INPUT",
    };
  }
  return undefined;
}

export function normalizeGithubServerUrl(
  value: string,
):
  | { readonly ok: true; readonly value: GithubServerIdentity }
  | { readonly ok: false; readonly error: GithubServerValidationFailure } {
  if (
    typeof value !== "string" ||
    !validBoundedText(value.trim(), MAX_GITHUB_SERVER_URL_BYTES)
  ) {
    return {
      ok: false,
      error: {
        code: "INVALID_SERVER_URL",
        message: "Enter an HTTPS GitHub.com or GitHub Enterprise Server origin.",
        nextAction: "FIX_INPUT",
      },
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return {
      ok: false,
      error: {
        code: "INVALID_SERVER_URL",
        message: "The server URL is not a valid HTTPS origin.",
        nextAction: "FIX_INPUT",
      },
    };
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.hostname === ""
  ) {
    return {
      ok: false,
      error: {
        code: "INVALID_SERVER_URL",
        message:
          "Use only an HTTPS server origin without credentials, query, fragment, or path.",
        nextAction: "FIX_INPUT",
      },
    };
  }

  const origin = parsed.origin;
  const isGithubCom = parsed.hostname.toLowerCase() === "github.com";
  if (parsed.hostname.toLowerCase() === "api.github.com") {
    return {
      ok: false,
      error: {
        code: "INVALID_SERVER_URL",
        message: "Enter the GitHub.com web origin, not an API host.",
        nextAction: "FIX_INPUT",
      },
    };
  }
  if (isGithubCom && parsed.port !== "") {
    return {
      ok: false,
      error: {
        code: "INVALID_SERVER_URL",
        message: "GitHub.com must use its standard HTTPS origin.",
        nextAction: "FIX_INPUT",
      },
    };
  }

  return {
    ok: true,
    value: {
      kind: isGithubCom ? "GITHUB_COM" : "GHES",
      webOrigin: origin,
      apiBaseUrl: isGithubCom ? "https://api.github.com" : `${origin}/api/v3`,
      host: parsed.host,
    },
  };
}

export function validateGithubServerProfileInput(
  input: GithubServerProfileInput,
):
  | { readonly ok: true; readonly value: { readonly displayName: string; readonly identity: GithubServerIdentity } }
  | { readonly ok: false; readonly error: GithubServerValidationFailure } {
  const displayName = input.displayName.trim();
  const displayNameError = validateGithubDisplayName(displayName);
  if (displayNameError !== undefined)
    return { ok: false, error: displayNameError };
  const identity = normalizeGithubServerUrl(input.serverUrl);
  if (!identity.ok) return identity;
  return { ok: true, value: { displayName, identity: identity.value } };
}

export function isGithubSafeReason(value: unknown): value is GithubSafeReason {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (
    keys.length !== 5 ||
    keys.some(
      (key) =>
        ![
          "code",
          "category",
          "message",
          "nextAction",
          "correlationId",
        ].includes(key),
    )
  )
    return false;
  return (
    typeof candidate.code === "string" &&
    [
      "INVALID_SERVER_URL",
      "INVALID_DISPLAY_NAME",
      "DUPLICATE_SERVER",
      "MISSING_ACCESS",
      "STORE_UNAVAILABLE",
      "STORE_WEAK",
      "STORE_NOT_READY",
      "STORE_WRITE_FAILED",
      "STORE_READ_FAILED",
      "STORE_RETIRE_FAILED",
      "STORE_CLEANUP_FAILED",
      "AUTHENTICATION_FAILED",
      "AUTHORIZATION_FAILED",
      "RATE_LIMITED",
      "NETWORK_FAILED",
      "TLS_FAILED",
      "REQUEST_TIMEOUT",
      "REQUEST_CANCELLED",
      "REDIRECT_REJECTED",
      "CROSS_ORIGIN_REDIRECT",
      "INSECURE_ENDPOINT",
      "PROTOCOL_MISMATCH",
      "MALFORMED_RESPONSE",
      "RESPONSE_TOO_LARGE",
      "UNEXPECTED_RESPONSE",
      "OPERATION_INTERRUPTED",
      "RECOVERY_REQUIRED",
      "PROFILE_CHANGED",
      "PROFILE_REMOVED",
    ].includes(candidate.code) &&
    typeof candidate.category === "string" &&
    [
      "VALIDATION",
      "SECURE_STORAGE",
      "AUTHENTICATION",
      "AUTHORIZATION",
      "RATE_LIMIT",
      "NETWORK",
      "TLS",
      "TIMEOUT",
      "CANCELLED",
      "REDIRECT",
      "PROTOCOL",
      "RECOVERY",
      "UNKNOWN",
    ].includes(candidate.category) &&
    typeof candidate.message === "string" &&
    byteLength(candidate.message) <= MAX_GITHUB_SERVER_REASON_BYTES &&
    !/(?:token|secret|password|authorization|cookie|api[_.-]?key)/iu.test(
      candidate.message,
    ) &&
    typeof candidate.nextAction === "string" &&
    [
      "FIX_INPUT",
      "ENABLE_SECURE_STORAGE",
      "REPLACE_ACCESS",
      "RETRY",
      "WAIT",
      "CLEAN_UP",
      "REVIEW_ENDPOINT",
      "CONTACT_ADMIN",
      "NONE",
    ].includes(candidate.nextAction) &&
    typeof candidate.correlationId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(candidate.correlationId)
  );
}

export function isGithubServerProfileView(
  value: unknown,
): value is GithubServerProfileView {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const candidate = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "schemaVersion",
    "id",
    "displayName",
    "kind",
    "webOrigin",
    "apiBaseUrl",
    "host",
    "status",
    "version",
    "activeRevision",
    "candidateRevision",
    "accountLogin",
    "accountName",
    "verifiedAt",
    "lastTestAt",
    "reason",
    "createdAt",
    "updatedAt",
  ]);
  if (
    Object.keys(candidate).some((key) => !allowedKeys.has(key)) ||
    candidate.schemaVersion !== GITHUB_SERVER_SCHEMA_VERSION ||
    typeof candidate.id !== "string" ||
    typeof candidate.displayName !== "string" ||
    typeof candidate.kind !== "string" ||
    typeof candidate.webOrigin !== "string" ||
    typeof candidate.apiBaseUrl !== "string" ||
    typeof candidate.host !== "string" ||
    typeof candidate.status !== "string" ||
    typeof candidate.version !== "number" ||
    !Number.isSafeInteger(candidate.version) ||
    candidate.version < 1 ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.updatedAt !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(candidate.id) ||
    !validBoundedText(candidate.displayName, MAX_GITHUB_SERVER_DISPLAY_NAME_BYTES) ||
    !validBoundedText(candidate.webOrigin, MAX_GITHUB_SERVER_URL_BYTES) ||
    !validBoundedText(candidate.apiBaseUrl, MAX_GITHUB_SERVER_URL_BYTES) ||
    !validBoundedText(candidate.host, MAX_GITHUB_SERVER_URL_BYTES)
  )
    return false;
  const identity = normalizeGithubServerUrl(candidate.webOrigin);
  return (
    ["GITHUB_COM", "GHES"].includes(candidate.kind) &&
    identity.ok &&
    identity.value.kind === candidate.kind &&
    identity.value.apiBaseUrl === candidate.apiBaseUrl &&
    identity.value.host === candidate.host &&
    [
      "UNVERIFIED",
      "TESTING",
      "VERIFIED",
      "NEEDS_ATTENTION",
      "SECURE_STORAGE_UNAVAILABLE",
      "RECOVERY_REQUIRED",
      "REMOVED",
    ].includes(candidate.status) &&
    (candidate.activeRevision === undefined ||
      (typeof candidate.activeRevision === "number" &&
        Number.isSafeInteger(candidate.activeRevision) &&
        candidate.activeRevision > 0)) &&
    (candidate.candidateRevision === undefined ||
      (typeof candidate.candidateRevision === "number" &&
        Number.isSafeInteger(candidate.candidateRevision) &&
        candidate.candidateRevision > 0)) &&
    (candidate.accountLogin === undefined ||
      (typeof candidate.accountLogin === "string" &&
        byteLength(candidate.accountLogin) <= MAX_GITHUB_SERVER_LOGIN_BYTES)) &&
    (candidate.accountName === undefined ||
      (typeof candidate.accountName === "string" &&
        byteLength(candidate.accountName) <= MAX_GITHUB_SERVER_LOGIN_BYTES)) &&
    (candidate.reason === undefined || isGithubSafeReason(candidate.reason))
  );
}

export function isGithubCredentialOperationView(
  value: unknown,
): value is GithubCredentialOperationView {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const candidate = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "schemaVersion",
    "id",
    "profileId",
    "kind",
    "phase",
    "candidateRevision",
    "reason",
    "createdAt",
    "updatedAt",
  ]);
  return (
    Object.keys(candidate).every((key) => allowedKeys.has(key)) &&
    candidate.schemaVersion === GITHUB_SERVER_SCHEMA_VERSION &&
    typeof candidate.id === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(candidate.id) &&
    typeof candidate.profileId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(candidate.profileId) &&
    ["SAVE_AND_TEST", "TEST_CONNECTION", "REMOVE"].includes(String(candidate.kind)) &&
    [
      "INTENT",
      "CANDIDATE_STORED",
      "TESTING",
      "VERIFIED",
      "ACTIVATED",
      "CLEANUP_PENDING",
      "COMPLETED",
      "FAILED",
      "CANCELLED",
      "RECOVERY_REQUIRED",
    ].includes(String(candidate.phase)) &&
    (candidate.candidateRevision === undefined ||
      (typeof candidate.candidateRevision === "number" &&
        Number.isSafeInteger(candidate.candidateRevision) &&
        candidate.candidateRevision > 0)) &&
    (candidate.reason === undefined || isGithubSafeReason(candidate.reason)) &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

export function isGithubServerSettingsView(
  value: unknown,
): value is GithubServerSettingsView {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== GITHUB_SERVER_SCHEMA_VERSION ||
    !Array.isArray(candidate.profiles) ||
    !Array.isArray(candidate.operations) ||
    typeof candidate.secureStore !== "object" ||
    candidate.secureStore === null ||
    Array.isArray(candidate.secureStore)
  )
    return false;
  const store = candidate.secureStore as Record<string, unknown>;
  return (
    Object.keys(store).every((key) => ["state", "reason"].includes(key)) &&
    ["AVAILABLE", "UNAVAILABLE", "WEAK", "NOT_READY"].includes(
      String(store.state),
    ) &&
    (store.reason === undefined || isGithubSafeReason(store.reason)) &&
    candidate.profiles.every(isGithubServerProfileView) &&
    candidate.operations.every(isGithubCredentialOperationView)
  );
}
