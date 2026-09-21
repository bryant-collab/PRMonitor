import {
  createDomainError,
  DOMAIN_SCHEMA_VERSION,
  failure,
  isSafeJsonValue,
  parseDomainReason,
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
import { parseTransitionEvent } from "./transition";
import {
  parseAIWorkOperationId,
  parseCommitSha,
  parseManagedPrId,
  parseRemoteEventVersionId,
  parseReviewBundleId,
  parseReviewBundleItemId,
  parseSchemaVersion,
  parseWorktreeId,
  type ActionRecord,
  type AIWorkOperationId,
  type Clock,
  type CommitSha,
  type ManagedPrId,
  type RemoteEventVersionId,
  type ReviewBundleId,
  type WorktreeId,
} from "./primitives";
import type { SafeJsonValue } from "./result";

export const REVIEW_BUNDLE_STATES = [
  "WORKING",
  "READY_FOR_REVIEW",
  "NEEDS_ATTENTION",
  "STALE",
  "PUBLISHING",
  "PUBLISHED",
  "PUBLISHED_WITH_ERRORS",
  "DISCARDED",
  "FAILED",
] as const;
export type ReviewBundleState = (typeof REVIEW_BUNDLE_STATES)[number];

export const REVIEW_BUNDLE_STAGES = [
  "PROPOSAL_REVIEW",
  "FINAL_REVIEW",
] as const;
export type ReviewBundleStage = (typeof REVIEW_BUNDLE_STAGES)[number];
export const REVIEW_ITEM_DECISIONS = [
  "pending",
  "accepted",
  "overridden",
] as const;
export type ReviewItemDecision = (typeof REVIEW_ITEM_DECISIONS)[number];
export const REVIEW_ITEM_DISPOSITIONS = [
  "fixed",
  "pushback",
  "question",
  "no_change",
] as const;
export type ReviewItemDisposition = (typeof REVIEW_ITEM_DISPOSITIONS)[number];

export interface ReviewBundleItemDecision {
  readonly decision: ReviewItemDecision;
  readonly finalDisposition: ReviewItemDisposition;
  readonly userInstructions?: string;
  readonly questionAnswer?: string;
}

export interface ReviewBundleItem {
  readonly id: string;
  readonly eventVersionId: RemoteEventVersionId;
  /** Immutable provider-neutral representation of the AI recommendation. */
  readonly recommendation: SafeJsonValue;
  readonly decision: ReviewBundleItemDecision;
  readonly decisionHistory: readonly ReviewBundleItemDecision[];
}

export const REVIEW_BUNDLE_TRANSITIONS = [
  ["WORKING", "REVIEWABLE_COMPLETION", "READY_FOR_REVIEW"],
  ["READY_FOR_REVIEW", "SET_ITEM_DECISION", "READY_FOR_REVIEW"],
  ["READY_FOR_REVIEW", "CONFIRM_REVIEW_DECISIONS", "WORKING"],
  ["WORKING", "IMPLEMENTATION_COMPLETION", "READY_FOR_REVIEW"],
  ["WORKING", "BLOCKING_STOP", "NEEDS_ATTENTION"],
  ["WORKING", "REMOTE_HEAD_MOVED", "STALE"],
  ["READY_FOR_REVIEW", "REMOTE_HEAD_MOVED", "STALE"],
  ["READY_FOR_REVIEW", "APPROVE_PUBLICATION", "PUBLISHING"],
  ["READY_FOR_REVIEW", "DISCARD", "DISCARDED"],
  ["NEEDS_ATTENTION", "REMOTE_HEAD_MOVED", "STALE"],
  ["NEEDS_ATTENTION", "DISCARD", "DISCARDED"],
  ["STALE", "DISCARD", "DISCARDED"],
  ["PUBLISHING", "PUBLICATION_COMPLETED", "PUBLISHED"],
  ["PUBLISHING", "PUBLICATION_WITH_ERRORS", "PUBLISHED_WITH_ERRORS"],
  ["PUBLISHING", "PUBLICATION_FAILED", "FAILED"],
  ["FAILED", "DISCARD", "DISCARDED"],
] as const;

export interface ReviewBundleSnapshotRefs {
  readonly prBaseSha?: CommitSha;
  readonly prHeadSha?: CommitSha;
  readonly worktreeBaselineSha?: CommitSha;
  readonly worktreeId?: WorktreeId;
}

export interface ReviewBundle {
  readonly schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  readonly kind: "review-bundle";
  readonly id: ReviewBundleId;
  readonly prId: ManagedPrId;
  readonly state: ReviewBundleState;
  readonly stage: ReviewBundleStage;
  readonly version: number;
  readonly eventVersionIds: readonly RemoteEventVersionId[];
  readonly items: readonly ReviewBundleItem[];
  readonly snapshotRefs: ReviewBundleSnapshotRefs;
  readonly aiOperationId?: AIWorkOperationId;
  readonly currentReason?: ActionReason;
  readonly parentBundleId?: ReviewBundleId;
  readonly approvalId?: string;
  readonly history: readonly TransitionEvent[];
}

export interface BundleReviewableCompletionAction {
  readonly type: "REVIEWABLE_COMPLETION";
  readonly action: ActionRecord;
  readonly reason?: ActionReason;
}

export interface BundleItemDecisionAction {
  readonly type: "SET_ITEM_DECISION";
  readonly action: ActionRecord;
  readonly itemId: string;
  readonly decision: ReviewItemDecision;
  readonly finalDisposition: ReviewItemDisposition;
  readonly userInstructions?: string;
  readonly questionAnswer?: string;
}

export interface BundleConfirmReviewDecisionsAction {
  readonly type: "CONFIRM_REVIEW_DECISIONS";
  readonly action: ActionRecord;
  readonly implementationOperationId?: AIWorkOperationId;
}

export interface BundleImplementationCompletionAction {
  readonly type: "IMPLEMENTATION_COMPLETION";
  readonly action: ActionRecord;
  readonly reason?: ActionReason;
}

export interface BundleBlockingStopAction {
  readonly type: "BLOCKING_STOP";
  readonly action: ActionRecord;
  readonly reason: ActionReason;
}

export interface BundleStaleAction {
  readonly type: "REMOTE_HEAD_MOVED";
  readonly action: ActionRecord;
  readonly reason: ActionReason;
  readonly remoteHeadMoved: true;
}

export interface BundleApprovePublicationAction {
  readonly type: "APPROVE_PUBLICATION";
  readonly action: ActionRecord;
  readonly approvalId: string;
}

export interface BundlePublicationOutcomeAction {
  readonly type:
    "PUBLICATION_COMPLETED" | "PUBLICATION_WITH_ERRORS" | "PUBLICATION_FAILED";
  readonly action: ActionRecord;
  readonly reason: ActionReason;
}

export interface BundleDiscardAction {
  readonly type: "DISCARD";
  readonly action: ActionRecord;
  readonly reason?: ActionReason;
  readonly worktreeHandled: boolean;
}

export interface BundleReevaluateAction {
  readonly type: "RE_EVALUATE";
  readonly action: ActionRecord;
  readonly newBundleId: ReviewBundleId;
  readonly newAiOperationId?: AIWorkOperationId;
}

export type ReviewBundleAction =
  | BundleReviewableCompletionAction
  | BundleItemDecisionAction
  | BundleConfirmReviewDecisionsAction
  | BundleImplementationCompletionAction
  | BundleBlockingStopAction
  | BundleStaleAction
  | BundleApprovePublicationAction
  | BundlePublicationOutcomeAction
  | BundleDiscardAction
  | BundleReevaluateAction;

const TERMINAL_BUNDLE_STATES: readonly ReviewBundleState[] = [
  "PUBLISHED",
  "PUBLISHED_WITH_ERRORS",
  "DISCARDED",
  "FAILED",
];

export function isTerminalReviewBundleState(state: ReviewBundleState): boolean {
  return TERMINAL_BUNDLE_STATES.includes(state);
}

export function canPublishReviewBundle(bundle: ReviewBundle): boolean {
  return bundle.state === "READY_FOR_REVIEW" && bundle.stage === "FINAL_REVIEW";
}

function hasText(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

export function hasCompleteReviewDecisions(bundle: ReviewBundle): boolean {
  return (
    bundle.stage === "PROPOSAL_REVIEW" &&
    bundle.items.every((item) => {
      if (item.decision.decision === "pending") return false;
      if (item.decision.finalDisposition === "question") {
        return hasText(item.decision.questionAnswer);
      }
      return true;
    })
  );
}

function decisionRequiredReason(bundle: ReviewBundle): ActionReason {
  return unsafeReason(
    "REVIEW_DECISIONS_REQUIRED",
    "Every proposed review item needs an explicit human decision before implementation.",
    "The initial AI review is read-only and a question disposition also needs a written answer.",
    "REVIEW",
    { bundleId: bundle.id, itemCount: bundle.items.length },
  );
}

function decisionIsValid(input: BundleItemDecisionAction): boolean {
  return (
    input.decision !== "pending" &&
    hasText(input.finalDisposition) &&
    (input.finalDisposition !== "question" || hasText(input.questionAnswer))
  );
}

function invalidReason(state: ReviewBundleState, action: string): ActionReason {
  return unsafeReason(
    "INVALID_TRANSITION",
    `The Review Bundle is ${state} and cannot perform ${action}.`,
    "Only documented Review Bundle triggers may change its state.",
    "REVIEW",
    { state, action },
  );
}

function bundleEvent(
  previous: ReviewBundle,
  nextState: ReviewBundleState,
  action: ActionRecord,
  clock: Clock,
  reason?: ActionReason,
  aggregateId: ReviewBundleId = previous.id,
): TransitionEvent {
  return createTransitionEvent({
    transitionId: action.transitionId,
    actionId: action.actionId,
    actor: action.actor,
    aggregateKind: "REVIEW_BUNDLE",
    aggregateId,
    priorState: previous.state,
    nextState,
    occurredAt: clock.now(),
    ...(reason === undefined ? {} : { reason }),
    ...(action.correlationId === undefined
      ? {}
      : { correlationId: action.correlationId }),
  });
}

function transitionError<T>(
  bundle: ReviewBundle,
  action: ReviewBundleAction,
  reason: ActionReason,
): DomainResult<T> {
  return failure(
    createDomainError({
      code: "INVALID_TRANSITION",
      category: "INVALID_TRANSITION",
      retryable: action.type !== "DISCARD",
      userAction: reason.nextAction,
      messageKey: "domain.bundle.invalid-transition",
      reason,
      priorState: bundle.state,
      currentState: bundle.state,
    }),
  );
}

function applyBundleState(
  previous: ReviewBundle,
  nextState: ReviewBundleState,
  action: ActionRecord,
  clock: Clock,
  reason?: ActionReason,
  extra: Partial<ReviewBundle> = {},
): TransitionDecision<ReviewBundle> {
  const event = bundleEvent(previous, nextState, action, clock, reason);
  return changed(
    {
      ...previous,
      ...extra,
      state: nextState,
      version: previous.version + 1,
      ...(reason === undefined ? {} : { currentReason: reason }),
      history: [...previous.history, event],
    },
    event,
  );
}

export function createReviewBundle(input: {
  readonly id: ReviewBundleId;
  readonly prId: ManagedPrId;
  readonly eventVersionIds: readonly RemoteEventVersionId[];
  readonly stage?: ReviewBundleStage;
  readonly items?: readonly ReviewBundleItem[];
  readonly snapshotRefs?: ReviewBundleSnapshotRefs;
  readonly aiOperationId?: AIWorkOperationId;
}): ReviewBundle {
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    kind: "review-bundle",
    id: input.id,
    prId: input.prId,
    state: "WORKING",
    stage: input.stage ?? "FINAL_REVIEW",
    version: 0,
    eventVersionIds: [...input.eventVersionIds],
    items: (input.items ?? []).map((item) => ({
      ...item,
      decision: { ...item.decision },
      decisionHistory: [...item.decisionHistory],
    })),
    snapshotRefs: input.snapshotRefs ?? {},
    ...(input.aiOperationId === undefined
      ? {}
      : { aiOperationId: input.aiOperationId }),
    history: [],
  };
}

export function reduceReviewBundle(
  bundle: ReviewBundle,
  action: ReviewBundleAction,
  clock: Clock,
): DomainResult<TransitionDecision<ReviewBundle>> {
  if (
    action.action.expectedVersion !== undefined &&
    action.action.expectedVersion !== bundle.version
  ) {
    return failure(
      createDomainError({
        code: "CONCURRENT_STATE_CONFLICT",
        category: "CONFLICT",
        retryable: true,
        userAction: "RETRY",
        messageKey: "domain.bundle.version-conflict",
        reason: unsafeReason(
          "CONCURRENT_STATE_CONFLICT",
          "The Review Bundle changed before this action was applied.",
          "A retry must use the current persisted bundle version.",
          "RETRY",
          {
            expectedVersion: action.action.expectedVersion,
            actualVersion: bundle.version,
          },
        ),
        priorState: bundle.state,
        currentState: bundle.state,
      }),
    );
  }

  if (action.type === "REVIEWABLE_COMPLETION") {
    if (bundle.state !== "WORKING")
      return transitionError(
        bundle,
        action,
        invalidReason(bundle.state, action.type),
      );
    const reason =
      action.reason ??
      unsafeReason(
        "REVIEW_READY",
        "The Review Bundle is ready for human review.",
        "The deterministic bundle contains the complete proposed result and evidence.",
        "REVIEW",
      );
    return success(
      applyBundleState(
        bundle,
        "READY_FOR_REVIEW",
        action.action,
        clock,
        reason,
      ),
    );
  }

  if (action.type === "SET_ITEM_DECISION") {
    if (
      bundle.state !== "READY_FOR_REVIEW" ||
      bundle.stage !== "PROPOSAL_REVIEW" ||
      action.action.actor !== "HUMAN" ||
      !decisionIsValid(action)
    ) {
      return transitionError(bundle, action, decisionRequiredReason(bundle));
    }
    const index = bundle.items.findIndex((item) => item.id === action.itemId);
    if (index < 0) {
      return transitionError(bundle, action, decisionRequiredReason(bundle));
    }
    const nextDecision: ReviewBundleItemDecision = {
      decision: action.decision,
      finalDisposition: action.finalDisposition,
      ...(action.userInstructions === undefined
        ? {}
        : { userInstructions: action.userInstructions }),
      ...(action.questionAnswer === undefined
        ? {}
        : { questionAnswer: action.questionAnswer }),
    };
    const items = bundle.items.map((item, itemIndex) =>
      itemIndex === index
        ? {
            ...item,
            decision: nextDecision,
            decisionHistory: [...item.decisionHistory, nextDecision],
          }
        : item,
    );
    return success(
      applyBundleState(
        bundle,
        bundle.state,
        action.action,
        clock,
        unsafeReason(
          "REVIEW_ITEM_DECISION_RECORDED",
          "A human decision was recorded for a proposal item.",
          "The decision is retained as history and will control only the next implementation step.",
          "NONE",
          {
            itemId: action.itemId,
            decision: action.decision,
            finalDisposition: action.finalDisposition,
          },
        ),
        { items },
      ),
    );
  }

  if (action.type === "CONFIRM_REVIEW_DECISIONS") {
    if (
      bundle.state !== "READY_FOR_REVIEW" ||
      bundle.stage !== "PROPOSAL_REVIEW" ||
      action.action.actor !== "HUMAN"
    ) {
      return transitionError(bundle, action, decisionRequiredReason(bundle));
    }
    if (!hasCompleteReviewDecisions(bundle)) {
      return failure(
        createDomainError({
          code: "REVIEW_DECISIONS_REQUIRED",
          category: "INVALID_TRANSITION",
          retryable: false,
          userAction: "REVIEW",
          messageKey: "domain.bundle.review-decisions-required",
          reason: decisionRequiredReason(bundle),
          priorState: bundle.state,
          currentState: bundle.state,
        }),
      );
    }
    const reason = unsafeReason(
      "REVIEW_DECISIONS_CONFIRMED",
      "The developer confirmed every Review Proposal decision.",
      "Only the final human dispositions and instructions may be sent to the worktree-mutating implementation turn.",
      "NONE",
      {
        implementationOperationId:
          action.implementationOperationId ?? "not-assigned",
      },
    );
    return success(
      applyBundleState(bundle, "WORKING", action.action, clock, reason, {
        ...(action.implementationOperationId === undefined
          ? {}
          : { aiOperationId: action.implementationOperationId }),
      }),
    );
  }

  if (action.type === "IMPLEMENTATION_COMPLETION") {
    if (bundle.state !== "WORKING" || bundle.stage !== "PROPOSAL_REVIEW") {
      return transitionError(
        bundle,
        action,
        invalidReason(bundle.state, action.type),
      );
    }
    return success(
      applyBundleState(
        bundle,
        "READY_FOR_REVIEW",
        action.action,
        clock,
        action.reason ??
          unsafeReason(
            "FINAL_REVIEW_READY",
            "The accepted review decisions produced a final proposed result.",
            "The complete diff and post-change validation are now ready for separate human publication approval.",
            "REVIEW",
          ),
        { stage: "FINAL_REVIEW" },
      ),
    );
  }

  if (action.type === "BLOCKING_STOP") {
    if (bundle.state !== "WORKING")
      return transitionError(
        bundle,
        action,
        invalidReason(bundle.state, action.type),
      );
    return success(
      applyBundleState(
        bundle,
        "NEEDS_ATTENTION",
        action.action,
        clock,
        action.reason,
      ),
    );
  }

  if (action.type === "REMOTE_HEAD_MOVED") {
    if (
      !action.remoteHeadMoved ||
      isTerminalReviewBundleState(bundle.state) ||
      bundle.state === "STALE"
    ) {
      return transitionError(
        bundle,
        action,
        invalidReason(bundle.state, action.type),
      );
    }
    return success(
      applyBundleState(bundle, "STALE", action.action, clock, action.reason),
    );
  }

  if (action.type === "APPROVE_PUBLICATION") {
    if (
      bundle.state !== "READY_FOR_REVIEW" ||
      action.action.actor !== "HUMAN" ||
      action.approvalId.length === 0
    ) {
      return failure(
        createDomainError({
          code:
            action.action.actor !== "HUMAN"
              ? "PUBLICATION_APPROVAL_REQUIRED"
              : "INVALID_TRANSITION",
          category:
            action.action.actor !== "HUMAN"
              ? "PERMANENT_FAILURE"
              : "INVALID_TRANSITION",
          retryable: false,
          userAction: "APPROVE",
          messageKey: "domain.bundle.approval-required",
          reason: unsafeReason(
            "PUBLICATION_APPROVAL_REQUIRED",
            "Publication requires an explicit human approval record.",
            "A state transition cannot grant publication authority to an AI provider or scheduler.",
            "APPROVE",
          ),
          priorState: bundle.state,
          currentState: bundle.state,
        }),
      );
    }
    return success(
      applyBundleState(bundle, "PUBLISHING", action.action, clock, undefined, {
        approvalId: action.approvalId,
      }),
    );
  }

  if (
    action.type === "PUBLICATION_COMPLETED" ||
    action.type === "PUBLICATION_WITH_ERRORS" ||
    action.type === "PUBLICATION_FAILED"
  ) {
    if (bundle.state !== "PUBLISHING")
      return transitionError(
        bundle,
        action,
        invalidReason(bundle.state, action.type),
      );
    const nextState: ReviewBundleState =
      action.type === "PUBLICATION_COMPLETED"
        ? "PUBLISHED"
        : action.type === "PUBLICATION_WITH_ERRORS"
          ? "PUBLISHED_WITH_ERRORS"
          : "FAILED";
    return success(
      applyBundleState(bundle, nextState, action.action, clock, action.reason),
    );
  }

  if (action.type === "DISCARD") {
    if (
      action.action.actor !== "HUMAN" ||
      !action.worktreeHandled ||
      (isTerminalReviewBundleState(bundle.state) && bundle.state !== "FAILED")
    ) {
      return transitionError(
        bundle,
        action,
        invalidReason(bundle.state, action.type),
      );
    }
    const reason =
      action.reason ??
      unsafeReason(
        "DISCARDED",
        "The Review Bundle was discarded by the user.",
        "The required worktree decision was recorded before releasing the review hold.",
        "NONE",
      );
    return success(
      applyBundleState(bundle, "DISCARDED", action.action, clock, reason),
    );
  }

  if (action.type === "RE_EVALUATE") {
    if (
      !["STALE", "FAILED", "NEEDS_ATTENTION"].includes(bundle.state) ||
      action.action.actor !== "HUMAN" ||
      action.newBundleId === bundle.id
    ) {
      return transitionError(
        bundle,
        action,
        invalidReason(bundle.state, action.type),
      );
    }
    const reason = unsafeReason(
      "EXPLICIT_REEVALUATION",
      "A new Review Bundle continuation was explicitly authorized.",
      "The prior bundle remains inspectable while the new operation uses fresh deterministic inputs.",
      "NONE",
      { parentBundleId: bundle.id },
    );
    const event = createTransitionEvent({
      transitionId: action.action.transitionId,
      actionId: action.action.actionId,
      actor: action.action.actor,
      aggregateKind: "REVIEW_BUNDLE",
      aggregateId: action.newBundleId,
      priorState: bundle.state,
      nextState: "WORKING",
      occurredAt: clock.now(),
      reason,
      ...(action.action.correlationId === undefined
        ? {}
        : { correlationId: action.action.correlationId }),
    });
    return success(
      changed(
        {
          schemaVersion: DOMAIN_SCHEMA_VERSION,
          kind: "review-bundle",
          id: action.newBundleId,
          prId: bundle.prId,
          state: "WORKING",
          stage: bundle.stage,
          version: 0,
          eventVersionIds: [...bundle.eventVersionIds],
          items: bundle.items.map((item) => ({
            ...item,
            decision: { decision: "pending", finalDisposition: "no_change" },
            decisionHistory: [],
          })),
          snapshotRefs: bundle.snapshotRefs,
          ...(action.newAiOperationId === undefined
            ? {}
            : { aiOperationId: action.newAiOperationId }),
          parentBundleId: bundle.id,
          currentReason: reason,
          history: [event],
        },
        event,
      ),
    );
  }

  return transitionError(
    bundle,
    action,
    invalidReason(bundle.state, action.type),
  );
}

export function parseReviewBundle(value: unknown): DomainResult<ReviewBundle> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return failure(
      createDomainError({
        code: "INVALID_CONTRACT",
        category: "INVALID_INPUT",
        retryable: false,
        userAction: "FIX_INPUT",
        messageKey: "domain.bundle.invalid",
        reason: unsafeReason(
          "INVALID_CONTRACT",
          "The Review Bundle is not an object.",
          "Bundle history cannot be safely restored.",
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
    "prId",
    "state",
    "stage",
    "version",
    "eventVersionIds",
    "items",
    "snapshotRefs",
    "aiOperationId",
    "currentReason",
    "parentBundleId",
    "approvalId",
    "history",
  ]);
  if (Object.keys(data).some((key) => !allowed.has(key))) {
    return failure(
      createDomainError({
        code: "INVALID_CONTRACT",
        category: "INVALID_INPUT",
        retryable: false,
        userAction: "FIX_INPUT",
        messageKey: "domain.bundle.invalid",
        reason: unsafeReason(
          "INVALID_CONTRACT",
          "The Review Bundle contains unsupported fields.",
          "Unknown fields cannot be allowed to rewrite historical bundle state.",
          "FIX_INPUT",
        ),
      }),
    );
  }
  const schema = parseSchemaVersion(data.schemaVersion);
  const id = parseReviewBundleId(data.id);
  const prId = parseManagedPrId(data.prId);
  if (!schema.ok) return schema;
  if (!id.ok) return id;
  if (!prId.ok) return prId;
  if (
    data.kind !== "review-bundle" ||
    typeof data.state !== "string" ||
    !REVIEW_BUNDLE_STATES.includes(data.state as ReviewBundleState) ||
    !Number.isInteger(data.version) ||
    (data.version as number) < 0 ||
    !Array.isArray(data.eventVersionIds) ||
    !Array.isArray(data.history) ||
    typeof data.snapshotRefs !== "object" ||
    data.snapshotRefs === null ||
    (data.stage !== undefined &&
      !REVIEW_BUNDLE_STAGES.includes(data.stage as ReviewBundleStage)) ||
    (data.items !== undefined && !Array.isArray(data.items))
  ) {
    return failure(
      createDomainError({
        code: "INVALID_CONTRACT",
        category: "INVALID_INPUT",
        retryable: false,
        userAction: "FIX_INPUT",
        messageKey: "domain.bundle.invalid",
        reason: unsafeReason(
          "INVALID_CONTRACT",
          "The Review Bundle contains invalid state or snapshot values.",
          "Only schema-valid immutable references may be restored.",
          "FIX_INPUT",
        ),
      }),
    );
  }
  const eventIds = data.eventVersionIds.map(parseRemoteEventVersionId);
  const badEventId = eventIds.find((result) => !result.ok);
  if (badEventId !== undefined && !badEventId.ok) return badEventId;
  const snapshot = data.snapshotRefs as Record<string, unknown>;
  const snapshotAllowed = new Set([
    "prBaseSha",
    "prHeadSha",
    "worktreeBaselineSha",
    "worktreeId",
  ]);
  if (Object.keys(snapshot).some((key) => !snapshotAllowed.has(key))) {
    return failure(
      createDomainError({
        code: "INVALID_CONTRACT",
        category: "INVALID_INPUT",
        retryable: false,
        userAction: "FIX_INPUT",
        messageKey: "domain.bundle.invalid",
        reason: unsafeReason(
          "INVALID_CONTRACT",
          "The Review Bundle snapshot contains unsupported fields.",
          "Immutable snapshot references must remain provider-neutral.",
          "FIX_INPUT",
        ),
      }),
    );
  }
  const prBaseSha =
    snapshot.prBaseSha === undefined
      ? undefined
      : parseCommitSha(snapshot.prBaseSha);
  const prHeadSha =
    snapshot.prHeadSha === undefined
      ? undefined
      : parseCommitSha(snapshot.prHeadSha);
  const worktreeBaselineSha =
    snapshot.worktreeBaselineSha === undefined
      ? undefined
      : parseCommitSha(snapshot.worktreeBaselineSha);
  const worktreeId =
    snapshot.worktreeId === undefined
      ? undefined
      : parseWorktreeId(snapshot.worktreeId);
  for (const parsed of [
    prBaseSha,
    prHeadSha,
    worktreeBaselineSha,
    worktreeId,
  ]) {
    if (parsed !== undefined && !parsed.ok) return parsed;
  }
  if (prBaseSha !== undefined && !prBaseSha.ok) return prBaseSha;
  if (prHeadSha !== undefined && !prHeadSha.ok) return prHeadSha;
  if (worktreeBaselineSha !== undefined && !worktreeBaselineSha.ok)
    return worktreeBaselineSha;
  if (worktreeId !== undefined && !worktreeId.ok) return worktreeId;
  const aiOperationId =
    data.aiOperationId === undefined
      ? undefined
      : parseAIWorkOperationId(data.aiOperationId);
  const parentBundleId =
    data.parentBundleId === undefined
      ? undefined
      : parseReviewBundleId(data.parentBundleId);
  if (aiOperationId !== undefined && !aiOperationId.ok) return aiOperationId;
  if (parentBundleId !== undefined && !parentBundleId.ok) return parentBundleId;

  const parsedItems: ReviewBundleItem[] = [];
  for (const rawItem of (data.items ?? []) as unknown[]) {
    if (
      typeof rawItem !== "object" ||
      rawItem === null ||
      Array.isArray(rawItem)
    ) {
      return failure(
        createDomainError({
          code: "INVALID_CONTRACT",
          category: "INVALID_INPUT",
          retryable: false,
          userAction: "FIX_INPUT",
          messageKey: "domain.bundle.item-invalid",
          reason: unsafeReason(
            "INVALID_CONTRACT",
            "A Review Bundle item is invalid.",
            "Item decisions cannot be restored safely.",
            "FIX_INPUT",
          ),
        }),
      );
    }
    const item = rawItem as Record<string, unknown>;
    const itemKeys = new Set([
      "id",
      "eventVersionId",
      "recommendation",
      "decision",
      "decisionHistory",
    ]);
    if (
      Object.keys(item).some((key) => !itemKeys.has(key)) ||
      !isSafeJsonValue(item.recommendation)
    ) {
      return failure(
        createDomainError({
          code: "INVALID_CONTRACT",
          category: "INVALID_INPUT",
          retryable: false,
          userAction: "FIX_INPUT",
          messageKey: "domain.bundle.item-invalid",
          reason: unsafeReason(
            "INVALID_CONTRACT",
            "A Review Bundle item contains unsupported data.",
            "AI recommendations and human decisions must remain bounded and safe.",
            "FIX_INPUT",
          ),
        }),
      );
    }
    const itemId = parseReviewBundleItemId(item.id);
    const itemEventId = parseRemoteEventVersionId(item.eventVersionId);
    if (!itemId.ok) return itemId;
    if (!itemEventId.ok) return itemEventId;
    const parseDecision = (
      value: unknown,
    ): DomainResult<ReviewBundleItemDecision> => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return failure(
          createDomainError({
            code: "INVALID_CONTRACT",
            category: "INVALID_INPUT",
            retryable: false,
            userAction: "FIX_INPUT",
            messageKey: "domain.bundle.decision-invalid",
            reason: unsafeReason(
              "INVALID_CONTRACT",
              "A Review Bundle decision is invalid.",
              "Human decisions must be explicit and safely serialized.",
              "FIX_INPUT",
            ),
          }),
        );
      }
      const decision = value as Record<string, unknown>;
      if (
        Object.keys(decision).some(
          (key) =>
            !new Set([
              "decision",
              "finalDisposition",
              "userInstructions",
              "questionAnswer",
            ]).has(key),
        )
      ) {
        return failure(
          createDomainError({
            code: "INVALID_CONTRACT",
            category: "INVALID_INPUT",
            retryable: false,
            userAction: "FIX_INPUT",
            messageKey: "domain.bundle.decision-invalid",
            reason: unsafeReason(
              "INVALID_CONTRACT",
              "A Review Bundle decision contains unsupported fields.",
              "Human decisions must remain bounded and safely serialized.",
              "FIX_INPUT",
            ),
          }),
        );
      }
      if (
        !REVIEW_ITEM_DECISIONS.includes(
          decision.decision as ReviewItemDecision,
        ) ||
        !REVIEW_ITEM_DISPOSITIONS.includes(
          decision.finalDisposition as ReviewItemDisposition,
        ) ||
        (decision.userInstructions !== undefined &&
          typeof decision.userInstructions !== "string") ||
        (decision.questionAnswer !== undefined &&
          typeof decision.questionAnswer !== "string") ||
        (decision.finalDisposition === "question" &&
          !hasText(decision.questionAnswer as string | undefined))
      ) {
        return failure(
          createDomainError({
            code: "INVALID_CONTRACT",
            category: "INVALID_INPUT",
            retryable: false,
            userAction: "FIX_INPUT",
            messageKey: "domain.bundle.decision-invalid",
            reason: unsafeReason(
              "INVALID_CONTRACT",
              "A Review Bundle decision is invalid.",
              "Question dispositions require a written answer and pending decisions cannot be implemented.",
              "FIX_INPUT",
            ),
          }),
        );
      }
      return success({
        decision: decision.decision as ReviewItemDecision,
        finalDisposition: decision.finalDisposition as ReviewItemDisposition,
        ...(decision.userInstructions === undefined
          ? {}
          : { userInstructions: decision.userInstructions }),
        ...(decision.questionAnswer === undefined
          ? {}
          : { questionAnswer: decision.questionAnswer }),
      });
    };
    const parsedDecision = parseDecision(item.decision);
    if (!parsedDecision.ok) return parsedDecision;
    const historyRaw =
      item.decisionHistory === undefined ? [] : item.decisionHistory;
    if (!Array.isArray(historyRaw)) {
      return failure(
        createDomainError({
          code: "INVALID_CONTRACT",
          category: "INVALID_INPUT",
          retryable: false,
          userAction: "FIX_INPUT",
          messageKey: "domain.bundle.decision-history-invalid",
          reason: unsafeReason(
            "INVALID_CONTRACT",
            "A Review Bundle decision history is invalid.",
            "Decision history must be an array of safe decisions.",
            "FIX_INPUT",
          ),
        }),
      );
    }
    const history: ReviewBundleItemDecision[] = [];
    for (const historyItem of historyRaw) {
      const parsedHistory = parseDecision(historyItem);
      if (!parsedHistory.ok) return parsedHistory;
      history.push(parsedHistory.value);
    }
    parsedItems.push({
      id: itemId.value,
      eventVersionId: itemEventId.value,
      recommendation: item.recommendation,
      decision: parsedDecision.value,
      decisionHistory: history,
    });
  }
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
      parsed.value.aggregateKind !== "REVIEW_BUNDLE" ||
      parsed.value.aggregateId !== id.value
    ) {
      return failure(
        createDomainError({
          code: "INVALID_CONTRACT",
          category: "INVALID_INPUT",
          retryable: false,
          userAction: "FIX_INPUT",
          messageKey: "domain.bundle.history-invalid",
          reason: unsafeReason(
            "INVALID_CONTRACT",
            "The Review Bundle history contains another aggregate.",
            "Historical bundle transitions must remain scoped to the bundle being restored.",
            "FIX_INPUT",
          ),
        }),
      );
    }
    history.push(parsed.value);
  }
  if (data.approvalId !== undefined && typeof data.approvalId !== "string") {
    return failure(
      createDomainError({
        code: "INVALID_CONTRACT",
        category: "INVALID_INPUT",
        retryable: false,
        userAction: "FIX_INPUT",
        messageKey: "domain.bundle.invalid",
        reason: unsafeReason(
          "INVALID_CONTRACT",
          "The Review Bundle approval reference is invalid.",
          "Publication approval references must remain safe scalar identifiers.",
          "FIX_INPUT",
        ),
      }),
    );
  }
  return success({
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    kind: "review-bundle",
    id: id.value,
    prId: prId.value,
    state: data.state as ReviewBundleState,
    stage: (data.stage as ReviewBundleStage | undefined) ?? "FINAL_REVIEW",
    version: data.version as number,
    eventVersionIds: eventIds.map(
      (result) => (result as { ok: true; value: RemoteEventVersionId }).value,
    ),
    items: parsedItems,
    snapshotRefs: {
      ...(prBaseSha === undefined ? {} : { prBaseSha: prBaseSha.value }),
      ...(prHeadSha === undefined ? {} : { prHeadSha: prHeadSha.value }),
      ...(worktreeBaselineSha === undefined
        ? {}
        : { worktreeBaselineSha: worktreeBaselineSha.value }),
      ...(worktreeId === undefined ? {} : { worktreeId: worktreeId.value }),
    },
    ...(aiOperationId === undefined
      ? {}
      : { aiOperationId: aiOperationId.value }),
    ...(currentReason === undefined
      ? {}
      : { currentReason: currentReason.value }),
    ...(parentBundleId === undefined
      ? {}
      : { parentBundleId: parentBundleId.value }),
    ...(data.approvalId === undefined ? {} : { approvalId: data.approvalId }),
    history,
  });
}
