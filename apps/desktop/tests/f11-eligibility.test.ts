import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateF11Eligibility,
  type F11EligibilityConfiguration,
  type F11EligibilityInput,
} from "../src/shared/domain/eligibility";
import {
  createPersistenceRepositories,
  initializePersistence,
  type PersistenceStore,
} from "../src/main/persistence";
import {
  F11PersistenceRepositories,
  f11ReevaluationAuthorizationToken,
} from "../src/main/persistence/f11-repositories";
import { F11EligibilityService } from "../src/main/f11-eligibility-service";

const TIME = "2026-09-21T12:00:00.000Z";
const CONFIG: F11EligibilityConfiguration = {
  automationIdentity: { serverId: "server-1", login: "prmonitor-bot" },
  ignoredAccounts: ["dependabot"],
  revision: 1,
};

const roots: string[] = [];
const stores: PersistenceStore[] = [];

async function fixture(): Promise<{ store: PersistenceStore; root: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "prmonitor-f11-"));
  roots.push(root);
  const store = await initializePersistence(
    {
      databasePath: path.join(root, "database", "prmonitor.sqlite"),
      backupRoot: path.join(root, "backups"),
    },
    { clock: { now: () => TIME }, applicationBuild: "f11-test" },
  );
  stores.push(store);
  const repositories = createPersistenceRepositories(store, {
    clock: { now: () => TIME },
  });
  repositories.putGithubServer({
    serverId: "server-1",
    host: "github.example.invalid",
    apiBaseUrl: "https://github.example.invalid/api/v3",
  });
  repositories.putRepository({
    repositoryId: "repo-base",
    serverId: "server-1",
    owner: "owner",
    name: "repo",
    defaultBranch: "main",
  });
  repositories.putRepository({
    repositoryId: "repo-head",
    serverId: "server-1",
    owner: "head-owner",
    name: "repo",
    defaultBranch: "main",
  });
  repositories.putManagedPr({
    managedPrId: "managed-pr-1",
    serverId: "server-1",
    baseRepositoryId: "repo-base",
    headRepositoryId: "repo-head",
    number: 1,
    baseBranch: "main",
    headBranch: "feature",
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    state: "WATCHING",
  });
  return { store, root };
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

function pureInput(
  overrides: Partial<F11EligibilityInput> = {},
): F11EligibilityInput {
  return {
    managedPrId: "managed-pr-1",
    serverId: "server-1",
    repositoryId: "repo-base",
    pullRequestNumber: 1,
    sourceKind: "REVIEW_COMMENT",
    sourceId: "comment-1",
    remoteObjectKey: "server:owner/repo#1:comment:1",
    eventVersionId: "event-1",
    semanticHash: "a".repeat(64),
    authorLogin: "reviewer",
    authorProviderId: 7,
    body: "Please fix this line.",
    currentPrState: "OPEN",
    primaryState: "WATCHING",
    configuration: CONFIG,
    ...overrides,
  };
}

function feedbackPayload(input: {
  readonly id: string;
  readonly body: string;
  readonly author?: string;
  readonly state?: string;
}): unknown {
  return {
    schemaVersion: 1,
    identity: { key: `server:owner/repo#1:comment:${input.id}` },
    source: "REVIEW_COMMENT",
    pullRequest: { number: 1 },
    repository: { key: "repo-base" },
    author: { id: 7, login: input.author ?? "reviewer" },
    body: input.body,
    ...(input.state === undefined ? {} : { state: input.state }),
  };
}

function addEvent(
  store: PersistenceStore,
  eventVersionId: string,
  sourceId: string,
  payload: unknown,
): void {
  createPersistenceRepositories(store, {
    clock: { now: () => TIME },
  }).insertRemoteEventVersion({
    id: eventVersionId,
    managedPrId: "managed-pr-1",
    sourceKind: "REVIEW_COMMENT",
    sourceId,
    sourceRepositoryId: "repo-base",
    observedAt: TIME,
    semanticHash: "a".repeat(63) + eventVersionId.slice(-1),
    payload,
  });
}

describe("F11 deterministic eligibility", () => {
  it("uses a stable exclusion order without keyword or AI classification", () => {
    expect(
      evaluateF11Eligibility({
        input: pureInput({ body: "" }),
        correlationId: "f11-test",
        now: TIME,
      }).reason.code,
    ).toBe("EMPTY_EVENT");
    expect(
      evaluateF11Eligibility({
        input: pureInput({
          sourceKind: "REVIEW",
          reviewState: "APPROVED",
          body: undefined,
        }),
        correlationId: "f11-test",
        now: TIME,
      }).reason.code,
    ).toBe("BODYLESS_APPROVAL");
    expect(
      evaluateF11Eligibility({
        input: pureInput({ authorLogin: "Dependabot" }),
        correlationId: "f11-test",
        now: TIME,
      }).reason.code,
    ).toBe("IGNORED_ACCOUNT");
    expect(
      evaluateF11Eligibility({
        input: pureInput({ currentPrState: "MERGED" }),
        correlationId: "f11-test",
        now: TIME,
      }).reason.code,
    ).toBe("PR_MERGED");
    expect(
      evaluateF11Eligibility({
        input: pureInput({ currentPrState: "CLOSED" }),
        correlationId: "f11-test",
        now: TIME,
      }).reason.code,
    ).toBe("PR_CLOSED");
    expect(
      evaluateF11Eligibility({
        input: pureInput({
          primaryState: "READY_FOR_REVIEW",
          holdActive: true,
        }),
        correlationId: "f11-test",
        now: TIME,
      }).decision,
    ).toBe("DEFERRED_BY_HOLD");
    expect(
      evaluateF11Eligibility({
        input: pureInput({ body: "This says token= but is not a secret" }),
        correlationId: "f11-test",
        now: TIME,
      }).reason.code,
    ).toBe("INVALID_SCOPE");
    expect(
      evaluateF11Eligibility({
        input: pureInput({ body: "please fix" }),
        correlationId: "f11-test",
        now: TIME,
      }).decision,
    ).toBe("ELIGIBLE");
  });

  it("persists one scoped decision, claims once, retains during hold, and releases only on a human outcome", async () => {
    const { store } = await fixture();
    addEvent(
      store,
      "event-1",
      "comment-1",
      feedbackPayload({ id: "1", body: "Fix this." }),
    );
    const persistence = new F11PersistenceRepositories(store, {
      clock: { now: () => TIME },
    });
    const service = new F11EligibilityService(persistence, {
      clock: { now: () => TIME },
    });

    const first = service.evaluateObservedVersion({
      managedPrId: "managed-pr-1",
      eventVersionId: "event-1",
      serverId: "server-1",
      currentPrState: "OPEN",
      primaryState: "WATCHING",
      configuration: CONFIG,
    });
    const replay = service.evaluateObservedVersion({
      managedPrId: "managed-pr-1",
      eventVersionId: "event-1",
      serverId: "server-1",
      currentPrState: "OPEN",
      primaryState: "WATCHING",
      configuration: CONFIG,
    });
    expect(first.evaluation.decision).toBe("ELIGIBLE");
    expect(replay.evaluation.reason.code).toBe("ELIGIBLE");
    expect(persistence.listDecisions("managed-pr-1")).toHaveLength(1);
    expect(persistence.listAssociations("managed-pr-1")).toHaveLength(1);

    const cancelled = new AbortController();
    cancelled.abort();
    const cancelledClaim = service.claimAutomatic({
      managedPrId: "managed-pr-1",
      operationId: "operation-cancelled",
      bundleId: "bundle-cancelled",
      configuration: CONFIG,
      currentPrState: "OPEN",
      primaryState: "WATCHING",
      signal: cancelled.signal,
    });
    expect(cancelledClaim.result.outcome).toBe("CONFLICT");
    expect(persistence.getActiveClaim("managed-pr-1")).toBeUndefined();

    const faultedService = new F11EligibilityService(
      new F11PersistenceRepositories(store, {
        clock: { now: () => TIME },
        transactionOptions: { faultInjection: { failBeforeCommit: true } },
      }),
      { clock: { now: () => TIME } },
    );
    expect(() =>
      faultedService.claimAutomatic({
        managedPrId: "managed-pr-1",
        operationId: "operation-faulted",
        bundleId: "bundle-faulted",
        configuration: CONFIG,
        currentPrState: "OPEN",
        primaryState: "WATCHING",
      }),
    ).toThrow();
    expect(persistence.getActiveClaim("managed-pr-1")).toBeUndefined();
    expect(persistence.getAssociation("managed-pr-1", "event-1")?.state).toBe(
      "UNASSIGNED",
    );

    const claim = service.claimAutomatic({
      managedPrId: "managed-pr-1",
      operationId: "operation-1",
      bundleId: "bundle-1",
      configuration: CONFIG,
      currentPrState: "OPEN",
      primaryState: "WATCHING",
      correlationId: "claim-1",
    });
    expect(claim.result.outcome).toBe("CLAIMED");
    const claimReplay = service.claimAutomatic({
      managedPrId: "managed-pr-1",
      operationId: "operation-1",
      bundleId: "bundle-1",
      configuration: CONFIG,
      currentPrState: "OPEN",
      primaryState: "WATCHING",
      correlationId: "claim-1",
    });
    expect(claimReplay.result.outcome).toBe("REPLAYED");
    const competing = service.claimAutomatic({
      managedPrId: "managed-pr-1",
      operationId: "operation-2",
      bundleId: "bundle-2",
      configuration: CONFIG,
      currentPrState: "OPEN",
      primaryState: "WATCHING",
    });
    expect(competing.result.outcome).toBe("CONFLICT");

    addEvent(
      store,
      "event-2",
      "comment-2",
      feedbackPayload({ id: "2", body: "New feedback during hold." }),
    );
    const retained = service.evaluateObservedVersion({
      managedPrId: "managed-pr-1",
      eventVersionId: "event-2",
      serverId: "server-1",
      currentPrState: "OPEN",
      primaryState: "WORKING",
      configuration: CONFIG,
    });
    expect(retained.evaluation.decision).toBe("DEFERRED_BY_HOLD");
    expect(service.listRetainedVersionIds("managed-pr-1")).toEqual(["event-2"]);

    const completed = service.completeAutomaticReview({
      managedPrId: "managed-pr-1",
      claimId: claim.claim?.claimId ?? "missing",
      operationId: "operation-1",
      bundleId: "bundle-1",
      outcome: "PUBLISHED",
      worktreeHandled: true,
    });
    expect(completed.outcome).toBe("RELEASED");
    expect(persistence.getActiveHold("managed-pr-1")).toBeUndefined();
    expect(persistence.getAssociation("managed-pr-1", "event-1")?.state).toBe(
      "HANDLED_BY_BUNDLE",
    );
    expect(service.listRetainedVersionIds("managed-pr-1")).toEqual(["event-2"]);
    expect(service.listEligibleVersionIds("managed-pr-1")).toHaveLength(0);

    const reevaluated = service.reevaluateRetained({
      managedPrId: "managed-pr-1",
      operationId: "operation-2",
      bundleId: "bundle-2",
      configuration: CONFIG,
      currentPrState: "OPEN",
      primaryState: "WATCHING",
      eventVersionIds: ["event-2"],
      humanAuthorized: true,
    });
    expect(reevaluated.result.outcome).toBe("CLAIMED");
    expect(persistence.getAssociation("managed-pr-1", "event-2")?.state).toBe(
      "ASSIGNED_TO_ACTIVE_BUNDLE",
    );
  });

  it("restores the old hold and retained association states when F18 rejects a transfer", async () => {
    const { store } = await fixture();
    addEvent(
      store,
      "event-1",
      "comment-1",
      feedbackPayload({ id: "1", body: "Fix this." }),
    );
    addEvent(
      store,
      "event-2",
      "comment-2",
      feedbackPayload({ id: "2", body: "Also fix this." }),
    );
    const persistence = new F11PersistenceRepositories(store, {
      clock: { now: () => TIME },
    });
    const service = new F11EligibilityService(persistence, {
      clock: { now: () => TIME },
    });
    service.evaluateObservedVersion({
      managedPrId: "managed-pr-1",
      eventVersionId: "event-1",
      serverId: "server-1",
      currentPrState: "OPEN",
      primaryState: "WATCHING",
      configuration: CONFIG,
    });
    const claim = service.claimAutomatic({
      managedPrId: "managed-pr-1",
      operationId: "operation-1",
      bundleId: "bundle-1",
      configuration: CONFIG,
      currentPrState: "OPEN",
      primaryState: "WATCHING",
    });
    service.evaluateObservedVersion({
      managedPrId: "managed-pr-1",
      eventVersionId: "event-2",
      serverId: "server-1",
      currentPrState: "OPEN",
      primaryState: "WORKING",
      configuration: CONFIG,
    });
    const oldHold = persistence.getActiveHold("managed-pr-1");
    const transferred = service.transferForReevaluation({
      managedPrId: "managed-pr-1",
      oldClaimId: claim.claim?.claimId ?? "missing",
      oldHoldId: oldHold?.holdId ?? "missing",
      oldOperationId: "operation-1",
      oldBundleId: "bundle-1",
      newClaimId: "claim-2",
      newHoldId: "hold-2",
      newOperationId: "operation-2",
      newBundleId: "bundle-2",
      eventVersionIds: ["event-1", "event-2"],
      configurationSnapshot:
        claim.claim?.configurationSnapshot ?? ({} as never),
      correlationId: "reevaluation-transfer",
      authorizationId: "f22-action-authorization",
      authorizationToken: f11ReevaluationAuthorizationToken({
        managedPrId: "managed-pr-1",
        oldClaimId: claim.claim?.claimId ?? "missing",
        oldHoldId: oldHold?.holdId ?? "missing",
        oldOperationId: "operation-1",
        oldBundleId: "bundle-1",
        newClaimId: "claim-2",
        newHoldId: "hold-2",
        newOperationId: "operation-2",
        newBundleId: "bundle-2",
        eventVersionIds: ["event-1", "event-2"],
        authorizationId: "f22-action-authorization",
        expectedOldClaimVersion: claim.claim?.version ?? 0,
        expectedOldHoldVersion: oldHold?.version ?? 0,
      }),
      expectedOldClaimVersion: claim.claim?.version ?? 0,
      expectedOldHoldVersion: oldHold?.version ?? 0,
    });
    expect(transferred.outcome).toBe("TRANSFERRED");

    const rolledBack = service.rollbackForReevaluation({
      managedPrId: "managed-pr-1",
      oldClaimId: claim.claim?.claimId ?? "missing",
      oldHoldId: oldHold?.holdId ?? "missing",
      oldOperationId: "operation-1",
      oldBundleId: "bundle-1",
      newClaimId: "claim-2",
      newHoldId: "hold-2",
      newOperationId: "operation-2",
      newBundleId: "bundle-2",
      originalEventVersionIds: ["event-1"],
      retainedEventVersionIds: ["event-2"],
    });
    expect(rolledBack.outcome).toBe("ROLLED_BACK");
    expect(persistence.getActiveClaim("managed-pr-1")?.bundleId).toBe(
      "bundle-1",
    );
    expect(persistence.getActiveHold("managed-pr-1")?.bundleId).toBe(
      "bundle-1",
    );
    expect(persistence.getAssociation("managed-pr-1", "event-1")?.state).toBe(
      "ASSIGNED_TO_ACTIVE_BUNDLE",
    );
    expect(persistence.getAssociation("managed-pr-1", "event-2")?.state).toBe(
      "RETAINED_DURING_HOLD",
    );
  });
});
