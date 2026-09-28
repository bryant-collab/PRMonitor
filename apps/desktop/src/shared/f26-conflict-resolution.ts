import { z } from "zod";
import {
  aiConflictResolutionResultSchema,
  type AIConflictResolutionResult,
} from "./ai/provider-contracts";

export const F26_SCHEMA_VERSION = 1 as const;
export const F26_MAX_CONTEXT_SEGMENTS = 64;
export const F26_MAX_CONSULTATION_RECORDS = 128;
export const F26_MAX_TURN_EVIDENCE = 64;
export const F26_MAX_CONTEXT_TEXT_BYTES = 48 * 1024;
export const F26_MAX_CONTEXT_JSON_BYTES = 4 * 1024 * 1024;

const identifierSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/u);
const shaSchema = z.string().regex(/^[0-9a-f]{7,64}$/iu);
const pathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine(
    (value) =>
      !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(value) &&
      !value.split(/[\\/]/u).includes(".."),
    "F26_RELATIVE_PATH_INVALID",
  );
const boundedTextSchema = z
  .string()
  .max(64 * 1024)
  .refine(
    (value) => new TextEncoder().encode(value).byteLength <= 64 * 1024,
    "F26_TEXT_BYTES_EXCEEDED",
  );
const nonNegativeIntegerSchema = z.number().int().nonnegative();

export const f26RepositoryIdentitySchema = z
  .object({
    serverId: identifierSchema,
    owner: identifierSchema,
    name: identifierSchema,
    key: identifierSchema.optional(),
  })
  .strict();
export type F26RepositoryIdentity = z.infer<typeof f26RepositoryIdentitySchema>;

export const f26TextSegmentSchema = z
  .object({
    index: nonNegativeIntegerSchema,
    total: z.number().int().positive(),
    text: boundedTextSchema,
  })
  .strict();
export type F26TextSegment = z.infer<typeof f26TextSegmentSchema>;

export const f26CommitMetadataSchema = z
  .object({
    sha: shaSchema,
    message: boundedTextSchema,
    author: boundedTextSchema.optional(),
    committedAt: boundedTextSchema.optional(),
  })
  .strict();
export type F26CommitMetadata = z.infer<typeof f26CommitMetadataSchema>;

export const f26ChangeSetFileSchema = z
  .object({
    path: pathSchema,
    kind: z.string().min(1).max(64),
    oldPath: pathSchema.optional(),
    statusCode: z.string().max(16).optional(),
  })
  .strict();
export type F26ChangeSetFile = z.infer<typeof f26ChangeSetFileSchema>;

export const f26ChangeSetSchema = z
  .object({
    schemaVersion: z.literal(F26_SCHEMA_VERSION),
    side: z.enum(["SOURCE", "DESTINATION"]),
    baseSha: shaSchema,
    tipSha: shaSchema,
    files: z.array(f26ChangeSetFileSchema).max(2_000),
    patchSegments: z.array(f26TextSegmentSchema).max(F26_MAX_CONTEXT_SEGMENTS),
    patchHash: identifierSchema.optional(),
    commitMetadata: z
      .array(f26CommitMetadataSchema)
      .max(F26_MAX_CONTEXT_SEGMENTS),
    evidenceHash: identifierSchema,
    complete: z.boolean(),
  })
  .strict();
export type F26ChangeSet = z.infer<typeof f26ChangeSetSchema>;

export const f26ConflictHunkSchema = z
  .object({
    path: pathSchema,
    statusCode: z.string().max(16).optional(),
    source: boundedTextSchema.optional(),
    destination: boundedTextSchema.optional(),
    mergeBase: boundedTextSchema.optional(),
    details: boundedTextSchema.optional(),
    contentSegments: z
      .array(f26TextSegmentSchema)
      .max(F26_MAX_CONTEXT_SEGMENTS),
    contentComplete: z.boolean().optional(),
  })
  .strict();
export type F26ConflictHunk = z.infer<typeof f26ConflictHunkSchema>;

export const f26ConflictContextSchema = z
  .object({
    schemaVersion: z.literal(F26_SCHEMA_VERSION),
    sourceRepository: f26RepositoryIdentitySchema,
    destinationRepository: f26RepositoryIdentitySchema,
    sourceBranch: boundedTextSchema,
    destinationBranch: boundedTextSchema,
    sourceSha: shaSchema,
    destinationSha: shaSchema,
    mergeBaseSha: shaSchema,
    sourceChangeSet: f26ChangeSetSchema,
    destinationChangeSet: f26ChangeSetSchema,
    conflicts: z.array(f26ConflictHunkSchema).max(2_000),
    pullRequest: z
      .object({
        managedPrId: identifierSchema,
        canonicalUrl: boundedTextSchema.optional(),
        title: boundedTextSchema.optional(),
      })
      .strict(),
    intent: z
      .object({
        prIntentContext: boundedTextSchema.optional(),
        sourceBranchIntent: boundedTextSchema.optional(),
        commonInstructions: z.array(boundedTextSchema).max(8),
        buildAndValidationInstructions: boundedTextSchema.optional(),
        resolutionGuidance: boundedTextSchema.optional(),
        manualEditConfirmed: z.boolean().optional(),
      })
      .strict(),
    missingContext: z.array(identifierSchema).max(32),
  })
  .strict()
  .superRefine((value, issueContext) => {
    if (
      new TextEncoder().encode(JSON.stringify(value)).byteLength >
      F26_MAX_CONTEXT_JSON_BYTES
    )
      issueContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: "F26_CONTEXT_SIZE_EXCEEDED",
      });
  });
export type F26ConflictContext = z.infer<typeof f26ConflictContextSchema>;

export const f26ConsultationKindSchema = z.enum([
  "AMBIGUITY_ANALYSIS",
  "USER_QUESTION",
  "USER_ANSWER",
  "USER_DIRECTION",
  "MANUAL_EDIT_CONFIRMED",
  "RETRY_RESOLUTION",
  "RE_EVALUATE",
  "DISCARD",
]);
export type F26ConsultationKind = z.infer<typeof f26ConsultationKindSchema>;

export const f26ConsultationRecordSchema = z
  .object({
    id: identifierSchema,
    kind: f26ConsultationKindSchema,
    createdAt: z.string().min(1).max(128),
    paths: z.array(pathSchema).max(2_000),
    competingIntents: z.array(boundedTextSchema).max(16),
    possibleDirections: z.array(boundedTextSchema).max(16).optional(),
    question: boundedTextSchema.optional(),
    answer: boundedTextSchema.optional(),
    direction: boundedTextSchema.optional(),
    manualEditConfirmed: z.boolean().optional(),
    exactUserAction: boundedTextSchema.optional(),
  })
  .strict();
export type F26ConsultationRecord = z.infer<typeof f26ConsultationRecordSchema>;

export const f26DeterministicCompletionEvidenceSchema = z
  .object({
    schemaVersion: z.literal(F26_SCHEMA_VERSION),
    checkedAt: z.string().min(1).max(128),
    exactMergeState: z.enum(["CONFLICT_RESOLUTION", "STALE", "UNKNOWN"]),
    unmergedPaths: z.array(pathSchema).max(2_000),
    conflictMarkers: z.array(pathSchema).max(2_000),
    attributionComplete: z.boolean(),
    worktreeComplete: z.boolean(),
    forbiddenMutation: z.boolean(),
    validationStatus: z.enum([
      "passed",
      "failed",
      "not_run",
      "interrupted",
      "running",
      "missing",
    ]),
    validationComplete: z.boolean(),
    evidenceHash: identifierSchema,
  })
  .strict();
export type F26DeterministicCompletionEvidence = z.infer<
  typeof f26DeterministicCompletionEvidenceSchema
>;

export const f26UsageEvidenceSchema = z
  .object({
    providerInvoked: z.boolean(),
    turns: nonNegativeIntegerSchema,
    tokens: nonNegativeIntegerSchema,
    inputTokens: nonNegativeIntegerSchema.optional(),
    outputTokens: nonNegativeIntegerSchema.optional(),
    totalTokens: nonNegativeIntegerSchema.optional(),
    unavailable: z.boolean().optional(),
    providerId: identifierSchema.optional(),
    modelId: identifierSchema.optional(),
    profileRevision: nonNegativeIntegerSchema.optional(),
    policyId: identifierSchema.optional(),
  })
  .strict();
export type F26UsageEvidence = z.infer<typeof f26UsageEvidenceSchema>;

export const f26TurnEvidenceSchema = z
  .object({
    turnId: identifierSchema,
    providerStatus: boundedTextSchema,
    changedPaths: z.array(pathSchema).max(2_000),
    remainingIssues: z.array(boundedTextSchema).max(64),
    deterministicProblems: z.array(boundedTextSchema).max(64),
    approach: boundedTextSchema.optional(),
    commands: z.array(boundedTextSchema).max(64).optional(),
    progress: boundedTextSchema.optional(),
    nextAction: boundedTextSchema.optional(),
    validationStatus: boundedTextSchema.optional(),
    usage: f26UsageEvidenceSchema,
    recordedAt: z.string().min(1).max(128),
  })
  .strict();
export type F26TurnEvidence = z.infer<typeof f26TurnEvidenceSchema>;

export const f26ResolutionStatusSchema = z.enum([
  "NOT_STARTED",
  "RUNNING",
  "RESOLVED",
  "AMBIGUOUS",
  "BLOCKED",
  "NEEDS_ATTENTION",
]);
export type F26ResolutionStatus = z.infer<typeof f26ResolutionStatusSchema>;

export const f26NextActionSchema = z.enum([
  "NONE",
  "RETRY_RESOLUTION",
  "ANSWER_USER",
  "INSPECT_WORKTREE",
  "MANUAL_RESOLUTION",
  "RECONCILE",
]);
export type F26NextAction = z.infer<typeof f26NextActionSchema>;

export const f26TaskProfileEvidenceSchema = z
  .object({
    snapshotId: identifierSchema,
    snapshotHash: identifierSchema,
    profileId: identifierSchema,
    profileRevision: nonNegativeIntegerSchema,
    providerId: identifierSchema,
    modelId: identifierSchema,
    reasoningEffort: boundedTextSchema.optional(),
    policyId: identifierSchema,
    policyRevision: nonNegativeIntegerSchema,
    configuredTurnBudget: nonNegativeIntegerSchema,
    timeoutMs: nonNegativeIntegerSchema,
  })
  .strict();
export type F26TaskProfileEvidence = z.infer<
  typeof f26TaskProfileEvidenceSchema
>;

export const f26ConflictResolutionReadModelSchema = z
  .object({
    schemaVersion: z.literal(F26_SCHEMA_VERSION),
    status: f26ResolutionStatusSchema,
    aiOperationId: identifierSchema.optional(),
    taskProfile: f26TaskProfileEvidenceSchema,
    context: f26ConflictContextSchema,
    assessment: aiConflictResolutionResultSchema.optional(),
    completion: f26DeterministicCompletionEvidenceSchema.optional(),
    consultationHistory: z
      .array(f26ConsultationRecordSchema)
      .max(F26_MAX_CONSULTATION_RECORDS),
    turnHistory: z.array(f26TurnEvidenceSchema).max(F26_MAX_TURN_EVIDENCE),
    usage: f26UsageEvidenceSchema,
    nextAction: f26NextActionSchema,
    updatedAt: z.string().min(1).max(128),
  })
  .strict();
export type F26ConflictResolutionReadModel = z.infer<
  typeof f26ConflictResolutionReadModelSchema
>;

export const f26RetryActionSchema = z
  .object({
    kind: z.enum([
      "RETRY_RESOLUTION",
      "USER_ANSWER",
      "USER_DIRECTION",
      "MANUAL_EDIT_CONFIRMED",
      "RE_EVALUATE",
      "DISCARD",
    ]),
    answer: boundedTextSchema.optional(),
    direction: boundedTextSchema.optional(),
    manualEditConfirmed: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.kind === "USER_ANSWER" &&
      (value.answer === undefined || value.answer.trim().length === 0)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["answer"],
        message: "F26_USER_ANSWER_REQUIRED",
      });
    if (
      value.kind === "USER_DIRECTION" &&
      (value.direction === undefined || value.direction.trim().length === 0)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["direction"],
        message: "F26_USER_DIRECTION_REQUIRED",
      });
  });
export type F26RetryAction = z.infer<typeof f26RetryActionSchema>;

export function isF26ConflictResolutionReadModel(
  value: unknown,
): value is F26ConflictResolutionReadModel {
  return f26ConflictResolutionReadModelSchema.safeParse(value).success;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Split provider context into immutable, bounded segments. */
export function f26TextSegments(value: string): readonly F26TextSegment[] {
  if (value.length === 0) return [];
  const segments: F26TextSegment[] = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(value.length, start + F26_MAX_CONTEXT_TEXT_BYTES);
    while (
      end > start &&
      byteLength(value.slice(start, end)) > F26_MAX_CONTEXT_TEXT_BYTES
    )
      end -= Math.max(
        1,
        Math.ceil(
          (byteLength(value.slice(start, end)) - F26_MAX_CONTEXT_TEXT_BYTES) /
            2,
        ),
      );
    if (end <= start) end = Math.min(value.length, start + 1);
    segments.push({
      index: segments.length,
      total: 0,
      text: value.slice(start, end),
    });
    start = end;
  }
  if (segments.length > F26_MAX_CONTEXT_SEGMENTS)
    throw new Error("F26_CONTEXT_SEGMENT_LIMIT_EXCEEDED");
  return segments.map((segment, index) => ({
    ...segment,
    index,
    total: segments.length,
  }));
}

export interface F26CompletionGuardInput {
  readonly providerStatus: string;
  readonly assessment?: AIConflictResolutionResult;
  readonly worktree: {
    readonly complete: boolean;
    readonly forbiddenMutation: boolean;
    readonly unmergedPaths: readonly string[];
    readonly conflictMarkers: readonly string[];
    readonly attributionComplete: boolean;
    readonly expectedHeadRevision?: string;
    readonly currentHeadRevision?: string;
  };
  readonly validation?: {
    readonly status:
      "passed" | "failed" | "not_run" | "interrupted" | "running";
    readonly complete: boolean;
    readonly noSafeCommand?: boolean;
  };
  readonly checkedAt: string;
  readonly evidenceHash: string;
}

export interface F26CompletionGuardResult {
  readonly ready: boolean;
  readonly status: "RESOLVED" | "AMBIGUOUS" | "BLOCKED" | "NEEDS_ATTENTION";
  readonly mergeOutcome: "CONFLICT_RESOLVED" | "CONFLICT_DETECTED";
  readonly nextAction: F26NextAction;
  readonly reasonCode: string;
  readonly remainingProblems: readonly string[];
  readonly completion: F26DeterministicCompletionEvidence;
}

/** Provider-neutral deterministic completion reducer. */
export function f26CompletionGuard(
  input: F26CompletionGuardInput,
): F26CompletionGuardResult {
  const validationComplete =
    input.validation !== undefined &&
    input.validation.complete &&
    (input.validation.status === "passed" ||
      (input.validation.status === "not_run" &&
        input.validation.noSafeCommand === true));
  const exactMergeState =
    input.worktree.expectedHeadRevision !== undefined &&
    input.worktree.currentHeadRevision !== undefined &&
    input.worktree.expectedHeadRevision === input.worktree.currentHeadRevision
      ? "CONFLICT_RESOLUTION"
      : "STALE";
  const completion = {
    schemaVersion: F26_SCHEMA_VERSION,
    checkedAt: input.checkedAt,
    exactMergeState,
    unmergedPaths: [...input.worktree.unmergedPaths],
    conflictMarkers: [...input.worktree.conflictMarkers],
    attributionComplete: input.worktree.attributionComplete,
    worktreeComplete: input.worktree.complete,
    forbiddenMutation: input.worktree.forbiddenMutation,
    validationStatus: input.validation?.status ?? "missing",
    validationComplete,
    evidenceHash: input.evidenceHash,
  } satisfies F26DeterministicCompletionEvidence;
  const assessment = input.assessment;
  if (assessment?.status === "ambiguous")
    return {
      ready: false,
      status: "AMBIGUOUS",
      mergeOutcome: "CONFLICT_DETECTED",
      nextAction: "ANSWER_USER",
      reasonCode: "F26_AMBIGUOUS_INTENT",
      remainingProblems: ["ambiguous-intent", ...assessment.remainingIssues],
      completion,
    };
  if (assessment?.status === "blocked")
    return {
      ready: false,
      status: "BLOCKED",
      mergeOutcome: "CONFLICT_DETECTED",
      nextAction: "RETRY_RESOLUTION",
      reasonCode: "F26_PROVIDER_BLOCKED",
      remainingProblems: ["provider-blocked", ...assessment.remainingIssues],
      completion,
    };
  if (assessment?.status !== "resolved" || input.providerStatus !== "completed")
    return {
      ready: false,
      status: "NEEDS_ATTENTION",
      mergeOutcome: "CONFLICT_DETECTED",
      nextAction: "RETRY_RESOLUTION",
      reasonCode: "F26_PROVIDER_RESULT_UNCONFIRMED",
      remainingProblems: ["provider-result-unconfirmed"],
      completion,
    };
  if (
    assessment.sourceIntent === undefined ||
    assessment.destinationIntent === undefined
  )
    return {
      ready: false,
      status: "NEEDS_ATTENTION",
      mergeOutcome: "CONFLICT_DETECTED",
      nextAction: "RETRY_RESOLUTION",
      reasonCode: "F26_INTENT_ANALYSIS_MISSING",
      remainingProblems: ["both-side-intent-analysis-missing"],
      completion,
    };
  const problems = [
    ...(completion.exactMergeState !== "CONFLICT_RESOLUTION"
      ? ["stale-merge-state"]
      : []),
    ...(!completion.worktreeComplete ? ["worktree-evidence-incomplete"] : []),
    ...(completion.forbiddenMutation ? ["forbidden-mutation"] : []),
    ...(completion.unmergedPaths.length > 0 ? ["unmerged-paths"] : []),
    ...(completion.conflictMarkers.length > 0 ? ["conflict-markers"] : []),
    ...(!completion.attributionComplete ? ["attribution-incomplete"] : []),
    ...(!completion.validationComplete ? ["validation-not-passed"] : []),
  ];
  if (problems.length > 0)
    return {
      ready: false,
      status: "NEEDS_ATTENTION",
      mergeOutcome: "CONFLICT_DETECTED",
      nextAction: problems.includes("validation-not-passed")
        ? "INSPECT_WORKTREE"
        : "RETRY_RESOLUTION",
      reasonCode: problems.includes("unmerged-paths")
        ? "F26_UNMERGED_PATHS_REMAIN"
        : problems.includes("conflict-markers")
          ? "F26_CONFLICT_MARKERS_REMAIN"
          : problems.includes("validation-not-passed")
            ? "F26_VALIDATION_NOT_PASSED"
            : "F26_DETERMINISTIC_COMPLETION_FAILED",
      remainingProblems: problems,
      completion,
    };
  return {
    ready: true,
    status: "RESOLVED",
    mergeOutcome: "CONFLICT_RESOLVED",
    nextAction: "NONE",
    reasonCode: "F26_RESOLUTION_VALIDATED",
    remainingProblems: [],
    completion,
  };
}
