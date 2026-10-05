# F04 - Persistent Electron Shell, IPC Boundary, and Windows Virtual-Desktop Spike - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F01 - Application workspace and engineering foundation | Provides the Electron application shell, main/preload/renderer/shared boundaries, production smoke harness, and deterministic test conventions. |
| 2 | F02 - Domain contracts and deterministic state machines | Provides provider-neutral request/result/error shapes, lifecycle-safe reasons, hold semantics, and the rule that renderer commands are requests rather than authoritative state changes. |
| 3 | F03 - SQLite persistence, migrations, and transactional repositories | Provides the main-process persistence authority, lifecycle/recovery records, transactional boundaries, and restart-safe repositories used by long-running services. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F05-F07 - GitHub setup and managed PRs | Use the persistent main-process composition root and validated IPC without placing credentials or remote state in the renderer. |
| 2 | F08-F12 - Inbox, diagnostics, polling, eligibility, and scheduling | Run as main-process services that must continue after window destruction and expose read models through the IPC boundary. |
| 3 | F13-F18 - Worktrees, validation, AI, and review preparation | Depend on renderer closure being independent from operation lifetime and on safe request routing for user actions. |
| 4 | F19 - System tray, native notifications, deep links, and shutdown | Uses the window manager, open-target routing, focus adapter, and explicit shutdown contract established here. F19 owns tray and notification behavior. |
| 5 | F20-F27 - Review, synchronization, and publication UI/workflows | Use validated IPC commands, route targets, lifecycle state, and renderer recreation while keeping durable work in the main process. |
| 6 | F28-F30 - Recovery, security, and release readiness | Harden lifecycle recovery, process boundary security, packaging, installation, and clean-machine virtual-desktop behavior. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-04 | FR-01.1-FR-01.4, FR-02.1-FR-02.5, INV-01-INV-02 | AC-02-AC-04 | Shared enabler: F04 owns the UI-independent main-process lifetime and renderer-destruction contract; F10 owns actual polling while the window is closed. |
| APP-AC-17 | FR-01.1-FR-01.6, FR-02.1-FR-02.6, FR-03.1-FR-03.7, INV-01-INV-03, INV-09 | AC-02-AC-04, AC-09 | Shared: F04 owns main-process authority, renderer independence, window destruction, and hold-preserving lifecycle requests; F19 owns notification/tray integration. |
| APP-AC-20 | FR-02.2-FR-02.6, FR-05.1-FR-05.7, FR-06.1-FR-06.6, INV-05-INV-07 | AC-05-AC-08, AC-12 | Primary F04 ownership: F04 proves the Windows A/B/C window creation, activation, and focus contract; F19 later consumes it for tray and notification entry points. |
| APP-AC-30 | FR-01.1-FR-01.6, FR-02.1-FR-02.6, FR-04.1-FR-04.5, INV-01-INV-03 | AC-02-AC-04, AC-09 | Shared: F04 owns the distinction between normal window close and application shutdown; F19 owns the user-visible **Shutdown PRMonitor** command. |
| APP-AC-31 | FR-01.5, FR-06.1-FR-06.6, INV-03 | AC-09-AC-10 | Shared lifecycle contract: F04 owns shutdown authorization, handoff, and bounded teardown hooks; F19 owns the tray command and complete user-visible shutdown flow. |

F04 deliberately does not claim APP-AC-15, APP-AC-18, or APP-AC-19. Native notifications, tray menus, notification-click behavior, and the user-facing shutdown command are owned by F19; F04 supplies the lifecycle, teardown, and routing contracts those behaviors consume. APP-AC-04 and APP-AC-31 are shared enablers here, not complete F04-only workflow claims.

## Executive Summary

PRMonitor must remain a running local worker when its visible window is closed. The current F01 shell is launchable, but it does not yet provide the product's persistent lifecycle, validated main-to-renderer boundary, single-instance behavior, deep-link routing, or Windows virtual-desktop behavior. Without this feature, closing a window could accidentally stop monitoring or AI work, a renderer could become an unsafe privileged entry point, and opening PRMonitor from another desktop could focus an obsolete hidden window on the wrong desktop.

F04 turns the F01 shell into a persistent desktop application boundary. The Electron main process owns application lifetime, durable state access, long-running services, and lifecycle decisions. A renderer is a replaceable view that can be created on demand, destroyed on ordinary close, and recreated later from current main-process state. A narrow, schema-validated IPC surface lets the renderer request reads and user actions without gaining direct access to Node, Electron, credentials, providers, Git, or the database. Single-instance and deep-link routing deliver an open target to the existing process, and a Windows-specific adapter isolates the behavior needed to create and focus a window on the currently active virtual desktop.

The feature includes an early Windows Desktop A/B/C spike. It must exercise the real application shell across three virtual desktops, document foreground/focus behavior, and establish the tested adapter contract before tray and notification workflows depend on it. F04 does not implement the tray, native notification copy/delivery, product workflows, or full startup recovery; those features use this shell boundary.

## User Stories

### Keep the worker running without a window

- **US-01:** **GIVEN** PRMonitor has watchers, jobs, or other main-process work in progress, **WHEN** the developer closes the normal application window, **THEN** the visible renderer window is destroyed while the main process, durable state, work, and per-PR review holds remain active.
  - **Acceptance Criteria:** AC-02, AC-03, AC-09.
- **US-02:** **GIVEN** no visible window exists, **WHEN** the developer opens PRMonitor again, **THEN** a new renderer window is created from current main-process state and the prior window's lifetime does not determine or corrupt that state.
  - **Acceptance Criteria:** AC-04, AC-05.
- **US-03:** **GIVEN** the developer wants to stop the application, **WHEN** the explicit **Shutdown PRMonitor** lifecycle request is received, **THEN** the application stops accepting new work according to its shutdown contract, persists the shutdown outcome, removes its process-level resources through their owning services, and exits; ordinary window close never performs this action.
  - **Acceptance Criteria:** AC-09, AC-10.

### Use a safe renderer boundary

- **US-04:** **GIVEN** a renderer requests application data or a user action, **WHEN** the request crosses the process boundary, **THEN** the main process validates the channel, payload, authorization context, and result shape before reading state or invoking a domain service.
  - **Acceptance Criteria:** AC-01, AC-06, AC-11.
- **US-05:** **GIVEN** a renderer is destroyed while a request or background operation is active, **WHEN** the main process continues processing it, **THEN** the operation is not cancelled or duplicated merely because the reply target disappeared, and a later renderer can observe the persisted result.
  - **Acceptance Criteria:** AC-03, AC-04, AC-11.

### Reopen the right application target

- **US-06:** **GIVEN** PRMonitor is already running, **WHEN** a second launch or supported deep link is received, **THEN** the existing main process remains the sole instance, validates and routes the target once, and creates or focuses a renderer window for that target.
  - **Acceptance Criteria:** AC-05, AC-06, AC-07.
- **US-07:** **GIVEN** the developer closes PRMonitor on Windows Desktop A, switches to Desktop B or C, and opens PRMonitor from the supported entry point, **WHEN** the shell recreates the window, **THEN** the window appears and receives focus on the currently active desktop under the tested Windows behavior, or the application reports a bounded actionable focus limitation without creating a second process or losing the target.
  - **Acceptance Criteria:** AC-05, AC-07, AC-08, AC-12.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** the production Electron artifact starts, **WHEN** the main process initializes the application, **THEN** it creates one authoritative lifecycle owner before the renderer is created, opens the F03 persistence boundary through the main process, and exposes no privileged application capability directly to renderer JavaScript.
- **AC-02:** **GIVEN** a visible PRMonitor window exists, **WHEN** the user closes the normal window, **THEN** the `BrowserWindow` is destroyed and removed from the window manager, no replacement hidden window remains, the main process stays alive, and no watcher, AI operation, durable transaction, automatic hold, or active operation is cancelled or released solely because of that close.
- **AC-03:** **GIVEN** a renderer command or subscription is active, **WHEN** the renderer is destroyed before its response or stream completes, **THEN** the main process either completes the requested main-process work or records a deterministic cancellation/failure according to the domain contract; it never rolls back a committed transaction, duplicates the action, releases a hold, or treats renderer destruction as application shutdown.
- **AC-04:** **GIVEN** no visible window exists, **WHEN** an open request is received, **THEN** the main process creates a fresh renderer window, hydrates it from an authoritative current-state/read-model request, and does not depend on the destroyed renderer's in-memory state; repeated open requests are idempotent while a window is being created.
- **AC-05:** **GIVEN** PRMonitor is closed to the window but its main process remains active, **WHEN** it is opened from the current Windows virtual desktop, **THEN** the shell creates or focuses the window on that active desktop and applies the tested focus/foreground behavior without leaving a stale window associated with the previous desktop; the evidence identifies any Windows foreground restrictions and the user-visible fallback.
- **AC-06:** **GIVEN** a second process launch, command-line route, or supported `prmonitor://` deep link is received, **WHEN** the single-instance/deep-link router handles it, **THEN** exactly one primary process validates the route, rejects malformed or unsupported targets without external effects, forwards a normalized target to the primary process when necessary, and opens the target after the renderer is ready; a duplicate delivery does not open a second window or execute the target twice.
- **AC-07:** **GIVEN** a deep link or open target arrives before a renderer is ready, **WHEN** the main process queues it, **THEN** the target survives window creation, is delivered at most once to the new renderer, and cannot carry credentials, arbitrary filesystem paths, arbitrary IPC channels, or publication authority.
- **AC-08:** **GIVEN** the Windows virtual-desktop spike is run, **WHEN** the test operator launches on Desktop A, closes the window, opens from Desktop B, closes again, and opens a review-oriented target from a notification/tray simulation on Desktop C, **THEN** the evidence records the created process/window identity, active desktop at each action, focus/foreground result, target delivery, timing, and any fallback; the spike is repeatable and does not use a hidden persistent window as a substitute for the required close/recreate behavior.
- **AC-09:** **GIVEN** the application is running without a visible window, **WHEN** a normal close, renderer crash, renderer reload, or duplicate open request occurs, **THEN** main-process services and durable state remain available; only an explicit lifecycle request named **Shutdown PRMonitor** may begin application termination, and the word **Quit** is not used for that command or its user-facing result.
- **AC-10:** **GIVEN** **Shutdown PRMonitor** is explicitly requested, **WHEN** the F04 lifecycle hook receives the request, **THEN** it persists shutdown intent, prevents new work from being admitted according to the owning service contracts, coordinates bounded service handoff, preserves in-flight durable records for recovery, and returns a machine-readable success or recovery diagnostic to the owning shutdown surface; F19 owns the complete user-facing command and final process-exit flow, and repeating the request is idempotent.
- **AC-11:** **GIVEN** an IPC channel, request payload, response, event, or deep-link target is unknown, malformed, oversized, unauthorized, or contains a secret-shaped value, **WHEN** it reaches a process boundary, **THEN** it is rejected with a safe structured error before a product service, filesystem, credential store, child process, GitHub client, provider, or publication service is invoked; no raw exception, token, prompt, or uncontrolled environment value crosses the boundary.
- **AC-12:** **GIVEN** the Windows focus/activation API is unavailable, denied, changes behavior across virtual desktops, or times out, **WHEN** the window manager handles an open request, **THEN** it keeps the main process and durable work alive, reports an actionable focus result, leaves the normalized target available for a user retry, and never launches a duplicate process or silently targets the developer's normal worktree.

## Functional Requirements

### FR-01: Main-process authority and application lifetime

- FR-01.1: The application SHALL designate the Electron main process as the sole owner of application lifetime, durable repository access, long-running services, lifecycle coordination, and authoritative mutable state projections.
- FR-01.2: The renderer SHALL be a replaceable view/controller and SHALL not own watchers, schedulers, AI operations, Git operations, validation processes, publication work, durable transactions, credentials, or authoritative domain state.
- FR-01.3: The main process SHALL initialize its lifecycle owner and required F03 persistence boundary before exposing product IPC or accepting a renderer as ready; initialization failure SHALL produce a safe actionable result and SHALL not create a misleading ready renderer.
- FR-01.4: The application SHALL keep the main process alive when the normal visible window is closed, destroyed, reloaded, or crashes, subject to explicit shutdown or unrecoverable startup failure.
- FR-01.5: Only an explicit lifecycle command named **Shutdown PRMonitor** SHALL authorize application termination in the normal product flow. Normal window close, renderer destruction, navigation, notification selection, tray selection, or a second launch SHALL not terminate the primary process.
- FR-01.6: Lifecycle transitions SHALL be represented by deterministic state/reason records and correlation IDs through the F03 persistence boundary or activity repository; free-form console output SHALL not be the authoritative lifecycle state.

### FR-02: On-demand renderer window lifecycle

- FR-02.1: The window manager SHALL create a visible renderer window on demand when an open request is accepted and SHALL destroy it on normal close rather than retaining a hidden window associated with an older virtual desktop.
- FR-02.2: The window manager SHALL maintain at most one visible PRMonitor renderer window for the primary process and SHALL make concurrent create/open requests idempotent while creation is pending.
- FR-02.3: Recreated windows SHALL hydrate from main-process queries/read models and SHALL not restore authoritative state from a prior renderer memory snapshot.
- FR-02.4: Window creation, readiness, close, destruction, reload, crash, and focus outcomes SHALL have bounded timeouts and structured reasons that distinguish user close, renderer failure, focus limitation, and main-process shutdown.
- FR-02.5: A renderer lifecycle event SHALL not release a per-PR review hold, reset an AI turn budget, roll back a committed persistence transaction, mutate an operation-owned worktree, or authorize publication.
- FR-02.6: The window manager SHALL expose platform-neutral open/focus/close results so later tray, notification, review, and synchronization features do not call Electron `BrowserWindow` objects directly.

### FR-03: Validated IPC boundary

- FR-03.1: The application SHALL expose only a narrow, explicitly allowlisted IPC contract for renderer queries, user actions, subscriptions, lifecycle status, and renderer-ready handshakes.
- FR-03.2: Every incoming channel name, payload, request correlation value, authorization context, and outgoing response/event SHALL be validated against a versioned provider-neutral schema before use or delivery.
- FR-03.3: IPC handlers SHALL translate renderer requests into main-process service calls and SHALL return structured success/error results; they SHALL not expose arbitrary method names, filesystem paths, SQL, child-process arguments, provider SDK objects, Electron objects, or credential values.
- FR-03.4: The renderer SHALL have no direct Node.js integration, Electron module access, filesystem/process access, provider SDK access, database connection, or secure credential-store access. Context isolation SHALL remain enabled.
- FR-03.5: IPC request handling SHALL be safe when the renderer disappears: a reply may be dropped after destruction, but the main-process operation's durable and external-effect semantics SHALL be determined by the owning service rather than by the reply lifecycle.
- FR-03.6: Renderer subscriptions SHALL be scoped to the renderer instance and correlation/stream identity; a newly created renderer SHALL establish fresh subscriptions and SHALL not inherit stale callbacks from a destroyed renderer.
- FR-03.7: IPC failures, rejected schemas, handler exceptions, and renderer disconnects SHALL produce bounded safe diagnostics without leaking secrets, prompts, raw SDK errors, or uncontrolled environment values.

### FR-04: Single instance and deep-link routing

- FR-04.1: The application SHALL acquire one primary-process instance lock before starting product services; a secondary launch SHALL not initialize a second database, watcher, provider, tray, or publication owner.
- FR-04.2: A secondary launch or supported deep-link delivery SHALL forward a normalized open target to the primary process and SHALL exit or return control without becoming a competing application instance.
- FR-04.3: The route parser SHALL accept only documented PRMonitor target forms, including provider-neutral targets for a managed PR, Review Bundle, synchronization batch/result, or application home; it SHALL reject malformed schemes, unsupported target kinds, unbounded payloads, duplicate/conflicting identifiers, arbitrary filesystem paths, and credentials.
- FR-04.4: A target received before the renderer is ready SHALL be queued in the main process and delivered exactly once after readiness, with deterministic duplicate suppression for the same launch/request identity.
- FR-04.5: Deep-link routing SHALL select or open a view target only; it SHALL not itself start AI work, publish code/comments, release a hold, change a domain state, or grant an IPC capability. The owning main-process service must receive an explicit validated request for any state-changing action.

### FR-05: Platform window and focus adapter

- FR-05.1: Platform-specific window creation, focus, foreground activation, active-desktop observation, and shell fallback behavior SHALL be isolated behind a small OS adapter contract.
- FR-05.2: The Windows adapter SHALL provide the behavior required to create or focus a new PRMonitor window on the currently active virtual desktop after a normal window close, subject to documented Windows foreground restrictions and bounded failure handling.
- FR-05.3: The shared lifecycle and routing code SHALL not depend on Windows-only APIs, path formats, native handles, or shell commands; unsupported platforms SHALL return a structured capability result rather than importing Windows behavior into shared or renderer code.
- FR-05.4: Focus requests SHALL be idempotent and SHALL distinguish `created`, `focused`, `already-focused`, `focus-denied`, `timed-out`, and `unsupported` outcomes without treating a focus failure as a process failure.
- FR-05.5: The adapter SHALL not open, reveal, or mutate a developer worktree as a side effect of opening PRMonitor. Worktree actions remain owned by the later OS shell/worktree features.
- FR-05.6: The adapter contract SHALL support test doubles for active-desktop identity, window identity, focus result, timeout, and denial so lifecycle tests do not depend on a developer's desktop arrangement.
- FR-05.7: The Windows A/B/C spike SHALL be completed before F19 relies on the adapter for tray or notification entry points, and its result SHALL record any accepted fallback behavior as a versioned implementation decision.

### FR-06: Explicit shutdown and handoff

- FR-06.1: The lifecycle owner SHALL expose an explicit shutdown request separate from normal window close and SHALL make repeated shutdown requests idempotent.
- FR-06.2: Before shutdown side effects begin, the application SHALL persist shutdown intent and a correlation identity through the main-process persistence boundary.
- FR-06.3: Shutdown SHALL stop admission of new work according to the owning service contracts, allow each service to persist its current outcome or recovery marker, and use bounded waits; it SHALL not claim that an interrupted external effect succeeded.
- FR-06.4: The F04 shutdown hook SHALL coordinate removal of process-owned resources, including the visible window and later tray/resource handles, only after their owning services have received the documented stop signal; F04 SHALL provide the lifecycle hook without taking ownership of later feature resources, and F19 SHALL own the complete user-facing shutdown flow.
- FR-06.5: A renderer close, renderer crash, lost IPC reply, or failed focus request SHALL never be converted into an implicit shutdown request.
- FR-06.6: On startup after a prior normal or interrupted process lifetime, F04 SHALL expose lifecycle status and incomplete-operation handoff information to the owning recovery feature without silently authorizing new AI work or publication. Full restart/sleep/network recovery remains F28.

### FR-07: Windows virtual-desktop spike and evidence

- FR-07.1: The spike SHALL test launching on Desktop A, closing the visible window, opening from the tray/open simulation on Desktop B, closing again, and opening a deep-link/notification simulation on Desktop C.
- FR-07.2: The spike SHALL measure and record the active desktop at each action, process and window identity, renderer-ready time, target delivery, foreground/focus result, and whether the window was recreated rather than reused hidden.
- FR-07.3: The spike SHALL exercise both an ordinary home target and a target carrying a review-oriented route, without contacting GitHub, invoking an AI provider, publishing, or mutating a developer repository.
- FR-07.4: A failed, denied, or inconsistent Windows activation result SHALL be recorded as a concrete limitation with an actionable fallback and SHALL fail the acceptance gate if no user-understandable behavior is defined.
- FR-07.5: The spike evidence SHALL be repeatable by a fresh process and shall not depend on a prior hidden window, renderer cache, developer credential, or uncommitted local file.

## Non-Functional Requirements

- **NFR-01: Lifecycle reliability** - Ordinary renderer close, reload, crash, and recreation SHALL not lose or duplicate main-process work; committed F03 records remain authoritative.
- **NFR-02: Boundary security** - IPC and deep-link parsing SHALL fail closed, use least privilege, validate both directions, and exclude credentials, prompts, raw provider objects, and uncontrolled environment values.
- **NFR-03: Bounded behavior** - Window creation, readiness, focus, deep-link forwarding, shutdown, and renderer reply handling SHALL have explicit bounded timeouts and shall not hang the main process indefinitely.
- **NFR-04: Determinism** - Given the same serialized request, lifecycle state, adapter result, and injected clock, the shell returns the same normalized outcome without AI or product-service access.
- **NFR-05: Portability** - Shared lifecycle, IPC, routing, and domain code remains platform-neutral; Windows-specific behavior is replaceable behind the OS adapter.
- **NFR-06: Accessibility and focus** - A recreated window exposes a deterministic focus target and keyboard-reachable startup/error state; a denied foreground request does not trap the user without an actionable open/focus result.
- **NFR-07: Diagnosability** - Lifecycle, routing, IPC rejection, focus, and shutdown outcomes include machine-readable reasons, correlation IDs, and bounded details suitable for later activity presentation.
- **NFR-08: Resource discipline** - At most one visible renderer window, one primary lifecycle owner, and one active route delivery per request identity exist at a time; event listeners and native handles are released on destruction or shutdown.

## Invariants

- **INV-01:** The Electron main process and F03 persistence boundary are authoritative for application lifetime, durable work, and mutable application state; renderer memory is never authoritative.
- **INV-02:** Closing, reloading, or destroying a renderer window is not application shutdown and cannot cancel, reset, release, or authorize a main-process operation by itself.
- **INV-03:** Only the explicit **Shutdown PRMonitor** lifecycle request may terminate the normal primary process; a secondary launch, open target, focus failure, or renderer failure cannot terminate it.
- **INV-04:** Every IPC and deep-link boundary is allowlisted, schema-validated, least-privilege, and fail-closed; no boundary exposes credentials, arbitrary paths/commands, provider SDK objects, or publication authority.
- **INV-05:** There is at most one primary application process and at most one visible renderer window for that process; secondary launches route to the primary or fail safely.
- **INV-06:** Platform-specific window/desktop behavior is isolated behind an OS adapter and cannot leak into renderer-safe shared contracts or dictate unrelated product services.
- **INV-07:** The active Windows virtual-desktop behavior is established by real A/B/C evidence before downstream tray/notification entry points depend on it; limitations have an explicit user-facing fallback.
- **INV-08:** Deep-link and open-target routing selects a view or request target but never grants publication, GitHub, credential, AI, or filesystem authority.
- **INV-09:** Per-PR review holds, persisted budgets, transaction outcomes, and operation-owned worktrees remain governed by F02/F03 and are not changed by window lifetime or focus behavior.

## Out of Scope

- System tray icon, tray menu contents, paused indicator, and tray command presentation - F19.
- Native notification delivery, notification copy, click actions, and notification-specific worktree links - F19.
- GitHub authentication, API calls, polling, PR state, review bundles, AI work, validation, Git/worktrees, synchronization, and publication - F05-F28.
- Full restart, sleep/wake, network-loss, orphaned-worktree, and uncertain-outcome recovery orchestration - F28; F04 only exposes lifecycle handoff points and preserves durable state.
- Installer protocol registration, signing, update channels, and clean-machine packaging - F30; F04 tests parser/forwarding behavior through the shell inputs available in the development artifact.
- Review inbox, Review Bundle, diff viewer, synchronization UI, and application-specific renderer screens - F08, F20-F27.
- Cross-platform native window activation implementations beyond the platform-neutral adapter contract and the Windows MVP spike.
- An always-hidden BrowserWindow, renderer-owned background loop, browser-hosted replacement, or any autonomous publication path.

## Product Decisions

- **PD-01: Close means destroy the visible window** - The normal close action removes the renderer window so a later open request can associate a new window with the current virtual desktop.
- **PD-02: Shutdown is a separate user intent** - The product uses the exact command name **Shutdown PRMonitor**; normal close is not a synonym and the user-facing command does not use “Quit”. F04 owns the protocol and F19 owns the user-facing completion flow.
- **PD-03: One process, many renderer lifetimes** - A primary process owns the worker; renderer windows are disposable views that can be recreated without resetting work.
- **PD-04: Route before rendering, act only through services** - Deep links and open targets may select a view, but state-changing actions require an explicit validated main-process service request after routing.
- **PD-05: Current-desktop focus is the Windows MVP target** - The application attempts to create/focus the new window on the active Windows virtual desktop and reports a clear retryable limitation when Windows denies foreground activation.
- **PD-06: Focus failure is not work failure** - A foreground limitation must not stop background work, corrupt durable state, or create a second application instance.

## Implementation Decisions

- **IMP-01: Main lifecycle coordinator** - Implement one main-process lifecycle coordinator that composes F03 persistence, the window manager, IPC router, instance/deep-link router, and downstream service start/stop hooks.
- **IMP-02: Typed allowlist over generic IPC** - Use versioned shared schemas and explicit channel handlers; there is no generic “call service by name” or renderer-supplied method/SQL/command channel.
- **IMP-03: Context-isolated preload** - Keep `nodeIntegration` disabled and `contextIsolation` enabled. The preload exposes only the generated/handwritten typed bridge required by F04 and later feature contracts.
- **IMP-04: Platform adapter** - Define a platform-neutral window/focus adapter and provide a Windows implementation plus deterministic fake adapters for tests. Windows-specific activation calls remain in the main-process adapter module.
- **IMP-05: Main-process route queue** - Normalize secondary-launch/deep-link targets before queueing them in the main process; deliver them after renderer readiness with request-identity deduplication.
- **IMP-06: Durable handoff, not renderer snapshots** - Use F03 lifecycle/activity and operation repositories for shutdown intent and handoff diagnostics. Recreated renderers always query current projections/history rather than receiving an authoritative serialized renderer cache.
- **IMP-07: Spike as a release gate for dependents** - Record the Desktop A/B/C result, adapter behavior, timing, and fallback as checked-in test evidence or a controlled evidence artifact consumed by F19/F30.

## Testing Decisions

- **TST-01: Test deep lifecycle modules** - Unit-test the lifecycle coordinator, window state reducer, IPC contract/router, instance lock/forwarding logic, deep-link parser/queue, and OS adapter contract with injected clocks and fakes.
- **TST-02: Use a real Electron smoke boundary** - Exercise production-like main/preload/renderer creation, close/recreate, renderer crash/reload, IPC validation, and route delivery with the F01 artifact harness; do not treat a browser-only test as sufficient.
- **TST-03: Use a real Windows desktop matrix** - Run the A/B/C spike on Windows with a human-observable or automation-captured desktop/focus report. A fake adapter can prove deterministic failure and retry behavior but cannot replace the Windows acceptance evidence.
- **TST-04: Test operation lifetime independently** - Use fake long-running main-process work and F03 transaction probes to verify that renderer destruction drops replies without cancelling, duplicating, rolling back, or releasing holds.
- **TST-05: Test hostile boundaries** - Cover malformed/oversized/duplicate routes, unknown channels, invalid payloads, unauthorized actions, secret-shaped fields, renderer disconnects, and handler exceptions; assert no external service or filesystem effect occurs.
- **TST-06: Defer owning feature behavior** - Do not duplicate tray, notification, GitHub, AI, worktree, validation, publication, or full recovery tests. F04 proves the shell contracts those features consume and records explicit handoff evidence.

## Proposed Modules

- **MOD-01: Application lifecycle coordinator** - Starts and stops main-process services, tracks lifecycle phase/reason, and separates renderer close from explicit shutdown.
- **MOD-02: Window manager** - Creates, readies, destroys, recreates, and focuses the single visible renderer window through the OS adapter.
- **MOD-03: Validated IPC contract** - Defines versioned request, response, event, subscription, and lifecycle schemas with safe serialization.
- **MOD-04: IPC router and renderer session** - Validates incoming messages, scopes subscriptions to a renderer session, routes requests to main services, and safely handles renderer disappearance.
- **MOD-05: Primary-instance coordinator** - Acquires the single-instance lock, receives secondary-launch data, and forwards only normalized targets to the primary process.
- **MOD-06: Deep-link parser and target queue** - Parses supported PRMonitor targets, suppresses duplicate deliveries, queues before readiness, and never grants action authority.
- **MOD-07: Platform window/focus adapter** - Isolates Windows virtual-desktop and foreground behavior behind a deterministic result contract.
- **MOD-08: Lifecycle evidence and handoff recorder** - Persists safe shutdown intent, session/correlation facts, and bounded recovery handoff information through F03.

## Workflows

### Workflow 1: Normal close and reopen

```text
1. The main process owns active services and one visible renderer window.
2. The user closes the normal window.
3. The window manager destroys the BrowserWindow and releases renderer-scoped listeners.
4. Main-process services and F03 state continue; review holds and active work are unchanged.
5. The user opens PRMonitor from the current desktop.
6. The main process creates a fresh BrowserWindow through the platform adapter.
7. The renderer performs a ready handshake and queries current state through validated IPC.
8. The window manager focuses the new window and delivers any queued view target once.
```

### Workflow 2: Secondary launch or deep link

```text
1. The primary process owns the single-instance lock.
2. A second launch or supported deep link arrives with raw launch data.
3. The primary-instance coordinator forwards the raw data to the primary process or receives it directly.
4. The deep-link parser validates and normalizes the target, rejecting unsafe or duplicate data.
5. The main process creates a window if needed and queues the target until renderer readiness.
6. The renderer receives one typed target and requests its view through ordinary IPC.
7. Any state-changing action is separately validated and dispatched to its owning main-process service.
```

### Workflow 3: Renderer destruction during background work

```text
1. A main-process service has durable operation intent and is performing bounded work.
2. The renderer sends a request or subscribes to progress.
3. The renderer closes, crashes, or is destroyed.
4. The IPC router removes that renderer session and drops undeliverable replies.
5. The main-process service continues or stops according to its own operation contract, never according to the renderer lifetime.
6. A recreated renderer reads the persisted current result and history.
```

### Workflow 4: Explicit shutdown

```text
1. A trusted UI/tray lifecycle request explicitly names Shutdown PRMonitor.
2. The main lifecycle coordinator validates the request and persists shutdown intent.
3. New work admission stops according to the owning service contracts.
4. Services receive bounded stop/handoff requests and persist in-flight outcomes.
5. The window and process-owned resources are closed through their owners.
6. The lifecycle hook returns a safe success or recovery diagnostic to the owning shutdown surface; F19 performs the user-facing completion and final process exit.
```

### Workflow 5: Windows Desktop A/B/C spike

```text
1. Launch PRMonitor on Windows Desktop A and record process/window/desktop identity.
2. Close the visible window and verify the main process remains alive.
3. Switch to Desktop B and open PRMonitor from the tray/open simulation.
4. Record whether a fresh window appears and receives focus on Desktop B.
5. Close the window, switch to Desktop C, and deliver a review-oriented deep-link/notification simulation.
6. Record route delivery, renderer readiness, focus/foreground result, and timing on Desktop C.
7. Repeat from a fresh process and publish the adapter result and fallback for downstream features.
```


## Issue 1 supplement: Startup landing and recovery

Approved scope: [resumable setup on startup](https://github.com/bryant-collab/PRMonitor/issues/1). Default HOME/launch/window recreation reads the bounded main-owned five-check setup projection before choosing setup or inbox. Explicit saved-work targets remain view requests and take precedence with a setup-attention banner. Database or local-root bootstrap failure opens a recovery-only setup shell that preserves original data and admits no domain services. Ordinary setup reads never relaunch; explicit Retry coalesces a restart attempt of the same authoritative configuration and carries the latest validated view target. No setup screen pauses or cancels work.
