import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * F15's shared contract is intentionally independent of Electron, Node,
 * SQLite, Git, and every provider SDK. Values from this module are safe to
 * pass between the main process, persistence, and renderer-safe consumers.
 */

export const AI_PROVIDER_SCHEMA_VERSION = 1 as const;
export const AI_PROVIDER_TURN_RESULT_SCHEMA_VERSION = 1 as const;
export const AI_PROVIDER_CONVERSATION_SCHEMA_VERSION = 1 as const;
export const AI_PROVIDER_OPERATION_SCHEMA_VERSION = 1 as const;

export const AI_MAX_IDENTIFIER_LENGTH = 256;
export const AI_MAX_TEXT_LENGTH = 64 * 1024;
export const AI_MAX_EVENT_COUNT = 256;
export const AI_MAX_EVENT_INPUT_COUNT = 256;
export const AI_MAX_ARRAY_LENGTH = 256;
export const AI_MAX_PATH_LENGTH = 4_096;

export type AIJsonPrimitive = string | number | boolean | null;
export type AIJsonValue =
  | AIJsonPrimitive
  | readonly AIJsonValue[]
  | { readonly [key: string]: AIJsonValue };

export type AIProviderTurnStatus =
  "completed" | "failed" | "cancelled" | "timed_out" | "interrupted";

export const aiProviderTaskTypeSchema = z.enum([
  "AUTOMATIC_REVIEW_REEVALUATION",
  "REVIEW_REVISION",
  "READ_ONLY_CONVERSATION",
  "MERGE_CONFLICT_RESOLUTION",
]);
export type AIProviderTaskType = z.infer<typeof aiProviderTaskTypeSchema>;

export const aiProviderInteractionModeSchema = z.enum([
  "read_only",
  "worktree_write",
]);
export type AIProviderInteractionMode = z.infer<
  typeof aiProviderInteractionModeSchema
>;

export const aiProviderReasoningEffortSchema = z.enum([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
  "persistent",
]);
export type AIProviderReasoningEffort = z.infer<
  typeof aiProviderReasoningEffortSchema
>;

export const aiProviderSandboxModeSchema = z.enum([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);
export type AIProviderSandboxMode = z.infer<typeof aiProviderSandboxModeSchema>;

export const aiProviderApprovalPolicySchema = z.enum([
  "never",
  "on-request",
  "on-failure",
  "untrusted",
]);
export type AIProviderApprovalPolicy = z.infer<
  typeof aiProviderApprovalPolicySchema
>;

export const aiProviderNetworkModeSchema = z.enum(["disabled", "enabled"]);
export type AIProviderNetworkMode = z.infer<typeof aiProviderNetworkModeSchema>;

const unsafeKeyPattern =
  /(?:token|secret|password|credential|authorization|cookie|prompt|api[_.-]?key|access[_.-]?key|sdk|exception|environment|env)/iu;
const safeUsageKeys = new Set([
  "inputTokens",
  "cachedInputTokens",
  "cacheWriteInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "totalTokens",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function assertSafeJsonRuntime(value: unknown, depth = 0): void {
  if (depth > 20) throw new TypeError("F15_JSON_TOO_DEEP");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value.length > AI_MAX_TEXT_LENGTH)
      throw new TypeError("F15_JSON_STRING_TOO_LARGE");
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("F15_JSON_NUMBER_INVALID");
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > AI_MAX_ARRAY_LENGTH)
      throw new TypeError("F15_JSON_ARRAY_TOO_LARGE");
    for (const item of value) assertSafeJsonRuntime(item, depth + 1);
    return;
  }
  if (!isPlainRecord(value)) throw new TypeError("F15_JSON_OBJECT_INVALID");
  for (const [key, item] of Object.entries(value)) {
    if (key.length > 128) throw new TypeError("F15_JSON_KEY_TOO_LARGE");
    if (unsafeKeyPattern.test(key) && !safeUsageKeys.has(key))
      throw new TypeError("F15_JSON_UNSAFE_KEY");
    assertSafeJsonRuntime(item, depth + 1);
  }
}

const rawJsonValueSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([
    z.string().max(AI_MAX_TEXT_LENGTH),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(rawJsonValueSchema).max(AI_MAX_ARRAY_LENGTH),
    z.record(z.string().max(128), rawJsonValueSchema),
  ]),
);

/** A recursive, bounded JSON value with secret-shaped keys rejected. */
export const aiJsonValueSchema = rawJsonValueSchema.superRefine(
  (value, context) => {
    try {
      assertSafeJsonRuntime(value);
    } catch (error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "F15_JSON_INVALID",
      });
    }
  },
);

const identifierSchema = z
  .string()
  .min(1)
  .max(AI_MAX_IDENTIFIER_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/u);
const textSchema = z.string().min(1).max(AI_MAX_TEXT_LENGTH);
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const boundedPathSchema = z.string().min(1).max(AI_MAX_PATH_LENGTH);
const absolutePathSchema = boundedPathSchema.refine(
  (value) => /^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(value),
  "F15_WORKTREE_PATH_NOT_ABSOLUTE",
);
const relativePathSchema = boundedPathSchema.refine(
  (value) =>
    !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(value) &&
    !value.split(/[\\/]/u).includes(".."),
  "F15_RELATIVE_PATH_INVALID",
);

export const aiProviderProfileSnapshotSchema = z
  .object({
    schemaVersion: z.literal(AI_PROVIDER_SCHEMA_VERSION),
    profileId: identifierSchema,
    profileRevision: nonNegativeIntegerSchema,
    providerId: identifierSchema,
    modelId: identifierSchema,
    taskType: aiProviderTaskTypeSchema,
    reasoningEffort: aiProviderReasoningEffortSchema.optional(),
    commonInstructions: textSchema.optional(),
    repositoryInstructions: textSchema.optional(),
    buildAndValidationInstructions: textSchema.optional(),
    outputContractId: z.string().max(128).optional(),
  })
  .strict();
export type AIProviderProfileSnapshot = z.infer<
  typeof aiProviderProfileSnapshotSchema
>;

const controlledEnvironmentSchema = z
  .object({
    mode: z.literal("explicit"),
    allowedKeys: z.array(z.string().min(1).max(128)).max(64),
  })
  .strict();

export const aiProviderExecutionPolicySnapshotSchema = z
  .object({
    schemaVersion: z.literal(AI_PROVIDER_SCHEMA_VERSION),
    snapshotHash: identifierSchema,
    policyId: identifierSchema.optional(),
    revision: nonNegativeIntegerSchema.optional(),
    sandboxMode: aiProviderSandboxModeSchema,
    approvalPolicy: aiProviderApprovalPolicySchema,
    networkAccess: aiProviderNetworkModeSchema.optional(),
    networkAccessEnabled: z.boolean().optional(),
    writableRoot: absolutePathSchema.optional(),
    controlledEnvironment: controlledEnvironmentSchema,
    requiresInteractiveApproval: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.networkAccess === undefined &&
      value.networkAccessEnabled === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["networkAccess"],
        message: "F15_NETWORK_POLICY_MISSING",
      });
    }
    if (
      value.networkAccess !== undefined &&
      value.networkAccessEnabled !== undefined &&
      (value.networkAccess === "enabled") !== value.networkAccessEnabled
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["networkAccessEnabled"],
        message: "F15_NETWORK_POLICY_CONFLICT",
      });
    }
  });
export type AIProviderExecutionPolicySnapshot = z.infer<
  typeof aiProviderExecutionPolicySnapshotSchema
>;

const f13FileKindSchema = z.enum([
  "modified",
  "added",
  "deleted",
  "renamed",
  "copied",
  "untracked",
  "ignored",
  "type_changed",
  "unknown",
]);

const aiProviderWorktreeFileSchema = z
  .object({
    path: relativePathSchema,
    kind: f13FileKindSchema,
    staged: z.boolean(),
    worktreeChanged: z.boolean(),
    oldPath: relativePathSchema.optional(),
    contentHash: identifierSchema.optional(),
    sizeBytes: nonNegativeIntegerSchema.optional(),
    binary: z.boolean().optional(),
  })
  .strict();

const aiProviderActualStateSchema = z
  .object({
    snapshotId: identifierSchema,
    stateFingerprint: identifierSchema,
    baselineRevision: identifierSchema,
    expectedHeadRevision: identifierSchema,
    currentHeadRevision: identifierSchema.optional(),
    files: z.array(aiProviderWorktreeFileSchema).max(2_000),
    ignoredFiles: z.array(relativePathSchema).max(2_000),
    complete: z.boolean(),
  })
  .strict();

export const aiProviderWorktreeSchema = z
  .object({
    schemaVersion: z.literal(AI_PROVIDER_SCHEMA_VERSION),
    operationId: identifierSchema,
    worktreeId: identifierSchema,
    ownerType: identifierSchema,
    ownerId: identifierSchema,
    operationKind: z.enum(["REVIEW", "CONVERSATION", "SYNCHRONIZATION"]),
    canonicalPath: absolutePathSchema,
    access: z.enum(["READ_ONLY", "WORKTREE_WRITE"]),
    ownership: z
      .object({
        kind: z.literal("OPERATION_OWNED"),
        ownerType: identifierSchema,
        ownerId: identifierSchema,
      })
      .strict(),
    actualState: aiProviderActualStateSchema,
    permittedCapabilities: z
      .object({
        readFiles: z.literal(true),
        writeFiles: z.boolean(),
        executeCommands: z.boolean(),
        network: z.boolean(),
        publication: z.literal(false),
      })
      .strict(),
  })
  .strict();
export type AIProviderWorktreeReference = z.infer<
  typeof aiProviderWorktreeSchema
>;

const repositoryIdentitySchema = z
  .object({
    serverId: identifierSchema,
    owner: identifierSchema,
    name: identifierSchema,
    key: identifierSchema.optional(),
  })
  .strict();

const pullRequestSnapshotSchema = z
  .object({
    baseRepository: repositoryIdentitySchema,
    headRepository: repositoryIdentitySchema,
    baseBranch: textSchema,
    headBranch: textSchema,
    baseSha: identifierSchema,
    headSha: identifierSchema,
  })
  .strict();

const instructionSnapshotSchema = z
  .object({
    commonInstructions: textSchema.optional(),
    repositoryInstructions: textSchema.optional(),
    buildAndValidationInstructions: textSchema.optional(),
  })
  .strict();

const humanDecisionSchema = z
  .object({
    remoteEventVersionId: identifierSchema,
    disposition: z.enum(["fixed", "pushback", "question", "no_change"]),
    instruction: textSchema.optional(),
    answer: textSchema.optional(),
  })
  .strict();

const reviewFeedbackInputSchema = z
  .object({
    remoteEventVersionId: identifierSchema,
    sourceKind: identifierSchema,
    sourceId: identifierSchema,
    body: z.string().max(AI_MAX_TEXT_LENGTH).optional(),
    author: z.string().max(512).optional(),
    path: relativePathSchema.optional(),
    line: z.number().int().positive().max(10_000_000).optional(),
    diffHunk: z
      .string()
      .max(32 * 1024)
      .optional(),
  })
  .strict();

export const aiProviderInputSnapshotSchema = z
  .object({
    schemaVersion: z.literal(AI_PROVIDER_SCHEMA_VERSION),
    /** Explicit user text; it is never interpreted as an execution command. */
    userMessage: z.string().max(AI_MAX_TEXT_LENGTH).optional(),
    conversationId: identifierSchema.optional(),
    remoteEventVersionIds: z
      .array(identifierSchema)
      .min(0)
      .max(AI_MAX_EVENT_INPUT_COUNT),
    eventVersionIds: z
      .array(identifierSchema)
      .max(AI_MAX_EVENT_INPUT_COUNT)
      .optional(),
    pullRequest: pullRequestSnapshotSchema.optional(),
    instructions: instructionSnapshotSchema.optional(),
    prIntentContext: z.string().max(AI_MAX_TEXT_LENGTH).optional(),
    humanDecisions: z
      .array(humanDecisionSchema)
      .max(AI_MAX_EVENT_INPUT_COUNT)
      .optional(),
    feedback: z
      .array(reviewFeedbackInputSchema)
      .max(AI_MAX_EVENT_INPUT_COUNT)
      .optional(),
    validationEvidence: z.array(aiJsonValueSchema).max(32).optional(),
    contextReferences: z.array(identifierSchema).max(64).optional(),
    /** F26's immutable two-sided merge context. */
    conflictContext: aiJsonValueSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.eventVersionIds !== undefined &&
      value.eventVersionIds.length !== value.remoteEventVersionIds.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["eventVersionIds"],
        message: "F15_EVENT_VERSION_ALIAS_MISMATCH",
      });
    }
  });
export type AIProviderInputSnapshot = z.infer<
  typeof aiProviderInputSnapshotSchema
>;

export const aiProviderOutputContractSchema = z
  .object({
    contractId: z.enum([
      "REVIEW_PROPOSAL",
      "REVIEW_IMPLEMENTATION",
      "READ_ONLY_CONVERSATION",
      "CONFLICT_RESOLUTION",
    ]),
    schemaVersion: z.literal(AI_PROVIDER_SCHEMA_VERSION),
    dialect: z.literal("openai_json_schema").optional(),
  })
  .strict();
export type AIProviderOutputContract = z.infer<
  typeof aiProviderOutputContractSchema
>;

export const aiProviderUsageSchema = z
  .object({
    inputTokens: nonNegativeIntegerSchema.optional(),
    cachedInputTokens: nonNegativeIntegerSchema.optional(),
    cacheWriteInputTokens: nonNegativeIntegerSchema.optional(),
    outputTokens: nonNegativeIntegerSchema.optional(),
    reasoningOutputTokens: nonNegativeIntegerSchema.optional(),
    totalTokens: nonNegativeIntegerSchema.optional(),
  })
  .strict();

export interface AIProviderUsage {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheWriteInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningOutputTokens?: number;
  readonly totalTokens?: number;
}

export const aiProviderConversationReferenceSchema = z
  .object({
    schemaVersion: z.literal(AI_PROVIDER_CONVERSATION_SCHEMA_VERSION),
    providerId: identifierSchema,
    opaqueReference: z.string().min(1).max(512),
    resumable: z.boolean(),
    taskType: aiProviderTaskTypeSchema.optional(),
    policySnapshotHash: identifierSchema.optional(),
    profileRevision: nonNegativeIntegerSchema.optional(),
  })
  .strict();

export interface AIProviderConversationReference {
  readonly schemaVersion: typeof AI_PROVIDER_CONVERSATION_SCHEMA_VERSION;
  readonly providerId: string;
  readonly opaqueReference: string;
  readonly resumable: boolean;
  readonly taskType?: AIProviderTaskType;
  readonly policySnapshotHash?: string;
  readonly profileRevision?: number;
}

export const aiProviderEventKindSchema = z.enum([
  "thread_started",
  "turn_started",
  "progress",
  "item_activity",
  "file_change",
  "command",
  "usage",
  "turn_completed",
  "cancelled",
  "failure",
]);
export type AIProviderEventKind = z.infer<typeof aiProviderEventKindSchema>;

export const aiProviderNormalizedEventSchema = z
  .object({
    schemaVersion: z.literal(AI_PROVIDER_TURN_RESULT_SCHEMA_VERSION),
    sequence: nonNegativeIntegerSchema,
    occurredAt: z.string().min(1).max(128),
    providerId: identifierSchema,
    turnId: identifierSchema,
    kind: aiProviderEventKindSchema,
    details: aiJsonValueSchema.optional(),
  })
  .strict();

export interface AIProviderNormalizedEvent {
  readonly schemaVersion: typeof AI_PROVIDER_TURN_RESULT_SCHEMA_VERSION;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly providerId: string;
  readonly turnId: string;
  readonly kind: string;
  readonly details?: AIJsonValue;
}

export const aiProviderSafeErrorSchema = z
  .object({
    code: identifierSchema,
    category: identifierSchema,
    retryable: z.boolean(),
    userAction: identifierSchema,
    detail: textSchema.optional(),
    providerReference: z.string().min(1).max(512).optional(),
  })
  .strict();

export interface AIProviderSafeError {
  readonly code: string;
  readonly category: string;
  readonly retryable: boolean;
  readonly userAction: string;
  readonly detail?: string;
  readonly providerReference?: string;
}

export const aiProviderInvocationMetadataSchema = z
  .object({
    timeoutMs: z.number().int().min(100).max(600_000),
    maxOutputBytes: z
      .number()
      .int()
      .min(1_024)
      .max(4 * 1024 * 1024)
      .optional(),
    streamEvents: z.boolean().optional(),
  })
  .strict();
export type AIProviderInvocationMetadata = z.infer<
  typeof aiProviderInvocationMetadataSchema
>;

export const aiProviderRequestSchema = z
  .object({
    schemaVersion: z.literal(AI_PROVIDER_SCHEMA_VERSION),
    requestId: identifierSchema,
    operationId: identifierSchema,
    turnId: identifierSchema,
    providerId: identifierSchema,
    modelId: identifierSchema,
    taskType: aiProviderTaskTypeSchema,
    interactionMode: aiProviderInteractionModeSchema,
    profileSnapshot: aiProviderProfileSnapshotSchema,
    executionPolicySnapshot: aiProviderExecutionPolicySnapshotSchema,
    worktree: aiProviderWorktreeSchema.optional(),
    input: aiProviderInputSnapshotSchema,
    outputContract: aiProviderOutputContractSchema,
    invocation: aiProviderInvocationMetadataSchema,
    conversationContinuation: z
      .object({
        authorized: z.boolean(),
        reference: aiProviderConversationReferenceSchema,
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const codeTask = value.taskType !== "READ_ONLY_CONVERSATION";
    if (codeTask && value.worktree === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["worktree"],
        message: "F15_WORKTREE_REFERENCE_REQUIRED",
      });
    }
    if (
      value.taskType === "READ_ONLY_CONVERSATION" &&
      value.interactionMode !== "read_only"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["interactionMode"],
        message: "F15_READ_ONLY_TASK_REQUIRES_READ_ONLY_MODE",
      });
    }
    if (
      (value.taskType === "REVIEW_REVISION" ||
        value.taskType === "MERGE_CONFLICT_RESOLUTION") &&
      value.interactionMode !== "worktree_write"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["interactionMode"],
        message: "F15_MUTATING_TASK_REQUIRES_WORKTREE_WRITE_MODE",
      });
    }
    if (
      value.interactionMode === "read_only" &&
      value.worktree?.access === "WORKTREE_WRITE"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["worktree", "access"],
        message: "F15_READ_ONLY_PATH_WRITE_ACCESS",
      });
    }
    if (value.profileSnapshot.providerId !== value.providerId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profileSnapshot", "providerId"],
        message: "F15_PROVIDER_PROFILE_MISMATCH",
      });
    }
    if (value.profileSnapshot.modelId !== value.modelId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profileSnapshot", "modelId"],
        message: "F15_MODEL_PROFILE_MISMATCH",
      });
    }
    if (value.profileSnapshot.taskType !== value.taskType) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profileSnapshot", "taskType"],
        message: "F15_TASK_PROFILE_MISMATCH",
      });
    }
    const expectedContract = outputContractForTask(value.taskType).contractId;
    if (value.outputContract.contractId !== expectedContract) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outputContract", "contractId"],
        message: "F15_TASK_OUTPUT_CONTRACT_MISMATCH",
      });
    }
    if (
      value.conversationContinuation !== undefined &&
      value.conversationContinuation.reference.providerId !== value.providerId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conversationContinuation", "reference", "providerId"],
        message: "F15_CONVERSATION_PROVIDER_MISMATCH",
      });
    }
    if (
      value.conversationContinuation?.reference.taskType !== undefined &&
      value.conversationContinuation.reference.taskType !== value.taskType
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conversationContinuation", "reference", "taskType"],
        message: "F15_CONVERSATION_TASK_MISMATCH",
      });
    }
    if (
      value.conversationContinuation?.reference.policySnapshotHash !==
        undefined &&
      value.conversationContinuation.reference.policySnapshotHash !==
        value.executionPolicySnapshot.snapshotHash
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conversationContinuation", "reference", "policySnapshotHash"],
        message: "F15_CONVERSATION_POLICY_MISMATCH",
      });
    }
    if (
      value.conversationContinuation?.reference.profileRevision !== undefined &&
      value.conversationContinuation.reference.profileRevision !==
        value.profileSnapshot.profileRevision
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conversationContinuation", "reference", "profileRevision"],
        message: "F15_CONVERSATION_PROFILE_MISMATCH",
      });
    }
  });
export type AIProviderRequest = z.infer<typeof aiProviderRequestSchema>;

/** Optional, provider-neutral model admission metadata consumed by F16. */
export const aiProviderModelDescriptorSchema = z
  .object({
    modelId: identifierSchema,
    taskTypes: z.array(aiProviderTaskTypeSchema).max(16).optional(),
    reasoningEfforts: z
      .array(aiProviderReasoningEffortSchema)
      .max(16)
      .optional(),
    supportedOptionKeys: z.array(z.string().min(1).max(128)).max(64).optional(),
  })
  .strict();
export type AIProviderModelDescriptor = z.infer<
  typeof aiProviderModelDescriptorSchema
>;

export const aiProviderOptionBoundsSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    boundsRevision: z.string().min(1).max(128),
    maxBytes: z
      .number()
      .int()
      .min(1)
      .max(16 * 1024),
    maxObjectDepth: z.number().int().min(1).max(8),
    maxObjectKeys: z.number().int().min(1).max(64),
    maxArrayItems: z.number().int().min(1).max(128),
  })
  .strict();
export type AIProviderOptionBounds = z.infer<
  typeof aiProviderOptionBoundsSchema
>;

export const aiProviderCapabilitiesSchema = z
  .object({
    schemaVersion: z.literal(AI_PROVIDER_SCHEMA_VERSION),
    providerId: identifierSchema,
    enabled: z.boolean(),
    taskTypes: z.array(aiProviderTaskTypeSchema).max(16),
    outputContracts: z.array(aiProviderOutputContractSchema).max(16),
    structuredOutputDialects: z.array(z.literal("openai_json_schema")).max(8),
    streaming: z.boolean(),
    conversationContinuation: z.boolean(),
    reasoningEfforts: z.array(aiProviderReasoningEffortSchema).max(16),
    sandboxModes: z.array(aiProviderSandboxModeSchema).max(8),
    approvalPolicies: z.array(aiProviderApprovalPolicySchema).max(8),
    networkModes: z.array(aiProviderNetworkModeSchema).max(4),
    worktreeAccess: z.enum(["none", "read_only", "worktree_write"]),
    controlledEnvironment: z.boolean(),
    modelCatalog: z.array(aiProviderModelDescriptorSchema).max(64).optional(),
    providerOptionBounds: aiProviderOptionBoundsSchema.optional(),
  })
  .strict();
export type AIProviderCapabilities = z.infer<
  typeof aiProviderCapabilitiesSchema
>;

const relatedFilesSchema = z.array(relativePathSchema).max(128);
const implementationProposalSchema = z
  .object({
    summary: textSchema,
    relatedFiles: relatedFilesSchema.optional(),
    acceptanceNotes: textSchema.optional(),
  })
  .strict();

export const aiReviewProposalItemSchema = z
  .object({
    remoteEventVersionId: identifierSchema,
    assessment: z.enum(["actionable", "not_actionable", "unclear"]),
    disposition: z.enum(["fixed", "pushback", "question", "no_change"]),
    explanation: textSchema,
    implementationProposal: implementationProposalSchema.optional(),
    proposedReply: textSchema.optional(),
    relatedFiles: relatedFilesSchema,
  })
  .strict();

export const aiReviewProposalSchema = z
  .object({
    schemaVersion: z.literal(AI_PROVIDER_SCHEMA_VERSION),
    summary: textSchema,
    items: z.array(aiReviewProposalItemSchema).max(AI_MAX_EVENT_INPUT_COUNT),
  })
  .strict();
export type AIReviewProposal = z.infer<typeof aiReviewProposalSchema>;

const implementationOutcomeSchema = z
  .object({
    remoteEventVersionId: identifierSchema,
    decision: z.enum(["fixed", "pushback", "question", "no_change"]),
    outcome: z.enum(["attempted", "skipped", "blocked"]),
    assessment: z.enum(["actionable", "not_actionable", "unclear"]).optional(),
    explanation: textSchema.optional(),
    report: textSchema.optional(),
    remainingIssues: z.array(textSchema).max(64).optional(),
    proposedReply: textSchema.optional(),
    relatedFiles: relatedFilesSchema.optional(),
  })
  .strict();

export const aiReviewImplementationSchema = z
  .object({
    schemaVersion: z.literal(AI_PROVIDER_SCHEMA_VERSION),
    summary: textSchema,
    approach: textSchema.optional(),
    problems: z.array(textSchema).max(64),
    remainingIssues: z.array(textSchema).max(64),
    outcomes: z
      .array(implementationOutcomeSchema)
      .max(AI_MAX_EVENT_INPUT_COUNT),
  })
  .strict();
export type AIReviewImplementation = z.infer<
  typeof aiReviewImplementationSchema
>;

export const aiReadOnlyConversationResultSchema = z
  .object({
    schemaVersion: z.literal(AI_PROVIDER_SCHEMA_VERSION),
    interaction: z.literal("read_only"),
    answer: textSchema,
    explanation: textSchema.optional(),
    nextStep: textSchema.optional(),
  })
  .strict();
export type AIReadOnlyConversationResult = z.infer<
  typeof aiReadOnlyConversationResultSchema
>;

export const aiConflictResolutionResultSchema = z
  .object({
    schemaVersion: z.literal(AI_PROVIDER_SCHEMA_VERSION),
    status: z.enum(["resolved", "ambiguous", "blocked"]),
    summary: textSchema,
    remainingIssues: z.array(textSchema).max(64),
    competingIntents: z.array(textSchema).max(16).optional(),
    possibleDirections: z.array(textSchema).max(16).optional(),
    sourceIntent: textSchema.optional(),
    destinationIntent: textSchema.optional(),
    resolutionScope: z
      .enum(["CONFLICT_ONLY", "CONFLICT_AND_REQUIRED_SUPPORTING"])
      .optional(),
    confidence: z.number().min(0).max(1).optional(),
    evidence: z.array(textSchema).max(64).optional(),
    userQuestion: textSchema.optional(),
    relatedFiles: relatedFilesSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "ambiguous" && value.userQuestion === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["userQuestion"],
        message: "F15_AMBIGUOUS_CONFLICT_REQUIRES_USER_QUESTION",
      });
    }
  });
export type AIConflictResolutionResult = z.infer<
  typeof aiConflictResolutionResultSchema
>;

export const aiProviderOutputSchemas = {
  REVIEW_PROPOSAL: aiReviewProposalSchema,
  REVIEW_IMPLEMENTATION: aiReviewImplementationSchema,
  READ_ONLY_CONVERSATION: aiReadOnlyConversationResultSchema,
  CONFLICT_RESOLUTION: aiConflictResolutionResultSchema,
} as const;

export type AIProviderStructuredResult =
  | AIReviewProposal
  | AIReviewImplementation
  | AIReadOnlyConversationResult
  | AIConflictResolutionResult;

export function outputContractForTask(
  taskType: AIProviderTaskType,
): AIProviderOutputContract {
  const contractId =
    taskType === "AUTOMATIC_REVIEW_REEVALUATION"
      ? "REVIEW_PROPOSAL"
      : taskType === "REVIEW_REVISION"
        ? "REVIEW_IMPLEMENTATION"
        : taskType === "READ_ONLY_CONVERSATION"
          ? "READ_ONLY_CONVERSATION"
          : "CONFLICT_RESOLUTION";
  return {
    contractId,
    schemaVersion: AI_PROVIDER_SCHEMA_VERSION,
    dialect: "openai_json_schema",
  };
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalJson(item)]),
  );
}

/** Generate stable OpenAI-compatible structured-output JSON Schema bytes. */
export function generateAIProviderJsonSchema(
  contract: AIProviderOutputContract | AIProviderOutputContract["contractId"],
): Record<string, unknown> {
  const contractId =
    typeof contract === "string" ? contract : contract.contractId;
  const schema = aiProviderOutputSchemas[contractId];
  const generated = zodToJsonSchema(schema, {
    name: contractId,
    target: "openAi",
    $refStrategy: "none",
    removeAdditionalStrategy: "strict",
  });
  return canonicalJson(generated) as Record<string, unknown>;
}

export function serializeAIProviderJsonSchema(
  contract: AIProviderOutputContract | AIProviderOutputContract["contractId"],
): string {
  return JSON.stringify(generateAIProviderJsonSchema(contract));
}

export function parseAIProviderStructuredResult(
  contract: AIProviderOutputContract,
  value: unknown,
  expectedRemoteEventVersionIds?: readonly string[],
):
  | { readonly success: true; readonly data: AIProviderStructuredResult }
  | {
      readonly success: false;
      readonly code: "INVALID_STRUCTURED_OUTPUT";
      readonly detail: string;
    } {
  const schema = aiProviderOutputSchemas[contract.contractId];
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    return {
      success: false,
      code: "INVALID_STRUCTURED_OUTPUT",
      detail: parsed.error.issues
        .slice(0, 8)
        .map((issue) => `${issue.path.join(".")}:${issue.message}`)
        .join("; "),
    };
  if (
    contract.contractId === "REVIEW_PROPOSAL" &&
    expectedRemoteEventVersionIds !== undefined
  ) {
    try {
      assertAIReviewProposalEventCoverage(
        parsed.data as AIReviewProposal,
        expectedRemoteEventVersionIds,
      );
    } catch (error) {
      return {
        success: false,
        code: "INVALID_STRUCTURED_OUTPUT",
        detail:
          error instanceof Error ? error.message : "F15_EVENT_COVERAGE_INVALID",
      };
    }
  }
  if (
    contract.contractId === "REVIEW_IMPLEMENTATION" &&
    expectedRemoteEventVersionIds !== undefined
  ) {
    try {
      assertAIReviewImplementationDecisionCoverage(
        parsed.data as AIReviewImplementation,
        expectedRemoteEventVersionIds,
      );
    } catch (error) {
      return {
        success: false,
        code: "INVALID_STRUCTURED_OUTPUT",
        detail:
          error instanceof Error
            ? error.message
            : "F15_DECISION_COVERAGE_INVALID",
      };
    }
  }
  return { success: true, data: parsed.data as AIProviderStructuredResult };
}

export function assertAIReviewProposalEventCoverage(
  proposal: AIReviewProposal,
  expectedRemoteEventVersionIds: readonly string[],
): void {
  const expected = new Set(expectedRemoteEventVersionIds);
  if (expected.size !== expectedRemoteEventVersionIds.length)
    throw new TypeError("F15_EXPECTED_EVENT_IDS_DUPLICATED");
  const actual = proposal.items.map((item) => item.remoteEventVersionId);
  if (new Set(actual).size !== actual.length)
    throw new TypeError("F15_RESULT_EVENT_IDS_DUPLICATED");
  if (actual.length !== expected.size)
    throw new TypeError("F15_RESULT_EVENT_IDS_INCOMPLETE");
  for (const eventId of actual) {
    if (!expected.has(eventId))
      throw new TypeError("F15_RESULT_EVENT_ID_OUT_OF_SCOPE");
  }
}

export function assertAIReviewImplementationDecisionCoverage(
  implementation: AIReviewImplementation,
  expectedDecisionIds: readonly string[],
): void {
  const expected = new Set(expectedDecisionIds);
  if (expected.size !== expectedDecisionIds.length)
    throw new TypeError("F15_EXPECTED_DECISION_IDS_DUPLICATED");
  const actual = implementation.outcomes.map(
    (outcome) => outcome.remoteEventVersionId,
  );
  if (new Set(actual).size !== actual.length)
    throw new TypeError("F15_RESULT_DECISION_IDS_DUPLICATED");
  if (actual.length !== expected.size)
    throw new TypeError("F15_RESULT_DECISION_IDS_INCOMPLETE");
  for (const decisionId of actual) {
    if (!expected.has(decisionId))
      throw new TypeError("F15_RESULT_DECISION_ID_OUT_OF_SCOPE");
  }
}

export function assertAIProviderRequest(
  value: unknown,
): asserts value is AIProviderRequest {
  const parsed = aiProviderRequestSchema.safeParse(value);
  if (!parsed.success) throw new TypeError("F15_INVALID_PROVIDER_REQUEST");
  const request = parsed.data;
  const networkEnabled =
    request.executionPolicySnapshot.networkAccess === "enabled" ||
    request.executionPolicySnapshot.networkAccessEnabled === true;
  if (
    request.worktree !== undefined &&
    request.worktree.ownership.ownerId !== request.worktree.ownerId
  ) {
    throw new TypeError("F15_WORKTREE_OWNER_MISMATCH");
  }
  if (
    request.worktree !== undefined &&
    request.worktree.ownership.ownerType !== request.worktree.ownerType
  ) {
    throw new TypeError("F15_WORKTREE_OWNER_TYPE_MISMATCH");
  }
  if (
    request.worktree !== undefined &&
    request.worktree.operationId !== request.operationId
  ) {
    throw new TypeError("F15_WORKTREE_OPERATION_MISMATCH");
  }
  if (
    request.worktree !== undefined &&
    request.executionPolicySnapshot.writableRoot !== undefined &&
    normalizePath(request.executionPolicySnapshot.writableRoot) !==
      normalizePath(request.worktree.canonicalPath)
  ) {
    throw new TypeError("F15_WORKTREE_ROOT_MISMATCH");
  }
  if (
    request.worktree?.permittedCapabilities.network === false &&
    networkEnabled
  )
    throw new TypeError("F15_POLICY_NETWORK_BROADENING");
  if (request.worktree !== undefined && !request.worktree.actualState.complete)
    throw new TypeError("F15_WORKTREE_EVIDENCE_INCOMPLETE");
  if (
    request.worktree?.access === "READ_ONLY" &&
    request.worktree.permittedCapabilities.writeFiles
  )
    throw new TypeError("F15_READ_ONLY_WRITE_CAPABILITY");
  if (
    request.worktree?.access === "WORKTREE_WRITE" &&
    !request.worktree.permittedCapabilities.writeFiles
  )
    throw new TypeError("F15_MUTATING_WRITE_CAPABILITY_MISSING");
  if (
    request.taskType === "AUTOMATIC_REVIEW_REEVALUATION" &&
    request.worktree?.access !== "READ_ONLY"
  ) {
    throw new TypeError("F15_PROPOSAL_NOT_READ_ONLY");
  }
  if (
    request.interactionMode === "worktree_write" &&
    request.worktree?.access !== "WORKTREE_WRITE"
  ) {
    throw new TypeError("F15_MUTATING_WORKTREE_NOT_WRITABLE");
  }
}

function normalizePath(value: string): string {
  return value
    .replace(/[\\/]+/gu, "\\")
    .replace(/\\$/u, "")
    .toLowerCase();
}

export const aiProviderTurnResultSchema = z
  .object({
    schemaVersion: z.literal(AI_PROVIDER_TURN_RESULT_SCHEMA_VERSION),
    requestId: identifierSchema,
    operationId: identifierSchema,
    turnId: identifierSchema,
    providerId: identifierSchema,
    modelId: identifierSchema,
    taskType: textSchema,
    profileRevision: nonNegativeIntegerSchema,
    executionPolicySnapshot: z
      .object({
        schemaVersion: nonNegativeIntegerSchema,
        snapshotHash: identifierSchema,
      })
      .strict(),
    startedAt: z.string().min(1).max(128),
    completedAt: z.string().min(1).max(128),
    status: z.enum([
      "completed",
      "failed",
      "cancelled",
      "timed_out",
      "interrupted",
    ]),
    interactionMode: aiProviderInteractionModeSchema.optional(),
    reasoningEffort: aiProviderReasoningEffortSchema.optional(),
    outputContract: aiProviderOutputContractSchema.optional(),
    profileSnapshot: aiJsonValueSchema.optional(),
    structuredResult: aiJsonValueSchema.optional(),
    events: z.array(aiProviderNormalizedEventSchema).max(AI_MAX_EVENT_COUNT),
    usage: aiProviderUsageSchema.optional(),
    conversationReference: aiProviderConversationReferenceSchema.optional(),
    error: aiProviderSafeErrorSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    value.events.forEach((event, index) => {
      if (event.sequence !== index) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["events", index, "sequence"],
          message: "F15_EVENT_SEQUENCE_INVALID",
        });
      }
    });
  });

export interface AIProviderTurnResult {
  readonly schemaVersion: typeof AI_PROVIDER_TURN_RESULT_SCHEMA_VERSION;
  readonly requestId: string;
  readonly operationId: string;
  readonly turnId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly taskType: string;
  readonly profileRevision: number;
  readonly executionPolicySnapshot: {
    readonly schemaVersion: number;
    readonly snapshotHash: string;
  };
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: AIProviderTurnStatus;
  readonly interactionMode?: AIProviderInteractionMode;
  readonly reasoningEffort?: AIProviderReasoningEffort;
  readonly outputContract?: AIProviderOutputContract;
  readonly profileSnapshot?: AIJsonValue;
  readonly structuredResult?: AIJsonValue;
  readonly events: readonly AIProviderNormalizedEvent[];
  readonly usage?: AIProviderUsage;
  readonly conversationReference?: AIProviderConversationReference;
  readonly error?: AIProviderSafeError;
}

export interface AIProviderOperationHandoff {
  readonly schemaVersion: typeof AI_PROVIDER_OPERATION_SCHEMA_VERSION;
  readonly operationId: string;
  readonly managedPrId?: string;
  readonly operationKind: string;
  readonly status: string;
  readonly taskProfileSnapshot: AIJsonValue;
  readonly executionPolicySnapshot: AIJsonValue;
  readonly inputSnapshot: AIJsonValue;
  readonly configuredTurnBudget: number;
  readonly idempotencyKey?: string;
}

export interface AIProviderConversationHandoff {
  readonly schemaVersion: typeof AI_PROVIDER_CONVERSATION_SCHEMA_VERSION;
  readonly conversationId: string;
  readonly operationId?: string;
  readonly scope: string;
  readonly reference: AIProviderConversationReference;
}

function boundedString(value: unknown, label: string, maximum = 4_096): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum)
    throw new TypeError(`F15_INVALID_${label}`);
  return value;
}

function safeJson(value: unknown, depth = 0): asserts value is AIJsonValue {
  try {
    assertSafeJsonRuntime(value, depth);
  } catch (error) {
    throw error instanceof TypeError
      ? error
      : new TypeError("F15_JSON_INVALID");
  }
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new TypeError(`F15_INVALID_${label}`);
  return value as number;
}

function optionalUsage(value: unknown): AIProviderUsage | undefined {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) throw new TypeError("F15_INVALID_USAGE");
  for (const key of [
    "inputTokens",
    "cachedInputTokens",
    "cacheWriteInputTokens",
    "outputTokens",
    "reasoningOutputTokens",
    "totalTokens",
  ]) {
    if (value[key] !== undefined) nonNegativeInteger(value[key], key);
  }
  return value as AIProviderUsage;
}

function optionalConversation(
  value: unknown,
): AIProviderConversationReference | undefined {
  if (value === undefined) return undefined;
  if (
    !isPlainRecord(value) ||
    value.schemaVersion !== AI_PROVIDER_CONVERSATION_SCHEMA_VERSION
  )
    throw new TypeError("F15_INVALID_CONVERSATION_REFERENCE");
  boundedString(value.providerId, "CONVERSATION_PROVIDER_ID", 128);
  boundedString(value.opaqueReference, "CONVERSATION_REFERENCE", 512);
  if (typeof value.resumable !== "boolean")
    throw new TypeError("F15_INVALID_CONVERSATION_RESUMABLE");
  if (
    value.taskType !== undefined &&
    !aiProviderTaskTypeSchema.safeParse(value.taskType).success
  )
    throw new TypeError("F15_INVALID_CONVERSATION_TASK");
  if (value.policySnapshotHash !== undefined)
    boundedString(value.policySnapshotHash, "CONVERSATION_POLICY_HASH", 256);
  if (value.profileRevision !== undefined)
    nonNegativeInteger(value.profileRevision, "CONVERSATION_PROFILE_REVISION");
  return value as unknown as AIProviderConversationReference;
}

/** Validate the legacy/F03-compatible serializable result before persistence. */
export function assertAIProviderTurnResult(
  value: unknown,
): asserts value is AIProviderTurnResult {
  if (
    !isPlainRecord(value) ||
    value.schemaVersion !== AI_PROVIDER_TURN_RESULT_SCHEMA_VERSION
  )
    throw new TypeError("F15_INVALID_TURN_RESULT_SCHEMA");
  boundedString(value.requestId, "REQUEST_ID");
  boundedString(value.operationId, "OPERATION_ID", 128);
  boundedString(value.turnId, "TURN_ID", 128);
  boundedString(value.providerId, "PROVIDER_ID", 128);
  boundedString(value.modelId, "MODEL_ID", 256);
  boundedString(value.taskType, "TASK_TYPE", 128);
  nonNegativeInteger(value.profileRevision, "PROFILE_REVISION");
  if (!isPlainRecord(value.executionPolicySnapshot))
    throw new TypeError("F15_INVALID_POLICY_SNAPSHOT");
  nonNegativeInteger(
    value.executionPolicySnapshot.schemaVersion,
    "POLICY_SCHEMA_VERSION",
  );
  boundedString(value.executionPolicySnapshot.snapshotHash, "POLICY_HASH", 128);
  boundedString(value.startedAt, "STARTED_AT", 128);
  boundedString(value.completedAt, "COMPLETED_AT", 128);
  if (
    value.status !== "completed" &&
    value.status !== "failed" &&
    value.status !== "cancelled" &&
    value.status !== "timed_out" &&
    value.status !== "interrupted"
  )
    throw new TypeError("F15_INVALID_TURN_STATUS");
  if (
    value.interactionMode !== undefined &&
    value.interactionMode !== "read_only" &&
    value.interactionMode !== "worktree_write"
  )
    throw new TypeError("F15_INVALID_INTERACTION_MODE");
  if (value.reasoningEffort !== undefined)
    boundedString(value.reasoningEffort, "REASONING_EFFORT", 32);
  if (value.outputContract !== undefined) {
    const outputContract = aiProviderOutputContractSchema.safeParse(
      value.outputContract,
    );
    if (!outputContract.success)
      throw new TypeError("F15_INVALID_OUTPUT_CONTRACT");
  }
  if (value.profileSnapshot !== undefined) safeJson(value.profileSnapshot);
  if (value.structuredResult !== undefined) safeJson(value.structuredResult);
  if (!Array.isArray(value.events) || value.events.length > AI_MAX_EVENT_COUNT)
    throw new TypeError("F15_INVALID_EVENTS");
  let expectedSequence = 0;
  for (const event of value.events) {
    if (
      !isPlainRecord(event) ||
      event.schemaVersion !== AI_PROVIDER_TURN_RESULT_SCHEMA_VERSION
    )
      throw new TypeError("F15_INVALID_EVENT");
    if (event.sequence !== expectedSequence++)
      throw new TypeError("F15_EVENT_SEQUENCE_INVALID");
    boundedString(event.occurredAt, "EVENT_TIME", 128);
    boundedString(event.providerId, "EVENT_PROVIDER_ID", 128);
    boundedString(event.turnId, "EVENT_TURN_ID", 128);
    boundedString(event.kind, "EVENT_KIND", 128);
    if (event.details !== undefined) safeJson(event.details);
  }
  optionalUsage(value.usage);
  optionalConversation(value.conversationReference);
  if (value.error !== undefined) {
    if (!isPlainRecord(value.error)) throw new TypeError("F15_INVALID_ERROR");
    boundedString(value.error.code, "ERROR_CODE", 128);
    boundedString(value.error.category, "ERROR_CATEGORY", 128);
    boundedString(value.error.userAction, "ERROR_ACTION", 128);
    if (typeof value.error.retryable !== "boolean")
      throw new TypeError("F15_INVALID_ERROR_RETRYABLE");
    if (value.error.detail !== undefined)
      boundedString(value.error.detail, "ERROR_DETAIL");
    if (value.error.providerReference !== undefined)
      boundedString(
        value.error.providerReference,
        "ERROR_PROVIDER_REFERENCE",
        512,
      );
  }
}

export function assertAIProviderOperationHandoff(
  value: unknown,
): asserts value is AIProviderOperationHandoff {
  if (
    !isPlainRecord(value) ||
    value.schemaVersion !== AI_PROVIDER_OPERATION_SCHEMA_VERSION
  )
    throw new TypeError("F15_INVALID_OPERATION_HANDOFF_SCHEMA");
  boundedString(value.operationId, "OPERATION_ID", 128);
  if (value.managedPrId !== undefined)
    boundedString(value.managedPrId, "MANAGED_PR_ID", 128);
  boundedString(value.operationKind, "OPERATION_KIND", 128);
  boundedString(value.status, "OPERATION_STATUS", 128);
  safeJson(value.taskProfileSnapshot);
  safeJson(value.executionPolicySnapshot);
  safeJson(value.inputSnapshot);
  const budget = nonNegativeInteger(value.configuredTurnBudget, "TURN_BUDGET");
  if (budget < 1 || budget > 10) throw new TypeError("F15_INVALID_TURN_BUDGET");
  if (value.idempotencyKey !== undefined)
    boundedString(value.idempotencyKey, "IDEMPOTENCY_KEY", 128);
}

export function assertAIProviderConversationHandoff(
  value: unknown,
): asserts value is AIProviderConversationHandoff {
  if (
    !isPlainRecord(value) ||
    value.schemaVersion !== AI_PROVIDER_CONVERSATION_SCHEMA_VERSION
  )
    throw new TypeError("F15_INVALID_CONVERSATION_HANDOFF_SCHEMA");
  boundedString(value.conversationId, "CONVERSATION_ID", 128);
  if (value.operationId !== undefined)
    boundedString(value.operationId, "OPERATION_ID", 128);
  boundedString(value.scope, "CONVERSATION_SCOPE", 128);
  if (optionalConversation(value.reference) === undefined)
    throw new TypeError("F15_INVALID_CONVERSATION_REFERENCE");
}

// Upper-case aliases keep the public contract discoverable for consumers that
// use the conventional `ThingSchema` naming style.
export const AIProviderRequestSchema = aiProviderRequestSchema;
export const AIProviderCapabilitiesSchema = aiProviderCapabilitiesSchema;
export const AIReviewProposalSchema = aiReviewProposalSchema;
export const AIReviewImplementationSchema = aiReviewImplementationSchema;
export const AIReadOnlyConversationResultSchema =
  aiReadOnlyConversationResultSchema;
export const AIConflictResolutionResultSchema =
  aiConflictResolutionResultSchema;
export const AIProviderTurnResultSchema = aiProviderTurnResultSchema;
export const AIProviderNormalizedEventSchema = aiProviderNormalizedEventSchema;
export const AIProviderUsageSchema = aiProviderUsageSchema;
export const AIProviderSafeErrorSchema = aiProviderSafeErrorSchema;
export const AIProviderWorktreeSchema = aiProviderWorktreeSchema;
export const AIProviderInputSnapshotSchema = aiProviderInputSnapshotSchema;
