import { z } from "zod";
import {
  aiJsonValueSchema,
  aiProviderInteractionModeSchema,
  aiProviderTaskTypeSchema,
  type AIJsonValue,
  type AIProviderTaskType,
  type AIProviderTurnResult,
  type AIProviderUsage,
} from "./ai/provider-contracts";
import {
  f16EffectiveAITaskSnapshotSchema,
  type F16EffectiveAITaskSnapshot,
} from "./f16-preferences";

/**
 * F17 is deliberately a provider-neutral, renderer-safe contract.  The
 * controller may use a provider port in the main process, but the records and
 * projections below never contain SDK instances, process handles, credentials,
 * or publication methods.
 */
export const AI_WORK_SCHEMA_VERSION = 1 as const;
export const AI_WORK_DEFAULT_TURN_BUDGET = 3 as const;
export const AI_WORK_MIN_TURN_BUDGET = 1 as const;
export const AI_WORK_MAX_TURN_BUDGET = 10 as const;
export const AI_WORK_DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000;
export const AI_WORK_MIN_TIMEOUT_MS = 1_000;
export const AI_WORK_MAX_TIMEOUT_MS = 60 * 60 * 1_000;
export const AI_WORK_RECONCILIATION_WINDOW_MS = 30_000;
export const AI_WORK_MAX_REPORT_TEXT = 8 * 1024;
export const AI_WORK_MAX_REPORT_ITEMS = 64;
export const AI_WORK_MAX_FINGERPRINT_HISTORY = 256;

const identifierSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/u);
const textSchema = z.string().min(1).max(AI_WORK_MAX_REPORT_TEXT);
const optionalTextSchema = z.string().max(AI_WORK_MAX_REPORT_TEXT);
const boundedTextArraySchema = z
  .array(optionalTextSchema)
  .max(AI_WORK_MAX_REPORT_ITEMS);
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const positiveIntegerSchema = z.number().int().positive();

export const aiWorkOperationKindSchema = z.union([
  z.enum([
    "AUTOMATIC_REVIEW",
    "CONVERSATION",
    "REVIEW_REVISION",
    "MERGE_CONFLICT_RESOLUTION",
  ]),
  aiProviderTaskTypeSchema,
]);
export type AIWorkOperationKind = z.infer<typeof aiWorkOperationKindSchema>;

export const aiWorkOperationStatusSchema = z.enum([
  "CREATED",
  "WORKING",
  "COMPLETED",
  "NEEDS_ATTENTION",
  "EXHAUSTED",
  "CANCELLED",
  "INTERRUPTED",
  "UNCERTAIN",
]);
export type AIWorkOperationStatus = z.infer<typeof aiWorkOperationStatusSchema>;

export const aiWorkSegmentStatusSchema = z.enum([
  "PENDING",
  "WORKING",
  "COMPLETED",
  "STOPPED",
  "CANCELLED",
  "INTERRUPTED",
  "UNCERTAIN",
]);
export type AIWorkSegmentStatus = z.infer<typeof aiWorkSegmentStatusSchema>;

export const aiWorkTurnStatusSchema = z.enum([
  "RESERVED",
  "STARTED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
  "INTERRUPTED",
  "UNCERTAIN",
  "PRESTART_REFUSED",
]);
export type AIWorkTurnStatus = z.infer<typeof aiWorkTurnStatusSchema>;

export const aiWorkReservationStateSchema = z.enum([
  "NONE",
  "RESERVED",
  "CONSUMED",
  "RELEASED",
  "UNCERTAIN",
]);
export type AIWorkReservationState = z.infer<
  typeof aiWorkReservationStateSchema
>;

export const aiWorkProgressClassificationSchema = z.enum([
  "MATERIAL_PROGRESS",
  "NO_PROGRESS",
  "REPEATED_STATE",
  "COMPLETED",
  "FAILED",
]);
export type AIWorkProgressClassification = z.infer<
  typeof aiWorkProgressClassificationSchema
>;

export const aiWorkNextActionSchema = z.enum([
  "NONE",
  "RUN_NEXT_TURN",
  "CONTINUE_AI_WORK",
  "RETRY_RESOLUTION",
  "START_NEW_OPERATION",
  "RECONCILE",
  "REVIEW",
]);
export type AIWorkNextAction = z.infer<typeof aiWorkNextActionSchema>;

export const aiWorkStopReasonCodeSchema = z.enum([
  "AI_TURN_TIMEOUT",
  "AI_EXECUTION_FAILED",
  "AI_TURN_CANCELLED",
  "AI_APP_SHUTDOWN",
  "AI_APP_RESTART",
  "AI_REPEATED_STATE",
  "AI_NO_PROGRESS",
  "AI_TURN_BUDGET_EXHAUSTED",
  "AI_INVALID_EVIDENCE",
  "AI_SNAPSHOT_MISMATCH",
  "AI_POLICY_MISMATCH",
  "AI_PERSISTENCE_FAILURE",
  "AI_UNCERTAIN_TERMINATION",
  "AI_PRESTART_REFUSED",
  "AI_CONTINUATION_REQUIRED",
  "AI_OPERATION_CANCELLED",
]);
export type AIWorkStopReasonCode = z.infer<typeof aiWorkStopReasonCodeSchema>;

export const aiWorkReasonSchema = z
  .object({
    schemaVersion: z.literal(AI_WORK_SCHEMA_VERSION),
    code: identifierSchema,
    category: identifierSchema,
    what: textSchema,
    why: textSchema,
    nextAction: aiWorkNextActionSchema,
    details: aiJsonValueSchema.optional(),
  })
  .strict();
export type AIWorkReason = z.infer<typeof aiWorkReasonSchema>;

export const aiWorkStopReasonSchema = z
  .object({
    code: aiWorkStopReasonCodeSchema,
    category: identifierSchema,
    what: textSchema,
    why: textSchema,
    nextAction: aiWorkNextActionSchema,
    details: aiJsonValueSchema.optional(),
    attention: z.literal(true),
  })
  .strict();
export type AIWorkStopReason = z.infer<typeof aiWorkStopReasonSchema>;

const absolutePathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine(
    (value) => /^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(value),
    "AI_WORK_PATH_NOT_ABSOLUTE",
  );

export const aiWorkScopeSchema = z
  .object({
    operationId: identifierSchema,
    worktreeId: identifierSchema,
    ownerType: identifierSchema,
    ownerId: identifierSchema,
    canonicalPath: absolutePathSchema,
    rootRevision: nonNegativeIntegerSchema,
    access: z.enum(["READ_ONLY", "WORKTREE_WRITE"]),
    available: z.boolean(),
  })
  .strict();
export type AIWorkScope = z.infer<typeof aiWorkScopeSchema>;

export const aiWorkPredicateRefSchema = z
  .object({
    id: identifierSchema,
    version: positiveIntegerSchema,
    inputSnapshot: aiJsonValueSchema,
  })
  .strict();
export type AIWorkPredicateRef = z.infer<typeof aiWorkPredicateRefSchema>;

export const aiWorkOperationInputSchema = z
  .object({
    schemaVersion: z.literal(AI_WORK_SCHEMA_VERSION),
    operationId: identifierSchema,
    parentOperationId: identifierSchema.optional(),
    idempotencyKey: identifierSchema.optional(),
    operationKind: aiWorkOperationKindSchema,
    taskType: aiProviderTaskTypeSchema,
    purpose: textSchema,
    interactionMode: aiProviderInteractionModeSchema,
    worktree: aiWorkScopeSchema.optional(),
    taskSnapshot: f16EffectiveAITaskSnapshotSchema,
    predicate: aiWorkPredicateRefSchema,
    configuredTurnBudget: z
      .number()
      .int()
      .min(AI_WORK_MIN_TURN_BUDGET)
      .max(AI_WORK_MAX_TURN_BUDGET)
      .optional(),
    budgetSource: z
      .enum(["F16_PREFERENCE", "EXPLICIT_OPERATION", "CONTINUATION_REMAINDER"])
      .optional(),
    timeoutMs: z
      .number()
      .int()
      .min(AI_WORK_MIN_TIMEOUT_MS)
      .max(AI_WORK_MAX_TIMEOUT_MS)
      .optional(),
    createdAt: z.string().min(1).max(128),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.taskSnapshot.taskType !== value.taskType) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["taskSnapshot", "taskType"],
        message: "AI_WORK_TASK_SNAPSHOT_MISMATCH",
      });
    }
    const mutating = value.interactionMode === "worktree_write";
    if (mutating && value.worktree === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["worktree"],
        message: "AI_WORK_WORKTREE_REQUIRED",
      });
    }
    if (!mutating && value.worktree?.access === "WORKTREE_WRITE") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["worktree", "access"],
        message: "AI_WORK_READ_ONLY_SCOPE_WRITE_ACCESS",
      });
    }
    if (
      value.worktree !== undefined &&
      value.worktree.operationId !== value.operationId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["worktree", "operationId"],
        message: "AI_WORK_SCOPE_OPERATION_MISMATCH",
      });
    }
    if (
      value.taskSnapshot.operationWorktree !== undefined &&
      value.worktree !== undefined &&
      (value.taskSnapshot.operationWorktree.operationId !==
        value.worktree.operationId ||
        value.taskSnapshot.operationWorktree.canonicalPath !==
          value.worktree.canonicalPath ||
        value.taskSnapshot.operationWorktree.rootRevision !==
          value.worktree.rootRevision)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["taskSnapshot", "operationWorktree"],
        message: "AI_WORK_SCOPE_SNAPSHOT_MISMATCH",
      });
    }
  });
export type AIWorkOperationInput = z.infer<typeof aiWorkOperationInputSchema>;

export const aiWorkUsageSchema = z
  .object({
    inputTokens: nonNegativeIntegerSchema.optional(),
    cachedInputTokens: nonNegativeIntegerSchema.optional(),
    cacheWriteInputTokens: nonNegativeIntegerSchema.optional(),
    outputTokens: nonNegativeIntegerSchema.optional(),
    reasoningOutputTokens: nonNegativeIntegerSchema.optional(),
    totalTokens: nonNegativeIntegerSchema.optional(),
    unavailableFields: z
      .array(
        z.enum([
          "inputTokens",
          "cachedInputTokens",
          "cacheWriteInputTokens",
          "outputTokens",
          "reasoningOutputTokens",
          "totalTokens",
        ]),
      )
      .max(6)
      .optional(),
  })
  .strict();
export type AIWorkUsage = z.infer<typeof aiWorkUsageSchema>;

export const aiWorkFileEvidenceSchema = z
  .object({
    path: z.string().min(1).max(4_096),
    kind: z.string().min(1).max(64),
    contentHash: z.string().max(128).optional(),
    material: z.boolean().optional(),
  })
  .strict();
export type AIWorkFileEvidence = z.infer<typeof aiWorkFileEvidenceSchema>;

export const aiWorkValidationEvidenceSchema = z
  .object({
    runId: identifierSchema,
    revision: nonNegativeIntegerSchema,
    phase: z.enum(["baseline", "post_change", "both"]).optional(),
    status: z.enum(["passed", "failed", "not_run", "interrupted"]),
    complete: z.boolean(),
    noSafeCommand: z.boolean().optional(),
    problems: boundedTextArraySchema.optional(),
  })
  .strict();
export type AIWorkValidationEvidence = z.infer<
  typeof aiWorkValidationEvidenceSchema
>;

export const aiWorkWorktreeEvidenceSchema = z
  .object({
    schemaVersion: z.literal(AI_WORK_SCHEMA_VERSION),
    worktreeId: identifierSchema,
    snapshotId: identifierSchema,
    revision: nonNegativeIntegerSchema,
    stateFingerprint: identifierSchema,
    baselineRevision: optionalTextSchema,
    currentRevision: optionalTextSchema,
    files: z.array(aiWorkFileEvidenceSchema).max(2_000),
    ignoredPaths: z.array(z.string().max(4_096)).max(2_000),
    unmergedPaths: z.array(z.string().max(4_096)).max(2_000),
    conflictMarkers: z.array(z.string().max(4_096)).max(2_000),
    actualCommands: boundedTextArraySchema,
    complete: z.boolean(),
    clean: z.boolean(),
    forbiddenMutation: z.boolean(),
  })
  .strict();
export type AIWorkWorktreeEvidence = z.infer<
  typeof aiWorkWorktreeEvidenceSchema
>;

export const aiWorkEvidenceBundleSchema = z
  .object({
    schemaVersion: z.literal(AI_WORK_SCHEMA_VERSION),
    evidenceRevision: identifierSchema,
    worktree: aiWorkWorktreeEvidenceSchema,
    validation: aiWorkValidationEvidenceSchema.optional(),
    deterministicProblems: boundedTextArraySchema,
    materialProblemIds: z.array(identifierSchema).max(AI_WORK_MAX_REPORT_ITEMS),
  })
  .strict();
export type AIWorkEvidenceBundle = z.infer<typeof aiWorkEvidenceBundleSchema>;

export interface AIWorkPredicateContext {
  readonly operation: AIWorkOperationInput;
  readonly providerResult: AIProviderTurnResult;
  readonly evidence: AIWorkEvidenceBundle;
}

export interface AIWorkPredicateResult {
  readonly valid: boolean;
  readonly complete: boolean;
  readonly materialProgress: boolean;
  readonly reason: string;
  readonly remainingProblems: readonly string[];
  readonly semanticResultIdentity?: string;
}

export interface AIWorkPredicate {
  readonly id: string;
  readonly version: number;
  readonly evaluate: (context: AIWorkPredicateContext) => AIWorkPredicateResult;
}

export interface AIProgressHistoryEntry {
  readonly turnId: string;
  readonly fingerprint: string;
  readonly classification: AIWorkProgressClassification;
  readonly complete: boolean;
  readonly materialProgress: boolean;
}

export const aiWorkProgressEvaluationSchema = z
  .object({
    schemaVersion: z.literal(AI_WORK_SCHEMA_VERSION),
    predicateId: identifierSchema,
    predicateVersion: positiveIntegerSchema,
    evidenceRevision: identifierSchema,
    fingerprint: identifierSchema,
    classification: aiWorkProgressClassificationSchema,
    complete: z.boolean(),
    materialProgress: z.boolean(),
    repeatedState: z.boolean(),
    consecutiveNoProgress: nonNegativeIntegerSchema,
    remainingProblems: boundedTextArraySchema,
    reason: aiWorkReasonSchema,
    evaluatedAt: z.string().min(1).max(128),
  })
  .strict();
export type AIProgressEvaluation = z.infer<
  typeof aiWorkProgressEvaluationSchema
>;

export const aiWorkModelClaimsSchema = z
  .object({
    approach: optionalTextSchema.optional(),
    problems: boundedTextArraySchema,
    remainingIssues: boundedTextArraySchema,
    claimedChangedFiles: z.array(z.string().max(4_096)).max(2_000),
    claimedCommands: boundedTextArraySchema,
    completionClaim: z.boolean().optional(),
    semanticResult: aiJsonValueSchema.optional(),
    providerEventCount: nonNegativeIntegerSchema,
    providerEventKinds: z.array(identifierSchema).max(64),
  })
  .strict();
export type AIWorkModelClaims = z.infer<typeof aiWorkModelClaimsSchema>;

export const aiWorkTurnReportSchema = z
  .object({
    schemaVersion: z.literal(AI_WORK_SCHEMA_VERSION),
    turnId: identifierSchema,
    operationId: identifierSchema,
    segmentId: identifierSchema,
    turnNumber: positiveIntegerSchema,
    objective: textSchema,
    startedAt: z.string().min(1).max(128),
    completedAt: z.string().min(1).max(128),
    providerStatus: z.string().min(1).max(64),
    modelClaims: aiWorkModelClaimsSchema,
    actualChangedFiles: z.array(aiWorkFileEvidenceSchema).max(2_000),
    actualCommands: boundedTextArraySchema,
    validation: aiWorkValidationEvidenceSchema.optional(),
    deterministicProblems: boundedTextArraySchema,
    remainingProblems: boundedTextArraySchema,
    progress: aiWorkProgressEvaluationSchema.optional(),
    usage: aiWorkUsageSchema,
    terminalReason: aiWorkStopReasonSchema.optional(),
    nextAction: aiWorkNextActionSchema,
    evidence: aiWorkEvidenceBundleSchema.optional(),
  })
  .strict();
export type AIWorkTurnReport = z.infer<typeof aiWorkTurnReportSchema>;

export const aiWorkTurnIntentSchema = z
  .object({
    schemaVersion: z.literal(AI_WORK_SCHEMA_VERSION),
    turnId: identifierSchema,
    operationId: identifierSchema,
    segmentId: identifierSchema,
    sequence: nonNegativeIntegerSchema,
    interactionMode: aiProviderInteractionModeSchema,
    snapshotId: identifierSchema,
    snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
    predicateId: identifierSchema,
    predicateVersion: positiveIntegerSchema,
    timeoutMs: z
      .number()
      .int()
      .min(AI_WORK_MIN_TIMEOUT_MS)
      .max(AI_WORK_MAX_TIMEOUT_MS),
    deadlineAt: z.string().min(1).max(128),
    status: aiWorkTurnStatusSchema,
    reservation: aiWorkReservationStateSchema,
    createdAt: z.string().min(1).max(128),
    startedAt: z.string().min(1).max(128).optional(),
    completedAt: z.string().min(1).max(128).optional(),
    version: nonNegativeIntegerSchema,
  })
  .strict();
export type AIWorkTurnIntent = z.infer<typeof aiWorkTurnIntentSchema>;

export const aiWorkSegmentRecordSchema = z
  .object({
    schemaVersion: z.literal(AI_WORK_SCHEMA_VERSION),
    segmentId: identifierSchema,
    operationId: identifierSchema,
    index: nonNegativeIntegerSchema,
    status: aiWorkSegmentStatusSchema,
    interactionMode: aiProviderInteractionModeSchema,
    turnBudget: z
      .number()
      .int()
      .min(AI_WORK_MIN_TURN_BUDGET)
      .max(AI_WORK_MAX_TURN_BUDGET),
    consumedTurnBaseline: nonNegativeIntegerSchema,
    taskSnapshot: f16EffectiveAITaskSnapshotSchema,
    timeoutMs: z
      .number()
      .int()
      .min(AI_WORK_MIN_TIMEOUT_MS)
      .max(AI_WORK_MAX_TIMEOUT_MS),
    turns: z.array(aiWorkTurnIntentSchema).max(AI_WORK_MAX_REPORT_ITEMS),
    reports: z.array(aiWorkTurnReportSchema).max(AI_WORK_MAX_REPORT_ITEMS),
    createdAt: z.string().min(1).max(128),
    updatedAt: z.string().min(1).max(128),
    version: nonNegativeIntegerSchema,
  })
  .strict();
export type AIWorkSegmentRecord = z.infer<typeof aiWorkSegmentRecordSchema>;

export const aiWorkOperationRecordSchema = z
  .object({
    schemaVersion: z.literal(AI_WORK_SCHEMA_VERSION),
    operationId: identifierSchema,
    parentOperationId: identifierSchema.optional(),
    operationKind: aiWorkOperationKindSchema,
    taskType: aiProviderTaskTypeSchema,
    purpose: textSchema,
    status: aiWorkOperationStatusSchema,
    worktree: aiWorkScopeSchema.optional(),
    taskSnapshot: f16EffectiveAITaskSnapshotSchema,
    predicate: aiWorkPredicateRefSchema,
    configuredTurnBudget: z
      .number()
      .int()
      .min(AI_WORK_MIN_TURN_BUDGET)
      .max(AI_WORK_MAX_TURN_BUDGET),
    consumedTurnCount: nonNegativeIntegerSchema,
    reservedTurnCount: nonNegativeIntegerSchema,
    remainingTurnCount: nonNegativeIntegerSchema,
    cumulativeUsage: aiWorkUsageSchema,
    historyRevision: nonNegativeIntegerSchema,
    stopReason: aiWorkStopReasonSchema.optional(),
    segments: z.array(aiWorkSegmentRecordSchema).max(AI_WORK_MAX_REPORT_ITEMS),
    createdAt: z.string().min(1).max(128),
    updatedAt: z.string().min(1).max(128),
    version: nonNegativeIntegerSchema,
  })
  .strict();
export type AIWorkOperationRecord = z.infer<typeof aiWorkOperationRecordSchema>;

export const aiWorkContinuationKindSchema = z.enum([
  "CONTINUE_AI_WORK",
  "RETRY_RESOLUTION",
  "START_NEW_OPERATION",
]);
export type AIWorkContinuationKind = z.infer<
  typeof aiWorkContinuationKindSchema
>;

export const aiWorkContinuationSchema = z
  .object({
    schemaVersion: z.literal(AI_WORK_SCHEMA_VERSION),
    confirmationId: identifierSchema,
    operationId: identifierSchema,
    kind: aiWorkContinuationKindSchema,
    displayedHistoryRevision: nonNegativeIntegerSchema,
    selectedBudget: z
      .number()
      .int()
      .min(AI_WORK_MIN_TURN_BUDGET)
      .max(AI_WORK_MAX_TURN_BUDGET),
    confirmed: z.boolean(),
    status: z.enum(["PENDING", "CONSUMED", "CANCELLED", "REJECTED"]),
    snapshotId: identifierSchema.optional(),
    createdAt: z.string().min(1).max(128),
    confirmedAt: z.string().min(1).max(128).optional(),
    consumedAt: z.string().min(1).max(128).optional(),
    version: nonNegativeIntegerSchema,
  })
  .strict();
export type AIWorkContinuation = z.infer<typeof aiWorkContinuationSchema>;

export const aiWorkReconciliationSchema = z
  .object({
    schemaVersion: z.literal(AI_WORK_SCHEMA_VERSION),
    reconciliationId: identifierSchema,
    operationId: identifierSchema,
    turnId: identifierSchema,
    outcome: z.enum(["INTERRUPTED", "UNCERTAIN", "CONFIRMED_TERMINAL"]),
    reason: aiWorkReasonSchema,
    evidence: aiJsonValueSchema,
    createdAt: z.string().min(1).max(128),
  })
  .strict();
export type AIWorkReconciliation = z.infer<typeof aiWorkReconciliationSchema>;

export const aiWorkReadModelSchema = z
  .object({
    schemaVersion: z.literal(AI_WORK_SCHEMA_VERSION),
    operation: aiWorkOperationRecordSchema,
    usage: aiWorkUsageSchema,
    remainingBudget: nonNegativeIntegerSchema,
    reports: z.array(aiWorkTurnReportSchema).max(AI_WORK_MAX_REPORT_ITEMS),
    priorOperation: z
      .object({
        operationId: identifierSchema,
        status: aiWorkOperationStatusSchema,
        consumedTurnCount: nonNegativeIntegerSchema,
        remainingTurnCount: nonNegativeIntegerSchema,
        cumulativeUsage: aiWorkUsageSchema,
        reports: z.array(aiWorkTurnReportSchema).max(AI_WORK_MAX_REPORT_ITEMS),
      })
      .strict()
      .optional(),
    stopReason: aiWorkStopReasonSchema.optional(),
    preservedWorktree: aiWorkScopeSchema.optional(),
    permittedNextAction: aiWorkNextActionSchema,
    requiresExplicitConfirmation: z.boolean(),
    attention: z.boolean(),
  })
  .strict();
export type AIWorkReadModel = z.infer<typeof aiWorkReadModelSchema>;

export type AIWorkRecordKind =
  | "operation"
  | "segment"
  | "turn"
  | "report"
  | "continuation"
  | "reconciliation";

export type AIWorkTransitionState =
  AIWorkOperationStatus | AIWorkSegmentStatus | AIWorkTurnStatus;

const OPERATION_TRANSITIONS: Readonly<
  Record<AIWorkOperationStatus, readonly AIWorkOperationStatus[]>
> = {
  CREATED: ["WORKING", "CANCELLED", "NEEDS_ATTENTION", "UNCERTAIN"],
  WORKING: [
    "COMPLETED",
    "NEEDS_ATTENTION",
    "EXHAUSTED",
    "CANCELLED",
    "INTERRUPTED",
    "UNCERTAIN",
  ],
  COMPLETED: [],
  NEEDS_ATTENTION: ["WORKING", "CANCELLED", "UNCERTAIN", "EXHAUSTED"],
  EXHAUSTED: [],
  CANCELLED: [],
  INTERRUPTED: ["NEEDS_ATTENTION", "CANCELLED"],
  UNCERTAIN: ["NEEDS_ATTENTION", "CANCELLED"],
};

const SEGMENT_TRANSITIONS: Readonly<
  Record<AIWorkSegmentStatus, readonly AIWorkSegmentStatus[]>
> = {
  PENDING: ["WORKING", "STOPPED", "CANCELLED", "UNCERTAIN"],
  WORKING: ["COMPLETED", "STOPPED", "CANCELLED", "INTERRUPTED", "UNCERTAIN"],
  COMPLETED: [],
  STOPPED: ["WORKING", "CANCELLED", "UNCERTAIN"],
  CANCELLED: [],
  INTERRUPTED: ["STOPPED", "CANCELLED", "UNCERTAIN"],
  UNCERTAIN: ["STOPPED", "CANCELLED"],
};

const TURN_TRANSITIONS: Readonly<
  Record<AIWorkTurnStatus, readonly AIWorkTurnStatus[]>
> = {
  RESERVED: [
    "STARTED",
    "PRESTART_REFUSED",
    "CANCELLED",
    "INTERRUPTED",
    "UNCERTAIN",
  ],
  STARTED: [
    "COMPLETED",
    "FAILED",
    "CANCELLED",
    "TIMED_OUT",
    "INTERRUPTED",
    "UNCERTAIN",
    "PRESTART_REFUSED",
  ],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
  TIMED_OUT: [],
  INTERRUPTED: ["UNCERTAIN"],
  UNCERTAIN: [],
  PRESTART_REFUSED: [],
};

export function canTransitionAIWorkState(
  kind: AIWorkRecordKind,
  from: AIWorkTransitionState,
  to: AIWorkTransitionState,
): boolean {
  if (kind === "operation")
    return (
      OPERATION_TRANSITIONS[from as AIWorkOperationStatus] ?? []
    ).includes(to as AIWorkOperationStatus);
  if (kind === "segment")
    return (SEGMENT_TRANSITIONS[from as AIWorkSegmentStatus] ?? []).includes(
      to as AIWorkSegmentStatus,
    );
  if (kind === "turn")
    return (TURN_TRANSITIONS[from as AIWorkTurnStatus] ?? []).includes(
      to as AIWorkTurnStatus,
    );
  return false;
}

export function assertAIWorkTransition(
  kind: AIWorkRecordKind,
  from: AIWorkTransitionState,
  to: AIWorkTransitionState,
): void {
  if (!canTransitionAIWorkState(kind, from, to)) {
    throw new TypeError(
      `AI_WORK_INVALID_${kind.toUpperCase()}_TRANSITION:${from}:${to}`,
    );
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Stable key ordering used for fingerprints and reproducible evidence. */
export function canonicalizeAIWorkValue(value: unknown): string {
  const visit = (candidate: unknown, depth: number): unknown => {
    if (depth > 20) throw new TypeError("AI_WORK_FINGERPRINT_TOO_DEEP");
    if (Array.isArray(candidate))
      return candidate.map((item) => visit(item, depth + 1));
    if (isPlainRecord(candidate)) {
      return Object.fromEntries(
        Object.entries(candidate)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, visit(item, depth + 1)]),
      );
    }
    if (
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "boolean" ||
      typeof candidate === "number"
    )
      return candidate;
    throw new TypeError("AI_WORK_FINGERPRINT_VALUE_INVALID");
  };
  const canonical = JSON.stringify(visit(value, 0));
  if (canonical === undefined || canonical.length > 128 * 1024)
    throw new TypeError("AI_WORK_FINGERPRINT_LIMIT_EXCEEDED");
  return canonical;
}

/**
 * A deterministic, bounded digest that is available in both the main and
 * renderer typecheck targets.  F17 treats it as an identity, not as a
 * security primitive; persistence hashes the enclosing record separately.
 */
export function aiWorkStableDigest(value: string): string {
  const seeds = [0x811c9dc5, 0x9e3779b1, 0x85ebca6b, 0xc2b2ae35];
  return seeds
    .map((seed, seedIndex) => {
      let hash = seed >>> 0;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index) + seedIndex;
        hash = Math.imul(hash, 0x01000193) >>> 0;
        hash = (hash ^ (hash >>> 13)) >>> 0;
      }
      return (hash >>> 0).toString(16).padStart(8, "0");
    })
    .join("");
}

export function aiWorkNormalizeUsage(
  usage: AIProviderUsage | undefined,
): AIWorkUsage {
  const fields = [
    "inputTokens",
    "cachedInputTokens",
    "cacheWriteInputTokens",
    "outputTokens",
    "reasoningOutputTokens",
    "totalTokens",
  ] as const;
  if (usage === undefined) return { unavailableFields: [...fields] };
  const result: AIWorkUsage = { ...usage };
  const unavailableFields = fields.filter(
    (field) => usage[field] === undefined,
  );
  if (unavailableFields.length > 0) return { ...result, unavailableFields };
  return result;
}

export function aiWorkAggregateUsage(
  usages: readonly AIWorkUsage[],
): AIWorkUsage {
  const fields = [
    "inputTokens",
    "cachedInputTokens",
    "cacheWriteInputTokens",
    "outputTokens",
    "reasoningOutputTokens",
    "totalTokens",
  ] as const;
  const output: Record<string, number | number[]> = {};
  const unavailable = new Set<string>();
  for (const field of fields) {
    let total = 0;
    let available = usages.length > 0;
    for (const usage of usages) {
      if (usage[field] === undefined) {
        available = false;
        unavailable.add(field);
      } else total += usage[field] as number;
    }
    if (available) output[field] = total;
  }
  return {
    ...(output as Partial<AIWorkUsage>),
    ...(unavailable.size === 0
      ? {}
      : {
          unavailableFields: [
            ...unavailable,
          ].sort() as AIWorkUsage["unavailableFields"],
        }),
  };
}

function safeString(
  value: unknown,
  maximum = AI_WORK_MAX_REPORT_TEXT,
): string | undefined {
  return typeof value === "string" && value.length <= maximum
    ? value
    : undefined;
}

function safeStringArray(
  value: unknown,
  maximum = AI_WORK_MAX_REPORT_ITEMS,
): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.slice(0, AI_WORK_MAX_REPORT_TEXT))
    .slice(0, maximum);
}

function normalizePredicateResult(value: unknown): AIWorkPredicateResult {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {
      valid: false,
      complete: false,
      materialProgress: false,
      reason: "The completion predicate returned an invalid result.",
      remainingProblems: ["predicate-output-invalid"],
    };
  const candidate = value as Record<string, unknown>;
  const reason = safeString(candidate.reason);
  const remainingProblems = candidate.remainingProblems;
  const semanticResultIdentity = candidate.semanticResultIdentity;
  if (
    typeof candidate.valid !== "boolean" ||
    typeof candidate.complete !== "boolean" ||
    typeof candidate.materialProgress !== "boolean" ||
    reason === undefined ||
    reason.length === 0 ||
    !Array.isArray(remainingProblems) ||
    remainingProblems.length > AI_WORK_MAX_REPORT_ITEMS ||
    !remainingProblems.every(
      (problem) =>
        typeof problem === "string" &&
        problem.length <= AI_WORK_MAX_REPORT_TEXT,
    ) ||
    (semanticResultIdentity !== undefined &&
      (typeof semanticResultIdentity !== "string" ||
        semanticResultIdentity.length > 256))
  )
    return {
      valid: false,
      complete: false,
      materialProgress: false,
      reason: "The completion predicate returned an invalid result.",
      remainingProblems: ["predicate-output-invalid"],
    };
  return {
    valid: candidate.valid,
    complete: candidate.complete,
    materialProgress: candidate.materialProgress,
    reason,
    remainingProblems: [...remainingProblems],
    ...(semanticResultIdentity === undefined ? {} : { semanticResultIdentity }),
  };
}

function resultRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainRecord(value) ? value : undefined;
}

export function aiWorkModelClaimsFromProviderResult(
  result: AIProviderTurnResult,
): AIWorkModelClaims {
  const structured = resultRecord(result.structuredResult);
  const approach = safeString(
    structured?.approach ?? structured?.summary ?? structured?.explanation,
  );
  const claimedChangedFiles = safeStringArray(
    structured?.changedFiles ?? structured?.files,
    2_000,
  );
  const claimedCommands = safeStringArray(structured?.commands);
  const completionClaim =
    typeof structured?.complete === "boolean"
      ? structured.complete
      : typeof structured?.completed === "boolean"
        ? structured.completed
        : undefined;
  const eventKinds = [
    ...new Set(result.events.map((event) => event.kind)),
  ].slice(0, 64);
  return {
    ...(approach === undefined ? {} : { approach }),
    problems: safeStringArray(structured?.problems),
    remainingIssues: safeStringArray(
      structured?.remainingIssues ?? structured?.remainingProblems,
    ),
    claimedChangedFiles,
    claimedCommands,
    ...(completionClaim === undefined ? {} : { completionClaim }),
    ...(result.structuredResult === undefined
      ? {}
      : { semanticResult: result.structuredResult }),
    providerEventCount: result.events.length,
    providerEventKinds: eventKinds,
  };
}

function readStringArray(value: unknown, key: string): string[] {
  const record = resultRecord(value);
  return safeStringArray(record?.[key]);
}

function readExpectedEventIds(input: AIJsonValue): string[] {
  const record = resultRecord(input);
  return readStringArray(record, "eventVersionIds");
}

function readProposalItems(
  result: AIProviderTurnResult,
): readonly Record<string, unknown>[] {
  const structured = resultRecord(result.structuredResult);
  if (!Array.isArray(structured?.items)) return [];
  return structured.items
    .filter(isPlainRecord)
    .slice(0, AI_WORK_MAX_REPORT_ITEMS);
}

function proposalPredicate(
  context: AIWorkPredicateContext,
): AIWorkPredicateResult {
  const items = readProposalItems(context.providerResult);
  const expected = readExpectedEventIds(
    context.operation.predicate.inputSnapshot,
  );
  const ids = items
    .map((item) => item.remoteEventVersionId)
    .filter((value): value is string => typeof value === "string");
  const dispositions = items.map((item) => item.disposition);
  const validDisposition = dispositions.every((value) =>
    ["fixed", "pushback", "question", "no_change"].includes(String(value)),
  );
  const uniqueIds = new Set(ids);
  const accounted =
    expected.length === ids.length &&
    expected.every((id) => uniqueIds.has(id)) &&
    uniqueIds.size === ids.length;
  const unchanged =
    context.evidence.worktree.complete &&
    !context.evidence.worktree.forbiddenMutation &&
    context.evidence.worktree.files.length === 0;
  const valid =
    items.length === expected.length && validDisposition && accounted;
  return {
    valid,
    complete: valid && unchanged,
    materialProgress: false,
    reason: !valid
      ? "The proposal did not account for every immutable input event with a supported disposition."
      : !unchanged
        ? "The read-only proposal worktree contains a forbidden or unexpected mutation."
        : "The proposal is complete and the worktree is unchanged.",
    remainingProblems: [
      ...(!valid ? ["proposal-input-accounting"] : []),
      ...(!unchanged ? ["proposal-worktree-unchanged"] : []),
    ],
    semanticResultIdentity: aiWorkStableDigest(
      canonicalizeAIWorkValue({ ids: [...ids].sort(), dispositions }),
    ),
  };
}

function implementationPredicate(
  context: AIWorkPredicateContext,
): AIWorkPredicateResult {
  const input = resultRecord(context.operation.predicate.inputSnapshot);
  const decisions = input?.humanDecisions;
  const decisionsComplete =
    Array.isArray(decisions) &&
    decisions.length > 0 &&
    decisions.every((decision) => {
      const record = resultRecord(decision);
      return (
        record !== undefined &&
        record.decision !== "pending" &&
        typeof record.remoteEventVersionId === "string"
      );
    });
  const validation = context.evidence.validation;
  const validationRequired =
    context.operation.taskSnapshot.buildValidation !== undefined;
  const validationComplete =
    !validationRequired ||
    (validation !== undefined &&
      (validation.status === "passed" ||
        (validation.status === "not_run" &&
          validation.noSafeCommand === true)));
  const worktreeSafe =
    context.evidence.worktree.complete &&
    !context.evidence.worktree.forbiddenMutation &&
    context.evidence.worktree.unmergedPaths.length === 0;
  const valid = decisionsComplete && validationComplete && worktreeSafe;
  return {
    valid,
    complete: valid,
    materialProgress:
      context.evidence.materialProblemIds.length > 0 ||
      context.evidence.worktree.files.some((file) => file.material === true),
    reason: !decisionsComplete
      ? "Final human decisions are incomplete."
      : !validationComplete
        ? "Required deterministic validation is not passing."
        : !worktreeSafe
          ? "The operation worktree is incomplete or contains unresolved state."
          : "The implementation predicate is satisfied by deterministic evidence.",
    remainingProblems: [
      ...(!decisionsComplete ? ["human-decisions-incomplete"] : []),
      ...(!validationComplete ? ["validation-not-passed"] : []),
      ...(!worktreeSafe ? ["worktree-not-resolved"] : []),
    ],
  };
}

function conflictPredicate(
  context: AIWorkPredicateContext,
): AIWorkPredicateResult {
  const validation = context.evidence.validation;
  const validationRequired =
    context.operation.taskSnapshot.buildValidation !== undefined;
  const validationComplete =
    !validationRequired ||
    (validation !== undefined &&
      (validation.status === "passed" ||
        (validation.status === "not_run" &&
          validation.noSafeCommand === true)));
  const clean =
    context.evidence.worktree.complete &&
    !context.evidence.worktree.forbiddenMutation &&
    context.evidence.worktree.unmergedPaths.length === 0 &&
    context.evidence.worktree.conflictMarkers.length === 0;
  const valid = clean && validationComplete;
  return {
    valid,
    complete: valid,
    materialProgress:
      context.evidence.materialProblemIds.length > 0 ||
      context.evidence.worktree.files.some((file) => file.material === true),
    reason: !clean
      ? "Unmerged paths or conflict markers remain in the operation worktree."
      : !validationComplete
        ? "Conflict-resolution validation is not passing."
        : "The conflict-resolution predicate is satisfied by deterministic evidence.",
    remainingProblems: [
      ...(!clean ? ["unresolved-conflict-state"] : []),
      ...(!validationComplete ? ["validation-not-passed"] : []),
    ],
  };
}

export class AIWorkPredicateRegistry {
  private readonly predicates = new Map<string, AIWorkPredicate>();

  public register(predicate: AIWorkPredicate): void {
    if (
      !identifierSchema.safeParse(predicate.id).success ||
      !Number.isSafeInteger(predicate.version) ||
      predicate.version < 1
    )
      throw new TypeError("AI_WORK_PREDICATE_INVALID");
    const key = `${predicate.id}:${predicate.version}`;
    if (this.predicates.has(key))
      throw new TypeError("AI_WORK_PREDICATE_DUPLICATE");
    this.predicates.set(key, predicate);
  }

  public resolve(id: string, version: number): AIWorkPredicate | undefined {
    return this.predicates.get(`${id}:${version}`);
  }

  public list(): readonly AIWorkPredicate[] {
    return [...this.predicates.values()];
  }
}

export function createDefaultAIWorkPredicateRegistry(): AIWorkPredicateRegistry {
  const registry = new AIWorkPredicateRegistry();
  for (const id of ["REVIEW_PROPOSAL", "review-proposal"])
    registry.register({ id, version: 1, evaluate: proposalPredicate });
  for (const id of ["REVIEW_IMPLEMENTATION", "review-implementation"])
    registry.register({ id, version: 1, evaluate: implementationPredicate });
  for (const id of ["MERGE_CONFLICT_RESOLUTION", "merge-conflict-resolution"])
    registry.register({ id, version: 1, evaluate: conflictPredicate });
  return registry;
}

export function evaluateAIWorkProgress(input: {
  readonly operation: AIWorkOperationInput;
  readonly providerResult: AIProviderTurnResult;
  readonly evidence: AIWorkEvidenceBundle;
  readonly predicate: AIWorkPredicate;
  readonly history: readonly AIProgressHistoryEntry[];
  readonly turnId: string;
  readonly evaluatedAt: string;
}): AIProgressEvaluation {
  let predicateResult: AIWorkPredicateResult;
  try {
    predicateResult = normalizePredicateResult(
      input.predicate.evaluate({
        operation: input.operation,
        providerResult: input.providerResult,
        evidence: input.evidence,
      }),
    );
  } catch {
    predicateResult = {
      valid: false,
      complete: false,
      materialProgress: false,
      reason: "The completion predicate failed without a safe result.",
      remainingProblems: ["predicate-evaluation-failed"],
    };
  }
  const evidenceUnavailable =
    !input.evidence.worktree.complete ||
    input.evidence.worktree.forbiddenMutation ||
    input.evidence.deterministicProblems.some(
      (problem) =>
        problem === "worktree-inspection-failed" ||
        problem === "validation-inspection-failed",
    );
  if (evidenceUnavailable) {
    predicateResult = {
      valid: false,
      complete: false,
      materialProgress: false,
      reason:
        "Fresh deterministic evidence was missing, invalid, or contained a forbidden mutation.",
      remainingProblems: ["deterministic-evidence-unavailable"],
    };
  }
  const boundedProblems = predicateResult.remainingProblems
    .filter((problem) => typeof problem === "string")
    .map((problem) => problem.slice(0, AI_WORK_MAX_REPORT_TEXT))
    .slice(0, AI_WORK_MAX_REPORT_ITEMS);
  const fingerprintInput = {
    predicate: {
      id: input.predicate.id,
      version: input.predicate.version,
      input: input.operation.predicate.inputSnapshot,
    },
    evidenceRevision: input.evidence.evidenceRevision,
    evidence: input.evidence,
    deterministicResult: {
      valid: predicateResult.valid,
      complete: predicateResult.complete,
      materialProgress: predicateResult.materialProgress,
      remainingProblems: boundedProblems,
      ...(predicateResult.semanticResultIdentity === undefined
        ? {}
        : { semanticResultIdentity: predicateResult.semanticResultIdentity }),
    },
  };
  let fingerprint: string;
  try {
    fingerprint = aiWorkStableDigest(canonicalizeAIWorkValue(fingerprintInput));
  } catch {
    return {
      schemaVersion: AI_WORK_SCHEMA_VERSION,
      predicateId: input.predicate.id,
      predicateVersion: input.predicate.version,
      evidenceRevision: input.evidence.evidenceRevision,
      fingerprint: aiWorkStableDigest(
        `invalid-fingerprint:${input.predicate.id}:${input.predicate.version}:${input.evidence.evidenceRevision}`,
      ),
      classification: "FAILED",
      complete: false,
      materialProgress: false,
      repeatedState: false,
      consecutiveNoProgress: 0,
      remainingProblems: ["fingerprint-input-invalid"],
      reason: {
        schemaVersion: AI_WORK_SCHEMA_VERSION,
        code: "AI_INVALID_EVIDENCE",
        category: "EVIDENCE",
        what: "The deterministic fingerprint input exceeded F17 bounds or contained an unsupported value.",
        why: "F17 refused to infer progress from an unbounded or invalid evidence record.",
        nextAction: "REVIEW",
        details: { turnId: input.turnId },
      },
      evaluatedAt: input.evaluatedAt,
    };
  }
  const repeatedState = input.history.some(
    (entry) => entry.fingerprint === fingerprint && !entry.complete,
  );
  const prior = input.history[input.history.length - 1];
  const consecutiveNoProgress =
    !predicateResult.complete &&
    !predicateResult.materialProgress &&
    prior !== undefined &&
    !prior.complete &&
    (prior.classification === "NO_PROGRESS" || !prior.materialProgress)
      ? 1 +
        input.history.filter(
          (entry) =>
            !entry.complete &&
            !entry.materialProgress &&
            entry.classification === "NO_PROGRESS",
        ).length
      : !predicateResult.complete && !predicateResult.materialProgress
        ? 1
        : 0;
  let classification: AIWorkProgressClassification;
  let reason: AIWorkReason;
  if (!predicateResult.valid) {
    classification = "FAILED";
    reason = {
      schemaVersion: AI_WORK_SCHEMA_VERSION,
      code: "AI_INVALID_EVIDENCE",
      category: "EVIDENCE",
      what: "The deterministic completion predicate could not validate the turn evidence.",
      why: predicateResult.reason,
      nextAction: "REVIEW",
      details: { turnId: input.turnId },
    };
  } else if (predicateResult.complete) {
    classification = "COMPLETED";
    reason = {
      schemaVersion: AI_WORK_SCHEMA_VERSION,
      code: "AI_COMPLETION_PREDICATE_TRUE",
      category: "COMPLETION",
      what: "The operation-specific completion predicate is satisfied.",
      why: predicateResult.reason,
      nextAction: "NONE",
    };
  } else if (repeatedState) {
    classification = "REPEATED_STATE";
    reason = {
      schemaVersion: AI_WORK_SCHEMA_VERSION,
      code: "AI_REPEATED_STATE",
      category: "PROGRESS",
      what: "The deterministic state fingerprint already occurred in this operation.",
      why: "Automatic work cannot safely make progress from a repeated state.",
      nextAction: "CONTINUE_AI_WORK",
      details: { fingerprint },
    };
  } else if (consecutiveNoProgress >= 2) {
    classification = "NO_PROGRESS";
    reason = {
      schemaVersion: AI_WORK_SCHEMA_VERSION,
      code: "AI_NO_PROGRESS",
      category: "PROGRESS",
      what: "Two consecutive mutating turns made no material deterministic progress.",
      why: predicateResult.reason,
      nextAction: "CONTINUE_AI_WORK",
      details: { consecutiveNoProgress },
    };
  } else if (predicateResult.materialProgress) {
    classification = "MATERIAL_PROGRESS";
    reason = {
      schemaVersion: AI_WORK_SCHEMA_VERSION,
      code: "AI_MATERIAL_PROGRESS",
      category: "PROGRESS",
      what: "Deterministic evidence shows material progress toward the predicate.",
      why: predicateResult.reason,
      nextAction: "RUN_NEXT_TURN",
    };
  } else {
    classification = "NO_PROGRESS";
    reason = {
      schemaVersion: AI_WORK_SCHEMA_VERSION,
      code: "AI_NO_MATERIAL_PROGRESS",
      category: "PROGRESS",
      what: "This turn did not produce material deterministic progress.",
      why: predicateResult.reason,
      nextAction: "RUN_NEXT_TURN",
    };
  }
  return {
    schemaVersion: AI_WORK_SCHEMA_VERSION,
    predicateId: input.predicate.id,
    predicateVersion: input.predicate.version,
    evidenceRevision: input.evidence.evidenceRevision,
    fingerprint,
    classification,
    complete: predicateResult.complete && predicateResult.valid,
    materialProgress: predicateResult.materialProgress,
    repeatedState,
    consecutiveNoProgress,
    remainingProblems: boundedProblems,
    reason,
    evaluatedAt: input.evaluatedAt,
  };
}

export function isAIWorkMutatingTurn(
  interactionMode: AIWorkOperationInput["interactionMode"],
): boolean {
  return interactionMode === "worktree_write";
}

export function isAIWorkTerminalOperation(
  status: AIWorkOperationStatus,
): boolean {
  return ["COMPLETED", "EXHAUSTED", "CANCELLED"].includes(status);
}

export function isAIWorkTerminalTurn(status: AIWorkTurnStatus): boolean {
  return [
    "COMPLETED",
    "FAILED",
    "CANCELLED",
    "TIMED_OUT",
    "INTERRUPTED",
    "UNCERTAIN",
    "PRESTART_REFUSED",
  ].includes(status);
}

export function taskTypeForAIWorkOperation(
  operation: Pick<AIWorkOperationInput, "taskType">,
): AIProviderTaskType {
  return operation.taskType;
}

export interface AIWorkAdmission {
  readonly inserted: boolean;
  readonly operation: AIWorkOperationRecord;
  readonly turn: AIWorkTurnIntent;
}

export interface AIWorkPersistencePort {
  readonly admitOperation: (input: {
    readonly operation: AIWorkOperationInput;
    readonly segmentId: string;
    readonly turnId: string;
    readonly deadlineAt: string;
  }) => AIWorkAdmission;
  readonly reserveNextTurn: (input: {
    readonly operationId: string;
    readonly segmentId: string;
    readonly turnId: string;
    readonly deadlineAt: string;
  }) => AIWorkTurnIntent;
  readonly markTurnStarted: (input: {
    readonly turnId: string;
    readonly startedAt: string;
  }) => AIWorkTurnIntent;
  readonly releaseTurn: (input: {
    readonly turnId: string;
    readonly completedAt: string;
  }) => AIWorkTurnIntent;
  readonly finalizeTurn: (input: {
    readonly turnId: string;
    readonly status: AIWorkTurnStatus;
    readonly report: AIWorkTurnReport;
    readonly operationStatus: AIWorkOperationStatus;
    readonly stopReason?: AIWorkStopReason;
  }) => AIWorkOperationRecord;
  readonly setOperationStatus: (input: {
    readonly operationId: string;
    readonly status: AIWorkOperationStatus;
    readonly stopReason?: AIWorkStopReason;
  }) => AIWorkOperationRecord;
  readonly getOperation: (
    operationId: string,
  ) => AIWorkOperationRecord | undefined;
  readonly createContinuation: (input: {
    readonly confirmation: AIWorkContinuation;
    readonly segmentId: string;
    readonly turnId: string;
    readonly deadlineAt: string;
    readonly taskSnapshot: F16EffectiveAITaskSnapshot;
  }) => AIWorkAdmission;
  readonly createNewOperation: (input: {
    readonly priorOperationId: string;
    readonly confirmation: AIWorkContinuation;
    readonly operation: AIWorkOperationInput;
    readonly segmentId: string;
    readonly turnId: string;
    readonly deadlineAt: string;
  }) => AIWorkAdmission;
  readonly saveContinuation: (input: AIWorkContinuation) => AIWorkContinuation;
  readonly listInFlightTurns: () => readonly AIWorkTurnIntent[];
  readonly reconcileTurn: (input: {
    readonly reconciliation: AIWorkReconciliation;
    readonly status: AIWorkTurnStatus;
    readonly operationStatus: AIWorkOperationStatus;
    readonly stopReason: AIWorkStopReason;
  }) => AIWorkOperationRecord;
}

export type { F16EffectiveAITaskSnapshot };
