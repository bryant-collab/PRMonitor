<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single level. The goal is to provide the AI and the user with a visible and testable result when the work is complete.
There might be slices that are needed to describe work that doesn't extend all the way through the product, but the preference should be towards vertical slices.
-->

# Plan: F28 Restart, Sleep, Network-Loss, and Uncertain-Outcome Recovery

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** Specs/restart_sleep_network_loss_and_uncertain_outcome_recovery_PRD.md
>
> **Last revalidated against:** Specs/application_overview.md revision 2026-09-28 and F28 PRD revision 2026-09-28
>
> **Entry/readiness gates:** F02-F03 expose legal transitions, structured reasons, transactions, expected revisions, and append-only/idempotent persistence. F04 exposes main-process lifecycle, renderer replacement, explicit shutdown, and sleep/wake signals. F09 exposes bounded correlated activity. F10-F12 expose polling, eligibility, holds, batches, pause, deadlines, and dispatch identities. F13-F14 expose fresh worktree/Git condition and validation interruption contracts. F15-F17 expose provider-neutral turn identities, profile/policy snapshots, budgets, timeout/cancellation, reports, and explicit continuation. F18-F23 expose Review Bundle revision/hold/publication records, commit SHAs, response IDs, and response-only recovery. F24-F27 expose exact synchronization identities, result histories, conflict evidence, stale/review gates, and no-force publication recovery. Test fixtures can inject clocks, sleep/network signals, renderer absence, process termination, local Git state, remote refs/responses, and persistence faults.
>
> **Approval gate:** Product decisions PD-01 through PD-06 in the owning PRD define the automatic-recovery boundary. Confirm them before implementation; if any decision changes, revise and relint both documents.
>
> This PLAN cannot change product requirements. Resolve contradictions in the
> owning PRD before implementation and rerun both specification linters. This
> feature does not check the checklist item; implementation and approval are
> separate.

## Implementation Boundary

F28 adds the main-process RecoveryCoordinator and the durable recovery-session,
attempt, scope, retry, classification, and projection contracts. It receives
startup, renderer-replacement, wake, online/offline, explicit recovery, and
shutdown lifecycle signals; coalesces equivalent triggers; scans durable owner
records in dependency order; and hands work back to the existing feature that
owns the state or effect.

F03 remains authoritative for schemas, migrations, transactions, uniqueness,
expected revisions, idempotency, and committed-versus-uncommitted outcomes.
F02 remains authoritative for primary PR states, synchronization overlays,
structured reasons, and legal transitions. F04 remains authoritative for
Electron lifecycle, renderer lifetime, explicit Shutdown PRMonitor, and
validated IPC. F09 remains diagnostic only.

F10-F12 remain authoritative for remote observation, polling resources,
eligibility, handled event versions, holds, batching, pause, deadlines, and
automatic-dispatch gates. F13-F14 remain authoritative for actual worktree/Git
state, attribution, validation processes, and validation truth. F15-F17 remain
authoritative for provider invocation, policy, turn accounting, budgets,
timeouts, progress, reports, and explicit AI continuation. F18-F23 remain
authoritative for Review Bundles, stale/dirty choices, approval, response
effects, hold release, and Review Bundle publication. F24-F27 remain
authoritative for synchronization identity, merge/conflict evidence, result
review, stale handling, and synchronization publication.

F28 does not create a competing state machine. It does not infer success from
activity text, provider prose, renderer memory, a missing acknowledgement, or
an old label. It does not invoke AI, reset or replace worktrees, run arbitrary
commands, post GitHub responses, commit, push, merge, force-push, or release a
hold directly.

## Recovery Contract

The implementation should expose one provider-neutral contract conceptually
equivalent to:

```ts
interface RecoveryCoordinator {
  request(request: RecoveryRequest): Promise<RecoverySessionResult>;
  read(scope?: RecoveryScope): Promise<RecoveryProjection>;
}

interface RecoveryRequest {
  trigger: "startup" | "wake" | "online" | "explicit" | "renderer_replaced";
  scope?: RecoveryScope;
  expectedRevision?: string;
  requestId: string;
}

interface RecoveryScope {
  kind: "application" | "managed_pr" | "review_bundle" | "ai_operation" | "sync_operation" | "publication";
  id: string;
}
```

The final types must use the repository's shared domain contracts rather than
copying these illustrative strings. Every session and attempt must carry the
owner, feature operation, repository/ref identity when applicable, worktree or
effect identity when applicable, expected revision, correlation identity,
trigger, and bounded evidence references.

Recovery ordering is deterministic:

```text
open database and create session
        |
        v
load lifecycle / shutdown / global pause
        |
        v
reconcile polling, deadlines, batches, holds, and retained versions
        |
        v
inspect worktrees, Git state, and interrupted validation
        |
        v
reconcile AI operations without starting a new turn
        |
        v
reconcile Review Bundle publication effects
        |
        v
reconcile synchronization publication effects
        |
        v
commit projection, activity, and next retry times
        |
        v
resume only owner-approved deterministic work
```

An explicit Shutdown PRMonitor is different from an abrupt stop: owners receive
the shutdown signal and finalize safe cancellation/interruption records, while
the next startup still reconciles any effect whose boundary may have been
crossed. Renderer closure is not shutdown.

## Readiness Gates

- F03 can persist recovery sessions/attempts and return the committed outcome after a fault injected before or after each transaction boundary.
- F04 can distinguish renderer destruction, explicit Shutdown PRMonitor, orderly lifecycle stop, abrupt restart, and sleep/wake, and can deliver those signals to the main process without making the renderer authoritative.
- F02 can reject an illegal recovered transition and return a structured reason without requiring F28 to invent a state.
- F10/F12 can return idempotent poll, batch, pause, deadline, and dispatch outcomes with exact managed-PR and version identities.
- F11 can preserve handled and retained event-version associations and can release a hold only through an owner-approved terminal outcome.
- F13 can return canonical path, ownership, Git identity, current HEAD, baseline, diff, attribution, overlap, and safe-action evidence; F14 can finalize interrupted validation without rerunning it.
- F15-F17 can return provider-neutral invocation state, usage, reports, stop reasons, budget, and policy/profile snapshots; explicit continuation/retry is separately authorized.
- F23 and F27 can classify local commit, remote push, response, no-code, stale, unknown, and terminal outcomes using their original publication identities.
- F19/F20/F27 can consume a versioned recovery projection and route deep links/actions without obtaining recovery or publication authority from the renderer.
- The test harness can inject process stops before/after durable commits and external effects, network loss, online recovery, sleep/wake, clock jumps, missing worktrees, renderer absence, duplicate triggers, and sibling operations.

## Proposed Vertical Slices

1. **Durable recovery session, scope lock, and ordered startup scan**
   - **Blocked by:** F02-F04, F09, F03 recovery repositories, and the lifecycle fault-injection harness.
   - **Stories / requirements / acceptance criteria:** US-01-US-03, US-10; FR-01.1-FR-01.7, FR-07.1-FR-07.2; NFR-01-NFR-05, NFR-09; INV-01-INV-04, INV-09-INV-12; AC-01-AC-02, AC-17, AC-19-AC-21; CT-F28-01, CT-F28-03, CT-F28-10.
   - **Implementation:** Add the recovery-session and attempt records, trigger coalescing, scope locks, expected-revision checks, deterministic scan ordering, bounded evidence references, and main-process recovery read model. Record explicit shutdown distinctly from abrupt restart and make renderer replacement a no-op for owner lifetime.
   - **Visible result:** On startup or renderer recreation, the main process exposes one recovery summary with the trigger, scopes scanned, adopted/blocked/attention counts, and next actions before normal work is scheduled.
   - **Durable records / external effects:** Persists session/attempt identity, lifecycle snapshot, scope/revision, stage, classification, reason, evidence references, retry time, and terminal/partial status. No AI, GitHub mutation, Git mutation, validation process, response, commit, push, or publication effect.
   - **Failure / cancellation / restart:** Database failure before session commit creates no false recovery success. A duplicate trigger joins the existing session. A scan failure preserves completed attempts and resumes from the next durable stage; it never rewrites history or releases a hold.
   - **Exact evidence:** Startup ordering trace; renderer-close versus explicit-shutdown matrix; duplicate trigger/scope race; persist-before-scan fault injection; expected-revision conflict; partial scan restart; 0/1/50/250-scope bounds; bounded/redacted projection scan; CT-F28-01, CT-F28-03, CT-F28-10.
   - **Exit criterion:** AC-01-AC-02, AC-17, AC-19-AC-21 pass and every later slice has one durable recovery-session and scope contract.

2. **Polling, deadlines, holds, batches, and retained feedback**
   - **Blocked by:** Slice 1; F10/F11/F12 typed contracts; scheduler and temporary-database fixtures.
   - **Stories / requirements / acceptance criteria:** US-01-US-04, US-11; FR-02.1-FR-02.7, FR-05.3-FR-05.5; NFR-01-NFR-06; INV-01, INV-04, INV-08; AC-03-AC-07, AC-12-AC-14, AC-17; CT-F28-02, CT-F28-09.
   - **Implementation:** Build the scheduler recovery adapter. Restore independent resource checkpoints, polling/retry deadlines, quiet-period deadlines, exact batch membership, pause, holds, dispatch identities, and retained event versions. Recheck gates before handing a recovered batch to F18 and use F10/F12/F11 idempotency rather than a second claim system.
   - **Visible result:** After restart or wake, a managed-PR projection shows the same held/paused/ready/deferred state, the next poll/batch time, retained feedback count, and a bounded retry reason; no duplicate batch or automatic AI handoff appears.
   - **Durable records / external effects:** Updates scheduler recovery attempts, F10/F12 request identities, F11 claim/hold references, exact version sets, and F09 activity. Read-only F10 calls may occur; no AI, worktree, validation, GitHub mutation, commit, push, merge, or publication effect.
   - **Failure / cancellation / restart:** A failed poll keeps its checkpoint and unhandled versions. An expired batch remains deferred when paused/held. A lost dispatch acknowledgement reconciles the batch/claim/operation identity before retry. A duplicate version never restarts a committed timer or creates a second membership.
   - **Exact evidence:** Per-resource 304/error/retry matrix; due-before/during-sleep fixture; pause/hold/ready gate table; handled/retained version corpus; duplicate poll/claim race; network-loss/backoff trace; no-AI/no-mutation capability scan; CT-F28-02, CT-F28-09.
   - **Exit criterion:** AC-03-AC-07, AC-12-AC-14, and AC-17 pass; polling and feedback history remain correct through renderer absence, restart, sleep, and offline recovery.

3. **Operation-owned worktree and interrupted validation reconciliation**
   - **Blocked by:** Slice 1; F13 `WorktreeCondition`/ownership contract; F14 validation interruption contract; F20/F22/F27 action gates.
   - **Stories / requirements / acceptance criteria:** US-03, US-07, US-10; FR-03.1-FR-03.6, FR-07.1-FR-07.2; NFR-02, NFR-04-NFR-09; INV-01, INV-05, INV-10-INV-12; AC-09, AC-11-AC-14, AC-19-AC-21; CT-F28-04, CT-F28-05.
   - **Implementation:** Add the local-work adapter that refreshes F13 identity/condition evidence and invokes F14's startup interruption finalization. Preserve dirty/manual/overlap evidence. Map missing, moved, cross-owned, stale, and unknown worktrees to owner-specific attention results and permitted inspect/manual-repair/re-evaluate/discard actions.
   - **Visible result:** A recovered operation shows the exact operation/worktree identity, current condition, preserved diff/validation history, and a clear blocking reason when the path or Git state cannot be proven safe.
   - **Durable records / external effects:** Persists fresh condition references, local-recovery attempt/classification, interrupted validation result, preserved snapshots, and next action. No automatic clear, reset, replacement, cleanup, AI invocation, remote effect, or publication.
   - **Failure / cancellation / restart:** Missing or mismatched paths never fall back to the developer clone. A dirty or overlapping path remains available. A process stop during inspection leaves the prior evidence and retries inspection with the same identity; it never guesses the post-stop state.
   - **Exact evidence:** Clean/dirty/staged/untracked/ignored/overlap/path-loss/cross-owner corpus; developer-clone before/after hashes; running validation -> interrupted/not-run matrix; no-reset/no-delete/no-fallback spies; renderer replacement readback; CT-F28-04, CT-F28-05.
   - **Exit criterion:** AC-09, AC-11-AC-14, AC-19, and AC-21 pass; no recovery path can overwrite user work or convert interrupted validation into a pass.

4. **AI operation, turn budget, and explicit continuation recovery**
   - **Blocked by:** Slice 3; F15-F17 provider-neutral lifecycle, budget, progress, report, profile, and policy contracts; F18/F26 continuation consumers.
   - **Stories / requirements / acceptance criteria:** US-03, US-05-US-06; FR-04.1-FR-04.7, FR-07.1-FR-07.2; NFR-01-NFR-05, NFR-07-NFR-09; INV-03, INV-07, INV-10; AC-08-AC-10, AC-16, AC-20-AC-21; CT-F28-06.
   - **Implementation:** Add the AI recovery adapter. Load parent/segment/turn status, conservatively account for an invocation intent whose outcome is unknown, inspect actual worktree/Git/validation evidence, and finish only deterministic inspection when the completion predicate is provably satisfied. Route all continuation/retry/new-operation actions through F17 with the original scope and complete prior history.
   - **Visible result:** A stopped Review Bundle or conflict result shows complete turn reports, usage, budget, profile/policy snapshot, worktree condition, stop reason, and one explicit continuation/retry path; reopening never silently starts AI.
   - **Durable records / external effects:** Persists AI recovery attempt, classification, deterministic observation, F17 report/stop handoff, authorization revision, and any new segment intent. No provider call occurs during automatic recovery of an uncertain turn.
   - **Failure / cancellation / restart:** Provider timeout, process stop, partial stream, network loss, and unknown result all preserve the worktree and budget. Duplicate explicit actions return the existing segment. A stale or broadened authorization is rejected before provider invocation.
   - **Exact evidence:** Provider started/not-started/unknown matrix; read-only proposal versus mutating turn; budget monotonicity across restart; deterministic completion/no-code case; repeated explicit-action race; provider SDK/credential/publication capability scan; keyboard/screen-reader stop-report evidence; CT-F28-06.
   - **Exit criterion:** AC-08-AC-10, AC-16, and AC-20 pass; restart, sleep, network, and renderer loss cannot auto-authorize or duplicate AI work.

5. **Sleep, offline/online state, and bounded retry policy**
   - **Blocked by:** Slices 1-4; F04 lifecycle signals; F10/F12/F06/F23/F27 typed transient/unknown outcomes; injected wall and monotonic clocks.
   - **Stories / requirements / acceptance criteria:** US-01-US-02, US-07-US-11; FR-05.1-FR-05.6, FR-01.2, FR-07.1-FR-07.4; NFR-01-NFR-06, NFR-09; INV-01, INV-04, INV-06, INV-08; AC-04, AC-12-AC-14, AC-19-AC-21; CT-F28-01, CT-F28-02, CT-F28-09.
   - **Implementation:** Add coalesced wake/online triggers, an offline/retrying projection, persisted capped backoff/attempt state, wall-clock-jump handling, and owner-specific retry admission. Keep read-only polling and deterministic recovery separate from AI/effect retries.
   - **Visible result:** Sleep/wake or offline/online transitions produce one bounded recovery pass and a truthful next-attempt time. The app does not catch up every missed timer at once, lose retained feedback, or report an unknown effect as failed/successful without evidence.
   - **Durable records / external effects:** Persists connectivity trigger, attempt count, next-attempt time, owner classification, and recovery projection; only owner-approved calls occur after the intent is durable.
   - **Failure / cancellation / restart:** Duplicate signals coalesce. Backoff is capped. Permanent/auth/stale errors stop retry and provide remediation. Cancellation preserves the intent and does not release holds. Restart continues from the persisted attempt count, not zero.
   - **Exact evidence:** Wall-clock forward/backward jump; long sleep; offline storm; online storm; per-scope backoff; rate-limit/auth/stale/unknown matrix; no catch-up storm; persisted retry readback; CT-F28-01, CT-F28-02, CT-F28-09.
   - **Exit criterion:** AC-04, AC-12-AC-14, and AC-19-AC-21 pass with bounded, explainable lifecycle/network recovery.

6. **Review Bundle publication reconciliation**
   - **Blocked by:** Slices 1-5; F23 approval/effect/reconciliation contracts; F06 exact response reads; F13 local commit evidence; F19/F20 Review Bundle read model.
   - **Stories / requirements / acceptance criteria:** US-08-US-10; FR-06.1-FR-06.6, FR-07.1-FR-07.4; NFR-02-NFR-05, NFR-07-NFR-09; INV-02, INV-04, INV-06, INV-09; AC-15, AC-17-AC-20; CT-F28-07, CT-F28-08, CT-F28-10.
   - **Implementation:** Add the F23 adapter that loads the original approval, publication phase, stable keys, candidate/tree/target/expected-SHA snapshots, local commit SHA, and per-response identities. Delegate exact local/remote reconciliation to F23/F06/F13 and persist adopt/safe-retry/unknown outcomes before terminal/hold handoff.
   - **Visible result:** A Review Bundle reopened after a lost commit/push/response acknowledgement shows exact known effects and response states. A code-success/response-failure case is visibly `PUBLISHED_WITH_ERRORS` with response-only recovery and no code-republish action.
   - **Durable records / external effects:** Persists F28 attempt/evidence references and consumes F23 publication/effect/response records. A matching effect may be adopted; a safe existing intent may retry through F23. F28 never calls GitHub mutation itself.
   - **Failure / cancellation / restart:** Remote ref equal to the recorded commit is adopted; expected old ref may retry the same non-force push; divergence/unknown blocks. Unique matching responses are adopted; absent/multiple matches remain unknown. Hold release occurs only after F23 commits the legal terminal outcome.
   - **Exact evidence:** Crash/network-loss before/after local commit, push, response request, and terminal handoff; expected-old/matching/divergent/deleted ref matrix; unique/no/multiple response matching; PUBLISHED_WITH_ERRORS no-republish guard; hold ordering; CT-F28-07, CT-F28-08.
   - **Exit criterion:** AC-15, AC-17-AC-20 pass; Review Bundle publication is restart/network-safe and no response retry can duplicate or republish code.

7. **Synchronization result and merge-publication reconciliation**
   - **Blocked by:** Slice 6; F24-F27 synchronization operation/result/publication contracts; F13 merge evidence; F06 exact source/head/ref reads; F22 stale-work handoff.
   - **Stories / requirements / acceptance criteria:** US-08-US-10; FR-03.1-FR-03.6, FR-06.1-FR-06.8, FR-07.1-FR-07.4; NFR-02-NFR-06, NFR-07-NFR-09; INV-05-INV-06, INV-09-INV-11; AC-11, AC-14-AC-19; CT-F28-04, CT-F28-07, CT-F28-08.
   - **Implementation:** Add the F27 adapter for independent synchronization results. Reconcile operation-owned merge commits, exact source/head identities, expected old head, no-op state, publication lock/phase, known remote commit, and successful-head invalidation. Keep each PR/result scope independent and preserve ambiguous worktrees/results.
   - **Visible result:** A synchronization result survives restart and shows ready, stale, attention, published, no-op, or unknown evidence with exact branches/SHAs and a safe action. A sibling result remains unchanged when another PR is offline or uncertain.
   - **Durable records / external effects:** Persists F28 attempts and consumes F27 publication/effect records; only F27 may create/adopt a merge publication effect or emit the F22 invalidation. No force option or batch-wide recovery effect exists.
   - **Failure / cancellation / restart:** Matching local/remote merge effects are adopted; expected old head is the only safe retry case; source/head movement or ambiguity remains stale/unknown. Missing worktrees block. A successful sibling is not rolled back because another result fails.
   - **Exact evidence:** Clean/no-op/changed merge matrix; local commit adoption; expected-old/matching/divergent/non-force push; source/head movement; missing/dirty worktree; per-PR failure isolation; historical Review Bundle invalidation after proven head advance; CT-F28-04, CT-F28-07, CT-F28-08.
   - **Exit criterion:** AC-11, AC-14-AC-19 pass; APP-AC-49 and APP-AC-53 have direct restart/uncertain-outcome evidence for synchronization.

8. **Cross-feature recovery projection, accessibility, security, and release conformance**
   - **Blocked by:** Slices 1-7; F19/F20/F27 presentation contracts; F29 security checks; F30 packaged Windows harness; repository check and both semantic linters.
   - **Stories / requirements / acceptance criteria:** US-01-US-11; all FRs, NFRs, and INVs; APP-AC-04, APP-AC-16-APP-AC-17, APP-AC-24-APP-AC-25, APP-AC-49, APP-AC-53-APP-AC-55, APP-AC-57-APP-AC-58, APP-AC-68; AC-01-AC-21; CT-F28-01-CT-F28-10.
   - **Implementation:** Run complete mixed workflows for renderer closure, abrupt restart, sleep, offline/online recovery, held feedback, interrupted validation, stopped AI, missing worktree, Review Bundle publication uncertainty, synchronization publication uncertainty, sibling isolation, and explicit recovery actions. Verify projections and deep links, no-capability boundaries, redaction, bounded retry, and accessibility handoff.
   - **Visible result:** One recovery center/read model lets the developer understand and act on every recoverable or attention-required case without reopening a hidden window or guessing whether an external effect happened.
   - **Durable records / external effects:** Uses test-owned SQLite, temporary Git repositories/worktrees, fake F10/F11/F12/F13/F14/F15/F17/F23/F27 ports, bounded F09 evidence, and linter reports. It does not use live credentials, contact GitHub, invoke live AI, edit `checklist.md`, or publish branches/comments.
   - **Failure / cancellation / restart:** Any lost feedback, reset budget, duplicate effect, false success, hold release, path fallback, force option, secret leak, cross-scope mutation, inaccessible control, invalid mapping, or definite linter miss blocks the gate. A cancelled run leaves no success marker and is rerunnable from fresh fixtures.
   - **Exact evidence:** `npm run check`; CT-F28-01 through CT-F28-10; full restart-at-every-boundary report; sleep/wake/offline/online and wall-clock report; scheduler/hold/retained-version report; AI budget/report/explicit-action report; worktree/validation report; Review Bundle and synchronization effect reconciliation report; no-duplicate/no-force/no-blind-repost scan; keyboard/screen-reader/forced-colors/reduced-motion/zoom/narrow-width evidence; capability/credential/redaction scan; `git diff --check`; `npm run lint:prd-plan -- Specs/restart_sleep_network_loss_and_uncertain_outcome_recovery_PRD.md Specs/restart_sleep_network_loss_and_uncertain_outcome_recovery_PLAN.md`; `npm run lint:application-coverage -- Specs/application_overview.md Specs/restart_sleep_network_loss_and_uncertain_outcome_recovery_PRD.md`.
   - **Exit criterion:** All F28 requirements have direct or named contract evidence, mapped application criteria have no definite missing/invalid result, both specification linters pass without definite missing/invalid results, and PD-01 through PD-06 are confirmed before implementation.

## Cross-Slice Verification and Handoff

- F02 remains the only owner of legal primary/overlay states, structured
  reasons, transition rules, and hold-compatible outcomes. F28 never creates a
  recovery-specific competing state machine.
- F03 remains the only owner of migrations, transactions, uniqueness,
  expected revisions, durable effect history, and committed-versus-unknown
  persistence outcomes. F28 never treats an in-memory lock or activity entry
  as authoritative.
- F04 remains the only owner of Electron main-process lifetime, renderer
  destruction/recreation, explicit Shutdown PRMonitor, lifecycle signals, and
  validated IPC. Renderer closure is not cancellation or shutdown.
- F09 remains the only owner of diagnostic storage/retention. F28 emits
  bounded activity but never reconstructs state from prose or logs.
- F10-F12 remain the owners of polling resources, immutable observations,
  eligibility, holds, batching, pause, deadlines, claims, and automatic-review
  dispatch. F28 restores their durable inputs and calls their idempotent ports.
- F13-F14 remain the owners of actual Git/worktree condition, attribution,
  path safety, process/validation evidence, and no-pass-without-exit-status.
  F28 never clears, replaces, or reruns their work on its own.
- F15-F17 remain the owners of provider invocation, policy, profiles, budgets,
  reports, progress, timeouts, and explicit continuation. F28 never retries an
  uncertain AI turn automatically or grants publication authority.
- F18-F23 remain the owners of Review Bundle preparation, revision, stale and
  dirty choices, approval, response effects, publication, and hold release.
  F28 supplies recovery evidence and consumes their typed outcomes.
- F24-F27 remain the owners of synchronization source/head identity, merge and
  conflict evidence, result review, stale handling, merge publication, and
  head-advance invalidation. F28 keeps each operation/result independent.
- F29/F30 own full security, packaging, end-to-end, and clean-machine release
  gates. F28 contributes the fault-injection and lifecycle evidence.
- The exact owning PRD is
  `Specs/restart_sleep_network_loss_and_uncertain_outcome_recovery_PRD.md`.
  These documents create no application code, do not change `checklist.md`,
  and do not claim that recovery, polling, AI work, validation, or publication
  is implemented.

## Requirement-to-Slice Trace

| Requirement family | Owning slices |
|---|---|
| FR-01 | 1, 5, 8 |
| FR-02 | 2, 5, 8 |
| FR-03 | 3, 7, 8 |
| FR-04 | 4, 8 |
| FR-05 | 2, 5, 8 |
| FR-06 | 6-8 |
| FR-07 | 1, 4, 6-8 |
| FR-08 | 1, 3, 6-8 |
| NFR-01-NFR-09 | 1-8 |
| INV-01-INV-12 | 1-8 |
| APP-AC-04, APP-AC-16-APP-AC-17 | 1-5, 8 |
| APP-AC-24-APP-AC-25 | 2, 6, 8 |
| APP-AC-49, APP-AC-53 | 6-8 |
| APP-AC-54-APP-AC-55, APP-AC-57-APP-AC-58 | 4, 8 |
| APP-AC-68 | 6-8 |

