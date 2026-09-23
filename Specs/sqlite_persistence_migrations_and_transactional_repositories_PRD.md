# F03 SQLite Persistence, Migrations, and Transactional Repositories - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F01 - Application workspace and engineering foundation | Supplies the supported Electron/Node runtime, main-process composition boundary, test harness, and upgrade-safe application data-path input. |
| 2 | F02 - Domain contracts and deterministic state machines | Supplies provider-neutral identifiers, states, holds, transition records, immutable references, reason data, and publication idempotency semantics that persistence must store without reinterpretation. |
| 3 | F00 - Deterministic validation configuration contract | Supplies the versioned validation-profile, approval, snapshot, and result shapes that must be persisted for later validation execution. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F04 - Persistent Electron shell, IPC boundary, and Windows virtual-desktop spike | Uses the main-process persistence service for startup recovery and validated renderer reads/commands without making the renderer authoritative. |
| 2 | F05-F12 - GitHub setup and deterministic monitoring | Stores server metadata, managed PRs, resource checkpoints, immutable remote-event versions, eligibility associations, batches, and review holds. |
| 3 | F13-F14 - Git/worktree and validation execution | Stores operation-owned worktree identity, immutable baselines, validation snapshots, command results, and manual-test evidence. |
| 4 | F15-F17 - AI platform and bounded work controller | Stores provider-neutral operation, segment, turn, conversation, usage, policy/profile snapshots, budgets, reports, and stop reasons. |
| 5 | F18-F23 - Review preparation and publication | Stores Review Bundles, immutable item associations, diffs, approvals, publication phases, idempotency keys, and response outcomes. |
| 6 | F24-F27 - Managed PR branch synchronization | Stores independent synchronization batches/results, branch and SHA snapshots, conflict evidence, validation, and merge publication state. |
| 7 | F09/F19-F22/F28-F30 - Diagnostics, UI, lifecycle recovery, security, and release | Reads durable projections and recovery markers; presents actionable errors without treating free-form logs as state. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-14 | FR-03.1-FR-03.7, FR-05.1-FR-05.7, INV-02-INV-04 | AC-04-AC-06 | Shared enabler: F03 owns atomic Review Bundle records and restart-safe storage; F18 owns preparation semantics and user-visible bundle behavior. |
| APP-AC-71 | FR-04.4-FR-05.6, FR-06.1-FR-06.6, INV-02-INV-04 | AC-04-AC-06 | Shared enabler: F03 persists proposal-stage read-only evidence and the durable boundary before implementation; F18/F20 own execution policy and UI enforcement. |
| APP-AC-72 | FR-04.4-FR-05.6, FR-08.1-FR-08.6, INV-03-INV-05 | AC-04-AC-09 | Shared enabler: F03 persists per-item decisions, question answers, and replay-safe history; F18/F20/F21 own decision validation and presentation. |
| APP-AC-77 | FR-04.4-FR-04.7, FR-06.5-FR-06.6, INV-02-INV-04 | AC-10-AC-12, AC-14 | Shared enabler: F03 persists merge-base/both-side conflict evidence, ambiguity/user-consultation records, and restart-safe reasons; F26/F27 own resolution semantics and presentation. |
| APP-AC-24 | FR-04.1-FR-04.7, FR-05.1-FR-05.7, INV-03, INV-05 | AC-07-AC-09 | Shared enabler: F03 owns durable immutable event-version associations and handled-history retention; F11/F18/F23 own eligibility and outcome integration. |
| APP-AC-49 | FR-04.4-FR-04.7, FR-06.1-FR-06.5, FR-07.1-FR-07.8, INV-02-INV-04 | AC-10-AC-12 | Shared enabler: F03 owns complete synchronization-result persistence and restart-safe repository reads; F24-F27 own resolution, presentation, and external Git effects. |
| APP-AC-55 | FR-06.1-FR-06.6, INV-02, INV-04 | AC-13-AC-14 | Shared enabler: F03 owns durable turn-budget and timeout evidence; F17 owns the bounded controller and enforcement behavior. |
| APP-AC-64 | FR-06.1-FR-06.6, INV-01, INV-06 | AC-15 | Shared enabler: F03 owns provider-neutral persisted execution metadata and immutable snapshots; F15-F17 own adapter and invocation behavior. |
| APP-AC-68 | FR-07.1-FR-07.8, FR-08.1-FR-08.6, INV-03-INV-05 | AC-16-AC-17 | Shared enabler: F03 owns publication intent, phase, idempotency, response, and recovery records; F23/F27/F28 own deterministic side effects and reconciliation. |
| APP-AC-69 | FR-04.1-FR-04.3, FR-05.1-FR-05.7, INV-03, INV-05 | AC-07-AC-09 | Shared enabler: F03 owns immutable storage and uniqueness constraints; F10/F11 own remote observation and semantic content hashing. |

## Executive Summary

PRMonitor must remain useful after the window is closed, the computer sleeps, the process restarts, or a network operation returns an uncertain result. That requires one durable, authoritative record of the application’s intent, observed remote inputs, local work, state transitions, validation evidence, AI usage, and publication progress. Without a transactional persistence contract, a crash could leave a review event handled without a bundle, spend an AI turn without recording it, publish code twice, or make a synchronization result impossible to review.

F03 establishes the local SQLite persistence contract and the main-process repositories that implement it. It creates a versioned schema, applies migrations atomically, verifies backups and database integrity, and exposes typed transaction boundaries for later deterministic services. Immutable remote-event versions, snapshots, transition history, operation evidence, publication intents, and response outcomes remain inspectable; current-state projections are only conveniences that can be rebuilt from durable history.

The feature is an application foundation rather than a new user workflow. Later features own polling, Git, AI, validation execution, UI, and external publication. They consume F03 repositories to persist intent before an external side effect, commit related records atomically, recover after restart, and enforce uniqueness/concurrency rules without storing credentials or provider SDK objects in SQLite.

## User Stories

### Trustworthy restart and upgrade

- **US-01:** **GIVEN** a new installation, **WHEN** PRMonitor starts, **THEN** it creates the current local schema and can read/write a health record without requiring GitHub, AI, or renderer availability.
  - **Acceptance Criteria:** AC-01, AC-03.
- **US-02:** **GIVEN** an older supported database, **WHEN** PRMonitor upgrades it, **THEN** each versioned migration runs in order, the pre-migration backup is verified, and no partially applied schema is exposed.
  - **Acceptance Criteria:** AC-02, AC-03, AC-18.
- **US-03:** **GIVEN** a migration or integrity check cannot be completed safely, **WHEN** startup reaches persistence initialization, **THEN** the application preserves the source database, records a safe diagnostic, and presents an actionable recovery state rather than starting with an empty database.
  - **Acceptance Criteria:** AC-03, AC-18.

### Durable review and operation history

- **US-04:** **GIVEN** review feedback versions and a staged Review Bundle, **WHEN** the bundle is committed, **THEN** its immutable inputs, proposal/final stage, per-item human decisions, snapshots, items, state, and handled associations are available together after restart or renderer closure.
  - **Acceptance Criteria:** AC-04-AC-09.
- **US-05:** **GIVEN** the same immutable feedback version or idempotency key is delivered again, **WHEN** a repository receives it, **THEN** the existing durable record is returned and no duplicate association or side effect intent is created.
  - **Acceptance Criteria:** AC-07-AC-09, AC-16-AC-17.
- **US-06:** **GIVEN** a synchronization result or AI Work Operation is in progress, **WHEN** the user closes the window or the process restarts, **THEN** its exact branch/SHA/worktree, budget, usage, reports, validation, reason, and current phase remain inspectable.
  - **Acceptance Criteria:** AC-10-AC-15.

### Safe transactional effects

- **US-07:** **GIVEN** a later feature is about to invoke Git, validation, an AI provider, or publication, **WHEN** it creates the operation intent, **THEN** the intent and its immutable input snapshot are durable before the external effect is allowed to start.
  - **Acceptance Criteria:** AC-05, AC-10, AC-13-AC-17.
- **US-08:** **GIVEN** two main-process actions race to update the same owner, **WHEN** both try to commit, **THEN** exactly one valid version wins and the other receives a deterministic conflict result without overwriting history.
  - **Acceptance Criteria:** AC-06, AC-08, AC-16.
- **US-09:** **GIVEN** a database write is cancelled or fails before commit, **WHEN** the caller retries or reads the state, **THEN** no partial collection of records is visible; a transaction that committed remains committed and is reconciled rather than rolled back by a later cancellation.
  - **Acceptance Criteria:** AC-05, AC-06, AC-09, AC-17.

### Security and inspectability

- **US-10:** **GIVEN** a persisted record contains provider, GitHub, validation, or activity data, **WHEN** it is serialized or returned to a consumer, **THEN** it contains only validated provider-neutral data, redacted safe diagnostics, and opaque references where applicable.
  - **Acceptance Criteria:** AC-15, AC-19.
- **US-11:** **GIVEN** a user or later feature needs to understand an operation, **WHEN** it reads the repository, **THEN** it can distinguish current state from immutable history and can identify what failed, why it matters, and what action remains.
  - **Acceptance Criteria:** AC-04, AC-10-AC-18.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** an empty application data directory and a supported runtime, **WHEN** the persistence service initializes, **THEN** it creates exactly one current schema with the required foreign keys, uniqueness constraints, migration ledger, and health metadata, and a representative write/read round trip succeeds without contacting a product service.
- **AC-02:** **GIVEN** a supported older schema version, **WHEN** startup upgrades it, **THEN** migrations execute once in ascending order inside the migration transaction, each applied migration records its ID and checksum, and a second startup performs no duplicate migration.
- **AC-03:** **GIVEN** a migration, backup, or integrity check fails, **WHEN** initialization handles the failure, **THEN** the pre-operation database remains recoverable, the application does not silently create a replacement database or report healthy startup, and a machine-readable reason identifies the failed stage and next recovery action.
- **AC-04:** **GIVEN** a Review Bundle requires a batch, immutable event-version inputs, item associations, snapshots, state, and a hold, **WHEN** the bundle repository commits it, **THEN** all required records become visible together or none do, and a restart can reconstruct the same bundle and held state.
- **AC-05:** **GIVEN** a later service has an external operation to perform, **WHEN** it requests persistence, **THEN** F03 provides a transaction that records the operation intent, immutable input/configuration snapshot, owner/version, and correlation identity before the caller is permitted to launch the external effect.
- **AC-06:** **GIVEN** a transaction contains multiple related writes and one validation, constraint, or injected database error occurs before commit, **WHEN** the transaction ends, **THEN** no subset of those writes is visible; a committed transaction is never made to appear uncommitted by cancellation or process closure.
- **AC-07:** **GIVEN** two observations have the same scoped immutable remote-event identity and content hash, **WHEN** they are stored, **THEN** one event-version record exists and repeated insertion returns the existing record; a changed semantic snapshot creates a new immutable version without overwriting the predecessor.
- **AC-08:** **GIVEN** a handled event-version association, state transition, or operation update is replayed after restart, **WHEN** the repository applies it, **THEN** the association/history remains append-only, duplicate replay is idempotent, and an optimistic-concurrency loser receives a conflict result rather than replacing the winner.
- **AC-09:** **GIVEN** a process stops during a transaction, **WHEN** the database is reopened, **THEN** SQLite recovery exposes either the pre-transaction or fully committed state, never a half-written aggregate; durable in-flight operation records remain available for the owning feature’s startup reconciliation.
- **AC-10:** **GIVEN** a synchronization operation reaches any status, **WHEN** its result is persisted, **THEN** the record retains PR identity, base/head and resolved source branches, source/destination repositories, exact `syncSourceSha`/`prHeadSha`/`syncMergeBaseSha`, worktree, status, reasons, source-side and PR-head-side conflict evidence, diff metadata, validation evidence, and associated AI operation when present.
- **AC-11:** **GIVEN** a synchronization batch contains multiple PR results, **WHEN** one result fails or is retried, **THEN** the repository updates only that result and preserves independent statuses, histories, and reviewability for every other result.
- **AC-12:** **GIVEN** a persisted result has an actionable status, **WHEN** a consumer reads it, **THEN** structured reason data includes what happened, why it matters, and the allowed next action; free-form logs are not required to reconstruct the result.
- **AC-13:** **GIVEN** an AI Work Operation segment is about to start, **WHEN** its record is created, **THEN** the configured and consumed turn budget, task profile, execution-policy snapshot, operation scope, input snapshot, and owner/version are durable before the first provider turn, and renderer closure cannot reset the consumed count.
- **AC-14:** **GIVEN** an AI Work Turn completes, times out, or fails, **WHEN** its evidence is stored, **THEN** the turn report, deterministic file/command activity, validation results, progress classification, state fingerprint, stop reason, timestamps, and usage metadata are committed exactly once and remain linked to the parent operation.
- **AC-15:** **GIVEN** AI, validation, or provider-specific records are stored, **WHEN** a consumer serializes them, **THEN** they contain provider-neutral IDs and validated scalar/structured data, immutable task-profile/policy snapshots, safe opaque conversation references, and no SDK instances, prompts, GitHub credentials, AI credentials, or uncontrolled environment values.
- **AC-16:** **GIVEN** a user approves a Review Bundle or synchronization result, **WHEN** publication preparation begins, **THEN** a publication intent with stable idempotency key, approval reference, expected SHAs, exact proposed result, current phase, and per-response pending state is committed before any commit, push, or response request.
- **AC-17:** **GIVEN** publication or response delivery may have succeeded before a process/network failure, **WHEN** a later feature reopens the record, **THEN** known commit SHAs and remote response IDs remain available, the phase is recoverable, retry uses the same idempotency identity, and a pushed commit with unresolved responses is representable as `PUBLISHED_WITH_ERRORS` without authorizing a second code publication.
- **AC-18:** **GIVEN** the database path is replaced by an unreadable, corrupt, unsupported, or checksum-mismatched file, **WHEN** startup performs the integrity check, **THEN** it refuses normal product work, does not delete or overwrite the file, and reports a safe recovery instruction referencing the verified backup or support-diagnostics path.
- **AC-19:** **GIVEN** a persistence error, backup name, migration diagnostic, or serialized record is emitted, **WHEN** it crosses the repository boundary, **THEN** credentials, API keys, tokens, raw SQL values marked sensitive, local secret-bearing environment values, and provider prompts are absent or redacted.

## Functional Requirements

### FR-01: Main-process persistence authority

- FR-01.1: The application SHALL use one local SQLite database as the authoritative source for mutable application state and durable operation history in the MVP.
- FR-01.2: The persistence service SHALL be owned by the Electron main process and SHALL expose typed repository/transaction contracts rather than a renderer-owned database connection or mutable renderer cache.
- FR-01.3: The database path SHALL be supplied by the application data-path owner, SHALL be stable across ordinary restarts and upgrades, and SHALL not be derived from a renderer request, PR URL, worktree path, or unvalidated user-controlled filename.
- FR-01.4: Persistence SHALL operate without GitHub, an AI provider, a renderer window, or a network connection once its database path and runtime prerequisites are available.
- FR-01.5: Provider SDK objects, GitHub clients, Git processes, Electron objects, prompts, credentials, and platform-specific handles SHALL not be accepted as authoritative repository values.

### FR-02: Versioned schema and migration lifecycle

- FR-02.1: The schema SHALL have an explicit integer version and a migration ledger containing migration ID, ordered version, checksum, applied timestamp, and application build/schema metadata.
- FR-02.2: Each migration SHALL be deterministic, forward-only, individually identified, checksum-verified, and applied in ascending order inside a transaction that leaves no partially applied schema visible.
- FR-02.3: Before an upgrade changes the live database, the persistence service SHALL create and verify a recoverable pre-migration backup using an application-owned path and a non-secret diagnostic identity.
- FR-02.4: If backup creation, backup verification, migration, checksum verification, or post-migration integrity checking fails, the service SHALL preserve the original database and refuse normal product startup until the owning lifecycle feature presents recovery or retry options.
- FR-02.5: Migrations SHALL preserve existing durable records unless an approved schema contract explicitly transforms them; they SHALL not silently discard history, replace unknown records with defaults, or create a blank database as fallback.
- FR-02.6: Startup SHALL run SQLite integrity and foreign-key checks after initialization or upgrade and SHALL expose a structured health result with stage, reason, database identity, and recommended next action.
- FR-02.7: Migration and backup artifacts SHALL use bounded retention and ownership markers so cleanup cannot target the live database, a worktree, or an unrelated user path.

### FR-03: Transaction and repository contract

- FR-03.1: The persistence service SHALL provide explicit read and write transaction boundaries with commit, rollback, and deterministic error results; callers SHALL not compose unrelated writes through ad hoc SQL.
- FR-03.2: A transaction SHALL be able to commit all records required for one domain decision, including current projections, transition history, immutable snapshots, associations, reasons, and operation intent, or commit none of them.
- FR-03.3: A write transaction SHALL validate domain/schema records before commit and SHALL surface uniqueness, foreign-key, serialization, busy/locked, corruption, and cancellation outcomes as stable machine-readable reasons.
- FR-03.4: Repositories SHALL use parameterized statements and validated codecs for all values; dynamic table/column identifiers SHALL come only from internal migration/repository definitions.
- FR-03.5: Repository reads SHALL expose current projections and immutable history separately so a projection can be rebuilt without rewriting source history.
- FR-03.6: A successful commit SHALL be the only authority that tells a caller a durable intent or state change exists; cancellation after commit SHALL not issue a compensating delete or pretend the commit did not happen.
- FR-03.7: The transaction contract SHALL allow a caller to persist intent, snapshot mutable inputs, and receive a committed correlation/operation identity before an external side effect begins.

### FR-04: Durable record families

- FR-04.1: Persistence SHALL store application settings, validation profiles/approvals, Common Instruction profiles, AI task-profile revisions, and execution-policy presets without storing their secret values.
- FR-04.2: Persistence SHALL store GitHub server metadata, repositories, API/resource checkpoints, managed PR identity, branch/repository identity, intent/context, and current PR projection.
- FR-04.3: Persistence SHALL store immutable remote-event versions with scoped identity, semantic content hash, body/location/state snapshot, observed version metadata, and source/resource checkpoint references.
- FR-04.4: Persistence SHALL store review batches, Review Bundles, proposal/final stage, bundle items, immutable input/snapshot references, per-item human decisions and question answers, state transitions, holds, proposed responses, diff metadata, and handled-version associations.
- FR-04.5: Persistence SHALL store AI Work Operations, bounded segments, turns, conversations, provider-neutral profile/policy snapshots, usage metadata, turn reports, progress fingerprints, and machine-readable stop reasons.
- FR-04.6: Persistence SHALL store validation runs, command/manual-check snapshots and results, synchronization batches/results/conflicts, source-side and PR-head-side change evidence, exact source/head/merge-base SHA snapshots, worktree identities, publication records, per-response outcomes, and recovery markers.
- FR-04.7: Persistence SHALL store deterministic activity and audit events plus correlation references without making free-form log text the source of application state.

### FR-05: Immutability, snapshots, and idempotency

- FR-05.1: Every immutable event version, configuration snapshot, task-policy snapshot, validation snapshot, AI turn report, transition event, publication intent, and external-effect evidence record SHALL retain a schema version and immutable creation identity.
- FR-05.2: Remote-event versions SHALL be unique by their scoped source identity and semantic content hash, and a new semantic version SHALL never update or delete a prior version.
- FR-05.3: Review Bundle items SHALL refer to immutable event-version IDs and SHALL retain the association outcome, handled timestamp, and owning bundle identity independently of mutable remote object fields.
- FR-05.4: State transitions, hold acquisition/release, operation admission, publication phases, and terminal reasons SHALL be append-only history; current projections MAY point to the latest record but SHALL not erase prior records.
- FR-05.5: Records that require retry/idempotency SHALL have stable scoped keys with uniqueness constraints and a repository operation that returns the prior result for a safe duplicate replay.
- FR-05.6: Mutable inputs used by a result SHALL be snapshotted before the dependent operation starts, including remote event versions, SHAs, task profiles, execution policies, Common Instructions, PR Intent / Context, Build & Validation Instructions, per-item human decisions, and validation configuration.
- FR-05.7: A duplicate delivery or replay SHALL not create a second active operation, second handled association, second publication intent, or second per-response remote-effect record when the declared idempotency key already exists.

### FR-06: AI, validation, and synchronization evidence

- FR-06.1: An AI Work Operation SHALL persist its parent/scope, segment identity, task type, provider/model/reasoning settings, profile revision, execution-policy snapshot, configured budget, consumed count, and state before a provider turn can start.
- FR-06.2: Each AI Work Turn SHALL persist exactly one start/end lifecycle record and its normalized report, actual file/command observations, validation references, progress classification, state fingerprint, usage metadata, and stop/continue reason.
- FR-06.3: Provider conversation references and usage metadata SHALL be opaque, bounded, optional values; their absence SHALL not prevent deterministic application state from being reconstructed.
- FR-06.4: Validation records SHALL retain the F00 effective-profile snapshot, authorization/content hash, worktree/revision identity, command/manual outcomes, bounded redacted output metadata, and explicit `passed`, `failed`, `not_run`, or `interrupted` status.
- FR-06.5: A synchronization result SHALL be stored independently for each PR and SHALL retain branch/repository identities, exact source/head/merge-base SHAs, source-side and PR-head-side merge/conflict evidence, worktree, diff metadata, validation, AI association and user-consultation records when present, current status, and structured reason data.
- FR-06.6: A persisted AI or validation record SHALL never be considered successful solely because a model or provider claims success; repository data SHALL preserve deterministic observations separately from model-reported text.
- FR-06.7: AI operation/turn/conversation writes SHALL enter F03 only through the versioned provider-neutral handoff defined by F15. F03 SHALL never accept Codex SDK objects, provider thread instances, raw prompts, credentials, or uncontrolled environment values, and F17 SHALL use F03's transaction boundary before authorizing the provider effect.

### FR-07: Publication and uncertain-outcome persistence

- FR-07.1: A publication record SHALL persist the owning bundle/result, explicit human approval reference, stable idempotency key, expected baseline/source/head identities, exact proposed result reference, current phase, and recovery status before any external publication effect.
- FR-07.2: Each approved response SHALL have its own pending/posted/failed state, idempotency identity, attempt metadata, and remote ID when known, independent of code publication state.
- FR-07.3: Publication records SHALL retain known commit SHA, push/reconciliation evidence, and response remote IDs across process restart, UI closure, and network interruption.
- FR-07.4: The repository SHALL represent an uncertain external outcome without rewriting the prior intent or creating a fresh idempotency key; later reconciliation SHALL be able to distinguish `PUBLISHED_WITH_ERRORS` from pre-side-effect failure.
- FR-07.5: A publication retry SHALL be rejected or return the existing active record when another publication for the same approved result/idempotency key is active or already reconciled.
- FR-07.6: Persistence SHALL not expose an operation that grants an AI provider commit, push, response, approval, merge, or force-push authority.
- FR-07.7: Publishing a synchronization result and marking older Review Bundles stale SHALL be recorded as separate durable facts so history is preserved even if later reconciliation fails.
- FR-07.8: A publication record SHALL be recoverable by deterministic services without requiring the renderer, provider thread, or an in-memory process-local lock.

### FR-08: Concurrency, restart, and safe diagnostics

- FR-08.1: Mutable aggregate updates SHALL use a persisted version, owner, or equivalent compare-and-swap guard so a stale caller cannot overwrite a newer state transition or release a hold accidentally.
- FR-08.2: The repository SHALL enforce F02 constraints for one automatic Review Bundle/AI operation per PR, separate synchronization overlays, held-feedback retention, and monotonic handled associations.
- FR-08.3: Database reopen after process termination SHALL preserve all committed records and expose durable in-flight records to the owning startup-reconciliation feature without automatically authorizing a new AI segment or publication side effect.
- FR-08.4: Database busy/locked retries SHALL be bounded and deterministic; an exhausted retry SHALL return an actionable persistence error rather than dropping a write or duplicating it.
- FR-08.5: Persistence errors, migration diagnostics, and repository results SHALL use safe reason codes, correlation IDs, and bounded detail; raw SQL, secret values, provider prompts, and uncontrolled exception objects SHALL not cross the boundary.
- FR-08.6: Backup, restore, migration, integrity, and repository fixtures SHALL be safe to cancel and rerun without deleting the live database or silently changing committed application history.

## Non-Functional Requirements

- **NFR-01: Durability** - A successful commit SHALL survive renderer destruction and ordinary process restart; the repository SHALL not report success before the database has acknowledged the commit under the selected durability settings.
- **NFR-02: Atomicity** - Related records required to explain one domain decision SHALL become visible together or not at all, including transition/history and current-projection updates.
- **NFR-03: Determinism** - The same schema version, serialized input, transaction request, and prior committed state SHALL produce the same validation, idempotency, conflict, and reason outcome without AI or network access.
- **NFR-04: Recovery** - Migration, backup, integrity, busy/locked, process-stop, and uncertain-outcome failures SHALL leave a bounded, actionable recovery record and SHALL never silently reset application state.
- **NFR-05: Compatibility** - Historical records SHALL retain their schema version and original meaning; unsupported versions SHALL fail closed rather than be reinterpreted.
- **NFR-06: Security** - SQLite fields, repository errors, backups, and diagnostics SHALL not contain plaintext credentials, API keys, provider prompts, raw SDK objects, or uncontrolled environment values.
- **NFR-07: Performance and bounded resources** - Ordinary reads/writes and migration diagnostics SHALL use bounded statements, output, retry, and backup work; large immutable bodies and diagnostic fields SHALL have explicit size limits or bounded storage policies.
- **NFR-08: Testability** - The persistence boundary SHALL support injected clocks, temporary database paths, deterministic migration fixtures, fault injection at transaction boundaries, and repository fakes without product-service credentials.
- **NFR-09: Portability** - The schema and repository contracts SHALL remain provider-neutral and shall not encode Windows-only paths or Electron-only objects into shared domain records, while the MVP may use Windows-specific application-data path resolution in the main-process adapter.

## Invariants

- **INV-01:** The Electron main process and F03 repositories are authoritative for durable mutable state; renderer state, provider threads, activity text, and in-memory caches are never authoritative.
- **INV-02:** A related persistence decision is atomic: current projection, immutable snapshot, transition/history, reason, association, and operation intent required by that decision are committed together or none are committed.
- **INV-03:** Immutable remote versions, snapshots, transitions, terminal reasons, publication intents, and external-effect evidence are append-only and remain inspectable after retry, discard, publication, migration, or restart.
- **INV-04:** Intent and the mutable-input snapshot are durable before any later feature starts the external Git, validation, AI, GitHub, notification, or publication effect it represents.
- **INV-05:** Duplicate immutable input, association, operation, and publication keys are idempotent; a retry cannot create a second active operation, commit intent, handled association, or already-posted response record.
- **INV-06:** Provider SDK objects, credentials, prompts, GitHub tokens, raw environment values, and platform handles never become persisted application state; provider-specific data is limited to validated, bounded, opaque metadata.
- **INV-07:** Schema and migration versions are explicit; unsupported, corrupt, checksum-mismatched, or partially applied state fails closed and cannot be silently replaced with an empty database.
- **INV-08:** A stale optimistic-concurrency caller cannot overwrite a newer state, release a hold, change a terminal outcome, or replace a known external identifier without a deterministic conflict result.
- **INV-09:** Synchronization results, Review Bundles, AI operations, validation runs, publication records, and per-response outcomes remain independently reviewable; one result's failure cannot rewrite another result's history.
- **INV-10:** Backup and cleanup operations are ownership- and containment-checked and cannot target the live database, a worktree, or an unrelated user path.

## Out of Scope

- Electron window creation/destruction, validated IPC, tray behavior, notifications, deep links, and Windows virtual-desktop handling - F04 and F19.
- GitHub authentication, REST calls, polling, pagination, remote event collection, eligibility, batching, and remote content normalization - F05-F12.
- Git/worktree creation, diff calculation, process execution, validation command execution, and dirty-worktree choices - F13-F14 and later workflow features.
- AI-provider invocation, Codex SDK behavior, prompts, structured semantic output, task-profile resolution, execution-policy translation, and bounded-turn decisions - F15-F17.
- Review Bundle preparation semantics, inbox/review screens, conversations, notifications, user approval UX, publication side effects, and synchronization Git operations - F18-F27.
- Automatic startup reconciliation policy, sleep/network orchestration, threat-model hardening, installer/signing/update behavior, and full end-to-end release acceptance - F28-F30.
- Centralized storage, multi-user operation, web access, cloud synchronization, database replication, team dashboards, and any application-overview MVP non-goal.

## Product Decisions

- **PD-01: SQLite is the local MVP authority** - The product uses one local SQLite database per application data profile; no server or multi-user synchronization is introduced to solve local durability.
- **PD-02: Preserve history rather than rewrite it** - Users and later workflows must be able to explain what was observed, attempted, approved, and published, so immutable versions and transition/effect history remain available after terminal outcomes.
- **PD-03: Fail closed on unsafe upgrades** - If a pre-migration backup cannot be verified, or migration/integrity checks fail, PRMonitor does not start with empty/default state. It reports recovery instructions and preserves the source database.
- **PD-04: One result, one durable explanation** - A Review Bundle, synchronization result, AI operation, validation run, and publication attempt must be independently understandable without reconstructing state from free-form activity text.
- **PD-05: Persistence is not authorization** - Storing an approved publication intent or provider conversation reference never grants a provider or background worker authority to publish; later deterministic services enforce the approval boundary.
- **PD-06: Cancellation never invents rollback** - Cancellation before commit leaves no partial transaction; cancellation after commit reports the committed result for reconciliation rather than pretending a durable fact was undone.
- **PD-07: F03 is the durable authority for F15 handoffs** - F15 returns a serializable normalized turn result; F17 owns lifecycle and continuation decisions; F03 owns the transaction, repository, idempotency, and restart-safe durable record. No provider thread or adapter memory is authoritative.

## Implementation Decisions

- **IMP-01: Main-process persistence package** - Implement SQLite connection/bootstrap, migrations, transaction coordination, codecs, and repositories under the F01 main-process boundary, with renderer-safe DTO/schema definitions in shared code where later IPC requires them. No renderer code imports the SQLite driver.
- **IMP-02: Driver-neutral repository ports** - Define narrow repository interfaces and transaction ports around F02 domain records. Select the SQLite driver only after an Electron/Node compatibility spike proves transaction, WAL, backup, busy handling, and packaging behavior; changing the driver must not change the schema or repository contracts.
- **IMP-03: Safe SQLite defaults** - Enable foreign keys, a crash-safe journal configuration, bounded busy handling, and the strongest practical durability setting supported by the tested driver. Record the effective settings in health evidence and test them under process termination.
- **IMP-04: Migration ledger and checksums** - Keep ordered, versioned migration definitions with stable IDs and checksums. The runner verifies already-applied checksums, refuses edited historical migrations, and records the current schema only after the migration transaction and integrity check succeed.
- **IMP-05: Pre-migration backup** - Use the tested SQLite backup mechanism or an equivalent consistency-preserving copy while the database is in a safe state. Verify the backup by reopening it read-only and running integrity/foreign-key checks before replacing the live schema.
- **IMP-06: Normalized core plus versioned snapshots** - Normalize identities, ownership, current projections, uniqueness keys, and queryable status fields; store rich immutable input/result/configuration snapshots in validated, schema-versioned records with content hashes and explicit size limits.
- **IMP-07: Optimistic concurrency plus serialized write coordination** - Use a persisted version/owner guard for aggregate updates and a bounded main-process write coordinator for SQLite busy contention. A stale update returns a conflict result and never performs a compensating mutation.
- **IMP-08: No implicit data deletion** - F03 migrations may add columns/tables, backfill deterministic values, or transform records under an explicit versioned contract, but they do not delete history or create a replacement database as an error fallback.
- **IMP-09: Safe diagnostics** - Repository errors use stable reason codes and bounded details. SQL statements, credentials, prompts, raw SDK errors, and uncontrolled environment values are excluded from durable diagnostics; correlation IDs link a persistence error to the owning operation.
- **IMP-10: Typed provider-neutral AI handoff** - The AI operation/turn repositories accept only the schema-versioned F15 handoff and persist normalized events, structured results, usage, opaque conversation references, and safe errors through bounded codecs. F03 does not import the Codex SDK or invoke a provider.

## Testing Decisions

- **TST-01: Test persistence at the repository boundary** - Use real temporary SQLite databases for schema, migration, transaction, constraint, backup, integrity, restart, and concurrency behavior; use injected clocks and deterministic fixtures rather than product-service calls.
- **TST-02: Test every migration lifecycle state** - Cover empty initialization, current database, each supported upgrade path, repeated startup, edited migration checksum, unsupported version, failed migration, failed backup verification, failed post-migration integrity, and recovery from the verified backup.
- **TST-03: Fault-inject transaction boundaries** - Inject failures before the first write, between related writes, during commit acknowledgement, after commit, during busy retries, and during process termination. Assert atomicity and distinguish committed-but-needs-reconciliation from not-committed.
- **TST-04: Prove idempotency and isolation** - Use duplicate event versions, duplicate bundle associations, replayed operation intents, competing aggregate updates, multiple synchronization results, publication retries, and per-response retries to prove uniqueness and independent history.
- **TST-05: Scan persistence outputs** - Inspect schema fixtures, serialized snapshots, errors, backups, and test logs for credentials, API keys, prompts, raw SDK objects, uncontrolled environment data, unbounded fields, and absolute developer/worktree paths where not explicitly required.
- **TST-06: Defer owning workflow tests** - F03 does not test GitHub polling, Git merges, AI semantics, process execution, UI rendering, notification delivery, or publication network effects; it provides the durable contracts and fault evidence those features consume.

## Proposed Modules

- **MOD-01: Database bootstrap and health** - Resolves the approved application database path, opens SQLite with safe settings, runs integrity checks, and returns structured health/recovery results.
- **MOD-02: Migration runner and backup manager** - Applies ordered migrations atomically, records checksums, verifies pre-migration backups, and fails closed on mismatch or corruption.
- **MOD-03: Transaction coordinator** - Owns begin/commit/rollback, bounded busy handling, fault-safe cancellation semantics, and the commit-before-external-effect boundary.
- **MOD-04: Versioned persistence codecs** - Validates domain records, snapshots, JSON payloads, content hashes, size limits, schema versions, and safe error details.
- **MOD-05: Identity and settings repositories** - Persists settings, profiles, servers, repositories, managed PRs, and resource checkpoints with safe references and optimistic versions.
- **MOD-06: Immutable event and review repositories** - Persists remote-event versions, batches, bundles, items, holds, transitions, and handled associations with append-only/idempotent behavior.
- **MOD-07: Operation evidence repositories** - Persists AI, conversation, validation, synchronization, worktree, and activity records while keeping deterministic observations separate from model-reported data.
- **MOD-08: Publication and response repository** - Persists approvals, publication intents, phases, idempotency keys, commit/push reconciliation, per-response outcomes, and stale-history facts.
- **MOD-09: Persistence conformance fixtures** - Provides reusable schema, restart, migration, transaction-fault, concurrency, idempotency, corruption, backup, and secret-scan evidence for downstream features.

## Workflows

### Workflow 1: Fresh startup and safe upgrade

```text
1. The main process supplies the stable application database path.
2. F03 opens the database with the supported SQLite settings and checks identity/integrity.
3. If the schema is current, F03 returns healthy persistence.
4. If an upgrade is required, F03 creates and verifies a pre-migration backup.
5. F03 applies each ordered migration in one transaction and records its checksum.
6. F03 runs post-migration integrity/foreign-key checks and commits the migration ledger.
7. On any failure, F03 preserves the source database, returns a recovery reason, and does not initialize an empty replacement.
```

### Workflow 2: Atomic Review Bundle persistence

```text
1. A review service asks F03 to persist a batch, immutable event-version inputs, snapshots, and an operation intent.
2. F03 validates all records and checks that each event version is scoped and immutable.
3. In one transaction, F03 inserts or reuses the batch/event versions, creates the bundle/items, records the transition, and acquires the hold.
4. If any constraint or validation fails, the transaction rolls back and no partial bundle/hold is visible.
5. After commit, a restart reads the current bundle projection and append-only history with the same handled associations.
```

### Workflow 3: Durable AI turn budget and evidence

```text
1. The bounded work controller asks F03 to create a segment with its profile/policy/input snapshots and configured budget.
2. F03 commits the segment and consumed-count baseline before the provider turn starts.
3. The turn report, deterministic activity, validation references, usage, fingerprint, and stop reason are committed exactly once.
4. A renderer close or process restart does not reset the parent operation's consumed count.
5. The owning controller decides whether explicit continuation is allowed; F03 only persists that decision and its history.
```

### Workflow 4: Publication intent and uncertain response

```text
1. A user-approved publisher asks F03 to create a publication intent with an idempotency key and expected SHAs.
2. F03 commits the intent and per-response pending records before any commit, push, or response request.
3. The publisher records known commit/remote IDs and phase changes through guarded transactions.
4. If a process/network failure leaves the outcome uncertain, F03 preserves the same intent and identifiers in a recoverable phase.
5. Reconciliation reuses the existing record; response-only failures can become PUBLISHED_WITH_ERRORS without creating a second code-publication intent.
```
