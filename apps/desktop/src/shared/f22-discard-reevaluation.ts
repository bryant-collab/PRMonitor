import { z } from "zod";
import {
  f18ReviewBundleReadModelSchema,
  f18PullRequestSnapshotSchema,
  f18WorktreeConditionSchema,
  type F18ReviewBundleReadModel,
  type F18WorktreeCondition,
} from "./f18-automatic-review";

/**
 * Provider-neutral F22 contracts.  F22 owns the action gate and durable
 * choice workflow; F10/F13/F16/F18/F11 remain the authorities for their own
 * facts and effects.
 */
export const F22_SCHEMA_VERSION = 1 as const;
export const F22_MAX_EVENT_IDS = 256;
export const F22_MAX_PATHS = 2_000;
export const F22_MAX_TEXT = 8 * 1024;

const identifierSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:/#-]*$/u);
const boundedTextSchema = z.string().max(F22_MAX_TEXT);
const boundedShaSchema = z.string().min(1).max(256);
const remoteRepositorySchema =
  f18PullRequestSnapshotSchema.shape.baseRepository;
const safeRelativePathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine(
    (value) =>
      !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(value) &&
      !value.split(/[\\/]/u).includes("..") &&
      [...value].every(
        (character) =>
          character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
      ),
    "F22 persisted paths must be bounded relative paths without traversal or control characters.",
  );
const boundedPathListSchema = z
  .array(safeRelativePathSchema)
  .max(F22_MAX_PATHS);
const reasonDetailsSchema = z
  .record(z.union([z.string().max(512), z.number(), z.boolean()]))
  .refine((value) => Object.keys(value).length <= 32);

export const f22BundleStatusSchema = z.enum([
  "CURRENT",
  "INVALIDATED",
  "STALE",
  "ATTENTION",
  "DISCARDED",
  "SUPERSEDED",
]);
export type F22BundleStatus = z.infer<typeof f22BundleStatusSchema>;

export const f22ActionKindSchema = z.enum(["DISCARD", "REEVALUATE"]);
export type F22ActionKind = z.infer<typeof f22ActionKindSchema>;

export const f22ActionPhaseSchema = z.enum([
  "ADMITTED",
  "PREVIEW_READY",
  "CHOICE_CONFIRMED",
  "CLEARING_WORKTREE",
  "POST_CLEAR_REVALIDATION",
  "F16_SNAPSHOT",
  "HOLD_HANDOFF",
  "F18_HANDOFF",
  "COMPLETED",
  "CANCELLED",
  "FAILED",
  "UNKNOWN",
]);
export type F22ActionPhase = z.infer<typeof f22ActionPhaseSchema>;

export const f22ActionStatusSchema = z.enum([
  "PENDING",
  "COMPLETED",
  "CANCELLED",
  "FAILED",
  "UNKNOWN",
]);
export type F22ActionStatus = z.infer<typeof f22ActionStatusSchema>;

export const f22DirtyWorktreeChoiceSchema = z.enum([
  "NO_CHANGES",
  "CLEAR_ALL",
  "CLEAR_AI_ONLY",
  "KEEP_AND_CANCEL",
]);
export type F22DirtyWorktreeChoice = z.infer<
  typeof f22DirtyWorktreeChoiceSchema
>;

export const f22ReasonSchema = z
  .object({
    code: identifierSchema,
    what: boundedTextSchema,
    why: boundedTextSchema,
    nextAction: identifierSchema,
    details: reasonDetailsSchema.optional(),
  })
  .strict();
export type F22Reason = z.infer<typeof f22ReasonSchema>;

export const f22RemoteIdentitySchema = z
  .object({
    serverId: identifierSchema,
    repositoryKey: identifierSchema,
    pullRequestKey: identifierSchema.optional(),
  })
  .strict();
export type F22RemoteIdentity = z.infer<typeof f22RemoteIdentitySchema>;

export const f22RemoteHeadReadSchema = z
  .object({
    outcome: z.enum(["CURRENT", "UNAVAILABLE", "MALFORMED", "CANCELLED"]),
    identity: f22RemoteIdentitySchema,
    baseSha: boundedShaSchema.optional(),
    headSha: boundedShaSchema.optional(),
    baseRepository: remoteRepositorySchema.optional(),
    headRepository: remoteRepositorySchema.optional(),
    baseBranch: boundedTextSchema.optional(),
    headBranch: boundedTextSchema.optional(),
    observationRevision: z.number().int().nonnegative(),
    observedAt: z.string().min(1).max(128),
    attemptId: identifierSchema.optional(),
    reason: f22ReasonSchema.optional(),
  })
  .strict();
export type F22RemoteHeadRead = z.infer<typeof f22RemoteHeadReadSchema>;

export const f22RemoteHeadObservationSchema = z
  .object({
    outcome: z.enum([
      "UNCHANGED",
      "MOVED",
      "UNAVAILABLE",
      "MALFORMED",
      "CANCELLED",
      "STALE",
    ]),
    identity: f22RemoteIdentitySchema,
    expectedHeadSha: boundedShaSchema,
    observedHeadSha: boundedShaSchema.optional(),
    observedBaseSha: boundedShaSchema.optional(),
    baseRepository: remoteRepositorySchema.optional(),
    headRepository: remoteRepositorySchema.optional(),
    baseBranch: boundedTextSchema.optional(),
    headBranch: boundedTextSchema.optional(),
    observationRevision: z.number().int().nonnegative(),
    observedAt: z.string().min(1).max(128),
    attemptId: identifierSchema.optional(),
    reason: f22ReasonSchema,
  })
  .strict();
export type F22RemoteHeadObservation = z.infer<
  typeof f22RemoteHeadObservationSchema
>;

export const f22ConfigurationSummarySchema = z
  .object({
    taskType: identifierSchema.optional(),
    profileId: identifierSchema.optional(),
    profileRevision: z.number().int().nonnegative().optional(),
    providerId: identifierSchema.optional(),
    modelId: identifierSchema.optional(),
    policyId: identifierSchema.optional(),
    policyRevision: z.number().int().nonnegative().optional(),
    effectivePreset: identifierSchema.optional(),
    commonInstructionIds: z.array(identifierSchema).max(32),
    buildValidationStatus: identifierSchema.optional(),
    prIntentContextHash: boundedShaSchema.optional(),
  })
  .strict();
export type F22ConfigurationSummary = z.infer<
  typeof f22ConfigurationSummarySchema
>;

export const f22ActionGateSchema = z
  .object({
    schemaVersion: z.literal(F22_SCHEMA_VERSION),
    kind: z.literal("F22_ACTION_GATE"),
    bundleId: identifierSchema,
    managedPrId: identifierSchema,
    bundleRevision: z.number().int().nonnegative(),
    gateRevision: z.number().int().nonnegative(),
    status: f22BundleStatusSchema,
    underlyingState: z.enum(["WORKING", "READY_FOR_REVIEW", "NEEDS_ATTENTION"]),
    remote: z
      .object({
        identity: f22RemoteIdentitySchema,
        expectedBaseSha: boundedShaSchema.optional(),
        expectedHeadSha: boundedShaSchema,
        expectedBaseRepository: remoteRepositorySchema.optional(),
        expectedHeadRepository: remoteRepositorySchema.optional(),
        expectedBaseBranch: boundedTextSchema.optional(),
        expectedHeadBranch: boundedTextSchema.optional(),
        observedIdentity: f22RemoteIdentitySchema.optional(),
        observedBaseSha: boundedShaSchema.optional(),
        observedHeadSha: boundedShaSchema.optional(),
        observedBaseRepository: remoteRepositorySchema.optional(),
        observedHeadRepository: remoteRepositorySchema.optional(),
        observedBaseBranch: boundedTextSchema.optional(),
        observedHeadBranch: boundedTextSchema.optional(),
        observationRevision: z.number().int().nonnegative().optional(),
        observedAt: z.string().max(128).optional(),
        observationToken: identifierSchema.optional(),
      })
      .strict(),
    reason: f22ReasonSchema.optional(),
    worktreeCondition: f18WorktreeConditionSchema.optional(),
    hold: z
      .object({
        active: z.boolean(),
        holdId: identifierSchema.optional(),
        claimId: identifierSchema.optional(),
        operationId: identifierSchema.optional(),
        bundleId: identifierSchema.optional(),
        revision: z.number().int().nonnegative().optional(),
      })
      .strict(),
    retainedCandidateEventVersionIds: z
      .array(identifierSchema)
      .max(F22_MAX_EVENT_IDS)
      .optional(),
    primaryReviewState: z
      .enum(["WATCHING", "WORKING", "READY_FOR_REVIEW", "NEEDS_ATTENTION"])
      .optional(),
    synchronizationOverlay: z
      .object({
        status: identifierSchema,
        reasonCode: identifierSchema.optional(),
      })
      .strict()
      .optional(),
    actions: z
      .object({
        inspect: z.boolean(),
        discard: z.boolean(),
        reevaluate: z.boolean(),
        continueOldWork: z.boolean(),
        publication: z.literal(false),
      })
      .strict(),
    permittedNextActions: z.array(identifierSchema).max(32),
    history: z
      .object({
        parentBundleId: identifierSchema.optional(),
        supersededByBundleId: identifierSchema.optional(),
      })
      .strict(),
  })
  .strict();
export type F22ActionGate = z.infer<typeof f22ActionGateSchema>;

export const f22ReevaluationPreviewSchema = z
  .object({
    schemaVersion: z.literal(F22_SCHEMA_VERSION),
    kind: z.literal("F22_REEVALUATION_PREVIEW"),
    actionId: identifierSchema,
    bundleId: identifierSchema,
    managedPrId: identifierSchema,
    remote: f22ActionGateSchema.shape.remote,
    originalEventVersionIds: z
      .array(identifierSchema)
      .min(1)
      .max(F22_MAX_EVENT_IDS),
    retainedCandidateEventVersionIds: z
      .array(identifierSchema)
      .max(F22_MAX_EVENT_IDS),
    selectedRetainedEventVersionIds: z
      .array(identifierSchema)
      .max(F22_MAX_EVENT_IDS),
    worktreeCondition: f18WorktreeConditionSchema.optional(),
    configuration: f22ConfigurationSummarySchema,
    holdRemainsActive: z.boolean(),
    publicationAuthorized: z.literal(false),
    requiredChoice: f22DirtyWorktreeChoiceSchema,
    confirmationText: boundedTextSchema,
    gateRevision: z.number().int().nonnegative(),
    actionRevision: z.number().int().nonnegative(),
  })
  .strict();
export type F22ReevaluationPreview = z.infer<
  typeof f22ReevaluationPreviewSchema
>;

export const f22DiscardPreviewSchema = z
  .object({
    schemaVersion: z.literal(F22_SCHEMA_VERSION),
    kind: z.literal("F22_DISCARD_PREVIEW"),
    actionId: identifierSchema,
    bundleId: identifierSchema,
    managedPrId: identifierSchema,
    gateRevision: z.number().int().nonnegative(),
    actionRevision: z.number().int().nonnegative(),
    worktreeCondition: f18WorktreeConditionSchema.optional(),
    requiredChoice: f22DirtyWorktreeChoiceSchema,
    confirmationText: boundedTextSchema,
    publicationAuthorized: z.literal(false),
  })
  .strict();
export type F22DiscardPreview = z.infer<typeof f22DiscardPreviewSchema>;

export const f22ActionResultSchema = z
  .object({
    choice: f22DirtyWorktreeChoiceSchema.optional(),
    outcome: identifierSchema.optional(),
    clearReconciliation: z
      .enum(["COMMITTED", "NOT_COMMITTED", "UNCERTAIN"])
      .optional(),
    preview: z
      .union([f22DiscardPreviewSchema, f22ReevaluationPreviewSchema])
      .optional(),
    removed: boundedPathListSchema.optional(),
    preserved: boundedPathListSchema.optional(),
    remaining: boundedPathListSchema.optional(),
    newBundleId: identifierSchema.optional(),
    newOperationId: identifierSchema.optional(),
    newClaimId: identifierSchema.optional(),
    newHoldId: identifierSchema.optional(),
    currentF16Configuration: f22ConfigurationSummarySchema.optional(),
    currentF16SnapshotId: identifierSchema.optional(),
    currentF16SnapshotHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
  })
  .strict();
export type F22ActionResult = z.infer<typeof f22ActionResultSchema>;

export const f22PendingActionSchema = z
  .object({
    actionId: identifierSchema,
    bundleId: identifierSchema,
    action: f22ActionKindSchema,
    phase: f22ActionPhaseSchema,
    status: f22ActionStatusSchema,
    version: z.number().int().nonnegative(),
    preview: z
      .union([f22DiscardPreviewSchema, f22ReevaluationPreviewSchema])
      .optional(),
  })
  .strict();
export type F22PendingAction = z.infer<typeof f22PendingActionSchema>;

export const f22ActionIntentSchema = z
  .object({
    schemaVersion: z.literal(F22_SCHEMA_VERSION),
    actionId: identifierSchema,
    idempotencyKey: identifierSchema,
    action: f22ActionKindSchema,
    phase: f22ActionPhaseSchema,
    status: f22ActionStatusSchema,
    version: z.number().int().nonnegative(),
    bundleId: identifierSchema,
    managedPrId: identifierSchema,
    expectedBundleVersion: z.number().int().nonnegative(),
    expectedGateRevision: z.number().int().nonnegative(),
    expectedConditionRevision: boundedShaSchema.optional(),
    expectedObservationRevision: z.number().int().nonnegative().optional(),
    choice: f22DirtyWorktreeChoiceSchema.optional(),
    confirmed: z.boolean(),
    operationId: identifierSchema.optional(),
    claimId: identifierSchema.optional(),
    holdId: identifierSchema.optional(),
    originalEventVersionIds: z.array(identifierSchema).max(F22_MAX_EVENT_IDS),
    retainedEventVersionIds: z.array(identifierSchema).max(F22_MAX_EVENT_IDS),
    newBundleId: identifierSchema.optional(),
    newOperationId: identifierSchema.optional(),
    newClaimId: identifierSchema.optional(),
    newHoldId: identifierSchema.optional(),
    reason: f22ReasonSchema.optional(),
    result: f22ActionResultSchema.optional(),
    createdAt: z.string().min(1).max(128),
    updatedAt: z.string().min(1).max(128),
  })
  .strict();
export type F22ActionIntent = z.infer<typeof f22ActionIntentSchema>;

export const f22BundleStateRecordSchema = z
  .object({
    schemaVersion: z.literal(F22_SCHEMA_VERSION),
    bundleId: identifierSchema,
    managedPrId: identifierSchema,
    status: f22BundleStatusSchema,
    revision: z.number().int().nonnegative(),
    bundleRevision: z.number().int().nonnegative(),
    identity: f22RemoteIdentitySchema,
    expectedBaseSha: boundedShaSchema.optional(),
    expectedHeadSha: boundedShaSchema,
    expectedBaseRepository: remoteRepositorySchema.optional(),
    expectedHeadRepository: remoteRepositorySchema.optional(),
    expectedBaseBranch: boundedTextSchema.optional(),
    expectedHeadBranch: boundedTextSchema.optional(),
    observedBaseSha: boundedShaSchema.optional(),
    observedHeadSha: boundedShaSchema.optional(),
    observedIdentity: f22RemoteIdentitySchema.optional(),
    observedBaseRepository: remoteRepositorySchema.optional(),
    observedHeadRepository: remoteRepositorySchema.optional(),
    observedBaseBranch: boundedTextSchema.optional(),
    observedHeadBranch: boundedTextSchema.optional(),
    observationRevision: z.number().int().nonnegative().optional(),
    observedAt: z.string().max(128).optional(),
    reason: f22ReasonSchema.optional(),
    condition: f18WorktreeConditionSchema.optional(),
    parentBundleId: identifierSchema.optional(),
    supersededByBundleId: identifierSchema.optional(),
    updatedAt: z.string().min(1).max(128),
  })
  .strict();
export type F22BundleStateRecord = z.infer<typeof f22BundleStateRecordSchema>;

export interface F22BundlePort {
  readonly getReadModel?: (
    bundleId: string,
  ) => F18ReviewBundleReadModel | undefined;
  readonly listReadModels?: (
    managedPrId: string,
  ) => readonly F18ReviewBundleReadModel[];
}

export function f22RemoteRepositoryEqual(
  left: z.infer<typeof remoteRepositorySchema> | undefined,
  right: z.infer<typeof remoteRepositorySchema> | undefined,
): boolean {
  return (
    left?.serverId === right?.serverId &&
    left?.owner === right?.owner &&
    left?.name === right?.name &&
    left?.key === right?.key
  );
}

export function classifyF22RemoteHead(input: {
  readonly expected: F22RemoteIdentity;
  readonly expectedHeadSha: string;
  readonly expectedBaseSha?: string;
  readonly expectedBaseRepository?: z.infer<typeof remoteRepositorySchema>;
  readonly expectedHeadRepository?: z.infer<typeof remoteRepositorySchema>;
  readonly expectedBaseBranch?: string;
  readonly expectedHeadBranch?: string;
  readonly read: F22RemoteHeadRead;
  readonly now: string;
  readonly maxAgeMs: number;
}): F22RemoteHeadObservation {
  const sameIdentity =
    input.expected.serverId === input.read.identity.serverId &&
    input.expected.repositoryKey === input.read.identity.repositoryKey &&
    input.expected.pullRequestKey === input.read.identity.pullRequestKey;
  const age = Date.parse(input.now) - Date.parse(input.read.observedAt);
  const reasonFor = (
    code: string,
    what: string,
    why: string,
    nextAction: string,
    details: Record<string, string | number | boolean> = {},
  ): F22Reason => ({ code, what, why, nextAction, details });
  const common = {
    identity: input.read.identity,
    expectedHeadSha: input.expectedHeadSha,
    ...(input.read.baseSha === undefined
      ? {}
      : { observedBaseSha: input.read.baseSha }),
    ...(input.read.baseRepository === undefined
      ? {}
      : { baseRepository: input.read.baseRepository }),
    ...(input.read.headRepository === undefined
      ? {}
      : { headRepository: input.read.headRepository }),
    ...(input.read.baseBranch === undefined
      ? {}
      : { baseBranch: input.read.baseBranch }),
    ...(input.read.headBranch === undefined
      ? {}
      : { headBranch: input.read.headBranch }),
    observationRevision: input.read.observationRevision,
    observedAt: input.read.observedAt,
    ...(input.read.attemptId === undefined
      ? {}
      : { attemptId: input.read.attemptId }),
  } as const;
  if (!sameIdentity)
    return {
      ...common,
      outcome: "MALFORMED",
      reason: reasonFor(
        "REMOTE_IDENTITY_MISMATCH",
        "The fresh remote read belongs to a different server, repository, or pull request.",
        "F22 compares exact server-scoped identities and never substitutes a same-named branch or repository.",
        "REFRESH_EVIDENCE",
      ),
    };
  if (input.read.outcome === "CANCELLED")
    return {
      ...common,
      outcome: "CANCELLED",
      reason:
        input.read.reason ??
        reasonFor(
          "REMOTE_HEAD_CHECK_CANCELLED",
          "The current remote-head check was cancelled.",
          "F22 cannot authorize an action from an incomplete freshness read.",
          "RETRY",
        ),
    };
  if (input.read.outcome === "UNAVAILABLE")
    return {
      ...common,
      outcome: "UNAVAILABLE",
      reason:
        input.read.reason ??
        reasonFor(
          "REMOTE_HEAD_CHECK_UNAVAILABLE",
          "The current pull-request head could not be verified.",
          "A failed remote read is not proof that the pull request moved.",
          "RETRY",
        ),
    };
  if (input.read.outcome === "MALFORMED")
    return {
      ...common,
      outcome: "MALFORMED",
      reason:
        input.read.reason ??
        reasonFor(
          "REMOTE_HEAD_CHECK_MALFORMED",
          "The remote-head response was incomplete or malformed.",
          "F22 requires a bounded server-scoped head SHA before it can classify the bundle.",
          "RETRY",
        ),
    };
  if (input.read.outcome === "CURRENT") {
    const missingReference =
      (input.expectedBaseSha !== undefined &&
        input.read.baseSha === undefined) ||
      (input.expectedBaseRepository !== undefined &&
        input.read.baseRepository === undefined) ||
      (input.expectedHeadRepository !== undefined &&
        input.read.headRepository === undefined) ||
      (input.expectedBaseBranch !== undefined &&
        input.read.baseBranch === undefined) ||
      (input.expectedHeadBranch !== undefined &&
        input.read.headBranch === undefined) ||
      input.read.headSha === undefined;
    if (missingReference)
      return {
        ...common,
        outcome: "MALFORMED",
        reason: reasonFor(
          "REMOTE_REF_IDENTITY_UNAVAILABLE",
          "The current remote read omitted an exact repository, branch, or SHA reference.",
          "F22 requires the server-scoped base/head repositories, branches, and SHAs before it can authorize an action.",
          "REFRESH_EVIDENCE",
        ),
      };
    const mismatchedReference =
      input.expectedBaseSha !== undefined &&
      input.read.baseSha !== input.expectedBaseSha
        ? "baseSha"
        : input.expectedBaseRepository !== undefined &&
            !f22RemoteRepositoryEqual(
              input.expectedBaseRepository,
              input.read.baseRepository,
            )
          ? "baseRepository"
          : input.expectedHeadRepository !== undefined &&
              !f22RemoteRepositoryEqual(
                input.expectedHeadRepository,
                input.read.headRepository,
              )
            ? "headRepository"
            : input.expectedBaseBranch !== undefined &&
                input.read.baseBranch !== input.expectedBaseBranch
              ? "baseBranch"
              : input.expectedHeadBranch !== undefined &&
                  input.read.headBranch !== input.expectedHeadBranch
                ? "headBranch"
                : undefined;
    if (mismatchedReference !== undefined)
      return {
        ...common,
        outcome: "MALFORMED",
        reason: reasonFor(
          "REMOTE_REF_IDENTITY_MISMATCH",
          "The current remote read does not match the exact recorded repository, branch, or base SHA.",
          "F22 never substitutes a same-named repository, branch, or cached base reference for the authoritative Review Bundle identity.",
          "RE_EVALUATE",
          { mismatchedReference },
        ),
      };
  }
  if (
    !Number.isFinite(age) ||
    age < -input.maxAgeMs ||
    age > input.maxAgeMs ||
    input.read.headSha === undefined
  )
    return {
      ...common,
      outcome: "STALE",
      reason: reasonFor(
        "REMOTE_HEAD_CHECK_STALE",
        "The saved remote-head observation is too old to authorize this action.",
        "F22 will not treat an old cache entry as current remote identity.",
        "RETRY",
      ),
    };
  if (input.read.headSha === input.expectedHeadSha)
    return {
      ...common,
      outcome: "UNCHANGED",
      observedHeadSha: input.read.headSha,
      reason: reasonFor(
        "REMOTE_HEAD_UNCHANGED",
        "The current pull-request head matches the Review Bundle.",
        "The exact server-scoped remote identity and SHA were verified.",
        "NONE",
      ),
    };
  return {
    ...common,
    outcome: "MOVED",
    observedHeadSha: input.read.headSha,
    reason: reasonFor(
      "REMOTE_HEAD_MOVED",
      "The pull-request head moved after this Review Bundle was prepared.",
      "The recorded proposal is unsafe to continue or publish against a different exact head SHA.",
      "RE_EVALUATE",
      {
        expectedHeadSha: input.expectedHeadSha,
        observedHeadSha: input.read.headSha,
      },
    ),
  };
}

export function configurationSummaryFromTaskSnapshot(input: {
  readonly taskType: string;
  readonly profileId: string;
  readonly profileRevision: number;
  readonly providerId: string;
  readonly modelId: string;
  readonly policyId: string;
  readonly policyRevision: number;
  readonly effectivePreset: string;
  readonly commonInstructionIds: readonly string[];
  readonly buildValidationStatus?: string;
  readonly prIntentContextHash?: string;
}): F22ConfigurationSummary {
  return f22ConfigurationSummarySchema.parse({
    ...input,
    commonInstructionIds: [...input.commonInstructionIds],
  });
}

export function initialF22BundleState(input: {
  readonly bundle: F18ReviewBundleReadModel;
  readonly identity: F22RemoteIdentity;
  readonly parentBundleId?: string;
}): F22BundleStateRecord {
  return f22BundleStateRecordSchema.parse({
    schemaVersion: F22_SCHEMA_VERSION,
    bundleId: input.bundle.bundleId,
    managedPrId: input.bundle.managedPrId,
    status: "CURRENT",
    revision: 0,
    bundleRevision: input.bundle.version,
    identity: input.identity,
    expectedBaseSha: input.bundle.input.pullRequest.baseSha,
    expectedHeadSha: input.bundle.input.pullRequest.headSha,
    expectedBaseRepository: input.bundle.input.pullRequest.baseRepository,
    expectedHeadRepository: input.bundle.input.pullRequest.headRepository,
    expectedBaseBranch: input.bundle.input.pullRequest.baseBranch,
    expectedHeadBranch: input.bundle.input.pullRequest.headBranch,
    ...(input.parentBundleId === undefined
      ? {}
      : { parentBundleId: input.parentBundleId }),
    updatedAt: new Date(0).toISOString(),
  });
}

export function f22GateFor(
  bundle: F18ReviewBundleReadModel,
  state: F22BundleStateRecord,
  input: {
    readonly hold?: {
      readonly active: boolean;
      readonly holdId?: string;
      readonly claimId?: string;
      readonly operationId?: string;
      readonly bundleId?: string;
      readonly revision?: number;
    };
    readonly activeOperation?: {
      readonly mutationActive: boolean;
      readonly operationId?: string;
      readonly status?: string;
    };
    readonly condition?: F18WorktreeCondition;
    readonly retainedCandidateEventVersionIds?: readonly string[];
    readonly primaryReviewState?: F22ActionGate["primaryReviewState"];
    readonly synchronizationOverlay?: F22ActionGate["synchronizationOverlay"];
  } = {},
): F22ActionGate {
  const condition =
    input.condition ?? state.condition ?? bundle.worktree?.condition;
  const blocked = ["STALE", "INVALIDATED", "ATTENTION"].includes(state.status);
  const remoteFreshnessBlocked = [
    "REMOTE_IDENTITY_MISMATCH",
    "REMOTE_REF_IDENTITY_MISMATCH",
    "REMOTE_REF_IDENTITY_UNAVAILABLE",
    "REMOTE_HEAD_CHECK_CANCELLED",
    "REMOTE_HEAD_CHECK_MALFORMED",
    "REMOTE_HEAD_CHECK_STALE",
    "REMOTE_HEAD_CHECK_CONFLICTING",
    "REMOTE_HEAD_CHECK_UNAVAILABLE",
    "REMOTE_HEAD_UNAVAILABLE",
    "REMOTE_HEAD_OBSERVATION_REQUIRED",
  ].includes(state.reason?.code ?? "");
  const hasFreshObservation =
    state.observationRevision !== undefined &&
    state.observedHeadSha !== undefined &&
    state.observedIdentity !== undefined;
  const stable = bundle.state !== "WORKING";
  const ownsActiveHold =
    input.hold === undefined ||
    (input.hold.active === true &&
      input.hold.bundleId === bundle.bundleId &&
      input.hold.operationId === bundle.operationId);
  const mutationActive = input.activeOperation?.mutationActive === true;
  const observedIdentity = state.observedIdentity;
  const exactIdentity =
    observedIdentity !== undefined &&
    observedIdentity.serverId === state.identity.serverId &&
    observedIdentity.repositoryKey === state.identity.repositoryKey &&
    observedIdentity.pullRequestKey === state.identity.pullRequestKey;
  const exactBaseReference =
    state.expectedBaseSha === undefined ||
    state.observedBaseSha === state.expectedBaseSha;
  const exactBaseRepository =
    state.expectedBaseRepository === undefined ||
    f22RemoteRepositoryEqual(
      state.expectedBaseRepository,
      state.observedBaseRepository,
    );
  const exactHeadRepository =
    state.expectedHeadRepository === undefined ||
    f22RemoteRepositoryEqual(
      state.expectedHeadRepository,
      state.observedHeadRepository,
    );
  const exactBranches =
    (state.expectedBaseBranch === undefined ||
      state.expectedBaseBranch === state.observedBaseBranch) &&
    (state.expectedHeadBranch === undefined ||
      state.expectedHeadBranch === state.observedHeadBranch);
  const canDiscard =
    ownsActiveHold &&
    !mutationActive &&
    hasFreshObservation &&
    exactIdentity &&
    exactBaseReference &&
    exactBaseRepository &&
    exactHeadRepository &&
    exactBranches &&
    !remoteFreshnessBlocked &&
    !["DISCARDED", "SUPERSEDED"].includes(state.status) &&
    stable;
  const canReevaluate =
    ownsActiveHold &&
    !mutationActive &&
    hasFreshObservation &&
    exactIdentity &&
    exactBaseReference &&
    exactBaseRepository &&
    exactHeadRepository &&
    exactBranches &&
    !remoteFreshnessBlocked &&
    !["DISCARDED", "SUPERSEDED"].includes(state.status) &&
    stable &&
    blocked;
  const conditionAllowsContinuation =
    condition === undefined ||
    condition.permittedNextActions.includes("CONTINUE_AI_WORK");
  const reason = mutationActive
    ? {
        code: "F21_OPERATION_ACTIVE",
        what: "The Review Bundle has an active mutable F21 operation.",
        why: "F22 will not take ownership of the operation worktree while another workflow can still mutate it.",
        nextAction: "WAIT",
        details: input.activeOperation?.operationId
          ? { operationId: input.activeOperation.operationId }
          : {},
      }
    : input.hold !== undefined && !ownsActiveHold
      ? {
          code: "F11_HOLD_MISSING_OR_MISMATCHED",
          what: "The Review Bundle no longer owns the active per-PR hold.",
          why: "F22 will not clear a worktree or start re-evaluation without the exact F11 owner.",
          nextAction: "RECONCILE",
          details: {},
        }
      : (state.reason ??
        (!hasFreshObservation
          ? {
              code: "REMOTE_HEAD_OBSERVATION_REQUIRED",
              what: "A current remote-head observation is required before this F22 action can proceed.",
              why: "F22 fails closed until the authoritative remote identity and head SHA have been observed at least once.",
              nextAction: "REFRESH_EVIDENCE",
              details: {},
            }
          : undefined));
  const nextActions = new Set<string>();
  if (canDiscard) nextActions.add("DISCARD");
  if (canReevaluate) nextActions.add("RE_EVALUATE");
  if (condition?.permittedNextActions !== undefined)
    for (const action of condition.permittedNextActions)
      nextActions.add(action);
  if (reason?.nextAction !== undefined) nextActions.add(reason.nextAction);
  return f22ActionGateSchema.parse({
    schemaVersion: F22_SCHEMA_VERSION,
    kind: "F22_ACTION_GATE",
    bundleId: bundle.bundleId,
    managedPrId: bundle.managedPrId,
    bundleRevision: bundle.version,
    gateRevision: state.revision,
    status: state.status,
    underlyingState: bundle.state,
    remote: {
      identity: state.identity,
      ...(state.expectedBaseSha === undefined
        ? {}
        : { expectedBaseSha: state.expectedBaseSha }),
      expectedHeadSha: state.expectedHeadSha,
      expectedBaseRepository:
        state.expectedBaseRepository ?? bundle.input.pullRequest.baseRepository,
      expectedHeadRepository:
        state.expectedHeadRepository ?? bundle.input.pullRequest.headRepository,
      expectedBaseBranch:
        state.expectedBaseBranch ?? bundle.input.pullRequest.baseBranch,
      expectedHeadBranch:
        state.expectedHeadBranch ?? bundle.input.pullRequest.headBranch,
      ...(state.observedIdentity === undefined
        ? {}
        : { observedIdentity: state.observedIdentity }),
      ...(state.observedBaseSha === undefined
        ? {}
        : { observedBaseSha: state.observedBaseSha }),
      ...(state.observedHeadSha === undefined
        ? {}
        : { observedHeadSha: state.observedHeadSha }),
      ...(state.observedBaseRepository === undefined
        ? {}
        : { observedBaseRepository: state.observedBaseRepository }),
      ...(state.observedHeadRepository === undefined
        ? {}
        : { observedHeadRepository: state.observedHeadRepository }),
      ...(state.observedBaseBranch === undefined
        ? {}
        : { observedBaseBranch: state.observedBaseBranch }),
      ...(state.observedHeadBranch === undefined
        ? {}
        : { observedHeadBranch: state.observedHeadBranch }),
      ...(state.observationRevision === undefined
        ? {}
        : { observationRevision: state.observationRevision }),
      ...(state.observedAt === undefined
        ? {}
        : { observedAt: state.observedAt }),
    },
    ...(reason === undefined ? {} : { reason }),
    ...(condition === undefined ? {} : { worktreeCondition: condition }),
    hold: input.hold ?? { active: false },
    ...(input.retainedCandidateEventVersionIds === undefined
      ? {}
      : {
          retainedCandidateEventVersionIds: [
            ...input.retainedCandidateEventVersionIds,
          ],
        }),
    ...(input.primaryReviewState === undefined
      ? {}
      : { primaryReviewState: input.primaryReviewState }),
    ...(input.synchronizationOverlay === undefined
      ? {}
      : { synchronizationOverlay: input.synchronizationOverlay }),
    actions: {
      inspect: true,
      discard: canDiscard,
      reevaluate: canReevaluate,
      continueOldWork:
        !blocked &&
        hasFreshObservation &&
        !remoteFreshnessBlocked &&
        stable &&
        state.status === "CURRENT" &&
        conditionAllowsContinuation,
      publication: false,
    },
    permittedNextActions: [...nextActions].slice(0, 32),
    history: {
      ...(state.parentBundleId === undefined
        ? {}
        : { parentBundleId: state.parentBundleId }),
      ...(state.supersededByBundleId === undefined
        ? {}
        : { supersededByBundleId: state.supersededByBundleId }),
    },
  });
}

export function f22BundleSchemaCompatible(
  value: unknown,
): value is F18ReviewBundleReadModel {
  return f18ReviewBundleReadModelSchema.safeParse(value).success;
}
