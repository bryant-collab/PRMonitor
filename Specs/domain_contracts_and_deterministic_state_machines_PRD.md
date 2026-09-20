# F02 Domain Contracts and Deterministic State Machines - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F01 - Application workspace and engineering foundation | Provides the TypeScript application workspace, renderer-safe shared boundary, test harness, and deterministic build/check conventions in which these contracts will live. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F03 - SQLite persistence, migrations, and transactional repositories | Persists the versioned domain records, transition history, holds, and idempotency constraints defined here. |
| 2 | F04 - Persistent Electron shell, IPC boundary, and Windows virtual-desktop spike | Uses the domain results and lifecycle rules without making the renderer authoritative. |
| 3 | F08/F11/F12 - Managed-PR inbox, event eligibility, and review scheduling | Uses primary PR state, automatic-review admission, hold, and event-association contracts. |
| 4 | F13/F17 - Worktrees and bounded AI work | Uses operation admission, state fingerprints, stop reasons, and explicit continuation boundaries. |
| 5 | F18-F22 - Review preparation and human review | Uses Review Bundle states, holds, stale handling, and publication readiness. |
| 6 | F23-F28 - Branch synchronization and publication | Uses synchronization overlays, deterministic reasons, publication phases, and idempotency contracts. |
| 7 | F29/F30 - Reliability, security, and release completion | Uses the stable error, transition, and recovery vocabulary for diagnostics and release evidence. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-16 | FR-04.1-FR-05.8, FR-06.1-FR-06.5, INV-04-INV-06 | AC-04-AC-09, AC-11 | Shared enabler: F02 owns the hold and transition contract; F11/F18/F21 own event eligibility, operation execution, and user actions. |
| APP-AC-24 | FR-05.4-FR-05.8, FR-10.1-FR-10.4, INV-05 | AC-10-AC-12 | Shared enabler: F02 owns monotonic handled-association rules; F11/F18/F27 own observation, bundle completion, and publication integration. |
| APP-AC-25 | FR-05.5-FR-05.8, FR-10.1-FR-10.4, INV-05-INV-06 | AC-09-AC-12 | Shared enabler: F02 owns retained-during-hold semantics; F10-F12/F18 own polling, batching, and later eligibility. |
| APP-AC-44 | FR-07.2-FR-07.3, FR-10.4, INV-07 | AC-13 | Shared enabler: F02 owns the provider-neutral branch-identity fields and keeps synchronization independent from primary PR state; F06/F23 own remote resolution and merge execution. |
| APP-AC-49 | FR-03.1-FR-03.6, FR-07.1-FR-07.8, FR-09.1-FR-09.5, INV-07-INV-09 | AC-03, AC-13-AC-15 | Shared enabler: F02 owns status/reason contracts; F23-F25 own synchronization records, UI presentation, and external Git effects. |
| APP-AC-50 | FR-08.3, FR-08.8, INV-08 | AC-15 | Shared enabler: F02 owns the explicit-approval and no-force-push contract; F28 owns SHA verification and deterministic push behavior. |
| APP-AC-51 | FR-07.7, FR-08.4, INV-09 | AC-13, AC-16 | Shared enabler: F02 owns stale/non-publishable and recovery states; F24-F26 own remote movement detection and re-evaluation. |
| APP-AC-52 | FR-06.3-FR-06.4, FR-10.2-FR-10.4, INV-10 | AC-12, AC-13 | Shared enabler: F02 owns stale/history-preserving bundle transitions; F26 owns marking older bundles stale after synchronization publication. |
| APP-AC-53 | FR-08.4-FR-08.6, FR-08.9, INV-09 | AC-16, AC-18 | Shared enabler: F02 owns idempotency/recovery semantics; F26-F28 own durable operation and remote-effect reconciliation. |
| APP-AC-67 | FR-06.3-FR-06.4, FR-10.4, INV-10 | AC-12, AC-13 | Shared enabler: F02 owns immutable bundle snapshot references and stale guards; F13/F20/F27 own actual worktree/context diff calculation and selective publication. |
| APP-AC-68 | FR-08.1-FR-08.9, FR-09.1-FR-09.5, INV-08-INV-10 | AC-14-AC-16 | Shared enabler: F02 owns publication-phase and uncertain-outcome contracts; F27/F28 own durable publication execution and remote reconciliation. |
| APP-AC-69 | FR-05.1-FR-05.6, FR-10.4, INV-05 | AC-09-AC-11 | Shared enabler: F02 owns immutable version/association semantics; F10/F11/F18 own remote snapshots, content hashing, and persistence. |

## Executive Summary

PRMonitor has several long-running workflows that must remain understandable and safe across renderer closure, application restart, sleep, retries, and uncertain network outcomes. If each later feature invents its own strings and transitions, the application could start two automatic reviews for one PR, release a review hold accidentally, treat a synchronization overlay as a new PR state, or repeat a publication after an ambiguous response.

This feature establishes the provider-neutral domain vocabulary and deterministic transition rules used by the rest of PRMonitor. It gives every managed PR one intentionally small primary review state, keeps global pause and branch synchronization as overlays, models Review Bundle and publication lifecycles separately, and returns structured reasons for rejected actions. It also defines the monotonic association of immutable feedback versions with bundles so handled feedback cannot be silently analyzed again while new feedback observed during a hold remains available for later work.

The feature is a contract and deterministic state-machine milestone. It does not add SQLite persistence, GitHub calls, Git operations, AI-provider calls, publication side effects, or a renderer UI. Those later features must consume these contracts rather than reimplementing them.

## User Stories

### Stable domain vocabulary

- **US-01:** **GIVEN** a later workflow refers to a PR, bundle, operation, event version, or publication, **WHEN** it creates or returns a domain record, **THEN** the record uses a provider-neutral typed identifier, a UTC instant, and a structured result/reason shape that can be serialized without SDK objects or credentials.
  - **Acceptance Criteria: AC-01, AC-02, AC-03**
- **US-02:** **GIVEN** a deterministic service rejects an action, **WHEN** the caller receives the result, **THEN** it can distinguish an invalid transition, active hold, stale result, cancellation, retryable failure, permanent failure, and uncertain external outcome without parsing prose.
  - **Acceptance Criteria: AC-03, AC-16**

### Managed PR review lifecycle

- **US-03:** **GIVEN** a managed PR is being watched, **WHEN** an eligible automatic review is dispatched, **THEN** the PR enters `WORKING` only if no automatic review operation or hold is active for that PR.
  - **Acceptance Criteria: AC-04, AC-05, AC-07**
- **US-04:** **GIVEN** automatic work produces a reviewable bundle or stops with a blocking reason, **WHEN** the deterministic completion decision is recorded, **THEN** the PR enters `READY_FOR_REVIEW` or `NEEDS_ATTENTION`, the corresponding automatic hold is acquired, and later background work is rejected until an explicit outcome occurs.
  - **Acceptance Criteria: AC-06, AC-07, AC-08**
- **US-05:** **GIVEN** a PR is held, **WHEN** new immutable feedback versions are observed or the visible window closes, **THEN** the hold and active work remain unchanged, new versions remain separate for later eligibility, and no concurrent automatic operation starts.
  - **Acceptance Criteria: AC-09, AC-10, AC-11**

### Review, synchronization, and publication outcomes

- **US-06:** **GIVEN** a Review Bundle changes from work in progress to review, attention, stale, publishing, published, published-with-errors, discarded, or failed, **WHEN** the transition is requested, **THEN** only a documented trigger and guard can perform it and its reason remains inspectable after restart.
  - **Acceptance Criteria: AC-12, AC-13, AC-15**
- **US-07:** **GIVEN** a PR has a Review Bundle state, **WHEN** a user starts branch synchronization, **THEN** the synchronization result uses its own status overlay and does not overwrite or expand the PR's primary review state.
  - **Acceptance Criteria: AC-13, AC-14**
- **US-08:** **GIVEN** publication reaches a side-effect boundary or an external response is uncertain, **WHEN** the application resumes, **THEN** the publication phase and idempotency key direct deterministic reconciliation and cannot restart an already completed side effect merely because the process restarted.
  - **Acceptance Criteria: AC-15, AC-16**

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** the domain contract package is compiled in main, preload-safe shared, and renderer-safe shared contexts, **WHEN** its public records are serialized and parsed, **THEN** they contain only provider-neutral scalar/array/object data, typed identifiers, UTC instants, enums, and safe structured details; no Electron, SQLite, Git, GitHub SDK, AI SDK object, credential, or platform-specific value crosses the contract.
- **AC-02:** **GIVEN** a domain record is created with an injected clock, **WHEN** the same input and clock are evaluated twice, **THEN** the resulting normalized record, state decision, and reason are identical; direct wall-clock reads, locale-dependent formatting, and nondeterministic model output cannot influence a transition.
- **AC-03:** **GIVEN** a caller requests a valid or invalid domain action, **WHEN** the transition function returns, **THEN** it returns a discriminated success/error result with a stable machine-readable code, category, retryability, user-action classification, safe detail fields, and the prior/current state; invalid actions have no state mutation.
- **AC-04:** **GIVEN** a managed PR has no active automatic operation or review hold, **WHEN** an eligible automatic review dispatch is accepted, **THEN** `WATCHING` transitions to `WORKING`; when it has no actionable event, the state remains `WATCHING` as a deterministic no-op.
- **AC-05:** **GIVEN** a PR is `WORKING`, **WHEN** the operation reports a reviewable result, **THEN** the PR transitions to `READY_FOR_REVIEW`; **WHEN** it reports a policy stop, provider failure, timeout, unresolved validation, cancellation, or other blocking reason, **THEN** the PR transitions to `NEEDS_ATTENTION` with the reason attached.
- **AC-06:** **GIVEN** a PR is `READY_FOR_REVIEW` or `NEEDS_ATTENTION`, **WHEN** a background scheduler or polling callback requests automatic analysis or worktree mutation, **THEN** the request is rejected with a hold reason and the primary state, hold, and current bundle remain unchanged.
- **AC-07:** **GIVEN** a held PR, **WHEN** the user explicitly continues, retries, or re-evaluates, **THEN** the transition to `WORKING` is accepted only with an explicit action record and an operation/bundle association; **WHEN** the user merely opens, selects, pauses, resumes, or closes the window, **THEN** no hold-release transition occurs.
- **AC-08:** **GIVEN** a held PR, **WHEN** a successful publication, published-with-errors outcome, or discard is recorded after required worktree handling, **THEN** the hold is released and the PR returns to `WATCHING`; a stale or failed bundle remains held until an explicit re-evaluation or discard action.
- **AC-09:** **GIVEN** a PR is `WORKING`, `READY_FOR_REVIEW`, or `NEEDS_ATTENTION`, **WHEN** a new immutable remote event version is observed, **THEN** it is persisted/returned as a separate retained version and cannot be attached to the active automatic operation or release the hold by itself.
- **AC-10:** **GIVEN** an event version is assigned to a Review Bundle, **WHEN** that bundle is published or discarded, **THEN** the association becomes durably `HANDLED_BY_BUNDLE` and a later eligibility decision cannot return that version to unhandled automatic analysis.
- **AC-11:** **GIVEN** the same event version is delivered repeatedly, **WHEN** the domain association operation is retried, **THEN** it is idempotent and produces at most one active/handled association; a new semantic version may be associated separately without mutating the earlier snapshot.
- **AC-12:** **GIVEN** a Review Bundle is in a documented state, **WHEN** an allowed trigger is applied, **THEN** the reducer accepts only legal transitions among `WORKING`, `READY_FOR_REVIEW`, `NEEDS_ATTENTION`, `STALE`, `PUBLISHING`, `PUBLISHED`, `PUBLISHED_WITH_ERRORS`, `DISCARDED`, and `FAILED`; an illegal transition returns `INVALID_TRANSITION` without changing the bundle.
- **AC-13:** **GIVEN** a Review Bundle and a Branch Synchronization result exist for one PR, **WHEN** either changes state, **THEN** the other state machine is not implicitly changed; synchronization can report `SKIPPED`, `MERGING`, `RESOLVING_CONFLICTS`, `READY_TO_PUBLISH`, `NEEDS_ATTENTION`, `STALE`, `PUBLISHING`, `PUBLISHED`, `DISCARDED`, or `FAILED` while the PR primary state remains one of the four primary states.
- **AC-14:** **GIVEN** global watching is paused, **WHEN** a background automatic review dispatch is requested, **THEN** the request is rejected as paused while current PR, bundle, and synchronization states remain unchanged; explicitly user-started synchronization is not converted into an automatic review state or silently cancelled by the overlay.
- **AC-15:** **GIVEN** a publication record is at `APPROVAL_REQUIRED`, `PREPARING`, `COMMITTING`, `PUSHING`, `POSTING_RESPONSES`, `RECOVERING`, `PUBLISHED`, `PUBLISHED_WITH_ERRORS`, `DISCARDED`, or `FAILED`, **WHEN** a caller requests a phase change, **THEN** only the documented phase transitions are accepted; no phase transition itself grants approval, force-push authority, or AI publication authority.
- **AC-16:** **GIVEN** a publication side effect may have occurred but its response is unavailable, **WHEN** recovery evaluates the persisted idempotency key, phase, commit SHA, and per-response remote IDs, **THEN** it enters a deterministic reconciliation path; it never creates a second commit or reposts a response solely because the prior process stopped or the same request was retried.
- **AC-17:** **GIVEN** a serialized contract record contains an unknown state, reason, phase, schema version, or extra security-sensitive field, **WHEN** it is parsed, **THEN** parsing fails closed with a safe actionable error and does not coerce it into a known state or execute any external effect.
- **AC-18:** **GIVEN** transition and invariant tests run repeatedly, concurrently, and after simulated renderer closure or process restart, **WHEN** they exercise valid, invalid, duplicate, cancellation, stale, held, and uncertain-outcome cases, **THEN** they produce stable results, reject concurrent automatic review operations for one PR, preserve terminal history, and never release a hold accidentally.

## Functional Requirements

### FR-01: Provider-neutral identifiers and timestamps

- FR-01.1: The application SHALL define opaque, provider-neutral identifier types for managed PRs, repositories, remote event versions, review batches, Review Bundles, Review Bundle items, AI Work Operations, Branch Synchronization batches and operations, worktrees, publications, idempotency keys, and activity events.
- FR-01.2: Identifier values SHALL be validated as non-empty canonical UUID-like strings or opaque keys at the domain boundary and SHALL not use a provider SDK object or provider-specific numeric ID as the domain identity.
- FR-01.3: Persisted times SHALL use UTC ISO-8601 instants; durations and ordering values SHALL use explicit numeric units; local display formatting SHALL remain outside the domain contract.
- FR-01.4: Domain operations SHALL accept an injected clock and SHALL not read the system wall clock, locale, random generator, or environment directly.

### FR-02: Results, errors, and reason data

- FR-02.1: Every public domain operation SHALL return a discriminated success/error result rather than throwing for expected invalid input, rejected transition, hold, pause, stale state, cancellation, or external-outcome uncertainty.
- FR-02.2: A domain error SHALL include a stable code, category, retryability, required user action, safe message/reason keys, and structured non-secret details sufficient for deterministic diagnostics.
- FR-02.3: Reason data for user-actionable outcomes SHALL identify what happened, why it matters, and the permitted next action without requiring a UI to infer meaning from a status label.
- FR-02.4: Error and reason serialization SHALL reject credentials, access tokens, prompts, provider SDK objects, raw exception objects, and uncontrolled environment values.
- FR-02.5: The domain SHALL distinguish deterministic failure from `UNKNOWN_EXTERNAL_OUTCOME`; an unknown outcome SHALL require reconciliation rather than a blind retry.

### FR-03: Primary managed-PR state machine

- FR-03.1: The primary managed-PR state set SHALL be exactly `WATCHING`, `WORKING`, `READY_FOR_REVIEW`, and `NEEDS_ATTENTION` for the MVP.
- FR-03.2: An eligible automatic dispatch SHALL transition `WATCHING` to `WORKING` only when no automatic review operation and no automatic review hold are active for that PR.
- FR-03.3: A reviewable completion SHALL transition `WORKING` to `READY_FOR_REVIEW`; a blocking condition SHALL transition `WORKING` to `NEEDS_ATTENTION` with deterministic reason data.
- FR-03.4: Explicit **Continue AI Work**, **Retry Resolution**, and **Re-evaluate** actions MAY transition a held PR to `WORKING` only when their action record and operation/bundle association are present.
- FR-03.5: Successful publication, published-with-errors completion, or explicit discard after required worktree handling MAY transition a held PR to `WATCHING`; passive polling, UI navigation, global pause changes, and window closure SHALL not release the hold.
- FR-03.6: An ineligible or empty automatic dispatch SHALL be a deterministic no-op or rejected action and SHALL not manufacture a `WORKING` state.

### FR-04: Automatic review holds and operation admission

- FR-04.1: `READY_FOR_REVIEW` and `NEEDS_ATTENTION` SHALL acquire an explicit per-PR automatic review hold associated with the current Review Bundle and its reason.
- FR-04.2: A held PR SHALL reject new automatic analysis, new automatic review batches, and background worktree refresh/reset/replacement with a machine-readable hold reason.
- FR-04.3: The contract SHALL allow lightweight observation of remote changes while held without treating observation as analysis, worktree mutation, or hold release.
- FR-04.4: The domain SHALL enforce at most one active automatic Review Bundle and one active automatic review AI Work Operation per PR.
- FR-04.5: A renderer close, application restart, sleep/wake, notification click, inbox selection, or global pause change SHALL not clear a hold or reset operation admission.
- FR-04.6: Explicit human continuation SHALL preserve the prior hold/bundle/operation history and create or reference a bounded continuation; it SHALL not be represented as an implicit scheduler retry.

### FR-05: Immutable event-version association

- FR-05.1: The domain SHALL represent an immutable remote event version as a distinct identity from its mutable remote object identity.
- FR-05.2: An event version MAY be `UNASSIGNED`, `ASSIGNED_TO_ACTIVE_BUNDLE`, `RETAINED_DURING_HOLD`, or `HANDLED_BY_BUNDLE`, with a bundle association and transition reason where applicable.
- FR-05.3: Assigning a version to an active automatic bundle SHALL be atomic from the domain caller's perspective and SHALL reject a second concurrent assignment.
- FR-05.4: Publishing or discarding a bundle SHALL move its assigned versions to append-only `HANDLED_BY_BUNDLE` associations; handling SHALL not be undone by UI closure, restart, or a later preference change.
- FR-05.5: Versions observed during `WORKING`, `READY_FOR_REVIEW`, or `NEEDS_ATTENTION` SHALL remain separate and eligible only after the hold is explicitly released or a user-directed re-evaluation authorizes their use.
- FR-05.6: Duplicate delivery of the same scoped version key SHALL be idempotent; a semantically changed version SHALL have a new version key and SHALL not overwrite its predecessor.

### FR-06: Review Bundle lifecycle

- FR-06.1: The Review Bundle state set SHALL include `WORKING`, `READY_FOR_REVIEW`, `NEEDS_ATTENTION`, `STALE`, `PUBLISHING`, `PUBLISHED`, `PUBLISHED_WITH_ERRORS`, `DISCARDED`, and `FAILED`.
- FR-06.2: The contract SHALL define legal triggers and guards for preparation, reviewable completion, attention stop, explicit continuation/re-evaluation, remote-head staleness, explicit publication approval, publication completion, discard, and failure.
- FR-06.3: A bundle marked `STALE` SHALL remain inspectable and SHALL not become publishable without explicit re-evaluation or discard.
- FR-06.4: A bundle's terminal outcome and reason SHALL be immutable history; a later operation SHALL create a new association or continuation rather than rewrite the historical outcome.
- FR-06.5: The bundle lifecycle SHALL not infer state from AI prose, validation prose, UI visibility, or a notification delivery result.

### FR-07: Synchronization status overlay

- FR-07.1: Branch Synchronization SHALL use a separate result-state set containing at least `SKIPPED`, `MERGING`, `RESOLVING_CONFLICTS`, `READY_TO_PUBLISH`, `NEEDS_ATTENTION`, `STALE`, `PUBLISHING`, `PUBLISHED`, `DISCARDED`, and `FAILED`.
- FR-07.2: A synchronization result SHALL retain its PR identity, `prBaseBranch`, `prHeadBranch`, optional `syncSourceBranchOverride`, resolved `syncSourceBranch`, source/destination repository identities, `syncSourceSha`, `prHeadSha`, operation identity, worktree identity, current status, and deterministic reason data as separate fields from primary PR state; the repository API's `default_branch` SHALL not replace the recorded PR base branch or explicit override.
- FR-07.3: Clean merge, conflict resolution, validation, stale detection, retry, discard, and publication shall have explicit status triggers; a synchronization state change SHALL not implicitly change the PR's primary review state.
- FR-07.4: A selected PR that is ineligible or excluded SHALL produce `SKIPPED` with a reason that identifies what happened, why it matters, and what the user can do next.
- FR-07.5: A synchronization result SHALL be independently recoverable and reviewable after UI closure or restart; one result's failure SHALL not transition another result in the same batch.
- FR-07.6: The status contract SHALL distinguish a clean deterministic merge from a conflict-resolution path so a clean merge cannot accidentally imply AI usage.
- FR-07.7: Stale synchronization results SHALL be non-publishable until explicit re-evaluation or discard.
- FR-07.8: The overlay SHALL not add `PAUSED` or synchronization statuses to the primary PR state set; global pause SHALL be an application-level overlay.

### FR-08: Publication phases and idempotency

- FR-08.1: A publication record SHALL include a stable idempotency key, current phase, owning result/bundle identity, explicit approval reference, recovery status, commit SHA when known, and per-response publication state/remote ID when applicable.
- FR-08.2: The publication phase set SHALL include `NOT_STARTED`, `APPROVAL_REQUIRED`, `PREPARING`, `COMMITTING`, `PUSHING`, `POSTING_RESPONSES`, `RECOVERING`, `PUBLISHED`, `PUBLISHED_WITH_ERRORS`, `DISCARDED`, and `FAILED`.
- FR-08.3: No publication side effect SHALL be authorized by a domain transition from `APPROVAL_REQUIRED` without an explicit human approval record; no domain contract SHALL grant an AI provider publication authority.
- FR-08.4: The contract SHALL distinguish pre-side-effect rejection from an uncertain outcome after a commit, push, or response attempt; an uncertain outcome SHALL enter `RECOVERING` or a reconciled terminal result.
- FR-08.5: A known commit SHA or remote response ID SHALL be retained and reused for reconciliation; it SHALL not be replaced by a new value merely because a caller retries.
- FR-08.6: A publication retry SHALL be idempotent per idempotency key and SHALL reject a second active publication for the same approved result.
- FR-08.7: `PUBLISHED_WITH_ERRORS` SHALL represent a committed/pushed outcome whose approved response reconciliation is incomplete; it SHALL not authorize a second code publication.
- FR-08.8: Publication phase changes SHALL never request or imply force push, automatic rebase, partial patch acceptance, or autonomous publication.
- FR-08.9: Publication phase and history SHALL remain inspectable across UI closure, process restart, sleep, and network interruption.

### FR-09: Overlay and concurrency rules

- FR-09.1: Global `PAUSED` SHALL be represented as an application-level monitoring flag/overlay and SHALL not replace or compete with the primary PR, Review Bundle, synchronization, or publication state machines.
- FR-09.2: An explicitly user-started synchronization MAY continue while global watching is paused; pause SHALL block new automatic review dispatches but SHALL not silently cancel that synchronization.
- FR-09.3: A synchronization operation MAY coexist with a PR in `READY_FOR_REVIEW` or `NEEDS_ATTENTION` without mutating that primary state or the held Review Bundle worktree.
- FR-09.4: Concurrent actions that race for one state-machine owner SHALL be resolved deterministically: one legal transition wins according to the persisted version/lock supplied by the caller, and the loser receives a conflict/retry reason without a compensating transition.
- FR-09.5: Renderer commands SHALL be treated as requests; the domain contract SHALL not depend on renderer lifetime or renderer-owned mutable state.

### FR-10: Versioned serialization and historical records

- FR-10.1: Every serialized contract family SHALL carry an explicit schema version and SHALL reject unsupported versions rather than reinterpret them.
- FR-10.2: Historical state, reason, phase, hold, and event-association records SHALL be append-only from the domain's perspective; current projections MAY be derived but SHALL not replace history.
- FR-10.3: State transitions SHALL carry a safe trigger/action identifier, actor kind, prior state, next state, timestamp, correlation/operation identity, and reason where applicable.
- FR-10.4: State and association records SHALL preserve immutable snapshot references such as bundle ID, event-version ID, `prBaseSha`, `prHeadSha`, `worktreeBaselineSha`, synchronization SHAs, idempotency key, and worktree identity instead of depending only on mutable remote IDs; F02 defines the references and stale guards, while later worktree/publication features own diff calculation and external effects.

### FR-11: Deterministic conformance surface

- FR-11.1: The domain package SHALL expose pure parsers, validators, transition reducers, guard predicates, reason constructors, and idempotency helpers without importing Electron, React, SQLite, Git, GitHub, an AI SDK, or an operating-system adapter.
- FR-11.2: The transition tables SHALL be executable/testable data or equivalent exhaustive contract definitions so every accepted trigger and rejected trigger has deterministic evidence.
- FR-11.3: The conformance suite SHALL cover valid transitions, illegal transitions, duplicate delivery, concurrent admission, hold persistence, pause overlays, stale results, cancellation, restart recovery, and uncertain publication outcomes.
- FR-11.4: Later persistence and workflow features SHALL be able to consume the same contracts for review and synchronization paths without redefining state names, reasons, or publication idempotency rules.

## Non-Functional Requirements

- **NFR-01: Determinism** - Given the same serialized input, injected clock, prior state, and action, the domain SHALL produce the same result, reason, and next-state decision without AI or external-service access.
- **NFR-02: Serialization and compatibility** - Public records SHALL be JSON-serializable, schema-versioned, explicit about enums, and reject unknown security-sensitive or semantically ambiguous values.
- **NFR-03: Restart and retry safety** - State decisions SHALL be safe to replay from persisted history; retries SHALL be idempotent where the contract declares an idempotency key and SHALL never reset a consumed operation or release a hold by accident.
- **NFR-04: Security** - Domain records, errors, and reasons SHALL be safe to log, persist, send through validated IPC later, and display without containing credentials, prompts, raw SDK objects, or uncontrolled environment data.
- **NFR-05: Provider and platform neutrality** - The domain package SHALL run in the main process and renderer-safe shared contexts and SHALL not require GitHub, AI-provider, OS, database, or Electron behavior.
- **NFR-06: Diagnosability** - Every rejected action and user-actionable state SHALL have a stable code, category, correlation reference when available, and next-action classification; free-form prose SHALL not be the only evidence.
- **NFR-07: Maintainability** - Adding a provider, notification surface, or persistence implementation SHALL not require changing the state vocabulary or transition semantics.
- **NFR-08: Bounded complexity** - The MVP SHALL keep one small primary PR state machine and separate overlays rather than introducing a product-wide composite state with every operation dimension.

## Invariants

- **INV-01:** Deterministic software owns identifiers, clocks, parsing, equality, state transitions, retries, hold admission, and publication-phase decisions; AI is never required to choose a domain state.
- **INV-02:** The Electron main process and durable repositories are authoritative for mutable application state; renderer code can request a transition but cannot authoritatively mutate a state machine.
- **INV-03:** Provider SDK types, provider conversation references, prompts, and provider errors remain outside provider-neutral domain records except for explicitly opaque, redacted metadata fields.
- **INV-04:** A PR in `READY_FOR_REVIEW` or `NEEDS_ATTENTION` has an automatic review hold that survives UI closure, application restart, sleep, and notification/navigation changes.
- **INV-05:** A handled event-version association is append-only and cannot be undone by publishing, discarding, retrying, or changing settings; new versions observed during a hold remain distinct.
- **INV-06:** At most one automatic Review Bundle and one automatic review AI Work Operation may be active for a PR; no concurrent automatic worktree mutation is admitted.
- **INV-07:** Global pause and Branch Synchronization are overlays; they never replace, broaden, or silently mutate the primary PR review state.
- **INV-08:** No publication phase or domain result grants commit, push, GitHub-response, merge, or force-push authority; those effects require later deterministic services and explicit human approval.
- **INV-09:** An uncertain publication outcome cannot transition directly to a fresh side-effect phase without deterministic reconciliation using the existing idempotency key and known remote identifiers.
- **INV-10:** Historical transitions, terminal outcomes, reasons, and immutable snapshot references remain inspectable and are never rewritten to make a later retry appear to have been the original operation.

## Out of Scope

- SQLite schemas, migrations, transactions, backups, and durable repository implementations - F03.
- Electron lifecycle, validated IPC, renderer windows, tray behavior, notifications, deep links, and virtual desktops - F04 and F19.
- GitHub authentication, REST calls, polling, remote event normalization, pagination, event filtering, and batching - F05-F12.
- Git worktrees, file snapshots, Git diffs, validation process execution, and actual publication side effects - F13-F14 and F23-F28.
- AI-provider contracts, Codex adapter behavior, prompts, structured semantic output, task profiles, execution policies, and bounded AI turns - F15-F17.
- Review Bundle screens, synchronization confirmation UI, accessibility rendering, and notification copy; later features consume the reason data and own presentation.
- Autonomous publication, force push, automatic rebase, partial patch acceptance, webhook delivery, or any other MVP non-goal in the application overview.

## Product Decisions

- **PD-01: Keep the primary PR state small** - The MVP uses only `WATCHING`, `WORKING`, `READY_FOR_REVIEW`, and `NEEDS_ATTENTION`; bundle, synchronization, publication, and pause dimensions remain separate so users can understand what needs action.
- **PD-02: A hold is an explicit product concept** - `READY_FOR_REVIEW` and `NEEDS_ATTENTION` stop new automatic analysis and worktree mutation even when the user has not opened the window; only an explicit outcome releases the hold.
- **PD-03: New feedback is never folded into active work** - Feedback discovered during active work or a hold is retained as a separate immutable version and is considered later through an explicit workflow.
- **PD-04: Uncertain side effects are recoverable states** - The application treats an unavailable response after a possible commit, push, or response as a reconciliation problem rather than as permission to repeat the side effect.
- **PD-05: Status labels are not explanations** - Every user-actionable domain outcome includes structured reason data for what happened, why it matters, and what can happen next; later UIs may localize the display.

## Implementation Decisions

- **IMP-01: Shared pure domain module** - Implement the contract in the F01 shared TypeScript boundary, proposed as `apps/desktop/src/shared/domain`, with no imports from platform, provider, persistence, Git, or UI modules.
- **IMP-02: Schema-first serialized records** - Use explicit discriminated unions and runtime validation for records crossing process or persistence boundaries. Unknown state/phase/reason values fail closed.
- **IMP-03: Injected time** - Expose a small `Clock` contract to domain functions; production infrastructure supplies the clock and tests supply a fixed clock. Domain code never calls `Date.now()` directly.
- **IMP-04: Pure reducers plus explicit guards** - State transitions return a new state/result and transition event. They do not perform persistence, network, Git, AI, notification, or publication work; callers commit the returned event transactionally in later features.
- **IMP-05: Append-only associations** - Event-version handling and transition history use monotonic association/outcome records. A current-state projection may be rebuilt from them, but a retry cannot rewrite earlier history.
- **IMP-06: Idempotency is part of the contract** - Publication and duplicate event operations require stable keys and return the prior known outcome when the same key is replayed; a caller must not generate a new key merely because it restarted.

## Testing Decisions

- **TST-01: Test deep deterministic modules** - Focus on ID/time codecs, safe result/reason constructors, primary PR reducer, hold admission, event-version association, Review Bundle reducer, synchronization overlay reducer, and publication phase reducer.
- **TST-02: Use table-driven and property-style transition tests** - Every legal transition, illegal transition, duplicate action, replay, and overlay interaction is represented in executable tables; no model judgment is used to determine expected state.
- **TST-03: Exercise lifecycle boundaries without external systems** - Simulate renderer closure, restart, cancellation, sleep, stale SHAs, duplicate delivery, and unknown publication outcomes using serialized fixtures and injected clocks; do not call SQLite, GitHub, Git, an AI provider, or the OS.
- **TST-04: Verify security and compatibility** - Scan serialized success/error/reason records for secret-shaped values and forbidden object types, test unknown versions/fields, and prove that historical records round-trip without reinterpretation.
- **TST-05: Defer presentation and side-effect tests** - UI rendering, database transactions, process lifetime, Git behavior, network reconciliation, and publication are covered by owning downstream features; F02 tests only the contracts those features consume.

## Proposed Modules

- **MOD-01: Domain identifier and instant codecs** - Validates provider-neutral IDs, UTC instants, durations, schema versions, and safe serialization primitives.
- **MOD-02: Domain result and reason model** - Creates discriminated success/error results and user-actionable machine-readable reasons without secrets or uncontrolled exception data.
- **MOD-03: Primary PR state reducer** - Owns the four-state review lifecycle, explicit triggers, admission guards, and per-PR hold acquisition/release decisions.
- **MOD-04: Review hold and event-association reducer** - Owns automatic-work exclusivity, immutable event-version associations, handled-history monotonicity, and retained-during-hold behavior.
- **MOD-05: Review Bundle reducer** - Owns legal bundle transitions, stale handling, terminal history, and the boundary between review outcome and publication approval.
- **MOD-06: Synchronization overlay reducer** - Owns per-PR synchronization result statuses, independence from primary PR state, and actionable reason requirements.
- **MOD-07: Publication phase reducer** - Owns approval gates, idempotency keys, recovery/uncertain-outcome states, response reconciliation status, and no-force-push semantics.
- **MOD-08: Contract conformance tables** - Exposes transition definitions and fixtures used by later persistence, orchestration, and workflow tests.

## Workflows

### Workflow 1: Automatic review hold

```text
1. A managed PR is WATCHING and has no active automatic operation or hold.
2. Deterministic scheduling requests an eligible automatic review.
3. The primary reducer accepts WATCHING -> WORKING and records the operation identity.
4. The operation reaches a reviewable result or a blocking stop.
5. The reducer transitions WORKING -> READY_FOR_REVIEW or NEEDS_ATTENTION and acquires the bundle-linked hold.
6. New feedback is retained separately; background automatic analysis requests are rejected.
7. An explicit continue/retry/re-evaluate action may start a bounded continuation.
8. Successful publication, published-with-errors completion, or discard releases the hold and returns the PR to WATCHING.
```

### Workflow 2: Held feedback and handled association

```text
1. Polling observes an immutable event version while a PR is WORKING or held.
2. The event version is stored separately from the active operation/bundle.
3. A bundle claims each input version at most once.
4. Publication or discard marks claimed versions HANDLED_BY_BUNDLE without deleting their history.
5. Re-delivery of the same version returns the existing association; a changed semantic snapshot has a new version key.
6. After the hold is explicitly released, retained versions may enter a later eligibility/batching workflow.
```

### Workflow 3: Synchronization overlay and publication recovery

```text
1. A user-directed synchronization creates its own result state while the PR primary state remains unchanged.
2. The result moves through MERGING, optional RESOLVING_CONFLICTS, validation, and READY_TO_PUBLISH or NEEDS_ATTENTION.
3. Explicit approval moves publication from APPROVAL_REQUIRED to PREPARING and then through the appropriate side-effect phases.
4. A lost response after a possible side effect moves the publication to RECOVERING with the same idempotency key.
5. Deterministic reconciliation uses known commit SHAs and remote response IDs to reach PUBLISHED, PUBLISHED_WITH_ERRORS, or FAILED.
6. A retry never creates a second side effect solely because the previous process was interrupted.
```
