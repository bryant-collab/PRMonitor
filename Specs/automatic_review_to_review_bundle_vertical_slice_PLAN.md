<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single layer. The goal of vertical layers is to provide the AI and the user with a visible and testable result when the work is complete.
Note that while we're mentioning Stories here, we're not actually using tickets, this is just a convenient way of identifying slices within a plan. There might be slices that are needed to describe work that doesn't extend through all levels, that's fine, but the preference should be towards vertical slices since this will result in the best quality output.
-->

# Plan: F18 Automatic Review-to-Review-Bundle Vertical Slice

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** `Specs/automatic_review_to_review_bundle_vertical_slice_PRD.md`
>
> **Last revalidated against:** `Specs/application_overview.md` revision 2026-09-23, F07 and F10-F17 contracts, and checklist revision 2026-09-23
>
> **Entry/readiness gates:** F02 exposes proposal/final Review Bundle stages, primary PR states, per-item decisions, holds, and legal transitions. F03 exposes atomic Review Bundle/item/decision/event-association and AI-operation repositories with commit-before-effect and idempotent replay. F04 keeps the main process alive without a renderer and validates downstream IPC. F07 exposes explicit PR/base/head identity, current metadata, a validated clone, and PR Intent / Context revisions. F10 exposes immutable scoped feedback versions. F11 exposes exact claims, holds, handled associations, and retained-during-hold versions. F12 exposes one exact automatic batch/claim handoff. F13 exposes owned review worktrees, the three SHA snapshots, fresh Git inspection, and proposed/context diff evidence. F14 exposes baseline/post-change validation, no-safe-profile warnings, and real status truth. F15 exposes read-only Review Proposal and Review Implementation contracts, capability admission, structured-output validation, usage, and abort outcomes. F16 exposes immutable task/policy/Common Instruction/Build & Validation/context snapshots for Automatic Review and Review Revision. F17 exposes bounded turns, predicates, reports, stop reasons, and no-code proposal completion. F09 accepts safe correlated activity. Temporary Git repositories, fake provider/validation/persistence ports, fault injection, and accessibility-semantic test seams are available. `npm run check` is green and the semantic specification linter is runnable without placing credentials in fixtures or evidence.
>
> This PLAN cannot change product requirements. Resolve contradictions in the
> owning PRD before implementation. Revalidate this draft when implementation
> begins and remove or archive it when the work is complete.

## Implementation Boundary

F18 implements the main-process automatic-review workflow from a claimed F12/F11
batch through a proposal-stage Review Bundle, the explicit per-item decision
gate, and a final-review bundle or actionable attention result. It owns review
context assembly, immutable input/configuration references, proposal and
implementation sequencing, no-code handling, validation timing, bundle-stage
transitions, and downstream read/outcome handoff.

F18 uses F03 for migrations, transactions, uniqueness, optimistic concurrency,
and durable state; F07/F10/F11/F12 for PR, event, claim, hold, and batch truth;
F13 for worktree/Git truth; F14 for validation truth; F15 for provider-neutral
AI execution; F16 for immutable task/policy/context snapshots; F17 for every
bounded AI turn and completion/progress decision; F09 for diagnostics; and F04
for main-process lifecycle/IPC. F18 does not import a provider SDK, call
GitHub directly, create or clean arbitrary worktrees, execute arbitrary
commands, implement a second AI budget/retry loop, publish, post responses,
commit, push, resolve conversations, or own the final Review Bundle UI.

### Provider-neutral handoff shapes

| Contract | Required meaning |
|---|---|
| `AutomaticReviewDispatch` | One managed PR, exact F12 batch/claim identity, immutable F10 version IDs, F11 hold/operation identity, scheduler revision, PR state snapshot, and idempotency/correlation identity. |
| `ReviewInputSnapshot` | Explicit PR/base/head identities and SHAs, exact feedback-version references, PR Intent / Context, repository/Common Instruction/Build & Validation snapshots, F13 worktree scope, task/policy/profile revisions, bounds, and content hashes. |
| `ReviewProposalItem` | Immutable event-version reference, assessment, one of the four allowed dispositions, proposed implementation/response, related files, bounded model-report data, and deterministic evidence references. |
| `ReviewBundleProposalRecord` | Bundle/operation identity, proposal stage/state, input snapshot, worktree/SHA records, baseline validation, proposal result/turn references, item associations, hold/reason data, and downstream outcome summary. |
| `ReviewItemDecision` | Proposal item/version, `accepted` or `overridden`, final disposition, bounded override instructions, required question answer when effective, actor/action metadata, and decision revision. |
| `ReviewImplementationRequest` | Final decision snapshot, immutable proposal context, Review Revision F16 snapshot, operation-owned worktree, F17 predicate/version, and no publication capability. |
| `ReviewBundleFinalRecord` | Final stage/state, decisions/answers, actual F13 diff references and three SHA snapshots, F14 post-change result, F17 reports/usage/stop data, proposed responses, configuration metadata, reason, and next action. |
| `ReviewBundleReadModel` | Bounded proposal/final/attention state, stage, ordered items, decision completeness, validation phases, model-claim versus deterministic-evidence labels, worktree reference, bounded proposed-response drafts and inclusion metadata, usage, reason, and permitted next action for F19-F23. |

The exact event-version set is immutable for the automatic operation. F18 may
request a new Review Revision snapshot after the decision gate, but it retains
the proposal snapshot and all earlier evidence. A downstream feature persists
the F17 operation/segment/turn intent before the provider effect; F18 never
uses a renderer cache, activity text, provider thread, or model prose as state.

### Stage and authority rules

The proposal path has this authoritative sequence:

```text
F12 batch/claim handoff
        |
        v
F11/F02 revalidation + F03 review intent
        |
        v
F13 clean PR-head worktree + SHA snapshots
        |
        v
F14 baseline validation, if authorized
        |
        v
F16 Read-only Automatic Review snapshot
        |
        v
F17 bounded proposal turn -> F15 structured result
        |
        v
F03 atomic PROPOSAL_REVIEW bundle + per-PR hold
        |
        v
human accepts/overrides every item and answers effective questions
        |
        +----------------------------+
        |                            |
        v                            v
no final fixed items          final fixed items
        |                            |
        v                            v
fresh F13 inspection          F16 Review Revision snapshot
post-change = not_run         F17 bounded F15 implementation
        |                            |
        +-------------+--------------+
                      v
              F13 actual diff inspection
                      |
                      v
              F14 post-change validation
                      |
                      v
              F03 atomic FINAL_REVIEW bundle
```

`READY_FOR_REVIEW` and `NEEDS_ATTENTION` are primary workflow outcomes. A
proposal bundle is `READY_FOR_REVIEW` only when its input/result evidence is
complete and safe to inspect. A final bundle is `READY_FOR_REVIEW` only when
the implementation predicate and applicable validation evidence are complete;
validation failure, interruption, provider stop, invalid evidence, or an
uncertain outcome remains `NEEDS_ATTENTION`. F18 supplies semantic state and
reason data; F20 owns the final visual treatment. A baseline failure or
unavailable profile is retained as evidence-bearing attention metadata rather
than an automatic pre-proposal hard hold: F18 may continue safe read-only
semantic analysis, but it never converts the result into a validation pass.

The following review decisions were confirmed on 2026-09-23:

- F19/F20 may display bounded proposed response drafts from the
  `ReviewBundleReadModel`; F18 never edits, approves, or publishes them.
- A baseline failure remains an evidence-bearing attention condition. It does
  not stop safe read-only proposal analysis solely because the baseline failed,
  but it must remain visible with its real status and reason; an unsafe review
  becomes `NEEDS_ATTENTION`.
- F19/F20/F21/F22/F23 receive only the bounded `ReviewBundleReadModel` and
  cannot obtain F18-owned notification, discard, re-evaluation,
  conversation-mutation, commit, push, response-posting, or publication
  authority through that handoff.

## Proposed Vertical Slices

1. **Automatic dispatch admission and immutable review intent**
   - **Blocked by:** F02/F03 state and transaction contracts, F07 managed-PR identity, F10 immutable versions, F11 exact claim/hold, F12 exact batch dispatch, and the F18 fake-port harness.
   - **Stories / requirements / acceptance criteria:** US-01-US-02; FR-01.1-FR-01.5, FR-02.1-FR-02.4, FR-09.4-FR-09.5; NFR-01-NFR-03, NFR-06-NFR-07; INV-01-INV-05, INV-07, INV-09-INV-10; AC-01-AC-04, AC-11, AC-19, AC-21-AC-23; CT-F18-01, CT-F18-02, CT-F18-09, CT-F18-10.
   - **Implementation:** Add `AutomaticReviewCoordinator` admission and `ClaimAndHoldRevalidator`. Validate one PR, exact version membership, scheduler/claim/hold revision, current state, operation uniqueness, and idempotency. Build and persist `ReviewInputSnapshot` and operation intent before any worktree, validation, provider, or AI-controller effect. Add bounded codecs, hashes, and safe read/outcome DTOs.
   - **Visible result:** A fake F12 dispatch produces one committed F18 review-intent record and an inspectable immutable input snapshot. Empty, stale, cross-PR, paused, handled, competing, or malformed handoffs return typed safe reasons without creating a worktree or provider call.
   - **Durable records / external effects:** Extends/uses F03 review-operation, bundle-input, and association records plus bounded F09 admission activity. No F13, F14, F15, F17, GitHub, notification, or publication effect occurs until the intent commit succeeds.
   - **Failure / cancellation / restart:** Failure before the intent commit creates no active bundle or handled outcome. Failure after commit returns the same operation identity for replay. Renderer closure leaves the main-process intent unchanged; restart reads the committed snapshot rather than reconstructing it from activity.
   - **Exact evidence:** Exact-batch and claim/hold truth table; cross-PR/duplicate/handled/paused/stale matrix; persist-before-effect spy; immutable snapshot/hash round trip; bounded secret/SDK/environment scan; renderer-close/restart readback; CT-F18-01, CT-F18-02, CT-F18-09, and CT-F18-10.
   - **Exit criterion:** AC-01-AC-04, AC-19, and AC-21-AC-23 pass, and every later slice receives one stable, immutable review-intent handoff.

2. **Operation-owned worktree and baseline validation**
   - **Blocked by:** Slice 1, F13 clean review-worktree/SHA/diff contracts, F14 phase-aware validation, F00/F16 authorized profile resolution, and F07 validated clone/source identity.
   - **Stories / requirements / acceptance criteria:** US-01, US-03, US-08; FR-03.1-FR-03.5, FR-09.1-FR-09.3; NFR-02-NFR-05, NFR-07; INV-03, INV-06, INV-08; AC-03, AC-05-AC-06, AC-16, AC-19, AC-22; CT-F18-03, CT-F18-09.
   - **Implementation:** Request F13 preparation using the explicit base/head repositories, refs, and SHAs from the snapshot. Record the resolved path and `prBaseSha`, `prHeadSha`, `worktreeBaselineSha`; require a fresh clean inspection. Invoke F14 baseline with the exact authorized F00/F16 profile or persist `not_run` with its safe reason. Keep F13/F14 evidence separate and expose it through the F18 read model.
   - **Visible result:** A temporary managed PR reaches a clean, isolated worktree with the three SHA values and a baseline panel that distinguishes passed, failed, not_run, and interrupted. The developer clone remains byte/status identical.
   - **Durable records / external effects:** F03 stores worktree/validation references and phase results; F13 creates the isolated worktree and F14 may run approved child processes. No provider invocation or publication effect occurs in this slice.
   - **Failure / cancellation / restart:** Invalid/moved refs, dirty/unowned worktree, path escape, command failure, timeout, cancellation, or uncertain Git/process outcome remains explicit and non-passing. A missing profile or baseline command failure is preserved as evidence-bearing attention; it does not automatically stop Slice 3 when the worktree and remaining evidence are safe for read-only analysis. A committed intent is reconciled by identity; no implicit reset, cleanup, or rerun occurs.
   - **Exact evidence:** Explicit-repository/ref/SHA matrix; clean-state and developer-clone preservation report; baseline-before-proposal ordering probe; no-profile/failure/interruption truth table; phase-separation and output-redaction report; CT-F18-03 and CT-F18-09.
   - **Exit criterion:** AC-03, AC-05-AC-06, AC-16, and AC-22 pass, and F18 can hand one verified worktree/baseline context to the proposal runner.

3. **Read-only Review Proposal and exact structured result**
   - **Blocked by:** Slice 2, F15 Review Proposal schema/capability/read-only boundary, F16 Automatic Review snapshot, F17 read-only lifecycle/predicate/report, and the fake provider conformance suite.
   - **Stories / requirements / acceptance criteria:** US-02-US-04; FR-02.2-FR-02.4, FR-04.1-FR-04.5, FR-10.1-FR-10.2; NFR-01, NFR-03-NFR-05, NFR-08; INV-01, INV-04, INV-07-INV-08, INV-10-INV-11; AC-04, AC-06-AC-10, AC-22; CT-F18-02, CT-F18-04, CT-F18-10.
   - **Implementation:** Build the F17 proposal request from the immutable F16 Read-only snapshot and `ReviewInputSnapshot`. Register the versioned proposal predicate requiring complete event accounting and unchanged worktree. Route only through F15; validate the normalized result, preserve model claims separately, and request fresh F13 evidence after the turn. Add the all-non-code completion path.
   - **Visible result:** A fake provider returns one assessment for each input version and F18 exposes a proposal read model with four dispositions, baseline evidence and any attention reason, proposed implementation/response drafts for F19/F20 to display, related files, usage, and a proof that the worktree did not change. All-pushback/question/no-change completes without a mutating budget charge.
   - **Durable records / external effects:** F03/F17 persist the read-only turn, structured result, usage, report, predicate, and evidence references. F15 makes only the provider-local read-only effect; F18 has no direct provider or GitHub effect.
   - **Failure / cancellation / restart:** Invalid coverage, malformed output, capability/policy refusal, timeout, cancellation, provider failure, changed worktree, or uncertain inspection produces a bounded attention result and no automatic replacement. Renderer closure does not cancel the main-process turn.
   - **Exact evidence:** Read-only policy/request matrix; one-item-per-event and disposition schema corpus; unchanged-worktree hash before/after; no-publication/no-credential scan; all-non-code predicate fixture; provider failure/timeout/cancellation matrix; CT-F18-02, CT-F18-04, and CT-F18-10.
   - **Exit criterion:** AC-04, AC-06-AC-10, AC-22, and the no-code portion of AC-08 pass with F17/F15/F13 authority preserved.

4. **Atomic proposal bundle, hold, and downstream outcome**
   - **Blocked by:** Slice 3, F02/F03 bundle-stage and hold transitions, F11 handled/retained association contract, F09 activity, and F19/F20 read-model fakes.
   - **Stories / requirements / acceptance criteria:** US-03-US-04, US-09; FR-05.1-FR-05.4, FR-09.4-FR-09.5, FR-10.3-FR-10.4; NFR-02, NFR-05-NFR-08; INV-02, INV-05, INV-09-INV-10; AC-10-AC-12, AC-20, AC-24; CT-F18-05, CT-F18-09, CT-F18-10.
   - **Implementation:** Compose one transaction for the proposal bundle, item rows, exact immutable version associations, configuration/worktree/baseline snapshots, operation/turn references, `PROPOSAL_REVIEW` stage, `READY_FOR_REVIEW`/`NEEDS_ATTENTION`, reason/next-action data, proposed response drafts, and hold-linked outcome. Add the F18 read model and typed F19/F20 handoff; do not send an OS notification here.
   - **Visible result:** A persisted proposal reopens after a process restart with all input/output evidence and a durable per-PR review hold. F19/F20 test consumers receive only a bounded target, counts, attention evidence, and displayable proposed response drafts; newly observed feedback appears as retained/deferred, not inside the active bundle.
   - **Durable records / external effects:** One F03 proposal transaction and safe F09 activity. F11 owns the association/hold semantics; F18 requests the explicit proposal outcome but does not release the hold or publish.
   - **Failure / cancellation / restart:** A transaction failure before commit leaves no proposal bundle; after commit, replay returns the existing bundle. Activity failure does not change authoritative state. Restart never creates a second bundle or releases the hold.
   - **Exact evidence:** Atomicity fault matrix; proposal readback after renderer closure/restart; hold/new-version retention matrix; outcome DTO/schema and bounded-field scan; F19/F20 thin-consumer conformance proving proposed-response display without publication authority; CT-F18-05, CT-F18-09, and CT-F18-10.
   - **Exit criterion:** AC-10-AC-12, AC-20, AC-24 pass, and a downstream review surface can open a truthful proposal without parsing logs.

5. **Per-item decision gate and immutable implementation authorization**
   - **Blocked by:** Slice 4, F02 decision transition contract, F03 optimistic-concurrency/decision repositories, F04 validated decision IPC, and F20 interaction/read-model fakes.
   - **Stories / requirements / acceptance criteria:** US-05; FR-06.1-FR-06.5, FR-07.1-FR-07.2; NFR-02, NFR-05-NFR-08; INV-02, INV-04, INV-07, INV-09-INV-10; AC-12-AC-14, AC-20-AC-21, AC-23; CT-F18-06, CT-F18-10.
   - **Implementation:** Add the decision service and versioned records. Require accepted/overridden status for every item, final disposition validation, bounded override instructions, effective-question answer validation, displayed-bundle revision checks, and a one-time implementation authorization. Project decision completeness and missing-action reasons for F20.
   - **Visible result:** A proposal with N items cannot authorize implementation until all N decisions are explicit and all effective questions are answered. A stale or duplicate request returns the current decision/read model and cannot start another operation.
   - **Durable records / external effects:** F03 stores immutable decision history and one committed implementation intent. No provider, Git, validation, notification, or publication effect occurs until the decision transaction succeeds.
   - **Failure / cancellation / restart:** Missing/oversized answer, invalid disposition, stale renderer revision, duplicate click, persistence failure, or cancellation before commit produces no implementation start. A committed decision remains after restart and does not release the hold.
   - **Exact evidence:** Decision-state truth table; accept/override/idempotency/concurrency matrix; question requiredness and override-away-from-question cases; no-provider-before-authorization spy; keyboard/semantic-error handoff; CT-F18-06 and CT-F18-10.
   - **Exit criterion:** AC-12-AC-14, AC-20-AC-21, and AC-23 pass, and downstream implementation receives exactly one final decision snapshot.

6. **Review Implementation, bounded work, and explicit no-code completion**
   - **Blocked by:** Slice 5, F16 Review Revision snapshot resolution, F17 mutating controller/predicate/report, F15 implementation contract, and F13 before/after-turn evidence.
   - **Stories / requirements / acceptance criteria:** US-06-US-07; FR-07.1-FR-07.5, FR-09.1-FR-09.3; NFR-01-NFR-07; INV-01, INV-03, INV-04, INV-06-INV-11; AC-08, AC-14-AC-15, AC-18-AC-19, AC-22-AC-23; CT-F18-07, CT-F18-09, CT-F18-10.
   - **Implementation:** Persist the final decision snapshot, resolve the Review Revision task/policy, and start one F17 bounded mutating operation through F15. Pass final dispositions, answers, instructions, and proposal context; filter mutation authority to final `fixed` items. Register the implementation predicate. Implement an explicit no-code branch that skips F15 mutation and records `NO_IMPLEMENTATION_CHANGES` without consuming a mutating turn.
   - **Visible result:** A fake provider sees only accepted/overridden fixed decisions as code-change work, while pushback/question/no-change items remain response/semantic outcomes. Turn reports show the bounded budget, actual activity, usage, progress, and stop reason; the no-code path shows zero mutating AI turns.
   - **Durable records / external effects:** F03/F17 persist the implementation intent, F16 snapshot reference, F17 turns/reports, F13 before/after snapshots, and F15 normalized result. The only code mutation is inside the F13-owned worktree through the F15 boundary.
   - **Failure / cancellation / restart:** Policy mismatch, timeout, failure, cancellation, repeated state, no-progress, budget exhaustion, renderer closure, restart, or uncertain provider start preserves worktree/history and maps to `NEEDS_ATTENTION`; no automatic retry or hold release occurs.
   - **Exact evidence:** Final-decision input snapshot; fixed/non-fixed routing matrix; no-code zero-provider fixture; F17 budget/timeout/progress/stop report; before/after F13 evidence; provider claim versus actual change scan; restart/uncertain-turn matrix; CT-F18-07 and CT-F18-09.
   - **Exit criterion:** AC-08, AC-14-AC-15, AC-18-AC-19, and AC-22-AC-23 pass without a second budget/retry implementation in F18.

7. **Actual diff, post-change validation, and final Review Bundle**
   - **Blocked by:** Slice 6, F13 authoritative proposed/context diff, F14 post-change phase, F17 implementation predicate, F03 final bundle transaction, and F20/F23 final-review consumers.
   - **Stories / requirements / acceptance criteria:** US-06-US-08; FR-08.1-FR-08.5, FR-09.1-FR-09.5; NFR-01-NFR-05, NFR-08; INV-02, INV-05-INV-09; AC-15-AC-21, AC-24; CT-F18-08, CT-F18-09, CT-F18-10.
   - **Implementation:** Request fresh F13 inspection and both diff references. Run F14 post-change validation only after an implementation path and preserve no-code not-run semantics. Evaluate the versioned implementation predicate, assemble the final turn/report/usage/configuration read model, and atomically commit `FINAL_REVIEW`, decisions, responses, diffs, validation, reasons, and next actions.
   - **Visible result:** A final bundle shows the exact proposed diff relative to `worktreeBaselineSha`, the contextual PR diff separately, real post-change validation, all turn reports/usage, proposed responses, final decisions, and a calm ready or actionable attention outcome.
   - **Durable records / external effects:** F03 final bundle transaction, F13 diff evidence, F14 post-change records, F17/F15 reports, and safe F09 final activity. No commit, push, response post, or publication effect is performed.
   - **Failure / cancellation / restart:** Missing/stale diff, dirty-worktree ambiguity, validation failure/interruption/unavailability, final persistence fault, or uncertain evidence yields `NEEDS_ATTENTION` with preserved worktree/evidence. A final transaction replay is idempotent and never duplicates a bundle outcome.
   - **Exact evidence:** Proposed/context diff distinction and three-SHA table; post-change ordering and status truth table; no-code `NO_IMPLEMENTATION_CHANGES` case; model-claim negative validation; final transaction fault/restart report; final read-model semantic/accessibility probe; F20/F23 consumer conformance; CT-F18-08 through CT-F18-10.
   - **Exit criterion:** AC-15-AC-21 and AC-24 pass, and the complete final bundle is ready for F20 review and F23's later approval gate.

8. **Cross-feature recovery, boundary verification, and release gate**
   - **Blocked by:** Slices 1-7, final F02-F17 contracts, F19/F20/F21/F22/F23 fakes, F28 recovery hooks, and the repository's final check/linter commands.
   - **Stories / requirements / acceptance criteria:** US-01-US-09; all FRs, NFRs, and INVs; APP-AC-10-APP-AC-17, APP-AC-24-APP-AC-25, APP-AC-35-APP-AC-36, APP-AC-38-APP-AC-39, APP-AC-41-APP-AC-42, APP-AC-54-APP-AC-75; AC-01-AC-26; CT-F18-01-CT-F18-10.
   - **Implementation:** Run the complete proposal-to-final workflow with deterministic fakes and temporary repositories. Exercise renderer absence, restart, sleep/network interruption, persistence faults, duplicate dispatch/results, setting/context revisions, held feedback, no-code outcomes, validation failures, bounded stops, and downstream read/outcome handoffs. Add static import/effect scans and application coverage evidence.
   - **Visible result:** One bounded report demonstrates an eligible comment reaching a persisted read-only proposal, remaining unchanged until every required decision, then reaching a final ready/attention result with exact diffs, real validation, complete reports, durable hold/recovery state, and no direct AI/GitHub coupling from F18.
   - **Durable records / external effects:** Uses only test-owned databases, temporary Git repositories/worktrees, fake providers, bounded reports, and application linter output. It does not use live credentials, contact GitHub, publish specs, edit `checklist.md`, or publish code/responses.
   - **Failure / cancellation / restart:** Any duplicate claim/bundle/turn, false pass, secret/SDK leak, proposal mutation, decision bypass, hold release, budget reset, stale snapshot rewrite, unsafe cleanup, direct provider/GitHub coupling, invalid mapping, or definite specification-linter miss blocks the gate. A cancelled run leaves no success marker and is rerunnable from fresh test-owned state.
   - **Exact evidence:** `npm run check`; F18 unit/contract/integration report; input/snapshot and claim matrix; worktree/baseline report; proposal structured-output/read-only report; decision-gate report; no-code report; F17 turn/stop report; diff/validation/finalization report; restart/uncertain-outcome matrix; below/exact/above delegated-bound report with missing-bound refusal; F19/F20/F21/F22/F23 consumer conformance and accessibility evidence; forbidden-import/secret/publication scan; `git diff --check`; `npm run lint:prd-plan -- Specs/automatic_review_to_review_bundle_vertical_slice_PRD.md Specs/automatic_review_to_review_bundle_vertical_slice_PLAN.md`; `npm run lint:application-coverage -- Specs/application_overview.md Specs/automatic_review_to_review_bundle_vertical_slice_PRD.md`.
   - **Exit criterion:** All F18 requirements have direct evidence or named contract-test evidence, AC-25/AC-26 prove bounded DTOs and no downstream authority leakage, both specification linters have been run against the final pair with no definite missing/invalid result, approval-gated product decisions are recorded, and the F18 checklist item remains unchecked until implementation is approved and complete.

## Cross-Slice Verification and Handoff

- F02 remains authoritative for Review Bundle stages, primary PR states, legal decision transitions, hold semantics, reason codes, and the no-mutation-before-decision guard. F18 must not create a competing state machine or release a hold through navigation, polling, or restart.
- F03 remains the only owner of SQLite migrations, generic transactions, uniqueness, optimistic concurrency, durable records, and restart-safe repository mechanics. F18 supplies workflow decisions and uses the existing persistence boundary; it does not treat activity or in-memory objects as state.
- F04 remains authoritative for main-process lifecycle, validated IPC, renderer closure/recreation, and safe desktop routing. F18's work continues without a renderer, and renderer requests cannot pass arbitrary paths, commands, provider objects, or publication methods.
- F07/F06 remain authoritative for PR metadata, server/repository/ref identity, current remote facts, and the validated developer clone. F18 never guesses a default branch, same-named fork, or replacement SHA.
- F10 remains authoritative for polling, normalization, immutable semantic versions, and resource outcomes. F18 stores and references exact version IDs; it never rebuilds event hashes or rewrites event snapshots.
- F11 remains authoritative for eligibility, exact claims, per-PR holds, handled associations, and retained-during-hold versions. F18 revalidates the claim before every effect and requests explicit outcomes; it never implements a second deduplication/hold rule.
- F12 remains authoritative for batch membership, quiet-period dispatch, pause gating, scheduler revisions, and automatic-versus-explicit work. F18 consumes one exact handoff and never force-dispatches a batch.
- F13 remains authoritative for worktree path ownership, clean state, actual Git snapshots, proposed/context diffs, manual edits, and safe path actions. F18 never resets, cleans, replaces, or infers file truth from provider prose.
- F14 remains authoritative for command selection/trust, child-process execution, phase status, output/redaction, manual checks, and validation aggregation. F18 selects when to ask for baseline/post-change evidence but cannot create a pass.
- F15 remains the only production importer of the Codex SDK and the only provider execution boundary. F18 supplies typed proposal/implementation inputs and consumes normalized outputs; it never parses SDK events, reads credentials, or grants publication authority.
- F16 remains authoritative for task-profile/policy/Common Instruction/Build & Validation resolution and immutable snapshots. F18 declares task type and phase, retains proposal/implementation snapshots, and never embeds provider/model/policy values in prompt text as a substitute.
- F17 remains authoritative for AI Work Operation/segment/turn lifecycle, budgets, timeouts, usage, predicates, progress, stop reasons, and continuation authorization. F18 maps those results to bundle state and never implements automatic retries or a second progress policy.
- F09 remains authoritative for activity event envelopes, bounds, redaction, retention, and diagnostics. F18 emits correlated safe activity only after state decisions and never reconstructs a bundle from log text.
- F19 owns native notification/tray delivery and deep links; F20 owns the Review Bundle workspace, decision controls, diff viewer, final visual distinction, and display of bounded proposed response drafts; F21/F22 own conversation, revisions, dirty-worktree decisions, discard, stale handling, and re-evaluation; F23 owns explicit complete-diff/response publication and recovery. F18 supplies only the bounded read model and no downstream effect authority.
- F28-F30 own cross-feature recovery hardening, threat-model enforcement, packaging, clean-machine acceptance, and release evidence. F18 supplies deterministic fault/restart/authority fixtures.
- The F18 checklist item remains unchecked. These documents create no application code, do not change `checklist.md`, and do not claim that automatic review, Review Bundle persistence, implementation, validation, notification, or publication is implemented.

## Requirement-to-Slice Trace

| Requirement family | Owning slices |
|---|---|
| FR-01 | 1, 4, 8 |
| FR-02 | 1-3, 7-8 |
| FR-03 | 2-3, 7-8 |
| FR-04 | 3-4, 8 |
| FR-05 | 4, 7-8 |
| FR-06 | 5, 8 |
| FR-07 | 5-6, 8 |
| FR-08 | 6-8 |
| FR-09 | 1, 4-8 |
| FR-10 | 1, 3-8 |
| NFR-01-NFR-08 | 1-8 |
| INV-01-INV-11 | 1-8 |
| APP-AC-10-APP-AC-17 | 1-8 |
| APP-AC-24-APP-AC-25 | 1, 4, 8 |
| APP-AC-35-APP-AC-36 | 1, 4, 7-8 |
| APP-AC-38-APP-AC-39 | 2, 4, 7-8 |
| APP-AC-41-APP-AC-42 | 1, 3, 7-8 |
| APP-AC-54-APP-AC-75 | 1-8 |
