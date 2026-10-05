import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, it } from "vitest";
import {
  initializePersistence,
  F28RecoveryRepositories,
} from "../src/main/persistence";
import { ActivityService } from "../src/main/activity-service";
import { activityScope } from "../src/shared/activity-presentation";
import { recoveryActivityAttribution } from "../src/shared/recovery-attribution";
import type { ActivityEventInput } from "../src/shared/activity";
import {
  matchesActivityQuery,
  normalizeActivityQuery,
} from "../src/shared/activity";
import type { F28RecoveryScopeInput } from "../src/shared/f28-recovery";

const time = "2026-10-05T12:00:00.000Z";
it("empty application checks stay out of PR history; legacy recovery scopes retain the historical PR association", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "prmonitor-recovery-attribution-"),
  );
  const options = {
    databasePath: path.join(root, "database", "prmonitor.sqlite"),
    backupRoot: path.join(root, "backups"),
  };
  const clock = { now: () => time };
  let store = await initializePersistence(options, { clock });
  try {
    const recovery = new F28RecoveryRepositories(store, { clock });
    const session = recovery.createOrGetSession({
      sessionId: "session-attribution",
      requestKey: "request-attribution",
      trigger: "startup",
      lifecycle: {
        schemaVersion: 1,
        applicationSessionId: "app-attribution",
        lifecyclePhase: "RUNNING",
        rendererAttached: true,
        explicitShutdown: false,
        online: true,
        wallClockAt: time,
        monotonicNowMs: 0,
      },
    }).session;
    const activity = new ActivityService(store, { clock });
    const scopes: readonly (readonly [string, F28RecoveryScopeInput])[] = [
      [
        "empty",
        {
          schemaVersion: 1,
          kind: "ai_operation",
          id: "ai-work",
          owner: "f28-ai",
          stage: "AI",
        },
      ],
      [
        "historical",
        {
          schemaVersion: 1,
          kind: "publication",
          id: "unmanaged-pr",
          owner: "f28-review-publication",
          stage: "REVIEW_PUBLICATION",
        },
      ],
    ];
    for (const [id, scope] of scopes) {
      const persisted = recovery.putScope(scope, session.sessionId);
      const legacy: ActivityEventInput = {
        eventId: id,
        eventType: "OPERATION_PROGRESS",
        stage: "LIFECYCLE",
        correlationId: session.sessionId,
        operationId: persisted.scopeKey,
        occurrenceAt: time,
        severity: "INFO",
        reason: {
          code: "PROGRESS",
          what: "Recorded original reason",
          why: "Recorded original explanation",
          nextAction: "NONE",
        },
        summary: "Original producer summary",
        details: { f28Event: "CLASSIFIED", f28Classification: "COMPLETED" },
      };
      expect(activity.append(legacy).outcome).toBe("inserted");
      expect(
        activityScope({
          ...legacy,
          ...recoveryActivityAttribution(scope),
          schemaVersion: 1,
          recordedAt: time,
          details: legacy.details ?? {},
          retention: "NONE",
        }),
      ).toBe(id === "empty" ? "APPLICATION" : "PR_WORK");
    }
    expect(
      activity
        .query({ view: "PR_WORK", managedPrId: "unmanaged-pr", limit: 1 })
        .events.map((event) => event.eventId),
    ).toEqual(["historical"]);
    expect(
      activity
        .query({ view: "APPLICATION" })
        .events.map((event) => event.eventId),
    ).toEqual(["empty"]);
    const original = store.read(
      "SELECT details_json, payload_json FROM activity_events WHERE activity_event_id = ?",
      "historical",
    );
    store.close();
    store = await initializePersistence(options, { clock });
    const reopened = new ActivityService(store, { clock });
    const events = reopened.query({
      view: "PR_WORK",
      managedPrId: "unmanaged-pr",
    }).events;
    expect(events[0]?.managedPrId).toBe("unmanaged-pr");
    expect(events[0]?.summary).toBe("Original producer summary");
    expect(activityScope(events[0]!)).toBe("PR_WORK");
    for (const query of [
      { ownerType: "MANAGED_PR", ownerId: "unmanaged-pr", limit: 1 },
      { ownerType: "APPLICATION", ownerId: "ai-work", limit: 1 },
    ]) {
      const page = reopened.query(query);
      expect(page.events).toHaveLength(1);
      expect(
        matchesActivityQuery(page.events[0]!, normalizeActivityQuery(query)),
      ).toBe(true);
    }
    expect(
      reopened.query({ ownerType: "publication", ownerId: "unmanaged-pr" })
        .events,
    ).toEqual([]);
    expect(
      store.read(
        "SELECT details_json, payload_json FROM activity_events WHERE activity_event_id = ?",
        "historical",
      ),
    ).toEqual(original);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
