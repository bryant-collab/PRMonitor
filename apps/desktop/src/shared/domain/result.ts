export const DOMAIN_SCHEMA_VERSION = 1 as const;

export type SafeJsonPrimitive = string | number | boolean | null;
export type SafeJsonValue =
  | SafeJsonPrimitive
  | readonly SafeJsonValue[]
  | { readonly [key: string]: SafeJsonValue };
export type SafeDetails = { readonly [key: string]: SafeJsonValue };

export type DomainErrorCategory =
  | "INVALID_INPUT"
  | "INVALID_TRANSITION"
  | "CONFLICT"
  | "HOLD"
  | "PAUSED"
  | "STALE"
  | "CANCELLED"
  | "RETRYABLE_FAILURE"
  | "PERMANENT_FAILURE"
  | "UNKNOWN_EXTERNAL_OUTCOME"
  | "UNSUPPORTED_VERSION"
  | "SECURITY_VIOLATION"
  | "NOT_ELIGIBLE"
  | "DUPLICATE"
  | "ALREADY_COMPLETE";

export type DomainErrorCode =
  | "INVALID_INPUT"
  | "INVALID_CONTRACT"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "SECURITY_VIOLATION"
  | "INVALID_TRANSITION"
  | "REVIEW_HOLD_ACTIVE"
  | "WATCHING_PAUSED"
  | "CONCURRENT_STATE_CONFLICT"
  | "NO_ACTIONABLE_EVENT"
  | "DUPLICATE_ACTION"
  | "DUPLICATE_EVENT_VERSION"
  | "EVENT_VERSION_ALREADY_HANDLED"
  | "STALE_RESULT"
  | "CANCELLATION_REQUIRES_REVIEW"
  | "PUBLICATION_APPROVAL_REQUIRED"
  | "PUBLICATION_ALREADY_ACTIVE"
  | "UNKNOWN_EXTERNAL_OUTCOME"
  | "FORBIDDEN_PUBLICATION_AUTHORITY"
  | "TERMINAL_HISTORY_IMMUTABLE"
  | "NOT_ELIGIBLE";

export type UserAction =
  | "NONE"
  | "RETRY"
  | "RECONCILE"
  | "REVIEW"
  | "CONTINUE"
  | "RE_EVALUATE"
  | "DISCARD"
  | "FIX_INPUT"
  | "APPROVE"
  | "MANUAL_EDIT";

export const USER_ACTIONS: readonly UserAction[] = [
  "NONE",
  "RETRY",
  "RECONCILE",
  "REVIEW",
  "CONTINUE",
  "RE_EVALUATE",
  "DISCARD",
  "FIX_INPUT",
  "APPROVE",
  "MANUAL_EDIT",
];

export const DOMAIN_ERROR_CODES: readonly DomainErrorCode[] = [
  "INVALID_INPUT",
  "INVALID_CONTRACT",
  "UNSUPPORTED_SCHEMA_VERSION",
  "SECURITY_VIOLATION",
  "INVALID_TRANSITION",
  "REVIEW_HOLD_ACTIVE",
  "WATCHING_PAUSED",
  "CONCURRENT_STATE_CONFLICT",
  "NO_ACTIONABLE_EVENT",
  "DUPLICATE_ACTION",
  "DUPLICATE_EVENT_VERSION",
  "EVENT_VERSION_ALREADY_HANDLED",
  "STALE_RESULT",
  "CANCELLATION_REQUIRES_REVIEW",
  "PUBLICATION_APPROVAL_REQUIRED",
  "PUBLICATION_ALREADY_ACTIVE",
  "UNKNOWN_EXTERNAL_OUTCOME",
  "FORBIDDEN_PUBLICATION_AUTHORITY",
  "TERMINAL_HISTORY_IMMUTABLE",
  "NOT_ELIGIBLE",
];

export const DOMAIN_ERROR_CATEGORIES: readonly DomainErrorCategory[] = [
  "INVALID_INPUT",
  "INVALID_TRANSITION",
  "CONFLICT",
  "HOLD",
  "PAUSED",
  "STALE",
  "CANCELLED",
  "RETRYABLE_FAILURE",
  "PERMANENT_FAILURE",
  "UNKNOWN_EXTERNAL_OUTCOME",
  "UNSUPPORTED_VERSION",
  "SECURITY_VIOLATION",
  "NOT_ELIGIBLE",
  "DUPLICATE",
  "ALREADY_COMPLETE",
];

export type ReasonCode = string;

export interface ActionReason {
  readonly schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  readonly kind: "action-reason";
  readonly code: ReasonCode;
  readonly messageKey: string;
  readonly what: string;
  readonly why: string;
  readonly nextAction: UserAction;
  readonly details: SafeDetails;
}

export interface DomainError {
  readonly schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  readonly kind: "domain-error";
  readonly code: DomainErrorCode;
  readonly category: DomainErrorCategory;
  readonly retryable: boolean;
  readonly userAction: UserAction;
  readonly messageKey: string;
  readonly reason: ActionReason;
  readonly details: SafeDetails;
  readonly priorState?: string;
  readonly currentState?: string;
  readonly correlationId?: string;
}

export type DomainResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DomainError };

export interface ReasonInput {
  readonly code: ReasonCode;
  readonly messageKey: string;
  readonly what: string;
  readonly why: string;
  readonly nextAction: UserAction;
  readonly details?: SafeDetails;
}

export interface DomainErrorInput {
  readonly code: DomainErrorCode;
  readonly category: DomainErrorCategory;
  readonly retryable: boolean;
  readonly userAction: UserAction;
  readonly messageKey: string;
  readonly reason: ActionReason;
  readonly details?: SafeDetails;
  readonly priorState?: string;
  readonly currentState?: string;
  readonly correlationId?: string;
}

const UNSAFE_KEY_PATTERN =
  /(?:token|secret|password|credential|authorization|cookie|prompt|api[_.-]?key|access[_.-]?key|sdk|exception|environment|env)/iu;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isSafeJsonValue(value: unknown): value is SafeJsonValue {
  if (value === null) return true;
  if (typeof value === "string") return isSafeText(value);
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) {
    return value.every((item) => isSafeJsonValue(item));
  }
  if (!isPlainRecord(value)) return false;
  return Object.entries(value).every(
    ([key, item]) => !UNSAFE_KEY_PATTERN.test(key) && isSafeJsonValue(item),
  );
}

export function isSafeText(value: unknown): value is string {
  if (typeof value !== "string") return false;
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code !== undefined && (code <= 31 || code === 127)) return false;
  }
  return true;
}

export function isSafeDetails(value: unknown): value is SafeDetails {
  return isPlainRecord(value) && isSafeJsonValue(value);
}

export function success<T>(value: T): DomainResult<T> {
  return { ok: true, value };
}

export function failure<T = never>(error: DomainError): DomainResult<T> {
  return { ok: false, error };
}

export function createReason(input: ReasonInput): DomainResult<ActionReason> {
  if (
    !isSafeText(input.code) ||
    !isSafeText(input.messageKey) ||
    !isSafeText(input.what) ||
    !isSafeText(input.why) ||
    input.code.length === 0 ||
    input.messageKey.length === 0 ||
    input.what.length === 0 ||
    input.why.length === 0 ||
    !USER_ACTIONS.includes(input.nextAction) ||
    (input.details !== undefined && !isSafeDetails(input.details))
  ) {
    return failure(
      createDomainError({
        code: "SECURITY_VIOLATION",
        category: "SECURITY_VIOLATION",
        retryable: false,
        userAction: "FIX_INPUT",
        messageKey: "domain.reason.invalid",
        reason: unsafeReason(
          "INVALID_REASON",
          "The domain reason contains unsupported or unsafe data.",
          "Reason data must contain only bounded plain text and safe structured details.",
          "FIX_INPUT",
        ),
      }),
    );
  }
  return success({
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    kind: "action-reason",
    code: input.code,
    messageKey: input.messageKey,
    what: input.what,
    why: input.why,
    nextAction: input.nextAction,
    details: input.details ?? {},
  });
}

export function createDomainError(input: DomainErrorInput): DomainError {
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    kind: "domain-error",
    code: input.code,
    category: input.category,
    retryable: input.retryable,
    userAction: input.userAction,
    messageKey: input.messageKey,
    reason: input.reason,
    details: input.details ?? {},
    ...(input.priorState === undefined ? {} : { priorState: input.priorState }),
    ...(input.currentState === undefined
      ? {}
      : { currentState: input.currentState }),
    ...(input.correlationId === undefined
      ? {}
      : { correlationId: input.correlationId }),
  };
}

export function unsafeReason(
  code: string,
  what: string,
  why: string,
  nextAction: UserAction,
  details: SafeDetails = {},
): ActionReason {
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    kind: "action-reason",
    code,
    messageKey: `domain.reason.${code.toLowerCase()}`,
    what,
    why,
    nextAction,
    details,
  };
}

function invalidContract(
  message: string,
  details: SafeDetails = {},
): DomainError {
  return createDomainError({
    code: "INVALID_CONTRACT",
    category: "INVALID_INPUT",
    retryable: false,
    userAction: "FIX_INPUT",
    messageKey: "domain.contract.invalid",
    reason: unsafeReason(
      "INVALID_CONTRACT",
      message,
      message,
      "FIX_INPUT",
      details,
    ),
    details,
  });
}

export function readStrictRecord(
  value: unknown,
  label: string,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): DomainResult<Readonly<Record<string, unknown>>> {
  if (!isPlainRecord(value)) {
    return failure(
      invalidContract(`${label} must be a plain object.`, { label }),
    );
  }
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const keys = Object.keys(value);
  const unknownKey = keys.find((key) => !allowed.has(key));
  if (unknownKey !== undefined) {
    return failure(
      invalidContract(`${label} contains an unsupported field.`, {
        label,
        field: unknownKey,
      }),
    );
  }
  const missingKey = requiredKeys.find((key) => !(key in value));
  if (missingKey !== undefined) {
    return failure(
      invalidContract(`${label} is missing a required field.`, {
        label,
        field: missingKey,
      }),
    );
  }
  return success(value);
}

export function parseDomainReason(value: unknown): DomainResult<ActionReason> {
  const record = readStrictRecord(value, "action reason", [
    "schemaVersion",
    "kind",
    "code",
    "messageKey",
    "what",
    "why",
    "nextAction",
    "details",
  ]);
  if (!record.ok) return record;
  const data = record.value;
  if (
    data.schemaVersion !== DOMAIN_SCHEMA_VERSION ||
    data.kind !== "action-reason" ||
    typeof data.code !== "string" ||
    typeof data.messageKey !== "string" ||
    typeof data.what !== "string" ||
    typeof data.why !== "string" ||
    typeof data.nextAction !== "string" ||
    !USER_ACTIONS.includes(data.nextAction as UserAction) ||
    !isSafeDetails(data.details) ||
    !isSafeText(data.code) ||
    !isSafeText(data.messageKey) ||
    !isSafeText(data.what) ||
    !isSafeText(data.why)
  ) {
    return failure(invalidContract("action reason contains invalid values."));
  }
  return success(data as unknown as ActionReason);
}

export function parseDomainError(value: unknown): DomainResult<DomainError> {
  const record = readStrictRecord(
    value,
    "domain error",
    [
      "schemaVersion",
      "kind",
      "code",
      "category",
      "retryable",
      "userAction",
      "messageKey",
      "reason",
      "details",
    ],
    ["priorState", "currentState", "correlationId"],
  );
  if (!record.ok) return record;
  const data = record.value;
  const reason = parseDomainReason(data.reason);
  if (!reason.ok) return reason;
  if (
    data.schemaVersion !== DOMAIN_SCHEMA_VERSION ||
    data.kind !== "domain-error" ||
    typeof data.code !== "string" ||
    typeof data.category !== "string" ||
    typeof data.retryable !== "boolean" ||
    typeof data.userAction !== "string" ||
    !DOMAIN_ERROR_CODES.includes(data.code as DomainErrorCode) ||
    !DOMAIN_ERROR_CATEGORIES.includes(data.category as DomainErrorCategory) ||
    !USER_ACTIONS.includes(data.userAction as UserAction) ||
    typeof data.messageKey !== "string" ||
    !isSafeDetails(data.details) ||
    (data.priorState !== undefined && typeof data.priorState !== "string") ||
    (data.currentState !== undefined &&
      typeof data.currentState !== "string") ||
    (data.correlationId !== undefined && typeof data.correlationId !== "string")
  ) {
    return failure(invalidContract("domain error contains invalid values."));
  }
  return success({ ...(data as unknown as DomainError), reason: reason.value });
}

export function parseSafeDetails(value: unknown): DomainResult<SafeDetails> {
  if (!isSafeDetails(value)) {
    return failure(
      invalidContract("details contain unsupported or unsafe values."),
    );
  }
  return success(value);
}
