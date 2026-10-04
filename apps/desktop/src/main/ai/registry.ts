import {
  aiProviderCapabilitiesSchema,
  aiProviderOutputContractSchema,
  aiProviderRequestSchema,
  aiProviderTurnResultSchema,
  assertAIProviderRequest,
  assertAIProviderTurnResult,
  outputContractForTask,
  parseAIProviderStructuredResult,
  type AIProviderCapabilities,
  type AIProviderNormalizedEvent,
  type AIProviderOutputContract,
  type AIProviderRequest,
  type AIProviderSafeError,
  type AIProviderTurnResult,
} from "../../shared/ai/provider-contracts";
import {
  evaluateF29Capability,
  type F29SandboxMode,
} from "../../shared/f29-security";

export interface AIProviderInvokeOptions {
  readonly signal?: AbortSignal;
  readonly onEvent?: (event: AIProviderNormalizedEvent) => void;
  readonly now?: () => string;
}

/** Nonsecret local presence only; this never proves remote service access. */
export interface AIProviderLocalReadiness {
  readonly runtimeAvailable: boolean;
  readonly authenticationAvailable: boolean;
}

/**
 * Provider-neutral invocation boundary. There are deliberately no Git,
 * GitHub, commit, push, publication, or conversation-resolution methods.
 */
export interface AIProvider {
  readonly id: string;
  readonly capabilities: AIProviderCapabilities;
  readonly readLocalReadiness?: () =>
    AIProviderLocalReadiness | Promise<AIProviderLocalReadiness>;
  invoke(
    request: AIProviderRequest,
    options?: AIProviderInvokeOptions,
  ): Promise<AIProviderTurnResult>;
}

export type AIProviderAdmission =
  | {
      readonly ok: true;
      readonly provider: AIProvider;
      readonly request: AIProviderRequest;
    }
  | {
      readonly ok: false;
      readonly error: AIProviderSafeError;
    };

export interface AIProviderRegistryOptions {
  readonly now?: () => string;
}

function nowIso(now: (() => string) | undefined): string {
  return now?.() ?? new Date().toISOString();
}

function safeId(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 && value.length <= 256
    ? value
    : fallback;
}

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback;
}

function safePolicyHash(value: unknown): string {
  if (typeof value !== "object" || value === null) return "unknown-policy";
  const hash = (value as { snapshotHash?: unknown }).snapshotHash;
  return safeId(hash, "unknown-policy");
}

function error(
  code: string,
  category: string,
  userAction: string,
  detail?: string,
  retryable = false,
): AIProviderSafeError {
  return {
    code,
    category,
    retryable,
    userAction,
    ...(detail === undefined ? {} : { detail: detail.slice(0, 1_024) }),
  };
}

function failureResult(
  request: unknown,
  safeError: AIProviderSafeError,
  completedAt: string,
): AIProviderTurnResult {
  const input =
    typeof request === "object" && request !== null
      ? (request as Record<string, unknown>)
      : {};
  const policy = input.executionPolicySnapshot;
  return {
    schemaVersion: 1,
    requestId: safeId(input.requestId, "invalid-request"),
    operationId: safeId(input.operationId, "invalid-operation"),
    turnId: safeId(input.turnId, "invalid-turn"),
    providerId: safeId(input.providerId, "unknown-provider"),
    modelId: safeId(input.modelId, "unknown-model"),
    taskType: safeId(input.taskType, "unknown-task"),
    profileRevision: safeNumber(
      typeof input.profileSnapshot === "object" &&
        input.profileSnapshot !== null
        ? (input.profileSnapshot as { profileRevision?: unknown })
            .profileRevision
        : undefined,
      0,
    ),
    executionPolicySnapshot: {
      schemaVersion: safeNumber(
        typeof policy === "object" && policy !== null
          ? (policy as { schemaVersion?: unknown }).schemaVersion
          : undefined,
        1,
      ),
      snapshotHash: safePolicyHash(policy),
    },
    startedAt: completedAt,
    completedAt,
    status: "failed",
    events: [],
    error: safeError,
  };
}

function isIncluded<T>(values: readonly T[], value: T): boolean {
  return values.includes(value);
}

function policyNetworkEnabled(request: AIProviderRequest): boolean {
  return (
    request.executionPolicySnapshot.networkAccess === "enabled" ||
    request.executionPolicySnapshot.networkAccessEnabled === true
  );
}

function capabilityError(detail: string): AIProviderAdmission {
  return {
    ok: false,
    error: error(
      "CAPABILITY_UNSUPPORTED",
      "CAPABILITY",
      "CONFIGURE_PROVIDER",
      detail,
    ),
  };
}

/** Deterministic capability and policy admission before a provider starts. */
export function admitAIProviderRequest(
  provider: AIProvider,
  request: unknown,
): AIProviderAdmission {
  const parsed = aiProviderRequestSchema.safeParse(request);
  if (!parsed.success) {
    return {
      ok: false,
      error: error(
        "INVALID_REQUEST",
        "REQUEST",
        "FIX_INPUT",
        "The provider request does not match the versioned F15 contract.",
      ),
    };
  }
  const normalized = parsed.data;
  try {
    assertAIProviderRequest(normalized);
  } catch (reason) {
    const detail =
      reason instanceof Error ? reason.message : "F15_REQUEST_INVALID";
    const policy = detail.includes("POLICY") || detail.includes("WORKTREE");
    return {
      ok: false,
      error: error(
        policy ? "POLICY_BOUNDARY_VIOLATION" : "INVALID_REQUEST",
        policy ? "POLICY" : "REQUEST",
        policy ? "REVIEW_POLICY" : "FIX_INPUT",
        detail,
      ),
    };
  }
  const capabilities = aiProviderCapabilitiesSchema.safeParse(
    provider.capabilities,
  );
  if (!capabilities.success || provider.id !== normalized.providerId) {
    return {
      ok: false,
      error: error(
        "PROVIDER_CONFIGURATION_INVALID",
        "CONFIGURATION",
        "CONFIGURE_PROVIDER",
        "The registered provider capability descriptor is invalid.",
      ),
    };
  }
  const descriptor = capabilities.data;
  if (!descriptor.enabled)
    return capabilityError("The selected provider is disabled.");
  if (!isIncluded(descriptor.taskTypes, normalized.taskType))
    return capabilityError("The provider does not support this task type.");
  const outputContract = aiProviderOutputContractSchema.safeParse(
    normalized.outputContract,
  );
  if (!outputContract.success)
    return capabilityError("The output contract is not registered.");
  if (
    !descriptor.outputContracts.some(
      (candidate) =>
        candidate.contractId === normalized.outputContract.contractId &&
        candidate.schemaVersion === normalized.outputContract.schemaVersion,
    )
  )
    return capabilityError(
      "The provider cannot produce the requested output contract.",
    );
  if (
    normalized.outputContract.dialect !== undefined &&
    !isIncluded(
      descriptor.structuredOutputDialects,
      normalized.outputContract.dialect,
    )
  )
    return capabilityError(
      "The provider does not support the requested output dialect.",
    );
  if (
    normalized.profileSnapshot.reasoningEffort !== undefined &&
    !isIncluded(
      descriptor.reasoningEfforts,
      normalized.profileSnapshot.reasoningEffort,
    )
  )
    return capabilityError(
      "The provider does not support the requested reasoning effort.",
    );
  if (
    normalized.interactionMode === "worktree_write" &&
    normalized.executionPolicySnapshot.sandboxMode !== "workspace-write"
  ) {
    return {
      ok: false,
      error: error(
        "POLICY_BOUNDARY_VIOLATION",
        "POLICY",
        "REVIEW_POLICY",
        "F15 cannot broaden a worktree turn beyond the operation-owned workspace.",
      ),
    };
  }
  const requestedSandbox =
    normalized.taskType === "AUTOMATIC_REVIEW_REEVALUATION" ||
    normalized.interactionMode === "read_only"
      ? "read-only"
      : normalized.executionPolicySnapshot.sandboxMode;
  if (!isIncluded(descriptor.sandboxModes, requestedSandbox))
    return capabilityError(
      "The provider cannot enforce the requested sandbox mode.",
    );
  if (
    normalized.executionPolicySnapshot.requiresInteractiveApproval === true ||
    normalized.executionPolicySnapshot.approvalPolicy !== "never"
  )
    return {
      ok: false,
      error: error(
        "POLICY_UNSUPPORTED",
        "POLICY",
        "REVIEW_POLICY",
        "The direct MVP adapter has no interactive approval callback.",
      ),
    };
  if (
    !isIncluded(
      descriptor.approvalPolicies,
      normalized.executionPolicySnapshot.approvalPolicy,
    )
  )
    return capabilityError("The provider cannot enforce the approval policy.");
  const networkMode = policyNetworkEnabled(normalized) ? "enabled" : "disabled";
  if (!isIncluded(descriptor.networkModes, networkMode))
    return capabilityError(
      "The provider cannot enforce the requested network mode.",
    );
  if (!descriptor.controlledEnvironment)
    return {
      ok: false,
      error: error(
        "POLICY_UNSUPPORTED",
        "POLICY",
        "REVIEW_POLICY",
        "The provider cannot run with an explicit controlled environment.",
      ),
    };
  const f29Admission = evaluateF29Capability({
    operationId: normalized.operationId,
    worktreeOperationId: normalized.worktree?.operationId,
    policy: {
      taskType: normalized.taskType,
      interactionMode: normalized.interactionMode,
      sandboxMode: requestedSandbox as F29SandboxMode,
      networkAccess: networkMode,
      approvalPolicy: normalized.executionPolicySnapshot.approvalPolicy,
      controlledEnvironment: descriptor.controlledEnvironment,
      ...(normalized.worktree?.access === "WORKTREE_WRITE"
        ? { writableRoot: normalized.worktree.canonicalPath }
        : {}),
      publicationAuthority: false,
      snapshotHash: normalized.executionPolicySnapshot.snapshotHash,
    },
    requestedWritableRoot: normalized.executionPolicySnapshot.writableRoot,
    requestedNetworkAccess: networkMode,
    requestedSandboxMode: requestedSandbox as F29SandboxMode,
    requestedApprovalPolicy: normalized.executionPolicySnapshot.approvalPolicy,
    requestedPublicationAuthority:
      normalized.worktree?.permittedCapabilities.publication,
    mutating: normalized.interactionMode === "worktree_write",
  });
  if (!f29Admission.ok)
    return {
      ok: false,
      error: error(
        f29Admission.error.code,
        "SECURITY",
        "REVIEW_POLICY",
        f29Admission.error.message,
      ),
    };
  if (normalized.conversationContinuation !== undefined) {
    if (!normalized.conversationContinuation.authorized)
      return {
        ok: false,
        error: error(
          "CONVERSATION_NOT_AUTHORIZED",
          "CONVERSATION",
          "EXPLICIT_CONTINUATION",
          "Conversation continuation must be explicitly authorized by the owning workflow.",
        ),
      };
    if (!descriptor.conversationContinuation)
      return capabilityError("The provider cannot resume conversations.");
    if (
      normalized.conversationContinuation.reference.providerId !==
      descriptor.providerId
    )
      return {
        ok: false,
        error: error(
          "CONVERSATION_PROVIDER_MISMATCH",
          "CONVERSATION",
          "SELECT_PROVIDER",
          "The conversation reference belongs to another provider.",
        ),
      };
  }
  const access = normalized.worktree?.access;
  if (access === "READ_ONLY" && descriptor.worktreeAccess === "none")
    return capabilityError(
      "The provider cannot inspect an operation worktree.",
    );
  if (
    access === "WORKTREE_WRITE" &&
    descriptor.worktreeAccess !== "worktree_write"
  )
    return capabilityError("The provider cannot write the operation worktree.");
  if (
    normalized.worktree !== undefined &&
    normalized.worktree.permittedCapabilities.publication
  )
    return {
      ok: false,
      error: error(
        "POLICY_BOUNDARY_VIOLATION",
        "AUTHORITY",
        "REVIEW_WORKTREE",
        "Publication capability is never accepted from an F13 handoff.",
      ),
    };
  return { ok: true, provider, request: normalized };
}

export class AIProviderRegistry {
  private readonly providers = new Map<string, AIProvider>();
  private readonly now: () => string;

  public constructor(options: AIProviderRegistryOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public register(provider: AIProvider): void {
    if (this.providers.has(provider.id))
      throw new TypeError("AI_PROVIDER_DUPLICATE");
    this.providers.set(provider.id, provider);
  }

  public resolve(providerId: string): AIProvider | undefined {
    return this.providers.get(providerId);
  }

  public list(): readonly AIProvider[] {
    return [...this.providers.values()];
  }

  public admit(request: unknown): AIProviderAdmission {
    if (typeof request !== "object" || request === null) {
      return {
        ok: false,
        error: error(
          "INVALID_REQUEST",
          "REQUEST",
          "FIX_INPUT",
          "The provider request must be a serialized object.",
        ),
      };
    }
    const providerId = (request as { providerId?: unknown }).providerId;
    if (typeof providerId !== "string") {
      return {
        ok: false,
        error: error(
          "INVALID_REQUEST",
          "REQUEST",
          "FIX_INPUT",
          "The provider request is missing a provider ID.",
        ),
      };
    }
    const provider = this.providers.get(providerId);
    if (provider === undefined) {
      return {
        ok: false,
        error: error(
          "PROVIDER_UNKNOWN",
          "CONFIGURATION",
          "CONFIGURE_PROVIDER",
          "No registered provider matches the requested provider ID.",
        ),
      };
    }
    return admitAIProviderRequest(provider, request);
  }

  public async invoke(
    request: unknown,
    options: AIProviderInvokeOptions = {},
  ): Promise<AIProviderTurnResult> {
    const admitted = this.admit(request);
    const completedAt = nowIso(options.now ?? this.now);
    if (!admitted.ok)
      return failureResult(request, admitted.error, completedAt);
    if (options.signal?.aborted) {
      return failureResult(
        admitted.request,
        error(
          "CANCELLED",
          "CANCELLATION",
          "RETRY_EXPLICITLY",
          "The turn was cancelled before the provider started.",
        ),
        completedAt,
      );
    }
    try {
      const result = await admitted.provider.invoke(admitted.request, options);
      assertAIProviderTurnResult(result);
      if (!aiProviderTurnResultSchema.safeParse(result).success) {
        return failureResult(
          admitted.request,
          error(
            "PROVIDER_RESULT_INVALID",
            "PROVIDER",
            "RECONCILE",
            "The provider returned a result outside the normalized F15 contract.",
          ),
          nowIso(options.now ?? this.now),
        );
      }
      if (
        result.requestId !== admitted.request.requestId ||
        result.operationId !== admitted.request.operationId ||
        result.turnId !== admitted.request.turnId ||
        result.providerId !== admitted.request.providerId
      ) {
        return failureResult(
          admitted.request,
          error(
            "PROVIDER_RESULT_MISMATCH",
            "PROVIDER",
            "RECONCILE",
            "The provider returned a result for a different turn identity.",
          ),
          nowIso(options.now ?? this.now),
        );
      }
      if (result.status === "completed") {
        const structured = parseAIProviderStructuredResult(
          admitted.request.outputContract,
          result.structuredResult,
          admitted.request.outputContract.contractId === "REVIEW_IMPLEMENTATION"
            ? (admitted.request.input.humanDecisions ?? []).map(
                (decision) => decision.remoteEventVersionId,
              )
            : admitted.request.input.remoteEventVersionIds,
        );
        if (!structured.success) {
          return failureResult(
            admitted.request,
            error(
              structured.code,
              "STRUCTURED_OUTPUT",
              "REVIEW_PROVIDER_OUTPUT",
              structured.detail,
            ),
            nowIso(options.now ?? this.now),
          );
        }
      }
      return result;
    } catch {
      return failureResult(
        admitted.request,
        error(
          "PROVIDER_FAILURE",
          "PROVIDER",
          "RETRY_EXPLICITLY",
          "The provider failed before a normalized result was returned.",
          true,
        ),
        nowIso(options.now ?? this.now),
      );
    }
  }
}

export function defaultOutputContractForRequest(
  request: Pick<AIProviderRequest, "taskType">,
): AIProviderOutputContract {
  return outputContractForTask(request.taskType);
}
