export const PERSISTENCE_SCHEMA_VERSION = 2 as const;
export const PERSISTENCE_RECORD_SCHEMA_VERSION = 1 as const;
export const DEFAULT_BUSY_TIMEOUT_MS = 5_000;
export const DEFAULT_MAX_TRANSACTION_ATTEMPTS = 3;
export const MAX_PERSISTED_JSON_BYTES = 512 * 1024;
export const MAX_PERSISTED_TEXT_BYTES = 64 * 1024;

export type PersistenceHealthStatus =
  "healthy" | "upgraded" | "recovery_required";

export type PersistenceStage =
  | "path_validation"
  | "open"
  | "backup"
  | "migration"
  | "integrity"
  | "health_record";

export type PersistenceErrorCode =
  | "INVALID_PATH"
  | "OPEN_FAILED"
  | "CORRUPT_DATABASE"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "MIGRATION_FAILED"
  | "MIGRATION_CHECKSUM_MISMATCH"
  | "BACKUP_FAILED"
  | "BACKUP_VERIFICATION_FAILED"
  | "INTEGRITY_CHECK_FAILED"
  | "FOREIGN_KEY_CHECK_FAILED"
  | "BUSY_TIMEOUT"
  | "TRANSACTION_FAILED"
  | "TRANSACTION_CANCELLED"
  | "CONFLICT"
  | "DUPLICATE"
  | "INVALID_RECORD"
  | "NOT_FOUND"
  | "SECURITY_VIOLATION";

export interface PersistenceReason {
  readonly code: PersistenceErrorCode;
  readonly stage: PersistenceStage;
  readonly what: string;
  readonly why: string;
  readonly nextAction: "RETRY" | "RESTORE_BACKUP" | "FIX_INPUT" | "RECONCILE";
  readonly correlationId: string;
  readonly databaseId: string;
  readonly details: Readonly<Record<string, string | number | boolean>>;
}

export class PersistenceError extends Error {
  public readonly reason: PersistenceReason;

  public constructor(reason: PersistenceReason, options?: ErrorOptions) {
    super(`${reason.code}: ${reason.what}`, options);
    this.name = "PersistenceError";
    this.reason = reason;
  }
}

export interface PersistencePaths {
  readonly databasePath: string;
  readonly backupRoot: string;
}

export interface PersistenceClock {
  readonly now: () => string;
}

export interface PersistenceHealth {
  readonly status: PersistenceHealthStatus;
  readonly stage: PersistenceStage;
  readonly schemaVersion: number;
  readonly databaseId: string;
  readonly correlationId: string;
  readonly checkedAt: string;
  readonly reasonCode?: PersistenceErrorCode;
  readonly recommendedAction?:
    "RETRY" | "RESTORE_BACKUP" | "FIX_INPUT" | "RECONCILE";
  readonly backupPath?: string;
}

export interface PersistenceOpenOptions {
  readonly applicationBuild?: string;
  readonly clock?: PersistenceClock;
  readonly busyTimeoutMs?: number;
  readonly maxTransactionAttempts?: number;
  readonly maxBackups?: number;
  readonly correlationId?: string;
  readonly signal?: AbortSignal;
  readonly faultInjection?: PersistenceFaultInjection;
}

export interface PersistenceFaultInjection {
  readonly failAfterWriteNumber?: number;
  readonly failBeforeCommit?: boolean;
  readonly failAfterCommit?: boolean;
  readonly failBackupVerification?: boolean;
  readonly failIntegrityCheck?: boolean;
}

export interface TransactionOptions {
  readonly correlationId?: string;
  readonly signal?: AbortSignal;
  readonly maxAttempts?: number;
  readonly faultInjection?: PersistenceFaultInjection;
}

export interface MigrationDefinition {
  readonly version: number;
  readonly id: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface SqliteStatement {
  run(...parameters: SqlValue[]): {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  };
  get(...parameters: SqlValue[]): Record<string, unknown> | undefined;
  all(...parameters: SqlValue[]): Record<string, unknown>[];
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

export type SqlValue = null | number | string | bigint | NodeJS.ArrayBufferView;
export type SqlRow = Record<string, unknown>;

export interface PersistenceTransaction {
  readonly connection: SqliteDatabase;
  run(
    sql: string,
    ...parameters: SqlValue[]
  ): { changes: number; lastInsertRowid: number | bigint };
  get<T extends SqlRow = SqlRow>(
    sql: string,
    ...parameters: SqlValue[]
  ): T | undefined;
  all<T extends SqlRow = SqlRow>(sql: string, ...parameters: SqlValue[]): T[];
  prepare(sql: string): SqliteStatement;
}

export interface PersistedRecord<T> {
  readonly id: string;
  readonly schemaVersion: number;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly payload: T;
  readonly payloadHash: string;
}

export interface VersionedWrite<T> {
  readonly id: string;
  readonly payload: T;
  readonly expectedVersion?: number;
  readonly schemaVersion?: number;
}

export interface RemoteEventVersionInput<T = unknown> {
  readonly id: string;
  readonly managedPrId: string;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly sourceRepositoryId?: string;
  readonly observedAt: string;
  readonly sourceUpdatedAt?: string;
  readonly semanticHash: string;
  readonly payload: T;
}

export interface ReviewBundleCommitInput {
  readonly batch: VersionedWrite<unknown> & { readonly managedPrId: string };
  readonly bundle: VersionedWrite<unknown> & {
    readonly managedPrId: string;
    readonly state: string;
    readonly automaticOperationKey?: string;
  };
  readonly events: readonly RemoteEventVersionInput[];
  readonly items: readonly {
    readonly id: string;
    readonly eventVersionId: string;
    readonly payload: unknown;
  }[];
  readonly hold?: {
    readonly id: string;
    readonly managedPrId: string;
    readonly bundleId: string;
    readonly payload: unknown;
  };
  readonly transition?: {
    readonly id: string;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly sequence: number;
    readonly priorState?: string;
    readonly currentState: string;
    readonly payload: unknown;
  };
  readonly managedPrExpectedVersion?: number;
}

export interface PublicationIntentInput {
  readonly id: string;
  readonly kind: "REVIEW_BUNDLE" | "SYNCHRONIZATION_RESULT";
  readonly ownerId: string;
  readonly approvalId: string;
  readonly idempotencyKey: string;
  readonly expectedBaselineSha?: string;
  readonly expectedSourceSha?: string;
  readonly expectedHeadSha?: string;
  readonly proposedResult: unknown;
  readonly payload?: unknown;
}

export interface PublicationResponseInput {
  readonly responseKey: string;
  readonly state: "PENDING" | "POSTED" | "FAILED" | "UNKNOWN";
  readonly payload?: unknown;
  readonly remoteId?: string;
  readonly errorCode?: string;
}
