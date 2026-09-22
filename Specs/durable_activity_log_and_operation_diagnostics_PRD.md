# F09 Durable Activity Log and Operation Diagnostics - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F03 - SQLite persistence, migrations, and transactional repositories | Provides the versioned local database, transaction boundary, existing `activity_events` storage seam, safe codecs, and restart-safe repositories. |
| 2 | F04 - Persistent Electron shell, IPC boundary, and Windows virtual-desktop spike | Provides the main-process lifetime, validated preload/IPC boundary, renderer recreation, and provider-neutral navigation targets. |
| 3 | F08 - Managed-PR inbox and primary review-state presentation | Provides the managed-PR identity/read-model conventions and the application surface from which a diagnostic view can be reached without making activity text authoritative. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F10-F12 - Polling, eligibility, batching, and pause | Append polling, feedback, batching, hold, and scheduling events with stable operation/correlation identities. |
| 2 | F13-F18 - Git, validation, AI, and Review Bundle preparation | Append worktree, validation, AI-turn, proposal, implementation, and review-operation diagnostics. |
| 3 | F19 - System tray, native notifications, deep links, and shutdown | Records notification/lifecycle outcomes and may open a diagnostic target without exposing arbitrary routes. |
| 4 | F20-F23 - Review Bundle review and publication | Records review, response, publication, and uncertain-outcome diagnostics while retaining the authoritative Review Bundle/publication records. |
| 5 | F24-F27 - Managed PR branch synchronization | Records synchronization, conflict, consultation, validation, and publication diagnostics for each independently reviewable PR result. |
| 6 | F28-F30 - Recovery, security, and release readiness | Uses bounded diagnostics for recovery and support evidence and hardens redaction, retention, packaging, and end-to-end behavior. |

## Application Requirements Covered

F09 is a cross-cutting diagnostic enabler. It has no unique MVP acceptance criterion that it can close by itself. The mappings below identify the observable diagnostic contribution only; the owning workflow feature remains responsible for the behavior described by each application criterion. An activity event, timeline entry, or viewer result must never be treated as proof that the owning workflow succeeded.

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-04, APP-AC-05, APP-AC-06, APP-AC-08, APP-AC-09 | FR-03.1-FR-03.4, FR-04.1-FR-04.3 | AC-03-AC-05, AC-13, AC-16 | Shared diagnostic enabler: F09 records and displays polling/feedback/batching outcomes; F10-F12 own polling, token avoidance, eligibility, and scheduling. |
| APP-AC-13, APP-AC-14, APP-AC-15 | FR-03.2-FR-04.4 | AC-03-AC-05, AC-12-AC-13 | Shared diagnostic enabler: F09 correlates validation, Review Bundle, and notification activity; F14/F18/F19 own real validation, bundle, and notification behavior. |
| APP-AC-16, APP-AC-17, APP-AC-24, APP-AC-25, APP-AC-30 | FR-02.1-FR-03.4, FR-08.1-FR-08.4, INV-01, INV-03 | AC-06-AC-10, AC-16 | Shared diagnostic enabler: F09 preserves hold, restart, handled-event, and lifecycle evidence; F04/F11/F18 own lifecycle and hold semantics. |
| APP-AC-49, APP-AC-53 | FR-02.1-FR-02.4, FR-04.1-FR-04.5, FR-06.2 | AC-04-AC-10, AC-14-AC-16 | Shared diagnostic enabler: F09 links synchronization/retry attempts; F24-F27 and publication services own result truth and idempotent external effects. |
| APP-AC-54, APP-AC-55, APP-AC-56, APP-AC-57, APP-AC-58, APP-AC-62, APP-AC-64 | FR-03.2-FR-04.3, FR-07.1-FR-08.3 | AC-03-AC-05, AC-08-AC-12 | Shared diagnostic enabler: F09 shows bounded AI-operation activity and safe usage summaries; F15-F17/F03 own profiles, budgets, reports, and authoritative provider-neutral records. |
| APP-AC-65, APP-AC-68, APP-AC-69, APP-AC-70, APP-AC-71, APP-AC-72, APP-AC-73, APP-AC-75, APP-AC-76, APP-AC-77 | FR-01.1-FR-03.4, FR-04.1-FR-07.4 | AC-01-AC-16 | Shared diagnostic enabler: F09 records safe, correlated evidence for polling resources, publication recovery, immutable feedback, policy boundaries, staged review, validation, and conflict outcomes; the respective workflow features own the acceptance criteria and state transitions. |

F09 does not claim APP-AC-01, APP-AC-02, APP-AC-03, APP-AC-07, APP-AC-10-APP-AC-12, APP-AC-18-APP-AC-23, APP-AC-26-APP-29, APP-AC-31-APP-AC-48, APP-AC-50-APP-AC-52, APP-AC-59-APP-AC-61, APP-AC-63, APP-AC-66-APP-AC-67, or APP-AC-74 as primary ownership. Those criteria remain owned by authentication, managed-PR, polling/eligibility, Git/worktree, AI, review, synchronization, validation, publication, or configuration features.

## Executive Summary

PRMonitor continues working when its window is closed, and many operations cross several deterministic and AI-assisted stages. A developer needs to understand what happened after returning to the application, especially when a network request, validation command, AI turn, notification, synchronization, or publication attempt failed or produced an uncertain result. Unstructured console output is transient, difficult to correlate, unsafe to show, and cannot be the source of application state.

F09 provides a lightweight durable activity history and diagnostic viewer. It records bounded structured events with stable correlation identities, timestamps, severity, reason codes, safe details, and links to the authoritative record that owns the operation. A developer can inspect a filtered timeline for a PR, operation, work item, or correlation chain after renderer closure or process restart. The same contract is usable by polling, batching, AI, validation, notification, synchronization, and publication features.

F09 is deliberately an evidence and explainability layer. Domain state, Review Bundles, validation results, AI Work Reports, synchronization results, publication records, and remote event versions remain authoritative in their owning contracts. No workflow may parse an activity message to decide whether work succeeded, and opening or filtering the viewer cannot start, cancel, approve, publish, or mutate work.

## User Stories

### Understand background work

- **US-01:** **GIVEN** PRMonitor performs work while no renderer window is open, **WHEN** the developer later opens the application, **THEN** the developer can see a durable, timestamped summary of the work and its outcome without relying on an in-memory console.
  - **Acceptance Criteria:** AC-01, AC-03, AC-09, AC-13.
- **US-02:** **GIVEN** one operation passes through multiple stages, **WHEN** the developer opens its diagnostic view, **THEN** the events appear in one correlated timeline with the PR/operation identity, stage, severity, reason, and safe next action where available.
  - **Acceptance Criteria:** AC-02, AC-04, AC-05, AC-12.

### Diagnose failure and recovery

- **US-03:** **GIVEN** an operation fails, is cancelled, is retried, or has an uncertain external outcome, **WHEN** the developer inspects it, **THEN** the viewer distinguishes the attempt and recovery evidence without claiming that an unverified effect succeeded.
  - **Acceptance Criteria:** AC-06, AC-07, AC-10, AC-16.
- **US-04:** **GIVEN** multiple PRs are being monitored, **WHEN** the developer filters activity, **THEN** the results can be narrowed by PR, operation/correlation identity, severity, reason, stage, work item, and time window using bounded deterministic pagination.
  - **Acceptance Criteria:** AC-04, AC-07, AC-13.
- **US-05:** **GIVEN** activity retention removes an old diagnostic event, **WHEN** the developer opens the underlying operation or result, **THEN** authoritative domain records remain intact and the viewer explains the retention boundary rather than presenting deletion as workflow success.
  - **Acceptance Criteria:** AC-08, AC-09, AC-14.

### Use safe, recognizable references

- **US-06:** **GIVEN** an event is associated with a work item, **WHEN** it is displayed, **THEN** a supplied Jira-style key is preferred and a GitHub-native reference such as `#4821` or `owner/repo#4821` is used when no Jira-style key is available.
  - **Acceptance Criteria:** AC-06, AC-12, AC-15.
- **US-07:** **GIVEN** a diagnostic contains credentials, provider output, or sensitive environment data, **WHEN** the event is appended or delivered to the renderer, **THEN** unsafe data is redacted or rejected and never becomes durable or visible application state.
  - **Acceptance Criteria:** AC-01, AC-11, AC-15.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** a source feature emits an activity event, **WHEN** F09 accepts it, **THEN** the durable record contains a stable event identity, correlation identity, event type, owner/reference when available, UTC occurrence/recording timestamps, severity, reason code, and bounded safe structured details, and it contains no credential, prompt, raw provider SDK value, or uncontrolled environment value.
- **AC-02:** **GIVEN** several events belong to one polling, batch, AI, validation, notification, synchronization, or publication operation, **WHEN** the developer opens the activity view, **THEN** the events can be grouped by a stable correlation/operation identity and parent-child causation without relying on message text or arrival order.
- **AC-03:** **GIVEN** the renderer is closed or absent, **WHEN** an authorized main-process source emits an event, **THEN** F09 persists it without requiring a renderer and a later renderer can read it after recreation or process restart.
- **AC-04:** **GIVEN** the activity viewer is open, **WHEN** the developer filters by managed PR, operation/correlation identity, work item, severity, reason code, stage, or time range, **THEN** F09 returns a deterministic bounded page with a stable continuation cursor and does not start or alter the filtered operation.
- **AC-05:** **GIVEN** an event or correlated timeline is shown, **WHEN** the developer inspects it, **THEN** the viewer shows what happened, when it happened, the safe reason/severity, the related owner/reference, and a permitted next action or explicit `no action` result; it does not turn a free-form message into authoritative state.
- **AC-06:** **GIVEN** an event has a provider-neutral work-item reference, **WHEN** it is rendered, **THEN** a valid supplied project-key/number is displayed in Jira-style form, otherwise a valid GitHub-native `#number` or `owner/repo#number` fallback is displayed, and no Jira key is guessed from unrelated text.
- **AC-07:** **GIVEN** the same event is retried after a process, IPC, or network interruption, **WHEN** the source resubmits its stable event identity, **THEN** F09 returns the existing event without creating a duplicate; a changed payload for the same identity is rejected as a conflict, and a new attempt has a distinct event identity linked to the same correlation/operation.
- **AC-08:** **GIVEN** activity history exceeds its configured bounds, **WHEN** deterministic retention runs, **THEN** F09 prunes only the oldest eligible activity records according to the documented age/count/size policy, preserves events needed to explain active or user-actionable operations, and never deletes the authoritative operation, Review Bundle, validation, synchronization, publication, or remote-event record.
- **AC-09:** **GIVEN** the activity database or viewer read is unavailable, cancelled, stale, or interrupted, **WHEN** the application handles the condition, **THEN** it shows a bounded diagnostic state with retry/read-again guidance, does not show an empty history as confirmed absence, does not release a hold or alter an operation, and preserves the last valid viewer snapshot when one exists.
- **AC-10:** **GIVEN** an external effect may have occurred before a process or network failure, **WHEN** the operation is reopened, **THEN** the activity history distinguishes intent, attempt, known result, unknown result, and reconciliation without inventing success or authorizing a duplicate external effect.
- **AC-11:** **GIVEN** an event contains a known secret, secret-shaped field, authorization header, cookie, private-key material, prompt, or sensitive environment value, **WHEN** it is encoded for persistence or IPC, **THEN** deterministic redaction removes the value before storage, or the event is rejected fail-closed with a safe redaction-failure reason; the unredacted value is absent from the database, UI, and test evidence.
- **AC-12:** **GIVEN** an event has a related Review Bundle, synchronization result, validation run, worktree, or other supported owner, **WHEN** the developer chooses its related-record action, **THEN** F09 emits a validated provider-neutral target through F04 and does not accept an arbitrary URL, filesystem path, IPC channel, credential, or publication command from the renderer.
- **AC-13:** **GIVEN** polling, batching, AI turns, validation, notification, synchronization, and publication consumers use the F09 writer, **WHEN** each consumer emits start, progress/wait, terminal, cancellation, failure, and recovery events that apply to its operation, **THEN** all consumers use the same structured contract, correlation rules, redaction rules, and viewer query without importing provider SDK or workflow-specific logging state into F09.
- **AC-14:** **GIVEN** an activity event is pruned or unavailable, **WHEN** an owning workflow reads its authoritative state, **THEN** that workflow does not depend on the activity row to reconstruct a Review Bundle, validation result, AI Work Report, synchronization result, publication phase, handled event association, or primary PR state.
- **AC-15:** **GIVEN** the viewer is used with keyboard-only input, a screen reader, forced colors/high contrast, reduced motion, a missing related target, or an unsupported display capability, **WHEN** the developer navigates, filters, expands, retries, or receives a new event, **THEN** headings, timeline relationships, severity/reason labels, focus, status announcements, and recovery actions remain understandable and operable without color, animation, hover, or pointer-only interaction.
- **AC-16:** **GIVEN** a critical activity append or retention transaction is cancelled, fails, or races with another writer, **WHEN** the transaction finishes, **THEN** it produces either one complete committed event/result or a structured failure, never a partial event; a committed event remains visible after cancellation/restart, and no caller treats a missing diagnostic as permission to skip its own deterministic safety checks.

## Functional Requirements

### FR-01: Structured activity event contract

- FR-01.1: F09 SHALL define a provider-neutral activity event with a stable event identity, schema version, event type, correlation identity, optional parent/causation identity, optional owner type/identity, UTC occurrence and recording timestamps, severity, reason code, safe summary, bounded structured details, and optional related work-item/record target.
- FR-01.2: F09 SHALL use a versioned allowlist for event types, severities, reason codes, lifecycle stages, and next-action values; unknown or unsupported values SHALL be rejected before persistence or renderer delivery.
- FR-01.3: F09 SHALL bound every event field, collection, nested value, page, and diagnostic response, and SHALL reject control characters, malformed timestamps, unsafe identifiers, raw SDK objects, and unbounded free-form output.
- FR-01.4: A structured reason SHALL distinguish what happened, why it matters, and the permitted next action when user action is relevant; the reason SHALL be safe to display without parsing or trusting prose.

### FR-02: Correlation, causation, and idempotency

- FR-02.1: Every top-level operation or user-started diagnostic scope SHALL receive a stable correlation identity, and child events SHALL be able to identify their owning operation and immediate parent/causation event.
- FR-02.2: An event identity SHALL be the source's idempotency identity for that event. Repeating the same identity with the same canonical payload SHALL return the existing record; repeating it with different immutable content SHALL return a conflict.
- FR-02.3: Retries, process restarts, renderer recreation, and uncertain external outcomes SHALL preserve the operation/correlation identity and SHALL use distinct attempt/event identities when a new attempt occurs.
- FR-02.4: F09 SHALL never derive domain state, validation success, publication authority, hold release, or operation completion by parsing event text, event counts, severity, or timeline order.

### FR-03: Main-process append and consumer integration

- FR-03.1: The durable activity writer SHALL be owned by the Electron main process and SHALL be reachable by typed provider-neutral contracts; renderers, provider SDKs, child processes, and external services SHALL not write the activity table directly.
- FR-03.2: Critical operation-intent and terminal diagnostic events SHALL be appendable in the same F03 transaction as the owning intent/result when the owning feature requires atomic evidence; a source SHALL not start an external effect merely because a renderer event was emitted.
- FR-03.3: F09 SHALL provide one append contract for polling, batching, AI turns, validation, notifications, synchronization, publication, lifecycle, and recovery consumers, including safe cancellation, failure, retry, and uncertain-outcome event types.
- FR-03.4: Activity events SHALL link to authoritative owner identifiers and version/revision information when available, but F09 SHALL not copy mutable domain state into a competing activity state machine.
- FR-03.5: The activity writer SHALL continue to accept main-process events when no renderer exists and SHALL return a structured, bounded result that distinguishes inserted, replayed, conflicted, rejected, and unavailable outcomes.
- FR-03.6: Activity append, viewer filtering, related-record navigation, and retention SHALL never grant commit, push, response, approval, merge, AI, Git, validation, or worktree authority.

### FR-04: Diagnostic query and activity viewer

- FR-04.1: F09 SHALL provide a main-process query for a bounded page of activity events with deterministic filters for managed PR, owner/operation/correlation identity, work item, severity, reason code, lifecycle stage, and UTC time range.
- FR-04.2: The query SHALL return a stable continuation cursor and deterministic ordering based on persisted time and event identity; repeated queries against unchanged records SHALL return the same page and cursor behavior.
- FR-04.3: The viewer SHALL present a correlated timeline or expandable event tree with timestamps, severity, reason, safe details, owner/reference, attempt information, and permitted next actions, while clearly labeling unavailable or pruned history.
- FR-04.4: The viewer SHALL provide loading, empty, last-known, bounded-error, retry, no-results, and unsupported-target states and SHALL not interpret a failed query as successful deletion or a successful operation.
- FR-04.5: Related-record actions SHALL use F04's validated provider-neutral navigation contract; the viewer SHALL not accept arbitrary routes, URLs, filesystem paths, shell commands, or renderer-supplied credentials.
- FR-04.6: The viewer SHALL support accessible keyboard navigation, semantic event/timeline relationships, focus restoration, screen-reader status announcements, forced-colors/high-contrast behavior, and reduced-motion behavior.

### FR-05: Provider-neutral work-item references

- FR-05.1: F09 SHALL accept a bounded `WorkItemRef` contract containing an opaque provider/namespace identity, a canonical key or number when supplied, and enough validated repository/project context to render a safe display reference without storing a raw secret-bearing URL.
- FR-05.2: When a valid project key and issue number are supplied, the viewer SHALL prefer the normalized Jira-style display `<PROJECT_KEY>-<ISSUE_NUMBER>`; otherwise it SHALL display a GitHub-native `#<ISSUE_NUMBER>` or `<OWNER>/<REPOSITORY>#<ISSUE_NUMBER>` fallback when that identity is available.
- FR-05.3: F09 SHALL never invent, infer, or rewrite a Jira key from a PR title, prompt, comment text, or unrelated free-form activity detail; missing or malformed work-item data SHALL remain absent or display as an explicit provider-neutral fallback.

### FR-06: Bounded retention and history protection

- FR-06.1: The MVP SHALL apply a deterministic activity-retention policy of 30 days, 50,000 stored events, or 64 MiB of encoded activity payload/index storage, whichever bound is reached first; the bounds SHALL be visible in diagnostic/support information and SHALL not be unbounded user input.
- FR-06.2: Retention SHALL prune oldest eligible activity events using a stable `(recordedAt, eventId)` order and SHALL protect events linked to active or user-actionable operations until the owning authoritative record is terminal and outside its own retention requirement.
- FR-06.3: Retention SHALL not delete or rewrite managed PRs, remote event versions, batches, Review Bundles, AI Work Reports, validation results, synchronization results, publication records, transition history, or handled associations.
- FR-06.4: Retention execution SHALL record a bounded safe maintenance outcome when it removes records, and a failure SHALL leave existing activity and authoritative domain records intact with an actionable diagnostic.

### FR-07: Redaction and sensitive-data handling

- FR-07.1: F09 SHALL apply deterministic redaction before an activity event is persisted, returned from a query, rendered, copied, or included in diagnostic evidence.
- FR-07.2: Redaction SHALL cover known credentials and tokens, authorization/cookie/private-key material, secret-shaped field names, sensitive environment values, provider prompts, and unbounded child-process/provider output; safe opaque identifiers may remain.
- FR-07.3: A redaction failure, ambiguous secret-shaped value, invalid structured field, or unsafe output limit SHALL fail closed for that event and SHALL emit only a safe bounded reason; the unredacted value SHALL not be retained for later retry.
- FR-07.4: F09 SHALL keep safe structured details separate from application state and shall not expose raw SQLite statements, provider SDK objects, credential-store values, arbitrary environment snapshots, or uncontrolled exception objects.

### FR-08: Cancellation, restart, and operational resilience

- FR-08.1: Activity timestamps SHALL be generated from an injected deterministic UTC clock in tests and a main-process clock in production; persisted timestamps SHALL include an unambiguous timezone representation.
- FR-08.2: A renderer close, renderer recreation, application restart, or sleep/wake cycle SHALL not lose a committed activity event, reset a correlation identity, duplicate an event, release a hold, or reset an owning operation budget.
- FR-08.3: Cancellation before an activity transaction commits SHALL leave no partial event; cancellation after commit SHALL report the committed/replayable result and SHALL not pretend that the event was rolled back.
- FR-08.4: Concurrent append, query, and retention operations SHALL use bounded transactions and deterministic conflict/retry results; retention SHALL not remove a record that a committed owner transaction still protects.

### FR-09: Boundary and platform behavior

- FR-09.1: The main/preload/renderer boundary SHALL validate all activity requests, responses, cursors, filters, event details, work-item references, and navigation targets and SHALL reject unknown, oversized, secret-shaped, provider-specific, or platform-handle values.
- FR-09.2: The activity view SHALL be understandable without color, hover, animation, or pointer-only interaction and SHALL report unsupported related-record targets or platform capabilities truthfully.
- FR-09.3: F09 SHALL remain provider-neutral and shall not require Jira, a second GitHub API, a network connection, a renderer window, or a platform-specific file manager to append or inspect stored activity.

## Non-Functional Requirements

- **NFR-01: Determinism** - Given the same event inputs, schema version, clock values, committed records, and filters, F09 SHALL produce the same canonical payload, deduplication/conflict result, retention selection, ordering, cursor behavior, and safe display data without AI or network access.
- **NFR-02: Durability and atomicity** - A successful activity append SHALL survive renderer closure and ordinary process restart; related critical evidence SHALL commit atomically with the owning F03 transaction when required, and no partial event SHALL be visible.
- **NFR-03: Bounded performance** - Appending one event and reading one bounded page SHALL use bounded work; the implementation evidence SHALL exercise at least 10,000 events, 200-event pages, concurrent writers, and retention pressure without unbounded memory, output, or retry behavior.
- **NFR-04: Retention safety** - Activity storage SHALL remain within the documented age/count/size bounds under normal maintenance and shall never make authoritative domain history dependent on activity retention.
- **NFR-05: Security and privacy** - Credentials, prompts, raw SDK values, sensitive environment values, raw authorization data, uncontrolled exception objects, and unredacted process/provider output SHALL not enter activity storage, IPC, UI state, or committed evidence.
- **NFR-06: Accessibility** - The viewer SHALL meet the repository's keyboard, semantic, focus, live-status, screen-reader, forced-colors/high-contrast, reduced-motion, and safe-error evidence expectations on the supported Windows desktop path.
- **NFR-07: Portability** - Shared activity/event/query contracts SHALL not encode Electron objects, Windows handles, absolute user paths, shell commands, or provider SDK types; platform-specific open-target behavior SHALL remain behind F04.
- **NFR-08: Operability** - Every user-actionable diagnostic SHALL expose a stable reason code, correlation/owner identity when available, safe explanation, and permitted next action or explicit no-action result; routine activity SHALL not create a native notification by itself.

## Invariants

- **INV-01:** F03/domain records and owning workflow state are authoritative; activity text, event counts, severity, and timeline order are never authoritative application state.
- **INV-02:** An accepted activity event's immutable identity, correlation identity, timestamps, reason code, and canonical safe payload cannot be rewritten; a changed replay returns a conflict.
- **INV-03:** Activity evidence cannot bypass the global human-approval boundary, AI/worktree policy, persist-before-effect rule, hold rules, validation truth, or publication safeguards.
- **INV-04:** No unredacted credential, prompt, provider SDK object, secret-shaped value, or uncontrolled environment value crosses into activity storage, IPC, renderer state, or evidence.
- **INV-05:** Retention is bounded and deterministic, but it never deletes or rewrites the authoritative record needed to reconstruct a domain result or recover an uncertain external outcome.
- **INV-06:** Correlation links are provider-neutral and stable across renderer recreation, process restart, retry, and uncertain outcome; a new attempt is distinguishable without losing the parent operation link.
- **INV-07:** Activity viewer actions are read-only diagnostics/navigation; filtering, expanding, copying, retrying a read, or opening a related record cannot start or alter product work.
- **INV-08:** A missing, pruned, rejected, or unavailable activity event is represented as missing diagnostic evidence, not as successful completion, cancellation, deletion, or permission to skip deterministic checks.

## Requirement Traceability

| Requirement family | Observable coverage |
|---|---|
| FR-01 | AC-01, AC-02, AC-05, AC-11, AC-13, AC-16; CT-F09-01 |
| FR-02 | AC-02, AC-07, AC-10, AC-14, AC-16; CT-F09-02 |
| FR-03 | AC-03, AC-05, AC-10, AC-12-AC-14, AC-16; CT-F09-03 |
| FR-04 | AC-04, AC-05, AC-09, AC-12, AC-15; CT-F09-04 |
| FR-05 | AC-06, AC-12, AC-15; CT-F09-05 |
| FR-06 | AC-08, AC-09, AC-14, AC-16; CT-F09-06 |
| FR-07 | AC-01, AC-11, AC-15, AC-16; CT-F09-07 |
| FR-08 | AC-03, AC-07-AC-10, AC-16; CT-F09-02, CT-F09-03, CT-F09-06 |
| FR-09 | AC-04, AC-09, AC-12, AC-15; CT-F09-04, CT-F09-05 |
| NFR-01-NFR-08 | AC-01-AC-16; CT-F09-01-CT-F09-07 |
| INV-01-INV-08 | AC-02, AC-05, AC-07-AC-16; CT-F09-01-CT-F09-07 |

## Out of Scope

- **Authoritative workflow state** - F09 does not own PR states, holds, Review Bundle states, validation statuses, AI Work Policy, synchronization statuses, publication phases, handled-event eligibility, or recovery decisions.
- **Polling, batching, AI, validation, notifications, synchronization, and publication behavior** - F10-F27 own those operations; F09 supplies their shared activity contract and viewer evidence only.
- **Complete result storage** - F03 and the owning features retain complete Review Bundles, AI Work Reports, validation evidence, synchronization results, publication records, and remote-event versions independently of activity retention.
- **Jira integration or issue lookup** - F09 accepts validated work-item references supplied by another feature; it does not query Jira, infer project keys, or synchronize tickets.
- **Autonomous alerts for routine activity** - F19 owns outcome-oriented native notifications. F09 does not notify for every event.
- **Free-form log ingestion, raw console capture, and arbitrary text search** - F09 stores bounded structured details, not an unbounded console transcript or semantic search index.
- **Cloud telemetry, multi-user activity sharing, web access, export, and centralized diagnostics** - These remain outside the MVP.

## Product Decisions

- **PD-01: Activity is evidence, never state** - The viewer helps a developer understand work, but owning domain records always decide whether work is complete, safe, ready, stale, published, or recoverable.
- **PD-02: Use structured events with a stable catalog** - Each event has a typed lifecycle/reason meaning and bounded safe details. Free-form prose is a display parameter, not an input to application decisions.
- **PD-03: Use one correlation tree per operation** - A top-level operation keeps one stable correlation identity across retries and restarts; each retry or attempt gets distinct event identities and explicit attempt data.
- **PD-04: Keep activity lightweight and bounded** - The MVP uses 30 days, 50,000 events, or 64 MiB of activity payload/index storage as hard retention bounds, protects active/user-actionable chains, and never deletes authoritative records.
- **PD-05: Prefer supplied Jira-style references, then GitHub-native references** - A Jira-style key is shown only when a validated project key and number are supplied. Otherwise the viewer uses a GitHub-native reference and never guesses a ticket key.
- **PD-06: Keep the viewer read-only** - Viewer actions can filter, inspect, copy safe details, retry a read, or navigate to an owning record; they cannot authorize or start product work.
- **PD-07: Routine activity remains quiet** - F09 records routine activity for inspection, while F19 remains responsible for outcome-oriented native notifications.

## Implementation Decisions

- **IMP-01: Reuse the F03 activity storage seam** - Extend the existing `activity_events` table/repository contract with versioned payload validation, idempotent event identity checks, query indexes, and bounded retention metadata; do not create a renderer-owned log store.
- **IMP-02: Use a typed append/query boundary** - Add a main-process `ActivityWriter` and `ActivityQuery` port. Consumers receive an append result (`inserted`, `replayed`, `conflict`, `rejected`, or `unavailable`) rather than writing SQL or interpreting a logger side effect.
- **IMP-03: Make the safe event envelope canonical** - Canonicalize and hash the redacted event envelope before persistence so duplicate detection cannot vary with object key order, locale, or serialization formatting.
- **IMP-04: Use F03 transaction composition for critical evidence** - When an owning operation needs intent and activity to commit together, it composes both through the existing F03 transaction; F09 does not create a second authorization or state machine.
- **IMP-05: Redact before persistence and IPC** - Reuse the repository's bounded output/redaction rules and add event-specific secret-shaped field checks. Any redaction uncertainty fails closed and retains only a safe reason.
- **IMP-06: Query by stable cursor, not offset** - Use a cursor based on persisted UTC time and event identity so inserts before/after a page do not duplicate or skip rows during viewer pagination.
- **IMP-07: Keep work-item formatting at the display edge** - Store a validated provider-neutral `WorkItemRef`; derive Jira-style/GitHub-native display labels in one deterministic formatter without rewriting the stored identity.
- **IMP-08: Retain protected-chain metadata separately** - Retention eligibility and protected owner references are deterministic metadata, not inferred from activity prose. The owning domain record tells F09 whether a chain is still actionable.
- **IMP-09: Keep related navigation behind F04** - F09 emits typed target identities only. F04 resolves platform/window behavior and rejects arbitrary renderer-supplied URLs, paths, handles, and channels.

## Testing Decisions

- **TST-01: Deep-test the event envelope and catalog** - Test canonicalization, schema versions, allowlists, bounded values, timestamp rules, stable reason/next-action data, and unknown-value rejection at the append/query boundary.
- **TST-02: Prove idempotency and correlation across faults** - Use duplicate delivery, changed-payload replay, concurrent writers, renderer closure, process restart, cancellation before/after commit, and uncertain-attempt fixtures.
- **TST-03: Use fake source consumers** - Exercise polling, batching, AI, validation, notification, synchronization, and publication adapters with deterministic fakes/spies; do not require GitHub, provider, OS notification, or publication credentials.
- **TST-04: Test viewer behavior at the IPC boundary** - Cover query filters, cursor stability, out-of-order updates, stale/duplicate responses, last-known/error/empty states, related-target validation, and no-effect guarantees.
- **TST-05: Fuzz and scan redaction** - Test secrets split across chunks, nested details, suspicious keys, control characters, oversized output, raw SDK-shaped values, prompts, and environment fixtures; scan SQLite, IPC, UI, logs, and evidence.
- **TST-06: Test retention as a deterministic policy** - Fill age/count/size pressure, protect active/user-actionable operations, inject cleanup failure, restart during cleanup, and prove authoritative records survive every pruning decision.
- **TST-07: Test accessibility semantics rather than pixel snapshots** - Verify semantic timeline/group relationships, keyboard order, focus restoration, live announcements, forced colors, reduced motion, and truthful missing-target/capability states.

## Proposed Modules

- **MOD-01: Activity Event Contract and Codec** - Validates the versioned event envelope, catalog, safe details, canonical hash, and bounded serialization.
- **MOD-02: Activity Correlation Context** - Creates and propagates root/child/attempt identities without coupling consumers to provider SDK objects.
- **MOD-03: Activity Writer and Transaction Adapter** - Appends idempotently through F03, composes critical evidence transactions, and returns safe outcome categories.
- **MOD-04: Activity Redactor** - Removes credentials, prompts, sensitive environment data, unsafe output, and secret-shaped fields before persistence or IPC.
- **MOD-05: Activity Retention Service** - Calculates protected/eligible records, prunes deterministically, and records safe maintenance outcomes.
- **MOD-06: Activity Query Repository** - Applies validated filters, stable cursors, bounded pages, and correlation/owner projections.
- **MOD-07: Work-Item Display Formatter** - Renders supplied Jira-style or GitHub-native references without changing stored identity.
- **MOD-08: Activity Viewer Projection and IPC Adapter** - Exposes read-only versioned snapshots, live updates, related targets, and safe error states through F04.
- **MOD-09: Activity Viewer UI** - Renders the accessible timeline/tree, filters, retention boundary, loading/empty/error states, and read-only related navigation.

## Workflows

### Workflow 1: Record a background operation

```text
1. A deterministic main-process feature creates or loads its authoritative operation intent and correlation identity.
2. It appends an operation-start event through the F09 writer, optionally in the same F03 transaction as the intent.
3. The feature performs its own polling, AI, validation, notification, synchronization, or publication step.
4. It appends structured progress, wait, failure, cancellation, terminal, or recovery events with the same correlation identity.
5. The owning feature commits its authoritative result independently or atomically with critical evidence as its contract requires.
6. F09 makes the safe activity chain queryable without changing the owning state.
```

### Workflow 2: Inspect one correlated operation

```text
1. The developer opens Activity from the application shell or an owning operation surface.
2. The renderer requests a validated activity query through F04 with a PR, operation/correlation, work-item, severity, reason, stage, or time filter.
3. The main process validates the request, reads one bounded cursor page, and returns a versioned snapshot.
4. The viewer groups events by correlation and parent/attempt relationships and displays safe details and permitted next actions.
5. Selecting a related record emits a provider-neutral F04 target; it does not retry, approve, publish, or modify work.
```

### Workflow 3: Recover after restart or uncertain outcome

```text
1. A process/network interruption occurs after an operation intent or external attempt may have been recorded.
2. The next main-process startup reads the owning authoritative operation and its existing correlation identity.
3. The owning feature reconciles its external effect; F09 appends an evidence event for known, unknown, or reconciled outcome.
4. The viewer shows the attempt and recovery chain without replacing the owning result or authorizing a duplicate effect.
5. Renderer closure or recreation only changes delivery of the viewer snapshot.
```

### Workflow 4: Apply retention safely

```text
1. The main process runs the bounded retention task at startup and at the configured maintenance cadence.
2. F09 calculates age/count/size pressure and asks the owning record adapters which event chains remain active or user-actionable.
3. F09 selects the oldest eligible events by `(recordedAt, eventId)` and deletes only those activity rows in one bounded transaction.
4. It records a safe maintenance outcome and exposes the retention boundary in the viewer/support diagnostics.
5. A cleanup failure leaves the existing activity and all authoritative domain records intact for a later retry.
```

## Contract-Test Criteria

- **CT-F09-01:** Event envelope, schema/catalog allowlists, canonical hashing, bounded fields, timestamps, severity/reason/next-action, and unknown-value rejection.
- **CT-F09-02:** Correlation/causation propagation, stable event identity, duplicate replay, changed-payload conflict, attempt separation, cancellation, restart, and uncertain-outcome behavior.
- **CT-F09-03:** Main-process writer, F03 transaction composition, all seven source-consumer adapters, renderer-absent append, and no-authority/no-side-effect guarantees.
- **CT-F09-04:** Query filters, stable cursor pagination, correlation tree/timeline projection, loading/empty/last-known/error states, stale/duplicate update handling, and safe related-target routing.
- **CT-F09-05:** Work-item reference validation and Jira-style/GitHub-native display fallback without key inference or raw URL leakage.
- **CT-F09-06:** Age/count/size retention, protected active chains, cleanup fault injection, concurrent append/retention, restart during cleanup, and authoritative-record preservation.
- **CT-F09-07:** Secret/prompt/environment/output redaction, fail-closed behavior, database/IPC/UI scans, keyboard/screen-reader/focus/live-region behavior, forced colors, reduced motion, and platform-neutral omission.
