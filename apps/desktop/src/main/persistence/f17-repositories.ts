import {
  aiWorkContinuationSchema,
  aiWorkOperationInputSchema,
  aiWorkOperationRecordSchema,
  aiWorkSegmentRecordSchema,
  aiWorkStopReasonSchema,
  aiWorkTurnIntentSchema,
  aiWorkTurnReportSchema,
  AI_WORK_DEFAULT_TIMEOUT_MS,
  AI_WORK_DEFAULT_TURN_BUDGET,
  assertAIWorkTransition,
  type AIProgressEvaluation,
  type AIWorkAdmission,
  type AIWorkContinuation,
  type AIWorkOperationInput,
  type AIWorkOperationRecord,
  type AIWorkOperationStatus,
  type AIWorkPersistencePort,
  type AIWorkReconciliation,
  type AIWorkSegmentRecord,
  type AIWorkStopReason,
  type AIWorkTurnIntent,
  type AIWorkTurnReport,
  type AIWorkTurnStatus,
  type F16EffectiveAITaskSnapshot,
} from "../../shared/ai-work";
import { encodeSnapshot, assertBoundedIdentifier } from "./codecs";
import type { PersistenceClock, PersistenceTransaction, SqlRow } from "./types";
import { PersistenceError } from "./types";
import type { PersistenceStore } from "./database";

function now(clock: PersistenceClock): string {
  const value = clock.now();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
    throw new Error("F03_CLOCK_MUST_RETURN_UTC_MILLISECONDS");
  return value;
}

function id(value: string, label: string): void {
  assertBoundedIdentifier(value, label);
}

function rowString(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`F17_INVALID_ROW_${key}`);
  return value;
}

function rowNumber(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number") throw new Error(`F17_INVALID_ROW_${key}`);
  return value;
}

function rowOptionalString(row: SqlRow, key: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`F17_INVALID_ROW_${key}`);
  return value;
}

function jsonColumn(row: SqlRow, key: string): unknown {
  try {
    return JSON.parse(rowString(row, key)) as unknown;
  } catch {
    throw new Error(`F17_INVALID_JSON_${key}`);
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
        ? "A newer durable F17 writer owns the lifecycle record."
        : "The bounded AI-work record cannot be safely used.",
    nextAction: code === "CONFLICT" ? "RECONCILE" : "FIX_INPUT",
    correlationId: store.health.correlationId,
    databaseId: store.health.databaseId,
    details: {},
  });
}

function encode(value: unknown): ReturnType<typeof encodeSnapshot> {
  return encodeSnapshot(value);
}

function readPayload(row: SqlRow, key: string, hashKey: string): unknown {
  const payload = jsonColumn(row, key);
  const encoded = encode(payload);
  if (encoded.payloadHash !== rowString(row, hashKey))
    throw new Error("F17_PAYLOAD_HASH_MISMATCH");
  return payload;
}

interface OperationEnvelope {
  readonly input: AIWorkOperationInput;
  readonly stopReason?: AIWorkStopReason;
}

interface SegmentEnvelope {
  readonly taskSnapshot: F16EffectiveAITaskSnapshot;
  readonly timeoutMs: number;
  readonly continuationConfirmationId?: string;
}

interface TurnEnvelope {
  readonly snapshotId: string;
  readonly snapshotHash: string;
  readonly predicateId: string;
  readonly predicateVersion: number;
}

function parsedOperationEnvelope(value: unknown): OperationEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("F17_OPERATION_ENVELOPE_INVALID");
  const candidate = value as Record<string, unknown>;
  const parsed = aiWorkOperationInputSchema.safeParse(candidate.input);
  if (!parsed.success) throw new Error("F17_OPERATION_INPUT_INVALID");
  if (candidate.stopReason !== undefined) {
    const reason = aiWorkStopReasonSchema.safeParse(candidate.stopReason);
    if (!reason.success) throw new Error("F17_OPERATION_REASON_INVALID");
    return { input: parsed.data, stopReason: reason.data };
  }
  return { input: parsed.data };
}

function parsedSegmentEnvelope(value: unknown): SegmentEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("F17_SEGMENT_ENVELOPE_INVALID");
  const candidate = value as Record<string, unknown>;
  if (!Number.isSafeInteger(candidate.timeoutMs))
    throw new Error("F17_SEGMENT_TIMEOUT_INVALID");
  return {
    taskSnapshot: candidate.taskSnapshot as SegmentEnvelope["taskSnapshot"],
    timeoutMs: candidate.timeoutMs as number,
    ...(typeof candidate.continuationConfirmationId === "string"
      ? { continuationConfirmationId: candidate.continuationConfirmationId }
      : {}),
  };
}

function parsedTurnEnvelope(value: unknown): TurnEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("F17_TURN_ENVELOPE_INVALID");
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.snapshotId !== "string" ||
    typeof candidate.snapshotHash !== "string" ||
    typeof candidate.predicateId !== "string" ||
    !Number.isSafeInteger(candidate.predicateVersion)
  )
    throw new Error("F17_TURN_ENVELOPE_INVALID");
  return {
    snapshotId: candidate.snapshotId,
    snapshotHash: candidate.snapshotHash,
    predicateId: candidate.predicateId,
    predicateVersion: candidate.predicateVersion as number,
  };
}

function transitionOrSame(
  kind: "operation" | "segment" | "turn",
  from: string,
  to: string,
): void {
  if (from === to) return;
  assertAIWorkTransition(kind, from as never, to as never);
}

function turnFromRow(row: SqlRow): AIWorkTurnIntent {
  const envelope = parsedTurnEnvelope(
    readPayload(row, "payload_json", "payload_hash"),
  );
  const parsed = aiWorkTurnIntentSchema.parse({
    schemaVersion: 1,
    turnId: rowString(row, "turn_id"),
    operationId: rowString(row, "operation_id"),
    segmentId: rowString(row, "segment_id"),
    sequence: rowNumber(row, "sequence"),
    interactionMode: rowString(row, "interaction_mode"),
    snapshotId: envelope.snapshotId,
    snapshotHash: envelope.snapshotHash,
    predicateId: envelope.predicateId,
    predicateVersion: envelope.predicateVersion,
    timeoutMs: rowNumber(row, "timeout_ms"),
    deadlineAt: rowString(row, "deadline_at"),
    status: rowString(row, "status"),
    reservation: rowString(row, "reservation"),
    createdAt: rowString(row, "created_at"),
    ...(rowOptionalString(row, "started_at") === undefined
      ? {}
      : { startedAt: rowOptionalString(row, "started_at") }),
    ...(rowOptionalString(row, "completed_at") === undefined
      ? {}
      : { completedAt: rowOptionalString(row, "completed_at") }),
    version: rowNumber(row, "version"),
  });
  return parsed;
}

function operationInputWithDefaults(
  input: AIWorkOperationInput,
  configuredTurnBudget: number,
): AIWorkOperationInput & {
  readonly configuredTurnBudget: number;
  readonly timeoutMs: number;
} {
  return {
    ...input,
    configuredTurnBudget,
    budgetSource: input.budgetSource ?? "F16_PREFERENCE",
    timeoutMs: input.timeoutMs ?? AI_WORK_DEFAULT_TIMEOUT_MS,
  };
}

export class F17PersistenceRepositories implements AIWorkPersistencePort {
  private readonly clock: PersistenceClock;

  public constructor(
    private readonly store: PersistenceStore,
    options: { readonly clock?: PersistenceClock } = {},
  ) {
    this.clock = options.clock ?? { now: () => new Date().toISOString() };
  }

  public admitOperation(input: {
    readonly operation: AIWorkOperationInput;
    readonly segmentId: string;
    readonly turnId: string;
    readonly deadlineAt: string;
  }): AIWorkAdmission {
    const parsed = aiWorkOperationInputSchema.safeParse(input.operation);
    if (!parsed.success)
      throw repositoryError(
        this.store,
        "INVALID_RECORD",
        "The F17 operation input is invalid.",
      );
    id(input.segmentId, "F17 segment identifier");
    id(input.turnId, "F17 turn identifier");
    const operation = operationInputWithDefaults(
      parsed.data,
      parsed.data.configuredTurnBudget ?? AI_WORK_DEFAULT_TURN_BUDGET,
    );
    const timestamp = now(this.clock);
    const segmentId = input.segmentId;
    const turnId = input.turnId;
    let inserted = false;
    this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT operation_id FROM f17_ai_work_operations WHERE operation_id = ? OR idempotency_key = ?",
        operation.operationId,
        operation.idempotencyKey ?? "",
      );
      if (existing !== undefined) return;
      inserted = true;
      const envelope: OperationEnvelope = { input: operation };
      const encodedOperation = encode(envelope);
      const segmentEnvelope: SegmentEnvelope = {
        taskSnapshot: operation.taskSnapshot,
        timeoutMs: operation.timeoutMs ?? AI_WORK_DEFAULT_TIMEOUT_MS,
      };
      const encodedSegment = encode(segmentEnvelope);
      const turnEnvelope: TurnEnvelope = {
        snapshotId: operation.taskSnapshot.snapshotId,
        snapshotHash: operation.taskSnapshot.snapshotHash,
        predicateId: operation.predicate.id,
        predicateVersion: operation.predicate.version,
      };
      const encodedTurn = encode(turnEnvelope);
      const mutating = operation.interactionMode === "worktree_write";
      transaction.run(
        "INSERT INTO f17_ai_work_operations (operation_id, parent_operation_id, operation_kind, task_type, status, configured_turn_budget, consumed_turn_count, reserved_turn_count, history_revision, version, idempotency_key, payload_json, payload_hash, created_at, updated_at) VALUES (?, ?, ?, ?, 'WORKING', ?, 0, ?, 0, 1, ?, ?, ?, ?, ?)",
        operation.operationId,
        operation.parentOperationId ?? null,
        operation.operationKind,
        operation.taskType,
        operation.configuredTurnBudget,
        mutating ? 1 : 0,
        operation.idempotencyKey ?? null,
        encodedOperation.payload,
        encodedOperation.payloadHash,
        timestamp,
        timestamp,
      );
      transaction.run(
        "INSERT INTO f17_ai_work_segments (segment_id, operation_id, segment_index, status, interaction_mode, turn_budget, consumed_turn_baseline, version, payload_json, payload_hash, created_at, updated_at) VALUES (?, ?, 0, 'WORKING', ?, ?, 0, 1, ?, ?, ?, ?)",
        segmentId,
        operation.operationId,
        operation.interactionMode,
        operation.configuredTurnBudget,
        encodedSegment.payload,
        encodedSegment.payloadHash,
        timestamp,
        timestamp,
      );
      transaction.run(
        "INSERT INTO f17_ai_work_turn_intents (turn_id, operation_id, segment_id, sequence, interaction_mode, status, reservation, timeout_ms, deadline_at, version, payload_json, payload_hash, created_at) VALUES (?, ?, ?, 0, ?, 'RESERVED', ?, ?, ?, 1, ?, ?, ?)",
        turnId,
        operation.operationId,
        segmentId,
        operation.interactionMode,
        mutating ? "RESERVED" : "NONE",
        operation.timeoutMs ?? AI_WORK_DEFAULT_TIMEOUT_MS,
        input.deadlineAt,
        encodedTurn.payload,
        encodedTurn.payloadHash,
        timestamp,
      );
    });
    const record = this.getOperation(operation.operationId);
    if (record === undefined) throw new Error("F17_OPERATION_NOT_READABLE");
    const turn =
      findTurn(record, input.turnId) ??
      record.segments.flatMap((segment) => segment.turns).at(-1);
    if (turn === undefined) throw new Error("F17_TURN_NOT_READABLE");
    return { inserted, operation: record, turn };
  }

  public reserveNextTurn(input: {
    readonly operationId: string;
    readonly segmentId: string;
    readonly turnId: string;
    readonly deadlineAt: string;
  }): AIWorkTurnIntent {
    id(input.operationId, "F17 operation identifier");
    id(input.segmentId, "F17 segment identifier");
    id(input.turnId, "F17 turn identifier");
    const timestamp = now(this.clock);
    let resolvedTurnId = input.turnId;
    this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT * FROM f17_ai_work_turn_intents WHERE turn_id = ?",
        input.turnId,
      );
      if (existing !== undefined) return;
      const operation = transaction.get(
        "SELECT status, configured_turn_budget, consumed_turn_count, reserved_turn_count, payload_json, payload_hash FROM f17_ai_work_operations WHERE operation_id = ?",
        input.operationId,
      );
      const segment = transaction.get(
        "SELECT interaction_mode, turn_budget, payload_json, payload_hash FROM f17_ai_work_segments WHERE segment_id = ? AND operation_id = ?",
        input.segmentId,
        input.operationId,
      );
      if (operation === undefined || segment === undefined)
        throw repositoryError(
          this.store,
          "NOT_FOUND",
          "The F17 operation or segment does not exist.",
        );
      if (rowString(operation, "status") !== "WORKING")
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The F17 operation is not accepting another turn.",
        );
      const segmentData = parsedSegmentEnvelope(
        readPayload(segment, "payload_json", "payload_hash"),
      );
      const operationEnvelope = parsedOperationEnvelope(
        readPayload(operation, "payload_json", "payload_hash"),
      );
      const mutating =
        rowString(segment, "interaction_mode") === "worktree_write";
      if (
        mutating &&
        rowNumber(operation, "consumed_turn_count") +
          rowNumber(operation, "reserved_turn_count") >=
          rowNumber(operation, "configured_turn_budget")
      )
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The F17 mutating-turn budget is exhausted.",
        );
      const active = transaction.get(
        "SELECT turn_id FROM f17_ai_work_turn_intents WHERE segment_id = ? AND status IN ('RESERVED', 'STARTED')",
        input.segmentId,
      );
      if (active !== undefined) {
        resolvedTurnId = rowString(active, "turn_id");
        return;
      }
      const sequenceRow = transaction.get(
        "SELECT COALESCE(MAX(sequence), -1) AS sequence FROM f17_ai_work_turn_intents WHERE segment_id = ?",
        input.segmentId,
      );
      const sequence =
        rowNumber(sequenceRow ?? { sequence: -1 }, "sequence") + 1;
      const turnEnvelope: TurnEnvelope = {
        snapshotId: segmentData.taskSnapshot.snapshotId,
        snapshotHash: segmentData.taskSnapshot.snapshotHash,
        predicateId: operationEnvelope.input.predicate.id,
        predicateVersion: operationEnvelope.input.predicate.version,
      };
      const encoded = encode(turnEnvelope);
      transaction.run(
        "INSERT INTO f17_ai_work_turn_intents (turn_id, operation_id, segment_id, sequence, interaction_mode, status, reservation, timeout_ms, deadline_at, version, payload_json, payload_hash, created_at) SELECT ?, ?, ?, ?, interaction_mode, 'RESERVED', ?, ?, ?, 1, ?, ?, ? FROM f17_ai_work_segments WHERE segment_id = ?",
        input.turnId,
        input.operationId,
        input.segmentId,
        sequence,
        mutating ? "RESERVED" : "NONE",
        segmentData.timeoutMs,
        input.deadlineAt,
        encoded.payload,
        encoded.payloadHash,
        timestamp,
        input.segmentId,
      );
      if (mutating)
        transaction.run(
          "UPDATE f17_ai_work_operations SET reserved_turn_count = reserved_turn_count + 1, version = version + 1, updated_at = ? WHERE operation_id = ?",
          timestamp,
          input.operationId,
        );
    });
    const operation = this.getOperation(input.operationId);
    const turn =
      operation === undefined ? undefined : findTurn(operation, resolvedTurnId);
    if (turn === undefined) throw new Error("F17_TURN_NOT_READABLE");
    return turn;
  }

  public markTurnStarted(input: {
    readonly turnId: string;
    readonly startedAt: string;
  }): AIWorkTurnIntent {
    id(input.turnId, "F17 turn identifier");
    this.store.transaction((transaction) => {
      const row = transaction.get(
        "SELECT * FROM f17_ai_work_turn_intents WHERE turn_id = ?",
        input.turnId,
      );
      if (row === undefined)
        throw repositoryError(
          this.store,
          "NOT_FOUND",
          "The F17 turn does not exist.",
        );
      const current = turnFromRow(row);
      if (current.status === "STARTED" || current.status !== "RESERVED") return;
      transitionOrSame("turn", current.status, "STARTED");
      const mutating = current.interactionMode === "worktree_write";
      transaction.run(
        "UPDATE f17_ai_work_turn_intents SET status = 'STARTED', reservation = ?, started_at = ?, version = version + 1 WHERE turn_id = ? AND status = 'RESERVED'",
        mutating ? "CONSUMED" : "NONE",
        input.startedAt,
        input.turnId,
      );
      if (mutating)
        transaction.run(
          "UPDATE f17_ai_work_operations SET consumed_turn_count = consumed_turn_count + 1, reserved_turn_count = CASE WHEN reserved_turn_count > 0 THEN reserved_turn_count - 1 ELSE 0 END, version = version + 1, updated_at = ? WHERE operation_id = ?",
          input.startedAt,
          current.operationId,
        );
    });
    const operation = this.getOperationByTurn(input.turnId);
    const turn =
      operation === undefined ? undefined : findTurn(operation, input.turnId);
    if (turn === undefined) throw new Error("F17_TURN_NOT_READABLE");
    return turn;
  }

  public releaseTurn(input: {
    readonly turnId: string;
    readonly completedAt: string;
  }): AIWorkTurnIntent {
    id(input.turnId, "F17 turn identifier");
    this.store.transaction((transaction) => {
      const row = transaction.get(
        "SELECT * FROM f17_ai_work_turn_intents WHERE turn_id = ?",
        input.turnId,
      );
      if (row === undefined)
        throw repositoryError(
          this.store,
          "NOT_FOUND",
          "The F17 turn does not exist.",
        );
      const current = turnFromRow(row);
      if (current.status !== "RESERVED" && current.status !== "STARTED") return;
      transitionOrSame("turn", current.status, "PRESTART_REFUSED");
      const mutating = current.interactionMode === "worktree_write";
      const releaseReserved = current.status === "RESERVED";
      const releaseConsumed =
        mutating &&
        current.status === "STARTED" &&
        current.reservation === "CONSUMED";
      transaction.run(
        "UPDATE f17_ai_work_turn_intents SET status = 'PRESTART_REFUSED', reservation = 'RELEASED', completed_at = ?, version = version + 1 WHERE turn_id = ? AND status = 'RESERVED'",
        input.completedAt,
        input.turnId,
      );
      if (current.status === "STARTED")
        transaction.run(
          "UPDATE f17_ai_work_turn_intents SET status = 'PRESTART_REFUSED', reservation = 'RELEASED', completed_at = ?, version = version + 1 WHERE turn_id = ? AND status = 'STARTED'",
          input.completedAt,
          input.turnId,
        );
      if (mutating)
        transaction.run(
          "UPDATE f17_ai_work_operations SET consumed_turn_count = CASE WHEN ? = 1 AND consumed_turn_count > 0 THEN consumed_turn_count - 1 ELSE consumed_turn_count END, reserved_turn_count = CASE WHEN ? = 1 AND reserved_turn_count > 0 THEN reserved_turn_count - 1 ELSE reserved_turn_count END, version = version + 1, updated_at = ? WHERE operation_id = ?",
          releaseConsumed ? 1 : 0,
          releaseReserved ? 1 : 0,
          input.completedAt,
          current.operationId,
        );
    });
    const operation = this.getOperationByTurn(input.turnId);
    const turn =
      operation === undefined ? undefined : findTurn(operation, input.turnId);
    if (turn === undefined) throw new Error("F17_TURN_NOT_READABLE");
    return turn;
  }

  public finalizeTurn(input: {
    readonly turnId: string;
    readonly status: AIWorkTurnStatus;
    readonly report: AIWorkTurnReport;
    readonly operationStatus: AIWorkOperationStatus;
    readonly stopReason?: AIWorkStopReason;
  }): AIWorkOperationRecord {
    id(input.turnId, "F17 turn identifier");
    if (!aiWorkTurnReportSchema.safeParse(input.report).success)
      throw repositoryError(
        this.store,
        "INVALID_RECORD",
        "The F17 turn report is invalid.",
      );
    const timestamp = input.report.completedAt;
    this.store.transaction((transaction) => {
      const row = transaction.get(
        "SELECT * FROM f17_ai_work_turn_intents WHERE turn_id = ?",
        input.turnId,
      );
      if (row === undefined)
        throw repositoryError(
          this.store,
          "NOT_FOUND",
          "The F17 turn does not exist.",
        );
      const current = turnFromRow(row);
      if (
        input.report.turnId !== current.turnId ||
        input.report.operationId !== current.operationId ||
        input.report.segmentId !== current.segmentId
      )
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The F17 report identity does not match the committed turn intent.",
        );
      const existingReport = transaction.get(
        "SELECT report_hash FROM f17_ai_work_turn_reports WHERE turn_id = ?",
        input.turnId,
      );
      const encodedReport = encode(input.report);
      if (existingReport !== undefined) {
        if (
          rowString(existingReport, "report_hash") !== encodedReport.payloadHash
        )
          throw repositoryError(
            this.store,
            "CONFLICT",
            "A terminal F17 report cannot be rewritten.",
          );
        return;
      }
      if (
        ![
          "COMPLETED",
          "FAILED",
          "CANCELLED",
          "TIMED_OUT",
          "INTERRUPTED",
          "UNCERTAIN",
          "PRESTART_REFUSED",
        ].includes(input.status)
      )
        throw repositoryError(
          this.store,
          "INVALID_RECORD",
          "A F17 final report requires a terminal turn status.",
        );
      if (current.status === "STARTED")
        transitionOrSame("turn", current.status, input.status);
      else if (
        current.status !== input.status &&
        current.status !== "PRESTART_REFUSED"
      )
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The F17 turn is already terminal or was not started.",
        );
      const encodedProgress =
        input.report.progress === undefined
          ? undefined
          : encode(input.report.progress);
      const encodedUsage = encode(input.report.usage);
      transaction.run(
        "UPDATE f17_ai_work_turn_intents SET status = ?, completed_at = ?, version = version + 1 WHERE turn_id = ?",
        input.status,
        timestamp,
        input.turnId,
      );
      transaction.run(
        "INSERT INTO f17_ai_work_turn_reports (turn_id, report_json, report_hash, progress_json, usage_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        input.turnId,
        encodedReport.payload,
        encodedReport.payloadHash,
        encodedProgress?.payload ?? null,
        encodedUsage.payload,
        timestamp,
        timestamp,
      );
      if (input.report.progress !== undefined) {
        const progress = input.report.progress as AIProgressEvaluation;
        const encodedFingerprint = encode(progress);
        transaction.run(
          "INSERT OR IGNORE INTO f17_ai_work_fingerprints (fingerprint_id, operation_id, turn_id, fingerprint, classification, complete, material_progress, payload_json, payload_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          `${current.operationId}:${input.turnId}`,
          current.operationId,
          input.turnId,
          progress.fingerprint,
          progress.classification,
          progress.complete ? 1 : 0,
          progress.materialProgress ? 1 : 0,
          encodedFingerprint.payload,
          encodedFingerprint.payloadHash,
          timestamp,
        );
      }
      const operationRow = transaction.get(
        "SELECT * FROM f17_ai_work_operations WHERE operation_id = ?",
        current.operationId,
      );
      if (operationRow === undefined)
        throw repositoryError(
          this.store,
          "NOT_FOUND",
          "The F17 operation does not exist.",
        );
      const envelope = parsedOperationEnvelope(
        readPayload(operationRow, "payload_json", "payload_hash"),
      );
      const updatedEnvelope: OperationEnvelope = {
        input: envelope.input,
        ...(input.stopReason === undefined
          ? {}
          : { stopReason: input.stopReason }),
      };
      const encodedOperation = encode(updatedEnvelope);
      const nextHistoryRevision =
        rowNumber(operationRow, "history_revision") + 1;
      transaction.run(
        "UPDATE f17_ai_work_operations SET status = ?, history_revision = ?, version = version + 1, payload_json = ?, payload_hash = ?, updated_at = ? WHERE operation_id = ?",
        input.operationStatus,
        nextHistoryRevision,
        encodedOperation.payload,
        encodedOperation.payloadHash,
        timestamp,
        current.operationId,
      );
      const segmentStatus =
        input.operationStatus === "WORKING"
          ? "WORKING"
          : input.operationStatus === "COMPLETED"
            ? "COMPLETED"
            : input.operationStatus === "UNCERTAIN" ||
                input.status === "UNCERTAIN"
              ? "UNCERTAIN"
              : "STOPPED";
      transaction.run(
        "UPDATE f17_ai_work_segments SET status = ?, version = version + 1, updated_at = ? WHERE segment_id = ?",
        segmentStatus,
        timestamp,
        current.segmentId,
      );
    });
    const operation = this.getOperationByTurn(input.turnId);
    if (operation === undefined) throw new Error("F17_OPERATION_NOT_READABLE");
    return operation;
  }

  public setOperationStatus(input: {
    readonly operationId: string;
    readonly status: AIWorkOperationStatus;
    readonly stopReason?: AIWorkStopReason;
  }): AIWorkOperationRecord {
    id(input.operationId, "F17 operation identifier");
    this.store.transaction((transaction) => {
      const row = transaction.get(
        "SELECT * FROM f17_ai_work_operations WHERE operation_id = ?",
        input.operationId,
      );
      if (row === undefined)
        throw repositoryError(
          this.store,
          "NOT_FOUND",
          "The F17 operation does not exist.",
        );
      const current = rowString(row, "status");
      transitionOrSame("operation", current, input.status);
      const envelope = parsedOperationEnvelope(
        readPayload(row, "payload_json", "payload_hash"),
      );
      const updated: OperationEnvelope = {
        input: envelope.input,
        ...(input.stopReason === undefined
          ? {}
          : { stopReason: input.stopReason }),
      };
      const encoded = encode(updated);
      transaction.run(
        "UPDATE f17_ai_work_operations SET status = ?, version = version + 1, payload_json = ?, payload_hash = ?, updated_at = ? WHERE operation_id = ?",
        input.status,
        encoded.payload,
        encoded.payloadHash,
        now(this.clock),
        input.operationId,
      );
      if (input.status === "EXHAUSTED") {
        for (const segment of transaction.all(
          "SELECT segment_id, status FROM f17_ai_work_segments WHERE operation_id = ?",
          input.operationId,
        )) {
          const segmentStatus = rowString(segment, "status");
          if (segmentStatus === "WORKING") {
            transitionOrSame("segment", segmentStatus, "STOPPED");
            transaction.run(
              "UPDATE f17_ai_work_segments SET status = 'STOPPED', version = version + 1, updated_at = ? WHERE segment_id = ?",
              now(this.clock),
              rowString(segment, "segment_id"),
            );
          }
        }
      }
    });
    const operation = this.getOperation(input.operationId);
    if (operation === undefined) throw new Error("F17_OPERATION_NOT_READABLE");
    return operation;
  }

  public saveContinuation(input: AIWorkContinuation): AIWorkContinuation {
    const parsed = aiWorkContinuationSchema.safeParse(input);
    if (!parsed.success)
      throw repositoryError(
        this.store,
        "INVALID_RECORD",
        "The F17 continuation confirmation is invalid.",
      );
    const encoded = encode(parsed.data);
    this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT payload_json, payload_hash FROM f17_ai_work_confirmations WHERE confirmation_id = ?",
        parsed.data.confirmationId,
      );
      if (existing !== undefined) {
        if (rowString(existing, "payload_hash") !== encoded.payloadHash)
          throw repositoryError(
            this.store,
            "CONFLICT",
            "The F17 continuation confirmation identity is already used.",
          );
        return;
      }
      transaction.run(
        "INSERT INTO f17_ai_work_confirmations (confirmation_id, operation_id, kind, displayed_history_revision, selected_budget, confirmed, status, snapshot_id, version, payload_json, payload_hash, created_at, confirmed_at, consumed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)",
        parsed.data.confirmationId,
        parsed.data.operationId,
        parsed.data.kind,
        parsed.data.displayedHistoryRevision,
        parsed.data.selectedBudget,
        parsed.data.confirmed ? 1 : 0,
        parsed.data.status,
        parsed.data.snapshotId ?? null,
        encoded.payload,
        encoded.payloadHash,
        parsed.data.createdAt,
        parsed.data.confirmedAt ?? null,
        parsed.data.consumedAt ?? null,
      );
    });
    const row = this.store.read(
      "SELECT payload_json, payload_hash FROM f17_ai_work_confirmations WHERE confirmation_id = ?",
      parsed.data.confirmationId,
    );
    if (row === undefined) throw new Error("F17_CONTINUATION_NOT_READABLE");
    return aiWorkContinuationSchema.parse(
      readPayload(row, "payload_json", "payload_hash"),
    );
  }

  public createContinuation(input: {
    readonly confirmation: AIWorkContinuation;
    readonly segmentId: string;
    readonly turnId: string;
    readonly deadlineAt: string;
    readonly taskSnapshot: F16EffectiveAITaskSnapshot;
  }): AIWorkAdmission {
    const confirmation = aiWorkContinuationSchema.parse(input.confirmation);
    if (
      !confirmation.confirmed ||
      confirmation.status !== "PENDING" ||
      confirmation.kind === "START_NEW_OPERATION"
    )
      throw repositoryError(
        this.store,
        "CONFLICT",
        "Continuation requires one unused explicit confirmation.",
      );
    const confirmationRow = this.store.read(
      "SELECT status FROM f17_ai_work_confirmations WHERE confirmation_id = ?",
      confirmation.confirmationId,
    );
    if (
      confirmationRow !== undefined &&
      rowString(confirmationRow, "status") === "CONSUMED"
    ) {
      const operation = this.getOperation(confirmation.operationId);
      const existingSegment = operation?.segments.find((segment) => {
        const segmentRow = this.store.read(
          "SELECT payload_json, payload_hash FROM f17_ai_work_segments WHERE segment_id = ?",
          segment.segmentId,
        );
        if (segmentRow === undefined) return false;
        return (
          parsedSegmentEnvelope(
            readPayload(segmentRow, "payload_json", "payload_hash"),
          ).continuationConfirmationId === confirmation.confirmationId
        );
      });
      const existingTurn = existingSegment?.turns[0];
      if (
        operation !== undefined &&
        existingSegment !== undefined &&
        existingTurn !== undefined
      )
        return { inserted: false, operation, turn: existingTurn };
    }
    return this.createContinuationInternal(input, confirmation);
  }

  private createContinuationInternal(
    input: {
      readonly confirmation: AIWorkContinuation;
      readonly segmentId: string;
      readonly turnId: string;
      readonly deadlineAt: string;
      readonly taskSnapshot: F16EffectiveAITaskSnapshot;
    },
    confirmation: AIWorkContinuation,
  ): AIWorkAdmission {
    const timestamp = now(this.clock);
    this.store.transaction((transaction) => {
      const operation = transaction.get(
        "SELECT * FROM f17_ai_work_operations WHERE operation_id = ?",
        confirmation.operationId,
      );
      const confirmationRow = transaction.get(
        "SELECT * FROM f17_ai_work_confirmations WHERE confirmation_id = ?",
        confirmation.confirmationId,
      );
      if (operation === undefined || confirmationRow === undefined)
        throw repositoryError(
          this.store,
          "NOT_FOUND",
          "The F17 continuation record does not exist.",
        );
      if (
        rowString(confirmationRow, "status") !== "PENDING" ||
        rowNumber(confirmationRow, "confirmed") !== 1
      )
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The F17 continuation confirmation was already consumed or cancelled.",
        );
      if (
        rowNumber(operation, "history_revision") !==
        confirmation.displayedHistoryRevision
      )
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The displayed F17 history is stale.",
        );
      if (rowString(operation, "status") !== "NEEDS_ATTENTION")
        throw repositoryError(
          this.store,
          "CONFLICT",
          "Continuation requires a stopped F17 operation.",
        );
      const remaining =
        rowNumber(operation, "configured_turn_budget") -
        rowNumber(operation, "consumed_turn_count") -
        rowNumber(operation, "reserved_turn_count");
      if (remaining <= 0 || confirmation.selectedBudget > remaining)
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The F17 parent has no remaining continuation budget.",
        );
      const envelope = parsedOperationEnvelope(
        readPayload(operation, "payload_json", "payload_hash"),
      );
      const segmentCount = transaction.get(
        "SELECT COALESCE(MAX(segment_index), -1) AS segment_index FROM f17_ai_work_segments WHERE operation_id = ?",
        confirmation.operationId,
      );
      const segmentIndex =
        rowNumber(segmentCount ?? { segment_index: -1 }, "segment_index") + 1;
      const segmentEnvelope: SegmentEnvelope = {
        taskSnapshot: input.taskSnapshot,
        timeoutMs: envelope.input.timeoutMs ?? AI_WORK_DEFAULT_TIMEOUT_MS,
        continuationConfirmationId: confirmation.confirmationId,
      };
      const turnEnvelope: TurnEnvelope = {
        snapshotId: input.taskSnapshot.snapshotId,
        snapshotHash: input.taskSnapshot.snapshotHash,
        predicateId: envelope.input.predicate.id,
        predicateVersion: envelope.input.predicate.version,
      };
      const encodedSegment = encode(segmentEnvelope);
      const encodedTurn = encode(turnEnvelope);
      const encodedConfirmation = encode({
        ...confirmation,
        status: "CONSUMED",
        consumedAt: timestamp,
      });
      const resumedOperation = encode({
        input: envelope.input,
      } satisfies OperationEnvelope);
      const interactionMode = envelope.input.interactionMode;
      const mutating = interactionMode === "worktree_write";
      transitionOrSame("operation", rowString(operation, "status"), "WORKING");
      transaction.run(
        "UPDATE f17_ai_work_confirmations SET status = 'CONSUMED', version = version + 1, payload_json = ?, payload_hash = ?, consumed_at = ? WHERE confirmation_id = ? AND status = 'PENDING'",
        encodedConfirmation.payload,
        encodedConfirmation.payloadHash,
        timestamp,
        confirmation.confirmationId,
      );
      transaction.run(
        "INSERT INTO f17_ai_work_segments (segment_id, operation_id, segment_index, status, interaction_mode, turn_budget, consumed_turn_baseline, version, payload_json, payload_hash, created_at, updated_at) VALUES (?, ?, ?, 'WORKING', ?, ?, ?, 1, ?, ?, ?, ?)",
        input.segmentId,
        confirmation.operationId,
        segmentIndex,
        interactionMode,
        confirmation.selectedBudget,
        rowNumber(operation, "consumed_turn_count"),
        encodedSegment.payload,
        encodedSegment.payloadHash,
        timestamp,
        timestamp,
      );
      transaction.run(
        "INSERT INTO f17_ai_work_turn_intents (turn_id, operation_id, segment_id, sequence, interaction_mode, status, reservation, timeout_ms, deadline_at, version, payload_json, payload_hash, created_at) VALUES (?, ?, ?, 0, ?, 'RESERVED', ?, ?, ?, 1, ?, ?, ?)",
        input.turnId,
        confirmation.operationId,
        input.segmentId,
        interactionMode,
        mutating ? "RESERVED" : "NONE",
        envelope.input.timeoutMs ?? AI_WORK_DEFAULT_TIMEOUT_MS,
        input.deadlineAt,
        encodedTurn.payload,
        encodedTurn.payloadHash,
        timestamp,
      );
      transaction.run(
        "UPDATE f17_ai_work_operations SET status = 'WORKING', reserved_turn_count = reserved_turn_count + ?, version = version + 1, payload_json = ?, payload_hash = ?, updated_at = ? WHERE operation_id = ?",
        mutating ? 1 : 0,
        resumedOperation.payload,
        resumedOperation.payloadHash,
        timestamp,
        confirmation.operationId,
      );
    });
    const operation = this.getOperation(confirmation.operationId);
    if (operation === undefined) throw new Error("F17_OPERATION_NOT_READABLE");
    const turn = findTurn(operation, input.turnId);
    if (turn === undefined) throw new Error("F17_TURN_NOT_READABLE");
    return { inserted: true, operation, turn };
  }

  public createNewOperation(input: {
    readonly priorOperationId: string;
    readonly confirmation: AIWorkContinuation;
    readonly operation: AIWorkOperationInput;
    readonly segmentId: string;
    readonly turnId: string;
    readonly deadlineAt: string;
  }): AIWorkAdmission {
    const confirmation = aiWorkContinuationSchema.parse(input.confirmation);
    const parsed = aiWorkOperationInputSchema.parse(input.operation);
    if (
      !confirmation.confirmed ||
      confirmation.status !== "PENDING" ||
      confirmation.kind !== "START_NEW_OPERATION" ||
      confirmation.operationId !== input.priorOperationId ||
      parsed.parentOperationId !== input.priorOperationId
    )
      throw repositoryError(
        this.store,
        "CONFLICT",
        "The new F17 operation is missing a valid explicit confirmation.",
      );
    const parent = this.getOperation(input.priorOperationId);
    if (parent === undefined)
      throw repositoryError(
        this.store,
        "NOT_FOUND",
        "The prior F17 operation does not exist.",
      );
    if (parent.remainingTurnCount > 0)
      throw repositoryError(
        this.store,
        "CONFLICT",
        "A new F17 parent is only required after budget exhaustion.",
      );
    const timestamp = now(this.clock);
    const operation = operationInputWithDefaults(
      parsed,
      parsed.configuredTurnBudget ?? AI_WORK_DEFAULT_TURN_BUDGET,
    );
    const encodedOperation = encode({
      input: operation,
    } satisfies OperationEnvelope);
    const segmentEnvelope: SegmentEnvelope = {
      taskSnapshot: operation.taskSnapshot,
      timeoutMs: operation.timeoutMs ?? AI_WORK_DEFAULT_TIMEOUT_MS,
    };
    const encodedSegment = encode(segmentEnvelope);
    const encodedTurn = encode({
      snapshotId: operation.taskSnapshot.snapshotId,
      snapshotHash: operation.taskSnapshot.snapshotHash,
      predicateId: operation.predicate.id,
      predicateVersion: operation.predicate.version,
    } satisfies TurnEnvelope);
    const encodedConfirmation = encode({
      ...confirmation,
      status: "CONSUMED",
      consumedAt: timestamp,
    });
    let inserted = false;
    let existingOperationId: string | undefined;
    this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT operation_id FROM f17_ai_work_operations WHERE operation_id = ? OR idempotency_key = ?",
        operation.operationId,
        operation.idempotencyKey ?? "",
      );
      if (existing !== undefined) {
        existingOperationId = rowString(existing, "operation_id");
        return;
      }
      inserted = true;
      const confirmationRow = transaction.get(
        "SELECT status, confirmed, displayed_history_revision FROM f17_ai_work_confirmations WHERE confirmation_id = ?",
        confirmation.confirmationId,
      );
      if (
        confirmationRow === undefined ||
        rowString(confirmationRow, "status") !== "PENDING" ||
        rowNumber(confirmationRow, "confirmed") !== 1 ||
        rowNumber(confirmationRow, "displayed_history_revision") !==
          parent.historyRevision
      )
        throw repositoryError(
          this.store,
          "CONFLICT",
          "The new F17 operation confirmation is stale or already used.",
        );
      transaction.run(
        "UPDATE f17_ai_work_confirmations SET status = 'CONSUMED', version = version + 1, payload_json = ?, payload_hash = ?, consumed_at = ? WHERE confirmation_id = ? AND status = 'PENDING'",
        encodedConfirmation.payload,
        encodedConfirmation.payloadHash,
        timestamp,
        confirmation.confirmationId,
      );
      transaction.run(
        "INSERT INTO f17_ai_work_operations (operation_id, parent_operation_id, operation_kind, task_type, status, configured_turn_budget, consumed_turn_count, reserved_turn_count, history_revision, version, idempotency_key, payload_json, payload_hash, created_at, updated_at) VALUES (?, ?, ?, ?, 'WORKING', ?, 0, ?, 0, 1, ?, ?, ?, ?, ?)",
        operation.operationId,
        input.priorOperationId,
        operation.operationKind,
        operation.taskType,
        operation.configuredTurnBudget,
        operation.interactionMode === "worktree_write" ? 1 : 0,
        operation.idempotencyKey ?? null,
        encodedOperation.payload,
        encodedOperation.payloadHash,
        timestamp,
        timestamp,
      );
      transaction.run(
        "INSERT INTO f17_ai_work_segments (segment_id, operation_id, segment_index, status, interaction_mode, turn_budget, consumed_turn_baseline, version, payload_json, payload_hash, created_at, updated_at) VALUES (?, ?, 0, 'WORKING', ?, ?, 0, 1, ?, ?, ?, ?)",
        input.segmentId,
        operation.operationId,
        operation.interactionMode,
        operation.configuredTurnBudget,
        encodedSegment.payload,
        encodedSegment.payloadHash,
        timestamp,
        timestamp,
      );
      transaction.run(
        "INSERT INTO f17_ai_work_turn_intents (turn_id, operation_id, segment_id, sequence, interaction_mode, status, reservation, timeout_ms, deadline_at, version, payload_json, payload_hash, created_at) VALUES (?, ?, ?, 0, ?, 'RESERVED', ?, ?, ?, 1, ?, ?, ?)",
        input.turnId,
        operation.operationId,
        input.segmentId,
        operation.interactionMode,
        operation.interactionMode === "worktree_write" ? "RESERVED" : "NONE",
        operation.timeoutMs ?? AI_WORK_DEFAULT_TIMEOUT_MS,
        input.deadlineAt,
        encodedTurn.payload,
        encodedTurn.payloadHash,
        timestamp,
      );
    });
    const operationRecord = this.getOperation(
      existingOperationId ?? operation.operationId,
    );
    if (operationRecord === undefined)
      throw new Error("F17_OPERATION_NOT_READABLE");
    const turn =
      findTurn(operationRecord, input.turnId) ??
      operationRecord.segments.flatMap((segment) => segment.turns).at(-1);
    if (turn === undefined) throw new Error("F17_TURN_NOT_READABLE");
    return { inserted, operation: operationRecord, turn };
  }

  public getOperation(operationId: string): AIWorkOperationRecord | undefined {
    id(operationId, "F17 operation identifier");
    return this.store.transaction(
      (transaction) => this.readOperation(transaction, operationId),
      { maxAttempts: 1 },
    );
  }

  public listInFlightTurns(): readonly AIWorkTurnIntent[] {
    const rows = this.store.readAll(
      "SELECT DISTINCT operation_id FROM f17_ai_work_turn_intents WHERE status IN ('RESERVED', 'STARTED') ORDER BY operation_id",
    );
    const result: AIWorkTurnIntent[] = [];
    for (const row of rows) {
      const operation = this.getOperation(rowString(row, "operation_id"));
      if (operation === undefined) continue;
      for (const segment of operation.segments)
        for (const turn of segment.turns)
          if (turn.status === "RESERVED" || turn.status === "STARTED")
            result.push(turn);
    }
    return result;
  }

  public reconcileTurn(input: {
    readonly reconciliation: AIWorkReconciliation;
    readonly status: AIWorkTurnStatus;
    readonly operationStatus: AIWorkOperationStatus;
    readonly stopReason: AIWorkStopReason;
  }): AIWorkOperationRecord {
    id(input.reconciliation.reconciliationId, "F17 reconciliation identifier");
    id(input.reconciliation.turnId, "F17 turn identifier");
    this.store.transaction((transaction) => {
      const row = transaction.get(
        "SELECT * FROM f17_ai_work_turn_intents WHERE turn_id = ?",
        input.reconciliation.turnId,
      );
      if (row === undefined)
        throw repositoryError(
          this.store,
          "NOT_FOUND",
          "The F17 turn does not exist.",
        );
      const current = turnFromRow(row);
      if (
        [
          "COMPLETED",
          "FAILED",
          "CANCELLED",
          "TIMED_OUT",
          "PRESTART_REFUSED",
          "INTERRUPTED",
          "UNCERTAIN",
        ].includes(current.status)
      )
        return;
      const operation = transaction.get(
        "SELECT * FROM f17_ai_work_operations WHERE operation_id = ?",
        current.operationId,
      );
      if (operation === undefined)
        throw repositoryError(
          this.store,
          "NOT_FOUND",
          "The F17 operation does not exist.",
        );
      const envelope = parsedOperationEnvelope(
        readPayload(operation, "payload_json", "payload_hash"),
      );
      const updatedEnvelope: OperationEnvelope = {
        input: envelope.input,
        stopReason: input.stopReason,
      };
      const encodedReason = encode(updatedEnvelope);
      const shouldConsume =
        current.interactionMode === "worktree_write" &&
        current.reservation !== "CONSUMED";
      const shouldReleaseReservation = current.reservation === "RESERVED";
      if (current.status !== input.status)
        transitionOrSame("turn", current.status, input.status);
      transaction.run(
        "UPDATE f17_ai_work_turn_intents SET status = ?, reservation = ?, completed_at = ?, version = version + 1 WHERE turn_id = ?",
        input.status,
        shouldConsume ? "UNCERTAIN" : current.reservation,
        input.reconciliation.createdAt,
        input.reconciliation.turnId,
      );
      transaction.run(
        "INSERT OR IGNORE INTO f17_ai_work_reconciliations (reconciliation_id, operation_id, turn_id, outcome, payload_json, payload_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        input.reconciliation.reconciliationId,
        current.operationId,
        current.turnId,
        input.reconciliation.outcome,
        encode(input.reconciliation).payload,
        encode(input.reconciliation).payloadHash,
        input.reconciliation.createdAt,
      );
      transaction.run(
        "UPDATE f17_ai_work_operations SET status = ?, consumed_turn_count = consumed_turn_count + ?, reserved_turn_count = CASE WHEN ? = 1 AND reserved_turn_count > 0 THEN reserved_turn_count - 1 ELSE reserved_turn_count END, history_revision = history_revision + 1, version = version + 1, payload_json = ?, payload_hash = ?, updated_at = ? WHERE operation_id = ?",
        input.operationStatus,
        shouldConsume ? 1 : 0,
        shouldReleaseReservation ? 1 : 0,
        encodedReason.payload,
        encodedReason.payloadHash,
        input.reconciliation.createdAt,
        current.operationId,
      );
    });
    const operation = this.getOperationByTurn(input.reconciliation.turnId);
    if (operation === undefined) throw new Error("F17_OPERATION_NOT_READABLE");
    return operation;
  }

  private getOperationByTurn(
    turnId: string,
  ): AIWorkOperationRecord | undefined {
    const row = this.store.read(
      "SELECT operation_id FROM f17_ai_work_turn_intents WHERE turn_id = ?",
      turnId,
    );
    return row === undefined
      ? undefined
      : this.getOperation(rowString(row, "operation_id"));
  }

  private readOperation(
    transaction: PersistenceTransaction,
    operationId: string,
  ): AIWorkOperationRecord | undefined {
    const row = transaction.get(
      "SELECT * FROM f17_ai_work_operations WHERE operation_id = ?",
      operationId,
    );
    if (row === undefined) return undefined;
    const envelope = parsedOperationEnvelope(
      readPayload(row, "payload_json", "payload_hash"),
    );
    const segments = transaction
      .all(
        "SELECT * FROM f17_ai_work_segments WHERE operation_id = ? ORDER BY segment_index",
        operationId,
      )
      .map((segment) => {
        const immutable = parsedSegmentEnvelope(
          readPayload(segment, "payload_json", "payload_hash"),
        );
        const turns: AIWorkTurnIntent[] = transaction
          .all(
            "SELECT * FROM f17_ai_work_turn_intents WHERE segment_id = ? ORDER BY sequence",
            rowString(segment, "segment_id"),
          )
          .map(turnFromRow);
        const reports = transaction
          .all(
            "SELECT report_json, report_hash FROM f17_ai_work_turn_reports WHERE turn_id IN (SELECT turn_id FROM f17_ai_work_turn_intents WHERE segment_id = ?) ORDER BY created_at, turn_id",
            rowString(segment, "segment_id"),
          )
          .map((report) =>
            aiWorkTurnReportSchema.parse(
              readPayload(report, "report_json", "report_hash"),
            ),
          );
        const result: AIWorkSegmentRecord = aiWorkSegmentRecordSchema.parse({
          schemaVersion: 1,
          segmentId: rowString(segment, "segment_id"),
          operationId,
          index: rowNumber(segment, "segment_index"),
          status: rowString(segment, "status"),
          interactionMode: rowString(segment, "interaction_mode"),
          turnBudget: rowNumber(segment, "turn_budget"),
          consumedTurnBaseline: rowNumber(segment, "consumed_turn_baseline"),
          taskSnapshot: immutable.taskSnapshot,
          timeoutMs: immutable.timeoutMs,
          turns,
          reports,
          createdAt: rowString(segment, "created_at"),
          updatedAt: rowString(segment, "updated_at"),
          version: rowNumber(segment, "version"),
        });
        return result;
      });
    const configuredTurnBudget = rowNumber(row, "configured_turn_budget");
    const consumedTurnCount = rowNumber(row, "consumed_turn_count");
    const reservedTurnCount = rowNumber(row, "reserved_turn_count");
    const result = aiWorkOperationRecordSchema.parse({
      schemaVersion: 1,
      operationId,
      ...(rowOptionalString(row, "parent_operation_id") === undefined
        ? {}
        : { parentOperationId: rowOptionalString(row, "parent_operation_id") }),
      operationKind: envelope.input.operationKind,
      taskType: envelope.input.taskType,
      purpose: envelope.input.purpose,
      status: rowString(row, "status"),
      ...(envelope.input.worktree === undefined
        ? {}
        : { worktree: envelope.input.worktree }),
      taskSnapshot: envelope.input.taskSnapshot,
      predicate: envelope.input.predicate,
      configuredTurnBudget,
      consumedTurnCount,
      reservedTurnCount,
      remainingTurnCount: Math.max(
        0,
        configuredTurnBudget - consumedTurnCount - reservedTurnCount,
      ),
      cumulativeUsage: aggregateReports(segments),
      historyRevision: rowNumber(row, "history_revision"),
      ...(envelope.stopReason === undefined
        ? {}
        : { stopReason: envelope.stopReason }),
      segments,
      createdAt: rowString(row, "created_at"),
      updatedAt: rowString(row, "updated_at"),
      version: rowNumber(row, "version"),
    });
    return result;
  }
}

function findTurn(
  operation: AIWorkOperationRecord,
  turnId: string,
): AIWorkTurnIntent | undefined {
  for (const segment of operation.segments) {
    const turn = segment.turns.find((candidate) => candidate.turnId === turnId);
    if (turn !== undefined) return turn;
  }
  return undefined;
}

function aggregateReports(
  segments: readonly AIWorkSegmentRecord[],
): AIWorkOperationRecord["cumulativeUsage"] {
  const fields = [
    "inputTokens",
    "cachedInputTokens",
    "cacheWriteInputTokens",
    "outputTokens",
    "reasoningOutputTokens",
    "totalTokens",
  ] as const;
  const reports = segments.flatMap((segment) => segment.reports);
  const unavailable = new Set<string>();
  const output: Record<string, number> = {};
  for (const field of fields) {
    if (
      reports.length === 0 ||
      reports.some((report) => report.usage[field] === undefined)
    ) {
      unavailable.add(field);
      continue;
    }
    output[field] = reports.reduce(
      (sum, report) => sum + (report.usage[field] as number),
      0,
    );
  }
  return {
    ...(output as Partial<AIWorkOperationRecord["cumulativeUsage"]>),
    ...(unavailable.size === 0
      ? {}
      : {
          unavailableFields: [
            ...unavailable,
          ].sort() as AIWorkOperationRecord["cumulativeUsage"]["unavailableFields"],
        }),
  };
}
