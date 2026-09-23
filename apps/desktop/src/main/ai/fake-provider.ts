import {
  aiProviderCapabilitiesSchema,
  assertAIProviderTurnResult,
  parseAIProviderStructuredResult,
  type AIProviderCapabilities,
  type AIProviderNormalizedEvent,
  type AIProviderRequest,
  type AIProviderSafeError,
  type AIProviderTurnResult,
  type AIProviderTurnStatus,
  type AIProviderUsage,
  type AIJsonValue,
} from "../../shared/ai/provider-contracts";
import type { AIProvider, AIProviderInvokeOptions } from "./registry";

export interface FakeAIProviderScript {
  readonly status?: AIProviderTurnStatus;
  readonly structuredResult?: unknown;
  readonly events?: readonly AIProviderNormalizedEvent[];
  readonly usage?: AIProviderUsage;
  readonly conversationReference?: AIProviderTurnResult["conversationReference"];
  readonly error?: AIProviderSafeError;
  readonly delayMs?: number;
}

export type FakeAIProviderHandler = (
  request: AIProviderRequest,
  options: AIProviderInvokeOptions,
) => FakeAIProviderScript | Promise<FakeAIProviderScript>;

export interface FakeAIProviderOptions {
  readonly id?: string;
  readonly capabilities?: AIProviderCapabilities;
  readonly handler?: FakeAIProviderHandler;
  readonly now?: () => string;
}

export const defaultFakeAIProviderCapabilities: AIProviderCapabilities = {
  schemaVersion: 1,
  providerId: "fake",
  enabled: true,
  taskTypes: [
    "AUTOMATIC_REVIEW_REEVALUATION",
    "REVIEW_REVISION",
    "READ_ONLY_CONVERSATION",
    "MERGE_CONFLICT_RESOLUTION",
  ],
  outputContracts: [
    { contractId: "REVIEW_PROPOSAL", schemaVersion: 1 },
    { contractId: "REVIEW_IMPLEMENTATION", schemaVersion: 1 },
    { contractId: "READ_ONLY_CONVERSATION", schemaVersion: 1 },
    { contractId: "CONFLICT_RESOLUTION", schemaVersion: 1 },
  ],
  structuredOutputDialects: ["openai_json_schema"],
  streaming: true,
  conversationContinuation: true,
  reasoningEfforts: ["minimal", "low", "medium", "high", "xhigh", "max"],
  sandboxModes: ["read-only", "workspace-write"],
  approvalPolicies: ["never"],
  networkModes: ["disabled", "enabled"],
  worktreeAccess: "worktree_write",
  controlledEnvironment: true,
};

function defaultNow(): string {
  return new Date().toISOString();
}

function event(
  request: AIProviderRequest,
  sequence: number,
  kind: AIProviderNormalizedEvent["kind"],
  occurredAt: string,
  details?: AIJsonValue,
): AIProviderNormalizedEvent {
  return {
    schemaVersion: 1,
    sequence,
    occurredAt,
    providerId: request.providerId,
    turnId: request.turnId,
    kind,
    ...(details === undefined ? {} : { details }),
  };
}

function defaultStructuredResult(request: AIProviderRequest): unknown {
  const eventIds = request.input.remoteEventVersionIds;
  switch (request.outputContract.contractId) {
    case "REVIEW_PROPOSAL":
      return {
        schemaVersion: 1,
        summary: "The deterministic fake provider produced a review proposal.",
        items: eventIds.map((remoteEventVersionId) => ({
          remoteEventVersionId,
          assessment: "not_actionable",
          disposition: "no_change",
          explanation: "No change was requested by the fixture.",
          relatedFiles: [],
        })),
      };
    case "REVIEW_IMPLEMENTATION":
      return {
        schemaVersion: 1,
        summary:
          "The deterministic fake provider produced an implementation report.",
        problems: [],
        remainingIssues: [],
        outcomes: (request.input.humanDecisions ?? []).map((decision) => ({
          remoteEventVersionId: decision.remoteEventVersionId,
          decision: decision.disposition,
          outcome: "skipped",
          report: "No mutation was performed by this fixture.",
          relatedFiles: [],
        })),
      };
    case "READ_ONLY_CONVERSATION":
      return {
        schemaVersion: 1,
        interaction: "read_only",
        answer:
          "The deterministic fake provider has no additional information.",
      };
    case "CONFLICT_RESOLUTION":
      return {
        schemaVersion: 1,
        status: "blocked",
        summary: "The deterministic fixture left the conflict for review.",
        remainingIssues: ["The fake provider does not resolve conflicts."],
        userQuestion:
          "Please inspect the competing intents and choose a resolution.",
      };
  }
}

function normalizeScriptEvents(
  request: AIProviderRequest,
  script: FakeAIProviderScript,
  now: string,
): AIProviderNormalizedEvent[] {
  const provided = script.events ?? [];
  const events: AIProviderNormalizedEvent[] = [];
  const append = (
    kind: AIProviderNormalizedEvent["kind"],
    details?: AIJsonValue,
  ): void => {
    events.push(event(request, events.length, kind, now, details));
  };
  if (provided.length === 0) append("turn_started");
  for (const item of provided) {
    append(item.kind as AIProviderNormalizedEvent["kind"], item.details);
  }
  return events;
}

function safeFailure(
  request: AIProviderRequest,
  status: AIProviderTurnStatus,
  now: string,
  events: AIProviderNormalizedEvent[],
  safeError?: AIProviderSafeError,
): AIProviderTurnResult {
  const terminalKind =
    status === "cancelled" || status === "timed_out" ? "cancelled" : "failure";
  events.push(event(request, events.length, terminalKind, now));
  const normalizedError =
    safeError ??
    ({
      code:
        status === "timed_out"
          ? "TIMEOUT"
          : status === "cancelled"
            ? "CANCELLED"
            : "FAKE_PROVIDER_FAILURE",
      category:
        status === "timed_out" || status === "cancelled"
          ? "CANCELLATION"
          : "PROVIDER",
      retryable: status === "failed" || status === "interrupted",
      userAction: status === "interrupted" ? "RECONCILE" : "RETRY_EXPLICITLY",
      detail: "The fake provider did not complete the turn successfully.",
    } satisfies AIProviderSafeError);
  return {
    schemaVersion: 1,
    requestId: request.requestId,
    operationId: request.operationId,
    turnId: request.turnId,
    providerId: request.providerId,
    modelId: request.modelId,
    taskType: request.taskType,
    profileRevision: request.profileSnapshot.profileRevision,
    executionPolicySnapshot: {
      schemaVersion: request.executionPolicySnapshot.schemaVersion,
      snapshotHash: request.executionPolicySnapshot.snapshotHash,
    },
    startedAt: now,
    completedAt: now,
    status,
    interactionMode: request.interactionMode,
    ...(request.profileSnapshot.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: request.profileSnapshot.reasoningEffort }),
    outputContract: request.outputContract,
    events,
    error: normalizedError,
  };
}

export class FakeAIProvider implements AIProvider {
  public readonly id: string;
  public readonly capabilities: AIProviderCapabilities;
  public readonly startedRequests: AIProviderRequest[] = [];
  private readonly handler?: FakeAIProviderHandler;
  private readonly now: () => string;

  public constructor(options: FakeAIProviderOptions = {}) {
    this.id = options.id ?? "fake";
    const capabilities = options.capabilities ?? {
      ...defaultFakeAIProviderCapabilities,
      providerId: this.id,
    };
    const parsed = aiProviderCapabilitiesSchema.safeParse({
      ...capabilities,
      providerId: this.id,
    });
    if (!parsed.success) throw new TypeError("F15_FAKE_CAPABILITIES_INVALID");
    this.capabilities = parsed.data;
    this.handler = options.handler;
    this.now = options.now ?? defaultNow;
  }

  public async invoke(
    request: AIProviderRequest,
    options: AIProviderInvokeOptions = {},
  ): Promise<AIProviderTurnResult> {
    this.startedRequests.push(request);
    const startedAt = this.now();
    const emit = (result: AIProviderTurnResult): AIProviderTurnResult => {
      for (const normalized of result.events) options.onEvent?.(normalized);
      return result;
    };
    if (options.signal?.aborted) {
      return emit(
        safeFailure(request, "cancelled", startedAt, [], {
          code: "CANCELLED",
          category: "CANCELLATION",
          retryable: false,
          userAction: "RETRY_EXPLICITLY",
          detail: "The fake provider received an already-aborted turn.",
        }),
      );
    }
    const script = (await this.handler?.(request, options)) ?? {
      structuredResult: defaultStructuredResult(request),
    };
    if (script.delayMs !== undefined && script.delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, script.delayMs));
    }
    if (options.signal?.aborted) {
      const status = String(options.signal.reason ?? "").includes("TIMEOUT")
        ? "timed_out"
        : "cancelled";
      return emit(
        safeFailure(request, status, this.now(), [], {
          code: status === "timed_out" ? "TIMEOUT" : "CANCELLED",
          category: "CANCELLATION",
          retryable: false,
          userAction: "RETRY_EXPLICITLY",
          detail: "The fake provider turn was stopped by the caller.",
        }),
      );
    }
    const status = script.status ?? "completed";
    const events = normalizeScriptEvents(request, script, startedAt);
    if (status !== "completed") {
      return emit(
        safeFailure(request, status, this.now(), events, script.error),
      );
    }
    const parsed = parseAIProviderStructuredResult(
      request.outputContract,
      script.structuredResult ?? defaultStructuredResult(request),
      request.outputContract.contractId === "REVIEW_IMPLEMENTATION"
        ? (request.input.humanDecisions ?? []).map(
            (decision) => decision.remoteEventVersionId,
          )
        : request.input.remoteEventVersionIds,
    );
    if (!parsed.success) {
      return emit(
        safeFailure(request, "failed", this.now(), events, {
          code: parsed.code,
          category: "STRUCTURED_OUTPUT",
          retryable: false,
          userAction: "REVIEW_PROVIDER_OUTPUT",
          detail: parsed.detail,
        }),
      );
    }
    events.push(
      event(request, events.length, "turn_completed", this.now(), {
        structured: true,
      }),
    );
    const result: AIProviderTurnResult = {
      schemaVersion: 1,
      requestId: request.requestId,
      operationId: request.operationId,
      turnId: request.turnId,
      providerId: request.providerId,
      modelId: request.modelId,
      taskType: request.taskType,
      profileRevision: request.profileSnapshot.profileRevision,
      executionPolicySnapshot: {
        schemaVersion: request.executionPolicySnapshot.schemaVersion,
        snapshotHash: request.executionPolicySnapshot.snapshotHash,
      },
      startedAt,
      completedAt: this.now(),
      status: "completed",
      interactionMode: request.interactionMode,
      ...(request.profileSnapshot.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: request.profileSnapshot.reasoningEffort }),
      outputContract: request.outputContract,
      profileSnapshot: request.profileSnapshot,
      structuredResult: parsed.data as unknown as AIJsonValue,
      events,
      ...(script.usage === undefined ? {} : { usage: script.usage }),
      ...(script.conversationReference === undefined
        ? {}
        : { conversationReference: script.conversationReference }),
    };
    assertAIProviderTurnResult(result);
    return emit(result);
  }
}
