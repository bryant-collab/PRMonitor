/** Test-only provider port; never imported by production sources. */
import { FakeAIProvider } from "../apps/desktop/src/main/ai/fake-provider";
import type { AIProvider } from "../apps/desktop/src/main/ai/registry";

export function createCodexProvider(): AIProvider {
  const observations = [] as string[];
  (
    globalThis as { __controlledProviderContracts?: string[] }
  ).__controlledProviderContracts = observations;
  const provider = new FakeAIProvider({
    id: "codex",
    async handler(request, options) {
      observations.push(request.outputContract.contractId);
      if (
        request.outputContract.contractId === "REVIEW_IMPLEMENTATION" &&
        (globalThis as { __controlledProviderWaitForCancel?: boolean })
          .__controlledProviderWaitForCancel === true
      ) {
        if (options.signal === undefined)
          throw Error("CONTROLLED_PROVIDER_MISSING_ABORT_SIGNAL");
        await new Promise<void>((resolve) => {
          if (options.signal!.aborted) resolve();
          else
            options.signal!.addEventListener("abort", () => resolve(), {
              once: true,
            });
        });
        return { status: "cancelled" };
      }
      if (
        request.outputContract.contractId === "REVIEW_IMPLEMENTATION" &&
        (globalThis as { __controlledProviderNeedsMore?: boolean })
          .__controlledProviderNeedsMore === true
      )
        return {
          structuredResult: {
            schemaVersion: 1,
            summary:
              "The owned fixture needs another explicitly authorized turn.",
            problems: [],
            remainingIssues: [
              "A further fixture turn requires an explicit budget.",
            ],
            outcomes: (request.input.humanDecisions ?? []).map((decision) => ({
              remoteEventVersionId: decision.remoteEventVersionId,
              decision: decision.disposition,
              outcome: "blocked",
              remainingIssues: [
                "The controlled provider performed no code mutation.",
              ],
              relatedFiles: [],
            })),
          },
          usage: { inputTokens: 5, outputTokens: 7, totalTokens: 12 },
        };
      if (request.outputContract.contractId !== "READ_ONLY_CONVERSATION")
        throw Error("CONTROLLED_PROVIDER_UNEXPECTED_TASK");
      return {
        structuredResult: {
          schemaVersion: 1,
          interaction: "read_only",
          answer:
            "Owned deterministic answer transferred from the controlled provider port.",
        },
        usage: { inputTokens: 5, outputTokens: 7, totalTokens: 12 },
      };
    },
  });
  return {
    id: provider.id,
    capabilities: provider.capabilities,
    readLocalReadiness: () => ({
      runtimeAvailable: true,
      authenticationAvailable: true,
    }),
    invoke: (request, options) => provider.invoke(request, options),
  };
}
