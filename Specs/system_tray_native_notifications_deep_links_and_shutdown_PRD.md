# F19 - System Tray, Native Notifications, Deep Links, and Shutdown - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F04 - Persistent Electron shell, IPC boundary, and Windows virtual-desktop spike | Provides the main-process lifetime, validated routing/open-target contract, current-desktop window behavior, and shutdown handoff seam. |
| 2 | F08 - Managed-PR inbox and primary review-state presentation | Provides the authoritative managed-PR read model, primary states, safe reasons, and stable navigation identities used by the tray. |
| 3 | F09 - Durable activity log and operation diagnostics | Provides bounded correlated lifecycle and notification diagnostics without making activity text authoritative. |
| 4 | F12 - Review batching, scheduler, Check Now, and global pause | Provides the persisted global pause overlay, pause/resume controls, and scheduler status used by the tray. |
| 5 | F13 - Operation-owned Git worktrees and change attribution | Provides the validated open/reveal contract and canonical operation-owned worktree paths. |
| 6 | F18 - Automatic review-to-Review-Bundle vertical slice | Provides the bounded Review Bundle outcome handoff, proposal/final stage, attention reason, counts, and available worktree reference for notifications. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F20 - Review Bundle workspace and complete diff viewer | Consumes tray/notification targets and provides the destination opened by review notifications. |
| 2 | F21-F23 - Conversation, stale handling, discard, and publication | Consume notification/deep-link outcomes without receiving publication authority from F19. |
| 3 | F24-F27 - Managed PR branch synchronization | Supplies synchronization-batch outcome data and consumes the generic notification/deep-link contract. |
| 4 | F28-F30 - Recovery, security, and release readiness | Consume lifecycle, notification, platform, and shutdown evidence and harden the packaged application. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-05 | FR-03.1, FR-07.2, INV-09 | AC-05, AC-17 | Shared boundary only: F19 has no polling or AI-provider path and consumes already-committed outcomes; F10/F12 own the no-token observation and scheduling guarantees. |
| APP-AC-06 | FR-03.1, FR-03.3, FR-07.2, INV-09 | AC-05, AC-17 | Shared boundary only: F19 never decides whether a PR is unchanged and never invokes AI; F10/F11/F12 own changed-event, eligibility, and dispatch decisions. |
| APP-AC-15 | FR-03.1-FR-03.8, FR-04.1-FR-04.7, INV-04-INV-05 | AC-05-AC-08, AC-18 | Primary: F19 decides which bounded workflow outcomes warrant a native notification and delivers them without a renderer. |
| APP-AC-18 | FR-05.1-FR-05.6, INV-06, INV-10 | AC-09, AC-17 | Primary: F19 maps notification activation to a validated Review Bundle/PR target; F04 owns route delivery mechanics. |
| APP-AC-19 | FR-01.1-FR-02.5, FR-05.1-FR-05.4, INV-01, INV-08 | AC-01-AC-04, AC-09 | Primary: F19 supplies the tray entry point and requests window recreation; F04 owns the native window/desktop adapter. |
| APP-AC-31 | FR-06.1-FR-06.7, INV-02-INV-03 | AC-11-AC-13 | Primary: F19 owns the exact user-facing Shutdown PRMonitor command and graceful completion/failure presentation; F04 owns lifecycle handoff hooks. |
| APP-AC-38 | FR-05.5-FR-05.7, INV-06 | AC-06, AC-10, AC-17 | Shared: F19 exposes the notification Open Worktree action; F13 authorizes the canonical managed path and F20 supplies the equivalent Review Bundle action. |
| APP-AC-16 | FR-02.3, FR-05.3, FR-06.6, FR-07.3, INV-07, INV-10 | AC-04, AC-15, AC-17 | Shared: F19 preserves the per-PR hold by making navigation read-only; F11/F18 own the automatic stop, hold, and explicit-release state. |
| APP-AC-17 | FR-01.1, FR-02.1-FR-02.5, FR-06.1-FR-06.4, INV-01-INV-03, INV-07 | AC-01, AC-04, AC-11-AC-14 | Shared: F19 keeps tray/background lifetime separate from window lifetime; F04 owns the main-process lifetime and F10-F18 own watcher, hold, and operation semantics. |
| APP-AC-30 | FR-01.1, FR-06.1-FR-06.7, INV-02-INV-03 | AC-01, AC-11-AC-14 | Shared: F19 makes Shutdown PRMonitor the only user-facing exit command; F04 owns process lifecycle enforcement. |
| APP-AC-20 | FR-05.1-FR-05.4, INV-08 | AC-09, AC-16 | Shared: F19 exercises tray/notification entry paths on the current desktop; F04 owns the Windows virtual-desktop adapter and A/B/C spike acceptance. |
| APP-AC-49 | FR-03.2-FR-03.4, FR-03.9, FR-05.1-FR-05.4, FR-07.4 | AC-05, AC-09, AC-15, AC-18, AC-20 | Integration boundary only—not full-criterion ownership: F19 presents a bounded summary/deep link for a committed synchronization outcome; F24-F27 own every persisted result field, diff, validation, and next-action truth, and F19 never reconstructs or claims the complete criterion. |
| APP-AC-75 | FR-01.4, FR-03.2-FR-03.4, FR-07.4 | AC-02, AC-05, AC-15 | Shared: F19 carries semantic ready/attention categories and reasons through native surfaces; F20 owns the full Review Bundle visual distinction and review controls. |

F19 does not claim primary ownership of APP-AC-03, APP-AC-04-APP-AC-14, APP-AC-21-APP-AC-37, APP-AC-39-APP-AC-48, or APP-AC-50-APP-AC-74, APP-AC-76-APP-AC-77. Those criteria remain owned by the inbox, polling, workflow, worktree, AI, validation, Review Bundle, synchronization, publication, recovery, security, or release features. F19 consumes their typed read models and never treats tray or notification text as authoritative state.

### Explicit coverage boundaries

- **APP-AC-04 is not applicable to F19:** F10/F12 own polling while no renderer exists. F19 must continue to consume their committed read models without creating a second polling loop, and its notification/tray behavior must not be used as evidence that polling itself is working.
- **APP-AC-05 is a shared boundary, not F19 ownership:** F19 has no polling or AI-provider path and only consumes committed typed outcomes. F10/F12 own the guarantee that polling consumes no AI-provider/API-model tokens; F19's no-provider reachability test is supporting evidence only.
- **APP-AC-06 is a shared boundary, not F19 ownership:** F19 never decides that a PR is unchanged and never invokes an AI provider. F10/F11/F12 own unchanged detection, eligibility, and dispatch; F19's notification policy only suppresses routine outcomes it receives.
- **APP-AC-69 is not applicable to F19:** F10/F11/F18 own immutable remote-event versions and handled associations. F19 consumes a bounded Review Bundle or synchronization outcome and never reads, reconstructs, or deduplicates raw remote event versions.
- **APP-AC-16 is shared, not primary:** F19 guarantees that tray/notification navigation cannot release a per-PR hold or start new analysis; F11/F18 remain authoritative for the automatic hold and its explicit release actions.
- **APP-AC-49 is an integration boundary, not full F19 ownership:** F19 provides an outcome-oriented synchronization-batch summary and safe deep link only after F24-F27 commit the authoritative result. F24-F27 provide every persisted result field, worktree/diff/validation evidence, and actionable result state; F19 must not add a fallback persistence model or claim that its notification record satisfies the complete criterion.
- **APP-AC-75 is shared, not primary:** F19 gives native surfaces distinct semantic ready/attention labels and reasons; F20 owns the complete Review Bundle presentation and controls.

## Executive Summary

PRMonitor must remain useful while its application window is closed. A developer needs a small, dependable surface that says whether work needs attention, lets them reopen the right PR or Review Bundle, and permits an explicit pause or shutdown without confusing those actions with closing the window.

F19 adds a system-tray presence, outcome-oriented native notifications, safe notification/tray deep links, and the explicit Shutdown PRMonitor flow. The tray summarizes persisted managed-PR and scheduler state. Notifications are sent only for meaningful outcomes such as a review proposal, a final review, a required decision, failed validation, or a synchronization batch that is ready for review. Clicking a notification or tray item opens the relevant persisted target on the current desktop; it never approves, publishes, releases a hold, or starts new work merely because it was opened. When a Review Bundle has a recorded isolated worktree, the user can request that exact worktree through the operating system's file manager.

The feature is designed for the Windows desktop MVP while keeping all product contracts provider-neutral and replaceable for other supported operating systems.

## User Stories

### Keep background work visible

- **US-01:** **GIVEN** the PRMonitor main process is running with no visible window, **WHEN** the developer looks at the operating-system tray, **THEN** a PRMonitor tray icon is present and its summary reflects the latest accepted application read models.
  - **Acceptance Criteria:** AC-01-AC-03, AC-13.
- **US-02:** **GIVEN** several managed PRs have different primary states, **WHEN** the developer opens the tray menu, **THEN** the menu shows a bounded count of PRs needing review, actionable entries for attention/ready items, working entries when available, and the exact Open PRMonitor, Pause Watching/Resume Watching, and Shutdown PRMonitor commands.
  - **Acceptance Criteria:** AC-02-AC-04.

### Receive useful outcomes

- **US-03:** **GIVEN** a Review Bundle or synchronization batch reaches a user-actionable outcome, **WHEN** the main process is running without a renderer, **THEN** the developer receives one concise native notification that explains what happened and what action is available.
  - **Acceptance Criteria:** AC-05-AC-08, AC-18.
- **US-04:** **GIVEN** routine polling, batching, or progress occurs without a new user decision, **WHEN** the event is recorded, **THEN** PRMonitor does not produce a routine notification merely because activity occurred.
  - **Acceptance Criteria:** AC-05, AC-18.

### Open the correct target safely

- **US-05:** **GIVEN** the developer activates a tray item or native notification, **WHEN** no window exists or the application is on another virtual desktop, **THEN** PRMonitor creates/focuses a window through the supported shell behavior and opens the persisted PR, Review Bundle, or synchronization-batch target exactly once.
  - **Acceptance Criteria:** AC-09, AC-16-AC-17.
- **US-06:** **GIVEN** a Review Bundle has an available isolated worktree, **WHEN** the developer chooses Open Worktree from a notification, **THEN** the operating system opens the recorded operation-owned directory and never the normal developer clone.
  - **Acceptance Criteria:** AC-06, AC-10, AC-17.

### Control and stop background work

- **US-07:** **GIVEN** watching is active or paused, **WHEN** the developer selects Pause Watching or Resume Watching in the tray, **THEN** the global overlay changes through the scheduler's explicit contract while per-PR holds and already admitted work remain unchanged.
  - **Acceptance Criteria:** AC-04, AC-13.
- **US-08:** **GIVEN** the developer explicitly selects Shutdown PRMonitor, **WHEN** graceful handoff completes, **THEN** new work admission stops according to owning service contracts, durable state is preserved, the tray icon is removed, and the process exits.
  - **Acceptance Criteria:** AC-11-AC-14.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** the PRMonitor main process is running, **WHEN** the visible window is open, closed, destroyed, reloaded, or absent, **THEN** exactly one tray icon remains available for the lifetime of the running process; normal window close does not remove it or terminate background work.
- **AC-02:** **GIVEN** the accepted F08/F12 read models contain managed PRs, primary states, safe reasons, working summaries, and global pause status, **WHEN** the tray menu is rebuilt, **THEN** it presents a deterministic bounded summary with the count of PRs needing review, distinct entries for actionable PRs, available working entries, an explicit paused indicator, Open PRMonitor, Pause Watching or Resume Watching, and Shutdown PRMonitor; it never reads free-form activity text as state.
- **AC-03:** **GIVEN** more than ten actionable tray entries exist, **WHEN** the menu is built, **THEN** it shows the ten highest-priority actionable entries plus one bounded More in PRMonitor entry; the selection/order is deterministic, the tray remains responsive, and no item is silently represented as a different PR.
- **AC-04:** **GIVEN** watching is active or paused, **WHEN** the developer selects Pause Watching or Resume Watching, **THEN** F12 receives one validated idempotent command, the tray reflects the committed overlay, automatic review dispatch remains blocked while paused, permitted read-only polling follows F12's policy, and per-PR review holds are not released.
- **AC-05:** **GIVEN** a typed F18 Review Bundle outcome or supported synchronization-batch outcome becomes newly actionable, **WHEN** F19 evaluates its notification policy, **THEN** it may create a native notification for a proposal ready for review, final review ready, required developer input, failed or interrupted validation, or a reviewable synchronization batch; routine comment detection, unchanged polling, and intermediate progress do not notify by default.
- **AC-06:** **GIVEN** a notification-worthy outcome has an available isolated worktree, **WHEN** the native platform supports notification actions, **THEN** the notification includes a bounded Open Worktree action keyed by the persisted worktree reference; **WHEN** the platform cannot expose that action, **THEN** activation opens the related target with the Open Worktree action available and explains the capability limitation without guessing a path.
- **AC-07:** **GIVEN** a notification is about to be sent, **WHEN** F19 persists its intent, **THEN** the record contains a stable notification identity, outcome/revision identity, bounded template data, validated target, delivery state, and correlation identity before the OS notification effect is attempted; credentials, prompts, raw provider values, and uncontrolled environment data are absent.
- **AC-08:** **GIVEN** the same notification identity is retried after renderer closure, process restart, adapter failure, or an uncertain OS result, **WHEN** the delivery record is reconciled, **THEN** an identical committed delivery is replayed or recognized without an unbounded duplicate; a new outcome revision may create a new notification, and permission denial/unavailable capability becomes an inspectable non-success diagnostic rather than a false delivered result.
- **AC-09:** **GIVEN** a valid tray or notification target is activated, **WHEN** the window is absent, not ready, or on another Windows virtual desktop, **THEN** F04 receives one normalized provider-neutral target, creates/focuses a fresh window through the current-desktop contract, and delivers the PR, Review Bundle, or synchronization-batch destination at most once; a duplicate activation is idempotent and does not start work.
- **AC-10:** **GIVEN** a valid Review Bundle worktree reference is activated, **WHEN** the developer chooses Open Worktree, **THEN** F19 asks F13 to authorize the operation-owned canonical path and asks the OS adapter to open/reveal only that path; an unavailable, stale, or unsupported path returns a bounded remediation and never opens the developer clone or an arbitrary caller path.
- **AC-11:** **GIVEN** the developer explicitly selects the exact command **Shutdown PRMonitor**, **WHEN** shutdown begins, **THEN** F19 persists shutdown intent before invoking handoff, prevents new work admission through F04/F12 and the owning service contracts, waits for the bounded lifecycle handoff, removes the tray icon, and exits only after the process has a truthful terminal lifecycle result.
- **AC-12:** **GIVEN** a service handoff, persistence operation, or tray removal cannot complete within its bounded contract, **WHEN** Shutdown PRMonitor is processed, **THEN** F19 preserves the committed intent and diagnostic state, does not claim that the process exited, keeps a safe tray/retry surface when possible, and exposes the reason and next permitted action; it never force-deletes worktrees, resets budgets, or invents success.
- **AC-13:** **GIVEN** the developer closes the visible window, a renderer crashes, or a renderer is recreated, **WHEN** background services continue, **THEN** tray state, notification delivery, scheduler pause, per-PR holds, active operation records, and already committed outcomes remain unchanged; only the explicit Shutdown PRMonitor command starts normal application termination.
- **AC-14:** **GIVEN** the process restarts after a tray/notification/shutdown intent was committed or was interrupted, **WHEN** F19 reconciles durable records, **THEN** it restores the current tray projection, does not resend an already reconciled notification or repeat a shutdown side effect, and presents unresolved delivery/handoff conditions as actionable diagnostics.
- **AC-15:** **GIVEN** a notification or tray target refers to a stale Review Bundle, NEEDS_ATTENTION result, closed PR, or synchronization result requiring review, **WHEN** it is opened, **THEN** the target remains inspectable with its authoritative state and explanation; opening it never publishes, approves, discards, re-evaluates, releases a hold, starts AI work, or changes a remote branch.
- **AC-16:** **GIVEN** tray/notification entry is attempted on Windows Desktop A, B, or C, **WHEN** the user closes the window, switches desktops, and opens from the tray or a notification, **THEN** the new/focused window targets the active desktop using F04's tested adapter behavior, and any foreground limitation produces a retryable user-facing result without a duplicate process or hidden stale renderer.
- **AC-17:** **GIVEN** an incoming route, worktree reference, PR/bundle identity, or shutdown request is malformed, oversized, unknown, secret-shaped, unauthorized, or duplicated, **WHEN** it reaches F19, **THEN** it is rejected or coalesced before any OS, filesystem, provider, GitHub, AI, validation, commit, push, response, merge, or publication effect, with a bounded safe reason.
- **AC-18:** **GIVEN** F19 sends or fails to send a notification, updates the tray, opens a target, attempts Open Worktree, pauses/resumes, or shuts down, **WHEN** the outcome is committed, **THEN** F19 appends a bounded F09 activity event linked to the owning outcome and correlation identity; activity text never becomes the source of tray state, notification deduplication, shutdown truth, or workflow completion.
- **AC-19:** **GIVEN** two managed PRs have independent outcome, notification, or activation records, **WHEN** delivery or target handling for one PR fails, times out, or becomes unknown, **THEN** the other PR's tray entry, notification record, target, and outcome remain available and unchanged; an application-wide shutdown diagnostic is recorded at application scope and never masquerades as a PR outcome.
- **AC-20:** **GIVEN** a synchronization-batch notification is requested, **WHEN** F19 evaluates the handoff, **THEN** it accepts only a committed F24-F27 outcome reference and bounded display summary; if the authoritative result is absent or incomplete, F19 records a bounded unavailable/pending diagnostic and does not notify, reconstruct, or persist the synchronization result fields owned by F24-F27.

## Functional Requirements

### FR-01: Persistent tray presence and projection

- FR-01.1: The application SHALL maintain one system-tray icon whenever the main process is running, regardless of whether a renderer window exists.
- FR-01.2: F19 SHALL build tray content from versioned F08 managed-PR and F12 scheduler read models plus typed downstream outcome summaries; it SHALL not parse logs or activity messages to derive state.
- FR-01.3: The tray SHALL show a bounded count of PRs needing review, deterministic actionable PR entries, truthful working summaries when available, and a clear paused indicator.
- FR-01.4: Tray entries SHALL retain stable managed-PR, Review Bundle, or synchronization-batch identities and SHALL distinguish READY_FOR_REVIEW, NEEDS_ATTENTION, WORKING, and paused overlay state without color alone.
- FR-01.5: Tray menu ordering and overflow behavior SHALL be deterministic and SHALL show at most ten actionable entries plus one More in PRMonitor route; overflow SHALL provide a safe route to the inbox rather than silently dropping or substituting an item.
- FR-01.6: Tray creation, refresh, destruction, and adapter failure SHALL return bounded capability/lifecycle results and SHALL not terminate or mutate background work solely because the tray surface is unavailable.

### FR-02: Tray commands and global pause

- FR-02.1: The tray SHALL expose the exact commands Open PRMonitor, Pause Watching or Resume Watching, and Shutdown PRMonitor, with Shutdown PRMonitor visually and semantically separate from normal window close.
- FR-02.2: Selecting Open PRMonitor SHALL request an on-demand window through F04 and SHALL be idempotent while a window is being created or focused.
- FR-02.3: Selecting a PR or Review Bundle entry SHALL request only its validated provider-neutral target and SHALL not approve, publish, discard, re-evaluate, release a hold, or start work.
- FR-02.4: Selecting Pause Watching or Resume Watching SHALL call F12's typed control contract and SHALL reflect only the committed overlay result.
- FR-02.5: Pause Watching SHALL block new automatic review dispatch according to F12 without cancelling explicitly started work, hiding state, or releasing per-PR holds.
- FR-02.6: Tray commands SHALL be keyboard/assistive-technology operable through the host platform's supported menu semantics and SHALL expose safe failure/retry results.

### FR-03: Outcome-oriented native notification policy

- FR-03.1: F19 SHALL consume typed outcome handoffs rather than polling GitHub, interpreting activity text, or inspecting provider SDK events.
- FR-03.2: The default notification policy SHALL cover newly actionable Review Bundle proposal/final outcomes, required developer input, failed or interrupted validation, and reviewable synchronization-batch outcomes.
- FR-03.3: The default policy SHALL not notify for routine comment detection, unchanged polls, quiet-period changes, ordinary progress, or a repeated unchanged state.
- FR-03.4: Each notification SHALL use one bounded template with a concise title, summary of what happened, why attention is useful, and a permitted destination/action.
- FR-03.5: Notification text SHALL use safe provider-neutral display references, shall not expose credentials/prompts/raw provider output, and shall not include an arbitrary filesystem path as an action authority.
- FR-03.6: A notification with a recorded worktree SHALL expose Open Worktree through the platform capability contract when possible, with the related target as the safe fallback.
- FR-03.7: Notification policy evaluation SHALL be deterministic for the same outcome snapshot, policy revision, and clock; it SHALL distinguish proposal review, final review, attention, and synchronization-batch categories.
- FR-03.8: Notification policy SHALL allow a bounded platform capability result such as delivered, unavailable, denied, unsupported-action, or failed without changing the owning workflow state.
- FR-03.9: For synchronization-batch outcomes, F19 SHALL accept only a committed F24-F27 outcome reference and bounded display summary; an absent or incomplete authoritative result SHALL remain unavailable/pending and SHALL not be reconstructed, copied as authoritative state, or used to create a notification.

### FR-04: Durable delivery, idempotency, and diagnostics

- FR-04.1: F19 SHALL persist a notification intent and stable delivery identity before invoking the native notification adapter.
- FR-04.2: A repeated delivery request with the same notification identity and canonical payload SHALL return the existing delivery outcome or one reconciled attempt; a changed payload or outcome revision SHALL use a distinct identity.
- FR-04.3: F19 SHALL snapshot the outcome/revision, bounded notification data, target reference, worktree reference when present, policy revision, and correlation identity used for delivery.
- FR-04.4: Renderer closure, process restart, OS permission denial, adapter failure, and uncertain native delivery SHALL preserve the intent and distinguish pending, delivered, denied, unavailable, failed, and unknown outcomes.
- FR-04.5: F19 SHALL not retry native delivery without a bounded policy and SHALL not use a notification retry to release a hold, publish work, or alter a remote state.
- FR-04.6: Tray/notification/shutdown records SHALL survive process restart sufficiently to prevent duplicate outcome delivery and to expose unresolved conditions to the user.
- FR-04.7: F19 SHALL emit bounded F09 activity for notification policy, delivery, action activation, tray lifecycle, pause command, worktree-open request, and shutdown handoff outcomes.
- FR-04.8: F19 SHALL scope delivery, activation, worktree-action, and shutdown-diagnostic records by stable managed-PR, operation, and outcome identities so a failure for one PR cannot suppress, overwrite, or mutate another PR's native state.

### FR-05: Safe deep links, target activation, and worktree opening

- FR-05.1: Notification and tray activation SHALL resolve to an allowlisted provider-neutral target containing only the required managed-PR, Review Bundle, synchronization-batch, or inbox identity.
- FR-05.2: F19 SHALL pass targets through F04's validated routing/window contract and SHALL queue delivery when the renderer is not ready; it SHALL not call BrowserWindow APIs directly.
- FR-05.3: Activation SHALL be at-most-once for one request identity and shall remain a read/navigation action even when the target is stale or attention-worthy.
- FR-05.4: F19 SHALL use F04's current-desktop/focus adapter behavior and shall preserve a target for retry when foreground activation is denied or times out.
- FR-05.5: Open Worktree SHALL accept only an F13-issued operation/worktree reference, never a renderer-supplied path, URL, command, or arbitrary file target.
- FR-05.6: F19 SHALL ask F13 to validate the recorded canonical path immediately before asking the OS to open/reveal it, and SHALL show an actionable result when the path is missing, unavailable, or no longer owned.
- FR-05.7: A worktree-open request SHALL never reset, clean, replace, mutate, or publish the worktree and SHALL never target the developer's normal clone.

### FR-06: Explicit shutdown and graceful handoff

- FR-06.1: Only the exact user-facing command Shutdown PRMonitor SHALL request normal application termination through F04's lifecycle contract; normal window close, tray refresh, notification activation, focus failure, and renderer failure SHALL not request shutdown.
- FR-06.2: F19 SHALL persist shutdown intent before asking services to stop admitting new work or hand off active work.
- FR-06.3: F19 SHALL invoke the bounded F04 shutdown handoff and shall preserve active operation, validation, AI, worktree, scheduler, and publication records for recovery according to their owning contracts.
- FR-06.4: F19 SHALL remove the tray icon and permit process exit only after the lifecycle contract returns a truthful completed result; repeated shutdown requests SHALL be idempotent.
- FR-06.5: A timeout, failure, or uncertain handoff SHALL remain an actionable non-terminal lifecycle result, shall not claim process exit, and shall not force-delete worktrees or reset budgets.
- FR-06.6: Shutdown SHALL prevent new automatic admission as required by F12/F04 while preserving explicitly authorized work and durable evidence until the owning service reports its handoff state.
- FR-06.7: F19 SHALL expose a bounded user-facing explanation of shutdown progress, delay, failure, or completion through the tray/notification/diagnostic surface available at the time.

### FR-07: Security, accessibility, and platform behavior

- FR-07.1: Tray, notification, target, worktree, pause, and shutdown payloads SHALL be schema-validated, bounded, allowlisted, and rejected fail-closed when malformed, secret-shaped, or unauthorized.
- FR-07.2: F19 SHALL not receive or persist GitHub credentials, OS credential material, provider SDK objects, prompts, uncontrolled environment values, arbitrary paths, arbitrary URLs, or arbitrary shell commands.
- FR-07.3: F19 SHALL keep notification/tray activation separate from approval, commit, push, response posting, merge, publication, discard, re-evaluation, and AI continuation authority.
- FR-07.4: Tray and notification status SHALL have semantic labels and text equivalents for ready, attention, working, paused, unavailable, and failed outcomes; meaning SHALL not depend on color, animation, sound, or hover.
- FR-07.5: Windows virtual-desktop behavior SHALL use F04's platform adapter and SHALL preserve a retryable target/fallback when foreground activation is denied or unsupported.
- FR-07.6: F19 SHALL keep platform-specific tray, notification, file-manager, and shutdown calls behind replaceable OS contracts so deterministic fakes can prove behavior on every supported platform.

## Non-Functional Requirements

- **NFR-01: Background reliability** - Tray state, notification delivery, and shutdown coordination SHALL continue in the main process without a renderer and SHALL tolerate renderer closure, recreation, and ordinary process restart without losing committed intent.
- **NFR-02: Determinism** - Given the same persisted read models, outcome snapshots, policy revision, adapter capabilities, and injected clock, tray ordering, notification category/text, target resolution, deduplication, and shutdown decisions SHALL be reproducible.
- **NFR-03: Idempotency and uncertainty** - Replayed tray commands, notification delivery attempts, target activations, pause commands, and shutdown requests SHALL not create duplicate native effects or falsely convert an unknown outcome into success.
- **NFR-04: Bounded behavior** - Tray rebuilds, notification text/payloads, target queues, activity events, shutdown waits, and retry attempts SHALL have explicit size/time/count bounds and shall not busy-loop. The F19 MVP bound is ten actionable tray entries plus More in PRMonitor; notification fields use the effective published F03/F04/F09 bounds; one notification identity receives at most one automatic initial delivery and one bounded startup reconciliation attempt; activation queue and shutdown wait use the effective F04 bounds; a missing delegated bound is a fail-closed configuration error.
- **NFR-05: Security and data minimization** - Native surfaces SHALL contain only the minimum safe summary and opaque target identity needed for the action; credentials, prompts, raw SDK data, arbitrary paths, and uncontrolled output SHALL remain behind their owning boundaries.
- **NFR-06: Accessibility** - Tray labels, notification titles/bodies/actions, pause/shutdown results, and fallback/error states SHALL remain understandable and operable with keyboard navigation, screen readers, forced colors/high contrast, reduced motion, and notification-action limitations.
- **NFR-07: Platform portability** - Shared policy, target, persistence, and lifecycle contracts SHALL be platform-neutral; Windows-specific native behavior SHALL be isolated behind an adapter with deterministic unsupported-capability results.
- **NFR-08: Diagnosability** - Every native effect and lifecycle transition SHALL have a bounded structured reason, correlation identity, and safe F09 diagnostic outcome without using activity text as authoritative state.

## Invariants

- **INV-01:** The Electron main process owns the tray, notification, target, and shutdown coordinators; renderer memory is never authoritative.
- **INV-02:** Closing or destroying the visible window is not Shutdown PRMonitor and cannot stop watchers, release a hold, cancel active work, or remove the tray icon by itself.
- **INV-03:** Only the explicit Shutdown PRMonitor request may begin normal application termination; notification/tray navigation and focus errors cannot terminate the process.
- **INV-04:** Notifications are outcome-oriented projections of typed authoritative records; routine activity, free-form logs, and provider prose never become notification triggers or workflow state.
- **INV-05:** Intent for a notification or shutdown native side effect is persisted before the effect is attempted, and uncertain effects remain uncertain until reconciled.
- **INV-06:** Every tray/notification target and worktree action is allowlisted and validated; Open Worktree can target only the F13-owned canonical path for the referenced operation.
- **INV-07:** The global Pause Watching overlay is distinct from per-PR review holds, Review Bundle state, synchronization state, and shutdown state; no tray action conflates them.
- **INV-08:** Window creation, focus, current-desktop selection, and deep-link delivery are delegated to F04's platform-neutral shell contract; F19 never retains a hidden renderer as a substitute.
- **INV-09:** F19 has no GitHub credential, provider SDK, AI, Git, validation, commit, push, response-posting, merge, discard, re-evaluation, or publication authority.
- **INV-10:** Opening a notification or tray item is a read/navigation action and never approves, publishes, releases a hold, starts AI work, changes a remote branch, or mutates a worktree.
- **INV-11:** F19's records and native effects are scoped to stable operation/outcome identities; one PR's tray/notification failure or shutdown diagnostic cannot corrupt another PR's state.

## Out of Scope

- Review Bundle item decisions, diff rendering, conversation, revision, discard, stale detection, or publication.
- Polling, feedback eligibility, quiet-period batching, scheduler timing, or AI invocation.
- Git worktree creation, cleanup, attribution, validation, or file mutation. F19 only requests F13's safe open/reveal contract.
- The Windows virtual-desktop implementation itself. F04 owns the OS adapter and A/B/C spike; F19 consumes it and supplies tray/notification entry evidence.
- Email, Slack, browser, mobile, or remote notification channels.
- A notification center, arbitrary user-authored notification templates, per-notification snooze rules, or cross-device notification synchronization.
- Autonomous response, commit, push, merge, publication, hold release, or shutdown cancellation of work owned by another feature.

## Product Decisions

- **PD-01: Tray presence follows the main process** - PRMonitor shows one tray icon whenever the background process is running; closing the window never hides the application or ends background work.
- **PD-02: The exit command is exact and explicit** - The user-facing command is **Shutdown PRMonitor**. The word “Quit” is not used, and no tray/notification navigation path is an alias for shutdown.
- **PD-03: Native notifications are outcome-oriented** - Useful review, attention, validation, and synchronization outcomes may notify; routine polling and progress do not notify by default.
- **PD-04: Notification activation opens state, not authority** - A click opens the persisted target and may expose a follow-up action, but it cannot approve, publish, discard, release a hold, or start AI work.
- **PD-05: Worktree actions use the recorded operation path** - Open Worktree resolves the immutable path recorded by F13, even if the application-level worktree root changes later.
- **PD-06: Pause Watching is an admission overlay** - Pause blocks new automatic review dispatch through F12, retains state, permits only the read-only behavior F12 allows, and does not cancel explicitly started work or release per-PR holds.
- **PD-07: Shutdown is durable and bounded** - Shutdown first records intent and requests a bounded service handoff. If the handoff cannot complete safely, PRMonitor remains alive with an actionable diagnostic rather than force-killing active work or claiming a false exit.
- **PD-08: Notification identity follows an outcome revision** - One notification identity represents one bounded outcome snapshot. Reconciliation prevents duplicate delivery, while a materially new outcome revision can notify again.
- **PD-09: Platform limitations are visible** - Missing notification actions, denied permissions, unavailable tray APIs, and foreground restrictions produce truthful fallback behavior and diagnostics; they do not change the owning workflow outcome.
- **PD-10: Tray overflow is ten plus More** - The tray shows the ten highest-priority actionable entries and a More in PRMonitor route. This keeps the native menu bounded while preserving access to the complete inbox.
- **PD-11: Unsupported native worktree actions open the Review Bundle** - If the operating system cannot expose Open Worktree as a notification action, activation opens the related Review Bundle and clearly surfaces its Open Worktree control.
- **PD-12: Delayed shutdown stays visible and retryable** - If the bounded handoff is unresolved, the tray remains available with an attention state and bounded retry. PRMonitor never force-exits while an owning service reports an unresolved handoff or claims that the process exited.

## Implementation Decisions

- **IMP-01: Use one main-process TrayNotificationCoordinator** - It composes the tray projection, notification policy, delivery repository, F04 target/lifecycle ports, F12 pause port, F13 worktree-open port, and F09 activity writer.
- **IMP-02: Define a provider-neutral NativeTarget union** - Targets contain stable managed-PR, Review Bundle, synchronization-batch, inbox, or worktree-operation identities; they never contain arbitrary URLs, paths, commands, or native handles.
- **IMP-03: Persist notification delivery intents as first-class records** - The record stores the outcome snapshot, template/category revision, target, worktree reference, correlation identity, delivery state, and idempotency key before the OS adapter is called.
- **IMP-04: Project the tray from typed read models** - F08 and F12 remain authoritative for primary state and pause. F18 and future synchronization features supply bounded outcome summaries; F19 does not infer state from F09 activity.
- **IMP-05: Keep native effects behind an OS adapter** - Tray lifecycle, native notification delivery/actions, file-manager open/reveal, and shutdown completion use replaceable adapter contracts and deterministic fakes.
- **IMP-06: Route all activation through F04** - F19 sends a validated target to the F04 window/deep-link coordinator, which owns current-desktop focus, renderer readiness, queueing, and exactly-once delivery.
- **IMP-07: Treat notification and shutdown records as intent/reconciliation state** - Adapter results are recorded as delivered, denied, unavailable, failed, pending, or unknown; a missing activity event cannot authorize a retry or claim success.
- **IMP-08: Use bounded template catalogs** - Notification copy and tray labels are selected from versioned templates with safe display references and counts; free-form provider output is never inserted as authoritative action data.
- **IMP-09: Consume future synchronization outcomes through a contract fixture** - F19 implements the generic batch-outcome adapter and tests it with deterministic F24-F27 fakes; it does not pull synchronization behavior forward or own merge truth.
- **IMP-10: Publish the effective F19 bounds** - The implementation exposes and snapshots the ten-entry tray bound, the effective F03/F04/F09 payload bounds, the one-initial-plus-one-startup-reconciliation automatic delivery bound, the F04 activation-queue bound, and the F04 shutdown timeout. Any missing delegated bound refuses the operation before a native effect.

## Testing Decisions

- **TST-01: Deep-test the coordinator and projections** - Unit-test tray ordering/overflow, notification category selection, canonical identity, target resolution, pause commands, and shutdown decisions with injected clocks and typed fakes.
- **TST-02: Fault-inject every persist-before-effect boundary** - Test crashes and cancellations before/after notification intent, native delivery, target routing, worktree opening, pause commit, shutdown intent, tray removal, and process-exit handoff.
- **TST-03: Use real Electron/main-process boundaries** - Verify the renderer can be absent, recreated, or destroyed while tray/notification/shutdown work continues; browser-only UI tests are insufficient for lifecycle claims.
- **TST-04: Use deterministic OS-adapter fakes plus Windows evidence** - Fakes cover denied, unavailable, unsupported, timeout, duplicate, and uncertain adapter results; a Windows smoke matrix covers tray, notification click, current-desktop behavior, file-manager action, and shutdown.
- **TST-05: Test authority negatively** - Static/import scans and effect spies prove F19 cannot reach credentials, provider SDKs, GitHub mutation, AI, Git, validation, publication, arbitrary shell/path, or activity-text state.
- **TST-06: Test native-surface accessibility contracts** - Verify semantic labels, bounded text, keyboard/assistive-technology names, forced-colors-safe status, reduced-motion behavior, and truthful unsupported-action fallback; defer Review Bundle layout fidelity to F20.
- **TST-07: Test cross-feature consumer contracts** - Use F08/F12/F13/F18 and synchronization fakes to prove schema versioning, target identities, read-model revisions, worktree references, and outcome snapshots remain safe after restart.

## Proposed Modules

- **MOD-01: TrayNotificationCoordinator** - Main-process owner of tray lifecycle, native outcome delivery, activation, and shutdown orchestration.
- **MOD-02: TrayProjectionBuilder** - Deterministically projects F08/F12/downstream read models into bounded tray menu entries and overflow.
- **MOD-03: NotificationPolicy** - Selects outcome-oriented notification categories and safe template data from typed snapshots.
- **MOD-04: NotificationDeliveryRepository** - Persists notification intent, idempotency, adapter outcome, reconciliation state, and policy/template revision.
- **MOD-05: NativeSurfaceAdapter** - Platform-neutral contract with Windows tray, notification, file-manager, and capability implementations.
- **MOD-06: NativeTargetResolver** - Validates activation identities and maps them to F04 routes or F13 worktree references.
- **MOD-07: ShutdownCoordinator** - Persists Shutdown PRMonitor intent, requests F04 handoff, records bounded progress/failure, and decides when tray removal/process exit is truthful.
- **MOD-08: OutcomeFormatter** - Produces bounded safe titles, summaries, counts, work-item references, and next-action labels without copying provider prose.
- **MOD-09: F19 ActivityAdapter** - Maps tray, notification, worktree, pause, and shutdown outcomes to safe F09 events.

## Workflows

### Workflow 1: Start and maintain the tray

1. The main process starts and loads the current F08/F12/downstream read models.
2. F19 creates one tray icon through the OS adapter and persists a safe tray capability result.
3. F19 builds the bounded menu from typed state, including paused/working/action-needed summaries.
4. A read-model revision triggers one deterministic menu refresh; an identical replay is a no-op.
5. Closing or recreating the renderer changes no tray/lifecycle ownership.

### Workflow 2: Review outcome to native notification

1. F18 or a future synchronization owner commits a typed actionable outcome.
2. F19 evaluates the versioned policy and ignores routine/non-actionable outcomes.
3. For an actionable outcome, F19 validates the bounded display data and target.
4. F19 persists a notification delivery intent before calling the native adapter.
5. The adapter returns delivered, denied, unavailable, failed, or unknown; F19 records that result and emits safe F09 activity.
6. A repeated delivery request reconciles the existing identity instead of creating an unbounded duplicate.

### Workflow 3: Notification or tray activation

1. The OS reports a bounded action identity, not an arbitrary URL or path.
2. F19 validates and resolves it to a PR, Review Bundle, synchronization-batch, inbox, or F13 worktree reference.
3. For a navigation target, F19 asks F04 to create/focus the current-desktop window and deliver the target when the renderer is ready.
4. For Open Worktree, F19 asks F13 to revalidate the recorded path, then asks the OS adapter to open/reveal it.
5. The action result is recorded; no workflow approval, mutation, or publication is implied.

### Workflow 4: Pause and resume watching

1. The developer selects Pause Watching or Resume Watching from the tray.
2. F19 persists the request identity and calls F12's typed control port.
3. F12 returns the committed overlay and permitted read-only behavior.
4. F19 rebuilds the tray and records the result; per-PR holds and existing operations remain unchanged.

### Workflow 5: Explicit shutdown

1. The developer selects Shutdown PRMonitor.
2. F19 persists shutdown intent before requesting lifecycle handoff.
3. F04/F12 and owning services stop new admission and report bounded handoff status.
4. If handoff completes, F19 records completion, removes the tray icon, and permits process exit.
5. If handoff fails or remains uncertain, F19 keeps the process/tray alive where possible, preserves the intent, and presents a retryable diagnostic; it does not claim exit.

## Contract-Test Criteria

- **CT-F19-01:** Tray lifecycle remains present with and without a renderer; normal close/reload/crash never invokes shutdown.
- **CT-F19-02:** Equivalent F08/F12/downstream snapshots produce identical bounded tray entries, order, ten-entry overflow, state labels, and pause presentation.
- **CT-F19-03:** Every tray command validates its target and reaches only the declared F04/F12/F13 port; no command reaches AI, GitHub, Git, validation, publication, or arbitrary shell authority.
- **CT-F19-04:** Notification policy sends only the declared outcome categories, suppresses routine events, bounds text, and preserves provider-neutral references.
- **CT-F19-05:** Notification intent commits before native delivery; duplicate identity replay is idempotent; uncertain/denied/unsupported outcomes remain non-success until reconciled.
- **CT-F19-06:** Notification and tray activation queue and deliver one F04 target after window readiness, preserve stale/attention targets for inspection, and never authorize a workflow side effect.
- **CT-F19-07:** Open Worktree uses an F13-issued operation reference, rejects arbitrary/missing/out-of-bound paths, and never targets the developer clone.
- **CT-F19-08:** Pause/resume and per-PR hold fixtures remain independent, and pausing does not cancel explicitly started work or start new automatic review work.
- **CT-F19-09:** Shutdown fault injection proves commit-before-handoff, bounded failure/retry, idempotent repetition, truthful tray removal, and no false process-exit result.
- **CT-F19-10:** Windows Desktop A/B/C, notification action, file-manager, accessibility, secret-redaction, and renderer-absence evidence meets the platform contract.
- **CT-F19-11:** Two managed PR fixtures prove that a notification, activation, worktree-action, or delivery failure for one PR cannot overwrite, suppress, or mutate the other PR's native records or target; application-wide shutdown diagnostics remain application-scoped.

## Requirement Traceability

| Requirement family | Observable acceptance criteria | Contract tests |
|---|---|---|
| FR-01 | AC-01-AC-03, AC-13, AC-16 | CT-F19-01-CT-F19-02, CT-F19-10 |
| FR-02 | AC-02-AC-04, AC-09, AC-13, AC-17 | CT-F19-01-CT-F19-03, CT-F19-08 |
| FR-03 | AC-05-AC-08, AC-15, AC-18, AC-20 | CT-F19-04-CT-F19-05 |
| FR-04 | AC-07-AC-08, AC-14, AC-18-AC-19 | CT-F19-05, CT-F19-09, CT-F19-11 |
| FR-05 | AC-06, AC-09-AC-10, AC-15-AC-17 | CT-F19-03, CT-F19-06-CT-F19-07 |
| FR-06 | AC-11-AC-14, AC-18 | CT-F19-01, CT-F19-09 |
| FR-07 | AC-06, AC-09-AC-10, AC-15-AC-18 | CT-F19-03, CT-F19-06-CT-F19-10 |
| NFR-01-NFR-08 | AC-01-AC-20 | CT-F19-01-CT-F19-11 |
| INV-01-INV-11 | AC-01-AC-20 | CT-F19-01-CT-F19-11 |
