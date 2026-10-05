import type { ManagedPrWork } from "../shared/managed-pr-work";
import {
  boundedIpcResponse,
  IPC_CHANNELS,
  IPC_MAX_RESPONSE_BYTES,
  parseIpcOpenTargetEvent,
  parseIpcSetupReadinessUpdatedEvent,
  parseIpcRequest,
  type CurrentState,
  type IpcError,
  type IpcOpenTargetEvent,
  type IpcInboxUpdateEvent,
  type IpcRequest,
  type IpcResponse,
  type LifecycleStatus,
} from "../shared/ipc";
import type { F28RecoveryProjection } from "../shared/f28-recovery";
import type { SetupReadiness } from "../shared/setup-readiness";
import { parseOpenTargetRecord, type OpenTarget } from "../shared/routing";
import type {
  GithubServerProfileInput,
  GithubServerProfileView,
  GithubServerSettingsView,
} from "../shared/github-server";
import type {
  ManagedPrAddInput,
  ManagedPrCloneInput,
  ManagedPrConfigurationInput,
  ManagedPrCandidateListView,
  ManagedPrOperationView,
  ManagedPrReadModel,
  ManagedPrListView,
} from "../shared/managed-pr";
import {
  isManagedPrInboxReadModel,
  type ManagedPrInboxReadModel,
} from "../shared/inbox";
import type { ManagedPrNavigationDestination } from "../shared/routing";
import type {
  F12SchedulerConfigurationInput,
  F12SchedulerControlResult,
  F12SchedulerSnapshot,
} from "../shared/control-plane";
import type {
  F16CommonInstructionDeleteInput,
  F16CommonInstructionSaveInput,
  F16CommonInstructionSelectionSaveInput,
  F16OperationalSaveInput,
  F16PolicySaveInput,
  F16PreferencesReadModel,
  F16RepositorySaveInput,
  F16TaskProfileSaveInput,
} from "../shared/f16-preferences";
import type {
  F20DecisionCommandInput,
  F20DraftCommandInput,
  F20PathActionInput,
  F20ReadDiffInput,
  F20RefreshWorktreeInput,
  F20WorkspaceReadModel,
  F20DiffView,
  F20PathActionResult,
} from "../shared/f20-workspace";
import type {
  F21ProposalEntryInput,
  F21UserIntent,
  F21ConversationReadModel,
} from "../shared/f21-conversation";
import type {
  F22ActionResult,
  F22DiscardBeginInput,
  F22DiscardConfirmInput,
  F22PreviewResult,
  F22ReevaluationBeginInput,
  F22ReevaluationConfirmInput,
} from "./f22-coordinator";
import type {
  F22DiscardPreview,
  F22ReevaluationPreview,
} from "../shared/f22-discard-reevaluation";
import type {
  F23ApprovalInput,
  F23PublicationInput,
  F23PublicationReadModel,
} from "../shared/f23-release";
import type {
  F24PreparationIntent,
  F24SelectionCommandInput,
  F24SelectionSession,
  F24SynchronizationConfirmation,
} from "../shared/f24-synchronization";
import type {
  F25SynchronizationBatchReadModel,
  F25SynchronizationResultReadModel,
} from "../shared/f25-synchronization";
import type { F26RetryAction } from "../shared/f26-conflict-resolution";
import type {
  F27ActionResult,
  F27ApprovalInput,
  F27BatchReview,
  F27FreshnessInput,
  F27PublicationInput,
  F27ReevaluationInput,
  F27ResultReview,
  F27WorktreeActionInput,
} from "../shared/f27-synchronization";
import { F16ConfigurationError } from "./f16-preferences-service";
import type { F29IpcSecurityGate } from "./f29-security-service";
import type { F30SupportDiagnosticsExportResult } from "./f30-support-diagnostics";
import { redactF29Text } from "../shared/f29-security";
import {
  isActivityEvent,
  matchesActivityQuery,
  type ActivityEventView,
  type ActivityQuery,
  type ActivityQuerySnapshot,
} from "../shared/activity";

export interface IpcSenderLike {
  readonly id: number;
  readonly isDestroyed?: () => boolean;
  send(channel: string, payload: unknown): void;
}

export interface IpcMainLike {
  handle(
    channel: string,
    listener: (
      event: { readonly sender: IpcSenderLike },
      payload: unknown,
    ) => Promise<IpcResponse>,
  ): void;
}

export interface IpcServices {
  /** F29 runs after schema/session parsing and before any feature service. */
  readonly security?: F29IpcSecurityGate;
  readonly readCurrentState: (sessionId: string) => CurrentState;
  readonly getLifecycleStatus: () => LifecycleStatus;
  readonly readRecovery?: () => F28RecoveryProjection;
  readonly readSetupReadiness?: () => Promise<SetupReadiness>;
  readonly retrySetupReadiness?: () => Promise<SetupReadiness>;
  readonly requestRecovery?: () => Promise<F28RecoveryProjection>;
  readonly exportSupportDiagnostics?: () => Promise<F30SupportDiagnosticsExportResult>;
  readonly requestShutdown: () => Promise<{
    readonly status: LifecycleStatus;
    readonly ok: boolean;
    readonly error?: IpcError;
  }>;
  readonly readScheduler?: () => F12SchedulerSnapshot;
  readonly updateSchedulerConfiguration?: (input: {
    readonly requestId: string;
    readonly configuration: F12SchedulerConfigurationInput;
    readonly expectedRevision?: number;
  }) => F12SchedulerSnapshot;
  readonly checkSchedulerNow?: (input: {
    readonly requestId: string;
    readonly managedPrId?: string;
  }) => Promise<F12SchedulerControlResult>;
  readonly pauseWatching?: (input: {
    readonly requestId: string;
    readonly expectedRevision?: number;
  }) => F12SchedulerControlResult;
  readonly resumeWatching?: (input: {
    readonly requestId: string;
    readonly expectedRevision?: number;
  }) => F12SchedulerControlResult;
  readonly readPreferences?: () => F16PreferencesReadModel;
  readonly saveTaskProfile?: (
    input: F16TaskProfileSaveInput,
  ) => F16PreferencesReadModel;
  readonly savePolicy?: (input: F16PolicySaveInput) => F16PreferencesReadModel;
  readonly saveOperationalPreferences?: (
    input: F16OperationalSaveInput,
  ) => Promise<F16PreferencesReadModel>;
  readonly saveCommonInstruction?: (
    input: F16CommonInstructionSaveInput,
  ) => F16PreferencesReadModel;
  readonly deleteCommonInstruction?: (
    input: F16CommonInstructionDeleteInput,
  ) => F16PreferencesReadModel;
  readonly saveCommonInstructionSelection?: (
    input: F16CommonInstructionSelectionSaveInput,
  ) => F16PreferencesReadModel;
  readonly saveRepositoryPreferences?: (
    input: F16RepositorySaveInput,
  ) => F16PreferencesReadModel;
  readonly readGithubSettings?: () => GithubServerSettingsView;
  readonly upsertGithubProfile?: (
    input: GithubServerProfileInput,
  ) => GithubServerProfileView | Promise<GithubServerProfileView>;
  readonly submitGithubCredential?: (input: {
    readonly serverId: string;
    readonly token: string;
    readonly operationId: string;
  }) => Promise<{
    readonly operationId: string;
    readonly profile: GithubServerProfileView;
  }>;
  readonly testGithubConnection?: (input: {
    readonly serverId: string;
    readonly operationId: string;
  }) => Promise<{
    readonly operationId: string;
    readonly profile: GithubServerProfileView;
  }>;
  readonly retryGithubOperation?: (operationId: string) => Promise<{
    readonly operationId: string;
    readonly profile: GithubServerProfileView;
  }>;
  readonly cleanupGithubOperation?: (operationId: string) => Promise<{
    readonly operationId: string;
    readonly profile: GithubServerProfileView;
  }>;
  readonly removeGithubProfile?: (input: {
    readonly serverId: string;
    readonly operationId: string;
  }) => Promise<{
    readonly operationId: string;
    readonly profile: GithubServerProfileView;
  }>;
  readonly readManagedPrs?: () => ManagedPrListView;
  readonly readManagedPr?: (
    managedPrId: string,
  ) => Promise<ManagedPrReadModel | undefined>;
  readonly addManagedPr?: (
    input: ManagedPrAddInput,
  ) => Promise<ManagedPrOperationView>;
  readonly retryManagedPrAdd?: (
    attemptId: string,
  ) => Promise<ManagedPrOperationView>;
  readonly readManagedPrCandidates?: (
    managedPrId: string,
  ) => Promise<ManagedPrCandidateListView>;
  readonly pickManagedPrFolder?: () => Promise<string | undefined>;
  readonly attachManagedPrClone?: (
    input: ManagedPrCloneInput,
  ) => Promise<ManagedPrOperationView>;
  readonly clearManagedPrClone?: (input: {
    readonly managedPrId: string;
    readonly expectedVersion: number;
  }) => Promise<ManagedPrOperationView>;
  readonly saveManagedPrConfiguration?: (
    input: ManagedPrConfigurationInput,
  ) => Promise<ManagedPrOperationView>;
  readonly readInbox?: () => ManagedPrInboxReadModel;
  readonly readSynchronizationSelection?: () => F24SelectionSession;
  readonly commandSynchronizationSelection?: (
    input: F24SelectionCommandInput,
  ) => F24SelectionSession;
  readonly resetSynchronizationSelection?: () => F24SelectionSession;
  readonly resolveSynchronization?: () => Promise<F24SynchronizationConfirmation>;
  readonly confirmSynchronizationPreparation?: (
    resolutionRevision: string,
  ) => Promise<F24PreparationIntent>;
  readonly readSynchronizationIntent?: (
    intentId: string,
  ) => F24PreparationIntent | undefined;
  readonly listSynchronizationIntents?: () => readonly F24PreparationIntent[];
  readonly reconcileSynchronizationIntent?: (
    intentId: string,
  ) => Promise<F24PreparationIntent>;
  readonly listSynchronizationBatches?: () => readonly F25SynchronizationBatchReadModel[];
  readonly readSynchronizationBatch?: (
    batchId: string,
  ) => F25SynchronizationBatchReadModel | undefined;
  readonly readSynchronizationResult?: (
    operationId: string,
  ) => F25SynchronizationResultReadModel | undefined;
  readonly retrySynchronizationConflict?: (input: {
    readonly operationId: string;
    readonly action: F26RetryAction;
    readonly expectedVersion?: number;
  }) => Promise<F25SynchronizationResultReadModel | undefined>;
  readonly cancelSynchronizationOperation?: (
    operationId: string,
  ) => Promise<boolean>;
  readonly listSynchronizationReviews?: () => readonly F27BatchReview[];
  readonly readSynchronizationReviewBatch?: (
    batchId: string,
  ) => F27BatchReview | undefined;
  readonly readSynchronizationReviewResult?: (
    operationId: string,
  ) => F27ResultReview | undefined;
  readonly refreshSynchronizationWorktree?: (
    operationId: string,
    expectedRevision?: number,
  ) => Promise<F27ResultReview>;
  readonly actOnSynchronizationWorktree?: (
    input: F27WorktreeActionInput,
  ) => Promise<F27ActionResult>;
  readonly refreshSynchronizationFreshness?: (
    input: F27FreshnessInput,
  ) => Promise<F27ResultReview>;
  readonly reevaluateSynchronization?: (
    input: F27ReevaluationInput,
  ) => Promise<F27ActionResult>;
  readonly discardSynchronizationResult?: (input: {
    readonly operationId: string;
    readonly expectedRevision: number;
  }) => F27ResultReview;
  readonly readSynchronizationPublication?: (
    operationId: string,
  ) => F27ResultReview | undefined;
  readonly approveSynchronizationPublication?: (
    input: F27ApprovalInput,
  ) => Promise<F27ResultReview>;
  readonly publishSynchronizationPublication?: (
    input: F27PublicationInput,
  ) => Promise<F27ResultReview>;
  readonly reconcileSynchronizationPublication?: (
    input: F27PublicationInput,
  ) => Promise<F27ResultReview>;
  readonly readActivity?: (query: ActivityQuery) => ActivityQuerySnapshot;
  readonly navigateActivity?: (eventId: string) => OpenTarget | undefined;
  readonly navigateManagedPr?: (
    managedPrId: string,
    destination: ManagedPrNavigationDestination,
  ) => OpenTarget;
  readonly readReviewBundle?: (bundleId: string) => F20WorkspaceReadModel;
  readonly readManagedPrWork?: (
    managedPrId: string,
    offset?: number,
  ) => ManagedPrWork;
  readonly readReviewBundlePublication?: (
    bundleId: string,
  ) => Promise<F23PublicationReadModel>;
  readonly approveReviewBundlePublication?: (
    input: F23ApprovalInput,
  ) => Promise<F23PublicationReadModel>;
  readonly publishReviewBundlePublication?: (
    input: F23PublicationInput,
  ) => Promise<F23PublicationReadModel>;
  readonly reconcileReviewBundlePublication?: (
    input: F23PublicationInput,
  ) => Promise<F23PublicationReadModel>;
  readonly retryReviewBundleResponses?: (
    input: F23PublicationInput,
  ) => Promise<F23PublicationReadModel>;
  readonly discardReviewBundlePublication?: (
    input: F23PublicationInput,
  ) => Promise<F23PublicationReadModel>;
  readonly reconcileReviewBundleF22?: (
    bundleId: string,
  ) => Promise<F20WorkspaceReadModel>;
  readonly readReviewBundleDiff?: (
    input: F20ReadDiffInput,
  ) => Promise<F20DiffView>;
  readonly recordReviewBundleDecision?: (
    input: F20DecisionCommandInput,
  ) => F20WorkspaceReadModel;
  readonly confirmReviewBundleDecisions?: (input: {
    readonly bundleId: string;
    readonly expectedVersion?: number;
    readonly actionId?: string;
  }) => Promise<F20WorkspaceReadModel>;
  readonly saveReviewBundleDraft?: (
    input: F20DraftCommandInput,
  ) => F20WorkspaceReadModel;
  readonly refreshReviewBundleWorktree?: (
    input: F20RefreshWorktreeInput,
  ) => Promise<F20WorkspaceReadModel>;
  readonly previewReviewBundleDiscard?: (
    input: F22DiscardBeginInput,
  ) => Promise<{
    readonly result: F22PreviewResult<F22DiscardPreview>;
    readonly workspace: F20WorkspaceReadModel;
  }>;
  readonly confirmReviewBundleDiscard?: (
    input: F22DiscardConfirmInput,
  ) => Promise<{
    readonly result: F22ActionResult;
    readonly workspace: F20WorkspaceReadModel;
  }>;
  readonly previewReviewBundleReevaluation?: (
    input: F22ReevaluationBeginInput,
  ) => Promise<{
    readonly result: F22PreviewResult<F22ReevaluationPreview>;
    readonly workspace: F20WorkspaceReadModel;
  }>;
  readonly confirmReviewBundleReevaluation?: (
    input: F22ReevaluationConfirmInput,
  ) => Promise<{
    readonly result: F22ActionResult;
    readonly workspace: F20WorkspaceReadModel;
  }>;
  readonly reviewBundlePathAction?: (
    input: F20PathActionInput,
  ) => Promise<F20PathActionResult>;
  readonly readReviewBundleConversation?: (
    bundleId: string,
  ) => F21ConversationReadModel;
  readonly askReviewBundleConversation?: (
    input: F21UserIntent,
  ) => Promise<F21ConversationReadModel>;
  readonly requestReviewBundleRevision?: (
    input: F21UserIntent,
  ) => Promise<F21ConversationReadModel>;
  readonly startNewReviewBundleOperation?: (
    input: F21UserIntent,
  ) => Promise<F21ConversationReadModel>;
  readonly saveReviewBundleProposalInput?: (
    input: F21ProposalEntryInput,
  ) => F21ConversationReadModel;
  readonly cancelReviewBundleConversation?: (input: {
    readonly bundleId: string;
    readonly operationId?: string;
    readonly turnId?: string;
  }) => Promise<F21ConversationReadModel>;
  readonly continueReviewBundleConversation?: (input: {
    readonly bundleId: string;
    readonly operationId: string;
    readonly selectedBudget?: number;
    readonly expectedBundleVersion?: number;
  }) => Promise<F21ConversationReadModel>;
  readonly onRendererReady?: (senderId: number, sessionId: string) => void;
}

interface RendererSession {
  readonly sessionId: string;
  readonly sender: IpcSenderLike;
}

function errorResponse(
  requestId: string,
  code: IpcError["code"],
  message: string,
): IpcResponse {
  return {
    schemaVersion: 1,
    requestId,
    ok: false,
    error: { code, message, correlationId: `ipc-${requestId}` },
  };
}

function successResponse(
  requestId: string,
  value: Extract<IpcResponse, { readonly ok: true }>["value"],
): IpcResponse {
  return { schemaVersion: 1, requestId, ok: true, value };
}

export class IpcRouter {
  private readonly sessions = new Map<number, RendererSession>();
  private readonly inboxSubscribers = new Set<number>();
  private readonly activitySubscribers = new Map<number, ActivityQuery>();
  private installed = false;

  public constructor(
    private readonly ipcMain: IpcMainLike,
    private readonly services: IpcServices,
  ) {}

  public install(): void {
    if (this.installed) return;
    this.installed = true;
    this.ipcMain.handle(IPC_CHANNELS.request, async (event, payload) =>
      this.handle(payload, event.sender),
    );
  }

  public attachRenderer(sender: IpcSenderLike): void {
    // The webContents object is kept only as a scoped reply/event target.
    // It never becomes application state or a capability supplied by the renderer.
    if (sender.isDestroyed?.()) {
      this.sessions.delete(sender.id);
      this.inboxSubscribers.delete(sender.id);
      this.activitySubscribers.delete(sender.id);
    }
  }

  public detachRenderer(senderId: number): void {
    this.sessions.delete(senderId);
    this.inboxSubscribers.delete(senderId);
    this.activitySubscribers.delete(senderId);
  }

  public async handle(
    payload: unknown,
    sender: IpcSenderLike,
  ): Promise<IpcResponse> {
    const parsed = parseIpcRequest(payload);
    if (!parsed.ok) {
      return {
        schemaVersion: 1,
        requestId: "ipc-invalid-request",
        ok: false,
        error: parsed.error,
      };
    }
    const request = parsed.value;
    try {
      if (request.type === "renderer.ready") {
        const existing = this.sessions.get(sender.id);
        if (
          existing !== undefined &&
          existing.sessionId !== request.payload.sessionId
        ) {
          return errorResponse(
            request.requestId,
            "UNAUTHORIZED",
            "The renderer session identity changed unexpectedly.",
          );
        }
        this.sessions.set(sender.id, {
          sessionId: request.payload.sessionId,
          sender,
        });
        this.services.onRendererReady?.(sender.id, request.payload.sessionId);
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "renderer-ready",
            sessionId: request.payload.sessionId,
          }),
        );
      }

      const session = this.sessions.get(sender.id);
      if (session === undefined)
        return errorResponse(
          request.requestId,
          "NOT_READY",
          "The renderer must complete its ready handshake first.",
        );
      if (session.sender !== sender || sender.isDestroyed?.()) {
        this.sessions.delete(sender.id);
        return errorResponse(
          request.requestId,
          "UNAUTHORIZED",
          "The renderer session is no longer active.",
        );
      }

      const security = this.services.security?.authorizeRequest({
        request,
        senderId: sender.id,
        sessionId: session.sessionId,
      });
      if (security !== undefined && !security.ok) {
        return boundedIpcResponse(
          errorResponse(
            request.requestId,
            security.error.code,
            security.error.message,
          ),
        );
      }

      if (request.type === "app.read-current-state") {
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "current-state",
            state: this.services.readCurrentState(session.sessionId),
          }),
        );
      }
      if (request.type === "lifecycle.status") {
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "lifecycle-status",
            status: this.services.getLifecycleStatus(),
          }),
        );
      }
      if (request.type === "setup.read" || request.type === "setup.retry") {
        const read =
          request.type === "setup.retry"
            ? this.services.retrySetupReadiness
            : this.services.readSetupReadiness;
        if (read === undefined)
          return errorResponse(
            request.requestId,
            "NOT_READY",
            "Setup readiness is unavailable.",
          );
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "setup-readiness",
            projection: await read(),
          }),
        );
      }
      if (request.type === "recovery.read") {
        if (this.services.readRecovery === undefined)
          throw new Error("PRMONITOR_RECOVERY_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "recovery",
            projection: this.services.readRecovery(),
          }),
        );
      }
      if (request.type === "recovery.request") {
        if (this.services.requestRecovery === undefined)
          throw new Error("PRMONITOR_RECOVERY_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "recovery",
            projection: await this.services.requestRecovery(),
          }),
        );
      }
      if (request.type === "support-diagnostics.export") {
        if (this.services.exportSupportDiagnostics === undefined)
          throw new Error("PRMONITOR_SUPPORT_DIAGNOSTICS_NOT_READY");
        const result = await this.services.exportSupportDiagnostics();
        if (!result.ok)
          return boundedIpcResponse(
            errorResponse(request.requestId, "HANDLER_FAILED", result.message),
          );
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "support-diagnostics",
            exported: true,
            correlationId: result.correlationId,
            fileName: result.fileName,
            bytes: result.bytes,
            digest: result.digest,
          }),
        );
      }
      if (request.type === "lifecycle.shutdown") {
        const result = await this.services.requestShutdown();
        if (!result.ok) {
          return boundedIpcResponse({
            schemaVersion: 1,
            requestId: request.requestId,
            ok: false,
            error: result.error ?? {
              code: "SHUTDOWN_IN_PROGRESS",
              message: "Shutdown requires lifecycle recovery.",
              correlationId: `ipc-${request.requestId}`,
            },
          });
        }
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "shutdown",
            status: result.status,
          }),
        );
      }
      if (request.type === "scheduler.read") {
        if (this.services.readScheduler === undefined)
          throw new Error("PRMONITOR_SCHEDULER_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "scheduler-snapshot",
            snapshot: this.services.readScheduler(),
          }),
        );
      }
      if (request.type === "scheduler.configuration.save") {
        if (this.services.updateSchedulerConfiguration === undefined)
          throw new Error("PRMONITOR_SCHEDULER_SERVICE_NOT_READY");
        const snapshot = this.services.updateSchedulerConfiguration({
          requestId: request.requestId,
          configuration: {
            ...(request.payload.intervalMs === undefined
              ? {}
              : { intervalMs: request.payload.intervalMs }),
            ...(request.payload.quietPeriodMs === undefined
              ? {}
              : { quietPeriodMs: request.payload.quietPeriodMs }),
            ...(request.payload.maxConcurrentPrs === undefined
              ? {}
              : { maxConcurrentPrs: request.payload.maxConcurrentPrs }),
            ...(request.payload.readOnlyPollWhilePaused === undefined
              ? {}
              : {
                  readOnlyPollWhilePaused:
                    request.payload.readOnlyPollWhilePaused,
                }),
          },
          ...(request.payload.expectedRevision === undefined
            ? {}
            : { expectedRevision: request.payload.expectedRevision }),
        });
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "scheduler-snapshot",
            snapshot,
          }),
        );
      }
      if (request.type === "scheduler.check-now") {
        if (this.services.checkSchedulerNow === undefined)
          throw new Error("PRMONITOR_SCHEDULER_SERVICE_NOT_READY");
        const operation = await this.services.checkSchedulerNow({
          requestId: request.requestId,
          ...(request.payload.managedPrId === undefined
            ? {}
            : { managedPrId: request.payload.managedPrId }),
        });
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "scheduler-operation",
            operation,
          }),
        );
      }
      if (
        request.type === "scheduler.pause" ||
        request.type === "scheduler.resume"
      ) {
        const handler =
          request.type === "scheduler.pause"
            ? this.services.pauseWatching
            : this.services.resumeWatching;
        if (handler === undefined)
          throw new Error("PRMONITOR_SCHEDULER_SERVICE_NOT_READY");
        const operation = handler({
          requestId: request.requestId,
          ...(request.payload.expectedRevision === undefined
            ? {}
            : { expectedRevision: request.payload.expectedRevision }),
        });
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "scheduler-operation",
            operation,
          }),
        );
      }
      if (request.type === "preferences.read") {
        if (this.services.readPreferences === undefined)
          throw new Error("PRMONITOR_PREFERENCES_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "preferences",
            preferences: this.services.readPreferences(),
          }),
        );
      }
      if (request.type === "preferences.task-profile.save") {
        if (this.services.saveTaskProfile === undefined)
          throw new Error("PRMONITOR_PREFERENCES_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "preferences",
            preferences: this.services.saveTaskProfile(request.payload),
          }),
        );
      }
      if (request.type === "preferences.policy.save") {
        if (this.services.savePolicy === undefined)
          throw new Error("PRMONITOR_PREFERENCES_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "preferences",
            preferences: this.services.savePolicy(request.payload),
          }),
        );
      }
      if (request.type === "preferences.operational.save") {
        if (this.services.saveOperationalPreferences === undefined)
          throw new Error("PRMONITOR_PREFERENCES_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "preferences",
            preferences: await this.services.saveOperationalPreferences(
              request.payload,
            ),
          }),
        );
      }
      if (request.type === "preferences.common-instruction.save") {
        if (this.services.saveCommonInstruction === undefined)
          throw new Error("PRMONITOR_PREFERENCES_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "preferences",
            preferences: this.services.saveCommonInstruction(request.payload),
          }),
        );
      }
      if (request.type === "preferences.common-instruction.delete") {
        if (this.services.deleteCommonInstruction === undefined)
          throw new Error("PRMONITOR_PREFERENCES_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "preferences",
            preferences: this.services.deleteCommonInstruction(request.payload),
          }),
        );
      }
      if (request.type === "preferences.common-instruction.selection.save") {
        if (this.services.saveCommonInstructionSelection === undefined)
          throw new Error("PRMONITOR_PREFERENCES_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "preferences",
            preferences: this.services.saveCommonInstructionSelection(
              request.payload,
            ),
          }),
        );
      }
      if (request.type === "preferences.repository.save") {
        if (this.services.saveRepositoryPreferences === undefined)
          throw new Error("PRMONITOR_PREFERENCES_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "preferences",
            preferences: this.services.saveRepositoryPreferences(
              request.payload,
            ),
          }),
        );
      }
      if (request.type === "github.settings.read") {
        if (this.services.readGithubSettings === undefined)
          throw new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "github-settings",
            settings: this.services.readGithubSettings(),
          }),
        );
      }
      if (request.type === "github.profile.upsert") {
        if (this.services.upsertGithubProfile === undefined)
          throw new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY");
        const profile = await this.services.upsertGithubProfile(
          request.payload,
        );
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "github-profile",
            profile,
          }),
        );
      }
      if (request.type === "github.credential.submit") {
        if (this.services.submitGithubCredential === undefined)
          throw new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY");
        const result = await this.services.submitGithubCredential({
          serverId: request.payload.serverId,
          token: request.payload.token,
          operationId: request.requestId,
        });
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "github-operation",
            operationId: result.operationId,
            profile: result.profile,
          }),
        );
      }
      if (request.type === "github.connection.test") {
        if (this.services.testGithubConnection === undefined)
          throw new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY");
        const result = await this.services.testGithubConnection({
          serverId: request.payload.serverId,
          operationId: request.requestId,
        });
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "github-operation",
            operationId: result.operationId,
            profile: result.profile,
          }),
        );
      }
      if (request.type === "github.operation.retry") {
        if (this.services.retryGithubOperation === undefined)
          throw new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY");
        const result = await this.services.retryGithubOperation(
          request.payload.operationId,
        );
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "github-operation",
            operationId: result.operationId,
            profile: result.profile,
          }),
        );
      }
      if (request.type === "github.operation.cleanup") {
        if (this.services.cleanupGithubOperation === undefined)
          throw new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY");
        const result = await this.services.cleanupGithubOperation(
          request.payload.operationId,
        );
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "github-operation",
            operationId: result.operationId,
            profile: result.profile,
          }),
        );
      }
      if (request.type === "github.profile.remove") {
        if (this.services.removeGithubProfile === undefined)
          throw new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY");
        const result = await this.services.removeGithubProfile({
          serverId: request.payload.serverId,
          operationId: request.requestId,
        });
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "github-operation",
            operationId: result.operationId,
            profile: result.profile,
          }),
        );
      }
      if (request.type === "managed-pr.list") {
        if (this.services.readManagedPrs === undefined)
          throw new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "managed-pr-list",
            value: this.services.readManagedPrs(),
          }),
        );
      }
      if (request.type === "inbox.read" || request.type === "inbox.subscribe") {
        if (this.services.readInbox === undefined)
          throw new Error("PRMONITOR_INBOX_SERVICE_NOT_READY");
        const snapshot = this.services.readInbox();
        if (request.type === "inbox.subscribe")
          this.inboxSubscribers.add(sender.id);
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "managed-pr-inbox",
            snapshot,
          }),
        );
      }
      if (
        request.type === "synchronization.selection.read" ||
        request.type === "synchronization.selection.reset"
      ) {
        const read =
          request.type === "synchronization.selection.read"
            ? this.services.readSynchronizationSelection
            : this.services.resetSynchronizationSelection;
        if (read === undefined)
          throw new Error("PRMONITOR_F24_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "synchronization-selection",
            selection: read(),
          }),
        );
      }
      if (request.type === "synchronization.selection.command") {
        if (this.services.commandSynchronizationSelection === undefined)
          throw new Error("PRMONITOR_F24_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "synchronization-selection",
            selection: this.services.commandSynchronizationSelection(
              request.payload,
            ),
          }),
        );
      }
      if (request.type === "synchronization.resolve") {
        if (this.services.resolveSynchronization === undefined)
          throw new Error("PRMONITOR_F24_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "synchronization-confirmation",
            confirmation: await this.services.resolveSynchronization(),
          }),
        );
      }
      if (request.type === "synchronization.confirm") {
        if (this.services.confirmSynchronizationPreparation === undefined)
          throw new Error("PRMONITOR_F24_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "synchronization-intent",
            intent: await this.services.confirmSynchronizationPreparation(
              request.payload.resolutionRevision,
            ),
          }),
        );
      }
      if (request.type === "synchronization.intent.list") {
        if (this.services.listSynchronizationIntents === undefined)
          throw new Error("PRMONITOR_F24_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "synchronization-intents",
            intents: this.services.listSynchronizationIntents(),
          }),
        );
      }
      if (request.type === "synchronization.batch.list") {
        if (this.services.listSynchronizationBatches === undefined)
          throw new Error("PRMONITOR_F25_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "synchronization-batches",
            batches: this.services.listSynchronizationBatches(),
          }),
        );
      }
      if (request.type === "synchronization.batch.read") {
        if (this.services.readSynchronizationBatch === undefined)
          throw new Error("PRMONITOR_F25_SERVICE_NOT_READY");
        const batch = this.services.readSynchronizationBatch(
          request.payload.batchId,
        );
        if (batch === undefined)
          return errorResponse(
            request.requestId,
            "HANDLER_FAILED",
            "The synchronization batch is not available.",
          );
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "synchronization-batch",
            batch,
          }),
        );
      }
      if (request.type === "synchronization.result.read") {
        if (this.services.readSynchronizationResult === undefined)
          throw new Error("PRMONITOR_F25_SERVICE_NOT_READY");
        const result = this.services.readSynchronizationResult(
          request.payload.operationId,
        );
        if (result === undefined)
          return errorResponse(
            request.requestId,
            "HANDLER_FAILED",
            "The synchronization result is not available.",
          );
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "synchronization-result",
            result,
          }),
        );
      }
      if (request.type === "synchronization.conflict.retry") {
        if (this.services.retrySynchronizationConflict === undefined)
          throw new Error("PRMONITOR_F25_SERVICE_NOT_READY");
        const result = await this.services.retrySynchronizationConflict({
          operationId: request.payload.operationId,
          action: request.payload.action,
          ...(request.payload.expectedVersion === undefined
            ? {}
            : { expectedVersion: request.payload.expectedVersion }),
        });
        if (result === undefined)
          return errorResponse(
            request.requestId,
            "HANDLER_FAILED",
            "The synchronization conflict cannot be retried from its current durable state.",
          );
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "synchronization-result",
            result,
          }),
        );
      }
      if (request.type === "synchronization.operation.cancel") {
        if (this.services.cancelSynchronizationOperation === undefined)
          throw new Error("PRMONITOR_F25_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "synchronization-operation-cancelled",
            cancelled: await this.services.cancelSynchronizationOperation(
              request.payload.operationId,
            ),
          }),
        );
      }
      if (request.type === "synchronization.review.batch.list") {
        if (this.services.listSynchronizationReviews === undefined)
          throw new Error("PRMONITOR_F27_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "synchronization-review-batches",
            batches: this.services.listSynchronizationReviews(),
          }),
        );
      }
      if (request.type === "synchronization.review.batch.read") {
        if (this.services.readSynchronizationReviewBatch === undefined)
          throw new Error("PRMONITOR_F27_SERVICE_NOT_READY");
        const batch = this.services.readSynchronizationReviewBatch(
          request.payload.batchId,
        );
        if (batch === undefined)
          return errorResponse(
            request.requestId,
            "HANDLER_FAILED",
            "The synchronization review batch is not available.",
          );
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "synchronization-review-batch",
            batch,
          }),
        );
      }
      if (
        request.type === "synchronization.review.result.read" ||
        request.type === "synchronization.review.publication.read"
      ) {
        const read =
          request.type === "synchronization.review.result.read"
            ? this.services.readSynchronizationReviewResult
            : this.services.readSynchronizationPublication;
        if (read === undefined)
          throw new Error("PRMONITOR_F27_SERVICE_NOT_READY");
        const result = read(request.payload.operationId);
        if (result === undefined)
          return errorResponse(
            request.requestId,
            "HANDLER_FAILED",
            "The synchronization review result is not available.",
          );
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind:
              request.type === "synchronization.review.result.read"
                ? "synchronization-review-result"
                : "synchronization-review-publication",
            result,
          }),
        );
      }
      if (request.type === "synchronization.review.worktree.refresh") {
        if (this.services.refreshSynchronizationWorktree === undefined)
          throw new Error("PRMONITOR_F27_SERVICE_NOT_READY");
        const result = await this.services.refreshSynchronizationWorktree(
          request.payload.operationId,
          request.payload.expectedRevision,
        );
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "synchronization-review-result",
            result,
          }),
        );
      }
      if (request.type === "synchronization.review.worktree.action") {
        if (this.services.actOnSynchronizationWorktree === undefined)
          throw new Error("PRMONITOR_F27_SERVICE_NOT_READY");
        const result = await this.services.actOnSynchronizationWorktree(
          request.payload,
        );
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "synchronization-review-action",
            outcome: result.outcome,
            result: result.review,
          }),
        );
      }
      if (request.type === "synchronization.review.freshness.refresh") {
        if (this.services.refreshSynchronizationFreshness === undefined)
          throw new Error("PRMONITOR_F27_SERVICE_NOT_READY");
        const result = await this.services.refreshSynchronizationFreshness(
          request.payload,
        );
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "synchronization-review-result",
            result,
          }),
        );
      }
      if (request.type === "synchronization.review.reevaluate") {
        if (this.services.reevaluateSynchronization === undefined)
          throw new Error("PRMONITOR_F27_SERVICE_NOT_READY");
        const result = await this.services.reevaluateSynchronization(
          request.payload,
        );
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "synchronization-review-action",
            outcome: result.outcome,
            result: result.review,
          }),
        );
      }
      if (request.type === "synchronization.review.discard") {
        if (this.services.discardSynchronizationResult === undefined)
          throw new Error("PRMONITOR_F27_SERVICE_NOT_READY");
        const result = this.services.discardSynchronizationResult(
          request.payload,
        );
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "synchronization-review-action",
            outcome: "COMPLETED",
            result,
          }),
        );
      }
      if (request.type === "synchronization.review.publication.approve") {
        if (this.services.approveSynchronizationPublication === undefined)
          throw new Error("PRMONITOR_F27_SERVICE_NOT_READY");
        const result = await this.services.approveSynchronizationPublication(
          request.payload,
        );
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "synchronization-review-publication",
            result,
          }),
        );
      }
      if (
        request.type === "synchronization.review.publication.publish" ||
        request.type === "synchronization.review.publication.reconcile"
      ) {
        const publish =
          request.type === "synchronization.review.publication.publish"
            ? this.services.publishSynchronizationPublication
            : this.services.reconcileSynchronizationPublication;
        if (publish === undefined)
          throw new Error("PRMONITOR_F27_SERVICE_NOT_READY");
        const result = await publish(request.payload);
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "synchronization-review-publication",
            result,
          }),
        );
      }
      if (
        request.type === "synchronization.intent.read" ||
        request.type === "synchronization.intent.reconcile"
      ) {
        if (request.type === "synchronization.intent.read") {
          if (this.services.readSynchronizationIntent === undefined)
            throw new Error("PRMONITOR_F24_SERVICE_NOT_READY");
          const intent = this.services.readSynchronizationIntent(
            request.payload.intentId,
          );
          if (intent === undefined)
            return errorResponse(
              request.requestId,
              "HANDLER_FAILED",
              "The synchronization preparation intent is not available.",
            );
          return boundedIpcResponse(
            successResponse(request.requestId, {
              kind: "synchronization-intent",
              intent,
            }),
          );
        }
        if (this.services.reconcileSynchronizationIntent === undefined)
          throw new Error("PRMONITOR_F24_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "synchronization-intent",
            intent: await this.services.reconcileSynchronizationIntent(
              request.payload.intentId,
            ),
          }),
        );
      }
      if (request.type === "inbox.navigate") {
        if (this.services.navigateManagedPr === undefined)
          throw new Error("PRMONITOR_INBOX_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "navigation-target",
            target: this.services.navigateManagedPr(
              request.payload.managedPrId,
              request.payload.destination,
            ),
          }),
        );
      }
      if (
        request.type === "activity.query" ||
        request.type === "activity.subscribe"
      ) {
        if (this.services.readActivity === undefined)
          throw new Error("PRMONITOR_ACTIVITY_SERVICE_NOT_READY");
        const snapshot = await this.services.readActivity(request.payload);
        if (request.type === "activity.subscribe")
          this.activitySubscribers.set(sender.id, request.payload);
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "activity-query",
            snapshot,
          }),
        );
      }
      if (request.type === "activity.navigate") {
        if (this.services.navigateActivity === undefined)
          throw new Error("PRMONITOR_ACTIVITY_SERVICE_NOT_READY");
        const target = this.services.navigateActivity(request.payload.eventId);
        if (target === undefined)
          return errorResponse(
            request.requestId,
            "HANDLER_FAILED",
            "The related activity target is no longer available.",
          );
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "activity-navigation",
            target,
          }),
        );
      }
      if (request.type === "managed-pr.read") {
        if (this.services.readManagedPr === undefined)
          throw new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "managed-pr-details",
            managedPr:
              (await this.services.readManagedPr(
                request.payload.managedPrId,
              )) ?? null,
          }),
        );
      }
      if (request.type === "managed-pr.add") {
        if (this.services.addManagedPr === undefined)
          throw new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "managed-pr-operation",
            operation: await this.services.addManagedPr(request.payload),
          }),
        );
      }
      if (request.type === "managed-pr.retry") {
        if (this.services.retryManagedPrAdd === undefined)
          throw new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "managed-pr-operation",
            operation: await this.services.retryManagedPrAdd(
              request.payload.attemptId,
            ),
          }),
        );
      }
      if (request.type === "managed-pr.candidates") {
        if (this.services.readManagedPrCandidates === undefined)
          throw new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "managed-pr-candidates",
            value: await this.services.readManagedPrCandidates(
              request.payload.managedPrId,
            ),
          }),
        );
      }
      if (request.type === "managed-pr.clone.pick") {
        if (this.services.pickManagedPrFolder === undefined)
          throw new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY");
        const selected = await this.services.pickManagedPrFolder();
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "managed-pr-folder",
            ...(selected === undefined ? {} : { path: selected }),
          }),
        );
      }
      if (request.type === "managed-pr.clone.attach") {
        if (this.services.attachManagedPrClone === undefined)
          throw new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "managed-pr-operation",
            operation: await this.services.attachManagedPrClone(
              request.payload,
            ),
          }),
        );
      }
      if (request.type === "managed-pr.clone.clear") {
        if (this.services.clearManagedPrClone === undefined)
          throw new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "managed-pr-operation",
            operation: await this.services.clearManagedPrClone(request.payload),
          }),
        );
      }
      if (request.type === "managed-pr.configuration.save") {
        if (this.services.saveManagedPrConfiguration === undefined)
          throw new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "managed-pr-operation",
            operation: await this.services.saveManagedPrConfiguration(
              request.payload,
            ),
          }),
        );
      }
      if (request.type === "managed-pr.work.read") {
        if (this.services.readManagedPrWork === undefined)
          throw Error("SAVED_WORK_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "managed-pr-work",
            work: this.services.readManagedPrWork(
              request.payload.managedPrId,
              request.payload.offset,
            ),
          }),
        );
      }
      if (request.type === "review-bundle.read") {
        if (this.services.readReviewBundle === undefined)
          throw new Error("PRMONITOR_F20_WORKSPACE_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "review-bundle-workspace",
            workspace: this.services.readReviewBundle(request.payload.bundleId),
          }),
        );
      }
      if (request.type === "review-bundle.publication.read") {
        if (this.services.readReviewBundlePublication === undefined)
          throw new Error("PRMONITOR_F23_PUBLICATION_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "review-bundle-publication",
            publication: await this.services.readReviewBundlePublication(
              request.payload.bundleId,
            ),
          }),
        );
      }
      if (request.type === "review-bundle.publication.approve") {
        if (this.services.approveReviewBundlePublication === undefined)
          throw new Error("PRMONITOR_F23_PUBLICATION_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "review-bundle-publication",
            publication: await this.services.approveReviewBundlePublication(
              request.payload,
            ),
          }),
        );
      }
      if (
        request.type === "review-bundle.publication.publish" ||
        request.type === "review-bundle.publication.reconcile" ||
        request.type === "review-bundle.publication.retry-responses" ||
        request.type === "review-bundle.publication.discard"
      ) {
        const handler =
          request.type === "review-bundle.publication.publish"
            ? this.services.publishReviewBundlePublication
            : request.type === "review-bundle.publication.reconcile"
              ? this.services.reconcileReviewBundlePublication
              : request.type === "review-bundle.publication.retry-responses"
                ? this.services.retryReviewBundleResponses
                : this.services.discardReviewBundlePublication;
        if (handler === undefined)
          throw new Error("PRMONITOR_F23_PUBLICATION_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "review-bundle-publication",
            publication: await handler(request.payload),
          }),
        );
      }
      if (request.type === "review-bundle.f22.reconcile") {
        if (this.services.reconcileReviewBundleF22 === undefined)
          throw new Error("PRMONITOR_F22_COORDINATOR_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "review-bundle-workspace",
            workspace: await this.services.reconcileReviewBundleF22(
              request.payload.bundleId,
            ),
          }),
        );
      }
      if (request.type === "review-bundle.diff.read") {
        if (this.services.readReviewBundleDiff === undefined)
          throw new Error("PRMONITOR_F20_WORKSPACE_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "review-bundle-diff",
            diff: await this.services.readReviewBundleDiff(request.payload),
          }),
        );
      }
      if (request.type === "review-bundle.decision.record") {
        if (this.services.recordReviewBundleDecision === undefined)
          throw new Error("PRMONITOR_F20_WORKSPACE_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "review-bundle-workspace",
            workspace: this.services.recordReviewBundleDecision(
              request.payload,
            ),
          }),
        );
      }
      if (request.type === "review-bundle.decisions.confirm") {
        if (this.services.confirmReviewBundleDecisions === undefined)
          throw new Error("PRMONITOR_F20_WORKSPACE_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "review-bundle-workspace",
            workspace: await this.services.confirmReviewBundleDecisions(
              request.payload,
            ),
          }),
        );
      }
      if (request.type === "review-bundle.draft.save") {
        if (this.services.saveReviewBundleDraft === undefined)
          throw new Error("PRMONITOR_F20_WORKSPACE_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "review-bundle-workspace",
            workspace: this.services.saveReviewBundleDraft(request.payload),
          }),
        );
      }
      if (request.type === "review-bundle.worktree.refresh") {
        if (this.services.refreshReviewBundleWorktree === undefined)
          throw new Error("PRMONITOR_F20_WORKSPACE_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "review-bundle-workspace",
            workspace: await this.services.refreshReviewBundleWorktree(
              request.payload,
            ),
          }),
        );
      }
      if (request.type === "review-bundle.discard.preview") {
        if (this.services.previewReviewBundleDiscard === undefined)
          throw new Error("PRMONITOR_F22_COORDINATOR_NOT_READY");
        const response = await this.services.previewReviewBundleDiscard(
          request.payload,
        );
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "review-bundle-f22",
            workspace: response.workspace,
            gate: response.result.gate,
            outcome: response.result.outcome,
            ...(response.result.actionId === undefined
              ? {}
              : { actionId: response.result.actionId }),
            ...(response.result.preview === undefined
              ? {}
              : { preview: response.result.preview }),
            ...(response.result.reason === undefined
              ? {}
              : { reason: response.result.reason }),
          }),
        );
      }
      if (request.type === "review-bundle.discard.confirm") {
        if (this.services.confirmReviewBundleDiscard === undefined)
          throw new Error("PRMONITOR_F22_COORDINATOR_NOT_READY");
        const response = await this.services.confirmReviewBundleDiscard(
          request.payload,
        );
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "review-bundle-f22",
            workspace: response.workspace,
            gate: response.result.gate,
            outcome: response.result.outcome,
            ...(response.result.actionId === undefined
              ? {}
              : { actionId: response.result.actionId }),
            ...(response.result.newBundleId === undefined
              ? {}
              : { newBundleId: response.result.newBundleId }),
            ...(response.result.reason === undefined
              ? {}
              : { reason: response.result.reason }),
          }),
        );
      }
      if (request.type === "review-bundle.reevaluate.preview") {
        if (this.services.previewReviewBundleReevaluation === undefined)
          throw new Error("PRMONITOR_F22_COORDINATOR_NOT_READY");
        const response = await this.services.previewReviewBundleReevaluation(
          request.payload,
        );
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "review-bundle-f22",
            workspace: response.workspace,
            gate: response.result.gate,
            outcome: response.result.outcome,
            ...(response.result.actionId === undefined
              ? {}
              : { actionId: response.result.actionId }),
            ...(response.result.preview === undefined
              ? {}
              : { preview: response.result.preview }),
            ...(response.result.reason === undefined
              ? {}
              : { reason: response.result.reason }),
          }),
        );
      }
      if (request.type === "review-bundle.reevaluate.confirm") {
        if (this.services.confirmReviewBundleReevaluation === undefined)
          throw new Error("PRMONITOR_F22_COORDINATOR_NOT_READY");
        const response = await this.services.confirmReviewBundleReevaluation(
          request.payload,
        );
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "review-bundle-f22",
            workspace: response.workspace,
            gate: response.result.gate,
            outcome: response.result.outcome,
            ...(response.result.actionId === undefined
              ? {}
              : { actionId: response.result.actionId }),
            ...(response.result.newBundleId === undefined
              ? {}
              : { newBundleId: response.result.newBundleId }),
            ...(response.result.reason === undefined
              ? {}
              : { reason: response.result.reason }),
          }),
        );
      }
      if (request.type === "review-bundle.path-action") {
        if (this.services.reviewBundlePathAction === undefined)
          throw new Error("PRMONITOR_F20_WORKSPACE_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "review-bundle-path-action",
            result: await this.services.reviewBundlePathAction(request.payload),
          }),
        );
      }
      if (request.type === "review-bundle.conversation.read") {
        if (this.services.readReviewBundleConversation === undefined)
          throw new Error("PRMONITOR_F21_CONVERSATION_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "review-bundle-conversation",
            conversation: this.services.readReviewBundleConversation(
              request.payload.bundleId,
            ),
          }),
        );
      }
      if (request.type === "review-bundle.conversation.ask") {
        if (this.services.askReviewBundleConversation === undefined)
          throw new Error("PRMONITOR_F21_CONVERSATION_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "review-bundle-conversation",
            conversation: await this.services.askReviewBundleConversation(
              request.payload,
            ),
          }),
        );
      }
      if (request.type === "review-bundle.revision.request") {
        if (this.services.requestReviewBundleRevision === undefined)
          throw new Error("PRMONITOR_F21_CONVERSATION_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "review-bundle-conversation",
            conversation: await this.services.requestReviewBundleRevision(
              request.payload,
            ),
          }),
        );
      }
      if (request.type === "review-bundle.conversation.start-new-operation") {
        if (this.services.startNewReviewBundleOperation === undefined)
          throw new Error("PRMONITOR_F21_CONVERSATION_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "review-bundle-conversation",
            conversation: await this.services.startNewReviewBundleOperation(
              request.payload,
            ),
          }),
        );
      }
      if (request.type === "review-bundle.proposal-input.save") {
        if (this.services.saveReviewBundleProposalInput === undefined)
          throw new Error("PRMONITOR_F21_CONVERSATION_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "review-bundle-conversation",
            conversation: this.services.saveReviewBundleProposalInput(
              request.payload,
            ),
          }),
        );
      }
      if (request.type === "review-bundle.conversation.cancel") {
        if (this.services.cancelReviewBundleConversation === undefined)
          throw new Error("PRMONITOR_F21_CONVERSATION_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "review-bundle-conversation",
            conversation: await this.services.cancelReviewBundleConversation(
              request.payload,
            ),
          }),
        );
      }
      if (request.type === "review-bundle.conversation.continue") {
        if (this.services.continueReviewBundleConversation === undefined)
          throw new Error("PRMONITOR_F21_CONVERSATION_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "review-bundle-conversation",
            conversation: await this.services.continueReviewBundleConversation(
              request.payload,
            ),
          }),
        );
      }
      return errorResponse(
        "ipc-unknown",
        "UNKNOWN_CHANNEL",
        "The IPC request type is not allowlisted.",
      );
    } catch (error) {
      if (error instanceof F16ConfigurationError) {
        const detail =
          error.fieldPath === undefined ? "" : ` (${error.fieldPath})`;
        return errorResponse(
          request.requestId,
          "CONFIGURATION_ERROR",
          `${error.message}${detail} Next action: ${error.userAction}`,
        );
      }
      const candidateMessage =
        error instanceof Error && error.message.length <= 512
          ? error.message
          : "The main-process handler failed safely.";
      const redactedMessage = redactF29Text(candidateMessage, {
        maximumBytes: 1_024,
      });
      const safeMessage = redactedMessage.ok
        ? redactedMessage.text
        : "The main-process handler failed safely.";
      return errorResponse(request.requestId, "HANDLER_FAILED", safeMessage);
    }
  }

  public deliverOpenTarget(senderId: number, target: OpenTarget): boolean {
    const session = this.sessions.get(senderId);
    const parsedTarget = parseOpenTargetRecord(target);
    if (
      session === undefined ||
      !parsedTarget.ok ||
      session.sender.isDestroyed?.()
    )
      return false;
    const event: IpcOpenTargetEvent = {
      schemaVersion: 1,
      type: "open-target",
      target: parsedTarget.value,
    };
    if (!parseIpcOpenTargetEvent(event)) return false;
    try {
      session.sender.send(IPC_CHANNELS.event, event);
      return true;
    } catch {
      this.sessions.delete(senderId);
      return false;
    }
  }

  public hasSession(senderId: number): boolean {
    return this.sessions.has(senderId);
  }

  public publishSetupReadiness(projection: SetupReadiness): number {
    const event = {
      schemaVersion: 1 as const,
      type: "setup-readiness-updated" as const,
      projection,
    };
    if (!parseIpcSetupReadinessUpdatedEvent(event)) return 0;
    if (
      new TextEncoder().encode(JSON.stringify(event)).byteLength >
      IPC_MAX_RESPONSE_BYTES
    )
      return 0;
    let delivered = 0;
    for (const [senderId, session] of this.sessions) {
      if (session.sender.isDestroyed?.()) continue;
      try {
        session.sender.send(IPC_CHANNELS.event, event);
        delivered += 1;
      } catch {
        this.sessions.delete(senderId);
      }
    }
    return delivered;
  }

  public publishInbox(snapshot: ManagedPrInboxReadModel): number {
    if (!isManagedPrInboxReadModel(snapshot)) return 0;
    let delivered = 0;
    const event: IpcInboxUpdateEvent = {
      schemaVersion: 1,
      type: "inbox-update",
      snapshot,
    };
    try {
      if (
        new TextEncoder().encode(JSON.stringify(event)).byteLength >
        IPC_MAX_RESPONSE_BYTES
      )
        return 0;
    } catch {
      return 0;
    }
    for (const senderId of this.inboxSubscribers) {
      const session = this.sessions.get(senderId);
      if (session === undefined || session.sender.isDestroyed?.()) {
        this.inboxSubscribers.delete(senderId);
        this.activitySubscribers.delete(senderId);
        continue;
      }
      try {
        session.sender.send(IPC_CHANNELS.event, event);
        delivered += 1;
      } catch {
        this.sessions.delete(senderId);
        this.inboxSubscribers.delete(senderId);
      }
    }
    return delivered;
  }

  public publishActivity(event: ActivityEventView): number {
    if (!isActivityEvent(event)) return 0;
    const envelope = {
      schemaVersion: 1 as const,
      type: "activity-update" as const,
      event,
    };
    try {
      if (
        new TextEncoder().encode(JSON.stringify(envelope)).byteLength >
        IPC_MAX_RESPONSE_BYTES
      )
        return 0;
    } catch {
      return 0;
    }
    let delivered = 0;
    for (const [senderId, query] of this.activitySubscribers) {
      const session = this.sessions.get(senderId);
      if (session === undefined || session.sender.isDestroyed?.()) {
        this.activitySubscribers.delete(senderId);
        continue;
      }
      if (!matchesActivityQuery(event, query)) continue;
      try {
        session.sender.send(IPC_CHANNELS.event, envelope);
        delivered += 1;
      } catch {
        this.sessions.delete(senderId);
        this.activitySubscribers.delete(senderId);
      }
    }
    return delivered;
  }
}

export type IpcRequestHandler = (
  request: IpcRequest,
  sender: IpcSenderLike,
) => Promise<IpcResponse>;
