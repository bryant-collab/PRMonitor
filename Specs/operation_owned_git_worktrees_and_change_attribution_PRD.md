# F13 Operation-owned Git Worktrees and Change Attribution - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F03 - SQLite persistence, migrations, and transactional repositories | Provides durable worktree, diff, operation-intent, snapshot, and restart-safe repository contracts. |
| 2 | F04 - Persistent Electron shell, IPC boundary, and Windows virtual-desktop spike | Provides the main-process authority and OS adapter boundary used for open/reveal actions. |
| 3 | F06 - GitHub REST client and remote identity model | Supplies server-scoped repository/ref identity and current remote metadata without exposing provider credentials. |
| 4 | F07 - Add and manage a pull request | Supplies the validated base clone, explicit PR base/head repositories and branches, current PR SHAs, and local setup status. |
| 5 | F11 - Event eligibility, deduplication, and per-PR review holds | Supplies the held operation/bundle ownership that must be revalidated before a review worktree is prepared or changed. |
| 6 | F12 - Review batching, scheduler, Check Now, and global pause | Supplies durable batch and operation identities for automatic review work and distinguishes automatic dispatch from explicit work. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F14 - Deterministic validation runner and result model | Runs approved commands only after F13 reports the actual operation worktree state and records the worktree identity. |
| 2 | F15-F17 - AI contracts, preferences, and bounded work controller | Use F13's isolated path, policy boundary, before/after turn snapshots, diff evidence, and deterministic state fingerprints. |
| 3 | F18 - Automatic review-to-Review-Bundle vertical slice | Prepares review worktrees at the exact PR head and consumes the proposed/context diff contract. |
| 4 | F19-F23 - Notifications, Review Bundle UI, revisions, stale handling, and publication | Present/open/reveal worktrees, show exact diffs, handle dirty-worktree choices, and publish only an approved proposed diff. |
| 5 | F24-F27 - Managed PR branch synchronization | Use separate synchronization worktrees and exact source/head/merge-base identities without reusing review worktrees. |
| 6 | F28-F30 - Recovery, security, and release readiness | Reconcile interrupted Git effects, validate the security boundary, and exercise clean-machine/worktree acceptance. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-10 | FR-02.1-FR-04.5, INV-01-INV-04 | AC-02-AC-05, AC-15 | Primary: F13 creates and owns isolated operation worktrees; downstream AI/review services consume the contract. |
| APP-AC-21 | FR-05.1-FR-05.6, INV-07-INV-08 | AC-06-AC-07, AC-10 | Shared: F13 produces authoritative deterministic diff evidence; F20 owns the read-only diff presentation. |
| APP-AC-26 | FR-02.6, FR-08.4, INV-05, INV-07 | AC-06, AC-15 | Shared: F13 detects ref/worktree drift and blocks unsafe reuse; F22/F23 own stale-result and publication enforcement. |
| APP-AC-37 | FR-01.1-FR-01.6, INV-02 | AC-01, AC-15 | Shared: F13 validates and snapshots the effective root; F16 owns the preference surface and future-only setting changes. |
| APP-AC-38 | FR-06.1-FR-06.5, INV-02 | AC-08 | Shared: F13 provides a safe open/reveal capability for a managed path; F19/F20 own notification and screen controls. |
| APP-AC-39 | FR-05.1-FR-05.6, FR-07.1-FR-07.8, INV-06-INV-08 | AC-09-AC-14, AC-17 | Primary for preservation, inspection, attribution, and no-guessing cleanup; F22 owns discard/re-evaluate orchestration. |
| APP-AC-44 | FR-02.1, FR-02.6, FR-08.2, INV-05 | AC-02, AC-05 | Shared: F13 requires explicit branch/repository/SHA identity and never substitutes a default branch; F24 owns synchronization-source selection. |
| APP-AC-46 | FR-03.1, FR-04.3, FR-08.1 | AC-05, AC-15 | Shared: F13 owns independent operation paths; F24-F27 own per-PR synchronization results. |
| APP-AC-49 | FR-04.5, FR-05.4-FR-05.5, FR-08.2 | AC-05-AC-07, AC-15 | Shared: F13 records worktree/ref/diff evidence; F24-F27 own result status, conflicts, validation, and user-facing explanation. |
| APP-AC-51 | FR-02.6, FR-08.4, INV-05 | AC-06, AC-15 | Shared: F13 detects source/head movement and blocks unsafe reuse; F24-F27 own re-evaluation/discard and publication gating. |
| APP-AC-53 | FR-03.2-FR-03.6, FR-08.4 | AC-04, AC-15 | Shared: F13 makes worktree preparation/recovery idempotent; F27 owns merge/publication idempotency. |
| APP-AC-56 | FR-05.2-FR-05.3, FR-09.1 | AC-06, AC-10 | Shared: F13 supplies actual file evidence and state fingerprints; F17 owns the complete AI Work Turn Report. |
| APP-AC-67 | FR-02.1-FR-02.6, FR-05.1-FR-05.6, INV-05, INV-07 | AC-02-AC-07, AC-10 | Shared: F13 records the three SHA snapshots and reproducible diff inputs; F20 exposes them and F23 enforces publication selection. |
| APP-AC-76 | FR-02.5, FR-05.4-FR-05.5, FR-08.2 | AC-05-AC-07 | Shared: F13 supplies exact source/head/merge-base and change evidence; F26/F27 own semantic conflict resolution and validation. |
| INV-01, INV-02, INV-03, INV-04, INV-05, INV-06, INV-07, INV-08, INV-09, INV-10 | All FR groups | AC-01-AC-18 | Primary for the worktree-specific deterministic, isolation, attribution, and authority invariants; downstream features retain their own external-effect boundaries. |

## Executive Summary

PRMonitor needs a private, inspectable local workspace for every operation that
may change code. A developer's normal clone may contain unfinished edits,
untracked files, local builds, or work for another task. Reusing it would risk
data loss, make an AI result impossible to reproduce, and make it unclear which
changes are safe to publish.

F13 provides the deterministic Git/worktree boundary for review, conversation,
and synchronization operations. It resolves an explicit repository/ref
identity, prepares a clean operation-owned worktree at the recorded commit,
records `prBaseSha`, `prHeadSha`, `worktreeBaselineSha`, and synchronization
merge-base evidence, and refreshes all result data from actual Git state. It
also records immutable before/after snapshots around mutating AI turns so the
application can distinguish operation changes from later manual edits.

The feature makes the worktree a user-accessible workspace without making it a
second uncontrolled developer clone. Users can open or reveal it, inspect the
complete proposed and contextual diffs, and choose how to handle dirty changes.
**Clear Only AI Changes** uses deterministic three-way removal and stops on
overlap; it never guesses which lines belong to the user. F13 never invokes an
AI provider, runs validation, commits, pushes, posts responses, merges, or
publishes.

## User Stories

### Prepare isolated operation work

- **US-01:** **GIVEN** an eligible review operation has an explicit base clone and current PR identity, **WHEN** preparation starts, **THEN** PRMonitor creates a clean worktree under the configured root at the exact PR head commit and records the base/head/baseline snapshots before downstream work begins.
  - **Acceptance Criteria:** AC-01-AC-04, AC-15.
- **US-02:** **GIVEN** a PR has no usable local clone, missing refs, or mismatched repository identity, **WHEN** a worktree is requested, **THEN** no worktree or developer-workspace mutation occurs and the user receives a bounded actionable reason.
  - **Acceptance Criteria:** AC-02, AC-03, AC-15-AC-16.

### Keep concurrent work separate

- **US-03:** **GIVEN** review, conversation, and synchronization operations overlap for one or more PRs, **WHEN** they prepare worktrees, **THEN** each operation receives an independent owned path and one operation cannot reuse, overwrite, or silently change another operation's path or baseline.
  - **Acceptance Criteria:** AC-04-AC-05, AC-15.

### Inspect the actual worktree

- **US-04:** **GIVEN** an operation worktree may have been changed by AI, the developer, a build, or a test, **WHEN** PRMonitor refreshes it, **THEN** the result is based on current Git state and exposes the exact proposed diff relative to `worktreeBaselineSha` separately from the contextual diff relative to `prBaseSha`.
  - **Acceptance Criteria:** AC-06-AC-10.
- **US-05:** **GIVEN** a user wants to inspect a result, **WHEN** they choose to open or reveal its worktree or a file within it, **THEN** the operating-system action targets only the recorded managed path and reports a safe remediation if that path is unavailable.
  - **Acceptance Criteria:** AC-08, AC-16.

### Preserve and attribute changes safely

- **US-06:** **GIVEN** a mutating AI turn is about to start or has finished, **WHEN** F13 records the worktree, **THEN** it stores immutable before/after snapshots and a deterministic change summary linked to that turn.
  - **Acceptance Criteria:** AC-09-AC-10.
- **US-07:** **GIVEN** discard or re-evaluation would affect a dirty operation worktree, **WHEN** the user is asked how to proceed, **THEN** the application shows the current change summary and offers **Clear All Changes**, **Clear Only AI Changes**, or **Keep Worktree and Cancel** before any destructive action.
  - **Acceptance Criteria:** AC-11-AC-14.
- **US-08:** **GIVEN** AI and manual changes overlap, **WHEN** the user chooses **Clear Only AI Changes**, **THEN** the operation stops without modifying the worktree and explains that manual resolution or preservation is required.
  - **Acceptance Criteria:** AC-12-AC-14, AC-17.

### Recover without losing evidence

- **US-09:** **GIVEN** Git work is interrupted, the renderer closes, or the application restarts, **WHEN** the operation is resumed or inspected, **THEN** its ownership, path, refs, snapshots, current Git state, and uncertain cleanup outcome remain available and no retry creates a second worktree for the same operation.
  - **Acceptance Criteria:** AC-04-AC-05, AC-15-AC-18.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** the effective isolated-worktree root is missing, invalid, outside the local path policy, or equal to/inside a registered developer clone, **WHEN** F13 resolves it, **THEN** it rejects the root with a bounded reason and does not create or remove files; a valid root is canonicalized and its exact resolved value is snapshotted for future work.
- **AC-02:** **GIVEN** a review worktree request contains explicit base/head repository identities, `prBaseSha`, and `prHeadSha`, **WHEN** preparation begins, **THEN** F13 persists the operation/worktree intent before fetch or creation, obtains the exact required objects through the approved Git source, and never substitutes a repository default branch, same-named branch, or guessed SHA.
- **AC-03:** **GIVEN** the exact requested commits are available and the operation owns a free path, **WHEN** F13 prepares a review worktree, **THEN** it creates a clean detached worktree under the configured root at `prHeadSha`, records `prBaseSha`, `prHeadSha`, and `worktreeBaselineSha`, and confirms no tracked, staged, or untracked changes exist before downstream work starts.
- **AC-04:** **GIVEN** two requests use the same or different operation identities, **WHEN** they race to prepare worktrees, **THEN** one operation cannot claim another operation's path, an idempotent replay returns the existing owned record, and a different operation receives a typed conflict without overwriting the existing worktree.
- **AC-05:** **GIVEN** a synchronization operation requests a worktree, **WHEN** F13 prepares it, **THEN** it uses a path and ownership record distinct from every review, conversation, and other synchronization operation, records the exact source/destination repositories and branches, `syncSourceSha`, `prHeadSha`, and `syncMergeBaseSha`, and never reuses a Review Bundle worktree.
- **AC-06:** **GIVEN** a worktree is inspected before an AI turn, validation, refresh, or publication, **WHEN** F13 reads its current state, **THEN** it reports the current HEAD, index, tracked worktree changes, untracked files, relevant Git errors, and a state fingerprint derived from actual bounded Git evidence; it never relies on a prior cached status or model prose.
- **AC-07:** **GIVEN** the same worktree state and SHA snapshots are inspected twice, **WHEN** F13 materializes diff evidence, **THEN** the proposed-worktree diff is compared with `worktreeBaselineSha`, the PR-context diff is compared with `prBaseSha`, both have stable hashes and file metadata, the same state produces the same evidence without mixing the two meanings, and F13 provides no per-hunk acceptance or silent partial-patch reconstruction.
- **AC-08:** **GIVEN** a recorded worktree or file is available, **WHEN** a caller requests open/reveal, **THEN** F13 passes only a canonical path within the operation-owned worktree to the OS adapter, never the developer clone or an arbitrary caller path; missing or unsupported paths produce an actionable result without changing Git state, and the persisted resolved path remains inspectable/copyable after a root-setting change or renderer recreation.
- **AC-09:** **GIVEN** a developer edits, builds, or tests inside an operation worktree, **WHEN** F13 or a downstream consumer refreshes it, **THEN** the manual changes remain in place and are reflected in the current status, deterministic diff, snapshot, and validation input; F13 never resets, cleans, checks out, or overwrites them implicitly.
- **AC-10:** **GIVEN** a worktree-mutating AI turn has an authorized operation identity, **WHEN** it starts and completes or fails, **THEN** F13 persists immutable before/after snapshots containing the actual Git state and a deterministic change summary linked to the turn, including new/deleted/renamed/binary evidence when available.
- **AC-11:** **GIVEN** discard or re-evaluation would remove or replace a dirty operation worktree, **WHEN** the user reaches the worktree-change decision, **THEN** the application shows the current change summary and does not mutate the worktree until the user explicitly selects **Clear All Changes**, **Clear Only AI Changes**, or **Keep Worktree and Cancel**.
- **AC-12:** **GIVEN** the user explicitly confirms **Clear All Changes**, **WHEN** F13 re-inspects the owned worktree and performs the operation, **THEN** it removes tracked/staged and non-ignored untracked changes only from that operation worktree, leaves the developer workspace untouched, records the destructive action and removed/preserved summary, and re-inspects and records the resulting state; ignored files are not silently deleted.
- **AC-13:** **GIVEN** the user explicitly selects **Clear Only AI Changes**, **WHEN** F13 compares the before-AI snapshot, after-AI snapshot, and current worktree using a deterministic three-way algorithm, **THEN** it removes only non-overlapping AI-attributable changes, preserves independent manual changes, records what was removed/preserved/left, and leaves the worktree unchanged if any tracked, untracked, binary, rename, or deletion overlap cannot be separated safely.
- **AC-14:** **GIVEN** the user selects **Keep Worktree and Cancel** or safe AI-only removal detects overlap, **WHEN** the choice completes, **THEN** the worktree, snapshots, diff evidence, and result remain available for inspection and the operation is not falsely marked clean, discarded, or ready to publish.
- **AC-15:** **GIVEN** fetch, worktree creation, inspection, snapshot, or cleanup is interrupted, cancelled, times out, or returns an uncertain Git outcome, **WHEN** the process or renderer restarts, **THEN** the persisted intent and ownership record identify the last known state, retry/reconciliation reuses the operation identity, and F13 never creates a duplicate path or reports a side effect as successful solely because a command was started.
- **AC-16:** **GIVEN** a worktree path, Git ref, repository identity, or caller request is malformed, oversized, secret-bearing, or outside the operation boundary, **WHEN** F13 validates it, **THEN** it rejects the request before Git execution, emits a bounded safe reason, and does not persist credentials, raw authorization headers, provider SDK objects, arbitrary commands, or uncontrolled environment values.
- **AC-17:** **GIVEN** an attribution or cleanup request targets a worktree not owned by the declared operation, **WHEN** F13 checks the ownership and path record, **THEN** it refuses the request without inspecting or mutating the unrelated worktree and returns a conflict or security reason.
- **AC-18:** **GIVEN** any F13 operation completes, **WHEN** its effects and diagnostics are inspected, **THEN** F13 has emitted at most bounded safe activity and has not invoked an AI provider, validation command, GitHub mutation, response posting, commit, push, merge, or publication capability; all such actions remain downstream and explicit.

## Functional Requirements

### FR-01: Effective worktree-root and path contract

- FR-01.1: The application SHALL consume a validated application-level isolated-worktree root, defaulting to an application-data worktree directory when no user setting exists.
- FR-01.2: F13 SHALL canonicalize the effective root and reject missing, non-directory, unwritable, path-traversal, oversized, or developer-clone-equal/descendant roots before creating or removing files.
- FR-01.3: F13 SHALL derive operation paths from bounded server/repository/PR/operation identifiers and SHALL persist the exact canonical path actually used; a later root edit SHALL not move or rewrite an active worktree.
- FR-01.4: F13 SHALL keep operation-owned repository metadata, caches, and worktrees under the configured root or another explicitly recorded application-owned path, never inside the developer's normal working tree.
- FR-01.5: F13 SHALL treat a missing F07 local clone or an unproven base repository as a typed setup block; it SHALL not silently clone, select a same-named repository, or guess a source.
- FR-01.6: F13 SHALL expose the resolved root, operation path, ownership, availability, and safe failure reason through provider-neutral typed records rather than activity-log parsing.

### FR-02: Explicit remote/ref snapshots and source preparation

- FR-02.1: F13 SHALL require explicit server-scoped source and destination repository identities, branch/ref names, and exact commit SHAs from the owning workflow for every prepared operation.
- FR-02.2: Before a fetch or worktree-creation side effect, F13 SHALL persist an operation intent containing the operation kind, owner, source identities, SHA snapshot, root revision, idempotency identity, and correlation identity.
- FR-02.3: F13 SHALL fetch or materialize only the requested refs/objects through a bounded deterministic Git plan and SHALL verify that the resulting object belongs to the expected repository identity and commit SHA.
- FR-02.4: For review work, F13 SHALL record `prBaseSha` and `prHeadSha` from the prepared remote snapshot and SHALL record the exact checked-out commit separately as `worktreeBaselineSha`.
- FR-02.5: For synchronization work, F13 SHALL record `syncSourceSha`, `prHeadSha`, and the deterministic `syncMergeBaseSha` used to describe source-side and destination-side changes.
- FR-02.6: F13 SHALL fail closed on missing, moved, ambiguous, or mismatched refs and SHALL never replace an explicit PR base branch or configured synchronization override with a repository default branch.

### FR-03: Operation ownership, concurrency, and lifecycle

- FR-03.1: F13 SHALL support distinct operation kinds for review bundles, read-only/user-directed conversations that need a worktree, and branch synchronization, with one durable owner identity for each worktree.
- FR-03.2: F13 SHALL enforce unique ownership for canonical worktree paths and operation identities through the F03 persistence boundary, not an in-memory lock alone.
- FR-03.3: An idempotent retry of the same operation identity SHALL return the existing worktree/intent outcome; a different operation SHALL receive a typed conflict rather than reuse or overwrite it.
- FR-03.4: F13 SHALL persist lifecycle state before create, inspect, clear, replace, or delete effects and SHALL represent pending, active, dirty, interrupted, unknown, retained, cleared, and released outcomes separately.
- FR-03.5: F13 SHALL refuse implicit cleanup, reset, replacement, or deletion of an active or dirty worktree; cleanup requires an owning explicit action or a recovery decision with the actual state shown.
- FR-03.6: Startup recovery SHALL reconcile operation identities and actual paths before retrying any Git effect and SHALL preserve uncertain evidence when reconciliation cannot prove the outcome.

### FR-04: Isolated worktree preparation

- FR-04.1: F13 SHALL create a clean detached worktree under the operation root at the exact requested baseline commit and SHALL verify tracked, staged, and untracked cleanliness before reporting it ready.
- FR-04.2: F13 SHALL keep all file mutations and operation-owned Git metadata outside the developer's normal working directory; a dirty developer clone SHALL remain unchanged.
- FR-04.3: F13 SHALL prevent a review, conversation, or synchronization operation from resolving to a path already owned by another active operation, including after restart.
- FR-04.4: Only the declared owning operation may request mutating access, clear changes, or release its worktree; read/open/reveal actions do not grant mutation authority.
- FR-04.5: F13 SHALL report the worktree path, source repository, operation kind, baseline, availability, and ownership state to downstream features without exposing credentials or arbitrary local paths.

### FR-05: Actual-state inspection, snapshots, and diffs

- FR-05.1: F13 SHALL inspect the current worktree before every AI mutation, validation handoff, diff refresh, discard/re-evaluation decision, or publication preparation.
- FR-05.2: A worktree snapshot SHALL include the checked-out commit, index/worktree status, bounded file identities and change kinds, untracked/non-ignored files, relevant Git errors, and a stable state fingerprint derived from actual state.
- FR-05.3: F13 SHALL persist immutable before/after snapshots for every worktree-mutating AI turn and SHALL link them to the operation and turn identity.
- FR-05.4: The authoritative proposed-worktree diff SHALL compare the current operation worktree with `worktreeBaselineSha`; the PR-context diff SHALL compare it with `prBaseSha` and SHALL remain contextual rather than publication-authoritative.
- FR-05.5: Diff evidence SHALL include stable hashes, file metadata, additions/removals, new/deleted/renamed/binary indicators, and a complete-regeneration contract; truncation SHALL never be presented as a complete diff.
- FR-05.6: Re-inspection of unchanged actual state SHALL produce equivalent status, snapshot, and diff hashes, while any manual, build, test, or AI change SHALL be visible to downstream validation and review consumers.

### FR-06: Open/reveal operation-owned paths

- FR-06.1: F13 SHALL expose typed open-worktree, open-file, and reveal-file requests that accept only a recorded operation/worktree identity and an optional safe relative path.
- FR-06.2: F13 SHALL resolve and revalidate the canonical target beneath the recorded worktree path before calling the F04 OS adapter.
- FR-06.3: F13 SHALL never pass a developer-clone path, arbitrary caller path, raw URL, or unvalidated shell command to the OS adapter.
- FR-06.4: Unsupported, missing, moved, or inaccessible targets SHALL return a bounded reason with a permitted next action and SHALL not alter Git state.
- FR-06.5: The resolved path used by an operation SHALL remain inspectable and copyable after the application root setting changes or the renderer is recreated.

### FR-07: Manual-edit preservation and change attribution

- FR-07.1: F13 SHALL show or return an actual current-change summary before any destructive discard, replacement, re-evaluation, or clear action.
- FR-07.2: **Clear All Changes** SHALL require explicit destructive confirmation, revalidate operation ownership, remove tracked/staged and non-ignored untracked changes only from the target operation worktree, and re-inspect the result.
- FR-07.3: **Clear Only AI Changes** SHALL use the before-AI snapshot, after-AI snapshot, and current snapshot as a deterministic three-way input; filenames alone SHALL not establish ownership.
- FR-07.4: F13 SHALL preserve manual changes that are independent of AI changes, including unrelated tracked edits and safe untracked files, when performing AI-only removal.
- FR-07.5: If line, file, binary, rename, deletion, or untracked changes overlap or cannot be separated safely, F13 SHALL refuse AI-only removal without guessing and SHALL preserve the complete current worktree.
- FR-07.6: **Keep Worktree and Cancel** SHALL leave the worktree and all evidence intact and SHALL not mark the operation clean, discarded, or ready for publication.
- FR-07.7: After any clear operation, F13 SHALL refresh the actual state and record what was removed, what was preserved, and any remaining manual changes.
- FR-07.8: F13 SHALL not provide per-hunk acceptance or silently reconstruct a partial publication patch; downstream publication receives the complete current proposed diff for explicit approval.

### FR-08: Synchronization worktree boundary

- FR-08.1: F13 SHALL prepare synchronization worktrees independently from Review Bundle and conversation worktrees, even for the same managed PR.
- FR-08.2: Synchronization worktree records SHALL retain exact source/destination branch and repository identities, `syncSourceSha`, `prHeadSha`, `syncMergeBaseSha`, and resolved path.
- FR-08.3: F13 SHALL provide state, snapshot, diff, open/reveal, and dirty-change contracts to branch synchronization without performing the merge, conflict resolution, validation, commit, push, or publication.
- FR-08.4: A source/head movement or worktree mismatch SHALL become a typed stale/attention result and SHALL block unsafe reuse until the owning synchronization workflow explicitly re-evaluates it.

### FR-09: Trust boundary, diagnostics, and downstream contracts

- FR-09.1: F13 SHALL expose small provider-neutral contracts for preparation, inspection, snapshots, diffs, open/reveal, clear choices, ownership, and recovery; callers SHALL not parse Git output or activity text.
- FR-09.2: F13 SHALL use an allowlisted Git subprocess contract with bounded arguments, output, timeouts, cancellation, and a controlled non-secret environment.
- FR-09.3: F13 SHALL emit bounded F09 activity for intent, preparation, fetch, ownership conflicts, inspection, snapshot, diff, open/reveal, clear-choice, cleanup, and recovery outcomes without making activity authoritative.
- FR-09.4: F13 SHALL not import or invoke an AI provider and SHALL not expose GitHub credentials, provider SDK objects, prompts, arbitrary commands, validation authority, GitHub mutation, response posting, commit, push, merge, or publication capabilities.
- FR-09.5: F13 SHALL provide F15 only a validated provider-neutral worktree handoff containing the operation/worktree identity, canonical operation-owned path, ownership state, baseline/current revision evidence, and permitted capability scope. F15 may consume that handoff but SHALL not choose, rewrite, or treat provider-reported paths or changes as authoritative Git evidence.

## Non-Functional Requirements

- **NFR-01: Determinism** - Given the same validated operation input, Git object graph, worktree state, clock, and command contract, F13 SHALL produce the same path, ownership decision, snapshot, diff hash, attribution outcome, and safe reason without AI judgment.
- **NFR-02: Isolation and safety** - F13 SHALL never reset, clean, checkout, overwrite, or delete files in the developer's normal working directory, and each operation SHALL have a verifiable owner and path boundary.
- **NFR-03: Durability and recovery** - Operation intent, immutable SHA snapshots, worktree ownership, before/after turn snapshots, diff records, clear outcomes, and uncertain Git results SHALL survive renderer closure and ordinary restart.
- **NFR-04: Concurrency and idempotency** - Equal operation requests and recovery retries SHALL be idempotent; conflicting owners, roots, paths, and lifecycle revisions SHALL return typed conflicts without overwriting evidence.
- **NFR-05: Bounded resources** - Paths, refs, file counts, status output, diff metadata, subprocess time, retry/recovery scans, and diagnostics SHALL have explicit bounds; an over-limit result SHALL fail safe rather than truncate authoritative evidence silently.
- **NFR-06: Security and privacy** - Persisted and user-visible F13 records SHALL exclude credentials, authorization headers, provider SDK objects, prompts, secret-bearing environment values, arbitrary commands, and uncontrolled raw remote URLs.
- **NFR-07: Platform behavior** - Git execution and path handling SHALL work on the supported Windows runtime and keep OS-specific open/reveal behavior behind an adapter that can be implemented for later platforms.
- **NFR-08: Inspectability** - Every worktree and diff result SHALL identify the operation, repository/ref snapshot, baseline, current state, path, evidence hash, and next action without requiring free-form logs.
- **NFR-09: Testability** - Deep modules SHALL accept injected Git runners, clocks, filesystem/path adapters, persistence, cancellation, faults, and OS actions so tests use temporary repositories and no real provider credentials or GitHub mutation.

## Invariants

- **INV-01:** Git ref resolution, worktree creation/removal, status, snapshotting, diffing, path checks, overlap detection, and recovery decisions are deterministic software; F13 never asks an AI provider to operate the worktree machinery.
- **INV-02:** Only canonical paths under the configured operation-owned root may be created or mutated by F13; the developer's normal working directory is never an operation target.
- **INV-03:** The Electron main process and F03 repositories are authoritative for worktree ownership, intent, lifecycle, snapshots, diff records, and cleanup outcomes; renderer memory is never authoritative.
- **INV-04:** Intent and immutable input snapshots are durable before fetch, create, clear, replace, release, or delete side effects are attempted.
- **INV-05:** `prBaseSha`, `prHeadSha`, `worktreeBaselineSha`, and synchronization source/merge-base identities are explicit, scoped, and immutable for the operation result they describe.
- **INV-06:** A canonical worktree path has at most one active owner, and an operation cannot mutate a worktree after ownership is lost, released, or superseded.
- **INV-07:** Before every mutation, validation handoff, diff refresh, discard/re-evaluation, or publication preparation, F13 inspects actual Git state rather than trusting cached state or model claims.
- **INV-08:** Manual edits are preserved unless the user explicitly chooses a supported clear action; AI-only removal uses three-way evidence and never guesses across overlap.
- **INV-09:** The proposed-worktree diff relative to `worktreeBaselineSha` is distinct from the contextual PR diff relative to `prBaseSha`; only downstream human-approved logic may select a publication diff.
- **INV-10:** F13 has no AI, GitHub mutation, response-posting, commit, push, merge, validation, or publication authority, and no credential or provider object crosses its persistence or AI-facing boundary.

## Out of Scope

- **AI semantic judgment or code generation** - F15-F18 and F21 provide provider contracts and AI work; F13 only supplies deterministic local state.
- **Validation execution** - F14 owns command authorization and execution; F13 only reports the actual worktree state passed to it.
- **Review Bundle, diff-viewer, notification, tray, and settings UI** - F18-F20 and F19/F16 own presentation and controls; F13 provides typed records and safe OS actions.
- **GitHub authentication, remote API mutation, response posting, commit, push, or publication** - F05/F06 and F23/F27 own those effects.
- **Branch synchronization merge and semantic conflict resolution** - F24-F27 own source selection, merge, conflict resolution, validation, and publication; F13 only provides the independent worktree boundary.
- **Automatic cloning when no local clone exists** - F07 records missing clone setup; F13 returns a typed setup block rather than silently cloning.
- **Per-hunk acceptance, patch reconstruction, or filename-based AI/user ownership** - the MVP approves one complete proposed diff and stops on unsafe overlap.
- **Broad filesystem scanning, worktree pooling, or automatic deletion of old worktrees** - all path discovery and cleanup remains explicit and bounded.

## Product Decisions

- **PD-01: Use one operation-owned worktree per active operation** - Review, conversation, and synchronization work must never share a mutable path, even for the same PR.
- **PD-02: Keep the configured root and actual path separate** - the application setting chooses where future worktrees go; every result records the resolved path actually used so later setting changes cannot rewrite history.
- **PD-03: Preserve the three SHA meanings** - `prBaseSha` describes PR context, `prHeadSha` describes the remote PR head observed, and `worktreeBaselineSha` describes the exact local publication baseline; the normal review path expects the latter two to match but does not collapse them.
- **PD-04: Treat the developer clone as a read-only source** - F13 may read a validated local clone to prepare operation-owned repository data, but it never changes its files, index, branch, worktree state, or user edits.
- **PD-05: Clear All Changes excludes ignored files** - explicit destructive clearing removes tracked/staged and non-ignored untracked changes from the operation worktree; ignored build artifacts remain and are reported rather than silently deleted.
- **PD-06: Clear Only AI Changes is fail-closed** - deterministic three-way removal may preserve independent manual work, but any ambiguous overlap leaves the complete worktree untouched.
- **PD-07: Open/reveal is a capability, not mutation authority** - opening a worktree or file can be requested from the UI, tray, or notification, but it cannot bypass ownership, state inspection, or publication approval.
- **PD-08: No automatic cleanup on lifecycle events** - closing the window, pausing watching, a failed AI turn, or a restart does not delete or reset a worktree; an explicit owner/recovery decision is required.
- **PD-09: F15 receives a reference, not Git authority** - F13 owns the canonical path, worktree identity, actual Git state, and before/after snapshots. The F15 adapter receives the validated reference and may operate only within it; it cannot create paths, select a different worktree, or substitute provider claims for F13 evidence.

## Implementation Decisions

- **IMP-01: Use a thin allowlisted Git command runner** - F13 invokes direct Git argument vectors with bounded output, timeouts, cancellation, `GIT_TERMINAL_PROMPT=0`, locale normalization, and a controlled environment; it does not add a large Git framework.
- **IMP-02: Use an operation-owned repository source/cache** - F13 materializes the required objects under the application-owned root from the validated F07 clone or approved remote source before creating worktrees, so adding a worktree does not reset or checkout the developer clone. The source path and identity are recorded without persisting raw credential-bearing URLs.
- **IMP-03: Use detached worktrees at exact commits** - Review and synchronization preparation checks out the requested commit by SHA, not a moving branch name, and verifies clean state before returning.
- **IMP-04: Make path ownership transactional** - F03 uniqueness and expected-version checks reserve the canonical path before filesystem/Git effects and reconcile uncertain command outcomes by stable operation identity.
- **IMP-05: Represent snapshots as immutable evidence** - Each snapshot stores a bounded canonical status/file manifest and hash; complete diffs can be regenerated from the recorded worktree and SHA baseline, while over-limit evidence becomes an explicit attention result.
- **IMP-06: Use deterministic three-way removal** - AI-only clearing compares the pre-turn, post-turn, and current trees/patches, applies reverse AI hunks only when independent, and rejects unresolved line/file/binary/rename/untracked overlap.
- **IMP-07: Delegate OS actions through F04** - F13 passes validated canonical targets to an OS adapter for open/reveal; platform-specific shell invocation never enters the renderer or a Git command string.
- **IMP-08: Keep synchronization records independent** - The synchronization worktree references its own operation/result identity and never becomes a Review Bundle worktree through path reuse or record mutation.
- **IMP-09: Provider-facing handoff is reference-only** - Expose a bounded F13 handoff for F15 that is revalidated immediately before an AI mutation and after the turn. The handoff contains no SDK object, credential, arbitrary path, or provider authority, and the adapter's reported file changes remain non-authoritative until F13 inspects actual Git state.

## Testing Decisions

- **TST-01: Deep-test Git state transitions** - Temporary repositories cover clean/dirty/untracked/renamed/deleted/binary files, detached SHA preparation, ref movement, exact baseline/context diffs, and manual edits after AI snapshots.
- **TST-02: Deep-test attribution safety** - Test non-overlapping tracked and untracked AI changes, line overlap, file replacement, binary changes, rename/delete overlap, and every clear choice; assert that unsafe cases leave the worktree byte-for-byte unchanged.
- **TST-03: Fault-inject intent boundaries** - Exercise cancellation, process stop, timeout, Git failure, persistence failure, renderer closure, duplicate requests, path collision, and uncertain command outcomes before and after each durable commit.
- **TST-04: Prove developer-workspace protection** - Use a fixture clone with dirty tracked/untracked files and assert that every F13 operation leaves its HEAD, index, worktree files, branch, and status unchanged.
- **TST-05: Prove no-effect boundaries** - Use imports, spies, and capability fakes to prove F13 cannot reach AI, validation, GitHub mutation, response posting, commit, push, merge, or publication services.
- **TST-06: Defer visual fidelity to owners** - F13 tests typed path/open/reveal and reason contracts; F16/F19/F20/F22 own settings, accessibility, notification, diff-view, and destructive-confirmation presentation evidence.

## Proposed Modules

- **MOD-01: Worktree Root and Path Policy** - Canonicalizes the configured root, rejects unsafe nesting, and derives bounded operation paths.
- **MOD-02: Git Command Runner** - Runs allowlisted deterministic Git argument vectors with bounded output, timeout, cancellation, and controlled environment.
- **MOD-03: Operation Source/Ref Preparer** - Resolves explicit repository/ref identities, materializes exact objects, computes merge-base evidence, and verifies SHAs.
- **MOD-04: Worktree Ownership Repository/Lease Service** - Reserves paths, records lifecycle state, enforces one owner, and reconciles retries by operation identity.
- **MOD-05: Operation Worktree Manager** - Creates, inspects, retains, releases, and safely re-inspects review/conversation/synchronization worktrees.
- **MOD-06: Git State Snapshot Service** - Produces immutable current-state manifests, stable fingerprints, and before/after AI-turn evidence.
- **MOD-07: Proposed and Context Diff Service** - Materializes separate baseline-relative and PR-context-relative diffs with hashes and file metadata.
- **MOD-08: Change Attribution and Clear Service** - Presents current-change summaries, applies Clear All, performs three-way AI-only removal, and fails closed on overlap.
- **MOD-09: Managed Path Open/Reveal Adapter** - Validates recorded targets and delegates file-manager/default-application actions to F04.
- **MOD-10: Worktree Diagnostics and Downstream Contract** - Emits safe activity and exposes provider-neutral preparation, inspection, snapshot, diff, and recovery results.

## Workflows

### Workflow 1: Prepare a review worktree

1. F18/F12 supplies a managed PR, operation identity, explicit base/head repository identities, `prBaseSha`, and `prHeadSha`.
2. F13 validates the configured root and confirms F07 has a matching local clone/source.
3. F13 persists operation intent, SHA snapshots, root revision, and canonical target path before any fetch or Git worktree effect.
4. F13 materializes the exact requested objects in operation-owned Git data and verifies both SHAs.
5. F13 creates a detached worktree at `prHeadSha`, records `worktreeBaselineSha`, and inspects actual state.
6. F13 returns a clean owned worktree contract; only then may F14-F18 start validation or AI work.

### Workflow 2: Refresh a changed worktree

1. A downstream boundary asks F13 to refresh an owned worktree.
2. F13 verifies owner, canonical path, operation status, and current HEAD.
3. F13 collects bounded status, file manifest, snapshot, proposed diff, and context diff from actual Git state.
4. F13 persists immutable evidence and returns a state fingerprint plus safe reason if the worktree is missing, dirty, stale, or over limit.
5. The caller decides whether to validate, continue AI work, request user input, or stop; F13 does not infer the semantic next step.

### Workflow 3: Attribute an AI turn and clear only its changes

1. The owning AI controller asks F13 for a before-turn snapshot and receives an operation-bound mutation contract.
2. The provider changes only the operation-owned worktree.
3. F13 takes an after-turn snapshot and computes the deterministic AI change set.
4. If the user later chooses Clear Only AI Changes, F13 re-inspects the current worktree and compares before, after, and current state.
5. F13 applies reverse AI changes only where the three-way result is non-overlapping.
6. On any ambiguous overlap, F13 makes no mutation and returns Keep Worktree and Cancel / manual-resolution guidance with the evidence preserved.

### Workflow 4: Prepare an independent synchronization worktree

1. F24 supplies a synchronization operation with source/destination repositories, branches, exact SHAs, and an operation identity.
2. F13 allocates a distinct path and persists the intent before materializing source/head objects.
3. F13 computes and records `syncMergeBaseSha`, creates a detached worktree at `prHeadSha`, and confirms it is clean.
4. F24-F27 perform the merge/conflict-resolution workflow in that worktree.
5. F13 continues to provide actual-state, snapshot, diff, open/reveal, and dirty-change evidence without performing or publishing the merge.

### Workflow 5: Recover an interrupted worktree effect

1. Startup loads pending/active/unknown F13 intents and path ownership records.
2. F13 checks the actual path, Git worktree list, HEAD, status, and stored operation identity before retrying.
3. If the prior effect is provably complete, F13 adopts the existing record; if absent, it retries the same intent; if ambiguous, it preserves the path/evidence and returns a reconciliation-required reason.
4. A renderer can close and reopen without changing the owner, baseline, snapshots, or clear decision.

## Contract-Test Criteria

- **CT-F13-01:** Root/path policy tests cover defaults, canonicalization, unsafe nesting, path bounds, root changes, missing local clones, operation path derivation, and no developer-workspace mutation.
- **CT-F13-02:** Source/ref tests cover explicit server/repository/branch/SHA identity, exact object verification, fork/same-name isolation, ref movement, merge-base calculation, default-branch non-substitution, and missing/ambiguous refs.
- **CT-F13-03:** Ownership/lifecycle tests cover operation-kind separation, unique path reservation, idempotent replay, concurrent races, persist-before-Git, restart, renderer closure, cancellation, timeout, persistence faults, and uncertain command reconciliation.
- **CT-F13-04:** Worktree inspection/diff tests cover clean preparation, status manifests, stable fingerprints, proposed versus context diff semantics, new/deleted/renamed/binary files, complete-regeneration hashes, and over-limit safe failure.
- **CT-F13-05:** Attribution tests cover before/after AI snapshots, independent manual changes, tracked/untracked changes, line/file/binary/rename/delete overlap, reverse application, no-op clearing, and byte-for-byte preservation on unsafe overlap.
- **CT-F13-06:** Open/reveal and boundary tests cover canonical target validation, file-relative path escape, missing targets, OS adapter calls, bounded reasons, forbidden imports, controlled Git environment, and zero AI/validation/publication effects.
- **CT-F13-07:** End-to-end fixture tests cover review and synchronization worktree non-collision, dirty-worktree choice flows, restart/readback, actual diff refresh after build/test/manual edit, downstream typed handoff, and application-coverage conformance.

## Requirement Traceability

| Requirement family | Observable coverage |
|---|---|
| FR-01 | AC-01, AC-04, AC-08, AC-15-AC-17; CT-F13-01, CT-F13-03, CT-F13-06 |
| FR-02 | AC-02-AC-05, AC-15-AC-16; CT-F13-02, CT-F13-03 |
| FR-03 | AC-04-AC-05, AC-15, AC-17; CT-F13-01, CT-F13-03, CT-F13-07 |
| FR-04 | AC-03-05, AC-09, AC-15, AC-17; CT-F13-01, CT-F13-03, CT-F13-07 |
| FR-05 | AC-06-07, AC-09-10, AC-14; CT-F13-04, CT-F13-05, CT-F13-07 |
| FR-06 | AC-08, AC-16; CT-F13-06 |
| FR-07 | AC-09, AC-11-14, AC-17; CT-F13-05, CT-F13-07 |
| FR-08 | AC-05, AC-14-15; CT-F13-02, CT-F13-03, CT-F13-07 |
| FR-09 | AC-06, AC-08, AC-15-18; CT-F13-03, CT-F13-06, CT-F13-07 |
| NFR-01-NFR-09 | AC-01-AC-18; CT-F13-01-CT-F13-07 |
| INV-01-INV-10 | AC-01-AC-18; CT-F13-01-CT-F13-07 |
