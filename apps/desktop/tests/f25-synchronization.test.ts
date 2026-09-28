import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  f24Reason,
  type F24PreparationAuthorization,
  type F24ResolutionRow,
} from "../src/shared/f24-synchronization";
import type {
  F13InspectionResult,
  F13PreparationResult,
  F13SynchronizationEvidenceResult,
  F13SynchronizationMergeResult,
  F13SynchronizationOperationRequest,
  F13WorktreeRecord,
} from "../src/shared/f13-contracts";
import type { F25PersistencePort } from "../src/main/persistence/f25-repositories";
import {
  createPersistenceRepositories,
  F25PersistenceRepositories,
  initializePersistence,
} from "../src/main/persistence";
import {
  F25SynchronizationService,
  type F25F13Port,
  type F25F14Port,
} from "../src/main/f25-synchronization-service";
import type {
  F25SynchronizationBatchReadModel,
  F25SynchronizationResultReadModel,
} from "../src/shared/f25-synchronization";
import type { ManagedPrReadModel } from "../src/shared/managed-pr";
import type {
  F14ValidationExecutionResult,
  F14ValidationReadModel,
} from "../src/main/f14-validation-runner";
import type { ValidationResolution } from "@prmonitor/validation-contract";

const NOW = "2026-09-28T12:00:00.000Z";
const SOURCE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const BASE_SHA = "c".repeat(40);

const server = {
  kind: "GITHUB_COM" as const,
  webOrigin: "github.example.invalid",
  apiBaseUrl: "github.example.invalid/api",
  host: "github.example.invalid",
  serverKey: "github.example.invalid",
};

function repository(owner: string, name: string) {
  return {
    schemaVersion: 1 as const,
    server,
    owner,
    name,
    key: `github:${server.serverKey}/${owner}/${name}`,
    available: true as const,
  };
}

function reason(code: string) {
  return f24Reason({
    code,
    category: "ELIGIBLE",
    what: "The test row is eligible.",
    why: "The test supplies exact bounded synchronization inputs.",
    nextAction: "NONE",
    correlationId: "f25-test",
  });
}

function row(
  managedPrId: string,
  eligibility: "ELIGIBLE" | "INELIGIBLE" = "ELIGIBLE",
): F24ResolutionRow {
  const source = repository("source-owner", "source-repository");
  const destination = repository("head-owner", "head-repository");
  return {
    schemaVersion: 1,
    managedPrId,
    configurationRevisionId: `configuration-${managedPrId}`,
    configurationRevision: 1,
    inboxProjectionRevision: 1,
    sourceProvenance: "PR_BASE_BRANCH",
    syncSourceBranch: "main",
    prHeadBranch: "feature",
    sourceRepository: source,
    destinationRepository: destination,
    currentPrState: "OPEN",
    currentPrMerged: false,
    syncSourceSha: SOURCE_SHA,
    prHeadSha: HEAD_SHA,
    storedPrBaseSha: BASE_SHA,
    storedPrHeadSha: HEAD_SHA,
    observedAt: NOW,
    observationRevision: `observation-${managedPrId}`,
    observations: [],
    eligibility,
    reason: reason(eligibility === "ELIGIBLE" ? "ELIGIBLE" : "SKIPPED"),
    operationId: `sync-prep-${managedPrId}`,
  };
}

function authorization(): F24PreparationAuthorization {
  const eligible = row("pr-1");
  const skipped = row("pr-2", "INELIGIBLE");
  return {
    schemaVersion: 1,
    kind: "SynchronizationPreparationAuthorization",
    intentId: "intent-1",
    idempotencyKey: "intent-key-1",
    resolutionRevision: "resolution-1",
    createdAt: NOW,
    eligible: [eligible],
    skippedManagedPrIds: [skipped.managedPrId],
    skipped: [skipped],
    preparationOnly: true,
    capabilities: {
      prepareWorktree: true,
      commit: false,
      push: false,
      githubWrite: false,
      aiProvider: false,
      publication: false,
      conversationResolution: false,
    },
  };
}

function managedPr(): ManagedPrReadModel {
  const base = repository("source-owner", "source-repository");
  const head = repository("head-owner", "head-repository");
  return {
    schemaVersion: 1,
    id: "pr-1",
    canonicalUrl: "https://example.invalid/pr-1",
    pullRequestKey: `${base.key}#1`,
    serverId: server.serverKey,
    owner: base.owner,
    repositoryName: base.name,
    number: 1,
    state: "OPEN",
    merged: false,
    baseRepository: base,
    headRepository: head,
    prBaseBranch: "main",
    prHeadBranch: "feature",
    prBaseSha: BASE_SHA,
    prHeadSha: HEAD_SHA,
    primaryState: "WATCHING",
    localSetupStatus: "VALID",
    localClone: {
      associationId: "clone-1",
      status: "VALID",
      cleanState: "CLEAN",
      canonicalRoot: "C:\\developer-clone",
      repository: {
        serverKey: server.serverKey,
        owner: base.owner,
        name: base.name,
        key: base.key,
      },
      validationSnapshot: {
        inspectorVersion: "test",
        validatedAt: NOW,
        remoteCount: 1,
        worktreeRoot: "C:\\developer-clone",
      },
      validatedAt: NOW,
      version: 1,
    },
    configuration: {
      revisionId: "configuration-pr-1",
      revision: 1,
      context: null,
      syncSourceBranchOverride: null,
      contentHash: "d".repeat(64),
      source: "ADD_PR",
      createdAt: NOW,
    },
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function worktree(operationId: string): F13WorktreeRecord {
  return {
    worktreeId: `worktree-${operationId}`,
    operationId,
    ownerType: "SYNCHRONIZATION",
    ownerId: operationId,
    operationKind: "SYNCHRONIZATION",
    canonicalPath: `C:\\worktrees\\${operationId}`,
    configuredRoot: "C:\\worktrees",
    rootRevision: 1,
    lifecycle: "ACTIVE",
    refs: {
      sourceRepository: {
        serverId: server.serverKey,
        owner: "source-owner",
        name: "source-repository",
      },
      destinationRepository: {
        serverId: server.serverKey,
        owner: "head-owner",
        name: "head-repository",
      },
      sourceBranch: "main",
      destinationBranch: "feature",
      syncSourceSha: SOURCE_SHA,
      prHeadSha: HEAD_SHA,
      syncMergeBaseSha: BASE_SHA,
    },
    sourceRepository: {
      serverId: server.serverKey,
      owner: "source-owner",
      name: "source-repository",
    },
    destinationRepository: {
      serverId: server.serverKey,
      owner: "head-owner",
      name: "head-repository",
    },
    currentHeadSha: HEAD_SHA,
    worktreeBaselineSha: HEAD_SHA,
    available: true,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function inspection(operationId: string): F13InspectionResult {
  const current = worktree(operationId);
  return {
    ok: true,
    worktree: current,
    condition: {
      schemaVersion: 1,
      classification: "UNATTRIBUTED_CHANGES",
      currentFingerprint: "fingerprint",
      observedRevision: "revision",
      expectedRevision: HEAD_SHA,
      dirtySummary: {
        changedPaths: ["source.txt"],
        trackedPaths: ["source.txt"],
        stagedPaths: [],
        untrackedPaths: [],
        ignoredPaths: [],
        hash: "hash",
      },
      attribution: {
        evidenceRef: "evidence",
        aiAttributedPaths: [],
        unAttributedPaths: ["source.txt"],
        overlapPaths: [],
        complete: true,
      },
      permittedNextActions: ["INSPECT_CHANGES"],
    },
  };
}

class MemoryPersistence implements F25PersistencePort {
  readonly batches = new Map<string, F25SynchronizationBatchReadModel>();
  readonly results = new Map<string, F25SynchronizationResultReadModel>();
  public persistedBeforeEffect = false;

  persistAdmission(input: {
    readonly batch: F25SynchronizationBatchReadModel;
    readonly results: readonly F25SynchronizationResultReadModel[];
  }): { readonly created: boolean } {
    if (this.batches.has(input.batch.batchId)) return { created: false };
    this.batches.set(input.batch.batchId, { ...input.batch, results: [] });
    for (const result of input.results)
      this.results.set(result.operationId, result);
    return { created: true };
  }

  getBatch(batchId: string): F25SynchronizationBatchReadModel | undefined {
    const batch = this.batches.get(batchId);
    if (batch === undefined) return undefined;
    return {
      ...batch,
      results: this.listResults().filter(
        (result) => result.batchId === batchId,
      ),
    };
  }

  getBatchByIdempotencyKey(
    idempotencyKey: string,
  ): F25SynchronizationBatchReadModel | undefined {
    return [...this.batches.values()].find(
      (batch) => batch.idempotencyKey === idempotencyKey,
    );
  }

  listBatches(): readonly F25SynchronizationBatchReadModel[] {
    return [...this.batches.values()].map((batch) =>
      this.getBatch(batch.batchId)!,
    );
  }

  putBatch(
    batch: F25SynchronizationBatchReadModel,
  ): F25SynchronizationBatchReadModel {
    const current = this.batches.get(batch.batchId);
    const saved = {
      ...batch,
      version: current === undefined ? batch.version : current.version + 1,
      results: [],
    };
    this.batches.set(batch.batchId, saved);
    return this.getBatch(batch.batchId)!;
  }

  getResult(
    operationId: string,
  ): F25SynchronizationResultReadModel | undefined {
    return this.results.get(operationId);
  }

  listResults(): readonly F25SynchronizationResultReadModel[] {
    return [...this.results.values()];
  }

  putResult(
    result: F25SynchronizationResultReadModel,
    expectedVersion?: number,
  ): F25SynchronizationResultReadModel {
    const current = this.results.get(result.operationId);
    if (current !== undefined && expectedVersion !== undefined)
      expect(current.version).toBe(expectedVersion);
    const saved = {
      ...result,
      version: current === undefined ? result.version : current.version + 1,
    };
    this.results.set(result.operationId, saved);
    return saved;
  }
}

function f13Port(options: {
  readonly mergeBaseSha: string;
  readonly mergeOutcome?: "CLEAN_MERGE" | "CONFLICT_DETECTED";
}): F25F13Port & { readonly mergeCalls: { count: number } } {
  const mergeCalls = { count: 0 };
  const port: F25F13Port = {
    prepareSynchronization: async (
      _input: F13SynchronizationOperationRequest,
    ): Promise<F13PreparationResult> => ({
      ok: true,
      worktree: worktree("sync-prep-pr-1"),
    }),
    inspectOperation: async () => inspection("sync-prep-pr-1"),
    readSynchronizationEvidence:
      async (): Promise<F13SynchronizationEvidenceResult> => ({
        ok: true,
        worktree: worktree("sync-prep-pr-1"),
        mergeBaseSha: options.mergeBaseSha,
        sourceChangeEvidence: {
          schemaVersion: 1,
          side: "SOURCE",
          baseSha: BASE_SHA,
          tipSha: SOURCE_SHA,
          files: [
            {
              path: "source.txt",
              kind: "added",
              staged: false,
              worktreeChanged: true,
            },
          ],
          evidenceHash: "source-evidence",
          complete: true,
        },
        destinationChangeEvidence: {
          schemaVersion: 1,
          side: "DESTINATION",
          baseSha: BASE_SHA,
          tipSha: HEAD_SHA,
          files: [
            {
              path: "head.txt",
              kind: "added",
              staged: false,
              worktreeChanged: true,
            },
          ],
          evidenceHash: "head-evidence",
          complete: true,
        },
      }),
    mergeSynchronization: async (): Promise<F13SynchronizationMergeResult> => {
      mergeCalls.count += 1;
      return {
        ok: options.mergeOutcome !== "CONFLICT_DETECTED",
        outcome: options.mergeOutcome ?? "CLEAN_MERGE",
        worktree: worktree("sync-prep-pr-1"),
        inspection: inspection("sync-prep-pr-1"),
        conflictPaths:
          options.mergeOutcome === "CONFLICT_DETECTED" ? ["source.txt"] : [],
      };
    },
  };
  return Object.assign(port, { mergeCalls });
}

function f14Port(): F25F14Port & { readonly calls: { count: number } } {
  const calls = { count: 0 };
  const model: F14ValidationReadModel = {
    schemaVersion: 1,
    runId: "unused",
    operationId: "sync-prep-pr-1",
    ownerType: "SYNCHRONIZATION",
    ownerId: "sync-prep-pr-1",
    consumer: "synchronization",
    requestedPhase: "post_change",
    status: "passed",
    startedAt: NOW,
    completedAt: NOW,
    steps: [],
    manualAttestations: [],
    warnings: [],
    nextAction: "NONE",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const port: F25F14Port = {
    run: async () => {
      calls.count += 1;
      return {
        ok: true,
        completed: true,
        record: { version: 1 } as never,
        run: { status: "passed", warnings: [] } as never,
      } as unknown as F14ValidationExecutionResult;
    },
    readModel: () => model,
  };
  return Object.assign(port, { calls });
}

function resolution(): ValidationResolution {
  return {
    status: "unavailable",
    source: undefined,
    repositoryId: "destination",
    reason: "NO_PROFILE",
    warning: {
      code: "NO_PROFILE",
      title: "No profile",
      message: "No profile",
      remediation: "Configure one",
    },
  };
}

describe("F25 deterministic synchronization", () => {
  it("persists admission before effects, isolates idempotent replay, and validates clean merge", async () => {
    const persistence = new MemoryPersistence();
    const f13 = f13Port({ mergeBaseSha: BASE_SHA });
    const f14 = f14Port();
    const service = new F25SynchronizationService({
      persistence,
      managedPrs: { getManagedPr: () => managedPr() },
      f13: {
        ...f13,
        prepareSynchronization: async (input) => {
          expect(persistence.batches.size).toBe(1);
          persistence.persistedBeforeEffect = true;
          return f13.prepareSynchronization(input);
        },
      },
      f14,
      validation: { resolve: () => resolution() },
      now: () => NOW,
    });
    const auth = authorization();
    expect((await service.accept(auth)).status).toBe("ACKNOWLEDGED");
    const batch = persistence.listBatches()[0]!;
    await service.runBatch(batch.batchId);
    const result = service.readResult("sync-prep-pr-1")!;
    expect(persistence.persistedBeforeEffect).toBe(true);
    expect(result.status).toBe("READY_TO_PUBLISH");
    expect(result.mergeOutcome).toBe("CLEAN_MERGE");
    expect(result.validation?.status).toBe("passed");
    expect(result.aiUsage).toEqual({
      providerInvoked: false,
      turns: 0,
      tokens: 0,
    });
    expect(f13.mergeCalls.count).toBe(1);
    expect(f14.calls.count).toBe(1);
    expect((await service.accept(auth)).status).toBe("ACKNOWLEDGED");
    expect(f13.mergeCalls.count).toBe(1);
  });

  it("classifies a source already contained by the PR head as a no-op", async () => {
    const persistence = new MemoryPersistence();
    const f13 = f13Port({ mergeBaseSha: SOURCE_SHA });
    const f14 = f14Port();
    const service = new F25SynchronizationService({
      persistence,
      managedPrs: { getManagedPr: () => managedPr() },
      f13,
      f14,
      validation: { resolve: () => resolution() },
      now: () => NOW,
    });
    await service.accept(authorization());
    await service.runBatch(persistence.listBatches()[0]!.batchId);
    const result = service.readResult("sync-prep-pr-1")!;
    expect(result.mergeOutcome).toBe("NO_OP");
    expect(f13.mergeCalls.count).toBe(0);
    expect(result.status).toBe("READY_TO_PUBLISH");
  });

  it("rejects skipped identifiers without immutable skipped-row evidence", async () => {
    const persistence = new MemoryPersistence();
    const service = new F25SynchronizationService({
      persistence,
      managedPrs: { getManagedPr: () => managedPr() },
      f13: f13Port({ mergeBaseSha: BASE_SHA }),
      f14: f14Port(),
      validation: { resolve: () => resolution() },
      now: () => NOW,
    });
    const incomplete = { ...authorization(), skipped: undefined };
    const result = await service.accept(incomplete);
    expect(result).toMatchObject({
      status: "FAILED",
      reason: { code: "F25_SKIPPED_EVIDENCE_MISSING" },
    });
    expect(persistence.listBatches()).toHaveLength(0);
  });

  it("round-trips the admitted batch and result through the real SQLite boundary", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "prmonitor-f25-"));
    const store = await initializePersistence({
      databasePath: path.join(root, "database", "prmonitor.sqlite"),
      backupRoot: path.join(root, "backups"),
    });
    try {
      const base = createPersistenceRepositories(store);
      const source = repository("source-owner", "source-repository");
      const destination = repository("head-owner", "head-repository");
      base.putGithubServer({
        serverId: server.serverKey,
        host: server.host,
        apiBaseUrl: server.apiBaseUrl,
      });
      for (const repo of [source, destination])
        base.putRepository({
          repositoryId:
            repo === source
              ? "source-repository-id"
              : "destination-repository-id",
          serverId: server.serverKey,
          owner: repo.owner,
          name: repo.name,
          defaultBranch: "main",
        });
      base.putManagedPr({
        managedPrId: "pr-1",
        serverId: server.serverKey,
        baseRepositoryId: "source-repository-id",
        headRepositoryId: "destination-repository-id",
        number: 1,
        baseBranch: "main",
        headBranch: "feature",
        baseSha: BASE_SHA,
        headSha: HEAD_SHA,
        state: "WATCHING",
      });
      base.putManagedPr({
        managedPrId: "pr-2",
        serverId: server.serverKey,
        baseRepositoryId: "source-repository-id",
        headRepositoryId: "destination-repository-id",
        number: 2,
        baseBranch: "main",
        headBranch: "feature",
        baseSha: BASE_SHA,
        headSha: HEAD_SHA,
        state: "WATCHING",
      });
      const persistence = new F25PersistenceRepositories(base);
      const f13 = f13Port({ mergeBaseSha: SOURCE_SHA });
      const service = new F25SynchronizationService({
        persistence,
        managedPrs: { getManagedPr: () => managedPr() },
        f13,
        f14: f14Port(),
        validation: { resolve: () => resolution() },
        now: () => NOW,
      });
      expect((await service.accept(authorization())).status).toBe(
        "ACKNOWLEDGED",
      );
      const batch = persistence.listBatches()[0]!;
      await service.runBatch(batch.batchId);
      const savedBatch = persistence.getBatch(batch.batchId)!;
      const savedResult = persistence.getResult("sync-prep-pr-1")!;
      expect(savedBatch.results).toHaveLength(2);
      expect(savedResult.status).toBe("READY_TO_PUBLISH");
      expect(savedResult.aiUsage.providerInvoked).toBe(false);
      expect(persistence.listResults()).toHaveLength(2);
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
