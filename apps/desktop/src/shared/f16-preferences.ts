import { z } from "zod";
import {
  aiProviderApprovalPolicySchema,
  aiProviderNetworkModeSchema,
  aiProviderReasoningEffortSchema,
  aiProviderSandboxModeSchema,
  aiProviderTaskTypeSchema,
  type AIProviderApprovalPolicy,
  type AIProviderCapabilities,
  type AIProviderNetworkMode,
  type AIProviderReasoningEffort,
  type AIProviderSandboxMode,
  type AIProviderTaskType,
} from "./ai/provider-contracts";
import {
  DEFAULT_F12_INTERVAL_MS,
  DEFAULT_F12_QUIET_PERIOD_MS,
  MAX_F12_INTERVAL_MS,
  MAX_F12_QUIET_PERIOD_MS,
  MIN_F12_INTERVAL_MS,
  type F12SchedulerConfiguration,
} from "./control-plane";

export const F16_SCHEMA_VERSION = 1 as const;
export const F16_BOUNDS_REVISION = "f16-bounds-v1" as const;
export const F16_MAX_PROVIDER_ID_SCALARS = 128 as const;
export const F16_MAX_MODEL_ID_SCALARS = 256 as const;
export const F16_MAX_REASONING_ID_SCALARS = 64 as const;
export const F16_MAX_PROVIDER_OPTIONS_BYTES = 16 * 1024;
export const F16_MAX_PROVIDER_OPTION_DEPTH = 8 as const;
export const F16_MAX_PROVIDER_OPTION_KEYS = 64 as const;
export const F16_MAX_PROVIDER_OPTION_ITEMS = 128 as const;
export const F16_MAX_COMMON_NAME_SCALARS = 128 as const;
export const F16_MAX_COMMON_TEXT_BYTES = 32 * 1024;
export const F16_MAX_COMMON_PROFILES = 32 as const;
export const F16_MAX_SELECTED_COMMON_PROFILES = 8 as const;
export const F16_MAX_SELECTED_COMMON_TEXT_BYTES = 128 * 1024;
export const F16_MAX_BUILD_INSTRUCTIONS_SCALARS = 16_384 as const;
export const F16_MAX_ROOT_PATH_UTF16 = 32_767 as const;
export const F16_MAX_DIAGNOSTIC_BYTES = 4 * 1024;
export const F16_MAX_DIAGNOSTIC_ERRORS = 32 as const;
export const F16_MAX_FIELD_PATH_SCALARS = 256 as const;
export const F16_MAX_SNAPSHOT_BYTES = 512 * 1024;
export const F16_MAX_REPOSITORIES = 128 as const;
export const F16_MAX_REPOSITORY_ID_SCALARS = 512 as const;

export const F16_MAX_AI_WORK_TURNS = 10 as const;
export const F16_MIN_AI_WORK_TURNS = 1 as const;
export const F16_DEFAULT_AI_WORK_TURNS = 3 as const;

export const f16TaskTypeSchema = aiProviderTaskTypeSchema;
export type F16TaskType = AIProviderTaskType;

export const f16TaskPhaseSchema = z.enum([
  "REVIEW_PROPOSAL",
  "REVIEW_IMPLEMENTATION",
  "REVIEW_REVISION",
  "READ_ONLY_CONVERSATION",
  "MERGE_CONFLICT_RESOLUTION",
]);
export type F16TaskPhase = z.infer<typeof f16TaskPhaseSchema>;

export const F16_TASK_TYPES: readonly F16TaskType[] = [
  "AUTOMATIC_REVIEW_REEVALUATION",
  "REVIEW_REVISION",
  "READ_ONLY_CONVERSATION",
  "MERGE_CONFLICT_RESOLUTION",
];

export const F16_TASK_LABELS: Readonly<Record<F16TaskType, string>> = {
  AUTOMATIC_REVIEW_REEVALUATION: "Automatic Review / Re-evaluation",
  REVIEW_REVISION: "Review Revision",
  READ_ONLY_CONVERSATION: "Read-only Conversation",
  MERGE_CONFLICT_RESOLUTION: "Merge Conflict Resolution",
};

export const f16PolicyPresetSchema = z.enum([
  "READ_ONLY",
  "AUTONOMOUS_WORKTREE",
  "AUTONOMOUS_WORKTREE_WITH_NETWORK",
  "INTERACTIVE_APPROVALS",
  "FULL_ACCESS",
]);
export type F16PolicyPreset = z.infer<typeof f16PolicyPresetSchema>;

export const F16_POLICY_PRESETS: readonly F16PolicyPreset[] = [
  "READ_ONLY",
  "AUTONOMOUS_WORKTREE",
  "AUTONOMOUS_WORKTREE_WITH_NETWORK",
  "INTERACTIVE_APPROVALS",
  "FULL_ACCESS",
];

export type F16Availability =
  "AVAILABLE" | "UNVERIFIED" | "UNSUPPORTED" | "DISABLED" | "UNAVAILABLE";

export const f16AvailabilitySchema = z.enum([
  "AVAILABLE",
  "UNVERIFIED",
  "UNSUPPORTED",
  "DISABLED",
  "UNAVAILABLE",
]);

export type F16JsonPrimitive = string | number | boolean | null;
export type F16JsonValue =
  | F16JsonPrimitive
  | readonly F16JsonValue[]
  | { readonly [key: string]: F16JsonValue };
export type F16JsonObject = { readonly [key: string]: F16JsonValue };

const secretKeyPattern =
  /(?:token|secret|password|credential|authorization|cookie|api[_.-]?key|access[_.-]?key|sdk|environment|env)/iu;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/u;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function scalarLength(value: string): number {
  return [...value].length;
}

function normalized(value: string): string {
  return value.normalize("NFC");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function inspectJsonValue(
  value: unknown,
  depth = 0,
  counters: { keys: number; items: number } = { keys: 0, items: 0 },
): value is F16JsonValue {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return byteLength(value) <= 64 * 1024;
  if (typeof value === "number") return Number.isFinite(value);
  if (depth > F16_MAX_PROVIDER_OPTION_DEPTH) return false;
  if (Array.isArray(value)) {
    if (value.length > F16_MAX_PROVIDER_OPTION_ITEMS) return false;
    counters.items += value.length;
    return value.every((item) => inspectJsonValue(item, depth + 1, counters));
  }
  if (!isPlainRecord(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > F16_MAX_PROVIDER_OPTION_KEYS) return false;
  counters.keys += entries.length;
  return entries.every(
    ([key, item]) =>
      key.length <= 128 &&
      !secretKeyPattern.test(key) &&
      inspectJsonValue(item, depth + 1, counters),
  );
}

const f16JsonValueSchema: z.ZodType<F16JsonValue> = z.lazy(() =>
  z.union([
    z.string().max(64 * 1024),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(f16JsonValueSchema).max(F16_MAX_PROVIDER_OPTION_ITEMS),
    z.record(z.string().max(128), f16JsonValueSchema),
  ]),
);

export const f16ProviderOptionsSchema = z
  .record(z.string().min(1).max(128), f16JsonValueSchema)
  .superRefine((value, context) => {
    if (!inspectJsonValue(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "F16_PROVIDER_OPTIONS_INVALID",
      });
      return;
    }
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "F16_PROVIDER_OPTIONS_INVALID",
      });
      return;
    }
    if (byteLength(serialized) > F16_MAX_PROVIDER_OPTIONS_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "F16_INPUT_LIMIT_EXCEEDED",
      });
    }
  });

export const f16IdentifierSchema = z
  .string()
  .min(1)
  .refine((value) => identifierPattern.test(value), "F16_IDENTIFIER_INVALID");

const f16ProviderIdSchema = f16IdentifierSchema
  .refine(
    (value) => scalarLength(normalized(value)) <= F16_MAX_PROVIDER_ID_SCALARS,
    "F16_INPUT_LIMIT_EXCEEDED",
  )
  .transform(normalized);
const f16ModelIdSchema = f16IdentifierSchema
  .refine(
    (value) => scalarLength(normalized(value)) <= F16_MAX_MODEL_ID_SCALARS,
    "F16_INPUT_LIMIT_EXCEEDED",
  )
  .transform(normalized);
const f16ReasoningIdSchema = aiProviderReasoningEffortSchema;

const f16CommonNameSchema = z
  .string()
  .min(1)
  .transform(normalized)
  .refine(
    (value) => scalarLength(value) <= F16_MAX_COMMON_NAME_SCALARS,
    "F16_INPUT_LIMIT_EXCEEDED",
  );
const f16CommonTextSchema = z
  .string()
  .transform(normalized)
  .refine(
    (value) => byteLength(value) <= F16_MAX_COMMON_TEXT_BYTES,
    "F16_INPUT_LIMIT_EXCEEDED",
  );

export const f16TaskProfileDraftSchema = z
  .object({
    taskType: f16TaskTypeSchema,
    providerId: f16ProviderIdSchema,
    modelId: f16ModelIdSchema,
    reasoningEffort: f16ReasoningIdSchema.optional(),
    providerOptions: f16ProviderOptionsSchema,
    enabled: z.boolean(),
  })
  .strict();
export type F16TaskProfileDraft = z.infer<typeof f16TaskProfileDraftSchema>;

export const f16TaskProfileRevisionSchema = z
  .object({
    schemaVersion: z.literal(F16_SCHEMA_VERSION),
    profileId: f16IdentifierSchema,
    taskType: f16TaskTypeSchema,
    providerId: f16ProviderIdSchema,
    modelId: f16ModelIdSchema,
    reasoningEffort: f16ReasoningIdSchema.optional(),
    providerOptions: f16ProviderOptionsSchema,
    enabled: z.boolean(),
    availability: f16AvailabilitySchema,
    availabilityReason: z.string().max(F16_MAX_DIAGNOSTIC_BYTES).optional(),
    revision: z.number().int().positive(),
  })
  .strict();
export type F16TaskProfileRevision = z.infer<
  typeof f16TaskProfileRevisionSchema
>;

export const f16ControlledEnvironmentSchema = z
  .object({
    mode: z.literal("EXPLICIT"),
    allowedKeys: z.array(f16IdentifierSchema).max(64),
  })
  .strict();

export const f16PolicyRevisionSchema = z
  .object({
    schemaVersion: z.literal(F16_SCHEMA_VERSION),
    policyId: f16IdentifierSchema,
    revision: z.number().int().positive(),
    preset: f16PolicyPresetSchema,
    sandboxMode: aiProviderSandboxModeSchema,
    approvalPolicy: aiProviderApprovalPolicySchema,
    networkAccess: aiProviderNetworkModeSchema,
    writableRootScope: z.literal("OPERATION_OWNED"),
    controlledEnvironment: f16ControlledEnvironmentSchema,
    publicationAuthority: z.literal(false),
  })
  .strict();
export type F16PolicyRevision = z.infer<typeof f16PolicyRevisionSchema>;

export const f16CommonInstructionProfileSchema = z
  .object({
    schemaVersion: z.literal(F16_SCHEMA_VERSION),
    profileId: f16IdentifierSchema,
    name: f16CommonNameSchema,
    instructionText: f16CommonTextSchema,
    enabled: z.boolean(),
    revision: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
export type F16CommonInstructionProfile = z.infer<
  typeof f16CommonInstructionProfileSchema
>;

export const f16RepositoryIdentitySchema = z
  .object({
    serverId: f16IdentifierSchema,
    owner: f16IdentifierSchema,
    name: f16IdentifierSchema,
    key: z.string().min(1).max(F16_MAX_REPOSITORY_ID_SCALARS),
  })
  .strict();
export type F16RepositoryIdentity = z.infer<typeof f16RepositoryIdentitySchema>;

export const f16ValidationSummarySchema = z
  .object({
    status: z.enum([
      "ready",
      "confirmation_required",
      "invalid",
      "unavailable",
    ]),
    source: z.enum(["one-run", "saved", "checked-in"]).optional(),
    schemaVersion: z.number().int().positive().optional(),
    snapshotId: f16IdentifierSchema.optional(),
    contentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    authorization: z
      .object({
        authorizationType: z.enum(["approval", "one-run"]),
        id: f16IdentifierSchema,
      })
      .strict()
      .optional(),
    commandCount: z.number().int().nonnegative().max(512).optional(),
    manualCheckCount: z.number().int().nonnegative().max(512).optional(),
    phases: z.array(z.enum(["baseline", "post_change", "both"])).max(3),
    warningCode: z.string().max(F16_MAX_DIAGNOSTIC_BYTES).optional(),
    boundsRevision: z.string().min(1).max(128),
  })
  .strict();
export type F16ValidationSummary = z.infer<typeof f16ValidationSummarySchema>;

export const f16RepositorySettingsSchema = z
  .object({
    schemaVersion: z.literal(F16_SCHEMA_VERSION),
    repository: f16RepositoryIdentitySchema,
    buildInstructions: z
      .string()
      .transform(normalized)
      .refine(
        (value) => scalarLength(value) <= F16_MAX_BUILD_INSTRUCTIONS_SCALARS,
        "F16_INPUT_LIMIT_EXCEEDED",
      )
      .optional(),
    validationSummary: f16ValidationSummarySchema.optional(),
    revision: z.number().int().positive(),
  })
  .strict();
export type F16RepositorySettings = z.infer<typeof f16RepositorySettingsSchema>;

export const f16WorktreeRootReferenceSchema = z
  .object({
    configuredPath: z.string().min(1).max(F16_MAX_ROOT_PATH_UTF16),
    canonicalPath: z.string().min(1).max(4_096),
    rootRevision: z.number().int().nonnegative(),
  })
  .strict();
export type F16WorktreeRootReference = z.infer<
  typeof f16WorktreeRootReferenceSchema
>;

export const f16OperationalPreferencesSchema = z
  .object({
    schemaVersion: z.literal(F16_SCHEMA_VERSION),
    maxAiWorkTurns: z
      .number()
      .int()
      .min(F16_MIN_AI_WORK_TURNS)
      .max(F16_MAX_AI_WORK_TURNS),
    worktreeRoot: f16WorktreeRootReferenceSchema.optional(),
    pollingIntervalMs: z
      .number()
      .int()
      .min(MIN_F12_INTERVAL_MS)
      .max(MAX_F12_INTERVAL_MS),
    quietPeriodMs: z
      .number()
      .int()
      .min(MIN_F12_INTERVAL_MS)
      .max(MAX_F12_QUIET_PERIOD_MS),
  })
  .strict();
export type F16OperationalPreferences = z.infer<
  typeof f16OperationalPreferencesSchema
>;

export const f16PreferencesStateSchema = z
  .object({
    schemaVersion: z.literal(F16_SCHEMA_VERSION),
    boundsRevision: z.literal(F16_BOUNDS_REVISION),
    settingsRevision: z.number().int().nonnegative(),
    taskProfiles: z.array(f16TaskProfileRevisionSchema).length(4),
    policy: f16PolicyRevisionSchema,
    commonInstructionProfiles: z
      .array(f16CommonInstructionProfileSchema)
      .max(F16_MAX_COMMON_PROFILES),
    selectedCommonInstructionIds: z
      .array(f16IdentifierSchema)
      .max(F16_MAX_SELECTED_COMMON_PROFILES),
    operational: f16OperationalPreferencesSchema,
    repositories: z
      .array(f16RepositorySettingsSchema)
      .max(F16_MAX_REPOSITORIES),
  })
  .strict()
  .superRefine((value, context) => {
    const taskTypes = value.taskProfiles.map((profile) => profile.taskType);
    const uniqueTaskTypes = new Set(taskTypes);
    if (
      uniqueTaskTypes.size !== F16_TASK_TYPES.length ||
      F16_TASK_TYPES.some((taskType) => !uniqueTaskTypes.has(taskType))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["taskProfiles"],
        message: "F16_TASK_PROFILE_SET_INVALID",
      });
    }
    const profileIds = new Set(
      value.commonInstructionProfiles.map((profile) => profile.profileId),
    );
    const selected = new Set(value.selectedCommonInstructionIds);
    if (
      selected.size !== value.selectedCommonInstructionIds.length ||
      value.selectedCommonInstructionIds.some((id) => !profileIds.has(id)) ||
      value.commonInstructionProfiles.some(
        (profile) => selected.has(profile.profileId) && !profile.enabled,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selectedCommonInstructionIds"],
        message: "F16_COMMON_SELECTION_INVALID",
      });
    }
    const aggregateBytes = value.selectedCommonInstructionIds.reduce(
      (total, id) =>
        total +
        byteLength(
          value.commonInstructionProfiles.find(
            (profile) => profile.profileId === id,
          )?.instructionText ?? "",
        ),
      0,
    );
    if (aggregateBytes > F16_MAX_SELECTED_COMMON_TEXT_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["commonInstructionProfiles"],
        message: "F16_INPUT_LIMIT_EXCEEDED",
      });
    }
  });
export type F16PreferencesState = z.infer<typeof f16PreferencesStateSchema>;
export type F16PreferencesReadModel = F16PreferencesState & {
  readonly policyPresets: readonly F16PolicyPresetSummary[];
};

export const f16TaskProfileSaveInputSchema = z
  .object({
    expectedSettingsRevision: z.number().int().nonnegative(),
    profile: f16TaskProfileDraftSchema,
  })
  .strict();
export type F16TaskProfileSaveInput = z.infer<
  typeof f16TaskProfileSaveInputSchema
>;

export const f16PolicySaveInputSchema = z
  .object({
    expectedSettingsRevision: z.number().int().nonnegative(),
    preset: f16PolicyPresetSchema,
  })
  .strict();
export type F16PolicySaveInput = z.infer<typeof f16PolicySaveInputSchema>;

export const f16OperationalSaveInputSchema = z
  .object({
    expectedSettingsRevision: z.number().int().nonnegative(),
    maxAiWorkTurns: z.number().int(),
    worktreeRoot: z.string().max(F16_MAX_ROOT_PATH_UTF16).nullable(),
    pollingIntervalMs: z.number().int(),
    quietPeriodMs: z.number().int(),
  })
  .strict();
export type F16OperationalSaveInput = z.infer<
  typeof f16OperationalSaveInputSchema
>;

export const f16CommonInstructionSaveInputSchema = z
  .object({
    expectedSettingsRevision: z.number().int().nonnegative(),
    profileId: f16IdentifierSchema.optional(),
    name: f16CommonNameSchema,
    instructionText: f16CommonTextSchema,
    enabled: z.boolean(),
    selected: z.boolean(),
  })
  .strict();
export type F16CommonInstructionSaveInput = z.infer<
  typeof f16CommonInstructionSaveInputSchema
>;

export const f16CommonInstructionDeleteInputSchema = z
  .object({
    expectedSettingsRevision: z.number().int().nonnegative(),
    profileId: f16IdentifierSchema,
  })
  .strict();
export type F16CommonInstructionDeleteInput = z.infer<
  typeof f16CommonInstructionDeleteInputSchema
>;

export const f16CommonInstructionSelectionSaveInputSchema = z
  .object({
    expectedSettingsRevision: z.number().int().nonnegative(),
    selectedProfileIds: z
      .array(f16IdentifierSchema)
      .max(F16_MAX_SELECTED_COMMON_PROFILES),
  })
  .strict();
export type F16CommonInstructionSelectionSaveInput = z.infer<
  typeof f16CommonInstructionSelectionSaveInputSchema
>;

export const f16RepositorySaveInputSchema = z
  .object({
    expectedSettingsRevision: z.number().int().nonnegative(),
    repository: f16RepositoryIdentitySchema,
    buildInstructions: z.string().max(F16_MAX_BUILD_INSTRUCTIONS_SCALARS),
  })
  .strict();
export type F16RepositorySaveInput = z.infer<
  typeof f16RepositorySaveInputSchema
>;

export interface F16ProviderModelDescriptor {
  readonly modelId: string;
  readonly taskTypes?: readonly F16TaskType[];
  readonly reasoningEfforts?: readonly AIProviderReasoningEffort[];
  readonly supportedOptionKeys?: readonly string[];
}

export interface F16ProviderOptionBounds {
  readonly schemaVersion: number;
  readonly boundsRevision: string;
  readonly maxBytes: number;
  readonly maxObjectDepth: number;
  readonly maxObjectKeys: number;
  readonly maxArrayItems: number;
}

export function f16ProviderOptionsWithinBounds(
  value: F16JsonObject,
  bounds: Pick<
    F16ProviderOptionBounds,
    "maxBytes" | "maxObjectDepth" | "maxObjectKeys" | "maxArrayItems"
  >,
): boolean {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return false;
  }
  if (byteLength(serialized) > bounds.maxBytes) return false;
  const visit = (candidate: F16JsonValue, depth: number): boolean => {
    if (depth > bounds.maxObjectDepth) return false;
    if (Array.isArray(candidate)) {
      return (
        candidate.length <= bounds.maxArrayItems &&
        candidate.every((item) => visit(item, depth + 1))
      );
    }
    if (candidate !== null && typeof candidate === "object") {
      const entries = Object.entries(candidate);
      return (
        entries.length <= bounds.maxObjectKeys &&
        entries.every(([, item]) => visit(item, depth + 1))
      );
    }
    return true;
  };
  return visit(value, 0);
}

export type F16ProviderCapabilities = AIProviderCapabilities & {
  readonly modelCatalog?: readonly F16ProviderModelDescriptor[];
  readonly providerOptionBounds?: F16ProviderOptionBounds;
};

export interface F16OperationWorktreeScope {
  /** These values are accepted only from the F13 operation-owned handoff. */
  readonly operationId: string;
  readonly canonicalPath: string;
  readonly rootRevision: number;
}

export interface F16EffectivePolicySnapshot {
  readonly schemaVersion: typeof F16_SCHEMA_VERSION;
  readonly policyId: string;
  readonly revision: number;
  readonly configuredPreset: F16PolicyPreset;
  readonly effectivePreset: F16PolicyPreset;
  readonly sandboxMode: AIProviderSandboxMode;
  readonly approvalPolicy: AIProviderApprovalPolicy;
  readonly networkAccess: AIProviderNetworkMode;
  readonly writableRoot?: string;
  readonly controlledEnvironment: {
    readonly mode: "EXPLICIT";
    readonly allowedKeys: readonly string[];
  };
  readonly taskSafetyFloor: "READ_ONLY" | "WORKTREE_WRITE";
  readonly interactionMode: "read_only" | "worktree_write";
  readonly publicationAuthority: false;
}

export const f16EffectivePolicySnapshotSchema = z
  .object({
    schemaVersion: z.literal(F16_SCHEMA_VERSION),
    policyId: f16IdentifierSchema,
    revision: z.number().int().positive(),
    configuredPreset: f16PolicyPresetSchema,
    effectivePreset: f16PolicyPresetSchema,
    sandboxMode: aiProviderSandboxModeSchema,
    approvalPolicy: aiProviderApprovalPolicySchema,
    networkAccess: aiProviderNetworkModeSchema,
    writableRoot: z.string().min(1).max(4_096).optional(),
    controlledEnvironment: f16ControlledEnvironmentSchema,
    taskSafetyFloor: z.enum(["READ_ONLY", "WORKTREE_WRITE"]),
    interactionMode: z.enum(["read_only", "worktree_write"]),
    publicationAuthority: z.literal(false),
  })
  .strict();

export interface F16BuildValidationSnapshot {
  readonly schemaVersion: typeof F16_SCHEMA_VERSION;
  readonly repository: F16RepositoryIdentity;
  readonly buildInstructions?: string;
  readonly validation: F16ValidationSummary;
}

export const f16BuildValidationSnapshotSchema = z
  .object({
    schemaVersion: z.literal(F16_SCHEMA_VERSION),
    repository: f16RepositoryIdentitySchema,
    buildInstructions: z
      .string()
      .max(F16_MAX_BUILD_INSTRUCTIONS_SCALARS)
      .optional(),
    validation: f16ValidationSummarySchema,
  })
  .strict();

export interface F16CommonInstructionSnapshot {
  readonly schemaVersion: typeof F16_SCHEMA_VERSION;
  readonly profileId: string;
  readonly name: string;
  readonly enabled: true;
  readonly revision: number;
  readonly instructionText: string;
  readonly contentHash: string;
  readonly order: number;
}

export const f16CommonInstructionSnapshotSchema = z
  .object({
    schemaVersion: z.literal(F16_SCHEMA_VERSION),
    profileId: f16IdentifierSchema,
    name: f16CommonNameSchema,
    enabled: z.literal(true),
    revision: z.number().int().positive(),
    instructionText: f16CommonTextSchema,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    order: z
      .number()
      .int()
      .nonnegative()
      .max(F16_MAX_SELECTED_COMMON_PROFILES - 1),
  })
  .strict();

export interface F16PRIntentContextSnapshot {
  readonly text: string;
  readonly contentHash: string;
}

export const f16PrIntentContextSnapshotSchema = z
  .object({
    text: z.string().max(32 * 1024),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

export interface F16BoundsProvenance {
  readonly f16: typeof F16_BOUNDS_REVISION;
  readonly f04: string;
  readonly f13?: string;
  readonly f15: string;
  readonly f00?: string;
}

export const f16BoundsProvenanceSchema = z
  .object({
    f16: z.literal(F16_BOUNDS_REVISION),
    f04: z.string().min(1).max(128),
    f13: z.string().min(1).max(128).optional(),
    f15: z.string().min(1).max(128),
    f00: z.string().min(1).max(128).optional(),
  })
  .strict();

export interface F16EffectiveAITaskSnapshot {
  readonly schemaVersion: typeof F16_SCHEMA_VERSION;
  readonly snapshotId: string;
  readonly snapshotHash: string;
  readonly taskType: F16TaskType;
  readonly phase: F16TaskPhase;
  readonly profile: F16TaskProfileRevision;
  readonly policy: F16EffectivePolicySnapshot;
  readonly commonInstructions: readonly F16CommonInstructionSnapshot[];
  readonly buildValidation?: F16BuildValidationSnapshot;
  readonly prIntentContext?: F16PRIntentContextSnapshot;
  readonly operationWorktree?: F16OperationWorktreeScope;
  readonly bounds: F16BoundsProvenance;
}

export const f16EffectiveAITaskSnapshotSchema = z
  .object({
    schemaVersion: z.literal(F16_SCHEMA_VERSION),
    snapshotId: f16IdentifierSchema,
    snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
    taskType: f16TaskTypeSchema,
    phase: f16TaskPhaseSchema,
    profile: f16TaskProfileRevisionSchema,
    policy: f16EffectivePolicySnapshotSchema,
    commonInstructions: z
      .array(f16CommonInstructionSnapshotSchema)
      .max(F16_MAX_SELECTED_COMMON_PROFILES),
    buildValidation: f16BuildValidationSnapshotSchema.optional(),
    prIntentContext: f16PrIntentContextSnapshotSchema.optional(),
    operationWorktree: z
      .object({
        operationId: f16IdentifierSchema,
        canonicalPath: z.string().min(1).max(4_096),
        rootRevision: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    bounds: f16BoundsProvenanceSchema,
  })
  .strict();

export type F16PolicyResolution =
  | { readonly ok: true; readonly value: F16EffectivePolicySnapshot }
  | {
      readonly ok: false;
      readonly code:
        | "F16_POLICY_UNSUPPORTED"
        | "F16_WORKTREE_SCOPE_REQUIRED"
        | "F16_WORKTREE_SCOPE_INVALID";
      readonly message: string;
    };

export interface F16PolicyPresetSummary {
  readonly preset: F16PolicyPreset;
  readonly label: string;
  readonly summary: string;
  readonly sandboxMode: AIProviderSandboxMode;
  readonly approvalPolicy: AIProviderApprovalPolicy;
  readonly networkAccess: AIProviderNetworkMode;
  readonly requiresOperationRoot: boolean;
  readonly requiresInteractiveApproval: boolean;
  readonly publicationAuthority: false;
}

export const f16PolicyPresetSummarySchema = z
  .object({
    preset: f16PolicyPresetSchema,
    label: z.string().min(1).max(128),
    summary: z
      .string()
      .min(1)
      .max(4 * 1024),
    sandboxMode: aiProviderSandboxModeSchema,
    approvalPolicy: aiProviderApprovalPolicySchema,
    networkAccess: aiProviderNetworkModeSchema,
    requiresOperationRoot: z.boolean(),
    requiresInteractiveApproval: z.boolean(),
    publicationAuthority: z.literal(false),
  })
  .strict();

const POLICY_DEFINITIONS: Readonly<
  Record<
    F16PolicyPreset,
    Omit<F16PolicyPresetSummary, "preset" | "label" | "summary">
  >
> = {
  READ_ONLY: {
    sandboxMode: "read-only",
    approvalPolicy: "never",
    networkAccess: "disabled",
    requiresOperationRoot: false,
    requiresInteractiveApproval: false,
    publicationAuthority: false,
  },
  AUTONOMOUS_WORKTREE: {
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    networkAccess: "disabled",
    requiresOperationRoot: true,
    requiresInteractiveApproval: false,
    publicationAuthority: false,
  },
  AUTONOMOUS_WORKTREE_WITH_NETWORK: {
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    networkAccess: "enabled",
    requiresOperationRoot: true,
    requiresInteractiveApproval: false,
    publicationAuthority: false,
  },
  INTERACTIVE_APPROVALS: {
    sandboxMode: "workspace-write",
    approvalPolicy: "on-request",
    networkAccess: "disabled",
    requiresOperationRoot: true,
    requiresInteractiveApproval: true,
    publicationAuthority: false,
  },
  FULL_ACCESS: {
    sandboxMode: "danger-full-access",
    approvalPolicy: "never",
    networkAccess: "enabled",
    requiresOperationRoot: true,
    requiresInteractiveApproval: false,
    publicationAuthority: false,
  },
};

const POLICY_LABELS: Readonly<Record<F16PolicyPreset, string>> = {
  READ_ONLY: "Read-only",
  AUTONOMOUS_WORKTREE: "Autonomous Worktree",
  AUTONOMOUS_WORKTREE_WITH_NETWORK: "Autonomous Worktree with Network",
  INTERACTIVE_APPROVALS: "Interactive Approvals",
  FULL_ACCESS: "Full Access",
};

const POLICY_SUMMARIES: Readonly<Record<F16PolicyPreset, string>> = {
  READ_ONLY: "Inspect files without writes, commands, network, or publication.",
  AUTONOMOUS_WORKTREE:
    "Write only inside the operation-owned worktree with network disabled.",
  AUTONOMOUS_WORKTREE_WITH_NETWORK:
    "Write inside the operation-owned worktree with network enabled.",
  INTERACTIVE_APPROVALS:
    "Write inside the operation-owned worktree and request host approvals when needed.",
  FULL_ACCESS:
    "Use the provider's broadest supported sandbox with network enabled; publication remains unavailable.",
};

export function f16PolicyPresetSummaries(): readonly F16PolicyPresetSummary[] {
  return F16_POLICY_PRESETS.map((preset) => ({
    preset,
    label: POLICY_LABELS[preset],
    summary: POLICY_SUMMARIES[preset],
    ...POLICY_DEFINITIONS[preset],
  }));
}

export function createF16PolicyRevision(
  preset: F16PolicyPreset,
  revision: number,
): F16PolicyRevision {
  const definition = POLICY_DEFINITIONS[preset];
  return {
    schemaVersion: F16_SCHEMA_VERSION,
    policyId: "application-policy",
    revision,
    preset,
    sandboxMode: definition.sandboxMode,
    approvalPolicy: definition.approvalPolicy,
    networkAccess: definition.networkAccess,
    writableRootScope: "OPERATION_OWNED",
    controlledEnvironment: { mode: "EXPLICIT", allowedKeys: [] },
    publicationAuthority: false,
  };
}

function capabilityContains<T>(values: readonly T[], value: T): boolean {
  return values.includes(value);
}

function policyError(
  message: string,
  code:
    | "F16_POLICY_UNSUPPORTED"
    | "F16_WORKTREE_SCOPE_REQUIRED"
    | "F16_WORKTREE_SCOPE_INVALID",
): F16PolicyResolution {
  return { ok: false, code, message };
}

export function resolveF16EffectivePolicy(input: {
  readonly policy: F16PolicyRevision;
  readonly phase: F16TaskPhase;
  readonly capabilities: F16ProviderCapabilities;
  readonly operationWorktree?: F16OperationWorktreeScope;
}): F16PolicyResolution {
  const readOnly =
    input.phase === "REVIEW_PROPOSAL" ||
    input.phase === "READ_ONLY_CONVERSATION";
  if (!input.capabilities.enabled)
    return policyError(
      "The selected provider is disabled in its capability descriptor.",
      "F16_POLICY_UNSUPPORTED",
    );
  if (!capabilityContains(input.capabilities.sandboxModes, "read-only"))
    return policyError(
      "The provider cannot enforce the required read-only policy floor.",
      "F16_POLICY_UNSUPPORTED",
    );

  if (readOnly) {
    return {
      ok: true,
      value: {
        schemaVersion: F16_SCHEMA_VERSION,
        policyId: input.policy.policyId,
        revision: input.policy.revision,
        configuredPreset: input.policy.preset,
        effectivePreset: "READ_ONLY",
        sandboxMode: "read-only",
        approvalPolicy: "never",
        networkAccess: "disabled",
        controlledEnvironment: { mode: "EXPLICIT", allowedKeys: [] },
        taskSafetyFloor: "READ_ONLY",
        interactionMode: "read_only",
        publicationAuthority: false,
      },
    };
  }

  const definition = POLICY_DEFINITIONS[input.policy.preset];
  if (definition.requiresOperationRoot && input.operationWorktree === undefined)
    return policyError(
      "A mutating AI task requires an operation-owned worktree scope from F13.",
      "F16_WORKTREE_SCOPE_REQUIRED",
    );
  if (
    input.operationWorktree !== undefined &&
    (input.operationWorktree.operationId.length === 0 ||
      input.operationWorktree.canonicalPath.length === 0 ||
      input.operationWorktree.rootRevision < 0)
  )
    return policyError(
      "The operation-owned worktree scope is not valid.",
      "F16_WORKTREE_SCOPE_INVALID",
    );
  if (
    !capabilityContains(input.capabilities.sandboxModes, definition.sandboxMode)
  )
    return policyError(
      `The provider cannot enforce the ${POLICY_LABELS[input.policy.preset]} sandbox.`,
      "F16_POLICY_UNSUPPORTED",
    );
  if (
    !capabilityContains(
      input.capabilities.approvalPolicies,
      definition.approvalPolicy,
    )
  )
    return policyError(
      `The provider cannot enforce the ${POLICY_LABELS[input.policy.preset]} approval behavior.`,
      "F16_POLICY_UNSUPPORTED",
    );
  if (
    !capabilityContains(
      input.capabilities.networkModes,
      definition.networkAccess,
    )
  )
    return policyError(
      `The provider cannot enforce ${definition.networkAccess} network access.`,
      "F16_POLICY_UNSUPPORTED",
    );
  if (!input.capabilities.controlledEnvironment)
    return policyError(
      "The provider cannot enforce the controlled environment boundary.",
      "F16_POLICY_UNSUPPORTED",
    );
  if (input.capabilities.worktreeAccess !== "worktree_write")
    return policyError(
      "The provider cannot write the operation-owned worktree.",
      "F16_POLICY_UNSUPPORTED",
    );
  return {
    ok: true,
    value: {
      schemaVersion: F16_SCHEMA_VERSION,
      policyId: input.policy.policyId,
      revision: input.policy.revision,
      configuredPreset: input.policy.preset,
      effectivePreset: input.policy.preset,
      sandboxMode: definition.sandboxMode,
      approvalPolicy: definition.approvalPolicy,
      networkAccess: definition.networkAccess,
      ...(input.operationWorktree === undefined
        ? {}
        : { writableRoot: input.operationWorktree.canonicalPath }),
      controlledEnvironment: { mode: "EXPLICIT", allowedKeys: [] },
      taskSafetyFloor: "WORKTREE_WRITE",
      interactionMode: "worktree_write",
      publicationAuthority: false,
    },
  };
}

export function phaseForF16Task(
  taskType: F16TaskType,
  phase?: F16TaskPhase,
): F16TaskPhase {
  if (phase !== undefined) return phase;
  switch (taskType) {
    case "AUTOMATIC_REVIEW_REEVALUATION":
      return "REVIEW_PROPOSAL";
    case "REVIEW_REVISION":
      return "REVIEW_REVISION";
    case "READ_ONLY_CONVERSATION":
      return "READ_ONLY_CONVERSATION";
    case "MERGE_CONFLICT_RESOLUTION":
      return "MERGE_CONFLICT_RESOLUTION";
  }
}

export function f16TaskProfileId(taskType: F16TaskType): string {
  return `profile-${taskType.toLowerCase()}`;
}

export function repositoryKey(identity: F16RepositoryIdentity): string {
  return identity.key;
}

export function defaultF16Preferences(): F16PreferencesState {
  const taskProfiles = F16_TASK_TYPES.map(
    (taskType): F16TaskProfileRevision => ({
      schemaVersion: F16_SCHEMA_VERSION,
      profileId: f16TaskProfileId(taskType),
      taskType,
      providerId: "codex",
      modelId: "gpt-5-codex",
      reasoningEffort: "medium",
      providerOptions: {},
      enabled: false,
      availability: "UNAVAILABLE",
      availabilityReason:
        "Configure and validate this task profile before starting work.",
      revision: 1,
    }),
  );
  return {
    schemaVersion: F16_SCHEMA_VERSION,
    boundsRevision: F16_BOUNDS_REVISION,
    settingsRevision: 0,
    taskProfiles,
    policy: createF16PolicyRevision("AUTONOMOUS_WORKTREE", 1),
    commonInstructionProfiles: [],
    selectedCommonInstructionIds: [],
    operational: {
      schemaVersion: F16_SCHEMA_VERSION,
      maxAiWorkTurns: F16_DEFAULT_AI_WORK_TURNS,
      pollingIntervalMs: DEFAULT_F12_INTERVAL_MS,
      quietPeriodMs: DEFAULT_F12_QUIET_PERIOD_MS,
    },
    repositories: [],
  };
}

export function isF16PreferencesReadModel(
  value: unknown,
): value is F16PreferencesReadModel {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, "policyPresets"))
    return false;
  const { policyPresets, ...state } = record;
  const parsed = f16PreferencesStateSchema.safeParse(state);
  if (!parsed.success) return false;
  const parsedPresets = z
    .array(f16PolicyPresetSummarySchema)
    .length(F16_POLICY_PRESETS.length)
    .safeParse(policyPresets);
  return parsedPresets.success;
}

export function isF16EffectiveAITaskSnapshot(
  value: unknown,
): value is F16EffectiveAITaskSnapshot {
  return f16EffectiveAITaskSnapshotSchema.safeParse(value).success;
}

export function validateF16F12Configuration(input: {
  readonly pollingIntervalMs: number;
  readonly quietPeriodMs: number;
}): F12SchedulerConfiguration {
  if (
    !Number.isSafeInteger(input.pollingIntervalMs) ||
    input.pollingIntervalMs < MIN_F12_INTERVAL_MS ||
    input.pollingIntervalMs > MAX_F12_INTERVAL_MS
  )
    throw new TypeError("F16_INVALID_POLL_INTERVAL");
  if (
    !Number.isSafeInteger(input.quietPeriodMs) ||
    input.quietPeriodMs < MIN_F12_INTERVAL_MS ||
    input.quietPeriodMs > MAX_F12_QUIET_PERIOD_MS
  )
    throw new TypeError("F16_INVALID_QUIET_PERIOD");
  return {
    intervalMs: input.pollingIntervalMs,
    quietPeriodMs: input.quietPeriodMs,
    maxConcurrentPrs: 4,
    readOnlyPollWhilePaused: true,
  };
}

export function validateF16SnapshotSize(
  snapshot: F16EffectiveAITaskSnapshot,
): void {
  const serialized = JSON.stringify(snapshot);
  if (byteLength(serialized) > F16_MAX_SNAPSHOT_BYTES)
    throw new TypeError("F16_SNAPSHOT_LIMIT_EXCEEDED");
}

export function f16ByteLength(value: string): number {
  return byteLength(value);
}
