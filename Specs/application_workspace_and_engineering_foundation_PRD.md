# F01 - Application Workspace and Engineering Foundation - Product Requirements Document

> Approved CI compatibility exception, 2026-10-05: the Linux runner label in
> AC-17, FR-05.6 and TST-08 temporarily uses `ubuntu-22.04` instead of
> `ubuntu-latest`. All commands, security and failure gates are unchanged.
> Retire the pin before 2027-04-17; see
> [runner evidence and migration criteria](../docs/evidence/backlog/ubuntu-runner-pin.md).

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F00 - Deterministic validation configuration contract | The application workspace must incorporate F00 without changing its public contract, generated schema, fixtures, or conformance behavior. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F02 - Domain contracts and deterministic state machines | Uses the application workspace's shared-contract boundary and deterministic test/build commands. |
| 2 | F03 - SQLite persistence, migrations, and transactional repositories | Uses the main-process composition boundary and root check gates; F01 does not add persistence. |
| 3 | F04 - Persistent Electron shell, IPC boundary, and Windows virtual-desktop spike | Extends the F01 desktop shell and typed preload placeholder with authoritative lifecycle, validated IPC, tray, and platform behavior. |
| 4 | F05-F07 - GitHub setup and managed PRs | Use the provider-neutral application workspace and deterministic integration-test harness. |
| 5 | F13-F14 - Worktrees and validation runner | Use the temporary Git fixture harness and deterministic test entry points; F01 does not operate user repositories. |
| 6 | F15 - Provider-neutral AI contracts and Codex adapter | Consumes the pinned runtime/dependency boundary; F01 does not invoke or adapt an AI provider. F15 is the only allowed production importer/invoker of the pinned SDK. |
| 7 | F29 - Security hardening and operational safeguards | Extends the foundation's import/secret checks with production threat-model hardening. |
| 8 | F30 - Packaging, release, and update hardening | Extends F01's unpacked production artifact into signed/distributed installers and release channels. |

## Application Requirements Covered

F01 directly owns no application-level acceptance criterion. It is an engineering enabler only: the shell, workspace, package boundaries, fixtures, and checks are prerequisites for later features but do not close any user-facing behavior. The checklist's “Architectural enabler; no criterion is closed by scaffolding alone” rule is therefore authoritative.

| Coverage status | Feature requirements | Acceptance criteria | Ownership / disposition |
| --- | --- | --- | --- |
| No direct `APP-AC-*` ownership | All F01 requirements | AC-01-AC-19 | Primary F01 scope is clean-checkout engineering evidence only; no application criterion is mapped as covered. |
| Deferred product behavior | None | None | Polling, persistence, lifecycle/tray/deep links/virtual desktops, validated IPC, Git/worktrees, validation, AI, review UI, synchronization, publication, security hardening, and release packaging remain owned by their named downstream features. |

The application-coverage linter must consequently classify every overview criterion as `not-applicable` for this PRD (or `needs-review` for a low-confidence non-applicability decision), never as direct F01 coverage. No downstream criterion may be “covered” merely because F01 provides a package, interface, placeholder, fixture, or smoke test.

### Linter review disposition

- **APP-AC-13 — disposition: not-applicable for F01.** The coverage linter may classify this unmapped criterion as `needs-review` because F01 runs engineering tests, but F01 does not implement the product validation runner or persist real validation-command exit evidence. F14 owns that criterion; the F01 tests are foundation evidence only.

## Executive Summary

PRMonitor currently contains a specification linter and the completed F00 validation-contract package, but it does not yet have the desktop application workspace in which the product can be built and tested. Without a reproducible root workspace, clear process boundaries, and CI-safe test harnesses, later features could accidentally depend on the linter, expose privileged Electron APIs to the renderer, mutate a developer's repository during tests, or pass locally while failing from a clean checkout.

F01 establishes the smallest usable engineering foundation: a Windows-first Electron/React/TypeScript workspace at `apps/desktop`, a production-mode shell that can be built and smoke-launched, static boundaries for main/preload/renderer/shared code, deterministic root scripts, pinned dependencies, and temporary Git-repository fixtures. The result is a launchable shell and trustworthy build/test evidence, not a partially implemented monitoring product. F01 deliberately does not close any user-facing application acceptance criterion; later features own persistent lifecycle, validated IPC, state, GitHub, worktrees, AI, persistence, UI, and release hardening.

## User Stories

### Start from a clean checkout

- **US-01:** **GIVEN** a clean checkout with Node.js `24.19.0`, npm `11.17.0`, Git `2.55.0`, and the committed lockfile, **WHEN** a developer installs dependencies and runs the documented root check, **THEN** the desktop workspace, F00 package, and standalone spec-linter workspace build and test without requiring a Typesafe API key or contacting a product service; if Git is absent or the version is unsupported, the root check fails with `GIT_UNAVAILABLE` and remediation instead of reporting success.
  - **Acceptance Criteria:** AC-01, AC-02, AC-03.

- **US-02:** **GIVEN** a dependency, type, lint, or test failure, **WHEN** the root check runs in local or CI mode, **THEN** it exits non-zero with a path-oriented diagnostic and does not leave a misleading production artifact marked successful.
  - **Acceptance Criteria:** AC-01, AC-08, AC-13.

### Launch the foundation shell

- **US-03:** **GIVEN** a successful production build on the primary Windows platform, **WHEN** the packaged application is launched by the smoke harness, **THEN** a minimal React startup surface renders and the test-controlled process exits cleanly.
  - **Acceptance Criteria:** AC-04, AC-05, AC-06, AC-07.

- **US-04:** **GIVEN** a renderer bundle attempts to import privileged Node/Electron functionality or call an undeclared bridge, **WHEN** static checks run, **THEN** the check fails before packaging rather than relying on runtime convention.
  - **Acceptance Criteria:** AC-05, AC-06.

### Test safely and deterministically

- **US-05:** **GIVEN** a test needs Git state, **WHEN** it requests a repository fixture, **THEN** the harness creates an isolated temporary repository with deterministic commits/refs, and cleanup removes only that fixture even after failure or cancellation.
  - **Acceptance Criteria:** AC-09, AC-10, AC-11, AC-12.

- **US-06:** **GIVEN** Git is unavailable on the host, **WHEN** a Git fixture test runs, **THEN** the test fails with an actionable `GIT_UNAVAILABLE` diagnostic and never substitutes a developer workspace or silently skips the coverage.
  - **Acceptance Criteria:** AC-10, AC-12.

### Preserve existing tooling

- **US-07:** **GIVEN** the F00 package and standalone specification linter are present, **WHEN** the application workspace is added or rebuilt, **THEN** their package paths, public exports, generated schema, fixtures, tests, and root linter commands remain usable without an application import cycle.
  - **Acceptance Criteria:** AC-02, AC-03, AC-15.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** a clean checkout, Node.js `24.19.0`, npm `11.17.0`, Git `2.55.0`, and the committed `package-lock.json`, **WHEN** dependencies are installed with `npm ci` and the developer runs `npm run check` from the repository root, **THEN** the command runs the application, F00, and spec-linter build/test gates and exits `0` only when all pass; it does not require `TYPESAFE_API_KEY`, GitHub credentials, an AI provider, or a product-service/network call during the check. If Git is missing or unsupported, the root check exits non-zero with machine-readable `GIT_UNAVAILABLE` and installation/PATH remediation. Dependency download during installation may use the configured package registry/cache; the check itself is offline with respect to product services.

- **AC-02:** **GIVEN** the existing F00 workspace, tracked generated validation schema, fixtures, and tests, **WHEN** F01's aggregate `npm run check` runs, **THEN** F00's public exports and conformance tests pass unchanged, a read-only schema-drift verifier compares generated bytes with the tracked schema without writing it, the root check does not write the tracked schema, pre-check and post-check schema bytes and `git status --short` are identical, and no desktop build output overwrites F00 artifacts. Explicit `npm run generate:validation-schema` is the only schema-writing command and is not invoked by the normal root check. An implementation test retains a check/delete race against disposable verifier output and refuses deletion when ownership or canonical containment changes.

- **AC-03:** **GIVEN** the repository root and the standalone `tools/spec-linter` workspace, **WHEN** its build/test scripts and the documented root commands are invoked with repository-relative paths such as `Specs/application_overview.md`, absolute paths, or direct workspace-relative paths, **THEN** the root wrapper normalizes each path against the repository root before delegating, direct workspace invocation remains independently addressable, no `tools/spec-linter/Specs` lookup occurs, and the linter continues to require its own explicit credential only when a linter run is intentionally requested.

- **AC-04:** **GIVEN** a successful production build on Windows, **WHEN** the packaged unpacked artifact is launched in the smoke mode, **THEN** the Electron main process loads the React renderer, the renderer displays a keyboard-readable startup status, and the test harness can observe readiness without using GitHub, SQLite, a provider, or a persistent application database.

- **AC-05:** **GIVEN** source or dependency-graph rules are evaluated, **WHEN** a renderer module imports Node built-ins, Electron, filesystem/process APIs, a future provider SDK, or an undeclared preload symbol, **THEN** the type/lint/architecture check fails before packaging; shared code imported by the renderer remains platform-neutral and serializable.

- **AC-06:** **GIVEN** the F01 shell is built, **WHEN** its preload entry is inspected and the smoke shell is launched, **THEN** preload is a typed no-op/placeholder boundary with no unvalidated application IPC or secret access, `nodeIntegration` is disabled, context isolation is enabled, and the renderer has no direct privileged API. The validated allowlisted IPC surface is explicitly deferred to F04.

- **AC-07:** **GIVEN** the production package command completes, **WHEN** it targets the F01 artifact mode, **THEN** `release/` contains a launchable unpacked Windows-compatible Electron application with main, preload, renderer, and asset files, and no installer, code-signing operation, update channel, credential, `.env` file, or local database is produced. The smoke harness gives Electron a unique harness-owned user-data/cache directory and a sanitized child environment, and a rerun replaces only the ignored build output and owned temporary directory.

- **AC-08:** **GIVEN** a source file has a TypeScript, lint, or formatting violation, **WHEN** the corresponding root check runs, **THEN** it exits non-zero and identifies the offending workspace/file; a successful check verifies formatting rather than silently rewriting source in CI.

- **AC-09:** **GIVEN** an application unit or integration test is run in CI or locally, **WHEN** it uses the foundation harness, **THEN** clocks, environment values, filesystem roots, and network/provider calls are injectable or blocked, child processes receive only an allowlisted environment with `TYPESAFE_API_KEY`, GitHub tokens, AI-provider keys, and recognized `*_TOKEN`/`*_SECRET`/`*_PASSWORD`/`*_API_KEY` names removed, test failures and cancellation produce non-zero/aborted evidence, and one test's state cannot leak into another test's fixture.

- **AC-10:** **GIVEN** a test requests a temporary Git repository, **WHEN** Git is available, **THEN** the harness creates a repository beneath a unique temporary root, configures synthetic identity, can create deterministic commits/branches/refs, returns its absolute path and cleanup handle, and never runs a command in the developer's normal workspace or pushes to a remote. **WHEN** Git is unavailable, **THEN** it fails explicitly with `GIT_UNAVAILABLE` and remediation rather than falling back or skipping.

- **AC-11:** **GIVEN** a fixture or smoke test succeeds, fails, throws, or is cancelled, **WHEN** teardown runs, **THEN** the harness verifies an ownership marker, canonical containment under its unique temporary root, and absence of symlink/junction/reparse-point substitution before deleting anything; it removes only its own directory when safe, reports cleanup failures distinctly, and a subsequent test can create a fresh fixture without relying on prior process state.

- **AC-12:** **GIVEN** the same fixture inputs, runtime versions, and test seed, **WHEN** the harness is run repeatedly or after an interrupted run, **THEN** it produces the same deterministic Git/ref assertions and does not reuse stale fixture paths, developer credentials, or remote state; a missing, replaced, or reparse-point-owned path is refused rather than recursively deleted.

- **AC-13:** **GIVEN** a missing entry file, unsupported runtime, blocked Electron launch, failed dependency boundary, or packaging error, **WHEN** the production smoke/build command runs, **THEN** it exits non-zero, emits a concise actionable diagnostic to the test/CI output, and leaves no success marker that could be mistaken for a usable application. A normal test-controlled shell close is distinct from a startup failure.

- **AC-14:** **GIVEN** the primary Windows host or a CI host with a supported headless display arrangement, **WHEN** the production artifact smoke test runs, **THEN** it launches the artifact with a hidden/test-controlled window, waits for renderer readiness with a bounded timeout, and exits deterministically; Linux headless CI uses the documented Xvfb wrapper, while an unavailable display arrangement fails rather than silently skipping. The startup status uses semantic HTML and is keyboard-readable.

- **AC-15:** **GIVEN** a scope-guard test examines the F01 dependency graph and outputs, **WHEN** the root check runs, **THEN** F01 has no SQLite schema or repository, GitHub client, watcher/scheduler, tray/notification/deep-link service, persistent background lifecycle, production validated IPC, provider adapter/invocation, worktree manager, publication path, or installer/signing/update behavior. Those capabilities remain available for their named downstream features.

- **AC-16:** **GIVEN** the production smoke page is ready, **WHEN** the accessibility probe runs, **THEN** `document.title` is exactly `PRMonitor`, the page contains one visible `h1` and a `role="status"` element with `aria-live="polite"` and `data-prmonitor-ready="true"`, the focusable elements appear in the declared DOM order, pressing `Tab` reaches the skip link before the startup status target, pressing `Enter` on that link moves focus to the status target, and the same assertions pass under emulated `forced-colors: active` without relying on color alone.

- **AC-17:** **GIVEN** the committed CI workflow runs on `windows-latest` and `ubuntu-latest` with Node.js `24.19.0`, npm `11.17.0`, and Git `2.55.0`, **WHEN** each job runs `npm ci`, Windows runs `npm run check`, and Ubuntu runs `xvfb-run --auto-servernum --server-args="-screen 0 1280x720x24" npm run check`, **THEN** both jobs exercise the same root gates, the Windows job launches the production artifact directly, the Ubuntu job launches it through Xvfb, and missing Git, display, readiness, or child-exit evidence fails the job rather than being skipped.

- **AC-18:** **GIVEN** the root semantic-linter commands are invoked from `D:\git\PRMonitor` (or any repository checkout root), **WHEN** the caller supplies repository-relative PRD/PLAN/overview paths, **THEN** the commands complete against those exact files without `ENOENT`, and a regression test covers both the root wrapper and direct workspace invocation after npm's workspace working-directory change.

- **AC-19:** **GIVEN** the final F01 PRD contains no application-ID mappings, **WHEN** the application-coverage linter runs against `Specs/application_overview.md` and this PRD, **THEN** the evidence gate records exactly `0 covered`, `0 missing`, `70 not-applicable`, and `0 unresolved needs-review`; any covered or missing result fails the gate and requires mapping/spec correction, and any needs-review result requires a documented human disposition followed by a clean rerun before implementation completion.

## Functional Requirements

### FR-01: Root workspace and compatibility contract

- FR-01.1: The repository SHALL add the application as the `apps/desktop` workspace while retaining `tools/spec-linter` and `packages/validation-contract` as separate workspaces.
- FR-01.2: The root workspace SHALL expose deterministic `build:desktop`, `test:desktop`, and `check:desktop` commands and aggregate them with the existing F00 and spec-linter gates through root `build`, `test`, and `check` commands.
- FR-01.3: Root scripts SHALL resolve workspace paths from a clean repository checkout and SHALL not depend on an IDE, a globally installed Electron, a developer's local application state, or an uncommitted file.
- FR-01.4: F01 SHALL preserve F00's package name, public exports, generated schema artifact, fixtures, observable behavior, and conformance tests without copying or reimplementing the validation contract; F01 MAY refactor build/check scripts to add a read-only schema-drift verification step while retaining explicit schema generation as the only schema-writing command, and the normal root `npm run check` SHALL NOT write the tracked schema. Tests SHALL prove tracked-schema bytes and `git status` are unchanged before and after normal check.
- FR-01.5: F01 SHALL preserve the standalone spec-linter workspace, its direct workspace command behavior, and its independent build/test boundary; the desktop application SHALL not import the linter at runtime.
- FR-01.6: Root `lint:prd-plan` and `lint:application-coverage` wrappers SHALL normalize repository-relative, absolute, and direct workspace-relative document paths before delegating, and SHALL have regression tests for npm workspace working-directory changes.

### FR-02: Main, preload, renderer, and shared boundaries

- FR-02.1: The application SHALL have explicit source boundaries at `apps/desktop/src/main`, `apps/desktop/src/preload`, `apps/desktop/src/renderer`, and `apps/desktop/src/shared` with separate compile/build entry points.
- FR-02.2: The main process SHALL be the shell composition root, while the renderer SHALL remain a replaceable view for F01 startup state and SHALL not own long-running work or authoritative state.
- FR-02.3: Renderer code SHALL not import Node built-ins, Electron modules, filesystem/process APIs, provider SDKs, or secret-bearing configuration; static boundary checks SHALL fail closed when it does.
- FR-02.4: F01's preload entry SHALL expose only a typed no-op/placeholder contract, or no capabilities at all, and SHALL not add an unvalidated IPC channel; F04 SHALL own the later validated allowlisted IPC surface.
- FR-02.5: Shared code intended for renderer use SHALL be platform-neutral, serializable, and free of Electron, Node privileged APIs, GitHub, SQLite, Git, and provider imports.
- FR-02.6: The application SHALL keep the eventual Codex SDK dependency behind a provider-adapter boundary; F01 SHALL not invoke it or use provider output to determine shell/test state. The static boundary SHALL allow the SDK only in the single F15 Codex adapter module once F15 is implemented, and SHALL continue to reject imports from every other main, shared, preload, renderer, persistence, Git, validation, review, synchronization, and publication module.

### FR-03: Production shell and packaging-friendly artifact

- FR-03.1: The application SHALL produce a production-mode Electron build with a React renderer from the `apps/desktop` workspace.
- FR-03.2: F01 SHALL use an Electron-specific Vite bundling configuration and `electron-builder` in unpacked `--dir` mode to create a launchable artifact under the ignored `release/` directory; the artifact SHALL not be an installer.
- FR-03.3: The production smoke mode SHALL launch the built artifact with a unique harness-owned user-data/cache directory and sanitized child environment, render a minimal semantic startup status, emit a nonce-bound `PRMONITOR_SMOKE_READY:<nonce>` line only after the expected DOM readiness probe passes, and terminate only through a test-controlled close or a bounded failure path.
- FR-03.4: Packaging metadata SHALL identify the application and entry points without requiring code-signing certificates, installer credentials, update services, GitHub access, a local database, or a user-specific path.
- FR-03.5: Build and smoke failures SHALL be represented by non-zero process exit and actionable diagnostics; a test-controlled close SHALL not be reported as a startup failure.

### FR-04: Deterministic automated harnesses and temporary Git fixtures

- FR-04.1: The foundation SHALL provide strict TypeScript, lint, and format-check commands whose CI mode verifies source rather than silently rewriting it.
- FR-04.2: The foundation SHALL provide unit and integration test entry points with isolated temporary directories, controlled environment/time, bounded subprocess behavior, and deterministic non-zero failure reporting.
- FR-04.3: The foundation SHALL provide a temporary Git-repository fixture helper that initializes synthetic identity, creates deterministic commits/branches/refs, returns cleanup ownership, and never targets a developer workspace or remote.
- FR-04.4: The fixture helper and root `npm run check` SHALL check for Git `2.55.0` availability before Git-dependent gates and SHALL fail with machine-readable `GIT_UNAVAILABLE` plus installation/PATH remediation when Git is absent or unsupported; they SHALL never silently skip or substitute a non-Git implementation.
- FR-04.5: Fixture setup and teardown SHALL be idempotent for one fixture owner, safe after test failure/cancellation, and shall report cleanup failure separately from the test assertion failure; before recursive deletion it SHALL verify an ownership marker, canonical containment, and absence of symlink/junction/reparse-point substitution, refusing deletion when any check is uncertain.
- FR-04.6: Production-check tests SHALL prove the shell/build boundaries without requiring GitHub, SQLite, an AI provider, secure credential storage, or network access to a product service.

### FR-05: Reproducible runtime dependencies and CI handoff

- FR-05.1: The application manifest SHALL pin these tested exact versions, and the committed lockfile SHALL record their complete dependency graph: Node.js `24.19.0` with npm `11.17.0`; Electron `44.4.3`; `electron-vite` `5.0.0`; Vite `7.3.6`; `@vitejs/plugin-react` `5.0.4`; React and `react-dom` `19.3.0`; TypeScript `5.9.3`; ESLint `10.11.0` with `@eslint/js` `10.0.1` and `typescript-eslint` `8.70.0`; Prettier `3.9.8` with `eslint-config-prettier` `10.1.8`; Vitest `5.0.1`; `@types/node` `24.13.6`; `@types/react` and `@types/react-dom` `19.3.0`; `tabbable` `6.5.0`; and the unused, boundary-guarded `@openai/codex-sdk` `0.155.1`. No F01 implementation may proceed with a missing or range-only value.
- FR-05.2: The repository SHALL declare and check Node.js `24.19.0`, npm `11.17.0`, Git `2.55.0`, Electron `44.4.3`, and Windows/Electron compatibility assumptions used by the desktop build; unsupported runtimes or missing Git SHALL fail with an actionable diagnostic before packaging or a successful root check.
- FR-05.3: Root `npm run check` SHALL be CI-safe and offline with respect to product services: it SHALL not read `TYPESAFE_API_KEY`, contact Typesafe, GitHub, an AI provider, or a remote application service. Specification linting SHALL remain an explicit separate command.
- FR-05.4: Build/test/package scripts SHALL not print credentials, inherit uncontrolled secret values into child processes, embed local paths or environment values in committed artifacts, or write outside declared ignored output/temporary roots; child environments SHALL remove `TYPESAFE_API_KEY`, GitHub credentials, AI-provider credentials, and recognized secret-name variants.
- FR-05.5: The foundation SHALL include a clean-checkout gate that exercises aggregate build, tests, production artifact smoke, F00 preservation, and spec-linter independence in CI without changing checklist state or spec documents.
- FR-05.6: The repository SHALL provide an executable CI workflow at `.github/workflows/ci.yml` with `windows-latest` and `ubuntu-latest` jobs using Node.js `24.19.0`/npm `11.17.0` and Git `2.55.0`; the Windows job SHALL run `npm ci` then `npm run check`, and the Ubuntu job SHALL run `npm ci` then `xvfb-run --auto-servernum --server-args="-screen 0 1280x720x24" npm run check`. The root check SHALL fail with `GIT_UNAVAILABLE` if the required Git version is absent or unsupported.
- FR-05.7: The final application-coverage evidence gate SHALL assert exactly `0 covered`, `0 missing`, `70 not-applicable`, and `0 unresolved needs-review` for F01; a covered or missing result SHALL block completion for mapping/spec correction, and a needs-review result SHALL block completion until its human disposition is recorded and the linter is rerun cleanly.

## Non-Functional Requirements

- **NFR-01: Reproducibility** - A clean checkout with the same lockfile, supported runtime, and test inputs SHALL produce the same pass/fail decisions and dependency graph; generated output SHALL be disposable and ignored.
- **NFR-02: Security boundary** - The renderer SHALL run without Node integration, preload SHALL not expose secrets or unvalidated capabilities, and tests/builds SHALL not require publication credentials.
- **NFR-03: Isolation** - Automated tests SHALL be safe to run concurrently or repeatedly without mutating the developer's normal workspace, remote repository, SQLite state, or OS credential store.
- **NFR-04: Diagnosability** - Build, smoke, dependency, Git-availability, and cleanup failures SHALL include workspace/stage, machine-readable reason where applicable, and a next action without dumping environment secrets.
- **NFR-05: Windows-first portability** - The production artifact and smoke path SHALL work on the primary Windows platform; source boundaries SHALL keep platform-specific shell behavior replaceable for later macOS/Linux support.
- **NFR-06: Accessibility** - The minimal startup surface SHALL use document title `PRMonitor`, semantic heading/status elements, a declared skip-link-to-status focus order, keyboard-operable focus movement, and forced-colors/high-contrast styling that does not rely on color alone.
- **NFR-07: Resource bounds** - Smoke launches, test subprocesses, and fixture cleanup SHALL have bounded timeouts and shall terminate their own children on cancellation or failure.
- **NFR-08: Maintainability** - Each source boundary SHALL have one clear public entry contract, and static checks SHALL make forbidden imports or workspace coupling visible before runtime.

## Invariants

- **INV-01:** The Electron main process is the only F01 composition root; renderer code is never authoritative for future durable state or long-running work.
- **INV-02:** Renderer code cannot reach Node/Electron privileged APIs except through a future F04 validated preload contract; F01's placeholder grants no product capability.
- **INV-03:** The Codex SDK and all provider-specific behavior remain behind a provider adapter boundary; F01 never invokes a provider or gives it publication authority.
- **INV-04:** F00's validation contract and the standalone spec-linter remain separate workspaces and their checked-in artifacts are not reinterpreted, copied, or silently changed by F01.
- **INV-05:** No F01 script or test stores, prints, embeds, or sends credentials, API keys, local environment values, or unredacted secret-shaped data.
- **INV-06:** Root check outcomes come from deterministic compiler, linter, test, build, smoke, and fixture evidence; AI/model prose cannot make a check pass.
- **INV-07:** Test Git operations are confined to a harness-owned temporary directory and never commit, push, reset, delete, or overwrite a developer's normal worktree or remote.
- **INV-08:** F01 does not claim any later product behavior merely because a package, interface, placeholder, or smoke test exists; downstream features must provide their own observable evidence.

## Out of Scope

- Persistent background watcher, tray icon, native notifications, deep links, shutdown semantics, renderer-window recreation, and Windows virtual-desktop behavior - F04 and F19.
- Validated production IPC, renderer command APIs, domain IDs/state machines, and transition enforcement - F02 and F04.
- SQLite, migrations, durable repositories, restart recovery, and application-owned durable state - F03.
- GitHub authentication/client behavior, polling, review event normalization, batching, and managed PRs - F05-F12.
- Production Git/worktree isolation, diff attribution, validation process execution, and user-worktree change choices - F13-F14 and later review/synchronization features.
- Provider-neutral AI schemas, Codex adapter, model invocation, streaming, structured output, and AI execution policy - F15-F17.
- Review bundles, UI inbox/review screens, notifications, conversations, publication, branch synchronization, and all application acceptance criteria as user-facing behavior.
- Threat-model hardening and operational safeguards beyond the F01 static privilege/secret checks - F29.
- Signed installers, update channels, release automation, distribution metadata, and code-signing credentials - F30.
- Automatic discovery of validation commands, GitHub webhooks, autonomous publication, force push, automatic rebasing, and any MVP non-goal listed in the application overview.

## Product Decisions

- **PD-01: Foundation is not a product milestone** - F01's success is a launchable shell plus trustworthy engineering evidence; no application `APP-AC-*` is closed until its owning feature supplies the complete behavior.
- **PD-02: Windows is the primary F01 runtime** - The shell and smoke path must work on Windows, while source boundaries avoid preventing later macOS/Linux support; F01 does not promise cross-platform release artifacts.
- **PD-03: No product service is needed to run the root check** - A developer or CI system can validate the foundation without GitHub, Typesafe, an AI provider, or user credentials; specification linting is opt-in and separate.
- **PD-04: Temporary Git fixtures are synthetic** - Tests must exercise real Git behavior when Git is installed, but fixture repositories contain synthetic identity and no remote or developer worktree.
- **PD-05: F15 receives one narrow SDK exception** - F01 supplies the package, runtime, test, and import-boundary foundation; F15 owns the only Codex SDK import/invocation. The exception is limited to the main-process adapter and does not broaden renderer/shared privileges or give F01 AI authority.

## Implementation Decisions

- **IMP-01: Application workspace location** - Add `apps/desktop` as the only F01 application workspace. Its source directories are `src/main`, `src/preload`, `src/renderer`, and `src/shared`; future domain/persistence packages may be added by their owning features.
- **IMP-02: Bundler and artifact mode** - Use `electron-vite` to build the three Electron entry surfaces and React renderer, and `electron-builder` with the `dir` target to produce an unpacked production artifact under `release/`. F01 does not produce an installer or sign binaries.
- **IMP-03: Typed preload placeholder** - F01 includes a compile-time preload API type and a buildable no-op/empty preload entry. F04 owns `contextBridge`, schema validation, channel allowlisting, and runtime IPC; F01's renderer must not depend on a privileged bridge to render its startup status.
- **IMP-04: Production smoke harness** - Build output is launched from the packaged artifact with `PRMONITOR_SMOKE=1`, a random `PRMONITOR_SMOKE_NONCE`, a unique `PRMONITOR_USER_DATA_DIR`, and an allowlisted child environment. The hidden window loads the local page, verifies the title/heading/status/accessibility probes, writes exactly `PRMONITOR_SMOKE_READY:<nonce>` to stdout, flushes, and exits with code `0`; missing/duplicate/mismatched readiness, unexpected exit, bounded-output overflow, or a 30-second timeout is failure. Windows CI runs it directly; Linux headless CI wraps it with Xvfb. The harness owns and safely deletes the user-data/cache directory only after containment/ownership/reparse checks.
- **IMP-05: Static boundary enforcement** - Use TypeScript project boundaries plus lint/import restrictions to reject renderer-to-privileged imports, shared-to-platform imports, application-to-linter imports, and provider imports outside the future adapter location.
- **IMP-06: Tested dependency set** - Use Node.js `24.19.0` with npm `11.17.0` and Git `2.55.0`; Electron `44.4.3`; `electron-vite` `5.0.0`; Vite `7.3.6`; `@vitejs/plugin-react` `5.0.4`; React/`react-dom` `19.3.0`; TypeScript `5.9.3`; ESLint `10.11.0`, `@eslint/js` `10.0.1`, `typescript-eslint` `8.70.0`; Prettier `3.9.8`, `eslint-config-prettier` `10.1.8`; Vitest `5.0.1`; `@types/node` `24.13.6`; `@types/react`/`@types/react-dom` `19.3.0`; `tabbable` `6.5.0`; and `@openai/codex-sdk` `0.155.1` as an unused, boundary-guarded dependency. These values were observed from the public npm registry and local Git runtime on 2026-09-19; implementation must verify the exact values and peer compatibility before proceeding, and any change requires an updated approved plan.
- **IMP-07: No application-side network** - F01 tests use injected ports/fakes and block product-service network access. The package manager may use the configured registry/cache during `npm ci`, but root check and smoke do not contact product services.
- **IMP-08: Git-unavailable behavior** - The fixture helper checks `git --version` through a controlled executable lookup and returns `GIT_UNAVAILABLE` with installation/PATH remediation. Tests that require real Git fail explicitly; they are not marked passed or silently downgraded.
- **IMP-09: Root-relative spec-linter wrapper** - Root `lint:prd-plan` and `lint:application-coverage` invoke a repository-root wrapper that canonicalizes every document argument before calling the standalone workspace CLI. The wrapper is tested from the repository root with relative and absolute paths and directly from the workspace with workspace-relative paths.
- **IMP-10: Read-only F00 schema drift check** - F01 may change F00 build/check orchestration so compilation and `verify:schema` compare generated JSON Schema in memory or a disposable temporary directory against `Specs/contracts/validation-profile.v1.schema.json` without rewriting the tracked file. The root `npm run check` must not write that tracked file. `generate:validation-schema` remains the explicit opt-in write command and the only schema writer; tests snapshot tracked-schema bytes and `git status --short` before and after normal check, and retain a check/delete race that refuses cleanup when temporary-output ownership or canonical containment changes. F00 exports, behavior, fixtures, schema meaning, and tests remain unchanged.
- **IMP-11: Sanitized child processes and safe cleanup** - Smoke/test children receive only the documented allowlist (`PATH`, platform loader variables, locale, `CI`, and explicit PRMonitor test variables); `TYPESAFE_API_KEY`, GitHub/AI credentials, `NODE_OPTIONS`, and recognized secret-name variants are removed. Every cleanup first verifies an owner marker, canonical containment, and no symlink/junction/reparse point, and refuses uncertain deletion.
- **IMP-12: Application-coverage completion gate** - The final F01 evidence report must show exactly `0 covered`, `0 missing`, `70 not-applicable`, and `0 unresolved needs-review`. A covered or missing outcome blocks completion and triggers a mapping/spec correction; a needs-review outcome blocks completion until a human disposition is recorded and the linter is rerun with no unresolved review.
- **IMP-13: F15 import-guard handoff** - When F15 is implemented, replace the current blanket `@openai/codex-sdk` restriction with one explicit allowlist exception for `src/main/ai/codex-adapter.ts` (or the approved equivalent). Keep the negative import scan for all other source boundaries and record the adapter-only result in the F15 conformance evidence.

## Testing Decisions

- **TST-01: Preserve existing workspace evidence** - Run F00's package build/tests and spec-linter's build/tests as independent gates; run a read-only F00 schema-drift comparison, snapshot tracked-schema bytes and `git status --short` before/after normal check, and ensure no app import cycle exists. The root `npm run check` must not write the tracked schema. Explicit schema generation remains a separate command and is never part of the normal root check. Exercise and retain a check/delete race against disposable verifier output and refuse deletion on ownership/containment changes.
- **TST-02: Test the source boundaries statically** - Import-restriction tests and TypeScript compilation are the primary evidence for privilege separation; F01 does not pretend a no-op preload proves F04's future IPC security.
- **TST-03: Smoke the production artifact, not only dev mode** - The desktop test launches the unpacked `electron-builder --dir` output with a 30-second nonce-bound `PRMONITOR_SMOKE_READY:<nonce>` protocol, an owned temporary Electron user-data/cache directory, bounded stdout/stderr, and a sanitized child environment. Dev-server behavior is not sufficient evidence.
- **TST-04: Use real Git in temporary fixtures** - Fixture tests execute real Git `2.55.0` commands when available, set synthetic identity explicitly, and fail with `GIT_UNAVAILABLE` when unavailable or unsupported. The root check has the same fail-closed prerequisite. No test creates or uses a remote.
- **TST-05: Test cancellation/restart at the harness boundary** - Test teardown and the test-controlled shell close are exercised after success, assertion failure, launch timeout, and cancellation; ownership-marker, canonical-containment, symlink/junction/reparse refusal, child termination, and stale-user-data tests are mandatory. Persistent application restart recovery belongs to F03/F04.
- **TST-06: Accessibility evidence is executable** - The production smoke probe asserts `document.title === "PRMonitor"`, heading/status semantics, skip-link and status-target focus order, Tab/Enter behavior, and the same assertions under emulated `forced-colors: active`; a screenshot or model claim is not sufficient.
- **TST-07: Root command path regression** - Execute both semantic-linter root commands with `Specs/...` paths from the repository root and with absolute paths, plus direct workspace commands with `../../Specs/...`; assert no `ENOENT` and no path is resolved beneath `tools/spec-linter/Specs`.
- **TST-08: CI matrix is executable** - Validate `.github/workflows/ci.yml` on `windows-latest` and `ubuntu-latest` with Node `24.19.0`/npm `11.17.0` and Git `2.55.0`; Windows runs `npm ci` then `npm run check`, Ubuntu runs the same under the exact Xvfb command in AC-17, and a missing/unsupported Git fixture proves `GIT_UNAVAILABLE` is non-passing.
- **TST-09: Coverage gate is exact** - Run the final no-mapping application-coverage lint and assert exactly 0 covered, 0 missing, 70 not-applicable, and 0 unresolved needs-review; any deviation is a completion failure, with human dispositions and clean reruns required for review results.
- **TST-10: Do not test later product behavior here** - SQLite, polling, tray, notifications, virtual desktops, provider calls, validation command execution, publication, and Review Bundle UI are tested by their owning features.

## Proposed Modules

- **MOD-01: Desktop workspace package** - Owns the `apps/desktop` package metadata, source entry points, scripts, and application-only dependencies.
- **MOD-02: Main shell entry** - Owns production Electron startup, window creation for the minimal smoke surface, bounded test-mode close, and startup diagnostics; it does not own durable services.
- **MOD-03: Typed preload contract** - Owns the no-op/placeholder type and build entry that F04 can extend; it exposes no F01 product capability.
- **MOD-04: Renderer startup surface** - Owns the minimal semantic, keyboard-readable React status view and no privileged imports.
- **MOD-05: Shared foundation contracts** - Owns serializable shell/build/test types and constants that can be imported by renderer-safe code; it has no platform or provider dependency.
- **MOD-06: Build and package configuration** - Owns electron-vite and unpacked electron-builder configuration, output containment, and smoke metadata.
- **MOD-07: Deterministic test harness** - Owns environment/time/network controls, bounded process helpers, synthetic Git fixture lifecycle, cleanup ownership, and machine-readable diagnostics.
- **MOD-08: Boundary and compatibility checks** - Owns static import restrictions, F00/spec-linter preservation assertions, dependency/version checks, and root clean-checkout gates.

## Workflows

### Workflow 1: Clean-checkout foundation check

```text
1. Developer checks out the repository at a clean revision.
2. npm ci installs exactly the committed dependency graph.
3. npm run check invokes application, F00, and spec-linter build/test gates.
4. Static boundary checks run before production packaging.
5. The desktop workspace builds an unpacked release artifact.
6. The smoke harness launches the artifact with a hidden test window.
7. Renderer readiness is observed within a bounded timeout.
8. The harness closes the test window/process and reports success.
9. CI discards ignored release and temporary fixture output.
```

### Workflow 2: Temporary Git fixture

```text
1. A test requests a fixture from the harness.
2. The harness verifies Git availability and returns GIT_UNAVAILABLE with remediation if absent.
3. The harness creates a unique temporary root and initializes a repository there.
4. It sets synthetic author/committer identity and creates deterministic commits and refs.
5. The test runs only against the returned path and never configures a remote.
6. Teardown removes only the fixture-owned root, even after assertion failure or cancellation.
7. A cleanup failure is reported separately and never converted into a passing test.
```

### Workflow 3: F01 boundary handoff

```text
1. F01 exposes the main/preload/renderer/shared source boundaries and a typed no-op preload contract.
2. F04 adds validated IPC and persistent lifecycle behavior without moving authority into the renderer.
3. F02 adds provider-neutral domain contracts and deterministic state machines.
4. F03 adds SQLite repositories and restart-safe durable state.
5. F15 adds the Codex adapter behind the provider boundary using the pinned SDK version.
6. F29 and F30 extend security/release hardening without weakening the F01 root gates.
```
