import { createHash, randomUUID } from "node:crypto";
import type {
  F12SchedulerControlResult,
  F12SchedulerSnapshot,
} from "../shared/control-plane";
import type { ActivityWriter } from "./activity-service";
import type {
  F19NativeSurfaceAdapter,
  F19NativeSurfaceCallbacks,
  F19TrayHandle,
  F19TrayTargetActivation,
} from "./f19-native-adapter";
import type { F19NativeSurfacePersistencePort } from "./persistence/f19-repositories";
import type { F13PathActionResult } from "../shared/f13-contracts";
import type { ManagedPrInboxReadModel } from "../shared/inbox";
import type { OpenTarget } from "../shared/routing";
import type { LifecycleStatus } from "../shared/ipc";
import type { F22ActionGate } from "../shared/f22-discard-reevaluation";
import {
  buildF19TrayMenu,
  classifyF19Notification,
  f19NotificationRecordSchema,
  f19ReviewOutcomeFromReadModel,
  isF19OutcomeSnapshot,
  parseF19OutcomeSnapshot,
  type F19EffectiveBounds,
  type F19NativeNotificationRequest,
  type F19NativeDeliveryResult,
  type F19NativeTarget,
  type F19NotificationCategory,
  type F19NotificationRecord,
  type F19OutcomeSnapshot,
  type F19ShutdownIntentRecord,
  type F19TrayCommand,
  type F19TrayMenuModel,
} from "../shared/f19-native-surfaces";
import {
  F19_BOUNDS_REVISION,
  F19_MAX_AUTO_DELIVERY_ATTEMPTS,
  F19_POLICY_REVISION,
  F19_SCHEMA_VERSION,
} from "../shared/f19-native-surfaces";
import type { WindowOpenResult } from "./window-manager";

export interface F19InboxPort {
  readonly read: () => ManagedPrInboxReadModel;
  readonly subscribe?: (
    listener: (snapshot: ManagedPrInboxReadModel) => void,
  ) => () => void;
}

export interface F19SchedulerPort {
  readonly read: () => F12SchedulerSnapshot;
  readonly pauseWatching: (input: {
    readonly requestId: string;
    readonly expectedRevision?: number;
  }) => F12SchedulerControlResult;
  readonly resumeWatching: (input: {
    readonly requestId: string;
    readonly expectedRevision?: number;
  }) => F12SchedulerControlResult;
}

export interface F19WindowPort {
  readonly open: (target?: OpenTarget) => Promise<WindowOpenResult>;
}

export interface F19WorktreePort {
  readonly openWorktree: (input: {
    readonly operationId: string;
  }) => Promise<F13PathActionResult>;
}

export interface F19LifecyclePort {
  readonly requestShutdown: () => Promise<{
    readonly ok: boolean;
    readonly status: LifecycleStatus;
    readonly error?: {
      readonly code: string;
      readonly message: string;
      readonly correlationId: string;
    };
  }>;
}

export interface F19CoordinatorOptions {
  readonly persistence: F19NativeSurfacePersistencePort;
  readonly surface: F19NativeSurfaceAdapter;
  readonly inbox: F19InboxPort;
  readonly scheduler: F19SchedulerPort;
  readonly window: F19WindowPort;
  readonly worktrees?: F19WorktreePort;
  readonly lifecycle: F19LifecyclePort;
  readonly activity?: ActivityWriter;
  readonly bounds: F19EffectiveBounds;
  readonly now?: () => string;
  readonly sessionId?: string;
  readonly outcomes?: () => readonly F19OutcomeSnapshot[];
  readonly onMenuUpdated?: (menu: F19TrayMenuModel) => void;
  readonly exitProcess?: () => void;
}

export interface F19StartResult {
  readonly ok: boolean;
  readonly trayAvailable: boolean;
  readonly reconciledNotifications: number;
  readonly reasonCode?: string;
}

export type F19NotificationResult =
  | {
      readonly outcome: "SUPPRESSED" | "UNAVAILABLE";
      readonly reasonCode: string;
    }
  | {
      readonly outcome: "DELIVERED" | "ALREADY_RECORDED" | "DELIVERY_FAILED";
      readonly record: F19NotificationRecord;
    };

export interface F19ActivationResult {
  readonly ok: boolean;
  readonly outcome:
    "OPENED" | "QUEUED" | "RETRY" | "WORKTREE_OPENED" | "REJECTED";
  readonly reasonCode?: string;
}

export interface F19ShutdownResult {
  readonly ok: boolean;
  readonly status: LifecycleStatus;
  readonly intent: F19ShutdownIntentRecord;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly correlationId: string;
  };
}

function safeIdentifier(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
    ? value
    : "f19-unknown";
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function notificationIdentity(
  outcome: F19OutcomeSnapshot,
  category: F19NotificationCategory,
): string {
  const hash = hashPayload({
    kind: outcome.kind,
    outcomeId: outcome.outcomeId,
    revision: outcome.revision,
    category,
  });
  return `f19-notification-${hash.slice(0, 32)}`;
}

function deliveryRequest(
  record: F19NotificationRecord,
  includeWorktreeAction: boolean,
  fallbackWorktreeText: boolean,
): F19NativeNotificationRequest {
  const body =
    fallbackWorktreeText && record.worktree?.available === true
      ? `${record.body} Open Worktree is available in PRMonitor.`
      : record.body;
  return {
    notificationId: record.notificationId,
    title: record.title,
    body,
    actions: [
      { action: "OPEN_TARGET", label: "Open PRMonitor" },
      ...(includeWorktreeAction
        ? [{ action: "OPEN_WORKTREE" as const, label: "Open Worktree" }]
        : []),
    ],
  };
}

function lifecycleError(
  status: LifecycleStatus,
  error?: F19ShutdownResult["error"],
): F19ShutdownResult["error"] {
  return (
    error ?? {
      code: "HANDOFF_RECOVERY_REQUIRED",
      message: "Shutdown requires lifecycle recovery.",
      correlationId: status.correlationId,
    }
  );
}

function isIncompleteSynchronizationOutcome(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return (
    record.kind === "SYNCHRONIZATION_BATCH_OUTCOME" &&
    (record.committed !== true || record.complete !== true)
  );
}

export class TrayNotificationCoordinator {
  private readonly now: () => string;
  private readonly sessionId: string;
  private readonly callbacks: F19NativeSurfaceCallbacks;
  private tray: F19TrayHandle | undefined;
  private started = false;
  private menuRevision = 0;
  private menu: F19TrayMenuModel | undefined;
  private readonly targetByActivationId = new Map<string, F19NativeTarget>();
  private readonly outcomesByIdentity = new Map<string, F19OutcomeSnapshot>();
  private readonly completedActivations = new Set<string>();
  private unsubscribeInbox: (() => void) | undefined;
  private shutdownWork: Promise<F19ShutdownResult> | undefined;
  private exitRequested = false;

  public constructor(private readonly options: F19CoordinatorOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.sessionId = safeIdentifier(options.sessionId ?? `f19-${randomUUID()}`);
    this.callbacks = {
      onCommand: (command) => {
        void this.handleCommand(command);
      },
      onTarget: (activation) => {
        void this.activate(activation);
      },
    };
    // Fail closed during construction if a caller hands the coordinator a
    // partially populated delegated-bound snapshot.
    if (
      options.bounds.revision !== F19_BOUNDS_REVISION ||
      options.bounds.trayActionableLimit < 1 ||
      options.bounds.activationQueueEntries < 1 ||
      options.bounds.shutdownTimeoutMs < 1
    )
      throw new Error("F19_DELEGATED_BOUND_MISSING");
  }

  public getTrayMenu(): F19TrayMenuModel | undefined {
    return this.menu;
  }

  public getNotification(
    notificationId: string,
  ): F19NotificationRecord | undefined {
    return this.options.persistence.getNotification(notificationId);
  }

  public async start(): Promise<F19StartResult> {
    if (this.started) {
      return {
        ok: true,
        trayAvailable: this.tray !== undefined,
        reconciledNotifications: 0,
      };
    }
    this.started = true;
    let trayAvailable = false;
    let reasonCode: string | undefined;
    try {
      this.tray = this.options.surface.createTray(this.callbacks);
      trayAvailable = true;
      this.emit("OPERATION_PROGRESS", "PROGRESS", "Tray surface created", {
        trayAvailable: true,
      });
    } catch {
      reasonCode = "TRAY_UNAVAILABLE";
      this.emit(
        "OPERATION_FAILED",
        "FAILED",
        "Tray surface unavailable",
        {
          trayAvailable: false,
        },
        "ERROR",
      );
    }
    this.unsubscribeInbox = this.options.inbox.subscribe?.(() => {
      this.refresh();
    });
    this.refresh();
    const reconciledNotifications = await this.reconcilePendingNotifications();
    return {
      ok: reasonCode === undefined,
      trayAvailable,
      reconciledNotifications,
      ...(reasonCode === undefined ? {} : { reasonCode }),
    };
  }

  public stop(): void {
    this.unsubscribeInbox?.();
    this.unsubscribeInbox = undefined;
    this.tray?.destroy();
    this.tray = undefined;
    this.started = false;
  }

  public refresh(): F19TrayMenuModel {
    const inbox = this.options.inbox.read();
    const scheduler = this.options.scheduler.read();
    const configuredOutcomes = this.options.outcomes?.() ?? [];
    const allOutcomes = new Map<string, F19OutcomeSnapshot>();
    for (const outcome of configuredOutcomes) {
      if (isF19OutcomeSnapshot(outcome))
        allOutcomes.set(`${outcome.kind}:${outcome.outcomeId}`, outcome);
    }
    for (const outcome of this.outcomesByIdentity.values())
      allOutcomes.set(`${outcome.kind}:${outcome.outcomeId}`, outcome);
    const menu = buildF19TrayMenu({
      inbox,
      scheduler,
      outcomes: [...allOutcomes.values()],
      revision: ++this.menuRevision,
      generatedAt: this.now(),
    });
    this.menu = menu;
    this.targetByActivationId.clear();
    for (const entry of menu.entries)
      this.targetByActivationId.set(entry.id, entry.target);
    if (menu.overflowed)
      this.targetByActivationId.set("more:home", menu.moreTarget);
    try {
      this.tray?.update(menu);
    } catch {
      this.emit(
        "OPERATION_FAILED",
        "FAILED",
        "Tray menu update failed",
        { revision: menu.revision },
        "WARNING",
      );
    }
    try {
      this.options.onMenuUpdated?.(menu);
    } catch {
      this.emit(
        "OPERATION_FAILED",
        "FAILED",
        "Tray menu observer failed",
        { revision: menu.revision },
        "WARNING",
      );
    }
    return menu;
  }

  public async handleReviewBundleOutcome(
    readModel: Parameters<typeof f19ReviewOutcomeFromReadModel>[0],
    displayReference?: string,
  ): Promise<F19NotificationResult> {
    return this.notifyOutcome(
      f19ReviewOutcomeFromReadModel(readModel, displayReference),
    );
  }

  /**
   * F22 owns freshness and action authority, but F19 owns user-facing
   * attention delivery.  Preserve that boundary by translating only the
   * bounded read model plus gate reason into a notification outcome.
   */
  public async handleF22Gate(
    readModel: Parameters<typeof f19ReviewOutcomeFromReadModel>[0],
    gate: F22ActionGate,
  ): Promise<F19NotificationResult> {
    if (
      gate.status !== "STALE" &&
      gate.status !== "INVALIDATED" &&
      gate.status !== "ATTENTION"
    )
      return { outcome: "SUPPRESSED", reasonCode: "F22_NOT_ATTENTION" };
    const base = f19ReviewOutcomeFromReadModel(readModel);
    const outcome = parseF19OutcomeSnapshot({
      ...base,
      revision: Math.max(base.revision, gate.gateRevision),
      state: "NEEDS_ATTENTION",
      nextAction: "F22_REEVALUATE_INPUT",
      reasonCode: gate.reason?.code ?? "F22_ATTENTION",
    });
    return this.notifyOutcome(outcome);
  }

  public async notifyOutcome(
    rawOutcome: F19OutcomeSnapshot,
  ): Promise<F19NotificationResult> {
    if (isIncompleteSynchronizationOutcome(rawOutcome)) {
      this.emit(
        "OPERATION_PROGRESS",
        "PROGRESS",
        "Synchronization outcome unavailable",
        { reasonCode: "SYNCHRONIZATION_OUTCOME_INCOMPLETE" },
        "WARNING",
      );
      return {
        outcome: "UNAVAILABLE",
        reasonCode: "SYNCHRONIZATION_OUTCOME_INCOMPLETE",
      };
    }
    const outcome = parseF19OutcomeSnapshot(rawOutcome);
    this.outcomesByIdentity.set(
      `${outcome.kind}:${outcome.outcomeId}`,
      outcome,
    );
    this.refresh();
    const policy = classifyF19Notification(outcome, this.options.bounds);
    if (policy.outcome === "SUPPRESSED" || policy.outcome === "UNAVAILABLE") {
      this.emit(
        "OPERATION_PROGRESS",
        "PROGRESS",
        `Notification ${policy.outcome.toLowerCase()}`,
        { outcomeId: outcome.outcomeId, reasonCode: policy.reasonCode },
        policy.outcome === "UNAVAILABLE" ? "WARNING" : "INFO",
        outcome,
      );
      return { outcome: policy.outcome, reasonCode: policy.reasonCode };
    }

    const notificationId = notificationIdentity(
      outcome,
      policy.template.category,
    );
    const canonicalPayloadHash = hashPayload({
      outcome,
      category: policy.template.category,
      policyRevision: F19_POLICY_REVISION,
    });
    const existing = this.options.persistence.findNotification({
      outcomeKind: outcome.kind,
      outcomeId: outcome.outcomeId,
      outcomeRevision: outcome.revision,
      category: policy.template.category,
    });
    if (existing !== undefined) {
      if (existing.canonicalPayloadHash !== canonicalPayloadHash)
        throw new Error("F19_NOTIFICATION_CANONICAL_PAYLOAD_CONFLICT");
      if (existing.state === "DELIVERED")
        return { outcome: "ALREADY_RECORDED", record: existing };
      if (existing.attemptCount >= F19_MAX_AUTO_DELIVERY_ATTEMPTS)
        return { outcome: "ALREADY_RECORDED", record: existing };
      return this.deliverRecord(existing, true, policy.worktreeAction);
    }

    const timestamp = this.now();
    const record = f19NotificationRecordSchema.parse({
      schemaVersion: F19_SCHEMA_VERSION,
      notificationId,
      outcomeId: outcome.outcomeId,
      outcomeKind: outcome.kind,
      outcomeRevision: outcome.revision,
      ...(outcome.kind === "REVIEW_BUNDLE_OUTCOME"
        ? {
            managedPrId: outcome.managedPrId,
            operationId: outcome.operationId,
          }
        : {
            ...(outcome.managedPrId === undefined
              ? {}
              : { managedPrId: outcome.managedPrId }),
            ...(outcome.operationId === undefined
              ? {}
              : { operationId: outcome.operationId }),
          }),
      category: policy.template.category,
      title: policy.template.title,
      body: policy.template.body,
      target: outcome.target,
      ...(outcome.kind === "REVIEW_BUNDLE_OUTCOME" &&
      outcome.worktree !== undefined
        ? { worktree: outcome.worktree }
        : {}),
      policyRevision: F19_POLICY_REVISION,
      correlationId: safeIdentifier(outcome.correlationId),
      canonicalPayloadHash,
      state: "PENDING",
      attemptCount: 0,
      reconciliationCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }) as F19NotificationRecord;
    const committed = this.options.persistence.createNotificationIntent({
      record,
    });
    return this.deliverRecord(committed.record, false, policy.worktreeAction);
  }

  public async activate(
    activation: F19TrayTargetActivation,
  ): Promise<F19ActivationResult> {
    const activationKey = `${activation.activationId}:${activation.action}`;
    if (this.completedActivations.has(activationKey))
      return { ok: true, outcome: "OPENED" };
    if (activation.action === "OPEN_WORKTREE") {
      const notification = this.options.persistence.getNotification(
        activation.activationId,
      );
      if (notification?.worktree?.operationId === undefined) {
        this.emit(
          "NOTIFICATION_FAILED",
          "NOTIFICATION_FAILED",
          "Open Worktree target unavailable",
          { activationId: activation.activationId },
          "WARNING",
        );
        return {
          ok: false,
          outcome: "REJECTED",
          reasonCode: "WORKTREE_REFERENCE_MISSING",
        };
      }
      if (this.options.worktrees === undefined)
        return {
          ok: false,
          outcome: "REJECTED",
          reasonCode: "WORKTREE_PORT_UNAVAILABLE",
        };
      let result: F13PathActionResult;
      try {
        result = await this.options.worktrees.openWorktree({
          operationId: notification.worktree.operationId,
        });
      } catch {
        this.emit(
          "NOTIFICATION_FAILED",
          "NOTIFICATION_FAILED",
          "Operation worktree could not be opened",
          { activationId: activation.activationId },
          "WARNING",
        );
        return {
          ok: false,
          outcome: "RETRY",
          reasonCode: "WORKTREE_OPEN_FAILED",
        };
      }
      this.emit(
        result.ok ? "NOTIFICATION_SENT" : "NOTIFICATION_FAILED",
        result.ok ? "NOTIFICATION_SENT" : "NOTIFICATION_FAILED",
        result.ok
          ? "Operation worktree opened"
          : "Operation worktree could not be opened",
        {
          activationId: activation.activationId,
          operationId: notification.worktree.operationId,
        },
        result.ok ? "INFO" : "WARNING",
      );
      if (result.ok) this.completedActivations.add(activationKey);
      return {
        ok: result.ok,
        outcome: result.ok ? "WORKTREE_OPENED" : "RETRY",
        ...(result.reason?.code === undefined
          ? {}
          : { reasonCode: result.reason.code }),
      };
    }

    const target =
      this.targetByActivationId.get(activation.activationId) ??
      this.options.persistence.getNotification(activation.activationId)?.target;
    if (target === undefined)
      return { ok: false, outcome: "REJECTED", reasonCode: "TARGET_NOT_FOUND" };
    let result: WindowOpenResult;
    try {
      result = await this.options.window.open(target.target);
    } catch {
      this.emit(
        "NOTIFICATION_FAILED",
        "NOTIFICATION_FAILED",
        "Native target remains retryable",
        { activationId: activation.activationId, targetKind: target.kind },
        "WARNING",
      );
      return { ok: false, outcome: "RETRY", reasonCode: "TARGET_OPEN_FAILED" };
    }
    const opened = result.ok || result.targetDelivered > 0;
    if (opened) this.completedActivations.add(activationKey);
    this.emit(
      opened ? "NOTIFICATION_SENT" : "NOTIFICATION_FAILED",
      opened ? "NOTIFICATION_SENT" : "NOTIFICATION_FAILED",
      opened ? "Native target opened" : "Native target remains retryable",
      { activationId: activation.activationId, targetKind: target.kind },
      opened ? "INFO" : "WARNING",
      undefined,
      target.target,
    );
    return {
      ok: opened,
      outcome: opened
        ? result.targetDelivered > 0
          ? "OPENED"
          : "QUEUED"
        : "RETRY",
      ...(result.reasonCode === undefined
        ? {}
        : { reasonCode: result.reasonCode }),
    };
  }

  public async handleCommand(
    command: F19TrayCommand,
  ): Promise<
    | F19ActivationResult
    | F12SchedulerControlResult
    | F19ShutdownResult
    | WindowOpenResult
    | undefined
  > {
    if (command === "OPEN_APP") {
      let result: WindowOpenResult;
      try {
        result = await this.options.window.open();
      } catch {
        this.emit(
          "NOTIFICATION_FAILED",
          "NOTIFICATION_FAILED",
          "PRMonitor window open is retryable",
          { command },
          "WARNING",
        );
        return undefined;
      }
      this.emit(
        result.ok ? "NOTIFICATION_SENT" : "NOTIFICATION_FAILED",
        result.ok ? "NOTIFICATION_SENT" : "NOTIFICATION_FAILED",
        result.ok
          ? "PRMonitor window opened"
          : "PRMonitor window open is retryable",
        { command },
        result.ok ? "INFO" : "WARNING",
      );
      return result;
    }
    if (command === "PAUSE" || command === "RESUME") {
      const snapshot = this.options.scheduler.read();
      const requestId = `f19-${command.toLowerCase()}-${snapshot.schedulerRevision}`;
      let result: F12SchedulerControlResult;
      try {
        result =
          command === "PAUSE"
            ? this.options.scheduler.pauseWatching({ requestId })
            : this.options.scheduler.resumeWatching({ requestId });
      } catch {
        this.emit(
          "OPERATION_FAILED",
          "FAILED",
          command === "PAUSE"
            ? "Watching pause could not be committed"
            : "Watching resume could not be committed",
          { command },
          "WARNING",
        );
        return undefined;
      }
      this.refresh();
      this.emit(
        "OPERATION_PROGRESS",
        "PROGRESS",
        command === "PAUSE"
          ? "Watching pause requested"
          : "Watching resume requested",
        {
          command,
          status: result.status,
          paused: result.snapshot.pause.paused,
        },
      );
      return result;
    }
    return this.requestShutdown();
  }

  public requestShutdown(): Promise<F19ShutdownResult> {
    if (this.shutdownWork !== undefined) return this.shutdownWork;
    const existing = this.options.persistence.getShutdownIntent();
    if (existing?.state === "COMPLETED") {
      const status: LifecycleStatus = {
        schemaVersion: 1,
        phase: "STOPPED",
        sessionId: this.sessionId,
        correlationId:
          existing.lifecycleCorrelationId ?? existing.correlationId,
        startedAt: existing.createdAt,
        updatedAt: existing.updatedAt,
        shutdownCommand: "Shutdown PRMonitor",
        reasonCode: existing.reasonCode,
        incompleteHandoff: false,
      };
      if (!this.exitRequested) {
        try {
          this.tray?.destroy();
          this.tray = undefined;
        } catch {
          return Promise.resolve({
            ok: false,
            status,
            intent: existing,
            error: {
              code: "HANDLER_FAILED",
              message: "The system tray could not be removed safely.",
              correlationId: status.correlationId,
            },
          });
        }
        this.exitRequested = true;
        this.options.exitProcess?.();
      }
      return Promise.resolve({ ok: true, status, intent: existing });
    }
    this.shutdownWork = this.performShutdown(existing);
    void this.shutdownWork.finally(() => {
      this.shutdownWork = undefined;
    });
    return this.shutdownWork;
  }

  private async performShutdown(
    previous: F19ShutdownIntentRecord | undefined,
  ): Promise<F19ShutdownResult> {
    const timestamp = this.now();
    const shutdownId = previous?.shutdownId ?? "application-shutdown";
    const correlationId = safeIdentifier(
      previous?.correlationId ?? `f19-shutdown-${randomUUID()}`,
    );
    const baseVersion = previous?.version ?? 0;
    const requested: F19ShutdownIntentRecord = {
      schemaVersion: F19_SCHEMA_VERSION,
      shutdownId,
      command: "Shutdown PRMonitor",
      state: "REQUESTED",
      correlationId,
      reasonCode: "SHUTDOWN_REQUESTED",
      attemptCount: (previous?.attemptCount ?? 0) + 1,
      version: baseVersion + 1,
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    let intent = this.options.persistence.saveShutdownIntent({
      record: requested,
    });
    this.emit("OPERATION_PROGRESS", "PROGRESS", "Shutdown intent committed", {
      shutdownId,
      attempt: intent.attemptCount,
    });
    const handingOff: F19ShutdownIntentRecord = {
      ...intent,
      state: "HANDING_OFF",
      reasonCode: "SERVICE_HANDOFF_STARTED",
      version: intent.version + 1,
      updatedAt: this.now(),
    };
    intent = this.options.persistence.saveShutdownIntent({
      record: handingOff,
    });
    let lifecycle: Awaited<ReturnType<F19LifecyclePort["requestShutdown"]>>;
    try {
      lifecycle = await this.options.lifecycle.requestShutdown();
    } catch {
      lifecycle = {
        ok: false,
        status: {
          schemaVersion: 1,
          phase: "RECOVERY_REQUIRED",
          sessionId: this.sessionId,
          correlationId: `f19-lifecycle-${randomUUID()}`,
          startedAt: timestamp,
          updatedAt: this.now(),
          shutdownCommand: "Shutdown PRMonitor",
          reasonCode: "HANDOFF_RECOVERY_REQUIRED",
          incompleteHandoff: true,
        },
        error: {
          code: "HANDOFF_RECOVERY_REQUIRED",
          message: "Shutdown lifecycle handoff returned no result.",
          correlationId: this.sessionId,
        },
      };
    }
    if (!lifecycle.ok) {
      const recovery: F19ShutdownIntentRecord = {
        ...intent,
        state: "RECOVERY_REQUIRED",
        reasonCode: lifecycle.error?.code ?? "HANDOFF_RECOVERY_REQUIRED",
        lifecycleCorrelationId: lifecycle.status.correlationId,
        version: intent.version + 1,
        updatedAt: this.now(),
      };
      intent = this.options.persistence.saveShutdownIntent({
        record: recovery,
      });
      this.emit(
        "OPERATION_FAILED",
        "FAILED",
        "Shutdown requires lifecycle recovery",
        { shutdownId, reasonCode: intent.reasonCode },
        "ERROR",
      );
      return {
        ok: false,
        status: lifecycle.status,
        intent,
        error: lifecycleError(lifecycle.status, lifecycle.error),
      };
    }
    try {
      this.tray?.destroy();
      this.tray = undefined;
    } catch {
      const recovery: F19ShutdownIntentRecord = {
        ...intent,
        state: "RECOVERY_REQUIRED",
        reasonCode: "TRAY_REMOVAL_FAILED",
        lifecycleCorrelationId: lifecycle.status.correlationId,
        version: intent.version + 1,
        updatedAt: this.now(),
      };
      intent = this.options.persistence.saveShutdownIntent({
        record: recovery,
      });
      this.emit(
        "OPERATION_FAILED",
        "FAILED",
        "Shutdown requires tray recovery",
        { shutdownId, reasonCode: intent.reasonCode },
        "ERROR",
      );
      return {
        ok: false,
        status: lifecycle.status,
        intent,
        error: {
          code: "HANDLER_FAILED",
          message: "The system tray could not be removed safely.",
          correlationId: lifecycle.status.correlationId,
        },
      };
    }
    const completed: F19ShutdownIntentRecord = {
      ...intent,
      state: "COMPLETED",
      reasonCode: "SHUTDOWN_COMPLETE",
      lifecycleCorrelationId: lifecycle.status.correlationId,
      version: intent.version + 1,
      updatedAt: this.now(),
    };
    intent = this.options.persistence.saveShutdownIntent({ record: completed });
    this.emit(
      "OPERATION_SUCCEEDED",
      "COMPLETED",
      "Shutdown PRMonitor completed",
      {
        shutdownId,
      },
    );
    this.exitRequested = true;
    this.options.exitProcess?.();
    return { ok: true, status: lifecycle.status, intent };
  }

  private async reconcilePendingNotifications(): Promise<number> {
    let reconciled = 0;
    for (const record of this.options.persistence.listPendingNotifications()) {
      if (record.attemptCount >= F19_MAX_AUTO_DELIVERY_ATTEMPTS) continue;
      await this.deliverRecord(
        record,
        true,
        record.worktree?.available === true,
      );
      reconciled += 1;
    }
    return reconciled;
  }

  private async deliverRecord(
    record: F19NotificationRecord,
    reconciliation: boolean,
    includeWorktreeAction: boolean,
  ): Promise<F19NotificationResult> {
    const attemptCount = record.attemptCount + 1;
    if (attemptCount > F19_MAX_AUTO_DELIVERY_ATTEMPTS)
      return { outcome: "ALREADY_RECORDED", record };
    const prepared: F19NotificationRecord = {
      ...record,
      state: "PENDING",
      attemptCount,
      reconciliationCount:
        record.reconciliationCount + (reconciliation ? 1 : 0),
      updatedAt: this.now(),
    };
    const committed = this.options.persistence.updateNotification({
      record: prepared,
    });
    let nativeResult: F19NativeDeliveryResult;
    try {
      const fallback =
        includeWorktreeAction &&
        !this.options.surface.capabilities.notificationActions;
      nativeResult = await this.options.surface.deliverNotification(
        deliveryRequest(
          committed,
          includeWorktreeAction &&
            this.options.surface.capabilities.notificationActions,
          fallback,
        ),
        this.callbacks,
      );
    } catch {
      nativeResult = {
        state: "UNKNOWN",
        reasonCode: "NATIVE_DELIVERY_UNKNOWN",
      };
    }
    const completed: F19NotificationRecord = {
      ...committed,
      state: nativeResult.state,
      updatedAt: this.now(),
      ...(nativeResult.reasonCode === undefined
        ? {}
        : { lastReasonCode: nativeResult.reasonCode }),
    };
    const persisted = this.options.persistence.updateNotification({
      record: completed,
    });
    const success = persisted.state === "DELIVERED";
    this.emit(
      success ? "NOTIFICATION_SENT" : "NOTIFICATION_FAILED",
      success ? "NOTIFICATION_SENT" : "NOTIFICATION_FAILED",
      success
        ? "Native notification delivered"
        : "Native notification not delivered",
      {
        notificationId: persisted.notificationId,
        outcomeId: persisted.outcomeId,
        state: persisted.state,
        attempt: persisted.attemptCount,
      },
      success ? "INFO" : "WARNING",
      undefined,
      persisted.target.target,
    );
    return {
      outcome: success ? "DELIVERED" : "DELIVERY_FAILED",
      record: persisted,
    };
  }

  private emit(
    eventType:
      | "OPERATION_PROGRESS"
      | "OPERATION_SUCCEEDED"
      | "OPERATION_FAILED"
      | "NOTIFICATION_SENT"
      | "NOTIFICATION_FAILED",
    reasonCode:
      | "PROGRESS"
      | "COMPLETED"
      | "FAILED"
      | "NOTIFICATION_SENT"
      | "NOTIFICATION_FAILED",
    summary: string,
    details: Readonly<Record<string, string | number | boolean>>,
    severity: "INFO" | "WARNING" | "ERROR" = "INFO",
    outcome?: F19OutcomeSnapshot,
    relatedTarget?: OpenTarget,
  ): ReturnType<ActivityWriter["append"]> | undefined {
    if (this.options.activity === undefined) return undefined;
    const managedPrId =
      outcome?.kind === "REVIEW_BUNDLE_OUTCOME"
        ? outcome.managedPrId
        : outcome?.managedPrId;
    const operationId =
      outcome?.kind === "REVIEW_BUNDLE_OUTCOME"
        ? outcome.operationId
        : outcome?.operationId;
    try {
      return this.options.activity.append({
        eventId: `f19-activity-${randomUUID()}`,
        eventType,
        stage: "NOTIFICATION",
        correlationId: safeIdentifier(outcome?.correlationId ?? this.sessionId),
        ...(operationId === undefined ? {} : { operationId }),
        ...(managedPrId === undefined ? {} : { managedPrId }),
        occurrenceAt: this.now(),
        severity,
        reason: {
          code: reasonCode,
          what: summary,
          why: "F19 recorded a bounded native-surface projection; the owning workflow remains authoritative.",
          nextAction:
            reasonCode === "FAILED" || reasonCode === "NOTIFICATION_FAILED"
              ? "RETRY"
              : "NONE",
        },
        summary,
        details: { feature: "F19", ...details },
        ...(relatedTarget === undefined ? {} : { relatedTarget }),
      });
    } catch {
      return undefined;
    }
  }
}
