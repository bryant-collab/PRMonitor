import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  parseIpcActivityUpdateEvent,
  type IpcRequestType,
  parseIpcInboxUpdateEvent,
  parseIpcOpenTargetEvent,
  type F23ApprovalInput,
  type F23PublicationInput,
  type IpcResponse,
  type PrMonitorPreloadApi,
} from "../shared/ipc";
import type { ActivityEventView, ActivityQuery } from "../shared/activity";
import type { F12SchedulerConfigurationInput } from "../shared/control-plane";
import type { GithubServerProfileInput } from "../shared/github-server";
import type {
  ManagedPrAddInput,
  ManagedPrCloneInput,
  ManagedPrConfigurationInput,
} from "../shared/managed-pr";
import type {
  F16CommonInstructionDeleteInput,
  F16CommonInstructionSaveInput,
  F16CommonInstructionSelectionSaveInput,
  F16OperationalSaveInput,
  F16PolicySaveInput,
  F16RepositorySaveInput,
  F16TaskProfileSaveInput,
} from "../shared/f16-preferences";
import type {
  F20DecisionCommandInput,
  F20DiffMode,
  F20DraftCommandInput,
  F20PathActionInput,
} from "../shared/f20-workspace";
import type {
  F21ProposalEntryInput,
  F21UserIntent,
} from "../shared/f21-conversation";
import type { F24SelectionCommandInput } from "../shared/f24-synchronization";
import type { F26RetryAction } from "../shared/f26-conflict-resolution";
import type {
  F27ApprovalInput,
  F27FreshnessInput,
  F27PublicationInput,
  F27ReevaluationInput,
  F27WorktreeActionInput,
} from "../shared/f27-synchronization";
let requestSequence = 0;
const sessionId = `renderer-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;

function requestId(): string {
  requestSequence += 1;
  return `request-${requestSequence}`;
}

function invoke(
  type: IpcRequestType,
  payload:
    | Record<string, never>
    | { readonly sessionId: string }
    | { readonly command: "Shutdown PRMonitor" }
    | { readonly managedPrId?: string }
    | { readonly expectedRevision?: number }
    | (F12SchedulerConfigurationInput & { readonly expectedRevision?: number })
    | GithubServerProfileInput
    | { readonly serverId: string; readonly token: string }
    | { readonly serverId: string }
    | { readonly operationId: string }
    | { readonly batchId: string }
    | ManagedPrAddInput
    | ManagedPrCloneInput
    | ManagedPrConfigurationInput
    | { readonly managedPrId: string }
    | { readonly attemptId: string }
    | {
        readonly managedPrId: string;
        readonly destination: "details" | "settings";
      }
    | { readonly managedPrId: string; readonly expectedVersion: number }
    | F16TaskProfileSaveInput
    | F16PolicySaveInput
    | F16OperationalSaveInput
    | F16CommonInstructionSaveInput
    | F16CommonInstructionDeleteInput
    | F16CommonInstructionSelectionSaveInput
    | F16RepositorySaveInput
    | ActivityQuery
    | { readonly eventId: string }
    | { readonly bundleId: string }
    | F23ApprovalInput
    | F23PublicationInput
    | {
        readonly bundleId: string;
        readonly mode: F20DiffMode;
        readonly itemId?: string;
      }
    | F20DecisionCommandInput
    | {
        readonly bundleId: string;
        readonly expectedVersion?: number;
        readonly actionId?: string;
      }
    | F20DraftCommandInput
    | {
        readonly bundleId: string;
        readonly expectedVersion?: number;
      }
    | F20PathActionInput
    | F21UserIntent
    | F21ProposalEntryInput
    | {
        readonly bundleId: string;
        readonly operationId?: string;
        readonly turnId?: string;
      }
    | {
        readonly bundleId: string;
        readonly operationId: string;
        readonly selectedBudget?: number;
        readonly expectedBundleVersion?: number;
      }
    | F24SelectionCommandInput
    | { readonly resolutionRevision: string }
    | { readonly intentId: string }
    | {
        readonly operationId: string;
        readonly action: F26RetryAction;
        readonly expectedVersion?: number;
      }
    | F27ApprovalInput
    | F27PublicationInput
    | F27FreshnessInput
    | F27ReevaluationInput
    | F27WorktreeActionInput
    | { readonly operationId: string; readonly expectedRevision: number },
): Promise<IpcResponse> {
  return ipcRenderer.invoke(IPC_CHANNELS.request, {
    schemaVersion: 1,
    requestId: requestId(),
    type,
    payload,
  }) as Promise<IpcResponse>;
}

const api: PrMonitorPreloadApi = {
  ready: () => invoke("renderer.ready", { sessionId }),
  readCurrentState: () => invoke("app.read-current-state", {}),
  getLifecycleStatus: () => invoke("lifecycle.status", {}),
  requestShutdown: () =>
    invoke("lifecycle.shutdown", { command: "Shutdown PRMonitor" }),
  readScheduler: () => invoke("scheduler.read", {}),
  saveSchedulerConfiguration: (input) =>
    invoke("scheduler.configuration.save", input),
  checkSchedulerNow: (managedPrId) =>
    invoke(
      "scheduler.check-now",
      managedPrId === undefined ? {} : { managedPrId },
    ),
  pauseWatching: (expectedRevision) =>
    invoke(
      "scheduler.pause",
      expectedRevision === undefined ? {} : { expectedRevision },
    ),
  resumeWatching: (expectedRevision) =>
    invoke(
      "scheduler.resume",
      expectedRevision === undefined ? {} : { expectedRevision },
    ),
  readPreferences: () => invoke("preferences.read", {}),
  saveTaskProfile: (input) => invoke("preferences.task-profile.save", input),
  savePolicy: (input) => invoke("preferences.policy.save", input),
  saveOperationalPreferences: (input) =>
    invoke("preferences.operational.save", input),
  saveCommonInstruction: (input) =>
    invoke("preferences.common-instruction.save", input),
  deleteCommonInstruction: (input) =>
    invoke("preferences.common-instruction.delete", input),
  saveCommonInstructionSelection: (input) =>
    invoke("preferences.common-instruction.selection.save", input),
  saveRepositoryPreferences: (input) =>
    invoke("preferences.repository.save", input),
  readGithubSettings: () => invoke("github.settings.read", {}),
  upsertGithubProfile: (input) => invoke("github.profile.upsert", input),
  submitGithubCredential: (serverId, token) =>
    invoke("github.credential.submit", { serverId, token }),
  testGithubConnection: (serverId) =>
    invoke("github.connection.test", { serverId }),
  retryGithubOperation: (operationId) =>
    invoke("github.operation.retry", { operationId }),
  cleanupGithubOperation: (operationId) =>
    invoke("github.operation.cleanup", { operationId }),
  removeGithubProfile: (serverId) =>
    invoke("github.profile.remove", { serverId }),
  readManagedPrs: () => invoke("managed-pr.list", {}),
  readManagedPr: (managedPrId) => invoke("managed-pr.read", { managedPrId }),
  addManagedPr: (input) => invoke("managed-pr.add", input),
  retryManagedPrAdd: (attemptId) => invoke("managed-pr.retry", { attemptId }),
  readManagedPrCandidates: (managedPrId) =>
    invoke("managed-pr.candidates", { managedPrId }),
  pickManagedPrFolder: () => invoke("managed-pr.clone.pick", {}),
  attachManagedPrClone: (input) => invoke("managed-pr.clone.attach", input),
  clearManagedPrClone: (managedPrId, expectedVersion) =>
    invoke("managed-pr.clone.clear", { managedPrId, expectedVersion }),
  saveManagedPrConfiguration: (input) =>
    invoke("managed-pr.configuration.save", input),
  readInbox: () => invoke("inbox.read", {}),
  subscribeInbox: () => invoke("inbox.subscribe", {}),
  readSynchronizationSelection: () =>
    invoke("synchronization.selection.read", {}),
  commandSynchronizationSelection: (input) =>
    invoke("synchronization.selection.command", input),
  resetSynchronizationSelection: () =>
    invoke("synchronization.selection.reset", {}),
  resolveSynchronization: () => invoke("synchronization.resolve", {}),
  confirmSynchronizationPreparation: (resolutionRevision) =>
    invoke("synchronization.confirm", { resolutionRevision }),
  readSynchronizationIntent: (intentId) =>
    invoke("synchronization.intent.read", { intentId }),
  listSynchronizationIntents: () => invoke("synchronization.intent.list", {}),
  reconcileSynchronizationIntent: (intentId) =>
    invoke("synchronization.intent.reconcile", { intentId }),
  listSynchronizationBatches: () => invoke("synchronization.batch.list", {}),
  readSynchronizationBatch: (batchId) =>
    invoke("synchronization.batch.read", { batchId }),
  readSynchronizationResult: (operationId) =>
    invoke("synchronization.result.read", { operationId }),
  retrySynchronizationConflict: (operationId, action, expectedVersion) =>
    invoke("synchronization.conflict.retry", {
      operationId,
      action,
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
    }),
  cancelSynchronizationOperation: (operationId) =>
    invoke("synchronization.operation.cancel", { operationId }),
  listSynchronizationReviews: () =>
    invoke("synchronization.review.batch.list", {}),
  readSynchronizationReviewBatch: (batchId) =>
    invoke("synchronization.review.batch.read", { batchId }),
  readSynchronizationReviewResult: (operationId) =>
    invoke("synchronization.review.result.read", { operationId }),
  refreshSynchronizationWorktree: (operationId, expectedRevision) =>
    invoke("synchronization.review.worktree.refresh", {
      operationId,
      expectedRevision,
    }),
  actOnSynchronizationWorktree: (input) =>
    invoke("synchronization.review.worktree.action", input),
  refreshSynchronizationFreshness: (input) =>
    invoke("synchronization.review.freshness.refresh", input),
  reevaluateSynchronization: (input) =>
    invoke("synchronization.review.reevaluate", input),
  discardSynchronizationResult: (operationId, expectedRevision) =>
    invoke("synchronization.review.discard", {
      operationId,
      expectedRevision,
    }),
  readSynchronizationPublication: (operationId) =>
    invoke("synchronization.review.publication.read", { operationId }),
  approveSynchronizationPublication: (input) =>
    invoke("synchronization.review.publication.approve", input),
  publishSynchronizationPublication: (input) =>
    invoke("synchronization.review.publication.publish", input),
  reconcileSynchronizationPublication: (input) =>
    invoke("synchronization.review.publication.reconcile", input),
  readActivity: (query = {}) => invoke("activity.query", query),
  subscribeActivity: (query = {}) => invoke("activity.subscribe", query),
  navigateActivity: (eventId) => invoke("activity.navigate", { eventId }),
  navigateManagedPr: (managedPrId, destination) =>
    invoke("inbox.navigate", { managedPrId, destination }),
  readReviewBundle: (bundleId) => invoke("review-bundle.read", { bundleId }),
  readReviewBundlePublication: (bundleId) =>
    invoke("review-bundle.publication.read", { bundleId }),
  approveReviewBundlePublication: (input) =>
    invoke("review-bundle.publication.approve", input),
  publishReviewBundlePublication: (input) =>
    invoke("review-bundle.publication.publish", input),
  reconcileReviewBundlePublication: (input) =>
    invoke("review-bundle.publication.reconcile", input),
  retryReviewBundleResponses: (input) =>
    invoke("review-bundle.publication.retry-responses", input),
  discardReviewBundlePublication: (input) =>
    invoke("review-bundle.publication.discard", input),
  reconcileReviewBundleF22: (bundleId) =>
    invoke("review-bundle.f22.reconcile", { bundleId }),
  readReviewBundleDiff: (bundleId, mode, itemId) =>
    invoke(
      "review-bundle.diff.read",
      itemId === undefined ? { bundleId, mode } : { bundleId, mode, itemId },
    ),
  recordReviewBundleDecision: (input) =>
    invoke("review-bundle.decision.record", input),
  confirmReviewBundleDecisions: (bundleId, expectedVersion, actionId) =>
    invoke("review-bundle.decisions.confirm", {
      bundleId,
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
      ...(actionId === undefined ? {} : { actionId }),
    }),
  saveReviewBundleDraft: (input) => invoke("review-bundle.draft.save", input),
  refreshReviewBundleWorktree: (bundleId, expectedVersion) =>
    invoke("review-bundle.worktree.refresh", {
      bundleId,
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
    }),
  previewReviewBundleDiscard: (input) =>
    invoke("review-bundle.discard.preview", input),
  confirmReviewBundleDiscard: (input) =>
    invoke("review-bundle.discard.confirm", input),
  previewReviewBundleReevaluation: (input) =>
    invoke("review-bundle.reevaluate.preview", input),
  confirmReviewBundleReevaluation: (input) =>
    invoke("review-bundle.reevaluate.confirm", input),
  reviewBundlePathAction: (input) => invoke("review-bundle.path-action", input),
  readReviewBundleConversation: (bundleId) =>
    invoke("review-bundle.conversation.read", { bundleId }),
  askReviewBundleConversation: (input) =>
    invoke("review-bundle.conversation.ask", input),
  requestReviewBundleRevision: (input) =>
    invoke("review-bundle.revision.request", input),
  startNewReviewBundleOperation: (input) =>
    invoke("review-bundle.conversation.start-new-operation", input),
  saveReviewBundleProposalInput: (input) =>
    invoke("review-bundle.proposal-input.save", input),
  cancelReviewBundleConversation: (input) =>
    invoke("review-bundle.conversation.cancel", input),
  continueReviewBundleConversation: (input) =>
    invoke("review-bundle.conversation.continue", input),
  onOpenTarget: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (!parseIpcOpenTargetEvent(payload)) return;
      listener(payload.target);
    };
    ipcRenderer.on(IPC_CHANNELS.event, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.event, handler);
  },
  onInboxUpdated: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (!parseIpcInboxUpdateEvent(payload)) return;
      listener(payload.snapshot);
    };
    ipcRenderer.on(IPC_CHANNELS.event, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.event, handler);
  },
  onActivityUpdated: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (!parseIpcActivityUpdateEvent(payload)) return;
      listener(payload.event as ActivityEventView);
    };
    ipcRenderer.on(IPC_CHANNELS.event, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.event, handler);
  },
};

contextBridge.exposeInMainWorld("prmonitor", api);
