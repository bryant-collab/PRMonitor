import {
  Codex,
  type CodexOptions,
  type ModelReasoningEffort,
  type ThreadOptions,
} from "@openai/codex-sdk";
import {
  assertAIProviderRequest,
  assertAIProviderTurnResult,
  generateAIProviderJsonSchema,
  parseAIProviderStructuredResult,
  type AIJsonValue,
  type AIProviderCapabilities,
  type AIProviderNormalizedEvent,
  type AIProviderRequest,
  type AIProviderSafeError,
  type AIProviderTurnResult,
  type AIProviderUsage,
} from "../../shared/ai/provider-contracts";
import { redactF29Text } from "../../shared/f29-security";
import type { AIProvider, AIProviderInvokeOptions } from "./registry";

export interface CodexThreadOptions {
  readonly model: string;
  readonly modelReasoningEffort?: ModelReasoningEffort;
  readonly sandboxMode: "read-only" | "workspace-write";
  readonly workingDirectory?: string;
  readonly networkAccessEnabled: boolean;
  readonly approvalPolicy: "never";
}

export interface CodexThreadPort {
  readonly id: string | null;
  runStreamed(
    input: string,
    options: { readonly outputSchema: unknown; readonly signal?: AbortSignal },
  ): Promise<{ readonly events: AsyncIterable<unknown> }>;
}

export interface CodexClientPort {
  startThread(options: CodexThreadOptions): CodexThreadPort;
  resumeThread(id: string, options: CodexThreadOptions): CodexThreadPort;
}

export interface CodexRuntimePort {
  readonly createClient: (options: {
    readonly env: Record<string, string>;
  }) => CodexClientPort;
  readonly authenticationEnvironment?: Readonly<Record<string, string>>;
}

export interface CodexAdapterOptions {
  readonly runtime?: CodexRuntimePort;
  readonly now?: () => string;
  readonly baseEnvironment?: Readonly<Record<string, string>>;
  readonly providerAuthenticationEnvironment?: Readonly<Record<string, string>>;
}

const CODEX_REASONING_EFFORTS: ModelReasoningEffort[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
  "persistent",
];

const CODEX_CAPABILITIES: AIProviderCapabilities = {
  schemaVersion: 1,
  providerId: "codex",
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
  reasoningEfforts: CODEX_REASONING_EFFORTS,
  sandboxModes: ["read-only", "workspace-write"],
  approvalPolicies: ["never"],
  networkModes: ["disabled", "enabled"],
  worktreeAccess: "worktree_write",
  controlledEnvironment: true,
  modelCatalog: [
    {
      modelId: "gpt-5-codex",
      taskTypes: [
        "AUTOMATIC_REVIEW_REEVALUATION",
        "REVIEW_REVISION",
        "READ_ONLY_CONVERSATION",
        "MERGE_CONFLICT_RESOLUTION",
      ],
      reasoningEfforts: CODEX_REASONING_EFFORTS,
    },
  ],
  providerOptionBounds: {
    schemaVersion: 1,
    boundsRevision: "f15-options-v1",
    maxBytes: 16 * 1024,
    maxObjectDepth: 8,
    maxObjectKeys: 64,
    maxArrayItems: 128,
  },
};

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultRuntime(): CodexRuntimePort {
  const authenticationEnvironment: Record<string, string> = {};
  for (const key of ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_ORG_ID"]) {
    const value = process.env[key];
    if (value !== undefined && value.length > 0)
      authenticationEnvironment[key] = value;
  }
  return {
    authenticationEnvironment,
    createClient: (options) => {
      const client = new Codex(options as CodexOptions);
      return {
        startThread: (threadOptions) => {
          const thread = client.startThread(threadOptions as ThreadOptions);
          return {
            get id() {
              return thread.id;
            },
            runStreamed: (input, runOptions) =>
              thread.runStreamed(input, runOptions),
          };
        },
        resumeThread: (id, threadOptions) => {
          const thread = client.resumeThread(
            id,
            threadOptions as ThreadOptions,
          );
          return {
            get id() {
              return thread.id;
            },
            runStreamed: (input, runOptions) =>
              thread.runStreamed(input, runOptions),
          };
        },
      };
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function bounded(value: string, maximum = 1_024): string {
  return value.length > maximum ? `${value.slice(0, maximum)}…` : value;
}

function redact(value: string): string {
  const redacted = redactF29Text(value, {
    replacement: "<redacted>",
    maximumBytes: 8_192,
  });
  return bounded(redacted.ok ? redacted.text : "<redacted>");
}

function safeEnvironment(
  base: Readonly<Record<string, string>>,
  authentication: Readonly<Record<string, string>>,
  allowedKeys: readonly string[],
): Record<string, string> {
  const allowed = new Set(allowedKeys);
  const result: Record<string, string> = {};
  const entries = [...Object.entries(base), ...Object.entries(authentication)];
  for (const [key, value] of entries) {
    if (allowed.size > 0 && !allowed.has(key)) continue;
    if (/GITHUB/iu.test(key)) continue;
    const providerAuthentication =
      key === "OPENAI_API_KEY" ||
      key === "OPENAI_BASE_URL" ||
      key === "OPENAI_ORG_ID" ||
      key.startsWith("CODEX_");
    const runtimeSupport = new Set([
      "PATH",
      "Path",
      "SystemRoot",
      "TEMP",
      "TMP",
    ]);
    if (!providerAuthentication && !runtimeSupport.has(key)) continue;
    if (
      !providerAuthentication &&
      /(?:GITHUB|TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL)/iu.test(key)
    )
      continue;
    if (value.length === 0 || value.length > 8_192) continue;
    result[key] = value;
  }
  return result;
}

function defaultBaseEnvironment(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ["PATH", "Path", "SystemRoot", "TEMP", "TMP"]) {
    const value = process.env[key];
    if (value !== undefined && value.length > 0) result[key] = value;
  }
  return result;
}

function usageFrom(value: unknown): AIProviderUsage | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const number = (candidate: unknown): number | undefined =>
    typeof candidate === "number" &&
    Number.isSafeInteger(candidate) &&
    candidate >= 0
      ? candidate
      : undefined;
  const usage: AIProviderUsage = {
    ...(number(record.input_tokens) === undefined
      ? {}
      : { inputTokens: number(record.input_tokens) }),
    ...(number(record.cached_input_tokens) === undefined
      ? {}
      : { cachedInputTokens: number(record.cached_input_tokens) }),
    ...(number(record.cache_write_input_tokens) === undefined
      ? {}
      : { cacheWriteInputTokens: number(record.cache_write_input_tokens) }),
    ...(number(record.output_tokens) === undefined
      ? {}
      : { outputTokens: number(record.output_tokens) }),
    ...(number(record.reasoning_output_tokens) === undefined
      ? {}
      : { reasoningOutputTokens: number(record.reasoning_output_tokens) }),
    ...(number(record.total_tokens) === undefined
      ? {}
      : { totalTokens: number(record.total_tokens) }),
  };
  return Object.keys(usage).length === 0 ? undefined : usage;
}

function safeEventPath(
  value: unknown,
  worktreePath: string | undefined,
): string | undefined {
  const raw = asString(value);
  if (raw === undefined) return undefined;
  if (!/^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(raw)) {
    if (raw.split(/[\\/]/u).includes("..")) return "<outside-worktree>";
    return raw.slice(0, 4_096);
  }
  if (worktreePath === undefined) return "<outside-worktree>";
  const normalize = (path: string): string =>
    path
      .replace(/[\\/]+/gu, "\\")
      .replace(/\\$/u, "")
      .toLowerCase();
  const root = normalize(worktreePath);
  const candidate = normalize(raw);
  if (candidate === root) return ".";
  if (!candidate.startsWith(`${root}\\`)) return "<outside-worktree>";
  return raw
    .slice(worktreePath.length)
    .replace(/^[\\/]+/u, "")
    .slice(0, 4_096);
}

function itemDetails(
  item: unknown,
  worktreePath: string | undefined,
): {
  readonly kind: AIProviderNormalizedEvent["kind"];
  readonly details?: AIJsonValue;
} {
  const record = asRecord(item);
  if (record === undefined) return { kind: "item_activity" };
  const type = asString(record.type);
  if (type === "command_execution") {
    return {
      kind: "command",
      details: {
        type,
        ...(asString(record.status) === undefined
          ? {}
          : { status: asString(record.status) }),
        ...(typeof record.exit_code === "number"
          ? { exitCode: record.exit_code }
          : {}),
        ...(asString(record.command) === undefined
          ? {}
          : { command: redact(asString(record.command) ?? "") }),
      },
    };
  }
  if (type === "file_change") {
    const changes = Array.isArray(record.changes) ? record.changes : [];
    return {
      kind: "file_change",
      details: {
        type,
        paths: changes
          .slice(0, 128)
          .map(
            (change) =>
              safeEventPath(asRecord(change)?.path, worktreePath) ??
              "<unknown>",
          ),
        count: changes.length,
      },
    };
  }
  if (type === "agent_message" || type === "reasoning") {
    return {
      kind: "progress",
      details: {
        type,
        ...(asString(record.text) === undefined
          ? {}
          : { text: redact(asString(record.text) ?? "") }),
      },
    };
  }
  if (type === "mcp_tool_call") {
    return {
      kind: "item_activity",
      details: { type, status: asString(record.status) ?? "unknown" },
    };
  }
  if (type === "todo_list") return { kind: "progress", details: { type } };
  return { kind: "item_activity", details: { type: type ?? "unknown" } };
}

function safeError(
  code: string,
  category: string,
  userAction: string,
  detail: string,
  retryable = false,
): AIProviderSafeError {
  return {
    code,
    category,
    retryable,
    userAction,
    ...(detail.length === 0 ? {} : { detail: redact(detail) }),
  };
}

function statusForAbort(
  signal: AbortSignal | undefined,
): "cancelled" | "timed_out" {
  return String(signal?.reason ?? "")
    .toUpperCase()
    .includes("TIMEOUT")
    ? "timed_out"
    : "cancelled";
}

function promptFor(request: AIProviderRequest): string {
  const instructions =
    request.taskType === "MERGE_CONFLICT_RESOLUTION"
      ? [
          "Resolve only the recorded merge-conflict paths in the operation-owned synchronization worktree.",
          "Preserve compatible intent from both source and destination; do not blindly choose ours or theirs.",
          "Do not commit, push, publish, or modify unrelated paths.",
          "Report ambiguity instead of guessing, and leave the worktree reviewable when intent is unclear.",
        ]
      : [];
  const payload = {
    taskType: request.taskType,
    interactionMode: request.interactionMode,
    modelId: request.modelId,
    outputContract: request.outputContract,
    input: request.input,
    profile: {
      profileId: request.profileSnapshot.profileId,
      profileRevision: request.profileSnapshot.profileRevision,
      commonInstructions: request.profileSnapshot.commonInstructions,
      repositoryInstructions: request.profileSnapshot.repositoryInstructions,
      buildAndValidationInstructions:
        request.profileSnapshot.buildAndValidationInstructions,
    },
    instructions,
    worktreeEvidence: request.worktree?.actualState,
  };
  return [
    "PRMonitor provider task. Treat all supplied snapshots as immutable context.",
    "Return only the registered structured output; do not commit, push, publish, or post responses.",
    JSON.stringify(payload),
  ].join("\n");
}

function resultBase(
  request: AIProviderRequest,
  startedAt: string,
  completedAt: string,
  status: AIProviderTurnResult["status"],
  events: AIProviderNormalizedEvent[],
  structuredResult?: AIJsonValue,
  usage?: AIProviderUsage,
  conversationReference?: AIProviderTurnResult["conversationReference"],
  errorValue?: AIProviderSafeError,
): AIProviderTurnResult {
  const normalizedConversationReference =
    conversationReference === undefined
      ? undefined
      : {
          ...conversationReference,
          taskType: request.taskType,
          policySnapshotHash: request.executionPolicySnapshot.snapshotHash,
          profileRevision: request.profileSnapshot.profileRevision,
        };
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
    startedAt,
    completedAt,
    status,
    interactionMode: request.interactionMode,
    ...(request.profileSnapshot.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: request.profileSnapshot.reasoningEffort }),
    outputContract: request.outputContract,
    ...(structuredResult === undefined ? {} : { structuredResult }),
    events,
    ...(usage === undefined ? {} : { usage }),
    ...(normalizedConversationReference === undefined
      ? {}
      : { conversationReference: normalizedConversationReference }),
    ...(errorValue === undefined ? {} : { error: errorValue }),
  };
}

export class CodexAIProvider implements AIProvider {
  public readonly id = "codex";
  public readonly capabilities = CODEX_CAPABILITIES;
  private readonly runtime: CodexRuntimePort;
  private readonly now: () => string;
  private readonly baseEnvironment?: Readonly<Record<string, string>>;
  private readonly providerAuthenticationEnvironment?: Readonly<
    Record<string, string>
  >;

  public constructor(options: CodexAdapterOptions = {}) {
    this.runtime = options.runtime ?? defaultRuntime();
    this.now = options.now ?? defaultNow;
    this.baseEnvironment = options.baseEnvironment;
    this.providerAuthenticationEnvironment =
      options.providerAuthenticationEnvironment;
  }

  public async invoke(
    request: AIProviderRequest,
    options: AIProviderInvokeOptions = {},
  ): Promise<AIProviderTurnResult> {
    const startedAt = this.now();
    try {
      assertAIProviderRequest(request);
    } catch (reason) {
      return resultBase(
        request,
        startedAt,
        this.now(),
        "failed",
        [],
        undefined,
        undefined,
        undefined,
        safeError(
          "INVALID_REQUEST",
          "REQUEST",
          "FIX_INPUT",
          reason instanceof Error
            ? reason.message
            : "The provider request is invalid.",
        ),
      );
    }
    if (options.signal?.aborted) {
      return resultBase(
        request,
        startedAt,
        this.now(),
        statusForAbort(options.signal),
        [],
        undefined,
        undefined,
        undefined,
        safeError(
          statusForAbort(options.signal) === "timed_out"
            ? "TIMEOUT"
            : "CANCELLED",
          "CANCELLATION",
          "RETRY_EXPLICITLY",
          "The Codex turn was stopped before the provider started.",
        ),
      );
    }
    const policy = request.executionPolicySnapshot;
    if (
      policy.requiresInteractiveApproval === true ||
      policy.approvalPolicy !== "never" ||
      (request.interactionMode === "worktree_write" &&
        policy.sandboxMode !== "workspace-write")
    ) {
      return resultBase(
        request,
        startedAt,
        this.now(),
        "failed",
        [],
        undefined,
        undefined,
        undefined,
        safeError(
          "POLICY_UNSUPPORTED",
          "POLICY",
          "REVIEW_POLICY",
          "The direct Codex adapter cannot provide the requested approval or sandbox boundary.",
        ),
      );
    }
    if (request.worktree?.permittedCapabilities.publication) {
      return resultBase(
        request,
        startedAt,
        this.now(),
        "failed",
        [],
        undefined,
        undefined,
        undefined,
        safeError(
          "POLICY_BOUNDARY_VIOLATION",
          "AUTHORITY",
          "REVIEW_WORKTREE",
          "Publication capability is never passed to Codex.",
        ),
      );
    }
    const networkAccessEnabled =
      policy.networkAccess === "enabled" ||
      policy.networkAccessEnabled === true;
    const sandboxMode =
      request.taskType === "AUTOMATIC_REVIEW_REEVALUATION" ||
      request.interactionMode === "read_only"
        ? "read-only"
        : "workspace-write";
    const threadOptions: CodexThreadOptions = {
      model: request.modelId,
      ...(request.profileSnapshot.reasoningEffort === undefined
        ? {}
        : { modelReasoningEffort: request.profileSnapshot.reasoningEffort }),
      sandboxMode,
      ...(request.worktree === undefined
        ? {}
        : { workingDirectory: request.worktree.canonicalPath }),
      networkAccessEnabled,
      approvalPolicy: "never",
    };
    const environment = safeEnvironment(
      this.baseEnvironment ?? defaultBaseEnvironment(),
      this.providerAuthenticationEnvironment ??
        this.runtime.authenticationEnvironment ??
        {},
      policy.controlledEnvironment.allowedKeys,
    );
    let thread: CodexThreadPort;
    try {
      const client = this.runtime.createClient({ env: environment });
      thread =
        request.conversationContinuation?.authorized === true
          ? client.resumeThread(
              request.conversationContinuation.reference.opaqueReference,
              threadOptions,
            )
          : client.startThread(threadOptions);
    } catch (reason) {
      return resultBase(
        request,
        startedAt,
        this.now(),
        "failed",
        [],
        undefined,
        undefined,
        undefined,
        safeError(
          "PROVIDER_START_FAILURE",
          "PROCESS",
          "RETRY_EXPLICITLY",
          reason instanceof Error ? reason.message : "Codex could not start.",
          true,
        ),
      );
    }

    const events: AIProviderNormalizedEvent[] = [];
    let usage: AIProviderUsage | undefined;
    let finalValue: unknown;
    let providerFailure: AIProviderSafeError | undefined;
    let turnCompleted = false;
    let threadReference = asString(thread.id);
    const append = (
      kind: AIProviderNormalizedEvent["kind"],
      details?: AIJsonValue,
    ): void => {
      const normalized: AIProviderNormalizedEvent = {
        schemaVersion: 1,
        sequence: events.length,
        occurredAt: this.now(),
        providerId: request.providerId,
        turnId: request.turnId,
        kind,
        ...(details === undefined ? {} : { details }),
      };
      events.push(normalized);
      options.onEvent?.(normalized);
    };

    try {
      const streamed = await thread.runStreamed(promptFor(request), {
        outputSchema: generateAIProviderJsonSchema(request.outputContract),
        signal: options.signal,
      });
      for await (const rawEvent of streamed.events) {
        const record = asRecord(rawEvent);
        if (record === undefined) {
          providerFailure = safeError(
            "MALFORMED_PROVIDER_EVENT",
            "PROVIDER",
            "RETRY_EXPLICITLY",
            "Codex emitted a non-object event.",
          );
          append("failure", { code: providerFailure.code });
          break;
        }
        const type = asString(record.type);
        if (type === "thread.started") {
          threadReference = asString(record.thread_id) ?? threadReference;
          append("thread_started", {
            ...(threadReference === undefined
              ? {}
              : { threadId: threadReference }),
          });
        } else if (type === "turn.started") {
          append("turn_started");
        } else if (type === "turn.completed") {
          turnCompleted = true;
          usage = usageFrom(record.usage);
          append("usage", {
            ...(usage === undefined
              ? { available: false }
              : { available: true }),
          });
          append("turn_completed");
        } else if (type === "turn.failed") {
          const providerError = asRecord(record.error);
          providerFailure = safeError(
            "PROVIDER_TURN_FAILED",
            "SERVICE",
            "RETRY_EXPLICITLY",
            asString(providerError?.message) ?? "Codex reported a failed turn.",
            true,
          );
          append("failure", { code: providerFailure.code });
        } else if (type === "error") {
          providerFailure = safeError(
            "PROVIDER_STREAM_FAILURE",
            "PROCESS",
            "RETRY_EXPLICITLY",
            asString(record.message) ?? "Codex emitted a stream error.",
            true,
          );
          append("failure", { code: providerFailure.code });
        } else if (
          type === "item.started" ||
          type === "item.updated" ||
          type === "item.completed"
        ) {
          const item = record.item;
          const itemRecord = asRecord(item);
          if (itemRecord?.type === "agent_message") {
            const text = asString(itemRecord.text);
            if (text !== undefined) {
              try {
                finalValue = JSON.parse(text) as unknown;
              } catch {
                finalValue = text;
              }
            }
          }
          const mapped = itemDetails(item, request.worktree?.canonicalPath);
          append(mapped.kind, mapped.details);
        }
      }
    } catch (reason) {
      if (options.signal?.aborted) {
        const status = statusForAbort(options.signal);
        append("cancelled", { status });
        return resultBase(
          request,
          startedAt,
          this.now(),
          status,
          events,
          undefined,
          usage,
          threadReference === undefined
            ? undefined
            : {
                schemaVersion: 1,
                providerId: request.providerId,
                opaqueReference: threadReference,
                resumable: false,
              },
          safeError(
            status === "timed_out" ? "TIMEOUT" : "CANCELLED",
            "CANCELLATION",
            "RETRY_EXPLICITLY",
            "The Codex turn was stopped by the owning workflow.",
          ),
        );
      }
      providerFailure = safeError(
        "PROVIDER_STREAM_FAILURE",
        "PROCESS",
        "RETRY_EXPLICITLY",
        reason instanceof Error
          ? reason.message
          : "Codex did not complete the stream.",
        true,
      );
      append("failure", { code: providerFailure.code });
    }
    if (options.signal?.aborted) {
      const status = statusForAbort(options.signal);
      append("cancelled", { status });
      return resultBase(
        request,
        startedAt,
        this.now(),
        status,
        events,
        undefined,
        usage,
        threadReference === undefined
          ? undefined
          : {
              schemaVersion: 1,
              providerId: request.providerId,
              opaqueReference: threadReference,
              resumable: false,
            },
        safeError(
          status === "timed_out" ? "TIMEOUT" : "CANCELLED",
          "CANCELLATION",
          "RETRY_EXPLICITLY",
          "The Codex turn was stopped by the owning workflow.",
        ),
      );
    }
    if (providerFailure !== undefined) {
      return resultBase(
        request,
        startedAt,
        this.now(),
        "failed",
        events,
        undefined,
        usage,
        threadReference === undefined
          ? undefined
          : {
              schemaVersion: 1,
              providerId: request.providerId,
              opaqueReference: threadReference,
              resumable: false,
            },
        providerFailure,
      );
    }
    if (!turnCompleted) {
      append("failure", { code: "PROVIDER_TURN_INCOMPLETE" });
      return resultBase(
        request,
        startedAt,
        this.now(),
        "interrupted",
        events,
        undefined,
        usage,
        threadReference === undefined
          ? undefined
          : {
              schemaVersion: 1,
              providerId: request.providerId,
              opaqueReference: threadReference,
              resumable: false,
            },
        safeError(
          "PROVIDER_TURN_INCOMPLETE",
          "PROCESS",
          "RECONCILE",
          "Codex ended without a terminal turn.completed event.",
          true,
        ),
      );
    }
    const parsed = parseAIProviderStructuredResult(
      request.outputContract,
      finalValue,
      request.outputContract.contractId === "REVIEW_IMPLEMENTATION"
        ? (request.input.humanDecisions ?? []).map(
            (decision) => decision.remoteEventVersionId,
          )
        : request.input.remoteEventVersionIds,
    );
    if (!parsed.success) {
      append("failure", { code: parsed.code });
      return resultBase(
        request,
        startedAt,
        this.now(),
        "failed",
        events,
        undefined,
        usage,
        threadReference === undefined
          ? undefined
          : {
              schemaVersion: 1,
              providerId: request.providerId,
              opaqueReference: threadReference,
              resumable: false,
            },
        safeError(
          parsed.code,
          "STRUCTURED_OUTPUT",
          "REVIEW_PROVIDER_OUTPUT",
          parsed.detail,
        ),
      );
    }
    if (!events.some((item) => item.kind === "turn_completed"))
      append("turn_completed");
    const result = resultBase(
      request,
      startedAt,
      this.now(),
      "completed",
      events,
      parsed.data as unknown as AIJsonValue,
      usage,
      threadReference === undefined
        ? undefined
        : {
            schemaVersion: 1,
            providerId: request.providerId,
            opaqueReference: threadReference,
            resumable: true,
          },
    );
    assertAIProviderTurnResult(result);
    return result;
  }
}

export { CODEX_CAPABILITIES };
export { CodexAIProvider as CodexAdapter };
export { CodexAIProvider as CodexProvider };

export function createCodexProvider(
  options: CodexAdapterOptions = {},
): CodexAIProvider {
  return new CodexAIProvider(options);
}
