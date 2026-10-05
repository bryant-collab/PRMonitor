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
    handler(request) {
      observations.push(request.outputContract.contractId);
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
