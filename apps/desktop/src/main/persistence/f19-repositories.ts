import { decodeSnapshot, encodeSnapshot } from "./codecs";
import type { PersistenceClock, SqlRow } from "./types";
import type { PersistenceStore } from "./database";
import {
  f19NotificationRecordSchema,
  f19ShutdownIntentSchema,
  type F19NotificationRecord,
  type F19ShutdownIntentRecord,
} from "../../shared/f19-native-surfaces";

export interface F19NotificationIntentInput {
  readonly record: F19NotificationRecord;
}

export interface F19NotificationUpdateInput {
  readonly record: F19NotificationRecord;
}

export interface F19ShutdownIntentInput {
  readonly record: F19ShutdownIntentRecord;
}

export interface F19NativeSurfacePersistencePort {
  readonly getNotification: (
    notificationId: string,
  ) => F19NotificationRecord | undefined;
  readonly findNotification: (input: {
    readonly outcomeKind: F19NotificationRecord["outcomeKind"];
    readonly outcomeId: string;
    readonly outcomeRevision: number;
    readonly category: F19NotificationRecord["category"];
  }) => F19NotificationRecord | undefined;
  readonly createNotificationIntent: (input: F19NotificationIntentInput) => {
    readonly created: boolean;
    readonly record: F19NotificationRecord;
  };
  readonly updateNotification: (
    input: F19NotificationUpdateInput,
  ) => F19NotificationRecord;
  readonly listPendingNotifications: () => readonly F19NotificationRecord[];
  readonly getShutdownIntent: (
    shutdownId?: string,
  ) => F19ShutdownIntentRecord | undefined;
  readonly saveShutdownIntent: (
    input: F19ShutdownIntentInput,
  ) => F19ShutdownIntentRecord;
}

function rowString(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`F19_ROW_${key}_INVALID`);
  return value;
}

function rowNumber(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new Error(`F19_ROW_${key}_INVALID`);
  return value;
}

function payloadFromRow<T>(row: SqlRow): T {
  return decodeSnapshot<T>({
    schemaVersion: 1,
    payload: rowString(row, "payload_json"),
    payloadHash: rowString(row, "payload_hash"),
  });
}

function notificationFromRow(row: SqlRow): F19NotificationRecord {
  const payload = f19NotificationRecordSchema.parse(
    payloadFromRow<unknown>(row),
  );
  if (
    payload.notificationId !== rowString(row, "notification_id") ||
    payload.state !== rowString(row, "state") ||
    payload.attemptCount !== rowNumber(row, "attempt_count") ||
    payload.reconciliationCount !== rowNumber(row, "reconciliation_count")
  )
    throw new Error("F19_NOTIFICATION_PROJECTION_MISMATCH");
  return payload;
}

function shutdownFromRow(row: SqlRow): F19ShutdownIntentRecord {
  const payload = f19ShutdownIntentSchema.parse(payloadFromRow<unknown>(row));
  if (
    payload.shutdownId !== rowString(row, "shutdown_id") ||
    payload.state !== rowString(row, "state") ||
    payload.version !== rowNumber(row, "version")
  )
    throw new Error("F19_SHUTDOWN_PROJECTION_MISMATCH");
  return payload;
}

function now(clock: PersistenceClock): string {
  return clock.now();
}

export class F19PersistenceRepositories implements F19NativeSurfacePersistencePort {
  private readonly clock: PersistenceClock;

  public constructor(
    private readonly store: PersistenceStore,
    options: { readonly clock?: PersistenceClock } = {},
  ) {
    this.clock = options.clock ?? { now: () => new Date().toISOString() };
  }

  public getNotification(
    notificationId: string,
  ): F19NotificationRecord | undefined {
    return this.store.transaction(
      (transaction) => {
        const row = transaction.get(
          "SELECT * FROM f19_notification_deliveries WHERE notification_id = ?",
          notificationId,
        );
        return row === undefined ? undefined : notificationFromRow(row);
      },
      { maxAttempts: 1 },
    );
  }

  public findNotification(input: {
    readonly outcomeKind: F19NotificationRecord["outcomeKind"];
    readonly outcomeId: string;
    readonly outcomeRevision: number;
    readonly category: F19NotificationRecord["category"];
  }): F19NotificationRecord | undefined {
    return this.store.transaction(
      (transaction) => {
        const row = transaction.get(
          "SELECT * FROM f19_notification_deliveries WHERE outcome_kind = ? AND outcome_id = ? AND outcome_revision = ? AND category = ?",
          input.outcomeKind,
          input.outcomeId,
          input.outcomeRevision,
          input.category,
        );
        return row === undefined ? undefined : notificationFromRow(row);
      },
      { maxAttempts: 1 },
    );
  }

  public createNotificationIntent(input: F19NotificationIntentInput): {
    readonly created: boolean;
    readonly record: F19NotificationRecord;
  } {
    const record = f19NotificationRecordSchema.parse(input.record);
    const encoded = encodeSnapshot(record);
    return this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT * FROM f19_notification_deliveries WHERE notification_id = ?",
        record.notificationId,
      );
      if (existing !== undefined) {
        const existingRecord = notificationFromRow(existing);
        if (existingRecord.canonicalPayloadHash !== record.canonicalPayloadHash)
          throw new Error("F19_NOTIFICATION_PAYLOAD_CONFLICT");
        return { created: false, record: existingRecord };
      }
      const byOutcome = transaction.get(
        "SELECT * FROM f19_notification_deliveries WHERE outcome_kind = ? AND outcome_id = ? AND outcome_revision = ? AND category = ?",
        record.outcomeKind,
        record.outcomeId,
        record.outcomeRevision,
        record.category,
      );
      if (byOutcome !== undefined) {
        const existingRecord = notificationFromRow(byOutcome);
        if (existingRecord.canonicalPayloadHash !== record.canonicalPayloadHash)
          throw new Error("F19_NOTIFICATION_CANONICAL_PAYLOAD_CONFLICT");
        return { created: false, record: existingRecord };
      }
      const timestamp = now(this.clock);
      transaction.run(
        "INSERT INTO f19_notification_deliveries (notification_id, outcome_id, outcome_kind, outcome_revision, managed_pr_id, operation_id, category, state, attempt_count, reconciliation_count, canonical_payload_hash, payload_json, payload_hash, correlation_id, last_reason_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        record.notificationId,
        record.outcomeId,
        record.outcomeKind,
        record.outcomeRevision,
        record.managedPrId ?? null,
        record.operationId ?? null,
        record.category,
        record.state,
        record.attemptCount,
        record.reconciliationCount,
        record.canonicalPayloadHash,
        encoded.payload,
        encoded.payloadHash,
        record.correlationId,
        record.lastReasonCode ?? null,
        timestamp,
        timestamp,
      );
      const inserted = transaction.get(
        "SELECT * FROM f19_notification_deliveries WHERE notification_id = ?",
        record.notificationId,
      );
      if (inserted === undefined)
        throw new Error("F19_NOTIFICATION_NOT_READABLE");
      return { created: true, record: notificationFromRow(inserted) };
    });
  }

  public updateNotification(
    input: F19NotificationUpdateInput,
  ): F19NotificationRecord {
    const record = f19NotificationRecordSchema.parse(input.record);
    const encoded = encodeSnapshot(record);
    return this.store.transaction((transaction) => {
      const result = transaction.run(
        "UPDATE f19_notification_deliveries SET state = ?, attempt_count = ?, reconciliation_count = ?, payload_json = ?, payload_hash = ?, canonical_payload_hash = ?, last_reason_code = ?, updated_at = ? WHERE notification_id = ?",
        record.state,
        record.attemptCount,
        record.reconciliationCount,
        encoded.payload,
        encoded.payloadHash,
        record.canonicalPayloadHash,
        record.lastReasonCode ?? null,
        now(this.clock),
        record.notificationId,
      );
      if (result.changes !== 1) throw new Error("F19_NOTIFICATION_NOT_FOUND");
      const updated = transaction.get(
        "SELECT * FROM f19_notification_deliveries WHERE notification_id = ?",
        record.notificationId,
      );
      if (updated === undefined)
        throw new Error("F19_NOTIFICATION_NOT_READABLE");
      return notificationFromRow(updated);
    });
  }

  public listPendingNotifications(): readonly F19NotificationRecord[] {
    return this.store
      .readAll(
        "SELECT * FROM f19_notification_deliveries WHERE state IN ('PENDING', 'UNKNOWN') ORDER BY updated_at ASC, notification_id ASC",
      )
      .map(notificationFromRow);
  }

  public getShutdownIntent(
    shutdownId = "application-shutdown",
  ): F19ShutdownIntentRecord | undefined {
    return this.store.transaction(
      (transaction) => {
        const row = transaction.get(
          "SELECT * FROM f19_shutdown_intents WHERE shutdown_id = ?",
          shutdownId,
        );
        return row === undefined ? undefined : shutdownFromRow(row);
      },
      { maxAttempts: 1 },
    );
  }

  public saveShutdownIntent(
    input: F19ShutdownIntentInput,
  ): F19ShutdownIntentRecord {
    const record = f19ShutdownIntentSchema.parse(input.record);
    const encoded = encodeSnapshot(record);
    return this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT * FROM f19_shutdown_intents WHERE shutdown_id = ?",
        record.shutdownId,
      );
      const timestamp = now(this.clock);
      if (existing === undefined) {
        transaction.run(
          "INSERT INTO f19_shutdown_intents (shutdown_id, command, state, correlation_id, lifecycle_correlation_id, reason_code, attempt_count, version, payload_json, payload_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          record.shutdownId,
          record.command,
          record.state,
          record.correlationId,
          record.lifecycleCorrelationId ?? null,
          record.reasonCode,
          record.attemptCount,
          record.version,
          encoded.payload,
          encoded.payloadHash,
          record.createdAt,
          timestamp,
        );
      } else {
        const current = shutdownFromRow(existing);
        if (record.version <= current.version) return current;
        const result = transaction.run(
          "UPDATE f19_shutdown_intents SET command = ?, state = ?, correlation_id = ?, lifecycle_correlation_id = ?, reason_code = ?, attempt_count = ?, version = ?, payload_json = ?, payload_hash = ?, updated_at = ? WHERE shutdown_id = ? AND version = ?",
          record.command,
          record.state,
          record.correlationId,
          record.lifecycleCorrelationId ?? null,
          record.reasonCode,
          record.attemptCount,
          record.version,
          encoded.payload,
          encoded.payloadHash,
          timestamp,
          record.shutdownId,
          current.version,
        );
        if (result.changes !== 1) throw new Error("F19_SHUTDOWN_CONFLICT");
      }
      const updated = transaction.get(
        "SELECT * FROM f19_shutdown_intents WHERE shutdown_id = ?",
        record.shutdownId,
      );
      if (updated === undefined) throw new Error("F19_SHUTDOWN_NOT_READABLE");
      return shutdownFromRow(updated);
    });
  }
}
