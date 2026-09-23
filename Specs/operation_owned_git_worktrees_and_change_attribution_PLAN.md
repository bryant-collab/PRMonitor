<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single layer. The goal is to provide the AI and the user with a visible and testable result when the work is complete.
There might be slices that are needed to describe work that doesn't extend through all levels, that's fine, but the preference should be towards vertical slices since this will result in the best quality output.
-->

# Plan: F13 Operation-owned Git Worktrees and Change Attribution

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** `Specs/operation_owned_git_worktrees_and_change_attribution_PRD.md`
>
> **Last revalidated against:** `Specs/application_overview.md` revision 2026-09-21 and F13 PRD revision 2026-09-23
>
> **Entry/readiness gates:** F03 exposes transactional worktree/diff/operation repositories, uniqueness, expected-version conflicts, bounded JSON codecs, and restart-safe records. F04 exposes the main-process/OS adapter boundary. F07 exposes a validated base clone or a typed `LOCAL_CLONE_REQUIRED` setup block plus explicit server/repository/base/head identities. F11/F12 expose held operation ownership, batch/operation identities, and automatic-versus-explicit dispatch semantics. The test harness can create temporary Git repositories, concurrent operation requests, dirty/manual edits, binary/rename/delete cases, cancellation, process interruption, persistence faults, renderer absence, and OS-action fakes.
>
> This PLAN cannot change product requirements. Resolve contradictions in the owning PRD before implementation and rerun both specification linters. This feature does not check the checklist item; implementation and approval are separate.

## Implementation Boundary

F13 adds the deterministic Git/worktree boundary between managed-PR state and
downstream validation, AI, review, synchronization, and publication workflows.
It owns the effective root/path policy, operation-owned source data, explicit
ref/SHA preparation, worktree ownership and lifecycle, current-state
inspection, immutable before/after snapshots, proposed/context diff evidence,
safe open/reveal actions, and three-way change attribution/cleanup.

F03 remains authoritative for SQLite, migrations, transactions, uniqueness,
expected-version conflicts, and durable records. F04 remains authoritative for
main-process lifecycle and platform OS actions. F06/F07 remain authoritative
for GitHub identity and the validated developer-clone relationship. F11/F12
remain authoritative for eligibility, holds, batches, and automatic-dispatch
admission. F14 owns command validation; F15-F18/F21 own AI invocation and
bounded work; F19/F20/F22 own presentation and discard/re-evaluation
orchestration; F24-F27 own synchronization merge/conflict/publication behavior;
F23/F27 own all remote publication. F13 never invokes an AI provider, runs
validation, commits, pushes, posts responses, merges, or publishes.

The implementation may add migrations or repository methods to the existing
F03 `worktrees` and `diffs` records, but it must not create a second durable
database or treat a free-form payload/activity event as authoritative state.

## Readiness Gates

- F03 can reserve a canonical path and operation identity atomically, retain immutable worktree/SHA/snapshot/diff evidence, and distinguish committed, interrupted, uncertain, conflict, and retryable outcomes.
- F07 can provide a base clone that F13 may read without changing its branch, index, files, or worktree status; missing setup is returned as a typed block rather than repaired implicitly.
- F04 provides an OS adapter for open/reveal with canonical-path validation and a main-process call boundary; renderer requests are not direct shell commands.
- F11/F12 can supply the owning managed PR, Review Bundle/batch/operation identity, current hold/dispatch status, and a typed refusal when the operation is stale, held, or not authorized.
- The Git runner test seam can execute only allowlisted argument vectors with bounded output, timeouts, cancellation, controlled locale/environment, and no credential-bearing diagnostics.
- Temporary fixtures can create a separate operation-owned source/cache and review/synchronization worktrees, then mutate the operation worktree manually and through a fake AI turn without touching the developer clone.
- Downstream fakes can consume preparation, inspection, snapshot, diff, open/reveal, clear-choice, and recovery contracts without importing Git subprocess details.

## Proposed Vertical Slices

1. **Root policy, operation identity, and explicit ref preparation**
   - **Blocked by:** F03 path/operation repositories, F04 main-process boundary, F07 clone/identity contract, and F11/F12 operation ownership inputs.
   - **Stories / requirements / acceptance criteria:** US-01-US-03, US-09; FR-01.1-FR-03.6, FR-09.1-FR-09.4; NFR-01-NFR-07; INV-01-INV-06, INV-10; AC-01-AC-05, AC-15-AC-18; CT-F13-01, CT-F13-02, CT-F13-03, CT-F13-06.
   - **Visible result:** A main-process contract accepts an explicit operation/ref request, resolves a bounded canonical path, reserves ownership, materializes only the requested objects in operation-owned Git data, and returns a safe typed result for missing clone, moved ref, conflict, or exact-object success.
   - **Durable records / external effects:** Adds/extends F03 worktree/operation-intent records with root revision, canonical path, operation kind, repository/ref/SHA snapshot, idempotency key, and lifecycle state. Test fixtures may create a temporary operation source/cache and read the F07 clone; no AI, validation, GitHub mutation, or publication effect is allowed.
   - **Failure / cancellation / restart:** Invalid root, path escape, absent clone, repository mismatch, missing object, cancellation before commit, Git failure, or process stop produces a bounded non-success outcome. A committed intent remains recoverable; a retry uses the same identity and cannot claim a path already owned by another operation.
   - **Exact evidence:** Root/path truth table; explicit repo/ref/SHA and default-branch non-substitution matrix; fork/same-name isolation; persist-before-Git spy; concurrent path race; developer-clone hash/status before and after; process-stop/reopen; `CT-F13-01` through `CT-F13-03` and `CT-F13-06`.
   - **Exit criterion:** AC-01-AC-05, AC-15-AC-18 pass at the preparation/ownership boundary, and no operation can be created from an unscoped path or guessed ref.

2. **Clean review and conversation worktree lifecycle**
   - **Blocked by:** Slice 1, F03 worktree persistence, and the F07 validated-clone handoff.
   - **Stories / requirements / acceptance criteria:** US-01-US-04, US-09; FR-03.1-FR-04.5; NFR-02-NFR-04, NFR-07-NFR-09; INV-02-INV-06; AC-03-AC-06, AC-09, AC-15, AC-17; CT-F13-02, CT-F13-03, CT-F13-07.
   - **Visible result:** A fixture can prepare two simultaneous operation-owned detached worktrees for review/conversation work, each at the requested PR head, while the developer clone remains byte-for-byte and status-for-status unchanged.
   - **Durable records / external effects:** Persists the worktree owner, operation kind, canonical path, `prBaseSha`, `prHeadSha`, `worktreeBaselineSha`, source identity, availability, and lifecycle state. Git creates only operation-owned data and worktree files under the configured root.
   - **Failure / cancellation / restart:** A clean-state check failure, path collision, interrupted `worktree add`, or released owner leaves the worktree in dirty/interrupted/unknown state for reconciliation rather than silently deleting it. Renderer closure does not release or reset it.
   - **Exact evidence:** Temporary repository with dirty developer clone; two PRs/operations; exact detached HEAD and clean-status assertion; path collision race; repeated same-operation request; worktree-list/readback after restart; operation-kind non-collision; `CT-F13-02`, `CT-F13-03`, and `CT-F13-07`.
   - **Exit criterion:** AC-03-AC-05, AC-09, AC-15, and AC-17 pass, with no developer-workspace mutation and no shared active path.

3. **Actual-state snapshots and authoritative diff evidence**
   - **Blocked by:** Slice 2, F03 immutable evidence records, and the downstream review/validation DTO contracts.
   - **Stories / requirements / acceptance criteria:** US-04, US-06; FR-05.1-FR-05.6, FR-09.1-FR-09.3; NFR-01, NFR-03, NFR-05-NFR-09; INV-03-INV-05, INV-07, INV-09; AC-06-AC-10, AC-14-AC-16; CT-F13-04, CT-F13-06, CT-F13-07.
   - **Visible result:** A changed operation worktree produces a current-state fingerprint, immutable manifest, proposed-worktree diff against `worktreeBaselineSha`, and separate PR-context diff against `prBaseSha`; identical state regenerates identical hashes.
   - **Durable records / external effects:** Persists bounded snapshot manifests and diff metadata/hashes linked to the owning worktree/operation/turn. Complete diff content remains regenerable from the recorded path and SHA baseline; over-limit output becomes an explicit attention result rather than a silently truncated authoritative diff.
   - **Failure / cancellation / restart:** Missing path, changed HEAD, unreadable file, malformed Git output, output limit, cancellation, or persistence failure leaves prior immutable evidence intact and returns a safe stale/attention/retryable result. No cached state is used to claim a clean worktree.
   - **Exact evidence:** Clean/dirty/staged/untracked/ignored matrix; manual edit/build/test refresh; new/deleted/renamed/binary diff vectors; proposed-vs-context comparison; stable hash replay; changed-HEAD/stale check; over-limit failure; `CT-F13-04`, `CT-F13-06`, and `CT-F13-07`.
   - **Exit criterion:** AC-06-AC-07, AC-09-AC-10, and AC-14 pass, and downstream consumers can distinguish publication-authoritative proposed diff from contextual PR diff without parsing Git output.

4. **AI-turn snapshots and safe change attribution**
   - **Blocked by:** Slice 3, F15/F17 turn identity and operation policy contracts, and F03 immutable snapshot persistence.
   - **Stories / requirements / acceptance criteria:** US-06-US-08; FR-05.2-FR-05.6, FR-07.1-FR-07.8, FR-09.1-FR-09.4; NFR-01-NFR-06, NFR-08-NFR-09; INV-03, INV-04, INV-07-INV-10; AC-09-AC-14, AC-17-AC-18; CT-F13-04, CT-F13-05, CT-F13-06.
   - **Visible result:** A fake mutating turn receives a before snapshot, changes the isolated worktree, produces an after snapshot and deterministic attribution summary, and can remove only independent AI changes while preserving manual edits.
   - **Durable records / external effects:** Persists immutable before/after snapshots, turn linkage, file/change summaries, clear-choice intent, removal outcome, preserved/manual overlap evidence, and final inspection. The fake provider is the only semantic test double; F13 itself does not import it.
   - **Failure / cancellation / restart:** Missing before snapshot, lost owner, dirty current state, binary/rename/delete overlap, reverse-apply failure, cancellation, or uncertain clear command preserves the complete worktree and returns manual-resolution/keep guidance. Clear All requires a separate destructive confirmation and never removes ignored files.
   - **Exact evidence:** Non-overlapping tracked/untracked changes; same-line and same-file overlap; binary/rename/delete cases; manual change after AI turn; Clear All/AI-only/Keep matrix; byte-for-byte no-mutation assertion on overlap; restart readback; forbidden AI/publication imports; `CT-F13-05` and `CT-F13-06`.
   - **Exit criterion:** AC-09-AC-14 and AC-17-AC-18 pass, and the service never claims ownership from filenames alone or silently discards a user change.

5. **Independent synchronization worktree and safe open/reveal contracts**
   - **Blocked by:** Slices 1-3, F04 OS adapter, and F24 synchronization identity inputs.
   - **Stories / requirements / acceptance criteria:** US-03-US-05, US-09; FR-03.1-FR-04.5, FR-06.1-FR-06.5, FR-08.1-FR-08.4; NFR-02, NFR-04, NFR-06-NFR-08; INV-02-INV-06, INV-09-INV-10; AC-05, AC-08, AC-15-AC-18; CT-F13-02, CT-F13-03, CT-F13-06, CT-F13-07.
   - **Visible result:** A synchronization fixture receives explicit source/head SHAs, records `syncMergeBaseSha`, gets a distinct clean worktree, and can request open/reveal for the worktree or a relative file through an OS fake without exposing arbitrary paths.
   - **Durable records / external effects:** Persists synchronization-specific owner/path/branch/SHA evidence and safe open/reveal requests/outcomes. No merge, conflict-resolution AI, validation, commit, push, or publication is performed.
   - **Failure / cancellation / restart:** Review/synchronization path collision, source/head movement, missing target, OS failure, or renderer closure produces a typed stale/attention/OS reason while preserving the worktree and its records. The same operation request remains idempotent after restart.
   - **Exact evidence:** Review-versus-sync non-collision; source/destination repository matrix; merge-base vector; source/head movement; relative path escape; missing file; OS adapter call allowlist; notification/UI-independent readback; `CT-F13-02`, `CT-F13-03`, `CT-F13-06`, and `CT-F13-07`.
   - **Exit criterion:** AC-05, AC-08, AC-15-AC-18 pass, and F19/F20/F24-F27 can consume the contract without gaining arbitrary filesystem or Git authority.

6. **Recovery, conformance, and implementation handoff**
   - **Blocked by:** Slices 1-5, all readiness gates, final F03 migrations/repository changes, and downstream contract fakes.
   - **Stories / requirements / acceptance criteria:** US-01-US-09; all FRs, NFRs, and INVs; AC-01-AC-18; CT-F13-01-CT-F13-07; APP-AC-10, APP-AC-21, APP-AC-37-APP-AC-39, APP-AC-67.
   - **Visible result:** A machine-readable conformance run proves isolated preparation, exact SHA evidence, reproducible proposed/context diffs, manual-edit preservation, safe three-way attribution, separate synchronization worktrees, restart recovery, and safe OS actions.
   - **Durable records / external effects:** Uses temporary repositories, application-owned temporary roots, test databases, bounded activity/evidence reports, and OS/Git fakes. It does not edit `checklist.md`, use real GitHub credentials, invoke an AI provider, publish code, or contact a real remote.
   - **Failure / cancellation / restart:** Any developer-clone mutation, duplicate path, guessed ref, false clean/clear result, unsafe overlap mutation, secret leak, forbidden capability, missing evidence, or definite coverage-linter miss blocks the gate. A cancelled run leaves no success marker and can be rerun from fresh fixtures.
   - **Exact evidence:** `npm run check`; F13 contract tests and temporary-repository reports; developer-clone before/after hashes; import/secret/arbitrary-command scan; `git diff --check`; `npm run lint:prd-plan -- Specs/operation_owned_git_worktrees_and_change_attribution_PRD.md Specs/operation_owned_git_worktrees_and_change_attribution_PLAN.md`; `npm run lint:application-coverage -- Specs/application_overview.md Specs/operation_owned_git_worktrees_and_change_attribution_PRD.md`.
   - **Exit criterion:** All F13 requirements have direct acceptance or contract-test evidence, both specification linters report no definite missing/invalid result, and F13 remains unchecked pending implementation approval and completion.

## Cross-Slice Verification and Handoff

- The exact owning PRD is `Specs/operation_owned_git_worktrees_and_change_attribution_PRD.md`; this PLAN does not add AI semantic work, validation execution, review-bundle decisions, publication, branch merging, or a new primary PR state machine.
- F03 remains authoritative for migrations, transactions, uniqueness, expected-version conflicts, and durable worktree/diff/snapshot records. F13 may extend existing `worktrees`/`diffs` persistence but must not create a second store.
- F04 remains authoritative for renderer lifecycle and OS open/reveal actions. F13 validates canonical targets and supplies a typed request; it does not construct shell strings in the renderer.
- F06/F07 remain authoritative for server/repository identity, PR base/head metadata, and the developer-clone setup. F13 never picks a default branch or same-named branch as a substitute and returns `LOCAL_CLONE_REQUIRED` when there is no approved source.
- F11/F12 remain authoritative for review holds, automatic-batch ownership, and automatic-versus-explicit admission. F13 revalidates owner/operation inputs before local effects but does not release holds or start work.
- F14 owns validation authorization and execution. F13 only reports actual worktree state and must never treat a model claim or Git command suggestion as validation authority.
- F15-F18/F21/F17 own provider invocation, policy, turn budgeting, review proposals, and semantic change requests. F13 stores deterministic snapshots and enforces the local path boundary without importing provider SDKs.
- F19/F20/F22 own notifications, diff UI, settings presentation, destructive confirmations, discard, and re-evaluate orchestration. F13 supplies exact records and refuses unsafe clear operations.
- F24-F27 own synchronization selection, merge, conflict resolution, validation, and publication. F13 provides only an independent worktree and evidence boundary.
- F23/F27 own commits, pushes, GitHub responses, and publication. F13's proposed diff is evidence, not publication authorization.
- F28-F30 own full startup/sleep/network recovery, threat-model hardening, packaging, and clean-machine acceptance. F13 supplies concrete operation/path/reconciliation evidence.
- The F13 checklist item remains unchecked. This specification phase creates only the PRD/PLAN pair and does not claim that worktree isolation, change attribution, validation, AI work, or publication is implemented.

## Requirement-to-Slice Trace

| Requirement family | Owning slices |
|---|---|
| FR-01 | 1, 2, 5-6 |
| FR-02 | 1-2, 5-6 |
| FR-03 | 1-2, 5-6 |
| FR-04 | 2, 5-6 |
| FR-05 | 3-4, 6 |
| FR-06 | 5-6 |
| FR-07 | 4, 6 |
| FR-08 | 5-6 |
| FR-09 | 1, 3-6 |
| NFR-01-NFR-09 | 1-6 |
| INV-01-INV-10 | 1-6 |
| APP-AC-10 | 1-2, 6 |
| APP-AC-21 | 3, 6 |
| APP-AC-37 | 1, 6 |
| APP-AC-38 | 5-6 |
| APP-AC-39 | 3-4, 6 |
| APP-AC-67 | 1, 3, 6 |
