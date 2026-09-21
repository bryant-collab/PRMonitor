# AI-assisted merge-conflict resolution - Product Requirements Document

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F02 - Domain contracts and deterministic state machines | Supplies synchronization statuses, deterministic reason data, stale guards, and explicit user-action transitions. |
| 2 | F03 - SQLite persistence, migrations, and transactional repositories | Persists synchronization inputs, AI work evidence, conflict assessments, user decisions, and restart-safe recovery. |
| 3 | F13-F14 - Worktrees and validation | Supplies the isolated synchronization worktree, merge-base/diff inspection, process execution, and real validation evidence. |
| 4 | F15-F17 - AI contracts, profiles, and bounded work | Supplies the provider-neutral conflict-resolution task, execution policy, turn budget, and progress controls. |
| 5 | F25 - Independent deterministic synchronization and clean-merge results | Detects actual conflicts and owns the ordinary clean-merge path. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F27 - Synchronization result review, staleness, and publication | Presents conflict evidence and user consultation, and owns final publication approval. |
| 2 | F28-F30 - Recovery, hardening, and release acceptance | Exercise restart, security, and end-to-end behavior for conflict resolution. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
|---|---|---|---|
| APP-AC-48 | FR-01-FR-04, FR-06, FR-08 | AC-01-AC-04, AC-06-AC-08 | Shared: F25 detects conflicts and owns the clean path; F26 owns semantic resolution; F27 owns result presentation and publication gating. |
| APP-AC-54-APP-AC-58 | FR-03, FR-06-FR-07 | AC-05-AC-07 | Shared with F17: F17 owns the generic bounded-work policy; F26 supplies conflict-specific completion and attention evidence. |
| APP-AC-59-APP-AC-64 | FR-07 | AC-05-AC-07 | Shared with F15-F17: F26 consumes the configured Merge Conflict Resolution task profile and persists provider-neutral evidence. |
| APP-AC-70 | FR-07 | AC-05-AC-07 | Shared with F16-F17: F26 consumes the snapshotted execution policy and cannot broaden it. |
| APP-AC-76 | FR-01-FR-04 | AC-01-AC-04 | Primary semantic conflict-resolution contract. |
| APP-AC-77 | FR-05-FR-06, FR-08 | AC-05-AC-08 | Shared: F26 owns ambiguity detection and reason data; F27 owns the consultation UI and final publication gate. |

## Executive Summary

When another change lands in the synchronization source branch, a PR may no longer merge cleanly. Textual conflict markers are not enough to resolve that safely: the two sides may represent different product behavior, data assumptions, or bug fixes. PRMonitor must use the configured AI provider only after Git has detected a real conflict, give it the exact changes from both sides and the available intent context, and require it to preserve compatible intent from both branches.

The AI may resolve a conflict in the isolated synchronization worktree, but it may not publish anything. Deterministic checks decide whether the result is actually mergeable. When the intended behavior cannot be established confidently, the tool must stop, alert the developer, explain the competing intents and affected paths, and ask for explicit direction or manual edits. An ambiguous conflict must never be silently converted into a publishable merge.

## User Stories

### Conflict context and intent

- **US-01:** **GIVEN** Git reports a conflict while synchronizing a PR, **WHEN** conflict resolution begins, **THEN** the developer's result includes the exact source/head repositories and branches, source/head/merge-base SHAs, both branch change sets, conflicted paths/hunks, and available intent context before AI work is admitted.
  - **Acceptance Criteria: AC-01, AC-02.**

- **US-02:** **GIVEN** the two sides contain compatible or reconcilable intent, **WHEN** the configured resolver works in the synchronization worktree, **THEN** it proposes or implements a merge that preserves the behavior of both sides and does not blindly choose one side or redesign unrelated code.
  - **Acceptance Criteria: AC-03, AC-04.**

### Ambiguity and human consultation

- **US-03:** **GIVEN** the available code, history, and intent context do not establish one safe semantic resolution, **WHEN** the resolver reaches that conflict, **THEN** it stops with a structured ambiguity result rather than guessing.
  - **Acceptance Criteria: AC-05, AC-06.**

- **US-04:** **GIVEN** an ambiguous conflict, **WHEN** the developer opens the synchronization result, **THEN** the UI and notification explain what conflicts, the competing intents, what input is needed, and the available choices; publication remains blocked until the user-directed result is inspected and validated.
  - **Acceptance Criteria: AC-06, AC-08.**

### Bounded, recoverable execution

- **US-05:** **GIVEN** conflict resolution is stopped, interrupted, or restarted, **WHEN** the developer retries or resumes it, **THEN** the preserved worktree, prior approaches, evidence, usage, and consumed turn budget remain visible and no duplicate merge or publication attempt is created.
  - **Acceptance Criteria: AC-05, AC-07, AC-08.**

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** Git reports no conflict, **WHEN** synchronization prepares a merge, **THEN** the Merge Conflict Resolution task is not invoked and the clean path consumes zero AI-provider tokens.

- **AC-02:** **GIVEN** Git reports a conflict, **WHEN** the conflict-resolution operation is prepared, **THEN** its immutable input includes the source and PR-head repository/branch identities, source/head/merge-base SHAs, source-side and PR-head-side change sets, conflicted paths/hunks, relevant commit metadata, and available PR Intent / Context or source-branch intent context; missing context is identified rather than invented.

- **AC-03:** **GIVEN** a conflict-resolution turn is running, **WHEN** the AI provider inspects or edits files, **THEN** it is confined to the synchronization worktree and configured policy, cannot push, post responses, resolve GitHub conversations, approve, merge, or otherwise publish, and receives explicit instructions to preserve compatible intent from both sides.

- **AC-04:** **GIVEN** the provider reports a resolved conflict, **WHEN** deterministic completion checks run, **THEN** PRMonitor verifies the actual Git index has no unmerged paths, intended files contain no unintended conflict markers, the worktree contains only attributable merge-resolution changes, and configured validation results are captured from real process outcomes before the result can become `READY_TO_PUBLISH`.

- **AC-05:** **GIVEN** a conflict cannot be resolved safely from the available evidence, **WHEN** the AI provider returns an ambiguity, uncertainty, repeated-state, timeout, failure, or budget-stop result, **THEN** the synchronization result becomes `NEEDS_ATTENTION` with a machine-readable reason, preserves the worktree and prior evidence, and cannot become `READY_TO_PUBLISH` through provider prose alone.

- **AC-06:** **GIVEN** a semantic conflict is ambiguous, **WHEN** the ambiguity result is persisted, **THEN** it records the affected paths/hunks, each side's relevant intent/evidence, the unresolved semantic question, possible resolution directions when known, confidence/uncertainty data, and the exact user action required; the developer is alerted through the normal synchronization attention surfaces.

- **AC-07:** **GIVEN** the developer chooses **Retry Resolution**, answers the required question, gives a resolution direction, edits the worktree, or discards the result, **WHEN** that action is confirmed, **THEN** it is recorded as an explicit continuation or terminal action, retains prior history and usage, and cannot silently reset the operation budget or overwrite manual edits.

- **AC-08:** **GIVEN** the application closes, restarts, loses network connectivity, or receives a repeated action, **WHEN** conflict-resolution state is recovered, **THEN** the prior worktree, operation identity, turn reports, user consultation, validation evidence, and known external identifiers remain available, and replay cannot create a duplicate merge commit, push, or response publication attempt.

## Functional Requirements

### FR-01: Conflict-only admission and exact context

- FR-01.1: AI-assisted conflict resolution SHALL be admitted only after deterministic Git execution reports an actual merge conflict; clean merges and already-up-to-date merges SHALL not invoke an AI provider.
- FR-01.2: The conflict input SHALL identify the source and PR-head repositories and branches, source/head/merge-base SHAs, conflicted paths/hunks, source-side change set, PR-head-side change set, and relevant commit/message metadata.
- FR-01.3: The conflict input SHALL include available PR Intent / Context, source-branch intent context, Common Instructions, and repository Build & Validation Instructions, with each source distinguished and snapshotted; missing context SHALL be represented as missing rather than fabricated.

### FR-02: Intent-preserving semantic resolution

- FR-02.1: The resolver SHALL analyze both sides of every conflict and SHALL describe the relevant intent, behavior, invariant, or data assumption represented by each side before selecting a resolution.
- FR-02.2: The resolver SHALL preserve compatible behavior from both sides and SHALL not use an unconditional `ours`, `theirs`, delete-one-side, or textual-hunk-winner strategy as a semantic resolution.
- FR-02.3: The resolver SHALL avoid unrelated redesign and SHALL surface changes outside the conflict-resolution scope for deterministic review.
- FR-02.4: If available evidence does not establish a safe resolution, the resolver SHALL return an ambiguity result instead of asserting that the conflict is resolved.

### FR-03: Isolated and bounded AI work

- FR-03.1: Conflict-resolution AI work SHALL run only in the operation-owned synchronization worktree and SHALL use the configured Merge Conflict Resolution task profile and immutable AI Execution Policy snapshot.
- FR-03.2: Every worktree-mutating turn SHALL use the shared bounded-work controller, timeout, turn budget, progress, repetition, usage, and stop-reason rules.
- FR-03.3: The provider SHALL not receive GitHub publication credentials or authority and SHALL not push, post, approve, resolve GitHub conversations, merge, or force-push.

### FR-04: Deterministic completion gate

- FR-04.1: Provider output SHALL never by itself mark a conflict resolved, validation passed, or synchronization result publishable.
- FR-04.2: Completion SHALL require deterministic inspection of unmerged paths, intended conflict markers, attributable worktree changes, exact merge state, and configured validation outcomes.
- FR-04.3: A failed, interrupted, missing, untrusted, or ambiguous validation result SHALL remain visible and SHALL block `READY_TO_PUBLISH` unless the owning product contract explicitly allows the result to remain `NEEDS_ATTENTION` for user action.

### FR-05: Ambiguity and user consultation

- FR-05.1: An ambiguous semantic conflict SHALL produce `NEEDS_ATTENTION` with a stable reason such as `MERGE_CONFLICT_AMBIGUOUS` or `USER_DECISION_REQUIRED`.
- FR-05.2: The result SHALL identify the affected paths/hunks, competing intents, evidence considered, unresolved question, possible directions when known, and permitted next actions.
- FR-05.3: The developer SHALL be alerted when consultation is required and SHALL be able to inspect the preserved worktree, answer or direct the resolution, edit manually, retry resolution, re-evaluate, or discard.
- FR-05.4: No ambiguous result SHALL transition to `READY_TO_PUBLISH` or publication until an explicit user-directed path produces a newly inspected and validated merge.

### FR-06: Evidence, recovery, and idempotency

- FR-06.1: Each turn SHALL record the reported approach, both-side intent analysis, changed files, commands, deterministic Git state, validation evidence, progress classification, remaining issues, and stop/continue decision.
- FR-06.2: Ambiguity, user questions, answers, resolution directions, manual-edit acknowledgements, retries, and discards SHALL be durable records linked to the synchronization result and operation.
- FR-06.3: Restart, UI closure, cancellation, and uncertain external outcomes SHALL preserve the worktree and prior evidence; only an explicit user action may authorize a new bounded segment.
- FR-06.4: Retry and recovery SHALL reuse the persisted operation/idempotency identity or explicitly supersede it, and SHALL not create duplicate merge commits, pushes, or response publication attempts.

### FR-07: Profile, policy, and usage transparency

- FR-07.1: The result SHALL show the Merge Conflict Resolution task type, provider, model, profile revision, reasoning effort when supported, execution-policy summary, turn budget, consumed turns, and usage metadata when available.
- FR-07.2: Changing preferences SHALL not change the meaning of an active or completed conflict-resolution operation; effective task settings and policy SHALL be snapshotted before the first turn.

### FR-08: Publication boundary

- FR-08.1: Conflict resolution SHALL prepare an inspectable synchronization result only; publication SHALL remain a separate deterministic operation requiring explicit **Publish Merge** approval and fresh SHA checks.
- FR-08.2: A result with unresolved ambiguity, failed completion checks, stale source/head SHAs, or unresolved external outcome SHALL not be published.

## Non-Functional Requirements

- **NFR-01: Safety** - The application fails closed when intent is ambiguous and never treats textual conflict-marker removal as proof of semantic correctness.
- **NFR-02: Explainability** - A developer can see both sides' relevant changes, intent evidence, unresolved questions, AI actions, deterministic checks, and the next permitted action.
- **NFR-03: Reliability** - Conflict operations, consultation records, and evidence remain recoverable across restart, cancellation, repeated actions, and network interruption.
- **NFR-04: Bounded resources** - AI turns, execution time, validation output, and stored conflict evidence remain within configured limits.
- **NFR-05: Accessibility** - Ambiguity alerts, conflict paths, questions, and next actions are keyboard accessible, screen-reader understandable, and not conveyed by color alone.

## Invariants

- **INV-01:** A clean merge never invokes the AI conflict resolver.
- **INV-02:** The resolver receives and preserves distinct source-side and PR-head-side evidence; it never treats one branch as disposable by default.
- **INV-03:** AI output cannot grant publication authority or create deterministic validation success.
- **INV-04:** An unresolved or ambiguous semantic conflict cannot become `READY_TO_PUBLISH`.
- **INV-05:** User consultation and manual edits are explicit durable actions and never silently overwrite prior evidence.
- **INV-06:** Every conflict-resolution retry is bounded, restart-safe, and idempotent with respect to external side effects.

## Out of Scope

- Autonomous publication, force pushes, automatic rebases, or automatic selection of `ours`/`theirs` as a substitute for semantic analysis.
- Resolving conflicts in the developer's normal workspace or another operation's worktree.
- Claiming that tests pass from AI prose or from the absence of conflict markers alone.
- Automatically inventing product intent when PR descriptions, source history, code, and user direction do not establish it.

## Product Decisions

- **PD-01: Resolve actual conflicts only** - The deterministic clean-merge path remains AI-free and consumes zero AI tokens.
- **PD-02: Preserve both intents** - The resolver must understand and preserve compatible behavior from both the source branch and the PR head; it may not silently prefer one side.
- **PD-03: Ambiguity requires consultation** - When semantics are unclear, stopping for user direction is safer than producing a plausible-looking merge.
- **PD-04: Publication remains separate** - A successful conflict-resolution operation creates a reviewable result; it does not authorize a push.

## Implementation Decisions

- **IMP-01: Use the merge base as the comparison anchor** - The merge base and per-side diffs provide a deterministic boundary for explaining what each branch changed.
- **IMP-02: Keep ambiguity in the synchronization result** - Do not add a competing primary PR state; use the existing `NEEDS_ATTENTION` synchronization status with structured reason and consultation data.
- **IMP-03: Reuse the shared AI Work Policy** - Conflict resolution uses the existing task-profile, execution-policy, turn-budget, timeout, usage, progress, and recovery contracts.
- **IMP-04: Separate semantic evidence from deterministic evidence** - AI intent analysis is displayed as analysis; Git state and validation results remain authoritative for completion.

## Testing Decisions

- **TST-01:** Use temporary Git repositories with fixtures for clean merges, textual conflicts, compatible semantic conflicts, incompatible semantic conflicts, missing intent context, conflict-marker residue, unrelated edits, manual edits, restart, timeout, and repeated actions.
- **TST-02:** Assert that clean merges do not invoke the provider and that every conflict-resolution request contains both side diffs, merge base, identities, and available intent snapshots.
- **TST-03:** Assert that ambiguous output produces `NEEDS_ATTENTION`, durable user-question data, an alertable reason, and no publishable result.
- **TST-04:** Fault-inject before/after worktree edits, validation, persistence, cancellation, restart, and uncertain publication to prove prior evidence and idempotency are preserved.
- **TST-05:** Exercise the provider adapter with a fake provider and verify that publication credentials and GitHub side-effect tools are unavailable.

## Proposed Modules

- **MOD-01: Conflict Context Assembler** - Builds the immutable source/head/merge-base identities, per-side diffs, conflict hunks, commit metadata, and intent snapshots.
- **MOD-02: Semantic Conflict Assessment** - Normalizes provider output into both-side intent analysis, proposed resolution, uncertainty, competing intents, and required user question.
- **MOD-03: Conflict Completion Guard** - Combines provider output with deterministic Git/worktree/validation evidence and admits only a valid `READY_TO_PUBLISH` result.
- **MOD-04: Conflict Consultation Record** - Persists ambiguity, questions, user directions, manual-edit acknowledgement, retry, and discard actions.
- **MOD-05: Synchronization Evidence Projector** - Exposes turn reports, deterministic evidence, policy/profile metadata, worktree state, and next actions to F27.

## Workflows

### Workflow 1: Semantically resolvable conflict

```text
Git detects conflict
  -> deterministic context captures source/head/merge-base and both change sets
  -> bounded AI conflict-resolution turn analyzes both intents
  -> AI edits only synchronization worktree
  -> deterministic Git/worktree/validation checks
  -> READY_TO_PUBLISH result for explicit human approval
```

### Workflow 2: Ambiguous conflict requiring the user

```text
Git detects conflict
  -> AI compares both intents and cannot establish a safe resolution
  -> persist competing intents, affected hunks, question, and preserved worktree
  -> NEEDS_ATTENTION notification/result
  -> user answers, directs, edits, retries, re-evaluates, or discards
  -> deterministic inspection and validation
  -> READY_TO_PUBLISH only after the user-directed path succeeds
```

### Workflow 3: Recovery

```text
restart / cancellation / uncertain outcome
  -> recover operation, worktree, turn reports, consultation, budget, and SHAs
  -> require explicit Retry Resolution or another permitted user action
  -> never duplicate a merge commit, push, or response publication
```
