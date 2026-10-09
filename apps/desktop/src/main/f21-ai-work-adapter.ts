import { z } from "zod";
import {
  aiProviderConversationReferenceSchema,
  aiProviderInputSnapshotSchema,
  aiProviderRequestSchema,
  outputContractForTask,
  parseAIProviderStructuredResult,
  type AIProviderInputSnapshot,
  type AIProviderConversationReference,
  type AIProviderRequest,
  type AIProviderWorktreeReference,
  type AIReviewImplementation,
} from "../shared/ai/provider-contracts";
import {
  aiWorkOperationInputSchema,
  type AIWorkOperationInput,
  type AIWorkOperationRecord,
  type AIWorkContinuation,
  type AIWorkPersistencePort,
  type AIWorkReadModel,
  type AIWorkTurnIntent,
  type AIWorkValidationEvidence,
  type AIWorkWorktreeEvidence,
} from "../shared/ai-work";
import type { F16EffectiveAITaskSnapshot } from "../shared/f16-preferences";
import type {
  F13AiTurnAfterResult,
  F13AiTurnBeforeResult,
  F13ProviderWorktreeHandoff,
} from "../shared/f13-contracts";
import type {
  F18F13Port,
  F18F14Port,
  F18ValidationPort,
} from "./automatic-review-coordinator";
import {
  AIWorkController,
  type AIWorkEvidencePort,
  type AIWorkProviderPort,
} from "./ai-work-controller";
import type {
  F18AiWorkSummary,
  F18ValidationEvidence,
} from "../shared/f18-automatic-review";
import {
  f21ConversationModeSchema,
  f21RevisionRequestSchema,
  type F21ConversationMode,
  type F21SafeProgressEvent,
  type F21ReviewRevisionRequest,
} from "../shared/f21-conversation";

export interface F21AIWorkInput {
  readonly mode: F21ConversationMode;
  readonly operationId: string;
  readonly f13OperationId?: string;
  readonly ownerId: string;
  readonly bundleId: string;
  readonly taskSnapshot: F16EffectiveAITaskSnapshot;
  readonly input: AIProviderInputSnapshot;
  readonly worktree?: F13ProviderWorktreeHandoff;
  readonly conversationReference?: AIProviderRequest["conversationContinuation"];
  readonly acknowledgeUnattributedChanges?: boolean;
  readonly revisionRequest?: F21ReviewRevisionRequest;
  readonly configuredTurnBudget?: number;
}

export interface F21AIWorkResult {
  readonly readModel: AIWorkReadModel;
  readonly summary: F18AiWorkSummary;
  readonly answer?: string;
  readonly explanation?: string;
  readonly nextStep?: string;
  readonly implementation?: AIReviewImplementation;
  readonly rawImplementation?: unknown;
  readonly conversationReference?: AIProviderConversationReference;
  readonly progress: readonly F21SafeProgressEvent[];
  readonly validation?: F18ValidationEvidence;
}

export interface F21NewAIWorkInput extends F21AIWorkInput {
  readonly priorOperationId: string;
  readonly confirmation: AIWorkContinuation;
}

interface ActiveF21Input extends F21AIWorkInput {
  readonly taskSnapshot: F16EffectiveAITaskSnapshot;
  readonly providerInput: AIProviderInputSnapshot;
  readonly progress: F21SafeProgressEvent[];
  readonly beforeSnapshots: Map<string, string>;
  readonly turnIds: Set<string>;
  continuationReference?: AIProviderRequest["conversationContinuation"];
}

const f21OperationContextSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: f21ConversationModeSchema,
    ownerId: z.string().min(1).max(256),
    bundleId: z.string().min(1).max(256),
    f13OperationId: z.string().min(1).max(256).optional(),
    acknowledgeUnattributedChanges: z.boolean().optional(),
    conversationReference: z
      .object({
        authorized: z.literal(true),
        reference: aiProviderConversationReferenceSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function continuationFromOperation(
  operation: AIWorkOperationRecord,
): AIProviderRequest["conversationContinuation"] | undefined {
  const reference = operation.segments
    .flatMap((segment) => segment.reports)
    .at(-1)?.conversationReference;
  return reference?.resumable === true
    ? { authorized: true, reference }
    : undefined;
}

function now(clock: (() => string) | undefined): string {
  return clock?.() ?? new Date().toISOString();
}

function sanitizedTaskSnapshot(
  snapshot: F16EffectiveAITaskSnapshot,
  operationId: string,
): F16EffectiveAITaskSnapshot {
  const validation = snapshot.buildValidation?.validation;
  const buildValidation =
    snapshot.buildValidation === undefined
      ? undefined
      : {
          ...snapshot.buildValidation,
          validation:
            validation === undefined
              ? validation
              : Object.fromEntries(
                  Object.entries(validation).filter(
                    ([key, value]) =>
                      value !== undefined && key !== "authorization",
                  ),
                ),
        };
  return {
    ...snapshot,
    ...(buildValidation === undefined ? {} : { buildValidation }),
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
  rootRevision: number,
): NonNullable<AIWorkOperationInput["worktree"]> {
  return {
    operationId,
    worktreeId: handoff.worktreeId,
    ownerType: handoff.ownerType,
    ownerId,
    canonicalPath: handoff.canonicalPath,
    rootRevision,
    access: "WORKTREE_WRITE",
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

function evidenceFromHandoff(
  handoff: F13ProviderWorktreeHandoff,
  turn: AIWorkTurnIntent,
  forbiddenMutation: boolean,
): AIWorkWorktreeEvidence {
  const files = handoff.actualState.files.map((file) => ({
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
    worktreeId: handoff.worktreeId,
    snapshotId: turn.snapshotId,
    revision: 1,
    stateFingerprint: handoff.actualState.stateFingerprint,
    baselineRevision: handoff.actualState.baselineRevision,
    currentRevision:
      handoff.actualState.currentHeadRevision ??
      handoff.actualState.expectedHeadRevision,
    files,
    ignoredPaths: [...handoff.actualState.ignoredFiles],
    unmergedPaths: [],
    conflictMarkers: [],
    actualCommands: [],
    complete: handoff.actualState.complete,
    clean: !files.some((file) => file.material === true),
    forbiddenMutation,
  };
}

function emptyReadOnlyEvidence(
  operationId: string,
  turn: AIWorkTurnIntent,
): AIWorkWorktreeEvidence {
  return {
    schemaVersion: 1,
    worktreeId: `readonly-${operationId}`,
    snapshotId: turn.snapshotId,
    revision: 0,
    stateFingerprint: `readonly-${operationId}`,
    baselineRevision: "readonly",
    currentRevision: "readonly",
    files: [],
    ignoredPaths: [],
    unmergedPaths: [],
    conflictMarkers: [],
    actualCommands: [],
    complete: true,
    clean: true,
    forbiddenMutation: false,
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

function summary(readModel: AIWorkReadModel): F18AiWorkSummary {
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

function lastStructured(readModel: AIWorkReadModel): unknown {
  return readModel.reports.at(-1)?.modelClaims.semanticResult;
}

export interface F21AIWorkAdapterOptions {
  readonly persistence: AIWorkPersistencePort;
  readonly provider: AIWorkProviderPort;
  readonly f13: F18F13Port & {
    readonly beginAiTurn?: (input: {
      readonly operationId: string;
      readonly ownerId: string;
      readonly turnId: string;
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

export class F21AIWorkAdapter {
  private readonly controller: AIWorkController;
  private readonly active = new Map<string, ActiveF21Input>();
  private readonly validation = new Map<string, F18ValidationEvidence>();

  public constructor(private readonly options: F21AIWorkAdapterOptions) {
    const evidence: AIWorkEvidencePort = {
      inspectWorktree: async ({ operation, turn }) => {
        const active = this.active.get(operation.operationId);
        if (active === undefined) throw new Error("F21_AI_CONTEXT_MISSING");
        if (active.mode === "READ_ONLY_CONVERSATION")
          return emptyReadOnlyEvidence(operation.operationId, turn);
        const beforeSnapshotId = active.beforeSnapshots.get(turn.turnId);
        if (
          beforeSnapshotId === undefined ||
          this.options.f13.completeAiTurn === undefined ||
          active.f13OperationId === undefined
        )
          throw new Error("F21_MUTATION_SNAPSHOT_MISSING");
        const after = await this.options.f13.completeAiTurn({
          operationId: active.f13OperationId,
          ownerId: active.ownerId,
          turnId: turn.turnId,
          beforeSnapshotId,
        });
        if (!after.ok || after.worktree === undefined)
          throw new Error("F21_AFTER_SNAPSHOT_FAILED");
        return evidenceFromHandoff(after.worktree, turn, false);
      },
      inspectValidation: async ({ operation }) => {
        const active = this.active.get(operation.operationId);
        if (
          active === undefined ||
          active.mode !== "REVIEW_REVISION" ||
          this.options.f14 === undefined ||
          this.options.validation === undefined ||
          active.f13OperationId === undefined
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
          runId: `f21-post-${active.f13OperationId}`,
          idempotencyKey: `f21-post-key-${active.f13OperationId}`,
          correlationId: `f21-post-correlation-${active.f13OperationId}`,
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
      evidence,
      clock: { now: () => now(options.clock) },
      onEvent: (event) => {
        const active = [...this.active.values()].find((value) =>
          value.turnIds.has(event.turnId),
        );
        if (active === undefined) return;
        if (active.progress.length >= 128) return;
        active.progress.push({
          sequence: event.sequence,
          occurredAt: event.occurredAt,
          kind: event.kind,
          summary:
            typeof event.details === "object" && event.details !== null
              ? "Provider progress received."
              : "Provider progress received.",
        });
      },
      requestFactory: {
        create: async ({ operation, turn }) => {
          const active = this.active.get(operation.operationId);
          if (active === undefined) throw new Error("F21_AI_CONTEXT_MISSING");
          active.turnIds.add(turn.turnId);
          let handoff: F13ProviderWorktreeHandoff | undefined;
          if (active.mode === "REVIEW_REVISION") {
            if (
              active.f13OperationId === undefined ||
              this.options.f13.beginAiTurn === undefined
            )
              throw new Error("F21_MUTATION_GATE_UNAVAILABLE");
            const before = await this.options.f13.beginAiTurn({
              operationId: active.f13OperationId,
              ownerId: active.ownerId,
              turnId: turn.turnId,
              ...(active.acknowledgeUnattributedChanges === undefined
                ? {}
                : {
                    acknowledgeUnattributedChanges:
                      active.acknowledgeUnattributedChanges,
                  }),
            });
            if (
              !before.ok ||
              before.snapshot === undefined ||
              before.worktree === undefined
            )
              throw new Error("F21_MUTATION_GATE_REFUSED");
            active.beforeSnapshots.set(turn.turnId, before.snapshot.snapshotId);
            handoff = before.worktree;
          } else if (active.worktree !== undefined) {
            const current = await this.options.f13.getProviderWorktreeHandoff({
              operationId: active.worktree.operationId,
              ownerId: active.ownerId,
            });
            if (!current.ok || current.handoff === undefined)
              throw new Error("F21_READ_ONLY_WORKTREE_UNAVAILABLE");
            handoff = current.handoff;
          }
          const request: AIProviderRequest = {
            schemaVersion: 1,
            requestId: `f21-request-${turn.turnId}`,
            operationId: operation.operationId,
            turnId: turn.turnId,
            providerId: active.taskSnapshot.profile.providerId,
            modelId: active.taskSnapshot.profile.modelId,
            taskType: active.taskSnapshot.taskType,
            interactionMode:
              active.mode === "READ_ONLY_CONVERSATION"
                ? "read_only"
                : "worktree_write",
            profileSnapshot: profileSnapshot(active.taskSnapshot),
            executionPolicySnapshot: executionPolicy(active.taskSnapshot),
            ...(handoff === undefined
              ? {}
              : {
                  worktree: scopedWorktree(
                    handoff,
                    operation.operationId,
                    active.mode === "READ_ONLY_CONVERSATION"
                      ? "READ_ONLY"
                      : "WORKTREE_WRITE",
                  ),
                }),
            input: active.providerInput,
            ...((active.continuationReference ??
              active.conversationReference) === undefined
              ? {}
              : {
                  conversationContinuation:
                    active.continuationReference ??
                    active.conversationReference,
                }),
            outputContract: outputContractForTask(active.taskSnapshot.taskType),
            invocation: { timeoutMs: turn.timeoutMs, streamEvents: true },
          };
          return aiProviderRequestSchema.parse(request);
        },
      },
    });
  }

  public async run(input: F21AIWorkInput): Promise<F21AIWorkResult> {
    const taskSnapshot = sanitizedTaskSnapshot(
      input.taskSnapshot,
      input.operationId,
    );
    const operation = this.operationInput(input, taskSnapshot);
    aiWorkOperationInputSchema.parse(operation);
    const active: ActiveF21Input = {
      ...input,
      taskSnapshot,
      providerInput: input.input,
      progress: [],
      beforeSnapshots: new Map(),
      turnIds: new Set(),
      continuationReference: input.conversationReference,
    };
    this.active.set(input.operationId, active);
    try {
      const readModel = await this.controller.startOperation(operation, {
        autoContinue: false,
      });
      return this.projectResult(input, readModel, active);
    } catch (error) {
      this.active.delete(input.operationId);
      throw error;
    }
  }

  public async startNewOperation(
    input: F21NewAIWorkInput,
  ): Promise<F21AIWorkResult> {
    const taskSnapshot = sanitizedTaskSnapshot(
      input.taskSnapshot,
      input.operationId,
    );
    const operation = this.operationInput(
      input,
      taskSnapshot,
      input.priorOperationId,
    );
    aiWorkOperationInputSchema.parse(operation);
    const active: ActiveF21Input = {
      ...input,
      taskSnapshot,
      providerInput: input.input,
      progress: [],
      beforeSnapshots: new Map(),
      turnIds: new Set(),
      continuationReference: input.conversationReference,
    };
    this.active.set(input.operationId, active);
    try {
      const readModel = await this.controller.startNewOperation({
        priorOperationId: input.priorOperationId,
        confirmation: input.confirmation,
        operation,
        autoContinue: false,
      });
      return this.projectResult(input, readModel, active);
    } catch (error) {
      this.active.delete(input.operationId);
      throw error;
    }
  }

  private operationInput(
    input: F21AIWorkInput,
    taskSnapshot: F16EffectiveAITaskSnapshot,
    parentOperationId?: string,
  ): AIWorkOperationInput {
    const operation: AIWorkOperationInput = {
      schemaVersion: 1,
      operationId: input.operationId,
      ...(parentOperationId === undefined ? {} : { parentOperationId }),
      idempotencyKey: input.operationId,
      operationKind:
        input.mode === "READ_ONLY_CONVERSATION"
          ? "CONVERSATION"
          : "REVIEW_REVISION",
      taskType: taskSnapshot.taskType,
      purpose:
        input.mode === "READ_ONLY_CONVERSATION"
          ? "Answer the user's Review Bundle question without changing the worktree."
          : "Apply only the confirmed Review Bundle revision in the operation-owned worktree.",
      interactionMode:
        input.mode === "READ_ONLY_CONVERSATION"
          ? "read_only"
          : "worktree_write",
      ...(input.mode === "REVIEW_REVISION" && input.worktree !== undefined
        ? {
            worktree: worktreeScope(
              input.worktree,
              input.operationId,
              input.ownerId,
              input.taskSnapshot.operationWorktree?.rootRevision ?? 1,
            ),
          }
        : {}),
      taskSnapshot: taskSnapshot as AIWorkOperationInput["taskSnapshot"],
      predicate: {
        id:
          input.mode === "READ_ONLY_CONVERSATION"
            ? "READ_ONLY_CONVERSATION"
            : "REVIEW_REVISION",
        version: 1,
        inputSnapshot: {
          ...input.input,
          ...(input.revisionRequest === undefined
            ? {}
            : { revisionRequest: input.revisionRequest }),
          f21Context: {
            schemaVersion: 1,
            mode: input.mode,
            ownerId: input.ownerId,
            bundleId: input.bundleId,
            ...(input.f13OperationId === undefined
              ? {}
              : { f13OperationId: input.f13OperationId }),
            ...(input.acknowledgeUnattributedChanges === undefined
              ? {}
              : {
                  acknowledgeUnattributedChanges:
                    input.acknowledgeUnattributedChanges,
                }),
            ...(input.conversationReference === undefined
              ? {}
              : { conversationReference: input.conversationReference }),
          },
        },
      },
      configuredTurnBudget: input.configuredTurnBudget ?? 1,
      budgetSource: "EXPLICIT_OPERATION",
      createdAt: now(this.options.clock),
    };
    return operation;
  }

  public async continue(input: {
    readonly operationId: string;
    readonly confirmation: Parameters<
      AIWorkController["continueOperation"]
    >[0]["confirmation"];
  }): Promise<F21AIWorkResult> {
    const active =
      this.active.get(input.operationId) ??
      this.rehydrateActiveContext(input.operationId);
    if (active === undefined) throw new Error("F21_AI_CONTEXT_MISSING");
    this.active.set(input.operationId, active);
    const readModel = await this.controller.continueOperation({
      confirmation: input.confirmation,
      autoContinue: false,
    });
    return this.projectResult(active, readModel, active);
  }

  private rehydrateActiveContext(
    operationId: string,
  ): ActiveF21Input | undefined {
    const operation = this.options.persistence.getOperation(operationId);
    if (
      operation === undefined ||
      (operation.taskType !== "READ_ONLY_CONVERSATION" &&
        operation.taskType !== "REVIEW_REVISION")
    )
      return undefined;
    const snapshot = record(operation.predicate.inputSnapshot);
    if (snapshot === undefined) return undefined;
    const context = f21OperationContextSchema.safeParse(snapshot.f21Context);
    if (!context.success || context.data.mode !== operation.taskType)
      return undefined;
    const {
      f21Context: _context,
      revisionRequest: rawRevision,
      ...rawInput
    } = snapshot;
    const parsedInput = aiProviderInputSnapshotSchema.safeParse(rawInput);
    if (!parsedInput.success) return undefined;
    const parsedRevision = f21RevisionRequestSchema.safeParse(rawRevision);
    const continuationReference =
      continuationFromOperation(operation) ??
      context.data.conversationReference;
    return {
      mode: context.data.mode,
      operationId,
      ...(context.data.f13OperationId === undefined
        ? {}
        : { f13OperationId: context.data.f13OperationId }),
      ownerId: context.data.ownerId,
      bundleId: context.data.bundleId,
      taskSnapshot: operation.taskSnapshot,
      input: parsedInput.data,
      providerInput: parsedInput.data,
      ...(parsedRevision.success
        ? { revisionRequest: parsedRevision.data }
        : {}),
      ...(context.data.acknowledgeUnattributedChanges === undefined
        ? {}
        : {
            acknowledgeUnattributedChanges:
              context.data.acknowledgeUnattributedChanges,
          }),
      configuredTurnBudget: operation.configuredTurnBudget,
      progress: [],
      beforeSnapshots: new Map(),
      turnIds: new Set(),
      ...(continuationReference === undefined ? {} : { continuationReference }),
    };
  }

  public read(operationId: string): AIWorkReadModel {
    return this.controller.read(operationId);
  }

  public async cancel(
    operationId: string,
  ): Promise<F21AIWorkResult | undefined> {
    const operation = this.options.persistence.getOperation(operationId);
    if (operation === undefined) return undefined;
    const activeTurn = operation.segments
      .flatMap((segment) => segment.turns)
      .find((turn) => turn.status === "STARTED" || turn.status === "RESERVED");
    if (activeTurn === undefined) return undefined;
    const readModel = await this.controller.cancelTurnAndWait(
      activeTurn.turnId,
    );
    const active = this.active.get(operationId);
    if (readModel === undefined || active === undefined) return undefined;
    return this.projectResult(active, readModel, active);
  }

  public authorizeContinuation(input: {
    readonly operationId: string;
    readonly kind:
      "CONTINUE_AI_WORK" | "RETRY_RESOLUTION" | "START_NEW_OPERATION";
    readonly selectedBudget?: number;
    readonly snapshotId?: string;
  }) {
    return this.controller.authorizeContinuation(input);
  }

  public async reconcileStartup(): Promise<readonly AIWorkReadModel[]> {
    return this.controller.reconcileStartup(
      (operation) =>
        operation.taskType === "READ_ONLY_CONVERSATION" ||
        operation.taskType === "REVIEW_REVISION",
    );
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

  private projectResult(
    input: F21AIWorkInput,
    readModel: AIWorkReadModel,
    active: ActiveF21Input,
  ): F21AIWorkResult {
    const raw = lastStructured(readModel);
    const parsed =
      raw === undefined
        ? undefined
        : parseAIProviderStructuredResult(
            outputContractForTask(active.taskSnapshot.taskType),
            raw,
            active.input.remoteEventVersionIds,
          );
    const result = parsed?.success === true ? parsed.data : undefined;
    const candidate =
      typeof result === "object" && result !== null
        ? (result as Record<string, unknown>)
        : undefined;
    const reference = readModel.reports.at(-1)?.conversationReference;
    if (reference?.resumable === true)
      active.continuationReference = {
        authorized: true,
        reference,
      };
    return {
      readModel,
      summary: summary(readModel),
      ...(typeof candidate?.answer === "string"
        ? { answer: candidate.answer }
        : {}),
      ...(typeof candidate?.explanation === "string"
        ? { explanation: candidate.explanation }
        : {}),
      ...(typeof candidate?.nextStep === "string"
        ? { nextStep: candidate.nextStep }
        : {}),
      ...(result !== undefined && "outcomes" in result
        ? { rawImplementation: result, implementation: result }
        : {}),
      ...(reference === undefined ? {} : { conversationReference: reference }),
      progress: [...active.progress],
      ...(this.validation.get(input.operationId) === undefined
        ? {}
        : { validation: this.validation.get(input.operationId) }),
    } as F21AIWorkResult;
  }
}
