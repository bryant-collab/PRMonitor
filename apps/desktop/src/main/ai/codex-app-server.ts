import { spawn } from "node:child_process";
import path from "node:path";
import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import {
  scopedFileTools,
  invokeScopedFileTool,
  type FileToolReply,
} from "./scoped-file-tools";
import type { AIConnection } from "../../shared/ai-connections";
import type {
  CodexClientPort,
  CodexThreadOptions,
  CodexThreadPort,
} from "./codex-adapter";
import { boundedJsonLines } from "./bounded-json-lines";

export interface CodexProtocol {
  request(
    method: string,
    params: Record<string, unknown> | null,
  ): Promise<unknown>;
  notifications(): AsyncIterable<unknown>;
  close(): Promise<void>;
  setFileToolHandler?(
    handler: (params: unknown) => Promise<FileToolReply>,
  ): void;
}
export type CodexProtocolFactory = (
  options: CodexThreadOptions,
  signal?: AbortSignal,
) => Promise<CodexProtocol>;
const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Codex returned an unsupported protocol response.");
  return value as Record<string, unknown>;
};
const normalizedPath = (value: string) =>
  process.platform === "win32"
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);
const safeThreadId = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      value,
    )
  )
    throw new Error("Codex returned an unsupported conversation identity.");
  return value;
};

const isolatedFeatures = [
  "apps",
  "code_mode",
  "code_mode_only",
  "context_management",
  "current_time_reminder",
  "deferred_executor",
  "enable_fanout",
  "goals",
  "hooks",
  "image_generation",
  "memories",
  "multi_agent",
  "multi_agent_v2",
  "plugins",
  "request_permissions_tool",
  "shell_snapshot",
  "shell_tool",
  "standalone_web_search",
  "token_budget",
  "tool_suggest",
  "unified_exec",
  "view_image",
];
export function codexApplicationConfig(
  options: CodexThreadOptions,
  fileTools = false,
): Record<string, unknown> {
  return {
    ...(fileTools
      ? {
          ...Object.fromEntries(
            isolatedFeatures.map((key) => [`features.${key}`, false]),
          ),
          "orchestrator.skills.enabled": false,
          "skills.include_instructions": false,
          "tools.experimental_request_user_input.enabled": false,
          "tools.update_plan.enabled": false,
        }
      : {}),
    approval_policy: "never",
    approvals_reviewer: "user",
    model_provider: "openai",
    web_search: "disabled",
    notify: [],
    allow_login_shell: false,
    "features.hooks": false,
    "features.plugins": false,
    "features.apps": false,
    "features.shell_snapshot": false,
    "shell_environment_policy.inherit": "none",
    "shell_environment_policy.include_only": [],
    "shell_environment_policy.set": {},
    "sandbox_workspace_write.network_access": options.networkAccessEnabled,
    "sandbox_workspace_write.exclude_tmpdir_env_var": true,
    "sandbox_workspace_write.exclude_slash_tmp": true,
    "sandbox_workspace_write.writable_roots": options.workingDirectory
      ? [options.workingDirectory]
      : [],
    ...(options.modelReasoningEffort
      ? { model_reasoning_effort: options.modelReasoningEffort }
      : {}),
  };
}

/** Verify the effective layered result; empty table overrides cannot clear inherited MCP/hooks. */
export function assertCodexConfiguration(
  value: unknown,
  fileTools = false,
): void {
  const config = record(record(value).config);
  const features = record(config.features);
  const environment = record(config.shell_environment_policy);
  if (fileTools && isolatedFeatures.some((key) => features[key] !== false))
    throw new Error("Codex did not retain file-only tool restrictions.");
  if (
    config.approval_policy !== "never" ||
    config.approvals_reviewer !== "user" ||
    config.model_provider !== "openai" ||
    config.web_search !== "disabled" ||
    config.allow_login_shell !== false ||
    environment.inherit !== "none" ||
    ["hooks", "plugins", "apps", "shell_snapshot"].some(
      (key) => features[key] !== false,
    )
  )
    throw new Error(
      "Codex policy does not match PRMonitor's work permissions.",
    );
  for (const value of [
    config.mcp_servers,
    config.hooks,
    config.plugins,
    config.apps,
    config.model_providers == null
      ? undefined
      : record(config.model_providers).openai,
    environment.set,
  ]) {
    if (value != null && Object.keys(record(value)).length)
      throw new Error(
        "Codex has additional tools or launch configuration that PRMonitor cannot safely use.",
      );
  }
  for (const value of [config.notify, environment.include_only])
    if (value != null && (!Array.isArray(value) || value.length))
      throw new Error(
        "Codex has additional launch configuration that PRMonitor cannot safely use.",
      );
}

export function assertCodexRequirements(
  value: unknown,
  connection: AIConnection,
  fileTools = false,
): void {
  const response = record(value);
  if (!("requirements" in response))
    throw new Error("Codex could not report managed work requirements.");
  if (response.requirements === null) return;
  const requirements = record(response.requirements);
  if (requirements.featureRequirements != null) {
    const features = record(requirements.featureRequirements);
    if (
      (fileTools
        ? isolatedFeatures
        : ["hooks", "plugins", "apps", "shell_snapshot"]
      ).some((key) => features[key] === true)
    )
      throw new Error(
        "Managed Codex requirements enable additional tools or hooks. PRMonitor cannot start this work.",
      );
  }
  if (requirements.hooks != null || requirements.allowLoginShell === true)
    throw new Error(
      "Managed Codex launch requirements cannot be safely applied to this operation.",
    );
  if (
    requirements.allowedLoginMethods != null &&
    (!Array.isArray(requirements.allowedLoginMethods) ||
      !requirements.allowedLoginMethods.includes(
        connection.authMode === "subscription" ? "chatgpt" : "api",
      ))
  )
    throw new Error(
      "Managed Codex requirements do not permit this connection's sign-in method.",
    );
}

export function assertCodexThreadBoundary(
  value: unknown,
  options: CodexThreadOptions,
  fileTools = false,
): { id: string; sandbox: Record<string, unknown> } {
  const response = record(value);
  const sandbox = record(response.sandbox);
  if (
    response.approvalPolicy !== "never" ||
    response.approvalsReviewer !== "user" ||
    response.modelProvider !== "openai" ||
    response.model !== options.model ||
    typeof response.cwd !== "string" ||
    (options.workingDirectory &&
      normalizedPath(response.cwd) !== normalizedPath(options.workingDirectory))
  )
    throw new Error("Codex did not apply the requested thread permissions.");
  if (sandbox.networkAccess === true && !options.networkAccessEnabled)
    throw new Error("Codex broadened network permissions.");
  if (options.sandboxMode === "read-only") {
    if (sandbox.type !== "readOnly")
      throw new Error("Codex did not apply read-only permissions.");
  } else {
    if (
      !options.workingDirectory ||
      sandbox.type !== "workspaceWrite" ||
      sandbox.excludeSlashTmp !== true ||
      sandbox.excludeTmpdirEnvVar !== true ||
      !Array.isArray(sandbox.writableRoots) ||
      !sandbox.writableRoots.length ||
      sandbox.writableRoots.some(
        (root) =>
          typeof root !== "string" ||
          normalizedPath(root) !== normalizedPath(options.workingDirectory!),
      )
    )
      throw new Error("Codex broadened writable worktree permissions.");
  }
  const returnedThread = record(response.thread);
  if (
    fileTools &&
    (!Array.isArray(returnedThread.environments) ||
      returnedThread.environments.length !== 0)
  )
    throw new Error("Codex selected an ungranted execution environment.");
  return { id: safeThreadId(returnedThread.id), sandbox };
}

export function createCodexAppServerClient(
  connection: AIConnection,
  factory: CodexProtocolFactory,
  fileTools = false,
): CodexClientPort {
  function thread(
    options: CodexThreadOptions,
    resumeId?: string,
  ): CodexThreadPort {
    if (resumeId) safeThreadId(resumeId);
    let id: string | null = resumeId ?? null;
    return {
      get id() {
        return id;
      },
      async runStreamed(input, runOptions) {
        runOptions.signal?.throwIfAborted();
        async function* events(): AsyncIterable<unknown> {
          const protocol = await factory(options, runOptions.signal);
          let activeTurn: string | undefined;
          const fileCalls = new Map<
            string,
            { fingerprint: string; result: FileToolReply }
          >();
          if (fileTools) {
            if (!protocol.setFileToolHandler) {
              await protocol.close();
              throw new Error("Codex file-tool transport is unavailable.");
            }
            protocol.setFileToolHandler(async (raw) => {
              const params = record(raw);
              if (
                !id ||
                !activeTurn ||
                params.threadId !== id ||
                params.turnId !== activeTurn ||
                params.namespace !== "prmonitor_files" ||
                typeof params.callId !== "string" ||
                !params.callId ||
                params.callId.length > 128 ||
                typeof params.tool !== "string"
              )
                return {
                  success: false,
                  contentItems: [
                    {
                      type: "inputText",
                      text: "File request denied: conversation, turn, or tool identity does not match.",
                    },
                  ],
                };
              const fingerprint = createHash("sha256")
                .update(JSON.stringify([params.tool, params.arguments]))
                .digest("hex");
              const prior = fileCalls.get(params.callId);
              if (prior) {
                if (prior.fingerprint !== fingerprint)
                  throw new Error(
                    "Codex reused a file-call identity with changed arguments.",
                  );
                return prior.result;
              }
              if (fileCalls.size >= 64)
                throw new Error("Codex exceeded the per-turn file-call limit.");
              const result = await invokeScopedFileTool(
                options,
                params.tool,
                params.arguments,
                runOptions.signal,
              );
              fileCalls.set(params.callId, { fingerprint, result });
              return result;
            });
          }
          try {
            const auth = record(
              await protocol.request("getAuthStatus", {
                includeToken: false,
                refreshToken: false,
              }),
            );
            if (
              auth.authToken !== null ||
              auth.requiresOpenaiAuth !== true ||
              auth.authMethod !==
                (connection.authMode === "subscription" ? "chatgpt" : "apikey")
            )
              throw new Error(
                "This connection is not signed in with its selected billing method. PRMonitor will not switch methods.",
              );
            const account = record(
              await protocol.request("account/read", { refreshToken: false }),
            ).account;
            const type = account == null ? undefined : record(account).type;
            if (
              type !==
              (connection.authMode === "subscription" ? "chatgpt" : "apiKey")
            )
              throw new Error(
                "Sign in with this connection's selected billing method. PRMonitor will not switch methods.",
              );
            assertCodexRequirements(
              await protocol.request("configRequirements/read", null),
              connection,
              fileTools,
            );
            assertCodexConfiguration(
              await protocol.request("config/read", {
                includeLayers: false,
                ...(options.workingDirectory
                  ? { cwd: options.workingDirectory }
                  : {}),
              }),
              fileTools,
            );
            let selected: Record<string, unknown> | undefined;
            let cursor: string | undefined;
            const seenCursors = new Set<string>();
            for (let page = 0; page < 4; page++) {
              const models = record(
                await protocol.request("model/list", {
                  includeHidden: true,
                  limit: 100,
                  ...(cursor ? { cursor } : {}),
                }),
              );
              if (!Array.isArray(models.data) || models.data.length > 100)
                throw new Error("Codex could not report supported models.");
              selected = models.data
                .map(record)
                .find((value) => value.model === options.model);
              if (selected || models.nextCursor == null) break;
              if (
                typeof models.nextCursor !== "string" ||
                models.nextCursor.length > 1024 ||
                seenCursors.has(models.nextCursor)
              )
                throw new Error("Codex returned an unsupported model page.");
              cursor = models.nextCursor;
              seenCursors.add(cursor);
            }
            if (
              !selected ||
              (options.modelReasoningEffort &&
                (!Array.isArray(selected.supportedReasoningEfforts) ||
                  !selected.supportedReasoningEfforts.some(
                    (value) =>
                      record(value).reasoningEffort ===
                      options.modelReasoningEffort,
                  )))
            )
              throw new Error(
                "The selected model or reasoning effort is not supported by this connection. Saved choices have not been changed.",
              );
            const boundary = assertCodexThreadBoundary(
              await protocol.request(
                resumeId ? "thread/resume" : "thread/start",
                {
                  ...(resumeId ? { threadId: resumeId } : {}),
                  model: options.model,
                  modelProvider: "openai",
                  approvalPolicy: "never",
                  approvalsReviewer: "user",
                  sandbox: options.sandboxMode,
                  ...(options.workingDirectory
                    ? { cwd: options.workingDirectory }
                    : {}),
                  config: codexApplicationConfig(options, fileTools),
                  ...(resumeId
                    ? {}
                    : {
                        ...(fileTools
                          ? {
                              environments: [],
                              runtimeWorkspaceRoots: [],
                              selectedCapabilityRoots: [],
                              dynamicTools: scopedFileTools(
                                options.sandboxMode === "workspace-write",
                              ),
                            }
                          : {}),
                        ephemeral: false,
                        experimentalRawEvents: false,
                        persistExtendedHistory: false,
                      }),
                },
              ),
              options,
              fileTools,
            );
            id = boundary.id;
            if (resumeId && id !== resumeId)
              throw new Error("Codex resumed a different conversation.");
            yield { type: "thread.started", thread_id: id };
            const started = record(
              await protocol.request("turn/start", {
                threadId: id,
                input: [{ type: "text", text: input }],
                model: options.model,
                approvalPolicy: "never",
                approvalsReviewer: "user",
                sandboxPolicy: boundary.sandbox,
                outputSchema: runOptions.outputSchema,
                ...(fileTools
                  ? { environments: [], runtimeWorkspaceRoots: [] }
                  : {}),
                ...(options.modelReasoningEffort
                  ? { effort: options.modelReasoningEffort }
                  : {}),
              }),
            );
            const turnId = record(started.turn).id;
            if (typeof turnId !== "string" || !turnId || turnId.length > 128)
              throw new Error("Codex returned an unsupported turn identity.");
            activeTurn = turnId;
            yield { type: "turn.started" };
            for await (const message of protocol.notifications()) {
              runOptions.signal?.throwIfAborted();
              const event = record(message);
              const params = record(event.params);
              if (
                params.threadId !== id ||
                (params.turnId !== undefined && params.turnId !== turnId)
              )
                continue;
              if (event.method === "item/completed") {
                const item = record(params.item);
                if (
                  item.type === "agentMessage" &&
                  typeof item.text === "string"
                )
                  yield {
                    type: "item.completed",
                    item: { type: "agent_message", text: item.text },
                  };
              } else if (event.method === "turn/completed") {
                const turn = record(params.turn);
                if (turn.id !== turnId) continue;
                yield turn.status === "completed"
                  ? { type: "turn.completed" }
                  : {
                      type: "turn.failed",
                      error: { message: "Codex did not complete this turn." },
                    };
                return;
              }
            }
            throw new Error("Codex stopped before completing the turn.");
          } finally {
            await protocol.close();
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
}

export function codexServerArguments(
  connection: AIConnection,
  options: CodexThreadOptions,
  fileTools = false,
): string[] {
  const args = [...connection.extraArgs];
  // Never impose a login restriction on the terminal's shared sign-in store.
  if (connection.signInSource === "prmonitor")
    args.push(
      "--config",
      `forced_login_method=${JSON.stringify(connection.authMode === "subscription" ? "chatgpt" : "api")}`,
    );
  for (const [key, value] of Object.entries(
    codexApplicationConfig(options, fileTools),
  ))
    args.push("--config", `${key}=${JSON.stringify(value)}`);
  args.push("app-server", "--strict-config");
  return args;
}

/** Empty environments are the supported file-only path, never native setup. */
export async function assertCodexFileEnvironment(
  environment: Record<string, string>,
): Promise<void> {
  if (!environment.CODEX_HOME || !path.isAbsolute(environment.CODEX_HOME))
    throw new Error("Codex sign-in storage is unavailable.");
  try {
    await lstat(path.join(environment.CODEX_HOME, "environments.toml"));
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return;
    throw new Error(
      "Codex execution-environment configuration cannot be verified. Use a separate PRMonitor connection.",
      { cause: error },
    );
  }
  throw new Error(
    "This Codex store configures execution environments. Choose a separate PRMonitor connection for file-only work.",
  );
}

/** Own one bounded stdio server. Requests never contain login credentials. */
export async function openCodexProtocol(
  connection: AIConnection,
  environment: Record<string, string>,
  options: CodexThreadOptions,
  signal?: AbortSignal,
  start: typeof spawn = spawn,
  fileTools = false,
): Promise<CodexProtocol> {
  signal?.throwIfAborted();
  if (!environment.CODEX_HOME || !path.isAbsolute(environment.CODEX_HOME))
    throw new Error("Connect this connection's PRMonitor sign-in first.");
  if (fileTools) await assertCodexFileEnvironment(environment);
  const args = codexServerArguments(connection, options, fileTools);
  const child = start(connection.executable, args, {
    shell: false,
    windowsHide: true,
    env: fileTools
      ? { ...environment, CODEX_EXEC_SERVER_URL: "none" }
      : environment,
    cwd: environment.CODEX_HOME,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  child.stdin.on("error", () => {
    /* close/error settles all waiters */
  });
  let closed = false;
  let failure: Error | undefined;
  let nextId = 0;
  const pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  const queue: unknown[] = [];
  let wake: (() => void) | undefined;
  let fileHandler: ((params: unknown) => Promise<FileToolReply>) | undefined;
  const fail = (error: Error) => {
    failure ??= error;
    for (const waiter of pending.values()) waiter.reject(failure);
    pending.clear();
    wake?.();
  };
  const ended = new Promise<void>((resolve) => {
    child.once("error", () => fail(new Error("Codex could not start.")));
    child.once("close", () => {
      closed = true;
      fail(new Error("Codex stopped before completing the request."));
      resolve();
    });
  });
  const terminate = () => {
    if (closed) return;
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill();
      }
    } else child.kill();
    force ??= setTimeout(() => {
      if (child.pid) {
        try {
          if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    }, 1000);
  };
  let force: ReturnType<typeof setTimeout> | undefined;
  const abort = () => {
    fail(new Error("AI work was cancelled."));
    terminate();
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(
    () => {
      fail(new Error("Codex exceeded the operation time limit."));
      terminate();
    },
    30 * 60 * 1000,
  );
  const send = (value: unknown) => {
    if (failure || closed) throw failure ?? new Error("Codex is unavailable.");
    child.stdin.write(`${JSON.stringify(value)}\n`);
  };
  const consuming = (async () => {
    try {
      for await (const raw of boundedJsonLines(child.stdout)) {
        const message = record(raw);
        if (
          typeof message.id === "number" &&
          typeof message.method !== "string"
        ) {
          const waiter = pending.get(message.id);
          if (!waiter)
            throw new Error("Codex returned an unexpected response identity.");
          pending.delete(message.id);
          if (message.error !== undefined)
            waiter.reject(
              new Error(
                "Codex rejected a protocol request. Check this connection's version and permissions.",
              ),
            );
          else waiter.resolve(message.result);
        } else if (typeof message.method === "string") {
          if (
            message.method === "account/updated" &&
            record(message.params).authMode !==
              (connection.authMode === "subscription" ? "chatgpt" : "apikey")
          )
            throw new Error("Codex changed this connection's billing method.");
          if (
            message.id !== undefined &&
            fileTools &&
            message.method === "item/tool/call" &&
            fileHandler
          ) {
            if (
              (typeof message.id !== "number" &&
                typeof message.id !== "string") ||
              (typeof message.id === "string" && message.id.length > 128)
            )
              throw new Error("Invalid tool request identity.");
            const result = await fileHandler(message.params);
            signal?.throwIfAborted();
            send({ id: message.id, result });
            continue;
          }
          if (message.id !== undefined)
            throw new Error(
              "Codex requested approval or an external tool; this operation does not grant that authority.",
            );
          if (queue.length >= 512)
            throw new Error("Codex exceeded the notification limit.");
          queue.push(message);
          wake?.();
        } else throw new Error("Codex returned invalid protocol output.");
      }
    } catch {
      fail(
        new Error(
          "Codex returned unsupported output or requested ungranted authority.",
        ),
      );
      terminate();
    }
  })();
  const protocol: CodexProtocol = {
    ...(fileTools
      ? {
          setFileToolHandler: (
            handler: (params: unknown) => Promise<FileToolReply>,
          ) => {
            fileHandler = handler;
          },
        }
      : {}),
    request(method, params) {
      if (signal?.aborted || failure || closed)
        return Promise.reject(failure ?? new Error("AI work was cancelled."));
      if (pending.size >= 8)
        return Promise.reject(new Error("Codex exceeded the request limit."));
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          send({ id, method, params });
        } catch {
          pending.delete(id);
          reject(new Error("Codex request could not be sent."));
        }
      });
    },
    async *notifications() {
      while (true) {
        if (failure) throw failure;
        if (queue.length) {
          yield queue.shift();
          continue;
        }
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = undefined;
      }
    },
    async close() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      terminate();
      try {
        await ended;
        await consuming;
      } finally {
        if (force && process.platform !== "win32")
          await new Promise<void>((resolve) => setTimeout(resolve, 1050));
        if (force) clearTimeout(force);
      }
    },
  };
  try {
    await protocol.request("initialize", {
      clientInfo: { name: "prmonitor", version: "0.1.0" },
      capabilities: { experimentalApi: fileTools },
    });
    send({ method: "initialized", params: {} });
    return protocol;
  } catch (error) {
    await protocol.close();
    throw error;
  }
}
