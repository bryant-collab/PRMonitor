# Plan: F30 Windows Packaging, End-to-End Acceptance, and Release Readiness

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** `Specs/windows_packaging_end_to_end_acceptance_and_release_readiness_PRD.md`
>
> **Last revalidated against:** application overview revision 2026-09-28 and F30 PRD revision 2026-09-28
>
> **Entry/readiness gates:** F01-F29 implementation evidence is available from
> the supported clean-checkout toolchain. The current repository checks,
> packaged smoke harness, F28 recovery seams, and F29 security handoff are
> green. A Windows 11 x64 test environment is available for installer, secure
> store, tray, notification, focus, virtual-desktop, accessibility, and
> upgrade/uninstall testing. Dedicated GitHub.com and every supported GHES
> acceptance environment have test repositories/PRs and approved runtime
> credential injection. The selected MVP distribution tier is an unsigned
> internal preview with manual updates. F30 does not sign artifacts; the release
> gate records the absence of Authenticode signing and SmartScreen/trust
> implications, and does not label the candidate a generally supported or
> trusted public release.
>
> This PLAN cannot change product requirements. Resolve contradictions in the
> owning PRD before implementation and rerun both specification linters. This
> feature does not check the checklist item; implementation and approval are
> separate.

## Implementation Boundary

F30 is the release and acceptance layer around the already-owned F01-F29
contracts. It adds the Windows installer target and release metadata, package
and payload checks, clean-machine and data-lifecycle harnesses, packaged
end-to-end runners, fault/accessibility/performance evidence, support
diagnostics, and the final 77-criterion release gate.

F30 does not create a second source of truth for application state. F03 remains
authoritative for data/migrations, F04/F19 for lifecycle and native surfaces,
F06/F23/F27 for remote/publication effects, F13/F14 for Git/worktree/validation
truth, F15-F17/F26 for provider and bounded AI work, F18-F22/F24-F25 for review
and synchronization workflows, F28 for recovery, and F29 for security. F30
only starts those owners through their typed entry points and records the
resulting release evidence.

The release artifact has two intentionally separate locations:

- Program files and installer payload: versioned, hashable, replaceable, and
  safe to remove during ordinary uninstall.
- Per-user application data: authoritative SQLite, safe settings, opaque
  secure-store references, operation records, worktree metadata, and history;
  preserved across upgrade and ordinary uninstall.

## Readiness Gates

- F01-F29 implementation and contract evidence is present, current, and tied to
  a source revision; no prior checklist item is being silently reimplemented in
  F30.
- The supported Windows 11 x64 build, per-user NSIS target, app identity/icon
  assets, data-directory policy, manual-update policy, and unsigned
  internal-preview tier are approved or explicitly marked as release blockers.
- The clean-checkout commands documented in `README.md` and the F29 security
  handoff are runnable without inspecting or copying credentials.
- The packaged application can be started by the F30 harness with a temporary
  user-data/cache directory and can be closed/reopened without a renderer.
- Dedicated GitHub.com and supported GHES test environments can be exercised
  with secure runtime credential injection and isolated test repositories/PRs.
- The Windows test machine has Git, at least three virtual desktops for the
  A/B/C scenario, a screen reader or UI Automation path, forced-colors/high-
  contrast capability, and a reproducible performance measurement setup.
- The F30 evidence schema, release manifest, 77-row trace, support-diagnostics
  redaction rules, and exception/approval record format are agreed before a
  release run begins.

## Proposed Vertical Slices

1. **Installable Windows artifact, identity, and release manifest**
   - **Blocked by:** F01 packaging conventions, F29 dependency/runtime handoff, the selected Windows 11 x64 build, the NSIS/manual-update decisions, and application/tray icon assets.
   - **Stories / requirements / acceptance criteria:** US-01; FR-01.1-FR-01.6, FR-09.3-FR-09.5; NFR-01, NFR-03, NFR-06; INV-01, INV-07-INV-08; AC-01-AC-04, AC-21, AC-23.
   - **Implementation:** Add the per-user Windows 11 x64 NSIS target alongside the existing unpacked smoke target. Supply stable application/tray identity and icons, exclude source/test/dev paths, generate a versioned release manifest and SHA-256 artifacts, and record the unsigned internal-preview/manual-update policy in the manifest.
   - **Visible result:** A clean checkout produces a hashable Windows installer and an evidence-linked manifest; a clean machine can install and launch it without the repository checkout.
   - **Durable records / external effects:** Writes only release artifacts, hashes, manifest, and bounded local evidence. No application database, GitHub, AI, Git publication, or developer worktree effect occurs.
   - **Failure / cancellation / restart:** Missing icon/identity, unsafe payload, packaging failure, unsupported runtime, hash mismatch, or a manifest inconsistent with the selected unsigned internal-preview/manual-update tier fails before a release marker is written. A cancelled pack run can be repeated from a clean output directory without overwriting an approved manifest.
   - **Exact evidence:** Installer existence/type/architecture; app ID/name/icon inspection; payload secret/local-path scan; hash reproducibility; runtime/lockfile/package identity; `npm run check`; `npm run security:gate`; `git diff --check`; CT-F30-01, CT-F30-12.
   - **Exit criterion:** AC-01-AC-04, AC-21, and AC-23 pass and the manifest identifies one exact release candidate.

2. **Clean install, upgrade, migration, uninstall, and reinstall lifecycle**
   - **Blocked by:** Slice 1; F03 data/migration paths; F05 secure-store reference behavior; F28 startup recovery; a clean Windows 11 x64 machine or isolated VM snapshot.
   - **Stories / requirements / acceptance criteria:** US-01-US-02; FR-02.1-FR-02.5, FR-03.1-FR-03.4, FR-08.3-FR-08.4; NFR-02-NFR-03, NFR-08; INV-02, INV-07-INV-08; AC-01, AC-03-AC-06, AC-20, AC-24-AC-25.
   - **Implementation:** Exercise the installer in a clean per-user profile, seed a prior candidate with representative durable state, install over it, verify one-time migrations and safe credential references, export diagnostics, uninstall, and reinstall. Document prerequisites, data paths, backup expectations, uninstall preservation, and the manual update flow. Add no ordinary-uninstall data purge.
   - **Visible result:** The operator can install, upgrade, uninstall, and reinstall while the app reopens the same safe durable history and clearly explains any prerequisite or migration block.
   - **Durable records / external effects:** Test-owned application-data directories, secure-store fakes/fixtures, migration evidence, installer logs, and support archives. No real credential or published history is removed.
   - **Failure / cancellation / restart:** Installer cancellation/failure leaves the prior compatible state recoverable. Migration failure stops before destructive change and exposes a bounded repair/restore path. Uninstall removes only program/registration surfaces by default.
   - **Exact evidence:** Clean-machine install trace; program/data path table; migration before/after hashes; secure-store reference scan; cancellation/failure matrix; uninstall/reinstall readback; support export scan; CT-F30-02, CT-F30-10.
   - **Exit criterion:** AC-01, AC-03-AC-05, AC-20, AC-24-AC-25 pass with no data-loss or false-success result.

3. **Packaged lifecycle, tray, notification, and virtual-desktop acceptance**
   - **Blocked by:** Slices 1-2; F04/F19 lifecycle/native surface contracts; Windows A/B/C test environment; notification/tray permissions.
   - **Stories / requirements / acceptance criteria:** US-03-US-04, US-09; FR-03.1-FR-03.4, FR-07.1-FR-07.4; NFR-02, NFR-05-NFR-06; INV-03, INV-06-INV-08; AC-06, AC-16-AC-19.
   - **Implementation:** Run the installed artifact through launch, close-to-tray, tray open, notification/deep-link, renderer replacement, current-desktop focus, explicit **Shutdown PRMonitor**, and repeated open/shutdown flows. Capture F04/F19 read models and native adapter results; do not assert platform behavior from mocks alone.
   - **Visible result:** Closing the UI leaves a working tray process, opening from B/C targets the current desktop and requested Review Bundle/batch, and explicit shutdown removes native resources without losing durable work.
   - **Durable records / external effects:** Lifecycle, tray, notification, route, and focus evidence tied to the release candidate. No GitHub, AI, Git, or publication effect is required for the slice.
   - **Failure / cancellation / restart:** Focus denial, notification unavailability, renderer crash, duplicate route, or shutdown timeout remains a bounded actionable state and never launches a second process or releases a hold.
   - **Exact evidence:** Launch/close/reopen/shutdown trace; tray/notification identity; exactly-once deep-link trace; Windows Desktop A/B/C process/window/focus table; renderer-close persistence check; keyboard/focus evidence; CT-F30-03, CT-F30-07, CT-F30-08.
   - **Exit criterion:** AC-06, AC-16-AC-18 pass on the installed release candidate, with any platform limitation explicitly recorded.

4. **Credential-free packaged Review Bundle conformance**
   - **Blocked by:** Slices 1-3; F18-F23 typed read/action contracts; F13/F14/F16/F17 evidence; fake GitHub/provider/secure-store adapters; temporary repositories/worktrees.
   - **Stories / requirements / acceptance criteria:** US-05-US-06; FR-04.2-FR-04.4, FR-06.1-FR-06.5, FR-08.3-FR-08.4; NFR-02-NFR-03, NFR-06-NFR-07; INV-03-INV-07, INV-10; AC-08-AC-10, AC-14, AC-17-AC-18, AC-22-AC-23.
   - **Implementation:** Run proposal, decision, implementation, validation, revision, discard, stale, approval, publication, response-only failure, and recovery scenarios through the packaged binary with fakes where live remote state is not under test. Assert that the renderer consumes owner read models and cannot create effects.
   - **Visible result:** A release-candidate Review Bundle can be opened, decided, revised, discarded, and published in the test harness, with the complete diff, real validation, human decisions, usage, snapshots, and attention states visible.
   - **Durable records / external effects:** Test-owned SQLite, temporary operation worktrees, fake provider/GitHub/OS adapters, publication spies, bounded evidence, and response/release effect records. No live credential or real publication occurs.
   - **Failure / cancellation / restart:** Missing/stale/dirty/unsafe state, false validation pass, duplicate command, renderer closure, or restart blocks or reconciles through the owning contract and leaves the worktree/evidence inspectable.
   - **Exact evidence:** Proposal-before-mutation report; all-item decision/question matrix; baseline/post validation matrix; diff authority report; stale/discard/revision report; publication idempotency/fault report; provider/publication reachability scan; CT-F30-04, CT-F30-06, CT-F30-11.
   - **Exit criterion:** AC-08-AC-10, AC-14, AC-17-AC-18, and AC-22-AC-23 pass without a second workflow authority.

5. **Controlled GitHub.com/GHES Review Bundle journey**
   - **Blocked by:** Slice 4; dedicated test repositories/PRs for GitHub.com and each supported GHES configuration; approved secure runtime credentials; operator-approved test effect cleanup.
   - **Stories / requirements / acceptance criteria:** US-05-US-06; FR-04.1-FR-04.5, FR-09.1-FR-09.2; NFR-03, NFR-06-NFR-07; INV-04-INV-06; AC-07-AC-10, AC-22, AC-25.
   - **Implementation:** Configure the installed app against each supported server, add multiple test PRs, create/observe feedback, exercise batching/pause/notification, perform the proposal-before-mutation and final review flow, publish only an explicitly approved test change/response, and record the safe remote identities/effects. Repeat for GHES URL/API behavior and fork identity where supported.
   - **Visible result:** The same installed workflow works against GitHub.com and every supported GHES entry in the release matrix, or a configuration is marked unsupported with an actionable reason and not claimed as supported.
   - **Durable records / external effects:** Dedicated test-server PRs, branches, comments/responses, test worktrees, and secure credential references. The evidence bundle stores only safe IDs, SHAs, statuses, timestamps, and digests; test effects are reconciled by the environment owner.
   - **Failure / cancellation / restart:** Auth/server/remote failure identifies the environment and safe reason. A stale head, response failure, network interruption, or restart follows F23/F28 and remains reviewable without duplicate publication.
   - **Exact evidence:** Per-server capability/config matrix; add/edit/poll/batch/hold/notification trace; proposal/final/publication trace; remote SHA/effect reconciliation; secret scan; operator attestation; CT-F30-04, CT-F30-06, CT-F30-11.
   - **Exit criterion:** AC-07-AC-10 and AC-22 pass for every supported server configuration, with no credential leakage and no unresolved environment-specific release blocker.

6. **Credential-free packaged synchronization and merge acceptance**
   - **Blocked by:** Slices 1-4; F24-F27 contracts; temporary repositories/worktrees; fake provider/validation/GitHub adapters; test branches for controlled publication.
   - **Stories / requirements / acceptance criteria:** US-07-US-08; FR-05.1-FR-05.4, FR-06.1-FR-06.5, FR-09.1-FR-09.2; NFR-06-NFR-07; INV-03, INV-05-INV-07; AC-11-AC-15, AC-22.
   - **Implementation:** Exercise select/clear/select-all, source override/base resolution, fork identity, eligibility confirmation, independent results, clean/no-op, semantic conflict, ambiguity, validation, stale/dirty choices, per-result approval, non-force publication, and old-bundle invalidation with credential-free fixtures. Use a dedicated controlled test environment for any final remote-push proof.
   - **Visible result:** Every selected PR has a reviewable independent result, deterministic paths show zero AI usage, ambiguous paths remain attention-required, and only a fresh per-result approval can publish.
   - **Durable records / external effects:** Test-owned sync batches/results, merge worktrees, validation and AI reports, effect spies, and safe test-branch identities. No developer clone or real project is touched.
   - **Failure / cancellation / restart:** One sibling failure does not stop others. Stale source/head, unknown worktree, failed validation, uncertain push, or ambiguous intent preserves evidence and blocks publication.
   - **Exact evidence:** Selection/source/identity table; clean/no-op zero-token report; conflict/ambiguity/validation matrix; SHA/merge-base/diff report; per-result approval and non-force scan; old-bundle stale report; CT-F30-05, CT-F30-06, CT-F30-11.
   - **Exit criterion:** AC-11-AC-15 and AC-22 pass with independent per-PR outcomes and no duplicate/force effect.

7. **Packaged recovery, sleep, network, and uncertain-outcome acceptance**
   - **Blocked by:** Slices 1-6; F28 recovery seams; F29 security/recovery projections; fault-injection harness; packaged process control.
   - **Stories / requirements / acceptance criteria:** US-03, US-06, US-08; FR-06.1-FR-06.5, FR-09.2-FR-09.4; NFR-02, NFR-06-NFR-07; INV-03, INV-06-INV-08; AC-10, AC-14-AC-18, AC-22-AC-23.
   - **Implementation:** Terminate the packaged process before/after durable intent, validation, AI, local commit, push, response, merge, and terminal handoff boundaries. Close/recreate the renderer, simulate sleep/wake/offline/online/time jump, remove/move worktrees, and reconcile exact effects through F28 without auto-replaying uncertain AI.
   - **Visible result:** Restart and wake produce a truthful recovery view: preserved state, exact adopted effects, bounded retry, or actionable attention; no budget, hold, worktree, feedback, or sibling result is lost or duplicated.
   - **Durable records / external effects:** Fault-injected test databases, temporary Git repositories, fake network/provider/GitHub/OS adapters, recovery sessions, effect classifications, and bounded reports.
   - **Failure / cancellation / restart:** A cancelled or crashed run writes no success marker. Missing/ambiguous/security-blocked evidence remains visible and cannot be converted to pass by recovery or reopening the window.
   - **Exact evidence:** Phase-by-phase crash matrix; renderer closure/restart readback; sleep/network/backoff report; unknown effect adoption matrix; hold/budget/manual-edit preservation; duplicate-effect counters; CT-F30-06, CT-F30-07, CT-F30-11.
   - **Exit criterion:** AC-14-AC-18, AC-22, and AC-23 pass with no false success or duplicate external effect.

8. **Accessibility, performance, support diagnostics, and final release gate**
   - **Blocked by:** Slices 1-7; stable release candidate; Windows accessibility/focus tooling; named performance machine; final F29 handoff and all prior evidence.
   - **Stories / requirements / acceptance criteria:** US-09-US-10; FR-07.1-FR-07.4, FR-08.1-FR-08.4, FR-09.1-FR-09.5; NFR-01-NFR-08; INV-01, INV-04, INV-07-INV-10; AC-17-AC-25.
   - **Implementation:** Perform the full keyboard/screen-reader/forced-color/reduced-motion/zoom/narrow-window/focus/error-state review, measure AC-19 budgets, export and scan support diagnostics, assemble the 77-row trace, run all release commands/linters, record residual risks and the unsigned/manual-update decision, and produce the final release manifest and decision.
   - **Visible result:** One release package contains the installer, hashes, clean-machine/support instructions, evidence index, per-APP-AC result, security/dependency report, performance/accessibility reports, approved exceptions, residual risks, and an unambiguous release decision.
   - **Durable records / external effects:** Versioned release evidence and sanitized support archive. No checklist edit, real-secret capture, autonomous publication, or developer-worktree mutation.
   - **Failure / cancellation / restart:** Any missing/contradictory evidence, inaccessible control, budget failure, secret leak, invalid mapping, linter `missing`, unsupported runtime, release record that omits the unsigned/manual-update tier, or false green result blocks the gate. A cancelled run leaves no success marker and can be rerun.
   - **Exact evidence:** Accessibility/focus report; AC-19 measurements; support archive scan; F29 gate/dependency/import report; all CT-F30-01-CT-F30-12; `npm ci`; `npm run check`; `npm run security:gate`; both F30 specification linters; `git diff --check`; per-APP-AC-01-APP-AC-77 trace; final manifest/decision.
   - **Exit criterion:** AC-17-AC-25 pass, every APP-AC has individual passing evidence or approved exception, all required release checks are green, and the final manifest explicitly records the unsigned internal-preview/manual-update tier.

## Cross-Slice Verification and Handoff

- F30's exact owning PRD is `Specs/windows_packaging_end_to_end_acceptance_and_release_readiness_PRD.md`. This PLAN adds implementation sequencing and evidence; it does not alter product requirements or check `checklist.md`.
- F01 remains responsible for the pinned toolchain and unpacked artifact smoke harness. F30 adds the installable target and release manifest; it does not treat the unpacked artifact as a shipped installer.
- F03 remains authoritative for SQLite, migrations, data paths, transactionality, and durable history. F30 verifies clean/upgrade/uninstall behavior and never copies or repairs the database outside F03 contracts.
- F04/F19 remain authoritative for lifecycle, window recreation, tray, notifications, deep links, shutdown, and current-desktop behavior. F30 drives and records the packaged evidence; it does not create a second lifecycle state machine.
- F05/F06/F23/F27 remain authoritative for secure credentials, GitHub transport, publication identities, effects, approvals, and non-force behavior. Controlled live acceptance uses their typed ports and never stores credentials in release evidence.
- F13/F14 remain authoritative for worktree/Git/validation truth. F15-F17/F26 remain authoritative for provider contracts, policy, budgets, reports, and semantic conflict outcomes. F30 never upgrades a UI/provider claim into deterministic evidence.
- F18-F22/F24-F25 remain authoritative for review/synchronization workflows; F28 remains authoritative for restart/sleep/network/uncertain-outcome recovery; F29 remains authoritative for security boundaries, redaction, dependency policy, and residual-risk evidence.
- F30's evidence tiers are explicit: credential-free automated conformance, packaged local acceptance, controlled GitHub/GHES acceptance, manual accessibility/focus review, and release-operator attestations. The final 77-row trace records which tier supports each criterion.
- The F30 distribution decision is an unsigned internal preview with manual updates. The release manifest records that no Authenticode signing is used, documents SmartScreen/trust implications, and prohibits a generally supported or trusted public-release label. Any future signed tier requires separate product approval and an updated release gate.

## Requirement-to-Slice Trace

| Requirement family | Owning slices | Release handoff |
|---|---|---|
| FR-01 | 1, 8 | Installable artifact, identity, hashes, payload scan, and unsigned/manual-update policy. |
| FR-02 | 2, 8 | Clean install/upgrade/uninstall/reinstall and data-preservation evidence. |
| FR-03 | 2-3, 8 | Packaged lifecycle, tray, notification, deep-link, shutdown, and desktop evidence. |
| FR-04 | 4-5, 8 | Credential-free and controlled GitHub/GHES Review Bundle evidence. |
| FR-05 | 6, 8 | Credential-free and controlled synchronization evidence. |
| FR-06 | 4, 6-7, 8 | Fault-injection, recovery, sleep/network, and uncertain-effect evidence. |
| FR-07 | 3, 8 | Accessibility, focus, error-state, and virtual-desktop evidence. |
| FR-08 | 2, 8 | Performance budgets and sanitized support diagnostics. |
| FR-09 | 1, 4-8 | Full release manifest, 77-criterion trace, gates, exceptions, and final decision. |
| NFR-01-NFR-08 | 1-8 | Reproducibility, reliability, privacy, performance, accessibility, evidence, safety, and supportability. |
| INV-01-INV-10 | 1-8 | Exact release identity, data/authority preservation, safe evidence, and complete trace. |

## Exact Requirement Coverage

The ranges above are a navigation aid. This matrix names every leaf
requirement explicitly so the specification linter and implementation review
can verify that no requirement is covered only by implication.

| Slice | Exact PRD requirements covered |
|---|---|
| 1 | AC-01, AC-02, AC-03, AC-04, AC-21, AC-23; FR-01.1, FR-01.2, FR-01.3, FR-01.4, FR-01.5, FR-01.6, FR-09.3, FR-09.4, FR-09.5; NFR-01, NFR-03, NFR-06; INV-01, INV-07, INV-08 |
| 2 | AC-01, AC-03, AC-04, AC-05, AC-06, AC-20, AC-23, AC-24, AC-25; FR-02.1, FR-02.2, FR-02.3, FR-02.4, FR-02.5, FR-03.1, FR-03.2, FR-03.3, FR-03.4, FR-08.3, FR-08.4; NFR-02, NFR-03, NFR-08; INV-02, INV-07, INV-08 |
| 3 | AC-06, AC-16, AC-17, AC-18, AC-19; FR-03.1, FR-03.2, FR-03.3, FR-03.4, FR-07.1, FR-07.2, FR-07.3, FR-07.4; NFR-02, NFR-05, NFR-06; INV-03, INV-06, INV-07, INV-08 |
| 4 | AC-08, AC-09, AC-10, AC-14, AC-17, AC-18, AC-22, AC-23; FR-04.2, FR-04.3, FR-04.4, FR-04.5, FR-06.1, FR-06.2, FR-06.3, FR-06.4, FR-06.5, FR-08.3, FR-08.4; NFR-02, NFR-03, NFR-06, NFR-07; INV-03, INV-04, INV-06, INV-07, INV-10 |
| 5 | AC-07, AC-08, AC-09, AC-10, AC-22, AC-25; FR-04.1, FR-04.2, FR-04.3, FR-04.4, FR-04.5, FR-09.1, FR-09.2; NFR-03, NFR-06, NFR-07; INV-04, INV-05, INV-06 |
| 6 | AC-11, AC-12, AC-13, AC-14, AC-15, AC-22; FR-05.1, FR-05.2, FR-05.3, FR-05.4, FR-06.1, FR-06.2, FR-06.3, FR-06.4, FR-06.5, FR-09.1, FR-09.2; NFR-06, NFR-07; INV-03, INV-05, INV-06, INV-07 |
| 7 | AC-10, AC-14, AC-15, AC-16, AC-17, AC-18, AC-22, AC-23; FR-06.1, FR-06.2, FR-06.3, FR-06.4, FR-06.5, FR-09.2, FR-09.3, FR-09.4; NFR-02, NFR-06, NFR-07; INV-03, INV-06, INV-07, INV-08 |
| 8 | AC-17, AC-18, AC-19, AC-20, AC-21, AC-22, AC-23, AC-24, AC-25; FR-07.1, FR-07.2, FR-07.3, FR-07.4, FR-08.1, FR-08.2, FR-08.3, FR-08.4, FR-09.1, FR-09.2, FR-09.3, FR-09.4, FR-09.5; NFR-01, NFR-02, NFR-03, NFR-04, NFR-05, NFR-06, NFR-07, NFR-08; INV-01, INV-02, INV-03, INV-04, INV-05, INV-06, INV-07, INV-08, INV-09, INV-10 |

The F30 checklist item remains unchecked until implementation, packaging,
controlled acceptance, and the final release decision are complete.
