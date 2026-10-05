import {
  F27SynchronizationService as Actual,
  type F27SynchronizationServiceOptions,
} from "../apps/desktop/src/main/f27-synchronization-service";

/** Actual F25/F26/F27/F13 services and persistence; only remote freshness,
 * new-preparation acknowledgement and Git publication effects are controlled. */
export class F27SynchronizationService extends Actual {
  constructor(options: F27SynchronizationServiceOptions) {
    const calls = {
      commit: 0,
      push: 0,
      reconcileCommit: 0,
      reconcilePush: 0,
      reevaluate: 0,
    };
    (
      globalThis as { __controlledSyncCalls?: typeof calls }
    ).__controlledSyncCalls = calls;
    const check = (operationId: string) => {
      if (!/^guarded-sync-[123]$/.test(operationId))
        throw Error("CONTROLLED_SYNC_UNEXPECTED_OWNER");
    };
    super(
      process.env.PRMONITOR_E2E_STAGE === "conditional-sync"
        ? {
            ...options,
            freshness: {
              read: async (input) => {
                check(input.operationId);
                return {
                  outcome: "CURRENT",
                  checkedAt: new Date().toISOString(),
                  sourceSha: input.expectedSourceSha,
                  headSha: input.expectedHeadSha,
                  state: "OPEN",
                  merged: false,
                  sourceRepositoryKey: input.sourceRepositoryKey,
                  destinationRepositoryKey: input.destinationRepositoryKey,
                  sourceBranch: input.sourceBranch,
                  destinationBranch: input.destinationBranch,
                };
              },
            },
            reevaluation: {
              start: async (input) => {
                check(input.operationId);
                calls.reevaluate++;
                return {
                  status: "ACKNOWLEDGED",
                  batchId: "owned-new-sync-batch",
                  operationId: "owned-new-sync-operation",
                };
              },
            },
            git: {
              commitMerge: async ({ candidate }) => {
                check(candidate.operationId);
                calls.commit++;
                return { outcome: "COMMITTED", commitSha: "c".repeat(40) };
              },
              pushMerge: async ({ candidate }) => {
                check(candidate.operationId);
                calls.push++;
                return { outcome: "UNCERTAIN", reason: "OWNED_PUSH_UNCERTAIN" };
              },
              reconcileCommit: async ({ candidate }) => {
                check(candidate.operationId);
                calls.reconcileCommit++;
                return { outcome: "PRESENT", commitSha: "c".repeat(40) };
              },
              reconcilePush: async ({ candidate }) => {
                check(candidate.operationId);
                calls.reconcilePush++;
                return calls.reconcilePush === 1
                  ? { outcome: "UNKNOWN", reason: "OWNED_REMOTE_UNCERTAIN" }
                  : { outcome: "PRESENT" };
              },
            },
          }
        : options,
    );
  }
}
