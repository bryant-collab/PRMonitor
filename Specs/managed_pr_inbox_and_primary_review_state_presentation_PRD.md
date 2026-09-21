# F08 Managed-PR Inbox and Primary Review-State Presentation - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F02 - Domain contracts and deterministic state machines | Provides the four-state primary PR lifecycle, structured reason data, automatic-review hold semantics, and the rule that synchronization is an overlay rather than a competing PR state machine. |
| 2 | F03 - SQLite persistence, migrations, and transactional repositories | Provides restart-safe managed-PR projections, immutable history/version data, read-model transaction boundaries, and persisted synchronization status records when available. |
| 3 | F04 - Persistent Electron shell, IPC boundary, and Windows virtual-desktop spike | Provides the main-process authority, validated read/query/subscription IPC, renderer recreation, and provider-neutral open-target routing. |
| 4 | F07 - Add and manage a pull request | Provides managed PR identities, remote metadata, current PR configuration, local-clone setup status, and details/settings targets. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F09 - Durable activity log and operation diagnostics | May add correlated activity summaries and diagnostic links without making free-form activity text the inbox state. |
| 2 | F10-F12 - Polling, eligibility, batching, and pause | Update the persisted primary state and feedback summaries that F08 presents; F08 does not implement polling or scheduling. |
| 3 | F19 - System tray, native notifications, deep links, and shutdown | Uses F08's provider-neutral open targets and state/action-needed projections for tray and notification entry points. |
| 4 | F20-F23 - Review Bundle review and publication | Supplies review targets and later completes the detailed review/publish screens reached from the inbox. |
| 5 | F24-F27 - Managed PR branch synchronization | Supplies synchronization operation records that F08 presents as a separate status overlay without changing the primary review grouping. |
| 6 | F28-F30 - Recovery, security, and release readiness | Hardens restart/read-model reconciliation, process-boundary security, accessibility, and clean-machine behavior. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-03 | FR-01.1-FR-01.4, FR-02.1-FR-02.5, FR-04.1-FR-04.4, FR-06.1-FR-06.3, INV-01-INV-04 | AC-01-AC-05, AC-08-AC-11 | Primary: F08 owns the multi-PR inbox read model, action-needed grouping, deterministic ordering, and restart-restored presentation. F07 owns managed-PR creation; F10-F12 own actual watching, polling, eligibility, and scheduling. |
| APP-AC-16 | FR-02.2-FR-02.4, FR-04.3-FR-04.4, FR-05.2, INV-02, INV-06 | AC-04, AC-07, AC-13 | Shared presentation: F08 displays held `READY_FOR_REVIEW`/`NEEDS_ATTENTION` states and never releases them; F11/F18/F21 own hold enforcement and explicit transitions. |
| APP-AC-17 | FR-04.1-FR-04.4, FR-06.1-FR-06.3, INV-01, INV-06 | AC-10-AC-11, AC-14 | Shared lifecycle/read-model behavior: F08 rehydrates the current persisted inbox after renderer recreation or restart; F04 owns process lifetime and F10/F18 own continued background work. |
| APP-AC-30 | FR-04.1-FR-04.3, INV-01 | AC-10, AC-14 | Shared: F08 restores the inbox on a newly created window; F04 owns normal close versus process shutdown and F19 owns the user-facing shutdown action. |
| APP-AC-49 | FR-03.1-FR-03.4, FR-04.2-FR-04.4, INV-02-INV-04 | AC-06-AC-07, AC-13 | Shared presentation: F08 shows a concise synchronization status overlay; F25-F27 own complete synchronization persistence, explanations, review, and publication. |
| APP-AC-75 | FR-02.1-FR-02.4, FR-04.4, FR-07.4, INV-04 | AC-04, AC-13, AC-15 | Shared presentation: F08 makes the primary-state distinction visible in the inbox; F02 owns reason semantics and F20 owns the complete Review Bundle treatment. |

F08 does not claim APP-AC-43 or APP-AC-44. F24 owns inbox selection, synchronization confirmation, and effective source resolution. F08 may reserve the selection and overlay regions needed by that feature, but it does not make those decisions or start synchronization.

### Linter review disposition

The coverage linter may return `needs-review` for criteria whose wording spans the F08 presentation boundary and a different owning feature. The intended dispositions are:

- **APP-AC-03:** F08 is the primary owner of showing multiple managed PRs and their primary states; F10-F12 remain owners of the actual polling, eligibility, and scheduling behavior that makes watching continue.
- **APP-AC-04 through APP-AC-06:** Not applicable to F08. F08 presents persisted state and does not poll, compare remote feedback, or invoke an AI provider.
- **APP-AC-14:** Not applicable to F08. F03/F18 own durable Review Bundle persistence; F08 only renders managed-PR projections.
- **APP-AC-16:** Shared presentation only. F08 displays held states without releasing them; F11/F18/F21 own the automatic stop and explicit-action enforcement.
- **APP-AC-19, APP-AC-20, and APP-AC-31:** Not applicable to F08. F04/F19 own tray/window recreation, virtual-desktop behavior, and shutdown.
- **APP-AC-43:** Not applicable to F08. F24 owns selection, clear/select-all, and synchronization initiation; F08 only reserves the later surface.
- **APP-AC-49:** Shared presentation only. F08 may show a synchronization overlay; F25-F27 own the complete persisted synchronization result and reviewable evidence.
- **APP-AC-51 and APP-AC-77:** Not applicable to F08. F26/F27 own stale synchronization detection and ambiguous-conflict handling.

These dispositions do not claim completion of the downstream criteria and are included so low-confidence classifications are explicit rather than silently treated as covered.

## Executive Summary

PRMonitor needs one dependable home screen for developers who manage several pull requests at once. The inbox must answer two questions immediately: which PRs need the developer's attention, and what is happening with the rest. A renderer-local list or an ordering based on arrival timing would become misleading after polling, renderer recreation, or restart, and a synchronization operation could incorrectly make a PR appear to be in a different review state.

F08 creates the main-process-backed inbox read model and the first user-facing presentation of a managed PR's primary review state. It shows every managed PR from the persisted projection, groups cards by whether user action is needed, presents `WATCHING`, `WORKING`, `READY_FOR_REVIEW`, and `NEEDS_ATTENTION` distinctly, and uses deterministic ordering within each group. A separate synchronization overlay can show branch-synchronization activity without hiding or mutating the review state. Loading, empty, error, and restart-restored states are explicit, and each card can navigate to the PR details/settings surface through a validated target.

The feature is a read/presentation slice. It does not poll GitHub, decide event eligibility, schedule AI work, create or mutate worktrees, run validation, publish changes, or implement synchronization selection. Viewing, sorting, reopening, or navigating from the inbox must never release a review hold or start external work.

## User Stories

### See all managed PRs

- **US-01:** **GIVEN** multiple managed PRs exist, **WHEN** the developer opens PRMonitor, **THEN** the inbox shows each managed PR exactly once with its stable identity, readable title/reference, current primary state, and the latest persisted summary available to the application.
  - **Acceptance Criteria:** AC-01, AC-02, AC-10.
- **US-02:** **GIVEN** the renderer was closed or the application was restarted, **WHEN** the inbox becomes ready, **THEN** it hydrates from current main-process/persisted state rather than from a prior renderer cache and preserves the same deterministic ordering for unchanged inputs.
  - **Acceptance Criteria:** AC-10, AC-11, AC-14.

### Find work that needs attention

- **US-03:** **GIVEN** one or more PRs are `READY_FOR_REVIEW` or `NEEDS_ATTENTION`, **WHEN** the inbox renders, **THEN** those cards appear in a prominent action-needed area with distinct state labels and a concise explanation of what happened, why it matters, and the permitted next action.
  - **Acceptance Criteria:** AC-03, AC-04, AC-13, AC-15.
- **US-04:** **GIVEN** a PR is `WORKING` or `WATCHING`, **WHEN** the inbox renders, **THEN** it appears in the appropriate non-action group with progress or waiting information and is not presented as ready for publication or as requiring an invented user decision.
  - **Acceptance Criteria:** AC-03, AC-05.

### Keep synchronization separate

- **US-05:** **GIVEN** a managed PR has an active or recent branch-synchronization operation, **WHEN** its inbox card renders, **THEN** the synchronization status appears as a separate overlay and the card remains grouped by its primary review state.
  - **Acceptance Criteria:** AC-06, AC-07, AC-13.
- **US-06:** **GIVEN** the synchronization overlay changes, **WHEN** the inbox receives the updated read model, **THEN** only the overlay and its explanation change unless the authoritative primary PR state also changed in the persisted projection.
  - **Acceptance Criteria:** AC-07, AC-11.

### Navigate safely and recover visibly

- **US-07:** **GIVEN** the developer selects a managed PR card or its details/settings action, **WHEN** navigation is requested, **THEN** PRMonitor opens the corresponding provider-neutral target without starting polling, AI work, synchronization, publication, or changing a hold.
  - **Acceptance Criteria:** AC-12, AC-14.
- **US-08:** **GIVEN** the inbox is loading, empty, or cannot refresh its read model, **WHEN** the state is shown, **THEN** the developer sees a truthful status, an actionable next step where possible, and no temporary loading/error state is mistaken for zero managed PRs or successful deletion.
  - **Acceptance Criteria:** AC-08, AC-09.
- **US-09:** **GIVEN** the developer uses keyboard navigation, a screen reader, high-contrast mode, or a supported Windows display configuration, **WHEN** the inbox is used, **THEN** group headings, state labels, card actions, live updates, and errors remain understandable and operable without color or pointer-only interaction.
  - **Acceptance Criteria:** AC-15, AC-16.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** F03 contains zero, one, or many managed PR projections, **WHEN** the main process creates an inbox read-model snapshot, **THEN** the snapshot contains each current managed PR at most once with a stable managed-PR identity, provider-neutral repository/PR reference, display title/reference, current primary state, state-updated time, safe reason/summary data, and read-model version; it does not silently replace one repository identity with another.
- **AC-02:** **GIVEN** the same persisted managed-PR records and injected clock are supplied twice, **WHEN** the inbox projection is built, **THEN** card identity, group membership, ordering, displayed state, and derived counts are identical; arrival order, renderer timing, locale, and network calls do not influence the projection.
- **AC-03:** **GIVEN** the snapshot contains any combination of the four primary states, **WHEN** the inbox renders it, **THEN** it groups cards into an action-needed area for `NEEDS_ATTENTION` and `READY_FOR_REVIEW`, a `WORKING` area, and a `WATCHING` area, while retaining the exact state label on every card; empty groups are omitted or explicitly marked according to one stable presentation rule.
- **AC-04:** **GIVEN** a card is `READY_FOR_REVIEW` or `NEEDS_ATTENTION`, **WHEN** the developer inspects it, **THEN** the two states have different accessible labels and visual treatments, and the card's reason data identifies what happened, why it matters, and a permitted next action without implying that viewing the card approves, publishes, discards, or continues work.
- **AC-05:** **GIVEN** a card is `WORKING` or `WATCHING`, **WHEN** the developer inspects it, **THEN** `WORKING` shows a truthful persisted progress/operation summary when available and `WATCHING` shows a truthful waiting/no-outstanding-action summary; neither state is promoted to an action-needed state solely because a synchronization overlay exists.
- **AC-06:** **GIVEN** a persisted synchronization operation has a supported status such as waiting, merging, conflict resolution, ready, stale, failed, or published, **WHEN** the inbox snapshot includes it, **THEN** the card displays it in a separately labeled synchronization overlay with its PR/result identity and safe summary, without replacing the card's primary review state or review-state reason.
- **AC-07:** **GIVEN** the synchronization overlay changes while the primary review state is unchanged, **WHEN** the renderer receives the new snapshot, **THEN** the card remains in the same primary group and its primary state/reason history is unchanged; an overlay cannot release a review hold, start AI work, authorize publication, or hide a `READY_FOR_REVIEW`/`NEEDS_ATTENTION` card.
- **AC-08:** **GIVEN** no managed PR projection is available because the initial read is in progress, **WHEN** the inbox renders, **THEN** it shows a loading state distinct from an empty state; **WHEN** the persisted projection is successfully empty, **THEN** it shows an empty state with an accessible Add PR/navigation action and does not fabricate a PR or invoke a remote request merely to render the page.
- **AC-09:** **GIVEN** a read-model query or subscription refresh fails, **WHEN** the inbox handles the failure, **THEN** it presents a bounded safe error with a retry/read-again action and, when a last successful snapshot exists, keeps that snapshot visibly labeled as last known data rather than clearing it or reporting an empty inbox; raw credentials, prompts, SDK errors, and unbounded output are not shown.
- **AC-10:** **GIVEN** the visible renderer is destroyed, recreated, or the application restarts after managed PR state has been committed, **WHEN** the inbox is opened again, **THEN** it obtains a fresh authoritative snapshot from the main process, restores all persisted cards and overlays that are available, and does not release holds, reset operation state, duplicate a request, or depend on the old renderer's memory.
- **AC-11:** **GIVEN** two snapshots or subscription updates arrive out of order or are delivered more than once, **WHEN** the inbox applies them, **THEN** it accepts only the newest valid read-model version for the relevant projection, treats an identical replay as an idempotent no-op, and never renders a torn mixture of primary state, reason, identity, and overlay from different versions.
- **AC-12:** **GIVEN** a managed PR card is activated by mouse, keyboard, or an assistive-technology action, **WHEN** the developer chooses Details or Settings, **THEN** F08 emits one validated provider-neutral target containing the managed-PR identity and the renderer changes view only through F04's routing contract; no product side effect is started by the navigation.
- **AC-13:** **GIVEN** a card is in `READY_FOR_REVIEW`, `NEEDS_ATTENTION`, or has an actionable synchronization overlay, **WHEN** the card is displayed, **THEN** the status text and action affordances come from persisted structured reason/next-action data, distinguish review state from synchronization status, and do not claim that an AI/provider/model result or a renderer action completed deterministic work.
- **AC-14:** **GIVEN** the developer sorts, opens, selects, navigates from, retries the read, closes the window, or reopens the inbox, **WHEN** the action is processed, **THEN** F08 performs only the declared read/navigation operation; it does not poll GitHub, invoke an AI provider, mutate a worktree, run validation, publish code/comments, release a hold, or silently start branch synchronization.
- **AC-15:** **GIVEN** an inbox snapshot, error, route target, or subscription event contains an unknown, malformed, oversized, secret-shaped, raw provider-SDK, or unauthorized value, **WHEN** it crosses the main/preload/renderer boundary, **THEN** the value is rejected with a safe structured error before it reaches the renderer or any product side effect, and no credential, raw token, prompt, uncontrolled environment value, or raw remote URL is rendered as application data.
- **AC-16:** **GIVEN** the inbox is rendered on the primary Windows platform with keyboard-only input, a screen reader, forced-colors/high-contrast mode, reduced-motion preference, or a temporarily unavailable synchronization overlay, **WHEN** the developer navigates and receives a state update or error, **THEN** headings, group boundaries, state changes, controls, focus order, names, descriptions, and recovery actions remain usable without color, animation, hover, or pointer-only behavior; unsupported platform capabilities return a truthful omission rather than breaking the primary inbox.

## Functional Requirements

### FR-01: Authoritative managed-PR inbox read model

- FR-01.1: The application SHALL provide a main-process-owned inbox read-model query that projects every current managed PR from F03/F07 records without requiring the renderer to query GitHub, SQLite, or a provider SDK.
- FR-01.2: Each projected card SHALL contain a stable managed-PR identity, explicit repository/PR reference, safe display title/reference, current primary state, state-updated time, safe state reason/summary, and projection version; it SHALL preserve explicit base/head repository identity when that data is available.
- FR-01.3: The read model SHALL be internally consistent: a card's primary state, reason, display identity, counts, and synchronization overlay SHALL come from one accepted projection version rather than independently timed requests.
- FR-01.4: The query SHALL return each persisted managed PR at most once and SHALL not silently omit, merge, or substitute records; a bounded failure or partial-read condition SHALL be explicit and actionable.
- FR-01.5: F08 SHALL consume persisted state and subscriptions only; it SHALL not implement GitHub polling, feedback eligibility, quiet-period batching, AI invocation, validation execution, Git operations, or publication.

### FR-02: Primary state grouping and presentation

- FR-02.1: The inbox SHALL display the exact F02 primary states `WATCHING`, `WORKING`, `READY_FOR_REVIEW`, and `NEEDS_ATTENTION` on every managed-PR card.
- FR-02.2: The inbox SHALL group `NEEDS_ATTENTION` and `READY_FOR_REVIEW` under a clearly action-needed presentation, and SHALL keep `WORKING` and `WATCHING` in distinct non-action groups.
- FR-02.3: `READY_FOR_REVIEW` SHALL explain what the developer can inspect or approve, while `NEEDS_ATTENTION` SHALL explain the concrete blocking/attention reason, preserved evidence or worktree availability when known, and permitted next actions; the two states SHALL not be distinguished by color alone.
- FR-02.4: The inbox SHALL show truthful persisted summaries for `WORKING` and `WATCHING` and SHALL not invent progress, validation success, AI completion, or publication readiness from missing data.
- FR-02.5: Group membership SHALL be derived only from the primary review state. A synchronization status, local-clone setup status, global pause overlay, or display sort choice SHALL not create a competing primary state.
- FR-02.6: The product SHALL use one documented priority and tie-break rule for cards within each group so that the same input produces the same order after polling, renderer recreation, and restart.

### FR-03: Separate synchronization-status overlay

- FR-03.1: The inbox SHALL reserve a separately labeled synchronization-status overlay on each card and SHALL display a supported persisted synchronization status when one is available.
- FR-03.2: The overlay SHALL identify the relevant synchronization operation/result and show safe status/reason data for waiting, merging, conflict resolution, ready, stale, failed, published, or other supported statuses without reinterpreting them as primary review states.
- FR-03.3: Overlay updates SHALL be independently replaceable from the primary review projection, but a card SHALL render both when both are available; the overlay SHALL not hide a primary state or its action-needed explanation.
- FR-03.4: F08 SHALL not resolve synchronization source branches, select PRs, confirm a synchronization batch, create sync worktrees, merge, resolve conflicts, validate, or publish; those actions remain with F24-F27.

### FR-04: Loading, empty, error, and restart-restored behavior

- FR-04.1: The inbox SHALL expose distinct loading, populated, empty, and read-error states, with truthful accessible status text and no destructive interpretation of a missing/failed read as an empty persisted dataset.
- FR-04.2: When a refresh fails after a successful read, the inbox SHALL retain and visibly label the last known snapshot, expose a bounded retry/read-again action, and preserve the snapshot's ordering and state reasons until a newer valid snapshot is accepted.
- FR-04.3: A newly created renderer or a restarted application SHALL hydrate from main-process/persisted state and SHALL restore the available managed-PR cards, primary states, reasons, and synchronization overlays without relying on renderer memory.
- FR-04.4: Renderer close, subscription cancellation, read retry, and process restart SHALL not release a per-PR review hold, reset an operation budget, mutate a worktree, or duplicate a durable state transition.

### FR-05: Navigation and read-only interaction

- FR-05.1: The inbox SHALL provide accessible Details and Settings navigation for each managed PR using the F04 validated provider-neutral target contract.
- FR-05.2: Navigation SHALL preserve the managed-PR identity and SHALL not accept arbitrary filesystem paths, raw URLs, IPC channels, credentials, or publication commands from renderer input.
- FR-05.3: Navigation and retry controls SHALL report safe success/failure outcomes, preserve focus predictably, and never make a view action an implicit approval, discard, continuation, or re-evaluation.

### FR-06: Snapshot updates and renderer boundary

- FR-06.1: F08 SHALL subscribe to versioned main-process read-model updates through F04 and SHALL apply only schema-valid, non-stale snapshots.
- FR-06.2: Duplicate updates SHALL be idempotent, and out-of-order updates SHALL not replace a newer accepted projection with older primary state, reason, count, or overlay data.
- FR-06.3: The renderer SHALL derive display groups and labels from the accepted provider-neutral snapshot but SHALL not become the authoritative source for PR state, hold state, synchronization state, or durable history.

### FR-07: Security, accessibility, and platform behavior

- FR-07.1: The main/preload/renderer boundary SHALL validate snapshot, event, error, and navigation schemas and SHALL reject unknown, oversized, secret-shaped, provider-SDK, or platform-specific values before renderer delivery.
- FR-07.2: The inbox SHALL exclude credentials, raw authorization data, prompts, uncontrolled environment values, raw remote URLs, and unbounded child-process/provider output from its read model and visible diagnostics.
- FR-07.3: State groups, cards, controls, errors, updates, and next actions SHALL have semantic names, descriptions, labels, focus order, and status announcements that support keyboard and assistive-technology use.
- FR-07.4: The presentation SHALL remain understandable without color, hover, animation, or pointer-only interaction and SHALL provide truthful capability/omission behavior when a platform-specific overlay or shell action is unavailable.

## Non-Functional Requirements

- **NFR-01: Deterministic projection** - Given the same persisted records, projection version, and injected clock, the grouping, ordering, counts, state labels, and summaries SHALL be reproducible and SHALL not depend on network timing, locale, random values, or renderer arrival order.
- **NFR-02: Responsive presentation** - The inbox SHALL avoid unbounded per-card work, and the implementation evidence SHALL measure fixtures containing 1, 50, and 250 managed PRs. The deterministic projection SHALL complete within 50 ms for the 250-card fixture in the repository's standard test environment, and a slower read/render SHALL keep the UI in a truthful loading/working state rather than showing a partial mixed snapshot.
- **NFR-03: Restart and renderer resilience** - A renderer close, recreation, or application restart SHALL not lose a committed managed-PR/read-model record or create a duplicate state transition; a read/subscription retry SHALL be safe to repeat.
- **NFR-04: Data minimization** - Read models, IPC payloads, diagnostics, and UI state SHALL contain only data needed to identify and understand a managed PR and its presentation; secrets and provider SDK objects SHALL remain behind their owning boundaries.
- **NFR-05: Accessibility** - The inbox SHALL meet the repository's keyboard, semantic HTML, focus, status-announcement, forced-colors/high-contrast, reduced-motion, and screen-reader evidence expectations on the supported Windows desktop path.
- **NFR-06: Platform-neutral contracts** - Shared read-model and navigation contracts SHALL not require Windows handles, paths, shell commands, Electron objects, or renderer-specific state; unsupported platform features SHALL return structured capability results.
- **NFR-07: Bounded failures** - Read, subscription, schema, and navigation failures SHALL have bounded output, stable reason categories, safe remediation, and no unbounded retry loop.

## Invariants

- **INV-01:** The Electron main process and F03 repositories are authoritative for managed-PR state and inbox projections; the renderer is a replaceable view/controller.
- **INV-02:** The only primary PR states presented by F08 are `WATCHING`, `WORKING`, `READY_FOR_REVIEW`, and `NEEDS_ATTENTION`; global pause, local-clone setup, and synchronization are overlays or metadata and do not expand this state machine.
- **INV-03:** Inbox grouping, ordering, counts, and card summaries are deterministic and derived from the same accepted projection snapshot.
- **INV-04:** A synchronization overlay can never hide, replace, or mutate the primary review state, state reason, automatic hold, or review history.
- **INV-05:** A loading, error, stale-read, or unsupported-capability result never deletes persisted managed-PR data or presents absence as successful removal.
- **INV-06:** No inbox read, sort, navigation, retry, renderer close, renderer recreation, or overlay update releases a review hold, authorizes AI work, mutates a worktree, runs validation, or publishes code/comments.
- **INV-07:** Explicit repository and managed-PR identities remain separate in every card and target; same-named repositories or branches are never substituted for missing identity data.
- **INV-08:** The UI never treats model/provider prose, activity text, or a synchronization label as authoritative proof of deterministic progress, validation, publication, or completion.
- **INV-09:** Snapshot inputs used to present a result remain versioned and inspectable; a later mutable setting, remote update, renderer cache, or locale change cannot rewrite the meaning of an already accepted snapshot.
- **INV-10:** Credentials stay in deterministic infrastructure and secure storage; they do not enter renderer state, inbox snapshots, prompts, structured UI data, logs, or navigation targets.

## Requirement Traceability

| Requirement family | Observable coverage |
|---|---|
| FR-01 | AC-01-AC-02, AC-09-AC-11, AC-15 |
| FR-02 | AC-02-AC-05, AC-13, AC-15 |
| FR-03 | AC-06-AC-07, AC-13 |
| FR-04 | AC-08-AC-11, AC-14 |
| FR-05 | AC-12, AC-14-AC-15 |
| FR-06 | AC-10-AC-11, AC-15 |
| FR-07 | AC-12, AC-15-AC-16 |
| NFR-01-NFR-07 | AC-01-AC-16; CT-F08-01-CT-F08-06 |
| INV-01-INV-10 | AC-01, AC-04, AC-06-AC-07, AC-09-AC-16; CT-F08-01-CT-F08-06 |

## Out of Scope

- **Polling and event retrieval** - F10 owns GitHub polling, conditional requests, pagination, immutable remote versions, and feedback detection.
- **Eligibility, holds, batching, and pause enforcement** - F11/F12 own admission, deduplication, automatic holds, quiet periods, Check Now, and global pause behavior. F08 only presents the resulting state and reason.
- **Adding/editing managed PRs** - F07 owns Add PR, clone association, PR Intent / Context, synchronization override editing, and managed-PR identity creation. F08 links to its surfaces.
- **Inbox selection and synchronization confirmation** - F24 owns select/clear/select-all, effective source resolution, eligibility classification, SHA confirmation, and starting a synchronization batch.
- **Review Bundle details and publication** - F18-F23 own proposal/final review screens, complete diffs, conversations, discard/re-evaluate, publication approval, commit/push, and responses.
- **Tray, native notifications, and shutdown** - F19 owns outcome notifications, tray actions, deep-link entry from those surfaces, and **Shutdown PRMonitor**.
- **Activity diagnostics** - F09 owns the durable activity log; F08 may display a bounded summary or navigation target supplied by another feature but does not use free-form activity as state.
- **Git, worktrees, validation, AI, and external side effects** - F13-F18 and F23-F27 own these operations.
- **Per-hunk patch acceptance or alternate primary PR states** - The MVP continues to use one complete proposed diff and the F02 four-state primary review model.

## Product Decisions

- **PD-01: Use one action-needed area with two distinct state presentations** - `NEEDS_ATTENTION` is prioritized before `READY_FOR_REVIEW` because it represents a blocker or required intervention; both remain separately labeled so a warning is not confused with a calm review-ready result.
- **PD-02: Use a stable group and tie-break order** - Top-level groups are action needed, working, and watching. Within a group, cards sort by descending persisted `stateUpdatedAt`, then normalized display repository/reference, then managed-PR identity. This keeps the inbox stable without relying on arrival order.
- **PD-03: Synchronization is an overlay, not a group** - A synchronization operation may be prominent on a card, but it never moves the card out of its primary review group or hides a review bundle/attention state.
- **PD-04: Preserve last known data on refresh failure** - A failed refresh is shown as an error overlay on the last successful snapshot when one exists; the application never turns an unavailable read into an empty inbox.
- **PD-05: Empty state links to Add PR without duplicating Add PR** - The empty inbox offers a validated navigation target to F07's Add PR surface and does not own URL parsing or remote setup.
- **PD-06: Card navigation is read-only** - Details, Settings, and later review/synchronization targets are navigation requests only. They never count as accepting a recommendation, approving publication, releasing a hold, or starting work.

## Implementation Decisions

- **IMP-01: Build one versioned `ManagedPrInboxReadModel`** - The main process requests a projection from F03/F07 repositories and publishes a single snapshot containing cards, groups/counts, and optional synchronization overlay data; the renderer does not assemble state from independent repository calls.
- **IMP-02: Keep projection and presentation separate** - A deterministic shared projection module owns identity validation, group derivation, ordering, and stale-snapshot rejection; React components own layout, focus, and accessible presentation only.
- **IMP-03: Reuse F04's validated query/subscription and open-target contracts** - F08 adds allowlisted inbox query/subscription routes and details/settings targets through the existing boundary instead of exposing database queries, arbitrary routes, or Electron objects.
- **IMP-04: Treat synchronization data as optional input** - F08 can render a provider-neutral overlay supplied by F03/F24-F27, including a test fixture for each supported status, without importing synchronization services or implementing source resolution.
- **IMP-05: Use structured reason data** - The renderer receives bounded reason keys, safe display parameters, and permitted next-action metadata. It does not infer what/why/next from status labels or free-form logs. Downstream review/synchronization targets can be added by their owning features through the same F04 target contract without making them required for the F08 primary card.
- **IMP-06: Keep display formatting at the edge** - Ordering and equality use canonical values and UTC instants; localized date/number formatting is performed only in the renderer after projection acceptance.

## Testing Decisions

- **TST-01: Deep-test the deterministic projection** - Unit and property-style tests cover identity uniqueness, all state/group combinations, tie-break ordering, stable counts, overlay independence, stale update rejection, and duplicate replay.
- **TST-02: Use contract-level IPC tests** - Test the allowlisted inbox query, subscription, error, and navigation schemas with malformed, oversized, secret-shaped, and renderer-disconnect inputs; do not require a real GitHub server, provider, or user repository.
- **TST-03: Exercise restart and last-known-data behavior** - Integration fixtures commit multiple managed PR projections, close/recreate the renderer, restart the main process, fail a refresh, and verify that durable state and truthful error/last-known presentation survive.
- **TST-04: Test accessibility semantics, not pixel snapshots** - Verify headings, group relationships, card names/descriptions, keyboard order, focus return, live announcements, forced colors, reduced motion, and error recovery. Visual styling is reviewed at the UI boundary rather than duplicated in domain tests.
- **TST-05: Prove non-effects** - F08 tests use spies/fakes to prove that inbox reads, sorting, navigation, retries, and overlay changes do not call polling, AI, Git, validation, publication, or hold-release services.

## Proposed Modules

- **MOD-01: Managed PR Inbox Projection** - Reads F03/F07 records and creates the versioned provider-neutral snapshot with safe card fields and optional overlays.
- **MOD-02: Inbox Grouping and Ordering** - Derives action-needed/working/watching groups, priority, tie-break order, counts, and stale/duplicate snapshot decisions.
- **MOD-03: Synchronization Overlay Projection** - Validates and presents optional synchronization statuses without coupling them to the primary PR state reducer.
- **MOD-04: Inbox IPC Query and Subscription Adapter** - Exposes allowlisted read/subscription requests and normalized errors through F04.
- **MOD-05: Inbox Screen and Card Components** - Renders loading, empty, populated, last-known/error, group, card, overlay, and navigation states with accessible semantics.
- **MOD-06: Managed-PR Navigation Target Builder** - Builds validated Details/Settings and optional downstream review/synchronization targets from stable IDs only.

## Workflows

### Workflow 1: Open an inbox with multiple managed PRs

```text
1. The renderer requests the inbox snapshot through F04.
2. The main process reads the current F03/F07 managed-PR projection and optional sync overlays.
3. The projection validates the snapshot version and derives the documented groups/order.
4. The renderer displays action-needed, working, and watching groups with exact primary-state labels.
5. Each card exposes Details/Settings navigation without starting product work.
```

### Workflow 2: Restore after renderer close or restart

```text
1. A renderer is destroyed or the application restarts after managed PR state is committed.
2. A new renderer performs a fresh readiness handshake and requests the current snapshot.
3. F08 rejects any stale/duplicate snapshot and accepts the newest valid version.
4. The inbox restores cards, reasons, and available overlays without releasing holds or duplicating transitions.
```

### Workflow 3: Show a review state with a synchronization overlay

```text
1. A managed PR remains READY_FOR_REVIEW or NEEDS_ATTENTION in the primary projection.
2. F24-F27 provide a separate synchronization result/status projection.
3. F08 renders the overlay beside the unchanged primary state and reason.
4. An overlay update changes only overlay content unless the primary persisted projection also changes.
5. The user can navigate to a supplied details/review/synchronization target; navigation does not authorize work.
```

### Workflow 4: Read failure and recovery

```text
1. The first read is in progress, so the inbox shows loading rather than empty.
2. If the persisted projection is empty, the inbox shows Add PR guidance.
3. If a later refresh fails, the inbox keeps the last successful snapshot and shows a bounded error/retry state.
4. A successful newer snapshot replaces the last-known data atomically and recomputes the deterministic order.
```

## Contract-Test Criteria

- **CT-F08-01:** Projection identity, field completeness, duplicate suppression, and explicit repository identity.
- **CT-F08-02:** Four-state grouping, deterministic priority/tie-break order, counts, and reason/state pairing.
- **CT-F08-03:** Independent synchronization overlay updates and non-mutation of primary state/holds.
- **CT-F08-04:** Loading/empty/error/last-known/restart behavior and stale/duplicate snapshot handling.
- **CT-F08-05:** IPC schema, navigation target, secret/raw-provider-value rejection, and renderer-disconnect behavior.
- **CT-F08-06:** Keyboard, screen-reader, live-region, forced-colors, reduced-motion, focus, and non-effect UI evidence.
