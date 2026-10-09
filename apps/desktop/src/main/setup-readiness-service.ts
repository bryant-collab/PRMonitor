import {
  F16_TASK_TYPES,
  f16OperationalPreferencesSchema,
  f16PolicyPresetSummaries,
  f16PolicyRevisionSchema,
  f16ProviderOptionsWithinBounds,
  f16TaskProfileRevisionSchema,
  type F16PreferencesReadModel,
} from "../shared/f16-preferences";
import { outputContractForTask } from "../shared/ai/provider-contracts";
import {
  setupReadinessSchema,
  type SetupReadiness,
  type SetupReadinessCheck,
} from "../shared/setup-readiness";
import type { AIProviderRegistry } from "./ai/registry";
import type { GithubServerSettingsView } from "../shared/github-server";

export interface SetupLocalPrerequisites {
  readonly git: "ready" | "missing" | "unavailable";
  readonly storage: "ready" | "failed" | "unavailable";
  readonly worktreeRoot: "ready" | "invalid" | "unavailable";
}
export interface SetupGitHubAccess {
  readonly secureStorageAvailable: boolean;
  readonly connectionTransient?: boolean;
  readonly profiles: readonly {
    readonly removed: boolean;
    readonly verified: boolean;
    readonly hasActiveCredential: boolean;
  }[];
}

/** F05 preserves verifiedAt and the active revision on failed retests;
 * replacement activates a new revision only after its own successful test. */
export function setupGitHubAccess(
  settings: GithubServerSettingsView,
): SetupGitHubAccess {
  let connectionTransient = false;
  const profiles = settings.profiles.map((profile) => {
    const transient =
      profile.status === "NEEDS_ATTENTION" &&
      profile.verifiedAt !== undefined &&
      profile.reason !== undefined &&
      ["NETWORK", "RATE_LIMIT", "TIMEOUT"].includes(profile.reason.category);
    const hasActiveCredential =
      profile.activeRevision !== undefined &&
      Number.isSafeInteger(profile.activeRevision) &&
      profile.activeRevision > 0;
    connectionTransient ||= transient && hasActiveCredential;
    return {
      removed: profile.status === "REMOVED",
      verified: profile.status === "VERIFIED" || transient,
      hasActiveCredential,
    };
  });
  return {
    secureStorageAvailable: settings.secureStore.state === "AVAILABLE",
    connectionTransient,
    profiles,
  };
}
export interface SetupReadinessPorts {
  readonly readLocalPrerequisites: () =>
    SetupLocalPrerequisites | Promise<SetupLocalPrerequisites>;
  readonly readGitHubAccess: () =>
    SetupGitHubAccess | Promise<SetupGitHubAccess>;
  readonly readPreferences: () =>
    F16PreferencesReadModel | Promise<F16PreferencesReadModel>;
  readonly providers: AIProviderRegistry;
  readonly timeoutMs?: number;
}

const CHECKS: readonly Pick<SetupReadinessCheck, "id" | "remediation">[] = [
  { id: "local-prerequisites", remediation: "local" },
  { id: "github-access", remediation: "github" },
  { id: "ai-access", remediation: "ai" },
  { id: "ai-task-configuration", remediation: "tasks" },
  { id: "working-policy", remediation: "policy" },
];
function check(
  index: number,
  status: SetupReadinessCheck["status"],
  description: string,
): SetupReadinessCheck {
  return { ...CHECKS[index]!, status, description };
}
function unavailable(index: number): SetupReadinessCheck {
  return check(
    index,
    "temporarily-unavailable",
    "This prerequisite could not be checked. Retry to read current configuration.",
  );
}
function localCheck(local: SetupLocalPrerequisites): SetupReadinessCheck {
  if (local.git === "missing")
    return check(
      0,
      "incomplete",
      "Git is missing or does not meet the required version. Configure Git and retry.",
    );
  if (local.storage === "failed")
    return check(
      0,
      "incomplete",
      "Application storage needs recovery. Open diagnostics and retry after recovery.",
    );
  if (local.worktreeRoot === "invalid")
    return check(
      0,
      "incomplete",
      "The application worktree root is unsafe or not writable. Configure the worktree root and retry.",
    );
  if (
    local.git !== "ready" ||
    local.storage !== "ready" ||
    local.worktreeRoot !== "ready"
  )
    return unavailable(0);
  return check(
    0,
    "complete",
    "Git, application storage, and the application worktree root are ready.",
  );
}
function githubCheck(github: SetupGitHubAccess): SetupReadinessCheck {
  if (!github.secureStorageAvailable)
    return check(
      1,
      "incomplete",
      "Secure credential storage is unavailable. Recover secure storage and retry.",
    );
  const usable = github.profiles.some(
    (profile) =>
      !profile.removed && profile.verified && profile.hasActiveCredential,
  );
  return check(
    1,
    usable ? "complete" : "incomplete",
    usable
      ? github.connectionTransient
        ? "Verified GitHub configuration is saved; a connection is temporarily unavailable. Retry the connection when available."
        : "A verified GitHub server has an active credential."
      : "Add a GitHub server or save and test its connection with an active credential.",
  );
}

/** A read-only presentation projection. Existing operation guards remain authoritative. */
export class SetupReadinessService {
  private revision = 0;
  private generation = 0;
  public constructor(private readonly ports: SetupReadinessPorts) {}

  public invalidate(): number {
    this.generation += 1;
    return ++this.revision;
  }

  public async read(): Promise<SetupReadiness> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const revision = ++this.revision;
      const generation = this.generation;
      const checks = await this.compute();
      if (generation === this.generation) return this.project(revision, checks);
    }
    return this.project(
      ++this.revision,
      CHECKS.map((_, index) => unavailable(index)),
    );
  }

  private project(
    revision: number,
    checks: SetupReadinessCheck[],
  ): SetupReadiness {
    const completedCount = checks.filter(
      (item) => item.status === "complete",
    ).length;
    return setupReadinessSchema.parse({
      schemaVersion: 1,
      revision,
      ready: completedCount === 5,
      completedCount,
      checks,
    });
  }

  private async bounded<T>(read: () => T | Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(read),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("SETUP_READ_TIMEOUT")),
            Math.min(30_000, Math.max(1, this.ports.timeoutMs ?? 5_000)),
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async compute(): Promise<SetupReadinessCheck[]> {
    const [local, github, preferences] = await Promise.allSettled([
      this.bounded(this.ports.readLocalPrerequisites),
      this.bounded(this.ports.readGitHubAccess),
      this.bounded(this.ports.readPreferences),
    ]);
    const checks = [
      local.status === "fulfilled" ? localCheck(local.value) : unavailable(0),
      github.status === "fulfilled"
        ? githubCheck(github.value)
        : unavailable(1),
    ];
    if (preferences.status !== "fulfilled")
      return [...checks, unavailable(2), unavailable(3), unavailable(4)];
    const state = preferences.value;
    const profiles = state.taskProfiles;
    const accessProfiles = [
      ...new Map(
        profiles.map((profile) => [
          `${profile.providerId}:${profile.connectionId ?? "legacy"}`,
          profile,
        ]),
      ).values(),
    ];
    let accessComplete = accessProfiles.length > 0;
    let accessUnavailable = false;
    let boundaryBlocked = false;
    for (const profile of accessProfiles) {
      const provider = this.ports.providers.resolve(profile.providerId);
      if (
        provider === undefined ||
        !provider.capabilities.enabled ||
        provider.readLocalReadiness === undefined
      ) {
        accessComplete = false;
        continue;
      }
      try {
        const result = await this.bounded(() =>
          provider.readLocalReadiness!(
            state.aiConnections?.find(
              (connection) => profile.connectionId === connection.id,
            ),
          ),
        );
        boundaryBlocked ||= result.executionBlocker !== undefined;
        accessComplete &&=
          result.runtimeAvailable === true &&
          result.authenticationAvailable === true;
      } catch {
        accessUnavailable = true;
      }
    }
    checks.push(
      accessUnavailable
        ? unavailable(2)
        : check(
            2,
            accessComplete ? "complete" : "incomplete",
            accessComplete
              ? "Configured locally; service access is checked when work starts"
              : boundaryBlocked
                ? "AI sign-in and program configuration can be saved. This provider's native work permissions cannot yet be verified without security changes."
                : "Configure the selected provider's local runtime and supported authentication source, then retry.",
          ),
    );
    const tasksComplete =
      profiles.length === 4 &&
      F16_TASK_TYPES.every((task) => {
        const matches = profiles.filter((profile) => profile.taskType === task);
        const profile = matches[0];
        if (
          matches.length !== 1 ||
          profile === undefined ||
          !f16TaskProfileRevisionSchema.safeParse(profile).success ||
          !profile.enabled ||
          profile.availability !== "AVAILABLE"
        )
          return false;
        const capabilities = this.ports.providers.resolve(
          profile.providerId,
        )?.capabilities;
        const model = capabilities?.modelCatalog?.find(
          (item) => item.modelId === profile.modelId,
        );
        return (
          capabilities?.enabled === true &&
          capabilities.taskTypes.includes(task) &&
          model !== undefined &&
          (model.taskTypes === undefined || model.taskTypes.includes(task)) &&
          (profile.reasoningEffort === undefined ||
            (model.reasoningEfforts ?? capabilities.reasoningEfforts).includes(
              profile.reasoningEffort,
            )) &&
          (model.supportedOptionKeys === undefined ||
            Object.keys(profile.providerOptions).every((key) =>
              model.supportedOptionKeys!.includes(key),
            )) &&
          capabilities.providerOptionBounds !== undefined &&
          f16ProviderOptionsWithinBounds(
            profile.providerOptions,
            capabilities.providerOptionBounds,
          ) &&
          capabilities.outputContracts.some(
            (contract) =>
              contract.contractId === outputContractForTask(task).contractId,
          )
        );
      });
    checks.push(
      check(
        3,
        tasksComplete ? "complete" : "incomplete",
        tasksComplete
          ? "All four independent AI task profiles are enabled and available."
          : "Enable and validate all four independent AI task profiles in Preferences.",
      ),
    );
    const preset = f16PolicyPresetSummaries().find(
      (item) => item.preset === state.policy.preset,
    );
    const policyComplete =
      f16PolicyRevisionSchema.safeParse(state.policy).success &&
      f16OperationalPreferencesSchema.safeParse(state.operational).success &&
      preset !== undefined &&
      profiles.length === 4 &&
      profiles.every((profile) => {
        const capabilities = this.ports.providers.resolve(
          profile.providerId,
        )?.capabilities;
        const readOnly =
          profile.taskType === "AUTOMATIC_REVIEW_REEVALUATION" ||
          profile.taskType === "READ_ONLY_CONVERSATION";
        return (
          capabilities?.enabled === true &&
          capabilities.controlledEnvironment &&
          capabilities.sandboxModes.includes("read-only") &&
          (readOnly ||
            (preset.sandboxMode === "workspace-write" &&
              capabilities.sandboxModes.includes(preset.sandboxMode) &&
              capabilities.approvalPolicies.includes(preset.approvalPolicy) &&
              capabilities.networkModes.includes(preset.networkAccess) &&
              capabilities.worktreeAccess === "worktree_write" &&
              !preset.requiresInteractiveApproval))
        );
      });
    checks.push(
      check(
        4,
        policyComplete ? "complete" : "incomplete",
        policyComplete
          ? "The effective working policy and operational bounds are compatible with the configured tasks."
          : "Review the working policy and operational settings in Preferences and choose values supported by all tasks.",
      ),
    );
    return checks;
  }
}
