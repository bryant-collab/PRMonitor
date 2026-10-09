import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aiConnectionSchema,
  type AIConnection,
} from "../src/shared/ai-connections";
import {
  checkAITool,
  resolveToolExecutable,
  toolEnvironment,
  nativeExecutableCandidates,
  type ToolCommand,
} from "../src/main/ai/tool-detection";
import {
  codexServerArguments,
  openCodexProtocol,
} from "../src/main/ai/codex-app-server";
import { parseIpcRequest, parseIpcResponse } from "../src/shared/ipc";
import {
  F16PreferencesService,
  createF16PreferencesRepository,
} from "../src/main/f16-preferences-service";
import {
  createPersistenceRepositories,
  initializePersistence,
} from "../src/main/persistence";
import { CodexAdapter } from "../src/main/ai/codex-adapter";

const roots: string[] = [];
it("automatic discovery finds native executables without starting a CLI, checking auth or claiming compatibility", async () => {
  const run = vi.fn<ToolCommand>();
  for (const tool of ["codex", "claude", "copilot"] as const) {
    const status = await checkAITool(
      {
        tool,
        executable: process.execPath,
        extraArgs: [],
        authMode: "subscription",
        detectOnly: true,
      },
      run,
      {},
    );
    expect(status).toMatchObject({
      tool,
      detected: true,
      compatible: false,
      authentication: "unknown",
    });
    expect(status).not.toHaveProperty("version");
    expect(status).not.toHaveProperty("models");
  }
  expect(run).not.toHaveBeenCalled();
});
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const connection: AIConnection = {
  id: "work-codex",
  name: "Work Codex",
  tool: "codex",
  executable: process.execPath,
  extraArgs: ["--no-daemon"],
  authMode: "subscription",
  revision: 1,
};
const command: ToolCommand = async (_executable, args) => ({
  exitCode: 0,
  stdout:
    args[0] === "--version"
      ? "codex-cli 0.156.0"
      : args[0] === "login"
        ? "Logged in using ChatGPT"
        : "--strict-config --no-daemon",
  stderr: "",
});

describe("machine-local AI connections", () => {
  it.each([
    { tool: "codex" as const, option: "--no-daemon", version: "0.156.0" },
    { tool: "claude" as const, option: "--no-chrome", version: "2.1.259" },
    { tool: "copilot" as const, option: "--no-color", version: "1.0.83" },
  ])(
    "accepts only the documented $tool option and requires exact help support",
    async ({ tool, option, version }) => {
      const configured = { ...connection, tool, extraArgs: [option] };
      expect(aiConnectionSchema.safeParse(configured).success).toBe(true);
      expect(
        aiConnectionSchema.safeParse({
          ...configured,
          extraArgs: [option, option],
        }).success,
      ).toBe(false);
      for (const other of ["--no-daemon", "--no-chrome", "--no-color"].filter(
        (arg) => arg !== option,
      ))
        expect(
          aiConnectionSchema.safeParse({ ...configured, extraArgs: [other] })
            .success,
        ).toBe(false);
      const run = vi.fn<ToolCommand>(async (_exe, args) => ({
        exitCode: 0,
        stderr: "",
        stdout:
          args[0] === "--version"
            ? version
            : args[0] === "app-server"
              ? "--strict-config"
              : option,
      }));
      expect(
        await checkAITool(
          {
            tool,
            executable: process.execPath,
            extraArgs: [option],
            authMode: "subscription",
          },
          run,
          {},
        ),
      ).toMatchObject({
        detected: true,
        compatible: true,
        authentication: "missing",
      });
      expect(run.mock.calls.map((call) => call[1]).slice(0, 2)).toEqual([
        ["--version"],
        ["--help"],
      ]);
      run.mockImplementation(async (_exe, args) => ({
        exitCode: 0,
        stderr: "",
        stdout: args[0] === "--version" ? version : `${option}-unrelated`,
      }));
      run.mockClear();
      expect(
        await checkAITool(
          {
            tool,
            executable: process.execPath,
            extraArgs: [option],
            authMode: "subscription",
          },
          run,
          {},
        ),
      ).toMatchObject({ compatible: false, authentication: "unknown" });
      expect(run.mock.calls.map((call) => call[1])).toEqual([
        ["--version"],
        ["--help"],
      ]);
    },
  );
  it("does not enforce subscription login against a shared or absent CLI store", async () => {
    const options = {
      model: "gpt-5-codex",
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
    } as const;
    await expect(openCodexProtocol(connection, {}, options)).rejects.toThrow(
      "PRMonitor sign-in",
    );
    await expect(
      openCodexProtocol(connection, { CODEX_HOME: "relative-store" }, options),
    ).rejects.toThrow("PRMonitor sign-in");
  });
  it("rejects connection IDs that could escape an owned runtime directory", () => {
    for (const id of [".", "..", "../outside", "/outside", "\\outside"])
      expect(aiConnectionSchema.safeParse({ ...connection, id }).success).toBe(
        false,
      );
  });
  it("does not launch probes for cancelled work and stops between probes", async () => {
    const controller = new AbortController();
    controller.abort();
    const run = vi.fn(command);
    await expect(
      checkAITool(
        {
          tool: "codex",
          executable: process.execPath,
          extraArgs: [],
          authMode: "subscription",
        },
        run,
        {},
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
    const during = new AbortController();
    const one = vi.fn(async (...args: Parameters<ToolCommand>) => {
      during.abort();
      return command(...args);
    });
    await expect(
      checkAITool(
        {
          tool: "codex",
          executable: process.execPath,
          extraArgs: [],
          authMode: "subscription",
        },
        one,
        {},
        during.signal,
      ),
    ).rejects.toThrow();
    expect(one).toHaveBeenCalledTimes(1);
  });
  it("finds modern/legacy, nested/hoisted and local Windows npm payloads without executing a shim", () => {
    const global = nativeExecutableCandidates("codex", "C:\\npm\\codex.cmd", {
      platform: "win32",
      arch: "x64",
    });
    expect(global).toContain(
      "C:\\npm\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe",
    );
    expect(global).toContain(
      "C:\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe",
    );
    expect(global).toContain(
      "C:\\npm\\node_modules\\@openai\\codex\\vendor\\x86_64-pc-windows-msvc\\codex\\codex.exe",
    );
    const local = nativeExecutableCandidates(
      "codex",
      "C:\\project\\node_modules\\.bin\\codex.cmd",
      { platform: "win32", arch: "arm64" },
    );
    expect(local).toContain(
      "C:\\project\\node_modules\\@openai\\codex-win32-arm64\\vendor\\aarch64-pc-windows-msvc\\bin\\codex.exe",
    );
    expect(local.join("|")).not.toContain(".bin\\node_modules");
    expect(
      nativeExecutableCandidates("codex", "/usr/bin/codex", {
        platform: "linux",
        arch: "x64",
      }),
    ).toEqual(["/usr/bin/codex"]);
  });
  it("keeps subscription authentication separate from API and publication credentials", () => {
    const source = {
      HOME: "/fixture",
      PATH: "/fixture/bin",
      OPENAI_API_KEY: "fixture-only",
      CODEX_API_KEY: "fixture-only",
      CODEX_ACCESS_TOKEN: "fixture-only",
      OPENAI_BASE_URL: "https://fixture.invalid",
      GITHUB_TOKEN: "fixture-only",
      GH_TOKEN: "fixture-only",
    };
    expect(toolEnvironment("codex", "subscription", source)).toEqual({
      HOME: "/fixture",
      PATH: "/fixture/bin",
    });
    expect(toolEnvironment("codex", "api", source)).toEqual({
      HOME: "/fixture",
      PATH: "/fixture/bin",
      OPENAI_API_KEY: "fixture-only",
    });
  });

  it.each([
    "--dangerously-bypass-approvals-and-sandbox",
    "--sandbox=disabled",
    "--config",
    "-c",
    "--cd",
    "--model",
    "--add-dir",
    "--yolo",
    "--no-daemon;whoami",
    "--no-daemon\n",
  ])("refuses safety, routing and shell overrides: %s", (arg) => {
    expect(
      aiConnectionSchema.safeParse({ ...connection, extraArgs: [arg] }).success,
    ).toBe(false);
  });

  it("passes requested options as literal argv and enforces strict provider configuration", () => {
    const args = codexServerArguments(
      { ...connection, signInSource: "prmonitor" },
      {
        model: "gpt-5-codex",
        sandboxMode: "read-only",
        approvalPolicy: "never",
        networkAccessEnabled: false,
      },
    );
    expect(args[0]).toBe("--no-daemon");
    expect(args.slice(-2)).toEqual(["app-server", "--strict-config"]);
    expect(args).toContain('forced_login_method="chatgpt"');
    expect(args).toContain('model_provider="openai"');
    expect(args).toContain('approval_policy="never"');
    expect(args).toContain("features.hooks=false");
    expect(args).toContain('shell_environment_policy.inherit="none"');
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });
  it("preserves existing CLI login restrictions instead of imposing an account mutation", () => {
    const args = codexServerArguments(connection, {
      model: "gpt-5-codex",
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
    });
    expect(args.some((arg) => arg.startsWith("forced_login_method="))).toBe(
      false,
    );
  });
  it("detects, checks version features and subscription sign-in without a model call", async () => {
    const run = vi.fn(command);
    const result = await checkAITool(
      {
        tool: "codex",
        executable: process.execPath,
        extraArgs: ["--no-daemon"],
        authMode: "subscription",
      },
      run,
      {},
      undefined,
      process.cwd(),
    );
    expect(result).toMatchObject({
      detected: true,
      compatible: true,
      authentication: "subscription",
      version: "0.156.0",
    });
    expect(run.mock.calls.map((call) => call[1])).toEqual([
      ["--version"],
      ["--help"],
      ["app-server", "--help"],
      ["login", "status"],
    ]);
  });

  it("reports incompatible versions and mismatched authentication instead of switching", async () => {
    const run: ToolCommand = async (exe, args, env) =>
      args[0] === "--help"
        ? { exitCode: 0, stdout: "old help", stderr: "" }
        : args[0] === "login"
          ? { exitCode: 0, stdout: "Logged in using API key", stderr: "" }
          : command(exe, args, env);
    const result = await checkAITool(
      {
        tool: "codex",
        executable: process.execPath,
        extraArgs: ["--no-daemon"],
        authMode: "subscription",
      },
      run,
      {},
      undefined,
      process.cwd(),
    );
    expect(result).toMatchObject({
      compatible: false,
      authentication: "unknown",
    });
    const authOnly = await checkAITool(
      {
        tool: "codex",
        executable: process.execPath,
        extraArgs: [],
        authMode: "subscription",
      },
      run,
      {},
      undefined,
      process.cwd(),
    );
    expect(authOnly.message).toContain("will not switch billing methods");
    expect(authOnly).toMatchObject({ compatible: true, authentication: "api" });
  });

  it("does not execute a missing path, relative command or shell shim", async () => {
    const run = vi.fn(command);
    expect(
      await resolveToolExecutable("codex", "relative.exe", {}),
    ).toBeUndefined();
    const result = await checkAITool(
      {
        tool: "codex",
        executable: path.resolve("does-not-exist.exe"),
        extraArgs: [],
        authMode: "subscription",
      },
      run,
      {},
    );
    expect(result.detected).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("validates both IPC directions and rejects extra privileged data", () => {
    const base = {
      schemaVersion: 1,
      requestId: "check-1",
      type: "ai.tools.check",
      payload: { tool: "codex", extraArgs: [], authMode: "subscription" },
    };
    expect(parseIpcRequest(base).ok).toBe(true);
    expect(
      parseIpcRequest({
        ...base,
        payload: { ...base.payload, environment: {} },
      }).ok,
    ).toBe(false);
    expect(
      parseIpcRequest({
        ...base,
        type: "preferences.ai-connection.save",
        payload: {
          expectedSettingsRevision: 0,
          connection,
          useForAllTasks: true,
          modelId: "gpt-5-codex",
        },
      }).ok,
    ).toBe(true);
    expect(
      parseIpcResponse({
        schemaVersion: 1,
        requestId: "check-1",
        ok: true,
        value: {
          kind: "ai-tools",
          view: {
            tools: [
              {
                tool: "codex",
                detected: false,
                compatible: false,
                authentication: "unknown",
                message: "Not found",
              },
            ],
          },
        },
      }),
    ).toBe(true);
  });

  it("migrates existing settings without rewriting old tasks, persists named choices and rejects stale repeated saves", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "prmonitor-connections-"));
    roots.push(root);
    const initialized = await initializePersistence(
      {
        databasePath: path.join(root, "database", "state.sqlite"),
        backupRoot: path.join(root, "backups"),
      },
      { applicationBuild: "connections-test" },
    );
    const repositories = createPersistenceRepositories(initialized);
    const repository = createF16PreferencesRepository(repositories);
    const capabilities = new CodexAdapter({
      runtime: { createClient: vi.fn() },
    }).capabilities;
    const makeService = () =>
      new F16PreferencesService({
        repositories: repository,
        capabilities: { get: () => capabilities },
      });
    try {
      const service = makeService();
      const before = service.readPreferences();
      // Represents a persisted pre-connection v1 record.
      const { aiConnections: _connections, ...legacy } = before;
      const {
        policyPresets: _presets,
        providerModels: _models,
        ...state
      } = legacy;
      repository.commitSettings({
        settings: { ...state, settingsRevision: 1 },
      });
      expect(service.readPreferences().taskProfiles).toEqual(
        before.taskProfiles,
      );
      const saved = service.saveAIConnection({
        expectedSettingsRevision: 1,
        connection,
        useForAllTasks: true,
        modelId: "gpt-5-codex",
      });
      expect(
        saved.taskProfiles.every(
          (profile) =>
            profile.connectionId === connection.id &&
            profile.enabled &&
            profile.availability === "AVAILABLE",
        ),
      ).toBe(true);
      expect(saved.defaultConnectionId).toBe(connection.id);
      expect(makeService().readPreferences()).toEqual(saved);
      expect(() =>
        service.saveAIConnection({
          expectedSettingsRevision: 1,
          connection,
          useForAllTasks: true,
          modelId: "gpt-5-codex",
        }),
      ).toThrow("Preferences changed");
      const distinct = {
        ...connection,
        id: "personal-codex",
        name: "Personal Codex",
        extraArgs: [],
      };
      const added = service.saveAIConnection({
        expectedSettingsRevision: saved.settingsRevision,
        connection: distinct,
        useForAllTasks: false,
        modelId: "gpt-5-codex",
      });
      expect(added.taskProfiles).toEqual(saved.taskProfiles);
      expect(added.aiConnections).toHaveLength(2);
      const selected = added.taskProfiles.find(
        (profile) => profile.taskType === "READ_ONLY_CONVERSATION",
      )!;
      const override = service.saveTaskProfile({
        expectedSettingsRevision: added.settingsRevision,
        profile: {
          taskType: selected.taskType,
          providerId: selected.providerId,
          connectionId: connection.id,
          modelId: selected.modelId,
          reasoningEffort: "high",
          providerOptions: {},
          enabled: false,
        },
      });
      const updated = service.saveAIConnection({
        expectedSettingsRevision: override.settingsRevision,
        connection: { ...connection, name: "Renamed", extraArgs: [] },
        useForAllTasks: true,
        modelId: "gpt-5-codex",
      });
      expect(
        updated.taskProfiles.find(
          (profile) => profile.taskType === selected.taskType,
        ),
      ).toMatchObject({ enabled: false, reasoningEffort: "high" });
      for (const profile of saved.taskProfiles) {
        expect(
          repositories.getF16Revision<{ connection: AIConnection }>(
            "TASK_PROFILE",
            profile.profileId,
            profile.revision,
          )?.payload.connection,
        ).toEqual(connection);
      }
      for (const profile of updated.taskProfiles)
        expect(
          repositories.getF16Revision<{ connection: AIConnection }>(
            "TASK_PROFILE",
            profile.profileId,
            profile.revision,
          )?.payload.connection,
        ).toMatchObject({ name: "Renamed", revision: 2, extraArgs: [] });
    } finally {
      initialized.close();
    }
  });

  it("removes ignored legacy Codex options once while preserving immutable history", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "prmonitor-options-migration-"),
    );
    roots.push(root);
    const initialized = await initializePersistence(
      {
        databasePath: path.join(root, "database", "state.sqlite"),
        backupRoot: path.join(root, "backups"),
      },
      { applicationBuild: "migration-test" },
    );
    const repositories = createPersistenceRepositories(initialized);
    const repository = createF16PreferencesRepository(repositories);
    const capabilities = new CodexAdapter({
      runtime: { createClient: vi.fn() },
    }).capabilities;
    const makeService = () =>
      new F16PreferencesService({
        repositories: repository,
        capabilities: { get: () => capabilities },
      });
    try {
      const service = makeService();
      const {
        policyPresets: _presets,
        providerModels: _models,
        ...initial
      } = service.readPreferences();
      const profiles = initial.taskProfiles.map((profile) => ({
        ...profile,
        providerOptions: { ignoredLegacyOption: true },
        revision: 1,
      }));
      repository.commitSettings({
        settings: { ...initial, settingsRevision: 1, taskProfiles: profiles },
        revisions: profiles.map((profile) => ({
          kind: "TASK_PROFILE",
          id: profile.profileId,
          revision: profile.revision,
          payload: profile,
        })),
      });
      const migrated = service.readPreferences();
      expect(migrated.settingsRevision).toBe(2);
      expect(
        migrated.taskProfiles.every(
          (profile) =>
            profile.revision === 2 &&
            Object.keys(profile.providerOptions).length === 0,
        ),
      ).toBe(true);
      for (const profile of profiles) {
        expect(
          repositories.getF16Revision("TASK_PROFILE", profile.profileId, 1)
            ?.payload,
        ).toEqual(profile);
        expect(
          repositories.getF16Revision<{ providerOptions: object }>(
            "TASK_PROFILE",
            profile.profileId,
            2,
          )?.payload.providerOptions,
        ).toEqual({});
      }
      expect(makeService().readPreferences()).toEqual(migrated);
      expect(repository.readSettings()?.payload.settingsRevision).toBe(2);
    } finally {
      initialized.close();
    }
  });

  it("rolls back all task revisions and the connection if an immutable history row conflicts", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "prmonitor-connection-atomic-"),
    );
    roots.push(root);
    const initialized = await initializePersistence(
      {
        databasePath: path.join(root, "database", "state.sqlite"),
        backupRoot: path.join(root, "backups"),
      },
      { applicationBuild: "atomic-test" },
    );
    const repositories = createPersistenceRepositories(initialized);
    const repository = createF16PreferencesRepository(repositories);
    const capabilities = new CodexAdapter({
      runtime: { createClient: vi.fn() },
    }).capabilities;
    const service = new F16PreferencesService({
      repositories: repository,
      capabilities: { get: () => capabilities },
    });
    try {
      const {
        policyPresets: _presets,
        providerModels: _models,
        ...state
      } = service.readPreferences();
      const last = state.taskProfiles.at(-1)!;
      const conflict = { ...last, revision: last.revision + 1, enabled: false };
      repository.commitSettings({
        settings: { ...state, settingsRevision: 1 },
        revision: {
          kind: "TASK_PROFILE",
          id: last.profileId,
          revision: conflict.revision,
          payload: conflict,
        },
      });
      const before = service.readPreferences();
      expect(() =>
        service.saveAIConnection({
          expectedSettingsRevision: before.settingsRevision,
          connection,
          useForAllTasks: true,
          modelId: "gpt-5-codex",
        }),
      ).toThrow("Preferences changed");
      expect(service.readPreferences()).toEqual(before);
      for (const profile of state.taskProfiles.slice(0, -1))
        expect(
          repositories.getF16Revision(
            "TASK_PROFILE",
            profile.profileId,
            profile.revision + 1,
          ),
        ).toBeUndefined();
      expect(
        repositories.getF16Revision(
          "TASK_PROFILE",
          last.profileId,
          conflict.revision,
        )?.payload,
      ).toEqual(conflict);
    } finally {
      initialized.close();
    }
  });
});
