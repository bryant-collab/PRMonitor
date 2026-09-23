import { createHash, randomUUID } from "node:crypto";
import type { ActivityWriter } from "./activity-service";
import type {
  F11ClaimView,
  F11EvaluateResult,
  F11ObservedVersionInput,
  F11ClaimRequest,
} from "./f11-eligibility-service";
import type {
  F12DispatchIntentRecord,
  F12PersistenceRepositories,
  F12PollRequestRecord,
  F12ReviewBatchRecord,
  F12ScheduleSlotRecord,
  F12SchedulerStateRecord,
} from "./persistence/f12-repositories";
import type { F10PollRunResult } from "./pr-polling-contracts";
import type { ManagedPrReadModel } from "../shared/managed-pr";
import type {
  F11EligibilityConfiguration,
  F11RemotePrState,
} from "../shared/domain/eligibility";
import {
  DEFAULT_F12_INTERVAL_MS,
  F12_BACKOFF_MS,
  F12_SCHEMA_VERSION,
  resolveF12SchedulerConfiguration,
  type F12DispatchIntentView,
  type F12PollRequestView,
  type F12ReviewBatchView,
  type F12ScheduleSlotView,
  type F12SchedulerConfiguration,
  type F12SchedulerConfigurationInput,
  type F12SchedulerControlResult,
  type F12SchedulerReason,
  type F12SchedulerSnapshot,
  type F12WatchingPauseView,
} from "../shared/control-plane";

export interface F12ManagedPrSource {
  readonly listManagedPrs: () => readonly ManagedPrReadModel[];
}

export interface F12Poller {
  readonly poll: (input: {
    readonly requestId: string;
    readonly managedPrIds: readonly string[];
    readonly signal?: AbortSignal;
  }) => Promise<F10PollRunResult>;
}

export interface F12EligibilityBoundary {
  readonly evaluateObservedVersion: (
    input: F11ObservedVersionInput,
  ) => F11EvaluateResult;
  readonly listEligibleVersionIds: (managedPrId: string) => readonly string[];
  readonly getActiveHold: (managedPrId: string) => unknown;
  readonly getActiveClaim: (managedPrId: string) => unknown;
  readonly claimAutomatic: (input: F11ClaimRequest) => F11ClaimView;
}

export interface F12ReviewWorkHandoff {
  readonly batchId: string;
  readonly managedPrId: string;
  readonly eventVersionIds: readonly string[];
  readonly operationId: string;
  readonly bundleId: string;
  readonly claimId: string;
  readonly holdId?: string;
  readonly schedulerRevision: number;
  readonly correlationId: string;
}

export type F12ReviewWorkOutcome =
  "ACCEPTED" | "ALREADY_ACCEPTED" | "REJECTED" | "UNCERTAIN";

export interface F12ReviewWorkResult {
  readonly outcome: F12ReviewWorkOutcome;
  readonly reason?: F12SchedulerReason;
}

export interface F12ReviewWorkBoundary {
  readonly startAutomaticReview: (
    input: F12ReviewWorkHandoff,
  ) => Promise<F12ReviewWorkResult>;
}

export interface F12SchedulerPersistence {
  readonly getSchedulerState: (
    defaults?: F12SchedulerConfiguration,
    at?: string,
  ) => F12SchedulerStateRecord;
  readonly updateConfiguration: (input: {
    readonly configuration: F12SchedulerConfiguration;
    readonly actor: string;
    readonly requestId: string;
    readonly expectedRevision?: number;
    readonly changedAt?: string;
  }) => F12SchedulerStateRecord;
  readonly setPaused: (input: {
    readonly paused: boolean;
    readonly actor: string;
    readonly requestId: string;
    readonly expectedRevision?: number;
    readonly changedAt?: string;
  }) => F12SchedulerStateRecord;
  readonly ensureScheduleSlots: (
    managedPrIds: readonly string[],
    intervalMs: number,
    at?: string,
  ) => void;
  readonly listScheduleSlots: () => readonly F12ScheduleSlotRecord[];
  readonly getScheduleSlot: (
    managedPrId: string,
  ) => F12ScheduleSlotRecord | undefined;
  readonly putScheduleSlot: (input: {
    readonly managedPrId: string;
    readonly state: "IDLE" | "RUNNING";
    readonly nextDueAt: string;
    readonly retryAt?: string;
    readonly retryAttempt: number;
    readonly lastRequestId?: string;
    readonly lastOutcome?: string;
    readonly reason?: F12SchedulerReason;
    readonly expectedVersion?: number;
    readonly updatedAt?: string;
  }) => F12ScheduleSlotRecord;
  readonly listPollRequests: (
    limit?: number,
  ) => readonly F12PollRequestRecord[];
  readonly getPollRequest: (
    requestId: string,
  ) => F12PollRequestRecord | undefined;
  readonly findActivePollRequest: (
    managedPrIds: readonly string[],
  ) => F12PollRequestRecord | undefined;
  readonly beginPollRequest: (input: {
    readonly requestId: string;
    readonly scopeKey: string;
    readonly managedPrIds: readonly string[];
    readonly kind: "SCHEDULED" | "CHECK_NOW" | "RECOVERY";
    readonly schedulerRevision: number;
    readonly createdAt?: string;
  }) => { readonly created: boolean; readonly request: F12PollRequestRecord };
  readonly markPollRequestRunning: (
    requestId: string,
    startedAt?: string,
  ) => F12PollRequestRecord;
  readonly completePollRequest: (input: {
    readonly requestId: string;
    readonly status: "SUCCEEDED" | "FAILED" | "CANCELLED" | "UNCERTAIN";
    readonly reason?: F12SchedulerReason;
    readonly completedAt?: string;
  }) => F12PollRequestRecord;
  readonly reconcilePollRequests: (
    reason: F12SchedulerReason,
    at?: string,
  ) => readonly F12PollRequestRecord[];
  readonly addEligibleVersion: (input: {
    readonly managedPrId: string;
    readonly eventVersionId: string;
    readonly eligibleAt?: string;
    readonly quietPeriodMs: number;
    readonly schedulerRevision: number;
  }) => {
    readonly outcome: "CREATED" | "ADDED" | "DUPLICATE" | "CONFLICT";
    readonly batch: F12ReviewBatchRecord;
  };
  readonly markExpiredBatchesReady: (
    at?: string,
  ) => readonly F12ReviewBatchRecord[];
  readonly getReviewBatch: (
    batchId: string,
  ) => F12ReviewBatchRecord | undefined;
  readonly listReviewBatches: (
    states?: readonly F12ReviewBatchRecord["state"][],
  ) => readonly F12ReviewBatchRecord[];
  readonly updateReviewBatch: (input: {
    readonly batchId: string;
    readonly state: F12ReviewBatchRecord["state"];
    readonly dispatchIntentId?: string;
    readonly claimId?: string;
    readonly operationId?: string;
    readonly bundleId?: string;
    readonly reason?: F12SchedulerReason | null;
    readonly expectedVersion?: number;
    readonly updatedAt?: string;
  }) => F12ReviewBatchRecord;
  readonly getDispatchIntent: (
    batchId: string,
  ) => F12DispatchIntentRecord | undefined;
  readonly listDispatchIntents: (
    limit?: number,
  ) => readonly F12DispatchIntentRecord[];
  readonly createDispatchIntent: (input: {
    readonly intentId: string;
    readonly batchId: string;
    readonly managedPrId: string;
    readonly eventVersionIds: readonly string[];
    readonly operationId: string;
    readonly bundleId: string;
    readonly schedulerRevision: number;
    readonly createdAt?: string;
  }) => { readonly created: boolean; readonly intent: F12DispatchIntentRecord };
  readonly updateDispatchIntent: (input: {
    readonly intentId: string;
    readonly status: F12DispatchIntentRecord["status"];
    readonly claimId?: string;
    readonly holdId?: string;
    readonly reason?: F12SchedulerReason | null;
    readonly updatedAt?: string;
  }) => F12DispatchIntentRecord;
  readonly listRecoveryDispatchIntents: () => readonly F12DispatchIntentRecord[];
}

export interface F12SchedulerClock {
  readonly now: () => string;
}

export interface F12SchedulerTimer {
  readonly setTimeout: (callback: () => void, milliseconds: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

export interface F12SchedulerOptions {
  readonly managedPrs: F12ManagedPrSource;
  readonly persistence: F12SchedulerPersistence;
  readonly poller: F12Poller;
  readonly eligibility: F12EligibilityBoundary;
  readonly reviewWork?: F12ReviewWorkBoundary;
  readonly activity?: ActivityWriter;
  readonly clock?: F12SchedulerClock;
  readonly timer?: F12SchedulerTimer;
  readonly configuration?: F12SchedulerConfigurationInput;
  readonly eligibilityConfiguration?: (
    managedPr: ManagedPrReadModel,
  ) => F11EligibilityConfiguration;
}

export interface F12StartOptions {
  readonly runImmediately?: boolean;
}

interface ActivePoll {
  readonly request: F12PollRequestRecord;
  readonly promise: Promise<F10PollRunResult>;
}

const DEFAULT_CLOCK: F12SchedulerClock = {
  now: () => new Date().toISOString(),
};

const DEFAULT_TIMER: F12SchedulerTimer = {
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function timestamp(clock: F12SchedulerClock): string {
  const value = clock.now();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
    throw new Error("F12_CLOCK_MUST_RETURN_UTC_MILLISECONDS");
  return value;
}

function identifier(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);
}

function reason(
  code: string,
  what: string,
  why: string,
  nextAction: F12SchedulerReason["nextAction"],
  details: Readonly<Record<string, string | number | boolean>> = {},
): F12SchedulerReason {
  return { code, what, why, nextAction, details };
}

function addMs(value: string, milliseconds: number): string {
  return new Date(Date.parse(value) + milliseconds).toISOString();
}

function dueAt(slot: F12ScheduleSlotRecord): string {
  if (slot.retryAt !== undefined) return slot.retryAt;
  return slot.nextDueAt;
}

function remoteState(managedPr: ManagedPrReadModel): F11RemotePrState {
  if (managedPr.merged) return "MERGED";
  return managedPr.state === "OPEN" ? "OPEN" : "CLOSED";
}

function defaultEligibilityConfiguration(
  managedPr: ManagedPrReadModel,
): F11EligibilityConfiguration {
  return {
    automationIdentity: { serverId: managedPr.serverId },
  };
}

function resultReason(result: F10PollRunResult): F12SchedulerReason {
  const resourceReason = result.resources.find(
    (resource) => resource.reason !== undefined,
  )?.reason;
  if (resourceReason !== undefined)
    return reason(
      resourceReason.code,
      resourceReason.message,
      "The F10 poll returned a bounded resource outcome.",
      resourceReason.nextAction === "RETRY" ? "RETRY" : "REVIEW",
    );
  return reason(
    result.status === "CANCELLED" ? "POLL_CANCELLED" : "POLL_FAILED",
    "The scheduled feedback poll did not complete successfully.",
    "F12 preserves the request and feedback history until F10 reports a durable outcome.",
    result.status === "CANCELLED" ? "RETRY" : "RETRY",
    { status: result.status },
  );
}

function statusForPoll(
  result: F10PollRunResult,
): "SUCCEEDED" | "FAILED" | "CANCELLED" {
  if (result.status === "COMPLETED") return "SUCCEEDED";
  if (result.status === "CANCELLED") return "CANCELLED";
  return "FAILED";
}

function failedPollResult(
  request: F12PollRequestRecord,
  startedAt: string,
  completedAt: string,
): F10PollRunResult {
  return {
    pollRunId: `f12-failed-${hash(request.requestId)}`,
    correlationId: request.requestId,
    status: "FAILED",
    resources: [],
    newVersionIds: [],
    newSemanticInputCount: 0,
    activityDegraded: false,
    startedAt,
    completedAt,
  };
}

export class ReviewScheduler {
  public readonly defaults: F12SchedulerConfiguration;
  private readonly clock: F12SchedulerClock;
  private readonly timer: F12SchedulerTimer;
  private readonly activePolls = new Map<string, ActivePoll>();
  private timerHandle: unknown;
  private running = false;
  private tickPromise: Promise<void> | undefined;

  public constructor(private readonly options: F12SchedulerOptions) {
    this.defaults = resolveF12SchedulerConfiguration(options.configuration);
    this.clock = options.clock ?? DEFAULT_CLOCK;
    this.timer = options.timer ?? DEFAULT_TIMER;
  }

  public start(input: F12StartOptions = {}): void {
    if (this.running) return;
    this.running = true;
    const at = timestamp(this.clock);
    const state = this.options.persistence.getSchedulerState(this.defaults, at);
    const managedPrs = this.readManagedPrs();
    this.options.persistence.ensureScheduleSlots(
      managedPrs.map((managedPr) => managedPr.id),
      state.configuration.intervalMs,
      at,
    );
    const recoveryReason = reason(
      "POLL_INTERRUPTED",
      "A scheduler poll was interrupted by process restart.",
      "The durable poll request remains retryable and F10 owns its resource checkpoints.",
      "RETRY",
    );
    const uncertain = this.options.persistence.reconcilePollRequests(
      recoveryReason,
      at,
    );
    for (const request of uncertain) {
      this.startPollExecution(request);
    }
    for (const intent of this.options.persistence.listRecoveryDispatchIntents()) {
      if (intent.status === "HANDED_OFF") continue;
      void this.dispatchBatch(intent.batchId);
    }
    if (input.runImmediately === true) void this.tick();
    this.scheduleNextWakeup();
  }

  public stop(): void {
    this.running = false;
    if (this.timerHandle !== undefined)
      this.timer.clearTimeout(this.timerHandle);
    this.timerHandle = undefined;
  }

  public wake(): void {
    if (!this.running) return;
    void this.tick();
  }

  public read(): F12SchedulerSnapshot {
    const at = timestamp(this.clock);
    const state = this.options.persistence.getSchedulerState(this.defaults, at);
    const managedPrs = this.readManagedPrs();
    this.options.persistence.ensureScheduleSlots(
      managedPrs.map((managedPr) => managedPr.id),
      state.configuration.intervalMs,
      at,
    );
    return this.snapshot(state, at);
  }

  public updateConfiguration(input: {
    readonly actor: string;
    readonly requestId: string;
    readonly configuration: F12SchedulerConfigurationInput;
    readonly expectedRevision?: number;
  }): F12SchedulerSnapshot {
    const at = timestamp(this.clock);
    const current = this.options.persistence.getSchedulerState(
      this.defaults,
      at,
    );
    const configuration = resolveF12SchedulerConfiguration({
      ...current.configuration,
      ...input.configuration,
    });
    const updated = this.options.persistence.updateConfiguration({
      configuration,
      actor: input.actor,
      requestId: input.requestId,
      expectedRevision: input.expectedRevision,
      changedAt: at,
    });
    const managedPrs = this.readManagedPrs();
    this.options.persistence.ensureScheduleSlots(
      managedPrs.map((managedPr) => managedPr.id),
      updated.configuration.intervalMs,
      at,
    );
    this.appendActivity(
      "OPERATION_SUCCEEDED",
      "SCHEDULER_CONFIGURATION_UPDATED",
      "Scheduler configuration updated",
      at,
    );
    this.scheduleNextWakeup();
    return this.snapshot(updated, at);
  }

  public pauseWatching(input: {
    readonly requestId: string;
    readonly actor?: string;
    readonly expectedRevision?: number;
  }): F12SchedulerControlResult {
    const at = timestamp(this.clock);
    const current = this.options.persistence.getSchedulerState(
      this.defaults,
      at,
    );
    const updated = this.options.persistence.setPaused({
      paused: true,
      actor: input.actor ?? "USER",
      requestId: input.requestId,
      expectedRevision: input.expectedRevision,
      changedAt: at,
    });
    this.appendActivity(
      current.paused ? "OPERATION_PROGRESS" : "OPERATION_SUCCEEDED",
      current.paused ? "WATCHING_PAUSED" : "WATCHING_PAUSED",
      current.paused ? "Watching is already paused" : "Watching paused",
      at,
    );
    return {
      schemaVersion: F12_SCHEMA_VERSION,
      kind: "PAUSE_WATCHING",
      requestId: input.requestId,
      status: current.paused ? "NO_CHANGE" : "ACCEPTED",
      snapshot: this.snapshot(updated, at),
    };
  }

  public resumeWatching(input: {
    readonly requestId: string;
    readonly actor?: string;
    readonly expectedRevision?: number;
  }): F12SchedulerControlResult {
    const at = timestamp(this.clock);
    const current = this.options.persistence.getSchedulerState(
      this.defaults,
      at,
    );
    const updated = this.options.persistence.setPaused({
      paused: false,
      actor: input.actor ?? "USER",
      requestId: input.requestId,
      expectedRevision: input.expectedRevision,
      changedAt: at,
    });
    this.appendActivity(
      current.paused ? "OPERATION_SUCCEEDED" : "OPERATION_PROGRESS",
      "WATCHING_RESUMED",
      current.paused ? "Watching resumed" : "Watching is already active",
      at,
    );
    if (current.paused) void this.tick();
    return {
      schemaVersion: F12_SCHEMA_VERSION,
      kind: "RESUME_WATCHING",
      requestId: input.requestId,
      status: current.paused ? "ACCEPTED" : "NO_CHANGE",
      snapshot: this.snapshot(updated, at),
    };
  }

  public async checkNow(input: {
    readonly requestId: string;
    readonly managedPrId?: string;
  }): Promise<F12SchedulerControlResult> {
    const at = timestamp(this.clock);
    const managedPrs = this.readManagedPrs();
    const managedPrIds =
      input.managedPrId === undefined
        ? managedPrs.map((managedPr) => managedPr.id)
        : [input.managedPrId];
    if (
      input.managedPrId !== undefined &&
      !managedPrs.some((managedPr) => managedPr.id === input.managedPrId)
    )
      throw new Error("F12_MANAGED_PR_NOT_FOUND");
    const state = this.options.persistence.getSchedulerState(this.defaults, at);
    this.options.persistence.ensureScheduleSlots(
      managedPrIds,
      state.configuration.intervalMs,
      at,
    );
    if (state.paused && !state.configuration.readOnlyPollWhilePaused) {
      return {
        schemaVersion: F12_SCHEMA_VERSION,
        kind: "CHECK_NOW",
        requestId: input.requestId,
        status: "DEFERRED",
        reason: reason(
          "GLOBAL_PAUSED",
          "Check Now is deferred while Watching is paused.",
          "This scheduler configuration permits no read-only polling during a global pause.",
          "WAIT",
        ),
        snapshot: this.snapshot(state, at),
      };
    }
    const scopeKey =
      input.managedPrId === undefined ? "ALL" : input.managedPrId;
    const begun = this.options.persistence.beginPollRequest({
      requestId: input.requestId,
      scopeKey,
      managedPrIds,
      kind: "CHECK_NOW",
      schedulerRevision: state.revision,
      createdAt: at,
    });
    const active = this.activePolls.get(begun.request.requestId);
    const status = begun.created ? "ACCEPTED" : "COALESCED";
    const promise = active?.promise ?? this.startPollExecution(begun.request);
    await promise;
    const updated = this.options.persistence.getSchedulerState(
      this.defaults,
      timestamp(this.clock),
    );
    return {
      schemaVersion: F12_SCHEMA_VERSION,
      kind: "CHECK_NOW",
      requestId: input.requestId,
      status,
      snapshot: this.snapshot(updated, timestamp(this.clock)),
    };
  }

  public async dispatchReadyBatch(
    batchId: string,
  ): Promise<F12ReviewBatchRecord | undefined> {
    return this.dispatchBatch(batchId);
  }

  private readManagedPrs(): readonly ManagedPrReadModel[] {
    const managedPrs = this.options.managedPrs.listManagedPrs();
    if (!Array.isArray(managedPrs))
      throw new Error("F12_MANAGED_PR_SOURCE_INVALID");
    return managedPrs;
  }

  private snapshot(
    state: F12SchedulerStateRecord,
    at: string,
  ): F12SchedulerSnapshot {
    const slots = this.options.persistence.listScheduleSlots();
    const requests = this.options.persistence.listPollRequests(256);
    const batches = this.options.persistence.listReviewBatches();
    const intents = this.options.persistence.listDispatchIntents(256);
    const pause: F12WatchingPauseView = {
      schemaVersion: F12_SCHEMA_VERSION,
      paused: state.paused,
      revision: state.revision,
      changedAt: state.changedAt,
      actor: state.actor,
      requestId: state.requestId,
      automaticDispatchBlocked: state.paused,
      readOnlyPollingPermitted: state.configuration.readOnlyPollWhilePaused,
    };
    const nextDueAt = slots
      .filter((slot) => slot.state === "IDLE")
      .map(dueAt)
      .sort()[0];
    const nextBatchDeadlineAt = batches
      .filter((batch) => ["PENDING", "READY", "DEFERRED"].includes(batch.state))
      .map((batch) => batch.deadlineAt)
      .sort()[0];
    return {
      schemaVersion: F12_SCHEMA_VERSION,
      schedulerRevision: state.revision,
      configuration: state.configuration,
      pause,
      slots: slots.map((slot) => this.slotView(slot)),
      pollRequests: requests.map((request) => this.pollRequestView(request)),
      pendingBatches: batches.map((batch) => this.batchView(batch)),
      dispatchIntents: intents.map((intent) => this.dispatchView(intent)),
      ...(nextDueAt === undefined ? {} : { nextDueAt }),
      ...(nextBatchDeadlineAt === undefined ? {} : { nextBatchDeadlineAt }),
      updatedAt: at,
    };
  }

  private slotView(slot: F12ScheduleSlotRecord): F12ScheduleSlotView {
    return {
      schemaVersion: F12_SCHEMA_VERSION,
      ...slot,
    };
  }

  private pollRequestView(request: F12PollRequestRecord): F12PollRequestView {
    return {
      schemaVersion: F12_SCHEMA_VERSION,
      ...request,
    };
  }

  private batchView(batch: F12ReviewBatchRecord): F12ReviewBatchView {
    return {
      schemaVersion: F12_SCHEMA_VERSION,
      ...batch,
    };
  }

  private dispatchView(intent: F12DispatchIntentRecord): F12DispatchIntentView {
    return {
      schemaVersion: F12_SCHEMA_VERSION,
      ...intent,
    };
  }

  private async tick(): Promise<void> {
    if (this.tickPromise !== undefined) return this.tickPromise;
    const work = this.performTick().finally(() => {
      this.tickPromise = undefined;
    });
    this.tickPromise = work;
    return work;
  }

  private async performTick(): Promise<void> {
    if (!this.running) return;
    const at = timestamp(this.clock);
    const state = this.options.persistence.getSchedulerState(this.defaults, at);
    const managedPrs = this.readManagedPrs();
    this.options.persistence.ensureScheduleSlots(
      managedPrs.map((managedPr) => managedPr.id),
      state.configuration.intervalMs,
      at,
    );
    this.options.persistence.markExpiredBatchesReady(at);

    const slots = this.options.persistence.listScheduleSlots();
    const due = slots
      .filter((slot) => slot.state === "IDLE" && dueAt(slot) <= at)
      .sort((left, right) =>
        `${dueAt(left)}:${left.managedPrId}`.localeCompare(
          `${dueAt(right)}:${right.managedPrId}`,
        ),
      );
    const dueToRun =
      state.paused && !state.configuration.readOnlyPollWhilePaused
        ? []
        : due.slice(0, state.configuration.maxConcurrentPrs);
    await Promise.all(
      dueToRun.map((slot) => this.startScheduledPoll(slot.managedPrId)),
    );

    if (!state.paused) {
      const ready = this.options.persistence.listReviewBatches([
        "READY",
        "DISPATCHING",
      ]);
      await Promise.all(
        ready.map((batch) => this.dispatchBatch(batch.batchId)),
      );
    }
    this.scheduleNextWakeup();
  }

  private async startScheduledPoll(managedPrId: string): Promise<void> {
    const state = this.options.persistence.getSchedulerState(
      this.defaults,
      timestamp(this.clock),
    );
    const requestId = identifier("f12-poll");
    const begun = this.options.persistence.beginPollRequest({
      requestId,
      scopeKey: managedPrId,
      managedPrIds: [managedPrId],
      kind: "SCHEDULED",
      schedulerRevision: state.revision,
      createdAt: timestamp(this.clock),
    });
    await (this.activePolls.get(begun.request.requestId)?.promise ??
      this.startPollExecution(begun.request));
  }

  private startPollExecution(
    request: F12PollRequestRecord,
  ): Promise<F10PollRunResult> {
    const existing = this.activePolls.get(request.requestId);
    if (existing !== undefined) return existing.promise;
    const promise = this.executePoll(request).finally(() => {
      this.activePolls.delete(request.requestId);
    });
    this.activePolls.set(request.requestId, { request, promise });
    return promise;
  }

  private async executePoll(
    request: F12PollRequestRecord,
  ): Promise<F10PollRunResult> {
    const startedAt = timestamp(this.clock);
    this.options.persistence.markPollRequestRunning(
      request.requestId,
      startedAt,
    );
    this.appendActivity(
      "POLL_STARTED",
      "POLL_STARTED",
      "Scheduled PR feedback polling started",
      startedAt,
      request.managedPrIds.length === 1 ? request.managedPrIds[0] : undefined,
      request.requestId,
    );
    let result: F10PollRunResult;
    try {
      result = await this.options.poller.poll({
        requestId: request.requestId,
        managedPrIds: request.managedPrIds,
      });
    } catch {
      const failure = reason(
        "POLL_FAILED",
        "The scheduled feedback poll failed before F10 returned a durable result.",
        "F12 keeps the request retryable and does not mark feedback handled.",
        "RETRY",
      );
      this.options.persistence.completePollRequest({
        requestId: request.requestId,
        status: "FAILED",
        reason: failure,
        completedAt: timestamp(this.clock),
      });
      await this.updatePollSlots(request, "FAILED", failure);
      const completedAt = timestamp(this.clock);
      this.appendActivity(
        "POLL_FAILED",
        "POLL_FAILED",
        "Scheduled PR feedback polling failed before F10 returned a durable result",
        completedAt,
        request.managedPrIds.length === 1 ? request.managedPrIds[0] : undefined,
        request.requestId,
      );
      return failedPollResult(request, startedAt, completedAt);
    }

    const ingestionSucceeded = await this.ingestNewVersions(result, request);
    const pollStatus = statusForPoll(result);
    const effectiveStatus =
      ingestionSucceeded && pollStatus === "SUCCEEDED"
        ? "SUCCEEDED"
        : pollStatus === "CANCELLED"
          ? "CANCELLED"
          : "FAILED";
    const pollReason = !ingestionSucceeded
      ? reason(
          "BATCH_INGEST_FAILED",
          "Observed feedback could not be fully admitted to the durable Review Batch ledger.",
          "F12 keeps the poll retryable and replays the bounded F10 version set on a later read.",
          "RETRY",
        )
      : effectiveStatus === "SUCCEEDED"
        ? undefined
        : resultReason(result);
    this.options.persistence.completePollRequest({
      requestId: request.requestId,
      status: effectiveStatus,
      ...(pollReason === undefined ? {} : { reason: pollReason }),
      completedAt: result.completedAt,
    });
    await this.updatePollSlots(request, effectiveStatus, pollReason);
    this.appendActivity(
      effectiveStatus === "SUCCEEDED" ? "POLL_COMPLETED" : "POLL_FAILED",
      effectiveStatus === "SUCCEEDED" ? "POLL_COMPLETED" : "POLL_FAILED",
      effectiveStatus === "SUCCEEDED"
        ? "Scheduled PR feedback polling completed"
        : "Scheduled PR feedback polling needs another attempt",
      result.completedAt,
      request.managedPrIds.length === 1 ? request.managedPrIds[0] : undefined,
      request.requestId,
    );
    if (this.running) void this.tick();
    return result;
  }

  private async updatePollSlots(
    request: F12PollRequestRecord,
    status: "SUCCEEDED" | "FAILED" | "CANCELLED",
    failureReason?: F12SchedulerReason,
  ): Promise<void> {
    const at = timestamp(this.clock);
    const state = this.options.persistence.getSchedulerState(this.defaults, at);
    for (const managedPrId of request.managedPrIds) {
      const current = this.options.persistence.getScheduleSlot(managedPrId);
      if (current === undefined) continue;
      if (status === "SUCCEEDED") {
        this.options.persistence.putScheduleSlot({
          managedPrId,
          state: "IDLE",
          nextDueAt: addMs(at, state.configuration.intervalMs),
          retryAttempt: 0,
          lastRequestId: request.requestId,
          lastOutcome: status,
          expectedVersion: current.version,
          updatedAt: at,
        });
        continue;
      }
      const retryAttempt = Math.min(
        current.retryAttempt + 1,
        F12_BACKOFF_MS.length,
      );
      const backoff = F12_BACKOFF_MS[Math.max(0, retryAttempt - 1)] ?? 60_000;
      this.options.persistence.putScheduleSlot({
        managedPrId,
        state: "IDLE",
        nextDueAt: addMs(at, state.configuration.intervalMs),
        retryAt: addMs(at, backoff),
        retryAttempt,
        lastRequestId: request.requestId,
        lastOutcome: status,
        ...(failureReason === undefined ? {} : { reason: failureReason }),
        expectedVersion: current.version,
        updatedAt: at,
      });
    }
  }

  private async ingestNewVersions(
    result: F10PollRunResult,
    request: F12PollRequestRecord,
  ): Promise<boolean> {
    const managedPrs = new Map(
      this.readManagedPrs().map((managedPr) => [managedPr.id, managedPr]),
    );
    const versionOwners = new Map<string, string>();
    for (const resource of result.resources) {
      for (const eventVersionId of resource.newEventVersionIds)
        versionOwners.set(eventVersionId, resource.managedPrId);
    }
    const candidateVersionIds = [
      ...new Set([
        ...result.newVersionIds,
        ...result.resources.flatMap((resource) => resource.eventVersionIds),
      ]),
    ];
    let succeeded = true;
    for (const eventVersionId of candidateVersionIds) {
      const managedPrId =
        versionOwners.get(eventVersionId) ??
        (request.managedPrIds.length === 1
          ? request.managedPrIds[0]
          : undefined);
      if (managedPrId === undefined) continue;
      const managedPr = managedPrs.get(managedPrId);
      if (managedPr === undefined) continue;
      try {
        const evaluation = this.options.eligibility.evaluateObservedVersion({
          managedPrId,
          eventVersionId,
          serverId: managedPr.serverId,
          currentPrState: remoteState(managedPr),
          primaryState: managedPr.primaryState,
          configuration:
            this.options.eligibilityConfiguration?.(managedPr) ??
            defaultEligibilityConfiguration(managedPr),
          correlationId: request.requestId,
        });
        if (evaluation.evaluation.decision !== "ELIGIBLE") continue;
        const state = this.options.persistence.getSchedulerState(
          this.defaults,
          timestamp(this.clock),
        );
        const batched = this.options.persistence.addEligibleVersion({
          managedPrId,
          eventVersionId,
          eligibleAt: timestamp(this.clock),
          quietPeriodMs: state.configuration.quietPeriodMs,
          schedulerRevision: state.revision,
        });
        this.appendActivity(
          batched.outcome === "CREATED" ? "BATCH_STARTED" : "BATCH_WAITING",
          batched.outcome === "CREATED" ? "BATCH_STARTED" : "BATCH_WAITING",
          batched.outcome === "DUPLICATE"
            ? "Feedback version is already in the pending batch"
            : batched.outcome === "CREATED"
              ? "Review Batch quiet period started"
              : "Feedback version was added to the pending Review Batch",
          timestamp(this.clock),
          managedPrId,
          batched.batch.batchId,
        );
      } catch {
        succeeded = false;
        this.appendActivity(
          "OPERATION_FAILED",
          "BATCH_WAITING",
          "Feedback eligibility could not be added to a durable Review Batch",
          timestamp(this.clock),
          managedPrId,
          request.requestId,
        );
      }
    }
    return succeeded;
  }

  private async dispatchBatch(
    batchId: string,
  ): Promise<F12ReviewBatchRecord | undefined> {
    let batch = this.options.persistence.getReviewBatch(batchId);
    if (batch === undefined) return undefined;
    if (batch.state === "DISPATCHED" || batch.state === "CANCELLED")
      return batch;
    const managedPr = this.readManagedPrs().find(
      (candidate) => candidate.id === batch?.managedPrId,
    );
    if (managedPr === undefined)
      return this.deferBatch(
        batch,
        reason(
          "MANAGED_PR_UNAVAILABLE",
          "The pending Review Batch no longer has a managed pull request.",
          "F12 cannot dispatch a batch without its explicit PR identity.",
          "REVIEW",
        ),
      );

    const existingIntent = this.options.persistence.getDispatchIntent(batchId);
    const admitted =
      existingIntent !== undefined &&
      ["CLAIMED", "HANDED_OFF", "FAILED", "UNCERTAIN"].includes(
        existingIntent.status,
      ) &&
      existingIntent.claimId !== undefined;

    if (existingIntent?.status === "HANDED_OFF") {
      batch = this.options.persistence.updateReviewBatch({
        batchId,
        state: "DISPATCHED",
        dispatchIntentId: existingIntent.intentId,
        claimId: existingIntent.claimId,
        operationId: existingIntent.operationId,
        bundleId: existingIntent.bundleId,
        reason: null,
      });
      return batch;
    }

    const schedulerState = this.options.persistence.getSchedulerState(
      this.defaults,
      timestamp(this.clock),
    );
    if (!admitted && schedulerState.paused)
      return this.deferBatch(
        batch,
        reason(
          "GLOBAL_PAUSED",
          "Automatic review dispatch is paused.",
          "Pause Watching blocks new automatic claims while preserving the pending batch and its deadline.",
          "WAIT",
        ),
      );

    if (!admitted) {
      if (
        managedPr.state !== "OPEN" ||
        managedPr.merged ||
        managedPr.primaryState !== "WATCHING"
      )
        return this.deferBatch(
          batch,
          reason(
            "PR_NOT_DISPATCHABLE",
            "This pull request is not currently eligible for automatic review work.",
            "Automatic claims require an open pull request in WATCHING with no active hold.",
            "REVIEW",
          ),
        );
      if (
        this.options.eligibility.getActiveHold(batch.managedPrId) !==
          undefined ||
        this.options.eligibility.getActiveClaim(batch.managedPrId) !== undefined
      )
        return this.deferBatch(
          batch,
          reason(
            "PR_HOLD_ACTIVE",
            "A per-PR review hold is active.",
            "F11 retains held feedback until an explicit downstream outcome releases it.",
            "WAIT",
          ),
        );
    }

    const eligibleVersionIds = new Set(
      this.options.eligibility.listEligibleVersionIds(batch.managedPrId),
    );
    const exactVersionIds =
      admitted && existingIntent !== undefined
        ? existingIntent.eventVersionIds
        : batch.eventVersionIds.filter((eventVersionId) =>
            eligibleVersionIds.has(eventVersionId),
          );
    if (exactVersionIds.length === 0 && !admitted)
      return this.deferBatch(
        batch,
        reason(
          "NO_ELIGIBLE_EVENTS",
          "No still-unhandled eligible feedback remains in this batch.",
          "F12 does not claim an empty or already-associated version set.",
          "WAIT",
        ),
      );

    if (this.options.reviewWork === undefined)
      return this.deferBatch(
        batch,
        reason(
          "DOWNSTREAM_NOT_READY",
          "Automatic review work is not available yet.",
          "F12 persists the ready batch until the owning Review Bundle workflow is connected.",
          "WAIT",
        ),
      );

    const operationId =
      existingIntent?.operationId ??
      `f12-operation-${hash(`${batchId}:operation`)}`;
    const bundleId =
      existingIntent?.bundleId ?? `f12-bundle-${hash(`${batchId}:bundle`)}`;
    const intentResult =
      existingIntent === undefined
        ? this.options.persistence.createDispatchIntent({
            intentId: `f12-dispatch-${hash(batchId)}`,
            batchId,
            managedPrId: batch.managedPrId,
            eventVersionIds: exactVersionIds,
            operationId,
            bundleId,
            schedulerRevision: schedulerState.revision,
            createdAt: timestamp(this.clock),
          })
        : { created: false, intent: existingIntent };
    let intent = intentResult.intent;
    let claimId = intent.claimId;
    let holdId = intent.holdId;

    if (!admitted) {
      try {
        const claim = this.options.eligibility.claimAutomatic({
          managedPrId: batch.managedPrId,
          operationId: intent.operationId,
          bundleId: intent.bundleId,
          claimId: `f11-claim-${hash(`${batchId}:claim`)}`,
          holdId: `f11-hold-${hash(`${batchId}:hold`)}`,
          eventVersionIds: exactVersionIds,
          configuration:
            this.options.eligibilityConfiguration?.(managedPr) ??
            defaultEligibilityConfiguration(managedPr),
          currentPrState: remoteState(managedPr),
          primaryState: managedPr.primaryState,
          correlationId: intent.intentId,
        });
        if (
          claim.result.outcome !== "CLAIMED" &&
          claim.result.outcome !== "REPLAYED"
        ) {
          intent = this.options.persistence.updateDispatchIntent({
            intentId: intent.intentId,
            status: "DEFERRED",
            reason: reason(
              claim.result.reason.code,
              claim.result.reason.what,
              claim.result.reason.why,
              claim.result.reason.nextAction === "RETRY" ? "RETRY" : "WAIT",
            ),
          });
          return this.deferBatch(batch, intent.reason);
        }
        claimId = claim.claim?.claimId ?? claimId;
        holdId = claim.hold?.holdId ?? holdId;
        intent = this.options.persistence.updateDispatchIntent({
          intentId: intent.intentId,
          status: "CLAIMED",
          ...(claimId === undefined ? {} : { claimId }),
          ...(holdId === undefined ? {} : { holdId }),
          reason: null,
        });
        batch = this.options.persistence.updateReviewBatch({
          batchId,
          state: "DISPATCHING",
          dispatchIntentId: intent.intentId,
          claimId,
          operationId: intent.operationId,
          bundleId: intent.bundleId,
          reason: null,
        });
      } catch {
        const uncertain = reason(
          "CLAIM_UNKNOWN_OUTCOME",
          "The automatic claim outcome is uncertain.",
          "F12 will reconcile the durable claim identity before attempting another handoff.",
          "RECONCILE",
        );
        this.options.persistence.updateDispatchIntent({
          intentId: intent.intentId,
          status: "UNCERTAIN",
          ...(claimId === undefined ? {} : { claimId }),
          ...(holdId === undefined ? {} : { holdId }),
          reason: uncertain,
        });
        return this.deferBatch(batch, uncertain);
      }
    }

    if (claimId === undefined) {
      const uncertain = reason(
        "CLAIM_ID_MISSING",
        "The automatic claim did not return a durable identity.",
        "F12 cannot hand off work without an F11 claim reference.",
        "RECONCILE",
      );
      return this.deferBatch(batch, uncertain);
    }
    try {
      const outcome = await this.options.reviewWork.startAutomaticReview({
        batchId,
        managedPrId: batch.managedPrId,
        eventVersionIds: intent.eventVersionIds,
        operationId: intent.operationId,
        bundleId: intent.bundleId,
        claimId,
        ...(holdId === undefined ? {} : { holdId }),
        schedulerRevision: intent.schedulerRevision,
        correlationId: intent.intentId,
      });
      if (
        outcome.outcome === "ACCEPTED" ||
        outcome.outcome === "ALREADY_ACCEPTED"
      ) {
        intent = this.options.persistence.updateDispatchIntent({
          intentId: intent.intentId,
          status: "HANDED_OFF",
          ...(claimId === undefined ? {} : { claimId }),
          ...(holdId === undefined ? {} : { holdId }),
          reason: null,
        });
        return this.options.persistence.updateReviewBatch({
          batchId,
          state: "DISPATCHED",
          dispatchIntentId: intent.intentId,
          claimId,
          operationId: intent.operationId,
          bundleId: intent.bundleId,
          reason: null,
        });
      }
      const handoffReason =
        outcome.reason ??
        reason(
          outcome.outcome === "UNCERTAIN"
            ? "HANDOFF_UNKNOWN_OUTCOME"
            : "HANDOFF_REJECTED",
          outcome.outcome === "UNCERTAIN"
            ? "The downstream automatic-review handoff outcome is uncertain."
            : "The downstream automatic-review workflow did not accept the batch.",
          "F12 preserves the claim and exact input set for deterministic reconciliation.",
          outcome.outcome === "UNCERTAIN" ? "RECONCILE" : "RETRY",
        );
      intent = this.options.persistence.updateDispatchIntent({
        intentId: intent.intentId,
        status: outcome.outcome === "UNCERTAIN" ? "UNCERTAIN" : "FAILED",
        reason: handoffReason,
      });
      return this.deferBatch(batch, intent.reason ?? handoffReason);
    } catch {
      const uncertain = reason(
        "HANDOFF_UNKNOWN_OUTCOME",
        "The downstream automatic-review handoff outcome is uncertain.",
        "F12 preserves the claim and exact input set for reconciliation rather than fabricating success.",
        "RECONCILE",
      );
      this.options.persistence.updateDispatchIntent({
        intentId: intent.intentId,
        status: "UNCERTAIN",
        reason: uncertain,
      });
      return this.deferBatch(batch, uncertain);
    }
  }

  private deferBatch(
    batch: F12ReviewBatchRecord,
    batchReason: F12SchedulerReason | undefined,
  ): F12ReviewBatchRecord {
    return this.options.persistence.updateReviewBatch({
      batchId: batch.batchId,
      state: "DEFERRED",
      ...(batchReason === undefined ? {} : { reason: batchReason }),
    });
  }

  private scheduleNextWakeup(): void {
    if (!this.running) return;
    if (this.timerHandle !== undefined)
      this.timer.clearTimeout(this.timerHandle);
    const at = timestamp(this.clock);
    const state = this.options.persistence.getSchedulerState(this.defaults, at);
    const slots = this.options.persistence.listScheduleSlots();
    const batches = this.options.persistence.listReviewBatches([
      "PENDING",
      "READY",
      "DEFERRED",
    ]);
    const candidateTimes = [
      ...slots.filter((slot) => slot.state === "IDLE").map(dueAt),
      ...batches.map((batch) => batch.deadlineAt),
    ];
    const next = candidateTimes.sort()[0] ?? addMs(at, DEFAULT_F12_INTERVAL_MS);
    const rawDelay = Date.parse(next) - Date.parse(at);
    const delay = Math.min(
      rawDelay <= 0 ? state.configuration.intervalMs : rawDelay,
      24 * 60 * 60 * 1_000,
    );
    this.timerHandle = this.timer.setTimeout(() => {
      this.timerHandle = undefined;
      void this.tick();
    }, delay);
    void state;
  }

  private appendActivity(
    eventType:
      | "OPERATION_SUCCEEDED"
      | "OPERATION_PROGRESS"
      | "POLL_STARTED"
      | "POLL_COMPLETED"
      | "POLL_FAILED"
      | "BATCH_STARTED"
      | "BATCH_WAITING"
      | "OPERATION_FAILED",
    reasonCode: string,
    summary: string,
    at: string,
    managedPrId?: string,
    operationId?: string,
  ): void {
    if (this.options.activity === undefined) return;
    const safeReasonCode = [
      "POLL_STARTED",
      "POLL_COMPLETED",
      "POLL_FAILED",
      "BATCH_STARTED",
      "BATCH_WAITING",
      "PROGRESS",
      "COMPLETED",
      "FAILED",
    ].includes(reasonCode)
      ? reasonCode
      : "PROGRESS";
    this.options.activity.append({
      eventId: `f12-${hash(`${at}:${summary}:${managedPrId ?? "all"}`)}`,
      eventType,
      stage: eventType.startsWith("POLL") ? "POLLING" : "BATCHING",
      correlationId: operationId ?? `f12-${hash(`${at}:${summary}`)}`,
      ...(operationId === undefined ? {} : { operationId }),
      ...(managedPrId === undefined ? {} : { managedPrId }),
      occurrenceAt: at,
      severity:
        eventType === "OPERATION_FAILED" || eventType === "POLL_FAILED"
          ? "WARNING"
          : "INFO",
      reason: {
        code: safeReasonCode as "PROGRESS",
        what: summary,
        why: "The deterministic F12 scheduler recorded its durable control-plane outcome.",
        nextAction:
          eventType === "OPERATION_FAILED" || eventType === "POLL_FAILED"
            ? "RETRY"
            : "NONE",
      },
      summary,
      details: { feature: "F12", reasonCode },
    });
  }
}

export type { F12PersistenceRepositories };
