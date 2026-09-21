<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single layer. The goal is to provide the AI and the user with a visible and testable result when the work is complete.
-->

# Plan: F06 GitHub REST Client and Remote Identity Model

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** `Specs/github_rest_client_and_remote_identity_model_PRD.md`
>
> **Last revalidated against:** `Specs/application_overview.md` revision 2026-09-20 and F06 PRD revision 2026-09-20
>
> **Entry/readiness gates:** F02 provider-neutral IDs/reasons are available. F03 persistence, transaction, resource-checkpoint, and safe repository contracts are green. F04 main-process ownership and validated IPC are available. F05 exposes a verified server-bound request capability with canonical API-base metadata. Test infrastructure provides injectable transport, clocks, cancellation, response limits, fake credentials, fault injection, and secret-shaped fixture scans. No real GitHub credential or credentialed network access is required for default build/check/test commands.
>
> This PLAN cannot change product requirements. Resolve contradictions in the owning PRD before implementation and rerun both specification linters. This feature does not check the checklist item; implementation and approval are separate.

## Implementation Boundary

F06 extends the main-process/shared application boundary with a deterministic GitHub REST adapter and provider-neutral remote identity contracts. It adds supported PR URL parsing, server-bound request construction, typed PR/repository/ref/feedback resource clients, independent conditional/pagination handling, safe error/rate-limit normalization, current-state revalidation, and a narrow typed response-posting port.

F06 consumes F05's verified request capability and canonical server/API identity. It does not import secure-store code, accept a raw token, or expose arbitrary HTTP access. F06 returns typed results and response metadata; F03/F10 own durable checkpoint and immutable-version commits, F07 owns the complete add-PR workflow, F24 owns synchronization selection, and F23/F27 own approval, publication, idempotency, and reconciliation.

The primary output is a contract-tested main-process service, not a new product screen. F07 may use the parser and metadata contract to build the Add PR screen, and later features may expose safe status/reason data through F04 IPC. F06 does not implement polling schedules, AI, Git, worktrees, branch merges, commits, pushes, or GitHub approvals.

## Readiness Gates

- F05's request-scoped capability binds a verified server profile, canonical API base, credential revision, and correlation identity, and cannot be serialized to renderer or AI state.
- F02 provides versioned identifiers, safe reason/error categories, UTC instants, and result semantics that F06 can consume without creating a competing state machine.
- F03 provides typed transaction/repository boundaries for independent resource checkpoints and later remote-event versions; F06 can return response metadata without writing ad hoc SQLite state.
- F04 provides main-process lifecycle ownership and a validated command/read-model boundary; renderer closure cannot cancel authoritative F06 operations implicitly.
- The supported GitHub.com and standard GHES endpoint rules are fixed: HTTPS only, canonical API base from F05, no cross-origin redirects, and no arbitrary compatible hosts in the MVP.
- The test harness can simulate forks, deleted head repositories, same-named branches, `304` responses, Link pagination, rate limits, redirects, TLS/network failure, malformed JSON, cancellation, response limits, and a possible response mutation followed by process loss.

## Proposed Vertical Slices

1. **Canonical PR URL parsing and remote identity contracts**
   - **Blocked by:** F02 shared ID/reason codecs, F05 canonical server identity, and F01 TypeScript/shared boundaries.
   - **Stories / requirements / acceptance criteria:** US-01-US-02; FR-01.1-FR-01.4; FR-02.1-FR-02.5; NFR-01, NFR-05, NFR-08; INV-01-INV-03, INV-08-INV-09; AC-01-AC-04, AC-13-AC-15.
   - **Implementation:** Define versioned `ServerIdentity`, `RepositoryIdentity`, `PullRequestIdentity`, `BranchRefIdentity`, feedback-resource scope, remote-object, response-target, and parsed-PR contracts. Implement exact supported URL parsing and canonicalization, bounded path validation, stable identity equality, unavailable/deleted repository representation, and explicit base/head/default-branch fields. Make the parser accept only a canonical F05 server identity and reject ambiguous inputs before credential use.
   - **Visible result:** A pure contract fixture turns supported GitHub.com/GHES PR URLs into one canonical PR identity and turns representative PR metadata into separate base/head repository/ref identities. Forks and deleted head repositories remain visibly distinct or explicitly unavailable.
   - **Durable records / external effects:** Adds shared schemas and pure parsers only. No database, credential store, network, Git, AI, or renderer effect occurs.
   - **Failure / cancellation / restart:** Invalid URLs, identity collisions, oversize fields, unsupported schema versions, deleted repositories, and missing required metadata fail closed with stable safe reasons. Pure contract results are replayable across restart and do not depend on UI lifetime.
   - **Exact evidence:** URL/identity truth table; GitHub.com/GHES canonicalization matrix; query/fragment/userinfo/encoding/path rejection corpus; fork/same-name/deleted-repository fixture; default-branch non-substitution assertion; schema round trip and unknown-version rejection; secret-shaped value scan; `git diff --check`.
   - **Exit criterion:** AC-01-AC-04, AC-13, and AC-14 pass at the pure contract boundary, and downstream slices have one explicit identity model rather than ad hoc owner/name strings.

2. **Server-bound transport and typed request gateway**
   - **Blocked by:** Slice 1, F05 credential capability, and the injectable HTTP transport readiness gate.
   - **Stories / requirements / acceptance criteria:** US-02, US-07; FR-01.3-FR-01.5; FR-05.1-FR-05.5; NFR-01-NFR-03, NFR-05-NFR-08; INV-01, INV-03-INV-05, INV-09; AC-05, AC-17-AC-19.
   - **Implementation:** Add a request-operation union for the allowlisted REST resources, typed path/query/header builders, response-size and timeout limits, cancellation propagation, F05 capability binding, correlation IDs, and a narrow transport port. Enforce canonical API-base construction, strict redirect/TLS policy, no raw URL/header input, and explicit controlled request metadata. Keep read and response-mutation capabilities distinct.
   - **Visible result:** A fake transport receives exact, server-bound requests for the supported operations and rejects arbitrary URLs, mismatched server identities, raw credential attempts, unsafe redirects, and unbounded requests before network I/O.
   - **Durable records / external effects:** Fake tests produce request traces and bounded result fixtures; production code performs only the requested GitHub REST call. F06 itself adds no durable state or remote mutation beyond a caller-authorized response operation.
   - **Failure / cancellation / restart:** Transport cancellation, timeout, process interruption, redirect, TLS, network, and response-limit failures return safe non-success outcomes. Renderer closure does not authorize cancellation of main-process work; a read interrupted before a validated response is never reported successful.
   - **Exact evidence:** Request-shape matrix for every operation; no-arbitrary-URL and no-raw-header test; server/capability binding test; redirect/cross-origin/TLS rejection; timeout/cancellation/response-size bounds; controlled-header and secret-redaction scan; fake transport restart/replay fixture.
   - **Exit criterion:** AC-05, AC-17, AC-18, and AC-19 pass, and later resource clients can issue requests without importing authentication or transport details.

3. **PR, repository, and exact-ref metadata vertical slice**
   - **Blocked by:** Slices 1-2 and F05 verified server access; F07's managed-PR repository is not required for the client contract.
   - **Stories / requirements / acceptance criteria:** US-02, US-05; FR-02.2-FR-02.5; FR-03.1, FR-03.3; FR-05.1-FR-05.2; FR-06.1; NFR-04; INV-02, INV-08-INV-09; AC-03, AC-04, AC-13-AC-15.
   - **Implementation:** Implement typed clients for pull-request metadata, repository metadata, current PR state, and exact branch refs. Decode base/head repository payloads, preserve provider IDs and owner/name, retain default branch only as informational metadata, represent deleted/null head repositories, and require explicit repository identity for every ref lookup. Return current SHA/state and safe not-found/access outcomes.
   - **Visible result:** A fake GitHub response for an ordinary PR and a fork PR produces a complete, reviewable remote identity record. A source branch with the same name in another repository cannot satisfy the lookup; current PR/ref reads can be compared to recorded SHAs.
   - **Durable records / external effects:** F06 makes read-only GitHub requests. F07/F03 may persist the returned metadata later; F06 does not create a managed PR or choose a local clone.
   - **Failure / cancellation / restart:** Missing fields, inaccessible/deleted repositories, wrong repository refs, closed/merged PR states, not-found responses, and current-SHA mismatches become typed outcomes with no silent fallback. Replaying the same read request is safe; no stale cached result is presented as current.
   - **Exact evidence:** PR/repository/ref JSON fixture matrix; fork and deleted-head mapping; same-name cross-repository negative test; base/head/default-branch field separation; exact endpoint/path encoding; SHA/state revalidation table; F07 handoff contract test; malformed payload and not-found reason tests.
   - **Exit criterion:** AC-03, AC-04, AC-13, AC-14, and AC-15 pass and F07/F24/F27 can consume explicit repository/ref identities.

4. **Independent feedback resources, conditional requests, and pagination**
   - **Blocked by:** Slices 1-3 and F03 checkpoint contract; F10 owns scheduling, filtering, event versioning, and AI eligibility.
   - **Stories / requirements / acceptance criteria:** US-03-US-04; FR-03.1, FR-03.3-FR-03.5; FR-04.1-FR-04.5; FR-05.1-FR-05.2; NFR-01, NFR-04-NFR-08; INV-01, INV-05, INV-09; AC-05-AC-10, AC-19.
   - **Implementation:** Implement independent clients for inline review comments, pull-request reviews/review bodies, and issue comments. Define exact resource scopes, per-resource ETag/Last-Modified metadata, validated Link/page progression, bounded collection traversal, `304` outcomes, normalized provider-neutral feedback records, and response metadata for F10/F03. Preserve semantic fields needed for later content hashing without deciding semantic importance.
   - **Visible result:** A polling fixture requests all four resource scopes, returns a PR metadata `304`, changed review comments, unchanged reviews, and paginated issue comments, and shows that each result remains independently observable and correctly normalized.
   - **Durable records / external effects:** F06 returns normalized objects and checkpoint candidates; F10/F03 own the transaction that commits independent checkpoints and immutable versions. No AI call or batch is scheduled by this slice.
   - **Failure / cancellation / restart:** A failed/cancelled/incomplete page sequence does not advance its checkpoint or become a complete observation. Duplicate pages remain representable for F10 deduplication. A `304` affects only its own scope, and a network failure marks nothing processed.
   - **Exact evidence:** Four-resource conditional-header matrix; `304` isolation test; multi-page Link and bounded-page fixtures; page-loop/incomplete-sequence failure tests; normalized-field and nullable-location matrix; edited-without-timestamp semantic-hash-input fixture; F10 handoff/restart readback; zero-AI-call assertion.
   - **Exit criterion:** AC-05-AC-10 and APP-AC-65's client-boundary evidence pass, and F10 can implement the default ten-minute watcher without resource-specific HTTP code.

5. **Safe errors, rate limits, and response-mutation boundary**
   - **Blocked by:** Slices 2-4, F02 reason contracts, and F23's publication-context shape.
   - **Stories / requirements / acceptance criteria:** US-06-US-07; FR-03.2, FR-03.6; FR-05.1-FR-05.5; FR-06.2-FR-06.4; NFR-02-NFR-06; INV-04, INV-06-INV-07, INV-09; AC-11-AC-12, AC-16-AC-19.
   - **Implementation:** Add normalized error categories and retry/rate-limit data for HTTP and transport outcomes. Add typed operations for issue-comment creation and review-comment replies plus safe remote-ID decoding. Require explicit publication context supplied by F23, separate read/mutation ports, and an uncertain-outcome result that contains only safe target/request identity. Do not implement automatic mutation retries or local idempotency in F06.
   - **Visible result:** A fake publication consumer can post an approved typed response and receive a validated remote ID. The same test proves polling and AI-facing interfaces cannot reach the mutation port, and a timeout-after-send yields `UNKNOWN/UNCERTAIN` rather than a second post.
   - **Durable records / external effects:** Production may perform a GitHub response mutation only when a later deterministic caller invokes the typed port. F06 does not persist publication intent; F23 owns the durable idempotency and reconciliation record.
   - **Failure / cancellation / restart:** Auth, permission, rate-limit, not-found, validation, conflict, timeout, cancellation, TLS, redirect, malformed-body, and network-loss cases produce safe classified outcomes. A possible response mutation remains recoverable and is never replayed automatically by F06 or turned into a fabricated success after restart.
   - **Exact evidence:** Error classification table; safe `Retry-After`/reset handling; no-busy-loop test; approved-context authorization test; issue/review response endpoint matrix; remote-ID schema validation; timeout-after-send uncertain-outcome fixture; no-automatic-retry assertion; secret/raw-body/header scan; APP-AC-29 handoff evidence.
   - **Exit criterion:** AC-11, AC-12, AC-16-AC-19 pass and F23/F27 can own publication without bypassing the REST boundary.

6. **Downstream integration contracts for Add PR, monitoring, and synchronization**
   - **Blocked by:** Slices 1-5 plus the F07/F10/F24 consumer contracts.
   - **Stories / requirements / acceptance criteria:** US-01-US-07; FR-01.1-FR-06.4; all NFRs and INVs; APP-AC-02, APP-AC-08, APP-AC-29, APP-AC-44, APP-AC-50, APP-AC-65; AC-01-AC-19.
   - **Implementation:** Build fake consumers that exercise the exact F07 Add PR handoff, F10 independent watcher handoff, F24 source/ref resolution handoff, and F23/F27 revalidation/response handoff. Add boundary documentation and static import checks proving F06 has no AI, renderer, SQLite-ad-hoc, Git publication, or secure-store dependency. Confirm that safe results can be exposed later through F04 without exposing credentials or raw provider objects.
   - **Visible result:** One end-to-end contract harness parses a PR URL, loads fork-safe metadata, reads all feedback resources with independent freshness, resolves exact source/head refs, and performs a separately authorized response/revalidation call using fakes only.
   - **Durable records / external effects:** The harness uses temporary test-owned traces and fixtures. It does not alter managed-PR state, schedule AI, merge branches, publish code, or change the checklist.
   - **Failure / cancellation / restart:** Consumer retries reuse the same typed scope and caller-owned idempotency/recovery state. A mismatch or missing capability fails closed. Restart and renderer-closure fixtures preserve the distinction between a completed read, an incomplete read, and an uncertain response mutation.
   - **Exact evidence:** F07/F10/F23/F24/F27 contract matrix; full GitHub.com/GHES fake suite; import-boundary report; provider-SDK/credential/raw-payload scan; restart/cancellation/uncertain-outcome matrix; `npm run build`, `npm test`, `npm run check`; `git diff --check`; both required specification-linter reports against the final PRD/PLAN.
   - **Exit criterion:** All F06 requirements have direct evidence, the six shared application-coverage mappings have no definite missing/invalid result, and downstream features can use one stable GitHub REST and identity contract.

## Cross-Slice Verification and Handoff

- The exact owning PRD is `Specs/github_rest_client_and_remote_identity_model_PRD.md`; this PLAN does not add polling schedules, AI behavior, worktrees, Git merges, branch publication, or Review Bundle approval beyond the REST contracts those features consume.
- F05 owns canonical server configuration, secure credential storage, and request-scoped credential access. F06 never imports the secure store or accepts raw tokens.
- F03 owns persistence, migration, transaction, and checkpoint commits. F06 returns conditional/pagination metadata and normalized data; F10/F03 decide when to commit it and when to create immutable remote versions.
- F07 owns Add PR UI, managed-PR persistence, and local-clone validation. It must persist F06's explicit base/head identities and SHAs rather than reconstructing them from owner/name strings.
- F10 owns the polling timer, Check Now, event filtering, semantic versioning, batching, and AI eligibility. A successful F06 read never implies that feedback is actionable or processed.
- F24 owns synchronization-source precedence and user confirmation. F06 only returns exact refs for the explicitly supplied repository and branch; `default_branch` remains informational.
- F23/F27 own human approval, publication phases, idempotency keys, commit/push/response reconciliation, and no-force-push decisions. F06's response port cannot authorize or repeat those effects.
- F13/F25 own Git credentials, worktrees, merges, and Git-side publication. F06's GitHub API credential capability must never be reused as a Git subprocess credential or passed to AI.
- F29 owns final threat-model hardening and F30 owns clean-machine GHES/GitHub acceptance. F06 must still provide concrete redirect, redaction, boundary, compatibility, and fake-contract evidence.
- The F06 checklist item remains unchecked. This specification phase creates only the PRD/PLAN pair and does not claim that a client stub, URL parser, or fake adapter completes the feature.

## Requirement-to-Slice Trace

| Requirement family | Owning slices |
| --- | --- |
| FR-01 | 1-2, 6 |
| FR-02 | 1, 3, 6 |
| FR-03 | 3-5, 6 |
| FR-04 | 4, 6 |
| FR-05 | 2, 4-6 |
| FR-06 | 3, 5-6 |
| NFR-01-NFR-08 | 1-6 |
| INV-01-INV-09 | 1-6 |
| APP-AC-02 | 1, 3, 6 |
| APP-AC-08 | 4, 6 |
| APP-AC-29 | 5-6 |
| APP-AC-44 | 1, 3, 6 |
| APP-AC-50 | 3, 5-6 |
| APP-AC-65 | 4, 6 |
