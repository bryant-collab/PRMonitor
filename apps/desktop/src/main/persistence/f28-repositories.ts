import { randomUUID } from "node:crypto";
import {
  f28OwnerOutcomeSchema,
  f28RecoveryAttemptRecordSchema,
  f28RecoveryProjectionSchema,
  f28RecoveryScopeRecordSchema,
  f28RecoverySessionRecordSchema,
  f28ScopeInputSchema,
  F28_MAX_ATTEMPTS,
  F28_MAX_EVIDENCE_REFS,
  F28_MAX_SCOPES,
  F28_SCHEMA_VERSION,
  f28ScopeKey,
  type F28OwnerOutcome,
  type F28RecoveryAttemptRecord,
  type F28RecoveryProjection,
  type F28RecoveryScopeInput,
  type F28RecoveryScopeRecord,
  type F28RecoverySessionRecord,
  type F28RecoveryStage,
  type F28RecoveryTrigger,
} from "../../shared/f28-recovery";
import {
  decodeSnapshot,
  encodeSnapshot,
  assertBoundedIdentifier,
} from "./codecs";
import type { PersistenceStore } from "./database";
import type { PersistenceClock, PersistenceTransaction, SqlRow } from "./types";
import { PersistenceError } from "./types";

export interface F28RecoverySessionInput {
  readonly sessionId: string;
  readonly requestKey: string;
  readonly trigger: F28RecoveryTrigger;
  readonly lifecycle: F28RecoverySessionRecord["lifecycle"];
  readonly createdAt?: string;
}

export interface F28RecoveryAttemptInput {
  readonly attemptId?: string;
  readonly sessionId: string;
  readonly scopeKey: string;
  readonly stage: F28RecoveryStage;
  readonly expectedRevision?: string;
  readonly startedAt?: string;
}

function now(clock: PersistenceClock): string {
  const value = clock.now();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
    throw new Error("F28_CLOCK_MUST_RETURN_UTC_MILLISECONDS");
  return value;
}

function rowString(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`F28_INVALID_ROW_${key}`);
  return value;
}

function rowOptionalString(row: SqlRow, key: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`F28_INVALID_ROW_${key}`);
  return value;
}

function rowNumber(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number") throw new Error(`F28_INVALID_ROW_${key}`);
  return value;
}

function rowNumberOrZero(row: SqlRow, key: string): number {
  const value = row[key];
  if (value === null || value === undefined) return 0;
  if (typeof value !== "number") throw new Error(`F28_INVALID_ROW_${key}`);
  return value;
}

function id(value: string, label: string): void {
  assertBoundedIdentifier(value, label);
}

function json(value: unknown): ReturnType<typeof encodeSnapshot> {
  return encodeSnapshot(value, F28_SCHEMA_VERSION);
}

function decode<T>(row: SqlRow, jsonKey: string, hashKey: string): T {
  return decodeSnapshot<T>(
    {
      schemaVersion: F28_SCHEMA_VERSION,
      payload: rowString(row, jsonKey),
      payloadHash: rowString(row, hashKey),
    },
    F28_SCHEMA_VERSION,
  );
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
    why: "The F28 recovery boundary preserves durable identity and refuses to guess after a lifecycle interruption.",
    nextAction: code === "CONFLICT" ? "RECONCILE" : "FIX_INPUT",
    correlationId: store.health.correlationId,
    databaseId: store.health.databaseId,
    details: {},
  });
}

export class F28RecoveryRepositories {
  private readonly clock: PersistenceClock;

  public constructor(
    private readonly store: PersistenceStore,
    options: { readonly clock?: PersistenceClock } = {},
  ) {
    this.clock = options.clock ?? { now: () => new Date().toISOString() };
  }

  public createOrGetSession(input: F28RecoverySessionInput): {
    readonly created: boolean;
    readonly session: F28RecoverySessionRecord;
  } {
    id(input.sessionId, "F28 recovery session identifier");
    id(input.requestKey, "F28 recovery request key");
    const lifecycle = input.lifecycle;
    const timestamp = input.createdAt ?? now(this.clock);
    const parsedLifecycle =
      f28RecoverySessionRecordSchema.shape.lifecycle.parse(lifecycle);
    return this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT * FROM f28_recovery_sessions WHERE request_key = ?",
        input.requestKey,
      );
      if (existing !== undefined)
        return { created: false, session: this.sessionFromRow(existing) };
      const record = f28RecoverySessionRecordSchema.parse({
        schemaVersion: F28_SCHEMA_VERSION,
        sessionId: input.sessionId,
        requestKey: input.requestKey,
        trigger: input.trigger,
        status: "RUNNING",
        stage: "LIFECYCLE",
        lifecycle: parsedLifecycle,
        scopeCount: 0,
        completedCount: 0,
        attentionCount: 0,
        retryCount: 0,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const encodedLifecycle = json(record.lifecycle);
      transaction.run(
        "INSERT INTO f28_recovery_sessions (session_id, request_key, trigger, status, stage, lifecycle_json, lifecycle_hash, scope_count, completed_count, attention_count, retry_count, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        record.sessionId,
        record.requestKey,
        record.trigger,
        record.status,
        record.stage,
        encodedLifecycle.payload,
        encodedLifecycle.payloadHash,
        record.scopeCount,
        record.completedCount,
        record.attentionCount,
        record.retryCount,
        record.version,
        record.createdAt,
        record.updatedAt,
      );
      return { created: true, session: record };
    });
  }

  public getSession(sessionId: string): F28RecoverySessionRecord | undefined {
    id(sessionId, "F28 recovery session identifier");
    const row = this.store.read(
      "SELECT * FROM f28_recovery_sessions WHERE session_id = ?",
      sessionId,
    );
    return row === undefined ? undefined : this.sessionFromRow(row);
  }

  public getSessionByRequestKey(
    requestKey: string,
  ): F28RecoverySessionRecord | undefined {
    id(requestKey, "F28 recovery request key");
    const row = this.store.read(
      "SELECT * FROM f28_recovery_sessions WHERE request_key = ?",
      requestKey,
    );
    return row === undefined ? undefined : this.sessionFromRow(row);
  }

  public listSessions(
    limit: number = F28_MAX_SCOPES,
  ): readonly F28RecoverySessionRecord[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > F28_MAX_SCOPES)
      throw new Error("F28_INVALID_SESSION_LIMIT");
    return this.store
      .readAll(
        "SELECT * FROM f28_recovery_sessions ORDER BY updated_at DESC, session_id DESC LIMIT ?",
        limit,
      )
      .map((row) => this.sessionFromRow(row));
  }

  public putScope(
    input: F28RecoveryScopeInput,
    sessionId: string,
  ): F28RecoveryScopeRecord {
    const scope = f28ScopeInputSchema.parse(input);
    id(sessionId, "F28 recovery session identifier");
    const scopeKey = this.scopeKey(scope, sessionId);
    const encodedScope = json(scope);
    const timestamp = now(this.clock);
    return this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT * FROM f28_recovery_scopes WHERE scope_key = ?",
        scopeKey,
      );
      if (existing !== undefined) {
        if (
          rowString(existing, "session_id") !== sessionId ||
          rowString(existing, "scope_hash") !== encodedScope.payloadHash
        )
          throw repositoryError(
            this.store,
            "CONFLICT",
            "The recovery scope identity or immutable revision changed before reconciliation.",
          );
        return this.scopeFromRow(existing);
      }
      const count = transaction.get(
        "SELECT COUNT(*) AS count FROM f28_recovery_scopes WHERE session_id = ?",
        sessionId,
      );
      if (rowNumber(count ?? { count: 0 }, "count") >= F28_MAX_SCOPES)
        throw repositoryError(
          this.store,
          "INVALID_RECORD",
          "The recovery session exceeded its bounded scope limit.",
        );
      const emptyRefs = json([]);
      transaction.run(
        "INSERT INTO f28_recovery_scopes (scope_key, session_id, scope_kind, scope_id, owner, stage, expected_revision, input_revision, repository_key, branch, worktree_id, effect_id, scope_json, scope_hash, classification, attempt_count, reason_json, reason_hash, evidence_refs_json, evidence_refs_hash, next_attempt_at, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SAFE_TO_RETRY', 0, NULL, NULL, ?, ?, NULL, 1, ?, ?)",
        scopeKey,
        sessionId,
        scope.kind,
        scope.id,
        scope.owner,
        scope.stage,
        scope.expectedRevision ?? null,
        scope.inputRevision ?? null,
        scope.repositoryKey ?? null,
        scope.branch ?? null,
        scope.worktreeId ?? null,
        scope.effectId ?? null,
        encodedScope.payload,
        encodedScope.payloadHash,
        emptyRefs.payload,
        emptyRefs.payloadHash,
        timestamp,
        timestamp,
      );
      const inserted = transaction.get(
        "SELECT * FROM f28_recovery_scopes WHERE scope_key = ?",
        scopeKey,
      );
      if (inserted === undefined) throw new Error("F28_SCOPE_NOT_READABLE");
      return this.scopeFromRow(inserted);
    });
  }

  public getScope(scopeKey: string): F28RecoveryScopeRecord | undefined {
    id(scopeKey, "F28 recovery scope key");
    const row = this.store.read(
      "SELECT * FROM f28_recovery_scopes WHERE scope_key = ?",
      scopeKey,
    );
    return row === undefined ? undefined : this.scopeFromRow(row);
  }

  public listScopes(
    sessionId: string,
    limit: number = F28_MAX_SCOPES,
  ): readonly F28RecoveryScopeRecord[] {
    id(sessionId, "F28 recovery session identifier");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > F28_MAX_SCOPES)
      throw new Error("F28_INVALID_SCOPE_LIMIT");
    return this.store
      .readAll(
        "SELECT * FROM f28_recovery_scopes WHERE session_id = ? ORDER BY stage, scope_key LIMIT ?",
        sessionId,
        limit,
      )
      .map((row) => this.scopeFromRow(row));
  }

  public beginAttempt(input: F28RecoveryAttemptInput): {
    readonly created: boolean;
    readonly attempt: F28RecoveryAttemptRecord;
    readonly scope: F28RecoveryScopeRecord;
  } {
    id(input.sessionId, "F28 recovery session identifier");
    id(input.scopeKey, "F28 recovery scope key");
    const timestamp = input.startedAt ?? now(this.clock);
    return this.store.transaction((transaction) => {
      const scopeRow = transaction.get(
        "SELECT * FROM f28_recovery_scopes WHERE scope_key = ?",
        input.scopeKey,
      );
      if (
        scopeRow === undefined ||
        rowString(scopeRow, "session_id") !== input.sessionId
      )
        throw repositoryError(
          this.store,
          "NOT_FOUND",
          "The recovery scope does not exist for this session.",
        );
      const scope = this.scopeFromRow(scopeRow);
      const running = transaction.get(
        "SELECT * FROM f28_recovery_attempts WHERE scope_key = ? AND status = 'RUNNING' ORDER BY attempt_number DESC LIMIT 1",
        input.scopeKey,
      );
      if (running !== undefined)
        return {
          created: false,
          attempt: this.attemptFromRow(running),
          scope,
        };
      const attemptNumber = scope.attemptCount + 1;
      if (attemptNumber > F28_MAX_ATTEMPTS)
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The recovery scope reached its bounded attempt limit.",
        );
      const attemptId = input.attemptId ?? `f28-attempt-${randomUUID()}`;
      id(attemptId, "F28 recovery attempt identifier");
      const existing = transaction.get(
        "SELECT * FROM f28_recovery_attempts WHERE attempt_id = ?",
        attemptId,
      );
      if (existing !== undefined) {
        if (
          rowString(existing, "session_id") !== input.sessionId ||
          rowString(existing, "scope_key") !== input.scopeKey
        )
          throw repositoryError(
            this.store,
            "CONFLICT",
            "The recovery attempt identifier was reused for another scope.",
          );
        return {
          created: false,
          attempt: this.attemptFromRow(existing),
          scope,
        };
      }
      const emptyRefs = json([]);
      transaction.run(
        "INSERT INTO f28_recovery_attempts (attempt_id, session_id, scope_key, stage, attempt_number, status, expected_revision, classification, reason_json, reason_hash, evidence_refs_json, evidence_refs_hash, started_at) VALUES (?, ?, ?, ?, ?, 'RUNNING', ?, NULL, NULL, NULL, ?, ?, ?)",
        attemptId,
        input.sessionId,
        input.scopeKey,
        input.stage,
        attemptNumber,
        input.expectedRevision ?? null,
        emptyRefs.payload,
        emptyRefs.payloadHash,
        timestamp,
      );
      transaction.run(
        "UPDATE f28_recovery_scopes SET attempt_count = ?, version = version + 1, updated_at = ? WHERE scope_key = ? AND version = ?",
        attemptNumber,
        timestamp,
        input.scopeKey,
        scope.version,
      );
      const insertedAttempt = transaction.get(
        "SELECT * FROM f28_recovery_attempts WHERE attempt_id = ?",
        attemptId,
      );
      const updatedScope = transaction.get(
        "SELECT * FROM f28_recovery_scopes WHERE scope_key = ?",
        input.scopeKey,
      );
      if (insertedAttempt === undefined || updatedScope === undefined)
        throw new Error("F28_ATTEMPT_NOT_READABLE");
      return {
        created: true,
        attempt: this.attemptFromRow(insertedAttempt),
        scope: this.scopeFromRow(updatedScope),
      };
    });
  }

  public completeAttempt(input: {
    readonly attemptId: string;
    readonly outcome: F28OwnerOutcome;
    readonly status?: "COMPLETED" | "FAILED";
  }): {
    readonly attempt: F28RecoveryAttemptRecord;
    readonly scope: F28RecoveryScopeRecord;
  } {
    id(input.attemptId, "F28 recovery attempt identifier");
    const outcome = f28OwnerOutcomeSchema.parse(input.outcome);
    const timestamp = now(this.clock);
    return this.store.transaction((transaction) => {
      const attemptRow = transaction.get(
        "SELECT * FROM f28_recovery_attempts WHERE attempt_id = ?",
        input.attemptId,
      );
      if (attemptRow === undefined)
        throw repositoryError(
          this.store,
          "NOT_FOUND",
          "The recovery attempt does not exist.",
        );
      const currentAttempt = this.attemptFromRow(attemptRow);
      if (currentAttempt.status !== "RUNNING") {
        const scope = this.getScopeInTransaction(
          transaction,
          currentAttempt.scopeKey,
        );
        if (scope === undefined) throw new Error("F28_SCOPE_NOT_READABLE");
        return { attempt: currentAttempt, scope };
      }
      const reason = json(outcome.reason);
      const refs = json(outcome.evidenceRefs.slice(0, F28_MAX_EVIDENCE_REFS));
      transaction.run(
        "UPDATE f28_recovery_attempts SET status = ?, classification = ?, reason_json = ?, reason_hash = ?, evidence_refs_json = ?, evidence_refs_hash = ?, completed_at = ?, next_attempt_at = ? WHERE attempt_id = ? AND status = 'RUNNING'",
        input.status ?? "COMPLETED",
        outcome.classification,
        reason.payload,
        reason.payloadHash,
        refs.payload,
        refs.payloadHash,
        timestamp,
        outcome.nextAttemptAt ?? null,
        input.attemptId,
      );
      const scope = this.getScopeInTransaction(
        transaction,
        currentAttempt.scopeKey,
      );
      if (scope === undefined) throw new Error("F28_SCOPE_NOT_READABLE");
      transaction.run(
        "UPDATE f28_recovery_scopes SET classification = ?, reason_json = ?, reason_hash = ?, evidence_refs_json = ?, evidence_refs_hash = ?, next_attempt_at = ?, version = version + 1, updated_at = ? WHERE scope_key = ? AND version = ?",
        outcome.classification,
        reason.payload,
        reason.payloadHash,
        refs.payload,
        refs.payloadHash,
        outcome.nextAttemptAt ?? null,
        timestamp,
        scope.scopeKey,
        scope.version,
      );
      const updatedAttempt = transaction.get(
        "SELECT * FROM f28_recovery_attempts WHERE attempt_id = ?",
        input.attemptId,
      );
      const updatedScope = transaction.get(
        "SELECT * FROM f28_recovery_scopes WHERE scope_key = ?",
        currentAttempt.scopeKey,
      );
      if (updatedAttempt === undefined || updatedScope === undefined)
        throw new Error("F28_ATTEMPT_NOT_READABLE");
      return {
        attempt: this.attemptFromRow(updatedAttempt),
        scope: this.scopeFromRow(updatedScope),
      };
    });
  }

  public failAttempt(input: {
    readonly attemptId: string;
    readonly reason: F28OwnerOutcome["reason"];
  }): {
    readonly attempt: F28RecoveryAttemptRecord;
    readonly scope: F28RecoveryScopeRecord;
  } {
    return this.completeAttempt({
      attemptId: input.attemptId,
      outcome: {
        schemaVersion: F28_SCHEMA_VERSION,
        classification: "UNCERTAIN",
        reason: input.reason,
        evidenceRefs: input.reason.evidenceRefs,
      },
      status: "FAILED",
    });
  }

  public getAttempt(attemptId: string): F28RecoveryAttemptRecord | undefined {
    id(attemptId, "F28 recovery attempt identifier");
    const row = this.store.read(
      "SELECT * FROM f28_recovery_attempts WHERE attempt_id = ?",
      attemptId,
    );
    return row === undefined ? undefined : this.attemptFromRow(row);
  }

  public listAttempts(
    sessionId: string,
    limit: number = F28_MAX_SCOPES,
  ): readonly F28RecoveryAttemptRecord[] {
    id(sessionId, "F28 recovery session identifier");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > F28_MAX_SCOPES)
      throw new Error("F28_INVALID_ATTEMPT_LIMIT");
    return this.store
      .readAll(
        "SELECT * FROM f28_recovery_attempts WHERE session_id = ? ORDER BY started_at, attempt_id LIMIT ?",
        sessionId,
        limit,
      )
      .map((row) => this.attemptFromRow(row));
  }

  public finalizeSession(input: {
    readonly sessionId: string;
    readonly status: F28RecoverySessionRecord["status"];
    readonly stage?: F28RecoveryStage;
    readonly expectedVersion?: number;
    readonly updatedAt?: string;
  }): F28RecoverySessionRecord {
    id(input.sessionId, "F28 recovery session identifier");
    const timestamp = input.updatedAt ?? now(this.clock);
    return this.store.transaction((transaction) => {
      const currentRow = transaction.get(
        "SELECT * FROM f28_recovery_sessions WHERE session_id = ?",
        input.sessionId,
      );
      if (currentRow === undefined)
        throw repositoryError(
          this.store,
          "NOT_FOUND",
          "The recovery session does not exist.",
        );
      const current = this.sessionFromRow(currentRow);
      if (
        input.expectedVersion !== undefined &&
        input.expectedVersion !== current.version
      )
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The recovery session changed before its terminal projection committed.",
        );
      const counts = transaction.get(
        "SELECT COUNT(*) AS scopes, SUM(CASE WHEN classification IN ('COMPLETED', 'ADOPTED', 'SKIPPED') THEN 1 ELSE 0 END) AS completed, SUM(CASE WHEN classification IN ('BLOCKED', 'INTERRUPTED', 'UNCERTAIN') THEN 1 ELSE 0 END) AS attention, SUM(CASE WHEN classification IN ('SAFE_TO_RETRY', 'WAITING_FOR_NETWORK') THEN 1 ELSE 0 END) AS retrying FROM f28_recovery_scopes WHERE session_id = ?",
        input.sessionId,
      );
      const scopeCount = Math.min(
        F28_MAX_SCOPES,
        rowNumber(counts ?? { scopes: 0 }, "scopes"),
      );
      const completedCount = Math.min(
        F28_MAX_SCOPES,
        rowNumberOrZero(counts ?? { completed: 0 }, "completed"),
      );
      const attentionCount = Math.min(
        F28_MAX_SCOPES,
        rowNumberOrZero(counts ?? { attention: 0 }, "attention"),
      );
      const retryCount = Math.min(
        F28_MAX_SCOPES,
        rowNumberOrZero(counts ?? { retrying: 0 }, "retrying"),
      );
      transaction.run(
        "UPDATE f28_recovery_sessions SET status = ?, stage = ?, scope_count = ?, completed_count = ?, attention_count = ?, retry_count = ?, version = version + 1, updated_at = ? WHERE session_id = ? AND version = ?",
        input.status,
        input.stage ?? current.stage,
        scopeCount,
        completedCount,
        attentionCount,
        retryCount,
        timestamp,
        input.sessionId,
        current.version,
      );
      const updated = transaction.get(
        "SELECT * FROM f28_recovery_sessions WHERE session_id = ?",
        input.sessionId,
      );
      if (updated === undefined) throw new Error("F28_SESSION_NOT_READABLE");
      return this.sessionFromRow(updated);
    });
  }

  public updateStage(
    sessionId: string,
    stage: F28RecoveryStage,
  ): F28RecoverySessionRecord {
    const current = this.getSession(sessionId);
    if (current === undefined)
      throw repositoryError(
        this.store,
        "NOT_FOUND",
        "The recovery session does not exist.",
      );
    return this.finalizeSession({
      sessionId,
      status: current.status,
      stage,
      expectedVersion: current.version,
    });
  }

  public readProjection(sessionId?: string): F28RecoveryProjection | undefined {
    const session =
      sessionId === undefined
        ? this.listSessions(1)[0]
        : this.getSession(sessionId);
    if (session === undefined) return undefined;
    const scopes = this.listScopes(session.sessionId);
    const nextAttemptAt = scopes
      .map((scope) => scope.nextAttemptAt)
      .filter((value): value is string => value !== undefined)
      .sort()[0];
    return f28RecoveryProjectionSchema.parse({
      schemaVersion: F28_SCHEMA_VERSION,
      kind: "f28-recovery",
      sessionId: session.sessionId,
      trigger: session.trigger,
      status: session.status,
      stage: session.stage,
      lifecycle: session.lifecycle,
      summary: {
        scopes: session.scopeCount,
        completed: session.completedCount,
        attention: session.attentionCount,
        retrying: session.retryCount,
      },
      scopes,
      ...(nextAttemptAt === undefined ? {} : { nextAttemptAt }),
      updatedAt: session.updatedAt,
    });
  }

  public readLatestProjection(): F28RecoveryProjection | undefined {
    return this.readProjection();
  }

  private scopeKey(scope: F28RecoveryScopeInput, sessionId: string): string {
    const stableKey = f28ScopeKey({
      kind: scope.kind,
      id: scope.id,
      expectedRevision: scope.expectedRevision,
      owner: scope.owner,
      stage: scope.stage,
    });
    return `f28-scope-${sessionId}-${stableKey.slice("f28-scope-".length)}`;
  }

  private sessionFromRow(row: SqlRow): F28RecoverySessionRecord {
    return f28RecoverySessionRecordSchema.parse({
      schemaVersion: F28_SCHEMA_VERSION,
      sessionId: rowString(row, "session_id"),
      requestKey: rowString(row, "request_key"),
      trigger: rowString(row, "trigger"),
      status: rowString(row, "status"),
      stage: rowString(row, "stage"),
      lifecycle: decode(row, "lifecycle_json", "lifecycle_hash"),
      scopeCount: rowNumber(row, "scope_count"),
      completedCount: rowNumber(row, "completed_count"),
      attentionCount: rowNumber(row, "attention_count"),
      retryCount: rowNumber(row, "retry_count"),
      version: rowNumber(row, "version"),
      createdAt: rowString(row, "created_at"),
      updatedAt: rowString(row, "updated_at"),
    });
  }

  private scopeFromRow(row: SqlRow): F28RecoveryScopeRecord {
    const scope = decode<F28RecoveryScopeInput>(
      row,
      "scope_json",
      "scope_hash",
    );
    const reason = rowOptionalString(row, "reason_json")
      ? decode<F28OwnerOutcome["reason"]>(row, "reason_json", "reason_hash")
      : undefined;
    const refs = decode<unknown>(
      row,
      "evidence_refs_json",
      "evidence_refs_hash",
    );
    if (!Array.isArray(refs) || refs.some((value) => typeof value !== "string"))
      throw new Error("F28_INVALID_EVIDENCE_REFS");
    return f28RecoveryScopeRecordSchema.parse({
      schemaVersion: F28_SCHEMA_VERSION,
      scopeKey: rowString(row, "scope_key"),
      sessionId: rowString(row, "session_id"),
      scope,
      stage: rowString(row, "stage"),
      classification: rowString(row, "classification"),
      attemptCount: rowNumber(row, "attempt_count"),
      version: rowNumber(row, "version"),
      ...(reason === undefined ? {} : { reason }),
      evidenceRefs: refs.slice(0, F28_MAX_EVIDENCE_REFS),
      ...(rowOptionalString(row, "next_attempt_at") === undefined
        ? {}
        : { nextAttemptAt: rowOptionalString(row, "next_attempt_at") }),
      createdAt: rowString(row, "created_at"),
      updatedAt: rowString(row, "updated_at"),
    });
  }

  private attemptFromRow(row: SqlRow): F28RecoveryAttemptRecord {
    const reason = rowOptionalString(row, "reason_json")
      ? decode<F28OwnerOutcome["reason"]>(row, "reason_json", "reason_hash")
      : undefined;
    const refs = decode<unknown>(
      row,
      "evidence_refs_json",
      "evidence_refs_hash",
    );
    if (!Array.isArray(refs) || refs.some((value) => typeof value !== "string"))
      throw new Error("F28_INVALID_EVIDENCE_REFS");
    return f28RecoveryAttemptRecordSchema.parse({
      schemaVersion: F28_SCHEMA_VERSION,
      attemptId: rowString(row, "attempt_id"),
      sessionId: rowString(row, "session_id"),
      scopeKey: rowString(row, "scope_key"),
      stage: rowString(row, "stage"),
      attemptNumber: rowNumber(row, "attempt_number"),
      status: rowString(row, "status"),
      ...(rowOptionalString(row, "expected_revision") === undefined
        ? {}
        : { expectedRevision: rowOptionalString(row, "expected_revision") }),
      ...(rowOptionalString(row, "classification") === undefined
        ? {}
        : { classification: rowOptionalString(row, "classification") }),
      ...(reason === undefined ? {} : { reason }),
      evidenceRefs: refs.slice(0, F28_MAX_EVIDENCE_REFS),
      startedAt: rowString(row, "started_at"),
      ...(rowOptionalString(row, "completed_at") === undefined
        ? {}
        : { completedAt: rowOptionalString(row, "completed_at") }),
      ...(rowOptionalString(row, "next_attempt_at") === undefined
        ? {}
        : { nextAttemptAt: rowOptionalString(row, "next_attempt_at") }),
    });
  }

  private getScopeInTransaction(
    transaction: PersistenceTransaction,
    scopeKey: string,
  ): F28RecoveryScopeRecord | undefined {
    const row = transaction.get(
      "SELECT * FROM f28_recovery_scopes WHERE scope_key = ?",
      scopeKey,
    );
    return row === undefined ? undefined : this.scopeFromRow(row);
  }
}
