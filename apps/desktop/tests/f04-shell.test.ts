import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  IPC_CHANNELS,
  parseIpcRequest,
  type CurrentState,
  type LifecycleStatus,
} from "../src/shared/ipc";
import {
  OpenTargetQueue,
  parseOpenTarget,
  parseOpenTargetRecord,
} from "../src/shared/routing";
import {
  IpcRouter,
  type IpcMainLike,
  type IpcSenderLike,
} from "../src/main/ipc-router";
import {
  PrimaryInstanceCoordinator,
  type SingleInstanceHost,
} from "../src/main/instance-routing";
import {
  createPersistenceLifecyclePersistence,
  LifecycleCoordinator,
  type LifecyclePersistence,
} from "../src/main/lifecycle";
import {
  WindowManager,
  type ManagedWindowLike,
} from "../src/main/window-manager";
import type {
  WindowFocusResult,
  WindowPlatformAdapter,
} from "../src/main/platform-window";
import {
  createPersistenceRepositories,
  initializePersistence,
} from "../src/main/persistence";

function lifecycleStatus(
  phase: LifecycleStatus["phase"] = "RUNNING",
): LifecycleStatus {
  return {
    schemaVersion: 1,
    phase,
    sessionId: "session-test",
    correlationId: "lifecycle-test",
    startedAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
    incompleteHandoff: phase === "RECOVERY_REQUIRED",
  };
}

describe("F04 open-target and IPC contracts", () => {
  it("accepts only bounded provider-neutral view targets", () => {
    expect(parseOpenTarget("prmonitor://home").ok).toBe(true);
    const pullRequest = parseOpenTarget("prmonitor://pr/managed-123");
    expect(pullRequest.ok && pullRequest.value.kind).toBe("MANAGED_PR");
    expect(parseOpenTarget("prmonitor://pr/managed-123?token=secret").ok).toBe(
      false,
    );
    expect(parseOpenTarget("prmonitor://pr/C:/worktree").ok).toBe(false);
    expect(parseOpenTarget("https://example.invalid/pr/1").ok).toBe(false);
    expect(parseOpenTarget(`prmonitor://pr/${"x".repeat(128)}`).ok).toBe(true);
    expect(parseOpenTarget(`prmonitor://pr/${"x".repeat(129)}`).ok).toBe(false);
  });

  it("deduplicates targets by launch identity and validates normalized records", () => {
    const parsed = parseOpenTarget("prmonitor://review-bundle/bundle-1");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const queue = new OpenTargetQueue();
    expect(queue.enqueue(parsed.value)).toBe(true);
    expect(queue.enqueue(parsed.value)).toBe(false);
    expect(parseOpenTargetRecord(queue.dequeue()).ok).toBe(true);
  });

  it("rejects unknown or secret-shaped IPC before a service can run", () => {
    expect(
      parseIpcRequest({
        schemaVersion: 1,
        requestId: "request-1",
        type: "unknown",
        payload: {},
      }).ok,
    ).toBe(false);
    expect(
      parseIpcRequest({
        schemaVersion: 1,
        requestId: "request-2",
        type: "app.read-current-state",
        payload: { token: "never-forward" },
      }).ok,
    ).toBe(false);
    expect(
      parseIpcRequest({
        schemaVersion: 1,
        requestId: "request-3",
        type: "lifecycle.shutdown",
        payload: { command: "Quit" },
      }).ok,
    ).toBe(false);
  });
});

class FakeSender implements IpcSenderLike {
  public readonly messages: unknown[] = [];
  public destroyed = false;

  public constructor(public readonly id: number) {}

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  public send(_channel: string, payload: unknown): void {
    this.messages.push(payload);
  }
}

class FakeIpcMain implements IpcMainLike {
  public handler:
    | ((
        event: { readonly sender: IpcSenderLike },
        payload: unknown,
      ) => Promise<unknown>)
    | undefined;

  public handle(
    _channel: string,
    listener: (
      event: { readonly sender: IpcSenderLike },
      payload: unknown,
    ) => Promise<unknown>,
  ): void {
    this.handler = listener;
  }
}

describe("F04 validated IPC router", () => {
  it("keeps work session-scoped and delivers typed targets only to a live renderer", async () => {
    const ipcMain = new FakeIpcMain();
    const status = lifecycleStatus();
    const state: CurrentState = {
      schemaVersion: 1,
      applicationTitle: "PRMonitor",
      lifecycle: status,
      persistence: { status: "healthy", schemaVersion: 2 },
    };
    let serviceCalls = 0;
    const router = new IpcRouter(ipcMain, {
      readCurrentState: () => {
        serviceCalls += 1;
        return state;
      },
      getLifecycleStatus: () => status,
      requestShutdown: async () => ({ ok: true, status }),
    });
    router.install();
    const sender = new FakeSender(7);
    const beforeReady = await router.handle(
      {
        schemaVersion: 1,
        requestId: "request-1",
        type: "app.read-current-state",
        payload: {},
      },
      sender,
    );
    expect(beforeReady.ok).toBe(false);
    expect(serviceCalls).toBe(0);
    const ready = await router.handle(
      {
        schemaVersion: 1,
        requestId: "request-2",
        type: "renderer.ready",
        payload: { sessionId: "renderer-test" },
      },
      sender,
    );
    expect(ready.ok).toBe(true);
    const read = await router.handle(
      {
        schemaVersion: 1,
        requestId: "request-3",
        type: "app.read-current-state",
        payload: {},
      },
      sender,
    );
    expect(read.ok).toBe(true);
    expect(serviceCalls).toBe(1);
    const target = parseOpenTarget("prmonitor://review-bundle/bundle-1");
    expect(target.ok).toBe(true);
    if (!target.ok) return;
    expect(router.deliverOpenTarget(sender.id, target.value)).toBe(true);
    expect(sender.messages).toHaveLength(1);
    expect(sender.messages[0]).toMatchObject({
      schemaVersion: 1,
      type: "open-target",
    });
    sender.destroyed = true;
    expect(router.deliverOpenTarget(sender.id, target.value)).toBe(false);
    expect(IPC_CHANNELS.event).toContain("prmonitor:ipc:v1:event");
  });
});

class FakeWindow extends EventEmitter implements ManagedWindowLike {
  private readonly contentState = { destroyed: false };
  public focused = false;
  public readonly messages: unknown[] = [];
  public readonly webContents: {
    readonly id: number;
    send(channel: string, payload: unknown): void;
  };

  public constructor() {
    super();
    const contentState = this.contentState;
    this.webContents = {
      get id() {
        if (contentState.destroyed) throw new Error("WEB_CONTENTS_DESTROYED");
        return 1;
      },
      send: (_channel: string, payload: unknown) => this.messages.push(payload),
    };
  }

  public isDestroyed(): boolean {
    return this.contentState.destroyed;
  }
  public isFocused(): boolean {
    return this.focused;
  }
  public show(): void {
    this.focused = true;
  }
  public focus(): void {
    this.focused = true;
  }
  public close(): void {
    this.contentState.destroyed = true;
    this.emit("closed");
  }
  public destroy(): void {
    this.contentState.destroyed = true;
    this.emit("closed");
  }
  public async loadFile(_file: string): Promise<void> {}
}

class FakePlatform implements WindowPlatformAdapter {
  public readonly platform = "win32";
  public readonly focusTimeoutMs = 100;
  public outcome: WindowFocusResult = {
    outcome: "focused",
    activeDesktopId: "desktop-test",
  };
  public focuses = 0;

  public async focus(window: {
    isDestroyed(): boolean;
    isFocused(): boolean;
    show(): void;
    focus(): void;
  }): Promise<WindowFocusResult> {
    this.focuses += 1;
    if (this.outcome.outcome !== "focus-denied") {
      window.show();
      window.focus();
    }
    return this.outcome;
  }
}

describe("F04 on-demand window manager", () => {
  it("coalesces open requests, recreates after close, and does not retain a hidden window", async () => {
    const platform = new FakePlatform();
    const windows: FakeWindow[] = [];
    const manager = new WindowManager({
      rendererEntry: "renderer.html",
      preloadEntry: "preload.mjs",
      platform,
      createWindow: () => {
        const window = new FakeWindow();
        windows.push(window);
        queueMicrotask(() => manager.markRendererReady(window.webContents.id));
        return window;
      },
      sendTarget: (contents, target) => {
        contents.send(IPC_CHANNELS.event, target);
        return true;
      },
    });
    const target = parseOpenTarget("prmonitor://pr/pr-1");
    expect(target.ok).toBe(true);
    if (!target.ok) return;
    const first = manager.open(target.value);
    const second = manager.open(target.value);
    expect(await first).toMatchObject({
      ok: true,
      outcome: "created",
      targetDelivered: 1,
    });
    expect(await second).toMatchObject({ ok: true, outcome: "created" });
    expect(windows).toHaveLength(1);
    windows[0]?.close();
    expect(manager.visibleWindow).toBeUndefined();
    const reopened = manager.open();
    expect(await reopened).toMatchObject({ ok: true, outcome: "created" });
    expect(windows).toHaveLength(2);
  });

  it("reports focus denial without dropping the process or queued target", async () => {
    const platform = new FakePlatform();
    platform.outcome = { outcome: "focus-denied", reasonCode: "DENIED" };
    const manager = new WindowManager({
      rendererEntry: "renderer.html",
      preloadEntry: "preload.mjs",
      platform,
      createWindow: () => {
        const window = new FakeWindow();
        queueMicrotask(() => manager.markRendererReady(window.webContents.id));
        return window;
      },
      sendTarget: () => true,
    });
    const target = parseOpenTarget("prmonitor://review-bundle/bundle-2");
    expect(target.ok).toBe(true);
    if (!target.ok) return;
    const result = await manager.open(target.value);
    expect(result).toMatchObject({
      ok: false,
      reasonCode: "DENIED",
      targetDelivered: 0,
    });
    expect(manager.visibleWindow).toBeDefined();
    expect(platform.focuses).toBe(1);
  });
});

describe("F04 lifecycle and single-instance ownership", () => {
  it("persists lifecycle status through the F03 repository boundary", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "prmonitor-f04-lifecycle-"),
    );
    const store = await initializePersistence({
      databasePath: path.join(root, "database", "prmonitor.sqlite"),
      backupRoot: path.join(root, "backups"),
    });
    try {
      const repositories = createPersistenceRepositories(store);
      const recorder = createPersistenceLifecyclePersistence(repositories);
      const lifecycle = new LifecycleCoordinator({
        persistence: recorder,
        sessionId: "session-persistence-test",
      });
      const started = await lifecycle.start();
      if (!started.ok) throw new Error(JSON.stringify(started));
      expect(repositories.getSetting("f04.lifecycle")?.payload).toMatchObject({
        phase: "RUNNING",
      });
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists shutdown intent before service handoff and makes repeated shutdown idempotent", async () => {
    let current: LifecycleStatus | undefined;
    const writes: string[] = [];
    const persistence: LifecyclePersistence = {
      read: () => current,
      write: (status, reason) => {
        current = status;
        writes.push(reason);
      },
    };
    let handoffStartedAfterIntent = false;
    const lifecycle = new LifecycleCoordinator({
      persistence,
      now: () => "2026-09-20T00:00:00.000Z",
      sessionId: "session-test",
      services: [
        {
          name: "fake-worker",
          handoff: () => {
            handoffStartedAfterIntent = writes.includes(
              "SHUTDOWN_INTENT_COMMITTED",
            );
          },
        },
      ],
    });
    expect((await lifecycle.start()).ok).toBe(true);
    const first = lifecycle.requestShutdown();
    const second = lifecycle.requestShutdown();
    expect(first).toBe(second);
    const result = await first;
    expect(result.ok).toBe(true);
    expect(result.status.phase).toBe("STOPPED");
    expect(handoffStartedAfterIntent).toBe(true);
    expect(writes).toContain("SHUTDOWN_INTENT_COMMITTED");
  });

  it("routes secondary launch data to the primary queue and quits a competing owner", () => {
    const events = new Map<string, (...args: readonly unknown[]) => void>();
    const queue = new OpenTargetQueue();
    const host: SingleInstanceHost = {
      requestSingleInstanceLock: () => true,
      on: (event, listener) => {
        events.set(event, listener);
        return host;
      },
      quit: () => undefined,
    };
    const coordinator = new PrimaryInstanceCoordinator({ host, queue });
    expect(
      coordinator.acquire(["electron", "prmonitor://review-bundle/bundle-3"]),
    ).toBe(true);
    events.get("second-instance")?.(
      {},
      ["electron", "prmonitor://review-bundle/bundle-3"],
      "cwd",
    );
    expect(queue.size).toBe(1);

    let quitCalls = 0;
    const competingHost: SingleInstanceHost = {
      requestSingleInstanceLock: () => false,
      on: () => competingHost,
      quit: () => {
        quitCalls += 1;
      },
    };
    expect(
      new PrimaryInstanceCoordinator({
        host: competingHost,
        queue: new OpenTargetQueue(),
      }).acquire([]),
    ).toBe(false);
    expect(quitCalls).toBe(1);
  });
});
