// Bootstrap imports no provider SDK. Assignment/activation comes first.
import path from "node:path";
import { z } from "zod";
import {
  COPILOT_PENDING_LIMIT,
  COPILOT_POLICY_TIMEOUT,
  decodeCopilotMessage,
  encodeCopilotMessage,
  copilotStartSchema,
  copilotSessionSchema,
  type CopilotWireMessage,
} from "./copilot-wire";
import { windowsProcessBirth } from "./windows-job";
import type { CopilotClientPort, CopilotSessionPort } from "./copilot-runtime";

if (process.argv[2] !== "--prmonitor-copilot-worker" || !process.send)
  throw new Error("Copilot worker needs its application-owned IPC channel.");
const sessions = new Map<string, CopilotSessionPort>();
const policies = new Map<
  number,
  { resolve(allow: boolean): void; timer: ReturnType<typeof setTimeout> }
>();
const requests = new Set<number>();
let client: Omit<CopilotClientPort, "closeOwnedRuntime"> | undefined;
let activated = false;
let stopping = false;
let sequence = 0;
let openingSession = false;
function die(): never {
  for (const pending of policies.values()) {
    clearTimeout(pending.timer);
    pending.resolve(false);
  }
  policies.clear();
  // A disconnected owner cannot authorize work. The Windows Job kills the
  // tree on owner exit; POSIX ordinary SDK descendants inherit this group.
  if (process.platform !== "win32") {
    try {
      process.kill(-process.pid, "SIGKILL");
    } catch {
      /* No group exists before launch. */
    }
  }
  process.exit(1);
}
process.on("disconnect", die);
process.on("uncaughtException", die);
process.on("unhandledRejection", die);
const activationTimer = setTimeout(die, 10000);
function send(message: CopilotWireMessage): void {
  if (!process.connected || !process.send) die();
  try {
    process.send(encodeCopilotMessage(message), (error) => {
      if (error) die();
    });
  } catch {
    die();
  }
}
async function policy(
  input: {
    sessionId: string;
    workingDirectory: string;
    toolName: string;
    toolArgs: unknown;
  },
  scope: number,
): Promise<boolean> {
  if (stopping || policies.size >= COPILOT_PENDING_LIMIT) return false;
  const id = ++sequence;
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      policies.delete(id);
      resolve(false);
    }, COPILOT_POLICY_TIMEOUT);
    policies.set(id, { resolve, timer });
    try {
      const value = encodeCopilotMessage({
        kind: "policy",
        id,
        scope,
        ...input,
      });
      process.send!(value, (error) => {
        if (error) {
          clearTimeout(timer);
          policies.delete(id);
          resolve(false);
        }
      });
    } catch {
      clearTimeout(timer);
      policies.delete(id);
      resolve(false);
    }
  });
}
const sessionIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u);
function session(payload: unknown): {
  current: CopilotSessionPort;
  input: Record<string, unknown>;
} {
  const input = z
    .object({ sessionId: sessionIdSchema })
    .passthrough()
    .parse(payload);
  const current = sessions.get(input.sessionId);
  if (!current) throw new Error("Unknown Copilot session.");
  return { current, input };
}
async function invoke(method: string, payload: unknown): Promise<unknown> {
  if (method === "start") {
    if (activated || stopping) throw new Error("Worker was already activated.");
    activated = true;
    clearTimeout(activationTimer);
    const options = copilotStartSchema.parse(payload);
    if (
      ![options.executable, options.cwd, options.home].every((value) =>
        path.isAbsolute(value),
      )
    )
      throw new Error("Worker requires absolute runtime paths.");
    // Deliberately import/initialize only after the owner's activation message.
    const { CopilotClient, RuntimeConnection } =
      await import("@prmonitor/provider-runtimes");
    if (stopping) throw new Error("Worker stopped during initialization.");
    client = new CopilotClient({
      connection: RuntimeConnection.forStdio({
        path: options.executable,
        env: options.env,
        args: [
          "--disable-builtin-mcps",
          ...(options.noColor ? ["--no-color"] : []),
        ],
      }),
      workingDirectory: options.cwd,
      baseDirectory: options.home,
      mode: "copilot-cli",
      useLoggedInUser: true,
      builtinPluginDirectories: [],
      logLevel: "none",
    });
    await client.start();
    return null;
  }
  if (method === "stop") {
    stopping = true;
    for (const pending of policies.values()) {
      clearTimeout(pending.timer);
      pending.resolve(false);
    }
    policies.clear();
    // SDK stop is advisory. The owner still kills and awaits its OS tree.
    await client?.stop();
    return null;
  }
  if (!client || stopping) throw new Error("Copilot worker is not ready.");
  switch (method) {
    case "auth": {
      const value = await client.getAuthStatus();
      return {
        isAuthenticated: value.isAuthenticated,
        authType: value.authType,
        host: value.host,
      };
    }
    case "models":
      return (await client.listModels()).map((value) => ({
        id: value.id,
        supportedReasoningEfforts: value.supportedReasoningEfforts,
      }));
    case "hooks": {
      const value = await client.rpc.hooks.discover(
        z
          .object({
            projectPaths: z.array(z.string().max(4096)).length(1),
            excludeHostHooks: z.literal(false),
          })
          .strict()
          .parse(payload),
      );
      return {
        hooks: value.hooks.map((hook) => ({ enabled: hook.enabled })),
        errors: value.errors.map(() => "Managed hook discovery failed."),
      };
    }
    case "tools":
      return client.rpc.tools.list(
        z
          .object({ model: z.string().max(256) })
          .strict()
          .parse(payload),
      );
    case "create":
    case "resume": {
      if (sessions.size || openingSession)
        throw new Error("Only one operation session is allowed.");
      const input = copilotSessionSchema.parse(payload);
      if (method === "resume" && !input.resumeId)
        throw new Error("Missing resume identity.");
      openingSession = true;
      try {
        let boundSessionId = input.resumeId;
        const { copilotSessionOptions } = await import("./copilot-policy");
        const settings = copilotSessionOptions({
          model: input.model,
          workingDirectory: input.root,
          modelReasoningEffort: input.reasoningEffort,
          sandboxMode: input.write ? "workspace-write" : "read-only",
          approvalPolicy: "never",
          networkAccessEnabled: false,
        });
        settings.hooks = {
          onPreToolUse: async (value, invocation) => {
            // No subagent session or cwd drift may borrow the task's authority.
            const allowed =
              boundSessionId === invocation.sessionId &&
              value.sessionId === invocation.sessionId &&
              value.workingDirectory === input.root &&
              (await policy(
                {
                  sessionId: invocation.sessionId,
                  workingDirectory: value.workingDirectory,
                  toolName: value.toolName,
                  toolArgs: value.toolArgs,
                },
                input.scope,
              ));
            return allowed
              ? {}
              : {
                  permissionDecision: "deny",
                  permissionDecisionReason:
                    "PRMonitor denied this task's file-tool request.",
                };
          },
        };
        // Permission requests always retain the existing deny-only handler.
        const current =
          method === "resume"
            ? await client.resumeSession(input.resumeId!, {
                ...settings,
                continuePendingWork: false,
              })
            : await client.createSession(settings);
        sessionIdSchema.parse(current.sessionId);
        boundSessionId = current.sessionId;
        sessions.set(current.sessionId, current);
        return { sessionId: current.sessionId };
      } finally {
        openingSession = false;
      }
    }
    case "model":
      return session(payload).current.rpc.model.getCurrent();
    case "send": {
      const { current, input } = session(payload);
      const prompt = z
        .string()
        .max(1024 * 1024)
        .parse(input.prompt);
      const timeout = z
        .number()
        .int()
        .min(1)
        .max(30 * 60 * 1000)
        .parse(input.timeout);
      const result = await current.sendAndWait(prompt, timeout);
      if (!result) return null;
      if (
        typeof result.data.content !== "string" ||
        Buffer.byteLength(result.data.content) > 256 * 1024
      )
        throw new Error("Copilot answer exceeds its boundary.");
      return { data: { content: result.data.content } };
    }
    case "abort":
      await session(payload).current.abort();
      return null;
    case "disconnect": {
      const { current } = session(payload);
      await current.disconnect();
      sessions.delete(current.sessionId);
      return null;
    }
    default:
      throw new Error("Unsupported worker request.");
  }
}
process.on("message", (raw: unknown) => {
  let message: CopilotWireMessage;
  try {
    message = decodeCopilotMessage(raw);
  } catch {
    die();
  }
  if (message.kind === "policy-result") {
    const pending = policies.get(message.id);
    if (!pending) return; // Late policy replies cannot revive a timed-out request.
    policies.delete(message.id);
    clearTimeout(pending.timer);
    pending.resolve(!stopping && message.allow);
    return;
  }
  if (
    message.kind !== "request" ||
    requests.has(message.id) ||
    requests.size >= COPILOT_PENDING_LIMIT
  )
    die();
  requests.add(message.id);
  void invoke(message.method, message.payload)
    .then(
      (payload) => send({ kind: "reply", id: message.id, ok: true, payload }),
      () => send({ kind: "reply", id: message.id, ok: false }),
    )
    .finally(() => requests.delete(message.id));
});
send({
  kind: "booted",
  pid: process.pid,
  ...(process.platform === "win32" ? { birth: windowsProcessBirth() } : {}),
});
