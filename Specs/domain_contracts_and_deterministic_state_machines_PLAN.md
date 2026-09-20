<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single layer. The goal of vertical layers is to provide the AI and the user with a visible and testable result when the work is complete. This improves the reliability of AI's output by providing rapid feedback.
Note that while we're mentioning Stories here, we're not actually using tickets, this is just a convenient way of identifying slices within a plan. There might be slices that are needed to describe work that doesn't extend through all levels, that's fine, but the preference should be towards vertical slices since this feature is a contract-only foundation.
-->

# Plan: F02 Domain Contracts and Deterministic State Machines

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** `Specs/domain_contracts_and_deterministic_state_machines_PRD.md`
>
> **Last revalidated against:** `Specs/application_overview.md` revision 2026-09-20 and F02 PRD revision 2026-09-20
>
> **Entry/readiness gates:** F01 is complete and its root TypeScript/build/test/import-boundary gates are green. The implementation may add shared domain source and tests, but it must not require F03 SQLite, F04 IPC, GitHub credentials, an AI provider, Git operations, or product-service network access.
>
> This PLAN cannot change product requirements. Resolve contradictions in the owning PRD before implementation and rerun both specification linters. This feature does not check the checklist item; implementation and approval are separate.

## Implementation Boundary

F02 adds a pure, provider-neutral domain contract module in the F01 shared boundary, proposed as `apps/desktop/src/shared/domain`. It defines serializable IDs, instants, results, errors, reason data, transition events, primary PR state, Review Bundle state, synchronization overlays, publication phases, holds, event-version associations, and deterministic conformance tests.

The module is a decision engine, not an effect engine. It returns a new state or a safe rejection and leaves persistence, transaction commits, IPC, UI, Git, GitHub, AI, notifications, filesystem changes, process control, and publication to downstream features. F03 may persist the returned transition events; F04 may expose them through validated IPC; F11/F18/F23-F28 may supply the guards and side-effect evidence required by the reducers.

## Readiness Gates

- F01's TypeScript, lint, format, unit/integration, and root check commands pass from a clean checkout.
- The shared boundary permits the new domain module to be imported by main and renderer-safe shared code without importing Electron, React, SQLite, Git, GitHub, AI SDK, or OS adapters.
- The application overview's four primary PR states, Review Bundle states, synchronization statuses, global pause distinction, review hold semantics, and publication recovery rules are treated as source requirements.
- Test infrastructure supports fixed clocks, deterministic serialized fixtures, concurrent admission attempts, simulated restart, and bounded output without product-service access.

## Proposed Vertical Slices

1. **Provider-neutral identifiers, time, results, and reason contracts**
   - **Blocked by:** F01 shared TypeScript boundary and test harness.
   - **Stories / requirements / acceptance criteria:** US-01-US-02; FR-01.1-FR-02.5; FR-10.1-FR-10.4; FR-11.1; NFR-01-NFR-07; INV-01-INV-03, INV-08, INV-10; AC-01-AC-03, AC-17.
   - **Visible result:** A shared domain module can parse/serialize provider-neutral IDs, UTC instants, schema-versioned records, success/error results, and actionable reasons. The fixture report shows stable results for the same input and rejects forbidden values.
   - **Durable records / external effects:** Adds source types, runtime validators, transition-event DTOs, and fixtures only. No database or external effect is created.
   - **Failure / cancellation / restart:** Invalid IDs, malformed instants, unsupported schema versions, unsafe detail fields, and forbidden SDK/credential-shaped values fail closed. Fixed-clock replays return the same serialized result after a simulated restart. There is no background operation to resume or cancel.
   - **Exact evidence:** TypeScript compile/import-boundary report; canonical serialization round trips; fixed-clock replay table; unknown-version/field rejection; secret-shaped and forbidden-object scan; error-code/category/retryability/action table; `git diff --check`.
   - **Exit criterion:** AC-01-AC-03 and AC-17 pass, FR-01/FR-02/FR-10 public contracts are covered, and the module has no privileged/provider imports.

2. **Primary PR state, hold, and automatic-operation admission**
   - **Blocked by:** Slice 1.
   - **Stories / requirements / acceptance criteria:** US-03-US-05; FR-03.1-FR-04.6; FR-09.1-FR-09.5; NFR-01, NFR-03, NFR-06, NFR-08; INV-02, INV-04, INV-06, INV-07; APP-AC-16; AC-04-AC-09, AC-14, AC-18.
   - **Visible result:** A table-driven reducer accepts a valid `WATCHING -> WORKING -> READY_FOR_REVIEW/NEEDS_ATTENTION` flow, exposes the hold, and rejects automatic work while held or globally paused. Explicit continuation includes an action and operation/bundle association.
   - **Durable records / external effects:** Produces serializable primary-state snapshots, hold records, transition events, and operation-admission decisions. Later persistence owns transaction commits; no worktree or AI process starts here.
   - **Failure / cancellation / restart:** Concurrent dispatch attempts admit at most one operation. Renderer close, restart, sleep, notification opening, and pause toggles do not clear the hold. Invalid, empty, paused, held, or duplicate dispatches return safe reasons with no compensating state mutation. Explicit cancellation is represented as a blocking reason and never as successful completion.
   - **Exact evidence:** Exhaustive primary-state transition table; hold acquire/release tests; concurrent admission race; duplicate action replay; renderer-close/restart/sleep fixture; pause overlay matrix; explicit-action authorization test; no-AI/no-external-call assertion.
   - **Exit criterion:** AC-04-AC-09, AC-14, and AC-18 pass; downstream scheduling can consume one documented admission/hold contract without inventing transitions.

3. **Immutable event-version association and Review Bundle lifecycle**
   - **Blocked by:** Slice 2.
   - **Stories / requirements / acceptance criteria:** US-05-US-06; FR-05.1-FR-06.5; FR-10.2-FR-10.4; NFR-01-NFR-04, NFR-06-NFR-08; INV-04-INV-06, INV-10; APP-AC-24, APP-AC-25; AC-09-AC-13, AC-18.
   - **Visible result:** A conformance harness shows a remote event version being retained during active work/hold, claimed once by a bundle, marked handled after publish/discard, and never reintroduced by duplicate delivery. A Review Bundle reducer exposes all legal states and rejects illegal transitions.
   - **Durable records / external effects:** Adds immutable association records, bundle transition events, stale markers, and terminal outcome fixtures. F03 later persists them; no remote event is fetched and no bundle UI is added.
   - **Failure / cancellation / restart:** Duplicate versions return the prior association. Changed semantic snapshots require a new version key. Failed/restarted reducers preserve prior history. A stale bundle remains inspectable and non-publishable until explicit re-evaluation or discard; no background action releases a hold.
   - **Exact evidence:** Association state machine table; duplicate/idempotency and new-version tests; publish/discard monotonicity test; held-feedback retention matrix; complete Review Bundle legal/illegal transition matrix; stale/re-evaluate/discard fixtures; terminal-history immutability and round-trip tests.
   - **Exit criterion:** AC-09-AC-13 and AC-18 pass; F11/F18 can implement event eligibility and Review Bundle preparation without changing the handled-version or hold semantics.

4. **Synchronization overlay and deterministic reason contract**
   - **Blocked by:** Slices 1-3.
   - **Stories / requirements / acceptance criteria:** US-06-US-07; FR-07.1-FR-07.8; FR-09.1-FR-09.5; FR-10.3-FR-10.4; NFR-01-NFR-06, NFR-08; INV-02, INV-07, INV-10; APP-AC-49; AC-03, AC-13-AC-15, AC-18.
   - **Visible result:** A synchronization result can move independently through `SKIPPED`, `MERGING`, `RESOLVING_CONFLICTS`, `READY_TO_PUBLISH`, `NEEDS_ATTENTION`, `STALE`, `PUBLISHING`, `PUBLISHED`, `DISCARDED`, and `FAILED` while the PR retains its primary review state. Each actionable status has structured what/why/next reason data.
   - **Durable records / external effects:** Adds serialized synchronization status/reason DTOs and per-result transition fixtures. No Git merge, SHA lookup, worktree creation, or UI rendering occurs.
   - **Failure / cancellation / restart:** One result's failure does not transition another result. Unknown status or stale result fails closed. Restart replay preserves the operation/worktree/source/head references and status. Clean-merge and conflict-resolution paths remain distinguishable and do not imply AI usage.
   - **Exact evidence:** Overlay independence matrix; per-result isolation test; status/reason truth table; stale publication guard; restart serialization; clean/no-AI versus conflict/AI-required contract fixture; safe-reason scan; application-coverage evidence for APP-AC-49.
   - **Exit criterion:** AC-13-AC-15 and AC-18 pass; F23-F25 can persist and present synchronization outcomes without adding a competing PR state machine.

5. **Publication phases, recovery, and idempotency**
   - **Blocked by:** Slice 4.
   - **Stories / requirements / acceptance criteria:** US-08; FR-08.1-FR-08.9; FR-09.4-FR-09.5; FR-10.2-FR-10.4; FR-11.2-FR-11.4; NFR-01-NFR-04, NFR-06-NFR-08; INV-08-INV-10; APP-AC-68; AC-03, AC-08, AC-15-AC-18.
   - **Visible result:** A publication reducer requires explicit approval, tracks its idempotency key and known commit/response identifiers, enters `RECOVERING` for uncertain side effects, and reaches `PUBLISHED` or `PUBLISHED_WITH_ERRORS` only through deterministic reconciliation. Replaying the same key returns the existing outcome.
   - **Durable records / external effects:** Adds phase transition records, approval references, recovery fixtures, response-state DTOs, and idempotency tables. No commit, push, response post, or network call is performed by F02.
   - **Failure / cancellation / restart:** Cancellation before side effects may fail/discard according to the phase rules. Cancellation or process restart after a possible side effect produces an uncertain/recovery state, never a fresh publication intent. Known commit SHAs and response IDs are retained. `PUBLISHED_WITH_ERRORS` prevents duplicate code publication while response reconciliation remains incomplete.
   - **Exact evidence:** Complete publication phase transition table; approval-before-side-effect test; duplicate-key replay; commit/push/response uncertain-outcome matrix; recovery with known IDs; `PUBLISHED_WITH_ERRORS` no-republish guard; force-push/autonomous-publication negative tests; restart/sleep/network-interruption fixtures; application-coverage evidence for APP-AC-68.
   - **Exit criterion:** AC-15-AC-18 pass; F27/F28 can implement durable publication without inventing recovery states or duplicate-prevention behavior.

6. **Cross-consumer conformance and F02 handoff**
   - **Blocked by:** Slices 1-5.
   - **Stories / requirements / acceptance criteria:** US-01-US-08; all FRs, NFRs, and INVs; all mapped APP-AC criteria; AC-01-AC-18.
   - **Visible result:** Two thin consumers, one review-oriented and one synchronization-oriented, run the same contract suite and receive the same state, reason, hold, event-association, and idempotency semantics. The report identifies the contracts F03/F04/F11/F18/F23-F28 must consume.
   - **Durable records / external effects:** Adds conformance fixtures, traceability metadata, and root test integration only. It must not add a database, service credential, product-network call, checklist edit, or external publication.
   - **Failure / cancellation / restart:** Any mismatch, missing transition, unknown value, secret leak, or forbidden import fails the gate. A cancelled/restarted test run leaves no success marker and can be rerun from a fresh process. No linter key is committed or printed.
   - **Exact evidence:** `npm run build`, `npm test`, `npm run check`; exhaustive transition/guard report; both consumer conformance reports; forbidden-import report; secret scan; round-trip/unknown-version report; `git diff --check`; required `lint:prd-plan` and `lint:application-coverage` runs against the final documents.
   - **Exit criterion:** All F02 requirements and mapped criteria have direct evidence, both specification linters pass with no definite missing mappings or invalid references, and the checklist item remains unchecked pending implementation approval.

## Cross-Slice Verification and Handoff

- The exact owning PRD is `Specs/domain_contracts_and_deterministic_state_machines_PRD.md`; this plan does not add product requirements or claim downstream persistence, UI, GitHub, AI, or publication behavior.
- The public domain module is pure and renderer-safe. It may use runtime schema validation and immutable data helpers, but it must not import Electron, React, SQLite, Git, GitHub SDKs, AI SDKs, provider adapters, OS adapters, or environment/process APIs.
- F03 must persist transition events, holds, event-version associations, operation admission, and publication records transactionally. It must not collapse a historical association into only a mutable current-state column.
- F04 must expose state-changing operations only through validated main-process IPC. Renderer closure cannot cancel a state transition or release a hold merely by destroying a window.
- F11/F18 must use the primary-state/hold/event-association contracts for automatic review. A new event version observed during a hold remains separate; it is not appended to the active bundle by polling.
- F23-F25 must use the synchronization overlay and preserve per-result isolation. Synchronization state must never be encoded by changing the PR primary state to a synchronization label.
- F27/F28 must use publication idempotency keys and recovery phases. A network timeout after a possible side effect must reconcile the existing intent; it must not create a new key as an automatic retry.
- The domain contract does not decide whether a remote SHA, validation result, or AI operation is semantically acceptable; downstream deterministic services supply those facts and invoke the documented triggers.
- F02 does not close its checklist item by adding types alone. The item remains unchecked until the contract tests, downstream integration evidence, and the implementation workflow's required gates are complete.
