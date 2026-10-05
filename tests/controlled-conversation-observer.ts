import {
  F21AIWorkAdapter as Actual,
  type F21AIWorkInput,
} from "../apps/desktop/src/main/f21-ai-work-adapter";

/** Observe an actual adapter exception; preserve its result and thrown object. */
export class F21AIWorkAdapter extends Actual {
  public override async run(input: F21AIWorkInput) {
    try {
      const result = await super.run(input);
      (
        globalThis as { __controlledConversationResult?: unknown }
      ).__controlledConversationResult = {
        status: result.readModel.operation.status,
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
            return issues
              .slice(0, 12)
              .map((issue) => ({
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
