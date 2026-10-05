# Customer message review

The previous viewer promoted producer summary and generic what/why/next-action prose. The closed presentation boundary now renders the catalog below and keeps original safe event facts in explicitly labeled raw support data. This table is generated from the actual presentation function using deliberately poisoned producer prose. Tests cover all 42 types plus legacy/unknown and recovery outcomes. Native screen-reader disclosure verification is pending.

| Event family | Before | Current customer prose |
| --- | --- | --- |
| OPERATION_STARTED | Producer summary / original reason prose | Work started. |
| OPERATION_WAITING | Producer summary / original reason prose | Work is waiting. |
| OPERATION_PROGRESS | Producer summary / original reason prose | PRMonitor recorded a work update. Open support details for the recorded result. |
| OPERATION_SUCCEEDED | Producer summary / original reason prose | Work finished. |
| OPERATION_FAILED | Producer summary / original reason prose | Work failed. PRMonitor kept the recorded evidence. Open the related work to see the permitted next action. |
| OPERATION_CANCELLED | Producer summary / original reason prose | Work was cancelled. |
| OPERATION_RETRYING | Producer summary / original reason prose | PRMonitor is trying eligible work again. |
| OPERATION_UNKNOWN_OUTCOME | Producer summary / original reason prose | The work outcome is not known. Open the related work to check its outcome. |
| OPERATION_RECONCILED | Producer summary / original reason prose | PRMonitor checked the saved work outcome. |
| POLL_STARTED | Producer summary / original reason prose | PRMonitor started checking pull requests. |
| POLL_PROGRESS | Producer summary / original reason prose | PRMonitor recorded pull request information. |
| POLL_COMPLETED | Producer summary / original reason prose | PRMonitor finished checking pull requests. |
| POLL_FAILED | Producer summary / original reason prose | PRMonitor could not finish checking pull requests. This does not prove that your token is invalid. Check Connection and work status. |
| BATCH_STARTED | Producer summary / original reason prose | PRMonitor grouped feedback for review. |
| BATCH_WAITING | Producer summary / original reason prose | PRMonitor is waiting before reviewing new feedback. |
| BATCH_COMPLETED | Producer summary / original reason prose | PRMonitor finished preparing the feedback group. |
| AI_TURN_STARTED | Producer summary / original reason prose | AI work started. |
| AI_TURN_COMPLETED | Producer summary / original reason prose | An AI turn finished. Review the saved work and validation results. |
| AI_TURN_FAILED | Producer summary / original reason prose | AI work stopped. The saved work remains available. Open the related work to inspect it before continuing. |
| VALIDATION_STARTED | Producer summary / original reason prose | Validation started. |
| VALIDATION_COMPLETED | Producer summary / original reason prose | Validation finished. Open the related work to see the check results. |
| VALIDATION_FAILED | Producer summary / original reason prose | Validation could not finish. Open the related work to inspect the failed checks. |
| NOTIFICATION_SENT | Producer summary / original reason prose | PRMonitor sent a notification. |
| NOTIFICATION_FAILED | Producer summary / original reason prose | PRMonitor could not send a notification. You can inspect the saved work in PRMonitor. Open the PR inbox. |
| SYNC_STARTED | Producer summary / original reason prose | Branch synchronization started. |
| SYNC_COMPLETED | Producer summary / original reason prose | Branch synchronization finished. Review the saved result before publishing changes. |
| SYNC_FAILED | Producer summary / original reason prose | Branch synchronization stopped. The saved work remains available. Open the branch synchronization result. |
| PUBLICATION_INTENT | Producer summary / original reason prose | PRMonitor recorded approved changes for publication. |
| PUBLICATION_ATTEMPTED | Producer summary / original reason prose | PRMonitor attempted to publish approved changes. This event does not confirm the remote outcome. |
| PUBLICATION_SUCCEEDED | Producer summary / original reason prose | PRMonitor published approved changes. |
| PUBLICATION_FAILED | Producer summary / original reason prose | PRMonitor could not finish publishing approved changes. Open the publication result before trying again. |
| PUBLICATION_UNKNOWN_OUTCOME | Producer summary / original reason prose | The publication outcome is not known. Open the publication result to check its outcome before trying again. |
| PUBLICATION_RECONCILED | Producer summary / original reason prose | PRMonitor checked the publication outcome. Open the publication result for the confirmed outcome. |
| LIFECYCLE_STARTED | Producer summary / original reason prose | PRMonitor started a background check. |
| LIFECYCLE_COMPLETED | Producer summary / original reason prose | PRMonitor finished a background check. |
| LIFECYCLE_FAILED | Producer summary / original reason prose | PRMonitor could not finish a background check. Open Connection and work status. |
| RECOVERY_STARTED | Producer summary / original reason prose | PRMonitor is checking interrupted work. |
| RECOVERY_COMPLETED | Producer summary / original reason prose | PRMonitor finished checking interrupted work. |
| RECOVERY_FAILED | Producer summary / original reason prose | PRMonitor could not finish checking interrupted work. Saved work remains available. Open Connection and work status. |
| ACTIVITY_RETENTION_COMPLETED | Producer summary / original reason prose | PRMonitor checked activity history limits. |
| ACTIVITY_RETENTION_FAILED | Producer summary / original reason prose | PRMonitor could not check activity history limits. Refresh activity. If the problem continues, export support diagnostics. |
| LEGACY_ACTIVITY | Producer summary / original reason prose | PRMonitor recorded an event. Open support details for more information. |

## Known legacy and recovery outcomes

| Before | Current |
| --- | --- |
| LIFECYCLE_RUNNING | PRMonitor started. PRMonitor can keep working when you close this window. |
| Tray surface created | PRMonitor icon is ready. Use the icon in the taskbar notification area to open PRMonitor. |
| Uncertain saved publication | The outcome of saved work is not known. Inspect the saved evidence before trying again. |
| Network offline | PRMonitor is waiting for an internet connection. Check your connection. PRMonitor will check again when the connection returns. |
| Generic internal/unknown event | PRMonitor recorded an event. Open support details for more information. |

## Terminology

Native action refinement: `NOTIFICATION_SENT/FAILED` also historically recorded window, saved-target and worktree actions. Closed producer `nativeAction` values and known legacy summaries now distinguish those actions. Only `DELIVER_NOTIFICATION` claims notification delivery; an unknown native event uses factual generic action copy. The coordinator/persistence/presentation test exercises actual producers.

PR / pull request: the GitHub review being watched. Branch sync: preparing changes between the explicitly selected source branch and PR head. Saved review: the persisted proposal/final-review workspace. Application diagnostics: lifecycle, tray, health and empty recovery checks. Check interrupted work: the existing recovery command, which can retry already eligible work; it does not grant approval or silently continue stopped AI work. Raw support data: original safe identifiers, codes and structured evidence.

## Additional native failure and live delivery

The conditional Activity journey now makes only its owned SQLite activity table
temporarily unavailable. Actual production reads fail; the renderer preserves
the same last-known history, shows the factual error and offers Refresh activity.
The fixture restores the table in finally, compares all original rows unchanged,
and explicit Refresh clears the error. This is a real database read failure, not
a fabricated renderer response or altered product migration.

With All activity / WORKTREE selected, a real F13 inspection adds exactly one
unique event through the main/preload subscription without a Refresh action.
The painted evidence shows 50 saved rows becoming 51 with the new PR-work event.
This covers one genuine producer and filter combination; it does not certify
every live event family.
