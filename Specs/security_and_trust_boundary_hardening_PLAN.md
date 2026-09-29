# Plan: F29 Security and Trust-Boundary Hardening

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** `Specs/security_and_trust_boundary_hardening_PRD.md`
>
> **Last revalidated against:** application overview revision 2026-09-28 and F29 PRD revision 2026-09-28
>
> **Entry/readiness gates:** F03-F04 expose the authoritative main-process,
> persistence, preload, IPC, route, and renderer-session contracts. F05-F06
> expose secure credential references, server/URL/remote identity, and narrow
> GitHub mutation ports. F09 exposes bounded redaction and diagnostic sinks.
> F13-F14 expose canonical operation worktrees, structured no-shell commands,
> process/output limits, and validation trust. F15-F17 expose provider-neutral
> schemas, capability checks, immutable profiles/policies, controlled
> environments, budgets, and stop reasons. F18-F27 expose read-only proposal,
> worktree, stale, conflict, approval, and deterministic publication boundaries.
> F28 exposes restart/sleep/network/renderer recovery handoffs. The test harness
> can run Windows/Electron boundary checks with temporary repositories, fake
> secure stores/providers/processes/network, injected clocks, publication spies,
> and synthetic secrets. PD-06 is resolved: the quality gate remains
> configurable, while the default policy blocks Critical and High dependency
> findings; any non-default policy must be explicit and versioned.
>
> **Policy gate:** Record the effective dependency threshold policy with the
> release evidence. If the configured policy differs from the default Critical /
> High blocking policy, record the required named, time-bounded risk acceptance
> and relint both documents if the product rule changes.
>
> This PLAN cannot change product requirements. Resolve contradictions in the
> owning PRD before implementation and rerun both specification linters. This
> feature does not check the checklist item; implementation and approval are
> separate.

## Implementation Boundary

F29 is a cross-cutting hardening and evidence feature. It adds the threat model,
boundary catalog, security reason vocabulary, narrow enforcement seams, and
adversarial tests that make existing F04-F28 contracts fail closed. It does not
create a second PR state machine, replace an owning workflow, or move GitHub,
Git, validation, provider, credential, or publication authority into a new
security service.

The implementation must use the following ownership rule:

- F04 remains the owner of Electron lifecycle, preload, IPC session mechanics,
  and routing. F29 hardens its allowlists, schemas, renderer isolation, and
  authorization handoff.
- F05 remains the owner of secure credential storage and authentication. F29
  proves that credential values do not cross into SQLite, IPC, activity,
  validation, provider context, or publication-independent code.
- F06, F13, and F14 remain authoritative for remote identity, Git/worktree
  truth, and validation truth. F29 supplies canonical path, argument,
  environment, and no-side-effect checks around those ports.
- F15-F17 remain the owners of provider translation, task/policy snapshots,
  bounded AI work, cancellation, and progress. F29 verifies capability floors,
  no-publication authority, controlled environments, and schema/redaction
  boundaries.
- F18-F28 remain the owners of review, synchronization, publication, and
  recovery state. F29 protects their inputs and effect gates and verifies that
  security blocks survive renderer loss and recovery.

## Readiness Gates

- The F29 PRD is approved, including the configurable quality-gate contract and
  PD-06's default Critical/High blocking policy; its application-criteria
  mapping has no invalid or definite missing result.
- F04 exposes the production-like web-preference configuration, typed preload
  bridge, explicit IPC channel registry, route parser/session identity, and
  renderer-close handoff needed for security tests.
- F03 exposes typed serialization, database-location configuration, migration,
  transaction, and safe read-model seams without requiring a renderer.
- F05 provides a fakeable secure credential-store adapter and never requires
  tests to inspect or copy a real token.
- F06 exposes parsed server/URL/remote identities and narrow mutation ports;
  tests can verify repository/ref selection without a live GitHub account.
- F09 exposes bounded redaction and structured activity sinks; activity remains
  diagnostic and cannot be used as security or workflow authority.
- F13 exposes canonical owned-worktree identity, current-condition inspection,
  revision/fingerprint evidence, and operation-isolation checks.
- F00/F14 expose versioned validation profiles, trust/confirmation, structured
  executable-plus-argument commands, controlled environments, output bounds,
  and no-run reasons.
- F15 exposes provider-neutral schemas, capability checks, policy translation,
  controlled child-environment hooks, and no-publication provider contracts.
- F16/F17 expose immutable task/policy snapshots, read-only floors, turn
  authorization, timeout/cancellation, and bounded stop reasons.
- F18-F27 expose typed approval, stale, worktree, synchronization, conflict,
  and publication handoffs so F29 can prove authority boundaries without
  recreating their state machines.
- F28 exposes recovery hooks that preserve security reasons, snapshots,
  ownership, and effect uncertainty without auto-authorizing stopped work.
- Windows/Electron fixtures can inspect context isolation, path/junction
  behavior, `PATHEXT`, child environments, file-opening targets, and process
  lifecycle without real credentials or external publication.

## Proposed Vertical Slices

1. **Versioned threat model, data classification, and boundary catalog**
   - **Blocked by:** F03-F28 owner contracts and the PD-06 quality-gate policy contract.
   - **Stories / requirements / acceptance criteria:** US-01-US-12; FR-01.1-FR-01.6, FR-09.4-FR-09.5; NFR-01-NFR-09; INV-01-INV-12; AC-01, AC-20, AC-23-AC-25; CT-F29-01, CT-F29-10.
   - **Implementation:** Create the versioned F29 security artifact. Define assets, actors, data classes, boundary owners, allow/deny rules, security reasons, evidence references, residual limitations, and the exact shared-criteria handoff. Link every threat-model row to an owning feature contract and a test or release artifact. Keep the catalog descriptive and reviewable; it must not become a free-form runtime authorization source.
   - **Visible result:** A reviewer can open one bounded security overview and trace each F29 boundary from threat to mitigation, owner, test, release evidence, and residual risk. The artifact explicitly shows that no F29 shadow state machine replaces F02-F28 authority.
   - **Durable records / external effects:** Adds versioned threat-model/boundary documents and safe reason definitions. No database migration, credential access, provider invocation, Git mutation, external open, GitHub request, or publication occurs.
   - **Failure / cancellation / restart:** Missing owner, evidence, classification, mitigation, or residual-risk decision fails the gate. A cancelled catalog check leaves no release marker and can be rerun from clean fixtures. Renderer closure does not affect the catalog.
   - **Exact evidence:** Threat-model review table; data-flow/classification matrix; boundary-owner matrix; reason-code schema; PRD/PLAN/application-criteria trace; effective PD-06 policy record; `git diff --check`; CT-F29-01 and CT-F29-10.
   - **Exit criterion:** AC-01, AC-23, and AC-25 pass; every F29 scope area has an owner and executable evidence reference; no unresolved release-blocking risk is hidden in prose.

2. **Renderer isolation, typed IPC, and route/deep-link hardening**
   - **Blocked by:** Slice 1, F04's lifecycle/IPC contracts, F03 safe serialization, and the production-like Electron harness.
   - **Stories / requirements / acceptance criteria:** US-01-US-02, US-03, US-09-US-10; FR-02.1-FR-02.7, FR-08.1-FR-08.5; NFR-01-NFR-08; INV-01, INV-03-INV-04, INV-07, INV-09-INV-10; AC-02-AC-05, AC-16-AC-17, AC-20, AC-22, AC-24; CT-F29-02, CT-F29-03, CT-F29-08, CT-F29-09.
   - **Implementation:** Harden the F04 Electron configuration and preload bridge. Generate or validate explicit channel/payload/event schemas and capability allowlists. Add main-process authorization handoff checks for state-changing requests, bounded message/session limits, renderer-session scoping, navigation/new-window/origin restrictions, and deep-link parsing that selects views only. Ensure privileged objects, raw errors, paths, prompts, and credentials cannot be serialized to the renderer.
   - **Visible result:** A production-like renderer can read permitted projections and request an allowed action, while forged channels, payloads, sessions, stale revisions, routes, and renderer-controlled paths receive safe rejection. Closing/reloading the renderer leaves main-process work unchanged.
   - **Durable records / external effects:** Safe IPC rejection/activity records may be appended through F09. The slice creates no AI turn, validation process, file open, Git operation, commit, push, response, merge, secure-store enumeration, or publication intent.
   - **Failure / cancellation / restart:** Invalid messages fail before an owner service call. Renderer destruction drops only the reply/subscription and never cancels or authorizes work. Duplicate deep links do not start duplicate actions. Startup/recreated renderers establish fresh sessions and cannot inherit stale authority.
   - **Exact evidence:** Electron web-preference report; preload export/import-boundary scan; unknown-channel and schema-fuzz matrix; forged-session/oversize tests; deep-link/notification route matrix; no-side-effect spies; renderer close/reload/crash/recreate test; keyboard/screen-reader/forced-color/narrow-window security-block check; CT-F29-02, CT-F29-03, CT-F29-08, and CT-F29-09.
   - **Exit criterion:** AC-02-AC-05, AC-16-AC-17, and AC-22 pass; no renderer or route path can reach a privileged effect without an owning service's current authorization.

3. **Canonical paths, worktree ownership, file opening, and Git argument safety**
   - **Blocked by:** Slices 1-2, F06 remote identities, F13 worktree conditions, F22 dirty/stale choices, F24-F27 synchronization identities, and the Windows path test harness.
   - **Stories / requirements / acceptance criteria:** US-03-US-04, US-07-US-09; FR-03.1-FR-03.7, FR-06.3, FR-06.7-FR-06.8; NFR-01-NFR-07; INV-03-INV-05, INV-07-INV-08, INV-12; AC-05-AC-07, AC-16-AC-19, AC-24; CT-F29-03, CT-F29-04, CT-F29-07, CT-F29-08.
   - **Implementation:** Add or harden a shared main-process path/ownership guard and the narrow OS file-opening adapter. Revalidate canonical path, expected type, operation owner, worktree revision, and allowed target immediately before open/reveal, Git, discard, validation, AI, or publication handoff. Audit Git argument construction for no-shell invocation, option/path separation, allowlisted verbs, explicit repository/ref identity, rejection of control characters and force flags, and preservation of the developer clone.
   - **Visible result:** A user can open a valid Review Bundle or synchronization worktree, while traversal, case/junction/symlink escape, UNC/device, stale owner, developer-clone, database, credential-store, cross-operation, hostile ref, and option-injection fixtures are blocked with precise reasons.
   - **Durable records / external effects:** Valid open/reveal actions may call the OS adapter only after admission. Git tests use temporary repositories and may perform test-owned local operations; production publication, response, merge, and developer-clone mutation are forbidden in this slice. Path/security reasons are bounded and correlated.
   - **Failure / cancellation / restart:** A changed owner, missing worktree, stale revision, ambiguous canonicalization, or interrupted opener remains blocked and preserved. A retry rechecks the path and identity; it never substitutes another operation or resets/deletes worktree content.
   - **Exact evidence:** Windows path table for relative, drive-relative, absolute, UNC, device, case, symlink, junction, missing, file/directory, and cross-operation cases; OS adapter target spy; Git argv round-trip and force-flag rejection; repository/ref identity matrix; developer-clone preservation; stale/recovery fixtures; CT-F29-03, CT-F29-04, and CT-F29-08.
   - **Exit criterion:** AC-05-AC-07, AC-18, and AC-24 pass; every supported open/Git/worktree path is canonical, owned, no-shell, and revalidated immediately before use.

4. **Validation, child-process, and database execution boundary**
   - **Blocked by:** Slice 3, F00/F14 structured validation and process controls, F03 database path/migration seams, and F28 interruption handoff.
   - **Stories / requirements / acceptance criteria:** US-03, US-05-US-06, US-11; FR-04.1-FR-04.7, FR-08.2-FR-08.5; NFR-01-NFR-07; INV-03-INV-06, INV-08, INV-11-INV-12; AC-08-AC-10, AC-18-AC-20, AC-22-AC-24; CT-F29-04, CT-F29-05, CT-F29-06, CT-F29-09.
   - **Implementation:** Connect F29 checks to every supported child-process seam. Admit only F00/F14 trusted structured commands; preserve shell-disabled executable/argument behavior, canonical owned cwd, explicit environment allowlist, output/time limits, and snapshot revalidation. Harden SQLite location resolution, creation, migration, backup, and startup recovery so the authoritative database cannot be redirected or silently substituted by a renderer, repository, or worktree path.
   - **Visible result:** Fixture commands with shell metacharacters, traversal, environment requests, secret values, wrong worktrees, changed hashes, and oversized output are rejected or run only under the recorded trusted contract. Database path fixtures show safe acceptance of the approved app-data location and actionable failure for substitution/escape.
   - **Durable records / external effects:** Test-owned child processes and SQLite fixtures record bounded/redacted evidence. No production GitHub credential, provider credential, developer-clone path, publication command, or live database is used. A process starts only after the durable owner contract is committed.
   - **Failure / cancellation / restart:** Missing confirmation, malformed profile, path/env mismatch, database substitution, redaction uncertainty, timeout, cancellation, renderer closure, or restart yields a non-passing typed result. F28 finalizes interrupted work without rerunning or broadening it.
   - **Exact evidence:** F00 profile/trust matrix; `shell: false` and executable/argument spy; `PATH`/`PATHEXT` matrix; env allowlist and synthetic-secret scan; cwd/path containment and revision race fixtures; streaming output bounds/redaction; SQLite path/migration/backup/restart matrix; process-tree cancellation/restart evidence; CT-F29-04-CT-F29-06 and CT-F29-09.
   - **Exit criterion:** AC-08-AC-11, AC-18-AC-20, and AC-24 pass; no supported validation/process/database path can execute untrusted input, leak a secret, escape its owner, or claim success after a security failure.

5. **Secure credentials, controlled environments, redaction, and diagnostics**
   - **Blocked by:** Slice 4, F05 secure-store adapter, F09 activity/redaction contract, F14/F15 controlled environments, and the secret-free evidence harness.
   - **Stories / requirements / acceptance criteria:** US-05-US-06, US-10-US-12; FR-05.1-FR-05.7, FR-08.1-FR-08.5; NFR-01-NFR-06, NFR-08-NFR-09; INV-01, INV-03, INV-06, INV-08-INV-11; AC-10-AC-13, AC-20, AC-22, AC-24-AC-25; CT-F29-01, CT-F29-05, CT-F29-06, CT-F29-09, CT-F29-10.
   - **Implementation:** Audit and connect all secure-store, persistence, provider, validation, Git, notification, activity, IPC, and UI sinks to the controlled credential/environment and redaction seams. Add synthetic-secret scanners and fail-closed redaction outcomes. Ensure errors retain safe operation/reason/correlation/evidence fields but not raw prompts, SDK objects, authorization headers, environment values, or sensitive paths. Document the allowed credential destination for each task type.
   - **Visible result:** A credential-free test run can demonstrate where a fake GitHub/provider credential is allowed and prove that the value is absent from SQLite, IPC DTOs, logs, activity, notifications, validation output, provider context, structured results, and release reports.
   - **Durable records / external effects:** SQLite stores only opaque credential references and safe metadata. F09 receives bounded safe events. Fake secure stores and child/provider adapters observe access without real credentials. No remote request or publication effect occurs.
   - **Failure / cancellation / restart:** Secure-store denial, missing reference, environment mismatch, secret detection, redaction failure, or uncontrolled provider/process input blocks the affected operation and preserves a safe reason. Restart retains the block and reference without attempting to recover a secret from plaintext state.
   - **Exact evidence:** Secure-store call/permission matrix; SQLite secret scan; prompt/structured-output/context scan; controlled environment diff; known-value and key/value/header redaction corpus; chunked/UTF-8/ANSI output cases; error/activity/notification/IPC projection scan; restart/recovery secret scan; CT-F29-06, CT-F29-09, and CT-F29-10.
   - **Exit criterion:** AC-10-AC-13, AC-20, AC-22, and AC-24-AC-25 pass; no supported boundary retains or exposes a synthetic secret outside its approved owner.

6. **AI policy, capability, structured-output, and publication-authority hardening**
   - **Blocked by:** Slice 5, F15 provider-neutral/Codex contracts, F16 task-policy snapshots, F17 bounded-work controls, F18/F21 proposal/revision flows, F23/F27 publication gates, and F26 conflict-resolution fixtures.
   - **Stories / requirements / acceptance criteria:** US-07-US-09; FR-06.1-FR-06.8, FR-08.2-FR-08.4; NFR-01-NFR-06; INV-01-INV-03, INV-06-INV-10; AC-13-AC-19, AC-24; CT-F29-07, CT-F29-08, CT-F29-10.
   - **Implementation:** Add conformance checks around every F15 adapter call and downstream AI consumer. Verify immutable task/policy snapshots, exact operation worktree, controlled environment, no publication credentials/API, read-only proposal/conversation floors, structured-output/event validation, exact input identities, unsupported-capability refusal, no automatic broadening, and deterministic publication handoff. Add compile/import and capability spies proving the provider interface has no publication or generic shell methods.
   - **Visible result:** Fake provider and Codex fixture invocations succeed only within their declared policy. Attempts to widen paths/network/environment/approval, return raw SDK or secret data, mutate during proposal, or call publication produce typed blocked results before the forbidden effect.
   - **Durable records / external effects:** F03/F17 receive only normalized bounded metadata, usage, safe errors, and structured results. Test providers may modify temporary operation worktrees in authorized implementation/conflict cases; no commit, push, response, merge, secure-store enumeration, or live provider call occurs.
   - **Failure / cancellation / restart:** Capability/policy/schema/credential/path mismatch stops before provider start. Provider cancellation, timeout, renderer closure, restart, or uncertain outcome preserves the policy snapshot and consumed budget; F28 or F17 owns any later explicit continuation, never F29.
   - **Exact evidence:** Provider import graph; fake/Codex normalized-contract equivalence; policy matrix for read-only, Autonomous Worktree, network, interactive, full-access, extra-path, and credential requests; structured-output/event rejection; proposal no-mutation; conflict worktree ownership; no-publication method/type/effect spy; restart/no-auto-resume; CT-F29-07, CT-F29-08, and CT-F29-10.
   - **Exit criterion:** AC-13-AC-19 and AC-24 pass; F15-F27 can invoke their authorized capabilities without any renderer/provider/model path gaining publication authority or broader policy.

7. **Recovery, security-block projections, accessibility, and residual-risk documentation**
   - **Blocked by:** Slices 1-6, F28 recovery hooks, F09 diagnostics, F19/F20/F27 read models, and the existing accessibility test harness.
   - **Stories / requirements / acceptance criteria:** US-10-US-12; FR-01.2-FR-01.6, FR-08.1-FR-08.6, FR-09.4-FR-09.5; NFR-02, NFR-04, NFR-06-NFR-09; INV-01, INV-03, INV-07-INV-12; AC-18-AC-23, AC-25; CT-F29-01, CT-F29-09, CT-F29-10.
   - **Implementation:** Project security blocks into the existing main-process/read-model/activity contracts with stable reason, affected boundary, operation identity, safe evidence, retryability, and permitted action. Connect F28 restart/sleep/network/renderer recovery so blocks, snapshots, ownership, approvals, and redaction outcomes persist. Add accessible presentation checks and write the explicit defense-in-depth/residual-risk documentation required by the PRD.
   - **Visible result:** After renderer closure, restart, sleep, network loss, or uncertain outcome, the developer sees the same security block and preserved evidence, with a bounded safe next action. The state is distinguishable from generic failure, stale, interrupted, unsupported, or successful work.
   - **Durable records / external effects:** Adds safe security reason/activity/read-model records and versioned residual-risk documentation. Recovery may inspect deterministic evidence but cannot start stopped AI, validation, Git, provider, open, or publication effects by itself.
   - **Failure / cancellation / restart:** Missing security evidence, an unrecognized reason, unsafe projection, accessibility failure, or recovery attempt to broaden authority blocks the gate. A renderer close or cancelled read does not mutate the main-process state.
   - **Exact evidence:** Reason/projection schema round-trip; restart/sleep/network/renderer fault matrix; no-auto-authorization assertion; safe evidence/secret scan; F19/F20/F27 consumer conformance; keyboard/focus/screen-reader/forced-colors/reduced-motion/zoom/narrow-window report; residual-risk review; CT-F29-01, CT-F29-09, and CT-F29-10.
   - **Exit criterion:** AC-18-AC-23 and AC-25 pass; every security block is durable, explainable, accessible, secret-free, and bounded across recovery.

8. **Supply-chain gate, cross-feature conformance, and F30 handoff**
   - **Blocked by:** Slices 1-7, final F01 dependency lockfile/runtime, all F04-F28 contract evidence, and the resolved PD-06 quality-gate configuration contract.
   - **Stories / requirements / acceptance criteria:** US-01-US-12; FR-07.1-FR-07.6, FR-09.1-FR-09.5, all remaining FR/NFR/INV; APP-AC-01, APP-AC-10-APP-AC-13, APP-AC-28-APP-AC-29, APP-AC-39, APP-AC-48, APP-AC-50, APP-AC-63-APP-AC-64, APP-AC-70, APP-AC-71, APP-AC-74; AC-01, AC-21, AC-23-AC-25; CT-F29-01-CT-F29-10.
   - **Implementation:** Run the complete credential-free security conformance suite against clean temporary fixtures and the production-like Windows/Electron artifact. Generate the production dependency inventory, lockfile/runtime identity, vulnerability result, provider import graph, dynamic-install/load scan, secret/effect scans, application-criteria trace, and residual-risk register. Execute the repository-required checks and both specification linters against the final PRD/PLAN. Assemble the bounded F30 handoff without changing `checklist.md`.
   - **Visible result:** One release-gate report clearly says which boundaries passed, which evidence was used, whether a release-blocking finding exists, and what F30 must verify on a clean Windows machine. No live credential or external publication is required to reproduce the report.
   - **Durable records / external effects:** Produces versioned security evidence, dependency inventory, effective threshold policy, a risk-acceptance record only when a non-default policy is explicitly configured, and linter reports. It may run local test/build commands and temporary Git fixtures only; it does not commit, push, post, merge, modify GitHub, edit the checklist, or publish a release.
   - **Failure / cancellation / restart:** Any definite test failure, secret leak, unauthorized effect, invalid application mapping, import violation, dynamic install/load, unsupported runtime, unresolved release-blocking dependency finding, or linter `missing` result fails the gate. A cancelled run leaves no success marker and can restart from clean fixtures.
   - **Exact evidence:** `npm ci`; `npm run check`; `npm audit --omit=dev --audit-level=high`; production dependency inventory; provider/Electron/Node import-boundary report; packaged-like Electron smoke; Windows path/process/environment report; all CT-F29-01 through CT-F29-10; secret/effect scans; `git diff --check`; `npm run lint:prd-plan -- Specs/security_and_trust_boundary_hardening_PRD.md Specs/security_and_trust_boundary_hardening_PLAN.md`; `npm run lint:application-coverage -- Specs/application_overview.md Specs/security_and_trust_boundary_hardening_PRD.md`.
   - **Exit criterion:** AC-01, AC-21, AC-23-AC-25 and all mapped shared application criteria have recorded evidence with no definite security or linter failure; F30 receives the complete bounded handoff and the F29 checklist item remains unchecked pending implementation completion.

## Cross-Slice Verification and Handoff

- The owning PRD is `Specs/security_and_trust_boundary_hardening_PRD.md`.
  This PLAN adds implementation sequencing and evidence only; it does not
  change F29 product requirements or invent a competing authorization model.
- The threat model and boundary matrix are the review index, not an executable
  policy file. Runtime authority remains in the typed contracts and owning
  main-process services named by F04-F28.
- F04 must keep the renderer bridge narrow and context-isolated. F29's tests
  fail if a renderer can reach generic service, SQL, shell, filesystem,
  provider, secure-store, or publication authority, even when the renderer is
  newly created or a deep link is delivered.
- F05 remains the only owner of GitHub credential storage and authentication.
  F29 may use fake credential-store observations, but it must never inspect,
  copy, or record a real token. F06 remains the only GitHub transport boundary.
- F13 is authoritative for worktree/Git identity and actual state. F29 may
  reject a path or operation on F13 evidence, but it must not reset, replace,
  delete, or infer worktree ownership from filenames.
- F00/F14 are authoritative for validation trust, structured commands, process
  results, output limits, and pass/fail truth. F29 must not create a second
  validation profile format or use an AI/provider claim as execution evidence.
- F15-F17 are authoritative for provider invocation, task profiles, execution
  policy translation, bounded turns, timeouts, progress, and explicit
  continuation. F29 verifies their no-publication/controlled-environment
  boundary and rejects unsupported capability, but it does not retry or resume
  provider work.
- F18-F27 remain authoritative for Review Bundle, synchronization, approval,
  stale, conflict, and publication state. F29's publication tests use spies and
  existing service contracts; a security pass never substitutes for fresh
  human approval or SHA validation.
- F28 remains authoritative for recovery. A security block is durable input to
  recovery, not a reason for F29 to create a recovery loop. Recovery may
  inspect/reconcile deterministic evidence but may not broaden policy or
  silently restart a stopped effect.
- F30 receives the versioned threat model, boundary matrix, dependency
  inventory, vulnerability result, runtime/lockfile identity, test reports,
  residual-risk decisions, mapped application-criteria evidence, and the final
  linter output. F30 owns clean-machine install, signing/update decisions,
  packaged end-to-end acceptance, and final release approval.
- The F29 security gate is complete only when all ten contract-test criteria,
  all 25 observable acceptance criteria, the mapped shared application
  criteria, the effective PD-06 policy, and both specification-linter runs are
  recorded. The checklist remains unchanged by this planning phase.

## Requirement-to-Slice Trace

| Requirement family | Owning slices | Application handoff |
|---|---|---|
| FR-01 | 1, 7-8 | Threat model, classification, and owner/evidence matrix consumed by F30 and all shared boundaries. |
| FR-02 | 2, 7-8 | F04 IPC/renderer/route hardening and F19/F20/F27 safe projections. |
| FR-03 | 3, 8 | F06/F13/F22/F24-F27 path, identity, worktree, and Git safety evidence. |
| FR-04 | 4, 8 | F00/F14/F03 process, validation, database, and no-publication evidence. |
| FR-05 | 5, 7-8 | F05/F09/F14/F15 secret, credential, environment, diagnostic, and recovery evidence. |
| FR-06 | 6, 8 | F15-F17 provider/policy boundary and F18-F27 no-publication handoff. |
| FR-07 | 8 | F01 lockfile/runtime and F30 release dependency evidence. |
| FR-08 | 2, 4-7 | F04/F09/F19/F20/F27/F28 safe reason, accessible projection, and recovery behavior. |
| FR-09 | 1-8 | Complete security conformance and F30 handoff. |
| NFR-01-NFR-09 | 1-8 | Cross-feature security, reproducibility, boundedness, accessibility, and release evidence. |
| INV-01-INV-12 | 1-8 | Cross-feature invariant suite; no F29 shadow state machine. |

| Application criteria | F29 role | Evidence slices |
|---|---|---|
| APP-AC-01 | Shared credential isolation and safe authentication error handling; F05 remains primary. | 5, 7-8 |
| APP-AC-10 | Shared path/worktree containment and operation isolation; F13 remains primary. | 3-4, 6, 8 |
| APP-AC-11-APP-AC-13 | Shared provider/validation boundary hardening; F15/F14 remain primary. | 4-6, 8 |
| APP-AC-28-APP-AC-29 | Shared no-publication authority and secret-free effect handoff; F23/F06 remain primary. | 2, 5-6, 8 |
| APP-AC-39 | Shared dirty-worktree/path safety; F13/F22 remain primary. | 3-4, 7-8 |
| APP-AC-48 | Shared conflict-worktree/policy boundary; F26 remains primary. | 3, 6, 8 |
| APP-AC-50 | Shared safe argument/authorization boundary; F27/F23 remain primary. | 2-3, 6, 8 |
| APP-AC-63-APP-AC-64 | Shared provider isolation and safe provider-neutral metadata; F15/F03 remain primary. | 5-6, 8 |
| APP-AC-70-APP-AC-71 | Shared policy enforcement and proposal read-only floor; F16/F15/F18 remain primary. | 2, 6-7, 8 |
| APP-AC-74 | Shared trusted-command boundary; F00/F14/F16 remain primary. | 4, 8 |
