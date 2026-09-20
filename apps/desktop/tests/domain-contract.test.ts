import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DOMAIN_SCHEMA_VERSION,
  PRIMARY_PR_STATES,
  PUBLICATION_PHASES,
  REVIEW_BUNDLE_STATES,
  SYNCHRONIZATION_STATUSES,
  associateEventVersion,
  canPublishReviewBundle,
  canPublishSynchronizationResult,
  canStartCodePublication,
  createActionRecord,
  createEventVersionAssociation,
  createPrimaryPrSnapshot,
  createPublicationRecord,
  createReviewBundle,
  createSynchronizationResult,
  createWatchingOverlay,
  fixedClock,
  isPublicationUncertain,
  parseActionId,
  parseAIWorkOperationId,
  parseApprovalId,
  parseBranchName,
  parseCommitSha,
  parseDomainError,
  parseDomainReason,
  parseIdempotencyKey,
  parseManagedPrId,
  parsePublicationId,
  parseRemoteEventVersionId,
  parseRepositoryId,
  parseReviewBatchId,
  parseReviewBundleId,
  parseReviewBundleItemId,
  parseSchemaVersion,
  parseSemanticHash,
  parseSynchronizationOperationId,
  parseTransitionEventId,
  parseUtcInstant,
  parseWorktreeId,
  parsePrimaryPrSnapshot,
  parseEventVersionAssociation,
  parsePublicationRecord,
  parseActionRecord,
  parseHumanApproval,
  parseReviewHold,
  parseReviewBundle,
  parseSynchronizationResult,
  parseTransitionEvent,
  parseWatchingOverlay,
  reducePrimaryPr,
  reducePublication,
  reduceReviewBundle,
  reduceSynchronization,
  replayPublication,
  resolveConcurrentAutomaticDispatches,
  setWatchingPaused,
  unsafeReason,
  updatePublicationResponse,
  type ActionRecord,
  type DomainResult,
  type ReviewBundle,
  type SynchronizationResult,
} from "../src/shared/domain/index.js";

const must = <T>(result: DomainResult<T>): T => {
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.messageKey}`);
  return result.value;
};

const instant = must(parseUtcInstant("2026-09-20T12:00:00.000Z"));
const laterInstant = must(parseUtcInstant("2026-09-20T12:01:00.000Z"));
const clock = fixedClock(instant);
const laterClock = fixedClock(laterInstant);
const prId = must(parseManagedPrId("pr-1"));
const repositoryId = must(parseRepositoryId("repo-1"));
const operationId = must(parseAIWorkOperationId("ai-op-1"));
const bundleId = must(parseReviewBundleId("bundle-1"));
const nextBundleId = must(parseReviewBundleId("bundle-2"));
const eventVersionId = must(parseRemoteEventVersionId("event-1"));
const nextEventVersionId = must(parseRemoteEventVersionId("event-2"));
const syncId = must(parseSynchronizationOperationId("sync-1"));
const secondSyncId = must(parseSynchronizationOperationId("sync-2"));
const publicationId = must(parsePublicationId("publication-1"));
const idempotencyKey = must(parseIdempotencyKey("publication-key-1"));
const baseSha = must(
  parseCommitSha("1111111111111111111111111111111111111111"),
);
const headSha = must(
  parseCommitSha("2222222222222222222222222222222222222222"),
);
const sourceSha = must(
  parseCommitSha("3333333333333333333333333333333333333333"),
);
const semanticHash = must(parseSemanticHash("semantic-hash-1"));

let actionSequence = 0;
function action(
  actor: ActionRecord["actor"] = "SYSTEM",
  expectedVersion?: number,
): ActionRecord {
  actionSequence += 1;
  const suffix = String(actionSequence).padStart(3, "0");
  return createActionRecord({
    actionId: must(parseActionId(`action-${suffix}`)),
    transitionId: must(parseTransitionEventId(`transition-${suffix}`)),
    actor,
    issuedAt: instant,
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
  });
}

describe("F02 provider-neutral primitives and safe results", () => {
  it("keeps the shared domain free of privileged or provider imports", async () => {
    const domainRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../src/shared/domain",
    );
    const entries = await readdir(domainRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      const contents = await readFile(
        path.join(domainRoot, entry.name),
        "utf8",
      );
      expect(contents, entry.name).not.toMatch(
        /from ["'](?:node:|electron|react|sqlite|github|git|@openai|child_process|fs|path|net|http|https)[^"']*["']/iu,
      );
      expect(contents, entry.name).not.toMatch(
        /(?:Date\.now|Math\.random|process\.env)/u,
      );
    }
  });

  it("validates every required opaque identifier family and canonical UTC time", () => {
    expect(must(parseReviewBatchId("batch-1"))).toBe("batch-1");
    expect(must(parseReviewBundleItemId("item-1"))).toBe("item-1");
    expect(must(parseWorktreeId("worktree-1"))).toBe("worktree-1");
    expect(must(parseIdempotencyKey("key-1"))).toBe("key-1");
    expect(must(parseUtcInstant(instant))).toBe(instant);
    expect(parseUtcInstant("2026-09-20T12:00:00-06:00").ok).toBe(false);
    expect(parseManagedPrId("Bearer-secret").ok).toBe(true);
    expect(parseManagedPrId("bad id").ok).toBe(false);
    expect(parseSchemaVersion(DOMAIN_SCHEMA_VERSION).ok).toBe(true);
    expect(parseSchemaVersion(99).ok).toBe(false);
  });

  it("rejects unsafe reason values and unknown contract fields", () => {
    const unsafe = parseDomainReason({
      schemaVersion: DOMAIN_SCHEMA_VERSION,
      kind: "action-reason",
      code: "UNSAFE",
      messageKey: "test",
      what: "what",
      why: "why",
      nextAction: "NONE",
      details: { apiKey: "never persist" },
    });
    expect(unsafe.ok).toBe(false);
    expect(
      parseDomainReason({
        schemaVersion: DOMAIN_SCHEMA_VERSION,
        kind: "action-reason",
        code: "UNKNOWN",
        messageKey: "test",
        what: "what",
        why: "why",
        nextAction: "UNKNOWN",
        details: {},
      }).ok,
    ).toBe(false);
  });

  it("replays fixed-clock decisions identically and keeps errors structured", () => {
    const first = createPrimaryPrSnapshot({ prId, clock });
    const second = createPrimaryPrSnapshot({ prId, clock });
    expect(first).toEqual(second);
    const noEvent = reducePrimaryPr(
      first,
      {
        type: "DISPATCH_AUTOMATIC_REVIEW",
        action: action("SYSTEM", 0),
        operationId,
        bundleId,
        eligible: false,
        globalPaused: false,
      },
      clock,
    );
    expect(noEvent.ok).toBe(true);
    if (noEvent.ok) expect(noEvent.value.outcome).toBe("NOOP");
    const parsedError = parseDomainError({
      ...(!noEvent.ok
        ? noEvent.error
        : {
            schemaVersion: DOMAIN_SCHEMA_VERSION,
            kind: "domain-error",
            code: "INVALID_TRANSITION",
            category: "INVALID_TRANSITION",
            retryable: false,
            userAction: "REVIEW",
            messageKey: "test",
            reason: unsafeReason("INVALID_TRANSITION", "what", "why", "REVIEW"),
            details: {},
          }),
    });
    expect(parsedError.ok).toBe(true);
  });
});

describe("F02 primary PR state, holds, pause, and admission", () => {
  it("accepts review admission, acquires a hold, and rejects background work", () => {
    const initial = createPrimaryPrSnapshot({ prId, clock });
    const started = must(
      reducePrimaryPr(
        initial,
        {
          type: "DISPATCH_AUTOMATIC_REVIEW",
          action: action("SYSTEM", 0),
          operationId,
          bundleId,
          eligible: true,
          globalPaused: false,
        },
        clock,
      ),
    ).state;
    expect(started.state).toBe("WORKING");
    const ready = must(
      reducePrimaryPr(
        started,
        {
          type: "REVIEW_COMPLETED",
          action: action("SYSTEM", 1),
          operationId,
          bundleId,
        },
        laterClock,
      ),
    ).state;
    expect(ready.state).toBe("READY_FOR_REVIEW");
    expect(ready.hold?.bundleId).toBe(bundleId);
    const rejected = reducePrimaryPr(
      ready,
      {
        type: "DISPATCH_AUTOMATIC_REVIEW",
        action: action("SYSTEM", 2),
        operationId,
        bundleId,
        eligible: true,
        globalPaused: false,
      },
      clock,
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe("REVIEW_HOLD_ACTIVE");
    expect(ready.state).toBe("READY_FOR_REVIEW");
  });

  it("deterministically admits one concurrent dispatch and never releases on lifecycle events", () => {
    const initial = createPrimaryPrSnapshot({ prId, clock });
    const requests = [
      {
        type: "DISPATCH_AUTOMATIC_REVIEW" as const,
        action: action("SYSTEM", 0),
        operationId,
        bundleId,
        eligible: true,
        globalPaused: false,
      },
      {
        type: "DISPATCH_AUTOMATIC_REVIEW" as const,
        action: action("SYSTEM", 0),
        operationId: must(parseAIWorkOperationId("ai-op-2")),
        bundleId: nextBundleId,
        eligible: true,
        globalPaused: false,
      },
    ];
    const results = resolveConcurrentAutomaticDispatches(
      initial,
      requests,
      clock,
    );
    expect(
      results.filter((result) => result.ok && result.value.changed),
    ).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    const working = results.find((result) => result.ok && result.value.changed);
    if (!working || !working.ok) throw new Error("expected admitted dispatch");
    const afterClose = must(
      reducePrimaryPr(
        must(
          reducePrimaryPr(
            working.value.state,
            {
              type: "REVIEW_COMPLETED",
              action: action("SYSTEM", 1),
              operationId: working.value.state
                .activeAutomaticOperationId as typeof operationId,
              bundleId: working.value.state.currentBundleId as typeof bundleId,
            },
            clock,
          ),
        ).state,
        { type: "PROCESS_RESTARTED", action: action("SYSTEM", 2) },
        clock,
      ),
    ).state;
    expect(afterClose.state).toBe("READY_FOR_REVIEW");
    expect(afterClose.hold).toBeDefined();
    let observed = afterClose;
    for (const type of [
      "WINDOW_CLOSED",
      "SLEEP_WAKE",
      "REMOTE_EVENT_OBSERVED",
      "PAUSE_CHANGED",
    ] as const) {
      observed = must(
        reducePrimaryPr(observed, { type, action: action("SYSTEM") }, clock),
      ).state;
    }
    expect(observed).toEqual(afterClose);
  });

  it("requires an explicit human continuation and releases only explicit outcomes", () => {
    const initial = createPrimaryPrSnapshot({ prId, clock });
    const working = must(
      reducePrimaryPr(
        initial,
        {
          type: "DISPATCH_AUTOMATIC_REVIEW",
          action: action("SYSTEM", 0),
          operationId,
          bundleId,
          eligible: true,
          globalPaused: false,
        },
        clock,
      ),
    ).state;
    const held = must(
      reducePrimaryPr(
        working,
        {
          type: "REVIEW_BLOCKED",
          action: action("SYSTEM", 1),
          operationId,
          bundleId,
          reason: unsafeReason(
            "AI_TURN_TIMEOUT",
            "stopped",
            "timeout",
            "RETRY",
          ),
        },
        clock,
      ),
    ).state;
    const implicit = reducePrimaryPr(
      held,
      {
        type: "REEVALUATE",
        action: action("SYSTEM", 2),
        operationId,
        bundleId: nextBundleId,
        parentBundleId: bundleId,
      },
      clock,
    );
    expect(implicit.ok).toBe(false);
    const continued = must(
      reducePrimaryPr(
        held,
        {
          type: "REEVALUATE",
          action: action("HUMAN", held.version),
          operationId: must(parseAIWorkOperationId("ai-op-3")),
          bundleId: nextBundleId,
          parentBundleId: bundleId,
        },
        laterClock,
      ),
    ).state;
    expect(continued.state).toBe("WORKING");
    const released = must(
      reducePrimaryPr(
        held,
        {
          type: "DISCARD_BUNDLE",
          action: action("HUMAN", held.version),
          bundleId,
          outcome: "DISCARDED",
          worktreeHandled: true,
        },
        laterClock,
      ),
    ).state;
    expect(released.state).toBe("WATCHING");
    expect(released.hold).toBeUndefined();
  });

  it("keeps global pause as an overlay and allows explicit synchronization to remain separate", () => {
    const overlay = createWatchingOverlay(clock);
    const paused = setWatchingPaused(overlay, true, laterInstant);
    expect(paused.paused).toBe(true);
    expect(
      must(parseWatchingOverlay(JSON.parse(JSON.stringify(paused)))),
    ).toEqual(paused);
    const result = reducePrimaryPr(
      createPrimaryPrSnapshot({ prId, clock }),
      {
        type: "DISPATCH_AUTOMATIC_REVIEW",
        action: action("SYSTEM", 0),
        operationId,
        bundleId,
        eligible: true,
        globalPaused: true,
      },
      clock,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WATCHING_PAUSED");
  });

  it("covers every primary state guard and cancellation stop reason", () => {
    expect(PRIMARY_PR_STATES).toEqual([
      "WATCHING",
      "WORKING",
      "READY_FOR_REVIEW",
      "NEEDS_ATTENTION",
    ]);
    for (const state of PRIMARY_PR_STATES) {
      const candidate = {
        ...createPrimaryPrSnapshot({ prId, clock }),
        state,
        version: 0,
        ...(state === "WORKING"
          ? {
              activeAutomaticOperationId: operationId,
              currentBundleId: bundleId,
            }
          : {}),
      };
      const result = reducePrimaryPr(
        candidate,
        {
          type: "DISPATCH_AUTOMATIC_REVIEW",
          action: action("SYSTEM", 0),
          operationId,
          bundleId,
          eligible: true,
          globalPaused: false,
        },
        clock,
      );
      if (state === "WATCHING") {
        expect(result).toMatchObject({
          ok: true,
          value: { state: { state: "WORKING" } },
        });
      } else {
        expect(result.ok).toBe(false);
      }
    }
    const working = must(
      reducePrimaryPr(
        {
          ...createPrimaryPrSnapshot({ prId, clock }),
          state: "WORKING",
          activeAutomaticOperationId: operationId,
          currentBundleId: bundleId,
        },
        {
          type: "REVIEW_BLOCKED",
          action: action("SYSTEM", 0),
          operationId,
          bundleId,
          reason: unsafeReason(
            "CANCELLED",
            "cancelled",
            "the user cancelled work",
            "REVIEW",
          ),
        },
        clock,
      ),
    ).state;
    expect(working.state).toBe("NEEDS_ATTENTION");
    expect(working.hold?.reason.code).toBe("CANCELLED");
  });

  it("releases a held PR for both successful publication outcomes", () => {
    const held = must(
      reducePrimaryPr(
        must(
          reducePrimaryPr(
            createPrimaryPrSnapshot({ prId, clock }),
            {
              type: "DISPATCH_AUTOMATIC_REVIEW",
              action: action("SYSTEM", 0),
              operationId,
              bundleId,
              eligible: true,
              globalPaused: false,
            },
            clock,
          ),
        ).state,
        {
          type: "REVIEW_COMPLETED",
          action: action("SYSTEM", 1),
          operationId,
          bundleId,
        },
        clock,
      ),
    ).state;
    expect(
      must(
        reducePrimaryPr(
          held,
          {
            type: "RELEASE_AFTER_PUBLISHED",
            action: action("HUMAN", held.version),
            bundleId,
            outcome: "PUBLISHED",
            worktreeHandled: true,
          },
          clock,
        ),
      ).state.state,
    ).toBe("WATCHING");
    expect(
      must(
        reducePrimaryPr(
          held,
          {
            type: "RELEASE_AFTER_PUBLISHED_WITH_ERRORS",
            action: action("HUMAN", held.version),
            bundleId,
            outcome: "PUBLISHED_WITH_ERRORS",
            worktreeHandled: true,
          },
          clock,
        ),
      ).state.state,
    ).toBe("WATCHING");
  });
});

describe("F02 immutable event versions and Review Bundles", () => {
  it("retains held feedback, claims each version once, and marks it handled monotonically", () => {
    const unassigned = createEventVersionAssociation({
      prId,
      eventVersionId,
      remoteObjectKey: "review-comment-1",
      semanticHash,
      observedAt: instant,
    });
    const retained = must(
      associateEventVersion(
        unassigned,
        {
          type: "RETAIN_DURING_HOLD",
          action: action("SYSTEM"),
          reason: unsafeReason(
            "RETAINED_DURING_HOLD",
            "retained",
            "hold",
            "RE_EVALUATE",
          ),
        },
        clock,
      ),
    ).state;
    expect(retained.state).toBe("RETAINED_DURING_HOLD");
    expect(
      associateEventVersion(
        retained,
        { type: "ASSIGN_TO_ACTIVE_BUNDLE", action: action("SYSTEM"), bundleId },
        clock,
      ).ok,
    ).toBe(false);
    const assigned = must(
      associateEventVersion(
        retained,
        {
          type: "ASSIGN_RETAINED_AFTER_HOLD",
          action: action("HUMAN"),
          bundleId,
          authorized: true,
        },
        clock,
      ),
    ).state;
    const handled = must(
      associateEventVersion(
        assigned,
        {
          type: "MARK_HANDLED_BY_BUNDLE",
          action: action("SYSTEM"),
          bundleId,
          outcome: "DISCARDED",
        },
        clock,
      ),
    ).state;
    expect(handled.state).toBe("HANDLED_BY_BUNDLE");
    expect(
      associateEventVersion(
        handled,
        {
          type: "MARK_HANDLED_BY_BUNDLE",
          action: action("SYSTEM"),
          bundleId,
          outcome: "DISCARDED",
        },
        clock,
      ),
    ).toMatchObject({ ok: true, value: { changed: false } });
    const newVersion = createEventVersionAssociation({
      prId,
      eventVersionId: nextEventVersionId,
      remoteObjectKey: "review-comment-1",
      semanticHash: must(parseSemanticHash("semantic-hash-2")),
      observedAt: laterInstant,
    });
    expect(newVersion.eventVersionId).not.toBe(handled.eventVersionId);
    const claimed = must(
      associateEventVersion(
        unassigned,
        {
          type: "ASSIGN_TO_ACTIVE_BUNDLE",
          action: action("SYSTEM", 0),
          bundleId,
        },
        clock,
      ),
    ).state;
    const race = associateEventVersion(
      claimed,
      {
        type: "ASSIGN_TO_ACTIVE_BUNDLE",
        action: action("SYSTEM", 0),
        bundleId: nextBundleId,
      },
      clock,
    );
    expect(race.ok).toBe(false);
    if (!race.ok) expect(race.error.code).toBe("CONCURRENT_STATE_CONFLICT");
  });

  it("enforces the complete Review Bundle lifecycle and stale re-evaluation", () => {
    const bundle = createReviewBundle({
      id: bundleId,
      prId,
      eventVersionIds: [eventVersionId],
      snapshotRefs: { prBaseSha: baseSha, prHeadSha: headSha },
      aiOperationId: operationId,
    });
    const ready = must(
      reduceReviewBundle(
        bundle,
        {
          type: "REVIEWABLE_COMPLETION",
          action: action("SYSTEM", 0),
        },
        clock,
      ),
    ).state;
    expect(canPublishReviewBundle(ready)).toBe(true);
    const publishing = must(
      reduceReviewBundle(
        ready,
        {
          type: "APPROVE_PUBLICATION",
          action: action("HUMAN", 1),
          approvalId: "approval-1",
        },
        clock,
      ),
    ).state;
    const published = must(
      reduceReviewBundle(
        publishing,
        {
          type: "PUBLICATION_COMPLETED",
          action: action("RECOVERY", 2),
          reason: unsafeReason("PUBLISHED", "published", "reconciled", "NONE"),
        },
        clock,
      ),
    ).state;
    expect(published.state).toBe("PUBLISHED");
    expect(
      reduceReviewBundle(
        published,
        {
          type: "BLOCKING_STOP",
          action: action("SYSTEM", published.version),
          reason: unsafeReason("BAD", "bad", "bad", "REVIEW"),
        },
        clock,
      ).ok,
    ).toBe(false);
    const stale = must(
      reduceReviewBundle(
        ready,
        {
          type: "REMOTE_HEAD_MOVED",
          action: action("SYSTEM", ready.version),
          remoteHeadMoved: true,
          reason: unsafeReason(
            "STALE_RESULT",
            "stale",
            "head moved",
            "RE_EVALUATE",
          ),
        },
        laterClock,
      ),
    ).state;
    expect(canPublishReviewBundle(stale)).toBe(false);
    const reevaluated = must(
      reduceReviewBundle(
        stale,
        {
          type: "RE_EVALUATE",
          action: action("HUMAN", stale.version),
          newBundleId: nextBundleId,
        },
        laterClock,
      ),
    ).state;
    expect(reevaluated.id).toBe(nextBundleId);
    expect(reevaluated.parentBundleId).toBe(bundleId);
    expect(reevaluated.state).toBe("WORKING");
  });
});

describe("F02 synchronization overlay", () => {
  it("tracks branch and repository identity independently from primary review state", () => {
    const sync = createSynchronizationResult({
      id: syncId,
      prId,
      prBaseBranch: must(parseBranchName("release/1")),
      prHeadBranch: must(parseBranchName("feature/pr-1")),
      syncSourceBranchOverride: must(parseBranchName("integration")),
      syncSourceBranch: must(parseBranchName("integration")),
      sourceRepositoryId: repositoryId,
      destinationRepositoryId: repositoryId,
      syncSourceSha: sourceSha,
      prHeadSha: headSha,
      operationId: syncId,
      clock,
      eligible: true,
    });
    const merging = must(
      reduceSynchronization(
        sync,
        { type: "BEGIN_MERGE", action: action("HUMAN", 0), eligible: true },
        clock,
      ),
    ).state;
    const ready = must(
      reduceSynchronization(
        merging,
        {
          type: "MERGE_CLEAN",
          action: action("SYSTEM", 1),
          reason: unsafeReason(
            "READY_TO_PUBLISH",
            "clean merge",
            "checks passed",
            "APPROVE",
          ),
        },
        clock,
      ),
    ).state;
    expect(ready.status).toBe("READY_TO_PUBLISH");
    expect(ready.prBaseBranch).toBe("release/1");
    expect(ready.syncSourceBranch).toBe("integration");
    expect(ready.destinationRepositoryId).toBe(repositoryId);
    expect(canPublishSynchronizationResult(ready)).toBe(true);
    const stale = must(
      reduceSynchronization(
        ready,
        {
          type: "MARK_STALE",
          action: action("SYSTEM", ready.version),
          sourceMoved: true,
          headMoved: false,
          reason: unsafeReason(
            "STALE_RESULT",
            "stale",
            "source moved",
            "RE_EVALUATE",
          ),
        },
        laterClock,
      ),
    ).state;
    expect(stale.status).toBe("STALE");
    expect(canPublishSynchronizationResult(stale)).toBe(false);
    const pausedReview = reducePrimaryPr(
      createPrimaryPrSnapshot({ prId, clock }),
      {
        type: "DISPATCH_AUTOMATIC_REVIEW",
        action: action("SYSTEM", 0),
        operationId,
        bundleId,
        eligible: true,
        globalPaused: true,
      },
      clock,
    );
    expect(pausedReview.ok).toBe(false);
    expect(
      reduceSynchronization(
        createSynchronizationResult({ ...sync, clock }),
        { type: "BEGIN_MERGE", action: action("HUMAN", 0), eligible: true },
        clock,
      ),
    ).toMatchObject({ ok: true, value: { state: { status: "MERGING" } } });
  });

  it("continues one conflict result without changing another result or the PR primary state", () => {
    const base = createSynchronizationResult({
      id: syncId,
      prId,
      prBaseBranch: must(parseBranchName("main")),
      prHeadBranch: must(parseBranchName("feature")),
      syncSourceBranch: must(parseBranchName("main")),
      sourceRepositoryId: repositoryId,
      destinationRepositoryId: repositoryId,
      operationId: syncId,
      clock,
      eligible: true,
    });
    const merging = must(
      reduceSynchronization(
        base,
        { type: "BEGIN_MERGE", action: action("HUMAN", 0), eligible: true },
        clock,
      ),
    ).state;
    const conflict = must(
      reduceSynchronization(
        merging,
        {
          type: "MERGE_CONFLICT",
          action: action("SYSTEM", 1),
          reason: unsafeReason(
            "CONFLICT",
            "conflict",
            "paths overlap",
            "RETRY",
          ),
        },
        clock,
      ),
    ).state;
    expect(conflict.status).toBe("RESOLVING_CONFLICTS");
    const attention = must(
      reduceSynchronization(
        conflict,
        {
          type: "VALIDATION_FAILED",
          action: action("SYSTEM", conflict.version),
          reason: unsafeReason(
            "VALIDATION_FAILED",
            "validation failed",
            "checks failed",
            "RETRY",
          ),
        },
        clock,
      ),
    ).state;
    const retry = must(
      reduceSynchronization(
        attention,
        {
          type: "RETRY_RESOLUTION",
          action: action("HUMAN", attention.version),
          reason: unsafeReason("RETRY", "retry", "explicit", "NONE"),
        },
        clock,
      ),
    ).state;
    expect(retry.status).toBe("RESOLVING_CONFLICTS");
    expect(retry.prId).toBe(prId);
    const independent = createSynchronizationResult({
      id: secondSyncId,
      prId,
      prBaseBranch: must(parseBranchName("main")),
      prHeadBranch: must(parseBranchName("feature-2")),
      syncSourceBranch: must(parseBranchName("main")),
      sourceRepositoryId: repositoryId,
      destinationRepositoryId: repositoryId,
      operationId: secondSyncId,
      clock,
    });
    const independentMerging = must(
      reduceSynchronization(
        independent,
        { type: "BEGIN_MERGE", action: action("HUMAN", 0), eligible: true },
        clock,
      ),
    ).state;
    const independentReady = must(
      reduceSynchronization(
        independentMerging,
        {
          type: "MERGE_CLEAN",
          action: action("SYSTEM", independentMerging.version),
          reason: unsafeReason(
            "READY_TO_PUBLISH",
            "ready",
            "clean merge",
            "APPROVE",
          ),
        },
        clock,
      ),
    ).state;
    expect(independentReady.status).toBe("READY_TO_PUBLISH");
    expect(retry.status).toBe("RESOLVING_CONFLICTS");
  });
});

describe("F02 publication recovery and idempotency", () => {
  function publication(): ReturnType<typeof createPublicationRecord> {
    return createPublicationRecord({
      id: publicationId,
      idempotencyKey,
      owner: { kind: "REVIEW_BUNDLE", id: bundleId },
      responseKeys: ["reply-1"],
    });
  }

  function publishToResponses(record: ReturnType<typeof publication>) {
    const requested = must(
      reducePublication(
        record,
        { type: "REQUEST_APPROVAL", action: action("HUMAN", record.version) },
        clock,
      ),
    ).state;
    const approved = must(
      reducePublication(
        requested,
        {
          type: "HUMAN_APPROVAL",
          action: action("HUMAN", requested.version),
          approval: {
            schemaVersion: DOMAIN_SCHEMA_VERSION,
            kind: "human-approval",
            approvalId: must(parseApprovalId("approval-1")),
            actor: "HUMAN",
            approvedAt: instant,
            scope: "REVIEW_BUNDLE_PUBLICATION",
          },
        },
        clock,
      ),
    ).state;
    const committing = must(
      reducePublication(
        approved,
        {
          type: "PREPARATION_COMPLETE",
          action: action("SYSTEM", approved.version),
        },
        clock,
      ),
    ).state;
    const pushing = must(
      reducePublication(
        committing,
        {
          type: "COMMIT_CONFIRMED",
          action: action("SYSTEM", committing.version),
          commitSha: baseSha,
        },
        clock,
      ),
    ).state;
    return must(
      reducePublication(
        pushing,
        {
          type: "PUSH_CONFIRMED",
          action: action("SYSTEM", pushing.version),
          commitSha: baseSha,
        },
        clock,
      ),
    ).state;
  }

  it("requires human approval and reaches a published terminal phase", () => {
    const record = publication();
    const noApproval = reducePublication(
      record,
      { type: "PREPARATION_COMPLETE", action: action("SYSTEM", 0) },
      clock,
    );
    expect(noApproval.ok).toBe(false);
    const posting = publishToResponses(record);
    const published = must(
      reducePublication(
        posting,
        {
          type: "RESPONSES_COMPLETE",
          action: action("SYSTEM", posting.version),
          reason: unsafeReason(
            "PUBLISHED",
            "published",
            "all responses posted",
            "NONE",
          ),
        },
        clock,
      ),
    ).state;
    expect(published.phase).toBe("PUBLISHED");
    expect(published.codePublished).toBe(true);
    expect(canStartCodePublication(published)).toBe(false);
  });

  it("reconciles uncertain effects with the same key and prevents code republish", () => {
    const record = publication();
    const requested = must(
      reducePublication(
        record,
        { type: "REQUEST_APPROVAL", action: action("HUMAN", 0) },
        clock,
      ),
    ).state;
    const approved = must(
      reducePublication(
        requested,
        {
          type: "HUMAN_APPROVAL",
          action: action("HUMAN", requested.version),
          approval: {
            schemaVersion: DOMAIN_SCHEMA_VERSION,
            kind: "human-approval",
            approvalId: must(parseApprovalId("approval-2")),
            actor: "HUMAN",
            approvedAt: instant,
            scope: "REVIEW_BUNDLE_PUBLICATION",
          },
        },
        clock,
      ),
    ).state;
    const committing = must(
      reducePublication(
        approved,
        {
          type: "PREPARATION_COMPLETE",
          action: action("SYSTEM", approved.version),
        },
        clock,
      ),
    ).state;
    const recovering = must(
      reducePublication(
        committing,
        {
          type: "COMMIT_UNCERTAIN",
          action: action("SYSTEM", committing.version),
          commitSha: baseSha,
        },
        clock,
      ),
    ).state;
    expect(recovering.phase).toBe("RECOVERING");
    expect(isPublicationUncertain(recovering)).toBe(true);
    expect(must(replayPublication(recovering, idempotencyKey)).replayed).toBe(
      true,
    );
    const pushing = must(
      reducePublication(
        recovering,
        {
          type: "RECONCILE_COMMIT_PRESENT",
          action: action("RECOVERY", recovering.version),
          commitSha: baseSha,
          reason: unsafeReason(
            "RECONCILED",
            "found commit",
            "known SHA",
            "NONE",
          ),
        },
        clock,
      ),
    ).state;
    const recovered = must(
      reducePublication(
        must(
          reducePublication(
            pushing,
            {
              type: "PUSH_UNCERTAIN",
              action: action("SYSTEM", pushing.version),
              commitSha: baseSha,
            },
            clock,
          ),
        ).state,
        {
          type: "RECONCILE_PUSH_PRESENT",
          action: action("RECOVERY", pushing.version + 1),
          commitSha: baseSha,
          reason: unsafeReason("RECONCILED", "found push", "known SHA", "NONE"),
        },
        clock,
      ),
    ).state;
    const responseRecovering = must(
      reducePublication(
        recovered,
        {
          type: "RESPONSE_UNCERTAIN",
          action: action("SYSTEM", recovered.version),
          reason: unsafeReason(
            "UNKNOWN_EXTERNAL_OUTCOME",
            "response outcome unknown",
            "the response may have posted",
            "RECONCILE",
          ),
        },
        clock,
      ),
    ).state;
    const partial = must(
      reducePublication(
        responseRecovering,
        {
          type: "RECONCILE_RESPONSES",
          action: action("RECOVERY", responseRecovering.version),
          allResponsesReconciled: false,
          reason: unsafeReason(
            "PUBLISHED_WITH_ERRORS",
            "code published",
            "reply pending",
            "RETRY",
          ),
        },
        clock,
      ),
    ).state;
    expect(partial.phase).toBe("PUBLISHED_WITH_ERRORS");
    expect(partial.codePublished).toBe(true);
    expect(canStartCodePublication(partial)).toBe(false);
    const updated = must(
      updatePublicationResponse(partial, {
        responseKey: "reply-1",
        state: "FAILED",
        failureReason: unsafeReason(
          "RESPONSE_FAILED",
          "failed",
          "network",
          "RETRY",
        ),
      }),
    );
    expect(updated.responses[0]?.state).toBe("FAILED");
    expect(
      must(replayPublication(updated, idempotencyKey)).record.codePublished,
    ).toBe(true);
  });

  it("rejects a different key and unknown publication phases", () => {
    const record = publication();
    const differentKey = must(parseIdempotencyKey("publication-key-2"));
    expect(replayPublication(record, differentKey).ok).toBe(false);
    expect(parsePublicationRecord({ ...record, phase: "MAGIC" }).ok).toBe(
      false,
    );
    expect(parsePublicationRecord({ ...record, apiKey: "secret" }).ok).toBe(
      false,
    );
  });
});

describe("F02 serialized restart and cross-consumer conformance", () => {
  it("round-trips representative review and synchronization records with history", () => {
    const initial = createPrimaryPrSnapshot({ prId, clock });
    const working = must(
      reducePrimaryPr(
        initial,
        {
          type: "DISPATCH_AUTOMATIC_REVIEW",
          action: action("SYSTEM", 0),
          operationId,
          bundleId,
          eligible: true,
          globalPaused: false,
        },
        clock,
      ),
    ).state;
    const serialized = JSON.parse(JSON.stringify(working)) as unknown;
    const restored = must(parsePrimaryPrSnapshot(serialized));
    expect(restored).toEqual(working);

    const event = createEventVersionAssociation({
      prId,
      eventVersionId,
      remoteObjectKey: "issue-comment-1",
      semanticHash,
      observedAt: instant,
    });
    expect(
      must(parseEventVersionAssociation(JSON.parse(JSON.stringify(event)))),
    ).toEqual(event);

    const bundle = createReviewBundle({
      id: bundleId,
      prId,
      eventVersionIds: [eventVersionId],
    });
    expect(must(parseReviewBundle(JSON.parse(JSON.stringify(bundle))))).toEqual(
      bundle,
    );

    const sync = createSynchronizationResult({
      id: syncId,
      prId,
      prBaseBranch: must(parseBranchName("main")),
      prHeadBranch: must(parseBranchName("feature")),
      syncSourceBranch: must(parseBranchName("main")),
      sourceRepositoryId: repositoryId,
      destinationRepositoryId: repositoryId,
      operationId: syncId,
      clock,
    });
    expect(
      must(parseSynchronizationResult(JSON.parse(JSON.stringify(sync)))),
    ).toEqual(sync);
  });

  it("keeps review and synchronization consumers independent", () => {
    const review = createPrimaryPrSnapshot({ prId, clock });
    const sync = createSynchronizationResult({
      id: syncId,
      prId,
      prBaseBranch: must(parseBranchName("main")),
      prHeadBranch: must(parseBranchName("feature")),
      syncSourceBranch: must(parseBranchName("main")),
      sourceRepositoryId: repositoryId,
      destinationRepositoryId: repositoryId,
      operationId: syncId,
      clock,
    });
    const syncStarted = must(
      reduceSynchronization(
        sync,
        { type: "BEGIN_MERGE", action: action("HUMAN", 0), eligible: true },
        clock,
      ),
    ).state;
    expect(syncStarted.status).toBe("MERGING");
    expect(review.state).toBe("WATCHING");
    expect(syncStarted.prId).toBe(review.prId);
  });

  it("fails closed for unknown schema versions and extra fields in every contract family", () => {
    const primary = createPrimaryPrSnapshot({ prId, clock });
    const event = createEventVersionAssociation({
      prId,
      eventVersionId,
      remoteObjectKey: "comment-2",
      semanticHash,
      observedAt: instant,
    });
    const bundle = createReviewBundle({
      id: bundleId,
      prId,
      eventVersionIds: [eventVersionId],
    });
    const sync = createSynchronizationResult({
      id: syncId,
      prId,
      prBaseBranch: must(parseBranchName("main")),
      prHeadBranch: must(parseBranchName("feature")),
      syncSourceBranch: must(parseBranchName("main")),
      sourceRepositoryId: repositoryId,
      destinationRepositoryId: repositoryId,
      operationId: syncId,
      clock,
    });
    const publication = createPublicationRecord({
      id: publicationId,
      idempotencyKey,
      owner: { kind: "REVIEW_BUNDLE", id: bundleId },
    });
    const overlay = createWatchingOverlay(clock);
    const sampleAction = action("HUMAN");
    const working = must(
      reducePrimaryPr(
        createPrimaryPrSnapshot({ prId, clock }),
        {
          type: "DISPATCH_AUTOMATIC_REVIEW",
          action: action("SYSTEM", 0),
          operationId,
          bundleId,
          eligible: true,
          globalPaused: false,
        },
        clock,
      ),
    ).state;
    const held = must(
      reducePrimaryPr(
        working,
        {
          type: "REVIEW_COMPLETED",
          action: action("SYSTEM", working.version),
          operationId,
          bundleId,
        },
        clock,
      ),
    ).state;
    if (held.hold === undefined || held.history[0] === undefined)
      throw new Error("expected held primary fixture");
    const approval = {
      schemaVersion: DOMAIN_SCHEMA_VERSION,
      kind: "human-approval" as const,
      approvalId: must(parseApprovalId("approval-nested")),
      actor: "HUMAN" as const,
      approvedAt: instant,
      scope: "REVIEW_BUNDLE_PUBLICATION" as const,
    };
    const assertClosed = (
      parser: (value: unknown) => DomainResult<unknown>,
      record: object,
    ) => {
      expect(parser({ ...record, schemaVersion: 99 }).ok).toBe(false);
      expect(parser({ ...record, unsupportedField: "value" }).ok).toBe(false);
    };
    assertClosed(parsePrimaryPrSnapshot, primary);
    assertClosed(parseEventVersionAssociation, event);
    assertClosed(parseReviewBundle, bundle);
    assertClosed(parseSynchronizationResult, sync);
    assertClosed(parsePublicationRecord, publication);
    assertClosed(parseWatchingOverlay, overlay);
    assertClosed(parseActionRecord, sampleAction);
    assertClosed(parseReviewHold, held.hold);
    assertClosed(parseTransitionEvent, held.history[0]);
    assertClosed(parseHumanApproval, approval);
  });

  it("executes state guards for every documented overlay, bundle, and publication state", () => {
    expect(REVIEW_BUNDLE_STATES).toHaveLength(9);
    expect(SYNCHRONIZATION_STATUSES).toHaveLength(10);
    expect(PUBLICATION_PHASES).toHaveLength(11);
    const bundle = createReviewBundle({
      id: bundleId,
      prId,
      eventVersionIds: [],
    });
    for (const state of REVIEW_BUNDLE_STATES) {
      const candidate = { ...bundle, state, version: 0 } as ReviewBundle;
      const result = reduceReviewBundle(
        candidate,
        { type: "REVIEWABLE_COMPLETION", action: action("SYSTEM", 0) },
        clock,
      );
      expect(result.ok).toBe(state === "WORKING");
    }
    const sync = createSynchronizationResult({
      id: syncId,
      prId,
      prBaseBranch: must(parseBranchName("main")),
      prHeadBranch: must(parseBranchName("feature")),
      syncSourceBranch: must(parseBranchName("main")),
      sourceRepositoryId: repositoryId,
      destinationRepositoryId: repositoryId,
      operationId: syncId,
      clock,
    });
    for (const status of SYNCHRONIZATION_STATUSES) {
      const candidate = {
        ...sync,
        status,
        version: 0,
      } as SynchronizationResult;
      const result = reduceSynchronization(
        candidate,
        { type: "BEGIN_MERGE", action: action("HUMAN", 0), eligible: true },
        clock,
      );
      expect(result.ok).toBe(status === "SKIPPED");
    }
    const publication = createPublicationRecord({
      id: publicationId,
      idempotencyKey,
      owner: { kind: "REVIEW_BUNDLE", id: bundleId },
    });
    for (const phase of PUBLICATION_PHASES) {
      const candidate = { ...publication, phase, version: 0 };
      const result = reducePublication(
        candidate,
        { type: "REQUEST_APPROVAL", action: action("SYSTEM", 0) },
        clock,
      );
      expect(result.ok).toBe(phase === "NOT_STARTED");
    }
  });
});
