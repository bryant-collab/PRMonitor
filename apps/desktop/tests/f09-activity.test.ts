import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  activityEventCanonicalHashInput,
  canonicalActivityJson,
  formatWorkItemRef,
  normalizeActivityEvent,
  type ActivityEventInput,
} from "../src/shared/activity";
import {
  IPC_CHANNELS,
  parseIpcRequest,
  type LifecycleStatus,
} from "../src/shared/ipc";
import { ActivityService } from "../src/main/activity-service";
import {
  IpcRouter,
  type IpcMainLike,
  type IpcSenderLike,
} from "../src/main/ipc-router";
import {
  initializePersistence,
  type PersistenceStore,
} from "../src/main/persistence";

const FIRST_TIME = "2026-09-20T12:00:00.000Z";

interface Fixture {
  readonly root: string;
  readonly databasePath: string;
  readonly backupRoot: string;
  readonly store: PersistenceStore;
  readonly service: ActivityService;
  setTime(value: string): void;
  cleanup(): Promise<void>;
}

const fixtures: Fixture[] = [];

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "prmonitor-f09-"));
  const databasePath = path.join(root, "database", "prmonitor.sqlite");
  const backupRoot = path.join(root, "backups");
  let currentTime = FIRST_TIME;
  const store = await initializePersistence(
    { databasePath, backupRoot },
    { clock: { now: () => currentTime }, applicationBuild: "f09-test" },
  );
  const service = new ActivityService(store, {
    clock: { now: () => currentTime },
  });
  const fixture: Fixture = {
    root,
    databasePath,
    backupRoot,
    store,
    service,
    setTime(value) {
      currentTime = value;
    },
    async cleanup() {
      store.close();
      await rm(root, { recursive: true, force: true });
    },
  };
  fixtures.push(fixture);
  return fixture;
}

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (fixture !== undefined) await fixture.cleanup();
  }
});

function event(
  eventId: string,
  overrides: Partial<ActivityEventInput> = {},
): ActivityEventInput {
  return {
    eventId,
    eventType: "POLL_STARTED",
    stage: "POLLING",
    correlationId: "operation-1",
    operationId: "operation-1",
    occurrenceAt: FIRST_TIME,
    severity: "INFO",
    reason: {
      code: "POLL_STARTED",
      what: "Polling started.",
      why: "The main process is checking the configured remote resources.",
      nextAction: "WAIT",
    },
    summary: "Polling started",
    details: { resource: "comments" },
    ...overrides,
  };
}

describe("F09 structured activity contract", () => {
  it("redacts unsafe details, formats supplied work items, and canonicalizes key order", () => {
    const first = normalizeActivityEvent(
      event("event-1", {
        details: {
          zed: "last",
          access_token: "synthetic-value-that-must-not-persist",
          nested: { prompt: "synthetic prompt" },
        },
        workItem: {
          provider: "JIRA",
          namespace: "jira.example.invalid",
          projectKey: "PRM",
          issueNumber: 42,
        },
      }),
      FIRST_TIME,
    );
    const second = normalizeActivityEvent(
      event("event-1", {
        details: {
          nested: { prompt: "different synthetic prompt" },
          access_token: "another-synthetic-value",
          zed: "last",
        },
        workItem: {
          provider: "JIRA",
          namespace: "jira.example.invalid",
          projectKey: "PRM",
          issueNumber: 42,
        },
      }),
      FIRST_TIME,
    );
    expect(first.details).toMatchObject({
      access_token: "[REDACTED]",
      nested: { prompt: "[REDACTED]" },
    });
    expect(JSON.stringify(first.details)).not.toContain("synthetic-value");
    expect(formatWorkItemRef(first.workItem)).toBe("PRM-42");
    expect(canonicalActivityJson(activityEventCanonicalHashInput(first))).toBe(
      canonicalActivityJson(activityEventCanonicalHashInput(second)),
    );
    expect(canonicalActivityJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalActivityJson({ a: { c: 3, d: 4 }, b: 2 }),
    );
    expect(() =>
      normalizeActivityEvent(
        event("event-2", {
          eventType: "NOT_A_REAL_EVENT" as ActivityEventInput["eventType"],
        }),
        FIRST_TIME,
      ),
    ).toThrow("allowlisted");
    expect(() =>
      normalizeActivityEvent(
        {
          ...event("event-3"),
          unsafeProviderValue: "sdk-object",
        } as ActivityEventInput & { unsafeProviderValue: string },
        FIRST_TIME,
      ),
    ).toThrow("unsupported fields");
    expect(() =>
      normalizeActivityEvent(
        event("event-4", {
          workItem: {
            provider: "JIRA",
            namespace: "jira.example.invalid",
            canonicalKey: "token=synthetic-secret",
          },
        }),
        FIRST_TIME,
      ),
    ).toThrow("secret-shaped");
  });

  it("uses provider-neutral GitHub work-item fallback without guessing a Jira key", () => {
    expect(
      formatWorkItemRef({
        provider: "GITHUB",
        namespace: "github.com",
        issueNumber: 4821,
      }),
    ).toBe("#4821");
    expect(
      formatWorkItemRef({
        provider: "GITHUB",
        namespace: "github.com",
        issueNumber: 4821,
        repositoryOwner: "owner",
        repositoryName: "repo",
      }),
    ).toBe("owner/repo#4821");
  });
});

describe("F09 durable writer, query, and retention", () => {
  it("is idempotent, conflict-safe, restart-readable, and cursor-stable", async () => {
    const fixture = await createFixture();
    const first = fixture.service.append(event("event-1"));
    expect(first.outcome).toBe("inserted");
    fixture.setTime("2026-09-20T12:01:00.000Z");
    expect(fixture.service.append(event("event-1")).outcome).toBe("replayed");
    expect(
      fixture.service.append(event("event-1", { summary: "Changed payload" }))
        .outcome,
    ).toBe("conflict");
    expect(
      fixture.service.append(
        event("event-2", { occurrenceAt: "2026-09-20T12:02:00.000Z" }),
      ).outcome,
    ).toBe("inserted");
    expect(
      fixture.service.append(
        event("event-3", {
          occurrenceAt: "2026-09-20T12:03:00.000Z",
          severity: "WARNING",
        }),
      ).outcome,
    ).toBe("inserted");

    const page = fixture.service.query({ limit: 2, direction: "asc" });
    expect(page.events.map((item) => item.eventId)).toEqual([
      "event-1",
      "event-2",
    ]);
    expect(page.nextCursor).toBeDefined();
    const next = fixture.service.query({
      limit: 2,
      direction: "asc",
      cursor: page.nextCursor,
    });
    expect(next.events.map((item) => item.eventId)).toEqual(["event-3"]);
    expect(next.events[0]?.eventId).not.toBe(page.events[1]?.eventId);

    fixture.store.close();
    fixtures.splice(fixtures.indexOf(fixture), 1);
    const reopened = await initializePersistence(
      { databasePath: fixture.databasePath, backupRoot: fixture.backupRoot },
      { clock: { now: () => "2026-09-20T12:04:00.000Z" } },
    );
    const reopenedService = new ActivityService(reopened, {
      clock: { now: () => "2026-09-20T12:04:00.000Z" },
    });
    const afterRestart = reopenedService.query({
      correlationId: "operation-1",
    });
    expect(afterRestart.events).toHaveLength(3);
    reopened.close();
    await rm(fixture.root, { recursive: true, force: true });
  });

  it("filters by operation, stage, severity, work item, and protects active history during retention", async () => {
    const fixture = await createFixture();
    fixture.setTime("2026-09-18T12:00:00.000Z");
    fixture.service.append(
      event("event-old", {
        retention: "USER_ACTIONABLE",
        workItem: {
          provider: "GITHUB",
          namespace: "github.com",
          issueNumber: 4821,
          repositoryOwner: "owner",
          repositoryName: "repo",
        },
      }),
    );
    fixture.setTime("2026-09-19T12:00:00.000Z");
    fixture.service.append(
      event("event-middle", {
        severity: "WARNING",
        stage: "VALIDATION",
        eventType: "VALIDATION_FAILED",
        reason: {
          code: "VALIDATION_FAILED",
          what: "Validation failed.",
          why: "The deterministic command returned a failure.",
          nextAction: "REVIEW",
        },
      }),
    );
    fixture.setTime("2026-09-20T12:00:00.000Z");
    fixture.service.append(
      event("event-new", {
        operationId: "operation-2",
        correlationId: "operation-2",
      }),
    );
    expect(
      fixture.service
        .query({ severity: "WARNING", stage: "VALIDATION" })
        .events.map((item) => item.eventId),
    ).toEqual(["event-middle"]);
    expect(
      fixture.service
        .query({ workItemKey: "owner/repo#4821" })
        .events.map((item) => item.eventId),
    ).toEqual(["event-old"]);
    expect(
      fixture.service.retain({
        maxAgeDays: 30,
        maxEvents: 2,
        maxBytes: 64 * 1024,
      }),
    ).toMatchObject({
      deletedCount: 1,
      protectedCount: 1,
      status: "completed",
    });
    expect(
      fixture.service.query({ limit: 50 }).events.map((item) => item.eventId),
    ).toEqual(["event-new", "event-old"]);
    expect(
      fixture.store.read<{ count: number }>(
        "SELECT COUNT(*) AS count FROM activity_retention_runs",
      )?.count,
    ).toBe(1);
    expect(
      fixture.store.read<{ count: number }>(
        "SELECT COUNT(*) AS count FROM settings",
      )?.count,
    ).toBe(0);
  });

  it("exposes a typed read-only IPC query/subscription and never routes arbitrary targets", async () => {
    const fixture = await createFixture();
    const eventResult = fixture.service.append(
      event("event-route", {
        relatedTarget: {
          schemaVersion: 1,
          kind: "MANAGED_PR",
          id: "managed-pr-1",
          requestId: "route-test",
        },
      }),
    );
    expect(eventResult.outcome).toBe("inserted");
    const ipcMain = new FakeIpcMain();
    const status: LifecycleStatus = {
      schemaVersion: 1,
      phase: "RUNNING",
      sessionId: "session-f09",
      correlationId: "lifecycle-f09",
      startedAt: FIRST_TIME,
      updatedAt: FIRST_TIME,
      incompleteHandoff: false,
    };
    const router = new IpcRouter(ipcMain, {
      readCurrentState: () => ({
        schemaVersion: 1,
        applicationTitle: "PRMonitor",
        lifecycle: status,
        persistence: { status: "healthy", schemaVersion: 6 },
      }),
      getLifecycleStatus: () => status,
      requestShutdown: async () => ({ ok: true, status }),
      readActivity: (query) => fixture.service.query(query),
      navigateActivity: (eventId) => fixture.service.relatedTarget(eventId),
    });
    router.install();
    const sender = new FakeSender(10);
    expect(
      (
        await router.handle(
          {
            schemaVersion: 1,
            requestId: "ready",
            type: "renderer.ready",
            payload: { sessionId: "renderer-f09" },
          },
          sender,
        )
      ).ok,
    ).toBe(true);
    const read = await router.handle(
      {
        schemaVersion: 1,
        requestId: "read",
        type: "activity.query",
        payload: { limit: 10, direction: "desc" },
      },
      sender,
    );
    expect(read).toMatchObject({ ok: true, value: { kind: "activity-query" } });
    const subscription = await router.handle(
      {
        schemaVersion: 1,
        requestId: "sub",
        type: "activity.subscribe",
        payload: { correlationId: "operation-1" },
      },
      sender,
    );
    expect(subscription).toMatchObject({
      ok: true,
      value: { kind: "activity-query" },
    });
    if (eventResult.event === undefined)
      throw new Error("F09_TEST_EVENT_MISSING");
    const delivered = router.publishActivity(eventResult.event);
    expect(delivered).toBe(1);
    expect(
      sender.messages.some(
        (message) => (message as { type?: string }).type === "activity-update",
      ),
    ).toBe(true);
    const navigation = await router.handle(
      {
        schemaVersion: 1,
        requestId: "nav",
        type: "activity.navigate",
        payload: { eventId: "event-route" },
      },
      sender,
    );
    expect(navigation).toMatchObject({
      ok: true,
      value: {
        kind: "activity-navigation",
        target: { kind: "MANAGED_PR", id: "managed-pr-1" },
      },
    });
    expect(
      parseIpcRequest({
        schemaVersion: 1,
        requestId: "bad",
        type: "activity.query",
        payload: { token: "synthetic-value" },
      }).ok,
    ).toBe(false);
    expect(IPC_CHANNELS.event).toContain("event");
  });
});

class FakeSender implements IpcSenderLike {
  public readonly messages: unknown[] = [];
  public constructor(public readonly id: number) {}
  public isDestroyed(): boolean {
    return false;
  }
  public send(_channel: string, payload: unknown): void {
    this.messages.push(payload);
  }
}

class FakeIpcMain implements IpcMainLike {
  public handle(
    _channel: string,
    _listener: (
      event: { readonly sender: IpcSenderLike },
      payload: unknown,
    ) => Promise<unknown>,
  ): void {}
}
