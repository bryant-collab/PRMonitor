<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single layer. The goal of vertical layers is to provide a visible and testable result when the work is complete.
-->

# Plan: Application workspace and engineering foundation

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** `Specs/application_workspace_and_engineering_foundation_PRD.md`
>
> **Last revalidated against:** `Specs/application_overview.md` revision 2026-09-19, F00 PRD/PLAN revision 2026-09-19, and F01 PRD revision 2026-09-19
>
> **Entry/readiness gates:** F00 is implemented and its package behavior/tests and read-only generated-schema drift check pass; the standalone spec-linter build/tests pass; Node.js `24.19.0`, npm `11.17.0`, and Git `2.55.0` are available; the exact registry-verified dependency set below is available; and CI provides both a Windows production-artifact smoke lane and an Ubuntu Xvfb lane. The implementation cannot proceed with range-only or missing application dependency values, and the root check must fail with `GIT_UNAVAILABLE` when the required Git version is absent or unsupported.
>
> This PLAN cannot change product requirements. Resolve contradictions in the
> owning PRD before implementation. Revalidate this draft when implementation
> begins and remove or archive it when the work is complete.

## Implementation Boundary

F01 adds one application workspace at `apps/desktop` beside the existing `tools/spec-linter` and `packages/validation-contract` workspaces. It establishes `src/main`, `src/preload`, `src/renderer`, and `src/shared` boundaries, strict TypeScript/lint/format gates, an Electron-specific Vite build, an unpacked `electron-builder --dir` production artifact, a smoke harness, temporary real-Git fixtures, exact dependency pinning, root-relative semantic-linter path normalization, and clean-checkout root scripts.

The F01 artifact is a minimal React startup surface. The preload entry is typed and buildable but no-op/empty; F01 does not introduce validated runtime IPC. The smoke harness uses `PRMONITOR_SMOKE=1`, a nonce-bound `PRMONITOR_SMOKE_READY:<nonce>` stdout protocol, a unique owned Electron user-data/cache directory, a 30-second timeout, bounded output, and a sanitized child environment. The root check includes application, F00, and spec-linter build/test gates but does not run either Typesafe-backed specification linter unless a user explicitly invokes those commands with the approved runtime credential.

### Exact tested toolchain

The implementation uses these exact values, selected from public npm registry metadata queried on 2026-09-19. The implementer must rerun the deterministic compatibility command below and stop for review if any value, engine, or peer range differs before package manifests or the lockfile are changed.

| Role | Exact value |
|---|---|
| Node.js / npm baseline | `24.19.0` / `11.17.0` |
| Git prerequisite | `2.55.0` (platform suffix allowed; semantic version must be `2.55.0`) |
| Electron | `44.4.3` |
| Electron bundler | `electron-vite@5.0.0` |
| Vite / React plugin | `vite@7.3.6` / `@vitejs/plugin-react@5.0.4` |
| React | `react@19.3.0`, `react-dom@19.3.0` |
| TypeScript | `typescript@5.9.3` |
| Lint | `eslint@10.11.0`, `@eslint/js@10.0.1`, `typescript-eslint@8.70.0`, `eslint-config-prettier@10.1.8` |
| Format | `prettier@3.9.8` |
| Test | `vitest@5.0.1` |
| Types / accessibility probe | `@types/node@24.13.6`, `@types/react@19.3.0`, `@types/react-dom@19.3.0`, `tabbable@6.5.0` |
| Unused F01 provider boundary dependency | `@openai/codex-sdk@0.155.1` |
| Packager | `electron-builder@26.15.3` |

Compatibility evidence command (run from the repository root, without credentials) is:

```powershell
node --version
npm --version
git --version
npm view node@24.19.0 version --json
npm view npm@11.17.0 version engines --json
npm view electron@44.4.3 version engines --json
npm view electron-vite@5.0.0 version engines peerDependencies --json
npm view vite@7.3.6 version engines --json
npm view @vitejs/plugin-react@5.0.4 version engines peerDependencies --json
npm view react@19.3.0 version engines --json
npm view react-dom@19.3.0 version --json
npm view typescript@5.9.3 version engines --json
npm view eslint@10.11.0 version engines --json
npm view @eslint/js@10.0.1 version engines --json
npm view typescript-eslint@8.70.0 version engines peerDependencies --json
npm view prettier@3.9.8 version engines --json
npm view eslint-config-prettier@10.1.8 version --json
npm view vitest@5.0.1 version engines --json
npm view @types/node@24.13.6 version --json
npm view @types/react@19.3.0 version --json
npm view @types/react-dom@19.3.0 version --json
npm view tabbable@6.5.0 version engines --json
npm view electron-builder@26.15.3 version engines --json
npm view @openai/codex-sdk@0.155.1 version engines --json
```

The implementation-time compatibility gate must verify that `node --version`, `npm --version`, and `git --version` report Node `24.19.0`, npm `11.17.0`, and Git semantic version `2.55.0` (a platform suffix on Git is allowed), and that every registry query returns the exact value plus compatible engine/peer metadata. No implementation may replace the exact values with `latest`, a caret/range, or a silent fallback. The Codex SDK is an exact unused dependency in the app manifest and lockfile from F01 onward; only F15 may import or invoke it.

Do not add SQLite, migrations, persistent state, watcher/scheduler, GitHub, tray, notifications, deep links, virtual-desktop logic, production lifecycle recovery, validated IPC, domain state machines, Git worktree management, validation process execution, AI provider invocation/adapter logic, review/synchronization UI, publication, installer/signing/update behavior, or checklist changes. F01 directly owns no `APP-AC-*` criterion and must not claim one as complete merely because a package or smoke test exists.

## Proposed Vertical Slices

1. **Add the `apps/desktop` workspace and exact dependency/command contract.**
   - **Blocked by:** F00 package behavior/tests and standalone spec-linter build/test gates being green; the exact registry-verified versions above must pass the compatibility command before manifests are changed.
   - **Stories / requirements / acceptance criteria:** US-01, US-07; FR-01.1-FR-01.6; FR-05.1-FR-05.7; INV-03-INV-04; AC-01-AC-03, AC-15, AC-17-AC-19.
   - **Visible result:** A clean checkout recognizes `apps/desktop`; exact root commands (`npm run build`, `npm test`, `npm run check`) invoke the desktop, F00, and spec-linter gates; F00 and linter workspaces remain independently runnable; root semantic-linter commands accept `Specs/...` paths without workspace-`cwd` lookup errors.
   - **Durable records / external effects:** Updates only package manifests, lockfile, workspace configuration, and ignored build/test output. No application database, credentials, remote calls, Git repository, or checklist mutation.
   - **Failure / cancellation / restart:** Unsupported Node/npm, missing/unsupported Git, or dependency-resolution failure exits with workspace/version remediation; missing/unsupported Git returns `GIT_UNAVAILABLE` and cannot be treated as a successful root check. `npm run check` can be rerun idempotently after interruption; ignored outputs are disposable and no source file is rewritten by CI checks. The exact `@openai/codex-sdk@0.155.1` dependency is present in the app manifest/lockfile from this slice but any import or invocation fails the boundary check until F15.
   - **Exact evidence:** Run the compatibility command exactly as listed above, including the Git `2.55.0` check; `npm ci` from a clean checkout; `npm run build`, `npm test`, and `npm run check`; root script dry-run/path assertions; `npm ls --depth=0`/lockfile consistency check; exact-version manifest/lockfile check; F00 compile plus read-only schema verification and package tests with tracked-schema bytes and `git status --short` identical before/after; explicit `npm run generate:validation-schema` remains available but is not called by root check; standalone spec-linter build/tests; dependency-graph test showing no desktop-to-linter runtime import; root-relative and absolute semantic-linter path tests; a no-credential/no-product-network root-check run; final application-coverage evidence with exactly 0 covered, 0 missing, 70 not-applicable, and 0 unresolved needs-review.
   - **Exit criterion:** AC-01, AC-02, AC-03, AC-17, AC-18, and AC-19 pass from the repository root, with F00 public behavior/tests and schema meaning preserved, exact dependencies recorded, Git fail-closed behavior proven, and no definite workspace/compatibility/path-normalization failure.

2. **Establish static main/preload/renderer/shared boundaries and the minimal renderer.**
   - **Blocked by:** Slice 1.
   - **Stories / requirements / acceptance criteria:** US-03-US-04; FR-02.1-FR-02.6; FR-03.1, FR-03.3-FR-03.5; NFR-02, NFR-05, NFR-06, NFR-08; INV-01-INV-03; AC-04-AC-06, AC-13-AC-14, AC-16.
   - **Visible result:** The app source tree has separate main, preload, renderer, and renderer-safe shared entry points. The renderer displays a semantic startup status without direct privileged imports; the preload entry compiles as a typed no-op/placeholder.
   - **Durable records / external effects:** Adds source/build configuration and static-check rules only. No IPC channel, persistent state, OS integration, provider, GitHub, SQLite, or secret access is created.
   - **Failure / cancellation / restart:** Forbidden imports, missing entry points, unsupported runtime flags, or renderer readiness failure fail before packaging with file-oriented diagnostics. The smoke harness closes its test window/process on success, timeout, or cancellation; a later run starts from a fresh process and does not depend on prior state. The placeholder preload cannot become an unvalidated IPC escape hatch.
   - **Exact evidence:** TypeScript project compilation for each entry; import-restriction/architecture tests for renderer-to-Node/Electron, shared-to-platform, app-to-linter, and provider-outside-adapter edges; inspection test proving context isolation is enabled and node integration is disabled; preload contract test proving no application IPC capability; `document.title`, `h1`, `role=status`, `aria-live`, skip-link, `tabbable` order, Tab/Enter keyboard, and emulated `forced-colors: active` checks; startup-failure fixture; nonce-bound readiness test.
   - **Exit criterion:** AC-04, AC-05, AC-06, AC-13, AC-14, and AC-16 pass; F01 has no production validated IPC or persistent lifecycle claim.

3. **Build and smoke-test the unpacked production Electron artifact.**
   - **Blocked by:** Slice 2 and the exact Electron `44.4.3`/Node `24.19.0` compatibility gate.
   - **Stories / requirements / acceptance criteria:** US-03; FR-03.1-FR-03.5; FR-05.2-FR-05.6; NFR-01, NFR-04, NFR-05, NFR-07; INV-05-INV-06; AC-04, AC-07, AC-08, AC-13-AC-15, AC-17.
   - **Visible result:** `check:desktop` produces a launchable Windows-compatible unpacked artifact at ignored `release/`, launches it with `PRMONITOR_SMOKE=1`, a random nonce, an owned temporary user-data/cache directory, and a sanitized environment, observes exactly one `PRMONITOR_SMOKE_READY:<nonce>` line after the DOM probe, and exits `0`. Linux headless CI invokes the same test under the exact Xvfb command; Windows CI runs it directly.
   - **Durable records / external effects:** Produces only ignored `dist/`, `out/`, `release/`, bounded test logs, and a unique temporary user-data/cache directory. No installer, signature, update metadata, database, secure credential access, or product-service request.
   - **Failure / cancellation / restart:** Packaging, missing entry, unsupported runtime, display failure, readiness mismatch, duplicate/missing sentinel, bounded-output overflow, timeout at 30 seconds, unexpected process exit, or child-process leak is non-zero and actionable. The smoke harness terminates its own children on timeout/cancellation, safely removes its owned user-data directory only after marker/containment/reparse checks, and never converts a killed/failed process into success. A rerun cleans/replaces only its own ignored output and fresh temporary directory.
   - **Exact evidence:** `electron-vite@5.0.0` production build; `electron-builder@26.15.3 --dir` artifact inspection; package manifest/entry-point test; Windows artifact launch smoke; Ubuntu `xvfb-run --auto-servernum --server-args="-screen 0 1280x720x24" npm run check`; 30-second nonce/readiness/close timing test; output scan for `.env`, credential patterns, local absolute paths, and unexpected installer/update files; sanitized-environment assertion; rerun/idempotency test; no-product-network capture.
   - **Exit criterion:** AC-04, AC-07, AC-08, AC-13, AC-14, AC-15, and AC-17 pass; an unpacked shell is demonstrably launchable without claiming tray, background persistence, validated IPC, or product behavior.

4. **Add deterministic unit/integration tooling and temporary Git fixtures.**
   - **Blocked by:** Slices 1-2; Git must be present for real fixture tests, otherwise the expected explicit failure path is exercised.
   - **Stories / requirements / acceptance criteria:** US-02, US-05-US-06; FR-04.1-FR-04.6; FR-05.3-FR-05.4; NFR-01, NFR-03, NFR-04, NFR-07; INV-05-INV-07; AC-08-AC-12, AC-15, AC-18.
   - **Visible result:** Developers can run deterministic desktop unit/integration tests and request a temporary Git repository with synthetic commits/branches, cleanup ownership, and machine-readable diagnostics.
   - **Durable records / external effects:** Test reports and fixture logs remain under ignored output; fixture repositories are temporary and have no remote. No developer worktree, credential store, product database, or service is changed.
   - **Failure / cancellation / restart:** Missing Git returns `GIT_UNAVAILABLE` with installation/PATH remediation and fails the test; it never falls back or skips. Fixture setup/teardown is idempotent per owner, removes only owned paths after marker/canonical/reparse checks, reports cleanup failures separately, and recovers after assertion failure, cancellation, or test-run interruption. Child processes are bounded and terminated by the harness and do not inherit the linter key or other secrets.
   - **Exact evidence:** Type/lint/format failure table; isolated environment/time/network tests; sanitized-child-environment corpus including `TYPESAFE_API_KEY`; Git availability matrix; temporary repository fixture test covering init, synthetic identity, deterministic commits, branches, refs, and absolute path ownership; no-remote assertion; symlink/junction/reparse-point substitution and ownership-refusal tests; failure/cancellation cleanup tests; stale-path/repeated-run test; output/secret scan; concurrent fixture test; root-relative and direct-workspace semantic-linter path tests.
   - **Exit criterion:** AC-08, AC-09, AC-10, AC-11, and AC-12 pass, including the explicit Git-unavailable failure, without any test touching the developer workspace or remote.

5. **Prove clean-checkout handoff and preserve downstream boundaries.**
   - **Blocked by:** Slices 1-4.
   - **Stories / requirements / acceptance criteria:** US-01-US-07; all FR-01 through FR-05; all NFRs; all INV-01 through INV-08; AC-01-AC-19.
   - **Visible result:** `.github/workflows/ci.yml` runs the exact Windows and Ubuntu matrix commands, and CI or a clean local checkout produces one summary showing the aggregate root gates, F00/spec-linter preservation, read-only schema drift result, static import boundaries, production smoke result, fixture result, dependency pin status, semantic-linter path normalization, accessibility evidence, and explicit list of deferred downstream capabilities.
   - **Durable records / external effects:** CI retains only ordinary non-secret test/build reports under declared ignored/artifact paths. No checklist edit, spec publication, database, external service, or user worktree change.
   - **Failure / cancellation / restart:** Any gate failure blocks success and identifies the owning slice. Cancellation leaves no success marker; rerunning from a clean process is supported. An unavailable Windows display or Xvfb arrangement is an explicit environmental blocker, not a skipped smoke test. A clean checkout never relies on a prior build, fixture, user-data directory, or local secret.
   - **Exact evidence:** Fresh-checkout script with `npm ci` then root `npm run check` (including the Git `2.55.0` prerequisite and `GIT_UNAVAILABLE` failure path); app/F00/spec-linter build/test logs; read-only schema drift report plus explicit-generation smoke, with tracked-schema bytes and `git status --short` unchanged before/after and a check/delete race refusing unsafe cleanup; both spec-linter commands run separately after docs are final; root-relative and absolute path normalization report; clean-checkout dependency graph; forbidden-import report; Windows and Ubuntu/Xvfb package smoke reports; accessibility probe report; fixture/cleanup report; child-environment secret scan; exact application-coverage report showing 0 covered, 0 missing, 70 not-applicable, 0 unresolved needs-review; `git diff --check`; direct untracked-file whitespace scan; CI matrix results.
   - **Exit criterion:** Every F01 PRD requirement is covered by an executed check or named static contract, all AC-01 through AC-19 pass, the application-coverage gate is exactly 0 covered, 0 missing, 70 not-applicable, 0 unresolved needs-review, any covered/missing result triggers mapping/spec correction, any needs-review result has a documented human disposition and clean rerun, no definite linter invalid mapping remains, and the checklist item remains unchecked pending approval/implementation.

## Cross-Slice Verification and Handoff

- The exact owning PRD is `Specs/application_workspace_and_engineering_foundation_PRD.md`; this plan does not add product requirements or claim downstream behavior.
- The application workspace is `apps/desktop`. `tools/spec-linter` and `packages/validation-contract` remain separate workspaces with their existing package names, public exports, direct command intent, fixtures, and generated schema; F01 may refactor build/check orchestration for read-only schema verification.
- `npm run check` is the no-credential, no-product-network gate. Before its success path it verifies Node `24.19.0`, npm `11.17.0`, and Git semantic version `2.55.0`; absent/unsupported Git fails with `GIT_UNAVAILABLE`. Its exact sequence is `npm run check:desktop`, `npm run check:validation-contract`, and `npm run check:spec-linter`; the desktop check runs lint/format/build/test/smoke, validation-contract check runs compile/read-only-schema-drift/test, and spec-linter check runs build/test only. Specification linters remain explicit commands and resolve their approved runtime credential internally; credentials are never printed, committed, inherited by child smoke/test processes, or included in evidence.
- Root semantic-linter commands are exact and tested: `npm run lint:prd-plan -- Specs/<feature>_PRD.md Specs/<feature>_PLAN.md` and `npm run lint:application-coverage -- Specs/application_overview.md Specs/<feature>_PRD.md`. The root wrapper canonicalizes these paths before delegation; direct workspace calls use `../../Specs/...` and remain supported.
- The F01 shell uses `electron-vite@5.0.0` and `electron-builder@26.15.3 --dir` with the exact dependency set recorded above. F01 does not create installers, sign binaries, or publish release metadata; F30 owns those concerns.
- The preload entry is typed and no-op/empty. F04 must add validated `contextBridge`/IPC schemas and lifecycle authority without moving state into the renderer.
- The smoke test launches the production artifact with `PRMONITOR_SMOKE=1`, a random nonce, `PRMONITOR_USER_DATA_DIR`, a 30-second timeout, bounded output, the exact DOM/keyboard/forced-colors readiness probe, and a child environment allowlist. It emits exactly one `PRMONITOR_SMOKE_READY:<nonce>` line and exits zero only after readiness. Windows runs `npm ci` then `npm run check`; Ubuntu runs `npm ci` then `xvfb-run --auto-servernum --server-args="-screen 0 1280x720x24" npm run check`; unavailable display/readiness/child exit fails.
- Git fixture tests use real Git under unique temporary roots with synthetic identity and no remote. Missing Git is an actionable `GIT_UNAVAILABLE` failure, never a skip or fallback. Fixture and smoke cleanup refuses uncertain ownership, containment, symlink/junction/reparse-point paths before deletion.
- F00 build/check orchestration may change to compile plus read-only schema-drift verification; root `npm run check` must not write the tracked schema, `npm run generate:validation-schema` remains the explicit and only writer, and implementation tests snapshot pre/post schema bytes and `git status --short` plus retain a check/delete race that refuses unsafe cleanup. F00 public contract, behavior, schema meaning, fixtures, and tests are preserved.
- F02-F04, F13-F17, F29, and F30 must reuse the boundary, build, test, dependency, and security gates rather than weakening them.
- No F01 output closes an `APP-AC-*` criterion. The PRD coverage table intentionally contains no application-ID mappings; every portfolio criterion is deferred to its owning feature, even when F01 supplies a prerequisite package or test harness.
- Coverage evidence is an exact completion gate: the final no-mapping run must be `0 covered, 0 missing, 70 not-applicable, 0 unresolved needs-review`. Any covered or missing result fails completion and requires mapping/spec correction. Any needs-review result fails completion until a human disposition is documented and the linter is rerun with zero unresolved review; the existing APP-AC-13 disposition remains the explicit example if that low-confidence classification recurs.
