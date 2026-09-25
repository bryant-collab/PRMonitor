import { z } from "zod";
import { aiWorkUsageSchema } from "./ai-work";
import {
  aiJsonValueSchema,
  aiReviewProposalItemSchema,
  type AIReviewImplementation,
  type AIReviewProposal,
} from "./ai/provider-contracts";

/**
 * F18's provider-neutral, renderer-safe handoff.  This file deliberately
 * contains data only: no provider SDK objects, Git handles, callbacks, or
 * publication methods cross the Review Bundle boundary.
 */

export const F18_SCHEMA_VERSION = 1 as const;
export const F18_MAX_EVENTS = 256;
export const F18_MAX_TEXT = 64 * 1024;
export const F18_MAX_PATH = 4_096;

const identifierSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/u);
const textSchema = z.string().min(1).max(F18_MAX_TEXT);
const optionalTextSchema = z.string().max(F18_MAX_TEXT).optional();
const absolutePathSchema = z
  .string()
  .min(1)
  .max(F18_MAX_PATH)
  .refine((value) => /^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(value));
const boundedHashSchema = z.string().min(1).max(256);
const relativePathSchema = z
  .string()
  .min(1)
  .max(F18_MAX_PATH)
  .refine(
    (value) =>
      !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(value) &&
      !value.split(/[\\/]/u).includes(".."),
  );

export const f18BundleStateSchema = z.enum([
  "WORKING",
  "READY_FOR_REVIEW",
  "NEEDS_ATTENTION",
]);
export type F18BundleState = z.infer<typeof f18BundleStateSchema>;

export const f18BundleStageSchema = z.enum(["PROPOSAL_REVIEW", "FINAL_REVIEW"]);
export type F18BundleStage = z.infer<typeof f18BundleStageSchema>;

export const f18WorkflowPhaseSchema = z.enum([
  "ADMITTED",
  "WORKTREE_PREPARED",
  "BASELINE_VALIDATED",
  "PROPOSAL_RECORDED",
  "DECISIONS_CONFIRMED",
  "IMPLEMENTATION_RECORDED",
  "FINAL_RECORDED",
]);
export type F18WorkflowPhase = z.infer<typeof f18WorkflowPhaseSchema>;

export const f18ReasonSchema = z
  .object({
    code: identifierSchema,
    what: textSchema,
    why: textSchema,
    nextAction: identifierSchema,
  })
  .strict();
export type F18Reason = z.infer<typeof f18ReasonSchema>;

const repositorySchema = z
  .object({
    serverId: identifierSchema,
    owner: identifierSchema,
    name: identifierSchema,
    key: identifierSchema,
  })
  .strict();

export const f18PullRequestSnapshotSchema = z
  .object({
    baseRepository: repositorySchema,
    headRepository: repositorySchema,
    baseBranch: textSchema,
    headBranch: textSchema,
    baseSha: identifierSchema,
    headSha: identifierSchema,
    title: z.string().max(4_096).optional(),
  })
  .strict();
export type F18PullRequestSnapshot = z.infer<
  typeof f18PullRequestSnapshotSchema
>;

export const f18FeedbackSnapshotSchema = z
  .object({
    eventVersionId: identifierSchema,
    semanticHash: boundedHashSchema,
    sourceKind: identifierSchema,
    sourceId: identifierSchema,
    observedAt: z.string().min(1).max(128),
    body: z.string().max(F18_MAX_TEXT).optional(),
    author: z.string().max(512).optional(),
    path: relativePathSchema.optional(),
    line: z.number().int().positive().max(10_000_000).optional(),
    diffHunk: z
      .string()
      .max(32 * 1024)
      .optional(),
  })
  .strict();
export type F18FeedbackSnapshot = z.infer<typeof f18FeedbackSnapshotSchema>;

export const f18TaskSnapshotRefSchema = z
  .object({
    snapshotId: identifierSchema,
    snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
    taskType: z.enum(["AUTOMATIC_REVIEW_REEVALUATION", "REVIEW_REVISION"]),
    phase: z.enum(["REVIEW_PROPOSAL", "REVIEW_REVISION"]),
    profileId: identifierSchema,
    profileRevision: z.number().int().positive(),
    providerId: identifierSchema,
    modelId: identifierSchema,
    policyId: identifierSchema,
    policyRevision: z.number().int().positive(),
    effectivePreset: identifierSchema,
    sandboxMode: identifierSchema,
    approvalPolicy: identifierSchema,
    networkAccess: identifierSchema,
    commonInstructionIds: z.array(identifierSchema).max(32),
    validationStatus: identifierSchema.optional(),
    validationBoundsRevision: identifierSchema.optional(),
    operationWorktree: z
      .object({
        operationId: identifierSchema,
        canonicalPath: absolutePathSchema,
        rootRevision: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type F18TaskSnapshotRef = z.infer<typeof f18TaskSnapshotRefSchema>;

export const f18WorktreeEvidenceSchema = z
  .object({
    operationId: identifierSchema,
    worktreeId: identifierSchema,
    ownerType: identifierSchema,
    ownerId: identifierSchema,
    canonicalPath: absolutePathSchema,
    rootRevision: z.number().int().nonnegative(),
    snapshotId: identifierSchema,
    baselineSha: identifierSchema,
    currentSha: identifierSchema.optional(),
    stateFingerprint: boundedHashSchema,
    clean: z.boolean(),
    complete: z.boolean(),
    changedFiles: z.array(relativePathSchema).max(2_000),
    proposedDiff: z
      .object({
        diffId: identifierSchema,
        diffHash: boundedHashSchema,
        patchHash: boundedHashSchema,
        baselineSha: identifierSchema,
        currentSha: identifierSchema.optional(),
        fileCount: z.number().int().nonnegative().max(2_000),
        complete: z.boolean(),
      })
      .strict()
      .optional(),
    contextDiff: z
      .object({
        diffId: identifierSchema,
        diffHash: boundedHashSchema,
        patchHash: boundedHashSchema,
        baselineSha: identifierSchema,
        currentSha: identifierSchema.optional(),
        fileCount: z.number().int().nonnegative().max(2_000),
        complete: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type F18WorktreeEvidence = z.infer<typeof f18WorktreeEvidenceSchema>;

export const f18ValidationEvidenceSchema = z
  .object({
    runId: identifierSchema,
    operationId: identifierSchema,
    requestedPhase: z.enum(["baseline", "post_change", "both"]),
    status: z.enum(["passed", "failed", "not_run", "running", "interrupted"]),
    reason: identifierSchema.optional(),
    nextAction: identifierSchema,
    snapshotId: identifierSchema.optional(),
    baselineRevision: identifierSchema.optional(),
    currentRevision: identifierSchema.optional(),
    warningCodes: z.array(identifierSchema).max(64),
    steps: z
      .array(
        z
          .object({
            stepId: identifierSchema,
            kind: identifierSchema,
            status: identifierSchema,
            reason: identifierSchema.optional(),
            exitCode: z.number().int().nullable().optional(),
          })
          .strict(),
      )
      .max(512),
    completedAt: z.string().max(128).optional(),
    version: z.number().int().nonnegative(),
  })
  .strict();
export type F18ValidationEvidence = z.infer<typeof f18ValidationEvidenceSchema>;

const f18AiReportSchema = z
  .object({
    turnId: identifierSchema,
    providerStatus: identifierSchema,
    modelClaims: z
      .object({
        approach: optionalTextSchema,
        problems: z.array(textSchema).max(64),
        remainingIssues: z.array(textSchema).max(64),
        claimedChangedFiles: z.array(z.string().max(F18_MAX_PATH)).max(2_000),
        completionClaim: z.boolean().optional(),
        semanticResult: aiJsonValueSchema.optional(),
      })
      .strict(),
    actualChangedFiles: z.array(relativePathSchema).max(2_000),
    actualCommands: z.array(textSchema).max(64),
    deterministicProblems: z.array(textSchema).max(64),
    remainingProblems: z.array(textSchema).max(64),
    nextAction: identifierSchema,
  })
  .strict();

export const f18AiWorkSummarySchema = z
  .object({
    operationId: identifierSchema,
    status: identifierSchema,
    attention: z.boolean(),
    nextAction: identifierSchema,
    remainingBudget: z.number().int().nonnegative(),
    usage: aiWorkUsageSchema,
    reports: z.array(f18AiReportSchema).max(64),
  })
  .strict();
export type F18AiWorkSummary = z.infer<typeof f18AiWorkSummarySchema>;

export const f18ReviewInputSnapshotSchema = z
  .object({
    schemaVersion: z.literal(F18_SCHEMA_VERSION),
    operationId: identifierSchema,
    bundleId: identifierSchema,
    batchId: identifierSchema,
    managedPrId: identifierSchema,
    claimId: identifierSchema,
    holdId: identifierSchema.optional(),
    correlationId: identifierSchema,
    schedulerRevision: z.number().int().nonnegative(),
    remoteEventVersionIds: z.array(identifierSchema).min(1).max(F18_MAX_EVENTS),
    pullRequest: f18PullRequestSnapshotSchema,
    feedback: z.array(f18FeedbackSnapshotSchema).max(F18_MAX_EVENTS),
    contextText: z
      .string()
      .max(32 * 1024)
      .optional(),
    taskSnapshot: f18TaskSnapshotRefSchema.optional(),
    worktree: f18WorktreeEvidenceSchema.optional(),
  })
  .strict();
export type F18ReviewInputSnapshot = z.infer<
  typeof f18ReviewInputSnapshotSchema
>;

export const f18ItemDecisionSchema = z
  .object({
    decision: z.enum(["pending", "accepted", "overridden"]),
    finalDisposition: z.enum(["fixed", "pushback", "question", "no_change"]),
    instruction: z.string().max(F18_MAX_TEXT).optional(),
    answer: z.string().max(F18_MAX_TEXT).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.decision !== "pending" &&
      value.finalDisposition === "question" &&
      !value.answer?.trim()
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["answer"],
        message: "F18_QUESTION_ANSWER_REQUIRED",
      });
  });
export type F18ItemDecision = z.infer<typeof f18ItemDecisionSchema>;

export const f18BundleItemSchema = z
  .object({
    itemId: identifierSchema,
    eventVersionId: identifierSchema,
    recommendation: aiReviewProposalItemSchema,
    decision: f18ItemDecisionSchema,
    decisionHistory: z.array(f18ItemDecisionSchema).max(64),
  })
  .strict();
export type F18BundleItem = z.infer<typeof f18BundleItemSchema>;

export const f18DraftResponseSchema = z
  .object({
    eventVersionId: identifierSchema,
    text: textSchema,
    source: z.literal("MODEL_PROPOSAL"),
  })
  .strict();
export type F18DraftResponse = z.infer<typeof f18DraftResponseSchema>;

export const f18ReviewBundleRecordSchema = z
  .object({
    schemaVersion: z.literal(F18_SCHEMA_VERSION),
    bundleId: identifierSchema,
    managedPrId: identifierSchema,
    batchId: identifierSchema,
    operationId: identifierSchema,
    claimId: identifierSchema,
    holdId: identifierSchema.optional(),
    correlationId: identifierSchema,
    schedulerRevision: z.number().int().nonnegative(),
    state: f18BundleStateSchema,
    stage: f18BundleStageSchema,
    phase: f18WorkflowPhaseSchema,
    version: z.number().int().nonnegative(),
    createdAt: z.string().min(1).max(128),
    updatedAt: z.string().min(1).max(128),
    input: f18ReviewInputSnapshotSchema,
    items: z.array(f18BundleItemSchema).max(F18_MAX_EVENTS),
    baselineValidation: f18ValidationEvidenceSchema.optional(),
    postChangeValidation: f18ValidationEvidenceSchema.optional(),
    worktree: f18WorktreeEvidenceSchema.optional(),
    proposalWork: f18AiWorkSummarySchema.optional(),
    implementationWork: f18AiWorkSummarySchema.optional(),
    draftResponses: z.array(f18DraftResponseSchema).max(F18_MAX_EVENTS),
    reasons: z.array(f18ReasonSchema).max(64),
    nextAction: identifierSchema,
    noImplementationChanges: z.boolean().optional(),
  })
  .strict();
export type F18ReviewBundleRecord = z.infer<typeof f18ReviewBundleRecordSchema>;

export const f18ReviewBundleReadModelSchema = z
  .object({
    schemaVersion: z.literal(F18_SCHEMA_VERSION),
    kind: z.literal("REVIEW_BUNDLE_READ_MODEL"),
    bundleId: identifierSchema,
    managedPrId: identifierSchema,
    batchId: identifierSchema,
    operationId: identifierSchema,
    state: f18BundleStateSchema,
    stage: f18BundleStageSchema,
    phase: f18WorkflowPhaseSchema,
    version: z.number().int().nonnegative(),
    input: f18ReviewInputSnapshotSchema,
    items: z.array(f18BundleItemSchema).max(F18_MAX_EVENTS),
    baselineValidation: f18ValidationEvidenceSchema.optional(),
    postChangeValidation: f18ValidationEvidenceSchema.optional(),
    worktree: f18WorktreeEvidenceSchema.optional(),
    proposalWork: f18AiWorkSummarySchema.optional(),
    implementationWork: f18AiWorkSummarySchema.optional(),
    draftResponses: z.array(f18DraftResponseSchema).max(F18_MAX_EVENTS),
    reasons: z.array(f18ReasonSchema).max(64),
    nextAction: identifierSchema,
    noImplementationChanges: z.boolean().optional(),
    decisionSummary: z
      .object({
        total: z.number().int().nonnegative(),
        decided: z.number().int().nonnegative(),
        fixed: z.number().int().nonnegative(),
        questionsNeedingAnswer: z.number().int().nonnegative(),
        complete: z.boolean(),
      })
      .strict(),
    capabilities: z
      .object({
        canPublish: z.literal(false),
        canCommit: z.literal(false),
        canPush: z.literal(false),
        canPostReply: z.literal(false),
      })
      .strict(),
    evidenceAuthority: z
      .object({
        proposal: z.literal("F15_STRUCTURED_RESULT"),
        worktree: z.literal("F13_DETERMINISTIC"),
        validation: z.literal("F14_DETERMINISTIC"),
        lifecycle: z.literal("F17_DETERMINISTIC"),
      })
      .strict(),
  })
  .strict();
export type F18ReviewBundleReadModel = z.infer<
  typeof f18ReviewBundleReadModelSchema
>;

export interface F18AutomaticReviewHandoff {
  readonly batchId: string;
  readonly managedPrId: string;
  readonly eventVersionIds: readonly string[];
  readonly operationId: string;
  readonly bundleId: string;
  readonly claimId: string;
  readonly holdId?: string;
  readonly schedulerRevision: number;
  readonly correlationId: string;
}

export interface F18DecisionInput {
  readonly bundleId: string;
  readonly itemId: string;
  readonly decision: "accepted" | "overridden";
  readonly finalDisposition: "fixed" | "pushback" | "question" | "no_change";
  readonly instruction?: string;
  readonly answer?: string;
  readonly expectedVersion?: number;
  readonly actionId?: string;
}

export interface F18ConfirmInput {
  readonly bundleId: string;
  readonly expectedVersion?: number;
  readonly actionId?: string;
}

export interface F18AiWorkResult {
  readonly summary: F18AiWorkSummary;
  readonly proposal?: AIReviewProposal;
  readonly implementation?: AIReviewImplementation;
  readonly validation?: F18ValidationEvidence;
}

export function reviewBundleDecisionSummary(
  items: readonly F18BundleItem[],
): F18ReviewBundleReadModel["decisionSummary"] {
  const decided = items.filter((item) => item.decision.decision !== "pending");
  const questionsNeedingAnswer = items.filter(
    (item) =>
      item.decision.finalDisposition === "question" &&
      !item.decision.answer?.trim(),
  ).length;
  return {
    total: items.length,
    decided: decided.length,
    fixed: items.filter(
      (item) =>
        item.decision.decision !== "pending" &&
        item.decision.finalDisposition === "fixed",
    ).length,
    questionsNeedingAnswer,
    complete: decided.length === items.length && questionsNeedingAnswer === 0,
  };
}
