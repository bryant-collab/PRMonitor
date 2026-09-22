import { createHash, randomUUID } from "node:crypto";
import type { ActivityEventInput } from "../../shared/activity";
import {
  assertBoundedIdentifier,
  assertBoundedText,
  decodeSnapshot,
  encodeSnapshot,
} from "./codecs";
import { PersistenceError } from "./types";
import type {
  PersistenceClock,
  PersistenceTransaction,
  SqlRow,
  TransactionOptions,
} from "./types";
import type { PersistenceStore } from "./database";
import type { ActivityWriter } from "../activity-service";
import {
  PersistenceRepositories,
  type ResourceCheckpointInput,
  type ResourceCheckpointRecord,
} from "./repositories";
import {
  resolvePollingConfiguration,
  type EffectivePollingConfiguration,
  type F10CurrentMetadataRecord,
  type F10ObservedVersionCandidate,
  type F10PollBeginInput,
  type F10PollBeginResult,
  type F10PollCommitInput,
  type F10PollFailureInput,
  type F10PollReason,
  type F10PollResourceAttemptRecord,
  type F10PollResourceResult,
  type F10PollResourceStatus,
  type F10PollRunRecord,
  type F10PollRunStatus,
  type F10PollScope,
  type F10ResourceCheckpoint,
  type F10ResourceKind,
} from "../pr-polling-contracts";

const RECORD_SCHEMA_VERSION = 1;
const ACTIVE_ATTEMPT_STATUSES = ["PENDING", "RUNNING"] as const;
const TERMINAL_ATTEMPT_STATUSES = [
  "COMPLETED",
  "NOT_MODIFIED",
  "FAILED",
  "CANCELLED",
  "INTERRUPTED",
] as const;

type JsonRecord = Record<string, unknown>;

function now(clock: PersistenceClock): string {
  const value = clock.now();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
    throw new Error("F10_CLOCK_MUST_RETURN_UTC_MILLISECONDS");
  return value;
}

function rowString(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`F10_INVALID_ROW_${key}`);
  return value;
}

function rowOptionalString(row: SqlRow, key: string): string | undefined {
  const value = row[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`F10_INVALID_ROW_${key}`);
  return value;
}

function rowNumber(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number") throw new Error(`F10_INVALID_ROW_${key}`);
  return value;
}

function safeId(value: string, label: string): void {
  assertBoundedIdentifier(value, label);
}

function safeText(value: string, label: string): void {
  assertBoundedText(value, label);
}

function safeTimestamp(
  store: PersistenceStore,
  value: string,
  label: string,
): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
    throw persistenceError(
      store,
      "INVALID_RECORD",
      `The ${label} is not a UTC timestamp with millisecond precision.`,
    );
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
    why: "The F10 persistence boundary rejected an unsafe, stale, missing, or duplicate polling record.",
    nextAction: code === "CONFLICT" ? "RECONCILE" : "FIX_INPUT",
    correlationId: "f10-persistence",
    databaseId: store.health.databaseId,
    details: {},
  });
}

function withoutUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (value === null || typeof value !== "object") return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error("F10_NON_PLAIN_SNAPSHOT");
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, withoutUndefined(item)]),
  );
}

function encoded(value: unknown): {
  readonly json: string;
  readonly hash: string;
} {
  const snapshot = encodeSnapshot(
    withoutUndefined(value),
    RECORD_SCHEMA_VERSION,
  );
  return { json: snapshot.payload, hash: snapshot.payloadHash };
}

function decodeRow<T>(row: SqlRow, jsonKey: string, hashKey: string): T {
  return decodeSnapshot<T>(
    {
      schemaVersion: RECORD_SCHEMA_VERSION,
      payload: rowString(row, jsonKey),
      payloadHash: rowString(row, hashKey),
    },
    RECORD_SCHEMA_VERSION,
  );
}

function decodeLoose<T>(value: string | undefined, fallback: T): T {
  if (value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error("F10_INVALID_PERSISTED_JSON");
  }
}

function checkpointPayload(
  checkpoint: F10ResourceCheckpoint | undefined,
): string {
  if (checkpoint === undefined) return "{}";
  return JSON.stringify(withoutUndefined(checkpoint));
}

function reasonPayload(reason: F10PollReason): string {
  return encoded(reason).json;
}

function reasonFromRow(row: SqlRow): F10PollReason | undefined {
  const value = rowOptionalString(row, "reason_json");
  if (value === undefined) return undefined;
  return decodeLoose<F10PollReason | undefined>(value, undefined);
}

function eventIds(row: SqlRow, key: string): readonly string[] {
  const value = decodeLoose<unknown>(rowOptionalString(row, key), []);
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error(`F10_INVALID_${key.toUpperCase()}`);
  return value;
}

function resourceKind(value: string): F10ResourceKind {
  if (
    value !== "pull_request" &&
    value !== "review_comments" &&
    value !== "reviews" &&
    value !== "issue_comments"
  )
    throw new Error("F10_INVALID_RESOURCE_KIND");
  return value;
}

function attemptStatus(value: string): F10PollResourceStatus {
  if (
    value !== "PENDING" &&
    value !== "RUNNING" &&
    value !== "COMPLETED" &&
    value !== "NOT_MODIFIED" &&
    value !== "FAILED" &&
    value !== "CANCELLED" &&
    value !== "INTERRUPTED" &&
    value !== "SKIPPED"
  )
    throw new Error("F10_INVALID_ATTEMPT_STATUS");
  return value;
}

function runStatus(value: string): F10PollRunStatus {
  if (
    value !== "RUNNING" &&
    value !== "COMPLETED" &&
    value !== "PARTIAL" &&
    value !== "FAILED" &&
    value !== "CANCELLED" &&
    value !== "INTERRUPTED"
  )
    throw new Error("F10_INVALID_RUN_STATUS");
  return value;
}

function checkpointFromValue(
  value: unknown,
): F10ResourceCheckpoint | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length === 0
  )
    return undefined;
  return value as F10ResourceCheckpoint;
}

function checkpointFromF03Record(
  record: ResourceCheckpointRecord,
): F10ResourceCheckpoint {
  if (
    typeof record.payload !== "object" ||
    record.payload === null ||
    Array.isArray(record.payload)
  )
    throw new Error("F10_INVALID_F03_CHECKPOINT_PAYLOAD");
  const payload = record.payload as Record<string, unknown>;
  const managedPrId = payload.managedPrId;
  const serverId = payload.serverId;
  const repositoryKey = payload.repositoryKey;
  const resource = payload.resource;
  const resourceKey = payload.resourceKey;
  if (
    typeof managedPrId !== "string" ||
    typeof serverId !== "string" ||
    typeof repositoryKey !== "string" ||
    typeof resource !== "string" ||
    typeof resourceKey !== "string"
  )
    throw new Error("F10_INVALID_F03_CHECKPOINT_PAYLOAD");
  const lastCompleteAttemptId = payload.lastCompleteAttemptId;
  const lastCompleteAt = payload.lastCompleteAt;
  if (
    lastCompleteAttemptId !== undefined &&
    typeof lastCompleteAttemptId !== "string"
  )
    throw new Error("F10_INVALID_F03_CHECKPOINT_PAYLOAD");
  if (lastCompleteAt !== undefined && typeof lastCompleteAt !== "string")
    throw new Error("F10_INVALID_F03_CHECKPOINT_PAYLOAD");
  const etag = record.etag;
  const lastModified = record.lastModified;
  const pagination = decodeLoose<F10ResourceCheckpoint["pagination"]>(
    record.paginationCursor,
    undefined,
  );
  return {
    managedPrId,
    serverId,
    repositoryKey,
    resource: resourceKind(resource),
    resourceKey,
    ...(etag === undefined && lastModified === undefined
      ? {}
      : {
          conditional: {
            ...(etag === undefined ? {} : { etag }),
            ...(lastModified === undefined ? {} : { lastModified }),
          },
        }),
    ...(pagination === undefined ? {} : { pagination }),
    ...(lastCompleteAttemptId === undefined ? {} : { lastCompleteAttemptId }),
    ...(lastCompleteAt === undefined ? {} : { lastCompleteAt }),
    version: record.observedVersion,
  };
}

function scopeFromRequest(row: SqlRow): {
  readonly scope: F10PollScope;
  readonly requestSnapshot: unknown;
} {
  const requestSnapshot = decodeRow<JsonRecord>(
    row,
    "request_json",
    "request_hash",
  );
  const scope = requestSnapshot.scope;
  if (typeof scope !== "object" || scope === null || Array.isArray(scope))
    throw new Error("F10_INVALID_SCOPE_SNAPSHOT");
  return { scope: scope as F10PollScope, requestSnapshot };
}

function hashObservation(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);
}

export interface F10StoredEventVersion {
  readonly eventVersionId: string;
  readonly managedPrId: string;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly sourceRepositoryId?: string;
  readonly resourceAttemptId?: string;
  readonly resourceCheckpointId?: string;
  readonly resourceObservationId?: string;
  readonly observedAt: string;
  readonly sourceUpdatedAt?: string;
  readonly semanticHash: string;
  readonly payload: unknown;
}

export class F10PersistenceRepositories {
  private readonly clock: PersistenceClock;
  private readonly f03Repositories: PersistenceRepositories;
  private readonly activity: ActivityWriter | undefined;
  private readonly resourceTransactionOptions: TransactionOptions;
  public readonly commitsResourceActivityInTransaction: boolean;

  public constructor(
    private readonly store: PersistenceStore,
    options: {
      readonly clock?: PersistenceClock;
      readonly f03Repositories?: PersistenceRepositories;
      readonly activity?: ActivityWriter;
      readonly resourceTransactionOptions?: TransactionOptions;
    } = {},
  ) {
    this.clock = options.clock ?? { now: () => new Date().toISOString() };
    this.f03Repositories =
      options.f03Repositories ??
      new PersistenceRepositories(store, { clock: this.clock });
    this.activity = options.activity;
    this.resourceTransactionOptions = options.resourceTransactionOptions ?? {};
    this.commitsResourceActivityInTransaction = this.activity !== undefined;
  }

  public beginPollRun(input: F10PollBeginInput): F10PollBeginResult {
    safeId(input.pollRunId, "poll run identifier");
    safeId(input.correlationId, "poll correlation identifier");
    safeTimestamp(this.store, input.startedAt, "poll start time");
    const configuration = resolvePollingConfiguration(input.configuration);
    const configurationEncoded = encoded(configuration);
    const seenScopes = new Set<string>();
    for (const scope of input.scopes) {
      this.validateScope(scope);
      if (seenScopes.has(`${scope.managedPrId}|${scope.resourceKey}`))
        throw persistenceError(
          this.store,
          "DUPLICATE",
          "A poll run cannot contain the same resource scope twice.",
        );
      seenScopes.add(`${scope.managedPrId}|${scope.resourceKey}`);
    }
    return this.store.transaction(
      (transaction) => {
        const existing = transaction.get(
          "SELECT * FROM f10_poll_runs WHERE poll_run_id = ?",
          input.pollRunId,
        );
        if (existing !== undefined) {
          if (
            rowString(existing, "configuration_hash") !==
            configurationEncoded.hash
          )
            throw persistenceError(
              this.store,
              "CONFLICT",
              "The poll run identifier is already bound to another configuration.",
            );
          return {
            run: this.readRunInTransaction(transaction, existing),
            attempts: this.readAttemptsInTransaction(
              transaction,
              input.pollRunId,
            ),
            skipped: [],
          };
        }

        const managedPrCount = new Set(
          input.scopes.map((scope) => scope.managedPrId),
        ).size;
        transaction.run(
          "INSERT INTO f10_poll_runs (poll_run_id, correlation_id, configuration_json, configuration_hash, managed_pr_count, status, new_version_count, started_at, updated_at) VALUES (?, ?, ?, ?, ?, 'RUNNING', 0, ?, ?)",
          input.pollRunId,
          input.correlationId,
          configurationEncoded.json,
          configurationEncoded.hash,
          managedPrCount,
          input.startedAt,
          input.startedAt,
        );

        const skipped: F10PollResourceResult[] = [];
        for (const scope of input.scopes) {
          const active = transaction.get(
            "SELECT resource_attempt_id, poll_run_id FROM f10_poll_resource_attempts WHERE managed_pr_id = ? AND resource_key = ? AND status IN ('PENDING', 'RUNNING') LIMIT 1",
            scope.managedPrId,
            scope.resourceKey,
          );
          if (active !== undefined) {
            skipped.push({
              attemptId: rowString(active, "resource_attempt_id"),
              pollRunId: rowString(active, "poll_run_id"),
              managedPrId: scope.managedPrId,
              resource: scope.resource,
              resourceKey: scope.resourceKey,
              status: "SKIPPED",
              eventVersionIds: [],
              newEventVersionIds: [],
              newVersionCount: 0,
              reason: {
                code: "POLL_ALREADY_IN_FLIGHT",
                message:
                  "An observation for this exact resource scope is already in flight.",
                retryable: true,
                nextAction: "WAIT",
                correlationId: input.correlationId,
              },
            });
            continue;
          }
          const checkpoint = this.getCheckpointInTransaction(
            transaction,
            scope,
          );
          const requestSnapshot = encoded({
            schemaVersion: RECORD_SCHEMA_VERSION,
            scope,
            configuration,
            conditional: checkpoint?.conditional,
            pagination: checkpoint?.pagination,
          });
          const attemptId = `f10-attempt-${randomUUID()}`;
          transaction.run(
            "INSERT INTO f10_poll_resource_attempts (resource_attempt_id, poll_run_id, managed_pr_id, server_id, repository_key, resource_kind, resource_key, correlation_id, request_json, request_hash, prior_checkpoint_json, status, outcome, new_version_count, observed_version_ids_json, new_version_ids_json, version, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 'PENDING', 0, '[]', '[]', 1, ?, ?)",
            attemptId,
            input.pollRunId,
            scope.managedPrId,
            scope.serverId,
            scope.repositoryKey,
            scope.resource,
            scope.resourceKey,
            input.correlationId,
            requestSnapshot.json,
            requestSnapshot.hash,
            checkpointPayload(checkpoint),
            input.startedAt,
            input.startedAt,
          );
        }
        const runRow = transaction.get(
          "SELECT * FROM f10_poll_runs WHERE poll_run_id = ?",
          input.pollRunId,
        );
        if (runRow === undefined) throw new Error("F10_POLL_RUN_NOT_READABLE");
        return {
          run: this.readRunInTransaction(transaction, runRow),
          attempts: this.readAttemptsInTransaction(
            transaction,
            input.pollRunId,
          ),
          skipped,
        };
      },
      { correlationId: input.correlationId },
    );
  }

  public startResourceAttempt(attemptId: string, startedAt: string): boolean {
    safeId(attemptId, "resource attempt identifier");
    safeTimestamp(this.store, startedAt, "resource attempt start time");
    return this.store.transaction((transaction) => {
      const row = transaction.get(
        "SELECT status, version FROM f10_poll_resource_attempts WHERE resource_attempt_id = ?",
        attemptId,
      );
      if (row === undefined)
        throw persistenceError(
          this.store,
          "NOT_FOUND",
          "The poll resource attempt no longer exists.",
        );
      const status = attemptStatus(rowString(row, "status"));
      if (status === "PENDING") {
        transaction.run(
          "UPDATE f10_poll_resource_attempts SET status = 'RUNNING', outcome = 'PENDING', version = version + 1, updated_at = ? WHERE resource_attempt_id = ? AND version = ?",
          startedAt,
          attemptId,
          rowNumber(row, "version"),
        );
        return true;
      }
      return status === "RUNNING";
    });
  }

  public commitResource(input: F10PollCommitInput): F10PollResourceResult {
    safeId(input.attemptId, "resource attempt identifier");
    safeTimestamp(this.store, input.observedAt, "resource observation time");
    const observedAt = input.observedAt;
    return this.store.transaction(
      (transaction) => {
        const attempt = transaction.get(
          "SELECT * FROM f10_poll_resource_attempts WHERE resource_attempt_id = ?",
          input.attemptId,
        );
        if (attempt === undefined)
          throw persistenceError(
            this.store,
            "NOT_FOUND",
            "The poll resource attempt no longer exists.",
          );
        const status = attemptStatus(rowString(attempt, "status"));
        if ((TERMINAL_ATTEMPT_STATUSES as readonly string[]).includes(status))
          return this.resourceResultInTransaction(transaction, attempt);
        if (
          !ACTIVE_ATTEMPT_STATUSES.includes(
            status as (typeof ACTIVE_ATTEMPT_STATUSES)[number],
          )
        )
          throw persistenceError(
            this.store,
            "CONFLICT",
            "The poll resource attempt is not available for completion.",
          );
        const { scope } = scopeFromRequest(attempt);
        const candidateMap = new Map<string, F10ObservedVersionCandidate>();
        for (const candidate of input.versions) {
          if (
            candidate.managedPrId !== scope.managedPrId ||
            candidate.sourceKind !== sourceKindFor(scope.resource) ||
            candidate.sourceId !== candidate.remoteIdentity ||
            candidate.feedback.identity.key !== candidate.remoteIdentity ||
            candidate.feedback.identity.resource.key !== scope.resourceKey ||
            candidate.feedback.pullRequest.key !== scope.pullRequest.key
          )
            throw persistenceError(
              this.store,
              "INVALID_RECORD",
              "A feedback version does not belong to the resource attempt.",
            );
          candidateMap.set(candidate.eventVersionId, candidate);
        }
        const prior = this.getCheckpointInTransaction(transaction, scope);
        const etag = input.conditional?.etag ?? prior?.conditional?.etag;
        const lastModified =
          input.conditional?.lastModified ?? prior?.conditional?.lastModified;
        const pagination = input.pagination ?? prior?.pagination;
        const nextCheckpointVersion = (prior?.version ?? 0) + 1;
        const sourceRepositoryId = this.repositoryIdInTransaction(
          transaction,
          scope,
        );
        const paginationJson =
          pagination === undefined
            ? null
            : JSON.stringify(withoutUndefined(pagination));
        const legacyInput: ResourceCheckpointInput = {
          serverId: scope.serverId,
          ...(sourceRepositoryId === undefined
            ? {}
            : { repositoryId: sourceRepositoryId }),
          resourceKind: scope.resource,
          resourceKey: scope.resourceKey,
          ...(etag === undefined ? {} : { etag }),
          ...(lastModified === undefined ? {} : { lastModified }),
          ...(paginationJson === null
            ? {}
            : { paginationCursor: paginationJson }),
          observedVersion: nextCheckpointVersion,
          payload: {
            managedPrId: scope.managedPrId,
            serverId: scope.serverId,
            repositoryKey: scope.repositoryKey,
            resource: scope.resource,
            resourceKey: scope.resourceKey,
            lastCompleteAttemptId: input.attemptId,
            lastCompleteAt: observedAt,
            version: nextCheckpointVersion,
            complete: true,
          },
        };
        const f03CheckpointId =
          this.f03Repositories.putResourceCheckpointInTransaction(
            transaction,
            legacyInput,
            observedAt,
          );
        const observedIds: string[] = [];
        const newIds: string[] = [];
        for (const candidate of candidateMap.values()) {
          const safeFeedback = withoutUndefined(candidate.feedback);
          const observationId = `f10-observation-${hashObservation(
            `${candidate.managedPrId}|${candidate.remoteIdentity}|${candidate.semanticHash}`,
          )}`;
          this.f03Repositories.putResourceObservationInTransaction(
            transaction,
            {
              observationId,
              managedPrId: candidate.managedPrId,
              serverId: scope.serverId,
              resourceKind: scope.resource,
              resourceKey: scope.resourceKey,
              remoteIdentity: candidate.remoteIdentity,
              observedAt: candidate.observedAt,
              semanticHash: candidate.semanticHash,
              payload: safeFeedback,
            },
          );
          const inserted =
            this.f03Repositories.insertRemoteEventVersionInTransaction(
              transaction,
              {
                id: candidate.eventVersionId,
                managedPrId: candidate.managedPrId,
                sourceKind: candidate.sourceKind,
                sourceId: candidate.sourceId,
                ...(sourceRepositoryId === undefined
                  ? {}
                  : { sourceRepositoryId }),
                resourceAttemptId: input.attemptId,
                resourceCheckpointId: `${f03CheckpointId}:${nextCheckpointVersion}`,
                resourceObservationId: observationId,
                observedAt: candidate.observedAt,
                ...(candidate.sourceUpdatedAt === undefined
                  ? {}
                  : { sourceUpdatedAt: candidate.sourceUpdatedAt }),
                semanticHash: candidate.semanticHash,
                payload: safeFeedback,
              },
              observedAt,
            );
          const durableId = inserted.record.id;
          observedIds.push(durableId);
          if (inserted.inserted) newIds.push(durableId);
        }

        if (input.currentMetadata !== undefined) {
          const metadata = encoded(input.currentMetadata);
          const existingMetadata = transaction.get(
            "SELECT version, created_at FROM f10_pr_metadata_snapshots WHERE managed_pr_id = ?",
            scope.managedPrId,
          );
          if (existingMetadata === undefined)
            transaction.run(
              "INSERT INTO f10_pr_metadata_snapshots (managed_pr_id, observed_at, metadata_json, metadata_hash, last_attempt_id, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
              scope.managedPrId,
              observedAt,
              metadata.json,
              metadata.hash,
              input.attemptId,
              observedAt,
              observedAt,
            );
          else
            transaction.run(
              "UPDATE f10_pr_metadata_snapshots SET observed_at = ?, metadata_json = ?, metadata_hash = ?, last_attempt_id = ?, version = version + 1, updated_at = ? WHERE managed_pr_id = ? AND version = ?",
              observedAt,
              metadata.json,
              metadata.hash,
              input.attemptId,
              observedAt,
              scope.managedPrId,
              rowNumber(existingMetadata, "version"),
            );
        }

        this.appendResourceActivityInTransaction(
          transaction,
          attempt,
          scope,
          input.status,
          input.observedAt,
          newIds.length,
        );

        const updated = now(this.clock);
        transaction.run(
          "UPDATE f10_poll_resource_attempts SET status = ?, outcome = ?, reason_json = NULL, new_version_count = ?, observed_version_ids_json = ?, new_version_ids_json = ?, committed_at = ?, version = version + 1, updated_at = ? WHERE resource_attempt_id = ? AND version = ?",
          input.status,
          input.status,
          newIds.length,
          JSON.stringify(observedIds),
          JSON.stringify(newIds),
          observedAt,
          updated,
          input.attemptId,
          rowNumber(attempt, "version"),
        );
        transaction.run(
          "UPDATE f10_poll_runs SET new_version_count = new_version_count + ?, updated_at = ? WHERE poll_run_id = ?",
          newIds.length,
          updated,
          rowString(attempt, "poll_run_id"),
        );
        const committed = transaction.get(
          "SELECT * FROM f10_poll_resource_attempts WHERE resource_attempt_id = ?",
          input.attemptId,
        );
        if (committed === undefined)
          throw new Error("F10_ATTEMPT_NOT_READABLE");
        return this.resourceResultInTransaction(transaction, committed);
      },
      {
        ...this.resourceTransactionOptions,
        correlationId: `f10-${input.attemptId}`,
      },
    );
  }

  public failResource(input: F10PollFailureInput): F10PollResourceResult {
    safeId(input.attemptId, "resource attempt identifier");
    safeTimestamp(this.store, input.updatedAt, "resource failure time");
    const updated = input.updatedAt;
    return this.store.transaction(
      (transaction) => {
        const attempt = transaction.get(
          "SELECT * FROM f10_poll_resource_attempts WHERE resource_attempt_id = ?",
          input.attemptId,
        );
        if (attempt === undefined)
          throw persistenceError(
            this.store,
            "NOT_FOUND",
            "The poll resource attempt no longer exists.",
          );
        const current = attemptStatus(rowString(attempt, "status"));
        if ((TERMINAL_ATTEMPT_STATUSES as readonly string[]).includes(current))
          return this.resourceResultInTransaction(transaction, attempt);
        const { scope } = scopeFromRequest(attempt);
        this.appendResourceActivityInTransaction(
          transaction,
          attempt,
          scope,
          input.status,
          input.updatedAt,
          0,
          input.reason,
        );
        transaction.run(
          "UPDATE f10_poll_resource_attempts SET status = ?, outcome = ?, reason_json = ?, committed_at = NULL, version = version + 1, updated_at = ? WHERE resource_attempt_id = ? AND version = ?",
          input.status,
          input.status,
          reasonPayload(input.reason),
          updated,
          input.attemptId,
          rowNumber(attempt, "version"),
        );
        const failed = transaction.get(
          "SELECT * FROM f10_poll_resource_attempts WHERE resource_attempt_id = ?",
          input.attemptId,
        );
        if (failed === undefined) throw new Error("F10_ATTEMPT_NOT_READABLE");
        return this.resourceResultInTransaction(transaction, failed);
      },
      { correlationId: `f10-${input.attemptId}` },
    );
  }

  public finalizePollRun(input: {
    readonly pollRunId: string;
    readonly status: Exclude<F10PollRunStatus, "RUNNING">;
    readonly completedAt: string;
  }): F10PollRunRecord {
    safeId(input.pollRunId, "poll run identifier");
    safeTimestamp(this.store, input.completedAt, "poll completion time");
    return this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT * FROM f10_poll_runs WHERE poll_run_id = ?",
        input.pollRunId,
      );
      if (existing === undefined)
        throw persistenceError(
          this.store,
          "NOT_FOUND",
          "The poll run no longer exists.",
        );
      const current = runStatus(rowString(existing, "status"));
      if (current === "RUNNING")
        transaction.run(
          "UPDATE f10_poll_runs SET status = ?, completed_at = ?, updated_at = ? WHERE poll_run_id = ?",
          input.status,
          input.completedAt,
          input.completedAt,
          input.pollRunId,
        );
      const row = transaction.get(
        "SELECT * FROM f10_poll_runs WHERE poll_run_id = ?",
        input.pollRunId,
      );
      if (row === undefined) throw new Error("F10_POLL_RUN_NOT_READABLE");
      return this.readRunInTransaction(transaction, row);
    });
  }

  public reconcileStartup(
    reason: F10PollReason,
    updatedAt = now(this.clock),
  ): void {
    safeTimestamp(this.store, updatedAt, "poll recovery time");
    const reasonJson = reasonPayload(reason);
    this.store.transaction((transaction) => {
      const pending = transaction.all(
        "SELECT resource_attempt_id, version FROM f10_poll_resource_attempts WHERE status IN ('PENDING', 'RUNNING')",
      );
      for (const row of pending)
        transaction.run(
          "UPDATE f10_poll_resource_attempts SET status = 'INTERRUPTED', outcome = 'INTERRUPTED', reason_json = ?, version = version + 1, updated_at = ? WHERE resource_attempt_id = ? AND version = ?",
          reasonJson,
          updatedAt,
          rowString(row, "resource_attempt_id"),
          rowNumber(row, "version"),
        );
      transaction.run(
        "UPDATE f10_poll_runs SET status = 'INTERRUPTED', completed_at = ?, updated_at = ? WHERE status = 'RUNNING'",
        updatedAt,
        updatedAt,
      );
    });
  }

  public getPollRun(pollRunId: string): F10PollRunRecord | undefined {
    safeId(pollRunId, "poll run identifier");
    const row = this.store.read(
      "SELECT * FROM f10_poll_runs WHERE poll_run_id = ?",
      pollRunId,
    );
    return row === undefined
      ? undefined
      : this.store.transaction((transaction) =>
          this.readRunInTransaction(transaction, row),
        );
  }

  public listPollRuns(): readonly F10PollRunRecord[] {
    return this.store
      .readAll(
        "SELECT * FROM f10_poll_runs ORDER BY started_at DESC, poll_run_id DESC",
      )
      .map((row) =>
        this.store.transaction((transaction) =>
          this.readRunInTransaction(transaction, row),
        ),
      );
  }

  public getResourceCheckpoint(
    managedPrId: string,
    resourceKey: string,
  ): F10ResourceCheckpoint | undefined {
    safeId(managedPrId, "managed PR identifier");
    safeText(resourceKey, "resource key");
    const resource = resourceKey.split(":resource:")[1];
    if (
      resource !== "pull_request" &&
      resource !== "review_comments" &&
      resource !== "reviews" &&
      resource !== "issue_comments"
    )
      return undefined;
    const record = this.f03Repositories.getResourceCheckpointForManagedPr(
      managedPrId,
      resource,
      resourceKey,
    );
    return record === undefined ? undefined : checkpointFromF03Record(record);
  }

  public getCurrentMetadata(
    managedPrId: string,
  ): F10CurrentMetadataRecord | undefined {
    safeId(managedPrId, "managed PR identifier");
    const row = this.store.read(
      "SELECT * FROM f10_pr_metadata_snapshots WHERE managed_pr_id = ?",
      managedPrId,
    );
    if (row === undefined) return undefined;
    return {
      managedPrId,
      metadata: decodeRow(row, "metadata_json", "metadata_hash"),
      observedAt: rowString(row, "observed_at"),
      attemptId: rowString(row, "last_attempt_id"),
      version: rowNumber(row, "version"),
    } as F10CurrentMetadataRecord;
  }

  public listEventVersions(
    managedPrId: string,
  ): readonly F10StoredEventVersion[] {
    safeId(managedPrId, "managed PR identifier");
    return this.f03Repositories
      .listRemoteEventVersions(managedPrId)
      .map((record) => ({
        eventVersionId: record.id,
        managedPrId: record.managedPrId,
        sourceKind: record.sourceKind,
        sourceId: record.sourceId,
        ...(record.sourceRepositoryId === undefined
          ? {}
          : { sourceRepositoryId: record.sourceRepositoryId }),
        ...(record.resourceAttemptId === undefined
          ? {}
          : { resourceAttemptId: record.resourceAttemptId }),
        ...(record.resourceCheckpointId === undefined
          ? {}
          : { resourceCheckpointId: record.resourceCheckpointId }),
        ...(record.resourceObservationId === undefined
          ? {}
          : { resourceObservationId: record.resourceObservationId }),
        observedAt: record.observedAt,
        ...(record.sourceUpdatedAt === undefined
          ? {}
          : { sourceUpdatedAt: record.sourceUpdatedAt }),
        semanticHash: record.semanticHash,
        payload: record.payload,
      }));
  }

  private appendResourceActivityInTransaction(
    transaction: PersistenceTransaction,
    attempt: SqlRow,
    scope: F10PollScope,
    status: F10PollResourceStatus,
    occurredAt: string,
    newVersionCount: number,
    reason?: F10PollReason,
  ): void {
    if (this.activity === undefined) return;
    const complete = status === "COMPLETED" || status === "NOT_MODIFIED";
    const input: ActivityEventInput = {
      eventId: `${rowString(attempt, "resource_attempt_id")}-finished`,
      eventType: complete ? "POLL_PROGRESS" : "POLL_FAILED",
      stage: "POLLING",
      correlationId: rowString(attempt, "correlation_id"),
      operationId: rowString(attempt, "poll_run_id"),
      managedPrId: scope.managedPrId,
      occurrenceAt: occurredAt,
      severity: complete ? "INFO" : "WARNING",
      reason: {
        code: complete ? "POLL_PROGRESS" : "POLL_FAILED",
        what: complete
          ? "A PR feedback resource observation committed."
          : "A PR feedback resource observation did not commit.",
        why: complete
          ? "The resource checkpoint and immutable observations were handled independently."
          : (reason?.message ??
            "The resource remains retryable or needs attention."),
        nextAction: complete ? "WAIT" : "RETRY",
      },
      summary: complete
        ? "PR feedback resource observation committed"
        : "PR feedback resource observation failed",
      details: {
        resource: scope.resource,
        resourceKey: scope.resourceKey,
        status,
        newVersionCount,
        ...(reason === undefined ? {} : { reasonCode: reason.code }),
      },
    };
    const result = this.activity.appendInTransaction(transaction, input);
    if (result.outcome !== "inserted" && result.outcome !== "replayed")
      throw new Error("F10_ACTIVITY_APPEND_FAILED");
  }

  private validateScope(scope: F10PollScope): void {
    safeId(scope.managedPrId, "managed PR identifier");
    safeId(scope.serverId, "server identifier");
    safeText(scope.repositoryKey, "repository key");
    safeText(scope.resourceKey, "resource key");
    if (scope.resourceKey.length > 1_024)
      throw persistenceError(
        this.store,
        "INVALID_RECORD",
        "The poll resource key exceeds its bounded limit.",
      );
    resourceKind(scope.resource);
    if (
      scope.pullRequest.key.length === 0 ||
      scope.pullRequest.repository.key !== scope.repositoryKey
    )
      throw persistenceError(
        this.store,
        "INVALID_RECORD",
        "The poll scope does not contain a matching pull-request identity.",
      );
    const expectedResourceKey = `${scope.pullRequest.key}:resource:${scope.resource}`;
    if (scope.resourceKey !== expectedResourceKey)
      throw persistenceError(
        this.store,
        "INVALID_RECORD",
        "The poll resource key is not bound to its pull-request identity.",
      );
    if (scope.resource === "pull_request") {
      if (scope.feedbackScope !== undefined)
        throw persistenceError(
          this.store,
          "INVALID_RECORD",
          "PR metadata cannot carry a feedback resource scope.",
        );
    } else if (
      scope.feedbackScope === undefined ||
      scope.feedbackScope.resource !== scope.resource ||
      scope.feedbackScope.key !== scope.resourceKey ||
      scope.feedbackScope.pullRequest.key !== scope.pullRequest.key
    ) {
      throw persistenceError(
        this.store,
        "INVALID_RECORD",
        "The feedback scope is not bound to its resource attempt.",
      );
    }
  }

  private getCheckpointInTransaction(
    transaction: PersistenceTransaction,
    scope: F10PollScope,
  ): F10ResourceCheckpoint | undefined {
    const record =
      this.f03Repositories.getResourceCheckpointForManagedPrInTransaction(
        transaction,
        scope.managedPrId,
        scope.resource,
        scope.resourceKey,
      );
    return record === undefined ? undefined : checkpointFromF03Record(record);
  }

  private repositoryIdInTransaction(
    transaction: PersistenceTransaction,
    scope: F10PollScope,
  ): string | undefined {
    const row = transaction.get(
      "SELECT repository_id FROM repositories WHERE server_id = ? AND owner = ? AND name = ?",
      scope.serverId,
      scope.pullRequest.repository.owner,
      scope.pullRequest.repository.name,
    );
    return row === undefined
      ? undefined
      : rowOptionalString(row, "repository_id");
  }

  private readAttemptsInTransaction(
    transaction: PersistenceTransaction,
    pollRunId: string,
  ): readonly F10PollResourceAttemptRecord[] {
    return transaction
      .all(
        "SELECT * FROM f10_poll_resource_attempts WHERE poll_run_id = ? ORDER BY resource_key ASC, resource_attempt_id ASC",
        pollRunId,
      )
      .map((row) => this.readAttemptInTransaction(transaction, row));
  }

  private readAttemptInTransaction(
    transaction: PersistenceTransaction,
    row: SqlRow,
  ): F10PollResourceAttemptRecord {
    const { scope, requestSnapshot } = scopeFromRequest(row);
    const prior = checkpointFromValue(
      decodeLoose<unknown>(rowOptionalString(row, "prior_checkpoint_json"), {}),
    );
    return {
      attemptId: rowString(row, "resource_attempt_id"),
      pollRunId: rowString(row, "poll_run_id"),
      scope,
      correlationId: rowString(row, "correlation_id"),
      requestSnapshot,
      priorCheckpoint: prior,
      status: attemptStatus(rowString(row, "status")),
      ...(reasonFromRow(row) === undefined
        ? {}
        : { reason: reasonFromRow(row) }),
      eventVersionIds: eventIds(row, "observed_version_ids_json"),
      newEventVersionIds: eventIds(row, "new_version_ids_json"),
      newVersionCount: rowNumber(row, "new_version_count"),
      startedAt: rowString(row, "started_at"),
      ...(rowOptionalString(row, "committed_at") === undefined
        ? {}
        : { committedAt: rowOptionalString(row, "committed_at") }),
    };
  }

  private readRunInTransaction(
    transaction: PersistenceTransaction,
    row: SqlRow,
  ): F10PollRunRecord {
    const configuration = resolvePollingConfiguration(
      decodeRow<EffectivePollingConfiguration>(
        row,
        "configuration_json",
        "configuration_hash",
      ),
    );
    return {
      pollRunId: rowString(row, "poll_run_id"),
      correlationId: rowString(row, "correlation_id"),
      configuration,
      status: runStatus(rowString(row, "status")),
      managedPrCount: rowNumber(row, "managed_pr_count"),
      newVersionCount: rowNumber(row, "new_version_count"),
      startedAt: rowString(row, "started_at"),
      ...(rowOptionalString(row, "completed_at") === undefined
        ? {}
        : { completedAt: rowOptionalString(row, "completed_at") }),
      attempts: this.readAttemptsInTransaction(
        transaction,
        rowString(row, "poll_run_id"),
      ),
    };
  }

  private resourceResultInTransaction(
    transaction: PersistenceTransaction,
    row: SqlRow,
  ): F10PollResourceResult {
    const { scope } = scopeFromRequest(row);
    const status = attemptStatus(rowString(row, "status"));
    const checkpoint = this.getCheckpointInTransaction(transaction, scope);
    const metadataRow = transaction.get(
      "SELECT * FROM f10_pr_metadata_snapshots WHERE managed_pr_id = ?",
      scope.managedPrId,
    );
    const metadata =
      metadataRow === undefined
        ? undefined
        : (decodeRow(
            metadataRow,
            "metadata_json",
            "metadata_hash",
          ) as F10CurrentMetadataRecord["metadata"]);
    return {
      attemptId: rowString(row, "resource_attempt_id"),
      pollRunId: rowString(row, "poll_run_id"),
      managedPrId: scope.managedPrId,
      resource: scope.resource,
      resourceKey: scope.resourceKey,
      status,
      ...(checkpoint === undefined ? {} : { checkpoint }),
      ...(metadata === undefined || scope.resource !== "pull_request"
        ? {}
        : { currentMetadata: metadata }),
      eventVersionIds: eventIds(row, "observed_version_ids_json"),
      newEventVersionIds: eventIds(row, "new_version_ids_json"),
      newVersionCount: rowNumber(row, "new_version_count"),
      ...(reasonFromRow(row) === undefined
        ? {}
        : { reason: reasonFromRow(row) }),
    };
  }
}

function sourceKindFor(resource: F10ResourceKind): string {
  if (resource === "review_comments") return "REVIEW_COMMENT";
  if (resource === "reviews") return "REVIEW";
  if (resource === "issue_comments") return "ISSUE_COMMENT";
  return "PULL_REQUEST";
}
