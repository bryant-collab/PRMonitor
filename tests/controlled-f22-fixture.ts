import {
  F22Coordinator as Actual,
  type F22CoordinatorOptions,
} from "../apps/desktop/src/main/f22-coordinator";

/** Substitute only the remote read effect; actual F22/F11/F13 guards remain. */
export class F22Coordinator extends Actual {
  public override async beginReevaluation(
    input: Parameters<Actual["beginReevaluation"]>[0],
  ) {
    try {
      return await super.beginReevaluation(input);
    } catch (error) {
      const candidate = error as {
        name?: string;
        reason?: { code?: string; stage?: string };
        issues?: { code: string; path: (string | number)[] }[];
      };
      (
        globalThis as { __controlledF22Failure?: unknown }
      ).__controlledF22Failure = {
        category: [
          "Error",
          "TypeError",
          "ZodError",
          "PersistenceError",
        ].includes(candidate.name ?? "")
          ? candidate.name
          : "UNKNOWN",
        code: /^[A-Z0-9_]+$/.test(candidate.reason?.code ?? "")
          ? candidate.reason?.code
          : "UNCLASSIFIED",
        stage: /^[a-z_]+$/.test(candidate.reason?.stage ?? "")
          ? candidate.reason?.stage
          : "UNKNOWN",
        issues: candidate.issues?.slice(0, 12).map((issue) => ({
          code: issue.code,
          path: issue.path
            .filter(
              (part) => typeof part === "number" || /^[a-zA-Z_]+$/.test(part),
            )
            .join("."),
        })),
      };
      throw error;
    }
  }
  constructor(options: F22CoordinatorOptions) {
    super({
      ...options,
      remote: [
        "conditional-f22",
        "conditional-provider",
        "conditional-publication",
      ].includes(process.env.PRMONITOR_E2E_STAGE ?? "")
        ? {
            readCurrentHead: async (managedPrId) => {
              if (managedPrId !== "guarded-final-pr")
                throw Error("CONTROLLED_F22_UNEXPECTED_SCOPE");
              const bundle = options.bundles.getReadModel?.(
                "guarded-final-review",
              );
              const state = options.persistence.getBundleState(
                "guarded-final-review",
              );
              if (!bundle || !state)
                throw Error("CONTROLLED_F22_STATE_MISSING");
              const moved =
                (globalThis as { __controlledF22Moved?: boolean })
                  .__controlledF22Moved === true;
              return {
                outcome: "CURRENT",
                identity: state.identity,
                baseSha: bundle.input.pullRequest.baseSha,
                headSha: moved
                  ? "c".repeat(40)
                  : bundle.input.pullRequest.headSha,
                baseRepository: bundle.input.pullRequest.baseRepository,
                headRepository: bundle.input.pullRequest.headRepository,
                baseBranch: bundle.input.pullRequest.baseBranch,
                headBranch: bundle.input.pullRequest.headBranch,
                observationRevision: moved ? 2 : 1,
                observedAt: new Date().toISOString(),
              };
            },
          }
        : options.remote,
    });
    if (process.env.PRMONITOR_E2E_STAGE === "conditional-f22")
      (
        globalThis as {
          __controlledF22ObserveMoved?: () => Promise<unknown>;
          __controlledF22Moved?: boolean;
        }
      ).__controlledF22ObserveMoved = async () => {
        (
          globalThis as { __controlledF22Moved?: boolean }
        ).__controlledF22Moved = true;
        return this.observeRemoteHead("guarded-final-review");
      };
  }
}
