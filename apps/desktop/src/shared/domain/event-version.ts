import {
  createDomainError,
  DOMAIN_SCHEMA_VERSION,
  failure,
  parseDomainReason,
  type ActionReason,
  type DomainResult,
  success,
  unsafeReason,
} from "./result";
import {
  createTransitionEvent,
  changed,
  noOp,
  type TransitionDecision,
  type TransitionEvent,
} from "./transition";
import { parseTransitionEvent } from "./transition";
import {
  parseManagedPrId,
  parseRemoteEventVersionId,
  parseReviewBundleId,
  parseSchemaVersion,
  parseSemanticHash,
  parseUtcInstant,
  type ActionRecord,
  type Clock,
  type ManagedPrId,
  type RemoteEventVersionId,
  type ReviewBundleId,
  type SemanticHash,
  type UtcInstant,
} from "./primitives";

export const EVENT_VERSION_STATES = [
  "UNASSIGNED",
  "ASSIGNED_TO_ACTIVE_BUNDLE",
  "RETAINED_DURING_HOLD",
  "HANDLED_BY_BUNDLE",
] as const;
export type EventVersionAssociationState =
  (typeof EVENT_VERSION_STATES)[number];

export interface EventVersionAssociation {
  readonly schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  readonly kind: "event-version-association";
  readonly prId: ManagedPrId;
  readonly eventVersionId: RemoteEventVersionId;
  readonly remoteObjectKey: string;
  readonly semanticHash: SemanticHash;
  readonly observedAt: UtcInstant;
  readonly state: EventVersionAssociationState;
  readonly version: number;
  readonly bundleId?: ReviewBundleId;
  readonly lastReason?: ActionReason;
  readonly history: readonly TransitionEvent[];
}

export interface AssignEventVersionAction {
  readonly type: "ASSIGN_TO_ACTIVE_BUNDLE";
  readonly action: ActionRecord;
  readonly bundleId: ReviewBundleId;
}

export interface RetainEventVersionAction {
  readonly type: "RETAIN_DURING_HOLD";
  readonly action: ActionRecord;
  readonly reason: ActionReason;
}

export interface ReevaluateRetainedEventAction {
  readonly type: "ASSIGN_RETAINED_AFTER_HOLD";
  readonly action: ActionRecord;
  readonly bundleId: ReviewBundleId;
  readonly authorized: boolean;
}

export interface HandleEventVersionAction {
  readonly type: "MARK_HANDLED_BY_BUNDLE";
  readonly action: ActionRecord;
  readonly bundleId: ReviewBundleId;
  readonly outcome: "PUBLISHED" | "PUBLISHED_WITH_ERRORS" | "DISCARDED";
}

export type EventVersionAction =
  | AssignEventVersionAction
  | RetainEventVersionAction
  | ReevaluateRetainedEventAction
  | HandleEventVersionAction;

function eventReason(
  code: string,
  what: string,
  why: string,
  nextAction: "NONE" | "REVIEW" | "RE_EVALUATE" | "RETRY",
  details: Record<string, string> = {},
): ActionReason {
  return unsafeReason(code, what, why, nextAction, details);
}

function eventFailure<T>(
  code:
    | "DUPLICATE_EVENT_VERSION"
    | "EVENT_VERSION_ALREADY_HANDLED"
    | "REVIEW_HOLD_ACTIVE"
    | "INVALID_TRANSITION",
  category: "DUPLICATE" | "HOLD" | "INVALID_TRANSITION",
  reason: ActionReason,
  state: EventVersionAssociation,
): DomainResult<T> {
  return failure(
    createDomainError({
      code,
      category,
      retryable: category === "INVALID_TRANSITION",
      userAction: reason.nextAction,
      messageKey: `domain.event.${code.toLowerCase()}`,
      reason,
      details: { eventVersionId: state.eventVersionId },
      priorState: state.state,
      currentState: state.state,
    }),
  );
}

function eventDecision(
  previous: EventVersionAssociation,
  nextState: EventVersionAssociationState,
  action: ActionRecord,
  clock: Clock,
  reason?: ActionReason,
  bundleId?: ReviewBundleId,
): TransitionDecision<EventVersionAssociation> {
  const event = createTransitionEvent({
    transitionId: action.transitionId,
    actionId: action.actionId,
    actor: action.actor,
    aggregateKind: "EVENT_VERSION",
    aggregateId: previous.eventVersionId,
    priorState: previous.state,
    nextState,
    occurredAt: clock.now(),
    ...(reason === undefined ? {} : { reason }),
    ...(action.correlationId === undefined
      ? {}
      : { correlationId: action.correlationId }),
  });
  return changed(
    {
      ...previous,
      state: nextState,
      ...(bundleId === undefined ? {} : { bundleId }),
      ...(reason === undefined ? {} : { lastReason: reason }),
      version: previous.version + 1,
      history: [...previous.history, event],
    },
    event,
  );
}

export function createEventVersionAssociation(input: {
  readonly prId: ManagedPrId;
  readonly eventVersionId: RemoteEventVersionId;
  readonly remoteObjectKey: string;
  readonly semanticHash: SemanticHash;
  readonly observedAt: UtcInstant;
}): EventVersionAssociation {
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    kind: "event-version-association",
    prId: input.prId,
    eventVersionId: input.eventVersionId,
    remoteObjectKey: input.remoteObjectKey,
    semanticHash: input.semanticHash,
    observedAt: input.observedAt,
    state: "UNASSIGNED",
    version: 0,
    history: [],
  };
}

export function associateEventVersion(
  state: EventVersionAssociation,
  action: EventVersionAction,
  clock: Clock,
): DomainResult<TransitionDecision<EventVersionAssociation>> {
  if (
    action.action.expectedVersion !== undefined &&
    action.action.expectedVersion !== state.version
  ) {
    return failure(
      createDomainError({
        code: "CONCURRENT_STATE_CONFLICT",
        category: "CONFLICT",
        retryable: true,
        userAction: "RETRY",
        messageKey: "domain.event.version-conflict",
        reason: eventReason(
          "CONCURRENT_STATE_CONFLICT",
          "The immutable event association changed before this action was applied.",
          "Only one bundle claim may win the persisted association version.",
          "RETRY",
        ),
        details: {
          expectedVersion: action.action.expectedVersion,
          actualVersion: state.version,
        },
        priorState: state.state,
        currentState: state.state,
      }),
    );
  }
  if (action.type === "ASSIGN_TO_ACTIVE_BUNDLE") {
    if (
      state.state === "ASSIGNED_TO_ACTIVE_BUNDLE" &&
      state.bundleId === action.bundleId
    ) {
      return success(
        noOp(
          state,
          eventReason(
            "DUPLICATE_EVENT_VERSION",
            "This event version is already assigned to the requested bundle.",
            "Retrying the same immutable version is idempotent.",
            "NONE",
            { bundleId: action.bundleId },
          ),
        ),
      );
    }
    if (state.state === "RETAINED_DURING_HOLD") {
      return eventFailure(
        "REVIEW_HOLD_ACTIVE",
        "HOLD",
        eventReason(
          "EVENT_VERSION_RETAINED_DURING_HOLD",
          "This event version was observed during a review hold.",
          "Held feedback must remain separate until an explicit re-evaluation authorizes a new bundle.",
          "RE_EVALUATE",
        ),
        state,
      );
    }
    if (state.state === "HANDLED_BY_BUNDLE") {
      return eventFailure(
        "EVENT_VERSION_ALREADY_HANDLED",
        "DUPLICATE",
        eventReason(
          "EVENT_VERSION_ALREADY_HANDLED",
          "This event version has already been handled by a Review Bundle.",
          "Handled immutable feedback cannot re-enter automatic analysis.",
          "NONE",
        ),
        state,
      );
    }
    if (state.state !== "UNASSIGNED") {
      return eventFailure(
        "INVALID_TRANSITION",
        "INVALID_TRANSITION",
        eventReason(
          "INVALID_TRANSITION",
          "The event version is not available for bundle assignment.",
          "Only an unassigned immutable version can be claimed by an active bundle.",
          "REVIEW",
        ),
        state,
      );
    }
    return success(
      eventDecision(
        state,
        "ASSIGNED_TO_ACTIVE_BUNDLE",
        action.action,
        clock,
        eventReason(
          "EVENT_VERSION_ASSIGNED",
          "The immutable event version was claimed by the active bundle.",
          "The bundle now owns this exact semantic snapshot for its lifetime.",
          "NONE",
          { bundleId: action.bundleId },
        ),
        action.bundleId,
      ),
    );
  }

  if (action.type === "RETAIN_DURING_HOLD") {
    if (state.state === "RETAINED_DURING_HOLD") {
      return success(noOp(state, action.reason));
    }
    if (state.state !== "UNASSIGNED") {
      return eventFailure(
        state.state === "HANDLED_BY_BUNDLE"
          ? "EVENT_VERSION_ALREADY_HANDLED"
          : "INVALID_TRANSITION",
        state.state === "HANDLED_BY_BUNDLE"
          ? "DUPLICATE"
          : "INVALID_TRANSITION",
        eventReason(
          state.state === "HANDLED_BY_BUNDLE"
            ? "EVENT_VERSION_ALREADY_HANDLED"
            : "INVALID_TRANSITION",
          "The event version cannot be retained in its current association state.",
          "Association history is append-only and cannot be rewritten.",
          "NONE",
        ),
        state,
      );
    }
    return success(
      eventDecision(
        state,
        "RETAINED_DURING_HOLD",
        action.action,
        clock,
        action.reason,
      ),
    );
  }

  if (action.type === "ASSIGN_RETAINED_AFTER_HOLD") {
    if (
      action.action.actor !== "HUMAN" ||
      !action.authorized ||
      state.state !== "RETAINED_DURING_HOLD"
    ) {
      return eventFailure(
        "REVIEW_HOLD_ACTIVE",
        "HOLD",
        eventReason(
          "EXPLICIT_REEVALUATION_REQUIRED",
          "The retained event version is still protected by the review hold.",
          "Only an explicit human re-evaluation can authorize a new bundle association.",
          "RE_EVALUATE",
        ),
        state,
      );
    }
    return success(
      eventDecision(
        state,
        "ASSIGNED_TO_ACTIVE_BUNDLE",
        action.action,
        clock,
        eventReason(
          "EVENT_VERSION_REEVALUATED",
          "The retained event version was explicitly re-evaluated.",
          "A new bundle may use this immutable snapshot after the prior hold outcome.",
          "NONE",
          { bundleId: action.bundleId },
        ),
        action.bundleId,
      ),
    );
  }

  if (
    state.state === "HANDLED_BY_BUNDLE" &&
    state.bundleId === action.bundleId
  ) {
    return success(
      noOp(
        state,
        eventReason(
          "DUPLICATE_EVENT_VERSION",
          "This event version is already marked handled by the bundle.",
          "Repeating publication or discard does not create another association.",
          "NONE",
        ),
      ),
    );
  }
  if (
    state.state !== "ASSIGNED_TO_ACTIVE_BUNDLE" ||
    state.bundleId !== action.bundleId
  ) {
    return eventFailure(
      state.state === "HANDLED_BY_BUNDLE"
        ? "EVENT_VERSION_ALREADY_HANDLED"
        : "INVALID_TRANSITION",
      state.state === "HANDLED_BY_BUNDLE" ? "DUPLICATE" : "INVALID_TRANSITION",
      eventReason(
        state.state === "HANDLED_BY_BUNDLE"
          ? "EVENT_VERSION_ALREADY_HANDLED"
          : "INVALID_TRANSITION",
        "The event version is not assigned to this bundle.",
        "Only the owning bundle may append the handled outcome.",
        "REVIEW",
      ),
      state,
    );
  }
  return success(
    eventDecision(
      state,
      "HANDLED_BY_BUNDLE",
      action.action,
      clock,
      eventReason(
        "EVENT_VERSION_HANDLED",
        "The immutable event version was handled by the Review Bundle.",
        "Publishing or discarding preserves this handled association permanently.",
        "NONE",
        { outcome: action.outcome },
      ),
      action.bundleId,
    ),
  );
}

export function parseEventVersionAssociation(
  value: unknown,
): DomainResult<EventVersionAssociation> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return failure(
      createDomainError({
        code: "INVALID_CONTRACT",
        category: "INVALID_INPUT",
        retryable: false,
        userAction: "FIX_INPUT",
        messageKey: "domain.event.invalid",
        reason: unsafeReason(
          "INVALID_CONTRACT",
          "The event-version association is not an object.",
          "Immutable feedback history cannot be restored safely.",
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
    "eventVersionId",
    "remoteObjectKey",
    "semanticHash",
    "observedAt",
    "state",
    "version",
    "bundleId",
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
        messageKey: "domain.event.invalid",
        reason: unsafeReason(
          "INVALID_CONTRACT",
          "The event-version association contains unsupported fields.",
          "Unknown association data could rewrite immutable history.",
          "FIX_INPUT",
        ),
      }),
    );
  }
  const schema = parseSchemaVersion(data.schemaVersion);
  const prId = parseManagedPrId(data.prId);
  const eventVersionId = parseRemoteEventVersionId(data.eventVersionId);
  const semanticHash = parseSemanticHash(data.semanticHash);
  const observedAt = parseUtcInstant(data.observedAt);
  if (!schema.ok) return schema;
  if (!prId.ok) return prId;
  if (!eventVersionId.ok) return eventVersionId;
  if (!semanticHash.ok) return semanticHash;
  if (!observedAt.ok) return observedAt;
  const bundleId =
    data.bundleId === undefined
      ? undefined
      : parseReviewBundleId(data.bundleId);
  if (bundleId !== undefined && !bundleId.ok) return bundleId;
  if (
    data.kind !== "event-version-association" ||
    typeof data.remoteObjectKey !== "string" ||
    !EVENT_VERSION_STATES.includes(
      data.state as EventVersionAssociationState,
    ) ||
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
        messageKey: "domain.event.invalid",
        reason: unsafeReason(
          "INVALID_CONTRACT",
          "The event-version association contains invalid state values.",
          "Only the documented immutable association states may be restored.",
          "FIX_INPUT",
        ),
      }),
    );
  }
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
      parsed.value.aggregateKind !== "EVENT_VERSION" ||
      parsed.value.aggregateId !== eventVersionId.value
    ) {
      return failure(
        createDomainError({
          code: "INVALID_CONTRACT",
          category: "INVALID_INPUT",
          retryable: false,
          userAction: "FIX_INPUT",
          messageKey: "domain.event.history-invalid",
          reason: unsafeReason(
            "INVALID_CONTRACT",
            "The event-version history contains another aggregate.",
            "Immutable association history must remain scoped to one event version.",
            "FIX_INPUT",
          ),
        }),
      );
    }
    history.push(parsed.value);
  }
  if (
    (data.state === "ASSIGNED_TO_ACTIVE_BUNDLE" ||
      data.state === "HANDLED_BY_BUNDLE") &&
    bundleId === undefined
  ) {
    return failure(
      createDomainError({
        code: "INVALID_CONTRACT",
        category: "INVALID_INPUT",
        retryable: false,
        userAction: "FIX_INPUT",
        messageKey: "domain.event.invalid",
        reason: unsafeReason(
          "INVALID_CONTRACT",
          "The event association state is missing its bundle identity.",
          "Assigned and handled versions must retain the owning bundle forever.",
          "FIX_INPUT",
        ),
      }),
    );
  }
  return success({
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    kind: "event-version-association",
    prId: prId.value,
    eventVersionId: eventVersionId.value,
    remoteObjectKey: data.remoteObjectKey,
    semanticHash: semanticHash.value,
    observedAt: observedAt.value,
    state: data.state as EventVersionAssociationState,
    version: data.version as number,
    ...(bundleId === undefined ? {} : { bundleId: bundleId.value }),
    ...(lastReason === undefined ? {} : { lastReason: lastReason.value }),
    history,
  });
}
