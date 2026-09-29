# F30 - Windows Packaging, End-to-End Acceptance, and Release Readiness - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F01 - Application workspace and engineering foundation | Provides the pinned Node/npm runtime, Electron artifact, smoke harness, CI checks, and packaging conventions that F30 turns into a distributable Windows release. |
| 2 | F04 - Persistent Electron shell, IPC boundary, and Windows virtual-desktop spike | Provides the packaged main-process lifetime, renderer replacement, single-instance routing, deep links, and tested current-desktop behavior. |
| 3 | F05-F12 - GitHub setup, managed PRs, polling, eligibility, and scheduling | Provide the live monitoring path that F30 must exercise on GitHub.com and supported GHES configurations. |
| 4 | F13-F17 - Worktrees, validation, provider boundary, task profiles, and bounded AI work | Provide the deterministic local execution and AI contracts that the release workflow must verify without weakening their boundaries. |
| 5 | F18-F23 - Review preparation, workspace, revisions, stale handling, and publication | Provide the Review Bundle workflow and human-approved publication path that F30 must complete end to end. |
| 6 | F24-F27 - Synchronization selection, merge/conflict resolution, review, and publication | Provide the branch synchronization workflow and per-result publication path that F30 must complete end to end. |
| 7 | F28 - Restart, sleep, network-loss, and uncertain-outcome recovery | Provides the lifecycle fault-injection contracts and recovery evidence required for packaged restart, sleep, offline, and uncertain-effect acceptance. |
| 8 | F29 - Security and trust-boundary hardening | Provides the threat model, dependency/runtime identity, secret/effect scans, security gate, residual-risk record, and release handoff. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | External MVP users and support workflow | Consume the installable Windows artifact, clean-machine instructions, upgrade behavior, and sanitized support diagnostics. |
| 2 | Future signed distribution and update channel | May replace the MVP's documented unsigned/manual-update decision without changing application data ownership or workflow contracts. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-01, APP-AC-02, APP-AC-03, APP-AC-04, APP-AC-05, APP-AC-06, APP-AC-07, APP-AC-08, APP-AC-09, APP-AC-10 | FR-04.1-FR-04.5, FR-05.1-FR-05.4, FR-07.1-FR-07.4 | AC-07-AC-09, AC-22 | Shared final verification: F30 exercises the installed workflow; F05-F19 and F13 remain the behavioral owners. |
| APP-AC-11, APP-AC-12, APP-AC-13, APP-AC-14, APP-AC-15, APP-AC-16, APP-AC-17, APP-AC-18, APP-AC-19, APP-AC-20 | FR-04.2-FR-04.5, FR-06.1-FR-06.5, FR-07.1-FR-07.4 | AC-08-AC-18, AC-22 | Shared final verification: F30 proves provider, notification, renderer, tray, and Windows-desktop behavior in the packaged product; F04/F15/F18/F19 remain owners. |
| APP-AC-21, APP-AC-22, APP-AC-23, APP-AC-24, APP-AC-25, APP-AC-26, APP-AC-27, APP-AC-28, APP-AC-29, APP-AC-30 | FR-04.3-FR-04.5, FR-06.1-FR-06.5, FR-07.3-FR-07.4 | AC-08-AC-10, AC-14-AC-18, AC-22 | Shared final verification: F30 completes the installed review/publication journey; F20-F23 and F28 remain authoritative for state and effects. |
| APP-AC-31, APP-AC-32, APP-AC-33, APP-AC-34, APP-AC-35, APP-AC-36, APP-AC-37, APP-AC-38, APP-AC-39, APP-AC-40 | FR-04.1-FR-04.5, FR-06.1-FR-06.5, FR-07.1-FR-07.4 | AC-07-AC-10, AC-16-AC-18, AC-22 | Shared final verification: F30 confirms settings, tray, worktree, context, and review behavior after installation; F08/F16/F19-F22 remain owners. |
| APP-AC-41, APP-AC-42, APP-AC-43, APP-AC-44, APP-AC-45, APP-AC-46, APP-AC-47, APP-AC-48, APP-AC-49, APP-AC-50 | FR-05.1-FR-05.4, FR-06.1-FR-06.5, FR-07.1-FR-07.4 | AC-11-AC-14, AC-22 | Shared final verification: F30 runs the installed synchronization workflow; F18/F24-F27 remain owners of review and merge semantics. |
| APP-AC-51, APP-AC-52, APP-AC-53, APP-AC-54, APP-AC-55, APP-AC-56, APP-AC-57, APP-AC-58, APP-AC-59, APP-AC-60 | FR-04.3-FR-04.5, FR-05.1-FR-05.4, FR-06.1-FR-06.5 | AC-09, AC-13-AC-15, AC-22 | Shared final verification: F30 fault-injects retries, stale results, and bounded AI work in the packaged app; F17/F23/F27/F28 remain authoritative. |
| APP-AC-61, APP-AC-62, APP-AC-63, APP-AC-64, APP-AC-65, APP-AC-66, APP-AC-67, APP-AC-68, APP-AC-69, APP-AC-70 | FR-04.1-FR-04.5, FR-05.1-FR-05.4, FR-06.1-FR-06.5, FR-08.1-FR-08.4 | AC-08-AC-15, AC-21-AC-23 | Shared final verification: F30 verifies the packaged evidence and security boundary; F10/F13/F15-F17/F23/F28-F29 retain ownership of the underlying contracts. |
| APP-AC-65 | FR-04.2, FR-09.1-FR-09.3 | AC-07, AC-22-AC-23 | Shared final verification: F30 explicitly verifies the 10-minute default, independent conditional-request/pagination checkpoints, and 304 isolation in the installed polling path; F10 remains the behavioral owner. |
| APP-AC-71, APP-AC-72, APP-AC-73, APP-AC-74, APP-AC-75, APP-AC-76, APP-AC-77 | FR-04.2-FR-04.5, FR-05.1-FR-05.4, FR-06.1-FR-06.5, FR-07.1-FR-07.4, FR-08.1-FR-08.4 | AC-08-AC-18, AC-21-AC-23 | Shared final verification: F30 proves the staged review, validation, conflict, ambiguity, accessibility, and security outcomes in the release candidate; F14/F18/F20/F26/F27/F29 remain authoritative. |

F30 is the final acceptance owner for the MVP release decision, not a
replacement for the feature owners named above. A criterion passes only when
the installed product demonstrates the existing owner contract and the exact
evidence is retained in the release record.

## Executive Summary

The repository already has a production-like Electron artifact, deterministic
feature contracts, and a broad automated test suite, but an unpacked artifact
and green unit tests are not yet an installable Windows MVP. A developer needs
to install PRMonitor on a clean machine, reopen it from the tray, keep it alive
while the window is closed, configure GitHub, monitor multiple PRs, review and
publish approved Review Bundles, synchronize branches, and recover safely from
restart, sleep, network loss, and uncertain outcomes.

F30 creates the final release candidate and the evidence gate around that
experience. It adds an x64 per-user Windows installer, stable application
identity and icons, upgrade-safe data paths, and an explicit unsigned/manual-update policy,
clean-machine instructions, packaged end-to-end acceptance, accessibility and
focus review, bounded performance checks, and sanitized support diagnostics.
It separates credential-free automated conformance from operator-controlled
GitHub.com/GHES acceptance, and it blocks the release when any of the 77
application criteria lacks passing evidence or when a security, packaging,
recovery, accessibility, or publication boundary is uncertain.

## User Stories

### Install and preserve the local application

- **US-01:** **GIVEN** a supported clean Windows machine, **WHEN** the developer runs the release installer, **THEN** PRMonitor installs with the expected identity, icon, shortcuts, and per-user application-data location and can launch without a developer checkout.
  - **Acceptance Criteria:** AC-01-AC-04.
- **US-02:** **GIVEN** an earlier MVP installation contains settings, credentials references, managed PRs, worktrees, and history, **WHEN** the developer installs a newer version or uninstalls the program, **THEN** the application data and externally published history are preserved according to the documented policy.
  - **Acceptance Criteria:** AC-03-AC-05, AC-24-AC-25.

### Operate from the packaged desktop application

- **US-03:** **GIVEN** the packaged application is watching PRs, **WHEN** the developer closes the visible window or switches Windows virtual desktops, **THEN** the tray worker, holds, scheduled work, notifications, and recovery state remain available and the next window opens on the current desktop.
  - **Acceptance Criteria:** AC-06-AC-08, AC-16.
- **US-04:** **GIVEN** the developer explicitly chooses **Shutdown PRMonitor**, **WHEN** shutdown completes, **THEN** background services stop through their existing bounded handoffs, the tray icon is removed, durable state is retained, and the process exits; normal window close never does this.
  - **Acceptance Criteria:** AC-06, AC-15-AC-16.

### Prove the complete Review Bundle journey

- **US-05:** **GIVEN** a test PR receives review feedback, **WHEN** the packaged app polls, prepares a Review Bundle, and notifies the developer, **THEN** the developer can inspect the proposal, accept or override every item, answer questions, review the implemented diff and validation, revise or discard it, and explicitly publish the approved result.
  - **Acceptance Criteria:** AC-07-AC-10, AC-17, AC-22.
- **US-06:** **GIVEN** publication or response posting is interrupted or a remote SHA changes, **WHEN** the developer reopens the packaged app, **THEN** the app shows the preserved evidence and blocks or reconciles the effect without duplicate commits, pushes, or responses.
  - **Acceptance Criteria:** AC-09-AC-10, AC-14-AC-15, AC-22.

### Prove the complete synchronization journey

- **US-07:** **GIVEN** multiple managed PRs are selected, **WHEN** the developer starts synchronization, **THEN** the packaged app shows exact source/destination identities and SHAs, processes each PR independently, presents clean/no-op/conflict outcomes, and permits publication only after per-result approval.
  - **Acceptance Criteria:** AC-11-AC-14, AC-22.
- **US-08:** **GIVEN** a synchronization result is stale, ambiguous, dirty, or interrupted, **WHEN** the developer reopens it, **THEN** the worktree and prior evidence remain available, the unsafe action is blocked, and only the owning recovery/re-evaluation choices are offered.
  - **Acceptance Criteria:** AC-13-AC-15, AC-17-AC-18, AC-22.

### Make the release usable and supportable

- **US-09:** **GIVEN** the developer uses keyboard navigation, a screen reader, forced colors, zoom, or a narrow window, **WHEN** a ready, attention, stale, validation, or security state is shown, **THEN** the meaning, focus order, error explanation, evidence, and next action remain understandable without relying on color or a mouse.
  - **Acceptance Criteria:** AC-17-AC-19.
- **US-10:** **GIVEN** the developer requests support, **WHEN** they export diagnostics, **THEN** PRMonitor produces a bounded, redacted report with enough runtime, migration, lifecycle, and feature-state information to triage the issue without exporting credentials, raw prompts, source, full diffs, or uncontrolled environment data.
  - **Acceptance Criteria:** AC-20-AC-23.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** a clean supported Windows 11 x64 machine with the documented Git prerequisite and no repository checkout, **WHEN** the developer runs the F30 installer, **THEN** installation completes without developer-only paths or source assets, creates the expected per-user program/data boundaries, and launches the packaged application successfully.
- **AC-02:** **GIVEN** the installed application is inspected in Windows, **WHEN** the developer views Start-menu/shortcut, executable, installer, taskbar, and tray surfaces, **THEN** they use the PRMonitor product name, stable application ID, supplied application/tray icons, and no foundation/test identity; packaged payload scans find no credentials, local checkout paths, `.env` files, or release secrets.
- **AC-03:** **GIVEN** the application has settings, secure-store references, managed PRs, activity, worktrees, Review Bundles, synchronization results, migrations, and published-history references, **WHEN** the developer upgrades over the existing installation, **THEN** the new version reopens the same data, applies compatible migrations once, preserves secure-store references and operation-owned worktree paths, and records the exact app/schema versions used.
- **AC-04:** **GIVEN** the developer cancels installation or the installer encounters a failure, **WHEN** the operation ends, **THEN** it leaves no misleading installed-ready state, does not delete an existing compatible data directory, reports a bounded remediation, and can be retried safely.
- **AC-05:** **GIVEN** the developer uninstalls the MVP, **WHEN** the uninstaller completes, **THEN** program files, shortcuts, and registered application resources are removed while application data and externally published history remain recoverable under the documented default; any local-data removal is a separate, explicit, clearly named action and is not performed by ordinary uninstall.
- **AC-06:** **GIVEN** the packaged app is launched, closed to the tray, reopened, and explicitly shut down, **WHEN** each lifecycle action occurs, **THEN** the visible window is recreated without cancelling main-process work, the tray state is correct, **Shutdown PRMonitor** is the only normal exit command, and repeated open/shutdown requests are idempotent.
- **AC-07:** **GIVEN** a controlled test repository and PR exist on GitHub.com and on every supported GHES configuration, **WHEN** the release operator configures each server through the packaged UI, **THEN** authentication, add/edit PR, multiple-PR polling, the 10-minute default interval, independent ETag/Last-Modified and pagination checkpoints for PR metadata/reviews/review comments/issue comments, `304` isolation, immutable feedback detection, batching, pause, and notifications work with credentials supplied only through the approved secure-store path and no credential enters release evidence.
- **AC-08:** **GIVEN** a test PR has new review feedback, **WHEN** the packaged app performs automatic review, **THEN** a proposal Review Bundle is persisted and opened from the notification/tray, the proposal is read-only before item decisions, every recommendation can be accepted or overridden, every question requires an answer, and baseline evidence is visibly distinct from post-change evidence.
- **AC-09:** **GIVEN** accepted decisions exist, **WHEN** the developer allows implementation, revises the result, discards it, or approves publication, **THEN** only the existing deterministic owner workflows can mutate the operation worktree or publish, the complete proposed diff and real validation are shown, manual edits are preserved, stale work is blocked, and no commit/push/response occurs without the required explicit approval.
- **AC-10:** **GIVEN** a Review Bundle publication is retried after restart, renderer closure, network loss, or an uncertain acknowledgement, **WHEN** the packaged app reconciles it, **THEN** it adopts or retries only the exact persisted effect, never force-pushes or blind-reposts, does not republish code for response-only failure, and shows `PUBLISHED_WITH_ERRORS` when that is the truthful result.
- **AC-11:** **GIVEN** several managed PRs are selected for synchronization, **WHEN** the developer opens the preparation confirmation, **THEN** the packaged UI shows selected and skipped counts, source provenance, base/head repositories and branches, `syncSourceSha`, `prHeadSha`, and actionable ineligibility reasons before any preparation effect begins.
- **AC-12:** **GIVEN** synchronization includes a clean merge, a no-op, a semantic conflict, and an independent failure, **WHEN** the packaged app processes the batch, **THEN** each PR has its own worktree/result, clean and no-op paths consume zero AI tokens, conflict resolution is bounded and worktree-local, real validation is recorded, and one result cannot prevent unrelated results from reaching their own review state.
- **AC-13:** **GIVEN** a synchronization result is ready, stale, ambiguous, dirty, or failed, **WHEN** the developer reviews it, **THEN** exact diff, worktree, validation, AI evidence, competing-intent/user-question data, reason, and next action are visible; publish is per-result, requires explicit approval, revalidates both SHAs and non-force feasibility, and preserves older history while marking affected Review Bundles stale after a successful head update.
- **AC-14:** **GIVEN** the packaged app is terminated at each durable phase of polling, batching, worktree preparation, validation, AI work, review decisions, response publication, synchronization, and merge publication, **WHEN** it restarts, **THEN** recovery preserves feedback, holds, budgets, worktrees, manual edits, evidence, and effect identities; it does not create duplicate external effects or auto-authorize a stopped AI segment.
- **AC-15:** **GIVEN** Windows sleeps, wakes, loses network access, regains access, or experiences a wall-clock jump while work is pending, **WHEN** the packaged app reconciles, **THEN** it performs one bounded recovery pass, uses capped backoff, preserves paused/held work, revalidates exact identities, and exposes offline/stale/unknown attention states rather than false success or a catch-up storm.
- **AC-16:** **GIVEN** the app is closed on Windows virtual Desktop A and opened from the tray or a notification on Desktops B and C, **WHEN** the window is recreated, **THEN** the deep link is delivered exactly once, the window targets the active desktop with the tested focus behavior or reports a bounded platform limitation, and no second process or stale hidden window is used.
- **AC-17:** **GIVEN** the packaged UI is exercised with keyboard-only navigation, a screen reader, forced colors/high contrast, reduced motion, 200% zoom, and a narrow supported window, **WHEN** the developer traverses inbox, preferences, Review Bundle, synchronization, recovery, error, and publication surfaces, **THEN** all actions have accessible names and focus, state meaning is not color-only, focus is restored after navigation/actions, and no critical content is lost to horizontal overflow.
- **AC-18:** **GIVEN** a user-facing operation fails, is cancelled, is offline, is stale, is interrupted, is blocked by security, or needs attention, **WHEN** the developer opens the result, **THEN** the UI identifies what happened, why it matters, preserved evidence, and the permitted next action without exposing raw exceptions, commands, secrets, provider SDK objects, or arbitrary paths.
- **AC-19:** **GIVEN** a reference Windows 11 x64 machine runs the packaged application with the release test data set, **WHEN** cold start, window recreation, tray/notification deep-link, idle monitoring, and controlled shutdown are measured, **THEN** P95 cold start-to-interactive is at most 5 seconds, P95 tray/notification open-to-interactive is at most 2 seconds after the process is running, idle memory is at most 400 MiB RSS, and idle CPU averages at most 2% over a 5-minute observation excluding the scheduled request itself; any exception is recorded with hardware, OS, dataset, and reason.
- **AC-20:** **GIVEN** the developer chooses **Export Support Diagnostics**, **WHEN** the export completes, **THEN** it contains the app/build/runtime/schema/migration identity, sanitized lifecycle/recovery state, bounded recent safe activity, feature health, and a support correlation ID, while excluding credentials, secure-store values, raw prompts, full source/diff content, uncontrolled environment values, arbitrary commands, and unredacted local paths.
- **AC-21:** **GIVEN** the F29 security handoff is available, **WHEN** the F30 release gate runs, **THEN** the supported runtime/lockfile identity, production dependency inventory, configured vulnerability threshold, provider import boundary, dynamic-load scan, packaged payload scan, secret/effect scans, and residual-risk record are present; a definite release-blocking security finding fails the gate.
- **AC-22:** **GIVEN** the release candidate is evaluated, **WHEN** the requirements trace is assembled, **THEN** APP-AC-01 through APP-AC-77 each have a passing automated test, controlled manual evidence, or an explicitly approved not-applicable decision with owner, environment, build identity, timestamp, and evidence location; any missing or contradictory evidence fails the release.
- **AC-23:** **GIVEN** a release gate is run from a clean checkout, **WHEN** `npm ci`, `npm run check`, the F29 security gate, both F30 specification linters, packaging, artifact scan, and the credential-free conformance suite complete, **THEN** the result is reproducible from the committed lockfile and source revision, reports are bounded and secret-free, and a cancelled/failed run creates no success marker.
- **AC-24:** **GIVEN** a previous release has a compatible database and application-data directory, **WHEN** the new installer is installed over it and the application is started, **THEN** settings, secure credential references, managed PRs, worktree records, review/synchronization history, and migration evidence remain available; an incompatible schema or missing prerequisite produces an actionable preflight failure rather than data loss.
- **AC-25:** **GIVEN** the release operator follows the clean-machine install, upgrade, support, and uninstall instructions, **WHEN** the full release checklist is completed, **THEN** the operator can reproduce installation and recovery, can find the exact artifact hashes and evidence bundle, and can uninstall without losing externally published history; the release record identifies the candidate as an unsigned internal preview with manual updates and does not label it a generally supported or trusted public release.

## Functional Requirements

### FR-01: Installable Windows release artifact

- FR-01.1: The release process SHALL produce an installable Windows 11 x64 artifact for the supported MVP Windows 11 build, in addition to the unpacked artifact used by automated smoke tests.
- FR-01.2: The installer SHALL use a stable product name, application ID, version, executable name, Start-menu/shortcut metadata, application icon, and tray icon, and SHALL not ship developer checkout paths, test identities, source maps containing local paths, credentials, or secret-shaped release data.
- FR-01.3: The release manifest SHALL record artifact names, SHA-256 hashes, application version, source revision, runtime/tool versions, target OS/architecture, packaging configuration revision, and evidence bundle identity.
- FR-01.4: The release process SHALL fail closed when packaging, artifact scan, hash generation, installer metadata, or application identity verification fails; it SHALL not label an unpacked developer artifact as an installable release.
- FR-01.5: The MVP SHALL be explicitly unsigned: it SHALL not include an Authenticode signature or require certificate inputs, and the release record SHALL document SmartScreen/trust implications and label the candidate as an internal preview rather than a generally supported public release.
- FR-01.6: The MVP SHALL document its update channel decision; absent an approved updater, installation of a newer version SHALL be a manual, versioned installer flow and SHALL not imply automatic update support.

### FR-02: Application-data, upgrade, and uninstall lifecycle

- FR-02.1: The installed program location SHALL be separate from the per-user authoritative application-data location used for SQLite, safe settings, migration state, and opaque credential references.
- FR-02.2: An upgrade SHALL preserve compatible application data, secure-store references, managed PRs, operation-owned worktree records, activity/history, and publication/recovery evidence, and SHALL apply each compatible migration at most once.
- FR-02.3: A cancelled, failed, or interrupted install/upgrade SHALL preserve an existing compatible installation and data directory, or report a bounded recovery path without claiming success.
- FR-02.4: Ordinary uninstall SHALL remove program files and registration/shortcuts but SHALL preserve application data and externally published-history references by default; any local-data purge SHALL require a separate explicit user action and confirmation.
- FR-02.5: The release documentation SHALL state supported install scope, prerequisite versions, data locations, migration behavior, uninstall behavior, backup/recovery expectations, and the absence or presence of automatic updates.

### FR-03: Packaged lifecycle, startup, and shutdown

- FR-03.1: The packaged app SHALL start the main-process lifecycle owner and durable persistence before presenting an interactive renderer, and startup failure SHALL be visible as an actionable bounded error.
- FR-03.2: The packaged app SHALL preserve the F04/F19 distinction between normal window close, tray operation, notification/deep-link open, renderer replacement, and explicit **Shutdown PRMonitor**.
- FR-03.3: The release candidate SHALL prove that the tray remains available when the window is closed, notifications/deep links recreate and focus the intended target, and shutdown removes process-owned surfaces without discarding durable state.
- FR-03.4: Startup, window recreation, shutdown, migration, and installer failures SHALL expose the owning reason, evidence, and permitted next action through the existing accessible UI/read-model contracts.

### FR-04: Controlled GitHub and Review Bundle acceptance

- FR-04.1: F30 SHALL provide a repeatable controlled acceptance procedure for GitHub.com and every supported GHES configuration using dedicated test servers/repositories/PRs and credentials supplied only through approved secure runtime mechanisms.
- FR-04.2: The procedure SHALL exercise add/edit PR, multiple-PR watching, the 10-minute default polling interval, independent conditional-request and pagination checkpoints for every feedback resource, the rule that a PR-metadata `304` cannot suppress changed feedback checks, deterministic polling and batching, pause, notification/deep-link, proposal-before-mutation, per-item accept/override/question decisions, implementation, validation, revisions, discard, stale detection, and publication.
- FR-04.3: The procedure SHALL verify that the installed product consumes the F18-F23 read models and action gates rather than inferring success from UI labels, activity text, provider prose, or local renderer state.
- FR-04.4: Controlled acceptance SHALL capture evidence of the exact remote identities, result states, validation statuses, approval points, publication effects, and post-publication hold/feedback behavior without retaining credentials or unrestricted source payloads.
- FR-04.5: A live acceptance failure SHALL identify the environment/build/operation, preserve the failed evidence, and block the release decision until corrected or explicitly approved as outside the supported matrix.

### FR-05: Controlled synchronization acceptance

- FR-05.1: F30 SHALL provide a repeatable controlled procedure for selected multi-PR synchronization covering source override/base-branch resolution, fork identity, eligible/ineligible confirmation, independent worktrees, clean merge, no-op, conflict, ambiguity, validation, stale detection, discard/re-evaluation, and per-result publication.
- FR-05.2: The procedure SHALL verify zero AI usage on deterministic clean/no-op paths, bounded task-profile/policy snapshots when AI is required, exact source/head/merge-base evidence, no force push, and one result's failure isolation from siblings.
- FR-05.3: The procedure SHALL verify that a successful synchronization publishes only after explicit per-result approval and that older Review Bundles become stale without losing history or worktrees.
- FR-05.4: Synchronization acceptance SHALL use dedicated test branches/repositories and shall reconcile or clean every externally created test effect according to the documented test-environment procedure.

### FR-06: Recovery, fault injection, and uncertain outcomes

- FR-06.1: F30 SHALL run the F28 recovery matrix against the packaged application for renderer closure, orderly shutdown, abrupt termination, startup, sleep/wake, offline/online transitions, wall-clock jumps, missing worktree, interrupted validation, uncertain AI turn, uncertain commit/push, uncertain response, and uncertain synchronization publication.
- FR-06.2: The matrix SHALL verify preservation of immutable feedback, holds, budgets, snapshots, worktrees, manual edits, validation evidence, effect identities, and per-PR isolation, and SHALL verify no duplicate commit, push, response, merge, AI turn, or hold release.
- FR-06.3: The matrix SHALL verify that deterministic recovery may adopt only exact proven outcomes, while stopped/uncertain AI work and ambiguous local/remote effects remain explicitly reviewable and require the owning human action.
- FR-06.4: Sleep/network testing SHALL use bounded backoff and one reconciliation pass per affected scope and SHALL record the OS/build/network/lifecycle trigger and the observed recovery classification.
- FR-06.5: A fault-injection run SHALL be reproducible without live credentials or external publication through fake adapters and temporary repositories, while the final controlled acceptance SHALL include the packaged binary and documented test environment.

### FR-07: Accessibility, focus, error states, and Windows behavior

- FR-07.1: The release candidate SHALL pass keyboard-only, screen-reader, forced-colors/high-contrast, reduced-motion, 200% zoom, narrow-window, and visible-focus review across inbox, settings, Review Bundle, synchronization, recovery, publication, and error surfaces.
- FR-07.2: Ready, attention, stale, offline, interrupted, security-blocked, validation-failed, and published-with-errors states SHALL have distinct accessible labels and what/why/evidence/next-action content without color-only meaning.
- FR-07.3: Tray, notification, deep-link, window recreation, destructive confirmation, and delegated worktree actions SHALL return focus predictably or report a bounded focus limitation without losing the target.
- FR-07.4: The Windows A/B/C virtual-desktop scenario SHALL be rerun against the installed release candidate, with process/window identity, active desktop, target-delivery, focus, and fallback evidence retained.

### FR-08: Performance and support diagnostics

- FR-08.1: F30 SHALL measure cold start, renderer recreation, tray/notification open, idle CPU/memory, controlled shutdown, and representative multi-PR read-model loading on a named reference Windows 11 x64 machine and dataset.
- FR-08.2: The release SHALL enforce the performance budgets in AC-19 or record a named, time-bounded exception with measured result, cause, owner, and follow-up; an unmeasured claim SHALL not pass.
- FR-08.3: The application SHALL provide an explicit support-diagnostics export that is bounded, redacted, correlated, and safe to share, containing runtime/build/schema/migration identity, sanitized lifecycle/recovery state, feature health, and safe recent activity.
- FR-08.4: Support diagnostics SHALL exclude credentials, secure-store values, raw prompts, complete source/diffs, uncontrolled environment values, arbitrary commands, provider SDK objects, and unredacted local paths; redaction uncertainty SHALL fail the export.

### FR-09: Release gate, traceability, and handoff

- FR-09.1: F30 SHALL maintain a requirements trace for APP-AC-01 through APP-AC-77 that identifies the owning feature, F30 evidence type, environment/build identity, timestamp, and evidence location.
- FR-09.2: F30 SHALL distinguish credential-free automated conformance, controlled GitHub/GHES acceptance, manual accessibility/focus review, and release-operator attestations; one evidence type SHALL not be silently substituted for another.
- FR-09.3: The release gate SHALL run the supported clean-checkout commands, packaging, artifact scans, F29 security gate, F30 conformance tests, specification linters, and `git diff --check` from the documented environment.
- FR-09.4: A release SHALL be blocked by any definite test failure, missing/contradictory APP-AC evidence, security gate failure, unsupported runtime, data-loss upgrade result, accessibility blocker, performance-budget failure without approval, duplicate external effect, secret leak, or a release record that does not identify the selected unsigned internal-preview/manual-update tier.
- FR-09.5: A completed release record SHALL include the release manifest, checksums, support instructions, clean-machine instructions, evidence index, residual risks, approved exceptions, and the final release decision; it SHALL never include a credential or real secret.

## Non-Functional Requirements

- **NFR-01: Reproducibility** - A release candidate SHALL be reproducible from the committed lockfile, source revision, pinned runtime/tool versions, and recorded packaging configuration.
- **NFR-02: Reliability** - Installation, upgrade, startup, shutdown, migration, renderer replacement, recovery, and support export SHALL fail closed and remain retryable without silent data loss or false success.
- **NFR-03: Security and privacy** - Release artifacts, installer logs, automated evidence, controlled acceptance records, and support diagnostics SHALL contain no credentials, raw authorization data, raw prompts, provider SDK objects, uncontrolled environment values, or unredacted secrets.
- **NFR-04: Performance** - The release candidate SHALL meet the measurable startup, reopen, CPU, memory, and representative read-model budgets defined in AC-19 on the named reference environment, or carry an approved time-bounded exception.
- **NFR-05: Accessibility** - All release-blocking workflows SHALL be usable with keyboard navigation, visible focus, screen readers, forced colors/high contrast, reduced motion, zoom, and narrow windows, with semantic state and error text independent of color.
- **NFR-06: Deterministic evidence** - Every automated result SHALL identify the build, environment, fixture/test identity, input revision, outcome, and bounded evidence digest; manual results SHALL identify the operator, date, environment, and attestation scope.
- **NFR-07: External-effect safety** - Controlled live acceptance SHALL use dedicated test resources and explicit human approvals; cleanup or retention of test effects SHALL be documented, and no release test SHALL authorize force push, blind repost, or autonomous publication.
- **NFR-08: Supportability** - A support recipient SHALL be able to identify the installed version, runtime, schema/migration state, lifecycle/recovery status, feature health, and relevant safe activity from the exported diagnostics without access to the developer's source tree.

## Invariants

- **INV-01:** An installable release is identified by an exact source revision, package version, runtime/tool identity, target architecture, artifact hash, and evidence bundle; a mutable folder or local checkout is never a release identity.
- **INV-02:** Program files and per-user application data are separate; packaging, upgrade, and ordinary uninstall never silently delete or replace the authoritative database, secure-store references, operation-owned worktrees, or historical publication evidence.
- **INV-03:** The packaged application preserves the main-process authority, renderer replaceability, per-PR holds, explicit publication approval, no-force rules, and deterministic/AI boundary contracts established by F02-F29.
- **INV-04:** Automated release tests use credential-free fixtures or approved runtime secret injection; real credentials, tokens, authorization headers, raw prompts, and secure-store values never enter committed source, logs, reports, artifacts, or support exports.
- **INV-05:** Controlled GitHub/GHES acceptance uses dedicated test identities and resources and never treats a test result as permission to modify a developer's real repository or worktree.
- **INV-06:** Recovery and retry evidence is authoritative only through the owning durable service contracts; a renderer label, notification, activity event, provider claim, or installer exit message cannot prove a workflow or external effect.
- **INV-07:** A missing, stale, ambiguous, inaccessible, or unredactable release condition is a blocking or explicitly reviewable result; it never becomes a green release decision by omission.
- **INV-08:** The MVP has no implicit auto-update, boot auto-start, or data purge side effect; any future updater or signed distribution tier must preserve the data and authority boundaries documented here.
- **INV-09:** The 77-criterion trace is complete and one-to-one at the criterion level; a grouped report must still identify each individual APP-AC ID and evidence outcome.
- **INV-10:** F30 verifies and packages existing feature ownership but does not create a parallel workflow state machine, credential store, GitHub client, validation truth source, AI authority, recovery coordinator, or publication service.

## Out of Scope

- Implementing new review, synchronization, validation, AI, GitHub, persistence, recovery, or security behavior already owned by F00-F29.
- Supporting macOS or Linux installers, ARM Windows, portable ZIP distribution, Microsoft Store distribution, or OS boot auto-start in the MVP release gate.
- An automatic update service, background update downloader, delta updater, or update server. The MVP uses the documented manual installer flow.
- Authenticode signing or claiming a generally supported/trusted public release in the MVP; the selected MVP tier is an unsigned internal preview with manual updates.
- Migrating or repairing arbitrary incompatible databases, recovering from a deleted application-data directory, or automatically deleting orphaned worktrees.
- Testing against a developer's real GitHub repositories, real pull requests, real branch changes, or real credentials.
- Proving an absolute OS, anti-malware, network, or provider-process sandbox guarantee beyond F29's documented defense-in-depth boundary.
- Replacing feature-owner contract tests with a release smoke test or treating manual visual review as proof of deterministic state correctness.

## Product Decisions

- **PD-01: Release-certified target is Windows 11 x64 on the documented supported Windows 11 build** - The release record names the exact Windows 11 build tested; other Windows versions/builds are unsupported unless added to that matrix with new evidence.
- **PD-02: Use a per-user x64 NSIS installer for the MVP** - It is installable without requiring machine-wide application-data permissions, keeps program files separate from `%APPDATA%`/secure-store state, and supports an in-place manual upgrade flow.
- **PD-03: Ordinary uninstall preserves local application data by default** - A developer's Review Bundle history, synchronization history, migration state, and opaque credential references must not disappear because program files were removed; any data purge is separate and explicit.
- **PD-04: No automatic updater ships in the MVP** - Releases are versioned manual installers with checksums and clean-machine instructions; this avoids implying an update trust/channel contract that has not been approved.
- **PD-05: The MVP is unsigned** - The release record must state that no Authenticode signing is used, document SmartScreen/trust implications, and label the candidate as an internal preview rather than a generally supported or trusted public release. Any future signed distribution requires separate product approval.
- **PD-06: Controlled live acceptance is allowed only with dedicated test resources** - GitHub.com/GHES credentials are supplied through approved runtime mechanisms, test effects are isolated and reconciled, and the evidence bundle contains only safe identifiers and digests.
- **PD-07: APP-AC evidence is a release gate, not a checklist shortcut** - F30 records every criterion individually and does not change `checklist.md` during specification or implementation planning.

## Implementation Decisions

- **IMP-01: Add a packaging/release manifest generator** - The generator reads the pinned package/runtime identity and packaging configuration, records artifact hashes and evidence references, and fails on missing identity or unsafe payload content.
- **IMP-02: Keep the unpacked artifact as a test intermediate** - `npm run check` may continue to build and smoke-test the unpacked artifact, while the F30 release command creates and validates the NSIS installer separately.
- **IMP-03: Resolve app data through the existing main-process application-data boundary** - The installer never makes the install directory authoritative for SQLite or secure-store references, and upgrade/uninstall tests assert this separation.
- **IMP-04: Separate evidence tiers** - Credential-free contract evidence, packaged local evidence, controlled GitHub/GHES evidence, manual accessibility/focus evidence, and operator attestations use separate schemas and cannot be silently merged into one unqualified pass.
- **IMP-05: Use the existing F28/F29 fault and security seams** - F30 orchestrates release tests and evidence collection through typed adapters, fake providers, temporary repositories, and the packaged artifact; it does not duplicate recovery or security logic.
- **IMP-06: Produce a bounded support-diagnostics archive** - The export includes a manifest, safe state projections, redacted recent activity, and digests, not raw database files, source, complete diffs, credentials, or uncontrolled logs.
- **IMP-07: Make the release decision append-only and reviewable** - A release candidate receives a unique gate/run identity, immutable source/environment references, pass/fail/exception outcomes, and a final decision; reruns create a new run rather than overwriting evidence.

## Testing Decisions

- **TST-01: Use real packaged Windows acceptance for platform-owned behavior** - Installer registration, Start-menu/tray identity, per-user paths, uninstall, focus, virtual desktops, secure-store integration, and screen-reader behavior cannot be proven solely with mocks.
- **TST-02: Use deterministic fixtures for every safety and fault matrix** - Publication, recovery, AI, Git, validation, and security tests use fake ports or temporary repositories wherever live external systems are not the behavior under test.
- **TST-03: Require controlled live acceptance for the supported GitHub matrix** - A release candidate must exercise GitHub.com and each supported GHES configuration, but credentials and remote effects are never stored in the evidence bundle.
- **TST-04: Test the complete workflow, not every pixel** - F30 owns release-level workflow and accessibility evidence; component-level rendering and feature contract tests remain with F04/F19/F20/F27/F29.
- **TST-05: Treat performance as measured evidence** - Record a named reference machine, OS build, dataset, run count, percentile/average, and background conditions; do not infer performance from unit-test duration.
- **TST-06: Do not use a live AI provider for credential-free conformance** - Fake providers prove normalized contracts, policy, budgets, and no-publication authority; controlled live provider acceptance is a separately approved, non-credential-recording step.

## Proposed Modules

- **MOD-01: Windows Release Packager** - Produces the per-user installer, packaged metadata, icons, and release artifact layout.
- **MOD-02: Release Manifest and Hash Recorder** - Records source/runtime/package identity, artifact hashes, packaging policy, and evidence references.
- **MOD-03: Install/Data Lifecycle Harness** - Exercises clean install, upgrade, migration, cancellation, failure, uninstall, data preservation, and prerequisite behavior.
- **MOD-04: Packaged Acceptance Runner** - Launches the release candidate against credential-free fixtures and controlled GitHub/GHES test environments with bounded evidence.
- **MOD-05: Fault and Recovery Orchestrator** - Reuses F28 lifecycle/network/effect fault seams and records packaged recovery outcomes and duplicate-effect assertions.
- **MOD-06: Accessibility and Windows UX Review Harness** - Captures keyboard, screen-reader, forced-color, focus, zoom, narrow-window, notification, tray, and virtual-desktop evidence.
- **MOD-07: Performance Probe** - Measures startup, reopen, idle resource, shutdown, and representative dataset budgets on a named reference machine.
- **MOD-08: Support Diagnostics Exporter** - Produces the redacted, bounded, shareable support archive.
- **MOD-09: Requirements Trace and Release Gate** - Evaluates all 77 application criteria, security/package gates, approved exceptions, and the final release decision.

## Workflows

### Workflow 1: Build and install a release candidate

```text
1. Start from a clean checkout and the pinned Node/npm/runtime versions.
2. Run the repository checks, F29 security gate, and specification linters.
3. Build the unpacked artifact, then build the x64 per-user installer.
4. Scan payload and installer metadata for identity, paths, secrets, and test content.
5. Generate SHA-256 hashes and an immutable release manifest.
6. Install on a clean supported Windows 11 x64 machine with no repository checkout.
7. Launch, verify startup/tray/window behavior, and record the clean-machine evidence.
8. Keep the installer and manifest only if every required release gate is green.
```

### Workflow 2: Upgrade and uninstall safely

```text
1. Install the prior candidate and create representative settings, history,
   worktrees, migration state, and opaque credential references.
2. Close/reopen the app and verify the fixture is durable.
3. Install the new candidate over the prior installation.
4. Verify data paths, one-time migrations, secure-store references, and history.
5. Export support diagnostics and confirm it is bounded and redacted.
6. Uninstall the program and verify program files are removed while the
   default application data and published-history references remain.
7. Reinstall and verify the preserved state is still recoverable.
```

### Workflow 3: Complete controlled PR acceptance

```text
1. Prepare dedicated GitHub.com and supported GHES test repositories/PRs.
2. Configure the packaged app using secure runtime credentials.
3. Add multiple PRs, generate deterministic feedback fixtures, and verify polling,
   batching, pause, notifications, proposal review, implementation, validation,
   revision, discard, stale handling, and explicit publication.
4. Capture safe remote identities, state transitions, validation outcomes, and
   effect reconciliation without capturing credentials or unrestricted content.
5. Repeat the synchronization workflow with clean, no-op, conflict, ambiguous,
   stale, and sibling-failure cases.
6. Reconcile or remove dedicated test effects according to the environment policy.
7. Attach the controlled run to the 77-criterion trace.
```

### Workflow 4: Fault, accessibility, and final release gate

```text
1. Run credential-free F28/F29 fault and boundary suites against the packaged app.
2. Terminate/restart, close the renderer, toggle network, simulate sleep/wake,
   and inject uncertain effects at each durable phase.
3. Verify exact recovery, no duplicate effects, hold/budget preservation, and
   safe attention states.
4. Run keyboard, screen-reader, forced-color, zoom, narrow-window, focus, and
   Windows virtual-desktop acceptance.
5. Measure performance budgets and export support diagnostics.
6. Assemble the release manifest, evidence index, exceptions, residual risks,
   and per-APP-AC trace.
7. Publish a release decision only when all required evidence is present and green.
```

## Contract-Test Criteria

- **CT-F30-01:** The packaging harness produces a per-user Windows 11 x64 installer with stable identity, icons, version, expected payload, no source checkout path, no credentials, and a matching SHA-256 release manifest that records the unsigned internal-preview/manual-update tier.
- **CT-F30-02:** Clean-install, cancellation, failed-install, upgrade, migration, uninstall, reinstall, and data-preservation fixtures produce the documented result and never silently remove a compatible application-data directory.
- **CT-F30-03:** Packaged startup/tray/window close/reopen/shutdown/deep-link tests prove the main process remains authoritative, ordinary close is not shutdown, repeated open/shutdown is idempotent, and the target is delivered once.
- **CT-F30-04:** Credential-free Review Bundle fixtures cover proposal read-only behavior, decisions/questions, implementation, validation, revision, discard, stale blocking, approval, publication, response-only failure, and no duplicate effects using the packaged binary.
- **CT-F30-05:** Credential-free synchronization fixtures cover selection/resolution, exact repositories/branches/SHAs, independent results, clean/no-op zero-AI paths, conflict/ambiguity, validation, stale/dirty handling, per-result approval, and non-force publication.
- **CT-F30-06:** Fault-injection fixtures stop the packaged app before and after each durable/local/remote effect and prove preserved feedback, holds, budgets, worktrees, evidence, identities, and no duplicate AI/GitHub/Git effects.
- **CT-F30-07:** Sleep/wake/offline/online/wall-clock and Windows virtual-desktop fixtures prove bounded reconciliation, capped backoff, exact deep links, current-desktop focus/fallback, and no catch-up storm.
- **CT-F30-08:** Accessibility and error-state evidence covers keyboard, focus, screen reader, forced colors/high contrast, reduced motion, zoom, narrow windows, non-color state semantics, and what/why/evidence/next-action content.
- **CT-F30-09:** Performance fixtures record the AC-19 budgets on a named reference machine with repeatable input data and fail or create an approved exception when a budget is exceeded.
- **CT-F30-10:** Support-diagnostics fixtures prove the export is bounded, redacted, correlated, reinstall-safe, and free of credentials, raw prompts, source/full diff, uncontrolled environment values, provider SDK objects, arbitrary commands, and unredacted local paths.
- **CT-F30-11:** Release-gate fixtures require every APP-AC-01 through APP-AC-77 to have an individual evidence row, source/build/environment identity, owner, timestamp, and passing or explicitly approved exception status; missing/contradictory rows fail.
- **CT-F30-12:** Clean-checkout/release reproducibility fixtures run `npm ci`, `npm run check`, `npm run security:gate`, packaging, payload scans, both specification linters, `git diff --check`, and all credential-free release tests without live credentials or external publication.

## Requirement Traceability

| Requirement family | Observable coverage | Named contract tests |
|---|---|---|
| FR-01 | AC-01-AC-04, AC-21, AC-23-AC-25 | CT-F30-01, CT-F30-02, CT-F30-12 |
| FR-02 | AC-03-AC-05, AC-20, AC-24-AC-25 | CT-F30-02, CT-F30-10 |
| FR-03 | AC-01-AC-06, AC-16-AC-18 | CT-F30-03, CT-F30-07, CT-F30-08 |
| FR-04 | AC-07-AC-10, AC-17-AC-18, AC-22 | CT-F30-03, CT-F30-04, CT-F30-11 |
| FR-05 | AC-11-AC-13, AC-22 | CT-F30-05, CT-F30-11 |
| FR-06 | AC-10, AC-14-AC-18, AC-22 | CT-F30-06, CT-F30-07, CT-F30-11 |
| FR-07 | AC-06, AC-16-AC-19, AC-25 | CT-F30-03, CT-F30-07, CT-F30-08 |
| FR-08 | AC-19-AC-20, AC-23-AC-25 | CT-F30-09, CT-F30-10, CT-F30-12 |
| FR-09 | AC-21-AC-25 | CT-F30-11, CT-F30-12 |
| NFR-01-NFR-08 | AC-01-AC-25 | CT-F30-01-CT-F30-12 |
| INV-01-INV-10 | AC-01-AC-25 | CT-F30-01-CT-F30-12 |
