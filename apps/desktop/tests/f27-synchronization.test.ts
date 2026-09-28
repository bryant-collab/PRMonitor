import { describe, expect, it } from "vitest";
import type {
  F13ClearResult,
  F13InspectionResult,
} from "../src/shared/f13-contracts";
import { f25Reason } from "../src/shared/f25-synchronization";
import type {
  F25SynchronizationBatchReadModel,
  F25SynchronizationResultReadModel,
} from "../src/shared/f25-synchronization";
import type {
  F27FreshnessRead,
  F27GitPublisher,
  F27HeadAdvanceInvalidation,
  F27StateRecord,
} from "../src/shared/f27-synchronization";
import {
  F27SynchronizationService,
  type F27F25Port,
  type F27FreshnessPort,
  type F27PublicationPersistencePort,
  type F27ReevaluationPort,
  type F27WorktreePort,
} from "../src/main/f27-synchronization-service";
import type { F27PersistencePort } from "../src/main/persistence/f27-repositories";
import type {
  PublicationIntentInput,
  PublicationIntentRecord,
} from "../src/main/persistence";

const NOW = "2026-09-28T12:00:00.000Z";
const SOURCE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const BASE_SHA = "c".repeat(40);
const COMMIT_SHA = "d".repeat(40);

function row(managedPrId: string) {
  const server = {
    kind: "GITHUB_COM" as const,
    webOrigin: "github.example.invalid",
    apiBaseUrl: "https://github.example.invalid/api",
    host: "github.example.invalid",
    serverKey: "github.example.invalid",
  };
  const repository = (owner: string, name: string) => ({
    schemaVersion: 1 as const,
    server,
    owner,
    name,
    key: `github:${owner}/${name}`,
    available: true as const,
  });
  return {
    schemaVersion: 1 as const,
    managedPrId,
    configurationRevisionId: `configuration-${managedPrId}`,
    configurationRevision: 1,
    inboxProjectionRevision: 1,
    sourceProvenance: "PR_BASE_BRANCH" as const,
    syncSourceBranch: "main",
    prHeadBranch: "feature",
    sourceRepository: repository("source", "repo"),
    destinationRepository: repository("destination", "repo"),
    syncSourceSha: SOURCE_SHA,
    prHeadSha: HEAD_SHA,
    storedPrBaseSha: BASE_SHA,
    storedPrHeadSha: HEAD_SHA,
    currentPrState: "OPEN" as const,
    currentPrMerged: false,
    observedAt: NOW,
    observationRevision: `observation-${managedPrId}`,
    observations: [],
    eligibility: "ELIGIBLE" as const,
    reason: {
      schemaVersion: 1 as const,
      code: "ELIGIBLE",
      category: "ELIGIBLE" as const,
      what: "The exact synchronization row is eligible.",
      why: "The test supplies both exact repository identities and SHAs.",
      nextAction: "NONE" as const,
      retryable: false,
      correlationId: `f24-${managedPrId}`,
    },
    operationId: `operation-${managedPrId}`,
  };
}

function worktree(operationId: string) {
  return {
    operationId,
    worktreeId: `worktree-${operationId}`,
    ownerId: operationId,
    canonicalPath: `C:\\worktrees\\${operationId}`,
    rootRevision: 1,
    baselineSha: HEAD_SHA,
    currentHeadSha: HEAD_SHA,
    condition: "UNATTRIBUTED_CHANGES" as const,
    stateFingerprint: "current-fingerprint",
  };
}

function inspection(
  operationId: string,
  changedFiles: readonly string[] = ["source.txt"],
): F13InspectionResult {
  const record = {
    worktreeId: `worktree-${operationId}`,
    operationId,
    ownerType: "SYNCHRONIZATION",
    ownerId: operationId,
    operationKind: "SYNCHRONIZATION" as const,
    canonicalPath: `C:\\worktrees\\${operationId}`,
    configuredRoot: "C:\\worktrees",
    rootRevision: 1,
    lifecycle: "DIRTY" as const,
    refs: {
      sourceRepository: {
        serverId: "github.example.invalid",
        owner: "source",
        name: "repo",
      },
      destinationRepository: {
        serverId: "github.example.invalid",
        owner: "destination",
        name: "repo",
      },
      sourceBranch: "main",
      destinationBranch: "feature",
      syncSourceSha: SOURCE_SHA,
      prHeadSha: HEAD_SHA,
      syncMergeBaseSha: BASE_SHA,
    },
    sourceRepository: {
      serverId: "github.example.invalid",
      owner: "source",
      name: "repo",
    },
    destinationRepository: {
      serverId: "github.example.invalid",
      owner: "destination",
      name: "repo",
    },
    currentHeadSha: HEAD_SHA,
    worktreeBaselineSha: HEAD_SHA,
    available: true,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
  return {
    ok: true,
    worktree: record,
    condition: {
      schemaVersion: 1,
      classification:
        changedFiles.length === 0 ? "CLEAN" : "UNATTRIBUTED_CHANGES",
      currentFingerprint: "current-fingerprint",
      observedRevision: "observed-revision",
      expectedRevision: HEAD_SHA,
      dirtySummary: {
        changedPaths: changedFiles,
        trackedPaths: changedFiles,
        stagedPaths: [],
        untrackedPaths: [],
        ignoredPaths: [],
        hash: "dirty-hash",
      },
      attribution: {
        evidenceRef: "attribution-evidence",
        aiAttributedPaths: [],
        unAttributedPaths: changedFiles,
        overlapPaths: [],
        complete: true,
      },
      permittedNextActions: ["REVALIDATE_FOR_PUBLICATION"],
    },
    proposedDiff: {
      diffId: `diff-${operationId}`,
      operationId,
      worktreeId: `worktree-${operationId}`,
      kind: "PROPOSED",
      baselineSha: HEAD_SHA,
      diffHash: "diff-hash",
      patchHash: "patch-hash",
      files: changedFiles.map((path) => ({
        path,
        kind: "modified" as const,
        staged: false,
        worktreeChanged: true,
      })),
      untrackedFiles: [],
      complete: true,
      regenerationContract: "test",
      createdAt: NOW,
    },
  };
}

function result(
  managedPrId: string,
  mergeOutcome: "NO_OP" | "CLEAN_MERGE" = "CLEAN_MERGE",
): F25SynchronizationResultReadModel {
  const operationId = `operation-${managedPrId}`;
  return {
    schemaVersion: 1,
    kind: "synchronization-result",
    operationId,
    batchId: `batch-${managedPrId}`,
    managedPrId,
    status: "READY_TO_PUBLISH",
    stage: "COMPLETED",
    mergeOutcome,
    input: {
      schemaVersion: 1,
      authorizationId: "authorization",
      intentId: "intent",
      idempotencyKey: `idempotency-${managedPrId}`,
      resolutionRevision: "resolution",
      operationId,
      row: row(managedPrId),
      capturedAt: NOW,
    },
    worktree: worktree(operationId),
    mergeBaseSha: BASE_SHA,
    sourceChangeEvidence: {
      schemaVersion: 1,
      side: "SOURCE",
      baseSha: BASE_SHA,
      tipSha: SOURCE_SHA,
      files: [],
      evidenceHash: "source-evidence",
      complete: true,
    },
    prHeadChangeEvidence: {
      schemaVersion: 1,
      side: "DESTINATION",
      baseSha: BASE_SHA,
      tipSha: HEAD_SHA,
      files: [],
      evidenceHash: "destination-evidence",
      complete: true,
    },
    conflicts: [],
    validation: {
      runId: `validation-${managedPrId}`,
      status: "passed",
      warnings: [],
      version: 1,
      nextAction: "NONE",
    },
    aiUsage: { providerInvoked: false, turns: 0, tokens: 0 },
    reason: f25Reason({
      code: "F25_READY",
      what: "The exact synchronization result is ready for review.",
      why: "The worktree and validation evidence are complete.",
      nextAction: "REVIEW",
      correlationId: `f25-${managedPrId}`,
    }),
    nextAction: "REVIEW",
    capabilities: {
      canCommit: false,
      canPush: false,
      canPublish: false,
      canInvokeAi: false,
    },
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

class MemoryF25 implements F27F25Port {
  public constructor(
    public readonly values: readonly F25SynchronizationResultReadModel[],
  ) {}
  public readBatch(
    batchId: string,
  ): F25SynchronizationBatchReadModel | undefined {
    const values = this.values.filter((value) => value.batchId === batchId);
    if (values.length === 0) return undefined;
    return {
      schemaVersion: 1,
      kind: "synchronization-batch",
      batchId,
      authorizationId: "authorization",
      intentId: "intent",
      idempotencyKey: `batch-key-${batchId}`,
      resolutionRevision: "resolution",
      status: "COMPLETED",
      authorization: {} as never,
      operationIds: values.map((value) => value.operationId),
      counts: {
        total: values.length,
        eligible: values.length,
        skipped: 0,
        ready: values.length,
        attention: 0,
        failed: 0,
        pending: 0,
      },
      results: values,
      capabilities: {
        canCommit: false,
        canPush: false,
        canPublish: false,
        canInvokeAi: false,
      },
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    };
  }
  public listBatches(): readonly F25SynchronizationBatchReadModel[] {
    return [...new Set(this.values.map((value) => value.batchId))].flatMap(
      (id) => {
        const batch = this.readBatch(id);
        return batch === undefined ? [] : [batch];
      },
    );
  }
  public readResult(operationId: string) {
    return this.values.find((value) => value.operationId === operationId);
  }
}

class MemoryState implements F27PersistencePort {
  public readonly values = new Map<string, F27StateRecord>();
  public readonly invalidations = new Map<string, F27HeadAdvanceInvalidation>();
  public getState(operationId: string) {
    return this.values.get(operationId);
  }
  public listStates() {
    return [...this.values.values()];
  }
  public putState(input: { state: F27StateRecord; expectedVersion?: number }) {
    const current = this.values.get(input.state.operationId);
    if (
      input.expectedVersion !== undefined &&
      (current?.version ?? 0) !== input.expectedVersion
    )
      throw new Error("CONFLICT");
    this.values.set(input.state.operationId, input.state);
    return input.state;
  }
  public getHeadAdvanceInvalidation(operationId: string) {
    return this.invalidations.get(operationId);
  }
  public putHeadAdvanceInvalidation(input: F27HeadAdvanceInvalidation) {
    this.invalidations.set(input.operationId, input);
    return input;
  }
}

class MemoryPublication implements F27PublicationPersistencePort {
  public readonly approvals = new Set<string>();
  public readonly intents = new Map<string, PublicationIntentRecord>();
  public saveApproval(input: { approvalId: string }) {
    this.approvals.add(input.approvalId);
  }
  public createPublicationIntent(
    input: PublicationIntentInput,
  ): PublicationIntentRecord {
    const existing = this.intents.get(input.idempotencyKey);
    if (existing !== undefined) return existing;
    const record: PublicationIntentRecord = {
      id: input.id,
      schemaVersion: 1,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
      payload: input.payload ?? {},
      payloadHash: "payload-hash",
      kind: input.kind,
      ownerId: input.ownerId,
      approvalId: input.approvalId,
      idempotencyKey: input.idempotencyKey,
      phase: "PREPARED",
      recoveryState: "READY",
      expectedBaselineSha: input.expectedBaselineSha,
      expectedSourceSha: input.expectedSourceSha,
      expectedHeadSha: input.expectedHeadSha,
      proposedResult: input.proposedResult,
      responses: [],
    };
    this.intents.set(input.idempotencyKey, record);
    return record;
  }
  public getPublicationIntent(
    _kind: PublicationIntentInput["kind"],
    key: string,
  ) {
    return this.intents.get(key);
  }
  public updatePublicationIntent(input: {
    publicationId: string;
    expectedVersion: number;
    phase: string;
    recoveryState: string;
    knownCommitSha?: string;
    pushEvidence?: unknown;
    payload?: unknown;
  }) {
    const current = [...this.intents.values()].find(
      (candidate) => candidate.id === input.publicationId,
    );
    if (current === undefined || current.version !== input.expectedVersion)
      throw new Error("CONFLICT");
    const next: PublicationIntentRecord = {
      ...current,
      version: current.version + 1,
      updatedAt: NOW,
      phase: input.phase,
      recoveryState: input.recoveryState,
      ...(input.knownCommitSha === undefined
        ? {}
        : { knownCommitSha: input.knownCommitSha }),
      payload: input.payload ?? current.payload,
    };
    this.intents.set(current.idempotencyKey, next);
    return next;
  }
  public listPublicationIntents(kind?: PublicationIntentInput["kind"]) {
    return [...this.intents.values()].filter(
      (candidate) => kind === undefined || candidate.kind === kind,
    );
  }
  public recordExternalEffect() {}
}

function service(
  values: readonly F25SynchronizationResultReadModel[],
  freshness: F27FreshnessRead | (() => F27FreshnessRead),
  git: F27GitPublisher,
) {
  const f25 = new MemoryF25(values);
  const persistence = new MemoryState();
  const publication = new MemoryPublication();
  const worktrees: F27WorktreePort = {
    inspectOperation: async (operationId) =>
      inspection(
        operationId,
        values[0]?.mergeOutcome === "NO_OP" ? [] : ["source.txt"],
      ),
    clearChanges: async (input): Promise<F13ClearResult> => ({
      ok: input.choice !== "CLEAR_ALL" || input.confirmed === true,
      choice: input.choice,
      worktree: inspection(input.operationId, []).worktree,
      removed: input.choice === "KEEP_AND_CANCEL" ? [] : ["source.txt"],
      preserved: [],
      remaining: [],
    }),
  };
  const freshnessPort: F27FreshnessPort = {
    read: async () =>
      typeof freshness === "function" ? freshness() : freshness,
  };
  const reevaluation: F27ReevaluationPort = {
    start: async () => ({ status: "ACKNOWLEDGED", batchId: "new-batch" }),
  };
  const instance = new F27SynchronizationService({
    f25,
    persistence,
    publication,
    worktrees,
    freshness: freshnessPort,
    reevaluation,
    git,
    now: () => NOW,
  });
  return { instance, persistence, publication };
}

const currentFreshness: F27FreshnessRead = {
  outcome: "CURRENT",
  checkedAt: NOW,
  sourceSha: SOURCE_SHA,
  headSha: HEAD_SHA,
  sourceRepositoryKey: "github:source/repo",
  destinationRepositoryKey: "github:destination/repo",
  sourceBranch: "main",
  destinationBranch: "feature",
  state: "OPEN",
  merged: false,
};

describe("F27 synchronization result review and publication", () => {
  it("projects batches and keeps clean/no-op results at zero AI usage", () => {
    const source = result("no-op", "NO_OP");
    const { instance } = service([source], currentFreshness, {
      commitMerge: async () => ({ outcome: "NO_CODE_CHANGE" }),
      pushMerge: async () => ({ outcome: "PUSHED" }),
      reconcileCommit: async () => ({ outcome: "ABSENT" }),
      reconcilePush: async () => ({ outcome: "ABSENT" }),
    });
    const batch = instance.listBatches()[0]!;
    expect(batch.counts.ready).toBe(1);
    const review = instance.readResult(source.operationId)!;
    expect(review.aiUsage.providerInvoked).toBe(false);
    expect(review.mergeOutcome).toBe("NO_OP");
    expect(review.capabilities.approvePublication).toBe(true);
  });

  it("marks moved input stale but never infers movement from an unavailable read", async () => {
    const source = result("stale");
    const unavailable: F27FreshnessRead = {
      outcome: "UNAVAILABLE",
      checkedAt: NOW,
    };
    let remote = unavailable;
    const first = service([source], () => remote, {
      commitMerge: async () => ({ outcome: "FAILED", reason: "not-used" }),
      pushMerge: async () => ({ outcome: "FAILED", reason: "not-used" }),
      reconcileCommit: async () => ({ outcome: "UNKNOWN", reason: "not-used" }),
      reconcilePush: async () => ({ outcome: "UNKNOWN", reason: "not-used" }),
    });
    const attention = await first.instance.refreshFreshness({
      operationId: source.operationId,
      expectedRevision: 1,
    });
    expect(attention.status).toBe("UNKNOWN");
    remote = {
      ...currentFreshness,
      outcome: "MOVED",
      sourceSha: "e".repeat(40),
    };
    const stale = await first.instance.refreshFreshness({
      operationId: source.operationId,
      expectedRevision: attention.revision,
    });
    expect(stale.status).toBe("STALE");
  });

  it("publishes a no-op without commit or push and records approval first", async () => {
    const source = result("publish-no-op", "NO_OP");
    let commits = 0;
    let pushes = 0;
    const built = service([source], currentFreshness, {
      commitMerge: async () => {
        commits += 1;
        return { outcome: "COMMITTED", commitSha: COMMIT_SHA };
      },
      pushMerge: async () => {
        pushes += 1;
        return { outcome: "PUSHED" };
      },
      reconcileCommit: async () => ({ outcome: "ABSENT" }),
      reconcilePush: async () => ({ outcome: "ABSENT" }),
    });
    const fresh = await built.instance.refreshFreshness({
      operationId: source.operationId,
      expectedRevision: 1,
    });
    const approved = await built.instance.approvePublication({
      operationId: source.operationId,
      expectedRevision: fresh.revision,
      approvalId: "approval-no-op",
      idempotencyKey: "publish-no-op",
      candidateHash: fresh.candidateHash,
      commitMessage: "Synchronize main into feature",
      completeDiffAcknowledged: true,
      noCodeChangeAcknowledged: true,
    });
    expect(approved.status).toBe("PUBLISHING");
    expect(built.publication.approvals.has("approval-no-op")).toBe(true);
    const published = await built.instance.publish({
      operationId: source.operationId,
      idempotencyKey: "publish-no-op",
    });
    expect(published.status).toBe("PUBLISHED");
    expect(commits).toBe(0);
    expect(pushes).toBe(0);
  });

  it("publishes one changed result and leaves a sibling result untouched", async () => {
    const first = result("changed");
    const sibling = result("sibling");
    let commits = 0;
    let pushes = 0;
    const built = service([first, sibling], currentFreshness, {
      commitMerge: async () => {
        commits += 1;
        return { outcome: "COMMITTED", commitSha: COMMIT_SHA };
      },
      pushMerge: async () => {
        pushes += 1;
        return { outcome: "PUSHED" };
      },
      reconcileCommit: async () => ({ outcome: "ABSENT" }),
      reconcilePush: async () => ({ outcome: "ABSENT" }),
    });
    const fresh = await built.instance.refreshFreshness({
      operationId: first.operationId,
      expectedRevision: 1,
    });
    const approved = await built.instance.approvePublication({
      operationId: first.operationId,
      expectedRevision: fresh.revision,
      approvalId: "approval-changed",
      idempotencyKey: "publish-changed",
      candidateHash: fresh.candidateHash,
      commitMessage: "Synchronize main into feature",
      completeDiffAcknowledged: true,
      noCodeChangeAcknowledged: false,
    });
    expect(approved.status).toBe("PUBLISHING");
    const published = await built.instance.publish({
      operationId: first.operationId,
      idempotencyKey: "publish-changed",
    });
    expect(published.status).toBe("PUBLISHED");
    expect(commits).toBe(1);
    expect(pushes).toBe(1);
    expect(built.instance.readResult(sibling.operationId)?.status).toBe(
      "READY_TO_PUBLISH",
    );
  });

  it("reconciles an uncertain push without creating a second push", async () => {
    const source = result("uncertain-push");
    let pushes = 0;
    let remoteChecks = 0;
    const built = service([source], currentFreshness, {
      commitMerge: async () => ({
        outcome: "COMMITTED",
        commitSha: COMMIT_SHA,
      }),
      pushMerge: async () => {
        pushes += 1;
        return { outcome: "UNCERTAIN", reason: "response-lost" };
      },
      reconcileCommit: async () => ({
        outcome: "PRESENT",
        commitSha: COMMIT_SHA,
      }),
      reconcilePush: async () => {
        remoteChecks += 1;
        return remoteChecks === 1
          ? { outcome: "UNKNOWN", reason: "remote-read-lost" }
          : { outcome: "PRESENT" };
      },
    });
    const fresh = await built.instance.refreshFreshness({
      operationId: source.operationId,
      expectedRevision: 1,
    });
    const approved = await built.instance.approvePublication({
      operationId: source.operationId,
      expectedRevision: fresh.revision,
      approvalId: "approval-uncertain-push",
      idempotencyKey: "publish-uncertain-push",
      candidateHash: fresh.candidateHash,
      commitMessage: "Synchronize main into feature",
      completeDiffAcknowledged: true,
      noCodeChangeAcknowledged: false,
    });
    const uncertain = await built.instance.publish({
      operationId: source.operationId,
      idempotencyKey: "publish-uncertain-push",
    });
    expect(approved.status).toBe("PUBLISHING");
    expect(uncertain.status).toBe("UNKNOWN");
    const recovered = await built.instance.reconcile({
      operationId: source.operationId,
      idempotencyKey: "publish-uncertain-push",
    });
    expect(recovered.status).toBe("PUBLISHED");
    expect(pushes).toBe(1);
    expect(remoteChecks).toBe(2);
  });
});
