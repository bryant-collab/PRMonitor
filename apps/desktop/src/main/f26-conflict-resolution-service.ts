import type {
  F16EffectiveAITaskSnapshot,
  F16RepositoryIdentity,
} from "../shared/f16-preferences";
import type {
  F13ProviderWorktreeHandoff,
  F13InspectionResult,
} from "../shared/f13-contracts";
import {
  f25Fingerprint,
  f25Reason,
  type F25AiUsageSummary,
  type F25ConflictHandoff,
  type F25ConflictEvidence,
  type F25Reason,
  type F25SynchronizationResultReadModel,
  type F25ValidationEvidence,
  type F25WorktreeEvidence,
} from "../shared/f25-synchronization";
import type { F25ConflictResolutionPort } from "./f25-synchronization-service";
import type { F25PersistencePort } from "./persistence/f25-repositories";
import type { ManagedPrReadModel } from "../shared/managed-pr";
import {
  f26ConflictContextSchema,
  f26ConflictResolutionReadModelSchema,
  f26CompletionGuard,
  f26RetryActionSchema,
  f26TextSegments,
  type F26ConflictContext,
  type F26ConflictResolutionReadModel,
  type F26ConsultationRecord,
  type F26NextAction,
  type F26TaskProfileEvidence,
  type F26TurnEvidence,
  type F26RetryAction,
} from "../shared/f26-conflict-resolution";
import type { AIWorkEvidenceBundle, AIWorkReadModel } from "../shared/ai-work";
import {
  outputContractForTask,
  parseAIProviderStructuredResult,
  type AIConflictResolutionResult,
} from "../shared/ai/provider-contracts";
import type { F26AIWorkAdapter, F26AIWorkResult } from "./f26-ai-work-adapter";

export interface F26ConflictResolutionServiceOptions {
  readonly persistence: F25PersistencePort;
  readonly managedPrs: {
    readonly getManagedPr: (
      managedPrId: string,
    ) => ManagedPrReadModel | undefined;
  };
  readonly f16: {
    readonly resolveTask: (input: {
      readonly taskType: "MERGE_CONFLICT_RESOLUTION";
      readonly phase: "MERGE_CONFLICT_RESOLUTION";
      readonly repository: F16RepositoryIdentity;
      readonly operationId: string;
      readonly operationWorktree: {
        readonly operationId: string;
        readonly canonicalPath: string;
        readonly rootRevision: number;
      };
      readonly prIntentContext?: string;
    }) => Promise<F16EffectiveAITaskSnapshot>;
  };
  readonly f13: {
    readonly inspectOperation: (
      operationId: string,
      ownerId: string,
      phase?: "INSPECTION" | "AFTER_AI" | "BEFORE_AI",
    ) => Promise<F13InspectionResult>;
  };
  readonly aiWork: F26AIWorkAdapter;
  readonly activity?: {
    readonly append: (input: {
      readonly correlationId: string;
      readonly operationId: string;
      readonly managedPrId: string;
      readonly reasonCode: string;
      readonly summary: string;
    }) => void;
  };
  readonly now?: () => string;
}

interface ContextParts {
  readonly context: F26ConflictContext;
  readonly managedPr: ManagedPrReadModel;
  readonly destinationRepository: F16RepositoryIdentity;
}

function repository(
  value: F25ConflictHandoff["input"]["row"]["sourceRepository"],
): F16RepositoryIdentity {
  return {
    serverId: value.server.serverKey,
    owner: value.owner ?? "unavailable",
    name: value.name ?? "unavailable",
    key: value.key,
  };
}

function segmentedText(
  value: string,
  missingContext: string[],
  missingCode: string,
) {
  try {
    return f26TextSegments(value);
  } catch {
    missingContext.push(missingCode);
    return undefined;
  }
}

function changeSet(
  evidence: NonNullable<
    F25SynchronizationResultReadModel["sourceChangeEvidence"]
  >,
  missingContext: string[] = [],
) {
  const patchSegments = segmentedText(
    evidence.patch ?? "",
    missingContext,
    `${evidence.side}_PATCH_CONTEXT_UNAVAILABLE`,
  );
  return {
    schemaVersion: 1 as const,
    side: evidence.side,
    baseSha: evidence.baseSha,
    tipSha: evidence.tipSha,
    files: evidence.files.map((file) => ({
      path: file.path,
      kind: file.kind,
      ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }),
      ...(file.statusCode === undefined ? {} : { statusCode: file.statusCode }),
    })),
    patchSegments: patchSegments ?? [],
    ...(evidence.patchHash === undefined
      ? {}
      : { patchHash: evidence.patchHash }),
    commitMetadata: (evidence.commitMetadata ?? []).map((commit) => ({
      sha: commit.sha,
      message: commit.message,
      ...(commit.author === undefined ? {} : { author: commit.author }),
      ...(commit.committedAt === undefined
        ? {}
        : { committedAt: commit.committedAt }),
    })),
    evidenceHash: evidence.evidenceHash,
    complete: evidence.complete && patchSegments !== undefined,
  };
}

function conflict(value: F25ConflictEvidence, missingContext: string[]) {
  let content = "";
  if (value.contentBase64 !== undefined) {
    try {
      content = Buffer.from(value.contentBase64, "base64").toString("utf8");
    } catch {
      missingContext.push("CONFLICT_HUNK_CONTEXT_INVALID");
    }
  } else {
    missingContext.push("CONFLICT_HUNK_CONTEXT_UNAVAILABLE");
  }
  if (value.contentComplete === false)
    missingContext.push("CONFLICT_HUNK_CONTEXT_INCOMPLETE");
  const contentSegments = segmentedText(
    content,
    missingContext,
    "CONFLICT_HUNK_CONTEXT_OVERSIZED",
  );
  return {
    path: value.path,
    ...(value.statusCode === undefined ? {} : { statusCode: value.statusCode }),
    ...(value.source === undefined ? {} : { source: value.source }),
    ...(value.destination === undefined
      ? {}
      : { destination: value.destination }),
    ...(value.mergeBase === undefined ? {} : { mergeBase: value.mergeBase }),
    ...(value.details === undefined ? {} : { details: value.details }),
    contentSegments: contentSegments ?? [],
    ...(contentSegments === undefined
      ? { contentComplete: false }
      : value.contentComplete === undefined
        ? {}
        : { contentComplete: value.contentComplete }),
  };
}

function createContext(
  result: F25SynchronizationResultReadModel,
  handoff: F25ConflictHandoff,
  managedPr: ManagedPrReadModel,
): ContextParts {
  const row = result.input.row;
  const missingContext: string[] = [];
  if (
    row.sourceRepository.available !== true ||
    row.destinationRepository.available !== true
  )
    missingContext.push("REPOSITORY_IDENTITY_INCOMPLETE");
  if (row.syncSourceSha === undefined || row.prHeadSha === undefined)
    missingContext.push("EXACT_BRANCH_SHA_UNAVAILABLE");
  if (!managedPr.configuration.context)
    missingContext.push("PR_INTENT_CONTEXT_UNAVAILABLE");
  missingContext.push("SOURCE_BRANCH_INTENT_UNAVAILABLE");
  if (!result.sourceChangeEvidence?.complete)
    missingContext.push("SOURCE_CHANGE_EVIDENCE_INCOMPLETE");
  if (!result.prHeadChangeEvidence?.complete)
    missingContext.push("DESTINATION_CHANGE_EVIDENCE_INCOMPLETE");
  if ((result.sourceChangeEvidence?.commitMetadata ?? []).length === 0)
    missingContext.push("SOURCE_COMMIT_METADATA_UNAVAILABLE");
  if ((result.prHeadChangeEvidence?.commitMetadata ?? []).length === 0)
    missingContext.push("DESTINATION_COMMIT_METADATA_UNAVAILABLE");
  const sourceRepository = repository(row.sourceRepository);
  const destinationRepository = repository(row.destinationRepository);
  const candidate = {
    schemaVersion: 1,
    sourceRepository,
    destinationRepository,
    sourceBranch: row.syncSourceBranch,
    destinationBranch: row.prHeadBranch,
    sourceSha: row.syncSourceSha ?? result.sourceChangeEvidence!.tipSha,
    destinationSha: row.prHeadSha ?? result.prHeadChangeEvidence!.tipSha,
    mergeBaseSha: handoff.mergeBaseSha,
    sourceChangeSet: changeSet(result.sourceChangeEvidence!, missingContext),
    destinationChangeSet: changeSet(
      result.prHeadChangeEvidence!,
      missingContext,
    ),
    conflicts: handoff.conflicts.map((item) => conflict(item, missingContext)),
    pullRequest: {
      managedPrId: result.managedPrId,
      canonicalUrl: managedPr.canonicalUrl,
      ...(managedPr.title === undefined ? {} : { title: managedPr.title }),
    },
    intent: {
      ...(managedPr.configuration.context === null
        ? {}
        : { prIntentContext: managedPr.configuration.context }),
      commonInstructions: [],
    },
    missingContext: [...new Set(missingContext)].sort(),
  };
  const parsed = f26ConflictContextSchema.safeParse(candidate);
  const context = parsed.success
    ? parsed.data
    : f26ConflictContextSchema.parse({
        ...candidate,
        sourceChangeSet: {
          ...candidate.sourceChangeSet,
          files: [],
          patchSegments: [],
          commitMetadata: [],
          complete: false,
        },
        destinationChangeSet: {
          ...candidate.destinationChangeSet,
          files: [],
          patchSegments: [],
          commitMetadata: [],
          complete: false,
        },
        conflicts: [],
        missingContext: [
          ...new Set([...missingContext, "CONTEXT_EVIDENCE_UNAVAILABLE"]),
        ].sort(),
      });
  return { context, managedPr, destinationRepository };
}

function profileEvidence(
  snapshot: F16EffectiveAITaskSnapshot | undefined,
  operation: AIWorkReadModel["operation"] | undefined,
): F26TaskProfileEvidence {
  const segment = operation?.segments.at(0);
  if (snapshot === undefined)
    return {
      snapshotId: "unavailable",
      snapshotHash: "unavailable",
      profileId: "unavailable",
      profileRevision: 0,
      providerId: "unavailable",
      modelId: "unavailable",
      policyId: "unavailable",
      policyRevision: 0,
      configuredTurnBudget: operation?.configuredTurnBudget ?? 3,
      timeoutMs: segment?.timeoutMs ?? 0,
    };
  return {
    snapshotId: snapshot.snapshotId,
    snapshotHash: snapshot.snapshotHash,
    profileId: snapshot.profile.profileId,
    profileRevision: snapshot.profile.revision,
    providerId: snapshot.profile.providerId,
    modelId: snapshot.profile.modelId,
    ...(snapshot.profile.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: snapshot.profile.reasoningEffort }),
    policyId: snapshot.policy.policyId,
    policyRevision: snapshot.policy.revision,
    configuredTurnBudget: operation?.configuredTurnBudget ?? 3,
    timeoutMs: segment?.timeoutMs ?? 0,
  };
}

function usage(
  readModel: AIWorkReadModel | undefined,
  snapshot: F16EffectiveAITaskSnapshot | undefined,
): F25AiUsageSummary {
  if (readModel === undefined)
    return { providerInvoked: false, turns: 0, tokens: 0, unavailable: true };
  const modelUsage = readModel.usage;
  return {
    providerInvoked: readModel.operation.consumedTurnCount > 0,
    turns: readModel.operation.consumedTurnCount,
    tokens: modelUsage.totalTokens ?? 0,
    ...(modelUsage.inputTokens === undefined
      ? {}
      : { inputTokens: modelUsage.inputTokens }),
    ...(modelUsage.outputTokens === undefined
      ? {}
      : { outputTokens: modelUsage.outputTokens }),
    ...(modelUsage.totalTokens === undefined
      ? {}
      : { totalTokens: modelUsage.totalTokens }),
    ...(modelUsage.unavailableFields === undefined ||
    modelUsage.unavailableFields.length === 0
      ? {}
      : { unavailable: true }),
    ...(snapshot === undefined
      ? {}
      : {
          providerId: snapshot.profile.providerId,
          modelId: snapshot.profile.modelId,
          profileRevision: snapshot.profile.revision,
          policyId: snapshot.policy.policyId,
        }),
  };
}

function validationEvidence(
  value: F26AIWorkResult["validation"],
): F25ValidationEvidence | undefined {
  if (value === undefined) return undefined;
  return {
    runId: value.runId,
    status: value.status,
    ...(value.problems?.[0] === undefined ? {} : { reason: value.problems[0] }),
    warnings: (value.problems ?? []).map((problem) => ({
      code: "F26_VALIDATION",
      status: value.status,
      reason: problem,
    })),
    nextAction:
      value.status === "passed" ? "NONE" : "REVIEW_VALIDATION_EVIDENCE",
    version: value.revision,
  };
}

function projectWorktree(
  handoff: F13ProviderWorktreeHandoff,
  evidence: AIWorkEvidenceBundle | undefined,
  rootRevision = 1,
): F25WorktreeEvidence {
  const currentHeadSha = evidence?.worktree.currentRevision;
  return {
    operationId: handoff.operationId,
    worktreeId: handoff.worktreeId,
    ownerId: handoff.ownerId,
    canonicalPath: handoff.canonicalPath,
    rootRevision,
    baselineSha: handoff.actualState.baselineRevision,
    ...(currentHeadSha !== undefined &&
    /^[0-9a-f]{7,64}$/iu.test(currentHeadSha)
      ? { currentHeadSha }
      : handoff.actualState.currentHeadRevision !== undefined &&
          /^[0-9a-f]{7,64}$/iu.test(handoff.actualState.currentHeadRevision)
        ? { currentHeadSha: handoff.actualState.currentHeadRevision }
        : {}),
    condition:
      evidence === undefined
        ? "STALE_OR_UNKNOWN"
        : evidence.worktree.unmergedPaths.length > 0 ||
            evidence.worktree.conflictMarkers.length > 0
          ? "MIXED_OR_OVERLAP"
          : "AI_ATTRIBUTED_ONLY",
    ...(evidence === undefined
      ? {}
      : { stateFingerprint: evidence.worktree.stateFingerprint }),
  };
}

function mapNextAction(action: F26NextAction): F25Reason["nextAction"] {
  switch (action) {
    case "NONE":
      return "NONE";
    case "ANSWER_USER":
    case "MANUAL_RESOLUTION":
      return "MANUAL_RESOLUTION";
    case "INSPECT_WORKTREE":
      return "REVIEW_VALIDATION";
    case "RETRY_RESOLUTION":
      return "RETRY";
    case "RECONCILE":
      return "RECONCILE";
  }
}

function reasonFor(
  code: string,
  status: string,
  nextAction: F26NextAction,
  operationId: string,
): F25Reason {
  const what =
    status === "RESOLVED"
      ? "AI produced an intent-preserving conflict resolution that passed deterministic completion checks."
      : status === "AMBIGUOUS"
        ? "The conflict contains competing intent that cannot be resolved safely without a user decision."
        : "AI conflict resolution did not produce a publishable deterministic result.";
  return f25Reason({
    code,
    what,
    why:
      status === "RESOLVED"
        ? "F13 confirmed the operation-owned index, conflict markers, attribution, and validation evidence; F26 never commits or publishes."
        : "F26 preserved the operation-owned worktree, immutable context, bounded AI history, and any user question for explicit follow-up.",
    nextAction: mapNextAction(nextAction),
    correlationId: `f26-${operationId}`.slice(0, 128),
  });
}

function consultation(input: {
  readonly kind: F26ConsultationRecord["kind"];
  readonly context: F26ConflictContext;
  readonly assessment?: AIConflictResolutionResult;
  readonly now: string;
  readonly exactUserAction?: string;
  readonly answer?: string;
  readonly direction?: string;
  readonly manualEditConfirmed?: boolean;
}): F26ConsultationRecord {
  return {
    id: `f26-consult-${f25Fingerprint({
      kind: input.kind,
      now: input.now,
      answer: input.answer,
      direction: input.direction,
    })}`,
    kind: input.kind,
    createdAt: input.now,
    paths: input.context.conflicts.map((item) => item.path),
    competingIntents: input.assessment?.competingIntents ?? [],
    ...(input.assessment?.possibleDirections === undefined
      ? {}
      : { possibleDirections: input.assessment.possibleDirections }),
    ...(input.assessment?.userQuestion === undefined
      ? {}
      : { question: input.assessment.userQuestion }),
    ...(input.answer === undefined ? {} : { answer: input.answer }),
    ...(input.direction === undefined ? {} : { direction: input.direction }),
    ...(input.manualEditConfirmed === undefined
      ? {}
      : { manualEditConfirmed: input.manualEditConfirmed }),
    ...(input.exactUserAction === undefined
      ? {}
      : { exactUserAction: input.exactUserAction }),
  };
}

function turnHistory(
  readModel: AIWorkReadModel | undefined,
): readonly F26TurnEvidence[] {
  return (readModel?.reports ?? []).map((report) => ({
    turnId: report.turnId,
    providerStatus: report.providerStatus,
    changedPaths: report.actualChangedFiles.map((file) => file.path),
    remainingIssues: report.remainingProblems,
    deterministicProblems: report.deterministicProblems,
    ...(report.modelClaims.approach === undefined
      ? {}
      : { approach: report.modelClaims.approach }),
    ...(report.actualCommands.length === 0
      ? {}
      : { commands: report.actualCommands }),
    ...(report.progress === undefined
      ? {}
      : { progress: report.progress.classification }),
    nextAction: report.nextAction,
    ...(report.validation === undefined
      ? {}
      : { validationStatus: report.validation.status }),
    usage: {
      providerInvoked: true,
      turns: 1,
      tokens: report.usage.totalTokens ?? 0,
      ...(report.usage.inputTokens === undefined
        ? {}
        : { inputTokens: report.usage.inputTokens }),
      ...(report.usage.outputTokens === undefined
        ? {}
        : { outputTokens: report.usage.outputTokens }),
      ...(report.usage.totalTokens === undefined
        ? {}
        : { totalTokens: report.usage.totalTokens }),
      ...(report.usage.unavailableFields?.length ? { unavailable: true } : {}),
    },
    recordedAt: report.completedAt,
  }));
}

export class F26ConflictResolutionService implements F25ConflictResolutionPort {
  private readonly now: () => string;

  public constructor(
    private readonly options: F26ConflictResolutionServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async resolve(input: {
    readonly result: F25SynchronizationResultReadModel;
    readonly handoff: F25ConflictHandoff;
    readonly signal?: AbortSignal;
  }): Promise<Awaited<ReturnType<F25ConflictResolutionPort["resolve"]>>> {
    const managedPr = this.options.managedPrs.getManagedPr(
      input.result.managedPrId,
    );
    if (managedPr === undefined)
      return this.attentionWithoutAI(
        input.result,
        input.handoff,
        "F26_MANAGED_PR_MISSING",
      );
    const parts = createContext(input.result, input.handoff, managedPr);
    if (
      parts.context.missingContext.includes("REPOSITORY_IDENTITY_INCOMPLETE") ||
      parts.context.missingContext.includes("EXACT_BRANCH_SHA_UNAVAILABLE") ||
      parts.context.missingContext.includes("CONTEXT_EVIDENCE_UNAVAILABLE") ||
      parts.context.missingContext.some((value) =>
        /^(?:SOURCE|DESTINATION)_PATCH_CONTEXT_|^CONFLICT_HUNK_CONTEXT_/u.test(
          value,
        ),
      )
    )
      return this.attentionWithoutAI(
        input.result,
        input.handoff,
        "F26_CONTEXT_EVIDENCE_UNAVAILABLE",
        parts.context,
      );
    let taskSnapshot: F16EffectiveAITaskSnapshot;
    try {
      taskSnapshot = await this.options.f16.resolveTask({
        taskType: "MERGE_CONFLICT_RESOLUTION",
        phase: "MERGE_CONFLICT_RESOLUTION",
        repository: parts.destinationRepository,
        operationId: input.result.operationId,
        operationWorktree: {
          operationId: input.handoff.operationId,
          canonicalPath: input.handoff.worktree.canonicalPath,
          rootRevision: input.handoff.worktree.rootRevision,
        },
        ...(managedPr.configuration.context === null
          ? {}
          : { prIntentContext: managedPr.configuration.context }),
      });
    } catch {
      return this.attentionWithoutAI(
        input.result,
        input.handoff,
        "F26_TASK_CONFIGURATION_UNAVAILABLE",
        parts.context,
      );
    }
    const aiOperationId = `f26-ai-${f25Fingerprint(input.result.operationId)}`;
    let abortListener: (() => void) | undefined;
    if (input.signal !== undefined) {
      abortListener = () => {
        void this.options.aiWork.cancel(aiOperationId);
      };
      input.signal.addEventListener("abort", abortListener, { once: true });
    }
    let aiResult: F26AIWorkResult;
    try {
      aiResult = await this.options.aiWork.run({
        operationId: aiOperationId,
        f13OperationId: input.handoff.operationId,
        ownerId: input.handoff.worktree.ownerId,
        taskSnapshot,
        context: {
          ...parts.context,
          intent: {
            ...parts.context.intent,
            ...(taskSnapshot.prIntentContext === undefined
              ? {}
              : { prIntentContext: taskSnapshot.prIntentContext.text }),
            commonInstructions: taskSnapshot.commonInstructions.map(
              (instruction) => instruction.instructionText,
            ),
            ...(taskSnapshot.buildValidation?.buildInstructions === undefined
              ? {}
              : {
                  buildAndValidationInstructions:
                    taskSnapshot.buildValidation.buildInstructions,
                }),
          },
        },
        worktree: this.worktreeHandoff(input.handoff),
        configuredTurnBudget: 3,
        acknowledgeUnattributedChanges: true,
      });
    } catch {
      if (abortListener !== undefined)
        input.signal?.removeEventListener("abort", abortListener);
      return this.attentionWithoutAI(
        input.result,
        input.handoff,
        input.signal?.aborted ? "F26_AI_CANCELLED" : "F26_AI_EXECUTION_FAILED",
        parts.context,
        taskSnapshot,
        aiOperationId,
      );
    } finally {
      if (abortListener !== undefined)
        input.signal?.removeEventListener("abort", abortListener);
    }
    return this.projectOutcome({
      result: input.result,
      handoff: input.handoff,
      context: {
        ...parts.context,
        intent: {
          ...parts.context.intent,
          ...(taskSnapshot.prIntentContext === undefined
            ? {}
            : { prIntentContext: taskSnapshot.prIntentContext.text }),
          commonInstructions: taskSnapshot.commonInstructions.map(
            (instruction) => instruction.instructionText,
          ),
          ...(taskSnapshot.buildValidation?.buildInstructions === undefined
            ? {}
            : {
                buildAndValidationInstructions:
                  taskSnapshot.buildValidation.buildInstructions,
              }),
        },
      },
      taskSnapshot,
      aiOperationId,
      aiResult,
      priorHistory: [],
    });
  }

  public async retry(input: {
    readonly result: F25SynchronizationResultReadModel;
    readonly action: F26RetryAction;
    readonly expectedVersion?: number;
  }): Promise<F25SynchronizationResultReadModel> {
    const action = f26RetryActionSchema.parse(input.action);
    const prior = input.result.conflictResolution;
    if (prior === undefined || input.result.handoff === undefined)
      throw new Error("F26_RETRY_CONTEXT_MISSING");
    const createdAt = this.now();
    const actionKind =
      action.kind === "USER_ANSWER"
        ? "USER_ANSWER"
        : action.kind === "USER_DIRECTION"
          ? "USER_DIRECTION"
          : action.kind === "MANUAL_EDIT_CONFIRMED"
            ? "MANUAL_EDIT_CONFIRMED"
            : action.kind === "DISCARD"
              ? "DISCARD"
              : action.kind === "RE_EVALUATE"
                ? "RE_EVALUATE"
                : "RETRY_RESOLUTION";
    const actionRecord = consultation({
      kind: actionKind,
      context: prior.context,
      now: createdAt,
      ...(action.answer === undefined ? {} : { answer: action.answer }),
      ...(action.direction === undefined
        ? {}
        : { direction: action.direction }),
      ...(action.manualEditConfirmed === undefined
        ? {}
        : { manualEditConfirmed: action.manualEditConfirmed }),
      exactUserAction: `User explicitly confirmed ${action.kind}.`,
    });
    const history = [...prior.consultationHistory, actionRecord];
    const pending = this.saveResult(
      input.result,
      {
        status: "NEEDS_ATTENTION",
        stage: "CONFLICT_HANDOFF",
        mergeOutcome: "CONFLICT_DETECTED",
        conflictResolution: {
          ...prior,
          status: action.kind === "DISCARD" ? "NEEDS_ATTENTION" : prior.status,
          consultationHistory: history,
          nextAction:
            action.kind === "DISCARD"
              ? "MANUAL_RESOLUTION"
              : "RETRY_RESOLUTION",
          updatedAt: createdAt,
        },
        reason: reasonFor(
          action.kind === "DISCARD" ? "F26_DISCARDED" : "F26_RETRY_CONFIRMED",
          action.kind === "DISCARD" ? "NEEDS_ATTENTION" : prior.status,
          action.kind === "DISCARD" ? "MANUAL_RESOLUTION" : "RETRY_RESOLUTION",
          input.result.operationId,
        ),
        nextAction: action.kind === "DISCARD" ? "MANUAL_RESOLUTION" : "RETRY",
      },
      input.expectedVersion,
    );
    if (action.kind === "DISCARD") return pending;
    if (prior.aiOperationId === undefined) return pending;
    let priorAIWork: AIWorkReadModel;
    try {
      priorAIWork = this.options.aiWork.read(prior.aiOperationId);
    } catch {
      return pending;
    }
    if (priorAIWork.remainingBudget <= 0) return pending;
    let confirmation: ReturnType<F26AIWorkAdapter["authorizeContinuation"]>;
    try {
      confirmation = this.options.aiWork.authorizeContinuation({
        operationId: prior.aiOperationId,
        kind: "RETRY_RESOLUTION",
        selectedBudget: Math.max(
          1,
          Math.min(
            prior.taskProfile.configuredTurnBudget,
            priorAIWork.remainingBudget,
          ),
        ),
        snapshotId:
          prior.taskProfile.snapshotId === "unavailable"
            ? undefined
            : prior.taskProfile.snapshotId,
      });
    } catch {
      return pending;
    }
    const managedPr = this.options.managedPrs.getManagedPr(
      input.result.managedPrId,
    );
    if (managedPr === undefined) return pending;
    const parts = createContext(input.result, input.result.handoff, managedPr);
    const context = {
      ...parts.context,
      intent: {
        ...parts.context.intent,
        ...(prior.context.intent.prIntentContext === undefined
          ? {}
          : { prIntentContext: prior.context.intent.prIntentContext }),
        commonInstructions: [...prior.context.intent.commonInstructions],
        ...(prior.context.intent.buildAndValidationInstructions === undefined
          ? {}
          : {
              buildAndValidationInstructions:
                prior.context.intent.buildAndValidationInstructions,
            }),
        ...((action.answer ?? action.direction) === undefined
          ? {}
          : {
              resolutionGuidance:
                action.answer === undefined
                  ? `User-directed resolution: ${action.direction}`
                  : `User answer: ${action.answer}`,
            }),
        ...(action.manualEditConfirmed === undefined
          ? {}
          : { manualEditConfirmed: action.manualEditConfirmed }),
      },
    };
    let aiResult: F26AIWorkResult;
    try {
      aiResult = await this.options.aiWork.continue({
        operationId: prior.aiOperationId,
        confirmation,
        context,
      });
    } catch {
      return pending;
    }
    const taskSnapshot = this.options.aiWork.read(prior.aiOperationId).operation
      .taskSnapshot;
    const task = taskSnapshot as unknown as F16EffectiveAITaskSnapshot;
    const resolution = this.projectOutcome({
      result: input.result,
      handoff: input.result.handoff,
      context,
      taskSnapshot: task,
      aiOperationId: prior.aiOperationId,
      aiResult,
      priorHistory: history,
    });
    return this.saveResult(
      input.result,
      {
        status: resolution.status,
        stage: resolution.stage,
        mergeOutcome: resolution.mergeOutcome,
        ...(resolution.worktree === undefined
          ? {}
          : { worktree: resolution.worktree }),
        ...(resolution.validation === undefined
          ? {}
          : { validation: resolution.validation }),
        aiUsage: resolution.aiUsage,
        ...(resolution.aiOperationId === undefined
          ? {}
          : { aiOperationId: resolution.aiOperationId }),
        ...(resolution.conflictResolution === undefined
          ? {}
          : { conflictResolution: resolution.conflictResolution }),
        reason: resolution.reason,
        nextAction: resolution.nextAction,
      },
      input.expectedVersion ?? input.result.version,
    );
  }

  public async reconcileStartup(): Promise<readonly unknown[]> {
    const reconciled = await this.options.aiWork.reconcileStartup();
    for (const readModel of reconciled) {
      const result = this.options.persistence
        .listResults()
        .find(
          (candidate) =>
            candidate.aiOperationId === readModel.operation.operationId,
        );
      if (result?.handoff === undefined) continue;
      const managedPr = this.options.managedPrs.getManagedPr(
        result.managedPrId,
      );
      if (managedPr === undefined) continue;
      const context =
        result.conflictResolution?.context ??
        createContext(result, result.handoff, managedPr).context;
      const raw = readModel.reports.at(-1)?.modelClaims.semanticResult;
      const parsed =
        raw === undefined
          ? undefined
          : parseAIProviderStructuredResult(
              outputContractForTask("MERGE_CONFLICT_RESOLUTION"),
              raw,
              [],
            );
      const assessment =
        parsed?.success === true
          ? (parsed.data as AIConflictResolutionResult)
          : undefined;
      const resolution = this.projectOutcome({
        result,
        handoff: result.handoff,
        context,
        taskSnapshot: readModel.operation
          .taskSnapshot as unknown as F16EffectiveAITaskSnapshot,
        aiOperationId: readModel.operation.operationId,
        aiResult: {
          readModel,
          ...(assessment === undefined ? {} : { assessment }),
        },
        priorHistory: result.conflictResolution?.consultationHistory ?? [],
      });
      this.saveResult(result, {
        status: resolution.status,
        stage: resolution.stage,
        mergeOutcome: resolution.mergeOutcome,
        ...(resolution.worktree === undefined
          ? {}
          : { worktree: resolution.worktree }),
        ...(resolution.validation === undefined
          ? {}
          : { validation: resolution.validation }),
        aiUsage: resolution.aiUsage,
        aiOperationId: resolution.aiOperationId,
        conflictResolution: resolution.conflictResolution,
        reason: resolution.reason,
        nextAction: resolution.nextAction,
      });
    }
    return reconciled;
  }

  private worktreeHandoff(
    handoff: F25ConflictHandoff,
  ): F13ProviderWorktreeHandoff {
    return {
      schemaVersion: 1,
      operationId: handoff.operationId,
      worktreeId: handoff.worktree.worktreeId,
      ownerType: "SYNCHRONIZATION",
      ownerId: handoff.worktree.ownerId,
      operationKind: "SYNCHRONIZATION",
      canonicalPath: handoff.worktree.canonicalPath,
      access: "WORKTREE_WRITE",
      ownership: {
        kind: "OPERATION_OWNED",
        ownerType: "SYNCHRONIZATION",
        ownerId: handoff.worktree.ownerId,
      },
      actualState: {
        snapshotId: handoff.worktree.stateFingerprint ?? "f26-handoff",
        stateFingerprint: handoff.worktree.stateFingerprint ?? "f26-handoff",
        baselineRevision: handoff.worktree.baselineSha,
        expectedHeadRevision:
          handoff.worktree.currentHeadSha ?? handoff.mergeBaseSha,
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

  private saveResult(
    current: F25SynchronizationResultReadModel,
    patch: Partial<F25SynchronizationResultReadModel>,
    expectedVersion?: number,
  ): F25SynchronizationResultReadModel {
    return this.options.persistence.putResult(
      { ...current, ...patch, updatedAt: this.now() },
      expectedVersion ?? current.version,
    );
  }

  private attentionWithoutAI(
    result: F25SynchronizationResultReadModel,
    handoff: F25ConflictHandoff,
    code: string,
    context?: F26ConflictContext,
    taskSnapshot?: F16EffectiveAITaskSnapshot,
    aiOperationId?: string,
  ): Awaited<ReturnType<F25ConflictResolutionPort["resolve"]>> {
    const missingContext = ["TASK_CONFIGURATION_UNAVAILABLE"];
    const fallbackContext =
      context ??
      f26ConflictContextSchema.parse({
        schemaVersion: 1,
        sourceRepository: repository(handoff.input.row.sourceRepository),
        destinationRepository: repository(
          handoff.input.row.destinationRepository,
        ),
        sourceBranch: handoff.input.row.syncSourceBranch,
        destinationBranch: handoff.input.row.prHeadBranch,
        sourceSha:
          handoff.input.row.syncSourceSha ??
          result.sourceChangeEvidence!.tipSha,
        destinationSha:
          handoff.input.row.prHeadSha ?? result.prHeadChangeEvidence!.tipSha,
        mergeBaseSha: handoff.mergeBaseSha,
        sourceChangeSet: changeSet(
          result.sourceChangeEvidence!,
          missingContext,
        ),
        destinationChangeSet: changeSet(
          result.prHeadChangeEvidence!,
          missingContext,
        ),
        conflicts: [],
        pullRequest: { managedPrId: result.managedPrId },
        intent: { commonInstructions: [] },
        missingContext: [...new Set(missingContext)].sort(),
      });
    const profile = profileEvidence(taskSnapshot, undefined);
    const readModel: F26ConflictResolutionReadModel =
      f26ConflictResolutionReadModelSchema.parse({
        schemaVersion: 1,
        status: "BLOCKED",
        ...(aiOperationId === undefined ? {} : { aiOperationId }),
        taskProfile: profile,
        context: fallbackContext,
        consultationHistory: [
          consultation({
            kind: "USER_QUESTION",
            context: fallbackContext,
            now: this.now(),
            exactUserAction:
              "Configure the declared Merge Conflict Resolution task before retrying.",
          }),
        ],
        turnHistory: [],
        usage: {
          providerInvoked: false,
          turns: 0,
          tokens: 0,
          unavailable: true,
        },
        nextAction: "RETRY_RESOLUTION",
        updatedAt: this.now(),
      });
    this.options.activity?.append({
      correlationId: `f26-${result.operationId}`,
      operationId: result.operationId,
      managedPrId: result.managedPrId,
      reasonCode: code,
      summary:
        "Conflict resolution needs explicit follow-up before publication.",
    });
    return {
      status: "NEEDS_ATTENTION",
      stage: "ATTENTION",
      mergeOutcome: "CONFLICT_DETECTED",
      worktree: result.worktree,
      aiUsage: {
        providerInvoked: false,
        turns: 0,
        tokens: 0,
        unavailable: true,
      },
      ...(aiOperationId === undefined ? {} : { aiOperationId }),
      conflictResolution: readModel,
      reason: reasonFor(
        code,
        "BLOCKED",
        "RETRY_RESOLUTION",
        result.operationId,
      ),
      nextAction: "RETRY",
    };
  }

  private projectOutcome(input: {
    readonly result: F25SynchronizationResultReadModel;
    readonly handoff: F25ConflictHandoff;
    readonly context: F26ConflictContext;
    readonly taskSnapshot: F16EffectiveAITaskSnapshot;
    readonly aiOperationId: string;
    readonly aiResult: F26AIWorkResult;
    readonly priorHistory: readonly F26ConsultationRecord[];
  }): Awaited<ReturnType<F25ConflictResolutionPort["resolve"]>> {
    const report = input.aiResult.readModel.reports.at(-1);
    const evidence = input.aiResult.evidence;
    const assessment = input.aiResult.assessment;
    const validation = validationEvidence(input.aiResult.validation);
    const guard = f26CompletionGuard({
      providerStatus: report?.providerStatus ?? "missing",
      assessment,
      worktree: {
        complete: evidence?.worktree.complete ?? false,
        forbiddenMutation: evidence?.worktree.forbiddenMutation ?? true,
        unmergedPaths: evidence?.worktree.unmergedPaths ?? [],
        conflictMarkers: evidence?.worktree.conflictMarkers ?? [],
        attributionComplete: input.aiResult.attributionComplete ?? false,
        expectedHeadRevision: input.handoff.worktree.currentHeadSha,
        currentHeadRevision: evidence?.worktree.currentRevision,
      },
      validation:
        input.aiResult.validation === undefined
          ? undefined
          : {
              status: input.aiResult.validation.status,
              complete: input.aiResult.validation.complete,
              noSafeCommand: input.aiResult.validation.noSafeCommand,
            },
      checkedAt: this.now(),
      evidenceHash: evidence?.evidenceRevision ?? "f26-evidence-missing",
    });
    const consultationHistory = [...input.priorHistory];
    if (assessment?.status === "ambiguous")
      consultationHistory.push(
        consultation({
          kind: "AMBIGUITY_ANALYSIS",
          context: input.context,
          assessment,
          now: this.now(),
          exactUserAction:
            "Answer the recorded question or provide explicit resolution direction.",
        }),
      );
    const resolution: F26ConflictResolutionReadModel =
      f26ConflictResolutionReadModelSchema.parse({
        schemaVersion: 1,
        status: guard.status,
        aiOperationId: input.aiOperationId,
        taskProfile: profileEvidence(
          input.taskSnapshot,
          input.aiResult.readModel.operation,
        ),
        context: input.context,
        ...(assessment === undefined ? {} : { assessment }),
        completion: guard.completion,
        consultationHistory,
        turnHistory: turnHistory(input.aiResult.readModel),
        usage: usage(input.aiResult.readModel, input.taskSnapshot),
        nextAction: guard.nextAction,
        updatedAt: this.now(),
      });
    this.options.activity?.append({
      correlationId: `f26-${input.result.operationId}`,
      operationId: input.result.operationId,
      managedPrId: input.result.managedPrId,
      reasonCode: guard.reasonCode,
      summary:
        guard.status === "RESOLVED"
          ? "Conflict resolution passed deterministic checks and is reviewable for publication."
          : "Conflict resolution needs explicit follow-up; publication remains blocked.",
    });
    return {
      status: guard.ready ? "READY_TO_PUBLISH" : "NEEDS_ATTENTION",
      stage: guard.ready ? "COMPLETED" : "ATTENTION",
      mergeOutcome: guard.mergeOutcome,
      worktree:
        evidence === undefined
          ? input.result.worktree
          : projectWorktree(
              this.worktreeHandoff(input.handoff),
              evidence,
              input.handoff.worktree.rootRevision,
            ),
      ...(validation === undefined ? {} : { validation }),
      aiUsage: usage(input.aiResult.readModel, input.taskSnapshot),
      aiOperationId: input.aiOperationId,
      conflictResolution: resolution,
      reason: reasonFor(
        guard.reasonCode,
        guard.status,
        guard.nextAction,
        input.result.operationId,
      ),
      nextAction: mapNextAction(guard.nextAction),
    };
  }
}
