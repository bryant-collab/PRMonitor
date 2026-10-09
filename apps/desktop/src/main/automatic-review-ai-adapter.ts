import {
  aiProviderRequestSchema,
  outputContractForTask,
  parseAIProviderStructuredResult,
  type AIProviderInputSnapshot,
  type AIProviderRequest,
  type AIProviderWorktreeReference,
} from "../shared/ai/provider-contracts";
import {
  aiWorkOperationInputSchema,
  type AIWorkOperationInput,
  type AIWorkPersistencePort,
  type AIWorkReadModel,
  type AIWorkTurnIntent,
  type AIWorkValidationEvidence,
  type AIWorkWorktreeEvidence,
} from "../shared/ai-work";
import type { F16EffectiveAITaskSnapshot } from "../shared/f16-preferences";
import type {
  F13AiTurnBeforeResult,
  F13AiTurnAfterResult,
  F13ProviderWorktreeHandoff,
} from "../shared/f13-contracts";
import {
  AIWorkController,
  type AIWorkEvidencePort,
  type AIWorkProviderPort,
} from "./ai-work-controller";
import type {
  F18AiWorkInput,
  F18F13Port,
  F18F14Port,
  F18ValidationPort,
} from "./automatic-review-coordinator";
import type {
  F18AiWorkResult,
  F18AiWorkSummary,
  F18ValidationEvidence,
} from "../shared/f18-automatic-review";

interface ActiveF18AiInput extends F18AiWorkInput {
  readonly providerInput: AIProviderInputSnapshot;
}

export interface F18AIWorkAdapterOptions {
  readonly persistence: AIWorkPersistencePort;
  readonly provider: AIWorkProviderPort;
  readonly f13: F18F13Port & {
    readonly beginAiTurn?: (input: {
      readonly operationId: string;
      readonly ownerId: string;
      readonly turnId: string;
      readonly acknowledgeUnattributedChanges?: boolean;
    }) => Promise<F13AiTurnBeforeResult>;
    readonly completeAiTurn?: (input: {
      readonly operationId: string;
      readonly ownerId: string;
      readonly turnId: string;
      readonly beforeSnapshotId: string;
    }) => Promise<F13AiTurnAfterResult>;
  };
  readonly f14?: F18F14Port;
  readonly validation?: F18ValidationPort;
  readonly clock?: () => string;
}

function now(clock: (() => string) | undefined): string {
  return clock?.() ?? new Date().toISOString();
}

function sanitizedTaskSnapshot(
  snapshot: F16EffectiveAITaskSnapshot,
  operationId: string,
): F16EffectiveAITaskSnapshot {
  const validation = snapshot.buildValidation?.validation;
  const safeBuildValidation =
    snapshot.buildValidation === undefined
      ? undefined
      : {
          ...snapshot.buildValidation,
          validation:
            validation === undefined
              ? validation
              : {
                  ...validation,
                  // F17 persistence only needs provider-neutral validation
                  // status; F14 owns the full authorization reference.
                  authorization: undefined,
                },
        };
  const build =
    safeBuildValidation === undefined
      ? {}
      : {
          buildValidation: {
            ...safeBuildValidation,
            validation:
              safeBuildValidation.validation === undefined
                ? safeBuildValidation.validation
                : Object.fromEntries(
                    Object.entries(safeBuildValidation.validation).filter(
                      ([key, value]) =>
                        value !== undefined && key !== "authorization",
                    ),
                  ),
          },
        };
  return {
    ...snapshot,
    ...build,
    ...(snapshot.operationWorktree === undefined
      ? {}
      : {
          operationWorktree: {
            ...snapshot.operationWorktree,
            operationId,
          },
        }),
  } as F16EffectiveAITaskSnapshot;
}

function scopedWorktree(
  handoff: F13ProviderWorktreeHandoff,
  operationId: string,
  access: "READ_ONLY" | "WORKTREE_WRITE",
): AIProviderWorktreeReference {
  return {
    schemaVersion: 1,
    operationId,
    worktreeId: handoff.worktreeId,
    ownerType: handoff.ownerType,
    ownerId: handoff.ownerId,
    operationKind: handoff.operationKind,
    canonicalPath: handoff.canonicalPath,
    access,
    ownership: {
      kind: "OPERATION_OWNED",
      ownerType: handoff.ownerType,
      ownerId: handoff.ownerId,
    },
    actualState: {
      snapshotId: handoff.actualState.snapshotId,
      stateFingerprint: handoff.actualState.stateFingerprint,
      baselineRevision: handoff.actualState.baselineRevision,
      expectedHeadRevision: handoff.actualState.expectedHeadRevision,
      ...(handoff.actualState.currentHeadRevision === undefined
        ? {}
        : { currentHeadRevision: handoff.actualState.currentHeadRevision }),
      files: handoff.actualState.files.map((file) => ({ ...file })),
      ignoredFiles: [...handoff.actualState.ignoredFiles],
      complete: handoff.actualState.complete,
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

function worktreeScope(
  handoff: F13ProviderWorktreeHandoff,
  operationId: string,
  ownerId: string,
  access: "READ_ONLY" | "WORKTREE_WRITE",
): NonNullable<AIWorkOperationInput["worktree"]> {
  return {
    operationId,
    worktreeId: handoff.worktreeId,
    ownerType: handoff.ownerType,
    ownerId,
    canonicalPath: handoff.canonicalPath,
    rootRevision: 1,
    access,
    available: true,
  };
}

function profileSnapshot(
  snapshot: F16EffectiveAITaskSnapshot,
): AIProviderRequest["profileSnapshot"] {
  const commonInstructions = snapshot.commonInstructions
    .map((instruction) => instruction.instructionText)
    .join("\n\n");
  return {
    schemaVersion: 1,
    profileId: snapshot.profile.profileId,
    profileRevision: snapshot.profile.revision,
    ...(snapshot.profile.connection
      ? { connection: snapshot.profile.connection }
      : {}),
    providerId: snapshot.profile.providerId,
    modelId: snapshot.profile.modelId,
    taskType: snapshot.taskType,
    ...(snapshot.profile.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: snapshot.profile.reasoningEffort }),
    ...(commonInstructions.length === 0 ? {} : { commonInstructions }),
    ...(snapshot.buildValidation?.buildInstructions === undefined
      ? {}
      : {
          buildAndValidationInstructions:
            snapshot.buildValidation.buildInstructions,
        }),
    outputContractId: outputContractForTask(snapshot.taskType).contractId,
  };
}

function executionPolicy(
  snapshot: F16EffectiveAITaskSnapshot,
): AIProviderRequest["executionPolicySnapshot"] {
  return {
    schemaVersion: 1,
    snapshotHash: snapshot.snapshotHash,
    policyId: snapshot.policy.policyId,
    revision: snapshot.policy.revision,
    sandboxMode: snapshot.policy.sandboxMode,
    approvalPolicy: snapshot.policy.approvalPolicy,
    networkAccess: snapshot.policy.networkAccess,
    ...(snapshot.policy.writableRoot === undefined
      ? {}
      : { writableRoot: snapshot.policy.writableRoot }),
    controlledEnvironment: {
      mode: "explicit",
      allowedKeys: [...snapshot.policy.controlledEnvironment.allowedKeys],
    },
    requiresInteractiveApproval: false,
  };
}

function worktreeEvidence(input: {
  readonly operation: unknown;
  readonly turn: AIWorkTurnIntent;
  readonly handoff: F13ProviderWorktreeHandoff;
  readonly after?: boolean;
}): AIWorkWorktreeEvidence {
  const files = input.handoff.actualState.files.map((file) => ({
    path: file.path,
    kind: file.kind,
    ...(file.contentHash === undefined
      ? {}
      : { contentHash: file.contentHash }),
    ...(file.sizeBytes === undefined ? {} : { sizeBytes: file.sizeBytes }),
    ...(file.binary === undefined ? {} : { binary: file.binary }),
    material: file.worktreeChanged,
  }));
  return {
    schemaVersion: 1,
    worktreeId: input.handoff.worktreeId,
    snapshotId: input.turn.snapshotId,
    revision: 1,
    stateFingerprint: input.handoff.actualState.stateFingerprint,
    baselineRevision: input.handoff.actualState.baselineRevision,
    currentRevision:
      input.handoff.actualState.currentHeadRevision ??
      input.handoff.actualState.expectedHeadRevision,
    files,
    ignoredPaths: [...input.handoff.actualState.ignoredFiles],
    unmergedPaths: [],
    conflictMarkers: [],
    actualCommands: [],
    complete: input.handoff.actualState.complete,
    clean: !files.some((file) => file.material === true),
    forbiddenMutation: input.after === false,
  };
}

function validationForAIWork(
  model: F18ValidationEvidence,
): AIWorkValidationEvidence {
  return {
    runId: model.runId,
    revision: model.version,
    phase: model.requestedPhase,
    status: model.status === "running" ? "interrupted" : model.status,
    complete: model.status !== "running",
    ...(model.status === "not_run" ? { noSafeCommand: true } : {}),
    ...(model.reason === undefined ? {} : { problems: [model.reason] }),
  };
}

function compactSummary(readModel: AIWorkReadModel): F18AiWorkSummary {
  return {
    operationId: readModel.operation.operationId,
    status: readModel.operation.status,
    attention: readModel.attention,
    nextAction: readModel.permittedNextAction,
    remainingBudget: readModel.remainingBudget,
    usage: readModel.usage,
    reports: readModel.reports.map((report) => ({
      turnId: report.turnId,
      providerStatus: report.providerStatus,
      modelClaims: {
        ...(report.modelClaims.approach === undefined
          ? {}
          : { approach: report.modelClaims.approach }),
        problems: [...report.modelClaims.problems],
        remainingIssues: [...report.modelClaims.remainingIssues],
        claimedChangedFiles: [...report.modelClaims.claimedChangedFiles],
        ...(report.modelClaims.completionClaim === undefined
          ? {}
          : { completionClaim: report.modelClaims.completionClaim }),
        ...(report.modelClaims.semanticResult === undefined
          ? {}
          : { semanticResult: report.modelClaims.semanticResult }),
      },
      actualChangedFiles: report.actualChangedFiles.map((file) => file.path),
      actualCommands: [...report.actualCommands],
      deterministicProblems: [...report.deterministicProblems],
      remainingProblems: [...report.remainingProblems],
      nextAction: report.nextAction,
    })),
  };
}

function structuredResult(readModel: AIWorkReadModel): unknown {
  return readModel.reports.at(-1)?.modelClaims.semanticResult;
}

export class F18AIWorkAdapter {
  private readonly controller: AIWorkController;
  private readonly active = new Map<string, ActiveF18AiInput>();
  private readonly beforeSnapshots = new Map<string, string>();
  private readonly validation = new Map<string, F18ValidationEvidence>();

  public constructor(private readonly options: F18AIWorkAdapterOptions) {
    const evidence: AIWorkEvidencePort = {
      inspectWorktree: async ({ operation, turn }) => {
        const active = this.active.get(operation.operationId);
        if (active === undefined) throw new Error("F18_AI_CONTEXT_MISSING");
        if (active.phase === "proposal") {
          const handoff = await this.options.f13.getProviderWorktreeHandoff({
            operationId: active.f13OperationId,
            ownerId: active.ownerId,
          });
          if (!handoff.ok || handoff.handoff === undefined)
            throw new Error("F18_PROPOSAL_WORKTREE_REVALIDATION_FAILED");
          return worktreeEvidence({
            operation,
            turn,
            handoff: handoff.handoff,
          });
        }
        const beforeSnapshotId = this.beforeSnapshots.get(turn.turnId);
        if (
          beforeSnapshotId === undefined ||
          this.options.f13.completeAiTurn === undefined
        )
          throw new Error("F18_IMPLEMENTATION_SNAPSHOT_MISSING");
        const after = await this.options.f13.completeAiTurn({
          operationId: active.f13OperationId,
          ownerId: active.ownerId,
          turnId: turn.turnId,
          beforeSnapshotId,
        });
        if (!after.ok || after.snapshot === undefined)
          throw new Error("F18_IMPLEMENTATION_AFTER_SNAPSHOT_FAILED");
        const handoff = await this.options.f13.getProviderWorktreeHandoff({
          operationId: active.f13OperationId,
          ownerId: active.ownerId,
        });
        if (!handoff.ok || handoff.handoff === undefined)
          throw new Error("F18_IMPLEMENTATION_WORKTREE_REVALIDATION_FAILED");
        return worktreeEvidence({
          operation,
          turn,
          handoff: handoff.handoff,
          after: true,
        });
      },
      inspectValidation: async ({ operation }) => {
        const active = this.active.get(operation.operationId);
        if (active === undefined || active.phase !== "implementation")
          return undefined;
        if (
          this.options.f14 === undefined ||
          this.options.validation === undefined
        )
          return undefined;
        const repositoryId =
          active.taskSnapshot.buildValidation?.repository.key;
        if (repositoryId === undefined) return undefined;
        const resolution = this.options.validation.resolve({
          repositoryId,
          operationId: active.f13OperationId,
        });
        const result = await this.options.f14.run({
          operationId: active.f13OperationId,
          runId: `f18-post-${active.f13OperationId}`,
          idempotencyKey: `f18-post-key-${active.f13OperationId}`,
          correlationId: `f18-post-correlation-${active.f13OperationId}`,
          ownerType: "REVIEW_BUNDLE",
          ownerId: active.ownerId,
          consumer: "review",
          requestedPhase: "post_change",
          resolution,
        });
        const model = this.options.f14.readModel(result.record.runId);
        if (model === undefined) return undefined;
        const projected: F18ValidationEvidence = {
          runId: model.runId,
          operationId: model.operationId,
          requestedPhase: model.requestedPhase,
          status: model.status,
          ...(model.reason === undefined ? {} : { reason: model.reason }),
          nextAction: model.nextAction,
          ...(model.snapshot?.snapshotId === undefined
            ? {}
            : { snapshotId: model.snapshot.snapshotId }),
          ...(model.snapshot?.baselineRevision === undefined
            ? {}
            : { baselineRevision: model.snapshot.baselineRevision }),
          ...(model.snapshot?.currentRevision === undefined
            ? {}
            : { currentRevision: model.snapshot.currentRevision }),
          warningCodes: model.warnings
            .map((warning) => warning.code)
            .slice(0, 64),
          steps: model.steps.map((step) => ({
            stepId: step.stepId,
            kind: step.kind,
            status: step.status,
            ...(step.reason === undefined ? {} : { reason: step.reason }),
            ...(step.exitCode === undefined ? {} : { exitCode: step.exitCode }),
          })),
          ...(model.completedAt === undefined
            ? {}
            : { completedAt: model.completedAt }),
          version: model.version,
        };
        this.validation.set(operation.operationId, projected);
        return validationForAIWork(projected);
      },
    };
    this.controller = new AIWorkController({
      persistence: options.persistence,
      provider: options.provider,
      requestFactory: {
        create: async ({ operation, turn }) => {
          const active = this.active.get(operation.operationId);
          if (active === undefined) throw new Error("F18_AI_CONTEXT_MISSING");
          let handoff: F13ProviderWorktreeHandoff | undefined;
          if (active.phase === "proposal") {
            const result = await this.options.f13.getProviderWorktreeHandoff({
              operationId: active.f13OperationId,
              ownerId: active.ownerId,
            });
            if (!result.ok || result.handoff === undefined)
              throw new Error("F18_PROPOSAL_WORKTREE_UNAVAILABLE");
            handoff = result.handoff;
          } else {
            if (this.options.f13.beginAiTurn === undefined)
              throw new Error("F18_MUTATION_GATE_UNAVAILABLE");
            const before = await this.options.f13.beginAiTurn({
              operationId: active.f13OperationId,
              ownerId: active.ownerId,
              turnId: turn.turnId,
            });
            if (
              !before.ok ||
              before.snapshot === undefined ||
              before.worktree === undefined
            )
              throw new Error("F18_MUTATION_GATE_REFUSED");
            this.beforeSnapshots.set(turn.turnId, before.snapshot.snapshotId);
            handoff = before.worktree;
          }
          const request = {
            schemaVersion: 1 as const,
            requestId: `f18-request-${turn.turnId}`,
            operationId: operation.operationId,
            turnId: turn.turnId,
            providerId: active.taskSnapshot.profile.providerId,
            modelId: active.taskSnapshot.profile.modelId,
            taskType: active.taskSnapshot.taskType,
            interactionMode:
              active.phase === "proposal"
                ? ("read_only" as const)
                : ("worktree_write" as const),
            profileSnapshot: profileSnapshot(active.taskSnapshot),
            executionPolicySnapshot: executionPolicy(active.taskSnapshot),
            worktree: scopedWorktree(
              handoff,
              operation.operationId,
              active.phase === "proposal" ? "READ_ONLY" : "WORKTREE_WRITE",
            ),
            input: active.providerInput,
            outputContract: outputContractForTask(active.taskSnapshot.taskType),
            invocation: { timeoutMs: turn.timeoutMs, streamEvents: true },
          } satisfies AIProviderRequest;
          return aiProviderRequestSchema.parse(request);
        },
      },
      evidence,
      clock: {
        now: () => now(this.options.clock),
      },
    });
  }

  public async run(input: F18AiWorkInput): Promise<F18AiWorkResult> {
    const taskSnapshot = sanitizedTaskSnapshot(
      input.taskSnapshot,
      input.operationId,
    );
    const operation: AIWorkOperationInput = {
      schemaVersion: 1,
      operationId: input.operationId,
      idempotencyKey: input.operationId,
      operationKind: "AUTOMATIC_REVIEW",
      taskType: taskSnapshot.taskType,
      purpose:
        input.phase === "proposal"
          ? "Produce the bounded read-only Review Proposal for every immutable feedback version."
          : "Apply only the final human-confirmed fixed Review Bundle dispositions in the operation worktree.",
      interactionMode:
        input.phase === "proposal" ? "read_only" : "worktree_write",
      worktree: worktreeScope(
        input.worktree,
        input.operationId,
        input.ownerId,
        input.phase === "proposal" ? "READ_ONLY" : "WORKTREE_WRITE",
      ),
      taskSnapshot:
        taskSnapshot as unknown as AIWorkOperationInput["taskSnapshot"],
      predicate: {
        id:
          input.phase === "proposal"
            ? "REVIEW_PROPOSAL"
            : "REVIEW_IMPLEMENTATION",
        version: 1,
        inputSnapshot: input.input,
      },
      configuredTurnBudget: 3,
      budgetSource: "F16_PREFERENCE",
      createdAt: now(this.options.clock),
    };
    aiWorkOperationInputSchema.parse(operation);
    this.active.set(input.operationId, {
      ...input,
      providerInput: input.input,
      taskSnapshot,
    });
    try {
      const readModel = await this.controller.startOperation(operation, {
        autoContinue: false,
      });
      const summary = compactSummary(readModel);
      const raw = structuredResult(readModel);
      const contract = outputContractForTask(taskSnapshot.taskType);
      const parsed =
        raw === undefined
          ? undefined
          : parseAIProviderStructuredResult(
              contract,
              raw,
              input.input.remoteEventVersionIds,
            );
      const validated = parsed?.success === true ? parsed.data : undefined;
      return {
        summary,
        ...(input.phase === "proposal" &&
        validated !== undefined &&
        "items" in validated
          ? { proposal: validated }
          : {}),
        ...(input.phase === "implementation" &&
        validated !== undefined &&
        "outcomes" in validated
          ? { implementation: validated }
          : {}),
        ...(this.validation.get(input.operationId) === undefined
          ? {}
          : { validation: this.validation.get(input.operationId) }),
      };
    } finally {
      this.active.delete(input.operationId);
    }
  }

  public async stopAdmission(): Promise<void> {
    await this.controller.stopAdmission();
  }

  public async handoff(): Promise<void> {
    await this.controller.handoff();
  }

  public async boundedStop(): Promise<void> {
    await this.controller.boundedStop();
  }
}
