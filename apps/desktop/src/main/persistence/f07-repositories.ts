import { createHash } from "node:crypto";
import {
  decodeSnapshot,
  encodeSnapshot,
  assertBoundedIdentifier,
  assertBoundedText,
} from "./codecs";
import { PersistenceError } from "./types";
import type {
  PersistenceClock,
  PersistenceTransaction,
  SqlRow,
} from "./types";
import type { PersistenceStore } from "./database";
import type {
  AddPrAttemptView,
  AddPrAttemptStatus,
  ManagedPrConfigurationView,
  ManagedPrLocalCloneView,
  ManagedPrLocalCleanState,
  ManagedPrLocalSetupStatus,
  ManagedPrReadModel,
  ManagedPrReason,
  ManagedPrRemoteSnapshot,
} from "../../shared/managed-pr";
import { MAX_PR_INTENT_CONTEXT_BYTES } from "../../shared/managed-pr";

export interface F07AddAttemptInput {
  readonly attemptId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly canonicalPrKey: string;
  readonly serverId: string;
  readonly profileVersion: number;
  readonly normalizedUrl: string;
  readonly parsedInput: unknown;
  readonly context: string | null;
  readonly syncSourceBranchOverride: string | null;
}

export interface F07AddAttemptRecord extends AddPrAttemptView {
  readonly context: string | null;
  readonly syncSourceBranchOverride: string | null;
  readonly parsedInput: unknown;
  readonly profileVersion: number;
}

export type F07LocalCloneRecord = ManagedPrLocalCloneView;

export interface F07CommitManagedPrInput {
  readonly attemptId: string;
  readonly managedPrId: string;
  readonly remote: ManagedPrRemoteSnapshot;
  readonly primaryState: ManagedPrReadModel["primaryState"];
  readonly context: string | null;
  readonly syncSourceBranchOverride: string | null;
  readonly localClone?: ManagedPrLocalCloneView;
}

export interface F07SaveConfigurationInput {
  readonly managedPrId: string;
  readonly expectedVersion: number;
  readonly context: string | null;
  readonly syncSourceBranchOverride: string | null;
}

export interface F07AttachCloneInput {
  readonly managedPrId: string;
  readonly expectedVersion: number;
  readonly localClone: ManagedPrLocalCloneView;
}

export interface F07CandidateRecord {
  readonly canonicalRoot: string;
  readonly repository: ManagedPrLocalCloneView["repository"];
  readonly status: ManagedPrLocalSetupStatus;
  readonly cleanState: ManagedPrLocalCleanState;
  readonly lastValidatedAt?: string;
}

export interface F07BeginAddResult {
  readonly attempt: F07AddAttemptRecord;
  readonly shouldFetch: boolean;
}

const F07_RECORD_SCHEMA_VERSION = 1;

function clockDefault(): PersistenceClock {
  return { now: () => new Date().toISOString() };
}

function timestamp(clock: PersistenceClock): string {
  const value = clock.now();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
    throw new Error("F07_CLOCK_MUST_RETURN_UTC_MILLISECONDS");
  return value;
}

function rowString(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`F07_INVALID_ROW_${key}`);
  return value;
}

function rowOptionalString(row: SqlRow, key: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`F07_INVALID_ROW_${key}`);
  return value;
}

function rowNumber(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number") throw new Error(`F07_INVALID_ROW_${key}`);
  return value;
}

function rowBoolean(row: SqlRow, key: string): boolean {
  const value = row[key];
  if (value !== 0 && value !== 1) throw new Error(`F07_INVALID_ROW_${key}`);
  return value === 1;
}

function safeId(value: string, label: string): void {
  assertBoundedIdentifier(value, label);
}

function safeText(value: string, label: string): void {
  assertBoundedText(value, label);
}

function safeMultilineText(value: string, label: string): void {
  if (new TextEncoder().encode(value).byteLength > MAX_PR_INTENT_CONTEXT_BYTES)
    throw new Error(`${label} exceeds the F07 context limit.`);
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if ((codePoint <= 31 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13) || codePoint === 127)
      throw new Error(`${label} contains an unsafe control character.`);
  }
}

function hashJson(value: unknown): { readonly json: string; readonly hash: string } {
  const encoded = encodeSnapshot(value, F07_RECORD_SCHEMA_VERSION);
  return { json: encoded.payload, hash: encoded.payloadHash };
}

function decodeJson<T>(row: SqlRow, jsonKey: string, hashKey: string): T {
  const json = rowString(row, jsonKey);
  const hash = rowString(row, hashKey);
  return decodeSnapshot<T>(
    {
      schemaVersion: F07_RECORD_SCHEMA_VERSION,
      payload: json,
      payloadHash: hash,
    },
    F07_RECORD_SCHEMA_VERSION,
  );
}

function parseUnhashedJson<T>(row: SqlRow, key: string): T {
  const value = rowString(row, key);
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`F07_INVALID_JSON_${key}`);
  }
}

function nullable(value: string | null): string | null {
  return value === null ? null : value;
}

function repositoryIdForKey(key: string): string {
  return `github-repository-${createHash("sha256").update(key, "utf8").digest("hex").slice(0, 32)}`;
}

function configurationRevisionId(managedPrId: string, revision: number): string {
  return `managed-pr-config-${createHash("sha256").update(`${managedPrId}:${revision}`, "utf8").digest("hex").slice(0, 32)}`;
}

function associationId(managedPrId: string): string {
  return `managed-pr-clone-${createHash("sha256").update(managedPrId, "utf8").digest("hex").slice(0, 32)}`;
}

function contentHash(context: string | null, override: string | null): string {
  return createHash("sha256")
    .update(JSON.stringify({ context, syncSourceBranchOverride: override }), "utf8")
    .digest("hex");
}

function repositoryError(
  store: PersistenceStore,
  code: "CONFLICT" | "NOT_FOUND" | "INVALID_RECORD" | "DUPLICATE" | "SECURITY_VIOLATION",
  what: string,
): PersistenceError {
  return new PersistenceError({
    code,
    stage: "health_record",
    what,
    why: "The F07 persistence boundary rejected an unsafe, stale, missing, or duplicate managed-PR operation.",
    nextAction: code === "CONFLICT" ? "RETRY" : "FIX_INPUT",
    correlationId: "f07-persistence",
    databaseId: store.health.databaseId,
    details: {},
  });
}

function readReason(row: SqlRow, key: string): ManagedPrReason | undefined {
  const value = rowOptionalString(row, key);
  if (value === undefined || value === "") return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    return parsed as ManagedPrReason;
  } catch {
    return undefined;
  }
}

function reasonJson(reason: ManagedPrReason | undefined): string | null {
  return reason === undefined ? null : JSON.stringify(reason);
}

function attemptStatus(value: string): AddPrAttemptStatus {
  if (["PENDING", "SUCCEEDED", "CANCELLED", "FAILED", "RECOVERY_REQUIRED"].includes(value))
    return value as AddPrAttemptStatus;
  throw new Error("F07_INVALID_ATTEMPT_STATUS");
}

function setupStatus(value: string): ManagedPrLocalSetupStatus {
  if (["LOCAL_CLONE_REQUIRED", "VALID", "DIRTY", "MISSING", "INVALID", "UNKNOWN"].includes(value))
    return value as ManagedPrLocalSetupStatus;
  throw new Error("F07_INVALID_SETUP_STATUS");
}

function cleanState(value: string): ManagedPrLocalCleanState {
  if (["CLEAN", "DIRTY", "UNKNOWN"].includes(value)) return value as ManagedPrLocalCleanState;
  throw new Error("F07_INVALID_CLEAN_STATE");
}

function localCloneFromRow(row: SqlRow): ManagedPrLocalCloneView {
  const repository = parseUnhashedJson<ManagedPrLocalCloneView["repository"]>(row, "repository_json");
  const snapshot = parseUnhashedJson<ManagedPrLocalCloneView["validationSnapshot"]>(row, "validation_snapshot_json");
  const lastValidatedAt = rowString(row, "validated_at");
  return {
    associationId: rowString(row, "association_id"),
    status: setupStatus(rowString(row, "status")) as Exclude<ManagedPrLocalSetupStatus, "LOCAL_CLONE_REQUIRED">,
    cleanState: cleanState(rowString(row, "clean_state")),
    canonicalRoot: rowString(row, "canonical_root"),
    repository,
    validationSnapshot: snapshot,
    validatedAt: lastValidatedAt,
    version: rowNumber(row, "version"),
  };
}

function configurationFromRow(row: SqlRow): ManagedPrConfigurationView {
  const context = rowBoolean(row, "context_present") ? rowString(row, "context_text") : null;
  const override = rowBoolean(row, "override_present") ? rowString(row, "override_text") : null;
  return {
    revisionId: rowString(row, "revision_id"),
    revision: rowNumber(row, "revision"),
    context,
    syncSourceBranchOverride: override,
    contentHash: rowString(row, "content_hash"),
    source: rowString(row, "source") as ManagedPrConfigurationView["source"],
    createdAt: rowString(row, "created_at"),
  };
}

export class F07PersistenceRepositories {
  private readonly clock: PersistenceClock;

  public constructor(
    private readonly store: PersistenceStore,
    options: { readonly clock?: PersistenceClock } = {},
  ) {
    this.clock = options.clock ?? clockDefault();
  }

  public beginAddAttempt(input: F07AddAttemptInput): F07BeginAddResult {
    for (const [value, label] of [
      [input.attemptId, "add attempt identifier"],
      [input.correlationId, "add correlation identifier"],
      [input.idempotencyKey, "add idempotency key"],
      [input.serverId, "server identifier"],
    ] as const) safeId(value, label);
    safeText(input.canonicalPrKey, "canonical pull-request key");
    if (!Number.isSafeInteger(input.profileVersion) || input.profileVersion < 1)
      throw repositoryError(this.store, "INVALID_RECORD", "The GitHub profile version is invalid.");
    safeText(input.normalizedUrl, "normalized pull-request URL");
    const parsed = hashJson(input.parsedInput);
    if (input.context !== null) safeMultilineText(input.context, "PR Intent / Context");
    if (input.syncSourceBranchOverride !== null)
      safeText(input.syncSourceBranchOverride, "synchronization source branch");
    const createdAt = timestamp(this.clock);
    return this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT * FROM f07_add_pr_attempts WHERE idempotency_key = ? OR canonical_pr_key = ? LIMIT 1",
        input.idempotencyKey,
        input.canonicalPrKey,
      );
      if (existing !== undefined) {
        const status = attemptStatus(rowString(existing, "status"));
        if (status === "PENDING" || status === "SUCCEEDED")
          return { attempt: this.attemptFromRow(existing), shouldFetch: false };
        transaction.run(
          "UPDATE f07_add_pr_attempts SET correlation_id = ?, idempotency_key = ?, profile_version = ?, normalized_url = ?, parsed_input_json = ?, parsed_input_hash = ?, context_present = ?, context_text = ?, override_present = ?, override_text = ?, status = 'PENDING', managed_pr_id = NULL, reason_json = NULL, version = version + 1, updated_at = ? WHERE attempt_id = ? AND version = ?",
          input.correlationId,
          input.idempotencyKey,
          input.profileVersion,
          input.normalizedUrl,
          parsed.json,
          parsed.hash,
          input.context === null ? 0 : 1,
          nullable(input.context),
          input.syncSourceBranchOverride === null ? 0 : 1,
          nullable(input.syncSourceBranchOverride),
          createdAt,
          rowString(existing, "attempt_id"),
          rowNumber(existing, "version"),
        );
        const row = transaction.get("SELECT * FROM f07_add_pr_attempts WHERE attempt_id = ?", rowString(existing, "attempt_id"));
        if (row === undefined) throw new Error("F07_ATTEMPT_NOT_READABLE");
        return { attempt: this.attemptFromRow(row), shouldFetch: true };
      }
      transaction.run(
        "INSERT INTO f07_add_pr_attempts (attempt_id, idempotency_key, canonical_pr_key, server_id, correlation_id, profile_version, normalized_url, parsed_input_json, parsed_input_hash, context_present, context_text, override_present, override_text, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 1, ?, ?)",
        input.attemptId,
        input.idempotencyKey,
        input.canonicalPrKey,
        input.serverId,
        input.correlationId,
        input.profileVersion,
        input.normalizedUrl,
        parsed.json,
        parsed.hash,
        input.context === null ? 0 : 1,
        nullable(input.context),
        input.syncSourceBranchOverride === null ? 0 : 1,
        nullable(input.syncSourceBranchOverride),
        createdAt,
        createdAt,
      );
      const row = transaction.get("SELECT * FROM f07_add_pr_attempts WHERE attempt_id = ?", input.attemptId);
      if (row === undefined) throw new Error("F07_ATTEMPT_NOT_READABLE");
      return { attempt: this.attemptFromRow(row), shouldFetch: true };
    });
  }

  public markAddAttempt(
    attemptId: string,
    input: {
      readonly status: AddPrAttemptStatus;
      readonly managedPrId?: string | null;
      readonly reason?: ManagedPrReason | null;
      readonly expectedVersion?: number;
    },
  ): F07AddAttemptRecord {
    safeId(attemptId, "add attempt identifier");
    if (input.managedPrId !== undefined && input.managedPrId !== null) safeId(input.managedPrId, "managed PR identifier");
    const changedAt = timestamp(this.clock);
    return this.store.transaction((transaction) => {
      const current = transaction.get("SELECT * FROM f07_add_pr_attempts WHERE attempt_id = ?", attemptId);
      if (current === undefined) throw repositoryError(this.store, "NOT_FOUND", "The add attempt no longer exists.");
      const currentVersion = rowNumber(current, "version");
      if (input.expectedVersion !== undefined && input.expectedVersion !== currentVersion)
        throw repositoryError(this.store, "CONFLICT", "The add attempt changed before its outcome was recorded.");
      transaction.run(
        "UPDATE f07_add_pr_attempts SET status = ?, managed_pr_id = ?, reason_json = ?, version = version + 1, updated_at = ? WHERE attempt_id = ? AND version = ?",
        input.status,
        input.managedPrId ?? null,
        reasonJson(input.reason ?? undefined),
        changedAt,
        attemptId,
        currentVersion,
      );
      const row = transaction.get("SELECT * FROM f07_add_pr_attempts WHERE attempt_id = ?", attemptId);
      if (row === undefined) throw new Error("F07_ATTEMPT_NOT_READABLE");
      return this.attemptFromRow(row);
    });
  }

  public commitManagedPr(input: F07CommitManagedPrInput): ManagedPrReadModel {
    safeId(input.attemptId, "add attempt identifier");
    safeId(input.managedPrId, "managed PR identifier");
    safeId(input.remote.serverId, "server identifier");
    const remote = hashJson(input.remote);
    const configHash = contentHash(input.context, input.syncSourceBranchOverride);
    const configId = configurationRevisionId(input.managedPrId, 1);
    const association = input.localClone;
    const changedAt = timestamp(this.clock);
    return this.store.transaction((transaction) => {
      const attempt = transaction.get("SELECT * FROM f07_add_pr_attempts WHERE attempt_id = ?", input.attemptId);
      if (attempt === undefined) throw repositoryError(this.store, "NOT_FOUND", "The add intent no longer exists.");
      const existing = transaction.get("SELECT managed_pr_id FROM f07_managed_prs WHERE server_id = ? AND canonical_pr_key = ?", input.remote.serverId, input.remote.pullRequestKey);
      if (existing !== undefined) {
        const existingId = rowString(existing, "managed_pr_id");
        transaction.run("UPDATE f07_add_pr_attempts SET status = 'SUCCEEDED', managed_pr_id = ?, reason_json = NULL, version = version + 1, updated_at = ? WHERE attempt_id = ?", existingId, changedAt, input.attemptId);
        const row = transaction.get("SELECT * FROM f07_managed_prs WHERE managed_pr_id = ?", existingId);
        if (row === undefined) throw new Error("F07_MANAGED_PR_NOT_READABLE");
        return this.readManagedPrInTransaction(transaction, row);
      }

      const baseRepositoryId = repositoryIdForKey(input.remote.baseRepository.key);
      const headRepositoryId = input.remote.headRepository.available
        ? repositoryIdForKey(input.remote.headRepository.key)
        : baseRepositoryId;
      this.ensureRepository(transaction, input.remote.serverId, input.remote.baseRepository, baseRepositoryId, input.remote.defaultBranch, changedAt);
      if (input.remote.headRepository.available)
        this.ensureRepository(transaction, input.remote.serverId, input.remote.headRepository, headRepositoryId, undefined, changedAt);
      transaction.run(
        "INSERT INTO managed_prs (managed_pr_id, server_id, base_repository_id, head_repository_id, number, base_branch, head_branch, base_sha, head_sha, sync_source_branch_override, state, version, intent_json, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)",
        input.managedPrId,
        input.remote.serverId,
        baseRepositoryId,
        headRepositoryId,
        input.remote.number,
        input.remote.baseBranch,
        input.remote.headBranch,
        input.remote.baseSha,
        input.remote.headSha,
        input.syncSourceBranchOverride,
        input.primaryState,
        encodeSnapshot({ configurationRevisionId: configId }).payload,
        encodeSnapshot({ canonicalUrl: input.remote.canonicalUrl, remoteSnapshotHash: remote.hash }).payload,
        changedAt,
        changedAt,
      );
      transaction.run(
        "INSERT INTO f07_pr_configuration_revisions (revision_id, managed_pr_id, revision, context_present, context_text, override_present, override_text, content_hash, source, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'ADD_PR', ?)",
        configId,
        input.managedPrId,
        input.context === null ? 0 : 1,
        nullable(input.context),
        input.syncSourceBranchOverride === null ? 0 : 1,
        nullable(input.syncSourceBranchOverride),
        configHash,
        changedAt,
      );
      transaction.run(
        "INSERT INTO f07_managed_prs (managed_pr_id, server_id, canonical_pr_key, canonical_url, owner, repository_name, number, base_repository_key, head_repository_key, base_branch, head_branch, base_sha, head_sha, remote_state, merged, default_branch, remote_snapshot_json, remote_snapshot_hash, primary_state, local_setup_status, current_configuration_revision_id, current_configuration_revision, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)",
        input.managedPrId,
        input.remote.serverId,
        input.remote.pullRequestKey,
        input.remote.canonicalUrl,
        input.remote.owner,
        input.remote.repositoryName,
        input.remote.number,
        input.remote.baseRepository.key,
        input.remote.headRepository.key,
        input.remote.baseBranch,
        input.remote.headBranch,
        input.remote.baseSha,
        input.remote.headSha,
        input.remote.state,
        input.remote.merged ? 1 : 0,
        input.remote.defaultBranch ?? null,
        remote.json,
        remote.hash,
        input.primaryState,
        association === undefined ? "LOCAL_CLONE_REQUIRED" : association.status,
        configId,
        changedAt,
        changedAt,
      );
      if (association !== undefined) this.insertAssociation(transaction, input.managedPrId, association, changedAt);
      transaction.run(
        "UPDATE f07_add_pr_attempts SET status = 'SUCCEEDED', managed_pr_id = ?, reason_json = NULL, version = version + 1, updated_at = ? WHERE attempt_id = ?",
        input.managedPrId,
        changedAt,
        input.attemptId,
      );
      const row = transaction.get("SELECT * FROM f07_managed_prs WHERE managed_pr_id = ?", input.managedPrId);
      if (row === undefined) throw new Error("F07_MANAGED_PR_NOT_READABLE");
      return this.readManagedPrInTransaction(transaction, row);
    });
  }

  public getManagedPr(managedPrId: string): ManagedPrReadModel | undefined {
    safeId(managedPrId, "managed PR identifier");
    const row = this.store.read("SELECT * FROM f07_managed_prs WHERE managed_pr_id = ?", managedPrId);
    return row === undefined ? undefined : this.readManagedPr(row);
  }

  public listManagedPrs(): readonly ManagedPrReadModel[] {
    return this.store.readAll("SELECT * FROM f07_managed_prs ORDER BY updated_at DESC, managed_pr_id ASC").map((row) => this.readManagedPr(row));
  }

  public getAddAttempt(attemptId: string): F07AddAttemptRecord | undefined {
    safeId(attemptId, "add attempt identifier");
    const row = this.store.read("SELECT * FROM f07_add_pr_attempts WHERE attempt_id = ?", attemptId);
    return row === undefined ? undefined : this.attemptFromRow(row);
  }

  public listAddAttempts(): readonly F07AddAttemptRecord[] {
    return this.store.readAll("SELECT * FROM f07_add_pr_attempts ORDER BY updated_at DESC, attempt_id ASC").map((row) => this.attemptFromRow(row));
  }

  public reconcileStartup(reason: ManagedPrReason): void {
    const changedAt = timestamp(this.clock);
    this.store.transaction((transaction) => {
      const pending = transaction.all("SELECT attempt_id, version FROM f07_add_pr_attempts WHERE status = 'PENDING'");
      for (const row of pending)
        transaction.run(
          "UPDATE f07_add_pr_attempts SET status = 'RECOVERY_REQUIRED', reason_json = ?, version = version + 1, updated_at = ? WHERE attempt_id = ? AND version = ?",
          JSON.stringify(reason),
          changedAt,
          rowString(row, "attempt_id"),
          rowNumber(row, "version"),
        );
    });
  }

  public saveConfiguration(input: F07SaveConfigurationInput): ManagedPrReadModel {
    safeId(input.managedPrId, "managed PR identifier");
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1)
      throw repositoryError(this.store, "INVALID_RECORD", "The managed PR version is invalid.");
    if (input.context !== null) safeMultilineText(input.context, "PR Intent / Context");
    if (input.syncSourceBranchOverride !== null) safeText(input.syncSourceBranchOverride, "synchronization source branch");
    const changedAt = timestamp(this.clock);
    return this.store.transaction((transaction) => {
      const managed = transaction.get("SELECT * FROM f07_managed_prs WHERE managed_pr_id = ?", input.managedPrId);
      if (managed === undefined) throw repositoryError(this.store, "NOT_FOUND", "The managed PR no longer exists.");
      const currentVersion = rowNumber(managed, "version");
      if (currentVersion !== input.expectedVersion) throw repositoryError(this.store, "CONFLICT", "The managed PR changed before this configuration edit was committed.");
      const current = transaction.get("SELECT * FROM f07_pr_configuration_revisions WHERE revision_id = ?", rowString(managed, "current_configuration_revision_id"));
      if (current === undefined) throw new Error("F07_CURRENT_CONFIGURATION_NOT_READABLE");
      const currentContext = rowBoolean(current, "context_present") ? rowString(current, "context_text") : null;
      const currentOverride = rowBoolean(current, "override_present") ? rowString(current, "override_text") : null;
      if (currentContext === input.context && currentOverride === input.syncSourceBranchOverride)
        return this.readManagedPrInTransaction(transaction, managed);
      const revision = rowNumber(managed, "current_configuration_revision") + 1;
      const revisionId = configurationRevisionId(input.managedPrId, revision);
      transaction.run(
        "INSERT INTO f07_pr_configuration_revisions (revision_id, managed_pr_id, revision, context_present, context_text, override_present, override_text, content_hash, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'USER_EDIT', ?)",
        revisionId,
        input.managedPrId,
        revision,
        input.context === null ? 0 : 1,
        nullable(input.context),
        input.syncSourceBranchOverride === null ? 0 : 1,
        nullable(input.syncSourceBranchOverride),
        contentHash(input.context, input.syncSourceBranchOverride),
        changedAt,
      );
      transaction.run(
        "UPDATE f07_managed_prs SET current_configuration_revision_id = ?, current_configuration_revision = ?, version = version + 1, updated_at = ? WHERE managed_pr_id = ? AND version = ?",
        revisionId,
        revision,
        changedAt,
        input.managedPrId,
        currentVersion,
      );
      transaction.run(
        "UPDATE managed_prs SET sync_source_branch_override = ?, intent_json = ?, version = version + 1, updated_at = ? WHERE managed_pr_id = ?",
        input.syncSourceBranchOverride,
        encodeSnapshot({ configurationRevisionId: revisionId }).payload,
        changedAt,
        input.managedPrId,
      );
      const row = transaction.get("SELECT * FROM f07_managed_prs WHERE managed_pr_id = ?", input.managedPrId);
      if (row === undefined) throw new Error("F07_MANAGED_PR_NOT_READABLE");
      return this.readManagedPrInTransaction(transaction, row);
    });
  }

  public attachClone(input: F07AttachCloneInput): ManagedPrReadModel {
    safeId(input.managedPrId, "managed PR identifier");
    const changedAt = timestamp(this.clock);
    return this.store.transaction((transaction) => {
      const managed = transaction.get("SELECT * FROM f07_managed_prs WHERE managed_pr_id = ?", input.managedPrId);
      if (managed === undefined) throw repositoryError(this.store, "NOT_FOUND", "The managed PR no longer exists.");
      const version = rowNumber(managed, "version");
      if (version !== input.expectedVersion) throw repositoryError(this.store, "CONFLICT", "The managed PR changed before the local clone was attached.");
      transaction.run("DELETE FROM f07_local_clone_associations WHERE managed_pr_id = ?", input.managedPrId);
      this.insertAssociation(transaction, input.managedPrId, input.localClone, changedAt);
      transaction.run("UPDATE f07_managed_prs SET local_setup_status = ?, version = version + 1, updated_at = ? WHERE managed_pr_id = ? AND version = ?", input.localClone.status, changedAt, input.managedPrId, version);
      const row = transaction.get("SELECT * FROM f07_managed_prs WHERE managed_pr_id = ?", input.managedPrId);
      if (row === undefined) throw new Error("F07_MANAGED_PR_NOT_READABLE");
      return this.readManagedPrInTransaction(transaction, row);
    });
  }

  public clearClone(managedPrId: string, expectedVersion: number): ManagedPrReadModel {
    safeId(managedPrId, "managed PR identifier");
    const changedAt = timestamp(this.clock);
    return this.store.transaction((transaction) => {
      const managed = transaction.get("SELECT * FROM f07_managed_prs WHERE managed_pr_id = ?", managedPrId);
      if (managed === undefined) throw repositoryError(this.store, "NOT_FOUND", "The managed PR no longer exists.");
      const version = rowNumber(managed, "version");
      if (version !== expectedVersion) throw repositoryError(this.store, "CONFLICT", "The managed PR changed before the local clone was cleared.");
      transaction.run("DELETE FROM f07_local_clone_associations WHERE managed_pr_id = ?", managedPrId);
      transaction.run("UPDATE f07_managed_prs SET local_setup_status = 'LOCAL_CLONE_REQUIRED', version = version + 1, updated_at = ? WHERE managed_pr_id = ? AND version = ?", changedAt, managedPrId, version);
      const row = transaction.get("SELECT * FROM f07_managed_prs WHERE managed_pr_id = ?", managedPrId);
      if (row === undefined) throw new Error("F07_MANAGED_PR_NOT_READABLE");
      return this.readManagedPrInTransaction(transaction, row);
    });
  }

  public updateCloneStatus(input: { readonly managedPrId: string; readonly status: Exclude<ManagedPrLocalSetupStatus, "LOCAL_CLONE_REQUIRED">; readonly cleanState: ManagedPrLocalCleanState; readonly validationSnapshot: ManagedPrLocalCloneView["validationSnapshot"]; readonly reason?: ManagedPrReason; }): ManagedPrReadModel | undefined {
    const changedAt = timestamp(this.clock);
    return this.store.transaction((transaction) => {
      const managed = transaction.get("SELECT * FROM f07_managed_prs WHERE managed_pr_id = ?", input.managedPrId);
      const association = transaction.get("SELECT * FROM f07_local_clone_associations WHERE managed_pr_id = ?", input.managedPrId);
      if (managed === undefined || association === undefined) return undefined;
      transaction.run("UPDATE f07_local_clone_associations SET status = ?, clean_state = ?, validation_snapshot_json = ?, validated_at = ?, version = version + 1, updated_at = ? WHERE managed_pr_id = ?", input.status, input.cleanState, JSON.stringify(input.validationSnapshot), input.validationSnapshot.validatedAt, changedAt, input.managedPrId);
      transaction.run("UPDATE f07_managed_prs SET local_setup_status = ?, last_operation_reason_json = ?, version = version + 1, updated_at = ? WHERE managed_pr_id = ?", input.status, reasonJson(input.reason), changedAt, input.managedPrId);
      const row = transaction.get("SELECT * FROM f07_managed_prs WHERE managed_pr_id = ?", input.managedPrId);
      return row === undefined ? undefined : this.readManagedPrInTransaction(transaction, row);
    });
  }

  public listCandidates(baseRepositoryKey: string): readonly F07CandidateRecord[] {
    safeText(baseRepositoryKey, "base repository key");
    const rows = this.store.readAll(
      "SELECT l.*, m.local_setup_status FROM f07_local_clone_associations l JOIN f07_managed_prs m ON m.managed_pr_id = l.managed_pr_id WHERE m.base_repository_key = ? ORDER BY l.updated_at DESC",
      baseRepositoryKey,
    );
    const seen = new Set<string>();
    const result: F07CandidateRecord[] = [];
    for (const row of rows) {
      const clone = localCloneFromRow(row);
      const key = `${clone.canonicalRoot}:${clone.repository.key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        canonicalRoot: clone.canonicalRoot,
        repository: clone.repository,
        status: clone.status,
        cleanState: clone.cleanState,
        lastValidatedAt: clone.validatedAt,
      });
    }
    return result;
  }

  public getClone(managedPrId: string): ManagedPrLocalCloneView | undefined {
    safeId(managedPrId, "managed PR identifier");
    const row = this.store.read("SELECT * FROM f07_local_clone_associations WHERE managed_pr_id = ?", managedPrId);
    return row === undefined ? undefined : localCloneFromRow(row);
  }

  private attemptFromRow(row: SqlRow): F07AddAttemptRecord {
    const managedPrId = rowOptionalString(row, "managed_pr_id");
    const reason = readReason(row, "reason_json");
    return {
      schemaVersion: 1,
      id: rowString(row, "attempt_id"),
      correlationId: rowString(row, "correlation_id"),
      idempotencyKey: rowString(row, "idempotency_key"),
      canonicalPrKey: rowString(row, "canonical_pr_key"),
      serverId: rowString(row, "server_id"),
      normalizedUrl: rowString(row, "normalized_url"),
      status: attemptStatus(rowString(row, "status")),
      ...(managedPrId === undefined ? {} : { managedPrId }),
      ...(reason === undefined ? {} : { reason }),
      version: rowNumber(row, "version"),
      createdAt: rowString(row, "created_at"),
      updatedAt: rowString(row, "updated_at"),
      context: rowBoolean(row, "context_present") ? rowString(row, "context_text") : null,
      syncSourceBranchOverride: rowBoolean(row, "override_present") ? rowString(row, "override_text") : null,
      parsedInput: decodeJson(row, "parsed_input_json", "parsed_input_hash"),
      profileVersion: rowNumber(row, "profile_version"),
    };
  }

  private readManagedPr(row: SqlRow): ManagedPrReadModel {
    return this.store.transaction((transaction) => this.readManagedPrInTransaction(transaction, row));
  }

  private readManagedPrInTransaction(transaction: PersistenceTransaction, row: SqlRow): ManagedPrReadModel {
    const managedPrId = rowString(row, "managed_pr_id");
    const configuration = transaction.get("SELECT * FROM f07_pr_configuration_revisions WHERE revision_id = ?", rowString(row, "current_configuration_revision_id"));
    if (configuration === undefined) throw new Error("F07_CONFIGURATION_NOT_READABLE");
    const association = transaction.get("SELECT * FROM f07_local_clone_associations WHERE managed_pr_id = ?", managedPrId);
    const remote = decodeJson<ManagedPrRemoteSnapshot>(row, "remote_snapshot_json", "remote_snapshot_hash");
    const localClone = association === undefined ? undefined : localCloneFromRow(association);
    const title = remote.title;
    return {
      schemaVersion: 1,
      id: managedPrId,
      canonicalUrl: rowString(row, "canonical_url"),
      pullRequestKey: rowString(row, "canonical_pr_key"),
      serverId: rowString(row, "server_id"),
      owner: rowString(row, "owner"),
      repositoryName: rowString(row, "repository_name"),
      number: rowNumber(row, "number"),
      state: rowString(row, "remote_state") as ManagedPrReadModel["state"],
      merged: rowBoolean(row, "merged"),
      ...(title === undefined ? {} : { title }),
      baseRepository: remote.baseRepository,
      headRepository: remote.headRepository,
      prBaseBranch: rowString(row, "base_branch"),
      prHeadBranch: rowString(row, "head_branch"),
      prBaseSha: rowString(row, "base_sha"),
      prHeadSha: rowString(row, "head_sha"),
      ...(rowOptionalString(row, "default_branch") === undefined ? {} : { defaultBranch: rowOptionalString(row, "default_branch") }),
      primaryState: rowString(row, "primary_state") as ManagedPrReadModel["primaryState"],
      localSetupStatus: setupStatus(rowString(row, "local_setup_status")),
      ...(localClone === undefined ? {} : { localClone }),
      configuration: configurationFromRow(configuration),
      ...(readReason(row, "last_operation_reason_json") === undefined ? {} : { lastOperationReason: readReason(row, "last_operation_reason_json") }),
      version: rowNumber(row, "version"),
      createdAt: rowString(row, "created_at"),
      updatedAt: rowString(row, "updated_at"),
    };
  }

  private ensureRepository(
    transaction: PersistenceTransaction,
    serverId: string,
    repository: Extract<ManagedPrRemoteSnapshot["baseRepository"], { readonly available: true }>,
    repositoryId: string,
    defaultBranch: string | undefined,
    changedAt: string,
  ): void {
    const metadata = encodeSnapshot({ providerId: repository.providerId ?? null }).payload;
    transaction.run(
      "INSERT OR IGNORE INTO repositories (repository_id, server_id, owner, name, default_branch, metadata_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
      repositoryId,
      serverId,
      repository.owner,
      repository.name,
      defaultBranch ?? null,
      metadata,
      changedAt,
      changedAt,
    );
    const server = transaction.get("SELECT server_id FROM github_servers WHERE server_id = ?", serverId);
    if (server === undefined) {
      throw new Error("F07_SERVER_FOREIGN_KEY_MISSING");
    }
  }

  private insertAssociation(
    transaction: PersistenceTransaction,
    managedPrId: string,
    localClone: ManagedPrLocalCloneView,
    changedAt: string,
  ): void {
    transaction.run(
      "INSERT INTO f07_local_clone_associations (association_id, managed_pr_id, canonical_root, repository_json, status, clean_state, validation_snapshot_json, validated_at, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
      localClone.associationId || associationId(managedPrId),
      managedPrId,
      localClone.canonicalRoot,
      JSON.stringify(localClone.repository),
      localClone.status,
      localClone.cleanState,
      JSON.stringify(localClone.validationSnapshot),
      localClone.validatedAt,
      changedAt,
      changedAt,
    );
  }
}

export function createF07PersistenceRepositories(
  store: PersistenceStore,
  options: { readonly clock?: PersistenceClock } = {},
): F07PersistenceRepositories {
  return new F07PersistenceRepositories(store, options);
}
