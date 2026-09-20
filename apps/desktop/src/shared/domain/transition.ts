import {
  createDomainError,
  DOMAIN_SCHEMA_VERSION,
  failure,
  isSafeText,
  parseDomainReason,
  readStrictRecord,
  success,
  type ActionReason,
  type DomainResult,
} from "./result";
import {
  parseActionId,
  parseCorrelationId,
  parseOpaqueId,
  parseSchemaVersion,
  parseTransitionEventId,
  parseUtcInstant,
  type ActionId,
  type ActorKind,
  type CorrelationId,
  type TransitionEventId,
  type UtcInstant,
} from "./primitives";

export type TransitionAggregateKind =
  | "PRIMARY_PR"
  | "REVIEW_BUNDLE"
  | "EVENT_VERSION"
  | "SYNCHRONIZATION"
  | "PUBLICATION";

export interface TransitionEvent {
  readonly schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  readonly kind: "transition-event";
  readonly transitionId: TransitionEventId;
  readonly actionId: ActionId;
  readonly actor: ActorKind;
  readonly aggregateKind: TransitionAggregateKind;
  readonly aggregateId: string;
  readonly priorState: string;
  readonly nextState: string;
  readonly occurredAt: UtcInstant;
  readonly reason?: ActionReason;
  readonly correlationId?: CorrelationId;
}

export interface TransitionDecision<T> {
  readonly state: T;
  readonly changed: boolean;
  readonly outcome: "CHANGED" | "NOOP";
  readonly reason?: ActionReason;
  readonly event?: TransitionEvent;
}

export function createTransitionEvent(input: {
  readonly transitionId: TransitionEventId;
  readonly actionId: ActionId;
  readonly actor: ActorKind;
  readonly aggregateKind: TransitionAggregateKind;
  readonly aggregateId: string;
  readonly priorState: string;
  readonly nextState: string;
  readonly occurredAt: UtcInstant;
  readonly reason?: ActionReason;
  readonly correlationId?: CorrelationId;
}): TransitionEvent {
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    kind: "transition-event",
    transitionId: input.transitionId,
    actionId: input.actionId,
    actor: input.actor,
    aggregateKind: input.aggregateKind,
    aggregateId: input.aggregateId,
    priorState: input.priorState,
    nextState: input.nextState,
    occurredAt: input.occurredAt,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    ...(input.correlationId === undefined
      ? {}
      : { correlationId: input.correlationId }),
  };
}

export function noOp<T>(state: T, reason: ActionReason): TransitionDecision<T> {
  return { state, changed: false, outcome: "NOOP", reason };
}

export function changed<T>(
  state: T,
  event: TransitionEvent,
): TransitionDecision<T> {
  return { state, changed: true, outcome: "CHANGED", event };
}

export function transitionConflict<T>(
  message: string,
  details: Record<string, string | number>,
): DomainResult<T> {
  return failure(
    createDomainError({
      code: "CONCURRENT_STATE_CONFLICT",
      category: "CONFLICT",
      retryable: true,
      userAction: "RETRY",
      messageKey: "domain.transition.conflict",
      reason: {
        schemaVersion: DOMAIN_SCHEMA_VERSION,
        kind: "action-reason",
        code: "CONCURRENT_STATE_CONFLICT",
        messageKey: "domain.transition.conflict",
        what: message,
        why: "Another deterministic state decision owns the current version.",
        nextAction: "RETRY",
        details,
      },
      details,
    }),
  );
}

export function parseTransitionEvent(
  value: unknown,
): DomainResult<TransitionEvent> {
  const record = readStrictRecord(
    value,
    "transition event",
    [
      "schemaVersion",
      "kind",
      "transitionId",
      "actionId",
      "actor",
      "aggregateKind",
      "aggregateId",
      "priorState",
      "nextState",
      "occurredAt",
    ],
    ["reason", "correlationId"],
  );
  if (!record.ok) return record;
  const data = record.value;
  const schema = parseSchemaVersion(data.schemaVersion);
  const transitionId = parseTransitionEventId(data.transitionId);
  const actionId = parseActionId(data.actionId);
  const occurredAt = parseUtcInstant(data.occurredAt);
  if (!schema.ok) return schema;
  if (!transitionId.ok) return transitionId;
  if (!actionId.ok) return actionId;
  if (!occurredAt.ok) return occurredAt;
  if (
    data.kind !== "transition-event" ||
    typeof data.actor !== "string" ||
    !["SYSTEM", "HUMAN", "RECOVERY"].includes(data.actor) ||
    typeof data.aggregateKind !== "string" ||
    ![
      "PRIMARY_PR",
      "REVIEW_BUNDLE",
      "EVENT_VERSION",
      "SYNCHRONIZATION",
      "PUBLICATION",
    ].includes(data.aggregateKind) ||
    typeof data.aggregateId !== "string" ||
    typeof data.priorState !== "string" ||
    typeof data.nextState !== "string" ||
    !isSafeText(data.aggregateId) ||
    !isSafeText(data.priorState) ||
    !isSafeText(data.nextState)
  ) {
    return failure(
      createDomainError({
        code: "INVALID_CONTRACT",
        category: "INVALID_INPUT",
        retryable: false,
        userAction: "FIX_INPUT",
        messageKey: "domain.transition.invalid",
        reason: {
          schemaVersion: DOMAIN_SCHEMA_VERSION,
          kind: "action-reason",
          code: "INVALID_CONTRACT",
          messageKey: "domain.transition.invalid",
          what: "The transition event contains an invalid value.",
          why: "State history must use known actors, aggregates, and scalar fields.",
          nextAction: "FIX_INPUT",
          details: {},
        },
        details: {},
      }),
    );
  }
  const reason =
    data.reason === undefined ? undefined : parseDomainReason(data.reason);
  if (reason !== undefined && !reason.ok) return reason;
  const correlationId =
    data.correlationId === undefined
      ? undefined
      : parseCorrelationId(data.correlationId);
  if (correlationId !== undefined && !correlationId.ok) return correlationId;
  return success({
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    kind: "transition-event",
    transitionId: transitionId.value,
    actionId: actionId.value,
    actor: data.actor as ActorKind,
    aggregateKind: data.aggregateKind as TransitionAggregateKind,
    aggregateId: data.aggregateId,
    priorState: data.priorState,
    nextState: data.nextState,
    occurredAt: occurredAt.value,
    ...(reason === undefined ? {} : { reason: reason.value }),
    ...(correlationId === undefined
      ? {}
      : { correlationId: correlationId.value }),
  });
}

export function parseTransitionAggregateId(
  value: unknown,
): DomainResult<string> {
  return parseOpaqueId(value, "transition aggregate identifier");
}
