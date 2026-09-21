# F07 Add and Manage a Pull Request - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F03 - SQLite persistence, migrations, and transactional repositories | Provides the main-process durable managed-PR records, transaction boundaries, idempotency, optimistic versions, and immutable configuration snapshots. |
| 2 | F04 - Persistent Electron shell, IPC boundary, and Windows virtual-desktop spike | Provides the replaceable renderer, validated main-process commands/read models, and lifecycle behavior used by the Add PR and PR details surfaces. |
| 3 | F05 - Secure GitHub server profiles and authentication | Provides the verified server profile and request-scoped authenticated access without exposing credentials to this feature. |
| 4 | F06 - GitHub REST client and remote identity model | Provides supported PR URL parsing, PR metadata retrieval, explicit base/head repository identities, branch names, SHAs, and safe remote failure reasons. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F08 - Managed-PR inbox and primary review-state presentation | Reads the managed-PR projection, local setup status, remote summary, and navigation target created here. |
| 2 | F10-F12 - Deterministic monitoring pipeline | Uses the persisted remote identity and current managed-PR record; F07 does not own polling, event eligibility, or batching. |
| 3 | F13-F14 - Operation-owned Git worktrees and validation | Uses the validated local clone association and explicit base/head repository and SHA snapshot; it revalidates the clone before mutation. |
| 4 | F16/F18/F21 - AI configuration and review preparation | Uses the current PR Intent / Context revision and snapshots it for each operation without changing earlier results. |
| 5 | F22 - Discard, stale detection, and re-evaluation | Uses the immutable PR configuration and remote snapshots associated with existing Review Bundles. |
| 6 | F24-F27 - Managed PR branch synchronization | Uses `prBaseBranch`, `prHeadBranch`, and the optional `syncSourceBranchOverride`; F24 owns source resolution and confirmation. |
| 7 | F28-F30 - Recovery, security, and release readiness | Reconciles incomplete Add PR operations, hardens local-path boundaries, and verifies the complete Windows workflow. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-02 | FR-01.1-FR-02.6, FR-04.1-FR-04.5, FR-08.1-FR-08.4, INV-01-INV-04, INV-06-INV-08 | AC-01-AC-12, AC-17-AC-18 | Primary: F07 owns the complete Add PR flow, managed-PR persistence, remote summary, local-clone setup result, and restart-safe error handling. F05 owns authentication and F06 owns URL parsing/remote metadata mechanics. |
| APP-AC-40 | FR-05.1-FR-05.6, FR-07.1-FR-07.4, FR-08.4, INV-07, INV-09 | AC-13, AC-15-AC-16, AC-19 | Primary: F07 owns optional multi-line PR Intent / Context capture and later editing. |
| APP-AC-41 | FR-05.4-FR-05.6, FR-07.1-FR-07.3, INV-07, INV-09 | AC-15-AC-16 | Shared enabler: F07 owns immutable configuration revisions and exposes the revision to F16/F18; F16/F18 own inclusion in AI evaluation and Review Bundle snapshots. |
| APP-AC-42 | FR-07.1-FR-07.4, INV-07 | AC-15-AC-17 | Shared enabler: F07 prevents local edits from rewriting prior revisions; F16/F18 own the completed-bundle reproducibility behavior. |
| APP-AC-44 | FR-02.4, FR-06.1-FR-06.5, INV-03, INV-08 | AC-03, AC-14, AC-16 | Shared enabler: F07 stores the PR-reported base branch and optional override exactly; F24 owns effective-source resolution, confirmation, and merge behavior. F06 owns explicit repository/ref identity. |

F07 does not claim complete ownership of APP-AC-16, APP-AC-17, APP-AC-19, APP-AC-20, APP-AC-30, APP-AC-34, or APP-AC-51. F07 only keeps its own Add PR/configuration work independent from renderer lifetime and stores per-PR context separately from Common Instructions; F08-F12/F19/F28 own background monitoring, tray/shutdown, and hold behavior, while F24-F27 own synchronization staleness.

## Executive Summary

Adding a pull request must be more than saving a URL. PRMonitor needs a stable, server-scoped identity for the remote pull request, the exact base and head repositories and SHAs reported by GitHub, and a safe relationship to a local clone from which later isolated worktrees can be created. The user should be able to get started with minimal configuration, understand what is missing, and return to the same managed PR after a restart.

F07 provides the user-facing Add PR and PR details/settings flow. It uses F06 to parse the URL and retrieve metadata, persists the managed PR through F03, and offers a bounded, read-only inspection of an existing local Git clone. A URL alone is sufficient to create a managed PR; when no suitable clone is available, the record remains visible with a separate local-setup status and a clear next action. Selecting a clone never resets, cleans, fetches, checks out, or otherwise changes the developer's worktree.

The feature also owns the two pieces of per-PR configuration described by the application overview: optional multi-line PR Intent / Context and an optional branch synchronization source override. Each saved configuration is versioned. Future work uses the new revision, while an existing Review Bundle or AI operation continues to point at the immutable revision it already captured.

## User Stories

### Add a PR from a URL

- **US-01:** **GIVEN** the developer has a verified GitHub.com or GHES server profile, **WHEN** they paste a supported pull-request URL, **THEN** PRMonitor shows the canonical server, repository, pull-request number, and a safe validation result before creating a managed record.
  - **Acceptance Criteria:** AC-01, AC-02.
- **US-02:** **GIVEN** the remote PR is accessible, **WHEN** PRMonitor retrieves its metadata, **THEN** the developer can review the base/head repositories, branches, current SHAs, PR state, and informational repository default branch as separate values.
  - **Acceptance Criteria:** AC-03, AC-10.
- **US-03:** **GIVEN** the same PR is submitted again, **WHEN** the canonical identity already exists or an add operation is still in progress, **THEN** PRMonitor reuses the existing record or operation instead of creating a duplicate.
  - **Acceptance Criteria:** AC-05, AC-06.

### Associate a safe local clone

- **US-04:** **GIVEN** PRMonitor knows the PR's base repository, **WHEN** the Add PR flow looks for a clone, **THEN** it suggests only bounded, previously known candidates and lets the developer browse for a directory without scanning arbitrary disks.
  - **Acceptance Criteria:** AC-07.
- **US-05:** **GIVEN** the developer chooses an existing clone, **WHEN** PRMonitor validates it, **THEN** it confirms a usable non-bare Git worktree whose remote identity matches the PR's base repository and reports whether the clone is clean or dirty without changing it.
  - **Acceptance Criteria:** AC-08, AC-09.
- **US-06:** **GIVEN** no clone is available, **WHEN** the developer chooses to continue with the remote PR only, **THEN** PRMonitor saves the managed PR with a local-clone-required status and does not silently clone, fetch, or start work that needs a local repository.
  - **Acceptance Criteria:** AC-11.

### Manage per-PR configuration

- **US-07:** **GIVEN** the developer is adding or viewing a managed PR, **WHEN** they enter optional PR Intent / Context, **THEN** the application preserves the multi-line text as the current per-PR configuration and makes it editable later.
  - **Acceptance Criteria:** AC-13, AC-19.
- **US-08:** **GIVEN** the developer needs a non-default synchronization source, **WHEN** they enter or edit a branch override, **THEN** PRMonitor validates the branch name, stores the exact override or an explicit blank value, and does not resolve or replace it with the repository default branch.
  - **Acceptance Criteria:** AC-14.
- **US-09:** **GIVEN** a Review Bundle or AI operation already references an earlier PR configuration, **WHEN** the developer edits Intent / Context or the synchronization override, **THEN** the existing result remains unchanged and only future work uses the new configuration revision.
  - **Acceptance Criteria:** AC-15, AC-16.

### Recover and understand the managed PR

- **US-10:** **GIVEN** the renderer closes, the application restarts, or an Add PR request fails, **WHEN** the developer returns to PRMonitor, **THEN** the current managed-PR record or incomplete attempt is presented with an actionable reason and no misleading partial success.
  - **Acceptance Criteria:** AC-04, AC-05, AC-17, AC-18.
- **US-11:** **GIVEN** the developer uses keyboard navigation or assistive technology, **WHEN** they add, select, validate, or edit a PR, **THEN** fields, statuses, errors, and next actions are labeled, focusable, and understandable.
  - **Acceptance Criteria:** AC-19.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** a supported HTTPS GitHub.com or standard GHES pull-request URL and a verified matching F05 server profile, **WHEN** the developer submits it, **THEN** F07 uses F06's deterministic parser to derive one canonical server-scoped PR identity and shows the normalized owner, repository, and positive PR number before any managed-PR record is committed.
- **AC-02:** **GIVEN** the URL is malformed, insecure, ambiguous, unsupported, or targets a server without a verified profile, **WHEN** validation runs, **THEN** PRMonitor rejects it before a credentialed request, presents a safe reason and next action, and creates neither a managed PR nor an active local-clone association.
- **AC-03:** **GIVEN** a parsed identity is valid and the remote PR metadata request succeeds, **WHEN** F07 prepares the managed record, **THEN** it retains the explicit base repository, head repository when available, `prBaseBranch`, `prHeadBranch`, `prBaseSha`, `prHeadSha`, PR state, canonical URL, and informational repository `default_branch` as separate fields; a fork or unavailable head repository remains explicit rather than being replaced by a same-named repository.
- **AC-04:** **GIVEN** the metadata request returns not-found, forbidden, authentication, rate-limit, network, timeout, cancellation, malformed, or server-identity failure, **WHEN** the Add PR operation ends, **THEN** no new managed PR is reported as created, the existing record (if any) remains unchanged, and the user receives a bounded machine-readable category, plain-language explanation, and permitted next action.
- **AC-05:** **GIVEN** an Add PR operation is about to request remote metadata, **WHEN** the request starts or the renderer disappears, **THEN** the add intent, canonical parsed input, server/profile identity, correlation identity, and idempotency identity were persisted first; cancellation, process stop, or restart leaves the attempt incomplete/retryable rather than claiming that a managed PR or clone was created.
- **AC-06:** **GIVEN** two add requests identify the same canonical server/repository/PR number or replay the same operation identity, **WHEN** they are processed concurrently or after restart, **THEN** exactly one managed-PR identity and one effective add attempt exist, the existing result is returned or a deterministic conflict is reported, and no duplicate remote fetch side effect is authorized by F07.
- **AC-07:** **GIVEN** the base repository identity is known, **WHEN** the Add PR flow offers local clones, **THEN** it uses only previously recorded/validated candidates and explicit user-selected directories within bounded path rules, including a maximum canonical path length of 4,096 UTF-16 code units; it does not recursively scan arbitrary drives, execute a network clone, or treat a same-named directory as a match.
- **AC-08:** **GIVEN** the developer selects a local directory, **WHEN** validation succeeds, **THEN** F07 records the canonical repository root and a safe validation snapshot proving that it is an accessible non-bare Git worktree whose parsed remote identity matches the PR's base repository on the configured server; it also records a bounded clean/dirty/unknown status without storing raw remote URLs.
- **AC-09:** **GIVEN** the selected path is missing, inaccessible, not a Git worktree, bare, ambiguous, outside the allowed path policy, or its remotes cannot be proven to match the PR's base repository, **WHEN** validation runs, **THEN** the association is rejected with a specific remediation, no Git mutation or network fetch occurs, and the developer may choose another path or continue without a clone.
- **AC-10:** **GIVEN** the PR head is in a fork or the head repository is unavailable, **WHEN** the clone is validated or the managed PR is displayed, **THEN** the head repository identity and availability remain separate from the base clone identity; F07 never substitutes a same-named branch or repository and never treats the repository default branch as the PR base branch.
- **AC-11:** **GIVEN** no suitable clone is found or selected, **WHEN** the developer explicitly chooses **Add without local clone**, **THEN** the managed PR is saved with a separate `LOCAL_CLONE_REQUIRED` setup status, the primary review-state contract is not replaced by a clone state, and no automatic cloning, fetching, checkout, reset, clean, worktree creation, or AI work starts.
- **AC-12:** **GIVEN** a managed PR exists, **WHEN** the details screen is opened after renderer recreation or process restart, **THEN** it shows the persisted remote identity/metadata, local-clone setup status/path, current configuration revision, and safe last-operation reason from main-process state rather than a stale renderer cache.
- **AC-13:** **GIVEN** the developer enters optional PR Intent / Context, **WHEN** it is saved, **THEN** multi-line UTF-8 content up to 32 KiB is preserved exactly, blank input is represented as no context, the value is associated only with this PR, and the UI can display and edit it later without requiring a ticket-system integration.
- **AC-14:** **GIVEN** the developer enters a synchronization-source override, **WHEN** it is saved, **THEN** a deterministic Git branch-ref validation accepts only a valid branch name of at most 255 UTF-8 bytes, preserves its exact value, stores blank as no override, and does not resolve it through the repository default branch or start synchronization.
- **AC-15:** **GIVEN** a local PR configuration change is valid, **WHEN** it is committed, **THEN** F07 creates one new immutable configuration revision and updates the current managed-PR projection atomically; an existing Review Bundle, AI operation, or other historical result continues to reference its prior revision and content.
- **AC-16:** **GIVEN** a PR is already `WORKING`, held, or has a completed result, **WHEN** Intent / Context or the synchronization override is edited, **THEN** the edit does not release a hold, reset a budget, mutate a worktree, rewrite a bundle/operation snapshot, or silently start a new operation; only explicitly initiated future work may consume the new revision.
- **AC-17:** **GIVEN** two renderer sessions or a stale editor submit competing changes, **WHEN** both target the same managed-PR revision, **THEN** one commit wins, the other receives an actionable optimistic-concurrency conflict, and the losing request cannot overwrite the current configuration or historical revisions.
- **AC-18:** **GIVEN** an Add PR, clone validation, or configuration edit is in progress, **WHEN** the renderer closes or the application restarts, **THEN** main-process work follows its durable operation contract, committed data remains readable, incomplete work is marked incomplete/retryable, and a recreated renderer can resume from persisted state without repeating a successful commit.
- **AC-19:** **GIVEN** the Add PR and PR details/settings surfaces are used with keyboard navigation or assistive technology, **WHEN** validation, loading, success, missing-clone, conflict, and failure states are shown, **THEN** labels, focus order, status announcements, error associations, and remediation controls are accessible and no secret-bearing value is rendered or copied into a general-purpose field.

## Functional Requirements

### FR-01: Add request and remote metadata

- FR-01.1: The application SHALL accept a developer-supplied supported GitHub.com or standard GHES pull-request URL and SHALL delegate URL parsing and canonical identity construction to the F06 contract.
- FR-01.2: The Add PR flow SHALL require a verified F05 server profile matching the parsed server identity and SHALL not infer a server, select a credential, or make an arbitrary host request from renderer input.
- FR-01.3: Before requesting remote metadata, the application SHALL persist a bounded Add PR intent containing the canonical parsed input, server/profile identity, correlation identity, idempotency identity, and immutable input snapshot.
- FR-01.4: The application SHALL retrieve PR metadata only through F06 and SHALL retain explicit base/head repository identities, branches, SHAs, remote state, canonical URL, and informational default-branch metadata as separate values.
- FR-01.5: A remote metadata failure, cancellation, timeout, malformed response, or unavailable identity SHALL leave a new managed PR uncreated and SHALL leave an existing managed PR unchanged.
- FR-01.6: The Add PR flow SHALL present safe reason data and a permitted next action for malformed input, missing authentication, inaccessible PRs, rate limits, network failures, and incomplete metadata.

### FR-02: Managed-PR aggregate and durable creation

- FR-02.1: The application SHALL define one canonical managed-PR identity from the F06 server-scoped PR identity and SHALL prevent duplicate active records for the same remote PR.
- FR-02.2: After validated metadata is available, the application SHALL persist the remote snapshot, initial configuration revision, optional local-clone association, primary review state, setup status, version, and timestamps in one transactional decision.
- FR-02.3: The initial managed-PR primary state SHALL use the F02 contract; local-clone setup status SHALL remain a separate status/overlay and SHALL not add a clone state to the primary PR state machine.
- FR-02.4: The managed-PR record SHALL preserve `prBaseBranch`/`base.ref`, `prHeadBranch`/`head.ref`, base/head repositories and SHAs, and the API-reported `default_branch` without allowing the latter to replace the former.
- FR-02.5: Replaying an add intent or retrying after renderer closure/restart SHALL return the existing operation/managed PR or a deterministic conflict and SHALL not create a second identity or partial aggregate.
- FR-02.6: The durable Add PR attempt SHALL distinguish pending, succeeded, cancelled, failed, and recovery-required outcomes and SHALL retain safe reasons without relying on free-form logs.

### FR-03: Local clone discovery and validation

- FR-03.1: The application SHALL offer bounded suggestions from previously known/validated local clone associations and SHALL offer an explicit folder-selection action for another existing directory.
- FR-03.2: The application SHALL not recursively scan arbitrary user drives, automatically clone a repository, fetch remote refs, or use a renderer-supplied path without main-process validation.
- FR-03.3: A selected path SHALL be validated as an accessible, non-bare Git worktree with a canonical repository root and bounded read-only Git inspection results.
- FR-03.4: A clone SHALL be accepted only when a parsed local remote identity can be matched deterministically to the PR's base repository and configured server; same-name repository or branch matches without identity proof SHALL be rejected.
- FR-03.5: For fork PRs, the managed record SHALL preserve the head repository identity independently; F07 SHALL not require a head remote to be the base clone and SHALL not replace an unavailable head identity with the base repository.
- FR-03.6: Clone validation SHALL report clean, dirty, or unknown status without rejecting a usable dirty clone and SHALL never reset, clean, checkout, fetch, pull, create a worktree, or otherwise mutate the selected repository.
- FR-03.7: A missing or later-unavailable clone SHALL become a separate setup status that remains actionable; downstream worktree features SHALL revalidate the path before use.
- FR-03.8: Local path handling and Git subprocesses SHALL use bounded, argument-vector, controlled-environment operations and SHALL not persist raw credential-bearing remote URLs or uncontrolled command output.

### FR-04: Managed-PR read model and management surface

- FR-04.1: The PR details/read model SHALL show the remote identity, base/head repository and branch data, current SHAs, remote state, default branch as informational metadata, local-clone setup status/path, and current configuration revision.
- FR-04.2: The management surface SHALL allow a developer to attach, replace, or clear the optional local-clone association and to save local configuration changes without re-entering the PR URL.
- FR-04.3: Local configuration edits SHALL not implicitly refresh remote metadata, invoke polling, start synchronization, start AI work, or publish any remote change.
- FR-04.4: A read of a missing, moved, or inaccessible stored path SHALL return a safe setup status and remediation rather than deleting the association or claiming that the clone is valid.
- FR-04.5: User-visible errors and statuses SHALL identify what happened, why it matters, and the allowed next action without exposing credentials, raw authorization data, or unbounded Git/HTTP output.

### FR-05: PR Intent / Context

- FR-05.1: The Add PR flow and PR details/settings surface SHALL allow optional multi-line PR Intent / Context associated with one managed PR.
- FR-05.2: The application SHALL preserve non-blank context content, including line breaks and meaningful whitespace, up to 32 KiB of UTF-8 data; over-limit content SHALL be rejected before commit with an actionable error.
- FR-05.3: Blank context SHALL be represented as an explicit absence/null value rather than an application-wide Common Instruction or an invisible default.
- FR-05.4: Every saved context value SHALL belong to a versioned per-PR configuration revision that downstream AI/review features can snapshot by immutable revision identity.
- FR-05.5: The context SHALL be presented as informative user input; if it conflicts with the actual repository, remote PR, review feedback, deterministic validation, or later stale checks, those deterministic facts SHALL remain authoritative and the context SHALL remain only a visible input/snapshot.
- FR-05.6: Context content SHALL not be copied into free-form activity/error diagnostics, URLs, correlation identities, or unrelated PR records merely because it was edited; downstream consumers SHALL receive it only through the declared per-PR configuration snapshot contract.

### FR-06: Synchronization-source override

- FR-06.1: The Add PR flow and PR details/settings surface SHALL allow an optional per-PR `syncSourceBranchOverride`.
- FR-06.2: The value SHALL be validated deterministically as a Git branch ref of at most 255 UTF-8 bytes and SHALL reject control characters, malformed ref syntax, path traversal-like components, and unsafe input before commit.
- FR-06.3: Blank input SHALL mean no override and SHALL be stored distinctly from an explicit branch value.
- FR-06.4: A non-blank override SHALL be preserved exactly as entered after validation and SHALL be associated with the current configuration revision.
- FR-06.5: F07 SHALL not resolve the branch, fetch it, merge it, or substitute the repository's `default_branch`; F24 owns effective-source resolution and synchronization confirmation.

### FR-07: Configuration revision and historical isolation

- FR-07.1: A valid Intent / Context or synchronization-override edit SHALL create one new immutable configuration revision and update the current managed-PR projection atomically.
- FR-07.2: Existing Review Bundles, AI operations, and other historical results SHALL retain the exact configuration revision and content snapshot they previously referenced.
- FR-07.3: Editing current configuration SHALL not release a review hold, reset an AI budget, mutate an operation-owned worktree, alter a publication approval, or silently start a new operation.
- FR-07.4: Concurrent edits SHALL use the persisted managed-PR/configuration version and SHALL return a deterministic conflict for stale writers.

### FR-08: Lifecycle, security, and accessible interaction

- FR-08.1: The Electron main process and F03 repositories SHALL remain authoritative for Add PR operations, local-path validation, managed-PR state, and configuration revisions; the renderer SHALL remain a replaceable view/controller.
- FR-08.2: Renderer closure, lost IPC replies, cancellation, and process restart SHALL not roll back committed managed-PR/configuration data or create a duplicate successful commit.
- FR-08.3: F07 SHALL keep F05 credential capabilities and raw tokens outside renderer read models, local-clone diagnostics, AI context preparation, activity/error output, and persisted F07 records.
- FR-08.4: Add PR and management controls SHALL provide keyboard-accessible labels, focus order, status/error announcements, and remediation actions for loading, success, conflict, missing-clone, and failure states.

## Non-Functional Requirements

- **NFR-01: Determinism** - Given the same canonical remote metadata, local Git inspection result, configuration input, prior revision, and injected clock, F07 SHALL produce the same managed-PR projection, revision, setup status, or safe reason without AI judgment.
- **NFR-02: Durability and recovery** - A committed managed PR, local-clone association, configuration revision, or Add PR outcome SHALL survive renderer destruction and ordinary restart; incomplete work SHALL remain distinguishable from successful work.
- **NFR-03: Local repository safety** - Clone discovery and validation SHALL be read-only, bounded, and non-destructive; a developer's dirty files and untracked work SHALL never be reset, deleted, overwritten, or hidden by this feature.
- **NFR-04: Security and privacy** - Raw GitHub credentials, authorization headers, secure-store material, token-bearing URLs, raw credential-bearing remotes, and uncontrolled process environment values SHALL not cross F07's persistence, renderer, diagnostics, or AI-facing boundaries.
- **NFR-05: Bounded resources** - F07 SHALL cap PR URLs at 2,048 UTF-8 bytes, PR Intent / Context at 32 KiB, branch overrides at 255 UTF-8 bytes, canonical paths at 4,096 UTF-16 code units, each local Git output stream at 64 KiB, user-facing reason detail at 8 KiB, and local Git inspection at 10 seconds; F06 owns independent network limits.
- **NFR-06: GitHub compatibility** - The Add PR contract SHALL work with GitHub.com and standard GHES identities supplied by F05/F06 without changing downstream managed-PR records for forks or same-named branches.
- **NFR-07: Usability and accessibility** - A developer SHALL be able to understand the remote identity, local-clone readiness, configuration values, validation failure, and next action without reading logs or relying on mouse-only interaction.
- **NFR-08: Concurrency and idempotency** - Duplicate add requests and stale configuration edits SHALL be safe to replay and shall not create duplicate managed PRs, revisions, clone associations, or misleading success results.
- **NFR-09: Testability** - URL/metadata fakes, Git fixtures, path policies, clocks, cancellation, persistence transactions, IPC sessions, and accessibility assertions SHALL be injectable/testable without real credentials or product-service network access.

## Invariants

- **INV-01:** The main process and F03 persistence boundary are authoritative for managed PRs, local-clone associations, Add PR attempts, and configuration revisions; renderer memory is never authoritative.
- **INV-02:** F07 uses only F05's verified server-bound capability and F06's typed REST/identity contract; it never accepts raw credentials, arbitrary URLs, or provider SDK objects.
- **INV-03:** Base/head repositories, branches, and SHAs remain explicit and server-scoped; `default_branch` and same-named resources never silently replace PR metadata or a configured override.
- **INV-04:** Add intent and its immutable parsed-input snapshot are durable before the remote metadata request, and the managed-PR aggregate is committed atomically only after validated metadata is available.
- **INV-05:** Local-clone validation is read-only and cannot reset, clean, checkout, fetch, pull, create a worktree, overwrite, or delete developer files.
- **INV-06:** Canonical duplicate add identities and configuration edits are idempotent/optimistically guarded; a stale caller cannot overwrite a newer managed-PR revision or create a second aggregate.
- **INV-07:** Historical configuration revisions and downstream operation/bundle snapshots are immutable; editing current PR configuration never rewrites prior results or their meaning.
- **INV-08:** Missing local-clone setup is a separate status/overlay and does not become a competing primary PR state or synchronization state; no automatic clone is attempted by F07.
- **INV-09:** PR Intent / Context is informative per-PR input and may aid later semantic reasoning, but it never overrides deterministic repository, remote, validation, stale, or publication decisions; a conflict is surfaced or resolved by the owning deterministic workflow, never by treating the text as authorization.

## Requirement Traceability

| Requirement family | Observable acceptance criteria or contract-test criterion |
| --- | --- |
| FR-01.1-FR-01.6 | AC-01-AC-06, AC-10, AC-17-AC-18 |
| FR-02.1-FR-02.6 | AC-03-AC-06, AC-11-AC-12, AC-17-AC-18; CT-F07-01 canonical managed-PR uniqueness and atomic creation |
| FR-03.1-FR-03.8 | AC-07-AC-11, AC-18; CT-F07-02 read-only clone validation and base-repository identity matrix |
| FR-04.1-FR-04.5 | AC-12, AC-17-AC-19 |
| FR-05.1-FR-05.6 | AC-13, AC-15-AC-16, AC-19 |
| FR-06.1-FR-06.5 | AC-14-AC-16; CT-F07-03 branch-ref validation and blank/override persistence matrix |
| FR-07.1-FR-07.4 | AC-15-AC-17; CT-F07-04 historical revision immutability |
| FR-08.1-FR-08.4 | AC-05, AC-12, AC-17-AC-19; CT-F07-05 renderer-close/restart and secret-boundary matrix |
| NFR-01-NFR-09 | AC-01-AC-19; CT-F07-06 bounded, deterministic, accessible, credential-free conformance run |
| INV-01-INV-09 | AC-02, AC-05-AC-06, AC-08-AC-11, AC-14-AC-18; CT-F07-01 through CT-F07-05 |

## Out of Scope

- **General GitHub REST implementation** - F06 owns URL parsing mechanics, resource requests, response codecs, pagination, conditional requests, and transport error normalization; F07 consumes those contracts.
- **Polling, feedback eligibility, batching, and AI dispatch** - F10-F12 own remote observation and scheduling. F07 does not decide whether a PR has actionable feedback.
- **Git fetch, worktree creation, merge, validation, commit, or publication** - F13-F14 and F23-F27 own operation worktrees and external effects. F07 only performs bounded read-only local-clone inspection.
- **Automatic cloning or repository bootstrap** - If no clone is available, F07 records `LOCAL_CLONE_REQUIRED`; automatic cloning is a future enhancement.
- **Review Bundle and AI snapshots** - F07 owns the immutable PR configuration revision contract; F16/F18/F21 own the operation/bundle snapshot and AI usage behavior.
- **Synchronization resolution and confirmation** - F24 owns branch-source precedence, current SHA lookup, eligibility, and user confirmation; F07 only stores the optional override and PR base/head fields.
- **Managed-PR inbox ordering and multi-selection** - F08 owns the inbox projection and selection UI.
- **Credential setup, token rotation, and publication authorization** - F05 and F23/F27 own those boundaries.
- **Unmanage/archive/delete workflow** - F07 does not delete a managed PR or its history; a later lifecycle feature may define explicit archival semantics.

## Product Decisions

- **PD-01: URL-only onboarding is valid** - A developer can save an accessible PR with no local clone, with `LOCAL_CLONE_REQUIRED` visible as setup status. Work that needs a local repository must remain blocked until a valid clone is attached.
- **PD-02: The base repository is the local-clone identity boundary** - A selected clone must prove the PR base repository. Fork head identity is stored separately and is resolved by later Git/worktree services; a same-named repository is never good enough.
- **PD-03: Dirty clones are usable but untouched** - A dirty or untracked developer clone may be associated so long as it is structurally valid and identity-matched. F07 records a bounded status and never alters the files.
- **PD-04: Discovery is bounded** - F07 suggests only known/previously validated candidates and user-selected locations. It does not perform a broad filesystem search or automatic clone.
- **PD-05: Default branch is informational** - A blank synchronization override means that F24 will use the PR's `base.ref`; F07 never chooses the repository API's `default_branch` as a substitute.
- **PD-06: Configuration edits are revisioned** - New Intent / Context or override values affect future explicitly started work only. Existing bundles, operations, approvals, and history retain their original snapshots.
- **PD-07: User context is informative** - PR Intent / Context is preserved as the user entered it, but deterministic repository and validation evidence wins if the text conflicts with reality.
- **PD-08: No partial remote identity** - A failed metadata request never creates a managed PR with guessed or incomplete repository/ref identity.
- **PD-09: Use explicit F07 input bounds** - PR URLs are limited to 2,048 UTF-8 bytes, Intent / Context to 32 KiB, branch overrides to 255 UTF-8 bytes, canonical paths to 4,096 UTF-16 code units, local Git output to 64 KiB per stream, safe reason detail to 8 KiB, and local Git inspection to 10 seconds.

## Implementation Decisions

- **IMP-01: Reuse F06 identity and REST contracts** - F07 does not implement a second URL parser, GitHub HTTP client, server selector, or remote identity type.
- **IMP-02: Use F03 additive repositories and transactions** - Managed PR creation, Add PR attempts, local-clone association, and configuration revisions use the existing main-process persistence/transaction boundary and explicit optimistic versions.
- **IMP-03: Use a read-only local Git inspector** - The inspector invokes a small allowlisted set of Git commands with argument vectors, bounded output, controlled environment, and cancellation; it never invokes fetch or a mutating Git command.
- **IMP-04: Match local remotes by parsed identity** - Local remote URLs are converted to safe server/owner/repository identity values compatible with F06; raw remote URLs and credential-bearing URL components are not persisted or displayed.
- **IMP-05: Keep setup status separate from review state** - `LOCAL_CLONE_REQUIRED`, `VALID`, `DIRTY`, `MISSING`, and `INVALID` are local-access/read-model statuses, not additions to F02's primary PR state machine.
- **IMP-06: Use immutable configuration revisions** - The current managed-PR projection points to a revision record containing context, override, source metadata, and a content hash; downstream operations copy the revision into their own immutable snapshots.
- **IMP-07: Use the main process for path selection and validation** - Renderer input is a request only. The main process/OS adapter supplies the folder picker result, canonicalizes it, applies path policy, and performs Git inspection before persistence.

## Testing Decisions

- **TST-01: Contract-test F06 handoff rather than duplicate HTTP behavior** - F07 uses fake F06 results for URL/metadata success and each safe failure class; URL parser and transport implementation remain F06-owned.
- **TST-02: Test local Git inspection deeply** - Temporary repositories cover matching base remotes, forks, same-name mismatches, missing/bare/non-repository paths, dirty/untracked files, malformed remotes, moved paths, bounded output, and read-only command enforcement.
- **TST-03: Fault-inject persistence and lifecycle boundaries** - Tests cover before/after Add PR intent, after metadata retrieval, before/after aggregate commit, renderer closure, cancellation, restart, duplicate submission, and stale configuration edits.
- **TST-04: Prove historical isolation** - A fixture creates an operation/bundle snapshot, edits the current PR configuration, and verifies that the prior snapshot and its content hash remain byte-for-byte unchanged.
- **TST-05: Exercise UI boundary and accessibility** - Add/details tests cover keyboard order, labels, error association, status announcements, folder-picker handoff, read-model hydration, and no-secret serialization.
- **TST-06: Defer owning workflow tests** - F07 does not duplicate polling, AI, worktree mutation, validation execution, notification, synchronization merge, or publication tests.

## Proposed Modules

- **MOD-01: Add PR Coordinator** - Coordinates parse/verify, persist-before-fetch, F06 metadata retrieval, aggregate creation, idempotency, and safe recovery outcomes.
- **MOD-02: Managed PR Repository/Read Model** - Reads and writes canonical managed-PR projections, remote snapshots, setup status, and navigation-safe DTOs through F03.
- **MOD-03: Local Clone Candidate Index** - Returns bounded previously known candidates for a server-scoped base repository and records no broad filesystem search.
- **MOD-04: Local Git Inspector** - Validates a selected path, parses safe remote identities, detects non-bare/dirty status, and rejects unsafe or ambiguous results without mutation.
- **MOD-05: PR Configuration Revision Service** - Validates, versions, and atomically saves PR Intent / Context and synchronization overrides with optimistic concurrency.
- **MOD-06: Add/Manage IPC and Renderer Surface** - Exposes typed read models and explicit commands for add, attach/clear clone, save configuration, retry, and recovery without making renderer state authoritative.
- **MOD-07: Safe Reason and Recovery Mapper** - Converts F03/F05/F06/path/Git outcomes into bounded user-actionable reasons and local setup statuses.

## Workflows

### Workflow 1: Add a PR with a known valid clone

```text
1. The developer pastes a supported PR URL.
2. F06 parses it; F07 resolves the matching verified F05 server profile.
3. F07 persists the Add PR intent and immutable parsed-input snapshot.
4. F06 retrieves and validates PR metadata.
5. F07 presents the remote summary and bounded known clone candidates.
6. The developer selects a matching candidate.
7. The main process validates the clone read-only and records its root and safe status.
8. F07 atomically commits the managed PR, initial configuration revision, remote snapshot, and clone association.
9. The details view shows the managed PR and its setup status from the persisted read model.
```

### Workflow 2: Add a PR without a local clone

```text
1. The developer submits a valid URL and reviews successful remote metadata.
2. No suitable known candidate is available, so the developer chooses Add without local clone.
3. F07 commits the managed PR and initial configuration with LOCAL_CLONE_REQUIRED.
4. The application explains that later local review/synchronization work requires attaching an existing clone.
5. F07 does not clone, fetch, checkout, reset, clean, create a worktree, or invoke an AI provider.
```

### Workflow 3: Reject an invalid clone safely

```text
1. The developer chooses a directory or a known candidate.
2. The main process canonicalizes the path and runs bounded read-only Git inspection.
3. A missing, bare, non-Git, inaccessible, ambiguous, or identity-mismatched result is returned with what/why/next reason data.
4. No Git mutation, network fetch, or managed-PR replacement occurs.
5. The developer selects another path or explicitly continues without a clone.
```

### Workflow 4: Edit PR configuration while history exists

```text
1. The details screen reads the current managed-PR configuration revision.
2. The developer edits multi-line Intent / Context or the optional branch override.
3. F07 validates both values and submits the expected managed-PR revision.
4. F03 commits a new immutable configuration revision and updates the current pointer atomically.
5. A stale renderer receives a conflict and must reload before retrying.
6. Existing Review Bundles/AI operations still reference their prior snapshot; no hold or worktree changes occur.
```

### Workflow 5: Renderer close or restart during Add PR

```text
1. F07 has a durable Add PR intent or a committed managed-PR record.
2. The renderer closes or the process stops at a defined boundary.
3. On restart, F03 exposes the attempt/managed-PR outcome and safe recovery reason.
4. A new renderer hydrates from the main-process read model.
5. A retry reuses the existing operation/identity where safe and never duplicates a successful aggregate commit.
```
