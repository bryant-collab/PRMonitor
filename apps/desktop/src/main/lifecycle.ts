import { randomUUID } from "node:crypto";
import type { PersistenceRepositories } from "./persistence/repositories";
import { activityReasonForLifecycle, type ActivityWriter } from "./activity-service";
import type { IpcError, LifecyclePhase, LifecycleStatus } from "../shared/ipc";

export const LIFECYCLE_SETTING_KEY = "f04.lifecycle";
export const LIFECYCLE_SHUTDOWN_COMMAND = "Shutdown PRMonitor" as const;
export const DEFAULT_SERVICE_HANDOFF_TIMEOUT_MS = 5_000;

export interface LifecycleService {
  readonly name: string;
  readonly start?: () => Promise<void> | void;
  readonly stopAdmission?: () => Promise<void> | void;
  readonly handoff?: () => Promise<void> | void;
  readonly boundedStop?: () => Promise<void> | void;
}

export interface LifecyclePersistence {
  readonly read: () => LifecycleStatus | undefined;
  readonly write: (status: LifecycleStatus, reasonCode: string) => void;
}

export interface LifecycleOptions {
  readonly persistence: LifecyclePersistence;
  readonly services?: readonly LifecycleService[];
  readonly now?: () => string;
  readonly sessionId?: string;
  readonly handoffTimeoutMs?: number;
}

export interface LifecycleResult {
  readonly ok: boolean;
  readonly status: LifecycleStatus;
  readonly error?: IpcError;
}

function safeId(value: string | undefined, fallback: string): string {
  return value !== undefined &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
    ? value
    : fallback;
}

function phaseAfterStartup(previous: LifecycleStatus | undefined): {
  phase: LifecyclePhase;
  incompleteHandoff: boolean;
  reasonCode?: string;
} {
  if (
    previous?.phase === "SHUTDOWN_REQUESTED" ||
    previous?.phase === "HANDING_OFF" ||
    previous?.phase === "RECOVERY_REQUIRED"
  ) {
    return {
      phase: "RECOVERY_REQUIRED",
      incompleteHandoff: true,
      reasonCode: "INCOMPLETE_LIFECYCLE_HANDOFF",
    };
  }
  return { phase: "STARTING", incompleteHandoff: false };
}

async function withTimeout(
  work: Promise<void>,
  timeoutMs: number,
): Promise<"completed" | "timed-out"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("LIFECYCLE_HANDOFF_TIMEOUT")),
          timeoutMs,
        );
      }),
    ]);
    return "completed";
  } catch (error) {
    if (error instanceof Error && error.message === "LIFECYCLE_HANDOFF_TIMEOUT")
      return "timed-out";
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export class LifecycleCoordinator {
  private readonly services: readonly LifecycleService[];
  private readonly now: () => string;
  private readonly sessionId: string;
  private readonly handoffTimeoutMs: number;
  private status: LifecycleStatus;
  private shutdownWork: Promise<LifecycleResult> | undefined;

  public constructor(private readonly options: LifecycleOptions) {
    this.services = options.services ?? [];
    this.now = options.now ?? (() => new Date().toISOString());
    this.sessionId = safeId(options.sessionId, `session-${randomUUID()}`);
    this.handoffTimeoutMs = Math.max(
      100,
      Math.min(
        options.handoffTimeoutMs ?? DEFAULT_SERVICE_HANDOFF_TIMEOUT_MS,
        60_000,
      ),
    );
    const previous = options.persistence.read();
    const startup = phaseAfterStartup(previous);
    const timestamp = this.now();
    this.status = {
      schemaVersion: 1,
      phase: startup.phase,
      sessionId: this.sessionId,
      correlationId: `lifecycle-${randomUUID()}`,
      startedAt: timestamp,
      updatedAt: timestamp,
      ...(startup.reasonCode === undefined
        ? {}
        : { reasonCode: startup.reasonCode }),
      incompleteHandoff: startup.incompleteHandoff,
    };
  }

  public getStatus(): LifecycleStatus {
    return { ...this.status };
  }

  public async start(): Promise<LifecycleResult> {
    if (this.status.phase === "RECOVERY_REQUIRED") {
      this.persist("INCOMPLETE_LIFECYCLE_HANDOFF");
      return {
        ok: false,
        status: this.getStatus(),
        error: this.error(
          "HANDOFF_RECOVERY_REQUIRED",
          "A prior lifecycle handoff requires reconciliation before new work starts.",
          "RECONCILE",
        ),
      };
    }
    this.persist("LIFECYCLE_STARTING");
    try {
      for (const service of this.services) await service.start?.();
      this.update({
        phase: "RUNNING",
        incompleteHandoff: false,
        reasonCode: undefined,
      });
      this.persist("LIFECYCLE_RUNNING");
      return { ok: true, status: this.getStatus() };
    } catch {
      this.update({
        phase: "RECOVERY_REQUIRED",
        incompleteHandoff: true,
        reasonCode: "SERVICE_START_FAILED",
      });
      this.persist("SERVICE_START_FAILED");
      return {
        ok: false,
        status: this.getStatus(),
        error: this.error(
          "SERVICE_START_FAILED",
          "A main-process service could not start safely.",
          "RETRY",
        ),
      };
    }
  }

  public requestShutdown(): Promise<LifecycleResult> {
    if (this.shutdownWork !== undefined) return this.shutdownWork;
    if (this.status.phase === "STOPPED")
      return Promise.resolve({ ok: true, status: this.getStatus() });
    this.shutdownWork = this.performShutdown();
    return this.shutdownWork;
  }

  private async performShutdown(): Promise<LifecycleResult> {
    const correlationId = `shutdown-${randomUUID()}`;
    this.update({
      phase: "SHUTDOWN_REQUESTED",
      correlationId,
      shutdownCommand: LIFECYCLE_SHUTDOWN_COMMAND,
      incompleteHandoff: true,
      reasonCode: "SHUTDOWN_REQUESTED",
    });
    this.persist("SHUTDOWN_INTENT_COMMITTED");

    let failedService: string | undefined;
    let failureCode:
      | "SERVICE_STOP_FAILED"
      | "SERVICE_STOP_TIMEOUT"
      | "SERVICE_HANDOFF_TIMEOUT"
      | undefined;
    try {
      for (const service of this.services) {
        failedService = service.name;
        const outcome = await withTimeout(
          Promise.resolve(service.stopAdmission?.()),
          this.handoffTimeoutMs,
        );
        if (outcome === "timed-out") {
          failureCode = "SERVICE_STOP_TIMEOUT";
          throw new Error("LIFECYCLE_STOP_TIMEOUT");
        }
      }
      this.update({
        phase: "HANDING_OFF",
        reasonCode: "SERVICE_HANDOFF_STARTED",
      });
      this.persist("SERVICE_HANDOFF_STARTED");
      for (const service of this.services) {
        failedService = service.name;
        const outcome = await withTimeout(
          Promise.resolve(service.handoff?.()),
          this.handoffTimeoutMs,
        );
        if (outcome === "timed-out") {
          failureCode = "SERVICE_HANDOFF_TIMEOUT";
          throw new Error("LIFECYCLE_HANDOFF_TIMEOUT");
        }
        const stopOutcome = await withTimeout(
          Promise.resolve(service.boundedStop?.()),
          this.handoffTimeoutMs,
        );
        if (stopOutcome === "timed-out") {
          failureCode = "SERVICE_STOP_TIMEOUT";
          throw new Error("LIFECYCLE_STOP_TIMEOUT");
        }
      }
    } catch (error) {
      failureCode ??=
        error instanceof Error && error.message === "LIFECYCLE_HANDOFF_TIMEOUT"
          ? "SERVICE_HANDOFF_TIMEOUT"
          : "SERVICE_STOP_FAILED";
      this.update({
        phase: "RECOVERY_REQUIRED",
        reasonCode: failureCode,
        incompleteHandoff: true,
      });
      this.persist(failureCode);
      return {
        ok: false,
        status: this.getStatus(),
        error: this.error(
          failureCode,
          failedService === undefined
            ? "Shutdown requires lifecycle recovery."
            : `Shutdown requires lifecycle recovery for service ${failedService}.`,
          "RECONCILE",
        ),
      };
    }

    this.update({
      phase: "STOPPED",
      reasonCode: "SHUTDOWN_COMPLETE",
      incompleteHandoff: false,
    });
    this.persist("SHUTDOWN_COMPLETE");
    return { ok: true, status: this.getStatus() };
  }

  private update(
    update: Partial<
      Pick<
        LifecycleStatus,
        "phase" | "correlationId" | "reasonCode" | "incompleteHandoff"
      >
    > &
      Partial<Pick<LifecycleStatus, "shutdownCommand">>,
  ): void {
    const next = {
      ...this.status,
      ...update,
      updatedAt: this.now(),
    };
    if (
      Object.prototype.hasOwnProperty.call(update, "reasonCode") &&
      update.reasonCode === undefined
    ) {
      const { reasonCode: _reasonCode, ...withoutReason } = next;
      this.status = withoutReason;
      return;
    }
    this.status = next;
  }

  private persist(reasonCode: string): void {
    this.options.persistence.write(this.getStatus(), reasonCode);
  }

  private error(
    code: string,
    message: string,
    _nextAction: "RETRY" | "RECONCILE",
  ): IpcError {
    return {
      code: code as IpcError["code"],
      message,
      correlationId: this.status.correlationId,
    };
  }
}

export function createPersistenceLifecyclePersistence(
  repositories: PersistenceRepositories,
  activityWriter?: ActivityWriter,
): LifecyclePersistence {
  return {
    read: () => {
      const record = repositories.getSetting<LifecycleStatus>(
        LIFECYCLE_SETTING_KEY,
      );
      return record?.payload;
    },
    write: (status, reasonCode) => {
      repositories.putSetting(LIFECYCLE_SETTING_KEY, status);
      if (activityWriter === undefined) {
        repositories.appendActivityEvent({
          activityEventId: `${status.correlationId}:${reasonCode}`,
          correlationId: status.correlationId,
          ownerType: "APPLICATION_LIFECYCLE",
          ownerId: status.sessionId,
          severity: status.phase === "RECOVERY_REQUIRED" ? "ERROR" : "INFO",
          reasonCode,
          payload: {
            phase: status.phase,
            incompleteHandoff: status.incompleteHandoff,
          },
        });
        return;
      }
      const reason = activityReasonForLifecycle(reasonCode);
      const outcome = activityWriter.append({
        eventId: `${status.correlationId}:${reasonCode}`,
        eventType:
          status.phase === "RECOVERY_REQUIRED"
            ? "LIFECYCLE_FAILED"
            : status.phase === "STOPPED"
              ? "LIFECYCLE_COMPLETED"
              : "LIFECYCLE_STARTED",
        stage: "LIFECYCLE",
        correlationId: status.correlationId,
        operationId: status.sessionId,
        owner: { type: "APPLICATION_LIFECYCLE", id: status.sessionId },
        occurrenceAt: status.updatedAt,
        severity: status.phase === "RECOVERY_REQUIRED" ? "ERROR" : "INFO",
        reason: {
          code: reasonCode as Parameters<ActivityWriter["append"]>[0]["reason"]["code"],
          ...reason,
        },
        summary: reasonCode,
        details: {
          phase: status.phase,
          incompleteHandoff: status.incompleteHandoff,
        },
      });
      if (outcome.outcome === "rejected") {
        // The legacy repository record is a safe compatibility fallback for a
        // producer reason that predates the F09 catalog. It never controls
        // lifecycle state or authorizes work.
        repositories.appendActivityEvent({
          activityEventId: `${status.correlationId}:${reasonCode}:legacy`,
          correlationId: status.correlationId,
          ownerType: "APPLICATION_LIFECYCLE",
          ownerId: status.sessionId,
          severity: status.phase === "RECOVERY_REQUIRED" ? "ERROR" : "INFO",
          reasonCode: "PROGRESS",
          payload: { phase: status.phase, incompleteHandoff: status.incompleteHandoff },
        });
      }
    },
  };
}
