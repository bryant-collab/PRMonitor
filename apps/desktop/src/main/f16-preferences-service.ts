import { createHash, randomUUID } from "node:crypto";
import type { F13RootResolution } from "../shared/f13-contracts";
import type { F12SchedulerConfiguration } from "../shared/control-plane";
import type {
  F16RevisionKind,
  F16SettingsCommitResult,
  PersistenceRepositories,
} from "./persistence";
import type { PersistedRecord } from "./persistence/types";
import {
  F16_BOUNDS_REVISION,
  F16_MAX_COMMON_PROFILES,
  F16_MAX_REPOSITORIES,
  F16_MAX_ROOT_PATH_UTF16,
  F16_MAX_SELECTED_COMMON_PROFILES,
  F16_MAX_SELECTED_COMMON_TEXT_BYTES,
  F16_MIN_AI_WORK_TURNS,
  F16_MAX_AI_WORK_TURNS,
  F16_SCHEMA_VERSION,
  createF16PolicyRevision,
  defaultF16Preferences,
  f16CommonInstructionDeleteInputSchema,
  f16CommonInstructionSaveInputSchema,
  f16CommonInstructionSelectionSaveInputSchema,
  f16EffectiveAITaskSnapshotSchema,
  f16OperationalSaveInputSchema,
  f16PolicySaveInputSchema,
  f16PolicyPresetSummaries,
  f16PreferencesStateSchema,
  f16ProviderOptionsWithinBounds,
  f16RepositorySaveInputSchema,
  f16TaskProfileSaveInputSchema,
  f16TaskTypeSchema,
  f16ByteLength,
  phaseForF16Task,
  repositoryKey,
  resolveF16EffectivePolicy,
  validateF16F12Configuration,
  validateF16SnapshotSize,
  type F16BuildValidationSnapshot,
  type F16CommonInstructionProfile,
  type F16CommonInstructionSaveInput,
  type F16CommonInstructionDeleteInput,
  type F16CommonInstructionSelectionSaveInput,
  type F16EffectiveAITaskSnapshot,
  type F16OperationWorktreeScope,
  type F16OperationalPreferences,
  type F16PreferencesReadModel,
  type F16PreferencesState,
  type F16ProviderCapabilities,
  type F16RepositoryIdentity,
  type F16RepositorySaveInput,
  type F16TaskProfileDraft,
  type F16TaskProfileRevision,
  type F16TaskType,
  type F16TaskPhase,
  type F16ValidationSummary,
  type F16PolicySaveInput,
  type F16OperationalSaveInput,
  type F16TaskProfileSaveInput,
} from "../shared/f16-preferences";

const F16_SETTINGS_KEY = "f16.preferences.v1";

export type F16ErrorCode =
  | "F16_INPUT_LIMIT_EXCEEDED"
  | "F16_INVALID_INPUT"
  | "F16_PROVIDER_UNKNOWN"
  | "F16_CAPABILITY_UNSUPPORTED"
  | "F16_PROFILE_UNAVAILABLE"
  | "F16_PROFILE_UNVERIFIED"
  | "F16_POLICY_UNSUPPORTED"
  | "F16_WORKTREE_SCOPE_REQUIRED"
  | "F16_WORKTREE_SCOPE_INVALID"
  | "F16_WORKTREE_ROOT_INVALID"
  | "F16_DELEGATED_BOUND_UNAVAILABLE"
  | "F16_SNAPSHOT_LIMIT_EXCEEDED"
  | "F16_CONFLICT"
  | "F16_NOT_FOUND"
  | "F16_PERSISTENCE_FAILURE"
  | "F16_SCHEDULER_SYNC_REQUIRED";

export class F16ConfigurationError extends Error {
  public readonly code: F16ErrorCode;
  public readonly fieldPath?: string;
  public readonly userAction: string;

  public constructor(
    code: F16ErrorCode,
    message: string,
    userAction: string,
    fieldPath?: string,
  ) {
    super(message);
    this.name = "F16ConfigurationError";
    this.code = code;
    this.userAction = userAction;
    this.fieldPath = fieldPath;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
    .join(",")}}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value))
    return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>))
    deepFreeze(child);
  return value;
}

function safeIssueMessage(error: {
  readonly issues?: readonly {
    readonly message: string;
    readonly path: readonly (string | number)[];
  }[];
}): string {
  const issue = error.issues?.[0];
  if (issue === undefined)
    return "The preference value is outside its bounded contract.";
  return `${issue.path.join(".") || "value"}: ${issue.message}`.slice(0, 512);
}

function throwSchemaFailure(error: {
  readonly issues?: readonly {
    readonly message: string;
    readonly path: readonly (string | number)[];
  }[];
}): never {
  const issue = error.issues?.find((candidate) =>
    candidate.message.includes("LIMIT_EXCEEDED"),
  );
  throw new F16ConfigurationError(
    issue === undefined ? "F16_INVALID_INPUT" : "F16_INPUT_LIMIT_EXCEEDED",
    safeIssueMessage(error),
    "Fix the highlighted preference and try again.",
    issue?.path.join("."),
  );
}

function parseOrThrow<T>(
  schema: {
    safeParse: (value: unknown) =>
      | { success: true; data: T }
      | {
          success: false;
          error: {
            issues: readonly {
              message: string;
              path: readonly (string | number)[];
            }[];
          };
        };
  },
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throwSchemaFailure(parsed.error);
  return parsed.data;
}

export interface F16PreferencesRepository {
  readonly readSettings: () => PersistedRecord<F16PreferencesState> | undefined;
  readonly commitSettings: <TRevision = unknown>(input: {
    readonly settings: F16PreferencesState;
    readonly expectedSettingsVersion?: number;
    readonly revision?: {
      readonly kind: F16RevisionKind;
      readonly id: string;
      readonly revision: number;
      readonly payload: TRevision;
    };
  }) => F16SettingsCommitResult<F16PreferencesState, TRevision>;
}

export interface F16CapabilityPort {
  readonly boundsRevision?: string;
  readonly get: (providerId: string) => F16ProviderCapabilities | undefined;
}

export interface F16ValidationResolution {
  readonly summary: F16ValidationSummary;
  readonly boundsRevision: string;
}

export interface F16ValidationPort {
  readonly boundsRevision?: string;
  readonly resolve: (input: {
    readonly repository: F16RepositoryIdentity;
    readonly operationId?: string;
  }) => F16ValidationResolution | Promise<F16ValidationResolution>;
}

export interface F16SchedulerPort {
  readonly boundsRevision?: string;
  readonly validateConfiguration: (input: {
    readonly pollingIntervalMs: number;
    readonly quietPeriodMs: number;
  }) => F12SchedulerConfiguration;
  readonly applyConfiguration?: (
    input: F12SchedulerConfiguration,
  ) => void | Promise<void>;
}

export interface F16WorktreeRootPort {
  readonly boundsRevision?: string;
  readonly resolveRoot: (input: {
    readonly worktreeRoot?: string;
    readonly rootRevision: number;
    readonly correlationId?: string;
  }) => F13RootResolution | Promise<F13RootResolution>;
}

export interface F16ServiceOptions {
  readonly repositories: F16PreferencesRepository;
  readonly capabilities: F16CapabilityPort;
  readonly validation?: F16ValidationPort;
  readonly scheduler?: F16SchedulerPort;
  readonly worktreeRoot?: F16WorktreeRootPort;
  readonly ipcBoundsRevision?: string;
  readonly clock?: () => string;
}

export interface F16ResolveTaskInput {
  readonly taskType: F16TaskType;
  readonly phase?: F16TaskPhase;
  readonly repository?: F16RepositoryIdentity;
  readonly operationId?: string;
  /** This handoff is produced by F13, never by renderer preference input. */
  readonly operationWorktree?: F16OperationWorktreeScope;
  readonly prIntentContext?: string;
}

function defaultValidationSummary(): F16ValidationSummary {
  return {
    status: "unavailable",
    phases: [],
    warningCode: "NO_PROFILE",
    boundsRevision: "f00-validation-v1",
  };
}

function currentRecord(repository: F16PreferencesRepository): {
  readonly record: PersistedRecord<F16PreferencesState> | undefined;
  readonly state: F16PreferencesState;
} {
  const record = repository.readSettings();
  if (record === undefined) return { record, state: defaultF16Preferences() };
  const parsed = f16PreferencesStateSchema.safeParse(record.payload);
  if (!parsed.success)
    throw new F16ConfigurationError(
      "F16_PERSISTENCE_FAILURE",
      "The persisted AI Preferences record is invalid and was not used.",
      "Reload the application and reconcile the stored Preferences.",
    );
  if (parsed.data.settingsRevision !== record.version)
    throw new F16ConfigurationError(
      "F16_PERSISTENCE_FAILURE",
      "The persisted Preferences revision does not match its durable record.",
      "Reload Preferences before starting new work.",
    );
  return { record, state: parsed.data };
}

function assertExpectedRevision(
  state: F16PreferencesState,
  expected: number,
): void {
  if (expected !== state.settingsRevision)
    throw new F16ConfigurationError(
      "F16_CONFLICT",
      "Preferences changed in another window. No change was saved.",
      "Read Preferences again and retry from the current revision.",
    );
}

function nextState(
  state: F16PreferencesState,
  patch: Omit<F16PreferencesState, "settingsRevision">,
): F16PreferencesState {
  return {
    ...patch,
    settingsRevision: state.settingsRevision + 1,
  };
}

function profileForTask(
  state: F16PreferencesState,
  taskType: F16TaskType,
): F16TaskProfileRevision {
  const profile = state.taskProfiles.find(
    (candidate) => candidate.taskType === taskType,
  );
  if (profile === undefined)
    throw new F16ConfigurationError(
      "F16_PROFILE_UNAVAILABLE",
      "The declared AI task has no configured profile.",
      "Configure the matching task profile before starting work.",
    );
  return profile;
}

function validateProfileAgainstCapabilities(
  draft: F16TaskProfileDraft,
  capabilities: F16ProviderCapabilities | undefined,
): {
  readonly availability: F16TaskProfileRevision["availability"];
  readonly reason?: string;
} {
  if (capabilities === undefined)
    throw new F16ConfigurationError(
      "F16_PROVIDER_UNKNOWN",
      `No registered provider matches ${draft.providerId}.`,
      "Choose a registered provider and validate the profile again.",
      "providerId",
    );
  if (!capabilities.enabled)
    return {
      availability: draft.enabled ? "UNSUPPORTED" : "DISABLED",
      reason: "The selected provider is disabled.",
    };
  if (!capabilities.taskTypes.includes(draft.taskType))
    throw new F16ConfigurationError(
      "F16_CAPABILITY_UNSUPPORTED",
      `Provider ${draft.providerId} does not support ${draft.taskType}.`,
      "Choose a provider profile that supports this task type.",
      "taskType",
    );

  const modelCatalog = capabilities.modelCatalog;
  if (modelCatalog === undefined) {
    return {
      availability: draft.enabled ? "UNVERIFIED" : "DISABLED",
      reason:
        "The provider has no model catalog; invocation remains gated until F15 admission succeeds.",
    };
  }
  const model = modelCatalog.find(
    (candidate) => candidate.modelId === draft.modelId,
  );
  if (model === undefined)
    throw new F16ConfigurationError(
      "F16_CAPABILITY_UNSUPPORTED",
      `Model ${draft.modelId} is not advertised by provider ${draft.providerId}.`,
      "Choose an advertised model for this task profile.",
      "modelId",
    );
  if (
    model.taskTypes !== undefined &&
    !model.taskTypes.includes(draft.taskType)
  )
    throw new F16ConfigurationError(
      "F16_CAPABILITY_UNSUPPORTED",
      `Model ${draft.modelId} does not support ${draft.taskType}.`,
      "Choose another model or task profile.",
      "taskType",
    );
  const reasoning = draft.reasoningEffort;
  const reasoningEfforts =
    model.reasoningEfforts ?? capabilities.reasoningEfforts;
  if (reasoning !== undefined && !reasoningEfforts.includes(reasoning))
    throw new F16ConfigurationError(
      "F16_CAPABILITY_UNSUPPORTED",
      `Reasoning effort ${reasoning} is not supported for ${draft.modelId}.`,
      "Choose a supported reasoning effort or leave it unset.",
      "reasoningEffort",
    );
  if (
    model.supportedOptionKeys !== undefined &&
    Object.keys(draft.providerOptions).some(
      (key) => !model.supportedOptionKeys?.includes(key),
    )
  ) {
    const unsupported = Object.keys(draft.providerOptions).find(
      (key) => !model.supportedOptionKeys?.includes(key),
    );
    throw new F16ConfigurationError(
      "F16_CAPABILITY_UNSUPPORTED",
      `Provider option ${unsupported ?? "value"} is not supported for ${draft.modelId}.`,
      "Remove the unsupported option or choose another model.",
      "providerOptions",
    );
  }
  if (capabilities.providerOptionBounds === undefined)
    return {
      availability: draft.enabled ? "UNVERIFIED" : "DISABLED",
      reason:
        "The provider has not published a versioned options bound; invocation is blocked until it does.",
    };
  if (
    !f16ProviderOptionsWithinBounds(
      draft.providerOptions,
      capabilities.providerOptionBounds,
    )
  )
    throw new F16ConfigurationError(
      "F16_INPUT_LIMIT_EXCEEDED",
      "Provider options exceed the lower bound published by the selected provider.",
      "Reduce provider options to the provider capability limits before saving.",
      "providerOptions",
    );
  return {
    availability: draft.enabled ? "AVAILABLE" : "DISABLED",
  };
}

function mapProfileAvailability(result: {
  readonly availability: F16TaskProfileRevision["availability"];
  readonly reason?: string;
}): Pick<F16TaskProfileRevision, "availability" | "availabilityReason"> {
  return {
    availability: result.availability,
    ...(result.reason === undefined
      ? {}
      : { availabilityReason: result.reason }),
  };
}

function phaseMatchesTask(taskType: F16TaskType, phase: F16TaskPhase): boolean {
  if (taskType === "AUTOMATIC_REVIEW_REEVALUATION")
    return phase === "REVIEW_PROPOSAL" || phase === "REVIEW_IMPLEMENTATION";
  if (taskType === "REVIEW_REVISION") return phase === "REVIEW_REVISION";
  if (taskType === "READ_ONLY_CONVERSATION")
    return phase === "READ_ONLY_CONVERSATION";
  return phase === "MERGE_CONFLICT_RESOLUTION";
}

function outputContractForTask(taskType: F16TaskType): string {
  switch (taskType) {
    case "AUTOMATIC_REVIEW_REEVALUATION":
      return "REVIEW_PROPOSAL";
    case "REVIEW_REVISION":
      return "REVIEW_IMPLEMENTATION";
    case "READ_ONLY_CONVERSATION":
      return "READ_ONLY_CONVERSATION";
    case "MERGE_CONFLICT_RESOLUTION":
      return "CONFLICT_RESOLUTION";
  }
}

function toReadModel(state: F16PreferencesState): F16PreferencesReadModel {
  return {
    ...clone(state),
    policyPresets: f16PolicyPresetSummaries(),
  };
}

function buildValidationSnapshot(
  repository: F16RepositoryIdentity,
  settings: F16PreferencesState["repositories"][number] | undefined,
  summary: F16ValidationSummary,
): F16BuildValidationSnapshot {
  return {
    schemaVersion: F16_SCHEMA_VERSION,
    repository,
    ...(settings?.buildInstructions === undefined
      ? {}
      : { buildInstructions: settings.buildInstructions }),
    validation: summary,
  };
}

function makeHashInput(
  snapshot: Omit<F16EffectiveAITaskSnapshot, "snapshotId" | "snapshotHash">,
): string {
  return canonicalize(snapshot);
}

function makeSnapshot(
  input: Omit<F16EffectiveAITaskSnapshot, "snapshotId" | "snapshotHash">,
): F16EffectiveAITaskSnapshot {
  const hash = sha256(makeHashInput(input));
  const snapshot: F16EffectiveAITaskSnapshot = {
    ...input,
    snapshotId: `f16-snapshot-${hash.slice(0, 24)}`,
    snapshotHash: hash,
  };
  try {
    f16EffectiveAITaskSnapshotSchema.parse(snapshot);
    validateF16SnapshotSize(snapshot);
  } catch (error) {
    if (error instanceof F16ConfigurationError) throw error;
    if (
      error instanceof TypeError &&
      error.message === "F16_SNAPSHOT_LIMIT_EXCEEDED"
    )
      throw new F16ConfigurationError(
        "F16_SNAPSHOT_LIMIT_EXCEEDED",
        "The effective AI task snapshot exceeds the bounded handoff size.",
        "Reduce the selected instruction and context text before starting work.",
      );
    throw new F16ConfigurationError(
      "F16_INVALID_INPUT",
      "The effective AI task snapshot could not be validated.",
      "Reload Preferences and retry with bounded inputs.",
    );
  }
  return deepFreeze(snapshot);
}

export class F16PreferencesService {
  public constructor(private readonly options: F16ServiceOptions) {}

  public readPreferences(): F16PreferencesReadModel {
    return toReadModel(currentRecord(this.options.repositories).state);
  }

  public saveTaskProfile(
    input: F16TaskProfileSaveInput,
  ): F16PreferencesReadModel {
    const parsed = parseOrThrow(f16TaskProfileSaveInputSchema, input);
    const { record, state } = currentRecord(this.options.repositories);
    assertExpectedRevision(state, parsed.expectedSettingsRevision);
    const profile = parsed.profile;
    const capabilities = this.options.capabilities.get(profile.providerId);
    const availability = validateProfileAgainstCapabilities(
      profile,
      capabilities,
    );
    const existing = profileForTask(state, profile.taskType);
    const nextProfile: F16TaskProfileRevision = {
      schemaVersion: F16_SCHEMA_VERSION,
      profileId: existing.profileId,
      taskType: profile.taskType,
      providerId: profile.providerId,
      modelId: profile.modelId,
      ...(profile.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: profile.reasoningEffort }),
      providerOptions: clone(profile.providerOptions),
      enabled: profile.enabled,
      ...mapProfileAvailability(availability),
      revision: existing.revision + 1,
    };
    const taskProfiles = state.taskProfiles.map((candidate) =>
      candidate.taskType === profile.taskType ? nextProfile : candidate,
    );
    const next = nextState(state, {
      ...state,
      taskProfiles,
    });
    const result = this.commit(record, next, {
      kind: "TASK_PROFILE",
      id: nextProfile.profileId,
      revision: nextProfile.revision,
      payload: nextProfile,
    });
    return toReadModel(result.settings.payload);
  }

  public savePolicy(input: F16PolicySaveInput): F16PreferencesReadModel {
    const parsed = parseOrThrow(f16PolicySaveInputSchema, input);
    const { record, state } = currentRecord(this.options.repositories);
    assertExpectedRevision(state, parsed.expectedSettingsRevision);
    const nextPolicy = createF16PolicyRevision(
      parsed.preset,
      state.policy.revision + 1,
    );
    const next = nextState(state, { ...state, policy: nextPolicy });
    const result = this.commit(record, next, {
      kind: "EXECUTION_POLICY",
      id: nextPolicy.policyId,
      revision: nextPolicy.revision,
      payload: nextPolicy,
    });
    return toReadModel(result.settings.payload);
  }

  public async saveOperational(
    input: F16OperationalSaveInput,
  ): Promise<F16PreferencesReadModel> {
    const parsed = parseOrThrow(f16OperationalSaveInputSchema, input);
    const { record, state } = currentRecord(this.options.repositories);
    assertExpectedRevision(state, parsed.expectedSettingsRevision);
    if (
      parsed.maxAiWorkTurns < F16_MIN_AI_WORK_TURNS ||
      parsed.maxAiWorkTurns > F16_MAX_AI_WORK_TURNS
    )
      throw new F16ConfigurationError(
        "F16_INPUT_LIMIT_EXCEEDED",
        "Maximum AI Work Turns must be between 1 and 10.",
        "Choose a value from 1 through 10.",
        "maxAiWorkTurns",
      );
    const schedulerConfiguration =
      this.options.scheduler?.validateConfiguration({
        pollingIntervalMs: parsed.pollingIntervalMs,
        quietPeriodMs: parsed.quietPeriodMs,
      }) ?? validateF16F12Configuration(parsed);
    let worktreeRoot = state.operational.worktreeRoot;
    if (parsed.worktreeRoot === null) {
      worktreeRoot = undefined;
    } else if (parsed.worktreeRoot !== "") {
      if (parsed.worktreeRoot.length > F16_MAX_ROOT_PATH_UTF16)
        throw new F16ConfigurationError(
          "F16_INPUT_LIMIT_EXCEEDED",
          "The isolated-worktree root exceeds the Windows transport bound.",
          "Choose a shorter existing application-owned directory.",
          "worktreeRoot",
        );
      const rootPort = this.options.worktreeRoot;
      if (rootPort?.boundsRevision === undefined)
        throw new F16ConfigurationError(
          "F16_DELEGATED_BOUND_UNAVAILABLE",
          "F13 did not publish a versioned worktree-root bound.",
          "Update the worktree integration before changing this setting.",
        );
      if (rootPort === undefined)
        throw new F16ConfigurationError(
          "F16_WORKTREE_ROOT_INVALID",
          "The worktree-root validator is not available.",
          "Retry after the main process finishes initializing.",
        );
      const rootRevision = (worktreeRoot?.rootRevision ?? 0) + 1;
      const resolved = await rootPort.resolveRoot({
        worktreeRoot: parsed.worktreeRoot,
        rootRevision,
        correlationId: `f16-root-${state.settingsRevision + 1}`,
      });
      if (
        !resolved.ok ||
        resolved.configuredPath === undefined ||
        resolved.canonicalPath === undefined
      )
        throw new F16ConfigurationError(
          "F16_WORKTREE_ROOT_INVALID",
          resolved.reason?.what ??
            "The isolated-worktree root failed F13 validation.",
          resolved.reason?.nextAction ??
            "Choose an existing application-owned directory.",
          "worktreeRoot",
        );
      worktreeRoot = {
        configuredPath: resolved.configuredPath,
        canonicalPath: resolved.canonicalPath,
        rootRevision: resolved.rootRevision,
      };
    }
    const operational: F16OperationalPreferences = {
      schemaVersion: F16_SCHEMA_VERSION,
      maxAiWorkTurns: parsed.maxAiWorkTurns,
      ...(worktreeRoot === undefined ? {} : { worktreeRoot }),
      pollingIntervalMs: schedulerConfiguration.intervalMs,
      quietPeriodMs: schedulerConfiguration.quietPeriodMs,
    };
    const next = nextState(state, { ...state, operational });
    const result = this.commit(record, next);
    if (this.options.scheduler?.applyConfiguration !== undefined) {
      try {
        await this.options.scheduler.applyConfiguration(schedulerConfiguration);
      } catch {
        throw new F16ConfigurationError(
          "F16_SCHEDULER_SYNC_REQUIRED",
          "Preferences were committed, but F12 did not accept the scheduler handoff.",
          "Read Preferences and retry the scheduler handoff before relying on the new timing.",
        );
      }
    }
    return toReadModel(result.settings.payload);
  }

  public saveCommonInstruction(
    input: F16CommonInstructionSaveInput,
  ): F16PreferencesReadModel {
    const parsed = parseOrThrow(f16CommonInstructionSaveInputSchema, input);
    const { record, state } = currentRecord(this.options.repositories);
    assertExpectedRevision(state, parsed.expectedSettingsRevision);
    const profileId =
      parsed.profileId ?? `instruction-${randomUUID().replaceAll("-", "")}`;
    const existing = state.commonInstructionProfiles.find(
      (candidate) => candidate.profileId === profileId,
    );
    if (parsed.profileId !== undefined && existing === undefined)
      throw new F16ConfigurationError(
        "F16_NOT_FOUND",
        "The Common Instruction profile no longer exists.",
        "Read Preferences again and retry the edit.",
        "profileId",
      );
    const contentHash = sha256(parsed.instructionText);
    const nextProfile: F16CommonInstructionProfile = {
      schemaVersion: F16_SCHEMA_VERSION,
      profileId,
      name: parsed.name,
      instructionText: parsed.instructionText,
      enabled: parsed.enabled,
      revision: (existing?.revision ?? 0) + 1,
      contentHash,
    };
    const profiles =
      existing === undefined
        ? [...state.commonInstructionProfiles, nextProfile]
        : state.commonInstructionProfiles.map((candidate) =>
            candidate.profileId === profileId ? nextProfile : candidate,
          );
    if (profiles.length > F16_MAX_COMMON_PROFILES)
      throw new F16ConfigurationError(
        "F16_INPUT_LIMIT_EXCEEDED",
        "Common Instruction profile count exceeds the application bound.",
        "Delete an unused profile before creating another.",
      );
    const selected = parsed.selected
      ? [
          ...state.selectedCommonInstructionIds.filter(
            (id) => id !== profileId,
          ),
          profileId,
        ]
      : state.selectedCommonInstructionIds.filter((id) => id !== profileId);
    const normalizedProfiles = profiles.map((candidate) =>
      candidate.profileId === profileId ? candidate : candidate,
    );
    const selectedIds = parsed.enabled
      ? selected
      : selected.filter((id) => id !== profileId);
    this.assertCommonSelection(normalizedProfiles, selectedIds);
    const next = nextState(state, {
      ...state,
      commonInstructionProfiles: normalizedProfiles,
      selectedCommonInstructionIds: selectedIds,
    });
    const result = this.commit(record, next, {
      kind: "COMMON_INSTRUCTION",
      id: profileId,
      revision: nextProfile.revision,
      payload: nextProfile,
    });
    return toReadModel(result.settings.payload);
  }

  public deleteCommonInstruction(
    input: F16CommonInstructionDeleteInput,
  ): F16PreferencesReadModel {
    const parsed = parseOrThrow(f16CommonInstructionDeleteInputSchema, input);
    const { record, state } = currentRecord(this.options.repositories);
    assertExpectedRevision(state, parsed.expectedSettingsRevision);
    if (
      !state.commonInstructionProfiles.some(
        (profile) => profile.profileId === parsed.profileId,
      )
    )
      throw new F16ConfigurationError(
        "F16_NOT_FOUND",
        "The Common Instruction profile no longer exists.",
        "Read Preferences again before deleting it.",
      );
    const next = nextState(state, {
      ...state,
      commonInstructionProfiles: state.commonInstructionProfiles.filter(
        (profile) => profile.profileId !== parsed.profileId,
      ),
      selectedCommonInstructionIds: state.selectedCommonInstructionIds.filter(
        (id) => id !== parsed.profileId,
      ),
    });
    const result = this.commit(record, next);
    return toReadModel(result.settings.payload);
  }

  public saveCommonInstructionSelection(
    input: F16CommonInstructionSelectionSaveInput,
  ): F16PreferencesReadModel {
    const parsed = parseOrThrow(
      f16CommonInstructionSelectionSaveInputSchema,
      input,
    );
    const { record, state } = currentRecord(this.options.repositories);
    assertExpectedRevision(state, parsed.expectedSettingsRevision);
    this.assertCommonSelection(
      state.commonInstructionProfiles,
      parsed.selectedProfileIds,
    );
    const next = nextState(state, {
      ...state,
      selectedCommonInstructionIds: [...parsed.selectedProfileIds],
    });
    const result = this.commit(record, next);
    return toReadModel(result.settings.payload);
  }

  public saveRepositorySettings(
    input: F16RepositorySaveInput,
  ): F16PreferencesReadModel {
    const parsed = parseOrThrow(f16RepositorySaveInputSchema, input);
    const { record, state } = currentRecord(this.options.repositories);
    assertExpectedRevision(state, parsed.expectedSettingsRevision);
    const existing = state.repositories.find(
      (candidate) =>
        repositoryKey(candidate.repository) ===
        repositoryKey(parsed.repository),
    );
    const repositorySettings = {
      schemaVersion: F16_SCHEMA_VERSION,
      repository: parsed.repository,
      ...(parsed.buildInstructions.trim().length === 0
        ? {}
        : { buildInstructions: parsed.buildInstructions }),
      ...(existing?.validationSummary === undefined
        ? {}
        : { validationSummary: existing.validationSummary }),
      revision: (existing?.revision ?? 0) + 1,
    };
    const repositories =
      existing === undefined
        ? [...state.repositories, repositorySettings]
        : state.repositories.map((candidate) =>
            repositoryKey(candidate.repository) ===
            repositoryKey(parsed.repository)
              ? repositorySettings
              : candidate,
          );
    if (repositories.length > F16_MAX_REPOSITORIES)
      throw new F16ConfigurationError(
        "F16_INPUT_LIMIT_EXCEEDED",
        "Repository Build & Validation settings exceed the bounded collection.",
        "Remove an unused repository setting before adding another.",
      );
    const next = nextState(state, { ...state, repositories });
    const result = this.commit(record, next);
    return toReadModel(result.settings.payload);
  }

  public async resolveTask(
    input: F16ResolveTaskInput,
  ): Promise<F16EffectiveAITaskSnapshot> {
    const taskType = parseOrThrow(f16TaskTypeSchema, input.taskType);
    const phase = phaseForF16Task(taskType, input.phase);
    if (!phaseMatchesTask(taskType, phase))
      throw new F16ConfigurationError(
        "F16_INVALID_INPUT",
        `Task type ${taskType} cannot use phase ${phase}.`,
        "Declare the matching task type and phase explicitly.",
        "phase",
      );
    const { state } = currentRecord(this.options.repositories);
    const profile = profileForTask(state, taskType);
    if (!profile.enabled)
      throw new F16ConfigurationError(
        "F16_PROFILE_UNAVAILABLE",
        `The ${taskType} profile is disabled.`,
        "Enable the declared task profile before starting work.",
      );
    const capabilities = this.options.capabilities.get(profile.providerId);
    const availability = validateProfileAgainstCapabilities(
      {
        taskType,
        providerId: profile.providerId,
        modelId: profile.modelId,
        ...(profile.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: profile.reasoningEffort }),
        providerOptions: profile.providerOptions,
        enabled: profile.enabled,
      },
      capabilities,
    );
    if (availability.availability === "UNVERIFIED")
      throw new F16ConfigurationError(
        "F16_PROFILE_UNVERIFIED",
        availability.reason ??
          "The selected profile is not verified for invocation.",
        "Use a provider with an advertised model and options capability descriptor.",
      );
    if (availability.availability !== "AVAILABLE" || capabilities === undefined)
      throw new F16ConfigurationError(
        "F16_PROFILE_UNAVAILABLE",
        availability.reason ?? "The selected profile is unavailable.",
        "Correct the profile compatibility fields before starting work.",
      );
    if (capabilities.providerOptionBounds === undefined)
      throw new F16ConfigurationError(
        "F16_DELEGATED_BOUND_UNAVAILABLE",
        "F15 did not publish a versioned provider-options bound.",
        "Update the provider adapter before starting this task.",
      );
    if (
      !f16ProviderOptionsWithinBounds(
        profile.providerOptions,
        capabilities.providerOptionBounds,
      )
    )
      throw new F16ConfigurationError(
        "F16_INPUT_LIMIT_EXCEEDED",
        "The provider-options envelope exceeds the effective provider bound.",
        "Reduce provider-specific options before starting work.",
        "providerOptions",
      );
    if (
      !capabilities.outputContracts.some(
        (contract) => contract.contractId === outputContractForTask(taskType),
      )
    )
      throw new F16ConfigurationError(
        "F16_CAPABILITY_UNSUPPORTED",
        `The provider cannot produce the ${outputContractForTask(taskType)} result contract.`,
        "Choose a provider that supports this task type.",
      );
    const policyResolution = resolveF16EffectivePolicy({
      policy: state.policy,
      phase,
      capabilities,
      ...(input.operationWorktree === undefined
        ? {}
        : { operationWorktree: input.operationWorktree }),
    });
    if (!policyResolution.ok) {
      throw new F16ConfigurationError(
        policyResolution.code,
        policyResolution.message,
        policyResolution.code === "F16_WORKTREE_SCOPE_REQUIRED"
          ? "Prepare an operation-owned F13 worktree before starting this task."
          : "Choose a policy supported by the provider adapter.",
      );
    }
    const commonInstructions = state.selectedCommonInstructionIds.map(
      (profileId, order) => {
        const instruction = state.commonInstructionProfiles.find(
          (candidate) => candidate.profileId === profileId,
        );
        if (instruction === undefined || !instruction.enabled)
          throw new F16ConfigurationError(
            "F16_INVALID_INPUT",
            "The selected Common Instruction set changed before snapshot construction.",
            "Read Preferences again and retry the task.",
          );
        return {
          schemaVersion: F16_SCHEMA_VERSION,
          profileId: instruction.profileId,
          name: instruction.name,
          enabled: true as const,
          revision: instruction.revision,
          instructionText: instruction.instructionText,
          contentHash: instruction.contentHash,
          order,
        };
      },
    );
    if (commonInstructions.length > F16_MAX_SELECTED_COMMON_PROFILES)
      throw new F16ConfigurationError(
        "F16_INPUT_LIMIT_EXCEEDED",
        "The selected Common Instruction collection exceeds the application bound.",
        "Select no more than eight Common Instruction profiles.",
      );
    const aggregateInstructionBytes = commonInstructions.reduce(
      (total, instruction) =>
        total + f16ByteLength(instruction.instructionText),
      0,
    );
    if (aggregateInstructionBytes > F16_MAX_SELECTED_COMMON_TEXT_BYTES)
      throw new F16ConfigurationError(
        "F16_INPUT_LIMIT_EXCEEDED",
        "The selected Common Instruction text exceeds the snapshot bound.",
        "Reduce the selected instruction text before starting work.",
      );
    let buildValidation: F16BuildValidationSnapshot | undefined;
    if (input.repository !== undefined) {
      const repositorySettings = state.repositories.find(
        (candidate) =>
          repositoryKey(candidate.repository) ===
          repositoryKey(input.repository as F16RepositoryIdentity),
      );
      const validationPort = this.options.validation;
      if (validationPort?.boundsRevision === undefined)
        throw new F16ConfigurationError(
          "F16_DELEGATED_BOUND_UNAVAILABLE",
          "F00 did not publish a versioned validation-profile bound.",
          "Update the validation integration before starting repository-scoped work.",
        );
      const validation =
        validationPort === undefined
          ? { summary: defaultValidationSummary(), boundsRevision: "" }
          : await validationPort.resolve({
              repository: input.repository,
              ...(input.operationId === undefined
                ? {}
                : { operationId: input.operationId }),
            });
      if (validation.boundsRevision !== validationPort.boundsRevision)
        throw new F16ConfigurationError(
          "F16_DELEGATED_BOUND_UNAVAILABLE",
          "The F00 validation result does not match its published bounds revision.",
          "Reload the repository validation configuration and retry.",
        );
      buildValidation = buildValidationSnapshot(
        input.repository,
        repositorySettings,
        validation.summary,
      );
    }
    let prIntentContext: F16EffectiveAITaskSnapshot["prIntentContext"];
    if (
      input.prIntentContext !== undefined &&
      input.prIntentContext.length > 0
    ) {
      if (f16ByteLength(input.prIntentContext) > 32 * 1024)
        throw new F16ConfigurationError(
          "F16_INPUT_LIMIT_EXCEEDED",
          "PR Intent / Context exceeds the F07 context bound.",
          "Reduce the context text before starting work.",
          "prIntentContext",
        );
      prIntentContext = {
        text: input.prIntentContext,
        contentHash: sha256(input.prIntentContext),
      };
    }
    if (
      input.operationWorktree !== undefined &&
      this.options.worktreeRoot?.boundsRevision === undefined
    )
      throw new F16ConfigurationError(
        "F16_DELEGATED_BOUND_UNAVAILABLE",
        "F13 did not publish a versioned operation-root bound.",
        "Update the worktree integration before starting this task.",
      );
    const ipcBoundsRevision = this.options.ipcBoundsRevision;
    if (ipcBoundsRevision === undefined)
      throw new F16ConfigurationError(
        "F16_DELEGATED_BOUND_UNAVAILABLE",
        "F04 did not publish a versioned IPC envelope bound.",
        "Update the desktop shell integration before starting this task.",
      );
    const snapshotInput: Omit<
      F16EffectiveAITaskSnapshot,
      "snapshotId" | "snapshotHash"
    > = {
      schemaVersion: F16_SCHEMA_VERSION,
      taskType,
      phase,
      profile: {
        schemaVersion: profile.schemaVersion,
        profileId: profile.profileId,
        taskType: profile.taskType,
        providerId: profile.providerId,
        modelId: profile.modelId,
        ...(profile.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: profile.reasoningEffort }),
        providerOptions: clone(profile.providerOptions),
        enabled: profile.enabled,
        availability: "AVAILABLE",
        revision: profile.revision,
      },
      policy: policyResolution.value,
      commonInstructions,
      ...(buildValidation === undefined ? {} : { buildValidation }),
      ...(prIntentContext === undefined ? {} : { prIntentContext }),
      ...(input.operationWorktree === undefined
        ? {}
        : { operationWorktree: clone(input.operationWorktree) }),
      bounds: {
        f16: F16_BOUNDS_REVISION,
        f04: ipcBoundsRevision,
        ...(input.operationWorktree === undefined
          ? {}
          : { f13: this.options.worktreeRoot?.boundsRevision }),
        f15: capabilities.providerOptionBounds.boundsRevision,
        ...(input.repository === undefined
          ? {}
          : { f00: this.options.validation?.boundsRevision }),
      },
    };
    return makeSnapshot(snapshotInput);
  }

  private assertCommonSelection(
    profiles: readonly F16CommonInstructionProfile[],
    selectedIds: readonly string[],
  ): void {
    if (selectedIds.length > F16_MAX_SELECTED_COMMON_PROFILES)
      throw new F16ConfigurationError(
        "F16_INPUT_LIMIT_EXCEEDED",
        "No more than eight Common Instruction profiles may be selected.",
        "Select fewer profiles before saving.",
      );
    const seen = new Set<string>();
    let bytes = 0;
    for (const id of selectedIds) {
      if (seen.has(id))
        throw new F16ConfigurationError(
          "F16_INVALID_INPUT",
          "A Common Instruction profile was selected more than once.",
          "Remove the duplicate selection and retry.",
        );
      seen.add(id);
      const profile = profiles.find((candidate) => candidate.profileId === id);
      if (profile === undefined || !profile.enabled)
        throw new F16ConfigurationError(
          "F16_INVALID_INPUT",
          "Only existing enabled Common Instruction profiles may be selected.",
          "Enable the profile or remove it from the selected order.",
        );
      bytes += f16ByteLength(profile.instructionText);
    }
    if (bytes > F16_MAX_SELECTED_COMMON_TEXT_BYTES)
      throw new F16ConfigurationError(
        "F16_INPUT_LIMIT_EXCEEDED",
        "Selected Common Instruction text exceeds the aggregate snapshot bound.",
        "Reduce the selected instruction text before saving.",
      );
  }

  private commit<TRevision>(
    record: PersistedRecord<F16PreferencesState> | undefined,
    state: F16PreferencesState,
    revision?: {
      readonly kind: F16RevisionKind;
      readonly id: string;
      readonly revision: number;
      readonly payload: TRevision;
    },
  ): F16SettingsCommitResult<F16PreferencesState, TRevision> {
    const parsed = f16PreferencesStateSchema.safeParse(state);
    if (!parsed.success) throwSchemaFailure(parsed.error);
    try {
      return this.options.repositories.commitSettings({
        settings: parsed.data,
        expectedSettingsVersion: record?.version ?? 0,
        ...(revision === undefined ? {} : { revision }),
      });
    } catch (error) {
      if (error instanceof F16ConfigurationError) throw error;
      const message = error instanceof Error ? error.message : "";
      if (/CONFLICT/iu.test(message))
        throw new F16ConfigurationError(
          "F16_CONFLICT",
          "Preferences changed before the complete update could be committed.",
          "Read Preferences again and retry from the current revision.",
        );
      throw new F16ConfigurationError(
        "F16_PERSISTENCE_FAILURE",
        "The complete Preferences update was not committed.",
        "Retry after checking the application data store.",
      );
    }
  }
}

export function createF16PreferencesRepository(
  repositories: PersistenceRepositories,
): F16PreferencesRepository {
  return {
    readSettings: () =>
      repositories.getSetting<F16PreferencesState>(F16_SETTINGS_KEY),
    commitSettings: (input) =>
      repositories.commitF16Settings({
        settingKey: F16_SETTINGS_KEY,
        settingsPayload: input.settings,
        ...(input.expectedSettingsVersion === undefined
          ? {}
          : { expectedSettingsVersion: input.expectedSettingsVersion }),
        ...(input.revision === undefined ? {} : { revision: input.revision }),
      }),
  };
}

export const F16_SETTINGS_KEY_FOR_TESTS = F16_SETTINGS_KEY;
