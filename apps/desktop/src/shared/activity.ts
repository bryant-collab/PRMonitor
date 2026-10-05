import { parseOpenTargetRecord, type OpenTarget } from "./routing";
import { activityScope } from "./activity-presentation";

export const ACTIVITY_SCHEMA_VERSION = 1 as const;
export const ACTIVITY_MAX_PAGE_SIZE = 200;
export const ACTIVITY_DEFAULT_PAGE_SIZE = 50;
export const ACTIVITY_MAX_SUMMARY_BYTES = 512;
export const ACTIVITY_MAX_REASON_BYTES = 1_024;
export const ACTIVITY_MAX_DETAIL_BYTES = 16 * 1024;
export const ACTIVITY_MAX_DETAIL_DEPTH = 8;
export const ACTIVITY_MAX_DETAIL_COLLECTION = 64;
export const ACTIVITY_RETENTION_MAX_AGE_DAYS = 30;
export const ACTIVITY_RETENTION_MAX_EVENTS = 50_000;
export const ACTIVITY_RETENTION_MAX_BYTES = 64 * 1024 * 1024;

export const ACTIVITY_EVENT_TYPES = [
  "OPERATION_STARTED",
  "OPERATION_WAITING",
  "OPERATION_PROGRESS",
  "OPERATION_SUCCEEDED",
  "OPERATION_FAILED",
  "OPERATION_CANCELLED",
  "OPERATION_RETRYING",
  "OPERATION_UNKNOWN_OUTCOME",
  "OPERATION_RECONCILED",
  "POLL_STARTED",
  "POLL_PROGRESS",
  "POLL_COMPLETED",
  "POLL_FAILED",
  "BATCH_STARTED",
  "BATCH_WAITING",
  "BATCH_COMPLETED",
  "AI_TURN_STARTED",
  "AI_TURN_COMPLETED",
  "AI_TURN_FAILED",
  "VALIDATION_STARTED",
  "VALIDATION_COMPLETED",
  "VALIDATION_FAILED",
  "NOTIFICATION_SENT",
  "NOTIFICATION_FAILED",
  "SYNC_STARTED",
  "SYNC_COMPLETED",
  "SYNC_FAILED",
  "PUBLICATION_INTENT",
  "PUBLICATION_ATTEMPTED",
  "PUBLICATION_SUCCEEDED",
  "PUBLICATION_FAILED",
  "PUBLICATION_UNKNOWN_OUTCOME",
  "PUBLICATION_RECONCILED",
  "LIFECYCLE_STARTED",
  "LIFECYCLE_COMPLETED",
  "LIFECYCLE_FAILED",
  "RECOVERY_STARTED",
  "RECOVERY_COMPLETED",
  "RECOVERY_FAILED",
  "ACTIVITY_RETENTION_COMPLETED",
  "ACTIVITY_RETENTION_FAILED",
  "LEGACY_ACTIVITY",
] as const;
export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

export const ACTIVITY_STAGES = [
  "SYSTEM",
  "LIFECYCLE",
  "POLLING",
  "BATCHING",
  "REVIEW",
  "AI",
  "VALIDATION",
  "NOTIFICATION",
  "SYNCHRONIZATION",
  "PUBLICATION",
  "RECOVERY",
  "RETENTION",
  "GIT",
  "WORKTREE",
] as const;
export type ActivityStage = (typeof ACTIVITY_STAGES)[number];

export const ACTIVITY_SEVERITIES = [
  "DEBUG",
  "INFO",
  "WARNING",
  "ERROR",
  "CRITICAL",
] as const;
export type ActivitySeverity = (typeof ACTIVITY_SEVERITIES)[number];

export const ACTIVITY_NEXT_ACTIONS = [
  "NONE",
  "WAIT",
  "RETRY",
  "RECONCILE",
  "REVIEW",
  "CONTINUE",
  "RE_EVALUATE",
  "DISCARD",
  "FIX_INPUT",
  "APPROVE",
  "MANUAL_EDIT",
  "OPEN_DETAILS",
] as const;
export type ActivityNextAction = (typeof ACTIVITY_NEXT_ACTIONS)[number];

// This catalog intentionally includes the existing F04/F05/F07 reason values
// so older main-process producers can move to the structured envelope without
// inventing a parallel logging vocabulary.
export const ACTIVITY_REASON_CODES = [
  "STARTED",
  "WAITING",
  "PROGRESS",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "RETRYING",
  "UNKNOWN_OUTCOME",
  "RECONCILED",
  "LIFECYCLE_STARTING",
  "LIFECYCLE_RUNNING",
  "INCOMPLETE_LIFECYCLE_HANDOFF",
  "SERVICE_START_FAILED",
  "SHUTDOWN_REQUESTED",
  "SHUTDOWN_INTENT_COMMITTED",
  "SERVICE_HANDOFF_STARTED",
  "SHUTDOWN_COMPLETE",
  "SERVICE_HANDOFF_FAILED",
  "SERVICE_STOP_FAILED",
  "SERVICE_STOP_TIMEOUT",
  "SERVICE_HANDOFF_TIMEOUT",
  "POLL_STARTED",
  "POLL_PROGRESS",
  "POLL_COMPLETED",
  "POLL_FAILED",
  "BATCH_STARTED",
  "BATCH_WAITING",
  "BATCH_COMPLETED",
  "AI_TURN_STARTED",
  "AI_TURN_COMPLETED",
  "AI_TURN_FAILED",
  "VALIDATION_STARTED",
  "VALIDATION_COMPLETED",
  "VALIDATION_FAILED",
  "NOTIFICATION_SENT",
  "NOTIFICATION_FAILED",
  "SYNC_STARTED",
  "SYNC_READY",
  "SYNC_COMPLETED",
  "SYNC_FAILED",
  "PUBLICATION_INTENT",
  "PUBLICATION_ATTEMPTED",
  "PUBLICATION_SUCCEEDED",
  "PUBLICATION_FAILED",
  "PUBLICATION_UNKNOWN_OUTCOME",
  "PUBLICATION_RECONCILED",
  "REDACTION_FAILED",
  "ACTIVITY_RETENTION_COMPLETED",
  "ACTIVITY_RETENTION_FAILED",
  "ACTIVITY_DATABASE_UNAVAILABLE",
  "UNSUPPORTED_TARGET",
  "NO_ACTION",
] as const;
export type ActivityReasonCode = (typeof ACTIVITY_REASON_CODES)[number];

export const ACTIVITY_ATTEMPT_OUTCOMES = [
  "STARTED",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "UNKNOWN",
  "RECONCILED",
] as const;
export type ActivityAttemptOutcome = (typeof ACTIVITY_ATTEMPT_OUTCOMES)[number];

export const ACTIVITY_RETENTION_STATES = [
  "NONE",
  "ACTIVE",
  "USER_ACTIONABLE",
] as const;
export type ActivityRetentionState = (typeof ACTIVITY_RETENTION_STATES)[number];

export type ActivitySafePrimitive = string | number | boolean | null;
export type ActivitySafeValue =
  | ActivitySafePrimitive
  | readonly ActivitySafeValue[]
  | { readonly [key: string]: ActivitySafeValue };
export type ActivitySafeDetails = {
  readonly [key: string]: ActivitySafeValue;
};

export interface ActivityReason {
  readonly code: ActivityReasonCode;
  readonly what: string;
  readonly why: string;
  readonly nextAction: ActivityNextAction;
}

export interface ActivityOwnerRef {
  readonly type: string;
  readonly id: string;
  readonly version?: number;
  readonly revision?: number;
}

export interface ActivityWorkItemRef {
  readonly provider: string;
  readonly namespace: string;
  readonly projectKey?: string;
  readonly issueNumber?: number;
  readonly repositoryOwner?: string;
  readonly repositoryName?: string;
  readonly canonicalKey?: string;
}

export interface ActivityAttempt {
  readonly id: string;
  readonly number: number;
  readonly outcome?: ActivityAttemptOutcome;
}

export interface ActivityEventInput {
  readonly schemaVersion?: typeof ACTIVITY_SCHEMA_VERSION;
  readonly eventId: string;
  readonly eventType: ActivityEventType;
  readonly stage: ActivityStage;
  readonly correlationId: string;
  readonly operationId?: string;
  readonly parentEventId?: string;
  readonly causationEventId?: string;
  readonly owner?: ActivityOwnerRef;
  readonly managedPrId?: string;
  readonly occurrenceAt: string;
  readonly severity: ActivitySeverity;
  readonly reason: ActivityReason;
  readonly summary: string;
  readonly details?: ActivitySafeDetails;
  readonly workItem?: ActivityWorkItemRef;
  readonly relatedTarget?: OpenTarget;
  readonly attempt?: ActivityAttempt;
  readonly retention?: ActivityRetentionState;
}

export interface ActivityEventRecord {
  readonly schemaVersion: typeof ACTIVITY_SCHEMA_VERSION;
  readonly eventId: string;
  readonly eventType: ActivityEventType;
  readonly stage: ActivityStage;
  readonly correlationId: string;
  readonly operationId?: string;
  readonly parentEventId?: string;
  readonly causationEventId?: string;
  readonly owner?: ActivityOwnerRef;
  readonly managedPrId?: string;
  readonly occurrenceAt: string;
  readonly recordedAt: string;
  readonly severity: ActivitySeverity;
  readonly reason: ActivityReason;
  readonly summary: string;
  readonly details: ActivitySafeDetails;
  readonly workItem?: ActivityWorkItemRef;
  readonly relatedTarget?: OpenTarget;
  readonly attempt?: ActivityAttempt;
  readonly retention: ActivityRetentionState;
}

export interface ActivityEventView extends ActivityEventRecord {
  readonly workItemLabel?: string;
}

export interface ActivityQuery {
  readonly view?: "PR_WORK" | "APPLICATION" | "ALL";
  readonly managedPrId?: string;
  readonly ownerType?: string;
  readonly ownerId?: string;
  readonly operationId?: string;
  readonly correlationId?: string;
  readonly workItemKey?: string;
  readonly severity?: ActivitySeverity;
  readonly reasonCode?: ActivityReasonCode;
  readonly stage?: ActivityStage;
  readonly from?: string;
  readonly to?: string;
  readonly cursor?: string;
  readonly limit?: number;
  readonly direction?: "asc" | "desc";
}

export interface ActivityRetentionPolicy {
  readonly maxAgeDays: number;
  readonly maxEvents: number;
  readonly maxBytes: number;
}

export interface ActivityRetentionSummary {
  readonly policy: ActivityRetentionPolicy;
  readonly deletedCount: number;
  readonly protectedCount: number;
  readonly oldestRecordedAt?: string;
  readonly prunedBefore?: string;
  readonly lastRunAt?: string;
}

export interface ActivityQuerySnapshot {
  readonly schemaVersion: typeof ACTIVITY_SCHEMA_VERSION;
  readonly kind: "activity-query";
  readonly generatedAt: string;
  readonly query: ActivityQuery;
  readonly events: readonly ActivityEventView[];
  readonly nextCursor?: string;
  readonly hasMore: boolean;
  readonly retention: ActivityRetentionSummary;
}

export interface ActivityUpdateEvent {
  readonly schemaVersion: typeof ACTIVITY_SCHEMA_VERSION;
  readonly type: "activity-update";
  readonly event: ActivityEventView;
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/u;
const SECRET_KEY_PATTERN =
  /(?:token|secret|password|credential|authorization|cookie|prompt|api[_.-]?key|access[_.-]?key|private[_.-]?key|sdk|exception|environment|env)/iu;
const SECRET_VALUE_PATTERNS = [
  /bearer\s+[A-Za-z0-9._~+/=-]{8,}/giu,
  /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/giu,
  /(?:token|secret|password|credential|authorization|cookie|api[_.-]?key|access[_.-]?key)\s*[:=]\s*[^\s,;]+/giu,
];

export class ActivityContractError extends Error {
  public constructor(
    public readonly code:
      | "INVALID_EVENT"
      | "INVALID_QUERY"
      | "INVALID_CURSOR"
      | "SECURITY_VIOLATION"
      | "UNSUPPORTED_VALUE",
    message: string,
  ) {
    super(message);
    this.name = "ActivityContractError";
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function safeText(
  value: unknown,
  label: string,
  maximum: number,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    byteLength(value) > maximum ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    throw new ActivityContractError(
      "INVALID_EVENT",
      `${label} is missing, unsafe, or exceeds its bounded limit.`,
    );
  }
}

function identifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value))
    throw new ActivityContractError(
      "INVALID_EVENT",
      `${label} is not a bounded provider-neutral identifier.`,
    );
}

function timestamp(value: unknown, label: string): asserts value is string {
  safeText(value, label, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(value))
    throw new ActivityContractError(
      "INVALID_EVENT",
      `${label} must be an unambiguous UTC timestamp.`,
    );
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed))
    throw new ActivityContractError(
      "INVALID_EVENT",
      `${label} is not a valid UTC timestamp.`,
    );
}

function redactedText(value: string): string {
  return SECRET_VALUE_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, "[REDACTED]"),
    value,
  );
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

interface RedactionResult {
  readonly value: ActivitySafeValue;
  readonly redacted: boolean;
}

function redactValue(
  value: unknown,
  depth: number,
  label: string,
): RedactionResult {
  if (depth > ACTIVITY_MAX_DETAIL_DEPTH)
    throw new ActivityContractError(
      "INVALID_EVENT",
      `${label} is nested beyond the activity detail limit.`,
    );
  if (value === null || typeof value === "boolean")
    return { value, redacted: false };
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new ActivityContractError(
        "INVALID_EVENT",
        `${label} contains a non-finite number.`,
      );
    return { value, redacted: false };
  }
  if (typeof value === "string") {
    safeText(value, label, 2_048);
    const safe = redactedText(value);
    return { value: safe, redacted: safe !== value };
  }
  if (!plainRecord(value) && !Array.isArray(value))
    throw new ActivityContractError(
      "UNSUPPORTED_VALUE",
      `${label} contains a raw SDK, platform, error, or class value.`,
    );
  if (Array.isArray(value)) {
    if (value.length > ACTIVITY_MAX_DETAIL_COLLECTION)
      throw new ActivityContractError(
        "INVALID_EVENT",
        `${label} contains too many values.`,
      );
    let redacted = false;
    const result = value.map((item, index) => {
      const child = redactValue(item, depth + 1, `${label}[${index}]`);
      redacted ||= child.redacted;
      return child.value;
    });
    return { value: result, redacted };
  }
  const entries = Object.entries(value);
  if (entries.length > ACTIVITY_MAX_DETAIL_COLLECTION)
    throw new ActivityContractError(
      "INVALID_EVENT",
      `${label} contains too many fields.`,
    );
  let redacted = false;
  const result = Object.create(null) as Record<string, ActivitySafeValue>;
  for (const [key, item] of entries) {
    safeText(key, `${label} field`, 128);
    if (!IDENTIFIER_PATTERN.test(key) && !/^[-A-Za-z0-9 _./#]+$/u.test(key))
      throw new ActivityContractError(
        "INVALID_EVENT",
        `${label} contains an unsupported field name.`,
      );
    if (SECRET_KEY_PATTERN.test(key)) {
      result[key] = "[REDACTED]";
      redacted = true;
      continue;
    }
    const child = redactValue(item, depth + 1, `${label}.${key}`);
    result[key] = child.value;
    redacted ||= child.redacted;
  }
  return { value: result, redacted };
}

function canonicalize(value: ActivitySafeValue): ActivitySafeValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

export function canonicalActivityJson(value: unknown): string {
  const result = redactValue(value, 0, "activity").value;
  return JSON.stringify(canonicalize(result));
}

function optionalIdentifier(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  identifier(value, label);
  return value;
}

function normalizeOwner(
  value: ActivityOwnerRef | undefined,
): ActivityOwnerRef | undefined {
  if (value === undefined) return undefined;
  if (!plainRecord(value))
    throw new ActivityContractError(
      "INVALID_EVENT",
      "The activity owner is invalid.",
    );
  const allowed = new Set(["type", "id", "version", "revision"]);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw new ActivityContractError(
      "INVALID_EVENT",
      "The activity owner has unsupported fields.",
    );
  identifier(value.type, "Activity owner type");
  identifier(value.id, "Activity owner id");
  for (const [name, candidate] of [
    ["version", value.version],
    ["revision", value.revision],
  ] as const) {
    if (
      candidate !== undefined &&
      (!Number.isSafeInteger(candidate) || candidate < 1)
    )
      throw new ActivityContractError(
        "INVALID_EVENT",
        `Activity owner ${name} is invalid.`,
      );
  }
  return {
    type: value.type,
    id: value.id,
    ...(value.version === undefined ? {} : { version: value.version }),
    ...(value.revision === undefined ? {} : { revision: value.revision }),
  };
}

function normalizeWorkItem(
  value: ActivityWorkItemRef | undefined,
): ActivityWorkItemRef | undefined {
  if (value === undefined) return undefined;
  if (!plainRecord(value))
    throw new ActivityContractError(
      "INVALID_EVENT",
      "The work-item reference is invalid.",
    );
  const allowed = new Set([
    "provider",
    "namespace",
    "projectKey",
    "issueNumber",
    "repositoryOwner",
    "repositoryName",
    "canonicalKey",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw new ActivityContractError(
      "INVALID_EVENT",
      "The work-item reference has unsupported fields.",
    );
  identifier(value.provider, "Work-item provider");
  identifier(value.namespace, "Work-item namespace");
  if (
    value.projectKey !== undefined &&
    (typeof value.projectKey !== "string" ||
      !PROJECT_KEY_PATTERN.test(value.projectKey))
  )
    throw new ActivityContractError(
      "INVALID_EVENT",
      "The work-item project key is invalid.",
    );
  if (
    value.issueNumber !== undefined &&
    (!Number.isSafeInteger(value.issueNumber) ||
      value.issueNumber < 1 ||
      value.issueNumber > 1_000_000_000)
  )
    throw new ActivityContractError(
      "INVALID_EVENT",
      "The work-item issue number is invalid.",
    );
  for (const [name, candidate] of [
    ["repositoryOwner", value.repositoryOwner],
    ["repositoryName", value.repositoryName],
    ["canonicalKey", value.canonicalKey],
  ] as const) {
    if (candidate !== undefined) {
      safeText(candidate, `Work-item ${name}`, 256);
      if (redactedText(candidate) !== candidate)
        throw new ActivityContractError(
          "SECURITY_VIOLATION",
          `Work-item ${name} contains secret-shaped content.`,
        );
    }
  }
  return {
    provider: value.provider,
    namespace: value.namespace,
    ...(value.projectKey === undefined ? {} : { projectKey: value.projectKey }),
    ...(value.issueNumber === undefined
      ? {}
      : { issueNumber: value.issueNumber }),
    ...(value.repositoryOwner === undefined
      ? {}
      : { repositoryOwner: value.repositoryOwner }),
    ...(value.repositoryName === undefined
      ? {}
      : { repositoryName: value.repositoryName }),
    ...(value.canonicalKey === undefined
      ? {}
      : { canonicalKey: value.canonicalKey }),
  };
}

function normalizeAttempt(
  value: ActivityAttempt | undefined,
): ActivityAttempt | undefined {
  if (value === undefined) return undefined;
  if (!plainRecord(value))
    throw new ActivityContractError(
      "INVALID_EVENT",
      "The activity attempt is invalid.",
    );
  const allowed = new Set(["id", "number", "outcome"]);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw new ActivityContractError(
      "INVALID_EVENT",
      "The activity attempt has unsupported fields.",
    );
  identifier(value.id, "Activity attempt id");
  if (!Number.isSafeInteger(value.number) || value.number < 1)
    throw new ActivityContractError(
      "INVALID_EVENT",
      "Activity attempt number is invalid.",
    );
  if (
    value.outcome !== undefined &&
    !ACTIVITY_ATTEMPT_OUTCOMES.includes(value.outcome)
  )
    throw new ActivityContractError(
      "INVALID_EVENT",
      "Activity attempt outcome is unsupported.",
    );
  return {
    id: value.id,
    number: value.number,
    ...(value.outcome === undefined ? {} : { outcome: value.outcome }),
  };
}

function normalizeTarget(
  value: OpenTarget | undefined,
): OpenTarget | undefined {
  if (value === undefined) return undefined;
  const parsed = parseOpenTargetRecord(value);
  if (!parsed.ok)
    throw new ActivityContractError(
      "SECURITY_VIOLATION",
      "The related activity target is not an allowlisted provider-neutral route.",
    );
  return parsed.value;
}

function normalizeReason(value: ActivityReason): ActivityReason {
  if (!plainRecord(value))
    throw new ActivityContractError(
      "INVALID_EVENT",
      "The activity reason is invalid.",
    );
  const allowed = new Set(["code", "what", "why", "nextAction"]);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw new ActivityContractError(
      "INVALID_EVENT",
      "The activity reason has unsupported fields.",
    );
  if (!ACTIVITY_REASON_CODES.includes(value.code))
    throw new ActivityContractError(
      "INVALID_EVENT",
      "The activity reason code is not allowlisted.",
    );
  if (!ACTIVITY_NEXT_ACTIONS.includes(value.nextAction))
    throw new ActivityContractError(
      "INVALID_EVENT",
      "The activity next action is not allowlisted.",
    );
  safeText(value.what, "Activity reason what", ACTIVITY_MAX_REASON_BYTES);
  safeText(value.why, "Activity reason why", ACTIVITY_MAX_REASON_BYTES);
  return {
    code: value.code,
    what: redactedText(value.what),
    why: redactedText(value.why),
    nextAction: value.nextAction,
  };
}

export function normalizeActivityEvent(
  input: ActivityEventInput,
  recordedAt: string,
): ActivityEventRecord {
  if (
    !plainRecord(input) ||
    !hasOnlyKeys(input, [
      "schemaVersion",
      "eventId",
      "eventType",
      "stage",
      "correlationId",
      "operationId",
      "parentEventId",
      "causationEventId",
      "owner",
      "managedPrId",
      "occurrenceAt",
      "severity",
      "reason",
      "summary",
      "details",
      "workItem",
      "relatedTarget",
      "attempt",
      "retention",
    ])
  )
    throw new ActivityContractError(
      "INVALID_EVENT",
      "The activity event contains unsupported fields.",
    );
  if (
    input.schemaVersion !== undefined &&
    input.schemaVersion !== ACTIVITY_SCHEMA_VERSION
  )
    throw new ActivityContractError(
      "INVALID_EVENT",
      "The activity schema version is unsupported.",
    );
  identifier(input.eventId, "Activity event id");
  identifier(input.correlationId, "Activity correlation id");
  if (!ACTIVITY_EVENT_TYPES.includes(input.eventType))
    throw new ActivityContractError(
      "INVALID_EVENT",
      "The activity event type is not allowlisted.",
    );
  if (!ACTIVITY_STAGES.includes(input.stage))
    throw new ActivityContractError(
      "INVALID_EVENT",
      "The activity stage is not allowlisted.",
    );
  if (!ACTIVITY_SEVERITIES.includes(input.severity))
    throw new ActivityContractError(
      "INVALID_EVENT",
      "The activity severity is not allowlisted.",
    );
  timestamp(input.occurrenceAt, "Activity occurrence time");
  timestamp(recordedAt, "Activity recording time");
  const operationId = optionalIdentifier(
    input.operationId,
    "Activity operation id",
  );
  const parentEventId = optionalIdentifier(
    input.parentEventId,
    "Activity parent event id",
  );
  const causationEventId = optionalIdentifier(
    input.causationEventId,
    "Activity causation event id",
  );
  const managedPrId = optionalIdentifier(
    input.managedPrId,
    "Activity managed-PR id",
  );
  safeText(input.summary, "Activity summary", ACTIVITY_MAX_SUMMARY_BYTES);
  const detailsResult = redactValue(input.details ?? {}, 0, "Activity details");
  const details = detailsResult.value;
  if (!plainRecord(details))
    throw new ActivityContractError(
      "INVALID_EVENT",
      "Activity details must be an object.",
    );
  if (
    byteLength(JSON.stringify(canonicalize(details))) >
    ACTIVITY_MAX_DETAIL_BYTES
  )
    throw new ActivityContractError(
      "INVALID_EVENT",
      "Activity details exceed the bounded limit.",
    );
  const retention = input.retention ?? "NONE";
  if (!ACTIVITY_RETENTION_STATES.includes(retention))
    throw new ActivityContractError(
      "INVALID_EVENT",
      "Activity retention state is unsupported.",
    );
  return {
    schemaVersion: ACTIVITY_SCHEMA_VERSION,
    eventId: input.eventId,
    eventType: input.eventType,
    stage: input.stage,
    correlationId: input.correlationId,
    ...(operationId === undefined ? {} : { operationId }),
    ...(parentEventId === undefined ? {} : { parentEventId }),
    ...(causationEventId === undefined ? {} : { causationEventId }),
    ...(input.owner === undefined
      ? {}
      : { owner: normalizeOwner(input.owner) }),
    ...(managedPrId === undefined ? {} : { managedPrId }),
    occurrenceAt: input.occurrenceAt,
    recordedAt,
    severity: input.severity,
    reason: normalizeReason(input.reason),
    summary: redactedText(input.summary),
    details: canonicalize(details) as ActivitySafeDetails,
    ...(input.workItem === undefined
      ? {}
      : { workItem: normalizeWorkItem(input.workItem) }),
    ...(input.relatedTarget === undefined
      ? {}
      : { relatedTarget: normalizeTarget(input.relatedTarget) }),
    ...(input.attempt === undefined
      ? {}
      : { attempt: normalizeAttempt(input.attempt) }),
    retention,
  };
}

export function activityIdentityPayload(
  event: ActivityEventRecord,
): ActivitySafeDetails {
  const { recordedAt: _recordedAt, ...identity } = event;
  return identity as unknown as ActivitySafeDetails;
}

export function activityEventCanonicalHashInput(
  event: ActivityEventRecord,
): string {
  return canonicalActivityJson(activityIdentityPayload(event));
}

export function formatWorkItemRef(
  workItem: ActivityWorkItemRef | undefined,
): string | undefined {
  if (workItem === undefined) return undefined;
  if (workItem.projectKey !== undefined && workItem.issueNumber !== undefined)
    return `${workItem.projectKey}-${workItem.issueNumber}`;
  if (workItem.issueNumber !== undefined) {
    if (
      workItem.repositoryOwner !== undefined &&
      workItem.repositoryName !== undefined
    )
      return `${workItem.repositoryOwner}/${workItem.repositoryName}#${workItem.issueNumber}`;
    return `#${workItem.issueNumber}`;
  }
  return workItem.canonicalKey ?? `${workItem.provider}:${workItem.namespace}`;
}

export function activityEventView(
  event: ActivityEventRecord,
): ActivityEventView {
  const workItemLabel = formatWorkItemRef(event.workItem);
  return workItemLabel === undefined ? event : { ...event, workItemLabel };
}

function normalizeCursorPart(value: string, label: string): string {
  if (
    value.length === 0 ||
    byteLength(value) > 256 ||
    hasUnsafeControlCharacters(value)
  )
    throw new ActivityContractError("INVALID_CURSOR", `${label} is invalid.`);
  return value;
}

export function encodeActivityCursor(input: {
  readonly recordedAt: string;
  readonly eventId: string;
  readonly direction: "asc" | "desc";
}): string {
  timestamp(input.recordedAt, "Activity cursor time");
  identifier(input.eventId, "Activity cursor event id");
  return `${input.direction}|${encodeURIComponent(input.recordedAt)}|${encodeURIComponent(input.eventId)}`;
}

export function decodeActivityCursor(value: string): {
  readonly recordedAt: string;
  readonly eventId: string;
  readonly direction: "asc" | "desc";
} {
  normalizeCursorPart(value, "Activity cursor");
  const parts = value.split("|");
  if (parts.length !== 3 || (parts[0] !== "asc" && parts[0] !== "desc"))
    throw new ActivityContractError(
      "INVALID_CURSOR",
      "The activity cursor is invalid.",
    );
  let recordedAt: string;
  let eventId: string;
  try {
    recordedAt = decodeURIComponent(parts[1] ?? "");
    eventId = decodeURIComponent(parts[2] ?? "");
  } catch {
    throw new ActivityContractError(
      "INVALID_CURSOR",
      "The activity cursor is not encoded safely.",
    );
  }
  timestamp(recordedAt, "Activity cursor time");
  identifier(eventId, "Activity cursor event id");
  return { recordedAt, eventId, direction: parts[0] };
}

export function normalizeActivityQuery(
  input: ActivityQuery = {},
): ActivityQuery {
  if (!plainRecord(input))
    throw new ActivityContractError(
      "INVALID_QUERY",
      "The activity query must be a plain object.",
    );
  const queryInput = input as ActivityQuery;
  if (
    queryInput.view !== undefined &&
    !["PR_WORK", "APPLICATION", "ALL"].includes(queryInput.view)
  )
    throw new ActivityContractError(
      "INVALID_QUERY",
      "The activity view is unsupported.",
    );
  const allowed = new Set([
    "managedPrId",
    "view",
    "ownerType",
    "ownerId",
    "operationId",
    "correlationId",
    "workItemKey",
    "severity",
    "reasonCode",
    "stage",
    "from",
    "to",
    "cursor",
    "limit",
    "direction",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key)))
    throw new ActivityContractError(
      "INVALID_QUERY",
      "The activity query contains an unsupported field.",
    );
  const managedPrId = optionalIdentifier(
    queryInput.managedPrId,
    "Activity managed-PR filter",
  );
  const ownerType = optionalIdentifier(
    queryInput.ownerType,
    "Activity owner-type filter",
  );
  const ownerId = optionalIdentifier(
    queryInput.ownerId,
    "Activity owner-id filter",
  );
  const operationId = optionalIdentifier(
    queryInput.operationId,
    "Activity operation filter",
  );
  const correlationId = optionalIdentifier(
    queryInput.correlationId,
    "Activity correlation filter",
  );
  let workItemKey: string | undefined;
  if (queryInput.workItemKey !== undefined) {
    safeText(queryInput.workItemKey, "Activity work-item filter", 256);
    if (redactedText(queryInput.workItemKey) !== queryInput.workItemKey)
      throw new ActivityContractError(
        "SECURITY_VIOLATION",
        "The activity work-item filter contains secret-shaped content.",
      );
    workItemKey = queryInput.workItemKey;
  }
  if (
    queryInput.severity !== undefined &&
    !ACTIVITY_SEVERITIES.includes(queryInput.severity)
  )
    throw new ActivityContractError(
      "INVALID_QUERY",
      "The activity severity filter is unsupported.",
    );
  if (
    queryInput.reasonCode !== undefined &&
    !ACTIVITY_REASON_CODES.includes(queryInput.reasonCode)
  )
    throw new ActivityContractError(
      "INVALID_QUERY",
      "The activity reason filter is unsupported.",
    );
  if (
    queryInput.stage !== undefined &&
    !ACTIVITY_STAGES.includes(queryInput.stage)
  )
    throw new ActivityContractError(
      "INVALID_QUERY",
      "The activity stage filter is unsupported.",
    );
  if (queryInput.from !== undefined)
    timestamp(queryInput.from, "Activity from filter");
  if (queryInput.to !== undefined)
    timestamp(queryInput.to, "Activity to filter");
  if (
    queryInput.from !== undefined &&
    queryInput.to !== undefined &&
    queryInput.from > queryInput.to
  )
    throw new ActivityContractError(
      "INVALID_QUERY",
      "The activity time range is reversed.",
    );
  if (queryInput.cursor !== undefined) decodeActivityCursor(queryInput.cursor);
  const limit = queryInput.limit ?? ACTIVITY_DEFAULT_PAGE_SIZE;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > ACTIVITY_MAX_PAGE_SIZE
  )
    throw new ActivityContractError(
      "INVALID_QUERY",
      "The activity page size is outside the bounded limit.",
    );
  const direction = queryInput.direction ?? "desc";
  if (direction !== "asc" && direction !== "desc")
    throw new ActivityContractError(
      "INVALID_QUERY",
      "The activity direction is unsupported.",
    );
  return {
    ...(queryInput.view === undefined ? {} : { view: queryInput.view }),
    ...(managedPrId === undefined ? {} : { managedPrId }),
    ...(ownerType === undefined ? {} : { ownerType }),
    ...(ownerId === undefined ? {} : { ownerId }),
    ...(operationId === undefined ? {} : { operationId }),
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(workItemKey === undefined ? {} : { workItemKey }),
    ...(queryInput.severity === undefined
      ? {}
      : { severity: queryInput.severity }),
    ...(queryInput.reasonCode === undefined
      ? {}
      : { reasonCode: queryInput.reasonCode }),
    ...(queryInput.stage === undefined ? {} : { stage: queryInput.stage }),
    ...(queryInput.from === undefined ? {} : { from: queryInput.from }),
    ...(queryInput.to === undefined ? {} : { to: queryInput.to }),
    ...(queryInput.cursor === undefined ? {} : { cursor: queryInput.cursor }),
    limit,
    direction,
  };
}

export function matchesActivityQuery(
  event: ActivityEventRecord,
  query: ActivityQuery,
): boolean {
  const normalized = normalizeActivityQuery(query);
  const workItemKey = formatWorkItemRef(event.workItem);
  return (
    (normalized.view === undefined ||
      normalized.view === "ALL" ||
      activityScope(event) === normalized.view) &&
    (normalized.managedPrId === undefined ||
      event.managedPrId === normalized.managedPrId) &&
    (normalized.ownerType === undefined ||
      event.owner?.type === normalized.ownerType) &&
    (normalized.ownerId === undefined ||
      event.owner?.id === normalized.ownerId) &&
    (normalized.operationId === undefined ||
      event.operationId === normalized.operationId) &&
    (normalized.correlationId === undefined ||
      event.correlationId === normalized.correlationId) &&
    (normalized.workItemKey === undefined ||
      workItemKey === normalized.workItemKey) &&
    (normalized.severity === undefined ||
      event.severity === normalized.severity) &&
    (normalized.reasonCode === undefined ||
      event.reason.code === normalized.reasonCode) &&
    (normalized.stage === undefined || event.stage === normalized.stage) &&
    (normalized.from === undefined || event.recordedAt >= normalized.from) &&
    (normalized.to === undefined || event.recordedAt <= normalized.to)
  );
}

function isSafeDetails(
  value: unknown,
  depth = 0,
): value is ActivitySafeDetails {
  if (depth > ACTIVITY_MAX_DETAIL_DEPTH || !plainRecord(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > ACTIVITY_MAX_DETAIL_COLLECTION) return false;
  for (const [key, item] of entries) {
    if (
      SECRET_KEY_PATTERN.test(key) ||
      (!IDENTIFIER_PATTERN.test(key) && !/^[-A-Za-z0-9 _./#]+$/u.test(key))
    )
      return false;
    if (item === null || typeof item === "boolean") continue;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) return false;
      continue;
    }
    if (typeof item === "string") {
      if (item.length > 2_048 || hasUnsafeControlCharacters(item)) return false;
      continue;
    }
    if (Array.isArray(item)) {
      if (
        item.length > ACTIVITY_MAX_DETAIL_COLLECTION ||
        item.some((entry) => !isSafeNested(entry, depth + 1))
      )
        return false;
      continue;
    }
    if (!isSafeDetails(item, depth + 1)) return false;
  }
  return byteLength(JSON.stringify(value)) <= ACTIVITY_MAX_DETAIL_BYTES;
}

function isSafeNested(value: unknown, depth: number): boolean {
  if (depth > ACTIVITY_MAX_DETAIL_DEPTH) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string")
    return value.length <= 2_048 && !hasUnsafeControlCharacters(value);
  if (Array.isArray(value))
    return (
      value.length <= ACTIVITY_MAX_DETAIL_COLLECTION &&
      value.every((entry) => isSafeNested(entry, depth + 1))
    );
  return isSafeDetails(value, depth);
}

export function isActivityEvent(value: unknown): value is ActivityEventRecord {
  if (!plainRecord(value)) return false;
  if (
    !hasOnlyKeys(value, [
      "schemaVersion",
      "eventId",
      "eventType",
      "stage",
      "correlationId",
      "operationId",
      "parentEventId",
      "causationEventId",
      "owner",
      "managedPrId",
      "occurrenceAt",
      "recordedAt",
      "severity",
      "reason",
      "summary",
      "details",
      "workItem",
      "workItemLabel",
      "relatedTarget",
      "attempt",
      "retention",
    ])
  )
    return false;
  const required = [
    "schemaVersion",
    "eventId",
    "eventType",
    "stage",
    "correlationId",
    "occurrenceAt",
    "recordedAt",
    "severity",
    "reason",
    "summary",
    "details",
    "retention",
  ];
  if (!required.every((key) => key in value)) return false;
  try {
    if (
      value.schemaVersion !== ACTIVITY_SCHEMA_VERSION ||
      typeof value.eventId !== "string" ||
      !IDENTIFIER_PATTERN.test(value.eventId) ||
      !ACTIVITY_EVENT_TYPES.includes(value.eventType as ActivityEventType) ||
      !ACTIVITY_STAGES.includes(value.stage as ActivityStage) ||
      typeof value.correlationId !== "string" ||
      !IDENTIFIER_PATTERN.test(value.correlationId) ||
      !ACTIVITY_SEVERITIES.includes(value.severity as ActivitySeverity) ||
      !ACTIVITY_RETENTION_STATES.includes(
        value.retention as ActivityRetentionState,
      ) ||
      typeof value.summary !== "string" ||
      byteLength(value.summary) > ACTIVITY_MAX_SUMMARY_BYTES ||
      hasUnsafeControlCharacters(value.summary) ||
      !isSafeDetails(value.details)
    )
      return false;
    timestamp(value.occurrenceAt, "Activity occurrence time");
    timestamp(value.recordedAt, "Activity recording time");
    if (
      !plainRecord(value.reason) ||
      !hasOnlyKeys(value.reason, ["code", "what", "why", "nextAction"])
    )
      return false;
    if (
      !ACTIVITY_REASON_CODES.includes(
        value.reason.code as ActivityReasonCode,
      ) ||
      !ACTIVITY_NEXT_ACTIONS.includes(
        value.reason.nextAction as ActivityNextAction,
      ) ||
      typeof value.reason.what !== "string" ||
      typeof value.reason.why !== "string" ||
      !isSafeTextValue(value.reason.what, ACTIVITY_MAX_REASON_BYTES) ||
      !isSafeTextValue(value.reason.why, ACTIVITY_MAX_REASON_BYTES)
    )
      return false;
    if (value.owner !== undefined && !isOwner(value.owner)) return false;
    if (
      value.workItemLabel !== undefined &&
      !isSafeTextValue(value.workItemLabel, 512)
    )
      return false;
    if (
      value.workItem !== undefined &&
      normalizeWorkItem(value.workItem as ActivityWorkItemRef) === undefined
    )
      return false;
    if (
      value.relatedTarget !== undefined &&
      !parseOpenTargetRecord(value.relatedTarget).ok
    )
      return false;
    if (
      value.attempt !== undefined &&
      normalizeAttempt(value.attempt as ActivityAttempt) === undefined
    )
      return false;
    for (const key of [
      "operationId",
      "parentEventId",
      "causationEventId",
      "managedPrId",
    ] as const) {
      if (
        value[key] !== undefined &&
        (typeof value[key] !== "string" || !IDENTIFIER_PATTERN.test(value[key]))
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isSafeTextValue(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    byteLength(value) <= maximum &&
    !hasUnsafeControlCharacters(value)
  );
}

function hasUnsafeControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function isOwner(value: unknown): value is ActivityOwnerRef {
  if (!plainRecord(value)) return false;
  if (!hasOnlyKeys(value, ["type", "id", "version", "revision"])) return false;
  const owner = value as unknown as ActivityOwnerRef;
  return (
    typeof owner.type === "string" &&
    IDENTIFIER_PATTERN.test(owner.type) &&
    typeof owner.id === "string" &&
    IDENTIFIER_PATTERN.test(owner.id) &&
    (owner.version === undefined ||
      (Number.isSafeInteger(owner.version) && owner.version >= 1)) &&
    (owner.revision === undefined ||
      (Number.isSafeInteger(owner.revision) && owner.revision >= 1))
  );
}

export function isActivityQuerySnapshot(
  value: unknown,
): value is ActivityQuerySnapshot {
  if (!plainRecord(value)) return false;
  if (
    !hasOnlyKeys(value, [
      "schemaVersion",
      "kind",
      "generatedAt",
      "query",
      "events",
      "nextCursor",
      "hasMore",
      "retention",
    ])
  )
    return false;
  if (
    value.schemaVersion !== ACTIVITY_SCHEMA_VERSION ||
    value.kind !== "activity-query" ||
    typeof value.generatedAt !== "string" ||
    !Array.isArray(value.events) ||
    value.events.length > ACTIVITY_MAX_PAGE_SIZE ||
    typeof value.hasMore !== "boolean" ||
    !isActivityEventArray(value.events) ||
    !plainRecord(value.retention)
  )
    return false;
  try {
    timestamp(value.generatedAt, "Activity query generation time");
    normalizeActivityQuery(value.query as ActivityQuery);
    if (value.nextCursor !== undefined) {
      if (typeof value.nextCursor !== "string") return false;
      decodeActivityCursor(value.nextCursor);
    }
    const retention = value.retention as {
      readonly deletedCount: unknown;
      readonly protectedCount: unknown;
      readonly policy: Record<string, unknown>;
    };
    return (
      typeof retention.deletedCount === "number" &&
      Number.isSafeInteger(retention.deletedCount) &&
      retention.deletedCount >= 0 &&
      typeof retention.protectedCount === "number" &&
      Number.isSafeInteger(retention.protectedCount) &&
      retention.protectedCount >= 0 &&
      plainRecord(retention.policy) &&
      hasOnlyKeys(retention, [
        "policy",
        "deletedCount",
        "protectedCount",
        "oldestRecordedAt",
        "prunedBefore",
        "lastRunAt",
      ]) &&
      hasOnlyKeys(retention.policy, ["maxAgeDays", "maxEvents", "maxBytes"]) &&
      typeof retention.policy.maxAgeDays === "number" &&
      typeof retention.policy.maxEvents === "number" &&
      typeof retention.policy.maxBytes === "number"
    );
  } catch {
    return false;
  }
}

function isActivityEventArray(
  value: readonly unknown[],
): value is readonly ActivityEventView[] {
  return value.every((event) => {
    if (!isActivityEvent(event)) return false;
    const candidate = event as ActivityEventView;
    return (
      candidate.workItemLabel === undefined ||
      isSafeTextValue(candidate.workItemLabel, 512)
    );
  });
}

export function isActivityUpdateEvent(
  value: unknown,
): value is ActivityUpdateEvent {
  if (!plainRecord(value)) return false;
  return (
    hasOnlyKeys(value, ["schemaVersion", "type", "event"]) &&
    value.schemaVersion === ACTIVITY_SCHEMA_VERSION &&
    value.type === "activity-update" &&
    isActivityEvent(value.event)
  );
}
