# F12 Review Batching, Scheduler, Check Now, and Global Pause - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F02 - Domain contracts and deterministic state machines | Provides the four primary PR states, global pause overlay semantics, automatic-review admission rules, and structured reasons. |
| 2 | F03 - SQLite persistence, migrations, and transactional repositories | Provides durable settings, scheduler state, Review Batch records, transaction boundaries, idempotency, and restart-safe repositories. |
| 3 | F04 - Persistent Electron shell, IPC boundary, and Windows virtual-desktop spike | Keeps the main process alive without a renderer and provides validated lifecycle, wake, and control-request seams. |
| 4 | F08 - Managed-PR inbox and primary review-state presentation | Provides the persisted multi-PR read-model and presentation seam for a paused overlay and scheduler summaries. |
| 5 | F09 - Durable activity log and operation diagnostics | Provides bounded, correlated activity records for polling, quiet-period, pause, dispatch, and recovery outcomes. |
| 6 | F10 - Independent, efficient PR feedback polling | Provides the renderer-independent poll invocation, ten-minute polling default, immutable observed-version IDs, and safe resource outcomes. |
| 7 | F11 - Event eligibility, deduplication, and per-PR review holds | Provides the eligible/deferred set, exact version decisions, one-operation-per-PR claim, hold state, and explicit release/re-evaluation handoff. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F13-F18 - Git/worktrees, validation, AI, and automatic review | Consume a claimed, exact Review Batch handoff and start the automatic review workflow only after F12 has passed the scheduling gates. |
| 2 | F19 - System tray, native notifications, deep links, and shutdown | Exposes Pause Watching, resume, Check Now, and scheduler outcome controls through the tray and notifications. |
| 3 | F20-F23 - Review Bundle review, revisions, and publication | Consume Review Batches through F18 and release the F11 hold through their explicit outcomes. |
| 4 | F24-F27 - Managed PR branch synchronization | Remains independent of automatic review batching; explicitly started synchronization is not cancelled by global pause. |
| 5 | F28-F30 - Recovery, security, and release readiness | Reconcile scheduler records across restart, sleep, network loss, packaging, and final acceptance. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-03 | FR-01.3, FR-02.1, FR-03.1, INV-04 | AC-02, AC-03, AC-10 | Shared: F12 owns renderer-independent scheduling across managed PRs; F08 owns inbox presentation and F10 owns independent remote observation. |
| APP-AC-04 | FR-02.1, FR-06.1, INV-02 | AC-02, AC-10, AC-11 | Shared: F12 owns durable timer/job recovery; F04 owns process lifetime and F10 owns the poll itself. |
| APP-AC-05 | FR-02.2, FR-04.1, FR-07.1, INV-01 | AC-03, AC-06, AC-13 | Shared: F12 has no AI path; F10 owns the no-token polling boundary. |
| APP-AC-06 | FR-03.1, FR-03.3, FR-04.1 | AC-04, AC-05, AC-08 | Shared: F12 dispatches only after deterministic F10/F11 evidence; F10/F11 own changed-event and eligibility decisions. |
| APP-AC-07 | FR-03.4, FR-04.2, FR-06.2, INV-07 | AC-04, AC-05, AC-11 | Shared: F12 makes batch membership and dispatch idempotent; F11 owns immutable-version eligibility and claim uniqueness. |
| APP-AC-08 | FR-02.1, FR-03.1 | AC-03, AC-04 | Shared: F10 detects feedback; F12 consumes typed new-version results without semantic guessing. |
| APP-AC-09 | FR-03.1-FR-03.5 | AC-03-AC-05 | Primary: F12 owns per-PR quiet-period batching and prevents one burst of comments from becoming multiple automatic review jobs. |
| APP-AC-16 | FR-04.2, FR-05.2, FR-06.2, INV-05 | AC-06-AC-09 | Shared: F12 blocks paused/held automatic dispatch; F02/F11 own the durable hold and explicit-action transitions. |
| APP-AC-17 | FR-02.1, FR-05.1, FR-06.1, INV-02 | AC-02, AC-10, AC-12 | Shared: F12 keeps scheduling in the main process; F04 owns renderer-independent lifetime and F10/F18 own continued work. |
| APP-AC-30 | FR-02.1, FR-06.2, INV-02 | AC-02, AC-10-AC-12 | Shared: F12 proves scheduler continuity after window closure; F04 owns the application-not-shutdown lifecycle contract. |
| APP-AC-25 | FR-03.2, FR-04.2, FR-05.3, INV-05 | AC-07, AC-09 | Shared: F11 retains feedback during a hold; F12 does not batch or dispatch it until the hold is explicitly released. |
| APP-AC-65 | FR-01.1-FR-01.3, FR-02.1, FR-06.1 | AC-01, AC-02, AC-10 | Shared: F12 owns the ten-minute schedule and recovery; F10 owns independent conditional-request and pagination semantics. |
| APP-AC-63 | FR-07.4, INV-01, INV-09 | AC-13 | Not applicable as a provider-adapter owner: F12 proves the scheduler has no provider dependency; F15 owns the Codex adapter and future-provider extensibility. |
| APP-AC-69 | FR-03.1, FR-03.6, INV-04, INV-07 | AC-03-AC-05, AC-10-AC-11 | Shared: F12 preserves immutable version IDs and exact batch membership; F10 owns immutable content-hashed snapshots and F11 owns handled associations. |
| INV-01, INV-02, INV-03, INV-04, INV-05, INV-06, INV-07, INV-08, INV-09, INV-10 | All FR groups | AC-02, AC-06-AC-13 | Primary for scheduler-specific enforcement; downstream features retain authority over their own state, external effects, and publication boundaries. |

## Executive Summary

PRMonitor needs a deterministic control plane between remote feedback observation
and automatic review work. F10 can observe immutable feedback versions and F11
can decide which versions are eligible, but neither feature should invent timer
behavior, combine feedback from different pull requests, or decide what a
global pause means.

F12 schedules renderer-independent polling, groups eligible feedback for each
managed PR during a configurable quiet period, exposes an explicit Check Now
request, and persists a global Pause Watching overlay. A burst of comments for
one PR becomes one exact Review Batch; a different PR always receives its own
batch. The scheduler persists intent and deadlines before waiting or handing
work to downstream features, rechecks F11's claim and hold state at dispatch
time, and recovers deterministically after renderer closure, restart, sleep,
network loss, or a duplicate request.

F12 is deterministic infrastructure. It never calls an AI provider, makes a
semantic decision about a comment, mutates a worktree, runs validation, posts a
response, or publishes anything. The global pause blocks new automatic review
dispatches without changing primary PR states, releasing per-PR holds, or
silently cancelling explicitly started work.

## User Stories

### Keep multiple PRs watched

- **US-01:** **GIVEN** PRMonitor is running with multiple managed PRs, **WHEN** their polling deadlines arrive with no renderer window open, **THEN** each PR receives an independently scoped poll request and one PR's failure does not suppress another PR's schedule.
  - **Acceptance Criteria:** AC-01-AC-02, AC-10-AC-12.

### Group a review burst

- **US-02:** **GIVEN** one or more eligible feedback versions arrive for a PR, **WHEN** additional eligible versions arrive before the quiet period ends, **THEN** they are added to the same pending batch and the quiet period restarts.
  - **Acceptance Criteria:** AC-03-AC-05.
- **US-03:** **GIVEN** feedback arrives for two different PRs at similar times, **WHEN** the scheduler batches it, **THEN** it creates separate per-PR batches and never mixes their immutable version IDs.
  - **Acceptance Criteria:** AC-03-AC-05, AC-10.

### Check and pause safely

- **US-04:** **GIVEN** the developer chooses Check Now, **WHEN** the request is accepted, **THEN** PRMonitor performs an immediate deterministic poll from the main process, coalesces an already-running request, and never invokes an AI provider directly.
  - **Acceptance Criteria:** AC-06, AC-11, AC-13.
- **US-05:** **GIVEN** the developer chooses Pause Watching, **WHEN** the pause is committed, **THEN** no new automatic review dispatch begins, existing state remains visible, and explicitly initiated work is not cancelled or rewritten.
  - **Acceptance Criteria:** AC-07-AC-09, AC-12.

### Recover without duplicate work

- **US-06:** **GIVEN** a pending batch, poll, or dispatch survives renderer closure, sleep, process restart, or a transient network failure, **WHEN** PRMonitor resumes, **THEN** it reconstructs the persisted schedule and either continues the same idempotent intent or reports an actionable blocked outcome without creating duplicate polling, batch membership, or downstream work.
  - **Acceptance Criteria:** AC-02, AC-05, AC-10-AC-12.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** no explicit polling or quiet-period setting exists, **WHEN** F12 resolves the effective schedule, **THEN** both defaults are ten minutes; configured values are validated within the documented bounded range and an invalid value is rejected without changing the prior effective configuration.
- **AC-02:** **GIVEN** multiple managed PRs exist and the renderer is closed, **WHEN** their persisted polling deadlines become due, **THEN** the main process schedules each scope independently, prevents overlapping automatic poll attempts for one scope, and records one PR's failure without suppressing other PRs.
- **AC-03:** **GIVEN** F10 reports a new immutable version and F11 reports it as eligible for one managed PR, **WHEN** F12 accepts the result, **THEN** it persists one pending per-PR batch containing that exact version ID and a quiet-period deadline before relying on a timer; no AI, Git, validation, notification, or publication operation is called.
- **AC-04:** **GIVEN** an eligible version is already in a pending batch, **WHEN** the same version is delivered again, **THEN** batch membership remains one occurrence; **WHEN** a different eligible version for the same PR arrives before the deadline, **THEN** it is added to that batch and the quiet-period deadline restarts; versions for another PR are never added.
- **AC-05:** **GIVEN** a pending batch's quiet period has elapsed, **WHEN** the scheduler attempts automatic dispatch, **THEN** it rechecks global pause, per-PR hold, PR eligibility, and the exact still-unhandled version set, atomically asks F11 to claim that set, persists the dispatch handoff, and invokes only the declared downstream review-work contract; a duplicate or losing retry returns the existing outcome without a second claim or dispatch.
- **AC-06:** **GIVEN** the developer chooses Check Now, **WHEN** no equivalent request is already in flight, **THEN** F12 persists a user-action identity, asks F10 for an immediate read-only poll for the requested scope, and processes its typed result through F11 without shortening an active quiet period or directly invoking an AI provider; a duplicate request is idempotent or coalesced.
- **AC-07:** **GIVEN** global watching is paused, **WHEN** a scheduled timer or an expired pending batch reaches an automatic dispatch gate, **THEN** it does not claim or start new automatic review work; pending batches, deadlines, holds, primary PR states, and existing results remain durable and inspectable.
- **AC-08:** **GIVEN** global watching is paused, **WHEN** a scheduled lightweight poll or explicit Check Now is permitted by the effective pause policy, **THEN** the read-only poll may run and F10/F11 may retain safe observations, but no automatic AI/worktree dispatch starts from that poll.
- **AC-09:** **GIVEN** global watching is resumed, **WHEN** persisted pending batches are re-evaluated, **THEN** only batches whose quiet period has elapsed and whose F11 claim/hold checks succeed are dispatched; held PRs remain deferred and resuming does not release a hold or reset an operation budget.
- **AC-10:** **GIVEN** the process sleeps, closes its renderer, restarts, or wakes after a wall-clock jump, **WHEN** F12 reloads scheduler state, **THEN** it reconstructs the pause overlay, polling deadlines, pending-batch version sets, quiet deadlines, dispatch intents, and retry state from durable records and performs at most one recovery action for each intent.
- **AC-11:** **GIVEN** a poll, timer callback, F11 claim, or downstream handoff is cancelled, interrupted, times out, or returns a network/persistence failure, **WHEN** F12 records the outcome, **THEN** it does not mark unobserved feedback handled, does not discard a pending exact version set, does not fabricate a successful dispatch, and exposes a bounded retryable or user-actionable reason.
- **AC-12:** **GIVEN** a user-started synchronization or other explicitly authorized downstream operation is active, **WHEN** global watching is paused, the window closes, or Check Now is requested, **THEN** F12 does not cancel, reset, replace, or re-authorize that operation.
- **AC-13:** **GIVEN** F12 is inspected through imports, provider fakes, and effect spies, **WHEN** any schedule, batch, pause, recovery, or Check Now path runs, **THEN** no AI-provider adapter, prompt, model token usage, GitHub credential, Git operation, worktree mutation, validation command, response-posting operation, commit, push, merge, or publication capability is reachable.

## Functional Requirements

### FR-01: Effective scheduling configuration

- FR-01.1: The application SHALL persist an effective polling interval with a ten-minute default and SHALL accept only values from one minute through 24 hours inclusive.
- FR-01.2: The application SHALL persist a configurable quiet period with a ten-minute default and SHALL reject values outside the bounded supported range of one minute through 24 hours inclusive.
- FR-01.3: F12 SHALL resolve polling and quiet-period settings through one versioned configuration contract and SHALL snapshot the effective quiet-period value into each pending Review Batch before its timer is relied upon.
- FR-01.4: A configuration edit SHALL affect future scheduling decisions without rewriting immutable feedback versions, an active Review Batch's historical input set, an active F11 hold, a completed result, or an AI operation budget.
- FR-01.5: F12 SHALL expose the next due time, pending-batch deadline, pause status, scheduler revision, and safe retry/block reason through typed main-process read results; consumers SHALL not parse activity text.

### FR-02: Main-process polling cadence and Check Now

- FR-02.1: F12 SHALL schedule F10 from the Electron main process and SHALL remain functional when no renderer window exists.
- FR-02.2: F12 SHALL maintain independently identifiable due/retry state for each managed PR and SHALL bound concurrency so one slow or failed PR cannot block all other managed PRs indefinitely.
- FR-02.3: F12 SHALL provide a typed Check Now request that supports the complete managed-PR set and an explicit managed-PR scope when a later surface supplies one; it SHALL persist a request identity before invoking F10.
- FR-02.4: F12 SHALL coalesce an equivalent in-flight scheduled or manual poll rather than starting a duplicate F10 attempt for the same scope; a manual request SHALL not cancel a user-started operation.
- FR-02.5: F12 SHALL treat Check Now as a deterministic read-only poll request. It SHALL not itself authorize AI work, shorten an active quiet period, release a hold, or publish anything.
- FR-02.6: While global watching is paused, F12 SHALL permit only the read-only polling explicitly allowed by the pause policy, including Check Now, and SHALL prevent that poll from starting automatic review work.

### FR-03: Per-PR quiet-period batching

- FR-03.1: F12 SHALL create and manage pending batches separately for each managed PR; a batch SHALL contain only immutable F11-eligible version IDs belonging to that PR.
- FR-03.2: The first eligible version for an unheld PR SHALL create one pending batch and a persisted quiet-period deadline. The batch and its input membership SHALL be durable before a timer callback is scheduled.
- FR-03.3: A new eligible version for the same PR during the quiet period SHALL be added idempotently and SHALL restart the deadline using the batch's snapshotted quiet-period configuration. A duplicate version SHALL not restart the timer or create another membership row.
- FR-03.4: F12 SHALL not create a batch for an empty eligibility result, a duplicate/handled version, an F11-deferred version, a held PR, or a closed/merged/ineligible PR.
- FR-03.5: Versions observed while a PR is held SHALL remain under F11's retained-during-hold state and SHALL become batch candidates only after an allowed explicit hold outcome; F12 SHALL not attach them to the held batch.
- FR-03.6: When a pending batch becomes dispatchable, F12 SHALL preserve the exact version set and the observation/configuration references that caused it to become dispatchable.

### FR-04: Automatic dispatch gate and downstream handoff

- FR-04.1: Before automatic dispatch, F12 SHALL re-read the authoritative global pause, managed-PR primary state, F11 hold/claim state, exact version associations, and current scheduler/batch revision.
- FR-04.2: F12 SHALL persist a dispatch intent and correlation identity before asking F11 to claim or handing the batch to downstream review work.
- FR-04.3: F12 SHALL ask F11 to atomically claim the exact still-unhandled eligible version set for one Review Bundle/AI operation; F12 SHALL not implement a second claim or locking rule.
- FR-04.4: A pause, per-PR hold, empty set, stale revision, ineligible PR, or F11 conflict SHALL leave the batch pending/deferred with a typed reason and SHALL not start downstream work.
- FR-04.5: After a successful F11 claim, F12 SHALL hand off one immutable batch/claim reference to the owning automatic-review workflow. F12 SHALL not invoke an AI provider, create a worktree, or infer review completion.
- FR-04.6: A repeated dispatch request or uncertain handoff outcome SHALL reconcile the existing batch, claim, and downstream operation identity before retrying; it SHALL not create a second claim or batch for the same exact input.

### FR-05: Global Pause Watching overlay

- FR-05.1: F12 SHALL persist one application-level global watching flag, revision, changed-at instant, and safe actor/request identity; the flag SHALL be separate from the four primary PR states, synchronization statuses, Review Bundle states, and per-PR holds.
- FR-05.2: An explicit Pause Watching action SHALL block new automatic AI/review-work dispatches and SHALL not release holds, change a primary PR state, delete a pending batch, or cancel already admitted work.
- FR-05.3: While paused, permitted lightweight polling and explicit Check Now SHALL be able to record observations and eligibility decisions, but no resulting automatic dispatch may pass the pause gate. An expired pending batch remains ready/deferred until resume.
- FR-05.4: New eligible versions may extend a pending per-PR batch while paused; each new version restarts that batch's persisted quiet deadline. A paused timer never authorizes downstream work.
- FR-05.5: Resume Watching SHALL be an explicit, idempotent action that removes only the global pause overlay. It SHALL not release a per-PR hold, reset an AI budget, or turn a synchronization operation into automatic review work.
- FR-05.6: The pause/read contract SHALL expose whether automatic dispatch is blocked, whether read-only polling is permitted, and which pending work is waiting, so F08/F19 can present a truthful state.

### FR-06: Restart, sleep, network, and cancellation recovery

- FR-06.1: F12 SHALL persist scheduler intent, deadline, scope, configuration revision, request identity, and retry state before relying on a timer, external poll call, claim, or downstream handoff.
- FR-06.2: On startup or wake, F12 SHALL reconcile due polling, pending quiet periods, paused/ready batches, in-flight request identities, and uncertain dispatch intents from durable state before creating new work.
- FR-06.3: A process stop or renderer close before a durable commit SHALL not be reported as success; a committed state SHALL remain authoritative and replayable after restart.
- FR-06.4: Retryable network, rate-limit, timeout, or persistence failures SHALL use bounded deterministic backoff and SHALL not busy-loop, mark versions handled, release a hold, or create a second external effect.
- FR-06.5: A quiet deadline SHALL be evaluated against the current UTC clock after sleep/wake or restart. An expired deadline may become ready while paused, but it SHALL not dispatch until the pause is removed and the other gates pass.
- FR-06.6: Cancellation SHALL be scoped to the scheduler request or timer delivery. It SHALL not compensate by deleting committed batch membership, resetting a claim, cancelling an explicitly authorized downstream operation, or rewriting history.

### FR-07: Diagnostics, IPC, and trust boundary

- FR-07.1: F12 SHALL emit bounded F09 activity for configuration changes, poll scheduling, Check Now, batch creation/addition/debounce, pause/resume, dispatch gate decisions, retries, cancellation, and recovery, with correlation and managed-PR scope.
- FR-07.2: F12 SHALL expose typed read/control/handoff ports for F08/F19/F10/F11/F18 and SHALL keep activity diagnostic rather than authoritative.
- FR-07.3: F12 SHALL validate renderer/tray requests through F04's allowlisted IPC contract and SHALL reject unknown, oversized, secret-shaped, provider-specific, raw-credential, raw-URL, arbitrary-command, or platform-handle values.
- FR-07.4: F12 SHALL not import or invoke an AI provider and SHALL not expose GitHub credentials, provider SDK objects, prompts, uncontrolled environment values, Git, worktree, validation, response-posting, commit, push, merge, or publication capabilities.

## Non-Functional Requirements

- **NFR-01: Determinism** - Given the same persisted scheduler state, typed F10/F11 outcomes, configuration snapshot, request, and UTC clock, F12 SHALL produce the same next due time, batch membership, pause/dispatch decision, retry classification, and safe result without AI or renderer timing.
- **NFR-02: Durability and idempotency** - Committed settings, deadlines, batch membership, pause changes, request identities, dispatch intents, and recovery outcomes SHALL survive renderer closure and ordinary process restart; equal retries SHALL return prior outcomes.
- **NFR-03: Per-PR isolation** - A timer, failure, duplicate, hold, pause decision, or dispatch conflict for one managed PR SHALL not merge, suppress, or rewrite another PR's schedule, batch, event versions, primary state, or operation.
- **NFR-04: Bounded operation** - Timers, concurrent polls, pending memberships, retry attempts, serialized details, and recovery scans SHALL have explicit bounds and SHALL not create unbounded work per managed PR or feedback event.
- **NFR-05: Sleep/network resilience** - The scheduler SHALL recover from wall-clock jumps, system sleep/wake, renderer absence, transient network loss, persistence busy/failure, and process interruption with bounded actionable outcomes and no busy loop.
- **NFR-06: Security and privacy** - Scheduler state, activity, IPC, and evidence SHALL exclude credentials, authorization headers, prompts, provider SDK objects, secret-bearing environment values, arbitrary commands, and unbounded remote payloads.
- **NFR-07: Main-process authority** - Long-running timers, pause state, batch membership, dispatch admission, and recovery SHALL be owned by the Electron main process and F03 repositories; renderer memory and UI lifecycle SHALL not be authoritative.
- **NFR-08: Testability** - The deep scheduler modules SHALL accept injected clocks, timers, persistence, F10/F11/F18 fakes, cancellation, sleep/wake signals, renderer absence, and fault points without real credentials or product-service side effects.

## Invariants

- **INV-01:** Scheduling, time calculation, batching, equality, retry, pause gating, and recovery are deterministic software; F12 never invokes AI to make these decisions.
- **INV-02:** The Electron main process and F03 repositories are authoritative for scheduler configuration, pause state, deadlines, batch membership, claims, and dispatch intents; the renderer is never scheduler state.
- **INV-03:** Intent and the mutable-input snapshot are durable before F12 relies on a timer or starts the represented F10/F11/downstream effect.
- **INV-04:** Review Batches are scoped to one managed PR. An exact immutable version ID can appear at most once in one pending batch and cannot be silently moved to another PR.
- **INV-05:** A per-PR hold, global pause, synchronization status, and Review Bundle state are overlays/guards; none is represented by changing or expanding the primary PR state set.
- **INV-06:** A paused or held PR cannot receive a new automatic review claim or downstream worktree/AI dispatch. Explicit user actions remain distinguishable from automatic scheduling.
- **INV-07:** Duplicate poll requests, version deliveries, timer callbacks, batch additions, claims, and handoff retries are idempotent; a retry cannot create a second automatic operation.
- **INV-08:** Renderer closure, process restart, sleep/wake, pause/resume, or Check Now cannot release a hold, reset an AI budget, cancel explicitly authorized work, or erase committed batch/history evidence.
- **INV-09:** F12 has no publication authority and cannot call GitHub mutation, Git, worktree, validation, notification delivery, response posting, commit, push, merge, or publication services.
- **INV-10:** No credential, authorization header, provider object, prompt, secret-bearing environment value, arbitrary command, or unbounded remote payload is persisted or exposed as F12 state.

## Out of Scope

- **Remote observation transport and semantic version construction** - F10 owns GitHub requests, conditional metadata, pagination, normalization, and immutable version creation.
- **Eligibility rules and per-PR hold ownership** - F11 owns deterministic filtering, handled associations, claims, holds, and explicit release/re-evaluation transitions.
- **Review Bundle preparation, worktrees, validation, AI, responses, and publication** - F13-F23 own those effects and must revalidate F12/F11 handoff data at their boundaries.
- **Tray, native notification, and shutdown presentation** - F19 owns user-facing tray commands, outcome notifications, deep links, and final shutdown flow; F12 supplies typed commands and state.
- **Branch synchronization** - F24-F27 own explicit synchronization selection, merge worktrees, conflict resolution, validation, and publication. Global pause does not cancel that user-started workflow.
- **Full startup/sleep/network/orphan recovery** - F28 owns cross-feature recovery. F12 supplies durable scheduler intents, deadlines, retry state, and reconciliation hooks.
- **Per-PR pause, webhooks, server-side scheduling, multi-user coordination, automatic rebase, autonomous publication, or keyword-based semantic filtering** - These remain outside the MVP.

## Product Decisions

- **PD-01: Ten minutes is the default for both polling and quiet periods** - The application stays quiet and cost-efficient by default. Both values are configurable within the bounded one-minute-through-24-hour range.
- **PD-02: Batches are per managed PR** - Feedback from separate PRs never shares a quiet-period timer, Review Batch, F11 claim, or automatic operation.
- **PD-03: Check Now is an immediate read-only check, not a force-review command** - It requests an immediate F10 poll, coalesces duplicates, and allows already-due work to proceed through normal gates. It does not shorten an active quiet period, release a hold, bypass global pause, or call AI itself. This is the recommended product interpretation and should be confirmed before implementation.
- **PD-04: Pause Watching is an admission gate, not cancellation** - The pause blocks new automatic review dispatch, preserves pending batches and deadlines, permits explicitly allowed read-only polling, and does not cancel work that was already admitted or explicitly started. This is the recommended product interpretation and should be confirmed before implementation.
- **PD-05: Held feedback waits for explicit release** - F11-retained versions are not added to a held batch. After an allowed release, F12 treats newly eligible retained versions as a later batch and starts the configured quiet period from that eligibility observation.
- **PD-06: Resume drains only due work** - Resuming removes the global overlay; it does not force a new poll or shorten a non-expired quiet period. Pending batches are revalidated and dispatched only when all deterministic gates pass.

## Implementation Decisions

- **IMP-01: Use one main-process ReviewScheduler with persisted per-PR slots** - A coordinator owns due polling, pending batches, pause state, dispatch gates, and recovery. The renderer, tray, and notification layers call typed ports rather than creating timers.
- **IMP-02: Persist UTC deadlines and use one wake-up coordinator** - F12 stores next-poll and quiet-period deadlines as UTC instants plus a revision. An in-process timer only wakes the coordinator for the nearest due item; restart and wake recalculate due work from persisted time.
- **IMP-03: Reuse F03 Review Batch and operation-intent repositories** - F12 composes F03 transactions for settings, batch membership, pause changes, scheduler requests, and dispatch intents. It does not write ad hoc SQL or create a second scheduler database.
- **IMP-04: Reuse F10/F11 typed ports** - F12 asks F10 to poll and F11 to evaluate/query/claim. It does not reconstruct event versions, reimplement eligibility, or infer state from F09 activity.
- **IMP-05: Use deterministic bounded scheduler backoff** - F12 records retry attempts and applies a bounded schedule such as 1, 2, 5, 10, and 30 minutes, capped at 30 minutes, for retryable scheduler/F10 handoff failures. A successful poll resets the scheduler backoff; F10 retains ownership of resource-level retry semantics.
- **IMP-06: Model scheduler lifecycle separately from primary PR state** - A Review Batch may be pending, ready, dispatching, dispatched, deferred, cancelled, or failed while the PR remains WATCHING, WORKING, READY_FOR_REVIEW, or NEEDS_ATTENTION according to F02/F11.
- **IMP-07: Reconcile dispatch by stable identity** - A dispatch request carries one batch ID, one F11 claim/operation identity, one scheduler revision, and one correlation ID. Recovery queries those identities before any retry.
- **IMP-08: Keep UI ownership downstream** - F12 supplies versioned scheduler status and pause/control contracts. F08 may display the overlay, and F19 owns the tray/notification presentation; neither surface becomes authoritative.

## Testing Decisions

- **TST-01: Deep-test time and batch semantics** - Use a fake UTC clock and timer to cover first-version creation, additions, duplicates, deadline restart, cross-PR isolation, exact input sets, pause freezing/ready behavior, and resume.
- **TST-02: Deep-test durable intent boundaries** - Fault-inject before and after settings, pause, schedule, batch membership, claim, and handoff commits; distinguish uncommitted, committed, interrupted, retryable, deferred, and uncertain outcomes.
- **TST-03: Prove no-effect boundaries** - Use import checks and spies to prove F12 cannot reach AI, Git, worktree, validation, response posting, commit, push, merge, publication, or credential paths.
- **TST-04: Use deterministic downstream fakes** - Fake F10, F11, F18, F04 wake/lifecycle hooks, and F09 activity so tests do not require GitHub, AI, Git, OS notification, or renderer availability.
- **TST-05: Exercise lifecycle and network behavior** - Cover renderer closure, process restart, sleep/wake wall-clock jumps, network/rate-limit failures, persistence busy errors, cancellation, duplicate requests, concurrent PRs, and a lost handoff response.
- **TST-06: Defer presentation fidelity to owning surfaces** - F12 tests IPC/read/control schemas and safe state projection; F08/F19 own visual, tray, notification, keyboard, screen-reader, and high-contrast evidence.

## Proposed Modules

- **MOD-01: Scheduler Configuration Resolver** - Validates and snapshots polling/quiet-period values, bounds, revisions, and effective defaults.
- **MOD-02: Poll Cadence Coordinator** - Maintains per-PR due/retry state, invokes F10, coalesces requests, and isolates failures.
- **MOD-03: Quiet-Period Batcher** - Adds eligible immutable version IDs to one per-PR pending batch, restarts deadlines, and rejects duplicates/empty sets.
- **MOD-04: Pause Controller** - Persists Pause Watching/Resume Watching, exposes the overlay, and gates only new automatic review dispatch.
- **MOD-05: Automatic Dispatch Gate** - Rechecks pause, hold, eligibility, revisions, exact input membership, claims the set through F11, and hands off one batch reference.
- **MOD-06: Schedule Recovery Reconciler** - Replays due timers, interrupted requests, pending batches, and uncertain handoffs after restart/wake.
- **MOD-07: Scheduler Read/Control Contract** - Exposes typed status, Check Now, pause/resume, and downstream handoff results through F04.
- **MOD-08: Scheduler Diagnostics Adapter** - Emits bounded F09 activity without making activity authoritative.

## Workflows

### Workflow 1: Poll and collect one review burst

1. The main-process scheduler loads the managed-PR set and each persisted next-poll deadline.
2. A due PR slot persists a poll request identity and invokes F10.
3. F10 returns immutable observed-version IDs and safe resource outcomes.
4. F11 evaluates new versions and returns eligible/deferred/ineligible decisions.
5. Each eligible version is inserted into its own PR's pending batch, with a persisted quiet deadline.
6. A later eligible version for that PR is added idempotently and restarts that deadline.
7. When the deadline expires, the batch waits for the deterministic dispatch gate.

### Workflow 2: Check Now while paused

1. The user requests Check Now through a validated main-process control.
2. F12 persists the request identity and coalesces an equivalent in-flight request.
3. F12 invokes the permitted read-only F10 poll, even though global watching is paused.
4. F10/F11 persist safe observations and eligibility decisions.
5. F12 may retain eligible versions in a pending batch, but the pause gate rejects automatic claim/dispatch.
6. F09 records the paused/deferred reason; no AI or worktree effect occurs.
7. After Resume Watching, due batches are revalidated and dispatched once.

### Workflow 3: Recover an expired batch after restart

1. The process stops after a batch deadline or dispatch intent has been persisted.
2. Startup loads the global pause, batch revision, exact version set, F11 owner/hold state, and downstream operation identity.
3. If the batch is already claimed or handed off, F12 returns the existing outcome.
4. If it is unclaimed and unpaused, F12 rechecks F11 and performs one claim/handoff attempt.
5. If it is paused, held, stale, or temporarily unavailable, F12 keeps the batch deferred with a safe reason and bounded retry.
6. A renderer recreation reads the same durable status and cannot reset the deadline or claim.

### Workflow 4: Keep PRs isolated

1. PR-A and PR-B produce eligible versions during the same poll cycle.
2. F12 creates one pending batch and timer per managed PR.
3. PR-A's additions, failure, pause, hold, or dispatch conflict affect only PR-A.
4. PR-B's timer and batch remain independently queryable and eligible.
5. No combined AI request or cross-PR version membership is possible.

## Contract-Test Criteria

- **CT-F12-01:** Configuration/default/bounds/revision tests cover ten-minute defaults, valid and invalid intervals, quiet periods, future-only setting changes, and safe readback.
- **CT-F12-02:** Poll cadence and Check Now tests cover multiple PR scopes, renderer absence, request coalescing, concurrent bounded execution, manual requests during pause, and no AI/Git/publication effect.
- **CT-F12-03:** Quiet-period truth tables cover first version, same-PR additions, duplicate delivery, cross-PR isolation, deadline restart, empty results, exact membership, and held/deferred versions.
- **CT-F12-04:** Dispatch-gate tests cover pause, hold, stale revision, closed/merged PR, F11 claim race, exact version set, persist-before-handoff, downstream acceptance/rejection, and idempotent uncertain handoff recovery.
- **CT-F12-05:** Pause/resume tests cover persisted overlay, in-flight work preservation, paused polling policy, pending/expired batches, resume draining, primary-state/hold invariance, and synchronization non-cancellation.
- **CT-F12-06:** Restart/sleep/network/cancellation tests cover wall-clock jumps, wake re-evaluation, interrupted commits, persistence faults, bounded backoff, duplicate recovery, and no false success/handled state.
- **CT-F12-07:** Boundary/conformance tests cover F04 schema validation, F09 activity handoff, F08/F19 read/control DTOs, secret/raw-payload scans, forbidden imports, and zero AI/Git/worktree/validation/publication effects.

## Requirement Traceability

| Requirement family | Observable coverage |
|---|---|
| FR-01 | AC-01, AC-03-AC-04, AC-10; CT-F12-01, CT-F12-03, CT-F12-06 |
| FR-02 | AC-02, AC-06, AC-08, AC-10-AC-13; CT-F12-02, CT-F12-06, CT-F12-07 |
| FR-03 | AC-03-AC-05, AC-07, AC-09; CT-F12-03, CT-F12-04, CT-F12-05 |
| FR-04 | AC-05, AC-07, AC-09-AC-11; CT-F12-04, CT-F12-06 |
| FR-05 | AC-07-AC-09, AC-12; CT-F12-04, CT-F12-05 |
| FR-06 | AC-02, AC-05, AC-10-AC-12; CT-F12-02, CT-F12-04-CT-F12-06 |
| FR-07 | AC-06, AC-11, AC-13; CT-F12-02, CT-F12-07 |
| NFR-01-NFR-08 | AC-01-AC-13; CT-F12-01-CT-F12-07 |
| INV-01-INV-10 | AC-02-AC-13; CT-F12-01-CT-F12-07 |
