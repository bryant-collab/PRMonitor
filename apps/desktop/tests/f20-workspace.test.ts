import { describe, expect, it } from "vitest";
import type {
  F13DiffEvidence,
  F13FileEvidence,
  F13InspectionResult,
  F13WorktreeCondition,
} from "../src/shared/f13-contracts";
import type { F18AutomaticReviewBoundary } from "../src/main/automatic-review-coordinator";
import { F20WorkspaceService } from "../src/main/f20-workspace-service";
import {
  f18ReviewBundleReadModelSchema,
  type F18ReviewBundleReadModel,
} from "../src/shared/f18-automatic-review";
import {
  F20_MAX_DIFF_BYTES,
  projectDiffView,
  projectReviewBundleWorkspace,
} from "../src/shared/f20-workspace";
import { parseIpcRequest, parseIpcResponse } from "../src/shared/ipc";

const TIME = "2026-09-25T12:00:00.000Z";
const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);

function repository() {
  return {
    serverId: "github.example.invalid",
    owner: "owner",
    name: "repo",
    key: "github.example.invalid/owner/repo",
  };
}

function condition(): F13WorktreeCondition {
  return {
    schemaVersion: 1,
    classification: "CLEAN",
    currentFingerprint: "fingerprint-1",
    observedRevision: HEAD_SHA,
    expectedRevision: HEAD_SHA,
    dirtySummary: {
      changedPaths: ["src/app.ts"],
      trackedPaths: ["src/app.ts"],
      stagedPaths: [],
      untrackedPaths: [],
      ignoredPaths: [],
      hash: "dirty-hash-1",
    },
    attribution: {
      evidenceRef: "condition-1",
      aiAttributedPaths: ["src/app.ts"],
      unAttributedPaths: [],
      overlapPaths: [],
      complete: true,
    },
    permittedNextActions: ["INSPECT_CHANGES", "REVALIDATE_FOR_PUBLICATION"],
  };
}

function diffEvidence(
  kind: "PROPOSED" | "CONTEXT" = "PROPOSED",
  patch = [
    "diff --git a/src/app.ts b/src/app.ts",
    "index 1111111..2222222 100644",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,2 +1,2 @@",
    " keep",
    "-old",
    "+new",
    "",
  ].join("\n"),
): F13DiffEvidence {
  const file: F13FileEvidence = {
    path: "src/app.ts",
    kind: "modified",
    staged: false,
    worktreeChanged: true,
    sizeBytes: 16,
  };
  return {
    diffId: kind === "PROPOSED" ? "proposed-diff-1" : "context-diff-1",
    operationId: "operation-1",
    worktreeId: "worktree-1",
    kind,
    baselineSha: BASE_SHA,
    currentSha: HEAD_SHA,
    diffHash: `${kind.toLowerCase()}-hash`,
    patchHash: `${kind.toLowerCase()}-patch-hash`,
    patch,
    files: [file],
    untrackedFiles: [],
    complete: true,
    regenerationContract: "F13_TEST_ONLY",
    createdAt: TIME,
  };
}

function reviewBundle(
  overrides: {
    readonly stage?: "PROPOSAL_REVIEW" | "FINAL_REVIEW";
    readonly state?: "WORKING" | "READY_FOR_REVIEW" | "NEEDS_ATTENTION";
    readonly decision?: {
      readonly decision: "pending" | "accepted" | "overridden";
      readonly finalDisposition:
        "fixed" | "pushback" | "question" | "no_change";
      readonly answer?: string;
    };
  } = {},
): F18ReviewBundleReadModel {
  const recommendation = {
    remoteEventVersionId: "event-1",
    assessment: "actionable" as const,
    disposition: "question" as const,
    explanation: "The change needs a human answer before implementation.",
    implementationProposal: {
      summary: "Clarify the behavior in the implementation.",
      relatedFiles: ["src/app.ts"],
      acceptanceNotes: "Keep the operation scoped to the recorded file.",
    },
    proposedReply: "Please clarify the expected behavior.",
    relatedFiles: ["src/app.ts"],
  };
  const decision = overrides.decision ?? {
    decision: "pending" as const,
    finalDisposition: "no_change" as const,
  };
  const decided = decision.decision !== "pending";
  const questionNeedsAnswer =
    decision.finalDisposition === "question" && !decision.answer?.trim();
  const proposed = diffEvidence("PROPOSED");
  const context = diffEvidence("CONTEXT");
  return f18ReviewBundleReadModelSchema.parse({
    schemaVersion: 1,
    kind: "REVIEW_BUNDLE_READ_MODEL",
    bundleId: "bundle-1",
    managedPrId: "pr-1",
    batchId: "batch-1",
    operationId: "operation-1",
    state: overrides.state ?? "READY_FOR_REVIEW",
    stage: overrides.stage ?? "PROPOSAL_REVIEW",
    phase: "PROPOSAL_RECORDED",
    version: 3,
    input: {
      schemaVersion: 1,
      operationId: "operation-1",
      bundleId: "bundle-1",
      batchId: "batch-1",
      managedPrId: "pr-1",
      claimId: "claim-1",
      correlationId: "correlation-1",
      schedulerRevision: 1,
      remoteEventVersionIds: ["event-1"],
      pullRequest: {
        baseRepository: repository(),
        headRepository: repository(),
        baseBranch: "main",
        headBranch: "feature",
        baseSha: BASE_SHA,
        headSha: HEAD_SHA,
        title: "Reviewable change",
      },
      feedback: [
        {
          eventVersionId: "event-1",
          semanticHash: "semantic-hash-1",
          sourceKind: "REVIEW_COMMENT",
          sourceId: "comment-1",
          observedAt: TIME,
          body: "Please clarify the expected behavior.",
          author: "reviewer",
          path: "src/app.ts",
          line: 2,
          diffHunk: "@@ -1,2 +1,2 @@\n-old\n+new",
        },
      ],
      contextText: "Keep this change narrow.",
    },
    items: [
      {
        itemId: "item-1",
        eventVersionId: "event-1",
        recommendation,
        decision,
        decisionHistory: [
          { decision: "pending", finalDisposition: "no_change" },
        ],
      },
    ],
    worktree: {
      operationId: "operation-1",
      worktreeId: "worktree-1",
      ownerType: "REVIEW_BUNDLE",
      ownerId: "bundle-1",
      canonicalPath: "C:/PRMonitor/worktrees/operation-1",
      rootRevision: 1,
      snapshotId: "snapshot-1",
      baselineSha: HEAD_SHA,
      currentSha: HEAD_SHA,
      stateFingerprint: "fingerprint-1",
      clean: false,
      complete: true,
      condition: condition(),
      changedFiles: ["src/app.ts"],
      proposedDiff: {
        diffId: proposed.diffId,
        diffHash: proposed.diffHash,
        patchHash: proposed.patchHash,
        baselineSha: proposed.baselineSha,
        currentSha: proposed.currentSha,
        fileCount: 1,
        complete: true,
      },
      contextDiff: {
        diffId: context.diffId,
        diffHash: context.diffHash,
        patchHash: context.patchHash,
        baselineSha: context.baselineSha,
        currentSha: context.currentSha,
        fileCount: 1,
        complete: true,
      },
    },
    proposalWork: undefined,
    implementationWork: undefined,
    draftResponses: [],
    reasons:
      overrides.state === "NEEDS_ATTENTION"
        ? [
            {
              code: "REVIEW_EVIDENCE",
              what: "The Review Bundle needs attention.",
              why: "A deterministic evidence condition requires review.",
              nextAction: "REVIEW_EVIDENCE",
            },
          ]
        : [],
    nextAction: "REVIEW_DECISIONS",
    noImplementationChanges: true,
    decisionSummary: {
      total: 1,
      decided: decided ? 1 : 0,
      fixed: decision.finalDisposition === "fixed" ? 1 : 0,
      questionsNeedingAnswer: questionNeedsAnswer ? 1 : 0,
      complete: decided && !questionNeedsAnswer,
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

function inspection(): F13InspectionResult {
  return {
    ok: true,
    worktree: {} as F13InspectionResult["worktree"],
    condition: condition(),
    proposedDiff: diffEvidence("PROPOSED"),
    contextDiff: diffEvidence("CONTEXT"),
  };
}

function boundary(model: F18ReviewBundleReadModel): F18AutomaticReviewBoundary {
  return {
    startAutomaticReview: async () => ({ outcome: "ACCEPTED" }),
    getReadModel: () => model,
    recordDecision: () => model,
    confirmReviewDecisions: async () => model,
    saveDraftResponse: () => model,
  };
}

describe("F20 Review Bundle workspace projection", () => {
  it("keeps proposal decisions, question gates, and authority labels explicit", () => {
    const workspace = projectReviewBundleWorkspace({
      readModel: reviewBundle(),
    });
    const item = workspace.items[0];
    expect(workspace.statePresentation.label).toBe("READY FOR REVIEW");
    expect(item?.decisionStatus).toBe("QUESTION_NEEDS_ANSWER");
    expect(item?.questionAnswerRequired).toBe(true);
    expect(
      workspace.actions.find((action) => action.id === "ACCEPT_RECOMMENDATION")
        ?.enabled,
    ).toBe(true);
    expect(
      workspace.actions.find((action) => action.id === "CONFIRM_DECISIONS")
        ?.enabled,
    ).toBe(false);
    expect(workspace.authority.publication).toBe("F23_ONLY");
    expect(workspace.diffReferences.relevantAvailable).toBe(true);
  });

  it("presents attention as a persistent, evidenced state", () => {
    const workspace = projectReviewBundleWorkspace({
      readModel: reviewBundle({ state: "NEEDS_ATTENTION" }),
    });
    expect(workspace.statePresentation).toMatchObject({
      label: "NEEDS ATTENTION",
      semantic: "ATTENTION",
      nextAction: "REVIEW_EVIDENCE",
    });
    expect(
      workspace.statePresentation.preservedEvidence.length,
    ).toBeGreaterThan(0);
  });
});

describe("F20 diff authority and read-only parsing", () => {
  it("separates relevant, proposed, and context authority while retaining line numbers", () => {
    const source = inspection();
    const proposed = projectDiffView({
      bundleId: "bundle-1",
      operationId: "operation-1",
      mode: "PROPOSED_WORKTREE",
      inspection: source,
      prBaseSha: BASE_SHA,
      prHeadSha: HEAD_SHA,
      worktreeBaselineSha: HEAD_SHA,
    });
    const relevant = projectDiffView({
      bundleId: "bundle-1",
      operationId: "operation-1",
      mode: "RELEVANT",
      inspection: source,
      prBaseSha: BASE_SHA,
      prHeadSha: HEAD_SHA,
      worktreeBaselineSha: HEAD_SHA,
      selectedItemId: "item-1",
      relatedPaths: ["src/app.ts"],
    });
    const context = projectDiffView({
      bundleId: "bundle-1",
      operationId: "operation-1",
      mode: "PR_CONTEXT",
      inspection: source,
      prBaseSha: BASE_SHA,
      prHeadSha: HEAD_SHA,
      worktreeBaselineSha: HEAD_SHA,
    });
    expect(proposed.publicationEligible).toBe(true);
    expect(proposed.authority).toBe("PUBLICATION_CANDIDATE");
    expect(proposed.files[0]?.marker).toBe("MODIFIED");
    expect(proposed.files[0]?.hunks[0]?.lines).toEqual([
      expect.objectContaining({ kind: "CONTEXT", oldLine: 1, newLine: 1 }),
      expect.objectContaining({ kind: "REMOVAL", oldLine: 2 }),
      expect.objectContaining({ kind: "ADDITION", newLine: 2 }),
    ]);
    expect(relevant.authority).toBe("ITEM_CONTEXT");
    expect(relevant.publicationEligible).toBe(false);
    expect(context.authority).toBe("PR_CONTEXT");
    expect(context.publicationEligible).toBe(false);
  });

  it("returns an explicit over-limit state instead of silently truncating authoritative content", () => {
    const source = inspection();
    const overLimit = projectDiffView({
      bundleId: "bundle-1",
      operationId: "operation-1",
      mode: "PROPOSED_WORKTREE",
      inspection: {
        ...source,
        proposedDiff: diffEvidence(
          "PROPOSED",
          "x".repeat(F20_MAX_DIFF_BYTES + 1),
        ),
      },
      prBaseSha: BASE_SHA,
      prHeadSha: HEAD_SHA,
      worktreeBaselineSha: HEAD_SHA,
    });
    expect(overLimit.status).toBe("OVER_LIMIT");
    expect(overLimit.publicationEligible).toBe(false);
    expect(overLimit.files).toHaveLength(0);
  });
});

describe("F20 workspace service boundary", () => {
  it("keeps passive reads free of inspections and gates file actions to recorded paths", async () => {
    const model = reviewBundle();
    let inspectCalls = 0;
    let openFileCalls = 0;
    const service = new F20WorkspaceService({
      bundles: boundary(model),
      worktrees: {
        inspectOperation: async () => {
          inspectCalls += 1;
          return inspection();
        },
        openWorktree: async () => ({
          ok: true,
          action: "OPEN_WORKTREE" as const,
          resolvedPath: "C:/PRMonitor/worktrees/operation-1",
        }),
        openFile: async () => {
          openFileCalls += 1;
          return {
            ok: true,
            action: "OPEN_FILE" as const,
            resolvedPath: "C:/PRMonitor/worktrees/operation-1/src/app.ts",
          };
        },
        revealFile: async () => ({
          ok: true,
          action: "REVEAL_FILE" as const,
          resolvedPath: "C:/PRMonitor/worktrees/operation-1/src/app.ts",
        }),
      },
    });

    expect(service.read("bundle-1").bundleId).toBe("bundle-1");
    expect(inspectCalls).toBe(0);
    expect(
      (
        await service.readDiff({
          bundleId: "bundle-1",
          mode: "PROPOSED_WORKTREE",
        })
      ).status,
    ).toBe("READY");
    expect(inspectCalls).toBe(1);
    await expect(
      service.pathAction({
        bundleId: "bundle-1",
        action: "OPEN_FILE",
        relativePath: "secrets.txt",
      }),
    ).rejects.toMatchObject({ code: "PATH_NOT_RECORDED" });
    expect(openFileCalls).toBe(0);
    const opened = await service.pathAction({
      bundleId: "bundle-1",
      action: "OPEN_FILE",
      relativePath: "src/app.ts",
    });
    expect(opened).toMatchObject({ ok: true, action: "OPEN_FILE" });
    expect(openFileCalls).toBe(1);
    const refreshed = await service.refreshWorktree({
      bundleId: "bundle-1",
      expectedVersion: model.version,
    });
    expect(refreshed.worktree?.condition?.classification).toBe("CLEAN");
  });
});

describe("F20 IPC contracts", () => {
  it("allowlists workspace operations and rejects arbitrary path payloads", () => {
    expect(
      parseIpcRequest({
        schemaVersion: 1,
        requestId: "f20-read",
        type: "review-bundle.read",
        payload: { bundleId: "bundle-1" },
      }).ok,
    ).toBe(true);
    expect(
      parseIpcRequest({
        schemaVersion: 1,
        requestId: "f20-path",
        type: "review-bundle.path-action",
        payload: {
          bundleId: "bundle-1",
          action: "OPEN_FILE",
          relativePath: "../outside.txt",
        },
      }).ok,
    ).toBe(false);
    expect(
      parseIpcResponse({
        schemaVersion: 1,
        requestId: "f20-result",
        ok: true,
        value: {
          kind: "review-bundle-path-action",
          result: {
            ok: true,
            action: "OPEN_FILE",
            resolvedPath: "C:/PRMonitor/worktrees/operation-1/src/app.ts",
          },
        },
      }),
    ).toBe(true);
  });
});
