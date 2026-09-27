import { describe, expect, it } from "vitest";
import type {
  F13InspectionResult,
  F13ProviderWorktreeHandoff,
  F13PreparationResult,
} from "../src/shared/f13-contracts";
import type { F16EffectiveAITaskSnapshot } from "../src/shared/f16-preferences";
import type { F14ValidationReadModel } from "../src/main/f14-validation-runner";
import type { ManagedPrReadModel } from "../src/shared/managed-pr";
import type {
  F18AiWorkPort,
  F18F13Port,
  F18F14Port,
  F18F16Port,
  F18ClaimPort,
  F18SchedulerPort,
} from "../src/main/automatic-review-coordinator";
import { AutomaticReviewCoordinator } from "../src/main/automatic-review-coordinator";
import {
  f18ReviewBundleRecordSchema,
  type F18AiWorkResult,
  type F18ReviewBundleRecord,
} from "../src/shared/f18-automatic-review";
import type { F18BundlePersistencePort } from "../src/main/persistence/f18-repositories";
import type { F14ValidationExecutionResult } from "../src/main/f14-validation-runner";

const TIME = "2026-09-24T12:00:00.000Z";
const PATH = "C:/PRMonitor/worktrees/operation-1";

function managedPr(): ManagedPrReadModel {
  const repository = {
    schemaVersion: 1 as const,
    server: {
      schemaVersion: 1 as const,
      host: "github.example.invalid",
      webOrigin: "https://github.example.invalid",
      apiBaseUrl: "https://github.example.invalid/api/v3",
      serverKey: "github.example.invalid",
      kind: "GITHUB_COM" as const,
    },
    owner: "owner",
    name: "repo",
    key: "github.example.invalid/owner/repo",
    available: true as const,
  };
  return {
    schemaVersion: 1,
    id: "pr-1",
    canonicalUrl: "https://github.example.invalid/owner/repo/pull/1",
    pullRequestKey: "github.example.invalid/owner/repo#1",
    serverId: "github.example.invalid",
    owner: "owner",
    repositoryName: "repo",
    number: 1,
    state: "OPEN",
    merged: false,
    title: "Reviewable change",
    baseRepository: repository,
    headRepository: repository,
    prBaseBranch: "main",
    prHeadBranch: "feature",
    prBaseSha: "a".repeat(40),
    prHeadSha: "b".repeat(40),
    primaryState: "WATCHING",
    localSetupStatus: "VALID",
    localClone: {
      associationId: "clone-1",
      status: "VALID",
      cleanState: "CLEAN",
      canonicalRoot: "C:/PRMonitor/clones/repo",
      repository: {
        serverKey: "github.example.invalid",
        owner: "owner",
        name: "repo",
        key: "github.example.invalid/owner/repo",
      },
      validationSnapshot: {
        inspectorVersion: "f07-test",
        validatedAt: TIME,
        remoteCount: 1,
        worktreeRoot: "C:/PRMonitor/clones/repo",
      },
      validatedAt: TIME,
      version: 1,
    },
    configuration: {
      revisionId: "config-1",
      revision: 1,
      context: "Keep changes narrowly scoped.",
      syncSourceBranchOverride: null,
      contentHash: "c".repeat(64),
      source: "ADD_PR",
      createdAt: TIME,
    },
    version: 1,
    createdAt: TIME,
    updatedAt: TIME,
  };
}

function taskSnapshot(
  taskType: "AUTOMATIC_REVIEW_REEVALUATION" | "REVIEW_REVISION",
): F16EffectiveAITaskSnapshot {
  const proposal = taskType === "AUTOMATIC_REVIEW_REEVALUATION";
  return {
    schemaVersion: 1,
    snapshotId: proposal ? "snapshot-proposal" : "snapshot-implementation",
    snapshotHash: proposal ? "1".repeat(64) : "2".repeat(64),
    taskType,
    phase: proposal ? "REVIEW_PROPOSAL" : "REVIEW_REVISION",
    profile: {
      schemaVersion: 1,
      profileId: proposal ? "profile-proposal" : "profile-implementation",
      taskType,
      providerId: "fake",
      modelId: "fake-model",
      providerOptions: {},
      enabled: true,
      availability: "AVAILABLE",
      revision: 1,
    },
    policy: {
      schemaVersion: 1,
      policyId: proposal ? "read-only-policy" : "worktree-policy",
      revision: 1,
      configuredPreset: proposal ? "READ_ONLY" : "AUTONOMOUS_WORKTREE",
      effectivePreset: proposal ? "READ_ONLY" : "AUTONOMOUS_WORKTREE",
      sandboxMode: proposal ? "read-only" : "workspace-write",
      approvalPolicy: "never",
      networkAccess: "disabled",
      ...(proposal ? {} : { writableRoot: PATH }),
      controlledEnvironment: { mode: "EXPLICIT", allowedKeys: [] },
      taskSafetyFloor: proposal ? "READ_ONLY" : "WORKTREE_WRITE",
      interactionMode: proposal ? "read_only" : "worktree_write",
      publicationAuthority: false,
    },
    commonInstructions: [],
    bounds: {
      f16: "f16-bounds-v1",
      f04: "f04-ipc-v1",
      f13: "f13-root-v1",
      f15: "f15-options-v1",
      f00: "f00-validation-v1",
    },
  };
}

function worktree(): F13ProviderWorktreeHandoff {
  return {
    schemaVersion: 1,
    operationId: "operation-1",
    worktreeId: "worktree-1",
    ownerType: "REVIEW_BUNDLE",
    ownerId: "bundle-1",
    operationKind: "REVIEW",
    canonicalPath: PATH,
    access: "READ_ONLY",
    ownership: {
      kind: "OPERATION_OWNED",
      ownerType: "REVIEW_BUNDLE",
      ownerId: "bundle-1",
    },
    actualState: {
      snapshotId: "f13-snapshot-1",
      stateFingerprint: "fingerprint-1",
      baselineRevision: "b".repeat(40),
      expectedHeadRevision: "b".repeat(40),
      currentHeadRevision: "b".repeat(40),
      files: [],
      ignoredFiles: [],
      complete: true,
    },
    permittedCapabilities: {
      readFiles: true,
      writeFiles: false,
      executeCommands: false,
      network: false,
      publication: false,
    },
  };
}

function inspection(): F13InspectionResult {
  const handoff = worktree();
  const worktreeRecord = {
    worktreeId: handoff.worktreeId,
    operationId: handoff.operationId,
    managedPrId: "pr-1",
    ownerType: handoff.ownerType,
    ownerId: handoff.ownerId,
    operationKind: "REVIEW" as const,
    canonicalPath: PATH,
    configuredRoot: "C:/PRMonitor/worktrees",
    rootRevision: 1,
    lifecycle: "ACTIVE" as const,
    refs: {
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
      prBaseSha: "a".repeat(40),
      prHeadSha: "b".repeat(40),
    },
    sourceRepository: {
      serverId: "github.example.invalid",
      owner: "owner",
      name: "repo",
      key: "github.example.invalid/owner/repo",
    },
    currentHeadSha: "b".repeat(40),
    worktreeBaselineSha: "b".repeat(40),
    available: true,
    version: 1,
    createdAt: TIME,
    updatedAt: TIME,
  };
  return {
    ok: true,
    worktree: worktreeRecord,
    condition: {
      schemaVersion: 1,
      classification: "CLEAN",
      currentFingerprint: "fingerprint-1",
      observedRevision: "b".repeat(40),
      expectedRevision: "b".repeat(40),
      dirtySummary: {
        changedPaths: [],
        trackedPaths: [],
        stagedPaths: [],
        untrackedPaths: [],
        ignoredPaths: [],
        hash: "dirty-hash-1",
      },
      attribution: {
        evidenceRef: "f13-condition-1",
        aiAttributedPaths: [],
        unAttributedPaths: [],
        overlapPaths: [],
        complete: true,
      },
      permittedNextActions: [
        "INSPECT_CHANGES",
        "VALIDATE_WORKTREE",
        "CONTINUE_AI_WORK",
        "REVALIDATE_FOR_PUBLICATION",
      ],
    },
    snapshot: {
      snapshotId: "f13-inspection-1",
      operationId: "operation-1",
      worktreeId: "worktree-1",
      phase: "INSPECTION",
      stateFingerprint: "fingerprint-1",
      manifest: {
        schemaVersion: 1,
        operationId: "operation-1",
        worktreeId: "worktree-1",
        phase: "INSPECTION",
        headSha: "b".repeat(40),
        expectedHeadSha: "b".repeat(40),
        prBaseSha: "a".repeat(40),
        worktreeBaselineSha: "b".repeat(40),
        files: [],
        ignoredFiles: [],
        statusTextHash: "status-hash",
        stateFingerprint: "fingerprint-1",
        complete: true,
        gitErrors: [],
        capturedAt: TIME,
      },
      proposedDiff: {
        diffId: "diff-proposed-1",
        operationId: "operation-1",
        worktreeId: "worktree-1",
        kind: "PROPOSED",
        baselineSha: "b".repeat(40),
        currentSha: "b".repeat(40),
        diffHash: "diff-hash-1",
        patchHash: "patch-hash-1",
        files: [],
        untrackedFiles: [],
        complete: true,
        regenerationContract: "f13-test",
        createdAt: TIME,
      },
      contextDiff: {
        diffId: "diff-context-1",
        operationId: "operation-1",
        worktreeId: "worktree-1",
        kind: "CONTEXT",
        baselineSha: "b".repeat(40),
        currentSha: "b".repeat(40),
        diffHash: "context-hash-1",
        patchHash: "context-patch-1",
        files: [],
        untrackedFiles: [],
        complete: true,
        regenerationContract: "f13-test",
        createdAt: TIME,
      },
      createdAt: TIME,
    },
  } as F13InspectionResult;
}

function validationModel(
  runId: string,
  phase: "baseline" | "post_change",
  status: "passed" | "not_run",
): F14ValidationReadModel {
  return {
    schemaVersion: 1,
    runId,
    operationId: "operation-1",
    ownerType: "REVIEW_BUNDLE",
    ownerId: "bundle-1",
    consumer: "review",
    requestedPhase: phase,
    status,
    ...(status === "not_run" ? { reason: "NO_PROFILE" as const } : {}),
    startedAt: TIME,
    steps: [],
    manualAttestations: [],
    warnings: [],
    nextAction: status === "passed" ? "NONE" : "REVIEW",
    version: 1,
    createdAt: TIME,
    updatedAt: TIME,
  };
}

class MemoryBundlePersistence implements F18BundlePersistencePort {
  public readonly records = new Map<string, F18ReviewBundleRecord>();

  public get(bundleId: string): F18ReviewBundleRecord | undefined {
    return this.records.get(bundleId);
  }

  public persistIntent(input: {
    readonly record: F18ReviewBundleRecord;
  }): F18ReviewBundleRecord {
    const record = f18ReviewBundleRecordSchema.parse(input.record);
    const existing = this.records.get(record.bundleId);
    if (existing !== undefined) return existing;
    this.records.set(record.bundleId, record);
    return record;
  }

  public update(input: {
    readonly record: F18ReviewBundleRecord;
    readonly expectedBundleVersion?: number;
  }): F18ReviewBundleRecord {
    const current = this.records.get(input.record.bundleId);
    if (current === undefined) throw new Error("missing bundle");
    if (
      input.expectedBundleVersion !== undefined &&
      input.expectedBundleVersion !== current.version
    )
      throw new Error("version conflict");
    const record = f18ReviewBundleRecordSchema.parse(input.record);
    this.records.set(record.bundleId, record);
    return record;
  }

  public recordDecision(input: {
    readonly bundleId: string;
    readonly itemId: string;
    readonly decision: "accepted" | "overridden";
    readonly finalDisposition: "fixed" | "pushback" | "question" | "no_change";
    readonly instruction?: string;
    readonly answer?: string;
  }): F18ReviewBundleRecord {
    const current = this.records.get(input.bundleId);
    if (current === undefined) throw new Error("missing bundle");
    const item = current.items.find(
      (candidate) => candidate.itemId === input.itemId,
    );
    if (item === undefined) throw new Error("missing item");
    const decision = {
      decision: input.decision,
      finalDisposition: input.finalDisposition,
      ...(input.instruction === undefined
        ? {}
        : { instruction: input.instruction }),
      ...(input.answer === undefined ? {} : { answer: input.answer }),
    } as const;
    const record = f18ReviewBundleRecordSchema.parse({
      ...current,
      version: current.version + 1,
      updatedAt: TIME,
      items: current.items.map((candidate) =>
        candidate.itemId === input.itemId
          ? {
              ...candidate,
              decision,
              decisionHistory: [...candidate.decisionHistory, decision],
            }
          : candidate,
      ),
    });
    this.records.set(record.bundleId, record);
    return record;
  }
}

function makeCoordinator(options: {
  readonly fixed: boolean;
  readonly question?: boolean;
  readonly missingImplementation?: boolean;
}): {
  readonly coordinator: AutomaticReviewCoordinator;
  readonly persistence: MemoryBundlePersistence;
} {
  const pr = { ...managedPr(), primaryState: "WORKING" as const };
  const persistence = new MemoryBundlePersistence();
  const event = {
    eventVersionId: "event-1",
    managedPrId: "pr-1",
    sourceKind: "REVIEW_COMMENT",
    sourceId: "comment-1",
    observedAt: TIME,
    semanticHash: "event-hash-1",
    payload: { body: "Please fix this", author: { login: "reviewer" } },
  };
  const claim = {
    claimId: "claim-1",
    managedPrId: "pr-1",
    operationId: "operation-1",
    bundleId: "bundle-1",
    state: "ACTIVE" as const,
    eventVersionIds: ["event-1"],
    configurationSnapshot: {} as never,
    correlationId: "correlation-1",
    version: 1,
    createdAt: TIME,
    updatedAt: TIME,
  };
  const hold = {
    holdId: "hold-1",
    managedPrId: "pr-1",
    claimId: "claim-1",
    operationId: "operation-1",
    bundleId: "bundle-1",
    state: "ACTIVE" as const,
    reason: {} as never,
    acquiredAt: TIME,
    version: 1,
    updatedAt: TIME,
  };
  const f13: F18F13Port = {
    prepareReview: async (): Promise<F13PreparationResult> => ({
      ok: true,
      worktree: inspection().worktree,
      inspection: inspection(),
    }),
    inspectOperation: async () => inspection(),
    getProviderWorktreeHandoff: async () => ({ ok: true, handoff: worktree() }),
  };
  const f14: F18F14Port = {
    run: async (input): Promise<F14ValidationExecutionResult> => {
      const model = validationModel(
        input.runId ?? `run-${input.requestedPhase}`,
        input.requestedPhase as "baseline" | "post_change",
        input.requestedPhase === "post_change" && options.fixed
          ? "passed"
          : "not_run",
      );
      return {
        ok: model.status === "passed",
        completed: true,
        record: {
          runId: model.runId,
          operationId: model.operationId,
          idempotencyKey: `key-${model.runId}`,
          correlationId: "correlation-1",
          ownerType: model.ownerType,
          ownerId: model.ownerId,
          consumer: model.consumer,
          requestedPhase: model.requestedPhase,
          resolutionStatus: "unavailable",
          evidence: {
            status: model.status,
            startedAt: TIME,
            steps: [],
            warnings: [],
          } as never,
          status: model.status,
          warnings: [],
          nextAction: model.nextAction,
          version: 1,
          createdAt: TIME,
          updatedAt: TIME,
        } as never,
        run: {
          status: model.status,
          startedAt: TIME,
          steps: [],
          warnings: [],
        } as never,
      };
    },
    readModel: (runId) =>
      validationModel(
        runId,
        runId.includes("post_change") ? "post_change" : "baseline",
        runId.includes("post_change") && options.fixed ? "passed" : "not_run",
      ),
  };
  const f16: F18F16Port = {
    resolveTask: async (input) =>
      taskSnapshot(
        input.taskType === "AUTOMATIC_REVIEW_REEVALUATION"
          ? input.taskType
          : "REVIEW_REVISION",
      ),
  };
  const f18Ai: F18AiWorkPort = {
    run: async (input): Promise<F18AiWorkResult> => {
      const proposal = {
        schemaVersion: 1 as const,
        summary: "One bounded proposal.",
        items: [
          {
            remoteEventVersionId: "event-1",
            assessment: "actionable" as const,
            disposition: options.question
              ? ("question" as const)
              : options.fixed
                ? ("fixed" as const)
                : ("no_change" as const),
            explanation: "The reviewer feedback is understood.",
            relatedFiles: [],
          },
        ],
      };
      const implementation = {
        schemaVersion: 1 as const,
        summary: "Applied final fixed disposition.",
        problems: [],
        remainingIssues: [],
        outcomes: [
          {
            remoteEventVersionId: "event-1",
            decision: "fixed" as const,
            outcome: "attempted" as const,
          },
        ],
      };
      const semanticResult =
        input.phase === "proposal"
          ? proposal
          : options.missingImplementation
            ? undefined
            : implementation;
      return {
        summary: {
          operationId: input.operationId,
          status: "COMPLETED",
          attention: false,
          nextAction: "NONE",
          remainingBudget: 2,
          usage: {},
          reports: [
            {
              turnId: `${input.operationId}-turn`,
              providerStatus: "completed",
              modelClaims: {
                problems: [],
                remainingIssues: [],
                claimedChangedFiles: [],
                semanticResult,
              },
              actualChangedFiles: [],
              actualCommands: [],
              deterministicProblems: [],
              remainingProblems: [],
              nextAction: "NONE",
            },
          ],
        },
        ...(input.phase === "proposal"
          ? { proposal }
          : options.missingImplementation
            ? {}
            : {
                implementation,
                validation: {
                  runId: "f18-post-operation-1",
                  operationId: "operation-1",
                  requestedPhase: "post_change" as const,
                  status: "passed" as const,
                  nextAction: "NONE",
                  warningCodes: [],
                  steps: [],
                  version: 1,
                },
              }),
      };
    },
  };
  const coordinator = new AutomaticReviewCoordinator({
    persistence,
    managedPrs: {
      getManagedPr: (managedPrId) => (managedPrId === pr.id ? pr : undefined),
    },
    events: {
      getEventVersion: (managedPrId, eventVersionId) =>
        managedPrId === event.managedPrId &&
        eventVersionId === event.eventVersionId
          ? event
          : undefined,
    },
    claims: {
      getClaim: (claimId) => (claimId === claim.claimId ? claim : undefined),
      getActiveClaim: (managedPrId) =>
        managedPrId === claim.managedPrId ? claim : undefined,
      getActiveHold: (managedPrId) =>
        managedPrId === hold.managedPrId ? hold : undefined,
    } as F18ClaimPort,
    scheduler: {
      read: () => ({ schedulerRevision: 3, pause: { paused: false } }) as never,
    } as F18SchedulerPort,
    f13,
    f14,
    f16,
    aiWork: f18Ai,
    validation: {
      resolve: () =>
        ({ status: "unavailable", warning: { code: "NO_PROFILE" } }) as never,
    },
    clock: () => TIME,
  });
  return { coordinator, persistence };
}

describe("F18 automatic review vertical slice", () => {
  it("persists a read-only proposal and records no implementation changes after explicit no-change decision", async () => {
    const fixture = makeCoordinator({ fixed: false });
    const handoff = {
      batchId: "batch-1",
      managedPrId: "pr-1",
      eventVersionIds: ["event-1"],
      operationId: "operation-1",
      bundleId: "bundle-1",
      claimId: "claim-1",
      holdId: "hold-1",
      schedulerRevision: 3,
      correlationId: "correlation-1",
    };
    await expect(
      fixture.coordinator.startAutomaticReview(handoff),
    ).resolves.toMatchObject({ outcome: "ACCEPTED" });
    const proposal = fixture.coordinator.getReadModel("bundle-1");
    expect(proposal?.stage).toBe("PROPOSAL_REVIEW");
    expect(proposal?.items[0]?.decision.decision).toBe("pending");
    const decided = fixture.coordinator.recordDecision({
      bundleId: "bundle-1",
      itemId: "f18-item-event-1",
      decision: "accepted",
      finalDisposition: "no_change",
      expectedVersion: proposal?.version,
    });
    expect(decided.decisionSummary.complete).toBe(true);
    const final = await fixture.coordinator.confirmReviewDecisions({
      bundleId: "bundle-1",
      expectedVersion: decided.version,
    });
    expect(final.stage).toBe("FINAL_REVIEW");
    expect(final.state).toBe("READY_FOR_REVIEW");
    expect(final.postChangeValidation?.reason).toBe(
      "NO_IMPLEMENTATION_CHANGES",
    );
    expect(final.capabilities.canPublish).toBe(false);
  });

  it("uses the authorized F16 PR Intent / Context snapshot for a successor bundle", async () => {
    const fixture = makeCoordinator({ fixed: false });
    const authorizedSnapshot = {
      ...taskSnapshot("AUTOMATIC_REVIEW_REEVALUATION"),
      prIntentContext: {
        text: "Authorized successor context.",
        contentHash: "3".repeat(64),
      },
    };

    await expect(
      fixture.coordinator.startAutomaticReview({
        batchId: "batch-successor",
        managedPrId: "pr-1",
        eventVersionIds: ["event-1"],
        operationId: "operation-1",
        bundleId: "bundle-1",
        claimId: "claim-1",
        holdId: "hold-1",
        schedulerRevision: 3,
        correlationId: "correlation-successor",
        explicitHumanAuthorization: true,
        parentBundleId: "bundle-old",
        reevaluationAuthorizationId: "f22-action-successor",
        currentTaskSnapshot: authorizedSnapshot,
      }),
    ).resolves.toMatchObject({ outcome: "ACCEPTED" });

    const record = fixture.persistence.records.get("bundle-1");
    expect(record?.input.contextText).toBe("Authorized successor context.");
    expect(record?.input.taskSnapshot?.prIntentContextHash).toBe(
      "3".repeat(64),
    );
  });

  it("requires a matching F11 claim and hold before creating durable F18 intent", async () => {
    const fixture = makeCoordinator({ fixed: false });
    await expect(
      fixture.coordinator.startAutomaticReview({
        batchId: "batch-1",
        managedPrId: "pr-1",
        eventVersionIds: ["event-1"],
        operationId: "operation-1",
        bundleId: "bundle-1",
        claimId: "wrong-claim",
        holdId: "hold-1",
        schedulerRevision: 3,
        correlationId: "correlation-1",
      }),
    ).resolves.toMatchObject({ outcome: "REJECTED" });
    expect(fixture.persistence.records.size).toBe(0);
  });

  it("implements only an explicitly fixed item and retains final deterministic evidence", async () => {
    const fixture = makeCoordinator({ fixed: true });
    const handoff = {
      batchId: "batch-1",
      managedPrId: "pr-1",
      eventVersionIds: ["event-1"],
      operationId: "operation-1",
      bundleId: "bundle-1",
      claimId: "claim-1",
      holdId: "hold-1",
      schedulerRevision: 3,
      correlationId: "correlation-1",
    };
    await fixture.coordinator.startAutomaticReview(handoff);
    const proposal = fixture.coordinator.getReadModel("bundle-1");
    const decided = fixture.coordinator.recordDecision({
      bundleId: "bundle-1",
      itemId: "f18-item-event-1",
      decision: "accepted",
      finalDisposition: "fixed",
      instruction: "Apply the smallest safe change.",
      expectedVersion: proposal?.version,
    });
    const final = await fixture.coordinator.confirmReviewDecisions({
      bundleId: "bundle-1",
      expectedVersion: decided.version,
    });
    expect(final.stage).toBe("FINAL_REVIEW");
    expect(final.state).toBe("READY_FOR_REVIEW");
    expect(final.implementationWork?.status).toBe("COMPLETED");
    expect(final.postChangeValidation?.status).toBe("passed");
    expect(final.capabilities.canPush).toBe(false);
  });

  it("keeps question recommendations pending until an answer is recorded", async () => {
    const fixture = makeCoordinator({ fixed: false, question: true });
    await fixture.coordinator.startAutomaticReview({
      batchId: "batch-1",
      managedPrId: "pr-1",
      eventVersionIds: ["event-1"],
      operationId: "operation-1",
      bundleId: "bundle-1",
      claimId: "claim-1",
      holdId: "hold-1",
      schedulerRevision: 3,
      correlationId: "correlation-1",
    });
    const proposal = fixture.coordinator.getReadModel("bundle-1");
    expect(proposal?.items[0]?.recommendation.disposition).toBe("question");
    expect(() =>
      fixture.coordinator.recordDecision({
        bundleId: "bundle-1",
        itemId: "f18-item-event-1",
        decision: "accepted",
        finalDisposition: "question",
        expectedVersion: proposal?.version,
      }),
    ).toThrow("F18_DECISION_INVALID");
    const decided = fixture.coordinator.recordDecision({
      bundleId: "bundle-1",
      itemId: "f18-item-event-1",
      decision: "accepted",
      finalDisposition: "question",
      answer: "Which compatibility target should this preserve?",
      expectedVersion: proposal?.version,
    });
    expect(decided.decisionSummary.questionsNeedingAnswer).toBe(0);
    const final = await fixture.coordinator.confirmReviewDecisions({
      bundleId: "bundle-1",
      expectedVersion: decided.version,
    });
    expect(final.state).toBe("READY_FOR_REVIEW");
    expect(final.noImplementationChanges).toBe(true);
    expect(final.postChangeValidation?.reason).toBe(
      "NO_IMPLEMENTATION_CHANGES",
    );
  });

  it("turns a missing implementation result into an actionable final attention bundle", async () => {
    const fixture = makeCoordinator({
      fixed: true,
      missingImplementation: true,
    });
    await fixture.coordinator.startAutomaticReview({
      batchId: "batch-1",
      managedPrId: "pr-1",
      eventVersionIds: ["event-1"],
      operationId: "operation-1",
      bundleId: "bundle-1",
      claimId: "claim-1",
      holdId: "hold-1",
      schedulerRevision: 3,
      correlationId: "correlation-1",
    });
    const proposal = fixture.coordinator.getReadModel("bundle-1");
    const decided = fixture.coordinator.recordDecision({
      bundleId: "bundle-1",
      itemId: "f18-item-event-1",
      decision: "accepted",
      finalDisposition: "fixed",
      expectedVersion: proposal?.version,
    });
    const final = await fixture.coordinator.confirmReviewDecisions({
      bundleId: "bundle-1",
      expectedVersion: decided.version,
    });
    expect(final.state).toBe("NEEDS_ATTENTION");
    expect(
      final.reasons.some(
        (item) => item.code === "IMPLEMENTATION_RESULT_MISSING",
      ),
    ).toBe(true);
  });
});
