export const F12_SCHEMA_VERSION = 1 as const;

export const DEFAULT_F12_INTERVAL_MS = 10 * 60 * 1_000;
export const DEFAULT_F12_QUIET_PERIOD_MS = 10 * 60 * 1_000;
export const MIN_F12_INTERVAL_MS = 60 * 1_000;
export const MAX_F12_INTERVAL_MS = 24 * 60 * 60 * 1_000;
export const MAX_F12_QUIET_PERIOD_MS = MAX_F12_INTERVAL_MS;
export const DEFAULT_F12_MAX_CONCURRENT_PRS = 4;
export const MAX_F12_MAX_CONCURRENT_PRS = 64;
export const F12_BACKOFF_MS = [
  60 * 1_000,
  2 * 60 * 1_000,
  5 * 60 * 1_000,
  10 * 60 * 1_000,
  30 * 60 * 1_000,
] as const;

export interface F12SchedulerConfigurationInput {
  readonly intervalMs?: number;
  readonly quietPeriodMs?: number;
  readonly maxConcurrentPrs?: number;
  readonly readOnlyPollWhilePaused?: boolean;
}

export interface F12SchedulerConfiguration {
  readonly intervalMs: number;
  readonly quietPeriodMs: number;
  readonly maxConcurrentPrs: number;
  readonly readOnlyPollWhilePaused: boolean;
}

export function resolveF12SchedulerConfiguration(
  input: F12SchedulerConfigurationInput = {},
): F12SchedulerConfiguration {
  const intervalMs = input.intervalMs ?? DEFAULT_F12_INTERVAL_MS;
  const quietPeriodMs = input.quietPeriodMs ?? DEFAULT_F12_QUIET_PERIOD_MS;
  const maxConcurrentPrs =
    input.maxConcurrentPrs ?? DEFAULT_F12_MAX_CONCURRENT_PRS;
  const readOnlyPollWhilePaused = input.readOnlyPollWhilePaused ?? true;
  if (
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < MIN_F12_INTERVAL_MS ||
    intervalMs > MAX_F12_INTERVAL_MS
  )
    throw new Error("F12_INVALID_POLL_INTERVAL");
  if (
    !Number.isSafeInteger(quietPeriodMs) ||
    quietPeriodMs < MIN_F12_INTERVAL_MS ||
    quietPeriodMs > MAX_F12_INTERVAL_MS
  )
    throw new Error("F12_INVALID_QUIET_PERIOD");
  if (
    !Number.isSafeInteger(maxConcurrentPrs) ||
    maxConcurrentPrs < 1 ||
    maxConcurrentPrs > MAX_F12_MAX_CONCURRENT_PRS
  )
    throw new Error("F12_INVALID_PR_CONCURRENCY");
  if (typeof readOnlyPollWhilePaused !== "boolean")
    throw new Error("F12_INVALID_PAUSE_POLICY");
  return {
    intervalMs,
    quietPeriodMs,
    maxConcurrentPrs,
    readOnlyPollWhilePaused,
  };
}

export type F12ScheduleSlotState = "IDLE" | "RUNNING";

export interface F12ScheduleSlotView {
  readonly schemaVersion: typeof F12_SCHEMA_VERSION;
  readonly managedPrId: string;
  readonly state: F12ScheduleSlotState;
  readonly nextDueAt: string;
  readonly retryAt?: string;
  readonly retryAttempt: number;
  readonly lastRequestId?: string;
  readonly lastOutcome?: string;
  readonly reason?: F12SchedulerReason;
  readonly version: number;
  readonly updatedAt: string;
}

export type F12PollRequestKind = "SCHEDULED" | "CHECK_NOW" | "RECOVERY";
export type F12PollRequestStatus =
  "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "UNCERTAIN";

export interface F12PollRequestView {
  readonly schemaVersion: typeof F12_SCHEMA_VERSION;
  readonly requestId: string;
  readonly scopeKey: string;
  readonly managedPrIds: readonly string[];
  readonly kind: F12PollRequestKind;
  readonly status: F12PollRequestStatus;
  readonly schedulerRevision: number;
  readonly reason?: F12SchedulerReason;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly updatedAt: string;
}

export type F12ReviewBatchState =
  | "PENDING"
  | "READY"
  | "DISPATCHING"
  | "DISPATCHED"
  | "DEFERRED"
  | "FAILED"
  | "CANCELLED";

export interface F12ReviewBatchView {
  readonly schemaVersion: typeof F12_SCHEMA_VERSION;
  readonly batchId: string;
  readonly managedPrId: string;
  readonly state: F12ReviewBatchState;
  readonly eventVersionIds: readonly string[];
  readonly quietPeriodMs: number;
  readonly firstEligibleAt: string;
  readonly lastEligibleAt: string;
  readonly deadlineAt: string;
  readonly schedulerRevision: number;
  readonly dispatchIntentId?: string;
  readonly claimId?: string;
  readonly operationId?: string;
  readonly bundleId?: string;
  readonly reason?: F12SchedulerReason;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type F12DispatchIntentStatus =
  "PENDING" | "CLAIMED" | "HANDED_OFF" | "DEFERRED" | "FAILED" | "UNCERTAIN";

export interface F12DispatchIntentView {
  readonly schemaVersion: typeof F12_SCHEMA_VERSION;
  readonly intentId: string;
  readonly batchId: string;
  readonly managedPrId: string;
  readonly eventVersionIds: readonly string[];
  readonly operationId: string;
  readonly bundleId: string;
  readonly status: F12DispatchIntentStatus;
  readonly schedulerRevision: number;
  readonly claimId?: string;
  readonly holdId?: string;
  readonly reason?: F12SchedulerReason;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface F12WatchingPauseView {
  readonly schemaVersion: typeof F12_SCHEMA_VERSION;
  readonly paused: boolean;
  readonly revision: number;
  readonly changedAt: string;
  readonly actor: string;
  readonly requestId: string;
  readonly automaticDispatchBlocked: boolean;
  readonly readOnlyPollingPermitted: boolean;
}

export type F12SchedulerReasonNextAction =
  "NONE" | "WAIT" | "RETRY" | "RECONCILE" | "REVIEW" | "FIX_INPUT";

export interface F12SchedulerReason {
  readonly code: string;
  readonly what: string;
  readonly why: string;
  readonly nextAction: F12SchedulerReasonNextAction;
  readonly details: Readonly<Record<string, string | number | boolean>>;
}

export interface F12SchedulerSnapshot {
  readonly schemaVersion: typeof F12_SCHEMA_VERSION;
  readonly schedulerRevision: number;
  readonly configuration: F12SchedulerConfiguration;
  readonly pause: F12WatchingPauseView;
  readonly slots: readonly F12ScheduleSlotView[];
  readonly pollRequests: readonly F12PollRequestView[];
  readonly pendingBatches: readonly F12ReviewBatchView[];
  readonly dispatchIntents: readonly F12DispatchIntentView[];
  readonly nextDueAt?: string;
  readonly nextBatchDeadlineAt?: string;
  readonly updatedAt: string;
}

export type F12SchedulerControlKind =
  "CHECK_NOW" | "PAUSE_WATCHING" | "RESUME_WATCHING";

export interface F12SchedulerControlResult {
  readonly schemaVersion: typeof F12_SCHEMA_VERSION;
  readonly kind: F12SchedulerControlKind;
  readonly requestId: string;
  readonly status: "ACCEPTED" | "COALESCED" | "NO_CHANGE" | "DEFERRED";
  readonly snapshot: F12SchedulerSnapshot;
  readonly reason?: F12SchedulerReason;
}

function schedulerRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function schedulerKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => key in value) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function schedulerId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)
  );
}

function schedulerTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value))
  );
}

function schedulerInteger(value: unknown, minimum = 0): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
  );
}

function schedulerReason(value: unknown): value is F12SchedulerReason {
  if (
    !schedulerRecord(value) ||
    !schedulerKeys(value, ["code", "what", "why", "nextAction", "details"])
  )
    return false;
  if (
    !schedulerId(value.code) ||
    typeof value.what !== "string" ||
    value.what.length > 2_048 ||
    typeof value.why !== "string" ||
    value.why.length > 2_048 ||
    !["NONE", "WAIT", "RETRY", "RECONCILE", "REVIEW", "FIX_INPUT"].includes(
      String(value.nextAction),
    ) ||
    !schedulerRecord(value.details)
  )
    return false;
  return Object.entries(value.details).every(
    ([key, detail]) =>
      key.length <= 128 &&
      (typeof detail === "boolean" ||
        (typeof detail === "number" && Number.isFinite(detail)) ||
        (typeof detail === "string" && detail.length <= 512)),
  );
}

function schedulerConfiguration(
  value: unknown,
): value is F12SchedulerConfiguration {
  if (
    !schedulerRecord(value) ||
    !schedulerKeys(value, [
      "intervalMs",
      "quietPeriodMs",
      "maxConcurrentPrs",
      "readOnlyPollWhilePaused",
    ])
  )
    return false;
  try {
    resolveF12SchedulerConfiguration(
      value as unknown as F12SchedulerConfiguration,
    );
    return true;
  } catch {
    return false;
  }
}

function schedulerSchemaVersion(
  value: unknown,
): value is typeof F12_SCHEMA_VERSION {
  return value === F12_SCHEMA_VERSION;
}

function schedulerSlot(value: unknown): value is F12ScheduleSlotView {
  if (
    !schedulerRecord(value) ||
    !schedulerKeys(
      value,
      [
        "schemaVersion",
        "managedPrId",
        "state",
        "nextDueAt",
        "retryAttempt",
        "version",
        "updatedAt",
      ],
      ["retryAt", "lastRequestId", "lastOutcome", "reason"],
    )
  )
    return false;
  return (
    schedulerSchemaVersion(value.schemaVersion) &&
    schedulerId(value.managedPrId) &&
    ["IDLE", "RUNNING"].includes(String(value.state)) &&
    schedulerTimestamp(value.nextDueAt) &&
    (value.retryAt === undefined || schedulerTimestamp(value.retryAt)) &&
    schedulerInteger(value.retryAttempt) &&
    schedulerInteger(value.version, 1) &&
    schedulerTimestamp(value.updatedAt) &&
    (value.lastRequestId === undefined || schedulerId(value.lastRequestId)) &&
    (value.lastOutcome === undefined || schedulerId(value.lastOutcome)) &&
    (value.reason === undefined || schedulerReason(value.reason))
  );
}

function schedulerPollRequest(value: unknown): value is F12PollRequestView {
  if (
    !schedulerRecord(value) ||
    !schedulerKeys(
      value,
      [
        "schemaVersion",
        "requestId",
        "scopeKey",
        "managedPrIds",
        "kind",
        "status",
        "schedulerRevision",
        "createdAt",
        "updatedAt",
      ],
      ["reason", "startedAt", "completedAt"],
    )
  )
    return false;
  return (
    schedulerSchemaVersion(value.schemaVersion) &&
    schedulerId(value.requestId) &&
    schedulerId(value.scopeKey) &&
    Array.isArray(value.managedPrIds) &&
    value.managedPrIds.length <= 256 &&
    value.managedPrIds.every((managedPrId) => schedulerId(managedPrId)) &&
    ["SCHEDULED", "CHECK_NOW", "RECOVERY"].includes(String(value.kind)) &&
    [
      "PENDING",
      "RUNNING",
      "SUCCEEDED",
      "FAILED",
      "CANCELLED",
      "UNCERTAIN",
    ].includes(String(value.status)) &&
    schedulerInteger(value.schedulerRevision, 1) &&
    schedulerTimestamp(value.createdAt) &&
    schedulerTimestamp(value.updatedAt) &&
    (value.startedAt === undefined || schedulerTimestamp(value.startedAt)) &&
    (value.completedAt === undefined ||
      schedulerTimestamp(value.completedAt)) &&
    (value.reason === undefined || schedulerReason(value.reason))
  );
}

function schedulerBatch(value: unknown): value is F12ReviewBatchView {
  if (
    !schedulerRecord(value) ||
    !schedulerKeys(
      value,
      [
        "schemaVersion",
        "batchId",
        "managedPrId",
        "state",
        "eventVersionIds",
        "quietPeriodMs",
        "firstEligibleAt",
        "lastEligibleAt",
        "deadlineAt",
        "schedulerRevision",
        "version",
        "createdAt",
        "updatedAt",
      ],
      ["dispatchIntentId", "claimId", "operationId", "bundleId", "reason"],
    )
  )
    return false;
  return (
    schedulerSchemaVersion(value.schemaVersion) &&
    schedulerId(value.batchId) &&
    schedulerId(value.managedPrId) &&
    [
      "PENDING",
      "READY",
      "DISPATCHING",
      "DISPATCHED",
      "DEFERRED",
      "FAILED",
      "CANCELLED",
    ].includes(String(value.state)) &&
    Array.isArray(value.eventVersionIds) &&
    value.eventVersionIds.length <= 256 &&
    value.eventVersionIds.every((eventVersionId) =>
      schedulerId(eventVersionId),
    ) &&
    schedulerInteger(value.quietPeriodMs, MIN_F12_INTERVAL_MS) &&
    schedulerTimestamp(value.firstEligibleAt) &&
    schedulerTimestamp(value.lastEligibleAt) &&
    schedulerTimestamp(value.deadlineAt) &&
    schedulerInteger(value.schedulerRevision, 1) &&
    schedulerInteger(value.version, 1) &&
    schedulerTimestamp(value.createdAt) &&
    schedulerTimestamp(value.updatedAt) &&
    ["dispatchIntentId", "claimId", "operationId", "bundleId"].every(
      (key) => value[key] === undefined || schedulerId(value[key]),
    ) &&
    (value.reason === undefined || schedulerReason(value.reason))
  );
}

function schedulerDispatchIntent(
  value: unknown,
): value is F12DispatchIntentView {
  if (
    !schedulerRecord(value) ||
    !schedulerKeys(
      value,
      [
        "schemaVersion",
        "intentId",
        "batchId",
        "managedPrId",
        "eventVersionIds",
        "operationId",
        "bundleId",
        "status",
        "schedulerRevision",
        "createdAt",
        "updatedAt",
      ],
      ["claimId", "holdId", "reason"],
    )
  )
    return false;
  return (
    schedulerSchemaVersion(value.schemaVersion) &&
    schedulerId(value.intentId) &&
    schedulerId(value.batchId) &&
    schedulerId(value.managedPrId) &&
    Array.isArray(value.eventVersionIds) &&
    value.eventVersionIds.length <= 256 &&
    value.eventVersionIds.every((eventVersionId) =>
      schedulerId(eventVersionId),
    ) &&
    schedulerId(value.operationId) &&
    schedulerId(value.bundleId) &&
    [
      "PENDING",
      "CLAIMED",
      "HANDED_OFF",
      "DEFERRED",
      "FAILED",
      "UNCERTAIN",
    ].includes(String(value.status)) &&
    schedulerInteger(value.schedulerRevision, 1) &&
    schedulerTimestamp(value.createdAt) &&
    schedulerTimestamp(value.updatedAt) &&
    (value.claimId === undefined || schedulerId(value.claimId)) &&
    (value.holdId === undefined || schedulerId(value.holdId)) &&
    (value.reason === undefined || schedulerReason(value.reason))
  );
}

export function isF12SchedulerSnapshot(
  value: unknown,
): value is F12SchedulerSnapshot {
  if (
    !schedulerRecord(value) ||
    !schedulerKeys(
      value,
      [
        "schemaVersion",
        "schedulerRevision",
        "configuration",
        "pause",
        "slots",
        "pollRequests",
        "pendingBatches",
        "dispatchIntents",
        "updatedAt",
      ],
      ["nextDueAt", "nextBatchDeadlineAt"],
    )
  )
    return false;
  const pause = value.pause;
  return (
    schedulerSchemaVersion(value.schemaVersion) &&
    schedulerInteger(value.schedulerRevision, 1) &&
    schedulerConfiguration(value.configuration) &&
    schedulerRecord(pause) &&
    schedulerKeys(pause, [
      "schemaVersion",
      "paused",
      "revision",
      "changedAt",
      "actor",
      "requestId",
      "automaticDispatchBlocked",
      "readOnlyPollingPermitted",
    ]) &&
    schedulerSchemaVersion(pause.schemaVersion) &&
    typeof pause.paused === "boolean" &&
    schedulerInteger(pause.revision, 1) &&
    schedulerTimestamp(pause.changedAt) &&
    schedulerId(pause.actor) &&
    schedulerId(pause.requestId) &&
    typeof pause.automaticDispatchBlocked === "boolean" &&
    typeof pause.readOnlyPollingPermitted === "boolean" &&
    Array.isArray(value.slots) &&
    value.slots.length <= 256 &&
    value.slots.every(schedulerSlot) &&
    Array.isArray(value.pollRequests) &&
    value.pollRequests.length <= 256 &&
    value.pollRequests.every(schedulerPollRequest) &&
    Array.isArray(value.pendingBatches) &&
    value.pendingBatches.length <= 256 &&
    value.pendingBatches.every(schedulerBatch) &&
    Array.isArray(value.dispatchIntents) &&
    value.dispatchIntents.length <= 256 &&
    value.dispatchIntents.every(schedulerDispatchIntent) &&
    (value.nextDueAt === undefined || schedulerTimestamp(value.nextDueAt)) &&
    (value.nextBatchDeadlineAt === undefined ||
      schedulerTimestamp(value.nextBatchDeadlineAt)) &&
    schedulerTimestamp(value.updatedAt)
  );
}

export function isF12SchedulerControlResult(
  value: unknown,
): value is F12SchedulerControlResult {
  if (
    !schedulerRecord(value) ||
    !schedulerKeys(
      value,
      ["schemaVersion", "kind", "requestId", "status", "snapshot"],
      ["reason"],
    )
  )
    return false;
  return (
    schedulerSchemaVersion(value.schemaVersion) &&
    ["CHECK_NOW", "PAUSE_WATCHING", "RESUME_WATCHING"].includes(
      String(value.kind),
    ) &&
    schedulerId(value.requestId) &&
    ["ACCEPTED", "COALESCED", "NO_CHANGE", "DEFERRED"].includes(
      String(value.status),
    ) &&
    isF12SchedulerSnapshot(value.snapshot) &&
    (value.reason === undefined || schedulerReason(value.reason))
  );
}
