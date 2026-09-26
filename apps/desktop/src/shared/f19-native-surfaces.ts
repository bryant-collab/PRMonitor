import { z } from "zod";
import {
  OPEN_TARGET_QUEUE_MAX,
  parseOpenTarget,
  parseOpenTargetRecord,
  type OpenTarget,
} from "./routing";
import {
  isF12SchedulerSnapshot,
  type F12SchedulerSnapshot,
} from "./control-plane";
import {
  isManagedPrInboxReadModel,
  type ManagedPrInboxCard,
  type ManagedPrInboxReadModel,
} from "./inbox";
import type { F18ReviewBundleReadModel } from "./f18-automatic-review";

/**
 * F19 is deliberately data-only at this boundary.  Native handles, Electron
 * objects, paths, provider SDK values, and callbacks stay in the main process.
 */
export const F19_SCHEMA_VERSION = 1 as const;
export const F19_TRAY_ACTIONABLE_LIMIT = 10;
export const F19_MAX_NOTIFICATION_TITLE_BYTES = 128;
export const F19_MAX_NOTIFICATION_BODY_BYTES = 512;
export const F19_MAX_DISPLAY_REFERENCE_BYTES = 256;
export const F19_MAX_NOTIFICATION_ACTIONS = 2;
export const F19_MAX_OUTCOME_SUMMARIES = 256;
export const F19_MAX_AUTO_DELIVERY_ATTEMPTS = 2;
export const F19_POLICY_REVISION = "f19-notification-policy-v1" as const;
export const F19_BOUNDS_REVISION = "f19-effective-bounds-v1" as const;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SECRET_PATTERN =
  /(?:token|secret|password|credential|authorization|cookie|prompt|api[_.-]?key|access[_.-]?key|private[_.-]?key|environment|sdk)/iu;

export type F19TargetKind =
  "HOME" | "MANAGED_PR" | "REVIEW_BUNDLE" | "SYNCHRONIZATION_BATCH";

interface F19TargetBase {
  readonly schemaVersion: typeof F19_SCHEMA_VERSION;
  readonly target: OpenTarget;
}

export type F19NativeTarget =
  | (F19TargetBase & { readonly kind: "HOME" })
  | (F19TargetBase & {
      readonly kind: "MANAGED_PR";
      readonly managedPrId: string;
    })
  | (F19TargetBase & {
      readonly kind: "REVIEW_BUNDLE";
      readonly bundleId: string;
      readonly managedPrId: string;
    })
  | (F19TargetBase & {
      readonly kind: "SYNCHRONIZATION_BATCH";
      readonly batchId: string;
      readonly managedPrId?: string;
    });

/** Alias used by downstream consumers that refer to the contract generically. */
export type NativeTarget = F19NativeTarget;

export interface F19WorktreeReference {
  readonly operationId: string;
  readonly worktreeId: string;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly managedPrId?: string;
  readonly available: boolean;
}

export type F19ReviewOutcomeState =
  "WORKING" | "READY_FOR_REVIEW" | "NEEDS_ATTENTION";

export type F19ReviewOutcomeStage = "PROPOSAL_REVIEW" | "FINAL_REVIEW";

export interface F19ReviewBundleOutcome {
  readonly schemaVersion: typeof F19_SCHEMA_VERSION;
  readonly kind: "REVIEW_BUNDLE_OUTCOME";
  readonly outcomeId: string;
  readonly managedPrId: string;
  readonly operationId: string;
  readonly revision: number;
  readonly correlationId: string;
  readonly state: F19ReviewOutcomeState;
  readonly stage: F19ReviewOutcomeStage;
  readonly displayReference: string;
  readonly target: F19NativeTarget;
  readonly decisionSummary: {
    readonly total: number;
    readonly decided: number;
    readonly questionsNeedingAnswer: number;
    readonly complete: boolean;
  };
  readonly validationStatus?:
    "passed" | "failed" | "not_run" | "running" | "interrupted";
  readonly nextAction: string;
  readonly reasonCode?: string;
  readonly worktree?: F19WorktreeReference;
  readonly committed: true;
  readonly noImplementationChanges?: boolean;
}

export type F19SynchronizationOutcomeState =
  "READY_TO_PUBLISH" | "NEEDS_ATTENTION" | "STALE" | "FAILED";

export interface F19SynchronizationBatchOutcome {
  readonly schemaVersion: typeof F19_SCHEMA_VERSION;
  readonly kind: "SYNCHRONIZATION_BATCH_OUTCOME";
  readonly outcomeId: string;
  readonly managedPrId?: string;
  readonly operationId?: string;
  readonly revision: number;
  readonly correlationId: string;
  readonly state: F19SynchronizationOutcomeState;
  readonly displayReference: string;
  readonly target: F19NativeTarget;
  readonly summary: {
    readonly readyToPublish: number;
    readonly needsAttention: number;
    readonly stale: number;
    readonly failed: number;
  };
  readonly authoritativeReference: string;
  readonly complete: true;
  readonly committed: true;
}

export type F19OutcomeSnapshot =
  F19ReviewBundleOutcome | F19SynchronizationBatchOutcome;

export type F19NotificationCategory =
  | "PROPOSAL_READY"
  | "FINAL_REVIEW_READY"
  | "REQUIRED_INPUT"
  | "VALIDATION_FAILED"
  | "VALIDATION_INTERRUPTED"
  | "SYNCHRONIZATION_REVIEW";

export type F19DeliveryState =
  "PENDING" | "DELIVERED" | "DENIED" | "UNAVAILABLE" | "FAILED" | "UNKNOWN";

export interface F19NotificationRecord {
  readonly schemaVersion: typeof F19_SCHEMA_VERSION;
  readonly notificationId: string;
  readonly outcomeId: string;
  readonly outcomeKind: F19OutcomeSnapshot["kind"];
  readonly outcomeRevision: number;
  readonly managedPrId?: string;
  readonly operationId?: string;
  readonly category: F19NotificationCategory;
  readonly title: string;
  readonly body: string;
  readonly target: F19NativeTarget;
  readonly worktree?: F19WorktreeReference;
  readonly policyRevision: string;
  readonly correlationId: string;
  readonly canonicalPayloadHash: string;
  readonly state: F19DeliveryState;
  readonly attemptCount: number;
  readonly reconciliationCount: number;
  readonly lastReasonCode?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface F19NativeNotificationAction {
  readonly action: "OPEN_TARGET" | "OPEN_WORKTREE";
  readonly label: string;
}

export interface F19NativeNotificationRequest {
  readonly notificationId: string;
  readonly title: string;
  readonly body: string;
  readonly actions: readonly F19NativeNotificationAction[];
}

export interface F19NativeDeliveryResult {
  readonly state: Exclude<F19DeliveryState, "PENDING">;
  readonly reasonCode?: string;
}

export type F19TraySemanticState =
  "READY_FOR_REVIEW" | "NEEDS_ATTENTION" | "WORKING" | "PAUSED";

export interface F19TrayEntry {
  readonly schemaVersion: typeof F19_SCHEMA_VERSION;
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly semanticState: F19TraySemanticState;
  readonly target: F19NativeTarget;
}

export interface F19TrayMenuModel {
  readonly schemaVersion: typeof F19_SCHEMA_VERSION;
  readonly revision: number;
  readonly generatedAt: string;
  readonly needsReviewCount: number;
  readonly paused: boolean;
  readonly entries: readonly F19TrayEntry[];
  readonly overflowed: boolean;
  readonly moreTarget: F19NativeTarget;
  readonly commands: {
    readonly open: "Open PRMonitor";
    readonly pauseOrResume: "Pause Watching" | "Resume Watching";
    readonly shutdown: "Shutdown PRMonitor";
  };
}

export type F19TrayCommand = "OPEN_APP" | "PAUSE" | "RESUME" | "SHUTDOWN";

export type F19ShutdownState =
  "REQUESTED" | "HANDING_OFF" | "COMPLETED" | "RECOVERY_REQUIRED";

export interface F19ShutdownIntentRecord {
  readonly schemaVersion: typeof F19_SCHEMA_VERSION;
  readonly shutdownId: string;
  readonly command: "Shutdown PRMonitor";
  readonly state: F19ShutdownState;
  readonly correlationId: string;
  readonly lifecycleCorrelationId?: string;
  readonly reasonCode: string;
  readonly attemptCount: number;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface F19EffectiveBounds {
  readonly schemaVersion: typeof F19_SCHEMA_VERSION;
  readonly revision: typeof F19_BOUNDS_REVISION;
  readonly trayActionableLimit: typeof F19_TRAY_ACTIONABLE_LIMIT;
  readonly notificationTitleBytes: typeof F19_MAX_NOTIFICATION_TITLE_BYTES;
  readonly notificationBodyBytes: typeof F19_MAX_NOTIFICATION_BODY_BYTES;
  readonly notificationActions: typeof F19_MAX_NOTIFICATION_ACTIONS;
  readonly automaticDeliveryAttempts: typeof F19_MAX_AUTO_DELIVERY_ATTEMPTS;
  readonly activationQueueEntries: number;
  readonly shutdownTimeoutMs: number;
  readonly ipcMaxRequestBytes: number;
  readonly ipcMaxResponseBytes: number;
  readonly activityMaxSummaryBytes: number;
  readonly activityMaxDetailBytes: number;
  readonly persistenceMaxJsonBytes: number;
  readonly persistenceMaxTextBytes: number;
}

export interface F19EffectiveBoundsInput {
  readonly shutdownTimeoutMs: number;
  readonly ipcMaxRequestBytes: number;
  readonly ipcMaxResponseBytes: number;
  readonly activityMaxSummaryBytes: number;
  readonly activityMaxDetailBytes: number;
  readonly persistenceMaxJsonBytes: number;
  readonly persistenceMaxTextBytes: number;
  readonly activationQueueEntries?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
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

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

function validSafeText(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    new TextEncoder().encode(value).byteLength <= maximumBytes &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        (codePoint <= 31 &&
          codePoint !== 9 &&
          codePoint !== 10 &&
          codePoint !== 13) ||
        codePoint === 127
      );
    }) &&
    !SECRET_PATTERN.test(value)
  );
}

function validNativeTarget(value: unknown): value is F19NativeTarget {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== F19_SCHEMA_VERSION) return false;
  if (
    value.kind !== "HOME" &&
    value.kind !== "MANAGED_PR" &&
    value.kind !== "REVIEW_BUNDLE" &&
    value.kind !== "SYNCHRONIZATION_BATCH"
  )
    return false;
  const targetKeys =
    value.kind === "HOME"
      ? ["schemaVersion", "kind", "target"]
      : value.kind === "MANAGED_PR"
        ? ["schemaVersion", "kind", "managedPrId", "target"]
        : value.kind === "REVIEW_BUNDLE"
          ? ["schemaVersion", "kind", "bundleId", "managedPrId", "target"]
          : ["schemaVersion", "kind", "batchId", "target"];
  if (
    !exactKeys(
      value,
      targetKeys,
      value.kind === "SYNCHRONIZATION_BATCH" ? ["managedPrId"] : [],
    )
  )
    return false;
  const parsed = parseOpenTargetRecord(value.target);
  if (!parsed.ok) return false;
  if (value.kind === "HOME") return parsed.value.kind === "HOME";
  if (value.kind === "MANAGED_PR")
    return (
      parsed.value.kind === "MANAGED_PR" &&
      validIdentifier(value.managedPrId) &&
      parsed.value.id === value.managedPrId
    );
  if (value.kind === "REVIEW_BUNDLE")
    return (
      parsed.value.kind === "REVIEW_BUNDLE" &&
      validIdentifier(value.bundleId) &&
      validIdentifier(value.managedPrId) &&
      parsed.value.id === value.bundleId
    );
  if (value.kind === "SYNCHRONIZATION_BATCH")
    return (
      parsed.value.kind === "SYNCHRONIZATION_BATCH" &&
      validIdentifier(value.batchId) &&
      (value.managedPrId === undefined || validIdentifier(value.managedPrId)) &&
      parsed.value.id === value.batchId
    );
  return false;
}

function validWorktreeReference(value: unknown): value is F19WorktreeReference {
  return (
    isRecord(value) &&
    exactKeys(
      value,
      ["operationId", "worktreeId", "ownerType", "ownerId", "available"],
      ["managedPrId"],
    ) &&
    validIdentifier(value.operationId) &&
    validIdentifier(value.worktreeId) &&
    validIdentifier(value.ownerType) &&
    validIdentifier(value.ownerId) &&
    (value.managedPrId === undefined || validIdentifier(value.managedPrId)) &&
    typeof value.available === "boolean"
  );
}

export function isF19NativeTarget(value: unknown): value is F19NativeTarget {
  return validNativeTarget(value);
}

export function isF19OutcomeSnapshot(
  value: unknown,
): value is F19OutcomeSnapshot {
  if (!isRecord(value) || value.schemaVersion !== F19_SCHEMA_VERSION)
    return false;
  if (
    value.kind === "REVIEW_BUNDLE_OUTCOME" &&
    !exactKeys(
      value,
      [
        "schemaVersion",
        "kind",
        "outcomeId",
        "managedPrId",
        "operationId",
        "revision",
        "correlationId",
        "state",
        "stage",
        "displayReference",
        "target",
        "decisionSummary",
        "nextAction",
        "committed",
      ],
      ["validationStatus", "reasonCode", "worktree", "noImplementationChanges"],
    )
  )
    return false;
  if (
    value.kind === "SYNCHRONIZATION_BATCH_OUTCOME" &&
    !exactKeys(
      value,
      [
        "schemaVersion",
        "kind",
        "outcomeId",
        "revision",
        "correlationId",
        "state",
        "displayReference",
        "target",
        "summary",
        "authoritativeReference",
        "complete",
        "committed",
      ],
      ["managedPrId", "operationId"],
    )
  )
    return false;
  if (
    !validIdentifier(value.outcomeId) ||
    !validIdentifier(value.correlationId) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 1 ||
    !validSafeText(value.displayReference, F19_MAX_DISPLAY_REFERENCE_BYTES) ||
    !validNativeTarget(value.target) ||
    value.committed !== true
  )
    return false;
  if (value.kind === "REVIEW_BUNDLE_OUTCOME") {
    const decision = value.decisionSummary;
    return (
      validIdentifier(value.managedPrId) &&
      validIdentifier(value.operationId) &&
      (value.state === "WORKING" ||
        value.state === "READY_FOR_REVIEW" ||
        value.state === "NEEDS_ATTENTION") &&
      (value.stage === "PROPOSAL_REVIEW" || value.stage === "FINAL_REVIEW") &&
      value.target.kind === "REVIEW_BUNDLE" &&
      value.target.bundleId === value.outcomeId &&
      value.target.managedPrId === value.managedPrId &&
      isRecord(decision) &&
      exactKeys(decision, [
        "total",
        "decided",
        "questionsNeedingAnswer",
        "complete",
      ]) &&
      [decision.total, decision.decided, decision.questionsNeedingAnswer].every(
        (count) => Number.isSafeInteger(count) && Number(count) >= 0,
      ) &&
      typeof decision.complete === "boolean" &&
      (value.validationStatus === undefined ||
        ["passed", "failed", "not_run", "running", "interrupted"].includes(
          String(value.validationStatus),
        )) &&
      validIdentifier(value.nextAction) &&
      (value.reasonCode === undefined || validIdentifier(value.reasonCode)) &&
      (value.worktree === undefined ||
        validWorktreeReference(value.worktree)) &&
      (value.noImplementationChanges === undefined ||
        typeof value.noImplementationChanges === "boolean")
    );
  }
  if (value.kind !== "SYNCHRONIZATION_BATCH_OUTCOME") return false;
  const summary = value.summary;
  return (
    (value.managedPrId === undefined || validIdentifier(value.managedPrId)) &&
    (value.operationId === undefined || validIdentifier(value.operationId)) &&
    (value.state === "READY_TO_PUBLISH" ||
      value.state === "NEEDS_ATTENTION" ||
      value.state === "STALE" ||
      value.state === "FAILED") &&
    value.target.kind === "SYNCHRONIZATION_BATCH" &&
    value.target.batchId === value.outcomeId &&
    isRecord(summary) &&
    exactKeys(summary, [
      "readyToPublish",
      "needsAttention",
      "stale",
      "failed",
    ]) &&
    [
      summary.readyToPublish,
      summary.needsAttention,
      summary.stale,
      summary.failed,
    ].every((count) => Number.isSafeInteger(count) && Number(count) >= 0) &&
    validIdentifier(value.authoritativeReference) &&
    value.complete === true
  );
}

export function parseF19OutcomeSnapshot(value: unknown): F19OutcomeSnapshot {
  if (!isF19OutcomeSnapshot(value)) throw new Error("F19_INVALID_OUTCOME");
  return value;
}

function targetFromUri(
  uri: string,
  kind: F19TargetKind,
  id?: string,
): F19NativeTarget {
  const parsed = parseOpenTarget(uri);
  if (!parsed.ok) throw new Error("F19_INVALID_TARGET");
  if (parsed.value.kind !== kind) throw new Error("F19_TARGET_KIND_MISMATCH");
  if (kind === "HOME")
    return { schemaVersion: F19_SCHEMA_VERSION, kind, target: parsed.value };
  if (id === undefined) throw new Error("F19_TARGET_ID_MISSING");
  if (kind === "MANAGED_PR")
    return {
      schemaVersion: F19_SCHEMA_VERSION,
      kind,
      managedPrId: id,
      target: parsed.value,
    };
  if (kind === "REVIEW_BUNDLE")
    return {
      schemaVersion: F19_SCHEMA_VERSION,
      kind,
      bundleId: id,
      managedPrId: "unknown-managed-pr",
      target: parsed.value,
    };
  return {
    schemaVersion: F19_SCHEMA_VERSION,
    kind,
    batchId: id,
    target: parsed.value,
  };
}

export function buildF19HomeTarget(): F19NativeTarget {
  return targetFromUri("prmonitor://home", "HOME");
}

export function buildF19ManagedPrTarget(managedPrId: string): F19NativeTarget {
  if (!validIdentifier(managedPrId))
    throw new Error("F19_INVALID_MANAGED_PR_ID");
  return targetFromUri(
    `prmonitor://pr/${managedPrId}`,
    "MANAGED_PR",
    managedPrId,
  );
}

export function buildF19ReviewBundleTarget(
  bundleId: string,
  managedPrId: string,
): F19NativeTarget {
  if (!validIdentifier(bundleId) || !validIdentifier(managedPrId))
    throw new Error("F19_INVALID_REVIEW_BUNDLE_ID");
  const parsed = parseOpenTarget(`prmonitor://review-bundle/${bundleId}`);
  if (!parsed.ok) throw new Error("F19_INVALID_REVIEW_BUNDLE_TARGET");
  return {
    schemaVersion: F19_SCHEMA_VERSION,
    kind: "REVIEW_BUNDLE",
    bundleId,
    managedPrId,
    target: parsed.value,
  };
}

export function buildF19SynchronizationBatchTarget(
  batchId: string,
  managedPrId?: string,
): F19NativeTarget {
  if (
    !validIdentifier(batchId) ||
    (managedPrId !== undefined && !validIdentifier(managedPrId))
  )
    throw new Error("F19_INVALID_SYNCHRONIZATION_BATCH_ID");
  const parsed = parseOpenTarget(`prmonitor://sync-batch/${batchId}`);
  if (!parsed.ok) throw new Error("F19_INVALID_SYNCHRONIZATION_TARGET");
  return {
    schemaVersion: F19_SCHEMA_VERSION,
    kind: "SYNCHRONIZATION_BATCH",
    batchId,
    ...(managedPrId === undefined ? {} : { managedPrId }),
    target: parsed.value,
  };
}

export function worktreeReferenceFromF18(
  readModel: F18ReviewBundleReadModel,
): F19WorktreeReference | undefined {
  const worktree = readModel.worktree;
  if (worktree === undefined) return undefined;
  return {
    operationId: worktree.operationId,
    worktreeId: worktree.worktreeId,
    ownerType: worktree.ownerType,
    ownerId: worktree.ownerId,
    managedPrId: readModel.managedPrId,
    available: worktree.complete,
  };
}

function displayReferenceFromReview(
  readModel: F18ReviewBundleReadModel,
  override?: string,
): string {
  if (
    override !== undefined &&
    validSafeText(override, F19_MAX_DISPLAY_REFERENCE_BYTES)
  )
    return override;
  const repository = readModel.input.pullRequest.baseRepository;
  return `${repository.owner}/${repository.name} (${readModel.managedPrId})`;
}

export function f19ReviewOutcomeFromReadModel(
  readModel: F18ReviewBundleReadModel,
  displayReference?: string,
): F19ReviewBundleOutcome {
  const validationStatus =
    readModel.postChangeValidation?.status ??
    readModel.baselineValidation?.status;
  const result: F19ReviewBundleOutcome = {
    schemaVersion: F19_SCHEMA_VERSION,
    kind: "REVIEW_BUNDLE_OUTCOME",
    outcomeId: readModel.bundleId,
    managedPrId: readModel.managedPrId,
    operationId: readModel.operationId,
    revision: Math.max(1, readModel.version),
    correlationId: readModel.input.correlationId,
    state: readModel.state,
    stage: readModel.stage,
    displayReference: displayReferenceFromReview(readModel, displayReference),
    target: buildF19ReviewBundleTarget(
      readModel.bundleId,
      readModel.managedPrId,
    ),
    decisionSummary: readModel.decisionSummary,
    ...(validationStatus === undefined ? {} : { validationStatus }),
    nextAction: readModel.nextAction,
    ...(readModel.reasons[0]?.code === undefined
      ? {}
      : { reasonCode: readModel.reasons[0].code }),
    ...(worktreeReferenceFromF18(readModel) === undefined
      ? {}
      : { worktree: worktreeReferenceFromF18(readModel) }),
    committed: true,
    ...(readModel.noImplementationChanges === undefined
      ? {}
      : { noImplementationChanges: readModel.noImplementationChanges }),
  };
  return parseF19OutcomeSnapshot(result) as F19ReviewBundleOutcome;
}

export function createF19EffectiveBounds(
  input: F19EffectiveBoundsInput,
): F19EffectiveBounds {
  const values = [
    input.shutdownTimeoutMs,
    input.ipcMaxRequestBytes,
    input.ipcMaxResponseBytes,
    input.activityMaxSummaryBytes,
    input.activityMaxDetailBytes,
    input.persistenceMaxJsonBytes,
    input.persistenceMaxTextBytes,
    input.activationQueueEntries ?? OPEN_TARGET_QUEUE_MAX,
  ];
  if (values.some((value) => !Number.isSafeInteger(value) || value <= 0))
    throw new Error("F19_DELEGATED_BOUND_MISSING");
  return {
    schemaVersion: F19_SCHEMA_VERSION,
    revision: F19_BOUNDS_REVISION,
    trayActionableLimit: F19_TRAY_ACTIONABLE_LIMIT,
    notificationTitleBytes: F19_MAX_NOTIFICATION_TITLE_BYTES,
    notificationBodyBytes: F19_MAX_NOTIFICATION_BODY_BYTES,
    notificationActions: F19_MAX_NOTIFICATION_ACTIONS,
    automaticDeliveryAttempts: F19_MAX_AUTO_DELIVERY_ATTEMPTS,
    activationQueueEntries:
      input.activationQueueEntries ?? OPEN_TARGET_QUEUE_MAX,
    shutdownTimeoutMs: input.shutdownTimeoutMs,
    ipcMaxRequestBytes: input.ipcMaxRequestBytes,
    ipcMaxResponseBytes: input.ipcMaxResponseBytes,
    activityMaxSummaryBytes: input.activityMaxSummaryBytes,
    activityMaxDetailBytes: input.activityMaxDetailBytes,
    persistenceMaxJsonBytes: input.persistenceMaxJsonBytes,
    persistenceMaxTextBytes: input.persistenceMaxTextBytes,
  };
}

function safeDisplay(value: string, maximumBytes: number): string {
  let result = "";
  for (const character of value) {
    const next = result + character;
    if (new TextEncoder().encode(next).byteLength > maximumBytes) break;
    result = next;
  }
  return result;
}

export interface F19NotificationTemplate {
  readonly category: F19NotificationCategory;
  readonly title: string;
  readonly body: string;
}

export type F19NotificationPolicyResult =
  | { readonly outcome: "SUPPRESSED"; readonly reasonCode: string }
  | { readonly outcome: "UNAVAILABLE"; readonly reasonCode: string }
  | {
      readonly outcome: "NOTIFY";
      readonly template: F19NotificationTemplate;
      readonly worktreeAction: boolean;
    };

export function classifyF19Notification(
  outcome: F19OutcomeSnapshot,
  bounds: F19EffectiveBounds,
): F19NotificationPolicyResult {
  if (
    isRecord(outcome) &&
    outcome.kind === "SYNCHRONIZATION_BATCH_OUTCOME" &&
    (outcome.committed !== true || outcome.complete !== true)
  )
    return {
      outcome: "UNAVAILABLE",
      reasonCode: "SYNCHRONIZATION_OUTCOME_INCOMPLETE",
    };
  if (!isF19OutcomeSnapshot(outcome))
    return { outcome: "UNAVAILABLE", reasonCode: "INVALID_OUTCOME" };
  if (outcome.kind === "SYNCHRONIZATION_BATCH_OUTCOME") {
    if (!outcome.committed || !outcome.complete)
      return {
        outcome: "UNAVAILABLE",
        reasonCode: "SYNCHRONIZATION_OUTCOME_INCOMPLETE",
      };
    return {
      outcome: "NOTIFY",
      template: {
        category: "SYNCHRONIZATION_REVIEW",
        title: "Synchronization review ready",
        body: safeDisplay(
          `${outcome.displayReference} has a synchronization result that needs review. Open PRMonitor to inspect it.`,
          bounds.notificationBodyBytes,
        ),
      },
      worktreeAction: false,
    };
  }
  if (outcome.state === "WORKING")
    return { outcome: "SUPPRESSED", reasonCode: "INTERMEDIATE_PROGRESS" };
  if (
    outcome.validationStatus === "failed" ||
    outcome.validationStatus === "interrupted"
  ) {
    const category =
      outcome.validationStatus === "failed"
        ? "VALIDATION_FAILED"
        : "VALIDATION_INTERRUPTED";
    return {
      outcome: "NOTIFY",
      template: {
        category,
        title:
          outcome.validationStatus === "failed"
            ? "Validation failed"
            : "Validation interrupted",
        body: safeDisplay(
          `${outcome.displayReference} needs attention because validation ${outcome.validationStatus}. Open PRMonitor to inspect the deterministic evidence.`,
          bounds.notificationBodyBytes,
        ),
      },
      worktreeAction: outcome.worktree?.available === true,
    };
  }
  if (
    outcome.decisionSummary.questionsNeedingAnswer > 0 ||
    outcome.nextAction.toUpperCase().includes("INPUT")
  ) {
    return {
      outcome: "NOTIFY",
      template: {
        category: "REQUIRED_INPUT",
        title: "Developer input required",
        body: safeDisplay(
          `${outcome.displayReference} has a review question waiting for your answer. Open PRMonitor to inspect it.`,
          bounds.notificationBodyBytes,
        ),
      },
      worktreeAction: outcome.worktree?.available === true,
    };
  }
  if (outcome.state !== "READY_FOR_REVIEW")
    return { outcome: "SUPPRESSED", reasonCode: "NOT_ACTIONABLE" };
  const category =
    outcome.stage === "PROPOSAL_REVIEW"
      ? "PROPOSAL_READY"
      : "FINAL_REVIEW_READY";
  return {
    outcome: "NOTIFY",
    template: {
      category,
      title:
        outcome.stage === "PROPOSAL_REVIEW"
          ? "Review proposal ready"
          : "Final review ready",
      body: safeDisplay(
        `${outcome.displayReference} has a ${
          outcome.stage === "PROPOSAL_REVIEW"
            ? "review proposal"
            : "final review"
        } ready for inspection. Open PRMonitor to review it.`,
        bounds.notificationBodyBytes,
      ),
    },
    worktreeAction: outcome.worktree?.available === true,
  };
}

function semanticStateForCard(card: ManagedPrInboxCard): F19TraySemanticState {
  if (card.primaryState === "READY_FOR_REVIEW") return "READY_FOR_REVIEW";
  if (card.primaryState === "NEEDS_ATTENTION") return "NEEDS_ATTENTION";
  if (card.primaryState === "WORKING") return "WORKING";
  return "WORKING";
}

function statePriority(state: F19TraySemanticState): number {
  if (state === "NEEDS_ATTENTION") return 0;
  if (state === "READY_FOR_REVIEW") return 1;
  if (state === "WORKING") return 2;
  return 3;
}

export function buildF19TrayMenu(input: {
  readonly inbox: ManagedPrInboxReadModel;
  readonly scheduler: F12SchedulerSnapshot;
  readonly outcomes?: readonly F19OutcomeSnapshot[];
  readonly revision: number;
  readonly generatedAt: string;
}): F19TrayMenuModel {
  if (!isManagedPrInboxReadModel(input.inbox))
    throw new Error("F19_INVALID_INBOX_READ_MODEL");
  if (!isF12SchedulerSnapshot(input.scheduler))
    throw new Error("F19_INVALID_SCHEDULER_READ_MODEL");
  const candidates: F19TrayEntry[] = [];
  for (const card of input.inbox.cards) {
    if (card.primaryState === "WATCHING") continue;
    const target = buildF19ManagedPrTarget(card.id);
    candidates.push({
      schemaVersion: F19_SCHEMA_VERSION,
      id: `managed-pr:${card.id}`,
      label: card.reference,
      detail: card.reason.what,
      semanticState: semanticStateForCard(card),
      target,
    });
  }
  for (const outcome of input.outcomes ?? []) {
    if (!isF19OutcomeSnapshot(outcome)) continue;
    const semanticState: F19TraySemanticState =
      outcome.kind === "REVIEW_BUNDLE_OUTCOME"
        ? outcome.state === "NEEDS_ATTENTION"
          ? "NEEDS_ATTENTION"
          : outcome.state === "READY_FOR_REVIEW"
            ? "READY_FOR_REVIEW"
            : "WORKING"
        : outcome.state === "READY_TO_PUBLISH"
          ? "READY_FOR_REVIEW"
          : "NEEDS_ATTENTION";
    if (semanticState === "WORKING" && outcome.kind !== "REVIEW_BUNDLE_OUTCOME")
      continue;
    const id =
      outcome.kind === "REVIEW_BUNDLE_OUTCOME"
        ? `review-bundle:${outcome.outcomeId}`
        : `sync-batch:${outcome.outcomeId}`;
    candidates.push({
      schemaVersion: F19_SCHEMA_VERSION,
      id,
      label: outcome.displayReference,
      detail:
        outcome.kind === "REVIEW_BUNDLE_OUTCOME"
          ? (outcome.reasonCode ?? outcome.nextAction)
          : outcome.state,
      semanticState,
      target: outcome.target,
    });
  }
  const deduplicated = new Map<string, F19TrayEntry>();
  for (const entry of candidates) {
    if (!deduplicated.has(entry.id)) deduplicated.set(entry.id, entry);
  }
  const sorted = [...deduplicated.values()].sort((left, right) => {
    const priority =
      statePriority(left.semanticState) - statePriority(right.semanticState);
    if (priority !== 0) return priority;
    const label =
      left.label < right.label ? -1 : left.label > right.label ? 1 : 0;
    return label !== 0
      ? label
      : left.id < right.id
        ? -1
        : left.id > right.id
          ? 1
          : 0;
  });
  const entries = sorted.slice(0, F19_TRAY_ACTIONABLE_LIMIT);
  return {
    schemaVersion: F19_SCHEMA_VERSION,
    revision: input.revision,
    generatedAt: input.generatedAt,
    needsReviewCount: input.inbox.counts.actionNeeded,
    paused: input.scheduler.pause.paused,
    entries,
    overflowed: sorted.length > F19_TRAY_ACTIONABLE_LIMIT,
    moreTarget: buildF19HomeTarget(),
    commands: {
      open: "Open PRMonitor",
      pauseOrResume: input.scheduler.pause.paused
        ? "Resume Watching"
        : "Pause Watching",
      shutdown: "Shutdown PRMonitor",
    },
  };
}

export const f19NotificationRecordSchema = z
  .object({
    schemaVersion: z.literal(F19_SCHEMA_VERSION),
    notificationId: z.string().regex(IDENTIFIER_PATTERN),
    outcomeId: z.string().regex(IDENTIFIER_PATTERN),
    outcomeKind: z.enum([
      "REVIEW_BUNDLE_OUTCOME",
      "SYNCHRONIZATION_BATCH_OUTCOME",
    ]),
    outcomeRevision: z.number().int().positive(),
    managedPrId: z.string().regex(IDENTIFIER_PATTERN).optional(),
    operationId: z.string().regex(IDENTIFIER_PATTERN).optional(),
    category: z.enum([
      "PROPOSAL_READY",
      "FINAL_REVIEW_READY",
      "REQUIRED_INPUT",
      "VALIDATION_FAILED",
      "VALIDATION_INTERRUPTED",
      "SYNCHRONIZATION_REVIEW",
    ]),
    title: z
      .string()
      .min(1)
      .refine(
        (value) => validSafeText(value, F19_MAX_NOTIFICATION_TITLE_BYTES),
        "F19_UNSAFE_NOTIFICATION_TITLE",
      ),
    body: z
      .string()
      .min(1)
      .refine(
        (value) => validSafeText(value, F19_MAX_NOTIFICATION_BODY_BYTES),
        "F19_UNSAFE_NOTIFICATION_BODY",
      ),
    target: z.unknown().refine(isF19NativeTarget),
    worktree: z.unknown().refine(validWorktreeReference).optional(),
    policyRevision: z.string().regex(IDENTIFIER_PATTERN),
    correlationId: z.string().regex(IDENTIFIER_PATTERN),
    canonicalPayloadHash: z.string().regex(/^[a-f0-9]{64}$/u),
    state: z.enum([
      "PENDING",
      "DELIVERED",
      "DENIED",
      "UNAVAILABLE",
      "FAILED",
      "UNKNOWN",
    ]),
    attemptCount: z
      .number()
      .int()
      .nonnegative()
      .max(F19_MAX_AUTO_DELIVERY_ATTEMPTS),
    reconciliationCount: z
      .number()
      .int()
      .nonnegative()
      .max(F19_MAX_AUTO_DELIVERY_ATTEMPTS),
    lastReasonCode: z.string().regex(IDENTIFIER_PATTERN).optional(),
    createdAt: z.string().min(1).max(128),
    updatedAt: z.string().min(1).max(128),
  })
  .strict();

export const f19ShutdownIntentSchema = z
  .object({
    schemaVersion: z.literal(F19_SCHEMA_VERSION),
    shutdownId: z.string().regex(IDENTIFIER_PATTERN),
    command: z.literal("Shutdown PRMonitor"),
    state: z.enum([
      "REQUESTED",
      "HANDING_OFF",
      "COMPLETED",
      "RECOVERY_REQUIRED",
    ]),
    correlationId: z.string().regex(IDENTIFIER_PATTERN),
    lifecycleCorrelationId: z.string().regex(IDENTIFIER_PATTERN).optional(),
    reasonCode: z.string().regex(IDENTIFIER_PATTERN),
    attemptCount: z.number().int().positive(),
    version: z.number().int().positive(),
    createdAt: z.string().min(1).max(128),
    updatedAt: z.string().min(1).max(128),
  })
  .strict();

export function isF19NotificationRecord(
  value: unknown,
): value is F19NotificationRecord {
  return f19NotificationRecordSchema.safeParse(value).success;
}

export function isF19ShutdownIntentRecord(
  value: unknown,
): value is F19ShutdownIntentRecord {
  return f19ShutdownIntentSchema.safeParse(value).success;
}
