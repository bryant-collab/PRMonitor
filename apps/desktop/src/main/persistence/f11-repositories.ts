import { createHash, randomUUID } from "node:crypto";
import {
  assertBoundedIdentifier,
  assertBoundedText,
  decodeSnapshot,
  encodeSnapshot,
} from "./codecs";
import { PersistenceError } from "./types";
import type { PersistenceStore } from "./database";
import type {
  PersistenceClock,
  PersistenceTransaction,
  SqlRow,
  TransactionOptions,
} from "./types";
import {
  F11_ASSOCIATION_STATES,
  F11_MAX_CLAIM_EVENTS,
  type F11AssociationState,
  type F11ConfigurationSnapshot,
  type F11EligibilityDecision,
  type F11EligibilityResult,
  type F11PrimaryState,
  type F11Reason,
  type F11RemotePrState,
} from "../../shared/domain/eligibility";

type F11ClaimState = "ACTIVE" | "RELEASED" | "HANDLED";

export interface F11StoredRemoteEventVersion {
  readonly eventVersionId: string;
  readonly managedPrId: string;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly observedAt: string;
  readonly semanticHash: string;
  readonly payload: unknown;
}

export interface F11EligibilityDecisionRecord {
  readonly decisionId: string;
  readonly managedPrId: string;
  readonly eventVersionId: string;
  readonly decision: F11EligibilityDecision;
  readonly reason: F11Reason;
  readonly inputSnapshot: unknown;
  readonly configurationSnapshot: F11ConfigurationSnapshot;
  readonly correlationId: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface F11EventAssociationRecord {
  readonly eventVersionId: string;
  readonly managedPrId: string;
  readonly state: F11AssociationState;
  readonly bundleId?: string;
  readonly operationId?: string;
  readonly version: number;
  readonly payload: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface F11AutomaticClaimRecord {
  readonly claimId: string;
  readonly managedPrId: string;
  readonly operationId: string;
  readonly bundleId: string;
  readonly state: F11ClaimState;
  readonly eventVersionIds: readonly string[];
  readonly configurationSnapshot: F11ConfigurationSnapshot;
  readonly correlationId: string;
  readonly outcome?: "PUBLISHED" | "PUBLISHED_WITH_ERRORS" | "DISCARDED";
  readonly version: number;
  readonly createdAt: string;
  readonly releasedAt?: string;
  readonly updatedAt: string;
}

export interface F11HoldRecord {
  readonly holdId: string;
  readonly managedPrId: string;
  readonly claimId: string;
  readonly operationId: string;
  readonly bundleId: string;
  readonly state: "ACTIVE" | "RELEASED";
  readonly reason: F11Reason;
  readonly acquiredAt: string;
  readonly releasedAt?: string;
  readonly outcome?: "PUBLISHED" | "PUBLISHED_WITH_ERRORS" | "DISCARDED";
  readonly version: number;
  readonly updatedAt: string;
}

export interface F11ClaimInput {
  readonly claimId: string;
  readonly holdId: string;
  readonly managedPrId: string;
  readonly operationId: string;
  readonly bundleId: string;
  readonly eventVersionIds: readonly string[];
  readonly configurationSnapshot: F11ConfigurationSnapshot;
  readonly correlationId: string;
  readonly currentPrState: F11RemotePrState;
  readonly primaryState: F11PrimaryState;
  readonly humanAuthorized?: boolean;
  readonly claimedAt?: string;
  readonly signal?: AbortSignal;
}

export type F11ClaimOutcome =
  "CLAIMED" | "REPLAYED" | "EMPTY" | "CONFLICT" | "NOT_ELIGIBLE";

export interface F11ClaimResult {
  readonly outcome: F11ClaimOutcome;
  readonly claim?: F11AutomaticClaimRecord;
  readonly hold?: F11HoldRecord;
  readonly reason: F11Reason;
}

export interface F11CompletionInput {
  readonly managedPrId: string;
  readonly claimId: string;
  readonly operationId: string;
  readonly bundleId: string;
  readonly outcome: "PUBLISHED" | "PUBLISHED_WITH_ERRORS" | "DISCARDED";
  readonly worktreeHandled: boolean;
  readonly actor: "HUMAN";
  readonly completedAt?: string;
  readonly signal?: AbortSignal;
}

export interface F11CompletionResult {
  readonly outcome: "RELEASED" | "REPLAYED" | "CONFLICT";
  readonly claim?: F11AutomaticClaimRecord;
  readonly hold?: F11HoldRecord;
  readonly reason: F11Reason;
}

export interface F11ReevaluationTransferInput {
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
  /** Human authorization is bound to the exact old/new owner identities. */
  readonly authorizationId: string;
  readonly authorizationToken: string;
  readonly expectedOldClaimVersion: number;
  readonly expectedOldHoldVersion: number;
  readonly transferredAt?: string;
}

export interface F11ReevaluationTransferResult {
  readonly outcome: "TRANSFERRED" | "REPLAYED" | "CONFLICT";
  readonly claim?: F11AutomaticClaimRecord;
  readonly hold?: F11HoldRecord;
  readonly reason: F11Reason;
}

export interface F11ReevaluationRollbackInput {
  readonly managedPrId: string;
  readonly oldClaimId: string;
  readonly oldHoldId: string;
  readonly oldOperationId: string;
  readonly oldBundleId: string;
  readonly newClaimId: string;
  readonly newHoldId: string;
  readonly newOperationId: string;
  readonly newBundleId: string;
  readonly originalEventVersionIds: readonly string[];
  readonly retainedEventVersionIds: readonly string[];
  readonly rolledBackAt?: string;
}

export interface F11ReevaluationRollbackResult {
  readonly outcome: "ROLLED_BACK" | "REPLAYED" | "CONFLICT";
  readonly claim?: F11AutomaticClaimRecord;
  readonly hold?: F11HoldRecord;
  readonly reason: F11Reason;
}

function timestamp(clock: PersistenceClock): string {
  const value = clock.now();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
    throw new Error("F11_CLOCK_MUST_RETURN_UTC_MILLISECONDS");
  return value;
}

function id(value: string, label: string): void {
  assertBoundedIdentifier(value, label);
}

function text(value: string, label: string): void {
  assertBoundedText(value, label);
}

function rowString(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`F11_INVALID_ROW_${key}`);
  return value;
}

function optionalString(row: SqlRow, key: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`F11_INVALID_ROW_${key}`);
  return value;
}

function rowNumber(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number") throw new Error(`F11_INVALID_ROW_${key}`);
  return value;
}

function json<T>(row: SqlRow, key: string): T {
  try {
    return JSON.parse(rowString(row, key)) as T;
  } catch (error) {
    throw new Error(`F11_INVALID_JSON_${key}`, { cause: error });
  }
}

function encoded(value: unknown): {
  readonly payload: string;
  readonly hash: string;
} {
  const result = encodeSnapshot(value);
  return { payload: result.payload, hash: result.payloadHash };
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);
}

export function f11ReevaluationAuthorizationToken(
  input: Pick<
    F11ReevaluationTransferInput,
    | "managedPrId"
    | "oldClaimId"
    | "oldHoldId"
    | "oldOperationId"
    | "oldBundleId"
    | "newClaimId"
    | "newHoldId"
    | "newOperationId"
    | "newBundleId"
    | "eventVersionIds"
    | "authorizationId"
    | "expectedOldClaimVersion"
    | "expectedOldHoldVersion"
  >,
): string {
  return `f11-reevaluation-${hash(
    JSON.stringify([
      input.managedPrId,
      input.oldClaimId,
      input.oldHoldId,
      input.oldOperationId,
      input.oldBundleId,
      input.newClaimId,
      input.newHoldId,
      input.newOperationId,
      input.newBundleId,
      [...input.eventVersionIds],
      input.authorizationId,
      input.expectedOldClaimVersion,
      input.expectedOldHoldVersion,
    ]),
  )}`;
}

function reason(
  code: F11Reason["code"],
  what: string,
  why: string,
  nextAction: F11Reason["nextAction"],
  details: Readonly<Record<string, string | number | boolean>> = {},
): F11Reason {
  return { code, what, why, nextAction, details };
}

function repositoryError(
  store: PersistenceStore,
  code: "CONFLICT" | "NOT_FOUND" | "INVALID_RECORD" | "DUPLICATE",
  what: string,
): PersistenceError {
  return new PersistenceError({
    code,
    stage: "health_record",
    what,
    why: "The F11 deterministic eligibility boundary could not commit a safe scoped record.",
    nextAction: code === "CONFLICT" ? "RECONCILE" : "FIX_INPUT",
    correlationId: store.health.correlationId,
    databaseId: store.health.databaseId,
    details: {},
  });
}

function claimFromRow(row: SqlRow): F11AutomaticClaimRecord {
  const outcome = optionalString(row, "outcome");
  return {
    claimId: rowString(row, "claim_id"),
    managedPrId: rowString(row, "managed_pr_id"),
    operationId: rowString(row, "operation_id"),
    bundleId: rowString(row, "bundle_id"),
    state: rowString(row, "state") as F11ClaimState,
    eventVersionIds: json<string[]>(row, "event_version_ids_json"),
    configurationSnapshot: json<F11ConfigurationSnapshot>(
      row,
      "configuration_snapshot_json",
    ),
    correlationId: rowString(row, "correlation_id"),
    ...(outcome === undefined
      ? {}
      : { outcome: outcome as F11AutomaticClaimRecord["outcome"] }),
    version: rowNumber(row, "version"),
    createdAt: rowString(row, "created_at"),
    ...(optionalString(row, "released_at") === undefined
      ? {}
      : { releasedAt: optionalString(row, "released_at") }),
    updatedAt: rowString(row, "updated_at"),
  };
}

function holdFromRow(row: SqlRow): F11HoldRecord {
  const releasedAt = optionalString(row, "released_at");
  const outcome = optionalString(row, "outcome");
  return {
    holdId: rowString(row, "hold_id"),
    managedPrId: rowString(row, "managed_pr_id"),
    claimId: rowString(row, "claim_id"),
    operationId: rowString(row, "operation_id"),
    bundleId: rowString(row, "bundle_id"),
    state: rowString(row, "state") as F11HoldRecord["state"],
    reason: json<F11Reason>(row, "reason_json"),
    acquiredAt: rowString(row, "acquired_at"),
    ...(releasedAt === undefined ? {} : { releasedAt }),
    ...(outcome === undefined
      ? {}
      : { outcome: outcome as F11HoldRecord["outcome"] }),
    version: rowNumber(row, "version"),
    updatedAt: rowString(row, "updated_at"),
  };
}

function associationFromRow(row: SqlRow): F11EventAssociationRecord {
  const bundleId = optionalString(row, "bundle_id");
  const operationId = optionalString(row, "operation_id");
  return {
    eventVersionId: rowString(row, "event_version_id"),
    managedPrId: rowString(row, "managed_pr_id"),
    state: rowString(row, "state") as F11AssociationState,
    ...(bundleId === undefined ? {} : { bundleId }),
    ...(operationId === undefined ? {} : { operationId }),
    version: rowNumber(row, "version"),
    payload: json<unknown>(row, "payload_json"),
    createdAt: rowString(row, "created_at"),
    updatedAt: rowString(row, "updated_at"),
  };
}

function decisionFromRow(row: SqlRow): F11EligibilityDecisionRecord {
  return {
    decisionId: rowString(row, "decision_id"),
    managedPrId: rowString(row, "managed_pr_id"),
    eventVersionId: rowString(row, "event_version_id"),
    decision: rowString(row, "decision") as F11EligibilityDecision,
    reason: json<F11Reason>(row, "reason_json"),
    inputSnapshot: json<unknown>(row, "input_snapshot_json"),
    configurationSnapshot: json<F11ConfigurationSnapshot>(
      row,
      "configuration_snapshot_json",
    ),
    correlationId: rowString(row, "correlation_id"),
    version: rowNumber(row, "version"),
    createdAt: rowString(row, "created_at"),
    updatedAt: rowString(row, "updated_at"),
  };
}

function exactIds(left: readonly string[], right: readonly string[]): boolean {
  const sortedRight = [...right].sort();
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === sortedRight[index])
  );
}

function currentPrimaryState(
  transaction: PersistenceTransaction,
  managedPrId: string,
): F11PrimaryState | undefined {
  const f07 = transaction.get(
    "SELECT primary_state FROM f07_managed_prs WHERE managed_pr_id = ?",
    managedPrId,
  );
  const value =
    f07 === undefined
      ? transaction.get(
          "SELECT state FROM managed_prs WHERE managed_pr_id = ?",
          managedPrId,
        )
      : f07;
  const state =
    value === undefined
      ? undefined
      : rowString(value, f07 === undefined ? "state" : "primary_state");
  return state !== undefined &&
    ["WATCHING", "WORKING", "READY_FOR_REVIEW", "NEEDS_ATTENTION"].includes(
      state,
    )
    ? (state as F11PrimaryState)
    : undefined;
}

function updatePrimaryState(
  transaction: PersistenceTransaction,
  managedPrId: string,
  state: F11PrimaryState,
  updatedAt: string,
): void {
  const managed = transaction.get(
    "SELECT state, version FROM managed_prs WHERE managed_pr_id = ?",
    managedPrId,
  );
  if (managed === undefined) throw new Error("F11_MANAGED_PR_NOT_FOUND");
  transaction.run(
    "UPDATE managed_prs SET state = ?, version = version + 1, updated_at = ? WHERE managed_pr_id = ?",
    state,
    updatedAt,
    managedPrId,
  );
  if (rowString(managed, "state") !== state)
    transaction.run(
      "INSERT OR IGNORE INTO transition_history (transition_id, aggregate_type, aggregate_id, sequence, prior_state, current_state, schema_version, payload_json, created_at) VALUES (?, 'PRIMARY_PR', ?, ?, ?, ?, 1, ?, ?)",
      `f11-primary-${hash(`${managedPrId}:${rowString(managed, "state")}:${state}:${updatedAt}`)}`,
      managedPrId,
      rowNumber(managed, "version"),
      rowString(managed, "state"),
      state,
      JSON.stringify({ source: "F11", state }),
      updatedAt,
    );
  const f07 = transaction.get(
    "SELECT version FROM f07_managed_prs WHERE managed_pr_id = ?",
    managedPrId,
  );
  if (f07 !== undefined)
    transaction.run(
      "UPDATE f07_managed_prs SET primary_state = ?, version = version + 1, updated_at = ? WHERE managed_pr_id = ?",
      state,
      updatedAt,
      managedPrId,
    );
}

function recordAssociationInTransaction(
  transaction: PersistenceTransaction,
  input: {
    readonly eventVersionId: string;
    readonly managedPrId: string;
    readonly nextState: F11AssociationState;
    readonly bundleId?: string;
    readonly operationId?: string;
    readonly reason: F11Reason;
    readonly at: string;
  },
): F11EventAssociationRecord {
  const existing = transaction.get(
    "SELECT * FROM f11_event_associations WHERE event_version_id = ?",
    input.eventVersionId,
  );
  if (existing !== undefined) {
    const current = associationFromRow(existing);
    if (current.managedPrId !== input.managedPrId)
      throw repositoryError(
        {
          health: { correlationId: "f11", databaseId: "f11" },
        } as PersistenceStore,
        "CONFLICT",
        "An immutable event version is scoped to another managed pull request.",
      );
    if (
      current.state === input.nextState &&
      current.bundleId === input.bundleId &&
      current.operationId === input.operationId
    )
      return current;
    const allowed =
      (current.state === "UNASSIGNED" &&
        (input.nextState === "ASSIGNED_TO_ACTIVE_BUNDLE" ||
          input.nextState === "RETAINED_DURING_HOLD")) ||
      (current.state === "RETAINED_DURING_HOLD" &&
        input.nextState === "ASSIGNED_TO_ACTIVE_BUNDLE") ||
      (current.state === "ASSIGNED_TO_ACTIVE_BUNDLE" &&
        (input.nextState === "HANDLED_BY_BUNDLE" ||
          input.nextState === "ASSIGNED_TO_ACTIVE_BUNDLE" ||
          input.nextState === "RETAINED_DURING_HOLD"));
    if (!allowed) throw new Error("F11_INVALID_ASSOCIATION_TRANSITION");
    transaction.run(
      "UPDATE f11_event_associations SET state = ?, bundle_id = ?, operation_id = ?, version = version + 1, payload_json = ?, updated_at = ? WHERE event_version_id = ? AND version = ?",
      input.nextState,
      input.bundleId ?? null,
      input.operationId ?? null,
      encoded(input.reason).payload,
      input.at,
      input.eventVersionId,
      current.version,
    );
    transaction.run(
      "INSERT INTO f11_event_association_history (history_id, event_version_id, managed_pr_id, prior_state, next_state, bundle_id, operation_id, reason_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      `f11-association-${randomUUID()}`,
      input.eventVersionId,
      input.managedPrId,
      current.state,
      input.nextState,
      input.bundleId ?? null,
      input.operationId ?? null,
      encoded(input.reason).payload,
      input.at,
    );
  } else {
    transaction.run(
      "INSERT INTO f11_event_associations (event_version_id, managed_pr_id, state, bundle_id, operation_id, version, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)",
      input.eventVersionId,
      input.managedPrId,
      input.nextState,
      input.bundleId ?? null,
      input.operationId ?? null,
      encoded(input.reason).payload,
      input.at,
      input.at,
    );
    transaction.run(
      "INSERT INTO f11_event_association_history (history_id, event_version_id, managed_pr_id, prior_state, next_state, bundle_id, operation_id, reason_json, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)",
      `f11-association-${randomUUID()}`,
      input.eventVersionId,
      input.managedPrId,
      input.nextState,
      input.bundleId ?? null,
      input.operationId ?? null,
      encoded(input.reason).payload,
      input.at,
    );
  }
  const row = transaction.get(
    "SELECT * FROM f11_event_associations WHERE event_version_id = ?",
    input.eventVersionId,
  );
  if (row === undefined) throw new Error("F11_ASSOCIATION_NOT_READABLE");
  return associationFromRow(row);
}

export class F11PersistenceRepositories {
  private readonly clock: PersistenceClock;
  private readonly transactionOptions: TransactionOptions;

  public constructor(
    private readonly store: PersistenceStore,
    options: {
      readonly clock?: PersistenceClock;
      readonly transactionOptions?: TransactionOptions;
    } = {},
  ) {
    this.clock = options.clock ?? { now: () => new Date().toISOString() };
    this.transactionOptions = options.transactionOptions ?? {};
  }

  private transaction<T>(
    work: (transaction: PersistenceTransaction) => T,
    options: TransactionOptions = {},
  ): T {
    return this.store.transaction(work, {
      ...this.transactionOptions,
      ...options,
      faultInjection:
        options.faultInjection ?? this.transactionOptions.faultInjection,
    });
  }

  public getRemoteEventVersion(
    managedPrId: string,
    eventVersionId: string,
  ): F11StoredRemoteEventVersion | undefined {
    id(managedPrId, "managed PR identifier");
    id(eventVersionId, "event version identifier");
    const row = this.store.read(
      "SELECT * FROM remote_event_versions WHERE managed_pr_id = ? AND event_version_id = ?",
      managedPrId,
      eventVersionId,
    );
    if (row === undefined) return undefined;
    const payloadJson = rowString(row, "payload_json");
    const payloadHash = rowString(row, "payload_hash");
    return {
      eventVersionId,
      managedPrId,
      sourceKind: rowString(row, "source_kind"),
      sourceId: rowString(row, "source_id"),
      observedAt: rowString(row, "observed_at"),
      semanticHash: rowString(row, "semantic_hash"),
      payload: decodeSnapshot(
        {
          schemaVersion: rowNumber(row, "schema_version"),
          payload: payloadJson,
          payloadHash,
        },
        rowNumber(row, "schema_version"),
      ),
    };
  }

  public getDecision(
    managedPrId: string,
    eventVersionId: string,
  ): F11EligibilityDecisionRecord | undefined {
    const row = this.store.read(
      "SELECT * FROM f11_eligibility_decisions WHERE managed_pr_id = ? AND event_version_id = ?",
      managedPrId,
      eventVersionId,
    );
    return row === undefined ? undefined : decisionFromRow(row);
  }

  public listDecisions(
    managedPrId: string,
  ): readonly F11EligibilityDecisionRecord[] {
    id(managedPrId, "managed PR identifier");
    return this.store
      .readAll(
        "SELECT * FROM f11_eligibility_decisions WHERE managed_pr_id = ? ORDER BY created_at, event_version_id",
        managedPrId,
      )
      .map(decisionFromRow);
  }

  public recordDecision(
    result: F11EligibilityResult,
    evaluatedAt = timestamp(this.clock),
  ): F11EligibilityDecisionRecord {
    id(result.managedPrId, "managed PR identifier");
    id(result.eventVersionId, "event version identifier");
    text(result.correlationId, "eligibility correlation identifier");
    const reasonJson = encoded(result.reason);
    const inputJson = encoded(result.inputSnapshot);
    const configurationJson = encoded(result.configurationSnapshot);
    const decisionId = `f11-decision-${hash(`${result.managedPrId}:${result.eventVersionId}`)}`;
    const evaluationId = `f11-evaluation-${hash(`${decisionId}:${result.reason.code}:${inputJson.hash}:${configurationJson.hash}`)}`;
    return this.transaction((transaction) => {
      const event = transaction.get(
        "SELECT managed_pr_id FROM remote_event_versions WHERE event_version_id = ?",
        result.eventVersionId,
      );
      if (
        event === undefined ||
        rowString(event, "managed_pr_id") !== result.managedPrId
      )
        throw repositoryError(
          this.store,
          "NOT_FOUND",
          "The immutable event version is not in the requested PR scope.",
        );
      transaction.run(
        "INSERT OR IGNORE INTO f11_eligibility_decisions (decision_id, managed_pr_id, event_version_id, decision, reason_code, reason_json, input_snapshot_json, configuration_snapshot_json, correlation_id, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
        decisionId,
        result.managedPrId,
        result.eventVersionId,
        result.decision,
        result.reason.code,
        reasonJson.payload,
        inputJson.payload,
        configurationJson.payload,
        result.correlationId,
        evaluatedAt,
        evaluatedAt,
      );
      transaction.run(
        "INSERT OR IGNORE INTO f11_eligibility_history (evaluation_id, decision_id, managed_pr_id, event_version_id, decision, reason_code, reason_json, input_snapshot_json, configuration_snapshot_json, correlation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        evaluationId,
        decisionId,
        result.managedPrId,
        result.eventVersionId,
        result.decision,
        result.reason.code,
        reasonJson.payload,
        inputJson.payload,
        configurationJson.payload,
        result.correlationId,
        evaluatedAt,
      );
      const row = transaction.get(
        "SELECT * FROM f11_eligibility_decisions WHERE decision_id = ?",
        decisionId,
      );
      if (row === undefined) throw new Error("F11_DECISION_NOT_READABLE");
      return decisionFromRow(row);
    });
  }

  public getAssociation(
    managedPrId: string,
    eventVersionId: string,
  ): F11EventAssociationRecord | undefined {
    const row = this.store.read(
      "SELECT * FROM f11_event_associations WHERE managed_pr_id = ? AND event_version_id = ?",
      managedPrId,
      eventVersionId,
    );
    return row === undefined ? undefined : associationFromRow(row);
  }

  public listAssociations(
    managedPrId: string,
    state?: F11AssociationState,
  ): readonly F11EventAssociationRecord[] {
    id(managedPrId, "managed PR identifier");
    if (state !== undefined && !F11_ASSOCIATION_STATES.includes(state))
      throw new Error("F11_INVALID_ASSOCIATION_STATE");
    const rows =
      state === undefined
        ? this.store.readAll(
            "SELECT * FROM f11_event_associations WHERE managed_pr_id = ? ORDER BY created_at, event_version_id",
            managedPrId,
          )
        : this.store.readAll(
            "SELECT * FROM f11_event_associations WHERE managed_pr_id = ? AND state = ? ORDER BY created_at, event_version_id",
            managedPrId,
            state,
          );
    return rows.map(associationFromRow);
  }

  public ensureUnassignedAssociation(
    managedPrId: string,
    eventVersionId: string,
    at = timestamp(this.clock),
  ): F11EventAssociationRecord {
    return this.transaction((transaction) =>
      recordAssociationInTransaction(transaction, {
        managedPrId,
        eventVersionId,
        nextState: "UNASSIGNED",
        reason: reason(
          "ELIGIBLE",
          "The immutable version is available for a future automatic claim.",
          "No automatic operation owns the version yet.",
          "NONE",
        ),
        at,
      }),
    );
  }

  public retainDuringHold(input: {
    readonly managedPrId: string;
    readonly eventVersionId: string;
    readonly bundleId: string;
    readonly operationId: string;
    readonly reason: F11Reason;
    readonly retainedAt?: string;
  }): F11EventAssociationRecord {
    for (const [value, label] of [
      [input.managedPrId, "managed PR identifier"],
      [input.eventVersionId, "event version identifier"],
      [input.bundleId, "bundle identifier"],
      [input.operationId, "operation identifier"],
    ] as const)
      id(value, label);
    return this.transaction((transaction) =>
      recordAssociationInTransaction(transaction, {
        eventVersionId: input.eventVersionId,
        managedPrId: input.managedPrId,
        nextState: "RETAINED_DURING_HOLD",
        bundleId: input.bundleId,
        operationId: input.operationId,
        reason: input.reason,
        at: input.retainedAt ?? timestamp(this.clock),
      }),
    );
  }

  public getActiveClaim(
    managedPrId: string,
  ): F11AutomaticClaimRecord | undefined {
    const row = this.store.read(
      "SELECT * FROM f11_automatic_claims WHERE managed_pr_id = ? AND state = 'ACTIVE'",
      managedPrId,
    );
    return row === undefined ? undefined : claimFromRow(row);
  }

  public getClaim(claimId: string): F11AutomaticClaimRecord | undefined {
    id(claimId, "automatic claim identifier");
    const row = this.store.read(
      "SELECT * FROM f11_automatic_claims WHERE claim_id = ?",
      claimId,
    );
    return row === undefined ? undefined : claimFromRow(row);
  }

  public getActiveHold(managedPrId: string): F11HoldRecord | undefined {
    const row = this.store.read(
      "SELECT * FROM f11_holds WHERE managed_pr_id = ? AND state = 'ACTIVE'",
      managedPrId,
    );
    return row === undefined ? undefined : holdFromRow(row);
  }

  public getHold(holdId: string): F11HoldRecord | undefined {
    id(holdId, "automatic hold identifier");
    const row = this.store.read(
      "SELECT * FROM f11_holds WHERE hold_id = ?",
      holdId,
    );
    return row === undefined ? undefined : holdFromRow(row);
  }

  public listEligibleVersionIds(managedPrId: string): readonly string[] {
    id(managedPrId, "managed PR identifier");
    return this.store
      .readAll(
        "SELECT d.event_version_id FROM f11_eligibility_decisions d LEFT JOIN f11_event_associations a ON a.event_version_id = d.event_version_id AND a.managed_pr_id = d.managed_pr_id WHERE d.managed_pr_id = ? AND d.decision = 'ELIGIBLE' AND (a.state IS NULL OR a.state = 'UNASSIGNED') ORDER BY d.created_at, d.event_version_id",
        managedPrId,
      )
      .map((row) => rowString(row, "event_version_id"));
  }

  public listRetainedVersionIds(managedPrId: string): readonly string[] {
    id(managedPrId, "managed PR identifier");
    return this.store
      .readAll(
        "SELECT event_version_id FROM f11_event_associations WHERE managed_pr_id = ? AND state = 'RETAINED_DURING_HOLD' ORDER BY created_at, event_version_id",
        managedPrId,
      )
      .map((row) => rowString(row, "event_version_id"));
  }

  public claimAutomatic(input: F11ClaimInput): F11ClaimResult {
    for (const [value, label] of [
      [input.claimId, "claim identifier"],
      [input.holdId, "hold identifier"],
      [input.managedPrId, "managed PR identifier"],
      [input.operationId, "operation identifier"],
      [input.bundleId, "bundle identifier"],
      [input.correlationId, "correlation identifier"],
    ] as const)
      id(value, label);
    if (input.signal?.aborted)
      return {
        outcome: "CONFLICT",
        reason: reason(
          "CONCURRENT_CLAIM",
          "The automatic claim was cancelled before it could commit.",
          "No claim or hold is created until the transaction commits.",
          "RETRY",
        ),
      };
    if (input.eventVersionIds.length === 0)
      return {
        outcome: "EMPTY",
        reason: reason(
          "NO_ELIGIBLE_EVENTS",
          "No eligible feedback versions are available.",
          "An empty claim must not create an operation or review hold.",
          "NONE",
        ),
      };
    const claimedAt = input.claimedAt ?? timestamp(this.clock);
    const eventIds = [...new Set(input.eventVersionIds)];
    if (eventIds.length !== input.eventVersionIds.length)
      return {
        outcome: "CONFLICT",
        reason: reason(
          "CONCURRENT_CLAIM",
          "The claim contains duplicate immutable versions.",
          "A version can belong to a claim only once.",
          "RETRY",
        ),
      };
    if (eventIds.length > F11_MAX_CLAIM_EVENTS)
      return {
        outcome: "CONFLICT",
        reason: reason(
          "INVALID_SCOPE",
          "The automatic claim exceeds the bounded event-version limit.",
          "Claims must remain bounded so a scheduler retry cannot create unbounded work.",
          "FIX_INPUT",
        ),
      };
    try {
      return this.transaction(
        (transaction) => {
          const managed = transaction.get(
            "SELECT managed_pr_id FROM managed_prs WHERE managed_pr_id = ?",
            input.managedPrId,
          );
          if (managed === undefined)
            throw repositoryError(
              this.store,
              "NOT_FOUND",
              "The managed pull request does not exist.",
            );
          const existing = transaction.get(
            "SELECT * FROM f11_automatic_claims WHERE managed_pr_id = ? AND state = 'ACTIVE'",
            input.managedPrId,
          );
          if (existing !== undefined) {
            const active = claimFromRow(existing);
            if (
              active.operationId === input.operationId &&
              active.bundleId === input.bundleId &&
              exactIds(active.eventVersionIds, eventIds)
            ) {
              const held = transaction.get(
                "SELECT * FROM f11_holds WHERE managed_pr_id = ? AND state = 'ACTIVE'",
                input.managedPrId,
              );
              return {
                outcome: "REPLAYED" as const,
                claim: active,
                ...(held === undefined ? {} : { hold: holdFromRow(held) }),
                reason: reason(
                  "AUTOMATIC_OPERATION_ACTIVE",
                  "The requested automatic claim is already committed.",
                  "Retrying the same claim returns the durable owner without creating a second operation.",
                  "NONE",
                ),
              };
            }
            return {
              outcome: "CONFLICT" as const,
              claim: active,
              reason: reason(
                "AUTOMATIC_OPERATION_ACTIVE",
                "Another automatic operation already owns this pull request.",
                "Only one automatic operation and hold may own a managed pull request at a time.",
                "RETRY",
                { operationId: active.operationId, bundleId: active.bundleId },
              ),
            };
          }
          const primaryState = currentPrimaryState(
            transaction,
            input.managedPrId,
          );
          if (
            input.currentPrState !== "OPEN" ||
            primaryState !== "WATCHING" ||
            input.primaryState !== "WATCHING"
          )
            return {
              outcome: "CONFLICT" as const,
              reason: reason(
                "AUTOMATIC_OPERATION_ACTIVE",
                "This pull request is not available for a new automatic operation.",
                "Claims require an open pull request in WATCHING with no active hold.",
                "REVIEW",
              ),
            };
          for (const eventVersionId of eventIds) {
            const event = transaction.get(
              "SELECT managed_pr_id FROM remote_event_versions WHERE event_version_id = ?",
              eventVersionId,
            );
            if (
              event === undefined ||
              rowString(event, "managed_pr_id") !== input.managedPrId
            )
              return {
                outcome: "NOT_ELIGIBLE" as const,
                reason: reason(
                  "INVALID_SCOPE",
                  "A claim contains an event version from another scope.",
                  "Claims are scoped by managed pull request and cannot use a remote ID alone.",
                  "FIX_INPUT",
                ),
              };
            const decision = transaction.get(
              "SELECT decision FROM f11_eligibility_decisions WHERE managed_pr_id = ? AND event_version_id = ?",
              input.managedPrId,
              eventVersionId,
            );
            const association = transaction.get(
              "SELECT * FROM f11_event_associations WHERE managed_pr_id = ? AND event_version_id = ?",
              input.managedPrId,
              eventVersionId,
            );
            const associationState =
              association === undefined
                ? "UNASSIGNED"
                : rowString(association, "state");
            const retained = associationState === "RETAINED_DURING_HOLD";
            const acceptable =
              (decision !== undefined &&
                rowString(decision, "decision") === "ELIGIBLE" &&
                associationState === "UNASSIGNED") ||
              (retained && input.humanAuthorized === true);
            if (!acceptable)
              return {
                outcome: "NOT_ELIGIBLE" as const,
                reason: reason(
                  retained
                    ? "EXPLICIT_REEVALUATION_REQUIRED"
                    : "ALREADY_HANDLED",
                  retained
                    ? "This retained version requires explicit human re-evaluation."
                    : "This immutable version is not available for a new automatic claim.",
                  retained
                    ? "Ordinary polling cannot authorize a retained version after a hold."
                    : "Only an eligible, unassigned immutable version can be claimed.",
                  retained ? "RE_EVALUATE" : "NONE",
                ),
              };
          }
          const configuration = encoded(input.configurationSnapshot);
          const eventIdsJson = JSON.stringify(eventIds);
          transaction.run(
            "INSERT INTO f11_automatic_claims (claim_id, managed_pr_id, operation_id, bundle_id, state, event_version_ids_json, configuration_snapshot_json, correlation_id, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, 1, ?, ?)",
            input.claimId,
            input.managedPrId,
            input.operationId,
            input.bundleId,
            eventIdsJson,
            configuration.payload,
            input.correlationId,
            claimedAt,
            claimedAt,
          );
          const holdReason = reason(
            "AUTOMATIC_OPERATION_ACTIVE",
            "Automatic review work owns this pull request.",
            "The durable hold prevents competing automatic work and protects the claimed version set.",
            "REVIEW",
            { operationId: input.operationId, bundleId: input.bundleId },
          );
          transaction.run(
            "INSERT INTO f11_holds (hold_id, managed_pr_id, claim_id, operation_id, bundle_id, state, reason_json, acquired_at, version, updated_at) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, 1, ?)",
            input.holdId,
            input.managedPrId,
            input.claimId,
            input.operationId,
            input.bundleId,
            encoded(holdReason).payload,
            claimedAt,
            claimedAt,
          );
          for (const eventVersionId of eventIds)
            recordAssociationInTransaction(transaction, {
              eventVersionId,
              managedPrId: input.managedPrId,
              nextState: "ASSIGNED_TO_ACTIVE_BUNDLE",
              bundleId: input.bundleId,
              operationId: input.operationId,
              reason: holdReason,
              at: claimedAt,
            });
          updatePrimaryState(
            transaction,
            input.managedPrId,
            "WORKING",
            claimedAt,
          );
          const claimRow = transaction.get(
            "SELECT * FROM f11_automatic_claims WHERE claim_id = ?",
            input.claimId,
          );
          const holdRow = transaction.get(
            "SELECT * FROM f11_holds WHERE hold_id = ?",
            input.holdId,
          );
          if (claimRow === undefined || holdRow === undefined)
            throw new Error("F11_CLAIM_NOT_READABLE");
          return {
            outcome: "CLAIMED" as const,
            claim: claimFromRow(claimRow),
            hold: holdFromRow(holdRow),
            reason: holdReason,
          };
        },
        { signal: input.signal },
      );
    } catch (error) {
      if (
        error instanceof PersistenceError &&
        error.reason.code === "DUPLICATE"
      )
        return {
          outcome: "CONFLICT",
          reason: reason(
            "CONCURRENT_CLAIM",
            "Another transaction committed the automatic claim first.",
            "The losing request must read the durable winner before retrying.",
            "RETRY",
          ),
        };
      throw error;
    }
  }

  /**
   * Transfers a live automatic hold to a new, explicitly authorized
   * re-evaluation identity without marking immutable feedback handled.
   * Ordinary claimAutomatic cannot perform this operation because the old
   * hold intentionally keeps the PR in WORKING state.
   */
  public transferForReevaluation(
    input: F11ReevaluationTransferInput,
  ): F11ReevaluationTransferResult {
    for (const [value, label] of [
      [input.managedPrId, "managed PR identifier"],
      [input.oldClaimId, "old claim identifier"],
      [input.oldHoldId, "old hold identifier"],
      [input.oldOperationId, "old operation identifier"],
      [input.oldBundleId, "old bundle identifier"],
      [input.newClaimId, "new claim identifier"],
      [input.newHoldId, "new hold identifier"],
      [input.newOperationId, "new operation identifier"],
      [input.newBundleId, "new bundle identifier"],
      [input.correlationId, "correlation identifier"],
      [input.authorizationId, "reevaluation authorization identifier"],
      [input.authorizationToken, "reevaluation authorization token"],
    ] as const)
      id(value, label);
    if (
      !Number.isSafeInteger(input.expectedOldClaimVersion) ||
      input.expectedOldClaimVersion < 0 ||
      !Number.isSafeInteger(input.expectedOldHoldVersion) ||
      input.expectedOldHoldVersion < 0
    )
      return {
        outcome: "CONFLICT",
        reason: reason(
          "EXPLICIT_REEVALUATION_AUTHORIZATION_INVALID",
          "The re-evaluation authorization versions are invalid.",
          "F11 binds a transfer to the exact durable claim and hold versions that the human authorized.",
          "RECONCILE",
        ),
      };
    const eventIds = [...new Set(input.eventVersionIds)];
    if (
      eventIds.length === 0 ||
      eventIds.length !== input.eventVersionIds.length ||
      eventIds.length > F11_MAX_CLAIM_EVENTS
    )
      return {
        outcome: "CONFLICT",
        reason: reason(
          "INVALID_SCOPE",
          "The re-evaluation event set is empty, duplicated, or too large.",
          "A transferred hold must retain a bounded exact immutable-version set.",
          "FIX_INPUT",
        ),
      };
    const transferredAt = input.transferredAt ?? timestamp(this.clock);
    if (
      input.authorizationToken !==
      f11ReevaluationAuthorizationToken({
        managedPrId: input.managedPrId,
        oldClaimId: input.oldClaimId,
        oldHoldId: input.oldHoldId,
        oldOperationId: input.oldOperationId,
        oldBundleId: input.oldBundleId,
        newClaimId: input.newClaimId,
        newHoldId: input.newHoldId,
        newOperationId: input.newOperationId,
        newBundleId: input.newBundleId,
        eventVersionIds: input.eventVersionIds,
        authorizationId: input.authorizationId,
        expectedOldClaimVersion: input.expectedOldClaimVersion,
        expectedOldHoldVersion: input.expectedOldHoldVersion,
      })
    )
      return {
        outcome: "CONFLICT",
        reason: reason(
          "EXPLICIT_REEVALUATION_AUTHORIZATION_INVALID",
          "The re-evaluation authorization token does not match the exact F11 transfer request.",
          "F11 requires a server-verified binding between the human authorization, old owner, new owner, and immutable event set.",
          "RECONCILE",
        ),
      };
    return this.transaction(
      (transaction) => {
        const existingNewClaimRow = transaction.get(
          "SELECT * FROM f11_automatic_claims WHERE claim_id = ?",
          input.newClaimId,
        );
        const existingNewHoldRow = transaction.get(
          "SELECT * FROM f11_holds WHERE hold_id = ?",
          input.newHoldId,
        );
        if (
          existingNewClaimRow !== undefined &&
          existingNewHoldRow !== undefined &&
          rowString(existingNewClaimRow, "state") === "ACTIVE" &&
          rowString(existingNewHoldRow, "state") === "ACTIVE"
        )
          return {
            outcome: "REPLAYED" as const,
            claim: claimFromRow(existingNewClaimRow),
            hold: holdFromRow(existingNewHoldRow),
            reason: reason(
              "AUTOMATIC_OPERATION_ACTIVE",
              "The re-evaluation hold transfer is already committed.",
              "Retrying the same F22 action returns the durable new owner without duplicating a claim.",
              "NONE",
            ),
          };
        const oldClaimRow = transaction.get(
          "SELECT * FROM f11_automatic_claims WHERE claim_id = ? AND managed_pr_id = ?",
          input.oldClaimId,
          input.managedPrId,
        );
        const oldHoldRow = transaction.get(
          "SELECT * FROM f11_holds WHERE hold_id = ? AND managed_pr_id = ?",
          input.oldHoldId,
          input.managedPrId,
        );
        if (oldClaimRow === undefined || oldHoldRow === undefined)
          return {
            outcome: "CONFLICT" as const,
            reason: reason(
              "CLAIM_NOT_FOUND",
              "The original F11 claim or hold is missing.",
              "Re-evaluation cannot create a competing owner without the exact durable source hold.",
              "RECONCILE",
            ),
          };
        const oldClaim = claimFromRow(oldClaimRow);
        const oldHold = holdFromRow(oldHoldRow);
        if (
          oldClaim.version !== input.expectedOldClaimVersion ||
          oldHold.version !== input.expectedOldHoldVersion
        )
          return {
            outcome: "CONFLICT" as const,
            claim: oldClaim,
            hold: oldHold,
            reason: reason(
              "EXPLICIT_REEVALUATION_AUTHORIZATION_STALE",
              "The F11 claim or hold changed after the re-evaluation authorization was issued.",
              "F11 will not transfer a durable owner from a stale renderer snapshot.",
              "RECONCILE",
            ),
          };
        if (
          oldClaim.state !== "ACTIVE" ||
          oldClaim.operationId !== input.oldOperationId ||
          oldClaim.bundleId !== input.oldBundleId ||
          oldHold.state !== "ACTIVE" ||
          oldHold.claimId !== input.oldClaimId ||
          oldHold.operationId !== input.oldOperationId ||
          oldHold.bundleId !== input.oldBundleId
        )
          return {
            outcome: "CONFLICT" as const,
            claim: oldClaim,
            hold: oldHold,
            reason: reason(
              "CLAIM_OWNER_MISMATCH",
              "The original F11 owner no longer matches the re-evaluation request.",
              "F22 rejects stale or competing renderer actions instead of transferring another operation's hold.",
              "RECONCILE",
            ),
          };
        const transferReason = reason(
          "EXPLICIT_REEVALUATION_REQUIRED",
          "An explicit human re-evaluation transferred the held immutable versions.",
          "The old bundle remains inspectable while the new operation owns the transferred versions and active hold.",
          "RE_EVALUATE",
          { oldBundleId: input.oldBundleId, newBundleId: input.newBundleId },
        );
        for (const eventVersionId of eventIds) {
          const event = transaction.get(
            "SELECT managed_pr_id FROM remote_event_versions WHERE event_version_id = ?",
            eventVersionId,
          );
          if (
            event === undefined ||
            rowString(event, "managed_pr_id") !== input.managedPrId
          )
            return {
              outcome: "CONFLICT" as const,
              claim: oldClaim,
              hold: oldHold,
              reason: reason(
                "INVALID_SCOPE",
                "A re-evaluation event version belongs to another managed pull request.",
                "F11 scopes immutable versions by managed PR, not by an untrusted remote identifier.",
                "FIX_INPUT",
              ),
            };
          const associationRow = transaction.get(
            "SELECT * FROM f11_event_associations WHERE managed_pr_id = ? AND event_version_id = ?",
            input.managedPrId,
            eventVersionId,
          );
          if (associationRow === undefined)
            return {
              outcome: "CONFLICT" as const,
              claim: oldClaim,
              hold: oldHold,
              reason: reason(
                "INVALID_SCOPE",
                "A re-evaluation event version has no durable association.",
                "F22 cannot infer ownership for an immutable version that is absent from the F11 association ledger.",
                "RECONCILE",
              ),
            };
          const association = associationFromRow(associationRow);
          if (
            association.state !== "ASSIGNED_TO_ACTIVE_BUNDLE" &&
            association.state !== "RETAINED_DURING_HOLD"
          )
            return {
              outcome: "CONFLICT" as const,
              claim: oldClaim,
              hold: oldHold,
              reason: reason(
                "ALREADY_HANDLED",
                "A selected immutable version is no longer transferable.",
                "Handled versions are permanent and cannot be automatically replayed by re-evaluation.",
                "REVIEW",
              ),
            };
          if (
            association.state === "ASSIGNED_TO_ACTIVE_BUNDLE" &&
            (association.bundleId !== input.oldBundleId ||
              association.operationId !== input.oldOperationId)
          )
            return {
              outcome: "CONFLICT" as const,
              claim: oldClaim,
              hold: oldHold,
              reason: reason(
                "CLAIM_OWNER_MISMATCH",
                "A selected immutable version is owned by another active bundle.",
                "F11 will not transfer a competing association through a stale F22 action.",
                "RECONCILE",
              ),
            };
          if (
            association.state === "RETAINED_DURING_HOLD" &&
            (association.bundleId !== input.oldBundleId ||
              association.operationId !== input.oldOperationId)
          )
            return {
              outcome: "CONFLICT" as const,
              claim: oldClaim,
              hold: oldHold,
              reason: reason(
                "CLAIM_OWNER_MISMATCH",
                "A selected retained version belongs to another hold.",
                "F11 will not transfer a retained association through a competing F22 action.",
                "RECONCILE",
              ),
            };
          recordAssociationInTransaction(transaction, {
            eventVersionId,
            managedPrId: input.managedPrId,
            nextState: "ASSIGNED_TO_ACTIVE_BUNDLE",
            bundleId: input.newBundleId,
            operationId: input.newOperationId,
            reason: transferReason,
            at: transferredAt,
          });
        }
        transaction.run(
          "UPDATE f11_automatic_claims SET state = 'RELEASED', released_at = ?, version = version + 1, updated_at = ? WHERE claim_id = ? AND state = 'ACTIVE'",
          transferredAt,
          transferredAt,
          input.oldClaimId,
        );
        transaction.run(
          "UPDATE f11_holds SET state = 'RELEASED', released_at = ?, version = version + 1, updated_at = ? WHERE hold_id = ? AND state = 'ACTIVE'",
          transferredAt,
          transferredAt,
          input.oldHoldId,
        );
        transaction.run(
          "INSERT INTO f11_automatic_claims (claim_id, managed_pr_id, operation_id, bundle_id, state, event_version_ids_json, configuration_snapshot_json, correlation_id, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, 1, ?, ?)",
          input.newClaimId,
          input.managedPrId,
          input.newOperationId,
          input.newBundleId,
          encoded(eventIds).payload,
          encoded(input.configurationSnapshot).payload,
          input.correlationId,
          transferredAt,
          transferredAt,
        );
        transaction.run(
          "INSERT INTO f11_holds (hold_id, managed_pr_id, claim_id, operation_id, bundle_id, state, reason_json, acquired_at, version, updated_at) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, 1, ?)",
          input.newHoldId,
          input.managedPrId,
          input.newClaimId,
          input.newOperationId,
          input.newBundleId,
          encoded(transferReason).payload,
          transferredAt,
          transferredAt,
        );
        const newClaimRow = transaction.get(
          "SELECT * FROM f11_automatic_claims WHERE claim_id = ?",
          input.newClaimId,
        );
        const newHoldRow = transaction.get(
          "SELECT * FROM f11_holds WHERE hold_id = ?",
          input.newHoldId,
        );
        if (newClaimRow === undefined || newHoldRow === undefined)
          throw new Error("F11_REEVALUATION_TRANSFER_NOT_READABLE");
        return {
          outcome: "TRANSFERRED" as const,
          claim: claimFromRow(newClaimRow),
          hold: holdFromRow(newHoldRow),
          reason: transferReason,
        };
      },
      { signal: undefined },
    );
  }

  /**
   * Compensates a transfer when F18 rejects before it can persist the new
   * bundle.  The operation is exact and idempotent: it can only restore the
   * named old owner and the original/retained association states.
   */
  public rollbackForReevaluation(
    input: F11ReevaluationRollbackInput,
  ): F11ReevaluationRollbackResult {
    for (const [value, label] of [
      [input.managedPrId, "managed PR identifier"],
      [input.oldClaimId, "old claim identifier"],
      [input.oldHoldId, "old hold identifier"],
      [input.oldOperationId, "old operation identifier"],
      [input.oldBundleId, "old bundle identifier"],
      [input.newClaimId, "new claim identifier"],
      [input.newHoldId, "new hold identifier"],
      [input.newOperationId, "new operation identifier"],
      [input.newBundleId, "new bundle identifier"],
    ] as const)
      id(value, label);
    const originalEventIds = [...new Set(input.originalEventVersionIds)];
    const retainedEventIds = [...new Set(input.retainedEventVersionIds)];
    const eventIds = [...originalEventIds, ...retainedEventIds];
    if (
      eventIds.length === 0 ||
      eventIds.length !==
        input.originalEventVersionIds.length +
          input.retainedEventVersionIds.length ||
      eventIds.length > F11_MAX_CLAIM_EVENTS
    )
      return {
        outcome: "CONFLICT",
        reason: reason(
          "INVALID_SCOPE",
          "The re-evaluation rollback event set is empty, duplicated, or too large.",
          "F11 restores only the exact immutable versions named by the durable F22 action.",
          "RECONCILE",
        ),
      };
    const original = new Set(originalEventIds);
    const rolledBackAt = input.rolledBackAt ?? timestamp(this.clock);
    return this.transaction((transaction) => {
      const oldClaimRow = transaction.get(
        "SELECT * FROM f11_automatic_claims WHERE claim_id = ? AND managed_pr_id = ?",
        input.oldClaimId,
        input.managedPrId,
      );
      const oldHoldRow = transaction.get(
        "SELECT * FROM f11_holds WHERE hold_id = ? AND managed_pr_id = ?",
        input.oldHoldId,
        input.managedPrId,
      );
      const newClaimRow = transaction.get(
        "SELECT * FROM f11_automatic_claims WHERE claim_id = ? AND managed_pr_id = ?",
        input.newClaimId,
        input.managedPrId,
      );
      const newHoldRow = transaction.get(
        "SELECT * FROM f11_holds WHERE hold_id = ? AND managed_pr_id = ?",
        input.newHoldId,
        input.managedPrId,
      );
      if (
        oldClaimRow === undefined ||
        oldHoldRow === undefined ||
        newClaimRow === undefined ||
        newHoldRow === undefined
      )
        return {
          outcome: "CONFLICT" as const,
          reason: reason(
            "CLAIM_NOT_FOUND",
            "The exact F11 owners required for rollback are not readable.",
            "F11 will not guess whether a re-evaluation transfer committed before F18 refused it.",
            "RECONCILE",
          ),
        };
      const oldClaim = claimFromRow(oldClaimRow);
      const oldHold = holdFromRow(oldHoldRow);
      const newClaim = claimFromRow(newClaimRow);
      const newHold = holdFromRow(newHoldRow);
      if (
        oldClaim.managedPrId !== input.managedPrId ||
        oldClaim.operationId !== input.oldOperationId ||
        oldClaim.bundleId !== input.oldBundleId ||
        oldHold.claimId !== input.oldClaimId ||
        oldHold.operationId !== input.oldOperationId ||
        oldHold.bundleId !== input.oldBundleId ||
        newClaim.operationId !== input.newOperationId ||
        newClaim.bundleId !== input.newBundleId ||
        newHold.claimId !== input.newClaimId ||
        newHold.operationId !== input.newOperationId ||
        newHold.bundleId !== input.newBundleId
      )
        return {
          outcome: "CONFLICT" as const,
          claim: oldClaim,
          hold: oldHold,
          reason: reason(
            "CLAIM_OWNER_MISMATCH",
            "The F11 owners do not match the exact re-evaluation rollback.",
            "A stale or competing action cannot restore another operation's hold.",
            "RECONCILE",
          ),
        };
      if (
        oldClaim.state === "ACTIVE" &&
        oldHold.state === "ACTIVE" &&
        newClaim.state === "RELEASED" &&
        newHold.state === "RELEASED"
      )
        return {
          outcome: "REPLAYED" as const,
          claim: oldClaim,
          hold: oldHold,
          reason: reason(
            "REEVALUATION_ROLLBACK_REPLAYED",
            "The F11 re-evaluation transfer was already rolled back.",
            "Retrying the same compensation returns the restored old owner without another transition.",
            "NONE",
          ),
        };
      if (
        oldClaim.state !== "RELEASED" ||
        oldHold.state !== "RELEASED" ||
        newClaim.state !== "ACTIVE" ||
        newHold.state !== "ACTIVE"
      )
        return {
          outcome: "CONFLICT" as const,
          claim: oldClaim,
          hold: oldHold,
          reason: reason(
            "CLAIM_STATE_CONFLICT",
            "The F11 transfer is not in a compensatable state.",
            "F11 refuses to restore ownership after an unrelated terminal transition.",
            "RECONCILE",
          ),
        };
      for (const eventVersionId of eventIds) {
        const associationRow = transaction.get(
          "SELECT * FROM f11_event_associations WHERE managed_pr_id = ? AND event_version_id = ?",
          input.managedPrId,
          eventVersionId,
        );
        if (associationRow === undefined)
          return {
            outcome: "CONFLICT" as const,
            claim: oldClaim,
            hold: oldHold,
            reason: reason(
              "INVALID_SCOPE",
              "An immutable event association needed for rollback is missing.",
              "F11 preserves exact association history instead of inferring a prior owner.",
              "RECONCILE",
            ),
          };
        const association = associationFromRow(associationRow);
        const desiredState = original.has(eventVersionId)
          ? "ASSIGNED_TO_ACTIVE_BUNDLE"
          : "RETAINED_DURING_HOLD";
        const alreadyRestored =
          association.state === desiredState &&
          association.bundleId === input.oldBundleId &&
          association.operationId === input.oldOperationId;
        if (alreadyRestored) continue;
        if (
          association.state !== "ASSIGNED_TO_ACTIVE_BUNDLE" ||
          association.bundleId !== input.newBundleId ||
          association.operationId !== input.newOperationId
        )
          return {
            outcome: "CONFLICT" as const,
            claim: oldClaim,
            hold: oldHold,
            reason: reason(
              "CLAIM_OWNER_MISMATCH",
              "An immutable event association is owned by another operation.",
              "F11 will not move a competing association during compensation.",
              "RECONCILE",
            ),
          };
        recordAssociationInTransaction(transaction, {
          eventVersionId,
          managedPrId: input.managedPrId,
          nextState: desiredState,
          bundleId: input.oldBundleId,
          operationId: input.oldOperationId,
          reason: reason(
            "REEVALUATION_ROLLBACK",
            "The explicitly requested re-evaluation was not admitted by F18.",
            "F11 restored the old held owner and immutable association states.",
            "RECONCILE",
          ),
          at: rolledBackAt,
        });
      }
      transaction.run(
        "UPDATE f11_automatic_claims SET state = 'RELEASED', released_at = ?, version = version + 1, updated_at = ? WHERE claim_id = ? AND state = 'ACTIVE'",
        rolledBackAt,
        rolledBackAt,
        input.newClaimId,
      );
      transaction.run(
        "UPDATE f11_holds SET state = 'RELEASED', released_at = ?, version = version + 1, updated_at = ? WHERE hold_id = ? AND state = 'ACTIVE'",
        rolledBackAt,
        rolledBackAt,
        input.newHoldId,
      );
      transaction.run(
        "UPDATE f11_automatic_claims SET state = 'ACTIVE', released_at = NULL, outcome = NULL, version = version + 1, updated_at = ? WHERE claim_id = ? AND state = 'RELEASED'",
        rolledBackAt,
        input.oldClaimId,
      );
      transaction.run(
        "UPDATE f11_holds SET state = 'ACTIVE', released_at = NULL, outcome = NULL, version = version + 1, updated_at = ? WHERE hold_id = ? AND state = 'RELEASED'",
        rolledBackAt,
        input.oldHoldId,
      );
      const restoredClaimRow = transaction.get(
        "SELECT * FROM f11_automatic_claims WHERE claim_id = ?",
        input.oldClaimId,
      );
      const restoredHoldRow = transaction.get(
        "SELECT * FROM f11_holds WHERE hold_id = ?",
        input.oldHoldId,
      );
      if (restoredClaimRow === undefined || restoredHoldRow === undefined)
        throw new Error("F11_REEVALUATION_ROLLBACK_NOT_READABLE");
      return {
        outcome: "ROLLED_BACK" as const,
        claim: claimFromRow(restoredClaimRow),
        hold: holdFromRow(restoredHoldRow),
        reason: reason(
          "REEVALUATION_ROLLBACK",
          "The explicit re-evaluation was refused before F18 admitted a new bundle.",
          "F11 restored the original active hold and immutable event ownership.",
          "RECONCILE",
        ),
      };
    });
  }

  public completeClaim(input: F11CompletionInput): F11CompletionResult {
    for (const [value, label] of [
      [input.managedPrId, "managed PR identifier"],
      [input.claimId, "claim identifier"],
      [input.operationId, "operation identifier"],
      [input.bundleId, "bundle identifier"],
    ] as const)
      id(value, label);
    const completedAt = input.completedAt ?? timestamp(this.clock);
    if (input.actor !== "HUMAN" || !input.worktreeHandled)
      return {
        outcome: "CONFLICT",
        reason: reason(
          "HOLD_RELEASE_REQUIRES_HUMAN",
          "The review hold cannot be released yet.",
          "Release requires an explicit human outcome and a handled operation worktree.",
          "REVIEW",
        ),
      };
    return this.transaction(
      (transaction) => {
        const claimRow = transaction.get(
          "SELECT * FROM f11_automatic_claims WHERE claim_id = ? AND managed_pr_id = ?",
          input.claimId,
          input.managedPrId,
        );
        if (claimRow === undefined)
          return {
            outcome: "CONFLICT" as const,
            reason: reason(
              "CLAIM_NOT_FOUND",
              "The automatic claim no longer exists.",
              "The committed claim is required to release its hold.",
              "RECONCILE",
            ),
          };
        const claim = claimFromRow(claimRow);
        if (
          claim.operationId !== input.operationId ||
          claim.bundleId !== input.bundleId
        )
          return {
            outcome: "CONFLICT" as const,
            claim,
            reason: reason(
              "CLAIM_OWNER_MISMATCH",
              "The completion does not own this automatic claim.",
              "A different operation cannot release or complete another operation's hold.",
              "REVIEW",
            ),
          };
        if (claim.state === "HANDLED")
          return {
            outcome: "REPLAYED" as const,
            claim,
            reason: reason(
              "EVENT_VERSION_ALREADY_HANDLED",
              "This automatic claim was already completed.",
              "Repeating the same outcome preserves the handled history without another release.",
              "NONE",
            ),
          };
        const holdRow = transaction.get(
          "SELECT * FROM f11_holds WHERE claim_id = ? AND state = 'ACTIVE'",
          input.claimId,
        );
        if (holdRow === undefined)
          return {
            outcome: "CONFLICT" as const,
            claim,
            reason: reason(
              "CLAIM_OWNER_MISMATCH",
              "The automatic hold is not active for this claim.",
              "A missing hold requires reconciliation instead of silently releasing another owner.",
              "RECONCILE",
            ),
          };
        for (const eventVersionId of claim.eventVersionIds) {
          const associationRow = transaction.get(
            "SELECT * FROM f11_event_associations WHERE managed_pr_id = ? AND event_version_id = ?",
            input.managedPrId,
            eventVersionId,
          );
          if (associationRow === undefined)
            throw repositoryError(
              this.store,
              "NOT_FOUND",
              "A claimed event association is missing.",
            );
          const association = associationFromRow(associationRow);
          if (
            association.state !== "ASSIGNED_TO_ACTIVE_BUNDLE" ||
            association.bundleId !== input.bundleId ||
            association.operationId !== input.operationId
          )
            return {
              outcome: "CONFLICT" as const,
              claim,
              hold: holdFromRow(holdRow),
              reason: reason(
                "CLAIM_OWNER_MISMATCH",
                "A claimed immutable version is owned by another association.",
                "The active bundle must be inspected before a hold can be released.",
                "RECONCILE",
              ),
            };
          recordAssociationInTransaction(transaction, {
            eventVersionId,
            managedPrId: input.managedPrId,
            nextState: "HANDLED_BY_BUNDLE",
            bundleId: input.bundleId,
            operationId: input.operationId,
            reason: reason(
              "EVENT_VERSION_ALREADY_HANDLED",
              "The immutable feedback version is permanently associated with its bundle outcome.",
              "Publishing, publishing with errors, or discarding does not re-admit the exact version automatically.",
              "NONE",
              { outcome: input.outcome },
            ),
            at: completedAt,
          });
          const reviewBundle = transaction.get(
            "SELECT bundle_id, managed_pr_id FROM review_bundles WHERE bundle_id = ?",
            input.bundleId,
          );
          if (
            reviewBundle !== undefined &&
            rowString(reviewBundle, "managed_pr_id") !== input.managedPrId
          )
            return {
              outcome: "CONFLICT" as const,
              claim,
              hold: holdFromRow(holdRow),
              reason: reason(
                "CLAIM_OWNER_MISMATCH",
                "The Review Bundle belongs to another managed pull request.",
                "Handled history must remain scoped to the owning pull request.",
                "RECONCILE",
              ),
            };
          const handled = transaction.get(
            "SELECT bundle_id FROM handled_event_versions WHERE event_version_id = ?",
            eventVersionId,
          );
          if (
            handled !== undefined &&
            rowString(handled, "bundle_id") !== input.bundleId
          )
            return {
              outcome: "CONFLICT" as const,
              claim,
              hold: holdFromRow(holdRow),
              reason: reason(
                "CLAIM_OWNER_MISMATCH",
                "The immutable version already has another handled owner.",
                "Handled association history is permanent and cannot be reassigned.",
                "RECONCILE",
              ),
            };
          if (reviewBundle !== undefined)
            transaction.run(
              "INSERT INTO handled_event_versions (event_version_id, bundle_id, association_state, associated_at, handled_at, payload_json) VALUES (?, ?, 'HANDLED_BY_BUNDLE', ?, ?, ?) ON CONFLICT(event_version_id) DO UPDATE SET association_state = 'HANDLED_BY_BUNDLE', handled_at = excluded.handled_at, payload_json = excluded.payload_json",
              eventVersionId,
              input.bundleId,
              completedAt,
              completedAt,
              encoded({ outcome: input.outcome }).payload,
            );
        }
        transaction.run(
          "UPDATE f11_automatic_claims SET state = 'HANDLED', outcome = ?, released_at = ?, version = version + 1, updated_at = ? WHERE claim_id = ? AND state = 'ACTIVE'",
          input.outcome,
          completedAt,
          completedAt,
          input.claimId,
        );
        transaction.run(
          "UPDATE f11_holds SET state = 'RELEASED', released_at = ?, outcome = ?, version = version + 1, updated_at = ? WHERE hold_id = ? AND state = 'ACTIVE'",
          completedAt,
          input.outcome,
          completedAt,
          rowString(holdRow, "hold_id"),
        );
        updatePrimaryState(
          transaction,
          input.managedPrId,
          "WATCHING",
          completedAt,
        );
        const updatedClaim = transaction.get(
          "SELECT * FROM f11_automatic_claims WHERE claim_id = ?",
          input.claimId,
        );
        const updatedHold = transaction.get(
          "SELECT * FROM f11_holds WHERE hold_id = ?",
          rowString(holdRow, "hold_id"),
        );
        if (updatedClaim === undefined || updatedHold === undefined)
          throw new Error("F11_COMPLETION_NOT_READABLE");
        return {
          outcome: "RELEASED" as const,
          claim: claimFromRow(updatedClaim),
          hold: holdFromRow(updatedHold),
          reason: reason(
            "EVENT_VERSION_ALREADY_HANDLED",
            "The explicit human outcome released the pull-request review hold.",
            "Only the owning bundle may make its handled history and resume monitoring.",
            "NONE",
            { outcome: input.outcome },
          ),
        };
      },
      { signal: input.signal },
    );
  }

  public reconcileStartup(): readonly F11AutomaticClaimRecord[] {
    return this.store
      .readAll(
        "SELECT * FROM f11_automatic_claims WHERE state = 'ACTIVE' ORDER BY created_at, claim_id",
      )
      .map(claimFromRow);
  }
}
