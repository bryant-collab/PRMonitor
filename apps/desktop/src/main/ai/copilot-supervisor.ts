import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type {
  CopilotClientOptions,
  SessionConfig,
  ResumeSessionConfig,
} from "@prmonitor/provider-runtimes";
import type { CopilotClientPort, CopilotSessionPort } from "./copilot-runtime";
import { CopilotProcess, type CopilotProcessOptions } from "./copilot-process";
export { CopilotProcess } from "./copilot-process";
import {
  COPILOT_PENDING_LIMIT,
  COPILOT_POLICY_TIMEOUT,
  decodeCopilotMessage,
  encodeCopilotMessage,
  copilotStartSchema,
  copilotSessionSchema,
  type CopilotMethod,
  type CopilotWireMessage,
} from "./copilot-wire";

type Scope = {
  root: string;
  sessionId?: string;
  handler: NonNullable<NonNullable<SessionConfig["hooks"]>["onPreToolUse"]>;
};
const workers = new Set<SupervisedCopilotClient>();
let shuttingDown = false;
export const hasCopilotWorkers = (): boolean => workers.size > 0;
function packagedWorker(): string {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  // Rollup shares this module between the application and the exported owner
  // entrypoint. Both entry and chunks layouts resolve to the fixed worker entry.
  return path.join(
    directory,
    path.basename(directory) === "chunks" ? ".." : ".",
    "copilot-worker.js",
  );
}
export async function shutdownCopilotWorkers(): Promise<void> {
  shuttingDown = true;
  await Promise.allSettled(
    [...workers].map((worker) => worker.closeOwnedRuntime()),
  );
}
export interface CopilotSupervisorOptions {
  worker?: string;
  createJob?: CopilotProcessOptions["createJob"];
  cleanupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}
/** Production RPC proxy. Only the worker calls SDK APIs; only this owner kills trees. */
export class SupervisedCopilotClient implements CopilotClientPort {
  private owner?: CopilotProcess;
  private sequence = 0;
  private closing = false;
  private initialized = false;
  private cleanup?: Promise<void>;
  private lastPolicy = 0;
  private activePolicies = 0;
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  private readonly scopes = new Map<number, Scope>();
  private bootResolve?: () => void;
  private bootReject?: (error: Error) => void;
  constructor(
    private readonly options: CopilotClientOptions,
    private readonly supervisor: CopilotSupervisorOptions = {},
  ) {}
  private error(): Error {
    return new Error(
      "Copilot supervised runtime stopped or rejected a bounded request.",
    );
  }
  private send(message: CopilotWireMessage): void {
    const child = this.owner?.child;
    if (!child?.connected) throw this.error();
    child.send(encodeCopilotMessage(message), (error) => {
      if (error) this.fail();
    });
  }
  private fail(): void {
    this.bootReject?.(this.error());
    for (const pending of this.pending.values()) pending.reject(this.error());
    this.pending.clear();
    void this.forceStop().catch(() => {});
  }
  private request(
    method: CopilotMethod,
    payload: unknown = null,
  ): Promise<unknown> {
    if (
      (this.closing && method !== "stop") ||
      this.pending.size >= COPILOT_PENDING_LIMIT ||
      !this.owner
    )
      return Promise.reject(this.error());
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.send({ kind: "request", id, method, payload });
      } catch {
        this.pending.delete(id);
        reject(this.error());
        this.fail();
      }
    });
  }
  async start(): Promise<void> {
    if (this.owner || this.closing || shuttingDown) throw this.error();
    const connection = this.options.connection;
    if (
      connection?.kind !== "stdio" ||
      !connection.path ||
      !this.options.workingDirectory ||
      !this.options.baseDirectory
    )
      throw new Error("Copilot needs an explicit owned stdio configuration.");
    const args = connection.args ?? [];
    if (
      args.some(
        (arg) => !["--disable-builtin-mcps", "--no-color"].includes(arg),
      ) ||
      !args.includes("--disable-builtin-mcps")
    )
      throw new Error(
        "Copilot launch options changed outside its safety contract.",
      );
    const configuration = copilotStartSchema.parse({
      executable: connection.path,
      cwd: this.options.workingDirectory,
      home: this.options.baseDirectory,
      env: connection.env ?? {},
      noColor: args.includes("--no-color"),
    });
    if (
      ![configuration.executable, configuration.cwd, configuration.home].every(
        (value) => path.isAbsolute(value),
      )
    )
      throw this.error();
    this.owner = new CopilotProcess({
      worker: this.supervisor.worker ?? packagedWorker(),
      cwd: configuration.cwd,
      env: configuration.env,
      createJob: this.supervisor.createJob,
      cleanupTimeoutMs: this.supervisor.cleanupTimeoutMs,
    });
    workers.add(this);
    const booted = new Promise<void>((resolve, reject) => {
      this.bootResolve = resolve;
      this.bootReject = reject;
    });
    const timer = setTimeout(() => {
      this.bootReject?.(this.error());
      this.fail();
    }, 5000);
    this.owner.child.on("message", (raw: unknown) => {
      let message: CopilotWireMessage;
      try {
        message = decodeCopilotMessage(raw);
      } catch {
        this.fail();
        return;
      }
      if (message.kind === "booted") {
        if (this.initialized || this.closing) {
          this.fail();
          return;
        }
        try {
          this.owner!.activate(message.pid, message.birth);
        } catch {
          this.fail();
          return;
        }
        this.initialized = true;
        this.bootResolve?.();
        return;
      }
      if (message.kind === "reply") {
        const pending = this.pending.get(message.id);
        if (!pending) return; // Late replies cannot revive cancelled work.
        this.pending.delete(message.id);
        if (message.ok) pending.resolve(message.payload);
        else pending.reject(this.error());
        return;
      }
      if (message.kind === "policy") {
        void this.decide(message).catch(() => this.fail());
        return;
      }
      this.fail();
    });
    this.owner.child.once("error", () => this.fail());
    this.owner.child.once("close", () => {
      if (!this.closing) this.fail();
    });
    this.owner.child.once("disconnect", () => {
      if (!this.closing) this.fail();
    });
    try {
      await booted;
      if (this.closing) throw this.error();
      await this.request("start", configuration);
    } finally {
      clearTimeout(timer);
      this.bootResolve = undefined;
      this.bootReject = undefined;
    }
  }
  private async decide(
    message: Extract<CopilotWireMessage, { kind: "policy" }>,
  ): Promise<void> {
    if (message.id <= this.lastPolicy) {
      this.fail();
      return;
    }
    this.lastPolicy = message.id;
    const scope = this.scopes.get(message.scope);
    let allow = false;
    if (
      !this.closing &&
      scope &&
      scope.root === message.workingDirectory &&
      scope.sessionId === message.sessionId &&
      this.activePolicies < COPILOT_PENDING_LIMIT
    ) {
      this.activePolicies++;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // Charge the real validator until it settles, including after timeout.
        // A timeout denies this request; it cannot make another pending host
        // validator fit inside the cap or give a late result authority.
        const checked = Promise.resolve()
          .then(() =>
            scope.handler(
              {
                sessionId: message.sessionId,
                timestamp: new Date(),
                workingDirectory: message.workingDirectory,
                toolName: message.toolName,
                toolArgs: message.toolArgs,
              },
              { sessionId: message.sessionId },
            ),
          )
          .catch(() => ({ permissionDecision: "deny" as const }))
          .finally(() => {
            this.activePolicies--;
          });
        const decision = await Promise.race([
          checked,
          new Promise<undefined>((resolve) => {
            timer = setTimeout(
              () => resolve(undefined),
              COPILOT_POLICY_TIMEOUT,
            );
          }),
        ]);
        allow =
          !this.closing &&
          this.scopes.get(message.scope) === scope &&
          decision !== undefined &&
          (!decision.permissionDecision ||
            decision.permissionDecision === "allow") &&
          decision.modifiedArgs === undefined &&
          decision.additionalContext === undefined;
      } catch {
        allow = false;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    if (this.owner?.child.connected)
      this.send({ kind: "policy-result", id: message.id, allow });
  }
  stop(): Promise<unknown> {
    return this.owner && this.initialized
      ? this.request("stop")
      : Promise.resolve();
  }
  forceStop(): Promise<void> {
    return this.closeOwnedRuntime(false);
  }
  closeOwnedRuntime(graceful = true): Promise<void> {
    return (this.cleanup ??= this.close(graceful));
  }
  private async close(graceful: boolean): Promise<void> {
    this.closing = true;
    this.bootReject?.(this.error());
    for (const pending of this.pending.values()) pending.reject(this.error());
    this.pending.clear();
    this.scopes.clear();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (graceful && this.initialized && this.owner?.child.connected) {
        await Promise.race([
          this.stop().catch(() => {}),
          new Promise<void>((resolve) => {
            timer = setTimeout(
              resolve,
              this.supervisor.shutdownTimeoutMs ?? 2000,
            );
          }),
        ]);
      }
    } finally {
      if (timer) clearTimeout(timer);
      try {
        await this.owner?.close();
        workers.delete(this);
      } finally {
        for (const pending of this.pending.values())
          pending.reject(this.error());
        this.pending.clear();
      }
    }
  }
  async getAuthStatus() {
    return z
      .object({
        isAuthenticated: z.boolean(),
        authType: z.string().max(128).optional(),
        host: z.string().max(1024).optional(),
      })
      .parse(await this.request("auth"));
  }
  async listModels() {
    return z
      .array(
        z.object({
          id: z.string().max(256),
          supportedReasoningEfforts: z
            .array(z.string().max(32))
            .max(16)
            .optional(),
        }),
      )
      .max(512)
      .parse(await this.request("models"));
  }
  readonly rpc = {
    hooks: {
      discover: async (input: {
        projectPaths: string[];
        excludeHostHooks: boolean;
      }) =>
        z
          .object({
            hooks: z.array(z.object({ enabled: z.boolean() })).max(512),
            errors: z.array(z.string().max(4096)).max(512),
          })
          .parse(await this.request("hooks", input)),
    },
    tools: {
      list: async (input: { model: string }) =>
        z
          .object({
            tools: z
              .array(
                z.object({
                  name: z.string().max(128),
                  parameters: z.record(z.unknown()).optional(),
                }),
              )
              .max(512),
          })
          .parse(await this.request("tools", input)),
    },
  };
  createSession(input: SessionConfig): Promise<CopilotSessionPort> {
    return this.openSession(input);
  }
  resumeSession(
    id: string,
    input: ResumeSessionConfig,
  ): Promise<CopilotSessionPort> {
    return this.openSession(input, id);
  }
  private async openSession(
    input: SessionConfig | ResumeSessionConfig,
    resumeId?: string,
  ): Promise<CopilotSessionPort> {
    if (
      this.scopes.size ||
      !input.hooks?.onPreToolUse ||
      !input.workingDirectory ||
      !input.model
    )
      throw this.error();
    const scopeId = ++this.sequence;
    const scope: Scope = {
      root: input.workingDirectory,
      sessionId: resumeId,
      handler: input.hooks.onPreToolUse,
    };
    this.scopes.set(scopeId, scope);
    const configuration = copilotSessionSchema.parse({
      scope: scopeId,
      root: input.workingDirectory,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      write:
        Array.isArray(input.availableTools) &&
        input.availableTools.includes("builtin:edit"),
      resumeId,
    });
    try {
      const result = z
        .object({
          sessionId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u),
        })
        .parse(
          await this.request(resumeId ? "resume" : "create", configuration),
        );
      scope.sessionId = result.sessionId;
      const payload = { sessionId: result.sessionId };
      return {
        sessionId: result.sessionId,
        rpc: {
          model: {
            getCurrent: async () =>
              z
                .object({ modelId: z.string().max(256).optional() })
                .parse(await this.request("model", payload)),
          },
        },
        sendAndWait: async (prompt, timeout = 30 * 60 * 1000) => {
          const response = await this.request("send", {
            ...payload,
            prompt,
            timeout,
          });
          return response == null
            ? undefined
            : z
                .object({
                  data: z.object({
                    content: z
                      .string()
                      .refine(
                        (value) => Buffer.byteLength(value) <= 256 * 1024,
                      ),
                  }),
                })
                .parse(response);
        },
        abort: async () => {
          await this.request("abort", payload);
        },
        disconnect: async () => {
          try {
            await this.request("disconnect", payload);
          } finally {
            this.scopes.delete(scopeId);
          }
        },
      };
    } catch (error) {
      this.scopes.delete(scopeId);
      throw error;
    }
  }
}
