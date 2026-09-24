<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single layer. The goal of vertical layers is to provide the AI and the user with a visible and testable result when the work is complete. This improves the reliability of AI's output by providing rapid feedback.
Note that while we're mentioning Stories here, we're not actually using tickets, this is just a convenient way of identifying slices within a plan. There might be slices that are needed to describe work that doesn't extend through all levels, that's fine, but the preference should be towards vertical slices since this will result in the best quality output.
-->

# Plan: F17 Bounded AI Work Controller and Deterministic Progress Evaluation

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** `bounded_ai_work_controller_and_deterministic_progress_evaluation_PRD.md`
>
> **Last revalidated against:** application overview, F03/F04/F09/F13/F14/F15/F16 contracts, and checklist revision 2026-09-23
>
> **Entry/readiness gates:** F03 exposes durable AI operation/segment/turn and usage repositories with commit-before-effect and optimistic-concurrency results; F04 keeps main-process work alive without a renderer; F09 accepts safe correlated activity events; F13 exposes owned-worktree identity, fresh Git/state inspection, and revision evidence; F14 exposes bounded validation evidence; F15 exposes normalized provider turns, abort outcomes, usage, and structured results; F16 exposes immutable task/policy/context snapshots and the 1-10 maximum-turn preference. The shared F17 contracts, fake clock, fake provider, evidence fixtures, and lifecycle test seams are ready. `npm run check` is green and the semantic spec-linter workspace is runnable without putting credentials in fixtures or evidence.
>
> This PLAN cannot change product requirements. Resolve contradictions in the
> owning PRD before implementation. Revalidate this draft when implementation
> begins and remove or archive it when the work is complete.

## Implementation Boundary

F17 implements the main-process bounded AI-work controller and deterministic
progress evaluator. It owns parent-operation and segment lifecycle, durable turn
admission, budget reservation/consumption, bounded timeout and cancellation
coordination, completion-predicate evaluation, state fingerprints, progress
classification, stop reasons, continuation authorization, usage aggregation,
and a renderer-safe/workflow-safe read model.

F17 uses F03 repositories rather than owning SQLite migrations, uses F13 for
actual worktree/Git truth, uses F14 for actual validation truth, consumes only
F15 normalized provider contracts, and receives F16 immutable snapshots. It
does not import a provider SDK, start child processes, create or clean
worktrees, execute validation, read credentials, post GitHub responses, commit,
push, merge-publish, or decide semantic code correctness.

### Provider-neutral handoff shapes

| Contract | Required meaning |
|---|---|
| `AIWorkOperationRecord` | Parent identity, purpose/task type, operation-owned scope, predicate ID/version and input snapshot, configured/hard budget, consumed count, cumulative usage projection, current status, stop reason, and linked prior operation. |
| `AIWorkSegmentRecord` | Segment identity/authorization, parent link, immutable F16 profile/policy/context snapshot references, effective timeout, segment budget, start/end/status, and history revision. |
| `AIWorkTurnIntent` | Stable operation/segment/turn identity, sequence, interaction mode, snapshot reference, reservation status, timeout/cancellation metadata, and commit-before-effect correlation. |
| `AIWorkTurnReport` | Model-reported approach/problems/remaining issues, actual F13 changed files and commands, F14 results, deterministic problems, progress classification, fingerprint, usage, terminal reason, and next-action rationale. |
| `AIProgressEvaluation` | Predicate/version, evidence references, completion decision, material-progress classification, state fingerprint, repeat/no-progress counters, and safe reason. |
| `AIContinuationAuthorization` | Human action, target operation/history revision, selected bounded budget, optional new F16 snapshot reference, confirmation timestamp, and one-time-use status. |
| `AIWorkReadModel` | Bounded ordered operations/segments/turns, reports, usage, remaining budget, stop reason, preserved worktree reference, and permitted next action; no SDK objects, process handles, credentials, or raw unbounded output. |

F17 accepts absolute paths, worktree identities, profile/policy snapshots,
validation results, and provider results only through F13-F16/F15 typed ports.
The controller stores references and bounded summaries; it does not reconstruct
truth from activity text or renderer state. A downstream workflow persists the
F17 handoff through F03 before F15 is called.

### Lifecycle and budget semantics

The parent operation owns the cumulative mutating-turn budget. A continuation
before exhaustion creates a new segment using only the parent's remaining
budget; it retains prior fingerprints, reports, usage, and consumed count. A
request after exhaustion creates a separately confirmed parent operation linked
to the old one. A known F15 preflight refusal releases a reservation, while an
uncertain provider start remains conservatively accounted for until explicit
reconciliation. Read-only turns have a finite timeout and report but do not
consume the mutating budget.

The default effective turn timeout is 10 minutes and the accepted F17 range is
1 second through 60 minutes. The timeout is immutable for the turn and is
recorded in its intent; provider activity does not extend it.

## Proposed Vertical Slices

1. **Versioned AI-work records, state transitions, and repository handoff**
   - **Blocked by:** F03 AI-work repositories/transactions, F02 domain reason and transition primitives, and the shared F01/F15 serializable-contract tooling.
   - **Stories / requirements / acceptance criteria:** US-01, US-05; FR-01.1-FR-01.5, FR-03.3-FR-03.5, FR-08.4-FR-08.5, FR-10.1-FR-10.5; NFR-01-NFR-02, NFR-04-NFR-06, NFR-08; INV-01-INV-05, INV-07-INV-10; AC-02-AC-04, AC-06-AC-08, AC-15, AC-19, AC-21; CT-F17-01, CT-F17-03, CT-F17-05, CT-F17-09, CT-F17-10.
   - **Implementation:** Define versioned Zod-first/shared types and main-process ports for operation, segment, turn intent, report, usage, predicate, progress evaluation, stop, and continuation. Add deterministic state-transition guards and F03 repository calls for immutable records, expected versions, and idempotent identities. Model read-only and mutating turns explicitly and separate parent/segment/turn status from the PR's primary review state.
   - **Visible result:** A fake consumer can create, read, and transition a parent operation with one segment and turn, round-trip it after restart, and receive a bounded read model with no SDK/provider types.
   - **Durable records / external effects:** Uses F03 migrations/repositories and safe F09 activity envelopes. No provider, Git, validation, worktree, network, credential, or publication effect is allowed in this slice.
   - **Failure / cancellation / restart:** Unknown schema, invalid transition, duplicate identity, cross-operation result, stale version, oversized field, persistence failure, or terminal mutation fails closed. Renderer destruction does not change committed records; a cancelled test leaves no success marker.
   - **Exact evidence:** Schema/unknown-key/size corpus; transition table; operation/segment/turn and read-only/mutating round trips; optimistic-concurrency and duplicate-identity fixtures; F03 restart readback; safe-record/SDK/credential/publication scan; CT-F17-01, CT-F17-03, CT-F17-09, and CT-F17-10.
   - **Exit criterion:** AC-02-AC-04, AC-06, AC-15, AC-19, and AC-21 pass, and all later slices can use one durable provider-neutral lifecycle contract.

2. **Admission, budget reservation, snapshots, and persist-before-provider effect**
   - **Blocked by:** Slice 1, F13 ownership/current-scope inspection, F15 request admission, F16 immutable snapshot handoff, and F03 commit-before-effect support.
   - **Stories / requirements / acceptance criteria:** US-01-US-02, US-05; FR-02.1-FR-02.6, FR-03.1-FR-03.5, FR-10.1-FR-10.3; NFR-01-NFR-02, NFR-04, NFR-06; INV-01-INV-03, INV-07-INV-10; AC-01-AC-04, AC-15, AC-18-AC-19, AC-21; CT-F17-02, CT-F17-03, CT-F17-08, CT-F17-09.
   - **Implementation:** Build `AIWorkController.startOperation` and `startSegment` admission. Resolve omitted/default/override budgets, enforce 1-10 and hard maximum 10, validate the F16 task/policy/context snapshot and F13 worktree ownership, register a predicate/version, and persist parent/segment/first-turn intent plus a reservation before invoking F15. Add idempotent replay and known-preflight-refusal versus uncertain-start handling.
   - **Visible result:** A fake F15 start spy proves that valid work has one committed operation/segment/turn before invocation; invalid budget, snapshot, predicate, or worktree scope produces a durable safe refusal and no provider start.
   - **Durable records / external effects:** The durable effect is the F03 operation/segment/turn reservation. Only after that commit may the injected F15 port be called. F17 does not own the provider process or credentials.
   - **Failure / cancellation / restart:** Failure before the intent commit starts no provider and creates no false success. Failure after commit is recoverable by identity. A known provider preflight rejection releases only its reservation; an uncertain start remains conservatively consumed/attention-required. Duplicate start requests return the existing record.
   - **Exact evidence:** Budget boundary/default/override table; persist-before-start spy; snapshot/policy/root/predicate mismatch matrix; duplicate replay; preflight rejection versus uncertain-start fault injection; renderer-close readback; no-provider-before-commit and no-publication scans; CT-F17-02, CT-F17-03, CT-F17-08, and CT-F17-09.
   - **Exit criterion:** AC-01-AC-04, AC-15, AC-18-AC-19, and AC-21 pass with no uncommitted provider start and no budget reset.

3. **Turn lifecycle, timeout, cancellation, usage, and restart reconciliation**
   - **Blocked by:** Slice 2, F15 abort/normalized-result contracts, F04 main-process lifecycle seams, F03 terminal-result transactions, and the injected clock.
   - **Stories / requirements / acceptance criteria:** US-02, US-05-US-06; FR-02.3-FR-02.6, FR-04.1-FR-04.6, FR-08.2-FR-08.3; NFR-02-NFR-03, NFR-06-NFR-07; INV-02-INV-05, INV-07, INV-10; AC-03-AC-06, AC-13-AC-15, AC-19; CT-F17-02, CT-F17-04, CT-F17-05, CT-F17-09.
   - **Implementation:** Add the turn execution coordinator with 10-minute default/1-second-through-60-minute validation, an immutable deadline, F15 abort propagation, one terminalization path, usage normalization, and bounded reconciliation. Persist mutating consumption exactly once, keep read-only turns out of the mutating budget, classify cancellation/timeout/shutdown/restart/uncertain outcomes, and make renderer close a no-op.
   - **Visible result:** A fake provider and fake clock show a turn start, streamed safe events, usage, terminal report, graceful abort at the deadline, and distinct attention reasons after cancellation, failure, shutdown, or restart. Reopening the app shows the same count and history.
   - **Durable records / external effects:** F03 receives immutable turn outcome, normalized usage, terminal reason, and reconciliation evidence; F09 receives bounded lifecycle activity. The only provider effect is the injected F15 call after intent commit.
   - **Failure / cancellation / restart:** Timeout or cancellation emits one terminal outcome and never starts a replacement. Restart of a running/uncertain turn marks it interrupted/uncertain according to durable evidence and does not auto-resume. Missing usage remains unavailable; replay does not double-count.
   - **Exact evidence:** Timeout boundary matrix; abort call order; user-cancel/shutdown/restart/uncertain distinction; renderer-close no-op; duplicate terminal event; all usage counters/unavailable values; crash/restart at pre-start, started, result, and report commits; CT-F17-04, CT-F17-05, and CT-F17-09.
   - **Exit criterion:** AC-03-AC-06, AC-13, AC-15, and AC-19 pass, and a provider turn cannot bypass the deadline or duplicate consumption.

4. **Deterministic evidence assembly, completion predicates, fingerprints, and progress**
   - **Blocked by:** Slice 3, F13 fresh-state/diff evidence, F14 phase-aware validation results, F15 structured-result handoff, and operation-specific predicate definitions from F18/F26.
   - **Stories / requirements / acceptance criteria:** US-03-US-04, US-09; FR-05.1-FR-05.6, FR-06.1-FR-06.6, FR-10.2; NFR-01, NFR-03, NFR-05, NFR-08; INV-01, INV-04, INV-06, INV-10; AC-07-AC-11, AC-13, AC-17, AC-19; CT-F17-05, CT-F17-06, CT-F17-07, CT-F17-10.
   - **Implementation:** Implement `AIProgressEvaluator` and the predicate registry. Request fresh F13/F14 evidence after every mutating turn; canonicalize bounded problem/worktree/validation inputs with predicate version and evidence revisions; compute a stable fingerprint; classify `material_progress`, `no_progress`, `repeated_state`, `completed`, or `failed`; count prior fingerprints across the entire parent; and apply the two-consecutive-no-progress rule only while the predicate is false. The Review Implementation predicate explicitly receives the final human decisions, fresh worktree inspection, and post-change F14 result; the Conflict Resolution predicate explicitly receives unmerged-path/conflict-marker evidence and validation. Keep model claims in a separate report section.
   - **Visible result:** A deterministic evidence fixture produces the same fingerprint twice, detects a non-consecutive repeated state, ignores formatting-only/unrelated churn, stops after two no-progress turns, and accepts a predicate-complete no-code result.
   - **Durable records / external effects:** Persists evidence references, predicate input/version, fingerprint, classification, counters, and completion decision. F13 and F14 remain authoritative; F17 does not modify the worktree or rerun validation.
   - **Failure / cancellation / restart:** Missing/stale/contradictory F13/F14 evidence, invalid predicate output, fingerprint-limit overflow, or provider-only completion claims produce a safe non-success evaluation and no automatic next turn. Restart preserves prior fingerprint history.
   - **Exact evidence:** Canonicalization/hash repeatability; evidence revision matrix; material/unrelated churn table; repeated state separated by another turn; two-consecutive-no-progress fixture; provider-claim-versus-actual negative cases; proposal/implementation/conflict predicate truth tables; all-no-code dispositions; CT-F17-05-CT-F17-07 and CT-F17-10.
   - **Exit criterion:** AC-07-AC-11, AC-13, AC-17, and AC-19 pass, and no semantic provider claim can create deterministic completion or progress.

5. **Reports, stop reasons, attention read model, and downstream handoff**
   - **Blocked by:** Slices 1-4, final F09 event catalog, F03 read-model transaction/query contracts, and F20/F26 semantic consumer fixtures.
   - **Stories / requirements / acceptance criteria:** US-01-US-08; FR-07.1-FR-08.5, FR-10.1-FR-10.5; NFR-02-NFR-05, NFR-08; INV-01, INV-04, INV-07, INV-09-INV-10; AC-05-AC-08, AC-12-AC-15, AC-19-AC-21; CT-F17-04, CT-F17-05, CT-F17-08, CT-F17-10.
   - **Implementation:** Assemble the complete AI Work Turn Report, cumulative usage projection, machine-readable stop/recovery record, permitted-next-action data, and bounded ordered read model. Emit correlated F09 events for admission, turn lifecycle, evidence/progress, stop, and reconciliation. Provide a thin F18/F20/F26 handoff that maps stop outcomes to `NEEDS_ATTENTION` without making F17 own Review Bundle or synchronization UI.
   - **Visible result:** A stopped operation can be reopened and inspected as a complete timeline: objective, reported approach/problems, actual files/commands, validation, fingerprint/progress, usage, stop reason, remaining issues, preserved worktree, and permitted next action.
   - **Durable records / external effects:** Stores immutable reports and projections through F03 and safe activity through F09. No publication, response, commit, push, or merge effect is available.
   - **Failure / cancellation / restart:** Report or activity failure never rewrites deterministic operation truth. Over-limit/redaction failure blocks the affected projection safely. Restart preserves report ordering and does not expose raw provider payloads.
   - **Exact evidence:** Report schema/read-model table; provider-claim/deterministic-evidence labels; cumulative usage derivation; stop-reason/action matrix; F09 correlation query; bounded/redacted IPC and persistence scan; keyboard/forced-colors semantic probe; F18/F20/F26 thin-consumer conformance; CT-F17-04, CT-F17-05, CT-F17-08, and CT-F17-10.
   - **Exit criterion:** AC-05-AC-08, AC-12-AC-15, AC-19-AC-21 pass and downstream consumers can present a truthful attention result without reimplementing controller policy.

6. **Explicit continuation, exhausted-budget new operations, and full recovery semantics**
   - **Blocked by:** Slice 5, F16 new-snapshot handoff, F04 lifecycle/restart behavior, F28 recovery contracts, and all preceding fault-injection evidence.
   - **Stories / requirements / acceptance criteria:** US-05, US-07-US-09; FR-07.3-FR-07.6, FR-09.1-FR-09.5, FR-10.3; NFR-02-NFR-08; INV-03, INV-07-INV-10; AC-15-AC-21; CT-F17-08, CT-F17-09, CT-F17-10.
   - **Implementation:** Add one-time continuation authorization bound to an operation/history revision. Before exhaustion, create a new segment with only remaining budget and preserved history. After exhaustion, require a new parent operation with a new 1-10 budget, prior-operation link, cumulative usage display, and optionally a newly resolved F16 snapshot. Reject stale/duplicate/cancelled authorization and policy broadening. Add startup/recovery reconciliation hooks that never auto-authorize work.
   - **Visible result:** A stopped operation presents the complete history before enabling **Continue AI Work**/**Retry Resolution**. A valid continuation preserves the parent count and fingerprints; an exhausted operation shows a separate confirmation for a new budget and retains the old history.
   - **Durable records / external effects:** Persists authorization, segment/new-parent intent, links, snapshot references, cumulative usage, and reconciliation outcomes. Only an explicit valid authorization permits a subsequent F15 call.
   - **Failure / cancellation / restart:** Renderer close, duplicate clicks, stale UI history, process restart, persistence uncertainty, or a changed policy/scope cannot start duplicate or broader work. A cancelled authorization has no provider effect and may be retried from a fresh read.
   - **Exact evidence:** Remaining-budget continuation table; exhausted-budget new-parent table; cumulative history/usage readback; stale-history/duplicate-authorization races; new-snapshot/future-only preference test; restart during authorization commit; no-silent-resume/no-broadening assertion; CT-F17-08 and CT-F17-09.
   - **Exit criterion:** AC-15-AC-21 pass, and every path to more AI work is explicit, bounded, idempotent, and reviewable.

7. **Cross-workflow conformance and release gate**
   - **Blocked by:** Slices 1-6, final F03/F04/F09/F13/F14/F15/F16 contracts, and fake Review/Revision/Conversation/Conflict consumers.
   - **Stories / requirements / acceptance criteria:** US-01-US-09; all FRs, NFRs, and INVs; APP-AC-54-APP-AC-58, APP-AC-61, APP-AC-64, APP-AC-66, APP-AC-70; AC-01-AC-21; CT-F17-01-CT-F17-10.
   - **Implementation:** Run the same controller/evaluator conformance suite through Review Proposal, Review Implementation, Review Revision, Read-only Conversation, and Merge Conflict Resolution fakes. Verify F15-only invocation, F13/F14 evidence authority, F16 snapshot immutability, F03 durable replay, F09 diagnostics, and downstream `NEEDS_ATTENTION` mapping. Keep the F17 public contract portable and provider-neutral.
   - **Visible result:** One machine-readable report demonstrates bounded success, no-code success, progress, repeated-state stop, no-progress stop, timeout, failure, cancellation, restart, continuation, exhausted-budget new operation, and safe attention handoff for each consumer mode.
   - **Durable records / external effects:** Uses temporary application data, repositories, worktrees, fake provider responses, and bounded reports. It does not use live credentials, network, GitHub, publication, or the developer worktree, and it does not edit `checklist.md`.
   - **Failure / cancellation / restart:** Any false pass, budget reset, duplicate provider call, missing evidence, raw secret/SDK leak, policy broadening, unbounded history, invalid mapping, or definite spec-linter miss blocks the gate. Cancellation leaves no success marker and a rerun starts with fresh fixtures.
   - **Exact evidence:** `npm run check`; F17 unit/contract/integration report; lifecycle/fault-injection report; progress/fingerprint/predicate report; usage/report/read-model report; consumer equivalence report; Windows renderer/restart/timeout evidence; authority/security scan; `git diff --check`; `npm run lint:prd-plan -- Specs/bounded_ai_work_controller_and_deterministic_progress_evaluation_PRD.md Specs/bounded_ai_work_controller_and_deterministic_progress_evaluation_PLAN.md`; `npm run lint:application-coverage -- Specs/application_overview.md Specs/bounded_ai_work_controller_and_deterministic_progress_evaluation_PRD.md`.
   - **Exit criterion:** All F17 requirements have direct acceptance or named contract-test evidence, all mapped application criteria have no definite missing/invalid result, both specification linters have been run against the final pair, and F17 remains unchecked until implementation approval and completion.

## Cross-Slice Verification and Handoff

- F03 remains the only owner of migrations, generic transactions, optimistic concurrency, durable records, and restart-safe repository mechanics. F17 supplies lifecycle decisions and requests durable writes; it never treats an in-memory counter or activity row as authoritative.
- F04 remains the main-process/lifecycle authority. Renderer close, navigation, or recreation cannot cancel or reset F17 work; startup/recovery hooks may reconcile but never auto-authorize a stopped or uncertain turn.
- F09 owns event envelopes, redaction, retention, and activity queries. F17 emits correlated safe events and never reads activity text to decide completion, budget, or progress.
- F13 remains authoritative for operation-owned paths, actual Git/worktree state, changed files, manual-edit preservation, and state inspection. F17 requests fresh evidence and records references; it never resets, cleans, or interprets provider claims as Git truth.
- F14 remains authoritative for command execution and validation status. F17 consumes phase-aware results and can require them in a predicate, but cannot infer a pass from provider prose.
- F15 remains the only provider boundary and the only production importer of the Codex SDK. F17 supplies timeout/cancellation, consumes normalized results/events, and does not parse SDK objects or start a provider directly.
- F16 resolves task profiles, policies, Common Instructions, Build & Validation context, maximum-turn preference, and future-only immutable snapshots. F17 records the exact snapshot per segment and refuses a changed/broadened snapshot; it does not reread Preferences during a turn.
- F18/F20/F21/F26 own semantic inputs, human item decisions, Review Bundle/synchronization presentation, and workflow-specific completion predicates. They must use F17 rather than implement their own retry, budget, timeout, or no-progress policy.
- F28-F30 own whole-application recovery hardening, threat-model enforcement, packaging, and release acceptance. F17 supplies concrete lifecycle, uncertain-outcome, evidence, and no-auto-resume fixtures.
- The F17 checklist item remains unchecked during specification and implementation planning. These documents do not claim bounded AI work, progress evaluation, continuation, or downstream UI is implemented.

## Requirement-to-Slice Trace

| Requirement family | Owning slices |
|---|---|
| FR-01 | 1-2, 5, 7 |
| FR-02 | 2-3, 6-7 |
| FR-03 | 1-3, 6-7 |
| FR-04 | 3, 6-7 |
| FR-05 | 4-5, 7 |
| FR-06 | 4, 7 |
| FR-07 | 3, 5-6, 7 |
| FR-08 | 3, 5, 7 |
| FR-09 | 6-7 |
| FR-10 | 1-2, 4-7 |
| NFR-01-NFR-08 | 1-7 |
| INV-01-INV-10 | 1-7 |
| APP-AC-54-APP-AC-58 | 2-7 |
| APP-AC-61 | 2, 3, 6-7 |
| APP-AC-64 | 1-3, 5-7 |
| APP-AC-66 | 4, 7 |
| APP-AC-70 | 2-3, 6-7 |
