import { describe, expect, it } from "vitest";
import type {
  F13InspectionResult,
  F13WorktreeCondition,
} from "../src/shared/f13-contracts";
import {
  F22Coordinator,
  type F22F11Port,
  type F22F13Port,
} from "../src/main/f22-coordinator";
import type {
  F11AutomaticClaimRecord,
  F11HoldRecord,
} from "../src/main/persistence/f11-repositories";
import type { F18AutomaticReviewBoundary } from "../src/main/automatic-review-coordinator";
import {
  f22ActionResultSchema,
  f22ActionIntentSchema,
  f22BundleStateRecordSchema,
  type F22ActionIntent,
  type F22BundleStateRecord,
  type F22RemoteHeadRead,
} from "../src/shared/f22-discard-reevaluation";
import type { F22PersistencePort } from "../src/main/persistence/f22-repositories";
import type {
  F18AutomaticReviewHandoff,
  F18ReviewBundleReadModel,
} from "../src/shared/f18-automatic-review";
import {
  classifyF22RemoteHead,
  f22GateFor,
  initialF22BundleState,
} from "../src/shared/f22-discard-reevaluation";

const NOW = "2026-09-26T12:00:00.000Z";

function bundle(): F18ReviewBundleReadModel {
  return {
    bundleId: "bundle-1",
    managedPrId: "managed-pr-1",
    state: "READY_FOR_REVIEW",
    version: 3,
    input: {
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
      },
      remoteEventVersionIds: ["event-1"],
    },
  } as unknown as F18ReviewBundleReadModel;
}

function reviewBundle(
  bundleId = "bundle-1",
  operationId = "operation-1",
): F18ReviewBundleReadModel {
  const value = bundle();
  return {
    ...value,
    bundleId,
    operationId,
    input: {
      ...value.input,
      bundleId,
      operationId,
    },
  };
}

function cleanCondition(): F13WorktreeCondition {
  return {
    schemaVersion: 1,
    classification: "CLEAN",
    currentFingerprint: "a".repeat(64),
    observedRevision: "b".repeat(40),
    expectedRevision: "b".repeat(40),
    dirtySummary: {
      changedPaths: [],
      trackedPaths: [],
      stagedPaths: [],
      untrackedPaths: [],
      ignoredPaths: [],
      hash: "c".repeat(64),
    },
    attribution: {
      evidenceRef: "condition-1",
      aiAttributedPaths: [],
      unAttributedPaths: [],
      overlapPaths: [],
      complete: true,
    },
    permittedNextActions: ["CONTINUE_AI_WORK", "REVALIDATE_FOR_PUBLICATION"],
  };
}

function dirtyCondition(): F13WorktreeCondition {
  const condition = cleanCondition();
  return {
    ...condition,
    classification: "UNATTRIBUTED_CHANGES",
    currentFingerprint: "d".repeat(64),
    dirtySummary: {
      ...condition.dirtySummary,
      changedPaths: ["developer.txt"],
      trackedPaths: ["developer.txt"],
      hash: "e".repeat(64),
    },
    attribution: {
      ...condition.attribution,
      unAttributedPaths: ["developer.txt"],
    },
    permittedNextActions: [
      "REQUEST_WORKTREE_DECISION",
      "CLEAR_ALL_CHANGES",
      "KEEP_WORKTREE_AND_CANCEL",
    ],
  };
}

function inspection(condition = cleanCondition()): F13InspectionResult {
  return { ok: true, condition } as F13InspectionResult;
}

function currentRemote(
  headSha = "b".repeat(40),
  observationRevision = 1,
  observedAt = NOW,
): F22RemoteHeadRead {
  return {
    outcome: "CURRENT",
    identity: {
      serverId: "github.example.invalid",
      repositoryKey: "github.example.invalid/owner/repo",
    },
    baseSha: "a".repeat(40),
    headSha,
    baseRepository: bundle().input.pullRequest.baseRepository,
    headRepository: bundle().input.pullRequest.headRepository,
    baseBranch: "main",
    headBranch: "feature",
    observationRevision,
    observedAt,
  };
}

class MemoryF22Persistence implements F22PersistencePort {
  public readonly states = new Map<string, F22BundleStateRecord>();
  public readonly actions = new Map<string, F22ActionIntent>();

  public getBundleState(bundleId: string) {
    return this.states.get(bundleId);
  }

  public listBundleStates(managedPrId: string) {
    return [...this.states.values()].filter(
      (state) => state.managedPrId === managedPrId,
    );
  }

  public putBundleState(input: {
    readonly state: F22BundleStateRecord;
    readonly expectedRevision?: number;
  }) {
    const state = f22BundleStateRecordSchema.parse(input.state);
    const current = this.states.get(state.bundleId);
    if (
      current !== undefined &&
      input.expectedRevision !== undefined &&
      current.revision !== input.expectedRevision
    )
      throw new Error("TEST_F22_STATE_CONFLICT");
    this.states.set(state.bundleId, state);
    return state;
  }

  public getAction(actionId: string) {
    return this.actions.get(actionId);
  }

  public getActionByIdempotency(idempotencyKey: string) {
    return [...this.actions.values()].find(
      (action) => action.idempotencyKey === idempotencyKey,
    );
  }

  public persistActionIntent(input: F22ActionIntent) {
    const action = f22ActionIntentSchema.parse(input);
    const existing = this.getActionByIdempotency(action.idempotencyKey);
    if (existing !== undefined) return existing;
    this.actions.set(action.actionId, action);
    return action;
  }

  public updateAction(input: { readonly action: F22ActionIntent }) {
    const action = f22ActionIntentSchema.parse(input.action);
    this.actions.set(action.actionId, action);
    return action;
  }

  public listPendingActions() {
    return [...this.actions.values()].filter(
      (action) => action.status === "PENDING" || action.status === "UNKNOWN",
    );
  }
}

function activeClaim(): F11AutomaticClaimRecord {
  return {
    claimId: "claim-1",
    managedPrId: "managed-pr-1",
    operationId: "operation-1",
    bundleId: "bundle-1",
    state: "ACTIVE",
    eventVersionIds: ["event-1"],
    configurationSnapshot:
      {} as F11AutomaticClaimRecord["configurationSnapshot"],
    correlationId: "claim-correlation",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function activeHold(): F11HoldRecord {
  return {
    holdId: "hold-1",
    managedPrId: "managed-pr-1",
    claimId: "claim-1",
    operationId: "operation-1",
    bundleId: "bundle-1",
    state: "ACTIVE",
    reason: {
      code: "AUTOMATIC_OPERATION_ACTIVE",
      what: "The operation owns the PR.",
      why: "The hold prevents competing work.",
      nextAction: "REVIEW",
      details: {},
    },
    acquiredAt: NOW,
    version: 1,
    updatedAt: NOW,
  };
}

function aiOnlyCondition(): F13WorktreeCondition {
  const condition = cleanCondition();
  return {
    ...condition,
    classification: "AI_ATTRIBUTED_ONLY",
    currentFingerprint: "d".repeat(64),
    dirtySummary: {
      ...condition.dirtySummary,
      changedPaths: ["ai-change.txt"],
      trackedPaths: ["ai-change.txt"],
      hash: "e".repeat(64),
    },
    attribution: {
      ...condition.attribution,
      aiAttributedPaths: ["ai-change.txt"],
    },
    permittedNextActions: [
      "REQUEST_WORKTREE_DECISION",
      "CLEAR_ONLY_AI_CHANGES",
      "KEEP_WORKTREE_AND_CANCEL",
    ],
  };
}

function overlapCondition(): F13WorktreeCondition {
  const condition = dirtyCondition();
  return {
    ...condition,
    classification: "MIXED_OR_OVERLAP",
    dirtySummary: {
      ...condition.dirtySummary,
      changedPaths: ["ai-change.txt", "developer.txt", "shared.txt"],
      trackedPaths: ["ai-change.txt", "developer.txt", "shared.txt"],
      hash: "f".repeat(64),
    },
    attribution: {
      ...condition.attribution,
      aiAttributedPaths: ["ai-change.txt"],
      unAttributedPaths: ["developer.txt"],
      overlapPaths: ["shared.txt"],
    },
    permittedNextActions: [
      "REQUEST_WORKTREE_DECISION",
      "CLEAR_ALL_CHANGES",
      "KEEP_WORKTREE_AND_CANCEL",
    ],
  };
}

function discardFixture(input: {
  readonly conditions: readonly F13WorktreeCondition[];
  readonly clearChanges?: F22F13Port["clearChanges"];
  readonly completeDiscard?: F22F11Port["completeDiscard"];
}): {
  readonly coordinator: F22Coordinator;
  readonly persistence: MemoryF22Persistence;
  readonly source: F18ReviewBundleReadModel;
  readonly inspectionCalls: () => number;
  readonly clearCalls: () => number;
  readonly completeCalls: () => number;
  readonly choices: () => readonly string[];
} {
  const persistence = new MemoryF22Persistence();
  const source = reviewBundle();
  let inspectionIndex = 0;
  let inspectionCount = 0;
  let clearCount = 0;
  let completeCount = 0;
  const choices: string[] = [];
  const coordinator = new F22Coordinator({
    persistence,
    bundles: {
      getReadModel: (bundleId) =>
        bundleId === source.bundleId ? source : undefined,
      startAutomaticReview: async () => ({ outcome: "REJECTED" as const }),
      recordDecision: () => source,
      confirmReviewDecisions: async () => source,
      saveDraftResponse: () => source,
    } satisfies F18AutomaticReviewBoundary,
    remote: {
      readCurrentHead: async () => currentRemote(),
    },
    f13: {
      inspectOperation: async () => {
        inspectionCount += 1;
        const condition =
          input.conditions[
            Math.min(inspectionIndex++, input.conditions.length - 1)
          ] ?? cleanCondition();
        return inspection(condition);
      },
      clearChanges: async (clearInput) => {
        clearCount += 1;
        choices.push(clearInput.choice);
        if (input.clearChanges !== undefined)
          return input.clearChanges(clearInput);
        return {
          ok: true,
          choice: clearInput.choice,
          removed: [],
          preserved: [],
          remaining: [],
        };
      },
    },
    f11: {
      getActiveClaim: () => activeClaim(),
      getActiveHold: () => activeHold(),
      listRetainedVersionIds: () => [],
      completeDiscard: (completeInput) => {
        completeCount += 1;
        return (
          input.completeDiscard?.(completeInput) ?? { outcome: "RELEASED" }
        );
      },
      transferForReevaluation: () => ({ outcome: "CONFLICT" as const }),
    },
    clock: () => NOW,
  });
  return {
    coordinator,
    persistence,
    source,
    inspectionCalls: () => inspectionCount,
    clearCalls: () => clearCount,
    completeCalls: () => completeCount,
    choices: () => choices,
  };
}

describe("F22 stale/discard/re-evaluation contracts", () => {
  it("records an exact server-scoped head movement as monotonic stale evidence", () => {
    const observation = classifyF22RemoteHead({
      expected: {
        serverId: "github.example.invalid",
        repositoryKey: "github.example.invalid/owner/repo",
      },
      expectedHeadSha: "b".repeat(40),
      read: {
        outcome: "CURRENT",
        identity: {
          serverId: "github.example.invalid",
          repositoryKey: "github.example.invalid/owner/repo",
        },
        baseSha: "a".repeat(40),
        headSha: "c".repeat(40),
        observationRevision: 7,
        observedAt: NOW,
      },
      now: NOW,
      maxAgeMs: 60_000,
    });

    expect(observation.outcome).toBe("MOVED");
    expect(observation.reason.code).toBe("REMOTE_HEAD_MOVED");
    expect(observation.observedHeadSha).toBe("c".repeat(40));
  });

  it("does not turn failed or cancelled remote reads into stale claims", () => {
    const observation = classifyF22RemoteHead({
      expected: {
        serverId: "github.example.invalid",
        repositoryKey: "github.example.invalid/owner/repo",
      },
      expectedHeadSha: "b".repeat(40),
      read: {
        outcome: "UNAVAILABLE",
        identity: {
          serverId: "github.example.invalid",
          repositoryKey: "github.example.invalid/owner/repo",
        },
        observationRevision: 8,
        observedAt: NOW,
      },
      now: NOW,
      maxAgeMs: 60_000,
    });

    expect(observation.outcome).toBe("UNAVAILABLE");
    expect(observation.reason.code).toBe("REMOTE_HEAD_CHECK_UNAVAILABLE");
  });

  it("rejects a fresh SHA that belongs to another exact pull-request identity", () => {
    const observation = classifyF22RemoteHead({
      expected: {
        serverId: "github.example.invalid",
        repositoryKey: "github.example.invalid/owner/repo",
        pullRequestKey: "github.example.invalid/owner/repo#7",
      },
      expectedHeadSha: "b".repeat(40),
      read: {
        outcome: "CURRENT",
        identity: {
          serverId: "github.example.invalid",
          repositoryKey: "github.example.invalid/owner/repo",
          pullRequestKey: "github.example.invalid/owner/repo#8",
        },
        baseSha: "a".repeat(40),
        headSha: "b".repeat(40),
        observationRevision: 9,
        observedAt: NOW,
      },
      now: NOW,
      maxAgeMs: 60_000,
    });

    expect(observation.outcome).toBe("MALFORMED");
    expect(observation.reason.code).toBe("REMOTE_IDENTITY_MISMATCH");
  });

  it("requires exact base/head repositories, branches, and base SHA", () => {
    const source = bundle();
    const observation = classifyF22RemoteHead({
      expected: {
        serverId: "github.example.invalid",
        repositoryKey: "github.example.invalid/owner/repo",
      },
      expectedHeadSha: source.input.pullRequest.headSha,
      expectedBaseSha: source.input.pullRequest.baseSha,
      expectedBaseRepository: source.input.pullRequest.baseRepository,
      expectedHeadRepository: source.input.pullRequest.headRepository,
      expectedBaseBranch: source.input.pullRequest.baseBranch,
      expectedHeadBranch: source.input.pullRequest.headBranch,
      read: {
        ...currentRemote(),
        baseSha: "d".repeat(40),
        headBranch: "other-feature",
      },
      now: NOW,
      maxAgeMs: 60_000,
    });

    expect(observation.outcome).toBe("MALFORMED");
    expect(observation.reason.code).toBe("REMOTE_REF_IDENTITY_MISMATCH");
  });

  it("exposes inspect, discard, and re-evaluate while blocking continuation for stale evidence", () => {
    const reviewBundle = bundle();
    const state = {
      ...initialF22BundleState({
        bundle: reviewBundle,
        identity: {
          serverId: "github.example.invalid",
          repositoryKey: "github.example.invalid/owner/repo",
        },
      }),
      status: "STALE" as const,
      revision: 2,
      observedIdentity: {
        serverId: "github.example.invalid",
        repositoryKey: "github.example.invalid/owner/repo",
      },
      observedBaseSha: "a".repeat(40),
      observedHeadSha: "c".repeat(40),
      observedBaseRepository: reviewBundle.input.pullRequest.baseRepository,
      observedHeadRepository: reviewBundle.input.pullRequest.headRepository,
      observedBaseBranch: reviewBundle.input.pullRequest.baseBranch,
      observedHeadBranch: reviewBundle.input.pullRequest.headBranch,
      observationRevision: 1,
      observedAt: NOW,
      reason: {
        code: "REMOTE_HEAD_MOVED",
        what: "The pull-request head moved.",
        why: "The bundle no longer matches the exact remote head.",
        nextAction: "RE_EVALUATE",
        details: {},
      },
    };
    const gate = f22GateFor(reviewBundle, state);

    expect(gate.actions.inspect).toBe(true);
    expect(gate.actions.discard).toBe(true);
    expect(gate.actions.reevaluate).toBe(true);
    expect(gate.actions.continueOldWork).toBe(false);
    expect(gate.actions.publication).toBe(false);
  });

  it("blocks freshness-dependent actions when the remote check is unavailable", () => {
    const reviewBundle = bundle();
    const state = {
      ...initialF22BundleState({
        bundle: reviewBundle,
        identity: {
          serverId: "github.example.invalid",
          repositoryKey: "github.example.invalid/owner/repo",
        },
      }),
      status: "ATTENTION" as const,
      revision: 2,
      reason: {
        code: "REMOTE_HEAD_CHECK_UNAVAILABLE",
        what: "The current pull-request head could not be verified.",
        why: "F22 cannot authorize a freshness-dependent action from an incomplete read.",
        nextAction: "RETRY",
        details: {},
      },
    };
    const gate = f22GateFor(reviewBundle, state, {
      hold: {
        active: true,
        bundleId: reviewBundle.bundleId,
        operationId: reviewBundle.operationId,
      },
    });

    expect(gate.status).toBe("ATTENTION");
    expect(gate.actions.discard).toBe(false);
    expect(gate.actions.reevaluate).toBe(false);
    expect(gate.actions.continueOldWork).toBe(false);
    expect(gate.reason?.code).toBe("REMOTE_HEAD_CHECK_UNAVAILABLE");
  });

  it("blocks F22 effects without exact F11 ownership or during an active F21 mutation", () => {
    const source = reviewBundle();
    const state = {
      ...initialF22BundleState({
        bundle: source,
        identity: {
          serverId: "github.example.invalid",
          repositoryKey: "github.example.invalid/owner/repo",
        },
      }),
      status: "STALE" as const,
      revision: 2,
      observedIdentity: {
        serverId: "github.example.invalid",
        repositoryKey: "github.example.invalid/owner/repo",
      },
      observedBaseSha: "a".repeat(40),
      observedHeadSha: "c".repeat(40),
      observedBaseRepository: source.input.pullRequest.baseRepository,
      observedHeadRepository: source.input.pullRequest.headRepository,
      observedBaseBranch: source.input.pullRequest.baseBranch,
      observedHeadBranch: source.input.pullRequest.headBranch,
      observationRevision: 1,
      observedAt: NOW,
      reason: {
        code: "REMOTE_HEAD_MOVED",
        what: "The pull-request head moved.",
        why: "The bundle no longer matches the exact remote head.",
        nextAction: "RE_EVALUATE",
        details: {},
      },
    };
    const noOwner = f22GateFor(source, state, {
      hold: { active: false },
    });
    expect(noOwner.actions.discard).toBe(false);
    expect(noOwner.actions.reevaluate).toBe(false);
    expect(noOwner.reason?.code).toBe("F11_HOLD_MISSING_OR_MISMATCHED");

    const activeMutation = f22GateFor(source, state, {
      hold: {
        active: true,
        bundleId: source.bundleId,
        operationId: source.operationId,
      },
      activeOperation: {
        mutationActive: true,
        operationId: "f21-operation-1",
        status: "WORKING",
      },
    });
    expect(activeMutation.actions.discard).toBe(false);
    expect(activeMutation.actions.reevaluate).toBe(false);
    expect(activeMutation.reason?.code).toBe("F21_OPERATION_ACTIVE");
  });

  it("marks an interrupted delegated effect unknown without retrying it at startup", async () => {
    const persistence = new MemoryF22Persistence();
    const source = reviewBundle();
    const registered = initialF22BundleState({
      bundle: source,
      identity: {
        serverId: "github.example.invalid",
        repositoryKey: "github.example.invalid/owner/repo",
      },
    });
    persistence.states.set(source.bundleId, {
      ...registered,
      status: "STALE",
      revision: 1,
      reason: {
        code: "REMOTE_HEAD_MOVED",
        what: "The pull-request head moved.",
        why: "The bundle no longer matches the exact remote head.",
        nextAction: "RE_EVALUATE",
        details: {},
      },
      updatedAt: NOW,
    });
    const action = f22ActionIntentSchema.parse({
      schemaVersion: 1,
      actionId: "f22-action-restart",
      idempotencyKey: "f22-action-restart-key",
      action: "DISCARD",
      phase: "CLEARING_WORKTREE",
      status: "PENDING",
      version: 1,
      bundleId: source.bundleId,
      managedPrId: source.managedPrId,
      expectedBundleVersion: source.version,
      expectedGateRevision: 1,
      expectedObservationRevision: 1,
      confirmed: true,
      originalEventVersionIds: ["event-1"],
      retainedEventVersionIds: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
    persistence.actions.set(action.actionId, action);
    const coordinator = new F22Coordinator({
      persistence,
      bundles: {
        getReadModel: (bundleId) =>
          bundleId === source.bundleId ? source : undefined,
        startAutomaticReview: async () => ({ outcome: "REJECTED" as const }),
        recordDecision: () => source,
        confirmReviewDecisions: async () => source,
        saveDraftResponse: () => source,
      },
      remote: {
        readCurrentHead: async () => ({
          outcome: "UNAVAILABLE" as const,
          identity: {
            serverId: "github.example.invalid",
            repositoryKey: "github.example.invalid/owner/repo",
          },
          observationRevision: 1,
          observedAt: NOW,
        }),
      },
      f13: {
        inspectOperation: async () => {
          throw new Error("F13_MUST_NOT_RUN_DURING_STARTUP_RECONCILIATION");
        },
        clearChanges: async () => {
          throw new Error("F13_MUST_NOT_RUN_DURING_STARTUP_RECONCILIATION");
        },
      },
      f11: {
        getActiveClaim: () => undefined,
        getActiveHold: () => undefined,
        listRetainedVersionIds: () => [],
        completeDiscard: () => ({ outcome: "CONFLICT" as const }),
        transferForReevaluation: () => ({ outcome: "CONFLICT" as const }),
      },
      clock: () => NOW,
    });

    const reconciled = await coordinator.reconcileStartup();
    expect(reconciled[0]?.status).toBe("UNKNOWN");
    expect(persistence.getAction(action.actionId)?.phase).toBe("UNKNOWN");
    expect(coordinator.readGate(source.bundleId).status).toBe("ATTENTION");
  });

  it("adopts a committed F11 discard after a process interruption", async () => {
    const persistence = new MemoryF22Persistence();
    const source = reviewBundle();
    const registered = initialF22BundleState({
      bundle: source,
      identity: {
        serverId: "github.example.invalid",
        repositoryKey: "github.example.invalid/owner/repo",
      },
    });
    persistence.states.set(source.bundleId, {
      ...registered,
      status: "STALE",
      revision: 1,
      reason: {
        code: "REMOTE_HEAD_MOVED",
        what: "The pull-request head moved.",
        why: "The bundle no longer matches the exact remote head.",
        nextAction: "RE_EVALUATE",
        details: {},
      },
      updatedAt: NOW,
    });
    const action = f22ActionIntentSchema.parse({
      schemaVersion: 1,
      actionId: "f22-action-discard-restart",
      idempotencyKey: "f22-action-discard-restart-key",
      action: "DISCARD",
      phase: "CLEARING_WORKTREE",
      status: "UNKNOWN",
      version: 2,
      bundleId: source.bundleId,
      managedPrId: source.managedPrId,
      expectedBundleVersion: source.version,
      expectedGateRevision: 1,
      expectedObservationRevision: 1,
      confirmed: true,
      operationId: source.operationId,
      claimId: "claim-1",
      holdId: "hold-1",
      originalEventVersionIds: ["event-1"],
      retainedEventVersionIds: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
    persistence.actions.set(action.actionId, action);
    const claim = {
      ...activeClaim(),
      state: "HANDLED" as const,
      outcome: "DISCARDED" as const,
    };
    const hold = {
      ...activeHold(),
      state: "RELEASED" as const,
      outcome: "DISCARDED" as const,
    };
    const coordinator = new F22Coordinator({
      persistence,
      bundles: {
        getReadModel: (bundleId) =>
          bundleId === source.bundleId ? source : undefined,
        startAutomaticReview: async () => ({ outcome: "REJECTED" as const }),
        recordDecision: () => source,
        confirmReviewDecisions: async () => source,
        saveDraftResponse: () => source,
      },
      remote: {
        readCurrentHead: async () => currentRemote(),
      },
      f13: {
        inspectOperation: async () => {
          throw new Error("F13_MUST_NOT_RUN_DURING_STARTUP_RECONCILIATION");
        },
        clearChanges: async () => {
          throw new Error("F13_MUST_NOT_RUN_DURING_STARTUP_RECONCILIATION");
        },
      },
      f11: {
        getClaim: () => claim,
        getHold: () => hold,
        getActiveClaim: () => undefined,
        getActiveHold: () => undefined,
        listRetainedVersionIds: () => [],
        completeDiscard: () => ({ outcome: "CONFLICT" as const }),
        transferForReevaluation: () => ({ outcome: "CONFLICT" as const }),
      },
      clock: () => NOW,
    });

    const reconciled = await coordinator.reconcileStartup();
    expect(reconciled[0]?.status).toBe("COMPLETED");
    expect(persistence.getAction(action.actionId)?.result).toEqual({
      outcome: "RECONCILED_DISCARD",
    });
    expect(coordinator.readGate(source.bundleId).status).toBe("DISCARDED");
  });

  it("terminalizes a committed re-evaluation clear without starting a successor", async () => {
    const persistence = new MemoryF22Persistence();
    const source = reviewBundle();
    const registered = initialF22BundleState({
      bundle: source,
      identity: {
        serverId: "github.example.invalid",
        repositoryKey: "github.example.invalid/owner/repo",
      },
    });
    persistence.states.set(source.bundleId, {
      ...registered,
      status: "STALE",
      revision: 1,
      reason: {
        code: "REMOTE_HEAD_MOVED",
        what: "The pull-request head moved.",
        why: "The bundle no longer matches the exact remote head.",
        nextAction: "RE_EVALUATE",
        details: {},
      },
      updatedAt: NOW,
    });
    const action = f22ActionIntentSchema.parse({
      schemaVersion: 1,
      actionId: "f22-action-reevaluate-clear-restart",
      idempotencyKey: "f22-action-reevaluate-clear-restart-key",
      action: "REEVALUATE",
      phase: "POST_CLEAR_REVALIDATION",
      status: "UNKNOWN",
      version: 3,
      bundleId: source.bundleId,
      managedPrId: source.managedPrId,
      expectedBundleVersion: source.version,
      expectedGateRevision: 1,
      expectedObservationRevision: 1,
      confirmed: true,
      choice: "CLEAR_ALL",
      operationId: source.operationId,
      claimId: "claim-1",
      holdId: "hold-1",
      originalEventVersionIds: ["event-1"],
      retainedEventVersionIds: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
    persistence.actions.set(action.actionId, action);
    let successorCalls = 0;
    const coordinator = new F22Coordinator({
      persistence,
      bundles: {
        getReadModel: (bundleId) =>
          bundleId === source.bundleId ? source : undefined,
        startAutomaticReview: async () => {
          successorCalls += 1;
          return { outcome: "ACCEPTED" as const };
        },
        recordDecision: () => source,
        confirmReviewDecisions: async () => source,
        saveDraftResponse: () => source,
      },
      remote: {
        readCurrentHead: async () => currentRemote(),
      },
      f13: {
        inspectOperation: async () =>
          ({
            ok: true,
            worktree: {
              lifecycle: "CLEARED",
            } as F13InspectionResult["worktree"],
            condition: cleanCondition(),
          }) as F13InspectionResult,
        clearChanges: async () => {
          throw new Error("F13_MUST_NOT_RUN_DURING_STARTUP_RECONCILIATION");
        },
        readClearAction: () => ({
          actionId: action.actionId,
          operationId: source.operationId,
          worktreeId: "f13-worktree-1",
          choice: "CLEAR_ALL" as const,
          status: "COMPLETED",
          afterSnapshotId: "f13-after-snapshot",
        }),
      },
      f11: {
        getActiveClaim: () => activeClaim(),
        getActiveHold: () => activeHold(),
        listRetainedVersionIds: () => [],
        completeDiscard: () => ({ outcome: "CONFLICT" as const }),
        transferForReevaluation: () => ({ outcome: "CONFLICT" as const }),
      },
      clock: () => NOW,
    });

    const reconciled = await coordinator.reconcileStartup();
    expect(reconciled[0]?.status).toBe("FAILED");
    expect(reconciled[0]?.phase).toBe("FAILED");
    expect(reconciled[0]?.result).toMatchObject({
      clearReconciliation: "COMMITTED",
      outcome: "RECONCILED_REEVALUATION_CLEAR",
    });
    expect(successorCalls).toBe(0);
    expect(coordinator.readGate(source.bundleId).status).toBe("ATTENTION");
  });

  it("keeps a clean-looking interrupted clear unknown without durable F13 evidence", async () => {
    const persistence = new MemoryF22Persistence();
    const source = reviewBundle();
    const registered = initialF22BundleState({
      bundle: source,
      identity: {
        serverId: "github.example.invalid",
        repositoryKey: "github.example.invalid/owner/repo",
      },
    });
    persistence.states.set(source.bundleId, {
      ...registered,
      status: "STALE",
      revision: 1,
      reason: {
        code: "REMOTE_HEAD_MOVED",
        what: "The pull-request head moved.",
        why: "The bundle no longer matches the exact remote head.",
        nextAction: "RE_EVALUATE",
        details: {},
      },
      updatedAt: NOW,
    });
    const action = f22ActionIntentSchema.parse({
      schemaVersion: 1,
      actionId: "f22-action-reevaluate-clear-uncertain",
      idempotencyKey: "f22-action-reevaluate-clear-uncertain-key",
      action: "REEVALUATE",
      phase: "POST_CLEAR_REVALIDATION",
      status: "UNKNOWN",
      version: 3,
      bundleId: source.bundleId,
      managedPrId: source.managedPrId,
      expectedBundleVersion: source.version,
      expectedGateRevision: 1,
      expectedObservationRevision: 1,
      confirmed: true,
      choice: "CLEAR_ALL",
      operationId: source.operationId,
      claimId: "claim-1",
      holdId: "hold-1",
      originalEventVersionIds: ["event-1"],
      retainedEventVersionIds: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
    persistence.actions.set(action.actionId, action);
    const coordinator = new F22Coordinator({
      persistence,
      bundles: {
        getReadModel: (bundleId) =>
          bundleId === source.bundleId ? source : undefined,
        startAutomaticReview: async () => ({ outcome: "REJECTED" as const }),
        recordDecision: () => source,
        confirmReviewDecisions: async () => source,
        saveDraftResponse: () => source,
      },
      remote: {
        readCurrentHead: async () => currentRemote(),
      },
      f13: {
        inspectOperation: async () =>
          ({
            ok: true,
            worktree: {
              lifecycle: "CLEARED",
            } as F13InspectionResult["worktree"],
            condition: cleanCondition(),
          }) as F13InspectionResult,
        clearChanges: async () => {
          throw new Error("F13_MUST_NOT_RUN_DURING_STARTUP_RECONCILIATION");
        },
      },
      f11: {
        getActiveClaim: () => activeClaim(),
        getActiveHold: () => activeHold(),
        listRetainedVersionIds: () => [],
        completeDiscard: () => ({ outcome: "CONFLICT" as const }),
        transferForReevaluation: () => ({ outcome: "CONFLICT" as const }),
      },
      clock: () => NOW,
    });

    const reconciled = await coordinator.reconcileStartup();
    expect(reconciled[0]?.status).toBe("UNKNOWN");
    expect(reconciled[0]?.phase).toBe("POST_CLEAR_REVALIDATION");
    expect(reconciled[0]?.result).toMatchObject({
      clearReconciliation: "UNCERTAIN",
    });
    expect(coordinator.readGate(source.bundleId).status).toBe("ATTENTION");
  });

  it("keeps a historically cleared worktree unknown after a fresh dirty inspection", async () => {
    const persistence = new MemoryF22Persistence();
    const source = reviewBundle();
    const registered = initialF22BundleState({
      bundle: source,
      identity: {
        serverId: "github.example.invalid",
        repositoryKey: "github.example.invalid/owner/repo",
      },
    });
    persistence.states.set(source.bundleId, {
      ...registered,
      status: "STALE",
      revision: 1,
      reason: {
        code: "REMOTE_HEAD_MOVED",
        what: "The pull-request head moved.",
        why: "The bundle no longer matches the exact remote head.",
        nextAction: "RE_EVALUATE",
        details: {},
      },
      updatedAt: NOW,
    });
    const action = f22ActionIntentSchema.parse({
      schemaVersion: 1,
      actionId: "f22-action-reevaluate-clear-dirty-after",
      idempotencyKey: "f22-action-reevaluate-clear-dirty-after-key",
      action: "REEVALUATE",
      phase: "POST_CLEAR_REVALIDATION",
      status: "UNKNOWN",
      version: 3,
      bundleId: source.bundleId,
      managedPrId: source.managedPrId,
      expectedBundleVersion: source.version,
      expectedGateRevision: 1,
      expectedObservationRevision: 1,
      confirmed: true,
      choice: "CLEAR_ALL",
      operationId: source.operationId,
      claimId: "claim-1",
      holdId: "hold-1",
      originalEventVersionIds: ["event-1"],
      retainedEventVersionIds: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
    persistence.actions.set(action.actionId, action);
    const coordinator = new F22Coordinator({
      persistence,
      bundles: {
        getReadModel: (bundleId) =>
          bundleId === source.bundleId ? source : undefined,
        startAutomaticReview: async () => ({ outcome: "REJECTED" as const }),
        recordDecision: () => source,
        confirmReviewDecisions: async () => source,
        saveDraftResponse: () => source,
      },
      remote: {
        readCurrentHead: async () => currentRemote(),
      },
      f13: {
        inspectOperation: async () =>
          ({
            ok: true,
            worktree: {
              lifecycle: "CLEARED",
            } as F13InspectionResult["worktree"],
            condition: dirtyCondition(),
          }) as F13InspectionResult,
        clearChanges: async () => {
          throw new Error("F13_MUST_NOT_RUN_DURING_STARTUP_RECONCILIATION");
        },
        readClearAction: () => ({
          actionId: action.actionId,
          operationId: source.operationId,
          worktreeId: "f13-worktree-1",
          choice: "CLEAR_ALL" as const,
          status: "COMPLETED",
          afterSnapshotId: "f13-after-snapshot",
        }),
      },
      f11: {
        getActiveClaim: () => activeClaim(),
        getActiveHold: () => activeHold(),
        listRetainedVersionIds: () => [],
        completeDiscard: () => ({ outcome: "CONFLICT" as const }),
        transferForReevaluation: () => ({ outcome: "CONFLICT" as const }),
      },
      clock: () => NOW,
    });

    const reconciled = await coordinator.reconcileStartup();
    expect(reconciled[0]?.status).toBe("UNKNOWN");
    expect(reconciled[0]?.result).toMatchObject({
      clearReconciliation: "UNCERTAIN",
    });
    expect(coordinator.readGate(source.bundleId).status).toBe("ATTENTION");
  });

  it("compensates an orphaned transferred owner when the successor bundle is missing", async () => {
    const persistence = new MemoryF22Persistence();
    const source = reviewBundle();
    const registered = initialF22BundleState({
      bundle: source,
      identity: {
        serverId: "github.example.invalid",
        repositoryKey: "github.example.invalid/owner/repo",
      },
    });
    persistence.states.set(source.bundleId, {
      ...registered,
      status: "STALE",
      revision: 1,
      reason: {
        code: "REMOTE_HEAD_MOVED",
        what: "The pull-request head moved.",
        why: "The bundle no longer matches the exact remote head.",
        nextAction: "RE_EVALUATE",
        details: {},
      },
      updatedAt: NOW,
    });
    const action = f22ActionIntentSchema.parse({
      schemaVersion: 1,
      actionId: "f22-action-reevaluate-orphaned-transfer",
      idempotencyKey: "f22-action-reevaluate-orphaned-transfer-key",
      action: "REEVALUATE",
      phase: "F18_HANDOFF",
      status: "UNKNOWN",
      version: 7,
      bundleId: source.bundleId,
      managedPrId: source.managedPrId,
      expectedBundleVersion: source.version,
      expectedGateRevision: 1,
      expectedObservationRevision: 1,
      confirmed: true,
      operationId: source.operationId,
      claimId: "claim-1",
      holdId: "hold-1",
      newBundleId: "bundle-new",
      newOperationId: "operation-new",
      newClaimId: "claim-new",
      newHoldId: "hold-new",
      originalEventVersionIds: ["event-1"],
      retainedEventVersionIds: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
    persistence.actions.set(action.actionId, action);
    const oldClaim = {
      ...activeClaim(),
      state: "RELEASED" as const,
      version: 2,
    };
    const oldHold = {
      ...activeHold(),
      state: "RELEASED" as const,
      version: 2,
    };
    const newClaim = {
      ...activeClaim(),
      claimId: "claim-new",
      operationId: "operation-new",
      bundleId: "bundle-new",
    };
    const newHold = {
      ...activeHold(),
      holdId: "hold-new",
      claimId: "claim-new",
      operationId: "operation-new",
      bundleId: "bundle-new",
    };
    let rollbackCalls = 0;
    const coordinator = new F22Coordinator({
      persistence,
      bundles: {
        getReadModel: (bundleId) =>
          bundleId === source.bundleId ? source : undefined,
        startAutomaticReview: async () => ({ outcome: "REJECTED" as const }),
        recordDecision: () => source,
        confirmReviewDecisions: async () => source,
        saveDraftResponse: () => source,
      },
      remote: {
        readCurrentHead: async () => currentRemote(),
      },
      f13: {
        inspectOperation: async () => {
          throw new Error("F13_MUST_NOT_RUN_DURING_STARTUP_RECONCILIATION");
        },
        clearChanges: async () => {
          throw new Error("F13_MUST_NOT_RUN_DURING_STARTUP_RECONCILIATION");
        },
      },
      f11: {
        getClaim: (claimId) =>
          claimId === oldClaim.claimId
            ? oldClaim
            : claimId === newClaim.claimId
              ? newClaim
              : undefined,
        getHold: (holdId) =>
          holdId === oldHold.holdId
            ? oldHold
            : holdId === newHold.holdId
              ? newHold
              : undefined,
        getActiveClaim: () => newClaim,
        getActiveHold: () => newHold,
        listRetainedVersionIds: () => [],
        completeDiscard: () => ({ outcome: "CONFLICT" as const }),
        transferForReevaluation: () => ({ outcome: "CONFLICT" as const }),
        rollbackForReevaluation: () => {
          rollbackCalls += 1;
          return {
            outcome: "ROLLED_BACK" as const,
            reason: {
              code: "REEVALUATION_ROLLBACK",
              what: "The re-evaluation transfer was compensated.",
              why: "The successor bundle was not durable.",
              nextAction: "RECONCILE",
              details: {},
            },
          };
        },
      },
      clock: () => NOW,
    });

    const reconciled = await coordinator.reconcileStartup();
    expect(reconciled[0]?.status).toBe("FAILED");
    expect(reconciled[0]?.result).toMatchObject({
      outcome: "RECONCILED_REEVALUATION_ROLLBACK",
    });
    expect(rollbackCalls).toBe(1);
    expect(coordinator.readGate(source.bundleId).status).toBe("ATTENTION");
  });

  it("persists a clean discard preview before releasing the F11 hold", async () => {
    const persistence = new MemoryF22Persistence();
    const source = reviewBundle();
    let completeCalls = 0;
    let clearCalls = 0;
    const coordinator = new F22Coordinator({
      persistence,
      bundles: {
        getReadModel: (bundleId) =>
          bundleId === source.bundleId ? source : undefined,
        startAutomaticReview: async () => ({ outcome: "REJECTED" as const }),
        recordDecision: () => source,
        confirmReviewDecisions: async () => source,
        saveDraftResponse: () => source,
      } satisfies F18AutomaticReviewBoundary,
      remote: {
        readCurrentHead: async () => currentRemote(),
      },
      f13: {
        inspectOperation: async () => inspection(),
        clearChanges: async () => {
          clearCalls += 1;
          return {
            ok: true,
            choice: "KEEP_AND_CANCEL" as const,
            removed: [],
            preserved: [],
            remaining: [],
          };
        },
      },
      f11: {
        getActiveClaim: () => activeClaim(),
        getActiveHold: () => activeHold(),
        listRetainedVersionIds: () => [],
        completeDiscard: () => {
          completeCalls += 1;
          return { outcome: "RELEASED" as const };
        },
        transferForReevaluation: () => ({ outcome: "CONFLICT" as const }),
      },
      clock: () => NOW,
    });

    const preview = await coordinator.beginDiscard({
      bundleId: source.bundleId,
      idempotencyKey: "discard-once",
    });
    expect(preview.outcome).toBe("PREVIEW_READY");
    expect(persistence.listPendingActions()).toHaveLength(1);
    expect(preview.preview?.requiredChoice).toBe("NO_CHANGES");

    const invalidChoice = await coordinator.confirmDiscard({
      actionId: preview.actionId as string,
      bundleId: source.bundleId,
      choice: "CLEAR_ALL",
      confirmed: true,
      expectedActionVersion: preview.preview?.actionRevision,
      expectedGateRevision: preview.gate.gateRevision,
    });
    expect(invalidChoice.outcome).toBe("REJECTED");
    expect(invalidChoice.reason?.code).toBe("WORKTREE_CHOICE_NOT_REQUIRED");
    expect(completeCalls).toBe(0);
    expect(clearCalls).toBe(0);

    const result = await coordinator.confirmDiscard({
      actionId: preview.actionId as string,
      bundleId: source.bundleId,
      choice: "NO_CHANGES",
      confirmed: true,
      expectedActionVersion: preview.preview?.actionRevision,
      expectedGateRevision: preview.gate.gateRevision,
    });
    expect(result.outcome).toBe("COMPLETED");
    expect(completeCalls).toBe(1);
    expect(clearCalls).toBe(0);
    expect(persistence.listPendingActions()).toHaveLength(0);
    expect(coordinator.readGate(source.bundleId).status).toBe("DISCARDED");
  });

  it("routes an AI-attributed-only worktree through Clear Only AI Changes", async () => {
    const fixture = discardFixture({
      conditions: [aiOnlyCondition(), aiOnlyCondition(), cleanCondition()],
      clearChanges: async (input) => ({
        ok: true,
        choice: input.choice,
        removed: ["ai-change.txt"],
        preserved: [],
        remaining: [],
      }),
    });

    const preview = await fixture.coordinator.beginDiscard({
      bundleId: fixture.source.bundleId,
      idempotencyKey: "discard-ai-only",
    });
    expect(preview.preview?.requiredChoice).toBe("CLEAR_AI_ONLY");

    const result = await fixture.coordinator.confirmDiscard({
      actionId: preview.actionId as string,
      bundleId: fixture.source.bundleId,
      choice: "CLEAR_AI_ONLY",
      confirmed: true,
      expectedActionVersion: preview.preview?.actionRevision,
      expectedGateRevision: preview.gate.gateRevision,
    });

    expect(result.outcome).toBe("COMPLETED");
    expect(fixture.choices()).toEqual(["CLEAR_AI_ONLY"]);
    expect(fixture.clearCalls()).toBe(1);
    expect(fixture.completeCalls()).toBe(1);
    expect(
      fixture.persistence.getAction(preview.actionId as string)?.result,
    ).toMatchObject({
      choice: "CLEAR_AI_ONLY",
      removed: ["ai-change.txt"],
      outcome: "RELEASED",
    });
  });

  it("makes Keep Worktree and Cancel a durable no-effect dirty-worktree outcome", async () => {
    const fixture = discardFixture({ conditions: [dirtyCondition()] });

    const preview = await fixture.coordinator.beginDiscard({
      bundleId: fixture.source.bundleId,
      idempotencyKey: "discard-keep-cancel",
    });
    expect(preview.preview?.requiredChoice).toBe("CLEAR_ALL");

    const result = await fixture.coordinator.confirmDiscard({
      actionId: preview.actionId as string,
      bundleId: fixture.source.bundleId,
      choice: "KEEP_AND_CANCEL",
      confirmed: true,
      expectedActionVersion: preview.preview?.actionRevision,
      expectedGateRevision: preview.gate.gateRevision,
    });

    expect(result.outcome).toBe("CANCELLED");
    expect(fixture.inspectionCalls()).toBe(1);
    expect(fixture.clearCalls()).toBe(0);
    expect(fixture.completeCalls()).toBe(0);
    expect(
      fixture.persistence.getAction(preview.actionId as string)?.status,
    ).toBe("CANCELLED");
    expect(
      fixture.coordinator.readGate(fixture.source.bundleId).hold.active,
    ).toBe(true);
  });

  it("preserves the owner when F13 returns unsafe path evidence", async () => {
    const fixture = discardFixture({
      conditions: [dirtyCondition(), dirtyCondition(), cleanCondition()],
      clearChanges: async (input) => ({
        ok: true,
        choice: input.choice,
        removed: ["C:\\developer-clone\\.env"],
        preserved: [],
        remaining: [],
      }),
    });

    const preview = await fixture.coordinator.beginDiscard({
      bundleId: fixture.source.bundleId,
      idempotencyKey: "discard-unsafe-path",
    });
    const result = await fixture.coordinator.confirmDiscard({
      actionId: preview.actionId as string,
      bundleId: fixture.source.bundleId,
      choice: "CLEAR_ALL",
      confirmed: true,
      expectedActionVersion: preview.preview?.actionRevision,
      expectedGateRevision: preview.gate.gateRevision,
    });

    expect(result.outcome).toBe("ATTENTION");
    expect(result.reason?.code).toBe("UNSAFE_PATH_EVIDENCE");
    expect(fixture.inspectionCalls()).toBe(2);
    expect(fixture.clearCalls()).toBe(1);
    expect(fixture.completeCalls()).toBe(0);
    const action = fixture.persistence.getAction(preview.actionId as string);
    expect(action?.status).toBe("UNKNOWN");
    expect(JSON.stringify(action)).not.toContain("developer-clone");
  });

  it("keeps mixed or overlapping attribution blocked instead of clearing it", async () => {
    const fixture = discardFixture({
      conditions: [overlapCondition()],
      clearChanges: async (input) => ({
        ok: false,
        choice: input.choice,
        removed: [],
        preserved: [],
        remaining: ["shared.txt"],
        reason: {
          code: "AI_ATTRIBUTION_OVERLAP",
          what: "AI ownership overlaps developer changes.",
          why: "F13 cannot safely apply a destructive clear to the overlapping path.",
          nextAction: "KEEP_WORKTREE_AND_CANCEL",
        },
      }),
    });

    const preview = await fixture.coordinator.beginDiscard({
      bundleId: fixture.source.bundleId,
      idempotencyKey: "discard-overlap",
    });
    expect(preview.preview?.requiredChoice).toBe("CLEAR_ALL");
    const result = await fixture.coordinator.confirmDiscard({
      actionId: preview.actionId as string,
      bundleId: fixture.source.bundleId,
      choice: "CLEAR_ALL",
      confirmed: true,
      expectedActionVersion: preview.preview?.actionRevision,
      expectedGateRevision: preview.gate.gateRevision,
    });

    expect(result.outcome).toBe("ATTENTION");
    expect(result.reason?.code).toBe("AI_ATTRIBUTION_OVERLAP");
    expect(fixture.inspectionCalls()).toBe(2);
    expect(fixture.clearCalls()).toBe(1);
    expect(fixture.completeCalls()).toBe(0);
    expect(fixture.coordinator.readGate(fixture.source.bundleId).status).toBe(
      "ATTENTION",
    );
  });

  it("requires an explicit dirty-worktree choice and transfers reevaluation ownership once", async () => {
    const persistence = new MemoryF22Persistence();
    const source = reviewBundle();
    let currentHead = "c".repeat(40);
    let newBundle: F18ReviewBundleReadModel | undefined;
    let transferCalls = 0;
    let clearedWorktree = false;
    let handoff: F18AutomaticReviewHandoff | undefined;
    const coordinator = new F22Coordinator({
      persistence,
      bundles: {
        getReadModel: (bundleId) =>
          bundleId === source.bundleId
            ? source
            : bundleId === newBundle?.bundleId
              ? newBundle
              : undefined,
        listReadModels: () =>
          newBundle === undefined ? [source] : [source, newBundle],
        startAutomaticReview: async (input) => {
          handoff = input;
          const created = reviewBundle(input.bundleId, input.operationId);
          const successorCondition = cleanCondition();
          const successorWorktree = {
            operationId: input.operationId,
            worktreeId: `worktree-${input.operationId}`,
            ownerType: "REVIEW_BUNDLE",
            ownerId: input.bundleId,
            canonicalPath: `C:\\prmonitor\\f22-${input.operationId}`,
            rootRevision: 1,
            snapshotId: `f13-snapshot-${input.operationId}`,
            baselineSha: currentHead,
            stateFingerprint: "e".repeat(64),
            clean: true,
            complete: true,
            condition: {
              ...successorCondition,
              dirtySummary: {
                ...successorCondition.dirtySummary,
                changedPaths: [],
                trackedPaths: [],
                stagedPaths: [],
                untrackedPaths: [],
                ignoredPaths: [],
              },
              attribution: {
                evidenceRef: successorCondition.attribution.evidenceRef,
                ...(successorCondition.attribution.beforeSnapshotId ===
                undefined
                  ? {}
                  : {
                      beforeSnapshotId:
                        successorCondition.attribution.beforeSnapshotId,
                    }),
                ...(successorCondition.attribution.afterSnapshotId === undefined
                  ? {}
                  : {
                      afterSnapshotId:
                        successorCondition.attribution.afterSnapshotId,
                    }),
                ...(successorCondition.attribution.turnSnapshotIds === undefined
                  ? {}
                  : {
                      turnSnapshotIds:
                        successorCondition.attribution.turnSnapshotIds.map(
                          (pair) => ({ ...pair }),
                        ),
                    }),
                aiAttributedPaths: [],
                unAttributedPaths: [],
                overlapPaths: [],
                complete: successorCondition.attribution.complete,
              },
              permittedNextActions: [
                ...successorCondition.permittedNextActions,
              ],
            },
            changedFiles: [],
          } satisfies NonNullable<F18ReviewBundleReadModel["worktree"]>;
          newBundle = {
            ...created,
            input: {
              ...created.input,
              pullRequest: {
                ...created.input.pullRequest,
                headSha: currentHead,
              },
              taskSnapshot: { snapshotId: "f16-snapshot-1" } as never,
              worktree: successorWorktree,
            },
            worktree: successorWorktree,
          };
          return { outcome: "ACCEPTED" as const };
        },
        recordDecision: () => source,
        confirmReviewDecisions: async () => source,
        saveDraftResponse: () => source,
      },
      remote: {
        readCurrentHead: async () => currentRemote(currentHead, 2),
      },
      f13: {
        inspectOperation: async () =>
          inspection(clearedWorktree ? cleanCondition() : dirtyCondition()),
        clearChanges: async () => {
          clearedWorktree = true;
          return {
            ok: true,
            choice: "CLEAR_ALL" as const,
            removed: [],
            preserved: [],
            remaining: [],
          };
        },
      },
      f11: {
        getActiveClaim: () => activeClaim(),
        getActiveHold: () => activeHold(),
        listRetainedVersionIds: () => [],
        completeDiscard: () => ({ outcome: "CONFLICT" as const }),
        transferForReevaluation: () => {
          transferCalls += 1;
          return { outcome: "TRANSFERRED" as const };
        },
      },
      clock: () => NOW,
    });

    await coordinator.observeRemoteHead(source.bundleId);
    const preview = await coordinator.beginReevaluation({
      bundleId: source.bundleId,
      idempotencyKey: "reevaluate-once",
    });
    expect(preview.outcome).toBe("PREVIEW_READY");
    expect(preview.preview?.requiredChoice).toBe("CLEAR_ALL");
    const dirtyChoice = await coordinator.confirmReevaluation({
      actionId: preview.actionId as string,
      bundleId: source.bundleId,
      choice: "NO_CHANGES",
      expectedActionVersion: preview.preview?.actionRevision,
      expectedGateRevision: preview.gate.gateRevision,
    });
    expect(dirtyChoice.outcome).toBe("REJECTED");
    expect(transferCalls).toBe(0);
    const completed = await coordinator.confirmReevaluation({
      actionId: preview.actionId as string,
      bundleId: source.bundleId,
      choice: "CLEAR_ALL",
      confirmed: true,
      expectedActionVersion: preview.preview?.actionRevision,
      expectedGateRevision: preview.gate.gateRevision,
    });
    expect(completed.outcome).toBe("COMPLETED");
    expect(transferCalls).toBe(1);
    expect(completed.newBundleId).toBeDefined();
    expect(handoff?.currentBaseSha).toBe("a".repeat(40));
    expect(handoff?.currentHeadSha).toBe(currentHead);
    expect(coordinator.readGate(source.bundleId).status).toBe("SUPERSEDED");
    currentHead = "c".repeat(40);
  });

  it("fails closed when the final reevaluation refresh is stale", async () => {
    const persistence = new MemoryF22Persistence();
    const source = reviewBundle();
    const currentHead = "c".repeat(40);
    let remoteReads = 0;
    let transferCalls = 0;
    const coordinator = new F22Coordinator({
      persistence,
      bundles: {
        getReadModel: (bundleId) =>
          bundleId === source.bundleId ? source : undefined,
        startAutomaticReview: async () => ({ outcome: "REJECTED" as const }),
        recordDecision: () => source,
        confirmReviewDecisions: async () => source,
        saveDraftResponse: () => source,
      } satisfies F18AutomaticReviewBoundary,
      remote: {
        readCurrentHead: async () => {
          remoteReads += 1;
          return currentRemote(
            currentHead,
            1,
            remoteReads >= 3 ? "2026-09-26T11:00:00.000Z" : NOW,
          );
        },
      },
      f13: {
        inspectOperation: async () => inspection(cleanCondition()),
        clearChanges: async () => ({
          ok: true,
          choice: "KEEP_AND_CANCEL" as const,
          removed: [],
          preserved: [],
          remaining: [],
        }),
      },
      f11: {
        getActiveClaim: () => activeClaim(),
        getActiveHold: () => activeHold(),
        listRetainedVersionIds: () => [],
        completeDiscard: () => ({ outcome: "CONFLICT" as const }),
        transferForReevaluation: () => {
          transferCalls += 1;
          return { outcome: "TRANSFERRED" as const };
        },
      },
      clock: () => NOW,
    });

    const preview = await coordinator.beginReevaluation({
      bundleId: source.bundleId,
      idempotencyKey: "reevaluate-final-stale",
    });
    expect(preview.outcome).toBe("PREVIEW_READY");

    const result = await coordinator.confirmReevaluation({
      actionId: preview.actionId as string,
      bundleId: source.bundleId,
      choice: "NO_CHANGES",
      confirmed: true,
      expectedActionVersion: preview.preview?.actionRevision,
      expectedGateRevision: preview.gate.gateRevision,
    });

    expect(remoteReads).toBe(3);
    expect(result.outcome).toBe("ATTENTION");
    expect(result.reason?.code).toBe(
      "STALE_REEVALUATION_REMOTE_AFTER_WORKTREE_CHOICE",
    );
    expect(transferCalls).toBe(0);
    expect(persistence.getAction(preview.actionId as string)?.status).toBe(
      "FAILED",
    );
  });

  it("fails closed before the first authoritative remote observation", () => {
    const source = reviewBundle();
    const state = initialF22BundleState({
      bundle: source,
      identity: {
        serverId: "github.example.invalid",
        repositoryKey: "github.example.invalid/owner/repo",
      },
    });
    const gate = f22GateFor(source, state, {
      hold: {
        active: true,
        bundleId: source.bundleId,
        operationId: source.operationId,
      },
    });

    expect(gate.actions.discard).toBe(false);
    expect(gate.actions.reevaluate).toBe(false);
    expect(gate.actions.continueOldWork).toBe(false);
    expect(gate.reason?.code).toBe("REMOTE_HEAD_OBSERVATION_REQUIRED");
  });

  it("preserves newer remote evidence when a delayed lower revision arrives", async () => {
    const persistence = new MemoryF22Persistence();
    const source = reviewBundle();
    let observationRevision = 5;
    let headSha = "c".repeat(40);
    const coordinator = new F22Coordinator({
      persistence,
      bundles: {
        getReadModel: (bundleId) =>
          bundleId === source.bundleId ? source : undefined,
        startAutomaticReview: async () => ({ outcome: "REJECTED" as const }),
        recordDecision: () => source,
        confirmReviewDecisions: async () => source,
        saveDraftResponse: () => source,
      },
      remote: {
        readCurrentHead: async () =>
          currentRemote(headSha, observationRevision),
      },
      f13: {
        inspectOperation: async () => inspection(),
        clearChanges: async () => ({
          ok: true,
          choice: "KEEP_AND_CANCEL" as const,
          removed: [],
          preserved: [],
          remaining: [],
        }),
      },
      f11: {
        getActiveClaim: () => activeClaim(),
        getActiveHold: () => activeHold(),
        listRetainedVersionIds: () => [],
        completeDiscard: () => ({ outcome: "CONFLICT" as const }),
        transferForReevaluation: () => ({ outcome: "CONFLICT" as const }),
      },
      clock: () => NOW,
    });

    await coordinator.observeRemoteHead(source.bundleId);
    const afterFirstRead = persistence.getBundleState(source.bundleId);
    expect(afterFirstRead?.observedIdentity?.repositoryKey).toBe(
      "github.example.invalid/owner/repo",
    );
    expect(afterFirstRead?.observationRevision).toBe(5);
    expect(afterFirstRead?.observedHeadSha).toBe("c".repeat(40));

    observationRevision = 4;
    headSha = "d".repeat(40);
    const delayed = await coordinator.observeRemoteHead(source.bundleId);
    const afterDelayedRead = persistence.getBundleState(source.bundleId);
    expect(afterDelayedRead?.observationRevision).toBe(5);
    expect(afterDelayedRead?.observedHeadSha).toBe("c".repeat(40));
    expect(afterDelayedRead?.reason?.code).toBe("REMOTE_HEAD_CHECK_STALE");
    expect(delayed.actions.discard).toBe(false);
    expect(delayed.actions.reevaluate).toBe(false);

    observationRevision = 5;
    const conflicting = await coordinator.observeRemoteHead(source.bundleId);
    expect(conflicting.status).toBe("ATTENTION");
    expect(conflicting.reason?.code).toBe("REMOTE_HEAD_CHECK_CONFLICTING");
    expect(persistence.getBundleState(source.bundleId)?.observedHeadSha).toBe(
      "c".repeat(40),
    );
  });

  it("bounds persisted F22 results to known redacted fields", () => {
    expect(
      f22ActionResultSchema.safeParse({
        removed: Array.from({ length: 2_001 }, () => "path"),
      }).success,
    ).toBe(false);
    expect(
      f22ActionResultSchema.safeParse({
        secretPayload: { token: "must-not-persist" },
      }).success,
    ).toBe(false);
    expect(
      f22ActionResultSchema.safeParse({
        removed: ["C:\\developer-clone\\.env"],
      }).success,
    ).toBe(false);
    expect(
      f22ActionResultSchema.safeParse({
        preserved: ["../outside-worktree.txt"],
      }).success,
    ).toBe(false);
  });
});
