import {
  decodeSnapshot,
  encodeSnapshot,
  assertBoundedIdentifier,
  assertBoundedText,
  type SafeJsonValue,
} from "./codecs";
import { PersistenceError } from "./types";
import type {
  PersistenceClock,
  PersistenceTransaction,
  PersistedRecord,
  PublicationIntentInput,
  PublicationResponseInput,
  RemoteEventVersionInput,
  ReviewBundleCommitInput,
  SqlRow,
} from "./types";
import type { PersistenceStore } from "./database";

type Payload = unknown;
type JsonObject = { readonly [key: string]: SafeJsonValue };

export interface RepositoryOptions {
  readonly clock?: PersistenceClock;
}

export interface RemoteEventInsertResult<T = unknown> {
  readonly inserted: boolean;
  readonly record: PersistedRecord<T> & {
    readonly managedPrId: string;
    readonly sourceKind: string;
    readonly sourceId: string;
    readonly semanticHash: string;
  };
}

export interface ReviewBundleRecord<T = unknown> extends PersistedRecord<T> {
  readonly managedPrId: string;
  readonly batchId: string;
  readonly state: string;
  readonly items: readonly {
    readonly id: string;
    readonly eventVersionId: string;
    readonly payload: unknown;
    readonly associatedAt: string;
  }[];
  readonly hold?: {
    readonly id: string;
    readonly state: string;
    readonly payload: unknown;
  };
}

export interface AiWorkOperationRecord<T = unknown> extends PersistedRecord<T> {
  readonly operationKind: string;
  readonly status: string;
  readonly configuredTurnBudget: number;
  readonly consumedTurnCount: number;
  readonly segments: readonly {
    readonly id: string;
    readonly index: number;
    readonly status: string;
    readonly configuredTurnBudget: number;
    readonly consumedTurnBaseline: number;
    readonly snapshot: unknown;
    readonly turns: readonly unknown[];
  }[];
}

export interface SynchronizationResultRecord<
  T = unknown,
> extends PersistedRecord<T> {
  readonly synchronizationBatchId: string;
  readonly managedPrId: string;
  readonly status: string;
  readonly sourceRepositoryId?: string;
  readonly destinationRepositoryId?: string;
  readonly sourceBranch?: string;
  readonly destinationBranch?: string;
  readonly syncSourceSha?: string;
  readonly prHeadSha?: string;
  readonly worktreeId?: string;
  readonly aiOperationId?: string;
  readonly diffId?: string;
  readonly validationRunId?: string;
  readonly reason: unknown;
  readonly conflicts: readonly {
    readonly path: string;
    readonly reason: unknown;
  }[];
}

export interface PublicationIntentRecord<
  T = unknown,
> extends PersistedRecord<T> {
  readonly kind: "REVIEW_BUNDLE" | "SYNCHRONIZATION_RESULT";
  readonly ownerId: string;
  readonly approvalId: string;
  readonly idempotencyKey: string;
  readonly phase: string;
  readonly recoveryState: string;
  readonly expectedBaselineSha?: string;
  readonly expectedSourceSha?: string;
  readonly expectedHeadSha?: string;
  readonly proposedResult: unknown;
  readonly knownCommitSha?: string;
  readonly responses: readonly {
    readonly responseKey: string;
    readonly state: string;
    readonly idempotencyKey: string;
    readonly attemptCount: number;
    readonly remoteId?: string;
    readonly errorCode?: string;
    readonly payload: unknown;
  }[];
}

function now(clock: PersistenceClock): string {
  const value = clock.now();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new Error("F03_CLOCK_MUST_RETURN_UTC_MILLISECONDS");
  }
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
  if (typeof value !== "string") throw new Error(`F03_INVALID_ROW_${key}`);
  return value;
}

function rowNumber(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number") throw new Error(`F03_INVALID_ROW_${key}`);
  return value;
}

function rowOptionalString(row: SqlRow, key: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`F03_INVALID_ROW_${key}`);
  return value;
}

function encode(value: unknown): ReturnType<typeof encodeSnapshot> {
  return encodeSnapshot(value);
}

function recordFromRow<T>(
  row: SqlRow,
  idKey: string,
  payloadJsonKey = "payload_json",
): PersistedRecord<T> {
  const encoded = {
    schemaVersion: rowNumber(row, "schema_version"),
    payload: rowString(row, payloadJsonKey),
    payloadHash: rowString(row, "payload_hash"),
  };
  return {
    id: rowString(row, idKey),
    schemaVersion: encoded.schemaVersion,
    version: rowNumber(row, "version"),
    createdAt: rowString(row, "created_at"),
    updatedAt: rowString(row, "updated_at"),
    payload: decodeSnapshot<T>(encoded, encoded.schemaVersion),
    payloadHash: encoded.payloadHash,
  };
}

function recordFromRevisionRow<T>(
  row: SqlRow,
  idKey: string,
): PersistedRecord<T> {
  const encoded = {
    schemaVersion: rowNumber(row, "schema_version"),
    payload: rowString(row, "payload_json"),
    payloadHash: rowString(row, "payload_hash"),
  };
  const revision = rowNumber(row, "revision");
  return {
    id: `${rowString(row, idKey)}:${revision}`,
    schemaVersion: encoded.schemaVersion,
    version: revision,
    createdAt: rowString(row, "created_at"),
    updatedAt: rowString(row, "created_at"),
    payload: decodeSnapshot<T>(encoded, encoded.schemaVersion),
    payloadHash: encoded.payloadHash,
  };
}

function recordFromJsonRow<T>(
  row: SqlRow,
  idKey: string,
  payloadKey: string,
): PersistedRecord<T> {
  const payload = JSON.parse(rowString(row, payloadKey)) as unknown;
  const encoded = encode(payload);
  return {
    id: rowString(row, idKey),
    schemaVersion: encoded.schemaVersion,
    version: rowNumber(row, "version"),
    createdAt: rowString(row, "created_at"),
    updatedAt: rowString(row, "updated_at"),
    payload: payload as T,
    payloadHash: encoded.payloadHash,
  };
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
    why:
      code === "CONFLICT"
        ? "A newer durable writer owns the aggregate version."
        : "The requested durable record cannot be safely used.",
    nextAction: code === "CONFLICT" ? "RECONCILE" : "FIX_INPUT",
    correlationId: store.health.correlationId,
    databaseId: store.health.databaseId,
    details: {},
  });
}

function insertOrExisting<T extends SqlRow>(
  transaction: PersistenceTransaction,
  sql: string,
  parameters: readonly (string | number | null)[],
  lookupSql: string,
  lookupParameters: readonly (string | number | null)[],
): { readonly inserted: boolean; readonly row: T } {
  const result = transaction.run(sql, ...parameters);
  const row = transaction.get<T>(lookupSql, ...lookupParameters);
  if (row === undefined) throw new Error("F03_INSERT_NOT_READABLE");
  return { inserted: result.changes > 0, row };
}

export class PersistenceRepositories {
  private readonly clock: PersistenceClock;

  public constructor(
    private readonly store: PersistenceStore,
    options: RepositoryOptions = {},
  ) {
    this.clock = options.clock ?? { now: () => new Date().toISOString() };
  }

  public putSetting<T>(
    settingKey: string,
    payload: T,
    expectedVersion?: number,
  ): PersistedRecord<T> {
    text(settingKey, "setting key");
    const encoded = encode(payload);
    const timestamp = now(this.clock);
    return this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT * FROM settings WHERE setting_key = ?",
        settingKey,
      );
      const currentVersion =
        existing === undefined ? 0 : rowNumber(existing, "version");
      if (expectedVersion !== undefined && currentVersion !== expectedVersion)
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The setting changed before this update was committed.",
        );
      if (existing === undefined) {
        transaction.run(
          "INSERT INTO settings (setting_key, schema_version, value_json, value_hash, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
          settingKey,
          encoded.schemaVersion,
          encoded.payload,
          encoded.payloadHash,
          timestamp,
          timestamp,
        );
      } else {
        transaction.run(
          "UPDATE settings SET schema_version = ?, value_json = ?, value_hash = ?, version = ?, updated_at = ? WHERE setting_key = ? AND version = ?",
          encoded.schemaVersion,
          encoded.payload,
          encoded.payloadHash,
          currentVersion + 1,
          timestamp,
          settingKey,
          currentVersion,
        );
      }
      const row = transaction.get(
        "SELECT setting_key, schema_version, value_json AS payload_json, value_hash AS payload_hash, version, created_at, updated_at FROM settings WHERE setting_key = ?",
        settingKey,
      );
      if (row === undefined) throw new Error("F03_SETTING_NOT_READABLE");
      return recordFromRow<T>(row, "setting_key");
    });
  }

  public getSetting<T>(settingKey: string): PersistedRecord<T> | undefined {
    const row = this.store.read(
      "SELECT setting_key, schema_version, value_json AS payload_json, value_hash AS payload_hash, version, created_at, updated_at FROM settings WHERE setting_key = ?",
      settingKey,
    );
    return row === undefined ? undefined : recordFromRow<T>(row, "setting_key");
  }

  public putConfigurationSnapshot<T>(
    ownerType: string,
    ownerId: string,
    revision: number,
    payload: T,
  ): PersistedRecord<T> {
    text(ownerType, "configuration owner type");
    id(ownerId, "configuration owner id");
    if (!Number.isInteger(revision) || revision < 1)
      throw repositoryError(
        this.store,
        "INVALID_RECORD",
        "Configuration revisions must be positive integers.",
      );
    const encoded = encode(payload);
    const timestamp = now(this.clock);
    return this.store.transaction((transaction) => {
      transaction.run(
        "INSERT OR IGNORE INTO configuration_snapshots (snapshot_id, owner_type, owner_id, revision, schema_version, payload_json, payload_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        `${ownerType}:${ownerId}:${revision}`,
        ownerType,
        ownerId,
        revision,
        encoded.schemaVersion,
        encoded.payload,
        encoded.payloadHash,
        timestamp,
      );
      const row = transaction.get(
        "SELECT snapshot_id AS id, schema_version, payload_json, payload_hash, revision, created_at FROM configuration_snapshots WHERE owner_type = ? AND owner_id = ? AND revision = ?",
        ownerType,
        ownerId,
        revision,
      );
      if (row === undefined) throw new Error("F03_CONFIGURATION_NOT_READABLE");
      return recordFromRevisionRow<T>(row, "id");
    });
  }

  public putValidationProfile<T>(
    profileId: string,
    revision: number,
    payload: T,
  ): PersistedRecord<T> {
    return this.putRevisioned(
      "validation_profiles",
      "profile_id",
      profileId,
      revision,
      payload,
    );
  }

  public putCommonInstructions<T>(
    instructionId: string,
    revision: number,
    payload: T,
  ): PersistedRecord<T> {
    return this.putRevisioned(
      "common_instructions",
      "instruction_id",
      instructionId,
      revision,
      payload,
    );
  }

  public putAiTaskProfile<T>(
    profileId: string,
    revision: number,
    payload: T,
  ): PersistedRecord<T> {
    return this.putRevisioned(
      "ai_task_profiles",
      "profile_id",
      profileId,
      revision,
      payload,
    );
  }

  public putExecutionPolicy<T>(
    policyId: string,
    revision: number,
    payload: T,
  ): PersistedRecord<T> {
    return this.putRevisioned(
      "execution_policies",
      "policy_id",
      policyId,
      revision,
      payload,
    );
  }

  private putRevisioned<T>(
    table: string,
    idColumn: string,
    recordId: string,
    revision: number,
    payload: T,
  ): PersistedRecord<T> {
    id(recordId, `${table} identifier`);
    if (!Number.isInteger(revision) || revision < 1)
      throw repositoryError(
        this.store,
        "INVALID_RECORD",
        "Revision must be a positive integer.",
      );
    const encoded = encode(payload);
    const timestamp = now(this.clock);
    return this.store.transaction((transaction) => {
      transaction.run(
        `INSERT OR IGNORE INTO ${table} (${idColumn}, revision, schema_version, payload_json, payload_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        recordId,
        revision,
        encoded.schemaVersion,
        encoded.payload,
        encoded.payloadHash,
        timestamp,
      );
      const row = transaction.get(
        `SELECT ${idColumn} AS id, schema_version, payload_json, payload_hash, revision, created_at FROM ${table} WHERE ${idColumn} = ? AND revision = ?`,
        recordId,
        revision,
      );
      if (row === undefined)
        throw new Error(`F03_${table.toUpperCase()}_NOT_READABLE`);
      return recordFromRevisionRow<T>(row, "id");
    });
  }

  public saveApproval<T>(input: {
    readonly approvalId: string;
    readonly scope: string;
    readonly reviewedSnapshotHash?: string;
    readonly payload: T;
  }): void {
    id(input.approvalId, "approval identifier");
    text(input.scope, "approval scope");
    const encoded = encode(input.payload);
    const timestamp = now(this.clock);
    this.store.transaction((transaction) => {
      transaction.run(
        "INSERT OR IGNORE INTO approvals (approval_id, scope, reviewed_snapshot_hash, approved_at, payload_json) VALUES (?, ?, ?, ?, ?)",
        input.approvalId,
        input.scope,
        input.reviewedSnapshotHash ?? null,
        timestamp,
        encoded.payload,
      );
    });
  }

  public putGithubServer(input: {
    readonly serverId: string;
    readonly host: string;
    readonly apiBaseUrl: string;
    readonly credentialRef?: string;
    readonly metadata?: Payload;
    readonly expectedVersion?: number;
  }): PersistedRecord<JsonObject> {
    id(input.serverId, "GitHub server identifier");
    text(input.host, "GitHub server host");
    text(input.apiBaseUrl, "GitHub API base URL");
    if (input.credentialRef !== undefined)
      text(input.credentialRef, "credential reference");
    const metadata = encode(input.metadata ?? {});
    const timestamp = now(this.clock);
    return this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT * FROM github_servers WHERE server_id = ?",
        input.serverId,
      );
      const current =
        existing === undefined ? 0 : rowNumber(existing, "version");
      if (
        input.expectedVersion !== undefined &&
        current !== input.expectedVersion
      )
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The GitHub server profile changed before this update was committed.",
        );
      if (existing === undefined)
        transaction.run(
          "INSERT INTO github_servers (server_id, host, api_base_url, credential_ref, metadata_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
          input.serverId,
          input.host,
          input.apiBaseUrl,
          input.credentialRef ?? null,
          metadata.payload,
          timestamp,
          timestamp,
        );
      else
        transaction.run(
          "UPDATE github_servers SET host = ?, api_base_url = ?, credential_ref = ?, metadata_json = ?, version = ?, updated_at = ? WHERE server_id = ? AND version = ?",
          input.host,
          input.apiBaseUrl,
          input.credentialRef ?? null,
          metadata.payload,
          current + 1,
          timestamp,
          input.serverId,
          current,
        );
      const row = transaction.get(
        "SELECT server_id AS id, 1 AS schema_version, metadata_json AS payload_json, ? AS payload_hash, version, created_at, updated_at FROM github_servers WHERE server_id = ?",
        metadata.payloadHash,
        input.serverId,
      );
      if (row === undefined) throw new Error("F03_SERVER_NOT_READABLE");
      return recordFromRow<JsonObject>(row, "id");
    });
  }

  public putRepository(input: {
    readonly repositoryId: string;
    readonly serverId: string;
    readonly owner: string;
    readonly name: string;
    readonly defaultBranch?: string;
    readonly metadata?: Payload;
    readonly expectedVersion?: number;
  }): PersistedRecord<JsonObject> {
    id(input.repositoryId, "repository identifier");
    id(input.serverId, "GitHub server identifier");
    text(input.owner, "repository owner");
    text(input.name, "repository name");
    if (input.defaultBranch !== undefined)
      text(input.defaultBranch, "repository default branch");
    const metadata = encode(input.metadata ?? {});
    const timestamp = now(this.clock);
    return this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT * FROM repositories WHERE repository_id = ?",
        input.repositoryId,
      );
      const current =
        existing === undefined ? 0 : rowNumber(existing, "version");
      if (
        input.expectedVersion !== undefined &&
        current !== input.expectedVersion
      )
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The repository changed before this update was committed.",
        );
      if (existing === undefined)
        transaction.run(
          "INSERT INTO repositories (repository_id, server_id, owner, name, default_branch, metadata_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
          input.repositoryId,
          input.serverId,
          input.owner,
          input.name,
          input.defaultBranch ?? null,
          metadata.payload,
          timestamp,
          timestamp,
        );
      else
        transaction.run(
          "UPDATE repositories SET server_id = ?, owner = ?, name = ?, default_branch = ?, metadata_json = ?, version = ?, updated_at = ? WHERE repository_id = ? AND version = ?",
          input.serverId,
          input.owner,
          input.name,
          input.defaultBranch ?? null,
          metadata.payload,
          current + 1,
          timestamp,
          input.repositoryId,
          current,
        );
      const row = transaction.get(
        "SELECT repository_id AS id, 1 AS schema_version, metadata_json AS payload_json, ? AS payload_hash, version, created_at, updated_at FROM repositories WHERE repository_id = ?",
        metadata.payloadHash,
        input.repositoryId,
      );
      if (row === undefined) throw new Error("F03_REPOSITORY_NOT_READABLE");
      return recordFromRow<JsonObject>(row, "id");
    });
  }

  public putManagedPr(input: {
    readonly managedPrId: string;
    readonly serverId: string;
    readonly baseRepositoryId: string;
    readonly headRepositoryId: string;
    readonly number: number;
    readonly baseBranch: string;
    readonly headBranch: string;
    readonly baseSha: string;
    readonly headSha: string;
    readonly state: string;
    readonly intent?: Payload;
    readonly metadata?: Payload;
    readonly syncSourceBranchOverride?: string;
    readonly expectedVersion?: number;
  }): PersistedRecord<JsonObject> {
    id(input.managedPrId, "managed PR identifier");
    for (const [value, label] of [
      [input.serverId, "server identifier"],
      [input.baseRepositoryId, "base repository identifier"],
      [input.headRepositoryId, "head repository identifier"],
    ] as const)
      id(value, label);
    for (const [value, label] of [
      [input.baseBranch, "base branch"],
      [input.headBranch, "head branch"],
      [input.baseSha, "base SHA"],
      [input.headSha, "head SHA"],
      [input.state, "managed PR state"],
    ] as const)
      text(value, label);
    if (!Number.isInteger(input.number) || input.number < 1)
      throw repositoryError(
        this.store,
        "INVALID_RECORD",
        "A managed PR number must be a positive integer.",
      );
    const intent = encode(input.intent ?? {});
    const metadata = encode(input.metadata ?? {});
    const timestamp = now(this.clock);
    return this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT * FROM managed_prs WHERE managed_pr_id = ?",
        input.managedPrId,
      );
      const current =
        existing === undefined ? 0 : rowNumber(existing, "version");
      if (
        input.expectedVersion !== undefined &&
        current !== input.expectedVersion
      )
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The managed PR changed before this update was committed.",
        );
      if (existing === undefined)
        transaction.run(
          "INSERT INTO managed_prs (managed_pr_id, server_id, base_repository_id, head_repository_id, number, base_branch, head_branch, base_sha, head_sha, sync_source_branch_override, state, version, intent_json, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)",
          input.managedPrId,
          input.serverId,
          input.baseRepositoryId,
          input.headRepositoryId,
          input.number,
          input.baseBranch,
          input.headBranch,
          input.baseSha,
          input.headSha,
          input.syncSourceBranchOverride ?? null,
          input.state,
          intent.payload,
          metadata.payload,
          timestamp,
          timestamp,
        );
      else
        transaction.run(
          "UPDATE managed_prs SET server_id = ?, base_repository_id = ?, head_repository_id = ?, number = ?, base_branch = ?, head_branch = ?, base_sha = ?, head_sha = ?, sync_source_branch_override = ?, state = ?, version = ?, intent_json = ?, metadata_json = ?, updated_at = ? WHERE managed_pr_id = ? AND version = ?",
          input.serverId,
          input.baseRepositoryId,
          input.headRepositoryId,
          input.number,
          input.baseBranch,
          input.headBranch,
          input.baseSha,
          input.headSha,
          input.syncSourceBranchOverride ?? null,
          input.state,
          current + 1,
          intent.payload,
          metadata.payload,
          timestamp,
          input.managedPrId,
          current,
        );
      const row = transaction.get(
        "SELECT managed_pr_id AS id, 1 AS schema_version, metadata_json AS payload_json, ? AS payload_hash, version, created_at, updated_at FROM managed_prs WHERE managed_pr_id = ?",
        metadata.payloadHash,
        input.managedPrId,
      );
      if (row === undefined) throw new Error("F03_MANAGED_PR_NOT_READABLE");
      return recordFromRow<JsonObject>(row, "id");
    });
  }

  public putResourceCheckpoint(input: {
    readonly checkpointId?: string;
    readonly serverId: string;
    readonly repositoryId?: string;
    readonly resourceKind: string;
    readonly resourceKey: string;
    readonly etag?: string;
    readonly lastModified?: string;
    readonly paginationCursor?: string;
    readonly observedVersion?: number;
    readonly payload?: Payload;
  }): void {
    id(input.serverId, "server identifier");
    if (input.repositoryId !== undefined)
      id(input.repositoryId, "repository identifier");
    for (const [value, label] of [
      [input.resourceKind, "resource kind"],
      [input.resourceKey, "resource key"],
    ] as const)
      text(value, label);
    const encoded = encode(input.payload ?? {});
    const timestamp = now(this.clock);
    this.store.transaction((transaction) => {
      const current = transaction.get(
        "SELECT checkpoint_id FROM resource_checkpoints WHERE server_id = ? AND repository_id IS ? AND resource_kind = ? AND resource_key = ?",
        input.serverId,
        input.repositoryId ?? null,
        input.resourceKind,
        input.resourceKey,
      );
      if (current === undefined)
        transaction.run(
          "INSERT INTO resource_checkpoints (server_id, repository_id, resource_kind, resource_key, etag, last_modified, pagination_cursor, observed_version, payload_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          input.serverId,
          input.repositoryId ?? null,
          input.resourceKind,
          input.resourceKey,
          input.etag ?? null,
          input.lastModified ?? null,
          input.paginationCursor ?? null,
          input.observedVersion ?? 0,
          encoded.payload,
          timestamp,
        );
      else
        transaction.run(
          "UPDATE resource_checkpoints SET etag = ?, last_modified = ?, pagination_cursor = ?, observed_version = ?, payload_json = ?, updated_at = ? WHERE checkpoint_id = ?",
          input.etag ?? null,
          input.lastModified ?? null,
          input.paginationCursor ?? null,
          input.observedVersion ?? 0,
          encoded.payload,
          timestamp,
          rowNumber(current, "checkpoint_id"),
        );
    });
  }

  public putResourceObservation(input: {
    readonly observationId: string;
    readonly managedPrId?: string;
    readonly serverId: string;
    readonly resourceKind: string;
    readonly resourceKey: string;
    readonly remoteIdentity: string;
    readonly observedAt: string;
    readonly semanticHash: string;
    readonly payload: Payload;
  }): void {
    id(input.observationId, "resource observation identifier");
    id(input.serverId, "server identifier");
    if (input.managedPrId !== undefined)
      id(input.managedPrId, "managed PR identifier");
    for (const [value, label] of [
      [input.resourceKind, "resource kind"],
      [input.resourceKey, "resource key"],
      [input.remoteIdentity, "remote identity"],
      [input.semanticHash, "resource semantic hash"],
    ] as const)
      text(value, label);
    const encoded = encode(input.payload);
    this.store.transaction((transaction) => {
      transaction.run(
        "INSERT OR IGNORE INTO resource_observations (observation_id, managed_pr_id, server_id, resource_kind, resource_key, remote_identity, observed_at, semantic_hash, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        input.observationId,
        input.managedPrId ?? null,
        input.serverId,
        input.resourceKind,
        input.resourceKey,
        input.remoteIdentity,
        input.observedAt,
        input.semanticHash,
        encoded.payload,
      );
    });
  }

  public putValidationApproval(input: {
    readonly approvalId: string;
    readonly profileId: string;
    readonly profileRevision: number;
    readonly contentHash: string;
    readonly payload: Payload;
    readonly approvedAt?: string;
  }): void {
    id(input.approvalId, "validation approval identifier");
    id(input.profileId, "validation profile identifier");
    if (!Number.isInteger(input.profileRevision) || input.profileRevision < 1)
      throw repositoryError(
        this.store,
        "INVALID_RECORD",
        "Validation approval revisions must be positive integers.",
      );
    text(input.contentHash, "validation profile content hash");
    const encoded = encode(input.payload);
    this.store.transaction((transaction) => {
      transaction.run(
        "INSERT OR IGNORE INTO validation_approvals (approval_id, profile_id, profile_revision, content_hash, approved_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
        input.approvalId,
        input.profileId,
        input.profileRevision,
        input.contentHash,
        input.approvedAt ?? now(this.clock),
        encoded.payload,
      );
    });
  }

  public getManagedPr<T = JsonObject>(
    managedPrId: string,
  ): PersistedRecord<T> | undefined {
    id(managedPrId, "managed PR identifier");
    const row = this.store.read(
      "SELECT managed_pr_id AS id, metadata_json AS payload_json, version, created_at, updated_at FROM managed_prs WHERE managed_pr_id = ?",
      managedPrId,
    );
    return row === undefined
      ? undefined
      : recordFromJsonRow<T>(row, "id", "payload_json");
  }

  public getGithubServer<T = JsonObject>(
    serverId: string,
  ): PersistedRecord<T> | undefined {
    id(serverId, "GitHub server identifier");
    const row = this.store.read(
      "SELECT server_id AS id, metadata_json AS payload_json, version, created_at, updated_at FROM github_servers WHERE server_id = ?",
      serverId,
    );
    return row === undefined
      ? undefined
      : recordFromJsonRow<T>(row, "id", "payload_json");
  }

  public insertRemoteEventVersion<T = unknown>(
    input: RemoteEventVersionInput<T>,
  ): RemoteEventInsertResult<T> {
    id(input.id, "remote event version identifier");
    id(input.managedPrId, "managed PR identifier");
    text(input.sourceKind, "remote event source kind");
    text(input.sourceId, "remote event source identifier");
    text(input.semanticHash, "remote event semantic hash");
    const encoded = encode(input.payload);
    const timestamp = now(this.clock);
    return this.store.transaction((transaction) => {
      const byId = transaction.get(
        "SELECT * FROM remote_event_versions WHERE event_version_id = ?",
        input.id,
      );
      if (
        byId !== undefined &&
        (rowString(byId, "semantic_hash") !== input.semanticHash ||
          rowString(byId, "payload_json") !== encoded.payload)
      )
        throw repositoryError(
          this.store,
          "CONFLICT",
          "An immutable remote event identifier cannot be rewritten.",
        );
      const inserted = insertOrExisting(
        transaction,
        "INSERT OR IGNORE INTO remote_event_versions (event_version_id, managed_pr_id, source_kind, source_id, source_repository_id, observed_at, source_updated_at, semantic_hash, schema_version, payload_json, payload_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          input.id,
          input.managedPrId,
          input.sourceKind,
          input.sourceId,
          input.sourceRepositoryId ?? null,
          input.observedAt,
          input.sourceUpdatedAt ?? null,
          input.semanticHash,
          encoded.schemaVersion,
          encoded.payload,
          encoded.payloadHash,
          timestamp,
        ],
        "SELECT *, 1 AS version, created_at AS updated_at FROM remote_event_versions WHERE managed_pr_id = ? AND source_kind = ? AND source_id = ? AND semantic_hash = ?",
        [
          input.managedPrId,
          input.sourceKind,
          input.sourceId,
          input.semanticHash,
        ],
      );
      const row = inserted.row;
      return {
        inserted: inserted.inserted,
        record: {
          ...recordFromRow<T>(row, "event_version_id"),
          managedPrId: rowString(row, "managed_pr_id"),
          sourceKind: rowString(row, "source_kind"),
          sourceId: rowString(row, "source_id"),
          semanticHash: rowString(row, "semantic_hash"),
        },
      };
    });
  }

  public persistReviewBundleAtomic(
    input: ReviewBundleCommitInput,
  ): ReviewBundleRecord {
    id(input.batch.id, "review batch identifier");
    id(input.bundle.id, "Review Bundle identifier");
    id(input.bundle.managedPrId, "managed PR identifier");
    const batchEncoded = encode(input.batch.payload);
    const bundleEncoded = encode(input.bundle.payload);
    const itemEncoded = input.items.map((item) => ({
      ...item,
      encoded: encode(item.payload),
    }));
    const eventEncoded = input.events.map((event) => ({
      ...event,
      encoded: encode(event.payload),
    }));
    const holdEncoded =
      input.hold === undefined ? undefined : encode(input.hold.payload);
    const transitionEncoded =
      input.transition === undefined
        ? undefined
        : encode(input.transition.payload);
    const timestamp = now(this.clock);
    return this.store.transaction((transaction) => {
      const existingById = transaction.get(
        "SELECT * FROM review_bundles WHERE bundle_id = ?",
        input.bundle.id,
      );
      const existingByKey =
        input.bundle.automaticOperationKey === undefined
          ? undefined
          : transaction.get(
              "SELECT * FROM review_bundles WHERE managed_pr_id = ? AND automatic_operation_key = ?",
              input.bundle.managedPrId,
              input.bundle.automaticOperationKey,
            );
      if (existingById !== undefined)
        return this.readReviewBundleFromTransaction(transaction, existingById);
      if (existingByKey !== undefined)
        return this.readReviewBundleFromTransaction(transaction, existingByKey);
      transaction.run(
        "INSERT OR IGNORE INTO review_batches (batch_id, managed_pr_id, schema_version, payload_json, payload_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        input.batch.id,
        input.batch.managedPrId,
        batchEncoded.schemaVersion,
        batchEncoded.payload,
        batchEncoded.payloadHash,
        timestamp,
      );
      for (const event of eventEncoded)
        transaction.run(
          "INSERT OR IGNORE INTO remote_event_versions (event_version_id, managed_pr_id, source_kind, source_id, source_repository_id, observed_at, source_updated_at, semantic_hash, schema_version, payload_json, payload_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          event.id,
          event.managedPrId,
          event.sourceKind,
          event.sourceId,
          event.sourceRepositoryId ?? null,
          event.observedAt,
          event.sourceUpdatedAt ?? null,
          event.semanticHash,
          event.encoded.schemaVersion,
          event.encoded.payload,
          event.encoded.payloadHash,
          timestamp,
        );
      transaction.run(
        "INSERT OR IGNORE INTO review_bundles (bundle_id, managed_pr_id, batch_id, state, automatic_operation_key, schema_version, payload_json, payload_hash, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
        input.bundle.id,
        input.bundle.managedPrId,
        input.batch.id,
        input.bundle.state,
        input.bundle.automaticOperationKey ?? null,
        bundleEncoded.schemaVersion,
        bundleEncoded.payload,
        bundleEncoded.payloadHash,
        timestamp,
        timestamp,
      );
      for (const item of itemEncoded) {
        transaction.run(
          "INSERT OR IGNORE INTO review_bundle_items (item_id, bundle_id, event_version_id, schema_version, payload_json, payload_hash, associated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          item.id,
          input.bundle.id,
          item.eventVersionId,
          item.encoded.schemaVersion,
          item.encoded.payload,
          item.encoded.payloadHash,
          timestamp,
        );
        transaction.run(
          "INSERT OR IGNORE INTO handled_event_versions (event_version_id, bundle_id, association_state, associated_at, payload_json) VALUES (?, ?, 'ASSIGNED_TO_ACTIVE_BUNDLE', ?, ?)",
          item.eventVersionId,
          input.bundle.id,
          timestamp,
          item.encoded.payload,
        );
      }
      if (input.hold !== undefined && holdEncoded !== undefined)
        transaction.run(
          "INSERT OR IGNORE INTO review_holds (hold_id, managed_pr_id, bundle_id, state, payload_json, acquired_at, version) VALUES (?, ?, ?, 'ACTIVE', ?, ?, 1)",
          input.hold.id,
          input.hold.managedPrId,
          input.hold.bundleId,
          holdEncoded.payload,
          timestamp,
        );
      if (input.transition !== undefined && transitionEncoded !== undefined)
        transaction.run(
          "INSERT OR IGNORE INTO transition_history (transition_id, aggregate_type, aggregate_id, sequence, prior_state, current_state, schema_version, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          input.transition.id,
          input.transition.aggregateType,
          input.transition.aggregateId,
          input.transition.sequence,
          input.transition.priorState ?? null,
          input.transition.currentState,
          transitionEncoded.schemaVersion,
          transitionEncoded.payload,
          timestamp,
        );
      const managed = transaction.get(
        "SELECT version FROM managed_prs WHERE managed_pr_id = ?",
        input.bundle.managedPrId,
      );
      if (managed === undefined)
        throw repositoryError(
          this.store,
          "NOT_FOUND",
          "The Review Bundle owner PR does not exist.",
        );
      const expected = input.managedPrExpectedVersion;
      const update =
        expected === undefined
          ? transaction.run(
              "UPDATE managed_prs SET state = ?, version = version + 1, updated_at = ? WHERE managed_pr_id = ?",
              input.bundle.state,
              timestamp,
              input.bundle.managedPrId,
            )
          : transaction.run(
              "UPDATE managed_prs SET state = ?, version = version + 1, updated_at = ? WHERE managed_pr_id = ? AND version = ?",
              input.bundle.state,
              timestamp,
              input.bundle.managedPrId,
              expected,
            );
      if (update.changes !== 1)
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The PR changed before the Review Bundle hold could be committed.",
        );
      const bundle = transaction.get(
        "SELECT * FROM review_bundles WHERE bundle_id = ?",
        input.bundle.id,
      );
      if (bundle === undefined) throw new Error("F03_BUNDLE_NOT_READABLE");
      return this.readReviewBundleFromTransaction(transaction, bundle);
    });
  }

  public getReviewBundle(bundleId: string): ReviewBundleRecord | undefined {
    id(bundleId, "Review Bundle identifier");
    return this.store.read(
      "SELECT * FROM review_bundles WHERE bundle_id = ?",
      bundleId,
    ) === undefined
      ? undefined
      : this.store.transaction(
          (transaction) => {
            const row = transaction.get(
              "SELECT * FROM review_bundles WHERE bundle_id = ?",
              bundleId,
            );
            return row === undefined
              ? undefined
              : this.readReviewBundleFromTransaction(transaction, row);
          },
          { maxAttempts: 1 },
        );
  }

  private readReviewBundleFromTransaction(
    transaction: PersistenceTransaction,
    row: SqlRow,
  ): ReviewBundleRecord {
    const base = recordFromRow(row, "bundle_id");
    const itemRows = transaction.all(
      "SELECT * FROM review_bundle_items WHERE bundle_id = ? ORDER BY associated_at, item_id",
      rowString(row, "bundle_id"),
    );
    const hold = transaction.get(
      "SELECT * FROM review_holds WHERE bundle_id = ? ORDER BY acquired_at DESC LIMIT 1",
      rowString(row, "bundle_id"),
    );
    return {
      ...base,
      managedPrId: rowString(row, "managed_pr_id"),
      batchId: rowString(row, "batch_id"),
      state: rowString(row, "state"),
      items: itemRows.map((item) => ({
        id: rowString(item, "item_id"),
        eventVersionId: rowString(item, "event_version_id"),
        payload: decodeSnapshot(
          {
            schemaVersion: rowNumber(item, "schema_version"),
            payload: rowString(item, "payload_json"),
            payloadHash: rowString(item, "payload_hash"),
          },
          rowNumber(item, "schema_version"),
        ),
        associatedAt: rowString(item, "associated_at"),
      })),
      ...(hold === undefined
        ? {}
        : {
            hold: {
              id: rowString(hold, "hold_id"),
              state: rowString(hold, "state"),
              payload: JSON.parse(rowString(hold, "payload_json")) as unknown,
            },
          }),
    };
  }

  public appendTransition(input: {
    readonly transitionId: string;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly sequence: number;
    readonly priorState?: string;
    readonly currentState: string;
    readonly payload: Payload;
  }): void {
    id(input.transitionId, "transition identifier");
    text(input.aggregateType, "transition aggregate type");
    id(input.aggregateId, "transition aggregate id");
    const encoded = encode(input.payload);
    this.store.transaction((transaction) => {
      transaction.run(
        "INSERT OR IGNORE INTO transition_history (transition_id, aggregate_type, aggregate_id, sequence, prior_state, current_state, schema_version, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        input.transitionId,
        input.aggregateType,
        input.aggregateId,
        input.sequence,
        input.priorState ?? null,
        input.currentState,
        encoded.schemaVersion,
        encoded.payload,
        now(this.clock),
      );
    });
  }

  public releaseReviewHold(input: {
    readonly managedPrId: string;
    readonly bundleId: string;
    readonly expectedVersion: number;
    readonly releasedAt?: string;
  }): void {
    id(input.managedPrId, "managed PR identifier");
    id(input.bundleId, "Review Bundle identifier");
    const result = this.store.transaction((transaction) =>
      transaction.run(
        "UPDATE review_holds SET state = 'RELEASED', released_at = ?, version = version + 1 WHERE managed_pr_id = ? AND bundle_id = ? AND state = 'ACTIVE' AND version = ?",
        input.releasedAt ?? now(this.clock),
        input.managedPrId,
        input.bundleId,
        input.expectedVersion,
      ),
    );
    if (result.changes !== 1)
      throw repositoryError(
        this.store,
        "CONFLICT",
        "The review hold changed before release was committed.",
      );
  }

  public associateHandledEventVersion(input: {
    readonly eventVersionId: string;
    readonly bundleId: string;
    readonly state:
      | "ASSIGNED_TO_ACTIVE_BUNDLE"
      | "RETAINED_DURING_HOLD"
      | "HANDLED_BY_BUNDLE";
    readonly handledAt?: string;
    readonly payload?: Payload;
  }): void {
    id(input.eventVersionId, "remote event version identifier");
    id(input.bundleId, "Review Bundle identifier");
    const encoded = encode(input.payload ?? {});
    this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT association_state, bundle_id FROM handled_event_versions WHERE event_version_id = ?",
        input.eventVersionId,
      );
      if (existing !== undefined) {
        const current = rowString(existing, "association_state");
        if (
          rowString(existing, "bundle_id") !== input.bundleId ||
          (current === "HANDLED_BY_BUNDLE" &&
            input.state !== "HANDLED_BY_BUNDLE")
        )
          throw repositoryError(
            this.store,
            "CONFLICT",
            "A handled event-version association cannot move backwards or change bundle owners.",
          );
        if (current === input.state) return;
        transaction.run(
          "UPDATE handled_event_versions SET association_state = ?, handled_at = COALESCE(?, handled_at), payload_json = ? WHERE event_version_id = ?",
          input.state,
          input.handledAt ?? null,
          encoded.payload,
          input.eventVersionId,
        );
        return;
      }
      transaction.run(
        "INSERT INTO handled_event_versions (event_version_id, bundle_id, association_state, associated_at, handled_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
        input.eventVersionId,
        input.bundleId,
        input.state,
        now(this.clock),
        input.handledAt ?? null,
        encoded.payload,
      );
    });
  }

  public putAiWorkOperation(input: {
    readonly operationId: string;
    readonly managedPrId?: string;
    readonly operationKind: string;
    readonly status: string;
    readonly taskProfileSnapshot: Payload;
    readonly executionPolicySnapshot: Payload;
    readonly inputSnapshot: Payload;
    readonly configuredTurnBudget: number;
    readonly idempotencyKey?: string;
    readonly payload?: Payload;
  }): AiWorkOperationRecord {
    id(input.operationId, "AI Work Operation identifier");
    for (const [value, label] of [
      [input.operationKind, "AI operation kind"],
      [input.status, "AI operation status"],
    ] as const)
      text(value, label);
    if (
      !Number.isInteger(input.configuredTurnBudget) ||
      input.configuredTurnBudget < 1 ||
      input.configuredTurnBudget > 10
    )
      throw repositoryError(
        this.store,
        "INVALID_RECORD",
        "AI turn budgets must be between 1 and 10.",
      );
    const profile = encode(input.taskProfileSnapshot);
    const policy = encode(input.executionPolicySnapshot);
    const snapshot = encode(input.inputSnapshot);
    const payload = encode(input.payload ?? {});
    const timestamp = now(this.clock);
    this.store.transaction((transaction) => {
      const existingById = transaction.get(
        "SELECT operation_id FROM ai_work_operations WHERE operation_id = ?",
        input.operationId,
      );
      const existingByKey =
        input.idempotencyKey === undefined
          ? undefined
          : transaction.get(
              "SELECT operation_id FROM ai_work_operations WHERE idempotency_key = ?",
              input.idempotencyKey,
            );
      if (existingById !== undefined || existingByKey !== undefined) return;
      transaction.run(
        "INSERT OR IGNORE INTO ai_work_operations (operation_id, managed_pr_id, operation_kind, status, task_profile_snapshot_json, task_profile_snapshot_hash, execution_policy_snapshot_json, execution_policy_snapshot_hash, input_snapshot_json, input_snapshot_hash, configured_turn_budget, consumed_turn_count, version, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?)",
        input.operationId,
        input.managedPrId ?? null,
        input.operationKind,
        input.status,
        profile.payload,
        profile.payloadHash,
        policy.payload,
        policy.payloadHash,
        snapshot.payload,
        snapshot.payloadHash,
        input.configuredTurnBudget,
        input.idempotencyKey ?? null,
        timestamp,
        timestamp,
      );
      transaction.run(
        "UPDATE ai_work_operations SET status = ?, updated_at = ? WHERE operation_id = ? AND status = ?",
        input.status,
        timestamp,
        input.operationId,
        input.status,
      );
      transaction.run(
        "INSERT OR IGNORE INTO configuration_snapshots (snapshot_id, owner_type, owner_id, revision, schema_version, payload_json, payload_hash, created_at) VALUES (?, 'AI_OPERATION_PAYLOAD', ?, 1, ?, ?, ?, ?)",
        `ai-operation:${input.operationId}`,
        input.operationId,
        payload.schemaVersion,
        payload.payload,
        payload.payloadHash,
        timestamp,
      );
    });
    return this.getAiWorkOperation(input.operationId) as AiWorkOperationRecord;
  }

  public createAiWorkSegment(input: {
    readonly segmentId: string;
    readonly operationId: string;
    readonly segmentIndex: number;
    readonly status: string;
    readonly configuredTurnBudget: number;
    readonly consumedTurnBaseline: number;
    readonly snapshot: Payload;
  }): void {
    id(input.segmentId, "AI segment identifier");
    id(input.operationId, "AI operation identifier");
    if (
      !Number.isInteger(input.segmentIndex) ||
      input.segmentIndex < 0 ||
      !Number.isInteger(input.consumedTurnBaseline) ||
      input.consumedTurnBaseline < 0
    )
      throw repositoryError(
        this.store,
        "INVALID_RECORD",
        "AI segment indexes and consumed baselines must be non-negative integers.",
      );
    if (
      !Number.isInteger(input.configuredTurnBudget) ||
      input.configuredTurnBudget < 1 ||
      input.configuredTurnBudget > 10
    )
      throw repositoryError(
        this.store,
        "INVALID_RECORD",
        "AI segment budgets must be between 1 and 10.",
      );
    const encoded = encode(input.snapshot);
    this.store.transaction((transaction) => {
      transaction.run(
        "INSERT OR IGNORE INTO ai_work_segments (segment_id, operation_id, segment_index, status, configured_turn_budget, consumed_turn_baseline, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        input.segmentId,
        input.operationId,
        input.segmentIndex,
        input.status,
        input.configuredTurnBudget,
        input.consumedTurnBaseline,
        encoded.payload,
        now(this.clock),
      );
    });
  }

  public recordAiWorkTurn(input: {
    readonly turnId: string;
    readonly segmentId: string;
    readonly turnIndex: number;
    readonly status: string;
    readonly deterministicActivity?: Payload;
    readonly report?: Payload;
    readonly validationRefs?: Payload;
    readonly progressClassification?: string;
    readonly stateFingerprint?: string;
    readonly stopReason?: Payload;
    readonly usage?: Payload;
    readonly startedAt: string;
    readonly completedAt?: string;
  }): boolean {
    id(input.turnId, "AI turn identifier");
    id(input.segmentId, "AI segment identifier");
    const activity = encode(input.deterministicActivity ?? {});
    const report = encode(input.report ?? {});
    const refs = encode(input.validationRefs ?? []);
    const reason = encode(input.stopReason ?? {});
    const usage = encode(input.usage ?? {});
    return this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT turn_id FROM ai_work_turns WHERE turn_id = ?",
        input.turnId,
      );
      if (existing !== undefined) return false;
      const segment = transaction.get(
        "SELECT operation_id FROM ai_work_segments WHERE segment_id = ?",
        input.segmentId,
      );
      if (segment === undefined)
        throw repositoryError(
          this.store,
          "NOT_FOUND",
          "The AI segment does not exist.",
        );
      const operationId = rowString(segment, "operation_id");
      const operation = transaction.get(
        "SELECT configured_turn_budget, consumed_turn_count FROM ai_work_operations WHERE operation_id = ?",
        operationId,
      );
      if (operation === undefined)
        throw repositoryError(
          this.store,
          "NOT_FOUND",
          "The AI operation does not exist.",
        );
      if (
        rowNumber(operation, "consumed_turn_count") >=
        rowNumber(operation, "configured_turn_budget")
      )
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The AI turn budget is exhausted and cannot be reset by replay.",
        );
      transaction.run(
        "INSERT INTO ai_work_turns (turn_id, segment_id, turn_index, status, deterministic_activity_json, report_json, validation_refs_json, progress_classification, state_fingerprint, stop_reason_json, usage_json, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        input.turnId,
        input.segmentId,
        input.turnIndex,
        input.status,
        activity.payload,
        report.payload,
        refs.payload,
        input.progressClassification ?? null,
        input.stateFingerprint ?? null,
        reason.payload,
        usage.payload,
        input.startedAt,
        input.completedAt ?? null,
      );
      transaction.run(
        "UPDATE ai_work_operations SET consumed_turn_count = consumed_turn_count + 1, version = version + 1, updated_at = ? WHERE operation_id = ?",
        now(this.clock),
        operationId,
      );
      return true;
    });
  }

  public getAiWorkOperation(
    operationId: string,
  ): AiWorkOperationRecord | undefined {
    id(operationId, "AI operation identifier");
    return this.store.transaction(
      (transaction) => {
        const row = transaction.get(
          "SELECT operation_id AS id, input_snapshot_json AS payload_json, version, created_at, updated_at, operation_kind, status, configured_turn_budget, consumed_turn_count FROM ai_work_operations WHERE operation_id = ?",
          operationId,
        );
        if (row === undefined) return undefined;
        const inputPayload = encode(
          JSON.parse(rowString(row, "payload_json")) as unknown,
        );
        const base: PersistedRecord<unknown> = {
          id: rowString(row, "id"),
          schemaVersion: inputPayload.schemaVersion,
          version: rowNumber(row, "version"),
          createdAt: rowString(row, "created_at"),
          updatedAt: rowString(row, "updated_at"),
          payload: JSON.parse(inputPayload.payload) as unknown,
          payloadHash: inputPayload.payloadHash,
        };
        const segments = transaction
          .all(
            "SELECT * FROM ai_work_segments WHERE operation_id = ? ORDER BY segment_index",
            operationId,
          )
          .map((segment) => ({
            id: rowString(segment, "segment_id"),
            index: rowNumber(segment, "segment_index"),
            status: rowString(segment, "status"),
            configuredTurnBudget: rowNumber(segment, "configured_turn_budget"),
            consumedTurnBaseline: rowNumber(segment, "consumed_turn_baseline"),
            snapshot: JSON.parse(
              rowString(segment, "snapshot_json"),
            ) as unknown,
            turns: transaction
              .all(
                "SELECT * FROM ai_work_turns WHERE segment_id = ? ORDER BY turn_index",
                rowString(segment, "segment_id"),
              )
              .map((turn) => ({
                id: rowString(turn, "turn_id"),
                index: rowNumber(turn, "turn_index"),
                status: rowString(turn, "status"),
                report: JSON.parse(rowString(turn, "report_json")) as unknown,
              })),
          }));
        return {
          ...base,
          operationKind: rowString(row, "operation_kind"),
          status: rowString(row, "status"),
          configuredTurnBudget: rowNumber(row, "configured_turn_budget"),
          consumedTurnCount: rowNumber(row, "consumed_turn_count"),
          segments,
        };
      },
      { maxAttempts: 1 },
    );
  }

  public putConversation(input: {
    readonly conversationId: string;
    readonly operationId?: string;
    readonly scope: string;
    readonly opaqueReference?: string;
    readonly payload?: Payload;
  }): void {
    id(input.conversationId, "conversation identifier");
    text(input.scope, "conversation scope");
    if (input.opaqueReference !== undefined)
      text(input.opaqueReference, "conversation reference");
    const payload = encode(input.payload ?? {});
    const timestamp = now(this.clock);
    this.store.transaction((transaction) =>
      transaction.run(
        "INSERT INTO conversations (conversation_id, operation_id, scope, opaque_reference, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(conversation_id) DO UPDATE SET opaque_reference=excluded.opaque_reference, payload_json=excluded.payload_json, updated_at=excluded.updated_at",
        input.conversationId,
        input.operationId ?? null,
        input.scope,
        input.opaqueReference ?? null,
        payload.payload,
        timestamp,
        timestamp,
      ),
    );
  }

  public putValidationRun(input: {
    readonly runId: string;
    readonly ownerType: string;
    readonly ownerId: string;
    readonly status: string;
    readonly snapshot: Payload;
    readonly evidence: Payload;
    readonly steps?: readonly {
      readonly stepId: string;
      readonly status: string;
      readonly evidence: Payload;
    }[];
    readonly manualChecks?: readonly {
      readonly checkId: string;
      readonly outcome: string;
      readonly evidence: Payload;
    }[];
  }): void {
    id(input.runId, "validation run identifier");
    id(input.ownerId, "validation owner identifier");
    const snapshot = encode(input.snapshot);
    const evidence = encode(input.evidence);
    const timestamp = now(this.clock);
    this.store.transaction((transaction) => {
      transaction.run(
        "INSERT INTO validation_runs (run_id, owner_type, owner_id, status, snapshot_json, evidence_json, evidence_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET status=excluded.status, snapshot_json=excluded.snapshot_json, evidence_json=excluded.evidence_json, evidence_hash=excluded.evidence_hash, updated_at=excluded.updated_at",
        input.runId,
        input.ownerType,
        input.ownerId,
        input.status,
        snapshot.payload,
        evidence.payload,
        evidence.payloadHash,
        timestamp,
        timestamp,
      );
      for (const step of input.steps ?? []) {
        const stepEvidence = encode(step.evidence);
        transaction.run(
          "INSERT INTO validation_steps (run_id, step_id, status, evidence_json) VALUES (?, ?, ?, ?) ON CONFLICT(run_id, step_id) DO UPDATE SET status=excluded.status, evidence_json=excluded.evidence_json",
          input.runId,
          step.stepId,
          step.status,
          stepEvidence.payload,
        );
      }
      for (const check of input.manualChecks ?? []) {
        const checkEvidence = encode(check.evidence);
        transaction.run(
          "INSERT INTO validation_manual_checks (run_id, check_id, outcome, evidence_json) VALUES (?, ?, ?, ?) ON CONFLICT(run_id, check_id) DO UPDATE SET outcome=excluded.outcome, evidence_json=excluded.evidence_json",
          input.runId,
          check.checkId,
          check.outcome,
          checkEvidence.payload,
        );
      }
    });
  }

  public putWorktree(input: {
    readonly worktreeId: string;
    readonly ownerType: string;
    readonly ownerId: string;
    readonly operationKind: string;
    readonly canonicalPath: string;
    readonly baselineSha: string;
    readonly currentSha?: string;
    readonly status: string;
    readonly payload?: Payload;
  }): void {
    id(input.worktreeId, "worktree identifier");
    id(input.ownerId, "worktree owner identifier");
    text(input.canonicalPath, "worktree path");
    const payload = encode(input.payload ?? {});
    const timestamp = now(this.clock);
    this.store.transaction((transaction) =>
      transaction.run(
        "INSERT INTO worktrees (worktree_id, owner_type, owner_id, operation_kind, canonical_path, baseline_sha, current_sha, status, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(worktree_id) DO UPDATE SET current_sha=excluded.current_sha, status=excluded.status, payload_json=excluded.payload_json, updated_at=excluded.updated_at",
        input.worktreeId,
        input.ownerType,
        input.ownerId,
        input.operationKind,
        input.canonicalPath,
        input.baselineSha,
        input.currentSha ?? null,
        input.status,
        payload.payload,
        timestamp,
        timestamp,
      ),
    );
  }

  public putDiff(input: {
    readonly diffId: string;
    readonly ownerType: string;
    readonly ownerId: string;
    readonly baselineSha: string;
    readonly currentSha?: string;
    readonly diffHash: string;
    readonly metadata: Payload;
  }): void {
    id(input.diffId, "diff identifier");
    id(input.ownerId, "diff owner identifier");
    const metadata = encode(input.metadata);
    this.store.transaction((transaction) =>
      transaction.run(
        "INSERT OR IGNORE INTO diffs (diff_id, owner_type, owner_id, baseline_sha, current_sha, diff_hash, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        input.diffId,
        input.ownerType,
        input.ownerId,
        input.baselineSha,
        input.currentSha ?? null,
        input.diffHash,
        metadata.payload,
        now(this.clock),
      ),
    );
  }

  public putSynchronizationBatch(input: {
    readonly synchronizationBatchId: string;
    readonly status: string;
    readonly payload: Payload;
  }): void {
    id(input.synchronizationBatchId, "synchronization batch identifier");
    const payload = encode(input.payload);
    const timestamp = now(this.clock);
    this.store.transaction((transaction) =>
      transaction.run(
        "INSERT INTO synchronization_batches (synchronization_batch_id, payload_json, payload_hash, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(synchronization_batch_id) DO UPDATE SET payload_json=excluded.payload_json, payload_hash=excluded.payload_hash, status=excluded.status, updated_at=excluded.updated_at",
        input.synchronizationBatchId,
        payload.payload,
        payload.payloadHash,
        input.status,
        timestamp,
        timestamp,
      ),
    );
  }

  public putSynchronizationResult(input: {
    readonly synchronizationOperationId: string;
    readonly synchronizationBatchId: string;
    readonly managedPrId: string;
    readonly status: string;
    readonly sourceRepositoryId?: string;
    readonly destinationRepositoryId?: string;
    readonly sourceBranch?: string;
    readonly destinationBranch?: string;
    readonly syncSourceSha?: string;
    readonly prHeadSha?: string;
    readonly worktreeId?: string;
    readonly aiOperationId?: string;
    readonly reason?: Payload;
    readonly diffId?: string;
    readonly validationRunId?: string;
    readonly payload: Payload;
    readonly expectedVersion?: number;
  }): SynchronizationResultRecord {
    id(
      input.synchronizationOperationId,
      "synchronization operation identifier",
    );
    id(input.synchronizationBatchId, "synchronization batch identifier");
    id(input.managedPrId, "managed PR identifier");
    const payload = encode(input.payload);
    const reasonPayload = encode(input.reason ?? {});
    const timestamp = now(this.clock);
    this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT version FROM synchronization_results WHERE synchronization_operation_id = ?",
        input.synchronizationOperationId,
      );
      const current =
        existing === undefined ? 0 : rowNumber(existing, "version");
      if (
        input.expectedVersion !== undefined &&
        current !== input.expectedVersion
      )
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The synchronization result changed before this update was committed.",
        );
      if (existing === undefined)
        transaction.run(
          "INSERT INTO synchronization_results (synchronization_operation_id, synchronization_batch_id, managed_pr_id, status, source_repository_id, destination_repository_id, source_branch, destination_branch, sync_source_sha, pr_head_sha, worktree_id, ai_operation_id, reason_json, diff_id, validation_run_id, payload_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
          input.synchronizationOperationId,
          input.synchronizationBatchId,
          input.managedPrId,
          input.status,
          input.sourceRepositoryId ?? null,
          input.destinationRepositoryId ?? null,
          input.sourceBranch ?? null,
          input.destinationBranch ?? null,
          input.syncSourceSha ?? null,
          input.prHeadSha ?? null,
          input.worktreeId ?? null,
          input.aiOperationId ?? null,
          reasonPayload.payload,
          input.diffId ?? null,
          input.validationRunId ?? null,
          payload.payload,
          timestamp,
          timestamp,
        );
      else
        transaction.run(
          "UPDATE synchronization_results SET status = ?, reason_json = ?, payload_json = ?, version = version + 1, updated_at = ? WHERE synchronization_operation_id = ? AND version = ?",
          input.status,
          reasonPayload.payload,
          payload.payload,
          timestamp,
          input.synchronizationOperationId,
          current,
        );
    });
    return this.getSynchronizationResult(
      input.synchronizationOperationId,
    ) as SynchronizationResultRecord;
  }

  public putSynchronizationConflict(input: {
    readonly synchronizationOperationId: string;
    readonly path: string;
    readonly reason?: Payload;
  }): void {
    id(
      input.synchronizationOperationId,
      "synchronization operation identifier",
    );
    text(input.path, "conflicted path");
    const reasonPayload = encode(input.reason ?? {});
    this.store.transaction((transaction) =>
      transaction.run(
        "INSERT OR IGNORE INTO synchronization_conflicts (synchronization_operation_id, path, reason_json, created_at) VALUES (?, ?, ?, ?)",
        input.synchronizationOperationId,
        input.path,
        reasonPayload.payload,
        now(this.clock),
      ),
    );
  }

  public getSynchronizationResult(
    synchronizationOperationId: string,
  ): SynchronizationResultRecord | undefined {
    id(synchronizationOperationId, "synchronization operation identifier");
    return this.store.transaction(
      (transaction) => {
        const row = transaction.get(
          "SELECT synchronization_operation_id AS id, payload_json, version, created_at, updated_at, synchronization_batch_id, managed_pr_id, status, source_repository_id, destination_repository_id, source_branch, destination_branch, sync_source_sha, pr_head_sha, worktree_id, ai_operation_id, reason_json, diff_id, validation_run_id FROM synchronization_results WHERE synchronization_operation_id = ?",
          synchronizationOperationId,
        );
        if (row === undefined) return undefined;
        const payload = JSON.parse(rowString(row, "payload_json")) as Payload;
        const encodedPayload = encode(payload);
        const base: PersistedRecord<unknown> = {
          id: rowString(row, "id"),
          schemaVersion: encodedPayload.schemaVersion,
          version: rowNumber(row, "version"),
          createdAt: rowString(row, "created_at"),
          updatedAt: rowString(row, "updated_at"),
          payload,
          payloadHash: encodedPayload.payloadHash,
        };
        const conflicts = transaction
          .all(
            "SELECT path, reason_json FROM synchronization_conflicts WHERE synchronization_operation_id = ? ORDER BY path",
            synchronizationOperationId,
          )
          .map((conflict) => ({
            path: rowString(conflict, "path"),
            reason: JSON.parse(rowString(conflict, "reason_json")) as unknown,
          }));
        return {
          ...base,
          synchronizationBatchId: rowString(row, "synchronization_batch_id"),
          managedPrId: rowString(row, "managed_pr_id"),
          status: rowString(row, "status"),
          ...(rowOptionalString(row, "source_repository_id") === undefined
            ? {}
            : {
                sourceRepositoryId: rowOptionalString(
                  row,
                  "source_repository_id",
                ),
              }),
          ...(rowOptionalString(row, "destination_repository_id") === undefined
            ? {}
            : {
                destinationRepositoryId: rowOptionalString(
                  row,
                  "destination_repository_id",
                ),
              }),
          ...(rowOptionalString(row, "source_branch") === undefined
            ? {}
            : { sourceBranch: rowOptionalString(row, "source_branch") }),
          ...(rowOptionalString(row, "destination_branch") === undefined
            ? {}
            : {
                destinationBranch: rowOptionalString(row, "destination_branch"),
              }),
          ...(rowOptionalString(row, "sync_source_sha") === undefined
            ? {}
            : { syncSourceSha: rowOptionalString(row, "sync_source_sha") }),
          ...(rowOptionalString(row, "pr_head_sha") === undefined
            ? {}
            : { prHeadSha: rowOptionalString(row, "pr_head_sha") }),
          ...(rowOptionalString(row, "worktree_id") === undefined
            ? {}
            : { worktreeId: rowOptionalString(row, "worktree_id") }),
          ...(rowOptionalString(row, "ai_operation_id") === undefined
            ? {}
            : { aiOperationId: rowOptionalString(row, "ai_operation_id") }),
          reason: JSON.parse(rowString(row, "reason_json")) as unknown,
          ...(rowOptionalString(row, "diff_id") === undefined
            ? {}
            : { diffId: rowOptionalString(row, "diff_id") }),
          ...(rowOptionalString(row, "validation_run_id") === undefined
            ? {}
            : { validationRunId: rowOptionalString(row, "validation_run_id") }),
          conflicts,
        };
      },
      { maxAttempts: 1 },
    );
  }

  public createPublicationIntent(
    input: PublicationIntentInput,
  ): PublicationIntentRecord {
    id(input.id, "publication identifier");
    id(input.ownerId, "publication owner identifier");
    id(input.approvalId, "approval identifier");
    id(input.idempotencyKey, "publication idempotency key");
    const proposed = encode(input.proposedResult);
    const payload = encode(input.payload ?? {});
    const timestamp = now(this.clock);
    this.store.transaction((transaction) => {
      if (
        transaction.get(
          "SELECT approval_id FROM approvals WHERE approval_id = ?",
          input.approvalId,
        ) === undefined
      )
        throw repositoryError(
          this.store,
          "NOT_FOUND",
          "Publication requires a persisted human approval record.",
        );
      transaction.run(
        "INSERT OR IGNORE INTO publication_intents (publication_id, publication_kind, owner_id, approval_id, idempotency_key, expected_baseline_sha, expected_source_sha, expected_head_sha, proposed_result_json, schema_version, payload_hash, phase, recovery_state, payload_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PREPARED', 'READY', ?, 1, ?, ?)",
        input.id,
        input.kind,
        input.ownerId,
        input.approvalId,
        input.idempotencyKey,
        input.expectedBaselineSha ?? null,
        input.expectedSourceSha ?? null,
        input.expectedHeadSha ?? null,
        proposed.payload,
        payload.schemaVersion,
        payload.payloadHash,
        payload.payload,
        timestamp,
        timestamp,
      );
    });
    return this.getPublicationIntent(
      input.kind,
      input.idempotencyKey,
    ) as PublicationIntentRecord;
  }

  public updatePublicationIntent(input: {
    readonly publicationId: string;
    readonly expectedVersion: number;
    readonly phase: string;
    readonly recoveryState: string;
    readonly knownCommitSha?: string;
    readonly pushEvidence?: Payload;
    readonly payload?: Payload;
  }): PublicationIntentRecord {
    id(input.publicationId, "publication identifier");
    const evidence = encode(input.pushEvidence ?? {});
    const payload = encode(input.payload ?? {});
    const timestamp = now(this.clock);
    const result = this.store.transaction((transaction) =>
      transaction.run(
        "UPDATE publication_intents SET phase = ?, recovery_state = ?, known_commit_sha = COALESCE(?, known_commit_sha), push_evidence_json = ?, schema_version = ?, payload_hash = ?, payload_json = ?, version = version + 1, updated_at = ? WHERE publication_id = ? AND version = ?",
        input.phase,
        input.recoveryState,
        input.knownCommitSha ?? null,
        evidence.payload,
        payload.schemaVersion,
        payload.payloadHash,
        payload.payload,
        timestamp,
        input.publicationId,
        input.expectedVersion,
      ),
    );
    if (result.changes !== 1)
      throw repositoryError(
        this.store,
        "CONFLICT",
        "The publication intent changed before this phase update was committed.",
      );
    return this.getPublicationIntentById(
      input.publicationId,
    ) as PublicationIntentRecord;
  }

  public putPublicationResponse(
    publicationId: string,
    input: PublicationResponseInput,
  ): void {
    id(publicationId, "publication identifier");
    id(input.responseKey, "publication response key");
    const payload = encode(input.payload ?? {});
    this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT * FROM publication_responses WHERE publication_id = ? AND response_key = ?",
        publicationId,
        input.responseKey,
      );
      if (existing !== undefined) {
        const currentRemoteId = rowOptionalString(existing, "remote_id");
        if (
          currentRemoteId !== undefined &&
          input.remoteId !== undefined &&
          currentRemoteId !== input.remoteId
        )
          throw repositoryError(
            this.store,
            "CONFLICT",
            "A known remote response identifier cannot be replaced.",
          );
        if (
          rowString(existing, "state") === "POSTED" &&
          input.state !== "POSTED"
        )
          throw repositoryError(
            this.store,
            "CONFLICT",
            "A posted response cannot be rewritten as pending or failed.",
          );
        transaction.run(
          "UPDATE publication_responses SET state = ?, attempt_count = attempt_count + 1, remote_id = COALESCE(remote_id, ?), error_code = ?, payload_json = ?, updated_at = ? WHERE publication_id = ? AND response_key = ?",
          input.state,
          input.remoteId ?? null,
          input.errorCode ?? null,
          payload.payload,
          now(this.clock),
          publicationId,
          input.responseKey,
        );
        return;
      }
      transaction.run(
        "INSERT INTO publication_responses (publication_id, response_key, state, idempotency_key, attempt_count, remote_id, error_code, payload_json, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)",
        publicationId,
        input.responseKey,
        input.state,
        `${publicationId}:${input.responseKey}`,
        input.remoteId ?? null,
        input.errorCode ?? null,
        payload.payload,
        now(this.clock),
      );
    });
  }

  public recordExternalEffect(input: {
    readonly effectId: string;
    readonly publicationId?: string;
    readonly effectKind: string;
    readonly idempotencyKey: string;
    readonly state: string;
    readonly knownRemoteId?: string;
    readonly evidence?: Payload;
  }): void {
    id(input.effectId, "external effect identifier");
    id(input.idempotencyKey, "external effect idempotency key");
    const evidence = encode(input.evidence ?? {});
    this.store.transaction((transaction) =>
      transaction.run(
        "INSERT OR IGNORE INTO external_effects (effect_id, publication_id, effect_kind, idempotency_key, state, known_remote_id, evidence_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        input.effectId,
        input.publicationId ?? null,
        input.effectKind,
        input.idempotencyKey,
        input.state,
        input.knownRemoteId ?? null,
        evidence.payload,
        now(this.clock),
        now(this.clock),
      ),
    );
  }

  public markStale(input: {
    readonly staleId: string;
    readonly ownerType: string;
    readonly ownerId: string;
    readonly reason: Payload;
    readonly observedHeadSha?: string;
    readonly currentHeadSha?: string;
  }): void {
    id(input.staleId, "stale history identifier");
    id(input.ownerId, "stale history owner identifier");
    const reasonPayload = encode(input.reason);
    this.store.transaction((transaction) =>
      transaction.run(
        "INSERT OR IGNORE INTO stale_history (stale_id, owner_type, owner_id, reason_json, observed_head_sha, current_head_sha, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        input.staleId,
        input.ownerType,
        input.ownerId,
        reasonPayload.payload,
        input.observedHeadSha ?? null,
        input.currentHeadSha ?? null,
        now(this.clock),
      ),
    );
  }

  public appendActivityEvent(input: {
    readonly activityEventId: string;
    readonly correlationId: string;
    readonly ownerType?: string;
    readonly ownerId?: string;
    readonly severity: string;
    readonly reasonCode: string;
    readonly payload: Payload;
  }): void {
    id(input.activityEventId, "activity event identifier");
    id(input.correlationId, "correlation identifier");
    const payload = encode(input.payload);
    this.store.transaction((transaction) =>
      transaction.run(
        "INSERT OR IGNORE INTO activity_events (activity_event_id, correlation_id, owner_type, owner_id, severity, reason_code, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        input.activityEventId,
        input.correlationId,
        input.ownerType ?? null,
        input.ownerId ?? null,
        input.severity,
        input.reasonCode,
        payload.payload,
        now(this.clock),
      ),
    );
  }

  private getPublicationIntentById(
    publicationId: string,
  ): PublicationIntentRecord | undefined {
    return this.store.transaction(
      (transaction) =>
        this.readPublicationIntent(
          transaction,
          transaction.get(
            "SELECT * FROM publication_intents WHERE publication_id = ?",
            publicationId,
          ),
        ),
      { maxAttempts: 1 },
    );
  }

  public getPublicationIntent(
    kind: PublicationIntentInput["kind"],
    idempotencyKey: string,
  ): PublicationIntentRecord | undefined {
    id(idempotencyKey, "publication idempotency key");
    return this.store.transaction(
      (transaction) =>
        this.readPublicationIntent(
          transaction,
          transaction.get(
            "SELECT * FROM publication_intents WHERE publication_kind = ? AND idempotency_key = ?",
            kind,
            idempotencyKey,
          ),
        ),
      { maxAttempts: 1 },
    );
  }

  private readPublicationIntent(
    transaction: PersistenceTransaction,
    row: SqlRow | undefined,
  ): PublicationIntentRecord | undefined {
    if (row === undefined) return undefined;
    const base = recordFromRow(row, "publication_id", "payload_json");
    const responses = transaction
      .all(
        "SELECT * FROM publication_responses WHERE publication_id = ? ORDER BY response_key",
        rowString(row, "publication_id"),
      )
      .map((response) => ({
        responseKey: rowString(response, "response_key"),
        state: rowString(response, "state"),
        idempotencyKey: rowString(response, "idempotency_key"),
        attemptCount: rowNumber(response, "attempt_count"),
        ...(rowOptionalString(response, "remote_id") === undefined
          ? {}
          : { remoteId: rowOptionalString(response, "remote_id") }),
        ...(rowOptionalString(response, "error_code") === undefined
          ? {}
          : { errorCode: rowOptionalString(response, "error_code") }),
        payload: JSON.parse(rowString(response, "payload_json")) as unknown,
      }));
    return {
      ...base,
      kind: rowString(
        row,
        "publication_kind",
      ) as PublicationIntentRecord["kind"],
      ownerId: rowString(row, "owner_id"),
      approvalId: rowString(row, "approval_id"),
      idempotencyKey: rowString(row, "idempotency_key"),
      phase: rowString(row, "phase"),
      recoveryState: rowString(row, "recovery_state"),
      ...(rowOptionalString(row, "expected_baseline_sha") === undefined
        ? {}
        : {
            expectedBaselineSha: rowOptionalString(
              row,
              "expected_baseline_sha",
            ),
          }),
      ...(rowOptionalString(row, "expected_source_sha") === undefined
        ? {}
        : { expectedSourceSha: rowOptionalString(row, "expected_source_sha") }),
      ...(rowOptionalString(row, "expected_head_sha") === undefined
        ? {}
        : { expectedHeadSha: rowOptionalString(row, "expected_head_sha") }),
      proposedResult: JSON.parse(
        rowString(row, "proposed_result_json"),
      ) as unknown,
      ...(rowOptionalString(row, "known_commit_sha") === undefined
        ? {}
        : { knownCommitSha: rowOptionalString(row, "known_commit_sha") }),
      responses,
    };
  }
}

export function createPersistenceRepositories(
  store: PersistenceStore,
  options: RepositoryOptions = {},
): PersistenceRepositories {
  return new PersistenceRepositories(store, options);
}
