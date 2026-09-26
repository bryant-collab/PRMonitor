<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single layer. The goal is to provide the AI and the user with a visible and testable result when the work is complete.
-->

# Plan: F19 System Tray, Native Notifications, Deep Links, and Shutdown

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** Specs/system_tray_native_notifications_deep_links_and_shutdown_PRD.md
>
> **Last revalidated against:** Specs/application_overview.md revision 2026-09-25 and F19 PRD revision 2026-09-25
>
> **Entry/readiness gates:** F04's lifecycle, validated routing, on-demand window, current-desktop, and shutdown contracts are implemented and tested; F08 exposes a versioned managed-PR read model; F09 exposes the bounded activity writer; F12 exposes pause/read/control and scheduler-status ports; F13 exposes operation-owned worktree open/reveal; F18 exposes the bounded Review Bundle outcome handoff; F03 persistence supports intent-before-effect transactions and restart-safe idempotent records. A deterministic synchronization-batch outcome fake is available for the future F24-F27 consumer. A Windows test environment can inspect the tray, native notification activation, file-manager action, and virtual-desktop behavior.
>
> This PLAN cannot change product requirements. Resolve contradictions in the owning PRD before implementation and rerun both specification linters. This feature does not check the checklist item; implementation and approval are separate.

## Implementation Boundary

F19 extends the Electron main process with a TrayNotificationCoordinator and its typed repositories/adapters. It owns tray presence and menu projection, outcome-oriented native notification policy and delivery records, safe activation targets, the notification Open Worktree action, and the user-facing Shutdown PRMonitor flow.

F19 consumes F04's lifecycle/window/deep-link/OS contracts, F08's managed-PR projection, F09's activity writer, F12's pause/scheduler ports, F13's canonical worktree-open contract, and F18's Review Bundle outcome handoff. It may add F19-owned notification/shutdown intent records through the F03 persistence boundary. It does not own primary PR states, Review Bundle semantics, polling, batching, AI, Git, validation, publication, synchronization truth, full restart/network recovery, or Windows virtual-desktop implementation.

## Readiness Gates

- F04's main-process lifecycle and validated routing contracts are available, including at-most-once target delivery after renderer readiness, current-desktop/focus results, and the explicit Shutdown PRMonitor lifecycle hook.
- F04's Desktop A/B/C spike has real Windows evidence or a documented platform fallback that F19 can consume; F19 cannot replace that evidence with a hidden renderer or a fake adapter.
- F08 exposes a versioned, bounded inbox read model with stable managed-PR identity, primary state, safe reason/summary, and working/action-needed projections.
- F09 accepts bounded notification, tray, target, worktree, pause, and shutdown events and preserves correlation/attempt identity without becoming authoritative state.
- F12 exposes idempotent Pause Watching/Resume Watching controls, current pause/read policy, and scheduler status; F19 does not create a second pause state machine.
- F13 exposes a typed operation/worktree reference that revalidates canonical ownership immediately before opening/revealing a path.
- F18 exposes a bounded ReviewBundleReadModel/outcome handoff with stage, state, counts, safe reason/next action, available worktree reference, and read-only proposed-response metadata; it does not send notifications.
- F03 exposes transaction fault injection, bounded codecs, and restart-safe repository patterns for notification delivery and shutdown intent records.
- A deterministic future synchronization-batch outcome contract/fake can represent ready-to-publish, attention/conflict, stale, and failed counts without implementing synchronization itself.
- The desktop harness can test renderer absence/recreation, keyboard and assistive-technology labels, forced colors/high contrast, reduced motion, and native adapter capability failures.

## Proposed Vertical Slices

1. **Versioned native-surface contracts, safe targets, and delivery records**
   - **Blocked by:** F03 persistence/codecs; F04 validated route/lifecycle result types; F08 managed-PR identities; F09 bounds/redaction; F13 operation/worktree references; F18 outcome handoff shape.
   - **Stories / requirements / acceptance criteria:** US-03-US-06; FR-03.1-FR-05.7, FR-07.1-FR-07.3; NFR-02-NFR-05, NFR-07-NFR-08; INV-04-INV-06, INV-08-INV-10; AC-05-AC-10, AC-15, AC-17-AC-19; CT-F19-03-CT-F19-07, CT-F19-11.
   - **Implementation:** Define the versioned NativeTarget union, bounded tray entry, notification intent, outcome snapshot, worktree action, adapter capability/result, and shutdown intent contracts. Add the F03-backed notification delivery/shutdown records, canonical idempotency identities, safe template catalog, and redaction/validation fixtures. Publish the ten-entry tray bound, effective delegated payload bounds, one-initial-plus-one-startup-reconciliation automatic delivery bound, F04 activation-queue bound, and F04 shutdown timeout in the snapshot used by the coordinator.
   - **Visible result:** Contract fixtures can build a tray entry and notification for a Review Bundle outcome, resolve a safe target, and reject arbitrary URL/path/command/secret-shaped input before any native effect.
   - **Durable records / external effects:** Adds only F19 schema/repository fixtures and migration records; no real tray, notification, filesystem, GitHub, AI, validation, or publication effect.
   - **Failure / cancellation / restart:** Invalid bounds, unknown versions, duplicate identities, changed canonical payloads, missing targets, and redaction failure fail closed. A cancellation before the intent commit creates no authoritative delivery; a cancellation after commit leaves a replayable pending/unknown record.
   - **Exact evidence:** Target/entry/result schema corpus; explicit effective-bound table; canonical identity vectors; intent-state transition table; secret/raw-SDK/path/command rejection corpus; migration fixture; two-PR identity-isolation fixture; CT-F19-03-CT-F19-07, CT-F19-11; git diff --check.
   - **Exit criterion:** AC-05-AC-10 and AC-17-AC-19 are proven at the shared contract boundary, and later slices have one safe identity/delivery model.

2. **Persistent tray lifecycle, projection, menu, and pause controls**
   - **Blocked by:** Slice 1, F04 main-process lifecycle/window ports, F08/F12 read models, and the desktop test harness.
   - **Stories / requirements / acceptance criteria:** US-01-US-02, US-07; FR-01.1-FR-02.6, FR-04.7-FR-04.8, FR-07.4-FR-07.6; NFR-01-NFR-02, NFR-04, NFR-06-NFR-08; INV-01-INV-04, INV-07-INV-08, INV-11; AC-01-AC-04, AC-13, AC-16, AC-18-AC-19; CT-F19-01-CT-F19-03, CT-F19-08, CT-F19-10-CT-F19-11.
   - **Implementation:** Start one tray coordinator from the main process, rebuild a deterministic menu with exactly ten actionable entries plus More in PRMonitor from versioned F08/F12/downstream summaries, expose Open PRMonitor, PR/Review Bundle navigation, Pause Watching/Resume Watching, and Shutdown PRMonitor command seams, and connect safe F09 activity.
   - **Visible result:** With the renderer closed, the tray remains present, shows action-needed/working/paused state, recreates the menu after read-model updates, and routes pause/open commands through typed ports.
   - **Durable records / external effects:** Persists tray capability/lifecycle diagnostics and pause request correlation; calls the OS tray adapter and F12 pause port. It does not invoke AI, GitHub, Git, validation, publication, or worktree mutation.
   - **Failure / cancellation / restart:** Duplicate read-model updates and commands are no-ops or return the existing result. Renderer destruction does not remove the tray. Tray capability failure leaves background work alive and exposes a bounded diagnostic. Pause failure preserves the prior committed overlay; it never guesses success.
   - **Exact evidence:** No-renderer startup/close/recreate smoke; deterministic 0/1/10/11/overflow tray projection table; primary-state/paused-overlay independence; two-PR menu-isolation fixture; pause/resume idempotency and hold-preservation fixture; adapter denied/unavailable matrix; keyboard/semantic menu inspection; CT-F19-01-CT-F19-03, CT-F19-08, CT-F19-10-CT-F19-11.
   - **Exit criterion:** AC-01-AC-04, AC-13, and AC-16-AC-19 pass, with no second tray or pause state machine.

3. **Outcome policy, native notification delivery, and reconciliation**
   - **Blocked by:** Slices 1-2, F18 consumer fixture, F09 activity, and the native notification adapter/fake.
   - **Stories / requirements / acceptance criteria:** US-03-US-04; FR-03.1-FR-04.8, FR-07.1-FR-07.4; NFR-01-NFR-05, NFR-08; INV-04-INV-05, INV-09-INV-11; AC-05-AC-08, AC-14-AC-15, AC-18-AC-20; CT-F19-04-CT-F19-05, CT-F19-09, CT-F19-11.
   - **Implementation:** Implement deterministic outcome classification and bounded templates for proposal ready, final review ready, required input, failed/interrupted validation, and synchronization-batch outcomes. Persist intent before native delivery, pass only opaque target/action identities to the adapter, record denied/unavailable/failed/unknown outcomes, reconcile duplicate/restarted attempts, and keep records keyed by managed-PR/outcome identity so one PR's failed delivery cannot suppress another PR's notification. For synchronization, accept only a committed F24-F27 outcome reference and bounded display summary; do not reconstruct or persist the authoritative synchronization result.
   - **Visible result:** A fake F18 outcome creates one native notification with safe summary, target, and optional worktree action; routine poll/progress fixtures create none; an absent or incomplete synchronization result creates a bounded pending/unavailable diagnostic rather than a notification; the delivery record reopens after restart with truthful status.
   - **Durable records / external effects:** Adds notification intent/delivery records and F09 events; invokes only the native notification adapter. No workflow state or remote effect changes when delivery fails.
   - **Failure / cancellation / restart:** Crash before intent leaves no delivery; crash after intent returns a pending/unknown reconciliation state; duplicate identity does not spam; denied permission is visible as unavailable/denied and does not mark the Review Bundle published/handled; failure for one PR leaves other PR delivery records and notifications unchanged.
   - **Exact evidence:** Notification policy matrix; no-notify routine fixtures; explicit delegated-bound report; bounded text/reference/redaction report; persist-before-effect fault injection; duplicate/canonical-payload conflict table; permission/unsupported/timeout/unknown adapter matrix; restart readback; two-PR failure-isolation fixture; CT-F19-04-CT-F19-05, CT-F19-09, CT-F19-11.
   - **Exit criterion:** AC-05-AC-08, AC-14-AC-15, and AC-18-AC-20 pass, and all notification categories remain downstream projections rather than workflow state.

4. **Deep-link activation, current-desktop routing, and safe target delivery**
   - **Blocked by:** Slices 1-3, F04 route queue/window readiness/current-desktop adapter, F08/F18 target identities, and a synchronization-batch fake.
   - **Stories / requirements / acceptance criteria:** US-05; FR-02.2-FR-02.3, FR-05.1-FR-05.4, FR-07.3-FR-07.6; NFR-01-NFR-04, NFR-06-NFR-08; INV-01-INV-03, INV-08-INV-10; AC-09, AC-15-AC-17, AC-19; CT-F19-03, CT-F19-06, CT-F19-10-CT-F19-11.
   - **Implementation:** Map tray and notification actions to F04's validated provider-neutral routes for inbox, PR, Review Bundle, and synchronization batch. Coalesce duplicate activation identities, queue before renderer readiness, and preserve a retryable target after focus/foreground failure.
   - **Visible result:** Clicking a notification with no window creates one current-desktop window and opens the exact persisted target once; clicking a stale/attention result opens inspection only; duplicate activation does not start work or create a second window.
   - **Durable records / external effects:** Persists bounded activation/correlation diagnostics and invokes the F04 route/window adapter. No approval, AI, Git, validation, or publication effect.
   - **Failure / cancellation / restart:** Malformed/oversized/secret/unknown targets are rejected before adapter invocation. Renderer close during delivery drops only the reply; F04 retains safe queue semantics. Focus denial preserves the target and reports retryable limitation. Process restart replays only an unconsumed target identity. A failed target for one PR cannot replace or suppress another PR's queued target.
   - **Exact evidence:** Target parser/allowlist table; explicit F04 queue-bound report; pre-ready queue and exactly-once delivery test; duplicate/secondary-launch fixture; stale/attention navigation no-effect spy; current-desktop A/B/C route report; two-PR target-isolation fixture; raw URL/path/command rejection scan; CT-F19-03, CT-F19-06, CT-F19-10-CT-F19-11.
   - **Exit criterion:** AC-09, AC-15-AC-17, and AC-19 pass, and F19 never calls native window APIs outside F04.

5. **Open Worktree action through F13 and the OS shell**
   - **Blocked by:** Slices 1-4, F13 canonical path/ownership contract, F18 worktree reference, and the OS file-manager adapter.
   - **Stories / requirements / acceptance criteria:** US-06; FR-03.5-FR-03.6, FR-05.5-FR-05.7, FR-07.1-FR-07.3; NFR-03-NFR-07; INV-05-INV-06, INV-09-INV-10; AC-06, AC-10, AC-17, AC-19; CT-F19-03, CT-F19-07, CT-F19-10-CT-F19-11.
   - **Implementation:** Add notification Open Worktree action handling and the shared F19 target resolver. Revalidate the persisted F13 worktree reference immediately before asking the OS to open/reveal it; implement the unsupported-action fallback to the related Review Bundle.
   - **Visible result:** A notification action opens the exact Review Bundle worktree in a test-owned file manager adapter; missing, changed, or unauthorized paths show an actionable diagnostic and never fall back to the developer clone.
   - **Durable records / external effects:** Records worktree-action intent/result and F09 activity; invokes only F13 validation and the OS file-manager adapter. It does not modify Git or files.
   - **Failure / cancellation / restart:** Duplicate action is idempotent; path removal, ownership mismatch, adapter denial, or renderer closure preserves the worktree and returns a safe non-success result. A changed application worktree root does not rewrite the recorded path. One PR's unavailable worktree never changes another PR's recorded path or action result.
   - **Exact evidence:** F13 reference/ownership matrix; developer-clone negative test; path-escape/URL/command corpus; missing/denied/unsupported file-manager table; two-PR path-isolation fixture; notification-to-worktree target report; CT-F19-07, CT-F19-10-CT-F19-11.
   - **Exit criterion:** AC-06, AC-10, AC-17, and AC-19 pass with APP-AC-38's F13/F20 boundary explicit.

6. **Explicit Shutdown PRMonitor and bounded lifecycle handoff**
   - **Blocked by:** Slices 1-5, F04 shutdown hook, F12 admission/pause port, F03 transaction fault injection, and active-operation service fakes.
   - **Stories / requirements / acceptance criteria:** US-08; FR-02.1, FR-04.7-FR-04.8, FR-06.1-FR-07.6; NFR-01, NFR-03-NFR-08; INV-01-INV-03, INV-07, INV-09-INV-11; AC-11-AC-14, AC-18-AC-19; CT-F19-01, CT-F19-03, CT-F19-09, CT-F19-11.
   - **Implementation:** Add the ShutdownCoordinator. Persist intent before handoff, stop new admission through F04/F12/owning ports, await the bounded F04 lifecycle result, record progress/failure, remove the tray only after truthful completion, and return an idempotent existing result for repeated requests. Keep a retryable tray/diagnostic surface when handoff is delayed or unknown, as confirmed by PD-12.
   - **Visible result:** Selecting Shutdown PRMonitor produces a bounded progress/completed/attention result, preserves active durable records, removes the tray and exits only on completion, and never treats window close as shutdown.
   - **Durable records / external effects:** Persists shutdown intent and lifecycle outcome, appends F09 events, calls F04 handoff and downstream stop-admission hooks, removes the native tray, and permits process exit. It does not delete worktrees or rewrite operation budgets.
   - **Failure / cancellation / restart:** Crash before intent does not stop services. Crash after intent is recovered by identity. Handoff timeout/failure leaves the process/tray alive where possible with a retryable reason. Repeated shutdown is idempotent. A renderer cannot bypass or cancel the lifecycle protocol. Application-wide shutdown state is never written into a PR-scoped outcome record.
   - **Exact evidence:** Close-versus-shutdown trace; commit-before-handoff fault matrix; active-operation/pause/hold preservation fixture; explicit F04 timeout report; timeout/partial-handoff/unknown outcome table; repeated request replay; tray removal only after completion; restart readback; application-scope versus PR-scope record check; CT-F19-01, CT-F19-09, CT-F19-11.
   - **Exit criterion:** AC-11-AC-14 and AC-18-AC-19 pass, with truthful process-exit behavior and no forced destructive cleanup.

7. **Cross-feature Windows, accessibility, restart, and release gate**
   - **Blocked by:** Slices 1-6, all upstream contracts, future synchronization consumer fixture, and the repository's check/linter commands.
   - **Stories / requirements / acceptance criteria:** US-01-US-08; all FRs, NFRs, and INVs; APP-AC-15, APP-AC-16, APP-AC-17-APP-AC-20, APP-AC-30-APP-AC-31, APP-AC-38, APP-AC-49, APP-AC-75; AC-01-AC-19; CT-F19-01-CT-F19-11.
   - **Implementation:** Run the end-to-end main-process flow with deterministic fakes and Windows smoke evidence. Verify tray presence with renderer closure, actionable notification transitions, no-notify routine events, target delivery on the active desktop, Open Worktree safety, pause/hold separation, shutdown handoff, restart reconciliation, accessibility, redaction, and authority boundaries. Add consumer conformance fixtures for F20 and F24-F27.
   - **Visible result:** One bounded evidence report demonstrates background monitoring, review/attention notifications, direct target opening, safe worktree action, pause, and explicit shutdown from a clean process without external credentials or publication.
   - **Durable records / external effects:** Uses test-owned databases, temporary operation paths, fake outcome/read-model providers, fake native adapters, bounded evidence, and linter reports. It does not modify checklist.md, contact GitHub, invoke a real AI provider, publish code/responses, or change remote state.
   - **Failure / cancellation / restart:** Any duplicate tray/notification/process, false delivery/exit, route/path escape, secret leak, routine notification, hold release, cross-PR contamination, AI/publication reachability, accessibility failure, invalid mapping, or definite linter miss blocks the gate. A cancelled run leaves no success marker and can be rerun from clean fixtures.
   - **Exact evidence:** npm run check; tray lifecycle/overflow report; explicit F19 bound report; notification policy/delivery/reconciliation report; F04 route/current-desktop/queue/timeout report; F13 worktree action report; pause/hold matrix; two-PR isolation report; shutdown fault/restart report; accessibility/forced-colors/reduced-motion evidence; secret/raw-SDK/arbitrary-path/authority scan; git diff --check; npm run lint:prd-plan -- Specs/system_tray_native_notifications_deep_links_and_shutdown_PRD.md Specs/system_tray_native_notifications_deep_links_and_shutdown_PLAN.md; npm run lint:application-coverage -- Specs/application_overview.md Specs/system_tray_native_notifications_deep_links_and_shutdown_PRD.md.
   - **Exit criterion:** All F19 requirements have direct or named contract-test evidence, mapped application criteria have no definite missing/invalid result, confirmed product decisions are recorded, and the F19 checklist item remains unchecked pending implementation approval and completion.

## Cross-Slice Verification and Handoff

- The exact owning PRD is Specs/system_tray_native_notifications_deep_links_and_shutdown_PRD.md; this PLAN does not add Review Bundle decisions, diff rendering, polling, AI, Git, validation, synchronization, publication, or full recovery requirements.
- F04 remains authoritative for main-process lifetime, renderer closure/recreation, validated IPC, deep-link parsing/queueing, current-desktop focus, native window ownership, and lifecycle handoff. F19 never calls BrowserWindow or platform activation APIs directly.
- F08 remains authoritative for managed-PR identity, primary state, reason/next-action data, and inbox projection. F19 may summarize those values but cannot create a competing PR state machine.
- F09 remains an evidence/diagnostic layer. F19 writes bounded notification/tray/target/shutdown activity, but no missing or reordered activity event changes notification deduplication, tray state, pause, shutdown, or workflow outcome.
- F10/F12 remain authoritative for polling cadence, quiet-period batches, global Pause Watching, automatic dispatch gates, and explicit-vs-automatic work. F19 neither proves nor implements APP-AC-04 polling; it invokes pause/resume through F12 and never creates a second pause flag or dispatch path.
- F13 remains authoritative for operation ownership, canonical worktree paths, path safety, and open/reveal authorization. F19 passes only F13-issued references and never accepts or constructs an arbitrary path.
- F18 remains authoritative for Review Bundle stage/state, review evidence, hold semantics, and the bounded outcome handoff. F19 sends a notification only as a projection and never releases a hold or changes a bundle.
- F20-F23 own the Review Bundle workspace, conversation/revision, stale/discard/re-evaluation, and publication actions. F19 target activation opens those surfaces without granting their actions.
- F24-F27 own synchronization selection, merge/conflict truth, complete synchronization-result persistence, validation, stale handling, and publication. F19 is only the APP-AC-49 integration boundary: it contributes the bounded outcome summary and deep link after a committed authoritative result reference, refuses absent/incomplete results, and never claims the full criterion or creates a fallback persistence model. Its synchronization adapter is a typed consumer contract tested with fakes until those features integrate.
- F20 owns the full Review Bundle visual distinction and review controls for APP-AC-75. F19 contributes the semantic ready/attention category, reason, and next-action data used by native surfaces.
- F28-F30 own startup/restart hardening, threat-model review, packaging, and final Windows acceptance. F19 supplies durable intent/reconciliation, native-surface, and no-effect evidence.
- The application-coverage decisions are explicit: F19 is primary for APP-AC-15, APP-AC-18, APP-AC-19, and APP-AC-31; shared for APP-AC-16, APP-AC-17, APP-AC-20, APP-AC-30, APP-AC-38, and APP-AC-75; provides boundary-only evidence for APP-AC-05 and APP-AC-06 without owning polling, unchanged detection, eligibility, or AI dispatch; and is only the integration boundary—not the full-criterion owner—for APP-AC-49. APP-AC-04 and APP-AC-69 are explicitly not applicable to F19. F04/F08/F09/F10/F11/F12/F13/F18/F20 and later owners retain the boundaries described in the PRD.
- The F19 checklist item remains unchecked. These documents create no application code, do not change checklist.md, and do not claim that tray presence, native notifications, deep links, worktree opening, or shutdown is implemented.

## Requirement-to-Slice Trace

| Requirement family | Owning slices |
|---|---|
| FR-01 | 1-2, 7 |
| FR-02 | 2, 4, 6-7 |
| FR-03 | 1, 3-4, 7 |
| FR-04 | 1, 3, 6-7 |
| FR-05 | 1, 4-5, 7 |
| FR-06 | 1, 6-7 |
| FR-07 | 1-7 |
| NFR-01-NFR-08 | 1-7 |
| INV-01-INV-11 | 1-7 |
| APP-AC-05-APP-AC-06 | 1, 3, 7 |
| APP-AC-15, APP-AC-18-APP-AC-20 | 1-7 |
| APP-AC-16, APP-AC-17, APP-AC-30-APP-AC-31, APP-AC-38, APP-AC-49, APP-AC-75 | 2-7 |
