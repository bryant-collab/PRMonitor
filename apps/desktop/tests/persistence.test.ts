import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_PERSISTED_TEXT_BYTES,
  MIGRATIONS,
  PERSISTENCE_SCHEMA_VERSION,
  PersistenceError,
  createPersistenceRepositories,
  decodeSnapshot,
  encodeSnapshot,
  initializePersistence,
  tryInitializePersistence,
  type PersistenceStore,
} from "../src/main/persistence";

const FIXED_TIME = "2026-09-20T12:00:00.000Z";

interface Fixture {
  readonly root: string;
  readonly databasePath: string;
  readonly backupRoot: string;
  readonly store: PersistenceStore;
  cleanup(): Promise<void>;
}

const fixtures: Fixture[] = [];

async function removeFixtureRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EBUSY" || attempt === 7)
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "prmonitor-f03-"));
  const databasePath = path.join(root, "database", "prmonitor.sqlite");
  const backupRoot = path.join(root, "backups");
  const store = await initializePersistence(
    { databasePath, backupRoot },
    { clock: { now: () => FIXED_TIME }, applicationBuild: "f03-test" },
  );
  const fixture: Fixture = {
    root,
    databasePath,
    backupRoot,
    store,
    async cleanup(): Promise<void> {
      store.close();
      await removeFixtureRoot(root);
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

function seedManagedPr(
  fixture: Fixture,
): ReturnType<typeof createPersistenceRepositories> {
  const repositories = createPersistenceRepositories(fixture.store, {
    clock: { now: () => FIXED_TIME },
  });
  repositories.putGithubServer({
    serverId: "server-1",
    host: "github.example.invalid",
    apiBaseUrl: "https://github.example.invalid/api/v3",
  });
  repositories.putRepository({
    repositoryId: "repo-base",
    serverId: "server-1",
    owner: "owner",
    name: "base",
    defaultBranch: "main",
  });
  repositories.putRepository({
    repositoryId: "repo-head",
    serverId: "server-1",
    owner: "owner",
    name: "head",
    defaultBranch: "main",
  });
  repositories.putManagedPr({
    managedPrId: "pr-1",
    serverId: "server-1",
    baseRepositoryId: "repo-base",
    headRepositoryId: "repo-head",
    number: 7,
    baseBranch: "main",
    headBranch: "feature",
    baseSha: "aaaaaaaa",
    headSha: "bbbbbbbb",
    state: "WATCHING",
  });
  return repositories;
}

describe("F03 SQLite persistence", () => {
  it("bootstraps the current schema and survives a process restart", async () => {
    const fixture = await createFixture();
    expect(fixture.store.health.status).toBe("upgraded");
    expect(
      fixture.store.read<{ user_version: number }>("PRAGMA user_version")
        ?.user_version,
    ).toBe(PERSISTENCE_SCHEMA_VERSION);
    expect(
      fixture.store.readAll(
        "SELECT version, migration_id, checksum FROM schema_migrations",
      ),
    ).toHaveLength(MIGRATIONS.length);
    const repositories = createPersistenceRepositories(fixture.store, {
      clock: { now: () => FIXED_TIME },
    });
    const first = repositories.putSetting("poll.interval", { seconds: 600 });
    expect(first.payload).toEqual({ seconds: 600 });
    expect(() =>
      repositories.putSetting("poll.interval", { seconds: 30 }, 0),
    ).toThrow(PersistenceError);
    fixture.store.close();
    fixtures.splice(fixtures.indexOf(fixture), 1);
    const reopened = await initializePersistence(
      { databasePath: fixture.databasePath, backupRoot: fixture.backupRoot },
      { clock: { now: () => FIXED_TIME } },
    );
    fixtures.push({
      ...fixture,
      store: reopened,
      cleanup: async () => {
        reopened.close();
        await removeFixtureRoot(fixture.root);
      },
    });
    expect(reopened.health.status).toBe("healthy");
    expect(
      createPersistenceRepositories(reopened).getSetting<{ seconds: number }>(
        "poll.interval",
      )?.payload,
    ).toEqual({ seconds: 600 });
  });

  it("upgrades an older schema only after creating a verified backup", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "prmonitor-f03-upgrade-"),
    );
    const databasePath = path.join(root, "database", "prmonitor.sqlite");
    const backupRoot = path.join(root, "backups");
    await mkdir(path.dirname(databasePath), { recursive: true });
    const old = new DatabaseSync(databasePath, {
      enableForeignKeyConstraints: true,
    });
    old.exec(MIGRATIONS[0]!.sql);
    old
      .prepare(
        "INSERT INTO schema_migrations (version, migration_id, checksum, applied_at, application_build, schema_version) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(1, MIGRATIONS[0]!.id, MIGRATIONS[0]!.checksum, FIXED_TIME, "old", 1);
    old.close();
    const store = await initializePersistence(
      { databasePath, backupRoot },
      { clock: { now: () => FIXED_TIME } },
    );
    fixtures.push({
      root,
      databasePath,
      backupRoot,
      store,
      cleanup: async () => {
        store.close();
        await rm(root, { recursive: true, force: true });
      },
    });
    expect(store.health.status).toBe("upgraded");
    expect(
      store
        .readAll("SELECT version FROM schema_migrations ORDER BY version")
        .map((row) => row.version),
    ).toEqual(MIGRATIONS.map((migration) => migration.version));
    const files = await readdir(backupRoot);
    expect(files.some((file) => file.endsWith(".sqlite"))).toBe(true);
    const backup = files.find((file) => file.endsWith(".sqlite"));
    expect(backup).toBeDefined();
    const backupDatabase = new DatabaseSync(path.join(backupRoot, backup!), {
      readOnly: true,
    });
    expect(backupDatabase.prepare("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
    backupDatabase.close();
  });

  it("rolls back all related writes on an injected transaction failure", async () => {
    const fixture = await createFixture();
    expect(() =>
      fixture.store.transaction(
        (transaction) => {
          transaction.run(
            "INSERT INTO settings (setting_key, schema_version, value_json, value_hash, version, created_at, updated_at) VALUES (?, 1, '{}', ?, 1, ?, ?)",
            "atomic-a",
            createHash("sha256").update("{}").digest("hex"),
            FIXED_TIME,
            FIXED_TIME,
          );
          transaction.run(
            "INSERT INTO settings (setting_key, schema_version, value_json, value_hash, version, created_at, updated_at) VALUES (?, 1, '{}', ?, 1, ?, ?)",
            "atomic-b",
            createHash("sha256").update("{}").digest("hex"),
            FIXED_TIME,
            FIXED_TIME,
          );
        },
        { faultInjection: { failAfterWriteNumber: 2 } },
      ),
    ).toThrow(PersistenceError);
    expect(
      fixture.store.read(
        "SELECT setting_key FROM settings WHERE setting_key IN ('atomic-a', 'atomic-b')",
      ),
    ).toBeUndefined();
    expect(() =>
      fixture.store.transaction(
        (transaction) => {
          transaction.run(
            "INSERT INTO settings (setting_key, schema_version, value_json, value_hash, version, created_at, updated_at) VALUES (?, 1, '{}', ?, 1, ?, ?)",
            "committed-before-error",
            createHash("sha256").update("{}").digest("hex"),
            FIXED_TIME,
            FIXED_TIME,
          );
        },
        { faultInjection: { failAfterCommit: true } },
      ),
    ).toThrow(PersistenceError);
    expect(
      fixture.store.read<{ setting_key: string }>(
        "SELECT setting_key FROM settings WHERE setting_key = 'committed-before-error'",
      )?.setting_key,
    ).toBe("committed-before-error");
  });

  it("keeps immutable event versions and atomically persists a Review Bundle", async () => {
    const fixture = await createFixture();
    const repositories = seedManagedPr(fixture);
    const event = {
      id: "event-1",
      managedPrId: "pr-1",
      sourceKind: "review_comment",
      sourceId: "comment-1",
      observedAt: FIXED_TIME,
      semanticHash: "hash-v1",
      payload: { body: "please fix" },
    } as const;
    expect(repositories.insertRemoteEventVersion(event).inserted).toBe(true);
    expect(repositories.insertRemoteEventVersion(event).inserted).toBe(false);
    expect(
      repositories.insertRemoteEventVersion({
        ...event,
        id: "event-2",
        semanticHash: "hash-v2",
        payload: { body: "edited" },
      }).inserted,
    ).toBe(true);
    const committed = repositories.persistReviewBundleAtomic({
      batch: {
        id: "batch-1",
        managedPrId: "pr-1",
        payload: { eventIds: ["event-1"] },
      },
      bundle: {
        id: "bundle-1",
        managedPrId: "pr-1",
        state: "READY_FOR_REVIEW",
        automaticOperationKey: "auto-pr-1",
        payload: { profile: "automatic-review" },
      },
      events: [event],
      items: [
        {
          id: "item-1",
          eventVersionId: "event-1",
          payload: { disposition: "fixed" },
        },
      ],
      hold: {
        id: "hold-1",
        managedPrId: "pr-1",
        bundleId: "bundle-1",
        payload: { reason: "review" },
      },
      transition: {
        id: "transition-1",
        aggregateType: "managed-pr",
        aggregateId: "pr-1",
        sequence: 1,
        priorState: "WATCHING",
        currentState: "READY_FOR_REVIEW",
        payload: { source: "test" },
      },
    });
    expect(committed.items).toHaveLength(1);
    expect(
      repositories.persistReviewBundleAtomic({
        batch: {
          id: "batch-replay",
          managedPrId: "pr-1",
          payload: { replay: true },
        },
        bundle: {
          id: "bundle-replay",
          managedPrId: "pr-1",
          state: "READY_FOR_REVIEW",
          automaticOperationKey: "auto-pr-1",
          payload: { replay: true },
        },
        events: [event],
        items: [{ id: "item-replay", eventVersionId: "event-1", payload: {} }],
      }).id,
    ).toBe("bundle-1");
    expect(repositories.getReviewBundle("bundle-1")?.hold?.state).toBe(
      "ACTIVE",
    );
    repositories.releaseReviewHold({
      managedPrId: "pr-1",
      bundleId: "bundle-1",
      expectedVersion: 1,
    });
    expect(repositories.getReviewBundle("bundle-1")?.hold?.state).toBe(
      "RELEASED",
    );
  });

  it("persists staged Review Bundle decisions with append-only history and replay", async () => {
    const fixture = await createFixture();
    const repositories = seedManagedPr(fixture);
    const event = {
      id: "event-proposal-1",
      managedPrId: "pr-1",
      sourceKind: "review_comment",
      sourceId: "comment-proposal-1",
      observedAt: FIXED_TIME,
      semanticHash: "hash-proposal-1",
      payload: { body: "please consider this" },
    } as const;
    repositories.persistReviewBundleAtomic({
      batch: {
        id: "batch-proposal-1",
        managedPrId: "pr-1",
        payload: { eventIds: [event.id] },
      },
      bundle: {
        id: "bundle-proposal-1",
        managedPrId: "pr-1",
        state: "READY_FOR_REVIEW",
        stage: "PROPOSAL_REVIEW",
        automaticOperationKey: "auto-proposal-1",
        payload: { profile: "automatic-review" },
      },
      events: [event],
      items: [
        {
          id: "item-proposal-1",
          eventVersionId: event.id,
          payload: { disposition: "fixed" },
          decision: { decision: "pending", finalDisposition: "no_change" },
        },
      ],
    });

    const initial = repositories.getReviewBundle("bundle-proposal-1");
    expect(initial?.stage).toBe("PROPOSAL_REVIEW");
    expect(initial?.items[0]?.decision.decision).toBe("pending");
    expect(initial?.items[0]?.decisionHistory).toHaveLength(1);

    const decided = repositories.recordReviewBundleItemDecision({
      bundleId: "bundle-proposal-1",
      itemId: "item-proposal-1",
      decision: "accepted",
      finalDisposition: "fixed",
      userInstructions: "Apply the accepted change.",
      expectedBundleVersion: initial?.version,
      actionId: "decision-action-1",
    });
    expect(decided.items[0]?.decision).toMatchObject({
      decision: "accepted",
      finalDisposition: "fixed",
      userInstructions: "Apply the accepted change.",
    });
    expect(decided.items[0]?.decisionHistory).toHaveLength(2);
    expect(decided.version).toBe((initial?.version ?? 0) + 1);

    const replay = repositories.recordReviewBundleItemDecision({
      bundleId: "bundle-proposal-1",
      itemId: "item-proposal-1",
      decision: "accepted",
      finalDisposition: "fixed",
      userInstructions: "Apply the accepted change.",
      expectedBundleVersion: 999,
      actionId: "decision-action-1",
    });
    expect(replay.version).toBe(decided.version);
    expect(replay.items[0]?.decisionHistory).toHaveLength(2);

    const reopened = await initializePersistence(
      { databasePath: fixture.databasePath, backupRoot: fixture.backupRoot },
      { clock: { now: () => FIXED_TIME }, applicationBuild: "f03-reopen" },
    );
    try {
      const afterRestart =
        createPersistenceRepositories(reopened).getReviewBundle(
          "bundle-proposal-1",
        );
      expect(afterRestart?.stage).toBe("PROPOSAL_REVIEW");
      expect(afterRestart?.items[0]?.decision.decision).toBe("accepted");
      expect(afterRestart?.items[0]?.decisionHistory).toHaveLength(2);
    } finally {
      reopened.close();
    }
  });

  it("round-trips the remaining durable record families without sharing mutable snapshots", async () => {
    const fixture = await createFixture();
    const repositories = seedManagedPr(fixture);
    repositories.putValidationProfile("profile-1", 1, {
      steps: [{ id: "test", command: "npm test" }],
    });
    repositories.putValidationProfile("profile-1", 2, {
      steps: [{ id: "check", command: "npm run check" }],
    });
    repositories.putCommonInstructions("instructions-1", 1, {
      text: "be deterministic",
    });
    repositories.putAiTaskProfile("task-profile-1", 1, { task: "review" });
    repositories.putExecutionPolicy("policy-1", 1, {
      mode: "AUTONOMOUS_WORKTREE",
    });
    repositories.putValidationApproval({
      approvalId: "validation-approval-1",
      profileId: "profile-1",
      profileRevision: 1,
      contentHash: "profile-hash-1",
      payload: { approved: true },
    });
    repositories.putResourceCheckpoint({
      serverId: "server-1",
      repositoryId: "repo-base",
      resourceKind: "comments",
      resourceKey: "pr-1",
      etag: "etag-1",
      observedVersion: 1,
      payload: { page: 1 },
    });
    repositories.putResourceObservation({
      observationId: "observation-1",
      managedPrId: "pr-1",
      serverId: "server-1",
      resourceKind: "comment",
      resourceKey: "comment-1",
      remoteIdentity: "github:comment-1",
      observedAt: FIXED_TIME,
      semanticHash: "event-hash-1",
      payload: { body: "hello" },
    });
    repositories.putConversation({
      conversationId: "conversation-1",
      scope: "READ_ONLY",
      opaqueReference: "opaque-ref-1",
      payload: { turns: 1 },
    });
    repositories.putValidationRun({
      runId: "run-1",
      ownerType: "REVIEW_BUNDLE",
      ownerId: "bundle-1",
      status: "passed",
      snapshot: { profileId: "profile-1", revision: 1 },
      evidence: { passed: true },
      steps: [{ stepId: "test", status: "passed", evidence: { exitCode: 0 } }],
      manualChecks: [
        {
          checkId: "manual-1",
          outcome: "verified",
          evidence: { actor: "human" },
        },
      ],
    });
    repositories.putWorktree({
      worktreeId: "worktree-1",
      ownerType: "REVIEW_BUNDLE",
      ownerId: "bundle-1",
      operationKind: "REVIEW",
      canonicalPath: "C:/prmonitor/worktrees/review-1",
      baselineSha: "aaaaaaaa",
      currentSha: "bbbbbbbb",
      status: "READY",
      payload: { clean: true },
    });
    repositories.putDiff({
      diffId: "diff-1",
      ownerType: "REVIEW_BUNDLE",
      ownerId: "bundle-1",
      baselineSha: "aaaaaaaa",
      currentSha: "bbbbbbbb",
      diffHash: "diff-hash-1",
      metadata: { files: 1 },
    });
    repositories.putSynchronizationBatch({
      synchronizationBatchId: "sync-batch-1",
      status: "WORKING",
      payload: { selected: ["pr-1"] },
    });
    repositories.putSynchronizationResult({
      synchronizationOperationId: "sync-op-1",
      synchronizationBatchId: "sync-batch-1",
      managedPrId: "pr-1",
      status: "READY_TO_PUBLISH",
      sourceRepositoryId: "repo-base",
      destinationRepositoryId: "repo-head",
      sourceBranch: "main",
      destinationBranch: "feature",
      syncSourceSha: "aaaaaaaa",
      prHeadSha: "bbbbbbbb",
      syncMergeBaseSha: "cccccccc",
      sourceChangeEvidence: { paths: ["src/source.ts"], summary: "source" },
      prHeadChangeEvidence: { paths: ["src/feature.ts"], summary: "PR" },
      userConsultation: {
        question: "Which intent should win?",
        competingIntents: ["source", "PR"],
        requestedAt: FIXED_TIME,
      },
      reason: { what: "merged", why: "clean", nextAction: "APPROVE" },
      payload: { merge: "clean" },
    });
    repositories.putSynchronizationConflict({
      synchronizationOperationId: "sync-op-1",
      path: "src/example.ts",
      reason: { what: "conflict", nextAction: "REVIEW" },
      source: "source-side text",
      destination: "PR-side text",
      mergeBase: "common text",
      details: { hunk: 1 },
    });
    repositories.appendActivityEvent({
      activityEventId: "activity-1",
      correlationId: "correlation-1",
      ownerType: "SYNC",
      ownerId: "sync-op-1",
      severity: "INFO",
      reasonCode: "SYNC_READY",
      payload: { status: "ready" },
    });
    expect(
      repositories.getManagedPr<{ note?: string }>("pr-1")?.payload,
    ).toEqual({});
    expect(
      fixture.store
        .readAll(
          "SELECT revision FROM validation_profiles WHERE profile_id = 'profile-1' ORDER BY revision",
        )
        .map((row) => row.revision),
    ).toEqual([1, 2]);
    expect(
      fixture.store.read<{ payload_json: string }>(
        "SELECT payload_json FROM validation_profiles WHERE profile_id = 'profile-1' AND revision = 1",
      )?.payload_json,
    ).toContain("npm test");
    expect(
      repositories.getSynchronizationResult("sync-op-1")?.conflicts[0]?.path,
    ).toBe("src/example.ts");
    expect(
      repositories.getSynchronizationResult("sync-op-1")?.syncMergeBaseSha,
    ).toBe("cccccccc");
    expect(
      repositories.getSynchronizationResult("sync-op-1")?.sourceChangeEvidence,
    ).toEqual({ paths: ["src/source.ts"], summary: "source" });
    expect(
      repositories.getSynchronizationResult("sync-op-1")?.userConsultation,
    ).toEqual({
      question: "Which intent should win?",
      competingIntents: ["source", "PR"],
      requestedAt: FIXED_TIME,
    });
    expect(
      repositories.getSynchronizationResult("sync-op-1")?.conflicts[0],
    ).toMatchObject({
      source: "source-side text",
      destination: "PR-side text",
      mergeBase: "common text",
      details: { hunk: 1 },
    });
    expect(
      fixture.store.read<{ count: number }>(
        "SELECT COUNT(*) AS count FROM activity_events",
      )?.count,
    ).toBe(1);
  });

  it("preserves AI budgets and publication identifiers across restart", async () => {
    const fixture = await createFixture();
    const repositories = seedManagedPr(fixture);
    repositories.putAiWorkOperation({
      operationId: "op-1",
      managedPrId: "pr-1",
      operationKind: "AUTOMATIC_REVIEW",
      status: "WORKING",
      taskProfileSnapshot: { profile: "review" },
      executionPolicySnapshot: { policy: "worktree" },
      inputSnapshot: { headSha: "bbbbbbbb" },
      configuredTurnBudget: 3,
      idempotencyKey: "op-key-1",
    });
    repositories.createAiWorkSegment({
      segmentId: "segment-1",
      operationId: "op-1",
      segmentIndex: 0,
      status: "WORKING",
      configuredTurnBudget: 3,
      consumedTurnBaseline: 0,
      snapshot: { headSha: "bbbbbbbb" },
    });
    expect(
      repositories.recordAiWorkTurn({
        turnId: "turn-1",
        segmentId: "segment-1",
        turnIndex: 0,
        status: "COMPLETED",
        startedAt: FIXED_TIME,
        completedAt: FIXED_TIME,
        report: { completed: true },
      }),
    ).toBe(true);
    expect(
      repositories.recordAiWorkTurn({
        turnId: "turn-1",
        segmentId: "segment-1",
        turnIndex: 0,
        status: "COMPLETED",
        startedAt: FIXED_TIME,
        completedAt: FIXED_TIME,
        report: { replay: true },
      }),
    ).toBe(false);
    repositories.saveApproval({
      approvalId: "approval-1",
      scope: "REVIEW_BUNDLE_PUBLICATION",
      payload: { approved: true },
    });
    repositories.createPublicationIntent({
      id: "publication-1",
      kind: "REVIEW_BUNDLE",
      ownerId: "bundle-1",
      approvalId: "approval-1",
      idempotencyKey: "publish-key-1",
      expectedHeadSha: "bbbbbbbb",
      proposedResult: { diff: "diff-1" },
    });
    repositories.putPublicationResponse("publication-1", {
      responseKey: "response-1",
      state: "POSTED",
      remoteId: "remote-1",
    });
    expect(
      repositories.updatePublicationIntent({
        publicationId: "publication-1",
        expectedVersion: 1,
        phase: "PUBLISHED_WITH_ERRORS",
        recoveryState: "RECONCILE",
        knownCommitSha: "cccccccc",
      }).knownCommitSha,
    ).toBe("cccccccc");
    const operationBeforeRestart = repositories.getAiWorkOperation("op-1");
    expect(operationBeforeRestart?.consumedTurnCount).toBe(1);
    fixture.store.close();
    fixtures.splice(fixtures.indexOf(fixture), 1);
    const reopened = await initializePersistence(
      { databasePath: fixture.databasePath, backupRoot: fixture.backupRoot },
      { clock: { now: () => FIXED_TIME } },
    );
    fixtures.push({
      ...fixture,
      store: reopened,
      cleanup: async () => {
        reopened.close();
        await removeFixtureRoot(fixture.root);
      },
    });
    const afterRestart = createPersistenceRepositories(reopened);
    expect(afterRestart.getAiWorkOperation("op-1")?.consumedTurnCount).toBe(1);
    expect(
      afterRestart.getPublicationIntent("REVIEW_BUNDLE", "publish-key-1")
        ?.responses[0]?.remoteId,
    ).toBe("remote-1");
  });

  it("round-trips the versioned provider-neutral AI handoff exactly once", async () => {
    const fixture = await createFixture();
    const repositories = seedManagedPr(fixture);
    repositories.putAiProviderOperation({
      handoff: {
        schemaVersion: 1,
        operationId: "provider-op-1",
        managedPrId: "pr-1",
        operationKind: "AUTOMATIC_REVIEW",
        status: "WORKING",
        taskProfileSnapshot: { profileId: "review", revision: 1 },
        executionPolicySnapshot: { policyId: "read-only", revision: 1 },
        inputSnapshot: { headSha: "bbbbbbbb", eventVersionIds: ["event-1"] },
        configuredTurnBudget: 2,
        idempotencyKey: "provider-op-key-1",
      },
    });
    repositories.createAiWorkSegment({
      segmentId: "provider-segment-1",
      operationId: "provider-op-1",
      segmentIndex: 0,
      status: "WORKING",
      configuredTurnBudget: 2,
      consumedTurnBaseline: 0,
      snapshot: { headSha: "bbbbbbbb" },
    });
    const result = {
      schemaVersion: 1 as const,
      requestId: "provider-request-1",
      operationId: "provider-op-1",
      turnId: "provider-turn-1",
      providerId: "codex",
      modelId: "gpt-5-codex",
      taskType: "AUTOMATIC_REVIEW",
      profileRevision: 1,
      executionPolicySnapshot: {
        schemaVersion: 1,
        snapshotHash: "policy-hash-1",
      },
      startedAt: FIXED_TIME,
      completedAt: FIXED_TIME,
      status: "completed" as const,
      structuredResult: { summary: "safe result", disposition: "no_change" },
      events: [
        {
          schemaVersion: 1 as const,
          sequence: 0,
          occurredAt: FIXED_TIME,
          providerId: "codex",
          turnId: "provider-turn-1",
          kind: "completed",
          details: { bounded: true },
        },
      ],
      usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
      conversationReference: {
        schemaVersion: 1 as const,
        providerId: "codex",
        opaqueReference: "opaque-thread-1",
        resumable: true,
      },
    };
    const first = repositories.recordAiProviderTurn({
      result,
      segmentId: "provider-segment-1",
      turnIndex: 0,
      startedAt: FIXED_TIME,
      completedAt: FIXED_TIME,
      stateFingerprint: "state-1",
    });
    expect(first.inserted).toBe(true);
    expect(first.record.result).toEqual(result);
    const replay = repositories.recordAiProviderTurn({
      result,
      segmentId: "provider-segment-1",
      turnIndex: 0,
      startedAt: FIXED_TIME,
      completedAt: FIXED_TIME,
    });
    expect(replay.inserted).toBe(false);
    expect(
      repositories.getAiWorkOperation("provider-op-1")?.consumedTurnCount,
    ).toBe(1);
    expect(() =>
      repositories.recordAiProviderTurn({
        result: { ...result, structuredResult: { summary: "rewritten" } },
        segmentId: "provider-segment-1",
        turnIndex: 0,
        startedAt: FIXED_TIME,
        completedAt: FIXED_TIME,
      }),
    ).toThrow(PersistenceError);
    expect(() =>
      repositories.recordAiProviderTurn({
        result: { ...result, structuredResult: { prompt: "must not persist" } },
        segmentId: "provider-segment-1",
        turnIndex: 1,
        startedAt: FIXED_TIME,
        completedAt: FIXED_TIME,
      }),
    ).toThrow("F15_JSON_UNSAFE_KEY");

    const conversation = repositories.putAiProviderConversation({
      schemaVersion: 1,
      conversationId: "provider-conversation-1",
      operationId: "provider-op-1",
      scope: "AUTOMATIC_REVIEW",
      reference: {
        schemaVersion: 1,
        providerId: "codex",
        opaqueReference: "opaque-thread-1",
        resumable: true,
      },
    });
    expect(conversation.reference.opaqueReference).toBe("opaque-thread-1");
    expect(() =>
      repositories.putAiProviderConversation({
        schemaVersion: 1,
        conversationId: "provider-conversation-unsafe",
        scope: "AUTOMATIC_REVIEW",
        reference: {
          schemaVersion: 1,
          providerId: "codex",
          opaqueReference: "safe-ref",
          resumable: false,
        },
      }),
    ).not.toThrow();

    fixture.store.close();
    fixtures.splice(fixtures.indexOf(fixture), 1);
    const reopened = await initializePersistence(
      { databasePath: fixture.databasePath, backupRoot: fixture.backupRoot },
      { clock: { now: () => FIXED_TIME } },
    );
    fixtures.push({
      ...fixture,
      store: reopened,
      cleanup: async () => {
        reopened.close();
        await removeFixtureRoot(fixture.root);
      },
    });
    const afterRestart = createPersistenceRepositories(reopened);
    expect(afterRestart.getAiProviderTurn("provider-turn-1")?.result).toEqual(
      result,
    );
    expect(
      afterRestart.getAiProviderConversation("provider-conversation-1")
        ?.reference,
    ).toEqual(conversation.reference);
  });

  it("fails closed on edited migration history without replacing the source database", async () => {
    const fixture = await createFixture();
    fixture.store.close();
    fixtures.splice(fixtures.indexOf(fixture), 1);
    const database = new DatabaseSync(fixture.databasePath);
    database
      .prepare("UPDATE schema_migrations SET checksum = ? WHERE version = 1")
      .run("edited");
    database.close();
    const result = await tryInitializePersistence(
      { databasePath: fixture.databasePath, backupRoot: fixture.backupRoot },
      { clock: { now: () => FIXED_TIME } },
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.reason.code).toBe("MIGRATION_CHECKSUM_MISMATCH");
    await expect(stat(fixture.databasePath)).resolves.toBeTruthy();
    const source = new DatabaseSync(fixture.databasePath, { readOnly: true });
    expect(
      source
        .prepare("SELECT checksum FROM schema_migrations WHERE version = 1")
        .get(),
    ).toEqual({ checksum: "edited" });
    source.close();
  });

  it("fails closed on corrupt and unsupported database files and rejects unsafe payloads", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "prmonitor-f03-invalid-"),
    );
    const corruptPath = path.join(root, "database", "corrupt.sqlite");
    const unsupportedPath = path.join(root, "database", "unsupported.sqlite");
    const backupRoot = path.join(root, "backups");
    await mkdir(path.dirname(corruptPath), { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(corruptPath, "not sqlite", "utf8");
    const corrupt = await tryInitializePersistence(
      { databasePath: corruptPath, backupRoot },
      { clock: { now: () => FIXED_TIME } },
    );
    expect(corrupt.ok).toBe(false);
    if (!corrupt.ok) expect(corrupt.error.reason.code).toBe("CORRUPT_DATABASE");
    const unsupported = new DatabaseSync(unsupportedPath);
    unsupported.exec("PRAGMA user_version = 99");
    unsupported.close();
    const future = await tryInitializePersistence(
      {
        databasePath: unsupportedPath,
        backupRoot: path.join(root, "future-backups"),
      },
      { clock: { now: () => FIXED_TIME } },
    );
    expect(future.ok).toBe(false);
    if (!future.ok)
      expect(future.error.reason.code).toBe("UNSUPPORTED_SCHEMA_VERSION");
    expect(() =>
      decodeSnapshot(
        {
          schemaVersion: 2,
          payload: "{}",
          payloadHash: createHash("sha256").update("{}").digest("hex"),
        },
        1,
      ),
    ).toThrow(PersistenceError);
    expect(() =>
      encodeSnapshot({ value: "x".repeat(MAX_PERSISTED_TEXT_BYTES + 1) }),
    ).toThrow(PersistenceError);
    const integrityFixture = await createFixture();
    integrityFixture.store.close();
    fixtures.splice(fixtures.indexOf(integrityFixture), 1);
    const integrity = await tryInitializePersistence(
      {
        databasePath: integrityFixture.databasePath,
        backupRoot: integrityFixture.backupRoot,
      },
      {
        clock: { now: () => FIXED_TIME },
        faultInjection: { failIntegrityCheck: true },
      },
    );
    expect(integrity.ok).toBe(false);
    if (!integrity.ok)
      expect(integrity.error.reason.code).toBe("INTEGRITY_CHECK_FAILED");
    await removeFixtureRoot(integrityFixture.root);
    const fixture = await createFixture();
    const repositories = createPersistenceRepositories(fixture.store);
    expect(() =>
      repositories.putSetting("unsafe", { access_token: "must-not-persist" }),
    ).toThrow(PersistenceError);
    await removeFixtureRoot(root);
  });
});
