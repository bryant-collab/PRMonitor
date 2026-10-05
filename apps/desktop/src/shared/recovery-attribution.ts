/** These registered adapters enumerate a managed PR, or one empty application check. */
export const MANAGED_PR_RECOVERY_ADAPTERS = [
  { owner: "f28-scheduler", kind: "managed_pr", emptyId: "scheduler" },
  { owner: "f28-holds", kind: "managed_pr", emptyId: "holds" },
  { owner: "f28-local-work", kind: "managed_pr", emptyId: "local-work" },
  { owner: "f28-ai", kind: "ai_operation", emptyId: "ai-work" },
  {
    owner: "f28-review-publication",
    kind: "publication",
    emptyId: "review-publication",
  },
  {
    owner: "f28-sync-publication",
    kind: "publication",
    emptyId: "sync-publication",
  },
] as const;
export interface RecoveryScopeIdentity {
  readonly owner: string;
  readonly kind: string;
  readonly id: string;
}
export function isEmptyRecoveryScope(scope: RecoveryScopeIdentity): boolean {
  return MANAGED_PR_RECOVERY_ADAPTERS.some(
    (adapter) =>
      adapter.owner === scope.owner &&
      adapter.kind === scope.kind &&
      adapter.emptyId === scope.id,
  );
}
export function recoveryScopeManagedPrId(
  scope: RecoveryScopeIdentity,
): string | undefined {
  return !isEmptyRecoveryScope(scope) &&
    (scope.kind === "managed_pr" ||
      MANAGED_PR_RECOVERY_ADAPTERS.some(
        (adapter) =>
          adapter.owner === scope.owner && adapter.kind === scope.kind,
      ))
    ? scope.id
    : undefined;
}
export function recoveryActivityAttribution(
  scope: RecoveryScopeIdentity | undefined,
): {
  readonly owner?: { readonly type: string; readonly id: string };
  readonly managedPrId?: string;
} {
  if (scope === undefined) return {};
  if (scope.kind === "application" || isEmptyRecoveryScope(scope))
    return { owner: { type: "APPLICATION", id: scope.id } };
  const managedPrId = recoveryScopeManagedPrId(scope);
  return managedPrId === undefined
    ? { owner: { type: scope.kind, id: scope.id } }
    : { owner: { type: "MANAGED_PR", id: managedPrId }, managedPrId };
}
