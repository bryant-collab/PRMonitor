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
  createTransitionEvent,
  changed,
  noOp,
  transitionConflict,
  type TransitionDecision,
  type TransitionEvent,
} from "./transition";
import {
  parseAIWorkOperationId,
  parseManagedPrId,
  parseReviewBundleId,
  parseSchemaVersion,
  parseUtcInstant,
  type ActionRecord,
  type AIWorkOperationId,
  type Clock,
  type ManagedPrId,
  type ReviewBundleId,
  type UtcInstant,
} from "./primitives";
import { parseTransitionEvent } from "./transition";

export const PRIMARY_PR_STATES = [
  "WATCHING",
  "WORKING",
  "READY_FOR_REVIEW",
  "NEEDS_ATTENTION",
] as const;
export type PrimaryPrState = (typeof PRIMARY_PR_STATES)[number];

export type ReviewHoldOutcome =
  "PUBLISHED" | "PUBLISHED_WITH_ERRORS" | "DISCARDED";

export interface AutomaticReviewHold {
  readonly schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  readonly kind: "review-hold";
  readonly prId: ManagedPrId;
  readonly bundleId: ReviewBundleId;
  readonly reason: ActionReason;
  readonly acquiredAt: UtcInstant;
}

export interface PrimaryPrSnapshot {
  readonly schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  readonly kind: "primary-pr-snapshot";
  readonly prId: ManagedPrId;
  readonly state: PrimaryPrState;
  readonly version: number;
  readonly activeAutomaticOperationId?: AIWorkOperationId;
  readonly currentBundleId?: ReviewBundleId;
  readonly hold?: AutomaticReviewHold;
  readonly lastReason?: ActionReason;
  readonly history: readonly TransitionEvent[];
}

export interface WatchingOverlay {
  readonly schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  readonly kind: "watching-overlay";
  readonly paused: boolean;
  readonly version: number;
  readonly changedAt: UtcInstant;
}

export interface AutomaticReviewDispatchAction {
  readonly type: "DISPATCH_AUTOMATIC_REVIEW";
  readonly action: ActionRecord;
  readonly operationId: AIWorkOperationId;
  readonly bundleId: ReviewBundleId;
  readonly eligible: boolean;
  readonly globalPaused: boolean;
}

export interface ReviewCompletionAction {
  readonly type: "REVIEW_COMPLETED";
  readonly action: ActionRecord;
  readonly operationId: AIWorkOperationId;
  readonly bundleId: ReviewBundleId;
  readonly reason?: ActionReason;
}

export interface ReviewBlockedAction {
  readonly type: "REVIEW_BLOCKED";
  readonly action: ActionRecord;
  readonly operationId: AIWorkOperationId;
  readonly bundleId: ReviewBundleId;
  readonly reason: ActionReason;
}

export type HeldContinuationType =
  "CONTINUE_AI_WORK" | "RETRY_RESOLUTION" | "REEVALUATE";

export interface HeldContinuationAction {
  readonly type: HeldContinuationType;
  readonly action: ActionRecord;
  readonly operationId: AIWorkOperationId;
  readonly bundleId: ReviewBundleId;
  readonly parentBundleId: ReviewBundleId;
}

export interface ReleaseReviewHoldAction {
  readonly type:
    | "RELEASE_AFTER_PUBLISHED"
    | "RELEASE_AFTER_PUBLISHED_WITH_ERRORS"
    | "DISCARD_BUNDLE";
  readonly action: ActionRecord;
  readonly bundleId: ReviewBundleId;
  readonly outcome: ReviewHoldOutcome;
  readonly worktreeHandled: boolean;
  readonly reason?: ActionReason;
}

export interface PassivePrimaryAction {
  readonly type:
    | "WINDOW_CLOSED"
    | "PROCESS_RESTARTED"
    | "SLEEP_WAKE"
    | "PAUSE_CHANGED"
    | "REMOTE_EVENT_OBSERVED";
  readonly action: ActionRecord;
}

export type PrimaryPrAction =
  | AutomaticReviewDispatchAction
  | ReviewCompletionAction
  | ReviewBlockedAction
  | HeldContinuationAction
  | ReleaseReviewHoldAction
  | PassivePrimaryAction;

export const PRIMARY_ACTION_TYPES = [
  "DISPATCH_AUTOMATIC_REVIEW",
  "REVIEW_COMPLETED",
  "REVIEW_BLOCKED",
  "CONTINUE_AI_WORK",
  "RETRY_RESOLUTION",
  "REEVALUATE",
  "RELEASE_AFTER_PUBLISHED",
  "RELEASE_AFTER_PUBLISHED_WITH_ERRORS",
  "DISCARD_BUNDLE",
  "WINDOW_CLOSED",
  "PROCESS_RESTARTED",
  "SLEEP_WAKE",
  "PAUSE_CHANGED",
  "REMOTE_EVENT_OBSERVED",
] as const;

function reviewHoldReason(bundleId: ReviewBundleId): ActionReason {
  return unsafeReason(
    "REVIEW_HOLD_ACTIVE",
    "This pull request has a review hold.",
    "The current Review Bundle must receive an explicit user outcome before automatic work can start.",
    "REVIEW",
    { bundleId },
  );
}

function noEventReason(): ActionReason {
  return unsafeReason(
    "NO_ACTIONABLE_EVENT",
    "No actionable feedback is available.",
    "Automatic work is not started for an empty or ineligible batch.",
    "NONE",
  );
}

function pausedReason(): ActionReason {
  return unsafeReason(
    "WATCHING_PAUSED",
    "Automatic watching is paused.",
    "Global pause blocks new automatic review dispatches while preserving existing state.",
    "NONE",
  );
}

function invalidTransitionReason(
  state: PrimaryPrState,
  action: string,
): ActionReason {
  return unsafeReason(
    "INVALID_TRANSITION",
    `The PR is ${state} and cannot perform ${action}.`,
    "The requested action is not legal for the current primary review state.",
    "REVIEW",
    { state, action },
  );
}

function missingAssociationReason(): ActionReason {
  return unsafeReason(
    "EXPLICIT_ACTION_REQUIRED",
    "The continuation is missing its explicit operation association.",
    "Only a recorded human action tied to a bundle and operation can release a review hold.",
    "REVIEW",
  );
}

function buildEvent(
  state: PrimaryPrSnapshot,
  action: ActionRecord,
  nextState: PrimaryPrState,
  occurredAt: UtcInstant,
  reason?: ActionReason,
): TransitionEvent {
  return createTransitionEvent({
    transitionId: action.transitionId,
    actionId: action.actionId,
    actor: action.actor,
    aggregateKind: "PRIMARY_PR",
    aggregateId: state.prId,
    priorState: state.state,
    nextState,
    occurredAt,
    ...(reason === undefined ? {} : { reason }),
    ...(action.correlationId === undefined
      ? {}
      : { correlationId: action.correlationId }),
  });
}

function initialHold(
  state: PrimaryPrSnapshot,
  bundleId: ReviewBundleId,
  reason: ActionReason,
  acquiredAt: UtcInstant,
): AutomaticReviewHold {
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    kind: "review-hold",
    prId: state.prId,
    bundleId,
    reason,
    acquiredAt,
  };
}

function expectedVersionCheck<T>(
  state: PrimaryPrSnapshot,
  action: ActionRecord,
): DomainResult<T> | undefined {
  if (
    action.expectedVersion !== undefined &&
    action.expectedVersion !== state.version
  ) {
    return transitionConflict<T>(
      "The primary PR state changed before this action was applied.",
      { expectedVersion: action.expectedVersion, actualVersion: state.version },
    );
  }
  return undefined;
}

function changedPrimary(
  previous: PrimaryPrSnapshot,
  next: Omit<PrimaryPrSnapshot, "version" | "history">,
  action: ActionRecord,
  clock: Clock,
  reason?: ActionReason,
): TransitionDecision<PrimaryPrSnapshot> {
  const event = buildEvent(previous, action, next.state, clock.now(), reason);
  return changed(
    {
      ...next,
      version: previous.version + 1,
      history: [...previous.history, event],
    },
    event,
  );
}

export function createPrimaryPrSnapshot(input: {
  readonly prId: ManagedPrId;
  readonly clock: Clock;
}): PrimaryPrSnapshot {
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    kind: "primary-pr-snapshot",
    prId: input.prId,
    state: "WATCHING",
    version: 0,
    history: [],
  };
}

export function reducePrimaryPr(
  state: PrimaryPrSnapshot,
  action: PrimaryPrAction,
  clock: Clock,
): DomainResult<TransitionDecision<PrimaryPrSnapshot>> {
  const versionError = expectedVersionCheck<
    TransitionDecision<PrimaryPrSnapshot>
  >(state, action.action);
  if (versionError !== undefined) return versionError;

  if (
    action.type === "WINDOW_CLOSED" ||
    action.type === "PROCESS_RESTARTED" ||
    action.type === "SLEEP_WAKE" ||
    action.type === "PAUSE_CHANGED" ||
    action.type === "REMOTE_EVENT_OBSERVED"
  ) {
    return success(
      noOp(
        state,
        unsafeReason(
          "NO_STATE_CHANGE",
          "The lifecycle event was observed without changing PR review state.",
          "Renderer lifetime, restart, sleep, and observation do not release a hold or reset work.",
          "NONE",
        ),
      ),
    );
  }

  if (action.type === "DISPATCH_AUTOMATIC_REVIEW") {
    if (action.globalPaused) {
      return failure(
        createDomainError({
          code: "WATCHING_PAUSED",
          category: "PAUSED",
          retryable: true,
          userAction: "NONE",
          messageKey: "domain.review.paused",
          reason: pausedReason(),
          priorState: state.state,
          currentState: state.state,
        }),
      );
    }
    if (!action.eligible) {
      return success(noOp(state, noEventReason()));
    }
    if (state.hold !== undefined) {
      return failure(
        createDomainError({
          code: "REVIEW_HOLD_ACTIVE",
          category: "HOLD",
          retryable: false,
          userAction: "REVIEW",
          messageKey: "domain.review.hold",
          reason: reviewHoldReason(state.hold.bundleId),
          details: { bundleId: state.hold.bundleId },
          priorState: state.state,
          currentState: state.state,
        }),
      );
    }
    if (state.state !== "WATCHING") {
      return failure(
        createDomainError({
          code: "INVALID_TRANSITION",
          category: "INVALID_TRANSITION",
          retryable: true,
          userAction: "RETRY",
          messageKey: "domain.review.invalid-transition",
          reason: invalidTransitionReason(state.state, action.type),
          priorState: state.state,
          currentState: state.state,
        }),
      );
    }
    if (state.activeAutomaticOperationId !== undefined) {
      return failure(
        createDomainError({
          code: "CONCURRENT_STATE_CONFLICT",
          category: "CONFLICT",
          retryable: true,
          userAction: "RETRY",
          messageKey: "domain.review.operation-active",
          reason: unsafeReason(
            "AUTOMATIC_OPERATION_ACTIVE",
            "Automatic review work is already active for this PR.",
            "Only one automatic review operation may own a PR at a time.",
            "RETRY",
            { operationId: state.activeAutomaticOperationId },
          ),
          details: { operationId: state.activeAutomaticOperationId },
          priorState: state.state,
          currentState: state.state,
        }),
      );
    }
    return success(
      changedPrimary(
        state,
        {
          schemaVersion: DOMAIN_SCHEMA_VERSION,
          kind: "primary-pr-snapshot",
          prId: state.prId,
          state: "WORKING",
          activeAutomaticOperationId: action.operationId,
          currentBundleId: action.bundleId,
        },
        action.action,
        clock,
      ),
    );
  }

  if (action.type === "REVIEW_COMPLETED" || action.type === "REVIEW_BLOCKED") {
    const reason =
      action.type === "REVIEW_BLOCKED"
        ? action.reason
        : (action.reason ??
          unsafeReason(
            "REVIEW_READY",
            "Automatic review produced a reviewable bundle.",
            "The exact proposed work and validation evidence are ready for explicit human review.",
            "REVIEW",
            { bundleId: action.bundleId },
          ));
    const nextState: PrimaryPrState =
      action.type === "REVIEW_BLOCKED" ? "NEEDS_ATTENTION" : "READY_FOR_REVIEW";
    if (
      state.state !== "WORKING" ||
      state.activeAutomaticOperationId !== action.operationId ||
      state.currentBundleId !== action.bundleId
    ) {
      return failure(
        createDomainError({
          code: "INVALID_TRANSITION",
          category: "INVALID_TRANSITION",
          retryable: true,
          userAction: "RETRY",
          messageKey: "domain.review.completion-invalid",
          reason: invalidTransitionReason(state.state, action.type),
          details: {
            bundleId: action.bundleId,
            operationId: action.operationId,
          },
          priorState: state.state,
          currentState: state.state,
        }),
      );
    }
    return success(
      changedPrimary(
        state,
        {
          schemaVersion: DOMAIN_SCHEMA_VERSION,
          kind: "primary-pr-snapshot",
          prId: state.prId,
          state: nextState,
          currentBundleId: action.bundleId,
          hold: initialHold(state, action.bundleId, reason, clock.now()),
          lastReason: reason,
        },
        action.action,
        clock,
        reason,
      ),
    );
  }

  if (
    action.type === "CONTINUE_AI_WORK" ||
    action.type === "RETRY_RESOLUTION" ||
    action.type === "REEVALUATE"
  ) {
    if (
      action.action.actor !== "HUMAN" ||
      state.hold === undefined ||
      state.currentBundleId !== action.parentBundleId ||
      state.hold.bundleId !== action.parentBundleId ||
      action.bundleId === action.parentBundleId
    ) {
      return failure(
        createDomainError({
          code: "REVIEW_HOLD_ACTIVE",
          category: "HOLD",
          retryable: false,
          userAction: "REVIEW",
          messageKey: "domain.review.explicit-action-required",
          reason: missingAssociationReason(),
          priorState: state.state,
          currentState: state.state,
        }),
      );
    }
    return success(
      changedPrimary(
        state,
        {
          schemaVersion: DOMAIN_SCHEMA_VERSION,
          kind: "primary-pr-snapshot",
          prId: state.prId,
          state: "WORKING",
          activeAutomaticOperationId: action.operationId,
          currentBundleId: action.bundleId,
        },
        action.action,
        clock,
        unsafeReason(
          "EXPLICIT_CONTINUATION",
          "A human explicitly authorized a bounded continuation.",
          "The previous held work remains in history and the new operation has its own association.",
          "NONE",
          { parentBundleId: action.parentBundleId, action: action.type },
        ),
      ),
    );
  }

  if (
    action.type === "RELEASE_AFTER_PUBLISHED" ||
    action.type === "RELEASE_AFTER_PUBLISHED_WITH_ERRORS" ||
    action.type === "DISCARD_BUNDLE"
  ) {
    const allowedOutcome =
      (action.type === "RELEASE_AFTER_PUBLISHED" &&
        action.outcome === "PUBLISHED") ||
      (action.type === "RELEASE_AFTER_PUBLISHED_WITH_ERRORS" &&
        action.outcome === "PUBLISHED_WITH_ERRORS") ||
      (action.type === "DISCARD_BUNDLE" && action.outcome === "DISCARDED");
    if (
      action.action.actor !== "HUMAN" ||
      state.hold === undefined ||
      state.hold.bundleId !== action.bundleId ||
      !action.worktreeHandled ||
      !allowedOutcome
    ) {
      return failure(
        createDomainError({
          code: "INVALID_TRANSITION",
          category: "INVALID_TRANSITION",
          retryable: false,
          userAction: "REVIEW",
          messageKey: "domain.review.release-invalid",
          reason: invalidTransitionReason(state.state, action.type),
          priorState: state.state,
          currentState: state.state,
        }),
      );
    }
    const reason =
      action.reason ??
      unsafeReason(
        action.outcome,
        `The held Review Bundle is ${action.outcome.toLowerCase()}.`,
        "The explicit outcome permits monitoring to resume for this PR.",
        "NONE",
        { bundleId: action.bundleId },
      );
    return success(
      changedPrimary(
        state,
        {
          schemaVersion: DOMAIN_SCHEMA_VERSION,
          kind: "primary-pr-snapshot",
          prId: state.prId,
          state: "WATCHING",
          lastReason: reason,
        },
        action.action,
        clock,
        reason,
      ),
    );
  }

  return failure(
    createDomainError({
      code: "INVALID_INPUT",
      category: "INVALID_INPUT",
      retryable: false,
      userAction: "FIX_INPUT",
      messageKey: "domain.review.action-unknown",
      reason: unsafeReason(
        "INVALID_INPUT",
        "The primary review action is unknown.",
        "The domain cannot safely interpret an unsupported action.",
        "FIX_INPUT",
      ),
    }),
  );
}

export function resolveConcurrentAutomaticDispatches(
  initial: PrimaryPrSnapshot,
  actions: readonly AutomaticReviewDispatchAction[],
  clock: Clock,
): readonly DomainResult<TransitionDecision<PrimaryPrSnapshot>>[] {
  const ordered = [...actions].sort((left, right) =>
    left.action.actionId.localeCompare(right.action.actionId),
  );
  let current = initial;
  const results: DomainResult<TransitionDecision<PrimaryPrSnapshot>>[] = [];
  for (const action of ordered) {
    const result = reducePrimaryPr(current, action, clock);
    results.push(result);
    if (result.ok && result.value.changed) current = result.value.state;
  }
  return results;
}

export function setWatchingPaused(
  current: WatchingOverlay,
  paused: boolean,
  changedAt: UtcInstant,
): WatchingOverlay {
  if (current.paused === paused) return current;
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    kind: "watching-overlay",
    paused,
    version: current.version + 1,
    changedAt,
  };
}

export function createWatchingOverlay(clock: Clock): WatchingOverlay {
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    kind: "watching-overlay",
    paused: false,
    version: 0,
    changedAt: clock.now(),
  };
}

export function parseWatchingOverlay(
  value: unknown,
): DomainResult<WatchingOverlay> {
  const record = readStrictRecord(value, "watching overlay", [
    "schemaVersion",
    "kind",
    "paused",
    "version",
    "changedAt",
  ]);
  if (!record.ok) return record;
  const data = record.value;
  const schema = parseSchemaVersion(data.schemaVersion);
  const changedAt = parseUtcInstant(data.changedAt);
  if (!schema.ok) return schema;
  if (!changedAt.ok) return changedAt;
  if (
    data.kind !== "watching-overlay" ||
    typeof data.paused !== "boolean" ||
    !Number.isInteger(data.version) ||
    (data.version as number) < 0
  ) {
    return failure(
      createDomainError({
        code: "INVALID_CONTRACT",
        category: "INVALID_INPUT",
        retryable: false,
        userAction: "FIX_INPUT",
        messageKey: "domain.primary.overlay-invalid",
        reason: unsafeReason(
          "INVALID_CONTRACT",
          "The watching pause overlay contains invalid values.",
          "Global pause is an overlay and cannot be coerced into a PR state.",
          "FIX_INPUT",
        ),
      }),
    );
  }
  return success({
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    kind: "watching-overlay",
    paused: data.paused,
    version: data.version as number,
    changedAt: changedAt.value,
  });
}

export function parseReviewHold(
  value: unknown,
): DomainResult<AutomaticReviewHold> {
  const record = readStrictRecord(value, "review hold", [
    "schemaVersion",
    "kind",
    "prId",
    "bundleId",
    "reason",
    "acquiredAt",
  ]);
  if (!record.ok) return record;
  const data = record.value;
  const schema = parseSchemaVersion(data.schemaVersion);
  const prId = parseManagedPrId(data.prId);
  const bundleId = parseReviewBundleId(data.bundleId);
  const reason = parseDomainReason(data.reason);
  const acquiredAt = parseUtcInstant(data.acquiredAt);
  if (!schema.ok) return schema;
  if (!prId.ok) return prId;
  if (!bundleId.ok) return bundleId;
  if (!reason.ok) return reason;
  if (!acquiredAt.ok) return acquiredAt;
  if (data.kind !== "review-hold") {
    return failure(
      createDomainError({
        code: "INVALID_CONTRACT",
        category: "INVALID_INPUT",
        retryable: false,
        userAction: "FIX_INPUT",
        messageKey: "domain.primary.hold-invalid",
        reason: unsafeReason(
          "INVALID_CONTRACT",
          "The review hold kind is unknown.",
          "A hold cannot be restored without its explicit bundle association.",
          "FIX_INPUT",
        ),
      }),
    );
  }
  return success({
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    kind: "review-hold",
    prId: prId.value,
    bundleId: bundleId.value,
    reason: reason.value,
    acquiredAt: acquiredAt.value,
  });
}

export function parsePrimaryPrSnapshot(
  value: unknown,
): DomainResult<PrimaryPrSnapshot> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return failure(
      createDomainError({
        code: "INVALID_CONTRACT",
        category: "INVALID_INPUT",
        retryable: false,
        userAction: "FIX_INPUT",
        messageKey: "domain.primary.invalid",
        reason: unsafeReason(
          "INVALID_CONTRACT",
          "The primary PR snapshot is not an object.",
          "Primary review state cannot be safely restored.",
          "FIX_INPUT",
        ),
      }),
    );
  }
  const data = value as Record<string, unknown>;
  const allowed = new Set([
    "schemaVersion",
    "kind",
    "prId",
    "state",
    "version",
    "activeAutomaticOperationId",
    "currentBundleId",
    "hold",
    "lastReason",
    "history",
  ]);
  if (Object.keys(data).some((key) => !allowed.has(key))) {
    return failure(
      createDomainError({
        code: "INVALID_CONTRACT",
        category: "INVALID_INPUT",
        retryable: false,
        userAction: "FIX_INPUT",
        messageKey: "domain.primary.invalid",
        reason: unsafeReason(
          "INVALID_CONTRACT",
          "The primary PR snapshot has unsupported fields.",
          "Unknown state data is rejected rather than reinterpreted.",
          "FIX_INPUT",
        ),
      }),
    );
  }
  const schema = parseSchemaVersion(data.schemaVersion);
  const prId = parseManagedPrId(data.prId);
  if (!schema.ok) return schema;
  if (!prId.ok) return prId;
  if (
    data.kind !== "primary-pr-snapshot" ||
    typeof data.state !== "string" ||
    !PRIMARY_PR_STATES.includes(data.state as PrimaryPrState) ||
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
        messageKey: "domain.primary.invalid",
        reason: unsafeReason(
          "INVALID_CONTRACT",
          "The primary PR snapshot has invalid state values.",
          "Only the four documented MVP primary states may be restored.",
          "FIX_INPUT",
        ),
      }),
    );
  }
  const operationId =
    data.activeAutomaticOperationId === undefined
      ? undefined
      : parseAIWorkOperationId(data.activeAutomaticOperationId);
  const bundleId =
    data.currentBundleId === undefined
      ? undefined
      : parseReviewBundleId(data.currentBundleId);
  if (operationId !== undefined && !operationId.ok) return operationId;
  if (bundleId !== undefined && !bundleId.ok) return bundleId;
  const hold = data.hold === undefined ? undefined : parseReviewHold(data.hold);
  if (hold !== undefined && !hold.ok) return hold;
  const lastReason =
    data.lastReason === undefined
      ? undefined
      : parseDomainReason(data.lastReason);
  if (lastReason !== undefined && !lastReason.ok) return lastReason;
  const history: TransitionEvent[] = [];
  for (const event of data.history) {
    const parsed = parseTransitionEvent(event);
    if (!parsed.ok) return parsed;
    if (
      parsed.value.aggregateKind !== "PRIMARY_PR" ||
      parsed.value.aggregateId !== prId.value
    ) {
      return failure(
        createDomainError({
          code: "INVALID_CONTRACT",
          category: "INVALID_INPUT",
          retryable: false,
          userAction: "FIX_INPUT",
          messageKey: "domain.primary.history-invalid",
          reason: unsafeReason(
            "INVALID_CONTRACT",
            "The primary PR history contains an event for another aggregate.",
            "Historical transitions must remain scoped to the restored PR.",
            "FIX_INPUT",
          ),
        }),
      );
    }
    history.push(parsed.value);
  }
  const primaryState = data.state as PrimaryPrState;
  if (
    (primaryState === "WATCHING" &&
      (operationId !== undefined || hold !== undefined)) ||
    (primaryState === "WORKING" &&
      (operationId === undefined || bundleId === undefined))
  ) {
    return failure(
      createDomainError({
        code: "INVALID_CONTRACT",
        category: "INVALID_INPUT",
        retryable: false,
        userAction: "FIX_INPUT",
        messageKey: "domain.primary.operation-invalid",
        reason: unsafeReason(
          "INVALID_CONTRACT",
          "The primary PR operation admission fields do not match its state.",
          "WATCHING cannot retain active work and WORKING must retain its operation and bundle identities.",
          "FIX_INPUT",
        ),
      }),
    );
  }
  if (
    (primaryState === "READY_FOR_REVIEW" ||
      primaryState === "NEEDS_ATTENTION") &&
    (hold === undefined ||
      bundleId === undefined ||
      hold.value.bundleId !== bundleId.value)
  ) {
    return failure(
      createDomainError({
        code: "INVALID_CONTRACT",
        category: "INVALID_INPUT",
        retryable: false,
        userAction: "FIX_INPUT",
        messageKey: "domain.primary.hold-invalid",
        reason: unsafeReason(
          "INVALID_CONTRACT",
          "A held primary state is missing its bundle-linked hold.",
          "READY_FOR_REVIEW and NEEDS_ATTENTION must remain blocked until an explicit outcome.",
          "FIX_INPUT",
        ),
      }),
    );
  }
  return success({
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    kind: "primary-pr-snapshot",
    prId: prId.value,
    state: primaryState,
    version: data.version as number,
    ...(operationId === undefined
      ? {}
      : { activeAutomaticOperationId: operationId.value }),
    ...(bundleId === undefined ? {} : { currentBundleId: bundleId.value }),
    ...(hold === undefined ? {} : { hold: hold.value }),
    ...(lastReason === undefined ? {} : { lastReason: lastReason.value }),
    history,
  });
}
