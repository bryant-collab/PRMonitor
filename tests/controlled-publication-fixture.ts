import {
  F23PublicationService as Actual,
  type F23PublicationServiceOptions,
} from "../apps/desktop/src/main/f23-release-service";

/** Only publication effect ports are controlled. Actual approvals, candidate
 * hashing, worktree inspection, uncertainty, retry and SQLite writes run. */
export class F23PublicationService extends Actual {
  constructor(options: F23PublicationServiceOptions) {
    const calls = {
      commit: 0,
      push: 0,
      reconcilePush: 0,
      post: 0,
      reconcileResponse: 0,
    };
    (
      globalThis as { __controlledPublicationCalls?: typeof calls }
    ).__controlledPublicationCalls = calls;
    const assertOwner = (owner: string) => {
      if (owner !== "guarded-final-review")
        throw Error("CONTROLLED_PUBLICATION_UNEXPECTED_OWNER");
    };
    super(
      process.env.PRMONITOR_E2E_STAGE === "conditional-publication"
        ? {
            ...options,
            git: {
              commitCandidate: async ({ candidate }) => {
                assertOwner(candidate.bundleId);
                calls.commit++;
                return { outcome: "COMMITTED", commitSha: "c".repeat(40) };
              },
              pushCommit: async ({ candidate }) => {
                assertOwner(candidate.bundleId);
                calls.push++;
                return {
                  outcome: "UNCERTAIN",
                  reason: "OWNED_REMOTE_OUTCOME_UNCERTAIN",
                };
              },
              reconcileCommit: async ({ candidate }) => {
                assertOwner(candidate.bundleId);
                return { outcome: "PRESENT", commitSha: "c".repeat(40) };
              },
              reconcilePush: async ({ candidate }) => {
                assertOwner(candidate.bundleId);
                calls.reconcilePush++;
                return { outcome: "PRESENT" };
              },
            },
            responses: {
              postResponse: async ({ ownerId }) => {
                assertOwner(ownerId);
                calls.post++;
                return calls.post === 1
                  ? { outcome: "FAILED", reason: "OWNED_RESPONSE_FAILURE" }
                  : {
                      outcome: "CONFIRMED",
                      remoteId: "owned-confirmed-response",
                    };
              },
              reconcileResponse: async ({ ownerId }) => {
                assertOwner(ownerId);
                calls.reconcileResponse++;
                return { outcome: "ABSENT" };
              },
            },
          }
        : options,
    );
  }
}
