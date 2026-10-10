import {
  RuntimeConnection,
  type CopilotClientOptions,
  type SessionConfig,
  type ResumeSessionConfig,
} from "@prmonitor/provider-runtimes";
import { SupervisedCopilotClient } from "./copilot-supervisor";
export { copilotBareModel, copilotSubscription } from "./copilot-wire";
import { copilotBareModel, copilotSubscription } from "./copilot-wire";
import { recordProviderModels } from "./provider-models";
import type { AIConnection, AIToolStatus } from "../../shared/ai-connections";

export interface CopilotSessionPort {
  readonly sessionId: string;
  readonly rpc: {
    model: { getCurrent(): Promise<{ modelId?: string }> };
  };
  sendAndWait(
    prompt: string,
    timeout?: number,
  ): Promise<{ data: { content: string } } | undefined>;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
}
export interface CopilotModel {
  readonly id: string;
  readonly supportedReasoningEfforts?: readonly string[];
}
export interface CopilotClientPort {
  start(): Promise<void>;
  stop(): Promise<unknown>;
  forceStop(): Promise<void>;
  /** Resolves only after owned worker closure and OS descendant cleanup. */
  closeOwnedRuntime(): Promise<void>;
  getAuthStatus(): Promise<{
    isAuthenticated: boolean;
    authType?: string;
    host?: string;
  }>;
  listModels(): Promise<readonly CopilotModel[]>;
  readonly rpc: {
    hooks: {
      discover(input: {
        projectPaths: string[];
        excludeHostHooks: boolean;
      }): Promise<{ hooks: { enabled: boolean }[]; errors: string[] }>;
    };
    tools: {
      list(input: { model: string }): Promise<{
        tools: { name: string; parameters?: Record<string, unknown> }[];
      }>;
    };
  };
  createSession(input: SessionConfig): Promise<CopilotSessionPort>;
  resumeSession(
    id: string,
    input: ResumeSessionConfig,
  ): Promise<CopilotSessionPort>;
}
export type CopilotFactory = (
  options: CopilotClientOptions,
) => CopilotClientPort;
export const defaultCopilotFactory: CopilotFactory = (options) =>
  new SupervisedCopilotClient(options);
export function copilotClientOptions(
  connection: AIConnection,
  env: Record<string, string>,
  cwd: string,
  home: string,
): CopilotClientOptions {
  return {
    connection: RuntimeConnection.forStdio({
      path: connection.executable,
      env,
      args: [
        "--disable-builtin-mcps",
        ...(connection.extraArgs.includes("--no-color") ? ["--no-color"] : []),
      ],
    }),
    mode: "copilot-cli",
    useLoggedInUser: true,
    workingDirectory: cwd,
    baseDirectory: home,
    builtinPluginDirectories: [],
    logLevel: "none",
  };
}
/** Cleanup failure remains a failure; never replace the owner receipt with a timer. */
export async function closeCopilotClient(
  client: CopilotClientPort,
): Promise<void> {
  await client.closeOwnedRuntime();
}
export async function checkCopilotSignIn(
  connection: AIConnection,
  env: Record<string, string>,
  home: string,
  signal?: AbortSignal,
  factory: CopilotFactory = defaultCopilotFactory,
): Promise<Pick<AIToolStatus, "authentication" | "message" | "models">> {
  signal?.throwIfAborted();
  const client = factory(copilotClientOptions(connection, env, home, home));
  const controller = new AbortController();
  const cancel = () => {
    controller.abort();
  };
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(cancel, 15000);
  try {
    await withCancellation(client.start(), controller.signal);
    signal?.throwIfAborted();
    const authenticated = copilotSubscription(
      await withCancellation(client.getAuthStatus(), controller.signal),
    );
    signal?.throwIfAborted();
    const models = authenticated
      ? recordProviderModels(
          "copilot",
          (await withCancellation(client.listModels(), controller.signal))
            .filter((model) => copilotBareModel(model.id))
            .map((model) => ({
              modelId: model.id,
              reasoningEfforts: [...(model.supportedReasoningEfforts ?? [])],
            })),
        )
      : [];
    return {
      ...(models.length ? { models } : {}),
      authentication: authenticated ? "subscription" : "missing",
      message: authenticated
        ? "GitHub Copilot's existing subscription sign-in is configured. Scoped file-tool permissions are checked before each task."
        : "Sign in to the Copilot CLI with your GitHub account, then check again. API-key and gh CLI credentials are not selected.",
    };
  } catch {
    return {
      authentication: "unknown",
      message:
        "Copilot sign-in could not be checked. Verify the selected program and existing CLI sign-in.",
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    await closeCopilotClient(client);
  }
}

/** Bound SDK promises even when a disconnected runtime never replies. */
export function withCancellation<T>(
  pending: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) void pending.catch(() => {});
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new Error("AI work was cancelled or timed out."));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    pending.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (!signal.aborted) resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
export async function boundedCleanup(pending: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      pending.catch(() => {}),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 1000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
