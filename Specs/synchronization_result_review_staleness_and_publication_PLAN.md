# Plan: F27 Synchronization Result Review, Staleness, and Publication

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** Specs/synchronization_result_review_staleness_and_publication_PRD.md
>
> **Last revalidated against:** application overview and F27 PRD revision 2026-09-28
>
> **Entry/readiness gates:** F02 synchronization states/reasons and overlay
> transitions; F03 durable result/publication repositories; F06 exact PR/ref
> reads and non-force head-ref operation; F13 fresh WorktreeCondition,
> merge-result inspection, dirty choices, and canonical worktree handle; F14
> real validation results; F19/F20 routing, accessible evidence/diff/worktree
> surfaces; F23 publication-phase/idempotency conventions; F24 current
> source/head resolver; F25 committed independent results; F26 structured
> conflict/consultation evidence; and a typed stale-work invalidation consumer.
>
> This PLAN cannot change product requirements. Resolve contradictions in the
> owning PRD before implementation. Revalidate this draft when implementation
> begins and remove or archive it when the work is complete.

## Implementation Boundary and Readiness

F27 owns the synchronization batch/result review projection, evidence
presentation, result-specific reason and next-action data, dirty-worktree
choice flow, synchronization freshness/stale gate, explicit per-result
publication approval, deterministic merge publication, and publication
reconciliation.

F24 remains authoritative for current source/head identity resolution. F25
remains authoritative for synchronization preparation, merge-base/change
evidence, no-op/clean/conflict classification, validation handoff, and the
initial result record. F26 remains authoritative for semantic conflict
resolution, competing-intent analysis, required user questions, bounded AI
work, and conflict turn reports. F13/F14 remain authoritative for actual Git
and validation truth. F06 remains the only GitHub transport boundary.

F27 does not implement ordinary polling, branch selection, AI conflict
resolution, Review Bundle publication, GitHub response publication, force
push, or per-hunk patch acceptance. The renderer is never authoritative. It
receives a bounded projection and sends typed commands with expected
identities/revisions to the main process.

The implementation must preserve these publication identities throughout:

- the source is the explicit F24 source repository and syncSourceBranch;
- the destination is the explicit PR head repository and prHeadBranch;
- syncSourceSha and prHeadSha are the exact recorded and freshly verified refs;
- syncMergeBaseSha, expected merge parents, merge tree, and candidate diff
  identify the reviewed local result;
- a NO_OP has no commit candidate and no push effect;
- a changed merge uses one non-force expected-old-SHA push;
- a successful changed publication emits one exact old/new head invalidation.

There are no unresolved product decisions required before implementation.
The per-result approval boundary, no-op outcome, monotonic stale state, new
result for re-evaluation, dirty-worktree choices, sibling isolation, and
response-free synchronization publication are locked in PRD PD-01 through
PD-09.

## Proposed Vertical Slices

1. **Versioned synchronization batch and result review projection**
   - **Blocked by:** F02 status/reason contracts; F03 versioned read models; F19/F04 target routing; F20 accessible workspace and diff primitives; F25 committed batch/result records.
   - **Stories / requirements / acceptance criteria:** US-01-US-03; FR-01.1-FR-01.7, FR-02.4-FR-02.6, FR-08.1-FR-08.4; NFR-01-NFR-02, NFR-04-NFR-07; INV-01-INV-02, INV-09; AC-01-AC-04, AC-15, AC-19-AC-22; CT-F27-01, CT-F27-02, CT-F27-09.
   - **Implementation:** Define the main-process synchronization batch review projection with stable batch/result identities, skipped rows, counts, deterministic ordering, result status, primary PR state/overlay separation, revision, evidence references, and capability-driven permitted actions. Add deep-link entry from inbox/tray/notification and renderer rehydration by identity. Compose the result detail from F25/F26/F13/F14 records without reconstructing state from activity text.
   - **Visible result:** A mixed batch opens with one row per selected outcome, clear counts, distinct status/reason/next-action treatments, and a detail view containing exact repositories, branches, SHAs, merge base, diff, validation, worktree, and AI metadata when present. Opening and refreshing are visibly read-only.
   - **Durable records / external effects:** Reads committed F25/F26/F13/F14 data and writes only bounded navigation/read telemetry where the shared application contract permits it. No Git, AI, validation, GitHub, worktree, commit, push, response, or publication effect occurs from rendering.
   - **Failure / cancellation / restart:** Unknown batch/result, missing evidence, stale renderer revision, over-limit projection, or route duplication becomes a bounded reload/attention state. Renderer destruction and restart rehydrate the same committed projection. A sibling read failure does not remove or rewrite another row.
   - **Exact evidence:** Projection schema and bound corpus; skipped/eligible/ready/attention/stale/failed/published count matrix; primary-state/overlay independence matrix; route/deep-link exactly-once trace; no-effect spies for every read path; renderer replacement/restart readback; 0/1/10/250-result bounded projection and two-PR identity isolation; CT-F27-01, CT-F27-02, CT-F27-09.
   - **Exit criterion:** AC-01-AC-03, AC-15, AC-19, AC-20-AC-22 pass; every later slice consumes the same versioned projection and no navigation path can authorize work.

2. **Complete evidence and ambiguous-conflict consultation surface**
   - **Blocked by:** Slice 1; F26 conflict-context/consultation contract; F17 bounded turn-report/usage contract; F20 diff, validation, worktree, and attention presentation; F19 notification target contract.
   - **Stories / requirements / acceptance criteria:** US-02-US-04; FR-01.5-FR-01.7, FR-02.1-FR-02.6, FR-08.2-FR-08.3; NFR-01-NFR-02, NFR-05-NFR-06; INV-09, INV-11, INV-13; AC-02-AC-04, AC-15, AC-19-AC-21; CT-F27-03, CT-F27-09.
   - **Implementation:** Project exact source/head repositories, branches, SHAs, merge base, both-side change evidence, diff references, validation phase/status, worktree condition, AI task/profile/policy/usage metadata, complete turn reports, and deterministic stop reasons. Add the ambiguous-conflict panel with affected paths/hunks, competing intents, uncertainty, required question, preserved evidence, and typed answer/direction/manual-edit/Retry Resolution/Re-evaluate/Discard actions. Keep Publish Merge absent until a new deterministic completion result is committed.
   - **Visible result:** A clean or no-op result visibly reports zero AI activity; a conflict result shows the complete evidence needed to understand it; an ambiguous result is an accessible NEEDS_ATTENTION consultation rather than a plausible ready state.
   - **Durable records / external effects:** F27 persists only presentation/action intents and expected revisions. F26/F17 remain the owners of consultation and AI-turn records. No renderer action can directly edit the worktree, invoke an AI provider, or publish.
   - **Failure / cancellation / restart:** Missing or inconsistent conflict evidence, redaction failure, failed validation, unknown worktree state, or a stopped turn remains attention-required. An answer or retry with a stale revision is rejected and refreshed. Restart preserves prior question, turns, usage, and evidence.
   - **Exact evidence:** Clean/no-op zero-token reachability scan; AI metadata and model-vs-deterministic authority matrix; resolvable/ambiguous/failed-validation/marker-residue fixtures; question and direction validation; no-Publish-Merge capability assertion; keyboard/screen-reader/forced-colors/reduced-motion/narrow-width consultation report; CT-F27-03, CT-F27-09.
   - **Exit criterion:** AC-02-AC-04, AC-15, AC-19-AC-21 pass; F27 can present every F26 ambiguity outcome without deciding semantics or bypassing the publication gate.

3. **Dirty-worktree condition, discard, and safe clear choices**
   - **Blocked by:** Slice 1; F13 WorktreeCondition, attribution, and safe clear contracts; F02 result transitions; F20 choice surface; F03 action-intent persistence.
   - **Stories / requirements / acceptance criteria:** US-05, US-07; FR-03.1-FR-03.6, FR-08.1-FR-08.4; NFR-01-NFR-06; INV-02, INV-07, INV-13; AC-05-AC-07, AC-15, AC-20, AC-23; CT-F27-04, CT-F27-09.
   - **Implementation:** Build one main-process dirty-action coordinator for Discard and Re-evaluate. Refresh F13 condition immediately before showing the choice. Render the exact three choices, destructive confirmation for Clear All Changes, attribution/overlap evidence, and safe permitted actions. Delegate both clear modes to F13, persist the choice before the delegated effect, re-inspect afterward, and complete Discard only after the resulting condition is safe.
   - **Visible result:** A clean worktree can be discarded or re-evaluated with explicit confirmation. A dirty worktree shows what would be affected; Clear Only AI Changes is unavailable or blocked when overlap/unknown ownership prevents safe separation; Keep Worktree and Cancel leaves everything available.
   - **Durable records / external effects:** F03 stores action intent, expected result/worktree revision, user choice, confirmation, F13 clear outcome, post-clear condition, and Discard result history. F13 may mutate only the operation-owned synchronization worktree after the confirmed choice. No remote effect or AI work occurs.
   - **Failure / cancellation / restart:** Cancellation before choice changes nothing. A changed condition, overlap, path loss, F13 uncertainty, persistence failure, or post-clear mismatch leaves the worktree unchanged or visibly unresolved and blocks the result. Restart adopts the same action identity and never repeats a clear blindly.
   - **Exact evidence:** Clean/dirty/staged/untracked/ignored/binary/rename/delete/mixed corpus; Clear All confirmation trace; three-way AI-only overlap corpus; byte-for-byte preservation report; developer-clone before/after status/hash; duplicate/competing action race; stale-condition race; keyboard/screen-reader/destructive-confirmation/narrow-width evidence; CT-F27-04, CT-F27-09.
   - **Exit criterion:** AC-05-AC-07 and AC-20/AC-23 pass; no dirty-worktree path can silently clear, replace, discard, or publish changes.

4. **Freshness gate, monotonic staleness, and re-evaluation**
   - **Blocked by:** Slices 1-3; F06 current PR/ref contract; F24 exact source/head resolver; F25 new-operation intake; F02 stale/reason transitions; F03 expected revisions; F22 stale-work invalidation consumer.
   - **Stories / requirements / acceptance criteria:** US-05-US-07; FR-03.7, FR-04.1-FR-04.6, FR-08.1-FR-08.4; NFR-01-NFR-04, NFR-06; INV-04-INV-05, INV-08, INV-12-INV-13; AC-05, AC-08, AC-10-AC-11, AC-14-AC-18, AC-22-AC-23; CT-F27-05, CT-F27-09.
   - **Implementation:** Define the versioned freshness attempt and stale evidence model. On observation or action, read PR openness/merged state and source/head refs independently through F06 using the recorded explicit identities. Persist one monotonic STALE transition for proven movement and a distinct unavailable/attention result for failed freshness. For confirmed Re-evaluate, resolve current identities through F24, persist a new operation/result intent, and hand it to F25 while preserving the old result and worktree history. Emit no Review Bundle mutation directly; use the typed head-advance/stale-work handoff.
   - **Visible result:** A moved source or head shows expected/observed SHAs, preserved evidence, blocked Publish Merge, and only Re-evaluate/Discard/inspection actions. Re-evaluate produces a new independently reviewable result from current identities; the old result remains visibly stale history.
   - **Durable records / external effects:** F03 stores freshness attempts, stale transition, re-evaluation intent, old/new result link, current F24 snapshot reference, and correlation identity before the F25 call. F06 reads and the typed F25 handoff are the only external effects in this slice.
   - **Failure / cancellation / restart:** A not-modified response is a no-op. Unavailable/malformed/cancelled/old reads never prove movement. A stale result remains stale if the remote later returns to the old SHA. Duplicate re-evaluation returns the existing new result or a typed recovery state; it never creates a second worktree or operation.
   - **Exact evidence:** Source/head/PR-state freshness matrix; proven movement versus unavailable matrix; monotonic stale and old-SHA-return test; closed/merged/ref-identity mismatch tests; re-evaluation old/new result graph; current-source resolver/default-branch negative test; persist-before-F25 fault injection; F22 invalidation conformance; CT-F27-05, CT-F27-09.
   - **Exit criterion:** AC-08, AC-10-AC-11, AC-14, AC-17-AC-18, and AC-22-AC-23 pass; no stale result can be published or silently refreshed.

5. **Per-result approval and exact publication preflight**
   - **Blocked by:** Slice 4; F23 publication lock/idempotency conventions; F06 exact target reads; F13 WorktreeCondition/current HEAD/diff; F14 validation result; F20 approval surface; F25/F26 merge-result evidence.
   - **Stories / requirements / acceptance criteria:** US-08, US-10; FR-05.1-FR-05.7, FR-06.4-FR-06.5, FR-08.1-FR-08.4; NFR-01-NFR-03, NFR-05-NFR-07; INV-03-INV-08, INV-11; AC-09-AC-12, AC-15-AC-16, AC-20-AC-23; CT-F27-06, CT-F27-09.
   - **Implementation:** Add a result-specific Publish Merge approval read model and command. Bind approval to the current result/evidence revision, complete diff, worktree condition, validation, exact identities, expected merge tree/parents, target, actor/time, and stable idempotency key. Run one deterministic preflight that verifies PR open/unmerged state, exact source/head refs and SHAs, merge base/result fingerprint, worktree/index/unmerged paths/markers, required validation, and non-force feasibility. Persist lock, approval, intent, phase, and effect plan before any local commit or remote effect.
   - **Visible result:** The user can see exactly which one result will be published and why it is or is not eligible. A batch has no bulk-publish control. Any preflight failure explains the mismatch and offers only permitted recovery.
   - **Durable records / external effects:** F03 stores approval, lock, expected revisions, target/SHAs/tree/diff/condition snapshots, preflight attempts, phase, idempotency key, and effect plan. F06/F13/F14 are read-only during preflight. No commit, push, response, or AI effect begins before the intent transaction commits.
   - **Failure / cancellation / restart:** Proposal-stage, ambiguous, stale, closed/merged, unsafe, changed-candidate, failed-validation, unknown, or stale-renderer requests are refused before intent. Duplicate approvals return the existing intent; competing approvals return a typed conflict. Renderer closure reopens the same gate.
   - **Exact evidence:** Per-result versus batch approval matrix; exact target/fork identity matrix; stale/closed/merged/changed-tree/unsafe-condition/validation matrix; expected-parent/tree verification; persist-before-effect fault injection; duplicate/lock race; no-AI/no-response/no-force capability scan; accessible approval review; CT-F27-06, CT-F27-09.
   - **Exit criterion:** AC-09-AC-12, AC-15-AC-16, and AC-20-AC-23 pass; no publication effect can begin without fresh exact evidence and one committed per-result approval.

6. **No-op finalization, merge commit, non-force push, and stale-work invalidation**
   - **Blocked by:** Slice 5; F13 exact merge-result/publication handle; F06 expected-old-SHA non-force push and remote reconciliation; F02 publication transitions; F03 effect history; F22 stale-work consumer; temporary Git repositories.
   - **Stories / requirements / acceptance criteria:** US-09-US-12; FR-06.1-FR-07.7, FR-08.2-FR-08.4; NFR-01-NFR-04, NFR-06; INV-02-INV-10, INV-12; AC-12-AC-19, AC-22-AC-23; CT-F27-07, CT-F27-08, CT-F27-09.
   - **Implementation:** Implement the synchronization-specific publication coordinator. For NO_OP, persist NO_CODE_CHANGE and finalize without commit or push. For a changed result, persist the phase, create or adopt exactly one merge commit matching expected parents/tree/diff, persist its local SHA, push only to the recorded head repository/branch with expected old SHA and no force, fetch and verify the remote SHA, then persist PUBLISHED. Emit one old/new head invalidation only after the changed result is durably successful. Keep each result's lock, phase, and effect rows independent.
   - **Visible result:** A no-op says no branch update was needed and has no empty commit. A changed result shows the exact local/remote commit SHAs and target. A stale, rejected, failed, or unknown publication remains visibly non-published. Sibling cards continue independently.
   - **Durable records / external effects:** Uses F03 publication/effect history and F13 owned Git state. A changed path may create one local merge commit and one non-force remote push; a no-op creates neither. F27 persists and emits one typed invalidation; the stale-work owner updates historical Review Bundles.
   - **Failure / cancellation / restart:** A crash before commit adopts no effect; a crash after commit adopts only a unique matching local commit. A lost push response re-fetches the exact remote ref: matching commit is adopted, expected-old remains safely retryable, and any other value is UNKNOWN/STALE. No force push or duplicate commit/push is attempted. Cancellation after intent preserves recovery state.
   - **Exact evidence:** No-op/no-empty-commit/no-push fixture; clean and conflict-resolved merge parent/tree/diff equality; tracked/untracked/ignored exact staging corpus; expected-old-SHA/non-force argument scan; remote-before/after/crash/network-loss matrix; local commit adoption matrix; duplicate publish race; old/new head invalidation and F22 stale-bundle history report; sibling publish failure isolation; CT-F27-07, CT-F27-08, CT-F27-09.
   - **Exit criterion:** AC-12-AC-19 and AC-22-AC-23 pass; APP-AC-50-APP-AC-53 have direct publication evidence and no retry can duplicate or force a merge.

7. **Cross-feature recovery, accessibility, security, and release conformance**
   - **Blocked by:** Slices 1-6; F19/F20/F22/F23/F25/F26 consumer contracts; F28 recovery seams; F29 security checks; F30 Windows harness; repository check and specification linters.
   - **Stories / requirements / acceptance criteria:** US-01-US-12; all FRs, NFRs, and INVs; APP-AC-17, APP-AC-26, APP-AC-39, APP-AC-49-APP-AC-53, APP-AC-75, APP-AC-77; AC-01-AC-23; CT-F27-01-CT-F27-09.
   - **Implementation:** Run complete fake workflows for mixed batches, clean/no-op review, AI-resolved conflict, ambiguous conflict, dirty choices, stale source/head, re-evaluation, per-result approval, no-code publication, changed merge publication, uncertain commit/push, restart, renderer replacement, invalidation, and sibling failure. Verify native/deep-link entry, full evidence/diff, safe worktree actions, primary-state separation, accessibility, redaction, typed boundaries, no force options, no AI/publication credential leak, and no response path.
   - **Visible result:** One evidence report demonstrates that a developer can open, understand, recover, discard, re-evaluate, approve, and publish an individual synchronization result while every sibling and historical Review Bundle remains independently safe.
   - **Durable records / external effects:** Uses test-owned SQLite, temporary Git repositories/worktrees, fake F06/F13/F14/F19/F20/F22/F23/F24/F25/F26 ports, bounded reports, and linter evidence. It does not contact live GitHub, invoke live AI, use credentials, edit checklist.md, or publish a real branch.
   - **Failure / cancellation / restart:** Any false ready state, stale bypass, duplicate effect, force flag, wrong repository/ref, lost history, cross-result mutation, unsafe clear, secret/SDK/path leak, inaccessible control, invalid mapping, or definite linter miss blocks the gate. A cancelled run leaves no success marker and can be rerun from clean fixtures.
   - **Exact evidence:** npm run check; F27 contract/integration report; batch/result/reason/evidence report; dirty/stale/re-evaluation state graph; approval/preflight/phase/commit/push/reconciliation report; no-op and zero-AI report; old/new head invalidation and historical Review Bundle report; restart/renderer/sleep/network fault report; keyboard/screen-reader/forced-colors/reduced-motion/zoom/narrow-width/Windows current-desktop evidence; forbidden-import/credential/raw-provider/arbitrary-path/command/force-option scan; git diff --check; npm run lint:prd-plan -- Specs/synchronization_result_review_staleness_and_publication_PRD.md Specs/synchronization_result_review_staleness_and_publication_PLAN.md; npm run lint:application-coverage -- Specs/application_overview.md Specs/synchronization_result_review_staleness_and_publication_PRD.md.
   - **Exit criterion:** All F27 requirements have direct or named contract evidence, mapped application criteria have no definite missing/invalid result, both specification linters pass without definite missing/invalid results, and F27 remains unchecked pending implementation approval and completion.

## Cross-Slice Verification and Handoff

- F02 remains the only owner of legal synchronization states, structured
  reason vocabulary, overlay independence, and primary PR state semantics.
  F27 supplies deterministic triggers and projections but never creates a
  competing primary state machine.
- F03 remains the only owner of migrations, transactions, uniqueness,
  expected revisions, publication locks, append-only histories, and durable
  recovery identities. F27 never treats renderer state or activity text as
  authoritative.
- F06 remains the only GitHub transport boundary. F27 supplies exact
  server/repository/ref identities and consumes typed current-state,
  expected-old-SHA, and reconciliation outcomes.
- F13 remains authoritative for canonical worktree paths, actual Git state,
  merge-result/tree/diff inspection, attribution, overlap, and clear
  mechanics. F27 presents and gates those facts; it does not infer ownership
  or implement a second Git classifier.
- F14 remains authoritative for validation commands, output, phase, and
  passed/failed/not-run/interrupted status. F27 never converts provider prose
  or a status label into validation success.
- F19/F20 provide notification/deep-link and accessible evidence/diff/worktree
  surfaces. F27 provides a synchronization target and typed capabilities; it
  does not call native window/file APIs directly.
- F22 owns Review Bundle stale transitions. F27 emits the exact old/new head
  invalidation after successful synchronization publication and does not
  rewrite Review Bundle records itself.
- F23 owns Review Bundle publication. F27 shares its approval and
  persist-before-effect principles but has a separate synchronization
  publication aggregate with no response rows.
- F24/F25/F26 remain the source of synchronization identity, merge truth,
  validation handoff, conflict evidence, AI reports, ambiguity, and retry
  contracts. F27 never makes a provider claim authoritative.
- F28-F30 own full startup/network/security/packaging/release hardening. F27
  contributes durable phase, reconciliation, accessibility, Windows, and
  capability-boundary evidence.
- The exact owning PRD is
  Specs/synchronization_result_review_staleness_and_publication_PRD.md. These
  documents create no application code, do not change checklist.md, and do
  not claim that synchronization result review or publication is implemented.

## Requirement-to-Slice Trace

| Requirement family | Owning slices |
|---|---|
| FR-01 | 1, 2, 7 |
| FR-02 | 1-2, 7 |
| FR-03 | 3-4, 7 |
| FR-04 | 4-5, 7 |
| FR-05 | 5, 7 |
| FR-06 | 6-7 |
| FR-07 | 4-7 |
| FR-08 | 1-7 |
| NFR-01-NFR-07 | 1-7 |
| INV-01-INV-13 | 1-7 |
| APP-AC-17, APP-AC-26, APP-AC-39 | 1-7 |
| APP-AC-49-APP-AC-53 | 1-7 |
| APP-AC-75, APP-AC-77 | 1-7 |

