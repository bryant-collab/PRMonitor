import { detectedProviderModels } from "./provider-models";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type { SessionConfig } from "@prmonitor/provider-runtimes";
import type { AIProviderCapabilities } from "../../shared/ai/provider-contracts";
import {
  CodexAdapter,
  CODEX_CAPABILITIES,
  type CodexRuntimePort,
  type CodexThreadOptions,
  type CodexThreadPort,
} from "./codex-adapter";
import type { ConnectionAuthentication } from "./connection-authentication";
import { claudeToolPermitted } from "./claude-policy";
import {
  closeCopilotClient,
  withCancellation,
  boundedCleanup,
  copilotBareModel,
  copilotClientOptions,
  copilotSubscription,
  defaultCopilotFactory,
  type CopilotFactory,
  type CopilotClientPort,
  type CopilotSessionPort,
} from "./copilot-runtime";
import type { AIProvider } from "./registry";

export const COPILOT_CAPABILITIES: AIProviderCapabilities = {
  ...CODEX_CAPABILITIES,
  providerId: "copilot",
  reasoningEfforts: ["low", "medium", "high", "xhigh"],
  modelCatalog: [
    {
      modelId: "gpt-5",
      supportedOptionKeys: [],
      reasoningEfforts: ["low", "medium", "high"],
    },
  ],
};
export function copilotTools(write: boolean): string[] {
  return [
    "builtin:view",
    "builtin:glob",
    "builtin:grep",
    ...(write ? ["builtin:edit", "builtin:create"] : []),
  ];
}
const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export async function copilotToolPermitted(
  root: string,
  write: boolean,
  name: string,
  value: unknown,
): Promise<boolean> {
  // The SDK swallows thrown PreToolUse errors. Always produce a deny on uncertainty.
  try {
    const bare = name.startsWith("builtin:") ? name.slice(8) : name;
    if (!copilotTools(write).includes(`builtin:${bare}`)) return false;
    const input = object(value);
    const mapped = (
      {
        view: "Read",
        edit: "Edit",
        create: "Write",
        glob: "Glob",
        grep: "Grep",
      } as Record<string, string>
    )[bare];
    if (
      !mapped ||
      "file_path" in input ||
      (input.path !== undefined && typeof input.path !== "string")
    )
      return false;
    const fields: Record<string, string[]> = {
      view: ["path", "view_range"],
      edit: ["path", "old_str", "new_str"],
      create: ["path", "file_text"],
      glob: ["path", "pattern"],
      grep: [
        "path",
        "pattern",
        "glob",
        "type",
        "output_mode",
        "head_limit",
        "multiline",
        "ignore_case",
      ],
    };
    if (Object.keys(input).some((key) => !fields[bare]?.includes(key)))
      return false;
    const normalized =
      bare === "view"
        ? { file_path: input.path }
        : bare === "edit"
          ? {
              file_path: input.path,
              old_string: input.old_str,
              new_string: input.new_str,
            }
          : bare === "create"
            ? { file_path: input.path, content: input.file_text }
            : bare === "glob"
              ? { path: input.path, pattern: input.pattern }
              : {
                  path: input.path,
                  pattern: input.pattern,
                  ...(input.glob === undefined ? {} : { glob: input.glob }),
                };
    return await claudeToolPermitted(root, write, mapped, normalized);
  } catch {
    return false;
  }
}
export function copilotSessionOptions(
  options: CodexThreadOptions,
): SessionConfig {
  if (
    !options.workingDirectory ||
    !path.isAbsolute(options.workingDirectory) ||
    !copilotBareModel(options.model)
  )
    throw new Error(
      "Copilot needs a supported service model and canonical operation worktree.",
    );
  const root = options.workingDirectory;
  const write = options.sandboxMode === "workspace-write";
  return {
    clientName: "PRMonitor",
    workingDirectory: root,
    model: options.model,
    ...(options.modelReasoningEffort
      ? {
          reasoningEffort:
            options.modelReasoningEffort as SessionConfig["reasoningEffort"],
        }
      : {}),
    availableTools: copilotTools(write),
    excludedTools: ["mcp:*", "custom:*"],
    tools: [],
    providers: [],
    models: [],
    mcpServers: {},
    customAgents: [],
    customAgentsLocalOnly: true,
    enableConfigDiscovery: false,
    enableFileHooks: false,
    enableSkills: false,
    enableOnDemandInstructionDiscovery: false,
    enableHostGitOperations: false,
    enableSessionStore: false,
    enableExperimentalMode: false,
    skipCustomInstructions: true,
    remoteSession: "off",
    memory: { enabled: false },
    manageScheduleEnabled: false,
    skillDirectories: [],
    instructionDirectories: [],
    additionalDirectories: [],
    managedSettings: {
      permissions: { disableBypassPermissionsMode: "disable" },
    },
    onPermissionRequest: () => ({
      kind: "denied-no-approval-rule-and-could-not-request-from-user",
    }),
    hooks: {
      onPreToolUse: async (input) =>
        (await copilotToolPermitted(
          root,
          write,
          input.toolName,
          input.toolArgs,
        ))
          ? {}
          : {
              permissionDecision: "deny",
              permissionDecisionReason:
                "This task permits only scoped file tools in its operation worktree.",
            },
    },
  };
}
export function createCopilotProvider(config: {
  authentication: ConnectionAuthentication;
  factory?: CopilotFactory;
}): AIProvider {
  const factory = config.factory ?? defaultCopilotFactory;
  const runtime: CodexRuntimePort = {
    createClient: (clientOptions) => {
      const connection = clientOptions.connection;
      if (
        !connection ||
        connection.tool !== "copilot" ||
        connection.authMode !== "subscription"
      )
        throw new Error(
          "Select a saved GitHub Copilot subscription connection.",
        );
      function thread(
        options: CodexThreadOptions,
        resumeId?: string,
      ): CodexThreadPort {
        let id: string | null = resumeId ?? null;
        if (resumeId && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(resumeId))
          throw new Error("Copilot conversation identity is unsupported.");
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
              let client: CopilotClientPort | undefined;
              let session: CopilotSessionPort | undefined;
              const controller = new AbortController();
              const abort = () => {
                controller.abort();
                void session?.abort().catch(() => {});
              };
              runOptions.signal?.addEventListener("abort", abort, {
                once: true,
              });
              if (runOptions.signal?.aborted) abort();
              const timer = setTimeout(abort, 30 * 60 * 1000);
              try {
                const root = options.workingDirectory;
                if (
                  !root ||
                  !path.isAbsolute(root) ||
                  (await lstat(root)).isSymbolicLink() ||
                  (await realpath(root)) !== root
                )
                  throw new Error(
                    "Copilot needs the canonical operation worktree.",
                  );
                const home = await config.authentication.home(connection!);
                if (!home)
                  throw new Error(
                    "Sign in to the Copilot CLI, then check this connection.",
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
                client = factory(
                  copilotClientOptions(
                    { ...connection!, executable: status.executable },
                    env,
                    root,
                    home,
                  ),
                );
                await withCancellation(client.start(), controller.signal);
                controller.signal.throwIfAborted();
                if (
                  !copilotSubscription(
                    await withCancellation(
                      client.getAuthStatus(),
                      controller.signal,
                    ),
                  )
                )
                  throw new Error(
                    "Copilot is not using this connection's existing GitHub subscription sign-in.",
                  );
                const discovery = await withCancellation(
                  client.rpc.hooks.discover({
                    projectPaths: [root],
                    excludeHostHooks: false,
                  }),
                  controller.signal,
                );
                if (
                  !Array.isArray(discovery.hooks) ||
                  !Array.isArray(discovery.errors) ||
                  discovery.errors.length ||
                  discovery.hooks.some((hook) => hook.enabled !== false)
                )
                  throw new Error(
                    "Copilot has startup hooks or incomplete managed-policy discovery that this task cannot use.",
                  );
                const model = (
                  await withCancellation(client.listModels(), controller.signal)
                ).find(
                  (value) =>
                    value.id === options.model && copilotBareModel(value.id),
                );
                if (
                  !model ||
                  (options.modelReasoningEffort &&
                    !model.supportedReasoningEfforts?.includes(
                      options.modelReasoningEffort,
                    ))
                )
                  throw new Error(
                    "Copilot does not support the selected model or reasoning effort.",
                  );
                const tools = await withCancellation(
                  client.rpc.tools.list({
                    model: options.model,
                  }),
                  controller.signal,
                );
                for (const selected of copilotTools(
                  options.sandboxMode === "workspace-write",
                )) {
                  const tool = tools.tools.find(
                    (value) => `builtin:${value.name}` === selected,
                  );
                  if (
                    !tool ||
                    !tool.parameters ||
                    !object(tool.parameters.properties).path
                  )
                    throw new Error(
                      "Copilot's file-tool schema is incompatible with this task's path guard.",
                    );
                }
                controller.signal.throwIfAborted();
                const settings = copilotSessionOptions(options);
                session = resumeId
                  ? await withCancellation(
                      client.resumeSession(resumeId, {
                        ...settings,
                        continuePendingWork: false,
                      }),
                      controller.signal,
                    )
                  : await withCancellation(
                      client.createSession(settings),
                      controller.signal,
                    );
                if (
                  !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(
                    session.sessionId,
                  ) ||
                  (resumeId && session.sessionId !== resumeId) ||
                  (
                    await withCancellation(
                      session.rpc.model.getCurrent(),
                      controller.signal,
                    )
                  ).modelId !== options.model
                )
                  throw new Error(
                    "Copilot changed the task's conversation or service model.",
                  );
                id = session.sessionId;
                yield { type: "thread.started", thread_id: id };
                yield { type: "turn.started" };
                controller.signal.throwIfAborted();
                const response = await withCancellation(
                  session.sendAndWait(
                    `${input}\nReturn one JSON object matching this schema; no Markdown fences:\n${JSON.stringify(runOptions.outputSchema)}`,
                    30 * 60 * 1000,
                  ),
                  controller.signal,
                );
                controller.signal.throwIfAborted();
                if (
                  !response ||
                  typeof response.data.content !== "string" ||
                  Buffer.byteLength(response.data.content) > 256 * 1024
                )
                  throw new Error(
                    "Copilot did not return a bounded structured answer.",
                  );
                yield {
                  type: "item.completed",
                  item: { type: "agent_message", text: response.data.content },
                };
                yield { type: "turn.completed" };
              } finally {
                clearTimeout(timer);
                runOptions.signal?.removeEventListener("abort", abort);
                try {
                  if (session) {
                    await boundedCleanup(session.abort());
                    await boundedCleanup(session.disconnect());
                  }
                } finally {
                  try {
                    if (client) await closeCopilotClient(client);
                  } finally {
                    release();
                  }
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
    id: "copilot",
    get capabilities() {
      return {
        ...COPILOT_CAPABILITIES,
        modelCatalog:
          detectedProviderModels("copilot")?.map((model) => ({
            ...model,
            supportedOptionKeys: [],
          })) ?? COPILOT_CAPABILITIES.modelCatalog,
      };
    },
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
