import { query, type Options, type Query } from "@prmonitor/provider-runtimes";
import { lstat, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AIConnection } from "../../shared/ai-connections";
import type { AIProviderCapabilities } from "../../shared/ai/provider-contracts";
import {
  CodexAdapter,
  CODEX_CAPABILITIES,
  type CodexRuntimePort,
  type CodexThreadOptions,
  type CodexThreadPort,
} from "./codex-adapter";
import { ownClaudeProcess } from "./claude-process";
import { withCancellation } from "./copilot-runtime";
import type { ConnectionAuthentication } from "./connection-authentication";
import {
  checkClaudePolicy,
  type ClaudePolicyProbe,
} from "./claude-policy-probe";
import { claudeToolPermitted, claudeTools } from "./claude-policy";
import type { AIProvider } from "./registry";

export const CLAUDE_CAPABILITIES: AIProviderCapabilities = {
  ...CODEX_CAPABILITIES,
  providerId: "claude",
  reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  modelCatalog: ["sonnet", "opus", "haiku"].map((modelId) => ({
    modelId,
    supportedOptionKeys: [],
    reasoningEfforts: ["low", "medium", "high"],
  })),
};
export interface ClaudeAdapterOptions {
  readonly authentication: ConnectionAuthentication;
  readonly query?: typeof query;
  readonly policy?: ClaudePolicyProbe;
}
const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const sessionId = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      value,
    )
  )
    throw new Error(
      "Claude Code returned an unsupported conversation identity.",
    );
  return value;
};
export function claudeQueryOptions(
  connection: AIConnection,
  environment: Record<string, string>,
  options: CodexThreadOptions,
  controller: AbortController,
  resumeId?: string,
): Options {
  if (!options.workingDirectory || !path.isAbsolute(options.workingDirectory))
    throw new Error("Claude Code needs the canonical operation worktree.");
  const root = options.workingDirectory;
  const write = options.sandboxMode === "workspace-write";
  return {
    pathToClaudeCodeExecutable: connection.executable,
    cwd: root,
    env: environment,
    model: options.model,
    ...(options.modelReasoningEffort
      ? { effort: options.modelReasoningEffort as Options["effort"] }
      : {}),
    ...(resumeId
      ? { resume: sessionId(resumeId) }
      : { sessionId: randomUUID() }),
    abortController: controller,
    settingSources: [],
    extraArgs: {
      restricted: null,
      "safe-mode": null,
      "disable-slash-commands": null,
      ...(connection.extraArgs.includes("--no-chrome")
        ? { "no-chrome": null }
        : {}),
    },
    tools: claudeTools(write),
    allowedTools: claudeTools(write),
    disallowedTools: [
      "Bash",
      "Agent",
      "Task",
      "WebFetch",
      "WebSearch",
      "Skill",
      "mcp__*",
    ],
    permissionMode: write ? "acceptEdits" : "dontAsk",
    permissionPrompts: "none",
    strictMcpConfig: true,
    mcpServers: {},
    plugins: [],
    hooks: {
      PreToolUse: [
        {
          hooks: [
            async (input) => {
              if (
                input.hook_event_name === "PreToolUse" &&
                (await claudeToolPermitted(
                  root,
                  write,
                  input.tool_name,
                  input.tool_input,
                ))
              )
                return {};
              return {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "deny",
                  permissionDecisionReason:
                    "This task permits only scoped file tools in its operation worktree.",
                },
              };
            },
          ],
        },
      ],
    },
  };
}

/** Provider SDK stays behind the adapter; normalization reuses the existing tested stream contract. */
export function createClaudeProvider(config: ClaudeAdapterOptions): AIProvider {
  const start = config.query ?? query;
  const policy = config.policy ?? checkClaudePolicy;
  const runtime: CodexRuntimePort = {
    createClient: (clientOptions) => {
      const connection = clientOptions.connection;
      if (
        !connection ||
        connection.tool !== "claude" ||
        connection.authMode !== "subscription"
      )
        throw new Error("Select a saved Claude Code subscription connection.");
      function thread(
        options: CodexThreadOptions,
        resumeId?: string,
      ): CodexThreadPort {
        let id: string | null = resumeId ? sessionId(resumeId) : null;
        return {
          get id() {
            return id;
          },
          async runStreamed(input, runOptions) {
            async function* events(): AsyncIterable<unknown> {
              runOptions.signal?.throwIfAborted();
              const release = await config.authentication.acquire(
                connection!.id,
                runOptions.signal,
              );
              const controller = new AbortController();
              const processOwner = ownClaudeProcess(controller);
              const abort = () => controller.abort();
              runOptions.signal?.addEventListener("abort", abort, {
                once: true,
              });
              if (runOptions.signal?.aborted) abort();
              const timer = setTimeout(abort, 30 * 60 * 1000);
              let stream: Query | undefined;
              let unblock: (() => void) | undefined;
              try {
                const root = options.workingDirectory;
                if (
                  !root ||
                  !path.isAbsolute(root) ||
                  (await lstat(root)).isSymbolicLink() ||
                  (await realpath(root)) !== root
                )
                  throw new Error(
                    "Claude Code needs the canonical operation worktree.",
                  );
                const home = await config.authentication.home(connection!);
                if (!home)
                  throw new Error(
                    "Sign in to Claude Code, then check this connection.",
                  );
                const status = await config.authentication.check(
                  connection!,
                  controller.signal,
                );
                if (
                  !status.compatible ||
                  status.authentication !== "subscription" ||
                  !status.executable
                )
                  throw new Error(status.message);
                const env = config.authentication.environment(
                  connection!,
                  home,
                  clientOptions.env,
                );
                if (!(await policy(root, env, controller.signal)).supported)
                  throw new Error(
                    "Claude Code has incompatible managed launch or billing settings.",
                  );
                let ready = false;
                const wait = new Promise<void>((resolve) => {
                  unblock = resolve;
                });
                async function* prompt() {
                  await wait;
                  controller.signal.throwIfAborted();
                  if (!ready) return;
                  yield {
                    type: "user" as const,
                    session_id: resumeId ?? "",
                    parent_tool_use_id: null,
                    message: { role: "user" as const, content: input },
                  };
                }
                stream = start({
                  prompt: prompt(),
                  options: {
                    ...claudeQueryOptions(
                      { ...connection!, executable: status.executable },
                      env,
                      options,
                      controller,
                      resumeId,
                    ),
                    spawnClaudeCodeProcess: processOwner.spawn,
                    outputFormat: {
                      type: "json_schema",
                      schema: runOptions.outputSchema as Record<
                        string,
                        unknown
                      >,
                    },
                  },
                });
                const initialized = await withCancellation(
                  stream.initializationResult(),
                  controller.signal,
                );
                if (
                  initialized.hooks_applied !== true ||
                  initialized.account.apiProvider !== "firstParty" ||
                  initialized.account.apiKeySource !== "none"
                )
                  throw new Error(
                    "Claude Code did not retain this connection's subscription or file-tool guard.",
                  );
                const model = initialized.models.find(
                  (value) =>
                    value.value === options.model ||
                    value.resolvedModel === options.model,
                );
                if (
                  !model ||
                  (options.modelReasoningEffort &&
                    !model.supportedEffortLevels?.includes(
                      options.modelReasoningEffort as NonNullable<
                        typeof model.supportedEffortLevels
                      >[number],
                    ))
                )
                  throw new Error(
                    "Claude Code does not support the selected model or reasoning effort.",
                  );
                ready = true;
                unblock!();
                let total = 0;
                let complete = false;
                for await (const raw of stream) {
                  controller.signal.throwIfAborted();
                  const message = object(raw);
                  const encoded = JSON.stringify(raw);
                  total += Buffer.byteLength(encoded);
                  if (
                    Buffer.byteLength(encoded) > 256 * 1024 ||
                    total > 8 * 1024 * 1024
                  )
                    throw new Error("Claude Code exceeded the output limit.");
                  if (message.type === "system" && message.subtype === "init") {
                    if (
                      message.cwd !== root ||
                      message.apiKeySource !== "none" ||
                      message.permissionMode !==
                        (options.sandboxMode === "workspace-write"
                          ? "acceptEdits"
                          : "dontAsk") ||
                      !Array.isArray(message.tools) ||
                      message.tools.some(
                        (tool) =>
                          typeof tool !== "string" ||
                          !claudeTools(
                            options.sandboxMode === "workspace-write",
                          ).includes(tool),
                      ) ||
                      !Array.isArray(message.mcp_servers) ||
                      message.mcp_servers.length ||
                      !Array.isArray(message.plugins) ||
                      message.plugins.length
                    )
                      throw new Error(
                        "Claude Code broadened the task's tool or worktree permissions.",
                      );
                    id = sessionId(message.session_id);
                    if (resumeId && id !== resumeId)
                      throw new Error(
                        "Claude Code resumed a different conversation.",
                      );
                    yield { type: "thread.started", thread_id: id };
                    yield { type: "turn.started" };
                  } else if (message.type === "result") {
                    if (
                      !id ||
                      message.session_id !== id ||
                      message.subtype !== "success" ||
                      message.is_error !== false ||
                      message.structured_output === undefined
                    )
                      throw new Error(
                        "Claude Code did not complete the structured task.",
                      );
                    yield {
                      type: "item.completed",
                      item: {
                        type: "agent_message",
                        text: JSON.stringify(message.structured_output),
                      },
                    };
                    const usage = object(message.usage);
                    yield {
                      type: "turn.completed",
                      usage: {
                        input_tokens: usage.input_tokens,
                        output_tokens: usage.output_tokens,
                      },
                    };
                    complete = true;
                    break;
                  }
                }
                if (!complete)
                  throw new Error(
                    "Claude Code stopped before completing the task.",
                  );
              } finally {
                clearTimeout(timer);
                runOptions.signal?.removeEventListener("abort", abort);
                unblock?.();
                controller.abort();
                stream?.close();
                try {
                  await processOwner.close();
                } finally {
                  release();
                }
              }
            }
            return { events: events() };
          },
        };
      }
      return {
        startThread: (options) => thread(options),
        resumeThread: (id, options) => thread(options, id),
      };
    },
  };
  const normalized = new CodexAdapter({ runtime });
  return {
    id: "claude",
    capabilities: CLAUDE_CAPABILITIES,
    readLocalReadiness: async (connection) => {
      if (!connection)
        return { runtimeAvailable: false, authenticationAvailable: false };
      const status = await config.authentication.check(connection);
      return {
        runtimeAvailable: status.compatible,
        authenticationAvailable: status.authentication === "subscription",
      };
    },
    invoke: (request, options) => normalized.invoke(request, options),
  };
}
