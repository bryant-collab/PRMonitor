import {
  f24Fingerprint,
  f24SafeIdentifier,
  f24SafeSha,
  isF24ResolutionRow,
  isF24PreparationAuthorization,
  type F24PreparationAuthorization,
  type F24ResolutionRow,
} from "./f24-synchronization";

export const F25_SCHEMA_VERSION = 1 as const;
export const F25_MAX_OPERATIONS = 250;
export const F25_MAX_EVIDENCE_FILES = 2_000;
export const F25_MAX_CONFLICTS = 2_000;
export const F25_MAX_REASON_BYTES = 512;

export type F25SynchronizationStatus =
  | "SKIPPED"
  | "PREPARING"
  | "MERGING"
  | "INSPECTING"
  | "VALIDATING"
  | "READY_TO_PUBLISH"
  | "NEEDS_ATTENTION"
  | "FAILED";

export type F25OperationStage =
  | "ADMITTED"
  | "PREPARING"
  | "MERGING"
  | "INSPECTING"
  | "VALIDATING"
  | "CONFLICT_HANDOFF"
  | "COMPLETED"
  | "ATTENTION"
  | "FAILED"
  | "SKIPPED";

export type F25MergeOutcome =
  | "NOT_STARTED"
  | "NO_OP"
  | "CLEAN_MERGE"
  | "CONFLICT_DETECTED"
  | "PREPARATION_FAILED"
  | "VALIDATION_FAILED"
  | "CANCELLED"
  | "INTERRUPTED"
  | "UNCERTAIN";

export type F25BatchStatus =
  | "ADMITTED"
  | "RUNNING"
  | "COMPLETED"
  | "NEEDS_ATTENTION"
  | "FAILED"
  | "UNCERTAIN"
  | "CANCELLED";

export interface F25Reason {
  readonly code: string;
  readonly what: string;
  readonly why: string;
  readonly nextAction:
    | "NONE"
    | "REVIEW"
    | "RECONCILE"
    | "RETRY"
    | "MANUAL_RESOLUTION"
    | "CONFIGURE_VALIDATION"
    | "REVIEW_VALIDATION";
  readonly correlationId: string;
}

export interface F25InputSnapshot {
  readonly schemaVersion: 1;
  readonly authorizationId: string;
  readonly intentId: string;
  readonly idempotencyKey: string;
  readonly resolutionRevision: string;
  readonly operationId: string;
  readonly row: F24ResolutionRow;
  readonly capturedAt: string;
}

export interface F25ChangeEvidence {
  readonly schemaVersion: 1;
  readonly side: "SOURCE" | "DESTINATION";
  readonly baseSha: string;
  readonly tipSha: string;
  readonly files: readonly {
    readonly path: string;
    readonly kind: string;
    readonly oldPath?: string;
    readonly statusCode?: string;
  }[];
  readonly evidenceHash: string;
  readonly complete: boolean;
}

export interface F25ConflictEvidence {
  readonly path: string;
  readonly statusCode?: string;
  readonly source?: string;
  readonly destination?: string;
  readonly mergeBase?: string;
  readonly details?: string;
  readonly contentBase64?: string;
  readonly contentComplete?: boolean;
}

export interface F25WorktreeEvidence {
  readonly operationId: string;
  readonly worktreeId: string;
  readonly ownerId: string;
  readonly canonicalPath: string;
  readonly rootRevision: number;
  readonly baselineSha: string;
  readonly currentHeadSha?: string;
  readonly condition?: string;
  readonly stateFingerprint?: string;
}

export interface F25ValidationEvidence {
  readonly runId: string;
  readonly status: "passed" | "failed" | "not_run" | "interrupted" | "running";
  readonly reason?: string;
  readonly warnings: readonly {
    readonly code: string;
    readonly status?: string;
    readonly reason?: string;
  }[];
  readonly nextAction: string;
  readonly version: number;
}

export interface F25AiUsageSummary {
  readonly providerInvoked: false;
  readonly turns: 0;
  readonly tokens: 0;
}

export interface F25Capabilities {
  readonly canCommit: false;
  readonly canPush: false;
  readonly canPublish: false;
  readonly canInvokeAi: false;
}

export interface F25ConflictHandoff {
  readonly kind: "F26_CONFLICT_HANDOFF";
  readonly operationId: string;
  readonly batchId: string;
  readonly managedPrId: string;
  readonly input: F25InputSnapshot;
  readonly worktree: F25WorktreeEvidence;
  readonly mergeBaseSha: string;
  readonly sourceChangeEvidence: F25ChangeEvidence;
  readonly prHeadChangeEvidence: F25ChangeEvidence;
  readonly conflicts: readonly F25ConflictEvidence[];
  readonly capabilities: {
    readonly canResolveConflict: true;
    readonly canCommit: false;
    readonly canPush: false;
    readonly canPublish: false;
  };
  readonly nextAction: "MANUAL_RESOLUTION";
}

export interface F25SynchronizationResultReadModel {
  readonly schemaVersion: 1;
  readonly kind: "synchronization-result";
  readonly operationId: string;
  readonly batchId: string;
  readonly managedPrId: string;
  readonly status: F25SynchronizationStatus;
  readonly stage: F25OperationStage;
  readonly mergeOutcome: F25MergeOutcome;
  readonly input: F25InputSnapshot;
  readonly worktree?: F25WorktreeEvidence;
  readonly mergeBaseSha?: string;
  readonly sourceChangeEvidence?: F25ChangeEvidence;
  readonly prHeadChangeEvidence?: F25ChangeEvidence;
  readonly conflicts: readonly F25ConflictEvidence[];
  readonly validation?: F25ValidationEvidence;
  readonly aiUsage: F25AiUsageSummary;
  readonly reason: F25Reason;
  readonly nextAction: F25Reason["nextAction"];
  readonly capabilities: F25Capabilities;
  readonly handoff?: F25ConflictHandoff;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface F25SynchronizationBatchReadModel {
  readonly schemaVersion: 1;
  readonly kind: "synchronization-batch";
  readonly batchId: string;
  readonly authorizationId: string;
  readonly intentId: string;
  readonly idempotencyKey: string;
  readonly resolutionRevision: string;
  readonly status: F25BatchStatus;
  readonly authorization: F24PreparationAuthorization;
  readonly operationIds: readonly string[];
  readonly counts: {
    readonly total: number;
    readonly eligible: number;
    readonly skipped: number;
    readonly ready: number;
    readonly attention: number;
    readonly failed: number;
    readonly pending: number;
  };
  readonly results: readonly F25SynchronizationResultReadModel[];
  readonly reason?: F25Reason;
  readonly capabilities: F25Capabilities;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function f25Reason(input: {
  readonly code: string;
  readonly what: string;
  readonly why: string;
  readonly nextAction: F25Reason["nextAction"];
  readonly correlationId: string;
}): F25Reason {
  const bounded = (value: string): string =>
    value.slice(0, F25_MAX_REASON_BYTES);
  if (!f24SafeIdentifier(input.correlationId))
    throw new TypeError("F25_CORRELATION_INVALID");
  return {
    code: bounded(input.code),
    what: bounded(input.what),
    why: bounded(input.why),
    nextAction: input.nextAction,
    correlationId: input.correlationId,
  };
}

export function f25Fingerprint(value: unknown): string {
  return `f25-${f24Fingerprint(value).slice(4)}`;
}

export function f25ZeroAiUsage(): F25AiUsageSummary {
  return { providerInvoked: false, turns: 0, tokens: 0 };
}

export function f25Capabilities(): F25Capabilities {
  return {
    canCommit: false,
    canPush: false,
    canPublish: false,
    canInvokeAi: false,
  };
}

export function isF25Terminal(
  value: F25SynchronizationResultReadModel,
): boolean {
  return (
    value.status === "READY_TO_PUBLISH" ||
    value.status === "NEEDS_ATTENTION" ||
    value.status === "FAILED" ||
    value.status === "SKIPPED"
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeText(value: unknown, maximum = 4_096): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    new TextEncoder().encode(value).byteLength <= maximum &&
    ![...value].some((character) => (character.codePointAt(0) ?? 0) < 32)
  );
}

function isReason(value: unknown): value is F25Reason {
  if (!record(value)) return false;
  return (
    safeText(value.code, 128) &&
    safeText(value.what, F25_MAX_REASON_BYTES) &&
    safeText(value.why, F25_MAX_REASON_BYTES) &&
    typeof value.nextAction === "string" &&
    f24SafeIdentifier(value.correlationId)
  );
}

function isInput(value: unknown): value is F25InputSnapshot {
  if (!record(value) || !record(value.row)) return false;
  return (
    value.schemaVersion === 1 &&
    f24SafeIdentifier(value.authorizationId) &&
    f24SafeIdentifier(value.intentId) &&
    f24SafeIdentifier(value.idempotencyKey) &&
    f24SafeIdentifier(value.resolutionRevision) &&
    f24SafeIdentifier(value.operationId) &&
    safeText(value.capturedAt, 64) &&
    isF24ResolutionRow(value.row)
  );
}

function isAiUsage(value: unknown): value is F25AiUsageSummary {
  return (
    record(value) &&
    value.providerInvoked === false &&
    value.turns === 0 &&
    value.tokens === 0
  );
}

function isChangeEvidence(value: unknown): value is F25ChangeEvidence {
  if (!record(value) || !Array.isArray(value.files)) return false;
  return (
    value.schemaVersion === 1 &&
    (value.side === "SOURCE" || value.side === "DESTINATION") &&
    f24SafeSha(value.baseSha) &&
    f24SafeSha(value.tipSha) &&
    value.files.length <= F25_MAX_EVIDENCE_FILES &&
    value.files.every(
      (file) =>
        record(file) &&
        safeText(file.path) &&
        typeof file.kind === "string" &&
        (file.oldPath === undefined || safeText(file.oldPath)) &&
        (file.statusCode === undefined || safeText(file.statusCode, 16)),
    ) &&
    safeText(value.evidenceHash, 128) &&
    typeof value.complete === "boolean"
  );
}

function isWorktree(value: unknown): value is F25WorktreeEvidence {
  return (
    record(value) &&
    f24SafeIdentifier(value.operationId) &&
    f24SafeIdentifier(value.worktreeId) &&
    f24SafeIdentifier(value.ownerId) &&
    safeText(value.canonicalPath) &&
    typeof value.rootRevision === "number" &&
    Number.isSafeInteger(value.rootRevision) &&
    f24SafeSha(value.baselineSha) &&
    (value.currentHeadSha === undefined || f24SafeSha(value.currentHeadSha)) &&
    (value.condition === undefined || safeText(value.condition, 64))
  );
}

function isValidation(value: unknown): value is F25ValidationEvidence {
  if (!record(value) || !Array.isArray(value.warnings)) return false;
  return (
    f24SafeIdentifier(value.runId) &&
    ["passed", "failed", "not_run", "interrupted", "running"].includes(
      String(value.status),
    ) &&
    (value.reason === undefined || safeText(value.reason, 256)) &&
    value.warnings.length <= 64 &&
    value.warnings.every(
      (warning) =>
        record(warning) &&
        safeText(warning.code, 128) &&
        (warning.status === undefined || safeText(warning.status, 64)) &&
        (warning.reason === undefined || safeText(warning.reason, 256)),
    ) &&
    safeText(value.nextAction, 256) &&
    typeof value.version === "number" &&
    Number.isSafeInteger(value.version) &&
    value.version >= 1
  );
}

function isConflict(value: unknown): value is F25ConflictEvidence {
  return (
    record(value) &&
    safeText(value.path) &&
    (value.statusCode === undefined || safeText(value.statusCode, 16)) &&
    (value.source === undefined || safeText(value.source, 256)) &&
    (value.destination === undefined || safeText(value.destination, 256)) &&
    (value.mergeBase === undefined || safeText(value.mergeBase, 256)) &&
    (value.details === undefined || safeText(value.details, 512)) &&
    (value.contentBase64 === undefined ||
      safeText(value.contentBase64, 512 * 1024)) &&
    (value.contentComplete === undefined ||
      typeof value.contentComplete === "boolean")
  );
}

function isHandoff(value: unknown): value is F25ConflictHandoff {
  if (!record(value) || !Array.isArray(value.conflicts)) return false;
  return (
    value.kind === "F26_CONFLICT_HANDOFF" &&
    f24SafeIdentifier(value.operationId) &&
    f24SafeIdentifier(value.batchId) &&
    f24SafeIdentifier(value.managedPrId) &&
    isInput(value.input) &&
    isWorktree(value.worktree) &&
    f24SafeSha(value.mergeBaseSha) &&
    isChangeEvidence(value.sourceChangeEvidence) &&
    isChangeEvidence(value.prHeadChangeEvidence) &&
    value.conflicts.length <= F25_MAX_CONFLICTS &&
    value.conflicts.every(isConflict) &&
    record(value.capabilities) &&
    value.capabilities.canResolveConflict === true &&
    value.capabilities.canCommit === false &&
    value.capabilities.canPush === false &&
    value.capabilities.canPublish === false &&
    value.nextAction === "MANUAL_RESOLUTION"
  );
}

export function isF25SynchronizationResultReadModel(
  value: unknown,
): value is F25SynchronizationResultReadModel {
  if (!record(value) || !Array.isArray(value.conflicts)) return false;
  return (
    value.schemaVersion === 1 &&
    value.kind === "synchronization-result" &&
    f24SafeIdentifier(value.operationId) &&
    f24SafeIdentifier(value.batchId) &&
    f24SafeIdentifier(value.managedPrId) &&
    typeof value.status === "string" &&
    typeof value.stage === "string" &&
    typeof value.mergeOutcome === "string" &&
    isInput(value.input) &&
    (value.worktree === undefined || isWorktree(value.worktree)) &&
    (value.mergeBaseSha === undefined || f24SafeSha(value.mergeBaseSha)) &&
    (value.sourceChangeEvidence === undefined ||
      isChangeEvidence(value.sourceChangeEvidence)) &&
    (value.prHeadChangeEvidence === undefined ||
      isChangeEvidence(value.prHeadChangeEvidence)) &&
    value.conflicts.length <= F25_MAX_CONFLICTS &&
    value.conflicts.every(
      (conflict) =>
        record(conflict) &&
        safeText(conflict.path) &&
        (conflict.statusCode === undefined ||
          safeText(conflict.statusCode, 16)),
    ) &&
    (value.validation === undefined || isValidation(value.validation)) &&
    isAiUsage(value.aiUsage) &&
    isReason(value.reason) &&
    typeof value.nextAction === "string" &&
    record(value.capabilities) &&
    value.capabilities.canCommit === false &&
    value.capabilities.canPush === false &&
    value.capabilities.canPublish === false &&
    value.capabilities.canInvokeAi === false &&
    (value.handoff === undefined || isHandoff(value.handoff)) &&
    typeof value.version === "number" &&
    Number.isSafeInteger(value.version) &&
    safeText(value.createdAt, 64) &&
    safeText(value.updatedAt, 64)
  );
}

export function isF25SynchronizationBatchReadModel(
  value: unknown,
): value is F25SynchronizationBatchReadModel {
  if (!record(value) || !Array.isArray(value.results)) return false;
  return (
    value.schemaVersion === 1 &&
    value.kind === "synchronization-batch" &&
    f24SafeIdentifier(value.batchId) &&
    f24SafeIdentifier(value.authorizationId) &&
    f24SafeIdentifier(value.intentId) &&
    f24SafeIdentifier(value.idempotencyKey) &&
    f24SafeIdentifier(value.resolutionRevision) &&
    isF24PreparationAuthorization(value.authorization) &&
    Array.isArray(value.operationIds) &&
    value.operationIds.length <= F25_MAX_OPERATIONS &&
    value.operationIds.every((operationId) => f24SafeIdentifier(operationId)) &&
    record(value.counts) &&
    Object.values(value.counts).every(
      (count) => typeof count === "number" && Number.isSafeInteger(count),
    ) &&
    value.results.length <= F25_MAX_OPERATIONS &&
    value.results.every(isF25SynchronizationResultReadModel) &&
    (value.reason === undefined || isReason(value.reason)) &&
    record(value.capabilities) &&
    value.capabilities.canCommit === false &&
    value.capabilities.canPush === false &&
    value.capabilities.canPublish === false &&
    value.capabilities.canInvokeAi === false &&
    typeof value.version === "number" &&
    Number.isSafeInteger(value.version) &&
    safeText(value.createdAt, 64) &&
    safeText(value.updatedAt, 64)
  );
}

export function projectF25ChangeEvidence(evidence: {
  readonly schemaVersion: 1;
  readonly side: "SOURCE" | "DESTINATION";
  readonly baseSha: string;
  readonly tipSha: string;
  readonly files: readonly {
    readonly path: string;
    readonly kind: string;
    readonly oldPath?: string;
    readonly statusCode?: string;
  }[];
  readonly evidenceHash: string;
  readonly complete: boolean;
}): F25ChangeEvidence {
  return {
    schemaVersion: 1,
    side: evidence.side,
    baseSha: evidence.baseSha,
    tipSha: evidence.tipSha,
    files: evidence.files.map((file) => ({
      path: file.path,
      kind: file.kind,
      ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }),
      ...(file.statusCode === undefined ? {} : { statusCode: file.statusCode }),
    })),
    evidenceHash: evidence.evidenceHash,
    complete: evidence.complete,
  };
}
