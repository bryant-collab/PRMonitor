<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single level. The goal is to provide the AI and the user with a visible and testable result when the work is complete. This improves the reliability of AI's output through rapid feedback.
There might be slices that are needed to describe work that doesn't extend through all levels, that's fine, but the preference should be towards vertical slices.
-->

# Plan: F14 Deterministic Validation Runner and Result Model

> **Document status:** Implemented validation foundation and F15 evidence-handoff conformance
>
> **Owning PRD:** `Specs/deterministic_validation_runner_and_result_model_PRD.md`
>
> **Last revalidated against:** `Specs/application_overview.md` revision 2026-09-23, F00/F09/F13 specs, F14 PRD, and F15 approved ownership split revision 2026-09-23
>
> **Entry/readiness gates:** F00's `@prmonitor/validation-contract` package and generated schema pass their checks and expose the immutable snapshot, prepared-command, output, lifecycle, manual-attestation, and review/synchronization consumer contracts. F03 exposes validation-run/snapshot/step/manual repositories, transactions, optimistic versions, and startup recovery. F09 exposes the main-process activity writer. F13 exposes owned-worktree inspection, baseline/current revision identities, and developer-workspace protection. The desktop runtime can create temporary Windows worktrees and child-process fixtures without product-service credentials.
>
> This PLAN cannot change product requirements. Resolve contradictions in the owning PRD before implementation and rerun both specification linters. This feature does not check the checklist item; implementation and approval are separate.

## Implementation Boundary

F14 adds the production validation execution boundary inside the Electron main
process. It coordinates F00 profile/snapshot admission, F13 actual-worktree
inspection, structured child-process execution, bounded/redacted output,
timeout/cancellation/restart lifecycle, sequential phase-aware aggregation,
F03 durable evidence, F09 activity, and a typed consumer read model.

F00 remains authoritative for profile schema, source precedence, trust,
authorization, effective timeout/output limits, path policy, controlled
environment policy, redaction primitives, manual attestations, lifecycle
transitions, and consumer semantics. F03 remains authoritative for SQLite,
migrations, transactions, idempotency, and durable records. F09 remains
diagnostic. F13 remains authoritative for worktree ownership, actual Git state,
revision snapshots, and developer-workspace protection.

F14 does not build the validation settings UI, discover commands, choose or
approve profiles, create worktrees, clear dirty changes, interpret test meaning,
invoke AI, perform GitHub/Git publication, or own Review Bundle/
synchronization workflow timing. F16/F18-F27 consume the typed result and own
those decisions.

## Readiness Gates

- F00's schema, generated JSON Schema, trust resolution, immutable snapshots, `PreparedCommand`, `ValidationRunnerPort`, `ProcessControlPort`, output evidence, status transitions, manual attestations, no-run warnings, and consumer conformance tests pass unchanged.
- F03 can persist a validation run intent and immutable snapshot before a child-process effect, append step/result evidence transactionally, reject stale versions, distinguish committed from uncommitted cancellation, and finalize in-flight records after restart.
- F09 can append bounded `VALIDATION` events with correlation/run/phase/status/reason data while the renderer is absent; a failed activity append does not alter validation truth.
- F13 can inspect and return an operation-owned worktree's canonical path, owner, baseline/current revisions, and actual state immediately before validation, including a typed stale/missing/ownership failure.
- The main-process composition boundary can keep validation alive after renderer closure and can invoke a platform process-control adapter without exposing process handles or shell commands to preload/renderer code.
- The test harness can create temporary repositories/worktrees, fixture commands that emit deterministic output and child processes, injected clocks, process-tree controls, persistence faults, renderer absence, and synthetic secrets.
- Windows integration fixtures can exercise `PATHEXT`, case-insensitive path containment, process-tree termination, and restart recovery on the supported Node/Electron runtime.

## Proposed Vertical Slices

1. **Admission, worktree revalidation, and persist-before-launch intent**
   - **Blocked by:** F00 snapshot/consumer contracts, F03 validation repositories/transactions, F09 activity writer, F13 actual-state inspection, and the main-process composition boundary.
   - **Stories / requirements / acceptance criteria:** US-01, US-08-US-10; FR-01.1-FR-01.5, FR-07.1-FR-07.2, FR-07.5; NFR-01-NFR-05; INV-01-INV-03, INV-05-INV-08; AC-01-AC-02, AC-11, AC-13, AC-16-AC-18; CT-F14-01, CT-F14-02, CT-F14-08.
   - **Implementation:** Add the main-process `ValidationRunService` admission contract. Accept a managed operation identity, requested phase, F00 resolution input, immutable snapshot, and F13 worktree identity. Request fresh F13 inspection immediately before execution; reject stale/missing/unowned paths; create a completed F00-compatible `not_run` record for unavailable/invalid/confirmation-required profiles; and persist a running run intent, correlation, snapshot reference, owner/version, and phase before any child-process call. Use F03 idempotency/optimistic-version results rather than an in-memory run map.
   - **Visible result:** A fixture request produces either a durable running validation run tied to one exact worktree/snapshot or a durable `not_run` warning with no spawned process. Reopening the application returns the same record.
   - **Durable records / external effects:** Adds or consumes F03 validation-run, snapshot, step, manual-attestation, warning, and correlation records and emits safe F09 start/no-run activity. No child process runs on admission failure; a real child process is allowed only after the pre-launch commit.
   - **Failure / cancellation / restart:** A profile/hash/authorization mismatch, F13 stale state, transaction failure, renderer closure, or process stop before commit produces no false run. A committed intent remains inspectable and is reconciled by run identity.
   - **Exact evidence:** F00 resolution matrix; no-profile/no-command/confirmation-required fixtures; persist-before-spawn spy; F13 stale/owner/path matrix; duplicate start and changed-payload replay; transaction fault before/after commit; renderer-absent readback; secret-free records; CT-F14-01, CT-F14-02, and CT-F14-08.
   - **Exit criterion:** AC-01-AC-02, AC-11, AC-13, and AC-18 pass, and no validation process can start without one durable, valid, authorized snapshot and current owned-worktree inspection.

2. **Structured command preparation and controlled child-process execution**
   - **Blocked by:** Slice 1, F00 `prepareCommand`/environment/path policy, the Node process adapter, and the Windows executable-resolution seam.
   - **Stories / requirements / acceptance criteria:** US-01-US-02, US-05; FR-03.1-FR-03.6, FR-04.1-FR-04.2, FR-05.1; NFR-02-NFR-06; INV-01, INV-05-INV-07; AC-04, AC-06, AC-09, AC-18; CT-F14-02-CT-F14-04.
   - **Implementation:** Implement a production `ValidationRunnerPort` adapter around structured Node child-process primitives. Prepare each step through the F00 path/environment/executable resolver, set `shell: false`, pass the exact argument array, use the canonical worktree directory, record the resolved executable and effective limits, stream stdout/stderr as bytes, and return a process-tree handle plus an exit observation. Keep child-process details in main-process code and expose only serialized evidence.
   - **Visible result:** A temporary operation worktree runs fixture commands with spaces/quotes/Unicode arguments and a nested working directory; the recorded command matches the input exactly, resolves on Windows, and cannot reach a sibling path or secret environment value.
   - **Durable records / external effects:** The only external effect is execution of a trusted repository command inside the operation-owned worktree. Running/pending/terminal step evidence and command metadata are persisted through F03; F09 receives bounded lifecycle events.
   - **Failure / cancellation / restart:** Invalid path, unresolved executable, environment violation, or shell-string input fails before spawn. A start error becomes `failed/START_FAILED`; process and persistence uncertainty remain explicit for reconciliation.
   - **Exact evidence:** Argument round-trip table; shell-disabled assertion; Windows `PATH`/`PATHEXT` matrix; cwd `.`/nested/absolute/traversal/symlink/junction cases; controlled-environment allowlist and credential scan; process-handle contract; CT-F14-02, CT-F14-03, and CT-F14-05.
   - **Exit criterion:** AC-04, AC-06, AC-09, and AC-18 pass with no shell-string entry point, no developer-workspace target, and no secret-bearing child environment.

3. **Phase-aware sequential execution and deterministic result aggregation**
   - **Blocked by:** Slice 2, F00 evidence/status functions, and typed requests from review and synchronization consumers.
   - **Stories / requirements / acceptance criteria:** US-03-US-06; FR-02.1-FR-02.4, FR-04.1-FR-04.3, FR-05.1, FR-06.3; NFR-01, NFR-07; INV-01, INV-04, INV-08-INV-09; AC-03, AC-05-AC-06, AC-09, AC-14-AC-15; CT-F14-04, CT-F14-07-CT-F14-08.
   - **Implementation:** Add a phase sequencer that preserves the F00 profile snapshot and declared order. For a baseline, post-change, or linked both-phase request, select only eligible steps; retain each step's configured phase and the phase actually executed; run commands sequentially; stop after the first failed/interrupted step; mark subsequent steps `not_run` with `PRIOR_STEP_STOPPED`; and use the F00 aggregate contract so manual steps, warnings, and automated status remain distinct. A command tagged `both` may participate in both phase-specific runs, but evidence is keyed to the run/phase and never reused across phases.
   - **Visible result:** A profile containing baseline, post-change, both, command-failure, and manual steps produces deterministic baseline/post-change result cards or serialized projections showing different eligible steps, exact order, stop behavior, and aggregate status.
   - **Durable records / external effects:** Persists ordered step transitions and phase-specific terminal evidence. It does not invoke AI, GitHub, publication, or parallel commands; the consumer fake is the only downstream caller.
   - **Failure / cancellation / restart:** Phase mismatch, illegal transition, duplicate step, or snapshot mismatch stops before an unsafe launch. A failed/interrupted step leaves later steps explicitly not run; a baseline failure does not prevent a read-only review proposal from being analyzed by the owning workflow but remains visible.
   - **Exact evidence:** Phase-selection truth table for `baseline`/`post_change`/`both`; mixed-step order; zero/non-zero/start-failure aggregation; prior-step stop; baseline-failure handoff; manual-unattested aggregate; model-claim no-op; `validateRunAgainstSnapshot` tamper tests; CT-F14-04 and CT-F14-07.
   - **Exit criterion:** AC-03, AC-05-AC-06, AC-14, and AC-15 pass, and review/synchronization consumers receive identical phase/status semantics without parsing command output.

4. **Timeout, cancellation, shutdown, and restart-safe process lifecycle**
   - **Blocked by:** Slice 2, F00 `ProcessControlPort`/termination coordinator, F03 committed-versus-uncommitted semantics, and F04 main-process lifecycle hooks.
   - **Stories / requirements / acceptance criteria:** US-05, US-09; FR-04.3-FR-04.5, FR-07.2; NFR-03-NFR-04, NFR-06; INV-02-INV-04, INV-10; AC-07-AC-08, AC-11, AC-16, AC-18; CT-F14-05, CT-F14-08.
   - **Implementation:** Connect timeout, user-cancel, application-shutdown, renderer-close, and startup reconciliation to the F00 state machine. On timeout/cancellation/shutdown, request graceful termination of the full process tree, wait exactly 5,000 ms on an injected clock, list survivors, force-terminate only survivors, finalize bounded output and an interrupted reason, and prevent later steps. On startup, load running records, finalize them as `APPLICATION_RESTARTED`, and never silently resume. Renderer close is deliberately a no-op on the main-process operation.
   - **Visible result:** A lifecycle harness shows graceful termination first, force termination only after five seconds for surviving descendants, distinct timeout/cancel/shutdown/restart reasons, later steps not run, and the same result after renderer recreation.
   - **Durable records / external effects:** Records lifecycle transitions, termination evidence, process identifiers only where the F00 schema permits, bounded activity, and final run/step results. No retry or new child process is started by recovery alone.
   - **Failure / cancellation / restart:** Faults in graceful or force termination become non-passing actionable evidence; uncertain termination preserves the run/worktree for reconciliation. A process stop before or after the F03 commit is distinguishable.
   - **Exact evidence:** Fake-clock/process-control call order; five-second boundary; survivor list; timeout/cancel/shutdown/restart truth table; process-tree fixture on Windows; renderer-close no-op; restart-at-each-boundary fault injection; no-automatic-resume assertion; CT-F14-05 and CT-F14-08.
   - **Exit criterion:** AC-07, AC-08, AC-11, AC-16, and AC-18 pass, and lifecycle recovery cannot produce a false pass or duplicate command execution.

5. **Bounded/redacted output, manual attestations, and no-safe-command results**
   - **Blocked by:** Slices 1-4, F00 output/evidence/manual contracts, F09 redaction rules, F13 revision identity, and F03 evidence persistence.
   - **Stories / requirements / acceptance criteria:** US-06-US-08; FR-05.2-FR-05.4, FR-06.1-FR-06.4; NFR-02-NFR-05, NFR-07; INV-04, INV-06, INV-08-INV-09; AC-09-AC-10, AC-12-AC-14, AC-17; CT-F14-06-CT-F14-07.
   - **Implementation:** Wire incremental stdout/stderr byte capture to the F00 accumulator with independent limits, head/tail retention, truncation marker, byte counts, UTF-8/control normalization, and redaction before any result boundary. Record `REDACTION_FAILURE` safely. Add the main-process manual-attestation command that revalidates F13 path/baseline/current revisions, persists the F00 attestation, renders the fixed labels, and updates the deterministic aggregate. Add the explicit `NO_AUTOMATED_COMMANDS` and unavailable-profile warning path without fabricating success.
   - **Visible result:** Fixture evidence shows small output unchanged, oversized streams bounded with counts/marker, secrets removed while nearby context survives, manual outcomes labeled correctly, historical attestations marked, and no-safe-command results warning rather than passing.
   - **Durable records / external effects:** Stores only bounded/redacted output evidence, manual attestations, warnings, aggregate status, and F09 activity. Raw fixture bytes remain in process-local test input and never enter database, IPC, logs, or committed evidence.
   - **Failure / cancellation / restart:** Chunked secrets, multi-byte boundaries, ANSI/control sequences, output-limit violations, redaction uncertainty, changed worktree revisions, and missing user identity fail safely without erasing prior evidence or turning it into a pass.
   - **Exact evidence:** Independent stream boundary table; randomized chunking/UTF-8 corpus; secret-shaped output scan across SQLite/IPC/activity/evidence; redaction-failure fixture; bounded-memory measurement; manual outcome/revision matrix; no-profile/no-command/manual-unattested aggregate; positive-copy contract; CT-F14-06 and CT-F14-07.
   - **Exit criterion:** AC-09-AC-10 and AC-12-AC-14 pass, with no raw output/secret path and no manual attestation represented as an observed automated pass.

6. **Durable read model, F09 integration, and cross-workflow conformance**
   - **Blocked by:** Slices 1-5, final F03 repositories/migrations, F09 event catalog, F13 typed handoff, and review/synchronization fake consumers.
   - **Stories / requirements / acceptance criteria:** US-01-US-10; FR-01.1-FR-07.5; NFR-01-NFR-08; INV-01-INV-10; AC-01-AC-18; CT-F14-01-CT-F14-08; APP-AC-13, APP-AC-39, APP-AC-48, APP-AC-49, APP-AC-56, APP-AC-57, APP-AC-73-APP-AC-75.
   - **Implementation:** Add/finish F03 validation migrations and typed repositories for snapshots, runs, step evidence, manual attestations, warnings, current/terminal projections, and owner/version links. Compose F09 start/progress/terminal/cancellation/failure/recovery events with F03 transaction boundaries where the owning workflow requires atomic evidence. Expose a renderer-safe and provider-neutral read model with exact phase, command, directory, time, exit/signal, output metadata, manual labels, warning, reason, and next-action fields; F15 may consume a bounded snapshot of this model as semantic context but cannot write it or change its status. Run two thin consumers (`review` and `synchronization`) through the same F00/F14 contract; consumer labels are audit metadata only. Do not build the full Review Bundle or synchronization screen.
   - **Visible result:** A fresh-process conformance report can reconstruct baseline/post-change results, manual/no-run warnings, activity correlation, exact command evidence, and consumer-equivalent projections after UI closure/restart.
   - **Durable records / external effects:** Uses F03 migrations/repositories, F09 activity rows, temporary worktree/process fixtures, and linter reports. It does not edit `checklist.md`, use real credentials, invoke an AI provider, publish code, post a response, merge, or push.
   - **Failure / cancellation / restart:** Any missing evidence, invalid mapping, duplicate run, stale snapshot, secret leak, false pass, lost phase distinction, activity-state inference, forbidden capability, or definite linter miss blocks the gate. A cancelled conformance run leaves no success marker and can be rerun from fresh fixtures.
   - **Exact evidence:** `npm run build`, `npm test`, `npm run check`; migration/repository/restart/fault reports; CT-F14-01 through CT-F14-08; consumer equivalence report; F09 correlation/query report; Windows process/output/security scan; `git diff --check`; `npm run lint:prd-plan -- Specs/deterministic_validation_runner_and_result_model_PRD.md Specs/deterministic_validation_runner_and_result_model_PLAN.md`; `npm run lint:application-coverage -- Specs/application_overview.md Specs/deterministic_validation_runner_and_result_model_PRD.md`.
   - **Exit criterion:** All F14 requirements have direct acceptance or contract-test evidence, primary/shared application mappings have no definite missing/invalid result, and the F15 context handoff, redaction, and no-provider-claim validation tests pass.

## Cross-Slice Verification and Handoff

- F00 remains the single source of truth for profile parsing, source/trust resolution, canonical hashes, snapshots, prepared commands, controlled environment, path containment, output bounds/redaction, lifecycle transitions, manual labels, no-run warnings, and shared review/synchronization consumer behavior. F14 may adapt those ports to real processes but may not reinterpret them.
- F03 owns schema/migrations, transactions, uniqueness, optimistic concurrency, commit-before-effect, validation-run/step/manual records, and restart recovery. F14 never uses an in-memory map or free-form activity as authoritative state.
- F09 owns event envelopes, redaction, retention, and activity queries. F14 emits safe correlated events and does not infer validation status or workflow completion from activity rows.
- F13 owns operation-worktree creation, path ownership, Git state, baseline/current revisions, diff evidence, manual-edit preservation, and dirty-worktree choices. F14 requests inspection before launch and validation handoff but never resets/cleans/replaces the worktree.
- F16 owns the settings/confirmation surface for repository Build & Validation Instructions and structured profiles. F14 consumes an authorized snapshot and never treats human-readable instructions as executable authority.
- F15-F17 own provider contracts, AI task/policy snapshots, bounded AI turns, progress, and `NEEDS_ATTENTION`. F14 supplies deterministic command activity/results; it never invokes AI or accepts model claims as evidence.
- Approved F15 handoff: F14 exposes bounded validation evidence as immutable context only. F15 may include it in a semantic request, but F14 remains authoritative for command execution, exit status, manual evidence, aggregate status, and validation warnings. The bounded read-only context, redaction, and provider-claim refusal tests are proven; the production adapter remains F15-owned.
- F18-F23 own Review Bundle preparation, proposal/final timing, decisions, UI, revisions, stale handling, and publication. F18/F20/F23 decide when to request baseline/post/final validation and how to gate publication; F14 supplies the result.
- F24-F27 own synchronization selection, merge/conflict resolution, per-PR result state, review, and publication. F14 supplies the same validation contract in a separate operation-owned synchronization worktree.
- F28-F30 own full startup/sleep/network recovery, threat-model hardening, packaging, and release acceptance. F14 supplies concrete process, evidence, redaction, and restart cases.
- The F14 checklist item is checked for the implemented validation runner, result model, and provider context handoff. F15 still owns provider invocation, while Review Bundles, synchronization, and publication remain downstream.

## Requirement-to-Slice Trace

| Requirement family | Owning slices |
|---|---|
| FR-01 | 1, 6 |
| FR-02 | 3, 6 |
| FR-03 | 1-2, 4, 6 |
| FR-04 | 2-4, 6 |
| FR-05 | 2, 5-6 |
| FR-06 | 3, 5-6 |
| FR-07 | 1, 4-6 |
| NFR-01-NFR-08 | 1-6 |
| INV-01-INV-10 | 1-6 |
| APP-AC-13 | 1-6 |
| APP-AC-39 | 1, 3, 5-6 |
| APP-AC-48 | 3-4, 6 |
| APP-AC-49 | 1, 5-6 |
| APP-AC-56 | 3-4, 6 |
| APP-AC-57 | 3-4, 6 |
| APP-AC-73-APP-AC-75 | 1, 3, 5-6 |
