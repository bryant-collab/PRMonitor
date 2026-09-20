import {
  createDomainError,
  DOMAIN_SCHEMA_VERSION,
  failure,
  parseDomainReason,
  readStrictRecord,
  type ActionReason,
  type DomainResult,
  success,
  unsafeReason,
} from "./result";
import {
  changed,
  createTransitionEvent,
  type TransitionDecision,
  type TransitionEvent,
} from "./transition";
import {
  parseApprovalId,
  parseCommitSha,
  parseIdempotencyKey,
  parsePublicationId,
  parseReviewBundleId,
  parseSchemaVersion,
  parseSemanticHash,
  parseSynchronizationOperationId,
  parseUtcInstant,
  type ActionRecord,
  type Clock,
  type CommitSha,
  type HumanApprovalRecord,
  type IdempotencyKey,
  type PublicationId,
  type ReviewBundleId,
  type SynchronizationOperationId,
} from "./primitives";
import { parseTransitionEvent } from "./transition";

export const PUBLICATION_PHASES = [
  "NOT_STARTED",
  "APPROVAL_REQUIRED",
  "PREPARING",
  "COMMITTING",
  "PUSHING",
  "POSTING_RESPONSES",
  "RECOVERING",
  "PUBLISHED",
  "PUBLISHED_WITH_ERRORS",
  "DISCARDED",
  "FAILED",
] as const;
export type PublicationPhase = (typeof PUBLICATION_PHASES)[number];

export const PUBLICATION_TRANSITIONS = [
  ["NOT_STARTED", "REQUEST_APPROVAL", "APPROVAL_REQUIRED"],
  ["APPROVAL_REQUIRED", "HUMAN_APPROVAL", "PREPARING"],
  ["PREPARING", "PREPARATION_COMPLETE", "COMMITTING"],
  ["PREPARING", "DISCARD", "DISCARDED"],
  ["PREPARING", "FAIL", "FAILED"],
  ["COMMITTING", "COMMIT_CONFIRMED", "PUSHING"],
  ["COMMITTING", "COMMIT_UNCERTAIN", "RECOVERING"],
  ["COMMITTING", "FAIL", "FAILED"],
  ["PUSHING", "PUSH_CONFIRMED", "POSTING_RESPONSES"],
  ["PUSHING", "PUSH_UNCERTAIN", "RECOVERING"],
  ["PUSHING", "FAIL", "FAILED"],
  ["POSTING_RESPONSES", "RESPONSES_COMPLETE", "PUBLISHED"],
  ["POSTING_RESPONSES", "RESPONSES_PARTIAL", "PUBLISHED_WITH_ERRORS"],
  ["POSTING_RESPONSES", "RESPONSE_UNCERTAIN", "RECOVERING"],
  ["POSTING_RESPONSES", "FAIL", "FAILED"],
  ["RECOVERING", "RECONCILE_COMMIT_ABSENT", "COMMITTING"],
  ["RECOVERING", "RECONCILE_COMMIT_PRESENT", "PUSHING"],
  ["RECOVERING", "RECONCILE_PUSH_PRESENT", "POSTING_RESPONSES"],
  ["RECOVERING", "RECONCILE_RESPONSES", "PUBLISHED"],
  ["RECOVERING", "RECONCILE_RESPONSES", "PUBLISHED_WITH_ERRORS"],
  ["PUBLISHED_WITH_ERRORS", "RESUME_RESPONSES", "POSTING_RESPONSES"],
] as const;

export type PublicationOwner =
  | { readonly kind: "REVIEW_BUNDLE"; readonly id: ReviewBundleId }
  | {
      readonly kind: "SYNCHRONIZATION";
      readonly id: SynchronizationOperationId;
    };

export type PublicationResponseState =
  "PENDING" | "POSTED" | "FAILED" | "UNKNOWN";

export interface PublicationResponseRecord {
  readonly responseKey: string;
  readonly state: PublicationResponseState;
  readonly remoteId?: string;
  readonly failureReason?: ActionReason;
}

export type RecoveryStatus =
  "NOT_REQUIRED" | "RECONCILIATION_REQUIRED" | "RECONCILED";

export interface PublicationRecord {
  readonly schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  readonly kind: "publication-record";
  readonly id: PublicationId;
  readonly idempotencyKey: IdempotencyKey;
  readonly owner: PublicationOwner;
  readonly phase: PublicationPhase;
  readonly approval?: HumanApprovalRecord;
  readonly recoveryStatus: RecoveryStatus;
  readonly commitSha?: CommitSha;
  readonly codePublished: boolean;
  readonly responses: readonly PublicationResponseRecord[];
  readonly version: number;
  readonly currentReason?: ActionReason;
  readonly history: readonly TransitionEvent[];
}

export interface PublicationRequestApprovalAction {
  readonly type: "REQUEST_APPROVAL";
  readonly action: ActionRecord;
  readonly reason?: ActionReason;
}
export interface PublicationHumanApprovalAction {
  readonly type: "HUMAN_APPROVAL";
  readonly action: ActionRecord;
  readonly approval: HumanApprovalRecord;
}
export interface PublicationPreparationAction {
  readonly type: "PREPARATION_COMPLETE";
  readonly action: ActionRecord;
}
export interface PublicationEffectAction {
  readonly type:
    | "COMMIT_CONFIRMED"
    | "COMMIT_UNCERTAIN"
    | "PUSH_CONFIRMED"
    | "PUSH_UNCERTAIN"
    | "RESPONSES_COMPLETE"
    | "RESPONSES_PARTIAL"
    | "RESPONSE_UNCERTAIN"
    | "FAIL";
  readonly action: ActionRecord;
  readonly reason?: ActionReason;
  readonly commitSha?: CommitSha;
  readonly possibleSideEffect?: boolean;
}
export interface PublicationRecoveryAction {
  readonly type:
    | "RECONCILE_COMMIT_ABSENT"
    | "RECONCILE_COMMIT_PRESENT"
    | "RECONCILE_PUSH_PRESENT"
    | "RECONCILE_RESPONSES";
  readonly action: ActionRecord;
  readonly commitSha?: CommitSha;
  readonly allResponsesReconciled?: boolean;
  readonly reason: ActionReason;
}
export interface PublicationResumeResponsesAction {
  readonly type: "RESUME_RESPONSES";
  readonly action: ActionRecord;
  readonly reason?: ActionReason;
}
export interface PublicationDiscardAction {
  readonly type: "DISCARD";
  readonly action: ActionRecord;
  readonly reason?: ActionReason;
}

export type PublicationAction =
  | PublicationRequestApprovalAction
  | PublicationHumanApprovalAction
  | PublicationPreparationAction
  | PublicationEffectAction
  | PublicationRecoveryAction
  | PublicationResumeResponsesAction
  | PublicationDiscardAction;

function invalidReason(phase: PublicationPhase, action: string): ActionReason {
  return unsafeReason(
    "INVALID_TRANSITION",
    `Publication is in ${phase} and cannot perform ${action}.`,
    "Only the documented publication phase transitions may run.",
    "REVIEW",
    { phase, action },
  );
}

function publicationEvent(
  previous: PublicationRecord,
  nextPhase: PublicationPhase,
  action: ActionRecord,
  clock: Clock,
  reason?: ActionReason,
): TransitionEvent {
  return createTransitionEvent({
    transitionId: action.transitionId,
    actionId: action.actionId,
    actor: action.actor,
    aggregateKind: "PUBLICATION",
    aggregateId: previous.id,
    priorState: previous.phase,
    nextState: nextPhase,
    occurredAt: clock.now(),
    ...(reason === undefined ? {} : { reason }),
    ...(action.correlationId === undefined
      ? {}
      : { correlationId: action.correlationId }),
  });
}

function applyPublicationPhase(
  previous: PublicationRecord,
  nextPhase: PublicationPhase,
  action: ActionRecord,
  clock: Clock,
  reason?: ActionReason,
  extra: Partial<PublicationRecord> = {},
): TransitionDecision<PublicationRecord> {
  const event = publicationEvent(previous, nextPhase, action, clock, reason);
  return changed(
    {
      ...previous,
      ...extra,
      phase: nextPhase,
      version: previous.version + 1,
      ...(reason === undefined ? {} : { currentReason: reason }),
      history: [...previous.history, event],
    },
    event,
  );
}

function publicationError<T>(
  record: PublicationRecord,
  reason: ActionReason,
  code:
    | "INVALID_TRANSITION"
    | "PUBLICATION_APPROVAL_REQUIRED"
    | "UNKNOWN_EXTERNAL_OUTCOME"
    | "PUBLICATION_ALREADY_ACTIVE" = "INVALID_TRANSITION",
): DomainResult<T> {
  const category =
    code === "UNKNOWN_EXTERNAL_OUTCOME"
      ? "UNKNOWN_EXTERNAL_OUTCOME"
      : code === "PUBLICATION_APPROVAL_REQUIRED"
        ? "PERMANENT_FAILURE"
        : code === "PUBLICATION_ALREADY_ACTIVE"
          ? "CONFLICT"
          : "INVALID_TRANSITION";
  return failure(
    createDomainError({
      code,
      category,
      retryable:
        code === "UNKNOWN_EXTERNAL_OUTCOME" ||
        code === "PUBLICATION_ALREADY_ACTIVE",
      userAction: reason.nextAction,
      messageKey: `domain.publication.${code.toLowerCase()}`,
      reason,
      priorState: record.phase,
      currentState: record.phase,
      details: { idempotencyKey: record.idempotencyKey },
    }),
  );
}

export function createPublicationRecord(input: {
  readonly id: PublicationId;
  readonly idempotencyKey: IdempotencyKey;
  readonly owner: PublicationOwner;
  readonly responseKeys?: readonly string[];
}): PublicationRecord {
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    kind: "publication-record",
    id: input.id,
    idempotencyKey: input.idempotencyKey,
    owner: input.owner,
    phase: "NOT_STARTED",
    recoveryStatus: "NOT_REQUIRED",
    codePublished: false,
    responses: (input.responseKeys ?? []).map((responseKey) => ({
      responseKey,
      state: "PENDING",
    })),
    version: 0,
    history: [],
  };
}

export function reducePublication(
  record: PublicationRecord,
  action: PublicationAction,
  clock: Clock,
): DomainResult<TransitionDecision<PublicationRecord>> {
  if (
    action.action.expectedVersion !== undefined &&
    action.action.expectedVersion !== record.version
  ) {
    return publicationError(
      record,
      unsafeReason(
        "CONCURRENT_STATE_CONFLICT",
        "The publication record changed before this action was applied.",
        "A retry must use the current durable phase and idempotency key.",
        "RETRY",
      ),
    );
  }

  if (action.type === "REQUEST_APPROVAL") {
    if (record.phase !== "NOT_STARTED")
      return publicationError(record, invalidReason(record.phase, action.type));
    return success(
      applyPublicationPhase(
        record,
        "APPROVAL_REQUIRED",
        action.action,
        clock,
        action.reason ??
          unsafeReason(
            "APPROVAL_REQUIRED",
            "Publication is waiting for explicit human approval.",
            "Preparation and publication remain blocked until the exact result is reviewed.",
            "APPROVE",
          ),
      ),
    );
  }

  if (action.type === "HUMAN_APPROVAL") {
    if (
      record.phase !== "APPROVAL_REQUIRED" ||
      action.action.actor !== "HUMAN" ||
      action.approval.actor !== "HUMAN" ||
      action.approval.kind !== "human-approval" ||
      action.approval.approvalId.length === 0 ||
      (record.owner.kind === "REVIEW_BUNDLE" &&
        action.approval.scope !== "REVIEW_BUNDLE_PUBLICATION") ||
      (record.owner.kind === "SYNCHRONIZATION" &&
        action.approval.scope !== "SYNCHRONIZATION_PUBLICATION")
    ) {
      return publicationError(
        record,
        unsafeReason(
          "PUBLICATION_APPROVAL_REQUIRED",
          "Publication requires a matching explicit human approval record.",
          "No scheduler, AI provider, or phase transition may grant publication authority.",
          "APPROVE",
        ),
        "PUBLICATION_APPROVAL_REQUIRED",
      );
    }
    return success(
      applyPublicationPhase(
        record,
        "PREPARING",
        action.action,
        clock,
        undefined,
        {
          approval: action.approval,
        },
      ),
    );
  }

  if (action.type === "PREPARATION_COMPLETE") {
    if (record.phase !== "PREPARING" || record.approval === undefined) {
      return publicationError(record, invalidReason(record.phase, action.type));
    }
    return success(
      applyPublicationPhase(record, "COMMITTING", action.action, clock),
    );
  }

  if (
    action.type === "COMMIT_CONFIRMED" ||
    action.type === "COMMIT_UNCERTAIN" ||
    action.type === "PUSH_CONFIRMED" ||
    action.type === "PUSH_UNCERTAIN" ||
    action.type === "RESPONSES_COMPLETE" ||
    action.type === "RESPONSES_PARTIAL" ||
    action.type === "RESPONSE_UNCERTAIN" ||
    action.type === "FAIL"
  ) {
    const valid =
      (action.type === "COMMIT_CONFIRMED" && record.phase === "COMMITTING") ||
      (action.type === "COMMIT_UNCERTAIN" && record.phase === "COMMITTING") ||
      (action.type === "PUSH_CONFIRMED" && record.phase === "PUSHING") ||
      (action.type === "PUSH_UNCERTAIN" && record.phase === "PUSHING") ||
      (action.type === "RESPONSES_COMPLETE" &&
        record.phase === "POSTING_RESPONSES") ||
      (action.type === "RESPONSES_PARTIAL" &&
        record.phase === "POSTING_RESPONSES") ||
      (action.type === "RESPONSE_UNCERTAIN" &&
        record.phase === "POSTING_RESPONSES") ||
      (action.type === "FAIL" &&
        ["PREPARING", "COMMITTING", "PUSHING", "POSTING_RESPONSES"].includes(
          record.phase,
        ));
    if (!valid)
      return publicationError(record, invalidReason(record.phase, action.type));
    if (action.type === "COMMIT_CONFIRMED" && action.commitSha === undefined) {
      return publicationError(
        record,
        unsafeReason(
          "COMMIT_SHA_REQUIRED",
          "The commit result did not include a commit SHA.",
          "Recovery cannot safely distinguish a known commit from a fresh side effect without the recorded identity.",
          "RECONCILE",
        ),
        "UNKNOWN_EXTERNAL_OUTCOME",
      );
    }
    if (
      action.commitSha !== undefined &&
      record.commitSha !== undefined &&
      action.commitSha !== record.commitSha
    ) {
      return publicationError(
        record,
        unsafeReason(
          "COMMIT_IDENTITY_CHANGED",
          "The publication reported a different commit SHA than the recorded one.",
          "A retry cannot replace a known side-effect identity.",
          "RECONCILE",
        ),
        "UNKNOWN_EXTERNAL_OUTCOME",
      );
    }
    const commitSha = action.commitSha ?? record.commitSha;
    if (action.type === "COMMIT_CONFIRMED") {
      return success(
        applyPublicationPhase(
          record,
          "PUSHING",
          action.action,
          clock,
          action.reason,
          {
            commitSha,
          },
        ),
      );
    }
    if (action.type === "COMMIT_UNCERTAIN") {
      return success(
        applyPublicationPhase(
          record,
          "RECOVERING",
          action.action,
          clock,
          action.reason ?? unknownReason(),
          {
            commitSha,
            recoveryStatus: "RECONCILIATION_REQUIRED",
          },
        ),
      );
    }
    if (action.type === "PUSH_CONFIRMED") {
      return success(
        applyPublicationPhase(
          record,
          "POSTING_RESPONSES",
          action.action,
          clock,
          action.reason,
          {
            commitSha,
            codePublished: true,
            recoveryStatus: "NOT_REQUIRED",
          },
        ),
      );
    }
    if (action.type === "PUSH_UNCERTAIN") {
      return success(
        applyPublicationPhase(
          record,
          "RECOVERING",
          action.action,
          clock,
          action.reason ?? unknownReason(),
          {
            commitSha,
            recoveryStatus: "RECONCILIATION_REQUIRED",
          },
        ),
      );
    }
    if (action.type === "RESPONSES_COMPLETE") {
      return success(
        applyPublicationPhase(
          record,
          "PUBLISHED",
          action.action,
          clock,
          action.reason,
          {
            recoveryStatus: "NOT_REQUIRED",
          },
        ),
      );
    }
    if (action.type === "RESPONSES_PARTIAL") {
      return success(
        applyPublicationPhase(
          record,
          "PUBLISHED_WITH_ERRORS",
          action.action,
          clock,
          action.reason,
          {
            recoveryStatus: "NOT_REQUIRED",
          },
        ),
      );
    }
    if (action.type === "RESPONSE_UNCERTAIN") {
      return success(
        applyPublicationPhase(
          record,
          "RECOVERING",
          action.action,
          clock,
          action.reason ?? unknownReason(),
          {
            recoveryStatus: "RECONCILIATION_REQUIRED",
          },
        ),
      );
    }
    return success(
      applyPublicationPhase(
        record,
        "FAILED",
        action.action,
        clock,
        action.reason ?? failedReason(),
      ),
    );
  }

  if (
    action.type === "RECONCILE_COMMIT_ABSENT" ||
    action.type === "RECONCILE_COMMIT_PRESENT" ||
    action.type === "RECONCILE_PUSH_PRESENT" ||
    action.type === "RECONCILE_RESPONSES"
  ) {
    if (record.phase !== "RECOVERING") {
      return publicationError(record, invalidReason(record.phase, action.type));
    }
    if (
      action.type !== "RECONCILE_RESPONSES" &&
      action.commitSha !== undefined &&
      record.commitSha !== undefined &&
      action.commitSha !== record.commitSha
    ) {
      return publicationError(
        record,
        unsafeReason(
          "COMMIT_IDENTITY_CHANGED",
          "Recovery found a different commit identity.",
          "The existing idempotency record cannot be replaced by a new side effect.",
          "RECONCILE",
        ),
        "UNKNOWN_EXTERNAL_OUTCOME",
      );
    }
    if (action.type === "RECONCILE_COMMIT_ABSENT") {
      return success(
        applyPublicationPhase(
          record,
          "COMMITTING",
          action.action,
          clock,
          action.reason,
          {
            recoveryStatus: "RECONCILED",
          },
        ),
      );
    }
    if (action.type === "RECONCILE_COMMIT_PRESENT") {
      return success(
        applyPublicationPhase(
          record,
          "PUSHING",
          action.action,
          clock,
          action.reason,
          {
            commitSha: action.commitSha ?? record.commitSha,
            recoveryStatus: "RECONCILED",
          },
        ),
      );
    }
    if (action.type === "RECONCILE_PUSH_PRESENT") {
      return success(
        applyPublicationPhase(
          record,
          "POSTING_RESPONSES",
          action.action,
          clock,
          action.reason,
          {
            commitSha: action.commitSha ?? record.commitSha,
            codePublished: true,
            recoveryStatus: "RECONCILED",
          },
        ),
      );
    }
    const allResponsesReconciled = action.allResponsesReconciled === true;
    return success(
      applyPublicationPhase(
        record,
        allResponsesReconciled ? "PUBLISHED" : "PUBLISHED_WITH_ERRORS",
        action.action,
        clock,
        action.reason,
        { recoveryStatus: "RECONCILED" },
      ),
    );
  }

  if (action.type === "RESUME_RESPONSES") {
    if (record.phase !== "PUBLISHED_WITH_ERRORS" || !record.codePublished) {
      return publicationError(record, invalidReason(record.phase, action.type));
    }
    return success(
      applyPublicationPhase(
        record,
        "POSTING_RESPONSES",
        action.action,
        clock,
        action.reason ??
          unsafeReason(
            "RETRY_RESPONSES_ONLY",
            "Only unreconciled responses will be retried.",
            "The already published code cannot be published a second time for the same idempotency key.",
            "NONE",
          ),
      ),
    );
  }

  if (action.type === "DISCARD") {
    if (
      !["NOT_STARTED", "APPROVAL_REQUIRED", "PREPARING"].includes(
        record.phase,
      ) ||
      action.action.actor !== "HUMAN"
    ) {
      return publicationError(record, invalidReason(record.phase, action.type));
    }
    return success(
      applyPublicationPhase(
        record,
        "DISCARDED",
        action.action,
        clock,
        action.reason ??
          unsafeReason(
            "DISCARDED",
            "The publication intent was discarded before an external side effect.",
            "No commit or push is authorized by a discarded publication.",
            "NONE",
          ),
      ),
    );
  }

  return publicationError(record, invalidReason(record.phase, action.type));
}

function unknownReason(): ActionReason {
  return unsafeReason(
    "UNKNOWN_EXTERNAL_OUTCOME",
    "An external publication response was unavailable after a possible side effect.",
    "The existing idempotency key and known identifiers must be reconciled before retrying.",
    "RECONCILE",
  );
}

function failedReason(): ActionReason {
  return unsafeReason(
    "PUBLICATION_FAILED",
    "Publication failed before a confirmed complete outcome.",
    "The persisted publication history remains available for review and deterministic recovery decisions.",
    "REVIEW",
  );
}

export function replayPublication(
  record: PublicationRecord,
  idempotencyKey: IdempotencyKey,
): DomainResult<{
  readonly record: PublicationRecord;
  readonly replayed: true;
}> {
  if (record.idempotencyKey === idempotencyKey) {
    return success({ record, replayed: true });
  }
  return publicationError(
    record,
    unsafeReason(
      "PUBLICATION_ALREADY_ACTIVE",
      "A different idempotency key cannot replace this publication intent.",
      "Retries must reconcile the existing durable publication record instead of creating a second side effect.",
      "RECONCILE",
    ),
    "PUBLICATION_ALREADY_ACTIVE",
  );
}

export function canStartCodePublication(record: PublicationRecord): boolean {
  return (
    record.approval !== undefined &&
    !record.codePublished &&
    ["PREPARING", "COMMITTING"].includes(record.phase)
  );
}

export function isPublicationUncertain(record: PublicationRecord): boolean {
  return (
    record.phase === "RECOVERING" ||
    record.recoveryStatus === "RECONCILIATION_REQUIRED"
  );
}

export interface PublicationResponseUpdate {
  readonly responseKey: string;
  readonly state: PublicationResponseState;
  readonly remoteId?: string;
  readonly failureReason?: ActionReason;
}

export function updatePublicationResponse(
  record: PublicationRecord,
  update: PublicationResponseUpdate,
): DomainResult<PublicationRecord> {
  const index = record.responses.findIndex(
    (response) => response.responseKey === update.responseKey,
  );
  if (index < 0) {
    return publicationError(
      record,
      unsafeReason(
        "INVALID_RESPONSE_KEY",
        "The publication response key is not part of this approved result.",
        "A response outside the persisted approval cannot be posted.",
        "FIX_INPUT",
      ),
    );
  }
  const current = record.responses[index];
  if (current === undefined)
    return publicationError(
      record,
      invalidReason(record.phase, "UPDATE_RESPONSE"),
    );
  if (current.state === "POSTED" && update.state !== "POSTED") {
    return success(record);
  }
  if (current.state === "POSTED" && current.remoteId !== update.remoteId) {
    return publicationError(
      record,
      unsafeReason(
        "RESPONSE_IDENTITY_CHANGED",
        "A posted response reported a different remote identifier.",
        "A retry cannot post the same approved response a second time.",
        "RECONCILE",
      ),
      "UNKNOWN_EXTERNAL_OUTCOME",
    );
  }
  const responses = record.responses.map((response, responseIndex) =>
    responseIndex === index ? { ...response, ...update } : response,
  );
  return success({ ...record, responses, version: record.version + 1 });
}

export function parseHumanApproval(
  value: unknown,
): DomainResult<HumanApprovalRecord> {
  const record = readStrictRecord(
    value,
    "human approval",
    ["schemaVersion", "kind", "approvalId", "actor", "approvedAt", "scope"],
    ["reviewedSnapshotHash"],
  );
  if (!record.ok) return record;
  const data = record.value;
  const schema = parseSchemaVersion(data.schemaVersion);
  const approvalId = parseApprovalId(data.approvalId);
  const approvedAt = parseUtcInstant(data.approvedAt);
  const snapshotHash =
    data.reviewedSnapshotHash === undefined
      ? undefined
      : parseSemanticHash(data.reviewedSnapshotHash);
  if (!schema.ok) return schema;
  if (!approvalId.ok) return approvalId;
  if (!approvedAt.ok) return approvedAt;
  if (snapshotHash !== undefined && !snapshotHash.ok) return snapshotHash;
  if (
    data.kind !== "human-approval" ||
    data.actor !== "HUMAN" ||
    (data.scope !== "REVIEW_BUNDLE_PUBLICATION" &&
      data.scope !== "SYNCHRONIZATION_PUBLICATION")
  ) {
    return failure(
      createDomainError({
        code: "PUBLICATION_APPROVAL_REQUIRED",
        category: "PERMANENT_FAILURE",
        retryable: false,
        userAction: "APPROVE",
        messageKey: "domain.publication.approval-required",
        reason: unsafeReason(
          "PUBLICATION_APPROVAL_REQUIRED",
          "The approval record is not an explicit human approval.",
          "AI, scheduler, and renderer records cannot authorize publication.",
          "APPROVE",
        ),
      }),
    );
  }
  return success({
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    kind: "human-approval",
    approvalId: approvalId.value,
    actor: "HUMAN",
    approvedAt: approvedAt.value,
    scope: data.scope,
    ...(snapshotHash === undefined
      ? {}
      : { reviewedSnapshotHash: snapshotHash.value }),
  });
}

export function parsePublicationRecord(
  value: unknown,
): DomainResult<PublicationRecord> {
  const record = readStrictRecord(
    value,
    "publication record",
    [
      "schemaVersion",
      "kind",
      "id",
      "idempotencyKey",
      "owner",
      "phase",
      "recoveryStatus",
      "codePublished",
      "responses",
      "version",
      "history",
    ],
    ["approval", "commitSha", "currentReason"],
  );
  if (!record.ok) return record;
  const data = record.value;
  const schema = parseSchemaVersion(data.schemaVersion);
  const id = parsePublicationId(data.id);
  const key = parseIdempotencyKey(data.idempotencyKey);
  if (!schema.ok) return schema;
  if (!id.ok) return id;
  if (!key.ok) return key;
  if (
    data.kind !== "publication-record" ||
    !PUBLICATION_PHASES.includes(data.phase as PublicationPhase) ||
    !["NOT_REQUIRED", "RECONCILIATION_REQUIRED", "RECONCILED"].includes(
      data.recoveryStatus as RecoveryStatus,
    ) ||
    typeof data.codePublished !== "boolean" ||
    !Array.isArray(data.responses) ||
    !Number.isInteger(data.version) ||
    (data.version as number) < 0 ||
    !Array.isArray(data.history)
  ) {
    return failure(
      createDomainError({
        code: "INVALID_CONTRACT",
        category: "INVALID_INPUT",
        retryable: false,
        userAction: "FIX_INPUT",
        messageKey: "domain.publication.invalid",
        reason: unsafeReason(
          "INVALID_CONTRACT",
          "The publication record contains an unknown phase or invalid value.",
          "Publication recovery must fail closed rather than repeat an external side effect.",
          "FIX_INPUT",
        ),
      }),
    );
  }
  const ownerRecord = data.owner;
  if (
    typeof ownerRecord !== "object" ||
    ownerRecord === null ||
    Array.isArray(ownerRecord)
  ) {
    return failure(
      createDomainError({
        code: "INVALID_CONTRACT",
        category: "INVALID_INPUT",
        retryable: false,
        userAction: "FIX_INPUT",
        messageKey: "domain.publication.invalid",
        reason: unsafeReason(
          "INVALID_CONTRACT",
          "The publication owner is invalid.",
          "A publication must retain its exact bundle or synchronization owner.",
          "FIX_INPUT",
        ),
      }),
    );
  }
  const ownerRecordShape = readStrictRecord(ownerRecord, "publication owner", [
    "kind",
    "id",
  ]);
  if (!ownerRecordShape.ok) return ownerRecordShape;
  const owner = ownerRecordShape.value;
  const ownerId =
    owner.kind === "REVIEW_BUNDLE"
      ? parseReviewBundleId(owner.id)
      : owner.kind === "SYNCHRONIZATION"
        ? parseSynchronizationOperationId(owner.id)
        : failure<ReviewBundleId>(
            createDomainError({
              code: "INVALID_CONTRACT",
              category: "INVALID_INPUT",
              retryable: false,
              userAction: "FIX_INPUT",
              messageKey: "domain.publication.invalid",
              reason: unsafeReason(
                "INVALID_CONTRACT",
                "The publication owner kind is unknown.",
                "Only Review Bundle and synchronization publication owners are supported.",
                "FIX_INPUT",
              ),
            }),
          );
  if (!ownerId.ok) return ownerId;
  const commitSha =
    data.commitSha === undefined ? undefined : parseCommitSha(data.commitSha);
  if (commitSha !== undefined && !commitSha.ok) return commitSha;
  const approval =
    data.approval === undefined ? undefined : parseHumanApproval(data.approval);
  if (approval !== undefined && !approval.ok) return approval;
  const currentReason =
    data.currentReason === undefined
      ? undefined
      : parseDomainReason(data.currentReason);
  if (currentReason !== undefined && !currentReason.ok) return currentReason;
  const history: TransitionEvent[] = [];
  for (const event of data.history) {
    const parsed = parseTransitionEvent(event);
    if (!parsed.ok) return parsed;
    if (
      parsed.value.aggregateKind !== "PUBLICATION" ||
      parsed.value.aggregateId !== id.value
    ) {
      return failure(
        createDomainError({
          code: "INVALID_CONTRACT",
          category: "INVALID_INPUT",
          retryable: false,
          userAction: "FIX_INPUT",
          messageKey: "domain.publication.history-invalid",
          reason: unsafeReason(
            "INVALID_CONTRACT",
            "The publication history contains another aggregate.",
            "Recovery history must remain scoped to one idempotent publication intent.",
            "FIX_INPUT",
          ),
        }),
      );
    }
    history.push(parsed.value);
  }
  const responses: PublicationResponseRecord[] = [];
  for (const response of data.responses) {
    if (
      typeof response !== "object" ||
      response === null ||
      Array.isArray(response)
    ) {
      return failure(
        createDomainError({
          code: "INVALID_CONTRACT",
          category: "INVALID_INPUT",
          retryable: false,
          userAction: "FIX_INPUT",
          messageKey: "domain.publication.invalid",
          reason: unsafeReason(
            "INVALID_CONTRACT",
            "A publication response record is invalid.",
            "Per-response remote identity must be restored without coercion.",
            "FIX_INPUT",
          ),
        }),
      );
    }
    const responseData = response as Record<string, unknown>;
    const responseKeys = new Set([
      "responseKey",
      "state",
      "remoteId",
      "failureReason",
    ]);
    if (Object.keys(responseData).some((field) => !responseKeys.has(field))) {
      return failure(
        createDomainError({
          code: "INVALID_CONTRACT",
          category: "INVALID_INPUT",
          retryable: false,
          userAction: "FIX_INPUT",
          messageKey: "domain.publication.invalid",
          reason: unsafeReason(
            "INVALID_CONTRACT",
            "A publication response contains unsupported fields.",
            "Unknown response metadata could be used to duplicate an external effect.",
            "FIX_INPUT",
          ),
        }),
      );
    }
    const parsedReason =
      responseData.failureReason === undefined
        ? undefined
        : parseDomainReason(responseData.failureReason);
    if (parsedReason !== undefined && !parsedReason.ok) return parsedReason;
    if (
      typeof responseData.responseKey !== "string" ||
      !["PENDING", "POSTED", "FAILED", "UNKNOWN"].includes(
        responseData.state as string,
      ) ||
      (responseData.remoteId !== undefined &&
        (typeof responseData.remoteId !== "string" ||
          responseData.remoteId.length === 0))
    ) {
      return failure(
        createDomainError({
          code: "INVALID_CONTRACT",
          category: "INVALID_INPUT",
          retryable: false,
          userAction: "FIX_INPUT",
          messageKey: "domain.publication.invalid",
          reason: unsafeReason(
            "INVALID_CONTRACT",
            "A publication response contains invalid state values.",
            "Only known pending, posted, failed, or unknown response states are accepted.",
            "FIX_INPUT",
          ),
        }),
      );
    }
    responses.push({
      responseKey: responseData.responseKey,
      state: responseData.state as PublicationResponseState,
      ...(responseData.remoteId === undefined
        ? {}
        : { remoteId: responseData.remoteId }),
      ...(parsedReason === undefined
        ? {}
        : { failureReason: parsedReason.value }),
    });
  }
  return success({
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    kind: "publication-record",
    id: id.value,
    idempotencyKey: key.value,
    owner:
      owner.kind === "REVIEW_BUNDLE"
        ? { kind: "REVIEW_BUNDLE", id: ownerId.value as ReviewBundleId }
        : {
            kind: "SYNCHRONIZATION",
            id: ownerId.value as SynchronizationOperationId,
          },
    phase: data.phase as PublicationPhase,
    ...(approval === undefined ? {} : { approval: approval.value }),
    recoveryStatus: data.recoveryStatus as RecoveryStatus,
    codePublished: data.codePublished,
    ...(commitSha === undefined ? {} : { commitSha: commitSha.value }),
    responses,
    version: data.version as number,
    ...(currentReason === undefined
      ? {}
      : { currentReason: currentReason.value }),
    history,
  });
}
