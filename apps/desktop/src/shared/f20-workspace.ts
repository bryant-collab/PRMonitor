import { z } from "zod";
import {
  f18AiWorkSummarySchema,
  f18BundleItemSchema,
  f18FeedbackSnapshotSchema,
  f18ItemDecisionSchema,
  f18ReviewBundleReadModelSchema,
  f18WorktreeConditionSchema,
  type F18BundleItem,
  type F18ReviewBundleReadModel,
  type F18WorktreeCondition,
} from "./f18-automatic-review";
import type {
  F13DiffEvidence,
  F13FileEvidence,
  F13InspectionResult,
  F13PathAction,
  F13WorktreeCondition,
} from "./f13-contracts";

/**
 * F20 is a renderer-facing projection, not a second workflow state machine.
 * All values in this module are bounded, serializable, and provider-neutral.
 */
export const F20_SCHEMA_VERSION = 1 as const;
export const F20_MAX_TEXT = 64 * 1024;
export const F20_MAX_DIFF_BYTES = 384 * 1024;
export const F20_MAX_DIFF_LINES = 20_000;
export const F20_MAX_VALIDATION_OUTPUT_BYTES = 64 * 1024;

const identifierSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/u);
const pathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine(
    (value) =>
      !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(value) &&
      !value.split(/[\\/]/u).includes(".."),
  );
const absolutePathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine((value) => /^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(value));
const boundedTextSchema = z.string().max(F20_MAX_TEXT);
const nonEmptyTextSchema = z.string().min(1).max(F20_MAX_TEXT);

export const f20DiffModeSchema = z.enum([
  "RELEVANT",
  "PROPOSED_WORKTREE",
  "PR_CONTEXT",
]);
export type F20DiffMode = z.infer<typeof f20DiffModeSchema>;

export const f20ActionIdSchema = z.enum([
  "ACCEPT_RECOMMENDATION",
  "OVERRIDE_RECOMMENDATION",
  "ANSWER_QUESTION",
  "CONFIRM_DECISIONS",
  "SAVE_RESPONSE_DRAFT",
  "OPEN_WORKTREE",
  "COPY_WORKTREE_PATH",
  "OPEN_FILE",
  "REVEAL_FILE",
  "REFRESH_WORKTREE",
  "INSPECT_CHANGES",
  "CONTINUE_AI_WORK",
  "RECONCILE",
  "REVIEW_CONVERSATION",
  "REQUEST_REVISION",
  "DISCARD",
  "RE_EVALUATE",
  "PUBLISH",
  "RELOAD",
]);
export type F20ActionId = z.infer<typeof f20ActionIdSchema>;

export const f20DecisionDispositionSchema = z.enum([
  "fixed",
  "pushback",
  "question",
  "no_change",
]);
export type F20DecisionDisposition = z.infer<
  typeof f20DecisionDispositionSchema
>;

export const f20ActionCapabilitySchema = z
  .object({
    id: f20ActionIdSchema,
    label: nonEmptyTextSchema,
    enabled: z.boolean(),
    reasonCode: identifierSchema.optional(),
    explanation: nonEmptyTextSchema,
  })
  .strict();
export type F20ActionCapability = z.infer<typeof f20ActionCapabilitySchema>;

export const f20StatePresentationSchema = z
  .object({
    label: nonEmptyTextSchema,
    semantic: z.enum(["READY", "ATTENTION", "WORKING"]),
    what: nonEmptyTextSchema,
    why: nonEmptyTextSchema,
    nextAction: identifierSchema,
    preservedEvidence: z.array(nonEmptyTextSchema).max(16),
  })
  .strict();
export type F20StatePresentation = z.infer<typeof f20StatePresentationSchema>;

export const f20ValidationStepSchema = z
  .object({
    stepId: identifierSchema,
    kind: identifierSchema,
    configuredPhase: identifierSchema.optional(),
    executedPhase: z.enum(["baseline", "post_change"]).optional(),
    status: identifierSchema,
    reason: identifierSchema.optional(),
    command: z
      .object({
        executable: boundedTextSchema.optional(),
        arguments: z.array(boundedTextSchema).max(256).optional(),
      })
      .strict()
      .optional(),
    workingDirectory: absolutePathSchema.optional(),
    startedAt: boundedTextSchema.optional(),
    completedAt: boundedTextSchema.optional(),
    exitCode: z.number().int().nullable().optional(),
    signal: boundedTextSchema.nullable().optional(),
    stdout: boundedTextSchema.optional(),
    stderr: boundedTextSchema.optional(),
    manualLabel: boundedTextSchema.optional(),
  })
  .strict();
export type F20ValidationStep = z.infer<typeof f20ValidationStepSchema>;

export const f20ValidationProjectionSchema = z
  .object({
    runId: identifierSchema,
    operationId: identifierSchema,
    phase: z.enum(["baseline", "post_change", "both"]),
    status: z.enum(["passed", "failed", "not_run", "running", "interrupted"]),
    reason: identifierSchema.optional(),
    nextAction: identifierSchema,
    startedAt: boundedTextSchema,
    completedAt: boundedTextSchema.optional(),
    snapshot: z
      .object({
        snapshotId: identifierSchema,
        baselineRevision: boundedTextSchema,
        currentRevision: boundedTextSchema.optional(),
      })
      .strict()
      .optional(),
    steps: z.array(f20ValidationStepSchema).max(512),
    manualAttestations: z
      .array(
        z
          .object({
            checkId: identifierSchema,
            outcome: identifierSchema,
            timestamp: boundedTextSchema,
          })
          .strict(),
      )
      .max(128),
    warningCodes: z.array(identifierSchema).max(64),
  })
  .strict();
export type F20ValidationProjection = z.infer<
  typeof f20ValidationProjectionSchema
>;

export const f20ConfigurationSnapshotSchema = z
  .object({
    taskType: identifierSchema,
    providerId: identifierSchema.optional(),
    modelId: identifierSchema.optional(),
    reasoningEffort: identifierSchema.optional(),
    profileId: identifierSchema.optional(),
    profileRevision: z.number().int().nonnegative().optional(),
    policyId: identifierSchema.optional(),
    policyRevision: z.number().int().nonnegative().optional(),
    effectivePreset: identifierSchema.optional(),
    sandboxMode: identifierSchema.optional(),
    approvalPolicy: identifierSchema.optional(),
    networkAccess: identifierSchema.optional(),
    commonInstructionIds: z.array(identifierSchema).max(32),
    prIntentContext: boundedTextSchema.optional(),
    buildValidationStatus: identifierSchema.optional(),
    zeroAiUsage: z.boolean(),
  })
  .strict();
export type F20ConfigurationSnapshot = z.infer<
  typeof f20ConfigurationSnapshotSchema
>;

export const f20DiffReferenceSchema = z
  .object({
    diffId: identifierSchema,
    diffHash: boundedTextSchema,
    patchHash: boundedTextSchema,
    baselineSha: boundedTextSchema,
    currentSha: boundedTextSchema.optional(),
    fileCount: z.number().int().nonnegative().max(2_000),
    complete: z.boolean(),
  })
  .strict();
export type F20DiffReference = z.infer<typeof f20DiffReferenceSchema>;

export const f20WorktreeProjectionSchema = z
  .object({
    operationId: identifierSchema,
    worktreeId: identifierSchema,
    canonicalPath: absolutePathSchema,
    rootRevision: z.number().int().nonnegative(),
    snapshotId: identifierSchema,
    stateFingerprint: boundedTextSchema,
    worktreeBaselineSha: boundedTextSchema,
    currentSha: boundedTextSchema.optional(),
    prBaseSha: boundedTextSchema,
    prHeadSha: boundedTextSchema,
    changedFiles: z.array(pathSchema).max(2_000),
    proposedDiff: f20DiffReferenceSchema.optional(),
    contextDiff: f20DiffReferenceSchema.optional(),
    condition: f18WorktreeConditionSchema.optional(),
  })
  .strict();
export type F20WorktreeProjection = z.infer<typeof f20WorktreeProjectionSchema>;

export const f20WorkspaceItemSchema = z
  .object({
    itemId: identifierSchema,
    eventVersionId: identifierSchema,
    order: z.number().int().nonnegative(),
    feedback: f18FeedbackSnapshotSchema,
    recommendation: f18BundleItemSchema.shape.recommendation,
    decision: f18ItemDecisionSchema,
    decisionStatus: z.enum([
      "UNDECIDED",
      "ACCEPTED",
      "OVERRIDDEN",
      "QUESTION_NEEDS_ANSWER",
    ]),
    questionAnswerRequired: z.boolean(),
    relatedFiles: z.array(pathSchema).max(128),
    proposedResponse: boundedTextSchema.optional(),
    responseDraft: boundedTextSchema.optional(),
    responseDraftSource: z.enum(["MODEL_PROPOSAL", "HUMAN_DRAFT"]).optional(),
  })
  .strict();
export type F20WorkspaceItem = z.infer<typeof f20WorkspaceItemSchema>;

export const f20WorkspaceReadModelSchema = z
  .object({
    schemaVersion: z.literal(F20_SCHEMA_VERSION),
    kind: z.literal("REVIEW_BUNDLE_WORKSPACE"),
    bundleId: identifierSchema,
    managedPrId: identifierSchema,
    batchId: identifierSchema,
    operationId: identifierSchema,
    pullRequest: f18ReviewBundleReadModelSchema.shape.input.shape.pullRequest,
    stage: z.enum(["PROPOSAL_REVIEW", "FINAL_REVIEW"]),
    state: z.enum(["WORKING", "READY_FOR_REVIEW", "NEEDS_ATTENTION"]),
    phase: identifierSchema,
    version: z.number().int().nonnegative(),
    evidenceRevision: z.number().int().nonnegative(),
    statePresentation: f20StatePresentationSchema,
    itemCount: z.number().int().nonnegative().max(256),
    items: z.array(f20WorkspaceItemSchema).max(256),
    decisionSummary: f18ReviewBundleReadModelSchema.shape.decisionSummary,
    draftResponses: z
      .array(
        z
          .object({
            eventVersionId: identifierSchema,
            text: nonEmptyTextSchema,
            source: z.enum(["MODEL_PROPOSAL", "HUMAN_DRAFT"]),
          })
          .strict(),
      )
      .max(256),
    baselineValidation: f20ValidationProjectionSchema.optional(),
    postChangeValidation: f20ValidationProjectionSchema.optional(),
    proposalWork: f18AiWorkSummarySchema.optional(),
    implementationWork: f18AiWorkSummarySchema.optional(),
    configuration: f20ConfigurationSnapshotSchema,
    worktree: f20WorktreeProjectionSchema.optional(),
    diffReferences: z
      .object({
        relevantAvailable: z.boolean(),
        proposedWorktree: f20DiffReferenceSchema.optional(),
        prContext: f20DiffReferenceSchema.optional(),
      })
      .strict(),
    actions: z.array(f20ActionCapabilitySchema).max(32),
    authority: z
      .object({
        bundle: z.literal("F18_DURABLE"),
        decisions: z.literal("F18_DURABLE"),
        diff: z.literal("F13_DETERMINISTIC"),
        validation: z.literal("F14_DETERMINISTIC"),
        aiLifecycle: z.literal("F17_DETERMINISTIC"),
        publication: z.literal("F23_ONLY"),
      })
      .strict(),
  })
  .strict();
export type F20WorkspaceReadModel = z.infer<typeof f20WorkspaceReadModelSchema>;

export const f20DiffLineSchema = z
  .object({
    lineId: identifierSchema,
    kind: z.enum([
      "META",
      "FILE_HEADER",
      "HUNK_HEADER",
      "CONTEXT",
      "ADDITION",
      "REMOVAL",
    ]),
    text: boundedTextSchema,
    oldLine: z.number().int().positive().optional(),
    newLine: z.number().int().positive().optional(),
  })
  .strict();
export type F20DiffLine = z.infer<typeof f20DiffLineSchema>;

export const f20DiffHunkSchema = z
  .object({
    hunkId: identifierSchema,
    header: nonEmptyTextSchema,
    oldStart: z.number().int().nonnegative().optional(),
    oldCount: z.number().int().nonnegative().optional(),
    newStart: z.number().int().nonnegative().optional(),
    newCount: z.number().int().nonnegative().optional(),
    lines: z.array(f20DiffLineSchema).max(F20_MAX_DIFF_LINES),
  })
  .strict();
export type F20DiffHunk = z.infer<typeof f20DiffHunkSchema>;

export const f20DiffFileSchema = z
  .object({
    path: pathSchema,
    oldPath: pathSchema.optional(),
    kind: z.enum([
      "modified",
      "added",
      "deleted",
      "renamed",
      "copied",
      "untracked",
      "ignored",
      "type_changed",
      "unknown",
    ]),
    marker: z.enum([
      "MODIFIED",
      "NEW",
      "DELETED",
      "RENAMED",
      "BINARY",
      "UNTRACKED",
      "UNKNOWN",
    ]),
    binary: z.boolean(),
    syntax: identifierSchema,
    sizeBytes: z.number().int().nonnegative().optional(),
    hunks: z.array(f20DiffHunkSchema).max(F20_MAX_DIFF_LINES),
  })
  .strict();
export type F20DiffFile = z.infer<typeof f20DiffFileSchema>;

export const f20DiffViewSchema = z
  .object({
    schemaVersion: z.literal(F20_SCHEMA_VERSION),
    kind: z.literal("REVIEW_BUNDLE_DIFF_VIEW"),
    bundleId: identifierSchema,
    operationId: identifierSchema,
    mode: f20DiffModeSchema,
    authority: z.enum(["ITEM_CONTEXT", "PUBLICATION_CANDIDATE", "PR_CONTEXT"]),
    purpose: nonEmptyTextSchema,
    publicationEligible: z.boolean(),
    status: z.enum([
      "READY",
      "EMPTY",
      "MISSING",
      "UNAVAILABLE",
      "OVER_LIMIT",
      "STALE",
    ]),
    message: nonEmptyTextSchema,
    diffId: identifierSchema.optional(),
    diffHash: boundedTextSchema.optional(),
    patchHash: boundedTextSchema.optional(),
    baselineSha: boundedTextSchema.optional(),
    currentSha: boundedTextSchema.optional(),
    prBaseSha: boundedTextSchema,
    prHeadSha: boundedTextSchema,
    worktreeBaselineSha: boundedTextSchema,
    complete: z.boolean(),
    fileCount: z.number().int().nonnegative().max(2_000),
    files: z.array(f20DiffFileSchema).max(2_000),
    untrackedFiles: z.array(pathSchema).max(2_000),
    selectedItemId: identifierSchema.optional(),
    copyableText: boundedTextSchema.optional(),
  })
  .strict();
export type F20DiffView = z.infer<typeof f20DiffViewSchema>;

export const f20PathActionResultSchema = z
  .object({
    ok: z.boolean(),
    action: z.enum(["OPEN_WORKTREE", "OPEN_FILE", "REVEAL_FILE"]),
    resolvedPath: absolutePathSchema.optional(),
    reason: z
      .object({
        code: identifierSchema,
        what: nonEmptyTextSchema,
        why: nonEmptyTextSchema,
        nextAction: identifierSchema,
      })
      .strict()
      .optional(),
  })
  .strict();
export type F20PathActionResult = z.infer<typeof f20PathActionResultSchema>;

export interface F20ReadDiffInput {
  readonly bundleId: string;
  readonly mode: F20DiffMode;
  readonly itemId?: string;
}

export interface F20DecisionCommandInput {
  readonly bundleId: string;
  readonly itemId: string;
  readonly decision: "accepted" | "overridden";
  readonly finalDisposition: F20DecisionDisposition;
  readonly instruction?: string;
  readonly answer?: string;
  readonly expectedVersion?: number;
  readonly actionId?: string;
}

export interface F20ConfirmCommandInput {
  readonly bundleId: string;
  readonly expectedVersion?: number;
  readonly actionId?: string;
}

export interface F20DraftCommandInput {
  readonly bundleId: string;
  readonly eventVersionId: string;
  readonly text: string;
  readonly expectedVersion?: number;
  readonly actionId?: string;
}

export interface F20RefreshWorktreeInput {
  readonly bundleId: string;
  readonly expectedVersion?: number;
}

export interface F20PathActionInput {
  readonly bundleId: string;
  readonly action: F13PathAction;
  readonly relativePath?: string;
  readonly expectedVersion?: number;
}

function readableStatus(value: string): string {
  return value.toLowerCase().replaceAll("_", " ");
}

function statePresentation(
  model: F18ReviewBundleReadModel,
): F20StatePresentation {
  if (model.state === "NEEDS_ATTENTION") {
    const first = model.reasons[0];
    return {
      label: "NEEDS ATTENTION",
      semantic: "ATTENTION",
      what: first?.what ?? "The review bundle needs attention.",
      why:
        first?.why ??
        "Deterministic evidence is preserved and the next action is gated.",
      nextAction: first?.nextAction ?? model.nextAction,
      preservedEvidence: [
        "The committed Review Bundle remains available.",
        "Stored validation, AI reports, and worktree references remain inspectable.",
      ],
    };
  }
  if (model.state === "WORKING") {
    return {
      label: "WORKING",
      semantic: "WORKING",
      what: "PRMonitor is completing the Review Bundle workflow.",
      why: "The main process owns the operation and the renderer is read-only.",
      nextAction: model.nextAction,
      preservedEvidence: [
        "The latest committed evidence revision is shown below.",
      ],
    };
  }
  return {
    label: "READY FOR REVIEW",
    semantic: "READY",
    what:
      model.stage === "PROPOSAL_REVIEW"
        ? "Decide each recommendation before implementation can be authorized."
        : "Inspect the complete proposed worktree diff and preserved evidence.",
    why: "The bundle is committed and waiting for the explicit next action shown below.",
    nextAction: model.nextAction,
    preservedEvidence: [
      "The Review Bundle read model is committed in the main process.",
      "Diff and validation authority remains with deterministic services.",
    ],
  };
}

function itemStatus(item: F18BundleItem): F20WorkspaceItem["decisionStatus"] {
  if (
    item.decision.decision === "pending" &&
    item.recommendation.disposition === "question"
  )
    return "QUESTION_NEEDS_ANSWER";
  if (item.decision.decision === "pending") return "UNDECIDED";
  if (
    item.decision.finalDisposition === "question" &&
    !item.decision.answer?.trim()
  )
    return "QUESTION_NEEDS_ANSWER";
  return item.decision.decision === "accepted" ? "ACCEPTED" : "OVERRIDDEN";
}

function buildAction(
  id: F20ActionId,
  enabled: boolean,
  explanation: string,
  reasonCode?: string,
): F20ActionCapability {
  return {
    id,
    label: readableStatus(id),
    enabled,
    explanation,
    ...(reasonCode === undefined ? {} : { reasonCode }),
  };
}

function actionCapabilities(
  model: F18ReviewBundleReadModel,
  hasWorktree: boolean,
): F20ActionCapability[] {
  const proposal = model.stage === "PROPOSAL_REVIEW";
  const active = model.state !== "WORKING";
  const actions = [
    buildAction(
      "ACCEPT_RECOMMENDATION",
      proposal && active,
      proposal
        ? "Accepting a recommendation records a human decision for implementation planning only; it is not publication approval."
        : "Recommendations can only be accepted during proposal review.",
      proposal && active ? undefined : "PROPOSAL_STAGE_REQUIRED",
    ),
    buildAction(
      "OVERRIDE_RECOMMENDATION",
      proposal && active,
      proposal
        ? "An override requires a final disposition and preserves the original recommendation for inspection."
        : "Overrides can only be recorded during proposal review.",
      proposal && active ? undefined : "PROPOSAL_STAGE_REQUIRED",
    ),
    buildAction(
      "CONFIRM_DECISIONS",
      proposal && active && model.decisionSummary.complete,
      model.decisionSummary.complete
        ? "Continue to implementation through the owning F18 workflow."
        : "Decide every item and answer every effective question first.",
      proposal && active && model.decisionSummary.complete
        ? undefined
        : "DECISIONS_INCOMPLETE",
    ),
    buildAction(
      "SAVE_RESPONSE_DRAFT",
      model.stage === "FINAL_REVIEW" && active,
      "Response text is saved as a draft for a later publication workflow and is never posted here.",
      model.stage === "FINAL_REVIEW" && active
        ? undefined
        : "FINAL_STAGE_REQUIRED",
    ),
    buildAction(
      "OPEN_WORKTREE",
      hasWorktree,
      hasWorktree
        ? "Open the recorded operation-owned worktree through F13."
        : "No canonical operation worktree is available.",
      hasWorktree ? undefined : "WORKTREE_UNAVAILABLE",
    ),
    buildAction(
      "COPY_WORKTREE_PATH",
      hasWorktree,
      hasWorktree
        ? "Copy the canonical operation-owned worktree path."
        : "No canonical operation worktree is available.",
      hasWorktree ? undefined : "WORKTREE_UNAVAILABLE",
    ),
    buildAction(
      "OPEN_FILE",
      hasWorktree,
      hasWorktree
        ? "Open a file recorded in the Review Bundle through F13."
        : "No operation worktree is available for file actions.",
      hasWorktree ? undefined : "WORKTREE_UNAVAILABLE",
    ),
    buildAction(
      "REVEAL_FILE",
      hasWorktree,
      hasWorktree
        ? "Reveal a file recorded in the Review Bundle through F13."
        : "No operation worktree is available for file actions.",
      hasWorktree ? undefined : "WORKTREE_UNAVAILABLE",
    ),
    buildAction(
      "REFRESH_WORKTREE",
      hasWorktree,
      hasWorktree
        ? "Request fresh F13 condition evidence."
        : "No operation worktree can be refreshed.",
      hasWorktree ? undefined : "WORKTREE_UNAVAILABLE",
    ),
    buildAction(
      "PUBLISH",
      false,
      "Publication belongs to F23 and requires a separate explicit approval workflow.",
      "F23_ONLY",
    ),
  ];
  return actions;
}

function configurationSnapshot(
  model: F18ReviewBundleReadModel,
): F20ConfigurationSnapshot {
  const task = model.input.taskSnapshot;
  if (task === undefined)
    return {
      taskType: "DETERMINISTIC",
      commonInstructionIds: [],
      zeroAiUsage: true,
    };
  return {
    taskType: task.taskType,
    providerId: task.providerId,
    modelId: task.modelId,
    ...(task.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: task.reasoningEffort }),
    profileId: task.profileId,
    profileRevision: task.profileRevision,
    policyId: task.policyId,
    policyRevision: task.policyRevision,
    effectivePreset: task.effectivePreset,
    sandboxMode: task.sandboxMode,
    approvalPolicy: task.approvalPolicy,
    networkAccess: task.networkAccess,
    commonInstructionIds: task.commonInstructionIds,
    ...(model.input.contextText === undefined
      ? {}
      : { prIntentContext: model.input.contextText }),
    ...(task.validationStatus === undefined
      ? {}
      : { buildValidationStatus: task.validationStatus }),
    zeroAiUsage: false,
  };
}

export function projectReviewBundleWorkspace(input: {
  readonly readModel: F18ReviewBundleReadModel;
  readonly baselineValidation?: F20ValidationProjection;
  readonly postChangeValidation?: F20ValidationProjection;
  readonly worktreeCondition?: F13WorktreeCondition;
}): F20WorkspaceReadModel {
  const model = f18ReviewBundleReadModelSchema.parse(input.readModel);
  const feedbackByEvent = new Map(
    model.input.feedback.map((feedback) => [feedback.eventVersionId, feedback]),
  );
  const draftsByEvent = new Map(
    model.draftResponses.map((draft) => [draft.eventVersionId, draft]),
  );
  const items = model.items.map((item, order) => {
    const feedback = feedbackByEvent.get(item.eventVersionId);
    if (feedback === undefined)
      throw new Error("F20_FEEDBACK_SNAPSHOT_MISSING");
    const draft = draftsByEvent.get(item.eventVersionId);
    const answerRequired =
      (item.decision.decision !== "pending" &&
        item.decision.finalDisposition === "question") ||
      (item.decision.decision === "pending" &&
        item.recommendation.disposition === "question");
    return {
      itemId: item.itemId,
      eventVersionId: item.eventVersionId,
      order,
      feedback,
      recommendation: item.recommendation,
      decision: item.decision,
      decisionStatus: itemStatus(item),
      questionAnswerRequired: answerRequired,
      relatedFiles: item.recommendation.relatedFiles,
      ...(item.recommendation.proposedReply === undefined
        ? {}
        : { proposedResponse: item.recommendation.proposedReply }),
      ...(draft === undefined ? {} : { responseDraft: draft.text }),
      ...(draft === undefined ? {} : { responseDraftSource: draft.source }),
    };
  });
  const worktree =
    model.worktree === undefined
      ? undefined
      : {
          operationId: model.worktree.operationId,
          worktreeId: model.worktree.worktreeId,
          canonicalPath: model.worktree.canonicalPath,
          rootRevision: model.worktree.rootRevision,
          snapshotId: model.worktree.snapshotId,
          stateFingerprint: model.worktree.stateFingerprint,
          worktreeBaselineSha: model.worktree.baselineSha,
          ...(model.worktree.currentSha === undefined
            ? {}
            : { currentSha: model.worktree.currentSha }),
          prBaseSha: model.input.pullRequest.baseSha,
          prHeadSha: model.input.pullRequest.headSha,
          changedFiles: model.worktree.changedFiles,
          ...(model.worktree.proposedDiff === undefined
            ? {}
            : { proposedDiff: model.worktree.proposedDiff }),
          ...(model.worktree.contextDiff === undefined
            ? {}
            : { contextDiff: model.worktree.contextDiff }),
          ...(input.worktreeCondition === undefined
            ? model.worktree.condition === undefined
              ? {}
              : { condition: model.worktree.condition }
            : { condition: input.worktreeCondition }),
        };
  const result = {
    schemaVersion: F20_SCHEMA_VERSION,
    kind: "REVIEW_BUNDLE_WORKSPACE" as const,
    bundleId: model.bundleId,
    managedPrId: model.managedPrId,
    batchId: model.batchId,
    operationId: model.operationId,
    pullRequest: model.input.pullRequest,
    stage: model.stage,
    state: model.state,
    phase: model.phase,
    version: model.version,
    evidenceRevision: model.version,
    statePresentation: statePresentation(model),
    itemCount: items.length,
    items,
    decisionSummary: model.decisionSummary,
    draftResponses: model.draftResponses,
    ...(input.baselineValidation === undefined
      ? {}
      : { baselineValidation: input.baselineValidation }),
    ...(input.postChangeValidation === undefined
      ? {}
      : { postChangeValidation: input.postChangeValidation }),
    ...(model.proposalWork === undefined
      ? {}
      : { proposalWork: model.proposalWork }),
    ...(model.implementationWork === undefined
      ? {}
      : { implementationWork: model.implementationWork }),
    configuration: configurationSnapshot(model),
    ...(worktree === undefined ? {} : { worktree }),
    diffReferences: {
      relevantAvailable: items.some(
        (item) =>
          item.relatedFiles.length > 0 || item.feedback.diffHunk !== undefined,
      ),
      ...(model.worktree?.proposedDiff === undefined
        ? {}
        : { proposedWorktree: model.worktree.proposedDiff }),
      ...(model.worktree?.contextDiff === undefined
        ? {}
        : { prContext: model.worktree.contextDiff }),
    },
    actions: actionCapabilities(model, worktree !== undefined),
    authority: {
      bundle: "F18_DURABLE" as const,
      decisions: "F18_DURABLE" as const,
      diff: "F13_DETERMINISTIC" as const,
      validation: "F14_DETERMINISTIC" as const,
      aiLifecycle: "F17_DETERMINISTIC" as const,
      publication: "F23_ONLY" as const,
    },
  };
  return f20WorkspaceReadModelSchema.parse(result);
}

function syntaxFor(path: string): string {
  const extension = path.toLowerCase().split(".").pop() ?? "text";
  const aliases: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    md: "markdown",
    yml: "yaml",
    yaml: "yaml",
    css: "css",
    html: "html",
    cs: "csharp",
    py: "python",
  };
  return aliases[extension] ?? (extension || "text");
}

function markerFor(file: F13FileEvidence): F20DiffFile["marker"] {
  if (file.binary) return "BINARY";
  if (file.kind === "added") return "NEW";
  if (file.kind === "deleted") return "DELETED";
  if (file.kind === "renamed" || file.kind === "copied") return "RENAMED";
  if (file.kind === "untracked") return "UNTRACKED";
  if (file.kind === "unknown" || file.kind === "ignored") return "UNKNOWN";
  return "MODIFIED";
}

function parseHunkHeader(value: string): {
  readonly oldStart?: number;
  readonly oldCount?: number;
  readonly newStart?: number;
  readonly newCount?: number;
} {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(value);
  if (match === null) return {};
  return {
    oldStart: Number(match[1]),
    oldCount: Number(match[2] ?? 1),
    newStart: Number(match[3]),
    newCount: Number(match[4] ?? 1),
  };
}

function parsePatch(
  patch: string,
  evidenceFiles: readonly F13FileEvidence[],
): F20DiffFile[] {
  if (new TextEncoder().encode(patch).byteLength > F20_MAX_DIFF_BYTES)
    throw new Error("F20_DIFF_OVER_LIMIT");
  const lines = patch.split(/\r?\n/u);
  if (lines.length > F20_MAX_DIFF_LINES) throw new Error("F20_DIFF_OVER_LIMIT");
  const evidenceByPath = new Map<string, F13FileEvidence>();
  for (const file of evidenceFiles) evidenceByPath.set(file.path, file);
  const files: {
    path: string;
    oldPath?: string;
    kind: F13FileEvidence["kind"];
    marker: F20DiffFile["marker"];
    binary: boolean;
    sizeBytes?: number;
    hunks: F20DiffHunk[];
  }[] = [];
  let current: (typeof files)[number] | undefined;
  let hunk: F20DiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;
  let lineId = 0;
  const ensureCurrent = (path: string): (typeof files)[number] => {
    const evidence = evidenceByPath.get(path);
    const created = {
      path,
      ...(evidence?.oldPath === undefined ? {} : { oldPath: evidence.oldPath }),
      kind: evidence?.kind ?? "modified",
      marker: evidence === undefined ? "UNKNOWN" : markerFor(evidence),
      binary: evidence?.binary ?? false,
      ...(evidence?.sizeBytes === undefined
        ? {}
        : { sizeBytes: evidence.sizeBytes }),
      hunks: [],
    };
    files.push(created);
    return created;
  };
  for (const [lineIndex, raw] of lines.entries()) {
    const line = raw;
    if (lineIndex === lines.length - 1 && line.length === 0) continue;
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+) b\/(.+)$/u.exec(line);
      current = ensureCurrent(match?.[2] ?? "unknown-file");
      hunk = undefined;
      continue;
    }
    if (
      hunk === undefined &&
      (line.startsWith("index ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ") ||
        line.startsWith("new file mode ") ||
        line.startsWith("deleted file mode ") ||
        line.startsWith("similarity index ") ||
        line.startsWith("rename from ") ||
        line.startsWith("rename to ") ||
        line.startsWith("Binary files "))
    )
      continue;
    if (line.startsWith("@@ ")) {
      if (current === undefined) current = ensureCurrent("unknown-file");
      const header = parseHunkHeader(line);
      hunk = {
        hunkId: `hunk-${files.length}-${current.hunks.length + 1}`,
        header: line,
        ...header,
        lines: [],
      };
      current.hunks.push(hunk);
      oldLine = header.oldStart ?? 0;
      newLine = header.newStart ?? 0;
      continue;
    }
    if (current === undefined) {
      if (line.length === 0) continue;
      current = ensureCurrent("unknown-file");
    }
    if (hunk === undefined) {
      const metadataHunk: F20DiffHunk = {
        hunkId: `hunk-${files.length}-1`,
        header: "File metadata",
        lines: [],
      };
      current.hunks.push(metadataHunk);
      hunk = metadataHunk;
    }
    const activeHunk = hunk;
    if (activeHunk === undefined) continue;
    const prefix = line[0] ?? " ";
    const text = line.slice(1);
    const kind: F20DiffLine["kind"] =
      prefix === "+"
        ? "ADDITION"
        : prefix === "-"
          ? "REMOVAL"
          : prefix === "\\"
            ? "META"
            : "CONTEXT";
    const projected: F20DiffLine = {
      lineId: `line-${++lineId}`,
      kind,
      text: prefix === "\\" ? line : text,
      ...(kind === "REMOVAL" || kind === "CONTEXT"
        ? oldLine > 0
          ? { oldLine }
          : {}
        : {}),
      ...(kind === "ADDITION" || kind === "CONTEXT"
        ? newLine > 0
          ? { newLine }
          : {}
        : {}),
    };
    activeHunk.lines.push(projected);
    if (kind === "REMOVAL" || kind === "CONTEXT") oldLine += 1;
    if (kind === "ADDITION" || kind === "CONTEXT") newLine += 1;
  }
  return files.map((file) => ({
    path: file.path,
    ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }),
    kind: file.kind,
    marker: file.marker,
    binary: file.binary,
    syntax: syntaxFor(file.path),
    ...(file.sizeBytes === undefined ? {} : { sizeBytes: file.sizeBytes }),
    hunks: file.hunks,
  }));
}

function copyableText(files: readonly F20DiffFile[]): string {
  return files
    .flatMap((file) =>
      file.hunks.flatMap((hunk) =>
        hunk.lines.map((line) => `${line.kind}: ${line.text}`),
      ),
    )
    .join("\n");
}

function emptyDiff(input: {
  readonly bundleId: string;
  readonly operationId: string;
  readonly mode: F20DiffMode;
  readonly prBaseSha: string;
  readonly prHeadSha: string;
  readonly worktreeBaselineSha: string;
  readonly selectedItemId?: string;
  readonly status: F20DiffView["status"];
  readonly message: string;
  readonly purpose: string;
  readonly authority: F20DiffView["authority"];
  readonly publicationEligible: boolean;
}): F20DiffView {
  return f20DiffViewSchema.parse({
    schemaVersion: F20_SCHEMA_VERSION,
    kind: "REVIEW_BUNDLE_DIFF_VIEW",
    bundleId: input.bundleId,
    operationId: input.operationId,
    mode: input.mode,
    authority: input.authority,
    purpose: input.purpose,
    publicationEligible: input.publicationEligible,
    status: input.status,
    message: input.message,
    prBaseSha: input.prBaseSha,
    prHeadSha: input.prHeadSha,
    worktreeBaselineSha: input.worktreeBaselineSha,
    complete: false,
    fileCount: 0,
    files: [],
    untrackedFiles: [],
    ...(input.selectedItemId === undefined
      ? {}
      : { selectedItemId: input.selectedItemId }),
  });
}

function evidenceForMode(
  mode: Exclude<F20DiffMode, "RELEVANT">,
  inspection: F13InspectionResult,
): F13DiffEvidence | undefined {
  return mode === "PROPOSED_WORKTREE"
    ? inspection.proposedDiff
    : inspection.contextDiff;
}

export function projectDiffView(input: {
  readonly bundleId: string;
  readonly operationId: string;
  readonly mode: F20DiffMode;
  readonly inspection: F13InspectionResult;
  readonly prBaseSha: string;
  readonly prHeadSha: string;
  readonly worktreeBaselineSha: string;
  readonly selectedItemId?: string;
  readonly relatedPaths?: readonly string[];
  readonly relatedHunk?: string;
}): F20DiffView {
  const authority =
    input.mode === "RELEVANT"
      ? "ITEM_CONTEXT"
      : input.mode === "PROPOSED_WORKTREE"
        ? "PUBLICATION_CANDIDATE"
        : "PR_CONTEXT";
  const purpose =
    input.mode === "RELEVANT"
      ? "Context supplied for the selected feedback item. This is not a complete patch."
      : input.mode === "PROPOSED_WORKTREE"
        ? "The complete operation-worktree diff relative to worktreeBaselineSha. This is the only F20 diff eligible for later publication approval."
        : "The operation-worktree diff relative to prBaseSha. It includes PR context and is not publication-authoritative.";
  if (!input.inspection.ok) {
    return emptyDiff({
      bundleId: input.bundleId,
      operationId: input.operationId,
      mode: input.mode,
      prBaseSha: input.prBaseSha,
      prHeadSha: input.prHeadSha,
      worktreeBaselineSha: input.worktreeBaselineSha,
      ...(input.selectedItemId === undefined
        ? {}
        : { selectedItemId: input.selectedItemId }),
      status: "STALE",
      message:
        "F13 could not verify the current operation worktree. Inspect or refresh the worktree before relying on this evidence.",
      purpose,
      authority,
      publicationEligible: false,
    });
  }
  if (input.mode === "RELEVANT") {
    const paths = new Set(input.relatedPaths ?? []);
    const files = [
      ...(input.inspection.proposedDiff?.files ?? []),
      ...(input.inspection.proposedDiff?.untrackedEvidence ?? []),
    ].filter(
      (file) =>
        paths.has(file.path) ||
        (file.oldPath !== undefined && paths.has(file.oldPath)),
    );
    if (files.length === 0 && input.relatedHunk === undefined)
      return emptyDiff({
        bundleId: input.bundleId,
        operationId: input.operationId,
        mode: input.mode,
        prBaseSha: input.prBaseSha,
        prHeadSha: input.prHeadSha,
        worktreeBaselineSha: input.worktreeBaselineSha,
        ...(input.selectedItemId === undefined
          ? {}
          : { selectedItemId: input.selectedItemId }),
        status: "EMPTY",
        message: "No related file or hunk evidence was supplied for this item.",
        purpose,
        authority,
        publicationEligible: false,
      });
    const projected = files.map((file) => ({
      path: file.path,
      ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }),
      kind: file.kind,
      marker: markerFor(file),
      binary: file.binary ?? false,
      syntax: syntaxFor(file.path),
      ...(file.sizeBytes === undefined ? {} : { sizeBytes: file.sizeBytes }),
      hunks: [] as F20DiffHunk[],
    }));
    if (input.relatedHunk !== undefined) {
      const target = projected[0];
      if (target !== undefined)
        target.hunks.push({
          hunkId: "related-feedback-hunk",
          header: "Feedback hunk context",
          lines: input.relatedHunk.split(/\r?\n/u).map((line, index) => ({
            lineId: `related-line-${index + 1}`,
            kind: "META" as const,
            text: line,
          })),
        });
    }
    return f20DiffViewSchema.parse({
      schemaVersion: F20_SCHEMA_VERSION,
      kind: "REVIEW_BUNDLE_DIFF_VIEW",
      bundleId: input.bundleId,
      operationId: input.operationId,
      mode: input.mode,
      authority,
      purpose,
      publicationEligible: false,
      status: "READY",
      message:
        "Related evidence is contextual. Open Proposed Worktree Diff for the complete result.",
      prBaseSha: input.prBaseSha,
      prHeadSha: input.prHeadSha,
      worktreeBaselineSha: input.worktreeBaselineSha,
      complete: false,
      fileCount: projected.length,
      files: projected,
      untrackedFiles: [],
      ...(input.selectedItemId === undefined
        ? {}
        : { selectedItemId: input.selectedItemId }),
      copyableText: copyableText(projected),
    });
  }
  const diff = evidenceForMode(input.mode, input.inspection);
  if (diff === undefined)
    return emptyDiff({
      bundleId: input.bundleId,
      operationId: input.operationId,
      mode: input.mode,
      prBaseSha: input.prBaseSha,
      prHeadSha: input.prHeadSha,
      worktreeBaselineSha: input.worktreeBaselineSha,
      status: "MISSING",
      message:
        "F13 did not provide this diff reference for the operation worktree.",
      purpose,
      authority,
      publicationEligible: false,
    });
  if (
    diff.patch === undefined &&
    diff.files.length === 0 &&
    diff.untrackedFiles.length === 0
  )
    return emptyDiff({
      bundleId: input.bundleId,
      operationId: input.operationId,
      mode: input.mode,
      prBaseSha: input.prBaseSha,
      prHeadSha: input.prHeadSha,
      worktreeBaselineSha: input.worktreeBaselineSha,
      status: "EMPTY",
      message: "The verified worktree contains no changes for this diff mode.",
      purpose,
      authority,
      publicationEligible: input.mode === "PROPOSED_WORKTREE" && diff.complete,
    });
  let files: F20DiffFile[];
  try {
    files =
      diff.patch === undefined
        ? diff.files.map((file) => ({
            path: file.path,
            ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }),
            kind: file.kind,
            marker: markerFor(file),
            binary: file.binary ?? false,
            syntax: syntaxFor(file.path),
            ...(file.sizeBytes === undefined
              ? {}
              : { sizeBytes: file.sizeBytes }),
            hunks: [],
          }))
        : parsePatch(diff.patch, [
            ...diff.files,
            ...(diff.untrackedEvidence ?? []),
          ]);
  } catch (error) {
    return emptyDiff({
      bundleId: input.bundleId,
      operationId: input.operationId,
      mode: input.mode,
      prBaseSha: input.prBaseSha,
      prHeadSha: input.prHeadSha,
      worktreeBaselineSha: input.worktreeBaselineSha,
      status:
        error instanceof Error && error.message === "F20_DIFF_OVER_LIMIT"
          ? "OVER_LIMIT"
          : "UNAVAILABLE",
      message:
        error instanceof Error && error.message === "F20_DIFF_OVER_LIMIT"
          ? "The diff exceeds the published viewer bound. Use the recorded worktree action or a later paged viewer; no authoritative content was silently truncated."
          : "The diff could not be represented safely for read-only inspection.",
      purpose,
      authority,
      publicationEligible: false,
    });
  }
  const untracked = [...diff.untrackedFiles];
  return f20DiffViewSchema.parse({
    schemaVersion: F20_SCHEMA_VERSION,
    kind: "REVIEW_BUNDLE_DIFF_VIEW",
    bundleId: input.bundleId,
    operationId: input.operationId,
    mode: input.mode,
    authority,
    purpose,
    publicationEligible: input.mode === "PROPOSED_WORKTREE" && diff.complete,
    status: diff.complete ? "READY" : "OVER_LIMIT",
    message: diff.complete
      ? "Deterministic F13 diff evidence loaded."
      : "F13 marked this diff incomplete; inspect the explicit condition before relying on it.",
    diffId: diff.diffId,
    diffHash: diff.diffHash,
    patchHash: diff.patchHash,
    baselineSha: diff.baselineSha,
    ...(diff.currentSha === undefined ? {} : { currentSha: diff.currentSha }),
    prBaseSha: input.prBaseSha,
    prHeadSha: input.prHeadSha,
    worktreeBaselineSha: input.worktreeBaselineSha,
    complete: diff.complete,
    fileCount: files.length,
    files,
    untrackedFiles: untracked,
    ...(input.selectedItemId === undefined
      ? {}
      : { selectedItemId: input.selectedItemId }),
    copyableText: copyableText(files),
  });
}

export function isF20WorkspaceReadModel(
  value: unknown,
): value is F20WorkspaceReadModel {
  return f20WorkspaceReadModelSchema.safeParse(value).success;
}

export function isF20DiffView(value: unknown): value is F20DiffView {
  return f20DiffViewSchema.safeParse(value).success;
}

export function isF20PathActionResult(
  value: unknown,
): value is F20PathActionResult {
  return f20PathActionResultSchema.safeParse(value).success;
}

export function isF20WorktreeCondition(
  value: unknown,
): value is F18WorktreeCondition {
  return f18WorktreeConditionSchema.safeParse(value).success;
}
