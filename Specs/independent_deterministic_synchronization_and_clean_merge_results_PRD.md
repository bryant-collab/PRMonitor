# F25 Independent Deterministic Synchronization and Clean-Merge Results - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F02 - Domain contracts and deterministic state machines | Provides the provider-neutral synchronization status overlay, structured reason data, per-result isolation rules, and legal transitions. |
| 2 | F03 - SQLite persistence, migrations, and transactional repositories | Provides durable batch/operation/result records, commit-before-effect transactions, uniqueness, and restart-safe history. |
| 3 | F12 - Review batching, scheduler, Check Now, and global pause | Provides the main-process operation scheduling and renderer-independent lifecycle conventions; F25 remains an explicitly user-started workflow, not an automatic review dispatch. |
| 4 | F13 - Operation-owned Git worktrees and change attribution | Provides source materialization, independent synchronization worktrees, exact Git state, merge-base/change evidence, ownership, and dirty-worktree protection. |
| 5 | F14 - Deterministic validation runner and result model | Provides phase-aware validation execution, real exit-status evidence, bounded output, and explicit `passed`, `failed`, `not_run`, and `interrupted` results. |
| 6 | F24 - Synchronization selection, source resolution, and confirmation | Provides the committed preparation-only authorization, eligible PR set, explicit repositories/branches, exact `syncSourceSha`/`prHeadSha`, and immutable configuration snapshot. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F26 - AI-assisted merge-conflict resolution | Consumes F25's actual conflict evidence and isolated synchronization worktree only when deterministic Git reports a real conflict. |
| 2 | F27 - Synchronization result review, staleness, and publication | Presents F25 results, owns explicit review/discard/re-evaluation decisions, stale checks, merge publication, and non-force push. |
| 3 | F28 - Restart, sleep, network-loss, and uncertain-outcome recovery | Extends F25's durable local reconciliation into cross-feature lifecycle recovery. |
| 4 | F29-F30 - Security and trust-boundary hardening; Windows packaging and release readiness | Audits the Git/worktree boundary and verifies the complete synchronization workflow on supported Windows environments. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-13 | FR-04.1-FR-04.6, INV-06, INV-08 | AC-11-AC-14, AC-17 | Shared: F14 owns command execution and exit-status truth; F25 invokes the shared post-change contract and persists its result. |
| APP-AC-17 | FR-01.1-FR-01.7, FR-06.1-FR-06.6, NFR-03, INV-03, INV-10 | AC-01, AC-16-AC-18 | Shared: F04/F28 own process lifetime; F25 makes batch/result intent durable and keeps it recoverable without a renderer. |
| APP-AC-37 | FR-02.1-FR-02.4, INV-01 | AC-03-AC-05 | Shared: F13 owns the configurable root and canonical operation path; F25 supplies the synchronization operation identity and consumes the resolved path. |
| APP-AC-39 | FR-02.3-FR-02.4, FR-03.1-FR-03.8, FR-06.3, INV-01, INV-07 | AC-04-AC-08, AC-17-AC-18 | Shared: F13 owns dirty-worktree truth and no-guessing preservation; F25 refuses to merge from an unsafe state and records the resulting attention reason. |
| APP-AC-44 | FR-02.1-FR-02.7, INV-02 | AC-02-AC-04 | Shared: F24 owns source selection and confirmation; F25 consumes and preserves the explicit source/destination identities without substituting a default branch. |
| APP-AC-45 | FR-01.1-FR-01.7, FR-02.1-FR-02.7 | AC-01-AC-04 | Shared: F24 owns the pre-start summary; F25 accepts only its committed exact-SHA authorization and records the same snapshot in every result. |
| APP-AC-46 | FR-01.1-FR-01.8, FR-02.2-FR-02.4, FR-06.1-FR-06.6, INV-04 | AC-05-AC-06, AC-16-AC-18 | Primary: F25 owns one independent operation/result per eligible PR and sibling-failure isolation. |
| APP-AC-47 | FR-03.1-FR-03.6, INV-05-INV-06 | AC-07-AC-09, AC-14 | Primary: F25 owns the deterministic no-commit clean/no-op path and the zero-AI guarantee. |
| APP-AC-48 | FR-03.4-FR-03.8, FR-05.5-FR-05.7, INV-05-INV-06 | AC-10-AC-13, AC-17 | Shared: F25 owns actual conflict detection and complete conflict evidence; F26 owns semantic resolution and F27 owns review/publication gating. |
| APP-AC-49 | FR-04.1-FR-05.8, FR-06.1-FR-06.8, INV-03, INV-08, INV-12 | AC-11-AC-18 | Primary for synchronization-result truth, snapshots, evidence, and reason data; F27 owns the complete review surface and publication outcome. |
| APP-AC-53 | FR-01.6-FR-01.8, FR-06.1-FR-06.6, NFR-03, INV-03, INV-10 | AC-05, AC-16-AC-18 | Shared: F25 owns idempotent batch/operation/merge preparation; F27 owns publication idempotency and F28 owns cross-feature reconciliation. |
| APP-AC-62 | FR-05.5, FR-06.7, INV-05, INV-12 | AC-14, AC-17 | Shared: F25 records that clean/no-op paths used no AI; F26/F27 own provider metadata and presentation when conflict resolution uses AI. |
| APP-AC-73 | FR-04.1-FR-04.6, INV-08 | AC-11-AC-14 | Shared: F14 owns validation truth; F25 owns when clean/no-op synchronization results consume the post-change validation contract and how the result gates readiness. |
| APP-AC-74 | FR-04.1-FR-04.3, FR-04.6, INV-08 | AC-11-AC-13 | Shared: F00/F16/F14 own trusted command configuration; F25 preserves the effective validation snapshot and never turns free-form instructions into authority. |
| APP-AC-75 | FR-05.1-FR-05.8, INV-12 | AC-15-AC-18 | Shared: F25 persists deterministic what/why/next-action reason data; F27 owns the accessible final presentation and user actions. |
| APP-AC-76 | FR-03.4-FR-03.8, FR-05.5-FR-05.7, INV-05-INV-08 | AC-10-AC-12, AC-17 | Shared: F25 supplies exact source/head/merge-base, both-side change, conflict, and preserved-worktree evidence; F26 owns semantic intent preservation and F27 owns review/publication gating. |
| APP-AC-77 | FR-03.4-FR-03.8, FR-04.4-FR-04.8, FR-05.2-FR-05.7, FR-06.2-FR-06.4, INV-07-INV-12 | AC-10-AC-13, AC-15, AC-17-AC-18 | Shared: F25 preserves the conflicted worktree and prior evidence and produces a non-ready structured handoff; F26 owns competing-intent/user-question analysis and F27 owns the publication block until a newly inspected and validated resolution exists. |

### Explicit coverage boundaries

F25 owns the deterministic execution of a confirmed synchronization batch after
F24. It creates or adopts one operation-owned synchronization worktree per
eligible PR, materializes the exact recorded source and head commits, computes
the exact merge base and both-side change evidence, performs an explicit
no-commit merge, distinguishes clean, no-op, conflict, and failure outcomes,
requests post-change validation, and persists an independently reviewable result
with structured reasons and next actions.

F13 remains authoritative for actual Git/worktree state, ownership, canonical
paths, merge-base computation, change manifests, and dirty-worktree safety. F14
remains authoritative for command execution and validation truth. F24 remains
authoritative for selection, source precedence, repository identity, exact SHA
observation, and preparation-only authorization. F25 never silently refreshes
those inputs from a default branch or a same-named ref.

F25 detects and records a real conflict and emits the typed handoff consumed by
F26. It does not ask an AI provider to resolve the conflict. F26 owns semantic
conflict resolution, bounded AI work, ambiguity, and retry authorization. F27
owns result review, stale detection, explicit **Publish Merge**, merge-commit
creation/push, discard, and publication recovery. F25 does not commit, push,
post a GitHub response, resolve a GitHub conversation, or publish anything.

F25 contributes to APP-AC-17, APP-AC-39, APP-AC-44, APP-AC-45, APP-AC-48,
APP-AC-62, APP-AC-73, APP-AC-74, and APP-AC-75 only at those stated
boundaries. It does not claim completion of AI conflict resolution, stale
publication, or publication-recovery behavior owned by F26-F28.

## Executive Summary

After a developer confirms a synchronization selection, PRMonitor must prepare
each PR independently. A single multi-PR command must not share a mutable
worktree, let one failed fetch stop every other PR, create an empty merge
commit, or present a model's claim as proof that a merge or test succeeded.

F25 turns F24's exact, preparation-only authorization into durable per-PR
synchronization results. For each eligible PR, deterministic code prepares a
separate worktree at the recorded PR head, computes the merge base and the
source-side and PR-head-side changes, attempts a no-commit merge from the exact
recorded source commit, and inspects actual Git state. An already-contained
source is a distinct no-op result. A clean merge proceeds without an AI call;
an actual conflict is preserved with enough evidence for F26 to resolve later.

The result then uses F14 to run configured post-change validation, records the
complete local evidence, and explains whether the result is ready for the later
publication review or needs attention. Results are durable and independent:
the window may close, the application may restart, and one PR may fail while
other PRs continue to their own results.

## User Stories

### Start one independent operation per PR

- **US-01:** **GIVEN** F24 has committed a current authorization with one or more eligible PRs, **WHEN** the developer starts preparation, **THEN** PRMonitor creates one durable batch and one independently addressable synchronization operation for each eligible PR, while retaining ineligible/excluded rows as skipped evidence.
  - **Acceptance Criteria:** AC-01-AC-06, AC-16.
- **US-02:** **GIVEN** the developer closes the window or the application is restarted after preparation begins, **WHEN** synchronization state is requested again, **THEN** the same batch, per-PR operations, worktree paths, and input snapshots are returned without relying on renderer memory.
  - **Acceptance Criteria:** AC-16-AC-18.

### Prepare and inspect a deterministic merge

- **US-03:** **GIVEN** an eligible PR has explicit source/destination repositories, branches, and exact SHAs, **WHEN** preparation runs, **THEN** the result names those identities, uses the exact recorded commits, computes the merge base, and never silently substitutes a repository default branch or same-named ref.
  - **Acceptance Criteria:** AC-02-AC-05, AC-07.
- **US-04:** **GIVEN** the source commit is already reachable from the PR-head commit, **WHEN** deterministic merge planning runs, **THEN** the result is marked as a no-op, leaves no empty merge commit candidate, and remains distinguishable from a merge that changed the worktree.
  - **Acceptance Criteria:** AC-07-AC-08.
- **US-05:** **GIVEN** the source is not already contained and Git can merge it cleanly, **WHEN** F25 attempts the merge, **THEN** it leaves an inspectable no-commit merge result in the synchronization worktree and consumes zero AI-provider tokens.
  - **Acceptance Criteria:** AC-09, AC-14.

### Make validation and attention truthful

- **US-06:** **GIVEN** a clean or no-op result reaches the validation stage, **WHEN** the configured F14 post-change profile runs, **THEN** the synchronization result shows the real command statuses and never treats provider prose as a pass.
  - **Acceptance Criteria:** AC-11-AC-14.
- **US-07:** **GIVEN** Git reports a conflict, an unsafe worktree, a failed validation, or an uncertain local outcome, **WHEN** F25 records the result, **THEN** it preserves evidence, enters a non-ready outcome with a plain-language reason, and exposes only the next action permitted by the owning workflow.
  - **Acceptance Criteria:** AC-10-AC-13, AC-15-AC-18.

### Keep multi-PR work isolated and recoverable

- **US-08:** **GIVEN** a batch contains several eligible PRs, **WHEN** one operation fails, conflicts, or is cancelled, **THEN** other operations continue independently and their results remain reviewable.
  - **Acceptance Criteria:** AC-05-AC-06, AC-16.
- **US-09:** **GIVEN** a process stop, renderer destruction, network/materialization error, or uncertain Git command outcome occurs, **WHEN** the operation is retried or reconciled, **THEN** F25 reuses the durable identity, preserves the worktree/evidence, and does not duplicate a worktree or silently rerun an uncertain merge.
  - **Acceptance Criteria:** AC-16-AC-19.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** a F24 authorization contains eligible and ineligible/excluded selected PRs, **WHEN** F25 accepts it, **THEN** it persists one synchronization batch, one per-eligible-PR operation identity, the complete authorization snapshot, and per-PR skipped evidence before any worktree, Git, or validation effect; it does not create an empty batch.
- **AC-02:** **GIVEN** a confirmed operation input contains source/destination server and repository identities, `syncSourceBranch`, `prHeadBranch`, `syncSourceSha`, `prHeadSha`, `prBaseBranch`, and the F24 configuration revision, **WHEN** F25 prepares work, **THEN** every result retains those exact values and never replaces them with `default_branch`, a cached current value, or a same-named ref from another repository.
- **AC-03:** **GIVEN** the same F24 authorization or per-PR operation command is delivered again after renderer closure, process restart, or a lost local reply, **WHEN** F25 reconciles it, **THEN** it returns the existing batch/operation/result or a typed recovery state and does not create a second operation, worktree, merge attempt, validation run, or external publication capability.
- **AC-04:** **GIVEN** an eligible PR is admitted, **WHEN** preparation begins, **THEN** F25 requests an F13 synchronization worktree at the exact recorded `prHeadSha`, records the resolved canonical path and operation owner, verifies it is clean and distinct from every Review Bundle, conversation, developer, and other synchronization worktree, and refuses to reset or overwrite a dirty/unknown path.
- **AC-05:** **GIVEN** multiple eligible PRs are admitted in one batch, **WHEN** their operations run, **THEN** each PR has its own worktree, operation record, Git state, validation record, and result identity; a failure, conflict, cancellation, or slow operation for one PR does not prevent another PR from reaching its own terminal or reviewable result.
- **AC-06:** **GIVEN** source and PR-head objects are materialized successfully, **WHEN** F25 computes merge evidence, **THEN** it persists the exact `syncMergeBaseSha`, a bounded source-side change manifest/hash, a bounded PR-head-side change manifest/hash, the repository/ref identities that produced them, and the observation/revision used; a missing or mismatched object becomes a typed non-ready result without selecting another ref.
- **AC-07:** **GIVEN** `syncSourceSha` is equal to or an ancestor of `prHeadSha`, **WHEN** F25 classifies the merge, **THEN** it records a deterministic `NO_OP` merge outcome, leaves no merge in progress or empty merge-commit candidate, runs only the configured result checks, and keeps the result distinct from a changed clean merge.
- **AC-08:** **GIVEN** the source commit is not already contained and the worktree is clean, **WHEN** F25 performs the merge, **THEN** it uses the exact source commit with an explicit no-commit merge, creates no commit and uses no force operation, and records the actual resulting tree/index state for inspection.
- **AC-09:** **GIVEN** the no-commit merge completes without conflicts, **WHEN** F25 inspects the worktree, **THEN** it observes no unmerged paths or unresolved conflict markers, records a `CLEAN_MERGE` result with its exact diff evidence, and never invokes an AI provider or consumes AI tokens.
- **AC-10:** **GIVEN** Git reports a conflict, **WHEN** F25 handles the merge outcome, **THEN** it records `syncMergeBaseSha`, both-side change evidence, conflicted paths/hunks, Git state, worktree path, and a typed conflict-resolution handoff for F26; F25 does not guess, choose `ours`/`theirs`, modify the conflict semantically, or report the result as ready.
- **AC-11:** **GIVEN** a no-op or clean merge has passed actual Git inspection, **WHEN** F25 requests validation, **THEN** it uses F14's post-change contract against the same owned worktree and immutable operation snapshot, stores the real command/manual statuses and bounded evidence, and preserves `passed`, `failed`, `not_run`, and `interrupted` distinctions.
- **AC-12:** **GIVEN** validation exits successfully for all required automated checks and the worktree remains safe, **WHEN** F25 finalizes the result, **THEN** the result may enter `READY_TO_PUBLISH`; a configured validation failure, interruption, unsafe worktree, unresolved conflict, missing object, or uncertain Git outcome enters `NEEDS_ATTENTION` or `FAILED` with no publication permission. A no-safe-command `not_run` result remains visibly warned and does not become a false pass.
- **AC-13:** **GIVEN** no safe automated command is configured for the post-change phase, **WHEN** a deterministic clean/no-op result is summarized, **THEN** F25 persists `not_run` with the F14 warning and keeps the result reviewable without claiming that validation passed; the result's next action tells the developer whether to inspect, configure validation, or continue through F27's review gate.
- **AC-14:** **GIVEN** a clean or no-op synchronization path completes, **WHEN** its imports, provider fakes, usage records, and side effects are inspected, **THEN** no AI-provider adapter, prompt, model invocation, GitHub mutation, commit, push, response post, conversation resolution, or publication call is reachable, and the result explicitly records zero AI turns/tokens.
- **AC-15:** **GIVEN** a result is `SKIPPED`, `READY_TO_PUBLISH`, `NEEDS_ATTENTION`, or `FAILED`, **WHEN** a consumer reads it, **THEN** structured reason data states what happened, why it matters, and the permitted next action; a status label or free-form activity message is not the only explanation.
- **AC-16:** **GIVEN** one operation fails, is skipped, conflicts, or reaches attention, **WHEN** the batch projection updates, **THEN** other per-PR results remain independently addressable with their own status, reason, worktree, SHAs, validation, and history, and the batch summary reports completed/attention/failed/skipped counts without rewriting sibling results.
- **AC-17:** **GIVEN** the process stops or the renderer closes before, during, or after preparation, merge inspection, or validation, **WHEN** the main process restarts or a new renderer reads the result, **THEN** committed intent and evidence remain available; in-flight local effects are adopted only when actual Git state proves the same operation outcome, otherwise the result is preserved as reconciliation-required/`NEEDS_ATTENTION` and is not silently rerun.
- **AC-18:** **GIVEN** the developer cancels before a side effect or requests cancellation during a local merge/validation, **WHEN** F25 records the outcome, **THEN** no uncommitted intent is reported as completed, no dirty worktree is silently cleared, and any uncertain or partially applied local state remains inspectable with a safe retry, manual-inspection, or discard/re-evaluation next action.
- **AC-19:** **GIVEN** a result, request, repository/ref identity, path, command, or diagnostic is malformed, oversized, credential-shaped, arbitrary, or provider-specific, **WHEN** it crosses the F25 boundary, **THEN** it is rejected before persistence/effect or reduced to bounded safe data; no GitHub credential, authorization header, provider SDK object, prompt, shell command string, or uncontrolled environment value is stored or exposed.
- **AC-20:** **GIVEN** a synchronization result is presented through the downstream result surface, **WHEN** it is used with keyboard navigation, a screen reader, forced colors/high contrast, reduced motion, zoom, or a narrow window, **THEN** the per-PR status, no-AI/no-op distinction, validation warning, plain-language reason, worktree path, and next action remain understandable without color, hover, animation, or horizontal scrolling.

## Functional Requirements

### FR-01: Confirmed batch admission and independent operation identity

- FR-01.1: F25 SHALL accept only a committed F24 preparation authorization containing an explicit eligible PR set, per-PR ineligible/excluded classifications, exact repository/ref/SHA identities, configuration revision, correlation identity, and stable idempotency identity.
- FR-01.2: Before requesting a worktree, Git materialization, or validation run, F25 SHALL persist one synchronization batch intent and one independently addressable operation intent for each eligible PR through F03.
- FR-01.3: F25 SHALL preserve every selected ineligible or excluded PR as `SKIPPED` evidence with its F24 reason and SHALL never silently remove it from the batch summary.
- FR-01.4: F25 SHALL associate each operation with exactly one managed PR and one immutable F24 input snapshot; a batch SHALL not share mutable result state between PRs.
- FR-01.5: F25 SHALL remain an explicitly user-started operation and SHALL not be invoked by ordinary polling, quiet-period batching, global-pause resume, or automatic review dispatch.
- FR-01.6: Replaying an equivalent authorization or operation command SHALL return the existing durable result or a typed in-progress/recovery outcome rather than creating a duplicate operation.
- FR-01.7: F25 SHALL persist intent before each represented local side effect and SHALL distinguish committed, cancelled-before-effect, failed, interrupted, and uncertain handoff outcomes.
- FR-01.8: F25 SHALL expose a provider-neutral batch/result handoff to F26/F27 without granting either consumer publication authority through the F25 input.

### FR-02: Exact identities, source materialization, and isolated worktrees

- FR-02.1: F25 SHALL use the source/destination repositories, `syncSourceBranch`, `prHeadBranch`, `syncSourceSha`, and `prHeadSha` supplied by F24 and SHALL never substitute a repository default branch, a same-named ref, a mutable cache value, or provider prose.
- FR-02.2: F25 SHALL request one F13 synchronization worktree per eligible PR at the exact recorded `prHeadSha`, with a distinct durable operation owner and resolved canonical path.
- FR-02.3: Before merging or validating, F25 SHALL require F13 to confirm operation ownership, expected baseline/head identity, current path, and a safe clean/known state; it SHALL not reset, clean, replace, or overwrite a dirty or uncertain worktree.
- FR-02.4: F25 SHALL keep synchronization worktrees separate from developer clones, Review Bundle worktrees, conversation worktrees, and other synchronization operations, including when source and destination repositories are the same.
- FR-02.5: F25 SHALL materialize only the exact recorded source/head objects or return a bounded failure when those objects cannot be proven to match the authorization; it SHALL not refresh to a different SHA silently.
- FR-02.6: F25 SHALL obtain and persist the exact `syncMergeBaseSha` through the F13/Git contract after both exact commits are available.
- FR-02.7: F25 SHALL persist bounded source-side and PR-head-side change evidence, including stable identities/hashes and conflicted-path metadata when present, without treating a file-name list as semantic ownership.

### FR-03: Deterministic no-commit merge and conflict evidence

- FR-03.1: F25 SHALL perform the merge using deterministic Git operations over the exact source commit and an explicit no-commit workflow; it SHALL not accept a renderer-provided shell command or provider-generated Git command.
- FR-03.2: F25 SHALL classify a source commit equal to or already contained in the PR-head commit as `NO_OP` before creating a merge result and SHALL not create an empty merge commit or leave a merge in progress for that outcome.
- FR-03.3: For a non-no-op merge, F25 SHALL inspect the actual post-merge Git state and SHALL require no unmerged paths before classifying the result as a clean merge.
- FR-03.4: On an actual conflict, F25 SHALL record conflicted paths/hunks, merge-base identity, both-side change evidence, Git status, and the isolated worktree before emitting a typed F26 handoff.
- FR-03.5: F25 SHALL never resolve a conflict by selecting `ours`, `theirs`, a textual hunk winner, or an AI/provider result; semantic conflict resolution belongs to F26.
- FR-03.6: F25 SHALL not create a commit, push a branch, force push, post a response, resolve a conversation, approve a review, or publish a merge.
- FR-03.7: A clean/no-op merge SHALL have an explicit deterministic evidence classification that cannot be inferred from a status label or a missing error.
- FR-03.8: F25 SHALL preserve a merge-in-progress, dirty, or uncertain local state for inspection and shall route it to a non-ready result rather than silently cleaning or retrying it.

### FR-04: Validation and synchronization-result truth

- FR-04.1: After actual Git inspection of a clean or no-op outcome, F25 SHALL request F14 post-change validation using the same operation-owned worktree and immutable validation/profile snapshot applicable to the operation.
- FR-04.2: F25 SHALL persist the real F14 validation result, phase, command evidence, manual-check state, warnings, and worktree revision/fingerprint; it SHALL not infer pass/fail from model or activity prose.
- FR-04.3: F25 SHALL preserve distinct `passed`, `failed`, `not_run`, and `interrupted` validation states and SHALL show no-safe-command warnings without fabricating a pass.
- FR-04.4: F25 SHALL classify a deterministic clean/no-op result as `READY_TO_PUBLISH` only when Git inspection is safe and required validation is successful or explicitly `not_run` because no safe command exists; validation failure, interruption, unsafe state, unresolved conflict, or uncertain Git outcome SHALL produce `NEEDS_ATTENTION` or `FAILED` with a blocking reason.
- FR-04.5: F25 SHALL persist one synchronization result per operation containing PR identity, source/destination repositories and branches, exact source/head/merge-base SHAs, merge outcome, worktree path, source-side/head-side evidence, conflict evidence, diff/manifest evidence, validation evidence, AI-usage summary, status, reason, and next action.
- FR-04.6: The result SHALL distinguish `CLEAN_MERGE`, `NO_OP`, `CONFLICT_DETECTED`, `PREPARATION_FAILED`, `VALIDATION_FAILED`, `CANCELLED`, `INTERRUPTED`, and `UNCERTAIN` outcomes without collapsing them into one generic error.
- FR-04.7: F25 SHALL mark a clean/no-op result as having zero AI turns and zero AI tokens when no AI provider was invoked; absent usage metadata SHALL not be represented as a fabricated non-zero usage value.
- FR-04.8: F25 SHALL provide F27 a stable, immutable result revision and a read model that can be loaded after renderer closure or restart without parsing logs.

### FR-05: Failure isolation, reasons, and downstream handoff

- FR-05.1: F25 SHALL process eligible PR operations independently so a failure, conflict, cancellation, timeout, or slow operation for one PR does not cancel or rewrite another PR's operation.
- FR-05.2: Every actionable `SKIPPED`, `READY_TO_PUBLISH`, `NEEDS_ATTENTION`, or `FAILED` result SHALL include structured what/why/next-action reason data and a bounded stable reason code.
- FR-05.3: F25 SHALL expose explicit per-PR progress and terminal projections such as preparing, merging, inspecting, validating, conflict-detected, ready, attention, failed, and skipped without changing the PR's primary review state or releasing a Review Bundle hold.
- FR-05.4: F25 SHALL record batch counts and per-result completion independently; a batch summary SHALL never imply that every PR reached the same outcome.
- FR-05.5: A real conflict handoff SHALL include the exact source/head identities, merge base, source-side/head-side change evidence, conflict details, intent/context reference when permitted, operation/worktree identity, and a bounded reason for F26.
- FR-05.6: F25 SHALL make no AI request on a clean or no-op path and SHALL expose the conflict handoff as a capability-limited request rather than a provider object or prompt.
- FR-05.7: F25 SHALL preserve deterministic evidence needed by F27 to review, re-evaluate, detect staleness, or discard the result; it SHALL not imply that a result is publishable merely because it is stored.
- FR-05.8: F25 SHALL expose bounded status/reason fields suitable for accessible downstream presentation, including a non-color distinction between no-op, clean merge, conflict, validation warning/failure, and uncertain outcome.

### FR-06: Cancellation, restart, idempotency, and security boundary

- FR-06.1: F25 SHALL keep batch and operation execution in the Electron main process and SHALL continue to own durable state when no renderer exists.
- FR-06.2: On startup or renderer recreation, F25 SHALL reconcile durable pending/running operation identities with F13 actual Git/worktree state and F14 validation records before retrying any local effect.
- FR-06.3: F25 SHALL adopt a terminal result only when actual evidence proves it belongs to the same operation/input snapshot; otherwise it SHALL preserve the worktree and record a reconciliation-required or uncertain attention outcome.
- FR-06.4: Cancellation before a committed intent SHALL create no successful operation; cancellation after intent commit SHALL preserve the intent and record a typed skipped, cancelled, interrupted, or attention outcome without compensating deletion of history.
- FR-06.5: Retries SHALL reuse the durable batch/operation identity and SHALL not create a second worktree, duplicate merge result, or duplicate validation run for an already committed terminal outcome.
- FR-06.6: F25 SHALL reject arbitrary paths, shell strings, raw credential-bearing values, unbounded payloads, provider SDK objects, and uncontrolled environment values before persistence or effect, and SHALL keep secrets behind deterministic infrastructure.
- FR-06.7: F25 SHALL emit only bounded, correlated, redacted activity/diagnostic data; activity loss SHALL not change synchronization truth.
- FR-06.8: F25 SHALL expose no publication capability to the renderer, F26, an AI provider, or any notification/read-model consumer; publication remains an explicit F27 action.

## Non-Functional Requirements

- **NFR-01: Determinism** - Equivalent F24 snapshots and equivalent repository states SHALL produce the same merge classification, merge-base identity, evidence hashes, reason codes, and result state, subject only to explicitly recorded Git/runtime differences.
- **NFR-02: Isolation** - No operation SHALL read or mutate the developer's normal clone or another operation's worktree, and one per-PR result SHALL not share mutable state with another result.
- **NFR-03: Durability and recovery** - Intent, input snapshots, worktree identity, merge evidence, validation evidence, status transitions, and reasons SHALL survive renderer closure, process restart, and ordinary network interruption according to their recorded recovery state.
- **NFR-04: Bounded execution** - Batch concurrency, Git output, diff/change evidence, reason text, diagnostic payloads, and IPC/read-model payloads SHALL be bounded; one slow operation SHALL not hold all sibling results hostage indefinitely.
- **NFR-05: Security and authority** - The feature SHALL use typed provider-neutral inputs, controlled Git/process boundaries, redaction, and explicit capability separation; no AI or F25 result may gain commit, push, response, or publication authority.
- **NFR-06: Accessibility** - Result status, warnings, evidence availability, focus/error recovery, and next actions SHALL be usable with keyboard navigation, screen readers, forced colors/high contrast, reduced motion, zoom, and narrow windows without relying on color or horizontal scrolling.
- **NFR-07: Windows-first platform behavior** - Git and path handling SHALL work on the supported Windows runtime, including spaces, Unicode, case-insensitive containment, detached worktrees, process interruption, and safe file-manager path display; platform-specific details SHALL remain behind adapters.
- **NFR-08: Observability** - Each batch, per-PR operation, worktree, merge attempt, validation run, handoff, and terminal result SHALL have a stable correlation identity and bounded diagnostic events sufficient to explain what happened without treating logs as state.

## Invariants

- **INV-01:** F25 operates only in an F13-owned synchronization worktree and never mutates the developer clone, a Review Bundle worktree, a conversation worktree, or another synchronization worktree.
- **INV-02:** The recorded F24 source/destination repositories, branches, and exact SHAs are authoritative for preparation; `default_branch`, same-named refs, cached mutable values, and provider prose cannot substitute for them.
- **INV-03:** Durable intent and immutable input snapshots are committed before F13, Git, or F14 side effects, and a committed record is never made to appear uncommitted by cancellation or renderer closure.
- **INV-04:** A batch contains independent per-PR operations/results. A sibling failure, conflict, cancellation, timeout, or retry cannot rewrite, cancel, or hide another result.
- **INV-05:** Clean and no-op paths invoke no AI provider and consume zero AI turns/tokens; F25 only emits a bounded conflict handoff after deterministic Git reports a real conflict.
- **INV-06:** F25 has no commit, push, force-push, GitHub-response, conversation-resolution, review-approval, merge-publication, or publication-authority capability.
- **INV-07:** F25 never resets, cleans, replaces, or deletes a dirty/unknown synchronization worktree without an explicit downstream action governed by F13/F27; uncertain state remains inspectable.
- **INV-08:** Git inspection and F14 validation evidence, not AI claims, activity text, missing errors, or UI state, determine merge and readiness outcomes.
- **INV-09:** `NO_OP`, `CLEAN_MERGE`, `CONFLICT_DETECTED`, validation outcomes, and uncertain/local failures remain distinct historical facts and are not collapsed into a generic status.
- **INV-10:** Renderer closure, process restart, sleep/wake, global pause, or notification delivery cannot reset a batch/operation identity, duplicate a worktree/merge/validation effect, release a review hold, or grant publication authority.
- **INV-11:** Synchronization status is an overlay independent of the PR's primary review state; F25 never changes `WATCHING`, `WORKING`, `READY_FOR_REVIEW`, or `NEEDS_ATTENTION` merely because synchronization progresses.
- **INV-12:** Every user-actionable result contains safe, bounded, structured what/why/next-action data and contains no credentials, prompts, provider SDK objects, raw authorization headers, or uncontrolled environment values.

## Out of Scope

- **Semantic conflict resolution** - F26 owns AI-assisted resolution, ambiguity, user questions, bounded turns, and retry authorization.
- **Result review and publication** - F27 owns the synchronization result screen, explicit **Publish Merge**, merge-commit creation, non-force push, stale detection, discard, and publication recovery.
- **Automatic branch synchronization** - ordinary polling, quiet-period batching, global pause/resume, and review holds do not start F25.
- **GitHub mutation** - no commit push, force push, GitHub response, conversation resolution, review approval, or PR merge is performed here.
- **Review Bundle work** - F25 does not change review feedback, Review Bundle state, review holds, or review worktrees.
- **Partial patch acceptance or silent cleanup** - the MVP does not reconstruct per-hunk merge results or discard manual work automatically.
- **Automatic rebase of stale results** - a changed source/head SHA is handled by F27's stale/re-evaluation workflow.
- **New remote provider integrations** - GitHub/GHES access remains behind F06; no webhook or centralized service is added.

## Product Decisions

- **PD-01: One batch, independent per-PR results** - A multi-PR synchronization request is one durable batch for reporting, but every eligible PR has its own operation, worktree, evidence, validation, and outcome so a failure cannot block or rewrite siblings.
- **PD-02: F24's exact snapshot defines preparation** - F25 uses the repositories, branches, SHAs, configuration revision, and eligibility recorded by F24. It may materialize those exact commits, but it does not silently refresh to current refs or use the repository default branch.
- **PD-03: Prepare without committing** - F25 performs an explicit no-commit merge and leaves the clean result inspectable. F27 later decides whether to create and publish a merge commit. An already-contained source is a no-op and never produces an empty merge commit.
- **PD-04: AI only after an actual conflict** - A clean or no-op path uses zero AI. F25 records and hands off a real conflict; it never asks AI to perform deterministic Git work or to decide whether a conflict exists.
- **PD-05: Missing safe validation is visible, not a fabricated pass** - If F14 has no safe post-change command, the result retains `not_run` and a warning. That absence alone does not erase a deterministic clean/no-op result, while validation failure/interruption/unsafe state blocks readiness.
- **PD-06: Plain-language reason data is part of the result** - Status labels are not enough. Every skipped, ready, attention, or failed result records what happened, why it matters, and what the developer can do next for F27 to present.
- **PD-07: Preserve uncertain local state** - A process stop, cancellation, or ambiguous Git outcome preserves the operation worktree and evidence. The feature never repairs uncertainty by resetting or rerunning blindly.

## Implementation Decisions

- **IMP-01: Use F13 for all Git/worktree effects** - F25 supplies typed identities and operation ownership to F13 and consumes its actual-state, merge-base, diff, and worktree-condition contracts rather than invoking Git from the renderer or duplicating path rules.
- **IMP-02: Use exact commits and structured Git arguments** - The merge is driven by the authorized source commit and a validated argument vector with no shell-string entry point; no provider-generated command can become execution authority.
- **IMP-03: Use F14's post-change phase for result validation** - F25 does not interpret command output or invent a second validation model. It stores the shared F14 result and applies the product readiness mapping in FR-04.4.
- **IMP-04: Keep conflict handoff provider-neutral** - The F26 input is a bounded typed evidence package containing identities, change evidence, paths/hunks, worktree ownership, and allowed context references; it does not contain an SDK object or publication credential.
- **IMP-05: Keep publication outside F25** - The clean merge remains a local no-commit state, and F27 receives a stable result revision plus exact evidence for its later approval and publication revalidation.

## Testing Decisions

- **TST-01: Use temporary repositories and fake downstream ports** - Contract tests use test-owned Git repositories/worktrees, F03/F13/F14/F24 fakes, injected clocks, and fault points; they do not contact GitHub or an AI provider.
- **TST-02: Test real deterministic Git state at the service boundary** - The clean/no-op/conflict fixtures assert commit ancestry, merge-base, actual index/worktree state, unmerged paths, diff evidence, and no-commit behavior rather than trusting a mocked textual summary alone.
- **TST-03: Do not duplicate F26 semantic tests** - F25 tests that a real conflict is detected and handed off with complete evidence. F26 tests semantic resolution, ambiguity, bounded AI turns, and retry behavior.
- **TST-04: Test result projections rather than duplicate F27 UI implementation** - F25 tests bounded status/reason/read-model fields and accessibility-relevant semantics; F27 owns end-to-end screen interaction and publication controls.
- **TST-05: Exercise interruption at every durable boundary** - Tests cover before/after intent commit, worktree creation, source materialization, merge start/finish, inspection, validation start/finish, renderer closure, process restart, and uncertain local outcomes.

## Proposed Modules

- **MOD-01: SynchronizationBatchService** - Accepts one F24 authorization, persists the batch, fans out independent per-PR operation identities, and aggregates counts without owning sibling state.
- **MOD-02: SynchronizationPreparationCoordinator** - Requests F13 exact worktrees and source materialization, validates ownership/cleanliness, and records the immutable operation snapshot.
- **MOD-03: DeterministicMergeCoordinator** - Computes/records merge-base evidence, classifies no-op, performs the no-commit merge, inspects actual state, and emits clean/conflict/failure evidence.
- **MOD-04: SynchronizationValidationCoordinator** - Invokes F14 for the post-change phase and maps only the shared deterministic result to the F25 readiness contract.
- **MOD-05: SynchronizationResultRepository** - Persists per-PR result history, evidence references, structured reasons, status revisions, and restart/recovery markers through F03.
- **MOD-06: SynchronizationResultProjection** - Produces bounded batch/per-PR read models for F27, notifications, and recovery without exposing Git handles, provider objects, or publication capability.

## Workflows

### Workflow 1: Prepare a clean multi-PR batch

```text
1. F24 commits a preparation-only authorization with eligible and ineligible rows.
2. F25 persists one batch and one operation intent per eligible PR.
3. Each operation receives a distinct F13 synchronization worktree at its recorded prHeadSha.
4. F13 materializes the exact source/head objects and records syncMergeBaseSha,
   source-side changes, and PR-head-side changes.
5. F25 detects that the source is not already contained and runs an explicit
   no-commit merge using the exact syncSourceSha.
6. F25 inspects the actual clean result and asks F14 for post-change validation.
7. F25 persists READY_TO_PUBLISH with CLEAN_MERGE, validation evidence, zero AI
   usage, the worktree path, and a plain-language next action.
8. Other PRs continue independently; F27 later presents each result for review.
```

### Workflow 2: Prepare a no-op and isolate a conflict/failure

```text
1. For PR A, syncSourceSha is already an ancestor of prHeadSha.
2. F25 records NO_OP, leaves no merge in progress, runs only configured result
   checks, and records no empty commit candidate.
3. For PR B, Git reports conflicted paths after the no-commit merge attempt.
4. F25 records both-side evidence and emits a bounded F26 conflict handoff while
   preserving the synchronization worktree.
5. For PR C, exact source materialization or validation fails.
6. PR A remains independently reviewable; PR B is conflict/attention work; PR C
   has its own failed/attention reason. No result cancels or rewrites another.
```

### Workflow 3: Recover after interruption

```text
1. F25 commits operation intent before the local effect.
2. The renderer closes or the process stops during worktree preparation, merge,
   inspection, or validation.
3. Startup reloads the batch/operation identity and asks F13/F14 for actual state.
4. A proven terminal result is adopted; otherwise the worktree/evidence is kept
   and the result becomes reconciliation-required/NEEDS_ATTENTION.
5. Repeating the same command returns the durable result or recovery state and
   never creates a second worktree, merge result, or validation run.
```

## Contract-Test Criteria

- **CT-F25-01: Authorization and idempotent admission** - F24 snapshot validation, ineligible-row retention, persist-before-effect, duplicate authorization, and competing operation commands.
- **CT-F25-02: Explicit identity matrix** - Override/base source, same repository, fork repositories, default-branch non-substitution, moved/missing/mismatched exact objects, and configuration revision preservation.
- **CT-F25-03: Independent worktree isolation** - Distinct per-PR paths, review/conversation/developer-worktree non-collision, clean baseline, dirty/unknown refusal, and developer-clone byte/status preservation.
- **CT-F25-04: Merge-base and both-side evidence** - Exact merge base, source-side/head-side manifests and hashes, deterministic replay, bounded evidence, and conflict-path capture.
- **CT-F25-05: No-op and clean merge** - Equal/ancestor classification, no empty commit, explicit no-commit/no-force merge, actual clean inspection, zero AI-provider reachability, and no publication capability.
- **CT-F25-06: Conflict handoff** - Real conflict only, complete typed F26 input, no blind `ours`/`theirs`, preserved worktree, and no F25 semantic or AI resolution.
- **CT-F25-07: Validation and readiness mapping** - F14 post-change invocation, pass/fail/not-run/interrupted truth, no-safe-command warning, and ready/attention/failed classification.
- **CT-F25-08: Per-result failure and lifecycle recovery** - Sibling isolation, cancellation, renderer closure, restart, process-stop fault points, uncertain Git state, and no duplicate local effects.
- **CT-F25-09: Durable result and safe projection** - Complete field set, revisions, reason data, AI-usage summary, bounded/redacted records, activity correlation, and restart readback.
- **CT-F25-10: Accessibility and downstream conformance** - Keyboard/screen-reader/forced-colors/reduced-motion/zoom/narrow-width semantics plus F26/F27 consumer capability restrictions.

## Requirement Traceability

| Requirement family | Observable coverage | Named contract tests |
|---|---|---|
| FR-01 | AC-01-AC-05, AC-16-AC-18 | CT-F25-01, CT-F25-08, CT-F25-09 |
| FR-02 | AC-02-AC-07, AC-16-AC-19 | CT-F25-02, CT-F25-03, CT-F25-04, CT-F25-08 |
| FR-03 | AC-07-AC-10, AC-14, AC-17-AC-19 | CT-F25-04, CT-F25-05, CT-F25-06, CT-F25-08 |
| FR-04 | AC-06-09, AC-11-AC-14, AC-17 | CT-F25-04, CT-F25-05, CT-F25-07, CT-F25-09 |
| FR-05 | AC-01, AC-05-06, AC-10-AC-16, AC-20 | CT-F25-01, CT-F25-06, CT-F25-09, CT-F25-10 |
| FR-06 | AC-03-05, AC-14, AC-16-AC-20 | CT-F25-01, CT-F25-03, CT-F25-08, CT-F25-09, CT-F25-10 |
| NFR-01-NFR-08 | AC-01-AC-20 | CT-F25-01-CT-F25-10 |
| INV-01-INV-12 | AC-01-AC-20 | CT-F25-01-CT-F25-10 |
