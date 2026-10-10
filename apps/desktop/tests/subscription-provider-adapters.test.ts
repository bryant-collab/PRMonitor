import { mkdtemp, realpath, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Query, query } from "@prmonitor/provider-runtimes";
import { ConnectionAuthentication } from "../src/main/ai/connection-authentication";
import { createClaudeProvider } from "../src/main/ai/claude-adapter";
import { claudeQueryOptions } from "../src/main/ai/claude-adapter";
import { createCopilotProvider } from "../src/main/ai/copilot-adapter";
import { CopilotCleanupError } from "../src/main/ai/copilot-process";
import {
  copilotProcessFixture,
  processRunning,
  waitFor,
} from "./copilot-fixture";
import {
  checkCopilotSignIn,
  copilotClientOptions,
  type CopilotClientPort,
  type CopilotFactory,
  type CopilotSessionPort,
} from "../src/main/ai/copilot-runtime";
import {
  outputContractForTask,
  type AIProviderRequest,
} from "../src/shared/ai/provider-contracts";
const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const uuid = "0197bec5-f130-7416-9e05-21d028962ef8";
const answer = {
  schemaVersion: 1,
  interaction: "read_only",
  answer: "Fixture answer.",
};
async function fixture(tool: "claude" | "copilot") {
  const root = await mkdtemp(
    path.join(await realpath(tmpdir()), "prmonitor-provider-"),
  );
  roots.push(root);
  const connection = {
    id: "fixture",
    name: "Fixture",
    tool,
    executable: process.execPath,
    extraArgs: [],
    authMode: "subscription" as const,
    signInSource: "existing" as const,
    revision: 1,
  };
  const model = tool === "claude" ? "sonnet" : "gpt-5";
  const auth = new ConnectionAuthentication(path.join(root, "unused"));
  vi.spyOn(auth, "home").mockResolvedValue(root);
  vi.spyOn(auth, "environment").mockReturnValue({ HOME: root });
  vi.spyOn(auth, "check").mockResolvedValue({
    tool,
    executable: process.execPath,
    detected: true,
    compatible: true,
    authentication: "subscription",
    message: "fixture",
  });
  const contract = outputContractForTask("READ_ONLY_CONVERSATION");
  const request: AIProviderRequest = {
    schemaVersion: 1,
    requestId: "request",
    operationId: "operation",
    turnId: "turn",
    providerId: tool,
    modelId: model,
    taskType: "READ_ONLY_CONVERSATION",
    interactionMode: "read_only",
    profileSnapshot: {
      schemaVersion: 1,
      profileId: "conversation",
      profileRevision: 1,
      providerId: tool,
      modelId: model,
      taskType: "READ_ONLY_CONVERSATION",
      reasoningEffort: "medium",
      commonInstructions: "Fixture instruction.",
      repositoryInstructions: "Fixture repository instruction.",
      buildAndValidationInstructions: "Fixture validation instruction.",
      outputContractId: contract.contractId,
      connection,
    },
    executionPolicySnapshot: {
      schemaVersion: 1,
      snapshotHash: "fixture",
      policyId: "READ_ONLY_WORKTREE",
      revision: 1,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccess: "disabled",
      controlledEnvironment: { mode: "explicit", allowedKeys: [] },
    },
    worktree: {
      schemaVersion: 1,
      operationId: "operation",
      worktreeId: "worktree",
      ownerType: "REVIEW_BUNDLE",
      ownerId: "bundle",
      operationKind: "REVIEW",
      canonicalPath: root,
      access: "READ_ONLY",
      ownership: {
        kind: "OPERATION_OWNED",
        ownerType: "REVIEW_BUNDLE",
        ownerId: "bundle",
      },
      actualState: {
        snapshotId: "snapshot",
        stateFingerprint: "state",
        baselineRevision: "base",
        expectedHeadRevision: "head",
        currentHeadRevision: "head",
        files: [],
        ignoredFiles: [],
        complete: true,
      },
      permittedCapabilities: {
        readFiles: true,
        writeFiles: false,
        executeCommands: false,
        network: false,
        publication: false,
      },
    },
    input: {
      schemaVersion: 1,
      remoteEventVersionIds: [],
      contextReferences: [],
      userMessage: "Read the fixture.",
    },
    outputContract: contract,
    invocation: { timeoutMs: 30000, maxOutputBytes: 65536, streamEvents: true },
  };
  return { root, auth, request, connection };
}
function copilotFixture(overrides: Partial<CopilotClientPort> = {}) {
  let settings: unknown;
  const sent = vi.fn(async () => ({
    data: { content: JSON.stringify(answer) },
  }));
  const session: CopilotSessionPort = {
    sessionId: uuid,
    rpc: { model: { getCurrent: async () => ({ modelId: "gpt-5" }) } },
    sendAndWait: sent,
    abort: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
  };
  const client: CopilotClientPort = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    forceStop: vi.fn(async () => {}),
    closeOwnedRuntime: vi.fn(async () => {
      await client.stop();
      await client.forceStop();
    }),
    getAuthStatus: vi.fn(async () => ({
      isAuthenticated: true,
      authType: "user",
      host: "github.com",
    })),
    listModels: vi.fn(async () => [
      { id: "gpt-5", supportedReasoningEfforts: ["medium"] },
    ]),
    rpc: {
      hooks: { discover: vi.fn(async () => ({ hooks: [], errors: [] })) },
      tools: {
        list: vi.fn(async () => ({
          tools: ["view", "glob", "grep"].map((name) => ({
            name,
            parameters: { properties: { path: { type: "string" } } },
          })),
        })),
      },
    },
    createSession: vi.fn(async (value) => {
      settings = value;
      return session;
    }),
    resumeSession: vi.fn(async (_id, value) => {
      settings = value;
      return session;
    }),
    ...overrides,
  };
  const factory: CopilotFactory = vi.fn(() => client);
  return {
    client,
    session,
    sent,
    factory,
    get settings() {
      return settings;
    },
  };
}
describe("actual subscription adapter contracts", () => {
  it("forwards only the selected cosmetic or capability-reducing option without replacing safety settings", async () => {
    const f = await fixture("claude");
    const claude = claudeQueryOptions(
      { ...f.connection, extraArgs: ["--no-chrome"] },
      { HOME: f.root },
      {
        model: "sonnet",
        workingDirectory: f.root,
        sandboxMode: "read-only",
        approvalPolicy: "never",
        networkAccessEnabled: false,
      },
      new AbortController(),
    );
    expect(claude.extraArgs).toMatchObject({
      restricted: null,
      "safe-mode": null,
      "disable-slash-commands": null,
      "no-chrome": null,
    });
    expect(claude).toMatchObject({
      settingSources: [],
      permissionMode: "dontAsk",
      strictMcpConfig: true,
      plugins: [],
    });
    const c = await fixture("copilot");
    const options = copilotClientOptions(
      { ...c.connection, extraArgs: ["--no-color"] },
      { HOME: c.root },
      c.root,
      c.root,
    );
    expect(options).toMatchObject({
      mode: "copilot-cli",
      useLoggedInUser: true,
      logLevel: "none",
      builtinPluginDirectories: [],
      connection: {
        kind: "stdio",
        args: ["--disable-builtin-mcps", "--no-color"],
      },
    });
    expect(
      copilotClientOptions(c.connection, {}, c.root, c.root).connection,
    ).toMatchObject({ args: ["--disable-builtin-mcps"] });
  });
  it("initializes Claude subscription, guard and model before releasing prompt; normalizes strict output and closes", async () => {
    const f = await fixture("claude");
    const close = vi.fn();
    let received = false;
    let options: Parameters<typeof query>[0]["options"];
    const start = vi.fn((input: Parameters<typeof query>[0]) => {
      options = input.options;
      return {
        initializationResult: async () => {
          expect(received).toBe(false);
          return {
            hooks_applied: true,
            account: { apiProvider: "firstParty", apiKeySource: "none" },
            models: [{ value: "sonnet", supportedEffortLevels: ["medium"] }],
          };
        },
        close,
        async *[Symbol.asyncIterator]() {
          for await (const _ of input.prompt as AsyncIterable<unknown>) {
            received = true;
          }
          yield {
            type: "system",
            subtype: "init",
            cwd: f.root,
            apiKeySource: "none",
            permissionMode: "dontAsk",
            tools: ["Read", "Glob", "Grep"],
            mcp_servers: [],
            plugins: [],
            session_id: uuid,
          };
          yield {
            type: "result",
            subtype: "success",
            is_error: false,
            session_id: uuid,
            structured_output: answer,
          };
        },
      } as unknown as Query;
    });
    const provider = createClaudeProvider({
      authentication: f.auth,
      query: start,
      policy: async () => ({ supported: true, reason: "compatible" }),
    });
    const result = await provider.invoke(f.request);
    expect(result, result.error?.detail).toMatchObject({ status: "completed" });
    expect(received).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(options).toMatchObject({
      settingSources: [],
      strictMcpConfig: true,
      plugins: [],
      permissionMode: "dontAsk",
      allowedTools: ["Read", "Glob", "Grep"],
    });
    expect(options!.env).not.toHaveProperty("ANTHROPIC_API_KEY");
  });
  it.each([false, undefined])(
    "Claude requires confirmed hooks_applied=%s before sending any prompt",
    async (hooks) => {
      const f = await fixture("claude");
      let received = false;
      const close = vi.fn();
      const start = ((input: Parameters<typeof query>[0]) =>
        ({
          initializationResult: async () => ({
            hooks_applied: hooks,
            account: { apiProvider: "firstParty", apiKeySource: "none" },
            models: [],
          }),
          close,
          async *[Symbol.asyncIterator]() {
            for await (const value of input.prompt as AsyncIterable<unknown>) {
              received = true;
              yield value;
            }
          },
        }) as unknown as Query) as typeof query;
      const result = await createClaudeProvider({
        authentication: f.auth,
        query: start,
        policy: async () => ({ supported: true, reason: "compatible" }),
      }).invoke(f.request);
      expect(result.status).toBe("failed");
      expect(received).toBe(false);
      expect(close).toHaveBeenCalledOnce();
    },
  );
  it("Copilot checks OAuth, hooks, tool schema and CAPI model before prompt and reapplies restrictions on resume", async () => {
    const f = await fixture("copilot");
    const sdk = copilotFixture();
    const provider = createCopilotProvider({
      authentication: f.auth,
      factory: sdk.factory,
    });
    const first = await provider.invoke(f.request);
    expect(first, first.error?.detail).toMatchObject({ status: "completed" });
    expect(sdk.sent).toHaveBeenCalledOnce();
    expect(sdk.settings).toMatchObject({
      providers: [],
      models: [],
      enableFileHooks: false,
      availableTools: ["builtin:view", "builtin:glob", "builtin:grep"],
      enableHostGitOperations: false,
    });
    expect(sdk.client.forceStop).toHaveBeenCalledOnce();
    const second = await provider.invoke({
      ...f.request,
      conversationContinuation: {
        authorized: true,
        reference: {
          schemaVersion: 1,
          providerId: "copilot",
          opaqueReference: uuid,
          resumable: true,
        },
      },
    });
    expect(second, second.error?.detail).toMatchObject({ status: "completed" });
    expect(sdk.client.resumeSession).toHaveBeenCalledWith(
      uuid,
      expect.objectContaining({
        continuePendingWork: false,
        providers: [],
        enableFileHooks: false,
      }),
    );
  });
  it.each(["api-key", "gh-cli", "token"])(
    "Copilot rejects %s billing routes before creating a session",
    async (authType) => {
      const f = await fixture("copilot");
      const sdk = copilotFixture({
        getAuthStatus: async () => ({
          isAuthenticated: true,
          authType,
          host: "github.com",
        }),
      });
      const result = await createCopilotProvider({
        authentication: f.auth,
        factory: sdk.factory,
      }).invoke(f.request);
      expect(result.status).toBe("failed");
      expect(sdk.client.createSession).not.toHaveBeenCalled();
      expect(sdk.sent).not.toHaveBeenCalled();
      expect(sdk.client.forceStop).toHaveBeenCalledOnce();
    },
  );
  it("Copilot fails closed on enabled or incompletely discovered hooks", async () => {
    const f = await fixture("copilot");
    for (const discovery of [
      { hooks: [{ enabled: true }], errors: [] },
      { hooks: [], errors: ["synthetic failure"] },
    ]) {
      const sdk = copilotFixture();
      vi.spyOn(sdk.client.rpc.hooks, "discover").mockResolvedValue(discovery);
      const result = await createCopilotProvider({
        authentication: f.auth,
        factory: sdk.factory,
      }).invoke(f.request);
      expect(result.status).toBe("failed");
      expect(sdk.sent).not.toHaveBeenCalled();
    }
  });
  it("cancels a hanging SDK startup, bounds cleanup and releases the connection", async () => {
    const f = await fixture("copilot");
    const sdk = copilotFixture({ start: async () => new Promise(() => {}) });
    const controller = new AbortController();
    const invoked = createCopilotProvider({
      authentication: f.auth,
      factory: sdk.factory,
    }).invoke(f.request, { signal: controller.signal });
    await vi.waitFor(() => expect(sdk.factory).toHaveBeenCalled());
    controller.abort();
    expect((await invoked).status).toBe("cancelled");
    const release = await f.auth.acquire(f.connection.id);
    release();
    expect(sdk.client.forceStop).toHaveBeenCalled();
  });
  it("times out readiness instead of accepting a later response", async () => {
    const f = await fixture("copilot");
    const sdk = copilotFixture({ start: async () => new Promise(() => {}) });
    vi.useFakeTimers();
    const checked = checkCopilotSignIn(
      f.connection,
      {},
      f.root,
      undefined,
      sdk.factory,
    );
    await vi.advanceTimersByTimeAsync(15000);
    expect(await checked).toMatchObject({ authentication: "unknown" });
    expect(sdk.client.forceStop).toHaveBeenCalled();
  });
  it.each(["startup-hang", "send-hang"] as const)(
    "cancels %s through the production adapter and releases ownership only after the entire SDK tree closes",
    async (mode) => {
      const f = await fixture("copilot");
      const owned = await copilotProcessFixture(mode);
      roots.push(owned.root);
      vi.mocked(f.auth.home).mockResolvedValue(owned.root);
      vi.mocked(f.auth.environment).mockReturnValue(owned.env);
      vi.mocked(f.auth.check).mockResolvedValue({
        tool: "copilot",
        executable: path.join(owned.root, "runtime.js"),
        detected: true,
        compatible: true,
        authentication: "subscription",
        message: "fixture",
      });
      const controller = new AbortController();
      const provider = createCopilotProvider({
        authentication: f.auth,
        factory: () => owned.client,
      });
      const invoked = provider.invoke(
        {
          ...f.request,
          worktree: { ...f.request.worktree!, canonicalPath: owned.root },
        },
        { signal: controller.signal },
      );
      try {
        const identities = await owned.identities();
        if (mode === "send-hang") {
          await waitFor(
            () => readFile(path.join(owned.root, "sent"), "utf8"),
            (value) => value.length > 0,
          );
        }
        let granted = false;
        const next = f.auth.acquire(f.connection.id).then((release) => {
          granted = true;
          return release;
        });
        expect(granted).toBe(false);
        controller.abort();
        expect((await invoked).status).toBe("cancelled");
        const release = await next;
        for (const pid of identities)
          expect(await processRunning(pid)).toBe(false);
        release();
      } finally {
        await owned.client.closeOwnedRuntime();
      }
    },
    15000,
  );
  it("retains and quarantines ownership when cleanup is unconfirmed, rejecting queued and subsequent work", async () => {
    const f = await fixture("copilot");
    let cleanupEntered!: () => void;
    let failCleanup!: (error: Error) => void;
    const entered = new Promise<void>((resolve) => {
      cleanupEntered = resolve;
    });
    const sdk = copilotFixture({
      closeOwnedRuntime: async () => {
        cleanupEntered();
        await new Promise<void>((_resolve, reject) => {
          failCleanup = reject;
        });
      },
    });
    const quarantine = vi.spyOn(f.auth, "quarantine");
    const invoked = createCopilotProvider({
      authentication: f.auth,
      factory: sdk.factory,
    }).invoke(f.request);
    await entered;
    let granted = false;
    const queued = f.auth.acquire(f.connection.id).then(
      (release) => {
        granted = true;
        release();
      },
      () => "rejected",
    );
    failCleanup(new CopilotCleanupError());
    expect((await invoked).status).toBe("failed");
    expect(await queued).toBe("rejected");
    expect(granted).toBe(false);
    expect(quarantine).toHaveBeenCalledWith(f.connection.id);
    await expect(f.auth.acquire(f.connection.id)).rejects.toBeInstanceOf(
      CopilotCleanupError,
    );
  });
});
