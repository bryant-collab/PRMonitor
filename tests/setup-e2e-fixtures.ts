import path from "node:path";
export {
  seedConditionalGate,
  seedHeldFinalReview,
  seedGuardedWork,
  seedConditionalSyncWork,
  advanceGuardedResult,
  readRetainedWork,
  seedUncertainPublication,
  installerData,
} from "./guarded-e2e-fixtures";
import {
  initializePersistence,
  createPersistenceRepositories,
  F18PersistenceRepositories,
  F07PersistenceRepositories,
  F12PersistenceRepositories,
} from "../apps/desktop/src/main/persistence";
import { managedPrFixture } from "../apps/desktop/tests/support/managed-pr-fixture";
import { f18ReviewBundleRecordSchema } from "../apps/desktop/src/shared/f18-automatic-review";
import { ActivityService } from "../apps/desktop/src/main/activity-service";
import type { ActivityEventInput } from "../apps/desktop/src/shared/activity";

/** Historical event fixtures written through the real normalized Activity writer. */
export async function seedConditionalActivity(userData: string) {
  const store = await initializePersistence({
    databasePath: path.join(userData, "database/prmonitor.sqlite"),
    backupRoot: path.join(userData, "backups"),
  });
  try {
    let sequence = 0;
    const base = Date.now();
    const service = new ActivityService(store, {
      clock: { now: () => new Date(base + sequence++).toISOString() },
    });
    const append = (id: string, fields: Partial<ActivityEventInput>) => {
      const result = service.append({
        eventId: `native-activity-${id}`,
        eventType: "OPERATION_PROGRESS",
        stage: "REVIEW",
        correlationId: "native-activity-history",
        occurrenceAt: new Date(base).toISOString(),
        severity: "INFO",
        reason: {
          code: "PROGRESS",
          what: "Historical fixture observation",
          why: "Owned acceptance history",
          nextAction: "NONE",
        },
        summary: "Historical fixture observation",
        managedPrId: "shell-pr-1",
        details: { fixture: "owned-historical-activity" },
        ...fields,
      });
      if (result.outcome !== "inserted")
        throw Error("CONDITIONAL_ACTIVITY_SEED_FAILED");
    };
    for (let i = 0; i < 60; i++) append(`progress-${i}`, {});
    append("failure", { eventType: "OPERATION_FAILED", severity: "ERROR" });
    append("unknown-outcome", {
      eventType: "OPERATION_UNKNOWN_OUTCOME",
      severity: "WARNING",
    });
    append("pr-recovery", {
      eventType: "RECOVERY_FAILED",
      stage: "RECOVERY",
      severity: "WARNING",
      details: { f28Event: "UNCERTAIN" },
    });
    append("application-recovery", {
      eventType: "RECOVERY_FAILED",
      stage: "RECOVERY",
      managedPrId: undefined,
      severity: "ERROR",
      details: { fixture: "owned-historical-activity" },
    });
    append("legacy-unknown", {
      eventType: "LEGACY_ACTIVITY",
      stage: "SYSTEM",
      managedPrId: undefined,
      details: {},
    });
  } finally {
    store.close();
  }
}

/** Real SQLite read failure in the already marked acceptance profile. No rows
 * are deleted or rewritten; the table name is restored even if the UI fails. */
export async function withConditionalActivityReadFailure(
  userData: string,
  exercise: () => Promise<void>,
) {
  const store = await initializePersistence({
    databasePath: path.join(userData, "database/prmonitor.sqlite"),
    backupRoot: path.join(userData, "backups"),
  });
  let renamed = false;
  try {
    const originalRows = store.transaction((t) =>
      JSON.stringify(
        t.all("SELECT * FROM activity_events ORDER BY activity_event_id"),
      ),
    );
    store.transaction((t) =>
      t.connection.exec(
        "ALTER TABLE activity_events RENAME TO owned_activity_read_failure",
      ),
    );
    renamed = true;
    try {
      await exercise();
    } finally {
      store.transaction((t) =>
        t.connection.exec(
          "ALTER TABLE owned_activity_read_failure RENAME TO activity_events",
        ),
      );
      renamed = false;
    }
    const restoredRows = store.transaction((t) =>
      JSON.stringify(
        t.all("SELECT * FROM activity_events ORDER BY activity_event_id"),
      ),
    );
    if (originalRows !== restoredRows)
      throw Error("CONDITIONAL_ACTIVITY_ROWS_CHANGED");
  } finally {
    if (renamed)
      store.transaction((t) =>
        t.connection.exec(
          "ALTER TABLE owned_activity_read_failure RENAME TO activity_events",
        ),
      );
    store.close();
  }
}

/** Twenty real managed records; watching is paused before production startup. */
export async function seedShell(userData: string) {
  const store = await initializePersistence({
    databasePath: path.join(userData, "database/prmonitor.sqlite"),
    backupRoot: path.join(userData, "backups"),
  });
  try {
    const server = store.read(
      "SELECT server_id FROM github_servers WHERE host = ?",
      "github.com",
    );
    if (server === undefined) throw Error("SHELL_FIXTURE_SERVER_MISSING");
    const serverId = String(server.server_id);
    const scheduler = new F12PersistenceRepositories(store);
    const state = scheduler.getSchedulerState();
    scheduler.updateConfiguration({
      configuration: { ...state.configuration, readOnlyPollWhilePaused: false },
      actor: "acceptance",
      requestId: "shell-no-poll",
    });
    scheduler.setPaused({
      paused: true,
      actor: "acceptance",
      requestId: "shell-paused",
    });
    const prs = new F07PersistenceRepositories(store);
    for (let index = 1; index <= 20; index++) {
      const id = `shell-pr-${index}`,
        model = managedPrFixture(
          id,
          ["WATCHING", "WORKING", "READY_FOR_REVIEW", "NEEDS_ATTENTION"][
            index % 4
          ] as Parameters<typeof managedPrFixture>[1],
          new Date().toISOString(),
        );
      const remote = {
        schemaVersion: 1 as const,
        canonicalUrl: `https://github.com/owner/base/pull/${index}`,
        pullRequestKey: `${model.baseRepository.key}#${index}`,
        serverId,
        server: model.baseRepository.server,
        owner: model.owner,
        repositoryName: model.repositoryName,
        number: index,
        state: "OPEN" as const,
        merged: false,
        title: `Acceptance PR ${index} with a long title for independent scrolling`,
        baseRepository: model.baseRepository,
        headRepository: model.headRepository,
        baseBranch: model.prBaseBranch,
        headBranch: model.prHeadBranch,
        baseSha: model.prBaseSha,
        headSha: model.prHeadSha,
        defaultBranch: "main",
      };
      prs.beginAddAttempt({
        attemptId: `shell-add-${index}`,
        correlationId: `shell-add-${index}`,
        idempotencyKey: `shell-add-${index}`,
        canonicalPrKey: remote.pullRequestKey,
        serverId,
        profileVersion: 1,
        normalizedUrl: remote.canonicalUrl,
        parsedInput: { schemaVersion: 1 },
        context: null,
        syncSourceBranchOverride: null,
      });
      prs.commitManagedPr({
        attemptId: `shell-add-${index}`,
        managedPrId: id,
        remote,
        primaryState: model.primaryState,
        context: null,
        syncSourceBranchOverride: null,
      });
    }
  } finally {
    store.close();
  }
}

/** Saved historical review in the marked test profile, using production repositories. */
export async function seedSavedReview(userData: string) {
  const store = await initializePersistence({
    databasePath: path.join(userData, "database/prmonitor.sqlite"),
    backupRoot: path.join(userData, "backups"),
  });
  try {
    const repositories = createPersistenceRepositories(store);
    const repository = {
      serverId: "saved-fixture-server",
      owner: "fixture",
      name: "saved-review",
      key: "fixture/saved-review",
    };
    repositories.putGithubServer({
      serverId: repository.serverId,
      host: "saved.example.invalid",
      apiBaseUrl: "https://saved.example.invalid/api/v3",
    });
    repositories.putRepository({
      repositoryId: "saved-fixture-repository",
      serverId: repository.serverId,
      owner: repository.owner,
      name: repository.name,
    });
    repositories.putManagedPr({
      managedPrId: "saved-fixture-pr",
      serverId: repository.serverId,
      baseRepositoryId: "saved-fixture-repository",
      headRepositoryId: "saved-fixture-repository",
      number: 42,
      baseBranch: "main",
      headBranch: "saved-change",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      state: "READY_FOR_REVIEW",
    });
    const time = new Date().toISOString();
    const record = f18ReviewBundleRecordSchema.parse({
      schemaVersion: 1,
      bundleId: "setup-saved-review",
      managedPrId: "saved-fixture-pr",
      batchId: "saved-fixture-batch",
      operationId: "saved-fixture-operation",
      claimId: "saved-fixture-claim",
      correlationId: "saved-fixture-correlation",
      schedulerRevision: 1,
      state: "READY_FOR_REVIEW",
      stage: "PROPOSAL_REVIEW",
      phase: "PROPOSAL_RECORDED",
      version: 1,
      createdAt: time,
      updatedAt: time,
      input: {
        schemaVersion: 1,
        operationId: "saved-fixture-operation",
        bundleId: "setup-saved-review",
        batchId: "saved-fixture-batch",
        managedPrId: "saved-fixture-pr",
        claimId: "saved-fixture-claim",
        correlationId: "saved-fixture-correlation",
        schedulerRevision: 1,
        remoteEventVersionIds: ["saved-fixture-event"],
        pullRequest: {
          baseRepository: repository,
          headRepository: repository,
          baseBranch: "main",
          headBranch: "saved-change",
          baseSha: "a".repeat(40),
          headSha: "b".repeat(40),
          title: "Saved review acceptance fixture",
        },
        feedback: [
          {
            eventVersionId: "saved-fixture-event",
            semanticHash: "saved-fixture-hash",
            sourceKind: "REVIEW_COMMENT",
            sourceId: "saved-fixture-comment",
            observedAt: time,
            body: "Please explain the expected behavior.",
            author: "Fixture reviewer",
          },
        ],
      },
      items: [
        {
          itemId: "saved-fixture-item",
          eventVersionId: "saved-fixture-event",
          recommendation: {
            remoteEventVersionId: "saved-fixture-event",
            assessment: "actionable",
            disposition: "question",
            explanation: "A human answer is needed before implementation.",
            proposedReply: "Please clarify the expected behavior.",
            relatedFiles: [],
          },
          decision: { decision: "pending", finalDisposition: "no_change" },
          decisionHistory: [],
        },
      ],
      draftResponses: [],
      reasons: [],
      nextAction: "REVIEW_DECISIONS",
      noImplementationChanges: true,
    });
    new F18PersistenceRepositories(repositories).persistIntent({
      record,
      events: [
        {
          id: "saved-fixture-event",
          managedPrId: record.managedPrId,
          sourceKind: "REVIEW_COMMENT",
          sourceId: "saved-fixture-comment",
          observedAt: time,
          semanticHash: "saved-fixture-hash",
          payload: { schemaVersion: 1 },
        },
      ],
    });
  } finally {
    store.close();
  }
}
