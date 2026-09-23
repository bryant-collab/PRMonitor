import { createHash, randomUUID } from "node:crypto";
import {
  assertBoundedIdentifier,
  assertBoundedText,
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
import type {
  F12DispatchIntentStatus,
  F12PollRequestKind,
  F12PollRequestStatus,
  F12ReviewBatchState,
  F12ScheduleSlotState,
  F12SchedulerConfiguration,
  F12SchedulerReason,
} from "../../shared/control-plane";
import { resolveF12SchedulerConfiguration } from "../../shared/control-plane";

const RECORD_SCHEMA_VERSION = 1;
const OPEN_BATCH_STATES: readonly F12ReviewBatchState[] = [
  "PENDING",
  "READY",
  "DISPATCHING",
  "DEFERRED",
];

export interface F12SchedulerStateRecord {
  readonly configuration: F12SchedulerConfiguration;
  readonly paused: boolean;
  readonly revision: number;
  readonly changedAt: string;
  readonly actor: string;
  readonly requestId: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface F12ScheduleSlotRecord {
  readonly managedPrId: string;
  readonly state: F12ScheduleSlotState;
  readonly nextDueAt: string;
  readonly retryAt?: string;
  readonly retryAttempt: number;
  readonly lastRequestId?: string;
  readonly lastOutcome?: string;
  readonly reason?: F12SchedulerReason;
  readonly version: number;
  readonly updatedAt: string;
}

export interface F12PollRequestRecord {
  readonly requestId: string;
  readonly scopeKey: string;
  readonly managedPrIds: readonly string[];
  readonly kind: F12PollRequestKind;
  readonly status: F12PollRequestStatus;
  readonly schedulerRevision: number;
  readonly reason?: F12SchedulerReason;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly updatedAt: string;
}

export interface F12ReviewBatchRecord {
  readonly batchId: string;
  readonly managedPrId: string;
  readonly state: F12ReviewBatchState;
  readonly eventVersionIds: readonly string[];
  readonly quietPeriodMs: number;
  readonly firstEligibleAt: string;
  readonly lastEligibleAt: string;
  readonly deadlineAt: string;
  readonly schedulerRevision: number;
  readonly dispatchIntentId?: string;
  readonly claimId?: string;
  readonly operationId?: string;
  readonly bundleId?: string;
  readonly reason?: F12SchedulerReason;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface F12DispatchIntentRecord {
  readonly intentId: string;
  readonly batchId: string;
  readonly managedPrId: string;
  readonly eventVersionIds: readonly string[];
  readonly operationId: string;
  readonly bundleId: string;
  readonly status: F12DispatchIntentStatus;
  readonly schedulerRevision: number;
  readonly claimId?: string;
  readonly holdId?: string;
  readonly reason?: F12SchedulerReason;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type F12BatchAddOutcome = "CREATED" | "ADDED" | "DUPLICATE" | "CONFLICT";

export interface F12BatchAddResult {
  readonly outcome: F12BatchAddOutcome;
  readonly batch: F12ReviewBatchRecord;
}

function timestamp(clock: PersistenceClock): string {
  const value = clock.now();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
    throw new Error("F12_CLOCK_MUST_RETURN_UTC_MILLISECONDS");
  return value;
}

function assertTimestamp(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
    throw new Error(`F12_INVALID_${label.toUpperCase().replaceAll(" ", "_")}`);
}

function id(value: string, label: string): void {
  assertBoundedIdentifier(value, label);
}

function text(value: string, label: string): void {
  assertBoundedText(value, label);
}

function rowString(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`F12_INVALID_ROW_${key}`);
  return value;
}

function rowOptionalString(row: SqlRow, key: string): string | undefined {
  const value = row[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`F12_INVALID_ROW_${key}`);
  return value;
}

function rowNumber(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number") throw new Error(`F12_INVALID_ROW_${key}`);
  return value;
}

function rowBoolean(row: SqlRow, key: string): boolean {
  const value = row[key];
  if (value !== 0 && value !== 1) throw new Error(`F12_INVALID_ROW_${key}`);
  return value === 1;
}

function parseJson<T>(value: string | undefined, fallback: T): T {
  if (value === undefined || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error("F12_INVALID_PERSISTED_JSON", { cause: error });
  }
}

function json(value: unknown): string {
  return encodeSnapshot(value, RECORD_SCHEMA_VERSION).payload;
}

function reasonFromRow(row: SqlRow): F12SchedulerReason | undefined {
  const value = rowOptionalString(row, "reason_json");
  if (value === undefined) return undefined;
  const parsed = parseJson<unknown>(value, undefined);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("F12_INVALID_REASON");
  return parsed as F12SchedulerReason;
}

function idsFromJson(value: string): readonly string[] {
  const parsed = parseJson<unknown>(value, []);
  if (
    !Array.isArray(parsed) ||
    parsed.some((candidate) => typeof candidate !== "string")
  )
    throw new Error("F12_INVALID_IDENTIFIER_LIST");
  const result = parsed as string[];
  result.forEach((candidate) => id(candidate, "persisted identifier"));
  return result;
}

function safeHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function persistenceError(
  store: PersistenceStore,
  code: "CONFLICT" | "NOT_FOUND" | "INVALID_RECORD" | "DUPLICATE",
  what: string,
): PersistenceError {
  return new PersistenceError({
    code,
    stage: "health_record",
    what,
    why: "The F12 scheduler persistence boundary rejected an unsafe, stale, missing, or duplicate record.",
    nextAction: code === "CONFLICT" ? "RECONCILE" : "FIX_INPUT",
    correlationId: store.health.correlationId,
    databaseId: store.health.databaseId,
    details: {},
  });
}

function dateAfter(value: string, milliseconds: number): string {
  assertTimestamp(value, "timestamp");
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0)
    throw new Error("F12_INVALID_DURATION");
  return new Date(Date.parse(value) + milliseconds).toISOString();
}

function exactIds(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function schedulerStateFromRow(row: SqlRow): F12SchedulerStateRecord {
  const configuration = resolveF12SchedulerConfiguration({
    intervalMs: rowNumber(row, "poll_interval_ms"),
    quietPeriodMs: rowNumber(row, "quiet_period_ms"),
    maxConcurrentPrs: rowNumber(row, "max_concurrent_prs"),
    readOnlyPollWhilePaused: rowBoolean(row, "read_only_poll_while_paused"),
  });
  return {
    configuration,
    paused: rowBoolean(row, "paused"),
    revision: rowNumber(row, "revision"),
    changedAt: rowString(row, "changed_at"),
    actor: rowString(row, "actor"),
    requestId: rowString(row, "request_id"),
    version: rowNumber(row, "version"),
    createdAt: rowString(row, "created_at"),
    updatedAt: rowString(row, "updated_at"),
  };
}

function scheduleSlotFromRow(row: SqlRow): F12ScheduleSlotRecord {
  const state = rowString(row, "state");
  if (state !== "IDLE" && state !== "RUNNING")
    throw new Error("F12_INVALID_SLOT_STATE");
  const retryAt = rowOptionalString(row, "retry_at");
  const lastRequestId = rowOptionalString(row, "last_request_id");
  const lastOutcome = rowOptionalString(row, "last_outcome");
  const reason = reasonFromRow(row);
  assertTimestamp(rowString(row, "next_due_at"), "next due time");
  if (retryAt !== undefined) assertTimestamp(retryAt, "retry time");
  return {
    managedPrId: rowString(row, "managed_pr_id"),
    state,
    nextDueAt: rowString(row, "next_due_at"),
    ...(retryAt === undefined ? {} : { retryAt }),
    retryAttempt: rowNumber(row, "retry_attempt"),
    ...(lastRequestId === undefined ? {} : { lastRequestId }),
    ...(lastOutcome === undefined ? {} : { lastOutcome }),
    ...(reason === undefined ? {} : { reason }),
    version: rowNumber(row, "version"),
    updatedAt: rowString(row, "updated_at"),
  };
}

function pollRequestFromRow(row: SqlRow): F12PollRequestRecord {
  const kind = rowString(row, "kind");
  const status = rowString(row, "status");
  if (!(["SCHEDULED", "CHECK_NOW", "RECOVERY"] as string[]).includes(kind))
    throw new Error("F12_INVALID_POLL_REQUEST_KIND");
  if (
    !(
      [
        "PENDING",
        "RUNNING",
        "SUCCEEDED",
        "FAILED",
        "CANCELLED",
        "UNCERTAIN",
      ] as string[]
    ).includes(status)
  )
    throw new Error("F12_INVALID_POLL_REQUEST_STATUS");
  return {
    requestId: rowString(row, "request_id"),
    scopeKey: rowString(row, "scope_key"),
    managedPrIds: idsFromJson(rowString(row, "managed_pr_ids_json")),
    kind: kind as F12PollRequestKind,
    status: status as F12PollRequestStatus,
    schedulerRevision: rowNumber(row, "scheduler_revision"),
    ...(reasonFromRow(row) === undefined ? {} : { reason: reasonFromRow(row) }),
    createdAt: rowString(row, "created_at"),
    ...(rowOptionalString(row, "started_at") === undefined
      ? {}
      : { startedAt: rowOptionalString(row, "started_at") }),
    ...(rowOptionalString(row, "completed_at") === undefined
      ? {}
      : { completedAt: rowOptionalString(row, "completed_at") }),
    updatedAt: rowString(row, "updated_at"),
  };
}

function batchFromRow(
  row: SqlRow,
  eventVersionIds: readonly string[],
): F12ReviewBatchRecord {
  const state = rowString(row, "state");
  if (!(
    OPEN_BATCH_STATES.includes(state as F12ReviewBatchState) ||
    ["DISPATCHED", "FAILED", "CANCELLED"].includes(state)
  ))
    throw new Error("F12_INVALID_BATCH_STATE");
  const reason = reasonFromRow(row);
  return {
    batchId: rowString(row, "batch_id"),
    managedPrId: rowString(row, "managed_pr_id"),
    state: state as F12ReviewBatchState,
    eventVersionIds,
    quietPeriodMs: rowNumber(row, "quiet_period_ms"),
    firstEligibleAt: rowString(row, "first_eligible_at"),
    lastEligibleAt: rowString(row, "last_eligible_at"),
    deadlineAt: rowString(row, "deadline_at"),
    schedulerRevision: rowNumber(row, "scheduler_revision"),
    ...(rowOptionalString(row, "dispatch_intent_id") === undefined
      ? {}
      : { dispatchIntentId: rowOptionalString(row, "dispatch_intent_id") }),
    ...(rowOptionalString(row, "claim_id") === undefined
      ? {}
      : { claimId: rowOptionalString(row, "claim_id") }),
    ...(rowOptionalString(row, "operation_id") === undefined
      ? {}
      : { operationId: rowOptionalString(row, "operation_id") }),
    ...(rowOptionalString(row, "bundle_id") === undefined
      ? {}
      : { bundleId: rowOptionalString(row, "bundle_id") }),
    ...(reason === undefined ? {} : { reason }),
    version: rowNumber(row, "version"),
    createdAt: rowString(row, "created_at"),
    updatedAt: rowString(row, "updated_at"),
  };
}

function dispatchIntentFromRow(row: SqlRow): F12DispatchIntentRecord {
  const status = rowString(row, "status");
  if (
    !(
      [
        "PENDING",
        "CLAIMED",
        "HANDED_OFF",
        "DEFERRED",
        "FAILED",
        "UNCERTAIN",
      ] as string[]
    ).includes(status)
  )
    throw new Error("F12_INVALID_DISPATCH_STATUS");
  const reason = reasonFromRow(row);
  return {
    intentId: rowString(row, "intent_id"),
    batchId: rowString(row, "batch_id"),
    managedPrId: rowString(row, "managed_pr_id"),
    eventVersionIds: idsFromJson(rowString(row, "event_version_ids_json")),
    operationId: rowString(row, "operation_id"),
    bundleId: rowString(row, "bundle_id"),
    status: status as F12DispatchIntentStatus,
    schedulerRevision: rowNumber(row, "scheduler_revision"),
    ...(rowOptionalString(row, "claim_id") === undefined
      ? {}
      : { claimId: rowOptionalString(row, "claim_id") }),
    ...(rowOptionalString(row, "hold_id") === undefined
      ? {}
      : { holdId: rowOptionalString(row, "hold_id") }),
    ...(reason === undefined ? {} : { reason }),
    createdAt: rowString(row, "created_at"),
    updatedAt: rowString(row, "updated_at"),
  };
}

export interface F12PersistenceOptions {
  readonly clock?: PersistenceClock;
  readonly transactionOptions?: TransactionOptions;
}

export class F12PersistenceRepositories {
  private readonly clock: PersistenceClock;
  private readonly transactionOptions: TransactionOptions;

  public constructor(
    private readonly store: PersistenceStore,
    options: F12PersistenceOptions = {},
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

  public getSchedulerState(
    defaults: F12SchedulerConfiguration = resolveF12SchedulerConfiguration(),
    at = timestamp(this.clock),
  ): F12SchedulerStateRecord {
    const existing = this.store.read(
      "SELECT * FROM f12_scheduler_state WHERE state_id = 1",
    );
    if (existing !== undefined) return schedulerStateFromRow(existing);
    return this.transaction((transaction) => {
      const current = transaction.get(
        "SELECT * FROM f12_scheduler_state WHERE state_id = 1",
      );
      if (current !== undefined) return schedulerStateFromRow(current);
      transaction.run(
        "INSERT INTO f12_scheduler_state (state_id, poll_interval_ms, quiet_period_ms, max_concurrent_prs, read_only_poll_while_paused, paused, revision, changed_at, actor, request_id, version, created_at, updated_at) VALUES (1, ?, ?, ?, ?, 0, 1, ?, ?, ?, 1, ?, ?)",
        defaults.intervalMs,
        defaults.quietPeriodMs,
        defaults.maxConcurrentPrs,
        defaults.readOnlyPollWhilePaused ? 1 : 0,
        at,
        "SYSTEM",
        "f12-bootstrap",
        at,
        at,
      );
      const inserted = transaction.get(
        "SELECT * FROM f12_scheduler_state WHERE state_id = 1",
      );
      if (inserted === undefined)
        throw new Error("F12_SCHEDULER_STATE_NOT_READABLE");
      return schedulerStateFromRow(inserted);
    });
  }

  public updateConfiguration(input: {
    readonly configuration: F12SchedulerConfiguration;
    readonly actor: string;
    readonly requestId: string;
    readonly expectedRevision?: number;
    readonly changedAt?: string;
  }): F12SchedulerStateRecord {
    const configuration = resolveF12SchedulerConfiguration(input.configuration);
    id(input.actor, "scheduler actor");
    id(input.requestId, "scheduler request identifier");
    const changedAt = input.changedAt ?? timestamp(this.clock);
    assertTimestamp(changedAt, "changed at");
    return this.transaction((transaction) => {
      const row = transaction.get(
        "SELECT * FROM f12_scheduler_state WHERE state_id = 1",
      );
      if (row === undefined)
        throw new Error("F12_SCHEDULER_STATE_NOT_INITIALIZED");
      const current = schedulerStateFromRow(row);
      if (
        input.expectedRevision !== undefined &&
        input.expectedRevision !== current.revision
      )
        throw persistenceError(
          this.store,
          "CONFLICT",
          "The scheduler configuration changed before this update committed.",
        );
      if (
        JSON.stringify(configuration) === JSON.stringify(current.configuration)
      )
        return current;
      const nextRevision = current.revision + 1;
      transaction.run(
        "UPDATE f12_scheduler_state SET poll_interval_ms = ?, quiet_period_ms = ?, max_concurrent_prs = ?, read_only_poll_while_paused = ?, revision = ?, changed_at = ?, actor = ?, request_id = ?, version = version + 1, updated_at = ? WHERE state_id = 1 AND revision = ?",
        configuration.intervalMs,
        configuration.quietPeriodMs,
        configuration.maxConcurrentPrs,
        configuration.readOnlyPollWhilePaused ? 1 : 0,
        nextRevision,
        changedAt,
        input.actor,
        input.requestId,
        changedAt,
        current.revision,
      );
      const updated = transaction.get(
        "SELECT * FROM f12_scheduler_state WHERE state_id = 1",
      );
      if (updated === undefined)
        throw new Error("F12_SCHEDULER_STATE_NOT_READABLE");
      return schedulerStateFromRow(updated);
    });
  }

  public setPaused(input: {
    readonly paused: boolean;
    readonly actor: string;
    readonly requestId: string;
    readonly expectedRevision?: number;
    readonly changedAt?: string;
  }): F12SchedulerStateRecord {
    if (typeof input.paused !== "boolean")
      throw new Error("F12_INVALID_PAUSE_VALUE");
    id(input.actor, "scheduler actor");
    id(input.requestId, "scheduler request identifier");
    const changedAt = input.changedAt ?? timestamp(this.clock);
    assertTimestamp(changedAt, "changed at");
    return this.transaction((transaction) => {
      const row = transaction.get(
        "SELECT * FROM f12_scheduler_state WHERE state_id = 1",
      );
      if (row === undefined)
        throw new Error("F12_SCHEDULER_STATE_NOT_INITIALIZED");
      const current = schedulerStateFromRow(row);
      if (
        input.expectedRevision !== undefined &&
        input.expectedRevision !== current.revision
      )
        throw persistenceError(
          this.store,
          "CONFLICT",
          "The watching pause changed before this update committed.",
        );
      if (current.paused === input.paused) return current;
      const nextRevision = current.revision + 1;
      transaction.run(
        "UPDATE f12_scheduler_state SET paused = ?, revision = ?, changed_at = ?, actor = ?, request_id = ?, version = version + 1, updated_at = ? WHERE state_id = 1 AND revision = ?",
        input.paused ? 1 : 0,
        nextRevision,
        changedAt,
        input.actor,
        input.requestId,
        changedAt,
        current.revision,
      );
      const updated = transaction.get(
        "SELECT * FROM f12_scheduler_state WHERE state_id = 1",
      );
      if (updated === undefined)
        throw new Error("F12_SCHEDULER_STATE_NOT_READABLE");
      return schedulerStateFromRow(updated);
    });
  }

  public ensureScheduleSlots(
    managedPrIds: readonly string[],
    intervalMs: number,
    at = timestamp(this.clock),
  ): void {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 0)
      throw new Error("F12_INVALID_POLL_INTERVAL");
    assertTimestamp(at, "schedule time");
    const unique = [...new Set(managedPrIds)];
    unique.forEach((value) => id(value, "managed PR identifier"));
    this.transaction((transaction) => {
      for (const managedPrId of unique) {
        const existing = transaction.get(
          "SELECT managed_pr_id FROM f12_schedule_slots WHERE managed_pr_id = ?",
          managedPrId,
        );
        if (existing !== undefined) continue;
        const managed = transaction.get(
          "SELECT managed_pr_id FROM managed_prs WHERE managed_pr_id = ?",
          managedPrId,
        );
        if (managed === undefined)
          throw persistenceError(
            this.store,
            "NOT_FOUND",
            "The managed pull request does not exist for a scheduler slot.",
          );
        transaction.run(
          "INSERT INTO f12_schedule_slots (managed_pr_id, state, next_due_at, retry_at, retry_attempt, version, updated_at) VALUES (?, 'IDLE', ?, NULL, 0, 1, ?)",
          managedPrId,
          dateAfter(at, intervalMs),
          at,
        );
      }
    });
  }

  public listScheduleSlots(): readonly F12ScheduleSlotRecord[] {
    return this.store
      .readAll("SELECT * FROM f12_schedule_slots ORDER BY managed_pr_id")
      .map(scheduleSlotFromRow);
  }

  public getScheduleSlot(
    managedPrId: string,
  ): F12ScheduleSlotRecord | undefined {
    id(managedPrId, "managed PR identifier");
    const row = this.store.read(
      "SELECT * FROM f12_schedule_slots WHERE managed_pr_id = ?",
      managedPrId,
    );
    return row === undefined ? undefined : scheduleSlotFromRow(row);
  }

  public putScheduleSlot(input: {
    readonly managedPrId: string;
    readonly state: F12ScheduleSlotState;
    readonly nextDueAt: string;
    readonly retryAt?: string;
    readonly retryAttempt: number;
    readonly lastRequestId?: string;
    readonly lastOutcome?: string;
    readonly reason?: F12SchedulerReason;
    readonly expectedVersion?: number;
    readonly updatedAt?: string;
  }): F12ScheduleSlotRecord {
    id(input.managedPrId, "managed PR identifier");
    if (input.state !== "IDLE" && input.state !== "RUNNING")
      throw new Error("F12_INVALID_SLOT_STATE");
    assertTimestamp(input.nextDueAt, "next due time");
    if (input.retryAt !== undefined)
      assertTimestamp(input.retryAt, "retry time");
    if (!Number.isSafeInteger(input.retryAttempt) || input.retryAttempt < 0)
      throw new Error("F12_INVALID_RETRY_ATTEMPT");
    const updatedAt = input.updatedAt ?? timestamp(this.clock);
    assertTimestamp(updatedAt, "updated at");
    return this.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT * FROM f12_schedule_slots WHERE managed_pr_id = ?",
        input.managedPrId,
      );
      if (existing === undefined)
        throw persistenceError(
          this.store,
          "NOT_FOUND",
          "The scheduler slot does not exist.",
        );
      const current = scheduleSlotFromRow(existing);
      if (
        input.expectedVersion !== undefined &&
        input.expectedVersion !== current.version
      )
        throw persistenceError(
          this.store,
          "CONFLICT",
          "The scheduler slot changed before its update committed.",
        );
      transaction.run(
        "UPDATE f12_schedule_slots SET state = ?, next_due_at = ?, retry_at = ?, retry_attempt = ?, last_request_id = ?, last_outcome = ?, reason_json = ?, version = version + 1, updated_at = ? WHERE managed_pr_id = ? AND version = ?",
        input.state,
        input.nextDueAt,
        input.retryAt ?? null,
        input.retryAttempt,
        input.lastRequestId ?? null,
        input.lastOutcome ?? null,
        input.reason === undefined ? null : json(input.reason),
        updatedAt,
        input.managedPrId,
        current.version,
      );
      const updated = transaction.get(
        "SELECT * FROM f12_schedule_slots WHERE managed_pr_id = ?",
        input.managedPrId,
      );
      if (updated === undefined) throw new Error("F12_SLOT_NOT_READABLE");
      return scheduleSlotFromRow(updated);
    });
  }

  public listPollRequests(limit = 256): readonly F12PollRequestRecord[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_024)
      throw new Error("F12_INVALID_POLL_REQUEST_LIMIT");
    return this.store
      .readAll(
        "SELECT * FROM f12_poll_requests ORDER BY created_at DESC, request_id DESC LIMIT ?",
        limit,
      )
      .map(pollRequestFromRow);
  }

  public getPollRequest(requestId: string): F12PollRequestRecord | undefined {
    id(requestId, "poll request identifier");
    const row = this.store.read(
      "SELECT * FROM f12_poll_requests WHERE request_id = ?",
      requestId,
    );
    return row === undefined ? undefined : pollRequestFromRow(row);
  }

  public findActivePollRequest(
    managedPrIds: readonly string[],
  ): F12PollRequestRecord | undefined {
    const requested = new Set(managedPrIds);
    managedPrIds.forEach((value) => id(value, "managed PR identifier"));
    const records = this.store
      .readAll(
        "SELECT * FROM f12_poll_requests WHERE status IN ('PENDING', 'RUNNING', 'UNCERTAIN') ORDER BY created_at, request_id",
      )
      .map(pollRequestFromRow);
    return records.find((record) => {
      if (record.scopeKey === "ALL") return true;
      return record.managedPrIds.some((value) => requested.has(value));
    });
  }

  public beginPollRequest(input: {
    readonly requestId: string;
    readonly scopeKey: string;
    readonly managedPrIds: readonly string[];
    readonly kind: F12PollRequestKind;
    readonly schedulerRevision: number;
    readonly createdAt?: string;
  }): { readonly created: boolean; readonly request: F12PollRequestRecord } {
    id(input.requestId, "poll request identifier");
    text(input.scopeKey, "poll request scope");
    input.managedPrIds.forEach((value) => id(value, "managed PR identifier"));
    if (
      !Number.isSafeInteger(input.schedulerRevision) ||
      input.schedulerRevision < 1
    )
      throw new Error("F12_INVALID_SCHEDULER_REVISION");
    const createdAt = input.createdAt ?? timestamp(this.clock);
    assertTimestamp(createdAt, "poll request time");
    return this.transaction((transaction) => {
      const activeRows = transaction.all(
        "SELECT * FROM f12_poll_requests WHERE status IN ('PENDING', 'RUNNING', 'UNCERTAIN') ORDER BY created_at, request_id",
      );
      const requested = new Set(input.managedPrIds);
      for (const activeRow of activeRows) {
        const active = pollRequestFromRow(activeRow);
        const overlaps =
          active.scopeKey === "ALL" ||
          input.scopeKey === "ALL" ||
          active.managedPrIds.some((value) => requested.has(value));
        if (overlaps) return { created: false, request: active };
      }
      transaction.run(
        "INSERT INTO f12_poll_requests (request_id, scope_key, managed_pr_ids_json, kind, status, scheduler_revision, created_at, updated_at) VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?)",
        input.requestId,
        input.scopeKey,
        JSON.stringify(input.managedPrIds),
        input.kind,
        input.schedulerRevision,
        createdAt,
        createdAt,
      );
      for (const managedPrId of input.managedPrIds) {
        transaction.run(
          "UPDATE f12_schedule_slots SET state = 'RUNNING', version = version + 1, updated_at = ? WHERE managed_pr_id = ? AND state = 'IDLE'",
          createdAt,
          managedPrId,
        );
      }
      const inserted = transaction.get(
        "SELECT * FROM f12_poll_requests WHERE request_id = ?",
        input.requestId,
      );
      if (inserted === undefined)
        throw new Error("F12_POLL_REQUEST_NOT_READABLE");
      return { created: true, request: pollRequestFromRow(inserted) };
    });
  }

  public markPollRequestRunning(
    requestId: string,
    startedAt = timestamp(this.clock),
  ): F12PollRequestRecord {
    id(requestId, "poll request identifier");
    assertTimestamp(startedAt, "poll start time");
    return this.transaction((transaction) => {
      const row = transaction.get(
        "SELECT * FROM f12_poll_requests WHERE request_id = ?",
        requestId,
      );
      if (row === undefined)
        throw persistenceError(
          this.store,
          "NOT_FOUND",
          "The poll request does not exist.",
        );
      const current = pollRequestFromRow(row);
      if (current.status === "RUNNING") return current;
      if (!["PENDING", "UNCERTAIN"].includes(current.status)) return current;
      transaction.run(
        "UPDATE f12_poll_requests SET status = 'RUNNING', started_at = COALESCE(started_at, ?), updated_at = ? WHERE request_id = ? AND status IN ('PENDING', 'UNCERTAIN')",
        startedAt,
        startedAt,
        requestId,
      );
      const updated = transaction.get(
        "SELECT * FROM f12_poll_requests WHERE request_id = ?",
        requestId,
      );
      if (updated === undefined)
        throw new Error("F12_POLL_REQUEST_NOT_READABLE");
      return pollRequestFromRow(updated);
    });
  }

  public completePollRequest(input: {
    readonly requestId: string;
    readonly status: Exclude<F12PollRequestStatus, "PENDING" | "RUNNING">;
    readonly reason?: F12SchedulerReason;
    readonly completedAt?: string;
  }): F12PollRequestRecord {
    id(input.requestId, "poll request identifier");
    const completedAt = input.completedAt ?? timestamp(this.clock);
    assertTimestamp(completedAt, "poll completion time");
    return this.transaction((transaction) => {
      const row = transaction.get(
        "SELECT * FROM f12_poll_requests WHERE request_id = ?",
        input.requestId,
      );
      if (row === undefined)
        throw persistenceError(
          this.store,
          "NOT_FOUND",
          "The poll request does not exist.",
        );
      const current = pollRequestFromRow(row);
      if (current.status === input.status) return current;
      if (!["PENDING", "RUNNING", "UNCERTAIN"].includes(current.status))
        return current;
      transaction.run(
        "UPDATE f12_poll_requests SET status = ?, reason_json = ?, completed_at = ?, updated_at = ? WHERE request_id = ? AND status IN ('PENDING', 'RUNNING', 'UNCERTAIN')",
        input.status,
        input.reason === undefined ? null : json(input.reason),
        completedAt,
        completedAt,
        input.requestId,
      );
      const updated = transaction.get(
        "SELECT * FROM f12_poll_requests WHERE request_id = ?",
        input.requestId,
      );
      if (updated === undefined)
        throw new Error("F12_POLL_REQUEST_NOT_READABLE");
      return pollRequestFromRow(updated);
    });
  }

  public reconcilePollRequests(
    reason: F12SchedulerReason,
    at = timestamp(this.clock),
  ): readonly F12PollRequestRecord[] {
    assertTimestamp(at, "recovery time");
    return this.transaction((transaction) => {
      const rows = transaction.all(
        "SELECT * FROM f12_poll_requests WHERE status IN ('PENDING', 'RUNNING') ORDER BY created_at, request_id",
      );
      const recovered: F12PollRequestRecord[] = [];
      for (const row of rows) {
        const request = pollRequestFromRow(row);
        transaction.run(
          "UPDATE f12_poll_requests SET status = 'UNCERTAIN', reason_json = ?, updated_at = ? WHERE request_id = ? AND status IN ('PENDING', 'RUNNING')",
          json(reason),
          at,
          request.requestId,
        );
        const updated = transaction.get(
          "SELECT * FROM f12_poll_requests WHERE request_id = ?",
          request.requestId,
        );
        if (updated !== undefined) recovered.push(pollRequestFromRow(updated));
      }
      return recovered;
    });
  }

  public addEligibleVersion(input: {
    readonly managedPrId: string;
    readonly eventVersionId: string;
    readonly eligibleAt?: string;
    readonly quietPeriodMs: number;
    readonly schedulerRevision: number;
  }): F12BatchAddResult {
    id(input.managedPrId, "managed PR identifier");
    id(input.eventVersionId, "event version identifier");
    if (!Number.isSafeInteger(input.quietPeriodMs) || input.quietPeriodMs < 0)
      throw new Error("F12_INVALID_QUIET_PERIOD");
    if (
      !Number.isSafeInteger(input.schedulerRevision) ||
      input.schedulerRevision < 1
    )
      throw new Error("F12_INVALID_SCHEDULER_REVISION");
    const eligibleAt = input.eligibleAt ?? timestamp(this.clock);
    assertTimestamp(eligibleAt, "eligible time");
    return this.transaction((transaction) => {
      const event = transaction.get(
        "SELECT managed_pr_id FROM remote_event_versions WHERE event_version_id = ?",
        input.eventVersionId,
      );
      if (
        event === undefined ||
        rowString(event, "managed_pr_id") !== input.managedPrId
      )
        throw persistenceError(
          this.store,
          "CONFLICT",
          "The feedback version is not in the requested managed-PR scope.",
        );

      const existingMember = transaction.get(
        "SELECT batch_id FROM f12_review_batch_members WHERE managed_pr_id = ? AND event_version_id = ?",
        input.managedPrId,
        input.eventVersionId,
      );
      if (existingMember !== undefined) {
        const batch = this.readBatchInTransaction(
          transaction,
          rowString(existingMember, "batch_id"),
        );
        return {
          outcome:
            batch.managedPrId === input.managedPrId
              ? ("DUPLICATE" as const)
              : ("CONFLICT" as const),
          batch,
        };
      }

      const openRow = transaction.get(
        "SELECT * FROM f12_review_batches WHERE managed_pr_id = ? AND state IN ('PENDING', 'READY', 'DEFERRED') ORDER BY created_at, batch_id LIMIT 1",
        input.managedPrId,
      );
      const competingRow = transaction.get(
        "SELECT * FROM f12_review_batches WHERE managed_pr_id = ? AND state IN ('DISPATCHING', 'DISPATCHED') ORDER BY created_at DESC, batch_id DESC LIMIT 1",
        input.managedPrId,
      );
      if (openRow === undefined && competingRow !== undefined)
        return {
          outcome: "CONFLICT" as const,
          batch: this.readBatchInTransaction(
            transaction,
            rowString(competingRow, "batch_id"),
          ),
        };

      const at = timestamp(this.clock);
      if (openRow === undefined) {
        const batchId = `f12-batch-${safeHash(`${input.managedPrId}:${input.eventVersionId}:${input.schedulerRevision}`).slice(0, 32)}`;
        const deadlineAt = dateAfter(eligibleAt, input.quietPeriodMs);
        const batchPayload = {
          schemaVersion: 1,
          source: "F12_SCHEDULER",
          managedPrId: input.managedPrId,
          eventVersionIds: [input.eventVersionId],
          firstEligibleAt: eligibleAt,
          lastEligibleAt: eligibleAt,
          quietPeriodMs: input.quietPeriodMs,
        };
        const encoded = encodeSnapshot(batchPayload);
        transaction.run(
          "INSERT OR IGNORE INTO review_batches (batch_id, managed_pr_id, schema_version, payload_json, payload_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          batchId,
          input.managedPrId,
          encoded.schemaVersion,
          encoded.payload,
          encoded.payloadHash,
          at,
        );
        transaction.run(
          "INSERT INTO f12_review_batches (batch_id, managed_pr_id, state, quiet_period_ms, first_eligible_at, last_eligible_at, deadline_at, scheduler_revision, version, created_at, updated_at) VALUES (?, ?, 'PENDING', ?, ?, ?, ?, ?, 1, ?, ?)",
          batchId,
          input.managedPrId,
          input.quietPeriodMs,
          eligibleAt,
          eligibleAt,
          deadlineAt,
          input.schedulerRevision,
          at,
          at,
        );
        transaction.run(
          "INSERT INTO f12_review_batch_members (batch_id, managed_pr_id, event_version_id, first_eligible_at, created_at) VALUES (?, ?, ?, ?, ?)",
          batchId,
          input.managedPrId,
          input.eventVersionId,
          eligibleAt,
          at,
        );
        return {
          outcome: "CREATED" as const,
          batch: this.readBatchInTransaction(transaction, batchId),
        };
      }

      const current = this.readBatchInTransaction(
        transaction,
        rowString(openRow, "batch_id"),
      );
      const deadlineAt = dateAfter(eligibleAt, current.quietPeriodMs);
      transaction.run(
        "INSERT INTO f12_review_batch_members (batch_id, managed_pr_id, event_version_id, first_eligible_at, created_at) VALUES (?, ?, ?, ?, ?)",
        current.batchId,
        input.managedPrId,
        input.eventVersionId,
        eligibleAt,
        at,
      );
      const eventVersionIds = [
        ...current.eventVersionIds,
        input.eventVersionId,
      ];
      transaction.run(
        "UPDATE f12_review_batches SET state = 'PENDING', last_eligible_at = ?, deadline_at = ?, scheduler_revision = ?, reason_json = NULL, version = version + 1, updated_at = ? WHERE batch_id = ? AND version = ?",
        eligibleAt,
        deadlineAt,
        input.schedulerRevision,
        at,
        current.batchId,
        current.version,
      );
      this.updateGenericBatchPayload(
        transaction,
        current.batchId,
        input.managedPrId,
        eventVersionIds,
        current.firstEligibleAt,
        eligibleAt,
        current.quietPeriodMs,
        at,
      );
      return {
        outcome: "ADDED" as const,
        batch: this.readBatchInTransaction(transaction, current.batchId),
      };
    });
  }

  public markExpiredBatchesReady(
    at = timestamp(this.clock),
  ): readonly F12ReviewBatchRecord[] {
    assertTimestamp(at, "batch evaluation time");
    return this.transaction((transaction) => {
      const rows = transaction.all(
        "SELECT * FROM f12_review_batches WHERE state IN ('PENDING', 'DEFERRED') AND deadline_at <= ? ORDER BY deadline_at, managed_pr_id, batch_id",
        at,
      );
      const ready: F12ReviewBatchRecord[] = [];
      for (const row of rows) {
        const current = this.readBatchInTransaction(
          transaction,
          rowString(row, "batch_id"),
        );
        transaction.run(
          "UPDATE f12_review_batches SET state = 'READY', version = version + 1, updated_at = ? WHERE batch_id = ? AND version = ? AND state IN ('PENDING', 'DEFERRED')",
          at,
          current.batchId,
          current.version,
        );
        ready.push(this.readBatchInTransaction(transaction, current.batchId));
      }
      return ready;
    });
  }

  public getReviewBatch(batchId: string): F12ReviewBatchRecord | undefined {
    id(batchId, "review batch identifier");
    const row = this.store.read(
      "SELECT * FROM f12_review_batches WHERE batch_id = ?",
      batchId,
    );
    return row === undefined ? undefined : this.readBatch(batchId);
  }

  public listReviewBatches(
    states: readonly F12ReviewBatchState[] = [
      "PENDING",
      "READY",
      "DISPATCHING",
      "DISPATCHED",
      "DEFERRED",
      "FAILED",
      "CANCELLED",
    ],
  ): readonly F12ReviewBatchRecord[] {
    if (states.length === 0) return [];
    const placeholders = states.map(() => "?").join(", ");
    states.forEach((state) => {
      if (
        ![
          "PENDING",
          "READY",
          "DISPATCHING",
          "DISPATCHED",
          "DEFERRED",
          "FAILED",
          "CANCELLED",
        ].includes(state)
      )
        throw new Error("F12_INVALID_BATCH_STATE");
    });
    return this.store
      .readAll(
        `SELECT batch_id FROM f12_review_batches WHERE state IN (${placeholders}) ORDER BY deadline_at, managed_pr_id, batch_id`,
        ...states,
      )
      .map((row) => this.readBatch(rowString(row, "batch_id")));
  }

  public updateReviewBatch(input: {
    readonly batchId: string;
    readonly state: F12ReviewBatchState;
    readonly dispatchIntentId?: string;
    readonly claimId?: string;
    readonly operationId?: string;
    readonly bundleId?: string;
    readonly reason?: F12SchedulerReason | null;
    readonly expectedVersion?: number;
    readonly updatedAt?: string;
  }): F12ReviewBatchRecord {
    id(input.batchId, "review batch identifier");
    const updatedAt = input.updatedAt ?? timestamp(this.clock);
    assertTimestamp(updatedAt, "batch update time");
    return this.transaction((transaction) => {
      const current = this.readBatchInTransaction(transaction, input.batchId);
      if (
        input.expectedVersion !== undefined &&
        input.expectedVersion !== current.version
      )
        throw persistenceError(
          this.store,
          "CONFLICT",
          "The Review Batch changed before its scheduler update committed.",
        );
      transaction.run(
        "UPDATE f12_review_batches SET state = ?, dispatch_intent_id = ?, claim_id = ?, operation_id = ?, bundle_id = ?, reason_json = ?, version = version + 1, updated_at = ? WHERE batch_id = ? AND version = ?",
        input.state,
        input.dispatchIntentId ?? current.dispatchIntentId ?? null,
        input.claimId ?? current.claimId ?? null,
        input.operationId ?? current.operationId ?? null,
        input.bundleId ?? current.bundleId ?? null,
        input.reason === null
          ? null
          : input.reason === undefined
            ? current.reason === undefined
              ? null
              : json(current.reason)
            : json(input.reason),
        updatedAt,
        current.batchId,
        current.version,
      );
      return this.readBatchInTransaction(transaction, current.batchId);
    });
  }

  public getDispatchIntent(
    batchId: string,
  ): F12DispatchIntentRecord | undefined {
    id(batchId, "review batch identifier");
    const row = this.store.read(
      "SELECT * FROM f12_dispatch_intents WHERE batch_id = ?",
      batchId,
    );
    return row === undefined ? undefined : dispatchIntentFromRow(row);
  }

  public listDispatchIntents(limit = 256): readonly F12DispatchIntentRecord[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_024)
      throw new Error("F12_INVALID_DISPATCH_LIMIT");
    return this.store
      .readAll(
        "SELECT * FROM f12_dispatch_intents ORDER BY created_at DESC, intent_id DESC LIMIT ?",
        limit,
      )
      .map(dispatchIntentFromRow);
  }

  public createDispatchIntent(input: {
    readonly intentId: string;
    readonly batchId: string;
    readonly managedPrId: string;
    readonly eventVersionIds: readonly string[];
    readonly operationId: string;
    readonly bundleId: string;
    readonly schedulerRevision: number;
    readonly createdAt?: string;
  }): { readonly created: boolean; readonly intent: F12DispatchIntentRecord } {
    for (const [value, label] of [
      [input.intentId, "dispatch intent identifier"],
      [input.batchId, "review batch identifier"],
      [input.managedPrId, "managed PR identifier"],
      [input.operationId, "operation identifier"],
      [input.bundleId, "bundle identifier"],
    ] as const)
      id(value, label);
    const eventVersionIds = [...new Set(input.eventVersionIds)];
    if (eventVersionIds.length !== input.eventVersionIds.length)
      throw new Error("F12_DUPLICATE_EVENT_VERSION");
    eventVersionIds.forEach((value) => id(value, "event version identifier"));
    const createdAt = input.createdAt ?? timestamp(this.clock);
    assertTimestamp(createdAt, "dispatch intent time");
    return this.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT * FROM f12_dispatch_intents WHERE batch_id = ?",
        input.batchId,
      );
      if (existing !== undefined) {
        const intent = dispatchIntentFromRow(existing);
        if (
          intent.managedPrId !== input.managedPrId ||
          intent.operationId !== input.operationId ||
          intent.bundleId !== input.bundleId ||
          !exactIds(intent.eventVersionIds, eventVersionIds)
        )
          throw persistenceError(
            this.store,
            "CONFLICT",
            "The Review Batch already has a different dispatch intent.",
          );
        return { created: false, intent };
      }
      const batch = transaction.get(
        "SELECT * FROM f12_review_batches WHERE batch_id = ?",
        input.batchId,
      );
      if (batch === undefined)
        throw persistenceError(
          this.store,
          "NOT_FOUND",
          "The Review Batch does not exist for the dispatch intent.",
        );
      if (rowString(batch, "managed_pr_id") !== input.managedPrId)
        throw persistenceError(
          this.store,
          "CONFLICT",
          "The dispatch intent is outside the Review Batch scope.",
        );
      transaction.run(
        "INSERT INTO f12_dispatch_intents (intent_id, batch_id, managed_pr_id, event_version_ids_json, operation_id, bundle_id, status, scheduler_revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)",
        input.intentId,
        input.batchId,
        input.managedPrId,
        JSON.stringify(eventVersionIds),
        input.operationId,
        input.bundleId,
        input.schedulerRevision,
        createdAt,
        createdAt,
      );
      transaction.run(
        "UPDATE f12_review_batches SET state = 'DISPATCHING', dispatch_intent_id = ?, operation_id = ?, bundle_id = ?, version = version + 1, updated_at = ? WHERE batch_id = ?",
        input.intentId,
        input.operationId,
        input.bundleId,
        createdAt,
        input.batchId,
      );
      const inserted = transaction.get(
        "SELECT * FROM f12_dispatch_intents WHERE intent_id = ?",
        input.intentId,
      );
      if (inserted === undefined)
        throw new Error("F12_DISPATCH_INTENT_NOT_READABLE");
      return { created: true, intent: dispatchIntentFromRow(inserted) };
    });
  }

  public updateDispatchIntent(input: {
    readonly intentId: string;
    readonly status: F12DispatchIntentStatus;
    readonly claimId?: string;
    readonly holdId?: string;
    readonly reason?: F12SchedulerReason | null;
    readonly updatedAt?: string;
  }): F12DispatchIntentRecord {
    id(input.intentId, "dispatch intent identifier");
    const updatedAt = input.updatedAt ?? timestamp(this.clock);
    assertTimestamp(updatedAt, "dispatch intent update time");
    return this.transaction((transaction) => {
      const row = transaction.get(
        "SELECT * FROM f12_dispatch_intents WHERE intent_id = ?",
        input.intentId,
      );
      if (row === undefined)
        throw persistenceError(
          this.store,
          "NOT_FOUND",
          "The dispatch intent does not exist.",
        );
      const current = dispatchIntentFromRow(row);
      if (current.status === input.status && input.reason === undefined)
        return current;
      transaction.run(
        "UPDATE f12_dispatch_intents SET status = ?, claim_id = ?, hold_id = ?, reason_json = ?, updated_at = ? WHERE intent_id = ?",
        input.status,
        input.claimId ?? current.claimId ?? null,
        input.holdId ?? current.holdId ?? null,
        input.reason === null
          ? null
          : input.reason === undefined
            ? current.reason === undefined
              ? null
              : json(current.reason)
            : json(input.reason),
        updatedAt,
        input.intentId,
      );
      const updated = transaction.get(
        "SELECT * FROM f12_dispatch_intents WHERE intent_id = ?",
        input.intentId,
      );
      if (updated === undefined)
        throw new Error("F12_DISPATCH_INTENT_NOT_READABLE");
      return dispatchIntentFromRow(updated);
    });
  }

  public listRecoveryDispatchIntents(): readonly F12DispatchIntentRecord[] {
    return this.store
      .readAll(
        "SELECT * FROM f12_dispatch_intents WHERE status IN ('PENDING', 'CLAIMED', 'UNCERTAIN') ORDER BY created_at, intent_id",
      )
      .map(dispatchIntentFromRow);
  }

  private readBatch(batchId: string): F12ReviewBatchRecord {
    const row = this.store.read(
      "SELECT * FROM f12_review_batches WHERE batch_id = ?",
      batchId,
    );
    if (row === undefined) throw new Error("F12_REVIEW_BATCH_NOT_READABLE");
    return this.readBatchFromRow(row);
  }

  private readBatchFromRow(row: SqlRow): F12ReviewBatchRecord {
    const batchId = rowString(row, "batch_id");
    const memberRows = this.store.readAll(
      "SELECT event_version_id FROM f12_review_batch_members WHERE batch_id = ? ORDER BY created_at, event_version_id",
      batchId,
    );
    return batchFromRow(
      row,
      memberRows.map((member) => rowString(member, "event_version_id")),
    );
  }

  private readBatchInTransaction(
    transaction: PersistenceTransaction,
    batchId: string,
  ): F12ReviewBatchRecord {
    const row = transaction.get(
      "SELECT * FROM f12_review_batches WHERE batch_id = ?",
      batchId,
    );
    if (row === undefined) throw new Error("F12_REVIEW_BATCH_NOT_READABLE");
    const members = transaction.all(
      "SELECT event_version_id FROM f12_review_batch_members WHERE batch_id = ? ORDER BY created_at, event_version_id",
      batchId,
    );
    return batchFromRow(
      row,
      members.map((member) => rowString(member, "event_version_id")),
    );
  }

  private updateGenericBatchPayload(
    transaction: PersistenceTransaction,
    batchId: string,
    managedPrId: string,
    eventVersionIds: readonly string[],
    firstEligibleAt: string,
    lastEligibleAt: string,
    quietPeriodMs: number,
    updatedAt: string,
  ): void {
    const payload = {
      schemaVersion: 1,
      source: "F12_SCHEDULER",
      managedPrId,
      eventVersionIds,
      firstEligibleAt,
      lastEligibleAt,
      quietPeriodMs,
    };
    const encoded = encodeSnapshot(payload);
    transaction.run(
      "UPDATE review_batches SET schema_version = ?, payload_json = ?, payload_hash = ? WHERE batch_id = ?",
      encoded.schemaVersion,
      encoded.payload,
      encoded.payloadHash,
      batchId,
    );
    void updatedAt;
  }
}

export function f12RequestId(prefix: string): string {
  id(prefix, "request prefix");
  return `${prefix}-${randomUUID()}`;
}
