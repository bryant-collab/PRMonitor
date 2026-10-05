import type {
  ActivityEventRecord,
  ActivityEventType,
  ActivityStage,
} from "./activity";

export type ActivityScope = "PR_WORK" | "APPLICATION" | "UNKNOWN";
export const PR_ACTIVITY_OWNERS = [
  "MANAGED_PR",
  "REVIEW_BUNDLE",
  "SYNCHRONIZATION",
  "SYNCHRONIZATION_RESULT",
  "AI_WORK_OPERATION",
  "managed_pr",
  "review_bundle",
  "sync_operation",
  "ai_operation",
  "publication",
] as const;
export const PR_ACTIVITY_STAGES: readonly ActivityStage[] = [
  "POLLING",
  "BATCHING",
  "REVIEW",
  "AI",
  "VALIDATION",
  "SYNCHRONIZATION",
  "PUBLICATION",
  "GIT",
  "WORKTREE",
];
export const PR_ACTIVITY_TYPES: readonly ActivityEventType[] = [
  "POLL_STARTED",
  "POLL_PROGRESS",
  "POLL_COMPLETED",
  "POLL_FAILED",
  "BATCH_STARTED",
  "BATCH_WAITING",
  "BATCH_COMPLETED",
  "AI_TURN_STARTED",
  "AI_TURN_COMPLETED",
  "AI_TURN_FAILED",
  "VALIDATION_STARTED",
  "VALIDATION_COMPLETED",
  "VALIDATION_FAILED",
  "SYNC_STARTED",
  "SYNC_COMPLETED",
  "SYNC_FAILED",
  "PUBLICATION_INTENT",
  "PUBLICATION_ATTEMPTED",
  "PUBLICATION_SUCCEEDED",
  "PUBLICATION_FAILED",
  "PUBLICATION_UNKNOWN_OUTCOME",
  "PUBLICATION_RECONCILED",
];
export const APPLICATION_ACTIVITY_STAGES: readonly ActivityStage[] = [
  "LIFECYCLE",
  "NOTIFICATION",
  "RECOVERY",
  "RETENTION",
];
export const APPLICATION_ACTIVITY_TYPES: readonly ActivityEventType[] = [
  "LIFECYCLE_STARTED",
  "LIFECYCLE_COMPLETED",
  "LIFECYCLE_FAILED",
  "RECOVERY_STARTED",
  "RECOVERY_COMPLETED",
  "RECOVERY_FAILED",
  "ACTIVITY_RETENTION_COMPLETED",
  "ACTIVITY_RETENTION_FAILED",
];

/** Session and operation UUIDs carry correlation, never scope authority. */
export function activityScope(event: ActivityEventRecord): ActivityScope {
  if (
    event.managedPrId !== undefined ||
    event.workItem !== undefined ||
    (event.relatedTarget !== undefined &&
      event.relatedTarget.kind !== "HOME") ||
    (event.owner !== undefined &&
      PR_ACTIVITY_OWNERS.some((value) => value === event.owner?.type)) ||
    PR_ACTIVITY_STAGES.includes(event.stage) ||
    PR_ACTIVITY_TYPES.includes(event.eventType) ||
    PR_ACTIVITY_TYPES.some((type) => type === event.reason.code)
  )
    return "PR_WORK";
  if (
    event.owner?.type === "APPLICATION_LIFECYCLE" ||
    event.owner?.type === "APPLICATION" ||
    APPLICATION_ACTIVITY_STAGES.includes(event.stage) ||
    APPLICATION_ACTIVITY_TYPES.includes(event.eventType) ||
    APPLICATION_ACTIVITY_TYPES.some((type) => type === event.reason.code) ||
    event.reason.code === "LIFECYCLE_RUNNING" ||
    event.reason.code === "LIFECYCLE_STARTING"
  )
    return "APPLICATION";
  return "UNKNOWN";
}

export interface ActivityPresentation {
  readonly summary: string;
  readonly explanation?: string;
  readonly nextAction?: string;
  readonly needsAttention?: boolean;
}
const text = (
  summary: string,
  explanation?: string,
  nextAction?: string,
  needsAttention = false,
): ActivityPresentation => ({
  summary,
  ...(explanation === undefined ? {} : { explanation }),
  ...(nextAction === undefined ? {} : { nextAction }),
  ...(needsAttention ? { needsAttention } : {}),
});

/** Customer prose is a closed mapping. Producer strings remain redacted support evidence. */
export function presentActivity(
  event: ActivityEventRecord,
): ActivityPresentation {
  if (event.reason.code === "LIFECYCLE_RUNNING")
    return text(
      "PRMonitor started.",
      "PRMonitor can keep working when you close this window.",
    );
  if (event.reason.code === "LIFECYCLE_STARTING")
    return text("PRMonitor is starting.");
  if (event.details.trayAvailable === true)
    return text(
      "PRMonitor icon is ready.",
      "Use the icon in the taskbar notification area to open PRMonitor.",
    );
  if (event.details.trayAvailable === false)
    return text(
      "PRMonitor could not show its taskbar icon.",
      "Keep this window open so you can access PRMonitor.",
      "Open Connection and work status for details.",
      true,
    );
  const recoveryReason = event.details.f28ReasonCode;
  if (recoveryReason === "NETWORK_OFFLINE")
    return text(
      "PRMonitor is waiting for an internet connection.",
      undefined,
      "Check your connection. PRMonitor will check again when the connection returns.",
      true,
    );
  if (typeof event.details.f28Event === "string") {
    switch (event.details.f28Event) {
      case "SESSION_STARTED":
        return text("PRMonitor is checking interrupted work.");
      case "SESSION_COMPLETED":
        return event.details.f28ReasonCode === "RECOVERY_ATTENTION_REQUIRED"
          ? text(
              "Some interrupted work needs your attention.",
              "PRMonitor kept the saved work for inspection.",
              "Open Connection and work status.",
              true,
            )
          : text("PRMonitor finished checking interrupted work.");
      case "UNCERTAIN":
        return text(
          "The outcome of saved work is not known.",
          "PRMonitor kept the evidence for inspection.",
          "Open the related work to check its outcome.",
          true,
        );
      case "BLOCKED":
        return text(
          "PRMonitor could not continue saved work.",
          "The saved work remains available.",
          "Open the related work to see the permitted next action.",
          true,
        );
      case "RETRY_SCHEDULED":
        return text("PRMonitor will check saved work again.");
      default:
        return text(
          "PRMonitor checked saved work.",
          "Open support details for the recorded result.",
        );
    }
  }
  switch (event.reason.code) {
    case "SHUTDOWN_REQUESTED":
    case "SHUTDOWN_INTENT_COMMITTED":
      return text("PRMonitor is shutting down.");
    case "SHUTDOWN_COMPLETE":
      return text("PRMonitor shut down.");
    case "SERVICE_HANDOFF_STARTED":
      return text("PRMonitor is saving work before shutdown.");
    case "SERVICE_START_FAILED":
      return text(
        "PRMonitor could not start a background service.",
        undefined,
        "Open Setup to check local tools and storage.",
        true,
      );
    case "SERVICE_HANDOFF_FAILED":
    case "SERVICE_HANDOFF_TIMEOUT":
    case "SERVICE_STOP_FAILED":
    case "SERVICE_STOP_TIMEOUT":
    case "INCOMPLETE_LIFECYCLE_HANDOFF":
      return text(
        "PRMonitor did not finish shutting down normally.",
        "Saved work is available for inspection.",
        "Open Connection and work status.",
        true,
      );
  }
  const family: Record<ActivityEventType, ActivityPresentation> = {
    OPERATION_STARTED: text("Work started."),
    OPERATION_WAITING: text("Work is waiting."),
    OPERATION_PROGRESS: text(
      "PRMonitor recorded a work update.",
      "Open support details for the recorded result.",
    ),
    OPERATION_SUCCEEDED: text("Work finished."),
    OPERATION_FAILED: text(
      "Work failed.",
      "PRMonitor kept the recorded evidence.",
      "Open the related work to see the permitted next action.",
      true,
    ),
    OPERATION_CANCELLED: text("Work was cancelled."),
    OPERATION_RETRYING: text("PRMonitor is trying eligible work again."),
    OPERATION_UNKNOWN_OUTCOME: text(
      "The work outcome is not known.",
      undefined,
      "Open the related work to check its outcome.",
      true,
    ),
    OPERATION_RECONCILED: text("PRMonitor checked the saved work outcome."),
    POLL_STARTED: text("PRMonitor started checking pull requests."),
    POLL_PROGRESS: text("PRMonitor recorded pull request information."),
    POLL_COMPLETED: text("PRMonitor finished checking pull requests."),
    POLL_FAILED: text(
      "PRMonitor could not finish checking pull requests.",
      "This does not prove that your token is invalid.",
      "Check Connection and work status.",
      true,
    ),
    BATCH_STARTED: text("PRMonitor grouped feedback for review."),
    BATCH_WAITING: text("PRMonitor is waiting before reviewing new feedback."),
    BATCH_COMPLETED: text("PRMonitor finished preparing the feedback group."),
    AI_TURN_STARTED: text("AI work started."),
    AI_TURN_COMPLETED: text(
      "An AI turn finished.",
      "Review the saved work and validation results.",
    ),
    AI_TURN_FAILED: text(
      "AI work stopped.",
      "The saved work remains available.",
      "Open the related work to inspect it before continuing.",
      true,
    ),
    VALIDATION_STARTED: text("Validation started."),
    VALIDATION_COMPLETED: text(
      "Validation finished.",
      "Open the related work to see the check results.",
    ),
    VALIDATION_FAILED: text(
      "Validation could not finish.",
      undefined,
      "Open the related work to inspect the failed checks.",
      true,
    ),
    NOTIFICATION_SENT: text("PRMonitor sent a notification."),
    NOTIFICATION_FAILED: text(
      "PRMonitor could not send a notification.",
      "You can inspect the saved work in PRMonitor.",
      "Open the PR inbox.",
      true,
    ),
    SYNC_STARTED: text("Branch synchronization started."),
    SYNC_COMPLETED: text(
      "Branch synchronization finished.",
      "Review the saved result before publishing changes.",
    ),
    SYNC_FAILED: text(
      "Branch synchronization stopped.",
      "The saved work remains available.",
      "Open the branch synchronization result.",
      true,
    ),
    PUBLICATION_INTENT: text(
      "PRMonitor recorded approved changes for publication.",
    ),
    PUBLICATION_ATTEMPTED: text(
      "PRMonitor attempted to publish approved changes.",
      "This event does not confirm the remote outcome.",
    ),
    PUBLICATION_SUCCEEDED: text("PRMonitor published approved changes."),
    PUBLICATION_FAILED: text(
      "PRMonitor could not finish publishing approved changes.",
      undefined,
      "Open the publication result before trying again.",
      true,
    ),
    PUBLICATION_UNKNOWN_OUTCOME: text(
      "The publication outcome is not known.",
      undefined,
      "Open the publication result to check its outcome before trying again.",
      true,
    ),
    PUBLICATION_RECONCILED: text(
      "PRMonitor checked the publication outcome.",
      "Open the publication result for the confirmed outcome.",
    ),
    LIFECYCLE_STARTED: text("PRMonitor started a background check."),
    LIFECYCLE_COMPLETED: text("PRMonitor finished a background check."),
    LIFECYCLE_FAILED: text(
      "PRMonitor could not finish a background check.",
      undefined,
      "Open Connection and work status.",
      true,
    ),
    RECOVERY_STARTED: text("PRMonitor is checking interrupted work."),
    RECOVERY_COMPLETED: text("PRMonitor finished checking interrupted work."),
    RECOVERY_FAILED: text(
      "PRMonitor could not finish checking interrupted work.",
      "Saved work remains available.",
      "Open Connection and work status.",
      true,
    ),
    ACTIVITY_RETENTION_COMPLETED: text(
      "PRMonitor checked activity history limits.",
    ),
    ACTIVITY_RETENTION_FAILED: text(
      "PRMonitor could not check activity history limits.",
      undefined,
      "Refresh activity. If the problem continues, export support diagnostics.",
      true,
    ),
    LEGACY_ACTIVITY: text(
      "PRMonitor recorded an event.",
      "Open support details for more information.",
    ),
  };
  return (
    (event.eventType === "LEGACY_ACTIVITY" && event.reason.code in family
      ? family[event.reason.code as ActivityEventType]
      : family[event.eventType]) ??
    text(
      "PRMonitor recorded an event.",
      "Open support details for more information.",
    )
  );
}
