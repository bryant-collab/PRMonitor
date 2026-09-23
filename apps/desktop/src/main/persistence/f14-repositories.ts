import { createHash } from "node:crypto";
import {
  decodeSnapshot,
  encodeSnapshot,
  assertBoundedIdentifier,
  assertBoundedText,
} from "./codecs";
import { PersistenceError } from "./types";
import type { PersistenceStore } from "./database";
import type { PersistenceClock, PersistenceTransaction, SqlRow } from "./types";
import type {
  ManualAttestation,
  ValidationPhase,
  ValidationResolution,
  ValidationRunEvidence,
  ValidationSnapshot,
  ValidationWarning,
} from "@prmonitor/validation-contract";
import { validateValidationSnapshot } from "@prmonitor/validation-contract";

export type F14Consumer = "review" | "synchronization";
export type F14RunStatus = ValidationRunEvidence["status"];

export interface F14ValidationRunInput {
  readonly runId: string;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly consumer: F14Consumer;
  readonly requestedPhase: ValidationPhase;
  readonly resolutionStatus: ValidationResolution["status"];
  readonly snapshot?: ValidationSnapshot;
  readonly evidence: ValidationRunEvidence;
  readonly nextAction: string;
}

export interface F14ValidationRunRecord {
  readonly runId: string;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly consumer: F14Consumer;
  readonly requestedPhase: ValidationPhase;
  readonly resolutionStatus: ValidationResolution["status"];
  readonly snapshot?: ValidationSnapshot;
  readonly snapshotHash?: string;
  readonly evidence: ValidationRunEvidence;
  readonly status: F14RunStatus;
  readonly warnings: readonly ValidationWarning[];
  readonly nextAction: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface F14RunWriteInput {
  readonly runId: string;
  readonly evidence: ValidationRunEvidence;
  readonly nextAction: string;
  readonly expectedVersion?: number;
}

export interface F14ManualAttestationWriteInput {
  readonly runId: string;
  readonly attestation: ManualAttestation;
  readonly evidence: ValidationRunEvidence;
  readonly nextAction: string;
  readonly expectedVersion?: number;
}

function now(clock: PersistenceClock): string {
  return clock.now();
}

function id(value: string, label: string): void {
  assertBoundedIdentifier(value, label);
}

function text(value: string, label: string): void {
  assertBoundedText(value, label);
}

function rowString(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`F14_INVALID_ROW_${key}`);
  return value;
}

function rowOptionalString(row: SqlRow, key: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`F14_INVALID_ROW_${key}`);
  return value;
}

function rowNumber(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number") throw new Error(`F14_INVALID_ROW_${key}`);
  return value;
}

function repositoryError(
  store: PersistenceStore,
  code: "CONFLICT" | "NOT_FOUND" | "INVALID_RECORD" | "SECURITY_VIOLATION",
  what: string,
): PersistenceError {
  return new PersistenceError({
    code,
    stage: "health_record",
    what,
    why:
      code === "CONFLICT"
        ? "The validation operation changed or is already owned by a different durable request."
        : "The requested validation record cannot be used safely.",
    nextAction: code === "CONFLICT" ? "RECONCILE" : "FIX_INPUT",
    correlationId: store.health.correlationId,
    databaseId: store.health.databaseId,
    details: {},
  });
}

/**
 * `encodeSnapshot` intentionally rejects credential-shaped object keys.  An
 * F00 authorization reference is not a credential, but its field name must
 * still not be mistaken for a secret-bearing persistence field.  The compact
 * `authRef` projection preserves the complete provider-neutral value while
 * keeping the SQLite codec's fail-closed secret policy intact.
 */
function snapshotProjection(
  snapshot: ValidationSnapshot,
): Record<string, unknown> {
  return {
    schemaVersion: snapshot.schemaVersion,
    snapshotId: snapshot.snapshotId,
    createdAt: snapshot.createdAt,
    profile: snapshot.profile,
    source: snapshot.source,
    repositoryIdentity: snapshot.repositoryIdentity,
    contentHash: snapshot.contentHash,
    authRef: {
      kind: snapshot.authorization.authorizationType,
      referenceId: snapshot.authorization.id,
    },
    worktree: snapshot.worktree,
    effectiveLimits: snapshot.effectiveLimits,
  };
}

function restoreSnapshot(projection: unknown): ValidationSnapshot {
  if (
    typeof projection !== "object" ||
    projection === null ||
    Array.isArray(projection)
  ) {
    throw new Error("F14_INVALID_SNAPSHOT_PROJECTION");
  }
  const value = projection as Record<string, unknown>;
  const authRef = value.authRef;
  if (
    typeof authRef !== "object" ||
    authRef === null ||
    Array.isArray(authRef)
  ) {
    throw new Error("F14_INVALID_SNAPSHOT_PROJECTION");
  }
  const auth = authRef as Record<string, unknown>;
  const snapshot: Record<string, unknown> = {
    ...value,
    authorization: {
      authorizationType: auth.kind,
      id: auth.referenceId,
    },
  };
  delete snapshot.authRef;
  const validated = validateValidationSnapshot(snapshot);
  if (!validated.ok) throw new Error("F14_INVALID_SNAPSHOT_PROJECTION");
  return validated.snapshot;
}

function runEvidenceHash(
  evidence: ValidationRunEvidence,
): ReturnType<typeof encodeSnapshot> {
  return encodeSnapshot(evidence);
}

function snapshotEncoded(
  snapshot: ValidationSnapshot | undefined,
): ReturnType<typeof encodeSnapshot> {
  return encodeSnapshot(
    snapshot === undefined ? {} : snapshotProjection(snapshot),
  );
}

function warningEncoded(
  warnings: readonly ValidationWarning[],
): ReturnType<typeof encodeSnapshot> {
  return encodeSnapshot(warnings);
}

function warningId(runId: string, code: string): string {
  return `f14-warning-${createHash("sha256")
    .update(`${runId}\n${code}`, "utf8")
    .digest("hex")
    .slice(0, 32)}`;
}

function recordFingerprint(input: F14ValidationRunInput): string {
  return JSON.stringify({
    operationId: input.operationId,
    idempotencyKey: input.idempotencyKey,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    consumer: input.consumer,
    requestedPhase: input.requestedPhase,
    resolutionStatus: input.resolutionStatus,
    snapshotHash: input.snapshot?.contentHash,
  });
}

function safeResolutionStatus(value: string): ValidationResolution["status"] {
  if (
    value === "ready" ||
    value === "unavailable" ||
    value === "confirmation_required" ||
    value === "invalid"
  ) {
    return value;
  }
  throw new Error("F14_INVALID_RESOLUTION_STATUS");
}

function decodeEvidence(row: SqlRow): ValidationRunEvidence {
  return decodeSnapshot<ValidationRunEvidence>(
    {
      schemaVersion: 1,
      payload: rowString(row, "evidence_json"),
      payloadHash: rowString(row, "evidence_hash"),
    },
    1,
  );
}

function decodeWarningList(row: SqlRow): ValidationWarning[] {
  const warningJson = rowString(row, "warning_json");
  if (warningJson === "{}") return [];
  return decodeSnapshot<ValidationWarning[]>(
    {
      schemaVersion: 1,
      payload: warningJson,
      payloadHash: rowString(row, "warning_hash"),
    },
    1,
  );
}

export class F14ValidationRepositories {
  private readonly clock: PersistenceClock;

  public constructor(
    private readonly store: PersistenceStore,
    options: { readonly clock?: PersistenceClock } = {},
  ) {
    this.clock = options.clock ?? { now: () => new Date().toISOString() };
  }

  public getRun(runId: string): F14ValidationRunRecord | undefined {
    id(runId, "validation run identifier");
    return this.store.transaction(
      (transaction) => {
        const metadata = transaction.get(
          "SELECT * FROM f14_validation_run_metadata WHERE run_id = ?",
          runId,
        );
        if (metadata === undefined) return undefined;
        const base = transaction.get(
          "SELECT * FROM validation_runs WHERE run_id = ?",
          runId,
        );
        if (base === undefined) throw new Error("F14_BASE_RUN_MISSING");
        const snapshotId = rowOptionalString(metadata, "snapshot_id");
        let snapshot: ValidationSnapshot | undefined;
        if (snapshotId !== undefined) {
          const snapshotRow = transaction.get(
            "SELECT snapshot_projection_json, snapshot_hash FROM f14_validation_snapshots WHERE snapshot_id = ?",
            snapshotId,
          );
          if (snapshotRow === undefined)
            throw new Error("F14_SNAPSHOT_MISSING");
          const projection = decodeSnapshot<Record<string, unknown>>(
            {
              schemaVersion: 1,
              payload: rowString(snapshotRow, "snapshot_projection_json"),
              payloadHash: rowString(snapshotRow, "snapshot_hash"),
            },
            1,
          );
          snapshot = restoreSnapshot(projection);
        }
        const evidence = decodeEvidence(base);
        return {
          runId,
          operationId: rowString(metadata, "operation_id"),
          idempotencyKey: rowString(metadata, "idempotency_key"),
          correlationId: rowString(metadata, "correlation_id"),
          ownerType: rowString(metadata, "owner_type"),
          ownerId: rowString(metadata, "owner_id"),
          consumer: rowString(metadata, "consumer") as F14Consumer,
          requestedPhase: rowString(
            metadata,
            "requested_phase",
          ) as ValidationPhase,
          resolutionStatus: safeResolutionStatus(
            rowString(metadata, "resolution_status"),
          ),
          ...(snapshot === undefined ? {} : { snapshot }),
          ...(rowOptionalString(metadata, "snapshot_hash") === undefined
            ? {}
            : { snapshotHash: rowOptionalString(metadata, "snapshot_hash") }),
          evidence,
          status: rowString(metadata, "status") as F14RunStatus,
          warnings: decodeWarningList(metadata),
          nextAction: rowString(metadata, "next_action"),
          version: rowNumber(metadata, "version"),
          createdAt: rowString(metadata, "created_at"),
          updatedAt: rowString(metadata, "updated_at"),
        };
      },
      { maxAttempts: 1 },
    );
  }

  public getRunByIdempotencyKey(
    idempotencyKey: string,
  ): F14ValidationRunRecord | undefined {
    id(idempotencyKey, "validation run idempotency key");
    const row = this.store.read(
      "SELECT run_id FROM f14_validation_run_metadata WHERE idempotency_key = ?",
      idempotencyKey,
    );
    return row === undefined
      ? undefined
      : this.getRun(rowString(row, "run_id"));
  }

  public listRunning(): readonly F14ValidationRunRecord[] {
    return this.store
      .readAll(
        "SELECT run_id FROM f14_validation_run_metadata WHERE status = 'running' ORDER BY updated_at, run_id",
      )
      .map((row) => this.getRun(rowString(row, "run_id")))
      .filter(
        (record): record is F14ValidationRunRecord => record !== undefined,
      );
  }

  public listRuns(operationId?: string): readonly F14ValidationRunRecord[] {
    const rows =
      operationId === undefined
        ? this.store.readAll(
            "SELECT run_id FROM f14_validation_run_metadata ORDER BY created_at, run_id",
          )
        : this.store.readAll(
            "SELECT run_id FROM f14_validation_run_metadata WHERE operation_id = ? ORDER BY created_at, run_id",
            operationId,
          );
    return rows
      .map((row) => this.getRun(rowString(row, "run_id")))
      .filter(
        (record): record is F14ValidationRunRecord => record !== undefined,
      );
  }

  public saveRunIntent(input: F14ValidationRunInput): {
    readonly created: boolean;
    readonly record: F14ValidationRunRecord;
  } {
    id(input.runId, "validation run identifier");
    id(input.operationId, "validation operation identifier");
    id(input.idempotencyKey, "validation run idempotency key");
    id(input.correlationId, "validation correlation identifier");
    text(input.ownerType, "validation owner type");
    id(input.ownerId, "validation owner identifier");
    text(input.nextAction, "validation next action");
    const existing =
      this.getRun(input.runId) ??
      this.getRunByIdempotencyKey(input.idempotencyKey);
    if (existing !== undefined) {
      if (recordFingerprint(input) !== this.fingerprint(existing)) {
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The validation run identity was replayed with different immutable inputs.",
        );
      }
      return { created: false, record: existing };
    }

    const snapshot = snapshotEncoded(input.snapshot);
    const evidence = runEvidenceHash(input.evidence);
    const warnings = warningEncoded(input.evidence.warnings);
    const timestamp = now(this.clock);
    this.store.transaction((transaction) => {
      if (input.snapshot !== undefined) {
        transaction.run(
          "INSERT INTO f14_validation_snapshots (snapshot_id, operation_id, snapshot_projection_json, snapshot_hash, created_at) VALUES (?, ?, ?, ?, ?)",
          input.snapshot.snapshotId,
          input.operationId,
          snapshot.payload,
          snapshot.payloadHash,
          timestamp,
        );
      }
      transaction.run(
        "INSERT INTO validation_runs (run_id, owner_type, owner_id, status, snapshot_json, evidence_json, evidence_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        input.runId,
        input.ownerType,
        input.ownerId,
        input.evidence.status,
        snapshot.payload,
        evidence.payload,
        evidence.payloadHash,
        timestamp,
        timestamp,
      );
      transaction.run(
        "INSERT INTO f14_validation_run_metadata (run_id, operation_id, idempotency_key, correlation_id, owner_type, owner_id, consumer, requested_phase, snapshot_id, snapshot_hash, resolution_status, status, reason_code, warning_json, warning_hash, next_action, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
        input.runId,
        input.operationId,
        input.idempotencyKey,
        input.correlationId,
        input.ownerType,
        input.ownerId,
        input.consumer,
        input.requestedPhase,
        input.snapshot?.snapshotId ?? null,
        input.snapshot?.contentHash ?? null,
        input.resolutionStatus,
        input.evidence.status,
        input.evidence.reason ?? null,
        warnings.payload,
        warnings.payloadHash,
        input.nextAction,
        timestamp,
        timestamp,
      );
      this.writeSteps(transaction, input.runId, input.evidence, timestamp);
      this.writeWarnings(
        transaction,
        input.runId,
        input.evidence.warnings,
        timestamp,
      );
    });
    const record = this.getRun(input.runId);
    if (record === undefined) throw new Error("F14_RUN_NOT_READABLE");
    return { created: true, record };
  }

  public updateRun(input: F14RunWriteInput): F14ValidationRunRecord {
    id(input.runId, "validation run identifier");
    text(input.nextAction, "validation next action");
    const evidence = runEvidenceHash(input.evidence);
    const warnings = warningEncoded(input.evidence.warnings);
    const timestamp = now(this.clock);
    this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT * FROM f14_validation_run_metadata WHERE run_id = ?",
        input.runId,
      );
      if (existing === undefined)
        throw repositoryError(
          this.store,
          "NOT_FOUND",
          "The validation run does not exist.",
        );
      const version = rowNumber(existing, "version");
      if (
        input.expectedVersion !== undefined &&
        input.expectedVersion !== version
      )
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The validation run changed before its evidence was committed.",
        );
      const result = transaction.run(
        "UPDATE f14_validation_run_metadata SET status = ?, reason_code = ?, warning_json = ?, warning_hash = ?, next_action = ?, version = version + 1, updated_at = ? WHERE run_id = ? AND version = ?",
        input.evidence.status,
        input.evidence.reason ?? null,
        warnings.payload,
        warnings.payloadHash,
        input.nextAction,
        timestamp,
        input.runId,
        version,
      );
      if (result.changes !== 1)
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The validation run changed before its evidence was committed.",
        );
      transaction.run(
        "UPDATE validation_runs SET status = ?, evidence_json = ?, evidence_hash = ?, updated_at = ? WHERE run_id = ?",
        input.evidence.status,
        evidence.payload,
        evidence.payloadHash,
        timestamp,
        input.runId,
      );
      this.writeSteps(transaction, input.runId, input.evidence, timestamp);
      this.writeWarnings(
        transaction,
        input.runId,
        input.evidence.warnings,
        timestamp,
      );
    });
    const record = this.getRun(input.runId);
    if (record === undefined) throw new Error("F14_RUN_NOT_READABLE");
    return record;
  }

  public updateManualAttestation(
    input: F14ManualAttestationWriteInput,
  ): F14ValidationRunRecord {
    const record = this.updateRun({
      runId: input.runId,
      evidence: input.evidence,
      nextAction: input.nextAction,
      ...(input.expectedVersion === undefined
        ? {}
        : { expectedVersion: input.expectedVersion }),
    });
    const encoded = encodeSnapshot(input.attestation);
    const timestamp = now(this.clock);
    this.store.transaction((transaction) => {
      transaction.run(
        "INSERT INTO f14_validation_manual_attestations (run_id, check_id, outcome, evidence_json, evidence_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(run_id, check_id) DO UPDATE SET outcome = excluded.outcome, evidence_json = excluded.evidence_json, evidence_hash = excluded.evidence_hash, updated_at = excluded.updated_at",
        input.runId,
        input.attestation.checkId,
        input.attestation.outcome,
        encoded.payload,
        encoded.payloadHash,
        timestamp,
        timestamp,
      );
    });
    return this.getRun(record.runId) as F14ValidationRunRecord;
  }

  private fingerprint(record: F14ValidationRunRecord): string {
    return JSON.stringify({
      operationId: record.operationId,
      idempotencyKey: record.idempotencyKey,
      ownerType: record.ownerType,
      ownerId: record.ownerId,
      consumer: record.consumer,
      requestedPhase: record.requestedPhase,
      resolutionStatus: record.resolutionStatus,
      snapshotHash: record.snapshotHash,
    });
  }

  private writeSteps(
    transaction: PersistenceTransaction,
    runId: string,
    evidence: ValidationRunEvidence,
    timestamp: string,
  ): void {
    evidence.steps.forEach((step, ordinal) => {
      const encoded = encodeSnapshot(step);
      transaction.run(
        "INSERT INTO validation_steps (run_id, step_id, status, evidence_json) VALUES (?, ?, ?, ?) ON CONFLICT(run_id, step_id) DO UPDATE SET status = excluded.status, evidence_json = excluded.evidence_json",
        runId,
        step.stepId,
        step.status,
        encoded.payload,
      );
      transaction.run(
        "INSERT INTO f14_validation_steps (run_id, ordinal, step_id, kind, configured_phase, executed_phase, status, evidence_json, evidence_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(run_id, ordinal) DO UPDATE SET step_id = excluded.step_id, kind = excluded.kind, configured_phase = excluded.configured_phase, executed_phase = excluded.executed_phase, status = excluded.status, evidence_json = excluded.evidence_json, evidence_hash = excluded.evidence_hash, updated_at = excluded.updated_at",
        runId,
        ordinal,
        step.stepId,
        step.kind,
        step.phase ?? "post_change",
        step.executedPhase ?? null,
        step.status,
        encoded.payload,
        encoded.payloadHash,
        timestamp,
        timestamp,
      );
      if (step.kind === "manual" && step.attestation !== undefined) {
        const attestation = encodeSnapshot(step.attestation);
        transaction.run(
          "INSERT INTO f14_validation_manual_attestations (run_id, check_id, outcome, evidence_json, evidence_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(run_id, check_id) DO UPDATE SET outcome = excluded.outcome, evidence_json = excluded.evidence_json, evidence_hash = excluded.evidence_hash, updated_at = excluded.updated_at",
          runId,
          step.attestation.checkId,
          step.attestation.outcome,
          attestation.payload,
          attestation.payloadHash,
          timestamp,
          timestamp,
        );
      }
    });
  }

  private writeWarnings(
    transaction: PersistenceTransaction,
    runId: string,
    warnings: readonly ValidationWarning[],
    timestamp: string,
  ): void {
    for (const warning of warnings) {
      const encoded = encodeSnapshot(warning);
      transaction.run(
        "INSERT INTO f14_validation_warnings (warning_id, run_id, code, warning_json, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(run_id, code) DO UPDATE SET warning_json = excluded.warning_json",
        warningId(runId, warning.code),
        runId,
        warning.code,
        encoded.payload,
        timestamp,
      );
    }
  }
}

export type {
  ManualAttestation,
  ValidationRunEvidence,
  ValidationSnapshot,
  ValidationWarning,
};
