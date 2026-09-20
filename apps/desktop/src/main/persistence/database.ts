import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  mkdir,
  readdir,
  readFile,
  lstat,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { encodeSnapshot, assertBoundedText } from "./codecs";
import {
  currentMigrationVersion,
  MIGRATIONS,
  migrationByVersion,
  readUserVersion,
} from "./migrations";
import {
  DEFAULT_BUSY_TIMEOUT_MS,
  DEFAULT_MAX_TRANSACTION_ATTEMPTS,
  PersistenceError,
  type PersistenceClock,
  type PersistenceFaultInjection,
  type PersistenceHealth,
  type PersistenceOpenOptions,
  type PersistencePaths,
  type PersistenceReason,
  type PersistenceStage,
  type PersistenceTransaction,
  type PersistenceErrorCode,
  type SqliteDatabase,
  type SqlRow,
  type SqlValue,
  type TransactionOptions,
} from "./types";

const require = createRequire(import.meta.url);
const sqlite = require("node:" + "sqlite") as {
  readonly DatabaseSync: new (
    path: string,
    options?: {
      readonly readOnly?: boolean;
      readonly enableForeignKeyConstraints?: boolean;
      readonly allowExtension?: boolean;
      readonly timeout?: number;
    },
  ) => SqliteDatabase;
  readonly backup: (source: SqliteDatabase, path: string) => Promise<number>;
};

const BACKUP_OWNER = "prmonitor-f03-backup-v1";
const DEFAULT_BUILD = "development";
const BACKUP_MARKER_PREFIX = ".prmonitor-f03-backup-";

function defaultClock(): PersistenceClock {
  return { now: () => new Date().toISOString() };
}

function correlationId(value?: string): string {
  if (value !== undefined && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value))
    return value;
  return `persistence-${randomUUID()}`;
}

function databaseId(databasePath: string): string {
  return createHash("sha256")
    .update(path.resolve(databasePath), "utf8")
    .digest("hex")
    .slice(0, 24);
}

function pathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function reason(
  code: PersistenceErrorCode,
  stage: PersistenceStage,
  what: string,
  nextAction: PersistenceReason["nextAction"],
  databaseIdentity: string,
  correlation: string,
  details: Readonly<Record<string, string | number | boolean>> = {},
): PersistenceReason {
  return {
    code,
    stage,
    what,
    why: "The persistence boundary failed closed so durable application state cannot be replaced or misreported.",
    nextAction,
    correlationId: correlation,
    databaseId: databaseIdentity,
    details,
  };
}

function persistenceError(
  code: PersistenceErrorCode,
  stage: PersistenceStage,
  what: string,
  nextAction: PersistenceReason["nextAction"],
  databaseIdentity: string,
  correlation: string,
  details?: Readonly<Record<string, string | number | boolean>>,
  _cause?: unknown,
): PersistenceError {
  return new PersistenceError(
    reason(
      code,
      stage,
      what,
      nextAction,
      databaseIdentity,
      correlation,
      details,
    ),
  );
}

function isBusy(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /SQLITE_BUSY|SQLITE_LOCKED|database is locked|database table is locked/iu.test(
    message,
  );
}

function isConstraint(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /SQLITE_CONSTRAINT|UNIQUE constraint|FOREIGN KEY constraint/iu.test(
    message,
  );
}

function isCorrupt(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /SQLITE_NOTADB|not a database|file is encrypted|malformed/iu.test(
    message,
  );
}

function sleepSync(milliseconds: number): void {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, milliseconds);
}

function safeBuild(value: string | undefined): string {
  const build = value ?? DEFAULT_BUILD;
  assertBoundedText(build, "application build");
  return build;
}

function asRows<T extends SqlRow>(rows: readonly T[]): T[] {
  return rows.map((row) => ({ ...row }));
}

interface BackupMarker {
  readonly owner: typeof BACKUP_OWNER;
  readonly backupId: string;
  readonly databaseId: string;
  readonly sourceSchemaVersion: number;
  readonly targetSchemaVersion: number;
  readonly createdAt: string;
  readonly backupFile: string;
}

class TransactionContext implements PersistenceTransaction {
  private writeCount = 0;

  public constructor(
    public readonly connection: SqliteDatabase,
    private readonly faultInjection: PersistenceFaultInjection | undefined,
  ) {}

  public run(
    sql: string,
    ...parameters: SqlValue[]
  ): { changes: number; lastInsertRowid: number | bigint } {
    this.writeCount += 1;
    if (this.faultInjection?.failAfterWriteNumber === this.writeCount) {
      throw new Error("F03_INJECTED_WRITE_FAILURE");
    }
    const result = this.connection.prepare(sql).run(...parameters);
    return {
      changes: Number(result.changes),
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  public get<T extends SqlRow = SqlRow>(
    sql: string,
    ...parameters: SqlValue[]
  ): T | undefined {
    const row = this.connection.prepare(sql).get(...parameters);
    return row === undefined ? undefined : ({ ...row } as T);
  }

  public all<T extends SqlRow = SqlRow>(
    sql: string,
    ...parameters: SqlValue[]
  ): T[] {
    return asRows(this.connection.prepare(sql).all(...parameters) as T[]);
  }

  public prepare(sql: string) {
    return this.connection.prepare(sql);
  }
}

export interface PersistenceInitializationSuccess {
  readonly ok: true;
  readonly store: PersistenceStore;
}

export interface PersistenceInitializationFailure {
  readonly ok: false;
  readonly health: PersistenceHealth;
  readonly error: PersistenceError;
}

export type PersistenceInitializationResult =
  PersistenceInitializationSuccess | PersistenceInitializationFailure;

export class PersistenceStore {
  private closed = false;

  private constructor(
    private readonly database: SqliteDatabase,
    public readonly paths: PersistencePaths,
    public readonly health: PersistenceHealth,
    private readonly clock: PersistenceClock,
    private readonly maxTransactionAttempts: number,
  ) {}

  public static async open(
    paths: PersistencePaths,
    options: PersistenceOpenOptions = {},
  ): Promise<PersistenceStore> {
    const prepared = await preparePaths(paths, options);
    const databaseIdentity = databaseId(prepared.databasePath);
    const correlation = correlationId(options.correlationId);
    const clock = options.clock ?? defaultClock();
    let database: SqliteDatabase | undefined;
    try {
      database = new sqlite.DatabaseSync(prepared.databasePath, {
        enableForeignKeyConstraints: true,
        allowExtension: false,
        timeout: options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
      });
      database.exec(
        "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;",
      );
      const beforeVersion = readUserVersion(database);
      if (beforeVersion > currentMigrationVersion()) {
        throw persistenceError(
          "UNSUPPORTED_SCHEMA_VERSION",
          "migration",
          "The database schema is newer than this application supports.",
          "RESTORE_BACKUP",
          databaseIdentity,
          correlation,
          {
            actualVersion: beforeVersion,
            supportedVersion: currentMigrationVersion(),
          },
        );
      }

      await verifyAppliedMigrationChecksums(
        database,
        beforeVersion,
        databaseIdentity,
        correlation,
      );
      let backupPath: string | undefined;
      if (beforeVersion < currentMigrationVersion() && beforeVersion > 0) {
        backupPath = await createVerifiedBackup(
          database,
          prepared,
          beforeVersion,
          currentMigrationVersion(),
          databaseIdentity,
          clock,
          correlation,
          options.maxBackups ?? 5,
          options.faultInjection,
        );
      }

      const upgraded = beforeVersion < currentMigrationVersion();
      if (upgraded) {
        await applyMigrations(
          database,
          beforeVersion,
          safeBuild(options.applicationBuild),
          clock,
          databaseIdentity,
          correlation,
          options.signal,
          options.faultInjection,
        );
      }
      const afterVersion = readUserVersion(database);
      await runIntegrityChecks(
        database,
        databaseIdentity,
        correlation,
        options.faultInjection?.failIntegrityCheck,
      );
      const health: PersistenceHealth = {
        status: upgraded ? "upgraded" : "healthy",
        stage: "integrity",
        schemaVersion: afterVersion,
        databaseId: databaseIdentity,
        correlationId: correlation,
        checkedAt: clock.now(),
        ...(backupPath === undefined ? {} : { backupPath }),
      };
      writeHealth(database, health);
      return new PersistenceStore(
        database,
        prepared,
        health,
        clock,
        Math.max(
          1,
          Math.min(
            options.maxTransactionAttempts ?? DEFAULT_MAX_TRANSACTION_ATTEMPTS,
            8,
          ),
        ),
      );
    } catch (error) {
      if (database !== undefined) {
        try {
          database.close();
        } catch {
          // The original error is the actionable persistence result.
        }
      }
      if (error instanceof PersistenceError) throw error;
      const code = isCorrupt(error)
        ? "CORRUPT_DATABASE"
        : isBusy(error)
          ? "BUSY_TIMEOUT"
          : "OPEN_FAILED";
      throw persistenceError(
        code,
        "open",
        "The persistence database could not be initialized safely.",
        "RETRY",
        databaseIdentity,
        correlation,
        {},
        error,
      );
    }
  }

  public get connection(): SqliteDatabase {
    return this.database;
  }

  public transaction<T>(
    work: (transaction: PersistenceTransaction) => T,
    options: TransactionOptions = {},
  ): T {
    const correlation = correlationId(
      options.correlationId ?? this.health.correlationId,
    );
    const attempts = Math.max(
      1,
      Math.min(options.maxAttempts ?? this.maxTransactionAttempts, 8),
    );
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (options.signal?.aborted) {
        throw persistenceError(
          "TRANSACTION_CANCELLED",
          "health_record",
          "The transaction was cancelled before it started.",
          "RETRY",
          this.health.databaseId,
          correlation,
        );
      }
      let began = false;
      let committed = false;
      try {
        this.database.exec("BEGIN IMMEDIATE");
        began = true;
        const context = new TransactionContext(
          this.database,
          options.faultInjection,
        );
        const value = work(context);
        if (
          options.signal?.aborted ||
          options.faultInjection?.failBeforeCommit
        ) {
          throw persistenceError(
            "TRANSACTION_CANCELLED",
            "health_record",
            "The transaction was cancelled before commit.",
            "RETRY",
            this.health.databaseId,
            correlation,
          );
        }
        this.database.exec("COMMIT");
        committed = true;
        if (options.faultInjection?.failAfterCommit) {
          throw persistenceError(
            "TRANSACTION_FAILED",
            "health_record",
            "The commit was acknowledged but the caller must reconcile its result.",
            "RECONCILE",
            this.health.databaseId,
            correlation,
            { committed: true },
          );
        }
        return value;
      } catch (error) {
        lastError = error;
        if (began && !committed) {
          try {
            this.database.exec("ROLLBACK");
          } catch {
            // SQLite recovery and the original error remain authoritative.
          }
        }
        if (
          error instanceof PersistenceError &&
          error.reason.code !== "BUSY_TIMEOUT"
        ) {
          throw error;
        }
        if (!isBusy(error) || attempt === attempts) break;
        sleepSync(Math.min(25 * attempt, 100));
      }
    }
    if (lastError instanceof PersistenceError) throw lastError;
    if (isConstraint(lastError)) {
      throw persistenceError(
        "DUPLICATE",
        "health_record",
        "The persistence write conflicts with an existing durable record.",
        "RECONCILE",
        this.health.databaseId,
        correlation,
      );
    }
    if (isBusy(lastError)) {
      throw persistenceError(
        "BUSY_TIMEOUT",
        "health_record",
        "The database remained busy after bounded retries.",
        "RETRY",
        this.health.databaseId,
        correlation,
        { attempts },
      );
    }
    throw persistenceError(
      "TRANSACTION_FAILED",
      "health_record",
      "The transaction rolled back before a durable commit was acknowledged.",
      "RETRY",
      this.health.databaseId,
      correlation,
      {},
      lastError,
    );
  }

  public read<T extends SqlRow = SqlRow>(
    sql: string,
    ...parameters: SqlValue[]
  ): T | undefined {
    return this.connection.prepare(sql).get(...parameters) as T | undefined;
  }

  public readAll<T extends SqlRow = SqlRow>(
    sql: string,
    ...parameters: SqlValue[]
  ): T[] {
    return this.connection.prepare(sql).all(...parameters) as T[];
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }
}

function validatePaths(paths: PersistencePaths): PersistencePaths {
  if (
    !path.isAbsolute(paths.databasePath) ||
    !path.isAbsolute(paths.backupRoot)
  ) {
    throw new Error("paths must be absolute");
  }
  const databasePath = path.resolve(paths.databasePath);
  const backupRoot = path.resolve(paths.backupRoot);
  const databaseDirectory = path.dirname(databasePath);
  if (
    databasePath === backupRoot ||
    pathWithin(backupRoot, databasePath) ||
    pathWithin(databaseDirectory, backupRoot)
  ) {
    throw new Error(
      "database and backup roots must be separate and non-nested",
    );
  }
  return { databasePath, backupRoot };
}

async function preparePaths(
  paths: PersistencePaths,
  options: PersistenceOpenOptions,
): Promise<PersistencePaths> {
  let prepared: PersistencePaths;
  try {
    prepared = validatePaths(paths);
    await mkdir(path.dirname(prepared.databasePath), { recursive: true });
    await mkdir(prepared.backupRoot, { recursive: true });
    const databaseParent = await realpath(path.dirname(prepared.databasePath));
    const backupDirectory = await realpath(prepared.backupRoot);
    if (
      pathWithin(databaseParent, backupDirectory) ||
      pathWithin(backupDirectory, databaseParent)
    ) {
      throw new Error("database and backup roots must not be nested");
    }
    if (options.signal?.aborted) throw new Error("cancelled");
    return prepared;
  } catch (error) {
    throw persistenceError(
      "INVALID_PATH",
      "path_validation",
      "The application data and backup paths are not safe to use.",
      "FIX_INPUT",
      databaseId(paths.databasePath),
      correlationId(options.correlationId),
      {},
      error,
    );
  }
}

async function verifyAppliedMigrationChecksums(
  database: SqliteDatabase,
  beforeVersion: number,
  databaseIdentity: string,
  correlation: string,
): Promise<void> {
  if (beforeVersion === 0) return;
  try {
    const rows = database
      .prepare(
        "SELECT version, migration_id, checksum FROM schema_migrations ORDER BY version",
      )
      .all() as Array<{
      version: number;
      migration_id: string;
      checksum: string;
    }>;
    const expected = MIGRATIONS.filter(
      (migration) => migration.version <= beforeVersion,
    );
    if (
      rows.length !== expected.length ||
      rows.some((row, index) => row.version !== expected[index]?.version)
    ) {
      throw persistenceError(
        "CORRUPT_DATABASE",
        "migration",
        "The migration ledger does not describe every applied schema version.",
        "RESTORE_BACKUP",
        databaseIdentity,
        correlation,
      );
    }
    for (const row of rows) {
      const migration = migrationByVersion(row.version);
      if (
        migration === undefined ||
        migration.id !== row.migration_id ||
        migration.checksum !== row.checksum
      ) {
        throw persistenceError(
          "MIGRATION_CHECKSUM_MISMATCH",
          "migration",
          "An applied migration was edited or is no longer supported.",
          "RESTORE_BACKUP",
          databaseIdentity,
          correlation,
          { version: row.version },
        );
      }
    }
  } catch (error) {
    if (error instanceof PersistenceError) throw error;
    throw persistenceError(
      "CORRUPT_DATABASE",
      "migration",
      "The migration ledger could not be read safely.",
      "RESTORE_BACKUP",
      databaseIdentity,
      correlation,
      {},
      error,
    );
  }
}

async function applyMigrations(
  database: SqliteDatabase,
  beforeVersion: number,
  applicationBuild: string,
  clock: PersistenceClock,
  databaseIdentity: string,
  correlation: string,
  signal: AbortSignal | undefined,
  faultInjection: PersistenceFaultInjection | undefined,
): Promise<void> {
  try {
    database.exec("BEGIN IMMEDIATE");
    let writes = 0;
    for (const migration of MIGRATIONS) {
      if (migration.version <= beforeVersion) continue;
      if (signal?.aborted) throw new Error("F03_MIGRATION_CANCELLED");
      database.exec(migration.sql);
      writes += 1;
      if (faultInjection?.failAfterWriteNumber === writes)
        throw new Error("F03_INJECTED_MIGRATION_FAILURE");
      database
        .prepare(
          "INSERT INTO schema_migrations (version, migration_id, checksum, applied_at, application_build, schema_version) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          migration.version,
          migration.id,
          migration.checksum,
          clock.now(),
          applicationBuild,
          migration.version,
        );
    }
    if (faultInjection?.failBeforeCommit)
      throw new Error("F03_MIGRATION_CANCELLED");
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the migration failure below.
    }
    throw persistenceError(
      "MIGRATION_FAILED",
      "migration",
      "The schema migration was rolled back and the source database was preserved.",
      "RESTORE_BACKUP",
      databaseIdentity,
      correlation,
      {},
      error,
    );
  }
}

async function createVerifiedBackup(
  database: SqliteDatabase,
  paths: PersistencePaths,
  sourceSchemaVersion: number,
  targetSchemaVersion: number,
  databaseIdentity: string,
  clock: PersistenceClock,
  correlation: string,
  maxBackups: number,
  faultInjection: PersistenceFaultInjection | undefined,
): Promise<string> {
  const backupId = `${databaseIdentity}-${sourceSchemaVersion}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const backupFile = `${backupId}.sqlite`;
  const backupPath = path.join(paths.backupRoot, backupFile);
  const markerPath = path.join(
    paths.backupRoot,
    `${BACKUP_MARKER_PREFIX}${backupId}.json`,
  );
  const createdAt = clock.now();
  try {
    await sqlite.backup(database, backupPath);
    if (faultInjection?.failBackupVerification) {
      throw new Error("F03_INJECTED_BACKUP_VERIFICATION_FAILURE");
    }
    const backupDatabase = new sqlite.DatabaseSync(backupPath, {
      readOnly: true,
      enableForeignKeyConstraints: true,
      allowExtension: false,
      timeout: DEFAULT_BUSY_TIMEOUT_MS,
    });
    try {
      await runIntegrityChecks(backupDatabase, databaseIdentity, correlation);
      if (readUserVersion(backupDatabase) !== sourceSchemaVersion)
        throw new Error("backup schema version mismatch");
    } finally {
      backupDatabase.close();
    }
    const marker: BackupMarker = {
      owner: BACKUP_OWNER,
      backupId,
      databaseId: databaseIdentity,
      sourceSchemaVersion,
      targetSchemaVersion,
      createdAt,
      backupFile,
    };
    await writeFile(markerPath, `${JSON.stringify(marker)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    database
      .prepare(
        "INSERT INTO backup_metadata (backup_id, source_schema_version, target_schema_version, database_id, backup_path, owner_marker_path, created_at, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        backupId,
        sourceSchemaVersion,
        targetSchemaVersion,
        databaseIdentity,
        backupPath,
        markerPath,
        createdAt,
        clock.now(),
      );
    await cleanupOldBackups(
      paths.backupRoot,
      databaseIdentity,
      path.resolve(paths.databasePath),
      Math.max(1, Math.min(maxBackups, 20)),
    );
    return backupPath;
  } catch (error) {
    throw persistenceError(
      "BACKUP_VERIFICATION_FAILED",
      "backup",
      "The pre-migration backup could not be verified; the live database was not migrated.",
      "RESTORE_BACKUP",
      databaseIdentity,
      correlation,
      { sourceSchemaVersion, targetSchemaVersion },
      error,
    );
  }
}

async function cleanupOldBackups(
  backupRoot: string,
  databaseIdentity: string,
  liveDatabasePath: string,
  maxBackups: number,
): Promise<void> {
  const entries = await readdir(backupRoot, { withFileTypes: true });
  const backups: Array<{
    markerPath: string;
    backupPath: string;
    createdAt: string;
  }> = [];
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.startsWith(BACKUP_MARKER_PREFIX) ||
      !entry.name.endsWith(".json")
    )
      continue;
    const markerPath = path.join(backupRoot, entry.name);
    try {
      const parsed = JSON.parse(
        await readFile(markerPath, "utf8"),
      ) as Partial<BackupMarker>;
      if (
        parsed.owner !== BACKUP_OWNER ||
        parsed.databaseId !== databaseIdentity ||
        typeof parsed.backupFile !== "string" ||
        typeof parsed.createdAt !== "string"
      )
        continue;
      const backupPath = path.resolve(backupRoot, parsed.backupFile);
      if (
        !pathWithin(backupRoot, backupPath) ||
        backupPath === liveDatabasePath
      )
        continue;
      const info = await lstat(backupPath);
      if (!info.isFile() || info.isSymbolicLink()) continue;
      const canonicalBackup = await realpath(backupPath);
      const canonicalRoot = await realpath(backupRoot);
      if (!pathWithin(canonicalRoot, canonicalBackup)) continue;
      backups.push({ markerPath, backupPath, createdAt: parsed.createdAt });
    } catch {
      // Unknown or damaged artifacts are retained for manual recovery.
    }
  }
  backups.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  for (const backupEntry of backups.slice(
    0,
    Math.max(0, backups.length - maxBackups),
  )) {
    await unlink(backupEntry.markerPath);
    await unlink(backupEntry.backupPath);
  }
}

async function runIntegrityChecks(
  database: SqliteDatabase,
  databaseIdentity: string,
  correlation: string,
  failIntegrityCheck = false,
): Promise<void> {
  try {
    if (failIntegrityCheck) throw new Error("F03_INJECTED_INTEGRITY_FAILURE");
    const integrity = database
      .prepare("PRAGMA integrity_check")
      .all() as Array<{ integrity_check?: unknown }>;
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") {
      throw persistenceError(
        "INTEGRITY_CHECK_FAILED",
        "integrity",
        "SQLite integrity verification failed.",
        "RESTORE_BACKUP",
        databaseIdentity,
        correlation,
      );
    }
    const foreignKeys = database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeys.length !== 0) {
      throw persistenceError(
        "FOREIGN_KEY_CHECK_FAILED",
        "integrity",
        "SQLite foreign-key verification failed.",
        "RESTORE_BACKUP",
        databaseIdentity,
        correlation,
        { violations: foreignKeys.length },
      );
    }
  } catch (error) {
    if (error instanceof PersistenceError) throw error;
    throw persistenceError(
      "INTEGRITY_CHECK_FAILED",
      "integrity",
      "SQLite integrity verification could not complete safely.",
      "RESTORE_BACKUP",
      databaseIdentity,
      correlation,
      {},
      error,
    );
  }
}

function writeHealth(
  database: SqliteDatabase,
  health: PersistenceHealth,
): void {
  const encoded = encodeSnapshot({
    status: health.status,
    stage: health.stage,
  });
  database
    .prepare(
      "INSERT INTO persistence_health (health_id, status, stage, schema_version, database_id, correlation_id, checked_at, reason_code, recommended_action, backup_path, details_json) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(health_id) DO UPDATE SET status=excluded.status, stage=excluded.stage, schema_version=excluded.schema_version, database_id=excluded.database_id, correlation_id=excluded.correlation_id, checked_at=excluded.checked_at, reason_code=excluded.reason_code, recommended_action=excluded.recommended_action, backup_path=excluded.backup_path, details_json=excluded.details_json",
    )
    .run(
      health.status,
      health.stage,
      health.schemaVersion,
      health.databaseId,
      health.correlationId,
      health.checkedAt,
      health.reasonCode ?? null,
      health.recommendedAction ?? null,
      health.backupPath ?? null,
      encoded.payload,
    );
}

export async function initializePersistence(
  paths: PersistencePaths,
  options: PersistenceOpenOptions = {},
): Promise<PersistenceStore> {
  return PersistenceStore.open(paths, options);
}

export async function tryInitializePersistence(
  paths: PersistencePaths,
  options: PersistenceOpenOptions = {},
): Promise<PersistenceInitializationResult> {
  try {
    const store = await initializePersistence(paths, options);
    return { ok: true, store };
  } catch (error) {
    const persistence =
      error instanceof PersistenceError
        ? error
        : persistenceError(
            "OPEN_FAILED",
            "open",
            "Persistence initialization failed safely.",
            "RETRY",
            databaseId(paths.databasePath),
            correlationId(options.correlationId),
            {},
            error,
          );
    return {
      ok: false,
      health: {
        status: "recovery_required",
        stage: persistence.reason.stage,
        schemaVersion: 0,
        databaseId: persistence.reason.databaseId,
        correlationId: persistence.reason.correlationId,
        checkedAt: (options.clock ?? defaultClock()).now(),
        reasonCode: persistence.reason.code,
        recommendedAction: persistence.reason.nextAction,
      },
      error: persistence,
    };
  }
}
