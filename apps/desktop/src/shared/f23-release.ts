import { z } from "zod";

/**
 * F23 is the only boundary that can turn a Review Bundle into external
 * effects.  These contracts deliberately contain evidence and intent, never
 * provider clients, Git handles, or executable commands.
 */
export const F23_SCHEMA_VERSION = 1 as const;
export const F23_MAX_TEXT = 64 * 1024;
export const F23_MAX_RESPONSES = 256;
export const F23_MAX_FILES = 2_000;

const identifierSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/u);
const hashSchema = z.string().min(1).max(256);
const shaSchema = z.string().min(1).max(128);
const textSchema = z.string().min(1).max(F23_MAX_TEXT);
const pathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine(
    (value) =>
      !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(value) &&
      !value.split(/[\\/]/u).includes(".."),
  );

export const f23PublicationPhaseSchema = z.enum([
  "PREPARED",
  "PREPARING",
  "COMMITTING",
  "PUSHING",
  "POSTING_RESPONSES",
  "RECOVERING",
  "PUBLISHED",
  "PUBLISHED_WITH_ERRORS",
  "DISCARDED",
  "FAILED",
]);
export type F23PublicationPhase = z.infer<typeof f23PublicationPhaseSchema>;

export const f23PublicationStatusSchema = z.enum([
  "BLOCKED",
  "READY_FOR_APPROVAL",
  "APPROVED",
  "PREPARING",
  "COMMITTING",
  "PUSHING",
  "POSTING_RESPONSES",
  "RECOVERING",
  "PUBLISHED",
  "PUBLISHED_WITH_ERRORS",
  "DISCARDED",
  "FAILED",
]);
export type F23PublicationStatus = z.infer<typeof f23PublicationStatusSchema>;

export const f23ResponseSourceSchema = z.enum([
  "ISSUE_COMMENT",
  "REVIEW_COMMENT_REPLY",
]);
export type F23ResponseSource = z.infer<typeof f23ResponseSourceSchema>;

export const f23ResponseTargetSchema = z
  .object({
    source: f23ResponseSourceSchema,
    serverId: identifierSchema,
    owner: identifierSchema,
    repositoryName: identifierSchema,
    pullRequestNumber: z.number().int().positive().max(2_000_000_000),
    commentId: identifierSchema,
  })
  .strict();
export type F23ResponseTarget = z.infer<typeof f23ResponseTargetSchema>;

export const f23CandidateResponseSchema = z
  .object({
    responseKey: identifierSchema,
    eventVersionId: identifierSchema,
    target: f23ResponseTargetSchema,
    body: textSchema,
    bodyHash: hashSchema,
  })
  .strict();
export type F23CandidateResponse = z.infer<typeof f23CandidateResponseSchema>;

export const f23CandidateSchema = z
  .object({
    schemaVersion: z.literal(F23_SCHEMA_VERSION),
    kind: z.literal("F23_PUBLICATION_CANDIDATE"),
    bundleId: identifierSchema,
    managedPrId: identifierSchema,
    operationId: identifierSchema,
    bundleVersion: z.number().int().nonnegative(),
    evidenceRevision: z.number().int().nonnegative(),
    gateRevision: z.number().int().nonnegative(),
    baselineSha: shaSchema,
    expectedHeadSha: shaSchema,
    currentHeadSha: shaSchema.optional(),
    headBranch: z.string().min(1).max(512),
    worktreePath: z.string().min(1).max(4_096),
    condition: z.enum([
      "CLEAN",
      "AI_ATTRIBUTED_ONLY",
      "UNATTRIBUTED_CHANGES",
      "MIXED_OR_OVERLAP",
      "STALE_OR_UNKNOWN",
    ]),
    conditionFingerprint: hashSchema,
    conditionEvidenceComplete: z.boolean(),
    changedFiles: z.array(pathSchema).max(F23_MAX_FILES),
    trackedFiles: z.array(pathSchema).max(F23_MAX_FILES).optional(),
    untrackedFiles: z.array(pathSchema).max(F23_MAX_FILES).optional(),
    proposedDiffId: identifierSchema.optional(),
    proposedDiffHash: hashSchema.optional(),
    proposedPatchHash: hashSchema.optional(),
    proposedDiffComplete: z.boolean(),
    validationRunId: identifierSchema.optional(),
    validationStatus: z
      .enum(["passed", "failed", "not_run", "running", "interrupted"])
      .optional(),
    commitMessage: textSchema,
    responses: z.array(f23CandidateResponseSchema).max(F23_MAX_RESPONSES),
    candidateHash: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
export type F23PublicationCandidate = z.infer<typeof f23CandidateSchema>;

export const f23ResponsePlanEntrySchema = z
  .object({
    responseKey: identifierSchema,
    included: z.boolean(),
    body: textSchema,
    bodyHash: hashSchema,
  })
  .strict();
export type F23ResponsePlanEntry = z.infer<typeof f23ResponsePlanEntrySchema>;

export const f23ApprovalInputSchema = z
  .object({
    bundleId: identifierSchema,
    candidateHash: z.string().regex(/^[a-f0-9]{64}$/u),
    expectedBundleVersion: z.number().int().nonnegative(),
    expectedEvidenceRevision: z.number().int().nonnegative(),
    expectedGateRevision: z.number().int().nonnegative(),
    approvalId: identifierSchema,
    idempotencyKey: identifierSchema,
    commitMessage: textSchema,
    completeDiffAcknowledged: z.literal(true),
    unattributedChangesAcknowledged: z.boolean(),
    responses: z.array(f23ResponsePlanEntrySchema).max(F23_MAX_RESPONSES),
  })
  .strict();
export type F23ApprovalInput = z.infer<typeof f23ApprovalInputSchema>;

export const f23PublicationInputSchema = z
  .object({
    bundleId: identifierSchema,
    idempotencyKey: identifierSchema,
  })
  .strict();
export type F23PublicationInput = z.infer<typeof f23PublicationInputSchema>;

export const f23PublicationReasonSchema = z
  .object({
    code: identifierSchema,
    what: textSchema,
    why: textSchema,
    nextAction: identifierSchema,
  })
  .strict();
export type F23PublicationReason = z.infer<typeof f23PublicationReasonSchema>;

export const f23ResponseProgressSchema = z
  .object({
    total: z.number().int().nonnegative().max(F23_MAX_RESPONSES),
    pending: z.number().int().nonnegative().max(F23_MAX_RESPONSES),
    posted: z.number().int().nonnegative().max(F23_MAX_RESPONSES),
    failed: z.number().int().nonnegative().max(F23_MAX_RESPONSES),
    unknown: z.number().int().nonnegative().max(F23_MAX_RESPONSES),
  })
  .strict();
export type F23ResponseProgress = z.infer<typeof f23ResponseProgressSchema>;

export const f23PublicationSummarySchema = z
  .object({
    publicationId: identifierSchema,
    idempotencyKey: identifierSchema,
    approvalId: identifierSchema,
    phase: f23PublicationPhaseSchema,
    recoveryState: identifierSchema,
    codePublished: z.boolean(),
    commitSha: shaSchema.optional(),
    responses: f23ResponseProgressSchema,
    updatedAt: z.string().min(1).max(128),
    nextAction: identifierSchema,
  })
  .strict();
export type F23PublicationSummary = z.infer<typeof f23PublicationSummarySchema>;

export const f23PublicationReadModelSchema = z
  .object({
    schemaVersion: z.literal(F23_SCHEMA_VERSION),
    kind: z.literal("F23_PUBLICATION_READ_MODEL"),
    bundleId: identifierSchema,
    status: f23PublicationStatusSchema,
    candidate: f23CandidateSchema.optional(),
    publication: f23PublicationSummarySchema.optional(),
    reasons: z.array(f23PublicationReasonSchema).max(64),
    canApprove: z.boolean(),
    canPublish: z.boolean(),
    canReconcile: z.boolean(),
    canRetryResponses: z.boolean(),
    responseOnlyRetry: z.boolean(),
    authority: z.literal("F23_MAIN_PROCESS"),
  })
  .strict();
export type F23PublicationReadModel = z.infer<
  typeof f23PublicationReadModelSchema
>;

export const f23PublicationResultSchema = z
  .object({
    readModel: f23PublicationReadModelSchema,
    outcome: z.enum([
      "APPROVAL_RECORDED",
      "PUBLISHED",
      "PUBLISHED_WITH_ERRORS",
      "RECONCILIATION_REQUIRED",
      "DISCARDED",
      "BLOCKED",
    ]),
  })
  .strict();
export type F23PublicationResult = z.infer<typeof f23PublicationResultSchema>;

export function f23Reason(
  code: string,
  what: string,
  why: string,
  nextAction: string,
): F23PublicationReason {
  return f23PublicationReasonSchema.parse({ code, what, why, nextAction });
}

export function f23ResponseProgress(
  states: readonly string[],
): F23ResponseProgress {
  return f23ResponseProgressSchema.parse({
    total: states.length,
    pending: states.filter((state) => state === "PENDING").length,
    posted: states.filter((state) => state === "POSTED").length,
    failed: states.filter((state) => state === "FAILED").length,
    unknown: states.filter((state) => state === "UNKNOWN").length,
  });
}

/** A small type guard used by IPC and renderer adapters. */
export function isF23PublicationReadModel(
  value: unknown,
): value is F23PublicationReadModel {
  return f23PublicationReadModelSchema.safeParse(value).success;
}
