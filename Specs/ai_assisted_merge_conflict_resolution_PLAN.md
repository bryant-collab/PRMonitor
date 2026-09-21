<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single layer. The goal of vertical layers is to provide the AI and the user with a visible and testable result when the work is complete. This improves the reliability of AI's output by providing rapid feedback.
Note that while we're mentioning Stories here, we're not actually using tickets, this is just a convenient way of identifying slices within a plan.
There might be slices that are needed to describe work that doesn't extend through all levels, that's fine, but the preference should be towards vertical slices since this will result in the best quality output.
-->

# Plan: AI-assisted merge-conflict resolution

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** `ai_assisted_merge_conflict_resolution_PRD.md`
>
> **Last revalidated against:** application overview revision 2026-09-21; F26 PRD revision 2026-09-21
>
> **Entry/readiness gates:** F02 synchronization state/reason contracts, F03 persistence, F13 operation-owned worktrees and merge-base/diff evidence, F14 deterministic validation, F15-F17 provider/profile/policy/bounded-work contracts, and F25 actual conflict detection are available. F26 remains unchecked until all slices and evidence pass.
>
> This PLAN cannot change product requirements. Resolve contradictions in the owning PRD before implementation. Revalidate this draft when implementation begins and remove or archive it when the work is complete.

## Implementation Boundary

F26 owns the conflict-specific context assembly, AI task invocation, intent-preserving semantic assessment, ambiguity/user-consultation records, deterministic completion guard, and synchronization-result evidence handoff. F25 owns detecting whether Git conflicts; F02 owns synchronization states and legal transitions; F03 owns durable repositories; F13-F14 own worktree/diff/validation primitives; F15-F17 own provider adapters, profiles, policies, and bounded work; F27 owns the result UI and publication workflow.

The implementation must not add a second primary PR state machine, execute AI for clean merges, allow provider publication effects, infer success from conflict-marker removal, or silently resolve an ambiguous conflict.

## Readiness Gates

- The synchronization worktree records source/head repositories and branches, `syncSourceSha`, `prHeadSha`, and `syncMergeBaseSha` before merge attempts.
- Deterministic Git inspection can produce source-side and PR-head-side diffs, conflicted paths/hunks, relevant commit metadata, and actual unmerged-path state.
- F15-F17 expose a Merge Conflict Resolution task profile, immutable execution-policy snapshot, bounded work controller, turn report, usage, timeout, progress, and stop-reason contracts.
- F00/F14 expose phase-aware validation and deterministic `passed`, `failed`, `not_run`, and `interrupted` evidence without model override.
- F03 can persist operation inputs, conflict assessments, user questions/directions, worktree identity, turn evidence, and idempotency references transactionally.

## Proposed Vertical Slices

### 1. Conflict context and evidence contract

- **Blocked by:** F02, F03, F13, F25.
- **Stories / requirements / acceptance criteria:** US-01; FR-01.1-FR-01.3; FR-06.1-FR-06.2; AC-01, AC-02, AC-06.
- **Implementation:** Define the provider-neutral conflict context and evidence schemas. Capture source/head repositories and branches, source/head/merge-base SHAs, per-side diffs, conflicted hunks, commit metadata, PR Intent / Context, source-branch intent context, Common Instructions, Build & Validation Instructions, and missing-context markers. Add size limits and redaction rules.
- **Visible result:** The synchronization result shows exactly what each branch changed, the merge base, conflict locations, and which intent sources were available before AI work begins.
- **Durable records / external effects:** Adds versioned conflict-context and evidence snapshots linked to the synchronization operation; no external side effect.
- **Failure / cancellation / restart:** Missing context is represented explicitly; oversized or invalid evidence fails closed with a reason; restart reuses the persisted snapshot rather than re-reading mutable refs.
- **Exact evidence:** Schema fixtures; merge-base/per-side diff fixtures; missing-context and size-limit tests; secret scan; restart snapshot test.
- **Exit criterion:** AC-01, AC-02, and AC-06 have deterministic contract evidence.

### 2. Intent-preserving conflict-resolution task

- **Blocked by:** Slice 1, F15-F17.
- **Stories / requirements / acceptance criteria:** US-02; FR-02; FR-03; FR-07; AC-03.
- **Implementation:** Add the Merge Conflict Resolution task request/normalized result contract and provider prompt/context adapter. Require structured both-side intent analysis, proposed resolution scope, uncertainty, remaining issues, and changed-file attribution. Route the task through the configured profile/policy with no GitHub publication credentials.
- **Visible result:** A running synchronization result identifies the provider task/profile and shows its bounded progress and both-side resolution analysis.
- **Durable records / external effects:** Adds provider-neutral task/turn snapshots and usage; AI may edit only the operation-owned synchronization worktree.
- **Failure / cancellation / restart:** Provider failure, timeout, policy stop, repeated state, or cancellation preserves the worktree and turns and becomes actionable `NEEDS_ATTENTION`; no automatic retry resets budget.
- **Exact evidence:** Fake-provider contract tests; request inspection proving both-side context; policy-denial test; timeout/cancellation/restart tests; provider credential absence test.
- **Exit criterion:** AC-03, AC-05, and AC-07 are satisfied without allowing publication effects.

### 3. Deterministic completion and ambiguity guard

- **Blocked by:** Slices 1-2, F13-F14, F25.
- **Stories / requirements / acceptance criteria:** US-02-US-03; FR-02.1-FR-02.4; FR-04; FR-05.1-FR-05.2; AC-04-AC-06.
- **Implementation:** Implement the pure completion reducer/guard. It must combine structured AI assessment with actual Git index/worktree state, conflict-marker inspection, attributable-change inspection, exact merge state, and validation evidence. Add explicit ambiguity reasons and block `READY_TO_PUBLISH` for unresolved questions, stale SHAs, failed checks, or incomplete evidence.
- **Visible result:** A semantically resolved conflict becomes `READY_TO_PUBLISH` only after deterministic checks; an ambiguous conflict becomes `NEEDS_ATTENTION` with affected hunks, competing-intent summary, uncertainty, and next action.
- **Durable records / external effects:** Persists completion decision, deterministic evidence, reason, and state transition; no publication side effect.
- **Failure / cancellation / restart:** Provider prose cannot bypass the guard; unknown or partial state remains attention-required and is recoverable.
- **Exact evidence:** Reducer truth tables; resolvable/ambiguous/marker-residue/failed-validation fixtures; no-provider-claim completion test; stale-state rejection test.
- **Exit criterion:** AC-04-AC-06 and INV-01-INV-04 pass with deterministic tests.

### 4. User consultation and recovery

- **Blocked by:** Slice 3, F03, F19-F20 foundations, and F27 result-review contracts.
- **Stories / requirements / acceptance criteria:** US-04-US-05; FR-05.2-FR-06; FR-08; AC-05, AC-06, AC-07, AC-08.
- **Implementation:** Persist consultation records for ambiguity, required question, available directions, user answer, manual-edit acknowledgement, retry, re-evaluation, and discard. Expose the result data and notification reason needed by F27; preserve all prior turn reports, usage, worktree state, and SHAs.
- **Visible result:** The developer is alerted when the resolver cannot safely decide, sees the competing intents and question, and can answer/direct, edit, retry, re-evaluate, or discard. Publication controls remain disabled until a new valid result exists.
- **Durable records / external effects:** Adds append-only consultation/action records and links them to synchronization result and operation; notification is an application effect, not publication.
- **Failure / cancellation / restart:** UI closure and restart do not clear the question or worktree; repeated actions are idempotent; manual edits are never silently overwritten.
- **Exact evidence:** Accessibility review; notification/deep-link fixture; answer/retry/discard state tests; crash/restart after ambiguity; repeated-action/idempotency tests.
- **Exit criterion:** AC-05-AC-08 and NFR-02/NFR-05 have evidence ready for F27 integration.

### 5. End-to-end synchronization fixture

- **Blocked by:** Slices 1-4, F24-F25, and F27 publication gates.
- **Stories / requirements / acceptance criteria:** US-01-US-05; AC-01-AC-08; APP-AC-48, APP-AC-76, APP-AC-77.
- **Implementation:** Wire clean, resolvable-conflict, ambiguous-conflict, manual-edit, stale-source/head, validation-failure, retry, restart, and uncertain-outcome fixtures through the real synchronization orchestration boundary. Keep each selected PR isolated so one result can need attention while others complete.
- **Visible result:** A clean merge uses zero AI; a compatible conflict produces an inspectable ready-to-publish result; an ambiguous conflict produces a clear attention result and user consultation before any publication path.
- **Durable records / external effects:** Persists complete per-PR synchronization evidence; external pushes remain behind F27's explicit approval and reconciliation contract.
- **Failure / cancellation / restart:** Fault injection demonstrates no lost evidence, reset budget, duplicate merge, duplicate push, or bypassed consultation.
- **Exact evidence:** End-to-end Git fixture matrix; provider fake transcript; SQLite restart/recovery evidence; UI/reason/accessibility review; publication-gate assertions.
- **Exit criterion:** APP-AC-48, APP-AC-76, and APP-AC-77 pass and F26 remains unchecked until F27 confirms the presentation/publication handoff.
