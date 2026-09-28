import { z } from "zod";
import {
  aiProviderInputSnapshotSchema,
  aiProviderRequestSchema,
  outputContractForTask,
  parseAIProviderStructuredResult,
  type AIProviderInputSnapshot,
  type AIProviderNormalizedEvent,
  type AIProviderRequest,
  type AIProviderWorktreeReference,
  type AIConflictResolutionResult,
} from "../shared/ai/provider-contracts";
import {
  aiWorkOperationInputSchema,
  type AIWorkEvidenceBundle,
  type AIWorkOperationInput,
  type AIWorkOperationRecord,
  type AIWorkContinuation,
  type AIWorkPersistencePort,
  type AIWorkReadModel,
  type AIWorkStopReason,
  type AIWorkTurnIntent,
  type AIWorkValidationEvidence,
  type AIWorkWorktreeEvidence,
} from "../shared/ai-work";
import type { F16EffectiveAITaskSnapshot } from "../shared/f16-preferences";
import type {
  F13AiTurnAfterResult,
  F13AiTurnBeforeResult,
  F13InspectionResult,
  F13ProviderWorktreeHandoff,
} from "../shared/f13-contracts";
import {
  f26ConflictContextSchema,
  type F26ConflictContext,
} from "../shared/f26-conflict-resolution";
import type {
  F18F14Port,
  F18ValidationPort,
} from "./automatic-review-coordinator";
import type { F14ValidationReadModel } from "./f14-validation-runner";
import {
  AIWorkController,
  type AIWorkEvidencePort,
  type AIWorkProviderPort,
} from "./ai-work-controller";

export interface F26AIWorkInput {
  readonly operationId: string;
  readonly f13OperationId: string;
  readonly ownerId: string;
  readonly taskSnapshot: F16EffectiveAITaskSnapshot;
  readonly context: F26ConflictContext;
  readonly worktree: F13ProviderWorktreeHandoff;
  readonly configuredTurnBudget?: number;
  readonly acknowledgeUnattributedChanges?: boolean;
}

export interface F26AIWorkResult {
  readonly readModel: AIWorkReadModel;
  readonly assessment?: AIConflictResolutionResult;
  readonly evidence?: AIWorkEvidenceBundle;
  readonly validation?: AIWorkValidationEvidence;
  readonly attributionComplete?: boolean;
}

export interface F26AIWorkAdapterOptions {
  readonly persistence: AIWorkPersistencePort;
  readonly provider: AIWorkProviderPort;
  readonly f13: {
    readonly beginAiTurn: (input: {
      readonly operationId: string;
      readonly ownerId: string;
      readonly turnId: string;
      readonly acknowledgeUnattributedChanges?: boolean;
    }) => Promise<F13AiTurnBeforeResult>;
    readonly completeAiTurn: (input: {
      readonly operationId: string;
      readonly ownerId: string;
      readonly turnId: string;
      readonly beforeSnapshotId: string;
    }) => Promise<F13AiTurnAfterResult>;
    readonly inspectOperation: (
      operationId: string,
      ownerId: string,
      phase?: "INSPECTION" | "AFTER_AI" | "BEFORE_AI",
    ) => Promise<F13InspectionResult>;
  };
  readonly f14?: F18F14Port;
  readonly validation?: F18ValidationPort;
  readonly clock?: () => string;
}

interface ActiveF26Input extends F26AIWorkInput {
  context: F26ConflictContext;
  providerInput: AIProviderInputSnapshot;
  readonly taskSnapshot: F16EffectiveAITaskSnapshot;
  readonly beforeSnapshots: Map<string, string>;
  readonly commandEvidence: Map<string, string[]>;
  readonly validation: Map<string, AIWorkValidationEvidence>;
  lastInspection?: F13InspectionResult;
}

const f26OperationContextSchema = z
  .object({
    schemaVersion: z.literal(1),
    f13OperationId: z.string().min(1).max(256),
    ownerId: z.string().min(1).max(256),
    acknowledgeUnattributedChanges: z.boolean().optional(),
    context: f26ConflictContextSchema,
  })
  .strict();

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
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
): AIProviderWorktreeReference {
  return {
    schemaVersion: 1,
    operationId,
    worktreeId: handoff.worktreeId,
    ownerType: handoff.ownerType,
    ownerId: handoff.ownerId,
    operationKind: handoff.operationKind,
    canonicalPath: handoff.canonicalPath,
    access: "WORKTREE_WRITE",
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
      writeFiles: true,
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

function markerPaths(
  files: readonly {
    readonly path: string;
    readonly contentBase64?: string;
    readonly contentComplete?: boolean;
  }[],
): string[] {
  return files
    .filter(
      (file) =>
        file.contentComplete !== false && file.contentBase64 !== undefined,
    )
    .filter((file) => {
      try {
        const text = Buffer.from(file.contentBase64!, "base64").toString(
          "utf8",
        );
        return /^(?:<<<<<<<|=======|>>>>>>>)(?: |$)/mu.test(text);
      } catch {
        return false;
      }
    })
    .map((file) => file.path)
    .sort((left, right) => left.localeCompare(right));
}

function worktreeEvidence(input: {
  readonly operation: AIWorkOperationRecord;
  readonly turn: AIWorkTurnIntent;
  readonly inspection: F13InspectionResult;
  readonly changedPaths?: readonly string[];
  readonly allowedPaths: readonly string[];
  readonly commands: readonly string[];
}): AIWorkWorktreeEvidence {
  const manifest = input.inspection.snapshot?.manifest;
  const files = (manifest?.files ?? []).map((file) => ({
    path: file.path,
    kind: file.kind,
    ...(file.contentHash === undefined
      ? {}
      : { contentHash: file.contentHash }),
    material: file.worktreeChanged,
  }));
  const unmergedPaths = (manifest?.files ?? [])
    .filter((file) => /^(?:DD|AU|UD|UA|DU|AA|UU)$/u.test(file.statusCode ?? ""))
    .map((file) => file.path)
    .sort((left, right) => left.localeCompare(right));
  const conflictMarkers = markerPaths(manifest?.files ?? []);
  const allowedPaths = new Set(input.allowedPaths);
  const forbiddenMutation =
    input.changedPaths === undefined ||
    input.changedPaths.some((path) => !allowedPaths.has(path)) ||
    input.inspection.condition.attribution.complete !== true;
  return {
    schemaVersion: 1,
    worktreeId: input.inspection.worktree.worktreeId,
    snapshotId: input.turn.snapshotId,
    revision: 1,
    stateFingerprint:
      input.inspection.condition.currentFingerprint || "unknown-fingerprint",
    baselineRevision: manifest?.worktreeBaselineSha ?? "unknown-baseline",
    currentRevision:
      manifest?.headSha ?? input.inspection.condition.observedRevision,
    files,
    ignoredPaths: [...(manifest?.ignoredFiles ?? [])],
    unmergedPaths,
    conflictMarkers,
    actualCommands: [...input.commands].slice(0, 64),
    complete: input.inspection.ok && (manifest?.complete ?? false),
    clean: unmergedPaths.length === 0 && conflictMarkers.length === 0,
    forbiddenMutation,
  };
}

function validationForAIWork(
  model: F14ValidationReadModel,
): AIWorkValidationEvidence {
  const sourceStatus = model.status;
  const status = sourceStatus === "running" ? "interrupted" : sourceStatus;
  return {
    runId: model.runId,
    revision: model.version,
    phase: model.requestedPhase,
    status,
    complete: sourceStatus !== "running",
    ...(status === "not_run" ? { noSafeCommand: true } : {}),
    ...(model.reason === undefined ? {} : { problems: [model.reason] }),
  };
}

export class F26AIWorkAdapter {
  private readonly controller: AIWorkController;
  private readonly active = new Map<string, ActiveF26Input>();

  public constructor(private readonly options: F26AIWorkAdapterOptions) {
    const evidence: AIWorkEvidencePort = {
      inspectWorktree: async ({ operation, turn }) => {
        const active = this.active.get(operation.operationId);
        if (active === undefined) throw new Error("F26_AI_CONTEXT_MISSING");
        const beforeSnapshotId = active.beforeSnapshots.get(turn.turnId);
        if (beforeSnapshotId === undefined)
          throw new Error("F26_BEFORE_SNAPSHOT_MISSING");
        const after = await this.options.f13.completeAiTurn({
          operationId: active.f13OperationId,
          ownerId: active.ownerId,
          turnId: turn.turnId,
          beforeSnapshotId,
        });
        if (!after.ok || after.snapshot === undefined)
          throw new Error("F26_AFTER_SNAPSHOT_FAILED");
        const inspection = await this.options.f13.inspectOperation(
          active.f13OperationId,
          active.ownerId,
          "AFTER_AI",
        );
        if (inspection.snapshot === undefined)
          throw new Error("F26_AFTER_INSPECTION_FAILED");
        active.lastInspection = inspection;
        return worktreeEvidence({
          operation,
          turn,
          inspection,
          changedPaths: after.changeSummary?.changed,
          allowedPaths: active.context.conflicts.map((item) => item.path),
          commands: active.commandEvidence.get(turn.turnId) ?? [],
        });
      },
      inspectValidation: async ({ operation }) => {
        const active = this.active.get(operation.operationId);
        if (active === undefined) return undefined;
        if (
          this.options.f14 === undefined ||
          this.options.validation === undefined
        ) {
          if (active.taskSnapshot.buildValidation !== undefined)
            return undefined;
          const noSafeCommand: AIWorkValidationEvidence = {
            runId: `f26-no-validation-${active.f13OperationId}`,
            revision: 0,
            phase: "post_change",
            status: "not_run",
            complete: true,
            noSafeCommand: true,
          };
          active.validation.set(operation.operationId, noSafeCommand);
          return noSafeCommand;
        }
        const repositoryId = active.context.destinationRepository.key;
        if (repositoryId === undefined) return undefined;
        const resolution = await this.options.validation.resolve({
          repositoryId,
          operationId: active.f13OperationId,
        });
        const runId = `f26-post-${active.f13OperationId}`;
        await this.options.f14.run({
          operationId: active.f13OperationId,
          runId,
          idempotencyKey: `f26-post-key-${active.f13OperationId}`,
          correlationId: `f26-post-correlation-${active.f13OperationId}`,
          ownerType: "SYNCHRONIZATION",
          ownerId: active.ownerId,
          consumer: "synchronization",
          requestedPhase: "post_change",
          resolution,
        });
        const model = this.options.f14.readModel(runId);
        if (model === undefined) return undefined;
        const projected = validationForAIWork(model);
        active.validation.set(operation.operationId, projected);
        return projected;
      },
    };
    this.controller = new AIWorkController({
      persistence: options.persistence,
      provider: options.provider,
      evidence,
      clock: { now: () => now(options.clock) },
      onEvent: (event: AIProviderNormalizedEvent) => {
        const active = [...this.active.values()].find((value) =>
          value.beforeSnapshots.has(event.turnId),
        );
        if (active === undefined) return;
        if (event.kind !== "command") return;
        const details = record(event.details);
        const command = details?.command;
        if (typeof command !== "string") return;
        const commands = active.commandEvidence.get(event.turnId) ?? [];
        if (commands.length < 64) commands.push(command.slice(0, 4_096));
        active.commandEvidence.set(event.turnId, commands);
      },
      requestFactory: {
        create: async ({ operation, turn }) => {
          const active = this.active.get(operation.operationId);
          if (active === undefined) throw new Error("F26_AI_CONTEXT_MISSING");
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
            throw new Error("F26_MUTATION_GATE_REFUSED");
          active.beforeSnapshots.set(turn.turnId, before.snapshot.snapshotId);
          const request: AIProviderRequest = {
            schemaVersion: 1,
            requestId: `f26-request-${turn.turnId}`,
            operationId: operation.operationId,
            turnId: turn.turnId,
            providerId: active.taskSnapshot.profile.providerId,
            modelId: active.taskSnapshot.profile.modelId,
            taskType: active.taskSnapshot.taskType,
            interactionMode: "worktree_write",
            profileSnapshot: profileSnapshot(active.taskSnapshot),
            executionPolicySnapshot: executionPolicy(active.taskSnapshot),
            worktree: scopedWorktree(before.worktree, operation.operationId),
            input: active.providerInput,
            outputContract: outputContractForTask(active.taskSnapshot.taskType),
            invocation: { timeoutMs: turn.timeoutMs, streamEvents: true },
          };
          return aiProviderRequestSchema.parse(request);
        },
      },
    });
  }

  public async run(input: F26AIWorkInput): Promise<F26AIWorkResult> {
    const taskSnapshot = sanitizedTaskSnapshot(
      input.taskSnapshot,
      input.operationId,
    );
    const providerInput = {
      schemaVersion: 1 as const,
      remoteEventVersionIds: [],
      conflictContext: input.context,
    } satisfies AIProviderInputSnapshot;
    aiProviderInputSnapshotSchema.parse(providerInput);
    const operation: AIWorkOperationInput = {
      schemaVersion: 1,
      operationId: input.operationId,
      idempotencyKey: input.operationId,
      operationKind: "MERGE_CONFLICT_RESOLUTION",
      taskType: "MERGE_CONFLICT_RESOLUTION",
      purpose:
        "Resolve only the recorded merge conflicts in the operation-owned synchronization worktree while preserving compatible intent from both sides.",
      interactionMode: "worktree_write",
      worktree: worktreeScope(
        input.worktree,
        input.operationId,
        input.ownerId,
        taskSnapshot.operationWorktree?.rootRevision ?? 1,
      ),
      taskSnapshot: taskSnapshot as AIWorkOperationInput["taskSnapshot"],
      predicate: {
        id: "MERGE_CONFLICT_RESOLUTION",
        version: 1,
        inputSnapshot: {
          ...providerInput,
          f26Context: {
            schemaVersion: 1,
            f13OperationId: input.f13OperationId,
            ownerId: input.ownerId,
            ...(input.acknowledgeUnattributedChanges === undefined
              ? {}
              : {
                  acknowledgeUnattributedChanges:
                    input.acknowledgeUnattributedChanges,
                }),
            context: input.context,
          },
        },
      },
      configuredTurnBudget: input.configuredTurnBudget ?? 3,
      budgetSource: "F16_PREFERENCE",
      createdAt: now(this.options.clock),
    };
    aiWorkOperationInputSchema.parse(operation);
    const active: ActiveF26Input = {
      ...input,
      taskSnapshot,
      providerInput,
      beforeSnapshots: new Map(),
      commandEvidence: new Map(),
      validation: new Map(),
    };
    this.active.set(input.operationId, active);
    try {
      return this.projectResult(
        await this.controller.startOperation(operation, {
          autoContinue: false,
        }),
        active,
      );
    } catch (error) {
      this.active.delete(input.operationId);
      throw error;
    }
  }

  public async continue(input: {
    readonly operationId: string;
    readonly confirmation: AIWorkContinuation;
    readonly context?: F26ConflictContext;
  }): Promise<F26AIWorkResult> {
    const active =
      this.active.get(input.operationId) ??
      this.rehydrateActiveContext(input.operationId);
    if (active === undefined) throw new Error("F26_AI_CONTEXT_MISSING");
    if (input.context !== undefined) {
      const providerInput = {
        ...active.providerInput,
        conflictContext: input.context,
      } satisfies AIProviderInputSnapshot;
      aiProviderInputSnapshotSchema.parse(providerInput);
      active.context = input.context;
      active.providerInput = providerInput;
    }
    this.active.set(input.operationId, active);
    return this.projectResult(
      await this.controller.continueOperation({
        confirmation: input.confirmation,
        autoContinue: false,
      }),
      active,
    );
  }

  public authorizeContinuation(input: {
    readonly operationId: string;
    readonly kind: "CONTINUE_AI_WORK" | "RETRY_RESOLUTION";
    readonly selectedBudget?: number;
    readonly snapshotId?: string;
  }): AIWorkContinuation {
    return this.controller.authorizeContinuation(input);
  }

  public read(operationId: string): AIWorkReadModel {
    return this.controller.read(operationId);
  }

  public async cancel(
    operationId: string,
  ): Promise<AIWorkReadModel | undefined> {
    const readModel = this.controller.read(operationId);
    for (const segment of [...readModel.operation.segments].reverse()) {
      for (const turn of [...segment.turns].reverse()) {
        if (turn.status !== "RESERVED" && turn.status !== "STARTED") continue;
        return this.controller.cancelTurnAndWait(turn.turnId);
      }
    }
    return undefined;
  }

  public async reconcileStartup(): Promise<readonly AIWorkReadModel[]> {
    return this.controller.reconcileStartup(
      (operation) => operation.taskType === "MERGE_CONFLICT_RESOLUTION",
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

  private rehydrateActiveContext(
    operationId: string,
  ): ActiveF26Input | undefined {
    const operation = this.options.persistence.getOperation(operationId);
    if (
      operation === undefined ||
      operation.taskType !== "MERGE_CONFLICT_RESOLUTION"
    )
      return undefined;
    const snapshot = record(operation.predicate.inputSnapshot);
    if (snapshot === undefined) return undefined;
    const context = f26OperationContextSchema.safeParse(snapshot.f26Context);
    if (!context.success) return undefined;
    const { f26Context: _context, ...rawInput } = snapshot;
    const parsedInput = aiProviderInputSnapshotSchema.safeParse(rawInput);
    if (!parsedInput.success) return undefined;
    return {
      operationId,
      f13OperationId: context.data.f13OperationId,
      ownerId: context.data.ownerId,
      taskSnapshot: operation.taskSnapshot,
      context: context.data.context,
      worktree: {
        schemaVersion: 1,
        operationId,
        worktreeId: operation.worktree?.worktreeId ?? "unknown-worktree",
        ownerType: operation.worktree?.ownerType ?? "SYNCHRONIZATION",
        ownerId: context.data.ownerId,
        operationKind: "SYNCHRONIZATION",
        canonicalPath: operation.worktree?.canonicalPath ?? "C:\\unknown",
        access: "WORKTREE_WRITE",
        ownership: {
          kind: "OPERATION_OWNED",
          ownerType: operation.worktree?.ownerType ?? "SYNCHRONIZATION",
          ownerId: context.data.ownerId,
        },
        actualState: {
          snapshotId: operation.taskSnapshot.snapshotId,
          stateFingerprint: "rehydrate",
          baselineRevision: "rehydrate",
          expectedHeadRevision: "rehydrate",
          files: [],
          ignoredFiles: [],
          complete: true,
        },
        permittedCapabilities: {
          readFiles: true,
          writeFiles: true,
          executeCommands: false,
          network: false,
          publication: false,
        },
      },
      acknowledgeUnattributedChanges:
        context.data.acknowledgeUnattributedChanges,
      providerInput: parsedInput.data,
      beforeSnapshots: new Map(),
      commandEvidence: new Map(),
      validation: new Map(),
    };
  }

  private projectResult(
    readModel: AIWorkReadModel,
    active: ActiveF26Input,
  ): F26AIWorkResult {
    let durableReadModel = readModel;
    if (
      durableReadModel.operation.status === "WORKING" &&
      durableReadModel.reports.at(-1)?.progress?.complete !== true
    ) {
      const stopReason: AIWorkStopReason = {
        code: "AI_CONTINUATION_REQUIRED",
        category: "AI_WORK",
        what: "F26 stopped after one bounded turn and requires explicit follow-up.",
        why: "Conflict resolution cannot continue automatically after an unresolved, ambiguous, or incomplete result.",
        nextAction: "RETRY_RESOLUTION",
        details: { operationId: active.operationId },
        attention: true,
      };
      try {
        this.options.persistence.setOperationStatus({
          operationId: active.operationId,
          status: "NEEDS_ATTENTION",
          stopReason,
        });
        durableReadModel = this.controller.read(active.operationId);
      } catch {
        // Preserve the controller's durable read model if a concurrent
        // reconciliation already changed the operation state.
      }
    }
    const raw = durableReadModel.reports.at(-1)?.modelClaims.semanticResult;
    const parsed =
      raw === undefined
        ? undefined
        : parseAIProviderStructuredResult(
            outputContractForTask("MERGE_CONFLICT_RESOLUTION"),
            raw,
            [],
          );
    const assessment =
      parsed?.success === true
        ? (parsed.data as AIConflictResolutionResult)
        : undefined;
    const report = durableReadModel.reports.at(-1);
    return {
      readModel: durableReadModel,
      ...(assessment === undefined ? {} : { assessment }),
      ...(report?.evidence === undefined ? {} : { evidence: report.evidence }),
      ...(active.validation.get(active.operationId) === undefined
        ? {}
        : { validation: active.validation.get(active.operationId) }),
      attributionComplete:
        active.lastInspection?.condition.attribution.complete,
    };
  }
}
