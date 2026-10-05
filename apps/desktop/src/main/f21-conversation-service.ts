import { randomUUID } from "node:crypto";
import {
  type AIProviderInputSnapshot,
  type AIProviderConversationReference,
} from "../shared/ai/provider-contracts";
import type { F16RepositoryIdentity } from "../shared/f16-preferences";
import type { F13InspectionResult } from "../shared/f13-contracts";
import {
  f18ReviewBundleReadModelSchema,
  type F18Reason,
  type F18ReviewBundleReadModel,
  type F18ReviewInputSnapshot,
  type F18WorktreeEvidence,
  type F18ValidationEvidence,
  type F18WorktreeCondition,
  type F18AiWorkSummary,
} from "../shared/f18-automatic-review";
import type { F18AutomaticReviewBoundary } from "./automatic-review-coordinator";
import type { F18F13Port, F18F16Port } from "./automatic-review-coordinator";
import type { F21ConversationPersistencePort } from "./persistence/f21-repositories";
import type {
  AIWorkContinuation,
  AIWorkContinuationKind,
  AIWorkReadModel,
} from "../shared/ai-work";
import {
  f21ConversationMessageSchema,
  f21ConversationTurnRecordSchema,
  f21ProposalInputSchema,
  f21RevisionRequestSchema,
  f21RevisionOutcomeSchema,
  f21UserIntentSchema,
  f21ReadModelFromBundle,
  f21TurnFromAIWork,
  type F21ConversationBoundary,
  type F21ConversationMode,
  type F21ConversationReadModel,
  type F21ProposalEntryInput,
  type F21ReviewRevisionOutcome,
  type F21UserIntent,
} from "../shared/f21-conversation";
import type {
  F21AIWorkInput,
  F21NewAIWorkInput,
  F21AIWorkResult,
} from "./f21-ai-work-adapter";
import type { F22ActionGate } from "../shared/f22-discard-reevaluation";
import type { F22GateReadOptions } from "./f22-coordinator";

export interface F21ConversationAIWorkPort {
  readonly run: (input: F21AIWorkInput) => Promise<F21AIWorkResult>;
  readonly startNewOperation: (
    input: F21NewAIWorkInput,
  ) => Promise<F21AIWorkResult>;
  readonly continue: (input: {
    readonly operationId: string;
    readonly confirmation: AIWorkContinuation;
  }) => Promise<F21AIWorkResult>;
  readonly read: (operationId: string) => AIWorkReadModel;
  readonly cancel: (
    operationId: string,
  ) => Promise<F21AIWorkResult | undefined>;
  readonly authorizeContinuation: (input: {
    readonly operationId: string;
    readonly kind: AIWorkContinuationKind;
    readonly selectedBudget?: number;
    readonly snapshotId?: string;
  }) => AIWorkContinuation;
  readonly reconcileStartup: () => Promise<readonly AIWorkReadModel[]>;
}

interface F21F18Boundary extends F18AutomaticReviewBoundary {
  readonly getReadModel: (
    bundleId: string,
  ) => F18ReviewBundleReadModel | undefined;
  readonly saveProposalInput: NonNullable<
    F18AutomaticReviewBoundary["saveProposalInput"]
  >;
  readonly beginReviewRevision: NonNullable<
    F18AutomaticReviewBoundary["beginReviewRevision"]
  >;
  readonly finalizeReviewRevision: NonNullable<
    F18AutomaticReviewBoundary["finalizeReviewRevision"]
  >;
}

interface ActiveOperationProjection {
  readonly operationId: string;
  readonly mode: F21ConversationMode;
  readonly status: string;
  readonly remainingBudget: number;
  readonly attention: boolean;
  readonly permittedNextAction: string;
}

export interface F21ConversationServiceOptions {
  readonly persistence: F21ConversationPersistencePort;
  readonly bundles: F21F18Boundary;
  readonly f13: F18F13Port;
  readonly f16: F18F16Port;
  readonly aiWork: F21ConversationAIWorkPort;
  readonly f22?: {
    readonly readGate: (
      bundleId: string,
      options?: F22GateReadOptions,
    ) => F22ActionGate;
    readonly observeRemoteHead?: (
      bundleId: string,
      options?: F22GateReadOptions,
    ) => Promise<F22ActionGate>;
  };
  readonly clock?: () => string;
}

function now(clock: (() => string) | undefined): string {
  return clock?.() ?? new Date().toISOString();
}

function id(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function secretShaped(value: string): boolean {
  return /(?:gh[pous]_[A-Za-z0-9_-]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]+ PRIVATE KEY-----|(?:password|secret|token|api[_.-]?key)\s*[:=]\s*\S+)/u.test(
    value,
  );
}

function assertSafeUserText(value: string): void {
  if (secretShaped(value)) throw new Error("F21_SECRET_INPUT_REJECTED");
}

function repositoryIdentity(
  input: F18ReviewInputSnapshot,
): F16RepositoryIdentity {
  return {
    serverId: input.pullRequest.baseRepository.serverId,
    owner: input.pullRequest.baseRepository.owner,
    name: input.pullRequest.baseRepository.name,
    key: input.pullRequest.baseRepository.key,
  };
}

function providerInput(
  bundle: F18ReviewBundleReadModel,
  message: string,
  conversationId?: string,
): AIProviderInputSnapshot {
  const humanDecisions = bundle.items
    .filter((item) => item.decision.decision !== "pending")
    .map((item) => ({
      remoteEventVersionId: item.eventVersionId,
      disposition: item.decision.finalDisposition,
      ...(item.decision.instruction?.trim()
        ? { instruction: item.decision.instruction }
        : {}),
      ...(item.decision.answer?.trim() ? { answer: item.decision.answer } : {}),
    }));
  return {
    schemaVersion: 1,
    userMessage: message,
    ...(conversationId === undefined ? {} : { conversationId }),
    remoteEventVersionIds: bundle.input.remoteEventVersionIds,
    eventVersionIds: bundle.input.remoteEventVersionIds,
    pullRequest: {
      baseRepository: bundle.input.pullRequest.baseRepository,
      headRepository: bundle.input.pullRequest.headRepository,
      baseBranch: bundle.input.pullRequest.baseBranch,
      headBranch: bundle.input.pullRequest.headBranch,
      baseSha: bundle.input.pullRequest.baseSha,
      headSha: bundle.input.pullRequest.headSha,
    },
    ...(bundle.input.contextText === undefined
      ? {}
      : { prIntentContext: bundle.input.contextText }),
    humanDecisions,
    feedback: bundle.input.feedback.map((feedback) => ({
      remoteEventVersionId: feedback.eventVersionId,
      sourceKind: feedback.sourceKind,
      sourceId: feedback.sourceId,
      ...(feedback.body === undefined ? {} : { body: feedback.body }),
      ...(feedback.author === undefined ? {} : { author: feedback.author }),
      ...(feedback.path === undefined ? {} : { path: feedback.path }),
      ...(feedback.line === undefined ? {} : { line: feedback.line }),
      ...(feedback.diffHunk === undefined
        ? {}
        : { diffHunk: feedback.diffHunk }),
    })),
  };
}

function worktreeEvidence(
  inspection: F13InspectionResult,
): F18WorktreeEvidence {
  const snapshotId = inspection.snapshot?.snapshotId ?? "unknown-snapshot";
  const stateFingerprint =
    inspection.snapshot?.stateFingerprint ??
    inspection.condition.currentFingerprint;
  const changedFiles = inspection.condition.dirtySummary.changedPaths;
  const knownActions = new Set([
    "REFRESH_EVIDENCE",
    "INSPECT_CHANGES",
    "VALIDATE_WORKTREE",
    "CONTINUE_AI_WORK",
    "REQUEST_WORKTREE_DECISION",
    "CLEAR_ALL_CHANGES",
    "CLEAR_ONLY_AI_CHANGES",
    "KEEP_WORKTREE_AND_CANCEL",
    "RECONCILE",
    "REVALIDATE_FOR_PUBLICATION",
  ]);
  return {
    operationId: inspection.worktree.operationId,
    worktreeId: inspection.worktree.worktreeId,
    ownerType: inspection.worktree.ownerType,
    ownerId: inspection.worktree.ownerId,
    canonicalPath: inspection.worktree.canonicalPath,
    rootRevision: inspection.worktree.rootRevision,
    snapshotId,
    baselineSha: inspection.worktree.worktreeBaselineSha,
    ...(inspection.worktree.currentHeadSha === undefined
      ? {}
      : { currentSha: inspection.worktree.currentHeadSha }),
    stateFingerprint,
    clean: changedFiles.length === 0,
    complete: inspection.ok && inspection.condition.attribution.complete,
    condition: {
      schemaVersion: 1,
      classification: inspection.condition.classification,
      currentFingerprint: inspection.condition.currentFingerprint,
      observedRevision: inspection.condition.observedRevision,
      expectedRevision: inspection.condition.expectedRevision,
      dirtySummary: {
        changedPaths: [...inspection.condition.dirtySummary.changedPaths],
        trackedPaths: [...inspection.condition.dirtySummary.trackedPaths],
        stagedPaths: [...inspection.condition.dirtySummary.stagedPaths],
        untrackedPaths: [...inspection.condition.dirtySummary.untrackedPaths],
        ignoredPaths: [...inspection.condition.dirtySummary.ignoredPaths],
        hash: inspection.condition.dirtySummary.hash,
      },
      attribution: {
        evidenceRef: inspection.condition.attribution.evidenceRef,
        ...(inspection.condition.attribution.beforeSnapshotId === undefined
          ? {}
          : {
              beforeSnapshotId:
                inspection.condition.attribution.beforeSnapshotId,
            }),
        ...(inspection.condition.attribution.afterSnapshotId === undefined
          ? {}
          : {
              afterSnapshotId: inspection.condition.attribution.afterSnapshotId,
            }),
        ...(inspection.condition.attribution.turnSnapshotIds === undefined
          ? {}
          : {
              turnSnapshotIds: [
                ...inspection.condition.attribution.turnSnapshotIds,
              ],
            }),
        aiAttributedPaths: [
          ...inspection.condition.attribution.aiAttributedPaths,
        ],
        unAttributedPaths: [
          ...inspection.condition.attribution.unAttributedPaths,
        ],
        overlapPaths: [...inspection.condition.attribution.overlapPaths],
        complete: inspection.condition.attribution.complete,
      },
      permittedNextActions: inspection.condition.permittedNextActions.filter(
        (action) => knownActions.has(action),
      ) as F18WorktreeCondition["permittedNextActions"],
    },
    changedFiles: [...changedFiles],
    ...(inspection.proposedDiff === undefined
      ? {}
      : {
          proposedDiff: {
            diffId: inspection.proposedDiff.diffId,
            diffHash: inspection.proposedDiff.diffHash,
            patchHash: inspection.proposedDiff.patchHash,
            baselineSha: inspection.proposedDiff.baselineSha,
            ...(inspection.proposedDiff.currentSha === undefined
              ? {}
              : { currentSha: inspection.proposedDiff.currentSha }),
            fileCount: inspection.proposedDiff.files.length,
            complete: inspection.proposedDiff.complete,
          },
        }),
    ...(inspection.contextDiff === undefined
      ? {}
      : {
          contextDiff: {
            diffId: inspection.contextDiff.diffId,
            diffHash: inspection.contextDiff.diffHash,
            patchHash: inspection.contextDiff.patchHash,
            baselineSha: inspection.contextDiff.baselineSha,
            ...(inspection.contextDiff.currentSha === undefined
              ? {}
              : { currentSha: inspection.contextDiff.currentSha }),
            fileCount: inspection.contextDiff.files.length,
            complete: inspection.contextDiff.complete,
          },
        }),
  };
}

function reason(code: string, what: string, nextAction: string): F18Reason {
  return {
    code,
    what,
    why: "F21 preserves the explicit intent and deterministic evidence for review.",
    nextAction,
  };
}

function validationBlocks(
  value: F18ValidationEvidence | undefined,
  required = false,
): boolean {
  if (required && value === undefined) return true;
  return (
    value?.status === "failed" ||
    value?.status === "interrupted" ||
    value?.status === "running" ||
    value?.status === "not_run"
  );
}

function activeFromAI(
  mode: F21ConversationMode,
  readModel: F21AIWorkResult["readModel"],
): ActiveOperationProjection | undefined {
  if (
    readModel.operation.status === "COMPLETED" ||
    readModel.operation.status === "CANCELLED"
  )
    return undefined;
  return {
    operationId: readModel.operation.operationId,
    mode,
    status: readModel.operation.status,
    remainingBudget: readModel.remainingBudget,
    attention: readModel.attention,
    permittedNextAction: readModel.permittedNextAction,
  };
}

function summaryFromAIWork(readModel: AIWorkReadModel): F18AiWorkSummary {
  return {
    operationId: readModel.operation.operationId,
    status: readModel.operation.status,
    attention: readModel.attention,
    nextAction: readModel.permittedNextAction,
    remainingBudget: readModel.remainingBudget,
    usage: readModel.usage,
    reports: readModel.reports.map((report) => ({
      turnId: report.turnId,
      providerStatus: report.providerStatus,
      modelClaims: {
        ...(report.modelClaims.approach === undefined
          ? {}
          : { approach: report.modelClaims.approach }),
        problems: [...report.modelClaims.problems],
        remainingIssues: [...report.modelClaims.remainingIssues],
        claimedChangedFiles: [...report.modelClaims.claimedChangedFiles],
        ...(report.modelClaims.completionClaim === undefined
          ? {}
          : { completionClaim: report.modelClaims.completionClaim }),
        ...(report.modelClaims.semanticResult === undefined
          ? {}
          : { semanticResult: report.modelClaims.semanticResult }),
      },
      actualChangedFiles: report.actualChangedFiles.map((file) => file.path),
      actualCommands: [...report.actualCommands],
      deterministicProblems: [...report.deterministicProblems],
      remainingProblems: [...report.remainingProblems],
      nextAction: report.nextAction,
    })),
  };
}

function failedWorkSummary(operationId: string): F18AiWorkSummary {
  return {
    operationId,
    status: "NEEDS_ATTENTION",
    attention: true,
    nextAction: "REVIEW_EVIDENCE",
    remainingBudget: 0,
    usage: {},
    reports: [],
  };
}

export class F21ConversationService implements F21ConversationBoundary {
  public constructor(private readonly options: F21ConversationServiceOptions) {}

  public read(bundleId: string): F21ConversationReadModel {
    const bundle = this.requireBundle(bundleId);
    const stored = this.ensureReadModel(bundle);
    const turns = this.options.persistence.listTurns(bundleId);
    const messages = this.options.persistence.listMessages(bundleId);
    const proposalInputs =
      this.options.persistence.listProposalInputs(bundleId);
    let activeOperation = stored.activeOperation;
    const latest = turns.at(-1);
    if (latest?.operationId !== undefined) {
      try {
        const operation = this.options.aiWork.read(latest.operationId);
        if (
          operation.operation.status !== "COMPLETED" &&
          operation.operation.status !== "CANCELLED"
        )
          activeOperation = activeFromAI(latest.mode, operation);
        else activeOperation = undefined;
      } catch {
        // F17's durable record remains authoritative; the saved projection is
        // retained when a runtime adapter cannot rehydrate a provider context.
      }
    }
    const f22Gate = this.readF22Gate(bundleId, activeOperation);
    const projected = f21ReadModelFromBundle(bundle, {
      messages: [...messages],
      turns: [...turns],
      proposalInputs: [...proposalInputs],
      ...(activeOperation === undefined ? {} : { activeOperation }),
      ...(stored.lastRevision === undefined
        ? {}
        : { lastRevision: stored.lastRevision }),
      ...(stored.selectedMode === undefined
        ? {}
        : { selectedMode: stored.selectedMode }),
      ...(f22Gate === undefined ? {} : { f22: f22Gate }),
    });
    if (projected.bundleVersion !== stored.bundleVersion) {
      try {
        this.options.persistence.saveReadModel({
          readModel: projected,
          expectedBundleVersion: stored.bundleVersion,
        });
      } catch {
        // The authoritative F18 bundle and F21 journal remain readable even
        // when a concurrent projection writer wins the optimistic update.
      }
    }
    return projected;
  }

  public saveProposalInput(
    input: F21ProposalEntryInput,
  ): F21ConversationReadModel {
    const parsed = f21ProposalInputSchema.parse(input);
    assertSafeUserText(parsed.text);
    const bundle = this.requireBundle(parsed.bundleId);
    const currentItem = bundle.items.find(
      (item) => item.itemId === parsed.itemId,
    );
    if (currentItem === undefined) throw new Error("F21_ITEM_NOT_FOUND");
    if (
      this.options.persistence
        .listProposalInputs(parsed.bundleId)
        .some((candidate) => candidate.commandId === parsed.commandId)
    )
      return this.read(parsed.bundleId);
    this.options.bundles.saveProposalInput({
      bundleId: parsed.bundleId,
      itemId: parsed.itemId,
      kind: parsed.kind,
      text: parsed.text,
      ...(parsed.expectedBundleVersion === undefined
        ? {}
        : { expectedVersion: parsed.expectedBundleVersion }),
      ...(parsed.actionId === undefined ? {} : { actionId: parsed.actionId }),
    });
    this.options.persistence.recordProposalInput(parsed);
    return this.read(parsed.bundleId);
  }

  public async ask(input: F21UserIntent): Promise<F21ConversationReadModel> {
    const parsed = f21UserIntentSchema.parse(input);
    if (parsed.mode !== "READ_ONLY_CONVERSATION")
      throw new Error("F21_MODE_MISMATCH");
    assertSafeUserText(parsed.message);
    return this.runReadOnly(parsed);
  }

  public async requestRevision(
    input: F21UserIntent,
  ): Promise<F21ConversationReadModel> {
    const parsed = f21UserIntentSchema.parse(input);
    if (parsed.mode !== "REVIEW_REVISION") throw new Error("F21_MODE_MISMATCH");
    assertSafeUserText(parsed.message);
    return this.runRevision(parsed);
  }

  public async cancel(input: {
    readonly bundleId: string;
    readonly operationId?: string;
    readonly turnId?: string;
  }): Promise<F21ConversationReadModel> {
    const bundle = this.requireBundle(input.bundleId);
    const turns = this.options.persistence.listTurns(input.bundleId);
    const operationId = input.operationId ?? turns.at(-1)?.operationId;
    if (operationId !== undefined) {
      const result = await this.options.aiWork.cancel(operationId);
      const latest = [...turns]
        .reverse()
        .find((turn) => turn.operationId === operationId);
      if (result !== undefined && latest !== undefined)
        return this.persistResult({
          bundle,
          mode: latest.mode,
          message: latest.userMessage,
          result,
          revisionId:
            latest.mode === "REVIEW_REVISION"
              ? id("f21-cancel-revision")
              : undefined,
        });
    }
    return this.read(bundle.bundleId);
  }

  public async continue(input: {
    readonly bundleId: string;
    readonly operationId: string;
    readonly selectedBudget?: number;
    readonly expectedBundleVersion?: number;
  }): Promise<F21ConversationReadModel> {
    const bundle = this.requireBundle(input.bundleId);
    if (
      input.expectedBundleVersion !== undefined &&
      input.expectedBundleVersion !== bundle.version
    )
      throw new Error("F21_BUNDLE_VERSION_CONFLICT");
    const turns = this.options.persistence.listTurns(input.bundleId);
    const latest = [...turns]
      .reverse()
      .find((turn) => turn.operationId === input.operationId);
    if (latest === undefined) throw new Error("F21_OPERATION_NOT_FOUND");
    await this.assertF22MutationAllowed(input.bundleId, {
      continuation: true,
    });
    const continuationIntent =
      latest.mode === "REVIEW_REVISION"
        ? this.continuationIntent(bundle, latest.turnId, latest.userMessage)
        : undefined;
    let continuationInspection: F13InspectionResult | undefined;
    if (latest.mode === "REVIEW_REVISION") {
      try {
        continuationInspection = await this.options.f13.inspectOperation(
          bundle.operationId,
          bundle.bundleId,
          "INSPECTION",
        );
      } catch {
        return this.persistBlockedRevision(
          bundle,
          continuationIntent as F21UserIntent,
          undefined,
          reason(
            "F21_WORKTREE_INSPECTION_FAILED",
            "The operation worktree could not be freshly inspected for continuation.",
            "RECONCILE_WORKTREE",
          ),
        );
      }
      const blocked = this.revisionGate(
        continuationInspection,
        continuationIntent as F21UserIntent,
      );
      if (blocked !== undefined)
        return this.persistBlockedRevision(
          bundle,
          continuationIntent as F21UserIntent,
          continuationInspection,
          blocked,
        );
    }
    const confirmation = this.options.aiWork.authorizeContinuation({
      operationId: input.operationId,
      kind: "CONTINUE_AI_WORK",
      selectedBudget: input.selectedBudget,
    });
    let revisionBundle = bundle;
    if (latest.mode === "REVIEW_REVISION") {
      try {
        revisionBundle = this.options.bundles.beginReviewRevision({
          bundleId: bundle.bundleId,
          expectedVersion: bundle.version,
        });
      } catch {
        return this.persistBlockedRevision(
          bundle,
          continuationIntent as F21UserIntent,
          continuationInspection,
          reason(
            "F21_REVISION_ADMISSION_FAILED",
            "The Review Bundle did not accept the continuation admission.",
            "REVIEW_EVIDENCE",
          ),
        );
      }
    }
    let result: F21AIWorkResult;
    try {
      result = await this.options.aiWork.continue({
        operationId: input.operationId,
        confirmation,
      });
    } catch {
      if (continuationIntent === undefined)
        throw new Error("F21_AI_CONTINUATION_FAILED");
      return this.persistBlockedRevision(
        revisionBundle,
        continuationIntent,
        continuationInspection,
        reason(
          "F21_AI_CONTINUATION_FAILED",
          "The explicitly authorized continuation could not be started or reconciled.",
          "REVIEW_EVIDENCE",
        ),
        { finalize: true, operationId: input.operationId },
      );
    }
    return await this.persistResult({
      bundle: revisionBundle,
      mode: latest.mode,
      message: latest.userMessage,
      result,
      revisionId:
        latest.mode === "REVIEW_REVISION" ? id("f21-revision") : undefined,
    });
  }

  public async startNewOperation(
    input: F21UserIntent,
  ): Promise<F21ConversationReadModel> {
    const parsed = f21UserIntentSchema.parse(input);
    if (parsed.mode !== "REVIEW_REVISION") throw new Error("F21_MODE_MISMATCH");
    if (parsed.priorOperationId === undefined)
      throw new Error("F21_PRIOR_OPERATION_REQUIRED");
    assertSafeUserText(parsed.message);
    let bundle = this.requireBundle(parsed.bundleId);
    this.ensureReadModel(bundle);
    this.assertBundleVersion(bundle, parsed);
    await this.assertF22MutationAllowed(parsed.bundleId);
    if (!bundle.decisionSummary.complete)
      throw new Error("F21_REVIEW_DECISIONS_REQUIRED");
    const priorTurn = [...this.options.persistence.listTurns(parsed.bundleId)]
      .reverse()
      .find((turn) => turn.operationId === parsed.priorOperationId);
    if (priorTurn === undefined) throw new Error("F21_OPERATION_NOT_FOUND");
    const operationId = `f21-revision-${parsed.intentId}`;
    const admitted = this.admitIntentAndMessage(
      { ...parsed, decisionSnapshot: bundle.items },
      operationId,
      "REVIEW_REVISION",
    );
    if (!admitted) return this.read(parsed.bundleId);
    let inspection: F13InspectionResult;
    try {
      inspection = await this.options.f13.inspectOperation(
        bundle.operationId,
        bundle.bundleId,
        "INSPECTION",
      );
    } catch {
      return this.persistBlockedRevision(
        bundle,
        input,
        undefined,
        reason(
          "F21_WORKTREE_INSPECTION_FAILED",
          "The operation worktree could not be freshly inspected.",
          "RECONCILE_WORKTREE",
        ),
      );
    }
    const blocked = this.revisionGate(inspection, parsed);
    if (blocked !== undefined)
      return this.persistBlockedRevision(bundle, parsed, inspection, blocked);
    let handoff: Awaited<ReturnType<F18F13Port["getProviderWorktreeHandoff"]>>;
    try {
      handoff = await this.options.f13.getProviderWorktreeHandoff({
        operationId: bundle.operationId,
        ownerId: bundle.bundleId,
      });
    } catch {
      return this.persistBlockedRevision(
        bundle,
        input,
        inspection,
        reason(
          "F21_WORKTREE_HANDOFF_UNAVAILABLE",
          "The operation worktree could not be handed to the revision turn.",
          "RECONCILE_WORKTREE",
        ),
      );
    }
    if (!handoff.ok || handoff.handoff === undefined)
      return this.persistBlockedRevision(
        bundle,
        parsed,
        inspection,
        reason(
          "F21_WORKTREE_HANDOFF_UNAVAILABLE",
          "The operation worktree could not be handed to the new revision turn.",
          "RECONCILE_WORKTREE",
        ),
      );
    let taskSnapshot: Awaited<ReturnType<F18F16Port["resolveTask"]>>;
    try {
      taskSnapshot = await this.options.f16.resolveTask({
        taskType: "REVIEW_REVISION",
        phase: "REVIEW_REVISION",
        repository: repositoryIdentity(bundle.input),
        operationId: bundle.operationId,
        operationWorktree: {
          operationId: inspection.worktree.operationId,
          canonicalPath: inspection.worktree.canonicalPath,
          rootRevision: inspection.worktree.rootRevision,
        },
        ...(bundle.input.contextText === undefined
          ? {}
          : { prIntentContext: bundle.input.contextText }),
      });
    } catch {
      return this.persistBlockedRevision(
        bundle,
        input,
        inspection,
        reason(
          "F21_SNAPSHOT_RESOLUTION_FAILED",
          "The immutable Review Revision configuration could not be resolved.",
          "REVIEW_EVIDENCE",
        ),
      );
    }
    const provider = providerInput(bundle, parsed.message);
    let confirmation: AIWorkContinuation;
    try {
      confirmation = this.options.aiWork.authorizeContinuation({
        operationId: parsed.priorOperationId,
        kind: "START_NEW_OPERATION",
        selectedBudget: parsed.selectedBudget,
        snapshotId: taskSnapshot.snapshotId,
      });
    } catch {
      return this.persistBlockedRevision(
        bundle,
        parsed,
        inspection,
        reason(
          "F21_NEW_OPERATION_AUTHORIZATION_FAILED",
          "The prior AI operation did not accept a new explicit budget.",
          "REVIEW_EVIDENCE",
        ),
      );
    }
    try {
      bundle = this.options.bundles.beginReviewRevision({
        bundleId: bundle.bundleId,
        expectedVersion: bundle.version,
        actionId: parsed.actionId,
      });
    } catch {
      return this.persistBlockedRevision(
        bundle,
        parsed,
        inspection,
        reason(
          "F21_REVISION_ADMISSION_FAILED",
          "The Review Bundle did not accept the new revision admission.",
          "REVIEW_EVIDENCE",
        ),
      );
    }
    const revisionRequest = f21RevisionRequestSchema.parse({
      schemaVersion: 1,
      revisionId: parsed.intentId,
      bundleId: bundle.bundleId,
      operationId,
      message: parsed.message,
      decisions: bundle.items,
      expectedBundleVersion: bundle.version,
      expectedEvidenceRevision:
        parsed.expectedEvidenceRevision ??
        inspection.condition.currentFingerprint,
      ...(parsed.acknowledgeUnattributedChanges === undefined
        ? {}
        : {
            acknowledgeUnattributedChanges:
              parsed.acknowledgeUnattributedChanges,
          }),
      createdAt: now(this.options.clock),
    });
    let result: F21AIWorkResult;
    try {
      result = await this.options.aiWork.startNewOperation({
        mode: "REVIEW_REVISION",
        operationId,
        priorOperationId: parsed.priorOperationId,
        confirmation,
        f13OperationId: bundle.operationId,
        ownerId: bundle.bundleId,
        bundleId: bundle.bundleId,
        taskSnapshot,
        input: provider,
        revisionRequest,
        worktree: handoff.handoff,
        ...(parsed.acknowledgeUnattributedChanges === undefined
          ? {}
          : {
              acknowledgeUnattributedChanges:
                parsed.acknowledgeUnattributedChanges,
            }),
        configuredTurnBudget: parsed.selectedBudget ?? 1,
      });
    } catch {
      return this.persistBlockedRevision(
        bundle,
        parsed,
        inspection,
        reason(
          "F21_AI_WORK_START_FAILED",
          "The new bounded Review Revision operation could not be started or reconciled.",
          "REVIEW_EVIDENCE",
        ),
        { finalize: true, operationId },
      );
    }
    return await this.persistResult({
      bundle,
      mode: "REVIEW_REVISION",
      message: parsed.message,
      result,
      revisionId: parsed.intentId,
      inspection,
    });
  }

  public async reconcileStartup(): Promise<readonly unknown[]> {
    const reconciled = await this.options.aiWork.reconcileStartup();
    for (const readModel of reconciled) {
      const turn = this.options.persistence
        .listTurnsForOperation(readModel.operation.operationId)
        .at(-1);
      if (turn === undefined) continue;
      const bundle = this.options.bundles.getReadModel(turn.bundleId);
      if (bundle === undefined) continue;
      await this.persistResult({
        bundle,
        mode: turn.mode,
        message: turn.userMessage,
        result: {
          readModel,
          summary: summaryFromAIWork(readModel),
          progress: [],
        },
        revisionId:
          turn.mode === "REVIEW_REVISION"
            ? id("f21-restart-revision")
            : undefined,
      });
    }
    return reconciled;
  }

  private async runReadOnly(
    input: F21UserIntent,
  ): Promise<F21ConversationReadModel> {
    const bundle = this.requireBundle(input.bundleId);
    this.ensureReadModel(bundle);
    this.assertBundleVersion(bundle, input);
    const operationId = `f21-conversation-${input.intentId}`;
    const taskSnapshot = await this.options.f16.resolveTask({
      taskType: "READ_ONLY_CONVERSATION",
      phase: "READ_ONLY_CONVERSATION",
      repository: repositoryIdentity(bundle.input),
      ...(bundle.input.contextText === undefined
        ? {}
        : { prIntentContext: bundle.input.contextText }),
    });
    const provider = providerInput(bundle, input.message, input.conversationId);
    const admitted = this.admitIntentAndMessage(
      input,
      operationId,
      "READ_ONLY_CONVERSATION",
    );
    if (!admitted) return this.read(input.bundleId);
    let result: F21AIWorkResult;
    try {
      result = await this.options.aiWork.run({
        mode: "READ_ONLY_CONVERSATION",
        operationId,
        ownerId: bundle.bundleId,
        bundleId: bundle.bundleId,
        taskSnapshot,
        input: provider,
        configuredTurnBudget: 1,
      });
    } catch {
      return this.persistConversationFailure(
        bundle,
        input,
        reason(
          "F21_READ_ONLY_TURN_FAILED",
          "The bounded read-only conversation turn could not be started or reconciled.",
          "REVIEW_EVIDENCE",
        ),
      );
    }
    return await this.persistResult({
      bundle,
      mode: "READ_ONLY_CONVERSATION",
      message: input.message,
      result,
      conversationReference: result.conversationReference,
    });
  }

  private async runRevision(
    input: F21UserIntent,
  ): Promise<F21ConversationReadModel> {
    let bundle = this.requireBundle(input.bundleId);
    this.ensureReadModel(bundle);
    this.assertBundleVersion(bundle, input);
    await this.assertF22MutationAllowed(input.bundleId);
    if (!bundle.decisionSummary.complete)
      throw new Error("F21_REVIEW_DECISIONS_REQUIRED");
    const operationId = `f21-revision-${input.intentId}`;
    const admitted = this.admitIntentAndMessage(
      { ...input, decisionSnapshot: bundle.items },
      operationId,
      "REVIEW_REVISION",
    );
    if (!admitted) return this.read(input.bundleId);
    let inspection: F13InspectionResult;
    try {
      inspection = await this.options.f13.inspectOperation(
        bundle.operationId,
        bundle.bundleId,
        "INSPECTION",
      );
    } catch {
      return this.persistBlockedRevision(
        bundle,
        input,
        undefined,
        reason(
          "F21_WORKTREE_INSPECTION_FAILED",
          "The operation worktree could not be freshly inspected.",
          "RECONCILE_WORKTREE",
        ),
      );
    }
    const blocked = this.revisionGate(inspection, input);
    if (blocked !== undefined)
      return this.persistBlockedRevision(bundle, input, inspection, blocked);
    let handoff: Awaited<ReturnType<F18F13Port["getProviderWorktreeHandoff"]>>;
    try {
      handoff = await this.options.f13.getProviderWorktreeHandoff({
        operationId: bundle.operationId,
        ownerId: bundle.bundleId,
      });
    } catch {
      return this.persistBlockedRevision(
        bundle,
        input,
        inspection,
        reason(
          "F21_WORKTREE_HANDOFF_UNAVAILABLE",
          "The operation worktree could not be handed to the revision turn.",
          "RECONCILE_WORKTREE",
        ),
      );
    }
    if (!handoff.ok || handoff.handoff === undefined)
      return this.persistBlockedRevision(
        bundle,
        input,
        inspection,
        reason(
          "F21_WORKTREE_HANDOFF_UNAVAILABLE",
          "The operation worktree could not be handed to the revision turn.",
          "RECONCILE_WORKTREE",
        ),
      );
    let taskSnapshot: Awaited<ReturnType<F18F16Port["resolveTask"]>>;
    try {
      taskSnapshot = await this.options.f16.resolveTask({
        taskType: "REVIEW_REVISION",
        phase: "REVIEW_REVISION",
        repository: repositoryIdentity(bundle.input),
        operationId: bundle.operationId,
        operationWorktree: {
          operationId: inspection.worktree.operationId,
          canonicalPath: inspection.worktree.canonicalPath,
          rootRevision: inspection.worktree.rootRevision,
        },
        ...(bundle.input.contextText === undefined
          ? {}
          : { prIntentContext: bundle.input.contextText }),
      });
    } catch {
      return this.persistBlockedRevision(
        bundle,
        input,
        inspection,
        reason(
          "F21_SNAPSHOT_RESOLUTION_FAILED",
          "The immutable Review Revision configuration could not be resolved.",
          "REVIEW_EVIDENCE",
        ),
      );
    }
    const provider = providerInput(bundle, input.message);
    try {
      bundle = this.options.bundles.beginReviewRevision({
        bundleId: bundle.bundleId,
        expectedVersion: input.expectedBundleVersion ?? bundle.version,
        actionId: input.actionId,
      });
    } catch {
      return this.persistBlockedRevision(
        bundle,
        input,
        inspection,
        reason(
          "F21_REVISION_ADMISSION_FAILED",
          "The Review Bundle did not accept the revision admission.",
          "REVIEW_EVIDENCE",
        ),
      );
    }
    const revisionRequest = f21RevisionRequestSchema.parse({
      schemaVersion: 1,
      revisionId: input.intentId,
      bundleId: bundle.bundleId,
      operationId,
      message: input.message,
      decisions: bundle.items,
      expectedBundleVersion: bundle.version,
      expectedEvidenceRevision:
        input.expectedEvidenceRevision ??
        inspection.condition.currentFingerprint,
      ...(input.acknowledgeUnattributedChanges === undefined
        ? {}
        : {
            acknowledgeUnattributedChanges:
              input.acknowledgeUnattributedChanges,
          }),
      createdAt: now(this.options.clock),
    });
    let result: F21AIWorkResult;
    try {
      result = await this.options.aiWork.run({
        mode: "REVIEW_REVISION",
        operationId,
        f13OperationId: bundle.operationId,
        ownerId: bundle.bundleId,
        bundleId: bundle.bundleId,
        taskSnapshot,
        input: provider,
        revisionRequest,
        worktree: handoff.handoff,
        ...(input.acknowledgeUnattributedChanges === undefined
          ? {}
          : {
              acknowledgeUnattributedChanges:
                input.acknowledgeUnattributedChanges,
            }),
        configuredTurnBudget: 1,
      });
    } catch {
      return this.persistBlockedRevision(
        bundle,
        input,
        inspection,
        reason(
          "F21_AI_WORK_START_FAILED",
          "The bounded Review Revision turn could not be started or reconciled.",
          "REVIEW_EVIDENCE",
        ),
        { finalize: true, operationId },
      );
    }
    return await this.persistResult({
      bundle,
      mode: "REVIEW_REVISION",
      message: input.message,
      result,
      revisionId: input.intentId,
      inspection,
    });
  }

  private async persistResult(input: {
    readonly bundle: F18ReviewBundleReadModel;
    readonly mode: F21ConversationMode;
    readonly message: string;
    readonly result: F21AIWorkResult;
    readonly conversationReference?: AIProviderConversationReference;
    readonly revisionId?: string;
    readonly inspection?: F13InspectionResult;
  }): Promise<F21ConversationReadModel> {
    const timestamp = now(this.options.clock);
    const turn = f21TurnFromAIWork({
      bundleId: input.bundle.bundleId,
      mode: input.mode,
      userMessage: input.message,
      readModel: input.result.readModel,
      ...(input.result.answer === undefined
        ? {}
        : { answer: input.result.answer }),
      ...(input.result.explanation === undefined
        ? {}
        : { explanation: input.result.explanation }),
      ...(input.result.nextStep === undefined
        ? {}
        : { nextStep: input.result.nextStep }),
      ...(input.result.implementation === undefined
        ? {}
        : { implementation: input.result.implementation }),
      ...(input.conversationReference === undefined
        ? {}
        : { conversationReference: input.conversationReference }),
      progress: input.result.progress,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    this.options.persistence.recordTurn(turn);
    const assistantText =
      input.result.answer ??
      input.result.implementation?.summary ??
      input.result.readModel.stopReason?.what ??
      "The AI turn needs attention.";
    this.options.persistence.recordMessage(
      f21ConversationMessageSchema.parse({
        schemaVersion: 1,
        messageId: `${turn.turnId}-assistant`,
        bundleId: input.bundle.bundleId,
        turnId: turn.turnId,
        role: "assistant",
        mode: input.mode,
        text: assistantText,
        createdAt: timestamp,
      }),
    );
    let lastRevision: F21ReviewRevisionOutcome | undefined;
    if (input.mode === "REVIEW_REVISION" && input.revisionId !== undefined) {
      const after = await awaitInspection(
        this.options.f13,
        input.bundle.operationId,
        input.bundle.bundleId,
      );
      const evidence = after === undefined ? input.inspection : after;
      const worktree =
        evidence === undefined ? undefined : worktreeEvidence(evidence);
      const validation = input.result.validation;
      const validationRequired =
        input.result.readModel.operation.taskSnapshot?.buildValidation !==
        undefined;
      const attention =
        input.result.implementation === undefined ||
        input.result.summary.attention ||
        validationBlocks(validation, validationRequired) ||
        evidence?.ok !== true;
      const reasons = [
        ...(input.result.implementation === undefined
          ? [
              reason(
                "F21_IMPLEMENTATION_RESULT_MISSING",
                "The revision did not return a structured implementation result.",
                "REVIEW_EVIDENCE",
              ),
            ]
          : []),
        ...(input.result.summary.attention
          ? [
              reason(
                "F21_REVISION_NEEDS_ATTENTION",
                "The bounded revision turn stopped with attention evidence.",
                "REVIEW_EVIDENCE",
              ),
            ]
          : []),
        ...(validationBlocks(validation, validationRequired)
          ? [
              reason(
                "F21_VALIDATION_NOT_READY",
                "Post-change validation is not passing.",
                "REVIEW_EVIDENCE",
              ),
            ]
          : []),
        ...(evidence?.ok !== true
          ? [
              reason(
                "F21_WORKTREE_REVALIDATION_FAILED",
                "F13 could not revalidate the actual worktree state.",
                "RECONCILE_WORKTREE",
              ),
            ]
          : []),
      ];
      const finalized = this.options.bundles.finalizeReviewRevision({
        bundleId: input.bundle.bundleId,
        revisionId: input.revisionId,
        operationId: input.result.readModel.operation.operationId,
        ...(input.result.implementation === undefined
          ? {}
          : { implementation: input.result.implementation }),
        implementationWork: input.result.summary,
        ...(worktree === undefined ? {} : { worktree }),
        ...(validation === undefined
          ? {}
          : { postChangeValidation: validation }),
        changedFiles:
          input.result.readModel.reports
            .at(-1)
            ?.actualChangedFiles.map((file) => file.path) ?? [],
        state: attention ? "NEEDS_ATTENTION" : "READY_FOR_REVIEW",
        reasons,
        expectedVersion: input.bundle.version,
      });
      const outcome = f21RevisionOutcomeSchema.parse({
        schemaVersion: 1,
        revisionId: input.revisionId,
        bundleId: input.bundle.bundleId,
        operationId: input.result.readModel.operation.operationId,
        status: finalized.state,
        ...(input.result.implementation === undefined
          ? {}
          : { implementation: input.result.implementation }),
        ...(worktree?.condition === undefined
          ? {}
          : { worktreeCondition: worktree.condition }),
        ...(validation === undefined ? {} : { validation }),
        changedFiles: worktree?.changedFiles ?? [],
        reasons: reasons.map((entry) => entry.what),
        createdAt: timestamp,
      });
      lastRevision = outcome;
    }
    const freshBundle = this.requireBundle(input.bundle.bundleId);
    const base = f21ReadModelFromBundle(freshBundle, {
      messages: [
        ...this.options.persistence.listMessages(freshBundle.bundleId),
      ],
      turns: [...this.options.persistence.listTurns(freshBundle.bundleId)],
      proposalInputs: [
        ...this.options.persistence.listProposalInputs(freshBundle.bundleId),
      ],
      ...(activeFromAI(input.mode, input.result.readModel) === undefined
        ? {}
        : {
            activeOperation: activeFromAI(input.mode, input.result.readModel),
          }),
      ...(lastRevision === undefined ? {} : { lastRevision }),
      selectedMode: input.mode,
    });
    this.options.persistence.saveReadModel({
      readModel: base,
      expectedBundleVersion: this.options.persistence.get(base.bundleId)
        ?.bundleVersion,
    });
    return this.read(base.bundleId);
  }

  private persistBlockedRevision(
    bundle: F18ReviewBundleReadModel,
    input: F21UserIntent,
    inspection: F13InspectionResult | undefined,
    blocked: F18Reason,
    options: {
      readonly finalize?: boolean;
      readonly operationId?: string;
    } = {},
  ): F21ConversationReadModel {
    const timestamp = now(this.options.clock);
    const admittedTurn = this.options.persistence
      .listTurns(bundle.bundleId)
      .find((turn) => turn.turnId === input.intentId);
    if (admittedTurn !== undefined) {
      this.options.persistence.recordTurn({
        ...admittedTurn,
        status: "NEEDS_ATTENTION",
        deterministicProblems: [blocked.what],
        remainingProblems: [blocked.what],
        updatedAt: timestamp,
      });
      this.options.persistence.recordMessage(
        f21ConversationMessageSchema.parse({
          schemaVersion: 1,
          messageId: `${input.intentId}-assistant`,
          bundleId: bundle.bundleId,
          turnId: input.intentId,
          role: "assistant",
          mode: "REVIEW_REVISION",
          text: blocked.what,
          createdAt: timestamp,
        }),
      );
    }
    const evidence =
      inspection === undefined ? undefined : worktreeEvidence(inspection);
    let outcomeBundle = bundle;
    if (options.finalize === true) {
      const current =
        this.options.bundles.getReadModel(bundle.bundleId) ?? bundle;
      try {
        outcomeBundle = this.options.bundles.finalizeReviewRevision({
          bundleId: bundle.bundleId,
          revisionId: input.intentId,
          operationId: options.operationId ?? bundle.operationId,
          implementationWork: failedWorkSummary(
            options.operationId ?? bundle.operationId,
          ),
          ...(evidence === undefined ? {} : { worktree: evidence }),
          changedFiles: evidence?.changedFiles ?? [],
          state: "NEEDS_ATTENTION",
          reasons: [blocked],
          expectedVersion: current.version,
          ...(input.actionId === undefined ? {} : { actionId: input.actionId }),
        });
      } catch {
        // A finalization failure must not overwrite the last committed bundle;
        // the durable F21 attention record remains the reconciliation signal.
        outcomeBundle = current;
      }
    }
    const outcome = f21RevisionOutcomeSchema.parse({
      schemaVersion: 1,
      revisionId: input.intentId,
      bundleId: bundle.bundleId,
      operationId: options.operationId ?? bundle.operationId,
      status: "NEEDS_ATTENTION",
      ...(evidence === undefined
        ? {}
        : { worktreeCondition: evidence.condition }),
      changedFiles: evidence?.changedFiles ?? [],
      reasons: [blocked.what],
      createdAt: timestamp,
    });
    const base = f21ReadModelFromBundle(outcomeBundle, {
      messages: [...this.options.persistence.listMessages(bundle.bundleId)],
      turns: [...this.options.persistence.listTurns(bundle.bundleId)],
      proposalInputs: [
        ...this.options.persistence.listProposalInputs(bundle.bundleId),
      ],
      lastRevision: outcome,
    });
    this.options.persistence.saveReadModel({
      readModel: base,
      expectedBundleVersion: this.options.persistence.get(base.bundleId)
        ?.bundleVersion,
    });
    return this.read(bundle.bundleId);
  }

  private persistConversationFailure(
    bundle: F18ReviewBundleReadModel,
    input: F21UserIntent,
    failure: F18Reason,
  ): F21ConversationReadModel {
    const timestamp = now(this.options.clock);
    const admittedTurn = this.options.persistence
      .listTurns(bundle.bundleId)
      .find((turn) => turn.turnId === input.intentId);
    if (admittedTurn !== undefined) {
      this.options.persistence.recordTurn({
        ...admittedTurn,
        status: "NEEDS_ATTENTION",
        deterministicProblems: [failure.what],
        remainingProblems: [failure.what],
        updatedAt: timestamp,
      });
      this.options.persistence.recordMessage(
        f21ConversationMessageSchema.parse({
          schemaVersion: 1,
          messageId: `${input.intentId}-assistant`,
          bundleId: bundle.bundleId,
          turnId: input.intentId,
          role: "assistant",
          mode: "READ_ONLY_CONVERSATION",
          text: failure.what,
          createdAt: timestamp,
        }),
      );
    }
    const base = f21ReadModelFromBundle(bundle, {
      messages: [...this.options.persistence.listMessages(bundle.bundleId)],
      turns: [...this.options.persistence.listTurns(bundle.bundleId)],
      proposalInputs: [
        ...this.options.persistence.listProposalInputs(bundle.bundleId),
      ],
      selectedMode: "READ_ONLY_CONVERSATION",
    });
    this.options.persistence.saveReadModel({
      readModel: base,
      expectedBundleVersion: this.options.persistence.get(base.bundleId)
        ?.bundleVersion,
    });
    return base;
  }

  private continuationIntent(
    bundle: F18ReviewBundleReadModel,
    turnId: string,
    message: string,
  ): F21UserIntent {
    return f21UserIntentSchema.parse({
      schemaVersion: 1,
      intentId: turnId,
      bundleId: bundle.bundleId,
      mode: "REVIEW_REVISION",
      message,
      expectedBundleVersion: bundle.version,
      expectedEvidenceRevision:
        bundle.worktree?.snapshotId ?? `bundle-${bundle.version}`,
      idempotencyKey: `f21-continuation-${turnId}`,
      createdAt: now(this.options.clock),
    });
  }

  private admitIntentAndMessage(
    input: F21UserIntent,
    operationId: string,
    mode: F21ConversationMode,
  ): boolean {
    const intent = f21UserIntentSchema.parse(input);
    const admitted = this.options.persistence.recordIntent(intent);
    if (!admitted.created) return false;
    const timestamp = now(this.options.clock);
    const turnId = intent.intentId;
    const turn = f21ConversationTurnRecordSchema.parse({
      schemaVersion: 1,
      turnId,
      bundleId: intent.bundleId,
      mode,
      status: "ADMITTED",
      operationId,
      userMessage: intent.message,
      progress: [],
      deterministicProblems: [],
      remainingProblems: [],
      reportRevision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    this.options.persistence.recordTurn(turn);
    this.options.persistence.recordMessage(
      f21ConversationMessageSchema.parse({
        schemaVersion: 1,
        messageId: `${intent.intentId}-user`,
        bundleId: intent.bundleId,
        turnId,
        role: "user",
        mode,
        text: intent.message,
        createdAt: timestamp,
      }),
    );
    return true;
  }

  private ensureReadModel(
    bundle: F18ReviewBundleReadModel,
  ): F21ConversationReadModel {
    const existing = this.options.persistence.get(bundle.bundleId);
    if (existing !== undefined) return existing;
    const model = f21ReadModelFromBundle(bundle);
    return this.options.persistence.saveReadModel({ readModel: model });
  }

  private readF22Gate(
    bundleId: string,
    activeOperation?: ActiveOperationProjection,
  ): F22ActionGate | undefined {
    return this.options.f22?.readGate(bundleId, {
      skipActiveOperation: true,
      ...(activeOperation === undefined
        ? {}
        : {
            activeOperationOverride: {
              operationId: activeOperation.operationId,
              status: activeOperation.status,
            },
          }),
    });
  }

  private async assertF22MutationAllowed(
    bundleId: string,
    options: { readonly continuation?: boolean } = {},
  ): Promise<F22ActionGate | undefined> {
    if (this.options.f22 === undefined) return undefined;
    const gate =
      this.options.f22.observeRemoteHead === undefined
        ? this.readF22Gate(bundleId)
        : await this.options.f22.observeRemoteHead(bundleId, {
            skipActiveOperation: true,
          });
    if (gate === undefined) return undefined;
    const current =
      gate.status === "CURRENT" &&
      gate.remote.observationRevision !== undefined;
    if (
      !current ||
      (options.continuation === true && !gate.actions.continueOldWork)
    )
      throw new Error("F22_ACTION_GATED");
    return gate;
  }

  private requireBundle(bundleId: string): F18ReviewBundleReadModel {
    const bundle = this.options.bundles.getReadModel(bundleId);
    if (bundle === undefined) throw new Error("F21_BUNDLE_NOT_FOUND");
    return f18ReviewBundleReadModelSchema.parse(bundle);
  }

  private assertBundleVersion(
    bundle: F18ReviewBundleReadModel,
    input: F21UserIntent,
  ): void {
    if (
      input.expectedBundleVersion !== undefined &&
      input.expectedBundleVersion !== bundle.version
    )
      throw new Error("F21_BUNDLE_VERSION_CONFLICT");
    const currentEvidence =
      bundle.worktree?.snapshotId ?? `bundle-${bundle.version}`;
    if (
      input.expectedEvidenceRevision !== undefined &&
      input.expectedEvidenceRevision !== currentEvidence &&
      input.mode === "REVIEW_REVISION"
    )
      throw new Error("F21_EVIDENCE_REVISION_CONFLICT");
  }

  private revisionGate(
    inspection: F13InspectionResult,
    input: F21UserIntent,
  ): F18Reason | undefined {
    if (!inspection.ok)
      return reason(
        "F21_WORKTREE_INSPECTION_FAILED",
        "The operation worktree could not be freshly inspected.",
        "RECONCILE_WORKTREE",
      );
    switch (inspection.condition.classification) {
      case "CLEAN":
      case "AI_ATTRIBUTED_ONLY":
        return undefined;
      case "UNATTRIBUTED_CHANGES":
        return input.acknowledgeUnattributedChanges === true
          ? undefined
          : reason(
              "F21_UNATTRIBUTED_CHANGES_ACK_REQUIRED",
              "The worktree contains changes not attributed to this operation.",
              "REQUEST_WORKTREE_DECISION",
            );
      case "MIXED_OR_OVERLAP":
        return reason(
          "F21_MIXED_OR_OVERLAP_BLOCKED",
          "The worktree contains mixed or overlapping changes.",
          "RECONCILE_WORKTREE",
        );
      case "STALE_OR_UNKNOWN":
        return reason(
          "F21_STALE_WORKTREE_BLOCKED",
          "The worktree head or attribution evidence is stale or unknown.",
          "RECONCILE_WORKTREE",
        );
    }
  }
}

async function awaitInspection(
  f13: F18F13Port,
  operationId: string,
  ownerId: string,
): Promise<F13InspectionResult | undefined> {
  try {
    return await f13.inspectOperation(operationId, ownerId, "INSPECTION");
  } catch {
    return undefined;
  }
}
