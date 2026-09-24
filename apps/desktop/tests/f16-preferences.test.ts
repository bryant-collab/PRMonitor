import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultFakeAIProviderCapabilities } from "../src/main/ai/fake-provider";
import {
  F16ConfigurationError,
  createF16PreferencesRepository,
  type F16PreferencesRepository,
  type F16ServiceOptions,
  F16PreferencesService,
} from "../src/main/f16-preferences-service";
import {
  createPersistenceRepositories,
  initializePersistence,
} from "../src/main/persistence";
import { parseIpcRequest, parseIpcResponse } from "../src/shared/ipc";
import type { PersistedRecord } from "../src/main/persistence/types";
import {
  F16_MAX_COMMON_NAME_SCALARS,
  F16_MAX_COMMON_TEXT_BYTES,
  F16_MAX_PROVIDER_OPTIONS_BYTES,
  F16_POLICY_PRESETS,
  defaultF16Preferences,
  f16CommonInstructionSaveInputSchema,
  f16ProviderOptionsSchema,
  f16TaskProfileDraftSchema,
  isF16EffectiveAITaskSnapshot,
  resolveF16EffectivePolicy,
  type F16EffectiveAITaskSnapshot,
  type F16PreferencesState,
  type F16TaskType,
} from "../src/shared/f16-preferences";
import type { F13RootResolution } from "../src/shared/f13-contracts";

const FIXED_TIME = "2026-09-23T00:00:00.000Z";

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class MemoryPreferencesRepository implements F16PreferencesRepository {
  public record: PersistedRecord<F16PreferencesState> | undefined;
  public readonly revisions = new Map<string, PersistedRecord<unknown>>();

  public readSettings(): PersistedRecord<F16PreferencesState> | undefined {
    return this.record === undefined ? undefined : copy(this.record);
  }

  public commitSettings<TRevision>(input: {
    readonly settings: F16PreferencesState;
    readonly expectedSettingsVersion?: number;
    readonly revision?: {
      readonly kind: "TASK_PROFILE" | "EXECUTION_POLICY" | "COMMON_INSTRUCTION";
      readonly id: string;
      readonly revision: number;
      readonly payload: TRevision;
    };
  }) {
    const currentVersion = this.record?.version ?? 0;
    if (
      input.expectedSettingsVersion !== undefined &&
      input.expectedSettingsVersion !== currentVersion
    )
      throw new Error("CONFLICT");
    const nextVersion = currentVersion + 1;
    const settings: PersistedRecord<F16PreferencesState> = {
      id: "f16.preferences.v1",
      schemaVersion: 1,
      payload: copy(input.settings),
      payloadHash: `settings-${nextVersion}`,
      version: nextVersion,
      createdAt: this.record?.createdAt ?? FIXED_TIME,
      updatedAt: FIXED_TIME,
    };
    let revision: PersistedRecord<TRevision> | undefined;
    if (input.revision !== undefined) {
      const revisionKey = `${input.revision.kind}:${input.revision.id}:${input.revision.revision}`;
      const existing = this.revisions.get(revisionKey);
      const payloadHash = JSON.stringify(input.revision.payload);
      if (existing !== undefined && existing.payloadHash !== payloadHash)
        throw new Error("CONFLICT");
      revision =
        existing === undefined
          ? {
              id: input.revision.id,
              schemaVersion: 1,
              payload: copy(input.revision.payload),
              payloadHash,
              version: input.revision.revision,
              createdAt: FIXED_TIME,
              updatedAt: FIXED_TIME,
            }
          : (copy(existing) as PersistedRecord<TRevision>);
      this.revisions.set(revisionKey, revision as PersistedRecord<unknown>);
    }
    this.record = settings;
    return {
      settings: copy(settings),
      ...(revision === undefined ? {} : { revision: copy(revision) }),
    };
  }
}

function createFixture(overrides: Partial<F16ServiceOptions> = {}) {
  const repository = new MemoryPreferencesRepository();
  const appliedSchedulerConfigurations: unknown[] = [];
  const rootResolution: F13RootResolution = {
    ok: true,
    configuredPath: "C:/PRMonitor/f16-worktrees",
    canonicalPath: "C:/PRMonitor/f16-worktrees",
    rootRevision: 1,
  };
  const options: F16ServiceOptions = {
    repositories: repository,
    capabilities: {
      boundsRevision: "f15-options-v1",
      get: (providerId) =>
        providerId === "fake"
          ? { ...defaultFakeAIProviderCapabilities, providerId: "fake" }
          : undefined,
    },
    validation: {
      boundsRevision: "f00-validation-v1",
      resolve: () => ({
        summary: {
          status: "unavailable",
          phases: [],
          warningCode: "NO_PROFILE",
          boundsRevision: "f00-validation-v1",
        },
        boundsRevision: "f00-validation-v1",
      }),
    },
    scheduler: {
      boundsRevision: "f12-scheduler-v1",
      validateConfiguration: ({ pollingIntervalMs, quietPeriodMs }) => ({
        intervalMs: pollingIntervalMs,
        quietPeriodMs,
        maxConcurrentPrs: 4,
        readOnlyPollWhilePaused: true,
      }),
      applyConfiguration: (configuration) => {
        appliedSchedulerConfigurations.push(configuration);
      },
    },
    worktreeRoot: {
      boundsRevision: "f13-root-v1",
      resolveRoot: async () => rootResolution,
    },
    ipcBoundsRevision: "f04-ipc-v1",
    ...overrides,
  };
  return {
    repository,
    service: new F16PreferencesService(options),
    appliedSchedulerConfigurations,
  };
}

async function enableAllProfiles(
  service: F16PreferencesService,
): Promise<void> {
  const types: readonly F16TaskType[] = [
    "AUTOMATIC_REVIEW_REEVALUATION",
    "REVIEW_REVISION",
    "READ_ONLY_CONVERSATION",
    "MERGE_CONFLICT_RESOLUTION",
  ];
  for (const taskType of types) {
    const current = service.readPreferences();
    service.saveTaskProfile({
      expectedSettingsRevision: current.settingsRevision,
      profile: {
        taskType,
        providerId: "fake",
        modelId: "gpt-5-codex",
        reasoningEffort: "medium",
        providerOptions: {},
        enabled: true,
      },
    });
  }
}

function expectF16Error(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("expected F16 error");
  } catch (error) {
    expect(error).toBeInstanceOf(F16ConfigurationError);
    expect((error as F16ConfigurationError).code).toBe(code);
  }
}

describe("F16 AI Preferences and snapshot boundary", () => {
  it("keeps bounded profile admission tied to provider capability metadata", () => {
    const { service } = createFixture();
    const initial = service.readPreferences();
    const saved = service.saveTaskProfile({
      expectedSettingsRevision: initial.settingsRevision,
      profile: {
        taskType: "AUTOMATIC_REVIEW_REEVALUATION",
        providerId: "fake",
        modelId: "gpt-5-codex",
        reasoningEffort: "medium",
        providerOptions: {},
        enabled: true,
      },
    });
    const profile = saved.taskProfiles.find(
      (candidate) => candidate.taskType === "AUTOMATIC_REVIEW_REEVALUATION",
    );
    expect(profile).toMatchObject({ availability: "AVAILABLE", revision: 2 });
    expect(saved.settingsRevision).toBe(1);

    expectF16Error(
      () =>
        service.saveTaskProfile({
          expectedSettingsRevision: saved.settingsRevision,
          profile: {
            taskType: "REVIEW_REVISION",
            providerId: "missing-provider",
            modelId: "gpt-5-codex",
            providerOptions: {},
            enabled: true,
          },
        }),
      "F16_PROVIDER_UNKNOWN",
    );
    expectF16Error(
      () =>
        service.saveTaskProfile({
          expectedSettingsRevision: saved.settingsRevision,
          profile: {
            taskType: "REVIEW_REVISION",
            providerId: "fake",
            modelId: "not-advertised",
            providerOptions: {},
            enabled: true,
          },
        }),
      "F16_CAPABILITY_UNSUPPORTED",
    );

    const noCatalog = createFixture({
      capabilities: {
        boundsRevision: "f15-options-v1",
        get: () => ({
          ...defaultFakeAIProviderCapabilities,
          providerId: "fake",
          modelCatalog: undefined,
        }),
      },
    });
    const unverified = noCatalog.service.saveTaskProfile({
      expectedSettingsRevision: 0,
      profile: {
        taskType: "REVIEW_REVISION",
        providerId: "fake",
        modelId: "gpt-5-codex",
        providerOptions: {},
        enabled: true,
      },
    });
    expect(
      unverified.taskProfiles.find(
        (profile) => profile.taskType === "REVIEW_REVISION",
      ),
    ).toMatchObject({ availability: "UNVERIFIED" });

    const lowerBound = createFixture({
      capabilities: {
        boundsRevision: "f15-options-v1",
        get: () => ({
          ...defaultFakeAIProviderCapabilities,
          providerId: "fake",
          providerOptionBounds: {
            schemaVersion: 1,
            boundsRevision: "f15-options-lower-v1",
            maxBytes: 10,
            maxObjectDepth: 8,
            maxObjectKeys: 64,
            maxArrayItems: 128,
          },
        }),
      },
    });
    expectF16Error(
      () =>
        lowerBound.service.saveTaskProfile({
          expectedSettingsRevision: 0,
          profile: {
            taskType: "REVIEW_REVISION",
            providerId: "fake",
            modelId: "gpt-5-codex",
            providerOptions: { value: "too-large" },
            enabled: true,
          },
        }),
      "F16_INPUT_LIMIT_EXCEEDED",
    );
  });

  it("enforces the read-only floor and rejects unsupported policy behavior", () => {
    const capabilities = {
      ...defaultFakeAIProviderCapabilities,
      providerId: "fake" as const,
    };
    const fullAccess = {
      ...defaultF16Preferences().policy,
      preset: "FULL_ACCESS" as const,
    };
    const floor = resolveF16EffectivePolicy({
      policy: fullAccess,
      phase: "REVIEW_PROPOSAL",
      capabilities,
    });
    expect(floor).toMatchObject({
      ok: true,
      value: { effectivePreset: "READ_ONLY", publicationAuthority: false },
    });

    const interactive = resolveF16EffectivePolicy({
      policy: {
        ...defaultF16Preferences().policy,
        preset: "INTERACTIVE_APPROVALS",
      },
      phase: "REVIEW_REVISION",
      capabilities,
      operationWorktree: {
        operationId: "operation-1",
        canonicalPath: "C:/PRMonitor/worktrees/operation-1",
        rootRevision: 1,
      },
    });
    expect(interactive).toMatchObject({
      ok: false,
      code: "F16_POLICY_UNSUPPORTED",
    });
    expect(F16_POLICY_PRESETS).toHaveLength(5);
  });

  it("revisions Common Instructions, preserves order, and builds immutable snapshots", async () => {
    const { service } = createFixture();
    await enableAllProfiles(service);
    let current = service.readPreferences();
    const saved = service.saveCommonInstruction({
      expectedSettingsRevision: current.settingsRevision,
      name: "Review guardrails",
      instructionText: "Use only recorded evidence.",
      enabled: true,
      selected: true,
    });
    const first = saved.commonInstructionProfiles[0];
    expect(first).toBeDefined();
    current = saved;
    const edited = service.saveCommonInstruction({
      expectedSettingsRevision: current.settingsRevision,
      profileId: first!.profileId,
      name: "Review guardrails v2",
      instructionText: "Use only recorded evidence and bounded context.",
      enabled: true,
      selected: true,
    });
    expect(edited.commonInstructionProfiles[0]).toMatchObject({
      revision: 2,
      name: "Review guardrails v2",
    });
    expect(edited.selectedCommonInstructionIds).toEqual([first!.profileId]);
    expect(edited.commonInstructionProfiles[0]?.contentHash).not.toBe(
      first!.contentHash,
    );

    const snapshot = await service.resolveTask({
      taskType: "READ_ONLY_CONVERSATION",
      phase: "READ_ONLY_CONVERSATION",
      operationId: "operation-1",
      prIntentContext: "Read-only context",
    });
    expect(isF16EffectiveAITaskSnapshot(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.policy).toMatchObject({
      effectivePreset: "READ_ONLY",
      publicationAuthority: false,
    });
    expect(snapshot.bounds).toMatchObject({
      f04: "f04-ipc-v1",
      f15: "f15-options-v1",
    });
    expect(snapshot.snapshotId).toContain("f16-snapshot-");
    expect(() => {
      (snapshot as F16EffectiveAITaskSnapshot & { taskType: string }).taskType =
        "REVIEW_REVISION";
    }).toThrow();

    current = service.readPreferences();
    const repositorySaved = service.saveRepositorySettings({
      expectedSettingsRevision: current.settingsRevision,
      repository: {
        serverId: "server-1",
        owner: "owner",
        name: "repo",
        key: "server-1/owner/repo",
      },
      buildInstructions: "Prefer the repository's documented checks.",
    });
    const repositorySnapshot = await service.resolveTask({
      taskType: "AUTOMATIC_REVIEW_REEVALUATION",
      phase: "REVIEW_PROPOSAL",
      repository: repositorySaved.repositories[0]!.repository,
      prIntentContext: "Review only the requested behavior.",
    });
    expect(repositorySnapshot.buildValidation).toMatchObject({
      buildInstructions: "Prefer the repository's documented checks.",
      validation: { status: "unavailable", warningCode: "NO_PROFILE" },
    });

    const taskMatrix: readonly {
      readonly taskType: F16TaskType;
      readonly phase:
        | "REVIEW_PROPOSAL"
        | "REVIEW_REVISION"
        | "READ_ONLY_CONVERSATION"
        | "MERGE_CONFLICT_RESOLUTION";
      readonly needsWorktree: boolean;
    }[] = [
      {
        taskType: "AUTOMATIC_REVIEW_REEVALUATION",
        phase: "REVIEW_PROPOSAL",
        needsWorktree: false,
      },
      {
        taskType: "REVIEW_REVISION",
        phase: "REVIEW_REVISION",
        needsWorktree: true,
      },
      {
        taskType: "READ_ONLY_CONVERSATION",
        phase: "READ_ONLY_CONVERSATION",
        needsWorktree: false,
      },
      {
        taskType: "MERGE_CONFLICT_RESOLUTION",
        phase: "MERGE_CONFLICT_RESOLUTION",
        needsWorktree: true,
      },
    ];
    for (const task of taskMatrix) {
      const matrixSnapshot = await service.resolveTask({
        taskType: task.taskType,
        phase: task.phase,
        ...(task.needsWorktree
          ? {
              operationWorktree: {
                operationId: "operation-matrix",
                canonicalPath: "C:/PRMonitor/worktrees/operation-matrix",
                rootRevision: 1,
              },
            }
          : {}),
      });
      expect(matrixSnapshot.taskType).toBe(task.taskType);
      expect(matrixSnapshot.phase).toBe(task.phase);
    }
  });

  it("hands operational settings to F12 and F13 and records a scheduler failure safely", async () => {
    const fixture = createFixture();
    const saved = await fixture.service.saveOperational({
      expectedSettingsRevision: 0,
      maxAiWorkTurns: 4,
      worktreeRoot: "C:/PRMonitor/f16-worktrees",
      pollingIntervalMs: 120_000,
      quietPeriodMs: 180_000,
    });
    expect(saved.operational).toMatchObject({
      maxAiWorkTurns: 4,
      pollingIntervalMs: 120_000,
      quietPeriodMs: 180_000,
    });
    expect(saved.operational.worktreeRoot).toMatchObject({ rootRevision: 1 });
    expect(fixture.appliedSchedulerConfigurations).toHaveLength(1);

    const invalidRoot = createFixture({
      worktreeRoot: {
        boundsRevision: "f13-root-v1",
        resolveRoot: async () => ({
          ok: false,
          rootRevision: 1,
          reason: {
            code: "WORKTREE_ROOT_INVALID",
            category: "VALIDATION",
            what: "The root is invalid.",
            why: "The fixture rejects it.",
            nextAction: "OPEN_SETTINGS",
            correlationId: "f16-test",
          },
        }),
      },
    });
    await expect(
      invalidRoot.service.saveOperational({
        expectedSettingsRevision: 0,
        maxAiWorkTurns: 3,
        worktreeRoot: "C:/invalid",
        pollingIntervalMs: 60000,
        quietPeriodMs: 60000,
      }),
    ).rejects.toMatchObject({ code: "F16_WORKTREE_ROOT_INVALID" });
  });

  it("uses expected revisions for atomic conflict protection and preserves immutable history", () => {
    const fixture = createFixture();
    const first = fixture.service.savePolicy({
      expectedSettingsRevision: 0,
      preset: "READ_ONLY",
    });
    expect(first.settingsRevision).toBe(1);
    expect(
      fixture.repository.revisions.get("EXECUTION_POLICY:application-policy:2")
        ?.payload,
    ).toMatchObject({ preset: "READ_ONLY" });
    expectF16Error(
      () =>
        fixture.service.savePolicy({
          expectedSettingsRevision: 0,
          preset: "FULL_ACCESS",
        }),
      "F16_CONFLICT",
    );
    expect(fixture.service.readPreferences().policy.preset).toBe("READ_ONLY");
  });

  it("keeps exact bounds and rejects over-limit provider/common input", () => {
    const baseProfile = {
      taskType: "REVIEW_REVISION" as const,
      providerId: "fake",
      modelId: "gpt-5-codex",
      providerOptions: {},
      enabled: true,
    };
    expect(
      f16TaskProfileDraftSchema.safeParse({
        ...baseProfile,
        providerId: "p".repeat(128),
      }).success,
    ).toBe(true);
    expect(
      f16TaskProfileDraftSchema.safeParse({
        ...baseProfile,
        providerId: "p".repeat(129),
      }).success,
    ).toBe(false);
    expect(
      f16ProviderOptionsSchema.safeParse({
        key: "x".repeat(F16_MAX_PROVIDER_OPTIONS_BYTES),
      }).success,
    ).toBe(false);
    expect(
      f16CommonInstructionSaveInputSchema.safeParse({
        expectedSettingsRevision: 0,
        name: "n".repeat(F16_MAX_COMMON_NAME_SCALARS),
        instructionText: "x",
        enabled: true,
        selected: false,
      }).success,
    ).toBe(true);
    expect(
      f16CommonInstructionSaveInputSchema.safeParse({
        expectedSettingsRevision: 0,
        name: "n",
        instructionText: "x".repeat(F16_MAX_COMMON_TEXT_BYTES + 1),
        enabled: true,
        selected: false,
      }).success,
    ).toBe(false);
  });

  it("accepts only the versioned Preferences IPC payloads and response read model", () => {
    const readModel = createFixture().service.readPreferences();
    const read = parseIpcRequest({
      schemaVersion: 1,
      requestId: "request-f16-read",
      type: "preferences.read",
      payload: {},
    });
    expect(read.ok).toBe(true);
    expect(
      parseIpcRequest({
        schemaVersion: 1,
        requestId: "request-f16-save",
        type: "preferences.policy.save",
        payload: { expectedSettingsRevision: 0, preset: "READ_ONLY" },
      }).ok,
    ).toBe(true);
    expect(
      parseIpcRequest({
        schemaVersion: 1,
        requestId: "request-f16-extra",
        type: "preferences.policy.save",
        payload: {
          expectedSettingsRevision: 0,
          preset: "READ_ONLY",
          secret: "never",
        },
      }).ok,
    ).toBe(false);
    expect(
      parseIpcResponse({
        schemaVersion: 1,
        requestId: "request-f16-preferences",
        ok: true,
        value: { kind: "preferences", preferences: readModel },
      }),
    ).toBe(true);
    expect(
      parseIpcResponse({
        schemaVersion: 1,
        requestId: "request-f16-error",
        ok: false,
        error: {
          code: "CONFIGURATION_ERROR",
          message: "Fix the profile.",
          correlationId: "ipc-request-f16-error",
        },
      }),
    ).toBe(true);
  });

  it("persists the mutable projection and immutable revisions through the F03 repository transaction", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "prmonitor-f16-"));
    const store = await initializePersistence(
      {
        databasePath: path.join(root, "database", "prmonitor.sqlite"),
        backupRoot: path.join(root, "backups"),
      },
      { clock: { now: () => FIXED_TIME }, applicationBuild: "f16-test" },
    );
    try {
      const repositories = createPersistenceRepositories(store, {
        clock: { now: () => FIXED_TIME },
      });
      const service = new F16PreferencesService({
        repositories: createF16PreferencesRepository(repositories),
        capabilities: {
          boundsRevision: "f15-options-v1",
          get: (providerId) =>
            providerId === "fake"
              ? { ...defaultFakeAIProviderCapabilities, providerId: "fake" }
              : undefined,
        },
        ipcBoundsRevision: "f04-ipc-v1",
      });
      const saved = service.saveTaskProfile({
        expectedSettingsRevision: 0,
        profile: {
          taskType: "AUTOMATIC_REVIEW_REEVALUATION",
          providerId: "fake",
          modelId: "gpt-5-codex",
          providerOptions: {},
          enabled: true,
        },
      });
      expect(saved.settingsRevision).toBe(1);
      expect(
        repositories.getF16Revision(
          "TASK_PROFILE",
          "profile-automatic_review_reevaluation",
          2,
        )?.payload,
      ).toMatchObject({ providerId: "fake", availability: "AVAILABLE" });
      expect(repositories.getSetting("f16.preferences.v1")?.version).toBe(1);
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
