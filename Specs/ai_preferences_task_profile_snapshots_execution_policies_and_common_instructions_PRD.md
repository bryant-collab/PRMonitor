# F16 - AI Preferences, Task-Profile Snapshots, Execution Policies, and Common Instructions - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F03 - SQLite persistence, migrations, and transactional repositories | Provides durable settings, revision history, immutable configuration snapshots, optimistic-concurrency outcomes, and commit-before-effect transactions. |
| 2 | F04 - Persistent Electron shell, IPC boundary, and Windows virtual-desktop spike | Provides the main-process authority, validated settings IPC, renderer lifecycle behavior, accessible desktop-shell integration, and the declared IPC payload bounds consumed by F16. |
| 3 | F15 - Provider-neutral AI contracts and Codex adapter | Provides supported task types, provider capability descriptions, normalized policy/profile inputs, and the fail-closed provider boundary. F16 never imports or invokes a provider SDK. |
| 4 | F00 - Deterministic validation configuration contract | Provides the versioned Build & Validation profile, source precedence, trust/authorization state, phase tags, safe distinction between human guidance and executable commands, and the explicit v1 schema limits consumed by F16. |
| 5 | F13 - Operation-owned Git worktrees and change attribution | Provides validation of the application-level isolated-worktree root, its declared canonical path bounds, and the operation-owned root/reference consumed by AI work. |
| 6 | F12 - Review batching, scheduler, Check Now, and global pause | Provides the typed polling/quiet-period configuration and owns timer, batching, pause, and restart semantics. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F17 - Bounded AI Work Controller and deterministic progress evaluation | Uses the resolved task profile, execution policy, maximum-turn preference, and immutable segment snapshots while owning budgets, timeouts, continuation, and progress decisions. |
| 2 | F18/F21 - Review preparation and revisions | Uses the Automatic Review / Re-evaluation, Review Revision, and Read-only Conversation profiles, Common Instructions, Build & Validation snapshots, and PR Intent / Context snapshots. |
| 3 | F19/F20 - Notifications and Review Bundle workspace | Presents effective AI configuration, policy summaries, worktree-root outcomes, and reproducibility metadata to the developer. |
| 4 | F24-F27 - Managed PR branch synchronization | Uses the Merge Conflict Resolution profile, policy snapshot, Common Instructions, repository validation context, and bounded-work settings when AI is required. |
| 5 | F28-F30 - Recovery, security, and release readiness | Reconcile revisioned settings and in-flight immutable snapshots, harden the boundary, and verify packaged Windows behavior. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-32 | FR-04.1-FR-04.4, FR-08.1-FR-08.2 | AC-11-AC-13, AC-18-AC-21 | Primary: F16 owns Common Instruction profile settings and selection; F03 owns durable storage and F04 owns IPC/lifecycle. |
| APP-AC-33 | FR-04.3-FR-04.4, FR-06.2-FR-06.4 | AC-12, AC-16-AC-17 | Primary resolution boundary: F16 supplies effective instructions to every applicable task; downstream features own task invocation and conversation workflow. |
| APP-AC-34 | FR-04.1, FR-08.2 | AC-11, AC-13, AC-18 | Primary: Common Instructions are application settings and are never copied into mutable PR or ticket configuration. |
| APP-AC-35 | FR-04.4, FR-06.1-FR-06.4 | AC-13, AC-16 | Shared: F16 snapshots the effective text and profile revisions; F03 persists them and F18 presents them. |
| APP-AC-36 | FR-04.4, FR-06.4, FR-08.2 | AC-13, AC-17-AC-19 | Shared: F16 guarantees future-only settings semantics; downstream results retain the already-created snapshot. |
| APP-AC-37 | FR-07.2, FR-08.1 | AC-09 | Shared: F16 owns the preference surface and future-only setting; F13 owns canonicalization, safety validation, and operation-path use. |
| APP-AC-41 | FR-05.4, FR-06.1 | AC-16 | Shared: F16 includes the caller-provided PR Intent / Context in an immutable evaluation snapshot; F07 owns the editable PR field and F18 owns review preparation. |
| APP-AC-42 | FR-06.4, FR-08.2 | AC-17-AC-19 | Shared: F16 freezes the context used by a task; F07/F18 retain the original bundle history and expose re-evaluation as a new snapshot. |
| APP-AC-54 | FR-07.1, FR-08.1 | AC-08, AC-18-AC-19 | Shared: F16 validates the 1-10 preference with default 3; F17 persists consumption and enforces the hard maximum across operations. |
| APP-AC-59 | FR-01.1-FR-02.3 | AC-01-AC-03 | Primary: F16 exposes four independent task-profile settings and validates provider/model/reasoning compatibility through F15 capabilities. |
| APP-AC-60 | FR-02.1-FR-02.4, FR-06.1-FR-06.3 | AC-03-AC-04, AC-16 | Shared: F16 resolves and labels the declared task profile/revision; F15 passes it through the provider adapter and downstream features own invocation. |
| APP-AC-61 | FR-03.2-FR-03.4, FR-06.2-FR-06.4, FR-07.1 | AC-06-AC-08, AC-16-AC-17 | Shared: F16 resolves immutable profile/policy snapshots; F17/F03 own segment lifecycle, persistence, and continuation authorization. |
| APP-AC-62 | FR-03.1-FR-03.4, FR-06.1-FR-06.4 | AC-05-AC-07, AC-16 | Shared: F16 supplies user-readable task/profile/policy metadata; F20/F27 own result presentation. |
| APP-AC-64 | FR-01.3, FR-03.3, FR-06.1-FR-06.4 | AC-07, AC-16, AC-18 | Shared: F16 defines the immutable configuration handoff; F03 persists it and F15/F17 add provider-neutral execution/usage records. |
| APP-AC-70 | FR-03.1-FR-03.4, FR-08.3 | AC-05-AC-08, AC-20 | Primary policy-resolution boundary: F16 owns named presets, defaults, task floors, and no-broadening decisions; F15 translates/rejects them and F29 hardens the boundary. |
| APP-AC-71 | FR-03.2, FR-06.2 | AC-06, AC-16 | Shared: F16 applies the read-only floor; F15 enforces provider admission and F18 owns proposal-before-mutation workflow. |
| APP-AC-74 | FR-05.1-FR-05.5, INV-07 | AC-14-AC-16 | Shared: F00 owns command trust/execution semantics; F16 owns repository settings, human-readable guidance, and snapshots; F18/F20 consume the result. |

F16 does not claim provider SDK execution (F15), AI turn budgets or progress (F17),
SQLite migration mechanics (F03), worktree creation or path ownership (F13),
polling/batching/timer behavior (F12), validation process execution (F14),
Review Bundle item decisions or publication (F18-F23), or merge publication
(F24-F27). Those features consume the F16 contracts described here.

## Executive Summary

PRMonitor needs a predictable way to decide which AI configuration applies to a
piece of work. Without a dedicated Preferences and resolution boundary, one
workflow could silently use a different provider or model from another, a
change to settings could alter an in-flight review, free-form build guidance
could accidentally become executable, and an AI provider could receive a
broader execution policy than the developer selected.

F16 provides the application Preferences experience and the deterministic
resolver behind it. The developer configures an independent profile for each
supported AI task, chooses a named execution-policy preset, sets bounded
operational preferences, maintains reusable Common Instruction profiles, and
stores repository-specific Build & Validation Instructions. Before any AI
task starts, F16 resolves the declared task type and creates an immutable,
provider-neutral snapshot of the effective profile, policy, instructions,
repository validation context, and applicable PR Intent / Context. Later
changes affect only future work. Read-only task floors and capability checks
are applied before F15 is called, while F15 remains responsible for provider
translation and final adapter admission.

F16 is a configuration and snapshot feature, not an AI execution feature. It
does not import a provider SDK, run a validation command, create a worktree,
schedule a poll, or publish anything.

## User Stories

### Configure each kind of AI work independently

- **US-01:** **GIVEN** the developer opens Preferences, **WHEN** the AI Task Profiles area is shown, **THEN** it presents independent rows for Automatic Review / Re-evaluation, Review Revision, Read-only Conversation, and Merge Conflict Resolution with the effective provider, model, reasoning effort when supported, and profile revision.
  - **Acceptance Criteria:** AC-01-AC-04.
- **US-02:** **GIVEN** the developer edits a task profile, **WHEN** the values are saved, **THEN** compatibility is checked, the revision is advanced, the effective values are visible, and an invalid or unsupported combination cannot start provider work.
  - **Acceptance Criteria:** AC-02-AC-04, AC-19.

### Choose a safe execution policy

- **US-03:** **GIVEN** the developer chooses an execution policy, **WHEN** the policy is applied to a task, **THEN** the effective sandbox, approval behavior, network setting, writable-root scope, and controlled-environment summary are visible and task-specific read-only floors are enforced.
  - **Acceptance Criteria:** AC-05-AC-08, AC-20.
- **US-04:** **GIVEN** a direct SDK adapter cannot support a selected policy such as interactive approval callbacks, **WHEN** the developer tries to use it, **THEN** PRMonitor explains the incompatibility and refuses to start work without switching modes or choosing a supported adapter.
  - **Acceptance Criteria:** AC-06-AC-08, AC-20.

### Reuse team and repository guidance without granting hidden authority

- **US-05:** **GIVEN** the developer maintains Common Instruction profiles, **WHEN** a profile is enabled and selected, **THEN** its bounded text is applied in deterministic order to relevant AI tasks and remains application-level configuration rather than PR or ticket data.
  - **Acceptance Criteria:** AC-11-AC-13.
- **US-06:** **GIVEN** a managed repository has human-readable build guidance and an F00 validation profile, **WHEN** the repository settings are resolved, **THEN** the guidance is shown separately from executable commands, F00 trust/precedence is preserved, and free-form text cannot authorize a command.
  - **Acceptance Criteria:** AC-14-AC-16.

### Make every AI task reproducible

- **US-07:** **GIVEN** a downstream workflow declares a supported task type, **WHEN** work is about to start, **THEN** F16 resolves exactly that task type and snapshots the profile, policy, Common Instructions, repository validation context, and applicable PR Intent / Context before the external effect.
  - **Acceptance Criteria:** AC-04, AC-07, AC-16.
- **US-08:** **GIVEN** Preferences change while work is running or after a result is complete, **WHEN** the developer inspects or explicitly continues/re-evaluates the work, **THEN** the existing snapshot remains unchanged and only the explicitly authorized new segment or re-evaluation may use the newer settings.
  - **Acceptance Criteria:** AC-17-AC-19.

### Keep operational settings bounded and durable

- **US-09:** **GIVEN** the developer sets the maximum AI work turns, isolated-worktree root, polling interval, or quiet period, **WHEN** the setting is saved, **THEN** bounds and ownership are validated, the effective revision is durable, and downstream F12/F13/F17 consumers receive typed values rather than renderer state.
  - **Acceptance Criteria:** AC-08-AC-10, AC-18-AC-19.
- **US-10:** **GIVEN** the renderer closes, a write races with another writer, or the application restarts, **WHEN** Preferences are read or saved again, **THEN** committed settings remain available, stale writes are rejected without overwriting newer history, and no provider or external command starts from an uncommitted change.
  - **Acceptance Criteria:** AC-18-AC-22.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** the Preferences screen is opened with a current settings record, **WHEN** the AI Task Profiles area renders, **THEN** it shows exactly the four MVP task types—Automatic Review / Re-evaluation, Review Revision, Read-only Conversation, and Merge Conflict Resolution—with the effective provider, model, supported reasoning effort when present, provider-option summary, and profile revision for each row.
- **AC-02:** **GIVEN** a provider/model/reasoning combination is supported by the F15 capability contract, **WHEN** the developer saves it for one task type, **THEN** the setting is accepted, a new monotonically increasing profile revision is created, the prior revision remains immutable, and no other task type changes.
- **AC-03:** **GIVEN** a known provider/model/reasoning/provider-option combination is unsupported, **WHEN** the developer validates or saves it, **THEN** Preferences identifies the exact unsupported field and permitted next action; if a provider has no model catalog, a bounded text model ID may be saved as unverified, but any invocation is blocked by preflight before a provider process starts until F15 capability admission succeeds.
- **AC-04:** **GIVEN** a caller requests AI work, **WHEN** it omits a supported declared task type, supplies an unknown task type, or attempts to select a profile from another task type, **THEN** F16 returns a typed configuration error and does not infer a task from prompt text, provider thread state, or UI route.
- **AC-05:** **GIVEN** the developer opens execution-policy Preferences, **WHEN** the available choices are displayed, **THEN** the named presets and summaries are visible: Read-only, Autonomous Worktree, Autonomous Worktree with Network, Interactive Approvals, and Full Access; Autonomous Worktree is the default for worktree-mutating work and no preset grants publication authority.
- **AC-06:** **GIVEN** the task is Review Proposal or Read-only Conversation, **WHEN** F16 resolves its effective policy, **THEN** the result is at least Read-only regardless of the broader configured default; accepted implementation, revision, and conflict-resolution work defaults to Autonomous Worktree unless the developer explicitly selects another supported policy.
- **AC-07:** **GIVEN** an AI Work Operation segment or read-only conversation turn is about to start, **WHEN** F16 resolves the effective settings, **THEN** the snapshot contains the selected preset revision, sandbox/boundary, approval behavior, network setting, operation-owned writable-root scope, controlled-environment rules, and task safety floor, and later Preferences edits cannot mutate that snapshot.
- **AC-08:** **GIVEN** the direct MVP adapter does not support an interactive approval callback or another requested policy capability, **WHEN** the policy is resolved for an invocation, **THEN** F16 marks it unsupported and F15 rejects it before provider start; no silent downgrade, prompt, sandbox broadening, network broadening, or publication credential is introduced. The maximum AI Work Turns preference accepts only 1 through 10, defaults to 3, and cannot exceed the hard maximum of 10.
- **AC-09:** **GIVEN** the developer changes the isolated-worktree root, **WHEN** the setting is validated, **THEN** F13 receives the candidate for canonical path validation; an invalid, inaccessible, or unsafe root is rejected without file mutation, a valid effective root is revisioned, and active operation worktrees keep their recorded paths while future operations use the new setting.
- **AC-10:** **GIVEN** the developer edits polling or quiet-period Preferences, **WHEN** the values are saved, **THEN** the typed scheduler contract receives a default of 10 minutes when unset and accepts only the existing one-minute-through-24-hour bounds; F16 does not create timers or alter already-snapshotted batch deadlines.
- **AC-11:** **GIVEN** the developer creates, edits, enables, disables, or deletes a Common Instruction profile, **WHEN** the change is valid and saved, **THEN** the application stores a bounded human-readable name, instruction text, enabled state, profile revision, and safe selection metadata in application settings with no PR or ticket ownership.
- **AC-12:** **GIVEN** multiple Common Instruction profiles are enabled and selected, **WHEN** an applicable AI task is resolved, **THEN** F16 includes each selected profile exactly once in the recorded order, excludes disabled/unselected profiles, applies the same effective set to follow-up turns and re-evaluations that use that snapshot, and exposes the effective names/revisions to downstream presentation.
- **AC-13:** **GIVEN** a Common Instruction profile is edited after a Review Bundle or AI segment snapshot exists, **WHEN** the old result is reopened, **THEN** its effective text, profile IDs, and revisions remain the original values; the edited profile affects only a future task or an explicitly started re-evaluation/new continuation.
- **AC-14:** **GIVEN** the developer edits Build & Validation Instructions for a managed repository, **WHEN** the settings are shown, **THEN** the repository identity is explicit, human-readable guidance is visibly separate from structured phase-tagged F00 commands/manual checks, and the settings never contain provider credentials, arbitrary environment values, or shell command strings.
- **AC-15:** **GIVEN** repository validation configuration is selected for an AI task, **WHEN** F16 resolves it, **THEN** it delegates source precedence, schema validation, trust/authorization, normalization, and content hashing to F00; a free-form Build & Validation Instruction can be included as AI context but cannot make a command executable, and no untrusted/invalid profile is presented as authorized.
- **AC-16:** **GIVEN** a supported task has a repository and optional PR Intent / Context, **WHEN** the owning workflow requests an effective snapshot, **THEN** F16 returns one immutable provider-neutral record containing the declared task type, profile and revision, policy and revision, ordered Common Instruction snapshots, effective Build & Validation snapshot or F00-owned immutable reference with bounded summary, applicable PR Intent / Context snapshot, source/hash/trust metadata, and `boundsRevision` needed for reproducibility; the record contains no SDK object, credential, or uncontrolled environment value.
- **AC-17:** **GIVEN** a profile, policy, Common Instruction, Build & Validation setting, or PR Intent / Context is edited after a snapshot exists, **WHEN** a running operation, completed bundle, or old conversation is read, **THEN** it continues to use and display the original snapshot; only an explicit continuation or re-evaluation may request a new snapshot using current Preferences.
- **AC-18:** **GIVEN** a settings transaction commits before the renderer closes or the process restarts, **WHEN** a new main-process instance reads Preferences, **THEN** the current values, immutable revisions, active selections, operational settings, and effective root reference round-trip; renderer destruction does not cancel or roll back a committed write.
- **AC-19:** **GIVEN** two writers use the same expected settings revision, or a process/persistence failure occurs before commit, **WHEN** both writes complete, **THEN** exactly one valid revision is committed, the losing/stopped write returns a typed conflict or failure, no partial settings change is visible, and retry requires a fresh read rather than overwriting history.
- **AC-20:** **GIVEN** settings or snapshot data crosses the F04 IPC boundary or enters a provider request, **WHEN** it is validated, **THEN** arbitrary paths, raw credentials, provider SDK objects, uncontrolled environment values, secret-shaped credential material, oversized fields, and publication capabilities are rejected or excluded; F16 itself imports no provider SDK and exposes no GitHub mutation method.
- **AC-21:** **GIVEN** a keyboard user or a user with forced-colors/high-contrast settings opens Preferences, **WHEN** they navigate, edit, validate, and save a setting, **THEN** every task/profile/policy/instruction control has a programmatic label, errors are associated with the relevant field, focus moves to actionable validation feedback, and all actions are reachable without a pointer.
- **AC-22:** **GIVEN** the same validated persisted inputs, capability descriptor, repository context, and clock-independent resolution request are evaluated twice, **WHEN** F16 produces the result, **THEN** the effective snapshot and reason are equivalent and no AI provider, Git, validation process, GitHub service, or publication effect is invoked.
- **AC-23:** **GIVEN** an F16-owned field or collection is below, exactly at, or above its declared F16-B01-F16-B08 limit, **WHEN** the value crosses schema validation, persistence, IPC, or snapshot construction, **THEN** values within the effective F16/delegated limit are accepted, over-limit values are rejected with a stable bounded reason before persistence/provider start/prompt construction, delegated F00/F04/F13/F15 bounds are required and versioned, and no value or diagnostic is silently truncated.

## Functional Requirements

### FR-01: Independent AI task-profile preferences

- FR-01.1: Preferences SHALL expose exactly four independent MVP task profiles: `AUTOMATIC_REVIEW_REEVALUATION`, `REVIEW_REVISION`, `READ_ONLY_CONVERSATION`, and `MERGE_CONFLICT_RESOLUTION`.
- FR-01.2: Each task profile SHALL contain a provider identifier, model identifier, optional provider-supported reasoning-effort value, bounded provider-specific options, enabled/availability state, and a monotonic profile revision; provider-specific options SHALL remain opaque to consumers outside the F15 adapter contract.
- FR-01.3: The Preferences UI SHALL show effective values and validation state before save and SHALL never silently replace a configured provider, model, reasoning effort, or provider option with a local default.
- FR-01.4: A successful profile edit SHALL create a new immutable revision for only the selected task type; a prior revision used by an existing operation or result SHALL remain readable.
- FR-01.5: A missing, disabled, unverified, or invalid profile SHALL produce a typed unavailable configuration result with a user-readable remediation path rather than an implicit provider choice.

### FR-02: Capability and compatibility validation

- FR-02.1: F16 SHALL validate provider/model/reasoning/provider-option compatibility through F15's provider-neutral capability contract and SHALL not import or inspect a provider SDK.
- FR-02.2: Known incompatible settings SHALL be rejected or marked unusable before they can be selected for work; a provider without a model catalog MAY accept a bounded model identifier as unverified, but invocation admission SHALL remain fail-closed until F15 accepts it.
- FR-02.3: F16 SHALL preserve the provider/model/reasoning/options chosen by the developer and SHALL not silently lower reasoning, switch models/providers, omit options, or broaden capabilities to make a request work.
- FR-02.4: Every AI-capable caller SHALL supply one declared task type to the resolver; task type SHALL not be inferred from prompt content, UI navigation, or provider conversation state.

### FR-03: Named AI Execution Policy preferences and safety floors

- FR-03.1: Preferences SHALL expose named `Read-only`, `Autonomous Worktree`, `Autonomous Worktree with Network`, `Interactive Approvals`, and `Full Access` policy presets with user-readable summaries of sandbox/boundary, approval behavior, network access, writable-root scope, and controlled-environment behavior.
- FR-03.2: The default policy for worktree-mutating implementation, revision, and conflict-resolution work SHALL be `Autonomous Worktree`; `REVIEW_PROPOSAL` and `READ_ONLY_CONVERSATION` SHALL always apply a Read-only floor.
- FR-03.3: F16 SHALL resolve a policy snapshot with a stable preset/revision and effective task floor; a provider, model, response, or renderer request SHALL not be able to broaden that snapshot.
- FR-03.4: If the selected provider adapter cannot enforce an interactive approval channel, network mode, writable-root boundary, or other requested capability, F16 SHALL expose the unsupported status and F15 SHALL reject the invocation before provider start. No policy fallback, prompt, or credential escalation is permitted.
- FR-03.5: Execution policy SHALL never grant commit, push, GitHub response, review approval, merge, force-push, or publication authority, and F16 SHALL not store or pass GitHub credentials.

### FR-04: Common Instruction profiles

- FR-04.1: The application SHALL allow the developer to create, edit, enable, disable, select, order, and remove bounded reusable Common Instruction profiles in application settings.
- FR-04.2: A Common Instruction profile SHALL contain a human-readable name, instruction text, enabled state, stable profile identity, and immutable revision history; the source of truth SHALL be application settings rather than PR, ticket, repository-branch, or Review Bundle mutable fields.
- FR-04.3: F16 SHALL resolve the enabled and selected profiles in deterministic order and SHALL include the effective set in every applicable new AI task, follow-up turn, and re-evaluation snapshot.
- FR-04.4: Common Instructions SHALL be treated as guidance/context for semantic reasoning and SHALL not override PRMonitor system rules, safety floors, deterministic evidence, repository-native instructions, security controls, or human publication approval.

### FR-05: Repository Build & Validation settings

- FR-05.1: F16 SHALL provide a repository-scoped settings surface for human-readable Build & Validation Instructions and SHALL key the setting to the explicit provider/server and repository identity supplied by F06/F07.
- FR-05.2: F16 SHALL present human-readable guidance separately from the structured validation profile, command/manual-check steps, phases, trust state, and source metadata supplied by F00.
- FR-05.3: F16 SHALL use F00's source precedence, schema/version validation, normalization, content hashing, explicit trust/authorization, and no-safe-profile outcomes rather than merging or reimplementing them.
- FR-05.4: F16 SHALL include the effective repository instructions and F00 profile/trust/hash/source snapshot in applicable AI context, including follow-up work and re-evaluation, when the owning workflow supplies that repository.
- FR-05.5: Human-readable instructions SHALL never grant execution authority, supply credentials, define an uncontrolled environment, or turn a free-form shell string into an executable validation command.

### FR-06: Effective task routing and immutable snapshots

- FR-06.1: Before an owning workflow starts a provider turn or relies on the result, F16 SHALL resolve one `EffectiveAITaskSnapshot` containing the declared task type, profile revision, policy revision, ordered Common Instruction revisions/text, effective Build & Validation snapshot or F00-owned immutable reference with bounded summary, applicable PR Intent / Context snapshot, bounded source/hash/trust metadata, and the F16 bounds revision.
- FR-06.2: The snapshot SHALL include the effective task profile and policy values required by F15, including provider, model, reasoning effort when supported, provider options, policy preset, sandbox/approval/network/writable-root/environment rules, and task safety floor.
- FR-06.3: F16 SHALL provide the same resolution boundary for Automatic Review / Re-evaluation, Review Revision, Read-only Conversation, and Merge Conflict Resolution; downstream services SHALL not construct ad hoc provider/model/policy settings.
- FR-06.4: Once returned for an AI Work Operation segment or read-only conversation turn, a snapshot SHALL be immutable. An explicit human continuation or re-evaluation MAY create a new segment snapshot from current Preferences, but it SHALL not rewrite earlier evidence.
- FR-06.5: F16 SHALL return only provider-neutral, bounded, serializable values and opaque references. F03/F17 may persist the snapshot; F15 may translate it; neither may receive mutable settings lookups or SDK instances.

### FR-07: Bounded operational preferences and downstream configuration

- FR-07.1: Preferences SHALL expose Maximum AI Work Turns per Operation with valid values 1 through 10, default 3, and a hard maximum of 10; F17 SHALL enforce consumed-count and continuation semantics.
- FR-07.2: Preferences SHALL expose the application-level isolated-worktree root and SHALL send candidate values through F13's canonical path/safety contract; F16 SHALL persist the validated future-operation setting but SHALL not create, move, or delete worktrees.
- FR-07.3: Preferences SHALL expose polling and quiet-period values through F12's typed scheduler configuration contract, with a default of 10 minutes and the established one-minute-through-24-hour bounds; F16 SHALL not own timers, batching, or pause behavior.
- FR-07.4: Changes to operational preferences SHALL be revisioned and SHALL affect only future scheduling slots, worktree operations, or AI segments unless a downstream feature explicitly defines a new snapshot/re-evaluation.

### FR-08: Main-process settings authority and safe lifecycle behavior

- FR-08.1: The Electron main process and F03 repositories SHALL own settings, revisions, effective selections, and snapshots; the renderer SHALL access them only through F04's validated IPC contract.
- FR-08.2: Settings writes SHALL use expected-revision/concurrency checks, persist intent and the complete new value atomically, and return a typed conflict or failure without exposing partial state when a write cannot commit.
- FR-08.3: F16 SHALL expose no provider SDK, GitHub mutation, commit, push, response, merge, publication, arbitrary process, or arbitrary filesystem capability through settings or snapshot APIs.
- FR-08.4: A renderer close, renderer replacement, or ordinary process restart SHALL not cancel a committed settings write or mutate an already-created effective snapshot.

## F16 Bounds Contract

The following limits are part of the F16 versioned schema contract. Text limits
for identifiers and names count Unicode scalar values after normalization;
instruction and diagnostic text limits count UTF-8 bytes after normalization;
JSON limits count the serialized UTF-8 representation. Array and object limits
are checked after schema validation. F16 exposes a `boundsRevision` in every
effective snapshot so a later limit change cannot silently change existing work.

| Bound ID | F16-owned value | Maximum | Enforcement and over-limit behavior |
|---|---|---:|---|
| F16-B01 | Provider identifier / model identifier / reasoning-effort identifier | 128 / 256 / 64 Unicode scalar values | F16 schema validation; reject with `F16_INPUT_LIMIT_EXCEEDED` before capability lookup or persistence. |
| F16-B02 | Provider-specific options envelope | 16 KiB serialized UTF-8; object depth 8; 64 keys per object; 128 items per array | F16 applies the generic cap; F15 may lower provider-specific limits. Reject rather than trim, flatten, or pass an unbounded envelope. |
| F16-B03 | Common Instruction profile name / instruction text | 128 Unicode scalar values / 32 KiB UTF-8 | F16 profile schema and IPC validation; reject before save or prompt snapshot. |
| F16-B04 | Common Instruction profile collection / selected profile collection / aggregate selected text | 32 stored profiles / 8 selected / 128 KiB UTF-8 | F16 selection and snapshot builder; reject the write or snapshot and preserve the prior committed state. |
| F16-B05 | Repository human-readable Build & Validation Instructions | 16,384 characters under the F00 v1 `buildInstructions` rule | F16 uses the F00 v1 bound. Structured commands, arguments, working directories, steps, timeouts, and output remain under the exact F00 v1 schema; F16 rejects an F00 result without a versioned bound. |
| F16-B06 | User-supplied isolated-worktree root path before F13 canonicalization | 32,767 UTF-16 code units on Windows | F16 rejects a larger transport value; F13 performs canonicalization, containment, accessibility, and stricter platform checks. F16 never stores or uses the raw path as operation authority. |
| F16-B07 | F16-safe diagnostic detail / field-error collection / field path | 4 KiB UTF-8 / 32 errors / 256 Unicode scalar values | F16 retains only bounded safe details. An oversized upstream diagnostic becomes a generic bounded reason and is not persisted, logged, or sent to the renderer. |
| F16-B08 | Serialized `EffectiveAITaskSnapshot` envelope | 512 KiB UTF-8, with complete F00 profile bytes retained by F00 and referenced by immutable ID/hash | Reject with `F16_SNAPSHOT_LIMIT_EXCEEDED`; never truncate. F04 IPC and F15 request maximums must be explicit; F16 assumes no larger delegated limit. |

F16 owns F16-B01-F16-B04 and F16-B07-F16-B08. F00 owns the structured
profile limits referenced by F16-B05; F13 owns the canonical path after
F16-B06; F04 owns the IPC envelope; and F15 owns provider-specific limits
after F16-B02. Each delegated contract SHALL publish a bound and schema
revision. A valid lower delegated bound becomes the effective lower limit;
missing or ambiguous metadata, or a delegated contract that cannot enforce its
published bound, is a typed refusal (`F16_DELEGATED_BOUND_UNAVAILABLE`), never
permission to proceed.

## Non-Functional Requirements

- **NFR-01: Determinism** - Given the same persisted settings, capability descriptor, F00/F13/F12 results, repository identity, and task inputs, F16 SHALL produce equivalent validation outcomes, effective selections, snapshots, and safe reasons without AI judgment.
- **NFR-02: Durability and reproducibility** - Committed settings and immutable revisions SHALL survive renderer closure and process restart; a snapshot used by downstream work SHALL remain inspectable even after its source setting changes.
- **NFR-03: Security and privacy** - Settings, IPC DTOs, snapshots, diagnostics, and AI context preparation SHALL exclude credentials, authorization headers, provider SDK objects, uncontrolled environment values, arbitrary commands, and publication authority.
- **NFR-04: Least privilege** - Task floors, operation-owned writable roots, provider capability admission, and F00 command trust SHALL remain separate controls; no one user-editable field may broaden another boundary.
- **NFR-05: Bounded data** - F16-owned names, instruction text, provider-option envelopes, collections, diagnostics, and effective snapshots SHALL obey the exact F16-B01-F16-B08 limits. Delegated F00/F04/F13/F15 values SHALL be accepted only through an explicit versioned bound. Every over-limit or unavailable-bound result SHALL fail closed before persistence, IPC delivery, provider start, or prompt construction; no authoritative value or diagnostic SHALL be silently truncated.
- **NFR-06: Extensibility** - Adding a provider adapter or a new versioned profile/policy representation SHALL use provider-neutral capability and snapshot contracts without changing deterministic monitoring, Git, validation, review-bundle, or publication services.
- **NFR-07: Windows usability and accessibility** - The Preferences surface SHALL work in the supported Windows Electron shell, including keyboard navigation, focus/error recovery, and forced-colors/high-contrast presentation.
- **NFR-08: Testability** - Deep resolvers SHALL accept injected persistence, capability, F00, F12, F13, clock, path, and IPC seams so tests use deterministic fixtures without provider credentials, network, GitHub, AI, Git, worktree, or validation side effects.

## Invariants

- **INV-01:** The main process and F03 are authoritative for Preferences and snapshots; renderer memory is never the source of effective AI configuration.
- **INV-02:** A task/profile/policy/Common Instruction/Build & Validation/PR Intent snapshot used by work is immutable and retains the revision/hash/source information needed to reproduce it.
- **INV-03:** Every AI invocation is routed by one explicit supported task type and its corresponding profile; no service may infer or invent a profile.
- **INV-04:** Review Proposal and Read-only Conversation always use a read-only policy floor; an accepted implementation or conflict task never inherits a broader policy silently.
- **INV-05:** A provider, model, policy, AI response, renderer request, or Common Instruction cannot broaden execution, writable-root, network, credential, or publication authority.
- **INV-06:** Common Instructions are context/guidance only and cannot override PRMonitor system rules, deterministic evidence, repository trust controls, or human approval requirements.
- **INV-07:** Human-readable Build & Validation Instructions never grant command execution authority; only F00's valid, trusted structured profile can be executed by F14.
- **INV-08:** F16 never persists or exposes GitHub credentials, AI-provider secrets, raw authorization headers, SDK objects, uncontrolled environment values, or publication methods.
- **INV-09:** Preference edits are future-only: an existing AI segment, conversation turn, Review Bundle, or synchronization result retains its original effective snapshot until an explicit new segment/re-evaluation is authorized.
- **INV-10:** No external AI, GitHub, Git, validation, filesystem mutation, or publication effect may rely on a settings change before its complete revisioned record is durably committed.

## Out of Scope

- Provider SDK invocation, Codex thread management, provider authentication, streaming, structured-output validation, and provider-specific policy translation; F15 owns those behaviors.
- AI Work Operation budgets, turn timeouts, continuation authorization, progress evaluation, and `NEEDS_ATTENTION` reasons; F17 owns them.
- SQLite schema/migration implementation and generic transaction/repository mechanics; F03 owns them.
- Creating, moving, inspecting, cleaning, or deleting worktrees; F13 owns those behaviors.
- Poll timers, quiet-period debounce, Check Now, global pause, batching, and scheduler recovery; F12 owns those behaviors.
- Discovering validation commands from manifests or documentation, executing validation, or deciding whether validation passed; F00/F14 own those behaviors.
- Per-PR or per-ticket Common Instruction assignment, automatic semantic enforcement of Common Instructions, or automatic provider-generated settings.
- Automatic model discovery, provider account management, secret storage, or a user-created arbitrary execution-policy language.
- Review Bundle item decisions, diff presentation, notifications, synchronization result presentation, commits, pushes, GitHub responses, merges, or publication.

## Product Decisions

- **PD-01: Four independent task profiles** - Each supported semantic task has its own provider/model/reasoning/options so a developer can optimize review, implementation, conversation, and conflict resolution independently.
- **PD-02: No silent compatibility fallback** - A setting that cannot be proven compatible remains visibly unavailable or unverified and is blocked before provider start; PRMonitor never changes a model, provider, reasoning effort, or policy behind the developer's back.
- **PD-03: One application policy selection with task floors** - The developer selects a named application-level policy preset. Read-only tasks force the Read-only floor, while mutating tasks use the selected preset and default to Autonomous Worktree.
- **PD-04: Interactive policies are capability-gated** - Interactive Approvals is a visible named concept, but it is unavailable for the MVP direct SDK adapter unless the adapter advertises a real host approval channel.
- **PD-05: Common Instructions are ordered application settings** - Multiple enabled profiles may be selected and ordered; the ordered set is snapshotted for each task and never copied into mutable PR configuration.
- **PD-06: Guidance and executable validation remain separate** - Repository prose helps semantic reasoning, while F00's structured trusted profile alone can authorize commands.
- **PD-07: Settings are future-only** - Editing Preferences never rewrites work already in progress or completed. A continuation or re-evaluation is an explicit new snapshot boundary.
- **PD-08: Bounded operational defaults** - Maximum AI work turns defaults to 3 with a hard maximum of 10; polling and quiet periods default to 10 minutes and retain F12's one-minute-through-24-hour bounds.
- **PD-09: Root changes do not relocate work** - A new worktree root applies to future operations only; existing operation paths remain authoritative and inspectable.
- **PD-10: Bounds are part of configuration meaning** - F16-B01-F16-B08 and the `boundsRevision` are versioned contract data. Over-limit values are rejected rather than truncated, and delegated bounds must be explicit before a value crosses a downstream boundary.

## Implementation Decisions

- **IMP-01: Zod-first provider-neutral settings and snapshot contracts** - F16 schemas are serializable and versioned, with unknown-field rejection and bounded input limits before F03 persistence or IPC.
- **IMP-02: Capability queries use an F15 port** - F16 depends on provider-neutral capability descriptors and test doubles; only the F15 adapter imports `@openai/codex-sdk`.
- **IMP-03: Revisioned records are append-only at the feature boundary** - F16 requests F03 to persist current projections plus immutable revisions in one transaction and uses expected-revision writes for concurrent editors.
- **IMP-04: Policy resolution is a pure deterministic matrix** - A task type, task phase, selected preset, provider capability, and operation-worktree scope produce one effective policy or a typed refusal; no prompt or provider response participates.
- **IMP-05: F00 remains the validation authority** - F16 stores and displays repository guidance and saved F00 candidates, then consumes F00's resolved/trusted snapshot rather than copying precedence or trust logic.
- **IMP-06: Root and scheduler settings use existing typed ports** - F13 validates the root and F12 validates scheduler ranges/semantics; F16 owns the Preferences surface and revisioned handoff only.
- **IMP-07: Effective snapshots are created at the downstream intent boundary** - F17/F18/F21/F26 ask F16 for the complete snapshot after declaring their task and before F03 commits the external-effect intent; the snapshot is then persisted by the owning operation.
- **IMP-08: Provider authentication is outside Preferences** - F16 stores provider IDs and safe metadata only. Provider credentials remain behind F05/F15-approved runtime seams and never enter Common Instructions, options, IPC, or SQLite text fields.
- **IMP-09: User-readable policy summaries are derived from typed fields** - UI and downstream result surfaces render a stable summary from the effective snapshot rather than exposing provider flags as the product contract.
- **IMP-10: One versioned bounds module owns the F16 matrix** - Schema, persistence, IPC, and snapshot builders call the same bounds policy, record `boundsRevision`, and apply the minimum of F16's generic limit and each delegated contract's published limit.

## Testing Decisions

- **TST-01: Deep-test the pure resolver** - Cover profile compatibility, task routing, policy floors, Common Instruction ordering, F00/F12/F13 handoffs, snapshot hashes/revisions, and deterministic reasons through public contracts.
- **TST-02: Test durable intent at the F03 boundary** - Inject failures before and after settings/revision/snapshot commits, stale writers, renderer closure, restart, and duplicate requests; do not use activity text as state.
- **TST-03: Use fake capabilities, validation, scheduler, and path adapters** - F16 tests do not call a provider, read credentials, create a worktree, execute a command, contact GitHub, or invoke an AI model.
- **TST-04: Test the security boundary negatively** - Scan/fixture-test SDK imports, credentials, secret-shaped fields, arbitrary commands, uncontrolled environment values, raw paths, publication methods, and oversized input.
- **TST-05: Test UI semantics rather than pixels** - Verify labels, field/error associations, keyboard order, focus after validation failure, save/cancel/retry outcomes, and forced-colors behavior; detailed visual styling remains a UI-owner concern.
- **TST-06: Require downstream conformance fixtures** - Thin F15/F17/F18/F21/F26 consumers must use only the F16 resolver and snapshot types, with no ad hoc provider/model/policy construction.
- **TST-07: Exercise every limit boundary** - A reusable corpus covers below, exact, and above values for F16-B01-F16-B08, nested option depth/key/item limits, profile counts and aggregate text, snapshot size, missing/lower delegated bounds, stable refusal reasons, and proves no truncation, partial persistence, IPC delivery, provider start, or unbounded diagnostic.

## Proposed Modules

- **MOD-01: Preferences Repository Port** - Reads and transactionally writes current settings, immutable revisions, active selections, and expected-revision conflicts through F03.
- **MOD-02: AI Task Profile Resolver** - Validates declared task types and resolves provider/model/reasoning/options through F15 capability descriptors.
- **MOD-03: AI Execution Policy Resolver** - Applies named presets, task floors, operation-root scope, capability gating, and no-broadening rules.
- **MOD-04: Common Instruction Profile Service** - Owns profile CRUD, selection/order, enabled state, bounded text, revisions, and effective ordered snapshots.
- **MOD-05: Repository Build & Validation Settings Service** - Owns repository-keyed human guidance and delegates structured profile resolution/trust to F00.
- **MOD-06: Effective AI Context Snapshot Builder** - Combines task, policy, Common Instructions, Build & Validation, and caller-provided PR context into one immutable handoff.
- **MOD-07: Operational Preference Resolver** - Validates maximum turns and adapts worktree-root, polling, and quiet-period settings to F13/F12/F17 typed contracts.
- **MOD-08: Preferences IPC Controller** - Exposes read/write/validate/select operations through F04 schemas with safe errors and no privileged capability leakage.
- **MOD-09: F16 Bounds Policy** - Publishes F16-B01-F16-B08 and `boundsRevision`, validates shared limits, consumes delegated bound metadata, and returns stable fail-closed reasons without truncation.

## Workflows

### Workflow 1: Configure and save a task profile

```text
1. The renderer requests the current Preferences read model through validated IPC.
2. The developer edits one of the four task-profile rows.
3. F16 asks the F15 capability port to validate provider, model, reasoning, and options.
4. The UI shows compatibility, unavailable, or unverified state before save.
5. The main process submits the complete value with the expected settings revision.
6. F03 commits the current projection and immutable profile revision atomically.
7. The UI receives the committed revision or a typed stale-write/persistence error.
8. No provider process or other external effect starts as a result of saving Preferences.
```

### Workflow 2: Resolve an AI task before work starts

```text
1. The owning workflow declares one task type, repository identity, task phase,
   operation-owned worktree scope, and any PR Intent / Context.
2. F16 loads current settings and the applicable Common Instruction profiles.
3. F16 obtains the effective F00 Build & Validation result and F13/F12/F17
   typed configuration handoffs when applicable.
4. F16 resolves the task profile and policy, applies the task safety floor,
   and asks F15 whether the chosen capability is admissible.
5. F16 returns one immutable EffectiveAITaskSnapshot or a typed refusal.
6. The owning feature asks F03/F17 to persist the operation/segment intent and
   snapshot before calling F15 or another external effect.
7. F15 translates only the immutable snapshot; later Preference edits cannot
   change the in-flight task.
```

### Workflow 3: Configure repository Build & Validation context

```text
1. The developer selects an explicit managed repository.
2. The Preferences UI edits human-readable Build & Validation Instructions and,
   where desired, the F00 structured profile/settings entry.
3. F16 stores the repository-scoped setting without merging it with another
   repository or treating prose as executable authority.
4. Before a task, F16 asks F00 to resolve source precedence, schema validity,
   trust, authorization, phase tags, and normalized content hash.
5. The effective text plus F00 result is included in the immutable task snapshot.
6. F14 alone later executes authorized structured commands and records results.
```

### Workflow 4: Change Preferences while work is in progress

```text
1. F17/F18/F21/F26 has already persisted a task snapshot for an operation,
   segment, conversation turn, Review Bundle, or synchronization result.
2. The developer edits a profile, policy, Common Instruction, root, or repository
   validation setting and the new revision commits successfully.
3. The existing operation continues to reference its original snapshot.
4. An explicit continuation or re-evaluation requests a new snapshot and shows
   the changed profile/policy/instruction revisions before starting.
5. A restart reads both the current Preferences and the older immutable snapshot;
   neither is reconstructed from free-form activity text.
```

## Requirement Traceability

| Requirement family | Observable acceptance criteria | Named contract-test criteria |
|---|---|---|
| FR-01 | AC-01-AC-05, AC-18-AC-20, AC-23 | CT-F16-01, CT-F16-02, CT-F16-08, CT-F16-10 |
| FR-02 | AC-02-AC-04, AC-22 | CT-F16-01, CT-F16-02, CT-F16-09 |
| FR-03 | AC-05-AC-08, AC-16-AC-17, AC-20 | CT-F16-03, CT-F16-06, CT-F16-09 |
| FR-04 | AC-11-AC-13, AC-16-AC-18, AC-23 | CT-F16-04, CT-F16-06, CT-F16-08, CT-F16-10 |
| FR-05 | AC-14-AC-16, AC-20, AC-23 | CT-F16-05, CT-F16-06, CT-F16-09, CT-F16-10 |
| FR-06 | AC-04, AC-07, AC-12-AC-13, AC-16-AC-19, AC-22-AC-23 | CT-F16-06, CT-F16-09, CT-F16-10 |
| FR-07 | AC-08-AC-10, AC-17-AC-19 | CT-F16-07, CT-F16-08 |
| FR-08 | AC-18-AC-23 | CT-F16-08, CT-F16-09, CT-F16-10 |
| NFR-01-NFR-08 | AC-01-AC-23 | CT-F16-01-CT-F16-10 |
| INV-01-INV-10 | AC-04, AC-06-AC-10, AC-13, AC-15-AC-23 | CT-F16-03, CT-F16-05, CT-F16-06, CT-F16-08, CT-F16-09, CT-F16-10 |

## Named Contract-Test Criteria

- **CT-F16-01:** Task-profile CRUD, four-task routing, revision monotonicity, independent-row updates, expected-revision conflicts, unknown/disabled/unverified profile handling, and restart readback are covered without a provider call.
- **CT-F16-02:** A capability matrix covers supported, known-unsupported, unknown-catalog, unsupported-reasoning, unsupported-option, and duplicate/unknown provider cases; preflight rejection proves no adapter/provider process starts.
- **CT-F16-03:** The policy matrix covers all named presets, default Autonomous Worktree behavior, proposal/conversation read-only floors, network/writable-root/approval combinations, Full Access explicitness, and no-publication authority.
- **CT-F16-04:** Common Instruction fixtures cover create/edit/enable/disable/select/order/delete, duplicate selection prevention, bounded text, application-only storage, exact inclusion in new/follow-up/re-evaluation snapshots, and old-revision preservation.
- **CT-F16-05:** Build & Validation fixtures cover repository identity, human-text versus structured-command separation, F00 source precedence/trust/hash outcomes, untrusted AI suggestions, no-profile behavior, and rejection of free-form command authority.
- **CT-F16-06:** Effective snapshot fixtures cover each task type and phase, profile/policy/instruction/build/context revisions, exact input hashes, task floors, immutable serialization, changed-Preferences isolation, explicit continuation/re-evaluation, and provider-neutral F15/F17 handoff.
- **CT-F16-07:** Operational settings fixtures cover maximum-turn bounds/default/hard maximum, F13 root validation and future-only behavior, F12 polling/quiet defaults and bounds, and no timer/worktree side effect from a Preferences write.
- **CT-F16-08:** Boundary fixtures cover F04 IPC schemas, renderer closure/restart, stale writers, atomic failure, keyboard/focus/forced-colors semantics, F16-B01-F16-B08 oversized/secret-shaped inputs, path validation handoff, and absence of SDK/publication capabilities.
- **CT-F16-09:** Thin consumers for F15, F17, F18, F21, and F26 compile and run against only the F16 resolver/snapshot ports; a static scan proves no F16 provider SDK import or ad hoc profile/policy construction.
- **CT-F16-10:** A bounds corpus covers every F16-B01-F16-B08 below/exact/above case, nested option depth/key/item limits, profile count and aggregate-text limits, snapshot total, delegated-bound missing/lower outcomes, stable refusal reasons, and proves no truncation, partial persistence, IPC delivery, provider start, or unbounded diagnostic.
