import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ACTIVITY_EVENT_TYPES,
  matchesActivityQuery,
  normalizeActivityEvent,
  normalizeActivityQuery,
  type ActivityEventInput,
  type ActivityQuerySnapshot,
} from "../src/shared/activity";
import {
  activityScope,
  presentActivity,
} from "../src/shared/activity-presentation";
import { initializePersistence } from "../src/main/persistence";
import { ActivityService } from "../src/main/activity-service";
import { ActivityRow } from "../src/renderer/ActivityViewer";
import {
  createActivityReader,
  type ActivityReadState,
} from "../src/renderer/activity-reader";
import type { IpcResponse } from "../src/shared/ipc";

const time = "2026-10-05T00:00:00.000Z";
const poison =
  "F19 owning records remain authoritative LIFECYCLE_RUNNING persistence projection";
const event = (id: string, overrides: Partial<ActivityEventInput> = {}) =>
  normalizeActivityEvent(
    {
      eventId: id,
      eventType: "LEGACY_ACTIVITY",
      stage: "SYSTEM",
      correlationId: "some-session-uuid",
      operationId: "some-operation-uuid",
      occurrenceAt: time,
      severity: "INFO",
      reason: {
        code: "PROGRESS",
        what: poison,
        why: poison,
        nextAction: "NONE",
      },
      summary: poison,
      details: {},
      ...overrides,
    },
    time,
  );
const snapshot = (
  events: ActivityQuerySnapshot["events"],
  query: ActivityQuerySnapshot["query"],
): ActivityQuerySnapshot => ({
  schemaVersion: 1,
  kind: "activity-query",
  generatedAt: time,
  query,
  events,
  hasMore: false,
  retention: {
    policy: { maxAgeDays: 30, maxEvents: 50000, maxBytes: 67108864 },
    protectedCount: 0,
    deletedCount: 0,
  },
});
const response = (value: ActivityQuerySnapshot): IpcResponse => ({
  schemaVersion: 1,
  requestId: "activity-test",
  ok: true,
  value: { kind: "activity-query", snapshot: value },
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("Activity view scope and durable history", () => {
  it("filters before pagination; SQL and subscriptions classify the same records after restart", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "prmonitor-activity-views-"),
    );
    const options = {
      databasePath: path.join(root, "database/prmonitor.sqlite"),
      backupRoot: path.join(root, "backups"),
    };
    let store = await initializePersistence(options);
    try {
      let service = new ActivityService(store, { clock: { now: () => time } });
      const inputs = [
        event("startup", {
          stage: "LIFECYCLE",
          reason: {
            code: "LIFECYCLE_RUNNING",
            what: poison,
            why: poison,
            nextAction: "NONE",
          },
        }),
        event("tray", {
          eventType: "OPERATION_PROGRESS",
          stage: "NOTIFICATION",
          details: { trayAvailable: true },
        }),
        event("unknown"),
        event("pr-removed", { managedPrId: "historical-unmanaged-pr" }),
        event("saved-review", {
          owner: { type: "REVIEW_BUNDLE", id: "saved-bundle" },
        }),
        event("sync", { eventType: "SYNC_STARTED" }),
        ...ACTIVITY_EVENT_TYPES.map((eventType, index) =>
          event(`catalog-${index}`, { eventType }),
        ),
        ...Array.from({ length: 120 }, (_, index) =>
          event(`routine-${String(index).padStart(3, "0")}`, {
            stage: "LIFECYCLE",
          }),
        ),
      ];
      for (const input of inputs) {
        const { recordedAt: _recordedAt, ...appendInput } = input;
        expect(service.append(appendInput).outcome, input.eventId).toBe(
          "inserted",
        );
      }
      for (const view of ["PR_WORK", "APPLICATION", "ALL"] as const) {
        const ids: string[] = [];
        let cursor: string | undefined;
        do {
          const page = service.query({
            view,
            limit: 3,
            cursor,
            direction: "asc",
          });
          ids.push(...page.events.map((item) => item.eventId));
          cursor = page.nextCursor;
        } while (cursor !== undefined);
        const expected = inputs
          .filter((item) => matchesActivityQuery(item, { view }))
          .map((item) => item.eventId)
          .sort();
        expect(ids).toEqual(expected);
        expect(new Set(ids).size).toBe(ids.length);
      }
      expect(
        service
          .query({ view: "PR_WORK", managedPrId: "historical-unmanaged-pr" })
          .events.map((item) => item.eventId),
      ).toEqual(["pr-removed"]);
      expect(
        service
          .query({ view: "PR_WORK" })
          .events.some((item) => item.eventId === "tray"),
      ).toBe(false);
      expect(activityScope(inputs[2]!)).toBe("UNKNOWN");
      store.close();
      store = await initializePersistence(options);
      service = new ActivityService(store);
      expect(service.query({ view: "ALL", limit: 200 }).events).toHaveLength(
        inputs.length,
      );
      expect(service.get("startup")?.reason.what).toBe(poison);
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
  it("rejects invalid view values through the shared IPC query parser", () => {
    expect(() => normalizeActivityQuery({ view: "bad" as "ALL" })).toThrow(
      "unsupported",
    );
    expect(normalizeActivityQuery({ view: "PR_WORK" }).view).toBe("PR_WORK");
  });
});

describe("Closed customer presentation boundary", () => {
  it.each([
    [
      "OPEN_APP",
      "PRMonitor opened its window.",
      "PRMonitor could not open its window.",
    ],
    [
      "OPEN_WORKTREE",
      "PRMonitor opened the worktree folder.",
      "PRMonitor could not open the worktree folder.",
    ],
    [
      "OPEN_TARGET",
      "PRMonitor accepted the request to open the related work.",
      "PRMonitor could not open the related work.",
    ],
    [
      "DELIVER_NOTIFICATION",
      "PRMonitor sent a notification.",
      "PRMonitor could not send a notification.",
    ],
  ])(
    "uses the actual native action for %s",
    (nativeAction, success, failure) => {
      expect(
        presentActivity(
          event("native-success", {
            eventType: "NOTIFICATION_SENT",
            details: { nativeAction },
          }),
        ).summary,
      ).toBe(success);
      expect(
        presentActivity(
          event("native-failure", {
            eventType: "NOTIFICATION_FAILED",
            details: { nativeAction },
          }),
        ).summary,
      ).toBe(failure);
    },
  );
  it("maps only known legacy native actions and does not invent notification delivery", () => {
    expect(
      presentActivity(
        event("legacy-open", {
          eventType: "NOTIFICATION_SENT",
          summary: "PRMonitor window opened",
          details: { command: "OPEN_APP" },
        }),
      ).summary,
    ).toBe("PRMonitor opened its window.");
    expect(
      presentActivity(
        event("legacy-worktree", {
          eventType: "NOTIFICATION_FAILED",
          summary: "Open Worktree target unavailable",
        }),
      ).summary,
    ).toBe("PRMonitor could not open the worktree folder.");
    expect(
      presentActivity(
        event("unknown-native", { eventType: "NOTIFICATION_SENT" }),
      ).summary,
    ).toBe("PRMonitor recorded a native action.");
  });
  it.each(ACTIVITY_EVENT_TYPES)(
    "%s preserves evidence without promoting producer prose",
    (eventType) => {
      const input = event("catalog", { eventType });
      const display = presentActivity(input);
      expect(display.summary).not.toContain(poison);
      expect(JSON.stringify(display)).not.toMatch(
        /\bF\d\d\b|authoritative|projection|owning|LIFECYCLE_RUNNING/,
      );
      const markup = renderToStaticMarkup(
        createElement(ActivityRow, { event: input }),
      );
      const customerProse = markup.split("Raw support data (redacted)")[0];
      expect(customerProse).not.toContain(poison);
      expect(markup).toContain(poison);
      expect(markup).toContain("View event details");
      expect(markup).toContain('tabindex="0"');
    },
  );
  it("states startup, tray, unknown and uncertain outcomes accurately", () => {
    expect(
      presentActivity(
        event("start", {
          reason: {
            code: "LIFECYCLE_RUNNING",
            what: poison,
            why: poison,
            nextAction: "NONE",
          },
        }),
      ),
    ).toEqual({
      summary: "PRMonitor started.",
      explanation: "PRMonitor can keep working when you close this window.",
    });
    expect(
      presentActivity(event("tray", { details: { trayAvailable: true } }))
        .summary,
    ).toBe("PRMonitor icon is ready.");
    expect(
      presentActivity({
        ...event("future"),
        eventType: "FUTURE_TYPE" as "LEGACY_ACTIVITY",
      }).summary,
    ).toBe("PRMonitor recorded an event.");
    expect(
      presentActivity(
        event("uncertain", { eventType: "PUBLICATION_UNKNOWN_OUTCOME" }),
      ).summary,
    ).toBe("The publication outcome is not known.");
    expect(
      presentActivity(
        event("validation", { eventType: "VALIDATION_COMPLETED" }),
      ).summary,
    ).toBe("Validation finished.");
    expect(
      presentActivity(event("routine", { stage: "LIFECYCLE" })).needsAttention,
    ).toBeUndefined();
  });
});

describe("Activity read and live delivery", () => {
  it("rejects stale query replies and live application events in PR work; query replacement clears old state", async () => {
    const first = deferred<IpcResponse>();
    const second = deferred<IpcResponse>();
    const states: ActivityReadState[] = [];
    let count = 0;
    const reader = createActivityReader(
      () => (++count === 1 ? first.promise : second.promise),
      (state) => states.push(state),
    );
    const a = reader.load({ view: "ALL" }, "replace");
    const b = reader.load({ view: "PR_WORK", managedPrId: "pr-b" }, "replace");
    second.resolve(
      response(
        snapshot([event("b", { managedPrId: "pr-b" })], {
          view: "PR_WORK",
          managedPrId: "pr-b",
        }),
      ),
    );
    await b;
    first.resolve(
      response(
        snapshot([event("app", { stage: "LIFECYCLE" })], { view: "ALL" }),
      ),
    );
    await a;
    reader.updated(event("live-app", { stage: "LIFECYCLE" }));
    reader.updated(event("live-a", { managedPrId: "pr-a" }));
    reader.updated(event("live-b", { managedPrId: "pr-b" }));
    expect(states.at(-1)?.snapshot?.events.map((item) => item.eventId)).toEqual(
      ["live-b", "b"],
    );
    reader.dispose();
    reader.updated(event("after-dispose", { managedPrId: "pr-b" }));
    expect(states.at(-1)?.snapshot?.events).toHaveLength(2);
  });
  it("labels only genuine last-known data and does not carry it to another query", async () => {
    let fail = false;
    const states: ActivityReadState[] = [];
    const reader = createActivityReader(
      async (query) => {
        if (fail) throw Error(poison);
        return response(
          snapshot([event("saved", { managedPrId: "pr-a" })], query),
        );
      },
      (state) => states.push(state),
    );
    await reader.load({ view: "PR_WORK" }, "replace");
    fail = true;
    await reader.load({ view: "PR_WORK" });
    expect(states.at(-1)?.lastKnown).toBe(true);
    expect(states.at(-1)?.error).not.toContain(poison);
    await reader.load({ view: "APPLICATION" }, "replace");
    expect(states.at(-1)?.snapshot).toBeUndefined();
    expect(states.at(-1)?.lastKnown).toBe(false);
  });
});
