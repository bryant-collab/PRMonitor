import { randomUUID } from "node:crypto";
import {
  assertAIReviewImplementationDecisionCoverage,
  assertAIReviewProposalEventCoverage,
  type AIProviderInputSnapshot,
  type AIReviewProposal,
} from "../shared/ai/provider-contracts";
import type {
  F16EffectiveAITaskSnapshot,
  F16RepositoryIdentity,
} from "../shared/f16-preferences";
import type { F16ResolveTaskInput } from "./f16-preferences-service";
import type {
  F13InspectionResult,
  F13PreparationResult,
  F13ProviderWorktreeHandoff,
  F13ProviderWorktreeHandoffResult,
  F13ReviewOperationRequest,
} from "../shared/f13-contracts";
import type {
  F14ValidationExecutionResult,
  F14ValidationReadModel,
} from "./f14-validation-runner";
import type {
  F11AutomaticClaimRecord,
  F11HoldRecord,
} from "./persistence/f11-repositories";
import type { F12SchedulerSnapshot } from "../shared/control-plane";
import type { ManagedPrReadModel } from "../shared/managed-pr";
import {
  validationWarning,
  type ValidationResolution,
} from "@prmonitor/validation-contract";
import {
  f18BundleItemSchema,
  f18FeedbackSnapshotSchema,
  f18ItemDecisionSchema,
  f18ReviewBundleRecordSchema,
  f18ReviewBundleReadModelSchema,
  f18ReviewInputSnapshotSchema,
  f18TaskSnapshotRefSchema,
  type F18AiWorkResult,
  type F18AutomaticReviewHandoff,
  type F18BundleItem,
  type F18DecisionInput,
  type F18FeedbackSnapshot,
  type F18Reason,
  type F18ReviewBundleReadModel,
  type F18ReviewBundleRecord,
  type F18ReviewInputSnapshot,
  type F18ValidationEvidence,
  type F18WorktreeEvidence,
  reviewBundleDecisionSummary,
} from "../shared/f18-automatic-review";
import type { F18BundlePersistencePort } from "./persistence/f18-repositories";

export interface F18ManagedPrPort {
  readonly getManagedPr: (
    managedPrId: string,
  ) => ManagedPrReadModel | undefined;
}

export interface F18EventVersion {
  readonly eventVersionId: string;
  readonly managedPrId: string;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly observedAt: string;
  readonly semanticHash: string;
  readonly payload: unknown;
}

export interface F18EventPort {
  readonly getEventVersion: (
    managedPrId: string,
    eventVersionId: string,
  ) => F18EventVersion | undefined;
}

export interface F18ClaimPort {
  readonly getClaim: (claimId: string) => F11AutomaticClaimRecord | undefined;
  readonly getActiveClaim: (
    managedPrId: string,
  ) => F11AutomaticClaimRecord | undefined;
  readonly getActiveHold: (managedPrId: string) => F11HoldRecord | undefined;
}

export interface F18SchedulerPort {
  readonly read: () => F12SchedulerSnapshot;
}

export interface F18F13Port {
  readonly prepareReview: (
    input: F13ReviewOperationRequest,
  ) => Promise<F13PreparationResult>;
  readonly inspectOperation: (
    operationId: string,
    ownerId: string,
    phase?: "PREPARE" | "INSPECTION" | "BEFORE_AI" | "AFTER_AI",
  ) => Promise<F13InspectionResult>;
  readonly getProviderWorktreeHandoff: (input: {
    readonly operationId: string;
    readonly ownerId: string;
  }) => Promise<F13ProviderWorktreeHandoffResult>;
}

export interface F18F14Port {
  readonly run: (
    input: Parameters<
      (input: {
        readonly operationId: string;
        readonly runId?: string;
        readonly idempotencyKey?: string;
        readonly correlationId: string;
        readonly ownerType: string;
        readonly ownerId: string;
        readonly consumer: "review" | "synchronization";
        readonly requestedPhase: "baseline" | "post_change" | "both";
        readonly resolution: ValidationResolution;
      }) => Promise<F14ValidationExecutionResult>
    >[0],
  ) => Promise<F14ValidationExecutionResult>;
  readonly readModel: (runId: string) => F14ValidationReadModel | undefined;
  readonly recordNoImplementationChanges?: (input: {
    readonly operationId: string;
    readonly runId: string;
    readonly correlationId: string;
    readonly ownerType: string;
    readonly ownerId: string;
  }) => Promise<F18ValidationEvidence>;
}

export interface F18F16Port {
  readonly resolveTask: (
    input: F16ResolveTaskInput,
  ) => Promise<F16EffectiveAITaskSnapshot>;
}

export interface F18AiWorkInput {
  readonly phase: "proposal" | "implementation";
  readonly operationId: string;
  readonly f13OperationId: string;
  readonly ownerId: string;
  readonly taskSnapshot: F16EffectiveAITaskSnapshot;
  readonly input: AIProviderInputSnapshot;
  readonly worktree: F13ProviderWorktreeHandoff;
}

export interface F18AiWorkPort {
  readonly run: (input: F18AiWorkInput) => Promise<F18AiWorkResult>;
}

export interface F18ValidationPort {
  readonly resolve: (input: {
    readonly repositoryId: string;
    readonly operationId: string;
  }) => ValidationResolution;
}

export interface F18ActivityPort {
  readonly append: (input: {
    readonly eventId: string;
    readonly correlationId: string;
    readonly operationId: string;
    readonly managedPrId: string;
    readonly severity: "INFO" | "WARN" | "ERROR";
    readonly summary: string;
  }) => void;
}

export interface AutomaticReviewCoordinatorOptions {
  readonly persistence: F18BundlePersistencePort;
  readonly managedPrs: F18ManagedPrPort;
  readonly events: F18EventPort;
  readonly claims: F18ClaimPort;
  readonly scheduler: F18SchedulerPort;
  readonly f13: F18F13Port;
  readonly f14: F18F14Port;
  readonly f16: F18F16Port;
  readonly aiWork: F18AiWorkPort;
  readonly validation: F18ValidationPort;
  readonly activity?: F18ActivityPort;
  readonly clock?: () => string;
}

export interface F18AutomaticReviewBoundary {
  readonly startAutomaticReview: (input: F18AutomaticReviewHandoff) => Promise<{
    readonly outcome:
      "ACCEPTED" | "ALREADY_ACCEPTED" | "REJECTED" | "UNCERTAIN";
    readonly reason?: F18Reason;
  }>;
  /** Read-only downstream handoff for F19/F20; it grants no workflow effect. */
  readonly getReadModel?: (
    bundleId: string,
  ) => F18ReviewBundleReadModel | undefined;
}

function now(clock: (() => string) | undefined): string {
  return clock?.() ?? new Date().toISOString();
}

function safeText(value: unknown, fallback: string, maximum = 512): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.slice(0, maximum)
    : fallback;
}

function reason(
  code: string,
  what: string,
  why: string,
  nextAction: string,
): F18Reason {
  return { code, what, why, nextAction };
}

function repositoryIdentity(
  repository:
    ManagedPrReadModel["baseRepository"] | ManagedPrReadModel["headRepository"],
): F16RepositoryIdentity {
  return {
    serverId: repository.server.serverKey,
    owner: repository.owner ?? "unknown-owner",
    name: repository.name ?? "unknown-repository",
    key: repository.key,
  };
}

function f13RepositoryIdentity(
  repository:
    ManagedPrReadModel["baseRepository"] | ManagedPrReadModel["headRepository"],
): F13ReviewOperationRequest["refs"]["baseRepository"] {
  const identity = repositoryIdentity(repository);
  return identity;
}

function taskSnapshotRef(
  snapshot: F16EffectiveAITaskSnapshot,
  worktree?: F18WorktreeEvidence,
) {
  return f18TaskSnapshotRefSchema.parse({
    snapshotId: snapshot.snapshotId,
    snapshotHash: snapshot.snapshotHash,
    taskType: snapshot.taskType,
    phase: snapshot.phase,
    profileId: snapshot.profile.profileId,
    profileRevision: snapshot.profile.revision,
    providerId: snapshot.profile.providerId,
    modelId: snapshot.profile.modelId,
    policyId: snapshot.policy.policyId,
    policyRevision: snapshot.policy.revision,
    effectivePreset: snapshot.policy.effectivePreset,
    sandboxMode: snapshot.policy.sandboxMode,
    approvalPolicy: snapshot.policy.approvalPolicy,
    networkAccess: snapshot.policy.networkAccess,
    commonInstructionIds: snapshot.commonInstructions.map(
      (instruction) => instruction.profileId,
    ),
    ...(snapshot.buildValidation === undefined
      ? {}
      : {
          validationStatus: snapshot.buildValidation.validation.status,
          validationBoundsRevision:
            snapshot.buildValidation.validation.boundsRevision,
        }),
    ...(worktree === undefined
      ? {}
      : {
          operationWorktree: {
            operationId: worktree.operationId,
            canonicalPath: worktree.canonicalPath,
            rootRevision: worktree.rootRevision,
          },
        }),
  });
}

function diffReference(
  diff: F13InspectionResult["proposedDiff"],
): F18WorktreeEvidence["proposedDiff"] | undefined {
  if (diff === undefined) return undefined;
  return {
    diffId: diff.diffId,
    diffHash: diff.diffHash,
    patchHash: diff.patchHash,
    baselineSha: diff.baselineSha,
    ...(diff.currentSha === undefined ? {} : { currentSha: diff.currentSha }),
    fileCount: diff.files.length,
    complete: diff.complete,
  };
}

function worktreeEvidence(
  inspection: F13InspectionResult,
): F18WorktreeEvidence {
  const files = inspection.snapshot?.manifest.files ?? [];
  const changedFiles = files
    .filter((file) => file.worktreeChanged && file.kind !== "ignored")
    .map((file) => file.path);
  const currentSha =
    inspection.snapshot?.manifest.headSha ?? inspection.worktree.currentHeadSha;
  return {
    operationId: inspection.worktree.operationId,
    worktreeId: inspection.worktree.worktreeId,
    ownerType: inspection.worktree.ownerType,
    ownerId: inspection.worktree.ownerId,
    canonicalPath: inspection.worktree.canonicalPath,
    rootRevision: inspection.worktree.rootRevision,
    snapshotId: inspection.snapshot?.snapshotId ?? "f13-inspection-missing",
    baselineSha: inspection.worktree.worktreeBaselineSha,
    ...(currentSha === undefined ? {} : { currentSha }),
    stateFingerprint:
      inspection.snapshot?.stateFingerprint ?? "f13-inspection-missing",
    clean: changedFiles.length === 0,
    complete: inspection.snapshot?.manifest.complete ?? false,
    changedFiles,
    ...(diffReference(inspection.proposedDiff) === undefined
      ? {}
      : { proposedDiff: diffReference(inspection.proposedDiff) }),
    ...(diffReference(inspection.contextDiff) === undefined
      ? {}
      : { contextDiff: diffReference(inspection.contextDiff) }),
  };
}

function feedbackSnapshot(event: F18EventVersion): F18FeedbackSnapshot {
  const payload =
    typeof event.payload === "object" &&
    event.payload !== null &&
    !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : {};
  const location =
    typeof payload.location === "object" &&
    payload.location !== null &&
    !Array.isArray(payload.location)
      ? (payload.location as Record<string, unknown>)
      : {};
  const author =
    typeof payload.author === "object" &&
    payload.author !== null &&
    !Array.isArray(payload.author)
      ? (payload.author as Record<string, unknown>)
      : undefined;
  const authorText =
    typeof author?.login === "string"
      ? author.login
      : typeof author?.name === "string"
        ? author.name
        : typeof payload.author === "string"
          ? payload.author
          : undefined;
  return f18FeedbackSnapshotSchema.parse({
    eventVersionId: event.eventVersionId,
    semanticHash: event.semanticHash,
    sourceKind: event.sourceKind,
    sourceId: event.sourceId,
    observedAt: event.observedAt,
    ...(typeof payload.body === "string"
      ? { body: payload.body.slice(0, 64 * 1024) }
      : {}),
    ...(authorText === undefined ? {} : { author: authorText.slice(0, 512) }),
    ...(typeof location.path === "string" ? { path: location.path } : {}),
    ...(typeof location.line === "number" && Number.isInteger(location.line)
      ? { line: location.line }
      : {}),
    ...(typeof location.diffHunk === "string"
      ? { diffHunk: location.diffHunk.slice(0, 32 * 1024) }
      : {}),
  });
}

function providerInput(
  input: F18ReviewInputSnapshot,
  task: F16EffectiveAITaskSnapshot,
  decisions?: readonly F18BundleItem[],
): AIProviderInputSnapshot {
  const commonInstructions = task.commonInstructions
    .map((instruction) => instruction.instructionText)
    .join("\n\n");
  const validationInstructions = task.buildValidation?.buildInstructions;
  return {
    schemaVersion: 1,
    remoteEventVersionIds: [...input.remoteEventVersionIds],
    eventVersionIds: [...input.remoteEventVersionIds],
    pullRequest: {
      baseRepository: input.pullRequest.baseRepository,
      headRepository: input.pullRequest.headRepository,
      baseBranch: input.pullRequest.baseBranch,
      headBranch: input.pullRequest.headBranch,
      baseSha: input.pullRequest.baseSha,
      headSha: input.pullRequest.headSha,
    },
    ...(commonInstructions.length === 0 && validationInstructions === undefined
      ? {}
      : {
          instructions: {
            ...(commonInstructions.length === 0 ? {} : { commonInstructions }),
            ...(validationInstructions === undefined
              ? {}
              : { buildAndValidationInstructions: validationInstructions }),
          },
        }),
    feedback: input.feedback.map((feedback) => ({
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
    ...(input.contextText === undefined
      ? {}
      : { prIntentContext: input.contextText }),
    ...(decisions === undefined
      ? {}
      : {
          humanDecisions: decisions.map((item) => ({
            remoteEventVersionId: item.eventVersionId,
            disposition: item.decision.finalDisposition,
            ...(item.decision.instruction === undefined
              ? {}
              : { instruction: item.decision.instruction }),
            ...(item.decision.answer === undefined
              ? {}
              : { answer: item.decision.answer }),
          })),
        }),
    contextReferences: [`f18:${input.bundleId}`, `f13:${input.operationId}`],
  };
}

function validationEvidence(
  model: F14ValidationReadModel,
): F18ValidationEvidence {
  return {
    runId: model.runId,
    operationId: model.operationId,
    requestedPhase: model.requestedPhase,
    status: model.status,
    ...(model.reason === undefined ? {} : { reason: model.reason }),
    nextAction: safeText(model.nextAction, "REVIEW"),
    ...(model.snapshot?.snapshotId === undefined
      ? {}
      : { snapshotId: model.snapshot.snapshotId }),
    ...(model.snapshot?.baselineRevision === undefined
      ? {}
      : { baselineRevision: model.snapshot.baselineRevision }),
    ...(model.snapshot?.currentRevision === undefined
      ? {}
      : { currentRevision: model.snapshot.currentRevision }),
    warningCodes: model.warnings.map((warning) => warning.code).slice(0, 64),
    steps: model.steps.map((step) => ({
      stepId: step.stepId,
      kind: step.kind,
      status: step.status,
      ...(step.reason === undefined ? {} : { reason: step.reason }),
      ...(step.exitCode === undefined ? {} : { exitCode: step.exitCode }),
    })),
    ...(model.completedAt === undefined
      ? {}
      : { completedAt: model.completedAt }),
    version: model.version,
  };
}

function aiSummaryFromResult(
  result: F18AiWorkResult,
): F18AiWorkResult["summary"] {
  return result.summary;
}

function cloneRecord(
  record: F18ReviewBundleRecord,
  update: Partial<F18ReviewBundleRecord>,
): F18ReviewBundleRecord {
  return f18ReviewBundleRecordSchema.parse({
    ...record,
    ...update,
    updatedAt: update.updatedAt ?? record.updatedAt,
  });
}

function proposalItems(proposal: AIReviewProposal): readonly F18BundleItem[] {
  return proposal.items.map((recommendation) =>
    f18BundleItemSchema.parse({
      itemId: `f18-item-${recommendation.remoteEventVersionId}`,
      eventVersionId: recommendation.remoteEventVersionId,
      recommendation,
      decision: {
        decision: "pending",
        finalDisposition: "no_change",
      },
      decisionHistory: [
        {
          decision: "pending",
          finalDisposition: "no_change",
        },
      ],
    }),
  );
}

function initialRecord(
  input: F18AutomaticReviewHandoff,
  clock: (() => string) | undefined,
): F18ReviewBundleRecord {
  const timestamp = now(clock);
  const pullRequest = {
    baseRepository: {
      serverId: "unknown-server",
      owner: "unknown-owner",
      name: "unknown-repository",
      key: "unknown-repository",
    },
    headRepository: {
      serverId: "unknown-server",
      owner: "unknown-owner",
      name: "unknown-repository",
      key: "unknown-repository",
    },
    baseBranch: "unknown-base",
    headBranch: "unknown-head",
    baseSha: "unknown-base-sha",
    headSha: "unknown-head-sha",
  } as const;
  return f18ReviewBundleRecordSchema.parse({
    schemaVersion: 1,
    bundleId: input.bundleId,
    managedPrId: input.managedPrId,
    batchId: input.batchId,
    operationId: input.operationId,
    claimId: input.claimId,
    ...(input.holdId === undefined ? {} : { holdId: input.holdId }),
    correlationId: input.correlationId,
    schedulerRevision: input.schedulerRevision,
    state: "WORKING",
    stage: "PROPOSAL_REVIEW",
    phase: "ADMITTED",
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    input: {
      schemaVersion: 1,
      operationId: input.operationId,
      bundleId: input.bundleId,
      batchId: input.batchId,
      managedPrId: input.managedPrId,
      claimId: input.claimId,
      ...(input.holdId === undefined ? {} : { holdId: input.holdId }),
      correlationId: input.correlationId,
      schedulerRevision: input.schedulerRevision,
      remoteEventVersionIds: [...input.eventVersionIds],
      pullRequest,
      feedback: [],
    },
    items: [],
    draftResponses: [],
    reasons: [],
    nextAction: "PREPARE_WORKTREE",
  });
}

function errorReason(error: unknown): F18Reason {
  return reason(
    "F18_WORKFLOW_FAILED",
    safeText(
      error instanceof Error ? error.message : error,
      "Automatic review stopped.",
    ),
    "The durable Review Bundle remains held so the operation can be reconciled without inventing a provider or worktree outcome.",
    "RECONCILE",
  );
}

function baselineBlocks(model: F18ValidationEvidence | undefined): boolean {
  return model?.status === "failed" || model?.status === "interrupted";
}

function postChangeBlocks(model: F18ValidationEvidence | undefined): boolean {
  return (
    model?.status === "failed" ||
    model?.status === "interrupted" ||
    model?.status === "running"
  );
}

function aiWorkBlocks(summary: F18AiWorkResult["summary"]): boolean {
  return (
    summary.attention ||
    summary.status !== "COMPLETED" ||
    summary.nextAction !== "NONE"
  );
}

export class AutomaticReviewCoordinator implements F18AutomaticReviewBoundary {
  public constructor(
    private readonly options: AutomaticReviewCoordinatorOptions,
  ) {}

  public getReadModel(bundleId: string): F18ReviewBundleReadModel | undefined {
    const record = this.options.persistence.get(bundleId);
    return record === undefined ? undefined : this.readModel(record);
  }

  public async startAutomaticReview(input: F18AutomaticReviewHandoff): Promise<{
    readonly outcome:
      "ACCEPTED" | "ALREADY_ACCEPTED" | "REJECTED" | "UNCERTAIN";
    readonly reason?: F18Reason;
  }> {
    const existing = this.options.persistence.get(input.bundleId);
    if (existing !== undefined) {
      if (
        existing.managedPrId === input.managedPrId &&
        existing.operationId === input.operationId &&
        existing.batchId === input.batchId &&
        existing.claimId === input.claimId &&
        existing.schedulerRevision === input.schedulerRevision &&
        existing.input.remoteEventVersionIds.length ===
          input.eventVersionIds.length &&
        existing.input.remoteEventVersionIds.every(
          (eventVersionId, index) =>
            eventVersionId === input.eventVersionIds[index],
        )
      )
        return { outcome: "ALREADY_ACCEPTED" };
      return {
        outcome: "REJECTED",
        reason: reason(
          "BUNDLE_IDENTITY_CONFLICT",
          "The requested bundle identity is already owned by another review operation.",
          "F18 will not let a retry reuse a durable bundle for a different PR, claim, or immutable input set.",
          "RECONCILE",
        ),
      };
    }
    const admitted = this.admit(input);
    if (admitted.reason !== undefined)
      return { outcome: "REJECTED", reason: admitted.reason };
    const events = admitted.events;
    let record = initialRecord(input, this.options.clock);
    try {
      const managedPr = admitted.managedPr;
      record = cloneRecord(record, {
        input: f18ReviewInputSnapshotSchema.parse({
          ...record.input,
          pullRequest: {
            baseRepository: repositoryIdentity(managedPr.baseRepository),
            headRepository: repositoryIdentity(managedPr.headRepository),
            baseBranch: managedPr.prBaseBranch,
            headBranch: managedPr.prHeadBranch,
            baseSha: managedPr.prBaseSha,
            headSha: managedPr.prHeadSha,
            ...(managedPr.title === undefined
              ? {}
              : { title: managedPr.title }),
          },
          feedback: events.map(feedbackSnapshot),
          ...(typeof managedPr.configuration.context === "string" &&
          managedPr.configuration.context.length > 0
            ? { contextText: managedPr.configuration.context }
            : {}),
        }),
        updatedAt: now(this.options.clock),
      });
      record = this.options.persistence.persistIntent({
        record,
        events: events.map((event) => ({
          id: event.eventVersionId,
          managedPrId: event.managedPrId,
          sourceKind: event.sourceKind,
          sourceId: event.sourceId,
          observedAt: event.observedAt,
          semanticHash: event.semanticHash,
          payload: event.payload,
        })),
        managedPrExpectedVersion: managedPr.version,
      });

      const preparation = await this.options.f13.prepareReview({
        operationId: input.operationId,
        idempotencyKey: `f18-worktree-${input.operationId}`,
        correlationId: input.correlationId,
        ownerType: "REVIEW_BUNDLE",
        ownerId: input.bundleId,
        managedPrId: input.managedPrId,
        operationKind: "REVIEW",
        developerClonePath: managedPr.localClone?.canonicalRoot ?? "",
        ...(managedPr.localClone === undefined
          ? {}
          : {
              developerCloneRepository: {
                serverId: managedPr.localClone.repository.serverKey,
                owner: managedPr.localClone.repository.owner,
                name: managedPr.localClone.repository.name,
                key: managedPr.localClone.repository.key,
              },
            }),
        refs: {
          baseRepository: f13RepositoryIdentity(managedPr.baseRepository),
          headRepository: f13RepositoryIdentity(managedPr.headRepository),
          baseBranch: managedPr.prBaseBranch,
          headBranch: managedPr.prHeadBranch,
          prBaseSha: managedPr.prBaseSha,
          prHeadSha: managedPr.prHeadSha,
        },
      });
      if (!preparation.ok || preparation.inspection === undefined)
        return this.stopWithAttention(
          record,
          preparation.reason?.code ?? "WORKTREE_PREPARATION_FAILED",
        );
      const preparedWorktree = worktreeEvidence(preparation.inspection);
      const task = await this.options.f16.resolveTask({
        taskType: "AUTOMATIC_REVIEW_REEVALUATION",
        phase: "REVIEW_PROPOSAL",
        repository: repositoryIdentity(managedPr.baseRepository),
        operationId: input.operationId,
        operationWorktree: {
          operationId: preparation.worktree?.operationId ?? input.operationId,
          canonicalPath: preparedWorktree.canonicalPath,
          rootRevision: preparedWorktree.rootRevision,
        },
        ...(record.input.contextText === undefined
          ? {}
          : { prIntentContext: record.input.contextText }),
      });
      record = this.options.persistence.update({
        record: cloneRecord(record, {
          phase: "WORKTREE_PREPARED",
          input: {
            ...record.input,
            taskSnapshot: taskSnapshotRef(task, preparedWorktree),
            worktree: preparedWorktree,
          },
          worktree: preparedWorktree,
          updatedAt: now(this.options.clock),
          nextAction: "RUN_BASELINE_VALIDATION",
        }),
        expectedBundleVersion: record.version,
      });
      const baseline = await this.runValidation(input, managedPr, "baseline");
      record = this.options.persistence.update({
        record: cloneRecord(record, {
          phase: "BASELINE_VALIDATED",
          baselineValidation: baseline,
          reasons: baselineBlocks(baseline)
            ? [
                reason(
                  "BASELINE_VALIDATION_FAILED",
                  "Baseline validation did not pass before the proposal turn.",
                  "The read-only proposal is retained with deterministic attention evidence.",
                  "REVIEW_EVIDENCE",
                ),
              ]
            : [],
          updatedAt: now(this.options.clock),
          nextAction: "RUN_READ_ONLY_PROPOSAL",
        }),
        expectedBundleVersion: record.version,
      });
      const handoff = await this.options.f13.getProviderWorktreeHandoff({
        operationId: input.operationId,
        ownerId: input.bundleId,
      });
      if (!handoff.ok || handoff.handoff === undefined)
        return this.stopWithAttention(
          record,
          handoff.reason?.code ?? "WORKTREE_REVALIDATION_FAILED",
        );
      const aiResult = await this.options.aiWork.run({
        phase: "proposal",
        operationId: `f18-proposal-${input.operationId}`,
        f13OperationId: input.operationId,
        ownerId: input.bundleId,
        taskSnapshot: task,
        input: providerInput(record.input, task),
        worktree: handoff.handoff,
      });
      if (aiResult.proposal !== undefined)
        assertAIReviewProposalEventCoverage(
          aiResult.proposal,
          input.eventVersionIds,
        );
      if (aiResult.proposal === undefined)
        return this.stopWithAttention(record, "PROPOSAL_RESULT_MISSING");
      const items = proposalItems(aiResult.proposal);
      const finalReasons = [
        ...(record.reasons ?? []),
        ...(aiWorkBlocks(aiResult.summary)
          ? [
              reason(
                "PROPOSAL_NEEDS_ATTENTION",
                "The read-only proposal completed with an attention condition.",
                "F17 retained the provider claim and deterministic evidence without granting mutation or publication authority.",
                "REVIEW_EVIDENCE",
              ),
            ]
          : []),
      ];
      const next = cloneRecord(record, {
        state:
          baselineBlocks(record.baselineValidation) ||
          aiWorkBlocks(aiResult.summary)
            ? "NEEDS_ATTENTION"
            : "READY_FOR_REVIEW",
        phase: "PROPOSAL_RECORDED",
        items: [...items],
        proposalWork: aiSummaryFromResult(aiResult),
        draftResponses: aiResult.proposal.items
          .filter((item) => item.proposedReply !== undefined)
          .map((item) => ({
            eventVersionId: item.remoteEventVersionId,
            text: item.proposedReply as string,
            source: "MODEL_PROPOSAL" as const,
          })),
        reasons: finalReasons,
        nextAction:
          baselineBlocks(record.baselineValidation) ||
          aiWorkBlocks(aiResult.summary)
            ? "REVIEW_EVIDENCE"
            : "REVIEW_DECISIONS",
        updatedAt: now(this.options.clock),
      });
      this.options.persistence.update({
        record: next,
        expectedBundleVersion: record.version,
      });
      this.emit(
        input,
        "INFO",
        "Automatic Review Proposal persisted for explicit human decisions.",
      );
      return { outcome: "ACCEPTED" };
    } catch (error) {
      if (this.options.persistence.get(input.bundleId) !== undefined) {
        try {
          const current = this.options.persistence.get(input.bundleId);
          if (current !== undefined && current.state === "WORKING")
            this.options.persistence.update({
              record: cloneRecord(current, {
                state: "NEEDS_ATTENTION",
                reasons: [...current.reasons, errorReason(error)],
                nextAction: "RECONCILE",
                updatedAt: now(this.options.clock),
              }),
              expectedBundleVersion: current.version,
            });
        } catch {
          return { outcome: "UNCERTAIN", reason: errorReason(error) };
        }
      }
      return { outcome: "REJECTED", reason: errorReason(error) };
    }
  }

  public recordDecision(input: F18DecisionInput): F18ReviewBundleReadModel {
    const parsed = f18ItemDecisionSchema.safeParse({
      decision: input.decision,
      finalDisposition: input.finalDisposition,
      ...(input.instruction === undefined
        ? {}
        : { instruction: input.instruction }),
      ...(input.answer === undefined ? {} : { answer: input.answer }),
    });
    if (!parsed.success) throw new Error("F18_DECISION_INVALID");
    const current = this.requireBundle(input.bundleId);
    if (
      current.stage !== "PROPOSAL_REVIEW" ||
      (current.state !== "READY_FOR_REVIEW" &&
        current.state !== "NEEDS_ATTENTION")
    )
      throw new Error("F18_DECISION_STAGE_INVALID");
    const item = current.items.find(
      (candidate) => candidate.itemId === input.itemId,
    );
    if (item === undefined) throw new Error("F18_ITEM_NOT_FOUND");
    const updated = this.options.persistence.recordDecision({
      bundleId: input.bundleId,
      itemId: input.itemId,
      decision: input.decision,
      finalDisposition: input.finalDisposition,
      ...(input.instruction === undefined
        ? {}
        : { instruction: input.instruction }),
      ...(input.answer === undefined ? {} : { answer: input.answer }),
      ...(input.expectedVersion === undefined
        ? {}
        : { expectedVersion: input.expectedVersion }),
      ...(input.actionId === undefined ? {} : { actionId: input.actionId }),
    });
    return this.readModel(updated);
  }

  public async confirmReviewDecisions(input: {
    readonly bundleId: string;
    readonly expectedVersion?: number;
    readonly actionId?: string;
  }): Promise<F18ReviewBundleReadModel> {
    let record = this.requireBundle(input.bundleId);
    if (
      record.phase === "DECISIONS_CONFIRMED" ||
      record.phase === "IMPLEMENTATION_RECORDED" ||
      record.phase === "FINAL_RECORDED"
    )
      return this.readModel(record);
    if (
      record.stage !== "PROPOSAL_REVIEW" ||
      (record.state !== "READY_FOR_REVIEW" &&
        record.state !== "NEEDS_ATTENTION")
    )
      throw new Error("F18_CONFIRM_STAGE_INVALID");
    const summary = reviewBundleDecisionSummary(record.items);
    if (!summary.complete) throw new Error("F18_REVIEW_DECISIONS_REQUIRED");
    record = this.options.persistence.update({
      record: cloneRecord(record, {
        state: "WORKING",
        phase: "DECISIONS_CONFIRMED",
        reasons: [...record.reasons],
        nextAction: "RESOLVE_IMPLEMENTATION_REVISION",
        updatedAt: now(this.options.clock),
      }),
      expectedBundleVersion: input.expectedVersion ?? record.version,
    });
    try {
      if (summary.fixed === 0)
        return await this.finalizeNoImplementationChanges(record);

      const managedPr = this.options.managedPrs.getManagedPr(
        record.managedPrId,
      );
      if (managedPr === undefined) throw new Error("F18_MANAGED_PR_NOT_FOUND");
      const inspection = await this.options.f13.inspectOperation(
        record.operationId,
        input.bundleId,
        "INSPECTION",
      );
      if (!inspection.ok) {
        const blocked = cloneRecord(record, {
          state: "NEEDS_ATTENTION",
          phase: "IMPLEMENTATION_RECORDED",
          worktree: worktreeEvidence(inspection),
          reasons: [
            ...record.reasons,
            reason(
              "WORKTREE_STALE",
              "The operation worktree changed before implementation.",
              "F13 requires explicit reconciliation before mutation.",
              "RECONCILE_WORKTREE",
            ),
          ],
          nextAction: "RECONCILE_WORKTREE",
          updatedAt: now(this.options.clock),
        });
        return this.readModel(
          this.options.persistence.update({
            record: blocked,
            expectedBundleVersion: record.version,
          }),
        );
      }
      const currentWorktree = worktreeEvidence(inspection);
      const task = await this.options.f16.resolveTask({
        taskType: "REVIEW_REVISION",
        phase: "REVIEW_REVISION",
        repository: repositoryIdentity(managedPr.baseRepository),
        operationId: record.operationId,
        operationWorktree: {
          operationId: inspection.worktree.operationId,
          canonicalPath: inspection.worktree.canonicalPath,
          rootRevision: inspection.worktree.rootRevision,
        },
        ...(record.input.contextText === undefined
          ? {}
          : { prIntentContext: record.input.contextText }),
      });
      record = this.options.persistence.update({
        record: cloneRecord(record, {
          input: {
            ...record.input,
            taskSnapshot: taskSnapshotRef(task, currentWorktree),
            worktree: currentWorktree,
          },
          worktree: currentWorktree,
          nextAction: "RUN_IMPLEMENTATION",
          updatedAt: now(this.options.clock),
        }),
        expectedBundleVersion: record.version,
      });
      const handoff = await this.options.f13.getProviderWorktreeHandoff({
        operationId: record.operationId,
        ownerId: input.bundleId,
      });
      if (!handoff.ok || handoff.handoff === undefined)
        throw new Error("F18_IMPLEMENTATION_WORKTREE_UNAVAILABLE");
      const aiResult = await this.options.aiWork.run({
        phase: "implementation",
        operationId: `f18-implementation-${record.operationId}`,
        f13OperationId: record.operationId,
        ownerId: input.bundleId,
        taskSnapshot: task,
        input: providerInput(record.input, task, record.items),
        worktree: {
          ...handoff.handoff,
          access: "WORKTREE_WRITE",
          permittedCapabilities: {
            ...handoff.handoff.permittedCapabilities,
            writeFiles: true,
          },
        },
      });
      if (aiResult.implementation !== undefined)
        assertAIReviewImplementationDecisionCoverage(
          aiResult.implementation,
          record.items.map((item) => item.eventVersionId),
        );
      const after = await this.options.f13.inspectOperation(
        record.operationId,
        input.bundleId,
        "INSPECTION",
      );
      const afterEvidence = worktreeEvidence(after);
      const postValidation =
        aiResult.validation ??
        (await this.runValidation(
          inputToHandoff(record),
          managedPr,
          "post_change",
        ));
      const implementationReasons = [
        ...record.reasons,
        ...(aiResult.implementation === undefined
          ? [
              reason(
                "IMPLEMENTATION_RESULT_MISSING",
                "The implementation turn did not return a structured result.",
                "F15 structured output is required before a final Review Bundle can be considered review-ready.",
                "REVIEW_EVIDENCE",
              ),
            ]
          : []),
        ...(aiWorkBlocks(aiResult.summary)
          ? [
              reason(
                "IMPLEMENTATION_NEEDS_ATTENTION",
                "The implementation turn needs attention.",
                "F17 retained the provider result and deterministic evidence without granting publication authority.",
                "REVIEW_EVIDENCE",
              ),
            ]
          : []),
        ...(!after.ok
          ? [
              reason(
                "WORKTREE_REVALIDATION_FAILED",
                "The post-turn worktree could not be revalidated.",
                "F13 is the authority for actual changes and stale-head detection.",
                "RECONCILE_WORKTREE",
              ),
            ]
          : []),
        ...(postChangeBlocks(postValidation)
          ? [
              reason(
                "POST_CHANGE_VALIDATION_FAILED",
                "Post-change validation did not complete successfully.",
                "F14 validation evidence is required before the final Review Bundle can be considered ready.",
                "REVIEW_EVIDENCE",
              ),
            ]
          : []),
      ];
      const final = cloneRecord(record, {
        state:
          implementationReasons.length === 0
            ? "READY_FOR_REVIEW"
            : "NEEDS_ATTENTION",
        stage: "FINAL_REVIEW",
        phase: "FINAL_RECORDED",
        worktree: afterEvidence,
        postChangeValidation: postValidation,
        implementationWork: aiSummaryFromResult(aiResult),
        reasons: implementationReasons,
        nextAction:
          implementationReasons.length === 0 ? "NONE" : "REVIEW_EVIDENCE",
        updatedAt: now(this.options.clock),
      });
      return this.readModel(
        this.options.persistence.update({
          record: final,
          expectedBundleVersion: record.version,
        }),
      );
    } catch (error) {
      return this.persistImplementationAttention(record, error);
    }
  }

  private persistImplementationAttention(
    record: F18ReviewBundleRecord,
    error: unknown,
  ): F18ReviewBundleReadModel {
    const current = this.options.persistence.get(record.bundleId) ?? record;
    const updated = cloneRecord(current, {
      state: "NEEDS_ATTENTION",
      stage: "FINAL_REVIEW",
      phase: "IMPLEMENTATION_RECORDED",
      reasons: [...current.reasons, errorReason(error)],
      nextAction: "RECONCILE",
      updatedAt: now(this.options.clock),
    });
    return this.readModel(
      this.options.persistence.update({
        record: updated,
        expectedBundleVersion: current.version,
      }),
    );
  }

  private async finalizeNoImplementationChanges(
    record: F18ReviewBundleRecord,
  ): Promise<F18ReviewBundleReadModel> {
    const inspection = await this.options.f13.inspectOperation(
      record.operationId,
      record.bundleId,
      "INSPECTION",
    );
    const worktree = worktreeEvidence(inspection);
    const managedPr = this.options.managedPrs.getManagedPr(record.managedPrId);
    if (managedPr === undefined) throw new Error("F18_MANAGED_PR_NOT_FOUND");
    const postChangeValidation =
      this.options.f14.recordNoImplementationChanges === undefined
        ? await this.recordNoImplementationValidation(record, managedPr)
        : await this.options.f14.recordNoImplementationChanges({
            operationId: record.operationId,
            runId: `f18-no-change-${record.operationId}`,
            correlationId: record.correlationId,
            ownerType: "REVIEW_BUNDLE",
            ownerId: record.bundleId,
          });
    const reasons = [
      ...record.reasons,
      ...(inspection.ok && worktree.clean
        ? []
        : [
            reason(
              "WORKTREE_NOT_CLEAN",
              "The no-change review did not end with a clean worktree.",
              "F13 evidence is required even when no implementation turn is authorized.",
              "RECONCILE_WORKTREE",
            ),
          ]),
      ...(baselineBlocks(record.baselineValidation)
        ? [
            reason(
              "BASELINE_VALIDATION_FAILED",
              "Baseline validation remains a visible attention condition.",
              "The final bundle preserves the baseline failure as evidence.",
              "REVIEW_EVIDENCE",
            ),
          ]
        : []),
    ];
    const final = cloneRecord(record, {
      state: reasons.length === 0 ? "READY_FOR_REVIEW" : "NEEDS_ATTENTION",
      stage: "FINAL_REVIEW",
      phase: "FINAL_RECORDED",
      worktree,
      postChangeValidation,
      noImplementationChanges: true,
      reasons,
      nextAction: reasons.length === 0 ? "NONE" : "REVIEW_EVIDENCE",
      updatedAt: now(this.options.clock),
    });
    return this.readModel(
      this.options.persistence.update({
        record: final,
        expectedBundleVersion: record.version,
      }),
    );
  }

  private async runValidation(
    handoff: F18AutomaticReviewHandoff,
    managedPr: ManagedPrReadModel,
    phase: "baseline" | "post_change",
  ): Promise<F18ValidationEvidence> {
    const resolution = this.options.validation.resolve({
      repositoryId: repositoryIdentity(managedPr.baseRepository).key,
      operationId: handoff.operationId,
    });
    const result = await this.options.f14.run({
      operationId: handoff.operationId,
      runId: `f18-${phase}-${handoff.operationId}`,
      idempotencyKey: `f18-${phase}-key-${handoff.operationId}`,
      correlationId: handoff.correlationId,
      ownerType: "REVIEW_BUNDLE",
      ownerId: handoff.bundleId,
      consumer: "review",
      requestedPhase: phase,
      resolution,
    });
    const model = this.options.f14.readModel(result.record.runId);
    if (model !== undefined) return validationEvidence(model);
    return validationEvidence({
      schemaVersion: 1,
      runId: result.record.runId,
      operationId: result.record.operationId,
      ownerType: result.record.ownerType,
      ownerId: result.record.ownerId,
      consumer: result.record.consumer,
      requestedPhase: result.record.requestedPhase,
      status: result.record.status,
      reason: result.record.evidence.reason,
      startedAt: result.record.evidence.startedAt,
      completedAt: result.record.evidence.completedAt,
      steps: [],
      manualAttestations: [],
      warnings: result.record.warnings,
      nextAction: result.record.nextAction,
      version: result.record.version,
      createdAt: result.record.createdAt,
      updatedAt: result.record.updatedAt,
    });
  }

  private async recordNoImplementationValidation(
    record: F18ReviewBundleRecord,
    managedPr: ManagedPrReadModel,
  ): Promise<F18ValidationEvidence> {
    const repositoryId = repositoryIdentity(managedPr.baseRepository).key;
    const resolution = this.options.validation.resolve({
      repositoryId,
      operationId: record.operationId,
    });
    const noRunResolution: ValidationResolution =
      resolution.status === "unavailable"
        ? resolution
        : {
            status: "unavailable",
            source: undefined,
            repositoryId,
            operationId: record.operationId,
            reason: "NO_PROFILE",
            warning: validationWarning("VALIDATION_REVIEW_REQUIRED", {
              status: "not_run",
              reason: "NO_IMPLEMENTATION_CHANGES",
            }),
          };
    const result = await this.options.f14.run({
      operationId: record.operationId,
      runId: `f18-no-change-${record.operationId}`,
      idempotencyKey: `f18-no-change-key-${record.operationId}`,
      correlationId: record.correlationId,
      ownerType: "REVIEW_BUNDLE",
      ownerId: record.bundleId,
      consumer: "review",
      requestedPhase: "post_change",
      resolution: noRunResolution,
    });
    const model = this.options.f14.readModel(result.record.runId);
    if (model !== undefined) {
      return {
        ...validationEvidence(model),
        status: "not_run",
        reason: "NO_IMPLEMENTATION_CHANGES",
        nextAction: "NONE",
      };
    }
    return {
      ...validationEvidence({
        schemaVersion: 1,
        runId: result.record.runId,
        operationId: result.record.operationId,
        ownerType: result.record.ownerType,
        ownerId: result.record.ownerId,
        consumer: result.record.consumer,
        requestedPhase: result.record.requestedPhase,
        status: result.record.status,
        reason: result.record.evidence.reason,
        startedAt: result.record.evidence.startedAt,
        completedAt: result.record.evidence.completedAt,
        steps: [],
        manualAttestations: [],
        warnings: result.record.warnings,
        nextAction: result.record.nextAction,
        version: result.record.version,
        createdAt: result.record.createdAt,
        updatedAt: result.record.updatedAt,
      }),
      status: "not_run",
      reason: "NO_IMPLEMENTATION_CHANGES",
      nextAction: "NONE",
    };
  }

  private admit(input: F18AutomaticReviewHandoff): {
    readonly reason?: F18Reason;
    readonly managedPr: ManagedPrReadModel;
    readonly events: readonly F18EventVersion[];
  } {
    const scheduler = this.options.scheduler.read();
    if (scheduler.pause.paused)
      return {
        reason: reason(
          "SCHEDULER_PAUSED",
          "Automatic review is paused.",
          "F18 does not start new work while the durable scheduler pause is active.",
          "WAIT",
        ),
      } as never;
    if (scheduler.schedulerRevision !== input.schedulerRevision)
      return {
        reason: reason(
          "SCHEDULER_REVISION_STALE",
          "The scheduler revision changed before automatic review admission.",
          "F18 refuses to start work from a stale dispatch handoff.",
          "RECONCILE",
        ),
      } as never;
    const managedPr = this.options.managedPrs.getManagedPr(input.managedPrId);
    if (managedPr === undefined)
      return {
        reason: reason(
          "MANAGED_PR_NOT_FOUND",
          "The managed PR no longer exists.",
          "F18 requires the current F07 PR snapshot before admitting work.",
          "RECONCILE",
        ),
      } as never;
    if (
      managedPr.state !== "OPEN" ||
      managedPr.merged ||
      (managedPr.primaryState !== "WATCHING" &&
        managedPr.primaryState !== "WORKING")
    )
      return {
        reason: reason(
          "PR_STATE_NOT_ELIGIBLE",
          "The pull request is not in an eligible WATCHING or owned WORKING state.",
          "F18 refuses stale, closed, merged, or competing work before creating a worktree or provider turn.",
          "WAIT",
        ),
      } as never;
    if (managedPr.localClone === undefined)
      return {
        reason: reason(
          "LOCAL_CLONE_REQUIRED",
          "No validated developer clone is attached.",
          "F13 must receive an existing validated clone as read-only source input.",
          "FIX_INPUT",
        ),
      } as never;
    const claim = this.options.claims.getClaim(input.claimId);
    const activeClaim = this.options.claims.getActiveClaim(input.managedPrId);
    const hold = this.options.claims.getActiveHold(input.managedPrId);
    if (
      claim === undefined ||
      claim.state !== "ACTIVE" ||
      claim.managedPrId !== input.managedPrId ||
      claim.operationId !== input.operationId ||
      claim.bundleId !== input.bundleId
    )
      return {
        reason: reason(
          "CLAIM_INVALID",
          "The durable F11 claim does not match this handoff.",
          "F18 revalidates claim identity before any downstream effect.",
          "RECONCILE",
        ),
      } as never;
    if (
      activeClaim === undefined ||
      activeClaim.claimId !== input.claimId ||
      activeClaim.managedPrId !== input.managedPrId ||
      activeClaim.operationId !== input.operationId ||
      activeClaim.bundleId !== input.bundleId ||
      hold === undefined ||
      hold.state !== "ACTIVE" ||
      hold.holdId !== input.holdId ||
      hold.claimId !== input.claimId ||
      hold.managedPrId !== input.managedPrId ||
      hold.operationId !== input.operationId ||
      hold.bundleId !== input.bundleId
    )
      return {
        reason: reason(
          "HOLD_INVALID",
          "The durable F11 hold is missing or belongs to another operation.",
          "Held feedback must remain owned by the exact automatic-review operation.",
          "RECONCILE",
        ),
      } as never;
    if (
      claim.eventVersionIds.length !== input.eventVersionIds.length ||
      claim.eventVersionIds.some(
        (id, index) => id !== input.eventVersionIds[index],
      )
    )
      return {
        reason: reason(
          "EVENT_MEMBERSHIP_MISMATCH",
          "The handoff event set does not match the F11 claim.",
          "F18 never broadens or narrows the immutable input set after claim admission.",
          "RECONCILE",
        ),
      } as never;
    if (new Set(input.eventVersionIds).size !== input.eventVersionIds.length)
      return {
        reason: reason(
          "EVENT_IDS_DUPLICATED",
          "The automatic-review event set contains duplicates.",
          "Each immutable event version may appear once in a Review Bundle.",
          "RECONCILE",
        ),
      } as never;
    const events = input.eventVersionIds.map((eventVersionId) =>
      this.options.events.getEventVersion(input.managedPrId, eventVersionId),
    );
    if (
      events.some(
        (event, index) =>
          event === undefined ||
          event.managedPrId !== input.managedPrId ||
          event.eventVersionId !== input.eventVersionIds[index],
      )
    )
      return {
        reason: reason(
          "EVENT_VERSION_MISSING",
          "A claimed event version is no longer readable.",
          "F18 preserves the claim until the immutable event store can be reconciled.",
          "RECONCILE",
        ),
      } as never;
    return { managedPr, events: events as F18EventVersion[] };
  }

  private stopWithAttention(
    record: F18ReviewBundleRecord,
    code: string,
  ): { readonly outcome: "ACCEPTED"; readonly reason?: F18Reason } {
    const updated = cloneRecord(record, {
      state: "NEEDS_ATTENTION",
      reasons: [
        ...record.reasons,
        reason(
          code,
          "Automatic review needs attention before proposal completion.",
          "The durable hold and evidence remain available for reconciliation.",
          "RECONCILE",
        ),
      ],
      nextAction: "RECONCILE",
      updatedAt: now(this.options.clock),
    });
    try {
      this.options.persistence.update({
        record: updated,
        expectedBundleVersion: record.version,
      });
    } catch {
      return { outcome: "ACCEPTED", reason: errorReason(code) };
    }
    return { outcome: "ACCEPTED" };
  }

  private requireBundle(bundleId: string): F18ReviewBundleRecord {
    const record = this.options.persistence.get(bundleId);
    if (record === undefined) throw new Error("F18_BUNDLE_NOT_FOUND");
    return record;
  }

  private readModel(record: F18ReviewBundleRecord): F18ReviewBundleReadModel {
    return f18ReviewBundleReadModelSchema.parse({
      schemaVersion: 1,
      kind: "REVIEW_BUNDLE_READ_MODEL",
      bundleId: record.bundleId,
      managedPrId: record.managedPrId,
      batchId: record.batchId,
      operationId: record.operationId,
      state: record.state,
      stage: record.stage,
      phase: record.phase,
      version: record.version,
      input: record.input,
      items: record.items,
      ...(record.baselineValidation === undefined
        ? {}
        : { baselineValidation: record.baselineValidation }),
      ...(record.postChangeValidation === undefined
        ? {}
        : { postChangeValidation: record.postChangeValidation }),
      ...(record.worktree === undefined ? {} : { worktree: record.worktree }),
      ...(record.proposalWork === undefined
        ? {}
        : { proposalWork: record.proposalWork }),
      ...(record.implementationWork === undefined
        ? {}
        : { implementationWork: record.implementationWork }),
      draftResponses: record.draftResponses,
      reasons: record.reasons,
      nextAction: record.nextAction,
      ...(record.noImplementationChanges === undefined
        ? {}
        : { noImplementationChanges: record.noImplementationChanges }),
      decisionSummary: reviewBundleDecisionSummary(record.items),
      capabilities: {
        canPublish: false,
        canCommit: false,
        canPush: false,
        canPostReply: false,
      },
      evidenceAuthority: {
        proposal: "F15_STRUCTURED_RESULT",
        worktree: "F13_DETERMINISTIC",
        validation: "F14_DETERMINISTIC",
        lifecycle: "F17_DETERMINISTIC",
      },
    });
  }

  private emit(
    input: F18AutomaticReviewHandoff,
    severity: "INFO" | "WARN" | "ERROR",
    summary: string,
  ): void {
    try {
      this.options.activity?.append({
        eventId: `f18-activity-${randomUUID()}`,
        correlationId: input.correlationId,
        operationId: input.operationId,
        managedPrId: input.managedPrId,
        severity,
        summary,
      });
    } catch {
      // Activity is diagnostic and cannot change the Review Bundle outcome.
    }
  }
}

function inputToHandoff(
  record: F18ReviewBundleRecord,
): F18AutomaticReviewHandoff {
  return {
    batchId: record.batchId,
    managedPrId: record.managedPrId,
    eventVersionIds: record.input.remoteEventVersionIds,
    operationId: record.operationId,
    bundleId: record.bundleId,
    claimId: record.claimId,
    ...(record.holdId === undefined ? {} : { holdId: record.holdId }),
    schedulerRevision: record.schedulerRevision,
    correlationId: record.correlationId,
  };
}
