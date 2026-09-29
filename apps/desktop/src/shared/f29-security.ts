import { z } from "zod";
import { parseOpenTarget, type OpenTarget } from "./routing";

/**
 * F29 is deliberately a contract layer, not a second workflow state machine.
 * These values are safe to import from the renderer and shared packages: the
 * module contains no Electron, filesystem, child-process, or provider SDK
 * dependency.
 */
export const F29_SECURITY_SCHEMA_VERSION = 1 as const;
export const F29_MAX_REASON_BYTES = 8 * 1024;
export const F29_MAX_EVIDENCE_BYTES = 16 * 1024;
export const F29_MAX_PATH_BYTES = 4_096;
export const F29_MAX_ARGUMENT_BYTES = 4_096;
export const F29_MAX_ENVIRONMENT_VALUE_BYTES = 8 * 1024;

export const F29_SECURITY_BOUNDARIES = [
  "renderer_ipc",
  "route_url",
  "filesystem_worktree",
  "git",
  "validation_process",
  "database",
  "credential",
  "provider_policy",
  "diagnostics_recovery",
  "dependency_runtime",
] as const;
export type F29SecurityBoundary = (typeof F29_SECURITY_BOUNDARIES)[number];

export const F29_DATA_CLASSES = [
  "public_remote_metadata",
  "private_source_context",
  "privileged_control_state",
  "credential_secret",
] as const;
export type F29DataClass = (typeof F29_DATA_CLASSES)[number];

export const F29_SECURITY_REASON_CODES = [
  "IPC_SCHEMA_REJECTED",
  "IPC_SESSION_REJECTED",
  "ROUTE_UNSUPPORTED",
  "ROUTE_IDENTITY_AMBIGUOUS",
  "PATH_OUTSIDE_OPERATION",
  "PATH_OWNER_MISMATCH",
  "PATH_REVISION_STALE",
  "PATH_TYPE_MISMATCH",
  "PATH_UNSAFE_SYMLINK",
  "PATH_UNSUPPORTED",
  "GIT_ARGUMENT_REJECTED",
  "GIT_IDENTITY_MISMATCH",
  "PROCESS_COMMAND_REJECTED",
  "PROCESS_ENVIRONMENT_REJECTED",
  "PROCESS_WORKTREE_REJECTED",
  "DATABASE_PATH_REJECTED",
  "REDACTION_FAILURE",
  "CREDENTIAL_BOUNDARY_VIOLATION",
  "PROVIDER_OUTPUT_REJECTED",
  "POLICY_UNSUPPORTED",
  "POLICY_BOUNDARY_VIOLATION",
  "PUBLICATION_AUTHORITY_DENIED",
  "SECURITY_EVIDENCE_INCOMPLETE",
  "DEPENDENCY_GATE_FAILED",
] as const;
export type F29SecurityReasonCode = (typeof F29_SECURITY_REASON_CODES)[number];

export const F29_NEXT_ACTIONS = [
  "NONE",
  "RETRY",
  "RECONCILE",
  "REVIEW",
  "FIX_INPUT",
  "RE_EVALUATE",
  "MANUAL_REPAIR",
  "INSPECT",
  "WAIT",
  "APPROVE",
] as const;
export type F29NextAction = (typeof F29_NEXT_ACTIONS)[number];

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,127}$/u;
const shaPattern = /^[0-9a-f]{7,64}$/iu;
const secretKeyPattern =
  /(?:token|secret|password|passwd|credential|authorization|cookie|api[_.-]?key|access[_.-]?key|private[_.-]?key|client[_.-]?secret|refresh[_.-]?token)/iu;
const secretValuePatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/iu,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{8,}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{8,}\b/u,
  /\bsk-[A-Za-z0-9_-]{12,}\b/u,
];
const secretAssignmentPattern =
  /(\b(?:token|password|passwd|secret|authorization|auth|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|client[ _-]?secret|private[ _-]?key|credential)\b\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&"']+)/giu;

export interface F29Failure {
  readonly code: F29SecurityReasonCode;
  readonly message: string;
}

export type F29Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: F29Failure };

export interface F29SecurityReason {
  readonly schemaVersion: typeof F29_SECURITY_SCHEMA_VERSION;
  readonly kind: "f29-security-reason";
  readonly code: F29SecurityReasonCode;
  readonly boundary: F29SecurityBoundary;
  readonly operationId: string;
  readonly what: string;
  readonly why: string;
  readonly nextAction: F29NextAction;
  readonly retryable: boolean;
  readonly evidenceRefs: readonly string[];
  readonly safeEvidence: Readonly<Record<string, string | number | boolean>>;
}

export const f29SecurityReasonSchema = z
  .object({
    schemaVersion: z.literal(F29_SECURITY_SCHEMA_VERSION),
    kind: z.literal("f29-security-reason"),
    code: z.enum(F29_SECURITY_REASON_CODES),
    boundary: z.enum(F29_SECURITY_BOUNDARIES),
    operationId: z.string().regex(identifierPattern).max(128),
    what: z.string().min(1).max(512),
    why: z.string().min(1).max(512),
    nextAction: z.enum(F29_NEXT_ACTIONS),
    retryable: z.boolean(),
    evidenceRefs: z.array(z.string().regex(identifierPattern).max(128)).max(16),
    safeEvidence: z
      .record(
        z.string().regex(identifierPattern).max(64),
        z.union([z.string().max(256), z.number().finite(), z.boolean()]),
      )
      .refine((value) => Object.keys(value).length <= 24),
  })
  .strict();

export const f29DataClassificationSchema = z.enum(F29_DATA_CLASSES);

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function f29HasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    byteLength(value) <= maximum &&
    !f29HasControlCharacter(value)
  );
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function failure(
  code: F29SecurityReasonCode,
  message: string,
): { readonly ok: false; readonly error: F29Failure } {
  return { ok: false, error: { code, message } };
}

export function f29ContainsSecretShape(value: string): boolean {
  if (secretKeyPattern.test(value)) return true;
  return secretValuePatterns.some((pattern) => pattern.test(value));
}

export interface F29RedactionOptions {
  readonly knownSecrets?: readonly string[];
  readonly replacement?: string;
  readonly maximumBytes?: number;
}

export interface F29RedactionSuccess {
  readonly ok: true;
  readonly text: string;
  readonly redacted: boolean;
}

export type F29RedactionResult =
  F29RedactionSuccess | { readonly ok: false; readonly error: F29Failure };

function replaceKnownSecrets(
  text: string,
  secrets: readonly string[],
  replacement: string,
): {
  readonly text: string;
  readonly redacted: boolean;
} {
  let result = text;
  let redacted = false;
  for (const secret of secrets) {
    if (!safeText(secret, 16_384)) continue;
    if (!result.includes(secret)) continue;
    result = result.split(secret).join(replacement);
    redacted = true;
  }
  return { text: result, redacted };
}

/** Redacts known credentials and secret-shaped assignments before diagnostics cross a boundary. */
export function redactF29Text(
  input: string,
  options: F29RedactionOptions = {},
): F29RedactionResult {
  const maximumBytes = options.maximumBytes ?? F29_MAX_EVIDENCE_BYTES;
  const replacement = options.replacement ?? "[REDACTED]";
  if (
    !safeText(input, Math.max(maximumBytes, 1)) ||
    byteLength(input) > maximumBytes
  )
    return failure(
      "REDACTION_FAILURE",
      "Diagnostic text is empty, unbounded, or contains control characters.",
    );
  if (!safeText(replacement, 128))
    return failure(
      "REDACTION_FAILURE",
      "The redaction marker is not safe text.",
    );

  const known = replaceKnownSecrets(
    input,
    options.knownSecrets ?? [],
    replacement,
  );
  let text = known.text.replace(
    secretAssignmentPattern,
    (_match, prefix: string) => `${prefix}${replacement}`,
  );
  let redacted = known.redacted || text !== known.text;
  for (const pattern of secretValuePatterns) {
    const before = text;
    text = text.replace(pattern, replacement);
    redacted ||= before !== text;
  }
  if (byteLength(text) > maximumBytes)
    return failure(
      "REDACTION_FAILURE",
      "Redacted diagnostic text remains unbounded.",
    );
  return { ok: true, text, redacted };
}

export type F29SafeValue =
  | string
  | number
  | boolean
  | null
  | readonly F29SafeValue[]
  | { readonly [key: string]: F29SafeValue };

export interface F29ProjectionOptions {
  readonly knownSecrets?: readonly string[];
  readonly maximumBytes?: number;
  readonly maximumDepth?: number;
}

function projectValue(
  value: unknown,
  options: Required<F29ProjectionOptions>,
  depth: number,
): F29Result<F29SafeValue> {
  if (depth > options.maximumDepth)
    return failure(
      "REDACTION_FAILURE",
      "The diagnostic value exceeds the depth bound.",
    );
  if (value === null || typeof value === "boolean") return { ok: true, value };
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? { ok: true, value }
      : failure(
          "REDACTION_FAILURE",
          "The diagnostic value contains a non-finite number.",
        );
  }
  if (typeof value === "string") {
    const result = redactF29Text(value, options);
    return result.ok ? { ok: true, value: result.text } : result;
  }
  if (Array.isArray(value)) {
    if (value.length > 64)
      return failure(
        "REDACTION_FAILURE",
        "The diagnostic array exceeds the bound.",
      );
    const projected: F29SafeValue[] = [];
    for (const item of value) {
      const result = projectValue(item, options, depth + 1);
      if (!result.ok) return result;
      projected.push(result.value);
    }
    return { ok: true, value: projected };
  }
  if (!isPlainRecord(value))
    return failure(
      "PROVIDER_OUTPUT_REJECTED",
      "A non-plain object cannot cross the safe projection boundary.",
    );
  const entries = Object.entries(value);
  if (entries.length > 64)
    return failure(
      "REDACTION_FAILURE",
      "The diagnostic object exceeds the field bound.",
    );
  const projected: Record<string, F29SafeValue> = {};
  let redactedFieldIndex = 0;
  for (const [key, item] of entries) {
    if (!safeText(key, 128) || secretKeyPattern.test(key)) {
      let redactedKey = `redactedField${redactedFieldIndex}`;
      while (redactedKey in projected) {
        redactedFieldIndex += 1;
        redactedKey = `redactedField${redactedFieldIndex}`;
      }
      projected[redactedKey] = "[REDACTED]";
      redactedFieldIndex += 1;
      continue;
    }
    const result = projectValue(item, options, depth + 1);
    if (!result.ok) return result;
    projected[key] = result.value;
  }
  return { ok: true, value: projected };
}

export function projectF29SafeValue(
  value: unknown,
  options: F29ProjectionOptions = {},
): F29Result<F29SafeValue> {
  return projectValue(
    value,
    {
      knownSecrets: options.knownSecrets ?? [],
      maximumBytes: options.maximumBytes ?? F29_MAX_EVIDENCE_BYTES,
      maximumDepth: options.maximumDepth ?? 8,
    },
    0,
  );
}

export function parseF29SecurityReason(
  value: unknown,
): F29Result<F29SecurityReason> {
  const parsed = f29SecurityReasonSchema.safeParse(value);
  if (!parsed.success)
    return failure(
      "SECURITY_EVIDENCE_INCOMPLETE",
      "The security reason is not a bounded versioned projection.",
    );
  const safeTextFields = [
    parsed.data.operationId,
    parsed.data.what,
    parsed.data.why,
    ...parsed.data.evidenceRefs,
  ];
  const containsRedactableSecret = (text: string): boolean => {
    const redacted = redactF29Text(text, {
      maximumBytes: F29_MAX_REASON_BYTES,
    });
    return !redacted.ok || redacted.redacted;
  };
  const safeEvidenceContainsSecret = containsRedactableSecret(
    JSON.stringify(parsed.data.safeEvidence),
  );
  const reasonTextContainsSecret = safeTextFields.some(
    containsRedactableSecret,
  );
  const safeEvidenceHasSecretKey = Object.keys(parsed.data.safeEvidence).some(
    (key) => secretKeyPattern.test(key),
  );
  if (
    safeEvidenceContainsSecret ||
    safeEvidenceHasSecretKey ||
    reasonTextContainsSecret
  )
    return failure(
      "REDACTION_FAILURE",
      "The security reason contains a secret-shaped value.",
    );
  return { ok: true, value: parsed.data };
}

export function createF29SecurityReason(input: {
  readonly code: F29SecurityReasonCode;
  readonly boundary: F29SecurityBoundary;
  readonly operationId: string;
  readonly what: string;
  readonly why: string;
  readonly nextAction: F29NextAction;
  readonly retryable: boolean;
  readonly evidenceRefs?: readonly string[];
  readonly safeEvidence?: Readonly<Record<string, string | number | boolean>>;
}): F29Result<F29SecurityReason> {
  const reason: F29SecurityReason = {
    schemaVersion: F29_SECURITY_SCHEMA_VERSION,
    kind: "f29-security-reason",
    code: input.code,
    boundary: input.boundary,
    operationId: input.operationId,
    what: input.what,
    why: input.why,
    nextAction: input.nextAction,
    retryable: input.retryable,
    evidenceRefs: [...(input.evidenceRefs ?? [])],
    safeEvidence: { ...(input.safeEvidence ?? {}) },
  };
  const parsed = parseF29SecurityReason(reason);
  return parsed.ok ? parsed : failure(parsed.error.code, parsed.error.message);
}

export interface F29ParsedPullRequestUrl {
  readonly schemaVersion: typeof F29_SECURITY_SCHEMA_VERSION;
  readonly serverOrigin: string;
  readonly owner: string;
  readonly repository: string;
  readonly number: number;
  readonly normalizedUrl: string;
  readonly identity: string;
}

function rawPathIsAmbiguous(pathname: string): boolean {
  return (
    pathname.includes("\\") ||
    pathname.includes("//") ||
    /%(?:2f|2F|5c|5C|2e|2E)/u.test(pathname) ||
    pathname.split("/").some((part) => part === "." || part === "..")
  );
}

/** Strict, side-effect-free GitHub/GHES pull-request URL parsing. */
export function parseF29PullRequestUrl(
  value: unknown,
  configuredServerOrigin: string,
): F29Result<F29ParsedPullRequestUrl> {
  if (
    typeof value !== "string" ||
    !safeText(value, 2_048) ||
    byteLength(value) > 2_048 ||
    value.includes("?") ||
    value.includes("#")
  )
    return failure(
      "ROUTE_UNSUPPORTED",
      "The pull-request URL is not a bounded route without query or fragment data.",
    );
  let expected: URL;
  let parsed: URL;
  try {
    expected = new URL(configuredServerOrigin);
    parsed = new URL(value);
  } catch {
    return failure(
      "ROUTE_UNSUPPORTED",
      "The configured server or pull-request URL is invalid.",
    );
  }
  if (
    expected.protocol !== "https:" ||
    expected.username ||
    expected.password ||
    expected.search ||
    expected.hash ||
    expected.pathname !== "/" ||
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.origin.toLowerCase() !== expected.origin.toLowerCase() ||
    rawPathIsAmbiguous(parsed.pathname)
  )
    return failure(
      "ROUTE_IDENTITY_AMBIGUOUS",
      "The route does not match the configured HTTPS server identity.",
    );
  const parts = parsed.pathname.replace(/\/$/u, "").split("/");
  const owner = parts[1];
  const repository = parts[2];
  const numberText = parts[4];
  if (
    parts.length !== 5 ||
    parts[3] !== "pull" ||
    owner === undefined ||
    repository === undefined ||
    numberText === undefined ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u.test(owner) ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u.test(repository) ||
    !/^[1-9][0-9]{0,9}$/u.test(numberText)
  )
    return failure(
      "ROUTE_UNSUPPORTED",
      "Use the form /owner/repository/pull/number on the configured server.",
    );
  const number = Number(numberText);
  return {
    ok: true,
    value: {
      schemaVersion: F29_SECURITY_SCHEMA_VERSION,
      serverOrigin: expected.origin,
      owner,
      repository,
      number,
      normalizedUrl: `${expected.origin}/${owner}/${repository}/pull/${number}`,
      identity: `${expected.origin.toLowerCase()}:repo:${owner.toLowerCase()}/${repository.toLowerCase()}#${number}`,
    },
  };
}

export function parseF29OpenTarget(value: unknown): F29Result<OpenTarget> {
  const parsed = parseOpenTarget(value);
  return parsed.ok
    ? parsed
    : failure(
        "ROUTE_UNSUPPORTED",
        "The view target is not an allowlisted bounded route.",
      );
}

export type F29PathPlatform = "posix" | "win32";

export interface F29PathSyntaxOptions {
  readonly platform?: F29PathPlatform;
  readonly allowRelative?: boolean;
}

function hasWindowsDeviceOrUncSyntax(value: string): boolean {
  return /^(?:\\\\|\\\\\?\\|\\\\\.\\)/u.test(value);
}

function hasDriveRelativeSyntax(value: string): boolean {
  return /^[A-Za-z]:[^\\/]/u.test(value);
}

function hasParentSegment(value: string): boolean {
  return value.split(/[\\/]+/u).some((segment) => segment === "..");
}

export function validateF29PathSyntax(
  value: unknown,
  options: F29PathSyntaxOptions = {},
): F29Result<string> {
  const platform = options.platform ?? "posix";
  const allowRelative = options.allowRelative ?? false;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    byteLength(value) > F29_MAX_PATH_BYTES ||
    f29HasControlCharacter(value)
  )
    return failure(
      "PATH_UNSUPPORTED",
      "The path is empty, unbounded, or contains control characters.",
    );
  if (hasWindowsDeviceOrUncSyntax(value) || hasDriveRelativeSyntax(value))
    return failure(
      "PATH_UNSUPPORTED",
      "UNC, device, and drive-relative paths are not supported.",
    );
  const absolute =
    platform === "win32"
      ? /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("/")
      : value.startsWith("/");
  if (!absolute && !allowRelative)
    return failure(
      "PATH_UNSUPPORTED",
      "An absolute canonical path is required.",
    );
  if (allowRelative && (absolute || hasParentSegment(value)))
    return failure(
      "PATH_OUTSIDE_OPERATION",
      "The relative path must stay inside its operation and cannot traverse parents.",
    );
  return { ok: true, value };
}

function canonicalPathKey(value: string, platform: F29PathPlatform): string {
  const normalized = value.replace(/\\/gu, "/").replace(/\/\.\//gu, "/");
  const segments: string[] = [];
  for (const segment of normalized.split("/")) {
    if (segment === "" && segments.length === 0) {
      segments.push("");
      continue;
    }
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 1) segments.pop();
      continue;
    }
    segments.push(segment);
  }
  let result = segments.join("/");
  if (result.length > 1) result = result.replace(/\/+$/u, "");
  return platform === "win32" ? result.toLowerCase() : result;
}

export function f29PathWithin(
  root: string,
  candidate: string,
  platform: F29PathPlatform = "posix",
): boolean {
  const rootKey = canonicalPathKey(root, platform);
  const candidateKey = canonicalPathKey(candidate, platform);
  return candidateKey === rootKey || candidateKey.startsWith(`${rootKey}/`);
}

export interface F29OwnedPathInput {
  readonly operationId: string;
  readonly ownerOperationId: string;
  readonly operationRoot: string;
  readonly canonicalPath: string;
  readonly expectedType: "file" | "directory";
  readonly actualType: "file" | "directory" | "missing" | "symlink" | "other";
  readonly expectedRevision?: string;
  readonly currentRevision?: string;
  readonly developerClonePath?: string;
  readonly forbiddenRoots?: readonly string[];
  readonly platform?: F29PathPlatform;
}

export interface F29OwnedPath {
  readonly operationId: string;
  readonly canonicalPath: string;
  readonly expectedType: "file" | "directory";
}

export function validateF29OwnedPath(
  input: F29OwnedPathInput,
): F29Result<F29OwnedPath> {
  const platform = input.platform ?? "posix";
  for (const value of [input.operationId, input.ownerOperationId]) {
    if (!safeIdentifier(value))
      return failure(
        "PATH_OWNER_MISMATCH",
        "The operation identity is not a safe bounded identifier.",
      );
  }
  if (input.operationId !== input.ownerOperationId)
    return failure(
      "PATH_OWNER_MISMATCH",
      "The path belongs to a different operation.",
    );
  if (
    validateF29PathSyntax(input.operationRoot, { platform }).ok === false ||
    validateF29PathSyntax(input.canonicalPath, { platform }).ok === false
  )
    return failure(
      "PATH_UNSUPPORTED",
      "The operation root or target is not a supported canonical path.",
    );
  if (!f29PathWithin(input.operationRoot, input.canonicalPath, platform))
    return failure(
      "PATH_OUTSIDE_OPERATION",
      "The target is outside the operation-owned worktree.",
    );
  if (input.actualType === "symlink")
    return failure(
      "PATH_UNSAFE_SYMLINK",
      "Symlink and junction targets are not opened by the security boundary.",
    );
  if (input.actualType === "missing" || input.actualType === "other")
    return failure(
      "PATH_UNSUPPORTED",
      "The target no longer exists as a supported filesystem object.",
    );
  if (input.actualType !== input.expectedType)
    return failure(
      "PATH_TYPE_MISMATCH",
      "The target type does not match the requested operation.",
    );
  if (
    input.expectedRevision !== undefined &&
    input.currentRevision !== input.expectedRevision
  )
    return failure(
      "PATH_REVISION_STALE",
      "The operation worktree changed after the target was recorded.",
    );
  if (
    input.developerClonePath !== undefined &&
    canonicalPathKey(input.developerClonePath, platform) ===
      canonicalPathKey(input.canonicalPath, platform)
  )
    return failure(
      "PATH_OUTSIDE_OPERATION",
      "The developer clone is never an operation-owned open target.",
    );
  if (
    input.forbiddenRoots?.some((root) =>
      f29PathWithin(root, input.canonicalPath, platform),
    )
  )
    return failure(
      "PATH_OUTSIDE_OPERATION",
      "The target is inside a protected application or credential path.",
    );
  return {
    ok: true,
    value: {
      operationId: input.operationId,
      canonicalPath: input.canonicalPath,
      expectedType: input.expectedType,
    },
  };
}

export const F29_DEFAULT_ENVIRONMENT_KEYS = [
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "CI",
  "NODE_ENV",
  "ComSpec",
  "GIT_TERMINAL_PROMPT",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_OPTIONAL_LOCKS",
] as const;

export function isF29SensitiveEnvironmentKey(value: string): boolean {
  return (
    secretKeyPattern.test(value) ||
    /(?:^|[_-])(?:GH|GITHUB|OPENAI|CODEX)(?:$|[_-])/iu.test(value)
  );
}

export function createF29ControlledEnvironment(input: {
  readonly source: Record<string, string | undefined>;
  readonly allowedKeys?: readonly string[];
  readonly knownSecrets?: readonly string[];
  readonly strict?: boolean;
}): F29Result<Record<string, string>> {
  const allowed = new Map(
    (input.allowedKeys ?? F29_DEFAULT_ENVIRONMENT_KEYS).map((key) => [
      key.toLowerCase(),
      key,
    ]),
  );
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.source)) {
    if (isF29SensitiveEnvironmentKey(key))
      return failure(
        "CREDENTIAL_BOUNDARY_VIOLATION",
        "A credential-shaped environment key cannot cross the child-process boundary.",
      );
    const canonicalKey = allowed.get(key.toLowerCase());
    if (canonicalKey === undefined) {
      if (input.strict && value !== undefined)
        return failure(
          "PROCESS_ENVIRONMENT_REJECTED",
          `Environment key ${key} is not allowlisted.`,
        );
      continue;
    }
    if (value === undefined) continue;
    if (!safeText(value, F29_MAX_ENVIRONMENT_VALUE_BYTES))
      return failure(
        "PROCESS_ENVIRONMENT_REJECTED",
        "An environment value is unbounded or contains control characters.",
      );
    if (
      input.knownSecrets?.some(
        (secret) => secret.length > 0 && value.includes(secret),
      )
    )
      return failure(
        "CREDENTIAL_BOUNDARY_VIOLATION",
        "A known credential value was found in the child environment.",
      );
    result[canonicalKey] = value;
  }
  return { ok: true, value: result };
}

export const F29_GIT_OPERATIONS = [
  "add",
  "cat-file",
  "clean",
  "clone",
  "diff",
  "fetch",
  "ls-files",
  "ls-remote",
  "merge-base",
  "merge",
  "reset",
  "rev-parse",
  "status",
  "worktree",
  "commit",
  "push",
  "show",
] as const;

const forbiddenGitArgumentPattern =
  /^(?:--force(?:-with-lease)?(?:=|$)|-f$|--upload-pack(?:=|$)|--receive-pack(?:=|$)|--exec-path(?:=|$)|--git-dir(?:=|$)|--work-tree(?:=|$)|--config-env(?:=|$)|-c(?:=|$))/u;

export function validateF29GitArguments(
  args: readonly string[],
): F29Result<readonly string[]> {
  const operation = args[0];
  if (
    operation === undefined ||
    !F29_GIT_OPERATIONS.includes(
      operation as (typeof F29_GIT_OPERATIONS)[number],
    ) ||
    args.length === 0 ||
    args.length > 64
  )
    return failure(
      "GIT_ARGUMENT_REJECTED",
      "The Git operation is not allowlisted.",
    );
  if (
    args.some(
      (argument) =>
        !safeText(argument, F29_MAX_ARGUMENT_BYTES) ||
        forbiddenGitArgumentPattern.test(argument),
    )
  )
    return failure(
      "GIT_ARGUMENT_REJECTED",
      "The Git argument contains control, option-injection, or force-update syntax.",
    );
  if (args.some((argument) => argument.includes("--force")))
    return failure(
      "GIT_ARGUMENT_REJECTED",
      "Force updates are never admitted by F29.",
    );
  return { ok: true, value: [...args] };
}

export interface F29GitInvocation {
  readonly operationId: string;
  readonly repositoryIdentity: string;
  readonly cwd: string;
  readonly args: readonly string[];
  readonly shell: false;
  readonly expectedShas: readonly string[];
}

export function prepareF29GitInvocation(input: {
  readonly operationId: string;
  readonly repositoryIdentity: string;
  readonly cwd: string;
  readonly args: readonly string[];
  readonly expectedShas?: readonly string[];
  readonly platform?: F29PathPlatform;
}): F29Result<F29GitInvocation> {
  if (
    !safeIdentifier(input.operationId) ||
    !safeIdentifier(input.repositoryIdentity)
  )
    return failure(
      "GIT_IDENTITY_MISMATCH",
      "The Git operation identity is not bounded.",
    );
  const cwd = validateF29PathSyntax(input.cwd, {
    platform: input.platform ?? "posix",
    allowRelative: false,
  });
  if (!cwd.ok) return cwd;
  const arguments_ = validateF29GitArguments(input.args);
  if (!arguments_.ok) return arguments_;
  const expectedShas = [...(input.expectedShas ?? [])];
  if (expectedShas.some((sha) => !shaPattern.test(sha)))
    return failure(
      "GIT_IDENTITY_MISMATCH",
      "Git identity evidence contains an invalid SHA.",
    );
  return {
    ok: true,
    value: {
      operationId: input.operationId,
      repositoryIdentity: input.repositoryIdentity,
      cwd: cwd.value,
      args: arguments_.value,
      shell: false,
      expectedShas,
    },
  };
}

export type F29SandboxMode = "read-only" | "workspace-write" | "full-access";
export type F29NetworkMode = "disabled" | "enabled";
export type F29ApprovalPolicy = "never" | "on-request";

export interface F29PolicySnapshot {
  readonly taskType: string;
  readonly interactionMode: "read_only" | "worktree_write";
  readonly sandboxMode: F29SandboxMode;
  readonly networkAccess: F29NetworkMode;
  readonly approvalPolicy: F29ApprovalPolicy;
  readonly controlledEnvironment: boolean;
  readonly writableRoot?: string;
  readonly publicationAuthority: false;
  readonly snapshotHash: string;
}

export interface F29CapabilityRequest {
  readonly operationId: string;
  readonly policy: F29PolicySnapshot;
  readonly worktreeOperationId?: string;
  readonly requestedWritableRoot?: string;
  readonly requestedNetworkAccess?: F29NetworkMode;
  readonly requestedSandboxMode?: F29SandboxMode;
  readonly requestedApprovalPolicy?: F29ApprovalPolicy;
  readonly requestedExtraPaths?: readonly string[];
  readonly requestedCredentialKinds?: readonly (
    "provider" | "github_publication" | "secure_store"
  )[];
  readonly requestedPublicationAuthority?: boolean;
  readonly mutating?: boolean;
}

export function evaluateF29Capability(
  input: F29CapabilityRequest,
): F29Result<{ readonly admitted: true; readonly operationId: string }> {
  if (
    !safeIdentifier(input.operationId) ||
    input.policy.publicationAuthority !== false
  )
    return failure(
      "POLICY_BOUNDARY_VIOLATION",
      "The policy snapshot is not a safe provider-neutral snapshot.",
    );
  if (
    input.worktreeOperationId !== undefined &&
    input.worktreeOperationId !== input.operationId
  )
    return failure(
      "PATH_OWNER_MISMATCH",
      "The provider request names another operation's worktree.",
    );
  if (!input.policy.controlledEnvironment)
    return failure(
      "POLICY_UNSUPPORTED",
      "The provider cannot prove a controlled environment.",
    );
  if (input.requestedPublicationAuthority === true)
    return failure(
      "PUBLICATION_AUTHORITY_DENIED",
      "Provider and renderer contexts never receive publication authority.",
    );
  if ((input.requestedExtraPaths ?? []).length > 0)
    return failure(
      "POLICY_BOUNDARY_VIOLATION",
      "Additional writable paths are outside the operation-owned worktree.",
    );
  if (
    input.requestedWritableRoot !== undefined &&
    input.policy.writableRoot !== input.requestedWritableRoot
  )
    return failure(
      "PATH_OUTSIDE_OPERATION",
      "The requested writable root is not the snapshotted operation worktree.",
    );
  if (
    input.requestedNetworkAccess === "enabled" &&
    input.policy.networkAccess === "disabled"
  )
    return failure(
      "POLICY_BOUNDARY_VIOLATION",
      "The request attempts to broaden disabled network access.",
    );
  if (
    input.requestedSandboxMode === "full-access" ||
    (input.requestedSandboxMode === "workspace-write" &&
      input.policy.sandboxMode === "read-only")
  )
    return failure(
      "POLICY_UNSUPPORTED",
      "The requested sandbox is broader than the effective policy.",
    );
  if (
    input.requestedApprovalPolicy === "never" &&
    input.policy.approvalPolicy === "on-request"
  )
    return failure(
      "POLICY_BOUNDARY_VIOLATION",
      "The request attempts to remove an approval floor.",
    );
  if (
    (input.requestedCredentialKinds ?? []).some((kind) => kind !== "provider")
  )
    return failure(
      "CREDENTIAL_BOUNDARY_VIOLATION",
      "Only the configured provider credential may reach a provider adapter.",
    );
  if (
    input.mutating === true &&
    (input.policy.interactionMode !== "worktree_write" ||
      input.policy.writableRoot === undefined)
  )
    return failure(
      "POLICY_BOUNDARY_VIOLATION",
      "A mutating turn requires the explicit worktree-write policy floor.",
    );
  if (
    input.policy.taskType === "REVIEW_PROPOSAL" ||
    input.policy.taskType === "READ_ONLY_CONVERSATION"
  ) {
    if (input.mutating === true || input.policy.interactionMode !== "read_only")
      return failure(
        "POLICY_BOUNDARY_VIOLATION",
        "Proposal and read-only conversation tasks cannot mutate files.",
      );
  }
  return {
    ok: true,
    value: { admitted: true, operationId: input.operationId },
  };
}

export function evaluateF29EffectAdmission(input: {
  readonly operationId: string;
  readonly expectedOperationId: string;
  readonly actor: "main_service" | "renderer" | "provider" | "validation";
  readonly ownerService:
    "review_publication" | "sync_publication" | "response_publisher" | "none";
  readonly humanApproval: boolean;
  readonly persistedIntent: boolean;
  readonly freshState: boolean;
  readonly proposalStage?: boolean;
  readonly forceRequested?: boolean;
}): F29Result<{ readonly admitted: true }> {
  if (input.operationId !== input.expectedOperationId)
    return failure(
      "GIT_IDENTITY_MISMATCH",
      "The requested effect does not match the current operation identity.",
    );
  if (input.actor !== "main_service")
    return failure(
      "PUBLICATION_AUTHORITY_DENIED",
      "Only the owning deterministic main-process service may perform the effect.",
    );
  if (input.ownerService === "none")
    return failure(
      "PUBLICATION_AUTHORITY_DENIED",
      "No generic effect service can perform a publication operation.",
    );
  if (input.proposalStage === true)
    return failure(
      "PUBLICATION_AUTHORITY_DENIED",
      "Proposal-stage work remains read-only until human decisions are complete.",
    );
  if (!input.humanApproval || !input.persistedIntent || !input.freshState)
    return failure(
      "PUBLICATION_AUTHORITY_DENIED",
      "Human approval, durable intent, and fresh state are required before publication.",
    );
  if (input.forceRequested === true)
    return failure(
      "GIT_ARGUMENT_REJECTED",
      "Force publication is never admitted.",
    );
  return { ok: true, value: { admitted: true } };
}

export interface F29ThreatModelEntry {
  readonly id: string;
  readonly boundary: F29SecurityBoundary;
  readonly dataClass: F29DataClass;
  readonly owner: string;
  readonly allowlist: string;
  readonly failureReason: F29SecurityReasonCode;
  readonly evidence: readonly string[];
  readonly residualRisk: string;
}

export const F29_THREAT_MODEL_ENTRIES: readonly F29ThreatModelEntry[] = [
  {
    id: "TB-01",
    boundary: "renderer_ipc",
    dataClass: "privileged_control_state",
    owner: "F04 IPC router and preload",
    allowlist: "Versioned channels, typed payloads, live renderer session",
    failureReason: "IPC_SCHEMA_REJECTED",
    evidence: ["CT-F29-02", "apps/desktop/tests/f29-security.test.ts"],
    residualRisk:
      "A compromised renderer still runs inside the user's local OS process boundary.",
  },
  {
    id: "TB-02",
    boundary: "route_url",
    dataClass: "public_remote_metadata",
    owner: "F06 URL identity and F04 routing",
    allowlist: "HTTPS configured server origin and prmonitor view targets",
    failureReason: "ROUTE_IDENTITY_AMBIGUOUS",
    evidence: ["CT-F29-03", "apps/desktop/tests/f29-security.test.ts"],
    residualRisk:
      "Remote metadata may still be hostile text and remains untrusted context.",
  },
  {
    id: "TB-03",
    boundary: "filesystem_worktree",
    dataClass: "private_source_context",
    owner: "F13 worktree service",
    allowlist: "Canonical current paths inside the recorded operation worktree",
    failureReason: "PATH_OUTSIDE_OPERATION",
    evidence: ["CT-F29-04", "apps/desktop/tests/f29-security.test.ts"],
    residualRisk:
      "The local user can modify files and filesystem links outside application control.",
  },
  {
    id: "TB-04",
    boundary: "git",
    dataClass: "privileged_control_state",
    owner: "F13 Git command runner",
    allowlist: "Structured allowlisted Git argv with no shell or force flags",
    failureReason: "GIT_ARGUMENT_REJECTED",
    evidence: ["CT-F29-04", "apps/desktop/src/main/f13-git.ts"],
    residualRisk:
      "A repository-controlled Git hook or local Git configuration can attempt OS actions.",
  },
  {
    id: "TB-05",
    boundary: "validation_process",
    dataClass: "private_source_context",
    owner: "F00/F14 validation contract and runner",
    allowlist:
      "Trusted structured executable, args, cwd, environment, time, and output bounds",
    failureReason: "PROCESS_COMMAND_REJECTED",
    evidence: [
      "CT-F29-05",
      "packages/validation-contract/tests/execution-and-output.test.ts",
    ],
    residualRisk:
      "Validation intentionally executes repository-controlled code within its declared boundary.",
  },
  {
    id: "TB-06",
    boundary: "database",
    dataClass: "privileged_control_state",
    owner: "F03 persistence",
    allowlist: "Main-process application-data database path",
    failureReason: "DATABASE_PATH_REJECTED",
    evidence: ["CT-F29-05", "apps/desktop/tests/f29-security.test.ts"],
    residualRisk:
      "A user with write access to application data can still damage local state.",
  },
  {
    id: "TB-07",
    boundary: "credential",
    dataClass: "credential_secret",
    owner: "F05 secure credential store",
    allowlist:
      "Opaque references in SQLite and scoped secure-store reads in main process",
    failureReason: "CREDENTIAL_BOUNDARY_VIOLATION",
    evidence: ["CT-F29-06", "apps/desktop/tests/f05-github-auth.test.ts"],
    residualRisk:
      "Secure-store availability and host account protection remain OS responsibilities.",
  },
  {
    id: "TB-08",
    boundary: "provider_policy",
    dataClass: "private_source_context",
    owner: "F15-F17 provider and bounded-work contracts",
    allowlist:
      "Normalized schema, snapshotted policy, operation worktree, provider credential only",
    failureReason: "POLICY_BOUNDARY_VIOLATION",
    evidence: [
      "CT-F29-07",
      "CT-F29-08",
      "apps/desktop/tests/f15-ai-provider.test.ts",
    ],
    residualRisk:
      "No application-level contract guarantees a local process will not attempt available OS actions.",
  },
  {
    id: "TB-09",
    boundary: "diagnostics_recovery",
    dataClass: "privileged_control_state",
    owner: "F09 diagnostics and F28 recovery",
    allowlist:
      "Bounded redacted reason, operation, evidence, retryability, and next action",
    failureReason: "REDACTION_FAILURE",
    evidence: ["CT-F29-09", "apps/desktop/tests/f28-recovery.test.ts"],
    residualRisk:
      "Evidence is diagnostic and cannot replace the owning state machine.",
  },
  {
    id: "TB-10",
    boundary: "dependency_runtime",
    dataClass: "privileged_control_state",
    owner: "F29 gate and F30 release",
    allowlist:
      "Committed lockfile, supported runtime, static import and audit evidence",
    failureReason: "DEPENDENCY_GATE_FAILED",
    evidence: ["CT-F29-10", "scripts/f29-security-gate.mjs"],
    residualRisk:
      "The MVP does not promise code signing, updater, or absolute supply-chain elimination.",
  },
];

export function validateF29ThreatModel(): F29Result<
  readonly F29ThreatModelEntry[]
> {
  const expected = new Set(F29_SECURITY_BOUNDARIES);
  if (F29_THREAT_MODEL_ENTRIES.length !== expected.size)
    return failure(
      "SECURITY_EVIDENCE_INCOMPLETE",
      "The threat model does not cover every F29 boundary.",
    );
  for (const entry of F29_THREAT_MODEL_ENTRIES) {
    if (!expected.delete(entry.boundary))
      return failure(
        "SECURITY_EVIDENCE_INCOMPLETE",
        "The threat model contains a duplicate or unknown boundary.",
      );
    if (
      !safeIdentifier(entry.id) ||
      !safeText(entry.owner, 256) ||
      !safeText(entry.allowlist, 512) ||
      !safeText(entry.residualRisk, 512) ||
      entry.evidence.length === 0
    )
      return failure(
        "SECURITY_EVIDENCE_INCOMPLETE",
        "Every threat-model row requires bounded ownership, mitigation, evidence, and residual risk.",
      );
  }
  return expected.size === 0
    ? { ok: true, value: F29_THREAT_MODEL_ENTRIES }
    : failure(
        "SECURITY_EVIDENCE_INCOMPLETE",
        "The threat model is missing a boundary owner.",
      );
}
