import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import {
  initializePersistence,
  createPersistenceRepositories,
  F18PersistenceRepositories,
  F13PersistenceRepositories,
  F07PersistenceRepositories,
  F25PersistenceRepositories,
  F19PersistenceRepositories,
} from "../apps/desktop/src/main/persistence";
import { f18ReviewBundleRecordSchema } from "../apps/desktop/src/shared/f18-automatic-review";
import { f26ConflictResolutionReadModelSchema } from "../apps/desktop/src/shared/f26-conflict-resolution";
import { f23CandidateSchema } from "../apps/desktop/src/shared/f23-release";
import type {
  F24ResolutionRow,
  F24PreparationAuthorization,
} from "../apps/desktop/src/shared/f24-synchronization";
import type {
  F25SynchronizationResultReadModel,
  F25SynchronizationBatchReadModel,
} from "../apps/desktop/src/shared/f25-synchronization";

/** Creates only local owned fixture repositories, before the application effect guard. */
export async function seedGuardedWork(userData: string, root: string) {
  const store = await initializePersistence({
    databasePath: path.join(userData, "database/prmonitor.sqlite"),
    backupRoot: path.join(userData, "backups"),
  });
  try {
    const repositories = createPersistenceRepositories(store);
    const reviews = new F18PersistenceRepositories(repositories);
    const original = reviews.get("setup-saved-review");
    if (!original) throw Error("GUARDED_REVIEW_FIXTURE_MISSING");
    const time = new Date().toISOString();
    const clone = path.join(root, "guarded-review-clone"),
      operationRoot = path.join(root, "worktrees", "guarded-review-operation"),
      source = path.join(operationRoot, "source-repository"),
      worktree = path.join(operationRoot, "worktree");
    await mkdir(clone, { recursive: true });
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: clone,
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    git("init", "--initial-branch=main");
    await writeFile(
      path.join(clone, "source.ts"),
      Array.from(
        { length: 300 },
        (_, i) => `export const original${i} = ${i};`,
      ).join("\n") + "\n",
    );
    git("add", "source.ts");
    git(
      "-c",
      "user.name=Acceptance fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "Owned acceptance baseline",
    );
    const baseline = git("rev-parse", "HEAD");
    const prId = "guarded-final-pr",
      bundleId = "guarded-final-review",
      operationId = "guarded-review-operation",
      worktreeId = "guarded-review-worktree";
    repositories.putManagedPr({
      managedPrId: prId,
      serverId: "saved-fixture-server",
      baseRepositoryId: "saved-fixture-repository",
      headRepositoryId: "saved-fixture-repository",
      number: 43,
      baseBranch: "main",
      headBranch: "saved-change",
      baseSha: baseline,
      headSha: baseline,
      state: "READY_FOR_REVIEW",
    });
    new F13PersistenceRepositories(store).reserveOperation({
      operationId,
      idempotencyKey: operationId,
      correlationId: operationId,
      ownerType: "REVIEW_BUNDLE",
      ownerId: bundleId,
      managedPrId: prId,
      developerClonePath: clone,
      operationKind: "REVIEW",
      worktreeId,
      configuredRoot: path.join(root, "worktrees"),
      rootRevision: 1,
      canonicalPath: worktree,
      sourceRepository: original.input.pullRequest.baseRepository,
      refs: {
        baseRepository: original.input.pullRequest.baseRepository,
        headRepository: original.input.pullRequest.headRepository,
        baseBranch: "main",
        headBranch: "saved-change",
        prBaseSha: baseline,
        prHeadSha: baseline,
      },
      shaSnapshot: {
        prBaseSha: baseline,
        prHeadSha: baseline,
        worktreeBaselineSha: baseline,
      },
      initialBaselineSha: baseline,
      lifecycle: "ACTIVE",
    });
    await mkdir(operationRoot, { recursive: true });
    git("clone", "--no-hardlinks", clone, source);
    execFileSync("git", ["worktree", "add", "--detach", worktree, baseline], {
      cwd: source,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    await writeFile(
      path.join(worktree, "source.ts"),
      Array.from(
        { length: 300 },
        (_, i) => `export const changed${i} = ${i + 1};`,
      ).join("\n") + "\n",
    );
    const record = f18ReviewBundleRecordSchema.parse({
      ...original,
      bundleId,
      managedPrId: prId,
      operationId,
      batchId: "guarded-final-batch",
      claimId: "guarded-final-claim",
      stage: "FINAL_REVIEW",
      phase: "FINAL_RECORDED",
      createdAt: time,
      updatedAt: time,
      noImplementationChanges: false,
      nextAction: "FINAL_REVIEW",
      input: {
        ...original.input,
        bundleId,
        managedPrId: prId,
        operationId,
        batchId: "guarded-final-batch",
        claimId: "guarded-final-claim",
        remoteEventVersionIds: ["guarded-final-event"],
        pullRequest: {
          ...original.input.pullRequest,
          title: "Guarded final review with complete saved changes",
          baseSha: baseline,
          headSha: baseline,
        },
        feedback: [
          {
            ...original.input.feedback[0],
            eventVersionId: "guarded-final-event",
            sourceId: "guarded-final-comment",
          },
        ],
      },
      items: [
        {
          ...original.items[0],
          itemId: "guarded-final-item",
          eventVersionId: "guarded-final-event",
          recommendation: {
            ...original.items[0]!.recommendation,
            remoteEventVersionId: "guarded-final-event",
            disposition: "fixed",
            relatedFiles: ["source.ts"],
          },
          decision: { decision: "accepted", finalDisposition: "fixed" },
        },
      ],
      worktree: {
        operationId,
        worktreeId,
        ownerType: "REVIEW_BUNDLE",
        ownerId: bundleId,
        canonicalPath: worktree,
        rootRevision: 1,
        snapshotId: "guarded-worktree-snapshot",
        baselineSha: baseline,
        currentSha: baseline,
        stateFingerprint: "guarded-fingerprint",
        clean: false,
        complete: true,
        changedFiles: ["source.ts"],
      },
      postChangeValidation: {
        runId: "guarded-validation",
        operationId,
        requestedPhase: "post_change",
        status: "passed",
        nextAction: "FINAL_REVIEW",
        warningCodes: [],
        steps: [
          {
            stepId: "guarded-validation-step",
            kind: "BUILD",
            status: "passed",
            exitCode: 0,
          },
        ],
        version: 1,
      },
      draftResponses: [],
    });
    reviews.persistIntent({
      record,
      events: [
        {
          id: "guarded-final-event",
          managedPrId: prId,
          sourceKind: "REVIEW_COMMENT",
          sourceId: "guarded-final-comment",
          observedAt: time,
          semanticHash: "guarded-final-hash",
          payload: { schemaVersion: 1 },
        },
      ],
    });

    const prs = new F07PersistenceRepositories(store);
    const rows: F24ResolutionRow[] = [1, 2].map((index) => {
      const pr = prs.getManagedPr(`shell-pr-${index}`);
      if (!pr || !pr.headRepository.available)
        throw Error("GUARDED_SYNC_PR_MISSING");
      return {
        schemaVersion: 1,
        managedPrId: pr.id,
        configurationRevisionId: pr.configuration.revisionId,
        configurationRevision: pr.configuration.revision,
        inboxProjectionRevision: 1,
        sourceProvenance: "PR_BASE_BRANCH",
        syncSourceBranch: pr.prBaseBranch,
        prHeadBranch: pr.prHeadBranch,
        sourceRepository: pr.baseRepository,
        destinationRepository: pr.headRepository,
        syncSourceSha: pr.prBaseSha,
        prHeadSha: pr.prHeadSha,
        storedPrBaseSha: pr.prBaseSha,
        storedPrHeadSha: pr.prHeadSha,
        currentPrState: "OPEN",
        currentPrMerged: false,
        observedAt: time,
        observationRevision: `guarded-observation-${index}`,
        observations: [],
        eligibility: "ELIGIBLE",
        reason: {
          schemaVersion: 1,
          code: "ELIGIBLE",
          category: "ELIGIBLE",
          what: "Exact saved branch revisions.",
          why: "These are isolated persisted fixture records.",
          nextAction: "NONE",
          retryable: false,
          correlationId: "guarded-sync",
        },
        operationId: `guarded-sync-${index}`,
      };
    });
    const capabilities = {
      canCommit: false,
      canPush: false,
      canPublish: false,
      canInvokeAi: false,
    } as const;
    const authorization: F24PreparationAuthorization = {
      schemaVersion: 1,
      kind: "SynchronizationPreparationAuthorization",
      intentId: "guarded-sync-intent",
      idempotencyKey: "guarded-sync-intent",
      resolutionRevision: "guarded-sync-resolution",
      createdAt: time,
      eligible: rows,
      skippedManagedPrIds: [],
      skipped: [],
      preparationOnly: true,
      capabilities: {
        prepareWorktree: true,
        commit: false,
        push: false,
        githubWrite: false,
        aiProvider: false,
        publication: false,
        conversationResolution: false,
      },
    };
    const results: F25SynchronizationResultReadModel[] = rows.map(
      (row, index) => {
        const operationId = row.operationId;
        if (operationId === undefined)
          throw new Error("GUARDED_OPERATION_MISSING");
        const side = (side: "SOURCE" | "DESTINATION") => ({
          schemaVersion: 1 as const,
          side,
          baseSha: row.storedPrBaseSha,
          tipSha: side === "SOURCE" ? row.syncSourceSha : row.prHeadSha,
          files: [{ path: "source.ts", kind: "modified" }],
          patchSegments: [],
          commitMetadata: [],
          evidenceHash: `guarded-${side}`,
          complete: true,
        });
        const conflictResolution = f26ConflictResolutionReadModelSchema.parse({
          schemaVersion: 1,
          status: "AMBIGUOUS",
          taskProfile: {
            snapshotId: `guarded-profile-${index}`,
            snapshotHash: "guarded-profile-hash",
            profileId: "guarded-profile",
            profileRevision: 1,
            providerId: "codex-sdk",
            modelId: "gpt-5.4-mini",
            policyId: "read-only",
            policyRevision: 1,
            configuredTurnBudget: 1,
            timeoutMs: 1000,
          },
          context: {
            schemaVersion: 1,
            sourceRepository: {
              serverId: row.sourceRepository.server.serverKey,
              owner: row.sourceRepository.owner,
              name: row.sourceRepository.name,
            },
            destinationRepository: {
              serverId: row.destinationRepository.server.serverKey,
              owner: row.destinationRepository.owner,
              name: row.destinationRepository.name,
            },
            sourceBranch: row.syncSourceBranch,
            destinationBranch: row.prHeadBranch,
            sourceSha: row.syncSourceSha,
            destinationSha: row.prHeadSha,
            mergeBaseSha: row.storedPrBaseSha,
            sourceChangeSet: side("SOURCE"),
            destinationChangeSet: side("DESTINATION"),
            conflicts: [
              {
                path: "source.ts",
                contentSegments: [
                  {
                    index: 0,
                    total: 1,
                    text: "<<<<<<< source\nkeep source\n=======\nkeep PR\n>>>>>>> PR\n",
                  },
                ],
                contentComplete: true,
              },
            ],
            pullRequest: {
              managedPrId: row.managedPrId,
              title: `Guarded synchronization result ${index + 1}`,
            },
            intent: { commonInstructions: [] },
            missingContext: [],
          },
          consultationHistory: [
            {
              id: `guarded-question-${index}`,
              kind: "USER_QUESTION",
              createdAt: time,
              paths: ["source.ts"],
              competingIntents: [
                "Keep the source behavior.",
                "Keep the PR behavior.",
              ],
              question: `Which behavior should result ${index + 1} keep?`,
            },
          ],
          turnHistory: [],
          usage: {
            providerInvoked: false,
            turns: 0,
            tokens: 26,
            inputTokens: 17,
            outputTokens: 9,
            totalTokens: 26,
            unavailable: false,
          },
          nextAction: "ANSWER_USER",
          updatedAt: time,
        });
        return {
          schemaVersion: 1,
          kind: "synchronization-result",
          operationId,
          batchId: "guarded-sync-batch",
          managedPrId: row.managedPrId,
          status: "NEEDS_ATTENTION",
          stage: "ATTENTION",
          mergeOutcome: "CONFLICT_DETECTED",
          input: {
            schemaVersion: 1,
            authorizationId: "guarded-sync-authorization",
            intentId: authorization.intentId,
            idempotencyKey: authorization.idempotencyKey,
            resolutionRevision: authorization.resolutionRevision,
            operationId,
            row,
            capturedAt: time,
          },
          conflicts: [{ path: "source.ts" }],
          conflictResolution,
          aiUsage: { providerInvoked: false, turns: 0, tokens: 0 },
          reason: {
            code: "USER_INTENT_REQUIRED",
            what: `Result ${index + 1} needs a human answer.`,
            why: "The two branch intentions differ.",
            nextAction: "MANUAL_RESOLUTION",
            correlationId: "guarded-sync",
          },
          nextAction: "MANUAL_RESOLUTION",
          capabilities,
          version: 1,
          createdAt: time,
          updatedAt: time,
        };
      },
    );
    const batch: F25SynchronizationBatchReadModel = {
      schemaVersion: 1,
      kind: "synchronization-batch",
      batchId: "guarded-sync-batch",
      authorizationId: "guarded-sync-authorization",
      intentId: authorization.intentId,
      idempotencyKey: authorization.idempotencyKey,
      resolutionRevision: authorization.resolutionRevision,
      status: "NEEDS_ATTENTION",
      authorization,
      operationIds: results.map((r) => r.operationId),
      counts: {
        total: 2,
        eligible: 2,
        skipped: 0,
        ready: 0,
        attention: 2,
        failed: 0,
        pending: 0,
      },
      results,
      capabilities,
      version: 1,
      createdAt: time,
      updatedAt: time,
    };
    new F25PersistenceRepositories(repositories).persistAdmission({
      batch,
      results,
    });
  } finally {
    store.close();
  }
}

/** Simulates persisted completion while the renderer is on another destination. */
export async function advanceGuardedResult(userData: string) {
  const store = await initializePersistence({
    databasePath: path.join(userData, "database/prmonitor.sqlite"),
    backupRoot: path.join(userData, "backups"),
  });
  try {
    const results = new F25PersistenceRepositories(
      createPersistenceRepositories(store),
    );
    const current = results.getResult("guarded-sync-1");
    if (!current) throw Error("GUARDED_RESULT_MISSING");
    results.putResult(
      {
        ...current,
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
        reason: { ...current.reason, what: "Saved result updated while away." },
      },
      current.version,
    );
  } finally {
    store.close();
  }
}

export async function readRetainedWork(userData: string) {
  const store = await initializePersistence({
    databasePath: path.join(userData, "database/prmonitor.sqlite"),
    backupRoot: path.join(userData, "backups"),
  });
  try {
    const repositories = createPersistenceRepositories(store);
    return {
      reviews: ["setup-saved-review", "guarded-final-review"].map((id) =>
        new F18PersistenceRepositories(repositories).get(id),
      ),
      results: new F25PersistenceRepositories(repositories).listResults(),
      shutdown: new F19PersistenceRepositories(store).getShutdownIntent(),
      worktree: new F13PersistenceRepositories(store).getOperation(
        "guarded-review-operation",
      ),
    };
  } finally {
    store.close();
  }
}

export async function installerData(userData: string, seed: boolean) {
  const store = await initializePersistence({
    databasePath: path.join(userData, "database/prmonitor.sqlite"),
    backupRoot: path.join(userData, "backups"),
  });
  try {
    const repository = createPersistenceRepositories(store);
    if (seed)
      repository.putSetting("installer-acceptance-retained", {
        owner: "installer-acceptance",
        savedWork: ["review-history", "sync-history"],
        context:
          "Keep this saved configuration across installation and upgrade.",
      });
    return repository.getSetting("installer-acceptance-retained");
  } finally {
    store.close();
  }
}

/** A fixed historical approval/outcome fixture; creates no external effects. */
export async function seedUncertainPublication(
  userData: string,
  value: unknown,
) {
  const candidate = f23CandidateSchema.parse(value);
  const store = await initializePersistence({
    databasePath: path.join(userData, "database/prmonitor.sqlite"),
    backupRoot: path.join(userData, "backups"),
  });
  try {
    const repository = createPersistenceRepositories(store);
    const approvalId = "guarded-historical-approval";
    repository.saveApproval({
      approvalId,
      scope: "REVIEW_BUNDLE",
      reviewedSnapshotHash: candidate.candidateHash,
      payload: {
        owner: "acceptance-fixture",
        candidateHash: candidate.candidateHash,
        completeDiffAcknowledged: true,
      },
    });
    const payload = {
      candidate,
      responsePlan: [],
      approvedAt: new Date().toISOString(),
      completeDiffAcknowledged: true,
      unattributedChangesAcknowledged: true,
      commitAttemptStarted: true,
      recoveryEffect: "COMMIT",
    };
    const intent = repository.createPublicationIntent({
      id: "guarded-historical-publication",
      kind: "REVIEW_BUNDLE",
      ownerId: "guarded-final-review",
      approvalId,
      idempotencyKey: "guarded-historical-publication",
      expectedBaselineSha: candidate.baselineSha,
      expectedHeadSha: candidate.expectedHeadSha,
      proposedResult: candidate,
      payload,
    });
    repository.updatePublicationIntent({
      publicationId: intent.id,
      expectedVersion: intent.version,
      phase: "RECOVERING",
      recoveryState: "RECONCILIATION_REQUIRED",
      payload,
    });
  } finally {
    store.close();
  }
}
