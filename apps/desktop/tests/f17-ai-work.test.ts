import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  outputContractForTask,
  type AIProviderRequest,
  type AIProviderTurnResult,
} from "../src/shared/ai/provider-contracts";
import {
  AIWorkPredicateRegistry,
  type AIWorkEvidenceBundle,
  type AIWorkOperationInput,
  type AIWorkWorktreeEvidence,
} from "../src/shared/ai-work";
import {
  AIWorkController,
  type AIWorkEvidencePort,
} from "../src/main/ai-work-controller";
import { F17PersistenceRepositories } from "../src/main/persistence/f17-repositories";
import {
  initializePersistence,
  type PersistenceStore,
} from "../src/main/persistence";
import type { F16EffectiveAITaskSnapshot } from "../src/shared/f16-preferences";

const FIXED_TIME = "2026-09-23T00:00:00.000Z";
const WORKTREE_PATH = "C:/PRMonitor/operation-worktrees/operation-1";

interface Fixture {
  readonly root: string;
  readonly store: PersistenceStore;
  readonly repositories: F17PersistenceRepositories;
}

const fixtures: Fixture[] = [];

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (fixture === undefined) continue;
    fixture.store.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "prmonitor-f17-"));
  const store = await initializePersistence(
    {
      databasePath: path.join(root, "database", "prmonitor.sqlite"),
      backupRoot: path.join(root, "backups"),
    },
    { clock: { now: () => FIXED_TIME }, applicationBuild: "f17-test" },
  );
  const fixture = {
    root,
    store,
    repositories: new F17PersistenceRepositories(store, {
      clock: { now: () => FIXED_TIME },
    }),
  };
  fixtures.push(fixture);
  return fixture;
}

function snapshot(): F16EffectiveAITaskSnapshot {
  return {
    schemaVersion: 1,
    snapshotId: "snapshot-1",
    snapshotHash: "a".repeat(64),
    taskType: "REVIEW_REVISION",
    phase: "REVIEW_REVISION",
    profile: {
      schemaVersion: 1,
      profileId: "profile-review-revision",
      taskType: "REVIEW_REVISION",
      providerId: "fake",
      modelId: "gpt-5-codex",
      providerOptions: {},
      enabled: true,
      availability: "AVAILABLE",
      revision: 1,
    },
    policy: {
      schemaVersion: 1,
      policyId: "application-policy",
      revision: 1,
      configuredPreset: "AUTONOMOUS_WORKTREE",
      effectivePreset: "AUTONOMOUS_WORKTREE",
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccess: "disabled",
      writableRoot: WORKTREE_PATH,
      controlledEnvironment: { mode: "EXPLICIT", allowedKeys: [] },
      taskSafetyFloor: "WORKTREE_WRITE",
      interactionMode: "worktree_write",
      publicationAuthority: false,
    },
    commonInstructions: [],
    operationWorktree: {
      operationId: "operation-1",
      canonicalPath: WORKTREE_PATH,
      rootRevision: 1,
    },
    bounds: {
      f16: "f16-bounds-v1",
      f04: "f04-ipc-v1",
      f13: "f13-root-v1",
      f15: "f15-options-v1",
    },
  };
}

function operation(
  overrides: Partial<AIWorkOperationInput> = {},
): AIWorkOperationInput {
  const taskSnapshot =
    snapshot() as unknown as AIWorkOperationInput["taskSnapshot"];
  return {
    schemaVersion: 1,
    operationId: "operation-1",
    operationKind: "REVIEW_REVISION",
    taskType: "REVIEW_REVISION",
    purpose: "Resolve the remaining review finding.",
    interactionMode: "worktree_write",
    worktree: {
      operationId: "operation-1",
      worktreeId: "worktree-1",
      ownerType: "REVIEW_BUNDLE",
      ownerId: "bundle-1",
      canonicalPath: WORKTREE_PATH,
      rootRevision: 1,
      access: "WORKTREE_WRITE",
      available: true,
    },
    taskSnapshot,
    predicate: {
      id: "test-completion",
      version: 1,
      inputSnapshot: { problemId: "problem-1" },
    },
    configuredTurnBudget: 2,
    budgetSource: "EXPLICIT_OPERATION",
    timeoutMs: 5_000,
    createdAt: FIXED_TIME,
    ...overrides,
  };
}

function requestFor(input: {
  readonly operation: string;
  readonly turn: string;
}): AIProviderRequest {
  const outputContract = outputContractForTask("REVIEW_REVISION");
  return {
    schemaVersion: 1,
    requestId: `request-${input.turn}`,
    operationId: input.operation,
    turnId: input.turn,
    providerId: "fake",
    modelId: "gpt-5-codex",
    taskType: "REVIEW_REVISION",
    interactionMode: "worktree_write",
    profileSnapshot: {
      schemaVersion: 1,
      profileId: "profile-review-revision",
      profileRevision: 1,
      providerId: "fake",
      modelId: "gpt-5-codex",
      taskType: "REVIEW_REVISION",
      outputContractId: outputContract.contractId,
    },
    executionPolicySnapshot: {
      schemaVersion: 1,
      snapshotHash: "policy-hash-1",
      policyId: "application-policy",
      revision: 1,
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccess: "disabled",
      writableRoot: WORKTREE_PATH,
      controlledEnvironment: { mode: "explicit", allowedKeys: [] },
    },
    worktree: {
      schemaVersion: 1,
      operationId: input.operation,
      worktreeId: "worktree-1",
      ownerType: "REVIEW_BUNDLE",
      ownerId: "bundle-1",
      operationKind: "REVIEW",
      canonicalPath: WORKTREE_PATH,
      access: "WORKTREE_WRITE",
      ownership: {
        kind: "OPERATION_OWNED",
        ownerType: "REVIEW_BUNDLE",
        ownerId: "bundle-1",
      },
      actualState: {
        snapshotId: "snapshot-1",
        stateFingerprint: "provider-state-1",
        baselineRevision: "base",
        expectedHeadRevision: "head",
        currentHeadRevision: "head",
        files: [],
        ignoredFiles: [],
        complete: true,
      },
      permittedCapabilities: {
        readFiles: true,
        writeFiles: true,
        executeCommands: false,
        network: false,
        publication: false,
      },
    },
    input: {
      schemaVersion: 1,
      remoteEventVersionIds: [],
      eventVersionIds: [],
    },
    outputContract,
    invocation: {
      timeoutMs: 5_000,
      maxOutputBytes: 1_024,
      streamEvents: true,
    },
  };
}

function providerResult(request: AIProviderRequest): AIProviderTurnResult {
  return {
    schemaVersion: 1,
    requestId: request.requestId,
    operationId: request.operationId,
    turnId: request.turnId,
    providerId: request.providerId,
    modelId: request.modelId,
    taskType: request.taskType,
    profileRevision: request.profileSnapshot.profileRevision,
    executionPolicySnapshot: {
      schemaVersion: 1,
      snapshotHash: request.executionPolicySnapshot.snapshotHash,
    },
    startedAt: FIXED_TIME,
    completedAt: FIXED_TIME,
    status: "completed",
    interactionMode: request.interactionMode,
    outputContract: request.outputContract,
    structuredResult: { schemaVersion: 1, summary: "fixture result" },
    events: [],
    usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
  };
}

function evidence(
  stateFingerprint: string,
  revision: number,
  material = false,
): AIWorkEvidencePort {
  const worktree: AIWorkWorktreeEvidence = {
    schemaVersion: 1,
    worktreeId: "worktree-1",
    snapshotId: "snapshot-1",
    revision,
    stateFingerprint,
    baselineRevision: "base",
    currentRevision: "head",
    files: material
      ? [{ path: "src/fixed.ts", kind: "modified", material: true }]
      : [],
    ignoredPaths: [],
    unmergedPaths: [],
    conflictMarkers: [],
    actualCommands: [],
    complete: true,
    clean: true,
    forbiddenMutation: false,
  };
  return {
    inspectWorktree: async () => worktree,
  };
}

function controllerFor(
  fixture: Fixture,
  options: {
    readonly evidence: AIWorkEvidencePort;
    readonly onInvoke?: (request: AIProviderRequest) => void;
    readonly registry?: AIWorkPredicateRegistry;
  },
): AIWorkController {
  const registry = options.registry ?? new AIWorkPredicateRegistry();
  if (registry.resolve("test-completion", 1) === undefined) {
    registry.register({
      id: "test-completion",
      version: 1,
      evaluate: ({ evidence: result }: { evidence: AIWorkEvidenceBundle }) => ({
        valid: true,
        complete: false,
        materialProgress: result.materialProblemIds.length > 0,
        reason: "The fixture predicate keeps one problem open.",
        remainingProblems: ["problem-1"],
      }),
    });
  }
  return new AIWorkController({
    persistence: fixture.repositories,
    provider: {
      invoke: async (request) => {
        options.onInvoke?.(request);
        return providerResult(request);
      },
    },
    requestFactory: {
      create: ({ operation: record, turn }) =>
        requestFor({ operation: record.operationId, turn: turn.turnId }),
    },
    evidence: options.evidence,
    predicates: registry,
    clock: { now: () => FIXED_TIME },
    reconciliationWindowMs: 10,
  });
}

describe("F17 bounded AI work controller", () => {
  it("commits the reservation before invoking the provider and deduplicates admission", async () => {
    const fixture = await createFixture();
    const providerTurns: string[] = [];
    const controller = controllerFor(fixture, {
      evidence: evidence("state-1", 1, true),
      onInvoke: (request) => {
        providerTurns.push(request.turnId);
        const durable = fixture.repositories.getOperation("operation-1");
        expect(durable?.consumedTurnCount).toBe(1);
        expect(durable?.segments[0]?.turns[0]?.status).toBe("STARTED");
      },
    });

    const first = await controller.startOperation(operation());
    const duplicate = await controller.startOperation(operation());

    expect(first.operation.status).toBe("WORKING");
    expect(first.operation.consumedTurnCount).toBe(1);
    expect(first.remainingBudget).toBe(1);
    expect(first.reports[0]?.progress?.classification).toBe(
      "MATERIAL_PROGRESS",
    );
    expect(duplicate.reports).toHaveLength(1);
    expect(providerTurns).toHaveLength(1);
  });

  it("stops on deterministic no-progress, consumes explicit continuation once, and exhausts budget", async () => {
    const fixture = await createFixture();
    let revision = 0;
    const controller = controllerFor(fixture, {
      evidence: {
        inspectWorktree: async () => {
          revision += 1;
          return {
            schemaVersion: 1,
            worktreeId: "worktree-1",
            snapshotId: "snapshot-1",
            revision,
            stateFingerprint: `state-${revision}`,
            baselineRevision: "base",
            currentRevision: "head",
            files: [],
            ignoredPaths: [],
            unmergedPaths: [],
            conflictMarkers: [],
            actualCommands: [],
            complete: true,
            clean: true,
            forbiddenMutation: false,
          };
        },
      },
    });

    const first = await controller.startOperation(
      operation({ configuredTurnBudget: 3 }),
    );
    const second = await controller.startNextTurn({
      operationId: "operation-1",
    });
    expect(first.operation.status).toBe("WORKING");
    expect(second.operation.status).toBe("NEEDS_ATTENTION");
    expect(second.stopReason?.code).toBe("AI_NO_PROGRESS");
    expect(second.remainingBudget).toBe(1);
    const blocked = await controller.startNextTurn({
      operationId: "operation-1",
    });
    expect(blocked.reports).toHaveLength(2);

    const confirmation = controller.authorizeContinuation({
      operationId: "operation-1",
      kind: "CONTINUE_AI_WORK",
      selectedBudget: 1,
    });
    const continued = await controller.continueOperation({ confirmation });
    const duplicate = await controller.continueOperation({ confirmation });

    expect(continued.operation.status).toBe("EXHAUSTED");
    expect(continued.stopReason?.code).toBe("AI_TURN_BUDGET_EXHAUSTED");
    expect(continued.operation.consumedTurnCount).toBe(3);
    expect(duplicate.reports).toHaveLength(3);
  });

  it("reconciles a reserved worktree turn after restart without resuming it", async () => {
    const fixture = await createFixture();
    fixture.repositories.admitOperation({
      operation: operation({ configuredTurnBudget: 2 }),
      segmentId: "segment-1",
      turnId: "turn-1",
      deadlineAt: "2026-09-23T00:00:05.000Z",
    });
    const controller = controllerFor(fixture, {
      evidence: evidence("state-1", 1),
    });

    const reconciled = await controller.reconcileStartup();

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]?.operation.status).toBe("NEEDS_ATTENTION");
    expect(reconciled[0]?.operation.consumedTurnCount).toBe(1);
    expect(reconciled[0]?.operation.segments[0]?.turns[0]?.status).toBe(
      "UNCERTAIN",
    );
    expect(reconciled[0]?.permittedNextAction).toBe("RECONCILE");
  });
});
