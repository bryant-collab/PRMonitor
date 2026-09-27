<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single level. The goal is to provide the AI and the user with a visible and testable result when the work is complete. This improves the reliability of the AI's output by providing rapid feedback. Prefer vertical slices, while allowing contract-only slices where the behavior has no direct UI.
-->

# Plan: F22 Discard, Stale Detection, and Re-evaluation with Dirty-Worktree Choices

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** `Specs/discard_stale_detection_and_re_evaluation_with_dirty_worktree_choices_PRD.md`
>
> **Last revalidated against:** `Specs/application_overview.md` revision 2026-09-26, F10-F13/F16-F21 PRDs and PLANs, and the F22 PRD above
>
> **Entry/readiness gates:** F03 exposes durable intent-before-effect transactions, expected-revision checks, and restart-safe records. F10/F06 expose explicit current PR-head reads and immutable remote observations. F11 exposes handled-version, retained-during-hold, explicit re-evaluation, and hold transfer/release contracts. F13 exposes the fresh typed `WorktreeCondition`, authoritative diffs/snapshots, operation ownership, and all three dirty-worktree choices. F16 exposes current immutable Automatic Review / Re-evaluation snapshots. F18 exposes a typed re-evaluation handoff and committed bundle read model. F20 exposes the accessible action surface, F21 exposes active-operation/revision status, and F19/F04 expose safe routing. Test fakes can inject remote movement, dirty/overlap states, persistence faults, renderer absence, process restart, and no-effect spies.
>
> This PLAN cannot change product requirements. Resolve contradictions in the owning PRD before implementation and rerun both specification linters. This feature does not check the checklist item; implementation and approval are separate.

## Implementation Boundary

F22 owns the main-process stale/discard/re-evaluation coordinator, action-time
freshness and worktree-condition gate, dirty-worktree choice flow, discard
outcome handoff, re-evaluation preview/authorization, old/new bundle linkage,
hold transfer request, and bounded downstream action projection.

F10/F06 remain authoritative for current remote observations and explicit
server/repository/PR identities. F11 remains authoritative for event-version
associations, handled history, re-evaluation authorization, and legal hold
transitions. F13 remains authoritative for worktree ownership, actual Git
state, attribution, diffs, snapshots, clear mechanics, and canonical paths.
F16 remains authoritative for current task/profile/policy/context snapshots.
F18 remains authoritative for proposal preparation, baseline/review-proposal
sequencing, bundle stage/state, and finalization. F20 presents the workflow;
F21 owns active conversations/revisions; F19/F04 own routing and native
lifecycle; F23 owns publication.

F22 must not import an AI SDK, call a provider directly, run validation, parse
GitHub or Git output, implement another stale classifier, reset/delete a
worktree implicitly, mutate the developer clone, release a hold from UI
navigation, or perform any commit/push/response/publication effect.

## Readiness Gates

- F10/F06 can return a fresh, server-scoped remote-head result that distinguishes unchanged, proven movement, unavailable, malformed, cancelled, and stale observations without exposing credentials or raw response payloads.
- F03 can persist an F22 intent and expected revision before an F13/F16/F18/F11 effect, return the existing result for an equal idempotency identity, and expose committed versus uncommitted state after fault injection.
- F11 can atomically preserve handled associations, retain new versions during a hold, authorize explicit re-evaluation of selected inputs, and release or transfer the hold without ordinary replay.
- F13 exposes `WorktreeCondition` with current fingerprint/revision, dirty summary, attribution/overlap evidence, and permitted actions; F13 implements safe Clear All and three-way Clear Only AI Changes with no developer-clone mutation.
- F16 exposes a current Automatic Review / Re-evaluation snapshot with profile, policy, Common Instructions, Build & Validation, PR Intent / Context, and bounds/revision metadata.
- F18 accepts a typed re-evaluation request, creates a new proposal/final bundle through its existing read-only workflow, and links old/new history without changing old snapshots.
- F20/F04/F19 can render and route a bounded stale/attention/dirty action projection with keyboard, screen-reader, forced-colors, reduced-motion, narrow-window, and restart semantics.
- F21 exposes active revision/operation status so F22 refuses to steal or share a mutable bundle worktree.
- Fixtures can run without live GitHub, AI, credentials, or publication and can prove zero direct provider/Git/validation/remote-mutation effects from F22.

## Proposed Vertical Slices

1. **Remote-head observation, stale transition, and shared action gate**
   - **Blocked by:** F03 records, F10/F06 current-head port, F18 bundle snapshots, F11 hold read, F20/F23 consumer DTOs, and the F22 stale reason contract.
   - **Stories / requirements / acceptance criteria:** US-01-US-02, US-09; FR-01.1-FR-01.8, FR-02.1-FR-02.8, FR-08.1-FR-08.4; NFR-01-NFR-03, NFR-05-NFR-08; INV-01-INV-04, INV-08-INV-11; AC-01-AC-05, AC-12, AC-17-AC-20; CT-F22-01-CT-F22-03, CT-F22-09-CT-F22-10.
   - **Implementation:** Define the versioned remote-head result, stale/attention reason union, action-gate projection, and F03-backed monotonic transition. Connect F10 observation delivery and an action-time fresh-read port. Keep active `WORKING` operations as invalidated-but-running until their owner reaches a stable outcome. Make the stale gate consumable by F20/F21/F23 without log parsing, with separate fields for the Review Bundle state, PR primary review state, per-PR hold, and synchronization overlay.
   - **Visible result:** A bundle whose recorded PR head differs from the current server-scoped head shows `STALE`, expected/observed SHAs, preserved evidence, and blocked old-work actions while its ordinary PR state, hold, and any synchronization overlay remain independently visible. An unavailable check shows attention/unavailable rather than a guessed stale label.
   - **Durable records / external effects:** Adds F22 stale evidence, freshness attempts, action-gate revisions, and correlation records through F03; calls only F10/F06 reads. No Git, AI, validation, worktree, hold-release, or publication effect.
   - **Failure / cancellation / restart:** `304`/unchanged is a no-op; duplicate mismatches return the existing stale record; network/malformed/cancelled reads retain the prior bundle and produce a retryable attention result; restart reconciles a committed transition by identity. A head that returns to the old SHA remains stale until explicit resolution.
   - **Exact evidence:** Remote-head truth table; four-scope identity matrix; stale monotonic/idempotency test; `WORKING` invalidation trace; unavailable-versus-proven-movement report; independent primary-state/hold/synchronization-overlay projection matrix; F20/F21/F23 typed projection and no-effect spies; CT-F22-01-CT-F22-03, CT-F22-09-CT-F22-10; `git diff --check`.
   - **Exit criterion:** AC-01-AC-05, AC-12, AC-17-AC-20 pass and every downstream consumer receives one evidence-based stale/action gate.

2. **Action-time owner, revision, and WorktreeCondition gate**
   - **Blocked by:** Slice 1, F13 `WorktreeCondition`, F11 hold/owner contracts, F18/F21 action capabilities, and expected-revision persistence.
   - **Stories / requirements / acceptance criteria:** US-03-US-04, US-06, US-09; FR-02.1-FR-02.8, FR-03.1-FR-03.3, FR-06.1-FR-06.7, FR-08.1-FR-08.4; NFR-02-NFR-06, NFR-08; INV-01, INV-03-INV-06, INV-09-INV-11; AC-02-AC-07, AC-12-AC-13, AC-17-AC-20; CT-F22-02-CT-F22-03, CT-F22-06, CT-F22-09-CT-F22-10.
   - **Implementation:** Build one coordinator admission function that refreshes remote identity and F13 condition, validates bundle/hold/evidence/active-operation revisions, and returns a typed permitted-action set. Reject active F21/F18 mutation races, missing ownership, stale renderer state, and unresolved stale/unknown evidence. Persist the action intent before any delegated effect.
   - **Visible result:** Opening Discard/Re-evaluate shows a current condition and either a safe preview or a precise reason to refresh, inspect, continue the owning operation, or stop. The same action gate drives F20 controls and F23 publication blocking.
   - **Durable records / external effects:** Adds action intents and condition/freshness references; delegates only read/inspection calls until the user confirms. No direct filesystem or remote mutation.
   - **Failure / cancellation / restart:** A stale or duplicate command returns existing/refusal data; condition revision changes require refresh; an active operation cannot be stolen; renderer closure leaves a pending intent recoverable; uncertain reads never authorize a destructive path.
   - **Exact evidence:** Admission matrix by bundle state/stage/operation; stale-renderer race; competing action race; WorktreeCondition projection matrix; active-revision negative test; persist-before-effect fault injection; CT-F22-02, CT-F22-03, CT-F22-06, CT-F22-09, CT-F22-10.
   - **Exit criterion:** AC-02-07, AC-12-13, AC-17-20 pass and no discard/re-evaluation path can bypass fresh F10/F13 evidence or ownership.

3. **Discard confirmation and clean/dirty choice flow**
   - **Blocked by:** Slice 2, F13 clear contracts, F11 handled/outcome contract, F18 discard capability, and the F20 accessible confirmation surface.
   - **Stories / requirements / acceptance criteria:** US-03-US-05, US-09-US-10; FR-03.1-FR-03.9, FR-05.1-FR-05.6, FR-07.1-FR-07.4; NFR-02-NFR-08; INV-01, INV-05-INV-09, INV-11; AC-06-AC-11, AC-19-AC-20; CT-F22-03-CT-F22-05, CT-F22-09-CT-F22-10.
   - **Implementation:** Add clean-discard confirmation and the exact three-option dirty-worktree decision contract. Route Clear All through explicit destructive confirmation and F13 re-inspection; route Clear Only AI Changes through F13's three-way algorithm; make Keep Worktree and Cancel a durable no-effect outcome. After a safe clear, refresh the condition and complete the F11/F18 discard handoff without deleting the recorded path.
   - **Visible result:** The developer sees the actual dirty summary and can discard, preserve all work, or remove only safely attributable AI changes. Overlap leaves the worktree and bundle intact with an actionable explanation.
   - **Durable records / external effects:** Persists discard intent, user choice, confirmation, F13 clear result, post-clear condition, handled outcome, and hold release. F13 may mutate only the owned operation worktree after confirmation; F11/F18 may change bundle/hold records. No AI, validation, commit, push, or publication effect.
   - **Failure / cancellation / restart:** Cancellation before choice changes nothing. F13 failure/uncertainty, overlap, missing path, persistence failure, or post-clear mismatch leaves the bundle non-discarded/attention-blocked and preserves evidence. Restart resumes/reconciles the same intent and never repeats a clear blindly.
   - **Exact evidence:** Clean/dirty/ignored/untracked/binary/rename/delete matrix; Clear All destructive-confirmation trace; three-way AI-only overlap corpus; byte-for-byte preservation report; developer-clone negative fixture; F11 handled/hold ordering; keyboard-only tab/focus order, accessible-name/required-confirmation, screen-reader announcement, forced-colors/high-contrast, reduced-motion, narrow-width, and no-horizontal-overflow report; CT-F22-03-CT-F22-05, CT-F22-09-CT-F22-10.
   - **Exit criterion:** AC-06-AC-11 and AC-19-AC-20 pass; APP-AC-23/24/39 discard evidence is complete and no implicit cleanup remains.

4. **Re-evaluation preview, feedback scope, and current configuration snapshot**
   - **Blocked by:** Slices 1-3, F11 explicit re-evaluation authorization, F16 snapshot resolver, F18 request schema, F20 preview UI, and retained-version read models.
   - **Stories / requirements / acceptance criteria:** US-06-US-07, US-10; FR-04.1-FR-04.7, FR-05.2-FR-05.4, FR-07.1-FR-07.4, FR-08.1-FR-08.4; NFR-01-NFR-08; INV-01-INV-04, INV-07, INV-10-INV-11; AC-12-AC-15, AC-19-AC-20; CT-F22-06-CT-F22-08, CT-F22-10.
   - **Implementation:** Build a bounded preview model showing old/current repository and SHA identity, original immutable feedback versions, retained candidates, WorktreeCondition, current profile/policy/context summary, hold behavior, and no-publication consequence. Require explicit confirmation and request an F11 token that binds the version set and old bundle. Resolve F16 only after authorization; never use current settings to rewrite the old bundle.
   - **Visible result:** Re-evaluate is a deliberate, review-only preparation action. The user can see exactly which feedback will be revisited, which worktree changes will be preserved/removed, and which current settings will apply before starting.
   - **Durable records / external effects:** Persists preview/action revisions, authorization identity, version-set snapshot, current-input snapshot references, and cancellation/confirmation outcome. No provider/worktree effect before confirmation and authorization.
   - **Failure / cancellation / restart:** Closing/cancelling the preview or choosing Keep cancels without a new bundle. A stale preview requires refresh. An F11/F16 refusal preserves the old bundle and hold with a bounded reason. Restart restores the same preview/intent outcome without creating a duplicate.
   - **Exact evidence:** Preview schema/bounds; old-versus-current snapshot matrix; original/retained version selection and F11 authorization test; no-publication confirmation wording; changed Preferences/PR Context fixture; cancel/restart/accessibility report; CT-F22-06-CT-F22-08, CT-F22-10.
   - **Exit criterion:** AC-12-AC-15, AC-19-AC-20 pass and the new evaluation cannot begin without an explicit, review-only authorization.

5. **Fresh worktree and F18 read-only re-evaluation handoff**
   - **Blocked by:** Slice 4, F13 distinct-operation preparation, F16 effective snapshot, F18 proposal/baseline orchestration, F14/F15/F17 ports, and the one-active-review hold contract.
   - **Stories / requirements / acceptance criteria:** US-07-US-08; FR-04.4-FR-04.9, FR-05.3-FR-05.6, FR-06.1-FR-06.6, FR-08.1-FR-08.3; NFR-01-NFR-04, NFR-06-NFR-08; INV-02-INV-04, INV-07-INV-11; AC-14-AC-18; CT-F22-07-CT-F22-09.
   - **Implementation:** Persist a re-evaluation operation before requesting a new F13 worktree. Create a distinct clean worktree at the current exact head and capture fresh three-SHA evidence. Resolve the current F16 Automatic Review / Re-evaluation snapshot and call F18's typed re-evaluation entry point with original/authorized retained versions, old-bundle link, and hold-transfer token. Let F18 own baseline validation, read-only proposal, bounded provider work, and the new bundle commit.
   - **Visible result:** Re-evaluation creates a new proposal/attention bundle with a new worktree and current configuration while the old result remains available as stale/superseded history. No code implementation starts before new proposal decisions.
   - **Durable records / external effects:** Adds the F22 re-evaluation operation, F13 worktree record, F16 snapshot references, F11 authorization, F18 new-bundle link, and F09 activity. F18 may run baseline/read-only proposal effects under its existing contracts; F22 provides no publication authority.
   - **Failure / cancellation / restart:** Missing/moved refs, worktree collision, F16 refusal, provider/validation failure, second head movement, F18 persistence fault, or uncertain handoff preserves old/new evidence and the hold, yields attention, and never auto-retries or silently reuses the old path. Restart adopts a proven new operation or marks it unknown for reconciliation.
   - **Exact evidence:** Distinct-path/three-SHA report; old/new bundle graph; current-snapshot immutability; F18 read-only proposal and no-publication spy; second-head-movement fixture; F11 hold transfer; failure/restart fault matrix; CT-F22-07-CT-F22-09.
   - **Exit criterion:** AC-14-AC-18 pass and a re-evaluation produces a newly snapshotted, linked bundle while the per-PR hold remains active.

6. **History, notification, and downstream action conformance**
   - **Blocked by:** Slices 1-5, F19/F20/F21/F23 typed consumer contracts, F11 handled/retained projections, and the Windows desktop/accessibility harness.
   - **Stories / requirements / acceptance criteria:** US-01-US-10; all FRs, NFRs, and INVs; APP-AC-16-APP-AC-17, APP-AC-23-APP-AC-26, APP-AC-39, APP-AC-41-APP-AC-42, APP-AC-67, APP-AC-73, APP-AC-75; AC-01-AC-20; CT-F22-01-CT-F22-10.
   - **Implementation:** Run end-to-end fake workflows for poll-to-stale, stale-to-discard, dirty-choice outcomes, stale-to-re-evaluation, new-bundle proposal, later discard, hold release, and retained-feedback eligibility. Verify F19 routes attention, F20 exposes evidence/choices, F21 cannot race an active revision, and F23 refuses stale publication while retaining its own final recheck. Exercise renderer replacement, deep-link navigation, keyboard/accessibility, narrow width, and two-PR isolation.
   - **Visible result:** A developer can safely inspect, discard, or re-evaluate a stale/dirty bundle after closing and reopening the app, with no lost manual work, duplicate AI work, or accidental publication path.
   - **Durable records / external effects:** Uses test-owned SQLite, temporary operation worktrees, fake remote/AI/validation/OS ports, bounded activity and notification target records, and linter evidence. It does not edit `checklist.md`, contact live services, or publish code/responses.
   - **Failure / cancellation / restart:** Any lost handled association, released hold, duplicate worktree/bundle/clear, false stale, publication bypass, unsafe path, secret leak, inaccessible choice, or invalid mapping blocks the gate. Cancelled test runs leave no success marker and are rerunnable.
   - **Exact evidence:** `npm run check`; F22 contract/integration report; stale/dirty/re-evaluation state graph; F11 history/hold report; F13 condition/clear report; F16/F18 snapshot report; F19/F20/F21/F23 conformance report; restart/fault report; keyboard/screen-reader/forced-colors/reduced-motion/narrow-width/Windows route evidence; persistence/IPC/provider-boundary corpus rejecting credentials, authorization headers, SDK objects, secret-bearing environment values, arbitrary paths/commands, raw remote payloads, unbounded diagnostics, and publication methods; developer-clone and no-authority scans; `git diff --check`; `npm run lint:prd-plan -- Specs/discard_stale_detection_and_re_evaluation_with_dirty_worktree_choices_PRD.md Specs/discard_stale_detection_and_re_evaluation_with_dirty_worktree_choices_PLAN.md`; `npm run lint:application-coverage -- Specs/application_overview.md Specs/discard_stale_detection_and_re_evaluation_with_dirty_worktree_choices_PRD.md`.
   - **Exit criterion:** All F22 requirements have direct or named contract evidence, all mapped application criteria have no definite missing/invalid result, both specification linters have run against the final pair, and F22 remains unchecked pending implementation approval and completion.

## Cross-Slice Verification and Handoff

- The exact owning PRD is `Specs/discard_stale_detection_and_re_evaluation_with_dirty_worktree_choices_PRD.md`; this PLAN does not add initial review, automatic polling/eligibility, provider implementation, validation execution, synchronization merges, or publication requirements.
- F10/F06 remain authoritative for remote observations and explicit server/repository/PR/head identity. F22 compares exact SHAs and distinguishes proven movement from unavailable evidence; it does not use a default branch, local branch, log text, or provider claim.
- F11 remains authoritative for immutable event-version associations, handled outcomes, retained-during-hold versions, explicit re-evaluation authorization, and legal hold release/transfer. F22 never makes an ordinary automatic batch replay a handled version.
- F13 remains authoritative for operation ownership, actual worktree state, `WorktreeCondition`, attribution/overlap, before/after snapshots, diff evidence, clear mechanics, canonical paths, and developer-clone protection. F22 delegates all clear decisions and never implements a second classifier.
- F16 remains authoritative for current task/profile/policy/Common Instructions/Build & Validation/PR Intent / Context snapshots. F22 asks for a new snapshot only after explicit re-evaluation authorization and never rewrites the old bundle snapshot.
- F18 remains authoritative for baseline/proposal sequencing, read-only proposal behavior, bundle stage/state, and final bundle commits. F22 supplies the current input set, fresh worktree/SHA evidence, and hold-transfer handoff; F18 owns the new proposal result.
- F20 owns final presentation, accessibility, and visual stale/attention treatment; F21 owns conversation/revision lifecycle; F19/F04 own native routing and window lifecycle. F22 supplies typed action, reason, condition, and target data and no renderer authority.
- F23 remains the publication owner and must revalidate remote head, worktree condition, exact proposed diff, and explicit approval. F22's stale gate prevents old work from being treated as publishable but does not replace F23's final check.
- F28-F30 own complete startup/network/security/packaging hardening. F22 contributes concrete fault, preservation, redaction, no-authority, and Windows accessibility evidence.
- The F22 checklist item remains unchecked. These documents create only the PRD/PLAN pair and do not change `checklist.md`, implement discard/stale/re-evaluation behavior, release a hold, or publish any work.

## Requirement-to-Slice Trace

| Requirement family | Owning slices |
|---|---|
| FR-01 | 1, 2, 6 |
| FR-02 | 1-2, 6 |
| FR-03 | 2-3, 6 |
| FR-04 | 4-5, 6 |
| FR-05 | 3-6 |
| FR-06 | 2-6 |
| FR-07 | 2-4, 6 |
| FR-08 | 1-2, 4-6 |
| NFR-01-NFR-08 | 1-6 |
| INV-01-INV-11 | 1-6 |
| APP-AC-16-APP-AC-17 | 1-6 |
| APP-AC-23-APP-AC-26 | 1-6 |
| APP-AC-39 | 2-6 |
| APP-AC-41-APP-AC-42 | 4-6 |
| APP-AC-67 | 1-6 |
| APP-AC-73, APP-AC-75 | 4-6 |
