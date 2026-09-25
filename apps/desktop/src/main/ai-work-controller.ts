import { randomUUID } from "node:crypto";
import {
  aiProviderRequestSchema,
  aiProviderTurnResultSchema,
  type AIProviderRequest,
  type AIProviderTurnResult,
} from "../shared/ai/provider-contracts";
import type { AIProviderInvokeOptions } from "./ai/registry";
import {
  aiWorkEvidenceBundleSchema,
  aiWorkOperationInputSchema,
  aiWorkReasonSchema,
  aiWorkTurnReportSchema,
  aiWorkValidationEvidenceSchema,
  aiWorkWorktreeEvidenceSchema,
  AI_WORK_DEFAULT_TIMEOUT_MS,
  AI_WORK_DEFAULT_TURN_BUDGET,
  AI_WORK_MAX_TIMEOUT_MS,
  AI_WORK_MIN_TIMEOUT_MS,
  AI_WORK_RECONCILIATION_WINDOW_MS,
  aiWorkModelClaimsFromProviderResult,
  aiWorkNormalizeUsage,
  aiWorkStableDigest,
  evaluateAIWorkProgress,
  createDefaultAIWorkPredicateRegistry,
  isAIWorkMutatingTurn,
  isAIWorkTerminalTurn,
  type AIProgressHistoryEntry,
  type AIProgressEvaluation,
  type AIWorkContinuation,
  type AIWorkEvidenceBundle,
  type AIWorkNextAction,
  type AIWorkOperationInput,
  type AIWorkOperationRecord,
  type AIWorkPersistencePort,
  type AIWorkPredicate,
  type AIWorkPredicateRegistry,
  type AIWorkReadModel,
  type AIWorkReconciliation,
  type AIWorkSegmentRecord,
  type AIWorkStopReason,
  type AIWorkTurnIntent,
  type AIWorkTurnReport,
  type AIWorkTurnStatus,
  type AIWorkValidationEvidence,
  type AIWorkWorktreeEvidence,
} from "../shared/ai-work";

export interface AIWorkClock {
  readonly now: () => string;
  readonly setTimeout?: (callback: () => void, milliseconds: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
}

export interface AIWorkEvidencePort {
  readonly inspectWorktree: (input: {
    readonly operation: AIWorkOperationRecord;
    readonly segment: AIWorkSegmentRecord;
    readonly turn: AIWorkTurnIntent;
  }) => Promise<AIWorkWorktreeEvidence>;
  readonly inspectValidation?: (input: {
    readonly operation: AIWorkOperationRecord;
    readonly segment: AIWorkSegmentRecord;
    readonly turn: AIWorkTurnIntent;
  }) => Promise<AIWorkValidationEvidence | undefined>;
}

export interface AIWorkProviderPort {
  readonly invoke: (
    request: AIProviderRequest,
    options?: AIProviderInvokeOptions,
  ) => Promise<AIProviderTurnResult>;
}

export interface AIWorkProviderRequestFactory {
  readonly create: (input: {
    readonly operation: AIWorkOperationRecord;
    readonly segment: AIWorkSegmentRecord;
    readonly turn: AIWorkTurnIntent;
  }) => AIProviderRequest | Promise<AIProviderRequest>;
}

export interface AIWorkActivityPort {
  readonly append: (input: {
    readonly eventId: string;
    readonly correlationId: string;
    readonly operationId: string;
    readonly severity: "INFO" | "WARN" | "ERROR";
    readonly reasonCode: string;
    readonly summary: string;
    readonly details: Readonly<Record<string, string | number | boolean>>;
  }) => void;
}

export interface AIWorkControllerOptions {
  readonly persistence: AIWorkPersistencePort;
  readonly provider: AIWorkProviderPort;
  readonly requestFactory: AIWorkProviderRequestFactory;
  readonly evidence: AIWorkEvidencePort;
  readonly predicates?: AIWorkPredicateRegistry;
  readonly activity?: AIWorkActivityPort;
  readonly clock?: AIWorkClock;
  readonly reconciliationWindowMs?: number;
}

export interface AIWorkStartOptions {
  readonly autoContinue?: boolean;
}

export interface AIWorkNextTurnInput {
  readonly operationId: string;
  readonly autoContinue?: boolean;
}

export interface AIWorkContinueInput {
  readonly confirmation: AIWorkContinuation;
  readonly taskSnapshot?: AIWorkOperationInput["taskSnapshot"];
  readonly autoContinue?: boolean;
}

export interface AIWorkNewOperationInput {
  readonly priorOperationId: string;
  readonly confirmation: AIWorkContinuation;
  readonly operation: AIWorkOperationInput;
  readonly autoContinue?: boolean;
}

export class AIWorkControllerError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string, options?: ErrorOptions) {
    super(`${code}: ${message}`, options);
    this.name = "AIWorkControllerError";
    this.code = code;
  }
}

const PRESTART_REFUSAL_CODES = new Set([
  "INVALID_REQUEST",
  "CAPABILITY_UNSUPPORTED",
  "PROVIDER_UNKNOWN",
  "PROVIDER_CONFIGURATION_INVALID",
  "POLICY_BOUNDARY_VIOLATION",
  "POLICY_UNSUPPORTED",
  "CONVERSATION_NOT_AUTHORIZED",
  "CONVERSATION_PROVIDER_MISMATCH",
  "PROVIDER_RESULT_INVALID",
]);

function defaultClock(): AIWorkClock {
  return {
    now: () => new Date().toISOString(),
  };
}

function safeId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed))
    throw new AIWorkControllerError(
      "AI_INVALID_CLOCK",
      "The F17 clock did not return a valid timestamp.",
    );
  return new Date(parsed + milliseconds).toISOString();
}

function boundedTimeout(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? AI_WORK_DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(value) ||
    value < AI_WORK_MIN_TIMEOUT_MS ||
    value > AI_WORK_MAX_TIMEOUT_MS
  )
    throw new AIWorkControllerError(
      "AI_INVALID_TIMEOUT",
      "AI turn timeouts must be between one second and sixty minutes.",
    );
  return value;
}

function operationSegment(
  operation: AIWorkOperationRecord,
  segmentId: string,
): AIWorkSegmentRecord {
  const segment = operation.segments.find(
    (candidate) => candidate.segmentId === segmentId,
  );
  if (segment === undefined)
    throw new AIWorkControllerError(
      "AI_SEGMENT_NOT_FOUND",
      "The F17 segment is not present in the durable operation.",
    );
  return segment;
}

function operationTurn(
  operation: AIWorkOperationRecord,
  turnId: string,
): { readonly segment: AIWorkSegmentRecord; readonly turn: AIWorkTurnIntent } {
  for (const segment of operation.segments) {
    const turn = segment.turns.find((candidate) => candidate.turnId === turnId);
    if (turn !== undefined) return { segment, turn };
  }
  throw new AIWorkControllerError(
    "AI_TURN_NOT_FOUND",
    "The F17 turn is not present in the durable operation.",
  );
}

function lastSegment(operation: AIWorkOperationRecord): AIWorkSegmentRecord {
  const segment = operation.segments[operation.segments.length - 1];
  if (segment === undefined)
    throw new AIWorkControllerError(
      "AI_SEGMENT_NOT_FOUND",
      "The F17 operation has no durable segment.",
    );
  return segment;
}

function snapshotPolicyRank(sandboxMode: string): number {
  switch (sandboxMode) {
    case "read-only":
      return 0;
    case "workspace-write":
      return 1;
    case "danger-full-access":
      return 2;
    default:
      return Number.MAX_SAFE_INTEGER;
  }
}

function snapshotPolicyDoesNotBroaden(
  current: AIWorkOperationRecord["taskSnapshot"]["policy"],
  candidate: AIWorkOperationInput["taskSnapshot"]["policy"],
): boolean {
  return (
    candidate.interactionMode === current.interactionMode &&
    snapshotPolicyRank(candidate.sandboxMode) <=
      snapshotPolicyRank(current.sandboxMode) &&
    !(
      current.networkAccess === "disabled" &&
      candidate.networkAccess === "enabled"
    ) &&
    !(
      current.approvalPolicy === "on-request" &&
      candidate.approvalPolicy === "never"
    )
  );
}

function snapshotScopeMatchesOperation(
  operation: AIWorkOperationRecord,
  candidate: AIWorkOperationInput["taskSnapshot"],
): boolean {
  const currentWorktree = operation.worktree;
  const candidateWorktree = candidate.operationWorktree;
  if (currentWorktree === undefined || candidateWorktree === undefined)
    return currentWorktree === undefined && candidateWorktree === undefined;
  return (
    currentWorktree.operationId === candidateWorktree.operationId &&
    currentWorktree.canonicalPath === candidateWorktree.canonicalPath &&
    currentWorktree.rootRevision === candidateWorktree.rootRevision
  );
}

function snapshotMatchesOperation(
  operation: AIWorkOperationRecord,
  candidate: AIWorkOperationInput["taskSnapshot"],
): boolean {
  return (
    candidate.taskType === operation.taskType &&
    snapshotPolicyDoesNotBroaden(
      operation.taskSnapshot.policy,
      candidate.policy,
    ) &&
    snapshotScopeMatchesOperation(operation, candidate)
  );
}

function validateSnapshotInteraction(
  operation: Pick<AIWorkOperationInput, "interactionMode" | "taskSnapshot">,
): boolean {
  return (
    operation.interactionMode === operation.taskSnapshot.policy.interactionMode
  );
}

function emptyWorktreeEvidence(input: {
  readonly operation: AIWorkOperationRecord;
  readonly segment: AIWorkSegmentRecord;
  readonly turn: AIWorkTurnIntent;
}): AIWorkWorktreeEvidence {
  return {
    schemaVersion: 1,
    worktreeId: input.operation.worktree?.worktreeId ?? "unknown-worktree",
    snapshotId: input.turn.snapshotId,
    revision: 0,
    stateFingerprint: "unknown",
    baselineRevision: "unknown",
    currentRevision: "unknown",
    files: [],
    ignoredPaths: [],
    unmergedPaths: [],
    conflictMarkers: [],
    actualCommands: [],
    complete: false,
    clean: false,
    forbiddenMutation: false,
  };
}

function evidenceBundle(input: {
  readonly operation: AIWorkOperationRecord;
  readonly segment: AIWorkSegmentRecord;
  readonly turn: AIWorkTurnIntent;
  readonly worktree: AIWorkWorktreeEvidence;
  readonly validation?: AIWorkValidationEvidence;
  readonly deterministicProblems?: readonly string[];
}): AIWorkEvidenceBundle {
  const deterministicProblems = [
    ...(input.deterministicProblems ?? []),
    ...(input.worktree.complete ? [] : ["worktree-evidence-incomplete"]),
    ...(input.worktree.forbiddenMutation
      ? ["forbidden-worktree-mutation"]
      : []),
  ].slice(0, 64);
  return aiWorkEvidenceBundleSchema.parse({
    schemaVersion: 1,
    evidenceRevision: `${input.worktree.snapshotId}:${input.worktree.revision}`,
    worktree: input.worktree,
    ...(input.validation === undefined ? {} : { validation: input.validation }),
    deterministicProblems,
    materialProblemIds: input.worktree.files
      .filter((file) => file.material === true)
      .map((file) => aiWorkStableDigest(file.path))
      .slice(0, 64),
  });
}

function reason(
  code: AIWorkStopReason["code"],
  what: string,
  why: string,
  nextAction: AIWorkNextAction,
  details: Record<string, string | number | boolean> = {},
): AIWorkStopReason {
  return {
    code,
    category: code.startsWith("AI_") ? "AI_WORK" : "WORKFLOW",
    what: what.slice(0, 8_192),
    why: why.slice(0, 8_192),
    nextAction,
    details,
    attention: true,
  };
}

function progressStopReason(
  progress: AIProgressEvaluation,
): AIWorkStopReason | undefined {
  if (
    progress.reason.code !== "AI_REPEATED_STATE" &&
    progress.reason.code !== "AI_NO_PROGRESS" &&
    progress.reason.code !== "AI_INVALID_EVIDENCE"
  )
    return undefined;
  return reason(
    progress.reason.code as AIWorkStopReason["code"],
    progress.reason.what,
    progress.reason.why,
    progress.reason.nextAction,
    { fingerprint: progress.fingerprint },
  );
}

function providerStopReason(
  result: AIProviderTurnResult,
  timedOut: boolean,
  uncertain: boolean,
  abortReason?: unknown,
): AIWorkStopReason | undefined {
  if (uncertain)
    return reason(
      "AI_UNCERTAIN_TERMINATION",
      "The provider outcome could not be reconciled within the bounded window.",
      "F17 preserves the consumed turn and operation worktree to prevent a duplicate provider effect.",
      "RECONCILE",
    );
  if (timedOut || result.status === "timed_out")
    return reason(
      "AI_TURN_TIMEOUT",
      "The provider turn reached its immutable controller-owned deadline.",
      "Provider activity cannot extend the F17 turn timeout.",
      "CONTINUE_AI_WORK",
    );
  if (abortReason === "F17_APP_SHUTDOWN")
    return reason(
      "AI_APP_SHUTDOWN",
      "Application shutdown interrupted the provider turn.",
      "F17 preserves the committed turn and does not replace it during shutdown.",
      "RECONCILE",
    );
  if (abortReason === "F17_USER_CANCEL")
    return reason(
      "AI_TURN_CANCELLED",
      "The provider turn was cancelled by the user.",
      "Cancellation preserves the operation evidence and never starts a replacement automatically.",
      "CONTINUE_AI_WORK",
    );
  if (result.status === "cancelled")
    return reason(
      "AI_TURN_CANCELLED",
      "The provider turn was cancelled before it completed.",
      "Cancellation preserves the operation evidence and never starts a replacement automatically.",
      "CONTINUE_AI_WORK",
    );
  if (result.status === "interrupted")
    return reason(
      "AI_APP_RESTART",
      "The provider turn was interrupted by application lifecycle recovery.",
      "The committed turn remains reviewable and is not silently resumed.",
      "RECONCILE",
    );
  if (result.status === "failed")
    return reason(
      "AI_EXECUTION_FAILED",
      "The provider returned a failed turn outcome.",
      "Provider failure is deterministic stop evidence, not a completion claim.",
      "CONTINUE_AI_WORK",
      result.error === undefined ? {} : { providerCode: result.error.code },
    );
  return undefined;
}

function syntheticResult(
  request: AIProviderRequest,
  status: AIProviderTurnResult["status"],
  completedAt: string,
  code: string,
  detail: string,
): AIProviderTurnResult {
  return {
    schemaVersion: 1,
    requestId: request.requestId,
    operationId: request.operationId,
    turnId: request.turnId,
    providerId: request.providerId,
    modelId: request.modelId,
    taskType: request.taskType,
    profileRevision: request.profileSnapshot.profileRevision,
    executionPolicySnapshot: {
      schemaVersion: request.executionPolicySnapshot.schemaVersion,
      snapshotHash: request.executionPolicySnapshot.snapshotHash,
    },
    startedAt: completedAt,
    completedAt,
    status,
    interactionMode: request.interactionMode,
    outputContract: request.outputContract,
    events: [],
    error: {
      code,
      category: "F17_CONTROLLER",
      retryable: false,
      userAction: "RECONCILE",
      detail: detail.slice(0, 1_024),
    },
  };
}

function knownPrestartRefusal(result: AIProviderTurnResult): boolean {
  return (
    result.status === "failed" &&
    result.error !== undefined &&
    PRESTART_REFUSAL_CODES.has(result.error.code)
  );
}

function providerResultMatchesRequest(
  request: AIProviderRequest,
  result: AIProviderTurnResult,
): boolean {
  return (
    result.requestId === request.requestId &&
    result.operationId === request.operationId &&
    result.turnId === request.turnId &&
    result.providerId === request.providerId &&
    result.modelId === request.modelId &&
    result.taskType === request.taskType &&
    result.profileRevision === request.profileSnapshot.profileRevision &&
    result.executionPolicySnapshot.snapshotHash ===
      request.executionPolicySnapshot.snapshotHash &&
    (result.interactionMode === undefined ||
      result.interactionMode === request.interactionMode) &&
    (result.outputContract === undefined ||
      result.outputContract.contractId === request.outputContract.contractId)
  );
}

function reportForPrestart(input: {
  readonly operation: AIWorkOperationRecord;
  readonly segment: AIWorkSegmentRecord;
  readonly turn: AIWorkTurnIntent;
  readonly completedAt: string;
  readonly code?: string;
}): AIWorkTurnReport {
  const terminalReason = reason(
    "AI_PRESTART_REFUSED",
    "The provider rejected the turn before starting an external effect.",
    "F17 released the reservation and preserved a bounded refusal report.",
    "REVIEW",
    input.code === undefined ? {} : { providerCode: input.code },
  );
  return aiWorkTurnReportSchema.parse({
    schemaVersion: 1,
    turnId: input.turn.turnId,
    operationId: input.operation.operationId,
    segmentId: input.segment.segmentId,
    turnNumber: input.turn.sequence + 1,
    objective: input.operation.purpose,
    startedAt: input.turn.startedAt ?? input.turn.createdAt,
    completedAt: input.completedAt,
    providerStatus: "prestart_refused",
    modelClaims: {
      problems: [],
      remainingIssues: ["provider-admission"],
      claimedChangedFiles: [],
      claimedCommands: [],
      providerEventCount: 0,
      providerEventKinds: [],
    },
    actualChangedFiles: [],
    actualCommands: [],
    deterministicProblems: ["provider-admission"],
    remainingProblems: ["provider-admission"],
    usage: aiWorkNormalizeUsage(undefined),
    terminalReason,
    nextAction: "REVIEW",
  });
}

export class AIWorkController {
  private readonly clock: AIWorkClock;
  private readonly predicates: AIWorkPredicateRegistry;
  private readonly reconciliationWindowMs: number;
  private readonly activeControllers = new Map<string, AbortController>();
  private readonly activeRuns = new Map<string, Promise<AIWorkReadModel>>();
  private stopping = false;

  public constructor(private readonly options: AIWorkControllerOptions) {
    this.clock = options.clock ?? defaultClock();
    this.predicates =
      options.predicates ?? createDefaultAIWorkPredicateRegistry();
    this.reconciliationWindowMs = Math.max(
      1,
      Math.min(
        options.reconciliationWindowMs ?? AI_WORK_RECONCILIATION_WINDOW_MS,
        AI_WORK_RECONCILIATION_WINDOW_MS,
      ),
    );
  }

  public read(operationId: string): AIWorkReadModel {
    const operation = this.options.persistence.getOperation(operationId);
    if (operation === undefined)
      throw new AIWorkControllerError(
        "AI_OPERATION_NOT_FOUND",
        "The F17 operation does not exist.",
      );
    return this.readModel(operation);
  }

  public async startOperation(
    input: AIWorkOperationInput,
    options: AIWorkStartOptions = {},
  ): Promise<AIWorkReadModel> {
    if (this.stopping)
      throw new AIWorkControllerError(
        "AI_CONTROLLER_STOPPING",
        "F17 will not admit new work during application shutdown.",
      );
    const parsed = aiWorkOperationInputSchema.safeParse(input);
    if (!parsed.success)
      throw new AIWorkControllerError(
        "AI_OPERATION_INPUT_INVALID",
        "The F17 operation input failed its bounded contract.",
      );
    if (!validateSnapshotInteraction(parsed.data))
      throw new AIWorkControllerError(
        "AI_SNAPSHOT_MISMATCH",
        "The F16 policy snapshot interaction mode does not match the operation.",
      );
    if (
      this.predicates.resolve(
        parsed.data.predicate.id,
        parsed.data.predicate.version,
      ) === undefined
    )
      throw new AIWorkControllerError(
        "AI_PREDICATE_UNKNOWN",
        "The F17 completion predicate is not registered.",
      );
    const timeoutMs = boundedTimeout(parsed.data.timeoutMs);
    const operationInput = {
      ...parsed.data,
      configuredTurnBudget:
        parsed.data.configuredTurnBudget ?? AI_WORK_DEFAULT_TURN_BUDGET,
      timeoutMs,
    } as AIWorkOperationInput;
    const admission = this.options.persistence.admitOperation({
      operation: operationInput,
      segmentId: safeId("ai-segment"),
      turnId: safeId("ai-turn"),
      deadlineAt: addMilliseconds(this.clock.now(), timeoutMs),
    });
    this.emit(
      admission.operation.operationId,
      "AI_WORK_ADMITTED",
      "F17 bounded AI work was durably admitted.",
      "INFO",
    );
    if (!admission.inserted || isAIWorkTerminalTurn(admission.turn.status))
      return this.readModel(admission.operation);
    return this.executeOrJoin(
      admission.operation,
      admission.turn,
      options.autoContinue === true,
    );
  }

  public async startNextTurn(
    input: AIWorkNextTurnInput,
  ): Promise<AIWorkReadModel> {
    const operation = this.options.persistence.getOperation(input.operationId);
    if (operation === undefined)
      throw new AIWorkControllerError(
        "AI_OPERATION_NOT_FOUND",
        "The F17 operation does not exist.",
      );
    for (const [turnId, run] of this.activeRuns) {
      if (
        operation.segments.some((segment) =>
          segment.turns.some((turn) => turn.turnId === turnId),
        )
      )
        return run;
    }
    if (operation.status !== "WORKING") return this.readModel(operation);
    const segment = lastSegment(operation);
    if (
      operation.remainingTurnCount <= 0 &&
      isAIWorkMutatingTurn(segment.interactionMode)
    ) {
      const stop = reason(
        "AI_TURN_BUDGET_EXHAUSTED",
        "The configured mutating-turn budget has been exhausted.",
        "F17 requires a separately confirmed new operation before more mutating work.",
        "START_NEW_OPERATION",
        { consumedTurnCount: operation.consumedTurnCount },
      );
      return this.readModel(
        this.options.persistence.setOperationStatus({
          operationId: operation.operationId,
          status: "EXHAUSTED",
          stopReason: stop,
        }),
      );
    }
    const turnId = safeId("ai-turn");
    const timeoutMs = boundedTimeout(segment.timeoutMs);
    const turn = this.options.persistence.reserveNextTurn({
      operationId: operation.operationId,
      segmentId: segment.segmentId,
      turnId,
      deadlineAt: addMilliseconds(this.clock.now(), timeoutMs),
    });
    const refreshed = this.options.persistence.getOperation(
      operation.operationId,
    );
    if (refreshed === undefined)
      throw new AIWorkControllerError(
        "AI_OPERATION_NOT_FOUND",
        "The F17 operation disappeared during admission.",
      );
    return this.executeOrJoin(refreshed, turn, input.autoContinue === true);
  }

  public authorizeContinuation(input: {
    readonly operationId: string;
    readonly kind: AIWorkContinuation["kind"];
    readonly selectedBudget?: number;
    readonly snapshotId?: string;
  }): AIWorkContinuation {
    const operation = this.options.persistence.getOperation(input.operationId);
    if (operation === undefined)
      throw new AIWorkControllerError(
        "AI_OPERATION_NOT_FOUND",
        "The F17 operation does not exist.",
      );
    if (input.kind === "START_NEW_OPERATION") {
      if (
        operation.remainingTurnCount > 0 ||
        operation.status === "COMPLETED" ||
        operation.status === "CANCELLED"
      ) {
        throw new AIWorkControllerError(
          "AI_CONTINUATION_NOT_ALLOWED",
          "A new parent operation is only available after the current budget is exhausted.",
        );
      }
    } else if (
      operation.status !== "NEEDS_ATTENTION" ||
      operation.remainingTurnCount <= 0
    ) {
      throw new AIWorkControllerError(
        "AI_CONTINUATION_NOT_ALLOWED",
        "Continue AI Work or Retry Resolution requires a stopped operation with remaining budget.",
      );
    }
    const selectedBudget =
      input.selectedBudget ?? Math.max(1, operation.remainingTurnCount);
    if (
      !Number.isSafeInteger(selectedBudget) ||
      selectedBudget < 1 ||
      selectedBudget > 10
    )
      throw new AIWorkControllerError(
        "AI_INVALID_BUDGET",
        "Continuation budgets must be between one and ten turns.",
      );
    const continuation: AIWorkContinuation = {
      schemaVersion: 1,
      confirmationId: safeId("ai-confirmation"),
      operationId: input.operationId,
      kind: input.kind,
      displayedHistoryRevision: operation.historyRevision,
      selectedBudget,
      confirmed: true,
      status: "PENDING",
      ...(input.snapshotId === undefined
        ? {}
        : { snapshotId: input.snapshotId }),
      createdAt: this.clock.now(),
      confirmedAt: this.clock.now(),
      version: 1,
    };
    const saved = this.options.persistence.saveContinuation(continuation);
    this.emit(
      operation.operationId,
      "AI_CONTINUATION_AUTHORIZED",
      "An explicit bounded continuation was durably recorded.",
      "INFO",
    );
    return saved;
  }

  public async continueOperation(
    input: AIWorkContinueInput,
  ): Promise<AIWorkReadModel> {
    const operation = this.options.persistence.getOperation(
      input.confirmation.operationId,
    );
    if (operation === undefined)
      throw new AIWorkControllerError(
        "AI_OPERATION_NOT_FOUND",
        "The F17 operation does not exist.",
      );
    const snapshot = input.taskSnapshot ?? operation.taskSnapshot;
    if (
      (input.taskSnapshot !== undefined &&
        input.confirmation.snapshotId !== input.taskSnapshot.snapshotId) ||
      (input.taskSnapshot === undefined &&
        input.confirmation.snapshotId !== undefined &&
        input.confirmation.snapshotId !== operation.taskSnapshot.snapshotId) ||
      !snapshotMatchesOperation(operation, snapshot)
    )
      throw new AIWorkControllerError(
        "AI_SNAPSHOT_MISMATCH",
        "The continuation snapshot is stale, mismatched, or broader than the committed F16 scope.",
      );
    const timeoutMs = boundedTimeout(
      snapshot === undefined ? undefined : lastSegment(operation).timeoutMs,
    );
    const admission = this.options.persistence.createContinuation({
      confirmation: input.confirmation,
      segmentId: safeId("ai-segment"),
      turnId: safeId("ai-turn"),
      deadlineAt: addMilliseconds(this.clock.now(), timeoutMs),
      taskSnapshot: snapshot,
    });
    return this.executeOrJoin(
      admission.operation,
      admission.turn,
      input.autoContinue === true,
    );
  }

  public async startNewOperation(
    input: AIWorkNewOperationInput,
  ): Promise<AIWorkReadModel> {
    const parsed = aiWorkOperationInputSchema.safeParse(input.operation);
    if (!parsed.success)
      throw new AIWorkControllerError(
        "AI_OPERATION_INPUT_INVALID",
        "The new F17 operation input failed its bounded contract.",
      );
    if (parsed.data.parentOperationId !== input.priorOperationId)
      throw new AIWorkControllerError(
        "AI_PARENT_OPERATION_MISMATCH",
        "The new F17 operation must link to the exhausted parent.",
      );
    if (!validateSnapshotInteraction(parsed.data))
      throw new AIWorkControllerError(
        "AI_SNAPSHOT_MISMATCH",
        "The F16 policy snapshot interaction mode does not match the new operation.",
      );
    const priorOperation = this.options.persistence.getOperation(
      input.priorOperationId,
    );
    if (priorOperation === undefined)
      throw new AIWorkControllerError(
        "AI_OPERATION_NOT_FOUND",
        "The prior F17 operation does not exist.",
      );
    if (
      input.confirmation.snapshotId !== undefined &&
      input.confirmation.snapshotId !== parsed.data.taskSnapshot.snapshotId
    )
      throw new AIWorkControllerError(
        "AI_SNAPSHOT_MISMATCH",
        "The new operation snapshot does not match the explicitly authorized F16 snapshot.",
      );
    if (
      !snapshotPolicyDoesNotBroaden(
        priorOperation.taskSnapshot.policy,
        parsed.data.taskSnapshot.policy,
      )
    )
      throw new AIWorkControllerError(
        "AI_POLICY_MISMATCH",
        "The new operation requests a broader F16 execution policy.",
      );
    if (
      this.predicates.resolve(
        parsed.data.predicate.id,
        parsed.data.predicate.version,
      ) === undefined
    )
      throw new AIWorkControllerError(
        "AI_PREDICATE_UNKNOWN",
        "The new F17 completion predicate is not registered.",
      );
    const timeoutMs = boundedTimeout(parsed.data.timeoutMs);
    const admission = this.options.persistence.createNewOperation({
      priorOperationId: input.priorOperationId,
      confirmation: input.confirmation,
      operation: {
        ...parsed.data,
        configuredTurnBudget:
          parsed.data.configuredTurnBudget ?? AI_WORK_DEFAULT_TURN_BUDGET,
        timeoutMs,
      } as AIWorkOperationInput,
      segmentId: safeId("ai-segment"),
      turnId: safeId("ai-turn"),
      deadlineAt: addMilliseconds(this.clock.now(), timeoutMs),
    });
    return this.executeOrJoin(
      admission.operation,
      admission.turn,
      input.autoContinue === true,
    );
  }

  public cancelTurn(turnId: string): boolean {
    const controller = this.activeControllers.get(turnId);
    if (controller === undefined) return false;
    controller.abort("F17_USER_CANCEL");
    return true;
  }

  public rendererClosed(): void {
    // Renderer lifecycle is intentionally not connected to the main-process
    // abort controllers.  The call is a named no-op for lifecycle adapters and
    // an explicit regression seam for the renderer-close invariant.
  }

  public async reconcileStartup(): Promise<readonly AIWorkReadModel[]> {
    const results: AIWorkReadModel[] = [];
    for (const turn of this.options.persistence.listInFlightTurns()) {
      const stop = reason(
        "AI_APP_RESTART",
        "A committed F17 turn was in flight when the application restarted.",
        "The turn is preserved as uncertain/interrupted and is not silently resumed.",
        "RECONCILE",
      );
      const reconciliation: AIWorkReconciliation = {
        schemaVersion: 1,
        reconciliationId: safeId("ai-reconcile"),
        operationId: turn.operationId,
        turnId: turn.turnId,
        outcome: "UNCERTAIN",
        reason: aiWorkReasonSchema.parse({
          schemaVersion: 1,
          code: stop.code,
          category: stop.category,
          what: stop.what,
          why: stop.why,
          nextAction: stop.nextAction,
          details: stop.details,
        }),
        evidence: { source: "startup", turnStatus: turn.status },
        createdAt: this.clock.now(),
      };
      const operation = this.options.persistence.reconcileTurn({
        reconciliation,
        status:
          turn.interactionMode === "worktree_write"
            ? "UNCERTAIN"
            : "INTERRUPTED",
        operationStatus: "NEEDS_ATTENTION",
        stopReason: stop,
      });
      this.emit(
        operation.operationId,
        "AI_RESTART_RECONCILIATION",
        "F17 preserved an in-flight turn for review after restart.",
        "WARN",
      );
      results.push(this.readModel(operation));
    }
    return results;
  }

  public async stopAdmission(): Promise<void> {
    this.stopping = true;
    for (const controller of this.activeControllers.values())
      controller.abort("F17_APP_SHUTDOWN");
  }

  public async handoff(): Promise<void> {
    await Promise.allSettled(this.activeRuns.values());
  }

  public async boundedStop(): Promise<void> {
    this.activeControllers.clear();
    this.activeRuns.clear();
  }

  private async executeOrJoin(
    operation: AIWorkOperationRecord,
    turn: AIWorkTurnIntent,
    autoContinue: boolean,
  ): Promise<AIWorkReadModel> {
    const existing = this.activeRuns.get(turn.turnId);
    if (existing !== undefined) return existing;
    const run = this.executeTurn(operation, turn, autoContinue);
    this.activeRuns.set(turn.turnId, run);
    try {
      return await run;
    } finally {
      this.activeRuns.delete(turn.turnId);
    }
  }

  private async executeTurn(
    admittedOperation: AIWorkOperationRecord,
    admittedTurn: AIWorkTurnIntent,
    autoContinue: boolean,
  ): Promise<AIWorkReadModel> {
    let operation = admittedOperation;
    let located = operationTurn(operation, admittedTurn.turnId);
    if (isAIWorkTerminalTurn(located.turn.status))
      return this.readModel(operation);
    const reservedSegment = located.segment;
    const reservedTurn = located.turn;
    let request: AIProviderRequest;
    try {
      request = aiProviderRequestSchema.parse(
        await this.options.requestFactory.create({
          operation,
          segment: reservedSegment,
          turn: reservedTurn,
        }),
      );
      if (
        request.operationId !== operation.operationId ||
        request.turnId !== reservedTurn.turnId
      )
        throw new Error("F17_REQUEST_IDENTITY_MISMATCH");
    } catch (error) {
      const released = this.options.persistence.releaseTurn({
        turnId: reservedTurn.turnId,
        completedAt: this.clock.now(),
      });
      operation =
        this.options.persistence.getOperation(released.operationId) ??
        operation;
      const report = reportForPrestart({
        operation,
        segment: operationSegment(operation, released.segmentId),
        turn: released,
        completedAt: this.clock.now(),
        code: error instanceof Error ? error.message : "AI_REQUEST_INVALID",
      });
      const finalized = this.options.persistence.finalizeTurn({
        turnId: released.turnId,
        status: "PRESTART_REFUSED",
        report,
        operationStatus: "NEEDS_ATTENTION",
        stopReason: report.terminalReason,
      });
      return this.readModel(finalized);
    }

    const startedAt = this.clock.now();
    const startedTurn = this.options.persistence.markTurnStarted({
      turnId: reservedTurn.turnId,
      startedAt,
    });
    operation =
      this.options.persistence.getOperation(startedTurn.operationId) ??
      operation;
    located = operationTurn(operation, startedTurn.turnId);
    const segment = located.segment;
    const turn = located.turn;
    this.emit(
      operation.operationId,
      "AI_TURN_STARTED",
      "F17 started one committed provider turn.",
      "INFO",
    );

    const abortController = new AbortController();
    this.activeControllers.set(turn.turnId, abortController);
    let timedOut = false;
    let uncertain = false;
    let providerResult: AIProviderTurnResult | undefined;
    const invokePromise = Promise.resolve()
      .then(() =>
        this.options.provider.invoke(request, {
          signal: abortController.signal,
          onEvent: () => undefined,
          now: this.clock.now,
        }),
      )
      .then((result) => {
        if (!aiProviderTurnResultSchema.safeParse(result).success)
          throw new AIWorkControllerError(
            "AI_PROVIDER_RESULT_INVALID",
            "F15 returned a result outside its normalized contract.",
          );
        if (!providerResultMatchesRequest(request, result))
          throw new AIWorkControllerError(
            "AI_PROVIDER_RESULT_MISMATCH",
            "F15 returned a result for a different committed F17 turn.",
          );
        return result;
      });
    try {
      providerResult = await this.invokeWithDeadline(
        invokePromise,
        turn.timeoutMs,
        () => {
          timedOut = true;
          abortController.abort("F17_TIMEOUT");
        },
      );
    } catch (error) {
      if (timedOut) {
        try {
          providerResult = await this.reconcileProviderPromise(invokePromise);
        } catch {
          providerResult = undefined;
        }
        if (providerResult === undefined) {
          uncertain = true;
          providerResult = syntheticResult(
            request,
            "interrupted",
            this.clock.now(),
            "UNCERTAIN_TERMINATION",
            "The provider did not acknowledge the bounded abort window.",
          );
        }
      } else {
        uncertain = true;
        providerResult = syntheticResult(
          request,
          "interrupted",
          this.clock.now(),
          "PROVIDER_EXCEPTION",
          error instanceof Error
            ? error.message
            : "The provider failed without a normalized result.",
        );
      }
    } finally {
      this.activeControllers.delete(turn.turnId);
    }
    if (providerResult === undefined)
      throw new AIWorkControllerError(
        "AI_PROVIDER_RESULT_MISSING",
        "F17 could not reconcile the provider result.",
      );

    if (knownPrestartRefusal(providerResult)) {
      const released = this.options.persistence.releaseTurn({
        turnId: turn.turnId,
        completedAt: this.clock.now(),
      });
      operation =
        this.options.persistence.getOperation(released.operationId) ??
        operation;
      const report = reportForPrestart({
        operation,
        segment: operationSegment(operation, released.segmentId),
        turn: released,
        completedAt: this.clock.now(),
        code: providerResult.error?.code,
      });
      const finalized = this.options.persistence.finalizeTurn({
        turnId: released.turnId,
        status: "PRESTART_REFUSED",
        report,
        operationStatus: "NEEDS_ATTENTION",
        stopReason: report.terminalReason,
      });
      return this.readModel(finalized);
    }

    const evidenceResult = await this.collectEvidence(operation, segment, turn);
    const predicate =
      this.predicates.resolve(
        operation.predicate.id,
        operation.predicate.version,
      ) ??
      invalidPredicate(operation.predicate.id, operation.predicate.version);
    const history = operation.segments
      .flatMap((candidate) => candidate.reports)
      .filter((report) => report.progress !== undefined)
      .map((report): AIProgressHistoryEntry => ({
        turnId: report.turnId,
        fingerprint: report.progress?.fingerprint ?? "unknown",
        classification: report.progress?.classification ?? "FAILED",
        complete: report.progress?.complete ?? false,
        materialProgress: report.progress?.materialProgress ?? false,
      }));
    let progress: AIProgressEvaluation | undefined;
    if (
      providerResult.status === "completed" ||
      evidenceResult.evidence.worktree.complete
    ) {
      progress = evaluateAIWorkProgress({
        operation: operation as unknown as AIWorkOperationInput,
        providerResult,
        evidence: evidenceResult.evidence,
        predicate,
        history,
        turnId: turn.turnId,
        evaluatedAt: this.clock.now(),
      });
      this.emit(
        operation.operationId,
        "AI_PROGRESS_EVALUATED",
        "F17 evaluated deterministic evidence and the registered completion predicate.",
        progress.complete ? "INFO" : "WARN",
      );
    }
    const providerStop = providerStopReason(
      providerResult,
      timedOut,
      uncertain,
      abortController.signal.reason,
    );
    const progressStop =
      progress === undefined ? undefined : progressStopReason(progress);
    const budgetStop =
      providerResult.status === "completed" &&
      progress?.complete !== true &&
      isAIWorkMutatingTurn(segment.interactionMode) &&
      operation.remainingTurnCount <= 0
        ? reason(
            "AI_TURN_BUDGET_EXHAUSTED",
            "The configured mutating-turn budget has been exhausted.",
            "F17 requires a separately confirmed new operation before more mutating work.",
            "START_NEW_OPERATION",
            { consumedTurnCount: operation.consumedTurnCount },
          )
        : undefined;
    const stopReason = providerStop ?? budgetStop ?? progressStop;
    const normalizedUsage = aiWorkNormalizeUsage(providerResult.usage);
    const report = aiWorkTurnReportSchema.parse({
      schemaVersion: 1,
      turnId: turn.turnId,
      operationId: operation.operationId,
      segmentId: segment.segmentId,
      turnNumber: turn.sequence + 1,
      objective: operation.purpose,
      startedAt: turn.startedAt ?? startedAt,
      completedAt: providerResult.completedAt,
      providerStatus: providerResult.status,
      modelClaims: aiWorkModelClaimsFromProviderResult(providerResult),
      actualChangedFiles: evidenceResult.evidence.worktree.files,
      actualCommands: evidenceResult.evidence.worktree.actualCommands,
      ...(evidenceResult.evidence.validation === undefined
        ? {}
        : { validation: evidenceResult.evidence.validation }),
      deterministicProblems: evidenceResult.evidence.deterministicProblems,
      remainingProblems:
        progress?.remainingProblems ??
        evidenceResult.evidence.deterministicProblems,
      ...(progress === undefined ? {} : { progress }),
      usage: normalizedUsage,
      ...(stopReason === undefined ? {} : { terminalReason: stopReason }),
      nextAction: this.nextActionForTurn(operation, progress, stopReason),
      evidence: evidenceResult.evidence,
    });
    const terminalStatus = this.turnStatusForProvider(
      providerResult.status,
      uncertain,
      timedOut,
      abortController.signal.reason,
    );
    const operationStatus = this.operationStatusForResult(
      operation,
      progress,
      stopReason,
      terminalStatus,
    );
    const finalized = this.options.persistence.finalizeTurn({
      turnId: turn.turnId,
      status: terminalStatus,
      report,
      operationStatus,
      ...(stopReason === undefined ? {} : { stopReason }),
    });
    this.emit(
      finalized.operationId,
      "AI_TURN_TERMINAL",
      "F17 persisted a bounded provider turn outcome and evidence.",
      stopReason === undefined ? "INFO" : "WARN",
    );
    if (stopReason !== undefined)
      this.emit(
        finalized.operationId,
        "AI_WORK_STOPPED",
        stopReason.what,
        "WARN",
      );
    if (
      autoContinue &&
      operationStatus === "WORKING" &&
      progress?.classification === "MATERIAL_PROGRESS" &&
      progress.complete === false
    )
      return this.startNextTurn({
        operationId: finalized.operationId,
        autoContinue: true,
      });
    return this.readModel(finalized);
  }

  private async collectEvidence(
    operation: AIWorkOperationRecord,
    segment: AIWorkSegmentRecord,
    turn: AIWorkTurnIntent,
  ): Promise<{ readonly evidence: AIWorkEvidenceBundle }> {
    let worktree: AIWorkWorktreeEvidence;
    const problems: string[] = [];
    try {
      const candidate = await this.options.evidence.inspectWorktree({
        operation,
        segment,
        turn,
      });
      const parsed = aiWorkWorktreeEvidenceSchema.safeParse(candidate);
      if (!parsed.success) throw new Error("F17_WORKTREE_EVIDENCE_INVALID");
      if (
        parsed.data.snapshotId !== turn.snapshotId ||
        (operation.worktree !== undefined &&
          parsed.data.worktreeId !== operation.worktree.worktreeId)
      )
        throw new Error("F17_WORKTREE_EVIDENCE_SCOPE_MISMATCH");
      worktree = {
        ...parsed.data,
        files: [...parsed.data.files].slice(0, 2_000),
        actualCommands: [...parsed.data.actualCommands].slice(0, 64),
      };
    } catch {
      worktree = emptyWorktreeEvidence({ operation, segment, turn });
      problems.push("worktree-inspection-failed");
    }
    let validation: AIWorkValidationEvidence | undefined;
    if (this.options.evidence.inspectValidation !== undefined) {
      try {
        const candidate = await this.options.evidence.inspectValidation({
          operation,
          segment,
          turn,
        });
        if (candidate === undefined) {
          validation = undefined;
        } else {
          const parsed = aiWorkValidationEvidenceSchema.safeParse(candidate);
          if (!parsed.success)
            throw new Error("F17_VALIDATION_EVIDENCE_INVALID");
          validation = parsed.data;
        }
      } catch {
        problems.push("validation-inspection-failed");
      }
    }
    return {
      evidence: evidenceBundle({
        operation,
        segment,
        turn,
        worktree,
        ...(validation === undefined ? {} : { validation }),
        deterministicProblems: problems,
      }),
    };
  }

  private async invokeWithDeadline(
    invoke: Promise<AIProviderTurnResult>,
    timeoutMs: number,
    onTimeout: () => void,
  ): Promise<AIProviderTurnResult> {
    let timeoutHandle: unknown;
    const timeout = new Promise<AIProviderTurnResult>((_, reject) => {
      timeoutHandle = (this.clock.setTimeout ?? setTimeout)(() => {
        onTimeout();
        reject(new Error("F17_TURN_TIMEOUT"));
      }, timeoutMs);
    });
    try {
      return await Promise.race([invoke, timeout]);
    } finally {
      if (timeoutHandle !== undefined) {
        if (this.clock.clearTimeout !== undefined)
          this.clock.clearTimeout(timeoutHandle);
        else clearTimeout(timeoutHandle as ReturnType<typeof setTimeout>);
      }
    }
  }

  private async reconcileProviderPromise(
    invoke: Promise<AIProviderTurnResult>,
  ): Promise<AIProviderTurnResult | undefined> {
    let timeoutHandle: unknown;
    const window = new Promise<undefined>((resolve) => {
      timeoutHandle = (this.clock.setTimeout ?? setTimeout)(
        () => resolve(undefined),
        this.reconciliationWindowMs,
      );
    });
    try {
      return await Promise.race([invoke, window]);
    } finally {
      if (timeoutHandle !== undefined) {
        if (this.clock.clearTimeout !== undefined)
          this.clock.clearTimeout(timeoutHandle);
        else clearTimeout(timeoutHandle as ReturnType<typeof setTimeout>);
      }
    }
  }

  private turnStatusForProvider(
    status: AIProviderTurnResult["status"],
    uncertain: boolean,
    timedOut: boolean,
    abortReason?: unknown,
  ): AIWorkTurnStatus {
    if (uncertain) return "UNCERTAIN";
    if (timedOut || status === "timed_out") return "TIMED_OUT";
    if (abortReason === "F17_APP_SHUTDOWN") return "INTERRUPTED";
    if (abortReason === "F17_USER_CANCEL") return "CANCELLED";
    switch (status) {
      case "cancelled":
        return "CANCELLED";
      case "interrupted":
        return "INTERRUPTED";
      case "failed":
        return "FAILED";
      case "completed":
        return "COMPLETED";
    }
  }

  private operationStatusForResult(
    operation: AIWorkOperationRecord,
    progress: AIProgressEvaluation | undefined,
    stopReason: AIWorkStopReason | undefined,
    terminalStatus: AIWorkTurnStatus,
  ): AIWorkOperationRecord["status"] {
    if (progress?.complete && terminalStatus === "COMPLETED")
      return "COMPLETED";
    if (stopReason !== undefined) {
      if (stopReason.code === "AI_TURN_BUDGET_EXHAUSTED") return "EXHAUSTED";
      return "NEEDS_ATTENTION";
    }
    if (terminalStatus !== "COMPLETED") return "NEEDS_ATTENTION";
    if (
      operation.segments.some((segment) =>
        isAIWorkMutatingTurn(segment.interactionMode),
      ) &&
      operation.remainingTurnCount <= 0
    )
      return "EXHAUSTED";
    return "WORKING";
  }

  private nextActionForTurn(
    operation: AIWorkOperationRecord,
    progress: AIProgressEvaluation | undefined,
    stopReason: AIWorkStopReason | undefined,
  ): AIWorkNextAction {
    if (progress?.complete) return "NONE";
    if (stopReason !== undefined) return stopReason.nextAction;
    if (operation.remainingTurnCount <= 0) return "START_NEW_OPERATION";
    return "RUN_NEXT_TURN";
  }

  private readModel(operation: AIWorkOperationRecord): AIWorkReadModel {
    const reports = operation.segments.flatMap((segment) => segment.reports);
    const prior =
      operation.parentOperationId === undefined
        ? undefined
        : this.options.persistence.getOperation(operation.parentOperationId);
    let permittedNextAction: AIWorkNextAction = "NONE";
    if (operation.status === "WORKING") permittedNextAction = "RUN_NEXT_TURN";
    else if (operation.status === "EXHAUSTED")
      permittedNextAction = "START_NEW_OPERATION";
    else if (operation.status === "NEEDS_ATTENTION")
      permittedNextAction = operation.stopReason?.nextAction ?? "REVIEW";
    else if (
      operation.status === "UNCERTAIN" ||
      operation.status === "INTERRUPTED"
    )
      permittedNextAction = "RECONCILE";
    const attention =
      operation.status === "NEEDS_ATTENTION" ||
      operation.status === "UNCERTAIN" ||
      operation.status === "INTERRUPTED" ||
      operation.status === "EXHAUSTED";
    return {
      schemaVersion: 1,
      operation,
      usage: operation.cumulativeUsage,
      remainingBudget: operation.remainingTurnCount,
      reports,
      ...(prior === undefined
        ? {}
        : {
            priorOperation: {
              operationId: prior.operationId,
              status: prior.status,
              consumedTurnCount: prior.consumedTurnCount,
              remainingTurnCount: prior.remainingTurnCount,
              cumulativeUsage: prior.cumulativeUsage,
              reports: prior.segments.flatMap((segment) => segment.reports),
            },
          }),
      ...(operation.stopReason === undefined
        ? {}
        : { stopReason: operation.stopReason }),
      ...(operation.worktree === undefined
        ? {}
        : { preservedWorktree: operation.worktree }),
      permittedNextAction,
      requiresExplicitConfirmation:
        attention && operation.status !== "COMPLETED",
      attention,
    };
  }

  private emit(
    operationId: string,
    reasonCode: string,
    summary: string,
    severity: "INFO" | "WARN" | "ERROR",
  ): void {
    try {
      this.options.activity?.append({
        eventId: safeId("ai-activity"),
        correlationId: operationId,
        operationId,
        severity,
        reasonCode,
        summary,
        details: { controller: "F17" },
      });
    } catch {
      // Activity is diagnostic only; durable F17 state remains authoritative.
    }
  }
}

function invalidPredicate(id: string, version: number): AIWorkPredicate {
  return {
    id,
    version,
    evaluate: () => ({
      valid: false,
      complete: false,
      materialProgress: false,
      reason: "The requested completion predicate is not registered.",
      remainingProblems: ["predicate-not-registered"],
    }),
  };
}
