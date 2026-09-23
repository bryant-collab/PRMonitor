<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single level. The goal is to provide the AI and the user with a visible and testable result when the work is complete.
There might be slices that are needed to describe work that doesn't extend all the way through the product, but the preference should be towards vertical slices.
-->

# Plan: F12 Review Batching, Scheduler, Check Now, and Global Pause

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** Specs/review_batching_scheduler_check_now_and_global_pause_PRD.md
>
> **Last revalidated against:** Specs/application_overview.md revision 2026-09-22 and F12 PRD revision 2026-09-22
>
> **Entry/readiness gates:** F02 exposes the primary PR states, pause overlay, automatic-review admission, hold, and structured-reason contracts. F03 exposes durable settings, Review Batch, scheduler/request intent, transaction, idempotency, and restart-safe repository contracts. F04 exposes main-process lifecycle, wake/sleep hooks, validated IPC, and renderer-independent operation lifetime. F08 exposes the managed-PR read-model seam. F09 exposes bounded correlated activity. F10 exposes scoped renderer-independent poll invocation and ten-minute default. F11 exposes eligible/deferred queries, exact-version claims, holds, and explicit release/re-evaluation. Test fixtures can inject clocks, timers, process lifecycle, network outcomes, renderer absence, F10/F11/F18 fakes, persistence faults, and no-effect spies.
>
> This PLAN cannot change product requirements. Resolve contradictions in the owning PRD before implementation and rerun both specification linters. PD-03 and PD-04 are the recommended interpretations of Check Now and Pause Watching and require human confirmation before implementation. This feature does not check the checklist item; implementation and approval are separate.

## Implementation Boundary

F12 adds the main-process ReviewScheduler control plane. It owns effective
polling and quiet-period configuration, per-managed-PR due and retry state,
pending Review Batch membership and deadlines, the application-level Pause
Watching overlay, Check Now request coalescing, the automatic dispatch gate,
and startup/wake reconciliation for those records.

F03 remains authoritative for SQLite, migrations, transactions, versioned
records, uniqueness, idempotency, and commit outcomes. F10 remains
authoritative for GitHub resource polling, conditional requests, pagination,
normalization, and immutable observed versions. F11 remains authoritative for
eligibility, per-PR holds, event associations, and exact claims. F02 remains
authoritative for primary-state transitions and overlay semantics. F04 owns
renderer/process lifecycle and validated control routing. F09 owns activity
diagnostics. F18 owns automatic Review Bundle preparation after the F12/F11
handoff.

F12 does not invoke an AI provider, inspect semantic comment meaning, create a
worktree, run validation, post a response, commit, push, merge, publish, or
replace any owning state machine. F08 and F19 consume F12's versioned read and
control contracts; they do not create authoritative timers or pause state.

## Readiness Gates

- F02's global pause is an application-level overlay and its automatic-review admission rejects paused or held background dispatch without changing the primary PR state.
- F03 can persist and atomically read/update the effective schedule, pause revision, per-PR deadlines, Review Batch membership, request identity, dispatch intent, retry state, and safe reason data.
- F03 can return a committed result after an injected failure at or after commit and can reject stale scheduler revisions without releasing a hold or overwriting a newer batch.
- F04 can keep the main process and F12 services alive without a renderer, notify F12 on wake/startup/shutdown, and validate Check Now/Pause Watching/Resume Watching requests.
- F08/F19 can consume a versioned scheduler/pause snapshot and expose read/control actions without making a renderer or tray cache authoritative.
- F09 can append bounded activity with the scheduler correlation, managed-PR scope, batch/request identity, reason code, and stage.
- F10 can run one explicit managed-PR poll or a bounded managed-PR set and return typed resource/version outcomes without semantic classification or AI.
- F11 can query eligible/deferred versions, retain held versions, atomically claim an exact set, and return an existing claim on idempotent retry.
- The test harness can advance an injected UTC clock, simulate timer loss, sleep/wake, network loss, process interruption, concurrent PRs, F11 conflicts, downstream handoff uncertainty, renderer absence, and forbidden imports.

## Proposed Vertical Slices

1. **Scheduler configuration and durable per-PR schedule state**
   - **Blocked by:** F02 pause/primary-state contracts, F03 settings and transaction repositories, F04 main-process lifecycle, and F10's effective polling interval contract.
   - **Stories / requirements / acceptance criteria:** US-01, US-06; FR-01.1-FR-01.5, FR-06.1-FR-06.3; NFR-01-NFR-04, NFR-07-NFR-08; INV-01-INV-04, INV-07-INV-10; AC-01-AC-02, AC-10-AC-13; CT-F12-01, CT-F12-06, CT-F12-07.
   - **Visible result:** A main-process read returns effective ten-minute defaults or validated user settings, a versioned scheduler revision, each managed PR's next due/retry state, and a safe paused/deferred summary after a fresh process.
   - **Durable records / external effects:** Adds or consumes F03 settings, schedule-slot, request, pause, and reason records. No GitHub, AI, Git, worktree, validation, notification, or publication effect occurs.
   - **Failure / cancellation / restart:** Invalid values, stale revisions, missing PR identity, persistence busy/failure, cancellation before commit, and process stop before commit produce no false schedule or pause change. A committed setting/schedule survives renderer closure and restart.
   - **Exact evidence:** Default/bounds/revision truth table; per-PR scope and equal-deadline ordering matrix; settings edit versus pending-batch snapshot fixture; persist-before-reliance probe; stale-writer race; restart readback; bounded-field/secret scan; CT-F12-01, CT-F12-06, and CT-F12-07.
   - **Exit criterion:** AC-01-AC-02, AC-10, and AC-13 pass, and downstream slices have one durable scheduler configuration/status contract.

2. **Renderer-independent polling cadence and Check Now**
   - **Blocked by:** Slice 1, F10 poll invocation, F04 lifecycle/wake hooks, and F09 activity append.
   - **Stories / requirements / acceptance criteria:** US-01, US-04, US-06; FR-02.1-FR-02.6, FR-06.1-FR-06.4, FR-07.1-FR-07.4; NFR-01-NFR-05, NFR-07-NFR-08; INV-01-INV-03, INV-07-INV-10; AC-02, AC-06, AC-08, AC-10-AC-13; CT-F12-02, CT-F12-06, CT-F12-07.
   - **Visible result:** With no renderer window, due PR slots invoke F10 within a bounded concurrency limit. Check Now performs one immediate read-only poll, reports a typed request/result identity, and coalesces an equivalent in-flight request.
   - **Durable records / external effects:** Persists scheduled/manual poll intent, scope, scheduler revision, retry state, and bounded F09 activity before invoking F10. The only external effect in the default evidence is a fake F10 call.
   - **Failure / cancellation / restart:** One PR's failure schedules only that PR's bounded retry. A duplicate scheduled/manual request returns or joins the existing request. Cancellation or renderer closure drops delivery only; it does not cancel a committed F10 request or mark feedback processed. Check Now never shortens a pending quiet period or directly invokes AI.
   - **Exact evidence:** 1/2/50/250 managed-PR schedule fixture; independent failure/backoff matrix; renderer-absent poll; Check Now all/specific-scope/coalescing tests; concurrent-bound and timer-loss test; pause-permitted read-only poll test; F10/F09 DTO contract; no-AI/Git/publication spy; CT-F12-02 and CT-F12-07.
   - **Exit criterion:** AC-02, AC-06, AC-08, AC-10-AC-13 pass and F12 can schedule F10 without reimplementing polling or relying on a renderer.

3. **Per-PR quiet-period batcher**
   - **Blocked by:** Slices 1-2, F11 eligible/deferred query, F03 Review Batch repositories, and the injected clock/timer harness.
   - **Stories / requirements / acceptance criteria:** US-02-US-03, US-06; FR-03.1-FR-03.6, FR-06.1-FR-06.2; NFR-01-NFR-04, NFR-08; INV-03-INV-04, INV-07-INV-08; AC-03-AC-05, AC-07, AC-10-AC-11; CT-F12-03, CT-F12-06.
   - **Visible result:** A fixture with comments A, B, and C for one PR produces one pending batch containing A+B+C with a deadline measured from C; simultaneous feedback for another PR produces a separate batch and timer.
   - **Durable records / external effects:** Persists one batch, exact immutable version memberships, first/last eligible observations, quiet-period snapshot, deadline, scheduler revision, and safe activity. No AI or worktree operation starts.
   - **Failure / cancellation / restart:** Empty/ineligible/deferred/held/closed results create no batch. Duplicate membership is an idempotent no-op and does not restart the deadline. A failure after batch membership commit preserves the exact set; a timer callback can be replayed without creating a second batch.
   - **Exact evidence:** First/add/duplicate/cross-PR truth table; deadline-restart fixture; empty-result and held-version fixture; settings-change-after-batch snapshot; membership uniqueness race; process-stop/restart timer reconstruction; F11 retention handoff; CT-F12-03 and CT-F12-06.
   - **Exit criterion:** AC-03-AC-05, AC-07, and AC-10-AC-11 pass, and APP-AC-09 has direct end-to-end batching evidence without any AI invocation.

4. **Pause Watching overlay and control/read contract**
   - **Blocked by:** Slices 1-3, F02 overlay semantics, F04 validated IPC/control routes, and F08/F19 consumer fakes.
   - **Stories / requirements / acceptance criteria:** US-04-US-05; FR-05.1-FR-05.6, FR-02.6, FR-07.2-FR-07.4; NFR-02-NFR-07; INV-02, INV-05-INV-06, INV-08-INV-10; AC-06-AC-09, AC-12-AC-13; CT-F12-05, CT-F12-07.
   - **Visible result:** A persisted Pause Watching command changes a clearly typed application overlay. Existing primary PR states, holds, pending batches, and admitted work remain unchanged; a status query tells consumers that automatic dispatch is blocked and whether read-only polling is allowed.
   - **Durable records / external effects:** Persists pause/resume intent, revision, changed-at time, safe actor/request identity, and bounded activity. It exposes read/control DTOs through F04; F19's tray and F08's visual presentation remain downstream.
   - **Failure / cancellation / restart:** Repeated pause/resume is idempotent. A failed or stale write leaves the previous overlay authoritative. Pausing does not cancel active work, delete batches, release holds, or block explicitly started synchronization. Malformed renderer/tray input is rejected before service invocation.
   - **Exact evidence:** Pause/Resume transition matrix; paused scheduled poll versus automatic-dispatch matrix; pending/deadline preservation; primary-state/hold invariance; renderer/tray schema corpus; restart readback; F08/F19 DTO and accessibility handoff; no-cancellation/no-AI spy; CT-F12-05 and CT-F12-07.
   - **Exit criterion:** AC-06-AC-09 and AC-12-AC-13 pass, and F08/F19 can present and invoke one authoritative pause contract.

5. **Automatic dispatch gate and Review Bundle handoff**
   - **Blocked by:** Slices 1-4, F11 atomic claim/recheck, F18 automatic-review intake contract, F02 dispatch transitions, and F03 operation-intent transactions.
   - **Stories / requirements / acceptance criteria:** US-02-US-05; FR-03.6, FR-04.1-FR-04.6, FR-05.2-FR-05.5, FR-07.1-FR-07.2; NFR-01-NFR-04, NFR-06-NFR-08; INV-03-INV-07, INV-09; AC-04-AC-09, AC-11-AC-13; CT-F12-04, CT-F12-05, CT-F12-07.
   - **Visible result:** After quiet time, one batch revalidates pause, hold, PR state, exact version membership, and revisions, obtains one F11 claim, and hands one immutable batch/claim reference to F18. A paused, held, stale, empty, or losing request remains deferred with a truthful reason.
   - **Durable records / external effects:** Persists dispatch intent before F11 claim/handoff, the exact version set, claim/operation identity, correlation, and handoff outcome. The fake F18 is the only downstream effect; no provider or Git capability is reachable.
   - **Failure / cancellation / restart:** A claim race returns the existing winner. A pause/hold/eligibility change cannot start work. A downstream timeout reconciles batch/claim/operation identity before retrying. A committed claim remains authoritative after process stop; no retry creates a second operation.
   - **Exact evidence:** Gate truth table; exact-version recheck; pause/hold/stale/closed matrices; two-dispatch race; persist-before-claim and persist-before-handoff fault injection; F11 claim/replay; F18 accept/reject/lost-response fixtures; downstream no-AI/worktree assertion; CT-F12-04, CT-F12-05, and CT-F12-07.
   - **Exit criterion:** AC-04-AC-09 and AC-11-AC-13 pass and F18 can start only from one durable, valid, human-independent scheduling handoff.

6. **Startup, sleep/wake, network, and cancellation recovery**
   - **Blocked by:** Slices 1-5, F04 lifecycle hooks, F03 committed-versus-uncommitted outcomes, and F10/F11/F18 reconciliation identities.
   - **Stories / requirements / acceptance criteria:** US-01, US-04-US-06; FR-02.1-FR-02.6, FR-04.6, FR-06.1-FR-06.6, FR-07.1-FR-07.2; all NFRs; all INVs; AC-02, AC-05, AC-07-AC-12; CT-F12-02, CT-F12-04-CT-F12-06.
   - **Visible result:** A fresh process reconstructs due polling, paused/ready batches, deadlines, retries, and uncertain dispatches. A wall-clock jump or sleep/wake causes one bounded reconciliation pass rather than duplicate timers or lost feedback.
   - **Durable records / external effects:** Uses F03 schedule/request/batch/intent records, F10/F11/F18 idempotency identities, and F09 recovery activity. No recovery path creates an unrecorded AI, Git, validation, or publication effect.
   - **Failure / cancellation / restart:** Pre-commit interruption leaves no false success. Post-commit interruption returns the committed result. Retryable failures use the documented bounded backoff. Paused expired batches wait without claim; held versions remain with F11; uncertain handoffs query existing identities before retry.
   - **Exact evidence:** Restart-at-every-boundary fault matrix; sleep/wake and wall-clock-jump fixture; network/rate-limit/backoff table; renderer close/reopen; duplicate recovery; paused/ready/held reconciliation; process-stop before/after commit; no-lost/no-duplicate/no-false-success report; CT-F12-02, CT-F12-04, CT-F12-05, and CT-F12-06.
   - **Exit criterion:** AC-02, AC-05, AC-07-AC-12 pass and F12's recovery seam is ready for F28's cross-feature startup/restart hardening.

7. **Conformance, application coverage, and implementation handoff**
   - **Blocked by:** Slices 1-6, all readiness gates, and confirmation of PD-03/PD-04.
   - **Stories / requirements / acceptance criteria:** US-01-US-06; all FRs, NFRs, and INVs; AC-01-AC-13; CT-F12-01-CT-F12-07; APP-AC-03-APP-AC-09, APP-AC-16-APP-AC-17, APP-AC-25, APP-AC-65.
   - **Visible result:** A machine-readable report demonstrates renderer-independent polling cadence, exact per-PR quiet-period batching, Check Now coalescing, pause admission, deterministic dispatch handoff, restart/sleep recovery, and zero AI/Git/publication effects.
   - **Durable records / external effects:** Uses temporary F03 databases, fake F10/F11/F18 services, bounded F09 evidence, and linter reports only. It does not edit checklist.md, publish specifications, contact GitHub, use credentials, invoke AI, mutate Git, or publish.
   - **Failure / cancellation / restart:** Any cross-PR batch, duplicate membership/claim, pause bypass, hold release, timer loss, false success, secret leak, forbidden import, invalid coverage mapping, or unresolved product decision blocks the handoff. A cancelled run leaves no success marker and is rerunnable from fresh fixtures.
   - **Exact evidence:** npm run build; npm test; npm run check; CT-F12-01 through CT-F12-07; schedule/batch/pause/recovery reports; import and secret/raw-payload scan; git diff --check; npm run lint:prd-plan -- Specs/review_batching_scheduler_check_now_and_global_pause_PRD.md Specs/review_batching_scheduler_check_now_and_global_pause_PLAN.md; npm run lint:application-coverage -- Specs/application_overview.md Specs/review_batching_scheduler_check_now_and_global_pause_PRD.md.
   - **Exit criterion:** All F12 requirements have direct evidence, both specification linters report no definite missing or invalid result, PD-03/PD-04 are confirmed or explicitly revised, and the F12 checklist item remains unchecked pending implementation approval and completion.

## Cross-Slice Verification and Handoff

- The exact owning PRD is Specs/review_batching_scheduler_check_now_and_global_pause_PRD.md. This PLAN does not add semantic feedback classification, AI work, Git/worktree mutation, validation execution, notification delivery, publication, branch synchronization, or a second PR state machine.
- F02 remains authoritative for WATCHING, WORKING, READY_FOR_REVIEW, NEEDS_ATTENTION, global pause as an overlay, automatic-review admission, and hold semantics. F12 must not encode pause as a primary PR state or release a hold on resume.
- F03 remains authoritative for SQLite, migrations, transaction outcomes, uniqueness, scheduler/Review Batch durability, and restart-safe records. F12 must not use an in-memory timer or lock as its only source of truth.
- F04 remains authoritative for main-process lifetime, renderer sessions, wake/lifecycle hooks, and schema-validated IPC. Renderer closure or lost replies affect delivery only.
- F08 remains authoritative for inbox presentation and primary-state grouping. It may display the pause/scheduler overlay but must not create timers or infer scheduler state from activity prose.
- F09 remains authoritative for diagnostic storage/query/retention. F12 emits activity but never reconstructs schedules, batches, claims, or success from activity.
- F10 remains authoritative for the poll request/resource boundary, conditional requests, pagination, normalization, immutable versions, and resource-level retry outcomes. F12 supplies timing and invokes the typed poll contract.
- F11 remains authoritative for deterministic eligibility, held-version retention, per-PR holds, claims, handled associations, and explicit re-evaluation. F12 must query and claim through F11 rather than reimplementing those rules.
- F18 owns the automatic Review Bundle workflow after the F12 handoff. It must revalidate the claimed batch and hold before worktree/AI effects; F12 never grants provider or publication authority.
- F19 owns tray commands, native notifications, deep links, and user-facing shutdown. F24-F27 own explicitly started synchronization, which global pause must not silently cancel. F28-F30 own complete recovery, security, packaging, and final acceptance.
- The F12 checklist item remains unchecked. This specification phase creates only the PRD/PLAN pair and does not claim that polling, batching, AI review, synchronization, or publication is implemented.

## Requirement-to-Slice Trace

| Requirement family | Owning slices |
|---|---|
| FR-01 | 1, 3, 6-7 |
| FR-02 | 2, 6-7 |
| FR-03 | 3, 5-7 |
| FR-04 | 5-7 |
| FR-05 | 4-7 |
| FR-06 | 1-2, 5-7 |
| FR-07 | 1-2, 4-7 |
| NFR-01-NFR-08 | 1-7 |
| INV-01-INV-10 | 1-7 |
| APP-AC-03 | 1-3, 6-7 |
| APP-AC-04-AC-08 | 1-3, 6-7 |
| APP-AC-09 | 3, 5-7 |
| APP-AC-16-AC-17 | 4-7 |
| APP-AC-25 | 3-5, 6-7 |
| APP-AC-65 | 1-2, 6-7 |
