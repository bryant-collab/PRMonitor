<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single layer. The goal is to provide the AI and the user with a visible and testable result when the work is complete.
Note that while we're mentioning Stories here, we're not actually using tickets, this is just a convenient way of identifying slices within a plan. 
There might be slices that are needed to describe work that doesn't extend through all levels, that's fine, but the preference should be towards vertical slices since this will result in the best quality output.
-->

# Plan: F08 Managed-PR Inbox and Primary Review-State Presentation

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** `Specs/managed_pr_inbox_and_primary_review_state_presentation_PRD.md`
>
> **Last revalidated against:** `Specs/application_overview.md` revision 2026-09-21 and F08 PRD revision 2026-09-21
>
> **Entry/readiness gates:** F02 primary-state/reason/overlay contracts are available; F03 exposes restart-safe managed-PR and synchronization read repositories; F04 exposes validated versioned query/subscription IPC and provider-neutral open-target routing; F07 exposes the managed-PR projection and Details/Settings configuration targets. The desktop test harness provides injected clocks, renderer recreation, temporary persistence fixtures, fault injection, malformed-boundary fixtures, and accessibility probes.
>
> This PLAN cannot change product requirements. Resolve contradictions in the owning PRD before implementation and rerun both specification linters. This feature does not check the checklist item; implementation and approval are separate.

## Implementation Boundary

F08 adds a main-process-owned Managed PR Inbox read model, deterministic grouping/ordering projection, optional synchronization-status overlay projection, validated F04 query/subscription routes, and the React inbox screen/cards. It consumes F02 state/reason contracts, F03/F07 persisted projections, and F04 renderer-session/open-target contracts. The renderer is a replaceable view/controller: it receives one versioned snapshot, derives no authoritative state, and cannot call GitHub, SQLite, Git, AI, validation, or publication services.

F08 owns the user-visible presentation of the four primary PR states and the inbox's loading, empty, error, last-known, and restart-restored behavior. F08 does not own feedback polling, eligibility, holds, quiet-period scheduling, managed-PR creation, synchronization selection/source resolution, worktree operations, validation, AI work, notifications, publication, or shutdown. A synchronization overlay is a read-only projection seam for records created by F24-F27; its presence never changes the primary review state or group.

## Readiness Gates

- F02's primary state values are exactly `WATCHING`, `WORKING`, `READY_FOR_REVIEW`, and `NEEDS_ATTENTION`, and its structured reason/next-action data can be rendered without parsing prose.
- F03 exposes a query/read-model repository that returns current managed PRs with stable identity, explicit repository/reference data, version metadata, and persisted state/reason information after restart. It can also return optional synchronization status records without requiring F08 to call a provider or Git.
- F04 exposes allowlisted, schema-validated inbox query, subscription, error, and open-target contracts; renderer close/recreation cannot cancel authoritative work or release a hold; subscription identity prevents stale renderer callbacks.
- F07 exposes the canonical managed-PR identity, safe display metadata, current configuration revision, Details/Settings targets, and clear separation between local-clone setup metadata and primary PR state.
- The test harness can create multiple managed PR records with all four primary states, multiple repositories/forks, equal timestamps, held bundles, structured attention reasons, and optional synchronization statuses; it can restart the main process and recreate the renderer.
- Accessibility and UI test tooling can inspect semantic headings, group/card relationships, keyboard focus, live-region announcements, forced-colors/high-contrast behavior, reduced-motion behavior, and safe error recovery.

## Proposed Vertical Slices

1. **Authoritative inbox projection and deterministic grouping/order**
   - **Blocked by:** F02 state/reason contracts, F03 managed-PR query repository, F04 shared serialization boundary, and F07 managed-PR identity fields.
   - **Stories / requirements / acceptance criteria:** US-01-US-04; FR-01.1-FR-02.6, FR-06.1-FR-06.3; NFR-01-NFR-04; INV-01-INV-03, INV-05, INV-07-INV-09; AC-01-AC-05, AC-09-AC-11, AC-15.
   - **Visible result:** A deterministic projection fixture turns multiple persisted managed PRs into one versioned snapshot with action-needed, working, and watching groups, exact state labels, safe summaries, stable counts, and documented priority/tie-break ordering.
   - **Durable records / external effects:** Reads F03/F07 projections only. No database mutation, GitHub request, AI call, worktree operation, validation, publication, or hold transition occurs.
   - **Failure / cancellation / restart:** Duplicate identities, missing required state, explicit identity conflicts, unknown schema values, stale versions, and partial reads return bounded structured errors. Repeating the query is idempotent. Cancellation drops only the caller's read response and cannot change persisted state.
   - **Exact evidence:** Projection truth table for zero/one/many PRs and all state combinations; equal-timestamp tie-break matrix; fork/base/head identity cases; duplicate/stale/unknown-version rejection; deterministic repeated-run test with injected clock; `CT-F08-01` and `CT-F08-02`; `git diff --check`.
   - **Exit criterion:** AC-01-AC-05, AC-09, AC-11, and AC-15 pass, and F08 has one projection contract instead of renderer-specific state assembly.

2. **Main-process inbox query, subscription, and multi-PR happy path**
   - **Blocked by:** Slice 1, F04 IPC/session contracts, and F07 read-model availability.
   - **Stories / requirements / acceptance criteria:** US-01-US-04, US-07; FR-01.1-FR-01.5, FR-02.1-FR-02.6, FR-05.1-FR-05.3, FR-06.1-FR-06.3; NFR-01-NFR-04, NFR-06-NFR-07; INV-01-INV-03, INV-06-INV-10; AC-01-AC-05, AC-10-AC-15.
   - **Visible result:** Opening the desktop application shows several managed PR cards in deterministic groups and order. Each card exposes Details/Settings navigation through validated F04 targets, and live main-process projection updates are reflected without a renderer-owned polling loop.
   - **Durable records / external effects:** Creates only read-model/subscription correlation and renderer-session records required by F04. It does not create an operation, release a hold, or invoke an external service.
   - **Failure / cancellation / restart:** Renderer close, lost reply, duplicate subscription, or cancellation removes only the renderer delivery path. A second renderer establishes a fresh subscription and receives the current snapshot. Repeated navigation requests are idempotent view requests, not product actions.
   - **Exact evidence:** Electron/main-process integration fixture with 1, 50, and 250 managed PR sets; deterministic projection timing proving the 250-card projection completes within 50 ms in the standard test environment; IPC schema round trips; renderer recreation; duplicate subscription/reply-drop race; no-polling/no-AI/no-Git spy assertions; Details/Settings target validation; slow-read loading-state assertion; `CT-F08-05`.
   - **Exit criterion:** AC-01-AC-05, AC-10-AC-12, AC-14, and AC-15 pass in a running desktop surface.

3. **Accessible state cards, action-needed presentation, and truthful reasons**
   - **Blocked by:** Slice 2 and structured F02 reason/next-action data.
   - **Stories / requirements / acceptance criteria:** US-03-US-04, US-07-US-09; FR-02.1-FR-02.6, FR-05.1-FR-05.3, FR-07.2-FR-07.4; NFR-04-NFR-07; INV-02, INV-04, INV-06, INV-08, INV-10; AC-03-AC-05, AC-12-AC-16.
   - **Visible result:** `NEEDS_ATTENTION` and `READY_FOR_REVIEW` are prominent but unmistakably different; `WORKING` and `WATCHING` remain truthful non-action states. Cards expose readable what/why/next summaries and keyboard/assistive-technology operable Details/Settings controls.
   - **Durable records / external effects:** Stores no new product truth; UI state is derived from the accepted snapshot. Accessibility/test reports are bounded evidence only.
   - **Failure / cancellation / restart:** Missing reason data produces a safe fallback that does not invent completion or permission. Unsupported platform styling/capability is represented truthfully. Focus is restored after a failed navigation/read retry, and no UI action releases a hold or begins work.
   - **Exact evidence:** Semantic DOM and accessible-name report; keyboard-only traversal; focus/return-focus matrix; screen-reader/group-heading probe; forced-colors/high-contrast and reduced-motion checks; state/reason fallback fixtures; screenshot or visual review of all four states; `CT-F08-06`.
   - **Exit criterion:** AC-03-AC-05, AC-12-AC-16 pass and the inbox never relies on color, hover, or model prose to communicate a primary state.

4. **Synchronization overlay and independent update semantics**
   - **Blocked by:** Slices 1-3; F03 synchronization-result read contract; F24-F27 status vocabulary or a provider-neutral fixture representing it.
   - **Stories / requirements / acceptance criteria:** US-05-US-06; FR-03.1-FR-03.4, FR-06.1-FR-06.3; NFR-01, NFR-03-NFR-04, NFR-06-NFR-07; INV-02-INV-04, INV-06, INV-08-INV-09; AC-06-AC-07, AC-11, AC-13-AC-15.
   - **Visible result:** A PR card can show waiting, merging, conflict-resolution, ready, stale, failed, or published synchronization status in a separately labeled overlay while remaining in its primary review group. Overlay updates do not replace the primary card state or reason.
   - **Durable records / external effects:** Reads persisted synchronization result/status projections and records no merge, worktree, validation, AI, or publication effect.
   - **Failure / cancellation / restart:** Missing or unsupported overlay data is omitted with a truthful capability/result state; stale/duplicate overlay versions are ignored; overlay read failure does not clear the primary card or release a hold. Restart reconstructs the same available overlay from persisted data.
   - **Exact evidence:** Overlay status truth table; simultaneous primary/overlay update race; overlay-only update group-stability assertion; restart readback; missing/unsupported status fixture; no-mutation spies; `CT-F08-03` and APP-AC-49 shared-boundary evidence.
   - **Exit criterion:** AC-06-AC-07, AC-10-AC-11, AC-13-AC-15 pass and the synchronization overlay is visibly separate from the primary state machine.

5. **Loading, empty, last-known error, restart restoration, and handoff**
   - **Blocked by:** Slices 1-4, F03 restart-safe projections, and F04 renderer recreation.
   - **Stories / requirements / acceptance criteria:** US-01-US-02, US-07-US-09; FR-04.1-FR-04.4, FR-05.1-FR-05.3, FR-06.1-FR-07.4; all NFRs; all INVs; AC-08-AC-16; APP-AC-03, APP-AC-16, APP-AC-17, APP-AC-30, APP-AC-49, APP-AC-75.
   - **Visible result:** A recreated renderer and a restarted application restore multiple managed PR cards and their available overlays. Loading is distinct from empty, empty links to Add PR, a failed refresh retains labeled last-known data, and a successful retry replaces the snapshot atomically.
   - **Durable records / external effects:** Exercises existing F03/F04 records and read/subscription contracts. No new managed PR, operation, hold, worktree, validation, AI, synchronization, notification, or publication effect is started by the inbox.
   - **Failure / cancellation / restart:** Fault injection at initial read, subscription update, renderer close, process restart, duplicate replay, stale update, and retry proves no lost/duplicated durable state, no false empty state, no hold release, and no budget reset. A cancelled run leaves no success marker.
   - **Exact evidence:** Fresh/current/restarted database fixtures; renderer close/reopen smoke; last-known/error/retry matrix; loading-versus-empty assertions; out-of-order update race; `npm run build`, `npm test`, `npm run check`; accessibility evidence; `CT-F08-04` and `CT-F08-06`; no-secret/no-raw-URL read-model scan.
   - **Exit criterion:** AC-08-AC-16 pass end to end, the inbox can be reopened safely, and the handoff to F09-F12, F19-F20, and F24-F27 is explicit.

6. **Downstream conformance and specification handoff**
   - **Blocked by:** Slices 1-5 and all readiness gates.
   - **Stories / requirements / acceptance criteria:** US-01-US-09; all FRs, NFRs, and INVs; APP-AC-03, APP-AC-16, APP-AC-17, APP-AC-30, APP-AC-49, APP-AC-75; AC-01-AC-16; CT-F08-01-CT-F08-06.
   - **Visible result:** Thin fake consumers prove that F10 can update primary state without changing the inbox contract, F19 can open a managed-PR target, F20 can receive review-oriented navigation, and F24-F27 can supply an overlay without taking ownership of primary review grouping.
   - **Durable records / external effects:** Keeps only test-owned databases, bounded UI reports, and fixture data. It does not edit `checklist.md`, publish specifications, invoke real GitHub, use credentials, run AI, or push/merge Git.
   - **Failure / cancellation / restart:** Any missing identity, secret leak, raw provider/remote value, invalid mapping, primary/overlay coupling, stale-snapshot regression, accessibility failure, or unintended side effect blocks the gate. A cancelled run is rerunnable from fresh fixtures.
   - **Exact evidence:** `npm run build`, `npm test`, `npm run check`; projection/IPC/restart/accessibility reports; downstream contract matrix; no-effect and secret/path scan; `git diff --check`; `npm run lint:prd-plan -- Specs/managed_pr_inbox_and_primary_review_state_presentation_PRD.md Specs/managed_pr_inbox_and_primary_review_state_presentation_PLAN.md`; `npm run lint:application-coverage -- Specs/application_overview.md Specs/managed_pr_inbox_and_primary_review_state_presentation_PRD.md`.
   - **Exit criterion:** All F08 requirements have direct evidence, the mapped application criteria have no definite missing/invalid result, unresolved product choices are recorded, and the checklist item remains unchecked pending implementation approval and completion.

## Cross-Slice Verification and Handoff

- The exact owning PRD is `Specs/managed_pr_inbox_and_primary_review_state_presentation_PRD.md`; this PLAN does not add polling, event retrieval, AI, Git, worktree, validation, notification, publication, or synchronization-mutation requirements.
- F02 remains authoritative for the four primary PR states, structured reasons, automatic-review holds, and the rule that synchronization is an overlay. F08 must not add a local state machine or infer state from free-form activity/provider text.
- F03 remains authoritative for SQLite, transactions, restart-safe repositories, managed-PR identity, projection versions, and synchronization-result persistence. F08 reads those contracts and never writes ad hoc state merely to make the UI appear complete.
- F04 remains authoritative for main-process lifetime, renderer sessions, schema-validated IPC, subscriptions, and provider-neutral open targets. Renderer closure or lost IPC replies only affect presentation delivery.
- F07 remains authoritative for managed-PR creation, explicit base/head identities, local-clone setup, configuration revisions, and Details/Settings surfaces. F08 does not duplicate Add PR parsing or silently refresh remote metadata.
- F10-F12 own polling, eligibility, batching, Check Now, pause, and hold enforcement. F08 presents their persisted outputs; it does not start or stop those operations when cards are viewed or sorted.
- F19 owns tray/notification behavior and F20-F23 own detailed Review Bundle review/publication. F08 supplies stable navigation targets and inbox summaries without claiming the downstream workflow is implemented.
- F24-F27 own selection, source resolution, synchronization preparation, conflict handling, validation, review, and publication. F08 only presents their optional persisted overlay, preserving the primary review state and group.
- F28-F30 own complete recovery, threat-model hardening, packaging, and final acceptance. F08 supplies restart, boundary, accessibility, and no-effect evidence for those gates.
- The F08 checklist item remains unchecked. This specification phase creates only the PRD/PLAN pair and does not claim that multiple-PR watching, polling, synchronization, or review publication is implemented.

## Requirement-to-Slice Trace

| Requirement family | Owning slices |
|---|---|
| FR-01 | 1-2, 5-6 |
| FR-02 | 1-3, 5-6 |
| FR-03 | 4-6 |
| FR-04 | 5-6 |
| FR-05 | 2-3, 5-6 |
| FR-06 | 1-5 |
| FR-07 | 2-3, 5-6 |
| NFR-01-NFR-07 | 1-6 |
| INV-01-INV-10 | 1-6 |
| APP-AC-03 | 1-2, 5-6 |
| APP-AC-16-AC-17 | 3, 5-6 |
| APP-AC-30 | 5-6 |
| APP-AC-49 | 4-6 |
| APP-AC-75 | 3, 5-6 |
