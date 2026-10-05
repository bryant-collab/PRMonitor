import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  aiWorkUsageSchema,
  aiWorkTurnReportSchema,
  createDefaultAIWorkPredicateRegistry,
  type AIWorkEvidenceBundle,
  type AIWorkOperationInput,
  type AIWorkReadModel,
} from "../src/shared/ai-work";
import {
  aiProviderOutputContractSchema,
  aiProviderInputSnapshotSchema,
  aiProviderTurnResultSchema,
  outputContractForTask,
  type AIProviderRequest,
  type AIProviderTurnResult,
} from "../src/shared/ai/provider-contracts";
import {
  f18ReviewBundleReadModelSchema,
  type F18ReviewBundleReadModel,
} from "../src/shared/f18-automatic-review";
import type {
  F13InspectionResult,
  F13ProviderWorktreeHandoff,
} from "../src/shared/f13-contracts";
import type { F16EffectiveAITaskSnapshot } from "../src/shared/f16-preferences";
import {
  f21ConversationReadModelSchema,
  f21ProposalInputSchema,
  f21ReadModelFromBundle,
  f21TurnFromAIWork,
  f21UserIntentSchema,
  type F21ConversationMessage,
  type F21ConversationReadModel,
  type F21ConversationTurnRecord,
  type F21ProposalEntryInput,
  type F21UserIntent,
} from "../src/shared/f21-conversation";
import type {
  F18F13Port,
  F18F16Port,
} from "../src/main/automatic-review-coordinator";
import { F21AIWorkAdapter } from "../src/main/f21-ai-work-adapter";
import {
  F21ConversationService,
  type F21ConversationAIWorkPort,
  type F21ConversationServiceOptions,
} from "../src/main/f21-conversation-service";
import type {
  F21AIWorkInput,
  F21AIWorkResult,
} from "../src/main/f21-ai-work-adapter";
import type { F21ConversationPersistencePort } from "../src/main/persistence/f21-repositories";
import { F17PersistenceRepositories } from "../src/main/persistence/f17-repositories";
import {
  F21PersistenceRepositories,
  initializePersistence,
  type PersistenceStore,
} from "../src/main/persistence";

const TIME = "2026-09-26T00:00:00.000Z";
const BUNDLE_ID = "bundle-1";
const OPERATION_ID = "operation-1";

class MemoryConversationPersistence implements F21ConversationPersistencePort {
  private readonly projections = new Map<string, F21ConversationReadModel>();
  private readonly intents = new Map<string, F21UserIntent>();
  private readonly messages = new Map<string, F21ConversationMessage>();
  private readonly turns = new Map<string, F21ConversationTurnRecord>();
  private readonly proposalInputs = new Map<string, F21ProposalEntryInput>();

  public get(bundleId: string): F21ConversationReadModel | undefined {
    return this.projections.get(bundleId);
  }

  public saveReadModel(input: {
    readonly readModel: F21ConversationReadModel;
    readonly expectedBundleVersion?: number;
  }): F21ConversationReadModel {
    const current = this.projections.get(input.readModel.bundleId);
    if (
      current !== undefined &&
      input.expectedBundleVersion !== undefined &&
      current.bundleVersion !== input.expectedBundleVersion
    )
      throw new Error("F21_CONVERSATION_CONFLICT");
    const readModel = f21ConversationReadModelSchema.parse(input.readModel);
    this.projections.set(readModel.bundleId, readModel);
    return readModel;
  }

  public recordIntent(input: F21UserIntent): {
    readonly created: boolean;
    readonly intent: F21UserIntent;
  } {
    const existing = this.intents.get(input.idempotencyKey);
    if (existing !== undefined) {
      if (existing.intentId !== input.intentId)
        throw new Error("F21_INTENT_IDEMPOTENCY_CONFLICT");
      return { created: false, intent: existing };
    }
    this.intents.set(input.idempotencyKey, input);
    return { created: true, intent: input };
  }

  public recordMessage(input: F21ConversationMessage): F21ConversationMessage {
    const existing = this.messages.get(input.messageId);
    if (existing !== undefined) return existing;
    this.messages.set(input.messageId, input);
    return input;
  }

  public recordTurn(
    input: F21ConversationTurnRecord,
  ): F21ConversationTurnRecord {
    this.turns.set(input.turnId, input);
    return input;
  }

  public recordProposalInput(input: F21ProposalEntryInput): {
    readonly created: boolean;
    readonly input: F21ProposalEntryInput;
  } {
    const existing = this.proposalInputs.get(input.commandId);
    if (existing !== undefined) return { created: false, input: existing };
    this.proposalInputs.set(input.commandId, input);
    return { created: true, input };
  }

  public listMessages(bundleId: string): readonly F21ConversationMessage[] {
    return [...this.messages.values()].filter(
      (message) => message.bundleId === bundleId,
    );
  }

  public listTurns(bundleId: string): readonly F21ConversationTurnRecord[] {
    return [...this.turns.values()].filter(
      (turn) => turn.bundleId === bundleId,
    );
  }

  public listTurnsForOperation(
    operationId: string,
  ): readonly F21ConversationTurnRecord[] {
    return [...this.turns.values()].filter(
      (turn) => turn.operationId === operationId,
    );
  }

  public listProposalInputs(
    bundleId: string,
  ): readonly F21ProposalEntryInput[] {
    return [...this.proposalInputs.values()].filter(
      (input) => input.bundleId === bundleId,
    );
  }

  public hasIntent(intentId: string): boolean {
    return [...this.intents.values()].some(
      (intent) => intent.intentId === intentId,
    );
  }
}

function taskSnapshot(
  taskType: "READ_ONLY_CONVERSATION" | "REVIEW_REVISION",
): F16EffectiveAITaskSnapshot {
  const readOnly = taskType === "READ_ONLY_CONVERSATION";
  return {
    schemaVersion: 1,
    snapshotId: `snapshot-${readOnly ? "conversation" : "revision"}`,
    snapshotHash: "a".repeat(64),
    taskType,
    phase: taskType,
    profile: {
      schemaVersion: 1,
      profileId: `profile-${taskType.toLowerCase()}`,
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
      policyId: readOnly ? "read-only-policy" : "revision-policy",
      revision: 1,
      configuredPreset: readOnly ? "READ_ONLY" : "AUTONOMOUS_WORKTREE",
      effectivePreset: readOnly ? "READ_ONLY" : "AUTONOMOUS_WORKTREE",
      sandboxMode: readOnly ? "read-only" : "workspace-write",
      approvalPolicy: "never",
      networkAccess: "disabled",
      ...(readOnly
        ? {}
        : { writableRoot: "C:/PRMonitor/worktrees/operation-1" }),
      controlledEnvironment: { mode: "EXPLICIT", allowedKeys: [] },
      taskSafetyFloor: readOnly ? "READ_ONLY" : "WORKTREE_WRITE",
      interactionMode: readOnly ? "read_only" : "worktree_write",
      publicationAuthority: false,
    },
    commonInstructions: [],
    ...(readOnly
      ? {}
      : {
          operationWorktree: {
            operationId: OPERATION_ID,
            canonicalPath: "C:/PRMonitor/worktrees/operation-1",
            rootRevision: 7,
          },
        }),
    bounds: {
      f16: "f16-bounds-v1",
      f04: "f04-ipc-v1",
      f13: "f13-root-v1",
      f15: "f15-options-v1",
    },
  } as F16EffectiveAITaskSnapshot;
}

function bundle(): F18ReviewBundleReadModel {
  const decision = {
    decision: "accepted" as const,
    finalDisposition: "fixed" as const,
    instruction: "Keep the fix narrowly scoped.",
  };
  return f18ReviewBundleReadModelSchema.parse({
    schemaVersion: 1,
    kind: "REVIEW_BUNDLE_READ_MODEL",
    bundleId: BUNDLE_ID,
    managedPrId: "pr-1",
    batchId: "batch-1",
    operationId: OPERATION_ID,
    state: "READY_FOR_REVIEW",
    stage: "PROPOSAL_REVIEW",
    phase: "DECISIONS_CONFIRMED",
    version: 1,
    input: {
      schemaVersion: 1,
      operationId: OPERATION_ID,
      bundleId: BUNDLE_ID,
      batchId: "batch-1",
      managedPrId: "pr-1",
      claimId: "claim-1",
      holdId: "hold-1",
      correlationId: "correlation-1",
      schedulerRevision: 1,
      remoteEventVersionIds: ["event-1"],
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
        baseSha: "a".repeat(40),
        headSha: "b".repeat(40),
        title: "A review bundle",
      },
      feedback: [
        {
          eventVersionId: "event-1",
          semanticHash: "feedback-hash",
          sourceKind: "REVIEW_COMMENT",
          sourceId: "comment-1",
          observedAt: TIME,
          body: "Please keep this change focused.",
          author: "reviewer",
        },
      ],
      contextText: "Repository context.",
    },
    items: [
      {
        itemId: "item-1",
        eventVersionId: "event-1",
        recommendation: {
          remoteEventVersionId: "event-1",
          assessment: "actionable",
          disposition: "fixed",
          explanation: "The change is actionable.",
          relatedFiles: ["src/example.ts"],
        },
        decision,
        decisionHistory: [decision],
      },
    ],
    draftResponses: [],
    reasons: [],
    nextAction: "REVIEW_DECISIONS",
    decisionSummary: {
      total: 1,
      decided: 1,
      fixed: 1,
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
  });
}

function inspection(
  classification: "CLEAN" | "UNATTRIBUTED_CHANGES" = "CLEAN",
): F13InspectionResult {
  const dirty = classification === "UNATTRIBUTED_CHANGES";
  const changedPaths = dirty ? ["manual.txt"] : [];
  return {
    ok: true,
    worktree: {
      worktreeId: "worktree-1",
      operationId: OPERATION_ID,
      managedPrId: "pr-1",
      ownerType: "REVIEW_BUNDLE",
      ownerId: BUNDLE_ID,
      operationKind: "REVIEW",
      canonicalPath: "C:/PRMonitor/worktrees/operation-1",
      configuredRoot: "C:/PRMonitor/worktrees",
      rootRevision: 7,
      lifecycle: "ACTIVE",
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
    },
    condition: {
      schemaVersion: 1,
      classification,
      currentFingerprint: "fingerprint-1",
      observedRevision: "b".repeat(40),
      expectedRevision: "b".repeat(40),
      dirtySummary: {
        changedPaths,
        trackedPaths: dirty ? ["manual.txt"] : [],
        stagedPaths: [],
        untrackedPaths: dirty ? ["manual.txt"] : [],
        ignoredPaths: [],
        hash: "dirty-hash-1",
      },
      attribution: {
        evidenceRef: "f13-condition-1",
        aiAttributedPaths: [],
        unAttributedPaths: changedPaths,
        overlapPaths: [],
        complete: true,
      },
      permittedNextActions: dirty
        ? [
            "INSPECT_CHANGES",
            "REFRESH_EVIDENCE",
            "REQUEST_WORKTREE_DECISION",
            "KEEP_WORKTREE_AND_CANCEL",
          ]
        : ["CONTINUE_AI_WORK", "REVALIDATE_FOR_PUBLICATION"],
    },
    snapshot: {
      snapshotId: "snapshot-1",
      operationId: OPERATION_ID,
      worktreeId: "worktree-1",
      phase: "INSPECTION",
      stateFingerprint: "fingerprint-1",
      manifest: {
        schemaVersion: 1,
        operationId: OPERATION_ID,
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
      createdAt: TIME,
    },
  } as F13InspectionResult;
}

function handoff(): F13ProviderWorktreeHandoff {
  return {
    schemaVersion: 1,
    operationId: OPERATION_ID,
    worktreeId: "worktree-1",
    ownerType: "REVIEW_BUNDLE",
    ownerId: BUNDLE_ID,
    operationKind: "REVIEW",
    canonicalPath: "C:/PRMonitor/worktrees/operation-1",
    access: "WORKTREE_WRITE",
    ownership: {
      kind: "OPERATION_OWNED",
      ownerType: "REVIEW_BUNDLE",
      ownerId: BUNDLE_ID,
    },
    actualState: {
      snapshotId: "snapshot-1",
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
      writeFiles: true,
      executeCommands: false,
      network: false,
      publication: false,
    },
  };
}

function aiReport(operationId: string) {
  return aiWorkTurnReportSchema.parse({
    schemaVersion: 1,
    turnId: `f17-turn-${operationId}`,
    operationId,
    segmentId: `f17-segment-${operationId}`,
    turnNumber: 1,
    objective: "Complete the bounded Review Revision turn.",
    startedAt: TIME,
    completedAt: TIME,
    providerStatus: "completed",
    modelClaims: {
      problems: [],
      remainingIssues: [],
      claimedChangedFiles: [],
      claimedCommands: [],
      providerEventCount: 0,
      providerEventKinds: [],
    },
    actualChangedFiles: [],
    actualCommands: [],
    deterministicProblems: [],
    remainingProblems: [],
    usage: aiWorkUsageSchema.parse({
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    }),
    nextAction: "NONE",
  });
}

function aiReadModel(
  operationId: string,
  status: "COMPLETED" | "NEEDS_ATTENTION" = "COMPLETED",
  reports: AIWorkReadModel["reports"] = [],
): AIWorkReadModel {
  return {
    schemaVersion: 1,
    operation: { operationId, status } as AIWorkReadModel["operation"],
    usage: aiWorkUsageSchema.parse({
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    }),
    remainingBudget: 0,
    reports,
    permittedNextAction:
      status === "NEEDS_ATTENTION" ? "CONTINUE_AI_WORK" : "NONE",
    requiresExplicitConfirmation: status === "NEEDS_ATTENTION",
    attention: status === "NEEDS_ATTENTION",
  } as AIWorkReadModel;
}

function implementation() {
  return {
    schemaVersion: 1 as const,
    summary: "The requested review revision was applied.",
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
}

function intent(
  mode: "READ_ONLY_CONVERSATION" | "REVIEW_REVISION",
  intentId: string,
  message = mode === "READ_ONLY_CONVERSATION"
    ? "What changed?"
    : "Apply the confirmed fix.",
): F21UserIntent {
  return {
    schemaVersion: 1,
    intentId,
    bundleId: BUNDLE_ID,
    mode,
    message,
    ...(mode === "REVIEW_REVISION"
      ? { expectedBundleVersion: 1, expectedEvidenceRevision: "bundle-1" }
      : {}),
    idempotencyKey: `key-${intentId}`,
    createdAt: TIME,
  };
}

function createHarness(
  options: {
    readonly classification?: "CLEAN" | "UNATTRIBUTED_CHANGES";
    readonly implementation?: boolean;
    readonly includeReport?: boolean;
  } = {},
) {
  const persistence = new MemoryConversationPersistence();
  let currentBundle = bundle();
  const runInputs: F21AIWorkInput[] = [];
  const events: string[] = [];
  const readModel = aiReadModel("f21-conversation-intent-1");
  const result: F21AIWorkResult = {
    readModel,
    summary: {
      operationId: readModel.operation.operationId,
      status: "COMPLETED",
      attention: false,
      nextAction: "NONE",
      remainingBudget: 0,
      usage: readModel.usage,
      reports: [],
    },
    answer: "The answer is read-only and bounded.",
    progress: [],
    ...(options.implementation === false
      ? {}
      : { implementation: implementation() }),
  };
  const aiWork: F21ConversationAIWorkPort = {
    run: async (input) => {
      runInputs.push(input);
      events.push("provider");
      return {
        ...result,
        readModel: aiReadModel(
          input.operationId,
          "COMPLETED",
          options.includeReport ? [aiReport(input.operationId)] : [],
        ),
        summary: { ...result.summary, operationId: input.operationId },
      };
    },
    startNewOperation: async (input) => {
      events.push("new-operation");
      return {
        ...result,
        readModel: aiReadModel(input.operationId),
        summary: { ...result.summary, operationId: input.operationId },
      };
    },
    continue: async (input) => {
      events.push("continue");
      return {
        ...result,
        readModel: aiReadModel(input.operationId),
        summary: { ...result.summary, operationId: input.operationId },
      };
    },
    read: (operationId) => aiReadModel(operationId),
    cancel: async () => undefined,
    authorizeContinuation: (input) => {
      events.push("authorize");
      return {
        schemaVersion: 1,
        confirmationId: "confirmation-1",
        operationId: input.operationId,
        kind: input.kind,
        displayedHistoryRevision: 1,
        selectedBudget: input.selectedBudget ?? 1,
        confirmed: true,
        status: "PENDING",
        createdAt: TIME,
        confirmedAt: TIME,
        version: 1,
      };
    },
    reconcileStartup: async () => [],
  };
  const bundles = {
    getReadModel: () => currentBundle,
    saveProposalInput: () => currentBundle,
    beginReviewRevision: () => {
      events.push("begin");
      currentBundle = f18ReviewBundleReadModelSchema.parse({
        ...currentBundle,
        state: "WORKING",
        phase: "REVIEW_REVISION_STARTED",
        version: currentBundle.version + 1,
        nextAction: "RUN_REVIEW_REVISION",
      });
      return currentBundle;
    },
    finalizeReviewRevision: (input: {
      readonly revisionId: string;
      readonly operationId: string;
      readonly implementation?: ReturnType<typeof implementation>;
      readonly implementationWork: F18ReviewBundleReadModel["implementationWork"];
      readonly worktree?: F18ReviewBundleReadModel["worktree"];
      readonly postChangeValidation?: F18ReviewBundleReadModel["postChangeValidation"];
      readonly changedFiles: readonly string[];
      readonly state: "READY_FOR_REVIEW" | "NEEDS_ATTENTION";
      readonly reasons: readonly F18ReviewBundleReadModel["reasons"][number][];
    }) => {
      events.push("finalize");
      currentBundle = f18ReviewBundleReadModelSchema.parse({
        ...currentBundle,
        state: input.state,
        stage: "FINAL_REVIEW",
        phase: "FINAL_RECORDED",
        version: currentBundle.version + 1,
        nextAction:
          input.state === "READY_FOR_REVIEW" ? "NONE" : "REVIEW_EVIDENCE",
        implementationWork: input.implementationWork,
        reasons: [...input.reasons],
        ...(input.implementation === undefined
          ? {}
          : {
              revisionHistory: [
                ...(currentBundle.revisionHistory ?? []),
                {
                  revisionId: input.revisionId,
                  operationId: input.operationId,
                  status: input.state,
                  implementation: input.implementation,
                  changedFiles: [...input.changedFiles],
                  ...(input.worktree === undefined
                    ? {}
                    : { worktree: input.worktree }),
                  ...(input.postChangeValidation === undefined
                    ? {}
                    : { validation: input.postChangeValidation }),
                  createdAt: TIME,
                },
              ],
            }),
        ...(input.worktree === undefined ? {} : { worktree: input.worktree }),
        ...(input.postChangeValidation === undefined
          ? {}
          : { postChangeValidation: input.postChangeValidation }),
      });
      return currentBundle;
    },
  } as unknown as F21ConversationServiceOptions["bundles"];
  const f13 = {
    prepareReview: async () => ({ ok: true }),
    inspectOperation: async () => inspection(options.classification),
    getProviderWorktreeHandoff: async () => ({ ok: true, handoff: handoff() }),
  } as unknown as F18F13Port;
  const f16 = {
    resolveTask: async (input: {
      readonly taskType: "READ_ONLY_CONVERSATION" | "REVIEW_REVISION";
    }) => taskSnapshot(input.taskType),
  } as unknown as F18F16Port;
  const service = new F21ConversationService({
    persistence,
    bundles,
    f13,
    f16,
    aiWork,
    clock: () => TIME,
  });
  return {
    service,
    persistence,
    runInputs,
    events,
    getBundle: () => currentBundle,
  };
}

describe("F21 read-only conversation and Review Revision", () => {
  it("CT-F21-01 keeps the two modes explicit and rejects unknown intent fields", () => {
    expect(
      f21UserIntentSchema.safeParse(
        intent("READ_ONLY_CONVERSATION", "intent-1"),
      ).success,
    ).toBe(true);
    expect(
      f21UserIntentSchema.safeParse(intent("REVIEW_REVISION", "intent-2"))
        .success,
    ).toBe(true);
    expect(
      f21UserIntentSchema.safeParse({
        ...intent("READ_ONLY_CONVERSATION", "intent-3"),
        inferredMode: "REVIEW_REVISION",
      }).success,
    ).toBe(false);
  });

  it("CT-F21-02 bounds proposal inputs and projects no publication authority", () => {
    const input = f21ProposalInputSchema.parse({
      schemaVersion: 1,
      commandId: "command-1",
      bundleId: BUNDLE_ID,
      itemId: "item-1",
      kind: "SAVE_ENTRY_INSTRUCTION",
      text: "Keep the change focused.",
      expectedBundleVersion: 1,
      createdAt: TIME,
    });
    expect(input.kind).toBe("SAVE_ENTRY_INSTRUCTION");
    const readModel = f21ReadModelFromBundle(bundle());
    expect(readModel.capabilities).toEqual({
      canAsk: true,
      canRequestRevision: true,
      canSaveProposalInput: true,
      canCancel: false,
      canContinue: false,
      canStartNewOperation: false,
    });
    expect(readModel.authority.publication).toBe("NONE");
  });

  it("CT-F21-03 routes Ask/clarify to the read-only task without a worktree", async () => {
    const harness = createHarness();
    const readModel = await harness.service.ask(
      intent("READ_ONLY_CONVERSATION", "intent-ask"),
    );
    expect(harness.runInputs).toHaveLength(1);
    expect(harness.runInputs[0]?.mode).toBe("READ_ONLY_CONVERSATION");
    expect(harness.runInputs[0]?.taskSnapshot.taskType).toBe(
      "READ_ONLY_CONVERSATION",
    );
    expect(harness.runInputs[0]?.worktree).toBeUndefined();
    const providerInput = aiProviderInputSnapshotSchema.parse(
      harness.runInputs[0]?.input,
    );
    expect(providerInput.pullRequest).toEqual({
      baseRepository: bundle().input.pullRequest.baseRepository,
      headRepository: bundle().input.pullRequest.headRepository,
      baseBranch: bundle().input.pullRequest.baseBranch,
      headBranch: bundle().input.pullRequest.headBranch,
      baseSha: bundle().input.pullRequest.baseSha,
      headSha: bundle().input.pullRequest.headSha,
    });
    expect(readModel.turns.at(-1)?.status).toBe("COMPLETED");
    expect(readModel.turns.at(-1)?.answer).toContain("read-only");
    expect(
      readModel.messages.some((message) => message.role === "assistant"),
    ).toBe(true);
  });

  it("CT-F21-04 commits read-only intent before the provider and deduplicates retries", async () => {
    const harness = createHarness();
    const original = intent("READ_ONLY_CONVERSATION", "intent-once");
    await harness.service.ask(original);
    await harness.service.ask(original);
    expect(harness.persistence.hasIntent(original.intentId)).toBe(true);
    expect(harness.runInputs).toHaveLength(1);
    expect(harness.events).toEqual(["provider"]);
  });

  it("CT-F21-05 rejects secret-shaped chat text before durable admission", async () => {
    const harness = createHarness();
    await expect(
      harness.service.ask(
        intent(
          "READ_ONLY_CONVERSATION",
          "intent-secret",
          "Use sk-abcdefghijklmnopqrstuvwxyz1234567890",
        ),
      ),
    ).rejects.toThrow("F21_SECRET_INPUT_REJECTED");
    expect(harness.runInputs).toHaveLength(0);
    expect(harness.persistence.hasIntent("intent-secret")).toBe(false);
  });

  it("CT-F21-06 retains an un-attributed revision request as terminal attention evidence", async () => {
    const harness = createHarness({ classification: "UNATTRIBUTED_CHANGES" });
    const readModel = await harness.service.requestRevision(
      intent("REVIEW_REVISION", "intent-blocked"),
    );
    expect(harness.runInputs).toHaveLength(0);
    expect(harness.persistence.hasIntent("intent-blocked")).toBe(true);
    expect(readModel.lastRevision?.status).toBe("NEEDS_ATTENTION");
    expect(
      readModel.turns.find((turn) => turn.turnId === "intent-blocked")?.status,
    ).toBe("NEEDS_ATTENTION");
    expect(readModel.messages.at(-1)?.text).toContain("not attributed");
  });

  it("CT-F21-07 sends exact decisions, task snapshots, acknowledgement, and worktree scope to revision work", async () => {
    const harness = createHarness();
    const readModel = await harness.service.requestRevision({
      ...intent("REVIEW_REVISION", "intent-revision"),
      acknowledgeUnattributedChanges: true,
    });
    expect(harness.runInputs).toHaveLength(1);
    expect(harness.runInputs[0]?.mode).toBe("REVIEW_REVISION");
    expect(harness.runInputs[0]?.taskSnapshot.taskType).toBe("REVIEW_REVISION");
    expect(
      harness.runInputs[0]?.taskSnapshot.operationWorktree?.rootRevision,
    ).toBe(7);
    expect(
      harness.runInputs[0]?.worktree?.permittedCapabilities.publication,
    ).toBe(false);
    expect(harness.runInputs[0]?.acknowledgeUnattributedChanges).toBe(true);
    expect(harness.getBundle().phase).toBe("FINAL_RECORDED");
    expect(harness.getBundle().revisionHistory).toHaveLength(1);
    expect(readModel.lastRevision?.status).toBe("READY_FOR_REVIEW");
  });

  it("CT-F21-08 preserves acknowledged manual edits and records the F17 turn report revision", async () => {
    const harness = createHarness({
      classification: "UNATTRIBUTED_CHANGES",
      includeReport: true,
    });
    const readModel = await harness.service.requestRevision({
      ...intent("REVIEW_REVISION", "intent-manual-edits"),
      acknowledgeUnattributedChanges: true,
    });
    const turn = readModel.turns.at(-1);
    expect(readModel.lastRevision?.status).toBe("READY_FOR_REVIEW");
    expect(readModel.lastRevision?.changedFiles).toEqual(["manual.txt"]);
    expect(readModel.lastRevision?.worktreeCondition?.classification).toBe(
      "UNATTRIBUTED_CHANGES",
    );
    expect(harness.getBundle().worktree?.changedFiles).toEqual(["manual.txt"]);
    expect(turn?.turnId).toBe("f17-turn-f21-revision-intent-manual-edits");
    expect(turn?.status).toBe("COMPLETED");
    expect(turn?.reportRevision).toBe(1);
  });

  it("CT-F21-09 preserves a valid no-code semantic revision as NEEDS_ATTENTION rather than fabricating a change", async () => {
    const harness = createHarness({ implementation: false });
    const readModel = await harness.service.requestRevision(
      intent("REVIEW_REVISION", "intent-no-code"),
    );
    expect(harness.getBundle().phase).toBe("FINAL_RECORDED");
    expect(harness.getBundle().state).toBe("NEEDS_ATTENTION");
    expect(harness.getBundle().revisionHistory).toBeUndefined();
    expect(readModel.lastRevision?.status).toBe("NEEDS_ATTENTION");
    expect(readModel.lastRevision?.implementation).toBeUndefined();
  });

  it("CT-F21-10 maps a completed controller read model without requiring a provider report", () => {
    const turn = f21TurnFromAIWork({
      bundleId: BUNDLE_ID,
      mode: "READ_ONLY_CONVERSATION",
      userMessage: "Explain the proposal.",
      readModel: aiReadModel("operation-complete"),
      answer: "It is a bounded answer.",
      progress: [],
      createdAt: TIME,
      updatedAt: TIME,
    });
    expect(turn.status).toBe("COMPLETED");
    expect(turn.reportRevision).toBe(0);
  });

  it("CT-F21-11 keeps F17 predicate and provider contracts provider-neutral", () => {
    const registry = createDefaultAIWorkPredicateRegistry();
    expect(registry.resolve("READ_ONLY_CONVERSATION", 1)).toBeDefined();
    expect(registry.resolve("REVIEW_REVISION", 1)).toBeDefined();
    expect(
      aiProviderOutputContractSchema.parse(
        outputContractForTask("READ_ONLY_CONVERSATION"),
      ).contractId,
    ).toBe("READ_ONLY_CONVERSATION");
    const result: AIProviderTurnResult = {
      schemaVersion: 1,
      requestId: "request-1",
      operationId: OPERATION_ID,
      turnId: "turn-1",
      providerId: "fake",
      modelId: "fake-model",
      taskType: "READ_ONLY_CONVERSATION",
      profileRevision: 1,
      executionPolicySnapshot: {
        schemaVersion: 1,
        snapshotHash: "policy-hash",
      },
      startedAt: TIME,
      completedAt: TIME,
      status: "completed",
      interactionMode: "read_only",
      outputContract: outputContractForTask("READ_ONLY_CONVERSATION"),
      structuredResult: {
        schemaVersion: 1,
        interaction: "read_only",
        answer: "safe",
      },
      events: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    };
    expect(aiProviderTurnResultSchema.parse(result).interactionMode).toBe(
      "read_only",
    );
    const predicate = registry.resolve("READ_ONLY_CONVERSATION", 1);
    const operation = {
      taskType: "READ_ONLY_CONVERSATION",
      interactionMode: "read_only",
    } as unknown as AIWorkOperationInput;
    const evidence = {
      worktree: {
        complete: true,
        forbiddenMutation: false,
        files: [],
      },
    } as unknown as AIWorkEvidenceBundle;
    expect(
      predicate?.evaluate({ operation, providerResult: result, evidence })
        .complete,
    ).toBe(true);
  });

  it("CT-F21-12 rejects a provider file-change event on the actual read-only adapter/controller path", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "prmonitor-f21-adapter-"),
    );
    let store: PersistenceStore | undefined;
    try {
      store = await initializePersistence(
        {
          databasePath: path.join(root, "database", "prmonitor.sqlite"),
          backupRoot: path.join(root, "backups"),
        },
        { clock: { now: () => TIME }, applicationBuild: "f21-adapter-test" },
      );
      const f17 = new F17PersistenceRepositories(store, {
        clock: { now: () => TIME },
      });
      const requests: AIProviderRequest[] = [];
      const adapter = new F21AIWorkAdapter({
        persistence: f17,
        provider: {
          invoke: async (request) => {
            requests.push(request);
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
                schemaVersion: request.executionPolicySnapshot.schemaVersion,
                snapshotHash: request.executionPolicySnapshot.snapshotHash,
              },
              startedAt: TIME,
              completedAt: TIME,
              status: "completed" as const,
              interactionMode: request.interactionMode,
              outputContract: request.outputContract,
              structuredResult: {
                schemaVersion: 1,
                interaction: "read_only" as const,
                answer: "No file changes are permitted in this conversation.",
              },
              events: [
                {
                  schemaVersion: 1,
                  sequence: 0,
                  occurredAt: TIME,
                  providerId: request.providerId,
                  turnId: request.turnId,
                  kind: "file_change" as const,
                  details: { path: "manual.txt", action: "write" },
                },
              ],
            };
          },
        },
        f13: {} as unknown as F18F13Port,
        clock: () => TIME,
      });
      const result = await adapter.run({
        mode: "READ_ONLY_CONVERSATION",
        operationId: "f21-read-only-adapter",
        ownerId: BUNDLE_ID,
        bundleId: BUNDLE_ID,
        taskSnapshot: taskSnapshot("READ_ONLY_CONVERSATION"),
        input: {
          schemaVersion: 1,
          userMessage: "What changed?",
          remoteEventVersionIds: ["event-1"],
          eventVersionIds: ["event-1"],
        },
        configuredTurnBudget: 1,
      });
      const operation = f17.getOperation("f21-read-only-adapter");
      expect(requests).toHaveLength(1);
      expect(requests[0]?.interactionMode).toBe("read_only");
      expect(requests[0]?.worktree).toBeUndefined();
      expect(result.readModel.operation.status).toBe("NEEDS_ATTENTION");
      expect(result.readModel.reports).toHaveLength(1);
      expect(result.readModel.reports[0]?.actualChangedFiles).toEqual([]);
      expect(result.readModel.reports[0]?.remainingProblems).toContain(
        "read-only-provider-mutation",
      );
      expect(operation?.segments[0]?.reports).toHaveLength(1);
    } finally {
      store?.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("CT-F21-13 round-trips the conversation journal and projection after a restart", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "prmonitor-f21-"));
    const databasePath = path.join(root, "database", "prmonitor.sqlite");
    const backupRoot = path.join(root, "backups");
    let store: PersistenceStore | undefined;
    let restarted: PersistenceStore | undefined;
    try {
      store = await initializePersistence(
        { databasePath, backupRoot },
        { clock: { now: () => TIME }, applicationBuild: "f21-test" },
      );
      const repositories = new F21PersistenceRepositories(store, {
        clock: { now: () => TIME },
      });
      repositories.saveReadModel({
        readModel: f21ReadModelFromBundle(bundle()),
      });
      const savedIntent = intent("READ_ONLY_CONVERSATION", "intent-restart");
      expect(repositories.recordIntent(savedIntent).created).toBe(true);
      const turn = f21TurnFromAIWork({
        bundleId: BUNDLE_ID,
        mode: "READ_ONLY_CONVERSATION",
        userMessage: savedIntent.message,
        readModel: aiReadModel("operation-restart"),
        answer: "Persisted answer.",
        progress: [],
        createdAt: TIME,
        updatedAt: TIME,
      });
      repositories.recordTurn(turn);
      repositories.recordMessage({
        schemaVersion: 1,
        messageId: "message-restart",
        bundleId: BUNDLE_ID,
        turnId: turn.turnId,
        role: "assistant",
        mode: "READ_ONLY_CONVERSATION",
        text: "Persisted answer.",
        createdAt: TIME,
      });
      store.close();
      store = undefined;

      restarted = await initializePersistence(
        { databasePath, backupRoot },
        { clock: { now: () => TIME }, applicationBuild: "f21-test-restart" },
      );
      const afterRestart = new F21PersistenceRepositories(restarted, {
        clock: { now: () => TIME },
      });
      expect(afterRestart.get(BUNDLE_ID)?.bundleId).toBe(BUNDLE_ID);
      expect(afterRestart.listTurns(BUNDLE_ID)).toHaveLength(1);
      expect(
        afterRestart.listTurnsForOperation("operation-restart"),
      ).toHaveLength(1);
      expect(afterRestart.listMessages(BUNDLE_ID)[0]?.text).toBe(
        "Persisted answer.",
      );
      expect(afterRestart.recordIntent(savedIntent).created).toBe(false);
    } finally {
      restarted?.close();
      store?.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("CT-F21-14 starts a new budget only through explicit parent authorization", async () => {
    const harness = createHarness();
    await harness.service.requestRevision(
      intent("REVIEW_REVISION", "intent-parent"),
    );
    const priorOperationId = "f21-revision-intent-parent";
    const readModel = await harness.service.startNewOperation({
      ...intent("REVIEW_REVISION", "intent-new-parent"),
      expectedBundleVersion: harness.getBundle().version,
      expectedEvidenceRevision: harness.getBundle().worktree?.snapshotId,
      priorOperationId,
      selectedBudget: 2,
    });
    expect(harness.events.lastIndexOf("authorize")).toBeLessThan(
      harness.events.lastIndexOf("begin"),
    );
    expect(harness.events).toContain("new-operation");
    expect(readModel.lastRevision?.status).toBe("READY_FOR_REVIEW");
  });
});
