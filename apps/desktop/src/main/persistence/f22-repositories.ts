import {
  assertBoundedIdentifier,
  decodeSnapshot,
  encodeSnapshot,
} from "./codecs";
import type { PersistenceStore } from "./database";
import type { PersistenceTransaction, SqlRow } from "./types";
import { PersistenceError } from "./types";
import {
  f22ActionIntentSchema,
  f22BundleStateRecordSchema,
  type F22ActionIntent,
  type F22BundleStateRecord,
} from "../../shared/f22-discard-reevaluation";

function rowString(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`F22_INVALID_ROW_${key}`);
  return value;
}

function rowNumber(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number") throw new Error(`F22_INVALID_ROW_${key}`);
  return value;
}

function error(
  store: PersistenceStore,
  code: "CONFLICT" | "NOT_FOUND" | "INVALID_RECORD" | "DUPLICATE",
  what: string,
): PersistenceError {
  return new PersistenceError({
    code,
    stage: "health_record",
    what,
    why: "F22 durable action and stale-state records must be bounded, scoped, and idempotent.",
    nextAction: code === "CONFLICT" ? "RECONCILE" : "FIX_INPUT",
    correlationId: store.health.correlationId,
    databaseId: store.health.databaseId,
    details: {},
  });
}

function decodeBundle(row: SqlRow): F22BundleStateRecord {
  const payload = decodeSnapshot<F22BundleStateRecord>(
    {
      schemaVersion: rowNumber(row, "payload_schema_version"),
      payload: rowString(row, "payload_json"),
      payloadHash: rowString(row, "payload_hash"),
    },
    1,
  );
  return f22BundleStateRecordSchema.parse(payload);
}

function decodeAction(row: SqlRow): F22ActionIntent {
  const payload = decodeSnapshot<F22ActionIntent>(
    {
      schemaVersion: rowNumber(row, "payload_schema_version"),
      payload: rowString(row, "payload_json"),
      payloadHash: rowString(row, "payload_hash"),
    },
    1,
  );
  return f22ActionIntentSchema.parse(payload);
}

export interface F22PersistencePort {
  readonly getBundleState: (
    bundleId: string,
  ) => F22BundleStateRecord | undefined;
  readonly listBundleStates: (
    managedPrId: string,
  ) => readonly F22BundleStateRecord[];
  readonly putBundleState: (input: {
    readonly state: F22BundleStateRecord;
    readonly expectedRevision?: number;
  }) => F22BundleStateRecord;
  readonly getAction: (actionId: string) => F22ActionIntent | undefined;
  readonly getActionByIdempotency: (
    idempotencyKey: string,
  ) => F22ActionIntent | undefined;
  readonly persistActionIntent: (input: F22ActionIntent) => F22ActionIntent;
  readonly updateAction: (input: {
    readonly action: F22ActionIntent;
    readonly expectedVersion?: number;
  }) => F22ActionIntent;
  readonly listPendingActions: () => readonly F22ActionIntent[];
}

export class F22PersistenceRepositories implements F22PersistencePort {
  public constructor(private readonly store: PersistenceStore) {}

  private id(value: string, label: string): void {
    assertBoundedIdentifier(value, label);
  }

  private readBundle(transaction: PersistenceTransaction, bundleId: string) {
    const row = transaction.get(
      "SELECT * FROM f22_bundle_states WHERE bundle_id = ?",
      bundleId,
    );
    return row === undefined ? undefined : decodeBundle(row);
  }

  private readAction(transaction: PersistenceTransaction, actionId: string) {
    const row = transaction.get(
      "SELECT * FROM f22_action_intents WHERE action_id = ?",
      actionId,
    );
    return row === undefined ? undefined : decodeAction(row);
  }

  public getBundleState(bundleId: string): F22BundleStateRecord | undefined {
    this.id(bundleId, "F22 bundle identifier");
    const row = this.store.read(
      "SELECT * FROM f22_bundle_states WHERE bundle_id = ?",
      bundleId,
    );
    return row === undefined ? undefined : decodeBundle(row);
  }

  public listBundleStates(
    managedPrId: string,
  ): readonly F22BundleStateRecord[] {
    this.id(managedPrId, "F22 managed PR identifier");
    return this.store
      .readAll(
        "SELECT * FROM f22_bundle_states WHERE managed_pr_id = ? ORDER BY updated_at, bundle_id",
        managedPrId,
      )
      .map(decodeBundle);
  }

  public putBundleState(input: {
    readonly state: F22BundleStateRecord;
    readonly expectedRevision?: number;
  }): F22BundleStateRecord {
    const state = f22BundleStateRecordSchema.parse(input.state);
    this.id(state.bundleId, "F22 bundle identifier");
    this.id(state.managedPrId, "F22 managed PR identifier");
    const encoded = encodeSnapshot(state, 1);
    return this.store.transaction((transaction) => {
      const existingRow = transaction.get(
        "SELECT * FROM f22_bundle_states WHERE bundle_id = ?",
        state.bundleId,
      );
      if (existingRow === undefined) {
        if (state.revision !== 0)
          throw error(
            this.store,
            "CONFLICT",
            "The first F22 bundle state must start at revision zero.",
          );
        const createdAt = state.updatedAt;
        transaction.run(
          "INSERT INTO f22_bundle_states (bundle_id, managed_pr_id, status, revision, bundle_revision, payload_schema_version, payload_json, payload_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          state.bundleId,
          state.managedPrId,
          state.status,
          state.revision,
          state.bundleRevision,
          encoded.schemaVersion,
          encoded.payload,
          encoded.payloadHash,
          createdAt,
          state.updatedAt,
        );
        return state;
      }
      const existing = decodeBundle(existingRow);
      if (existing.managedPrId !== state.managedPrId)
        throw error(
          this.store,
          "CONFLICT",
          "The F22 bundle identifier belongs to another managed pull request.",
        );
      if (
        existing.revision === state.revision &&
        existing.updatedAt === state.updatedAt &&
        existing.status === state.status
      )
        return existing;
      if (
        input.expectedRevision !== undefined &&
        existing.revision !== input.expectedRevision
      )
        throw error(
          this.store,
          "CONFLICT",
          "The F22 state changed before this transition was committed.",
        );
      if (state.revision !== existing.revision + 1)
        throw error(
          this.store,
          "CONFLICT",
          "F22 state revisions must advance monotonically by one.",
        );
      transaction.run(
        "UPDATE f22_bundle_states SET status = ?, revision = ?, bundle_revision = ?, payload_schema_version = ?, payload_json = ?, payload_hash = ?, updated_at = ? WHERE bundle_id = ? AND revision = ?",
        state.status,
        state.revision,
        state.bundleRevision,
        encoded.schemaVersion,
        encoded.payload,
        encoded.payloadHash,
        state.updatedAt,
        state.bundleId,
        existing.revision,
      );
      const updated = this.readBundle(transaction, state.bundleId);
      if (updated === undefined) throw new Error("F22_BUNDLE_NOT_READABLE");
      return updated;
    });
  }

  public getAction(actionId: string): F22ActionIntent | undefined {
    this.id(actionId, "F22 action identifier");
    const row = this.store.read(
      "SELECT * FROM f22_action_intents WHERE action_id = ?",
      actionId,
    );
    return row === undefined ? undefined : decodeAction(row);
  }

  public getActionByIdempotency(
    idempotencyKey: string,
  ): F22ActionIntent | undefined {
    this.id(idempotencyKey, "F22 idempotency key");
    const row = this.store.read(
      "SELECT * FROM f22_action_intents WHERE idempotency_key = ?",
      idempotencyKey,
    );
    return row === undefined ? undefined : decodeAction(row);
  }

  public persistActionIntent(input: F22ActionIntent): F22ActionIntent {
    const action = f22ActionIntentSchema.parse(input);
    this.id(action.actionId, "F22 action identifier");
    this.id(action.idempotencyKey, "F22 idempotency key");
    const encoded = encodeSnapshot(action, 1);
    return this.store.transaction((transaction) => {
      const existingByKey = transaction.get(
        "SELECT * FROM f22_action_intents WHERE idempotency_key = ?",
        action.idempotencyKey,
      );
      if (existingByKey !== undefined) {
        const existing = decodeAction(existingByKey);
        if (existing.actionId !== action.actionId)
          throw error(
            this.store,
            "DUPLICATE",
            "The F22 idempotency key is already owned by another action.",
          );
        return existing;
      }
      const existingById = transaction.get(
        "SELECT * FROM f22_action_intents WHERE action_id = ?",
        action.actionId,
      );
      if (existingById !== undefined) return decodeAction(existingById);
      transaction.run(
        "INSERT INTO f22_action_intents (action_id, idempotency_key, bundle_id, managed_pr_id, action, phase, status, version, payload_schema_version, payload_json, payload_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        action.actionId,
        action.idempotencyKey,
        action.bundleId,
        action.managedPrId,
        action.action,
        action.phase,
        action.status,
        action.version,
        encoded.schemaVersion,
        encoded.payload,
        encoded.payloadHash,
        action.createdAt,
        action.updatedAt,
      );
      return action;
    });
  }

  public updateAction(input: {
    readonly action: F22ActionIntent;
    readonly expectedVersion?: number;
  }): F22ActionIntent {
    const action = f22ActionIntentSchema.parse(input.action);
    const encoded = encodeSnapshot(action, 1);
    return this.store.transaction((transaction) => {
      const row = transaction.get(
        "SELECT * FROM f22_action_intents WHERE action_id = ?",
        action.actionId,
      );
      if (row === undefined)
        throw error(this.store, "NOT_FOUND", "The F22 action does not exist.");
      const existing = decodeAction(row);
      if (
        input.expectedVersion !== undefined &&
        existing.version !== input.expectedVersion
      )
        throw error(
          this.store,
          "CONFLICT",
          "The F22 action changed before this transition was committed.",
        );
      if (action.version !== existing.version + 1)
        throw error(
          this.store,
          "CONFLICT",
          "F22 action versions must advance monotonically by one.",
        );
      transaction.run(
        "UPDATE f22_action_intents SET phase = ?, status = ?, version = ?, payload_schema_version = ?, payload_json = ?, payload_hash = ?, updated_at = ? WHERE action_id = ? AND version = ?",
        action.phase,
        action.status,
        action.version,
        encoded.schemaVersion,
        encoded.payload,
        encoded.payloadHash,
        action.updatedAt,
        action.actionId,
        existing.version,
      );
      const updated = this.readAction(transaction, action.actionId);
      if (updated === undefined) throw new Error("F22_ACTION_NOT_READABLE");
      return updated;
    });
  }

  public listPendingActions(): readonly F22ActionIntent[] {
    return this.store
      .readAll(
        "SELECT * FROM f22_action_intents WHERE status IN ('PENDING', 'UNKNOWN') ORDER BY created_at, action_id",
      )
      .map(decodeAction);
  }
}
