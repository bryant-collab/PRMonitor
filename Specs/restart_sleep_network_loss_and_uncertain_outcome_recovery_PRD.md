# F28 - Restart, Sleep, Network-Loss, and Uncertain-Outcome Recovery - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F02 - Domain contracts and deterministic state machines | Provides the legal primary PR states, synchronization overlay states, structured reasons, hold rules, and terminal transitions that recovery must preserve. |
| 2 | F03 - SQLite persistence, migrations, and transactional repositories | Provides the durable intent, revision, idempotency, phase, effect, worktree, AI, validation, and recovery records that survive process loss. |
| 3 | F04 - Persistent Electron shell, IPC boundary, and Windows virtual-desktop spike | Provides main-process lifetime, renderer replacement, startup/shutdown, and sleep/wake lifecycle signals. |
| 4 | F09 - Durable activity log and operation diagnostics | Provides bounded correlated recovery activity; activity remains diagnostic rather than authoritative. |
| 5 | F10-F12 - Polling, eligibility/holds, and scheduler | Provide independent remote observations, immutable feedback versions, deadlines, batches, pause state, and automatic-dispatch identities. |
| 6 | F13-F14 - Operation-owned Git worktrees and deterministic validation | Provide authoritative worktree/Git condition, ownership, diff, process, and validation evidence used to classify interrupted local work. |
| 7 | F15-F17 - Provider adapter, task profiles, and bounded AI work | Provide provider-neutral invocation identity, timeout/cancellation outcomes, turn reports, budgets, policy snapshots, and explicit continuation semantics. |
| 8 | F18-F23 - Review Bundle preparation, workspace, revisions, stale handling, and publication | Provide Review Bundle holds, handled event associations, approval snapshots, publication phases, commit SHAs, response IDs, and response-only recovery. |
| 9 | F24-F27 - Synchronization selection, preparation, conflict resolution, review, and publication | Provide independent synchronization operation/result identities, conflict evidence, exact source/head SHAs, merge publication phases, and no-force reconciliation rules. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F29 - Security and trust-boundary hardening | Audits recovery inputs, path and process handling, credentials, provider boundaries, redaction, and fail-closed behavior. |
| 2 | F30 - Windows packaging, end-to-end acceptance, and release readiness | Verifies recovery across packaged startup, tray operation, renderer closure, sleep, network loss, restart, and clean-machine workflows. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-04 | FR-02.1-FR-02.6, FR-05.1-FR-05.4, INV-01 | AC-02-AC-04, AC-12-AC-14 | Shared: F10/F12 own polling and scheduling semantics; F28 owns cross-process/wake/network reconciliation without a renderer. |
| APP-AC-16 | FR-01.4, FR-03.4, FR-06.5, INV-04 | AC-05, AC-08-AC-10, AC-20 | Shared: F02/F11 own legal holds; F28 preserves them through every recovery trigger and never releases them implicitly. |
| APP-AC-17 | FR-01.1-FR-01.6, FR-02.1, FR-04.1-FR-04.5, FR-07.1, INV-01 | AC-01-AC-05, AC-08, AC-11, AC-20 | Shared: F04 owns process/window lifetime; F28 rehydrates watcher, AI, worktree, validation, synchronization, and hold state after renderer closure or restart. |
| APP-AC-24 | FR-02.5, FR-06.5, INV-04 | AC-05-AC-06, AC-20 | Shared: F11 owns handled-version associations; F28 never reopens or re-analyzes a committed handled version during recovery. |
| APP-AC-25 | FR-02.4-FR-02.6, FR-06.5, INV-04 | AC-05-AC-07, AC-20 | Shared: F10/F11 retain feedback observed during a hold; F28 preserves that retained set and makes it eligible only after the owning explicit outcome. |
| APP-AC-49 | FR-03.1-FR-03.6, FR-07.1-FR-07.4, INV-05 | AC-11, AC-19-AC-20 | Shared: F25/F27 own synchronization-result truth and presentation; F28 restores the exact result, worktree, validation, reason, and next action after restart or closure. |
| APP-AC-53 | FR-06.1-FR-06.7, FR-07.2, NFR-03, INV-06 | AC-15-AC-19 | Shared: F23/F27 own publication idempotency for their workflows; F28 owns cross-feature reconciliation and duplicate-effect prevention after interruption. |
| APP-AC-54 | FR-04.1-FR-04.6, INV-07 | AC-08-AC-10, AC-16 | Shared: F17 owns budget accounting; F28 proves restart and recovery never reset or silently replenish it. |
| APP-AC-55 | FR-04.1-FR-04.6, FR-05.1-FR-05.4, INV-07 | AC-08-AC-10, AC-16 | Shared: F17 owns bounded turns and timeout reasons; F28 preserves consumed turns and stopped outcomes across lifecycle events. |
| APP-AC-57 | FR-04.2-FR-04.6, INV-03, INV-07 | AC-08-AC-10, AC-16 | Shared: F17 owns stop classification; F28 prevents restart, retry, or network recovery from bypassing a deterministic stop. |
| APP-AC-58 | FR-04.4-FR-04.6, FR-07.1-FR-07.4, INV-03 | AC-08-AC-10, AC-20 | Shared: F17 supplies complete turn evidence; F28 restores it and exposes only the explicit continuation/retry actions permitted by the owner. |
| APP-AC-68 | FR-06.1-FR-06.7, NFR-02-NFR-03, INV-02, INV-06 | AC-15-AC-19 | Shared: F23/F27 own publication phase/effect records; F28 reconciles known versus uncertain commits, pushes, and responses without duplicate publication. |

F28 does not claim ownership of polling, primary states, per-PR holds,
validation truth, AI semantic output, Review Bundle stale transitions, or
publication effect semantics. It owns the lifecycle recovery seam that makes
those existing contracts reliable together.

## Executive Summary

PRMonitor is intentionally a long-running local worker. A renderer window may
be closed, Windows may sleep, a network may disappear, or the process may stop
between two durable records and an external effect. Without a single recovery
contract, the application could lose feedback, reset an AI budget, overwrite a
worktree, publish a duplicate commit, post a duplicate response, or show a
successful result that was never reconciled.

F28 adds deterministic startup, wake, connectivity, and uncertain-outcome
recovery across the already-owned workflows. It scans durable intent and
reconciles each operation against authoritative local or remote evidence. It
automatically restores safe read-only scheduling and already-authorized
deterministic recovery where the outcome can be proven. It never treats a
renderer reload, a timeout, or an unknown provider result as permission to
start another AI segment. It preserves worktrees, budgets, holds, feedback
history, publication identities, and partial results when proof is unavailable.

The developer receives one truthful recovery view: what was interrupted, what
was proven, what remains uncertain, why the uncertainty matters, which evidence
was preserved, and the one permitted next action. Recovery is complete only
when it has either adopted a proven existing outcome, safely retried the same
deterministic intent, or left a durable actionable attention state.

## User Stories

### Keep monitoring alive without a window

- **US-01:** **GIVEN** the developer closes the visible window while PRMonitor is watching, **WHEN** the process remains running, **THEN** polling, scheduler deadlines, active deterministic work, and per-PR holds continue without renderer state.
  - **Acceptance Criteria:** AC-02-AC-05, AC-20.
- **US-02:** **GIVEN** the application restarts or wakes after sleep, **WHEN** recovery loads persisted scheduler state, **THEN** it restores due polling and pending batches without losing immutable feedback or creating duplicate requests.
  - **Acceptance Criteria:** AC-01-AC-07, AC-12-AC-14.

### Preserve human-controlled holds and work

- **US-03:** **GIVEN** a Review Bundle, stopped AI operation, or synchronization result requires attention, **WHEN** the renderer closes or the process restarts, **THEN** the same hold, worktree, history, budget, evidence, and permitted actions remain available.
  - **Acceptance Criteria:** AC-05, AC-08-AC-11, AC-19-AC-20.
- **US-04:** **GIVEN** new feedback arrives while a PR is held, **WHEN** recovery or polling observes it, **THEN** the new immutable version is retained separately and is not folded into, duplicated by, or allowed to bypass the active hold.
  - **Acceptance Criteria:** AC-05-AC-07.

### Stop AI safely after interruption

- **US-05:** **GIVEN** a provider turn may have started before a crash, timeout, or network loss, **WHEN** PRMonitor recovers, **THEN** it conservatively reconciles the turn as known, interrupted, or uncertain, preserves the worktree and consumed budget, and starts no replacement AI turn automatically.
  - **Acceptance Criteria:** AC-08-AC-10, AC-16.
- **US-06:** **GIVEN** the developer chooses Continue AI Work or Retry Resolution after reviewing the preserved evidence, **WHEN** the owner accepts the explicit action, **THEN** recovery creates exactly one new bounded segment with the recorded parent history and current allowed scope.
  - **Acceptance Criteria:** AC-09-AC-10, AC-16-AC-18.

### Reconcile deterministic and external effects

- **US-07:** **GIVEN** validation, Git, or worktree work was interrupted, **WHEN** recovery inspects actual state, **THEN** it classifies the operation from deterministic evidence and never treats an interrupted or missing result as a pass.
  - **Acceptance Criteria:** AC-11-AC-14, AC-19.
- **US-08:** **GIVEN** a commit, push, or GitHub response may have succeeded before its acknowledgement was lost, **WHEN** recovery runs, **THEN** it re-reads the exact target, adopts a unique proven effect, retries only a safe unperformed effect using the same identity, or stops as unknown without force-pushing or blind reposting.
  - **Acceptance Criteria:** AC-15-AC-19.
- **US-09:** **GIVEN** one synchronization or publication operation is uncertain, **WHEN** recovery reconciles it, **THEN** unrelated PRs, Review Bundles, synchronization results, and response effects remain isolated and reviewable.
  - **Acceptance Criteria:** AC-15-AC-20.

### Understand and act on recovery

- **US-10:** **GIVEN** recovery cannot prove a worktree or external outcome, **WHEN** the developer opens PRMonitor, **THEN** the application explains what happened, why it matters, what evidence is preserved, and which safe action is available.
  - **Acceptance Criteria:** AC-11, AC-15, AC-19-AC-20.
- **US-11:** **GIVEN** the application is offline or has just woken from sleep, **WHEN** recovery is in progress, **THEN** the user sees a bounded offline/retrying state rather than false success, busy-looping, or an unexplained frozen operation.
  - **Acceptance Criteria:** AC-12-AC-14, AC-20.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** durable records contain scheduled polls, pending batches, holds, active work, validation runs, worktrees, synchronization results, or publication intents, **WHEN** the main process starts, **THEN** it creates one bounded recovery session, loads the records in dependency order, and exposes a recovery summary before scheduling new work; a renderer is not required.
- **AC-02:** **GIVEN** the renderer closes while a watcher, deterministic operation, AI turn, validation run, synchronization result, or publication intent exists, **WHEN** no explicit Shutdown PRMonitor command was issued, **THEN** main-process work and durable state continue or remain recoverable, and renderer destruction does not cancel, release, reset, replace, or publish anything.
- **AC-03:** **GIVEN** a polling deadline, retry deadline, or review-batch quiet deadline is due before or during restart/sleep, **WHEN** F28 reconciles it, **THEN** it restores at most one equivalent F10/F12 request per managed-PR scope, preserves the exact pending version set, and does not mark feedback handled or dispatch automatic AI work without the F12/F11 gates.
- **AC-04:** **GIVEN** the process sleeps, wakes, or observes a wall-clock jump, **WHEN** recovery runs, **THEN** it performs one bounded timer/network reconciliation pass, recalculates due work from persisted UTC deadlines, prevents a catch-up storm, and preserves the global pause overlay and per-PR holds.
- **AC-05:** **GIVEN** a Review Bundle or `NEEDS_ATTENTION` result has a committed hold, **WHEN** the process restarts, wakes, loses its renderer, or cannot reach GitHub, **THEN** the hold and primary/overlay state remain unchanged; new remote versions are retained separately and no automatic analysis or worktree mutation starts for that PR.
- **AC-06:** **GIVEN** a handled event version is associated with a published or discarded Review Bundle, **WHEN** startup, polling, or recovery re-reads eligibility, **THEN** the version remains handled exactly once and is not re-added to a new automatic batch.
- **AC-07:** **GIVEN** a new feedback version is observed while a PR hold is active or recovery is incomplete, **WHEN** F10/F11 return it, **THEN** the version is persisted as retained/deferred evidence and becomes eligible only after the owning explicit outcome releases the hold; recovery never drops it or attaches it to the active bundle.
- **AC-08:** **GIVEN** an AI Work Operation has a persisted segment or turn intent, **WHEN** startup, wake, timeout, cancellation, or network recovery finds that the provider outcome is incomplete or uncertain, **THEN** it does not invoke the provider again automatically, does not reset the consumed count or budget, preserves the worktree and reports, and exposes the F17 stop reason and permitted explicit action.
- **AC-09:** **GIVEN** an AI turn intent was committed before an interruption, **WHEN** deterministic inspection proves the operation-specific completion predicate from actual worktree/Git/validation evidence, **THEN** recovery may finish only the deterministic inspection/reporting phase without starting AI; otherwise it records an interrupted or uncertain attention outcome.
- **AC-10:** **GIVEN** the developer explicitly authorizes Continue AI Work or Retry Resolution, **WHEN** recovery starts the action, **THEN** it shows the prior reports, remaining issues, usage, policy/profile snapshot, and worktree condition, consumes the authorization once, and starts no segment broader than the recorded scope or remaining allowed budget.
- **AC-11:** **GIVEN** an operation-owned worktree is missing, no longer canonical, owned by another operation, or has an unprovable Git identity, **WHEN** recovery inspects it, **THEN** it records a blocking `NEEDS_ATTENTION`/synchronization attention reason, preserves the durable history, does not recreate, reset, delete, overwrite, or substitute a path, and exposes inspect/re-evaluate/discard/manual-repair guidance according to the owner.
- **AC-12:** **GIVEN** a validation run or command was running when the process stopped, **WHEN** F14 recovery is invoked, **THEN** it records `interrupted` with `APPLICATION_RESTARTED` or the precise lifecycle reason, marks later steps `not_run`, and does not claim a pass or silently rerun the command.
- **AC-13:** **GIVEN** the network is unavailable or a provider/GitHub request fails transiently, **WHEN** recovery classifies the outcome, **THEN** it persists bounded retry state and a safe offline/retry reason, uses capped backoff, avoids busy looping, does not mark remote input handled, and does not create a duplicate external effect.
- **AC-14:** **GIVEN** connectivity returns after offline or sleep recovery, **WHEN** deterministic work resumes, **THEN** it revalidates the relevant revision, hold, operation, and exact external identity before continuing; stale, closed, merged, or changed targets remain blocked rather than being silently refreshed.
- **AC-15:** **GIVEN** a Review Bundle publication may have created a local commit, pushed a commit, or posted a response before the result was lost, **WHEN** recovery reconciles it, **THEN** it uses the original publication/response identity and exact target: a matching commit/ref/response is adopted, an unchanged expected ref may be safely retried, and divergent or ambiguous evidence becomes `UNKNOWN`/`PUBLISHED_WITH_ERRORS` without force push or blind repost.
- **AC-16:** **GIVEN** a synchronization publication may have created or pushed a merge commit before acknowledgement was lost, **WHEN** recovery reconciles it, **THEN** it adopts only the recorded matching commit/ref, retries only the same non-force expected-old-SHA effect when safe, and keeps the result non-published/attention-required for any divergent or ambiguous target.
- **AC-17:** **GIVEN** a recovery request or effect is replayed because of renderer replacement, restart, sleep, retry, or duplicate scheduling, **WHEN** it has the same durable identity and input revision, **THEN** recovery returns the existing committed outcome or one in-progress recovery record and does not create a second worktree, AI segment, validation run, commit, push, response effect, or hold release.
- **AC-18:** **GIVEN** a publication effect is known to have completed but selected responses remain failed or unknown, **WHEN** recovery finalizes the Review Bundle, **THEN** it records `PUBLISHED_WITH_ERRORS`, preserves the known commit/no-code result and every response state, releases the hold only through F23's legal terminal handoff, and exposes response-only recovery without republishing code.
- **AC-19:** **GIVEN** an explicit shutdown, cancellation, persistence failure, or recovery failure occurs before or after an effect boundary, **WHEN** F28 records the outcome, **THEN** it distinguishes no-effect, committed, interrupted, and uncertain states, preserves evidence, does not claim a rollback that did not occur, and offers only a bounded permitted next action.
- **AC-20:** **GIVEN** the recovery read model is opened after restart or while offline, **WHEN** the developer reviews it with keyboard navigation, a screen reader, forced colors, reduced motion, zoom, or a narrow window, **THEN** it distinguishes recovery, offline, ready, attention, stale, interrupted, and published-with-errors states without color-only meaning or horizontal overflow and shows what/why/evidence/next-action data.
- **AC-21:** **GIVEN** recovery scans, state projections, activity, or diagnostics contain provider, GitHub, OS, or process data, **WHEN** the data crosses a persistence, IPC, UI, or log boundary, **THEN** it is bounded and redacted and contains no credential, authorization header, provider SDK object, raw prompt, uncontrolled environment value, or arbitrary command/path.

## Functional Requirements

### FR-01: Recovery authority and startup session

- FR-01.1: F28 SHALL run recovery in the Electron main process using F03 durable records and SHALL remain functional without a renderer window.
- FR-01.2: F28 SHALL create one durable recovery-session identity per startup/wake/connectivity-recovery pass, record the trigger and application lifecycle evidence, and coalesce equivalent concurrent recovery requests.
- FR-01.3: F28 SHALL reconcile records in dependency order: database/schema and recovery session, lifecycle/shutdown state, scheduler/polling, holds and batches, worktree/validation, AI operations, synchronization results, Review Bundle publication, and synchronization publication; each step SHALL consume typed owner contracts rather than activity text.
- FR-01.4: F28 SHALL preserve F02 primary PR states, synchronization overlays, global pause, Review Bundle stages, and per-PR holds unless an owning feature returns a legal committed transition; recovery SHALL not infer a release from elapsed time, window closure, or startup.
- FR-01.5: F28 SHALL persist recovery intent and the immutable input revision before invoking an external or mutating owner operation, and SHALL record committed, interrupted, uncertain, skipped, and blocked outcomes with bounded what/why/evidence/next-action data.
- FR-01.6: F28 SHALL make recovery scans, retries, and terminalization idempotent by stable operation/effect identity and expected revision; a duplicate session SHALL return the existing committed outcome or join the in-progress session.
- FR-01.7: F28 SHALL not repair, rewrite, delete, or silently downgrade durable history when a record is malformed, missing, or inconsistent; it SHALL preserve the record and expose a bounded actionable recovery reason.

### FR-02: Polling, scheduler, holds, and feedback history

- FR-02.1: F28 SHALL restore F10/F12 polling deadlines, conditional-request checkpoints, pagination checkpoints, retry state, pending Review Batch deadlines, exact immutable version memberships, pause state, and dispatch identities from durable records.
- FR-02.2: F28 SHALL evaluate due work against persisted UTC deadlines and a monotonic recovery clock, tolerate sleep and wall-clock jumps, and create at most one equivalent poll or dispatch request for a managed-PR scope.
- FR-02.3: A retryable network, rate-limit, timeout, or persistence failure SHALL use the owning bounded backoff contract and SHALL not busy-loop, fabricate a successful poll, or mark an unobserved version handled.
- FR-02.4: F28 SHALL recheck F11 eligibility, per-PR hold, F02 primary state, and F12 pause/dispatch gates before any recovered automatic handoff; an expired batch SHALL remain pending or deferred when a gate is closed.
- FR-02.5: F28 SHALL preserve the exact handled association for every immutable event version and SHALL never make a published/discarded bundle's handled version eligible again solely because the process restarted or a poll response was uncertain.
- FR-02.6: F28 SHALL preserve new versions observed during `WORKING`, `READY_FOR_REVIEW`, `NEEDS_ATTENTION`, publication, or recovery as separate retained evidence and SHALL hand them back to F11/F12 only after the owning explicit outcome releases the hold.
- FR-02.7: F28 recovery of polling and scheduling SHALL not invoke an AI provider, mutate a worktree, run validation, post a response, commit, push, merge, or publish.

### FR-03: Worktree, Git, validation, and local-process recovery

- FR-03.1: F28 SHALL ask F13 for a fresh operation-owned worktree condition, canonical path, repository/ref identity, current HEAD, baseline/revision, ownership, and dirty/overlap evidence before adopting or continuing local work.
- FR-03.2: A missing, moved, inaccessible, cross-owned, path-escaping, stale, or identity-mismatched worktree SHALL become a blocking owner-specific attention result; F28 SHALL not create a replacement, reset, clean, delete, overwrite, or fall back to the developer clone.
- FR-03.3: F28 SHALL distinguish a committed local Git/merge result, an interrupted local process, a missing result, and an unknown local outcome using F13 evidence; it SHALL not treat a status label, activity entry, or provider claim as proof.
- FR-03.4: F28 SHALL invoke F14's restart/cancellation contract for running validation and SHALL preserve interrupted step evidence and later `not_run` steps; it SHALL not silently rerun a command or turn an interrupted result into `passed`.
- FR-03.5: F28 SHALL preserve manual edits, dirty state, attribution, overlap evidence, diffs, and worktree history across recovery; any destructive clear or replacement remains an explicit F13/F20/F22 action.
- FR-03.6: F28 SHALL expose a typed local-recovery result containing worktree condition, validation state, known Git result, preserved evidence, owner reason, and permitted next actions without exposing arbitrary paths or commands.

### FR-04: AI operation, turn, budget, and provider recovery

- FR-04.1: F28 SHALL consume F17's persisted parent operation, segment, turn intent, budget, profile/policy/context snapshot, provider conversation reference, usage, report, completion-predicate, and stop-reason records without changing F17's accounting rules.
- FR-04.2: If a mutating or read-only provider invocation may have started and its terminal result is not durably known, F28 SHALL conservatively classify the turn as interrupted or uncertain, preserve the worktree and evidence, and SHALL not invoke another provider turn automatically.
- FR-04.3: A provider turn intent SHALL remain consumed according to F17's conservative accounting after uncertain start; restart, sleep, network recovery, and renderer recreation SHALL never reset or replenish the parent budget.
- FR-04.4: If deterministic evidence proves the operation-specific completion predicate after an interrupted turn, F28 MAY complete only the owner-required inspection/reporting phase without invoking AI; otherwise the operation SHALL remain reviewable `NEEDS_ATTENTION` with the F17 reason.
- FR-04.5: F28 SHALL require an explicit F17-authorized **Continue AI Work**, **Retry Resolution**, or new-operation action before any replacement/continuation AI turn, and SHALL pass the preserved history, remaining budget, immutable scope, and current worktree condition to F17.
- FR-04.6: F28 SHALL not use a provider conversation reference, model claim, partial stream, or network retry as implicit authorization to replay a turn or to broaden the AI Execution Policy, worktree, credentials, or publication capability.
- FR-04.7: F28 SHALL expose read-only proposal interruption separately from worktree-mutating interruption, including the fact that a valid no-code semantic result may complete only when F17's deterministic completion predicate is proven.

### FR-05: Sleep, connectivity, and bounded retry recovery

- FR-05.1: F28 SHALL consume F04 sleep/wake and lifecycle signals and SHALL coalesce duplicate wake/online events into one bounded reconciliation pass per affected scope.
- FR-05.2: F28 SHALL classify connectivity failures as retryable, authentication/configuration, stale-target, cancellation, or unknown according to typed owner outcomes; it SHALL not use string matching over free-form errors as the authoritative classification.
- FR-05.3: Retryable external work SHALL use a capped, persisted, owner-compatible backoff with a next-attempt time and attempt count; the same intent SHALL be retried only when its owner proves that retry is safe.
- FR-05.4: While offline or after wake, F28 SHALL avoid a catch-up storm, preserve paused/held work, and expose bounded connectivity state and next retry time; it SHALL not mark remote input or an external effect successful without evidence.
- FR-05.5: When connectivity returns, F28 SHALL revalidate remote identities, expected revisions, PR open/merged state, and publication/worktree gates before continuing; a changed or unavailable target SHALL remain stale/unknown/attention-required.
- FR-05.6: F28 SHALL never treat process shutdown, cancellation, network loss, or sleep as proof that an in-flight external operation did not happen.

### FR-06: Uncertain local and remote effect reconciliation

- FR-06.1: F28 SHALL reconcile each F23/F27 publication using its original approval, phase, stable idempotency key, effect identity, exact target, expected old SHA, candidate/tree fingerprint, known commit SHA, response IDs, and prior reconciliation evidence.
- FR-06.2: For a possible local commit or merge commit, F28 SHALL adopt only an exact matching commit proven from the operation-owned worktree/repository and recorded candidate/parent/tree identity; absent evidence may be retried through the owner, while ambiguous evidence remains attention-required.
- FR-06.3: For a possible non-force push, F28 SHALL fetch and inspect the exact remote ref: a ref equal to the recorded commit is adopted, a ref equal to the expected old SHA may reuse the same safe push intent, and any other/deleted/unavailable value becomes stale or unknown without force push.
- FR-06.4: For a possible GitHub response, F28 SHALL use F23's per-response identity and exact target reconciliation; it SHALL adopt only a unique matching response, retry only a confirmed-not-posted/failed effect with the same identity, and never blind-repost an unknown response.
- FR-06.5: F28 SHALL preserve the ordering boundary that responses begin only after Review Bundle code is pushed/verified or `NO_CODE_CHANGE` is durable, and SHALL never republish code while recovering response-only failures.
- FR-06.6: If code/no-code publication is known but one or more selected responses remain failed or unknown, F28 SHALL hand the state to F23 for `PUBLISHED_WITH_ERRORS` and response-only recovery; it SHALL not release the hold as fully published or invent a response ID.
- FR-06.7: F28 SHALL reconcile synchronization publication independently from Review Bundle publication; one result's uncertain commit/push/hold/invalidation outcome SHALL not change another result or bundle.
- FR-06.8: F28 SHALL release a hold or mark a workflow terminal only through the owning F11/F23/F27 legal transition after all required durable evidence is committed.

### FR-07: Recovery read model, diagnostics, and user action

- FR-07.1: F28 SHALL expose a versioned recovery read model with trigger, scope, current owner state, recovery stage, attempt count, last known outcome, preserved evidence, what happened, why it matters, and permitted next action.
- FR-07.2: F28 SHALL distinguish automatic safe recovery, waiting for network, interrupted validation, stopped AI work, missing/unsafe worktree, stale target, uncertain external effect, published-with-errors, and unreconciled shutdown without relying on color or free-form activity text.
- FR-07.3: F28 SHALL provide F19/F20/F27 with stable deep-link targets and notification-ready outcome data, while those features retain ownership of tray, notification, layout, diff, and action presentation.
- FR-07.4: F28 SHALL emit bounded F09 activity for recovery-session start/end, owner scan, retry/backoff, adoption, block, uncertainty, and explicit-action handoff; activity SHALL never be used to reconstruct authoritative state.
- FR-07.5: Recovery commands SHALL be validated through F04/F02/F03 revision and authorization contracts; a renderer or tray request SHALL not supply arbitrary paths, commands, credentials, provider settings, or publication effects.

### FR-08: Security, bounds, and capability isolation

- FR-08.1: F28 SHALL keep GitHub and provider credentials behind their existing deterministic boundaries and SHALL not persist or display them in recovery records, activity, prompts, structured output, or renderer state.
- FR-08.2: F28 SHALL bound recovery-scan cardinality, retained diagnostics, retry counts, serialized remote evidence, process metadata, and UI projections, and SHALL fail closed when a bound or redaction guarantee cannot be met.
- FR-08.3: F28 SHALL use typed owner ports and SHALL not import provider SDKs, accept raw GitHub payloads, execute arbitrary commands, open arbitrary paths, reset worktrees, force-push, or post responses directly.
- FR-08.4: F28 SHALL preserve operation/repository/branch/path identity and correlation fields sufficient to prevent cross-PR, cross-worktree, cross-publication, and cross-response recovery.

## Non-Functional Requirements

- **NFR-01: Determinism** - Given the same durable records, typed owner outcomes, authoritative local/remote observations, lifecycle trigger, and injected clock, F28 SHALL produce the same recovery classification, next action, retry eligibility, and terminal handoff without AI judgment.
- **NFR-02: Durability** - Recovery sessions, intent revisions, attempts, effect classifications, known IDs, budgets, holds, retained feedback, and actionable reasons SHALL survive renderer closure, process restart, sleep, and network interruption.
- **NFR-03: Idempotency and uncertain outcomes** - Equal recovery requests and retries SHALL reuse the same durable identities; no external effect SHALL be repeated solely because its acknowledgement or local state was lost.
- **NFR-04: Bounded liveness** - Recovery SHALL use finite scans, capped backoff, bounded concurrency, one active recovery per scope, and explicit attention outcomes rather than infinite retry or busy loops.
- **NFR-05: Per-operation isolation** - A failed, missing, stale, offline, or uncertain operation SHALL not overwrite or release another PR's worktree, hold, batch, AI budget, validation, result, publication, response, or history.
- **NFR-06: Lifecycle resilience** - The feature SHALL behave consistently with no renderer, after Windows sleep/wake, across a current-time jump, after orderly or abrupt restart, and after online/offline transitions.
- **NFR-07: Explainability and accessibility** - Every blocked or uncertain recovery outcome SHALL expose bounded what/why/evidence/next-action data that remains understandable with keyboard navigation, screen readers, forced colors, reduced motion, zoom, and narrow windows.
- **NFR-08: Security and privacy** - Recovery data and diagnostics SHALL exclude credentials, raw authorization data, provider SDK objects, raw prompts, uncontrolled environment values, arbitrary commands, and unbounded remote payloads.
- **NFR-09: Testability** - Clocks, lifecycle signals, persistence, owner ports, network state, local Git evidence, remote observations, process interruption points, and fault injection SHALL be injectable without live credentials, AI, GitHub, or publication effects.

## Invariants

- **INV-01:** F03 and the Electron main process are authoritative for recovery intent, session identity, attempt state, and outcome; renderer memory, notifications, and activity are never authoritative.
- **INV-02:** Recovery intent and immutable input/effect snapshots are committed before F28 relies on the represented owner call or external effect.
- **INV-03:** A stopped, timed-out, cancelled, interrupted, or uncertain AI turn never authorizes an automatic replacement turn, and its consumed budget cannot decrease.
- **INV-04:** Recovery never releases a per-PR hold, marks an event handled, or changes a primary/overlay state except through the owning legal transition with a durable outcome.
- **INV-05:** A missing, moved, dirty, overlapping, or unknown worktree is preserved and surfaced; F28 never guesses ownership or silently resets, replaces, deletes, or overwrites user work.
- **INV-06:** Every possible external effect is reconciled from exact local/remote evidence before retry; a divergent or ambiguous result is never force-pushed, blind-reposted, or represented as success.
- **INV-07:** AI turn budgets, profile/policy snapshots, usage, reports, and stop reasons are monotonic and survive restart, sleep, offline recovery, renderer replacement, and continuation.
- **INV-08:** Network loss, sleep, timeout, or process exit never marks remote feedback handled or an external publication complete without proof.
- **INV-09:** Review Bundle publication and synchronization publication remain separate aggregates with separate locks, effects, histories, and recovery outcomes.
- **INV-10:** Deterministic recovery may inspect, classify, adopt, or safely retry an already-authorized intent, but it may not invent semantic output, approval, validation success, or publication authority.
- **INV-11:** Recovery operates only within the recorded repository, branch, operation, worktree, response target, and correlation identity; same-named resources are not substitutes.
- **INV-12:** Recovery evidence is bounded, redacted, provider-neutral, and safe to expose through the existing main/preload/read-model boundaries.

## Out of Scope

- Automatic rebase, automatic conflict resolution after restart, force push, blind `ours`/`theirs` selection, or any new autonomous publication authority.
- Automatically replaying any AI provider turn whose start or result is uncertain; explicit F17 continuation/retry remains required.
- Automatically rerunning an interrupted validation command; F14 owns its interrupted result and any later explicit rerun.
- Repairing corrupted SQLite data, rewriting migrations, or inventing missing historical records; F03 owns database repair and migration policy.
- Changing polling, event eligibility, batching, hold, primary-state, stale-work, AI-budget, validation, or publication semantics owned by F02/F10-F27.
- OS boot auto-start, cloud backup, webhook delivery, cross-device recovery, or recovery from a machine whose local worktrees and database are unavailable.
- Semantic interpretation of reviewer feedback, code meaning, conflict intent, or provider prose.
- Deleting orphaned worktrees automatically; cleanup requires an explicit owner-specific action after safe identity verification.

## Product Decisions

- **PD-01: Automatically recover only deterministic, already-authorized work** - Polling, timer reconstruction, local inspection, validation interruption finalization, and exact publication reconciliation may proceed from committed intent. Recovery never creates a new approval, AI authorization, or semantic result.
- **PD-02: Any uncertain AI turn requires explicit human continuation or retry** - A provider conversation reference or partial result is not enough to replay a turn, even when the operation still has budget.
- **PD-03: Preserve rather than guess when a worktree is missing or ambiguous** - The application keeps the path/history and exposes safe inspection, manual repair, re-evaluation, or discard actions; it never silently creates a replacement or clears a dirty path.
- **PD-04: Sleep and connectivity recovery is one bounded reconciliation pass** - Wake and online events coalesce, expired timers do not create a request storm, and ordinary work resumes only after the existing owner gates pass.
- **PD-05: Exact remote evidence decides uncertain publication outcomes** - A matching ref/commit/response is adopted; an unchanged expected ref can be retried when the owner permits; any divergent or ambiguous state remains attention-required.
- **PD-06: Recovery keeps Review Bundle and synchronization publication independent** - A failure or uncertain result for one workflow cannot release, rewrite, or retry the other workflow's effects.

## Implementation Decisions

- **IMP-01: Add a main-process RecoveryCoordinator with typed owner adapters** - The coordinator owns trigger coalescing, ordered scans, recovery-session records, and cross-feature handoffs; F02-F27 services remain authoritative for their own state and effects.
- **IMP-02: Use recovery attempts and effect classifications as append-only evidence** - Each attempt records trigger, expected revision, observed evidence, classification, retry decision, and next action; it is not a replacement state machine.
- **IMP-03: Use injected UTC and monotonic clocks** - UTC deadlines remain user-visible and durable; monotonic elapsed time prevents sleep/wall-clock jumps from causing duplicate or runaway work.
- **IMP-04: Use stable scope keys and owner idempotency identities** - Recovery keys include the feature operation, repository/ref identity, worktree/effect identity, and expected revision; same-named branches or paths cannot collide.
- **IMP-05: Preserve owner-specific recovery classifications** - F17, F14, F23, and F27 retain their vocabulary; F28 adds only a bounded cross-feature recovery envelope and does not translate attention into success.
- **IMP-06: Recover publication through existing F23/F27 ports** - F28 never calls GitHub mutation or Git publication directly; it supplies the persisted intent and consumes typed adopt/retry/unknown outcomes.
- **IMP-07: Reuse existing notification, activity, and review read models** - F19/F20/F27 own visual delivery; F28 supplies stable targets, reasons, evidence references, and permitted actions.

## Testing Decisions

- **TST-01: Deep-test the recovery reducer and effect classifiers** - Pure tests cover ordering, idempotency, deadlines, lifecycle triggers, hold preservation, retry eligibility, and known/unknown local/remote outcome matrices.
- **TST-02: Use fault-injected contract tests at every durable boundary** - Tests stop the process before and after intent, owner call, local commit, remote push, response request, and terminal handoff commits.
- **TST-03: Use temporary Git repositories and fake provider/GitHub ports** - Recovery tests must prove exact identity and no-duplicate behavior without live credentials, AI calls, GitHub, or publication.
- **TST-04: Keep UI rendering tests at the owning surfaces** - F28 tests the versioned recovery read model and accessibility semantics; F19/F20/F27 own full layout, deep-link, notification, diff, and interaction tests.
- **TST-05: Include Windows lifecycle and sleep/network simulation in release evidence** - F30 owns packaged-machine acceptance; F28 supplies deterministic fixtures for renderer closure, abrupt restart, wake, offline, online, wall-clock jumps, and current-desktop reopening.

## Proposed Modules

- **MOD-01: RecoveryCoordinator** - Orders startup, wake, online, and explicit recovery scans and coalesces equivalent sessions.
- **MOD-02: RecoverySessionRepository** - Persists session, attempt, scope, revision, trigger, bounded evidence, classification, and next-action records through F03.
- **MOD-03: SchedulerRecoveryAdapter** - Reconciles F10/F12 deadlines, batches, holds, pause, retry, and dispatch identities without AI or mutation.
- **MOD-04: LocalWorkRecoveryAdapter** - Consumes F13/F14 condition and interruption contracts for worktrees, Git, validation, and preserved manual edits.
- **MOD-05: AIRecoveryAdapter** - Consumes F17 operation/segment/turn records, preserves budgets, and routes explicit continuation/retry only.
- **MOD-06: PublicationRecoveryAdapter** - Consumes F23/F27 effect identities and typed local/remote reconciliation outcomes.
- **MOD-07: ConnectivityRecoveryPolicy** - Coalesces sleep/online events and calculates bounded persisted retry eligibility.
- **MOD-08: RecoveryProjection** - Produces renderer/tray/notification-safe what/why/evidence/next-action data and deep-link targets.

## Workflows

### Workflow 1: Startup or wake recovery

```text
1. Main process opens the database and commits a recovery-session identity.
2. Recovery loads persisted versions, pause/hold state, schedules, operations,
   worktrees, validation, AI turns, synchronization results, and publications.
3. Scheduler and polling records are reconciled first; due work is coalesced.
4. Holds and retained feedback are checked without releasing or re-batching them.
5. Local worktrees and validation runs are inspected; missing/dirty/unknown
   conditions become owner-specific attention outcomes.
6. AI operations are adopted only through deterministic inspection; uncertain
   turns remain stopped and require an explicit F17 action.
7. Review Bundle and synchronization publication intents are reconciled using
   exact local/remote evidence and original identities.
8. The recovery projection and bounded activity are committed; normal scheduling
   resumes only for scopes whose owner gates are open.
```

### Workflow 2: Offline and online recovery

```text
1. A typed network failure marks the affected scope waiting/offline with a
   capped next-attempt time; no event or effect is marked successful.
2. Additional offline/wake signals join the existing recovery session.
3. When connectivity returns, F28 re-fetches the exact remote identity required
   by the owner and checks PR/ref/hold/revision gates.
4. A safe pending deterministic intent is retried with the same identity.
5. A changed, unavailable, or ambiguous target becomes stale/unknown/attention-
   required and remains inspectable without a blind retry.
```

### Workflow 3: Interrupted AI work

```text
1. F17 has persisted a segment and turn intent, then the process/connection
   stops before a terminal provider result is known.
2. Recovery inspects the operation-owned worktree and available provider-neutral
   evidence without replaying the provider turn.
3. If the completion predicate is provably satisfied, recovery records the
   deterministic observation; otherwise it preserves the worktree and marks
   the operation NEEDS_ATTENTION with F17's reason.
4. The UI shows reports, usage, budget, remaining issues, and policy/profile
   snapshots before exposing Continue AI Work or Retry Resolution.
5. F17 consumes the action once and starts a new bounded segment only after the
   user authorizes it.
```

### Workflow 4: Uncertain Review Bundle publication

```text
1. F23 has a durable publication phase and effect identity, but the response
   to a local commit, push, or GitHub response is lost.
2. Recovery asks F13/F06 for exact local/remote evidence through F23.
3. A matching commit/ref/response is adopted; an expected-old ref may retry
   only the same safe effect; ambiguity remains UNKNOWN.
4. Code success plus unresolved responses becomes PUBLISHED_WITH_ERRORS and
   exposes response-only recovery; code is never republished.
5. F23 performs the legal terminal/hold handoff only after the outcome is
   durably recorded.
```

### Workflow 5: Missing operation worktree

```text
1. Recovery loads a persisted worktree path and operation identity.
2. F13 cannot prove that the path exists, is canonical, or belongs to the
   operation.
3. Recovery preserves the history and path reference, marks the owner result
   attention-required, and blocks AI, validation, clear, discard, and publish
   effects that require the missing identity.
4. The user receives safe inspect/manual-repair/re-evaluate/discard guidance;
   no replacement path is created automatically.
```

## Contract-Test Criteria

- **CT-F28-01:** Recovery-session ordering, coalescing, expected-revision conflicts, and startup/wake idempotency are deterministic and main-process-only.
- **CT-F28-02:** Polling deadlines, quiet periods, pause, held versions, handled associations, and network backoff recover without duplicate polls, batches, claims, AI dispatches, or lost feedback.
- **CT-F28-03:** Renderer closure, orderly shutdown, abrupt restart, and sleep/wake preserve primary state, overlays, holds, worktrees, and durable operation identities.
- **CT-F28-04:** Missing, moved, cross-owned, dirty, overlapping, and unknown worktrees block unsafe actions and preserve developer edits and evidence.
- **CT-F28-05:** Running validation becomes interrupted with later steps not run; no recovery path turns it into a pass or silently reruns it.
- **CT-F28-06:** AI turn interruption/uncertainty never starts a duplicate provider turn, never resets budget/usage, and exposes explicit continuation/retry with complete prior reports.
- **CT-F28-07:** Local commit/merge, non-force push, and remote response fault matrices adopt exact matching effects, safely retry only proven-unperformed effects, and classify divergent evidence as unknown/stale.
- **CT-F28-08:** Review Bundle and synchronization publication recover independently; response-only recovery cannot republish code and one PR cannot affect a sibling.
- **CT-F28-09:** Offline/online and wall-clock/sleep tests use capped backoff and one reconciliation pass without catch-up storms or false success.
- **CT-F28-10:** Recovery read models, activities, IPC, and evidence are bounded, redacted, keyboard/screen-reader usable, and free of credentials, provider SDK objects, arbitrary paths, commands, and publication capability.

## Requirement Traceability

| Requirement family | Observable acceptance / contract evidence |
|---|---|
| FR-01 | AC-01-AC-02, AC-17, AC-19-AC-21; CT-F28-01, CT-F28-03 |
| FR-02 | AC-03-AC-07, AC-12-AC-14, AC-17; CT-F28-02, CT-F28-09 |
| FR-03 | AC-09, AC-11-AC-14, AC-19; CT-F28-04, CT-F28-05 |
| FR-04 | AC-08-AC-10, AC-16, AC-20; CT-F28-06 |
| FR-05 | AC-04, AC-12-AC-14, AC-19; CT-F28-09 |
| FR-06 | AC-15-AC-19; CT-F28-07, CT-F28-08 |
| FR-07 | AC-01, AC-08, AC-11, AC-15, AC-19-AC-21; CT-F28-01, CT-F28-10 |
| FR-08 | AC-11, AC-15-AC-17, AC-21; CT-F28-04, CT-F28-10 |
| NFR-01-NFR-09 | AC-01-AC-21; CT-F28-01-CT-F28-10 |
| INV-01-INV-12 | AC-01-AC-21; CT-F28-01-CT-F28-10 |

