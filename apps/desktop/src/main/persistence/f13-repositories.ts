import {
  assertBoundedIdentifier,
  assertBoundedText,
  decodeSnapshot,
  encodeSnapshot,
  type SafeJsonValue,
} from "./codecs";
import { PersistenceError } from "./types";
import type { PersistenceClock, SqlRow } from "./types";
import type { PersistenceStore } from "./database";
import {
  isF13ClearChoice,
  type F13ClearChoice,
  type F13ChangeSummary,
  type F13DiffEvidence,
  type F13DiffKind,
  type F13FileEvidence,
  type F13LifecycleState,
  type F13OperationKind,
  type F13PathAction,
  type F13RepositoryIdentity,
  type F13SafeReason,
  type F13SnapshotManifest,
  type F13SnapshotPhase,
  type F13SnapshotRecord,
  type F13WorktreeRecord,
} from "../../shared/f13-contracts";

type Payload = unknown;

export interface F13OperationIntentInput {
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly managedPrId?: string;
  readonly developerClonePath: string;
  readonly operationKind: F13OperationKind;
  readonly worktreeId: string;
  readonly configuredRoot: string;
  readonly rootRevision: number;
  readonly canonicalPath: string;
  readonly sourceRepository: F13RepositoryIdentity;
  readonly destinationRepository?: F13RepositoryIdentity;
  readonly refs: Payload;
  readonly shaSnapshot: Payload;
  readonly initialBaselineSha: string;
  readonly lifecycle?: F13LifecycleState;
  readonly reason?: F13SafeReason;
}

export interface F13OperationIntentRecord {
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly managedPrId?: string;
  readonly developerClonePath: string;
  readonly operationKind: F13OperationKind;
  readonly worktreeId: string;
  readonly configuredRoot: string;
  readonly rootRevision: number;
  readonly canonicalPath: string;
  readonly sourceRepository: F13RepositoryIdentity;
  readonly destinationRepository?: F13RepositoryIdentity;
  readonly refs: Payload;
  readonly shaSnapshot: Payload;
  readonly lifecycle: F13LifecycleState;
  readonly reason?: F13SafeReason;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface F13SnapshotInput {
  readonly snapshotId: string;
  readonly operationId: string;
  readonly worktreeId: string;
  readonly phase: F13SnapshotPhase;
  readonly turnId?: string;
  readonly stateFingerprint: string;
  readonly manifest: F13SnapshotManifest;
  readonly changeSummary?: F13ChangeSummary;
}

export interface F13ClearActionInput {
  readonly actionId: string;
  readonly operationId: string;
  readonly worktreeId: string;
  readonly choice: F13ClearChoice;
  readonly confirmation: boolean;
  readonly beforeSnapshotId?: string;
  readonly afterSnapshotId?: string;
  readonly currentSnapshotId?: string;
  readonly status: string;
  readonly outcome?: Payload;
  readonly reason?: F13SafeReason;
}

export interface F13ClearActionRecord {
  readonly actionId: string;
  readonly operationId: string;
  readonly worktreeId: string;
  readonly choice: F13ClearChoice;
  readonly confirmation: boolean;
  readonly beforeSnapshotId?: string;
  readonly afterSnapshotId?: string;
  readonly currentSnapshotId?: string;
  readonly status: string;
  readonly outcome: Payload;
  readonly reason?: F13SafeReason;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface F13PathActionInput {
  readonly actionId: string;
  readonly operationId: string;
  readonly worktreeId: string;
  readonly action: F13PathAction;
  readonly requestedRelativePath?: string;
  readonly resolvedPath?: string;
  readonly outcome: string;
  readonly reason?: F13SafeReason;
}

export interface F13DiffInput {
  readonly diffId: string;
  readonly operationId: string;
  readonly worktreeId: string;
  readonly kind: F13DiffKind;
  readonly baselineSha: string;
  readonly currentSha?: string;
  readonly diffHash: string;
  readonly patchHash: string;
  readonly patch?: string;
  readonly files: readonly F13FileEvidence[];
  readonly untrackedFiles: readonly string[];
  readonly untrackedEvidence?: readonly F13FileEvidence[];
  readonly complete: boolean;
  readonly regenerationContract: string;
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
  if (typeof value !== "string") throw new Error(`F13_INVALID_ROW_${key}`);
  return value;
}

function rowOptionalString(row: SqlRow, key: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`F13_INVALID_ROW_${key}`);
  return value;
}

function rowNumber(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number") throw new Error(`F13_INVALID_ROW_${key}`);
  return value;
}

function rowBoolean(row: SqlRow, key: string): boolean {
  const value = row[key];
  if (value !== 0 && value !== 1) throw new Error(`F13_INVALID_ROW_${key}`);
  return value === 1;
}

function decodeJson<T>(row: SqlRow, jsonKey: string, hashKey: string): T {
  return decodeSnapshot<T>(
    {
      schemaVersion: 1,
      payload: rowString(row, jsonKey),
      payloadHash: rowString(row, hashKey),
    },
    1,
  );
}

function parseJson<T>(row: SqlRow, jsonKey: string): T {
  try {
    return JSON.parse(rowString(row, jsonKey)) as T;
  } catch {
    throw new Error(`F13_INVALID_ROW_${jsonKey}`);
  }
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
        ? "A different durable operation owns the requested worktree identity or path."
        : "The requested F13 durable record cannot be used safely.",
    nextAction: code === "CONFLICT" ? "RECONCILE" : "FIX_INPUT",
    correlationId: store.health.correlationId,
    databaseId: store.health.databaseId,
    details: {},
  });
}

function sourceFromRow(row: SqlRow): F13RepositoryIdentity {
  return decodeJson<F13RepositoryIdentity>(
    row,
    "source_repository_json",
    "source_repository_hash",
  );
}

function destinationFromRow(row: SqlRow): F13RepositoryIdentity | undefined {
  const json = rowOptionalString(row, "destination_repository_json");
  const hash = rowOptionalString(row, "destination_repository_hash");
  if (json === undefined || hash === undefined) return undefined;
  return decodeSnapshot<F13RepositoryIdentity>(
    { schemaVersion: 1, payload: json, payloadHash: hash },
    1,
  );
}

function intentFromRow(row: SqlRow): F13OperationIntentRecord {
  const reasonJson = rowOptionalString(row, "reason_json");
  return {
    operationId: rowString(row, "operation_id"),
    idempotencyKey: rowString(row, "idempotency_key"),
    correlationId: rowString(row, "correlation_id"),
    ownerType: rowString(row, "owner_type"),
    ownerId: rowString(row, "owner_id"),
    ...(rowOptionalString(row, "managed_pr_id") === undefined
      ? {}
      : { managedPrId: rowOptionalString(row, "managed_pr_id") }),
    developerClonePath: rowString(row, "developer_clone_path"),
    operationKind: rowString(row, "operation_kind") as F13OperationKind,
    worktreeId: rowString(row, "worktree_id"),
    configuredRoot: rowString(row, "configured_root"),
    rootRevision: rowNumber(row, "root_revision"),
    canonicalPath: rowString(row, "canonical_path"),
    sourceRepository: sourceFromRow(row),
    ...(destinationFromRow(row) === undefined
      ? {}
      : { destinationRepository: destinationFromRow(row) }),
    refs: decodeJson<Payload>(row, "refs_json", "refs_hash"),
    shaSnapshot: decodeJson<Payload>(
      row,
      "sha_snapshot_json",
      "sha_snapshot_hash",
    ),
    lifecycle: rowString(row, "lifecycle") as F13LifecycleState,
    ...(reasonJson === undefined || reasonJson === "{}"
      ? {}
      : { reason: JSON.parse(reasonJson) as F13SafeReason }),
    version: rowNumber(row, "version"),
    createdAt: rowString(row, "created_at"),
    updatedAt: rowString(row, "updated_at"),
  };
}

function clearActionFromRow(row: SqlRow): F13ClearActionRecord {
  const choice = rowString(row, "choice");
  if (!isF13ClearChoice(choice)) throw new Error("F13_INVALID_ROW_choice");
  const reasonJson = rowString(row, "reason_json");
  return {
    actionId: rowString(row, "action_id"),
    operationId: rowString(row, "operation_id"),
    worktreeId: rowString(row, "worktree_id"),
    choice,
    confirmation: rowBoolean(row, "confirmation"),
    ...(rowOptionalString(row, "before_snapshot_id") === undefined
      ? {}
      : { beforeSnapshotId: rowOptionalString(row, "before_snapshot_id") }),
    ...(rowOptionalString(row, "after_snapshot_id") === undefined
      ? {}
      : { afterSnapshotId: rowOptionalString(row, "after_snapshot_id") }),
    ...(rowOptionalString(row, "current_snapshot_id") === undefined
      ? {}
      : { currentSnapshotId: rowOptionalString(row, "current_snapshot_id") }),
    status: rowString(row, "status"),
    outcome: parseJson<Payload>(row, "outcome_json"),
    ...(reasonJson === "{}"
      ? {}
      : {
          reason: parseJson<F13SafeReason>(row, "reason_json"),
        }),
    version: rowNumber(row, "version"),
    createdAt: rowString(row, "created_at"),
    updatedAt: rowString(row, "updated_at"),
  };
}

export class F13PersistenceRepositories {
  private readonly clock: PersistenceClock;

  public constructor(
    private readonly store: PersistenceStore,
    options: { readonly clock?: PersistenceClock } = {},
  ) {
    this.clock = options.clock ?? { now: () => new Date().toISOString() };
  }

  /**
   * Reserves both the generic F03 worktree record and the F13 operation intent
   * in one transaction.  This is the durable boundary that precedes clone or
   * worktree side effects.
   */
  public reserveOperation(input: F13OperationIntentInput): {
    readonly created: boolean;
    readonly intent: F13OperationIntentRecord;
  } {
    id(input.operationId, "operation identifier");
    id(input.idempotencyKey, "operation idempotency key");
    id(input.worktreeId, "worktree identifier");
    id(input.ownerType, "operation owner type");
    id(input.ownerId, "operation owner identifier");
    if (input.managedPrId !== undefined)
      id(input.managedPrId, "managed PR identifier");
    text(input.developerClonePath, "developer clone path");
    text(input.correlationId, "correlation identifier");
    text(input.configuredRoot, "configured worktree root");
    text(input.canonicalPath, "canonical worktree path");
    text(input.initialBaselineSha, "initial worktree baseline SHA");
    if (!Number.isInteger(input.rootRevision) || input.rootRevision < 0)
      throw repositoryError(
        this.store,
        "INVALID_RECORD",
        "The worktree root revision is not a non-negative integer.",
      );

    const source = encodeSnapshot(input.sourceRepository);
    const destination =
      input.destinationRepository === undefined
        ? undefined
        : encodeSnapshot(input.destinationRepository);
    const refs = encodeSnapshot(input.refs);
    const shaSnapshot = encodeSnapshot(input.shaSnapshot);
    const reason = encodeSnapshot(input.reason ?? {});
    const payload = encodeSnapshot({
      operationId: input.operationId,
      idempotencyKey: input.idempotencyKey,
      operationKind: input.operationKind,
    });
    const timestamp = now(this.clock);

    return this.store.transaction((transaction) => {
      const existingByOperation = transaction.get(
        "SELECT * FROM f13_operation_intents WHERE operation_id = ?",
        input.operationId,
      );
      const existingByKey = transaction.get(
        "SELECT * FROM f13_operation_intents WHERE idempotency_key = ?",
        input.idempotencyKey,
      );
      const existing = existingByOperation ?? existingByKey;
      if (existing !== undefined) {
        if (
          rowString(existing, "operation_id") !== input.operationId ||
          rowString(existing, "idempotency_key") !== input.idempotencyKey
        )
          throw repositoryError(
            this.store,
            "CONFLICT",
            "The idempotency key is already owned by another F13 operation.",
          );
        return { created: false, intent: intentFromRow(existing) };
      }

      const pathOwner = transaction.get(
        "SELECT operation_id FROM f13_operation_intents WHERE canonical_path = ?",
        input.canonicalPath,
      );
      if (pathOwner !== undefined)
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The canonical worktree path is already owned by another operation.",
        );
      const genericOwner = transaction.get(
        "SELECT worktree_id, owner_id FROM worktrees WHERE canonical_path = ?",
        input.canonicalPath,
      );
      if (genericOwner !== undefined)
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The canonical worktree path is already registered by another owner.",
        );
      const genericCaseInsensitiveOwner = transaction
        .all<{ worktree_id: string; canonical_path: string }>(
          "SELECT worktree_id, canonical_path FROM worktrees",
        )
        .find((row) =>
          process.platform === "win32"
            ? row.canonical_path.toLowerCase() ===
              input.canonicalPath.toLowerCase()
            : row.canonical_path === input.canonicalPath,
        );
      if (genericCaseInsensitiveOwner !== undefined)
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The canonical worktree path is already registered by another owner on this platform.",
        );
      const caseInsensitivePathOwner = transaction
        .all<{ operation_id: string; canonical_path: string }>(
          "SELECT operation_id, canonical_path FROM f13_operation_intents",
        )
        .find((row) =>
          process.platform === "win32"
            ? row.canonical_path.toLowerCase() ===
              input.canonicalPath.toLowerCase()
            : row.canonical_path === input.canonicalPath,
        );
      if (caseInsensitivePathOwner !== undefined)
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The canonical worktree path is already owned by another operation on this platform.",
        );

      transaction.run(
        "INSERT INTO worktrees (worktree_id, owner_type, owner_id, operation_kind, canonical_path, baseline_sha, current_sha, status, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, 'PENDING', ?, ?, ?)",
        input.worktreeId,
        input.ownerType,
        input.ownerId,
        input.operationKind,
        input.canonicalPath,
        input.initialBaselineSha,
        payload.payload,
        timestamp,
        timestamp,
      );
      transaction.run(
        "INSERT INTO f13_operation_intents (operation_id, idempotency_key, correlation_id, owner_type, owner_id, managed_pr_id, developer_clone_path, operation_kind, worktree_id, configured_root, root_revision, canonical_path, source_repository_json, source_repository_hash, destination_repository_json, destination_repository_hash, refs_json, refs_hash, sha_snapshot_json, sha_snapshot_hash, lifecycle, reason_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
        input.operationId,
        input.idempotencyKey,
        input.correlationId,
        input.ownerType,
        input.ownerId,
        input.managedPrId ?? null,
        input.developerClonePath,
        input.operationKind,
        input.worktreeId,
        input.configuredRoot,
        input.rootRevision,
        input.canonicalPath,
        source.payload,
        source.payloadHash,
        destination?.payload ?? null,
        destination?.payloadHash ?? null,
        refs.payload,
        refs.payloadHash,
        shaSnapshot.payload,
        shaSnapshot.payloadHash,
        input.lifecycle ?? "PENDING",
        reason.payload,
        timestamp,
        timestamp,
      );
      const row = transaction.get(
        "SELECT * FROM f13_operation_intents WHERE operation_id = ?",
        input.operationId,
      );
      if (row === undefined) throw new Error("F13_OPERATION_NOT_READABLE");
      return { created: true, intent: intentFromRow(row) };
    });
  }

  public getOperation(
    operationId: string,
  ): F13OperationIntentRecord | undefined {
    id(operationId, "operation identifier");
    return this.store.transaction(
      (transaction) => {
        const row = transaction.get(
          "SELECT * FROM f13_operation_intents WHERE operation_id = ?",
          operationId,
        );
        return row === undefined ? undefined : intentFromRow(row);
      },
      { maxAttempts: 1 },
    );
  }

  public getOperationByIdempotencyKey(
    idempotencyKey: string,
  ): F13OperationIntentRecord | undefined {
    id(idempotencyKey, "operation idempotency key");
    return this.store.transaction(
      (transaction) => {
        const row = transaction.get(
          "SELECT * FROM f13_operation_intents WHERE idempotency_key = ?",
          idempotencyKey,
        );
        return row === undefined ? undefined : intentFromRow(row);
      },
      { maxAttempts: 1 },
    );
  }

  public listOperationsForRecovery(): readonly F13OperationIntentRecord[] {
    return this.store
      .readAll(
        "SELECT * FROM f13_operation_intents WHERE lifecycle IN ('PENDING', 'PREPARING', 'ACTIVE', 'DIRTY', 'INTERRUPTED', 'UNKNOWN') ORDER BY updated_at, operation_id",
      )
      .map(intentFromRow);
  }

  public updateLifecycle(input: {
    readonly operationId: string;
    readonly expectedVersion?: number;
    readonly lifecycle: F13LifecycleState;
    readonly currentSha?: string;
    readonly reason?: F13SafeReason;
    readonly payload?: Payload;
  }): F13OperationIntentRecord {
    id(input.operationId, "operation identifier");
    const reason = encodeSnapshot(input.reason ?? {});
    const payload = encodeSnapshot(input.payload ?? {});
    const timestamp = now(this.clock);
    return this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT * FROM f13_operation_intents WHERE operation_id = ?",
        input.operationId,
      );
      if (existing === undefined)
        throw repositoryError(
          this.store,
          "NOT_FOUND",
          "The F13 operation intent no longer exists.",
        );
      const version = rowNumber(existing, "version");
      if (
        input.expectedVersion !== undefined &&
        input.expectedVersion !== version
      )
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The F13 operation changed before its lifecycle update was committed.",
        );
      const update = transaction.run(
        "UPDATE f13_operation_intents SET lifecycle = ?, reason_json = ?, version = version + 1, updated_at = ? WHERE operation_id = ? AND version = ?",
        input.lifecycle,
        reason.payload,
        timestamp,
        input.operationId,
        version,
      );
      if (update.changes !== 1)
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The F13 operation changed before its lifecycle update was committed.",
        );
      transaction.run(
        "UPDATE worktrees SET current_sha = COALESCE(?, current_sha), status = ?, payload_json = ?, updated_at = ? WHERE worktree_id = ?",
        input.currentSha ?? null,
        input.lifecycle,
        payload.payload,
        timestamp,
        rowString(existing, "worktree_id"),
      );
      const row = transaction.get(
        "SELECT * FROM f13_operation_intents WHERE operation_id = ?",
        input.operationId,
      );
      if (row === undefined) throw new Error("F13_OPERATION_NOT_READABLE");
      return intentFromRow(row);
    });
  }

  /**
   * Persists a merge base resolved from the approved source repository. The
   * value is filled exactly once so synchronization evidence remains immutable
   * after the operation has been reserved.
   */
  public resolveSynchronizationMergeBase(input: {
    readonly operationId: string;
    readonly expectedVersion: number;
    readonly mergeBaseSha: string;
  }): F13OperationIntentRecord {
    id(input.operationId, "operation identifier");
    text(input.mergeBaseSha, "synchronization merge-base SHA");
    return this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT * FROM f13_operation_intents WHERE operation_id = ?",
        input.operationId,
      );
      if (existing === undefined)
        throw repositoryError(
          this.store,
          "NOT_FOUND",
          "The F13 synchronization operation intent no longer exists.",
        );
      if (rowString(existing, "operation_kind") !== "SYNCHRONIZATION")
        throw repositoryError(
          this.store,
          "CONFLICT",
          "A merge base cannot be attached to a non-synchronization operation.",
        );
      const version = rowNumber(existing, "version");
      if (version !== input.expectedVersion)
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The synchronization operation changed before its merge base was committed.",
        );
      const refs = decodeJson<Record<string, unknown>>(
        existing,
        "refs_json",
        "refs_hash",
      );
      const shaSnapshot = decodeJson<Record<string, unknown>>(
        existing,
        "sha_snapshot_json",
        "sha_snapshot_hash",
      );
      const currentMergeBase = refs.syncMergeBaseSha;
      if (typeof currentMergeBase === "string") {
        if (currentMergeBase !== input.mergeBaseSha)
          throw repositoryError(
            this.store,
            "CONFLICT",
            "The synchronization merge base is immutable for an operation.",
          );
        return intentFromRow(existing);
      }
      const nextRefs = encodeSnapshot({
        ...refs,
        syncMergeBaseSha: input.mergeBaseSha,
      });
      const nextShaSnapshot = encodeSnapshot({
        ...shaSnapshot,
        syncMergeBaseSha: input.mergeBaseSha,
      });
      const timestamp = now(this.clock);
      const update = transaction.run(
        "UPDATE f13_operation_intents SET refs_json = ?, refs_hash = ?, sha_snapshot_json = ?, sha_snapshot_hash = ?, version = version + 1, updated_at = ? WHERE operation_id = ? AND version = ?",
        nextRefs.payload,
        nextRefs.payloadHash,
        nextShaSnapshot.payload,
        nextShaSnapshot.payloadHash,
        timestamp,
        input.operationId,
        version,
      );
      if (update.changes !== 1)
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The synchronization operation changed before its merge base was committed.",
        );
      const row = transaction.get(
        "SELECT * FROM f13_operation_intents WHERE operation_id = ?",
        input.operationId,
      );
      if (row === undefined) throw new Error("F13_OPERATION_NOT_READABLE");
      return intentFromRow(row);
    });
  }

  public saveSnapshot(input: F13SnapshotInput): F13SnapshotRecord {
    id(input.snapshotId, "snapshot identifier");
    id(input.operationId, "operation identifier");
    id(input.worktreeId, "worktree identifier");
    text(input.stateFingerprint, "snapshot state fingerprint");
    const manifest = encodeSnapshot(input.manifest);
    const summary =
      input.changeSummary === undefined
        ? undefined
        : encodeSnapshot(input.changeSummary);
    const timestamp = now(this.clock);
    this.store.transaction((transaction) => {
      transaction.run(
        "INSERT OR IGNORE INTO f13_worktree_snapshots (snapshot_id, operation_id, worktree_id, phase, turn_id, state_fingerprint, manifest_json, manifest_hash, change_summary_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        input.snapshotId,
        input.operationId,
        input.worktreeId,
        input.phase,
        input.turnId ?? null,
        input.stateFingerprint,
        manifest.payload,
        manifest.payloadHash,
        summary?.payload ?? null,
        timestamp,
      );
    });
    return this.getSnapshot(input.snapshotId) as F13SnapshotRecord;
  }

  public getSnapshot(snapshotId: string): F13SnapshotRecord | undefined {
    id(snapshotId, "snapshot identifier");
    return this.store.transaction(
      (transaction) => {
        const row = transaction.get(
          "SELECT * FROM f13_worktree_snapshots WHERE snapshot_id = ?",
          snapshotId,
        );
        if (row === undefined) return undefined;
        const summary = rowOptionalString(row, "change_summary_json");
        return {
          snapshotId: rowString(row, "snapshot_id"),
          operationId: rowString(row, "operation_id"),
          worktreeId: rowString(row, "worktree_id"),
          phase: rowString(row, "phase") as F13SnapshotPhase,
          ...(rowOptionalString(row, "turn_id") === undefined
            ? {}
            : { turnId: rowOptionalString(row, "turn_id") }),
          stateFingerprint: rowString(row, "state_fingerprint"),
          manifest: decodeJson<F13SnapshotManifest>(
            row,
            "manifest_json",
            "manifest_hash",
          ),
          ...(summary === undefined
            ? {}
            : {
                changeSummary: JSON.parse(summary) as F13ChangeSummary,
              }),
          createdAt: rowString(row, "created_at"),
        };
      },
      { maxAttempts: 1 },
    );
  }

  public listSnapshots(input: {
    readonly operationId: string;
    readonly turnId?: string;
  }): readonly F13SnapshotRecord[] {
    id(input.operationId, "operation identifier");
    const rows =
      input.turnId === undefined
        ? this.store.readAll(
            "SELECT * FROM f13_worktree_snapshots WHERE operation_id = ? ORDER BY created_at, snapshot_id",
            input.operationId,
          )
        : this.store.readAll(
            "SELECT * FROM f13_worktree_snapshots WHERE operation_id = ? AND turn_id = ? ORDER BY created_at, snapshot_id",
            input.operationId,
            input.turnId,
          );
    return rows.map(
      (row) =>
        this.getSnapshot(rowString(row, "snapshot_id")) as F13SnapshotRecord,
    );
  }

  public saveDiff(input: F13DiffInput): F13DiffEvidence {
    id(input.diffId, "diff identifier");
    id(input.operationId, "operation identifier");
    id(input.worktreeId, "worktree identifier");
    text(input.baselineSha, "diff baseline SHA");
    text(input.diffHash, "diff hash");
    text(input.patchHash, "patch hash");
    text(input.regenerationContract, "diff regeneration contract");
    if (input.patch !== undefined) assertBoundedText(input.patch, "diff patch");
    const metadata = encodeSnapshot({
      kind: input.kind,
      complete: input.complete,
      files: input.files,
      untrackedFiles: input.untrackedFiles,
      untrackedEvidence: input.untrackedEvidence ?? [],
    });
    const files = encodeSnapshot(input.files);
    const untracked = encodeSnapshot(input.untrackedFiles);
    const untrackedEvidence = encodeSnapshot(input.untrackedEvidence ?? []);
    const timestamp = now(this.clock);
    this.store.transaction((transaction) => {
      transaction.run(
        "INSERT OR IGNORE INTO diffs (diff_id, owner_type, owner_id, baseline_sha, current_sha, diff_hash, metadata_json, created_at) VALUES (?, 'F13_OPERATION', ?, ?, ?, ?, ?, ?)",
        input.diffId,
        input.operationId,
        input.baselineSha,
        input.currentSha ?? null,
        input.diffHash,
        metadata.payload,
        timestamp,
      );
      transaction.run(
        "INSERT OR IGNORE INTO f13_diff_evidence (diff_id, operation_id, worktree_id, diff_kind, patch_hash, patch_text, files_json, files_hash, untracked_files_json, untracked_files_hash, untracked_evidence_json, untracked_evidence_hash, complete, regeneration_contract, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        input.diffId,
        input.operationId,
        input.worktreeId,
        input.kind,
        input.patchHash,
        input.patch ?? null,
        files.payload,
        files.payloadHash,
        untracked.payload,
        untracked.payloadHash,
        untrackedEvidence.payload,
        untrackedEvidence.payloadHash,
        input.complete ? 1 : 0,
        input.regenerationContract,
        timestamp,
      );
    });
    return this.getDiff(input.diffId) as F13DiffEvidence;
  }

  public getDiff(diffId: string): F13DiffEvidence | undefined {
    id(diffId, "diff identifier");
    return this.store.transaction(
      (transaction) => {
        const row = transaction.get(
          "SELECT e.*, d.baseline_sha, d.current_sha, d.diff_hash FROM f13_diff_evidence e INNER JOIN diffs d ON d.diff_id = e.diff_id WHERE e.diff_id = ?",
          diffId,
        );
        if (row === undefined) return undefined;
        return {
          diffId: rowString(row, "diff_id"),
          operationId: rowString(row, "operation_id"),
          worktreeId: rowString(row, "worktree_id"),
          kind: rowString(row, "diff_kind") as F13DiffKind,
          baselineSha: rowString(row, "baseline_sha"),
          ...(rowOptionalString(row, "current_sha") === undefined
            ? {}
            : { currentSha: rowOptionalString(row, "current_sha") }),
          diffHash: rowString(row, "diff_hash"),
          patchHash: rowString(row, "patch_hash"),
          ...(rowOptionalString(row, "patch_text") === undefined
            ? {}
            : { patch: rowOptionalString(row, "patch_text") }),
          files: decodeJson<F13FileEvidence[]>(row, "files_json", "files_hash"),
          untrackedFiles: decodeJson<string[]>(
            row,
            "untracked_files_json",
            "untracked_files_hash",
          ),
          untrackedEvidence: decodeJson<F13FileEvidence[]>(
            row,
            "untracked_evidence_json",
            "untracked_evidence_hash",
          ),
          complete: rowBoolean(row, "complete"),
          regenerationContract: rowString(row, "regeneration_contract"),
          createdAt: rowString(row, "created_at"),
        };
      },
      { maxAttempts: 1 },
    );
  }

  public saveClearAction(input: F13ClearActionInput): void {
    id(input.actionId, "clear action identifier");
    id(input.operationId, "operation identifier");
    id(input.worktreeId, "worktree identifier");
    const outcome = encodeSnapshot(input.outcome ?? {});
    const reason = encodeSnapshot(input.reason ?? {});
    const timestamp = now(this.clock);
    this.store.transaction((transaction) =>
      transaction.run(
        "INSERT OR IGNORE INTO f13_clear_actions (action_id, operation_id, worktree_id, choice, confirmation, before_snapshot_id, after_snapshot_id, current_snapshot_id, status, outcome_json, reason_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
        input.actionId,
        input.operationId,
        input.worktreeId,
        input.choice,
        input.confirmation ? 1 : 0,
        input.beforeSnapshotId ?? null,
        input.afterSnapshotId ?? null,
        input.currentSnapshotId ?? null,
        input.status,
        outcome.payload,
        reason.payload,
        timestamp,
        timestamp,
      ),
    );
  }

  public getClearAction(actionId: string): F13ClearActionRecord | undefined {
    id(actionId, "clear action identifier");
    return this.store.transaction(
      (transaction) => {
        const row = transaction.get(
          "SELECT * FROM f13_clear_actions WHERE action_id = ?",
          actionId,
        );
        return row === undefined ? undefined : clearActionFromRow(row);
      },
      { maxAttempts: 1 },
    );
  }

  public updateClearAction(input: {
    readonly actionId: string;
    readonly status: string;
    readonly afterSnapshotId?: string;
    readonly outcome?: Payload;
    readonly reason?: F13SafeReason;
  }): void {
    id(input.actionId, "clear action identifier");
    const outcome = encodeSnapshot(input.outcome ?? {});
    const reason = encodeSnapshot(input.reason ?? {});
    const result = this.store.transaction((transaction) =>
      transaction.run(
        "UPDATE f13_clear_actions SET status = ?, after_snapshot_id = COALESCE(?, after_snapshot_id), outcome_json = ?, reason_json = ?, version = version + 1, updated_at = ? WHERE action_id = ?",
        input.status,
        input.afterSnapshotId ?? null,
        outcome.payload,
        reason.payload,
        now(this.clock),
        input.actionId,
      ),
    );
    if (result.changes !== 1)
      throw repositoryError(
        this.store,
        "NOT_FOUND",
        "The F13 clear action no longer exists.",
      );
  }

  public savePathAction(input: F13PathActionInput): void {
    id(input.actionId, "path action identifier");
    id(input.operationId, "operation identifier");
    id(input.worktreeId, "worktree identifier");
    const reason = encodeSnapshot(input.reason ?? {});
    this.store.transaction((transaction) =>
      transaction.run(
        "INSERT OR IGNORE INTO f13_path_actions (action_id, operation_id, worktree_id, action, requested_relative_path, resolved_path, outcome, reason_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        input.actionId,
        input.operationId,
        input.worktreeId,
        input.action,
        input.requestedRelativePath ?? null,
        input.resolvedPath ?? null,
        input.outcome,
        reason.payload,
        now(this.clock),
      ),
    );
  }

  public readWorktree(operationId: string): F13WorktreeRecord | undefined {
    const intent = this.getOperation(operationId);
    if (intent === undefined) return undefined;
    const generic = this.store.read(
      "SELECT current_sha FROM worktrees WHERE worktree_id = ?",
      intent.worktreeId,
    );
    const currentSha = rowOptionalString(generic ?? {}, "current_sha");
    return {
      worktreeId: intent.worktreeId,
      operationId: intent.operationId,
      ownerType: intent.ownerType,
      ownerId: intent.ownerId,
      operationKind: intent.operationKind,
      canonicalPath: intent.canonicalPath,
      configuredRoot: intent.configuredRoot,
      rootRevision: intent.rootRevision,
      lifecycle: intent.lifecycle,
      refs: intent.refs as F13WorktreeRecord["refs"],
      sourceRepository: intent.sourceRepository,
      ...(intent.managedPrId === undefined
        ? {}
        : { managedPrId: intent.managedPrId }),
      ...(intent.destinationRepository === undefined
        ? {}
        : { destinationRepository: intent.destinationRepository }),
      ...(currentSha === undefined ? {} : { currentHeadSha: currentSha }),
      worktreeBaselineSha:
        typeof intent.shaSnapshot === "object" &&
        intent.shaSnapshot !== null &&
        "worktreeBaselineSha" in intent.shaSnapshot &&
        typeof intent.shaSnapshot.worktreeBaselineSha === "string"
          ? intent.shaSnapshot.worktreeBaselineSha
          : typeof intent.shaSnapshot === "object" &&
              intent.shaSnapshot !== null &&
              "prHeadSha" in intent.shaSnapshot &&
              typeof intent.shaSnapshot.prHeadSha === "string"
            ? intent.shaSnapshot.prHeadSha
            : "",
      available: ["ACTIVE", "DIRTY", "RETAINED", "CLEARED"].includes(
        intent.lifecycle,
      ),
      ...(intent.reason === undefined ? {} : { reason: intent.reason }),
      version: intent.version,
      createdAt: intent.createdAt,
      updatedAt: intent.updatedAt,
    };
  }
}

export type { SafeJsonValue };
