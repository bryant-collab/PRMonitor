<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single layer. The goal is to provide the AI and the user with a visible and testable result when the work is complete.
There might be slices that are needed to describe work that doesn't extend through all levels, that's fine, but the preference should be towards vertical slices since this will result in the best quality output.
-->

# Plan: F10 Independent, Efficient PR Feedback Polling

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** `Specs/independent_efficient_pr_feedback_polling_PRD.md`
>
> **Last revalidated against:** `Specs/application_overview.md` revision 2026-09-21 and F10 PRD revision 2026-09-21
>
> **Entry/readiness gates:** F03 exposes main-process transactions, independently scoped resource checkpoints, immutable remote-event/version repositories, optimistic/idempotent writes, injected clocks, and restart-safe recovery records. F06 exposes typed PR metadata, inline-comment, review, and issue-comment operations with server-scoped identities, conditional metadata, validated pagination, bounded responses, and safe outcomes. F07 exposes the authoritative managed-PR set and explicit server/repository/PR configuration. F08 exposes the primary read-model conventions without making the renderer authoritative. F09 exposes the safe structured activity writer. Tests can inject transport, clock, persistence faults, cancellation, renderer absence, process interruption, AI/Git/validation spies, forks, missing timestamps, and GHES fixtures.
>
> This PLAN cannot change product requirements. Resolve contradictions in the owning PRD before implementation and rerun both specification linters. This feature does not check the checklist item; implementation and approval are separate.

## Implementation Boundary

F10 adds the main-process `PrWatcher` coordinator, polling configuration and
invocation contracts, per-resource attempt orchestration, normalized feedback
version construction, and F03 transaction adapters for poll intents,
checkpoints, current PR metadata, and immutable observed versions. It uses F06
for all GitHub REST requests and F09 for diagnostics.

F10 owns deterministic observation and durable input history. F03 remains the
authority for SQLite, migrations, transactions, and append-only storage. F06
remains the authority for authenticated GitHub requests, transport limits,
conditional response metadata, pagination decoding, and remote identities. F07
owns managed-PR configuration. F11 owns eligibility, deduplication decisions
for automatic analysis, and holds; F12 owns scheduling, Check Now, and global
pause; F08/F09/F19 own presentation and user-facing diagnostics. F10 does not
invoke AI, mutate a worktree, run validation, post a response, or publish.

## Readiness Gates

- F03 can persist a poll intent before an external request and can atomically commit a complete resource outcome with its checkpoint candidate, normalized current metadata, immutable versions, and safe recovery status.
- F03 can enforce scoped uniqueness for `(server, repository, pull request, resource, remote object, semantic version)` and return replay/conflict outcomes without rewriting immutable history.
- F06 can independently request all four resource categories, distinguish `304` from changed content, return validated continuation state, and preserve semantic fields when timestamps are missing or unreliable.
- F07 can enumerate managed PRs and provide explicit server, repository, PR, base/head, and current configuration identities after restart.
- F08/F04 can keep main-process work alive after renderer destruction and can consume a fresh read model without treating F10 activity text as state.
- F09 can append bounded correlation/resource activity, and activity failure is represented as diagnostic degradation rather than poll success.
- The test harness can create multiple managed PRs, fork/deleted-head identities, independent resource responses, page faults, `304` responses, persistence faults, cancellations, process-stop/restart points, and no-effect spies without real credentials.

## Proposed Vertical Slices

1. **Polling configuration, scoped intent, and coordinator contract**
   - **Blocked by:** F03 transaction/idempotency contracts, F07 managed-PR enumeration, F04 main-process lifecycle, and the shared F10 schemas.
   - **Stories / requirements / acceptance criteria:** US-01-US-02, US-08; FR-01.1-FR-01.6, FR-06.2-FR-06.4; NFR-01, NFR-03, NFR-07-NFR-08; INV-01-INV-03, INV-06, INV-08; AC-01-AC-02, AC-12, AC-14-AC-15; CT-F10-01, CT-F10-06.
   - **Visible result:** A deterministic main-process coordinator accepts a managed-PR set and a scheduler invocation, applies the ten-minute default and one-minute-through-24-hour interval contract, creates one scoped `PollRun`/`PollResourceAttempt` intent before any transport call, and rejects overlapping work safely.
   - **Durable records / external effects:** Adds or consumes F03-backed poll-run/resource-attempt records, immutable request/configuration snapshots, correlation IDs, and safe outcome states. Contract fixtures use no GitHub network, AI provider, Git, worktree, validation, notification, or publication effect.
   - **Failure / cancellation / restart:** Invalid scope, duplicate invocation, renderer absence, cancellation before intent commit, and process stop before request produce no false success. A committed intent remains pending/interrupted/retryable for startup reconciliation; it cannot be silently replaced by a new identity.
   - **Exact evidence:** Poll configuration truth table; multi-PR and cross-scope identity matrix; overlapping-attempt race; persist-before-request probe; renderer-absent execution; cancellation before commit; process-stop/reopen readback; bounded concurrency and no-AI/no-Git spy report; `CT-F10-01` and `CT-F10-06`.
   - **Exit criterion:** AC-01-AC-03, AC-14, and AC-15 pass at the coordinator boundary, and F10 has one scheduler-facing invocation contract with no renderer or provider dependency.

2. **Independent four-resource polling and conditional/pagination handoff**
   - **Blocked by:** Slice 1, F06 resource clients, and F03 checkpoint transactions.
   - **Stories / requirements / acceptance criteria:** US-03-US-04; FR-02.1-FR-03.5, FR-06.1-FR-06.2; NFR-02, NFR-04, NFR-06-NFR-08; INV-02-INV-03, INV-06; AC-03, AC-05-AC-07, AC-12; CT-F10-02, CT-F10-03.
   - **Visible result:** A fake GitHub trace shows PR metadata, inline review comments, reviews/review bodies, and issue comments being checked independently; a metadata `304` does not suppress changed feedback, and each resource advances only its own complete checkpoint.
   - **Durable records / external effects:** Writes per-resource attempt results, ETag/Last-Modified metadata, validated continuation state, completion marker, and safe current PR metadata through F03. Fake transport is the only external effect in the default evidence.
   - **Failure / cancellation / restart:** A resource error, `304`, empty result, or page failure affects only that scope. An incomplete sequence does not advance its checkpoint; fully completed sibling resources may commit independently. No resource is reported complete because another resource succeeded.
   - **Exact evidence:** Four-resource request/conditional-header matrix; `304` isolation; changed-behind-unchanged-metadata fixture; multi-page and duplicate-page table; infinite/repeated-page and incomplete-sequence guard; checkpoint-before/after fault injection; F06 handoff and zero-AI report; `CT-F10-02` and `CT-F10-03`.
   - **Exit criterion:** AC-03 and AC-05-AC-07 pass, APP-AC-65's resource-boundary evidence is complete, and F10 can poll every supported feedback resource without resource-specific coupling.

3. **Normalization and immutable semantic version construction**
   - **Blocked by:** Slice 2, F03 immutable-version repository/codecs, and the normalized F06 response contracts.
   - **Stories / requirements / acceptance criteria:** US-05-US-06; FR-04.1-FR-05.6; NFR-01, NFR-03-NFR-06; INV-04-INV-06, INV-10; AC-08-AC-11; CT-F10-04, CT-F10-05.
   - **Visible result:** A fixture containing comments, reviews, review states, bodyless approvals, replies, nullable locations, fork identities, and missing timestamps produces complete provider-neutral observations and stable scoped version keys. Equal replay returns the original version; one semantic edit appends one new version.
   - **Durable records / external effects:** Stores `RemoteReviewEvent`/`ObservedRemoteVersion` snapshots, content hashes, version keys, observed timestamps, source/resource scope, and checkpoint references through F03. It does not attach versions to a Review Bundle or mark them handled.
   - **Failure / cancellation / restart:** Invalid/oversized/secret-shaped fields fail closed before persistence. A semantic hash excludes observation-only fields so repeated polling does not create versions. An immutable predecessor cannot be updated or deleted; replay after restart is idempotent.
   - **Exact evidence:** Canonical serialization vectors; null/absent and Unicode normalization table; changed body/state/author/reply/location/timestamp matrix; missing/unreliable timestamp test; cross-server/repository/PR/source collision test; immutable-update rejection; duplicate replay; raw-payload/credential scan; `CT-F10-04` and `CT-F10-05`.
   - **Exit criterion:** AC-08-AC-11 pass, APP-AC-69's scoped content-hashed version evidence is complete, and F11 can consume immutable version IDs without re-reading mutable GitHub objects.

4. **Atomic complete-resource persistence and recovery**
   - **Blocked by:** Slices 1-3, F03 transaction/fault injection, and F09 diagnostic composition.
   - **Stories / requirements / acceptance criteria:** US-04, US-08; FR-01.4-FR-01.6, FR-03.3-FR-03.4, FR-06.1-FR-06.4, FR-08.1-FR-08.3; NFR-03, NFR-05, NFR-07; INV-06, INV-08, INV-10; AC-07, AC-12, AC-14, AC-17; CT-F10-03, CT-F10-06, CT-F10-07.
   - **Visible result:** Each completed resource produces one restart-safe durable outcome with checkpoint, normalized observations, immutable versions, and correlated diagnostics; failed/incomplete resources remain retryable without losing prior committed history.
   - **Durable records / external effects:** Composes poll attempt, resource result, checkpoint, current metadata/version writes, and safe activity linkage in the declared F03 transaction boundary. F09 receives only bounded diagnostic data; it does not become the source of truth.
   - **Failure / cancellation / restart:** Faults before/between/after writes, cancellation before/after commit, renderer close, process stop, network loss, rate limit, malformed response, and busy/locked persistence produce distinct safe outcomes. A committed resource is visible after restart; an uncommitted one retains the prior checkpoint and no handled/processed marker.
   - **Exact evidence:** Transaction fault matrix; cancellation-before/after-commit; process-stop/reopen; retry and uncertain-read reconciliation; partial sibling-resource result; no checkpoint advance on failed page; F09 append failure; bounded safe error scan; `CT-F10-03`, `CT-F10-06`, and `CT-F10-07`.
   - **Exit criterion:** AC-07, AC-12, AC-14, and AC-17 pass, and no failure at the request/persistence/diagnostic boundary can fabricate successful observation or duplicate immutable history.

5. **Renderer-independent multi-PR and hold-safe downstream handoff**
   - **Blocked by:** Slices 1-4, F04/F08 renderer recreation, F09 activity query, and deterministic F11/F12/F18 fakes.
   - **Stories / requirements / acceptance criteria:** US-01-US-08; FR-01.1-FR-01.2, FR-04.2, FR-05.6, FR-07.1-FR-07.3, FR-08.1-FR-08.3; NFR-01-NFR-08; INV-01-INV-03, INV-07-INV-10; AC-01-AC-04, AC-11, AC-13-AC-17; CT-F10-01, CT-F10-04, CT-F10-07.
   - **Visible result:** With the renderer closed, multiple PRs can be observed concurrently within the configured bound. F08 receives current safe observation summaries, F09 shows correlated activity, and F11 receives new immutable versions observed during `WORKING`, `READY_FOR_REVIEW`, or `NEEDS_ATTENTION` without an automatic worktree/AI side effect.
   - **Durable records / external effects:** Uses test-owned PR/checkpoint/version/activity records and typed downstream DTOs. It does not start batching, AI, worktree, validation, notifications, response posting, commit, push, merge, or publication.
   - **Failure / cancellation / restart:** Renderer recreation only requests a fresh main-process result. A held/working PR remains held/working; new versions are separate. Activity loss is visible as diagnostic degradation and cannot release a hold or advance a checkpoint. Global pause/scheduler decisions remain with F12.
   - **Exact evidence:** 1/2/50/250 managed-PR bounded-concurrency fixture; renderer close/reopen and process restart; primary-state/hold non-mutation assertions; F08/F09 DTO contract; F11 hold-retention and F12 scheduler handoff; no-AI/Git/validation/publication spy; keyboard/screen-reader evidence limited to the consuming F08/F09 surfaces; `CT-F10-01`, `CT-F10-04`, and `CT-F10-07`.
   - **Exit criterion:** APP-AC-03/04/05/06/07/08/25/65/69 handoff evidence has no definite missing mapping, renderer absence is proven, and downstream consumers can use F10's typed outcomes without parsing logs or taking ownership of polling state.

6. **Conformance, specification gate, and implementation handoff**
   - **Blocked by:** Slices 1-5, all readiness gates, and the final contract-test matrix.
   - **Stories / requirements / acceptance criteria:** US-01-US-08; all FRs, NFRs, and INVs; AC-01-AC-17; CT-F10-01-CT-F10-07; APP-AC-03-AC-08, APP-AC-25, APP-AC-65, APP-AC-69.
   - **Visible result:** A machine-readable conformance report demonstrates deterministic, renderer-independent observation, independent resource freshness, immutable semantic history, safe recovery, and zero AI/Git/publication effects using test-owned fixtures.
   - **Durable records / external effects:** Keeps only temporary databases, fake transport traces, bounded activity/test reports, and linter evidence. It does not edit `checklist.md`, publish specifications, use credentials, or contact real GitHub/AI services.
   - **Failure / cancellation / restart:** Any invalid scope, cross-resource collision, missing checkpoint, secret leak, false success, duplicate version, AI/provider call, unbounded retry, hold mutation, or invalid application-coverage mapping blocks the gate. A cancelled run leaves no success marker and is rerunnable from fresh fixtures.
   - **Exact evidence:** `npm run build`, `npm test`, `npm run check`; CT-F10-01 through CT-F10-07; request/checkpoint/version/recovery reports; secret/raw-SDK/raw-header scan; import-boundary report; APP-AC coverage report; `git diff --check`; `npm run lint:prd-plan -- Specs/independent_efficient_pr_feedback_polling_PRD.md Specs/independent_efficient_pr_feedback_polling_PLAN.md`; `npm run lint:application-coverage -- Specs/application_overview.md Specs/independent_efficient_pr_feedback_polling_PRD.md`.
   - **Exit criterion:** All F10 requirements have direct evidence, both specification linters report no definite missing/invalid result, unresolved product choices are recorded, and the F10 checklist item remains unchecked pending implementation approval and completion.

## Cross-Slice Verification and Handoff

- The exact owning PRD is `Specs/independent_efficient_pr_feedback_polling_PRD.md`; this PLAN does not add semantic feedback classification, batching, AI work, worktree mutation, validation execution, notifications, publication, or a new PR state machine.
- F03 remains authoritative for SQLite, migrations, transactions, scoped checkpoints, immutable version persistence, idempotency, and restart records. F10 supplies the semantic version candidate and complete-resource decision; it does not write ad hoc SQL.
- F06 remains authoritative for GitHub authentication capability, typed resource operations, server/repository/PR identities, conditional response metadata, pagination bounds, and safe transport errors. F10 never constructs arbitrary URLs or handles raw credentials.
- F07 remains authoritative for the managed-PR aggregate, current PR configuration, explicit base/head identity, and local setup. F10 reads those records and does not create a second PR identity.
- F08 remains authoritative for primary inbox presentation and four-state semantics. F10 may provide safe observation summaries, but a poll result never changes `WATCHING`, `WORKING`, `READY_FOR_REVIEW`, or `NEEDS_ATTENTION` by itself.
- F09 remains authoritative for structured activity storage/query/presentation. F10 emits safe activity but never reconstructs checkpoints, versions, eligibility, or success from activity prose.
- F11 owns semantic/event eligibility, handled-version associations, automatic holds, and the guarantee that duplicates do not trigger a second analysis. F10 only creates/reuses immutable observed versions and retains new versions during holds.
- F12 owns the scheduler, quiet period, Check Now, global pause, and automatic dispatch. F10 provides a bounded invocation contract and ten-minute default; it does not start AI work or interpret pause policy.
- F13-F18 and F19-F27 own Git/worktrees, validation, AI, review bundles, notifications, responses, commits, pushes, merges, and publication. No F10 result authorizes those effects.
- F28-F30 own complete startup/sleep/network recovery, threat-model hardening, packaging, and clean-machine acceptance. F10 supplies concrete restart, redaction, resource-isolation, and zero-effect evidence for those gates.
- The F10 checklist item remains unchecked. This specification phase creates only the PRD/PLAN pair and does not claim that polling, immutable event capture, batching, AI review, or publication is implemented.

## Requirement-to-Slice Trace

| Requirement family | Owning slices |
|---|---|
| FR-01 | 1, 4-6 |
| FR-02 | 2, 5-6 |
| FR-03 | 2, 4, 6 |
| FR-04 | 3, 5-6 |
| FR-05 | 3-5 |
| FR-06 | 1, 2, 4-6 |
| FR-07 | 1, 4-6 |
| FR-08 | 4-6 |
| NFR-01-NFR-08 | 1-6 |
| INV-01-INV-10 | 1-6 |
| APP-AC-03 | 1, 5-6 |
| APP-AC-04-AC-08 | 1-6 |
| APP-AC-25 | 5-6 |
| APP-AC-65 | 2, 6 |
| APP-AC-69 | 3-6 |
