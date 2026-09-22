# F10 Independent, Efficient PR Feedback Polling - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F03 - SQLite persistence, migrations, and transactional repositories | Provides the main-process transaction boundary, independently scoped resource checkpoints, immutable remote-event/version repositories, and restart-safe durable records. |
| 2 | F06 - GitHub REST client and remote identity model | Provides authenticated, provider-neutral requests for PR metadata, inline review comments, reviews/review bodies, and issue comments, including conditional-request and pagination results. |
| 3 | F07 - Add and manage a pull request | Provides the authoritative managed-PR set, explicit base/head/server identities, and the current PR configuration needed to watch each PR. |
| 4 | F08 - Managed-PR inbox and primary review-state presentation | Provides the stable managed-PR read-model and primary-state conventions consumed by background work; F10 does not use the renderer as its watch list. |
| 5 | F09 - Durable activity log and operation diagnostics | Provides the safe structured activity writer for poll attempts and resource outcomes; activity remains diagnostic evidence rather than polling state. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F11 - Event eligibility, deduplication, and per-PR review holds | Consumes immutable observed versions to decide which feedback is eligible for analysis, while preserving versions observed during holds. |
| 2 | F12 - Review batching, scheduler, Check Now, and global pause | Schedules F10 poll invocations, applies the effective polling interval, and coordinates manual or paused monitoring without moving polling logic into the renderer. |
| 3 | F18 - Automatic review-to-Review-Bundle vertical slice | Consumes immutable remote-event versions and the resource observations that F10 records for review preparation. |
| 4 | F19-F23 - Notifications, review, and publication | Consume durable polling outcomes and activity evidence but do not authorize publication from a poll result. |
| 5 | F28-F30 - Recovery, security, and release readiness | Reconcile interrupted poll attempts and verify GitHub/GHES compatibility, redaction, resource bounds, and renderer-independent operation. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-03 | FR-01.1-FR-01.5, FR-08.2, INV-01-INV-03 | AC-01-AC-02, AC-15 | Shared: F10 owns independent observation for every managed PR; F08 owns inbox presentation and F12 owns scheduling/selection behavior. |
| APP-AC-04 | FR-01.1-FR-01.6, FR-06.3, INV-01-INV-02 | AC-02, AC-14-AC-15 | Primary for the polling worker: F10 polls from the main process; F04 owns process lifetime and F19 owns tray/lifecycle presentation. |
| APP-AC-05 | FR-07.1-FR-07.3, NFR-01, INV-01 | AC-03, AC-16 | Primary: F10 has no AI-provider path and performs only deterministic remote observation. |
| APP-AC-06 | FR-02.1-FR-03.5, FR-07.1 | AC-04-AC-07, AC-16 | Primary: unchanged resource observations end without an AI invocation; F12 owns when a poll is scheduled. |
| APP-AC-07 | FR-05.2-FR-05.6, INV-04-INV-06 | AC-09-AC-10 | Shared: F10 makes immutable-version insertion idempotent; F11 owns event eligibility and the guarantee that a duplicate cannot trigger a second analysis. |
| APP-AC-08 | FR-02.1-FR-05.1, FR-06.1 | AC-05-AC-09, AC-11 | Primary for deterministic observation: F10 detects and persists new or meaningfully changed feedback; F06 owns the REST transport and F11 owns semantic eligibility. |
| APP-AC-25 | FR-05.5, FR-06.1-FR-06.2, INV-07 | AC-13-AC-14 | Shared: F10 continues read-only observation and stores later versions during a hold; F11 owns hold release and later eligibility. |
| APP-AC-65 | FR-01.3, FR-02.2-FR-03.5, NFR-02 | AC-04-AC-07, AC-15 | Primary for per-resource request/checkpoint independence; F12 owns the scheduler that invokes the ten-minute default. |
| APP-AC-69 | FR-04.1-FR-05.6, INV-04-INV-06 | AC-08-AC-12 | Primary for scoped semantic version construction; F03 owns durable storage and uniqueness enforcement. |

## Executive Summary

PRMonitor must know when a managed pull request has new review feedback without
requiring a webhook endpoint, an open window, or an AI-provider call. GitHub
exposes PR metadata, inline review comments, review bodies/states, and general
conversation comments as separate resources. Treating them as one feed would
allow an unchanged metadata response, a stale timestamp, or one failed page to
hide feedback from another resource.

F10 provides the deterministic main-process watcher. It polls every managed PR
through the F06 resource boundary, keeps conditional-request and pagination
state independent for each resource, normalizes returned objects, and stores
immutable semantic versions of observed feedback. The result is durable input
for later eligibility and batching features. F10 never classifies feedback,
invokes an AI provider, modifies a worktree, or marks feedback handled.

## User Stories

### Continuous background observation

- **US-01:** **GIVEN** PRMonitor is running with one or more managed PRs, **WHEN** no review window is open, **THEN** the main process continues polling each PR and records a safe result that can be read after a renderer is recreated.
  - **Acceptance Criteria:** AC-01-AC-03, AC-14-AC-15.
- **US-02:** **GIVEN** two managed PRs use different servers, repositories, or pull-request numbers, **WHEN** a poll cycle runs, **THEN** each request and stored observation remains bound to its own identity and no feedback crosses between PRs.
  - **Acceptance Criteria:** AC-01, AC-08, AC-11.

### Independent GitHub feedback resources

- **US-03:** **GIVEN** GitHub returns unchanged PR metadata but changed review comments, reviews, or issue comments, **WHEN** the watcher checks the PR, **THEN** the changed feedback is still retrieved and represented as new input.
  - **Acceptance Criteria:** AC-05-AC-07.
- **US-04:** **GIVEN** one feedback collection is paginated or temporarily unavailable, **WHEN** the watcher processes a poll, **THEN** only complete resource observations advance their own checkpoint and the other resource scopes retain independent outcomes.
  - **Acceptance Criteria:** AC-06-AC-07, AC-12.

### Immutable feedback history

- **US-05:** **GIVEN** a reviewer edits a body, review state, or location while the remote timestamp is missing or unchanged, **WHEN** PRMonitor observes the object again, **THEN** it stores exactly one new immutable semantic version while preserving the earlier version.
  - **Acceptance Criteria:** AC-08-AC-12.
- **US-06:** **GIVEN** the same remote object version is returned repeatedly, **WHEN** the watcher compares it with persisted observations, **THEN** it reuses the existing version and does not create duplicate downstream input.
  - **Acceptance Criteria:** AC-09-AC-10.

### Safe cost and failure behavior

- **US-07:** **GIVEN** polling finds no changed feedback, **WHEN** the poll completes, **THEN** it consumes zero AI-provider/API-model tokens and produces no AI operation.
  - **Acceptance Criteria:** AC-03-AC-04, AC-16.
- **US-08:** **GIVEN** a network, cancellation, malformed-response, process-stop, or renderer-close event interrupts polling, **WHEN** PRMonitor recovers, **THEN** it preserves the last committed checkpoint and immutable history, marks the incomplete attempt safely, and retries without claiming that feedback was processed.
  - **Acceptance Criteria:** AC-12, AC-14.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** the main process has two or more managed PRs with explicit server, repository, and PR identities, **WHEN** one poll invocation runs, **THEN** each PR receives an independently identified poll attempt and resource outcomes, and a response for one PR cannot be stored under another PR.
- **AC-02:** **GIVEN** a managed PR remains configured and the visible renderer is closed or destroyed, **WHEN** the effective polling interval elapses, **THEN** the main process still performs the scheduled read-only poll, commits its durable outcome, and makes no renderer availability assumption.
- **AC-03:** **GIVEN** a poll invocation checks PR metadata, inline review comments, reviews/review bodies, and issue comments, **WHEN** the invocation completes, **THEN** no AI provider, API model, Git operation, worktree mutation, validation command, publication action, or response-posting operation was called.
- **AC-04:** **GIVEN** all requested resources return `304 Not Modified` or complete responses whose semantic content hashes match their latest observations, **WHEN** the poll commits, **THEN** no new immutable feedback version or AI-work request is created and the result reports zero new semantic input.
- **AC-05:** **GIVEN** PR metadata returns `304 Not Modified` while an inline comment, review, or issue-comment resource has changed content, **WHEN** the resource checks run, **THEN** the changed resource is fetched and normalized; the metadata `304` affects only the metadata scope.
- **AC-06:** **GIVEN** each resource has its own persisted ETag/Last-Modified values and pagination checkpoint, **WHEN** a subsequent poll runs, **THEN** the request for one exact server/repository/PR/resource scope uses only that scope's conditional metadata and continuation state; no scope inherits another scope's freshness or page position.
- **AC-07:** **GIVEN** a resource response spans multiple pages, **WHEN** every page is validated and consumed successfully, **THEN** its checkpoint advances once to the returned complete position; **WHEN** a page fails, is cancelled, is malformed, repeats indefinitely, or exceeds the F06 bounds, **THEN** that resource retains its prior checkpoint and is not reported complete.
- **AC-08:** **GIVEN** F06 returns a review comment, review/review body, or issue comment, **WHEN** F10 normalizes it, **THEN** the result contains the server-scoped PR identity, source type, remote object identity, author, body/state fields, created/updated timestamps, location/reply metadata when present, and bounded observation metadata without semantic keyword classification.
- **AC-09:** **GIVEN** a normalized object has the same scoped remote identity and the same canonical semantic fields as a stored version, **WHEN** it is observed again, **THEN** F10 returns the existing immutable version; **WHEN** any semantically relevant body, review state, location, author, reply, or timestamp field changes, **THEN** F10 creates one new version even if the remote `updatedAt` is absent or unchanged.
- **AC-10:** **GIVEN** the same remote object ID appears in different servers, repositories, pull requests, or source resources, **WHEN** versions are stored, **THEN** their scoped identities and version keys remain distinct; a replay with an equal scope and content hash is idempotent and a changed snapshot never overwrites its predecessor.
- **AC-11:** **GIVEN** the watcher observes an object with an empty body, a bodyless approval, a bot author, or a closed/merged PR, **WHEN** the object is returned by GitHub, **THEN** F10 preserves the complete normalized observation for F11's deterministic eligibility rules and does not apply keyword, author-policy, or lifecycle filtering itself.
- **AC-12:** **GIVEN** a network error, rate-limit response, malformed object, incomplete page sequence, cancellation, or process stop occurs before a resource transaction commits, **WHEN** the poll attempt ends, **THEN** the prior checkpoint remains authoritative, no feedback version is marked handled or processed, the outcome is retryable or actionable, and a successful result from another fully completed resource cannot be mistaken for a complete poll of the failed resource.
- **AC-13:** **GIVEN** a PR is `WORKING`, `READY_FOR_REVIEW`, or `NEEDS_ATTENTION`, **WHEN** new remote feedback is observed, **THEN** F10 stores it as a separate immutable version without attaching it to the active bundle, mutating its worktree, releasing a hold, changing the primary PR state, or starting another automatic AI operation.
- **AC-14:** **GIVEN** a process stops or a cancellation arrives before or after a polling transaction commits, **WHEN** the application restarts or retries, **THEN** an uncommitted attempt is distinguishable as interrupted/retryable, a committed checkpoint/version remains readable, and replay does not create a duplicate version or claim an uncommitted read succeeded.
- **AC-15:** **GIVEN** the effective polling interval is not explicitly configured, **WHEN** F12 requests the next schedule, **THEN** F10 supplies a deterministic ten-minute default; configured intervals SHALL be between one minute and 24 hours inclusive, and SHALL not alter the independent resource semantics or require a renderer window.
- **AC-16:** **GIVEN** F10 is built and exercised with provider/network spies, **WHEN** its imports and poll paths are inspected, **THEN** no AI-provider adapter, prompt, model token usage, GitHub credential, raw authorization header, uncontrolled environment value, provider SDK object, or publication capability crosses the F10 boundary.
- **AC-17:** **GIVEN** a poll attempt has a start, resource outcome, new-version, no-change, failure, cancellation, or recovery result, **WHEN** diagnostics are written, **THEN** F09 receives bounded provider-neutral activity events with correlation and resource scope, and an activity write failure cannot turn an unsuccessful poll into a successful one or authorize downstream work.

## Functional Requirements

### FR-01: Main-process watch scope and invocation contract

- FR-01.1: The application SHALL run F10 polling in the Electron main process and SHALL continue a configured poll invocation when no renderer window exists.
- FR-01.2: F10 SHALL poll every currently managed PR through its explicit server, base repository, pull-request, and configured resource identity; it SHALL not derive scope from a display label, branch name, or same-named repository.
- FR-01.3: F10 SHALL expose a deterministic effective polling interval with a ten-minute MVP default and a configured range from one minute through 24 hours inclusive; F12 SHALL be able to schedule the invocation without reimplementing resource polling.
- FR-01.4: Before any GitHub request starts, F10 SHALL persist a poll-run intent and a resource-attempt identity/configuration snapshot through F03, including the managed-PR identity, resource scope, conditional metadata, pagination starting point, and correlation identity.
- FR-01.5: F10 SHALL prevent overlapping automatic attempts for the same managed-PR/resource scope or return the existing in-flight attempt according to the F03 idempotency contract.
- FR-01.6: F10 SHALL distinguish `completed`, `not_modified`, `partial`, `failed`, `cancelled`, and `interrupted` poll/resource outcomes without reporting an uncommitted attempt as successful.

### FR-02: Complete and independent resource observation

- FR-02.1: F10 SHALL check PR metadata, inline pull-request review comments, pull-request reviews/review bodies, and general PR conversation comments through four explicit F06 resource operations.
- FR-02.2: Each resource SHALL have an independent conditional-request scope, pagination scope, attempt outcome, last-complete observation, and retry/recovery result.
- FR-02.3: A `304 Not Modified`, empty result, error, or stale response for one resource SHALL not suppress or mark complete any other resource request.
- FR-02.4: F10 SHALL persist the current normalized PR metadata needed by later deterministic state/eligibility decisions, including remote state and base/head SHA observations, without changing the primary PR state machine.

### FR-03: Conditional requests and bounded pagination

- FR-03.1: F10 SHALL persist and reuse F06's ETag and/or Last-Modified metadata only for the exact server/repository/PR/resource scope that produced it.
- FR-03.2: F10 SHALL persist and reuse only F06-validated continuation tokens/page positions and SHALL not store or follow arbitrary response URLs or caller-supplied endpoints.
- FR-03.3: F10 SHALL treat a resource as complete only after all pages required by F06 have been validated, normalized, and consumed within the configured bounds.
- FR-03.4: F10 SHALL advance a resource checkpoint in the same durable decision that records its complete observation; a failed, cancelled, malformed, or incomplete page sequence SHALL leave the prior checkpoint authoritative.
- FR-03.5: F10 SHALL retain independent response freshness metadata even when a PR-metadata request returns `304 Not Modified`; a metadata `304` SHALL not be a global no-change signal.

### FR-04: Provider-neutral normalization

- FR-04.1: F10 SHALL normalize every returned feedback object into the provider-neutral review-event contract with source type, scoped identity, author, body, review state, timestamps, location/reply fields, and observation time where available.
- FR-04.2: F10 SHALL preserve empty bodies, bodyless approvals, ignored-account candidates, bot-authored items, closed/merged-PR items, and nullable location fields for F11's deterministic filtering; F10 SHALL not use keywords or semantic judgment to discard them.
- FR-04.3: F10 SHALL preserve exact bounded semantic fields used for later analysis and SHALL keep transport headers, credentials, raw SDK objects, and uncontrolled response bodies outside the normalized record.
- FR-04.4: F10 SHALL store the current remote PR metadata snapshot separately from immutable feedback-event versions so a metadata refresh cannot rewrite feedback history.

### FR-05: Immutable semantic versioning

- FR-05.1: F10 SHALL construct a canonical semantic representation with stable field ordering and explicit handling of null/absent optional values before computing a content hash.
- FR-05.2: The content hash SHALL include every field that can change the meaning or location of a feedback item, including body, review state, author, reply relationship, timestamps, and location metadata, and SHALL exclude observation-only fields such as `observedAt` and transport headers.
- FR-05.3: Each immutable version key SHALL include the scoped server/repository/PR/source/remote-object identity and the canonical semantic content hash; a remote object ID alone SHALL never identify a version.
- FR-05.4: An equal scoped version SHALL be inserted/retrieved idempotently; a changed semantic snapshot SHALL append one new version and SHALL never update or delete the predecessor.
- FR-05.5: Each stored version SHALL retain the exact normalized snapshot, content hash, version key, observed timestamp, source/resource scope, and the complete-observation/checkpoint reference that produced it.
- FR-05.6: F10 SHALL not mark an immutable version handled, accepted, processed, or attached to a Review Bundle; F11/F18 own those later associations.

### FR-06: Failure, cancellation, restart, and retry

- FR-06.1: A failed resource request or incomplete page sequence SHALL retain the last committed checkpoint and SHALL not mark any feedback as handled/processed; a fully completed independent resource MAY commit its own observation while the failed scope remains retryable.
- FR-06.2: F10 SHALL persist intent before each external request and SHALL commit the resource outcome, checkpoint candidate, normalized observations, and immutable versions atomically for that completed resource.
- FR-06.3: Cancellation or process stop before commit SHALL leave no partial successful resource outcome; cancellation or process stop after commit SHALL expose the committed result for reconciliation.
- FR-06.4: A retry after renderer closure, restart, timeout, rate limit, or transient network failure SHALL use the same scoped durable identity where the operation is replayed, SHALL be bounded by F06/F03 retry policy, and SHALL not create duplicate immutable versions.

### FR-07: Deterministic boundary and sensitive-data handling

- FR-07.1: F10 SHALL use deterministic comparison, hashing, persistence, retry, and resource orchestration only; it SHALL not invoke or import an AI provider to decide whether feedback changed.
- FR-07.2: F10 SHALL not invoke Git, worktree, validation, notification, response-posting, commit, push, merge, or publication behavior.
- FR-07.3: F10 SHALL keep GitHub credentials, authorization headers, provider prompts/SDK objects, secret-bearing environment values, and raw uncontrolled response data outside poll intents, snapshots, activity, IPC, and renderer state.

### FR-08: Diagnostics and downstream handoff

- FR-08.1: F10 SHALL emit structured F09 activity for poll intent, resource start, conditional outcome, page progress, new-version count, no-change, failure, cancellation, and recovery, with bounded safe details.
- FR-08.2: F10 SHALL expose typed read-only results for F11/F12/F18 and F08 to consume, including resource outcomes, immutable version IDs, current metadata, and retry reasons; consumers SHALL not need to parse activity text.
- FR-08.3: A missing or failed activity append SHALL remain a diagnostic failure and SHALL not authorize a checkpoint advance, event handling, AI operation, or primary-state transition.

## Non-Functional Requirements

- **NFR-01: Determinism** - Given the same managed-PR identity, F06 normalized inputs, checkpoint state, clock, and configuration snapshot, F10 SHALL produce the same request scopes, hashes, version keys, checkpoint decision, and safe outcome without AI or renderer timing.
- **NFR-02: Efficient bounded observation** - F10 SHALL use conditional requests and complete only bounded F06 pagination; unchanged resources SHALL not cause unnecessary full semantic-version writes, and the watcher SHALL use bounded concurrency/backpressure rather than an unbounded task per PR or page.
- **NFR-03: Durability and idempotency** - Committed poll intents, resource checkpoints, normalized metadata, and immutable versions SHALL survive renderer closure and ordinary restart; replayed identities SHALL return prior durable results rather than duplicate history.
- **NFR-04: Resource isolation** - A failure, `304`, pagination cursor, conditional header, or semantic version from one server/repository/PR/resource scope SHALL not affect another scope.
- **NFR-05: Security and privacy** - Credentials, raw authorization data, provider SDK objects, prompts, uncontrolled environment values, and unbounded remote payloads SHALL not enter F10 persistence, diagnostics, IPC, UI state, or evidence.
- **NFR-06: GitHub compatibility** - The same provider-neutral contract SHALL support GitHub.com and standard GHES responses, forks, null/deleted head repositories, missing timestamps, nullable locations, pagination, and conditional requests supplied by F06.
- **NFR-07: Operational recovery** - Polling SHALL expose safe retryable/actionable outcomes for network, rate-limit, malformed, cancellation, interruption, and persistence failures without a busy loop or false success.
- **NFR-08: Testability and boundary clarity** - F10 SHALL support injected F06 transport fakes, clocks, persistence faults, cancellation, renderer absence, process interruption, and AI/Git/validation spies without real credentials or remote side effects.

## Invariants

- **INV-01:** Polling is deterministic infrastructure; F10 never invokes AI for transport, comparison, hashing, deduplication, scheduling, or persistence decisions.
- **INV-02:** The Electron main process and F03 repositories are authoritative for poll attempts, resource checkpoints, current remote metadata, and immutable feedback versions; the renderer is never the watch state.
- **INV-03:** PR metadata, inline review comments, reviews/review bodies, and issue comments remain independent resources with independent conditional metadata, pagination, checkpoints, and outcomes.
- **INV-04:** Immutable feedback versions are append-only, scoped, content-hashed snapshots; equal replays are idempotent and changed semantic content creates a new version without rewriting history.
- **INV-05:** A remote object ID without server, repository, PR, and source scope cannot identify a stored version or checkpoint.
- **INV-06:** A failed, cancelled, interrupted, malformed, or incomplete resource observation cannot advance its checkpoint or mark feedback handled/processed.
- **INV-07:** New versions observed during `WORKING`, `READY_FOR_REVIEW`, or `NEEDS_ATTENTION` are retained separately and cannot mutate an active Review Bundle, worktree, hold, or primary state.
- **INV-08:** Polling intent and its mutable-input snapshot are durable before the represented GitHub request; a committed result remains visible after renderer closure or restart.
- **INV-09:** Polling has no publication authority and cannot call Git, worktree, validation, notification, response-posting, commit, push, merge, or publication services.
- **INV-10:** No credential, authorization header, provider SDK object, prompt, secret-bearing environment value, or unbounded response is persisted or exposed as poll state.

## Out of Scope

- **Event eligibility and semantic filtering** - F11 owns duplicate eligibility, PRMonitor-authored filtering, empty/bodyless approval filtering, ignored accounts, closed/merged handling, and per-PR holds.
- **Batching, quiet periods, Check Now, global pause, and scheduling policy** - F12 owns scheduling and pause semantics; F10 supplies the poll invocation contract and ten-minute default.
- **AI review, worktrees, validation, and response drafting** - F13-F18 own local execution and semantic review; F10 only records deterministic remote inputs.
- **Publication, response posting, approval, commit, push, merge, and synchronization** - F23-F27 own all external mutations and explicit human approval.
- **Inbox, tray, notifications, and dedicated polling UI** - F08/F09/F19 present read models, diagnostics, and outcome notifications; F10 remains usable with no renderer.
- **Webhook delivery, centralized monitoring, multi-user operation, and remote event deletion/compaction** - These remain outside the MVP.

## Product Decisions

- **PD-01: Poll four resources independently** - The watcher treats PR metadata, inline review comments, reviews/review bodies, and issue comments as separate sources so one conditional response or failure cannot hide another source.
- **PD-02: Ten minutes is the default polling interval** - The application remains quiet and cost-efficient by default; a user setting may select any interval from one minute through 24 hours without changing F10's resource semantics.
- **PD-03: Observation is not handling** - F10 records what GitHub returned, but only later review workflow features may mark a version handled or attach it to a Review Bundle.
- **PD-04: Semantic fields, not timestamps alone, define a version** - A changed body, state, author, reply relationship, or location is meaningful even when GitHub's timestamp is missing or unreliable.
- **PD-05: Complete-resource commits are independent** - A fully completed resource may commit its own checkpoint and versions while another resource remains retryable; no failed resource is marked processed by a partial poll.
- **PD-06: Hold-safe observation continues** - Read-only polling may continue while a PR is working or held, but new versions remain separate and cannot release the hold or mutate the active worktree.
- **PD-07: Polling is quiet** - A successful poll with no semantic change records deterministic diagnostics only and never invokes an AI provider or creates a user-facing notification by itself.

## Implementation Decisions

- **IMP-01: Use one main-process `PrWatcher` boundary** - F10 coordinates resource calls and durable results through typed ports; it does not expose the GitHub transport or SQLite connection to the renderer.
- **IMP-02: Persist `PollRun` and `PollResourceAttempt` intent** - Each resource request has a durable idempotency/correlation identity and an immutable request snapshot before F06 is called. F09 activity supplements these records but cannot replace them.
- **IMP-03: Reuse F06 resource contracts** - F10 consumes normalized conditional/pagination outcomes and never implements a second HTTP client, parser, credential path, or arbitrary endpoint builder.
- **IMP-04: Use per-resource F03 transactions** - A completed resource transaction writes its attempt outcome, checkpoint, normalized current metadata where applicable, immutable versions, and safe activity linkage together; incomplete resources retain the prior checkpoint.
- **IMP-05: Canonicalize before hashing** - A version builder uses one versioned canonical serializer with explicit nulls and stable key ordering. Operational fields such as observation time and transport headers are excluded from the semantic hash.
- **IMP-06: Bound concurrency at the coordinator** - The watcher uses a fixed/configured concurrency limit and backpressure across managed PRs/resources. It never creates an unbounded promise/task for every PR or page.
- **IMP-07: Keep current metadata separate from event history** - PR metadata is a current remote snapshot used by later deterministic decisions; feedback objects are immutable version records and are never rewritten by metadata refreshes.
- **IMP-08: Make downstream ownership explicit** - F10 returns typed observed-version IDs and resource outcomes. F11 owns eligibility/holds, F12 owns scheduling/pause, F08 owns presentation, and F09 owns diagnostics.

## Testing Decisions

- **TST-01: Deep-test resource independence** - Use a fake F06 transport to exercise all four resources, `304` isolation, independent headers/checkpoints, pagination, page failure, and changed feedback behind unchanged metadata.
- **TST-02: Deep-test semantic versioning** - Use truth tables for equal, edited, timestamp-missing, null-versus-value, location, review-state, author, reply, fork, and cross-resource identity cases; verify append-only persistence and idempotent replay.
- **TST-03: Prove no-effect boundaries** - Use spies/import checks to prove no AI, Git, worktree, validation, notification, response-posting, publication, or renderer dependency is reachable from F10.
- **TST-04: Fault-inject durability** - Stop/cancel before and after request, page, transaction, checkpoint, and activity boundaries; distinguish uncommitted, committed, interrupted, retryable, and partial resource outcomes.
- **TST-05: Use provider fixtures, not live credentials** - GitHub.com/GHES, forks, deleted heads, rate limits, malformed responses, and pagination are exercised through bounded fakes; clean-machine acceptance remains a downstream F30 concern.
- **TST-06: Defer UI rendering tests** - F10 has no dedicated UI. F08/F09/F19 own presentation, accessibility, and notification tests; F10 supplies typed safe data and renderer-absent evidence.

## Proposed Modules

- **MOD-01: Polling Configuration Contract** - Validates the ten-minute default, bounded interval, concurrency, and scheduler-facing invocation options.
- **MOD-02: Poll Coordinator** - Enumerates managed PRs, prevents overlapping scoped attempts, persists intent, and aggregates independent outcomes.
- **MOD-03: Resource Poll Runner** - Executes one F06 resource scope, handles conditional/not-modified and validated pagination outcomes, and produces a complete-resource candidate.
- **MOD-04: Remote Feedback Normalizer** - Converts F06 records into provider-neutral event objects while preserving all fields needed by later eligibility and hashing.
- **MOD-05: Semantic Version Builder** - Canonicalizes semantic fields, computes content hashes/version keys, and returns idempotent immutable-version candidates.
- **MOD-06: Poll Persistence Adapter** - Composes F03 transactions for attempts, checkpoints, current metadata, immutable versions, and safe recovery state.
- **MOD-07: Poll Diagnostics Adapter** - Emits F09 activity with bounded resource scope, correlation, outcome, and counts without making activity authoritative.

## Workflows

### Workflow 1: Run a renderer-independent poll

```text
1. F12 or startup recovery asks the main-process PrWatcher to run a bounded poll.
2. The watcher loads the managed-PR set and persists one PollRun/resource-attempt intent per scope.
3. It calls F06 independently for PR metadata, inline review comments, reviews/review bodies, and issue comments.
4. Each resource runner handles its own conditional response and complete page sequence.
5. F10 normalizes returned objects, creates/reuses immutable semantic versions, and commits the resource checkpoint/result through F03.
6. F09 records safe activity; F10 returns typed outcomes to F11/F12/F08 without invoking AI or mutating primary state.
```

### Workflow 2: Detect an edited feedback item

```text
1. F06 returns an object with a known scoped remote ID.
2. F10 canonicalizes every semantic field, including body/state/location/reply data and reliable or unreliable timestamps.
3. The content hash and scoped version key are compared with stored immutable versions.
4. An exact replay returns the existing version; a changed semantic snapshot appends one new version.
5. F10 leaves handling, eligibility, batching, and Review Bundle association to F11/F18.
```

### Workflow 3: Recover from a failed resource or restart

```text
1. F10 persists request intent before the F06 call.
2. A request, page, persistence transaction, renderer close, cancellation, or process stop fails at a defined boundary.
3. The failed/incomplete resource retains its prior checkpoint and is marked retryable/interrupted; no version is marked handled.
4. Fully committed independent resources remain readable and are not duplicated on retry.
5. Startup reconciliation resumes or safely retries the durable attempt without claiming an uncommitted read succeeded.
```

### Workflow 4: Observe feedback during a review hold

```text
1. A managed PR is WORKING, READY_FOR_REVIEW, or NEEDS_ATTENTION.
2. F10 continues the permitted read-only resource checks.
3. New remote content is stored as a separate immutable version and reported to F11/F08.
4. F10 does not attach it to the active bundle, refresh/reset its worktree, release the hold, or start AI work.
5. F11 later decides eligibility after the explicit hold outcome.
```

## Contract-Test Criteria

- **CT-F10-01:** Polling configuration, managed-PR enumeration, scoped poll/resource intent, no-overlap behavior, ten-minute default, bounded concurrency, and renderer-independent execution.
- **CT-F10-02:** Four-resource request matrix, independent conditional headers/checkpoints, PR metadata `304` isolation, empty/error independence, and F06 handoff.
- **CT-F10-03:** Pagination completeness, validated continuation state, duplicate-page handling, page failure/cancellation, response bounds, checkpoint advancement, and partial-resource outcomes.
- **CT-F10-04:** Provider-neutral normalization for comments/reviews/issue comments, nullable fields, bodyless approvals, bot/empty/closed items, fork/deleted-head identities, and no semantic filtering.
- **CT-F10-05:** Canonical semantic hashing, unreliable/missing timestamps, equal replay, changed-field matrix, scoped version keys, append-only history, and cross-server/repository/resource isolation.
- **CT-F10-06:** Persist-before-request, atomic complete-resource commit, failure/cancellation/process-stop/restart recovery, retry idempotency, no-handled-on-failure, and committed-after-cancellation truth.
- **CT-F10-07:** Zero AI/Git/worktree/validation/publication effects, credential/raw-payload redaction, F09 activity handoff, hold-safe observation, and F11/F12/F08 typed downstream conformance.

## Requirement Traceability

| Requirement family | Observable coverage |
|---|---|
| FR-01 | AC-01-AC-03, AC-14-AC-15; CT-F10-01, CT-F10-06 |
| FR-02 | AC-01, AC-03-AC-07, AC-11; CT-F10-02 |
| FR-03 | AC-05-AC-07, AC-12; CT-F10-02, CT-F10-03 |
| FR-04 | AC-08, AC-11; CT-F10-04 |
| FR-05 | AC-09-AC-11; CT-F10-05 |
| FR-06 | AC-12-AC-14; CT-F10-06 |
| FR-07 | AC-03, AC-16; CT-F10-07 |
| FR-08 | AC-13-AC-17; CT-F10-07 |
| NFR-01-NFR-08 | AC-01-AC-17; CT-F10-01-CT-F10-07 |
| INV-01-INV-10 | AC-01-AC-17; CT-F10-01-CT-F10-07 |
