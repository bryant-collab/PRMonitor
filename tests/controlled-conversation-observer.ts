import {
  F21AIWorkAdapter as Actual,
  type F21AIWorkInput,
} from "../apps/desktop/src/main/f21-ai-work-adapter";

/** Observe an actual adapter exception; preserve its result and thrown object. */
export class F21AIWorkAdapter extends Actual {
  public override async cancel(operationId: string) {
    const result = await super.cancel(operationId);
    (
      globalThis as { __controlledCancelResult?: unknown }
    ).__controlledCancelResult = {
      status: result?.readModel.operation.status,
      reason: result?.readModel.stopReason?.code,
      turnStatus: result?.readModel.operation.segments
        .flatMap((segment) => segment.turns)
        .at(-1)?.status,
      providerStatus: result?.readModel.reports.at(-1)?.providerStatus,
    };
    return result;
  }
  public override async startNewOperation(
    input: Parameters<Actual["startNewOperation"]>[0],
  ) {
    try {
      const result = await super.startNewOperation(input);
      (
        globalThis as { __controlledContinuationResult?: unknown }
      ).__controlledContinuationResult = {
        status: result.readModel.operation.status,
        remainingBudget: result.readModel.remainingBudget,
        nextAction: result.readModel.permittedNextAction,
        reason: result.readModel.reports.at(-1)?.terminalReason?.code,
        deterministicProblems: result.readModel.reports
          .at(-1)
          ?.progress?.remainingProblems.filter((problem) =>
            [
              "validation-not-passed",
              "human-decisions-incomplete",
              "worktree-not-resolved",
              "deterministic-evidence-unavailable",
              "fingerprint-input-invalid",
              "predicate-evaluation-failed",
            ].includes(problem),
          ),
      };
      return result;
    } catch (error) {
      const candidate = error as { name?: string; code?: string };
      (
        globalThis as { __controlledContinuationResult?: unknown }
      ).__controlledContinuationResult = {
        category: [
          "Error",
          "TypeError",
          "ZodError",
          "AIWorkControllerError",
          "PersistenceError",
        ].includes(candidate.name ?? "")
          ? candidate.name
          : "UNKNOWN",
        code: /^[A-Z0-9_]+$/.test(candidate.code ?? "")
          ? candidate.code
          : "UNCLASSIFIED",
      };
      throw error;
    }
  }
  public override async run(input: F21AIWorkInput) {
    try {
      const result = await super.run(input);
      (
        globalThis as { __controlledConversationResult?: unknown }
      ).__controlledConversationResult = {
        status: result.readModel.operation.status,
        providerStatus: result.readModel.reports.at(-1)?.providerStatus,
        remainingBudget: result.readModel.remainingBudget,
        nextAction: result.readModel.permittedNextAction,
        reason: result.readModel.reports.at(-1)?.terminalReason?.code,
        providerCode: (() => {
          const code =
            result.readModel.reports.at(-1)?.terminalReason?.details
              ?.providerCode;
          if (typeof code !== "string") return undefined;
          if (/^[A-Z0-9_]+$/.test(code)) return code;
          try {
            const issues = JSON.parse(code) as {
              code: string;
              path: unknown[];
            }[];
            return issues.slice(0, 12).map((issue) => ({
              code: issue.code,
              path: issue.path
                .filter(
                  (part) =>
                    typeof part === "number" ||
                    (typeof part === "string" && /^[a-zA-Z_]+$/.test(part)),
                )
                .join("."),
            }));
          } catch {
            return "UNCLASSIFIED";
          }
        })(),
      };
      return result;
    } catch (error) {
      const candidate = error as {
        name?: string;
        code?: string;
        message?: string;
        issues?: { code: string; path: (string | number)[] }[];
      };
      (
        globalThis as { __controlledConversationFailure?: unknown }
      ).__controlledConversationFailure = {
        category: [
          "Error",
          "TypeError",
          "ZodError",
          "AIWorkControllerError",
        ].includes(candidate.name ?? "")
          ? candidate.name
          : "UNKNOWN",
        code: /^[A-Z0-9_]+$/.test(candidate.code ?? candidate.message ?? "")
          ? (candidate.code ?? candidate.message)
          : "UNCLASSIFIED",
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
}
