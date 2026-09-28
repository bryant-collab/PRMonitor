import { describe, expect, it } from "vitest";
import type { F25PersistencePort } from "../src/main/persistence/f25-repositories";
import { F26ConflictResolutionService } from "../src/main/f26-conflict-resolution-service";
import {
  f26CompletionGuard,
  f26ConflictContextSchema,
  f26TextSegments,
  F26_MAX_CONTEXT_SEGMENTS,
  F26_MAX_CONTEXT_TEXT_BYTES,
  type F26ConflictResolutionReadModel,
} from "../src/shared/f26-conflict-resolution";
import type { AIConflictResolutionResult } from "../src/shared/ai/provider-contracts";
import type { F25SynchronizationResultReadModel } from "../src/shared/f25-synchronization";

const SOURCE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const NOW = "2026-09-28T12:00:00.000Z";

function assessment(
  status: AIConflictResolutionResult["status"],
): AIConflictResolutionResult {
  return {
    schemaVersion: 1,
    status,
    summary:
      status === "ambiguous"
        ? "Two compatible interpretations remain possible."
        : status === "blocked"
          ? "The provider could not safely inspect the conflict."
          : "The conflict was resolved while retaining both branch intents.",
    remainingIssues: status === "resolved" ? [] : ["review-required"],
    ...(status === "ambiguous"
      ? {
          competingIntents: [
            "Preserve the destination's existing behavior.",
            "Adopt the source's new behavior.",
          ],
          userQuestion: "Which behavior should win for this path?",
        }
      : {}),
    ...(status === "resolved"
      ? {
          sourceIntent: "The source adds the new branch behavior.",
          destinationIntent: "The destination preserves existing callers.",
          resolutionScope: "CONFLICT_ONLY" as const,
          confidence: 0.92,
          evidence: ["Both branch patches were inspected."],
        }
      : {}),
  };
}

function guardInput(
  overrides: Partial<Parameters<typeof f26CompletionGuard>[0]> = {},
) {
  return {
    providerStatus: "completed",
    assessment: assessment("resolved"),
    worktree: {
      complete: true,
      forbiddenMutation: false,
      unmergedPaths: [],
      conflictMarkers: [],
      attributionComplete: true,
      expectedHeadRevision: HEAD_SHA,
      currentHeadRevision: HEAD_SHA,
    },
    validation: {
      status: "passed" as const,
      complete: true,
    },
    checkedAt: NOW,
    evidenceHash: "f26-evidence",
    ...overrides,
  };
}

function context() {
  return f26ConflictContextSchema.parse({
    schemaVersion: 1,
    sourceRepository: {
      serverId: "github.example.invalid",
      owner: "source-owner",
      name: "source-repository",
      key: "github:source-owner/source-repository",
    },
    destinationRepository: {
      serverId: "github.example.invalid",
      owner: "head-owner",
      name: "head-repository",
      key: "github:head-owner/head-repository",
    },
    sourceBranch: "main",
    destinationBranch: "feature",
    sourceSha: SOURCE_SHA,
    destinationSha: HEAD_SHA,
    mergeBaseSha: "c".repeat(40),
    sourceChangeSet: {
      schemaVersion: 1,
      side: "SOURCE",
      baseSha: "c".repeat(40),
      tipSha: SOURCE_SHA,
      files: [{ path: "src/example.ts", kind: "modified" }],
      patchSegments: [],
      commitMetadata: [],
      evidenceHash: "source-evidence",
      complete: true,
    },
    destinationChangeSet: {
      schemaVersion: 1,
      side: "DESTINATION",
      baseSha: "c".repeat(40),
      tipSha: HEAD_SHA,
      files: [{ path: "src/example.ts", kind: "modified" }],
      patchSegments: [],
      commitMetadata: [],
      evidenceHash: "destination-evidence",
      complete: true,
    },
    conflicts: [
      {
        path: "src/example.ts",
        statusCode: "UU",
        contentSegments: [{ index: 0, total: 1, text: "conflict" }],
        contentComplete: true,
      },
    ],
    pullRequest: { managedPrId: "pr-1" },
    intent: { commonInstructions: [] },
    missingContext: [],
  });
}

function retryFixture(): {
  readonly result: F25SynchronizationResultReadModel;
  readonly prior: F26ConflictResolutionReadModel;
} {
  const prior = {
    schemaVersion: 1 as const,
    status: "AMBIGUOUS" as const,
    taskProfile: {
      snapshotId: "snapshot-1",
      snapshotHash: "snapshot-hash",
      profileId: "profile-1",
      profileRevision: 4,
      providerId: "codex",
      modelId: "model-1",
      policyId: "policy-1",
      policyRevision: 2,
      configuredTurnBudget: 3,
      timeoutMs: 30_000,
    },
    context: context(),
    assessment: assessment("ambiguous"),
    consultationHistory: [
      {
        id: "consultation-1",
        kind: "AMBIGUITY_ANALYSIS" as const,
        createdAt: NOW,
        paths: ["src/example.ts"],
        competingIntents: ["source", "destination"],
        question: "Which behavior should win?",
      },
    ],
    turnHistory: [
      {
        turnId: "turn-1",
        providerStatus: "completed",
        changedPaths: ["src/example.ts"],
        remainingIssues: ["user-choice-required"],
        deterministicProblems: [],
        usage: { providerInvoked: true, turns: 1, tokens: 120 },
        recordedAt: NOW,
      },
    ],
    usage: {
      providerInvoked: true,
      turns: 1,
      tokens: 120,
      providerId: "codex",
      modelId: "model-1",
      profileRevision: 4,
      policyId: "policy-1",
    },
    nextAction: "ANSWER_USER" as const,
    updatedAt: NOW,
  } satisfies F26ConflictResolutionReadModel;
  const result = {
    schemaVersion: 1 as const,
    kind: "synchronization-result" as const,
    operationId: "sync-1",
    batchId: "batch-1",
    managedPrId: "pr-1",
    status: "NEEDS_ATTENTION" as const,
    stage: "ATTENTION" as const,
    mergeOutcome: "CONFLICT_DETECTED" as const,
    input: {} as F25SynchronizationResultReadModel["input"],
    conflicts: [],
    aiUsage: { providerInvoked: true, turns: 1, tokens: 120 },
    capabilities: {
      canCommit: false as const,
      canPush: false as const,
      canPublish: false as const,
      canInvokeAi: false as const,
    },
    reason: {
      code: "F26_AMBIGUOUS_INTENT",
      what: "A user decision is required.",
      why: "Both branch intents remain plausible.",
      nextAction: "MANUAL_RESOLUTION" as const,
      correlationId: "f26-sync-1",
    },
    nextAction: "MANUAL_RESOLUTION" as const,
    version: 7,
    createdAt: NOW,
    updatedAt: NOW,
    handoff: {} as F25SynchronizationResultReadModel["handoff"],
    conflictResolution: prior,
  } as F25SynchronizationResultReadModel;
  return { result, prior };
}

describe("F26 AI-assisted merge-conflict resolution", () => {
  it("keeps conflict context in bounded segments and refuses oversized context", () => {
    const value = "x".repeat(F26_MAX_CONTEXT_TEXT_BYTES + 10);
    const segments = f26TextSegments(value);
    expect(segments.length).toBe(2);
    expect(segments.every((segment) => segment.total === 2)).toBe(true);
    expect(() =>
      f26TextSegments(
        "x".repeat(F26_MAX_CONTEXT_TEXT_BYTES * (F26_MAX_CONTEXT_SEGMENTS + 1)),
      ),
    ).toThrow("F26_CONTEXT_SEGMENT_LIMIT_EXCEEDED");
  });

  it("accepts a semantically resolvable conflict only after deterministic checks", () => {
    const result = f26CompletionGuard(guardInput());
    expect(result).toMatchObject({
      ready: true,
      status: "RESOLVED",
      mergeOutcome: "CONFLICT_RESOLVED",
      nextAction: "NONE",
    });
  });

  it("turns competing intent into an actionable user question", () => {
    const result = f26CompletionGuard(
      guardInput({ assessment: assessment("ambiguous") }),
    );
    expect(result).toMatchObject({
      ready: false,
      status: "AMBIGUOUS",
      nextAction: "ANSWER_USER",
      reasonCode: "F26_AMBIGUOUS_INTENT",
    });
    expect(result.remainingProblems).toContain("ambiguous-intent");
  });

  it("does not let a provider completion claim bypass unmerged-path evidence", () => {
    const result = f26CompletionGuard(
      guardInput({
        worktree: {
          complete: true,
          forbiddenMutation: false,
          unmergedPaths: ["src/example.ts"],
          conflictMarkers: [],
          attributionComplete: true,
          expectedHeadRevision: HEAD_SHA,
          currentHeadRevision: HEAD_SHA,
        },
      }),
    );
    expect(result.ready).toBe(false);
    expect(result.status).toBe("NEEDS_ATTENTION");
    expect(result.reasonCode).toBe("F26_UNMERGED_PATHS_REMAIN");
  });

  it("appends an explicit retry consultation without resetting prior evidence or budget", async () => {
    const { result, prior } = retryFixture();
    const savedResults: F25SynchronizationResultReadModel[] = [];
    const persistence = {
      getResult: () => result,
      putResult: (next: F25SynchronizationResultReadModel) => {
        savedResults.push(next);
        return next;
      },
    } as unknown as F25PersistencePort;
    const service = new F26ConflictResolutionService({
      persistence,
      managedPrs: { getManagedPr: () => undefined },
      f16: {} as never,
      f13: {} as never,
      aiWork: {} as never,
      now: () => "2026-09-28T12:01:00.000Z",
    });

    const saved = await service.retry({
      result,
      action: { kind: "RETRY_RESOLUTION" },
    });
    const resolution = saved.conflictResolution!;
    expect(savedResults).toHaveLength(1);
    expect(resolution.consultationHistory).toHaveLength(
      prior.consultationHistory.length + 1,
    );
    expect(resolution.turnHistory).toEqual(prior.turnHistory);
    expect(resolution.usage).toEqual(prior.usage);
    expect(resolution.taskProfile.configuredTurnBudget).toBe(
      prior.taskProfile.configuredTurnBudget,
    );
    expect(resolution.nextAction).toBe("RETRY_RESOLUTION");
  });
});
