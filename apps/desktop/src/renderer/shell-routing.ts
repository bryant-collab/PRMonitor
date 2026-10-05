import {
  parseOpenTargetRecord,
  type OpenTarget,
  type OpenTargetKind,
} from "../shared/routing";

export function savedWorkTarget(
  kind: Exclude<OpenTargetKind, "HOME">,
  id: string,
): OpenTarget {
  const result = parseOpenTargetRecord({
    schemaVersion: 1,
    kind,
    id,
    requestId: "route-renderer-saved-work",
  });
  if (!result.ok) throw Error("SAVED_TARGET_INVALID");
  return result.value;
}

export type ShellDestination =
  | "home"
  | "inbox"
  | "setup"
  | "activity"
  | "settings"
  | "github"
  | "diagnostics"
  | "managed"
  | "target"
  | "connection";
export type PrDetailTab =
  "overview" | "review" | "sync" | "activity" | "settings";
export type SettingsCategory =
  | "github"
  | "tasks"
  | "policy"
  | "operational"
  | "instructions"
  | "repository"
  | "setup"
  | "support";
export interface ShellRoute {
  readonly activation: number;
  readonly destination: ShellDestination;
  readonly selectedManagedPrId?: string;
  readonly detailTab: PrDetailTab;
  readonly target?: OpenTarget;
  readonly reviewBundleId?: string;
  readonly synchronizationBatchId?: string;
  readonly synchronizationResultId?: string;
}
export const initialShellRoute: ShellRoute = {
  activation: 0,
  destination: "home",
  detailTab: "overview",
};

/** Navigation selects a view. Domain commands are deliberately outside this controller. */
export function routeOpenTarget(
  current: ShellRoute,
  target: OpenTarget,
): ShellRoute {
  current = { ...current, activation: current.activation + 1 };
  switch (target.kind) {
    case "HOME":
      return { ...current, destination: "home" };
    case "MANAGED_PR":
    case "MANAGED_PR_SETTINGS":
      return {
        ...current,
        destination: "inbox",
        selectedManagedPrId: target.id,
        detailTab:
          target.kind === "MANAGED_PR_SETTINGS" ? "settings" : "overview",
        target,
      };
    case "REVIEW_BUNDLE":
      return {
        ...current,
        destination: "target",
        target,
        reviewBundleId: target.id,
      };
    case "SYNCHRONIZATION_BATCH":
      return {
        ...current,
        destination: "target",
        target,
        synchronizationBatchId: target.id,
        synchronizationResultId: undefined,
      };
    case "SYNCHRONIZATION_RESULT":
      return {
        ...current,
        destination: "target",
        target,
        synchronizationBatchId: undefined,
        synchronizationResultId: target.id,
      };
  }
}

export function routeAfterPrRemoval(
  current: ShellRoute,
  ids: readonly string[],
): ShellRoute {
  return current.selectedManagedPrId !== undefined &&
    !ids.includes(current.selectedManagedPrId)
    ? { ...current, selectedManagedPrId: undefined, detailTab: "overview" }
    : current;
}
