<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single layer. The goal is to provide the AI and the user with a visible and testable result when the work is complete.
There might be slices that are needed to describe work that doesn't extend through all levels, that's fine, but the preference should be towards vertical slices since this will result in the best quality output.
-->

# Plan: F09 Durable Activity Log and Operation Diagnostics

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** `Specs/durable_activity_log_and_operation_diagnostics_PRD.md`
>
> **Last revalidated against:** `Specs/application_overview.md` revision 2026-09-21 and F09 PRD revision 2026-09-21
>
> **Entry/readiness gates:** F03 exposes the existing `activity_events` storage seam, versioned codecs, transaction composition, injected clocks, restart fixtures, and safe bounded persistence errors. F04 exposes validated query/subscription/navigation IPC and renderer recreation. F08 exposes managed-PR identities and the primary inbox/read-model conventions. F00/F03 redaction and safe-output contracts are available. Test infrastructure can inject concurrent writers, process interruption, cancellation, malformed IPC values, renderer absence, and accessibility probes.
>
> This PLAN cannot change product requirements. Resolve contradictions in the owning PRD before implementation and rerun both specification linters. This feature does not check the checklist item; implementation and approval are separate.

## Implementation Boundary

F09 adds a main-process-owned structured activity contract, append/query repositories over F03 persistence, correlation propagation, deterministic redaction, bounded retention, provider-neutral work-item formatting, validated F04 routes, and an accessible activity viewer. The feature extends the F03-provisioned `activity_events` table/repository rather than creating a second database or renderer-local log.

F09 owns the meaning and safe presentation of diagnostic events. It does not own PR state, holds, event eligibility, Review Bundles, AI Work Reports, validation truth, synchronization results, publication phases, notifications, or recovery policy. Downstream features call one typed append port and retain their own authoritative records. The activity viewer may summarize or link to those records, but neither the viewer nor a missing activity row can authorize or infer work.

## Readiness Gates

- F03 can apply an additive migration to the existing `activity_events` table, validate versioned safe payloads, compose an activity write with an owning transaction, and read committed events after renderer closure and process restart.
- F03 provides parameterized/bounded statements, optimistic/idempotent repository patterns, a deterministic UTC clock, transaction fault injection, and safe persistence errors that exclude SQL values, credentials, prompts, and uncontrolled exceptions.
- F04 provides allowlisted versioned activity query, subscription/update, error, and related-target routing contracts; renderer close or IPC cancellation affects delivery only.
- F08 provides canonical managed-PR/repository identities and a navigation/read-model seam without using free-form activity as primary state.
- F00/F03's bounded output and redaction behavior is available or a conformance adapter has been approved; the adapter fails closed when redaction cannot be completed.
- Test fixtures can create polling, batch, AI, validation, notification, synchronization, publication, lifecycle, retry, uncertain-outcome, active-hold, and user-actionable owner records without real credentials or external side effects.
- The desktop test harness can inspect semantic timeline relationships, keyboard focus, live-region announcements, high-contrast/forced-colors behavior, reduced motion, and safe error/retry states.

## Proposed Vertical Slices

1. **Versioned event envelope, catalog, work-item reference, and redaction contract**
   - **Blocked by:** F03 safe codecs/size limits, F00/F03 output-redaction rules, and F08 provider-neutral identity conventions.
   - **Stories / requirements / acceptance criteria:** US-01, US-02, US-06, US-07; FR-01.1-FR-01.4, FR-05.1-FR-05.3, FR-07.1-FR-07.4, FR-09.1-FR-09.3; NFR-01, NFR-05-NFR-07; INV-01-INV-04, INV-06; AC-01, AC-02, AC-05, AC-06, AC-11, AC-13, AC-15.
   - **Visible result:** A shared contract fixture accepts a canonical safe event, renders its structured reason/work-item label, rejects unknown/oversized/secret-shaped values, and produces the same canonical hash for equivalent key ordering.
   - **Durable records / external effects:** Creates only versioned schema/codec fixtures and bounded test data. No production database mutation, network, provider, child process, notification, Git, worktree, validation, or publication effect occurs.
   - **Failure / cancellation / restart:** Invalid timestamps, identifiers, event types, reasons, work-item references, control characters, provider-shaped objects, raw prompts, and redaction failures fail closed before storage/IPC. A cancelled validation call returns no accepted event. Repeating the contract check is deterministic.
   - **Exact evidence:** Event envelope truth table; event/severity/reason/stage/next-action allowlist; canonicalization/hash vectors; `WorkItemRef` Jira-style/GitHub fallback matrix; size/control-character tests; chunked/nested/secret-shaped redaction tests; unknown-schema and raw-SDK rejection; `CT-F09-01`, `CT-F09-05`, and `CT-F09-07`; `git diff --check`.
   - **Exit criterion:** AC-01, AC-05, AC-06, AC-11, and AC-15 pass at the shared contract boundary, and all later slices use one safe event envelope and one work-item formatter.

2. **Durable append, correlation, idempotency, and migration**
   - **Blocked by:** Slice 1, F03 migration/transaction support, and the F02/F03 owner/version conventions.
   - **Stories / requirements / acceptance criteria:** US-01-US-03, US-07; FR-02.1-FR-02.4, FR-03.1-FR-03.5, FR-08.1-FR-08.4; NFR-01-NFR-04, NFR-08; INV-01-INV-06, INV-08; AC-01-AC-03, AC-07, AC-09, AC-10, AC-14, AC-16.
   - **Visible result:** A main-process `ActivityWriter` appends a root operation event and child/attempt events to the F03-backed database, returns inserted/replayed/conflict/rejected/unavailable outcomes, and reconstructs the same correlation chain after a fresh process.
   - **Durable records / external effects:** Adds the additive F09 activity migration/metadata, indexes for owner/time/severity/reason/work-item lookup, canonical payload hash/idempotency enforcement, and transaction fixtures. Each stored event keeps only provider-neutral owner identifiers and optional version/revision links; it does not copy mutable domain state into a competing activity state machine. It has no GitHub, AI, Git, validation, notification, or publication effect.
   - **Failure / cancellation / restart:** Duplicate event identity with equal canonical payload is a replay; changed payload is a conflict; a process stop before commit exposes no partial row; a stop/cancellation after commit exposes the committed event. Both occurrence and recording timestamps come from the injected UTC clock in fixtures and the main-process clock in production, with an explicit timezone. Concurrent writers use bounded retry/conflict handling. Renderer absence does not prevent append, and restart does not create a new correlation or duplicate event.
   - **Exact evidence:** Fresh/current/upgrade database fixtures; additive migration and rollback/fault matrix; insert/replay/conflict/concurrent-writer table; transaction fault injection before/between/after writes; cancellation-before/after-commit test; renderer-absent append; process-stop/reopen correlation readback; `CT-F09-02`, `CT-F09-03`, and `CT-F09-06`.
   - **Exit criterion:** AC-01-AC-03, AC-07, AC-09, AC-10, AC-14, and AC-16 pass, and the writer can be composed with an owning F03 transaction without creating a second state or authorization path.

3. **Consumer adapters and operation diagnostic lifecycle**
   - **Blocked by:** Slice 2 plus provider-neutral operation contracts from F10-F18 and F24-F27; use deterministic fakes where downstream production features are not yet implemented.
   - **Stories / requirements / acceptance criteria:** US-01-US-03; FR-03.2-FR-03.6, FR-08.2-FR-08.4; NFR-01-NFR-03, NFR-05, NFR-08; INV-03, INV-06-INV-08; AC-03, AC-05, AC-07, AC-10, AC-12-AC-14, AC-16.
   - **Visible result:** Fake polling, batching, AI, validation, notification, synchronization, and publication consumers emit the same start/wait/progress/terminal/cancel/failure/recovery events. The viewer-facing projection shows one correlated chain per operation and preserves attempt/uncertain-outcome distinctions.
   - **Durable records / external effects:** Adds adapter contracts and source-specific event mappings. Production tests use fakes/spies; no real remote request, AI invocation, validation command, notification, Git operation, worktree mutation, commit, push, response, or merge occurs.
   - **Failure / cancellation / restart:** A consumer can lose the renderer, be cancelled, fail to append, or be interrupted after an external-effect attempt. Critical intent/terminal evidence uses the F03 transaction boundary; an unavailable activity writer returns a structured degraded diagnostic and never broadens authority. Owning domain state remains authoritative and is not reconstructed from activity.
   - **Exact evidence:** Consumer-to-event mapping matrix; root/child/attempt correlation fixture; intent-before-effect and terminal-evidence transaction tests; AI/validation usage summary redaction; uncertain publication/synchronization attempt fixture; no-AI/no-network/no-side-effect spies; activity-pruning independence test; `CT-F09-02`, `CT-F09-03`, and `CT-F09-07`.
   - **Exit criterion:** AC-03, AC-05, AC-07, AC-10, AC-12-AC-14, and AC-16 pass for all seven consumer categories, and no consumer imports provider SDK types or treats event text as application state.

4. **Bounded activity query, viewer, and safe related navigation**
   - **Blocked by:** Slices 1-3, F04 query/subscription/navigation contracts, F08 managed-PR identities, and the desktop accessibility harness.
   - **Stories / requirements / acceptance criteria:** US-02, US-04, US-06; FR-04.1-FR-04.6, FR-05.1-FR-05.3, FR-09.1-FR-09.3; NFR-03, NFR-05-NFR-08; INV-01, INV-07-INV-08; AC-04-AC-06, AC-09, AC-12, AC-15.
   - **Visible result:** The desktop application exposes an Activity view with a correlated timeline/tree, deterministic filters, a stable cursor, severity/reason/stage labels, work-item display, safe details, related-record navigation, and truthful loading/empty/last-known/error/no-results states.
   - **Durable records / external effects:** Reads F03 activity records and creates only versioned query/subscription delivery state. Related navigation uses F04 targets and may request the owning UI surface, but F09 does not start product work or call external services.
   - **Failure / cancellation / restart:** Invalid filters, cursors, targets, oversized responses, stale/duplicate updates, renderer disconnect, read cancellation, and missing/pruned owners return bounded safe results. A failed refresh retains the last valid snapshot when available; an unavailable target is labeled without exposing an arbitrary URL/path or clearing activity.
   - **Exact evidence:** Filter and cursor truth table; 0/1/200/10,000-event fixtures; correlation grouping and out-of-order update test; managed-PR/work-item/reason/severity/stage filters; related-target schema rejection; renderer recreation; loading/empty/last-known/error/no-results screenshots or semantic reports; keyboard/screen-reader/focus/live-region/forced-colors/reduced-motion checks; `CT-F09-04`, `CT-F09-05`, and `CT-F09-07`.
   - **Exit criterion:** AC-04-AC-06, AC-09, AC-12, and AC-15 pass in a running desktop surface, with the viewer remaining read-only and provider-neutral.

5. **Retention, restart recovery, and operational safeguards**
   - **Blocked by:** Slices 1-4, F03 restart/maintenance transactions, and owner adapters that can report active/user-actionable protection.
   - **Stories / requirements / acceptance criteria:** US-03-US-05, US-07; FR-06.1-FR-06.4, FR-07.1-FR-07.4, FR-08.1-FR-08.4; NFR-02-NFR-05, NFR-08; INV-04, INV-05, INV-08; AC-08-AC-11, AC-14, AC-16.
   - **Visible result:** Activity history remains within the documented 30-day/50,000-event/64-MiB policy, protects active or user-actionable chains, reports the retention boundary, and recovers safely after process interruption or cleanup failure.
   - **Durable records / external effects:** Adds retention metadata/maintenance outcomes and test fixtures. It may delete only eligible rows from the local activity table; it never deletes domain records, worktrees, remote data, credentials, or authoritative operation history.
   - **Failure / cancellation / restart:** Age/count/size pressure selects records by stable `(recordedAt, eventId)` order. Protected chains survive. A cleanup transaction is all-or-nothing; interruption or cancellation leaves existing records intact and retries safely. Activity unavailability is not treated as successful operation completion, deletion, or permission to skip deterministic checks.
   - **Exact evidence:** Age/count/size boundary table; active/user-actionable protection fixtures; maintenance failure and process-stop recovery; concurrent append/retention race; authoritative-record preservation; redaction/database/IPC/UI secret scan; uncertain-outcome and last-known viewer recovery; `CT-F09-06` and `CT-F09-07`.
   - **Exit criterion:** AC-08-AC-11, AC-14, and AC-16 pass, hard bounds remain enforced, and retention cannot rewrite or become a prerequisite for any owning workflow's result.

6. **Downstream conformance, accessibility handoff, and specification gate**
   - **Blocked by:** Slices 1-5, all readiness gates, and deterministic fake contracts for every downstream consumer category.
   - **Stories / requirements / acceptance criteria:** US-01-US-07; all FRs, NFRs, and INVs; AC-01-AC-16; CT-F09-01-CT-F09-07; shared APP-AC diagnostic mappings in the PRD.
   - **Visible result:** Thin conformance consumers prove that F10-F12, F13-F18, F19-F23, and F24-F27 can append and query correlated events through the same contract, while F08/F04 can open the viewer and related targets without coupling primary state to activity text.
   - **Durable records / external effects:** Uses test-owned databases, fixture records, bounded accessibility reports, and linter reports only. It does not edit `checklist.md`, publish specifications, call real GitHub/AI, send notifications, mutate worktrees, commit/push, post responses, merge branches, or change remote state.
   - **Failure / cancellation / restart:** Any invalid mapping, missing event source, duplicate/corrupt record, secret leak, raw provider/platform value, state inference from prose, retention violation, accessibility failure, or unintended side effect blocks the gate. A cancelled conformance run is rerunnable from fresh fixtures.
   - **Exact evidence:** `npm run build`, `npm test`, `npm run check`; all CT-F09 reports; consumer mapping matrix; restart/renderer recreation evidence; cursor/performance/retention reports; accessibility and redaction scans; `git diff --check`; `npm run lint:prd-plan -- Specs/durable_activity_log_and_operation_diagnostics_PRD.md Specs/durable_activity_log_and_operation_diagnostics_PLAN.md`; `npm run lint:application-coverage -- Specs/application_overview.md Specs/durable_activity_log_and_operation_diagnostics_PRD.md`.
   - **Exit criterion:** All F09 requirements have direct evidence, the mapped application criteria have no definite missing/invalid result, unresolved product choices are recorded, and the F09 checklist item remains unchecked pending implementation approval and completion.

## Cross-Slice Verification and Handoff

- The exact owning PRD is `Specs/durable_activity_log_and_operation_diagnostics_PRD.md`; this PLAN does not add polling, AI semantics, validation execution, notification policy, synchronization behavior, publication authority, or a new application state machine.
- F03 remains authoritative for SQLite, migrations, transaction durability, codecs, owner/version guards, authoritative operation/result repositories, and the existing `activity_events` storage seam. F09 extends that seam with a stable event/query contract and never writes ad hoc renderer state.
- F04 remains authoritative for main-process lifetime, preload/renderer validation, subscriptions, window recreation, and provider-neutral navigation/open targets. Renderer closure or lost replies affect delivery only.
- F08 remains authoritative for managed-PR inbox identity and primary review-state presentation. F09 may be linked from a PR or show a managed-PR filter, but activity never changes `WATCHING`, `WORKING`, `READY_FOR_REVIEW`, or `NEEDS_ATTENTION`.
- F10-F12 own remote polling, resource checkpoints, feedback eligibility, deduplication, batching, Check Now, pause, and holds. F09 records their structured lifecycle/evidence events but does not decide eligibility or invoke AI.
- F13-F18 own Git/worktrees, validation, provider invocation, bounded AI progress, Review Bundle preparation, and proposal/implementation semantics. F09 records safe lifecycle/usage summaries and links; the full work/report/validation records remain authoritative elsewhere.
- F19 owns outcome-oriented native notification delivery, tray behavior, deep links, and shutdown. F09 records notification/lifecycle outcomes and does not turn routine events into notifications.
- F20-F23 and F24-F27 own Review Bundle review/publication and branch synchronization/conflict/publication semantics. F09 preserves correlations and diagnostics without replacing their status/result/approval/reconciliation records.
- F28-F30 own startup reconciliation, threat-model hardening, packaging, and final acceptance. F09 supplies bounded restart, redaction, retention, accessibility, and no-effect evidence for those gates.
- The F09 checklist item remains unchecked. This specification phase creates only the PRD/PLAN pair and does not claim that activity logging, polling, AI work, validation, notification, synchronization, or publication is implemented.

## Requirement-to-Slice Trace

| Requirement family | Owning slices |
|---|---|
| FR-01 | 1-3, 6 |
| FR-02 | 2-3, 6 |
| FR-03 | 2-3, 6 |
| FR-04 | 4, 6 |
| FR-05 | 1, 4, 6 |
| FR-06 | 5-6 |
| FR-07 | 1, 3, 5-6 |
| FR-08 | 2-3, 5-6 |
| FR-09 | 1, 4, 6 |
| NFR-01-NFR-08 | 1-6 |
| INV-01-INV-08 | 1-6 |
| AC-01-AC-16 | 1-6 |
| CT-F09-01-CT-F09-07 | 1-6 |
