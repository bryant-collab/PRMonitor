import type {
  F13InspectionResult,
  F13PathActionResult,
  F13WorktreeCondition,
} from "../shared/f13-contracts";
import type { F18AutomaticReviewBoundary } from "./automatic-review-coordinator";
import type { F18DecisionInput } from "../shared/f18-automatic-review";
import type { F14ValidationReadModel } from "./f14-validation-runner";
import {
  F20_MAX_VALIDATION_OUTPUT_BYTES,
  f20PathActionResultSchema,
  f20ValidationProjectionSchema,
  projectDiffView,
  projectReviewBundleWorkspace,
  type F20ConfigurationSnapshot,
  type F20DecisionCommandInput,
  type F20DiffView,
  type F20DraftCommandInput,
  type F20PathActionInput,
  type F20ReadDiffInput,
  type F20RefreshWorktreeInput,
  type F20ValidationProjection,
  type F20WorkspaceReadModel,
} from "../shared/f20-workspace";

export interface F20WorktreePort {
  readonly inspectOperation: (
    operationId: string,
    ownerId: string,
    phase?: "PREPARE" | "INSPECTION" | "BEFORE_AI" | "AFTER_AI",
  ) => Promise<F13InspectionResult>;
  readonly openWorktree: (input: {
    readonly operationId: string;
  }) => Promise<F13PathActionResult>;
  readonly openFile: (input: {
    readonly operationId: string;
    readonly relativePath: string;
  }) => Promise<F13PathActionResult>;
  readonly revealFile: (input: {
    readonly operationId: string;
    readonly relativePath: string;
  }) => Promise<F13PathActionResult>;
}

export interface F20ValidationPort {
  readonly readModel: (runId: string) => F14ValidationReadModel | undefined;
}

export interface F20WorkspaceServiceOptions {
  readonly bundles: F18AutomaticReviewBoundary;
  readonly worktrees: F20WorktreePort;
  readonly validation?: F20ValidationPort;
}

export class F20WorkspaceError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "F20WorkspaceError";
  }
}

function boundedOutput(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const bytes = new TextEncoder().encode(value).byteLength;
  if (bytes <= F20_MAX_VALIDATION_OUTPUT_BYTES) return value;
  return `${value.slice(0, F20_MAX_VALIDATION_OUTPUT_BYTES)}\n[output omitted by F20 bound]`;
}

function validationProjection(
  model: F14ValidationReadModel | undefined,
): F20ValidationProjection | undefined {
  if (model === undefined) return undefined;
  return f20ValidationProjectionSchema.parse({
    runId: model.runId,
    operationId: model.operationId,
    phase: model.requestedPhase,
    status: model.status,
    ...(model.reason === undefined ? {} : { reason: model.reason }),
    nextAction: model.nextAction,
    startedAt: model.startedAt,
    ...(model.completedAt === undefined
      ? {}
      : { completedAt: model.completedAt }),
    ...(model.snapshot === undefined
      ? {}
      : {
          snapshot: {
            snapshotId: model.snapshot.snapshotId,
            baselineRevision: model.snapshot.baselineRevision,
            ...(model.snapshot.currentRevision === undefined
              ? {}
              : { currentRevision: model.snapshot.currentRevision }),
          },
        }),
    steps: model.steps.map((step) => ({
      stepId: step.stepId,
      kind: step.kind,
      ...(step.configuredPhase === undefined
        ? {}
        : { configuredPhase: step.configuredPhase }),
      ...(step.executedPhase === undefined
        ? {}
        : { executedPhase: step.executedPhase }),
      status: step.status,
      ...(step.reason === undefined ? {} : { reason: step.reason }),
      ...(step.executable === undefined && step.arguments === undefined
        ? {}
        : {
            command: {
              ...(step.executable === undefined
                ? {}
                : { executable: step.executable }),
              ...(step.arguments === undefined
                ? {}
                : { arguments: step.arguments }),
            },
          }),
      ...(step.canonicalWorkingDirectory === undefined
        ? {}
        : { workingDirectory: step.canonicalWorkingDirectory }),
      ...(step.startedAt === undefined ? {} : { startedAt: step.startedAt }),
      ...(step.completedAt === undefined
        ? {}
        : { completedAt: step.completedAt }),
      ...(step.exitCode === undefined ? {} : { exitCode: step.exitCode }),
      ...(step.signal === undefined ? {} : { signal: step.signal }),
      ...(step.stdout?.text === undefined
        ? {}
        : { stdout: boundedOutput(step.stdout.text) }),
      ...(step.stderr?.text === undefined
        ? {}
        : { stderr: boundedOutput(step.stderr.text) }),
      ...(step.manualLabel === undefined
        ? {}
        : { manualLabel: step.manualLabel }),
    })),
    manualAttestations: model.manualAttestations.map((attestation) => ({
      checkId: attestation.checkId,
      outcome: attestation.outcome,
      timestamp: attestation.timestamp,
    })),
    warningCodes: model.warnings.map((warning) => warning.code),
  });
}

function configurationWithValidation(
  workspace: F20WorkspaceReadModel,
  model: F14ValidationReadModel | undefined,
): F20ConfigurationSnapshot {
  if (model === undefined) return workspace.configuration;
  return {
    ...workspace.configuration,
    ...(model.requestedPhase === "baseline" || model.requestedPhase === "both"
      ? { buildValidationStatus: model.status }
      : {}),
  };
}

export class F20WorkspaceService {
  private readonly refreshedConditions = new Map<
    string,
    F13WorktreeCondition
  >();

  public constructor(private readonly options: F20WorkspaceServiceOptions) {}

  public read(bundleId: string): F20WorkspaceReadModel {
    const model = this.requireReadModel(bundleId);
    return this.project(model);
  }

  public async readDiff(input: F20ReadDiffInput): Promise<F20DiffView> {
    const model = this.requireReadModel(input.bundleId);
    if (model.worktree === undefined)
      throw new F20WorkspaceError(
        "WORKTREE_UNAVAILABLE",
        "The Review Bundle has no operation-owned worktree evidence.",
      );
    const item = model.items.find(
      (candidate) => candidate.itemId === input.itemId,
    );
    const feedback = model.input.feedback.find(
      (candidate) => candidate.eventVersionId === item?.eventVersionId,
    );
    const inspection = await this.options.worktrees.inspectOperation(
      model.operationId,
      model.bundleId,
      "INSPECTION",
    );
    return projectDiffView({
      bundleId: model.bundleId,
      operationId: model.operationId,
      mode: input.mode,
      inspection,
      prBaseSha: model.input.pullRequest.baseSha,
      prHeadSha: model.input.pullRequest.headSha,
      worktreeBaselineSha: model.worktree.baselineSha,
      ...(input.itemId === undefined ? {} : { selectedItemId: input.itemId }),
      ...(item === undefined
        ? {}
        : { relatedPaths: item.recommendation.relatedFiles }),
      ...(feedback?.diffHunk === undefined
        ? {}
        : { relatedHunk: feedback.diffHunk }),
    });
  }

  public recordDecision(input: F20DecisionCommandInput): F20WorkspaceReadModel {
    const recordDecision = this.options.bundles.recordDecision;
    const result = recordDecision({
      bundleId: input.bundleId,
      itemId: input.itemId,
      decision: input.decision,
      finalDisposition: input.finalDisposition,
      ...(input.instruction === undefined
        ? {}
        : { instruction: input.instruction }),
      ...(input.answer === undefined ? {} : { answer: input.answer }),
      ...(input.expectedVersion === undefined
        ? {}
        : { expectedVersion: input.expectedVersion }),
      ...(input.actionId === undefined ? {} : { actionId: input.actionId }),
    } satisfies F18DecisionInput);
    return this.project(result);
  }

  public async confirmDecisions(input: {
    readonly bundleId: string;
    readonly expectedVersion?: number;
    readonly actionId?: string;
  }): Promise<F20WorkspaceReadModel> {
    const result = await this.options.bundles.confirmReviewDecisions(input);
    return this.project(result);
  }

  public saveDraft(input: F20DraftCommandInput): F20WorkspaceReadModel {
    const result = this.options.bundles.saveDraftResponse(input);
    return this.project(result);
  }

  public async refreshWorktree(
    input: F20RefreshWorktreeInput,
  ): Promise<F20WorkspaceReadModel> {
    const model = this.requireReadModel(input.bundleId);
    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== model.version
    )
      throw new F20WorkspaceError(
        "STALE_WORKSPACE_REVISION",
        "The Review Bundle changed before worktree evidence was refreshed. Reload the workspace.",
      );
    if (model.worktree === undefined)
      throw new F20WorkspaceError(
        "WORKTREE_UNAVAILABLE",
        "The Review Bundle has no operation-owned worktree evidence.",
      );
    const inspection = await this.options.worktrees.inspectOperation(
      model.operationId,
      model.bundleId,
      "INSPECTION",
    );
    this.refreshedConditions.set(model.bundleId, inspection.condition);
    return this.project(this.requireReadModel(input.bundleId));
  }

  public async pathAction(
    input: F20PathActionInput,
  ): Promise<ReturnType<typeof f20PathActionResultSchema.parse>> {
    const model = this.requireReadModel(input.bundleId);
    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== model.version
    )
      throw new F20WorkspaceError(
        "STALE_WORKSPACE_REVISION",
        "The Review Bundle changed before the worktree action was requested. Reload the workspace.",
      );
    if (model.worktree === undefined)
      throw new F20WorkspaceError(
        "WORKTREE_UNAVAILABLE",
        "The Review Bundle has no operation-owned worktree evidence.",
      );
    if (input.action !== "OPEN_WORKTREE") {
      if (input.relativePath === undefined)
        throw new F20WorkspaceError(
          "PATH_NOT_RECORDED",
          "A file action requires a recorded relative path.",
        );
      const normalized = input.relativePath.replaceAll("\\", "/");
      const allowed = new Set<string>([
        ...model.worktree.changedFiles.map((file) =>
          file.replaceAll("\\", "/"),
        ),
        ...model.items.flatMap((item) => item.recommendation.relatedFiles),
      ]);
      if (!allowed.has(normalized))
        throw new F20WorkspaceError(
          "PATH_NOT_RECORDED",
          "The requested file is not a recorded Review Bundle or F13 diff target.",
        );
    }
    const result =
      input.action === "OPEN_WORKTREE"
        ? await this.options.worktrees.openWorktree({
            operationId: model.operationId,
          })
        : input.action === "OPEN_FILE"
          ? await this.options.worktrees.openFile({
              operationId: model.operationId,
              relativePath: input.relativePath as string,
            })
          : await this.options.worktrees.revealFile({
              operationId: model.operationId,
              relativePath: input.relativePath as string,
            });
    return f20PathActionResultSchema.parse({
      ok: result.ok,
      action: result.action,
      ...(result.resolvedPath === undefined
        ? {}
        : { resolvedPath: result.resolvedPath }),
      ...(result.reason === undefined
        ? {}
        : {
            reason: {
              code: result.reason.code,
              what: result.reason.what,
              why: result.reason.why,
              nextAction: result.reason.nextAction,
            },
          }),
    });
  }

  private requireReadModel(bundleId: string) {
    const model = this.options.bundles.getReadModel?.(bundleId);
    if (model === undefined)
      throw new F20WorkspaceError(
        "BUNDLE_NOT_FOUND",
        "The Review Bundle is no longer available. Reload the inbox and try again.",
      );
    return model;
  }

  private project(
    model: Parameters<typeof projectReviewBundleWorkspace>[0]["readModel"],
  ): F20WorkspaceReadModel {
    const baselineRunId = model.baselineValidation?.runId;
    const postRunId = model.postChangeValidation?.runId;
    const baseline =
      baselineRunId === undefined || this.options.validation === undefined
        ? undefined
        : validationProjection(
            this.options.validation.readModel(baselineRunId),
          );
    const post =
      postRunId === undefined || this.options.validation === undefined
        ? undefined
        : validationProjection(this.options.validation.readModel(postRunId));
    const workspace = projectReviewBundleWorkspace({
      readModel: model,
      ...(baseline === undefined ? {} : { baselineValidation: baseline }),
      ...(post === undefined ? {} : { postChangeValidation: post }),
      ...(this.refreshedConditions.get(model.bundleId) === undefined
        ? {}
        : { worktreeCondition: this.refreshedConditions.get(model.bundleId) }),
    });
    const baselineSource =
      baselineRunId === undefined || this.options.validation === undefined
        ? undefined
        : this.options.validation.readModel(baselineRunId);
    const postSource =
      postRunId === undefined || this.options.validation === undefined
        ? undefined
        : this.options.validation.readModel(postRunId);
    return {
      ...workspace,
      configuration: configurationWithValidation(
        workspace,
        baselineSource ?? postSource,
      ),
    };
  }
}
