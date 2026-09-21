<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single layer. The goal is to provide the AI and the user with a visible and testable result when the work is complete.
-->

# Plan: F07 Add and Manage a Pull Request

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** `Specs/add_and_manage_a_pull_request_PRD.md`
>
> **Last revalidated against:** `Specs/application_overview.md` revision 2026-09-21 and F07 PRD revision 2026-09-21
>
> **Entry/readiness gates:** F03 persistence health, managed-PR repository, transaction, optimistic-version, and immutable-snapshot contracts are green. F04 validated IPC, renderer-session, and main-process lifecycle contracts are available. F05 exposes a verified server-bound request capability. F06 exposes the supported PR URL parser, PR metadata client, explicit remote identities, and safe failure results. Test infrastructure provides temporary Git repositories, fake F05/F06 consumers, path-policy fixtures, injected clocks/cancellation, renderer recreation, and persistence fault injection.
>
> This PLAN cannot change product requirements. Resolve contradictions in the owning PRD before implementation and rerun both specification linters. This feature does not check the checklist item; implementation and approval are separate.

## Implementation Boundary

F07 extends the main-process/shared application boundary with an Add PR coordinator, a managed-PR read model, a bounded local-clone candidate/inspection service, and a versioned PR-configuration service. The renderer receives safe projections and submits typed requests through F04; it never owns the managed-PR record, the remote metadata request, the local path decision, or the configuration revision.

F07 consumes F05 and F06 rather than reimplementing authentication, URL parsing, HTTP transport, or remote identity. It uses F03 transactions and repositories for Add PR intent, managed-PR creation, local-clone association, configuration revisions, optimistic concurrency, and restart-safe outcomes. The local Git inspector is read-only and is not the F13 worktree manager. F07 does not poll, create operation worktrees, run validation, invoke AI, resolve synchronization sources, publish GitHub changes, or modify a developer repository.

## Readiness Gates

- F02's primary PR state, reason, and overlay contracts are available; F07 does not add a clone or setup state to the primary state machine.
- F03 can persist an Add PR intent before an external request, commit the managed-PR aggregate atomically, enforce canonical identity uniqueness, retain immutable configuration revisions, and return stale-writer conflicts.
- F04 can expose versioned Add PR/read-model commands, safe error results, a main-process folder-picker request, and renderer-close/reopen behavior without cancelling authoritative work.
- F05 can resolve a verified server profile and request-scoped capability; no raw token is exposed to F07.
- F06 can parse supported PR URLs, fetch and validate metadata, preserve base/head/default-branch identities, and normalize inaccessible/ambiguous outcomes.
- The test harness can create temporary Git repositories with HTTPS/SSH/local remotes, forks, dirty/untracked files, missing paths, bare repositories, and malformed remotes without contacting a real server.
- The supported runtime has bounded process execution and path canonicalization behavior for the read-only Git inspection contract; any platform-specific folder selection remains behind the main-process/OS adapter.

## Proposed Vertical Slices

1. **Canonical Add PR input and persist-before-fetch intent**
   - **Blocked by:** F03 transaction/idempotency ports, F04 validated IPC, F05 verified server-profile capability, and F06 URL parser.
   - **Stories / requirements / acceptance criteria:** US-01, US-03, US-10; FR-01.1-FR-01.3, FR-01.6, FR-02.1, FR-02.5-FR-02.6, FR-08.1-FR-08.3; NFR-01-NFR-02, NFR-04-NFR-05, NFR-08-NFR-09; INV-01-INV-04, INV-06; AC-01-AC-02, AC-05-AC-06, AC-17-AC-18.
   - **Visible result:** The Add PR surface accepts a bounded URL, shows the canonical F06 identity and verified-server status, rejects invalid/unverified input before a network call, and reports a typed pending/failed/retryable Add PR attempt.
   - **Durable records / external effects:** Creates an Add PR intent with canonical parsed input, F05 profile identity, correlation/idempotency identity, and input snapshot before F06 metadata retrieval. No managed PR is committed until metadata is validated; no credential is copied into the operation.
   - **Failure / cancellation / restart:** Malformed input, missing verification, cancellation, renderer close, process stop, and F06 request failure leave no guessed managed PR. A committed intent remains readable as pending, cancelled, failed, or recovery-required; retry returns/reconciles the existing identity rather than creating a second attempt.
   - **Exact evidence:** URL/profile handoff matrix; pre-network persistence probe; invalid-input/no-request assertions; duplicate concurrent add race; cancellation and renderer-disconnect fixture; restart readback; secret/raw-token/absolute-remote-URL scan; accessible Add PR validation states.
   - **Exit criterion:** AC-01, AC-02, AC-05, AC-06, AC-17, and AC-18 pass, and F07 has one durable add-intent contract with no duplicate URL/parser/auth implementation.

2. **Remote metadata and atomic managed-PR creation**
   - **Blocked by:** Slice 1, F03 managed-PR repository, and F06 validated metadata result.
   - **Stories / requirements / acceptance criteria:** US-01-US-03, US-10; FR-01.4-FR-01.6, FR-02.1-FR-02.6, FR-04.1, FR-04.3-FR-04.5; NFR-01-NFR-02, NFR-04-NFR-06, NFR-08; INV-01-INV-04, INV-06, INV-08; APP-AC-02, APP-AC-44; AC-03-AC-06, AC-10-AC-12, AC-17-AC-18.
   - **Visible result:** After a successful remote request, the user sees one managed PR with its canonical URL, PR state, base/head repositories, branches, SHAs, informational default branch, current primary state, and local setup status. A URL-only flow can finish with `LOCAL_CLONE_REQUIRED`.
   - **Durable records / external effects:** In one F03 transaction, commits the remote metadata snapshot, canonical managed-PR identity, initial configuration revision, local setup status/optional association, primary state, projection version, and successful Add PR outcome. The API default branch is stored as informational metadata only.
   - **Failure / cancellation / restart:** Not-found, forbidden, rate-limit, timeout, malformed, deleted-head, and server-identity failures do not partially create or overwrite a managed PR. An existing record remains unchanged. A process stop before commit exposes the add intent; a stop after commit exposes the complete aggregate.
   - **Exact evidence:** Ordinary and fork PR fixture matrix; base/head/default-branch field separation; unavailable-head representation; atomic commit fault table at each aggregate write; duplicate identity/operation replay; current projection/history comparison; restart readback; no-implicit-default-branch assertion.
   - **Exit criterion:** AC-03-AC-06, AC-10-AC-12, and APP-AC-02/44 handoff evidence pass, with one durable managed-PR identity and no incomplete remote aggregate visible as success.

3. **Bounded local-clone candidates, selection, and read-only validation**
   - **Blocked by:** Slice 2, F03 local association repository, F04 folder-picker contract, and a read-only Git inspector test harness.
   - **Stories / requirements / acceptance criteria:** US-04-US-06, US-10-US-11; FR-03.1-FR-03.8, FR-04.2, FR-04.4-FR-04.5, FR-08.4; NFR-03, NFR-05, NFR-07, NFR-09; INV-03, INV-05, INV-08; AC-07-AC-11, AC-12, AC-18-AC-19.
   - **Visible result:** The PR details flow suggests only known candidates, lets the user browse for an existing directory, validates a matching base clone, shows clean/dirty/missing/invalid setup status, and offers **Add without local clone** when appropriate.
   - **Durable records / external effects:** Persists only a canonical local repository root, parsed safe identity, validation timestamp/version, and bounded clean/dirty/unknown status. Git inspection uses read-only commands; it does not fetch or mutate. A missing clone association remains actionable and separate from primary PR state.
   - **Failure / cancellation / restart:** Missing, inaccessible, bare, non-Git, identity-mismatched, ambiguous, unsafe, or moved paths return specific remediation and leave the previous valid association intact. Dirty/untracked files are accepted and preserved. Cancellation or renderer close drops only the UI reply; a committed association survives.
   - **Exact evidence:** Candidate-boundedness test; folder-picker/path-policy matrix; matching base remote cases for HTTPS/SSH forms; fork and same-name mismatch negatives; dirty/untracked fixture; bare/non-repository/missing/moved path matrix; command allowlist and no-mutation probe; raw-remote/credential redaction scan; restart readback.
   - **Exit criterion:** AC-07-AC-12 and AC-18-AC-19 pass; a valid clone is proven without destructive Git behavior, and no-clone onboarding is explicit and actionable.

4. **Versioned PR Intent / Context and synchronization override editing**
   - **Blocked by:** Slices 2-3, F03 immutable revision/optimistic-concurrency repositories, and F02 historical snapshot semantics.
   - **Stories / requirements / acceptance criteria:** US-07-US-09, US-10-US-11; FR-04.2-FR-04.3, FR-05.1-FR-05.6, FR-06.1-FR-06.5, FR-07.1-FR-07.4, FR-08.4; NFR-01-NFR-02, NFR-04-NFR-05, NFR-07-NFR-09; INV-03, INV-06-INV-07, INV-09; APP-AC-40-AC-42, APP-AC-44; AC-12-AC-17, AC-19.
   - **Visible result:** The Add PR and details surfaces can save bounded multi-line context and an optional validated branch override. The current revision is visible, and a stale editor receives a conflict rather than silently overwriting another edit.
   - **Durable records / external effects:** Adds immutable per-PR configuration-revision records with content hash, context presence/content, override presence/value, source metadata, and revision identity; atomically moves the managed-PR current pointer. Downstream operation/bundle consumers receive the revision identity but F07 does not create their snapshots.
   - **Failure / cancellation / restart:** Oversized/invalid context or ref input is rejected before commit. Blank context/override remains distinct from non-blank values. A stale revision cannot overwrite current data. Editing while `WORKING` or held does not release the hold, reset a budget, mutate a worktree, or silently begin a new operation. Historical snapshots remain unchanged after restart.
   - **Exact evidence:** Multiline/whitespace/size truth table; branch-ref validation corpus; blank-versus-value persistence matrix; atomic revision fault injection; stale concurrent edit race; byte-for-byte historical snapshot/hash test; held/working edit negative-effects test; accessible form/error/focus report.
   - **Exit criterion:** AC-12-AC-17 and AC-19 pass, APP-AC-40/41/42/44 boundaries are explicit, and future work can consume one immutable configuration revision without inventing edit semantics.

5. **Restart-safe read model, recovery actions, and end-to-end management surface**
   - **Blocked by:** Slices 1-4 plus F04 renderer recreation and main-process read-model delivery.
   - **Stories / requirements / acceptance criteria:** US-01-US-11; all FRs, NFRs, and INVs; APP-AC-02, APP-AC-40-AC-42, APP-AC-44; AC-01-AC-19.
   - **Visible result:** A recreated renderer can add, inspect, attach/replace/clear a clone, edit configuration, retry an incomplete attempt, and recover from conflicts using current persisted state. Statuses explain what happened, why it matters, and what to do next.
   - **Durable records / external effects:** Exercises the complete F03 Add PR, managed-PR, local-association, and configuration-revision records through typed IPC/read models. No polling, AI, worktree, validation, synchronization, or publication side effect is added.
   - **Failure / cancellation / restart:** Faults at every persist-before-fetch and commit boundary distinguish not-started, pending, committed, failed, cancelled, and recovery-required outcomes. Renderer closure cannot release holds or reset operation history. A retry is idempotent, and historical revisions remain inspectable.
   - **Exact evidence:** Electron add/details smoke; renderer close/reopen/readback; process restart matrix; recovery-action table; duplicate submission and stale-edit tests; primary-state/setup-overlay independence test; accessibility keyboard/screen-reader review; no-secret/no-raw-remote read-model and diagnostics scan.
   - **Exit criterion:** All F07 acceptance criteria pass end to end, the renderer is only a view/controller, and the managed-PR handoff contracts for F08/F10/F13/F16/F18/F24 are recorded.

6. **Downstream contract conformance and specification handoff**
   - **Blocked by:** Slices 1-5 and all readiness gates.
   - **Stories / requirements / acceptance criteria:** US-01-US-11; all FRs, NFRs, and INVs; APP-AC-02, APP-AC-40-AC-42, APP-AC-44; AC-01-AC-19; CT-F07-01 through CT-F07-06.
   - **Visible result:** Thin fake consumers prove that F08 can read multiple managed PRs, F10 can observe explicit remote identity, F13 can revalidate a local clone before worktree creation, F16/F18 can snapshot the current PR configuration, and F24 can consume base/override fields without default-branch substitution.
   - **Durable records / external effects:** Keeps only test-owned temporary repositories, databases, and bounded reports. It does not edit `checklist.md`, publish specifications, invoke real GitHub, use credentials, or perform remote Git effects.
   - **Failure / cancellation / restart:** Any missing identity field, secret leak, duplicate, unsafe Git command, lost revision, invalid mapping, or cross-feature state mutation blocks the gate. A cancelled run leaves no success marker and is rerunnable from fresh owned fixtures.
   - **Exact evidence:** `npm run build`, `npm test`, `npm run check`; managed-PR/revision/restart report; local Git read-only report; IPC/import-boundary report; secret/raw-remote/path scan; consumer contract matrix; `git diff --check`; `npm run lint:prd-plan -- Specs/add_and_manage_a_pull_request_PRD.md Specs/add_and_manage_a_pull_request_PLAN.md`; `npm run lint:application-coverage -- Specs/application_overview.md Specs/add_and_manage_a_pull_request_PRD.md`.
   - **Exit criterion:** All F07 requirements have direct evidence, the five application-coverage mappings have no definite missing/invalid result, unresolved product choices are recorded, and the checklist item remains unchecked pending implementation approval and completion.

## Cross-Slice Verification and Handoff

- The exact owning PRD is `Specs/add_and_manage_a_pull_request_PRD.md`; this PLAN does not add polling, AI, worktree mutation, validation execution, synchronization merge, publication, notification, or archival requirements.
- F03 remains authoritative for SQLite, migrations, transactions, idempotency, optimistic concurrency, managed-PR persistence, and immutable revisions. F07 never writes ad hoc SQLite state or stores a partial remote aggregate as a successful PR.
- F04 remains authoritative for main-process ownership, renderer lifecycle, validated IPC, folder-picker handoff, and read-model hydration. Renderer close/reload only affects delivery of replies; it does not cancel a committed Add PR operation or edit.
- F05 remains authoritative for server profiles and credentials. F07 receives only a verified server-bound capability/result and never persists, logs, or forwards raw tokens.
- F06 remains authoritative for URL parsing, GitHub REST requests, remote identity codecs, base/head/default-branch distinctions, and normalized remote failures. F07 persists the result and owns the product workflow around it.
- F07's `LOCAL_CLONE_REQUIRED`/`VALID`/`DIRTY`/`MISSING`/`INVALID` values are a local-access projection, not additions to F02's primary PR state or synchronization overlay. F08 owns inbox presentation; F10-F12 own monitoring admission and scheduling.
- F13 must revalidate the stored clone at operation start and use a separate operation-owned worktree. It must not treat F07's prior validation timestamp as permission to mutate the developer clone.
- F16/F18/F21 must snapshot the current PR configuration revision into their own immutable operation/bundle inputs. Editing F07's current pointer never rewrites those snapshots or releases an F02 hold.
- F24 owns effective synchronization-source resolution and confirmation. A blank F07 override means the PR's explicit `base.ref`, not the repository API default branch; F07 does not fetch or resolve the branch.
- F28 owns complete startup/sleep/network/orphan recovery. F07 exposes incomplete Add PR/configuration outcomes and safe retry/repair actions but never auto-authorizes an external side effect after an uncertain boundary.
- F29/F30 own final threat-model and clean-machine/release evidence. F07 still supplies concrete path, Git-argument, secret-redaction, accessibility, and GHES/fork contract evidence.
- The F07 checklist item remains unchecked. This specification phase creates only the PRD/PLAN pair and does not claim that an Add PR form, local inspector, or persistence contract completes the feature.

## Requirement-to-Slice Trace

| Requirement family | Owning slices |
| --- | --- |
| FR-01 | 1-2, 5-6 |
| FR-02 | 1-2, 5-6 |
| FR-03 | 3, 5-6 |
| FR-04 | 2-5, 6 |
| FR-05 | 4-6 |
| FR-06 | 4-6 |
| FR-07 | 4-6 |
| FR-08 | 1, 3-6 |
| NFR-01-NFR-09 | 1-6 |
| INV-01-INV-09 | 1-6 |
| APP-AC-02 | 1-3, 5-6 |
| APP-AC-40-AC-42 | 4-6 |
| APP-AC-44 | 2, 4, 6 |
