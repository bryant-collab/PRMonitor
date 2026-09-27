import { describe, expect, it } from "vitest";
import {
  f22GateFor,
  initialF22BundleState,
} from "../src/shared/f22-discard-reevaluation";
import { f23PublicationPreflightFromF22 } from "../src/shared/f23-preflight";
import type { F18ReviewBundleReadModel } from "../src/shared/f18-automatic-review";

const NOW = "2026-09-26T12:00:00.000Z";

function bundle(): F18ReviewBundleReadModel {
  return {
    schemaVersion: 1,
    kind: "REVIEW_BUNDLE_READ_MODEL",
    bundleId: "bundle-f23",
    managedPrId: "managed-pr-f23",
    batchId: "batch-f23",
    operationId: "operation-f23",
    state: "READY_FOR_REVIEW",
    stage: "FINAL_REVIEW",
    phase: "FINAL_RECORDED",
    version: 3,
    input: {
      schemaVersion: 1,
      bundleId: "bundle-f23",
      managedPrId: "managed-pr-f23",
      batchId: "batch-f23",
      operationId: "operation-f23",
      claimId: "claim-f23",
      correlationId: "correlation-f23",
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
        baseSha: "a".repeat(40),
        headSha: "b".repeat(40),
      },
      feedback: [],
      remoteEventVersionIds: ["event-f23"],
    },
    items: [],
    draftResponses: [],
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
  } as F18ReviewBundleReadModel;
}

describe("F23 publication boundary consumes F22 evidence", () => {
  it("allows only a fresh exact F22 preflight and never grants publication authority", () => {
    const source = bundle();
    const registered = initialF22BundleState({
      bundle: source,
      identity: {
        serverId: "github.example.invalid",
        repositoryKey: "github.example.invalid/owner/repo",
      },
    });
    const gateWithoutToken = f22GateFor(source, {
      ...registered,
      revision: 1,
      observedIdentity: registered.identity,
      observedBaseSha: source.input.pullRequest.baseSha,
      observedHeadSha: source.input.pullRequest.headSha,
      observedBaseRepository: source.input.pullRequest.baseRepository,
      observedHeadRepository: source.input.pullRequest.headRepository,
      observedBaseBranch: source.input.pullRequest.baseBranch,
      observedHeadBranch: source.input.pullRequest.headBranch,
      observationRevision: 7,
      observedAt: NOW,
    });
    const gate = {
      ...gateWithoutToken,
      remote: {
        ...gateWithoutToken.remote,
        observationToken: "f22-observation-test",
      },
    };

    const preflight = f23PublicationPreflightFromF22(gate, {
      freshRemoteObservation: {
        token: "f22-observation-test",
        observationRevision: 7,
        observedAt: NOW,
      },
      now: NOW,
    });
    expect(preflight.f22SafeForPublication).toBe(true);
    expect(preflight.publicationAuthorized).toBe(false);
    expect(preflight.exactRemoteIdentity).toBe(true);
    expect(preflight.exactRemoteRefs).toBe(true);
  });

  it("blocks stale or incomplete F22 evidence before F23 approval", () => {
    const source = bundle();
    const registered = initialF22BundleState({
      bundle: source,
      identity: {
        serverId: "github.example.invalid",
        repositoryKey: "github.example.invalid/owner/repo",
      },
    });
    const gate = f22GateFor(source, {
      ...registered,
      status: "STALE",
      revision: 2,
      reason: {
        code: "REMOTE_HEAD_MOVED",
        what: "The pull-request head moved.",
        why: "The old diff no longer matches the remote head.",
        nextAction: "RE_EVALUATE",
        details: {},
      },
      observedIdentity: registered.identity,
      observedHeadSha: "c".repeat(40),
      observationRevision: 8,
      observedAt: NOW,
    });

    const preflight = f23PublicationPreflightFromF22(gate, {
      now: NOW,
    });
    expect(preflight.f22SafeForPublication).toBe(false);
    expect(preflight.reasonCode).toBe("REMOTE_HEAD_MOVED");
    expect(preflight.publicationAuthorized).toBe(false);
  });

  it("fails closed when a caller presents cached current evidence without a fresh read", () => {
    const source = bundle();
    const registered = initialF22BundleState({
      bundle: source,
      identity: {
        serverId: "github.example.invalid",
        repositoryKey: "github.example.invalid/owner/repo",
      },
    });
    const gate = f22GateFor(source, {
      ...registered,
      observedIdentity: registered.identity,
      observedBaseSha: source.input.pullRequest.baseSha,
      observedHeadSha: source.input.pullRequest.headSha,
      observedBaseRepository: source.input.pullRequest.baseRepository,
      observedHeadRepository: source.input.pullRequest.headRepository,
      observedBaseBranch: source.input.pullRequest.baseBranch,
      observedHeadBranch: source.input.pullRequest.headBranch,
      observationRevision: 7,
      observedAt: NOW,
    });

    const preflight = f23PublicationPreflightFromF22(gate, {
      now: NOW,
    });
    expect(preflight.f22SafeForPublication).toBe(false);
    expect(preflight.reasonCode).toBe("F22_PUBLICATION_RECHECK_REQUIRED");
    expect(preflight.publicationAuthorized).toBe(false);
  });
});
