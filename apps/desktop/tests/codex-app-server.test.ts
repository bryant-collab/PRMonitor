import { spawn, type ChildProcess } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertCodexFileEnvironment,
  codexApplicationConfig,
  openCodexProtocol,
  createCodexAppServerClient,
  type CodexProtocol,
} from "../src/main/ai/codex-app-server";
import { ConnectionAuthentication } from "../src/main/ai/connection-authentication";
import { CopilotCleanupError } from "../src/main/ai/copilot-process";
import type { AIConnection } from "../src/shared/ai-connections";
import {
  CodexAdapter,
  type CodexThreadOptions,
} from "../src/main/ai/codex-adapter";

const connection: AIConnection = {
  id: "Work",
  name: "Work",
  tool: "codex",
  executable: process.execPath,
  extraArgs: [],
  authMode: "subscription",
  signInSource: "prmonitor",
  revision: 1,
};
const id = "0197bec5-f130-7416-9e05-21d028962ef8";
const options: CodexThreadOptions = {
  model: "gpt-5-codex",
  modelReasoningEffort: "high",
  sandboxMode: "read-only",
  workingDirectory: process.cwd(),
  networkAccessEnabled: false,
  approvalPolicy: "never",
};
const configuration = {
  config: {
    approval_policy: "never",
    approvals_reviewer: "user",
    model_provider: "openai",
    web_search: "disabled",
    allow_login_shell: false,
    features: {
      hooks: false,
      plugins: false,
      apps: false,
      shell_snapshot: false,
    },
    shell_environment_policy: { inherit: "none", set: {}, include_only: [] },
  },
};
function fixture(overrides: Record<string, unknown> = {}) {
  const request = vi.fn(
    async (method: string, _params?: Record<string, unknown> | null) => {
      if (method in overrides) return overrides[method];
      if (method === "getAuthStatus")
        return {
          authMethod: "chatgpt",
          authToken: null,
          requiresOpenaiAuth: true,
        };
      if (method === "account/read") return { account: { type: "chatgpt" } };
      if (method === "configRequirements/read") return { requirements: null };
      if (method === "config/read") return configuration;
      if (method === "model/list")
        return {
          data: [
            {
              id: "gpt-5-codex",
              model: "gpt-5-codex",
              supportedReasoningEfforts: [{ reasoningEffort: "high" }],
            },
          ],
        };
      if (method === "thread/start" || method === "thread/resume")
        return {
          thread: { id },
          cwd: options.workingDirectory,
          model: options.model,
          modelProvider: "openai",
          approvalPolicy: "never",
          approvalsReviewer: "user",
          sandbox: { type: "readOnly", networkAccess: false },
        };
      if (method === "turn/start") return { turn: { id: "turn-1" } };
      throw Error("Unexpected fixture request");
    },
  );
  const close = vi.fn(async () => {});
  const protocol: CodexProtocol = {
    request,
    close,
    async *notifications() {
      yield {
        method: "item/completed",
        params: {
          threadId: id,
          turnId: "other-turn",
          item: { type: "agentMessage", text: "wrong turn" },
        },
      };
      yield {
        method: "item/completed",
        params: {
          threadId: id,
          turnId: "turn-1",
          item: { type: "agentMessage", text: '{"schemaVersion":1}' },
        },
      };
      yield {
        method: "turn/completed",
        params: { threadId: id, turn: { id: "turn-1", status: "completed" } },
      };
    },
  };
  return { protocol, request, close };
}
async function collect(protocol: CodexProtocol, resume = false) {
  const client = createCodexAppServerClient(connection, async () => protocol);
  const thread = resume
    ? client.resumeThread(id, options)
    : client.startThread(options);
  const run = await thread.runStreamed("Owned deterministic prompt", {
    outputSchema: { type: "object" },
  });
  const events = [];
  for await (const event of run.events) events.push(event);
  return events;
}
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
describe("Codex public app-server contract", () => {
  it("checks billing and effective policy before applying explicit resumed permissions and structured output", async () => {
    const f = fixture();
    expect(await collect(f.protocol, true)).toEqual([
      { type: "thread.started", thread_id: id },
      { type: "turn.started" },
      {
        type: "item.completed",
        item: { type: "agent_message", text: '{"schemaVersion":1}' },
      },
      { type: "turn.completed" },
    ]);
    expect(f.request.mock.calls.map(([method]) => method)).toEqual([
      "getAuthStatus",
      "account/read",
      "configRequirements/read",
      "config/read",
      "model/list",
      "thread/resume",
      "turn/start",
    ]);
    expect(f.request).toHaveBeenCalledWith("account/read", {
      refreshToken: false,
    });
    expect(f.request).toHaveBeenCalledWith(
      "thread/resume",
      expect.objectContaining({
        threadId: id,
        sandbox: "read-only",
        approvalPolicy: "never",
        approvalsReviewer: "user",
        cwd: options.workingDirectory,
      }),
    );
    expect(f.request).toHaveBeenCalledWith(
      "turn/start",
      expect.objectContaining({
        sandboxPolicy: { type: "readOnly", networkAccess: false },
        outputSchema: { type: "object" },
        effort: "high",
      }),
    );
    expect(f.close).toHaveBeenCalledTimes(1);
  });
  it("rejects API fallback before creating a thread and reaps the owned server", async () => {
    const f = fixture({ "account/read": { account: { type: "apiKey" } } });
    await expect(collect(f.protocol)).rejects.toThrow(
      "will not switch methods",
    );
    expect(f.request.mock.calls.map(([method]) => method)).toEqual([
      "getAuthStatus",
      "account/read",
    ]);
    expect(f.close).toHaveBeenCalledTimes(1);
  });
  it.each([
    { authMethod: "apikey", authToken: null, requiresOpenaiAuth: true },
    { authMethod: "headers", authToken: null, requiresOpenaiAuth: true },
    { authMethod: "chatgpt", authToken: null, requiresOpenaiAuth: false },
    {
      authMethod: "chatgpt",
      authToken: "synthetic-not-a-real-secret",
      requiresOpenaiAuth: true,
    },
  ])(
    "refuses a different authentication contract before sending task context",
    async (auth) => {
      const f = fixture({ getAuthStatus: auth });
      await expect(collect(f.protocol)).rejects.toThrow(
        "will not switch methods",
      );
      expect(f.request.mock.calls.map(([method]) => method)).toEqual([
        "getAuthStatus",
      ]);
      expect(f.close).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["mcp_servers", "hooks", "plugins", "apps", "model_providers"])(
    "refuses inherited %s before creating a thread",
    async (key) => {
      const f = fixture({
        "config/read": {
          config: {
            ...configuration.config,
            [key]:
              key === "model_providers"
                ? { openai: { base_url: "https://invalid.example" } }
                : { inherited: {} },
          },
        },
      });
      await expect(collect(f.protocol)).rejects.toThrow("additional tools");
      expect(
        f.request.mock.calls.some(([method]) => method.startsWith("thread/")),
      ).toBe(false);
      expect(f.close).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    { approvalPolicy: "on-request" },
    { approvalsReviewer: "auto_review" },
    { cwd: path.dirname(process.cwd()) },
    { modelProvider: "custom" },
    { sandbox: { type: "dangerFullAccess" } },
    { sandbox: { type: "readOnly", networkAccess: true } },
  ])(
    "refuses a broadened thread before the first turn: %j",
    async (changed) => {
      const initial = fixture();
      const response = await initial.request("thread/start");
      const f = fixture({
        "thread/start": {
          ...(response as Record<string, unknown>),
          ...changed,
        },
      });
      await expect(collect(f.protocol)).rejects.toThrow();
      expect(
        f.request.mock.calls.some(([method]) => method === "turn/start"),
      ).toBe(false);
      expect(f.close).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    { featureRequirements: { hooks: true } },
    { hooks: { SessionStart: [{ hooks: [{}] }] } },
    { allowLoginShell: true },
    { allowedLoginMethods: ["api"] },
  ])(
    "refuses effective managed requirements despite safe raw config: %j",
    async (requirements) => {
      const f = fixture({ "configRequirements/read": { requirements } });
      await expect(collect(f.protocol)).rejects.toThrow(/Managed Codex/u);
      expect(f.request).toHaveBeenCalledWith("configRequirements/read", null);
      expect(
        f.request.mock.calls.some(([method]) => method.startsWith("thread/")),
      ).toBe(false);
      expect(f.close).toHaveBeenCalledTimes(1);
    },
  );
  it("uses the model invocation identifier and follows bounded hidden-model pages", async () => {
    const f = fixture();
    const normal = f.request.getMockImplementation()!;
    let pages = 0;
    f.request.mockImplementation(async (method) => {
      if (method !== "model/list") return normal(method);
      ++pages;
      return pages === 1
        ? {
            data: [{ id: options.model, model: "other-model" }],
            nextCursor: "owned-page-2",
          }
        : {
            data: [
              {
                id: "record-id",
                model: options.model,
                supportedReasoningEfforts: [{ reasoningEffort: "high" }],
              },
            ],
          };
    });
    await collect(f.protocol);
    expect(pages).toBe(2);
    expect(f.request).toHaveBeenCalledWith("model/list", {
      includeHidden: true,
      limit: 100,
      cursor: "owned-page-2",
    });
  });
  it("checks actual model capabilities before starting a thread", async () => {
    const f = fixture({
      "model/list": {
        data: [
          {
            id: "gpt-5-codex",
            supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
          },
        ],
      },
    });
    await expect(collect(f.protocol)).rejects.toThrow(
      "model or reasoning effort",
    );
    expect(
      f.request.mock.calls.some(([method]) => method.startsWith("thread/")),
    ).toBe(false);
    expect(f.close).toHaveBeenCalledTimes(1);
  });
  it("requires an absent execution-environment file without changing the existing store", async () => {
    const root = await mkdtemp(
      path.join(await realpath(tmpdir()), "prmonitor-environment-"),
    );
    roots.push(root);
    await expect(
      assertCodexFileEnvironment({ CODEX_HOME: root }),
    ).resolves.toBeUndefined();
    const file = path.join(root, "environments.toml");
    await writeFile(file, "fixture environment sentinel");
    await expect(
      assertCodexFileEnvironment({ CODEX_HOME: root }),
    ).rejects.toThrow("configures execution environments");
    expect(await readFile(file, "utf8")).toBe("fixture environment sentinel");
  });
  it("attests empty environments on new and cold-resumed file-only threads", async () => {
    for (const resume of [false, true]) {
      const fileConfig = codexApplicationConfig(options, true);
      const features = Object.fromEntries(
        Object.entries(fileConfig)
          .filter(([key]) => key.startsWith("features."))
          .map(([key, value]) => [key.slice(9), value]),
      );
      const f = fixture({
        "config/read": { config: { ...configuration.config, features } },
        "thread/start": {
          thread: { id, environments: [] },
          cwd: options.workingDirectory,
          model: options.model,
          modelProvider: "openai",
          approvalPolicy: "never",
          approvalsReviewer: "user",
          sandbox: { type: "readOnly", networkAccess: false },
        },
        "thread/resume": {
          thread: { id, environments: [] },
          cwd: options.workingDirectory,
          model: options.model,
          modelProvider: "openai",
          approvalPolicy: "never",
          approvalsReviewer: "user",
          sandbox: { type: "readOnly", networkAccess: false },
        },
      });
      f.protocol.setFileToolHandler = vi.fn();
      const client = createCodexAppServerClient(
        connection,
        async () => f.protocol,
        true,
      );
      const thread = resume
        ? client.resumeThread(id, options)
        : client.startThread(options);
      const events = await thread.runStreamed("fixture", { outputSchema: {} });
      for await (const _event of events.events) {
        /* Completion remains bound to fixture thread/turn. */
      }
      const call = f.request.mock.calls.find(
        ([method]) => method === (resume ? "thread/resume" : "thread/start"),
      );
      const params = call?.[1] as Record<string, unknown>;
      if (resume) {
        expect(params).not.toHaveProperty("environments");
        expect(params).not.toHaveProperty("dynamicTools");
      } else {
        expect(params.environments).toEqual([]);
        expect(params.dynamicTools).toHaveLength(1);
      }
      expect(f.request).toHaveBeenCalledWith(
        "turn/start",
        expect.objectContaining({ environments: [], approvalPolicy: "never" }),
      );
    }
  });
  it.each([undefined, null, [{ id: "native" }]])(
    "rejects a missing or broadened environment attestation before sending input: %j",
    async (environments) => {
      const fileConfig = codexApplicationConfig(options, true);
      const features = Object.fromEntries(
        Object.entries(fileConfig)
          .filter(([key]) => key.startsWith("features."))
          .map(([key, value]) => [key.slice(9), value]),
      );
      const initial = fixture();
      const response = await initial.request("thread/start");
      const f = fixture({
        "config/read": { config: { ...configuration.config, features } },
        "thread/start": {
          ...(response as Record<string, unknown>),
          thread: { id, environments },
        },
      });
      f.protocol.setFileToolHandler = vi.fn();
      const stream = await createCodexAppServerClient(
        connection,
        async () => f.protocol,
        true,
      )
        .startThread(options)
        .runStreamed("fixture", { outputSchema: {} });
      await expect(
        (async () => {
          for await (const _ of stream.events) {
            /* Must fail before prompt. */
          }
        })(),
      ).rejects.toThrow("execution environment");
      expect(
        f.request.mock.calls.some(([method]) => method === "turn/start"),
      ).toBe(false);
    },
  );
  it("executes only the current host-file callback and replays identical call IDs without repeating edits", async () => {
    const root = await mkdtemp(
      path.join(await realpath(tmpdir()), "prmonitor-codex-files-"),
    );
    roots.push(root);
    await writeFile(path.join(root, "file.txt"), "hello");
    const opt = {
      ...options,
      workingDirectory: root,
      sandboxMode: "workspace-write" as const,
    };
    const fileConfig = codexApplicationConfig(opt, true);
    const features = Object.fromEntries(
      Object.entries(fileConfig)
        .filter(([key]) => key.startsWith("features."))
        .map(([key, value]) => [key.slice(9), value]),
    );
    const f = fixture({
      "config/read": { config: { ...configuration.config, features } },
      "thread/start": {
        thread: { id, environments: [] },
        cwd: root,
        model: opt.model,
        modelProvider: "openai",
        approvalPolicy: "never",
        approvalsReviewer: "user",
        sandbox: {
          type: "workspaceWrite",
          networkAccess: false,
          writableRoots: [root],
          excludeSlashTmp: true,
          excludeTmpdirEnvVar: true,
        },
      },
    });
    let handler: NonNullable<CodexProtocol["setFileToolHandler"]> extends (
      value: infer H,
    ) => void
      ? H
      : never;
    f.protocol.setFileToolHandler = (value) => {
      handler = value;
    };
    f.protocol.notifications = async function* () {
      const params = {
        threadId: id,
        turnId: "turn-1",
        callId: "file-call",
        namespace: "prmonitor_files",
        tool: "edit_file",
        arguments: { path: "file.txt", old: "hello", replacement: "world" },
      };
      expect((await handler({ ...params, turnId: "other" })).success).toBe(
        false,
      );
      expect((await handler(params)).success).toBe(true);
      expect((await handler(params)).success).toBe(true);
      await expect(
        handler({
          ...params,
          arguments: { path: "file.txt", old: "world", replacement: "bad" },
        }),
      ).rejects.toThrow("changed arguments");
      yield {
        method: "turn/completed",
        params: {
          threadId: id,
          turnId: "turn-1",
          turn: { id: "turn-1", status: "completed" },
        },
      };
    };
    const stream = await createCodexAppServerClient(
      connection,
      async () => f.protocol,
      true,
    )
      .startThread(opt)
      .runStreamed("fixture", { outputSchema: {} });
    for await (const _ of stream.events) {
      /* Drain normalized completion. */
    }
    expect(await readFile(path.join(root, "file.txt"), "utf8")).toBe("world");
    expect(f.close).toHaveBeenCalledOnce();
  });
});
describe("provider-owned connection storage and refresh serialization", () => {
  it("reuses the existing CLI directory without reading or modifying credentials or creating ownership files", async () => {
    const root = await mkdtemp(
      path.join(await realpath(tmpdir()), "prmonitor-existing-store-"),
    );
    roots.push(root);
    const store = path.join(root, "terminal");
    await mkdir(store);
    const sentinel = path.join(store, "auth.json");
    await writeFile(sentinel, "synthetic credential sentinel");
    const run = vi.fn(
      async (
        _exe: string,
        args: readonly string[],
        env: Record<string, string>,
      ) => {
        expect(env.CODEX_HOME).toBe(store);
        expect(env).not.toHaveProperty("OPENAI_API_KEY");
        expect(env).not.toHaveProperty("GH_TOKEN");
        expect(env).not.toHaveProperty("OPENAI_BASE_URL");
        return {
          exitCode: 0,
          stdout:
            args[0] === "login" ? "" : "codex-cli 0.156.0 --strict-config",
          stderr: args[0] === "login" ? "Logged in using ChatGPT" : "",
        };
      },
    );
    const auth = new ConnectionAuthentication(
      path.join(root, "unused-app-store"),
      {
        CODEX_HOME: store,
        OPENAI_API_KEY: "synthetic-api-sentinel",
        GH_TOKEN: "synthetic-publication-sentinel",
        OPENAI_BASE_URL: "https://invalid.example",
      },
      run,
    );
    const existing = { ...connection, signInSource: "existing" as const };
    expect(await auth.home(existing, true)).toBe(store);
    expect(await auth.check(existing)).toMatchObject({
      authentication: "subscription",
      compatible: true,
    });
    expect(await readdir(store)).toEqual(["auth.json"]);
    expect(await readFile(sentinel, "utf8")).toBe(
      "synthetic credential sentinel",
    );
    await expect(auth.signIn(existing)).rejects.toThrow("Browser sign-in");
  });
  it("creates case-safe named stores with nonsecret ownership metadata and never copies existing credentials", async () => {
    const root = await mkdtemp(
      path.join(await realpath(tmpdir()), "prmonitor-auth-fixture-"),
    );
    roots.push(root);
    const source = path.join(root, "terminal-store");
    await writeFile(source, "fixture sentinel");
    const auth = new ConnectionAuthentication(path.join(root, "app"), {
      CODEX_HOME: source,
    });
    expect(await auth.home(connection)).toBeUndefined();
    const home = await auth.home(connection, true);
    const other = await auth.home({ ...connection, id: "work" }, true);
    expect(home).not.toBe(other);
    expect(await readFile(source, "utf8")).toBe("fixture sentinel");
    expect(auth.environment(connection, home!)).toEqual({ CODEX_HOME: home });
    await writeFile(path.join(home!, ".prmonitor-connection-owner.json"), "{}");
    await expect(auth.home(connection)).rejects.toThrow("different connection");
  });
  it("rejects an existing linked storage root before authorizing a provider store", async () => {
    const root = await mkdtemp(
      path.join(await realpath(tmpdir()), "prmonitor-auth-link-"),
    );
    roots.push(root);
    const link = path.join(root, "linked");
    await symlink(
      root,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    const auth = new ConnectionAuthentication(link);
    await expect(auth.home(connection, true)).rejects.toThrow(
      "unsupported path or link",
    );
  });
  it("reports configured runtime separately from per-task permissions", async () => {
    const auth = new ConnectionAuthentication(process.cwd());
    const status = vi.spyOn(auth, "check").mockResolvedValue({
      tool: "codex",
      executable: process.execPath,
      detected: true,
      compatible: true,
      authentication: "subscription",
      message: "fixture",
    });
    const provider = new CodexAdapter({ connectionAuthentication: auth });
    expect(await provider.readLocalReadiness(connection)).toEqual({
      runtimeAvailable: true,
      authenticationAvailable: true,
    });
    expect(status).toHaveBeenCalledTimes(1);
  });
  it("serializes sign-in/turn ownership per connection; queued cancellation cannot release running work", async () => {
    const auth = new ConnectionAuthentication(process.cwd());
    const first = await auth.acquire("Work");
    const cancel = new AbortController();
    const second = auth.acquire("Work", cancel.signal);
    const secondError = expect(second).rejects.toThrow("cancelled");
    cancel.abort();
    await secondError;
    let granted = false;
    const third = auth.acquire("Work").then((release) => {
      granted = true;
      return release;
    });
    const independent = await auth.acquire("Home");
    await Promise.resolve();
    expect(granted).toBe(false);
    first();
    first();
    const release = await third;
    expect(granted).toBe(true);
    release();
    independent();
    auth.dispose();
  });
});

describe("owned provider process cleanup", () => {
  it("bounds a standalone Copilot check waiting for task ownership without starting another provider", async () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const auth = new ConnectionAuthentication(process.cwd(), {}, run);
    const selected = { ...connection, tool: "copilot" as const };
    const home = vi.spyOn(auth, "home");
    const owner = await auth.acquire(selected.id);
    try {
      const check = auth.check(selected);
      await vi.advanceTimersByTimeAsync(15000);
      expect(await check).toMatchObject({
        authentication: "unknown",
        compatible: false,
        workReadiness: "blocked",
      });
      expect(home).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
      let granted = false;
      const queued = auth.acquire(selected.id).then((release) => {
        granted = true;
        return release;
      });
      await Promise.resolve();
      expect(granted).toBe(false);
      owner();
      (await queued)();
      expect(granted).toBe(true);
    } finally {
      owner();
      auth.dispose();
      vi.useRealTimers();
    }
  });
  it("serializes standalone Copilot checks with the task owner and rejects quarantine occurring during home resolution", async () => {
    const auth = new ConnectionAuthentication(process.cwd(), {}, vi.fn());
    const selected = { ...connection, tool: "copilot" as const };
    let resolveHome!: (home: undefined) => void;
    const home = vi.spyOn(auth, "home").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveHome = resolve;
        }),
    );
    const owner = await auth.acquire(selected.id);
    const standalone = auth.check(selected).catch((error) => error);
    await Promise.resolve();
    expect(home).not.toHaveBeenCalled();
    const held = auth.check(selected, undefined, true).catch((error) => error);
    await vi.waitFor(() => expect(home).toHaveBeenCalledOnce());
    auth.quarantine(selected.id);
    resolveHome(undefined);
    expect(await held).toBeInstanceOf(CopilotCleanupError);
    expect(await standalone).toBeInstanceOf(Error);
    expect(home).toHaveBeenCalledOnce();
    await expect(auth.acquire(selected.id)).rejects.toBeInstanceOf(
      CopilotCleanupError,
    );
    owner();
  });
  it("coalesces sign-in and releases a connection only after its cancelled process closes", async () => {
    const root = await mkdtemp(
      path.join(await realpath(tmpdir()), "prmonitor-login-process-"),
    );
    roots.push(root);
    const ready = path.join(root, "ready");
    let child: ChildProcess | undefined;
    const launch = vi.fn(
      (
        program: string,
        args: readonly string[],
        spawnOptions: Parameters<typeof spawn>[2],
      ) => {
        expect(program).toBe(process.execPath);
        expect(args).toEqual([
          "--config",
          'forced_login_method="chatgpt"',
          "login",
        ]);
        expect(spawnOptions).toMatchObject({ shell: false, stdio: "ignore" });
        child = spawn(
          process.execPath,
          [
            "-e",
            "process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.argv[1],'ready');setInterval(()=>{},1000)",
            ready,
          ],
          spawnOptions,
        );
        return child;
      },
    ) as unknown as typeof spawn;
    const run = async () => ({
      exitCode: 0,
      stdout: "codex-cli 0.156.0 --strict-config",
      stderr: "",
    });
    const auth = new ConnectionAuthentication(
      path.join(root, "owned"),
      {},
      run,
      launch,
    );
    const first = auth.signIn(connection);
    expect(auth.signIn(connection)).toBe(first);
    const rejected = expect(first).rejects.toThrow("Sign-in did not complete");
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        await readFile(ready);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    expect(await readFile(ready, "utf8")).toBe("ready");
    auth.cancel(connection.id);
    await rejected;
    expect(child?.exitCode !== null || child?.signalCode !== null).toBe(true);
    const release = await auth.acquire(connection.id);
    release();
    auth.dispose();
  });
  it("times out provider sign-in without accepting a late success or exposing child diagnostics", async () => {
    const root = await mkdtemp(
      path.join(await realpath(tmpdir()), "prmonitor-login-timeout-"),
    );
    roots.push(root);
    const launch = ((
      _program: string,
      _args: readonly string[],
      spawnOptions: Parameters<typeof spawn>[2],
    ) =>
      spawn(
        process.execPath,
        [
          "-e",
          "process.stderr.write('private fixture diagnostics');setTimeout(()=>process.exit(0),5000)",
        ],
        spawnOptions,
      )) as typeof spawn;
    const auth = new ConnectionAuthentication(
      path.join(root, "owned"),
      {},
      async () => ({
        exitCode: 0,
        stdout: "codex-cli 0.156.0 --strict-config",
        stderr: "",
      }),
      launch,
      40,
    );
    await expect(auth.signIn(connection)).rejects.toThrow(
      "Sign-in did not complete",
    );
    const release = await auth.acquire(connection.id);
    release();
    auth.dispose();
  });
  it.skipIf(process.platform === "win32")(
    "matches bounded stdio responses and rejects ungranted server approval requests",
    async () => {
      const root = await mkdtemp(
        path.join(await realpath(tmpdir()), "prmonitor-server-process-"),
      );
      roots.push(root);
      const source =
        "const r=require('node:readline').createInterface({input:process.stdin});r.on('line',line=>{const x=JSON.parse(line);if(x.method==='initialize')console.log(JSON.stringify({id:x.id,result:{}}));else if(x.method==='owned/echo')console.log(JSON.stringify({id:x.id,result:x.params}));else if(x.method==='owned/approval')console.log(JSON.stringify({id:99,method:'item/commandExecution/requestApproval',params:{private:'fixture'}}));});";
      let child: ChildProcess | undefined;
      const launch = ((
        _program: string,
        args: readonly string[],
        spawnOptions: Parameters<typeof spawn>[2],
      ) => {
        expect(args.slice(-2)).toEqual(["app-server", "--strict-config"]);
        expect(spawnOptions).toMatchObject({
          shell: false,
          cwd: root,
          env: { CODEX_HOME: root },
        });
        child = spawn(process.execPath, ["-e", source], spawnOptions);
        return child;
      }) as typeof spawn;
      const protocol = await openCodexProtocol(
        connection,
        { CODEX_HOME: root },
        options,
        undefined,
        launch,
      );
      expect(await protocol.request("owned/echo", { owned: true })).toEqual({
        owned: true,
      });
      await expect(protocol.request("owned/approval", {})).rejects.toThrow(
        "ungranted authority",
      );
      await protocol.close();
      expect(child?.exitCode !== null || child?.signalCode !== null).toBe(true);
    },
  );
});
