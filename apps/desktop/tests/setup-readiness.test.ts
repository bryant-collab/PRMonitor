import { describe, expect, it, vi } from "vitest";
import { CodexAdapter } from "../src/main/ai/codex-adapter";
import { AIProviderRegistry } from "../src/main/ai/registry";
import {
  SetupReadinessService,
  setupGitHubAccess,
  type SetupReadinessPorts,
  type SetupLocalPrerequisites,
} from "../src/main/setup-readiness-service";
import type {
  GithubServerProfileView,
  GithubReasonCategory,
  GithubServerStatus,
} from "../src/shared/github-server";
import {
  defaultF16Preferences,
  f16PolicyPresetSummaries,
  type F16PreferencesReadModel,
} from "../src/shared/f16-preferences";
import { setupReadinessSchema } from "../src/shared/setup-readiness";

describe("provider local setup preflight", () => {
  it("reports missing approved authentication without starting a client or turn", () => {
    const createClient = vi.fn();
    const provider = new CodexAdapter({
      runtime: { createClient },
      providerAuthenticationEnvironment: {},
    });
    const preflight = (
      provider as unknown as { readLocalReadiness?: () => unknown }
    ).readLocalReadiness;
    expect(typeof preflight).toBe("function");
    expect(preflight?.call(provider)).toEqual({
      runtimeAvailable: true,
      authenticationAvailable: false,
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each(["OPENAI_BASE_URL", "OPENAI_ORG_ID", "CODEX_HOME", "GITHUB_TOKEN"])(
    "does not treat %s as an authentication credential",
    (key) => {
      const provider = new CodexAdapter({
        runtime: { createClient: vi.fn() },
        providerAuthenticationEnvironment: { [key]: "fixture-only" },
      });
      expect(provider.readLocalReadiness().authenticationAvailable).toBe(false);
    },
  );

  it("checks runtime availability and approved auth without exposing either source", () => {
    const createClient = vi.fn();
    const provider = new CodexAdapter({
      runtime: {
        createClient,
        isAvailable: () => false,
        authenticationEnvironment: { OPENAI_API_KEY: "fixture-only" },
      },
    });
    expect(provider.readLocalReadiness()).toEqual({
      runtimeAvailable: false,
      authenticationAvailable: true,
    });
    expect(JSON.stringify(provider.readLocalReadiness())).not.toContain(
      "fixture-only",
    );
    expect(createClient).not.toHaveBeenCalled();
  });
});

function fixture() {
  const preferences: F16PreferencesReadModel = {
    ...defaultF16Preferences(),
    policyPresets: f16PolicyPresetSummaries(),
  };
  preferences.taskProfiles = preferences.taskProfiles.map((profile) => ({
    ...profile,
    enabled: true,
    availability: "AVAILABLE",
  }));
  const provider = new CodexAdapter({
    runtime: {
      createClient: vi.fn(),
      authenticationEnvironment: { OPENAI_API_KEY: "fixture-only" },
    },
  });
  const providers = new AIProviderRegistry();
  providers.register(provider);
  const ports: SetupReadinessPorts = {
    providers,
    readPreferences: () => preferences,
    readLocalPrerequisites: () => ({
      git: "ready",
      storage: "ready",
      worktreeRoot: "ready",
    }),
    readGitHubAccess: () => ({
      secureStorageAvailable: true,
      profiles: [{ removed: false, verified: true, hasActiveCredential: true }],
    }),
  };
  return { preferences, provider, ports };
}

describe("derived mandatory setup readiness", () => {
  it("recognizes ready existing data without PRs, acknowledgment, or optional settings", async () => {
    const { ports, provider } = fixture();
    const invoke = vi.spyOn(provider, "invoke");
    const service = new SetupReadinessService(ports);
    const first = await service.read();
    const second = await service.read();
    expect(first.ready).toBe(true);
    expect(first.completedCount).toBe(5);
    expect(second.revision).toBeGreaterThan(first.revision);
    expect(first.checks[2]?.description).toBe(
      "Configured locally; service access is checked when work starts",
    );
    expect(invoke).not.toHaveBeenCalled();
    expect(setupReadinessSchema.safeParse(first).success).toBe(true);
  });

  it.each([
    ["git", "missing", "incomplete"],
    ["git", "unavailable", "temporarily-unavailable"],
    ["storage", "failed", "incomplete"],
    ["storage", "unavailable", "temporarily-unavailable"],
    ["worktreeRoot", "invalid", "incomplete"],
    ["worktreeRoot", "unavailable", "temporarily-unavailable"],
  ] as const)("reports %s %s independently", async (field, value, expected) => {
    const { ports } = fixture();
    const local: SetupLocalPrerequisites = {
      git: "ready",
      storage: "ready",
      worktreeRoot: "ready",
      [field]: value,
    };
    const result = await new SetupReadinessService({
      ...ports,
      readLocalPrerequisites: () => local,
    }).read();
    expect(result.ready).toBe(false);
    expect(result.checks[0]?.status).toBe(expected);
    expect(result.completedCount).toBe(4);
  });

  it.each([
    { removed: true, verified: true, hasActiveCredential: true },
    { removed: false, verified: false, hasActiveCredential: true },
    { removed: false, verified: true, hasActiveCredential: false },
  ])(
    "requires a nonremoved verified profile with an active credential",
    async (profile) => {
      const { ports } = fixture();
      const result = await new SetupReadinessService({
        ...ports,
        readGitHubAccess: () => ({
          secureStorageAvailable: true,
          profiles: [profile],
        }),
      }).read();
      expect(result.checks[1]?.status).toBe("incomplete");
    },
  );

  it("keeps a usable verified server ready when an extra profile fails", async () => {
    const { ports } = fixture();
    const result = await new SetupReadinessService({
      ...ports,
      readGitHubAccess: () => ({
        secureStorageAvailable: true,
        profiles: [
          { removed: false, verified: true, hasActiveCredential: true },
          { removed: false, verified: false, hasActiveCredential: false },
        ],
      }),
    }).read();
    expect(result.ready).toBe(true);
  });

  it("cannot accept verified credentials when secure storage is unavailable", async () => {
    const { ports } = fixture();
    const result = await new SetupReadinessService({
      ...ports,
      readGitHubAccess: () => ({
        secureStorageAvailable: false,
        profiles: [
          { removed: false, verified: true, hasActiveCredential: true },
        ],
      }),
    }).read();
    expect(result.checks[1]?.status).toBe("incomplete");
  });

  it.each([
    "AUTOMATIC_REVIEW_REEVALUATION",
    "REVIEW_REVISION",
    "READ_ONLY_CONVERSATION",
    "MERGE_CONFLICT_RESOLUTION",
  ] as const)("requires %s enabled", async (task) => {
    const { ports, preferences } = fixture();
    preferences.taskProfiles.find(
      (profile) => profile.taskType === task,
    )!.enabled = false;
    const result = await new SetupReadinessService(ports).read();
    expect(result.checks[3]?.status).toBe("incomplete");
  });

  it.each(["UNAVAILABLE", "UNVERIFIED", "UNSUPPORTED", "DISABLED"] as const)(
    "rejects %s task availability",
    async (availability) => {
      const { ports, preferences } = fixture();
      preferences.taskProfiles[0]!.availability = availability;
      expect(
        (await new SetupReadinessService(ports).read()).checks[3]?.status,
      ).toBe("incomplete");
    },
  );

  it("rechecks current provider capabilities instead of trusting obsolete AVAILABLE", async () => {
    const { ports, preferences } = fixture();
    preferences.taskProfiles[0]!.modelId = "unadvertised-fixture-model";
    expect(
      (await new SetupReadinessService(ports).read()).checks[3]?.status,
    ).toBe("incomplete");
  });

  it("missing and unknown providers cannot imply authentication or task readiness", async () => {
    const { ports, preferences } = fixture();
    preferences.taskProfiles[0]!.providerId = "unknown-fixture-provider";
    const result = await new SetupReadinessService(ports).read();
    expect(
      result.checks.slice(2).every((check) => check.status === "incomplete"),
    ).toBe(true);
  });

  it("missing authentication is independent of AVAILABLE capability profiles", async () => {
    const { ports } = fixture();
    const providers = new AIProviderRegistry();
    providers.register(
      new CodexAdapter({
        runtime: { createClient: vi.fn() },
        providerAuthenticationEnvironment: {},
      }),
    );
    const result = await new SetupReadinessService({
      ...ports,
      providers,
    }).read();
    expect(result.checks[2]?.status).toBe("incomplete");
    expect(result.checks[3]?.status).toBe("complete");
  });

  it("requires a workspace-write policy for the mandatory mutating tasks", async () => {
    const { ports, preferences, provider } = fixture();
    preferences.policy.preset = "READ_ONLY";
    const invoke = vi.spyOn(provider, "invoke");
    const result = await new SetupReadinessService(ports).read();
    expect(result.checks[3]?.status).toBe("complete");
    expect(result.checks[4]?.status).toBe("incomplete");
    expect(result.ready).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(["INTERACTIVE_APPROVALS", "FULL_ACCESS"] as const)(
    "rejects unsupported %s working policy",
    async (preset) => {
      const { ports, preferences } = fixture();
      preferences.policy.preset = preset;
      expect(
        (await new SetupReadinessService(ports).read()).checks[4]?.status,
      ).toBe("incomplete");
    },
  );

  it("rejects invalid operational bounds", async () => {
    const { ports, preferences } = fixture();
    preferences.operational.maxAiWorkTurns = -1;
    expect(
      (await new SetupReadinessService(ports).read()).checks[4]?.status,
    ).toBe("incomplete");
  });

  it("returns safe retryable state on read errors without leaking exception details", async () => {
    const { ports } = fixture();
    const result = await new SetupReadinessService({
      ...ports,
      readPreferences: () => {
        throw new Error("secret-fixture-path");
      },
    }).read();
    expect(result.ready).toBe(false);
    expect(
      result.checks
        .slice(2)
        .every((item) => item.status === "temporarily-unavailable"),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret-fixture-path");
  });

  it("bounds a stalled prerequisite read and permits retry", async () => {
    const { ports } = fixture();
    const result = await new SetupReadinessService({
      ...ports,
      timeoutMs: 5,
      readLocalPrerequisites: () => new Promise(() => {}),
    }).read();
    expect(result.checks[0]?.status).toBe("temporarily-unavailable");
    expect(result.ready).toBe(false);
  });

  it("recomputes after credentials are removed and on reconstructed service", async () => {
    const { ports } = fixture();
    let active = true;
    const changed = {
      ...ports,
      readGitHubAccess: () => ({
        secureStorageAvailable: true,
        profiles: [
          { removed: false, verified: true, hasActiveCredential: active },
        ],
      }),
    };
    const service = new SetupReadinessService(changed);
    expect((await service.read()).ready).toBe(true);
    active = false;
    service.invalidate();
    expect((await service.read()).ready).toBe(false);
    expect((await new SetupReadinessService(changed).read()).ready).toBe(false);
  });

  it("recomputes an invalidated pending read and does not return obsolete complete state", async () => {
    const { ports } = fixture();
    let resolve!: (local: SetupLocalPrerequisites) => void;
    const readLocalPrerequisites = vi
      .fn<SetupReadinessPorts["readLocalPrerequisites"]>()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockReturnValue({
        git: "missing",
        storage: "ready",
        worktreeRoot: "ready",
      });
    const service = new SetupReadinessService({
      ...ports,
      readLocalPrerequisites,
    });
    const pending = service.read();
    await Promise.resolve();
    const invalidatedRevision = service.invalidate();
    resolve({ git: "ready", storage: "ready", worktreeRoot: "ready" });
    const result = await pending;
    expect(result.revision).toBeGreaterThan(invalidatedRevision);
    expect(result.checks[0]?.status).toBe("incomplete");
  });

  it("preserves request revision ordering for out-of-order responses", async () => {
    const { ports } = fixture();
    let resolve!: (local: SetupLocalPrerequisites) => void;
    const reads = vi
      .fn<SetupReadinessPorts["readLocalPrerequisites"]>()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockReturnValue({
        git: "missing",
        storage: "ready",
        worktreeRoot: "ready",
      });
    const service = new SetupReadinessService({
      ...ports,
      readLocalPrerequisites: reads,
    });
    const old = service.read();
    const latest = await service.read();
    resolve({ git: "ready", storage: "ready", worktreeRoot: "ready" });
    expect((await old).revision).toBeLessThan(latest.revision);
    expect(latest.ready).toBe(false);
  });
});

describe("F05 authoritative GitHub readiness mapping", () => {
  const verified: GithubServerProfileView = {
    schemaVersion: 1,
    id: "fixture-server",
    displayName: "Fixture",
    kind: "GHES",
    webOrigin: "https://github.example",
    apiBaseUrl: "https://github.example/api/v3",
    host: "github.example",
    status: "VERIFIED",
    version: 2,
    activeRevision: 3,
    verifiedAt: "2026-01-01T00:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  function map(profile: GithubServerProfileView) {
    return setupGitHubAccess({
      schemaVersion: 1,
      secureStore: { state: "AVAILABLE" },
      profiles: [profile],
      operations: [],
    });
  }
  it.each(["NETWORK", "RATE_LIMIT", "TIMEOUT"] as const)(
    "preserves prior verified active revision for %s retest failures",
    async (category) => {
      const access = map({
        ...verified,
        status: "NEEDS_ATTENTION",
        reason: {
          code: "NETWORK_FAILED",
          category,
          message: "Fixture",
          nextAction: "RETRY",
          correlationId: "fixture",
        },
      });
      expect(access.profiles[0]?.verified).toBe(true);
      expect(access.connectionTransient).toBe(true);
      const { ports } = fixture();
      const result = await new SetupReadinessService({
        ...ports,
        readGitHubAccess: () => access,
      }).read();
      expect(result.ready).toBe(true);
      expect(result.checks[1]?.description).toContain(
        "temporarily unavailable",
      );
    },
  );
  it.each([
    "AUTHENTICATION",
    "AUTHORIZATION",
    "SECURE_STORAGE",
    "RECOVERY",
    "UNKNOWN",
  ] as GithubReasonCategory[])(
    "does not preserve confirmed %s failures",
    (category) => {
      const access = map({
        ...verified,
        status: "NEEDS_ATTENTION",
        reason: {
          code: "AUTHENTICATION_FAILED",
          category,
          message: "Fixture",
          nextAction: "REPLACE_ACCESS",
          correlationId: "fixture",
        },
      });
      expect(access.profiles[0]?.verified).toBe(false);
    },
  );
  it.each([
    "REMOVED",
    "RECOVERY_REQUIRED",
    "UNVERIFIED",
    "SECURE_STORAGE_UNAVAILABLE",
  ] as GithubServerStatus[])("does not preserve %s", (status) => {
    expect(map({ ...verified, status }).profiles[0]?.verified).toBe(false);
  });
  it("requires verification evidence and active revision for a transient failure", () => {
    const { verifiedAt: _verifiedAt, ...unverified } = verified;
    expect(
      map({
        ...unverified,
        status: "NEEDS_ATTENTION",
        reason: {
          code: "NETWORK_FAILED",
          category: "NETWORK",
          message: "Fixture",
          nextAction: "RETRY",
          correlationId: "fixture",
        },
      }).profiles[0]?.verified,
    ).toBe(false);
    const { activeRevision: _activeRevision, ...inactive } = verified;
    expect(map(inactive).profiles[0]?.hasActiveCredential).toBe(false);
  });
});
