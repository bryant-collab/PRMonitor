import { PersistenceError } from "./persistence/types";
import { parseOpenTarget, type OpenTarget } from "../shared/routing";
import {
  SETUP_CHECK_IDS,
  type SetupReadiness,
} from "../shared/setup-readiness";

/** Bootstrap failure never supplies replacement state or admits domain work. */
export function startupRecoveryReadiness(
  error: unknown,
  revision: number,
): SetupReadiness {
  const code =
    error instanceof PersistenceError ? error.reason.code : undefined;
  const description =
    code === "CORRUPT_DATABASE" || code === "INTEGRITY_CHECK_FAILED"
      ? "Application storage needs recovery. Preserve the original database and recover it from a verified backup before retrying application startup."
      : code === "UNSUPPORTED_SCHEMA_VERSION"
        ? "The saved database requires a compatible application version. Preserve the original database and retry with the supported version."
        : "Application storage or the worktree root could not be initialized safely. Check local path permissions, preserve existing data, and retry application startup.";
  const remediations = ["local", "github", "ai", "tasks", "policy"] as const;
  return {
    schemaVersion: 1,
    revision,
    ready: false,
    completedCount: 0,
    checks: SETUP_CHECK_IDS.map((id, index) => ({
      id,
      status: index === 0 ? "incomplete" : "temporarily-unavailable",
      remediation: remediations[index]!,
      description:
        index === 0
          ? description
          : "Saved configuration cannot be read until local startup recovery succeeds. Retry after resolving the local problem.",
    })),
  };
}

export function startupRecoveryRelaunchArguments(
  args: readonly string[],
  target?: OpenTarget,
): string[] {
  if (target === undefined) return [...args];
  const hosts = {
    HOME: "home",
    MANAGED_PR: "pr",
    MANAGED_PR_SETTINGS: "pr-settings",
    REVIEW_BUNDLE: "review-bundle",
    SYNCHRONIZATION_BATCH: "sync-batch",
    SYNCHRONIZATION_RESULT: "sync-result",
  } as const;
  const uri = `prmonitor://${hosts[target.kind]}${target.id === undefined ? "" : `/${target.id}`}`;
  if (!parseOpenTarget(uri).ok) return [...args];
  return [...args.filter((arg) => !arg.startsWith("prmonitor:")), uri];
}
