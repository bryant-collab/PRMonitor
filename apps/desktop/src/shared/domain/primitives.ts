import {
  DOMAIN_SCHEMA_VERSION,
  failure,
  isSafeText,
  type DomainResult,
  success,
  unsafeReason,
  createDomainError,
} from "./result";

type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type ManagedPrId = Brand<string, "ManagedPrId">;
export type RepositoryId = Brand<string, "RepositoryId">;
export type RemoteEventVersionId = Brand<string, "RemoteEventVersionId">;
export type ReviewBatchId = Brand<string, "ReviewBatchId">;
export type ReviewBundleId = Brand<string, "ReviewBundleId">;
export type ReviewBundleItemId = Brand<string, "ReviewBundleItemId">;
export type AIWorkOperationId = Brand<string, "AIWorkOperationId">;
export type SynchronizationBatchId = Brand<string, "SynchronizationBatchId">;
export type SynchronizationOperationId = Brand<
  string,
  "SynchronizationOperationId"
>;
export type WorktreeId = Brand<string, "WorktreeId">;
export type PublicationId = Brand<string, "PublicationId">;
export type IdempotencyKey = Brand<string, "IdempotencyKey">;
export type ActivityEventId = Brand<string, "ActivityEventId">;
export type ActionId = Brand<string, "ActionId">;
export type TransitionEventId = Brand<string, "TransitionEventId">;
export type CorrelationId = Brand<string, "CorrelationId">;
export type ApprovalId = Brand<string, "ApprovalId">;
export type BranchName = Brand<string, "BranchName">;
export type CommitSha = Brand<string, "CommitSha">;
export type SemanticHash = Brand<string, "SemanticHash">;

export type UtcInstant = Brand<string, "UtcInstant">;

export interface Clock {
  readonly now: () => UtcInstant;
}

export type ActorKind = "SYSTEM" | "HUMAN" | "RECOVERY";

export interface ActionRecord {
  readonly schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  readonly kind: "action-record";
  readonly actionId: ActionId;
  readonly transitionId: TransitionEventId;
  readonly actor: ActorKind;
  readonly issuedAt: UtcInstant;
  readonly expectedVersion?: number;
  readonly correlationId?: CorrelationId;
}

export interface HumanApprovalRecord {
  readonly schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  readonly kind: "human-approval";
  readonly approvalId: ApprovalId;
  readonly actor: "HUMAN";
  readonly approvedAt: UtcInstant;
  readonly scope: "REVIEW_BUNDLE_PUBLICATION" | "SYNCHRONIZATION_PUBLICATION";
  readonly reviewedSnapshotHash?: SemanticHash;
}

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const BRANCH_PATTERN = /^(?!-).+$/u;
const SHA_PATTERN = /^[0-9a-f]{7,64}$/iu;
const HASH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const UTC_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function invalidValue(
  label: string,
  value: unknown,
): ReturnType<typeof createDomainError> {
  return createDomainError({
    code: "INVALID_INPUT",
    category: "INVALID_INPUT",
    retryable: false,
    userAction: "FIX_INPUT",
    messageKey: "domain.input.invalid",
    reason: unsafeReason(
      "INVALID_INPUT",
      `${label} is invalid.`,
      `${label} must use the canonical provider-neutral domain format.`,
      "FIX_INPUT",
      { label, receivedType: typeof value },
    ),
  });
}

export function parseOpaqueId<T extends string>(
  value: unknown,
  label = "identifier",
): DomainResult<T> {
  if (typeof value !== "string" || !OPAQUE_ID_PATTERN.test(value)) {
    return failure(invalidValue(label, value));
  }
  return success(value as T);
}

export function parseManagedPrId(value: unknown): DomainResult<ManagedPrId> {
  return parseOpaqueId(value, "managed PR identifier");
}
export function parseRepositoryId(value: unknown): DomainResult<RepositoryId> {
  return parseOpaqueId(value, "repository identifier");
}
export function parseRemoteEventVersionId(
  value: unknown,
): DomainResult<RemoteEventVersionId> {
  return parseOpaqueId(value, "remote event version identifier");
}
export function parseReviewBatchId(
  value: unknown,
): DomainResult<ReviewBatchId> {
  return parseOpaqueId(value, "review batch identifier");
}
export function parseReviewBundleId(
  value: unknown,
): DomainResult<ReviewBundleId> {
  return parseOpaqueId(value, "Review Bundle identifier");
}
export function parseReviewBundleItemId(
  value: unknown,
): DomainResult<ReviewBundleItemId> {
  return parseOpaqueId(value, "Review Bundle item identifier");
}
export function parseAIWorkOperationId(
  value: unknown,
): DomainResult<AIWorkOperationId> {
  return parseOpaqueId(value, "AI Work Operation identifier");
}
export function parseSynchronizationBatchId(
  value: unknown,
): DomainResult<SynchronizationBatchId> {
  return parseOpaqueId(value, "synchronization batch identifier");
}
export function parseSynchronizationOperationId(
  value: unknown,
): DomainResult<SynchronizationOperationId> {
  return parseOpaqueId(value, "synchronization operation identifier");
}
export function parseWorktreeId(value: unknown): DomainResult<WorktreeId> {
  return parseOpaqueId(value, "worktree identifier");
}
export function parsePublicationId(
  value: unknown,
): DomainResult<PublicationId> {
  return parseOpaqueId(value, "publication identifier");
}
export function parseIdempotencyKey(
  value: unknown,
): DomainResult<IdempotencyKey> {
  return parseOpaqueId(value, "idempotency key");
}
export function parseActivityEventId(
  value: unknown,
): DomainResult<ActivityEventId> {
  return parseOpaqueId(value, "activity event identifier");
}
export function parseActionId(value: unknown): DomainResult<ActionId> {
  return parseOpaqueId(value, "action identifier");
}
export function parseTransitionEventId(
  value: unknown,
): DomainResult<TransitionEventId> {
  return parseOpaqueId(value, "transition event identifier");
}
export function parseCorrelationId(
  value: unknown,
): DomainResult<CorrelationId> {
  return parseOpaqueId(value, "correlation identifier");
}
export function parseApprovalId(value: unknown): DomainResult<ApprovalId> {
  return parseOpaqueId(value, "approval identifier");
}

export function parseBranchName(value: unknown): DomainResult<BranchName> {
  if (
    typeof value !== "string" ||
    value.length > 255 ||
    !isSafeText(value) ||
    !BRANCH_PATTERN.test(value) ||
    value.includes("..") ||
    value.includes("//") ||
    value.includes("@{") ||
    /[~^:?*\\[\]]/u.test(value) ||
    value.endsWith("/")
  ) {
    return failure(invalidValue("branch name", value));
  }
  return success(value as BranchName);
}

export function parseCommitSha(value: unknown): DomainResult<CommitSha> {
  if (typeof value !== "string" || !SHA_PATTERN.test(value)) {
    return failure(invalidValue("commit SHA", value));
  }
  return success(value.toLowerCase() as CommitSha);
}

export function parseSemanticHash(value: unknown): DomainResult<SemanticHash> {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    return failure(invalidValue("semantic version hash", value));
  }
  return success(value as SemanticHash);
}

export function parseUtcInstant(value: unknown): DomainResult<UtcInstant> {
  if (typeof value !== "string" || !UTC_INSTANT_PATTERN.test(value)) {
    return failure(invalidValue("UTC instant", value));
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    return failure(invalidValue("UTC instant", value));
  }
  return success(value as UtcInstant);
}

export function parseSchemaVersion(
  value: unknown,
): DomainResult<typeof DOMAIN_SCHEMA_VERSION> {
  if (value !== DOMAIN_SCHEMA_VERSION) {
    return failure(
      createDomainError({
        code: "UNSUPPORTED_SCHEMA_VERSION",
        category: "UNSUPPORTED_VERSION",
        retryable: false,
        userAction: "FIX_INPUT",
        messageKey: "domain.schema.unsupported",
        reason: unsafeReason(
          "UNSUPPORTED_SCHEMA_VERSION",
          "The record uses an unsupported schema version.",
          "The record cannot be safely reinterpreted by this application version.",
          "FIX_INPUT",
          { expectedVersion: DOMAIN_SCHEMA_VERSION },
        ),
      }),
    );
  }
  return success(DOMAIN_SCHEMA_VERSION);
}

export function fixedClock(value: UtcInstant): Clock {
  return { now: () => value };
}

export function createActionRecord(input: {
  readonly actionId: ActionId;
  readonly transitionId: TransitionEventId;
  readonly actor: ActorKind;
  readonly issuedAt: UtcInstant;
  readonly expectedVersion?: number;
  readonly correlationId?: CorrelationId;
}): ActionRecord {
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    kind: "action-record",
    actionId: input.actionId,
    transitionId: input.transitionId,
    actor: input.actor,
    issuedAt: input.issuedAt,
    ...(input.expectedVersion === undefined
      ? {}
      : { expectedVersion: input.expectedVersion }),
    ...(input.correlationId === undefined
      ? {}
      : { correlationId: input.correlationId }),
  };
}

export function parseActionRecord(value: unknown): DomainResult<ActionRecord> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return failure(invalidValue("action record", value));
  }
  const data = value as Record<string, unknown>;
  const allowed = new Set([
    "schemaVersion",
    "kind",
    "actionId",
    "transitionId",
    "actor",
    "issuedAt",
    "expectedVersion",
    "correlationId",
  ]);
  if (Object.keys(data).some((key) => !allowed.has(key))) {
    return failure(invalidValue("action record", value));
  }
  const schema = parseSchemaVersion(data.schemaVersion);
  if (!schema.ok || data.kind !== "action-record") {
    return failure(
      schema.ok ? invalidValue("action record", value) : schema.error,
    );
  }
  const actionId = parseActionId(data.actionId);
  const transitionId = parseTransitionEventId(data.transitionId);
  const issuedAt = parseUtcInstant(data.issuedAt);
  if (!actionId.ok) return actionId;
  if (!transitionId.ok) return transitionId;
  if (!issuedAt.ok) return issuedAt;
  const expectedVersion = data.expectedVersion;
  if (
    (data.actor !== "SYSTEM" &&
      data.actor !== "HUMAN" &&
      data.actor !== "RECOVERY") ||
    (expectedVersion !== undefined &&
      (typeof expectedVersion !== "number" ||
        !Number.isInteger(expectedVersion) ||
        expectedVersion < 0)) ||
    (data.correlationId !== undefined &&
      !parseCorrelationId(data.correlationId).ok)
  ) {
    return failure(invalidValue("action record", value));
  }
  const correlationId =
    data.correlationId === undefined
      ? undefined
      : parseCorrelationId(data.correlationId);
  if (correlationId !== undefined && !correlationId.ok) return correlationId;
  return success({
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    kind: "action-record",
    actionId: actionId.value,
    transitionId: transitionId.value,
    actor: data.actor,
    issuedAt: issuedAt.value,
    ...(data.expectedVersion === undefined
      ? {}
      : { expectedVersion: expectedVersion as number }),
    ...(correlationId === undefined
      ? {}
      : { correlationId: correlationId.value }),
  });
}
