import { z } from "zod";
import {
  aiProviderConversationReferenceSchema,
  aiReviewImplementationSchema,
  type AIReviewImplementation,
} from "./ai/provider-contracts";
import { aiWorkUsageSchema, type AIWorkReadModel } from "./ai-work";
import {
  f18BundleItemSchema,
  f18BundleStateSchema,
  f18BundleStageSchema,
  f18ValidationEvidenceSchema,
  f18WorktreeConditionSchema,
  type F18BundleItem,
  type F18ReviewBundleReadModel,
} from "./f18-automatic-review";
import { f22ActionGateSchema } from "./f22-discard-reevaluation";

/**
 * F21 is the explicit, provider-neutral conversation boundary for a Review
 * Bundle.  It is intentionally separate from F20's projection so that a
 * renderer can never turn free-form text into a mutating operation by
 * inference.
 */
export const F21_SCHEMA_VERSION = 1 as const;
export const F21_MAX_TEXT = 64 * 1024;
export const F21_MAX_TURNS = 64;
export const F21_MAX_PROGRESS_EVENTS = 128;

const identifierSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/u);
const textSchema = z.string().min(1).max(F21_MAX_TEXT);
const optionalTextSchema = z.string().max(F21_MAX_TEXT).optional();

export const f21ConversationModeSchema = z.enum([
  "READ_ONLY_CONVERSATION",
  "REVIEW_REVISION",
]);
export type F21ConversationMode = z.infer<typeof f21ConversationModeSchema>;

export const f21ProposalInputKindSchema = z.enum([
  "APPLY_QUESTION_ANSWER",
  "SAVE_ENTRY_INSTRUCTION",
]);
export type F21ProposalInputKind = z.infer<typeof f21ProposalInputKindSchema>;

export const f21TurnStatusSchema = z.enum([
  "ADMITTED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
  "INTERRUPTED",
  "NEEDS_ATTENTION",
]);
export type F21TurnStatus = z.infer<typeof f21TurnStatusSchema>;

export const f21SafeProgressEventSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    occurredAt: z.string().min(1).max(128),
    kind: z.string().min(1).max(64),
    summary: z.string().max(1_024),
  })
  .strict();
export type F21SafeProgressEvent = z.infer<typeof f21SafeProgressEventSchema>;

export const f21ProposalInputSchema = z
  .object({
    schemaVersion: z.literal(F21_SCHEMA_VERSION),
    commandId: identifierSchema,
    bundleId: identifierSchema,
    itemId: identifierSchema,
    kind: f21ProposalInputKindSchema,
    text: textSchema,
    expectedBundleVersion: z.number().int().nonnegative().optional(),
    actionId: identifierSchema.optional(),
    createdAt: z.string().min(1).max(128),
  })
  .strict();
export type F21ProposalEntryInput = z.infer<typeof f21ProposalInputSchema>;

/** A user intent is admitted before F15/F17 is allowed to have an effect. */
export const f21UserIntentSchema = z
  .object({
    schemaVersion: z.literal(F21_SCHEMA_VERSION),
    intentId: identifierSchema,
    bundleId: identifierSchema,
    mode: f21ConversationModeSchema,
    message: textSchema,
    itemIds: z.array(identifierSchema).max(256).optional(),
    decisionSnapshot: z.array(f18BundleItemSchema).max(256).optional(),
    expectedBundleVersion: z.number().int().nonnegative().optional(),
    expectedEvidenceRevision: identifierSchema.optional(),
    acknowledgeUnattributedChanges: z.boolean().optional(),
    priorOperationId: identifierSchema.optional(),
    selectedBudget: z.number().int().min(1).max(10).optional(),
    conversationId: identifierSchema.optional(),
    idempotencyKey: identifierSchema,
    actionId: identifierSchema.optional(),
    createdAt: z.string().min(1).max(128),
  })
  .strict();
export type F21UserIntent = z.infer<typeof f21UserIntentSchema>;

export const f21ConversationMessageSchema = z
  .object({
    schemaVersion: z.literal(F21_SCHEMA_VERSION),
    messageId: identifierSchema,
    bundleId: identifierSchema,
    turnId: identifierSchema,
    role: z.enum(["user", "assistant", "system"]),
    mode: f21ConversationModeSchema,
    text: textSchema,
    createdAt: z.string().min(1).max(128),
  })
  .strict();
export type F21ConversationMessage = z.infer<
  typeof f21ConversationMessageSchema
>;

export const f21ConversationTurnRecordSchema = z
  .object({
    schemaVersion: z.literal(F21_SCHEMA_VERSION),
    turnId: identifierSchema,
    bundleId: identifierSchema,
    mode: f21ConversationModeSchema,
    status: f21TurnStatusSchema,
    operationId: identifierSchema.optional(),
    userMessage: textSchema,
    answer: optionalTextSchema,
    explanation: optionalTextSchema,
    nextStep: optionalTextSchema,
    implementation: aiReviewImplementationSchema.optional(),
    usage: aiWorkUsageSchema.optional(),
    progress: z.array(f21SafeProgressEventSchema).max(F21_MAX_PROGRESS_EVENTS),
    conversationReference: aiProviderConversationReferenceSchema.optional(),
    deterministicProblems: z.array(textSchema).max(64),
    remainingProblems: z.array(textSchema).max(64),
    evidenceRevision: identifierSchema.optional(),
    reportRevision: z.number().int().nonnegative(),
    createdAt: z.string().min(1).max(128),
    updatedAt: z.string().min(1).max(128),
  })
  .strict();
export type F21ConversationTurnRecord = z.infer<
  typeof f21ConversationTurnRecordSchema
>;

export const f21RevisionRequestSchema = z
  .object({
    schemaVersion: z.literal(F21_SCHEMA_VERSION),
    revisionId: identifierSchema,
    bundleId: identifierSchema,
    operationId: identifierSchema,
    message: textSchema,
    decisions: z.array(f18BundleItemSchema).max(256),
    expectedBundleVersion: z.number().int().nonnegative(),
    expectedEvidenceRevision: identifierSchema,
    acknowledgeUnattributedChanges: z.boolean().optional(),
    createdAt: z.string().min(1).max(128),
  })
  .strict();
export type F21ReviewRevisionRequest = z.infer<typeof f21RevisionRequestSchema>;

export const f21RevisionOutcomeSchema = z
  .object({
    schemaVersion: z.literal(F21_SCHEMA_VERSION),
    revisionId: identifierSchema,
    bundleId: identifierSchema,
    operationId: identifierSchema,
    status: z.enum(["READY_FOR_REVIEW", "NEEDS_ATTENTION"]),
    implementation: aiReviewImplementationSchema.optional(),
    worktreeCondition: f18WorktreeConditionSchema.optional(),
    validation: f18ValidationEvidenceSchema.optional(),
    changedFiles: z.array(z.string().min(1).max(4_096)).max(2_000),
    reasons: z.array(textSchema).max(64),
    createdAt: z.string().min(1).max(128),
  })
  .strict();
export type F21ReviewRevisionOutcome = z.infer<typeof f21RevisionOutcomeSchema>;

export const f21ConversationReadModelSchema = z
  .object({
    schemaVersion: z.literal(F21_SCHEMA_VERSION),
    kind: z.literal("REVIEW_CONVERSATION_READ_MODEL"),
    bundleId: identifierSchema,
    bundleVersion: z.number().int().nonnegative(),
    stage: f18BundleStageSchema,
    state: f18BundleStateSchema,
    evidenceRevision: identifierSchema,
    selectedMode: f21ConversationModeSchema.optional(),
    messages: z.array(f21ConversationMessageSchema).max(F21_MAX_TURNS * 2),
    turns: z.array(f21ConversationTurnRecordSchema).max(F21_MAX_TURNS),
    proposalInputs: z.array(f21ProposalInputSchema).max(256),
    activeOperation: z
      .object({
        operationId: identifierSchema,
        mode: f21ConversationModeSchema,
        status: z.string().min(1).max(64),
        remainingBudget: z.number().int().nonnegative(),
        attention: z.boolean(),
        permittedNextAction: z.string().min(1).max(64),
      })
      .strict()
      .optional(),
    f22: f22ActionGateSchema.optional(),
    lastRevision: f21RevisionOutcomeSchema.optional(),
    worktreeCondition: f18WorktreeConditionSchema.optional(),
    capabilities: z
      .object({
        canAsk: z.boolean(),
        canRequestRevision: z.boolean(),
        canSaveProposalInput: z.boolean(),
        canCancel: z.boolean(),
        canContinue: z.boolean(),
        canStartNewOperation: z.boolean(),
      })
      .strict(),
    nextActions: z.array(identifierSchema).max(16),
    authority: z
      .object({
        worktree: z.literal("F13_DETERMINISTIC"),
        validation: z.literal("F14_DETERMINISTIC"),
        provider: z.literal("F15_PROVIDER_ONLY"),
        lifecycle: z.literal("F17_DETERMINISTIC"),
        bundle: z.literal("F18_FINALIZATION"),
        publication: z.literal("NONE"),
      })
      .strict(),
  })
  .strict();
export type F21ConversationReadModel = z.infer<
  typeof f21ConversationReadModelSchema
>;

export interface F21ConversationBoundary {
  readonly read: (bundleId: string) => F21ConversationReadModel;
  readonly saveProposalInput: (
    input: F21ProposalEntryInput,
  ) => F21ConversationReadModel;
  readonly ask: (input: F21UserIntent) => Promise<F21ConversationReadModel>;
  readonly requestRevision: (
    input: F21UserIntent,
  ) => Promise<F21ConversationReadModel>;
  readonly cancel: (input: {
    readonly bundleId: string;
    readonly operationId?: string;
    readonly turnId?: string;
  }) => Promise<F21ConversationReadModel>;
  readonly continue: (input: {
    readonly bundleId: string;
    readonly operationId: string;
    readonly selectedBudget?: number;
    readonly expectedBundleVersion?: number;
  }) => Promise<F21ConversationReadModel>;
  readonly startNewOperation?: (
    input: F21UserIntent,
  ) => Promise<F21ConversationReadModel>;
}

export function f21ReadModelFromBundle(
  bundle: F18ReviewBundleReadModel,
  input: Partial<
    Pick<
      F21ConversationReadModel,
      | "messages"
      | "turns"
      | "proposalInputs"
      | "activeOperation"
      | "f22"
      | "lastRevision"
      | "selectedMode"
    >
  > = {},
): F21ConversationReadModel {
  const evidenceRevision =
    bundle.worktree?.snapshotId ?? `bundle-${bundle.version}`;
  const canAsk = bundle.state !== "WORKING";
  const f22Current =
    input.f22 === undefined ||
    (input.f22.status === "CURRENT" &&
      input.f22.remote.observationRevision !== undefined);
  const f22CanContinue =
    input.f22 === undefined || input.f22.actions.continueOldWork;
  const canRequestRevision =
    bundle.decisionSummary.complete && bundle.state !== "WORKING" && f22Current;
  return f21ConversationReadModelSchema.parse({
    schemaVersion: F21_SCHEMA_VERSION,
    kind: "REVIEW_CONVERSATION_READ_MODEL",
    bundleId: bundle.bundleId,
    bundleVersion: bundle.version,
    stage: bundle.stage,
    state: bundle.state,
    evidenceRevision,
    ...input,
    messages: input.messages ?? [],
    turns: input.turns ?? [],
    proposalInputs: input.proposalInputs ?? [],
    capabilities: {
      canAsk,
      canRequestRevision,
      canSaveProposalInput: bundle.stage === "PROPOSAL_REVIEW",
      canCancel: input.activeOperation?.status === "WORKING",
      canContinue:
        input.activeOperation?.permittedNextAction === "CONTINUE_AI_WORK" &&
        f22CanContinue,
      canStartNewOperation:
        input.activeOperation?.permittedNextAction === "START_NEW_OPERATION" &&
        f22Current,
    },
    nextActions: [
      ...(canAsk ? ["ASK_CLARIFY"] : []),
      ...(canRequestRevision ? ["REQUEST_REVISION"] : []),
      ...(bundle.stage === "PROPOSAL_REVIEW" ? ["SAVE_PROPOSAL_INPUT"] : []),
      ...(input.activeOperation?.permittedNextAction === "CONTINUE_AI_WORK" &&
      f22CanContinue
        ? ["CONTINUE_AI_WORK"]
        : []),
      ...(input.activeOperation?.permittedNextAction ===
        "START_NEW_OPERATION" && f22Current
        ? ["START_NEW_OPERATION"]
        : []),
    ],
    authority: {
      worktree: "F13_DETERMINISTIC",
      validation: "F14_DETERMINISTIC",
      provider: "F15_PROVIDER_ONLY",
      lifecycle: "F17_DETERMINISTIC",
      bundle: "F18_FINALIZATION",
      publication: "NONE",
    },
  });
}

export function f21TurnFromAIWork(input: {
  readonly bundleId: string;
  readonly mode: F21ConversationMode;
  readonly userMessage: string;
  readonly readModel: AIWorkReadModel;
  readonly answer?: string;
  readonly explanation?: string;
  readonly nextStep?: string;
  readonly implementation?: AIReviewImplementation;
  readonly conversationReference?: z.infer<
    typeof aiProviderConversationReferenceSchema
  >;
  readonly progress?: readonly F21SafeProgressEvent[];
  readonly createdAt: string;
  readonly updatedAt: string;
}): F21ConversationTurnRecord {
  const report = input.readModel.reports.at(-1);
  const status: F21TurnStatus =
    input.readModel.operation.status === "COMPLETED" &&
    (report === undefined || report.providerStatus === "completed")
      ? "COMPLETED"
      : input.readModel.operation.status === "CANCELLED"
        ? "CANCELLED"
        : input.readModel.operation.status === "NEEDS_ATTENTION" ||
            input.readModel.operation.status === "EXHAUSTED"
          ? "NEEDS_ATTENTION"
          : "FAILED";
  return f21ConversationTurnRecordSchema.parse({
    schemaVersion: F21_SCHEMA_VERSION,
    turnId: report?.turnId ?? `turn-${input.readModel.operation.operationId}`,
    bundleId: input.bundleId,
    mode: input.mode,
    status,
    operationId: input.readModel.operation.operationId,
    userMessage: input.userMessage,
    ...(input.answer === undefined ? {} : { answer: input.answer }),
    ...(input.explanation === undefined
      ? {}
      : { explanation: input.explanation }),
    ...(input.nextStep === undefined ? {} : { nextStep: input.nextStep }),
    ...(input.implementation === undefined
      ? {}
      : { implementation: input.implementation }),
    usage: input.readModel.usage,
    progress: [...(input.progress ?? [])].slice(-F21_MAX_PROGRESS_EVENTS),
    ...(input.conversationReference === undefined
      ? {}
      : { conversationReference: input.conversationReference }),
    deterministicProblems: report?.deterministicProblems ?? [],
    remainingProblems: report?.remainingProblems ?? [],
    ...(report?.evidence === undefined
      ? {}
      : { evidenceRevision: report.evidence.evidenceRevision }),
    reportRevision: input.readModel.reports.length,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  });
}

export type F21BundleItem = F18BundleItem;
export type F21ReviewBundle = F18ReviewBundleReadModel;
export type F21RevisionImplementation = AIReviewImplementation;
