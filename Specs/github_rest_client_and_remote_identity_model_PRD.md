# F06 GitHub REST Client and Remote Identity Model - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F02 - Domain contracts and deterministic state machines | Provides provider-neutral identifiers, safe result/reason data, and the rule that remote identity and publication decisions are deterministic. |
| 2 | F03 - SQLite persistence, migrations, and transactional repositories | Provides versioned codecs, resource-checkpoint persistence, transaction boundaries, and restart-safe repository contracts consumed by later polling and managed-PR workflows. |
| 3 | F04 - Persistent Electron shell, IPC boundary, and Windows virtual-desktop spike | Provides main-process ownership and the renderer-safe command/read-model boundary. |
| 4 | F05 - Secure GitHub server profiles and authentication | Provides canonical GitHub server identity and a request-scoped authenticated capability without exposing raw credentials. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F07 - Add and manage a pull request | Uses PR URL parsing, PR metadata retrieval, and explicit base/head repository and ref identities. |
| 2 | F10-F12 - Deterministic monitoring pipeline | Uses independent feedback-resource clients, normalized objects, conditional requests, pagination, and safe error classification. |
| 3 | F23 - Human-approved Review Bundle publication | Uses the deterministic response-posting client after its own persisted approval and idempotency gates. |
| 4 | F24-F27 - Managed PR branch synchronization | Uses explicit repository/ref lookup, current SHA revalidation, and fork-safe source/destination identity. |
| 5 | F28-F30 - Recovery, security, and release readiness | Exercise request recovery, redaction, compatibility, and end-to-end GitHub/GHES behavior. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-02 | FR-01.1-FR-01.5, FR-02.1-FR-02.4 | AC-01-AC-04 | Shared/enabler: F06 owns deterministic URL parsing and metadata retrieval; F07 owns the complete add-PR workflow and local-clone validation. |
| APP-AC-08 | FR-03.1-FR-03.5, FR-04.1-FR-04.5, FR-05.1-FR-05.5 | AC-05-AC-10 | Shared/enabler: F06 owns resource requests, normalization, conditional metadata, pagination, and transport outcomes; F10 owns polling orchestration and event eligibility. |
| APP-AC-29 | FR-03.6, FR-06.1-FR-06.4 | AC-11-AC-12 | Shared/enabler: F06 owns the bounded response-posting request; F23 owns explicit human approval, publication state, idempotency, and reconciliation. |
| APP-AC-44 | FR-02.2-FR-02.5, FR-06.2 | AC-13-AC-14 | Shared/enabler: F06 preserves explicit PR base/head and repository/ref identities; F24 owns synchronization-source selection and confirmation. |
| APP-AC-50 | FR-02.3-FR-02.5, FR-06.2-FR-06.4 | AC-14-AC-15 | Shared/enabler: F06 supplies current-ref and PR-state verification; F27 owns publication approval, no-force-push enforcement, and result state. |
| APP-AC-65 | FR-04.1-FR-04.5, FR-05.1-FR-05.5 | AC-06-AC-10 | Shared/enabler: F06 owns independent request mechanics; F10 owns the ten-minute polling schedule and no-AI watcher behavior. |

F06 does not claim complete ownership of any of these workflow criteria. It supplies the deterministic, authenticated REST boundary that later features must use. F06 never decides when to poll, when feedback is semantically actionable, whether a response is approved, or whether a branch may be pushed.

## Executive Summary

PRMonitor needs one reliable way to communicate with GitHub.com and GitHub Enterprise Server. Without a shared REST client, individual features could accidentally select a branch from the wrong repository, treat a fork as the same repository, skip a feedback resource after a `304 Not Modified`, or leak an authenticated request to an unintended endpoint.

F06 defines the deterministic GitHub REST client and the remote identity model used by the rest of the application. It parses supported pull-request URLs, retrieves PR and repository metadata, represents base and head repositories explicitly, resolves exact branch refs and SHAs, reads all supported feedback resources independently, handles conditional requests and pagination, normalizes safe errors, and provides narrowly scoped operations for current-state verification and approved response posting.

The feature is an infrastructure boundary, not an orchestration feature. It consumes F05's verified server-bound credential capability, but never receives a raw token in domain state or gives a provider, renderer, or AI operation arbitrary request access. Read operations are safe for F07/F10/F24/F27 to use. Remote mutations remain callable only by a later deterministic publication service after its own human approval and recovery rules have been satisfied.

## User Stories

### Add a pull request from a supported URL

- **US-01:** **GIVEN** a developer pastes a GitHub.com or supported GHES pull-request URL, **WHEN** PRMonitor validates it, **THEN** the application identifies the configured server, repository owner, repository name, and pull-request number without guessing from a branch name or an unrelated repository.
  - **Acceptance Criteria:** AC-01, AC-02.

- **US-02:** **GIVEN** the configured server is reachable and authenticated, **WHEN** PRMonitor loads the pull request, **THEN** the result identifies the PR's base repository, head repository, base branch, head branch, base SHA, head SHA, and informational repository default branch separately.
  - **Acceptance Criteria:** AC-03, AC-04, AC-13.

### Observe GitHub feedback efficiently

- **US-03:** **GIVEN** a managed PR has inline review comments, review bodies, or issue comments, **WHEN** a deterministic consumer requests them, **THEN** each resource can be fetched, normalized, paginated, and checkpointed independently.
  - **Acceptance Criteria:** AC-05-AC-10.

- **US-04:** **GIVEN** one resource returns `304 Not Modified`, **WHEN** another feedback resource has changed, **THEN** the unchanged resource is treated as unchanged while the changed resource is still fetched and returned.
  - **Acceptance Criteria:** AC-06, AC-07, AC-09.

### Revalidate and publish through a controlled boundary

- **US-05:** **GIVEN** a later synchronization or publication workflow needs to verify a PR or branch, **WHEN** it supplies an explicit repository/ref identity, **THEN** F06 returns the current remote state for exactly that identity, including a current SHA or a safe reason that it cannot be found.
  - **Acceptance Criteria:** AC-13-AC-15.

- **US-06:** **GIVEN** a later publication workflow has already recorded explicit human approval, **WHEN** it requests a GitHub response operation, **THEN** F06 performs only the requested, typed response call and returns a validated remote identifier or a recoverable error; F06 does not invent approval or retry an uncertain mutation on its own.
  - **Acceptance Criteria:** AC-11, AC-12, AC-16.

### Understand failures without losing identity or secrets

- **US-07:** **GIVEN** GitHub returns an authentication error, permission error, rate limit, missing resource, transient network failure, redirect, malformed payload, or cancellation, **WHEN** the request completes, **THEN** the caller receives a stable safe category, retry classification, and next-action reason without an authorization header, credential, or uncontrolled response body.
  - **Acceptance Criteria:** AC-17-AC-19.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** a developer enters a supported HTTPS GitHub.com or standard GHES PR URL of the form `/owner/repository/pull/number`, **WHEN** the URL parser runs, **THEN** it returns the canonical F05 server identity, owner, repository name, positive PR number, and a normalized PR reference; it rejects HTTP, userinfo, query/fragment ambiguity, malformed paths, unsupported hosts, encoded path ambiguity, and non-integer or non-positive numbers.
- **AC-02:** **GIVEN** two equivalent supported PR URLs differ only by an allowed host-case or trailing slash, **WHEN** they are parsed, **THEN** they produce the same canonical PR identity; URLs that identify different servers, repositories, or PR numbers never collide.
- **AC-03:** **GIVEN** a parsed PR identity and a verified F05 server profile, **WHEN** F06 fetches PR metadata, **THEN** the request is made only against that server's canonical API base and the validated response includes the PR number, state, base repository identity, head repository identity when available, base/head branch names, base/head SHAs, and repository default-branch metadata as separate fields.
- **AC-04:** **GIVEN** GitHub reports a fork-based PR or a base/head repository with the same branch name, **WHEN** F06 maps the metadata, **THEN** each repository remains explicitly identified by its server-scoped remote identity and owner/name; a same-named branch in another repository cannot satisfy a ref lookup, and a missing/deleted repository produces an actionable unavailable identity rather than an inferred replacement.
- **AC-05:** **GIVEN** a caller requests PR metadata, an inline review-comment collection, a review collection, or an issue-comment collection, **WHEN** F06 builds the request, **THEN** the resource type, PR identity, page, page size, conditional metadata, and correlation identity are explicit and the request uses only an allowlisted GitHub REST operation.
- **AC-06:** **GIVEN** the client has persisted conditional metadata for one resource scope, **WHEN** the next request for that exact scope runs, **THEN** F06 sends the applicable `ETag` and/or `Last-Modified` condition independently of every other resource scope; metadata for PRs cannot be reused for comments, reviews, or issue comments.
- **AC-07:** **GIVEN** GitHub returns `304 Not Modified` for PR metadata and changed content for a feedback resource, **WHEN** the caller performs the resource checks, **THEN** F06 returns a no-change outcome only for the PR metadata and still returns the changed feedback response; a `304` never suppresses another resource request.
- **AC-08:** **GIVEN** a successful paginated response includes a GitHub `Link` relation or a server-specific pagination shape, **WHEN** the client advances the collection, **THEN** it follows only validated next-page links or bounded page parameters under the same server and repository/PR scope, preserves item order and identity, and never loops indefinitely or treats an incomplete page as a complete observation.
- **AC-09:** **GIVEN** one feedback resource is requested, **WHEN** its objects are decoded, **THEN** F06 produces provider-neutral records for review comments, reviews/review bodies, or issue comments with scoped remote IDs, authors, body/state/location fields when present, created/updated timestamps, repository/PR identity, and the source resource; decoding does not classify semantic importance or invoke an AI provider.
- **AC-10:** **GIVEN** a resource response is unchanged, empty, duplicated across pages, edited without a reliable timestamp, or delivered again, **WHEN** F06 returns it to its caller, **THEN** it preserves enough complete, stable semantic data and content-hash input for F10 to create or reuse immutable versions deterministically without treating a missing timestamp as proof of no change.
- **AC-11:** **GIVEN** a later publication service supplies a typed, explicitly approved response intent for an issue comment or review-comment reply, **WHEN** F06 sends it, **THEN** the request targets the exact PR/repository/comment identity, uses the configured server credential capability, validates the remote response ID, and never posts a response from polling, AI output, renderer state, or a caller lacking the approval context.
- **AC-12:** **GIVEN** a response post times out or loses the network after the request may have reached GitHub, **WHEN** F06 returns, **THEN** it reports an uncertain mutation outcome and does not automatically send a second response; the caller receives enough safe request/target identity to reconcile through its own persisted idempotency workflow.
- **AC-13:** **GIVEN** a caller asks for the current PR state or an exact branch ref in a specified repository, **WHEN** F06 fetches it, **THEN** the result includes the current open/closed/merged state or exact current SHA, the requested repository/ref identity, and safe not-found or access reasons; it never substitutes the repository default branch or a same-named ref elsewhere.
- **AC-14:** **GIVEN** a synchronization workflow resolves an override branch or falls back to the PR base branch, **WHEN** it asks for source and destination refs, **THEN** F06 returns each branch's repository, name, and SHA separately, including `syncSourceSha` and `prHeadSha` inputs suitable for confirmation and later stale checks.
- **AC-15:** **GIVEN** a current-ref or PR-state revalidation request is made before publication, **WHEN** either requested SHA or the PR state differs from the recorded snapshot, **THEN** F06 returns a deterministic mismatch or ineligible result; it never refreshes the snapshot silently or authorizes a push.
- **AC-16:** **GIVEN** any F06 operation is replayed after renderer closure, process restart, cancellation, or a caller retry, **WHEN** the same read request or explicitly keyed mutation is handled, **THEN** the result is safe to replay, an in-flight read is not reported as success without a response, and a possible response mutation remains recoverable rather than being repeated by F06.
- **AC-17:** **GIVEN** GitHub or the network returns an authentication/authorization failure, rate limit, not-found, conflict, validation, timeout, DNS/TLS, redirect, protocol, malformed-body, or cancellation outcome, **WHEN** F06 normalizes it, **THEN** the result has a stable category, retryability, bounded safe detail, and next-action classification appropriate to the outcome.
- **AC-18:** **GIVEN** a request would use an HTTP URL, cross-origin redirect, unsupported host, unverified server profile, arbitrary path, unbounded page/response, or raw credential input, **WHEN** F06 validates it, **THEN** it fails closed before sending the request and exposes no credential or sensitive transport detail.
- **AC-19:** **GIVEN** contract tests run with fake transport and F05 credential capabilities, **WHEN** they exercise GitHub.com, standard GHES, forks, pagination, conditional requests, rate limits, redirects, malformed payloads, and uncertain response posting, **THEN** the same provider-neutral client contract passes without real credentials, real network access, AI invocation, or provider-specific objects crossing the boundary.

## Functional Requirements

### FR-01: Supported PR URL and server-bound request identity

- FR-01.1: The client SHALL parse and validate supported HTTPS GitHub.com and standard GHES pull-request URLs into a canonical F05 server identity, repository owner, repository name, and positive PR number.
- FR-01.2: The client SHALL reject ambiguous URL components, unsupported hosts, insecure schemes, userinfo, query/fragment data, malformed pull-request paths, path traversal/encoding ambiguity, and values outside bounded input limits before any credentialed request.
- FR-01.3: Every request SHALL be constructed from a canonical F05 API base and an allowlisted typed resource operation; callers SHALL not provide an arbitrary absolute URL or raw authorization header.
- FR-01.4: Every request SHALL bind the server identity, resource scope, correlation identity, cancellation signal, and bounded transport policy before the request starts.
- FR-01.5: The client SHALL use only the F05 request-scoped credential capability and SHALL never receive, persist, log, serialize, or return a raw GitHub credential.

### FR-02: Explicit remote identity model

- FR-02.1: F06 SHALL define provider-neutral identities for a GitHub server, repository, pull request, branch ref, feedback resource, remote object, and response target, with server scope explicit in every identity.
- FR-02.2: A pull-request metadata result SHALL preserve base and head repository identities separately, including owner/name and stable provider identity when GitHub supplies one, and SHALL represent a deleted/unavailable head repository explicitly rather than replacing it.
- FR-02.3: A pull-request metadata result SHALL preserve `prBaseBranch`/`base.ref`, `prHeadBranch`/`head.ref`, `prBaseSha`, and `prHeadSha` separately from the repository's informational `default_branch`.
- FR-02.4: A branch-ref lookup SHALL require an explicit repository identity and branch name; a same-named ref from another repository SHALL never be accepted as a match.
- FR-02.5: F06 SHALL expose current PR-state and exact-ref lookup results that later synchronization/publication features can compare against their snapshotted identities and SHAs.

### FR-03: Typed GitHub REST resources and normalized responses

- FR-03.1: The client SHALL provide typed read operations for PR metadata, repository metadata, exact branch refs, inline pull-request review comments, pull-request reviews/review bodies, and issue comments.
- FR-03.2: The client SHALL provide typed response operations for an issue comment and a pull-request review-comment reply, with the target repository, PR, and comment identity explicit.
- FR-03.3: The client SHALL validate response status, headers, content type/size, and required fields before returning a successful typed result.
- FR-03.4: Feedback resource results SHALL preserve the fields needed for deterministic normalization and semantic hashing, including source type, remote ID, author, body/state, timestamps, location metadata when present, and scoped PR/repository identity.
- FR-03.5: The client SHALL not perform semantic filtering, keyword classification, deduplication decisions, event eligibility decisions, or AI invocation; those decisions belong to later deterministic monitoring and AI workflows.
- FR-03.6: Response-posting operations SHALL be callable only through a typed deterministic boundary that receives explicit publication context from a later owner and SHALL not be reachable from polling or AI-provider contracts.

### FR-04: Independent conditional requests and pagination

- FR-04.1: Conditional-request metadata SHALL be scoped and maintained independently for PR metadata, inline review comments, reviews, and issue comments.
- FR-04.2: The client SHALL support `ETag` and/or `Last-Modified` request/response metadata and SHALL distinguish `304 Not Modified` from a successful changed response for the same resource.
- FR-04.3: Pagination state SHALL be scoped to the exact server/repository/PR/resource identity and SHALL preserve validated next-page information without allowing unbounded page counts or response sizes.
- FR-04.4: A failed, cancelled, malformed, or incomplete page sequence SHALL not be reported as a complete successful observation; checkpoint advancement SHALL be controlled by the caller's durable transaction boundary.
- FR-04.5: Independent resource outcomes SHALL remain independent: a PR metadata `304`, error, or empty response SHALL not suppress, mark complete, or alter a feedback-resource request.

### FR-05: Safe error, retry, and rate-limit contract

- FR-05.1: The client SHALL normalize authentication, authorization, rate-limit, not-found, conflict, validation, transient network, timeout, cancellation, redirect/TLS, protocol, malformed-response, and unsupported-server outcomes into provider-neutral safe reasons.
- FR-05.2: Each normalized failure SHALL include a stable category, retryability, bounded user-safe detail, correlation identity, and next-action classification when known.
- FR-05.3: Rate-limit responses SHALL preserve safe reset/retry timing and resource scope when the server supplies it; the client SHALL not busy-loop or retry a non-idempotent response mutation automatically.
- FR-05.4: Transport and protocol errors SHALL redact credentials, authorization headers, URLs containing secrets, raw response bodies, uncontrolled environment data, and sensitive request details before diagnostics or persistence.
- FR-05.5: Retry classification SHALL distinguish safe replay of a read from an uncertain outcome after a possible response mutation; callers SHALL receive the uncertain outcome rather than a fabricated success.

### FR-06: Current-state verification and publication boundary

- FR-06.1: F06 SHALL expose deterministic current PR-state and exact-ref reads for later stale checks, using the explicit repository/ref identity supplied by the caller.
- FR-06.2: F06 SHALL expose response posting only as a narrowly typed deterministic operation; it SHALL require caller-provided publication context and SHALL never imply approval, commit, push, merge, conversation resolution, or force-push authority.
- FR-06.3: F06 SHALL return validated remote identifiers and response metadata after a confirmed mutation, and SHALL return an explicit uncertain outcome when confirmation is unavailable.
- FR-06.4: F06 SHALL not automatically retry an uncertain response mutation or create an idempotency key in place of the later publication service's persisted idempotency record.

## Non-Functional Requirements

- **NFR-01: Determinism** - Given the same canonical identity, injected clock/transport response, and prior request metadata, F06 SHALL produce the same parsed identity, normalized result, pagination decision, or safe reason without AI judgment.
- **NFR-02: Security** - The client SHALL keep raw GitHub credentials inside the F05 capability boundary and SHALL fail closed for unverified servers, unsafe URLs, redirects, malformed identities, and secret-shaped diagnostics.
- **NFR-03: Reliability and recovery** - Read requests, conditional metadata, pagination outcomes, and uncertain response mutations SHALL remain distinguishable across cancellation, renderer closure, network loss, and process restart; F06 SHALL not claim a side effect succeeded without validated confirmation.
- **NFR-04: GitHub compatibility** - The MVP SHALL support GitHub.com and standard GHES REST API behavior through one provider-neutral contract, including repository forks, REST pagination, conditional responses, rate-limit headers, and the supported response endpoints.
- **NFR-05: Bounded resource use** - URL parts, request paths, page sizes, page counts, response bodies, error details, and transport timeouts SHALL have explicit bounded limits.
- **NFR-06: Observability** - Each request result SHALL carry a correlation identity, resource scope, safe timing/status metadata, and machine-readable outcome suitable for F09 activity events without using free-form logs as state.
- **NFR-07: Maintainability** - Adding a later GitHub-compatible server adapter or a new typed resource SHALL not require changing downstream polling, AI, worktree, or publication contracts.
- **NFR-08: Testability** - URL parsing, identity mapping, transport, clock, cancellation, pagination, conditional headers, response validation, and failure classification SHALL be injectable and testable without real credentials or network access.

## Invariants

- **INV-01:** F06 uses deterministic software only; it SHALL never invoke an AI provider or use AI to choose a repository, branch, resource, retry, or request outcome.
- **INV-02:** Every remote identity and ref SHALL remain scoped to a canonical server and explicit repository; `default_branch` SHALL never silently replace `prBaseBranch`, `prHeadBranch`, or a configured synchronization override.
- **INV-03:** The client SHALL construct requests only from typed allowlisted operations against the F05 canonical API base; arbitrary URLs, raw headers, cross-origin redirects, and insecure transport are forbidden.
- **INV-04:** Credentials, authorization headers, secure-store references, raw provider objects, and uncontrolled environment values SHALL not enter F06 domain records, normalized feedback, errors, logs, activity events, prompts, or structured AI output.
- **INV-05:** Conditional-request metadata and pagination checkpoints SHALL be independent for each remote resource scope; a result for one resource SHALL not establish an observation for another.
- **INV-06:** A response mutation SHALL never start from polling, AI output, renderer state, or a missing approval context; F06 has no publication authority and no force-push or merge operation.
- **INV-07:** A possible response mutation with unknown outcome SHALL remain recoverable and SHALL not be automatically repeated by the client.
- **INV-08:** Missing, deleted, ambiguous, or inaccessible repository/ref identities SHALL be represented explicitly and SHALL not be replaced by same-named resources or inferred defaults.
- **INV-09:** A successful result SHALL be based on validated HTTP status and response schema, never solely on a transport completion, cached state, model claim, or caller assertion.

## Out of Scope

- **Add-PR workflow and local clone validation** - F07 owns the user flow, managed-PR persistence, and clone checks; F06 provides parsing and metadata contracts.
- **Polling schedules, batching, event filtering, immutable versions, and AI dispatch** - F10-F12 own watcher orchestration and eligibility; F06 does not decide whether feedback is actionable.
- **Git remote authentication, cloning, worktrees, diffs, merges, pushes, and branch publication** - F13, F24-F27, and later Git infrastructure own these effects.
- **Credential storage, token capture, authentication setup, and OAuth/GitHub App flows** - F05 owns the verified server-bound credential boundary.
- **Review Bundle approval, response editing, publication idempotency, and uncertain-outcome reconciliation** - F23 owns approval and effect recovery; F06 only supplies the typed REST call and safe outcome.
- **AI providers, prompts, semantic review, conflict resolution, or provider conversation state** - F15-F18 and F26 own AI behavior.
- **Webhooks, GraphQL, arbitrary GitHub-compatible hosts, automatic branch synchronization, automatic rebasing, force push, approvals, merges, or conversation resolution** - These are outside the MVP or owned by later explicit workflows.

## Product Decisions

- **PD-01: Use GitHub REST as the MVP provider boundary** - The application needs GitHub.com and standard GHES behavior with predictable resource paths, conditional requests, pagination, and response identifiers; GraphQL and other APIs remain future adapters.
- **PD-02: Make base/head repository identity explicit** - Forks and same-named branches are common enough that owner/name and a server-scoped provider repository identity must travel with every PR/ref result.
- **PD-03: Treat `default_branch` as informational** - Synchronization uses `prBaseBranch` or a user-configured override, never an API-reported repository default chosen silently by the client.
- **PD-04: Reject ambiguous PR URLs** - A URL with query/fragment/userinfo/path ambiguity is not safe input for a credentialed request, even when a browser might resolve it.
- **PD-05: Keep resource freshness independent** - PR metadata, inline comments, reviews, and issue comments have separate conditional metadata and pagination state so one unchanged resource cannot hide another's change.
- **PD-06: Keep response posting narrow and downstream-authorized** - F06 can send a typed approved response request, but it cannot decide approval, retry an uncertain mutation, or publish code.
- **PD-07: Represent unavailable identities instead of guessing** - Deleted fork repositories, inaccessible refs, and malformed server payloads become actionable ineligible/error results rather than silently falling back to a same-named resource.

## Implementation Decisions

- **IMP-01: Use a layered typed REST adapter** - Separate URL/identity parsing, request construction, transport, response codecs, resource clients, pagination/conditional handling, and error normalization so downstream services consume stable contracts rather than HTTP details.
- **IMP-02: Use F05's request-scoped credential capability** - The client binds a verified server profile and credential revision to every request; no F06 module accepts a raw token or imports the secure-store implementation.
- **IMP-03: Build request paths from typed segments** - Repository owners, names, branch names, comment IDs, and PR numbers are encoded and validated as path components; callers cannot pass an arbitrary URL.
- **IMP-04: Validate JSON with versioned schemas** - GitHub payloads are decoded into bounded provider-neutral DTOs with required-field checks and safe handling for nullable/deleted fork fields; unknown optional fields do not become authoritative state.
- **IMP-05: Keep freshness/checkpoint state caller-owned** - F06 returns response metadata and validated page outcomes; F10/F03 decide when to commit independent ETag/Last-Modified and pagination checkpoints with the required transaction boundary.
- **IMP-06: Use an injectable small HTTP transport** - The adapter uses a narrow transport port rather than coupling the domain to a large provider SDK; tests can prove redirects, headers, response limits, cancellation, and uncertain outcomes with fakes.
- **IMP-07: Separate read and response capabilities** - Read operations and response mutations use distinct typed ports. The mutation port accepts a publication context but has no methods for commits, pushes, merges, approvals, or force pushes.

## Testing Decisions

- **TST-01: Test identity and URL parsing as deep deterministic modules** - Use table-driven cases for GitHub.com, GHES, host/path/case/trailing-slash variants, forks, deleted repositories, encoded input, invalid numbers, and collision resistance.
- **TST-02: Test resource contracts with fake transport** - Verify exact HTTP method/path/query/header shapes, response codecs, nullable fields, request scoping, and normalized output without real credentials or network access.
- **TST-03: Test each freshness scope independently** - Prove that ETag/Last-Modified and pagination checkpoints for PR metadata, review comments, reviews, and issue comments cannot cross-contaminate and that a `304` cannot suppress another resource.
- **TST-04: Test failure and uncertain mutation behavior deeply** - Exercise rate limits, retries, redirects, TLS, malformed bodies, cancellation, response limits, timeout, network loss after a response post, and restart/reconciliation handoff.
- **TST-05: Defer orchestration and presentation** - F07 owns the add-PR UI, F10 owns schedules/filtering/batching, and F23/F27 own approval/publication; F06 tests the contracts those features consume, not their complete screens or state machines.
- **TST-06: Run secret and forbidden-boundary scans** - Synthetic credentials, authorization headers, raw payloads, provider objects, and arbitrary URLs must not appear in committed fixtures, logs, normalized records, or AI-facing structures.

## Proposed Modules

- **MOD-01: GitHub PR URL Parser** - Validates supported PR URLs and produces canonical server/repository/number input.
- **MOD-02: Remote Identity Contracts** - Defines server, repository, PR, branch-ref, feedback-resource, object, and response-target identities with explicit scope and schema versions.
- **MOD-03: Authenticated Request Gateway** - Binds F05 credentials, canonical API bases, typed operations, transport limits, cancellation, and correlation identity.
- **MOD-04: PR/Repository/Ref Resource Client** - Retrieves PR metadata, repository metadata, exact refs, and current PR state with explicit base/head identities.
- **MOD-05: Feedback Resource Client** - Retrieves inline review comments, reviews, and issue comments independently and maps them to provider-neutral records.
- **MOD-06: Conditional and Pagination Coordinator** - Validates ETags/Last-Modified, Link/page progression, bounded collection traversal, and per-resource response metadata.
- **MOD-07: Error and Rate-Limit Normalizer** - Converts HTTP/transport failures into safe, retryable, actionable provider-neutral reasons.
- **MOD-08: Approved Response and Revalidation Client** - Posts typed issue/review responses and reads current PR/ref state without owning publication approval or reconciliation.

## Workflows

### Workflow 1: Add and identify a PR

```text
1. The developer pastes a supported GitHub.com or GHES PR URL.
2. F06 validates the URL and derives the canonical F05 server identity, owner, repository, and number.
3. The caller obtains a verified request capability from F05 and asks F06 for PR metadata.
4. F06 retrieves the PR from the base repository and validates the response.
5. F06 maps base/head repositories, branches, SHAs, PR state, and informational default-branch metadata separately.
6. F07 persists the managed PR and presents any local-clone or inaccessible-identity issue to the developer.
```

### Workflow 2: Resolve exact refs for synchronization

```text
1. F24 resolves the configured override or the PR's base branch as syncSourceBranch.
2. The caller supplies the source repository/ref and destination head repository/ref explicitly.
3. F06 fetches each exact ref independently and returns syncSourceSha and prHeadSha.
4. A missing, inaccessible, or ambiguous ref becomes an ineligible result with a safe reason.
5. F24 records the identities and asks for human preparation confirmation; F06 does not start a merge or push.
```

### Workflow 3: Poll feedback resources independently

```text
1. F10 requests PR metadata, inline review comments, reviews, and issue comments through separate resource scopes.
2. F06 sends each scope's own conditional headers and validates each response.
3. A 304 ends only that scope's work; changed scopes are paginated and normalized independently.
4. F06 returns response metadata and bounded normalized objects to F10.
5. F10 commits checkpoints and immutable versions, applies deterministic eligibility, and decides whether a later AI operation is needed.
```

### Workflow 4: Revalidate and post an approved response

```text
1. F23 persists explicit human approval and its publication intent before requesting a remote effect.
2. The publication service asks F06 for current PR/ref state and compares the returned identities and SHAs with its snapshot.
3. If stale, publication stops and F23 records a stale result; F06 never refreshes the snapshot silently.
4. If still eligible, the publication service supplies a typed approved response request to F06.
5. F06 sends the exact response request and validates the returned remote identifier.
6. A confirmed result or uncertain outcome is returned to F23 for persisted reconciliation; F06 never repeats the mutation automatically.
```
