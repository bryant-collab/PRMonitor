import { createHash } from "node:crypto";
import type {
  F13ClearChoice,
  F13InspectionResult,
  F13WorktreeCondition,
} from "../shared/f13-contracts-impl";
import {
  f11ReevaluationAuthorizationToken,
  type F11AutomaticClaimRecord,
  type F11HoldRecord,
  type F11ReevaluationRollbackInput,
} from "./persistence/f11-repositories";
import {
  f16EffectiveAITaskSnapshotSchema,
  type F16EffectiveAITaskSnapshot,
} from "../shared/f16-preferences";
import type { F11ConfigurationSnapshot } from "../shared/domain/eligibility";
import type {
  F18AutomaticReviewHandoff,
  F18ReviewBundleReadModel,
} from "../shared/f18-automatic-review";
import type { F18AutomaticReviewBoundary } from "./automatic-review-coordinator";
import {
  classifyF22RemoteHead,
  configurationSummaryFromTaskSnapshot,
  f22ActionResultSchema,
  f22ActionIntentSchema,
  f22ActionGateSchema,
  f22BundleStateRecordSchema,
  f22DiscardPreviewSchema,
  f22GateFor,
  f22PendingActionSchema,
  f22ReevaluationPreviewSchema,
  f22RemoteRepositoryEqual,
  initialF22BundleState,
  type F22ActionGate,
  type F22ActionIntent,
  type F22BundlePort,
  type F22BundleStateRecord,
  type F22DiscardPreview,
  type F22DirtyWorktreeChoice,
  type F22PendingAction,
  type F22Reason,
  type F22RemoteHeadRead,
  type F22RemoteHeadObservation,
  type F22RemoteIdentity,
  type F22ReevaluationPreview,
} from "../shared/f22-discard-reevaluation";
import type { F22PersistencePort } from "./persistence/f22-repositories";

export interface F22RemoteHeadPort {
  readonly readCurrentHead: (managedPrId: string) => Promise<F22RemoteHeadRead>;
}

export interface F22F13ClearActionEvidence {
  readonly actionId: string;
  readonly operationId: string;
  readonly worktreeId: string;
  readonly choice: F13ClearChoice;
  readonly status: string;
  readonly afterSnapshotId?: string;
}

export interface F22F13Port {
  readonly inspectOperation: (
    operationId: string,
    ownerId: string,
    phase?:
      | "PREPARE"
      | "INSPECTION"
      | "BEFORE_AI"
      | "AFTER_AI"
      | "CLEAR_BEFORE"
      | "CLEAR_AFTER",
  ) => Promise<F13InspectionResult>;
  readonly clearChanges: (input: {
    readonly operationId: string;
    readonly ownerId: string;
    readonly choice: F13ClearChoice;
    readonly actionId: string;
    readonly confirmed?: boolean;
    readonly beforeSnapshotId?: string;
    readonly afterSnapshotId?: string;
  }) => Promise<{
    readonly ok: boolean;
    readonly choice: F13ClearChoice;
    readonly removed: readonly string[];
    readonly preserved: readonly string[];
    readonly remaining: readonly string[];
    readonly reason?: {
      readonly code: string;
      readonly what: string;
      readonly why: string;
      readonly nextAction: string;
    };
  }>;
  readonly readClearAction?: (input: {
    readonly actionId: string;
    readonly operationId: string;
    readonly ownerId: string;
    readonly choice: F13ClearChoice;
  }) => F22F13ClearActionEvidence | undefined;
}

export interface F22F11Port {
  readonly getClaim?: (claimId: string) => F11AutomaticClaimRecord | undefined;
  readonly getHold?: (holdId: string) => F11HoldRecord | undefined;
  readonly getActiveClaim: (
    managedPrId: string,
  ) => F11AutomaticClaimRecord | undefined;
  readonly getActiveHold: (managedPrId: string) => F11HoldRecord | undefined;
  readonly listRetainedVersionIds: (managedPrId: string) => readonly string[];
  readonly completeDiscard: (input: {
    readonly managedPrId: string;
    readonly claimId: string;
    readonly operationId: string;
    readonly bundleId: string;
  }) => {
    readonly outcome: "RELEASED" | "REPLAYED" | "CONFLICT";
    readonly reason?: F22Reason;
  };
  readonly transferForReevaluation: (input: {
    readonly managedPrId: string;
    readonly oldClaimId: string;
    readonly oldHoldId: string;
    readonly oldOperationId: string;
    readonly oldBundleId: string;
    readonly newClaimId: string;
    readonly newHoldId: string;
    readonly newOperationId: string;
    readonly newBundleId: string;
    readonly eventVersionIds: readonly string[];
    readonly configurationSnapshot: F11ConfigurationSnapshot;
    readonly correlationId: string;
    readonly authorizationId: string;
    readonly authorizationToken: string;
    readonly expectedOldClaimVersion: number;
    readonly expectedOldHoldVersion: number;
  }) => {
    readonly outcome: "TRANSFERRED" | "REPLAYED" | "CONFLICT";
    readonly claim?: F11AutomaticClaimRecord;
    readonly hold?: F11HoldRecord;
    readonly reason?: F22Reason;
  };
  readonly rollbackForReevaluation?: (input: F11ReevaluationRollbackInput) => {
    readonly outcome: "ROLLED_BACK" | "REPLAYED" | "CONFLICT";
    readonly reason: F22Reason;
  };
}

export interface F22TaskPort {
  /** Read-only settings projection used for a preview before authorization. */
  readonly readCurrentSummary?: (input: {
    readonly managedPrId: string;
    readonly repository: F18ReviewBundleReadModel["input"]["pullRequest"]["baseRepository"];
  }) => F22TaskSummary | Promise<F22TaskSummary>;
  readonly resolveCurrent?: (input: {
    readonly operationId: string;
    readonly managedPrId: string;
    readonly repository: F18ReviewBundleReadModel["input"]["pullRequest"]["baseRepository"];
  }) => Promise<F16EffectiveAITaskSnapshot>;
}

export interface F22TaskSummary {
  readonly taskType: string;
  readonly profileId: string;
  readonly profileRevision: number;
  readonly providerId: string;
  readonly modelId: string;
  readonly policyId: string;
  readonly policyRevision: number;
  readonly effectivePreset: string;
  readonly commonInstructionIds: readonly string[];
  readonly buildValidationStatus?: string;
  readonly prIntentContextHash?: string;
}

export interface F22ActiveOperationPort {
  readonly read: (bundleId: string) =>
    | {
        readonly operationId: string;
        readonly status: string;
      }
    | undefined;
}

export interface F22CoordinatorOptions {
  readonly persistence: F22PersistencePort;
  readonly bundles: F22BundlePort & F18AutomaticReviewBoundary;
  readonly remote: F22RemoteHeadPort;
  readonly f13: F22F13Port;
  readonly f11: F22F11Port;
  readonly activeOperation?: F22ActiveOperationPort;
  readonly managedPr?: {
    readonly readIdentity: (
      managedPrId: string,
    ) => F22RemoteIdentity | undefined;
  };
  readonly primaryReview?: {
    readonly read: (managedPrId: string) => F22ActionGate["primaryReviewState"];
  };
  readonly synchronization?: {
    readonly read: (
      managedPrId: string,
    ) => F22ActionGate["synchronizationOverlay"];
  };
  readonly tasks?: F22TaskPort;
  readonly schedulerRevision?: () => number;
  readonly clock?: () => string;
  readonly maxRemoteAgeMs?: number;
}

export interface F22GateReadOptions {
  /** F21 owns its active-operation projection while it asks for this gate. */
  readonly skipActiveOperation?: boolean;
  /** F21 can provide its already projected active operation without recursion. */
  readonly activeOperationOverride?: {
    readonly operationId: string;
    readonly status: string;
  };
}

export interface F22DiscardBeginInput {
  readonly bundleId: string;
  readonly idempotencyKey: string;
  readonly expectedGateRevision?: number;
}

export interface F22DiscardConfirmInput {
  readonly actionId: string;
  readonly bundleId: string;
  readonly choice: F22DirtyWorktreeChoice;
  readonly confirmed?: boolean;
  readonly expectedActionVersion?: number;
  readonly expectedGateRevision?: number;
}

export interface F22ReevaluationBeginInput {
  readonly bundleId: string;
  readonly idempotencyKey: string;
  readonly selectedRetainedEventVersionIds?: readonly string[];
  readonly expectedGateRevision?: number;
}

export interface F22ReevaluationConfirmInput {
  readonly actionId: string;
  readonly bundleId: string;
  readonly choice: F22DirtyWorktreeChoice;
  readonly confirmed?: boolean;
  readonly expectedActionVersion?: number;
  readonly expectedGateRevision?: number;
}

export interface F22PreviewResult<TPreview> {
  readonly outcome:
    "PREVIEW_READY" | "ALREADY_ACCEPTED" | "REJECTED" | "ATTENTION";
  readonly actionId?: string;
  readonly preview?: TPreview;
  readonly gate: F22ActionGate;
  readonly reason?: F22Reason;
}

export interface F22ActionResult {
  readonly outcome: "COMPLETED" | "CANCELLED" | "REJECTED" | "ATTENTION";
  readonly actionId: string;
  readonly gate: F22ActionGate;
  readonly newBundleId?: string;
  readonly reason?: F22Reason;
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);
}

function now(clock: (() => string) | undefined): string {
  return clock?.() ?? new Date().toISOString();
}

function reason(
  code: string,
  what: string,
  why: string,
  nextAction: string,
  details: Record<string, string | number | boolean> = {},
): F22Reason {
  return { code, what, why, nextAction, details };
}

function identityFor(
  bundle: F18ReviewBundleReadModel,
  managedIdentity?: F22RemoteIdentity,
): F22RemoteIdentity {
  return (
    managedIdentity ?? {
      serverId: bundle.input.pullRequest.baseRepository.serverId,
      repositoryKey: bundle.input.pullRequest.baseRepository.key,
    }
  );
}

function remoteAttentionCanClear(value: F22Reason | undefined): boolean {
  if (value === undefined) return false;
  return (
    value.code === "REMOTE_IDENTITY_MISMATCH" ||
    value.code === "REMOTE_REF_IDENTITY_MISMATCH" ||
    value.code === "REMOTE_REF_IDENTITY_UNAVAILABLE" ||
    value.code === "REMOTE_HEAD_CHECK_CANCELLED" ||
    value.code === "REMOTE_HEAD_CHECK_MALFORMED" ||
    value.code === "REMOTE_HEAD_CHECK_STALE" ||
    value.code === "REMOTE_HEAD_CHECK_CONFLICTING" ||
    value.code === "REMOTE_HEAD_CHECK_UNAVAILABLE" ||
    value.code === "REMOTE_HEAD_UNAVAILABLE" ||
    value.code === "REMOTE_HEAD_OBSERVATION_REQUIRED"
  );
}

function remoteObservationAllowsAction(
  value: F22RemoteHeadObservation,
): boolean {
  return value.outcome === "UNCHANGED" || value.outcome === "MOVED";
}

function remoteIdentityEqual(
  left: F22RemoteIdentity | undefined,
  right: F22RemoteIdentity | undefined,
): boolean {
  return (
    left?.serverId === right?.serverId &&
    left?.repositoryKey === right?.repositoryKey &&
    left?.pullRequestKey === right?.pullRequestKey
  );
}

interface F22SuccessorRemoteEvidence {
  readonly identity: F22RemoteIdentity;
  readonly baseSha?: string;
  readonly headSha?: string;
  readonly baseRepository?: F18ReviewBundleReadModel["input"]["pullRequest"]["baseRepository"];
  readonly headRepository?: F18ReviewBundleReadModel["input"]["pullRequest"]["headRepository"];
  readonly baseBranch?: string;
  readonly headBranch?: string;
}

function successorRemoteMatchesBundle(
  bundle: F18ReviewBundleReadModel,
  evidence: F22SuccessorRemoteEvidence,
  expectedIdentity: F22RemoteIdentity,
): boolean {
  const pullRequest = bundle.input.pullRequest;
  return (
    remoteIdentityEqual(evidence.identity, expectedIdentity) &&
    evidence.identity.serverId === pullRequest.baseRepository.serverId &&
    evidence.identity.repositoryKey === pullRequest.baseRepository.key &&
    evidence.baseSha === pullRequest.baseSha &&
    evidence.headSha === pullRequest.headSha &&
    f22RemoteRepositoryEqual(
      pullRequest.baseRepository,
      evidence.baseRepository,
    ) &&
    f22RemoteRepositoryEqual(
      pullRequest.headRepository,
      evidence.headRepository,
    ) &&
    evidence.baseBranch === pullRequest.baseBranch &&
    evidence.headBranch === pullRequest.headBranch
  );
}

function successorWorktreeMatchesBundle(
  oldBundle: F18ReviewBundleReadModel,
  newBundle: F18ReviewBundleReadModel,
  action: F22ActionIntent,
): boolean {
  const inputWorktree = newBundle.input.worktree;
  const readModelWorktree = newBundle.worktree;
  const oldPath =
    oldBundle.worktree?.canonicalPath ??
    oldBundle.input.worktree?.canonicalPath;
  if (inputWorktree === undefined || readModelWorktree === undefined)
    return false;
  return (
    action.newOperationId !== undefined &&
    inputWorktree.operationId === action.newOperationId &&
    readModelWorktree.operationId === action.newOperationId &&
    inputWorktree.operationId === readModelWorktree.operationId &&
    inputWorktree.canonicalPath === readModelWorktree.canonicalPath &&
    (oldPath === undefined || inputWorktree.canonicalPath !== oldPath) &&
    inputWorktree.ownerType === "REVIEW_BUNDLE" &&
    inputWorktree.ownerId === newBundle.bundleId &&
    readModelWorktree.ownerType === "REVIEW_BUNDLE" &&
    readModelWorktree.ownerId === newBundle.bundleId &&
    inputWorktree.baselineSha === newBundle.input.pullRequest.headSha &&
    readModelWorktree.baselineSha === newBundle.input.pullRequest.headSha &&
    inputWorktree.snapshotId !== "f13-inspection-missing" &&
    readModelWorktree.snapshotId !== "f13-inspection-missing" &&
    inputWorktree.complete &&
    readModelWorktree.complete &&
    inputWorktree.condition?.attribution.complete === true &&
    readModelWorktree.condition?.attribution.complete === true
  );
}

function persistedSuccessorRemote(
  preview: F22ReevaluationPreview,
): F22SuccessorRemoteEvidence {
  return {
    identity: preview.remote.observedIdentity ?? preview.remote.identity,
    ...(preview.remote.observedBaseSha === undefined
      ? {}
      : { baseSha: preview.remote.observedBaseSha }),
    ...(preview.remote.observedHeadSha === undefined
      ? {}
      : { headSha: preview.remote.observedHeadSha }),
    ...(preview.remote.observedBaseRepository === undefined
      ? {}
      : { baseRepository: preview.remote.observedBaseRepository }),
    ...(preview.remote.observedHeadRepository === undefined
      ? {}
      : { headRepository: preview.remote.observedHeadRepository }),
    ...(preview.remote.observedBaseBranch === undefined
      ? {}
      : { baseBranch: preview.remote.observedBaseBranch }),
    ...(preview.remote.observedHeadBranch === undefined
      ? {}
      : { headBranch: preview.remote.observedHeadBranch }),
  };
}

function choiceAllowedForPreview(
  choice: F22DirtyWorktreeChoice,
  required: F22DirtyWorktreeChoice,
): boolean {
  if (choice === "KEEP_AND_CANCEL") return true;
  if (required === "NO_CHANGES") return choice === "NO_CHANGES";
  return choice !== "NO_CHANGES";
}

function postClearConditionSafe(
  choice: F22DirtyWorktreeChoice,
  condition: F13WorktreeCondition,
): boolean {
  if (!condition.attribution.complete) return false;
  if (condition.classification === "STALE_OR_UNKNOWN") return false;
  if (choice === "NO_CHANGES" || choice === "CLEAR_ALL")
    return condition.classification === "CLEAN";
  if (choice === "CLEAR_AI_ONLY")
    return (
      condition.classification === "CLEAN" ||
      (condition.classification === "UNATTRIBUTED_CHANGES" &&
        condition.attribution.aiAttributedPaths.length === 0 &&
        condition.attribution.overlapPaths.length === 0)
    );
  return true;
}

function requiredChoice(
  condition: F13WorktreeCondition | undefined,
): F22DirtyWorktreeChoice {
  if (condition === undefined || condition.classification === "CLEAN")
    return "NO_CHANGES";
  if (condition.classification === "AI_ATTRIBUTED_ONLY") return "CLEAR_AI_ONLY";
  return "CLEAR_ALL";
}

function worktreeConditionChanged(
  expected: F13WorktreeCondition | undefined,
  current: F13WorktreeCondition,
): boolean {
  return (
    expected === undefined ||
    expected.classification !== current.classification ||
    expected.currentFingerprint !== current.currentFingerprint ||
    expected.observedRevision !== current.observedRevision ||
    expected.expectedRevision !== current.expectedRevision ||
    expected.dirtySummary.hash !== current.dirtySummary.hash
  );
}

function f13Choice(choice: F22DirtyWorktreeChoice): F13ClearChoice | undefined {
  if (choice === "CLEAR_ALL" || choice === "CLEAR_AI_ONLY") return choice;
  return undefined;
}

function summaryFromRef(
  ref: F18ReviewBundleReadModel["input"]["taskSnapshot"],
): F22TaskSummary {
  return {
    taskType: ref?.taskType ?? "AUTOMATIC_REVIEW_REEVALUATION",
    profileId: ref?.profileId ?? "unknown-profile",
    profileRevision: ref?.profileRevision ?? 0,
    providerId: ref?.providerId ?? "unknown-provider",
    modelId: ref?.modelId ?? "unknown-model",
    policyId: ref?.policyId ?? "unknown-policy",
    policyRevision: ref?.policyRevision ?? 0,
    effectivePreset: ref?.effectivePreset ?? "unknown-preset",
    commonInstructionIds: ref?.commonInstructionIds ?? [],
    ...(ref?.validationStatus === undefined
      ? {}
      : { buildValidationStatus: ref.validationStatus }),
  };
}

function summaryFromF16Snapshot(
  snapshot: F16EffectiveAITaskSnapshot,
): F22TaskSummary {
  return {
    taskType: snapshot.taskType,
    profileId: snapshot.profile.profileId,
    profileRevision: snapshot.profile.revision,
    providerId: snapshot.profile.providerId,
    modelId: snapshot.profile.modelId,
    policyId: snapshot.policy.policyId,
    policyRevision: snapshot.policy.revision,
    effectivePreset: snapshot.policy.effectivePreset,
    commonInstructionIds: snapshot.commonInstructions.map(
      (instruction) => instruction.profileId,
    ),
    ...(snapshot.buildValidation === undefined
      ? {}
      : { buildValidationStatus: snapshot.buildValidation.validation.status }),
    ...(snapshot.prIntentContext === undefined
      ? {}
      : { prIntentContextHash: snapshot.prIntentContext.contentHash }),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export class F22Coordinator {
  private readonly maxRemoteAgeMs: number;
  private remoteObservationSequence = 0;

  public constructor(private readonly options: F22CoordinatorOptions) {
    this.maxRemoteAgeMs = options.maxRemoteAgeMs ?? 5 * 60 * 1_000;
  }

  public registerBundle(
    bundle: F18ReviewBundleReadModel,
    parentBundleId?: string,
  ): F22BundleStateRecord {
    const identity = identityFor(
      bundle,
      this.options.managedPr?.readIdentity(bundle.managedPrId),
    );
    const existing = this.options.persistence.getBundleState(bundle.bundleId);
    if (existing !== undefined) {
      if (
        existing.identity.pullRequestKey === undefined &&
        identity.pullRequestKey !== undefined
      ) {
        const upgraded = f22BundleStateRecordSchema.parse({
          ...existing,
          identity,
          revision: existing.revision + 1,
          updatedAt: now(this.options.clock),
        });
        return this.options.persistence.putBundleState({
          state: upgraded,
          expectedRevision: existing.revision,
        });
      }
      return existing;
    }
    const state = f22BundleStateRecordSchema.parse({
      ...initialF22BundleState({
        bundle,
        identity,
        ...(parentBundleId === undefined ? {} : { parentBundleId }),
      }),
      updatedAt: now(this.options.clock),
    });
    return this.options.persistence.putBundleState({ state });
  }

  public async observeRemoteHead(
    bundleId: string,
    options: F22GateReadOptions = {},
  ): Promise<F22ActionGate> {
    return (await this.refreshRemoteHead(bundleId, options)).gate;
  }

  private async refreshRemoteHead(
    bundleId: string,
    options: F22GateReadOptions = {},
  ): Promise<{
    readonly read: F22RemoteHeadRead;
    readonly observation: F22RemoteHeadObservation;
    readonly gate: F22ActionGate;
  }> {
    const bundle = this.options.bundles.getReadModel?.(bundleId);
    if (bundle === undefined) throw new Error("F22_BUNDLE_NOT_FOUND");
    const state = this.registerBundle(bundle);
    const read = await this.options.remote.readCurrentHead(bundle.managedPrId);
    const observationToken = `f22-observation-${hash(
      `${bundleId}:${this.remoteObservationSequence++}:${read.attemptId ?? "no-attempt"}:${read.observationRevision}:${read.observedAt}`,
    )}`;
    const classifiedObservation = classifyF22RemoteHead({
      expected: state.identity,
      expectedHeadSha: state.expectedHeadSha,
      expectedBaseSha: state.expectedBaseSha,
      expectedBaseRepository: state.expectedBaseRepository,
      expectedHeadRepository: state.expectedHeadRepository,
      expectedBaseBranch: state.expectedBaseBranch,
      expectedHeadBranch: state.expectedHeadBranch,
      read,
      now: now(this.options.clock),
      maxAgeMs: this.maxRemoteAgeMs,
    });
    const observationRevisionRegressed =
      state.observationRevision !== undefined &&
      read.observationRevision < state.observationRevision;
    const observationRevisionConflicting =
      state.observationRevision !== undefined &&
      read.observationRevision === state.observationRevision &&
      ((state.observedHeadSha !== undefined &&
        read.headSha !== undefined &&
        state.observedHeadSha !== read.headSha) ||
        (state.observedBaseSha !== undefined &&
          read.baseSha !== undefined &&
          state.observedBaseSha !== read.baseSha) ||
        (state.observedIdentity !== undefined &&
          !remoteIdentityEqual(state.observedIdentity, read.identity)) ||
        (state.observedBaseRepository !== undefined &&
          !f22RemoteRepositoryEqual(
            state.observedBaseRepository,
            read.baseRepository,
          )) ||
        (state.observedHeadRepository !== undefined &&
          !f22RemoteRepositoryEqual(
            state.observedHeadRepository,
            read.headRepository,
          )) ||
        (state.observedBaseBranch !== undefined &&
          read.baseBranch !== undefined &&
          state.observedBaseBranch !== read.baseBranch) ||
        (state.observedHeadBranch !== undefined &&
          read.headBranch !== undefined &&
          state.observedHeadBranch !== read.headBranch));
    const observation =
      observationRevisionRegressed || observationRevisionConflicting
        ? {
            ...classifiedObservation,
            outcome: "STALE" as const,
            reason: reason(
              observationRevisionConflicting
                ? "REMOTE_HEAD_CHECK_CONFLICTING"
                : "REMOTE_HEAD_CHECK_STALE",
              observationRevisionConflicting
                ? "The remote-head observation reused a revision with conflicting identity or SHA evidence."
                : "The remote-head observation arrived with an older revision than the durable F22 evidence.",
              "F22 never lets equal-or-delayed observations overwrite newer remote identity or SHA evidence.",
              "RETRY",
              {
                previousObservationRevision: state.observationRevision ?? 0,
                receivedObservationRevision: read.observationRevision,
                ...(observationRevisionConflicting
                  ? { conflictingEvidence: true }
                  : {}),
              },
            ),
          }
        : classifiedObservation;
    const terminal =
      state.status === "DISCARDED" || state.status === "SUPERSEDED";
    const preserveAttention =
      state.status === "ATTENTION" && !remoteAttentionCanClear(state.reason);
    const preserveStaleEvidence =
      (state.status === "STALE" || state.status === "INVALIDATED") &&
      observation.outcome === "UNCHANGED";
    const preservePriorObservation =
      observationRevisionRegressed ||
      observationRevisionConflicting ||
      preserveStaleEvidence;
    const nextStatus = terminal
      ? state.status
      : preserveAttention
        ? state.status
        : observationRevisionConflicting
          ? "ATTENTION"
          : observation.outcome === "MOVED"
            ? "STALE"
            : observation.outcome === "UNCHANGED"
              ? state.status === "STALE" || state.status === "INVALIDATED"
                ? state.status
                : state.status === "ATTENTION" &&
                    !remoteAttentionCanClear(state.reason)
                  ? state.status
                  : "CURRENT"
              : state.status === "STALE"
                ? "STALE"
                : "ATTENTION";
    const nextReason =
      observationRevisionRegressed || observationRevisionConflicting
        ? observation.reason
        : preserveAttention || preserveStaleEvidence
          ? state.reason
          : observation.reason;
    const nextObservedHeadSha = preservePriorObservation
      ? state.observedHeadSha
      : observation.observedHeadSha;
    const nextObservedBaseSha = preservePriorObservation
      ? state.observedBaseSha
      : observation.observedBaseSha;
    const nextObservedIdentity = preservePriorObservation
      ? state.observedIdentity
      : observation.identity;
    const nextObservedBaseRepository = preservePriorObservation
      ? state.observedBaseRepository
      : observation.baseRepository;
    const nextObservedHeadRepository = preservePriorObservation
      ? state.observedHeadRepository
      : observation.headRepository;
    const nextObservedBaseBranch = preservePriorObservation
      ? state.observedBaseBranch
      : observation.baseBranch;
    const nextObservedHeadBranch = preservePriorObservation
      ? state.observedHeadBranch
      : observation.headBranch;
    const nextObservationRevision = preservePriorObservation
      ? state.observationRevision
      : observation.observationRevision;
    const nextObservedAt = preservePriorObservation
      ? state.observedAt
      : observation.observedAt;
    const changed =
      state.status !== nextStatus ||
      state.observedHeadSha !== nextObservedHeadSha ||
      state.observedBaseSha !== nextObservedBaseSha ||
      !remoteIdentityEqual(state.observedIdentity, nextObservedIdentity) ||
      !f22RemoteRepositoryEqual(
        state.observedBaseRepository,
        nextObservedBaseRepository,
      ) ||
      !f22RemoteRepositoryEqual(
        state.observedHeadRepository,
        nextObservedHeadRepository,
      ) ||
      state.observedBaseBranch !== nextObservedBaseBranch ||
      state.observedHeadBranch !== nextObservedHeadBranch ||
      state.reason?.code !== nextReason?.code ||
      state.observationRevision !== nextObservationRevision;
    const next = changed
      ? f22BundleStateRecordSchema.parse({
          ...state,
          status: nextStatus,
          revision: state.revision + 1,
          ...(nextObservedHeadSha === undefined
            ? {}
            : { observedHeadSha: nextObservedHeadSha }),
          ...(nextObservedBaseSha === undefined
            ? {}
            : { observedBaseSha: nextObservedBaseSha }),
          ...(nextObservedIdentity === undefined
            ? {}
            : { observedIdentity: nextObservedIdentity }),
          ...(nextObservedBaseRepository === undefined
            ? {}
            : { observedBaseRepository: nextObservedBaseRepository }),
          ...(nextObservedHeadRepository === undefined
            ? {}
            : { observedHeadRepository: nextObservedHeadRepository }),
          ...(nextObservedBaseBranch === undefined
            ? {}
            : { observedBaseBranch: nextObservedBaseBranch }),
          ...(nextObservedHeadBranch === undefined
            ? {}
            : { observedHeadBranch: nextObservedHeadBranch }),
          ...(nextObservationRevision === undefined
            ? {}
            : { observationRevision: nextObservationRevision }),
          ...(nextObservedAt === undefined
            ? {}
            : { observedAt: nextObservedAt }),
          ...(nextReason === undefined ? {} : { reason: nextReason }),
          updatedAt: now(this.options.clock),
        })
      : state;
    const saved =
      next === state
        ? state
        : this.options.persistence.putBundleState({
            state: next,
            expectedRevision: state.revision,
          });
    return {
      read,
      observation,
      gate: this.gate(
        bundle,
        saved,
        options.skipActiveOperation !== true,
        options.activeOperationOverride,
        observationToken,
      ),
    };
  }

  public async observeManagedPr(
    managedPrId: string,
  ): Promise<readonly F22ActionGate[]> {
    const models = this.options.bundles.listReadModels?.(managedPrId) ?? [];
    const result: F22ActionGate[] = [];
    for (const model of models)
      result.push(await this.observeRemoteHead(model.bundleId));
    return result;
  }

  public readGate(
    bundleId: string,
    options: F22GateReadOptions = {},
  ): F22ActionGate {
    const bundle = this.options.bundles.getReadModel?.(bundleId);
    if (bundle === undefined) throw new Error("F22_BUNDLE_NOT_FOUND");
    return this.gate(
      bundle,
      this.registerBundle(bundle),
      options.skipActiveOperation !== true,
      options.activeOperationOverride,
    );
  }

  public readPendingAction(bundleId: string): F22PendingAction | undefined {
    const action = this.options.persistence
      .listPendingActions()
      .find((candidate) => candidate.bundleId === bundleId);
    if (action === undefined) return undefined;
    const preview =
      action.action === "DISCARD"
        ? this.previewFromAction(action, f22DiscardPreviewSchema)
        : this.previewFromAction(action, f22ReevaluationPreviewSchema);
    return f22PendingActionSchema.parse({
      actionId: action.actionId,
      bundleId: action.bundleId,
      action: action.action,
      phase: action.phase,
      status: action.status,
      version: action.version,
      ...(preview === undefined ? {} : { preview }),
    });
  }

  public async beginDiscard(
    input: F22DiscardBeginInput,
  ): Promise<F22PreviewResult<F22DiscardPreview>> {
    const bundle = this.requireBundle(input.bundleId);
    const actionId = `f22-discard-${hash(`${input.bundleId}:${input.idempotencyKey}`)}`;
    const existing = this.options.persistence.getActionByIdempotency(
      input.idempotencyKey,
    );
    if (existing !== undefined) {
      const gate = this.readGate(input.bundleId);
      if (existing.bundleId !== input.bundleId)
        return {
          outcome: "REJECTED",
          actionId: existing.actionId,
          gate,
          reason: reason(
            "IDEMPOTENCY_KEY_CONFLICT",
            "The idempotency key already belongs to another Review Bundle.",
            "F22 will not disclose or replay an action across bundle boundaries.",
            "FIX_INPUT",
          ),
        };
      if (existing.action !== "DISCARD")
        return {
          outcome: "REJECTED",
          actionId: existing.actionId,
          gate,
          reason: reason(
            "IDEMPOTENCY_KEY_CONFLICT",
            "The idempotency key already belongs to another F22 action.",
            "A discard request cannot reuse a re-evaluation identity.",
            "FIX_INPUT",
          ),
        };
      if (existing.status === "FAILED" || existing.status === "UNKNOWN")
        return {
          outcome: "ATTENTION",
          actionId: existing.actionId,
          gate,
          reason:
            existing.reason ??
            reason(
              "F22_ACTION_RECONCILIATION_REQUIRED",
              "This discard action has already stopped and cannot be retried.",
              "F22 requires reconciliation before it can authorize another delegated effect.",
              "RECONCILE",
            ),
        };
      const preview = this.previewFromAction<F22DiscardPreview>(
        existing,
        f22DiscardPreviewSchema,
      );
      return {
        outcome: preview === undefined ? "ATTENTION" : "ALREADY_ACCEPTED",
        actionId: existing.actionId,
        ...(preview === undefined ? {} : { preview }),
        gate,
      };
    }
    const refreshed = await this.refreshRemoteHead(input.bundleId);
    const state = this.registerBundle(bundle);
    const gate = refreshed.gate;
    if (!remoteObservationAllowsAction(refreshed.observation))
      return {
        outcome: "REJECTED",
        gate,
        reason: this.gatedReason(gate, "DISCARD"),
      };
    if (!gate.actions.discard)
      return {
        outcome: "REJECTED",
        gate,
        reason: this.gatedReason(gate, "DISCARD"),
      };
    if (
      input.expectedGateRevision !== undefined &&
      input.expectedGateRevision !== gate.gateRevision
    )
      return {
        outcome: "REJECTED",
        gate,
        reason: reason(
          "STALE_GATE_REVISION",
          "The F22 action gate changed before the preview was requested.",
          "F22 rejects stale renderer intent without inspecting or mutating the worktree.",
          "RELOAD",
        ),
      };
    const competing = this.pendingActionForBundle(bundle.bundleId);
    if (competing !== undefined)
      return {
        outcome: "REJECTED",
        actionId: competing.actionId,
        gate,
        reason: reason(
          "F22_ACTION_IN_PROGRESS",
          "Another discard or re-evaluation action already owns this Review Bundle.",
          "F22 permits one durable action owner at a time so a renderer retry cannot race a worktree or hold effect.",
          "RELOAD",
        ),
      };
    let intent = this.newIntent({
      action: "DISCARD",
      actionId,
      idempotencyKey: input.idempotencyKey,
      bundle,
      state,
    });
    intent = this.options.persistence.persistActionIntent(intent);
    let inspection: F13InspectionResult;
    try {
      inspection = await this.inspect(bundle);
    } catch {
      return this.failActionPreview<F22DiscardPreview>(
        intent,
        bundle,
        "WORKTREE_INSPECTION_FAILED",
        "The current operation worktree could not be inspected.",
      );
    }
    if (!inspection.ok) {
      return this.failActionPreview<F22DiscardPreview>(
        intent,
        bundle,
        inspection.reason?.code ?? "WORKTREE_INSPECTION_FAILED",
        inspection.reason?.what ??
          "The current operation worktree could not be inspected.",
      );
    }
    const preview = f22DiscardPreviewSchema.parse({
      schemaVersion: 1,
      kind: "F22_DISCARD_PREVIEW",
      actionId,
      bundleId: bundle.bundleId,
      managedPrId: bundle.managedPrId,
      gateRevision: gate.gateRevision,
      actionRevision: intent.version + 1,
      worktreeCondition: inspection.condition,
      requiredChoice: requiredChoice(inspection.condition),
      confirmationText:
        inspection.condition.classification === "CLEAN"
          ? "Discard this Review Bundle and release its handled versions?"
          : "Choose exactly how the current operation worktree should be handled before discarding.",
      publicationAuthorized: false,
    });
    const ready = this.advanceAction(intent, {
      phase: "PREVIEW_READY",
      expectedConditionRevision: inspection.condition.observedRevision,
      expectedGateRevision: state.revision + 1,
      result: { preview },
    });
    this.options.persistence.updateAction({
      action: ready,
      expectedVersion: intent.version,
    });
    const conditioned = this.advanceState(
      state,
      state.status,
      undefined,
      inspection.condition,
    );
    const saved = this.saveState(state, conditioned);
    return {
      outcome: "PREVIEW_READY",
      actionId,
      preview,
      gate: this.gate(bundle, saved),
    };
  }

  public async confirmDiscard(
    input: F22DiscardConfirmInput,
  ): Promise<F22ActionResult> {
    const intent = this.requireAction(
      input.actionId,
      "DISCARD",
      input.bundleId,
    );
    if (intent.status === "COMPLETED")
      return {
        outcome: "COMPLETED",
        actionId: intent.actionId,
        gate: this.readGate(input.bundleId),
      };
    if (intent.status === "CANCELLED")
      return {
        outcome: "CANCELLED",
        actionId: intent.actionId,
        gate: this.readGate(input.bundleId),
      };
    if (intent.status === "FAILED" || intent.status === "UNKNOWN")
      return this.stoppedAction(intent, input.bundleId);
    const bundle = this.requireBundle(input.bundleId);
    if (
      input.expectedActionVersion !== undefined &&
      input.expectedActionVersion !== intent.version
    )
      return {
        outcome: "REJECTED",
        actionId: intent.actionId,
        gate: this.readGate(bundle.bundleId),
        reason: reason(
          "STALE_ACTION_VERSION",
          "The F22 action changed before confirmation.",
          "Only the durable action owner may continue an action intent.",
          "RELOAD",
        ),
      };
    if (
      input.choice === "KEEP_AND_CANCEL" &&
      intent.status === "PENDING" &&
      (intent.phase === "ADMITTED" || intent.phase === "PREVIEW_READY")
    ) {
      const cancelled = this.advanceAction(intent, {
        phase: "CANCELLED",
        status: "CANCELLED",
        choice: input.choice,
      });
      this.options.persistence.updateAction({
        action: cancelled,
        expectedVersion: intent.version,
      });
      return {
        outcome: "CANCELLED",
        actionId: intent.actionId,
        gate: this.readGate(input.bundleId),
      };
    }
    const preview = this.previewFromAction<F22DiscardPreview>(
      intent,
      f22DiscardPreviewSchema,
    );
    if (preview === undefined)
      return this.attentionAction(
        intent,
        bundle,
        "F22_DISCARD_PREVIEW_MISSING",
        "The discard preview is missing and cannot authorize a worktree choice.",
      );
    if (bundle.version !== intent.expectedBundleVersion)
      return {
        outcome: "REJECTED",
        actionId: intent.actionId,
        gate: this.readGate(bundle.bundleId),
        reason: reason(
          "STALE_BUNDLE_VERSION",
          "The Review Bundle changed after this F22 action was previewed.",
          "F22 will not apply a worktree or F11 effect to a stale bundle snapshot.",
          "RELOAD",
        ),
      };
    if (input.choice === "KEEP_AND_CANCEL")
      return {
        outcome: "REJECTED",
        actionId: intent.actionId,
        gate: this.readGate(bundle.bundleId),
        reason: reason(
          "F22_ACTION_ALREADY_STARTED",
          "This F22 action has already started a delegated effect and cannot be cancelled at this phase.",
          "Keep Worktree and Cancel is a no-effect choice only before worktree or hold effects begin.",
          "RECONCILE",
        ),
      };
    const refreshed = await this.refreshRemoteHead(input.bundleId);
    const gate = refreshed.gate;
    if (!remoteObservationAllowsAction(refreshed.observation))
      return {
        outcome: "REJECTED",
        actionId: intent.actionId,
        gate,
        reason: this.gatedReason(gate, "DISCARD"),
      };
    if (!gate.actions.discard)
      return {
        outcome: "REJECTED",
        actionId: intent.actionId,
        gate,
        reason: this.gatedReason(gate, "DISCARD"),
      };
    if (
      (input.expectedGateRevision ?? intent.expectedGateRevision) !==
      gate.gateRevision
    )
      return {
        outcome: "REJECTED",
        actionId: intent.actionId,
        gate,
        reason: reason(
          "STALE_GATE_REVISION",
          "The F22 action gate changed before confirmation.",
          "F22 rejects stale renderer intent without repeating a worktree or F11 effect.",
          "RELOAD",
        ),
      };
    if (!choiceAllowedForPreview(input.choice, preview.requiredChoice))
      return {
        outcome: "REJECTED",
        actionId: intent.actionId,
        gate,
        reason: reason(
          "WORKTREE_CHOICE_NOT_REQUIRED",
          "The selected clear choice does not match the recorded worktree condition.",
          "A clean worktree cannot be passed to a destructive F13 clear operation.",
          "SELECT_WORKTREE_CHOICE",
        ),
      };
    if (input.confirmed !== true)
      return {
        outcome: "REJECTED",
        actionId: intent.actionId,
        gate,
        reason: reason(
          input.choice === "CLEAR_ALL"
            ? "DESTRUCTIVE_CONFIRMATION_REQUIRED"
            : "EXPLICIT_CONFIRMATION_REQUIRED",
          input.choice === "CLEAR_ALL"
            ? "Clear All Changes requires explicit confirmation."
            : "This F22 choice requires explicit confirmation.",
          "F22 never turns a worktree choice into an implicit discard or replacement.",
          "CONFIRM",
        ),
      };
    let currentInspection: F13InspectionResult;
    try {
      currentInspection = await this.inspect(bundle);
    } catch {
      return this.failAction(
        intent,
        bundle,
        "WORKTREE_INSPECTION_FAILED",
        "The operation worktree could not be freshly inspected before the discard choice.",
      );
    }
    if (!currentInspection.ok)
      return this.failAction(
        intent,
        bundle,
        "WORKTREE_INSPECTION_FAILED",
        "The operation worktree could not be freshly inspected before the discard choice.",
      );
    if (
      worktreeConditionChanged(
        preview.worktreeCondition,
        currentInspection.condition,
      )
    )
      return this.failAction(
        intent,
        bundle,
        "STALE_WORKTREE_CONDITION",
        "The operation worktree changed after the discard preview was prepared.",
      );
    if (
      !choiceAllowedForPreview(
        input.choice,
        requiredChoice(currentInspection.condition),
      )
    )
      return this.failAction(
        intent,
        bundle,
        "WORKTREE_CHOICE_NOT_REQUIRED",
        "The selected clear choice no longer matches the freshly inspected worktree condition.",
      );
    let working = this.advanceAction(intent, {
      phase: "CHOICE_CONFIRMED",
      choice: input.choice,
      confirmed: input.confirmed === true,
    });
    this.options.persistence.updateAction({
      action: working,
      expectedVersion: intent.version,
    });
    const clearChoice = f13Choice(input.choice);
    if (clearChoice !== undefined) {
      working = this.advanceAction(working, { phase: "CLEARING_WORKTREE" });
      this.options.persistence.updateAction({
        action: working,
        expectedVersion: working.version - 1,
      });
      let cleared: Awaited<ReturnType<F22F13Port["clearChanges"]>>;
      try {
        cleared = await this.options.f13.clearChanges({
          operationId: bundle.operationId,
          ownerId: bundle.bundleId,
          choice: clearChoice,
          actionId: working.actionId,
          confirmed: input.confirmed,
          ...(preview.worktreeCondition?.attribution.beforeSnapshotId ===
          undefined
            ? {}
            : {
                beforeSnapshotId:
                  preview.worktreeCondition.attribution.beforeSnapshotId,
              }),
          ...(preview.worktreeCondition?.attribution.afterSnapshotId ===
          undefined
            ? {}
            : {
                afterSnapshotId:
                  preview.worktreeCondition.attribution.afterSnapshotId,
              }),
        });
      } catch {
        return this.unknownAction(
          working,
          bundle,
          "WORKTREE_CLEAR_UNCERTAIN",
          "The selected worktree clear did not return a durable outcome; F22 preserved the worktree for reconciliation.",
        );
      }
      if (!cleared.ok)
        return this.failAction(
          working,
          bundle,
          cleared.reason?.code ?? "WORKTREE_CLEAR_FAILED",
          cleared.reason?.what ??
            "The selected worktree choice did not complete.",
        );
      const boundedClearResult = f22ActionResultSchema.safeParse({
        removed: [...cleared.removed],
        preserved: [...cleared.preserved],
        remaining: [...cleared.remaining],
      });
      if (!boundedClearResult.success)
        return this.unknownAction(
          working,
          bundle,
          "UNSAFE_PATH_EVIDENCE",
          "F13 returned path evidence that F22 could not safely persist; the worktree and hold remain for reconciliation.",
        );
      working = this.advanceAction(working, {
        phase: "POST_CLEAR_REVALIDATION",
        result: {
          choice: input.choice,
          removed: boundedClearResult.data.removed,
          preserved: boundedClearResult.data.preserved,
          remaining: boundedClearResult.data.remaining,
        },
      });
      this.options.persistence.updateAction({
        action: working,
        expectedVersion: working.version - 1,
      });
    }
    let postInspection: F13InspectionResult;
    try {
      postInspection = await this.inspect(bundle);
    } catch {
      return this.unknownAction(
        working,
        bundle,
        "POST_CLEAR_REVALIDATION_UNCERTAIN",
        "The worktree re-inspection did not return a durable outcome; F22 preserved the bundle for reconciliation.",
      );
    }
    if (!postInspection.ok)
      return this.failAction(
        working,
        bundle,
        "POST_CLEAR_REVALIDATION_FAILED",
        "The worktree could not be re-inspected after the selected discard choice.",
      );
    if (!postClearConditionSafe(input.choice, postInspection.condition))
      return this.failAction(
        working,
        bundle,
        "POST_CLEAR_CONDITION_UNSAFE",
        "The post-choice worktree condition is not safe enough to release the Review Bundle owner.",
      );
    let completed: ReturnType<F22F11Port["completeDiscard"]>;
    try {
      completed = this.options.f11.completeDiscard({
        managedPrId: bundle.managedPrId,
        claimId: bundle.input.claimId,
        operationId: bundle.operationId,
        bundleId: bundle.bundleId,
      });
    } catch {
      return this.unknownAction(
        working,
        bundle,
        "F11_DISCARD_COMPLETION_UNCERTAIN",
        "The F11 discard outcome did not return a durable result; F22 preserved the bundle for reconciliation.",
      );
    }
    if (completed.outcome === "CONFLICT")
      return this.failAction(
        working,
        bundle,
        "F11_DISCARD_COMPLETION_CONFLICT",
        "The F11 claim or hold changed before discard could be completed.",
      );
    const state = this.registerBundle(bundle);
    const nextState = this.advanceState(
      state,
      "DISCARDED",
      reason(
        "REVIEW_BUNDLE_DISCARDED",
        "The Review Bundle was discarded by explicit human choice.",
        "F22 released the exact handled versions through F11 after the worktree choice completed.",
        "NONE",
      ),
      postInspection.condition,
    );
    const saved = this.saveState(state, nextState);
    const done = this.advanceAction(working, {
      phase: "COMPLETED",
      status: "COMPLETED",
      result: {
        ...(asRecord(working.result) ?? {}),
        outcome: completed.outcome,
      },
    });
    this.options.persistence.updateAction({
      action: done,
      expectedVersion: working.version,
    });
    return {
      outcome: "COMPLETED",
      actionId: done.actionId,
      gate: this.gate(bundle, saved),
    };
  }

  public async beginReevaluation(
    input: F22ReevaluationBeginInput,
  ): Promise<F22PreviewResult<F22ReevaluationPreview>> {
    const bundle = this.requireBundle(input.bundleId);
    const actionId = `f22-reevaluate-${hash(`${input.bundleId}:${input.idempotencyKey}`)}`;
    const existing = this.options.persistence.getActionByIdempotency(
      input.idempotencyKey,
    );
    if (existing !== undefined) {
      const gate = this.readGate(input.bundleId);
      if (existing.bundleId !== input.bundleId)
        return {
          outcome: "REJECTED",
          actionId: existing.actionId,
          gate,
          reason: reason(
            "IDEMPOTENCY_KEY_CONFLICT",
            "The idempotency key already belongs to another Review Bundle.",
            "F22 will not disclose or replay an action across bundle boundaries.",
            "FIX_INPUT",
          ),
        };
      if (existing.action !== "REEVALUATE")
        return {
          outcome: "REJECTED",
          actionId: existing.actionId,
          gate,
          reason: reason(
            "IDEMPOTENCY_KEY_CONFLICT",
            "The idempotency key already belongs to another F22 action.",
            "A re-evaluation request cannot reuse a discard identity.",
            "FIX_INPUT",
          ),
        };
      if (existing.status === "FAILED" || existing.status === "UNKNOWN")
        return {
          outcome: "ATTENTION",
          actionId: existing.actionId,
          gate,
          reason:
            existing.reason ??
            reason(
              "F22_ACTION_RECONCILIATION_REQUIRED",
              "This re-evaluation action has already stopped and cannot be retried.",
              "F22 requires reconciliation before it can authorize another delegated effect.",
              "RECONCILE",
            ),
        };
      const preview = this.previewFromAction<F22ReevaluationPreview>(
        existing,
        f22ReevaluationPreviewSchema,
      );
      return {
        outcome: preview === undefined ? "ATTENTION" : "ALREADY_ACCEPTED",
        actionId: existing.actionId,
        ...(preview === undefined ? {} : { preview }),
        gate,
      };
    }
    const refreshed = await this.refreshRemoteHead(input.bundleId);
    const state = this.registerBundle(bundle);
    const gate = refreshed.gate;
    if (!remoteObservationAllowsAction(refreshed.observation))
      return {
        outcome: "REJECTED",
        gate,
        reason: this.gatedReason(gate, "RE_EVALUATE"),
      };
    if (!gate.actions.reevaluate)
      return {
        outcome: "REJECTED",
        gate,
        reason: this.gatedReason(gate, "RE_EVALUATE"),
      };
    if (
      input.expectedGateRevision !== undefined &&
      input.expectedGateRevision !== gate.gateRevision
    )
      return {
        outcome: "REJECTED",
        gate,
        reason: reason(
          "STALE_GATE_REVISION",
          "The F22 action gate changed before the preview was requested.",
          "F22 rejects stale renderer intent without inspecting or mutating the worktree.",
          "RELOAD",
        ),
      };
    const competing = this.pendingActionForBundle(bundle.bundleId);
    if (competing !== undefined)
      return {
        outcome: "REJECTED",
        actionId: competing.actionId,
        gate,
        reason: reason(
          "F22_ACTION_IN_PROGRESS",
          "Another discard or re-evaluation action already owns this Review Bundle.",
          "F22 permits one durable action owner at a time so a renderer retry cannot race a worktree or hold effect.",
          "RELOAD",
        ),
      };
    let intent = this.newIntent({
      action: "REEVALUATE",
      actionId,
      idempotencyKey: input.idempotencyKey,
      bundle,
      state,
      retainedEventVersionIds: input.selectedRetainedEventVersionIds ?? [],
    });
    intent = this.options.persistence.persistActionIntent(intent);
    const read = refreshed.read;
    if (
      read.outcome !== "CURRENT" ||
      read.headSha === undefined ||
      read.baseSha === undefined
    )
      return this.failActionPreview(
        intent,
        bundle,
        "REMOTE_HEAD_UNAVAILABLE",
        "Current remote repository, branch, and SHA evidence is unavailable.",
      );
    let inspection: F13InspectionResult;
    try {
      inspection = await this.inspect(bundle);
    } catch {
      return this.failActionPreview(
        intent,
        bundle,
        "WORKTREE_INSPECTION_FAILED",
        "The current operation worktree could not be inspected for a re-evaluation choice.",
      );
    }
    if (!inspection.ok)
      return this.failActionPreview(
        intent,
        bundle,
        "WORKTREE_INSPECTION_FAILED",
        "The current operation worktree could not be inspected for a re-evaluation choice.",
      );
    const candidates = [
      ...this.options.f11.listRetainedVersionIds(bundle.managedPrId),
    ];
    const selected = [...new Set(input.selectedRetainedEventVersionIds ?? [])];
    if (selected.some((eventVersionId) => !candidates.includes(eventVersionId)))
      return this.failActionPreview(
        intent,
        bundle,
        "RETAINED_VERSION_SCOPE_INVALID",
        "Re-evaluation can include only explicitly retained immutable event versions.",
      );
    let task: F22TaskSummary;
    try {
      task =
        this.options.tasks?.readCurrentSummary === undefined
          ? summaryFromRef(bundle.input.taskSnapshot)
          : await this.options.tasks.readCurrentSummary({
              managedPrId: bundle.managedPrId,
              repository: bundle.input.pullRequest.baseRepository,
            });
    } catch {
      return this.failActionPreview(
        intent,
        bundle,
        "F16_CONFIGURATION_UNAVAILABLE",
        "The current Automatic Review / Re-evaluation configuration could not be resolved.",
      );
    }
    let configuration: ReturnType<typeof configurationSummaryFromTaskSnapshot>;
    try {
      configuration = configurationSummaryFromTaskSnapshot(task);
    } catch {
      return this.failActionPreview(
        intent,
        bundle,
        "F16_CONFIGURATION_INVALID",
        "The current Automatic Review / Re-evaluation configuration was not bounded and valid.",
      );
    }
    const preview = f22ReevaluationPreviewSchema.parse({
      schemaVersion: 1,
      kind: "F22_REEVALUATION_PREVIEW",
      actionId,
      bundleId: bundle.bundleId,
      managedPrId: bundle.managedPrId,
      remote: {
        identity: state.identity,
        expectedBaseSha: bundle.input.pullRequest.baseSha,
        expectedHeadSha: bundle.input.pullRequest.headSha,
        expectedBaseRepository: bundle.input.pullRequest.baseRepository,
        expectedHeadRepository: bundle.input.pullRequest.headRepository,
        expectedBaseBranch: bundle.input.pullRequest.baseBranch,
        expectedHeadBranch: bundle.input.pullRequest.headBranch,
        observedIdentity: read.identity,
        observedBaseSha: read.baseSha,
        observedHeadSha: read.headSha,
        ...(read.baseRepository === undefined
          ? {}
          : { observedBaseRepository: read.baseRepository }),
        ...(read.headRepository === undefined
          ? {}
          : { observedHeadRepository: read.headRepository }),
        ...(read.baseBranch === undefined
          ? {}
          : { observedBaseBranch: read.baseBranch }),
        ...(read.headBranch === undefined
          ? {}
          : { observedHeadBranch: read.headBranch }),
        observationRevision: read.observationRevision,
        observedAt: read.observedAt,
        ...(refreshed.gate.remote.observationToken === undefined
          ? {}
          : { observationToken: refreshed.gate.remote.observationToken }),
      },
      originalEventVersionIds: bundle.input.remoteEventVersionIds,
      retainedCandidateEventVersionIds: candidates,
      selectedRetainedEventVersionIds: selected,
      worktreeCondition: inspection.condition,
      configuration,
      holdRemainsActive: true,
      publicationAuthorized: false,
      requiredChoice: requiredChoice(inspection.condition),
      confirmationText:
        "Start a fresh Review Bundle at the current exact pull-request head?",
      gateRevision: gate.gateRevision,
      actionRevision: intent.version + 1,
    });
    const ready = this.advanceAction(intent, {
      phase: "PREVIEW_READY",
      expectedConditionRevision: inspection.condition.observedRevision,
      expectedGateRevision: state.revision + 1,
      result: { preview },
    });
    this.options.persistence.updateAction({
      action: ready,
      expectedVersion: intent.version,
    });
    const conditioned = this.advanceState(
      state,
      state.status,
      undefined,
      inspection.condition,
    );
    const saved = this.saveState(state, conditioned);
    return {
      outcome: "PREVIEW_READY",
      actionId,
      preview,
      gate: this.gate(bundle, saved),
    };
  }

  public async confirmReevaluation(
    input: F22ReevaluationConfirmInput,
  ): Promise<F22ActionResult> {
    const intent = this.requireAction(
      input.actionId,
      "REEVALUATE",
      input.bundleId,
    );
    if (intent.status === "COMPLETED")
      return {
        outcome: "COMPLETED",
        actionId: intent.actionId,
        gate: this.readGate(input.bundleId),
        newBundleId: intent.newBundleId,
      };
    if (intent.status === "CANCELLED")
      return {
        outcome: "CANCELLED",
        actionId: intent.actionId,
        gate: this.readGate(input.bundleId),
      };
    if (intent.status === "FAILED" || intent.status === "UNKNOWN")
      return this.stoppedAction(intent, input.bundleId);
    const bundle = this.requireBundle(input.bundleId);
    if (
      input.expectedActionVersion !== undefined &&
      input.expectedActionVersion !== intent.version
    )
      return {
        outcome: "REJECTED",
        actionId: intent.actionId,
        gate: this.readGate(bundle.bundleId),
        reason: reason(
          "STALE_ACTION_VERSION",
          "The F22 action changed before confirmation.",
          "Only the durable action owner may continue an action intent.",
          "RELOAD",
        ),
      };
    if (
      input.choice === "KEEP_AND_CANCEL" &&
      intent.status === "PENDING" &&
      (intent.phase === "ADMITTED" || intent.phase === "PREVIEW_READY")
    ) {
      const cancelled = this.advanceAction(intent, {
        phase: "CANCELLED",
        status: "CANCELLED",
        choice: input.choice,
      });
      this.options.persistence.updateAction({
        action: cancelled,
        expectedVersion: intent.version,
      });
      return {
        outcome: "CANCELLED",
        actionId: intent.actionId,
        gate: this.readGate(input.bundleId),
      };
    }
    const preview = this.previewFromAction<F22ReevaluationPreview>(
      intent,
      f22ReevaluationPreviewSchema,
    );
    if (preview === undefined)
      return this.attentionAction(
        intent,
        bundle,
        "F22_REEVALUATION_PREVIEW_MISSING",
        "The re-evaluation preview is missing and cannot authorize new work.",
      );
    if (bundle.version !== intent.expectedBundleVersion)
      return {
        outcome: "REJECTED",
        actionId: intent.actionId,
        gate: this.readGate(bundle.bundleId),
        reason: reason(
          "STALE_BUNDLE_VERSION",
          "The Review Bundle changed after this F22 action was previewed.",
          "F22 will not apply a worktree, F11, or F18 effect to a stale bundle snapshot.",
          "RELOAD",
        ),
      };
    if (input.choice === "KEEP_AND_CANCEL")
      return {
        outcome: "REJECTED",
        actionId: intent.actionId,
        gate: this.readGate(bundle.bundleId),
        reason: reason(
          "F22_ACTION_ALREADY_STARTED",
          "This F22 action has already started a delegated effect and cannot be cancelled at this phase.",
          "Keep Worktree and Cancel is a no-effect choice only before worktree or hold effects begin.",
          "RECONCILE",
        ),
      };
    const refreshed = await this.refreshRemoteHead(input.bundleId);
    const gate = refreshed.gate;
    if (!remoteObservationAllowsAction(refreshed.observation))
      return {
        outcome: "REJECTED",
        actionId: intent.actionId,
        gate,
        reason: this.gatedReason(gate, "RE_EVALUATE"),
      };
    if (!gate.actions.reevaluate)
      return {
        outcome: "REJECTED",
        actionId: intent.actionId,
        gate,
        reason: this.gatedReason(gate, "RE_EVALUATE"),
      };
    if (
      (input.expectedGateRevision ?? intent.expectedGateRevision) !==
      gate.gateRevision
    )
      return {
        outcome: "REJECTED",
        actionId: intent.actionId,
        gate,
        reason: reason(
          "STALE_GATE_REVISION",
          "The F22 action gate changed before confirmation.",
          "F22 rejects stale renderer intent without repeating a worktree or F11 effect.",
          "RELOAD",
        ),
      };
    if (!choiceAllowedForPreview(input.choice, preview.requiredChoice))
      return {
        outcome: "REJECTED",
        actionId: intent.actionId,
        gate,
        reason: reason(
          "WORKTREE_CHOICE_NOT_REQUIRED",
          "The selected clear choice does not match the recorded worktree condition.",
          "A clean worktree cannot be passed to a destructive F13 clear operation.",
          "SELECT_WORKTREE_CHOICE",
        ),
      };
    if (input.confirmed !== true)
      return {
        outcome: "REJECTED",
        actionId: intent.actionId,
        gate,
        reason: reason(
          input.choice === "CLEAR_ALL"
            ? "DESTRUCTIVE_CONFIRMATION_REQUIRED"
            : "EXPLICIT_CONFIRMATION_REQUIRED",
          input.choice === "CLEAR_ALL"
            ? "Clear All Changes requires explicit confirmation."
            : "This F22 choice requires explicit confirmation.",
          "F22 never turns a worktree choice into an implicit discard or replacement.",
          "CONFIRM",
        ),
      };
    if (
      refreshed.observation.outcome === "MALFORMED" ||
      refreshed.read.outcome !== "CURRENT" ||
      refreshed.read.baseSha === undefined ||
      refreshed.read.headSha === undefined ||
      refreshed.read.headSha !== preview.remote.observedHeadSha ||
      refreshed.read.baseSha !== preview.remote.observedBaseSha ||
      refreshed.read.observationRevision !== preview.remote.observationRevision
    )
      return {
        outcome: "REJECTED",
        actionId: intent.actionId,
        gate,
        reason: reason(
          "STALE_REEVALUATION_PREVIEW",
          "The remote head changed after the re-evaluation preview was prepared.",
          "F22 requires a new preview before it can authorize a fresh operation at the exact current head.",
          "REFRESH_EVIDENCE",
        ),
      };
    let currentInspection: F13InspectionResult;
    try {
      currentInspection = await this.inspect(bundle);
    } catch {
      return this.failAction(
        intent,
        bundle,
        "WORKTREE_INSPECTION_FAILED",
        "The operation worktree could not be freshly inspected before re-evaluation.",
      );
    }
    if (!currentInspection.ok)
      return this.failAction(
        intent,
        bundle,
        "WORKTREE_INSPECTION_FAILED",
        "The operation worktree could not be freshly inspected before re-evaluation.",
      );
    if (
      worktreeConditionChanged(
        preview.worktreeCondition,
        currentInspection.condition,
      )
    )
      return this.failAction(
        intent,
        bundle,
        "STALE_WORKTREE_CONDITION",
        "The operation worktree changed after the re-evaluation preview was prepared.",
      );
    if (
      !choiceAllowedForPreview(
        input.choice,
        requiredChoice(currentInspection.condition),
      )
    )
      return this.failAction(
        intent,
        bundle,
        "WORKTREE_CHOICE_NOT_REQUIRED",
        "The selected clear choice no longer matches the freshly inspected worktree condition.",
      );
    let working = this.advanceAction(intent, {
      phase: "CHOICE_CONFIRMED",
      choice: input.choice,
      confirmed: input.confirmed === true,
    });
    this.options.persistence.updateAction({
      action: working,
      expectedVersion: intent.version,
    });
    const clearChoice = f13Choice(input.choice);
    if (clearChoice !== undefined) {
      working = this.advanceAction(working, { phase: "CLEARING_WORKTREE" });
      this.options.persistence.updateAction({
        action: working,
        expectedVersion: working.version - 1,
      });
      let cleared: Awaited<ReturnType<F22F13Port["clearChanges"]>>;
      try {
        cleared = await this.options.f13.clearChanges({
          operationId: bundle.operationId,
          ownerId: bundle.bundleId,
          choice: clearChoice,
          actionId: working.actionId,
          confirmed: input.confirmed,
          ...(preview.worktreeCondition?.attribution.beforeSnapshotId ===
          undefined
            ? {}
            : {
                beforeSnapshotId:
                  preview.worktreeCondition.attribution.beforeSnapshotId,
              }),
          ...(preview.worktreeCondition?.attribution.afterSnapshotId ===
          undefined
            ? {}
            : {
                afterSnapshotId:
                  preview.worktreeCondition.attribution.afterSnapshotId,
              }),
        });
      } catch {
        return this.unknownAction(
          working,
          bundle,
          "WORKTREE_CLEAR_UNCERTAIN",
          "The selected worktree clear did not return a durable outcome; F22 preserved the worktree for reconciliation.",
        );
      }
      if (!cleared.ok)
        return this.failAction(
          working,
          bundle,
          cleared.reason?.code ?? "WORKTREE_CLEAR_FAILED",
          cleared.reason?.what ??
            "The selected worktree choice did not complete.",
        );
      const boundedClearResult = f22ActionResultSchema.safeParse({
        removed: [...cleared.removed],
        preserved: [...cleared.preserved],
        remaining: [...cleared.remaining],
      });
      if (!boundedClearResult.success)
        return this.unknownAction(
          working,
          bundle,
          "UNSAFE_PATH_EVIDENCE",
          "F13 returned path evidence that F22 could not safely persist; the worktree and hold remain for reconciliation.",
        );
      working = this.advanceAction(working, {
        phase: "POST_CLEAR_REVALIDATION",
        result: {
          choice: input.choice,
          removed: boundedClearResult.data.removed,
          preserved: boundedClearResult.data.preserved,
          remaining: boundedClearResult.data.remaining,
        },
      });
      this.options.persistence.updateAction({
        action: working,
        expectedVersion: working.version - 1,
      });
    }
    let postInspection: F13InspectionResult;
    try {
      postInspection = await this.inspect(bundle);
    } catch {
      return this.unknownAction(
        working,
        bundle,
        "POST_CLEAR_REVALIDATION_UNCERTAIN",
        "The worktree re-inspection did not return a durable outcome; F22 preserved the bundle for reconciliation.",
      );
    }
    if (!postInspection.ok)
      return this.failAction(
        working,
        bundle,
        "POST_CLEAR_REVALIDATION_FAILED",
        "The worktree could not be re-inspected before the new evaluation was authorized.",
      );
    if (!postClearConditionSafe(input.choice, postInspection.condition))
      return this.failAction(
        working,
        bundle,
        "POST_CLEAR_CONDITION_UNSAFE",
        "The post-choice worktree condition is not safe enough to transfer the Review Bundle owner.",
      );
    const finalRemote = await this.refreshRemoteHead(input.bundleId);
    if (
      !remoteObservationAllowsAction(finalRemote.observation) ||
      finalRemote.read.outcome !== "CURRENT" ||
      finalRemote.read.baseSha === undefined ||
      finalRemote.read.headSha === undefined ||
      finalRemote.read.headSha !== preview.remote.observedHeadSha ||
      finalRemote.read.baseSha !== preview.remote.observedBaseSha ||
      finalRemote.read.observationRevision !==
        preview.remote.observationRevision ||
      finalRemote.gate.remote.observationToken === undefined ||
      preview.remote.observationToken === undefined ||
      finalRemote.gate.remote.observationToken ===
        preview.remote.observationToken ||
      !remoteIdentityEqual(
        finalRemote.read.identity,
        preview.remote.observedIdentity ?? preview.remote.identity,
      ) ||
      !f22RemoteRepositoryEqual(
        finalRemote.read.baseRepository,
        preview.remote.observedBaseRepository,
      ) ||
      !f22RemoteRepositoryEqual(
        finalRemote.read.headRepository,
        preview.remote.observedHeadRepository,
      ) ||
      finalRemote.read.baseBranch !== preview.remote.observedBaseBranch ||
      finalRemote.read.headBranch !== preview.remote.observedHeadBranch
    )
      return this.failAction(
        working,
        bundle,
        "STALE_REEVALUATION_REMOTE_AFTER_WORKTREE_CHOICE",
        "The authoritative remote head changed or became unavailable while the worktree choice was being completed.",
      );
    const activeClaim = this.options.f11.getActiveClaim(bundle.managedPrId);
    const activeHold = this.options.f11.getActiveHold(bundle.managedPrId);
    if (activeClaim === undefined || activeHold === undefined)
      return this.failAction(
        working,
        bundle,
        "F11_HOLD_MISSING",
        "The active F11 hold disappeared before re-evaluation could transfer ownership.",
      );
    const eventVersionIds = [
      ...new Set([
        ...preview.originalEventVersionIds,
        ...preview.selectedRetainedEventVersionIds,
      ]),
    ];
    const newBundleId = `f22-bundle-${hash(`${intent.actionId}:${preview.remote.observedHeadSha}`)}`;
    const newOperationId = `f22-operation-${hash(`${intent.actionId}:${preview.remote.observedHeadSha}`)}`;
    const newClaimId = `f22-claim-${hash(`${intent.actionId}:${preview.remote.observedHeadSha}`)}`;
    const newHoldId = `f22-hold-${hash(`${intent.actionId}:${preview.remote.observedHeadSha}`)}`;
    let updated = this.advanceAction(working, {
      phase: "HOLD_HANDOFF",
      newBundleId,
      newOperationId,
      newClaimId,
      newHoldId,
    });
    this.options.persistence.updateAction({
      action: updated,
      expectedVersion: working.version,
    });
    let transferred: ReturnType<F22F11Port["transferForReevaluation"]>;
    try {
      transferred = this.options.f11.transferForReevaluation({
        managedPrId: bundle.managedPrId,
        oldClaimId: activeClaim.claimId,
        oldHoldId: activeHold.holdId,
        oldOperationId: bundle.operationId,
        oldBundleId: bundle.bundleId,
        newClaimId,
        newHoldId,
        newOperationId,
        newBundleId,
        eventVersionIds,
        configurationSnapshot: activeClaim.configurationSnapshot,
        correlationId: `f22-${hash(intent.actionId)}`,
        authorizationId: intent.actionId,
        authorizationToken: f11ReevaluationAuthorizationToken({
          managedPrId: bundle.managedPrId,
          oldClaimId: activeClaim.claimId,
          oldHoldId: activeHold.holdId,
          oldOperationId: bundle.operationId,
          oldBundleId: bundle.bundleId,
          newClaimId,
          newHoldId,
          newOperationId,
          newBundleId,
          eventVersionIds,
          authorizationId: intent.actionId,
          expectedOldClaimVersion: activeClaim.version,
          expectedOldHoldVersion: activeHold.version,
        }),
        expectedOldClaimVersion: activeClaim.version,
        expectedOldHoldVersion: activeHold.version,
      });
    } catch {
      return this.unknownAction(
        updated,
        bundle,
        "F11_REEVALUATION_TRANSFER_UNCERTAIN",
        "The F11 hold transfer did not return a durable outcome; F22 preserved the old bundle for reconciliation.",
      );
    }
    if (transferred.outcome === "CONFLICT")
      return this.failAction(
        updated,
        bundle,
        "F11_REEVALUATION_TRANSFER_CONFLICT",
        "The F11 hold could not be transferred atomically to the new evaluation identity.",
      );
    updated = this.advanceAction(updated, { phase: "F16_SNAPSHOT" });
    this.options.persistence.updateAction({
      action: updated,
      expectedVersion: updated.version - 1,
    });
    let authorizedSnapshot: F16EffectiveAITaskSnapshot | undefined;
    let authorizedConfiguration = preview.configuration;
    if (this.options.tasks?.resolveCurrent !== undefined) {
      try {
        authorizedSnapshot = f16EffectiveAITaskSnapshotSchema.parse(
          await this.options.tasks.resolveCurrent({
            operationId: newOperationId,
            managedPrId: bundle.managedPrId,
            repository: bundle.input.pullRequest.baseRepository,
          }),
        );
        if (
          authorizedSnapshot.taskType !== "AUTOMATIC_REVIEW_REEVALUATION" ||
          authorizedSnapshot.phase !== "REVIEW_PROPOSAL"
        )
          throw new Error("F16_REEVALUATION_TASK_SNAPSHOT_INVALID");
        authorizedConfiguration = configurationSummaryFromTaskSnapshot(
          summaryFromF16Snapshot(authorizedSnapshot),
        );
      } catch {
        const rolledBack = this.options.f11.rollbackForReevaluation?.({
          managedPrId: bundle.managedPrId,
          oldClaimId: activeClaim.claimId,
          oldHoldId: activeHold.holdId,
          oldOperationId: bundle.operationId,
          oldBundleId: bundle.bundleId,
          newClaimId,
          newHoldId,
          newOperationId,
          newBundleId,
          originalEventVersionIds: preview.originalEventVersionIds,
          retainedEventVersionIds: preview.selectedRetainedEventVersionIds,
        });
        return rolledBack === undefined || rolledBack.outcome === "CONFLICT"
          ? this.unknownAction(
              updated,
              bundle,
              "F11_REEVALUATION_ROLLBACK_REQUIRED",
              "The authorized F16 task snapshot was unavailable and F11 could not prove that the original hold was restored.",
            )
          : this.failAction(
              updated,
              bundle,
              "F16_REEVALUATION_SNAPSHOT_UNAVAILABLE",
              "The authorized F16 task snapshot was unavailable; the original F11 owner was restored.",
            );
      }
    }
    updated = this.advanceAction(updated, {
      result: {
        ...(asRecord(updated.result) ?? {}),
        currentF16Configuration: authorizedConfiguration,
        ...(authorizedSnapshot === undefined
          ? {}
          : {
              currentF16SnapshotId: authorizedSnapshot.snapshotId,
              currentF16SnapshotHash: authorizedSnapshot.snapshotHash,
            }),
      },
    });
    this.options.persistence.updateAction({
      action: updated,
      expectedVersion: updated.version - 1,
    });
    const handoff: F18AutomaticReviewHandoff = {
      batchId: `f22-batch-${hash(`${intent.actionId}:${preview.remote.observedHeadSha}`)}`,
      managedPrId: bundle.managedPrId,
      eventVersionIds,
      operationId: newOperationId,
      bundleId: newBundleId,
      claimId: newClaimId,
      holdId: newHoldId,
      currentBaseSha: finalRemote.read.baseSha,
      currentHeadSha: finalRemote.read.headSha,
      schedulerRevision:
        this.options.schedulerRevision?.() ?? bundle.input.schedulerRevision,
      correlationId: `f22-${hash(intent.actionId)}`,
      explicitHumanAuthorization: true,
      parentBundleId: bundle.bundleId,
      reevaluationAuthorizationId: intent.actionId,
      ...(authorizedSnapshot === undefined
        ? {}
        : { currentTaskSnapshot: authorizedSnapshot }),
    };
    const handedOff = this.advanceAction(updated, { phase: "F18_HANDOFF" });
    this.options.persistence.updateAction({
      action: handedOff,
      expectedVersion: updated.version,
    });
    let accepted: Awaited<
      ReturnType<F18AutomaticReviewBoundary["startAutomaticReview"]>
    >;
    try {
      accepted = await this.options.bundles.startAutomaticReview(handoff);
    } catch {
      return this.unknownAction(
        handedOff,
        bundle,
        "F18_REEVALUATION_UNCERTAIN",
        "The fresh Review Bundle handoff did not return a durable outcome; F22 preserved the transferred owner for reconciliation.",
      );
    }
    if (accepted.outcome === "UNCERTAIN")
      return this.unknownAction(
        handedOff,
        bundle,
        "F18_REEVALUATION_UNCERTAIN",
        "F18 returned an uncertain handoff outcome; F22 preserved the transferred owner for reconciliation.",
      );
    if (
      accepted.outcome !== "ACCEPTED" &&
      accepted.outcome !== "ALREADY_ACCEPTED"
    ) {
      if (accepted.rollbackSafe !== true)
        return this.unknownAction(
          handedOff,
          bundle,
          "F18_REEVALUATION_REJECTION_UNCERTAIN",
          "F18 rejected the fresh Review Bundle without proving that no downstream effect committed; F22 preserved the transferred owner for reconciliation.",
        );
      const rolledBack = this.options.f11.rollbackForReevaluation?.({
        managedPrId: bundle.managedPrId,
        oldClaimId: activeClaim.claimId,
        oldHoldId: activeHold.holdId,
        oldOperationId: bundle.operationId,
        oldBundleId: bundle.bundleId,
        newClaimId,
        newHoldId,
        newOperationId,
        newBundleId,
        originalEventVersionIds: preview.originalEventVersionIds,
        retainedEventVersionIds: preview.selectedRetainedEventVersionIds,
      });
      const rollbackFailed =
        rolledBack === undefined || rolledBack.outcome === "CONFLICT";
      return rollbackFailed
        ? this.unknownAction(
            handedOff,
            bundle,
            "F11_REEVALUATION_ROLLBACK_REQUIRED",
            "F18 refused the fresh Review Bundle and F11 could not prove that the original hold was restored.",
          )
        : this.failAction(
            handedOff,
            bundle,
            "F18_REEVALUATION_REJECTED",
            accepted.reason?.what ??
              "The fresh Review Bundle was not accepted; the original F11 owner was restored.",
          );
    }
    const newModel = this.options.bundles.getReadModel?.(newBundleId);
    if (newModel === undefined)
      return (() => {
        const recovered = this.reconcileTransferredReevaluation(
          handedOff,
          bundle,
        );
        return recovered === undefined
          ? this.unknownAction(
              handedOff,
              bundle,
              "F18_REEVALUATION_RESULT_MISSING",
              "F18 accepted the fresh identity but its durable read model is not available for reconciliation.",
            )
          : {
              outcome: "ATTENTION" as const,
              actionId: recovered.actionId,
              gate: this.readGate(bundle.bundleId),
              ...(recovered.reason === undefined
                ? {}
                : { reason: recovered.reason }),
            };
      })();
    if (newModel.input.taskSnapshot === undefined)
      return this.unknownAction(
        handedOff,
        bundle,
        "F16_REEVALUATION_SNAPSHOT_MISSING",
        "F18 accepted the fresh identity without persisting the post-authorization F16 task snapshot.",
      );
    if (
      authorizedSnapshot !== undefined &&
      (newModel.input.taskSnapshot.snapshotId !==
        authorizedSnapshot.snapshotId ||
        newModel.input.taskSnapshot.snapshotHash !==
          authorizedSnapshot.snapshotHash)
    )
      return this.unknownAction(
        handedOff,
        bundle,
        "F16_REEVALUATION_SNAPSHOT_PROVENANCE_MISMATCH",
        "F18 persisted a task snapshot that does not match the post-authorization F16 snapshot bound by F22.",
      );
    if (
      !successorRemoteMatchesBundle(
        newModel,
        finalRemote.read,
        preview.remote.identity,
      ) ||
      !successorWorktreeMatchesBundle(bundle, newModel, {
        ...handedOff,
        newOperationId,
      })
    )
      return this.unknownAction(
        handedOff,
        bundle,
        "F22_REEVALUATION_SUCCESSOR_EVIDENCE_MISMATCH",
        "F18 accepted a successor without persisting the exact current remote references and fresh F13 worktree baseline bound by F22.",
      );
    const oldState = this.registerBundle(bundle);
    const superseded = this.advanceState(
      oldState,
      "SUPERSEDED",
      reason(
        "RE_EVALUATED",
        "A fresh Review Bundle was started at the current pull-request head.",
        "The old bundle remains inspectable and its F11 hold was transferred to the new identity.",
        "OPEN_NEW_BUNDLE",
      ),
      postInspection.condition,
      newBundleId,
    );
    this.saveState(oldState, superseded);
    const newState = this.registerBundle(newModel, bundle.bundleId);
    const done = this.advanceAction(handedOff, {
      phase: "COMPLETED",
      status: "COMPLETED",
      result: {
        ...(asRecord(handedOff.result) ?? {}),
        newBundleId,
        newOperationId,
        newClaimId,
        newHoldId,
      },
    });
    this.options.persistence.updateAction({
      action: done,
      expectedVersion: handedOff.version,
    });
    return {
      outcome: "COMPLETED",
      actionId: done.actionId,
      newBundleId,
      gate: this.gate(newModel, newState),
    };
  }

  public async reconcileStartup(): Promise<readonly F22ActionIntent[]> {
    const pending = this.options.persistence.listPendingActions();
    const reconciled: F22ActionIntent[] = [];
    for (const action of pending) {
      if (action.status !== "PENDING" && action.status !== "UNKNOWN") {
        reconciled.push(action);
        continue;
      }
      const bundle = this.options.bundles.getReadModel?.(action.bundleId);
      if (bundle === undefined) {
        reconciled.push(action);
        continue;
      }
      const newBundleId = action.newBundleId;
      const newBundle =
        newBundleId === undefined
          ? undefined
          : this.options.bundles.getReadModel?.(newBundleId);
      if (newBundle !== undefined) {
        if (!this.reevaluationBundleMatchesAction(action, bundle, newBundle)) {
          if (action.status === "UNKNOWN") {
            reconciled.push(action);
            continue;
          }
          const mismatch = reason(
            "F22_REEVALUATION_IDENTITY_MISMATCH",
            "A durable re-evaluation bundle was found, but it does not match the persisted F22 handoff identity.",
            "Startup reconciliation will not adopt a bundle, hold, or event set across an identity boundary that cannot be proven.",
            "RECONCILE",
          );
          const unknown = this.advanceAction(action, {
            phase: "UNKNOWN",
            status: "UNKNOWN",
            reason: mismatch,
          });
          this.options.persistence.updateAction({
            action: unknown,
            expectedVersion: action.version,
          });
          const state = this.registerBundle(bundle);
          if (state.status !== "DISCARDED" && state.status !== "SUPERSEDED") {
            const attention = this.advanceState(
              state,
              "ATTENTION",
              mismatch,
              state.condition,
            );
            this.saveState(state, attention);
          }
          reconciled.push(unknown);
          continue;
        }
        const oldState = this.registerBundle(bundle);
        if (oldState.status !== "SUPERSEDED") {
          const superseded = this.advanceState(
            oldState,
            "SUPERSEDED",
            reason(
              "RE_EVALUATED",
              "A fresh Review Bundle was committed before the previous process stopped.",
              "Startup reconciliation found the durable F18 successor and preserved the old bundle as inspectable history.",
              "OPEN_NEW_BUNDLE",
            ),
            oldState.condition,
            newBundle.bundleId,
          );
          this.saveState(oldState, superseded);
        }
        this.registerBundle(newBundle, bundle.bundleId);
        const completed = this.advanceAction(action, {
          phase: "COMPLETED",
          status: "COMPLETED",
          result: { outcome: "RECONCILED", newBundleId },
        });
        this.options.persistence.updateAction({
          action: completed,
          expectedVersion: action.version,
        });
        reconciled.push(completed);
        continue;
      }
      if (this.discardCommittedInF11(action, bundle)) {
        const state = this.registerBundle(bundle);
        const discarded =
          state.status === "DISCARDED"
            ? state
            : this.advanceState(
                state,
                "DISCARDED",
                reason(
                  "REVIEW_BUNDLE_DISCARDED",
                  "The Review Bundle discard committed before the previous process stopped.",
                  "Startup reconciliation proved the exact F11 claim and hold were completed with the discarded outcome.",
                  "NONE",
                ),
                state.condition,
              );
        if (discarded !== state) this.saveState(state, discarded);
        const completed = this.advanceAction(action, {
          phase: "COMPLETED",
          status: "COMPLETED",
          result: { outcome: "RECONCILED_DISCARD" },
        });
        this.options.persistence.updateAction({
          action: completed,
          expectedVersion: action.version,
        });
        reconciled.push(completed);
        continue;
      }
      if (
        (action.phase === "CLEARING_WORKTREE" ||
          action.phase === "POST_CLEAR_REVALIDATION") &&
        action.choice !== undefined &&
        f13Choice(action.choice) !== undefined
      ) {
        reconciled.push(await this.reconcileInterruptedClear(action, bundle));
        continue;
      }
      if (
        action.action === "REEVALUATE" &&
        action.newBundleId !== undefined &&
        action.newOperationId !== undefined &&
        action.newClaimId !== undefined &&
        action.newHoldId !== undefined &&
        ["HOLD_HANDOFF", "F16_SNAPSHOT", "F18_HANDOFF"].includes(action.phase)
      ) {
        const transferRecovery = this.reconcileTransferredReevaluation(
          action,
          bundle,
        );
        if (transferRecovery !== undefined) {
          reconciled.push(transferRecovery);
          continue;
        }
      }
      if (action.status === "UNKNOWN") {
        reconciled.push(action);
        continue;
      }
      if (action.phase === "ADMITTED" || action.phase === "PREVIEW_READY") {
        reconciled.push(action);
        continue;
      }
      const unknownReason = reason(
        "F22_STARTUP_RECONCILIATION_REQUIRED",
        "F22 stopped during a discard or re-evaluation effect.",
        "The worktree, hold, and downstream handoff are preserved until the owning process can prove which delegated effect committed.",
        "RECONCILE",
      );
      const unknown = this.advanceAction(action, {
        phase: "UNKNOWN",
        status: "UNKNOWN",
        reason: unknownReason,
      });
      this.options.persistence.updateAction({
        action: unknown,
        expectedVersion: action.version,
      });
      const state = this.registerBundle(bundle);
      if (state.status !== "DISCARDED" && state.status !== "SUPERSEDED") {
        const attention = this.advanceState(
          state,
          "ATTENTION",
          unknownReason,
          state.condition,
        );
        this.saveState(state, attention);
      }
      reconciled.push(unknown);
    }
    return reconciled;
  }

  private reconcileTransferredReevaluation(
    action: F22ActionIntent,
    bundle: F18ReviewBundleReadModel,
  ): F22ActionIntent | undefined {
    if (
      action.action !== "REEVALUATE" ||
      action.newBundleId === undefined ||
      action.newOperationId === undefined ||
      action.newClaimId === undefined ||
      action.newHoldId === undefined
    )
      return undefined;
    const oldClaimId = action.claimId ?? bundle.input.claimId;
    const oldHoldId = action.holdId ?? bundle.input.holdId;
    if (
      oldClaimId === undefined ||
      oldHoldId === undefined ||
      this.options.f11.getClaim === undefined ||
      this.options.f11.getHold === undefined
    )
      return this.unknownActionIntent(
        action,
        bundle,
        "F22_REEVALUATION_TRANSFER_RECONCILIATION_REQUIRED",
        "F22 could not read the exact old and new F11 owners needed to reconcile the interrupted re-evaluation transfer.",
      );
    const oldClaim = this.options.f11.getClaim(oldClaimId);
    const oldHold = this.options.f11.getHold(oldHoldId);
    const newClaim = this.options.f11.getClaim(action.newClaimId);
    const newHold = this.options.f11.getHold(action.newHoldId);
    const oldOwnerMatches =
      oldClaim?.managedPrId === bundle.managedPrId &&
      oldClaim.operationId === bundle.operationId &&
      oldClaim.bundleId === bundle.bundleId &&
      oldHold?.managedPrId === bundle.managedPrId &&
      oldHold.claimId === oldClaimId &&
      oldHold.operationId === bundle.operationId &&
      oldHold.bundleId === bundle.bundleId;
    const newOwnerMatches =
      newClaim?.managedPrId === bundle.managedPrId &&
      newClaim.operationId === action.newOperationId &&
      newClaim.bundleId === action.newBundleId &&
      newHold?.managedPrId === bundle.managedPrId &&
      newHold.claimId === action.newClaimId &&
      newHold.operationId === action.newOperationId &&
      newHold.bundleId === action.newBundleId;
    const oldActive =
      oldOwnerMatches &&
      oldClaim?.state === "ACTIVE" &&
      oldHold?.state === "ACTIVE";
    const oldReleased =
      oldOwnerMatches &&
      oldClaim?.state === "RELEASED" &&
      oldHold?.state === "RELEASED";
    const newActive =
      newOwnerMatches &&
      newClaim?.state === "ACTIVE" &&
      newHold?.state === "ACTIVE";
    const newReleased =
      newOwnerMatches &&
      newClaim?.state === "RELEASED" &&
      newHold?.state === "RELEASED";
    if (oldActive && newClaim === undefined && newHold === undefined)
      return this.reconciledReevaluationFailure(
        action,
        bundle,
        "F22_REEVALUATION_TRANSFER_NOT_COMMITTED",
        "The interrupted re-evaluation stopped before F11 transferred ownership; the original hold remains authoritative.",
        "RECONCILED_REEVALUATION_NO_TRANSFER",
      );
    if (oldActive && newReleased)
      return this.reconciledReevaluationFailure(
        action,
        bundle,
        "F22_REEVALUATION_ROLLBACK_RECONCILED",
        "The interrupted re-evaluation transfer was already compensated and the original F11 owner is active again.",
        "RECONCILED_REEVALUATION_ROLLBACK",
      );
    if (!oldReleased || !newActive)
      return this.unknownActionIntent(
        action,
        bundle,
        "F22_REEVALUATION_TRANSFER_RECONCILIATION_REQUIRED",
        "F22 found an inconsistent old/new F11 owner state and preserved both identities for explicit reconciliation.",
      );
    const rollback = this.options.f11.rollbackForReevaluation;
    if (rollback === undefined)
      return this.unknownActionIntent(
        action,
        bundle,
        "F22_REEVALUATION_ROLLBACK_REQUIRED",
        "The new F11 owner is active without a durable successor bundle, but the configured F11 boundary cannot compensate it.",
      );
    let result: ReturnType<NonNullable<F22F11Port["rollbackForReevaluation"]>>;
    try {
      result = rollback({
        managedPrId: bundle.managedPrId,
        oldClaimId,
        oldHoldId,
        oldOperationId: bundle.operationId,
        oldBundleId: bundle.bundleId,
        newClaimId: action.newClaimId,
        newHoldId: action.newHoldId,
        newOperationId: action.newOperationId,
        newBundleId: action.newBundleId,
        originalEventVersionIds: action.originalEventVersionIds,
        retainedEventVersionIds: action.retainedEventVersionIds,
      });
    } catch {
      return this.unknownActionIntent(
        action,
        bundle,
        "F22_REEVALUATION_ROLLBACK_REQUIRED",
        "The new F11 owner is active without a durable successor bundle, but compensating the transfer did not return a durable outcome.",
      );
    }
    if (result.outcome === "ROLLED_BACK" || result.outcome === "REPLAYED")
      return this.reconciledReevaluationFailure(
        action,
        bundle,
        "F22_REEVALUATION_ROLLBACK_RECONCILED",
        "F22 compensated the transferred F11 owner because F18 did not leave a durable successor bundle.",
        "RECONCILED_REEVALUATION_ROLLBACK",
      );
    return this.unknownActionIntent(
      action,
      bundle,
      "F22_REEVALUATION_ROLLBACK_REQUIRED",
      "The new F11 owner is active without a durable successor bundle, and F11 refused the exact compensating rollback.",
    );
  }

  private reconciledReevaluationFailure(
    action: F22ActionIntent,
    bundle: F18ReviewBundleReadModel,
    code: string,
    what: string,
    outcome: string,
  ): F22ActionIntent {
    const failure = reason(
      code,
      what,
      "F22 stopped the re-evaluation without starting another provider turn and preserved the original bundle for an explicit new action.",
      "RE_EVALUATE",
    );
    const failed = this.advanceAction(action, {
      phase: "FAILED",
      status: "FAILED",
      reason: failure,
      result: {
        ...(asRecord(action.result) ?? {}),
        outcome,
      },
    });
    this.options.persistence.updateAction({
      action: failed,
      expectedVersion: action.version,
    });
    const state = this.registerBundle(bundle);
    if (state.status !== "DISCARDED" && state.status !== "SUPERSEDED") {
      const attention = this.advanceState(
        state,
        "ATTENTION",
        failure,
        state.condition,
      );
      this.saveState(state, attention);
    }
    return failed;
  }

  private async reconcileInterruptedClear(
    action: F22ActionIntent,
    bundle: F18ReviewBundleReadModel,
  ): Promise<F22ActionIntent> {
    const choice = action.choice;
    if (choice === undefined || f13Choice(choice) === undefined) return action;
    let inspection: F13InspectionResult | undefined;
    try {
      inspection = await this.inspect(bundle);
    } catch {
      inspection = undefined;
    }
    const preview =
      action.action === "DISCARD"
        ? this.previewFromAction<F22DiscardPreview>(
            action,
            f22DiscardPreviewSchema,
          )
        : this.previewFromAction<F22ReevaluationPreview>(
            action,
            f22ReevaluationPreviewSchema,
          );
    const delegatedChoice = f13Choice(choice);
    let clearEvidence: F22F13ClearActionEvidence | undefined;
    try {
      clearEvidence = this.options.f13.readClearAction?.({
        actionId: action.actionId,
        operationId: bundle.operationId,
        ownerId: bundle.bundleId,
        choice: delegatedChoice!,
      });
    } catch {
      clearEvidence = undefined;
    }
    const clearEvidenceMatches =
      clearEvidence !== undefined &&
      clearEvidence.actionId === action.actionId &&
      clearEvidence.operationId === bundle.operationId &&
      clearEvidence.choice === delegatedChoice;
    const clearCommitted =
      clearEvidenceMatches &&
      clearEvidence?.status === "COMPLETED" &&
      clearEvidence?.afterSnapshotId !== undefined &&
      inspection?.ok === true &&
      postClearConditionSafe(choice, inspection.condition);
    const clearNotCommitted =
      clearEvidenceMatches &&
      clearEvidence?.status === "BLOCKED" &&
      inspection?.ok === true &&
      preview?.worktreeCondition !== undefined &&
      !worktreeConditionChanged(
        preview.worktreeCondition,
        inspection.condition,
      );
    const clearReconciliation = clearCommitted
      ? "COMMITTED"
      : clearNotCommitted
        ? "NOT_COMMITTED"
        : "UNCERTAIN";
    const clearReason = clearCommitted
      ? reason(
          "F22_CLEAR_COMMITTED_REQUIRES_RECONCILIATION",
          "F13 evidence proves that the requested worktree clear committed before restart.",
          "F22 will not repeat the clear; the remaining discard or re-evaluation handoff still requires explicit reconciliation.",
          "RECONCILE",
        )
      : clearNotCommitted
        ? reason(
            "F22_CLEAR_NOT_COMMITTED",
            "F13 evidence shows that the requested worktree clear did not commit before restart.",
            "F22 preserved the original worktree and will not retry the clear automatically.",
            "INSPECT",
          )
        : reason(
            "F22_CLEAR_RECONCILIATION_REQUIRED",
            "F22 could not prove whether the delegated worktree clear committed before restart.",
            "The worktree and durable action owner remain preserved without retrying or claiming success.",
            "RECONCILE",
          );
    let reconciled = this.advanceAction(action, {
      phase: "POST_CLEAR_REVALIDATION",
      status: "UNKNOWN",
      reason: clearReason,
      result: {
        ...(asRecord(action.result) ?? {}),
        clearReconciliation,
      },
    });
    this.options.persistence.updateAction({
      action: reconciled,
      expectedVersion: action.version,
    });
    if (clearCommitted && action.action === "DISCARD") {
      const claimId = action.claimId ?? bundle.input.claimId;
      const operationId = action.operationId ?? bundle.operationId;
      try {
        const completedDiscard = this.options.f11.completeDiscard({
          managedPrId: bundle.managedPrId,
          claimId,
          operationId,
          bundleId: bundle.bundleId,
        });
        if (
          completedDiscard.outcome === "RELEASED" ||
          completedDiscard.outcome === "REPLAYED"
        ) {
          const state = this.registerBundle(bundle);
          const discarded =
            state.status === "DISCARDED"
              ? state
              : this.advanceState(
                  state,
                  "DISCARDED",
                  reason(
                    "REVIEW_BUNDLE_DISCARDED",
                    "The interrupted discard clear and F11 handled outcome were reconciled.",
                    "F22 proved the worktree clear and reused the same durable discard identity without repeating the clear.",
                    "NONE",
                  ),
                  inspection?.condition ?? state.condition,
                );
          if (discarded !== state) this.saveState(state, discarded);
          reconciled = this.advanceAction(reconciled, {
            phase: "COMPLETED",
            status: "COMPLETED",
            result: {
              ...(asRecord(reconciled.result) ?? {}),
              outcome: "RECONCILED_CLEAR_AND_DISCARD",
            },
          });
          this.options.persistence.updateAction({
            action: reconciled,
            expectedVersion: reconciled.version - 1,
          });
        }
      } catch {
        // The bounded UNKNOWN action remains authoritative for the next retry.
      }
    }
    if (
      reconciled.status !== "COMPLETED" &&
      action.action === "REEVALUATE" &&
      (clearCommitted || clearNotCommitted)
    ) {
      reconciled = this.reconciledReevaluationFailure(
        reconciled,
        bundle,
        clearCommitted
          ? "F22_REEVALUATION_CLEAR_COMMITTED_REQUIRES_REVIEW"
          : "F22_REEVALUATION_CLEAR_NOT_COMMITTED",
        clearCommitted
          ? "The re-evaluation clear committed before restart, but no successor operation was admitted; the old bundle remains held for an explicit new re-evaluation."
          : "The re-evaluation clear did not commit before restart; the old bundle remains held and the choice can be reconsidered in a new explicit action.",
        clearCommitted
          ? "RECONCILED_REEVALUATION_CLEAR"
          : "RECONCILED_REEVALUATION_CLEAR_NOT_COMMITTED",
      );
    }
    if (reconciled.status !== "COMPLETED") {
      const state = this.registerBundle(bundle);
      if (state.status !== "DISCARDED" && state.status !== "SUPERSEDED") {
        const attention = this.advanceState(
          state,
          "ATTENTION",
          reconciled.reason ?? clearReason,
          inspection?.condition ?? state.condition,
        );
        this.saveState(state, attention);
      }
    }
    return reconciled;
  }

  private discardCommittedInF11(
    action: F22ActionIntent,
    bundle: F18ReviewBundleReadModel,
  ): boolean {
    if (action.action !== "DISCARD") return false;
    const claimId = action.claimId ?? bundle.input.claimId;
    const operationId = action.operationId ?? bundle.operationId;
    const claim = this.options.f11.getClaim?.(claimId);
    if (
      claim === undefined ||
      claim.managedPrId !== bundle.managedPrId ||
      claim.operationId !== operationId ||
      claim.bundleId !== bundle.bundleId ||
      claim.state !== "HANDLED" ||
      claim.outcome !== "DISCARDED"
    )
      return false;
    const holdId = action.holdId ?? bundle.input.holdId;
    if (holdId === undefined) return true;
    const hold = this.options.f11.getHold?.(holdId);
    return (
      hold !== undefined &&
      hold.managedPrId === bundle.managedPrId &&
      hold.claimId === claimId &&
      hold.operationId === operationId &&
      hold.bundleId === bundle.bundleId &&
      hold.state === "RELEASED" &&
      hold.outcome === "DISCARDED"
    );
  }

  private reevaluationBundleMatchesAction(
    action: F22ActionIntent,
    oldBundle: F18ReviewBundleReadModel,
    newBundle: F18ReviewBundleReadModel,
  ): boolean {
    if (
      action.action !== "REEVALUATE" ||
      action.newBundleId === undefined ||
      action.newOperationId === undefined ||
      action.newClaimId === undefined ||
      action.newHoldId === undefined
    )
      return false;
    const expectedEventVersionIds = [
      ...new Set([
        ...action.originalEventVersionIds,
        ...action.retainedEventVersionIds,
      ]),
    ];
    const input = newBundle.input;
    const result = asRecord(action.result);
    const expectedF16SnapshotId =
      typeof result?.currentF16SnapshotId === "string"
        ? result.currentF16SnapshotId
        : undefined;
    const expectedF16SnapshotHash =
      typeof result?.currentF16SnapshotHash === "string"
        ? result.currentF16SnapshotHash
        : undefined;
    const currentF16Configuration = asRecord(result?.currentF16Configuration);
    const expectedPrIntentContextHash =
      typeof currentF16Configuration?.prIntentContextHash === "string"
        ? currentF16Configuration.prIntentContextHash
        : undefined;
    const taskSnapshot = input.taskSnapshot;
    const snapshotProvenanceMatches =
      expectedF16SnapshotId === undefined &&
      expectedF16SnapshotHash === undefined
        ? true
        : taskSnapshot !== undefined &&
          taskSnapshot.snapshotId === expectedF16SnapshotId &&
          taskSnapshot.snapshotHash === expectedF16SnapshotHash;
    const contextProvenanceMatches =
      expectedPrIntentContextHash === undefined ||
      taskSnapshot?.prIntentContextHash === expectedPrIntentContextHash;
    const previewResult = f22ReevaluationPreviewSchema.safeParse(
      result?.preview,
    );
    const persistedEvidenceMatches =
      previewResult.success &&
      successorRemoteMatchesBundle(
        newBundle,
        persistedSuccessorRemote(previewResult.data),
        previewResult.data.remote.identity,
      ) &&
      successorWorktreeMatchesBundle(oldBundle, newBundle, action);
    return (
      newBundle.bundleId === action.newBundleId &&
      newBundle.managedPrId === oldBundle.managedPrId &&
      newBundle.operationId === action.newOperationId &&
      input.bundleId === action.newBundleId &&
      input.operationId === action.newOperationId &&
      input.managedPrId === oldBundle.managedPrId &&
      input.claimId === action.newClaimId &&
      input.holdId === action.newHoldId &&
      input.parentBundleId === oldBundle.bundleId &&
      input.reevaluationAuthorizationId === action.actionId &&
      snapshotProvenanceMatches &&
      contextProvenanceMatches &&
      persistedEvidenceMatches &&
      input.remoteEventVersionIds.length === expectedEventVersionIds.length &&
      input.remoteEventVersionIds.every(
        (eventVersionId, index) =>
          eventVersionId === expectedEventVersionIds[index],
      )
    );
  }

  private requireBundle(bundleId: string): F18ReviewBundleReadModel {
    const bundle = this.options.bundles.getReadModel?.(bundleId);
    if (bundle === undefined) throw new Error("F22_BUNDLE_NOT_FOUND");
    return bundle;
  }

  private requireAction(
    actionId: string,
    kind: "DISCARD" | "REEVALUATE",
    bundleId: string,
  ): F22ActionIntent {
    const action = this.options.persistence.getAction(actionId);
    if (
      action === undefined ||
      action.action !== kind ||
      action.bundleId !== bundleId
    )
      throw new Error("F22_ACTION_NOT_FOUND");
    return action;
  }

  private pendingActionForBundle(
    bundleId: string,
  ): F22ActionIntent | undefined {
    return this.options.persistence
      .listPendingActions()
      .find((action) => action.bundleId === bundleId);
  }

  private async inspect(
    bundle: F18ReviewBundleReadModel,
  ): Promise<F13InspectionResult> {
    return this.options.f13.inspectOperation(
      bundle.operationId,
      bundle.bundleId,
      "INSPECTION",
    );
  }

  private gate(
    bundle: F18ReviewBundleReadModel,
    state: F22BundleStateRecord,
    includeActiveOperation = true,
    activeOperationOverride?: {
      readonly operationId: string;
      readonly status: string;
    },
    observationToken?: string,
  ): F22ActionGate {
    const hold = this.options.f11.getActiveHold(bundle.managedPrId);
    const claim = this.options.f11.getActiveClaim(bundle.managedPrId);
    const ownsActiveHold =
      hold !== undefined &&
      hold.bundleId === bundle.bundleId &&
      hold.operationId === bundle.operationId &&
      claim !== undefined &&
      claim.claimId === hold.claimId &&
      claim.bundleId === bundle.bundleId &&
      claim.operationId === bundle.operationId;
    const activeOperation =
      activeOperationOverride ??
      (includeActiveOperation
        ? this.options.activeOperation?.read(bundle.bundleId)
        : undefined);
    const mutationActive =
      activeOperation !== undefined &&
      ["CREATED", "WORKING", "INTERRUPTED", "UNCERTAIN"].includes(
        activeOperation.status,
      );
    const primaryReviewState = this.options.primaryReview?.read(
      bundle.managedPrId,
    );
    const synchronizationOverlay = this.options.synchronization?.read(
      bundle.managedPrId,
    );
    const gate = f22GateFor(bundle, state, {
      condition: state.condition,
      retainedCandidateEventVersionIds: this.options.f11.listRetainedVersionIds(
        bundle.managedPrId,
      ),
      hold: {
        active: ownsActiveHold,
        ...(hold === undefined
          ? {}
          : {
              holdId: hold.holdId,
              claimId: hold.claimId,
              operationId: hold.operationId,
              bundleId: hold.bundleId,
              revision: hold.version,
            }),
      },
      ...(activeOperation === undefined
        ? {}
        : {
            activeOperation: {
              mutationActive,
              operationId: activeOperation.operationId,
              status: activeOperation.status,
            },
          }),
      ...(primaryReviewState === undefined ? {} : { primaryReviewState }),
      ...(synchronizationOverlay === undefined
        ? {}
        : { synchronizationOverlay }),
    });
    return observationToken === undefined
      ? gate
      : f22ActionGateSchema.parse({
          ...gate,
          remote: { ...gate.remote, observationToken },
        });
  }

  private gatedReason(gate: F22ActionGate, action: string): F22Reason {
    return (
      gate.reason ??
      reason(
        "ACTION_NOT_PERMITTED",
        `${action} is not available for this Review Bundle.`,
        "The main-process action gate requires a current, stable, human-authorized workflow state.",
        "INSPECT",
      )
    );
  }

  private newIntent(input: {
    readonly action: "DISCARD" | "REEVALUATE";
    readonly actionId: string;
    readonly idempotencyKey: string;
    readonly bundle: F18ReviewBundleReadModel;
    readonly state: F22BundleStateRecord;
    readonly retainedEventVersionIds?: readonly string[];
  }): F22ActionIntent {
    const timestamp = now(this.options.clock);
    return f22ActionIntentSchema.parse({
      schemaVersion: 1,
      actionId: input.actionId,
      idempotencyKey: input.idempotencyKey,
      action: input.action,
      phase: "ADMITTED",
      status: "PENDING",
      version: 0,
      bundleId: input.bundle.bundleId,
      managedPrId: input.bundle.managedPrId,
      expectedBundleVersion: input.bundle.version,
      expectedGateRevision: input.state.revision,
      expectedObservationRevision: input.state.observationRevision,
      confirmed: false,
      operationId: input.bundle.operationId,
      claimId: input.bundle.input.claimId,
      ...(input.bundle.input.holdId === undefined
        ? {}
        : { holdId: input.bundle.input.holdId }),
      originalEventVersionIds: input.bundle.input.remoteEventVersionIds,
      retainedEventVersionIds: input.retainedEventVersionIds ?? [],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  private advanceAction(
    action: F22ActionIntent,
    patch: Partial<F22ActionIntent>,
  ): F22ActionIntent {
    return f22ActionIntentSchema.parse({
      ...action,
      ...patch,
      version: action.version + 1,
      updatedAt: now(this.options.clock),
    });
  }

  private advanceState(
    state: F22BundleStateRecord,
    status: F22BundleStateRecord["status"],
    nextReason: F22Reason | undefined,
    condition: F13WorktreeCondition | undefined,
    supersededByBundleId?: string,
  ): F22BundleStateRecord {
    return f22BundleStateRecordSchema.parse({
      ...state,
      status,
      revision: state.revision + 1,
      ...(nextReason === undefined ? {} : { reason: nextReason }),
      ...(condition === undefined ? {} : { condition }),
      ...(supersededByBundleId === undefined ? {} : { supersededByBundleId }),
      updatedAt: now(this.options.clock),
    });
  }

  private saveState(
    previous: F22BundleStateRecord,
    next: F22BundleStateRecord,
  ): F22BundleStateRecord {
    return this.options.persistence.putBundleState({
      state: next,
      expectedRevision: previous.revision,
    });
  }

  private previewFromAction<T>(
    action: F22ActionIntent,
    schema: { parse: (value: unknown) => T },
  ): T | undefined {
    const result = asRecord(action.result);
    if (result === undefined) return undefined;
    try {
      return schema.parse(result.preview);
    } catch {
      return undefined;
    }
  }

  private async failActionPreview<
    TPreview extends F22DiscardPreview | F22ReevaluationPreview,
  >(
    action: F22ActionIntent,
    bundle: F18ReviewBundleReadModel,
    code: string,
    what: string,
  ): Promise<F22PreviewResult<TPreview>> {
    const failed = this.advanceAction(action, {
      phase: "UNKNOWN",
      status: "UNKNOWN",
      reason: reason(
        code,
        what,
        "F22 could not obtain the bounded evidence required for a safe action preview.",
        "RECONCILE",
      ),
    });
    this.options.persistence.updateAction({
      action: failed,
      expectedVersion: action.version,
    });
    const state = this.registerBundle(bundle);
    const next = this.advanceState(
      state,
      "ATTENTION",
      failed.reason,
      state.condition,
    );
    const saved = this.saveState(state, next);
    return {
      outcome: "ATTENTION",
      actionId: action.actionId,
      gate: this.gate(bundle, saved),
      reason: failed.reason,
    };
  }

  private async failAction(
    action: F22ActionIntent,
    bundle: F18ReviewBundleReadModel,
    code: string,
    what: string,
  ): Promise<F22ActionResult> {
    const failure = reason(
      code,
      what,
      "F22 preserved the existing worktree, bundle evidence, and durable owner for reconciliation.",
      "RECONCILE",
    );
    const failed = this.advanceAction(action, {
      phase: "FAILED",
      status: "FAILED",
      reason: failure,
    });
    this.options.persistence.updateAction({
      action: failed,
      expectedVersion: action.version,
    });
    const state = this.registerBundle(bundle);
    const next = this.advanceState(
      state,
      "ATTENTION",
      failure,
      state.condition,
    );
    const saved = this.saveState(state, next);
    return {
      outcome: "ATTENTION",
      actionId: action.actionId,
      gate: this.gate(bundle, saved),
      reason: failure,
    };
  }

  private unknownAction(
    action: F22ActionIntent,
    bundle: F18ReviewBundleReadModel,
    code: string,
    what: string,
  ): F22ActionResult {
    const unknown = this.unknownActionIntent(action, bundle, code, what);
    return {
      outcome: "ATTENTION",
      actionId: unknown.actionId,
      gate: this.readGate(bundle.bundleId),
      reason: unknown.reason,
    };
  }

  private unknownActionIntent(
    action: F22ActionIntent,
    bundle: F18ReviewBundleReadModel,
    code: string,
    what: string,
  ): F22ActionIntent {
    const failure = reason(
      code,
      what,
      "F22 preserved the existing evidence and durable owner because the delegated outcome cannot be proven.",
      "RECONCILE",
    );
    const unknown = this.advanceAction(action, {
      phase: "UNKNOWN",
      status: "UNKNOWN",
      reason: failure,
    });
    this.options.persistence.updateAction({
      action: unknown,
      expectedVersion: action.version,
    });
    const state = this.registerBundle(bundle);
    const next = this.advanceState(
      state,
      "ATTENTION",
      failure,
      state.condition,
    );
    this.saveState(state, next);
    return unknown;
  }

  private attentionAction(
    action: F22ActionIntent,
    bundle: F18ReviewBundleReadModel,
    code: string,
    what: string,
  ): F22ActionResult {
    const failure = reason(
      code,
      what,
      "F22 requires a durable preview before it can perform a worktree or F11 action.",
      "RECONCILE",
    );
    return {
      outcome: "ATTENTION",
      actionId: action.actionId,
      gate: this.gate(bundle, this.registerBundle(bundle)),
      reason: failure,
    };
  }

  private stoppedAction(
    action: F22ActionIntent,
    bundleId: string,
  ): F22ActionResult {
    return {
      outcome: "ATTENTION",
      actionId: action.actionId,
      gate: this.readGate(bundleId),
      reason:
        action.reason ??
        reason(
          "F22_ACTION_RECONCILIATION_REQUIRED",
          "This F22 action has already stopped and cannot be retried.",
          "F22 requires reconciliation before it can authorize another delegated effect.",
          "RECONCILE",
        ),
    };
  }
}
