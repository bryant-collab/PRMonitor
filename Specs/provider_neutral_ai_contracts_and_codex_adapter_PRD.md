# F15 - Provider-neutral AI Contracts and Codex Adapter - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F01 - Application workspace and engineering foundation | Provides the pinned Electron/Node workspace, source-boundary checks, test harness, and the pinned `@openai/codex-sdk@0.155.1` dependency. |
| 2 | F02 - Domain contracts and deterministic state machines | Provides provider-neutral IDs, safe result/reason data, proposal-before-mutation guards, and the distinction between application state and provider execution context. |
| 3 | F03 - SQLite persistence, migrations, and transactional repositories | Provides the durable handoff for provider-neutral operation/turn metadata, immutable profile/policy/input snapshots, usage, conversation references, and structured results. |
| 4 | F13 - Operation-owned Git worktrees and change attribution | Provides validated operation-worktree identity, path ownership, revision snapshots, actual-state inspection, and before/after change evidence. |
| 5 | F14 - Deterministic validation runner and result model | Provides truthful validation evidence that may be included in an AI request and returned to downstream progress evaluation; F15 never substitutes provider claims for validation results. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F16 - AI preferences, task-profile snapshots, execution policies, and Common Instructions | Resolves the user-configured task profile, execution policy, Common Instructions, and repository instructions that F15 validates and consumes as immutable snapshots. |
| 2 | F17 - Bounded AI Work Controller and deterministic progress evaluation | Owns operation/segment lifecycle, budgets, timeouts, progress classification, deterministic completion predicates, and the decision to continue; it asks F03 to persist turn evidence around F15 invocations. |
| 3 | F18/F21 - Review preparation and revisions | Supplies review inputs and final human decisions, then consumes the structured Review Proposal, Review Implementation, streaming, usage, and error contracts. |
| 4 | F20/F27 - Review and synchronization result presentation | Presents provider-neutral metadata, structured results, safe progress, and actionable errors without exposing SDK objects or relying on prose parsing. |
| 5 | F26 - AI-assisted merge-conflict resolution | Uses the same provider boundary and structured-output rules for semantic conflict-resolution results inside a synchronization worktree. |
| 6 | F28-F30 - Recovery, security, and release readiness | Reconcile interrupted provider turns, exercise the credential/policy boundary, and verify the packaged Windows runtime behavior. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-11 | FR-03.1-FR-03.8, FR-06.1-FR-06.8, INV-01-INV-04 | AC-04-AC-06, AC-12-AC-13, AC-17 | Primary adapter boundary: F15 owns the MVP Codex invocation contract and local worktree capability; F13 owns worktree ownership and F17 owns bounded execution. |
| APP-AC-12 | FR-02.1-FR-02.7, FR-04.1-FR-04.8, FR-05.1-FR-05.7 | AC-01-AC-03, AC-07-AC-09, AC-17 | Primary structured-result contract: F15 owns normalized Review Proposal/Review Implementation schemas and validation; F18/F21 own workflow use. |
| APP-AC-63 | FR-01.1-FR-01.8, FR-02.1-FR-02.7, FR-06.1-FR-06.8, INV-02-INV-08 | AC-01-AC-06, AC-12-AC-17 | Primary provider-neutral boundary: the Codex SDK is isolated in one adapter and a future provider can satisfy the same contract without changing deterministic services. |
| APP-AC-64 | FR-05.1-FR-05.7, FR-07.1-FR-07.5, INV-06-INV-08 | AC-10-AC-11, AC-15-AC-18 | Shared metadata contract: F15 exposes safe provider/model/profile/policy/conversation/usage metadata; F03 persists it and F17 owns operation/turn lifecycle. |
| APP-AC-60 | FR-01.1-FR-03.8, FR-05.1-FR-07.5 | AC-02-AC-03, AC-10, AC-15 | Shared boundary: F15 requires a declared task type and passes the resolved profile snapshot through the adapter; F16 owns profile resolution and settings. |
| APP-AC-61 | FR-01.3-FR-01.8, FR-03.1-FR-03.8, FR-07.1-FR-07.5 | AC-02, AC-10, AC-14-AC-16 | Shared boundary: F15 accepts immutable profile/policy snapshots and never rereads mutable preferences; F16/F17 own segment creation and persistence. |
| APP-AC-62 | FR-05.1-FR-05.7, FR-07.1-FR-07.5 | AC-10-AC-11, AC-15-AC-18 | Shared metadata contract: F15 returns the task/provider/model/reasoning/profile/policy data needed by F20/F27; those features own presentation. |
| APP-AC-70 | FR-03.1-FR-03.8, FR-06.3-FR-06.8, INV-02-INV-05 | AC-03, AC-05-AC-06, AC-12-AC-16 | Shared safety boundary: F15 translates or rejects the already-resolved policy and never broadens it; F16 owns named presets and F29 owns defense-in-depth hardening. |
| APP-AC-22 | FR-04.4-FR-05.7, FR-07.4-FR-07.5 | AC-10-AC-11, AC-14-AC-15, AC-18 | Shared conversation contract: F15 supplies bounded read-only conversation and continuation results; F21 owns the user workflow and UI. |
| APP-AC-71 | FR-03.2-FR-03.4, FR-06.3-FR-06.6, INV-03-INV-04 | AC-04-AC-07, AC-12-AC-13, AC-16 | Shared read-only boundary: F15 enforces the provider request/policy floor; F18/F20 own the proposal-stage workflow and presentation. |

F15 does not claim coverage for polling, GitHub access, persistence transactions,
worktree creation, validation execution, review-bundle decisions, UI behavior,
publication, or the bounded-work policy itself. Those behaviors remain owned by
the features named above even when their inputs or outputs cross this contract.

## Executive Summary

PRMonitor needs semantic AI work, but the rest of the application must not become
dependent on one provider's SDK, thread model, event vocabulary, or response
format. Without a stable provider boundary, Codex-specific objects could leak
into persistence and UI code, natural-language prose could accidentally decide
application state, a future provider could require changes throughout the
monitoring pipeline, and a provider process could receive credentials or
authority that belong only to deterministic application services.

F15 defines the provider-neutral contract used by every MVP AI task and adds the
OpenAI Codex adapter. It normalizes task/profile/policy/input snapshots,
capabilities, streaming lifecycle events, structured outputs, usage,
conversation references, and safe machine-readable failures. The adapter maps
those contracts to the pinned `@openai/codex-sdk@0.155.1`, uses the exact
operation-owned worktree supplied by F13, honors the resolved execution policy,
and runs with a controlled environment that excludes GitHub publication
credentials.

The feature deliberately stops at the provider boundary. F15 does not choose
user preferences, schedule work, own turn budgets, decide deterministic
progress, persist authoritative application state, run validation, create a
worktree, or publish anything. A fake provider and a Codex fixture adapter must
prove the same normalized contract so later workflows can be tested without
provider credentials or network access.

## User Stories

### Use a configured provider through one boundary

- **US-01:** **GIVEN** a task has a resolved task-profile snapshot, execution-policy snapshot, and operation-owned worktree reference, **WHEN** an AI turn is requested, **THEN** PRMonitor sends the request through the provider registry with the declared task type and returns provider-neutral metadata and a structured result.
  - **Acceptance Criteria:** AC-01-AC-03, AC-10-AC-12.
- **US-02:** **GIVEN** a provider or model cannot satisfy the requested task, policy, reasoning setting, or structured-output capability, **WHEN** the request is validated, **THEN** PRMonitor rejects it before the provider side effect starts and returns an actionable machine-readable reason.
  - **Acceptance Criteria:** AC-03, AC-11, AC-13, AC-16.

### Review feedback produces trustworthy structured output

- **US-03:** **GIVEN** a review proposal request contains immutable input event versions, repository context, and a read-only worktree, **WHEN** the provider completes, **THEN** the result contains one validated assessment/disposition for every input event version and no code mutation is authorized by the proposal response.
  - **Acceptance Criteria:** AC-05, AC-07-AC-09, AC-17.
- **US-04:** **GIVEN** a review implementation request contains the developer's final per-item decisions and a writable operation worktree, **WHEN** the provider completes, **THEN** it returns a structured implementation report while the actual diff and validation truth remain the responsibility of deterministic downstream services.
  - **Acceptance Criteria:** AC-06-AC-07, AC-10-AC-12, AC-17.

### Preserve a safe provider and publication boundary

- **US-05:** **GIVEN** Codex needs to inspect or modify an isolated worktree, **WHEN** the adapter starts it, **THEN** Codex receives the exact allowed working directory and policy translation, but no GitHub publication credentials or publication API.
  - **Acceptance Criteria:** AC-04-AC-06, AC-12-AC-13, AC-16.
- **US-06:** **GIVEN** a provider emits progress, usage, a conversation reference, or an error, **WHEN** F15 returns it, **THEN** the value is bounded, redacted where required, provider-neutral, and safe for persistence and later display; raw SDK objects never cross the boundary.
  - **Acceptance Criteria:** AC-09-AC-11, AC-15-AC-18.

### Remain replaceable and restart-safe

- **US-07:** **GIVEN** a fake provider and the Codex adapter receive equivalent normalized requests, **WHEN** the conformance suite runs, **THEN** both satisfy the same capability, event, structured-result, cancellation, and metadata contracts.
  - **Acceptance Criteria:** AC-01-AC-03, AC-07-AC-10, AC-14, AC-17.
- **US-08:** **GIVEN** a renderer closes or the process restarts during or after a provider turn, **WHEN** a later workflow inspects or explicitly resumes the provider conversation, **THEN** the prior metadata and opaque reference remain available, no new turn is started automatically, and a provider/reference mismatch fails safely.
  - **Acceptance Criteria:** AC-10-AC-11, AC-14-AC-15, AC-18.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** the registry contains the MVP Codex adapter and a deterministic fake provider, **WHEN** a caller resolves a supported provider ID, **THEN** it receives the normalized provider interface and capability descriptor; an unknown or duplicate provider ID returns a safe configuration error without invoking a provider.
- **AC-02:** **GIVEN** a normalized request is created, **WHEN** it is serialized and validated, **THEN** it contains a schema version, request/operation/turn identity, declared task type and interaction mode, immutable task-profile and execution-policy snapshots, an F13 operation-worktree reference when code access is needed, prepared context/input references, an expected structured-output contract, and bounded timeout/cancellation metadata; it contains no SDK object, credential, uncontrolled environment value, or authoritative mutable preference lookup.
- **AC-03:** **GIVEN** a request asks for an unsupported task type, model/reasoning combination, structured-output dialect, sandbox/policy capability, working-directory mode, or conversation continuation, **WHEN** the registry validates it, **THEN** it returns `CAPABILITY_UNSUPPORTED` or a more specific safe reason before calling the provider; the provider receives no prompt, worktree command, or child-process start.
- **AC-04:** **GIVEN** the Codex adapter is selected, **WHEN** a supported request is invoked, **THEN** only the adapter imports `@openai/codex-sdk`, the adapter creates a Codex client/thread with the declared model, working directory, reasoning effort, sandbox, network, and approval settings, and the rest of the application observes only normalized contracts.
- **AC-05:** **GIVEN** a `REVIEW_PROPOSAL` request, **WHEN** the Codex adapter starts it, **THEN** the effective policy is at least read-only, the operation worktree is not granted write authority, the request contains no publication capability, and a contract test proves that proposal completion cannot create a commit, push, GitHub response, or publication intent. Actual post-turn worktree inspection remains deterministic F13 evidence.
- **AC-06:** **GIVEN** a `REVIEW_IMPLEMENTATION` or `CONFLICT_RESOLUTION` request, **WHEN** it starts, **THEN** the provider is given only the exact operation-owned worktree path and permitted local capabilities in the immutable policy snapshot; the normalized interface exposes no commit, push, merge-publication, GitHub, or response-posting method, and an out-of-policy path or capability is rejected before start.
- **AC-07:** **GIVEN** a supported task output schema, **WHEN** F15 publishes the provider request, **THEN** it generates a deterministic JSON Schema from the Zod-first contract, passes the required schema to Codex, validates the returned structured value with the same Zod contract, and rejects prose-only, malformed, unknown-field, or schema-incompatible output as `INVALID_STRUCTURED_OUTPUT`.
- **AC-08:** **GIVEN** a Review Proposal receives input event-version IDs `[e1, e2, ...]`, **WHEN** its structured result is normalized, **THEN** every input version is represented exactly once by its stable ID, no unrequested version is accepted, duplicate/missing IDs are rejected, and the result cannot be marked complete solely because a summary string exists.
- **AC-09:** **GIVEN** the provider emits lifecycle, progress, file-change, command, usage, or failure events, **WHEN** the adapter maps them, **THEN** it emits ordered normalized events with bounded safe payloads, relative/bounded file metadata where applicable, and explicit terminal status; raw SDK items, MCP payloads, prompts, secrets, and unbounded command output do not cross the boundary.
- **AC-10:** **GIVEN** a provider turn completes or fails, **WHEN** F15 returns its metadata, **THEN** the record includes provider ID, model ID, task type, profile revision, immutable execution-policy snapshot reference, start/end times, optional opaque provider conversation reference, and normalized usage counters when available; the database and F17 remain the authoritative owners of durable operation/turn state.
- **AC-11:** **GIVEN** the provider reports authentication, capability, invalid-request, structured-output, policy, cancellation, timeout, process, network, or service failure, **WHEN** F15 maps it, **THEN** the result has a stable safe code, retryability, user-action classification, bounded diagnostic details, and no raw secret/prompt/SDK object; an absent or incomplete usage value is represented as unavailable rather than guessed.
- **AC-12:** **GIVEN** an Autonomous Worktree policy permits local work, **WHEN** the Codex adapter builds its invocation, **THEN** it passes an explicit working directory, sandbox, approval, network, model, reasoning, and controlled-environment configuration; it never inherits the parent environment wholesale and never passes GitHub publication credentials.
- **AC-13:** **GIVEN** the resolved policy requires an interactive approval callback, a writable path outside the operation worktree, uncontrolled network, or a provider capability the direct SDK adapter cannot enforce, **WHEN** Codex invocation is prepared, **THEN** the adapter fails closed with `POLICY_UNSUPPORTED` or `POLICY_BOUNDARY_VIOLATION` and does not silently prompt, broaden access, or switch modes.
- **AC-14:** **GIVEN** F17 or the owning workflow cancels or times out a turn, **WHEN** its `AbortSignal` reaches the adapter, **THEN** the adapter requests provider cancellation, emits one terminal cancelled/timeout outcome, does not start another turn, and leaves continuation/retry authorization to the persisted workflow owner.
- **AC-15:** **GIVEN** a prior Codex conversation reference exists, **WHEN** an explicitly authorized follow-up supplies the same provider ID and compatible task/policy contract, **THEN** the adapter may resume the opaque provider thread; a provider mismatch, malformed reference, or unsupported resume capability fails safely, and renderer closure/restart alone never resumes it.
- **AC-16:** **GIVEN** the adapter is inspected at compile time and during a fixture invocation, **WHEN** credentials and authority are evaluated, **THEN** GitHub credentials, secure-store values unrelated to provider authentication, publication APIs, and renderer-controlled shell commands are absent from the provider request and controlled child environment; only deterministic application services can publish.
- **AC-17:** **GIVEN** the fake provider and Codex JSONL fixture emit equivalent successful, malformed, streamed, cancelled, timed-out, and failed turns, **WHEN** both are run through the conformance suite, **THEN** they produce equivalent normalized status, structured-result validation, event ordering, usage/reference shape, and safe error categories without requiring network access or real credentials.
- **AC-18:** **GIVEN** F03/F17 persist an F15 result after UI closure or restart, **WHEN** a consumer reads it, **THEN** provider-neutral metadata, profile/policy snapshot references, opaque conversation reference, usage, structured result, terminal reason, and schema version round-trip without SDK instances or prompt/environment leakage; replaying the same completed turn identity does not create a second provider turn.

## Functional Requirements

### FR-01: Provider-neutral invocation envelope

- FR-01.1: The application SHALL define versioned provider-neutral schemas for task types, interaction modes, task-profile snapshots, execution-policy snapshots, operation-owned worktree references, prepared context/input references, structured-output contracts, invocation metadata, and provider results.
- FR-01.2: Every invocation SHALL declare one supported task type: `AUTOMATIC_REVIEW_REEVALUATION`, `REVIEW_REVISION`, `READ_ONLY_CONVERSATION`, or `MERGE_CONFLICT_RESOLUTION`; the task type SHALL not be inferred from prompt text or provider thread state.
- FR-01.3: Every invocation SHALL carry the immutable provider/model/reasoning/profile revision snapshot resolved by F16 and the immutable execution-policy snapshot resolved by F16; F15 SHALL not reread mutable preferences while a turn is running.
- FR-01.4: A request that can inspect or modify code SHALL carry the F13 operation/worktree identity and exact canonical path supplied by the owning workflow; requests SHALL not accept an arbitrary renderer path or developer-worktree path.
- FR-01.5: Input context SHALL identify the immutable review-event versions, PR/repository/ref/SHA snapshots, repository/Common Instructions/Build & Validation snapshots, human decisions, and prior safe validation evidence used by the task when those inputs apply.
- FR-01.6: Provider-neutral records SHALL contain only bounded serializable values and opaque references; SDK objects, provider event objects, credentials, prompts used as authoritative state, and uncontrolled environment values SHALL not cross the adapter boundary.
- FR-01.7: The invocation envelope SHALL identify the expected output contract and schema version before provider execution; a provider SHALL not be allowed to choose an unregistered output shape at runtime.
- FR-01.8: F15 SHALL expose a single provider invocation boundary used by fake and Codex providers; downstream services SHALL not import or call a provider SDK directly.

### FR-02: Registry and capability validation

- FR-02.1: The application SHALL provide an `AIProviderRegistry` that resolves a provider by stable provider ID and rejects unknown, duplicate, disabled, or incompatible registrations deterministically.
- FR-02.2: Each provider SHALL advertise task support, structured-output support/dialect, streaming support, conversation continuation, reasoning controls, policy/sandbox modes, controlled-environment support, and any provider-specific limits needed for admission.
- FR-02.3: Registry validation SHALL compare the declared task, profile, policy, worktree access, reasoning setting, conversation reference, and output contract with the selected provider capabilities before invoking it.
- FR-02.4: Unsupported capability, invalid profile/provider combination, invalid output contract, or incompatible conversation reference SHALL return a stable safe error and SHALL not start a provider process or consume a provider turn.
- FR-02.5: A provider that cannot produce the required structured result for an MVP task SHALL be rejected; free-form final text SHALL not be used as a fallback application result.
- FR-02.6: Capability data SHALL be provider-neutral and serializable; provider-specific SDK types and option objects SHALL remain inside the adapter.
- FR-02.7: The registry SHALL support a deterministic fake provider with the same public contract as Codex for tests and local contract fixtures.

### FR-03: Worktree, policy, and authority boundary

- FR-03.1: F15 SHALL accept only a validated F13 operation-owned worktree reference and SHALL pass only its exact canonical path to a provider that is authorized to access code.
- FR-03.2: `AUTOMATIC_REVIEW_REEVALUATION` proposal work SHALL enforce a read-only policy floor even if a broader application default exists; proposal output SHALL not authorize worktree mutation.
- FR-03.3: Worktree-mutating task types SHALL receive the effective policy snapshot, including sandbox, approval, network, writable-root, and controlled-environment settings, without allowing the provider or model response to broaden it.
- FR-03.4: The provider interface SHALL have no publication, GitHub, commit, push, conversation-resolution, or merge-publication operation; provider output SHALL never be treated as publication authority.
- FR-03.5: F15 SHALL distinguish provider authentication needed to run the selected provider from GitHub credentials; only the adapter-owned credential seam may receive provider authentication, and no credential value may enter normalized requests, results, prompts stored as state, or logs.
- FR-03.6: The direct Codex adapter SHALL advertise or reject execution-policy capabilities explicitly; a policy requiring an in-application approval callback that the adapter cannot support SHALL fail before invocation.
- FR-03.7: The adapter SHALL not pass the parent process environment wholesale; it SHALL receive an explicit controlled environment and exclude GitHub/application secrets and unrelated credential-shaped variables.
- FR-03.8: F15 SHALL leave deterministic worktree inspection, validation, progress, budget, and publication decisions to F13-F14, F17, and later workflow services.

### FR-04: Structured output contracts

- FR-04.1: F15 SHALL define Zod-first, versioned schemas for `AIReviewProposal`, `AIReviewImplementation`, `AIReadOnlyConversationResult`, and `AIConflictResolutionResult`.
- FR-04.2: `AIReviewProposal` SHALL contain a summary and exactly one structured item for each input remote event version, with stable event-version identity, assessment, one of `fixed`/`pushback`/`question`/`no_change`, optional implementation proposal, optional proposed reply, and related-file evidence.
- FR-04.3: `AIReviewImplementation` SHALL contain structured model-reported approach/problems/remaining-issues and per-item implementation outcomes keyed to the final human decisions; it SHALL not claim deterministic validation success or publication completion.
- FR-04.4: `AIReadOnlyConversationResult` SHALL contain a bounded answer string, optional bounded explanation/next-step data, and an explicit `read_only` interaction marker; it SHALL reject file-change instructions as an implementation result and SHALL grant neither file mutation nor publication authority.
- FR-04.5: `AIConflictResolutionResult` SHALL support structured resolved/ambiguous/blocked outcomes, remaining issues, and user-question/competing-intent data when the task cannot safely choose a semantic result; F26 owns the conflict workflow and deterministic verification.
- FR-04.6: F15 SHALL generate deterministic JSON Schema from the Zod contracts for provider structured-output APIs and SHALL validate the returned value with the same contract before returning success.
- FR-04.7: Unknown fields, unsupported schema versions, missing required fields, malformed IDs, duplicate item identities, out-of-scope input identities, and prose-only output SHALL fail closed as invalid structured output.
- FR-04.8: Structured schemas SHALL keep deterministic observations separate from model-reported text; actual files, commands, Git state, validation results, and progress classifications SHALL be supplied by deterministic consumers.

### FR-05: Normalized events, usage, and conversation references

- FR-05.1: F15 SHALL normalize provider lifecycle and progress into ordered bounded events for turn start, safe progress/item activity, file-change activity when exposed, command activity when exposed, completion, cancellation, and failure.
- FR-05.2: A normalized event SHALL include a schema version, sequence/order, safe timestamp, provider ID, turn identity, event kind, and bounded structured details; raw SDK events SHALL never cross the boundary.
- FR-05.3: File paths in provider events SHALL be relative to or safely attributable to the operation worktree, and command/output details SHALL be bounded and redacted before they are emitted to F09, F17, IPC, persistence, or UI.
- FR-05.4: Usage SHALL use provider-neutral optional counters for input, cached input, cache-write input, output, reasoning output, and total usage; missing provider counters SHALL remain unavailable rather than being guessed.
- FR-05.5: Conversation references SHALL include the provider ID, an opaque bounded reference value, and resumability metadata; they SHALL not be parsed, compared across providers, or treated as application state.
- FR-05.6: The normalized terminal result SHALL echo the effective provider/model/task/profile/policy metadata so a consumer can detect a mismatch between requested and executed configuration.
- FR-05.7: F15 SHALL expose provider errors as stable normalized error records with code, category, retryability, user-action classification, bounded safe detail, and optional opaque provider reference; raw exception messages and SDK objects SHALL remain adapter-internal.

### FR-06: Codex adapter behavior

- FR-06.1: The MVP SHALL implement the provider-neutral interface with `@openai/codex-sdk@0.155.1` and SHALL keep all SDK imports, thread objects, option translation, JSONL event mapping, and SDK-specific errors inside the Codex adapter module.
- FR-06.2: The adapter SHALL create or explicitly resume a Codex thread using the request's exact working directory, model, reasoning effort, structured-output schema, and effective policy translation; it SHALL not silently substitute defaults that change the snapshot.
- FR-06.3: The adapter SHALL map the MVP read-only policy to read-only sandbox behavior, no approval prompts, and the resolved network setting; the default Autonomous Worktree policy SHALL map to workspace-write limited to the operation worktree, no approval prompts, and only explicitly enabled network access.
- FR-06.4: The adapter SHALL not add extra writable directories, additional repositories, GitHub remotes, publication tools, or uncontrolled environment variables beyond the immutable policy snapshot.
- FR-06.5: The adapter SHALL map Codex streamed JSONL events, final structured output, usage, thread ID, cancellation, and failures into the normalized F15 contracts with bounded/redacted payloads.
- FR-06.6: The adapter SHALL use the direct SDK's structured-output mechanism for required task schemas and SHALL reject a turn whose final response cannot be parsed and validated against the expected schema.
- FR-06.7: The adapter SHALL honor the caller's abort signal and shall not automatically resume or retry a cancelled, timed-out, failed, or interrupted turn.
- FR-06.8: The adapter SHALL use an injected Codex client/runtime factory in tests so conformance fixtures do not require network access, real credentials, or a developer worktree.

### FR-07: Handoff, replay, and persistence safety

- FR-07.1: F15 SHALL return a provider-neutral turn result that F17 can hand to F03 for persistence without importing the SDK, including task/profile/policy metadata, structured result, ordered normalized events, usage, conversation reference, terminal status, and safe error data.
- FR-07.2: F15 SHALL treat the application request and deterministic input snapshots supplied by F16/F13/F14/F18 as authoritative for the turn; provider thread state SHALL remain execution context only.
- FR-07.3: Replaying a completed request identity SHALL be handled by the owning durable workflow; F15 SHALL not start a second provider turn merely because a renderer closed or a process restarted.
- FR-07.4: Explicit conversation continuation SHALL require a matching provider ID, a compatible task/policy contract, and an owning workflow authorization; a mismatch SHALL return a safe non-success result.
- FR-07.5: F15 SHALL expose enough metadata for downstream records to show the task type, provider, model, reasoning effort when supported, profile revision, policy summary/reference, conversation reference when available, and usage.
- FR-07.6: F15 SHALL not own operation/segment lifecycle, budgets, persistence transactions, worktree creation or inspection, validation execution, workflow completion, or publication; those responsibilities SHALL remain with the F17, F03, F13, F14, and downstream workflow boundaries described by the approved handoff.

### FR-08: Conformance and boundary verification

- FR-08.1: The fake provider and Codex adapter SHALL run the same contract conformance suite for successful, invalid, streamed, cancelled, timed-out, unsupported, malformed-output, and provider-failure cases.
- FR-08.2: Static boundary checks SHALL fail when any module outside the Codex adapter imports `@openai/codex-sdk`, and shared/renderer code SHALL not import provider adapters or child-process/secret infrastructure.
- FR-08.3: Tests SHALL prove that structured output validation accounts for every input event version and rejects duplicate, missing, and out-of-scope identities.
- FR-08.4: Tests SHALL prove that read-only proposal, policy refusal, controlled environment, no-publication-authority, no-network/no-credential fixture, and exact-worktree behaviors are deterministic and inspectable.
- FR-08.5: Tests SHALL prove that normalized records and errors contain no credentials, API keys, raw prompts intended to be secret, provider SDK instances, raw MCP payloads, or uncontrolled environment values.
- FR-08.6: Tests SHALL prove that provider usage and conversation references remain optional/opaque and that absent usage is never fabricated.
- FR-08.7: Tests SHALL prove that F15 works with the current F13/F14 handoff records and can be consumed by thin F17/F18/F26 fakes without importing provider-specific code.

## Non-Functional Requirements

- **NFR-01:** Provider admission, capability checks, schema generation, output validation, event normalization, error classification, and policy translation SHALL be deterministic for the same serialized request, capability descriptor, SDK fixture, and injected clock.
- **NFR-02:** Every public F15 contract SHALL be explicitly schema-versioned, JSON-serializable, bounded, and compatible with validated main/preload/renderer and F03 persistence boundaries.
- **NFR-03:** Normalized event/output/error payloads SHALL have bounded sizes and SHALL redact or reject secrets before crossing the adapter boundary; an output-limit or redaction failure SHALL be non-success.
- **NFR-04:** Provider invocation SHALL honor cancellation and caller timeouts without creating an unbounded provider loop; continuation and retry decisions SHALL remain explicit workflow actions.
- **NFR-05:** Adding a provider adapter SHALL not require changes to polling, GitHub, worktree, validation, domain-state, persistence, review-bundle, or publication services beyond registry/configuration wiring and conformance tests.
- **NFR-06:** The Codex adapter SHALL be testable without network access, real provider credentials, a visible renderer, or mutation of the developer's normal worktree.
- **NFR-07:** Windows path, environment, child-process, and cancellation behavior SHALL be represented in adapter contract tests because Windows is the MVP platform; provider-neutral contracts SHALL remain portable.
- **NFR-08:** Provider-specific options and errors SHALL remain encapsulated so a future adapter can expose different capabilities without weakening the normalized contract.

## Invariants

- **INV-01:** Deterministic application code owns provider selection, capability validation, task/profile/policy snapshots, input-event accounting, state transitions, budgets, validation truth, and publication; AI output never chooses an application state or publication action.
- **INV-02:** The AI provider may work only inside the operation-owned boundary supplied by F13 and the immutable execution policy; it may not access the developer worktree through F15.
- **INV-03:** The provider boundary exposes no commit, push, response-posting, conversation-resolution, approval, merge-publication, or force-push authority.
- **INV-04:** Initial Review Proposal work is read-only until the owning workflow records every required human item decision; F15 cannot turn a proposal response into implementation authorization.
- **INV-05:** GitHub credentials, publication credentials, secure-store values unrelated to provider authentication, and uncontrolled parent environment values never enter provider-neutral requests, structured results, normalized events, logs, or AI prompts assembled from those records.
- **INV-06:** Provider/model/profile/policy/input snapshots used for a turn are immutable for that turn; changing Preferences cannot change an in-flight request or rewrite its result.
- **INV-07:** Provider conversation references and SDK thread state are opaque execution context; SQLite/domain records remain authoritative and a provider thread cannot release a hold, reset a budget, or authorize a retry.
- **INV-08:** A provider capability or model response cannot broaden sandbox, network, writable-root, approval, or credential access; unsupported policy behavior fails closed.
- **INV-09:** Every Review Proposal input event version is accounted for exactly once before the result is accepted; a summary or prose response cannot hide an omitted item.
- **INV-10:** F15 never treats provider prose, reported file changes, reported command success, or reported completion as deterministic Git/validation/progress evidence; downstream F13/F14/F17 services inspect actual state.

## Out of Scope

- F16's Preferences UI, task-profile editing, provider/model catalog UX, Common Instruction editing, repository Build & Validation settings, and selection of named execution-policy presets.
- F17's AI Work Operation/segment lifecycle, turn budgets, progress fingerprints, no-progress detection, and automatic continuation policy; F03 owns the SQLite schema, repositories, transactions, and durable commit of the resulting F15 metadata.
- F03's SQLite schema/migrations/repositories and the final durable commit of F15 metadata; F15 supplies the serializable handoff only.
- F13's worktree creation, ownership, path cleanup, Git snapshots, diff calculation, and manual-edit attribution; F15 consumes its validated reference.
- F14's validation command selection/execution and real exit-status aggregation; F15 may carry validation evidence as context but cannot create a pass.
- GitHub polling, review-event filtering, review-bundle orchestration, notifications, UI, tray behavior, IPC exposure, response publication, commits, pushes, merge publication, or GitHub conversation resolution.
- A second real provider such as GitHub Copilot or AWS Bedrock; F15 defines the extension contract and fake-provider seam only.
- Provider-specific interactive approval callbacks through the direct TypeScript SDK adapter; an adapter with a supported host approval channel is a future integration.
- Automatic provider selection, autonomous publication, force push, automatic rebase, per-hunk patch acceptance, blind `ours`/`theirs` conflict resolution, and any other MVP non-goal in the application overview.

## Product Decisions

- **PD-01: Codex is the only MVP provider implementation** - OpenAI Codex through the pinned TypeScript SDK supplies the MVP semantic capability, while the rest of the application depends only on the normalized provider contract.
- **PD-02: Structured output is mandatory for state-bearing AI tasks** - Review, implementation, and conflict-resolution workflows fail safely when a provider cannot return the required schema; prose is display context, not application state.
- **PD-03: Proposal and implementation are separate contracts** - A read-only Review Proposal can recommend `fixed`, `pushback`, `question`, or `no_change`; Review Implementation receives final human decisions and is the first code-mutating phase.
- **PD-04: Provider conversations are optional and opaque** - A provider may support continuation, but the durable application state does not depend on thread portability or provider-managed history.
- **PD-05: Direct Codex execution is non-interactive for MVP unattended work** - A policy requiring an in-application approval callback is rejected by the direct adapter instead of silently changing policy behavior.
- **PD-06: Exact input coverage is required** - A Review Proposal is complete only when every immutable input event version is represented exactly once in the structured result.
- **PD-07: No publication authority crosses the boundary** - The provider can inspect or mutate an operation-owned local worktree when authorized, but deterministic application code alone performs commits, pushes, responses, and publication.
- **PD-08: Approved ownership split** - F15 owns the provider-neutral contract, capability admission, provider translation, normalized events/results, and fail-closed adapter boundary. F16 supplies immutable profile/policy snapshots; F17 owns operation/segment lifecycle and continuation decisions; F03 owns durable persistence; F13 owns worktree/Git truth; F14 owns validation truth; and downstream workflow features own task preparation, human decisions, presentation, and publication.

## Implementation Decisions

- **IMP-01: Zod-first shared contracts** - Put provider-neutral schemas/types under `apps/desktop/src/shared/ai`, generate provider JSON Schema with the already-used `zod-to-json-schema` package using the OpenAI-compatible target, and validate the returned object with the same Zod schema.
- **IMP-02: Main-process adapters only** - Put the registry, runtime seams, and Codex adapter under `apps/desktop/src/main/ai`; only `codex-adapter.ts` may import `@openai/codex-sdk@0.155.1`. Shared and renderer code remains provider-neutral.
- **IMP-03: Injected runtime seams** - The adapter accepts injected client/thread factories, clocks, redactors, and bounded event sinks so tests use deterministic JSONL fixtures and never require real authentication or network access.
- **IMP-04: Explicit Codex translation** - Translate the immutable profile/policy snapshot to `Codex` constructor and thread options (`env`, `workingDirectory`, `model`, `modelReasoningEffort`, `sandboxMode`, `networkAccessEnabled`, `approvalPolicy`, and `outputSchema`) without copying `process.env` or enabling unlisted directories.
- **IMP-05: Normalized event mapper** - Convert Codex `ThreadEvent` values to bounded F15 events; raw SDK items, MCP results, thread objects, and provider-specific option objects stop inside the adapter.
- **IMP-06: Consumer-owned persistence** - Return a serializable `AIProviderTurnResult`; F17 owns lifecycle decisions and asks F03 to persist it and reconcile duplicate/restarted turns. F15 has no authoritative in-memory operation state and does not write SQLite directly.
- **IMP-07: Capability-first admission** - The registry validates task, profile, policy, worktree, output schema, reasoning, and conversation requirements before the adapter receives a start request.
- **IMP-08: One-way ownership handoff** - F15 accepts immutable inputs from F16/F13/F14 and downstream workflow owners, returns normalized provider evidence, and never becomes an alternate authority for settings, budgets, persistence, Git state, validation, workflow state, or publication.

## Testing Decisions

- **TST-01: Contract-test both provider implementations** - Run the same fixture suite against the fake provider and an injected Codex SDK/JSONL fixture for successful, malformed, streamed, cancelled, timed-out, unsupported, and failed turns.
- **TST-02: Test deterministic boundaries, not model quality** - Verify schema/output/event/policy/credential behavior and actual invocation arguments; do not assert that a model made a semantically correct code judgment.
- **TST-03: Keep real provider access out of automated checks** - No test requires a Codex API key, network, user session directory, GitHub token, or developer worktree. Any live smoke is an explicit opt-in diagnostic outside `npm run check`.
- **TST-04: Scan serialized and emitted values** - Inspect requests, results, normalized events, errors, persistence handoff fixtures, child environments, and logs for credentials, raw prompts, SDK objects, raw MCP payloads, unbounded output, and arbitrary paths.
- **TST-05: Exercise Windows-specific process semantics** - Cover Windows-style absolute paths, `PATHEXT`, controlled environment construction, abort/timeout propagation, and child-process failure while keeping the shared contract platform-neutral.
- **TST-06: Defer workflow/UI assertions** - F16/F17/F18/F20/F21/F26 own preference, budget, workflow, presentation, actual Git/validation, and human-review tests; F15 tests the contracts those features consume.

## Proposed Modules

- **MOD-01: AI contract schemas** - Versioned Zod schemas and TypeScript types for profiles/policies, requests, output contracts, Review Proposal/Implementation/Conversation/Conflict results, events, usage, references, and errors.
- **MOD-02: Structured-schema generator and validator** - Produces deterministic provider JSON Schema, validates output, checks exact event-version coverage, and emits safe invalid-output reasons.
- **MOD-03: Provider capability descriptor and registry** - Resolves provider IDs, validates compatibility, and prevents unsupported invocation before side effects.
- **MOD-04: Fake provider** - Deterministic test implementation that emits scripted normalized events/results and simulates capability, cancellation, timeout, malformed-output, and failure cases.
- **MOD-05: Codex runtime seam** - Encapsulates client/thread factories, controlled credentials/environment, injected clock, abort handling, and SDK fixture transport.
- **MOD-06: Codex provider adapter** - Maps normalized requests to the pinned Codex SDK and maps SDK events/results/errors back to F15 contracts.
- **MOD-07: Provider-neutral turn handoff** - Converts the completed adapter outcome into the serializable record consumed by F03/F17 without persisting SDK state or inferring application completion.

## Workflows

### Workflow 1: Validate and run a Review Proposal

```text
1. F16 resolves an Automatic Review / Re-evaluation profile and read-only policy snapshot.
2. F13 supplies the operation-owned worktree identity and current revision snapshot.
3. F18 prepares immutable review event/context/validation references and selects the Review Proposal output contract.
4. AIProviderRegistry validates provider capabilities, task type, policy floor, output schema, worktree identity, and input event IDs.
5. The selected adapter starts one provider turn with the declared snapshot and emits normalized progress.
6. The adapter validates the structured result and exact one-item-per-event coverage.
7. F15 returns normalized metadata, usage, conversation reference, events, result, or safe failure.
8. F13/F14 supply deterministic worktree/validation evidence, while F18/F17 ask F03 to persist the proposal bundle and lifecycle records; F15 does not decide application state.
```

### Workflow 2: Run a worktree-mutating implementation or conflict turn

```text
1. The owning workflow supplies final human decisions or conflict context, F13's isolated worktree, and the resolved mutating policy snapshot.
2. F17 creates/authorizes the bounded turn and passes an AbortSignal and immutable profile/policy/input snapshots.
3. The registry rejects unsupported policy/capability combinations before the Codex adapter starts.
4. Codex runs only inside the allowed worktree with a controlled environment and no GitHub publication credentials.
5. F15 maps streamed events and the structured implementation/conflict result, preserving model-reported text separately from deterministic observations.
6. F13 refreshes actual Git state and F14 runs approved validation; F17 classifies progress and decides whether another bounded turn is allowed.
7. A renderer close, process restart, timeout, or cancellation does not cause F15 to auto-resume or reset the owning budget/history.
```

### Workflow 3: Explicit provider conversation continuation

```text
1. A user action is persisted by the owning workflow and supplies an opaque conversation reference.
2. The registry verifies that the reference belongs to the selected provider and that the new task/policy contract is compatible.
3. The adapter explicitly resumes the provider conversation or returns a safe unsupported/mismatch error.
4. The result is normalized and handed back to the owning workflow; the provider thread never becomes authoritative application state.
```

## Requirement Traceability

| Requirement family | Observable coverage |
|---|---|
| FR-01 | AC-01-AC-03, AC-08, AC-10, AC-18; CT-F15-01, CT-F15-02, CT-F15-07 |
| FR-02 | AC-01-AC-03, AC-07, AC-11, AC-17; CT-F15-02, CT-F15-03, CT-F15-08 |
| FR-03 | AC-05-AC-06, AC-12-AC-16; CT-F15-04, CT-F15-05, CT-F15-08 |
| FR-04 | AC-07-AC-08, AC-17; CT-F15-01, CT-F15-06, CT-F15-08 |
| FR-05 | AC-09-AC-11, AC-14-AC-15, AC-18; CT-F15-06, CT-F15-07, CT-F15-08 |
| FR-06 | AC-04-AC-06, AC-09, AC-12-AC-17; CT-F15-04, CT-F15-05, CT-F15-06 |
| FR-07 | AC-10-AC-11, AC-14-AC-15, AC-18; CT-F15-07-CT-F15-08 |
| FR-08 | AC-01-AC-03, AC-05, AC-07-AC-18; CT-F15-01-CT-F15-08 |
| NFR-01-NFR-08 | AC-01-AC-18; CT-F15-01-CT-F15-08 |
| INV-01-INV-10 | AC-01-AC-18; CT-F15-01-CT-F15-08 |

## Named Contract-Test Criteria

- **CT-F15-01:** The shared Zod schemas, JSON Schema generation, version dispatch, exact-key validation, and structured-result parser round-trip valid fixtures and reject malformed/unknown values.
- **CT-F15-02:** The normalized request includes task/profile/policy/worktree/input/output-contract snapshots, rejects arbitrary paths or unbounded values, and contains no SDK/credential/environment object.
- **CT-F15-03:** Registry capability matrices reject unsupported task, model/reasoning, structured-output, conversation, worktree, or policy requests before provider start.
- **CT-F15-04:** Codex adapter invocation fixtures assert exact working directory, model, reasoning, sandbox, network, approval, output schema, and controlled-environment translation; no `process.env` spread or extra writable root is possible.
- **CT-F15-05:** Read-only proposal and no-publication tests prove proposal policy floors, absence of publication methods/credentials, and safe behavior for attempted policy broadening.
- **CT-F15-06:** Fake and Codex event/result fixtures prove lifecycle ordering, exact input-event coverage, bounded/redacted details, usage/reference normalization, invalid-output handling, and stable errors.
- **CT-F15-07:** Cancellation, timeout, renderer-absence, restart, explicit conversation-resume, provider-mismatch, and duplicate-completed-turn fixtures prove no automatic resume/retry and safe opaque handoff.
- **CT-F15-08:** Static import, package dependency, secret scan, Windows path/environment, thin-consumer, and cross-provider conformance checks prove the adapter is the only SDK importer and F03/F17/F18/F26 can consume the same normalized contract.


## Issue 1 supplement: Local provider configuration preflight

Approved scope: [resumable setup on startup](https://github.com/bryant-collab/PRMonitor/issues/1). Expose only runtime/authentication presence through a provider-neutral local readiness port. The Codex adapter uses the same approved authentication environment as invocation; it does not start a client turn, log credentials, probe remote quota, initiate login, or grant controlled-environment bypass. Display locally configured access with the qualification that service access is checked when work starts. Missing providers and confirmed missing authentication are incomplete.
