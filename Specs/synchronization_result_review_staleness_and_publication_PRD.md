# F27 - Synchronization Result Review, Staleness, and Publication - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F02 - Domain contracts and deterministic state machines | Provides legal synchronization overlay states, structured reasons, action transitions, and separation from the PR's primary review state. |
| 2 | F03 - SQLite persistence, migrations, and transactional repositories | Provides versioned result history, expected-revision checks, publication locks, idempotency, and restart-safe records. |
| 3 | F06 - GitHub REST client and remote identity model | Provides current PR status, exact source/head ref reads, and the non-force head-ref publication boundary. |
| 4 | F13-F14 - Operation-owned Git worktrees and deterministic validation | Provides authoritative worktree condition, merge-result/diff evidence, safe dirty-worktree choices, and real validation outcomes. |
| 5 | F19-F20 - Native navigation and Review Bundle workspace foundations | Provides synchronization-batch routing, accessible review surfaces, diff/evidence presentation primitives, and worktree actions. |
| 6 | F23 - Human-approved, idempotent Review Bundle publication | Provides the established approval, persist-before-effect, publication-phase, and uncertain-outcome contracts that synchronization publication must match without sharing Review Bundle state. |
| 7 | F24-F25 - Synchronization selection and deterministic merge results | Provides explicit source/head identities, exact SHAs, per-PR result records, merge-base/change evidence, validation records, and independent batch outcomes. |
| 8 | F26 - AI-assisted merge-conflict resolution | Provides structured competing-intent evidence, required user questions, bounded turn reports, and the rule that ambiguous conflicts cannot be publishable. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F28 - Restart, sleep, network-loss, and uncertain-outcome recovery | Extends F27's durable publication phases and reconciliation into cross-feature startup and environment recovery. |
| 2 | F29 - Security and trust-boundary hardening | Audits F27's IPC, Git, GitHub, path, credential, force-push, and publication boundaries. |
| 3 | F30 - Windows packaging, end-to-end acceptance, and release readiness | Verifies the complete synchronization review and publication workflow on supported Windows/GitHub configurations. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-17 | FR-01.1-FR-01.7, FR-07.6-FR-07.7, NFR-03, INV-07-INV-08 | AC-01, AC-22-AC-23 | Shared: F03/F25 own durable result truth; F27 rehydrates the review projection and publication intent without renderer authority; F28 owns full lifecycle recovery. |
| APP-AC-13 | FR-02.5, FR-05.4-FR-05.6, NFR-01 | AC-02-AC-03, AC-10-AC-11 | Shared: F14/F25 own real validation execution and results; F27 presents them and gates publication without accepting provider claims. |
| APP-AC-26 | FR-04.1-FR-04.6, FR-05.4-FR-05.6, INV-05 | AC-08-AC-10, AC-14 | Shared: F22 owns Review Bundle stale handling; F27 owns synchronization-result stale detection and publication blocking. |
| APP-AC-39 | FR-03.1-FR-03.7, FR-05.4, INV-13 | AC-05-AC-07, AC-10 | Shared: F13 owns worktree truth and safe clearing; F27 owns the synchronization-result choice flow and action gate. |
| APP-AC-46 | FR-01.2, FR-06.6, NFR-04, INV-02 | AC-01, AC-15 | Shared: F25 owns independent preparation; F27 preserves independent review/publication state and sibling outcomes. |
| APP-AC-47 | FR-02.4, FR-06.1, INV-09-INV-10 | AC-03, AC-13, AC-19 | Shared: F25 owns the clean/no-op zero-AI path; F27 presents and finalizes the no-code result without AI or an empty commit. |
| APP-AC-48 | FR-02.1-FR-02.5, INV-09, INV-11 | AC-03-AC-04, AC-15 | Shared: F26 owns semantic conflict resolution; F27 presents deterministic conflict evidence and keeps unresolved results non-publishable. |
| APP-AC-49 | FR-01.1-FR-02.6, FR-04.1-FR-04.6, FR-06.4-FR-06.6, NFR-01-NFR-03 | AC-01-AC-04, AC-08, AC-15, AC-22 | Shared: F25 owns complete persisted synchronization-result truth; F27 owns the complete review projection, explanations, and per-result actions. |
| APP-AC-50 | FR-05.1-FR-05.7, FR-06.1-FR-06.8, INV-03-INV-06 | AC-09-AC-14, AC-17-AC-20 | Primary: F27 owns explicit per-result approval, exact pre-publication verification, merge publication, and the no-force boundary. |
| APP-AC-51 | FR-04.1-FR-04.6, FR-05.4-FR-05.6, INV-05 | AC-08-AC-10, AC-14 | Primary for synchronization results: F27 compares both recorded source/head SHAs and blocks stale publication until explicit re-evaluation or discard. |
| APP-AC-52 | FR-06.6-FR-06.8, FR-07.1-FR-07.4, INV-12 | AC-18-AC-20 | Shared: F27 emits the successful-head-advance invalidation with exact prior/new identities; F22 applies the Review Bundle stale transition without deleting history or worktrees. |
| APP-AC-53 | FR-06.1-FR-07.7, NFR-03, INV-07-INV-08 | AC-16-AC-23 | Primary for synchronization publication: F27 owns per-result idempotent merge/push/retry/reconciliation; F25 owns idempotent preparation and F28 owns cross-feature recovery. |
| APP-AC-54, APP-AC-55, APP-AC-56, APP-AC-57, APP-AC-58 | FR-02.1-FR-02.4, FR-07.3-FR-07.6, NFR-03, INV-08-INV-11 | AC-03-AC-04, AC-17, AC-22 | Shared: F17/F26 own bounded AI work, turns, budgets, and stop decisions; F27 presents the complete evidence and routes explicit retry/user actions. |
| APP-AC-59, APP-AC-60, APP-AC-61, APP-AC-62, APP-AC-63, APP-AC-64 | FR-02.4, FR-08.2, NFR-01, NFR-06, INV-09-INV-11 | AC-03, AC-19, AC-21 | Shared: F15-F17 own provider/profile/policy contracts and records; F27 presents provider-neutral metadata and enforces the no-publication boundary. |
| APP-AC-68 | FR-05.3, FR-06.4, FR-07.3-FR-07.6, NFR-03, INV-07-INV-08 | AC-12, AC-14, AC-17, AC-22 | Shared boundary: F27 owns synchronization publication phases, commit SHA, and recovery; F23 owns Review Bundle response IDs and its PUBLISHED_WITH_ERRORS behavior. |
| APP-AC-70 | FR-02.4, FR-05.7, FR-08.2, NFR-06, INV-09-INV-11 | AC-03, AC-19, AC-21 | Shared: F16/F17 own policy resolution/enforcement; F27 displays the immutable policy summary and never grants provider publication authority. |
| APP-AC-75 | FR-01.3-FR-02.6, FR-04.3-FR-06.5, NFR-02, NFR-05, INV-01 | AC-03-AC-04, AC-08, AC-15, AC-20 | Shared: F25/F26 supply reason and evidence; F27 gives READY_TO_PUBLISH, NEEDS_ATTENTION, STALE, and FAILED distinct accessible explanations and actions. |
| APP-AC-73 | FR-02.5, FR-05.4-FR-05.6, NFR-01, INV-09 | AC-02-AC-03, AC-10-AC-11, AC-19 | Shared: F14/F25 own validation execution and phase truth; F27 shows the result and blocks publication on unacceptable or unknown validation. |
| APP-AC-76 | FR-02.1-FR-02.5, INV-11 | AC-03-AC-04, AC-15 | Shared: F26 owns the exact conflict-resolution input and semantic result; F27 exposes both-side evidence and the deterministic publication block. |
| APP-AC-77 | FR-02.1-FR-02.6, FR-05.6, INV-11 | AC-04, AC-15, AC-20 | Shared: F26 owns competing-intent analysis and the structured question; F27 presents it, preserves the block, and routes only explicit user-directed actions. |

### Explicit coverage boundaries

F27 owns the review and publication workflow for an already-created
synchronization result. It owns the batch/result read model, evidence
presentation, result-specific explanations, dirty-worktree choice flow,
synchronization staleness, per-result approval, publication preflight,
non-force merge publication, publication reconciliation, and the typed
invalidation handoff for older Review Bundles.

F24 remains authoritative for source precedence, repository/ref identity, and
current source/head resolution. F25 remains authoritative for preparation,
merge-base/change evidence, no-op/clean/conflict classification, validation
truth, and the initial result record. F26 remains authoritative for semantic
conflict resolution, competing intents, user-question data, bounded AI work,
and conflict-resolution evidence. F13 remains authoritative for actual Git
state, worktree ownership, dirty attribution, merge-result inspection, and
safe clearing. F14 remains authoritative for validation execution. F06 is the
only GitHub transport boundary.

F27 does not perform automatic synchronization, ordinary PR polling, source
branch selection, semantic conflict resolution, Review Bundle publication,
GitHub response publication, force push, per-hunk patch acceptance, or
automatic rebase. A synchronization result has no response-publication phase.
F23 owns the analogous Review Bundle publication workflow; F27 owns its
parallel synchronization path and does not reuse Review Bundle publication
records as if the two workflows were the same operation.

For APP-AC-52, F27 does not directly rewrite Review Bundle state. After a
successful synchronization changes the PR head, it emits a durable
head-advance invalidation containing the previous and resulting head
identities. The existing stale-work owner consumes that handoff and marks
affected historical Review Bundles stale while preserving their history and
worktrees.

## Executive Summary

A synchronization result is useful only when the developer can inspect the
exact merge that was prepared and decide on that result independently of every
other PR in the batch. F27 adds the review surface that turns F25/F26 evidence
into a human decision: what happened, which branches and commits were used,
what Git and validation actually found, whether a conflict remains ambiguous,
and what action is safe next.

Every eligible PR receives its own result card and detail view. Clean merges,
already-contained no-ops, conflicts requiring input, stale results, failures,
and published outcomes remain independently addressable. The user may inspect
the complete merge diff, validation, worktree condition, and AI evidence when
present. A result with an ambiguous conflict exposes the competing-intent
summary and required question but cannot be treated as ready.

Publication is a separate per-result action. Before any commit or push,
deterministic code fetches current state and verifies the PR, exact source and
head repositories/branches, both recorded SHAs, merge-base/result identity,
worktree condition, validation evidence, and non-force feasibility. The
approval and publication intent are persisted before effects. A no-op records
an explicit no-code publication outcome without creating an empty commit or
push. A successful merge publication records the remote commit and invalidates
older Review Bundles prepared against the previous head.

## User Stories

### Inspect a synchronization batch

- **US-01:** **GIVEN** F25 has committed a synchronization batch, **WHEN** the developer opens it from the inbox, tray, notification, or a saved route, **THEN** the batch shows deterministic counts and one independently addressable row for every selected PR outcome without starting Git, AI, validation, or publication work.
  - **Acceptance Criteria:** AC-01-AC-03, AC-22.
- **US-02:** **GIVEN** the developer opens one result, **WHEN** its detail view loads, **THEN** it shows the exact PR/repository/branch/SHA identities, merge-base, changes, validation, worktree, status, reason, next action, and AI evidence when applicable.
  - **Acceptance Criteria:** AC-02-AC-04, AC-15.

### Understand attention and ambiguity

- **US-03:** **GIVEN** a result is skipped, ready, attention-required, stale, failed, publishing, or published, **WHEN** the result is displayed, **THEN** its status is accompanied by a persisted explanation of what happened, why it matters, and what the developer can do next.
  - **Acceptance Criteria:** AC-03, AC-08, AC-15.
- **US-04:** **GIVEN** F26 reports an ambiguous conflict, **WHEN** the developer opens the result, **THEN** the view shows affected paths/hunks, both competing intents, evidence and uncertainty, the required user question, prior turn reports, and the permitted answer/direct/edit/retry/re-evaluate/discard actions; Publish Merge is unavailable.
  - **Acceptance Criteria:** AC-04, AC-15, AC-20.

### Handle dirty and stale results safely

- **US-05:** **GIVEN** the developer chooses Discard or Re-evaluate, **WHEN** the synchronization worktree is inspected, **THEN** the developer sees the actual current condition and must choose Clear All Changes, Clear Only AI Changes, or Keep Worktree and Cancel when changes are present.
  - **Acceptance Criteria:** AC-05-AC-07, AC-20.
- **US-06:** **GIVEN** the recorded source or PR-head SHA is no longer current, **WHEN** F27 performs an observation or publication preflight, **THEN** it marks the result stale, preserves the reviewed evidence, blocks publication, and offers only explicit Re-evaluate or Discard.
  - **Acceptance Criteria:** AC-08, AC-10, AC-14.
- **US-07:** **GIVEN** the developer confirms Re-evaluate, **WHEN** the current refs and worktree choice are accepted, **THEN** F27 starts a new synchronization attempt with fresh source/head snapshots while leaving the original result inspectable and unchanged.
  - **Acceptance Criteria:** AC-06-AC-08, AC-14, AC-22.

### Publish one exact result

- **US-08:** **GIVEN** a result is ready and current, **WHEN** the developer chooses Publish Merge, **THEN** only that result receives an explicit approval and fresh preflight; no batch-level approval silently publishes another PR.
  - **Acceptance Criteria:** AC-09-AC-11, AC-15.
- **US-09:** **GIVEN** a no-op result is approved, **WHEN** publication completes, **THEN** the result records a no-code publication outcome, performs no empty commit or push, and remains distinct from a merge that created a commit.
  - **Acceptance Criteria:** AC-11-AC-13.
- **US-10:** **GIVEN** a non-no-op result passes preflight, **WHEN** publication executes, **THEN** the exact reviewed merge is committed and pushed to the recorded PR head branch without force, the remote commit SHA is verified, and the result becomes published.
  - **Acceptance Criteria:** AC-10-AC-14, AC-17-AC-20.

### Recover without cross-result effects

- **US-11:** **GIVEN** publication is retried, the renderer closes, the process restarts, or a commit/push response is uncertain, **WHEN** F27 reconciles the result, **THEN** it adopts a proven existing effect or resumes the same intent without creating a duplicate commit or push.
  - **Acceptance Criteria:** AC-16-AC-19, AC-22-AC-23.
- **US-12:** **GIVEN** one result in a batch fails, becomes stale, or is published, **WHEN** the batch projection updates, **THEN** every sibling keeps its own evidence, status, lock, and next action; a successful publication marks older Review Bundles for that PR stale without deleting their history.
  - **Acceptance Criteria:** AC-15-AC-20.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** a committed F25 synchronization batch contains skipped and eligible PRs, **WHEN** F27 opens its review projection, **THEN** it shows stable batch identity, selected/eligible/skipped/ready/attention/stale/published counts, deterministic ordering, and one row for every result or skipped record; opening the projection causes no work.
- **AC-02:** **GIVEN** a result row is selected, **WHEN** the detail view renders, **THEN** it shows the PR reference, source and destination repositories, prHeadBranch, prHeadSha, syncSourceBranch, syncSourceSha, syncMergeBaseSha, merge outcome, source-side and PR-head-side change evidence, complete local/merge diff reference, validation records, canonical worktree reference, current state, and persisted reason/next-action data.
- **AC-03:** **GIVEN** a result uses AI or stopped conflict resolution, **WHEN** its detail view renders, **THEN** it shows the task type, provider, model, reasoning effort when supported, profile revision, execution-policy summary, configured/consumed budget, usage, complete turn reports, deterministic Git/validation observations, and machine-readable stop reason; clean and no-op results explicitly show zero AI turns/tokens.
- **AC-04:** **GIVEN** F26 supplies an ambiguous conflict result, **WHEN** F27 renders it, **THEN** the view identifies affected paths/hunks, source-side and PR-head-side intent/evidence, uncertainty, competing resolution directions when known, the required user question, preserved worktree/evidence, and prior turn reports, and it keeps the result in NEEDS_ATTENTION with no Publish Merge capability.
- **AC-05:** **GIVEN** a result has a dirty, mixed, overlapping, stale, or unknown synchronization worktree, **WHEN** the developer opens Discard or Re-evaluate, **THEN** F27 fetches a fresh F13 WorktreeCondition and shows its fingerprint/revision, dirty summary, attribution/overlap evidence, and permitted actions before any clear, replacement, or deletion.
- **AC-06:** **GIVEN** a dirty worktree must be cleared or replaced, **WHEN** the choice surface opens, **THEN** it offers exactly Clear All Changes, Clear Only AI Changes, and Keep Worktree and Cancel; Clear All requires an explicit destructive confirmation; Keep Worktree and Cancel performs no clear/replacement/publication and leaves the result available.
- **AC-07:** **GIVEN** the developer confirms a clear choice, **WHEN** F27 delegates it to F13, **THEN** F13 re-inspects the same owned worktree; safe Clear All or safely separable Clear Only AI Changes is followed by a fresh safe condition, while overlap/unknown/failed clearing leaves the worktree unchanged and the result attention-required.
- **AC-08:** **GIVEN** Re-evaluate is confirmed after a safe worktree choice, **WHEN** F27 resolves current source/head identities and begins the new attempt, **THEN** it persists a new operation/result identity with fresh source/head SHAs, preserves the original result and worktree history, never silently reuses the old result as current, and keeps the old result non-publishable.
- **AC-09:** **GIVEN** a result is READY_TO_PUBLISH, **WHEN** the developer opens or submits Publish Merge, **THEN** F27 presents an explicit per-result approval naming the exact source/head identities, reviewed merge/diff, validation state, target repository/ref, and publication consequence; confirmation authorizes only that result.
- **AC-10:** **GIVEN** a publication approval is submitted, **WHEN** deterministic preflight runs, **THEN** it re-fetches and verifies that the PR is open and unmerged, source/head repositories and branches are unchanged, current syncSourceSha equals the recorded source SHA, current prHeadSha equals the recorded head SHA, the merge-base/result fingerprint and intended tree are unchanged, the worktree condition is safe, required validation is acceptable, and a non-force update is feasible.
- **AC-11:** **GIVEN** any preflight input is stale, unavailable, malformed, unsafe, unresolved, or inconsistent, **WHEN** F27 evaluates publication, **THEN** it persists a publication-blocking reason before any commit or push, preserves the result/worktree/evidence, and exposes only inspect, Re-evaluate, Discard, or a typed retry permitted by the reason; it never guesses or force pushes.
- **AC-12:** **GIVEN** a current non-no-op result passes preflight and the developer approves it, **WHEN** F27 starts publication, **THEN** it persists the publication lock, exact result/evidence/target snapshot, approval, stable idempotency key, and intended phase before creating a merge commit or pushing.
- **AC-13:** **GIVEN** a current NO_OP result passes preflight and the developer approves it, **WHEN** publication executes, **THEN** it records NO_CODE_CHANGE and a published no-op outcome, creates no empty merge commit, performs no push, and never presents the no-op as a changed merge.
- **AC-14:** **GIVEN** a current non-no-op merge passes preflight, **WHEN** publication executes, **THEN** deterministic Git creates or adopts exactly one merge commit for the reviewed tree and expected parents, pushes it to the recorded head repository/branch with a non-force expected-old-SHA operation, verifies the resulting remote commit SHA, and marks the result PUBLISHED only after that outcome is durable.
- **AC-15:** **GIVEN** a batch contains multiple results, **WHEN** one result is opened, discarded, published, stale, failed, or requires attention, **THEN** only that result's status, evidence, lock, worktree, and next actions change; sibling results remain independently reviewable and the batch counts update without hiding or rewriting them.
- **AC-16:** **GIVEN** the same Publish Merge, approval, discard, re-evaluate, retry, or reconciliation command is replayed with the same identity, **WHEN** F27 evaluates it, **THEN** it returns the existing result or a typed conflict and creates no second publication intent, merge commit, push, clear, worktree, or AI operation.
- **AC-17:** **GIVEN** a local commit or push response may have been lost, **WHEN** F27 recovers, **THEN** it inspects the owned worktree and exact remote head ref; a matching commit/result is adopted, the same safe intent may be retried only when the remote still equals the expected old SHA, and a different or unavailable remote outcome remains UNKNOWN/STALE without force push.
- **AC-18:** **GIVEN** a synchronization publication changes a PR head from oldHeadSha to newHeadSha, **WHEN** the successful outcome is committed, **THEN** F27 emits one durable head-advance invalidation naming the PR and both SHAs, and older Review Bundles prepared against oldHeadSha are marked stale by the owning stale-work service without deleting their history or worktrees.
- **AC-19:** **GIVEN** a synchronization result reaches PUBLISHED, PUBLISHED_WITH_ERRORS is not applicable, or a publication/reconciliation failure occurs, **WHEN** the outcome is projected, **THEN** the UI clearly distinguishes published, no-op published, stale, failed, unknown, and discarded outcomes; synchronization never creates or posts a GitHub response and never grants publication authority to an AI provider.
- **AC-20:** **GIVEN** the result review is used with keyboard navigation, a screen reader, forced colors/high contrast, reduced motion, zoom, a narrow window, or long evidence/diffs, **WHEN** statuses, reasons, questions, dirty choices, approval, and errors are presented, **THEN** labels, focus, announcements, destructive consequences, wrapping, and action availability remain understandable without color, hover, animation, or horizontal overflow; authoritative evidence is paged or explicitly rejected rather than silently truncated.
- **AC-21:** **GIVEN** an IPC command, result identity, path, repository/ref value, provider payload, command, or reason is unknown, oversized, stale, secret-shaped, arbitrary, or unauthorized, **WHEN** it crosses the F27 boundary, **THEN** it is rejected before persistence or side effects with a bounded safe reason and no credential, SDK object, raw command, or arbitrary path is exposed.
- **AC-22:** **GIVEN** the renderer closes or the application restarts before, during, or after result review/publication, **WHEN** F27 rehydrates the batch, result, worktree, publication phase, or head-advance handoff, **THEN** committed records and evidence remain available, no renderer flag authorizes work, and in-flight effects are adopted only when exact deterministic evidence proves the same outcome.
- **AC-23:** **GIVEN** the developer cancels before publication intent commit or chooses Keep Worktree and Cancel, **WHEN** the command completes, **THEN** no publication/clear/replacement effect occurs and the result remains available; cancellation after intent or an uncertain effect preserves the intent and enters a truthful recovery/attention state rather than pretending that nothing happened.

## Functional Requirements

### FR-01: Batch and result review projection

- FR-01.1: F27 SHALL expose a versioned main-process-owned synchronization batch projection containing every selected result, skipped record, stable identity, status, revision, count, and permitted action.
- FR-01.2: The projection SHALL preserve independent per-PR result ordering and identity; selecting, opening, filtering, or refreshing one result SHALL not alter sibling records.
- FR-01.3: The UI SHALL keep synchronization status as an overlay separate from the managed PR's primary review state, automatic-review hold, and Review Bundle history.
- FR-01.4: Opening or refreshing a result SHALL be read-only and SHALL not start Git, validation, AI, worktree mutation, commit, push, response, or publication work.
- FR-01.5: The result detail SHALL expose the complete F25/F26 evidence needed for human review, including exact repositories, branches, SHAs, merge base, change sets, diff, validation, worktree, status, reason, next action, and AI evidence when present.
- FR-01.6: The projection SHALL use bounded, deterministic, provider-neutral fields and SHALL distinguish model-reported information from authoritative Git, validation, persistence, and remote observations.
- FR-01.7: For every SKIPPED, READY_TO_PUBLISH, NEEDS_ATTENTION, STALE, FAILED, UNKNOWN, DISCARDED, or PUBLISHED result, the projection SHALL contain persisted what-happened, why-it-matters, and permitted-next-action data.

### FR-02: Conflict evidence and user consultation

- FR-02.1: When F26 reports ambiguity or required user input, F27 SHALL show the affected paths/hunks, both-side intent/evidence, uncertainty, competing directions, unresolved question, preserved worktree/evidence, and prior turn reports.
- FR-02.2: F27 SHALL keep an ambiguous or unresolved result in NEEDS_ATTENTION and SHALL not expose Publish Merge until a user-directed path produces a newly inspected and validated result.
- FR-02.3: F27 SHALL route answer, direction, manual-edit acknowledgement, Retry Resolution, Re-evaluate, and Discard actions through typed owning-workflow commands and SHALL not implement semantic conflict decisions in the renderer.
- FR-02.4: The result SHALL show the complete bounded AI Work Report and usage/profile/policy metadata when AI was used; clean/no-op results SHALL show zero AI activity.
- FR-02.5: F27 SHALL present deterministic validation/Git evidence as authoritative over provider claims and SHALL distinguish missing, failed, interrupted, not-run, and passed validation.
- FR-02.6: F27 SHALL expose a safe canonical worktree action/reference for inspection, subject to F13 ownership and condition checks; it SHALL never accept an arbitrary renderer path.

### FR-03: Dirty-worktree discard and re-evaluation choices

- FR-03.1: Before Discard or Re-evaluate can clear, replace, or delete a synchronization worktree, F27 SHALL obtain a fresh F13 WorktreeCondition with fingerprint/revision, dirty summary, attribution, overlap, and permitted actions.
- FR-03.2: When changes are present, F27 SHALL present exactly Clear All Changes, Clear Only AI Changes, and Keep Worktree and Cancel; Clear All Changes SHALL require explicit destructive confirmation.
- FR-03.3: F27 SHALL delegate Clear All Changes and Clear Only AI Changes to F13 and SHALL continue only after a fresh post-clear condition proves the requested operation safe.
- FR-03.4: If F13 reports overlap, unknown ownership, path loss, or uncertain clearing, F27 SHALL leave the worktree unchanged, preserve the result, and block replacement/publication with an actionable reason.
- FR-03.5: Keep Worktree and Cancel SHALL perform no clear, replacement, deletion, publication, or automatic retry and SHALL preserve the current result and evidence.
- FR-03.6: A confirmed Discard SHALL persist the result outcome and history without replaying the result's source/head work or silently releasing unrelated Review Bundle holds.
- FR-03.7: A confirmed Re-evaluate SHALL resolve current explicit source/head identities, create a new synchronization operation/result snapshot, and preserve the original result, worktree reference, evidence, and publication history.

### FR-04: Freshness and stale-result handling

- FR-04.1: F27 SHALL obtain current PR openness/merged state and current source/head SHAs from explicit server/repository/ref identities before publication and when a stale/re-evaluate action requires freshness.
- FR-04.2: A proven movement of syncSourceSha or prHeadSha SHALL persist one monotonic STALE transition with expected and observed identities, observation time/revision, and a deterministic reason.
- FR-04.3: An unavailable, malformed, cancelled, or too-old freshness read SHALL never be treated as proof of movement; it SHALL produce a bounded attention/retry reason and block unsafe actions.
- FR-04.4: A STALE result SHALL remain inspectable but SHALL not publish, create a merge commit, or silently refresh its reviewed source/head inputs.
- FR-04.5: A stale result SHALL expose only explicit Re-evaluate, Discard, inspect, and reason-permitted recovery actions; returning to an older remote SHA SHALL not silently clear the stale state.
- FR-04.6: A closed or merged PR, changed repository/ref identity, unavailable merge-result evidence, or inability to prove non-force feasibility SHALL block publication with a deterministic reason.

### FR-05: Per-result approval and publication preflight

- FR-05.1: F27 SHALL require a separate explicit Publish Merge approval for each result; opening a batch confirmation or confirming F24 preparation SHALL never approve publication.
- FR-05.2: Approval SHALL bind the current result/evidence revision, actor/time, exact source/head identities, merge/result fingerprint, validation evidence, worktree condition, target repository/ref, and the complete reviewed diff.
- FR-05.3: F27 SHALL persist a publication lock, approval, intent, stable idempotency key, phase, and effect plan before any merge-commit or remote-ref side effect.
- FR-05.4: Publication preflight SHALL re-fetch and verify PR state, source/head repositories and branches, syncSourceSha, prHeadSha, syncMergeBaseSha/result identity, worktree condition, intended tree/diff, validation, and target/ref safety.
- FR-05.5: The publication target SHALL be the explicit PR head repository and prHeadBranch, and F27 SHALL use only a non-force update with an expected old head SHA.
- FR-05.6: Any stale, changed, unknown, missing, unsafe, failed, or inconsistent preflight input SHALL block before the first publication side effect and preserve the result for inspect/re-evaluate/discard/recovery.
- FR-05.7: F27 SHALL not invoke an AI provider, post a GitHub response, resolve a conversation, approve a review, or gain authority from provider output during publication.

### FR-06: Deterministic merge publication and history

- FR-06.1: An approved NO_OP result SHALL record NO_CODE_CHANGE and a published no-op outcome without creating an empty merge commit or pushing.
- FR-06.2: An approved non-no-op result SHALL create or adopt one merge commit whose parents, tree, target branch, and candidate diff match the reviewed result and fresh preflight.
- FR-06.3: F27 SHALL push a non-no-op merge commit only to the recorded head repository/prHeadBranch with the expected old prHeadSha and without force.
- FR-06.4: F27 SHALL persist publication phases, local/remote commit SHAs, target identities, exact candidate evidence, and deterministic outcome/recovery reasons.
- FR-06.5: F27 SHALL mark a result PUBLISHED only after a no-op or remote merge outcome is durably reconciled; failed, stale, or unknown outcomes SHALL remain visibly non-published.
- FR-06.6: A publication failure or success for one result SHALL not roll back, hide, or authorize publication for any sibling result in the batch.
- FR-06.7: After a successful non-no-op publication, F27 SHALL emit one durable head-advance invalidation naming the PR, previous head SHA, resulting head SHA, and publication identity for the stale-work owner.
- FR-06.8: Synchronization publication SHALL never create or post a GitHub response; response publication remains a separate Review Bundle workflow.

### FR-07: Idempotency, cancellation, and recovery handoff

- FR-07.1: Equal approval, publication, retry, discard, re-evaluate, and reconciliation commands SHALL return the existing result for the same stable identity rather than creating a second effect.
- FR-07.2: Competing publication attempts for one result SHALL be serialized by a durable lock/expected revision and SHALL return a typed conflict.
- FR-07.3: If local merge-commit creation is uncertain, F27 SHALL inspect the owned worktree and expected tree/parents and adopt only a uniquely matching commit; otherwise it SHALL stop in a recovery-required state.
- FR-07.4: If push outcome is uncertain, F27 SHALL fetch the exact target ref and adopt the recorded commit only when the remote identity proves it; it SHALL retry the same non-force intent only when the remote remains at the expected old SHA.
- FR-07.5: F27 SHALL never create a duplicate merge commit, duplicate push, or force push solely because a local phase still says pending.
- FR-07.6: Renderer closure and process restart SHALL preserve committed result, worktree, approval, lock, phase, effect, and invalidation records; renderer memory SHALL not authorize or cancel publication.
- FR-07.7: Cancellation before intent commit SHALL create no publication effect; cancellation after intent or an uncertain effect SHALL preserve the intent and require deterministic reconciliation.

### FR-08: Boundary, accessibility, and platform behavior

- FR-08.1: F27 SHALL validate all IPC commands, revisions, identities, paths, bounded text, status transitions, and action capabilities before persistence or downstream calls.
- FR-08.2: F27 SHALL keep credentials, authorization headers, provider SDK objects, raw provider payloads, arbitrary commands, uncontrolled environment values, and arbitrary filesystem paths out of renderer state, durable result projections, prompts, and publication records.
- FR-08.3: The review and publication surfaces SHALL be keyboard accessible, screen-reader understandable, usable in forced colors/high contrast, reduced motion, zoom, and narrow windows, and SHALL not rely on color or horizontal overflow.
- FR-08.4: F27 SHALL preserve one safe synchronization overlay per PR and SHALL not mutate the primary review state, automatic-review hold, or historical Review Bundle merely because a result is opened, refreshed, or published.

## Non-Functional Requirements

- **NFR-01: Evidence fidelity** - The result review surface SHALL show complete bounded evidence from F25/F26/F13/F14 without replacing authoritative records with status labels, logs, or provider prose.
- **NFR-02: Explainability** - Every actionable result SHALL explain what happened, why it matters, what evidence is preserved, and the next permitted action.
- **NFR-03: Reliability and restart safety** - Committed review, action, publication, effect, and invalidation records SHALL survive renderer destruction, process restart, and uncertain local/remote outcomes.
- **NFR-04: Batch isolation** - A large or slow batch SHALL remain independently addressable and bounded; one result's failure or latency SHALL not starve or rewrite another result.
- **NFR-05: Accessibility** - Result states, ambiguous questions, dirty-worktree choices, publication approval, stale reasons, and recovery actions SHALL remain understandable and operable without color, hover, animation, or a mouse.
- **NFR-06: Security and least privilege** - F27 SHALL fail closed at typed boundaries and SHALL never expose publication credentials or force-push capability to the renderer or AI provider.
- **NFR-07: Windows desktop behavior** - The review surface and deep-link target SHALL behave correctly when the Electron window is recreated on the current Windows virtual desktop, subject to F04/F19 platform capabilities.

## Invariants

- **INV-01:** Synchronization status is an overlay and never a competing primary PR state machine.
- **INV-02:** Each synchronization result has independent identity, evidence, worktree, lock, status, and publication outcome.
- **INV-03:** No synchronization merge is committed or pushed without explicit per-result human approval.
- **INV-04:** Publication uses only the explicit source/head repositories and branches captured by the result; default-branch or same-named-ref substitution is forbidden.
- **INV-05:** Movement of either recorded source or PR-head SHA makes the result non-publishable until explicit Re-evaluate or Discard.
- **INV-06:** Synchronization publication never uses force push and never posts a GitHub response.
- **INV-07:** Durable publication intent and idempotency identity are persisted before any merge-commit or remote-ref effect.
- **INV-08:** Unknown local or remote outcomes are reconciled from exact deterministic evidence before retry; pending text is not proof of no effect.
- **INV-09:** Clean/no-op publication never invokes AI; an AI provider cannot grant publication authority or validation success.
- **INV-10:** A NO_OP result never creates an empty merge commit or push and remains distinct from a changed merge.
- **INV-11:** An ambiguous or unresolved semantic conflict cannot become READY_TO_PUBLISH or be published.
- **INV-12:** Successful synchronization publication preserves historical Review Bundles and marks those prepared against the previous PR head stale through the owning stale-work contract.
- **INV-13:** Dirty, overlapping, or unknown worktree changes are never silently cleared, replaced, or published.

## Out of Scope

- Batch-level publication or a single approval that publishes multiple PRs.
- Automatic branch synchronization, automatic rebase, automatic stale refresh, or force push.
- Semantic conflict analysis or AI turn execution; those are owned by F26 and the shared AI work contracts.
- Review Bundle code/response publication; that remains owned by F23.
- GitHub review replies, conversation resolution, review approval, or merge-button automation.
- Per-hunk acceptance or reconstruction of a partial merge patch.
- Cross-machine synchronization and full startup/sleep/network recovery beyond F27's durable effect reconciliation; F28 owns the cross-feature recovery gate.

## Product Decisions

- **PD-01: Publish one result at a time** - The batch is a review container, not a publication authorization. Each PR requires its own explicit Publish Merge approval so one outcome cannot hide another.
- **PD-02: Treat no-op publication as an explicit no-code outcome** - A current NO_OP result may be approved and finalized as published with NO_CODE_CHANGE, but it never creates an empty commit or push and remains visibly different from a changed merge.
- **PD-03: Revalidate both sides immediately before publication** - A source-branch movement is as significant as a PR-head movement; neither may be silently refreshed into a different reviewed merge.
- **PD-04: Staleness is monotonic** - Once movement is proven, the reviewed result remains stale until the user explicitly re-evaluates or discards it, even if a later read happens to return the older SHA.
- **PD-05: Re-evaluation creates a new result** - Re-evaluation uses fresh identities and evidence while preserving the original result, worktree, publication history, and reason.
- **PD-06: Sibling outcomes are isolated** - A failed, stale, discarded, or published result never changes another PR's synchronization result or publication capability.
- **PD-07: Synchronization has no response plan** - Branch synchronization publishes only the reviewed merge; it does not infer or post a GitHub response.
- **PD-08: Ambiguity remains a user question** - A competing-intent conflict is reviewable evidence, not a successful merge; only a newly inspected and validated user-directed result can become publishable.
- **PD-09: Head advancement invalidates older review work** - A successful merge publication emits an exact old/new head invalidation, and the existing stale-work owner marks matching Review Bundles stale without deleting them.

## Implementation Decisions

- **IMP-01: Project immutable evidence, do not rebuild it in the renderer** - F27 consumes the versioned F25/F26/F13/F14 records and exposes one bounded review projection.
- **IMP-02: Reuse the F13 WorktreeCondition and F24 identity resolver** - Dirty choices and current source/head identities come from shared deterministic contracts; F27 does not create a second Git truth model.
- **IMP-03: Use a synchronization-specific publication aggregate** - F27 mirrors F23's persist-before-effect and reconciliation semantics but stores merge publication phases and no response rows.
- **IMP-04: Verify merge identity as well as branch SHAs** - Preflight compares the reviewed merge-base, expected parents/tree, candidate diff fingerprint, worktree condition, and validation evidence before allowing a commit or push.
- **IMP-05: Emit stale invalidation as a typed event** - F27 supplies exact prior/new head identities to the owner of Review Bundle stale transitions instead of mutating Review Bundle records directly.
- **IMP-06: Keep batch review read-only until a result action is chosen** - Navigation, filtering, notification activation, and evidence refresh cannot start work or authorize publication.

## Testing Decisions

- **TST-01:** Use temporary repositories and fake GitHub/OS/provider/validation ports for same-repository, fork, no-op, clean-merge, AI-resolved conflict, ambiguous conflict, stale-source, stale-head, closed-PR, and non-force-rejected cases.
- **TST-02:** Test the batch projection with zero, one, mixed, slow, failed, stale, ambiguous, and 250-result fixtures and assert sibling identity/evidence isolation.
- **TST-03:** Test every dirty-worktree choice with tracked, staged, untracked, binary, rename/delete, ignored, mixed, overlapping, and unknown changes; prove developer-clone preservation.
- **TST-04:** Fault-inject before/after publication intent, lock, local commit, push, remote verification, invalidation, and restart; prove no duplicate commit/push and no false success.
- **TST-05:** Verify no-op publication creates no commit or push and no clean/no-op path reaches an AI provider or response operation.
- **TST-06:** Verify ambiguity questions, turn reports, validation status, stale reasons, exact SHAs, and publication actions remain accessible and bounded in supported Windows layouts.
- **TST-07:** Scan renderer/AI/publication boundaries for credentials, SDK objects, arbitrary paths/commands, force options, raw provider payloads, and publication capability leaks.

## Proposed Modules

- **MOD-01: Synchronization Batch Projection** - Builds the versioned batch summary, counts, stable result navigation, and overlay-safe action capabilities.
- **MOD-02: Synchronization Result Evidence Projector** - Presents exact identities, merge/diff/validation/worktree evidence, AI reports, reasons, and next actions.
- **MOD-03: Conflict Consultation Presenter** - Projects F26 competing intents, questions, directions, preserved evidence, and typed user actions without deciding semantics.
- **MOD-04: Dirty Worktree Action Coordinator** - Obtains F13 conditions, presents the three choices, delegates safe clearing, and gates discard/re-evaluation.
- **MOD-05: Synchronization Freshness Gate** - Performs exact source/head/PR-state reads and persists monotonic stale or unavailable evidence.
- **MOD-06: Synchronization Publication Coordinator** - Owns per-result approval, preflight, lock, merge commit/no-op, non-force push, and effect reconciliation.
- **MOD-07: Head-Advance Invalidation Handoff** - Persists and emits the old/new head event consumed by the stale-work owner.
- **MOD-08: Accessible Result and Publication Surface** - Renders status/reason/evidence/action distinctions and safe recovery affordances for supported Windows layouts.

## Workflows

### Workflow 1: Review a mixed synchronization batch

~~~
1. F25 commits a batch containing skipped, ready, attention, and failed results.
2. The developer opens the batch from the inbox or notification.
3. F27 renders one independent row per result and deterministic counts.
4. The developer opens a result and inspects identities, diff, validation, worktree, and AI evidence.
5. The developer chooses a result-specific action; opening and navigation alone have no side effect.
~~~

### Workflow 2: Resolve attention or dirty-worktree state

~~~
1. The developer opens an ambiguous, stale, or attention result.
2. F27 shows the persisted reason, evidence, competing intents or moved SHA, and next actions.
3. For Discard or Re-evaluate, F27 obtains a fresh WorktreeCondition.
4. If dirty, the developer chooses Clear All Changes, Clear Only AI Changes, or Keep Worktree and Cancel.
5. F13 performs only the confirmed safe clear; overlap or uncertainty preserves the worktree.
6. Re-evaluate creates a new result from current explicit source/head identities; Discard preserves history and ends the result.
~~~

### Workflow 3: Publish a current merge or no-op

~~~
1. The developer selects one READY_TO_PUBLISH result and chooses Publish Merge.
2. F27 records the per-result approval and runs fresh exact preflight.
3. If NO_OP, F27 persists NO_CODE_CHANGE and a published no-op outcome without commit or push.
4. Otherwise F27 persists the publication phase, creates or adopts the exact merge commit, and pushes it non-force to the recorded head ref.
5. F27 verifies the remote commit, persists PUBLISHED, and emits one old/new head invalidation.
6. A sibling result remains independently reviewable regardless of this outcome.
~~~

### Workflow 4: Recover an uncertain publication

~~~
1. A crash or network loss occurs around local commit or non-force push.
2. On retry or restart, F27 reads the existing publication identity and exact target.
3. It inspects the owned worktree and remote head ref.
4. A unique matching effect is adopted; a remote still at the expected old SHA may retry the same intent.
5. A divergent or unavailable outcome remains UNKNOWN/STALE and blocks forceful or duplicate action.
~~~

## Requirement Traceability

| Requirement family | Observable coverage | Named contract tests |
|---|---|---|
| FR-01 | AC-01-AC-04, AC-15, AC-19-AC-22 | CT-F27-01, CT-F27-02, CT-F27-09 |
| FR-02 | AC-03-AC-04, AC-15, AC-19-AC-21 | CT-F27-03, CT-F27-09 |
| FR-03 | AC-05-AC-08, AC-20, AC-23 | CT-F27-04, CT-F27-09 |
| FR-04 | AC-08, AC-10-AC-11, AC-14, AC-17 | CT-F27-05, CT-F27-09 |
| FR-05 | AC-09-AC-12, AC-20-AC-21 | CT-F27-06, CT-F27-09 |
| FR-06 | AC-11-AC-15, AC-18-AC-19 | CT-F27-07, CT-F27-09 |
| FR-07 | AC-16-AC-18, AC-22-AC-23 | CT-F27-08, CT-F27-09 |
| FR-08 | AC-01-AC-06, AC-20-AC-23 | CT-F27-01, CT-F27-04, CT-F27-09 |
| NFR-01-NFR-07 | AC-01-AC-23 | CT-F27-01-CT-F27-09 |
| INV-01-INV-13 | AC-01-AC-23 | CT-F27-01-CT-F27-09 |
