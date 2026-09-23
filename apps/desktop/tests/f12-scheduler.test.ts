import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createF07PersistenceRepositories,
  createPersistenceRepositories,
  F12PersistenceRepositories,
  initializePersistence,
  type PersistenceStore,
} from "../src/main/persistence";
import {
  ReviewScheduler,
  type F12EligibilityBoundary,
} from "../src/main/review-scheduler";
import type {
  F11ClaimView,
  F11EvaluateResult,
} from "../src/main/f11-eligibility-service";
import type { F10PollRunResult } from "../src/main/pr-polling-contracts";
import type { ManagedPrReadModel } from "../src/shared/managed-pr";
import {
  DEFAULT_F12_INTERVAL_MS,
  DEFAULT_F12_QUIET_PERIOD_MS,
  MIN_F12_INTERVAL_MS,
  resolveF12SchedulerConfiguration,
} from "../src/shared/control-plane";
import { parseIpcRequest, parseIpcResponse } from "../src/shared/ipc";

const TIME = "2026-09-22T12:00:00.000Z";
const roots: string[] = [];
const stores: PersistenceStore[] = [];

async function fixture(): Promise<{
  readonly root: string;
  readonly store: PersistenceStore;
  readonly f03: ReturnType<typeof createPersistenceRepositories>;
  readonly f07: ReturnType<typeof createF07PersistenceRepositories>;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "prmonitor-f12-"));
  roots.push(root);
  const store = await initializePersistence(
    {
      databasePath: path.join(root, "database", "prmonitor.sqlite"),
      backupRoot: path.join(root, "backups"),
    },
    { clock: { now: () => TIME }, applicationBuild: "f12-test" },
  );
  stores.push(store);
  const f03 = createPersistenceRepositories(store, {
    clock: { now: () => TIME },
  });
  f03.putGithubServer({
    serverId: "server-1",
    host: "github.example.invalid",
    apiBaseUrl: "https://github.example.invalid/api/v3",
  });
  f03.putRepository({
    repositoryId: "repo-base",
    serverId: "server-1",
    owner: "owner",
    name: "repo",
    defaultBranch: "main",
  });
  f03.putRepository({
    repositoryId: "repo-head",
    serverId: "server-1",
    owner: "head-owner",
    name: "repo",
    defaultBranch: "main",
  });
  const addPr = (managedPrId: string, number: number): void => {
    f03.putManagedPr({
      managedPrId,
      serverId: "server-1",
      baseRepositoryId: "repo-base",
      headRepositoryId: "repo-head",
      number,
      baseBranch: "main",
      headBranch: "feature",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      state: "WATCHING",
    });
  };
  addPr("pr-1", 1);
  addPr("pr-2", 2);
  return { root, store, f03, f07: createF07PersistenceRepositories(store) };
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

function addEvent(
  f03: ReturnType<typeof createPersistenceRepositories>,
  managedPrId: string,
  eventVersionId: string,
): void {
  f03.insertRemoteEventVersion({
    id: eventVersionId,
    managedPrId,
    sourceKind: "REVIEW_COMMENT",
    sourceId: eventVersionId,
    sourceRepositoryId: "repo-base",
    observedAt: TIME,
    semanticHash: "a".repeat(63) + eventVersionId.slice(-1),
    payload: { schemaVersion: 1 },
  });
}

function pollResult(
  managedPrId: string,
  eventVersionIds: readonly string[] = [],
): F10PollRunResult {
  return {
    pollRunId: "f10-poll-result",
    correlationId: "f10-correlation",
    status: "COMPLETED",
    resources: [
      {
        attemptId: "f10-attempt",
        pollRunId: "f10-poll-result",
        managedPrId,
        resource: "pull_request",
        resourceKey: "resource-key",
        status: "COMPLETED",
        eventVersionIds,
        newEventVersionIds: eventVersionIds,
        newVersionCount: eventVersionIds.length,
      },
    ],
    newVersionIds: eventVersionIds,
    newSemanticInputCount: eventVersionIds.length,
    activityDegraded: false,
    startedAt: TIME,
    completedAt: TIME,
  };
}

function managedPrModel(managedPrId: string): ManagedPrReadModel {
  return {
    schemaVersion: 1,
    id: managedPrId,
    canonicalUrl: `https://github.example.invalid/owner/repo/pull/${managedPrId}`,
    pullRequestKey: `${managedPrId}:pull-request`,
    serverId: "server-1",
    owner: "owner",
    repositoryName: "repo",
    number: 1,
    state: "OPEN",
    merged: false,
    baseRepository: {} as ManagedPrReadModel["baseRepository"],
    headRepository: {} as ManagedPrReadModel["headRepository"],
    prBaseBranch: "main",
    prHeadBranch: "feature",
    prBaseSha: "a".repeat(40),
    prHeadSha: "b".repeat(40),
    primaryState: "WATCHING",
    localSetupStatus: "LOCAL_CLONE_REQUIRED",
    configuration: {} as ManagedPrReadModel["configuration"],
    version: 1,
    createdAt: TIME,
    updatedAt: TIME,
  };
}

function testEligibility(): {
  readonly evaluateObservedVersion: F12EligibilityBoundary["evaluateObservedVersion"];
  readonly listEligibleVersionIds: F12EligibilityBoundary["listEligibleVersionIds"];
  readonly getActiveHold: F12EligibilityBoundary["getActiveHold"];
  readonly getActiveClaim: F12EligibilityBoundary["getActiveClaim"];
  readonly claimAutomatic: F12EligibilityBoundary["claimAutomatic"];
} {
  return {
    evaluateObservedVersion: () =>
      ({ evaluation: { decision: "ELIGIBLE" } }) as F11EvaluateResult,
    listEligibleVersionIds: () => ["event-1"],
    getActiveHold: () => undefined,
    getActiveClaim: () => undefined,
    claimAutomatic: () => {
      throw new Error("F12_TEST_CLAIM_SHOULD_NOT_RUN");
    },
  };
}

function timerFake(): {
  readonly timer: {
    readonly setTimeout: (callback: () => void, milliseconds: number) => number;
    readonly clearTimeout: (handle: unknown) => void;
  };
  readonly delays: number[];
} {
  let nextHandle = 0;
  const delays: number[] = [];
  return {
    delays,
    timer: {
      setTimeout: (_callback, milliseconds) => {
        delays.push(milliseconds);
        nextHandle += 1;
        return nextHandle;
      },
      clearTimeout: () => undefined,
    },
  };
}

describe("F12 scheduler contracts", () => {
  it("resolves bounded defaults and rejects unsafe cadence values", () => {
    expect(resolveF12SchedulerConfiguration()).toEqual({
      intervalMs: DEFAULT_F12_INTERVAL_MS,
      quietPeriodMs: DEFAULT_F12_QUIET_PERIOD_MS,
      maxConcurrentPrs: 4,
      readOnlyPollWhilePaused: true,
    });
    expect(() =>
      resolveF12SchedulerConfiguration({ intervalMs: MIN_F12_INTERVAL_MS - 1 }),
    ).toThrow("F12_INVALID_POLL_INTERVAL");
    expect(() =>
      resolveF12SchedulerConfiguration({ maxConcurrentPrs: 65 }),
    ).toThrow("F12_INVALID_PR_CONCURRENCY");
  });

  it("persists per-PR slots, quiet batches, duplicate membership, pause, and revisions", async () => {
    const value = await fixture();
    const f12 = new F12PersistenceRepositories(value.store, {
      clock: { now: () => TIME },
    });
    const initial = f12.getSchedulerState();
    expect(initial.configuration.intervalMs).toBe(DEFAULT_F12_INTERVAL_MS);
    f12.ensureScheduleSlots(
      ["pr-1", "pr-2"],
      initial.configuration.intervalMs,
      TIME,
    );
    expect(f12.listScheduleSlots().map((slot) => slot.managedPrId)).toEqual([
      "pr-1",
      "pr-2",
    ]);

    addEvent(value.f03, "pr-1", "event-1");
    addEvent(value.f03, "pr-1", "event-2");
    addEvent(value.f03, "pr-2", "event-3");
    const first = f12.addEligibleVersion({
      managedPrId: "pr-1",
      eventVersionId: "event-1",
      eligibleAt: TIME,
      quietPeriodMs: DEFAULT_F12_QUIET_PERIOD_MS,
      schedulerRevision: initial.revision,
    });
    expect(first.outcome).toBe("CREATED");
    expect(first.batch.eventVersionIds).toEqual(["event-1"]);
    const duplicate = f12.addEligibleVersion({
      managedPrId: "pr-1",
      eventVersionId: "event-1",
      eligibleAt: TIME,
      quietPeriodMs: DEFAULT_F12_QUIET_PERIOD_MS,
      schedulerRevision: initial.revision,
    });
    expect(duplicate.outcome).toBe("DUPLICATE");
    const added = f12.addEligibleVersion({
      managedPrId: "pr-1",
      eventVersionId: "event-2",
      eligibleAt: "2026-09-22T12:01:00.000Z",
      quietPeriodMs: DEFAULT_F12_QUIET_PERIOD_MS,
      schedulerRevision: initial.revision,
    });
    expect(added.outcome).toBe("ADDED");
    expect(added.batch.eventVersionIds).toEqual(["event-1", "event-2"]);
    expect(added.batch.deadlineAt).toBe("2026-09-22T12:11:00.000Z");

    const otherPr = f12.addEligibleVersion({
      managedPrId: "pr-2",
      eventVersionId: "event-3",
      eligibleAt: TIME,
      quietPeriodMs: DEFAULT_F12_QUIET_PERIOD_MS,
      schedulerRevision: initial.revision,
    });
    expect(otherPr.outcome).toBe("CREATED");
    expect(otherPr.batch.managedPrId).toBe("pr-2");
    expect(
      f12.markExpiredBatchesReady("2026-09-22T12:10:00.000Z"),
    ).toHaveLength(1);

    const updated = f12.setPaused({
      paused: true,
      actor: "USER",
      requestId: "pause-1",
      expectedRevision: initial.revision,
      changedAt: TIME,
    });
    expect(updated.paused).toBe(true);
    expect(() =>
      f12.setPaused({
        paused: false,
        actor: "USER",
        requestId: "pause-stale",
        expectedRevision: initial.revision,
        changedAt: TIME,
      }),
    ).toThrow("CONFLICT");
  });

  it("runs Check Now through F10, preserves quiet deadlines, coalesces overlap, and polls while paused", async () => {
    const value = await fixture();
    addEvent(value.f03, "pr-1", "event-1");
    const persistence = new F12PersistenceRepositories(value.store, {
      clock: { now: () => TIME },
    });
    const fakeTimer = timerFake();
    let calls = 0;
    let resolvePoll: ((result: F10PollRunResult) => void) | undefined;
    const poller = {
      poll: () => {
        calls += 1;
        if (calls === 1)
          return new Promise<F10PollRunResult>((resolve) => {
            resolvePoll = resolve;
          });
        return Promise.resolve(pollResult("pr-1", ["event-1"]));
      },
    };
    const scheduler = new ReviewScheduler({
      managedPrs: { listManagedPrs: () => [managedPrModel("pr-1")] },
      persistence,
      poller,
      eligibility: testEligibility(),
      clock: { now: () => TIME },
      timer: fakeTimer.timer,
      configuration: {
        intervalMs: MIN_F12_INTERVAL_MS,
        quietPeriodMs: MIN_F12_INTERVAL_MS,
      },
    });
    scheduler.start();
    const firstRequest = scheduler.checkNow({
      requestId: "check-1",
      managedPrId: "pr-1",
    });
    await Promise.resolve();
    const secondRequest = scheduler.checkNow({
      requestId: "check-2",
      managedPrId: "pr-1",
    });
    await Promise.resolve();
    expect(calls).toBe(1);
    resolvePoll?.(pollResult("pr-1", ["event-1"]));
    expect((await firstRequest).status).toBe("ACCEPTED");
    expect((await secondRequest).status).toBe("COALESCED");

    const firstBatch = persistence.listReviewBatches()[0];
    expect(firstBatch?.deadlineAt).toBe("2026-09-22T12:01:00.000Z");
    scheduler.pauseWatching({ requestId: "pause-1" });
    const pausedCheck = await scheduler.checkNow({
      requestId: "check-paused",
      managedPrId: "pr-1",
    });
    expect(pausedCheck.status).toBe("ACCEPTED");
    expect(calls).toBe(2);
    expect(persistence.getReviewBatch(firstBatch!.batchId)?.deadlineAt).toBe(
      firstBatch?.deadlineAt,
    );
    expect(pausedCheck.snapshot.pause.paused).toBe(true);
    expect(fakeTimer.delays.length).toBeGreaterThan(0);
    scheduler.stop();
  });

  it("exposes validated scheduler IPC read and control results", async () => {
    const value = await fixture();
    const persistence = new F12PersistenceRepositories(value.store, {
      clock: { now: () => TIME },
    });
    const scheduler = new ReviewScheduler({
      managedPrs: { listManagedPrs: () => [managedPrModel("pr-1")] },
      persistence,
      poller: { poll: async () => pollResult("pr-1") },
      eligibility: testEligibility(),
      clock: { now: () => TIME },
      timer: timerFake().timer,
    });
    scheduler.start();
    const snapshot = scheduler.read();
    expect(
      parseIpcRequest({
        schemaVersion: 1,
        requestId: "ipc-read",
        type: "scheduler.read",
        payload: {},
      }).ok,
    ).toBe(true);
    expect(
      parseIpcRequest({
        schemaVersion: 1,
        requestId: "ipc-check",
        type: "scheduler.check-now",
        payload: { managedPrId: "pr-1" },
      }).ok,
    ).toBe(true);
    expect(
      parseIpcRequest({
        schemaVersion: 1,
        requestId: "ipc-config",
        type: "scheduler.configuration.save",
        payload: { intervalMs: MIN_F12_INTERVAL_MS, expectedRevision: 1 },
      }).ok,
    ).toBe(true);
    expect(
      parseIpcResponse({
        schemaVersion: 1,
        requestId: "ipc-read",
        ok: true,
        value: { kind: "scheduler-snapshot", snapshot },
      }),
    ).toBe(true);
    const paused = scheduler.pauseWatching({ requestId: "pause-1" });
    expect(
      parseIpcResponse({
        schemaVersion: 1,
        requestId: "ipc-pause",
        ok: true,
        value: { kind: "scheduler-operation", operation: paused },
      }),
    ).toBe(true);
    expect(
      parseIpcRequest({
        schemaVersion: 1,
        requestId: "ipc-bad",
        type: "scheduler.pause",
        payload: { expectedRevision: 0 },
      }).ok,
    ).toBe(false);
    expect(
      parseIpcRequest({
        schemaVersion: 1,
        requestId: "ipc-bad-config",
        type: "scheduler.configuration.save",
        payload: { intervalMs: MIN_F12_INTERVAL_MS - 1 },
      }).ok,
    ).toBe(false);
    scheduler.stop();
  });

  it("persists one exact dispatch intent, claim, and downstream handoff", async () => {
    const value = await fixture();
    addEvent(value.f03, "pr-1", "event-1");
    const persistence = new F12PersistenceRepositories(value.store, {
      clock: { now: () => TIME },
    });
    const initial = persistence.getSchedulerState();
    persistence.ensureScheduleSlots(
      ["pr-1"],
      initial.configuration.intervalMs,
      TIME,
    );
    const batch = persistence.addEligibleVersion({
      managedPrId: "pr-1",
      eventVersionId: "event-1",
      eligibleAt: TIME,
      quietPeriodMs: MIN_F12_INTERVAL_MS,
      schedulerRevision: initial.revision,
    }).batch;
    persistence.markExpiredBatchesReady("2026-09-22T12:01:00.000Z");
    const claims: string[] = [];
    const handoffs: string[][] = [];
    const scheduler = new ReviewScheduler({
      managedPrs: { listManagedPrs: () => [managedPrModel("pr-1")] },
      persistence,
      poller: { poll: async () => pollResult("pr-1") },
      eligibility: {
        evaluateObservedVersion: () =>
          ({ evaluation: { decision: "ELIGIBLE" } }) as F11EvaluateResult,
        listEligibleVersionIds: () => ["event-1"],
        getActiveHold: () => undefined,
        getActiveClaim: () => undefined,
        claimAutomatic: () => {
          claims.push("claim");
          return {
            result: {
              outcome: "CLAIMED",
              reason: {
                code: "CLAIMED",
                what: "Claimed",
                why: "The test claim is durable.",
                nextAction: "NONE",
              },
            },
            claim: { claimId: "claim-1" },
            hold: { holdId: "hold-1" },
          } as unknown as F11ClaimView;
        },
      },
      reviewWork: {
        startAutomaticReview: async (input) => {
          handoffs.push([...input.eventVersionIds]);
          return { outcome: "ACCEPTED" };
        },
      },
      clock: { now: () => TIME },
      timer: timerFake().timer,
    });
    const dispatched = await scheduler.dispatchReadyBatch(batch.batchId);
    expect(dispatched?.state).toBe("DISPATCHED");
    expect(claims).toHaveLength(1);
    expect(handoffs).toEqual([["event-1"]]);
    expect(persistence.getDispatchIntent(batch.batchId)?.status).toBe(
      "HANDED_OFF",
    );
    await scheduler.dispatchReadyBatch(batch.batchId);
    expect(claims).toHaveLength(1);
    expect(handoffs).toHaveLength(1);
  });
});
