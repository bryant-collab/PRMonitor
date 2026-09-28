<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single level. The goal of vertical layers is to provide the AI and the user with a visible and testable result when the work is complete. This improves the reliability of AI's output by providing rapid feedback.
Note that while we're mentioning Stories here, we're not actually using tickets, this is just a convenient way of identifying slices within a plan. There might be slices that are needed to describe work that doesn't extend through all levels, that's fine, but the preference should be towards vertical slices since this will result in the best quality output.
-->

# Plan: F25 Independent Deterministic Synchronization and Clean-Merge Results

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** `Specs/independent_deterministic_synchronization_and_clean_merge_results_PRD.md`
>
> **Last revalidated against:** `Specs/application_overview.md` and the F25 PRD revision `2026-09-28`
>
> **Entry/readiness gates:** F02 synchronization overlay/reason contracts; F03 durable synchronization batch/operation/result repositories; F12 main-process lifecycle and explicit-operation conventions; F13 exact synchronization worktree, Git-state, merge-base, diff, ownership, and recovery ports; F14 post-change validation consumer contract; F24 committed preparation-only authorization with eligible/ineligible rows and exact identities; test-owned temporary repositories and fault-injection seams; typed F26/F27 consumer ports.
>
> This PLAN cannot change product requirements. Resolve contradictions in the
> owning PRD before implementation. Revalidate this draft when implementation
> begins and remove or archive it when the work is complete.

## Implementation Boundary

F25 begins only after F24 has committed a preparation-only authorization. It
owns the synchronization batch/operation lifecycle after that handoff, one
independent operation per eligible PR, deterministic worktree preparation
requests, merge-base and both-side change evidence, explicit no-commit merge
execution, no-op classification, conflict detection/evidence, post-change
validation handoff, and durable per-result/read-model truth.

F03 remains authoritative for SQLite, migrations, transactions, uniqueness,
optimistic concurrency, and append-only operation/result history. F12 supplies
main-process scheduling/lifecycle conventions but does not turn F25 into an
automatic review job. F13 owns all canonical paths, source materialization,
worktree ownership, Git inspection, merge-base/diff evidence, and dirty-state
protection. F14 owns command execution and validation truth. F24 owns source
selection, exact remote snapshots, eligibility, and preparation authorization.

F25 emits a typed conflict handoff after Git reports a real conflict. F26 owns
semantic resolution, AI task/policy snapshots, bounded turns, ambiguity, and
retry authorization. F27 owns result review, stale detection, discard,
explicit **Publish Merge**, merge-commit creation, non-force push, and
publication recovery. F25 never commits, pushes, posts a response, resolves a
GitHub conversation, or publishes.

F25 must not introduce a competing PR state machine. Synchronization status is
an operation overlay, and the primary review state plus any Review Bundle hold
remain unchanged throughout the workflow.

## Readiness Gates

- F02 exposes the synchronization statuses, structured reason data, overlay
  independence, and no-op/clean/conflict distinction without requiring F25 to
  invent a second state machine.
- F03 can transactionally persist a batch, per-PR operation, immutable F24
  input snapshot, worktree/evidence references, validation link, status
  revision, reason, and recovery marker before the represented effect.
- F12 can keep main-process operation services alive without a renderer and can
  distinguish explicitly started synchronization from automatic review
  dispatch and global pause behavior.
- F13 can materialize exact source/head objects, prepare distinct
  synchronization worktrees at `prHeadSha`, compute/record
  `syncMergeBaseSha`, expose source/head change evidence, inspect actual state,
  and return a typed dirty/stale/unknown condition without resetting it.
- F14 can accept the F25 operation identity and owned worktree, execute the
  post-change phase, and return truthful `passed`, `failed`, `not_run`, or
  `interrupted` evidence with bounded output and restart-safe records.
- F24 can provide a committed authorization whose eligible rows contain explicit
  source/destination repositories, branches, exact SHAs, configuration
  revision, correlation identity, and stable idempotency identity.
- The test harness can create temporary same-repository and fork repositories,
  divergent branches, already-contained sources, clean merges, real conflicts,
  dirty worktrees, validation fixtures, renderer absence, process stops, and
  injected persistence/Git/validation failures.
- F26 and F27 expose typed consumer ports that accept F25 evidence without
  importing F25's Git handles, gaining credentials, or gaining publication
  authority.

There are no unresolved product decisions required before implementation. The
no-commit boundary, no-op semantics, no-AI clean path, visible `not_run`
validation warning, per-PR isolation, and preserved uncertain state are locked
in PRD PD-01 through PD-07.

## Proposed Vertical Slices

1. **Durable authorization intake and independent per-PR operations**
   - **Blocked by:** F02 synchronization states/reasons; F03 transaction and result repositories; F12 main-process operation lifecycle; F24 committed authorization; F04 validated command routing.
   - **Stories / requirements / acceptance criteria:** US-01-US-02, US-08-US-09; FR-01.1-FR-01.8, FR-05.1-FR-05.4, FR-06.1, FR-06.4-FR-06.5; NFR-03-NFR-05, NFR-08; INV-03-INV-04, INV-10-INV-12; AC-01-AC-05, AC-16-AC-19; CT-F25-01, CT-F25-08, CT-F25-09.
   - **Implementation:** Define the provider-neutral `SynchronizationBatchAuthorization`, `BranchSyncBatch`, `BranchSyncOperation`, and per-result identity/revision contracts. Validate that the authorization is committed, current, eligible/non-empty, and complete. In one transaction, persist the batch snapshot, all per-PR operation intents, skipped rows, correlation identity, and stable idempotency keys before asking F13 to create a worktree. Dispatch eligible operations through a bounded main-process coordinator with independent ownership and no renderer dependency.
   - **Visible result:** A confirmed mixed selection becomes a durable synchronization overlay showing one pending row per eligible PR and retained skipped rows, selected/eligible/skipped counts, and a preparation-in-progress state. Repeated commands return the same batch/operation identities.
   - **Durable records / external effects:** F03 stores the complete F24 snapshot, batch, operation intents, status/reason revisions, and handoff state. No Git/worktree/validation effect is allowed before the transaction commits. The first downstream effect is a typed F13 preparation request.
   - **Failure / cancellation / restart:** Incomplete/stale/empty authorization, persistence failure, duplicate request, or cancellation before commit creates no successful batch. A committed intent remains visible after renderer closure or restart. A failure for one operation does not cancel siblings. A process stop after commit is reconciled by operation identity rather than by creating a new batch.
   - **Exact evidence:** F24 authorization truth table; eligible/ineligible/excluded retention; persist-before-F13 spy; duplicate/competing command race; stable-key uniqueness; batch/result count projection; renderer-absent readback; no automatic-review dispatch/no-AI/no-publication spy; CT-F25-01, CT-F25-08, CT-F25-09.
   - **Exit criterion:** AC-01-AC-05, AC-16-AC-19 pass; every eligible PR has an independent durable operation and no local effect can begin from uncommitted or over-privileged input.

2. **Exact source/head materialization, worktree isolation, and merge-base evidence**
   - **Blocked by:** Slice 1; F13 synchronization-worktree and exact-object ports; F24 repository/ref/SHA identity contract; temporary Git fixtures.
   - **Stories / requirements / acceptance criteria:** US-03; FR-02.1-FR-02.7; FR-05.5; NFR-01-NFR-02, NFR-04, NFR-07-NFR-08; INV-01-INV-04, INV-07-INV-09; AC-02-AC-07, AC-10, AC-16-AC-19; CT-F25-02, CT-F25-03, CT-F25-04, CT-F25-08.
   - **Implementation:** For each operation, pass only the immutable F24 identities to F13. Materialize or verify the exact `syncSourceSha` and `prHeadSha`, create a distinct operation-owned worktree at the recorded head, verify clean/known state, compute `syncMergeBaseSha`, and persist bounded source-side and PR-head-side change manifests/hashes. Keep source and destination repository identities explicit for same-repository and fork cases. Do not use current mutable ref values to rewrite the authorization.
   - **Visible result:** Each operation exposes its exact source/destination repository and branch, both SHAs, merge base, resolved worktree path, source-side changes, head-side changes, and a safe preparation status. Same-named refs in another repository and moved/missing objects produce a visible per-PR reason.
   - **Durable records / external effects:** F13 owns the worktree/path/Git records; F25 links them to the batch/result and stores immutable evidence references and input revisions. Git effects are limited to operation-owned materialization/worktree creation. No merge, AI, validation, commit, push, or publication occurs in this slice.
   - **Failure / cancellation / restart:** Missing clone/source object, repository mismatch, path collision, dirty/unknown worktree, cancellation, or interrupted materialization affects only that operation and leaves evidence for reconciliation. Retry adopts the same owned worktree/intent when proven; it never selects a different ref or deletes uncertain state.
   - **Exact evidence:** Same-repository/fork matrix; override/base/default-branch non-substitution; source/head SHA mismatch; missing/deleted object; two-operation path race; review/conversation/developer-worktree non-collision; clean/dirty/unknown matrix; exact merge-base replay; bounded manifest/hash and secret scan; CT-F25-02-CT-F25-04, CT-F25-08.
   - **Exit criterion:** AC-02-AC-07, AC-16-AC-19 pass; every operation has explicit exact inputs and independent safe Git state, or a truthful non-ready result.

3. **No-op, clean no-commit merge, and real-conflict evidence**
   - **Blocked by:** Slice 2; F13 deterministic Git merge/inspection port; F02 synchronization result transitions; F26 typed conflict handoff.
   - **Stories / requirements / acceptance criteria:** US-04-US-05, US-07; FR-03.1-FR-03.8, FR-05.5-FR-05.6, FR-06.6; NFR-01-NFR-02, NFR-05, NFR-07; INV-01-INV-02, INV-05-INV-09; AC-07-AC-10, AC-14, AC-17-AC-19; CT-F25-04, CT-F25-05, CT-F25-06, CT-F25-08.
   - **Implementation:** Before a merge, inspect the exact ancestry. If `syncSourceSha` equals or is an ancestor of `prHeadSha`, persist `NO_OP` without starting a merge. Otherwise request an explicit no-commit merge from the exact source commit with structured arguments and no force option. Inspect the actual worktree/index and unmerged-path state. For a conflict, retain the worktree and emit a bounded F26 handoff containing the exact source/head/merge-base identities, both-side evidence, conflict paths/hunks, intent/context reference when allowed, and current Git state. Do not invoke an AI provider or apply a semantic resolution.
   - **Visible result:** A no-op says that the source is already contained and shows no empty commit candidate. A clean merge says that a local merge result is ready for validation. A conflict says which paths need semantic resolution and exposes the preserved worktree/evidence without suggesting that either side was chosen.
   - **Durable records / external effects:** Persists merge attempt intent and actual outcome before/after the local Git effect, no-op/clean/conflict outcome, unmerged paths, diff/manifest reference, and F26 handoff status. F25 creates no commit and no remote effect. Clean/no-op paths have no AI operation record beyond an explicit zero-usage summary.
   - **Failure / cancellation / restart:** A renderer close does not stop or reset the main-process merge. A Git start failure, merge conflict, cancellation, timeout, dirty state, process stop, or uncertain local outcome is preserved as a non-ready/reconciliation result. Startup adopts only a proven same-operation outcome; it never resets and reruns an uncertain merge.
   - **Exact evidence:** Equal/ancestor/no-op ancestry table; descendant clean merge; explicit no-commit/no-force argument inspection; actual index/worktree/unmerged-path matrix; conflict paths/hunks and both-side evidence; `ours`/`theirs` negative tests; provider-import/capability spy proving zero AI; crash before/after merge; CT-F25-04-CT-F25-06 and CT-F25-08.
   - **Exit criterion:** AC-07-AC-10, AC-14, AC-17-AC-19 pass; F25 can distinguish no-op, clean merge, real conflict, and uncertain local outcomes without semantic guessing or publication authority.

4. **Post-change validation and complete synchronization-result projection**
   - **Blocked by:** Slice 3; F14 post-change consumer contract; F03 evidence repositories; F02 reason/status contract; F27 result read-model contract.
   - **Stories / requirements / acceptance criteria:** US-06-US-07; FR-04.1-FR-04.8, FR-05.2-FR-05.4, FR-05.7-FR-05.8; NFR-01, NFR-03-NFR-06, NFR-08; INV-08-INV-12; AC-11-AC-15, AC-17-AC-20; CT-F25-04, CT-F25-05, CT-F25-07, CT-F25-09, CT-F25-10.
   - **Implementation:** After actual clean/no-op inspection, invoke F14 for the post-change phase using the same operation worktree and immutable input/profile snapshot. Persist validation evidence and map only deterministic results: passed plus safe Git state to `READY_TO_PUBLISH`; failed/interrupted/unsafe/uncertain to `NEEDS_ATTENTION` or `FAILED`; no safe command to a visible `not_run` warning that remains reviewable and never becomes a pass. Build the bounded result projection with exact identities, merge outcome, both-side evidence, conflict/validation records, worktree path, zero-AI metadata, status revision, reason, and next action.
   - **Visible result:** F27's consumer receives a complete per-PR card/read model: `NO_OP` or `CLEAN_MERGE`, exact branches/SHAs/merge base, worktree, diff/evidence, validation status, zero-AI summary, and an accessible what/why/next explanation. A failure or warning is visibly distinct from ready-to-publish.
   - **Durable records / external effects:** F03 stores the result and F14 link/evidence before exposing terminal success. F14 is the only command runner. No model claim, activity event, or missing output can alter validation state.
   - **Failure / cancellation / restart:** A validation start failure, output/redaction issue, interruption, changed worktree, persistence error, or renderer close creates preserved non-passing evidence. A duplicate validation request returns the existing run/result. No safe command keeps `not_run` and its warning.
   - **Exact evidence:** F14 consumer-equivalence fixture; pass/fail/not-run/interrupted aggregation; no-safe-command mapping; changed-worktree block; complete result field matrix; zero-AI usage assertion; status/reason projection; bounded/redacted serialization; accessibility semantics for status/reason/next action; CT-F25-07, CT-F25-09, CT-F25-10.
   - **Exit criterion:** AC-11-AC-15, AC-17, and AC-20 pass; every clean/no-op result has truthful validation/readiness data and F27 can render it without parsing logs or gaining effect authority.

5. **Sibling isolation, cancellation, restart, and local-effect reconciliation**
   - **Blocked by:** Slices 1-4; F03 committed-versus-uncommitted outcomes; F12 lifecycle hooks; F13/F14 recovery identities; temporary multi-PR fixtures.
   - **Stories / requirements / acceptance criteria:** US-01-US-02, US-08-US-09; FR-01.6-FR-01.7, FR-05.1-FR-05.4, FR-06.1-FR-06.5; NFR-02-NFR-04, NFR-08; INV-03-INV-04, INV-07, INV-10-INV-12; AC-03-AC-05, AC-16-AC-19; CT-F25-01, CT-F25-03, CT-F25-08, CT-F25-09.
   - **Implementation:** Add the bounded per-PR execution coordinator and startup reconciliation. Persist operation stage before each local effect, limit concurrent work so a slow PR does not starve the batch, and update only the affected result. On restart, compare durable stage/input/owner with F13 Git state and F14 run records; adopt a proven result, leave the worktree for manual inspection, or record reconciliation-required attention. Scope cancellation to the requested operation and never compensate by deleting committed history or clearing the worktree.
   - **Visible result:** A batch with clean, no-op, conflict, validation-failed, cancelled, and slow fixtures shows independent progress and final cards. Closing/reopening the window returns the same evidence. An uncertain operation explains that it needs inspection rather than presenting a duplicate or false success.
   - **Durable records / external effects:** Uses one durable batch and per-result history, F13 ownership/operation identities, F14 run identities, and F09 correlation events. Test effects are restricted to temporary repositories/worktrees and fake downstream ports; no remote publication occurs.
   - **Failure / cancellation / restart:** Fault injection at every persist/effect boundary distinguishes no-effect, committed-intent, completed, interrupted, and unknown states. A sibling failure does not roll back another result. Same-key replay adopts existing state. Dirty/unknown worktrees remain retained and are not silently reset.
   - **Exact evidence:** 1/2/50/250-PR bounded batch fixtures; sibling failure/slow/conflict matrix; cancellation before/after commit and during merge/validation; renderer close; restart at each stage; process stop/network/materialization uncertainty; duplicate/replay race; no cross-result mutation; no duplicate worktree/merge/validation; CT-F25-01, CT-F25-03, CT-F25-08, CT-F25-09.
   - **Exit criterion:** AC-03-AC-06 and AC-16-AC-19 pass; the batch is independently recoverable and no lifecycle event creates a duplicate or false synchronization result.

6. **Consumer conformance, security, accessibility, and implementation handoff**
   - **Blocked by:** Slices 1-5; final F03/F13/F14/F24 contracts; F26/F27 consumer fakes; F28-F30 test seams; repository check and specification-linter commands.
   - **Stories / requirements / acceptance criteria:** US-01-US-09; all FRs, NFRs, and INVs; AC-01-AC-20; CT-F25-01-CT-F25-10; APP-AC-13, APP-AC-17, APP-AC-37, APP-AC-39, APP-AC-44-APP-AC-49, APP-AC-53, APP-AC-62, APP-AC-73-APP-AC-75.
   - **Implementation:** Run a machine-readable end-to-end conformance workflow through thin F26/F27 consumers. Verify the clean/no-op path has no AI or publication capability, the conflict handoff contains complete evidence but no provider object, the result projection preserves exact IDs/revisions, and the synchronization overlay never mutates primary review state. Add input/capability/import/secret/force-option scans and the keyboard/screen-reader/forced-colors/reduced-motion/zoom/narrow-width review. Re-run all repository and specification checks against the final pair.
   - **Visible result:** One report demonstrates confirmed multi-PR preparation, independent worktrees, exact merge evidence, no-op/clean/conflict classification, real validation statuses, restart/lifecycle recovery, sibling isolation, bounded reasons, and safe F26/F27 handoff.
   - **Durable records / external effects:** Uses only test-owned SQLite, temporary repositories/worktrees, fake F03/F12/F13/F14/F24/F26/F27 ports, bounded reports, and linter output. It does not edit `checklist.md`, contact GitHub, use real credentials, invoke an AI provider, commit, push, post, or publish.
   - **Failure / cancellation / restart:** Any false ready state, duplicate local effect, wrong repository/ref, default-branch substitution, developer-clone mutation, lost result, secret leak, provider/publication capability leak, inaccessible status, invalid mapping, or definite linter miss blocks the gate. A cancelled run leaves no success marker and is rerunnable from fresh fixtures.
   - **Exact evidence:** `npm run check`; F25 contract/integration report; authorization/identity/worktree/merge/validation/recovery matrices; developer-clone before/after hash/status; exact zero-AI and no-publication capability scan; F26/F27 typed-consumer report; secret/raw-command/force-option/import scan; accessibility report; `git diff --check`; `npm run lint:prd-plan -- Specs/independent_deterministic_synchronization_and_clean_merge_results_PRD.md Specs/independent_deterministic_synchronization_and_clean_merge_results_PLAN.md`; `npm run lint:application-coverage -- Specs/application_overview.md Specs/independent_deterministic_synchronization_and_clean_merge_results_PRD.md`.
   - **Exit criterion:** All F25 requirements have direct acceptance or contract-test evidence, every mapped application criterion has no definite missing/invalid result, both specification linters pass without definite missing/invalid results, and F25 remains unchecked pending implementation approval and completion.

## Cross-Slice Verification and Handoff

- F02 remains the only owner of synchronization status legality, structured
  reason vocabulary, overlay independence, and primary PR/Review Bundle hold
  semantics. F25 supplies deterministic triggers/evidence and never changes a
  primary review state.
- F03 remains the only owner of migrations, transactions, uniqueness,
  optimistic concurrency, immutable snapshots, status history, and recovery
  records. F25 never treats an in-memory task, renderer state, or activity text
  as authoritative.
- F12 owns renderer-independent scheduler/lifecycle conventions. F25 is
  explicitly user-started and global pause must not silently cancel or reset it.
- F13 remains authoritative for canonical paths, exact Git objects, worktree
  ownership, merge base, diff/change evidence, actual-state inspection, and
  dirty/unknown preservation. F25 supplies the operation input and consumes
  typed evidence; it does not duplicate path or Git truth.
- F14 remains authoritative for validation configuration, command execution,
  bounded output, status, manual evidence, and no-safe-command warnings. F25
  maps that evidence to synchronization readiness without accepting model
  claims.
- F24 remains authoritative for selection, source precedence, explicit
  repositories/branches, exact SHAs, eligibility, and preparation-only
  confirmation. F25 never silently refreshes or broadens the confirmed input.
- F26 consumes only the typed real-conflict handoff. It owns semantic conflict
  resolution, AI task profiles/policies, bounded turns, ambiguity, questions,
  and retry authorization. F25 does not invoke an AI provider.
- F27 consumes immutable F25 results and owns review presentation, stale
  detection, re-evaluation/discard, explicit publication approval, merge
  commit creation, non-force push, and publication recovery. F25 provides
  evidence, not publication permission.
- F28 owns cross-feature startup/sleep/network/uncertain-outcome recovery;
  F25 provides durable local identities and reconciliation evidence.
- F29/F30 own the final security, packaging, Windows, and release gates. F25
  provides capability scans, temporary-repository evidence, and platform seams.
- The exact owning PRD is
  `Specs/independent_deterministic_synchronization_and_clean_merge_results_PRD.md`.
  These documents create no application code, do not change `checklist.md`,
  and do not claim that synchronization, conflict resolution, or publication is
  implemented.

## Requirement-to-Slice Trace

| Requirement family | Owning slices |
|---|---|
| FR-01 | 1, 5-6 |
| FR-02 | 2, 5-6 |
| FR-03 | 3, 5-6 |
| FR-04 | 4-6 |
| FR-05 | 1, 3-6 |
| FR-06 | 1, 3, 5-6 |
| NFR-01-NFR-08 | 1-6 |
| INV-01-INV-12 | 1-6 |
| APP-AC-13, APP-AC-17 | 1, 4-6 |
| APP-AC-37, APP-AC-39, APP-AC-44-APP-AC-45 | 2, 4, 6 |
| APP-AC-46-APP-AC-49 | 1-6 |
| APP-AC-53, APP-AC-62, APP-AC-73-APP-AC-75 | 4-6 |

