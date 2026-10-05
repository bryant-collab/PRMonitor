import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  F28RecoveryRepositories,
  initializePersistence,
  type PersistenceStore,
} from "../src/main/persistence";
import { F28RecoveryCoordinator } from "../src/main/f28-recovery-service";
import {
  F28_SCHEMA_VERSION,
  f28BackoffMs,
  f28ClassifyEffectObservation,
  type F28LifecycleSnapshot,
  type F28OwnerOutcome,
  type F28RecoveryScopeInput,
} from "../src/shared/f28-recovery";

const FIXED_TIME = "2026-09-28T12:00:00.000Z";

interface Fixture {
  readonly root: string;
  readonly databasePath: string;
  readonly backupRoot: string;
  readonly store: PersistenceStore;
  cleanup(): Promise<void>;
}

const fixtures: Fixture[] = [];

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "prmonitor-f28-"));
  const databasePath = path.join(root, "database", "prmonitor.sqlite");
  const backupRoot = path.join(root, "backups");
  const store = await initializePersistence(
    { databasePath, backupRoot },
    { clock: { now: () => FIXED_TIME }, applicationBuild: "f28-test" },
  );
  const fixture: Fixture = {
    root,
    databasePath,
    backupRoot,
    store,
    async cleanup(): Promise<void> {
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

function lifecycle(
  applicationSessionId = "application-session-1",
  online = true,
): F28LifecycleSnapshot {
  return {
    schemaVersion: F28_SCHEMA_VERSION,
    applicationSessionId,
    lifecyclePhase: "RUNNING",
    rendererAttached: true,
    explicitShutdown: false,
    online,
    wallClockAt: FIXED_TIME,
    monotonicNowMs: 1000,
  };
}

function scope(
  owner: string,
  stage: F28RecoveryScopeInput["stage"],
  kind: F28RecoveryScopeInput["kind"] = "managed_pr",
  id = "pr-1",
): F28RecoveryScopeInput {
  return {
    schemaVersion: F28_SCHEMA_VERSION,
    kind,
    id,
    owner,
    stage,
  };
}

function outcome(
  classification: F28OwnerOutcome["classification"],
  code = "F28_TEST_OUTCOME",
): F28OwnerOutcome {
  return {
    schemaVersion: F28_SCHEMA_VERSION,
    classification,
    reason: {
      schemaVersion: F28_SCHEMA_VERSION,
      code,
      what: "The test owner returned a typed deterministic result.",
      why: "The recovery boundary must persist the owner result before projection.",
      nextAction: classification === "WAITING_FOR_NETWORK" ? "WAIT" : "NONE",
      retryable: classification === "WAITING_FOR_NETWORK",
      correlationId: "f28-test-correlation",
      evidenceRefs: [],
    },
    evidenceRefs: [],
  };
}

describe("F28 durable recovery", () => {
  it("reconciles global owner state once per session while persisting every PR outcome and re-reading on wake", async () => {
    const fixture = await createFixture();
    const repositories = new F28RecoveryRepositories(fixture.store);
    let scans = 0;
    const recovered: string[] = [];
    const coordinator = new F28RecoveryCoordinator({
      persistence: repositories,
      lifecycle: () => lifecycle("session-wide-scans"),
      owners: [
        {
          owner: "global-local-work",
          stage: "LOCAL_WORK",
          listScopes: () =>
            Array.from({ length: 20 }, (_, index) =>
              scope(
                "global-local-work",
                "LOCAL_WORK",
                "managed_pr",
                `pr-${index}`,
              ),
            ),
          reconcileSession: async (context) => {
            scans++;
            expect(context).not.toHaveProperty("scope");
            expect(context.allowProviderInvocation).toBe(false);
            expect(context.allowPublication).toBe(false);
            expect(context.allowForcePush).toBe(false);
            expect(context.allowArbitraryCommands).toBe(false);
            expect(context.allowWorktreeReplacement).toBe(false);
            await Promise.resolve();
          },
          recover: (context) => {
            recovered.push(context.scope.id);
            return outcome("COMPLETED");
          },
        },
      ],
    });
    const first = await coordinator.startup("global-first");
    expect(scans).toBe(1);
    expect(first.projection.summary).toEqual({
      scopes: 21,
      completed: 21,
      attention: 0,
      retrying: 0,
    });
    expect(new Set(recovered).size).toBe(20);
    const wake = await coordinator.wake("global-wake");
    expect(scans).toBe(2);
    expect(recovered).toHaveLength(40);
    expect(
      wake.projection.scopes.every(
        (value) => value.classification === "COMPLETED",
      ),
    ).toBe(true);
    expect(
      fixture.store.readAll("SELECT * FROM f28_recovery_attempts"),
    ).toHaveLength(42);
  });

  it.each(["failed", "offline"] as const)(
    "keeps every scope conservative when session reconciliation is %s",
    async (mode) => {
      const fixture = await createFixture();
      let scans = 0;
      let recoveries = 0;
      const coordinator = new F28RecoveryCoordinator({
        persistence: new F28RecoveryRepositories(fixture.store),
        lifecycle: () => lifecycle(`global-${mode}`, mode !== "offline"),
        owners: [
          {
            owner: "global-network",
            stage: "REVIEW_PUBLICATION",
            requiresNetwork: true,
            listScopes: () => [
              scope(
                "global-network",
                "REVIEW_PUBLICATION",
                "publication",
                "one",
              ),
              scope(
                "global-network",
                "REVIEW_PUBLICATION",
                "publication",
                "two",
              ),
            ],
            reconcileSession: () => {
              scans++;
              throw Error("fixture-only failure");
            },
            recover: () => {
              recoveries++;
              return outcome("COMPLETED");
            },
          },
        ],
      });
      const result = await coordinator.startup(`global-${mode}`);
      expect(scans).toBe(mode === "offline" ? 0 : 1);
      expect(recoveries).toBe(0);
      const affected = result.projection.scopes.filter(
        (value) => value.scope.owner === "global-network",
      );
      expect(affected).toHaveLength(2);
      expect(
        affected.every(
          (value) =>
            value.classification ===
            (mode === "offline" ? "WAITING_FOR_NETWORK" : "UNCERTAIN"),
        ),
      ).toBe(true);
      expect(result.projection.status).toBe("PARTIAL");
    },
  );

  it("persists bounded session, scope, attempt, failure, and projection evidence across restart", async () => {
    const fixture = await createFixture();
    const repositories = new F28RecoveryRepositories(fixture.store, {
      clock: { now: () => FIXED_TIME },
    });
    const session = repositories.createOrGetSession({
      sessionId: "f28-session-repository-test",
      requestKey: "f28-request-repository-test",
      trigger: "startup",
      lifecycle: lifecycle(),
    });
    expect(session.created).toBe(true);
    expect(
      repositories.createOrGetSession({
        sessionId: "f28-session-other",
        requestKey: "f28-request-repository-test",
        trigger: "startup",
        lifecycle: lifecycle(),
      }).created,
    ).toBe(false);

    const recoveryScope = repositories.putScope(
      scope("f28-test-owner", "LOCAL_WORK"),
      session.session.sessionId,
    );
    const begun = repositories.beginAttempt({
      attemptId: "f28-attempt-waiting",
      sessionId: session.session.sessionId,
      scopeKey: recoveryScope.scopeKey,
      stage: "LOCAL_WORK",
      startedAt: FIXED_TIME,
    });
    expect(begun.created).toBe(true);
    const nextAttemptAt = "2026-09-28T12:00:02.000Z";
    const completed = repositories.completeAttempt({
      attemptId: begun.attempt.attemptId,
      outcome: { ...outcome("WAITING_FOR_NETWORK"), nextAttemptAt },
    });
    expect(completed.attempt.status).toBe("COMPLETED");
    expect(completed.scope.classification).toBe("WAITING_FOR_NETWORK");
    expect(completed.scope.nextAttemptAt).toBe(nextAttemptAt);

    const failedScope = repositories.putScope(
      scope("f28-test-failure", "AI", "ai_operation", "turn-1"),
      session.session.sessionId,
    );
    const failedAttempt = repositories.beginAttempt({
      attemptId: "f28-attempt-failed",
      sessionId: session.session.sessionId,
      scopeKey: failedScope.scopeKey,
      stage: "AI",
      startedAt: FIXED_TIME,
    });
    const failed = repositories.failAttempt({
      attemptId: failedAttempt.attempt.attemptId,
      reason: {
        ...outcome("UNCERTAIN", "F28_TEST_FAILURE").reason,
        nextAction: "RECONCILE",
        retryable: false,
      },
    });
    expect(failed.attempt.status).toBe("FAILED");
    expect(failed.scope.classification).toBe("UNCERTAIN");

    const finalized = repositories.finalizeSession({
      sessionId: session.session.sessionId,
      status: "PARTIAL",
      stage: "FINALIZE",
    });
    expect(finalized.scopeCount).toBe(2);
    expect(finalized.retryCount).toBe(1);
    expect(finalized.attentionCount).toBe(1);

    fixture.store.close();
    fixtures.splice(fixtures.indexOf(fixture), 1);
    const reopened = await initializePersistence(
      { databasePath: fixture.databasePath, backupRoot: fixture.backupRoot },
      { clock: { now: () => FIXED_TIME }, applicationBuild: "f28-test" },
    );
    fixtures.push({
      ...fixture,
      store: reopened,
      cleanup: async () => {
        reopened.close();
        await rm(fixture.root, { recursive: true, force: true });
      },
    });
    const projection = new F28RecoveryRepositories(reopened).readProjection(
      session.session.sessionId,
    );
    expect(projection?.status).toBe("PARTIAL");
    expect(projection?.summary).toEqual({
      scopes: 2,
      completed: 0,
      attention: 1,
      retrying: 1,
    });
    expect(projection?.scopes.map((value) => value.attemptCount)).toEqual([
      1, 1,
    ]);
  });

  it("orders typed owners, coalesces concurrent wake events, and never grants effect authority", async () => {
    const fixture = await createFixture();
    const repositories = new F28RecoveryRepositories(fixture.store, {
      clock: { now: () => FIXED_TIME },
    });
    let currentLifecycle = lifecycle("application-session-coordinator", false);
    let ownerCalls = 0;
    const seenStages: string[] = [];
    const coordinator = new F28RecoveryCoordinator({
      persistence: repositories,
      lifecycle: () => currentLifecycle,
      owners: [
        {
          owner: "f28-network-owner",
          stage: "SCHEDULER",
          requiresNetwork: true,
          listScopes: () => [
            scope("f28-network-owner", "SCHEDULER", "managed_pr", "pr-1"),
          ],
          recover: (context) => {
            ownerCalls += 1;
            expect(context.lifecycle.online).toBe(true);
            return outcome("COMPLETED", "F28_NETWORK_RECONCILED");
          },
        },
        {
          owner: "f28-ai-owner",
          stage: "AI",
          listScopes: () => [
            scope("f28-ai-owner", "AI", "ai_operation", "turn-1"),
          ],
          recover: async (context) => {
            seenStages.push(context.scope.stage);
            expect(context.automatic).toBe(true);
            expect(context.allowProviderInvocation).toBe(false);
            expect(context.allowPublication).toBe(false);
            expect(context.allowForcePush).toBe(false);
            expect(context.allowArbitraryCommands).toBe(false);
            expect(context.allowWorktreeReplacement).toBe(false);
            ownerCalls += 1;
            await new Promise((resolve) => setTimeout(resolve, 5));
            return outcome("COMPLETED", "F28_AI_RECONCILED");
          },
        },
      ],
    });

    const first = await coordinator.startup("f28-coordinator-startup");
    expect(first.projection.status).toBe("PARTIAL");
    expect(first.projection.scopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classification: "WAITING_FOR_NETWORK",
        }),
        expect.objectContaining({
          classification: "COMPLETED",
        }),
      ]),
    );
    expect(ownerCalls).toBe(1);
    expect(seenStages).toEqual(["AI"]);

    currentLifecycle = lifecycle("application-session-coordinator", true);
    const [wakeA, wakeB] = await Promise.all([
      coordinator.wake("f28-wake-a"),
      coordinator.wake("f28-wake-b"),
    ]);
    expect(wakeA.session.sessionId).toBe(wakeB.session.sessionId);
    expect(wakeA.coalesced).toBe(false);
    expect(wakeB.coalesced).toBe(false);

    expect(
      fixture.store.readAll("SELECT * FROM f28_recovery_attempts"),
    ).toHaveLength(6);
    expect(ownerCalls).toBe(3);
    expect(
      wakeA.projection.scopes.every(
        (value) => value.classification === "COMPLETED",
      ),
    ).toBe(true);
  });

  it("keeps effect classification conservative and retry backoff capped", () => {
    expect(
      f28ClassifyEffectObservation({
        kind: "commit",
        expectedCommitSha: "abc",
        observedCommitSha: "abc",
        evidence: "MATCHING",
      }),
    ).toBe("ADOPTED");
    expect(
      f28ClassifyEffectObservation({
        kind: "push",
        expectedOldSha: "old",
        expectedCommitSha: "new",
        observedRefSha: "different",
        evidence: "DIVERGENT",
      }),
    ).toBe("UNCERTAIN");
    expect(
      f28ClassifyEffectObservation({
        kind: "response",
        matchingResponseCount: 0,
        evidence: "ABSENT",
      }),
    ).toBe("SAFE_TO_RETRY");
    expect(f28BackoffMs(1, 1_000, 5_000)).toBe(1_000);
    expect(f28BackoffMs(3, 1_000, 5_000)).toBe(4_000);
    expect(f28BackoffMs(8, 1_000, 5_000)).toBe(5_000);
  });
});
