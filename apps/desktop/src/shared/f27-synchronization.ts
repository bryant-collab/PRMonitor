import type {
  F13ClearChoice,
  F13InspectionResult,
  F13WorktreeCondition,
} from "./f13-contracts-impl";
import type {
  F25Reason,
  F25SynchronizationBatchReadModel,
  F25SynchronizationResultReadModel,
} from "./f25-synchronization";

/**
 * F27 is deliberately an overlay over F25.  F25 remains the owner of the
 * synchronization operation and its immutable Git/validation evidence; F27
 * owns only the human review, freshness, approval, and publication projection.
 */
export const F27_SCHEMA_VERSION = 1 as const;
export const F27_MAX_ROWS = 250;
export const F27_MAX_ACTIONS = 64;

export type F27ResultStatus =
  | "SKIPPED"
  | "PREPARING"
  | "READY_TO_PUBLISH"
  | "NEEDS_ATTENTION"
  | "STALE"
  | "FAILED"
  | "UNKNOWN"
  | "DISCARDED"
  | "PUBLISHING"
  | "PUBLISHED";

export type F27NextAction =
  | "NONE"
  | "REVIEW"
  | "REFRESH_EVIDENCE"
  | "RE_EVALUATE"
  | "DISCARD"
  | "PUBLISH"
  | "RECONCILE"
  | "RETRY"
  | "ANSWER_USER"
  | "MANUAL_RESOLUTION";

export interface F27Reason {
  readonly code: string;
  readonly what: string;
  readonly why: string;
  readonly nextAction: F27NextAction;
  readonly correlationId: string;
}

export type F27FreshnessOutcome =
  | "CURRENT"
  | "MOVED"
  | "UNAVAILABLE"
  | "CLOSED"
  | "MERGED"
  | "IDENTITY_MISMATCH";

export interface F27FreshnessEvidence {
  readonly outcome: F27FreshnessOutcome;
  readonly checkedAt: string;
  readonly sourceRepositoryKey: string;
  readonly destinationRepositoryKey: string;
  readonly sourceBranch: string;
  readonly destinationBranch: string;
  readonly expectedSourceSha: string;
  readonly expectedHeadSha: string;
  readonly observedSourceSha?: string;
  readonly observedHeadSha?: string;
  readonly observedPrState?: "OPEN" | "CLOSED";
  readonly observedMerged?: boolean;
  readonly reason?: F27Reason;
}

export interface F27WorktreeReference {
  readonly worktreeId: string;
  readonly operationId: string;
  readonly ownerId: string;
  readonly baselineSha: string;
  readonly currentHeadSha?: string;
  readonly rootRevision: number;
  readonly condition?: F13WorktreeCondition;
  readonly available: boolean;
}

export interface F27PublicationSummary {
  readonly publicationId: string;
  readonly approvalId: string;
  readonly idempotencyKey: string;
  readonly phase: string;
  readonly recoveryState: string;
  readonly codePublished: boolean;
  readonly commitSha?: string;
  readonly outcome?: "NO_CODE_CHANGE" | "MERGE_COMMIT";
  readonly updatedAt: string;
  readonly nextAction: F27NextAction;
}

export interface F27Capabilities {
  readonly inspect: boolean;
  readonly refreshFreshness: boolean;
  readonly clearAll: boolean;
  readonly clearOnlyAi: boolean;
  readonly keepAndCancel: boolean;
  readonly reEvaluate: boolean;
  readonly discard: boolean;
  readonly approvePublication: boolean;
  readonly publish: boolean;
  readonly reconcile: boolean;
}

export interface F27ResultReview {
  readonly schemaVersion: typeof F27_SCHEMA_VERSION;
  readonly kind: "f27-synchronization-result";
  readonly operationId: string;
  readonly batchId: string;
  readonly managedPrId: string;
  readonly status: F27ResultStatus;
  readonly sourceStatus: F25SynchronizationResultReadModel["status"];
  readonly stage: F25SynchronizationResultReadModel["stage"];
  readonly mergeOutcome: F25SynchronizationResultReadModel["mergeOutcome"];
  readonly input: F25SynchronizationResultReadModel["input"];
  readonly worktree?: F27WorktreeReference;
  readonly mergeBaseSha?: string;
  readonly sourceChangeEvidence?: F25SynchronizationResultReadModel["sourceChangeEvidence"];
  readonly prHeadChangeEvidence?: F25SynchronizationResultReadModel["prHeadChangeEvidence"];
  readonly conflicts: F25SynchronizationResultReadModel["conflicts"];
  readonly validation?: F25SynchronizationResultReadModel["validation"];
  readonly aiUsage: F25SynchronizationResultReadModel["aiUsage"];
  readonly aiOperationId?: string;
  readonly conflictResolution?: F25SynchronizationResultReadModel["conflictResolution"];
  readonly freshness?: F27FreshnessEvidence;
  readonly reason: F27Reason;
  readonly nextAction: F27NextAction;
  readonly capabilities: F27Capabilities;
  readonly publication?: F27PublicationSummary;
  /** Stable hash of the immutable F25 result and its exact input SHAs. */
  readonly candidateHash: string;
  readonly revision: number;
  readonly sourceVersion: number;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface F27BatchRow {
  readonly operationId: string;
  readonly managedPrId: string;
  readonly status: F27ResultStatus;
  readonly mergeOutcome: F25SynchronizationResultReadModel["mergeOutcome"];
  readonly reason: F27Reason;
  readonly nextAction: F27NextAction;
  readonly revision: number;
}

export interface F27BatchCounts {
  readonly total: number;
  readonly selected: number;
  readonly skipped: number;
  readonly pending: number;
  readonly ready: number;
  readonly attention: number;
  readonly stale: number;
  readonly failed: number;
  readonly publishing: number;
  readonly published: number;
  readonly discarded: number;
}

export interface F27BatchReview {
  readonly schemaVersion: typeof F27_SCHEMA_VERSION;
  readonly kind: "f27-synchronization-batch";
  readonly batchId: string;
  readonly sourceStatus: F25SynchronizationBatchReadModel["status"];
  readonly rows: readonly F27BatchRow[];
  readonly counts: F27BatchCounts;
  readonly readOnly: true;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface F27StateRecord {
  readonly schemaVersion: typeof F27_SCHEMA_VERSION;
  readonly kind: "f27-synchronization-state";
  readonly operationId: string;
  readonly batchId: string;
  readonly managedPrId: string;
  readonly sourceStatus?: F25SynchronizationResultReadModel["status"];
  readonly status: F27ResultStatus;
  readonly revision: number;
  readonly version: number;
  readonly reason: F27Reason;
  readonly nextAction: F27NextAction;
  readonly freshness?: F27FreshnessEvidence;
  readonly worktreeCondition?: F13WorktreeCondition;
  readonly publication?: F27PublicationSummary;
  readonly lastAction?: {
    readonly actionId: string;
    readonly kind: string;
    readonly choice?: F13ClearChoice;
    readonly status:
      "PENDING" | "COMPLETED" | "CANCELLED" | "FAILED" | "UNKNOWN";
    readonly createdAt: string;
  };
  readonly reevaluatedByBatchId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface F27HeadAdvanceInvalidation {
  readonly schemaVersion: typeof F27_SCHEMA_VERSION;
  readonly kind: "f27-head-advance-invalidation";
  readonly invalidationId: string;
  readonly operationId: string;
  readonly managedPrId: string;
  readonly oldHeadSha: string;
  readonly newHeadSha: string;
  readonly publicationId: string;
  readonly createdAt: string;
}

export interface F27WorktreeActionInput {
  readonly operationId: string;
  readonly actionId: string;
  readonly choice: F13ClearChoice;
  readonly expectedRevision: number;
  readonly confirmed?: boolean;
  readonly beforeSnapshotId?: string;
  readonly afterSnapshotId?: string;
}

export interface F27FreshnessInput {
  readonly operationId: string;
  readonly expectedRevision: number;
}

export interface F27ApprovalInput {
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly approvalId: string;
  readonly idempotencyKey: string;
  readonly candidateHash: string;
  readonly commitMessage: string;
  readonly completeDiffAcknowledged: true;
  readonly noCodeChangeAcknowledged: boolean;
}

export interface F27PublicationInput {
  readonly operationId: string;
  readonly idempotencyKey: string;
}

export interface F27ReevaluationInput {
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly actionId: string;
  readonly choice: F13ClearChoice;
  readonly confirmed?: boolean;
}

export interface F27ActionResult {
  readonly outcome:
    "COMPLETED" | "CANCELLED" | "REJECTED" | "ATTENTION" | "UNCERTAIN";
  readonly review: F27ResultReview;
  readonly reason?: F27Reason;
}

export interface F27FreshnessRead {
  readonly outcome: F27FreshnessOutcome;
  readonly checkedAt: string;
  readonly sourceSha?: string;
  readonly headSha?: string;
  readonly state?: "OPEN" | "CLOSED";
  readonly merged?: boolean;
  readonly sourceRepositoryKey?: string;
  readonly destinationRepositoryKey?: string;
  readonly sourceBranch?: string;
  readonly destinationBranch?: string;
  readonly reason?: F27Reason;
}

export interface F27MergeCandidate {
  readonly operationId: string;
  readonly managedPrId: string;
  readonly worktreeId: string;
  readonly worktreePath: string;
  readonly expectedWorktreeFingerprint?: string;
  readonly sourceRepositoryKey: string;
  readonly destinationRepositoryKey: string;
  readonly destinationBranch: string;
  readonly expectedHeadSha: string;
  readonly sourceSha: string;
  readonly mergeBaseSha: string;
  readonly expectedParentShas: readonly [string, string];
  readonly changedFiles: readonly string[];
  readonly proposedPatchHash?: string;
  readonly proposedDiffComplete: boolean;
  readonly candidateHash: string;
  readonly commitMessage: string;
}

export interface F27GitPublisher {
  readonly commitMerge: (input: {
    readonly candidate: F27MergeCandidate;
    readonly attemptId: string;
  }) => Promise<
    | { readonly outcome: "COMMITTED"; readonly commitSha: string }
    | { readonly outcome: "NO_CODE_CHANGE" }
    | { readonly outcome: "UNCERTAIN"; readonly reason: string }
    | { readonly outcome: "FAILED"; readonly reason: string }
  >;
  readonly pushMerge: (input: {
    readonly candidate: F27MergeCandidate;
    readonly commitSha: string;
    readonly attemptId: string;
  }) => Promise<
    | { readonly outcome: "PUSHED" }
    | { readonly outcome: "UNCERTAIN"; readonly reason: string }
    | { readonly outcome: "FAILED"; readonly reason: string }
  >;
  readonly reconcileCommit: (input: {
    readonly candidate: F27MergeCandidate;
    readonly attemptId: string;
  }) => Promise<
    | { readonly outcome: "PRESENT"; readonly commitSha: string }
    | { readonly outcome: "ABSENT" }
    | { readonly outcome: "UNKNOWN"; readonly reason: string }
  >;
  readonly reconcilePush: (input: {
    readonly candidate: F27MergeCandidate;
    readonly commitSha: string;
    readonly attemptId: string;
  }) => Promise<
    | { readonly outcome: "PRESENT" }
    | { readonly outcome: "ABSENT" }
    | { readonly outcome: "UNKNOWN"; readonly reason: string }
  >;
}

export function f27Reason(input: F27Reason): F27Reason {
  return input;
}

export function f27StatusFromF25(
  result: F25SynchronizationResultReadModel,
): F27ResultStatus {
  return f27StatusFromF25Status(result.status);
}

export function f27StatusFromF25Status(
  status: F25SynchronizationResultReadModel["status"],
): F27ResultStatus {
  switch (status) {
    case "SKIPPED":
      return "SKIPPED";
    case "READY_TO_PUBLISH":
      return "READY_TO_PUBLISH";
    case "NEEDS_ATTENTION":
      return "NEEDS_ATTENTION";
    case "FAILED":
      return "FAILED";
    default:
      return "PREPARING";
  }
}

function mapNextAction(action: F25Reason["nextAction"]): F27NextAction {
  switch (action) {
    case "REVIEW":
      return "REVIEW";
    case "RECONCILE":
      return "RECONCILE";
    case "RETRY":
      return "RETRY";
    case "MANUAL_RESOLUTION":
      return "MANUAL_RESOLUTION";
    case "CONFIGURE_VALIDATION":
    case "REVIEW_VALIDATION":
      return "REFRESH_EVIDENCE";
    default:
      return "NONE";
  }
}

export function f27ReasonFromF25(
  reason: F25Reason,
  correlationId = reason.correlationId,
): F27Reason {
  return {
    code: reason.code,
    what: reason.what,
    why: reason.why,
    nextAction: mapNextAction(reason.nextAction),
    correlationId,
  };
}

export function f27ReasonFor(
  code: string,
  what: string,
  why: string,
  nextAction: F27NextAction,
  correlationId: string,
): F27Reason {
  return { code, what, why, nextAction, correlationId };
}

export function f27CapabilitiesFor(
  status: F27ResultStatus,
  mergeOutcome: F25SynchronizationResultReadModel["mergeOutcome"],
  condition?: F13WorktreeCondition,
): F27Capabilities {
  const reviewable = status !== "SKIPPED" && status !== "DISCARDED";
  const ready = status === "READY_TO_PUBLISH";
  const canClearAll =
    reviewable &&
    status !== "PUBLISHED" &&
    (condition === undefined ||
      condition.permittedNextActions.includes("CLEAR_ALL_CHANGES"));
  const canClearOnlyAi =
    reviewable &&
    status !== "PUBLISHED" &&
    (condition === undefined ||
      condition.permittedNextActions.includes("CLEAR_ONLY_AI_CHANGES"));
  return {
    inspect: reviewable,
    refreshFreshness: reviewable && status !== "PUBLISHED",
    clearAll: canClearAll,
    clearOnlyAi: canClearOnlyAi,
    keepAndCancel: reviewable && status !== "PUBLISHED",
    reEvaluate: reviewable && status !== "PUBLISHED" && status !== "PUBLISHING",
    discard: reviewable && status !== "PUBLISHED" && status !== "PUBLISHING",
    approvePublication:
      ready && (mergeOutcome === "CLEAN_MERGE" || mergeOutcome === "NO_OP"),
    publish: status === "PUBLISHING",
    reconcile:
      status === "UNKNOWN" ||
      status === "NEEDS_ATTENTION" ||
      status === "PUBLISHING",
  };
}

export function f27Counts(rows: readonly F27BatchRow[]): F27BatchCounts {
  return {
    total: rows.length,
    selected: rows.filter((row) => row.status !== "SKIPPED").length,
    skipped: rows.filter((row) => row.status === "SKIPPED").length,
    pending: rows.filter((row) => row.status === "PREPARING").length,
    ready: rows.filter((row) => row.status === "READY_TO_PUBLISH").length,
    attention: rows.filter((row) => row.status === "NEEDS_ATTENTION").length,
    stale: rows.filter((row) => row.status === "STALE").length,
    failed: rows.filter((row) => row.status === "FAILED").length,
    publishing: rows.filter((row) => row.status === "PUBLISHING").length,
    published: rows.filter((row) => row.status === "PUBLISHED").length,
    discarded: rows.filter((row) => row.status === "DISCARDED").length,
  };
}

export function isF27ResultReview(value: unknown): value is F27ResultReview {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === F27_SCHEMA_VERSION &&
    record.kind === "f27-synchronization-result" &&
    typeof record.operationId === "string" &&
    typeof record.batchId === "string" &&
    typeof record.managedPrId === "string" &&
    typeof record.status === "string" &&
    typeof record.reason === "object" &&
    record.reason !== null &&
    typeof record.nextAction === "string" &&
    typeof record.revision === "number" &&
    typeof record.sourceVersion === "number" &&
    typeof record.version === "number"
  );
}

export function isF27BatchReview(value: unknown): value is F27BatchReview {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === F27_SCHEMA_VERSION &&
    record.kind === "f27-synchronization-batch" &&
    typeof record.batchId === "string" &&
    Array.isArray(record.rows) &&
    typeof record.counts === "object" &&
    record.counts !== null &&
    record.readOnly === true &&
    typeof record.version === "number"
  );
}

export function isF27StateRecord(value: unknown): value is F27StateRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === F27_SCHEMA_VERSION &&
    record.kind === "f27-synchronization-state" &&
    typeof record.operationId === "string" &&
    typeof record.batchId === "string" &&
    typeof record.managedPrId === "string" &&
    typeof record.status === "string" &&
    typeof record.revision === "number" &&
    typeof record.version === "number" &&
    typeof record.reason === "object" &&
    record.reason !== null
  );
}

export function f27WorktreeReference(
  inspection: F13InspectionResult,
): F27WorktreeReference {
  return {
    worktreeId: inspection.worktree.worktreeId,
    operationId: inspection.worktree.operationId,
    ownerId: inspection.worktree.ownerId,
    baselineSha: inspection.worktree.worktreeBaselineSha,
    ...(inspection.worktree.currentHeadSha === undefined
      ? {}
      : { currentHeadSha: inspection.worktree.currentHeadSha }),
    rootRevision: inspection.worktree.rootRevision,
    condition: inspection.condition,
    available: inspection.worktree.available,
  };
}
