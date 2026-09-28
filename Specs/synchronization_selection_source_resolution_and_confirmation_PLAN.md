<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single level. The goal of vertical layers is to provide the AI and the user with a visible and testable result when the work is complete. This improves the reliability of AI's output by providing rapid feedback.
There might be slices that are needed to describe work that doesn't extend through all levels, that's fine, but the preference should be towards vertical slices since this will result in the best quality output.
-->

# Plan: F24 Synchronization Selection, Source Resolution, and Confirmation

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** `Specs/synchronization_selection_source_resolution_and_confirmation_PRD.md`
>
> **Last revalidated against:** application overview and F24 PRD revision `2026-09-27`
>
> **Entry/readiness gates:** F06 exposes exact current PR-state/ref reads; F07 exposes immutable managed-PR configuration revisions and explicit base/head identities; F08 exposes a versioned inbox projection and synchronization-selection surface; F13 exposes typed synchronization-preparation readiness and operation identity; F16 exposes a bounded configuration revision/reference; F03/F04 expose durable main-process commands and validated IPC; F25 exposes a typed preparation handoff port.
>
> This PLAN cannot change product requirements. Resolve contradictions in the
> owning PRD before implementation. Revalidate this draft when implementation
> begins and remove or archive it when the work is complete.

## Implementation Boundary and Readiness

F24 is the user-directed preflight and authorization boundary for synchronization.
It owns the selected managed-PR identity set, effective source-branch
resolution, current source/head observation, per-PR eligibility, confirmation
summary, and durable preparation-only handoff.

F24 does not create a synchronization worktree, fetch/materialize Git objects,
attempt a merge, calculate a merge result, run validation, invoke an AI
provider, commit, push, post a response, or publish. F25 begins those actions
only after it accepts F24's persisted authorization. F26 owns the later AI
boundary for a real conflict, and F27 owns result review and publication.

The implementation must preserve these identity rules throughout the slices:

- `syncSourceBranchOverride` when non-empty, otherwise `prBaseBranch` (`base.ref`).
- Source repository is the explicit PR base repository in the MVP.
- Destination repository is the explicit PR head repository.
- Destination branch is `prHeadBranch` (`head.ref`).
- `default_branch`, a same-named ref in another repository, a cached label, or provider prose cannot substitute for an explicit identity.
- `syncSourceSha` and `prHeadSha` are current exact-ref observations, not blindly reused stored metadata.

There are no unresolved product decisions required before implementation. The
fork boundary, transient selection semantics, preparation-only confirmation,
stale-summary refusal, and clean-path/no-AI behavior are locked in PRD
PD-01 through PD-08. Implementation may refine table/DTO names only if the
observable contracts and ownership boundaries remain unchanged.

## Proposed Vertical Slices

1. **Versioned inbox selection and no-effect command surface**
   - **Blocked by:** F04 validated IPC and renderer lifecycle; F08 authoritative managed-PR projection, stable card identities, primary-state/overlay presentation; F03 read-model versioning where required.
   - **Stories / requirements / acceptance criteria:** US-01-US-03; FR-01.1-FR-01.8; FR-06.1, FR-06.3; FR-07.4; AC-01-AC-04, AC-16-AC-17; NFR-01, NFR-05-NFR-09; INV-01, INV-07, INV-09-INV-10; CT-F24-01, CT-F24-09, CT-F24-10.
   - **Implementation:** Add a versioned `SynchronizationSelectionSession` and typed commands for toggle, clear, select-all, and open synchronization. Validate managed-PR identities against the accepted F08 projection revision. Keep pre-confirmation selection transient; expose the selected count, disable the synchronization command for an empty selection, and use a singular/plural action label without changing the operation contract. Add the toolbar/card controls without changing the F08 primary review reducer or synchronization overlay state.
   - **Visible result:** The inbox shows accessible selection controls for every managed PR, a selected count, clear/select-all actions, and a synchronization action that performs no product work until the developer requests resolution.
   - **Durable records / external effects:** No durable synchronization operation and no external effect before confirmation. The main process owns the session/revision; selection commands may emit bounded read-model updates only.
   - **Failure / cancellation / restart:** Unknown/stale card IDs and stale projection revisions are rejected without changing the current selection. Clearing, cancellation, renderer close, or renderer recreation discards only the transient session. The primary review state, hold, review history, and synchronization overlay remain unchanged.
   - **Exact evidence:** Selection truth table for zero/one/many/all identities; duplicate and out-of-order command replay; stale projection race; 1/50/250-card projection; no-effect spies proving no F06/F13/F14/F15/F17/F25/F27 call; keyboard/screen-reader/focus/forced-colors/reduced-motion/zoom/narrow-width evidence; CT-F24-01, CT-F24-09, CT-F24-10.
   - **Exit criterion:** AC-01-AC-04 and AC-16-AC-17 pass; the selection surface is deterministic and accessible, and no pre-confirmation interaction can start preparation or mutate review state.

2. **Fork-safe source/destination identity resolver**
   - **Blocked by:** Slice 1; F06 exact current-PR/ref contract; F07 configuration-revision and base/head repository contract; F13 typed preparation-readiness input; F16 current configuration revision/reference.
   - **Stories / requirements / acceptance criteria:** US-04-US-06; FR-02.1-FR-02.8; FR-03.1-FR-03.4, FR-03.7; FR-07.1, FR-07.3; AC-05-AC-10, AC-15, AC-17; NFR-01, NFR-04-NFR-05, NFR-08-NFR-09; INV-01-INV-04, INV-10-INV-11; CT-F24-02-CT-F24-04, CT-F24-09.
   - **Implementation:** Build a pure source-resolution module that consumes one immutable F07 configuration revision and produces explicit source/destination identities plus `OVERRIDE`/`PR_BASE_BRANCH` provenance. Use F06's typed current PR-state and exact-ref ports independently for the base-repository source and head-repository destination. Compare any relevant PR metadata/ref identity disagreement and request F13 readiness without creating a worktree. Carry only a bounded F16 configuration revision/reference; do not construct a provider request.
   - **Visible result:** Selecting **Synchronize PR Branch(es)** opens a per-PR resolution view that names the source repository, destination/head repository, effective source branch and provenance, destination branch, current PR state, exact current `syncSourceSha` and `prHeadSha`, the observation revision/time, and safe F06 correlation metadata when available.
   - **Durable records / external effects:** Read-only F06 requests and bounded resolution-attempt evidence are allowed. No Git mutation, worktree creation, AI, validation, commit, push, or publication occurs. The immutable F07 revision and F06 observation identities are inputs to the later confirmation intent, not mutable current configuration.
   - **Failure / cancellation / restart:** Missing/deleted/ambiguous repositories, unavailable refs, metadata/ref disagreements, closed/merged PRs, F13 readiness blocks, rate limits, authentication failures, timeouts, and cancellation become per-PR typed reasons. A remote read failure does not make another selected PR disappear. Retry performs a new visible resolution rather than silently replacing the old summary.
   - **Exact evidence:** Same-repository and fork matrix; override/non-override/default-branch matrix; same-named wrong-repository negative; source/head SHA mismatch; missing/deleted/inaccessible repo/ref; current PR open/closed/merged; F13 readiness and F16 revision fake; request allowlist and raw-URL/credential redaction scan; CT-F24-02-CT-F24-04, CT-F24-09.
   - **Exit criterion:** AC-05-AC-10 and AC-15-AC-17 pass; every resolved value is explicitly scoped and no missing or ambiguous identity can become a selectable implicit ref.

3. **Per-PR eligibility and complete confirmation summary**
   - **Blocked by:** Slice 2; F08 reason/action projection; F04 accessible dialog/surface primitives; F03 bounded read-model/error contracts.
   - **Stories / requirements / acceptance criteria:** US-07; FR-03.5-FR-03.7; FR-04.1-FR-04.3, FR-04.7; FR-06.2-FR-06.5; AC-08-AC-12, AC-15-AC-17; NFR-01, NFR-04-NFR-07; INV-04, INV-08-INV-11; CT-F24-05-CT-F24-06, CT-F24-10.
   - **Implementation:** Add the deterministic eligibility classifier and summary projection. Classify every selected identity exactly once for the resolution revision as `ELIGIBLE` or `INELIGIBLE`, preserving retryability and permitted next actions. Render selected/eligible/ineligible counts and all per-PR rows, including skipped rows. Disable confirmation when no row is eligible or the resolution evidence is stale/incomplete. Keep review-state/hold information read-only and separate. Generate each actionable reason from structured what/why/next fields rather than from a status label alone.
   - **Visible result:** A mixed selection produces a confirmation summary that makes it obvious which PRs can proceed, which are skipped, why each is skipped, the exact source/head repositories and branches, both SHAs, and that confirmation authorizes preparation only.
   - **Durable records / external effects:** The summary is a bounded projection keyed by a resolution revision; it does not yet create a F25 batch. The only external activity is the read-only F06 resolution already recorded by Slice 2.
   - **Failure / cancellation / restart:** No-eligible selections show retry/clear/cancel guidance and cannot create an empty batch. A changed inbox/configuration/remote/readiness revision invalidates the summary and requires fresh resolution. Closing/cancelling the summary has no downstream effect.
   - **Exact evidence:** Eligibility matrix for open/closed/merged, missing/ambiguous refs, fork identities, SHA mismatch, F13 readiness, active-operation conflict, network/authentication/rate-limit/timeout, and mixed selections; complete-row/selected-count snapshot assertions; no silent omission; screen-reader announcement and focus/error recovery report; CT-F24-05, CT-F24-06, CT-F24-10.
   - **Exit criterion:** AC-08-AC-12 and AC-16-AC-17 pass; every selected PR is visible with truthful eligibility and the confirmation cannot authorize stale or empty preparation.

4. **Durable preparation intent and typed F25 handoff**
   - **Blocked by:** Slices 1-3; F03 transactional/idempotent repositories; F25 preparation port; F02 reason/transition vocabulary; F13 operation identity; F16 revision/reference contract.
   - **Stories / requirements / acceptance criteria:** US-08-US-11; FR-04.2-FR-04.8; FR-05.1-FR-05.6; FR-07.2-FR-07.4; AC-11-AC-15, AC-18-AC-19; NFR-02-NFR-03, NFR-08-NFR-09; INV-04-INV-07, INV-10-INV-11; CT-F24-06-CT-F24-09.
   - **Implementation:** Define the preparation intent aggregate and compare-and-swap command. On **Confirm preparation**, verify the resolution revision, persist the complete selection/classification/identity/SHA/configuration/F13/F16 snapshot, actor/time, correlation identity, and stable idempotency key in one transaction. Only after commit, emit `SynchronizationPreparationAuthorization` for eligible rows to F25. Track typed handoff progress such as pending, acknowledged, failed, and uncertain without creating F25's merge/result state machine.
   - **Visible result:** The user sees a durable “preparation requested” outcome with eligible rows handed to F25 and ineligible rows retained as skipped. The surface clearly says there is no merge publication approval in this action.
   - **Durable records / external effects:** F03 stores the immutable F24 intent and per-PR classifications before the F25 call. F25 may begin worktree preparation after acknowledging the typed authorization; F24 itself performs no Git or provider mutation.
   - **Failure / cancellation / restart:** A stale command is rejected before persistence. A persistence failure creates no handoff. A crash or uncertain F25 acknowledgement is reconciled by the same intent/key and never creates a second authorization. A duplicate command returns the existing intent or typed conflict. Cancellation, refusal, or failure after persistence preserves the summary and intent history and exposes a typed retry/reconcile action; it is not an implicit rollback of recorded history.
   - **Exact evidence:** Persist-before-handoff fault injection; duplicate and competing confirmation race; idempotency-key uniqueness; crash before/after commit and before/after F25 acknowledgement; uncertain handoff adoption; per-PR eligible/ineligible handoff; no publication capability in the authorization DTO; restart readback; CT-F24-06-CT-F24-09.
   - **Exit criterion:** AC-11-AC-15 and AC-18-AC-19 pass; F25 cannot receive an uncommitted, stale, duplicate, over-privileged, or incomplete authorization.

5. **Restart-safe presentation, downstream conformance, and accessibility gate**
   - **Blocked by:** Slices 1-4; F04 renderer recreation/window lifecycle; F08 primary-state/overlay projection; F19/F27 target contracts; F25/F26/F27 typed consumers; repository accessibility and bounded-payload conventions.
   - **Stories / requirements / acceptance criteria:** US-01-US-11; FR-01-FR-07; all AC-01-AC-19; NFR-01-NFR-09; INV-01-INV-11; CT-F24-01-CT-F24-10.
   - **Implementation:** Rehydrate committed F24 intents and handoff status after renderer recreation/restart; ensure selection/confirmation targets are provider-neutral and deep-linkable without granting authority; add typed F25/F26/F27 conformance fixtures; run boundary scans and accessibility review. Verify that primary review state, holds, and overlays remain separate while synchronization preparation is shown. Display exact repository/ref/SHA values through safe copyable fields while excluding credential-bearing raw URLs.
   - **Visible result:** A developer can close/reopen the window and still inspect the same confirmed selection, all per-PR classifications, exact SHAs, handoff status, and permitted next action. No notification, overlay, or stale renderer can authorize a second preparation or publication.
   - **Durable records / external effects:** Uses only test-owned SQLite, fakes, and temporary fixtures. No live GitHub, provider, Git, validation, commit, push, response, or publication effect is permitted in the conformance run.
   - **Failure / cancellation / restart:** Any missing intent, torn snapshot, secret-shaped payload, stale replay, primary-state mutation, duplicate handoff, inaccessible control, or false publication implication blocks the gate. A cancelled run leaves no success marker and can be rerun from fresh fixtures.
   - **Exact evidence:** `npm run check`; F24 contract/integration report; selection/resolution/eligibility matrix; persist-before-handoff and restart report; F08 primary-state/hold preservation report; F25/F26/F27 typed-consumer report; import/capability/secret/raw-URL scan; keyboard/screen-reader/forced-colors/reduced-motion/zoom/narrow-window evidence; `git diff --check`; both specification-linter commands.
   - **Exit criterion:** All F24 requirements have direct or named contract evidence, APP-AC-03/17/43/44/45 mappings have no definite missing/invalid result, both specification linters pass without definite missing/invalid results, and F24 remains unchecked pending implementation approval and completion.

## Cross-Slice Verification and Handoff

- F02 remains authoritative for legal reason/state transitions and automatic-review hold semantics. F24 never creates a competing primary PR state machine.
- F03 remains authoritative for durable intent, uniqueness, transactions, optimistic concurrency, append-only history, and restart-safe records. A renderer flag or activity message is never F24 state.
- F04 remains authoritative for validated IPC, renderer lifecycle, routing, and OS/platform boundaries. F24 sends only typed commands/targets and bounded read models.
- F06 remains the only GitHub REST boundary. F24 supplies explicit server/repository/ref identities and consumes current PR/ref results; it does not implement request construction, credentials, or transport retry policy.
- F07 remains authoritative for managed-PR identity, base/head metadata, `syncSourceBranchOverride`, PR Intent / Context, and configuration revisions. F24 snapshots a revision and never rewrites current configuration.
- F08 remains authoritative for the complete inbox projection, primary review grouping, ordering, and synchronization-overlay presentation. F24 adds selection and confirmation behavior without changing the primary state or hold.
- F13 remains authoritative for operation roots, source materialization, worktree ownership/readiness, actual Git state, and later merge preparation. F24 consumes readiness and passes exact inputs; it does not create or inspect a worktree.
- F16 remains authoritative for task profiles, policies, Common Instructions, and validation-context revisions. F24 carries only a bounded configuration reference; F25/F26 resolve the complete AI-capable snapshot at the declared operation boundary.
- F25 owns the independent synchronization batch/operation, worktree preparation, deterministic merge, no-op/clean result, conflict evidence, and validation. Its input is the committed F24 authorization, not renderer state.
- F26 owns any AI-assisted semantic conflict resolution and bounded work reports. No F24 command can invoke or continue it.
- F27 owns result review, stale detection, discard/re-evaluation, explicit per-result publication approval, non-force push, and publication recovery. F24's confirmation never implies publication.
- F19/F28 consume bounded status/target/recovery data and cannot gain preparation or publication capability from a notification. F29/F30 own cross-feature threat-model and release evidence.
- The exact owning PRD is `Specs/synchronization_selection_source_resolution_and_confirmation_PRD.md`; these documents create no application code, do not change `checklist.md`, and do not claim that synchronization behavior is implemented.

## Requirement-to-Slice Trace

| Requirement family | Owning slices |
|---|---|
| FR-01 | 1, 3, 5 |
| FR-02 | 2, 3, 5 |
| FR-03 | 2-3, 5 |
| FR-04 | 3-5 |
| FR-05 | 1, 4-5 |
| FR-06 | 1, 3, 5 |
| FR-07 | 2, 4-5 |
| NFR-01-NFR-09 | 1-5 |
| INV-01-INV-11 | 1-5 |
| APP-AC-03, APP-AC-17 | 1, 4-5 |
| APP-AC-43-APP-AC-45 | 1-5 |
