// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AIConnections } from "../src/renderer/AIConnections";
import { Preferences } from "../src/renderer/Preferences";
import {
  SetupFooter,
  setupInitialStep,
  type SetupStep,
} from "../src/renderer/SetupScreen";
import {
  SETUP_CHECK_IDS,
  type SetupReadinessProjection,
} from "../src/shared/setup-readiness";
import {
  HelpButton,
  HelpInput,
  HelpSummary,
} from "../src/renderer/HelpControls";
import {
  defaultF16Preferences,
  type F16PreferencesReadModel,
} from "../src/shared/f16-preferences";
import { f16PolicyPresetSummaries } from "../src/shared/f16-preferences";
import type {
  AIConnection,
  AIToolCheckInput,
} from "../src/shared/ai-connections";
import type { IpcResponse } from "../src/shared/ipc";

const connection: AIConnection = {
  id: "work",
  name: "Work",
  tool: "codex",
  executable: "/fixture/custom-codex",
  extraArgs: [],
  authMode: "subscription",
  signInSource: "prmonitor",
  revision: 1,
};
function preferences(): F16PreferencesReadModel {
  const value = defaultF16Preferences();
  return {
    ...value,
    policyPresets: f16PolicyPresetSummaries(),
    providerModels: {
      codex: [
        { modelId: "gpt-5-codex", reasoningEfforts: ["low", "medium", "high"] },
        { modelId: "task-draft-model", reasoningEfforts: ["medium", "high"] },
      ],
    },
    aiConnections: [
      connection,
      {
        ...connection,
        id: "personal",
        name: "Personal",
        executable: "/fixture/personal-codex",
      },
    ],
    defaultConnectionId: connection.id,
    taskProfiles: value.taskProfiles.map((profile) => ({
      ...profile,
      connectionId: connection.id,
    })),
  };
}
function reply(value: unknown): IpcResponse {
  return {
    schemaVersion: 1,
    requestId: "fixture",
    ok: true,
    value,
  } as IpcResponse;
}
function checked(input: AIToolCheckInput, version = "0.156.0"): IpcResponse {
  return reply({
    kind: "ai-tools",
    view: {
      tools: [
        {
          tool: input.tool,
          executable: input.executable ?? "/fixture/path-codex",
          detected: true,
          compatible: !input.detectOnly,
          authentication: input.detectOnly ? "unknown" : "subscription",
          ...(input.detectOnly ? {} : { version }),
          message: `Checked ${input.executable ?? "detected program"}`,
        },
      ],
    },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document
    .querySelectorAll('[role="tooltip"]')
    .forEach((node) => node.remove());
  vi.restoreAllMocks();
});
function bridge(value: Record<string, unknown>) {
  Object.defineProperty(window, "prmonitor", { configurable: true, value });
}
async function mount(element: ReturnType<typeof createElement>) {
  await act(async () => root.render(element));
}
function button(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === text,
  );
  expect(found, text).toBeDefined();
  return found!;
}
function field(
  label: string,
): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const node = [...host.querySelectorAll("label")].find(
    (node) =>
      [...node.childNodes]
        .filter((child) => child.nodeType === 3)
        .map((child) => child.textContent)
        .join(" ")
        .trim() === label,
  );
  expect(node, label).toBeDefined();
  return node!.querySelector("input,select,textarea")!;
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
async function change(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) {
  await act(async () => {
    const prototype =
      element.tagName === "SELECT"
        ? HTMLSelectElement.prototype
        : element.tagName === "TEXTAREA"
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      element,
      value,
    );
    element.dispatchEvent(
      new Event(element.tagName === "SELECT" ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
}

describe("instruction creation baseline", () => {
  it("adopts the new persisted identity and requires edits before another save", async () => {
    const before = preferences();
    const created = {
      schemaVersion: 1 as const,
      profileId: "instruction-fixture",
      name: "Review rule",
      instructionText: "Read the supplied context.",
      enabled: true,
      revision: 1,
      contentHash: "a".repeat(64),
    };
    const after = {
      ...before,
      settingsRevision: before.settingsRevision + 1,
      commonInstructionProfiles: [created],
    };
    const save = vi.fn(async () =>
      reply({ kind: "preferences", preferences: after }),
    );
    bridge({
      readPreferences: async () =>
        reply({ kind: "preferences", preferences: before }),
      saveCommonInstruction: save,
      checkAITools: async (input: AIToolCheckInput) => checked(input),
    });
    await mount(
      createElement(Preferences, {
        enabled: true,
        visible: true,
        category: "instructions",
      }),
    );
    await change(field("Profile name"), created.name);
    await change(field("Instruction text"), created.instructionText);
    await click(button("Create instruction"));
    expect(save).toHaveBeenCalledTimes(1);
    expect(button("Save instruction revision").disabled).toBe(true);
    await click(button("Save instruction revision"));
    expect(save).toHaveBeenCalledTimes(1);
    await change(field("Profile name"), "Edited review rule");
    expect(button("Save instruction revision").disabled).toBe(false);
  });
});

describe("default connection scope", () => {
  it("refreshes the saved global scope after an advanced task changes connections", async () => {
    bridge({ checkAITools: async (input: AIToolCheckInput) => checked(input) });
    const before = preferences();
    const saved = vi.fn();
    await mount(
      createElement(AIConnections, { preferences: before, onSaved: saved }),
    );
    expect(
      (field("Use this connection for all tasks") as HTMLInputElement).checked,
    ).toBe(true);
    const after = {
      ...before,
      settingsRevision: before.settingsRevision + 1,
      taskProfiles: before.taskProfiles.map((profile, index) =>
        index
          ? profile
          : {
              ...profile,
              connectionId: "personal",
              revision: profile.revision + 1,
            },
      ),
    };
    await mount(
      createElement(AIConnections, { preferences: after, onSaved: saved }),
    );
    expect(
      (field("Use this connection for all tasks") as HTMLInputElement).checked,
    ).toBe(false);
    expect(button("Save connection").disabled).toBe(true);
    await click(field("Use this connection for all tasks"));
    expect(button("Save connection").disabled).toBe(false);
    await change(field("Connection name"), "Unsaved connection name");
    await mount(
      createElement(AIConnections, { preferences: before, onSaved: saved }),
    );
    expect(field("Connection name").value).toBe("Unsaved connection name");
    expect(
      (field("Use this connection for all tasks") as HTMLInputElement).checked,
    ).toBe(true);
  });
});

describe("provider-managed connection sign-in", () => {
  it("ignores a saved-program failure after the launch draft changes", async () => {
    const pending = deferred<IpcResponse>();
    bridge({
      checkAITools: (input: AIToolCheckInput) =>
        input.connectionId ? pending.promise : Promise.resolve(checked(input)),
    });
    await mount(
      createElement(AIConnections, {
        preferences: preferences(),
        onSaved: vi.fn(),
      }),
    );
    await change(field("Program"), "/fixture/unsaved-codex");
    await act(async () => pending.reject(Error("synthetic saved failure")));
    expect(field("Program").value).toBe("/fixture/unsaved-codex");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).not.toContain("could not be checked");
  });
  it("ignores rejected saved-check and program-discovery replies from a hidden previous AI view", async () => {
    const saved = deferred<IpcResponse>();
    const discovery = deferred<IpcResponse>();
    let firstSaved = true;
    let firstDiscovery = true;
    bridge({
      checkAITools: (input: AIToolCheckInput) => {
        if (input.connectionId && firstSaved) {
          firstSaved = false;
          return saved.promise;
        }
        if (!input.connectionId && input.tool === "claude" && firstDiscovery) {
          firstDiscovery = false;
          return discovery.promise;
        }
        return Promise.resolve(checked(input));
      },
    });
    const props = { preferences: preferences(), onSaved: vi.fn() };
    await mount(createElement(AIConnections, { ...props, active: true }));
    await mount(createElement(AIConnections, { ...props, active: false }));
    await mount(createElement(AIConnections, { ...props, active: true }));
    await act(async () => {
      saved.reject(Error("synthetic saved failure"));
      discovery.reject(Error("synthetic discovery failure"));
    });
    expect(host.textContent).toContain("Version: unknown");
    expect(host.textContent).toContain("Sign-in: unknown");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).not.toContain("could not be checked");
  });
  it("does not check programs while settings are hidden or another category is open, and retains unsaved launch choices", async () => {
    const check = vi.fn(async (input: AIToolCheckInput) => checked(input));
    bridge({
      readPreferences: async () =>
        reply({ kind: "preferences", preferences: preferences() }),
      checkAITools: check,
    });
    await mount(
      createElement(Preferences, {
        enabled: true,
        visible: false,
        category: "tasks",
      }),
    );
    expect(check).not.toHaveBeenCalled();
    await mount(
      createElement(Preferences, {
        enabled: true,
        visible: true,
        category: "instructions",
      }),
    );
    expect(check).not.toHaveBeenCalled();
    await mount(
      createElement(Preferences, {
        enabled: true,
        visible: true,
        category: "tasks",
      }),
    );
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: connection.id,
        detectOnly: true,
      }),
    );
    await change(field("Program"), "/fixture/unsaved-codex");
    const calls = check.mock.calls.length;
    await mount(
      createElement(Preferences, {
        enabled: true,
        visible: false,
        category: "tasks",
      }),
    );
    expect(check).toHaveBeenCalledTimes(calls);
    await mount(
      createElement(Preferences, {
        enabled: true,
        visible: true,
        category: "tasks",
      }),
    );
    expect(field("Program").value).toBe("/fixture/unsaved-codex");
    expect(
      check.mock.calls.filter(
        ([input]) => input.connectionId === connection.id,
      ),
    ).toHaveLength(1);
    expect(host.textContent).not.toContain("Version: 0.156.0");
  });
  it("uses only the saved connection identity, coalesces sign-in and permits cancellation", async () => {
    const pending = deferred<IpcResponse>();
    const signIn = vi.fn(() => pending.promise);
    const cancel = vi.fn(async () =>
      checked({
        tool: "codex",
        executable: connection.executable,
        extraArgs: [],
        authMode: "subscription",
      }),
    );
    const check = vi.fn(async (input: AIToolCheckInput) => checked(input));
    bridge({
      checkAITools: check,
      signInAIConnection: signIn,
      cancelAIConnectionSignIn: cancel,
    });
    await mount(
      createElement(AIConnections, {
        preferences: preferences(),
        onSaved: vi.fn(),
      }),
    );
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: connection.id,
        executable: connection.executable,
      }),
    );
    expect(button("Sign in for PRMonitor").disabled).toBe(false);
    await click(button("Sign in for PRMonitor"));
    await click(button("Sign in for PRMonitor"));
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(signIn).toHaveBeenCalledWith({
      connectionId: connection.id,
      expectedSettingsRevision: preferences().settingsRevision,
    });
    expect(host.textContent).toContain(
      "Complete Codex sign-in in your browser",
    );
    await click(button("Cancel sign-in"));
    expect(cancel).toHaveBeenCalledWith({
      connectionId: connection.id,
      expectedSettingsRevision: preferences().settingsRevision,
    });
    await act(async () =>
      pending.resolve(
        checked({
          tool: "codex",
          executable: connection.executable,
          extraArgs: [],
          authMode: "subscription",
        }),
      ),
    );
    expect(host.textContent).not.toContain("Cancel sign-in");
    expect(host.textContent).toContain("Cancelling sign-in");
    await change(field("Program"), "/fixture/other-codex");
    expect(button("Sign in for PRMonitor").disabled).toBe(true);
    await click(button("Check program and sign-in"));
    expect(check.mock.calls.at(-1)?.[0]).not.toHaveProperty("connectionId");
  });
  it("lists only detected programs and keeps manual Browse separate", async () => {
    bridge({
      checkAITools: async (input: AIToolCheckInput) =>
        input.connectionId || input.tool === "codex"
          ? checked(input)
          : reply({
              kind: "ai-tools",
              view: {
                tools: [
                  {
                    tool: input.tool,
                    detected: false,
                    compatible: false,
                    authentication: "unknown",
                    message: "Program not found.",
                  },
                ],
              },
            }),
    });
    await mount(
      createElement(AIConnections, {
        preferences: preferences(),
        onSaved: vi.fn(),
      }),
    );
    const choice = field("AI tool") as HTMLSelectElement;
    expect([...choice.options].map((option) => option.value)).toEqual([
      "",
      "codex",
    ]);
    await change(choice, "codex");
    expect(field("Program").value).toBe("/fixture/path-codex");
    await change(field("Program type for Browse"), "claude");
    expect(choice.value).toBe("");
    expect(field("Program").value).toBe("");
    expect(button("Browse for program").disabled).toBe(false);
    expect(
      [...host.querySelectorAll("button")].some(
        (value) => value.textContent === "Sign in for PRMonitor",
      ),
    ).toBe(false);
  });
  it("retains a missing saved connection without adding it to detected programs", async () => {
    bridge({
      checkAITools: async (input: AIToolCheckInput) =>
        reply({
          kind: "ai-tools",
          view: {
            tools: [
              {
                tool: input.tool,
                detected: false,
                compatible: false,
                authentication: "unknown",
                message: "Program not found.",
              },
            ],
          },
        }),
    });
    await mount(
      createElement(AIConnections, {
        preferences: preferences(),
        onSaved: vi.fn(),
      }),
    );
    const choice = field("AI tool") as HTMLSelectElement;
    expect(choice.disabled).toBe(true);
    expect([...choice.options].map((option) => option.value)).toEqual([""]);
    expect(host.textContent).toContain("No programs detected");
    expect(host.textContent).toContain("Its settings are retained");
    expect(field("Connection name").value).toBe(connection.name);
    expect(field("Program").value).toBe(connection.executable);
    expect(button("Save connection").disabled).toBe(true);
    await change(field("Saved connection"), "personal");
    expect(field("Connection name").value).toBe("Personal");
    expect(field("Program").value).toBe("/fixture/personal-codex");
    expect(button("Browse for program").disabled).toBe(false);
  });
  it("keeps discovery loading until every scan settles when another scan rejects", async () => {
    const pending = deferred<IpcResponse>();
    bridge({
      checkAITools: async (input: AIToolCheckInput) => {
        if (input.connectionId) return checked(input);
        if (input.tool === "codex") throw Error("synthetic discovery failure");
        if (input.tool === "claude") return pending.promise;
        return checked(input);
      },
    });
    await mount(
      createElement(AIConnections, {
        preferences: preferences(),
        onSaved: vi.fn(),
      }),
    );
    expect(host.textContent).toContain("Looking for installed programs");
    expect(host.textContent).not.toContain("No programs detected");
    expect((field("AI tool") as HTMLSelectElement).disabled).toBe(true);
    expect(button("Browse for program").disabled).toBe(false);
    await act(async () =>
      pending.resolve(
        checked({
          tool: "claude",
          extraArgs: [],
          authMode: "subscription",
          detectOnly: true,
        }),
      ),
    );
    expect((field("AI tool") as HTMLSelectElement).disabled).toBe(false);
    expect(host.textContent).toContain("Programs could not be checked");
    expect(
      [...(field("AI tool") as HTMLSelectElement).options].map(
        (option) => option.value,
      ),
    ).toEqual(["", "claude", "copilot"]);
  });
  it("removes old detected choices when reopening fails without losing an unsaved program draft", async () => {
    let fail = false;
    bridge({
      checkAITools: async (input: AIToolCheckInput) => {
        if (fail) throw Error("synthetic unavailable discovery");
        return checked(input);
      },
    });
    const props = { preferences: preferences(), onSaved: vi.fn() };
    await mount(createElement(AIConnections, props));
    expect((field("AI tool") as HTMLSelectElement).options.length).toBe(4);
    await change(field("Program"), "/fixture/unsaved-codex");
    await mount(createElement(AIConnections, { ...props, active: false }));
    fail = true;
    await mount(createElement(AIConnections, { ...props, active: true }));
    const choice = field("AI tool") as HTMLSelectElement;
    expect(choice.disabled).toBe(true);
    expect([...choice.options].map((option) => option.value)).toEqual([""]);
    expect(field("Program").value).toBe("/fixture/unsaved-codex");
    expect(button("Browse for program").disabled).toBe(false);
  });
  it("offers manual Browse while discovery is pending and when no program is detected", async () => {
    const discovery = deferred<IpcResponse>();
    let loading = true;
    const check = vi.fn(async (input: AIToolCheckInput) => {
      if (input.detectOnly && loading) return discovery.promise;
      return checked(input);
    });
    const save = vi.fn(async () =>
      reply({ kind: "preferences", preferences: preferences() }),
    );
    bridge({
      checkAITools: check,
      saveAIConnection: save,
      pickAIProgram: async () =>
        reply({ kind: "ai-program", path: "/fixture/browsed-claude" }),
    });
    const empty = {
      ...preferences(),
      aiConnections: [],
      defaultConnectionId: undefined,
    };
    await mount(
      createElement(AIConnections, { preferences: empty, onSaved: vi.fn() }),
    );
    expect(host.textContent).toContain("Looking for installed programs");
    expect((field("AI tool") as HTMLSelectElement).disabled).toBe(true);
    expect(button("Browse for program").disabled).toBe(false);
    loading = false;
    await act(async () =>
      discovery.resolve(reply({ kind: "ai-tools", view: { tools: [] } })),
    );
    expect(host.textContent).toContain("No programs detected");
    await change(field("Program type for Browse"), "claude");
    await click(button("Browse for program"));
    expect(field("Program").value).toBe("/fixture/browsed-claude");
    expect(check).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tool: "claude",
        executable: "/fixture/browsed-claude",
        extraArgs: [],
        authMode: "subscription",
      }),
    );
    expect(check.mock.calls.at(-1)?.[0]).not.toHaveProperty("detectOnly");
    await click(button("Save connection"));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: expect.objectContaining({
          tool: "claude",
          executable: "/fixture/browsed-claude",
        }),
      }),
    );
  });
});

describe("connection renderer interactions", () => {
  it.each(["github", "ai", "permissions", "review"] as const)(
    "gates the %s setup step on saved checks and coalesces repeated navigation",
    async (step: SetupStep) => {
      const ready: SetupReadinessProjection = {
        schemaVersion: 1,
        revision: 1,
        ready: true,
        completedCount: 5,
        checks: SETUP_CHECK_IDS.map((id) => ({
          id,
          status: "complete",
          description: "Fixture check passed",
          remediation:
            id === "github-access"
              ? "github"
              : id === "working-policy"
                ? "policy"
                : id === "local-prerequisites"
                  ? "local"
                  : "ai",
        })),
      };
      const relevant =
        step === "github"
          ? "github-access"
          : step === "ai"
            ? "ai-access"
            : step === "permissions"
              ? "working-policy"
              : "local-prerequisites";
      const incomplete: SetupReadinessProjection = {
        ...ready,
        ready: false,
        completedCount: 4,
        checks: ready.checks.map((check) =>
          check.id === relevant ? { ...check, status: "incomplete" } : check,
        ),
      };
      const onStep = vi.fn();
      const onFinish = vi.fn();
      const onRetry = vi.fn();
      const props = { step, loading: false, onStep, onFinish, onRetry };
      await mount(
        createElement(SetupFooter, { ...props, readiness: incomplete }),
      );
      const label = step === "review" ? "Finish setup" : "Next";
      expect(button(label).disabled).toBe(true);
      expect(host.querySelector("#setup-step-help")?.textContent).toContain(
        step === "review" ? "every saved setup check passes" : "Save this step",
      );
      await click(button(label));
      expect(onStep).not.toHaveBeenCalled();
      expect(onFinish).not.toHaveBeenCalled();
      await mount(
        createElement(SetupFooter, {
          ...props,
          readiness: ready,
          error: "Fixture read unavailable",
        }),
      );
      expect(button(label).disabled).toBe(true);
      expect(host.textContent).toContain("Check saved setup to retry");
      await mount(
        createElement(SetupFooter, {
          ...props,
          readiness: ready,
          loading: true,
        }),
      );
      expect(button(label).disabled).toBe(true);
      await mount(createElement(SetupFooter, { ...props, readiness: ready }));
      await act(async () => {
        button(label).click();
        button(label).click();
      });
      expect(step === "review" ? onFinish : onStep).toHaveBeenCalledTimes(1);
      if (step !== "review") expect(onFinish).not.toHaveBeenCalled();
      expect(setupInitialStep(incomplete)).toBe(step);
    },
  );
  it("checks the saved executable, clears status on switching, and ignores a stale connection reply", async () => {
    const personal = deferred<IpcResponse>();
    const run = vi.fn(async (input: AIToolCheckInput) =>
      input.executable === "/fixture/personal-codex"
        ? personal.promise
        : checked(input, input.executable ? "0.156.0" : "0.100.0"),
    );
    bridge({ checkAITools: run });
    await mount(
      createElement(AIConnections, {
        preferences: preferences(),
        onSaved: vi.fn(),
      }),
    );
    expect(host.textContent).toContain("Version: unknown");
    await click(button("Check program and sign-in"));
    expect(host.textContent).toContain("Version: 0.156.0");
    await change(field("Saved connection"), "personal");
    expect(run.mock.calls.at(-1)?.[0]).toMatchObject({ detectOnly: true });
    expect(host.textContent).not.toContain("Version: 0.156.0");
    await change(field("Program"), "/fixture/another-codex");
    await act(async () =>
      personal.resolve(
        checked(
          {
            tool: "codex",
            executable: "/fixture/personal-codex",
            extraArgs: [],
            authMode: "subscription",
          },
          "0.999.0",
        ),
      ),
    );
    expect(host.textContent).not.toContain("0.999.0");
    expect(field("Program").value).toBe("/fixture/another-codex");
  });

  it("tracks the all-tasks choice as dirty and discards it without saving", async () => {
    const save = vi.fn();
    bridge({
      checkAITools: async (input: AIToolCheckInput) => checked(input),
      saveAIConnection: save,
    });
    await mount(
      createElement(AIConnections, {
        preferences: preferences(),
        onSaved: vi.fn(),
      }),
    );
    expect(button("Save connection").disabled).toBe(true);
    const all = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await click(all);
    expect(button("Save connection").disabled).toBe(false);
    await click(button("Discard changes"));
    expect(all.checked).toBe(true);
    expect(button("Save connection").disabled).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it("coalesces repeated save clicks and drops the callback after unmount", async () => {
    const pending = deferred<IpcResponse>();
    const saved = vi.fn();
    const save = vi.fn(() => pending.promise);
    bridge({
      checkAITools: async (input: AIToolCheckInput) => checked(input),
      saveAIConnection: save,
    });
    await mount(
      createElement(AIConnections, {
        preferences: preferences(),
        onSaved: saved,
      }),
    );
    await change(field("Connection name"), "Renamed");
    const target = button("Save connection");
    await act(async () => {
      target.click();
      target.click();
    });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () =>
      root.render(createElement("p", null, "Navigated away")),
    );
    await act(async () =>
      pending.resolve(
        reply({ kind: "preferences", preferences: preferences() }),
      ),
    );
    expect(saved).not.toHaveBeenCalled();
    expect(host.textContent).toBe("Navigated away");
  });

  it("retains connection and task drafts through setup/category navigation and a connection save", async () => {
    const before = preferences();
    const pending = deferred<IpcResponse>();
    bridge({
      readPreferences: async () =>
        reply({ kind: "preferences", preferences: before }),
      checkAITools: async (input: AIToolCheckInput) => checked(input),
      saveAIConnection: () => pending.promise,
    });
    await mount(
      createElement(Preferences, {
        enabled: true,
        visible: true,
        category: "tasks",
      }),
    );
    await change(field("Connection name"), "Unfinished name");
    await change(field("Model"), "gpt-5-codex");
    await mount(
      createElement(Preferences, {
        enabled: true,
        visible: false,
        category: "policy",
      }),
    );
    expect(
      (host.querySelector(".preferences-panel") as HTMLElement).hidden,
    ).toBe(true);
    await mount(
      createElement(Preferences, {
        enabled: true,
        visible: true,
        category: "tasks",
      }),
    );
    expect(
      (host.querySelector(".preferences-panel") as HTMLElement).hidden,
    ).toBe(false);
    expect(field("Connection name").value).toBe("Unfinished name");
    await change(field("Model"), "task-draft-model");
    await click(button("Save connection"));
    const after = {
      ...before,
      settingsRevision: 1,
      aiConnections: before.aiConnections!.map((value) =>
        value.id === connection.id
          ? { ...value, name: "Unfinished name", revision: 2 }
          : value,
      ),
      taskProfiles: before.taskProfiles.map((profile) => ({
        ...profile,
        revision: profile.revision + 1,
      })),
    };
    await act(async () =>
      pending.resolve(reply({ kind: "preferences", preferences: after })),
    );
    expect(field("Model").value).toBe("task-draft-model");
  });

  it("keeps a newer saved task when an older connection check returns model metadata", async () => {
    const before = preferences();
    const pending = deferred<IpcResponse>();
    const save = vi.fn(async (_input: unknown) =>
      reply({
        kind: "preferences",
        preferences: {
          ...before,
          settingsRevision: 1,
          taskProfiles: before.taskProfiles.map((profile) =>
            profile.taskType === "AUTOMATIC_REVIEW_REEVALUATION"
              ? {
                  ...profile,
                  modelId: "task-draft-model",
                  revision: profile.revision + 1,
                }
              : profile,
          ),
        },
      }),
    );
    bridge({
      readPreferences: async () =>
        reply({ kind: "preferences", preferences: before }),
      checkAITools: (input: AIToolCheckInput) =>
        input.connectionId === "work" && !input.detectOnly
          ? pending.promise
          : Promise.resolve(checked(input)),
      saveTaskProfile: save,
    });
    await mount(
      createElement(Preferences, {
        enabled: true,
        visible: true,
        category: "tasks",
      }),
    );
    await click(button("Check program and sign-in"));
    await change(field("AI task"), "AUTOMATIC_REVIEW_REEVALUATION");
    await change(field("Model"), "task-draft-model");
    await click(button("Save task profile"));
    expect(save).toHaveBeenCalledOnce();
    const response = checked({
      tool: "codex",
      executable: connection.executable,
      extraArgs: [],
      authMode: "subscription",
    });
    if (!response.ok || response.value.kind !== "ai-tools")
      throw Error("Fixture mismatch");
    response.value.view.tools[0]!.models = [
      { modelId: "gpt-5-codex", reasoningEfforts: ["medium"] },
      { modelId: "task-draft-model", reasoningEfforts: ["medium"] },
    ];
    await act(async () => pending.resolve(response));
    expect(field("Model").value).toBe("task-draft-model");
    expect(button("Save task profile").disabled).toBe(true);
    await change(field("Model"), "gpt-5-codex");
    await click(button("Save task profile"));
    expect(save.mock.calls[1]?.[0]).toMatchObject({
      expectedSettingsRevision: 1,
    });
  });

  it("shows keyboard/hover help, supports Escape, and keeps disabled actions disabled", async () => {
    const action = vi.fn();
    await mount(
      createElement(
        "div",
        null,
        createElement(
          HelpButton,
          {
            disabled: true,
            onClick: action,
            help: "Save after making a change.",
          },
          "Save",
        ),
        createElement(HelpInput, {
          "aria-label": "Name",
          "aria-describedby": "visible-help",
        }),
        createElement(
          "p",
          { id: "visible-help" },
          "Choose a name you recognize.",
        ),
        createElement(
          "details",
          null,
          createElement(HelpSummary, null, "Extra launch options"),
          "Options",
        ),
      ),
    );
    const disabled = host.querySelector<HTMLElement>(".control-help-disabled")!;
    await act(async () => disabled.focus());
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "Save after making a change.",
    );
    expect(disabled.getAttribute("aria-describedby")).toBe(
      document.querySelector('[role="tooltip"]')?.id,
    );
    await act(async () =>
      disabled.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })),
    );
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "Save after making a change.",
    );
    await click(button("Save"));
    expect(action).not.toHaveBeenCalled();
    await act(async () =>
      disabled.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    const input = host.querySelector("input")!;
    await act(async () => input.focus());
    expect(input.getAttribute("aria-describedby")).toContain("visible-help");
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "Choose a name you recognize.",
    );
    expect(host.querySelector("details")?.firstElementChild?.tagName).toBe(
      "SUMMARY",
    );
    await act(async () => input.blur());
    const summary = host.querySelector("summary")!;
    await act(async () =>
      summary.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
    );
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
      "--no-daemon",
    );
  });
});
