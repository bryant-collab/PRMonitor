# F17 - Bounded AI Work Controller and Deterministic Progress Evaluation - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F03 - SQLite persistence, migrations, and transactional repositories | Provides durable operation, segment, turn, snapshot, usage, report, and restart-safe transaction boundaries. |
| 2 | F04 - Persistent Electron shell, IPC boundary, and Windows virtual-desktop spike | Keeps main-process work alive when the renderer closes and provides the lifecycle signals used by bounded work. |
| 3 | F09 - Durable activity log and operation diagnostics | Records safe, correlated AI-work lifecycle and stop events without becoming authoritative state. |
| 4 | F13 - Operation-owned Git worktrees and change attribution | Supplies authoritative worktree identity, before/after Git evidence, state inspection, and manual-edit preservation. |
| 5 | F14 - Deterministic validation runner and result model | Supplies real validation and command evidence for operation-specific completion and progress decisions. |
| 6 | F15 - Provider-neutral AI contracts and Codex adapter | Supplies normalized provider turns, structured results, usage, cancellation outcomes, and safe provider errors. F17 invokes only this boundary. |
| 7 | F16 - AI preferences, task-profile snapshots, execution policies, and Common Instructions | Supplies the declared task profile, immutable execution-policy snapshot, maximum-turn preference, and immutable segment context. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F18 - Automatic review-to-Review-Bundle vertical slice | Uses bounded proposal/implementation turns, deterministic completion predicates, reports, and attention stop reasons. |
| 2 | F20/F21 - Review Bundle workspace and revisions | Presents turn reports and explicitly authorizes continuation or new bounded work. |
| 3 | F26 - AI-assisted merge-conflict resolution | Uses the same bounded controller, progress evaluator, timeout, report, and retry-resolution contracts. |
| 4 | F28 - Recovery and lifecycle hardening | Reconciles in-flight operations after process interruption, sleep, or restart without auto-authorizing new AI work. |
| 5 | F29/F30 - Security and release readiness | Verifies the controller's provider, credential, worktree, evidence, and packaged-Windows boundaries. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-54 | FR-02.1-FR-02.6 | AC-01-AC-04, AC-16-AC-18 | Primary: F17 enforces the persisted 1-10 budget, default, hard maximum, and consumed-count semantics; F16 owns the Preference setting. |
| APP-AC-55 | FR-03.1-FR-03.5, FR-04.1-FR-04.6 | AC-05, AC-06, AC-14-AC-15, AC-19 | Primary: F17 owns per-turn timeout, cancellation, restart, and budget preservation; F04/F15 provide lifecycle and provider cancellation seams. |
| APP-AC-56 | FR-05.1-FR-05.6, FR-08.1-FR-08.5 | AC-07, AC-08, AC-12-AC-14 | Primary: F17 assembles the AI Work Turn Report from model-reported and deterministic evidence. |
| APP-AC-57 | FR-06.1-FR-07.5 | AC-09-AC-13, AC-17-AC-19 | Primary: F17 evaluates completion/progress and emits machine-readable attention stop reasons. |
| APP-AC-58 | FR-07.1-FR-07.6, FR-09.1-FR-09.5 | AC-16-AC-18, AC-20-AC-21 | Primary: F17 exposes complete history and explicit continuation/new-operation authorization data; F20/F26 own the final controls and presentation. |
| APP-AC-61 | FR-01.2-FR-01.5, FR-10.1-FR-10.3 | AC-02, AC-03, AC-15, AC-20 | Shared: F16 creates immutable profile/policy snapshots; F17 binds them to each segment and never changes them in flight. |
| APP-AC-64 | FR-01.1-FR-01.5, FR-08.2-FR-08.5, FR-10.1-FR-10.4 | AC-02, AC-07, AC-12, AC-15, AC-20 | Shared: F17 owns operation/segment/turn lifecycle metadata and usage aggregation; F03 persists it and F15 supplies provider-neutral values. |
| APP-AC-66 | FR-06.2-FR-06.4 | AC-10, AC-11 | Shared: F17 permits a schema-valid, fully accounted-for no-code semantic result to complete; F18 owns Review Bundle interpretation and presentation. |
| APP-AC-70 | FR-01.2-FR-01.5, FR-10.1-FR-10.4 | AC-02, AC-03, AC-15, AC-20 | Shared: F16 resolves the policy and safety floor; F17 snapshots and refuses a changed or broadened policy during an operation; F15 translates it. |

F17 does not claim the Preferences UI, provider SDK behavior, Git/worktree truth,
validation execution, Review Bundle presentation, synchronization publication,
or the final PR state transition. Those boundaries remain owned by F16, F15,
F13, F14, F20/F26, and the domain/workflow features respectively.

## Executive Summary

PRMonitor must never keep asking an AI provider to change an isolated worktree
until the provider happens to say it is finished. An AI turn can time out, fail,
repeat the same state, make irrelevant edits, consume the available budget, or
report success while deterministic inspection shows that the actual problem is
still present. These outcomes must be durable and understandable to the
developer.

F17 provides the bounded work controller used whenever PRMonitor may invoke a
provider again based on the result of a prior worktree-mutating turn. It records
the parent operation, each explicitly bounded segment, immutable configuration
snapshots, turn budgets, timeouts, usage, actual file and command activity,
completion evidence, state fingerprints, progress classifications, and safe
machine-readable stop reasons. It evaluates progress from deterministic F13/F14
evidence and operation-owned completion predicates; provider prose is displayed
as a claim, never treated as application truth.

The controller also supports bounded read-only provider turns such as the
initial Review Proposal. Those turns receive the same timeout, persistence,
usage, and evidence treatment, but they do not consume the worktree-mutating
turn budget. A valid semantic result that makes no code change can therefore
complete normally. When work stops, the developer sees the complete history
before choosing **Continue AI Work**, **Retry Resolution**, or a new operation.
No renderer closure, restart, or automatic retry resets a consumed budget or
silently authorizes another provider turn.

## User Stories

### Keep AI work bounded and cost-visible

- **US-01:** **GIVEN** a worktree-mutating task is authorized, **WHEN** bounded AI work starts, **THEN** the developer can see the configured budget, consumed turns, remaining turns, task profile, policy snapshot, and operation status.
  - **Acceptance Criteria:** AC-01-AC-04, AC-12, AC-15.
- **US-02:** **GIVEN** an AI provider is invoked, **WHEN** the turn completes, **THEN** the application records usage when available and does not count tool calls or shell commands inside one provider invocation as extra turns.
  - **Acceptance Criteria:** AC-03, AC-12, AC-14.

### Trust deterministic evidence over provider claims

- **US-03:** **GIVEN** a provider reports an approach, changed files, or completion, **WHEN** the turn ends, **THEN** PRMonitor compares that claim with actual worktree, command, Git, and validation evidence and explains any difference.
  - **Acceptance Criteria:** AC-07-AC-11, AC-19.
- **US-04:** **GIVEN** an operation has a deterministic completion predicate, **WHEN** the predicate is false, **THEN** progress safeguards can stop the operation even when the provider claims success; **WHEN** the predicate is true, **THEN** a valid semantic result can complete even without code changes.
  - **Acceptance Criteria:** AC-09-AC-11, AC-17.

### Preserve work across interruption

- **US-05:** **GIVEN** the renderer closes, the application restarts, or the provider is interrupted, **WHEN** the developer reopens PRMonitor, **THEN** the operation retains its budget, snapshots, reports, usage, worktree, and stop reason and does not silently start another turn.
  - **Acceptance Criteria:** AC-05, AC-06, AC-15, AC-19.
- **US-06:** **GIVEN** a turn times out or is cancelled, **WHEN** the stop is recorded, **THEN** the developer receives an actionable attention result and preserved evidence rather than a fabricated success.
  - **Acceptance Criteria:** AC-05-AC-06, AC-12-AC-13, AC-19.

### Make continuation explicit

- **US-07:** **GIVEN** bounded work stops before the parent budget is exhausted, **WHEN** the developer chooses **Continue AI Work** or **Retry Resolution**, **THEN** PRMonitor shows the complete report and starts a new bounded segment only after explicit authorization.
  - **Acceptance Criteria:** AC-16, AC-18, AC-20.
- **US-08:** **GIVEN** the parent budget is exhausted, **WHEN** the developer wants more AI work, **THEN** PRMonitor requires a new explicitly confirmed operation with a new bounded budget and shows the prior cumulative history and usage.
  - **Acceptance Criteria:** AC-17-AC-18, AC-20-AC-21.

### Support valid no-code outcomes

- **US-09:** **GIVEN** a Review Proposal accounts for every input event and all recommendations are `pushback`, `question`, or `no_change`, **WHEN** deterministic inspection confirms that the worktree is unchanged, **THEN** the proposal can complete without being misclassified as no progress.
  - **Acceptance Criteria:** AC-10-AC-11.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** a worktree-mutating operation requests a maximum turn budget of 1 through 10, **WHEN** F17 admits it, **THEN** the persisted parent operation records that value; an omitted value resolves to 3; a value below 1, above 10, or otherwise invalid is rejected before any provider effect; and the hard maximum of 10 cannot be overridden.
- **AC-02:** **GIVEN** F16 provides a declared task type, immutable profile/policy snapshot, operation-owned worktree scope, and a versioned completion-predicate contract, **WHEN** F17 creates work, **THEN** it persists the parent operation and a bounded segment containing those snapshots before any F15 invocation, and it refuses missing, stale, mismatched, or broadened inputs.
- **AC-03:** **GIVEN** a mutating provider turn is admitted, **WHEN** F17 persists its turn intent and invokes F15, **THEN** the turn receives one durable identity and consumes at most one budget unit; provider tool calls, file edits, and commands inside that invocation do not consume additional units; a known pre-start rejection does not consume a unit; and an uncertain provider start is conservatively retained as consumed pending explicit reconciliation.
- **AC-04:** **GIVEN** a read-only Review Proposal or Read-only Conversation turn is admitted, **WHEN** it completes, **THEN** its timeout, normalized result, usage, and report evidence are persisted, but it consumes no worktree-mutating budget and cannot authorize a mutating turn.
- **AC-05:** **GIVEN** an admitted provider turn has a finite effective timeout, **WHEN** the timeout, user cancellation, application shutdown, or provider abort occurs, **THEN** F17 requests cancellation through F15, records one terminal bounded outcome and machine-readable reason, starts no replacement turn automatically, preserves prior evidence, and maps the owning workflow to a reviewable attention result. Closing the renderer alone does not cancel the turn.
- **AC-06:** **GIVEN** a process restarts or a renderer is recreated after a turn intent was committed, **WHEN** the operation is read, **THEN** the original parent budget, consumed count, segment snapshot, turn identity, usage, and reports remain intact; an in-flight or uncertain turn is reconciled as interrupted/uncertain according to its durable evidence; no provider turn is resumed merely because the UI reopened.
- **AC-07:** **GIVEN** a provider turn reaches a terminal normalized result, **WHEN** F17 evaluates it, **THEN** it requests fresh authoritative F13 worktree/Git evidence and applicable F14 validation evidence, records actual changed files and commands separately from provider claims, and refuses to use missing, stale, or invalid evidence as a successful completion.
- **AC-08:** **GIVEN** the same canonical operation inputs, F13/F14 evidence, completion-predicate version, and prior fingerprint history, **WHEN** progress is evaluated twice, **THEN** F17 produces the same state fingerprint, material-progress classification, completion decision, and safe reason without invoking an AI provider.
- **AC-09:** **GIVEN** a newly evaluated state fingerprint has appeared previously in the same parent operation, **WHEN** the completion predicate is still false, **THEN** F17 stops automatic AI work with `AI_REPEATED_STATE`, preserves the worktree and report history, and does so even when the repeated state is separated by another turn.
- **AC-10:** **GIVEN** the completion predicate is false, **WHEN** two consecutive mutating turns have no material deterministic progress, **THEN** F17 stops automatic work with `AI_NO_PROGRESS`; unrelated file churn, formatting-only noise, or provider-reported effort does not count as material progress. A valid semantic result with no code change can instead be classified `completed` when its predicate is true.
- **AC-11:** **GIVEN** a schema-valid semantic result covers its complete input and the operation-specific deterministic completion predicate is true, **WHEN** the worktree has no forbidden mutation and required evidence is present, **THEN** F17 permits successful completion even when no files changed; otherwise provider claims of success cannot create completion or validation pass. This includes all-`pushback`, all-`question`, and all-`no_change` Review Proposal outcomes.
- **AC-12:** **GIVEN** any mutating turn finishes, **WHEN** F17 persists the AI Work Turn Report, **THEN** the report contains the turn number, times, objective, model-reported approach/problems/remaining issues, actual changed files and executed commands, deterministic validation/results, remaining deterministic problems, progress classification, state fingerprint, usage when available, and the reason the next turn started or work stopped.
- **AC-13:** **GIVEN** a turn times out, provider execution fails, cancellation is not cleanly reconciled, the state repeats, two no-progress turns occur, or the budget is exhausted, **WHEN** F17 finalizes the operation, **THEN** it records a stable stop reason such as `AI_TURN_TIMEOUT`, `AI_EXECUTION_FAILED`, `AI_TURN_CANCELLED`, `AI_REPEATED_STATE`, `AI_NO_PROGRESS`, or `AI_TURN_BUDGET_EXHAUSTED`, preserves all evidence, and exposes a reviewable `NEEDS_ATTENTION` outcome to the owning workflow.
- **AC-14:** **GIVEN** a provider reports usage counters, **WHEN** a turn and its segment are finalized, **THEN** F17 preserves provider-neutral input, cached-input, cache-write, output, reasoning, total, and unavailable fields without guessing missing values, and derives cumulative operation usage deterministically from persisted turn records.
- **AC-15:** **GIVEN** Preferences change after a segment snapshot is persisted, **WHEN** a turn or old result is read, **THEN** the segment continues to display and use its original task profile, policy, and context snapshot; the changed Preferences can affect only a newly authorized segment or operation, never an in-flight turn or historical report.
- **AC-16:** **GIVEN** an operation stops while parent budget remains, **WHEN** the developer chooses **Continue AI Work** or synchronization chooses **Retry Resolution**, **THEN** the complete prior report, stop reason, remaining issues, consumed count, remaining budget, and cumulative usage are available before confirmation, and the explicit action creates one new bounded segment without resetting the parent history or budget.
- **AC-17:** **GIVEN** a parent operation has exhausted its hard or configured budget, **WHEN** the developer requests more AI work, **THEN** F17 refuses silent continuation and requires a new explicitly confirmed parent operation with a 1-10 budget; the new operation links to prior history and shows cumulative prior usage without treating it as fresh progress.
- **AC-18:** **GIVEN** a continuation or new operation is requested, **WHEN** the authorization is missing, stale, cancelled, or asks for a broader policy/worktree scope than the immutable snapshot allows, **THEN** F17 starts no provider turn and returns an actionable refusal; a valid authorization is consumed idempotently exactly once.
- **AC-19:** **GIVEN** the provider result, timeout, persistence acknowledgement, or worktree inspection outcome is uncertain, **WHEN** F17 reconciles the turn, **THEN** it never converts uncertainty into success, never launches an automatic duplicate, and leaves a machine-readable recovery/attention record with the preserved operation worktree.
- **AC-20:** **GIVEN** the stopped-operation read model is shown before continuation, **WHEN** a keyboard or forced-colors user navigates it, **THEN** the report distinguishes provider claims from deterministic evidence, exposes the permitted next action and required confirmation, and does not require a pointer or color-only interpretation. F17 supplies semantic labels and state data; downstream UI owns layout.
- **AC-21:** **GIVEN** F17 receives a provider-neutral result, snapshot, usage record, or diagnostic, **WHEN** it persists or emits it, **THEN** it contains no provider SDK object, credential, GitHub token, raw authorization header, uncontrolled environment value, publication method, or unbounded output, and it exposes no operation capable of commit, push, response posting, merge, or publication.

## Functional Requirements

### FR-01: AI Work Operation and segment lifecycle

- FR-01.1: F17 SHALL represent each worktree-mutating sequence as one durable parent AI Work Operation with a stable identity, declared task type, operation purpose, operation-owned worktree reference, completion-predicate identity/version, current status, configured budget, consumed count, and cumulative usage reference.
- FR-01.2: F17 SHALL represent each explicitly authorized bounded attempt as a child segment with its own identity, authorization record, immutable F16 profile/policy/context snapshots, effective timeout, bounded turn allowance, start/end timestamps, and parent-operation link.
- FR-01.3: F17 SHALL represent every provider invocation with a stable turn identity, sequence number, interaction mode, lifecycle status, request/segment snapshot reference, and terminal outcome; a read-only turn SHALL be distinguishable from a worktree-mutating turn.
- FR-01.4: Parent, segment, and turn states SHALL use deterministic allowed transitions and SHALL reject terminal-state mutation, duplicate sequence numbers, cross-operation identities, and a second active mutating segment for one parent.
- FR-01.5: F17 SHALL expose a provider-neutral read model for downstream workflow/UI features without exposing provider SDK objects, process handles, credentials, or mutable renderer state.

### FR-02: Bounded budget and accounting

- FR-02.1: F17 SHALL enforce a worktree-mutating budget of 1 through 10 turns, defaulting to 3 when no valid preference or explicit operation value is supplied, with 10 as an application-enforced hard maximum.
- FR-02.2: F17 SHALL persist the effective budget and its source/revision before the first mutating provider effect; a per-operation override SHALL be explicit, bounded by 10, and visible in the operation record.
- FR-02.3: A mutating provider invocation SHALL consume at most one budget unit, and internal provider tool calls, shell commands, file edits, and streamed events SHALL not create additional budget units.
- FR-02.4: F17 SHALL distinguish a known pre-start refusal from a provider invocation whose start or outcome is uncertain; only a known non-start may release its reservation, while an uncertain start remains conservatively accounted for until explicit reconciliation.
- FR-02.5: F17 SHALL refuse automatic or explicit mutating work when no budget remains, unless the workflow creates a separately confirmed new parent operation with a new bounded budget.
- FR-02.6: Read-only proposal and conversation turns SHALL have their own bounded lifecycle and timeout but SHALL not consume the worktree-mutating budget or authorize mutation.

### FR-03: Durable admission, persist-before-effect, and replay

- FR-03.1: F17 SHALL ask F03 to persist parent/segment/turn intent and the immutable input snapshot before calling F15 or causing another provider-side external effect.
- FR-03.2: F17 SHALL validate F16 snapshot identity, F13 worktree ownership/current scope, completion-predicate version, budget reservation, timeout, and required cancellation channel before intent commit.
- FR-03.3: A repeated request for an existing non-terminal turn identity SHALL return the durable in-flight or terminal record rather than starting a second provider invocation.
- FR-03.4: A provider result SHALL be attached to the exact committed turn identity and segment; a result for a different operation, snapshot, or sequence SHALL fail closed and leave the operation reviewable.
- FR-03.5: F17 SHALL treat F03 records as authoritative over activity text, renderer state, provider thread state, and in-memory counters.

### FR-04: Timeout, cancellation, shutdown, and restart

- FR-04.1: Every provider turn SHALL have an immutable finite effective timeout; F17 SHALL apply a 10-minute default and a 1-second-through-60-minute validation range unless a stricter upstream contract applies.
- FR-04.2: When a timeout or permitted cancellation occurs, F17 SHALL signal F15 through the turn's abort channel, await one normalized terminal outcome within a bounded reconciliation window, and record whether termination was confirmed or uncertain.
- FR-04.3: F17 SHALL distinguish user cancellation, application shutdown, application restart, provider timeout, provider failure, and uncertain termination in safe stop data; none SHALL be converted to a successful completion by provider prose.
- FR-04.4: Renderer closure, navigation, or renderer recreation SHALL not cancel main-process AI work and SHALL not release a budget reservation.
- FR-04.5: Startup reconciliation SHALL preserve committed budgets and histories, finalize or mark in-flight turns according to durable evidence, and SHALL never auto-resume a stopped or uncertain provider turn.
- FR-04.6: A timeout, cancellation, shutdown, or restart SHALL not start a replacement turn automatically, even when budget remains.

### FR-05: Deterministic turn evidence and progress evaluation

- FR-05.1: After every worktree-mutating turn, F17 SHALL request fresh authoritative F13 worktree/Git evidence and applicable F14 validation evidence before deciding completion, progress, or continuation.
- FR-05.2: F17 SHALL preserve provider-reported approach, problems, remaining issues, changed-file claims, and command claims as model-reported data separate from deterministic observations.
- FR-05.3: F17 SHALL compute a bounded canonical state fingerprint from the operation's declared problem-state inputs, completion-predicate version, F13 evidence, F14 evidence when applicable, and relevant deterministic result identity.
- FR-05.4: Given equivalent canonical inputs and prior history, the progress evaluator SHALL return equivalent completion, material-progress classification, fingerprint, and safe reason without invoking AI.
- FR-05.5: Material progress SHALL be determined from actual worktree/problem/validation evidence and the operation predicate; unrelated churn, provider effort, or a claimed edit SHALL not count by itself.
- FR-05.6: F17 SHALL detect a previously observed fingerprint anywhere in the same parent operation and SHALL detect two consecutive non-completing mutating turns classified as `no_progress`.

### FR-06: Completion predicates and valid semantic outcomes

- FR-06.1: Each AI Work Operation SHALL declare a versioned deterministic completion predicate and bounded predicate input snapshot; provider output SHALL not define or replace the predicate.
- FR-06.2: F17 SHALL permit completion when the predicate is true and all required deterministic evidence is present, even when no files changed or the provider reports a different narrative.
- FR-06.3: The shared contract SHALL support Review Proposal, Review Implementation, and Merge Conflict Resolution predicates without embedding workflow-specific publication decisions in F17.
- FR-06.4: A Review Proposal predicate SHALL be able to require complete input-event accounting, schema-valid semantic dispositions, and an unchanged worktree; all-`pushback`, all-`question`, and all-`no_change` results SHALL remain valid completion outcomes.
- FR-06.5: An implementation or conflict predicate SHALL be able to require final human decisions, fresh worktree inspection, no unmerged paths or forbidden conflict residue where applicable, and real F14 validation evidence.
- FR-06.6: Missing, stale, contradictory, or invalid predicate evidence SHALL produce a safe non-success outcome rather than a guessed completion.

### FR-07: Stop reasons and explicit continuation

- FR-07.1: F17 SHALL emit stable machine-readable stop reasons for budget exhaustion, timeout, cancellation, provider/execution failure, repeated state, consecutive no-progress, invalid/missing evidence, policy/snapshot mismatch, persistence failure, and uncertain termination.
- FR-07.2: Repeated state, two consecutive no-progress turns while incomplete, timeout, execution failure, cancellation, or budget exhaustion SHALL stop automatic AI work and provide an attention outcome to the owning workflow.
- FR-07.3: A stopped operation SHALL preserve its isolated worktree, immutable snapshots, reports, usage, deterministic evidence, and prior remote/input references for inspection.
- FR-07.4: F17 SHALL not retry, continue, change policy, change task profile, or create a new segment automatically after any stop reason.
- FR-07.5: F17 SHALL provide the remaining budget, prior reports, stop reason, unresolved problems, and accumulated usage required for a human confirmation surface.
- FR-07.6: A valid explicit continuation SHALL create one new bounded segment; a request after parent budget exhaustion SHALL create a separately confirmed parent operation instead.

### FR-08: AI Work Turn Reports, usage, and read model

- FR-08.1: F17 SHALL persist an AI Work Turn Report for every provider turn, including read-only turns, with turn number, times, objective, model-reported approach/problems/remaining issues, actual changed files when applicable, actual commands when applicable, deterministic results, remaining problems, progress classification when applicable, state fingerprint when applicable, usage when available, and next-action/stop rationale.
- FR-08.2: F17 SHALL retain normalized provider usage counters when present, including input, cached input, cache-write input, output, reasoning output, total, and explicitly unavailable values.
- FR-08.3: F17 SHALL derive cumulative operation and segment usage from durable turn records and SHALL not double-count a replayed or reconciled turn.
- FR-08.4: F17 SHALL expose a bounded read model that distinguishes model claims, F13 observations, F14 results, completion decisions, progress classifications, and stop reasons.
- FR-08.5: F17 SHALL emit correlated safe activity events for admission, turn start/terminal, progress evaluation, stop, continuation authorization, and restart reconciliation without using activity as authoritative state.

### FR-09: Continuation authorization and cumulative history

- FR-09.1: F17 SHALL require an explicit human authorization record for **Continue AI Work** or **Retry Resolution**, including the operation/segment identity, displayed history revision, selected budget, and confirmation result.
- FR-09.2: A continuation before parent exhaustion SHALL use only the parent's remaining budget and SHALL not reset consumed count, fingerprints, usage, or stop history.
- FR-09.3: A new operation after exhaustion SHALL accept a new 1-10 budget, link to the prior operation, and expose prior attempts and cumulative usage before its first turn.
- FR-09.4: A continuation or new operation SHALL use a newly supplied F16 snapshot only after explicit authorization; an earlier segment's snapshot SHALL remain immutable.
- FR-09.5: Stale, duplicate, cancelled, or incomplete authorization SHALL start no provider turn and SHALL be safe to retry after a fresh read.

### FR-10: Boundary and handoff safety

- FR-10.1: F17 SHALL invoke providers only through F15 and SHALL consume normalized events/results rather than provider SDK types or prose parsing.
- FR-10.2: F17 SHALL use F13 for worktree/Git truth and F14 for validation truth; F17 SHALL not create, reset, clean, publish, or delete a worktree and SHALL not infer validation pass from model output.
- FR-10.3: F17 SHALL preserve the F16 task profile, execution-policy, Common Instruction, Build & Validation, and applicable context snapshot references used by each segment.
- FR-10.4: F17 SHALL expose no commit, push, GitHub response, merge, conversation-resolution, or publication capability to a provider or renderer request.
- FR-10.5: F17 SHALL persist and emit only bounded, redacted, provider-neutral values and SHALL exclude credentials, raw authorization material, uncontrolled environment data, SDK objects, and unbounded provider output.

## Non-Functional Requirements

- **NFR-01: Determinism** - Given the same serialized operation inputs, F13/F14 evidence, predicate version, prior fingerprints, provider-normalized terminal result, and injected clock, F17 SHALL produce equivalent budget, progress, completion, stop, usage, and read-model outcomes without AI judgment.
- **NFR-02: Durability and restart safety** - Committed operation, segment, turn, snapshot, report, usage, fingerprint, and authorization records SHALL survive renderer closure and process restart; no in-memory counter SHALL be authoritative.
- **NFR-03: Bounded behavior** - Budgets, turn timeouts, provider-event retention, report text, output details, fingerprint inputs, continuation history, reconciliation windows, and diagnostics SHALL have explicit finite limits and SHALL fail closed when limits are exceeded.
- **NFR-04: Security and least privilege** - F17 SHALL preserve operation-owned worktree and policy boundaries, expose no publication authority, and keep provider credentials, GitHub credentials, SDK objects, and uncontrolled environment values out of persisted or renderer-facing records.
- **NFR-05: Observability and reproducibility** - A developer and downstream workflow SHALL be able to reconstruct why each turn started, what the provider claimed, what deterministic evidence showed, why progress was classified, why work stopped, and what action is permitted next.
- **NFR-06: Idempotency and concurrency** - Duplicate requests, renderer races, restart replay, stale continuation actions, and competing segment starts SHALL not duplicate provider turns, consume more than one budget unit, or overwrite a committed terminal outcome.
- **NFR-07: Windows main-process behavior** - Timeout, cancellation, renderer closure, application shutdown, and restart behavior SHALL work while the Electron main process remains authoritative on Windows; renderer absence SHALL not terminate or reset bounded work.
- **NFR-08: Extensibility and testability** - Review, revision, conversation, and conflict workflows SHALL use the same controller/evaluator contracts with injected F03/F13/F14/F15/F16 seams, fake clocks, fake providers, and temporary worktrees; adding a provider SHALL not change budget or progress policy.

## Invariants

- **INV-01:** Deterministic application code owns operation state, budget, timeout, cancellation, completion predicates, fingerprints, progress, stop reasons, continuation authorization, usage aggregation, and publication gating; AI output cannot choose an application state.
- **INV-02:** Parent/segment/turn intent is durably committed before F15 invocation, and no provider turn starts from an uncommitted or stale intent.
- **INV-03:** A worktree-mutating provider invocation consumes no more than one budget unit, and no renderer closure, restart, retry, or segment boundary resets the parent consumed count or fingerprint history.
- **INV-04:** F13 actual worktree/Git evidence and F14 actual validation evidence outrank provider-reported files, commands, progress, completion, or success.
- **INV-05:** Read-only provider turns cannot mutate a worktree, cannot authorize mutation, and do not consume the worktree-mutating budget.
- **INV-06:** A repeated state or two consecutive non-completing no-progress turns stops automatic work even if a provider claims improvement; a valid predicate-complete no-code result is not false no-progress.
- **INV-07:** A stopped or uncertain operation preserves its worktree and evidence and cannot silently retry, resume, broaden policy, or publish.
- **INV-08:** Every segment uses immutable task-profile, execution-policy, context, worktree, and predicate snapshots; later Preferences changes affect only an explicitly authorized future segment or operation.
- **INV-09:** F17 has no commit, push, GitHub, response-posting, merge, conversation-resolution, or publication authority, and no provider receives such authority through F17.
- **INV-10:** Provider references, usage, reports, and diagnostics are bounded, serializable, redacted, and provider-neutral; F03 records and deterministic evidence remain authoritative over activity text and provider thread state.

## Out of Scope

- Provider SDK invocation, Codex thread management, provider authentication, structured-output validation, provider event normalization, and provider-specific cancellation implementation; F15 owns those behaviors.
- SQLite migrations, generic repository implementation, transaction internals, and database backup/recovery mechanics; F03 owns them.
- Creating, deleting, moving, resetting, cleaning, or inspecting Git worktrees; F13 owns worktree/Git truth.
- Running validation commands or deciding command semantics; F00/F14 own validation configuration and execution.
- Preferences UI, task-profile/policy resolution, Common Instruction editing, and Build & Validation settings; F16 owns them.
- Review Bundle item decisions, diff rendering, notifications, PR state presentation, synchronization publication, commits, pushes, GitHub responses, merges, and releases.
- Automatic retry, autonomous continuation, unbounded background loops, semantic judgment about whether code is good, and blind conflict-side selection.

## Product Decisions

- **PD-01: Three-turn default, ten-turn hard maximum** - The configured mutating-turn budget defaults to 3, accepts 1 through 10, and cannot exceed 10 even for an explicit operation override.
- **PD-02: One provider invocation equals one turn** - Internal tool calls, shell commands, file edits, and streaming events do not consume additional budget units.
- **PD-03: Read-only work is bounded but not charged to the mutating budget** - Review Proposal and Read-only Conversation turns retain timeout, usage, and report evidence but do not reduce the worktree-mutating budget or grant mutation authority.
- **PD-04: Turn timeout is finite and controller-owned** - F17 uses a 10-minute default and accepts only 1 second through 60 minutes for an effective turn timeout; the value is snapshotted per segment and is not silently extended by provider activity.
- **PD-05: No automatic retries** - Any timeout, failure, cancellation, repeated state, no-progress stop, or budget exhaustion requires an explicit human-directed continuation or a new operation.
- **PD-06: Continuation preserves the parent history** - A continuation before exhaustion uses only remaining parent budget and starts a new segment; after exhaustion, a separately confirmed parent operation with a new budget is required and links to prior history.
- **PD-07: No-code semantic completion is valid** - A schema-valid, complete semantic result may finish successfully without file changes when the operation predicate says the work is complete.
- **PD-08: Deterministic evidence is authoritative** - Provider-reported approach, changed files, command results, and completion are visible claims only; F13/F14 evidence and registered completion predicates decide progress and success.
- **PD-09: Uncertain starts are conservative** - If the application cannot prove that a mutating provider invocation never started, it retains the reservation/consumption and requires reconciliation rather than risking a duplicate turn.

## Implementation Decisions

- **IMP-01: Use one deep controller port** - `AIWorkController` owns admission, durable intent handoff, turn lifecycle, budget, timeout, stop, continuation, and read-model projection while hiding persistence/provider complexity behind narrow ports.
- **IMP-02: Use registered deterministic predicates** - An operation stores a predicate ID/version and bounded input snapshot. F17 invokes a registered deterministic evaluator; a provider cannot submit a predicate or arbitrary completion callback.
- **IMP-03: Hash canonical evidence** - `AIProgressEvaluator` canonicalizes bounded F13/F14/problem-state evidence and hashes it into a state fingerprint. It records the evidence revision and predicate version used to make the fingerprint.
- **IMP-04: Reserve before invoking and finalize exactly once** - F17 persists a turn reservation before F15, finalizes it with a normalized outcome, and uses idempotency/optimistic concurrency to prevent duplicate starts or double consumption.
- **IMP-05: Keep reports split by authority** - The report schema has explicit model-reported and deterministic-observation sections; downstream UI must not merge them into one claim.
- **IMP-06: Keep F17 provider-neutral** - F17 imports only the F15 contract and never imports `@openai/codex-sdk`, reads credentials, starts a child process, or parses provider-specific events.
- **IMP-07: Keep lifecycle in the main process** - The main process owns timers, abort signals, persistence calls, and reconciliation; renderer IPC receives bounded projections and explicit authorization requests only.
- **IMP-08: Treat cumulative usage as a derived durable projection** - Per-turn usage remains immutable; operation/segment totals are recomputed or transactionally updated from those records and never incremented from renderer state.

## Testing Decisions

- **TST-01: Deep-test the pure evaluator** - Test canonicalization, material-progress rules, repeated fingerprints, consecutive no-progress, completion predicates, no-code completion, and deterministic reasons with injected evidence.
- **TST-02: Fault-inject every durable boundary** - Test before/after operation, segment, reservation, provider-result, report, usage, continuation, and reconciliation commits; prove no duplicate provider turn or budget reset.
- **TST-03: Use fake provider and evidence ports** - Tests use normalized F15 fixtures, F13 worktree snapshots, F14 validation results, fake clocks, and temporary repositories; they do not use a live provider, GitHub, real credentials, or the developer worktree.
- **TST-04: Exercise Windows lifecycle semantics** - Cover renderer closure, shutdown, timeout/cancellation, process restart, stale renderer callbacks, and bounded main-process reconciliation on Windows-compatible seams.
- **TST-05: Test read-model semantics, not visual styling** - Verify report authority labels, required next actions, history ordering, budget/usage values, accessibility names, and forced-colors semantic status; F20/F26 own detailed visual layout.
- **TST-06: Prove negative authority cases** - Scan records and IPC/provider requests for credentials, SDK instances, unbounded output, publication methods, arbitrary paths, and model claims treated as deterministic success.
- **TST-07: Require cross-workflow conformance** - Thin Review Proposal, Review Implementation, Review Revision, Read-only Conversation, and Conflict Resolution consumers must use the same controller/evaluator contract and must not implement ad hoc retry or budget logic.

## Proposed Modules

- **MOD-01: AI Work Controller** - Deep public service for operation admission, segment/turn lifecycle, budget, timeout, stop, continuation, and safe read-model projection.
- **MOD-02: AI Work Persistence Port** - F03-facing repository contract for operation, segment, turn, report, usage, fingerprint, authorization, and reconciliation records.
- **MOD-03: AI Turn Admission and Idempotency Guard** - Validates snapshots, worktree ownership, predicate/version, budget reservation, and duplicate identities before F15.
- **MOD-04: Turn Timeout and Cancellation Coordinator** - Owns effective timeout, abort propagation, cancellation classification, bounded reconciliation, and no-auto-retry behavior.
- **MOD-05: Deterministic Progress Evaluator** - Builds canonical state evidence, fingerprints, material-progress classifications, completion decisions, and stop recommendations.
- **MOD-06: Completion Predicate Registry** - Resolves versioned operation-specific predicates for review proposal, implementation, and conflict-resolution consumers without provider callbacks.
- **MOD-07: AI Work Turn Report Assembler** - Separates model claims from F13/F14 observations, normalizes usage, and records the next-turn/stop rationale.
- **MOD-08: Continuation Authorization Service** - Validates explicit human continuation/new-operation decisions, displayed-history revisions, remaining budgets, and one-time authorization use.
- **MOD-09: AI Work Read Model and Activity Adapter** - Projects bounded history for UI/workflow consumers and emits correlated F09 activity without making activity authoritative.

## Workflows

### Workflow 1: Admit and run a bounded mutating operation

```text
1. A downstream workflow declares the task type, operation purpose, F13 worktree,
   F16 immutable snapshot, completion predicate/version, and requested budget.
2. F17 validates the snapshot, policy, scope, timeout, predicate, and 1-10 budget.
3. F03 commits the parent operation, segment, and first-turn reservation intent.
4. F17 invokes F15 with the exact committed turn identity and abort channel.
5. F15 returns normalized events/result/error; F17 persists the terminal handoff.
6. F17 requests fresh F13/F14 evidence, evaluates the predicate and progress,
   and stores the AI Work Turn Report.
7. F17 either completes, starts the next turn within the remaining budget, or
   stops with an attention reason and preserved worktree.
```

### Workflow 2: Stop on timeout, failure, repetition, or no progress

```text
1. A timeout, cancellation, provider failure, repeated fingerprint, two
   consecutive no-progress turns, invalid evidence, or budget exhaustion occurs.
2. F17 records the normalized stop reason and final report transactionally.
3. The operation remains reviewable with its worktree, snapshots, evidence,
   usage, and complete prior history.
4. The owning workflow maps the stop to NEEDS_ATTENTION and exposes only the
   permitted next action; F17 does not retry or publish.
```

### Workflow 3: Explicit continuation before budget exhaustion

```text
1. The read model shows the complete report history, remaining issues, remaining
   budget, usage, stop reason, and current task/policy snapshot.
2. The developer explicitly chooses Continue AI Work or Retry Resolution.
3. F17 verifies the displayed-history revision and authorization, and F16 may
   provide a new immutable segment snapshot after the explicit decision.
4. F03 commits one continuation segment using only the parent's remaining budget.
5. F17 runs the next turn with the cumulative history and fingerprints intact.
```

### Workflow 4: New operation after budget exhaustion

```text
1. The read model explains that the parent budget is exhausted and blocks silent
   continuation.
2. The developer reviews prior approaches, problems, remaining issues, reports,
   snapshots, and cumulative usage.
3. The developer explicitly confirms a new 1-10-turn budget and any new snapshot.
4. F03 commits a new parent operation linked to the prior operation.
5. F17 starts only the newly authorized bounded operation; prior history remains
   visible and cannot be counted as new deterministic progress.
```

### Workflow 5: Valid no-code semantic completion

```text
1. F18 supplies a proposal predicate requiring complete event accounting and an
   unchanged worktree.
2. F15 returns schema-valid items whose dispositions are pushback, question, or
   no_change, with no implementation edits.
3. F17 obtains F13 evidence showing no worktree mutation and evaluates the
   predicate as complete.
4. F17 records completed rather than no_progress and returns the result to F18.
```

## Requirement Traceability

| Requirement family | Observable acceptance criteria | Named contract-test criteria |
|---|---|---|
| FR-01 | AC-02-AC-04, AC-06, AC-15, AC-20 | CT-F17-01, CT-F17-03, CT-F17-08 |
| FR-02 | AC-01-AC-04, AC-13, AC-16-AC-18 | CT-F17-01, CT-F17-02, CT-F17-08 |
| FR-03 | AC-02-AC-03, AC-06, AC-18-AC-19 | CT-F17-02, CT-F17-03, CT-F17-09 |
| FR-04 | AC-05-AC-06, AC-13, AC-15, AC-19 | CT-F17-04, CT-F17-09 |
| FR-05 | AC-07-AC-10, AC-12-AC-13, AC-19 | CT-F17-05, CT-F17-06, CT-F17-07 |
| FR-06 | AC-08-AC-11, AC-17, AC-19 | CT-F17-06, CT-F17-07, CT-F17-10 |
| FR-07 | AC-05-AC-06, AC-09-AC-13, AC-16-AC-21 | CT-F17-04, CT-F17-06, CT-F17-08, CT-F17-09 |
| FR-08 | AC-07, AC-12, AC-14-AC-16, AC-20-AC-21 | CT-F17-05, CT-F17-08, CT-F17-10 |
| FR-09 | AC-15-AC-18, AC-20 | CT-F17-08, CT-F17-09 |
| FR-10 | AC-02, AC-03, AC-07, AC-12, AC-15, AC-19, AC-21 | CT-F17-03, CT-F17-05, CT-F17-10 |
| NFR-01-NFR-08 | AC-01-AC-21 | CT-F17-01-CT-F17-10 |
| INV-01-INV-10 | AC-02-AC-03, AC-05-AC-21 | CT-F17-02, CT-F17-03, CT-F17-05, CT-F17-06, CT-F17-08, CT-F17-10 |

## Named Contract-Test Criteria

- **CT-F17-01:** Operation/segment/turn schema and transition fixtures cover supported task modes, parent/segment identity, immutable snapshot references, active-segment uniqueness, and invalid terminal/cross-operation transitions.
- **CT-F17-02:** Budget fixtures cover omitted/default 3, values 1 and 10, below/above bounds, per-operation override, reservation/release, one-unit consumption, no remaining budget, and read-only zero-charge behavior.
- **CT-F17-03:** Persist-before-F15 and replay fixtures prove that no provider call occurs before durable intent, duplicate turn identities do not start a second call, mismatched results fail closed, and known pre-start versus uncertain-start outcomes are distinct.
- **CT-F17-04:** Timeout/cancellation/lifecycle fixtures cover default and boundary timeouts, abort propagation, user cancellation, provider timeout/failure, renderer closure no-op, shutdown, restart, uncertain termination, one terminal outcome, and no automatic replacement.
- **CT-F17-05:** Turn-report fixtures cover model-reported versus deterministic sections, actual F13 files/commands, F14 results, all usage counters/unavailable values, safe bounded details, cumulative usage, activity correlation, and restart readback.
- **CT-F17-06:** Progress fixtures cover canonical evidence, deterministic fingerprints, same-input repeatability, material versus unrelated churn, prior repeated state, and two consecutive no-progress stops.
- **CT-F17-07:** Predicate fixtures cover proposal event accounting/unchanged worktree, implementation human decisions/validation, conflict no-unmerged-paths/validation, invalid evidence, provider-claim rejection, and valid all-`pushback`/`question`/`no_change` completion.
- **CT-F17-08:** Continuation fixtures cover complete-history presentation data, displayed-history revision, explicit Continue AI Work/Retry Resolution, remaining-budget segments, exhausted-budget new parent operations, cumulative usage, new snapshots, duplicate/stale authorization, and no silent policy broadening.
- **CT-F17-09:** Fault-injection fixtures cover persistence failure before/after each intent/result/report commit, renderer destruction, process restart, uncertain provider and inspection outcomes, idempotent reconciliation, and no budget reset or duplicate provider invocation.
- **CT-F17-10:** Boundary/security/conformance fixtures cover F15-only provider invocation, F13/F14 authority, no publication capability, no credential/SDK/raw-output leakage, bounded read models, accessible semantic status, and shared Review/Conflict/Conversation consumer behavior.
