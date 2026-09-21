import {
  createDomainError,
  DOMAIN_SCHEMA_VERSION,
  failure,
  parseDomainReason,
  isSafeJsonValue,
  type ActionReason,
  type DomainResult,
  success,
  unsafeReason,
} from "./result";
import {
  changed,
  createTransitionEvent,
  noOp,
  type TransitionDecision,
  type TransitionEvent,
} from "./transition";
import { parseTransitionEvent } from "./transition";
import {
  parseBranchName,
  parseCommitSha,
  parseManagedPrId,
  parseRepositoryId,
  parseSchemaVersion,
  parseSynchronizationOperationId,
  parseSynchronizationBatchId,
  parseUtcInstant,
  parseWorktreeId,
  type ActionRecord,
  type BranchName,
  type Clock,
  type CommitSha,
  type ManagedPrId,
  type RepositoryId,
  type SynchronizationBatchId,
  type SynchronizationOperationId,
  type UtcInstant,
  type WorktreeId,
} from "./primitives";
import type { SafeJsonValue } from "./result";

export const SYNCHRONIZATION_STATUSES = [
  "SKIPPED",
  "MERGING",
  "RESOLVING_CONFLICTS",
  "READY_TO_PUBLISH",
  "NEEDS_ATTENTION",
  "STALE",
  "PUBLISHING",
  "PUBLISHED",
  "DISCARDED",
  "FAILED",
] as const;
export type SynchronizationStatus = (typeof SYNCHRONIZATION_STATUSES)[number];

export interface SynchronizationChangeEvidence {
  readonly paths: readonly string[];
  readonly summary?: string;
  readonly details?: SafeJsonValue;
}

export interface SynchronizationConflictEvidence {
  readonly path: string;
  readonly source?: string;
  readonly destination?: string;
  readonly mergeBase?: string;
  readonly details?: SafeJsonValue;
}

export interface SynchronizationUserConsultation {
  readonly question: string;
  readonly competingIntents: readonly string[];
  readonly requestedAt: UtcInstant;
}

export const SYNCHRONIZATION_TRANSITIONS = [
  ["SKIPPED", "BEGIN_MERGE", "MERGING"],
  ["MERGING", "MERGE_CONFLICT", "RESOLVING_CONFLICTS"],
  ["MERGING", "MERGE_CLEAN", "READY_TO_PUBLISH"],
  ["MERGING", "VALIDATION_FAILED", "NEEDS_ATTENTION"],
  ["MERGING", "FAIL", "FAILED"],
  ["RESOLVING_CONFLICTS", "RESOLUTION_SUCCEEDED", "READY_TO_PUBLISH"],
  ["RESOLVING_CONFLICTS", "AMBIGUOUS_CONFLICT", "NEEDS_ATTENTION"],
  ["RESOLVING_CONFLICTS", "VALIDATION_FAILED", "NEEDS_ATTENTION"],
  ["RESOLVING_CONFLICTS", "FAIL", "FAILED"],
  ["READY_TO_PUBLISH", "MARK_STALE", "STALE"],
  ["READY_TO_PUBLISH", "APPROVE_PUBLICATION", "PUBLISHING"],
  ["READY_TO_PUBLISH", "DISCARD", "DISCARDED"],
  ["NEEDS_ATTENTION", "RETRY_RESOLUTION", "RESOLVING_CONFLICTS"],
  ["NEEDS_ATTENTION", "RE_EVALUATE", "MERGING"],
  ["NEEDS_ATTENTION", "DISCARD", "DISCARDED"],
  ["STALE", "RE_EVALUATE", "MERGING"],
  ["STALE", "DISCARD", "DISCARDED"],
  ["PUBLISHING", "PUBLISHED", "PUBLISHED"],
  ["PUBLISHING", "FAIL", "FAILED"],
  ["FAILED", "RE_EVALUATE", "MERGING"],
  ["FAILED", "DISCARD", "DISCARDED"],
] as const;

export interface SynchronizationResult {
  readonly schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  readonly kind: "synchronization-result";
  readonly id: SynchronizationOperationId;
  readonly batchId?: SynchronizationBatchId;
  readonly prId: ManagedPrId;
  readonly prBaseBranch: BranchName;
  readonly prHeadBranch: BranchName;
  readonly syncSourceBranchOverride?: BranchName;
  readonly syncSourceBranch: BranchName;
  readonly sourceRepositoryId: RepositoryId;
  readonly destinationRepositoryId: RepositoryId;
  readonly syncSourceSha?: CommitSha;
  readonly prHeadSha?: CommitSha;
  readonly syncMergeBaseSha?: CommitSha;
  readonly sourceChangeEvidence?: SynchronizationChangeEvidence;
  readonly prHeadChangeEvidence?: SynchronizationChangeEvidence;
  readonly conflictEvidence: readonly SynchronizationConflictEvidence[];
  readonly userConsultation?: SynchronizationUserConsultation;
  readonly operationId: SynchronizationOperationId;
  readonly worktreeId?: WorktreeId;
  readonly status: SynchronizationStatus;
  readonly currentReason: ActionReason;
  readonly version: number;
  readonly createdAt: UtcInstant;
  readonly updatedAt: UtcInstant;
  readonly history: readonly TransitionEvent[];
}

export interface BeginSynchronizationAction {
  readonly type: "BEGIN_MERGE";
  readonly action: ActionRecord;
  readonly eligible: boolean;
}
export interface SynchronizationProgressAction {
  readonly type:
    | "MERGE_CONFLICT"
    | "MERGE_CLEAN"
    | "VALIDATION_FAILED"
    | "RESOLUTION_SUCCEEDED"
    | "AMBIGUOUS_CONFLICT"
    | "FAIL";
  readonly action: ActionRecord;
  readonly reason: ActionReason;
  readonly consultation?: SynchronizationUserConsultation;
}
export interface SynchronizationStaleAction {
  readonly type: "MARK_STALE";
  readonly action: ActionRecord;
  readonly reason: ActionReason;
  readonly sourceMoved: boolean;
  readonly headMoved: boolean;
}
export interface SynchronizationApproveAction {
  readonly type: "APPROVE_PUBLICATION";
  readonly action: ActionRecord;
  readonly approvalId: string;
}
export interface SynchronizationUserAction {
  readonly type: "RETRY_RESOLUTION" | "RE_EVALUATE" | "DISCARD";
  readonly action: ActionRecord;
  readonly reason?: ActionReason;
  readonly worktreeHandled?: boolean;
}
export interface SynchronizationPublishedAction {
  readonly type: "PUBLISHED";
  readonly action: ActionRecord;
  readonly reason: ActionReason;
}

export type SynchronizationAction =
  | BeginSynchronizationAction
  | SynchronizationProgressAction
  | SynchronizationStaleAction
  | SynchronizationApproveAction
  | SynchronizationUserAction
  | SynchronizationPublishedAction;

function defaultSkippedReason(): ActionReason {
  return unsafeReason(
    "SYNC_SKIPPED",
    "This pull request was not selected for synchronization.",
    "An ineligible or excluded result must remain visible with its reason.",
    "REVIEW",
  );
}

function invalidReason(
  status: SynchronizationStatus,
  action: string,
): ActionReason {
  return unsafeReason(
    "INVALID_TRANSITION",
    `The synchronization result is ${status} and cannot perform ${action}.`,
    "Each synchronization result has an independent documented lifecycle.",
    "REVIEW",
    { status, action },
  );
}

function syncEvent(
  previous: SynchronizationResult,
  nextStatus: SynchronizationStatus,
  action: ActionRecord,
  clock: Clock,
  reason?: ActionReason,
): TransitionEvent {
  return createTransitionEvent({
    transitionId: action.transitionId,
    actionId: action.actionId,
    actor: action.actor,
    aggregateKind: "SYNCHRONIZATION",
    aggregateId: previous.id,
    priorState: previous.status,
    nextState: nextStatus,
    occurredAt: clock.now(),
    ...(reason === undefined ? {} : { reason }),
    ...(action.correlationId === undefined
      ? {}
      : { correlationId: action.correlationId }),
  });
}

function applySyncState(
  previous: SynchronizationResult,
  nextStatus: SynchronizationStatus,
  action: ActionRecord,
  clock: Clock,
  reason: ActionReason,
  extra: Partial<SynchronizationResult> = {},
): TransitionDecision<SynchronizationResult> {
  const event = syncEvent(previous, nextStatus, action, clock, reason);
  return changed(
    {
      ...previous,
      ...extra,
      status: nextStatus,
      currentReason: reason,
      version: previous.version + 1,
      updatedAt: clock.now(),
      history: [...previous.history, event],
    },
    event,
  );
}

function syncError<T>(
  result: SynchronizationResult,
  reason: ActionReason,
  code:
    | "INVALID_TRANSITION"
    | "STALE_RESULT"
    | "PUBLICATION_APPROVAL_REQUIRED"
    | "AMBIGUOUS_CONFLICT" = "INVALID_TRANSITION",
): DomainResult<T> {
  return failure(
    createDomainError({
      code,
      category: code === "STALE_RESULT" ? "STALE" : "INVALID_TRANSITION",
      retryable:
        code !== "PUBLICATION_APPROVAL_REQUIRED" &&
        code !== "AMBIGUOUS_CONFLICT",
      userAction: reason.nextAction,
      messageKey: `domain.sync.${code.toLowerCase()}`,
      reason,
      priorState: result.status,
      currentState: result.status,
    }),
  );
}

export function createSynchronizationResult(input: {
  readonly id: SynchronizationOperationId;
  readonly batchId?: SynchronizationBatchId;
  readonly prId: ManagedPrId;
  readonly prBaseBranch: BranchName;
  readonly prHeadBranch: BranchName;
  readonly syncSourceBranchOverride?: BranchName;
  readonly syncSourceBranch: BranchName;
  readonly sourceRepositoryId: RepositoryId;
  readonly destinationRepositoryId: RepositoryId;
  readonly syncSourceSha?: CommitSha;
  readonly prHeadSha?: CommitSha;
  readonly syncMergeBaseSha?: CommitSha;
  readonly sourceChangeEvidence?: SynchronizationChangeEvidence;
  readonly prHeadChangeEvidence?: SynchronizationChangeEvidence;
  readonly conflictEvidence?: readonly SynchronizationConflictEvidence[];
  readonly userConsultation?: SynchronizationUserConsultation;
  readonly operationId: SynchronizationOperationId;
  readonly worktreeId?: WorktreeId;
  readonly clock: Clock;
  readonly eligible?: boolean;
  readonly reason?: ActionReason;
}): SynchronizationResult {
  const createdAt = input.clock.now();
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    kind: "synchronization-result",
    id: input.id,
    ...(input.batchId === undefined ? {} : { batchId: input.batchId }),
    prId: input.prId,
    prBaseBranch: input.prBaseBranch,
    prHeadBranch: input.prHeadBranch,
    ...(input.syncSourceBranchOverride === undefined
      ? {}
      : { syncSourceBranchOverride: input.syncSourceBranchOverride }),
    syncSourceBranch: input.syncSourceBranch,
    sourceRepositoryId: input.sourceRepositoryId,
    destinationRepositoryId: input.destinationRepositoryId,
    ...(input.syncSourceSha === undefined
      ? {}
      : { syncSourceSha: input.syncSourceSha }),
    ...(input.prHeadSha === undefined ? {} : { prHeadSha: input.prHeadSha }),
    ...(input.syncMergeBaseSha === undefined
      ? {}
      : { syncMergeBaseSha: input.syncMergeBaseSha }),
    ...(input.sourceChangeEvidence === undefined
      ? {}
      : { sourceChangeEvidence: input.sourceChangeEvidence }),
    ...(input.prHeadChangeEvidence === undefined
      ? {}
      : { prHeadChangeEvidence: input.prHeadChangeEvidence }),
    conflictEvidence: [...(input.conflictEvidence ?? [])],
    ...(input.userConsultation === undefined
      ? {}
      : { userConsultation: input.userConsultation }),
    operationId: input.operationId,
    ...(input.worktreeId === undefined ? {} : { worktreeId: input.worktreeId }),
    status: "SKIPPED",
    currentReason: input.reason ?? defaultSkippedReason(),
    version: 0,
    createdAt,
    updatedAt: createdAt,
    history: [],
  };
}

export function reduceSynchronization(
  result: SynchronizationResult,
  action: SynchronizationAction,
  clock: Clock,
): DomainResult<TransitionDecision<SynchronizationResult>> {
  if (
    action.action.expectedVersion !== undefined &&
    action.action.expectedVersion !== result.version
  ) {
    return syncError(
      result,
      unsafeReason(
        "CONCURRENT_STATE_CONFLICT",
        "The synchronization result changed before this action was applied.",
        "A retry must use the current persisted result version.",
        "RETRY",
      ),
    );
  }

  if (action.type === "BEGIN_MERGE") {
    if (result.status !== "SKIPPED" || !action.eligible) {
      return action.eligible
        ? syncError(result, invalidReason(result.status, action.type))
        : success(noOp(result, result.currentReason));
    }
    return success(
      applySyncState(
        result,
        "MERGING",
        action.action,
        clock,
        unsafeReason(
          "SYNC_MERGING",
          "The synchronization worktree is being prepared for a deterministic merge.",
          "The merge is isolated from the Review Bundle worktree and the developer workspace.",
          "NONE",
        ),
      ),
    );
  }

  if (
    action.type === "MERGE_CONFLICT" ||
    action.type === "MERGE_CLEAN" ||
    action.type === "VALIDATION_FAILED" ||
    action.type === "RESOLUTION_SUCCEEDED" ||
    action.type === "AMBIGUOUS_CONFLICT" ||
    action.type === "FAIL"
  ) {
    const validSource =
      (action.type === "MERGE_CONFLICT" && result.status === "MERGING") ||
      (action.type === "MERGE_CLEAN" && result.status === "MERGING") ||
      (action.type === "VALIDATION_FAILED" &&
        ["MERGING", "RESOLVING_CONFLICTS"].includes(result.status)) ||
      (action.type === "RESOLUTION_SUCCEEDED" &&
        result.status === "RESOLVING_CONFLICTS") ||
      (action.type === "AMBIGUOUS_CONFLICT" &&
        result.status === "RESOLVING_CONFLICTS") ||
      (action.type === "FAIL" &&
        ["MERGING", "RESOLVING_CONFLICTS", "PUBLISHING"].includes(
          result.status,
        ));
    if (!validSource)
      return syncError(result, invalidReason(result.status, action.type));
    if (
      action.type === "AMBIGUOUS_CONFLICT" &&
      action.consultation === undefined
    ) {
      return syncError(
        result,
        unsafeReason(
          "AMBIGUOUS_CONFLICT",
          "The conflict cannot be resolved deterministically without user input.",
          "The competing intents and the question requiring a user decision must be persisted before stopping for attention.",
          "MANUAL_EDIT",
        ),
        "AMBIGUOUS_CONFLICT",
      );
    }
    const nextStatus: SynchronizationStatus =
      action.type === "MERGE_CONFLICT"
        ? "RESOLVING_CONFLICTS"
        : action.type === "MERGE_CLEAN" ||
            action.type === "RESOLUTION_SUCCEEDED"
          ? "READY_TO_PUBLISH"
          : action.type === "VALIDATION_FAILED"
            ? "NEEDS_ATTENTION"
            : action.type === "AMBIGUOUS_CONFLICT"
              ? "NEEDS_ATTENTION"
              : "FAILED";
    return success(
      applySyncState(
        result,
        nextStatus,
        action.action,
        clock,
        action.reason,
        action.type === "AMBIGUOUS_CONFLICT"
          ? { userConsultation: action.consultation }
          : {},
      ),
    );
  }

  if (action.type === "MARK_STALE") {
    if (
      (!action.sourceMoved && !action.headMoved) ||
      !["READY_TO_PUBLISH", "PUBLISHING"].includes(result.status)
    ) {
      return syncError(
        result,
        invalidReason(result.status, action.type),
        "STALE_RESULT",
      );
    }
    return success(
      applySyncState(result, "STALE", action.action, clock, action.reason),
    );
  }

  if (action.type === "APPROVE_PUBLICATION") {
    if (
      result.status !== "READY_TO_PUBLISH" ||
      action.action.actor !== "HUMAN" ||
      action.approvalId.length === 0
    ) {
      return syncError(
        result,
        unsafeReason(
          "PUBLICATION_APPROVAL_REQUIRED",
          "Publishing this synchronization result requires explicit human approval.",
          "Preparation and review do not grant push or force-push authority.",
          "APPROVE",
        ),
        "PUBLICATION_APPROVAL_REQUIRED",
      );
    }
    return success(
      applySyncState(
        result,
        "PUBLISHING",
        action.action,
        clock,
        unsafeReason(
          "SYNC_PUBLISHING",
          "The approved synchronization result is ready for deterministic publication.",
          "Publication must re-verify both recorded SHAs and cannot force push.",
          "NONE",
          { approvalId: action.approvalId },
        ),
      ),
    );
  }

  if (action.type === "PUBLISHED") {
    if (result.status !== "PUBLISHING")
      return syncError(result, invalidReason(result.status, action.type));
    return success(
      applySyncState(result, "PUBLISHED", action.action, clock, action.reason),
    );
  }

  if (action.type === "RETRY_RESOLUTION") {
    if (
      result.status !== "NEEDS_ATTENTION" ||
      action.action.actor !== "HUMAN"
    ) {
      return syncError(result, invalidReason(result.status, action.type));
    }
    return success(
      applySyncState(
        result,
        "RESOLVING_CONFLICTS",
        action.action,
        clock,
        action.reason ??
          unsafeReason(
            "RETRY_RESOLUTION",
            "Conflict resolution was explicitly retried.",
            "The previous stopped operation remains in history and this retry is a new bounded segment.",
            "NONE",
          ),
      ),
    );
  }

  if (action.type === "RE_EVALUATE") {
    if (
      !["STALE", "FAILED", "NEEDS_ATTENTION"].includes(result.status) ||
      action.action.actor !== "HUMAN"
    ) {
      return syncError(result, invalidReason(result.status, action.type));
    }
    return success(
      applySyncState(
        result,
        "MERGING",
        action.action,
        clock,
        action.reason ??
          unsafeReason(
            "EXPLICIT_REEVALUATION",
            "The synchronization result was explicitly re-evaluated.",
            "Fresh branch and SHA evidence must be recorded before publication can be considered again.",
            "NONE",
          ),
      ),
    );
  }

  if (action.type === "DISCARD") {
    if (
      action.action.actor !== "HUMAN" ||
      action.worktreeHandled !== true ||
      ["PUBLISHED", "DISCARDED"].includes(result.status)
    ) {
      return syncError(result, invalidReason(result.status, action.type));
    }
    return success(
      applySyncState(
        result,
        "DISCARDED",
        action.action,
        clock,
        action.reason ??
          unsafeReason(
            "DISCARDED",
            "The synchronization result was discarded by the user.",
            "The worktree decision was recorded without changing the managed PR review state.",
            "NONE",
          ),
      ),
    );
  }

  return syncError(result, invalidReason(result.status, action.type));
}

export function canPublishSynchronizationResult(
  result: SynchronizationResult,
): boolean {
  return result.status === "READY_TO_PUBLISH";
}

export function parseSynchronizationResult(
  value: unknown,
): DomainResult<SynchronizationResult> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return failure(
      createDomainError({
        code: "INVALID_CONTRACT",
        category: "INVALID_INPUT",
        retryable: false,
        userAction: "FIX_INPUT",
        messageKey: "domain.sync.invalid",
        reason: unsafeReason(
          "INVALID_CONTRACT",
          "The synchronization result is not an object.",
          "Synchronization history cannot be restored safely.",
          "FIX_INPUT",
        ),
      }),
    );
  }
  const data = value as Record<string, unknown>;
  const allowed = new Set([
    "schemaVersion",
    "kind",
    "id",
    "batchId",
    "prId",
    "prBaseBranch",
    "prHeadBranch",
    "syncSourceBranchOverride",
    "syncSourceBranch",
    "sourceRepositoryId",
    "destinationRepositoryId",
    "syncSourceSha",
    "prHeadSha",
    "syncMergeBaseSha",
    "sourceChangeEvidence",
    "prHeadChangeEvidence",
    "conflictEvidence",
    "userConsultation",
    "operationId",
    "worktreeId",
    "status",
    "currentReason",
    "version",
    "createdAt",
    "updatedAt",
    "history",
  ]);
  if (Object.keys(data).some((key) => !allowed.has(key))) {
    return failure(
      createDomainError({
        code: "INVALID_CONTRACT",
        category: "INVALID_INPUT",
        retryable: false,
        userAction: "FIX_INPUT",
        messageKey: "domain.sync.invalid",
        reason: unsafeReason(
          "INVALID_CONTRACT",
          "The synchronization result contains unsupported fields.",
          "Unknown overlay fields cannot compete with primary PR state.",
          "FIX_INPUT",
        ),
      }),
    );
  }
  const schema = parseSchemaVersion(data.schemaVersion);
  const id = parseSynchronizationOperationId(data.id);
  const batchId =
    data.batchId === undefined
      ? undefined
      : parseSynchronizationBatchId(data.batchId);
  const prId = parseManagedPrId(data.prId);
  const prBaseBranch = parseBranchName(data.prBaseBranch);
  const prHeadBranch = parseBranchName(data.prHeadBranch);
  const override =
    data.syncSourceBranchOverride === undefined
      ? undefined
      : parseBranchName(data.syncSourceBranchOverride);
  const source = parseBranchName(data.syncSourceBranch);
  const sourceRepo = parseRepositoryId(data.sourceRepositoryId);
  const destinationRepo = parseRepositoryId(data.destinationRepositoryId);
  const operationId = parseSynchronizationOperationId(data.operationId);
  const syncSha =
    data.syncSourceSha === undefined
      ? undefined
      : parseCommitSha(data.syncSourceSha);
  const headSha =
    data.prHeadSha === undefined ? undefined : parseCommitSha(data.prHeadSha);
  const mergeBaseSha =
    data.syncMergeBaseSha === undefined
      ? undefined
      : parseCommitSha(data.syncMergeBaseSha);
  const worktreeId =
    data.worktreeId === undefined
      ? undefined
      : parseWorktreeId(data.worktreeId);
  const createdAt = parseUtcInstant(data.createdAt);
  const updatedAt = parseUtcInstant(data.updatedAt);
  if (!schema.ok) return schema;
  if (!id.ok) return id;
  if (batchId !== undefined && !batchId.ok) return batchId;
  if (!prId.ok) return prId;
  if (!prBaseBranch.ok) return prBaseBranch;
  if (!prHeadBranch.ok) return prHeadBranch;
  if (override !== undefined && !override.ok) return override;
  if (!source.ok) return source;
  if (!sourceRepo.ok) return sourceRepo;
  if (!destinationRepo.ok) return destinationRepo;
  if (!operationId.ok) return operationId;
  if (syncSha !== undefined && !syncSha.ok) return syncSha;
  if (headSha !== undefined && !headSha.ok) return headSha;
  if (mergeBaseSha !== undefined && !mergeBaseSha.ok) return mergeBaseSha;
  if (worktreeId !== undefined && !worktreeId.ok) return worktreeId;
  if (!createdAt.ok) return createdAt;
  if (!updatedAt.ok) return updatedAt;

  const parseChangeEvidence = (
    value: unknown,
  ): SynchronizationChangeEvidence | undefined => {
    if (value === undefined) return undefined;
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return undefined;
    const evidence = value as Record<string, unknown>;
    if (
      !Array.isArray(evidence.paths) ||
      evidence.paths.some((item) => typeof item !== "string")
    )
      return undefined;
    if (
      Object.keys(evidence).some(
        (key) => !new Set(["paths", "summary", "details"]).has(key),
      )
    )
      return undefined;
    if (evidence.summary !== undefined && typeof evidence.summary !== "string")
      return undefined;
    if (evidence.details !== undefined && !isSafeJsonValue(evidence.details))
      return undefined;
    return {
      paths: [...(evidence.paths as string[])],
      ...(evidence.summary === undefined ? {} : { summary: evidence.summary }),
      ...(evidence.details === undefined ? {} : { details: evidence.details }),
    };
  };
  const sourceChangeEvidence = parseChangeEvidence(data.sourceChangeEvidence);
  const prHeadChangeEvidence = parseChangeEvidence(data.prHeadChangeEvidence);
  if (
    (data.sourceChangeEvidence !== undefined &&
      sourceChangeEvidence === undefined) ||
    (data.prHeadChangeEvidence !== undefined &&
      prHeadChangeEvidence === undefined)
  ) {
    return failure(
      createDomainError({
        code: "INVALID_CONTRACT",
        category: "INVALID_INPUT",
        retryable: false,
        userAction: "FIX_INPUT",
        messageKey: "domain.sync.evidence-invalid",
        reason: unsafeReason(
          "INVALID_CONTRACT",
          "Synchronization change evidence is invalid.",
          "Both branch change sets must be safely inspectable before conflict resolution.",
          "FIX_INPUT",
        ),
      }),
    );
  }
  const conflictEvidence: SynchronizationConflictEvidence[] = [];
  if (data.conflictEvidence !== undefined) {
    if (!Array.isArray(data.conflictEvidence))
      return failure(
        createDomainError({
          code: "INVALID_CONTRACT",
          category: "INVALID_INPUT",
          retryable: false,
          userAction: "FIX_INPUT",
          messageKey: "domain.sync.evidence-invalid",
          reason: unsafeReason(
            "INVALID_CONTRACT",
            "Synchronization conflict evidence is invalid.",
            "Conflict paths and both-side evidence must be safely inspectable.",
            "FIX_INPUT",
          ),
        }),
      );
    for (const raw of data.conflictEvidence) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw))
        return failure(
          createDomainError({
            code: "INVALID_CONTRACT",
            category: "INVALID_INPUT",
            retryable: false,
            userAction: "FIX_INPUT",
            messageKey: "domain.sync.evidence-invalid",
            reason: unsafeReason(
              "INVALID_CONTRACT",
              "Synchronization conflict evidence is invalid.",
              "Conflict paths and both-side evidence must be safely inspectable.",
              "FIX_INPUT",
            ),
          }),
        );
      const conflict = raw as Record<string, unknown>;
      if (
        Object.keys(conflict).some(
          (key) =>
            !new Set([
              "path",
              "source",
              "destination",
              "mergeBase",
              "details",
            ]).has(key),
        )
      )
        return failure(
          createDomainError({
            code: "INVALID_CONTRACT",
            category: "INVALID_INPUT",
            retryable: false,
            userAction: "FIX_INPUT",
            messageKey: "domain.sync.evidence-invalid",
            reason: unsafeReason(
              "INVALID_CONTRACT",
              "Synchronization conflict evidence is invalid.",
              "Conflict paths and both-side evidence must be safely inspectable.",
              "FIX_INPUT",
            ),
          }),
        );
      if (
        typeof conflict.path !== "string" ||
        (conflict.source !== undefined &&
          typeof conflict.source !== "string") ||
        (conflict.destination !== undefined &&
          typeof conflict.destination !== "string") ||
        (conflict.mergeBase !== undefined &&
          typeof conflict.mergeBase !== "string") ||
        (conflict.details !== undefined && !isSafeJsonValue(conflict.details))
      )
        return failure(
          createDomainError({
            code: "INVALID_CONTRACT",
            category: "INVALID_INPUT",
            retryable: false,
            userAction: "FIX_INPUT",
            messageKey: "domain.sync.evidence-invalid",
            reason: unsafeReason(
              "INVALID_CONTRACT",
              "Synchronization conflict evidence is invalid.",
              "Conflict paths and both-side evidence must be safely inspectable.",
              "FIX_INPUT",
            ),
          }),
        );
      conflictEvidence.push({
        path: conflict.path,
        ...(conflict.source === undefined ? {} : { source: conflict.source }),
        ...(conflict.destination === undefined
          ? {}
          : { destination: conflict.destination }),
        ...(conflict.mergeBase === undefined
          ? {}
          : { mergeBase: conflict.mergeBase }),
        ...(conflict.details === undefined
          ? {}
          : { details: conflict.details }),
      });
    }
  }
  let userConsultation: SynchronizationUserConsultation | undefined;
  if (data.userConsultation !== undefined) {
    if (
      typeof data.userConsultation !== "object" ||
      data.userConsultation === null ||
      Array.isArray(data.userConsultation)
    )
      return failure(
        createDomainError({
          code: "INVALID_CONTRACT",
          category: "INVALID_INPUT",
          retryable: false,
          userAction: "FIX_INPUT",
          messageKey: "domain.sync.consultation-invalid",
          reason: unsafeReason(
            "INVALID_CONTRACT",
            "Synchronization user consultation is invalid.",
            "Ambiguous conflicts must preserve the question and competing intents safely.",
            "FIX_INPUT",
          ),
        }),
      );
    const consultation = data.userConsultation as Record<string, unknown>;
    if (
      Object.keys(consultation).some(
        (key) =>
          !new Set(["question", "competingIntents", "requestedAt"]).has(key),
      )
    )
      return failure(
        createDomainError({
          code: "INVALID_CONTRACT",
          category: "INVALID_INPUT",
          retryable: false,
          userAction: "FIX_INPUT",
          messageKey: "domain.sync.consultation-invalid",
          reason: unsafeReason(
            "INVALID_CONTRACT",
            "Synchronization user consultation is invalid.",
            "Ambiguous conflicts must preserve the question and competing intents safely.",
            "FIX_INPUT",
          ),
        }),
      );
    const requestedAt = parseUtcInstant(consultation.requestedAt);
    if (
      typeof consultation.question !== "string" ||
      !Array.isArray(consultation.competingIntents) ||
      consultation.competingIntents.some((item) => typeof item !== "string") ||
      !requestedAt.ok
    )
      return failure(
        createDomainError({
          code: "INVALID_CONTRACT",
          category: "INVALID_INPUT",
          retryable: false,
          userAction: "FIX_INPUT",
          messageKey: "domain.sync.consultation-invalid",
          reason: unsafeReason(
            "INVALID_CONTRACT",
            "Synchronization user consultation is invalid.",
            "Ambiguous conflicts must preserve the question and competing intents safely.",
            "FIX_INPUT",
          ),
        }),
      );
    userConsultation = {
      question: consultation.question,
      competingIntents: [...(consultation.competingIntents as string[])],
      requestedAt: requestedAt.value,
    };
  }
  if (
    data.kind !== "synchronization-result" ||
    !SYNCHRONIZATION_STATUSES.includes(data.status as SynchronizationStatus) ||
    !Number.isInteger(data.version) ||
    (data.version as number) < 0 ||
    typeof data.currentReason !== "object" ||
    data.currentReason === null ||
    !Array.isArray(data.history)
  ) {
    return failure(
      createDomainError({
        code: "INVALID_CONTRACT",
        category: "INVALID_INPUT",
        retryable: false,
        userAction: "FIX_INPUT",
        messageKey: "domain.sync.invalid",
        reason: unsafeReason(
          "INVALID_CONTRACT",
          "The synchronization result contains invalid status or reason data.",
          "Unknown overlay statuses fail closed instead of changing primary PR state.",
          "FIX_INPUT",
        ),
      }),
    );
  }
  const currentReason = parseDomainReason(data.currentReason);
  if (!currentReason.ok) return currentReason;
  const history: TransitionEvent[] = [];
  for (const event of data.history) {
    const parsed = parseTransitionEvent(event);
    if (!parsed.ok) return parsed;
    if (
      parsed.value.aggregateKind !== "SYNCHRONIZATION" ||
      parsed.value.aggregateId !== id.value
    ) {
      return failure(
        createDomainError({
          code: "INVALID_CONTRACT",
          category: "INVALID_INPUT",
          retryable: false,
          userAction: "FIX_INPUT",
          messageKey: "domain.sync.history-invalid",
          reason: unsafeReason(
            "INVALID_CONTRACT",
            "The synchronization history contains another aggregate.",
            "Each result must be independently recoverable without cross-result mutations.",
            "FIX_INPUT",
          ),
        }),
      );
    }
    history.push(parsed.value);
  }
  return success({
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    kind: "synchronization-result",
    id: id.value,
    ...(batchId === undefined ? {} : { batchId: batchId.value }),
    prId: prId.value,
    prBaseBranch: prBaseBranch.value,
    prHeadBranch: prHeadBranch.value,
    ...(override === undefined
      ? {}
      : { syncSourceBranchOverride: override.value }),
    syncSourceBranch: source.value,
    sourceRepositoryId: sourceRepo.value,
    destinationRepositoryId: destinationRepo.value,
    ...(syncSha === undefined ? {} : { syncSourceSha: syncSha.value }),
    ...(headSha === undefined ? {} : { prHeadSha: headSha.value }),
    ...(mergeBaseSha === undefined
      ? {}
      : { syncMergeBaseSha: mergeBaseSha.value }),
    ...(sourceChangeEvidence === undefined ? {} : { sourceChangeEvidence }),
    ...(prHeadChangeEvidence === undefined ? {} : { prHeadChangeEvidence }),
    conflictEvidence,
    ...(userConsultation === undefined ? {} : { userConsultation }),
    operationId: operationId.value,
    ...(worktreeId === undefined ? {} : { worktreeId: worktreeId.value }),
    status: data.status as SynchronizationStatus,
    currentReason: currentReason.value,
    version: data.version as number,
    createdAt: createdAt.value,
    updatedAt: updatedAt.value,
    history,
  });
}
