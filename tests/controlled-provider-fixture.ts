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
      const outcome = (globalThis as { __controlledReadOnlyOutcome?: string })
        .__controlledReadOnlyOutcome;
      if (
        request.outputContract.contractId === "READ_ONLY_CONVERSATION" &&
        outcome === "FAILED"
      )
        return {
          status: "failed",
          error: {
            code: "OWNED_PROVIDER_FAILURE",
            category: "PROVIDER",
            retryable: true,
            userAction: "RETRY_EXPLICITLY",
          },
        };
      if (
        request.outputContract.contractId === "READ_ONLY_CONVERSATION" &&
        outcome === "INVALID"
      )
        return {
          structuredResult: {
            schemaVersion: 1,
            interaction: "read_only",
            answer: 42,
          },
        };
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
    get capabilities() {
      return {
        ...provider.capabilities,
        modelCatalog: [
          ...(provider.capabilities.modelCatalog ?? []),
          {
            modelId: "gpt-6-astra",
            supportedOptionKeys: [],
            reasoningEfforts: [
              "low" as const,
              "medium" as const,
              "high" as const,
            ],
          },
        ],
        enabled:
          (globalThis as { __controlledProviderUnavailable?: boolean })
            .__controlledProviderUnavailable !== true,
      };
    },
    readLocalReadiness: () => ({
      runtimeAvailable: true,
      authenticationAvailable: true,
    }),
    invoke: (request, options) => provider.invoke(request, options),
  };
}

// Other tools are deliberately unavailable in the deterministic Windows journey.
// Any attempted invocation proves an unintended provider effect.
export function createClaudeProvider(): AIProvider {
  return {
    id: "claude",
    capabilities: {
      ...new FakeAIProvider().capabilities,
      providerId: "claude",
    },
    readLocalReadiness: () => ({
      runtimeAvailable: false,
      authenticationAvailable: false,
    }),
    invoke: async () => {
      throw new Error("CONTROLLED_UNEXPECTED_CLAUDE_INVOCATION");
    },
  };
}
export function createCopilotProvider(): AIProvider {
  return {
    id: "copilot",
    capabilities: {
      ...new FakeAIProvider().capabilities,
      providerId: "copilot",
    },
    readLocalReadiness: () => ({
      runtimeAvailable: false,
      authenticationAvailable: false,
    }),
    invoke: async () => {
      throw new Error("CONTROLLED_UNEXPECTED_COPILOT_INVOCATION");
    },
  };
}
