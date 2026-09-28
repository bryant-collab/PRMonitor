import {
  f24SafeIdentifier,
  isF24PreparationAuthorization,
  type F24PreparationAuthorization,
  type F24Reason as F24ReasonValue,
  type F24ResolutionRow,
} from "../shared/f24-synchronization";
import type {
  F13InspectionResult,
  F13RepositoryIdentity,
  F13PreparationResult,
  F13SafeReason,
  F13SynchronizationEvidenceResult,
  F13SynchronizationMergeResult,
  F13SynchronizationOperationRequest,
  F13WorktreeRecord,
} from "../shared/f13-contracts";
import {
  f25Capabilities,
  f25Fingerprint,
  f25Reason,
  f25ZeroAiUsage,
  isF25Terminal,
  type F25BatchStatus,
  type F25ChangeEvidence,
  type F25ConflictEvidence,
  type F25ConflictHandoff,
  type F25InputSnapshot,
  type F25MergeOutcome,
  type F25OperationStage,
  type F25Reason,
  type F25SynchronizationBatchReadModel,
  type F25SynchronizationResultReadModel,
  type F25ValidationEvidence,
  type F25WorktreeEvidence,
} from "../shared/f25-synchronization";
import type { ManagedPrReadModel } from "../shared/managed-pr";
import type {
  F14ValidationExecutionResult,
  F14ValidationReadModel,
  F14ValidationRequest,
} from "./f14-validation-runner";
import type { ValidationResolution } from "@prmonitor/validation-contract";
import type { F25PersistencePort } from "./persistence/f25-repositories";

export interface F25ManagedPrPort {
  readonly getManagedPr: (
    managedPrId: string,
  ) => ManagedPrReadModel | undefined;
}

export interface F25F13Port {
  readonly prepareSynchronization: (
    input: F13SynchronizationOperationRequest,
  ) => Promise<F13PreparationResult>;
  readonly inspectOperation: (
    operationId: string,
    ownerId: string,
    phase?:
      | "PREPARE"
      | "INSPECTION"
      | "BEFORE_AI"
      | "AFTER_AI"
      | "AFTER_MERGE"
      | "CLEAR_BEFORE"
      | "CLEAR_AFTER",
  ) => Promise<F13InspectionResult>;
  readonly readSynchronizationEvidence: (input: {
    readonly operationId: string;
    readonly ownerId: string;
  }) => Promise<F13SynchronizationEvidenceResult>;
  readonly mergeSynchronization: (input: {
    readonly operationId: string;
    readonly ownerId: string;
    readonly signal?: AbortSignal;
  }) => Promise<F13SynchronizationMergeResult>;
}

export interface F25F14Port {
  readonly run: (
    input: F14ValidationRequest,
  ) => Promise<F14ValidationExecutionResult>;
  readonly readModel: (runId: string) => F14ValidationReadModel | undefined;
  readonly reconcileStartup?: () => Promise<unknown>;
}

export interface F25ValidationPort {
  readonly resolve: (input: {
    readonly repositoryId: string;
    readonly operationId: string;
  }) => ValidationResolution | Promise<ValidationResolution>;
}

export interface F25WorktreeRootPort {
  readonly read: () => {
    readonly canonicalPath?: string;
    readonly rootRevision?: number;
  };
}

export interface F25ActivitySink {
  readonly append: (event: {
    readonly correlationId: string;
    readonly operationId?: string;
    readonly managedPrId?: string;
    readonly reasonCode: string;
    readonly summary: string;
  }) => void;
}

export interface F25SynchronizationServiceOptions {
  readonly persistence: F25PersistencePort;
  readonly managedPrs: F25ManagedPrPort;
  readonly f13: F25F13Port;
  readonly f14: F25F14Port;
  readonly validation: F25ValidationPort;
  readonly worktreeRoot?: F25WorktreeRootPort;
  readonly activity?: F25ActivitySink;
  readonly now?: () => string;
  readonly maxConcurrentOperations?: number;
}

export class F25SynchronizationError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly reason: F25Reason,
  ) {
    super(message);
    this.name = "F25SynchronizationError";
  }
}

interface ActiveOperation {
  readonly controller: AbortController;
  readonly promise: Promise<void>;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function safeCorrelation(operationId: string, suffix: string): string {
  const value = `f25-${operationId}-${suffix}`;
  return f24SafeIdentifier(value) ? value : `f25-${suffix}`;
}

function actionFromF24(reason: F24ReasonValue): F25Reason["nextAction"] {
  if (reason.nextAction === "NONE") return "NONE";
  if (reason.nextAction === "RECONCILE") return "RECONCILE";
  if (reason.nextAction === "WAIT") return "REVIEW";
  return "RETRY";
}

function f25FromF24(reason: F24ReasonValue, correlationId: string): F25Reason {
  return f25Reason({
    code: `F24_${reason.code}`,
    what: reason.what,
    why: reason.why,
    nextAction: actionFromF24(reason),
    correlationId,
  });
}

function f25FromF13(
  reason: F13SafeReason | undefined,
  correlationId: string,
): F25Reason {
  if (reason === undefined)
    return f25Reason({
      code: "F25_OPERATION_FAILED",
      what: "The deterministic synchronization operation did not complete.",
      why: "The operation-owned state was preserved for reconciliation.",
      nextAction: "RECONCILE",
      correlationId,
    });
  const nextAction: F25Reason["nextAction"] =
    reason.nextAction === "MANUAL_RESOLUTION"
      ? "MANUAL_RESOLUTION"
      : reason.nextAction === "RETRY"
        ? "RETRY"
        : reason.nextAction === "NONE"
          ? "NONE"
          : "RECONCILE";
  return f25Reason({
    code: `F13_${reason.code}`,
    what: reason.what,
    why: reason.why,
    nextAction,
    correlationId,
  });
}

function repositoryFor(
  repository: F24ResolutionRow["sourceRepository"],
): F13RepositoryIdentity | undefined {
  if (
    repository.available !== true ||
    typeof repository.owner !== "string" ||
    typeof repository.name !== "string"
  )
    return undefined;
  return {
    serverId: repository.server.serverKey,
    owner: repository.owner,
    name: repository.name,
    key: repository.key,
  };
}

function projectWorktree(
  worktree: F13WorktreeRecord | undefined,
  inspection?: F13InspectionResult,
): F25WorktreeEvidence | undefined {
  if (worktree === undefined || worktree.canonicalPath.length === 0)
    return undefined;
  return {
    operationId: worktree.operationId,
    worktreeId: worktree.worktreeId,
    ownerId: worktree.ownerId,
    canonicalPath: worktree.canonicalPath,
    rootRevision: worktree.rootRevision,
    baselineSha: worktree.worktreeBaselineSha,
    ...(worktree.currentHeadSha === undefined
      ? {}
      : { currentHeadSha: worktree.currentHeadSha }),
    ...(inspection === undefined
      ? {}
      : {
          condition: inspection.condition.classification,
          stateFingerprint: inspection.condition.currentFingerprint,
        }),
  };
}

function projectChangeEvidence(
  evidence: NonNullable<
    F13SynchronizationEvidenceResult["sourceChangeEvidence"]
  >,
): F25ChangeEvidence {
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

function projectConflicts(
  merge: F13SynchronizationMergeResult,
): readonly F25ConflictEvidence[] {
  const files = new Map(
    (merge.inspection?.snapshot?.manifest.files ?? []).map((file) => [
      file.path,
      file,
    ]),
  );
  return merge.conflictPaths.map((path) => {
    const file = files.get(path);
    return {
      path,
      ...(file?.statusCode === undefined
        ? {}
        : { statusCode: file.statusCode }),
      ...(file?.contentBase64 === undefined
        ? {}
        : { contentBase64: file.contentBase64 }),
      ...(file?.contentComplete === undefined
        ? {}
        : { contentComplete: file.contentComplete }),
      details:
        "Git preserved the unresolved index/worktree state for manual resolution.",
    };
  });
}

function projectValidation(
  model: F14ValidationReadModel | undefined,
  execution: F14ValidationExecutionResult,
  runId: string,
): F25ValidationEvidence {
  const status = model?.status ?? execution.run.status;
  const warnings = (model?.warnings ?? execution.run.warnings).map(
    (warning) => ({
      code: warning.code,
      status,
      ...(model?.reason === undefined ? {} : { reason: model.reason }),
    }),
  );
  return {
    runId,
    status,
    ...(model?.reason === undefined ? {} : { reason: model.reason }),
    warnings,
    nextAction: model?.nextAction ?? "REVIEW_VALIDATION_EVIDENCE",
    version: model?.version ?? execution.record.version,
  };
}

function initialBatchCounts(
  results: readonly F25SynchronizationResultReadModel[],
): F25SynchronizationBatchReadModel["counts"] {
  return countsFor(results);
}

function countsFor(
  results: readonly F25SynchronizationResultReadModel[],
): F25SynchronizationBatchReadModel["counts"] {
  return {
    total: results.length,
    eligible: results.filter((result) => result.status !== "SKIPPED").length,
    skipped: results.filter((result) => result.status === "SKIPPED").length,
    ready: results.filter((result) => result.status === "READY_TO_PUBLISH")
      .length,
    attention: results.filter((result) => result.status === "NEEDS_ATTENTION")
      .length,
    failed: results.filter((result) => result.status === "FAILED").length,
    pending: results.filter((result) => !isF25Terminal(result)).length,
  };
}

function batchStatus(
  results: readonly F25SynchronizationResultReadModel[],
): F25BatchStatus {
  if (results.some((result) => result.mergeOutcome === "UNCERTAIN"))
    return "UNCERTAIN";
  if (results.some((result) => !isF25Terminal(result))) return "RUNNING";
  if (results.some((result) => result.status === "NEEDS_ATTENTION"))
    return "NEEDS_ATTENTION";
  if (results.some((result) => result.status === "FAILED")) return "FAILED";
  return "COMPLETED";
}

function resultWith(
  current: F25SynchronizationResultReadModel,
  now: string,
  patch: Partial<F25SynchronizationResultReadModel>,
): F25SynchronizationResultReadModel {
  return {
    ...current,
    ...patch,
    updatedAt: now,
  };
}

export class F25SynchronizationService {
  private readonly now: () => string;
  private readonly maxConcurrent: number;
  private readonly active = new Map<string, ActiveOperation>();
  private accepting = true;

  public constructor(
    private readonly options: F25SynchronizationServiceOptions,
  ) {
    this.now = options.now ?? defaultNow;
    this.maxConcurrent = Math.max(
      1,
      Math.min(options.maxConcurrentOperations ?? 4, 16),
    );
  }

  public async accept(authorization: F24PreparationAuthorization): Promise<{
    readonly status: "ACKNOWLEDGED" | "FAILED" | "UNCERTAIN";
    readonly authorizationId?: string;
    readonly reason?: F25Reason;
  }> {
    const authorizationId = `f24-auth-${f25Fingerprint(authorization.intentId)}`;
    const correlationId = safeCorrelation(authorization.intentId, "admission");
    if (!this.accepting)
      return {
        status: "FAILED",
        authorizationId,
        reason: f25Reason({
          code: "F25_SHUTDOWN_IN_PROGRESS",
          what: "The synchronization batch was not admitted while application shutdown was in progress.",
          why: "F25 does not start new operation-owned effects during shutdown.",
          nextAction: "RECONCILE",
          correlationId,
        }),
      };
    if (!isF24PreparationAuthorization(authorization))
      return {
        status: "FAILED",
        authorizationId,
        reason: f25Reason({
          code: "F25_AUTHORIZATION_INVALID",
          what: "The F24 authorization did not satisfy the immutable preparation contract.",
          why: "F25 refuses to infer repositories, branches, or SHAs from mutable application state.",
          nextAction: "RETRY",
          correlationId,
        }),
      };
    if (
      authorization.skippedManagedPrIds.length > 0 &&
      authorization.skipped === undefined
    )
      return {
        status: "FAILED",
        authorizationId,
        reason: f25Reason({
          code: "F25_SKIPPED_EVIDENCE_MISSING",
          what: "The authorization names skipped pull requests without carrying their immutable row evidence.",
          why: "F25 must retain every selected ineligible result instead of silently dropping it from the durable batch.",
          nextAction: "RETRY",
          correlationId,
        }),
      };
    const batchId = `f25-batch-${f25Fingerprint({
      intentId: authorization.intentId,
      idempotencyKey: authorization.idempotencyKey,
      resolutionRevision: authorization.resolutionRevision,
    })}`;
    const existing = this.options.persistence.getBatchByIdempotencyKey(
      authorization.idempotencyKey,
    );
    if (existing !== undefined) {
      void this.dispatchBatch(existing.batchId);
      return { status: "ACKNOWLEDGED", authorizationId };
    }
    if (authorization.eligible.length === 0)
      return {
        status: "FAILED",
        authorizationId,
        reason: f25Reason({
          code: "F25_NO_ELIGIBLE_OPERATION",
          what: "The authorization did not contain an eligible pull request.",
          why: "An empty synchronization batch has no deterministic operation to admit.",
          nextAction: "REVIEW",
          correlationId,
        }),
      };
    const initialResults = this.initialResults(
      authorization,
      batchId,
      authorizationId,
    );
    const batch: F25SynchronizationBatchReadModel = {
      schemaVersion: 1,
      kind: "synchronization-batch",
      batchId,
      authorizationId,
      intentId: authorization.intentId,
      idempotencyKey: authorization.idempotencyKey,
      resolutionRevision: authorization.resolutionRevision,
      status: "ADMITTED",
      authorization,
      operationIds: initialResults.map((result) => result.operationId),
      counts: initialBatchCounts(initialResults),
      results: initialResults,
      capabilities: f25Capabilities(),
      version: 1,
      createdAt: authorization.createdAt,
      updatedAt: authorization.createdAt,
    };
    try {
      this.options.persistence.persistAdmission({
        batch,
        results: initialResults,
      });
    } catch {
      return {
        status: "UNCERTAIN",
        authorizationId,
        reason: f25Reason({
          code: "F25_ADMISSION_UNCERTAIN",
          what: "The synchronization admission transaction did not return a confirmed outcome.",
          why: "F25 will not start Git or validation effects without a durable batch and per-PR result record.",
          nextAction: "RECONCILE",
          correlationId,
        }),
      };
    }
    void this.dispatchBatch(batchId);
    return { status: "ACKNOWLEDGED", authorizationId };
  }

  private initialResults(
    authorization: F24PreparationAuthorization,
    batchId: string,
    authorizationId: string,
  ): readonly F25SynchronizationResultReadModel[] {
    const rows = [...authorization.eligible, ...(authorization.skipped ?? [])];
    const skippedIds = new Set(authorization.skippedManagedPrIds);
    return rows.map((row, index) => {
      const operationId =
        row.operationId ??
        `f25-op-${f25Fingerprint({
          batchId,
          managedPrId: row.managedPrId,
          index,
        })}`;
      const correlationId = safeCorrelation(operationId, "admission");
      const skipped =
        skippedIds.has(row.managedPrId) || row.eligibility === "INELIGIBLE";
      const input: F25InputSnapshot = {
        schemaVersion: 1,
        authorizationId,
        intentId: authorization.intentId,
        idempotencyKey: authorization.idempotencyKey,
        resolutionRevision: authorization.resolutionRevision,
        operationId,
        row,
        capturedAt: authorization.createdAt,
      };
      const reason = skipped
        ? f25FromF24(row.reason, correlationId)
        : f25Reason({
            code: "F25_ADMITTED",
            what: "The exact synchronization operation was durably admitted.",
            why: "F24 persisted the authorization before F25 created any operation-owned Git state.",
            nextAction: "NONE",
            correlationId,
          });
      return {
        schemaVersion: 1,
        kind: "synchronization-result",
        operationId,
        batchId,
        managedPrId: row.managedPrId,
        status: skipped ? "SKIPPED" : "PREPARING",
        stage: skipped ? "SKIPPED" : "ADMITTED",
        mergeOutcome: "NOT_STARTED",
        input,
        conflicts: [],
        aiUsage: f25ZeroAiUsage(),
        reason,
        nextAction: reason.nextAction,
        capabilities: f25Capabilities(),
        version: 1,
        createdAt: authorization.createdAt,
        updatedAt: authorization.createdAt,
      };
    });
  }

  public readBatch(
    batchId: string,
  ): F25SynchronizationBatchReadModel | undefined {
    return this.options.persistence.getBatch(batchId);
  }

  public listBatches(): readonly F25SynchronizationBatchReadModel[] {
    return this.options.persistence.listBatches();
  }

  public readResult(
    operationId: string,
  ): F25SynchronizationResultReadModel | undefined {
    return this.options.persistence.getResult(operationId);
  }

  public async runBatch(
    batchId: string,
  ): Promise<F25SynchronizationBatchReadModel> {
    const batch = this.options.persistence.getBatch(batchId);
    if (batch === undefined) throw new Error("F25_BATCH_NOT_FOUND");
    const operationIds = batch.results
      .filter((result) => !isF25Terminal(result))
      .map((result) => result.operationId);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < operationIds.length) {
        const index = cursor;
        cursor += 1;
        const operationId = operationIds[index];
        if (operationId !== undefined)
          await this.runOperation(batchId, operationId);
      }
    };
    await Promise.all(
      Array.from(
        {
          length: Math.min(
            this.maxConcurrent,
            Math.max(operationIds.length, 1),
          ),
        },
        () => worker(),
      ),
    );
    return this.options.persistence.getBatch(batchId) ?? batch;
  }

  private async dispatchBatch(batchId: string): Promise<void> {
    try {
      await this.runBatch(batchId);
    } catch {
      const batch = this.options.persistence.getBatch(batchId);
      if (batch !== undefined) {
        const reason = f25Reason({
          code: "F25_BATCH_RECOVERY_REQUIRED",
          what: "The synchronization batch stopped before every result reached a durable terminal state.",
          why: "F25 preserved each committed per-PR result and will not infer missing Git outcomes.",
          nextAction: "RECONCILE",
          correlationId: safeCorrelation(batch.batchId, "batch"),
        });
        try {
          await this.updateBatch(batch.batchId, "UNCERTAIN", reason);
        } catch {
          // Startup reconciliation will surface the last durable result.
        }
      }
    }
  }

  private async runOperation(
    batchId: string,
    operationId: string,
  ): Promise<void> {
    if (this.active.has(operationId)) {
      await this.active.get(operationId)?.promise;
      return;
    }
    const controller = new AbortController();
    const promise = this.executeOperation(
      batchId,
      operationId,
      controller.signal,
    );
    this.active.set(operationId, { controller, promise });
    try {
      await promise;
    } finally {
      this.active.delete(operationId);
    }
  }

  private async executeOperation(
    batchId: string,
    operationId: string,
    signal: AbortSignal,
  ): Promise<void> {
    let current = this.options.persistence.getResult(operationId);
    if (
      current === undefined ||
      current.batchId !== batchId ||
      isF25Terminal(current)
    )
      return;
    const input = current.input;
    const correlationId = safeCorrelation(operationId, "run");
    try {
      const managedPr = this.options.managedPrs.getManagedPr(
        current.managedPrId,
      );
      if (managedPr === undefined || managedPr.localClone === undefined) {
        await this.failResult(
          current,
          "PREPARATION_FAILED",
          "FAILED",
          "FAILED",
          f25Reason({
            code: "F25_LOCAL_CLONE_UNAVAILABLE",
            what: "The approved local clone for this pull request is unavailable.",
            why: "F25 only prepares exact synchronization objects from the recorded developer clone.",
            nextAction: "REVIEW",
            correlationId,
          }),
        );
        return;
      }
      const request = this.f13Request(current, managedPr);
      if (request === undefined) {
        await this.failResult(
          current,
          "PREPARATION_FAILED",
          "FAILED",
          "FAILED",
          f25Reason({
            code: "F25_EXACT_INPUT_MISSING",
            what: "The authorized source or PR-head SHA could not be materialized into an F13 request.",
            why: "F25 never substitutes a default branch, mutable ref, or repository identity.",
            nextAction: "RETRY",
            correlationId,
          }),
        );
        return;
      }
      current = await this.updateResult(current, {
        status: "PREPARING",
        stage: "PREPARING",
        reason: f25Reason({
          code: "F25_PREPARING",
          what: "F13 is materializing the authorized exact source and PR-head objects.",
          why: "The synchronization worktree is owned by this operation and is separate from the developer clone.",
          nextAction: "REVIEW",
          correlationId,
        }),
        nextAction: "REVIEW",
      });
      const prepared = await this.options.f13.prepareSynchronization(request);
      if (!prepared.ok || prepared.worktree === undefined) {
        await this.failResult(
          current,
          prepared.reason?.code === "GIT_CANCELLED"
            ? "CANCELLED"
            : "PREPARATION_FAILED",
          prepared.reason?.code === "GIT_CANCELLED"
            ? "NEEDS_ATTENTION"
            : "FAILED",
          prepared.reason?.code === "GIT_CANCELLED" ? "ATTENTION" : "FAILED",
          f25FromF13(prepared.reason, correlationId),
          prepared.worktree,
        );
        return;
      }
      current = await this.updateResult(current, {
        worktree: projectWorktree(prepared.worktree, prepared.inspection),
      });
      if (signal.aborted) {
        await this.cancelPersisted(current, correlationId);
        return;
      }
      current = await this.updateResult(current, {
        status: "INSPECTING",
        stage: "INSPECTING",
        reason: f25Reason({
          code: "F25_READING_CHANGE_EVIDENCE",
          what: "F13 is recording bounded source-side and destination-side change evidence.",
          why: "The no-op decision and merge input must use the exact persisted SHAs.",
          nextAction: "REVIEW",
          correlationId,
        }),
        nextAction: "REVIEW",
      });
      const evidence = await this.options.f13.readSynchronizationEvidence({
        operationId,
        ownerId: request.ownerId,
      });
      if (
        !evidence.ok ||
        evidence.mergeBaseSha === undefined ||
        evidence.sourceChangeEvidence === undefined ||
        evidence.destinationChangeEvidence === undefined
      ) {
        await this.failResult(
          current,
          "PREPARATION_FAILED",
          "NEEDS_ATTENTION",
          "ATTENTION",
          f25FromF13(evidence.reason, correlationId),
          evidence.worktree,
        );
        return;
      }
      current = await this.updateResult(current, {
        mergeBaseSha: evidence.mergeBaseSha,
        sourceChangeEvidence: projectChangeEvidence(
          evidence.sourceChangeEvidence,
        ),
        prHeadChangeEvidence: projectChangeEvidence(
          evidence.destinationChangeEvidence,
        ),
        worktree: projectWorktree(evidence.worktree),
      });
      const sourceSha = input.row.syncSourceSha;
      if (sourceSha === undefined) {
        await this.failResult(
          current,
          "PREPARATION_FAILED",
          "FAILED",
          "FAILED",
          f25Reason({
            code: "F25_SOURCE_SHA_MISSING",
            what: "The authorized source SHA is missing from the immutable input snapshot.",
            why: "F25 cannot classify ancestry or merge a mutable branch name instead.",
            nextAction: "RETRY",
            correlationId,
          }),
        );
        return;
      }
      if (evidence.mergeBaseSha === sourceSha) {
        current = await this.updateResult(current, {
          status: "INSPECTING",
          stage: "INSPECTING",
          mergeOutcome: "NO_OP",
          reason: f25Reason({
            code: "F25_SOURCE_ALREADY_CONTAINED",
            what: "The exact source SHA is equal to the computed merge base.",
            why: "The source is already contained by the recorded PR head, so F25 did not create an empty merge.",
            nextAction: "REVIEW",
            correlationId,
          }),
          nextAction: "REVIEW",
        });
      } else {
        current = await this.updateResult(current, {
          status: "MERGING",
          stage: "MERGING",
          mergeOutcome: "NOT_STARTED",
          reason: f25Reason({
            code: "F25_MERGING_NO_COMMIT",
            what: "F13 is applying the exact source SHA with a bounded no-commit merge.",
            why: "The operation owns the isolated worktree; F25 has no commit, push, or publication capability.",
            nextAction: "REVIEW",
            correlationId,
          }),
          nextAction: "REVIEW",
        });
        const merged = await this.options.f13.mergeSynchronization({
          operationId,
          ownerId: request.ownerId,
          signal,
        });
        if (merged.outcome === "CONFLICT_DETECTED") {
          const conflicts = projectConflicts(merged);
          const reason = f25FromF13(merged.reason, correlationId);
          current = await this.updateResult(current, {
            status: "NEEDS_ATTENTION",
            stage: "CONFLICT_HANDOFF",
            mergeOutcome: "CONFLICT_DETECTED",
            worktree: projectWorktree(merged.worktree, merged.inspection),
            conflicts,
            reason,
            nextAction: "MANUAL_RESOLUTION",
          });
          if (
            current.worktree !== undefined &&
            current.mergeBaseSha !== undefined &&
            current.sourceChangeEvidence !== undefined &&
            current.prHeadChangeEvidence !== undefined
          ) {
            const handoff: F25ConflictHandoff = {
              kind: "F26_CONFLICT_HANDOFF",
              operationId: current.operationId,
              batchId: current.batchId,
              managedPrId: current.managedPrId,
              input: current.input,
              worktree: current.worktree,
              mergeBaseSha: current.mergeBaseSha,
              sourceChangeEvidence: current.sourceChangeEvidence,
              prHeadChangeEvidence: current.prHeadChangeEvidence,
              conflicts,
              capabilities: {
                canResolveConflict: true,
                canCommit: false,
                canPush: false,
                canPublish: false,
              },
              nextAction: "MANUAL_RESOLUTION",
            };
            await this.updateResult(current, { handoff });
          }
          return;
        }
        if (!merged.ok || merged.outcome !== "CLEAN_MERGE") {
          await this.failResult(
            current,
            merged.outcome === "UNCERTAIN" || signal.aborted
              ? signal.aborted
                ? "CANCELLED"
                : "UNCERTAIN"
              : "PREPARATION_FAILED",
            merged.outcome === "UNCERTAIN" || signal.aborted
              ? "NEEDS_ATTENTION"
              : "FAILED",
            merged.outcome === "UNCERTAIN" || signal.aborted
              ? "ATTENTION"
              : "FAILED",
            f25FromF13(merged.reason, correlationId),
            merged.worktree,
          );
          return;
        }
        current = await this.updateResult(current, {
          status: "INSPECTING",
          stage: "INSPECTING",
          mergeOutcome: "CLEAN_MERGE",
          worktree: projectWorktree(merged.worktree, merged.inspection),
          reason: f25Reason({
            code: "F25_CLEAN_MERGE",
            what: "The exact no-commit merge completed without unresolved conflict paths.",
            why: "F13 inspected the resulting operation-owned worktree and preserved the uncommitted merge state.",
            nextAction: "REVIEW",
            correlationId,
          }),
          nextAction: "REVIEW",
        });
      }
      const inspected = await this.options.f13.inspectOperation(
        operationId,
        request.ownerId,
        "INSPECTION",
      );
      if (
        !inspected.ok ||
        inspected.condition.classification === "STALE_OR_UNKNOWN"
      ) {
        await this.failResult(
          current,
          "UNCERTAIN",
          "NEEDS_ATTENTION",
          "ATTENTION",
          f25FromF13(inspected.reason, correlationId),
          inspected.worktree,
        );
        return;
      }
      current = await this.updateResult(current, {
        worktree: projectWorktree(inspected.worktree, inspected),
      });
      current = await this.updateResult(current, {
        status: "VALIDATING",
        stage: "VALIDATING",
        reason: f25Reason({
          code: "F25_POST_CHANGE_VALIDATION",
          what: "F14 is running the authorized post-change validation boundary.",
          why: "A clean or no-op synchronization is not ready until actual worktree state has been revalidated.",
          nextAction: "REVIEW_VALIDATION",
          correlationId,
        }),
        nextAction: "REVIEW_VALIDATION",
      });
      const validation = await this.runValidation(current, request, signal);
      if (validation === undefined) {
        await this.failResult(
          current,
          "UNCERTAIN",
          "NEEDS_ATTENTION",
          "ATTENTION",
          f25Reason({
            code: "F25_VALIDATION_UNCERTAIN",
            what: "The post-change validation boundary did not return a confirmed durable outcome.",
            why: "F25 preserved the operation-owned worktree and will not claim a validation pass.",
            nextAction: "RECONCILE",
            correlationId,
          }),
        );
        return;
      }
      const validationStatus = validation.evidence.status;
      if (validationStatus === "passed" || validationStatus === "not_run") {
        await this.updateResult(current, {
          status: "READY_TO_PUBLISH",
          stage: "COMPLETED",
          mergeOutcome: current.mergeOutcome,
          validation: validation.evidence,
          reason:
            validationStatus === "passed"
              ? f25Reason({
                  code: "F25_READY_AFTER_VALIDATION",
                  what: "The deterministic synchronization is clean or a no-op and post-change validation passed.",
                  why: "F25 persisted exact source/head identities, merge evidence, worktree inspection, and F14 evidence.",
                  nextAction: "NONE",
                  correlationId,
                })
              : f25Reason({
                  code: "F25_VALIDATION_NOT_RUN",
                  what: "The synchronization is clean or a no-op, but no safe validation command was available.",
                  why: "F14 recorded not_run evidence; F25 does not present that as a false validation pass.",
                  nextAction: "REVIEW_VALIDATION",
                  correlationId,
                }),
          nextAction:
            validationStatus === "passed" ? "NONE" : "REVIEW_VALIDATION",
        });
        return;
      }
      await this.failResult(
        current,
        "VALIDATION_FAILED",
        "NEEDS_ATTENTION",
        "ATTENTION",
        f25Reason({
          code: "F25_VALIDATION_FAILED",
          what: "Post-change validation did not pass.",
          why: "F25 preserves the operation-owned worktree and does not make an unsafe result publishable.",
          nextAction: "REVIEW_VALIDATION",
          correlationId,
        }),
        undefined,
        validation.evidence,
      );
    } catch {
      await this.failResult(
        current,
        signal.aborted ? "CANCELLED" : "UNCERTAIN",
        "NEEDS_ATTENTION",
        "ATTENTION",
        f25Reason({
          code: signal.aborted
            ? "F25_OPERATION_CANCELLED"
            : "F25_OPERATION_UNCERTAIN",
          what: signal.aborted
            ? "The synchronization operation was cancelled before its final outcome was confirmed."
            : "The synchronization operation stopped before its final outcome was confirmed.",
          why: "F25 preserved the durable result and operation-owned path for reconciliation.",
          nextAction: "RECONCILE",
          correlationId,
        }),
      );
    }
  }

  private f13Request(
    result: F25SynchronizationResultReadModel,
    managedPr: ManagedPrReadModel,
  ): F13SynchronizationOperationRequest | undefined {
    const row = result.input.row;
    const sourceRepository = repositoryFor(row.sourceRepository);
    const destinationRepository = repositoryFor(row.destinationRepository);
    if (
      sourceRepository === undefined ||
      destinationRepository === undefined ||
      row.syncSourceSha === undefined ||
      row.prHeadSha === undefined ||
      managedPr.localClone === undefined
    )
      return undefined;
    const root = this.options.worktreeRoot?.read();
    return {
      operationId: result.operationId,
      idempotencyKey:
        `${result.input.idempotencyKey}-${result.operationId}`.slice(0, 128),
      correlationId: safeCorrelation(result.operationId, "f13"),
      ownerType: "SYNCHRONIZATION",
      ownerId: result.operationId,
      managedPrId: result.managedPrId,
      operationKind: "SYNCHRONIZATION",
      developerClonePath: managedPr.localClone.canonicalRoot,
      developerCloneRepository: {
        serverId: managedPr.localClone.repository.serverKey,
        owner: managedPr.localClone.repository.owner,
        name: managedPr.localClone.repository.name,
        key: managedPr.localClone.repository.key,
      },
      ...(root?.canonicalPath === undefined
        ? {}
        : { worktreeRoot: root.canonicalPath }),
      rootRevision: row.f13Readiness?.rootRevision ?? root?.rootRevision ?? 1,
      refs: {
        sourceRepository,
        destinationRepository,
        sourceBranch: row.syncSourceBranch,
        destinationBranch: row.prHeadBranch,
        syncSourceSha: row.syncSourceSha,
        prHeadSha: row.prHeadSha,
      },
    };
  }

  private async runValidation(
    result: F25SynchronizationResultReadModel,
    request: F13SynchronizationOperationRequest,
    signal: AbortSignal,
  ): Promise<{ readonly evidence: F25ValidationEvidence } | undefined> {
    const row = result.input.row;
    const runId = `f25-validation-${f25Fingerprint(result.operationId)}`;
    const resolution = await this.options.validation.resolve({
      repositoryId: row.destinationRepository.key,
      operationId: result.operationId,
    });
    const execution = await this.options.f14.run({
      operationId: result.operationId,
      runId,
      idempotencyKey: `f25-validation-key-${f25Fingerprint(result.operationId)}`,
      correlationId: safeCorrelation(result.operationId, "validation"),
      ownerType: "SYNCHRONIZATION",
      ownerId: request.ownerId,
      consumer: "synchronization",
      requestedPhase: "post_change",
      resolution,
      signal,
    });
    const model = this.options.f14.readModel(runId);
    return { evidence: projectValidation(model, execution, runId) };
  }

  private async updateResult(
    current: F25SynchronizationResultReadModel,
    patch: Partial<F25SynchronizationResultReadModel>,
  ): Promise<F25SynchronizationResultReadModel> {
    const next = resultWith(current, this.now(), patch);
    const saved = this.options.persistence.putResult(next, current.version);
    await this.updateBatch(current.batchId);
    this.emit(saved, "F25_RESULT_UPDATED", "Synchronization result updated.");
    return saved;
  }

  private async failResult(
    current: F25SynchronizationResultReadModel,
    mergeOutcome: F25MergeOutcome,
    status: "NEEDS_ATTENTION" | "FAILED",
    stage: F25OperationStage,
    reason: F25Reason,
    worktree?: F13WorktreeRecord,
    validation?: F25ValidationEvidence,
  ): Promise<void> {
    await this.updateResult(current, {
      status,
      stage,
      mergeOutcome,
      ...(projectWorktree(worktree) === undefined
        ? {}
        : { worktree: projectWorktree(worktree) }),
      ...(validation === undefined ? {} : { validation }),
      reason,
      nextAction: reason.nextAction,
    });
  }

  private async cancelPersisted(
    current: F25SynchronizationResultReadModel,
    correlationId: string,
  ): Promise<void> {
    await this.updateResult(current, {
      status: "NEEDS_ATTENTION",
      stage: "ATTENTION",
      mergeOutcome: "CANCELLED",
      reason: f25Reason({
        code: "F25_OPERATION_CANCELLED",
        what: "The synchronization operation was cancelled before its final outcome was confirmed.",
        why: "F25 preserved the operation-owned path and did not clean or reset it.",
        nextAction: "RECONCILE",
        correlationId,
      }),
      nextAction: "RECONCILE",
    });
  }

  private async updateBatch(
    batchId: string,
    overrideStatus?: F25BatchStatus,
    overrideReason?: F25Reason,
  ): Promise<void> {
    const batch = this.options.persistence.getBatch(batchId);
    if (batch === undefined) return;
    const results = this.options.persistence
      .listResults()
      .filter((result) => result.batchId === batchId);
    const status = overrideStatus ?? batchStatus(results);
    const updated: F25SynchronizationBatchReadModel = {
      ...batch,
      status,
      counts: countsFor(results),
      results,
      updatedAt: this.now(),
      ...(overrideReason === undefined ? {} : { reason: overrideReason }),
    } as F25SynchronizationBatchReadModel;
    this.options.persistence.putBatch(updated);
  }

  public async cancelOperation(operationId: string): Promise<boolean> {
    const active = this.active.get(operationId);
    if (active !== undefined) {
      active.controller.abort("USER_CANCELLED");
      return true;
    }
    const result = this.options.persistence.getResult(operationId);
    if (result === undefined || isF25Terminal(result)) return false;
    await this.cancelPersisted(result, safeCorrelation(operationId, "cancel"));
    return true;
  }

  public async reconcileStartup(): Promise<void> {
    await this.options.f14.reconcileStartup?.();
    for (const batch of this.options.persistence.listBatches()) {
      for (const result of batch.results) {
        if (isF25Terminal(result) || this.active.has(result.operationId))
          continue;
        if (result.stage === "ADMITTED" || result.stage === "PREPARING")
          void this.runOperation(batch.batchId, result.operationId);
        else if (result.stage === "VALIDATING") {
          const validation = result.validation;
          if (
            validation?.status === "passed" ||
            validation?.status === "not_run"
          )
            await this.updateResult(result, {
              status: "READY_TO_PUBLISH",
              stage: "COMPLETED",
              reason: f25Reason({
                code: "F25_VALIDATION_RECONCILED",
                what: "The durable validation result was adopted after restart.",
                why: "F25 found a terminal F14 result for the same operation-owned validation identity.",
                nextAction:
                  validation.status === "passed" ? "NONE" : "REVIEW_VALIDATION",
                correlationId: safeCorrelation(result.operationId, "restart"),
              }),
              nextAction:
                validation.status === "passed" ? "NONE" : "REVIEW_VALIDATION",
            });
          else
            await this.failResult(
              result,
              "UNCERTAIN",
              "NEEDS_ATTENTION",
              "ATTENTION",
              f25Reason({
                code: "F25_RESTART_RECONCILIATION_REQUIRED",
                what: "The synchronization was interrupted during validation.",
                why: "F25 did not rerun a possibly duplicated post-change effect after restart.",
                nextAction: "RECONCILE",
                correlationId: safeCorrelation(result.operationId, "restart"),
              }),
            );
        } else {
          await this.failResult(
            result,
            "UNCERTAIN",
            "NEEDS_ATTENTION",
            "ATTENTION",
            f25Reason({
              code: "F25_RESTART_RECONCILIATION_REQUIRED",
              what: "The synchronization stopped after an effect boundary without a terminal result.",
              why: "F25 preserved the operation-owned worktree and will not repeat a merge or validation blindly.",
              nextAction: "RECONCILE",
              correlationId: safeCorrelation(result.operationId, "restart"),
            }),
          );
        }
      }
    }
  }

  public async shutdown(): Promise<void> {
    this.accepting = false;
    const active = [...this.active.values()];
    for (const operation of active)
      operation.controller.abort("APPLICATION_SHUTDOWN");
    await Promise.allSettled(active.map((operation) => operation.promise));
  }

  private emit(
    result: F25SynchronizationResultReadModel,
    reasonCode: string,
    summary: string,
  ): void {
    try {
      this.options.activity?.append({
        correlationId: result.reason.correlationId,
        operationId: result.operationId,
        managedPrId: result.managedPrId,
        reasonCode,
        summary,
      });
    } catch {
      // Progress reporting never changes an authoritative synchronization result.
    }
  }
}
