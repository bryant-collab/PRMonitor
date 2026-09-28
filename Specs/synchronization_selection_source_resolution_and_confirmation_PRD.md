# F24 Synchronization Selection, Source Resolution, and Confirmation - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F06 - GitHub REST client and remote identity model | Provides typed, authenticated PR-state and exact branch-ref reads scoped to an explicit server and repository. |
| 2 | F07 - Add and manage a pull request | Provides the managed-PR identity, base/head repository and branch fields, immutable configuration revision, and optional `syncSourceBranchOverride`. |
| 3 | F08 - Managed-PR inbox and primary review-state presentation | Provides the authoritative managed-PR inbox projection, card identity, primary-state presentation, and reserved synchronization-selection surface. |
| 4 | F13 - Operation-owned Git worktrees and change attribution | Provides the typed synchronization-preparation readiness and operation identity boundary consumed before downstream worktree creation. |
| 5 | F16 - AI preferences, task-profile snapshots, execution policies, and Common Instructions | Provides the current synchronization-relevant configuration revision and the downstream handoff for conflict-resolution settings; F24 does not invoke an AI provider. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F25 - Independent deterministic synchronization and clean-merge results | Consumes F24's confirmed eligible PR inputs and preparation-only authorization to create worktrees and attempt deterministic merges. |
| 2 | F26 - AI-assisted merge-conflict resolution | Consumes the exact source/head identities and immutable operation context when F25 finds a real conflict. |
| 3 | F27 - Synchronization result review, staleness, and publication | Presents each result and owns stale checks, explicit **Publish Merge**, discard, and publication outcomes. |
| 4 | F28-F30 - Recovery, security, and release readiness | Reconcile interrupted handoffs, harden the trust boundary, and verify the complete Windows workflow. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-03 | FR-01.1-FR-01.8, FR-05.1-FR-05.4, INV-01, INV-11 | AC-01-AC-04, AC-16-AC-18 | Shared: F08 owns the complete managed-PR inbox and primary-state projection; F24 owns branch-synchronization selection, selected counts, and the preparation command. |
| APP-AC-17 | FR-04.4-FR-04.8, NFR-02, INV-01, INV-06 | AC-13-AC-15, AC-18-AC-19 | Shared: F04 owns renderer/process lifetime; F24 makes a confirmed preparation handoff durable and recoverable, while F25-F28 own continued operation recovery. |
| APP-AC-43 | FR-01.1-FR-01.8, FR-05.1-FR-05.4, INV-01, INV-11 | AC-01-AC-04, AC-16-AC-18 | Primary: F24 owns individual selection, clear, select-all, selected-count, and no-side-effect selection behavior. |
| APP-AC-44 | FR-02.1-FR-02.8, FR-03.1-FR-03.7, FR-07.1-FR-07.4, INV-02-INV-04 | AC-05-AC-10, AC-15-AC-17 | Primary: F24 owns effective source precedence, explicit source/destination repository identity, fork-safe ref resolution, and default-branch non-substitution. |
| APP-AC-45 | FR-03.1-FR-03.7, FR-04.1-FR-04.8, FR-05.1-FR-05.4, INV-05-INV-08 | AC-08-AC-15, AC-18-AC-19 | Primary: F24 owns eligibility reasons, exact SHA presentation, confirmation summary, and preparation-only authorization. |
| APP-AC-53 | FR-05.1-FR-05.6, NFR-03, INV-06-INV-08 | AC-13, AC-18-AC-19 | Shared: F24 owns idempotent confirmation and preparation handoff; F25-F27 own idempotency for merge, result, and publication effects. |

### Explicit coverage boundaries

F24 owns the user-directed selection session, effective synchronization-source
resolution, current remote identity/SHA observation, per-PR eligibility, and
the durable confirmation that authorizes preparation. It is the only feature
that decides what the selected synchronization batch means before preparation
starts.

F08 remains authoritative for the complete inbox projection, primary review
state, ordering, and the visual synchronization-overlay slot. F06 remains the
only GitHub REST boundary. F07 remains authoritative for the managed-PR
configuration revision and the stored optional branch override. F13 owns the
operation worktree and Git preparation boundary. F16 owns preference and AI
configuration resolution; F24 may carry a configuration revision/readiness
reference but never invokes an AI provider.

F24 does not claim APP-AC-46 through APP-AC-52. APP-AC-53 is shared only for
F24's replay-safe confirmation/handoff; F25-F27 own idempotency for merge,
retry, push, and publication effects. F25 owns independent worktree
processing, merges, no-op results, validation, and synchronization-result
records; F26 owns semantic conflict resolution; F27 owns result review,
staleness, publication approval, non-force push, and publication recovery.
F24 does not create a worktree, run a merge or validation command, spend AI
tokens, commit, push, post a response, or publish anything.

### Linter review disposition

The coverage linter may return `needs-review` for criteria whose wording spans
the F24 preparation boundary and a different owning feature. The intended
dispositions are:

- **APP-AC-03:** Shared only for the inbox selection action. F08 owns the complete multi-PR watching projection; F10-F12 own polling, event eligibility, and scheduling.
- **APP-AC-06, APP-AC-13, APP-AC-15, and APP-AC-16:** Not applicable to F24. F10-F18 own polling, validation, notifications, review bundles, and review holds; F24 only preserves their state while preparing a user-directed synchronization handoff.
- **APP-AC-17:** Shared only for a confirmed preparation intent surviving renderer closure. F04/F28 own application and background-work lifecycle; F24 does not own watcher or AI-job continuation.
- **APP-AC-19, APP-AC-20, and APP-AC-30:** Not applicable to F24. F04/F19 own tray/window recreation, virtual-desktop behavior, and application shutdown.
- **APP-AC-26:** Not applicable to F24. F27 owns stale synchronization-result detection and publication blocking; F24 only rejects a stale confirmation summary before handoff.
- **APP-AC-47 and APP-AC-49:** Not applicable to F24. F25 owns clean/no-op merge behavior and F25-F27 own complete synchronization-result persistence and review.
- **APP-AC-50 and APP-AC-51:** Not applicable to F24. F27 owns explicit publication approval, exact pre-push revalidation, stale-result handling, and no-force push.
- **APP-AC-53:** Shared. F24 owns replay-safe confirmation and handoff; F25-F27 own idempotent merge, retry, push, and publication effects.
- **APP-AC-62:** Not applicable to F24. F26/F27 own AI-usage presentation on synchronization results; F24 carries only a bounded F16 configuration reference.

These dispositions do not claim completion of downstream merge, conflict,
result, or publication criteria; they make the ownership boundary explicit for
human review.

## Executive Summary

Branch synchronization is useful only when the developer can see exactly what
will be merged before preparation begins. Without a dedicated selection and
resolution step, a multi-PR action can silently omit a PR, select a same-named
branch from the wrong repository, use the repository's default branch instead
of the PR's explicit base branch, or prepare work from stale remote data.

F24 adds a deliberate synchronization entry point to the managed-PR inbox. The
developer can select individual PRs, clear the selection, or select all managed
PRs. PRMonitor resolves each selected PR's effective source branch using the
configured override or the PR's explicit `base.ref`, resolves the destination
from `head.ref`, reads the current source and head SHAs from their explicit
repositories, and classifies every selected PR as eligible or ineligible with
a plain-language reason.

The confirmation summary shows the selected count, eligible and ineligible
counts, source provenance, repositories, branches, and exact SHAs. Confirming
authorizes only downstream preparation. It never authorizes a merge commit,
push, GitHub response, or publication. If the remote state or PR configuration
changes before confirmation, the summary is invalidated and must be resolved
again rather than silently changing the operation's meaning.

## User Stories

### Select PRs deliberately

- **US-01:** **GIVEN** the inbox contains managed PRs, **WHEN** the developer selects one or more cards, **THEN** the toolbar shows the exact selected count and exposes a synchronization action without changing any PR's primary review state.
  - **Acceptance Criteria:** AC-01-AC-04, AC-16.
- **US-02:** **GIVEN** a non-empty selection, **WHEN** the developer chooses **Clear selection** or closes the selection surface before confirmation, **THEN** the selection is removed with no worktree, Git, AI, validation, or publication effect.
  - **Acceptance Criteria:** AC-02-AC-04, AC-11, AC-16.
- **US-03:** **GIVEN** the developer chooses **Select all managed PRs**, **WHEN** the selection is built from the authoritative inbox snapshot, **THEN** every managed PR in that snapshot is represented in the later eligibility summary, including PRs that cannot be prepared.
  - **Acceptance Criteria:** AC-03, AC-08, AC-16.

### Understand exact synchronization identities

- **US-04:** **GIVEN** a selected PR has a blank or non-blank synchronization override, **WHEN** F24 resolves it, **THEN** the developer sees whether the source came from `syncSourceBranchOverride` or `prBaseBranch`, and the repository default branch is never substituted.
  - **Acceptance Criteria:** AC-05-AC-07, AC-15.
- **US-05:** **GIVEN** a selected PR may use forked repositories, **WHEN** F24 resolves its source and destination, **THEN** the summary identifies the source repository and destination/head repository separately and rejects missing, ambiguous, or same-named-but-wrong-repository refs.
  - **Acceptance Criteria:** AC-06-AC-07, AC-15, AC-17.
- **US-06:** **GIVEN** exact branch refs can be observed, **WHEN** resolution completes, **THEN** the developer sees the current `syncSourceSha` and `prHeadSha` alongside the branch and repository identities that produced them.
  - **Acceptance Criteria:** AC-08-AC-10.

### Confirm safe preparation

- **US-07:** **GIVEN** a mixed selection contains eligible and ineligible PRs, **WHEN** the developer opens the confirmation, **THEN** every selected PR appears with an eligibility result, actionable reason, and exact source/head details; no PR is silently dropped.
  - **Acceptance Criteria:** AC-08-AC-10, AC-12.
- **US-08:** **GIVEN** the summary is current and at least one PR is eligible, **WHEN** the developer confirms synchronization preparation, **THEN** F24 records the exact selection and remote snapshots and authorizes F25 to prepare only those eligible PRs.
  - **Acceptance Criteria:** AC-12-AC-15, AC-18.
- **US-09:** **GIVEN** the developer confirms preparation, **WHEN** any later feature presents a merge result, **THEN** the user still must make a separate explicit publication decision for that result.
  - **Acceptance Criteria:** AC-14, AC-19.

### Recover without ambiguity

- **US-10:** **GIVEN** the remote ref, PR state, or managed-PR configuration changes after a summary is produced, **WHEN** the developer tries to confirm it, **THEN** F24 refuses the stale summary, preserves the prior evidence, and asks the developer to resolve a new current summary.
  - **Acceptance Criteria:** AC-11-AC-13, AC-17.
- **US-11:** **GIVEN** the renderer closes or the application restarts after confirmation, **WHEN** PRMonitor resumes, **THEN** the confirmed preparation intent can be read from the main process/persistence boundary without creating a duplicate handoff or relying on renderer memory.
  - **Acceptance Criteria:** AC-13-AC-15, AC-18-AC-19.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** the authoritative inbox contains managed PRs, **WHEN** it renders the synchronization surface, **THEN** every managed PR has an accessible individual selection control, the toolbar shows the selected count, and the synchronization command is disabled when the selection is empty.
- **AC-02:** **GIVEN** one or more PRs are selected, **WHEN** the developer toggles an individual selection, clears the selection, or cancels the selection surface, **THEN** only the selection projection changes and no GitHub write, Git mutation, validation, AI invocation, worktree mutation, hold release, or publication begins.
- **AC-03:** **GIVEN** the developer chooses **Select all managed PRs**, **WHEN** F24 applies the command to an inbox projection revision, **THEN** every managed-PR identity in that revision is selected exactly once; ineligible records are not silently filtered out before the eligibility summary.
- **AC-04:** **GIVEN** the primary review state includes `WATCHING`, `WORKING`, `READY_FOR_REVIEW`, or `NEEDS_ATTENTION`, **WHEN** the developer selects or clears PRs, **THEN** the primary state, reason, automatic-review hold, and review history remain unchanged; synchronization selection is a separate action/overlay.
- **AC-05:** **GIVEN** a managed PR has a non-empty `syncSourceBranchOverride`, **WHEN** F24 resolves its effective source branch, **THEN** it uses that override; otherwise it uses the PR's explicit `prBaseBranch` (`base.ref`). The repository API's `default_branch` is retained only as informational metadata and is never used as a fallback.
- **AC-06:** **GIVEN** F24 resolves a selected PR, **WHEN** it builds the source and destination identities, **THEN** the source is an explicit server/repository/branch identity in the PR base repository, the destination is the explicit server/head-repository/`prHeadBranch` identity, and the summary shows both repositories and both branches.
- **AC-07:** **GIVEN** a source or destination repository/ref is missing, inaccessible, ambiguous, deleted, malformed, or only available under a same-named identity in another repository, **WHEN** F24 classifies the PR, **THEN** it marks that PR not eligible for this batch with a bounded reason and next action; it never guesses a repository, branch, or default.
- **AC-08:** **GIVEN** a selected PR has valid explicit identities, **WHEN** F24 performs current remote resolution, **THEN** F06 reads the current source ref and destination/head ref independently and returns `syncSourceSha` and `prHeadSha` scoped to those exact repositories and branch names.
- **AC-09:** **GIVEN** the current PR state is closed or merged, a source/head ref cannot be fetched, a metadata/ref identity disagrees, F13 rejects preparation readiness, or another typed prerequisite is unavailable, **WHEN** F24 evaluates the selected PR, **THEN** it records `ineligible` with a stable reason category, bounded explanation, and permitted next action; one ineligible PR does not hide or cancel other selected PRs.
- **AC-10:** **GIVEN** a selected PR has a current open state, valid configuration revision, explicit source/destination identities, current source/head SHAs, and F13 preparation readiness, **WHEN** eligibility completes, **THEN** it is shown as `eligible` with its source provenance, repositories, branches, exact SHAs, and the revision used to produce the result.
- **AC-11:** **GIVEN** the selected inbox projection, managed-PR configuration revision, or remote identity/SHA snapshot changes after a summary is produced, **WHEN** the developer confirms the old summary, **THEN** F24 rejects the stale command before F25 handoff, preserves the old summary as history, and requires a fresh deterministic resolution; it never refreshes silently.
- **AC-12:** **GIVEN** a selection contains eligible and ineligible PRs, **WHEN** the confirmation summary opens, **THEN** it shows the total selected count, eligible count, ineligible count, every selected PR, each source provenance, source/destination repository, source/destination branch, `syncSourceSha`, `prHeadSha`, reason, and next action; a disabled or excluded PR is never silently omitted.
- **AC-13:** **GIVEN** at least one eligible PR is present and the summary revision is current, **WHEN** the developer chooses **Confirm preparation**, **THEN** F24 persists a preparation intent containing the selection, eligible/ineligible classifications, explicit identities, exact SHAs, configuration/projection revisions, F13 readiness evidence, correlation identity, and stable idempotency key before handing the eligible inputs to F25.
- **AC-14:** **GIVEN** the developer confirms a synchronization batch, **WHEN** the confirmation is accepted, **THEN** the resulting authorization says preparation only and grants no commit, push, response, merge-publication, GitHub-conversation, or AI-provider authority; later F27 publication requires a separate per-result human approval.
- **AC-15:** **GIVEN** no PR is eligible, the developer cancels, the summary is closed, or a required remote/configuration read fails before confirmation, **WHEN** F24 finalizes the interaction, **THEN** no F25 preparation authorization or empty synchronization batch is created and the summary remains available with an actionable retry/cancel reason.
- **AC-16:** **GIVEN** a keyboard-only, screen-reader, forced-colors, reduced-motion, zoomed, or narrow-window user operates selection and confirmation, **WHEN** controls, counts, eligibility changes, errors, or confirmation actions are presented, **THEN** labels, focus, status announcements, group relationships, destructive/prepare-only wording, and wrapping remain usable without color, hover, animation, or horizontal scrolling.
- **AC-17:** **GIVEN** a caller supplies an unknown, oversized, raw URL, credential-shaped value, provider object, arbitrary path, shell command, or stale renderer revision, **WHEN** it crosses the F24 boundary, **THEN** the request is rejected before persistence or downstream handoff with a bounded safe reason and no secret or privileged capability is exposed.
- **AC-18:** **GIVEN** the same valid confirmation command or preparation intent is replayed after renderer closure, process restart, or an uncertain local handoff, **WHEN** F24 reconciles it, **THEN** it returns the existing durable intent or a typed recovery state and does not create a duplicate preparation authorization, batch, worktree request, AI operation, or external mutation.
- **AC-19:** **GIVEN** a renderer is destroyed or the application restarts after F24 has committed a preparation intent, **WHEN** the new renderer requests synchronization state, **THEN** it receives the authoritative persisted intent and its bounded eligible/ineligible summary without releasing review holds, changing primary PR state, or relying on the old renderer.

## Functional Requirements

### FR-01: Selection session and inbox integration

- FR-01.1: F24 SHALL expose a main-process-owned synchronization selection projection over the current F08 managed-PR identity set and inbox projection revision.
- FR-01.2: The synchronization surface SHALL provide accessible individual selection controls, **Clear selection**, **Select all managed PRs**, and a selected-count indicator.
- FR-01.3: Individual selection, clearing, and select-all SHALL be deterministic, idempotent, and scoped to stable managed-PR identities rather than card position or renderer-local indexes.
- FR-01.4: Select-all SHALL select every managed-PR identity in the accepted inbox projection, including identities that may later be classified ineligible; F24 SHALL not silently pre-filter the selection.
- FR-01.5: The synchronization command SHALL be unavailable for an empty selection and SHALL expose a singular/plural label appropriate to the selected count without changing the underlying operation contract.
- FR-01.6: Selection and summary viewing SHALL not mutate primary review state, release a review hold, alter review history, or create a synchronization overlay that claims preparation has started.
- FR-01.7: Selection state before confirmation MAY be discarded when its renderer/session closes; discarding it SHALL have no product side effect. Only a confirmed preparation intent is durable F24 work.
- FR-01.8: F24 SHALL accept renderer selection requests only through validated managed-PR identities and an expected inbox projection revision; it SHALL reject stale or unknown identities.

### FR-02: Effective source and destination resolution

- FR-02.1: F24 SHALL resolve the effective `syncSourceBranch` using the ordered precedence `syncSourceBranchOverride` when non-empty, otherwise the PR's explicit `prBaseBranch` (`base.ref`).
- FR-02.2: F24 SHALL resolve the destination as the PR's explicit `prHeadBranch` (`head.ref`) and SHALL never use a repository default branch as a destination or source fallback.
- FR-02.3: F24 SHALL resolve the source repository explicitly from the PR base repository identity and the destination repository explicitly from the PR head repository identity; a branch name alone SHALL never identify either side.
- FR-02.4: For fork-based PRs, F24 SHALL keep base and head repositories distinct and SHALL mark the PR not eligible when either identity is missing, inaccessible, ambiguous, or unsupported rather than selecting a same-named ref elsewhere.
- FR-02.5: F24 SHALL preserve source provenance as `OVERRIDE` or `PR_BASE_BRANCH` and SHALL expose the provenance beside the effective branch name in the summary.
- FR-02.6: F24 SHALL consume F07's immutable managed-PR configuration revision and SHALL not accept a raw branch override or silently reread a newer revision during confirmation.
- FR-02.7: F24 SHALL use F06's typed exact-ref and current-PR-state operations for remote resolution and SHALL not construct arbitrary GitHub URLs, request paths, or provider-specific objects.
- FR-02.8: F24 SHALL preserve the explicit server identity, repository identities, branch names, and metadata/default-branch distinction in every resolved input passed downstream.

### FR-03: Current remote observation and eligibility

- FR-03.1: F24 SHALL obtain the current PR state and current source/destination branch refs through separate typed observations scoped to the resolved repositories and branch names.
- FR-03.2: A successful resolution SHALL include the current `syncSourceSha` and `prHeadSha`, the exact identities used to obtain them, the observation revision/time, and any safe F06 correlation metadata needed for later reconciliation.
- FR-03.3: F24 SHALL compare the current observations with the managed-PR metadata/configuration revision and SHALL classify an identity or SHA disagreement as not eligible for the current batch rather than choosing one value silently.
- FR-03.4: A PR SHALL be eligible only when it is open and not merged, has a valid current configuration revision, has explicit source/destination identities, both exact refs are available, and F13 reports that preparation can be accepted for the declared operation identity.
- FR-03.5: F24 SHALL classify every selected PR exactly once per resolution revision as `ELIGIBLE` or `INELIGIBLE` with a stable reason category, bounded explanation, retryability, and permitted next action.
- FR-03.6: Ineligibility SHALL be per PR. A closed PR, unavailable ref, network/authentication result, active-operation conflict, or F13 readiness failure SHALL not cancel or hide other selected PR classifications.
- FR-03.7: F24 SHALL not invoke an AI provider, run validation, create a worktree, perform a Git merge, commit, push, post a response, or publish while resolving eligibility; read-only F06 observations are the only remote effects allowed in this phase.

### FR-04: Confirmation and preparation-only authorization

- FR-04.1: F24 SHALL present a confirmation summary containing the total selected count, eligible/ineligible counts, every selected PR, source provenance, source/destination repositories, source/destination branches, `syncSourceSha`, `prHeadSha`, eligibility reason, and next action.
- FR-04.2: F24 SHALL require an explicit, accessible **Confirm preparation** action when at least one eligible PR exists and SHALL make the preparation-only boundary visible before the action is submitted.
- FR-04.3: F24 SHALL refuse confirmation when no PR is eligible, the summary revision is stale, required evidence is unavailable, or the managed-PR identity/configuration has changed since resolution.
- FR-04.4: Before F25 preparation begins, F24 SHALL persist a preparation intent containing the complete selection snapshot, per-PR classification, exact source/destination identities, exact SHAs, source provenance, configuration/inbox revisions, F13 readiness evidence, F16 configuration revision/reference when supplied, actor/time, correlation identity, and stable idempotency key.
- FR-04.5: F24 SHALL emit a typed `SynchronizationPreparationAuthorization` containing only the persisted eligible inputs and a reference to the ineligible records; it SHALL not pass arbitrary paths, URLs, commands, credentials, provider objects, or publication capabilities downstream.
- FR-04.6: Confirmation SHALL authorize only preparation and review of synchronization results. It SHALL never imply approval to commit, push, post a GitHub response, resolve a GitHub conversation, approve a pull request, or publish a merge.
- FR-04.7: Each ineligible PR SHALL remain visible in the confirmed summary as skipped/not included with its reason; F24 SHALL not silently turn an ineligible PR into an eligible one during handoff.
- FR-04.8: F24 SHALL preserve the summary and intent history when confirmation is cancelled, refused, or fails after persistence, and SHALL expose a typed retry/reconcile action rather than creating an untracked partial batch.

### FR-05: Lifecycle, idempotency, and downstream coordination

- FR-05.1: The main process and F03 persistence boundary SHALL be authoritative for confirmed F24 intent, selection/eligibility revisions, handoff status, and recovery reasons; renderer memory SHALL not be authoritative.
- FR-05.2: Replaying the same valid confirmation identity SHALL return the existing preparation intent or its current handoff result and SHALL not create a duplicate F25 authorization or batch.
- FR-05.3: A competing confirmation for the same PR and current synchronization scope SHALL receive a typed conflict or existing-operation result; it SHALL not overwrite another intent or reuse its idempotency key.
- FR-05.4: Renderer closure, window recreation, process restart, cancellation before confirmation, and read-only refresh SHALL not release a review hold, alter primary PR state, mutate a worktree, reset an AI budget, or publish anything.
- FR-05.5: After a confirmed intent is committed, F24 SHALL expose its handoff status and exact input summary after renderer recreation or restart; F25/F28 SHALL own continued preparation/recovery after the typed authorization is accepted.
- FR-05.6: F24 SHALL preserve immutable source/head/configuration snapshots used by the confirmed intent even if the current managed-PR configuration or remote refs later change.

### FR-06: Read model, accessibility, and trust boundary

- FR-06.1: F24 SHALL expose provider-neutral, schema-validated projections for selection, resolution, eligibility, confirmation, ineligibility, cancellation, and permitted next actions.
- FR-06.2: Every user-actionable reason SHALL state what happened, why it matters, and what the developer can do next; status labels alone SHALL not be treated as an explanation.
- FR-06.3: Selection and confirmation controls SHALL provide programmatic names, descriptions, focus/error behavior, keyboard navigation, screen-reader status updates, forced-colors/high-contrast support, reduced-motion behavior, bounded wrapping, and no horizontal overflow on the supported Windows desktop path.
- FR-06.4: F24 SHALL reject credentials, authorization headers, raw remote payloads, provider SDK objects, uncontrolled environment values, arbitrary filesystem paths, shell commands, and unbounded diagnostics before persistence or IPC delivery.
- FR-06.5: F24 SHALL keep exact repository/ref/SHA values inspectable and copyable through safe display fields without exposing credential-bearing remote URLs.

### FR-07: Feature boundaries and handoff contracts

- FR-07.1: F24 SHALL consume F06, F07, F08, F13, and F16 only through typed provider-neutral ports and SHALL not duplicate their GitHub, configuration, inbox, worktree, or AI-policy logic.
- FR-07.2: F24 SHALL hand F25 exact source/destination repositories, branches, SHAs, source provenance, configuration revisions, and the preparation intent identity; F25 SHALL own worktree creation and merge execution.
- FR-07.3: F24 SHALL hand F26 no AI capability directly. F26 SHALL obtain any complete Merge Conflict Resolution profile/policy/Common Instruction/validation snapshot through its own declared F16/F17/F14 boundary after a real conflict and before provider work.
- FR-07.4: F24 SHALL expose F08/F19/F27 only bounded target/action data and SHALL not let a notification, overlay, renderer route, or activity event authorize preparation or publication by itself.

## Non-Functional Requirements

- **NFR-01: Determinism** - Given the same inbox/configuration revisions, explicit repository/ref identities, F06 observations, F13 readiness result, and injected clock, F24 SHALL produce equivalent selection, source precedence, eligibility, summary, and authorization decisions without AI judgment.
- **NFR-02: Durability and restart safety** - Confirmed preparation intents, exact input snapshots, eligibility records, idempotency identities, handoff status, and reasons SHALL survive renderer closure and ordinary process restart.
- **NFR-03: Idempotency and concurrency** - Duplicate selection commands, stale renderer requests, repeated confirmation, competing confirmation, persistence retries, and uncertain downstream handoff SHALL not create duplicate intent, batch, worktree request, AI operation, or external mutation.
- **NFR-04: Remote identity exactness** - Every source/head branch and SHA SHALL remain scoped to its canonical server and repository; default branches, same-named refs, cached labels, and provider prose SHALL never substitute for an explicit identity.
- **NFR-05: Bounded data and failure behavior** - Selection sizes, PR counts, branch names, repository identities, reasons, diagnostics, and IPC payloads SHALL have explicit bounds; over-limit, missing, or ambiguous authoritative data SHALL fail closed without silent truncation.
- **NFR-06: Usability and explainability** - A developer SHALL understand the selected scope, source provenance, repositories, branches, SHAs, skipped PRs, preparation-only boundary, and next actions without reading logs.
- **NFR-07: Accessibility and Windows behavior** - The supported Windows Electron surface SHALL remain operable with keyboard, screen reader, forced colors/high contrast, reduced motion, zoom, and narrow windows, with focus returned predictably after resolution or validation errors.
- **NFR-08: Security and least privilege** - F24 SHALL expose no credentials, provider SDK objects, arbitrary Git/GitHub capability, filesystem mutation authority, AI invocation authority, commit/push authority, or publication authority to the renderer or persistence records.
- **NFR-09: Testability** - Selection, F06 observations, F07 revisions, F08 projections, F13 readiness, F16 revisions, persistence, clocks, cancellation, and downstream handoff SHALL be injectable so contract tests use fakes and temporary data without live credentials or real GitHub effects.

## Invariants

- **INV-01:** Deterministic application code owns selection, source precedence, repository/ref resolution, eligibility, summary construction, confirmation gating, and handoff; F24 never uses AI for a deterministic choice.
- **INV-02:** The effective source branch is the non-empty `syncSourceBranchOverride` or the PR's explicit `prBaseBranch`, in that order; the repository API's `default_branch` can never replace either value.
- **INV-03:** Source and destination identities are server-scoped and repository-scoped; base and head repositories remain distinct for forks, and a same-named branch in another repository is never an implicit match.
- **INV-04:** A confirmed intent retains immutable configuration, inbox, repository, branch, and SHA snapshots; later mutable settings or remote movement cannot rewrite the meaning of that intent.
- **INV-05:** A F24 confirmation is preparation-only. It cannot authorize a merge commit, push, GitHub response, AI provider, review approval, conversation resolution, or publication.
- **INV-06:** The complete preparation intent is durably recorded before F25 receives its authorization or any downstream worktree/Git effect is attempted.
- **INV-07:** The main process and F03 records are authoritative for confirmed F24 state; renderer memory, notification text, activity text, cached labels, and provider output are never authoritative.
- **INV-08:** Every selected PR receives an explicit eligible or ineligible result for the summary revision; an ineligible PR is never silently dropped, silently retried as eligible, or replaced by another PR/ref.
- **INV-09:** Selection, summary viewing, cancellation, and renderer recreation do not mutate the worktree, primary review state, automatic-review hold, AI budget, or external GitHub state.
- **INV-10:** Credentials, authorization headers, raw provider objects, uncontrolled environment values, arbitrary paths/commands, and publication capabilities never cross the F24 persistence, IPC, read-model, or downstream authorization boundary.
- **INV-11:** A changed projection/configuration/remote snapshot, unavailable identity, ambiguous ref, or uncertain handoff cannot be treated as current success; F24 fails closed and preserves evidence with a permitted next action.

## Out of Scope

- **Inbox primary-state projection and grouping** - F08 owns the complete managed-PR inbox, ordering, primary review states, and visual synchronization-overlay slot.
- **Configuration editing** - F07 owns PR Intent / Context, `syncSourceBranchOverride`, base/head metadata, and configuration revisions.
- **Polling and automatic scheduling** - F10-F12 own remote polling, eligibility for automatic review work, batching, global pause, and review holds.
- **Worktree creation and Git execution** - F13/F25 own operation paths, fetching/materialization, merge-base calculation, worktree creation, merge attempts, diff inspection, and Git state.
- **Validation and AI work** - F14/F16/F17/F26 own validation execution, task-profile/policy snapshots at the AI boundary, bounded conflict resolution, and AI usage.
- **Synchronization result review and publication** - F27 owns result presentation, stale detection, discard/re-evaluation, explicit **Publish Merge**, non-force push, and publication recovery.
- **Automatic branch synchronization, webhook triggers, force push, automatic rebase, batch publication, GitHub review approval, and GitHub conversation resolution** - these remain outside the F24 preparation boundary and the MVP non-goals.
- **Source-repository override editing** - F24 uses the explicit PR base repository as the synchronization source repository in the MVP; selecting an arbitrary repository for a branch override is not supported.

## Product Decisions

- **PD-01: Select-all means all visible managed identities** - **Select all managed PRs** selects every managed-PR identity in the accepted inbox projection, including PRs that F24 later marks ineligible. The confirmation must show those PRs rather than silently filtering them.
- **PD-02: Selection is transient until confirmation** - Renderer/session selection is a user input and may be discarded on cancellation or renderer closure. The confirmed preparation intent is the first durable F24 record.
- **PD-03: Open PRs are the synchronization target** - Closed or merged PRs are shown as selected-but-ineligible with an actionable reason. Their presence never blocks eligible PRs in the same selection.
- **PD-04: The source repository is explicit and conservative** - The MVP resolves the source branch in the PR base repository and the destination branch in the PR head repository. A missing or ambiguous repository identity is an eligibility failure, not an invitation to guess.
- **PD-05: Preparation and publication are separate decisions** - Confirming the selection permits F25 to prepare and present results only. Every result later requires its own explicit **Publish Merge** approval in F27.
- **PD-06: Review holds do not silently block user-directed synchronization** - A PR remaining `READY_FOR_REVIEW` or `NEEDS_ATTENTION` is not itself an F24 eligibility failure; the synchronization overlay remains separate. An active synchronization conflict or operation is handled through a typed downstream concurrency reason.
- **PD-07: Clean synchronization does not require AI configuration** - F24 does not reject an otherwise valid PR solely because a Merge Conflict Resolution profile is unavailable. A clean F25 merge can proceed without AI; F26 reports an actionable attention result if semantic conflict resolution is later required but cannot be admitted.
- **PD-08: Stale summaries are rejected, not refreshed invisibly** - A changed inbox/configuration/remote revision requires a new resolution and a new visible summary so the developer can see the exact inputs being authorized.

## Implementation Decisions

- **IMP-01: Use typed selection and confirmation contracts** - Define versioned provider-neutral contracts for `SynchronizationSelectionSession`, `SynchronizationResolution`, `SynchronizationEligibility`, `SynchronizationConfirmation`, and `SynchronizationPreparationAuthorization`; renderer state never becomes the domain contract.
- **IMP-02: Keep selection transient and confirmation durable** - F24 may keep the pre-confirmation selection in a main-process session/read model, while F03 stores the confirmed intent, immutable per-PR classification, exact inputs, idempotency key, and handoff state.
- **IMP-03: Reuse F06 exact identity operations** - Source and destination lookups use F06's typed current-PR and exact-ref ports independently. F24 does not implement HTTP, provider SDK translation, pagination, or retry policy.
- **IMP-04: Use base/head repository identities as the fork boundary** - `syncSourceRepository` is the stored PR base repository and `destinationRepository` is the stored PR head repository. A branch name without its repository identity is invalid input.
- **IMP-05: Treat remote/configuration resolution as a versioned preflight** - F24 computes a resolution revision from the inbox projection, F07 configuration revision, F06 observations, and F13 readiness. Confirmation compares that revision and refuses stale commands.
- **IMP-06: Persist before downstream handoff** - F24 commits the confirmed intent and its immutable input snapshots through F03 before calling the F25 preparation port. Handoff/recovery states distinguish not-started, handed-off, acknowledged, failed, and uncertain.
- **IMP-07: Let F13 own preparation readiness, not F24 Git logic** - F24 asks F13 for a typed readiness/ownership result and passes the result onward; it does not create paths, fetch objects, inspect worktrees, or invoke Git directly.
- **IMP-08: Carry F16 configuration references without invoking AI** - F24 records the current F16 synchronization-relevant revision/reference needed for downstream reproducibility. F25/F26 resolve the complete operation-owned policy/profile/context at their own external-effect boundary; F24 never constructs provider requests.
- **IMP-09: Project reasons from structured data** - Eligibility, stale, cancellation, conflict, and handoff explanations are built from bounded reason keys, safe parameters, retryability, and permitted actions rather than activity text or branch labels.
- **IMP-10: Keep F24's operation vocabulary small** - F24 uses selection/resolution/confirmation/handoff statuses and does not create the merge, conflict, validation, stale, or publication state machine owned by F25-F27.

## Testing Decisions

- **TST-01: Deep-test the deterministic resolver** - Cover override/base precedence, default-branch non-substitution, source/head repository separation, fork identities, exact refs, SHA mismatches, closed/merged states, and all stable eligibility reasons.
- **TST-02: Test selection and projection semantics** - Cover individual selection, clear, select-all, selected counts, duplicate/out-of-order commands, stale inbox revisions, primary-state/hold preservation, and empty/all-ineligible summaries.
- **TST-03: Fault-test the confirmation boundary** - Inject failures before/after remote reads, summary creation, persistence, and downstream handoff; prove persist-before-handoff, cancellation safety, uncertain recovery, and no duplicate authorization.
- **TST-04: Use typed fakes for every dependency** - F24 tests use fake F06/F07/F08/F13/F16/F25 ports and test-owned persistence. They do not use live credentials, a provider SDK, real GitHub, real worktrees, merges, or publication.
- **TST-05: Test the security and capability boundary negatively** - Reject raw URLs, credentials, provider objects, arbitrary paths/commands, unbounded reason data, unknown IDs, stale revisions, and publication/AI capabilities in IPC and authorization payloads.
- **TST-06: Test accessibility and Windows interaction semantics** - Verify labels, focus, keyboard order, screen-reader announcements, forced colors, reduced motion, zoom, bounded wrapping, no horizontal overflow, and prepare-only wording.
- **TST-07: Prove downstream non-overlap** - Thin F25/F26/F27 consumers must receive only the typed authorization and must prove that F24 does not create worktrees, merge, validate, invoke AI, commit, push, post, or publish.

## Proposed Modules

- **MOD-01: Synchronization Selection Session** - Maintains the versioned selected managed-PR identity set, clear/select-all behavior, selected count, and stale-projection checks.
- **MOD-02: Effective Source Resolver** - Applies override/base precedence, selects explicit source/destination repository identities, records source provenance, and rejects default/same-name substitution.
- **MOD-03: Current Remote Observation Adapter** - Requests typed current PR state and exact source/head refs through F06 and materializes bounded observation evidence.
- **MOD-04: Eligibility Classifier** - Applies open-state, identity, ref, SHA, F13-readiness, and concurrency prerequisites and produces per-PR structured reasons/actions.
- **MOD-05: Synchronization Confirmation Projector** - Builds the eligible/ineligible summary, exact identity/SHA display, counts, prepare-only language, and accessible action state.
- **MOD-06: Preparation Intent Repository** - Persists immutable resolution inputs, classifications, idempotency identity, handoff status, and recovery reasons through F03.
- **MOD-07: Preparation Authorization Boundary** - Converts one current confirmed intent into a bounded F25 authorization and rejects duplicate, stale, malformed, or unauthorized handoffs.
- **MOD-08: F24 IPC and Read-Model Adapter** - Validates renderer commands and projections, preserves main-process authority, and exposes safe downstream targets/statuses.

## Workflows

### Workflow 1: Select managed PRs

```text
1. F08 supplies an authoritative inbox projection and revision.
2. The renderer opens the synchronization selection surface through F04.
3. The developer toggles individual managed-PR identities, clears the selection,
   or selects all identities in that projection.
4. F24 validates the expected projection revision and returns the selected count.
5. No remote, Git, AI, validation, worktree, hold, or publication effect occurs.
```

### Workflow 2: Resolve source, destination, and eligibility

```text
1. The developer requests synchronization for the current selection.
2. F24 loads the immutable F07 configuration revision for each selected PR.
3. F24 chooses syncSourceBranchOverride when non-empty, otherwise prBaseBranch.
4. F24 binds the source branch to the explicit base repository and the destination
   branch to the explicit head repository.
5. F24 asks F06 for current PR state and exact source/head refs independently.
6. F24 asks F13 for typed preparation readiness and records all results.
7. Every selected PR becomes eligible or ineligible with a reason and next action.
```

### Workflow 3: Confirm preparation only

```text
1. F24 renders the selected/eligible/ineligible counts and every per-PR identity,
   provenance, SHA, reason, and next action.
2. If the resolution revision is stale, F24 refuses confirmation and requires a
   new visible resolution.
3. The developer explicitly chooses Confirm preparation.
4. F24 persists the complete intent, snapshots, idempotency key, and handoff state.
5. F24 emits a typed authorization for eligible PRs to F25.
6. F25 may now prepare independent synchronization work; publication remains a
   separate F27 approval for each result.
```

### Workflow 4: Cancel, restart, or replay safely

```text
1. Before confirmation, cancellation or renderer closure discards only the
   transient selection/session and creates no durable operation.
2. After confirmation, F03 retains the intent and its exact snapshots.
3. On replay or restart, F24 returns the existing intent/handoff outcome by its
   stable identity rather than creating a second authorization.
4. If remote/configuration evidence is stale or handoff is uncertain, F24 keeps
   the evidence and exposes a bounded reconcile/re-resolve action.
```

## Contract-Test Criteria

- **CT-F24-01:** Selection fixtures cover individual toggles, clear, select-all, selected counts, empty selection, duplicate/out-of-order commands, stale inbox revisions, and no side effects before confirmation.
- **CT-F24-02:** Source-precedence fixtures cover non-empty/blank overrides, base branch fallback, informational default branches, invalid ref names, and exact source provenance.
- **CT-F24-03:** Repository/ref identity fixtures cover same-repository PRs, fork PRs, deleted/unavailable head repositories, same-named branch negatives, explicit server scope, and missing/ambiguous identities.
- **CT-F24-04:** Current-observation fixtures cover independent source/head lookups, open/closed/merged PRs, current SHA capture, metadata/ref disagreement, not-found, access, rate-limit, timeout, cancellation, and bounded safe reasons.
- **CT-F24-05:** Eligibility fixtures prove every selected PR receives exactly one eligible/ineligible result, mixed selections continue, active-operation/F13-readiness conflicts are isolated, and no implicit retry or silent omission occurs.
- **CT-F24-06:** Summary/confirmation fixtures cover selected/eligible/ineligible counts, complete per-PR identity/SHA/provenance display, no-eligible refusal, stale-summary rejection, prepare-only wording, and no commit/push/publication affordance.
- **CT-F24-07:** Persistence/handoff fixtures cover persist-before-F25, immutable snapshots, stable idempotency keys, duplicate/competing confirmation, cancellation, persistence failure, uncertain handoff, and existing-intent adoption.
- **CT-F24-08:** Restart/lifecycle fixtures cover renderer closure, recreation, process restart, last-known summary, handoff status, primary-state/hold preservation, and no duplicate downstream authorization.
- **CT-F24-09:** Boundary fixtures cover F06/F07/F08/F13/F16/F25 typed ports, no provider SDK/AI/Git/validation/publication imports or capabilities, secret/raw-URL/path/command rejection, and downstream consumer conformance.
- **CT-F24-10:** Accessibility/performance fixtures cover keyboard, screen reader, focus/error recovery, forced colors, reduced motion, zoom, narrow windows/no overflow, bounded lists/reasons, and a 250-managed-PR selection/summary projection.

## Requirement Traceability

| Requirement family | Observable coverage | Named contract tests |
|---|---|---|
| FR-01 | AC-01-AC-04, AC-16-AC-18 | CT-F24-01, CT-F24-06, CT-F24-08, CT-F24-10 |
| FR-02 | AC-05-AC-08, AC-15, AC-17 | CT-F24-02, CT-F24-03, CT-F24-04, CT-F24-09 |
| FR-03 | AC-07-AC-11, AC-15, AC-17 | CT-F24-03-CT-F24-05, CT-F24-07 |
| FR-04 | AC-08-AC-15, AC-18-AC-19 | CT-F24-06-CT-F24-08 |
| FR-05 | AC-02-AC-04, AC-11, AC-13-AC-15, AC-18-AC-19 | CT-F24-01, CT-F24-07, CT-F24-08 |
| FR-06 | AC-01-AC-04, AC-12, AC-16-AC-17 | CT-F24-06, CT-F24-09, CT-F24-10 |
| FR-07 | AC-13-AC-15, AC-18-AC-19 | CT-F24-07-CT-F24-09 |
| NFR-01-NFR-09 | AC-01-AC-19 | CT-F24-01-CT-F24-10 |
| INV-01-INV-11 | AC-01-AC-19 | CT-F24-01-CT-F24-10 |
