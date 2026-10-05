import { randomUUID } from "node:crypto";
import {
  activityEventView,
  ACTIVITY_RETENTION_MAX_AGE_DAYS,
  ACTIVITY_RETENTION_MAX_BYTES,
  ACTIVITY_RETENTION_MAX_EVENTS,
  decodeActivityCursor,
  encodeActivityCursor,
  formatWorkItemRef,
  isActivityEvent,
  normalizeActivityQuery,
  normalizeActivityEvent,
  type ActivityEventInput,
  type ActivityEventRecord,
  type ActivityQuery,
  type ActivityQuerySnapshot,
  type ActivityReasonCode,
  type ActivityRetentionPolicy,
  type ActivityRetentionState,
  type ActivitySafeDetails,
  type ActivitySeverity,
  type ActivityStage,
} from "../../shared/activity";
import type {
  PersistenceClock,
  PersistenceTransaction,
  SqlRow,
  SqlValue,
} from "./types";
import type { PersistenceStore } from "./database";
import {
  ACTIVITY_SCOPE_SQL,
  ACTIVITY_MANAGED_PR_SQL,
  ACTIVITY_OWNER_TYPE_SQL,
  ACTIVITY_OWNER_ID_SQL,
} from "./activity-scope-sql";
import { recoveryActivityAttribution } from "../../shared/recovery-attribution";

export type ActivityAppendOutcome =
  "inserted" | "replayed" | "conflict" | "rejected" | "unavailable";

export interface ActivityAppendResult {
  readonly outcome: ActivityAppendOutcome;
  readonly event?: ActivityEventRecord;
  readonly reasonCode?: string;
}

export interface ActivityRetentionResult {
  readonly status: "completed" | "failed";
  readonly deletedCount: number;
  readonly protectedCount: number;
  readonly policy: ActivityRetentionPolicy;
  readonly prunedBefore?: string;
  readonly errorCode?: string;
}

export interface ActivityRepositoryOptions {
  readonly clock?: PersistenceClock;
}

const DEFAULT_POLICY: ActivityRetentionPolicy = {
  maxAgeDays: ACTIVITY_RETENTION_MAX_AGE_DAYS,
  maxEvents: ACTIVITY_RETENTION_MAX_EVENTS,
  maxBytes: ACTIVITY_RETENTION_MAX_BYTES,
};

function rowString(row: SqlRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string")
    throw new Error(`F09_INVALID_STRING_${column}`);
  return value;
}

function rowOptionalString(row: SqlRow, column: string): string | undefined {
  const value = row[column];
  return value === null || value === undefined
    ? undefined
    : rowString(row, column);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function safeJson(value: string | undefined, fallback: unknown): unknown {
  if (value === undefined) return fallback;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}

function validSeverity(value: string): ActivitySeverity {
  return ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"].includes(value)
    ? (value as ActivitySeverity)
    : "INFO";
}

function validStage(value: string): ActivityStage {
  return [
    "SYSTEM",
    "LIFECYCLE",
    "POLLING",
    "BATCHING",
    "REVIEW",
    "AI",
    "VALIDATION",
    "NOTIFICATION",
    "SYNCHRONIZATION",
    "PUBLICATION",
    "RECOVERY",
    "RETENTION",
    "GIT",
    "WORKTREE",
  ].includes(value)
    ? (value as ActivityStage)
    : "SYSTEM";
}

function validReasonCode(value: string): ActivityReasonCode {
  const known = [
    "STARTED",
    "WAITING",
    "PROGRESS",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
    "RETRYING",
    "UNKNOWN_OUTCOME",
    "RECONCILED",
    "LIFECYCLE_STARTING",
    "LIFECYCLE_RUNNING",
    "INCOMPLETE_LIFECYCLE_HANDOFF",
    "SERVICE_START_FAILED",
    "SHUTDOWN_REQUESTED",
    "SHUTDOWN_INTENT_COMMITTED",
    "SERVICE_HANDOFF_STARTED",
    "SHUTDOWN_COMPLETE",
    "SERVICE_HANDOFF_FAILED",
    "SERVICE_STOP_FAILED",
    "SERVICE_STOP_TIMEOUT",
    "SERVICE_HANDOFF_TIMEOUT",
    "POLL_STARTED",
    "POLL_PROGRESS",
    "POLL_COMPLETED",
    "POLL_FAILED",
    "BATCH_STARTED",
    "BATCH_WAITING",
    "BATCH_COMPLETED",
    "AI_TURN_STARTED",
    "AI_TURN_COMPLETED",
    "AI_TURN_FAILED",
    "VALIDATION_STARTED",
    "VALIDATION_COMPLETED",
    "VALIDATION_FAILED",
    "NOTIFICATION_SENT",
    "NOTIFICATION_FAILED",
    "SYNC_STARTED",
    "SYNC_READY",
    "SYNC_COMPLETED",
    "SYNC_FAILED",
    "PUBLICATION_INTENT",
    "PUBLICATION_ATTEMPTED",
    "PUBLICATION_SUCCEEDED",
    "PUBLICATION_FAILED",
    "PUBLICATION_UNKNOWN_OUTCOME",
    "PUBLICATION_RECONCILED",
    "REDACTION_FAILED",
    "ACTIVITY_RETENTION_COMPLETED",
    "ACTIVITY_RETENTION_FAILED",
    "ACTIVITY_DATABASE_UNAVAILABLE",
    "UNSUPPORTED_TARGET",
    "NO_ACTION",
  ];
  return (known.includes(value) ? value : "PROGRESS") as ActivityReasonCode;
}

function validRetention(value: string | undefined): ActivityRetentionState {
  return value === "ACTIVE" || value === "USER_ACTIONABLE" ? value : "NONE";
}

function legacyEvent(row: SqlRow): ActivityEventRecord {
  const eventId = rowString(row, "activity_event_id");
  const correlationId = rowString(row, "correlation_id");
  const recordedAt =
    rowOptionalString(row, "recorded_at") || rowString(row, "created_at");
  const occurrenceAt = rowOptionalString(row, "occurrence_at") || recordedAt;
  const ownerType = rowOptionalString(row, "owner_type");
  const ownerId = rowOptionalString(row, "owner_id");
  const detailsJson = rowOptionalString(row, "details_json");
  const payloadJson = rowOptionalString(row, "payload_json");
  const legacyDetails = safeJson(
    detailsJson !== undefined && detailsJson !== "{}"
      ? detailsJson
      : payloadJson,
    {},
  );
  const input: ActivityEventInput = {
    eventId,
    eventType: "LEGACY_ACTIVITY",
    stage: validStage(rowOptionalString(row, "stage") ?? "SYSTEM"),
    correlationId,
    ...(ownerType === undefined || ownerId === undefined
      ? {}
      : { owner: { type: ownerType, id: ownerId } }),
    ...(rowOptionalString(row, "managed_pr_id") === undefined
      ? {}
      : { managedPrId: rowOptionalString(row, "managed_pr_id") }),
    occurrenceAt,
    severity: validSeverity(rowString(row, "severity")),
    reason: {
      code: validReasonCode(rowString(row, "reason_code")),
      what:
        rowOptionalString(row, "reason_what") ||
        "A legacy activity event was recorded.",
      why:
        rowOptionalString(row, "reason_why") ||
        "The event predates the structured activity contract.",
      nextAction: "NONE",
    },
    summary: rowOptionalString(row, "summary") || "Legacy activity event",
    details:
      typeof legacyDetails === "object" &&
      legacyDetails !== null &&
      !Array.isArray(legacyDetails)
        ? (legacyDetails as ActivitySafeDetails)
        : {},
    retention: validRetention(rowOptionalString(row, "retention_state")),
  };
  return normalizeActivityEvent(input, recordedAt);
}

function readEvent(row: SqlRow): ActivityEventRecord {
  const payload = safeJson(rowOptionalString(row, "payload_json"), undefined);
  if (isActivityEvent(payload)) return payload;
  return legacyEvent(row);
}

function readScopedEvent(
  row: SqlRow,
  transaction: PersistenceTransaction,
): ActivityEventRecord {
  const event = readEvent(row);
  if (
    event.operationId === undefined ||
    typeof event.details.f28Event !== "string"
  )
    return event;
  const scope = transaction.get(
    "SELECT scope_kind, scope_id, owner FROM f28_recovery_scopes WHERE scope_key = ?",
    event.operationId,
  );
  if (scope === undefined) return event;
  const attribution = recoveryActivityAttribution({
    kind: rowString(scope, "scope_kind"),
    id: rowString(scope, "scope_id"),
    owner: rowString(scope, "owner"),
  });
  const {
    owner: recordedOwner,
    managedPrId: recordedManagedPrId,
    ...recorded
  } = event;
  return {
    ...recorded,
    ...attribution,
    details: {
      ...event.details,
      ...(recordedOwner === undefined
        ? {}
        : {
            recordedOwner: { type: recordedOwner.type, id: recordedOwner.id },
          }),
      ...(recordedManagedPrId === undefined ? {} : { recordedManagedPrId }),
    },
  };
}

function workItemKey(event: ActivityEventRecord): string | null {
  return formatWorkItemRef(event.workItem) ?? null;
}

function rowSize(row: SqlRow): number {
  return [
    "payload_json",
    "details_json",
    "work_item_json",
    "related_target_json",
  ]
    .map((column) => rowOptionalString(row, column) ?? "")
    .reduce((total, value) => total + byteLength(value), 0);
}

function normalizePolicy(
  policy: Partial<ActivityRetentionPolicy> = {},
): ActivityRetentionPolicy {
  const result = {
    maxAgeDays: policy.maxAgeDays ?? DEFAULT_POLICY.maxAgeDays,
    maxEvents: policy.maxEvents ?? DEFAULT_POLICY.maxEvents,
    maxBytes: policy.maxBytes ?? DEFAULT_POLICY.maxBytes,
  };
  if (
    !Number.isSafeInteger(result.maxAgeDays) ||
    result.maxAgeDays < 1 ||
    result.maxAgeDays > 3_650 ||
    !Number.isSafeInteger(result.maxEvents) ||
    result.maxEvents < 1 ||
    result.maxEvents > ACTIVITY_RETENTION_MAX_EVENTS ||
    !Number.isSafeInteger(result.maxBytes) ||
    result.maxBytes < 1_024 ||
    result.maxBytes > ACTIVITY_RETENTION_MAX_BYTES
  )
    throw new Error("F09_INVALID_RETENTION_POLICY");
  return result;
}

export class ActivityRepository {
  private readonly clock: PersistenceClock;

  public constructor(
    private readonly store: PersistenceStore,
    options: ActivityRepositoryOptions = {},
  ) {
    this.clock = options.clock ?? { now: () => new Date().toISOString() };
  }

  public appendInTransaction(
    transaction: PersistenceTransaction,
    event: ActivityEventRecord,
    payloadHash: string,
  ): ActivityAppendResult {
    const existing = transaction.get(
      "SELECT * FROM activity_events WHERE activity_event_id = ?",
      event.eventId,
    );
    if (existing !== undefined) {
      const existingHash = rowOptionalString(existing, "payload_hash");
      const existingEvent = readEvent(existing);
      if (existingHash === payloadHash) {
        return { outcome: "replayed", event: existingEvent };
      }
      return {
        outcome: "conflict",
        event: existingEvent,
        reasonCode: "EVENT_ID_REPLAY_CONFLICT",
      };
    }
    const owner = event.owner;
    const workItemPayload =
      event.workItem === undefined ? null : JSON.stringify(event.workItem);
    const targetPayload =
      event.relatedTarget === undefined
        ? null
        : JSON.stringify(event.relatedTarget);
    const payload = JSON.stringify(event);
    const details = JSON.stringify(event.details);
    transaction.run(
      `INSERT INTO activity_events (
        activity_event_id, correlation_id, owner_type, owner_id, severity, reason_code,
        payload_json, created_at, schema_version, event_type, stage, operation_id,
        parent_event_id, causation_event_id, attempt_id, attempt_number, attempt_outcome,
        managed_pr_id, occurrence_at, recorded_at, summary, reason_what, reason_why,
        next_action, details_json, work_item_json, work_item_key, related_target_json,
        payload_hash, retention_state, owner_version, owner_revision
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?
      )`,
      event.eventId,
      event.correlationId,
      owner?.type ?? null,
      owner?.id ?? null,
      event.severity,
      event.reason.code,
      payload,
      event.recordedAt,
      event.schemaVersion,
      event.eventType,
      event.stage,
      event.operationId ?? null,
      event.parentEventId ?? null,
      event.causationEventId ?? null,
      event.attempt?.id ?? null,
      event.attempt?.number ?? null,
      event.attempt?.outcome ?? null,
      event.managedPrId ?? null,
      event.occurrenceAt,
      event.recordedAt,
      event.summary,
      event.reason.what,
      event.reason.why,
      event.reason.nextAction,
      details,
      workItemPayload,
      workItemKey(event),
      targetPayload,
      payloadHash,
      event.retention,
      owner?.version ?? null,
      owner?.revision ?? null,
    );
    return { outcome: "inserted", event };
  }

  public append(
    event: ActivityEventRecord,
    payloadHash: string,
  ): ActivityAppendResult {
    return this.store.transaction((transaction) =>
      this.appendInTransaction(transaction, event, payloadHash),
    );
  }

  public get(eventId: string): ActivityEventRecord | undefined {
    return this.store.transaction(
      (transaction) => {
        const row = transaction.get(
          "SELECT * FROM activity_events WHERE activity_event_id = ?",
          eventId,
        );
        return row === undefined
          ? undefined
          : readScopedEvent(row, transaction);
      },
      { maxAttempts: 1 },
    );
  }

  public query(input: ActivityQuery = {}): ActivityQuerySnapshot {
    const query = normalizeActivityQuery(input);
    return this.store.transaction(
      (transaction) => {
        const conditions: string[] = [];
        const parameters: SqlValue[] = [];
        const add = (condition: string, ...values: SqlValue[]): void => {
          conditions.push(condition);
          parameters.push(...values);
        };
        if (query.view !== undefined && query.view !== "ALL")
          add(`(${ACTIVITY_SCOPE_SQL}) = ?`, query.view);
        if (query.managedPrId !== undefined)
          add(`(${ACTIVITY_MANAGED_PR_SQL}) = ?`, query.managedPrId);
        if (query.ownerType !== undefined)
          add(`(${ACTIVITY_OWNER_TYPE_SQL}) = ?`, query.ownerType);
        if (query.ownerId !== undefined)
          add(`(${ACTIVITY_OWNER_ID_SQL}) = ?`, query.ownerId);
        if (query.operationId !== undefined)
          add("operation_id = ?", query.operationId);
        if (query.correlationId !== undefined)
          add("correlation_id = ?", query.correlationId);
        if (query.workItemKey !== undefined)
          add("work_item_key = ?", query.workItemKey);
        if (query.severity !== undefined) add("severity = ?", query.severity);
        if (query.reasonCode !== undefined)
          add("reason_code = ?", query.reasonCode);
        if (query.stage !== undefined) add("stage = ?", query.stage);
        if (query.from !== undefined) add("recorded_at >= ?", query.from);
        if (query.to !== undefined) add("recorded_at <= ?", query.to);
        if (query.cursor !== undefined) {
          const cursor = decodeActivityCursor(query.cursor);
          if (cursor.direction !== query.direction)
            throw new Error("F09_CURSOR_DIRECTION_CONFLICT");
          if (query.direction === "desc")
            add(
              "(recorded_at < ? OR (recorded_at = ? AND activity_event_id < ?))",
              cursor.recordedAt,
              cursor.recordedAt,
              cursor.eventId,
            );
          else
            add(
              "(recorded_at > ? OR (recorded_at = ? AND activity_event_id > ?))",
              cursor.recordedAt,
              cursor.recordedAt,
              cursor.eventId,
            );
        }
        const limit = query.limit ?? 50;
        const rows = transaction.all(
          `SELECT * FROM activity_events${conditions.length === 0 ? "" : ` WHERE ${conditions.join(" AND ")}`} ORDER BY recorded_at ${query.direction === "asc" ? "ASC" : "DESC"}, activity_event_id ${query.direction === "asc" ? "ASC" : "DESC"} LIMIT ?`,
          ...parameters,
          limit + 1,
        );
        const hasMore = rows.length > limit;
        const page = rows
          .slice(0, limit)
          .map((row) => activityEventView(readScopedEvent(row, transaction)));
        const last = page[page.length - 1];
        const nextCursor =
          hasMore && last !== undefined
            ? encodeActivityCursor({
                recordedAt: last.recordedAt,
                eventId: last.eventId,
                direction: query.direction ?? "desc",
              })
            : undefined;
        const retention = this.readRetentionSummary(transaction);
        return {
          schemaVersion: 1,
          kind: "activity-query",
          generatedAt: this.clock.now(),
          query,
          events: page,
          ...(nextCursor === undefined ? {} : { nextCursor }),
          hasMore,
          retention,
        } satisfies ActivityQuerySnapshot;
      },
      { maxAttempts: 1 },
    );
  }

  public retain(
    policyInput: Partial<ActivityRetentionPolicy> = {},
  ): ActivityRetentionResult {
    const policy = normalizePolicy(policyInput);
    const startedAt = this.clock.now();
    const result = this.store.transaction((transaction) => {
      const rows = transaction.all(
        "SELECT * FROM activity_events ORDER BY recorded_at ASC, activity_event_id ASC",
      );
      const protectedCount = rows.filter(
        (row) =>
          validRetention(rowOptionalString(row, "retention_state")) !== "NONE",
      ).length;
      const cutoff = new Date(
        Date.parse(startedAt) - policy.maxAgeDays * 24 * 60 * 60 * 1_000,
      ).toISOString();
      let totalBytes = rows.reduce((total, row) => total + rowSize(row), 0);
      let remaining = rows.length;
      const deleted: string[] = [];
      let deletedBytes = 0;
      for (const row of rows) {
        const protectedRow =
          validRetention(rowOptionalString(row, "retention_state")) !== "NONE";
        const recordedAt =
          rowOptionalString(row, "recorded_at") || rowString(row, "created_at");
        const ageExceeded = recordedAt < cutoff;
        const countExceeded = remaining > policy.maxEvents;
        const sizeExceeded = totalBytes > policy.maxBytes;
        if (protectedRow || (!ageExceeded && !countExceeded && !sizeExceeded))
          continue;
        const id = rowString(row, "activity_event_id");
        transaction.run(
          "DELETE FROM activity_events WHERE activity_event_id = ?",
          id,
        );
        deleted.push(id);
        const size = rowSize(row);
        remaining -= 1;
        totalBytes -= size;
        deletedBytes += size;
      }
      const retentionRunId = `retention-${randomUUID()}`;
      const payload = JSON.stringify({
        policy,
        prunedBefore: deleted.length === 0 ? undefined : cutoff,
        deletedBytes,
        deletedCount: deleted.length,
      });
      transaction.run(
        "INSERT INTO activity_retention_runs (retention_run_id, started_at, completed_at, status, deleted_count, protected_count, payload_json) VALUES (?, ?, ?, 'COMPLETED', ?, ?, ?)",
        retentionRunId,
        startedAt,
        this.clock.now(),
        deleted.length,
        protectedCount,
        payload,
      );
      return {
        status: "completed" as const,
        deletedCount: deleted.length,
        protectedCount,
        policy,
        ...(deleted.length === 0 ? {} : { prunedBefore: cutoff }),
      };
    });
    return result;
  }

  private readRetentionSummary(transaction: PersistenceTransaction) {
    const row = transaction.get(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN retention_state <> 'NONE' THEN 1 ELSE 0 END) AS protected_count, MIN(recorded_at) AS oldest_recorded_at FROM activity_events",
    );
    const latest = transaction.get(
      "SELECT completed_at, payload_json FROM activity_retention_runs ORDER BY started_at DESC, retention_run_id DESC LIMIT 1",
    );
    const payload = safeJson(
      rowOptionalString(latest ?? {}, "payload_json"),
      {},
    ) as Record<string, unknown>;
    const policy =
      (payload.policy as ActivityRetentionPolicy | undefined) ?? DEFAULT_POLICY;
    return {
      policy,
      deletedCount:
        typeof payload.deletedCount === "number" ? payload.deletedCount : 0,
      protectedCount:
        typeof row?.protected_count === "number" ? row.protected_count : 0,
      ...(rowOptionalString(row ?? {}, "oldest_recorded_at") === undefined
        ? {}
        : {
            oldestRecordedAt: rowOptionalString(
              row ?? {},
              "oldest_recorded_at",
            ),
          }),
      ...(typeof payload.prunedBefore === "string"
        ? { prunedBefore: payload.prunedBefore }
        : {}),
      ...(rowOptionalString(latest ?? {}, "completed_at") === undefined
        ? {}
        : { lastRunAt: rowOptionalString(latest ?? {}, "completed_at") }),
    };
  }
}
