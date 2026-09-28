import {
  assertBoundedIdentifier,
  assertBoundedText,
  decodeSnapshot,
  encodeSnapshot,
} from "./codecs";
import type { PersistenceClock, SqlRow } from "./types";
import { PersistenceError } from "./types";
import type { PersistenceStore } from "./database";
import {
  isF24PreparationIntent,
  type F24HandoffRecord,
  type F24HandoffStatus,
  type F24PreparationIntent,
  type F24PreparationIntentSnapshot,
  type F24Reason,
} from "../../shared/f24-synchronization";

export interface F24PersistIntentInput {
  readonly snapshot: F24PreparationIntentSnapshot;
  readonly handoff: F24HandoffRecord;
}

export interface F24HandoffUpdateInput {
  readonly intentId: string;
  readonly status: F24HandoffStatus;
  readonly authorizationId?: string;
  readonly reason?: F24Reason;
  readonly expectedVersion?: number;
}

function now(clock: PersistenceClock): string {
  const value = clock.now();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
    throw new Error("F24_CLOCK_MUST_RETURN_UTC_MILLISECONDS");
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
  if (typeof value !== "string") throw new Error(`F24_INVALID_ROW_${key}`);
  return value;
}

function rowOptionalString(row: SqlRow, key: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`F24_INVALID_ROW_${key}`);
  return value;
}

function rowNumber(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number") throw new Error(`F24_INVALID_ROW_${key}`);
  return value;
}

function reasonJson(reason: F24Reason | undefined): string | null {
  return reason === undefined ? null : JSON.stringify(reason);
}

function parseReason(row: SqlRow): F24Reason | undefined {
  const value = rowOptionalString(row, "handoff_reason_json");
  if (value === undefined) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isReasonLike(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isReasonLike(value: unknown): value is F24Reason {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.category === "string" &&
    typeof candidate.what === "string" &&
    typeof candidate.why === "string" &&
    typeof candidate.nextAction === "string" &&
    typeof candidate.retryable === "boolean" &&
    typeof candidate.correlationId === "string"
  );
}

function snapshotFromRow(row: SqlRow): F24PreparationIntentSnapshot {
  return decodeSnapshot<F24PreparationIntentSnapshot>(
    {
      schemaVersion: rowNumber(row, "snapshot_schema_version"),
      payload: rowString(row, "snapshot_json"),
      payloadHash: rowString(row, "snapshot_hash"),
    },
    rowNumber(row, "snapshot_schema_version"),
  );
}

function intentFromRow(row: SqlRow): F24PreparationIntent {
  const snapshot = snapshotFromRow(row);
  const handoff: F24HandoffRecord = {
    status: rowString(row, "handoff_status") as F24HandoffStatus,
    authorizationId: rowString(row, "authorization_id"),
    ...(parseReason(row) === undefined ? {} : { reason: parseReason(row) }),
    updatedAt: rowString(row, "updated_at"),
  };
  const intent: F24PreparationIntent = {
    schemaVersion: 1,
    kind: "synchronization-preparation-intent",
    snapshot,
    handoff,
    version: rowNumber(row, "version"),
    updatedAt: rowString(row, "updated_at"),
  };
  if (!isF24PreparationIntent(intent))
    throw new Error("F24_PERSISTED_INTENT_INVALID");
  return intent;
}

function repositoryError(
  store: PersistenceStore,
  code: "CONFLICT" | "NOT_FOUND" | "INVALID_RECORD",
  what: string,
): PersistenceError {
  return new PersistenceError({
    code,
    stage: "health_record",
    what,
    why: "The F24 persistence boundary preserves immutable synchronization inputs and refuses stale or duplicate handoffs.",
    nextAction: code === "CONFLICT" ? "RECONCILE" : "FIX_INPUT",
    correlationId: "f24-persistence",
    databaseId: store.health.databaseId,
    details: {},
  });
}

export class F24PersistenceRepositories {
  private readonly clock: PersistenceClock;

  public constructor(
    private readonly store: PersistenceStore,
    options: { readonly clock?: PersistenceClock } = {},
  ) {
    this.clock = options.clock ?? { now: () => new Date().toISOString() };
  }

  public persistIntent(input: F24PersistIntentInput): F24PreparationIntent {
    const snapshot = input.snapshot;
    id(snapshot.intentId, "F24 intent identifier");
    id(snapshot.idempotencyKey, "F24 idempotency key");
    id(snapshot.scopeKey, "F24 scope key");
    id(snapshot.resolutionRevision, "F24 resolution revision");
    id(input.handoff.authorizationId, "F24 authorization identifier");
    text(snapshot.correlationId, "F24 correlation identifier");
    const encoded = encodeSnapshot(snapshot);
    const timestamp = now(this.clock);
    return this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT * FROM f24_preparation_intents WHERE intent_id = ? OR idempotency_key = ? LIMIT 1",
        snapshot.intentId,
        snapshot.idempotencyKey,
      );
      if (existing !== undefined) {
        const existingSnapshot = snapshotFromRow(existing);
        if (
          rowString(existing, "snapshot_hash") !== encoded.payloadHash ||
          existingSnapshot.scopeKey !== snapshot.scopeKey
        )
          throw repositoryError(
            this.store,
            "CONFLICT",
            "A different synchronization preparation already owns this confirmation identity.",
          );
        return intentFromRow(existing);
      }
      const active = transaction.get(
        "SELECT intent_id FROM f24_preparation_intents WHERE scope_key = ? AND handoff_status IN ('PENDING', 'ACKNOWLEDGED', 'UNCERTAIN') LIMIT 1",
        snapshot.scopeKey,
      );
      if (active !== undefined)
        throw repositoryError(
          this.store,
          "CONFLICT",
          "Another synchronization preparation for this PR scope is still recoverable.",
        );
      transaction.run(
        "INSERT INTO f24_preparation_intents (intent_id, idempotency_key, scope_key, resolution_revision, snapshot_schema_version, snapshot_json, snapshot_hash, handoff_status, authorization_id, handoff_reason_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
        snapshot.intentId,
        snapshot.idempotencyKey,
        snapshot.scopeKey,
        snapshot.resolutionRevision,
        encoded.schemaVersion,
        encoded.payload,
        encoded.payloadHash,
        input.handoff.status,
        input.handoff.authorizationId,
        reasonJson(input.handoff.reason),
        timestamp,
        timestamp,
      );
      const inserted = transaction.get(
        "SELECT * FROM f24_preparation_intents WHERE intent_id = ?",
        snapshot.intentId,
      );
      if (inserted === undefined) throw new Error("F24_INTENT_NOT_READABLE");
      return intentFromRow(inserted);
    });
  }

  public getPreparationIntent(
    intentId: string,
  ): F24PreparationIntent | undefined {
    id(intentId, "F24 intent identifier");
    const row = this.store.read(
      "SELECT * FROM f24_preparation_intents WHERE intent_id = ?",
      intentId,
    );
    return row === undefined ? undefined : intentFromRow(row);
  }

  public getPreparationIntentByIdempotencyKey(
    idempotencyKey: string,
  ): F24PreparationIntent | undefined {
    id(idempotencyKey, "F24 idempotency key");
    const row = this.store.read(
      "SELECT * FROM f24_preparation_intents WHERE idempotency_key = ?",
      idempotencyKey,
    );
    return row === undefined ? undefined : intentFromRow(row);
  }

  public listPreparationIntents(): readonly F24PreparationIntent[] {
    return this.store
      .readAll(
        "SELECT * FROM f24_preparation_intents ORDER BY updated_at DESC, intent_id ASC LIMIT 250",
      )
      .map((row) => intentFromRow(row));
  }

  public updateHandoff(input: F24HandoffUpdateInput): F24PreparationIntent {
    id(input.intentId, "F24 intent identifier");
    if (input.authorizationId !== undefined)
      id(input.authorizationId, "F24 authorization identifier");
    const timestamp = now(this.clock);
    return this.store.transaction((transaction) => {
      const current = transaction.get(
        "SELECT * FROM f24_preparation_intents WHERE intent_id = ?",
        input.intentId,
      );
      if (current === undefined)
        throw repositoryError(
          this.store,
          "NOT_FOUND",
          "The synchronization preparation intent no longer exists.",
        );
      const currentVersion = rowNumber(current, "version");
      if (
        input.expectedVersion !== undefined &&
        input.expectedVersion !== currentVersion
      )
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The synchronization preparation handoff changed before its outcome was recorded.",
        );
      transaction.run(
        "UPDATE f24_preparation_intents SET handoff_status = ?, authorization_id = COALESCE(?, authorization_id), handoff_reason_json = ?, version = version + 1, updated_at = ? WHERE intent_id = ? AND version = ?",
        input.status,
        input.authorizationId ?? null,
        reasonJson(input.reason),
        timestamp,
        input.intentId,
        currentVersion,
      );
      const updated = transaction.get(
        "SELECT * FROM f24_preparation_intents WHERE intent_id = ?",
        input.intentId,
      );
      if (updated === undefined) throw new Error("F24_INTENT_NOT_READABLE");
      return intentFromRow(updated);
    });
  }
}
