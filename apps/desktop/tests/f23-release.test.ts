import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { F13InspectionResult } from "../src/shared/f13-contracts";
import type { F18AutomaticReviewBoundary } from "../src/main/automatic-review-coordinator";
import type { F14ValidationReadModel } from "../src/main/f14-validation-runner";
import type { F22Coordinator } from "../src/main/f22-coordinator";
import {
  F23PublicationService,
  type F23GitPublisher,
  type F23HoldPort,
  type F23ResponsePublisher,
} from "../src/main/f23-release-service";
import type { F18ReviewBundleReadModel } from "../src/shared/f18-automatic-review";
import {
  f22GateFor,
  initialF22BundleState,
  type F22ActionGate,
} from "../src/shared/f22-discard-reevaluation";
import type { F23ApprovalInput } from "../src/shared/f23-release";
import {
  createPersistenceRepositories,
  initializePersistence,
} from "../src/main/persistence";

const NOW = "2026-09-27T12:00:00.000Z";
const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const COMMIT_SHA = "c".repeat(40);

interface Fixture {
  readonly root: string;
  readonly store: Awaited<ReturnType<typeof initializePersistence>>;
  cleanup(): Promise<void>;
}

const fixtures: Fixture[] = [];

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function bundle(
  options: {
    readonly response?: boolean;
    readonly changedFiles?: readonly string[];
  } = {},
): F18ReviewBundleReadModel {
  const includeResponse = options.response === true;
  const feedback = includeResponse
    ? [
        {
          eventVersionId: "event-f23-1",
          semanticHash: "d".repeat(64),
          sourceKind: "ISSUE_COMMENT",
          sourceId: "comment-f23-1",
          observedAt: NOW,
          body: "Please address this review item.",
        },
      ]
    : [];
  return {
    schemaVersion: 1,
    kind: "REVIEW_BUNDLE_READ_MODEL",
    bundleId: "bundle-f23-release",
    managedPrId: "managed-pr-f23-release",
    batchId: "batch-f23-release",
    operationId: "operation-f23-release",
    state: "READY_FOR_REVIEW",
    stage: "FINAL_REVIEW",
    phase: "FINAL_RECORDED",
    version: 3,
    input: {
      schemaVersion: 1,
      bundleId: "bundle-f23-release",
      managedPrId: "managed-pr-f23-release",
      batchId: "batch-f23-release",
      operationId: "operation-f23-release",
      claimId: "claim-f23-release",
      correlationId: "correlation-f23-release",
      schedulerRevision: 1,
      pullRequest: {
        baseRepository: {
          serverId: "github.example.invalid",
          owner: "owner",
          name: "repo",
          key: "github.example.invalid/owner/repo",
        },
        headRepository: {
          serverId: "github.example.invalid",
          owner: "owner",
          name: "repo",
          key: "github.example.invalid/owner/repo",
        },
        baseBranch: "main",
        headBranch: "feature",
        baseSha: BASE_SHA,
        headSha: HEAD_SHA,
      },
      feedback,
      remoteEventVersionIds: ["event-f23-release"],
    },
    items: [],
    draftResponses: includeResponse
      ? [
          {
            eventVersionId: "event-f23-1",
            text: "Thanks — this has been addressed.",
            source: "MODEL_PROPOSAL",
          },
        ]
      : [],
    postChangeValidation: {
      runId: "validation-f23-release",
      operationId: "operation-f23-release",
      requestedPhase: "post_change",
      status: "passed",
      nextAction: "NONE",
      warningCodes: [],
      steps: [],
      version: 1,
    },
    worktree: {
      operationId: "operation-f23-release",
      worktreeId: "worktree-f23-release",
      ownerType: "REVIEW_BUNDLE",
      ownerId: "bundle-f23-release",
      canonicalPath: "C:\\PRMonitor\\review-f23-release",
      rootRevision: 4,
      snapshotId: "snapshot-f23-release",
      baselineSha: BASE_SHA,
      stateFingerprint: "fingerprint-f23-release",
      clean: false,
      complete: true,
      changedFiles: [...(options.changedFiles ?? ["src/app.ts"])],
    },
    reasons: [],
    nextAction: "NONE",
    decisionSummary: {
      total: 0,
      decided: 0,
      fixed: 0,
      questionsNeedingAnswer: 0,
      complete: true,
    },
    capabilities: {
      canPublish: false,
      canCommit: false,
      canPush: false,
      canPostReply: false,
    },
    evidenceAuthority: {
      proposal: "F15_STRUCTURED_RESULT",
      worktree: "F13_DETERMINISTIC",
      validation: "F14_DETERMINISTIC",
      lifecycle: "F17_DETERMINISTIC",
    },
  } as unknown as F18ReviewBundleReadModel;
}

function gateFor(
  source: F18ReviewBundleReadModel,
  status: "CURRENT" | "STALE" = "CURRENT",
): F22ActionGate {
  const registered = initialF22BundleState({
    bundle: source,
    identity: {
      serverId: "github.example.invalid",
      repositoryKey: "github.example.invalid/owner/repo",
    },
  });
  const base = f22GateFor(source, {
    ...registered,
    status,
    revision: status === "CURRENT" ? 1 : 2,
    observedIdentity: registered.identity,
    observedBaseSha: BASE_SHA,
    observedHeadSha: HEAD_SHA,
    observedBaseRepository: source.input.pullRequest.baseRepository,
    observedHeadRepository: source.input.pullRequest.headRepository,
    observedBaseBranch: source.input.pullRequest.baseBranch,
    observedHeadBranch: source.input.pullRequest.headBranch,
    observationRevision: 7,
    observedAt: NOW,
    ...(status === "STALE"
      ? {
          reason: {
            code: "REMOTE_HEAD_MOVED",
            what: "The pull-request head moved.",
            why: "The approved candidate no longer matches the remote head.",
            nextAction: "RE_EVALUATE",
            details: {},
          },
        }
      : {}),
  });
  return {
    ...base,
    remote: {
      ...base.remote,
      observationToken: "f22-observation-f23-release",
    },
  };
}

function inspectionFor(changedFiles: readonly string[]): F13InspectionResult {
  return {
    ok: true,
    worktree: {
      operationId: "operation-f23-release",
      ownerId: "bundle-f23-release",
      canonicalPath: "C:\\PRMonitor\\review-f23-release",
      currentHeadSha: BASE_SHA,
      worktreeBaselineSha: BASE_SHA,
    },
    condition: {
      classification: "AI_ATTRIBUTED_ONLY",
      currentFingerprint: "fingerprint-f23-release",
      attribution: { complete: true },
    },
    proposedDiff: {
      diffId: "diff-f23-release",
      diffHash: "e".repeat(64),
      patchHash: "f".repeat(64),
      files: changedFiles.map((file) => ({ path: file })),
      untrackedFiles: [],
      complete: true,
    },
  } as unknown as F13InspectionResult;
}

function fakeGit(
  options: {
    readonly commitResults?: readonly Awaited<
      ReturnType<F23GitPublisher["commitCandidate"]>
    >[];
    readonly pushResults?: readonly Awaited<
      ReturnType<F23GitPublisher["pushCommit"]>
    >[];
    readonly reconcilePushResults?: readonly Awaited<
      ReturnType<F23GitPublisher["reconcilePush"]>
    >[];
  } = {},
): {
  readonly git: F23GitPublisher;
  readonly commitCalls: () => number;
  readonly pushCalls: () => number;
  readonly reconcilePushCalls: () => number;
} {
  let commitCount = 0;
  let pushCount = 0;
  let reconcilePushCount = 0;
  const commitResults = [
    ...(options.commitResults ?? [
      { outcome: "COMMITTED", commitSha: COMMIT_SHA },
    ]),
  ];
  const pushResults = [...(options.pushResults ?? [{ outcome: "PUSHED" }])];
  const reconcilePushResults = [
    ...(options.reconcilePushResults ?? [{ outcome: "ABSENT" }]),
  ];
  return {
    git: {
      commitCandidate: async () => {
        commitCount += 1;
        return (
          commitResults.shift() ?? {
            outcome: "COMMITTED",
            commitSha: COMMIT_SHA,
          }
        );
      },
      pushCommit: async () => {
        pushCount += 1;
        return pushResults.shift() ?? { outcome: "PUSHED" };
      },
      reconcileCommit: async () => ({ outcome: "ABSENT" }),
      reconcilePush: async () => {
        reconcilePushCount += 1;
        return reconcilePushResults.shift() ?? { outcome: "ABSENT" };
      },
    },
    commitCalls: () => commitCount,
    pushCalls: () => pushCount,
    reconcilePushCalls: () => reconcilePushCount,
  };
}

function fakeResponses(
  options: {
    readonly postResults?: readonly Awaited<
      ReturnType<F23ResponsePublisher["postResponse"]>
    >[];
    readonly reconcileResults?: readonly Awaited<
      ReturnType<F23ResponsePublisher["reconcileResponse"]>
    >[];
  } = {},
): {
  readonly responses: F23ResponsePublisher;
  readonly postCalls: () => number;
  readonly reconcileCalls: () => number;
} {
  let postCount = 0;
  let reconcileCount = 0;
  const postResults = [
    ...(options.postResults ?? [
      { outcome: "CONFIRMED", remoteId: "remote-response-1" },
    ]),
  ];
  const reconcileResults = [
    ...(options.reconcileResults ?? [
      { outcome: "CONFIRMED", remoteId: "remote-response-1" },
    ]),
  ];
  return {
    responses: {
      postResponse: async () => {
        postCount += 1;
        return (
          postResults.shift() ?? {
            outcome: "CONFIRMED",
            remoteId: "remote-response-1",
          }
        );
      },
      reconcileResponse: async () => {
        reconcileCount += 1;
        return (
          reconcileResults.shift() ?? {
            outcome: "CONFIRMED",
            remoteId: "remote-response-1",
          }
        );
      },
    },
    postCalls: () => postCount,
    reconcileCalls: () => reconcileCount,
  };
}

async function harness(options: {
  readonly response?: boolean;
  readonly changedFiles?: readonly string[];
  readonly gateStatus?: "CURRENT" | "STALE";
  readonly git?: F23GitPublisher;
  readonly responses?: F23ResponsePublisher;
}) {
  const source = bundle(options);
  const root = await mkdtemp(path.join(os.tmpdir(), "prmonitor-f23-release-"));
  const store = await initializePersistence(
    {
      databasePath: path.join(root, "database", "prmonitor.sqlite"),
      backupRoot: path.join(root, "backups"),
    },
    { clock: { now: () => NOW }, applicationBuild: "f23-release-test" },
  );
  fixtures.push({
    root,
    store,
    async cleanup() {
      store.close();
      await rm(root, { recursive: true, force: true });
    },
  });
  const persistence = createPersistenceRepositories(store, {
    clock: { now: () => NOW },
  });
  const gate = gateFor(source, options.gateStatus ?? "CURRENT");
  const f22 = {
    readGate: () => gate,
    observeRemoteHead: async () => gate,
  } as unknown as F22Coordinator;
  const bundles = {
    getReadModel: () => source,
  } as unknown as F18AutomaticReviewBoundary;
  const holdCalls: Array<string> = [];
  const hold: F23HoldPort = {
    completeAutomaticReview: ({ outcome }) => {
      holdCalls.push(outcome);
      return { outcome: "RELEASED" };
    },
  };
  const service = new F23PublicationService({
    persistence,
    bundles,
    worktrees: {
      inspectOperation: async () =>
        inspectionFor(options.changedFiles ?? ["src/app.ts"]),
    },
    f22,
    managedPrs: {
      get: () => ({
        managedPrId: source.managedPrId,
        serverId: "github.example.invalid",
        owner: "owner",
        repositoryName: "repo",
        number: 7,
      }),
    },
    ...(options.git === undefined ? {} : { git: options.git }),
    ...(options.responses === undefined
      ? {}
      : { responses: options.responses }),
    validation: {
      readModel: () => ({ status: "passed" }) as F14ValidationReadModel,
    },
    hold,
    clock: () => NOW,
  });
  return { service, source, persistence, holdCalls };
}

function approvalFor(
  bundleId: string,
  candidate: NonNullable<
    Awaited<ReturnType<F23PublicationService["read"]>>["candidate"]
  >,
  idempotencyKey: string,
  responses: F23ApprovalInput["responses"] = [],
): F23ApprovalInput {
  return {
    bundleId,
    candidateHash: candidate.candidateHash,
    expectedBundleVersion: candidate.bundleVersion,
    expectedEvidenceRevision: candidate.evidenceRevision,
    expectedGateRevision: candidate.gateRevision,
    approvalId: `${idempotencyKey}-approval`,
    idempotencyKey,
    commitMessage: candidate.commitMessage,
    completeDiffAcknowledged: true,
    unattributedChangesAcknowledged: false,
    responses,
  };
}

describe("F23 durable human-approved release orchestration", () => {
  afterEach(async () => {
    while (fixtures.length > 0) {
      const fixture = fixtures.pop();
      if (fixture !== undefined) await fixture.cleanup();
    }
  });

  it("commits and pushes the approved candidate once, then replays the terminal result", async () => {
    const git = fakeGit();
    const runtime = await harness({ git: git.git });
    const candidate = (await runtime.service.read(runtime.source.bundleId))
      .candidate!;
    const input = approvalFor(
      runtime.source.bundleId,
      candidate,
      "release-once",
    );

    expect((await runtime.service.approve(input)).outcome).toBe(
      "APPROVAL_RECORDED",
    );
    const published = await runtime.service.publish({
      bundleId: runtime.source.bundleId,
      idempotencyKey: input.idempotencyKey,
    });
    expect(published.outcome).toBe("PUBLISHED");
    expect(git.commitCalls()).toBe(1);
    expect(git.pushCalls()).toBe(1);
    expect(runtime.holdCalls).toEqual(["PUBLISHED"]);
    expect(published.readModel.publication?.commitSha).toBe(COMMIT_SHA);

    const replay = await runtime.service.publish({
      bundleId: runtime.source.bundleId,
      idempotencyKey: input.idempotencyKey,
    });
    expect(replay.outcome).toBe("PUBLISHED");
    expect(git.commitCalls()).toBe(1);
    expect(git.pushCalls()).toBe(1);
    expect(runtime.holdCalls).toEqual(["PUBLISHED"]);
  });

  it("marks partial response failure without republishing code and retries responses only", async () => {
    const git = fakeGit();
    const responses = fakeResponses({
      postResults: [
        { outcome: "FAILED", reason: "RATE_LIMITED" },
        { outcome: "CONFIRMED", remoteId: "remote-response-1" },
      ],
    });
    const runtime = await harness({
      response: true,
      git: git.git,
      responses: responses.responses,
    });
    const candidate = (await runtime.service.read(runtime.source.bundleId))
      .candidate!;
    const editedBody = "Thanks — the requested change is now included.";
    const input = approvalFor(
      runtime.source.bundleId,
      candidate,
      "release-response-retry",
      [
        {
          responseKey: candidate.responses[0]!.responseKey,
          included: true,
          body: editedBody,
          bodyHash: sha256(editedBody),
        },
      ],
    );

    await runtime.service.approve(input);
    const first = await runtime.service.publish({
      bundleId: runtime.source.bundleId,
      idempotencyKey: input.idempotencyKey,
    });
    expect(first.outcome).toBe("PUBLISHED_WITH_ERRORS");
    expect(first.readModel.responseOnlyRetry).toBe(true);
    expect(first.readModel.publication?.codePublished).toBe(true);
    expect(git.commitCalls()).toBe(1);
    expect(git.pushCalls()).toBe(1);
    expect(responses.postCalls()).toBe(1);
    expect(runtime.holdCalls).toEqual(["PUBLISHED_WITH_ERRORS"]);

    const retried = await runtime.service.retryResponses({
      bundleId: runtime.source.bundleId,
      idempotencyKey: input.idempotencyKey,
    });
    expect(retried.outcome).toBe("PUBLISHED");
    expect(git.commitCalls()).toBe(1);
    expect(git.pushCalls()).toBe(1);
    expect(responses.postCalls()).toBe(2);
    expect(runtime.holdCalls).toEqual(["PUBLISHED_WITH_ERRORS"]);
  });

  it("reconciles an uncertain push before retrying and never duplicates a confirmed response", async () => {
    const git = fakeGit({
      pushResults: [{ outcome: "UNCERTAIN", reason: "NETWORK_TIMEOUT" }],
      reconcilePushResults: [{ outcome: "PRESENT" }],
    });
    const runtime = await harness({ git: git.git });
    const candidate = (await runtime.service.read(runtime.source.bundleId))
      .candidate!;
    const input = approvalFor(
      runtime.source.bundleId,
      candidate,
      "release-push-reconcile",
    );
    await runtime.service.approve(input);

    const uncertain = await runtime.service.publish({
      bundleId: runtime.source.bundleId,
      idempotencyKey: input.idempotencyKey,
    });
    expect(uncertain.outcome).toBe("RECONCILIATION_REQUIRED");
    expect(uncertain.readModel.status).toBe("RECOVERING");

    const reconciled = await runtime.service.reconcile({
      bundleId: runtime.source.bundleId,
      idempotencyKey: input.idempotencyKey,
    });
    expect(reconciled.outcome).toBe("PUBLISHED");
    expect(git.commitCalls()).toBe(1);
    expect(git.pushCalls()).toBe(1);
    expect(git.reconcilePushCalls()).toBe(1);
  });

  it("supports response-only release without invoking Git and blocks stale F22 approval", async () => {
    const responses = fakeResponses();
    const noCode = await harness({
      response: true,
      changedFiles: [],
      responses: responses.responses,
    });
    const noCodeCandidate = (await noCode.service.read(noCode.source.bundleId))
      .candidate!;
    const noCodeApproval = approvalFor(
      noCode.source.bundleId,
      noCodeCandidate,
      "release-response-only",
      [
        {
          responseKey: noCodeCandidate.responses[0]!.responseKey,
          included: true,
          body: noCodeCandidate.responses[0]!.body,
          bodyHash: noCodeCandidate.responses[0]!.bodyHash,
        },
      ],
    );
    await noCode.service.approve(noCodeApproval);
    const noCodeResult = await noCode.service.publish({
      bundleId: noCode.source.bundleId,
      idempotencyKey: noCodeApproval.idempotencyKey,
    });
    expect(noCodeResult.outcome).toBe("PUBLISHED");
    expect(noCodeResult.readModel.publication?.codePublished).toBe(false);
    expect(responses.postCalls()).toBe(1);

    const staleGit = fakeGit();
    const stale = await harness({ git: staleGit.git, gateStatus: "STALE" });
    const staleRead = await stale.service.read(stale.source.bundleId);
    const staleResult = await stale.service.approve(
      approvalFor(stale.source.bundleId, staleRead.candidate!, "release-stale"),
    );
    expect(staleResult.outcome).toBe("BLOCKED");
    expect(staleResult.readModel.reasons[0]?.code).toBe("REMOTE_HEAD_MOVED");
    expect(staleGit.commitCalls()).toBe(0);
    expect(staleGit.pushCalls()).toBe(0);
  });
});
