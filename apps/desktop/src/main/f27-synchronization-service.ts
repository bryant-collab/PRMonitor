import type {
  F13ClearChoice,
  F13ClearResult,
  F13InspectionResult,
} from "../shared/f13-contracts";
import type {
  F25SynchronizationBatchReadModel,
  F25SynchronizationResultReadModel,
} from "../shared/f25-synchronization";
import { f25Fingerprint } from "../shared/f25-synchronization";
import type {
  F27ActionResult,
  F27ApprovalInput,
  F27BatchCounts,
  F27BatchReview,
  F27BatchRow,
  F27FreshnessEvidence,
  F27FreshnessInput,
  F27FreshnessRead,
  F27GitPublisher,
  F27HeadAdvanceInvalidation,
  F27MergeCandidate,
  F27PublicationInput,
  F27PublicationSummary,
  F27Reason,
  F27ReevaluationInput,
  F27ResultReview,
  F27ResultStatus,
  F27StateRecord,
  F27WorktreeActionInput,
  F27WorktreeReference,
} from "../shared/f27-synchronization";
import {
  f27CapabilitiesFor,
  f27Counts,
  f27ReasonFor,
  f27ReasonFromF25,
  f27StatusFromF25,
  f27StatusFromF25Status,
} from "../shared/f27-synchronization";
import type { PublicationIntentInput } from "./persistence/types";
import type { PublicationIntentRecord } from "./persistence/repositories";
import type { F27PersistencePort } from "./persistence/f27-repositories";

export interface F27F25Port {
  readonly readBatch: (
    batchId: string,
  ) => F25SynchronizationBatchReadModel | undefined;
  readonly listBatches: () => readonly F25SynchronizationBatchReadModel[];
  readonly readResult: (
    operationId: string,
  ) => F25SynchronizationResultReadModel | undefined;
}

export interface F27WorktreePort {
  readonly inspectOperation: (
    operationId: string,
    ownerId: string,
    phase?: "INSPECTION" | "CLEAR_BEFORE" | "CLEAR_AFTER",
  ) => Promise<F13InspectionResult>;
  readonly clearChanges: (input: {
    readonly operationId: string;
    readonly ownerId: string;
    readonly choice: F13ClearChoice;
    readonly actionId?: string;
    readonly confirmed?: boolean;
    readonly beforeSnapshotId?: string;
    readonly afterSnapshotId?: string;
  }) => Promise<F13ClearResult>;
}

export interface F27FreshnessPort {
  readonly read: (input: {
    readonly operationId: string;
    readonly managedPrId: string;
    readonly sourceRepositoryKey: string;
    readonly destinationRepositoryKey: string;
    readonly sourceBranch: string;
    readonly destinationBranch: string;
    readonly expectedSourceSha: string;
    readonly expectedHeadSha: string;
  }) => Promise<F27FreshnessRead>;
}

export interface F27ReevaluationPort {
  readonly start: (input: {
    readonly operationId: string;
    readonly managedPrId: string;
    readonly expectedSourceSha: string;
    readonly expectedHeadSha: string;
  }) => Promise<{
    readonly status: "ACKNOWLEDGED" | "FAILED" | "UNCERTAIN";
    readonly batchId?: string;
    readonly operationId?: string;
    readonly reason?: F27Reason;
  }>;
}

export interface F27PublicationPersistencePort {
  readonly saveApproval: (input: {
    readonly approvalId: string;
    readonly scope: string;
    readonly reviewedSnapshotHash?: string;
    readonly payload: unknown;
  }) => void;
  readonly createPublicationIntent: (
    input: PublicationIntentInput,
  ) => PublicationIntentRecord;
  readonly getPublicationIntent: (
    kind: PublicationIntentInput["kind"],
    idempotencyKey: string,
  ) => PublicationIntentRecord | undefined;
  readonly updatePublicationIntent: (input: {
    readonly publicationId: string;
    readonly expectedVersion: number;
    readonly phase: string;
    readonly recoveryState: string;
    readonly knownCommitSha?: string;
    readonly pushEvidence?: unknown;
    readonly payload?: unknown;
  }) => PublicationIntentRecord;
  readonly listPublicationIntents: (
    kind?: PublicationIntentInput["kind"],
  ) => readonly PublicationIntentRecord[];
  readonly recordExternalEffect: (input: {
    readonly effectId: string;
    readonly publicationId?: string;
    readonly effectKind: string;
    readonly idempotencyKey: string;
    readonly state: string;
    readonly knownRemoteId?: string;
    readonly evidence?: unknown;
  }) => void;
}

export interface F27InvalidationPort {
  readonly invalidatePublishedResult?: (
    invalidation: F27HeadAdvanceInvalidation,
  ) => Promise<void> | void;
}

export interface F27SynchronizationServiceOptions {
  readonly f25: F27F25Port;
  readonly persistence: F27PersistencePort;
  readonly publication: F27PublicationPersistencePort;
  readonly worktrees: F27WorktreePort;
  readonly freshness: F27FreshnessPort;
  readonly reevaluation: F27ReevaluationPort;
  readonly git: F27GitPublisher;
  readonly invalidation?: F27InvalidationPort;
  readonly now?: () => string;
}

export class F27SynchronizationError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly reason?: F27Reason,
  ) {
    super(message);
    this.name = "F27SynchronizationError";
  }
}

function defaultNow(): string {
  return new Date().toISOString();
}

function correlation(operationId: string, suffix: string): string {
  const value = `f27-${operationId}-${suffix}`;
  return value.slice(0, 128);
}

function f27StatusIsTerminal(status: F27ResultStatus): boolean {
  return (
    status === "SKIPPED" || status === "DISCARDED" || status === "PUBLISHED"
  );
}

function reasonForResult(result: F25SynchronizationResultReadModel): F27Reason {
  return f27ReasonFromF25(
    result.reason,
    correlation(result.operationId, "result"),
  );
}

function resultWorktreeReference(
  result: F25SynchronizationResultReadModel,
  condition: F27StateRecord["worktreeCondition"],
): F27WorktreeReference | undefined {
  const worktree = result.worktree;
  if (worktree === undefined) return undefined;
  return {
    worktreeId: worktree.worktreeId,
    operationId: worktree.operationId,
    ownerId: worktree.ownerId,
    baselineSha: worktree.baselineSha,
    ...(worktree.currentHeadSha === undefined
      ? {}
      : { currentHeadSha: worktree.currentHeadSha }),
    rootRevision: worktree.rootRevision,
    ...(condition === undefined ? {} : { condition }),
    available: true,
  };
}

function resultCandidateHash(
  result: F25SynchronizationResultReadModel,
): string {
  return f25Fingerprint({
    operationId: result.operationId,
    resultVersion: result.version,
    mergeOutcome: result.mergeOutcome,
    sourceSha: result.input.row.syncSourceSha,
    headSha: result.input.row.prHeadSha,
    mergeBaseSha: result.mergeBaseSha,
    sourceEvidenceHash: result.sourceChangeEvidence?.evidenceHash,
    destinationEvidenceHash: result.prHeadChangeEvidence?.evidenceHash,
    worktreeFingerprint: result.worktree?.stateFingerprint,
    validation: result.validation?.status,
    conflicts: result.conflicts.map((conflict) => conflict.path).sort(),
  });
}

function exactShas(result: F25SynchronizationResultReadModel): {
  readonly sourceSha: string;
  readonly headSha: string;
} {
  const sourceSha = result.input.row.syncSourceSha;
  const headSha = result.input.row.prHeadSha;
  if (sourceSha === undefined || headSha === undefined)
    throw new F27SynchronizationError(
      "F27_EXACT_SHAS_MISSING",
      "The result does not contain both exact source and pull-request head SHAs.",
    );
  return { sourceSha, headSha };
}

function safeCommitMessage(input: string, operationId: string): string {
  const normalized = input
    .replaceAll("\u0000", " ")
    .replace(/[\r\n]/gu, " ")
    .trim();
  if (normalized.length > 0) return normalized.slice(0, 512);
  return `Synchronize ${operationId}`;
}

function statusReason(
  result: F25SynchronizationResultReadModel,
  state: F27StateRecord,
): F27Reason {
  return state.reason ?? reasonForResult(result);
}

function worktreeAllowsChoice(
  condition: F13InspectionResult["condition"],
  choice: F13ClearChoice,
): boolean {
  if (choice === "KEEP_AND_CANCEL") return true;
  const requiredAction =
    choice === "CLEAR_ALL" ? "CLEAR_ALL_CHANGES" : "CLEAR_ONLY_AI_CHANGES";
  return condition.permittedNextActions.includes(requiredAction);
}

function worktreeSafeForPublication(
  condition: F13InspectionResult["condition"],
): boolean {
  return condition.permittedNextActions.includes("REVALIDATE_FOR_PUBLICATION");
}

function publicationSummary(
  intent: PublicationIntentRecord,
  now: string,
  overrides: Partial<F27PublicationSummary> = {},
): F27PublicationSummary {
  return {
    publicationId: intent.id,
    approvalId: intent.approvalId,
    idempotencyKey: intent.idempotencyKey,
    phase: intent.phase,
    recoveryState: intent.recoveryState,
    codePublished:
      intent.phase === "PUBLISHED" && overrides.outcome !== "NO_CODE_CHANGE",
    ...(intent.knownCommitSha === undefined
      ? {}
      : { commitSha: intent.knownCommitSha }),
    updatedAt: now,
    nextAction:
      intent.phase === "PUBLISHED"
        ? "NONE"
        : intent.recoveryState === "UNKNOWN"
          ? "RECONCILE"
          : "PUBLISH",
    ...overrides,
  };
}

export class F27SynchronizationService {
  private readonly now: () => string;

  public constructor(
    private readonly options: F27SynchronizationServiceOptions,
  ) {
    this.now = options.now ?? defaultNow;
  }

  public listBatches(): readonly F27BatchReview[] {
    return this.options.f25
      .listBatches()
      .map((batch) => this.projectBatch(batch));
  }

  public readBatch(batchId: string): F27BatchReview | undefined {
    const batch = this.options.f25.readBatch(batchId);
    return batch === undefined ? undefined : this.projectBatch(batch);
  }

  public readResult(operationId: string): F27ResultReview | undefined {
    const result = this.options.f25.readResult(operationId);
    return result === undefined ? undefined : this.projectResult(result);
  }

  public async refreshWorktree(
    operationId: string,
    expectedRevision?: number,
  ): Promise<F27ResultReview> {
    const result = this.requireResult(operationId);
    const state = this.ensureState(result);
    if (expectedRevision !== undefined)
      this.assertRevision(state, expectedRevision);
    const inspected = await this.options.worktrees.inspectOperation(
      operationId,
      result.worktree?.ownerId ?? operationId,
      "INSPECTION",
    );
    const nextStatus = f27StatusIsTerminal(state.status)
      ? state.status
      : !inspected.ok ||
          inspected.condition.classification === "STALE_OR_UNKNOWN"
        ? state.status === "STALE"
          ? "STALE"
          : "UNKNOWN"
        : !worktreeSafeForPublication(inspected.condition)
          ? "NEEDS_ATTENTION"
          : state.status;
    const nextReason = inspected.ok
      ? state.reason
      : f27ReasonFor(
          "F27_WORKTREE_INSPECTION_FAILED",
          "The operation worktree could not be inspected.",
          "Publication and cleanup require fresh operation-owned worktree evidence.",
          "RECONCILE",
          correlation(operationId, "worktree"),
        );
    this.saveState(state, {
      status: nextStatus,
      worktreeCondition: inspected.condition,
      reason: nextReason,
      nextAction:
        inspected.condition.classification === "STALE_OR_UNKNOWN"
          ? "RECONCILE"
          : !worktreeSafeForPublication(inspected.condition)
            ? "REVIEW"
            : state.nextAction,
    });
    return this.requireProjectedResult(operationId);
  }

  public async actOnWorktree(
    input: F27WorktreeActionInput,
  ): Promise<F27ActionResult> {
    const result = this.requireResult(input.operationId);
    const state = this.ensureState(result);
    this.assertRevision(state, input.expectedRevision);
    if (input.choice === "CLEAR_ALL" && input.confirmed !== true)
      throw new F27SynchronizationError(
        "F27_CLEAR_ALL_CONFIRMATION_REQUIRED",
        "Clear All Changes requires an explicit destructive confirmation.",
      );
    if (state.lastAction?.actionId === input.actionId) {
      return {
        outcome:
          state.lastAction.status === "COMPLETED"
            ? "COMPLETED"
            : state.lastAction.status === "UNKNOWN"
              ? "UNCERTAIN"
              : "ATTENTION",
        review: this.requireProjectedResult(input.operationId),
      };
    }
    const inspected = await this.options.worktrees.inspectOperation(
      input.operationId,
      result.worktree?.ownerId ?? input.operationId,
      "CLEAR_BEFORE",
    );
    if (!worktreeAllowsChoice(inspected.condition, input.choice)) {
      const reason = f27ReasonFor(
        "F27_WORKTREE_CHOICE_UNSAFE",
        "The selected worktree choice is not permitted by fresh F13 evidence.",
        "F27 will not clear unattributed, overlapping, stale, or unknown changes.",
        "REVIEW",
        correlation(input.operationId, "worktree-choice-unsafe"),
      );
      this.saveState(state, {
        status: "NEEDS_ATTENTION",
        worktreeCondition: inspected.condition,
        reason,
        nextAction: "REVIEW",
      });
      return {
        outcome: "REJECTED",
        review: this.requireProjectedResult(input.operationId),
        reason,
      };
    }
    const actionState = this.saveState(state, {
      lastAction: {
        actionId: input.actionId,
        kind: "WORKTREE_DECISION",
        choice: input.choice,
        status: "PENDING",
        createdAt: this.now(),
      },
      worktreeCondition: inspected.condition,
      reason: f27ReasonFor(
        "F27_WORKTREE_DECISION_RECORDED",
        "The worktree decision was recorded before any clear effect.",
        "F27 persists the user choice before delegating the operation-owned mutation to F13.",
        "RECONCILE",
        correlation(input.operationId, "worktree-action"),
      ),
      nextAction: "RECONCILE",
    });
    if (input.choice === "KEEP_AND_CANCEL") {
      this.saveState(actionState, {
        status: "NEEDS_ATTENTION",
        lastAction: { ...actionState.lastAction!, status: "CANCELLED" },
        reason: f27ReasonFor(
          "F27_WORKTREE_RETAINED",
          "The operation worktree was kept unchanged.",
          "The user chose to keep the exact worktree evidence and cancel this worktree action.",
          "REVIEW",
          correlation(input.operationId, "worktree-retained"),
        ),
        nextAction: "REVIEW",
      });
      return {
        outcome: "CANCELLED",
        review: this.requireProjectedResult(input.operationId),
      };
    }
    const cleared = await this.options.worktrees.clearChanges({
      operationId: input.operationId,
      ownerId: result.worktree?.ownerId ?? input.operationId,
      choice: input.choice,
      actionId: input.actionId,
      confirmed: input.confirmed,
      beforeSnapshotId: input.beforeSnapshotId,
      afterSnapshotId: input.afterSnapshotId,
    });
    const after = await this.options.worktrees.inspectOperation(
      input.operationId,
      result.worktree?.ownerId ?? input.operationId,
      "CLEAR_AFTER",
    );
    const completed = cleared.ok && after.ok;
    this.saveState(actionState, {
      status: completed ? "NEEDS_ATTENTION" : "UNKNOWN",
      lastAction: {
        ...actionState.lastAction!,
        status: completed ? "COMPLETED" : "UNKNOWN",
      },
      worktreeCondition: after.condition,
      reason: completed
        ? f27ReasonFor(
            "F27_WORKTREE_CLEARED",
            "The selected worktree changes were cleared and re-inspected.",
            "F13 completed the explicit user-selected clear operation and returned fresh evidence.",
            "RE_EVALUATE",
            correlation(input.operationId, "worktree-cleared"),
          )
        : f27ReasonFor(
            "F27_WORKTREE_CLEAR_UNCERTAIN",
            "The worktree clear did not return a confirmed durable outcome.",
            "F27 preserves the operation and requires reconciliation before another mutation.",
            "RECONCILE",
            correlation(input.operationId, "worktree-clear-uncertain"),
          ),
      nextAction: completed ? "RE_EVALUATE" : "RECONCILE",
    });
    return {
      outcome: completed ? "COMPLETED" : "UNCERTAIN",
      review: this.requireProjectedResult(input.operationId),
      ...(completed
        ? {}
        : {
            reason: f27ReasonFor(
              "F27_WORKTREE_CLEAR_UNCERTAIN",
              "The worktree clear requires reconciliation.",
              "F13 did not prove the post-action state.",
              "RECONCILE",
              correlation(input.operationId, "worktree-clear-result"),
            ),
          }),
    };
  }

  public async refreshFreshness(
    input: F27FreshnessInput,
  ): Promise<F27ResultReview> {
    const result = this.requireResult(input.operationId);
    const state = this.ensureState(result);
    this.assertRevision(state, input.expectedRevision);
    const row = result.input.row;
    const { sourceSha, headSha } = exactShas(result);
    const read = await this.options.freshness.read({
      operationId: result.operationId,
      managedPrId: result.managedPrId,
      sourceRepositoryKey: row.sourceRepository.key,
      destinationRepositoryKey: row.destinationRepository.key,
      sourceBranch: row.syncSourceBranch,
      destinationBranch: row.prHeadBranch,
      expectedSourceSha: sourceSha,
      expectedHeadSha: headSha,
    });
    const evidence: F27FreshnessEvidence = {
      outcome: read.outcome,
      checkedAt: read.checkedAt,
      sourceRepositoryKey: read.sourceRepositoryKey ?? row.sourceRepository.key,
      destinationRepositoryKey:
        read.destinationRepositoryKey ?? row.destinationRepository.key,
      sourceBranch: read.sourceBranch ?? row.syncSourceBranch,
      destinationBranch: read.destinationBranch ?? row.prHeadBranch,
      expectedSourceSha: sourceSha,
      expectedHeadSha: headSha,
      ...(read.sourceSha === undefined
        ? {}
        : { observedSourceSha: read.sourceSha }),
      ...(read.headSha === undefined ? {} : { observedHeadSha: read.headSha }),
      ...(read.state === undefined ? {} : { observedPrState: read.state }),
      ...(read.merged === undefined ? {} : { observedMerged: read.merged }),
      ...(read.reason === undefined ? {} : { reason: read.reason }),
    };
    const moved =
      read.outcome === "MOVED" || read.outcome === "IDENTITY_MISMATCH";
    const unavailable = read.outcome === "UNAVAILABLE";
    const nextStatus: F27ResultStatus = f27StatusIsTerminal(state.status)
      ? state.status
      : moved || state.status === "STALE"
        ? "STALE"
        : unavailable
          ? "UNKNOWN"
          : read.outcome === "CLOSED" || read.outcome === "MERGED"
            ? "NEEDS_ATTENTION"
            : state.status === "UNKNOWN"
              ? f27StatusFromF25(result)
              : state.status;
    const reason = moved
      ? f27ReasonFor(
          "F27_REMOTE_INPUT_MOVED",
          "The source or pull-request head moved after this result was prepared.",
          "Publication is bound to both exact SHAs and cannot use an older result.",
          "RE_EVALUATE",
          correlation(result.operationId, "stale"),
        )
      : unavailable
        ? f27ReasonFor(
            "F27_REMOTE_FRESHNESS_UNAVAILABLE",
            "The current remote source and pull-request head could not be verified.",
            "An unavailable read does not prove that either SHA moved, so F27 preserves attention without inventing stale evidence.",
            "RETRY",
            correlation(result.operationId, "freshness-unavailable"),
          )
        : read.outcome === "CLOSED" || read.outcome === "MERGED"
          ? f27ReasonFor(
              "F27_PULL_REQUEST_NOT_OPEN",
              "The pull request is closed or already merged.",
              "Synchronization publication is allowed only for the recorded open pull-request target.",
              "REVIEW",
              correlation(result.operationId, "pr-state"),
            )
          : state.status === "STALE"
            ? state.reason
            : f27ReasonFor(
                "F27_REMOTE_INPUT_CURRENT",
                "The exact source and pull-request head still match the prepared result.",
                "The freshness read verified both repository identities, branches, and SHAs through F06.",
                state.nextAction,
                correlation(result.operationId, "freshness-current"),
              );
    this.saveState(state, {
      status: nextStatus,
      freshness: evidence,
      reason,
      nextAction:
        nextStatus === "STALE"
          ? "RE_EVALUATE"
          : nextStatus === "UNKNOWN"
            ? "RETRY"
            : nextStatus === "NEEDS_ATTENTION"
              ? "REVIEW"
              : state.nextAction,
    });
    return this.requireProjectedResult(result.operationId);
  }

  public async reevaluate(
    input: F27ReevaluationInput,
  ): Promise<F27ActionResult> {
    const result = this.requireResult(input.operationId);
    const state = this.ensureState(result);
    this.assertRevision(state, input.expectedRevision);
    if (input.choice !== "KEEP_AND_CANCEL") {
      const worktree = await this.actOnWorktree({
        operationId: input.operationId,
        actionId: input.actionId,
        choice: input.choice,
        expectedRevision: state.revision,
        confirmed: input.confirmed,
      });
      if (worktree.outcome !== "COMPLETED") return worktree;
    } else {
      const retained = await this.actOnWorktree({
        operationId: input.operationId,
        actionId: input.actionId,
        choice: input.choice,
        expectedRevision: state.revision,
      });
      return retained;
    }
    const current = this.requireResult(input.operationId);
    const currentState = this.ensureState(current);
    const { sourceSha, headSha } = exactShas(current);
    const fresh = await this.options.freshness.read({
      operationId: current.operationId,
      managedPrId: current.managedPrId,
      sourceRepositoryKey: current.input.row.sourceRepository.key,
      destinationRepositoryKey: current.input.row.destinationRepository.key,
      sourceBranch: current.input.row.syncSourceBranch,
      destinationBranch: current.input.row.prHeadBranch,
      expectedSourceSha: sourceSha,
      expectedHeadSha: headSha,
    });
    if (fresh.outcome !== "CURRENT") {
      const reviewed = await this.refreshFreshness({
        operationId: current.operationId,
        expectedRevision: currentState.revision,
      });
      return {
        outcome: "ATTENTION",
        review: reviewed,
        reason: reviewed.reason,
      };
    }
    const actionState = this.saveState(currentState, {
      lastAction: {
        actionId: input.actionId,
        kind: "REEVALUATE",
        choice: input.choice,
        status: "PENDING",
        createdAt: this.now(),
      },
      reason: f27ReasonFor(
        "F27_REEVALUATION_RECORDED",
        "A fresh synchronization evaluation was recorded before handoff.",
        "F27 preserves the prior result and sends only the exact current target to F24/F25.",
        "RECONCILE",
        correlation(input.operationId, "reevaluate"),
      ),
      nextAction: "RECONCILE",
    });
    const handoff = await this.options.reevaluation.start({
      operationId: current.operationId,
      managedPrId: current.managedPrId,
      expectedSourceSha: sourceSha,
      expectedHeadSha: headSha,
    });
    if (handoff.status !== "ACKNOWLEDGED") {
      this.saveState(actionState, {
        status: handoff.status === "UNCERTAIN" ? "UNKNOWN" : "NEEDS_ATTENTION",
        lastAction: {
          ...actionState.lastAction!,
          status: handoff.status === "UNCERTAIN" ? "UNKNOWN" : "FAILED",
        },
        reason:
          handoff.reason ??
          f27ReasonFor(
            "F27_REEVALUATION_HANDOFF_FAILED",
            "The fresh synchronization evaluation could not be admitted.",
            "The old result remains available and no new operation identity was assumed.",
            "RECONCILE",
            correlation(input.operationId, "reevaluate-failed"),
          ),
        nextAction: "RECONCILE",
      });
      return {
        outcome: handoff.status === "UNCERTAIN" ? "UNCERTAIN" : "ATTENTION",
        review: this.requireProjectedResult(input.operationId),
        reason: handoff.reason,
      };
    }
    this.saveState(actionState, {
      status: "DISCARDED",
      lastAction: { ...actionState.lastAction!, status: "COMPLETED" },
      reevaluatedByBatchId: handoff.batchId,
      reason: f27ReasonFor(
        "F27_REEVALUATION_STARTED",
        "A new synchronization result was admitted for review.",
        "The previous result remains durably readable and cannot publish after re-evaluation starts.",
        "REVIEW",
        correlation(input.operationId, "reevaluate-started"),
      ),
      nextAction: "REVIEW",
    });
    return {
      outcome: "COMPLETED",
      review: this.requireProjectedResult(input.operationId),
    };
  }

  public discard(input: {
    readonly operationId: string;
    readonly expectedRevision: number;
  }): F27ResultReview {
    const result = this.requireResult(input.operationId);
    const state = this.ensureState(result);
    this.assertRevision(state, input.expectedRevision);
    if (!f27StatusIsTerminal(state.status))
      this.saveState(state, {
        status: "DISCARDED",
        reason: f27ReasonFor(
          "F27_RESULT_DISCARDED",
          "The synchronization result was discarded from publication consideration.",
          "The immutable F25 evidence remains readable for history and no external effect was attempted.",
          "NONE",
          correlation(input.operationId, "discard"),
        ),
        nextAction: "NONE",
      });
    return this.requireProjectedResult(input.operationId);
  }

  public async approvePublication(
    input: F27ApprovalInput,
  ): Promise<F27ResultReview> {
    const result = this.requireResult(input.operationId);
    let state = this.ensureState(result);
    this.assertRevision(state, input.expectedRevision);
    const existing = this.options.publication.getPublicationIntent(
      "SYNCHRONIZATION_RESULT",
      input.idempotencyKey,
    );
    if (existing !== undefined) {
      if (existing.ownerId !== input.operationId)
        throw new F27SynchronizationError(
          "F27_IDEMPOTENCY_CONFLICT",
          "The publication idempotency key belongs to another synchronization result.",
        );
      this.saveState(state, {
        status: existing.phase === "PUBLISHED" ? "PUBLISHED" : "PUBLISHING",
        publication: publicationSummary(existing, this.now()),
        nextAction: existing.phase === "PUBLISHED" ? "NONE" : "PUBLISH",
      });
      return this.requireProjectedResult(input.operationId);
    }
    const competing = this.options.publication
      .listPublicationIntents("SYNCHRONIZATION_RESULT")
      .find(
        (candidate) =>
          candidate.ownerId === input.operationId &&
          candidate.idempotencyKey !== input.idempotencyKey &&
          candidate.phase !== "PUBLISHED" &&
          candidate.phase !== "DISCARDED",
      );
    if (competing !== undefined)
      throw new F27SynchronizationError(
        "F27_PUBLICATION_LOCKED",
        "Another publication intent already owns this synchronization result.",
      );
    if (state.status !== "READY_TO_PUBLISH")
      throw new F27SynchronizationError(
        "F27_RESULT_NOT_READY",
        "Only a current, inspected, validated result can be approved for publication.",
        state.reason,
      );
    if (!input.completeDiffAcknowledged)
      throw new F27SynchronizationError(
        "F27_DIFF_ACKNOWLEDGEMENT_REQUIRED",
        "Complete diff evidence must be acknowledged before publication approval.",
      );
    if (result.mergeOutcome === "NO_OP" && !input.noCodeChangeAcknowledged)
      throw new F27SynchronizationError(
        "F27_NO_CODE_CHANGE_ACKNOWLEDGEMENT_REQUIRED",
        "The no-code-change outcome must be explicitly acknowledged.",
      );
    const reviewed = await this.preflight(result, state);
    state = this.ensureState(reviewed.result);
    if (state.status !== "READY_TO_PUBLISH")
      throw new F27SynchronizationError(
        "F27_PREPUBLISH_RECHECK_FAILED",
        "The result changed during publication preflight.",
        state.reason,
      );
    const candidate = reviewed.candidate;
    if (input.candidateHash !== candidate.candidateHash) {
      const reason = f27ReasonFor(
        "F27_CANDIDATE_CHANGED",
        "The proposed tree or evidence changed.",
        "F27 will not approve a different merge candidate under an old review.",
        "REVIEW",
        correlation(input.operationId, "candidate-changed"),
      );
      this.saveState(state, {
        status: "NEEDS_ATTENTION",
        reason,
        nextAction: "REVIEW",
      });
      throw new F27SynchronizationError(
        "F27_CANDIDATE_CHANGED",
        "The publication candidate changed since the result was reviewed.",
        reason,
      );
    }
    this.options.publication.saveApproval({
      approvalId: input.approvalId,
      scope: `SYNCHRONIZATION_RESULT:${input.operationId}`,
      reviewedSnapshotHash: candidate.candidateHash,
      payload: {
        schemaVersion: 1,
        kind: "F27_SYNCHRONIZATION_PUBLICATION_APPROVAL",
        operationId: input.operationId,
        candidateHash: candidate.candidateHash,
        commitMessage: safeCommitMessage(
          input.commitMessage,
          input.operationId,
        ),
        completeDiffAcknowledged: input.completeDiffAcknowledged,
        noCodeChangeAcknowledged: input.noCodeChangeAcknowledged,
      },
    });
    const intentInput: PublicationIntentInput = {
      id: `f27-publication-${f25Fingerprint({ operationId: input.operationId, idempotencyKey: input.idempotencyKey })}`,
      kind: "SYNCHRONIZATION_RESULT",
      ownerId: input.operationId,
      approvalId: input.approvalId,
      idempotencyKey: input.idempotencyKey,
      expectedBaselineSha: candidate.mergeBaseSha,
      expectedSourceSha: candidate.sourceSha,
      expectedHeadSha: candidate.expectedHeadSha,
      proposedResult: candidate,
      payload: {
        schemaVersion: 1,
        kind: "F27_SYNCHRONIZATION_PUBLICATION_INTENT",
        operationId: input.operationId,
        candidateHash: candidate.candidateHash,
      },
    };
    const intent =
      this.options.publication.createPublicationIntent(intentInput);
    this.saveState(state, {
      status: "PUBLISHING",
      publication: publicationSummary(intent, this.now()),
      reason: f27ReasonFor(
        "F27_PUBLICATION_APPROVED",
        "Publication approval and its exact merge intent were recorded.",
        "The durable approval and publication lock exist before any commit or push effect.",
        "PUBLISH",
        correlation(input.operationId, "approved"),
      ),
      nextAction: "PUBLISH",
    });
    return this.requireProjectedResult(input.operationId);
  }

  public async publish(input: F27PublicationInput): Promise<F27ResultReview> {
    const intent = this.options.publication.getPublicationIntent(
      "SYNCHRONIZATION_RESULT",
      input.idempotencyKey,
    );
    if (intent === undefined || intent.ownerId !== input.operationId)
      throw new F27SynchronizationError(
        "F27_PUBLICATION_NOT_FOUND",
        "The synchronization publication intent is not available for this result.",
      );
    if (intent.phase === "PUBLISHED")
      return this.adoptPublishedIntent(input, intent);
    const result = this.requireResult(input.operationId);
    const state = this.ensureState(result);
    if (
      intent.phase === "COMMITTING" ||
      intent.phase === "PUSHING" ||
      intent.phase === "RECOVERING" ||
      intent.recoveryState !== "READY"
    )
      return this.reconcileUncertainPublication(input, intent, result, state);
    const reviewed = await this.preflight(result, state);
    const candidate = reviewed.candidate;
    const durableCandidate = this.candidateFromIntent(result, intent);
    const candidateMatchesIntent =
      durableCandidate.candidateHash === candidate.candidateHash &&
      durableCandidate.worktreeId === candidate.worktreeId &&
      durableCandidate.worktreePath === candidate.worktreePath &&
      durableCandidate.expectedHeadSha === candidate.expectedHeadSha &&
      durableCandidate.sourceSha === candidate.sourceSha &&
      durableCandidate.destinationBranch === candidate.destinationBranch &&
      durableCandidate.proposedPatchHash === candidate.proposedPatchHash &&
      JSON.stringify(durableCandidate.changedFiles) ===
        JSON.stringify(candidate.changedFiles);
    if (
      !candidateMatchesIntent ||
      candidate.candidateHash !== resultCandidateHash(result)
    ) {
      const reason = f27ReasonFor(
        "F27_CANDIDATE_CHANGED",
        "The durable result no longer matches the publication intent.",
        "F27 preserves the result and will not publish a changed merge candidate.",
        "REVIEW",
        correlation(input.operationId, "publish-candidate-changed"),
      );
      this.saveState(state, {
        status: "NEEDS_ATTENTION",
        reason,
        nextAction: "REVIEW",
      });
      throw new F27SynchronizationError(
        "F27_CANDIDATE_CHANGED",
        "The durable result no longer matches the publication intent.",
        reason,
      );
    }
    let currentIntent = intent;
    if (result.mergeOutcome === "NO_OP") {
      currentIntent = this.updateIntent(
        currentIntent,
        "PUBLISHED",
        "NOT_REQUIRED",
        undefined,
        {
          outcome: "NO_CODE_CHANGE",
        },
      );
      this.saveState(state, {
        status: "PUBLISHED",
        publication: publicationSummary(currentIntent, this.now(), {
          codePublished: false,
          outcome: "NO_CODE_CHANGE",
          nextAction: "NONE",
        }),
        reason: f27ReasonFor(
          "F27_NO_CODE_CHANGE",
          "The source and destination already had the same effective tree.",
          "F27 recorded the explicit no-op outcome and created no empty commit or push.",
          "NONE",
          correlation(input.operationId, "no-op"),
        ),
        nextAction: "NONE",
      });
      return this.requireProjectedResult(input.operationId);
    }
    let commitSha = currentIntent.knownCommitSha;
    if (commitSha === undefined) {
      currentIntent = this.updateIntent(
        currentIntent,
        "COMMITTING",
        "READY",
        undefined,
      );
      const committed = await this.options.git.commitMerge({
        candidate,
        attemptId: `${currentIntent.id}-commit`,
      });
      if (committed.outcome === "COMMITTED") commitSha = committed.commitSha;
      if (committed.outcome === "NO_CODE_CHANGE") {
        currentIntent = this.updateIntent(
          currentIntent,
          "PUBLISHED",
          "NOT_REQUIRED",
          undefined,
          {
            outcome: "NO_CODE_CHANGE",
          },
        );
        this.saveState(state, {
          status: "PUBLISHED",
          publication: publicationSummary(currentIntent, this.now(), {
            codePublished: false,
            outcome: "NO_CODE_CHANGE",
            nextAction: "NONE",
          }),
          reason: f27ReasonFor(
            "F27_NO_CODE_CHANGE",
            "The reviewed merge contained no code change at commit time.",
            "F27 did not create an empty commit.",
            "NONE",
            correlation(input.operationId, "commit-no-op"),
          ),
          nextAction: "NONE",
        });
        return this.requireProjectedResult(input.operationId);
      }
      if (commitSha === undefined) {
        const reconciled = await this.options.git.reconcileCommit({
          candidate,
          attemptId: `${currentIntent.id}-commit-reconcile`,
        });
        if (reconciled.outcome === "PRESENT") commitSha = reconciled.commitSha;
        else {
          const unknown =
            reconciled.outcome === "UNKNOWN" ||
            committed.outcome === "UNCERTAIN";
          currentIntent = this.updateIntent(
            currentIntent,
            "RECOVERING",
            unknown ? "UNKNOWN" : "FAILED",
          );
          this.saveState(state, {
            status: unknown ? "UNKNOWN" : "NEEDS_ATTENTION",
            publication: publicationSummary(currentIntent, this.now()),
            reason: f27ReasonFor(
              "F27_COMMIT_RECONCILIATION_REQUIRED",
              "The merge-commit outcome is not confirmed.",
              "F27 will not create a second commit until the existing attempt is reconciled.",
              "RECONCILE",
              correlation(input.operationId, "commit-reconcile"),
            ),
            nextAction: "RECONCILE",
          });
          return this.requireProjectedResult(input.operationId);
        }
      }
      currentIntent = this.updateIntent(
        currentIntent,
        "COMMITTING",
        "CONFIRMED",
        commitSha,
        {
          commitSha,
        },
      );
      this.options.publication.recordExternalEffect({
        effectId: `${currentIntent.id}:commit`,
        publicationId: currentIntent.id,
        effectKind: "SYNCHRONIZATION_MERGE_COMMIT",
        idempotencyKey: `${currentIntent.id}:commit`,
        state: "CONFIRMED",
        knownRemoteId: commitSha,
      });
    }
    currentIntent = this.updateIntent(
      currentIntent,
      "PUSHING",
      "READY",
      commitSha,
    );
    const pushed = await this.options.git.pushMerge({
      candidate,
      commitSha,
      attemptId: `${currentIntent.id}-push`,
    });
    let pushConfirmed = pushed.outcome === "PUSHED";
    if (!pushConfirmed) {
      const reconciled = await this.options.git.reconcilePush({
        candidate,
        commitSha,
        attemptId: `${currentIntent.id}-push-reconcile`,
      });
      pushConfirmed = reconciled.outcome === "PRESENT";
      if (!pushConfirmed) {
        currentIntent = this.updateIntent(
          currentIntent,
          "RECOVERING",
          reconciled.outcome === "UNKNOWN" || pushed.outcome === "UNCERTAIN"
            ? "UNKNOWN"
            : "FAILED",
          commitSha,
        );
        const recoveryUnknown =
          reconciled.outcome === "UNKNOWN" || pushed.outcome === "UNCERTAIN";
        this.saveState(state, {
          status: recoveryUnknown ? "UNKNOWN" : "NEEDS_ATTENTION",
          publication: publicationSummary(currentIntent, this.now()),
          reason: f27ReasonFor(
            "F27_PUSH_RECONCILIATION_REQUIRED",
            "The destination branch update is not confirmed.",
            "F27 will not repeat a push or use a force-style override while the remote outcome is uncertain.",
            "RECONCILE",
            correlation(input.operationId, "push-reconcile"),
          ),
          nextAction: "RECONCILE",
        });
        return this.requireProjectedResult(input.operationId);
      }
    }
    return this.finalizePublished(
      input,
      result,
      state,
      currentIntent,
      candidate,
      commitSha,
    );
  }

  private async adoptPublishedIntent(
    input: F27PublicationInput,
    intent: PublicationIntentRecord,
  ): Promise<F27ResultReview> {
    const result = this.requireResult(input.operationId);
    const state = this.ensureState(result);
    const noCodeChange = intent.knownCommitSha === undefined;
    if (
      state.status === "PUBLISHED" &&
      (noCodeChange ||
        this.options.persistence.getHeadAdvanceInvalidation(
          input.operationId,
        ) !== undefined)
    )
      return this.requireProjectedResult(input.operationId);
    const candidate = this.candidateFromIntent(result, intent);
    if (noCodeChange) {
      this.saveState(state, {
        status: "PUBLISHED",
        publication: publicationSummary(intent, this.now(), {
          codePublished: false,
          outcome: "NO_CODE_CHANGE",
          nextAction: "NONE",
        }),
        reason: f27ReasonFor(
          "F27_NO_CODE_CHANGE",
          "The source and destination already had the same effective tree.",
          "F27 recorded the explicit no-op outcome and created no empty commit or push.",
          "NONE",
          correlation(input.operationId, "no-op-adopted"),
        ),
        nextAction: "NONE",
      });
      return this.requireProjectedResult(input.operationId);
    }
    return this.finalizePublished(
      input,
      result,
      state,
      intent,
      candidate,
      intent.knownCommitSha as string,
    );
  }

  private candidateFromIntent(
    result: F25SynchronizationResultReadModel,
    intent: PublicationIntentRecord,
  ): F27MergeCandidate {
    const value = intent.proposedResult;
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new F27SynchronizationError(
        "F27_PUBLICATION_CANDIDATE_INVALID",
        "The durable publication candidate is not a valid merge snapshot.",
      );
    const candidate = value as Record<string, unknown>;
    if (
      candidate.operationId !== result.operationId ||
      candidate.managedPrId !== result.managedPrId ||
      typeof candidate.candidateHash !== "string" ||
      typeof candidate.worktreePath !== "string" ||
      typeof candidate.expectedHeadSha !== "string" ||
      typeof candidate.sourceSha !== "string" ||
      typeof candidate.destinationBranch !== "string"
    )
      throw new F27SynchronizationError(
        "F27_PUBLICATION_CANDIDATE_INVALID",
        "The durable publication candidate does not match this result.",
      );
    return value as F27MergeCandidate;
  }

  private recordRecovery(
    input: F27PublicationInput,
    result: F25SynchronizationResultReadModel,
    state: F27StateRecord,
    intent: PublicationIntentRecord,
    recoveryState: "FAILED" | "UNKNOWN",
    reason: F27Reason,
    knownCommitSha?: string,
  ): F27ResultReview {
    const currentIntent = this.updateIntent(
      intent,
      "RECOVERING",
      recoveryState,
      knownCommitSha,
    );
    this.saveState(state, {
      status: recoveryState === "UNKNOWN" ? "UNKNOWN" : "NEEDS_ATTENTION",
      publication: publicationSummary(currentIntent, this.now()),
      reason,
      nextAction: "RECONCILE",
    });
    return this.requireProjectedResult(input.operationId);
  }

  private finalizeNoCodeChange(
    input: F27PublicationInput,
    result: F25SynchronizationResultReadModel,
    state: F27StateRecord,
    intent: PublicationIntentRecord,
    suffix: string,
    what: string,
    why: string,
  ): F27ResultReview {
    const publishedIntent = this.updateIntent(
      intent,
      "PUBLISHED",
      "NOT_REQUIRED",
      undefined,
      { outcome: "NO_CODE_CHANGE" },
    );
    this.saveState(state, {
      status: "PUBLISHED",
      publication: publicationSummary(publishedIntent, this.now(), {
        codePublished: false,
        outcome: "NO_CODE_CHANGE",
        nextAction: "NONE",
      }),
      reason: f27ReasonFor(
        "F27_NO_CODE_CHANGE",
        what,
        why,
        "NONE",
        correlation(input.operationId, suffix),
      ),
      nextAction: "NONE",
    });
    return this.requireProjectedResult(result.operationId);
  }

  private async finalizePublished(
    input: F27PublicationInput,
    result: F25SynchronizationResultReadModel,
    state: F27StateRecord,
    intent: PublicationIntentRecord,
    candidate: F27MergeCandidate,
    commitSha: string,
  ): Promise<F27ResultReview> {
    this.options.publication.recordExternalEffect({
      effectId: `${intent.id}:push`,
      publicationId: intent.id,
      effectKind: "SYNCHRONIZATION_HEAD_PUSH",
      idempotencyKey: `${intent.id}:push`,
      state: "CONFIRMED",
      knownRemoteId: commitSha,
    });
    const publishedIntent = this.updateIntent(
      intent,
      "PUBLISHED",
      "CONFIRMED",
      commitSha,
      { commitSha },
    );
    const invalidation: F27HeadAdvanceInvalidation = {
      schemaVersion: 1,
      kind: "f27-head-advance-invalidation",
      invalidationId: `${publishedIntent.id}:head-advance`,
      operationId: input.operationId,
      managedPrId: result.managedPrId,
      oldHeadSha: candidate.expectedHeadSha,
      newHeadSha: commitSha,
      publicationId: publishedIntent.id,
      createdAt: this.now(),
    };
    const storedInvalidation =
      this.options.persistence.getHeadAdvanceInvalidation(input.operationId);
    const isNewInvalidation = storedInvalidation === undefined;
    this.options.persistence.putHeadAdvanceInvalidation(
      storedInvalidation ?? invalidation,
    );
    if (isNewInvalidation)
      await this.options.invalidation?.invalidatePublishedResult?.(
        invalidation,
      );
    this.saveState(state, {
      status: "PUBLISHED",
      publication: publicationSummary(publishedIntent, this.now(), {
        codePublished: true,
        outcome: "MERGE_COMMIT",
        commitSha,
        nextAction: "NONE",
      }),
      reason: f27ReasonFor(
        "F27_PUBLISHED",
        "The reviewed merge commit was pushed to the exact pull-request head branch.",
        "The non-force push was verified and the durable head-advance invalidation was handed off once.",
        "NONE",
        correlation(input.operationId, "published"),
      ),
      nextAction: "NONE",
    });
    return this.requireProjectedResult(input.operationId);
  }

  private async reconcileUncertainPublication(
    input: F27PublicationInput,
    intent: PublicationIntentRecord,
    result: F25SynchronizationResultReadModel,
    state: F27StateRecord,
  ): Promise<F27ResultReview> {
    const candidate = this.candidateFromIntent(result, intent);
    if (candidate.candidateHash !== resultCandidateHash(result))
      throw new F27SynchronizationError(
        "F27_CANDIDATE_CHANGED",
        "The durable result no longer matches the publication intent.",
      );
    let currentIntent = intent;
    let commitSha = currentIntent.knownCommitSha;
    if (commitSha === undefined) {
      const reconciledCommit = await this.options.git.reconcileCommit({
        candidate,
        attemptId: `${currentIntent.id}-commit-reconcile`,
      });
      if (reconciledCommit.outcome === "PRESENT") {
        commitSha = reconciledCommit.commitSha;
      } else if (reconciledCommit.outcome === "UNKNOWN") {
        return this.recordRecovery(
          input,
          result,
          state,
          currentIntent,
          "UNKNOWN",
          f27ReasonFor(
            "F27_COMMIT_RECONCILIATION_REQUIRED",
            "The merge-commit outcome is not confirmed.",
            "F27 will not create a second commit until exact worktree evidence proves the prior attempt absent or present.",
            "RECONCILE",
            correlation(input.operationId, "commit-reconcile-unknown"),
          ),
        );
      } else {
        currentIntent = this.updateIntent(currentIntent, "COMMITTING", "READY");
        const committed = await this.options.git.commitMerge({
          candidate,
          attemptId: `${currentIntent.id}-commit-retry`,
        });
        if (committed.outcome === "COMMITTED") commitSha = committed.commitSha;
        else if (committed.outcome === "NO_CODE_CHANGE")
          return this.finalizeNoCodeChange(
            input,
            result,
            state,
            currentIntent,
            "commit-retry-no-op",
            "The reviewed merge contained no code change at reconciliation time.",
            "F27 did not create an empty commit.",
          );
        else {
          const proof = await this.options.git.reconcileCommit({
            candidate,
            attemptId: `${currentIntent.id}-commit-retry-reconcile`,
          });
          if (proof.outcome === "PRESENT") commitSha = proof.commitSha;
          else
            return this.recordRecovery(
              input,
              result,
              state,
              currentIntent,
              proof.outcome === "UNKNOWN" || committed.outcome === "UNCERTAIN"
                ? "UNKNOWN"
                : "FAILED",
              f27ReasonFor(
                "F27_COMMIT_RECONCILIATION_REQUIRED",
                "The merge-commit outcome is not confirmed.",
                "F27 will not create a second commit until the same publication intent is reconciled again.",
                "RECONCILE",
                correlation(input.operationId, "commit-retry-reconcile"),
              ),
            );
        }
      }
      if (commitSha === undefined)
        throw new F27SynchronizationError(
          "F27_COMMIT_RECONCILIATION_REQUIRED",
          "The merge-commit outcome is not confirmed.",
        );
      currentIntent = this.updateIntent(
        currentIntent,
        "COMMITTING",
        "CONFIRMED",
        commitSha,
        { commitSha },
      );
      this.options.publication.recordExternalEffect({
        effectId: `${currentIntent.id}:commit`,
        publicationId: currentIntent.id,
        effectKind: "SYNCHRONIZATION_MERGE_COMMIT",
        idempotencyKey: `${currentIntent.id}:commit`,
        state: "CONFIRMED",
        knownRemoteId: commitSha,
      });
    }
    const remote = await this.options.git.reconcilePush({
      candidate,
      commitSha,
      attemptId: `${currentIntent.id}-push-reconcile`,
    });
    if (remote.outcome === "PRESENT")
      return this.finalizePublished(
        input,
        result,
        state,
        currentIntent,
        candidate,
        commitSha,
      );
    if (remote.outcome === "UNKNOWN")
      return this.recordRecovery(
        input,
        result,
        state,
        currentIntent,
        "UNKNOWN",
        f27ReasonFor(
          "F27_PUSH_RECONCILIATION_REQUIRED",
          "The destination branch update is not confirmed.",
          "F27 will not repeat a push or use a force-style override while the remote outcome is uncertain.",
          "RECONCILE",
          correlation(input.operationId, "push-reconcile-unknown"),
        ),
        commitSha,
      );
    currentIntent = this.updateIntent(
      currentIntent,
      "PUSHING",
      "READY",
      commitSha,
    );
    const pushed = await this.options.git.pushMerge({
      candidate,
      commitSha,
      attemptId: `${currentIntent.id}-push-retry`,
    });
    if (pushed.outcome === "PUSHED")
      return this.finalizePublished(
        input,
        result,
        state,
        currentIntent,
        candidate,
        commitSha,
      );
    const proof = await this.options.git.reconcilePush({
      candidate,
      commitSha,
      attemptId: `${currentIntent.id}-push-retry-reconcile`,
    });
    if (proof.outcome === "PRESENT")
      return this.finalizePublished(
        input,
        result,
        state,
        currentIntent,
        candidate,
        commitSha,
      );
    return this.recordRecovery(
      input,
      result,
      state,
      currentIntent,
      proof.outcome === "UNKNOWN" || pushed.outcome === "UNCERTAIN"
        ? "UNKNOWN"
        : "FAILED",
      f27ReasonFor(
        "F27_PUSH_RECONCILIATION_REQUIRED",
        "The destination branch update is not confirmed.",
        "F27 preserves the same publication intent and will not force-update a changed remote.",
        "RECONCILE",
        correlation(input.operationId, "push-retry-reconcile"),
      ),
      commitSha,
    );
  }

  public async reconcile(input: F27PublicationInput): Promise<F27ResultReview> {
    const intent = this.options.publication.getPublicationIntent(
      "SYNCHRONIZATION_RESULT",
      input.idempotencyKey,
    );
    if (intent === undefined)
      throw new F27SynchronizationError(
        "F27_PUBLICATION_NOT_FOUND",
        "The synchronization publication intent is not available.",
      );
    if (intent.phase === "PUBLISHED")
      return this.adoptPublishedIntent(input, intent);
    const result = this.requireResult(input.operationId);
    const state = this.ensureState(result);
    if (
      intent.phase === "COMMITTING" ||
      intent.phase === "PUSHING" ||
      intent.phase === "RECOVERING" ||
      intent.recoveryState !== "READY"
    )
      return this.reconcileUncertainPublication(input, intent, result, state);
    return this.publish(input);
  }

  public async reconcileStartup(): Promise<void> {
    for (const intent of this.options.publication.listPublicationIntents(
      "SYNCHRONIZATION_RESULT",
    )) {
      if (intent.phase === "PUBLISHED" || intent.phase === "DISCARDED")
        continue;
      try {
        await this.reconcile({
          operationId: intent.ownerId,
          idempotencyKey: intent.idempotencyKey,
        });
      } catch {
        // Leave the durable intent for an explicit renderer reconciliation.
      }
    }
  }

  private projectBatch(
    batch: F25SynchronizationBatchReadModel,
  ): F27BatchReview {
    const rows = batch.results.map((result) => {
      const review = this.projectResult(result);
      return {
        operationId: result.operationId,
        managedPrId: result.managedPrId,
        status: review.status,
        mergeOutcome: result.mergeOutcome,
        reason: review.reason,
        nextAction: review.nextAction,
        revision: review.revision,
      } satisfies F27BatchRow;
    });
    const counts: F27BatchCounts = f27Counts(rows);
    return {
      schemaVersion: 1,
      kind: "f27-synchronization-batch",
      batchId: batch.batchId,
      sourceStatus: batch.status,
      rows,
      counts,
      readOnly: true,
      version: batch.version,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
    };
  }

  private projectResult(
    result: F25SynchronizationResultReadModel,
  ): F27ResultReview {
    const state = this.ensureState(result);
    const publication = state.publication;
    const review: F27ResultReview = {
      schemaVersion: 1,
      kind: "f27-synchronization-result",
      operationId: result.operationId,
      batchId: result.batchId,
      managedPrId: result.managedPrId,
      status: state.status,
      sourceStatus: result.status,
      stage: result.stage,
      mergeOutcome: result.mergeOutcome,
      input: result.input,
      ...(result.worktree === undefined
        ? {}
        : {
            worktree: resultWorktreeReference(result, state.worktreeCondition),
          }),
      ...(result.mergeBaseSha === undefined
        ? {}
        : { mergeBaseSha: result.mergeBaseSha }),
      ...(result.sourceChangeEvidence === undefined
        ? {}
        : { sourceChangeEvidence: result.sourceChangeEvidence }),
      ...(result.prHeadChangeEvidence === undefined
        ? {}
        : { prHeadChangeEvidence: result.prHeadChangeEvidence }),
      conflicts: result.conflicts,
      ...(result.validation === undefined
        ? {}
        : { validation: result.validation }),
      aiUsage: result.aiUsage,
      ...(result.aiOperationId === undefined
        ? {}
        : { aiOperationId: result.aiOperationId }),
      ...(result.conflictResolution === undefined
        ? {}
        : { conflictResolution: result.conflictResolution }),
      ...(state.freshness === undefined ? {} : { freshness: state.freshness }),
      reason: statusReason(result, state),
      nextAction: state.nextAction,
      capabilities: f27CapabilitiesFor(
        state.status,
        result.mergeOutcome,
        state.worktreeCondition,
      ),
      ...(publication === undefined ? {} : { publication }),
      candidateHash: resultCandidateHash(result),
      revision: state.revision,
      sourceVersion: result.version,
      version: state.version,
      createdAt: result.createdAt,
      updatedAt: state.updatedAt,
    };
    return review;
  }

  private ensureState(
    result: F25SynchronizationResultReadModel,
  ): F27StateRecord {
    const existing = this.options.persistence.getState(result.operationId);
    if (existing !== undefined) {
      if (f27StatusIsTerminal(existing.status)) return existing;
      const previousSourceStatus = existing.sourceStatus;
      const previousProjectedStatus =
        previousSourceStatus === undefined
          ? "PREPARING"
          : f27StatusFromF25Status(previousSourceStatus);
      if (previousSourceStatus !== result.status) {
        const nextStatus = f27StatusFromF25(result);
        if (existing.status === previousProjectedStatus) {
          return this.saveState(existing, {
            sourceStatus: result.status,
            status: nextStatus,
            reason: reasonForResult(result),
            nextAction: f27ReasonFromF25(result.reason).nextAction,
          });
        }
        return this.saveState(existing, { sourceStatus: result.status });
      }
      return existing;
    }
    const reason = reasonForResult(result);
    const state: F27StateRecord = {
      schemaVersion: 1,
      kind: "f27-synchronization-state",
      operationId: result.operationId,
      batchId: result.batchId,
      managedPrId: result.managedPrId,
      sourceStatus: result.status,
      status: f27StatusFromF25(result),
      revision: 1,
      version: 1,
      reason,
      nextAction: f27ReasonFromF25(result.reason).nextAction,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    };
    return this.options.persistence.putState({ state });
  }

  private saveState(
    current: F27StateRecord,
    patch: Partial<Omit<F27StateRecord, "version" | "revision" | "updatedAt">>,
  ): F27StateRecord {
    const next: F27StateRecord = {
      ...current,
      ...patch,
      revision: current.revision + 1,
      version: current.version + 1,
      updatedAt: this.now(),
    };
    return this.options.persistence.putState({
      state: next,
      expectedVersion: current.version,
    });
  }

  private requireResult(
    operationId: string,
  ): F25SynchronizationResultReadModel {
    const result = this.options.f25.readResult(operationId);
    if (result === undefined)
      throw new F27SynchronizationError(
        "F27_RESULT_NOT_FOUND",
        "The synchronization result is not available.",
      );
    return result;
  }

  private requireProjectedResult(operationId: string): F27ResultReview {
    const result = this.readResult(operationId);
    if (result === undefined)
      throw new F27SynchronizationError(
        "F27_RESULT_NOT_FOUND",
        "The synchronization result is not available.",
      );
    return result;
  }

  private assertRevision(state: F27StateRecord, expected: number): void {
    if (state.revision !== expected)
      throw new F27SynchronizationError(
        "F27_STALE_REVIEW",
        "The synchronization result changed before this action was applied.",
        state.reason,
      );
  }

  private async preflight(
    result: F25SynchronizationResultReadModel,
    state: F27StateRecord,
  ): Promise<{
    readonly result: F25SynchronizationResultReadModel;
    readonly candidate: F27MergeCandidate;
  }> {
    if (state.status !== "READY_TO_PUBLISH" && state.status !== "PUBLISHING")
      throw new F27SynchronizationError(
        "F27_PUBLICATION_BLOCKED",
        "The result is not in a publishable state.",
        state.reason,
      );
    const validation = result.validation?.status;
    if (
      validation === "failed" ||
      validation === "running" ||
      validation === "interrupted"
    ) {
      const reason = f27ReasonFor(
        "F27_VALIDATION_NOT_ACCEPTABLE",
        "Required validation is not acceptable for publication.",
        "F27 will not treat failed, running, or interrupted validation as proof that the reviewed tree is safe.",
        "REFRESH_EVIDENCE",
        correlation(result.operationId, "validation-blocked"),
      );
      this.saveState(state, {
        status: "NEEDS_ATTENTION",
        reason,
        nextAction: "REFRESH_EVIDENCE",
      });
      throw new F27SynchronizationError(
        "F27_VALIDATION_NOT_ACCEPTABLE",
        "Required validation is not acceptable for publication.",
        reason,
      );
    }
    if (
      result.conflictResolution?.status === "AMBIGUOUS" ||
      result.conflictResolution?.status === "BLOCKED"
    ) {
      const reason = f27ReasonFor(
        "F27_CONFLICT_NOT_COMPLETE",
        "The conflict result still requires an explicit user-directed completion.",
        "F27 keeps ambiguous semantic conflict evidence in attention and does not publish it.",
        "MANUAL_RESOLUTION",
        correlation(result.operationId, "conflict-blocked"),
      );
      this.saveState(state, {
        status: "NEEDS_ATTENTION",
        reason,
        nextAction: "MANUAL_RESOLUTION",
      });
      throw new F27SynchronizationError(
        "F27_CONFLICT_NOT_COMPLETE",
        "The conflict result still requires an explicit user-directed completion.",
        reason,
      );
    }
    const freshness = await this.options.freshness.read({
      operationId: result.operationId,
      managedPrId: result.managedPrId,
      sourceRepositoryKey: result.input.row.sourceRepository.key,
      destinationRepositoryKey: result.input.row.destinationRepository.key,
      sourceBranch: result.input.row.syncSourceBranch,
      destinationBranch: result.input.row.prHeadBranch,
      expectedSourceSha: exactShas(result).sourceSha,
      expectedHeadSha: exactShas(result).headSha,
    });
    const expected = exactShas(result);
    const row = result.input.row;
    const currentReadIsInconsistent =
      freshness.outcome === "CURRENT" &&
      (freshness.sourceSha !== expected.sourceSha ||
        freshness.headSha !== expected.headSha ||
        freshness.sourceRepositoryKey !== row.sourceRepository.key ||
        freshness.destinationRepositoryKey !== row.destinationRepository.key ||
        freshness.sourceBranch !== row.syncSourceBranch ||
        freshness.destinationBranch !== row.prHeadBranch);
    if (currentReadIsInconsistent) {
      const observedMovement =
        (freshness.sourceSha !== undefined &&
          freshness.sourceSha !== expected.sourceSha) ||
        (freshness.headSha !== undefined &&
          freshness.headSha !== expected.headSha);
      const reason = f27ReasonFor(
        observedMovement
          ? "F27_REMOTE_INPUT_MOVED"
          : "F27_REMOTE_FRESHNESS_INCONSISTENT",
        observedMovement
          ? "The source or pull-request head moved after this result was prepared."
          : "The current remote freshness response is incomplete or inconsistent.",
        observedMovement
          ? "Publication is bound to both exact SHAs and cannot use an older result."
          : "F27 will not publish until the exact repository, branch, and SHA identities are verified.",
        observedMovement ? "RE_EVALUATE" : "RETRY",
        correlation(result.operationId, "freshness-inconsistent"),
      );
      this.saveState(state, {
        status: observedMovement ? "STALE" : "UNKNOWN",
        reason,
        nextAction: observedMovement ? "RE_EVALUATE" : "RETRY",
      });
      throw new F27SynchronizationError(
        "F27_FRESHNESS_INCONSISTENT",
        "Publication requires complete exact freshness evidence.",
        reason,
      );
    }
    if (freshness.outcome !== "CURRENT") {
      const reviewed = await this.refreshFreshness({
        operationId: result.operationId,
        expectedRevision: state.revision,
      });
      throw new F27SynchronizationError(
        "F27_FRESHNESS_BLOCKED",
        "Publication requires a fresh source and pull-request head read.",
        reviewed.reason,
      );
    }
    const inspected = await this.options.worktrees.inspectOperation(
      result.operationId,
      result.worktree?.ownerId ?? result.operationId,
      "INSPECTION",
    );
    if (!inspected.ok || !worktreeSafeForPublication(inspected.condition)) {
      const reason = f27ReasonFor(
        "F27_WORKTREE_EVIDENCE_BLOCKED",
        "The operation worktree could not be verified for publication.",
        "F27 will not commit or push an uncertain or unattributed tree.",
        "RECONCILE",
        correlation(result.operationId, "preflight-worktree"),
      );
      this.saveState(state, {
        status:
          inspected.condition.classification === "STALE_OR_UNKNOWN"
            ? "STALE"
            : "NEEDS_ATTENTION",
        worktreeCondition: inspected.condition,
        reason,
        nextAction: "RECONCILE",
      });
      throw new F27SynchronizationError(
        "F27_WORKTREE_EVIDENCE_BLOCKED",
        "Publication requires fresh operation-owned worktree evidence.",
        reason,
      );
    }
    const candidate = this.candidateFrom(result, inspected);
    if (result.mergeOutcome !== "NO_OP" && !candidate.proposedDiffComplete)
      throw new F27SynchronizationError(
        "F27_DIFF_INCOMPLETE",
        "The complete proposed diff is not available for publication.",
        f27ReasonFor(
          "F27_DIFF_INCOMPLETE",
          "The reviewed merge does not have complete bounded diff evidence.",
          "F27 requires complete deterministic diff evidence before approval or publication.",
          "REFRESH_EVIDENCE",
          correlation(result.operationId, "diff-incomplete"),
        ),
      );
    if (candidate.changedFiles.length === 0 && result.mergeOutcome !== "NO_OP")
      throw new F27SynchronizationError(
        "F27_EMPTY_MERGE_CANDIDATE",
        "A changed merge result has no bounded changed-file evidence.",
      );
    return { result, candidate };
  }

  private candidateFrom(
    result: F25SynchronizationResultReadModel,
    inspected: F13InspectionResult,
  ): F27MergeCandidate {
    const row = result.input.row;
    const { sourceSha, headSha } = exactShas(result);
    const changedFiles = [
      ...(inspected.proposedDiff?.files.map((file) => file.path) ?? []),
    ].sort();
    if (
      result.worktree?.stateFingerprint !== undefined &&
      inspected.condition.currentFingerprint !==
        result.worktree.stateFingerprint
    )
      throw new F27SynchronizationError(
        "F27_WORKTREE_CANDIDATE_CHANGED",
        "The operation worktree changed after the synchronization result was prepared.",
        f27ReasonFor(
          "F27_WORKTREE_CANDIDATE_CHANGED",
          "The reviewed worktree fingerprint no longer matches fresh evidence.",
          "F27 will not publish a tree that was not included in the reviewed result.",
          "RE_EVALUATE",
          correlation(result.operationId, "worktree-candidate-changed"),
        ),
      );
    const candidateHash = resultCandidateHash(result);
    return {
      operationId: result.operationId,
      managedPrId: result.managedPrId,
      worktreeId: inspected.worktree.worktreeId,
      worktreePath: inspected.worktree.canonicalPath,
      ...(result.worktree?.stateFingerprint === undefined
        ? {}
        : { expectedWorktreeFingerprint: result.worktree.stateFingerprint }),
      sourceRepositoryKey: row.sourceRepository.key,
      destinationRepositoryKey: row.destinationRepository.key,
      destinationBranch: row.prHeadBranch,
      expectedHeadSha: headSha,
      sourceSha,
      mergeBaseSha:
        result.mergeBaseSha ??
        (() => {
          throw new F27SynchronizationError(
            "F27_MERGE_BASE_MISSING",
            "The exact merge-base evidence is missing.",
          );
        })(),
      expectedParentShas: [headSha, sourceSha],
      changedFiles,
      ...(inspected.proposedDiff?.patchHash === undefined
        ? {}
        : { proposedPatchHash: inspected.proposedDiff.patchHash }),
      proposedDiffComplete: inspected.proposedDiff?.complete === true,
      candidateHash,
      commitMessage: `Synchronize ${row.syncSourceBranch} into ${row.prHeadBranch}`,
    };
  }

  private updateIntent(
    intent: PublicationIntentRecord,
    phase: string,
    recoveryState: string,
    knownCommitSha?: string,
    payload?: unknown,
  ): PublicationIntentRecord {
    return this.options.publication.updatePublicationIntent({
      publicationId: intent.id,
      expectedVersion: intent.version,
      phase,
      recoveryState,
      ...(knownCommitSha === undefined ? {} : { knownCommitSha }),
      ...(payload === undefined ? {} : { payload }),
    });
  }
}
