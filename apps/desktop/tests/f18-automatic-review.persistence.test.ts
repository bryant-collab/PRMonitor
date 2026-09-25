import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  F18PersistenceRepositories,
  createPersistenceRepositories,
  initializePersistence,
  type PersistenceStore,
} from "../src/main/persistence";
import {
  f18ReviewBundleRecordSchema,
  type F18ReviewBundleRecord,
} from "../src/shared/f18-automatic-review";

const TIME = "2026-09-24T12:00:00.000Z";
const roots: string[] = [];
const stores: PersistenceStore[] = [];

function record(): F18ReviewBundleRecord {
  return f18ReviewBundleRecordSchema.parse({
    schemaVersion: 1,
    bundleId: "bundle-persistence-1",
    managedPrId: "pr-1",
    batchId: "batch-persistence-1",
    operationId: "operation-persistence-1",
    claimId: "claim-persistence-1",
    holdId: "hold-persistence-1",
    correlationId: "correlation-persistence-1",
    schedulerRevision: 1,
    state: "WORKING",
    stage: "PROPOSAL_REVIEW",
    phase: "ADMITTED",
    version: 1,
    createdAt: TIME,
    updatedAt: TIME,
    input: {
      schemaVersion: 1,
      operationId: "operation-persistence-1",
      bundleId: "bundle-persistence-1",
      batchId: "batch-persistence-1",
      managedPrId: "pr-1",
      claimId: "claim-persistence-1",
      holdId: "hold-persistence-1",
      correlationId: "correlation-persistence-1",
      schedulerRevision: 1,
      remoteEventVersionIds: ["event-persistence-1"],
      pullRequest: {
        baseRepository: {
          serverId: "server-1",
          owner: "owner",
          name: "base",
          key: "server-1/owner/base",
        },
        headRepository: {
          serverId: "server-1",
          owner: "owner",
          name: "head",
          key: "server-1/owner/head",
        },
        baseBranch: "main",
        headBranch: "feature",
        baseSha: "aaaaaaaa",
        headSha: "bbbbbbbb",
      },
      feedback: [
        {
          eventVersionId: "event-persistence-1",
          semanticHash: "semantic-persistence-1",
          sourceKind: "REVIEW_COMMENT",
          sourceId: "comment-persistence-1",
          observedAt: TIME,
          body: "Please fix this.",
        },
      ],
    },
    items: [],
    draftResponses: [],
    reasons: [],
    nextAction: "PREPARE_WORKTREE",
  });
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("F18 durable bundle updates", () => {
  it("survives proposal update, decision history, and restart", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "prmonitor-f18-persistence-"),
    );
    roots.push(root);
    const store = await initializePersistence(
      {
        databasePath: path.join(root, "database", "prmonitor.sqlite"),
        backupRoot: path.join(root, "backups"),
      },
      { clock: { now: () => TIME }, applicationBuild: "f18-test" },
    );
    stores.push(store);
    const repositories = createPersistenceRepositories(store, {
      clock: { now: () => TIME },
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
      number: 1,
      baseBranch: "main",
      headBranch: "feature",
      baseSha: "aaaaaaaa",
      headSha: "bbbbbbbb",
      state: "WATCHING",
    });
    repositories.insertRemoteEventVersion({
      id: "event-persistence-1",
      managedPrId: "pr-1",
      sourceKind: "REVIEW_COMMENT",
      sourceId: "comment-persistence-1",
      observedAt: TIME,
      semanticHash: "semantic-persistence-1",
      payload: { body: "Please fix this." },
    });
    const f18 = new F18PersistenceRepositories(repositories);
    const initial = record();
    const committed = f18.persistIntent({
      record: initial,
      events: [
        {
          id: "event-persistence-1",
          managedPrId: "pr-1",
          sourceKind: "REVIEW_COMMENT",
          sourceId: "comment-persistence-1",
          observedAt: TIME,
          semanticHash: "semantic-persistence-1",
          payload: { body: "Please fix this." },
        },
      ],
    });
    expect(committed.phase).toBe("ADMITTED");
    const withProposal = f18.update({
      record: f18ReviewBundleRecordSchema.parse({
        ...committed,
        state: "READY_FOR_REVIEW",
        phase: "PROPOSAL_RECORDED",
        items: [
          {
            itemId: "f18-item-event-persistence-1",
            eventVersionId: "event-persistence-1",
            recommendation: {
              remoteEventVersionId: "event-persistence-1",
              assessment: "actionable",
              disposition: "fixed",
              explanation: "A bounded fix is appropriate.",
              relatedFiles: [],
            },
            decision: { decision: "pending", finalDisposition: "no_change" },
            decisionHistory: [
              { decision: "pending", finalDisposition: "no_change" },
            ],
          },
        ],
        nextAction: "REVIEW_DECISIONS",
        updatedAt: TIME,
        version: 2,
      }),
      expectedBundleVersion: committed.version,
    });
    const decided = f18.recordDecision({
      bundleId: withProposal.bundleId,
      itemId: "f18-item-event-persistence-1",
      decision: "accepted",
      finalDisposition: "fixed",
      instruction: "Apply it.",
      expectedVersion: withProposal.version,
    });
    expect(decided.items[0]?.decision.finalDisposition).toBe("fixed");
    expect(decided.items[0]?.decisionHistory).toHaveLength(2);
    const reopened = await initializePersistence(
      {
        databasePath: path.join(root, "database", "prmonitor.sqlite"),
        backupRoot: path.join(root, "backups"),
      },
      { clock: { now: () => TIME }, applicationBuild: "f18-restart-test" },
    );
    try {
      const afterRestart = new F18PersistenceRepositories(
        createPersistenceRepositories(reopened, { clock: { now: () => TIME } }),
      ).get("bundle-persistence-1");
      expect(afterRestart?.items[0]?.decision.finalDisposition).toBe("fixed");
      expect(afterRestart?.items[0]?.decisionHistory).toHaveLength(2);
    } finally {
      reopened.close();
    }
  });
});
