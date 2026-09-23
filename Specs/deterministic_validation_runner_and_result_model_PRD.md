# F14 Deterministic Validation Runner and Result Model - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F00 - Deterministic validation configuration contract | Supplies the versioned profile, trust/authorization, immutable snapshot, prepared-command, output, lifecycle, manual-attestation, and shared consumer contracts. |
| 2 | F03 - SQLite persistence, migrations, and transactional repositories | Supplies the main-process transaction boundary and durable repositories for validation run intent, snapshots, step evidence, manual attestations, and restart recovery. |
| 3 | F09 - Durable activity log and operation diagnostics | Receives bounded correlated validation lifecycle events; activity remains diagnostic and never becomes validation state. |
| 4 | F13 - Operation-owned Git worktrees and change attribution | Supplies the operation-owned worktree, exact baseline/current revisions, actual-state inspection, and path identity against which validation runs. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F15-F17 - AI contracts, preferences, and bounded work controller | Consume real validation evidence, phase-specific results, command activity, and deterministic stop reasons without trusting provider prose. |
| 2 | F16 - AI preferences, task-profile snapshots, execution policies, and Common Instructions | Owns the settings surface for Build & Validation Instructions and structured command profiles; F14 executes only the resulting authorized snapshot. |
| 3 | F18-F22 - Review preparation, Review Bundle workspace, revisions, and re-evaluation | Invoke baseline/post-change validation at workflow-owned points and display the persisted evidence in proposal/final review. |
| 4 | F23 - Human-approved Review Bundle publication | May perform the configured final validation/recheck before publication side effects and must use the persisted result contract. |
| 5 | F24-F27 - Managed PR branch synchronization | Use the same runner and result semantics for clean merges and conflict-resolution results in independent synchronization worktrees. |
| 6 | F28-F30 - Recovery, security, and release readiness | Exercise process interruption, credential exclusion, output redaction, restart reconciliation, and clean-machine validation behavior. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-13 | FR-01.1-FR-07.5, INV-01-INV-10 | AC-01-AC-14, AC-17-AC-18 | Primary: F14 owns deterministic command execution, result truth, persistence handoff, and consumer projection. |
| APP-AC-39 | FR-01.2, FR-02.3, FR-03.2, FR-07.1-FR-07.3, INV-05, INV-10 | AC-02, AC-04, AC-09, AC-11 | Shared enabler: F14 validates the actual operation worktree and records results; F13 owns manual-edit preservation and F20/F22 own dirty-worktree choices. |
| APP-AC-48 | FR-03.1-FR-06.4, FR-07.4, INV-01, INV-04, INV-07 | AC-04-AC-10, AC-15-AC-18 | Shared enabler: F14 owns real validation evidence; F25-F27 own merge/conflict detection and synchronization-result semantics. |
| APP-AC-49 | FR-06.3-FR-07.4, INV-02-INV-04, INV-08 | AC-11-AC-17 | Shared enabler: F14 owns serializable validation records and warnings; F03/F25-F27 own complete synchronization-result persistence and presentation. |
| APP-AC-56 | FR-04.2-FR-05.4, FR-07.1-FR-07.4, INV-01, INV-04 | AC-06-AC-11, AC-16-AC-18 | Shared enabler: F14 supplies deterministic command activity and results; F17 owns the complete AI Work Turn Report. |
| APP-AC-57 | FR-04.2-FR-04.5, FR-05.3, FR-07.2-FR-07.3, INV-01, INV-04 | AC-06-AC-08, AC-11, AC-16-AC-18 | Shared enabler: F14 supplies truthful timeout, failure, interruption, and no-progress evidence; F17 owns AI budget/progress decisions and `NEEDS_ATTENTION`. |
| APP-AC-73 | FR-01.1-FR-02.4, FR-04.1-FR-07.4, INV-01, INV-03, INV-08-INV-10 | AC-01-AC-03, AC-06, AC-09, AC-11, AC-14-AC-17 | Shared workflow boundary: F14 owns phase-aware execution and evidence; F18/F20/F23/F25-F27 own invocation timing, bundle/result presentation, and publication gating. |
| APP-AC-74 | FR-01.1-FR-01.4, FR-05.1-FR-07.4, INV-01-INV-04, INV-08-INV-09 | AC-01, AC-04, AC-09-AC-12, AC-15-AC-17 | Shared enabler: F00/F16 own profile configuration and trust UX; F14 owns execution of the exact snapshotted profile and separation of guidance from authority. |
| APP-AC-75 | FR-04.2-FR-06.4, FR-07.3, INV-04, INV-09 | AC-06-AC-08, AC-12-AC-14, AC-17 | Shared enabler: F14 supplies status/reason data; F20 owns the distinct `READY_FOR_REVIEW`/`NEEDS_ATTENTION` presentation. |

## Executive Summary

PRMonitor needs validation evidence that a developer can trust after a review,
revision, or branch-synchronization operation. Repository commands can fail to
start, time out, be cancelled, emit sensitive or unbounded output, or be
interrupted while the desktop window is closed. An AI provider can also claim
that a command passed even though no successful exit status was observed. If
those cases are not represented explicitly, a Review Bundle or synchronization
result can appear ready when the proposed code was never actually validated.

F14 provides the deterministic main-process validation runner and the durable
result model. It accepts only a valid, trusted F00 snapshot and an
operation-owned F13 worktree, persists the run intent before launching a child
process, runs approved executable/argument pairs sequentially, captures real
exit and signal information, bounds and redacts output, and finalizes timeout,
cancellation, shutdown, and restart outcomes as non-passing evidence. It keeps
baseline and post-change results distinct, records manual checks as human
attestations, and makes the explicit no-safe-profile case visible as
`not_run`.

The feature exposes a provider-neutral read contract for Review Bundles, AI
progress evaluation, and synchronization results. F14 does not choose
commands, grant trust, create worktrees, infer success from model prose, or
perform any GitHub, Git, AI-provider, commit, push, response, merge, or
publication action outside the validation process itself.

## User Stories

### Run approved validation safely

- **US-01:** **GIVEN** a trusted F00 profile and an available operation-owned worktree, **WHEN** a workflow requests validation, **THEN** PRMonitor persists the immutable run snapshot before starting any command and executes only the authorized structured steps.
  - **Acceptance Criteria:** AC-01, AC-02, AC-04, AC-11.
- **US-02:** **GIVEN** a configured command uses a relative directory or an executable resolved through the controlled toolchain environment, **WHEN** the command is prepared, **THEN** PRMonitor shows and records the canonical directory and resolved executable without invoking a shell.
  - **Acceptance Criteria:** AC-04, AC-09.

### Distinguish baseline and proposed results

- **US-03:** **GIVEN** a phase-aware profile and a clean PR-head worktree, **WHEN** review preparation requests baseline validation, **THEN** only baseline-eligible commands run and their real results remain separate from later post-change evidence.
  - **Acceptance Criteria:** AC-03, AC-14, AC-15.
- **US-04:** **GIVEN** accepted implementation decisions have changed an operation worktree, **WHEN** post-change validation is requested, **THEN** post-change-eligible commands run against the inspected current state and their results are available before final publication approval.
  - **Acceptance Criteria:** AC-02, AC-03, AC-14-AC-17.

### Inspect truthful outcomes

- **US-05:** **GIVEN** a command exits successfully, fails, cannot start, times out, or is cancelled, **WHEN** the run is completed, **THEN** the result uses the corresponding deterministic status and reason, and no AI statement can alter it.
  - **Acceptance Criteria:** AC-06-AC-08, AC-14.
- **US-06:** **GIVEN** a command emits large or sensitive output, **WHEN** the result is persisted or displayed, **THEN** it contains only bounded/redacted evidence with visible truncation metadata and enough safe context to diagnose the outcome.
  - **Acceptance Criteria:** AC-09, AC-10.

### Handle manual and unavailable validation

- **US-07:** **GIVEN** a profile contains a manual check, **WHEN** a developer records its outcome, **THEN** the attestation is tied to the exact worktree state and is labeled as human verification rather than an observed test pass.
  - **Acceptance Criteria:** AC-12-AC-14.
- **US-08:** **GIVEN** no valid and trusted profile can be resolved, **WHEN** validation is requested, **THEN** PRMonitor persists a completed `not_run` record with a specific warning and allows the owning review or synchronization workflow to continue with that warning visible.
  - **Acceptance Criteria:** AC-01, AC-11, AC-13, AC-17.

### Recover without repeating unsafe work

- **US-09:** **GIVEN** validation is active, **WHEN** the renderer closes, the application shuts down, or the process restarts, **THEN** the main process preserves or finalizes the run deterministically and never silently resumes or reruns an incomplete command.
  - **Acceptance Criteria:** AC-07, AC-08, AC-11, AC-16.
- **US-10:** **GIVEN** two consumers request validation with equivalent snapshots and worktree evidence, **WHEN** they execute or inspect results, **THEN** both use the same path, trust, status, redaction, aggregation, and warning semantics.
  - **Acceptance Criteria:** AC-15-AC-18.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** a one-run, saved, or checked-in profile is available, **WHEN** validation starts, **THEN** F14 executes only the `ready` resolution returned by F00, persists its complete source/content-hash/authorization/profile snapshot before launching a child process, and creates a completed `not_run` record with the F00 warning when the resolution is `NO_PROFILE`, `CONFIRMATION_REQUIRED`, or `INVALID_PROFILE`; no untrusted or unapproved profile reaches the runner.
- **AC-02:** **GIVEN** a validation snapshot names an operation-owned worktree, baseline revision, and current revision, **WHEN** a run is prepared, **THEN** F14 asks F13 for a fresh actual-state inspection, rejects a missing/changed/unowned/stale worktree with a non-passing machine-readable result, and never runs against the developer's normal clone.
- **AC-03:** **GIVEN** a profile contains `baseline`, `post_change`, and `both` phase tags, **WHEN** a caller requests baseline, post-change, or a linked both-phase evaluation, **THEN** F14 runs only steps eligible for the requested phase, records the effective run/step phase and configured phase, and keeps baseline evidence separate from post-change evidence; a `both` step may be eligible in each phase but is never used to make one phase pass for the other.
- **AC-04:** **GIVEN** a trusted command step is selected, **WHEN** it is prepared, **THEN** F14 launches the exact executable and argument array with shell execution disabled, resolves and records the executable through the controlled environment, canonicalizes an existing working directory inside the operation worktree, strips GitHub/AI/application secrets, and rejects path or environment violations before process start.
- **AC-05:** **GIVEN** multiple eligible steps are ordered in one run, **WHEN** F14 executes them, **THEN** commands and manual steps are processed in declared order, the first failed/interrupted/unavailable step prevents later commands from starting, and each skipped later step is recorded as `not_run` with `PRIOR_STEP_STOPPED` or its precise non-execution reason.
- **AC-06:** **GIVEN** a child process is observed to exit with code `0`, a non-zero code, or a start failure, **WHEN** F14 records the observation, **THEN** the command is respectively `passed`, `failed`, or `failed` with `START_FAILED`/`NON_ZERO_EXIT`; only the observed exit status can produce an automated pass.
- **AC-07:** **GIVEN** a command reaches its timeout or the user cancels/shuts down validation, **WHEN** termination is requested, **THEN** F14 requests graceful termination of the complete process tree, waits the F00 five-second grace period, force-terminates reported survivors, records `interrupted` with `TIMED_OUT`, `USER_CANCELLED`, or `APPLICATION_SHUTDOWN`, preserves safe output, and does not start a later step.
- **AC-08:** **GIVEN** the application restarts while a persisted run or command is `running`, **WHEN** startup reconciliation occurs, **THEN** F14 finalizes the affected command and run as `interrupted` with `APPLICATION_RESTARTED`, marks later steps `not_run`, preserves all committed evidence, and does not resume or automatically rerun the incomplete command; renderer closure alone is a no-op for run lifetime.
- **AC-09:** **GIVEN** a command reaches a terminal state, **WHEN** the result is persisted, **THEN** it records the validation phase, exact executable and arguments, canonical working directory, resolved executable when available, start/completion times, exit code or signal when available, timeout/effective limits, and bounded stdout/stderr metadata.
- **AC-10:** **GIVEN** stdout or stderr is oversized or contains a known/sensitive value, **WHEN** bytes cross the runner boundary, **THEN** F14 applies the F00/F09 streaming bounds and redaction before persistence, IPC, logging, or AI context, records original/processed/retained/omitted byte counts and a visible truncation marker when needed, and records `REDACTION_FAILURE` as non-passing evidence if safety cannot be established.
- **AC-11:** **GIVEN** a run or step has been committed and the caller retries after a renderer/process/IPC interruption, **WHEN** F14 receives the same operation/run identity, **THEN** it returns or reconciles the existing durable record instead of creating a duplicate run or silently launching another command; a committed result remains inspectable after restart.
- **AC-12:** **GIVEN** a developer records a manual check, **WHEN** the attestation is accepted, **THEN** it stores the check ID, outcome `verified`/`failed`/`not_run`, attesting user when available, timestamp, worktree path, baseline/current revision identifiers, and notes, and a positive result is displayed as **Verified manually** rather than **Test passed**.
- **AC-13:** **GIVEN** no automated command is configured, a manual check is still unattested, or no valid/trusted profile exists, **WHEN** the run is summarized, **THEN** the appropriate result is `not_run` with `NO_AUTOMATED_COMMANDS`, `MANUAL_CHECK_NOT_RUN`, `NO_PROFILE`, `CONFIRMATION_REQUIRED`, or `INVALID_PROFILE`, and the owning workflow receives a visible warning rather than a pass.
- **AC-14:** **GIVEN** a run contains automated commands and manual checks, **WHEN** its aggregate status is computed, **THEN** `passed` requires every selected command to have observed exit code `0` and every required manual step to have a current `verified` attestation; failed/interrupted/not-run/manual outcomes remain distinguishable and baseline evidence never satisfies post-change validation.
- **AC-15:** **GIVEN** Review Bundle preparation, AI progress evaluation, or branch synchronization consumes a validation result, **WHEN** it requests the shared consumer contract, **THEN** F14 returns the same profile resolution, snapshot, worktree path, phase filtering, command preparation, output, status, aggregation, manual, and warning semantics for every consumer label; consumer identity never changes execution policy.
- **AC-16:** **GIVEN** a validation operation emits start, progress, terminal, cancellation, failure, or restart evidence, **WHEN** F09 receives the event, **THEN** the event is bounded, correlated to the owning operation/run, redacted, idempotent, and diagnostic only; losing an activity event never changes validation status or permits a workflow to skip its own safety checks.
- **AC-17:** **GIVEN** a consumer reads a completed validation record after UI closure or restart, **WHEN** it renders or stores the result, **THEN** the read model exposes baseline/post-change phase, step statuses, reasons, manual labels, warnings, exact evidence metadata, and the next permitted action without parsing free-form logs or AI prose.
- **AC-18:** **GIVEN** any validation path completes, **WHEN** its capabilities and side effects are inspected, **THEN** F14 has not invoked an AI provider, GitHub mutation, commit, push, response publication, merge, or worktree reset/cleanup, and no renderer-supplied shell string, credential, arbitrary path, or provider object has entered the runner.

## Functional Requirements

### FR-01: Admission, trust, and immutable input snapshot

- FR-01.1: F14 SHALL accept only a `ready` F00 validation resolution with a valid immutable validation snapshot, authorized source, repository identity, normalized content hash, effective limits, and F13 operation-worktree identity.
- FR-01.2: Before preparing a command, F14 SHALL request a fresh F13 inspection and SHALL verify operation ownership, canonical worktree containment, baseline/current revision identity, and the caller's requested validation phase.
- FR-01.3: F14 SHALL persist a validation-run intent, correlation identity, immutable snapshot reference, operation identity, and phase request through F03 before starting a child process.
- FR-01.4: A `NO_PROFILE`, `CONFIRMATION_REQUIRED`, or `INVALID_PROFILE` resolution SHALL create a completed non-passing `not_run` record and SHALL not create a child process or require AI judgment.
- FR-01.5: F14 SHALL never merge commands, instructions, approvals, or limits from multiple profile sources and SHALL never infer a command from repository files, logs, AI output, or process history.

### FR-02: Phase-aware selection and run composition

- FR-02.1: F14 SHALL support baseline, post-change, and linked both-phase requests while preserving the F00 distinction between a step's configured applicability and the phase in which it actually ran.
- FR-02.2: F14 SHALL select only commands and manual checks whose effective phase is eligible for the requested phase, preserving the profile's declared order and stable step IDs.
- FR-02.3: Baseline and post-change runs SHALL produce separate immutable evidence sets; a `both` step SHALL be eligible in both phases but SHALL not make one phase pass from evidence belonging to the other.
- FR-02.4: F14 SHALL execute selected automated commands sequentially in declared order; parallel execution, automatic retries, flaky-test interpretation, dependency graphs, and coverage analysis are not part of this feature.

### FR-03: Structured child-process and worktree boundary

- FR-03.1: F14 SHALL start commands only through the F00 `ValidationRunnerPort` shape using an executable and argument array with `shell: false`; no shell-command string or renderer-provided command may be accepted.
- FR-03.2: F14 SHALL resolve and verify the canonical working directory immediately before launch, require an existing directory inside the operation-owned worktree, and reject traversal, absolute-profile, sibling-prefix, symlink, junction, or ownership escapes.
- FR-03.3: F14 SHALL resolve the executable using the controlled `PATH`/`PATHEXT` environment, record the resolved path, and return `EXECUTABLE_NOT_RESOLVED` before launch when resolution is not provable.
- FR-03.4: F14 SHALL pass only the documented controlled toolchain environment and SHALL exclude GitHub credentials, AI-provider credentials, credential-store values, and unrelated parent-process secrets.
- FR-03.5: F14 SHALL not reset, clean, replace, delete, checkout, or otherwise mutate the operation worktree outside the validation child process, and SHALL never target the developer's normal clone.
- FR-03.6: F14 SHALL expose no capability for GitHub mutation, AI invocation, commit, push, response posting, merge, publication, or automatic worktree cleanup.

### FR-04: Lifecycle, sequencing, cancellation, and status truth

- FR-04.1: F14 SHALL persist ordered pending/running/terminal step state and a run state using the F00 lifecycle transitions and SHALL reject illegal transitions.
- FR-04.2: An observed exit code of `0` SHALL be the only automated `passed` condition; non-zero exit and start failure SHALL be `failed`, and model-reported success SHALL have no effect.
- FR-04.3: The first failed, interrupted, unavailable, or cancelled command SHALL prevent later commands from starting; later steps SHALL be recorded as `not_run` with a machine-readable reason.
- FR-04.4: Timeout, user cancellation, and application shutdown SHALL request graceful termination of the complete process tree, wait the F00 five-second grace period, force-terminate survivors, and finalize the affected step as `interrupted`.
- FR-04.5: Renderer closure SHALL not cancel or reset a main-process-owned validation run, and startup SHALL finalize persisted running work as `APPLICATION_RESTARTED` rather than resuming it.

### FR-05: Evidence, output bounding, and redaction

- FR-05.1: Each terminal automated step SHALL persist its configured/effective phase, exact executable and arguments, canonical working directory, resolved executable, start/completion timestamps, exit code or signal, timeout/output limits, and step status/reason.
- FR-05.2: F14 SHALL consume stdout and stderr as bounded streams, apply the F00 output limits independently, retain truncation metadata and a visible marker, and avoid any additional unbounded process-owned copy.
- FR-05.3: F14 SHALL apply F00/F09 redaction before output is persisted, logged, sent through IPC, displayed, or included in an AI context; redaction uncertainty SHALL produce non-passing `REDACTION_FAILURE` evidence.
- FR-05.4: F14 SHALL preserve safe diagnostic context while excluding raw credentials, sensitive key/value assignments, authorization data, prompts, SDK objects, and uncontrolled environment values from the result model.

### FR-06: Manual checks, aggregation, and unavailable validation

- FR-06.1: F14 SHALL accept only F00 manual-attestation outcomes `verified`, `failed`, or `not_run` and SHALL bind each attestation to the check ID, timestamp, user when available, operation worktree path, baseline revision, current revision, and notes.
- FR-06.2: F14 SHALL keep manual evidence structurally separate from automated command exit evidence and SHALL use **Verified manually**, **Manual check failed**, and **Not run** labels at the display boundary.
- FR-06.3: F14 SHALL aggregate automated, manual, warning, phase, and no-run evidence deterministically; it SHALL not report `passed` when a required manual check is unattested, validation is unavailable, a command failed/interrupted, or evidence is unsafe.
- FR-06.4: F14 SHALL persist and expose a visible warning for `NO_PROFILE`, `CONFIRMATION_REQUIRED`, `INVALID_PROFILE`, `NO_AUTOMATED_COMMANDS`, and `MANUAL_CHECK_NOT_RUN` without preventing the owning workflow from making its separate explicit human decision.

### FR-07: Durability, activity, and consumer read contract

- FR-07.1: F14 SHALL persist validation snapshots, run/step intent, immutable evidence, manual attestations, warnings, correlation identity, and owner/version references through F03 with transaction and restart semantics defined by F03.
- FR-07.2: F14 SHALL make duplicate start/replay requests idempotent by stable operation/run identity, distinguish committed results from uncertain process outcomes, and SHALL not automatically rerun a command solely because a process or renderer stopped.
- FR-07.3: F14 SHALL emit bounded F09 lifecycle and terminal activity with the owning operation/run identity, phase, status/reason, and permitted next action, while keeping the authoritative validation result in its own record.
- FR-07.4: F14 SHALL expose one provider-neutral, renderer-safe read model for review and synchronization consumers containing exact evidence fields, phase distinction, manual labels, warnings, and machine-readable reasons.
- FR-07.5: F14 SHALL keep the main process and durable repositories authoritative; renderer state, activity text, child-process prose, and provider claims SHALL never be the source of validation truth.

## Non-Functional Requirements

- **NFR-01: Determinism** - Given the same authorized snapshot, worktree state, command observations, clock, and controlled environment, F14 SHALL produce the same prepared-command identity, lifecycle outcome, aggregate status, reason, and warning data without AI judgment.
- **NFR-02: Safety** - F14 SHALL fail closed on invalid snapshots, stale/unowned worktrees, path escape, executable ambiguity, environment violations, unbounded output, redaction failure, and uncertain persistence rather than producing a pass.
- **NFR-03: Bounded resources** - Each command SHALL have an enforced timeout and independent bounded stdout/stderr capture; process-tree termination, retained evidence, retries, and diagnostics SHALL have explicit limits.
- **NFR-04: Durability and recovery** - Run intent and input snapshots SHALL precede child-process launch; committed results SHALL survive renderer closure/restart; incomplete work SHALL become explicit interrupted evidence.
- **NFR-05: Security and privacy** - Credentials, prompts, provider SDK objects, raw authorization data, uncontrolled environment values, unredacted output, and arbitrary shell syntax SHALL not enter the runner, persistence, IPC, activity, or evidence boundary.
- **NFR-06: Windows behavior** - The supported Windows runtime SHALL resolve executable suffixes, canonicalize case-insensitive paths, terminate process trees, and preserve safe reasons through the platform adapter without changing provider-neutral result semantics.
- **NFR-07: Explainability** - A developer SHALL be able to distinguish source/trust, baseline/post-change phase, exact command, actual exit result, manual attestation, interruption reason, warning, and next action without reading free-form logs.
- **NFR-08: Testability and accessibility handoff** - Runner ports, clocks, process control, filesystem/path checks, persistence, activity, and renderer-safe read models SHALL be injectable and bounded; full visual/accessibility presentation remains owned by F20 but must be consumable without color-only status assumptions.

## Invariants

- **INV-01:** Validation command selection, path checks, process execution, timeout/cancellation, output handling, aggregation, and recovery are deterministic software; an AI provider cannot perform or decide them.
- **INV-02:** The Electron main process and F03 repositories are authoritative for validation intent, snapshots, lifecycle, evidence, warnings, and result state; renderer memory and activity text are not authoritative.
- **INV-03:** The validation intent and immutable input snapshot are durable before any child process launches, and cancellation after commit reports the committed fact for reconciliation rather than pretending it was undone.
- **INV-04:** An automated validation pass requires a real observed exit code of `0`; neither model prose, a baseline result, a manual note, nor an activity event can create a pass.
- **INV-05:** Every command working directory and validation target remains inside the declared operation-owned worktree; the developer's ordinary worktree is never mutated or used as an implicit fallback.
- **INV-06:** GitHub credentials, AI-provider credentials, credential-store values, and uncontrolled parent environment values never cross into validation commands or durable evidence.
- **INV-07:** F14 has no commit, push, response-posting, review-approval, merge, publication, AI-provider, or autonomous cleanup authority.
- **INV-08:** Mutable profile, authorization, repository, worktree, phase, limit, and instruction inputs are snapshotted before execution; later settings or worktree changes cannot rewrite historical evidence.
- **INV-09:** Baseline, post-change, and manual evidence remain visibly and structurally distinct; a `not_run`, `failed`, `interrupted`, stale, invalid, or unsafe result is never represented as passed.
- **INV-10:** Renderer closure, process restart, validation failure, and cancellation never silently reset, discard, replace, or publish user worktree edits; F14 leaves dirty-worktree choices to F13/F20/F22.

## Out of Scope

- Validation profile discovery, command choice, trust approval, source precedence, and confirmation UX - F00/F16.
- SQLite bootstrap, migrations, transaction implementation, and database repair - F03; F14 consumes its repositories.
- Activity storage, retention, viewer behavior, and notification delivery - F09/F19; F14 emits typed diagnostics only.
- Git clone/fetch/worktree creation, diff calculation, dirty-worktree clearing, and manual-edit attribution - F13/F20/F22.
- Review Bundle preparation, per-item decisions, baseline/post-change invocation timing, diff presentation, and publication approval - F18-F23.
- Synchronization source resolution, merge execution, conflict semantics, result state machine, and publication - F24-F27.
- AI-provider invocation, semantic test interpretation, repair/revision, flaky-test detection, and model-based pass/fail judgment - F15-F18/F21/F26.
- Automatic command discovery, shell-script parsing, parallel command graphs, automatic retries, coverage interpretation, CI status monitoring, dependency installation, OS/network sandboxing, and secret injection.
- Commit, push, GitHub response, conversation resolution, review approval, merge, autonomous publication, or force push.

## Product Decisions

- **PD-01: F00 is the validation authority** - F14 executes only the profile, authorization, limits, phase tags, and warning semantics returned by the F00 contract; it does not reimplement source precedence or trust policy.
- **PD-02: Run in the operation worktree** - Validation must describe the exact state being reviewed or synchronized, while the developer's normal clone remains outside the runner boundary.
- **PD-03: Baseline and post-change are separate evidence** - Baseline validation explains pre-existing failures; post-change validation describes the proposed state. A baseline pass cannot satisfy a post-change requirement.
- **PD-04: No automatic retries in F14** - A timeout, failure, interruption, or restart produces reviewable evidence. A later retry is a new explicit workflow request governed by the owning feature and a new durable run identity or idempotent continuation.
- **PD-05: No safe profile is a visible warning** - Review and synchronization may continue to their existing human decision boundary with `not_run` evidence, but no workflow may display that state as passing.
- **PD-06: Manual checks are first-class human evidence** - Manual attestations are tied to a worktree revision and labeled separately from command exit status; changing the worktree makes the attestation historical rather than silently current.
- **PD-07: Sequential stop-on-first-nonpass execution** - Commands run in profile order. The first failure or interruption stops later commands, which are recorded as not run rather than guessed.
- **PD-08: Exact bounded evidence is more valuable than optimistic summaries** - The result retains exact arguments, canonical directory, timestamps, exit/signal, bounded/redacted streams, truncation metadata, and machine-readable reasons.
- **PD-09: Renderer closure does not change validation lifetime** - The main process owns an active run, and startup reconciliation finalizes incomplete work rather than silently resuming it.

## Implementation Decisions

- **IMP-01: Reuse `@prmonitor/validation-contract`** - F14 consumes `ValidationRunnerPort`, `PreparedCommand`, `ProcessControlPort`, output evidence, lifecycle transitions, snapshot validation, manual-attestation, and consumer contracts already defined by F00.
- **IMP-02: Use a narrow main-process `ValidationRunnerService`** - The service coordinates admission, F13 inspection, F03 intent/evidence persistence, child-process lifecycle, F09 activity, and typed read projections; it does not expose process handles to the renderer.
- **IMP-03: Spawn structured commands with `shell: false`** - The production adapter uses Node child-process primitives with argument arrays, a controlled environment, canonical working directory, bounded output listeners, and an injected process-control seam.
- **IMP-04: Keep platform process control behind an adapter** - Windows process-tree termination and executable/PATHEXT behavior are implemented behind the F14 runner boundary; provider-neutral evidence records only the normalized observation and reason.
- **IMP-05: Persist before launch and after every terminal boundary** - F03 transactions record run intent/snapshot before a spawn and commit each step/result transition with stable operation/run/step identities. A committed-but-unacknowledged write is reconciled from durable state.
- **IMP-06: Reuse F00/F09 redaction** - F14 must not maintain a second secret scanner or raw-output store. The same bounded/redaction policy applies before persistence, activity, IPC, UI, or future AI context.
- **IMP-07: Represent phase context explicitly** - Run records carry the requested/effective phase and each step retains its configured phase, so a command tagged `both` can be evaluated in both workflow phases without conflating their evidence.
- **IMP-08: Keep manual attestations revision-bound** - The runner accepts manual outcomes only through the F00 attestation contract and rechecks the F13 worktree identity before accepting them.
- **IMP-09: Provide a shared consumer projection** - Review and synchronization use the same result codec, aggregation, warning, and read contract. Consumer labels are descriptive metadata only.

## Testing Decisions

- **TST-01: Test real child-process boundaries** - Use temporary operation worktrees and small fixture executables/scripts to prove argument preservation, shell absence, working-directory containment, environment filtering, real exit codes, and output capture.
- **TST-02: Deep-test Windows lifecycle behavior** - Use process trees, injected process-control fakes, and Windows integration fixtures to prove graceful termination, five-second grace, survivor force termination, executable suffix resolution, and restart finalization.
- **TST-03: Fault-inject persist-before-effect boundaries** - Exercise failures before intent commit, after commit acknowledgement is uncertain, during spawn, during output, at timeout/cancellation, after process exit, and during result/activity commit.
- **TST-04: Reuse F00 conformance cases** - F14 must run the existing path, trust, snapshot, phase, output, redaction, status, manual, no-profile, and consumer fixtures rather than redefining expected behavior.
- **TST-05: Prove no false pass and no unsafe side effect** - Include model-claim fixtures, non-zero/start-failure tables, missing/changed worktrees, secret scans, forbidden-capability imports, and spies for AI/GitHub/Git/publication calls.
- **TST-06: Test restart and idempotency at the repository boundary** - Renderer closure, process restart, duplicate requests, replayed terminal events, uncertain spawn/exit, and stale run versions must preserve one authoritative result and no automatic duplicate command.
- **TST-07: Defer visual fidelity to F20 but verify read semantics** - F14 tests typed status/reason/phase/manual/warning projections and accessible text labels; F20 owns complete Review Bundle layout and interaction evidence.

## Proposed Modules

- **MOD-01: Validation Run Admission** - Resolves F00 readiness, validates the operation/worktree snapshot with F13, and creates the persist-before-launch intent.
- **MOD-02: Command Preparation Adapter** - Maps F00 prepared commands to the production child-process boundary and controlled environment.
- **MOD-03: Child Process Runner** - Starts one structured command, streams bounded output, observes exit/signal/start errors, and exposes a process-tree handle.
- **MOD-04: Process Lifecycle Coordinator** - Applies timeout, cancellation, shutdown, renderer-close, and restart semantics using F00 transitions and process-control ports.
- **MOD-05: Phase Sequencer and Aggregator** - Selects eligible steps, stops after the first non-pass, records skipped steps, and computes phase/manual/overall status.
- **MOD-06: Validation Evidence Repository Adapter** - Composes F03 run/step/manual/snapshot writes, idempotent replay, optimistic versioning, and restart reconciliation.
- **MOD-07: Validation Activity Adapter** - Emits safe F09 lifecycle, terminal, warning, and recovery events without becoming authoritative state.
- **MOD-08: Validation Read Model** - Exposes renderer-safe and provider-neutral results for Review Bundles, AI progress, synchronization, and later UI.
- **MOD-09: Runner Conformance Harness** - Reuses F00 fixtures and adds real process, Windows, persistence-fault, security, and cross-consumer evidence.

## Workflows

### Workflow 1: Approved baseline or post-change validation

```text
1. The owning workflow supplies an operation identity, requested phase, F13 worktree identity, and F00 resolution input.
2. F14 resolves the F00 profile and validates the exact snapshot and current F13 worktree state.
3. F14 persists run intent, snapshot reference, phase, and correlation before process launch.
4. F14 selects phase-eligible steps in declared order and prepares the first command through the F00 path/environment policy.
5. F14 starts the child process with shell execution disabled and streams bounded/redacted output.
6. F14 records the observed exit/status evidence, then either starts the next step or records later steps as not run.
7. F14 aggregates automated/manual evidence, persists the terminal result, and appends safe F09 activity.
8. The owning workflow consumes the typed result; it decides whether to continue review/synchronization or request human attention.
```

### Workflow 2: No safe validation profile

```text
1. F00 resolution returns NO_PROFILE, CONFIRMATION_REQUIRED, or INVALID_PROFILE.
2. F14 persists a completed not_run record with the specific reason and warning without creating a child process.
3. The result projection marks validation as not run and explains the permitted next action.
4. Review or synchronization may continue to its own human decision boundary, but the warning remains attached to the result and publication review.
```

### Workflow 3: Timeout, cancellation, shutdown, or renderer closure

```text
1. F14 persists a running step and starts the command in the main process.
2. Timeout, user cancellation, or shutdown requests graceful termination of the full process tree.
3. After the injected/F00 five-second grace period, F14 force-terminates only reported survivors.
4. F14 records bounded output and an interrupted reason, marks later steps not run, and commits the terminal result.
5. Renderer closure changes no run state; the renderer can later read the same authoritative record.
```

### Workflow 4: Restart recovery and idempotent retry

```text
1. Startup finds a persisted validation run or command still marked running.
2. F14 inspects the run identity and durable evidence, finalizes the incomplete work as APPLICATION_RESTARTED, and preserves any committed step results.
3. A replay of the original request returns the existing run or a typed reconciliation result; it does not automatically spawn another process.
4. An owning workflow may explicitly request a new validation run after it re-inspects the worktree and creates a new durable intent.
```

### Workflow 5: Manual attestation and cross-consumer handoff

```text
1. A developer opens the result and records a manual check outcome against the displayed worktree state.
2. F14 validates the check ID and current/baseline revision binding, then stores the attestation separately from command evidence.
3. Review and synchronization consumers read the same aggregate/projection contract and retain phase, warning, manual, and exact command evidence.
4. If the worktree changes, the prior attestation remains historical and cannot silently make the new state pass.
```

## Contract-Test Criteria

- **CT-F14-01:** Admission tests cover F00 ready/unavailable/invalid/confirmation-required resolutions, complete snapshot persistence before spawn, source/hash/authorization preservation, no profile discovery, and no child process for no-run records.
- **CT-F14-02:** F13 handoff tests cover clean/stale/missing/unowned worktrees, baseline/current revision changes, developer-clone protection, symlink/junction/path escape, operation ownership, and actual-state inspection before launch.
- **CT-F14-03:** Structured-spawn tests cover exact executable/argument arrays, `shell: false`, Windows `PATH`/`PATHEXT`, resolved executable recording, controlled environment filtering, secret exclusion, and forbidden shell-string/arbitrary-path inputs.
- **CT-F14-04:** Sequencing/status tests cover baseline/post-change/both phase selection, `both` step eligibility, declared order, zero/non-zero/start-failure truth table, prior-step stopping, status aggregation, and model-claim irrelevance.
- **CT-F14-05:** Process-lifecycle tests cover timeout, user cancellation, application shutdown, five-second graceful termination, survivor force termination, renderer closure no-op, startup restart finalization, no automatic resume, and uncertain process outcome.
- **CT-F14-06:** Evidence tests cover exact commands/directories/times/codes/signals, independent stream limits, UTF-8/chunk boundaries, truncation metadata, secret-shaped output, redaction failure, ANSI/control normalization, bounded memory, and absence of raw output in persistence/IPC/activity/evidence.
- **CT-F14-07:** Manual/no-run/aggregation tests cover verified/failed/not-run attestations, historical worktree revisions, positive manual copy, no automated commands, missing/untrusted profiles, warnings, publication-review visibility, and separate baseline/post/manual evidence.
- **CT-F14-08:** Persistence/activity/consumer tests cover idempotent run/step replay, duplicate/conflicting versions, transaction faults, renderer/process restart, F09 correlated lifecycle events, review/synchronization equivalence, renderer-safe read models, no-effect capability scans, and application-coverage conformance.

## Requirement Traceability

| Requirement family | Observable coverage |
|---|---|
| FR-01 | AC-01-AC-02, AC-11, AC-13, CT-F14-01-CT-F14-02 |
| FR-02 | AC-03, AC-05, AC-14-AC-15, CT-F14-04, CT-F14-07-CT-F14-08 |
| FR-03 | AC-02, AC-04, AC-18, CT-F14-02-CT-F14-03 |
| FR-04 | AC-05-AC-08, AC-14, AC-16, CT-F14-04-CT-F14-05 |
| FR-05 | AC-06, AC-09-AC-10, AC-14, AC-16, CT-F14-03, CT-F14-06 |
| FR-06 | AC-12-AC-14, AC-17, CT-F14-07 |
| FR-07 | AC-01, AC-08, AC-11, AC-15-AC-18, CT-F14-01, CT-F14-05, CT-F14-08 |
| NFR-01-NFR-08 | AC-01-AC-18, CT-F14-01-CT-F14-08 |
| INV-01-INV-10 | AC-01-AC-18, CT-F14-01-CT-F14-08 |
