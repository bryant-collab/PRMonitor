import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  F12SchedulerControlResult,
  F12SchedulerSnapshot,
} from "../src/shared/control-plane";
import {
  F12_SCHEMA_VERSION,
  resolveF12SchedulerConfiguration,
} from "../src/shared/control-plane";
import type {
  ManagedPrInboxCard,
  ManagedPrInboxReadModel,
} from "../src/shared/inbox";
import type { PrimaryPrState } from "../src/shared/domain/primary";
import type { LifecycleStatus } from "../src/shared/ipc";
import type { OpenTarget } from "../src/shared/routing";
import {
  buildF19HomeTarget,
  buildF19ManagedPrTarget,
  buildF19ReviewBundleTarget,
  buildF19SynchronizationBatchTarget,
  buildF19TrayMenu,
  classifyF19Notification,
  createF19EffectiveBounds,
  f19NotificationRecordSchema,
  isF19OutcomeSnapshot,
  type F19NativeDeliveryResult,
  type F19NativeNotificationRequest,
  type F19NotificationRecord,
  type F19OutcomeSnapshot,
  type F19ReviewBundleOutcome,
  type F19ShutdownIntentRecord,
  type F19TrayMenuModel,
} from "../src/shared/f19-native-surfaces";
import type {
  F19NativeSurfaceAdapter,
  F19NativeSurfaceCallbacks,
  F19TrayHandle,
} from "../src/main/f19-native-adapter";
import {
  TrayNotificationCoordinator,
  type F19InboxPort,
  type F19LifecyclePort,
  type F19SchedulerPort,
  type F19WindowPort,
  type F19WorktreePort,
} from "../src/main/f19-coordinator";
import {
  F19PersistenceRepositories,
  type F19NativeSurfacePersistencePort,
} from "../src/main/persistence/f19-repositories";
import {
  initializePersistence,
  type PersistenceStore,
} from "../src/main/persistence";
import type { F13PathActionResult } from "../src/shared/f13-contracts";
import type { WindowOpenResult } from "../src/main/window-manager";

const TIME = "2026-09-25T12:00:00.000Z";
const bounds = createF19EffectiveBounds({
  shutdownTimeoutMs: 30_000,
  ipcMaxRequestBytes: 64 * 1024,
  ipcMaxResponseBytes: 512 * 1024,
  activityMaxSummaryBytes: 512,
  activityMaxDetailBytes: 8 * 1024,
  persistenceMaxJsonBytes: 512 * 1024,
  persistenceMaxTextBytes: 2_048,
});

const roots: string[] = [];
const stores: PersistenceStore[] = [];

function schedulerSnapshot(paused = false, revision = 1): F12SchedulerSnapshot {
  return {
    schemaVersion: F12_SCHEMA_VERSION,
    schedulerRevision: revision,
    configuration: resolveF12SchedulerConfiguration(),
    pause: {
      schemaVersion: F12_SCHEMA_VERSION,
      paused,
      revision,
      changedAt: TIME,
      actor: "SYSTEM",
      requestId: "initial",
      automaticDispatchBlocked: paused,
      readOnlyPollingPermitted: true,
    },
    slots: [],
    pollRequests: [],
    pendingBatches: [],
    dispatchIntents: [],
    updatedAt: TIME,
  };
}

function card(
  id: string,
  primaryState: PrimaryPrState,
  number: number,
): ManagedPrInboxCard {
  const reason =
    primaryState === "READY_FOR_REVIEW"
      ? {
          code: "READY_FOR_REVIEW",
          what: "Review work is ready for inspection.",
          why: "A persisted review result is waiting for an explicit decision.",
          nextAction: "OPEN_DETAILS" as const,
        }
      : primaryState === "NEEDS_ATTENTION"
        ? {
            code: "NEEDS_ATTENTION",
            what: "Review work needs attention.",
            why: "The persisted review operation stopped before completion.",
            nextAction: "OPEN_DETAILS" as const,
          }
        : primaryState === "WORKING"
          ? {
              code: "WORKING",
              what: "PRMonitor is working on this pull request.",
              why: "A persisted operation is active.",
              nextAction: "WAIT" as const,
            }
          : {
              code: "WATCHING",
              what: "Watching this pull request.",
              why: "No persisted review action is waiting.",
              nextAction: "NONE" as const,
            };
  return {
    schemaVersion: 1,
    id,
    pullRequestKey: `${id}:pull-request`,
    number,
    reference: `owner/repo #${number}`,
    repository: {
      serverId: "server-1",
      key: "owner/repo",
      owner: "owner",
      name: "repo",
    },
    baseRepositoryKey: "owner/repo",
    headRepositoryKey: "owner/repo",
    primaryState,
    stateUpdatedAt: TIME,
    localSetupStatus: "VALID",
    reason,
  };
}

function inbox(
  cards: readonly ManagedPrInboxCard[] = [],
): ManagedPrInboxReadModel {
  const actionNeeded = cards.filter(
    (item) =>
      item.primaryState === "READY_FOR_REVIEW" ||
      item.primaryState === "NEEDS_ATTENTION",
  );
  const working = cards.filter((item) => item.primaryState === "WORKING");
  const watching = cards.filter((item) => item.primaryState === "WATCHING");
  return {
    schemaVersion: 1,
    kind: "managed-pr-inbox",
    version: 1,
    generatedAt: TIME,
    cards,
    groups: [
      {
        id: "ACTION_NEEDED",
        label: "Action needed",
        cardIds: actionNeeded.map((item) => item.id),
        count: actionNeeded.length,
      },
      {
        id: "WORKING",
        label: "Working",
        cardIds: working.map((item) => item.id),
        count: working.length,
      },
      {
        id: "WATCHING",
        label: "Watching",
        cardIds: watching.map((item) => item.id),
        count: watching.length,
      },
    ],
    counts: {
      total: cards.length,
      actionNeeded: actionNeeded.length,
      working: working.length,
      watching: watching.length,
    },
  };
}

function reviewOutcome(
  input: {
    readonly outcomeId?: string;
    readonly managedPrId?: string;
    readonly operationId?: string;
    readonly revision?: number;
    readonly state?: F19ReviewBundleOutcome["state"];
    readonly stage?: F19ReviewBundleOutcome["stage"];
    readonly questionsNeedingAnswer?: number;
    readonly validationStatus?: F19ReviewBundleOutcome["validationStatus"];
    readonly worktree?: F19ReviewBundleOutcome["worktree"];
    readonly nextAction?: string;
  } = {},
): F19ReviewBundleOutcome {
  const outcomeId = input.outcomeId ?? "bundle-1";
  const managedPrId = input.managedPrId ?? "pr-1";
  const operationId = input.operationId ?? "operation-1";
  const questionsNeedingAnswer = input.questionsNeedingAnswer ?? 0;
  const state = input.state ?? "READY_FOR_REVIEW";
  const result: F19ReviewBundleOutcome = {
    schemaVersion: 1,
    kind: "REVIEW_BUNDLE_OUTCOME",
    outcomeId,
    managedPrId,
    operationId,
    revision: input.revision ?? 1,
    correlationId: `correlation-${outcomeId}`,
    state,
    stage: input.stage ?? "PROPOSAL_REVIEW",
    displayReference: `owner/repo (${managedPrId})`,
    target: buildF19ReviewBundleTarget(outcomeId, managedPrId),
    decisionSummary: {
      total: 2,
      decided: questionsNeedingAnswer === 0 ? 2 : 1,
      questionsNeedingAnswer,
      complete: questionsNeedingAnswer === 0,
    },
    nextAction: input.nextAction ?? "OPEN_DETAILS",
    committed: true,
    ...(input.validationStatus === undefined
      ? {}
      : { validationStatus: input.validationStatus }),
    ...(input.worktree === undefined ? {} : { worktree: input.worktree }),
  };
  if (!isF19OutcomeSnapshot(result)) throw new Error("invalid test outcome");
  return result;
}

function synchronizationOutcome(): F19OutcomeSnapshot {
  return {
    schemaVersion: 1,
    kind: "SYNCHRONIZATION_BATCH_OUTCOME",
    outcomeId: "sync-batch-1",
    managedPrId: "pr-1",
    operationId: "sync-operation-1",
    revision: 1,
    correlationId: "sync-correlation-1",
    state: "READY_TO_PUBLISH",
    displayReference: "owner/repo #1",
    target: buildF19SynchronizationBatchTarget("sync-batch-1", "pr-1"),
    summary: {
      readyToPublish: 1,
      needsAttention: 0,
      stale: 0,
      failed: 0,
    },
    authoritativeReference: "sync-result-1",
    complete: true,
    committed: true,
  };
}

function notificationRecord(
  outcome: F19ReviewBundleOutcome = reviewOutcome(),
): F19NotificationRecord {
  return {
    schemaVersion: 1,
    notificationId: "notification-1",
    outcomeId: outcome.outcomeId,
    outcomeKind: outcome.kind,
    outcomeRevision: outcome.revision,
    managedPrId: outcome.managedPrId,
    operationId: outcome.operationId,
    category: "PROPOSAL_READY",
    title: "Review proposal ready",
    body: "A review proposal is ready for inspection.",
    target: outcome.target,
    ...(outcome.worktree === undefined ? {} : { worktree: outcome.worktree }),
    policyRevision: "f19-notification-policy-v1",
    correlationId: outcome.correlationId,
    canonicalPayloadHash: "a".repeat(64),
    state: "PENDING",
    attemptCount: 0,
    reconciliationCount: 0,
    createdAt: TIME,
    updatedAt: TIME,
  };
}

function lifecycleStatus(
  phase: LifecycleStatus["phase"] = "STOPPED",
): LifecycleStatus {
  return {
    schemaVersion: 1,
    phase,
    sessionId: "lifecycle-session",
    correlationId: "lifecycle-correlation",
    startedAt: TIME,
    updatedAt: TIME,
    shutdownCommand: phase === "RUNNING" ? undefined : "Shutdown PRMonitor",
    reasonCode:
      phase === "STOPPED" ? "SHUTDOWN_COMPLETE" : "HANDOFF_RECOVERY_REQUIRED",
    incompleteHandoff: phase === "RECOVERY_REQUIRED",
  };
}

function memoryPersistence(): F19NativeSurfacePersistencePort & {
  readonly notifications: Map<string, F19NotificationRecord>;
  readonly shutdowns: Map<string, F19ShutdownIntentRecord>;
} {
  const notifications = new Map<string, F19NotificationRecord>();
  const shutdowns = new Map<string, F19ShutdownIntentRecord>();
  return {
    notifications,
    shutdowns,
    getNotification: (notificationId) => notifications.get(notificationId),
    findNotification: (input) =>
      [...notifications.values()].find(
        (record) =>
          record.outcomeKind === input.outcomeKind &&
          record.outcomeId === input.outcomeId &&
          record.outcomeRevision === input.outcomeRevision &&
          record.category === input.category,
      ),
    createNotificationIntent: ({ record }) => {
      const existing =
        notifications.get(record.notificationId) ??
        [...notifications.values()].find(
          (candidate) =>
            candidate.outcomeKind === record.outcomeKind &&
            candidate.outcomeId === record.outcomeId &&
            candidate.outcomeRevision === record.outcomeRevision &&
            candidate.category === record.category,
        );
      if (existing !== undefined) return { created: false, record: existing };
      notifications.set(record.notificationId, record);
      return { created: true, record };
    },
    updateNotification: ({ record }) => {
      notifications.set(record.notificationId, record);
      return record;
    },
    listPendingNotifications: () =>
      [...notifications.values()].filter(
        (record) => record.state === "PENDING" || record.state === "UNKNOWN",
      ),
    getShutdownIntent: (shutdownId = "application-shutdown") =>
      shutdowns.get(shutdownId),
    saveShutdownIntent: ({ record }) => {
      const current = shutdowns.get(record.shutdownId);
      if (current !== undefined && current.version >= record.version)
        return current;
      shutdowns.set(record.shutdownId, record);
      return record;
    },
  };
}

class FakeSurface implements F19NativeSurfaceAdapter {
  public readonly capabilities = {
    tray: true,
    notifications: true,
    notificationActions: true,
  };
  public readonly requests: F19NativeNotificationRequest[] = [];
  public readonly updates: F19TrayMenuModel[] = [];
  public trayCreated = 0;
  public trayDestroyed = 0;
  public callbacks: F19NativeSurfaceCallbacks | undefined;
  public beforeDelivery:
    ((request: F19NativeNotificationRequest) => void) | undefined;
  public readonly deliveryResults: F19NativeDeliveryResult[] = [];
  public throwOnTray = false;

  public createTray(callbacks: F19NativeSurfaceCallbacks): F19TrayHandle {
    if (this.throwOnTray) throw new Error("tray unavailable");
    this.callbacks = callbacks;
    this.trayCreated += 1;
    let destroyed = false;
    return {
      id: `fake-tray-${this.trayCreated}`,
      update: (model) => this.updates.push(model),
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        this.trayDestroyed += 1;
      },
    };
  }

  public deliverNotification(
    request: F19NativeNotificationRequest,
    _callbacks: F19NativeSurfaceCallbacks,
  ): Promise<F19NativeDeliveryResult> {
    this.requests.push(request);
    this.beforeDelivery?.(request);
    return Promise.resolve(
      this.deliveryResults.shift() ?? { state: "DELIVERED" },
    );
  }
}

function windowPort(): F19WindowPort & {
  readonly calls: (OpenTarget | undefined)[];
  result: WindowOpenResult;
} {
  const calls: (OpenTarget | undefined)[] = [];
  return {
    calls,
    result: {
      ok: true,
      outcome: "created",
      rendererReady: false,
      targetDelivered: 0,
    },
    open: async (target) => {
      calls.push(target);
      return {
        ok: true,
        outcome: "created",
        rendererReady: false,
        targetDelivered: 0,
      };
    },
  };
}

function schedulerPort(): F19SchedulerPort & {
  readonly pauseCalls: string[];
  readonly resumeCalls: string[];
  getSnapshot(): F12SchedulerSnapshot;
} {
  let snapshot = schedulerSnapshot();
  const pauseCalls: string[] = [];
  const resumeCalls: string[] = [];
  const control = (
    kind: F12SchedulerControlResult["kind"],
    requestId: string,
    paused: boolean,
  ): F12SchedulerControlResult => {
    snapshot = schedulerSnapshot(paused, snapshot.schedulerRevision + 1);
    return {
      schemaVersion: F12_SCHEMA_VERSION,
      kind,
      requestId,
      status: "ACCEPTED",
      snapshot,
    };
  };
  return {
    pauseCalls,
    resumeCalls,
    getSnapshot: () => snapshot,
    read: () => snapshot,
    pauseWatching: ({ requestId }) => {
      pauseCalls.push(requestId);
      return control("PAUSE_WATCHING", requestId, true);
    },
    resumeWatching: ({ requestId }) => {
      resumeCalls.push(requestId);
      return control("RESUME_WATCHING", requestId, false);
    },
  };
}

function inboxPort(initial: ManagedPrInboxReadModel): F19InboxPort & {
  set(next: ManagedPrInboxReadModel): void;
} {
  let current = initial;
  const listeners = new Set<(snapshot: ManagedPrInboxReadModel) => void>();
  return {
    read: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next) => {
      current = next;
      for (const listener of listeners) listener(next);
    },
  };
}

function worktreePort(): F19WorktreePort & {
  readonly calls: { readonly operationId: string }[];
} {
  const calls: { readonly operationId: string }[] = [];
  return {
    calls,
    openWorktree: async (input) => {
      calls.push(input);
      const result: F13PathActionResult = {
        ok: true,
        action: "OPEN_WORKTREE",
        resolvedPath: "C:\\owned\\worktree",
      };
      return result;
    },
  };
}

function lifecyclePort(
  request: () => Promise<
    ReturnType<F19LifecyclePort["requestShutdown"]> extends Promise<infer T>
      ? T
      : never
  >,
): F19LifecyclePort {
  return { requestShutdown: request };
}

function coordinatorFixture(
  input: {
    readonly inbox?: ManagedPrInboxReadModel;
    readonly persistence?: F19NativeSurfacePersistencePort;
    readonly surface?: FakeSurface;
    readonly scheduler?: ReturnType<typeof schedulerPort>;
    readonly window?: ReturnType<typeof windowPort>;
    readonly worktrees?: F19WorktreePort;
    readonly lifecycle?: F19LifecyclePort;
  } = {},
): {
  readonly coordinator: TrayNotificationCoordinator;
  readonly persistence: F19NativeSurfacePersistencePort;
  readonly surface: FakeSurface;
  readonly scheduler: ReturnType<typeof schedulerPort>;
  readonly window: ReturnType<typeof windowPort>;
  readonly inbox: ReturnType<typeof inboxPort>;
} {
  const persistence = input.persistence ?? memoryPersistence();
  const surface = input.surface ?? new FakeSurface();
  const scheduler = input.scheduler ?? schedulerPort();
  const window = input.window ?? windowPort();
  const inboxProjection = inboxPort(input.inbox ?? inbox());
  const lifecycle =
    input.lifecycle ??
    lifecyclePort(async () => ({
      ok: true,
      status: lifecycleStatus(),
    }));
  const coordinator = new TrayNotificationCoordinator({
    persistence,
    surface,
    inbox: inboxProjection,
    scheduler,
    window,
    ...(input.worktrees === undefined ? {} : { worktrees: input.worktrees }),
    lifecycle,
    bounds,
    now: () => TIME,
    sessionId: "f19-test-session",
  });
  return {
    coordinator,
    persistence,
    surface,
    scheduler,
    window,
    inbox: inboxProjection,
  };
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("F19 native-surface contracts", () => {
  it("builds allowlisted targets and rejects path, URL, command, and secret-shaped input", () => {
    expect(buildF19HomeTarget().target).toEqual({
      schemaVersion: 1,
      kind: "HOME",
      requestId: expect.any(String),
    });
    expect(buildF19ManagedPrTarget("pr-1").target.kind).toBe("MANAGED_PR");
    expect(buildF19ReviewBundleTarget("bundle-1", "pr-1").target.kind).toBe(
      "REVIEW_BUNDLE",
    );
    expect(
      buildF19SynchronizationBatchTarget("sync-batch-1", "pr-1").target.kind,
    ).toBe("SYNCHRONIZATION_BATCH");
    expect(() => buildF19ManagedPrTarget("../developer-clone")).toThrow(
      "F19_INVALID_MANAGED_PR_ID",
    );
    expect(() => buildF19ManagedPrTarget("https://example.invalid")).toThrow(
      "F19_INVALID_MANAGED_PR_ID",
    );
    const unsafeOutcome = {
      ...reviewOutcome(),
      displayReference: "C:\\developer-clone\\.env token=secret",
    };
    expect(isF19OutcomeSnapshot(unsafeOutcome)).toBe(false);
    expect(
      isF19OutcomeSnapshot({ ...reviewOutcome(), arbitraryPath: "C:\\clone" }),
    ).toBe(false);
    expect(() =>
      f19NotificationRecordSchema.parse({
        ...notificationRecord(),
        body: "token=secret",
      }),
    ).toThrow("F19_UNSAFE_NOTIFICATION_BODY");
    expect(() =>
      f19NotificationRecordSchema.parse({
        ...notificationRecord(),
        secret: "never-persist",
      }),
    ).toThrow();
  });

  it("keeps tray projection bounded and deterministic for empty, full, and overflow inputs", () => {
    const empty = buildF19TrayMenu({
      inbox: inbox(),
      scheduler: schedulerSnapshot(),
      revision: 1,
      generatedAt: TIME,
    });
    expect(empty.entries).toHaveLength(0);
    expect(empty.overflowed).toBe(false);
    expect(empty.commands.pauseOrResume).toBe("Pause Watching");

    const tenCards = Array.from({ length: 10 }, (_, index) =>
      card(
        `pr-${index + 1}`,
        index === 0 ? "NEEDS_ATTENTION" : "WORKING",
        index + 1,
      ),
    );
    const ten = buildF19TrayMenu({
      inbox: inbox(tenCards),
      scheduler: schedulerSnapshot(true, 2),
      revision: 2,
      generatedAt: TIME,
    });
    expect(ten.entries).toHaveLength(10);
    expect(ten.overflowed).toBe(false);
    expect(ten.paused).toBe(true);
    expect(ten.commands.pauseOrResume).toBe("Resume Watching");
    expect(ten.entries[0]?.semanticState).toBe("NEEDS_ATTENTION");

    const eleven = buildF19TrayMenu({
      inbox: inbox([...tenCards, card("pr-11", "READY_FOR_REVIEW", 11)]),
      scheduler: schedulerSnapshot(),
      revision: 3,
      generatedAt: TIME,
    });
    expect(eleven.entries).toHaveLength(10);
    expect(eleven.overflowed).toBe(true);
    expect(eleven.moreTarget.kind).toBe("HOME");
    expect(eleven.entries.map((entry) => entry.id)).toEqual(
      buildF19TrayMenu({
        inbox: inbox([...tenCards, card("pr-11", "READY_FOR_REVIEW", 11)]),
        scheduler: schedulerSnapshot(),
        revision: 4,
        generatedAt: TIME,
      }).entries.map((entry) => entry.id),
    );
  });

  it("classifies only typed actionable outcomes and suppresses routine progress", () => {
    expect(
      classifyF19Notification(reviewOutcome({ state: "WORKING" }), bounds),
    ).toEqual({
      outcome: "SUPPRESSED",
      reasonCode: "INTERMEDIATE_PROGRESS",
    });
    expect(
      classifyF19Notification(
        reviewOutcome({ stage: "PROPOSAL_REVIEW" }),
        bounds,
      ),
    ).toMatchObject({
      outcome: "NOTIFY",
      template: { category: "PROPOSAL_READY" },
    });
    expect(
      classifyF19Notification(
        reviewOutcome({ stage: "FINAL_REVIEW", revision: 2 }),
        bounds,
      ),
    ).toMatchObject({
      outcome: "NOTIFY",
      template: { category: "FINAL_REVIEW_READY" },
    });
    expect(
      classifyF19Notification(
        reviewOutcome({
          questionsNeedingAnswer: 1,
          nextAction: "ANSWER_INPUT",
        }),
        bounds,
      ),
    ).toMatchObject({
      outcome: "NOTIFY",
      template: { category: "REQUIRED_INPUT" },
    });
    expect(
      classifyF19Notification(
        reviewOutcome({ validationStatus: "failed", state: "NEEDS_ATTENTION" }),
        bounds,
      ),
    ).toMatchObject({
      outcome: "NOTIFY",
      template: { category: "VALIDATION_FAILED" },
    });
    expect(
      classifyF19Notification(
        reviewOutcome({
          validationStatus: "interrupted",
          state: "NEEDS_ATTENTION",
        }),
        bounds,
      ),
    ).toMatchObject({
      outcome: "NOTIFY",
      template: { category: "VALIDATION_INTERRUPTED" },
    });
    expect(
      classifyF19Notification(synchronizationOutcome(), bounds),
    ).toMatchObject({
      outcome: "NOTIFY",
      template: { category: "SYNCHRONIZATION_REVIEW" },
    });
    expect(
      classifyF19Notification(
        {
          ...synchronizationOutcome(),
          complete: false,
        } as unknown as F19OutcomeSnapshot,
        bounds,
      ),
    ).toEqual({
      outcome: "UNAVAILABLE",
      reasonCode: "SYNCHRONIZATION_OUTCOME_INCOMPLETE",
    });
  });
});

describe("F19 persistence and coordinator", () => {
  it("persists notification and shutdown intents across a database restart", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "prmonitor-f19-"));
    roots.push(root);
    const databasePath = path.join(root, "database", "prmonitor.sqlite");
    const backupRoot = path.join(root, "backups");
    const store = await initializePersistence(
      { databasePath, backupRoot },
      { clock: { now: () => TIME }, applicationBuild: "f19-test" },
    );
    stores.push(store);
    expect(store.health.schemaVersion).toBe(14);
    const first = new F19PersistenceRepositories(store, {
      clock: { now: () => TIME },
    });
    const pending = notificationRecord();
    expect(first.createNotificationIntent({ record: pending }).created).toBe(
      true,
    );
    const shutdown: F19ShutdownIntentRecord = {
      schemaVersion: 1,
      shutdownId: "application-shutdown",
      command: "Shutdown PRMonitor",
      state: "HANDING_OFF",
      correlationId: "shutdown-correlation",
      reasonCode: "SERVICE_HANDOFF_STARTED",
      attemptCount: 1,
      version: 1,
      createdAt: TIME,
      updatedAt: TIME,
    };
    first.saveShutdownIntent({ record: shutdown });
    store.close();
    stores.splice(stores.indexOf(store), 1);

    const restarted = await initializePersistence(
      { databasePath, backupRoot },
      { clock: { now: () => TIME }, applicationBuild: "f19-test-restart" },
    );
    stores.push(restarted);
    const second = new F19PersistenceRepositories(restarted, {
      clock: { now: () => TIME },
    });
    expect(second.getNotification(pending.notificationId)).toEqual(pending);
    expect(second.listPendingNotifications()).toEqual([pending]);
    expect(second.getShutdownIntent()).toEqual(shutdown);

    const runtime = coordinatorFixture({
      persistence: second,
      surface: new FakeSurface(),
    });
    await runtime.coordinator.start();
    expect(
      await runtime.coordinator.notifyOutcome(
        reviewOutcome({ outcomeId: "bundle-runtime" }),
      ),
    ).toMatchObject({ outcome: "DELIVERED" });
  });

  it("keeps the tray alive without a renderer and routes pause through F12", async () => {
    const fixture = coordinatorFixture({
      inbox: inbox([card("pr-1", "WORKING", 1)]),
    });
    const started = await fixture.coordinator.start();
    expect(started).toMatchObject({ ok: true, trayAvailable: true });
    expect(fixture.surface.trayCreated).toBe(1);
    expect(fixture.window.calls).toHaveLength(0);
    expect(fixture.coordinator.getTrayMenu()?.entries[0]?.id).toBe(
      "managed-pr:pr-1",
    );

    await fixture.coordinator.handleCommand("PAUSE");
    await fixture.coordinator.handleCommand("RESUME");
    expect(fixture.scheduler.pauseCalls).toHaveLength(1);
    expect(fixture.scheduler.resumeCalls).toHaveLength(1);
    expect(fixture.coordinator.getTrayMenu()?.commands.pauseOrResume).toBe(
      "Pause Watching",
    );
    fixture.coordinator.stop();
    expect(fixture.surface.trayDestroyed).toBe(1);
  });

  it("commits the delivery intent before the native effect and deduplicates by outcome revision", async () => {
    const persistence = memoryPersistence();
    const surface = new FakeSurface();
    let stateBeforeEffect: F19NotificationRecord["state"] | undefined;
    surface.beforeDelivery = (request) => {
      stateBeforeEffect = persistence.getNotification(
        request.notificationId,
      )?.state;
    };
    const fixture = coordinatorFixture({ persistence, surface });
    await fixture.coordinator.start();

    const first = await fixture.coordinator.notifyOutcome(reviewOutcome());
    expect(first.outcome).toBe("DELIVERED");
    expect(stateBeforeEffect).toBe("PENDING");
    expect(surface.requests).toHaveLength(1);
    expect(surface.requests[0]?.actions).toEqual([
      { action: "OPEN_TARGET", label: "Open PRMonitor" },
    ]);
    const duplicate = await fixture.coordinator.notifyOutcome(reviewOutcome());
    expect(duplicate.outcome).toBe("ALREADY_RECORDED");
    expect(surface.requests).toHaveLength(1);
    expect(
      await fixture.coordinator.notifyOutcome(reviewOutcome({ revision: 2 })),
    ).toMatchObject({ outcome: "DELIVERED" });
    expect(
      await fixture.coordinator.notifyOutcome(
        reviewOutcome({
          outcomeId: "bundle-2",
          managedPrId: "pr-2",
          operationId: "operation-2",
        }),
      ),
    ).toMatchObject({ outcome: "DELIVERED" });
    expect(surface.requests).toHaveLength(3);
  });

  it("reconciles one uncertain delivery after restart and stops at the automatic retry bound", async () => {
    const persistence = memoryPersistence();
    const firstSurface = new FakeSurface();
    firstSurface.deliveryResults.push({
      state: "UNKNOWN",
      reasonCode: "NATIVE_RESULT_UNKNOWN",
    });
    const first = coordinatorFixture({ persistence, surface: firstSurface });
    await first.coordinator.start();
    const initial = await first.coordinator.notifyOutcome(reviewOutcome());
    expect(initial).toMatchObject({
      outcome: "DELIVERY_FAILED",
      record: { attemptCount: 1, state: "UNKNOWN" },
    });
    first.coordinator.stop();

    const secondSurface = new FakeSurface();
    const second = coordinatorFixture({ persistence, surface: secondSurface });
    const restarted = await second.coordinator.start();
    expect(restarted.reconciledNotifications).toBe(1);
    expect(persistence.listPendingNotifications()).toHaveLength(0);
    expect(
      persistence.getNotification(
        (initial as { record: F19NotificationRecord }).record.notificationId,
      ),
    ).toMatchObject({
      attemptCount: 2,
      state: "DELIVERED",
      reconciliationCount: 1,
    });

    const boundedPersistence = memoryPersistence();
    const unknownSurface = new FakeSurface();
    unknownSurface.deliveryResults.push(
      { state: "UNKNOWN", reasonCode: "NATIVE_RESULT_UNKNOWN" },
      { state: "UNKNOWN", reasonCode: "NATIVE_RESULT_UNKNOWN" },
    );
    const bounded = coordinatorFixture({
      persistence: boundedPersistence,
      surface: unknownSurface,
    });
    await bounded.coordinator.start();
    await bounded.coordinator.notifyOutcome(
      reviewOutcome({ outcomeId: "bundle-bound" }),
    );
    bounded.coordinator.stop();
    const boundedRestart = coordinatorFixture({
      persistence: boundedPersistence,
      surface: unknownSurface,
    });
    expect(
      (await boundedRestart.coordinator.start()).reconciledNotifications,
    ).toBe(1);
    boundedRestart.coordinator.stop();
    const finalRestart = coordinatorFixture({
      persistence: boundedPersistence,
      surface: unknownSurface,
    });
    expect(
      (await finalRestart.coordinator.start()).reconciledNotifications,
    ).toBe(0);
    expect(boundedPersistence.listPendingNotifications()[0]).toMatchObject({
      attemptCount: 2,
      reconciliationCount: 1,
      state: "UNKNOWN",
    });
  });

  it("opens validated targets at most once and sends only operation identity to F13", async () => {
    const worktrees = worktreePort();
    const fixture = coordinatorFixture({ worktrees });
    await fixture.coordinator.start();
    const menuActivation = await fixture.coordinator.activate({
      activationId: "managed-pr:pr-1",
      action: "OPEN_TARGET",
    });
    expect(menuActivation).toMatchObject({ ok: false, outcome: "REJECTED" });

    const menuFixture = coordinatorFixture({
      inbox: inbox([card("pr-1", "READY_FOR_REVIEW", 1)]),
      worktrees,
    });
    await menuFixture.coordinator.start();
    expect(
      await menuFixture.coordinator.activate({
        activationId: "managed-pr:pr-1",
        action: "OPEN_TARGET",
      }),
    ).toMatchObject({ ok: true, outcome: "QUEUED" });
    await menuFixture.coordinator.activate({
      activationId: "managed-pr:pr-1",
      action: "OPEN_TARGET",
    });
    expect(menuFixture.window.calls).toHaveLength(1);
    expect(menuFixture.window.calls[0]).toMatchObject({
      kind: "MANAGED_PR",
      id: "pr-1",
    });

    const outcome = reviewOutcome({
      worktree: {
        operationId: "operation-1",
        worktreeId: "worktree-1",
        ownerType: "REVIEW_BUNDLE",
        ownerId: "bundle-1",
        managedPrId: "pr-1",
        available: true,
      },
    });
    const delivered = await menuFixture.coordinator.notifyOutcome(outcome);
    expect(delivered.outcome).toBe("DELIVERED");
    const notificationId = (delivered as { record: F19NotificationRecord })
      .record.notificationId;
    expect(
      await menuFixture.coordinator.activate({
        activationId: notificationId,
        action: "OPEN_WORKTREE",
      }),
    ).toMatchObject({ ok: true, outcome: "WORKTREE_OPENED" });
    expect(worktrees.calls).toEqual([{ operationId: "operation-1" }]);
  });

  it("keeps the tray and committed diagnostic state when shutdown handoff fails, then completes on retry", async () => {
    const persistence = memoryPersistence();
    const surface = new FakeSurface();
    let lifecycleCalls = 0;
    let observedIntentState: F19ShutdownIntentRecord["state"] | undefined;
    const lifecycle = lifecyclePort(async () => {
      lifecycleCalls += 1;
      observedIntentState = persistence.getShutdownIntent()?.state;
      if (lifecycleCalls === 1)
        return {
          ok: false,
          status: lifecycleStatus("RECOVERY_REQUIRED"),
          error: {
            code: "SERVICE_HANDOFF_TIMEOUT",
            message: "The bounded service handoff timed out.",
            correlationId: "lifecycle-correlation",
          },
        };
      return { ok: true, status: lifecycleStatus() };
    });
    const fixture = coordinatorFixture({ persistence, surface, lifecycle });
    let exits = 0;
    const coordinator = new TrayNotificationCoordinator({
      persistence,
      surface,
      inbox: inboxPort(inbox()),
      scheduler: schedulerPort(),
      window: windowPort(),
      lifecycle,
      bounds,
      now: () => TIME,
      sessionId: "f19-shutdown-session",
      exitProcess: () => {
        exits += 1;
      },
    });
    await coordinator.start();
    const first = coordinator.requestShutdown();
    const duplicate = coordinator.requestShutdown();
    expect(first).toBe(duplicate);
    const failed = await first;
    expect(failed.ok).toBe(false);
    expect(observedIntentState).toBe("HANDING_OFF");
    expect(persistence.getShutdownIntent()).toMatchObject({
      state: "RECOVERY_REQUIRED",
      reasonCode: "SERVICE_HANDOFF_TIMEOUT",
    });
    expect(surface.trayDestroyed).toBe(0);
    expect(exits).toBe(0);

    const completed = await coordinator.requestShutdown();
    expect(completed.ok).toBe(true);
    expect(persistence.getShutdownIntent()).toMatchObject({
      state: "COMPLETED",
      reasonCode: "SHUTDOWN_COMPLETE",
    });
    expect(surface.trayDestroyed).toBe(1);
    expect(exits).toBe(1);
    expect(lifecycleCalls).toBe(2);
    expect((await coordinator.requestShutdown()).ok).toBe(true);
    expect(surface.trayDestroyed).toBe(1);
    expect(exits).toBe(1);
    fixture.coordinator.stop();
  });
});
