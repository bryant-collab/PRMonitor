import { describe, expect, it } from "vitest";
import {
  AIProviderRequestSchema,
  AIReviewProposalSchema,
  aiProviderOutputContractSchema,
  generateAIProviderJsonSchema,
  outputContractForTask,
  parseAIProviderStructuredResult,
  type AIProviderRequest,
} from "../src/shared/ai/provider-contracts";
import {
  AIProviderRegistry,
  type AIProviderInvokeOptions,
} from "../src/main/ai/registry";
import {
  defaultFakeAIProviderCapabilities,
  FakeAIProvider,
} from "../src/main/ai/fake-provider";
import {
  CodexAdapter,
  type CodexAdapterOptions,
  type CodexRuntimePort,
  type CodexThreadOptions,
} from "../src/main/ai/codex-adapter";

const FIXED_TIME = "2026-09-23T00:00:00.000Z";

function worktree(
  access: "READ_ONLY" | "WORKTREE_WRITE" = "READ_ONLY",
): NonNullable<AIProviderRequest["worktree"]> {
  return {
    schemaVersion: 1,
    operationId: "operation-1",
    worktreeId: "worktree-1",
    ownerType: "REVIEW_BUNDLE",
    ownerId: "bundle-1",
    operationKind: "REVIEW",
    canonicalPath: "C:/PRMonitor/operation-worktrees/operation-1",
    access,
    ownership: {
      kind: "OPERATION_OWNED",
      ownerType: "REVIEW_BUNDLE",
      ownerId: "bundle-1",
    },
    actualState: {
      snapshotId: "snapshot-1",
      stateFingerprint: "state-1",
      baselineRevision: "base-sha",
      expectedHeadRevision: "head-sha",
      currentHeadRevision: "head-sha",
      files: [],
      ignoredFiles: [],
      complete: true,
    },
    permittedCapabilities: {
      readFiles: true,
      writeFiles: access === "WORKTREE_WRITE",
      executeCommands: false,
      network: false,
      publication: false,
    },
  };
}

function request(
  providerId: "fake" | "codex" | "limited",
  taskType: AIProviderRequest["taskType"] = "AUTOMATIC_REVIEW_REEVALUATION",
  interactionMode: AIProviderRequest["interactionMode"] = "read_only",
  access: "READ_ONLY" | "WORKTREE_WRITE" = "READ_ONLY",
): AIProviderRequest {
  const codeTask = taskType !== "READ_ONLY_CONVERSATION";
  return {
    schemaVersion: 1,
    requestId: `request-${providerId}`,
    operationId: "operation-1",
    turnId: `turn-${providerId}`,
    providerId,
    modelId: "gpt-5-codex",
    taskType,
    interactionMode,
    profileSnapshot: {
      schemaVersion: 1,
      profileId: "automatic-review",
      profileRevision: 7,
      providerId,
      modelId: "gpt-5-codex",
      taskType,
      reasoningEffort: "medium",
      commonInstructions: "Use deterministic evidence.",
      repositoryInstructions: "Keep the patch focused.",
      buildAndValidationInstructions: "Run the configured checks.",
      outputContractId: outputContractForTask(taskType).contractId,
    },
    executionPolicySnapshot: {
      schemaVersion: 1,
      snapshotHash: "policy-hash-1",
      policyId: "READ_ONLY_WORKTREE",
      revision: 2,
      sandboxMode:
        interactionMode === "read_only" ? "read-only" : "workspace-write",
      approvalPolicy: "never",
      networkAccess: "disabled",
      writableRoot:
        interactionMode === "worktree_write"
          ? "C:/PRMonitor/operation-worktrees/operation-1"
          : undefined,
      controlledEnvironment: { mode: "explicit", allowedKeys: [] },
    },
    ...(codeTask ? { worktree: worktree(access) } : {}),
    input: {
      schemaVersion: 1,
      remoteEventVersionIds: ["event-1", "event-2"],
      eventVersionIds: ["event-1", "event-2"],
      pullRequest: {
        baseRepository: { serverId: "server-1", owner: "owner", name: "repo" },
        headRepository: { serverId: "server-1", owner: "owner", name: "repo" },
        baseBranch: "main",
        headBranch: "feature",
        baseSha: "base-sha",
        headSha: "head-sha",
      },
      instructions: {
        commonInstructions: "Use deterministic evidence.",
        repositoryInstructions: "Keep the patch focused.",
        buildAndValidationInstructions: "Run the configured checks.",
      },
      humanDecisions: [
        { remoteEventVersionId: "event-1", disposition: "fixed" },
        { remoteEventVersionId: "event-2", disposition: "no_change" },
      ],
      validationEvidence: [{ status: "not_run" }],
      contextReferences: ["pr-snapshot-1", "instructions-1"],
    },
    outputContract: outputContractForTask(taskType),
    invocation: {
      timeoutMs: 30_000,
      maxOutputBytes: 64 * 1024,
      streamEvents: true,
    },
  };
}

function proposalFor(eventIds: readonly string[]): Record<string, unknown> {
  return {
    schemaVersion: 1,
    summary: "The fixture accounted for every event.",
    items: eventIds.map((remoteEventVersionId) => ({
      remoteEventVersionId,
      assessment: "actionable",
      disposition: "no_change",
      explanation: "The fixture found no deterministic change to make.",
      relatedFiles: [],
    })),
  };
}

describe("F15 provider-neutral contracts", () => {
  it("generates deterministic structured-output schemas and rejects prose/unknown fields", () => {
    const contract = outputContractForTask("AUTOMATIC_REVIEW_REEVALUATION");
    const first = JSON.stringify(generateAIProviderJsonSchema(contract));
    const second = JSON.stringify(generateAIProviderJsonSchema(contract));
    expect(first).toBe(second);
    expect(aiProviderOutputContractSchema.parse(contract).contractId).toBe(
      "REVIEW_PROPOSAL",
    );

    const parsed = parseAIProviderStructuredResult(
      contract,
      proposalFor(["event-1", "event-2"]),
      ["event-1", "event-2"],
    );
    expect(parsed.success).toBe(true);

    const unknownField = parseAIProviderStructuredResult(contract, {
      ...proposalFor(["event-1"]),
      fileChanges: ["src/unsafe.ts"],
    });
    expect(unknownField).toMatchObject({
      success: false,
      code: "INVALID_STRUCTURED_OUTPUT",
    });
    const missingEvent = parseAIProviderStructuredResult(
      contract,
      proposalFor(["event-1"]),
      ["event-1", "event-2"],
    );
    expect(missingEvent).toMatchObject({
      success: false,
      code: "INVALID_STRUCTURED_OUTPUT",
    });
    expect(() =>
      AIReviewProposalSchema.parse({ summary: "prose only" }),
    ).toThrow();
    expect(() =>
      AIProviderRequestSchema.parse({
        ...request("fake"),
        unexpected: "provider object",
      }),
    ).toThrow();
  });

  it("keeps the request bounded and rejects secret-shaped snapshots", () => {
    expect(() =>
      AIProviderRequestSchema.parse({
        ...request("fake"),
        input: {
          ...request("fake").input,
          validationEvidence: [{ apiKey: "not allowed" }],
        },
      }),
    ).toThrow();
    expect(() =>
      AIProviderRequestSchema.parse({
        ...request("fake"),
        input: {
          ...request("fake").input,
          validationEvidence: [{ output: "x".repeat(65 * 1024) }],
        },
      }),
    ).toThrow();
  });
});

describe("F15 registry and fake provider", () => {
  it("admits a fake provider through one boundary and refuses before start", async () => {
    const fake = new FakeAIProvider({ now: () => FIXED_TIME });
    const registry = new AIProviderRegistry({ now: () => FIXED_TIME });
    registry.register(fake);
    expect(registry.resolve("fake")).toBe(fake);
    expect(() => registry.register(fake)).toThrow("AI_PROVIDER_DUPLICATE");

    const result = await registry.invoke(request("fake"));
    expect(result.status).toBe("completed");
    expect(result.structuredResult).toMatchObject({ schemaVersion: 1 });
    expect(fake.startedRequests).toHaveLength(1);

    const limited = new FakeAIProvider({
      id: "limited",
      capabilities: {
        ...defaultFakeAIProviderCapabilities,
        providerId: "limited",
        sandboxModes: ["read-only"],
        worktreeAccess: "read_only",
      },
      now: () => FIXED_TIME,
    });
    registry.register(limited);
    const unsupported = await registry.invoke(
      request("limited", "REVIEW_REVISION", "worktree_write", "WORKTREE_WRITE"),
    );
    expect(unsupported.error?.code).toBe("CAPABILITY_UNSUPPORTED");
    expect(limited.startedRequests).toHaveLength(0);

    const controller = new AbortController();
    controller.abort("USER_CANCELLED");
    const cancelled = await registry.invoke(request("fake"), {
      signal: controller.signal,
      now: () => FIXED_TIME,
    });
    expect(cancelled.status).toBe("failed");
    expect(cancelled.error?.code).toBe("CANCELLED");
    expect(fake.startedRequests).toHaveLength(1);
  });
});

describe("F15 Codex adapter fixture boundary", () => {
  it("translates the exact read-only worktree and controlled environment", async () => {
    let capturedEnvironment: Record<string, string> | undefined;
    let capturedThreadOptions: CodexThreadOptions | undefined;
    let capturedPrompt: string | undefined;
    let capturedRunOptions: AIProviderInvokeOptions | undefined;
    const fixtureRequest = request("codex");
    const fixtureOutput = JSON.stringify(
      proposalFor(fixtureRequest.input.remoteEventVersionIds),
    );
    async function* events(): AsyncGenerator<unknown> {
      yield { type: "thread.started", thread_id: "thread-fixture-1" };
      yield { type: "turn.started" };
      yield {
        type: "item.completed",
        item: { type: "agent_message", text: fixtureOutput },
      };
      yield {
        type: "turn.completed",
        usage: {
          input_tokens: 10,
          cached_input_tokens: 2,
          cache_write_input_tokens: 1,
          output_tokens: 5,
          reasoning_output_tokens: 3,
          total_tokens: 21,
        },
      };
    }
    const runtime: CodexRuntimePort = {
      createClient: ({ env }) => {
        capturedEnvironment = env;
        return {
          startThread: (options) => {
            capturedThreadOptions = options;
            return {
              id: "thread-fixture-1",
              runStreamed: async (prompt, runOptions) => {
                capturedPrompt = prompt;
                capturedRunOptions =
                  runOptions as unknown as AIProviderInvokeOptions;
                return { events: events() };
              },
            };
          },
          resumeThread: () => {
            throw new Error("fixture does not resume here");
          },
        };
      },
    };
    const options: CodexAdapterOptions = {
      runtime,
      now: () => FIXED_TIME,
      baseEnvironment: {
        PATH: "C:/tools",
        GITHUB_TOKEN: "github-secret",
        UNRELATED_PARENT_VALUE: "must-not-cross",
      },
      providerAuthenticationEnvironment: { OPENAI_API_KEY: "provider-secret" },
    };
    const adapter = new CodexAdapter(options);
    const result = await adapter.invoke({
      ...fixtureRequest,
      executionPolicySnapshot: {
        ...fixtureRequest.executionPolicySnapshot,
        controlledEnvironment: {
          mode: "explicit",
          allowedKeys: ["PATH", "OPENAI_API_KEY"],
        },
      },
    });

    expect(result.status).toBe("completed");
    expect(result.usage).toEqual({
      inputTokens: 10,
      cachedInputTokens: 2,
      cacheWriteInputTokens: 1,
      outputTokens: 5,
      reasoningOutputTokens: 3,
      totalTokens: 21,
    });
    expect(capturedThreadOptions).toEqual({
      model: "gpt-5-codex",
      modelReasoningEffort: "medium",
      sandboxMode: "read-only",
      workingDirectory: "C:/PRMonitor/operation-worktrees/operation-1",
      networkAccessEnabled: false,
      approvalPolicy: "never",
    });
    expect(capturedThreadOptions).not.toHaveProperty("additionalDirectories");
    expect(capturedThreadOptions).not.toHaveProperty("skipGitRepoCheck");
    expect(capturedEnvironment).toEqual({
      PATH: "C:/tools",
      OPENAI_API_KEY: "provider-secret",
    });
    expect(capturedPrompt).toContain("REVIEW_PROPOSAL");
    expect(capturedPrompt).not.toContain("provider-secret");
    expect(capturedPrompt).not.toContain(
      "C:/PRMonitor/operation-worktrees/operation-1",
    );
    expect(capturedRunOptions).toMatchObject({ signal: undefined });
    expect(result.conversationReference).toMatchObject({
      providerId: "codex",
      opaqueReference: "thread-fixture-1",
      resumable: true,
    });
    expect(result.events.map((item) => item.sequence)).toEqual(
      result.events.map((_item, index) => index),
    );
    expect(JSON.stringify(result)).not.toContain("github-secret");
    expect(JSON.stringify(result)).not.toContain("provider-secret");
  });

  it("fails closed for malformed structured output and unsupported policy", async () => {
    const invalidRuntime: CodexRuntimePort = {
      createClient: () => ({
        startThread: () => ({
          id: "thread-invalid",
          runStreamed: async () => ({
            events: (async function* (): AsyncGenerator<unknown> {
              yield { type: "turn.started" };
              yield {
                type: "item.completed",
                item: { type: "agent_message", text: "not-json-proposal" },
              };
              yield { type: "turn.completed", usage: {} };
            })(),
          }),
        }),
        resumeThread: () => {
          throw new Error("not supported");
        },
      }),
    };
    const adapter = new CodexAdapter({
      runtime: invalidRuntime,
      now: () => FIXED_TIME,
    });
    const invalid = await adapter.invoke(request("codex"));
    expect(invalid.status).toBe("failed");
    expect(invalid.error?.code).toBe("INVALID_STRUCTURED_OUTPUT");

    const started: string[] = [];
    const runtime: CodexRuntimePort = {
      createClient: () => {
        started.push("started");
        throw new Error("must not start");
      },
    };
    const registry = new AIProviderRegistry({ now: () => FIXED_TIME });
    registry.register(
      new (class extends CodexAdapter {
        public override readonly id = "codex";
        public override readonly capabilities = {
          ...defaultFakeAIProviderCapabilities,
          providerId: "codex",
        };
      })({ runtime }),
    );
    const refused = await registry.invoke({
      ...request("codex"),
      executionPolicySnapshot: {
        ...request("codex").executionPolicySnapshot,
        approvalPolicy: "on-request",
      },
    });
    expect(refused.error?.code).toBe("POLICY_UNSUPPORTED");
    expect(started).toHaveLength(0);
  });
});
