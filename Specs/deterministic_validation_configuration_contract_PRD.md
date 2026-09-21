# F00 Deterministic Validation Configuration Contract - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

None. This feature resolves a pre-implementation product decision and establishes a contract that later application features consume.

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F01 - Application workspace and engineering foundation | F01 must preserve the versioned validation contract and its conformance tests when it establishes the application workspace. |
| 2 | F03 - SQLite persistence, migrations, and transactional repositories | F03 persists validation profiles, approvals, immutable run snapshots, command results, and manual-check records defined here. |
| 3 | F09 - Durable activity log and operation diagnostics | F09 records the lifecycle and machine-readable reasons defined by this contract without treating logs as application state. |
| 4 | F13 - Operation-owned Git worktrees and change attribution | F13 supplies the operation-owned worktree against which validation working directories are resolved. |
| 5 | F14 - Deterministic validation runner and result model | F14 executes this contract and persists the resulting evidence. |
| 6 | F16 - AI preferences, task-profile snapshots, execution policies, and Common Instructions | F16 provides the settings surface through which repository validation profiles and approvals are managed. |
| 7 | F18 - Automatic review-to-Review-Bundle vertical slice | F18 consumes validation snapshots and results when preparing a Review Bundle. |
| 8 | F23-F25 - Branch synchronization preparation, execution, review, and publication | Synchronization uses the same command selection, trust, execution, and result semantics rather than inventing another validation path. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-13 | FR-03.1-FR-04.8, FR-07.1-FR-07.3, INV-01 | AC-05-AC-10, AC-13 | Primary |
| APP-AC-73 | FR-01.8-FR-01.9, FR-04.1-FR-04.2, FR-06.4-FR-07.3, INV-01-INV-02, INV-06 | AC-15-AC-17 | Shared enabler: F00 owns phase-aware validation configuration and evidence; F18/F20/F23 own when to invoke baseline/post-change/final checks and how they are presented. |
| APP-AC-74 | FR-01.8-FR-01.9, FR-02.1-FR-02.7, FR-07.1-FR-07.3, INV-01-INV-02, INV-08 | AC-15-AC-17 | Shared enabler: F00 owns the safe distinction between human-readable instructions and executable commands; F16/F18 own settings and review-context integration. |
| APP-AC-39 | FR-06.1-FR-06.5, FR-07.1 | AC-11, AC-13 | Shared enabler: owns validation/manual-evidence revision binding only; F13/F20 own dirty-worktree preservation and choices. |
| APP-AC-48 | FR-01.1-FR-05.7, FR-07.1-FR-07.3, INV-01-INV-04 | AC-01-AC-10, AC-13 | Shared enabler: owns deterministic validation configuration/evidence only; F23-F24 own conflict resolution and result integration. |
| APP-AC-49 | FR-04.1-FR-07.3 | AC-07-AC-13 | Shared enabler: owns serializable validation records and reason data only; F03/F24 own synchronization-result persistence and presentation. |
| APP-AC-57 | FR-04.3-FR-04.8, FR-07.2-FR-07.3 | AC-06-AC-07, AC-13 | Shared enabler: supplies deterministic validation stop evidence only; F17 owns AI progress and `NEEDS_ATTENTION` decisions. |

## Executive Summary

PRMonitor needs trustworthy evidence about tests and other validation without letting a repository, an AI provider, or a stale preference silently decide what code will run. Today the application overview intentionally leaves command provenance, confirmation, execution bounds, output handling, manual checks, and the no-command case unresolved. Every later review and branch-synchronization workflow would otherwise be forced to make its own incompatible decisions.

This feature establishes one validation configuration contract. A developer can save a validation profile for a managed repository, approve a checked-in `.prmonitor/validation.json` profile, or approve a proposed profile for one run. The profile can also carry human-readable repository-specific Build & Validation Instructions and phase-tagged commands for clean-baseline and post-change validation, which is important for large monorepos with non-standard build layouts. The application resolves exactly one source by a fixed precedence order, shows the effective instructions and commands before trust is granted, confines working directories to the operation-owned worktree, records real process outcomes, and makes missing or unsafe validation visible rather than guessing success.

The first implementation is the versioned, machine-readable contract and deterministic conformance logic. Process execution, durable storage, and the settings and results UI are integrated by the dependent features listed above.

## User Stories

### Configure validation

- **US-01:** **GIVEN** a developer manages a repository, **WHEN** they save a repository validation profile, **THEN** future operations can resolve the same reviewed commands without asking an AI provider to choose them.
- **US-02:** **GIVEN** a repository contains `.prmonitor/validation.json`, **WHEN** PRMonitor first encounters that exact configuration, **THEN** the developer sees its commands, working directories, time limits, and manual checks before deciding whether to trust it.
- **US-03:** **GIVEN** both application settings and a checked-in profile exist, **WHEN** validation is prepared, **THEN** the developer can predict which complete profile will be used from the documented precedence order.
  - **Acceptance Criteria:** AC-01, AC-15.

### Configure repository-specific build phases

- **US-09:** **GIVEN** a repository has a non-standard build layout, **WHEN** the developer configures Build & Validation Instructions, **THEN** they can provide human-readable guidance plus structured commands and identify whether each command applies to the clean baseline, the proposed changes, or both.
  - **Acceptance Criteria:** AC-15.
- **US-10:** **GIVEN** a review operation has an approved phase-aware profile, **WHEN** the operation prepares a Review Proposal, **THEN** baseline commands run against the clean PR-head worktree before AI proposal analysis, and post-change commands run only after accepted implementation decisions have produced a proposed worktree state.
  - **Acceptance Criteria:** AC-16, AC-17.

### Run and inspect validation safely

- **US-04:** **GIVEN** a trusted profile and an operation-owned worktree, **WHEN** validation runs, **THEN** every command executes in its declared in-worktree directory with a bounded time and a real recorded outcome.
- **US-05:** **GIVEN** validation produces large or sensitive output, **WHEN** the developer inspects the result, **THEN** the persisted output is bounded, visibly marked when truncated, and redacted before it is stored or displayed.
- **US-06:** **GIVEN** a command is cancelled, times out, or is interrupted by shutdown or restart, **WHEN** the result is shown, **THEN** it is never reported as passed and includes an actionable reason.

### Handle manual and unavailable validation

- **US-07:** **GIVEN** a repository requires a manual check, **WHEN** the developer records its outcome, **THEN** PRMonitor labels it as a human attestation and does not misrepresent it as a command whose exit status was observed.
- **US-08:** **GIVEN** no valid and trusted validation profile is available, **WHEN** an operation reaches validation, **THEN** PRMonitor records `not_run`, explains why, and allows the human-review workflow to continue with a visible warning.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** a one-run override, a saved repository profile, and a checked-in profile are all available and valid, **WHEN** PRMonitor resolves validation, **THEN** it selects the entire one-run profile; without that override it selects the entire saved profile; without either it selects the approved checked-in profile; it never merges commands from multiple sources.
- **AC-02:** **GIVEN** an unapproved checked-in profile, **WHEN** automatic work reaches validation, **THEN** no command from that profile runs and the result requires confirmation; **WHEN** the developer approves its displayed content hash for the managed repository, **THEN** that exact revision becomes eligible for later unattended runs.
- **AC-03:** **GIVEN** an AI provider proposes a validation command, **WHEN** the proposal is returned, **THEN** PRMonitor treats it as untrusted input and runs it only after the developer explicitly chooses **Run once** or saves and confirms it as repository settings.
- **AC-04:** **GIVEN** a validation profile has been resolved, **WHEN** a run is created, **THEN** the run records an immutable snapshot of the effective profile, source, approval identity or one-run authorization, configuration content hash, and repository identity before any command can start.
- **AC-05:** **GIVEN** a command whose working directory is `.`, a child directory, an absolute path, a parent traversal, or a symlink that resolves outside the operation worktree, **WHEN** the command is prepared, **THEN** only existing directories whose canonical path is inside the operation-owned worktree are accepted.
- **AC-06:** **GIVEN** a command reaches its configured timeout, **WHEN** the grace period expires, **THEN** PRMonitor terminates the command process tree, records `interrupted` with reason `TIMED_OUT`, preserves bounded/redacted output, and does not start a later command in that run.
- **AC-07:** **GIVEN** a validation run is active, **WHEN** the user cancels it, the application shuts down, or a prior process is found incomplete after restart, **THEN** the run and affected command are finalized as `interrupted` with the corresponding machine-readable reason and are not silently resumed or automatically rerun.
- **AC-08:** **GIVEN** stdout or stderr exceeds its byte limit, **WHEN** output is persisted, **THEN** PRMonitor retains the configured head and tail portions, records original and retained byte counts, inserts a visible truncation marker, and stores no unbounded copy.
- **AC-09:** **GIVEN** output contains a known credential value or a recognized sensitive key/value assignment, **WHEN** output crosses the runner boundary, **THEN** the sensitive value is replaced before persistence, logging, IPC, or display while non-sensitive diagnostic context remains readable.
- **AC-10:** **GIVEN** a command exits with code `0`, a non-zero code, cannot be started, times out, or is cancelled, **WHEN** its result is recorded, **THEN** the status is respectively `passed`, `failed`, `failed`, `interrupted`, or `interrupted`, and no model statement can change that result.
- **AC-11:** **GIVEN** a configured manual check, **WHEN** a developer records it, **THEN** the result stores who attested, when, the checked revision/worktree state, optional notes, and `verified`, `failed`, or `not_run`; the UI uses the words **Verified manually** rather than **Test passed** for a positive attestation.
- **AC-12:** **GIVEN** no valid and trusted profile resolves, **WHEN** validation is requested, **THEN** PRMonitor creates a completed validation record with status `not_run` and a specific reason such as `NO_PROFILE`, `CONFIRMATION_REQUIRED`, or `INVALID_PROFILE`; Review Bundle or synchronization-result preparation may continue, but validation is never shown as passing and publication requires the existing explicit human approval with the warning still visible.
- **AC-13:** **GIVEN** two consumers such as review preparation and branch synchronization use the same effective profile and worktree state, **WHEN** validation is evaluated, **THEN** they receive the same source-resolution, trust, path, timeout, status, redaction, aggregation, and snapshot behavior from the shared contract.
- **AC-14:** **GIVEN** a profile has an unsupported schema version, duplicate command or manual-check IDs, an invalid timeout or output limit, or no steps, **WHEN** it is loaded, **THEN** it is rejected before authorization or execution with field-specific errors and validation records `not_run` with reason `INVALID_PROFILE` if a run was requested.
- **AC-15:** **GIVEN** a valid profile contains human-readable Build & Validation Instructions and commands tagged `baseline`, `post_change`, or `both`, **WHEN** the profile is normalized and shown for approval, **THEN** the complete instructions, phase tags, commands, directories, limits, and manual checks are visible, the instructions remain non-executable context, and source resolution never merges steps from different profile sources.
- **AC-16:** **GIVEN** an approved baseline-capable profile and a clean PR-head worktree, **WHEN** a Review Proposal is prepared, **THEN** baseline commands run against that exact clean state, their real results are captured as baseline evidence, and a baseline failure is shown to the AI and developer without being misreported as a post-change failure or silently preventing semantic feedback analysis.
- **AC-17:** **GIVEN** accepted review decisions produce a proposed worktree state, **WHEN** post-change validation is prepared, **THEN** only commands tagged `post_change` or `both` run against that state, their real results are captured before final publication approval, and later publication re-checks the configured final-validation requirement without trusting model prose.

## Functional Requirements

### FR-01: Versioned validation profile and source resolution

- FR-01.1: The application SHALL define one versioned validation-profile format containing an ordered non-empty list of automated commands and/or manual checks.
- FR-01.2: Each automated command SHALL contain a stable ID, display label, executable, argument array, worktree-relative working directory, timeout, and per-stream output limit; a single shell command string SHALL NOT be accepted.
- FR-01.3: Each manual check SHALL contain a stable ID, display label, and instructions, and SHALL be visibly distinguishable from automated commands.
- FR-01.4: Validation profile sources SHALL have this precedence: an explicitly approved one-run override, saved per-repository application settings, an approved checked-in `.prmonitor/validation.json`, then no profile.
- FR-01.5: Source resolution SHALL select one complete profile and SHALL NOT merge steps from sources.
- FR-01.6: The MVP SHALL NOT automatically infer or execute commands from package manifests, build files, documentation, prior AI output, or process history.
- FR-01.7: A profile SHALL be invalid if its schema version is unsupported, its step IDs are not unique, it has no steps, or any required field, bound, or path syntax is invalid.
- FR-01.8: A profile MAY contain bounded human-readable `buildInstructions` for AI context and SHALL allow each command/manual-check step to declare `baseline`, `post_change`, or `both` applicability; omitted phase on a version-1 profile SHALL default to `post_change` for compatibility.
- FR-01.9: Phase-tagged steps SHALL remain part of one complete selected profile; source resolution SHALL not merge baseline steps from one source with post-change steps from another source.

### FR-02: Trust and authorization

- FR-02.1: A saved repository profile SHALL become trusted only through an explicit save-and-confirm action that displays its full effective content.
- FR-02.2: A checked-in profile SHALL require explicit confirmation for the tuple of managed repository identity, source type, schema version, and normalized content hash.
- FR-02.3: Any semantic change to a checked-in profile SHALL change its normalized content hash and SHALL invalidate the prior confirmation before commands from the new revision can run.
- FR-02.4: A path change, branch change, pull request, or application restart SHALL NOT by itself invalidate approval of unchanged content for the same managed repository.
- FR-02.5: An AI-provider suggestion SHALL have no executable authority and SHALL enter the contract only through an explicit **Run once** or save-and-confirm action.
- FR-02.6: One-run authorization SHALL apply only to the displayed profile, repository, operation, and content hash and SHALL expire when that operation ends.
- FR-02.7: Confirmation SHALL state that repository validation can execute repository-controlled code, that PRMonitor limits directory, credentials, time, and captured output, and that the MVP does not claim an operating-system or network sandbox for validation processes.
- FR-02.8: Confirmation SHALL display the effective human-readable Build & Validation Instructions, each executable/argument list, phase tag, working directory, timeout, output limit, and manual check before authorization is recorded.

### FR-03: Execution boundary and working directory

- FR-03.1: Commands SHALL be launched deterministically as an executable plus argument array without a command shell.
- FR-03.2: The runner SHALL resolve each working directory against the operation-owned worktree, canonicalize it immediately before launch, require it to exist and be a directory, and reject it if the canonical path is outside that worktree.
- FR-03.3: The runner SHALL resolve the executable using a controlled child environment and record the resolved executable; platform executable suffix handling SHALL NOT require shell execution.
- FR-03.4: Validation configuration SHALL NOT contain plaintext secrets or request secret environment variables.
- FR-03.5: Validation processes SHALL receive only the runner's documented toolchain environment; GitHub credentials, AI-provider credentials, and unrelated parent-process secrets SHALL be removed.
- FR-03.6: Commands in a profile SHALL run sequentially in declared order, and the first `failed` or `interrupted` command SHALL prevent later commands from starting; skipped later commands SHALL be recorded as `not_run` with reason `PRIOR_STEP_STOPPED`.

### FR-04: Timeouts, cancellation, restart, and status

- FR-04.1: Each command SHALL have a timeout from 1 second through 60 minutes, with a default of 10 minutes when omitted by a source format that permits defaults.
- FR-04.2: The effective timeout SHALL be shown before confirmation and stored in the immutable run snapshot.
- FR-04.3: On timeout or cancellation, the runner SHALL request graceful termination of the entire process tree, wait 5 seconds, then force termination of remaining descendants.
- FR-04.4: Closing or destroying the renderer window SHALL NOT cancel a validation run owned by the Electron main process.
- FR-04.5: Explicit user cancellation SHALL produce status `interrupted` and reason `USER_CANCELLED`.
- FR-04.6: Application shutdown SHALL produce status `interrupted` and reason `APPLICATION_SHUTDOWN` after termination is attempted.
- FR-04.7: On startup, an incomplete persisted run SHALL be finalized as `interrupted` with reason `APPLICATION_RESTARTED`; it SHALL NOT resume or rerun without a new explicit or workflow-authorized request.
- FR-04.8: A start failure SHALL be `failed` with reason `START_FAILED`; only an observed exit code of `0` SHALL produce automated status `passed`.

### FR-05: Output capture, limits, and redaction

- FR-05.1: The default and maximum retained output SHALL be 1,048,576 bytes independently for stdout and stderr per command.
- FR-05.2: When a stream exceeds its limit, the application SHALL retain equal head and tail budgets where possible, include a visible truncation marker, and record original and retained byte counts.
- FR-05.3: Output bounding SHALL be streaming and SHALL NOT retain an additional unbounded in-memory or on-disk copy owned by PRMonitor.
- FR-05.4: Redaction SHALL occur before output is persisted, logged, sent over IPC, or displayed.
- FR-05.5: Redaction SHALL replace exact values of credentials and secrets known to PRMonitor and values in recognized sensitive key/value assignments, including token, password, secret, authorization, and API-key variants.
- FR-05.6: Redaction SHALL preserve a marker and enough surrounding diagnostic context for the developer to understand the failure.
- FR-05.7: ANSI escape sequences and non-text control characters SHALL be normalized before display without altering the stored exit status or byte-count metadata.

### FR-06: Manual checks and absent validation

- FR-06.1: A manual-check result SHALL record the check ID, outcome, attesting local user identity when available, timestamp, worktree path, worktree baseline/current revision identifiers, and optional notes.
- FR-06.2: Manual-check outcomes SHALL be `verified`, `failed`, or `not_run` and SHALL never be represented as a deterministically passed command.
- FR-06.3: A positive manual outcome SHALL be displayed as **Verified manually** and SHALL remain attributable to the exact recorded worktree state.
- FR-06.4: When no valid and trusted profile resolves, validation SHALL complete as `not_run` with one machine-readable reason: `NO_PROFILE`, `CONFIRMATION_REQUIRED`, or `INVALID_PROFILE`.
- FR-06.5: A `not_run` validation SHALL not prevent creation of a Review Bundle or branch-synchronization result, but its warning SHALL remain visible through the separate explicit publication decision.

### FR-07: Immutable evidence and consumer contract

- FR-07.1: Before external process launch, a validation run SHALL persist an immutable snapshot of the selected profile, source, repository identity, configuration hash, authorization reference, worktree identity, and effective limits.
- FR-07.2: Each run and step SHALL record its validation phase, timestamps, lifecycle state, machine-readable reason, executable and arguments, canonical working directory, resolved executable when available, exit code or signal when available, bounded/redacted stdout and stderr metadata, and manual attestation where applicable.
- FR-07.3: The shared contract SHALL expose deterministic profile parsing, source resolution, trust evaluation, path validation, status aggregation, redaction, and snapshot validation for all review and synchronization consumers.

## Non-Functional Requirements

- **NFR-01: Security** - Untrusted repository content and AI output SHALL never become executable merely because it exists; credentials SHALL be excluded or redacted before crossing the validation boundary.
- **NFR-02: Reliability** - The same inputs SHALL resolve to the same profile, trust state, validation status, and reason, including after restart.
- **NFR-03: Bounded resources** - Command duration, captured stdout, and captured stderr SHALL have enforced limits independent of renderer availability.
- **NFR-04: Evolvability** - The schema SHALL be explicitly versioned, reject unknown major versions, and allow later additive versions without changing the meaning of stored snapshots.
- **NFR-05: Usability** - Confirmation and results SHALL use readable labels and arguments while retaining the exact executable, arguments, directory, limits, source, and reason for inspection.
- **NFR-06: Portability** - The contract SHALL model executables and arguments without shell syntax and SHALL keep platform-specific process-tree termination and executable resolution behind the future runner boundary.
- **NFR-07: Explainability** - Baseline evidence, post-change evidence, human-readable build guidance, and executable validation commands SHALL remain visibly distinct so a developer can tell what was known before implementation and what was observed afterward.

## Invariants

- **INV-01:** AI output SHALL never determine whether a validation command passed, failed, or ran.
- **INV-02:** No validation command SHALL execute until its exact effective profile is both valid and authorized for the current repository and operation.
- **INV-03:** No validation command SHALL have a working directory outside its operation-owned worktree.
- **INV-04:** GitHub credentials, AI-provider credentials, and other application secrets SHALL NOT be supplied to validation commands through profile configuration or uncontrolled environment inheritance.
- **INV-05:** Raw unredacted validation output SHALL NOT be persisted, logged, sent to the renderer, or included in AI context.
- **INV-06:** A missing, invalid, untrusted, interrupted, or failed validation result SHALL never be presented as passed.
- **INV-07:** Validation configuration or execution SHALL NOT commit, push, post a GitHub response, resolve a conversation, approve a review, merge a PR, or otherwise grant publication authority.
- **INV-08:** Mutable validation inputs SHALL be snapshotted before execution so later configuration edits cannot change the meaning of an existing result.
- **INV-09:** Human-readable Build & Validation Instructions SHALL never grant command execution authority; only a valid, trusted structured command step may be launched.
- **INV-10:** Baseline validation SHALL never be presented as evidence that the proposed changes pass, and post-change validation SHALL never be inferred from baseline results or AI-provider claims.

## Out of Scope

- Implementing the production child-process runner, Electron settings UI, SQLite repositories, Review Bundle UI, or synchronization UI; those belong to F03, F04, F14, F16, F18, and F23-F25.
- Automatically discovering commands from `package.json`, build files, CI definitions, README text, or prior execution history.
- An operating-system sandbox or guaranteed network isolation for repository validation code.
- Secret injection or repository-specific credential brokering for validation commands.
- Parallel validation commands, dependency graphs, retries, flaky-test detection, coverage interpretation, or CI-status monitoring.
- Allowing checked-in configuration or AI output to silently weaken limits or bypass confirmation.
- Treating a manual attestation as proof that an automated command exited successfully.

## Product Decisions

- **PD-01: One source wins by fixed precedence** - A one-run override supersedes saved repository settings, which supersede an approved checked-in profile. Whole-profile selection is predictable and avoids surprising extra commands from merged sources.
- **PD-02: Checked-in configuration is reviewable, not inherently trusted** - `.prmonitor/validation.json` is convenient and version controlled, but repository content can execute code and therefore requires approval of its exact normalized content hash.
- **PD-03: AI suggestions require a human trust transition** - A provider may recommend useful commands, but **Run once** or save-and-confirm is the only way a suggestion gains execution authority.
- **PD-04: No automatic command discovery in the MVP** - Guessing from manifests or documentation creates hidden behavior and makes trust hard to explain.
- **PD-05: No safe command is a visible `not_run`, not a fabricated pass** - Review can continue because some repositories lack automated checks, while publication remains an explicit human decision made with the warning visible.
- **PD-06: Manual evidence is first class but differently labeled** - Human checks can be recorded and tied to a revision, but they are shown as **Verified manually**, not as an observed test pass.
- **PD-07: Validation runs in the operation worktree** - This makes results relevant to the exact proposed state and prevents validation from mutating the developer's ordinary workspace.
- **PD-08: Baseline first, final evidence before approval** - When configured, a lightweight or repository-selected baseline phase runs before the Review Proposal so pre-existing failures are known. Post-change validation runs after accepted implementation decisions and before final publication approval; publication may perform a configured final re-check.
- **PD-09: Human guidance and executable authority are separate** - Free-form repository build instructions are valuable context for AI reasoning, but they never become executable commands. Structured commands remain explicit, reviewable, trusted, and phase-tagged.

## Implementation Decisions

- **IMP-01: Contract package first** - F00 will implement a framework-neutral TypeScript package with Zod-first schemas, generated JSON Schema, pure resolution and result functions, and conformance fixtures. It will not introduce Electron or SQLite before F01/F03.
- **IMP-02: Checked-in path** - Version 1 uses `.prmonitor/validation.json` at the repository root.
- **IMP-03: Structured spawn model** - Commands are represented by executable and argument array and are intended for `shell: false`; executable lookup on Windows honors controlled `PATH`/`PATHEXT` without accepting shell command strings.
- **IMP-04: Stable normalized hash** - Approval uses a SHA-256 hash of canonical JSON after schema defaults and normalization, binding trust to meaning rather than whitespace or object-key order.
- **IMP-05: Closed reason vocabulary** - Version 1 uses stable reason values including `NO_PROFILE`, `CONFIRMATION_REQUIRED`, `INVALID_PROFILE`, `START_FAILED`, `NON_ZERO_EXIT`, `TIMED_OUT`, `USER_CANCELLED`, `APPLICATION_SHUTDOWN`, `APPLICATION_RESTARTED`, `PRIOR_STEP_STOPPED`, `WORKTREE_PATH_INVALID`, and `REDACTION_FAILURE`.
- **IMP-06: Fail closed at boundaries** - Invalid paths, unsupported versions, trust mismatches, snapshot mismatches, or inability to guarantee redaction prevent command launch and yield a non-passing reason.
- **IMP-07: Phase-aware profile v1** - Add optional `buildInstructions` text and a `phase` discriminator to command/manual-check steps. Preserve existing profiles by treating an omitted phase as `post_change`; generated schemas and snapshots retain the explicit effective phase.

## Testing Decisions

- **TST-01: Test the deep contract boundary** - Tests target parsing, normalization, hashing, precedence, trust, path containment, status aggregation, streaming output bounds, redaction, and snapshot validation through public APIs.
- **TST-02: Use table-driven adversarial fixtures** - Fixtures include traversal, Windows path/case behavior, junction/symlink escape, duplicate IDs, unsupported versions, shell-like arguments, hash changes, secret-shaped output, multi-byte UTF-8 truncation, and restart finalization.
- **TST-03: Do not fake process execution in F00** - Process spawning and process-tree termination belong to F14 integration tests; F00 supplies runner-neutral state transitions and conformance cases those tests must reuse.
- **TST-04: Preserve exact non-secret evidence** - Redaction tests assert that known secrets never appear while nearby diagnostics, truncation metadata, and status data remain intact.

## Proposed Modules

- **MOD-01: Validation Contract** - Owns versioned profile, source, authorization, snapshot, command-result, manual-check, summary, and reason schemas behind a small parse/serialize API.
- **MOD-02: Validation Profile Resolver** - Selects one source by precedence and returns `ready`, `confirmation_required`, `invalid`, or `unavailable` with deterministic reason data.
- **MOD-03: Validation Trust Policy** - Normalizes and hashes profiles, binds approvals to repository identity and operation scope, and validates saved approval evidence.
- **MOD-04: Validation Execution Policy** - Computes effective time and output limits and validates canonical worktree containment without launching processes.
- **MOD-05: Validation Evidence Policy** - Bounds/redacts stream chunks, aggregates step states, finalizes interrupted runs, and validates immutable snapshots.

## Workflows

### Workflow 1: Approved checked-in profile

```text
1. PRMonitor loads and validates `.prmonitor/validation.json`.
2. The contract normalizes the profile and computes its content hash.
3. If no matching approval exists, the developer reviews the exact effective profile.
4. The developer approves the repository/profile/hash tuple.
5. A later operation resolves the unchanged checked-in profile as `ready`.
6. Before any command starts, the operation persists the immutable validation snapshot.
7. F14 executes the commands sequentially and records deterministic evidence.
```

### Workflow 2: AI-proposed one-run command

```text
1. An AI provider returns a proposed validation profile as untrusted data.
2. PRMonitor validates it but grants no execution authority.
3. The developer reviews the executable, arguments, directory, timeout, and output limit.
4. The developer chooses Run once.
5. Authorization is bound to that repository, operation, and content hash.
6. The run snapshot is persisted before F14 launches the first command.
7. Authorization expires when the operation ends.
```

### Workflow 3: No safe profile

```text
1. The resolver finds no saved profile and no approved checked-in profile.
2. PRMonitor creates a completed validation record with `not_run` and the precise reason.
3. The Review Bundle or synchronization result continues to human review.
4. The validation warning remains visible through the publication decision.
5. Nothing is represented as passing and no AI provider is invoked to manufacture an answer.
```

### Workflow 4: Timeout, cancellation, or restart

```text
1. F14 starts a command from an immutable snapshot.
2. Timeout, user cancellation, or application shutdown requests process-tree termination.
3. After a five-second grace period, remaining descendants are force-terminated.
4. The command and run become `interrupted` with the corresponding reason.
5. On startup, any record still marked running is finalized as `APPLICATION_RESTARTED`.
6. The run is never silently resumed or marked passed.
```

### Workflow 5: Baseline and post-change review validation

```text
1. The developer saves or approves one complete phase-aware Build & Validation profile.
2. F18 creates a clean worktree at the recorded PR head SHA.
3. Baseline-tagged commands run and produce immutable baseline evidence.
4. The read-only Review Proposal receives the baseline evidence but cannot modify the worktree.
5. After the developer accepts or overrides every review item, accepted implementation work produces a proposed worktree state.
6. Post-change-tagged commands run against that state and produce separate immutable evidence.
7. The Review Bundle shows both phases distinctly before final publication approval.
```
