<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single layer. The goal is to provide the AI and the user with a visible and testable result when the work is complete.
-->

# Plan: F04 Persistent Electron Shell, IPC Boundary, and Windows Virtual-Desktop Spike

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** `Specs/persistent_electron_shell_ipc_boundary_and_windows_virtual_desktop_spike_PRD.md`
>
> **Last revalidated against:** `Specs/application_overview.md` revision 2026-09-20 and F04 PRD revision 2026-09-20
>
> **Entry/readiness gates:** F01's production Electron artifact, main/preload/renderer/shared boundaries, smoke harness, and deterministic test commands are green. F02 domain contracts and F03 persistence/repository contracts are available. A Windows test environment with at least three usable virtual desktops is available for the A/B/C spike. F05-F19 service implementations are not required; F04 must provide their lifecycle, IPC, routing, and focus seams without inventing their product behavior.
>
> This PLAN cannot change product requirements. Resolve contradictions in the owning PRD before implementation and rerun both specification linters. This feature does not check the checklist item; implementation and approval are separate.

## Implementation Boundary

F04 extends the F01 desktop shell under `apps/desktop/src/main`, `apps/desktop/src/preload`, and `apps/desktop/src/shared`. The main process becomes the lifecycle/composition owner for the application. A window manager owns the single visible `BrowserWindow`; an IPC router owns a versioned allowlist and renderer sessions; a primary-instance/deep-link coordinator owns secondary-launch forwarding and target delivery; and a platform adapter owns Windows window creation/focus/active-desktop behavior.

F04 consumes F02's serializable results/reasons and F03's main-process persistence transactions and safe diagnostics. It may record lifecycle session, shutdown intent, and handoff activity through existing F03 repositories, but it does not create a competing state machine or move authoritative state into the renderer. F04 supplies lifecycle hooks and validated request routing to later services; it does not implement tray, notifications, GitHub, AI, Git/worktrees, validation, review bundles, synchronization, publication, or full restart/network recovery.

## Readiness Gates

- F01 `npm run check` passes, including the production Electron smoke artifact, renderer import restrictions, sanitized child environment, and deterministic test harness.
- F02 domain records/reasons and F03 transaction/repository ports are importable from the intended main/shared boundaries without changing their authority semantics.
- The implementation has an explicit list of lifecycle-owned service hooks: start, stop admission, handoff, bounded stop, and status read. Missing downstream services use deterministic fakes in F04 tests.
- The IPC contract has a versioning and schema-validation strategy compatible with the F02 safe serialized result shapes and F03 persistence DTOs.
- A Windows test host can create/use Desktop A, B, and C and can capture process/window identity, active desktop, focus result, renderer readiness, and route-delivery evidence.
- No credential, GitHub token, provider key, prompt, or product-service network access is required for F04 implementation or its default checks.

## Proposed Vertical Slices

1. **Main-process lifecycle coordinator and single-instance ownership**
   - **Blocked by:** F01 shell and F03 persistence health/startup contract; F02 lifecycle-safe result/reason types.
   - **Stories / requirements / acceptance criteria:** US-01-US-03, US-06; FR-01.1-FR-01.6, FR-04.1-FR-04.2, FR-06.1-FR-06.6; NFR-01, NFR-03-NFR-05, NFR-07-NFR-08; INV-01-INV-03, INV-05, INV-09; AC-01-AC-04, AC-09-AC-10.
   - **Visible result:** The production shell has one primary lifecycle owner. It starts main-process service fakes, survives visible-window close, records a safe lifecycle/shutdown session fact, rejects a second owner, and exposes a deterministic startup/shutdown status.
   - **Durable records / external effects:** Uses F03 lifecycle/activity/operation handoff records and a process-instance identity; no GitHub, AI, filesystem worktree, publication, or tray effect. The single-instance lock is an OS/process effect owned by the primary-instance coordinator.
   - **Failure / cancellation / restart:** Persistence initialization failure prevents a misleading ready window. A failed lock or duplicate launch cannot initialize a second product owner. Normal close and renderer crash do not stop service fakes or release holds. Repeated shutdown is idempotent; interruption preserves the handoff record and does not claim external work succeeded.
   - **Exact evidence:** Main-process startup/teardown trace; single-instance race fixture; close-versus-shutdown table; F03 commit-before-teardown probe; renderer-crash fixture; bounded shutdown timeout/failure matrix; safe lifecycle-record scan; production artifact smoke.
   - **Exit criterion:** AC-01-AC-04, AC-09, and AC-10 pass, with one process owner and no implicit shutdown path.

2. **Versioned validated IPC bridge and renderer session lifecycle**
   - **Blocked by:** Slice 1 and F02 serialized result/error contracts.
   - **Stories / requirements / acceptance criteria:** US-04-US-05; FR-03.1-FR-03.7, FR-02.4-FR-02.6; NFR-02-NFR-04, NFR-06-NFR-08; INV-01, INV-02, INV-04, INV-09; AC-01, AC-03, AC-06, AC-07, AC-09, AC-11.
   - **Visible result:** A renderer can perform an allowlisted health/read-model query and receive a typed result; invalid channels/payloads fail safely; a renderer session can subscribe, disconnect, and reconnect without owning main-process work.
   - **Durable records / external effects:** Adds shared IPC schemas, preload bridge, main handlers, renderer-session identity, and bounded activity diagnostics. No renderer database, provider, credential, arbitrary child process, or filesystem capability is exposed.
   - **Failure / cancellation / restart:** Unknown/oversized/secret-shaped messages are rejected before service invocation. Renderer destruction removes subscriptions and drops only undeliverable replies; an already committed main-process operation remains committed. Handler exceptions become safe structured errors. A new window starts a new session and rehydrates from F03/current main state.
   - **Exact evidence:** Static import-boundary report; context-isolation/node-integration inspection; allowlist and schema table; invalid-channel/payload/oversize/secret corpus; response/event schema round trips; request-correlation test; renderer disconnect during long-running fake operation; reconnect/readback test; no-external-effect assertion.
   - **Exit criterion:** AC-01, AC-03, AC-06, AC-07, and AC-11 pass; later features have one validated IPC contract rather than ad hoc renderer calls.

3. **On-demand window manager and platform-neutral focus contract**
   - **Blocked by:** Slices 1-2 and the F01 production artifact.
   - **Stories / requirements / acceptance criteria:** US-01-US-02, US-07; FR-02.1-FR-02.6, FR-05.1-FR-05.6; NFR-01, NFR-03-NFR-08; INV-02, INV-05-INV-07; AC-02, AC-04-AC-05, AC-09, AC-12.
   - **Visible result:** Closing the visible window destroys it; opening creates one fresh window, performs a ready handshake, queries current state, and returns a typed `created`/`focused`/failure result through a platform-neutral adapter.
   - **Durable records / external effects:** Adds window/session lifecycle diagnostics and uses process-owned native window handles only inside the main adapter. No hidden renderer, worktree reveal, notification, or tray behavior is added.
   - **Failure / cancellation / restart:** Concurrent opens coalesce. Window-create/readiness/focus timeout, crash, or denial leaves main work alive and returns an actionable result. Destroyed windows release their listeners/handles; stale renderer callbacks cannot update a new session. Reopen after process restart is based on current persisted state, not the old renderer.
   - **Exact evidence:** Real Electron create/ready/close/recreate smoke; at-most-one-visible-window test; concurrent-open idempotency test; renderer-crash/reload test; fake-adapter outcome matrix; event-listener/handle cleanup test; current-state hydration test; focus failure without process exit.
   - **Exit criterion:** AC-02, AC-04, AC-05, AC-09, and AC-12 pass, and the window manager has no direct callers outside its main-process boundary.

4. **Single-instance forwarding, deep-link parser, and target queue**
   - **Blocked by:** Slices 1-3.
   - **Stories / requirements / acceptance criteria:** US-06-US-07; FR-04.2-FR-04.5, FR-02.3, FR-03.2-FR-03.3; NFR-02-NFR-04, NFR-07-NFR-08; INV-03-INV-05, INV-08; AC-04, AC-06-AC-08, AC-11.
   - **Visible result:** A second launch and supported `prmonitor://` route are normalized by the primary process, queued before renderer readiness, delivered exactly once after readiness, and opened as a view target without directly executing a state-changing action.
   - **Durable records / external effects:** Records bounded route/session diagnostics and uses the OS single-instance forwarding channel. No route causes GitHub, AI, publication, arbitrary shell, or filesystem work.
   - **Failure / cancellation / restart:** Malformed scheme, unsupported target, duplicate/conflicting ID, oversized payload, credential/path injection, and duplicate request are rejected or coalesced deterministically. A route waiting for renderer readiness remains in the main-process queue; if the process exits before delivery, startup recovery reports the abandoned route without silently executing it.
   - **Exact evidence:** Parser truth table for home/PR/bundle/sync targets; second-instance race; command-line/deep-link forwarding fixture; pre-ready queue and exactly-once delivery test; duplicate suppression; malformed/secret/path corpus; state-changing-action separation test; target delivery after renderer recreation.
   - **Exit criterion:** AC-04, AC-06, AC-07, AC-08, and AC-11 pass, with an explicit route contract ready for F19/F20.

5. **Explicit shutdown, service handoff, and lifecycle recovery seam**
   - **Blocked by:** Slices 1-4 and F03 transaction/repository handoff APIs.
   - **Stories / requirements / acceptance criteria:** US-03, US-05; FR-01.3-FR-01.6, FR-02.4-FR-02.5, FR-06.1-FR-06.6; NFR-01, NFR-03-NFR-07; INV-01-INV-03, INV-09; AC-03, AC-09-AC-10, AC-12.
   - **Visible result:** An explicit `Shutdown PRMonitor` request persists intent, stops admission through service hooks, waits within bounded limits, coordinates window/resource teardown, and returns a safe handoff result; F19 owns the user-facing completion and final process exit. Close/crash/focus failure take no shutdown path. An interrupted shutdown leaves a safe handoff record for F28.
   - **Durable records / external effects:** Persists shutdown intent/status and safe lifecycle activity; invokes only injected service stop/handoff ports. It does not publish, cancel arbitrary provider work, delete worktrees, or invent recovery outcomes.
   - **Failure / cancellation / restart:** Stop timeout/failure is recorded as recovery-required while preserving in-flight records. A second shutdown request returns the existing lifecycle outcome. A process kill before or after the lifecycle commit is distinguishable on restart. No renderer command can bypass the explicit shutdown schema.
   - **Exact evidence:** Shutdown phase table; commit-before-stop fault injection; repeated request idempotency; service stop timeout/partial-handoff matrix; close/crash/focus-negative tests; startup handoff readback; no-implicit-shutdown trace; bounded child/handle cleanup.
   - **Exit criterion:** AC-03, AC-09, AC-10, and AC-12 pass, with F19 able to complete the shutdown flow and F28 able to consume incomplete lifecycle handoff without automatic authorization.

6. **Windows Desktop A/B/C spike and downstream handoff**
   - **Blocked by:** Slices 1-5; Windows host with three virtual desktops; real open/deep-link simulation.
   - **Stories / requirements / acceptance criteria:** US-07; FR-05.1-FR-05.7, FR-07.1-FR-07.5; NFR-03-NFR-08; INV-06-INV-07; AC-05, AC-08, AC-12.
   - **Visible result:** A repeatable report demonstrates launch on Desktop A, close, recreate/focus from Desktop B, close, route a review-oriented target from Desktop C, and record the result and fallback. F19 receives a stable adapter/target contract and documented limitation, if any.
   - **Durable records / external effects:** Produces bounded test/evidence artifacts and safe lifecycle activity only. The spike uses the real Windows desktop/window APIs under the adapter; it does not contact product services, modify Git, publish, or require credentials.
   - **Failure / cancellation / restart:** Missing desktops, denied foreground activation, timeout, stale hidden-window reuse, route loss, or focus on the wrong desktop fails the evidence gate unless the documented fallback is demonstrated and user-understandable. A cancelled spike leaves no success marker and can be rerun from a fresh process.
   - **Exact evidence:** Desktop A/B/C matrix with active-desktop identifiers; process/window identity and recreate proof; renderer-ready and route-delivery timestamps; focus/foreground result and fallback; fresh-process repeat; fake-adapter parity tests; Windows artifact smoke; security/output scan; `git diff --check`; F19/F28/F30 handoff note.
   - **Exit criterion:** AC-05, AC-08, and AC-12 pass; APP-AC-20 has real Windows evidence; all F04 handoff contracts are versioned and the checklist item remains unchecked pending implementation approval.

7. **Cross-slice conformance and F04 handoff**
   - **Blocked by:** Slices 1-6.
   - **Stories / requirements / acceptance criteria:** US-01-US-07; all FRs, NFRs, and INVs; APP-AC-17, APP-AC-20, APP-AC-30; AC-01-AC-12.
   - **Visible result:** One clean-checkout report proves persistent main-process lifetime, validated IPC, safe renderer replacement, single-instance/deep-link routing, explicit shutdown, and Windows virtual-desktop behavior while listing all deferred F05+ capabilities.
   - **Durable records / external effects:** Keeps only declared ignored build/test/evidence outputs and F03-owned lifecycle facts. It does not change the checklist, publish specs, contact external services, or alter a developer repository.
   - **Failure / cancellation / restart:** Any missing lifecycle record, duplicate process/window, unsafe boundary, implicit shutdown, dropped target, leaked listener, lost operation, or unresolved desktop behavior blocks the gate. A cancelled test run leaves no success marker; rerun starts with fresh process/window instances. F04 never silently broadens IPC or authorizes AI/publication work.
   - **Exact evidence:** `npm run build`, `npm test`, `npm run check`; IPC contract and forbidden-import reports; renderer close/recreate/operation-lifetime report; single-instance/deep-link report; shutdown fault report; Windows A/B/C report; secret/raw-SDK/path scan; F03 restart handoff report; `git diff --check`; both required specification-linter commands against the final PRD/PLAN; application-coverage report showing APP-AC-04/17/20/30/31 with explicit shared/primary ownership and no definite missing/invalid mappings.
   - **Exit criterion:** All F04 requirements have direct evidence, APP-AC-17/20/30 ownership boundaries are explicit, no definite linter missing/invalid result remains, unresolved spike/product choices are recorded for approval, and the checklist item remains unchecked until implementation is approved and complete.

## Cross-Slice Verification and Handoff

- The exact owning PRD is `Specs/persistent_electron_shell_ipc_boundary_and_windows_virtual_desktop_spike_PRD.md`; this PLAN does not add tray, notification, GitHub, AI, Git/worktree, validation, publication, or full recovery requirements.
- F01's preload placeholder becomes F04's validated, versioned bridge. `nodeIntegration` remains disabled and `contextIsolation` remains enabled; renderer code never imports Node/Electron or receives a generic privileged call surface.
- F02 remains the authority for state transitions, review holds, safe reason data, and the rule that renderer commands are requests. F04 must not release a hold, reset a budget, or make a renderer projection authoritative.
- F03 remains the authority for durable application state and transaction outcomes. Lifecycle intent and handoff facts are persisted before teardown effects; cancellation after commit is reported as committed/recoverable, not compensated by deleting state.
- F04's window manager exposes platform-neutral results and is the only main-process owner of `BrowserWindow` lifecycle. F19 must use its open-target/focus/shutdown ports rather than calling Electron window objects from tray/notification code.
- F04's deep-link router accepts only normalized view targets and queues them in main. F19/F20 supply the product-specific destination/read-model handling; route delivery never directly executes publication, AI, GitHub, or filesystem actions.
- F04's Windows adapter owns active-desktop/focus behavior. The A/B/C spike is a hard handoff gate for F19 and F30; any limitation requires a recorded fallback and must not be hidden by retaining an old invisible renderer.
- F28 owns complete restart/sleep/network/orphan recovery. F04 only records lifecycle handoff and exposes incomplete-operation status; startup must not auto-authorize a stopped AI segment or publication.
- The F04 application-coverage table maps APP-AC-04, APP-AC-17, APP-AC-20, APP-AC-30, and APP-AC-31 because the detailed lifecycle scope is a shared prerequisite for UI-independent work and shutdown. F10 owns the actual polling behavior; F19 owns the complete tray/notification/shutdown workflows. APP-AC-15, APP-AC-18, and APP-AC-19 remain F19-owned even though F19 consumes F04 contracts.
- The checklist item remains unchecked. This specification phase produces no application code, does not change `checklist.md`, and does not claim that a shell spike or contract-only implementation closes the feature.


## Issue 1 supplement: Startup landing and recovery

Approved scope: [resumable setup on startup](https://github.com/bryant-collab/PRMonitor/issues/1). Default HOME/launch/window recreation reads the bounded main-owned five-check setup projection before choosing setup or inbox. Explicit saved-work targets remain view requests and take precedence with a setup-attention banner. Database or local-root bootstrap failure opens a recovery-only setup shell that preserves original data and admits no domain services. Ordinary setup reads never relaunch; explicit Retry coalesces a restart attempt of the same authoritative configuration and carries the latest validated view target. No setup screen pauses or cancels work.

Evidence: the setup readiness/local/provider/IPC/renderer/recovery tests, repository `npm run check`, and six-process production Electron `npm run test:setup`. See `docs/evidence/setup-readiness/README.md` for scenario mapping, retained screenshots, and exact residual manual coverage. Existing F03/F05/F13/F19/F29 owners keep their persistence, credential, filesystem, lifecycle and security rules.
