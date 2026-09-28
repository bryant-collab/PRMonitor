import { isSafeText } from "./domain/result";
import { parseOpenTargetRecord, type OpenTarget } from "./routing";
import {
  isManagedPrInboxReadModel,
  type ManagedPrInboxReadModel,
} from "./inbox";
import {
  isGithubServerProfileView,
  isGithubServerSettingsView,
  type GithubServerProfileInput,
  type GithubServerProfileView,
  type GithubServerSettingsView,
} from "./github-server";
import {
  isManagedPrCandidateListView,
  isManagedPrListView,
  isManagedPrOperationView,
  isManagedPrReadModel,
  type ManagedPrAddInput,
  type ManagedPrCloneInput,
  type ManagedPrConfigurationInput,
  type ManagedPrCandidateListView,
  type ManagedPrOperationView,
  type ManagedPrReadModel,
  type ManagedPrListView,
} from "./managed-pr";
import {
  isActivityQuerySnapshot,
  isActivityUpdateEvent,
  normalizeActivityQuery,
  type ActivityEventView,
  type ActivityQuery,
  type ActivityQuerySnapshot,
} from "./activity";
import {
  isF12SchedulerControlResult,
  isF12SchedulerSnapshot,
  MAX_F12_INTERVAL_MS,
  MAX_F12_MAX_CONCURRENT_PRS,
  MAX_F12_QUIET_PERIOD_MS,
  MIN_F12_INTERVAL_MS,
  type F12SchedulerControlResult,
  type F12SchedulerConfigurationInput,
  type F12SchedulerSnapshot,
} from "./control-plane";
import {
  f16CommonInstructionDeleteInputSchema,
  f16CommonInstructionSaveInputSchema,
  f16CommonInstructionSelectionSaveInputSchema,
  f16OperationalSaveInputSchema,
  f16PolicySaveInputSchema,
  f16RepositorySaveInputSchema,
  f16TaskProfileSaveInputSchema,
  isF16PreferencesReadModel,
  type F16CommonInstructionDeleteInput,
  type F16CommonInstructionSaveInput,
  type F16CommonInstructionSelectionSaveInput,
  type F16OperationalSaveInput,
  type F16PolicySaveInput,
  type F16PreferencesReadModel,
  type F16RepositorySaveInput,
  type F16TaskProfileSaveInput,
} from "./f16-preferences";
import {
  f20DiffModeSchema,
  f20DiffViewSchema,
  f20PathActionResultSchema,
  f20WorkspaceReadModelSchema,
  type F20DecisionCommandInput,
  type F20DiffMode,
  type F20DiffView,
  type F20DraftCommandInput,
  type F20PathActionInput,
  type F20PathActionResult,
  type F20WorkspaceReadModel,
} from "./f20-workspace";
import {
  f21ConversationReadModelSchema,
  f21ProposalInputSchema,
  f21UserIntentSchema,
  type F21ConversationReadModel,
  type F21ProposalEntryInput,
  type F21UserIntent,
} from "./f21-conversation";
import {
  f22DirtyWorktreeChoiceSchema,
  f22ActionGateSchema,
  f22DiscardPreviewSchema,
  f22ReevaluationPreviewSchema,
  type F22ActionGate,
  type F22DiscardPreview,
  type F22Reason,
  type F22ReevaluationPreview,
} from "./f22-discard-reevaluation";
import {
  f23ApprovalInputSchema,
  f23PublicationInputSchema,
  isF23PublicationReadModel,
  type F23ApprovalInput,
  type F23PublicationInput,
  type F23PublicationReadModel,
} from "./f23-release";
import {
  isF24Confirmation,
  isF24PreparationIntent,
  isF24SelectionSession,
  type F24PreparationIntent,
  type F24SelectionCommandInput,
  type F24SelectionSession,
  type F24SynchronizationConfirmation,
} from "./f24-synchronization";
import {
  isF25SynchronizationBatchReadModel,
  isF25SynchronizationResultReadModel,
  type F25SynchronizationBatchReadModel,
  type F25SynchronizationResultReadModel,
} from "./f25-synchronization";
import {
  f26RetryActionSchema,
  type F26RetryAction,
} from "./f26-conflict-resolution";
import {
  F27_MAX_ROWS,
  isF27BatchReview,
  isF27ResultReview,
  type F27ApprovalInput,
  type F27BatchReview,
  type F27FreshnessInput,
  type F27PublicationInput,
  type F27ReevaluationInput,
  type F27ResultReview,
  type F27WorktreeActionInput,
} from "./f27-synchronization";
import {
  isF28RecoveryProjection,
  type F28RecoveryProjection,
} from "./f28-recovery";
export type {
  F23ApprovalInput,
  F23PublicationInput,
  F23PublicationReadModel,
} from "./f23-release";
export type {
  F27ApprovalInput,
  F27BatchReview,
  F27FreshnessInput,
  F27PublicationInput,
  F27ReevaluationInput,
  F27ResultReview,
  F27WorktreeActionInput,
} from "./f27-synchronization";

export const IPC_SCHEMA_VERSION = 1 as const;
// F07 permits a 32 KiB per-PR context. Keep enough envelope headroom for the
// typed request while retaining a bounded IPC payload.
export const IPC_MAX_REQUEST_BYTES = 64 * 1024;
export const IPC_MAX_RESPONSE_BYTES = 512 * 1024;

export const IPC_CHANNELS = {
  request: "prmonitor:ipc:v1:request",
  event: "prmonitor:ipc:v1:event",
} as const;

export type IpcRequestType =
  | "renderer.ready"
  | "app.read-current-state"
  | "lifecycle.status"
  | "lifecycle.shutdown"
  | "recovery.read"
  | "recovery.request"
  | "scheduler.read"
  | "scheduler.configuration.save"
  | "scheduler.check-now"
  | "scheduler.pause"
  | "scheduler.resume"
  | "preferences.read"
  | "preferences.task-profile.save"
  | "preferences.policy.save"
  | "preferences.operational.save"
  | "preferences.common-instruction.save"
  | "preferences.common-instruction.delete"
  | "preferences.common-instruction.selection.save"
  | "preferences.repository.save"
  | "github.settings.read"
  | "github.profile.upsert"
  | "github.credential.submit"
  | "github.connection.test"
  | "github.operation.retry"
  | "github.operation.cleanup"
  | "github.profile.remove"
  | "managed-pr.list"
  | "managed-pr.read"
  | "managed-pr.add"
  | "managed-pr.retry"
  | "managed-pr.candidates"
  | "managed-pr.clone.pick"
  | "managed-pr.clone.attach"
  | "managed-pr.clone.clear"
  | "managed-pr.configuration.save"
  | "inbox.read"
  | "inbox.subscribe"
  | "synchronization.selection.read"
  | "synchronization.selection.command"
  | "synchronization.selection.reset"
  | "synchronization.resolve"
  | "synchronization.confirm"
  | "synchronization.intent.read"
  | "synchronization.intent.list"
  | "synchronization.intent.reconcile"
  | "synchronization.batch.list"
  | "synchronization.batch.read"
  | "synchronization.result.read"
  | "synchronization.conflict.retry"
  | "synchronization.operation.cancel"
  | "synchronization.review.batch.list"
  | "synchronization.review.batch.read"
  | "synchronization.review.result.read"
  | "synchronization.review.worktree.refresh"
  | "synchronization.review.worktree.action"
  | "synchronization.review.freshness.refresh"
  | "synchronization.review.reevaluate"
  | "synchronization.review.discard"
  | "synchronization.review.publication.read"
  | "synchronization.review.publication.approve"
  | "synchronization.review.publication.publish"
  | "synchronization.review.publication.reconcile"
  | "inbox.navigate"
  | "activity.query"
  | "activity.subscribe"
  | "activity.navigate"
  | "review-bundle.read"
  | "review-bundle.f22.reconcile"
  | "review-bundle.diff.read"
  | "review-bundle.decision.record"
  | "review-bundle.decisions.confirm"
  | "review-bundle.draft.save"
  | "review-bundle.worktree.refresh"
  | "review-bundle.discard.preview"
  | "review-bundle.discard.confirm"
  | "review-bundle.reevaluate.preview"
  | "review-bundle.reevaluate.confirm"
  | "review-bundle.path-action"
  | "review-bundle.conversation.read"
  | "review-bundle.conversation.ask"
  | "review-bundle.revision.request"
  | "review-bundle.conversation.start-new-operation"
  | "review-bundle.proposal-input.save"
  | "review-bundle.conversation.cancel"
  | "review-bundle.conversation.continue"
  | "review-bundle.publication.read"
  | "review-bundle.publication.approve"
  | "review-bundle.publication.publish"
  | "review-bundle.publication.reconcile"
  | "review-bundle.publication.retry-responses"
  | "review-bundle.publication.discard";

export interface IpcRequestBase {
  readonly schemaVersion: typeof IPC_SCHEMA_VERSION;
  readonly requestId: string;
  readonly type: IpcRequestType;
}

export type IpcRequest =
  | (IpcRequestBase & {
      readonly type: "renderer.ready";
      readonly payload: { readonly sessionId: string };
    })
  | (IpcRequestBase & {
      readonly type: "app.read-current-state";
      readonly payload: Record<string, never>;
    })
  | (IpcRequestBase & {
      readonly type: "lifecycle.status";
      readonly payload: Record<string, never>;
    })
  | (IpcRequestBase & {
      readonly type: "recovery.read" | "recovery.request";
      readonly payload: Record<string, never>;
    })
  | (IpcRequestBase & {
      readonly type: "lifecycle.shutdown";
      readonly payload: { readonly command: "Shutdown PRMonitor" };
    })
  | (IpcRequestBase & {
      readonly type: "scheduler.read";
      readonly payload: Record<string, never>;
    })
  | (IpcRequestBase & {
      readonly type: "scheduler.configuration.save";
      readonly payload: F12SchedulerConfigurationInput & {
        readonly expectedRevision?: number;
      };
    })
  | (IpcRequestBase & {
      readonly type: "scheduler.check-now";
      readonly payload: { readonly managedPrId?: string };
    })
  | (IpcRequestBase & {
      readonly type: "scheduler.pause" | "scheduler.resume";
      readonly payload: { readonly expectedRevision?: number };
    })
  | (IpcRequestBase & {
      readonly type: "preferences.read";
      readonly payload: Record<string, never>;
    })
  | (IpcRequestBase & {
      readonly type: "preferences.task-profile.save";
      readonly payload: F16TaskProfileSaveInput;
    })
  | (IpcRequestBase & {
      readonly type: "preferences.policy.save";
      readonly payload: F16PolicySaveInput;
    })
  | (IpcRequestBase & {
      readonly type: "preferences.operational.save";
      readonly payload: F16OperationalSaveInput;
    })
  | (IpcRequestBase & {
      readonly type: "preferences.common-instruction.save";
      readonly payload: F16CommonInstructionSaveInput;
    })
  | (IpcRequestBase & {
      readonly type: "preferences.common-instruction.delete";
      readonly payload: F16CommonInstructionDeleteInput;
    })
  | (IpcRequestBase & {
      readonly type: "preferences.common-instruction.selection.save";
      readonly payload: F16CommonInstructionSelectionSaveInput;
    })
  | (IpcRequestBase & {
      readonly type: "preferences.repository.save";
      readonly payload: F16RepositorySaveInput;
    })
  | (IpcRequestBase & {
      readonly type: "github.settings.read";
      readonly payload: Record<string, never>;
    })
  | (IpcRequestBase & {
      readonly type: "github.profile.upsert";
      readonly payload: GithubServerProfileInput;
    })
  | (IpcRequestBase & {
      readonly type: "github.credential.submit";
      readonly payload: { readonly serverId: string; readonly token: string };
    })
  | (IpcRequestBase & {
      readonly type: "github.connection.test";
      readonly payload: { readonly serverId: string };
    })
  | (IpcRequestBase & {
      readonly type: "github.operation.retry";
      readonly payload: { readonly operationId: string };
    })
  | (IpcRequestBase & {
      readonly type: "github.operation.cleanup";
      readonly payload: { readonly operationId: string };
    })
  | (IpcRequestBase & {
      readonly type: "github.profile.remove";
      readonly payload: { readonly serverId: string };
    })
  | (IpcRequestBase & {
      readonly type: "managed-pr.list";
      readonly payload: Record<string, never>;
    })
  | (IpcRequestBase & {
      readonly type: "managed-pr.read";
      readonly payload: { readonly managedPrId: string };
    })
  | (IpcRequestBase & {
      readonly type: "managed-pr.add";
      readonly payload: ManagedPrAddInput;
    })
  | (IpcRequestBase & {
      readonly type: "managed-pr.retry";
      readonly payload: { readonly attemptId: string };
    })
  | (IpcRequestBase & {
      readonly type: "managed-pr.candidates";
      readonly payload: { readonly managedPrId: string };
    })
  | (IpcRequestBase & {
      readonly type: "managed-pr.clone.pick";
      readonly payload: Record<string, never>;
    })
  | (IpcRequestBase & {
      readonly type: "managed-pr.clone.attach";
      readonly payload: ManagedPrCloneInput;
    })
  | (IpcRequestBase & {
      readonly type: "managed-pr.clone.clear";
      readonly payload: {
        readonly managedPrId: string;
        readonly expectedVersion: number;
      };
    })
  | (IpcRequestBase & {
      readonly type: "managed-pr.configuration.save";
      readonly payload: ManagedPrConfigurationInput;
    })
  | (IpcRequestBase & {
      readonly type: "inbox.read" | "inbox.subscribe";
      readonly payload: Record<string, never>;
    })
  | (IpcRequestBase & {
      readonly type:
        | "synchronization.selection.read"
        | "synchronization.selection.reset"
        | "synchronization.resolve"
        | "synchronization.intent.list"
        | "synchronization.batch.list";
      readonly payload: Record<string, never>;
    })
  | (IpcRequestBase & {
      readonly type: "synchronization.selection.command";
      readonly payload: F24SelectionCommandInput;
    })
  | (IpcRequestBase & {
      readonly type: "synchronization.confirm";
      readonly payload: { readonly resolutionRevision: string };
    })
  | (IpcRequestBase & {
      readonly type:
        "synchronization.intent.read" | "synchronization.intent.reconcile";
      readonly payload: { readonly intentId: string };
    })
  | (IpcRequestBase & {
      readonly type: "synchronization.batch.read";
      readonly payload: { readonly batchId: string };
    })
  | (IpcRequestBase & {
      readonly type:
        "synchronization.result.read" | "synchronization.operation.cancel";
      readonly payload: { readonly operationId: string };
    })
  | (IpcRequestBase & {
      readonly type: "synchronization.review.batch.list";
      readonly payload: Record<string, never>;
    })
  | (IpcRequestBase & {
      readonly type: "synchronization.review.batch.read";
      readonly payload: { readonly batchId: string };
    })
  | (IpcRequestBase & {
      readonly type:
        | "synchronization.review.result.read"
        | "synchronization.review.publication.read";
      readonly payload: { readonly operationId: string };
    })
  | (IpcRequestBase & {
      readonly type: "synchronization.review.worktree.refresh";
      readonly payload: F27FreshnessInput;
    })
  | (IpcRequestBase & {
      readonly type: "synchronization.review.freshness.refresh";
      readonly payload: F27FreshnessInput;
    })
  | (IpcRequestBase & {
      readonly type: "synchronization.review.worktree.action";
      readonly payload: F27WorktreeActionInput;
    })
  | (IpcRequestBase & {
      readonly type: "synchronization.review.reevaluate";
      readonly payload: F27ReevaluationInput;
    })
  | (IpcRequestBase & {
      readonly type: "synchronization.review.discard";
      readonly payload: {
        readonly operationId: string;
        readonly expectedRevision: number;
      };
    })
  | (IpcRequestBase & {
      readonly type: "synchronization.review.publication.approve";
      readonly payload: F27ApprovalInput;
    })
  | (IpcRequestBase & {
      readonly type:
        | "synchronization.review.publication.publish"
        | "synchronization.review.publication.reconcile";
      readonly payload: F27PublicationInput;
    })
  | (IpcRequestBase & {
      readonly type: "synchronization.conflict.retry";
      readonly payload: {
        readonly operationId: string;
        readonly action: F26RetryAction;
        readonly expectedVersion?: number;
      };
    })
  | (IpcRequestBase & {
      readonly type: "inbox.navigate";
      readonly payload: {
        readonly managedPrId: string;
        readonly destination: "details" | "settings";
      };
    })
  | (IpcRequestBase & {
      readonly type: "activity.query" | "activity.subscribe";
      readonly payload: ActivityQuery;
    })
  | (IpcRequestBase & {
      readonly type: "activity.navigate";
      readonly payload: { readonly eventId: string };
    })
  | (IpcRequestBase & {
      readonly type: "review-bundle.read";
      readonly payload: { readonly bundleId: string };
    })
  | (IpcRequestBase & {
      readonly type: "review-bundle.f22.reconcile";
      readonly payload: { readonly bundleId: string };
    })
  | (IpcRequestBase & {
      readonly type: "review-bundle.diff.read";
      readonly payload: {
        readonly bundleId: string;
        readonly mode: F20DiffMode;
        readonly itemId?: string;
      };
    })
  | (IpcRequestBase & {
      readonly type: "review-bundle.decision.record";
      readonly payload: F20DecisionCommandInput;
    })
  | (IpcRequestBase & {
      readonly type: "review-bundle.decisions.confirm";
      readonly payload: {
        readonly bundleId: string;
        readonly expectedVersion?: number;
        readonly actionId?: string;
      };
    })
  | (IpcRequestBase & {
      readonly type: "review-bundle.draft.save";
      readonly payload: F20DraftCommandInput;
    })
  | (IpcRequestBase & {
      readonly type: "review-bundle.worktree.refresh";
      readonly payload: {
        readonly bundleId: string;
        readonly expectedVersion?: number;
      };
    })
  | (IpcRequestBase & {
      readonly type: "review-bundle.discard.preview";
      readonly payload: {
        readonly bundleId: string;
        readonly idempotencyKey: string;
        readonly expectedGateRevision?: number;
      };
    })
  | (IpcRequestBase & {
      readonly type: "review-bundle.discard.confirm";
      readonly payload: {
        readonly actionId: string;
        readonly bundleId: string;
        readonly choice:
          "NO_CHANGES" | "CLEAR_ALL" | "CLEAR_AI_ONLY" | "KEEP_AND_CANCEL";
        readonly confirmed?: boolean;
        readonly expectedActionVersion?: number;
        readonly expectedGateRevision?: number;
      };
    })
  | (IpcRequestBase & {
      readonly type: "review-bundle.reevaluate.preview";
      readonly payload: {
        readonly bundleId: string;
        readonly idempotencyKey: string;
        readonly selectedRetainedEventVersionIds?: readonly string[];
        readonly expectedGateRevision?: number;
      };
    })
  | (IpcRequestBase & {
      readonly type: "review-bundle.reevaluate.confirm";
      readonly payload: {
        readonly actionId: string;
        readonly bundleId: string;
        readonly choice:
          "NO_CHANGES" | "CLEAR_ALL" | "CLEAR_AI_ONLY" | "KEEP_AND_CANCEL";
        readonly confirmed?: boolean;
        readonly expectedActionVersion?: number;
        readonly expectedGateRevision?: number;
      };
    })
  | (IpcRequestBase & {
      readonly type: "review-bundle.path-action";
      readonly payload: F20PathActionInput;
    })
  | (IpcRequestBase & {
      readonly type: "review-bundle.conversation.read";
      readonly payload: { readonly bundleId: string };
    })
  | (IpcRequestBase & {
      readonly type:
        | "review-bundle.conversation.ask"
        | "review-bundle.revision.request"
        | "review-bundle.conversation.start-new-operation";
      readonly payload: F21UserIntent;
    })
  | (IpcRequestBase & {
      readonly type: "review-bundle.proposal-input.save";
      readonly payload: F21ProposalEntryInput;
    })
  | (IpcRequestBase & {
      readonly type: "review-bundle.conversation.cancel";
      readonly payload: {
        readonly bundleId: string;
        readonly operationId?: string;
        readonly turnId?: string;
      };
    })
  | (IpcRequestBase & {
      readonly type: "review-bundle.conversation.continue";
      readonly payload: {
        readonly bundleId: string;
        readonly operationId: string;
        readonly selectedBudget?: number;
        readonly expectedBundleVersion?: number;
      };
    })
  | (IpcRequestBase & {
      readonly type: "review-bundle.publication.read";
      readonly payload: { readonly bundleId: string };
    })
  | (IpcRequestBase & {
      readonly type: "review-bundle.publication.approve";
      readonly payload: F23ApprovalInput;
    })
  | (IpcRequestBase & {
      readonly type:
        | "review-bundle.publication.publish"
        | "review-bundle.publication.reconcile"
        | "review-bundle.publication.retry-responses"
        | "review-bundle.publication.discard";
      readonly payload: F23PublicationInput;
    });

export interface IpcError {
  readonly code:
    | "INVALID_REQUEST"
    | "UNKNOWN_CHANNEL"
    | "UNAUTHORIZED"
    | "HANDLER_FAILED"
    | "NOT_READY"
    | "SHUTDOWN_IN_PROGRESS"
    | "HANDOFF_RECOVERY_REQUIRED"
    | "SERVICE_START_FAILED"
    | "SERVICE_STOP_FAILED"
    | "SERVICE_STOP_TIMEOUT"
    | "SERVICE_HANDOFF_TIMEOUT"
    | "CONFIGURATION_ERROR";
  readonly message: string;
  readonly correlationId: string;
}

export type LifecyclePhase =
  | "STARTING"
  | "RUNNING"
  | "SHUTDOWN_REQUESTED"
  | "HANDING_OFF"
  | "STOPPED"
  | "RECOVERY_REQUIRED";

export interface LifecycleStatus {
  readonly schemaVersion: typeof IPC_SCHEMA_VERSION;
  readonly phase: LifecyclePhase;
  readonly sessionId: string;
  readonly correlationId: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly shutdownCommand?: "Shutdown PRMonitor";
  readonly reasonCode?: string;
  readonly incompleteHandoff: boolean;
}

export interface CurrentState {
  readonly schemaVersion: typeof IPC_SCHEMA_VERSION;
  readonly applicationTitle: "PRMonitor";
  readonly lifecycle: LifecycleStatus;
  readonly persistence: {
    readonly status: "healthy" | "upgraded" | "recovery_required";
    readonly schemaVersion: number;
  };
  readonly openTarget?: OpenTarget;
}

export type IpcResponseValue =
  | { readonly kind: "renderer-ready"; readonly sessionId: string }
  | { readonly kind: "current-state"; readonly state: CurrentState }
  | { readonly kind: "lifecycle-status"; readonly status: LifecycleStatus }
  | { readonly kind: "shutdown"; readonly status: LifecycleStatus }
  | { readonly kind: "recovery"; readonly projection: F28RecoveryProjection }
  | {
      readonly kind: "scheduler-snapshot";
      readonly snapshot: F12SchedulerSnapshot;
    }
  | {
      readonly kind: "scheduler-operation";
      readonly operation: F12SchedulerControlResult;
    }
  | {
      readonly kind: "preferences";
      readonly preferences: F16PreferencesReadModel;
    }
  | {
      readonly kind: "github-settings";
      readonly settings: GithubServerSettingsView;
    }
  | {
      readonly kind: "github-profile";
      readonly profile: GithubServerProfileView;
    }
  | {
      readonly kind: "github-operation";
      readonly operationId: string;
      readonly profile: GithubServerProfileView;
    }
  | { readonly kind: "managed-pr-list"; readonly value: ManagedPrListView }
  | {
      readonly kind: "managed-pr-details";
      readonly managedPr: ManagedPrReadModel | null;
    }
  | {
      readonly kind: "managed-pr-operation";
      readonly operation: ManagedPrOperationView;
    }
  | {
      readonly kind: "managed-pr-candidates";
      readonly value: ManagedPrCandidateListView;
    }
  | { readonly kind: "managed-pr-folder"; readonly path?: string }
  | {
      readonly kind: "managed-pr-inbox";
      readonly snapshot: ManagedPrInboxReadModel;
    }
  | {
      readonly kind: "synchronization-selection";
      readonly selection: F24SelectionSession;
    }
  | {
      readonly kind: "synchronization-confirmation";
      readonly confirmation: F24SynchronizationConfirmation;
    }
  | {
      readonly kind: "synchronization-intent";
      readonly intent: F24PreparationIntent;
    }
  | {
      readonly kind: "synchronization-intents";
      readonly intents: readonly F24PreparationIntent[];
    }
  | {
      readonly kind: "synchronization-batches";
      readonly batches: readonly F25SynchronizationBatchReadModel[];
    }
  | {
      readonly kind: "synchronization-batch";
      readonly batch: F25SynchronizationBatchReadModel;
    }
  | {
      readonly kind: "synchronization-result";
      readonly result: F25SynchronizationResultReadModel;
    }
  | {
      readonly kind: "synchronization-review-batches";
      readonly batches: readonly F27BatchReview[];
    }
  | {
      readonly kind: "synchronization-review-batch";
      readonly batch: F27BatchReview;
    }
  | {
      readonly kind: "synchronization-review-result";
      readonly result: F27ResultReview;
    }
  | {
      readonly kind: "synchronization-review-action";
      readonly outcome: string;
      readonly result: F27ResultReview;
    }
  | {
      readonly kind: "synchronization-review-publication";
      readonly result: F27ResultReview;
    }
  | {
      readonly kind: "synchronization-operation-cancelled";
      readonly cancelled: boolean;
    }
  | {
      readonly kind: "activity-query";
      readonly snapshot: ActivityQuerySnapshot;
    }
  | { readonly kind: "activity-navigation"; readonly target: OpenTarget }
  | { readonly kind: "navigation-target"; readonly target: OpenTarget }
  | {
      readonly kind: "review-bundle-workspace";
      readonly workspace: F20WorkspaceReadModel;
    }
  | {
      readonly kind: "review-bundle-diff";
      readonly diff: F20DiffView;
    }
  | {
      readonly kind: "review-bundle-path-action";
      readonly result: F20PathActionResult;
    }
  | {
      readonly kind: "review-bundle-f22";
      readonly workspace: F20WorkspaceReadModel;
      readonly gate: F22ActionGate;
      readonly outcome: string;
      readonly actionId?: string;
      readonly newBundleId?: string;
      readonly preview?: F22DiscardPreview | F22ReevaluationPreview;
      readonly reason?: F22Reason;
    }
  | {
      readonly kind: "review-bundle-conversation";
      readonly conversation: F21ConversationReadModel;
    }
  | {
      readonly kind: "review-bundle-publication";
      readonly publication: F23PublicationReadModel;
    };

export type IpcResponse =
  | {
      readonly schemaVersion: typeof IPC_SCHEMA_VERSION;
      readonly requestId: string;
      readonly ok: true;
      readonly value: IpcResponseValue;
    }
  | {
      readonly schemaVersion: typeof IPC_SCHEMA_VERSION;
      readonly requestId: string;
      readonly ok: false;
      readonly error: IpcError;
    };

export interface IpcOpenTargetEvent {
  readonly schemaVersion: typeof IPC_SCHEMA_VERSION;
  readonly type: "open-target";
  readonly target: OpenTarget;
}

export interface IpcInboxUpdateEvent {
  readonly schemaVersion: typeof IPC_SCHEMA_VERSION;
  readonly type: "inbox-update";
  readonly snapshot: ManagedPrInboxReadModel;
}

export interface IpcActivityUpdateEvent {
  readonly schemaVersion: typeof IPC_SCHEMA_VERSION;
  readonly type: "activity-update";
  readonly event: ActivityEventView;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SECRET_KEY =
  /(?:token|secret|password|credential|authorization|cookie|prompt|api[_.-]?key|access[_.-]?key|environment|env)/iu;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  return Object.keys(record).every((key) => allowed.has(key));
}

function safeRequestId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function safeText(value: unknown, maximum = 2_048): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    !SECRET_KEY.test(value) &&
    isSafeText(value)
  );
}

function safeGithubIdentifier(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function safeCredentialValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    byteLength(value) <= 4_096 &&
    [...value].every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127;
    })
  );
}

function safeProfileText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    byteLength(value) <= maximum &&
    isSafeText(value) &&
    [...value].every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127;
    })
  );
}

function safeManagedMultilineText(
  value: unknown,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    byteLength(value) <= maximum &&
    [...value].every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        (codePoint > 31 ||
          codePoint === 9 ||
          codePoint === 10 ||
          codePoint === 13) &&
        codePoint !== 127
      );
    })
  );
}

function safeManagedPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4_096 &&
    [...value].every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127;
    })
  );
}

function safeReviewBundleRelativePath(value: unknown): value is string {
  return (
    safeManagedPath(value) &&
    !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(value) &&
    !value.split(/[\\/]/u).includes("..")
  );
}

function safeVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isF23ApprovalInput(value: unknown): value is F23ApprovalInput {
  return f23ApprovalInputSchema.safeParse(value).success;
}

function isF23PublicationInput(value: unknown): value is F23PublicationInput {
  return f23PublicationInputSchema.safeParse(value).success;
}

function hasExactKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => key in record) &&
    Object.keys(record).every((key) => allowed.has(key))
  );
}

function parseLifecycleStatus(value: unknown): value is LifecycleStatus {
  if (!isPlainRecord(value)) return false;
  if (
    !hasExactKeys(
      value,
      [
        "schemaVersion",
        "phase",
        "sessionId",
        "correlationId",
        "startedAt",
        "updatedAt",
        "incompleteHandoff",
      ],
      ["shutdownCommand", "reasonCode"],
    )
  )
    return false;
  return (
    value.schemaVersion === IPC_SCHEMA_VERSION &&
    typeof value.phase === "string" &&
    [
      "STARTING",
      "RUNNING",
      "SHUTDOWN_REQUESTED",
      "HANDING_OFF",
      "STOPPED",
      "RECOVERY_REQUIRED",
    ].includes(value.phase) &&
    safeRequestId(value.sessionId) &&
    safeRequestId(value.correlationId) &&
    safeText(value.startedAt, 64) &&
    safeText(value.updatedAt, 64) &&
    typeof value.incompleteHandoff === "boolean" &&
    (value.shutdownCommand === undefined ||
      value.shutdownCommand === "Shutdown PRMonitor") &&
    (value.reasonCode === undefined || safeText(value.reasonCode, 128))
  );
}

function parseCurrentState(value: unknown): value is CurrentState {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(
      value,
      ["schemaVersion", "applicationTitle", "lifecycle", "persistence"],
      ["openTarget"],
    )
  )
    return false;
  if (
    !parseLifecycleStatus(value.lifecycle) ||
    value.schemaVersion !== IPC_SCHEMA_VERSION ||
    value.applicationTitle !== "PRMonitor"
  )
    return false;
  if (
    !isPlainRecord(value.persistence) ||
    !hasExactKeys(value.persistence, ["status", "schemaVersion"])
  )
    return false;
  if (
    !["healthy", "upgraded", "recovery_required"].includes(
      String(value.persistence.status),
    ) ||
    typeof value.persistence.schemaVersion !== "number" ||
    !Number.isSafeInteger(value.persistence.schemaVersion) ||
    value.persistence.schemaVersion < 0
  )
    return false;
  return (
    value.openTarget === undefined || parseOpenTargetRecord(value.openTarget).ok
  );
}

function parseResponseValue(value: unknown): boolean {
  if (!isPlainRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "renderer-ready")
    return (
      hasExactKeys(value, ["kind", "sessionId"]) &&
      safeRequestId(value.sessionId)
    );
  if (value.kind === "current-state")
    return (
      hasExactKeys(value, ["kind", "state"]) && parseCurrentState(value.state)
    );
  if (value.kind === "lifecycle-status")
    return (
      hasExactKeys(value, ["kind", "status"]) &&
      parseLifecycleStatus(value.status)
    );
  if (value.kind === "shutdown")
    return (
      hasExactKeys(value, ["kind", "status"]) &&
      parseLifecycleStatus(value.status)
    );
  if (value.kind === "recovery")
    return (
      hasExactKeys(value, ["kind", "projection"]) &&
      isF28RecoveryProjection(value.projection)
    );
  if (value.kind === "scheduler-snapshot")
    return (
      hasExactKeys(value, ["kind", "snapshot"]) &&
      isF12SchedulerSnapshot(value.snapshot)
    );
  if (value.kind === "scheduler-operation")
    return (
      hasExactKeys(value, ["kind", "operation"]) &&
      isF12SchedulerControlResult(value.operation)
    );
  if (value.kind === "preferences")
    return (
      hasExactKeys(value, ["kind", "preferences"]) &&
      isF16PreferencesReadModel(value.preferences)
    );
  if (value.kind === "github-settings")
    return (
      hasExactKeys(value, ["kind", "settings"]) &&
      isGithubServerSettingsView(value.settings)
    );
  if (value.kind === "github-profile")
    return (
      hasExactKeys(value, ["kind", "profile"]) &&
      isGithubServerProfileView(value.profile)
    );
  if (value.kind === "github-operation")
    return (
      hasExactKeys(value, ["kind", "operationId", "profile"]) &&
      safeGithubIdentifier(value.operationId) &&
      isGithubServerProfileView(value.profile)
    );
  if (value.kind === "managed-pr-list")
    return (
      hasExactKeys(value, ["kind", "value"]) && isManagedPrListView(value.value)
    );
  if (value.kind === "managed-pr-details")
    return (
      hasExactKeys(value, ["kind", "managedPr"]) &&
      (value.managedPr === null || isManagedPrReadModel(value.managedPr))
    );
  if (value.kind === "managed-pr-operation")
    return (
      hasExactKeys(value, ["kind", "operation"]) &&
      isManagedPrOperationView(value.operation)
    );
  if (value.kind === "managed-pr-candidates")
    return (
      hasExactKeys(value, ["kind", "value"]) &&
      isManagedPrCandidateListView(value.value)
    );
  if (value.kind === "managed-pr-folder")
    return (
      hasExactKeys(value, ["kind"], ["path"]) &&
      (value.path === undefined || safeManagedPath(value.path))
    );
  if (value.kind === "managed-pr-inbox")
    return (
      hasExactKeys(value, ["kind", "snapshot"]) &&
      isManagedPrInboxReadModel(value.snapshot)
    );
  if (value.kind === "synchronization-selection")
    return (
      hasExactKeys(value, ["kind", "selection"]) &&
      isF24SelectionSession(value.selection)
    );
  if (value.kind === "synchronization-confirmation")
    return (
      hasExactKeys(value, ["kind", "confirmation"]) &&
      isF24Confirmation(value.confirmation)
    );
  if (value.kind === "synchronization-intent")
    return (
      hasExactKeys(value, ["kind", "intent"]) &&
      isF24PreparationIntent(value.intent)
    );
  if (value.kind === "synchronization-intents")
    return (
      hasExactKeys(value, ["kind", "intents"]) &&
      Array.isArray(value.intents) &&
      value.intents.length <= 250 &&
      value.intents.every(isF24PreparationIntent)
    );
  if (value.kind === "synchronization-batches")
    return (
      hasExactKeys(value, ["kind", "batches"]) &&
      Array.isArray(value.batches) &&
      value.batches.length <= 250 &&
      value.batches.every(isF25SynchronizationBatchReadModel)
    );
  if (value.kind === "synchronization-batch")
    return (
      hasExactKeys(value, ["kind", "batch"]) &&
      isF25SynchronizationBatchReadModel(value.batch)
    );
  if (value.kind === "synchronization-result")
    return (
      hasExactKeys(value, ["kind", "result"]) &&
      isF25SynchronizationResultReadModel(value.result)
    );
  if (value.kind === "synchronization-review-batches")
    return (
      hasExactKeys(value, ["kind", "batches"]) &&
      Array.isArray(value.batches) &&
      value.batches.length <= F27_MAX_ROWS &&
      value.batches.every(isF27BatchReview)
    );
  if (value.kind === "synchronization-review-batch")
    return (
      hasExactKeys(value, ["kind", "batch"]) && isF27BatchReview(value.batch)
    );
  if (value.kind === "synchronization-review-result")
    return (
      hasExactKeys(value, ["kind", "result"]) && isF27ResultReview(value.result)
    );
  if (value.kind === "synchronization-review-action")
    return (
      hasExactKeys(value, ["kind", "outcome", "result"]) &&
      typeof value.outcome === "string" &&
      isF27ResultReview(value.result)
    );
  if (value.kind === "synchronization-review-publication")
    return (
      hasExactKeys(value, ["kind", "result"]) && isF27ResultReview(value.result)
    );
  if (value.kind === "synchronization-operation-cancelled")
    return (
      hasExactKeys(value, ["kind", "cancelled"]) &&
      typeof value.cancelled === "boolean"
    );
  if (value.kind === "activity-query")
    return (
      hasExactKeys(value, ["kind", "snapshot"]) &&
      isActivityQuerySnapshot(value.snapshot)
    );
  if (value.kind === "activity-navigation")
    return (
      hasExactKeys(value, ["kind", "target"]) &&
      parseOpenTargetRecord(value.target).ok
    );
  if (value.kind === "navigation-target")
    return (
      hasExactKeys(value, ["kind", "target"]) &&
      parseOpenTargetRecord(value.target).ok
    );
  if (value.kind === "review-bundle-workspace")
    return (
      hasExactKeys(value, ["kind", "workspace"]) &&
      f20WorkspaceReadModelSchema.safeParse(value.workspace).success
    );
  if (value.kind === "review-bundle-diff")
    return (
      hasExactKeys(value, ["kind", "diff"]) &&
      f20DiffViewSchema.safeParse(value.diff).success
    );
  if (value.kind === "review-bundle-path-action")
    return (
      hasExactKeys(value, ["kind", "result"]) &&
      f20PathActionResultSchema.safeParse(value.result).success
    );
  if (value.kind === "review-bundle-f22") {
    const previewOk =
      value.preview === undefined ||
      f22DiscardPreviewSchema.safeParse(value.preview).success ||
      f22ReevaluationPreviewSchema.safeParse(value.preview).success;
    return (
      hasExactKeys(
        value,
        ["kind", "workspace", "gate", "outcome"],
        ["actionId", "newBundleId", "preview", "reason"],
      ) &&
      f20WorkspaceReadModelSchema.safeParse(value.workspace).success &&
      f22ActionGateSchema.safeParse(value.gate).success &&
      typeof value.outcome === "string" &&
      previewOk
    );
  }
  if (value.kind === "review-bundle-conversation")
    return (
      hasExactKeys(value, ["kind", "conversation"]) &&
      f21ConversationReadModelSchema.safeParse(value.conversation).success
    );
  if (value.kind === "review-bundle-publication")
    return (
      hasExactKeys(value, ["kind", "publication"]) &&
      isF23PublicationReadModel(value.publication)
    );
  return false;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function invalidRequest(message: string): { ok: false; error: IpcError } {
  return {
    ok: false,
    error: {
      code: "INVALID_REQUEST",
      message,
      correlationId: "ipc-invalid-request",
    },
  };
}

export function parseIpcRequest(
  value: unknown,
):
  | { readonly ok: true; readonly value: IpcRequest }
  | { readonly ok: false; readonly error: IpcError } {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return invalidRequest("The IPC request could not be serialized safely.");
  }
  if (byteLength(serialized) > IPC_MAX_REQUEST_BYTES) {
    return invalidRequest("The IPC request exceeds the bounded limit.");
  }
  if (!isPlainRecord(value))
    return invalidRequest("The IPC request must be a plain object.");
  if (!hasOnlyKeys(value, ["schemaVersion", "requestId", "type", "payload"])) {
    return invalidRequest("The IPC request contains an unsupported field.");
  }
  if (
    value.schemaVersion !== IPC_SCHEMA_VERSION ||
    !safeRequestId(value.requestId) ||
    typeof value.type !== "string" ||
    !isPlainRecord(value.payload)
  ) {
    return invalidRequest(
      "The IPC request has an invalid version, identity, type, or payload.",
    );
  }
  const base = {
    schemaVersion: IPC_SCHEMA_VERSION,
    requestId: value.requestId,
    type: value.type,
  } as const;
  if (value.type === "renderer.ready") {
    if (
      !hasOnlyKeys(value.payload, ["sessionId"]) ||
      !safeRequestId(value.payload.sessionId)
    ) {
      return invalidRequest("The renderer-ready payload is invalid.");
    }
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: { sessionId: value.payload.sessionId },
      },
    };
  }
  if (
    value.type === "app.read-current-state" ||
    value.type === "lifecycle.status" ||
    value.type === "recovery.read" ||
    value.type === "recovery.request"
  ) {
    if (Object.keys(value.payload).length !== 0)
      return invalidRequest("This IPC request does not accept a payload.");
    return {
      ok: true,
      value: { ...base, type: value.type, payload: {} } as IpcRequest,
    };
  }
  if (value.type === "lifecycle.shutdown") {
    if (
      !hasOnlyKeys(value.payload, ["command"]) ||
      value.payload.command !== "Shutdown PRMonitor"
    ) {
      return invalidRequest(
        "Only the explicit Shutdown PRMonitor command is accepted.",
      );
    }
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: { command: "Shutdown PRMonitor" },
      },
    };
  }
  if (value.type === "scheduler.read") {
    if (Object.keys(value.payload).length !== 0)
      return invalidRequest("The scheduler read does not accept a payload.");
    return { ok: true, value: { ...base, type: value.type, payload: {} } };
  }
  if (value.type === "scheduler.configuration.save") {
    if (
      !hasExactKeys(
        value.payload,
        [],
        [
          "intervalMs",
          "quietPeriodMs",
          "maxConcurrentPrs",
          "readOnlyPollWhilePaused",
          "expectedRevision",
        ],
      ) ||
      (value.payload.intervalMs !== undefined &&
        (typeof value.payload.intervalMs !== "number" ||
          !Number.isSafeInteger(value.payload.intervalMs) ||
          value.payload.intervalMs < MIN_F12_INTERVAL_MS ||
          value.payload.intervalMs > MAX_F12_INTERVAL_MS)) ||
      (value.payload.quietPeriodMs !== undefined &&
        (typeof value.payload.quietPeriodMs !== "number" ||
          !Number.isSafeInteger(value.payload.quietPeriodMs) ||
          value.payload.quietPeriodMs < MIN_F12_INTERVAL_MS ||
          value.payload.quietPeriodMs > MAX_F12_QUIET_PERIOD_MS)) ||
      (value.payload.maxConcurrentPrs !== undefined &&
        (typeof value.payload.maxConcurrentPrs !== "number" ||
          !Number.isSafeInteger(value.payload.maxConcurrentPrs) ||
          value.payload.maxConcurrentPrs < 1 ||
          value.payload.maxConcurrentPrs > MAX_F12_MAX_CONCURRENT_PRS)) ||
      (value.payload.readOnlyPollWhilePaused !== undefined &&
        typeof value.payload.readOnlyPollWhilePaused !== "boolean") ||
      (value.payload.expectedRevision !== undefined &&
        !safeVersion(value.payload.expectedRevision))
    )
      return invalidRequest("The scheduler configuration is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          ...(value.payload.intervalMs === undefined
            ? {}
            : { intervalMs: value.payload.intervalMs }),
          ...(value.payload.quietPeriodMs === undefined
            ? {}
            : { quietPeriodMs: value.payload.quietPeriodMs }),
          ...(value.payload.maxConcurrentPrs === undefined
            ? {}
            : { maxConcurrentPrs: value.payload.maxConcurrentPrs }),
          ...(value.payload.readOnlyPollWhilePaused === undefined
            ? {}
            : {
                readOnlyPollWhilePaused: value.payload.readOnlyPollWhilePaused,
              }),
          ...(value.payload.expectedRevision === undefined
            ? {}
            : { expectedRevision: value.payload.expectedRevision }),
        },
      },
    };
  }
  if (value.type === "scheduler.check-now") {
    if (
      !hasExactKeys(value.payload, [], ["managedPrId"]) ||
      (value.payload.managedPrId !== undefined &&
        !safeGithubIdentifier(value.payload.managedPrId))
    )
      return invalidRequest("The Check Now scope is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          ...(value.payload.managedPrId === undefined
            ? {}
            : { managedPrId: value.payload.managedPrId }),
        },
      },
    };
  }
  if (value.type === "scheduler.pause" || value.type === "scheduler.resume") {
    if (
      !hasExactKeys(value.payload, [], ["expectedRevision"]) ||
      (value.payload.expectedRevision !== undefined &&
        !safeVersion(value.payload.expectedRevision))
    )
      return invalidRequest("The scheduler revision is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          ...(value.payload.expectedRevision === undefined
            ? {}
            : { expectedRevision: value.payload.expectedRevision }),
        },
      },
    };
  }
  if (value.type === "preferences.read") {
    if (Object.keys(value.payload).length !== 0)
      return invalidRequest("The preferences read does not accept a payload.");
    return { ok: true, value: { ...base, type: value.type, payload: {} } };
  }
  if (value.type === "preferences.task-profile.save") {
    const parsed = f16TaskProfileSaveInputSchema.safeParse(value.payload);
    if (!parsed.success)
      return invalidRequest("The AI task profile preferences are invalid.");
    return {
      ok: true,
      value: { ...base, type: value.type, payload: parsed.data },
    };
  }
  if (value.type === "preferences.policy.save") {
    const parsed = f16PolicySaveInputSchema.safeParse(value.payload);
    if (!parsed.success)
      return invalidRequest("The execution policy preferences are invalid.");
    return {
      ok: true,
      value: { ...base, type: value.type, payload: parsed.data },
    };
  }
  if (value.type === "preferences.operational.save") {
    const parsed = f16OperationalSaveInputSchema.safeParse(value.payload);
    if (!parsed.success)
      return invalidRequest("The operational preferences are invalid.");
    return {
      ok: true,
      value: { ...base, type: value.type, payload: parsed.data },
    };
  }
  if (value.type === "preferences.common-instruction.save") {
    const parsed = f16CommonInstructionSaveInputSchema.safeParse(value.payload);
    if (!parsed.success)
      return invalidRequest("The Common Instructions profile is invalid.");
    return {
      ok: true,
      value: { ...base, type: value.type, payload: parsed.data },
    };
  }
  if (value.type === "preferences.common-instruction.delete") {
    const parsed = f16CommonInstructionDeleteInputSchema.safeParse(
      value.payload,
    );
    if (!parsed.success)
      return invalidRequest(
        "The Common Instructions delete request is invalid.",
      );
    return {
      ok: true,
      value: { ...base, type: value.type, payload: parsed.data },
    };
  }
  if (value.type === "preferences.common-instruction.selection.save") {
    const parsed = f16CommonInstructionSelectionSaveInputSchema.safeParse(
      value.payload,
    );
    if (!parsed.success)
      return invalidRequest("The Common Instructions selection is invalid.");
    return {
      ok: true,
      value: { ...base, type: value.type, payload: parsed.data },
    };
  }
  if (value.type === "preferences.repository.save") {
    const parsed = f16RepositorySaveInputSchema.safeParse(value.payload);
    if (!parsed.success)
      return invalidRequest("The repository AI preferences are invalid.");
    return {
      ok: true,
      value: { ...base, type: value.type, payload: parsed.data },
    };
  }
  if (value.type === "github.credential.submit") {
    if (
      !hasExactKeys(value.payload, ["serverId", "token"]) ||
      !safeGithubIdentifier(value.payload.serverId) ||
      !safeCredentialValue(value.payload.token)
    ) {
      return invalidRequest("The protected access submission is invalid.");
    }
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          serverId: value.payload.serverId,
          token: value.payload.token,
        },
      },
    };
  }
  if (value.type === "github.settings.read") {
    if (Object.keys(value.payload).length !== 0)
      return invalidRequest(
        "The GitHub settings read does not accept a payload.",
      );
    return { ok: true, value: { ...base, type: value.type, payload: {} } };
  }
  if (value.type === "github.profile.upsert") {
    if (
      !hasExactKeys(
        value.payload,
        ["displayName", "serverUrl"],
        ["expectedVersion"],
      ) ||
      !safeProfileText(value.payload.displayName, 120) ||
      !safeProfileText(value.payload.serverUrl, 2_048) ||
      (value.payload.expectedVersion !== undefined &&
        (typeof value.payload.expectedVersion !== "number" ||
          !Number.isSafeInteger(value.payload.expectedVersion) ||
          value.payload.expectedVersion < 1))
    )
      return invalidRequest("The GitHub server profile input is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          displayName: value.payload.displayName,
          serverUrl: value.payload.serverUrl,
          ...(value.payload.expectedVersion === undefined
            ? {}
            : { expectedVersion: value.payload.expectedVersion }),
        },
      },
    };
  }
  if (
    value.type === "github.connection.test" ||
    value.type === "github.profile.remove"
  ) {
    if (
      !hasExactKeys(value.payload, ["serverId"]) ||
      !safeGithubIdentifier(value.payload.serverId)
    )
      return invalidRequest("The GitHub server identifier is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: { serverId: value.payload.serverId },
      } as IpcRequest,
    };
  }
  if (
    value.type === "github.operation.retry" ||
    value.type === "github.operation.cleanup"
  ) {
    if (
      !hasExactKeys(value.payload, ["operationId"]) ||
      !safeGithubIdentifier(value.payload.operationId)
    )
      return invalidRequest("The GitHub operation identifier is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: { operationId: value.payload.operationId },
      } as IpcRequest,
    };
  }
  if (
    value.type === "managed-pr.list" ||
    value.type === "managed-pr.clone.pick" ||
    value.type === "inbox.read" ||
    value.type === "inbox.subscribe" ||
    value.type === "synchronization.selection.read" ||
    value.type === "synchronization.selection.reset" ||
    value.type === "synchronization.resolve" ||
    value.type === "synchronization.intent.list" ||
    value.type === "synchronization.batch.list" ||
    value.type === "synchronization.review.batch.list"
  ) {
    if (Object.keys(value.payload).length !== 0)
      return invalidRequest("This read request does not accept a payload.");
    return {
      ok: true,
      value: { ...base, type: value.type, payload: {} } as IpcRequest,
    };
  }
  if (value.type === "synchronization.selection.command") {
    if (
      !hasExactKeys(
        value.payload,
        ["command", "projectionRevision"],
        ["managedPrId"],
      ) ||
      !["TOGGLE", "CLEAR", "SELECT_ALL"].includes(
        String(value.payload.command),
      ) ||
      typeof value.payload.projectionRevision !== "number" ||
      !Number.isSafeInteger(value.payload.projectionRevision) ||
      value.payload.projectionRevision < 0 ||
      (value.payload.managedPrId !== undefined &&
        !safeGithubIdentifier(value.payload.managedPrId))
    )
      return invalidRequest(
        "The synchronization selection command is invalid.",
      );
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          command: value.payload.command as F24SelectionCommandInput["command"],
          projectionRevision: value.payload.projectionRevision,
          ...(value.payload.managedPrId === undefined
            ? {}
            : { managedPrId: value.payload.managedPrId }),
        },
      } as IpcRequest,
    };
  }
  if (value.type === "synchronization.confirm") {
    if (
      !hasExactKeys(value.payload, ["resolutionRevision"]) ||
      !safeGithubIdentifier(value.payload.resolutionRevision)
    )
      return invalidRequest(
        "The synchronization resolution revision is invalid.",
      );
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: { resolutionRevision: value.payload.resolutionRevision },
      } as IpcRequest,
    };
  }
  if (
    value.type === "synchronization.intent.read" ||
    value.type === "synchronization.intent.reconcile"
  ) {
    if (
      !hasExactKeys(value.payload, ["intentId"]) ||
      !safeGithubIdentifier(value.payload.intentId)
    )
      return invalidRequest(
        "The synchronization intent identifier is invalid.",
      );
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: { intentId: value.payload.intentId },
      } as IpcRequest,
    };
  }
  if (value.type === "synchronization.batch.read") {
    if (
      !hasExactKeys(value.payload, ["batchId"]) ||
      !safeGithubIdentifier(value.payload.batchId)
    )
      return invalidRequest("The synchronization batch identifier is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: { batchId: value.payload.batchId },
      } as IpcRequest,
    };
  }
  if (
    value.type === "synchronization.review.batch.read" ||
    value.type === "synchronization.review.publication.read"
  ) {
    const key =
      value.type === "synchronization.review.batch.read"
        ? "batchId"
        : "operationId";
    if (
      !hasExactKeys(value.payload, [key]) ||
      !safeGithubIdentifier(value.payload[key])
    )
      return invalidRequest(
        "The synchronization review identifier is invalid.",
      );
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: { [key]: value.payload[key] },
      } as IpcRequest,
    };
  }
  if (
    value.type === "synchronization.review.result.read" ||
    value.type === "synchronization.review.worktree.refresh" ||
    value.type === "synchronization.review.freshness.refresh"
  ) {
    if (
      !hasExactKeys(value.payload, ["operationId"], ["expectedRevision"]) ||
      !safeGithubIdentifier(value.payload.operationId) ||
      (value.payload.expectedRevision !== undefined &&
        !safeVersion(value.payload.expectedRevision))
    )
      return invalidRequest(
        "The synchronization review operation input is invalid.",
      );
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          operationId: value.payload.operationId,
          ...(value.payload.expectedRevision === undefined
            ? {}
            : { expectedRevision: value.payload.expectedRevision }),
        },
      } as IpcRequest,
    };
  }
  if (value.type === "synchronization.review.worktree.action") {
    if (
      !hasExactKeys(
        value.payload,
        ["operationId", "actionId", "choice", "expectedRevision"],
        ["confirmed", "beforeSnapshotId", "afterSnapshotId"],
      ) ||
      !safeGithubIdentifier(value.payload.operationId) ||
      !safeGithubIdentifier(value.payload.actionId) ||
      !["CLEAR_ALL", "CLEAR_AI_ONLY", "KEEP_AND_CANCEL"].includes(
        String(value.payload.choice),
      ) ||
      !safeVersion(value.payload.expectedRevision) ||
      (value.payload.confirmed !== undefined &&
        typeof value.payload.confirmed !== "boolean") ||
      (value.payload.beforeSnapshotId !== undefined &&
        !safeGithubIdentifier(value.payload.beforeSnapshotId)) ||
      (value.payload.afterSnapshotId !== undefined &&
        !safeGithubIdentifier(value.payload.afterSnapshotId))
    )
      return invalidRequest("The synchronization worktree action is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          operationId: value.payload.operationId,
          actionId: value.payload.actionId,
          choice: value.payload.choice,
          expectedRevision: value.payload.expectedRevision,
          ...(value.payload.confirmed === undefined
            ? {}
            : { confirmed: value.payload.confirmed }),
          ...(value.payload.beforeSnapshotId === undefined
            ? {}
            : { beforeSnapshotId: value.payload.beforeSnapshotId }),
          ...(value.payload.afterSnapshotId === undefined
            ? {}
            : { afterSnapshotId: value.payload.afterSnapshotId }),
        },
      } as IpcRequest,
    };
  }
  if (value.type === "synchronization.review.reevaluate") {
    if (
      !hasExactKeys(
        value.payload,
        ["operationId", "expectedRevision", "actionId", "choice"],
        ["confirmed"],
      ) ||
      !safeGithubIdentifier(value.payload.operationId) ||
      !safeGithubIdentifier(value.payload.actionId) ||
      !safeVersion(value.payload.expectedRevision) ||
      !["CLEAR_ALL", "CLEAR_AI_ONLY", "KEEP_AND_CANCEL"].includes(
        String(value.payload.choice),
      ) ||
      (value.payload.confirmed !== undefined &&
        typeof value.payload.confirmed !== "boolean")
    )
      return invalidRequest(
        "The synchronization re-evaluation input is invalid.",
      );
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          operationId: value.payload.operationId,
          expectedRevision: value.payload.expectedRevision,
          actionId: value.payload.actionId,
          choice: value.payload.choice,
          ...(value.payload.confirmed === undefined
            ? {}
            : { confirmed: value.payload.confirmed }),
        },
      } as IpcRequest,
    };
  }
  if (value.type === "synchronization.review.discard") {
    if (
      !hasExactKeys(value.payload, ["operationId", "expectedRevision"]) ||
      !safeGithubIdentifier(value.payload.operationId) ||
      !safeVersion(value.payload.expectedRevision)
    )
      return invalidRequest("The synchronization discard input is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: value.payload,
      } as IpcRequest,
    };
  }
  if (value.type === "synchronization.review.publication.approve") {
    if (
      !hasExactKeys(value.payload, [
        "operationId",
        "expectedRevision",
        "approvalId",
        "idempotencyKey",
        "candidateHash",
        "commitMessage",
        "completeDiffAcknowledged",
        "noCodeChangeAcknowledged",
      ]) ||
      !safeGithubIdentifier(value.payload.operationId) ||
      !safeVersion(value.payload.expectedRevision) ||
      !safeGithubIdentifier(value.payload.approvalId) ||
      !safeGithubIdentifier(value.payload.idempotencyKey) ||
      !safeGithubIdentifier(value.payload.candidateHash) ||
      !safeManagedMultilineText(value.payload.commitMessage, 512) ||
      value.payload.completeDiffAcknowledged !== true ||
      typeof value.payload.noCodeChangeAcknowledged !== "boolean"
    )
      return invalidRequest(
        "The synchronization publication approval is invalid.",
      );
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          operationId: value.payload.operationId,
          expectedRevision: value.payload.expectedRevision,
          approvalId: value.payload.approvalId,
          idempotencyKey: value.payload.idempotencyKey,
          candidateHash: value.payload.candidateHash,
          commitMessage: value.payload.commitMessage,
          completeDiffAcknowledged: true,
          noCodeChangeAcknowledged: value.payload.noCodeChangeAcknowledged,
        },
      } as IpcRequest,
    };
  }
  if (
    value.type === "synchronization.review.publication.publish" ||
    value.type === "synchronization.review.publication.reconcile"
  ) {
    if (
      !hasExactKeys(value.payload, ["operationId", "idempotencyKey"]) ||
      !safeGithubIdentifier(value.payload.operationId) ||
      !safeGithubIdentifier(value.payload.idempotencyKey)
    )
      return invalidRequest(
        "The synchronization publication input is invalid.",
      );
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          operationId: value.payload.operationId,
          idempotencyKey: value.payload.idempotencyKey,
        },
      } as IpcRequest,
    };
  }
  if (
    value.type === "synchronization.result.read" ||
    value.type === "synchronization.operation.cancel"
  ) {
    if (
      !hasExactKeys(value.payload, ["operationId"]) ||
      !safeGithubIdentifier(value.payload.operationId)
    )
      return invalidRequest(
        "The synchronization operation identifier is invalid.",
      );
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: { operationId: value.payload.operationId },
      } as IpcRequest,
    };
  }
  if (value.type === "synchronization.conflict.retry") {
    if (
      !hasExactKeys(
        value.payload,
        ["operationId", "action"],
        ["expectedVersion"],
      ) ||
      !safeGithubIdentifier(value.payload.operationId) ||
      !f26RetryActionSchema.safeParse(value.payload.action).success ||
      (value.payload.expectedVersion !== undefined &&
        !safeVersion(value.payload.expectedVersion))
    )
      return invalidRequest(
        "The synchronization conflict retry request is invalid.",
      );
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          operationId: value.payload.operationId,
          action: f26RetryActionSchema.parse(value.payload.action),
          ...(value.payload.expectedVersion === undefined
            ? {}
            : { expectedVersion: value.payload.expectedVersion }),
        },
      } as IpcRequest,
    };
  }
  if (
    value.type === "managed-pr.read" ||
    value.type === "managed-pr.retry" ||
    value.type === "managed-pr.candidates"
  ) {
    const key = value.type === "managed-pr.retry" ? "attemptId" : "managedPrId";
    if (
      !hasExactKeys(value.payload, [key]) ||
      !safeGithubIdentifier(value.payload[key])
    )
      return invalidRequest("The managed-PR identifier is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: { [key]: value.payload[key] },
      } as IpcRequest,
    };
  }
  if (value.type === "managed-pr.add") {
    if (
      !hasExactKeys(
        value.payload,
        ["serverId", "url"],
        ["context", "syncSourceBranchOverride", "localClonePath"],
      ) ||
      !safeGithubIdentifier(value.payload.serverId) ||
      !safeManagedMultilineText(value.payload.url, 2_048) ||
      (value.payload.context !== undefined &&
        !safeManagedMultilineText(value.payload.context, 32 * 1024)) ||
      (value.payload.syncSourceBranchOverride !== undefined &&
        !safeManagedMultilineText(
          value.payload.syncSourceBranchOverride,
          255,
        )) ||
      (value.payload.localClonePath !== undefined &&
        !safeManagedPath(value.payload.localClonePath))
    )
      return invalidRequest("The managed-PR add request is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          serverId: value.payload.serverId,
          url: value.payload.url,
          ...(value.payload.context === undefined
            ? {}
            : { context: value.payload.context }),
          ...(value.payload.syncSourceBranchOverride === undefined
            ? {}
            : {
                syncSourceBranchOverride:
                  value.payload.syncSourceBranchOverride,
              }),
          ...(value.payload.localClonePath === undefined
            ? {}
            : { localClonePath: value.payload.localClonePath }),
        },
      },
    };
  }
  if (value.type === "managed-pr.clone.attach") {
    if (
      !hasExactKeys(value.payload, [
        "managedPrId",
        "expectedVersion",
        "path",
      ]) ||
      !safeGithubIdentifier(value.payload.managedPrId) ||
      !safeVersion(value.payload.expectedVersion) ||
      !safeManagedPath(value.payload.path)
    )
      return invalidRequest(
        "The managed-PR clone attachment request is invalid.",
      );
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          managedPrId: value.payload.managedPrId,
          expectedVersion: value.payload.expectedVersion,
          path: value.payload.path,
        },
      },
    };
  }
  if (value.type === "managed-pr.clone.clear") {
    if (
      !hasExactKeys(value.payload, ["managedPrId", "expectedVersion"]) ||
      !safeGithubIdentifier(value.payload.managedPrId) ||
      !safeVersion(value.payload.expectedVersion)
    )
      return invalidRequest(
        "The managed-PR clone clearing request is invalid.",
      );
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          managedPrId: value.payload.managedPrId,
          expectedVersion: value.payload.expectedVersion,
        },
      },
    };
  }
  if (value.type === "managed-pr.configuration.save") {
    if (
      !hasExactKeys(value.payload, [
        "managedPrId",
        "expectedVersion",
        "context",
        "syncSourceBranchOverride",
      ]) ||
      !safeGithubIdentifier(value.payload.managedPrId) ||
      !safeVersion(value.payload.expectedVersion) ||
      !safeManagedMultilineText(value.payload.context, 32 * 1024) ||
      !safeManagedMultilineText(value.payload.syncSourceBranchOverride, 255)
    )
      return invalidRequest("The managed-PR configuration request is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          managedPrId: value.payload.managedPrId,
          expectedVersion: value.payload.expectedVersion,
          context: value.payload.context,
          syncSourceBranchOverride: value.payload.syncSourceBranchOverride,
        },
      },
    };
  }
  if (value.type === "inbox.navigate") {
    if (
      !hasExactKeys(value.payload, ["managedPrId", "destination"]) ||
      !safeGithubIdentifier(value.payload.managedPrId) ||
      !["details", "settings"].includes(String(value.payload.destination))
    )
      return invalidRequest("The managed-PR navigation request is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          managedPrId: value.payload.managedPrId,
          destination: value.payload.destination as "details" | "settings",
        },
      },
    };
  }
  if (value.type === "activity.query" || value.type === "activity.subscribe") {
    try {
      const query = normalizeActivityQuery(value.payload as ActivityQuery);
      return {
        ok: true,
        value: { ...base, type: value.type, payload: query },
      };
    } catch {
      return invalidRequest(
        "The activity query is invalid or outside its bounded contract.",
      );
    }
  }
  if (value.type === "activity.navigate") {
    if (
      !hasExactKeys(value.payload, ["eventId"]) ||
      !safeGithubIdentifier(value.payload.eventId)
    )
      return invalidRequest("The activity event identifier is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: { eventId: value.payload.eventId },
      },
    };
  }
  if (value.type === "review-bundle.read") {
    if (
      !hasExactKeys(value.payload, ["bundleId"]) ||
      !safeGithubIdentifier(value.payload.bundleId)
    )
      return invalidRequest("The Review Bundle identifier is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: { bundleId: value.payload.bundleId },
      },
    };
  }
  if (value.type === "review-bundle.publication.read") {
    if (
      !hasExactKeys(value.payload, ["bundleId"]) ||
      !safeGithubIdentifier(value.payload.bundleId)
    )
      return invalidRequest(
        "The Review Bundle publication identifier is invalid.",
      );
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: { bundleId: value.payload.bundleId },
      },
    };
  }
  if (value.type === "review-bundle.publication.approve") {
    if (!isF23ApprovalInput(value.payload))
      return invalidRequest(
        "The Review Bundle publication approval is invalid.",
      );
    return {
      ok: true,
      value: { ...base, type: value.type, payload: value.payload },
    };
  }
  if (
    value.type === "review-bundle.publication.publish" ||
    value.type === "review-bundle.publication.reconcile" ||
    value.type === "review-bundle.publication.retry-responses" ||
    value.type === "review-bundle.publication.discard"
  ) {
    if (!isF23PublicationInput(value.payload))
      return invalidRequest(
        "The Review Bundle publication request is invalid.",
      );
    return {
      ok: true,
      value: { ...base, type: value.type, payload: value.payload },
    };
  }
  if (value.type === "review-bundle.f22.reconcile") {
    if (
      !hasExactKeys(value.payload, ["bundleId"]) ||
      !safeGithubIdentifier(value.payload.bundleId)
    )
      return invalidRequest(
        "The Review Bundle reconciliation identifier is invalid.",
      );
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: { bundleId: value.payload.bundleId },
      },
    };
  }
  if (value.type === "review-bundle.diff.read") {
    if (
      !hasExactKeys(value.payload, ["bundleId", "mode"], ["itemId"]) ||
      !safeGithubIdentifier(value.payload.bundleId) ||
      !f20DiffModeSchema.safeParse(value.payload.mode).success ||
      (value.payload.itemId !== undefined &&
        !safeGithubIdentifier(value.payload.itemId))
    )
      return invalidRequest("The Review Bundle diff request is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          bundleId: value.payload.bundleId,
          mode: value.payload.mode as F20DiffMode,
          ...(value.payload.itemId === undefined
            ? {}
            : { itemId: value.payload.itemId }),
        },
      },
    };
  }
  if (value.type === "review-bundle.decision.record") {
    const decision = value.payload.decision;
    const finalDisposition = value.payload.finalDisposition;
    if (
      !hasExactKeys(
        value.payload,
        ["bundleId", "itemId", "decision", "finalDisposition"],
        ["instruction", "answer", "expectedVersion", "actionId"],
      ) ||
      !safeGithubIdentifier(value.payload.bundleId) ||
      !safeGithubIdentifier(value.payload.itemId) ||
      !["accepted", "overridden"].includes(String(decision)) ||
      !["fixed", "pushback", "question", "no_change"].includes(
        String(finalDisposition),
      ) ||
      (value.payload.instruction !== undefined &&
        !safeManagedMultilineText(value.payload.instruction, 64 * 1024)) ||
      (value.payload.answer !== undefined &&
        !safeManagedMultilineText(value.payload.answer, 64 * 1024)) ||
      (value.payload.expectedVersion !== undefined &&
        !safeVersion(value.payload.expectedVersion)) ||
      (value.payload.actionId !== undefined &&
        !safeGithubIdentifier(value.payload.actionId))
    )
      return invalidRequest("The Review Bundle decision request is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          bundleId: value.payload.bundleId,
          itemId: value.payload.itemId,
          decision: decision as "accepted" | "overridden",
          finalDisposition: finalDisposition as
            "fixed" | "pushback" | "question" | "no_change",
          ...(value.payload.instruction === undefined
            ? {}
            : { instruction: value.payload.instruction }),
          ...(value.payload.answer === undefined
            ? {}
            : { answer: value.payload.answer }),
          ...(value.payload.expectedVersion === undefined
            ? {}
            : { expectedVersion: value.payload.expectedVersion }),
          ...(value.payload.actionId === undefined
            ? {}
            : { actionId: value.payload.actionId }),
        },
      },
    };
  }
  if (value.type === "review-bundle.decisions.confirm") {
    if (
      !hasExactKeys(
        value.payload,
        ["bundleId"],
        ["expectedVersion", "actionId"],
      ) ||
      !safeGithubIdentifier(value.payload.bundleId) ||
      (value.payload.expectedVersion !== undefined &&
        !safeVersion(value.payload.expectedVersion)) ||
      (value.payload.actionId !== undefined &&
        !safeGithubIdentifier(value.payload.actionId))
    )
      return invalidRequest(
        "The Review Bundle confirmation request is invalid.",
      );
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          bundleId: value.payload.bundleId,
          ...(value.payload.expectedVersion === undefined
            ? {}
            : { expectedVersion: value.payload.expectedVersion }),
          ...(value.payload.actionId === undefined
            ? {}
            : { actionId: value.payload.actionId }),
        },
      },
    };
  }
  if (value.type === "review-bundle.draft.save") {
    if (
      !hasExactKeys(
        value.payload,
        ["bundleId", "eventVersionId", "text"],
        ["expectedVersion", "actionId"],
      ) ||
      !safeGithubIdentifier(value.payload.bundleId) ||
      !safeGithubIdentifier(value.payload.eventVersionId) ||
      !safeManagedMultilineText(value.payload.text, 64 * 1024) ||
      value.payload.text.trim().length === 0 ||
      (value.payload.expectedVersion !== undefined &&
        !safeVersion(value.payload.expectedVersion)) ||
      (value.payload.actionId !== undefined &&
        !safeGithubIdentifier(value.payload.actionId))
    )
      return invalidRequest("The Review Bundle draft request is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          bundleId: value.payload.bundleId,
          eventVersionId: value.payload.eventVersionId,
          text: value.payload.text,
          ...(value.payload.expectedVersion === undefined
            ? {}
            : { expectedVersion: value.payload.expectedVersion }),
          ...(value.payload.actionId === undefined
            ? {}
            : { actionId: value.payload.actionId }),
        },
      },
    };
  }
  if (value.type === "review-bundle.worktree.refresh") {
    if (
      !hasExactKeys(value.payload, ["bundleId"], ["expectedVersion"]) ||
      !safeGithubIdentifier(value.payload.bundleId) ||
      (value.payload.expectedVersion !== undefined &&
        !safeVersion(value.payload.expectedVersion))
    )
      return invalidRequest("The Review Bundle refresh request is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          bundleId: value.payload.bundleId,
          ...(value.payload.expectedVersion === undefined
            ? {}
            : { expectedVersion: value.payload.expectedVersion }),
        },
      },
    };
  }
  if (value.type === "review-bundle.discard.preview") {
    if (
      !hasExactKeys(
        value.payload,
        ["bundleId", "idempotencyKey"],
        ["expectedGateRevision"],
      ) ||
      !safeGithubIdentifier(value.payload.bundleId) ||
      !safeGithubIdentifier(value.payload.idempotencyKey) ||
      (value.payload.expectedGateRevision !== undefined &&
        !safeVersion(value.payload.expectedGateRevision))
    )
      return invalidRequest("The F22 discard preview request is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          bundleId: value.payload.bundleId,
          idempotencyKey: value.payload.idempotencyKey,
          ...(value.payload.expectedGateRevision === undefined
            ? {}
            : { expectedGateRevision: value.payload.expectedGateRevision }),
        },
      },
    };
  }
  if (value.type === "review-bundle.discard.confirm") {
    if (
      !hasExactKeys(
        value.payload,
        ["actionId", "bundleId", "choice"],
        ["confirmed", "expectedActionVersion", "expectedGateRevision"],
      ) ||
      !safeGithubIdentifier(value.payload.actionId) ||
      !safeGithubIdentifier(value.payload.bundleId) ||
      !f22DirtyWorktreeChoiceSchema.safeParse(value.payload.choice).success ||
      (value.payload.confirmed !== undefined &&
        typeof value.payload.confirmed !== "boolean") ||
      (value.payload.expectedActionVersion !== undefined &&
        !safeVersion(value.payload.expectedActionVersion)) ||
      (value.payload.expectedGateRevision !== undefined &&
        !safeVersion(value.payload.expectedGateRevision))
    )
      return invalidRequest("The F22 discard confirmation request is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          actionId: value.payload.actionId,
          bundleId: value.payload.bundleId,
          choice: value.payload.choice as
            "NO_CHANGES" | "CLEAR_ALL" | "CLEAR_AI_ONLY" | "KEEP_AND_CANCEL",
          ...(value.payload.confirmed === undefined
            ? {}
            : { confirmed: value.payload.confirmed }),
          ...(value.payload.expectedActionVersion === undefined
            ? {}
            : { expectedActionVersion: value.payload.expectedActionVersion }),
          ...(value.payload.expectedGateRevision === undefined
            ? {}
            : { expectedGateRevision: value.payload.expectedGateRevision }),
        },
      },
    };
  }
  if (value.type === "review-bundle.reevaluate.preview") {
    const retained = value.payload.selectedRetainedEventVersionIds;
    if (
      !hasExactKeys(
        value.payload,
        ["bundleId", "idempotencyKey"],
        ["selectedRetainedEventVersionIds", "expectedGateRevision"],
      ) ||
      !safeGithubIdentifier(value.payload.bundleId) ||
      !safeGithubIdentifier(value.payload.idempotencyKey) ||
      (retained !== undefined &&
        (!Array.isArray(retained) ||
          retained.length > 256 ||
          retained.some((item) => !safeGithubIdentifier(item)))) ||
      (value.payload.expectedGateRevision !== undefined &&
        !safeVersion(value.payload.expectedGateRevision))
    )
      return invalidRequest(
        "The F22 re-evaluation preview request is invalid.",
      );
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          bundleId: value.payload.bundleId,
          idempotencyKey: value.payload.idempotencyKey,
          ...(retained === undefined
            ? {}
            : { selectedRetainedEventVersionIds: retained }),
          ...(value.payload.expectedGateRevision === undefined
            ? {}
            : { expectedGateRevision: value.payload.expectedGateRevision }),
        },
      },
    };
  }
  if (value.type === "review-bundle.reevaluate.confirm") {
    if (
      !hasExactKeys(
        value.payload,
        ["actionId", "bundleId", "choice"],
        ["confirmed", "expectedActionVersion", "expectedGateRevision"],
      ) ||
      !safeGithubIdentifier(value.payload.actionId) ||
      !safeGithubIdentifier(value.payload.bundleId) ||
      !f22DirtyWorktreeChoiceSchema.safeParse(value.payload.choice).success ||
      (value.payload.confirmed !== undefined &&
        typeof value.payload.confirmed !== "boolean") ||
      (value.payload.expectedActionVersion !== undefined &&
        !safeVersion(value.payload.expectedActionVersion)) ||
      (value.payload.expectedGateRevision !== undefined &&
        !safeVersion(value.payload.expectedGateRevision))
    )
      return invalidRequest(
        "The F22 re-evaluation confirmation request is invalid.",
      );
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          actionId: value.payload.actionId,
          bundleId: value.payload.bundleId,
          choice: value.payload.choice as
            "NO_CHANGES" | "CLEAR_ALL" | "CLEAR_AI_ONLY" | "KEEP_AND_CANCEL",
          ...(value.payload.confirmed === undefined
            ? {}
            : { confirmed: value.payload.confirmed }),
          ...(value.payload.expectedActionVersion === undefined
            ? {}
            : { expectedActionVersion: value.payload.expectedActionVersion }),
          ...(value.payload.expectedGateRevision === undefined
            ? {}
            : { expectedGateRevision: value.payload.expectedGateRevision }),
        },
      },
    };
  }
  if (value.type === "review-bundle.path-action") {
    if (
      !hasExactKeys(
        value.payload,
        ["bundleId", "action"],
        ["relativePath", "expectedVersion"],
      ) ||
      !safeGithubIdentifier(value.payload.bundleId) ||
      !["OPEN_WORKTREE", "OPEN_FILE", "REVEAL_FILE"].includes(
        String(value.payload.action),
      ) ||
      ((value.payload.action === "OPEN_FILE" ||
        value.payload.action === "REVEAL_FILE") &&
        (value.payload.relativePath === undefined ||
          !safeReviewBundleRelativePath(value.payload.relativePath))) ||
      (value.payload.action === "OPEN_WORKTREE" &&
        value.payload.relativePath !== undefined) ||
      (value.payload.expectedVersion !== undefined &&
        !safeVersion(value.payload.expectedVersion))
    )
      return invalidRequest("The Review Bundle path action is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          bundleId: value.payload.bundleId,
          action: value.payload.action as
            "OPEN_WORKTREE" | "OPEN_FILE" | "REVEAL_FILE",
          ...(value.payload.relativePath === undefined
            ? {}
            : { relativePath: value.payload.relativePath as string }),
          ...(value.payload.expectedVersion === undefined
            ? {}
            : { expectedVersion: value.payload.expectedVersion }),
        },
      },
    };
  }
  if (value.type === "review-bundle.conversation.read") {
    if (
      !hasExactKeys(value.payload, ["bundleId"]) ||
      !safeGithubIdentifier(value.payload.bundleId)
    )
      return invalidRequest("The Review conversation identifier is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: { bundleId: value.payload.bundleId },
      },
    };
  }
  if (
    value.type === "review-bundle.conversation.ask" ||
    value.type === "review-bundle.revision.request" ||
    value.type === "review-bundle.conversation.start-new-operation"
  ) {
    const parsed = f21UserIntentSchema.safeParse(value.payload);
    if (
      !parsed.success ||
      parsed.data.mode !==
        (value.type === "review-bundle.conversation.ask"
          ? "READ_ONLY_CONVERSATION"
          : "REVIEW_REVISION")
    )
      return invalidRequest(
        "The explicit Review conversation intent is invalid.",
      );
    return {
      ok: true,
      value: { ...base, type: value.type, payload: parsed.data },
    };
  }
  if (value.type === "review-bundle.proposal-input.save") {
    const parsed = f21ProposalInputSchema.safeParse(value.payload);
    if (!parsed.success)
      return invalidRequest("The proposal entry input is invalid.");
    return {
      ok: true,
      value: { ...base, type: value.type, payload: parsed.data },
    };
  }
  if (value.type === "review-bundle.conversation.cancel") {
    if (
      !hasExactKeys(value.payload, ["bundleId"], ["operationId", "turnId"]) ||
      !safeGithubIdentifier(value.payload.bundleId) ||
      (value.payload.operationId !== undefined &&
        !safeGithubIdentifier(value.payload.operationId)) ||
      (value.payload.turnId !== undefined &&
        !safeGithubIdentifier(value.payload.turnId))
    )
      return invalidRequest(
        "The conversation cancellation request is invalid.",
      );
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          bundleId: value.payload.bundleId,
          ...(value.payload.operationId === undefined
            ? {}
            : { operationId: value.payload.operationId }),
          ...(value.payload.turnId === undefined
            ? {}
            : { turnId: value.payload.turnId }),
        },
      },
    };
  }
  if (value.type === "review-bundle.conversation.continue") {
    if (
      !hasExactKeys(
        value.payload,
        ["bundleId", "operationId"],
        ["selectedBudget", "expectedBundleVersion"],
      ) ||
      !safeGithubIdentifier(value.payload.bundleId) ||
      !safeGithubIdentifier(value.payload.operationId) ||
      (value.payload.selectedBudget !== undefined &&
        (typeof value.payload.selectedBudget !== "number" ||
          !Number.isSafeInteger(value.payload.selectedBudget) ||
          value.payload.selectedBudget < 1 ||
          value.payload.selectedBudget > 10)) ||
      (value.payload.expectedBundleVersion !== undefined &&
        !safeVersion(value.payload.expectedBundleVersion))
    )
      return invalidRequest(
        "The conversation continuation request is invalid.",
      );
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          bundleId: value.payload.bundleId as string,
          operationId: value.payload.operationId as string,
          ...(value.payload.selectedBudget === undefined
            ? {}
            : { selectedBudget: value.payload.selectedBudget as number }),
          ...(value.payload.expectedBundleVersion === undefined
            ? {}
            : {
                expectedBundleVersion: value.payload
                  .expectedBundleVersion as number,
              }),
        },
      },
    };
  }
  return invalidRequest("The IPC request type is not allowlisted.");
}

export function parseIpcResponse(value: unknown): value is IpcResponse {
  if (
    !isPlainRecord(value) ||
    !safeRequestId(value.requestId) ||
    value.schemaVersion !== IPC_SCHEMA_VERSION
  )
    return false;
  if (value.ok === true)
    return (
      hasExactKeys(value, ["schemaVersion", "requestId", "ok", "value"]) &&
      parseResponseValue(value.value)
    );
  if (value.ok !== false || !isPlainRecord(value.error)) return false;
  return (
    hasExactKeys(value.error, ["code", "message", "correlationId"]) &&
    [
      "INVALID_REQUEST",
      "UNKNOWN_CHANNEL",
      "UNAUTHORIZED",
      "HANDLER_FAILED",
      "NOT_READY",
      "SHUTDOWN_IN_PROGRESS",
      "HANDOFF_RECOVERY_REQUIRED",
      "SERVICE_START_FAILED",
      "SERVICE_STOP_FAILED",
      "SERVICE_STOP_TIMEOUT",
      "SERVICE_HANDOFF_TIMEOUT",
      "CONFIGURATION_ERROR",
    ].includes(String(value.error.code)) &&
    safeText(value.error.message, 1_024) &&
    safeRequestId(value.error.correlationId)
  );
}

export function parseIpcOpenTargetEvent(
  value: unknown,
): value is IpcOpenTargetEvent {
  if (
    !isPlainRecord(value) ||
    value.schemaVersion !== IPC_SCHEMA_VERSION ||
    value.type !== "open-target"
  )
    return false;
  return parseOpenTargetRecord(value.target).ok;
}

export function parseIpcInboxUpdateEvent(
  value: unknown,
): value is IpcInboxUpdateEvent {
  if (
    !isPlainRecord(value) ||
    value.schemaVersion !== IPC_SCHEMA_VERSION ||
    value.type !== "inbox-update"
  )
    return false;
  return (
    hasExactKeys(value, ["schemaVersion", "type", "snapshot"]) &&
    isManagedPrInboxReadModel(value.snapshot)
  );
}

export function parseIpcActivityUpdateEvent(
  value: unknown,
): value is IpcActivityUpdateEvent {
  return isActivityUpdateEvent(value);
}

export function boundedIpcResponse(value: IpcResponse): IpcResponse {
  try {
    if (
      byteLength(JSON.stringify(value)) <= IPC_MAX_RESPONSE_BYTES &&
      parseIpcResponse(value)
    )
      return value;
  } catch {
    // Fall through to the fixed safe error response.
  }
  return {
    schemaVersion: IPC_SCHEMA_VERSION,
    requestId: value.requestId,
    ok: false,
    error: {
      code: "HANDLER_FAILED",
      message: "The response was not safe to deliver across the IPC boundary.",
      correlationId: "ipc-response-invalid",
    },
  };
}

export interface PrMonitorPreloadApi {
  readonly ready: () => Promise<IpcResponse>;
  readonly readCurrentState: () => Promise<IpcResponse>;
  readonly getLifecycleStatus: () => Promise<IpcResponse>;
  readonly requestShutdown: () => Promise<IpcResponse>;
  readonly readRecovery: () => Promise<IpcResponse>;
  readonly requestRecovery: () => Promise<IpcResponse>;
  readonly readScheduler: () => Promise<IpcResponse>;
  readonly saveSchedulerConfiguration: (
    input: F12SchedulerConfigurationInput & {
      readonly expectedRevision?: number;
    },
  ) => Promise<IpcResponse>;
  readonly checkSchedulerNow: (managedPrId?: string) => Promise<IpcResponse>;
  readonly pauseWatching: (expectedRevision?: number) => Promise<IpcResponse>;
  readonly resumeWatching: (expectedRevision?: number) => Promise<IpcResponse>;
  readonly readPreferences: () => Promise<IpcResponse>;
  readonly saveTaskProfile: (
    input: F16TaskProfileSaveInput,
  ) => Promise<IpcResponse>;
  readonly savePolicy: (input: F16PolicySaveInput) => Promise<IpcResponse>;
  readonly saveOperationalPreferences: (
    input: F16OperationalSaveInput,
  ) => Promise<IpcResponse>;
  readonly saveCommonInstruction: (
    input: F16CommonInstructionSaveInput,
  ) => Promise<IpcResponse>;
  readonly deleteCommonInstruction: (
    input: F16CommonInstructionDeleteInput,
  ) => Promise<IpcResponse>;
  readonly saveCommonInstructionSelection: (
    input: F16CommonInstructionSelectionSaveInput,
  ) => Promise<IpcResponse>;
  readonly saveRepositoryPreferences: (
    input: F16RepositorySaveInput,
  ) => Promise<IpcResponse>;
  readonly readGithubSettings: () => Promise<IpcResponse>;
  readonly upsertGithubProfile: (
    input: GithubServerProfileInput,
  ) => Promise<IpcResponse>;
  readonly submitGithubCredential: (
    serverId: string,
    token: string,
  ) => Promise<IpcResponse>;
  readonly testGithubConnection: (serverId: string) => Promise<IpcResponse>;
  readonly retryGithubOperation: (operationId: string) => Promise<IpcResponse>;
  readonly cleanupGithubOperation: (
    operationId: string,
  ) => Promise<IpcResponse>;
  readonly removeGithubProfile: (serverId: string) => Promise<IpcResponse>;
  readonly readManagedPrs: () => Promise<IpcResponse>;
  readonly readManagedPr: (managedPrId: string) => Promise<IpcResponse>;
  readonly addManagedPr: (input: ManagedPrAddInput) => Promise<IpcResponse>;
  readonly retryManagedPrAdd: (attemptId: string) => Promise<IpcResponse>;
  readonly readManagedPrCandidates: (
    managedPrId: string,
  ) => Promise<IpcResponse>;
  readonly pickManagedPrFolder: () => Promise<IpcResponse>;
  readonly attachManagedPrClone: (
    input: ManagedPrCloneInput,
  ) => Promise<IpcResponse>;
  readonly clearManagedPrClone: (
    managedPrId: string,
    expectedVersion: number,
  ) => Promise<IpcResponse>;
  readonly saveManagedPrConfiguration: (
    input: ManagedPrConfigurationInput,
  ) => Promise<IpcResponse>;
  readonly readInbox: () => Promise<IpcResponse>;
  readonly subscribeInbox: () => Promise<IpcResponse>;
  readonly readSynchronizationSelection: () => Promise<IpcResponse>;
  readonly commandSynchronizationSelection: (
    input: F24SelectionCommandInput,
  ) => Promise<IpcResponse>;
  readonly resetSynchronizationSelection: () => Promise<IpcResponse>;
  readonly resolveSynchronization: () => Promise<IpcResponse>;
  readonly confirmSynchronizationPreparation: (
    resolutionRevision: string,
  ) => Promise<IpcResponse>;
  readonly readSynchronizationIntent: (
    intentId: string,
  ) => Promise<IpcResponse>;
  readonly listSynchronizationIntents: () => Promise<IpcResponse>;
  readonly reconcileSynchronizationIntent: (
    intentId: string,
  ) => Promise<IpcResponse>;
  readonly listSynchronizationBatches: () => Promise<IpcResponse>;
  readonly readSynchronizationBatch: (batchId: string) => Promise<IpcResponse>;
  readonly readSynchronizationResult: (
    operationId: string,
  ) => Promise<IpcResponse>;
  readonly retrySynchronizationConflict: (
    operationId: string,
    action: F26RetryAction,
    expectedVersion?: number,
  ) => Promise<IpcResponse>;
  readonly cancelSynchronizationOperation: (
    operationId: string,
  ) => Promise<IpcResponse>;
  readonly listSynchronizationReviews: () => Promise<IpcResponse>;
  readonly readSynchronizationReviewBatch: (
    batchId: string,
  ) => Promise<IpcResponse>;
  readonly readSynchronizationReviewResult: (
    operationId: string,
  ) => Promise<IpcResponse>;
  readonly refreshSynchronizationWorktree: (
    operationId: string,
    expectedRevision: number,
  ) => Promise<IpcResponse>;
  readonly actOnSynchronizationWorktree: (
    input: F27WorktreeActionInput,
  ) => Promise<IpcResponse>;
  readonly refreshSynchronizationFreshness: (
    input: F27FreshnessInput,
  ) => Promise<IpcResponse>;
  readonly reevaluateSynchronization: (
    input: F27ReevaluationInput,
  ) => Promise<IpcResponse>;
  readonly discardSynchronizationResult: (
    operationId: string,
    expectedRevision: number,
  ) => Promise<IpcResponse>;
  readonly readSynchronizationPublication: (
    operationId: string,
  ) => Promise<IpcResponse>;
  readonly approveSynchronizationPublication: (
    input: F27ApprovalInput,
  ) => Promise<IpcResponse>;
  readonly publishSynchronizationPublication: (
    input: F27PublicationInput,
  ) => Promise<IpcResponse>;
  readonly reconcileSynchronizationPublication: (
    input: F27PublicationInput,
  ) => Promise<IpcResponse>;
  readonly readActivity: (query?: ActivityQuery) => Promise<IpcResponse>;
  readonly subscribeActivity: (query?: ActivityQuery) => Promise<IpcResponse>;
  readonly navigateActivity: (eventId: string) => Promise<IpcResponse>;
  readonly navigateManagedPr: (
    managedPrId: string,
    destination: "details" | "settings",
  ) => Promise<IpcResponse>;
  readonly readReviewBundle: (bundleId: string) => Promise<IpcResponse>;
  readonly readReviewBundlePublication: (
    bundleId: string,
  ) => Promise<IpcResponse>;
  readonly approveReviewBundlePublication: (
    input: F23ApprovalInput,
  ) => Promise<IpcResponse>;
  readonly publishReviewBundlePublication: (
    input: F23PublicationInput,
  ) => Promise<IpcResponse>;
  readonly reconcileReviewBundlePublication: (
    input: F23PublicationInput,
  ) => Promise<IpcResponse>;
  readonly retryReviewBundleResponses: (
    input: F23PublicationInput,
  ) => Promise<IpcResponse>;
  readonly discardReviewBundlePublication: (
    input: F23PublicationInput,
  ) => Promise<IpcResponse>;
  readonly reconcileReviewBundleF22: (bundleId: string) => Promise<IpcResponse>;
  readonly readReviewBundleDiff: (
    bundleId: string,
    mode: F20DiffMode,
    itemId?: string,
  ) => Promise<IpcResponse>;
  readonly recordReviewBundleDecision: (
    input: F20DecisionCommandInput,
  ) => Promise<IpcResponse>;
  readonly confirmReviewBundleDecisions: (
    bundleId: string,
    expectedVersion?: number,
    actionId?: string,
  ) => Promise<IpcResponse>;
  readonly saveReviewBundleDraft: (
    input: F20DraftCommandInput,
  ) => Promise<IpcResponse>;
  readonly refreshReviewBundleWorktree: (
    bundleId: string,
    expectedVersion?: number,
  ) => Promise<IpcResponse>;
  readonly previewReviewBundleDiscard: (input: {
    readonly bundleId: string;
    readonly idempotencyKey: string;
    readonly expectedGateRevision?: number;
  }) => Promise<IpcResponse>;
  readonly confirmReviewBundleDiscard: (input: {
    readonly actionId: string;
    readonly bundleId: string;
    readonly choice:
      "NO_CHANGES" | "CLEAR_ALL" | "CLEAR_AI_ONLY" | "KEEP_AND_CANCEL";
    readonly confirmed?: boolean;
    readonly expectedActionVersion?: number;
    readonly expectedGateRevision?: number;
  }) => Promise<IpcResponse>;
  readonly previewReviewBundleReevaluation: (input: {
    readonly bundleId: string;
    readonly idempotencyKey: string;
    readonly selectedRetainedEventVersionIds?: readonly string[];
    readonly expectedGateRevision?: number;
  }) => Promise<IpcResponse>;
  readonly confirmReviewBundleReevaluation: (input: {
    readonly actionId: string;
    readonly bundleId: string;
    readonly choice:
      "NO_CHANGES" | "CLEAR_ALL" | "CLEAR_AI_ONLY" | "KEEP_AND_CANCEL";
    readonly confirmed?: boolean;
    readonly expectedActionVersion?: number;
    readonly expectedGateRevision?: number;
  }) => Promise<IpcResponse>;
  readonly reviewBundlePathAction: (
    input: F20PathActionInput,
  ) => Promise<IpcResponse>;
  readonly readReviewBundleConversation: (
    bundleId: string,
  ) => Promise<IpcResponse>;
  readonly askReviewBundleConversation: (
    input: F21UserIntent,
  ) => Promise<IpcResponse>;
  readonly requestReviewBundleRevision: (
    input: F21UserIntent,
  ) => Promise<IpcResponse>;
  readonly startNewReviewBundleOperation: (
    input: F21UserIntent,
  ) => Promise<IpcResponse>;
  readonly saveReviewBundleProposalInput: (
    input: F21ProposalEntryInput,
  ) => Promise<IpcResponse>;
  readonly cancelReviewBundleConversation: (input: {
    readonly bundleId: string;
    readonly operationId?: string;
    readonly turnId?: string;
  }) => Promise<IpcResponse>;
  readonly continueReviewBundleConversation: (input: {
    readonly bundleId: string;
    readonly operationId: string;
    readonly selectedBudget?: number;
    readonly expectedBundleVersion?: number;
  }) => Promise<IpcResponse>;
  readonly onOpenTarget: (listener: (target: OpenTarget) => void) => () => void;
  readonly onInboxUpdated: (
    listener: (snapshot: ManagedPrInboxReadModel) => void,
  ) => () => void;
  readonly onActivityUpdated: (
    listener: (event: ActivityEventView) => void,
  ) => () => void;
}

declare global {
  interface Window {
    readonly prmonitor?: PrMonitorPreloadApi;
  }
}
