import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import {
  activityEventCanonicalHashInput,
  activityEventView,
  ACTIVITY_RETENTION_MAX_AGE_DAYS,
  ACTIVITY_RETENTION_MAX_BYTES,
  ACTIVITY_RETENTION_MAX_EVENTS,
  ActivityContractError,
  normalizeActivityEvent,
  type ActivityEventInput,
  type ActivityEventRecord,
  type ActivityEventView,
  type ActivityQuery,
  type ActivityQuerySnapshot,
  type ActivityRetentionPolicy,
  type ActivityRetentionState,
  type ActivitySafeDetails,
  type ActivitySeverity,
} from "../shared/activity";
import { parseOpenTargetRecord, type OpenTarget } from "../shared/routing";
import { PersistenceError } from "./persistence/types";
import {
  ActivityRepository,
  type ActivityAppendResult,
  type ActivityRetentionResult,
} from "./persistence/activity-repository";
import type {
  PersistenceClock,
  PersistenceStore,
  PersistenceTransaction,
} from "./persistence";

export interface ActivityWriter {
  readonly append: (input: ActivityEventInput) => ActivityAppendResult;
  readonly appendInTransaction: (
    transaction: PersistenceTransaction,
    input: ActivityEventInput,
  ) => ActivityAppendResult;
}

export interface ActivityServiceOptions {
  readonly clock?: PersistenceClock;
}

export interface ActivityOperationContext {
  readonly correlationId: string;
  readonly operationId: string;
  readonly attemptId: string;
  readonly attemptNumber: number;
}

export interface ActivityOperationRecorder {
  readonly context: ActivityOperationContext;
  readonly append: (
    input: Omit<
      ActivityEventInput,
      "correlationId" | "operationId" | "attempt"
    > & { readonly eventId: string },
  ) => ActivityAppendResult;
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeCorrelationId(value: string | undefined): string {
  if (value !== undefined && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value))
    return value;
  return `activity-${randomUUID()}`;
}

function errorCode(error: unknown): string {
  if (error instanceof ActivityContractError) return error.code;
  if (error instanceof PersistenceError) return error.reason.code;
  return "ACTIVITY_UNAVAILABLE";
}

function appendHash(event: ActivityEventRecord): string {
  return hash(activityEventCanonicalHashInput(event));
}

export class ActivityService {
  private readonly clock: PersistenceClock;
  private readonly repository: ActivityRepository;
  private readonly listeners = new Set<(event: ActivityEventView) => void>();

  public constructor(
    store: PersistenceStore,
    options: ActivityServiceOptions = {},
  ) {
    this.clock = options.clock ?? { now: () => new Date().toISOString() };
    this.repository = new ActivityRepository(store, { clock: this.clock });
  }

  public readonly writer: ActivityWriter = {
    append: (input) => this.append(input),
    appendInTransaction: (transaction, input) =>
      this.appendInTransaction(transaction, input),
  };

  public append(input: ActivityEventInput): ActivityAppendResult {
    let event: ActivityEventRecord;
    try {
      event = normalizeActivityEvent(input, this.clock.now());
    } catch (error) {
      return { outcome: "rejected", reasonCode: errorCode(error) };
    }
    try {
      const result = this.repository.append(event, appendHash(event));
      if (result.event !== undefined && result.outcome === "inserted")
        this.notify(result.event);
      return result;
    } catch (error) {
      return {
        outcome: "unavailable",
        reasonCode: errorCode(error),
      };
    }
  }

  public appendInTransaction(
    transaction: PersistenceTransaction,
    input: ActivityEventInput,
  ): ActivityAppendResult {
    let event: ActivityEventRecord;
    try {
      event = normalizeActivityEvent(input, this.clock.now());
    } catch (error) {
      return { outcome: "rejected", reasonCode: errorCode(error) };
    }
    const result = this.repository.appendInTransaction(
      transaction,
      event,
      appendHash(event),
    );
    return result;
  }

  public query(input: ActivityQuery = {}): ActivityQuerySnapshot {
    return this.repository.query(input);
  }

  public get(eventId: string): ActivityEventRecord | undefined {
    return this.repository.get(eventId);
  }

  public relatedTarget(eventId: string): OpenTarget | undefined {
    const event = this.repository.get(eventId);
    if (event?.relatedTarget === undefined) return undefined;
    const parsed = parseOpenTargetRecord(event.relatedTarget);
    return parsed.ok ? parsed.value : undefined;
  }

  public retain(
    policy?: Partial<ActivityRetentionPolicy>,
  ): ActivityRetentionResult {
    const boundedPolicy: ActivityRetentionPolicy = {
      maxAgeDays: policy?.maxAgeDays ?? ACTIVITY_RETENTION_MAX_AGE_DAYS,
      maxEvents: policy?.maxEvents ?? ACTIVITY_RETENTION_MAX_EVENTS,
      maxBytes: policy?.maxBytes ?? ACTIVITY_RETENTION_MAX_BYTES,
    };
    try {
      return this.repository.retain(policy);
    } catch (error) {
      if (!(error instanceof PersistenceError)) throw error;
      return {
        status: "failed",
        deletedCount: 0,
        protectedCount: 0,
        policy: boundedPolicy,
        errorCode: errorCode(error),
      };
    }
  }

  public subscribe(listener: (event: ActivityEventView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public startOperation(input: {
    readonly correlationId?: string;
    readonly operationId?: string;
    readonly attemptId?: string;
    readonly attemptNumber?: number;
  }): ActivityOperationRecorder {
    const correlationId = safeCorrelationId(input.correlationId);
    const operationId = safeCorrelationId(input.operationId ?? correlationId);
    const attemptId = safeCorrelationId(
      input.attemptId ?? `${operationId}-attempt-1`,
    );
    const attemptNumber = input.attemptNumber ?? 1;
    const context: ActivityOperationContext = {
      correlationId,
      operationId,
      attemptId,
      attemptNumber,
    };
    return {
      context,
      append: (event) =>
        this.append({
          ...event,
          correlationId,
          operationId,
          attempt: {
            id: attemptId,
            number: attemptNumber,
          },
        }),
    };
  }

  public appendLegacy(input: {
    readonly activityEventId: string;
    readonly correlationId: string;
    readonly ownerType?: string;
    readonly ownerId?: string;
    readonly severity: string;
    readonly reasonCode: string;
    readonly payload?: ActivitySafeDetails;
    readonly managedPrId?: string;
    readonly retention?: ActivityRetentionState;
  }): ActivityAppendResult {
    const severity: ActivitySeverity = [
      "DEBUG",
      "INFO",
      "WARNING",
      "ERROR",
      "CRITICAL",
    ].includes(input.severity)
      ? (input.severity as ActivitySeverity)
      : "INFO";
    const reasonCode = input.reasonCode as ActivityEventInput["reason"]["code"];
    const result = this.append({
      eventId: input.activityEventId,
      eventType: "LEGACY_ACTIVITY",
      stage: "SYSTEM",
      correlationId: input.correlationId,
      ...(input.ownerType === undefined || input.ownerId === undefined
        ? {}
        : { owner: { type: input.ownerType, id: input.ownerId } }),
      ...(input.managedPrId === undefined
        ? {}
        : { managedPrId: input.managedPrId }),
      occurrenceAt: this.clock.now(),
      severity,
      reason: {
        code: reasonCode,
        what: "A background activity event was recorded.",
        why: "The owning operation retains the authoritative result separately.",
        nextAction: "NONE",
      },
      summary: input.reasonCode,
      details: input.payload ?? {},
      retention: input.retention ?? "NONE",
    });
    return result;
  }

  private notify(event: ActivityEventRecord): void {
    const view = activityEventView(event);
    for (const listener of this.listeners) {
      try {
        listener(view);
      } catch {
        // A diagnostic subscriber cannot change the committed activity result.
      }
    }
  }
}

export function activityReasonForLifecycle(reasonCode: string): {
  readonly what: string;
  readonly why: string;
  readonly nextAction: "NONE" | "RETRY" | "RECONCILE";
} {
  if (reasonCode.includes("FAILED") || reasonCode.includes("TIMEOUT"))
    return {
      what: "The application lifecycle encountered a failure.",
      why: "A lifecycle service did not complete its deterministic handoff.",
      nextAction: "RETRY",
    };
  if (reasonCode.includes("INCOMPLETE") || reasonCode.includes("RECOVERY"))
    return {
      what: "The application lifecycle needs recovery.",
      why: "The previous process did not finish its durable handoff.",
      nextAction: "RECONCILE",
    };
  return {
    what: "A lifecycle transition was recorded.",
    why: "The main process remains authoritative for application lifetime.",
    nextAction: "NONE",
  };
}
