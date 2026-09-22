# F11 Event Eligibility, Deduplication, and Per-PR Review Holds - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F02 - Domain contracts and deterministic state machines | Provides the legal primary-state, event-version association, and automatic-hold transitions that F11 evaluates and protects. |
| 2 | F03 - SQLite persistence, migrations, and transactional repositories | Provides durable, transactional records and uniqueness/concurrency enforcement for decisions, claims, holds, and handled associations. |
| 3 | F10 - Independent, efficient PR feedback polling | Provides scoped immutable remote-event versions, current PR metadata, and safe observation outcomes. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F12 - Review batching, scheduler, Check Now, and global pause | Consumes eligible version IDs, deferred-held versions, and per-PR dispatch availability to create quiet-period batches. |
| 2 | F13-F18 - Git/worktrees, validation, AI, and automatic review | Uses an F11 claim and hold authorization before starting an automatic Review Bundle or mutating a worktree. |
| 3 | F19-F23 - Review presentation, revisions, and publication | Completes or releases a held Review Bundle and preserves the handled association for every included version. |
| 4 | F22 - Discard, stale detection, and re-evaluation | Uses retained versions and explicit human authorization to re-evaluate without making ordinary automatic eligibility repeat handled work. |
| 5 | F28-F30 - Recovery, security, and release readiness | Reconciles durable claims/holds and verifies cross-PR isolation, redaction, and restart behavior. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-03 | FR-01.1, FR-05.1-FR-05.3, INV-05 | AC-01, AC-15-AC-16 | Shared: F11 keeps eligibility, claims, and holds scoped per managed PR; F08 owns inbox presentation. |
| APP-AC-05 | FR-02.1-FR-02.7, FR-07.1, INV-01 | AC-02-AC-08, AC-17 | Shared: F11 prevents filtered or duplicate versions from reaching an AI dispatch; F10/F12 own polling and scheduling boundaries. |
| APP-AC-07 | FR-02.1-FR-03.5, FR-05.1-FR-05.4, INV-02-INV-04 | AC-01-AC-04, AC-09, AC-13, AC-15 | Primary: F11 guarantees that one immutable event version cannot trigger duplicate automatic analysis. |
| APP-AC-08 | FR-01.1-FR-01.4, FR-02.1-FR-02.7 | AC-01-AC-08, AC-17 | Shared: F10 detects immutable versions; F11 deterministically decides whether an observed version may enter automatic work. |
| APP-AC-09 | FR-03.1-FR-03.4, FR-05.2 | AC-01, AC-09, AC-12 | Shared: F11 supplies a stable eligible set; F12 owns the quiet-period timer and batch scheduling. |
| APP-AC-16 | FR-04.1-FR-04.8, FR-05.1-FR-05.4, INV-06-INV-08 | AC-09-AC-14, AC-16 | Primary for the durable per-PR automatic hold and its eligibility gate; later review/publication features own bundle-specific actions. |
| APP-AC-17 | FR-04.4-FR-04.8, FR-06.1-FR-06.4 | AC-11, AC-14, AC-16 | Shared: F11 keeps holds independent of the window; F04 owns process lifetime and F19 owns lifecycle presentation. |
| APP-AC-24 | FR-03.3-FR-03.6, FR-04.7, INV-03-INV-04 | AC-13-AC-14 | Primary: handled immutable versions remain durably associated after publication or discard and are never automatically re-analyzed. |
| APP-AC-25 | FR-04.3-FR-04.8, FR-05.2-FR-05.4, INV-07 | AC-10-AC-12 | Primary: versions observed during a hold are retained separately and become eligible only after the hold is explicitly released. |
| APP-AC-69 | FR-01.1-FR-01.4, FR-03.1-FR-03.6, INV-02-INV-04 | AC-01-AC-04, AC-13, AC-15 | Shared: F10 owns immutable content-hashed snapshots; F11 owns their durable eligibility/handled associations. |

## Executive Summary

F10 can tell PRMonitor that a new immutable feedback version exists, but that
observation alone must not start another AI operation. The application needs a
deterministic gate that rejects duplicates and clearly non-actionable records,
keeps feedback from the application or ignored service accounts out of review,
and prevents one pull request from receiving competing automatic work.

F11 evaluates each observed version using only explicit identity, content,
remote PR state, configuration, and persisted association state. It records a
stable reason for every non-eligible outcome, atomically claims eligible
versions for one automatic operation, and maintains a durable per-PR review
hold. New feedback observed while a PR is working or awaiting human attention
is retained as separate input rather than changing the active bundle or
releasing its hold. Publication, discard, and explicit re-evaluation workflows
consume these records later; F11 never calls an AI provider or mutates code.

## User Stories

### Deterministic eligibility

- **US-01:** **GIVEN** F10 has stored a new version for an open managed PR, **WHEN** F11 evaluates it, **THEN** the version is either admitted once with a deterministic reason or rejected with a safe reason code that a later UI can explain.
  - **Acceptance Criteria:** AC-01-AC-08, AC-17.
- **US-02:** **GIVEN** the same semantic version is delivered again or a prior observation is replayed, **WHEN** F11 evaluates it, **THEN** no second eligible claim or automatic operation is created.
  - **Acceptance Criteria:** AC-02-AC-04, AC-09.
- **US-03:** **GIVEN** a reviewer uses an ignored account or the event is authored by PRMonitor, **WHEN** F11 evaluates it, **THEN** deterministic identity matching rejects it without keyword or semantic guessing.
  - **Acceptance Criteria:** AC-05-AC-06.

### Per-PR holds and concurrency

- **US-04:** **GIVEN** an automatic review is already working for a PR, **WHEN** another poll or scheduler invocation sees feedback for that PR, **THEN** no competing automatic operation starts and the new versions remain available for later handling.
  - **Acceptance Criteria:** AC-09-AC-10, AC-15.
- **US-05:** **GIVEN** a Review Bundle is ready for review or needs attention, **WHEN** the application window closes, restarts, or the user selects the PR, **THEN** the per-PR automatic hold remains active and the active worktree/bundle is not changed by background eligibility work.
  - **Acceptance Criteria:** AC-11, AC-14, AC-16.
- **US-06:** **GIVEN** new feedback arrives during a hold, **WHEN** the hold is later released through an allowed explicit outcome, **THEN** only still-unhandled retained versions can enter a future automatic batch.
  - **Acceptance Criteria:** AC-10-AC-14.

### Durable history and handoff

- **US-07:** **GIVEN** a Review Bundle has handled versions and is published or discarded, **WHEN** the same versions are observed again, **THEN** the handled associations remain visible in history and the versions do not re-enter automatic analysis.
  - **Acceptance Criteria:** AC-13-AC-14.
- **US-08:** **GIVEN** two managed PRs have identical remote object IDs or similar feedback, **WHEN** their eligibility is evaluated concurrently, **THEN** each PR retains its own decision, claim, hold, and history.
  - **Acceptance Criteria:** AC-15-AC-16.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** an immutable F10 version has a valid server/repository/PR/source identity, is not already associated, and its managed PR is open, **WHEN** F11 evaluates it, **THEN** F11 records exactly one `ELIGIBLE` decision and exposes the version ID to the scheduler without invoking an AI provider.
- **AC-02:** **GIVEN** the same immutable version is evaluated repeatedly, **WHEN** the request is retried with the same scoped version identity, **THEN** the result is an idempotent duplicate/no-op and no second eligibility record, claim, batch membership, or AI dispatch is possible.
- **AC-03:** **GIVEN** the same remote object has a different F10 semantic version hash, **WHEN** F11 evaluates it, **THEN** the changed version remains distinguishable from the prior version and is not rejected merely because the remote object ID matches.
- **AC-04:** **GIVEN** two servers, repositories, pull requests, or feedback sources reuse a remote ID, **WHEN** F11 evaluates their versions, **THEN** their decisions and associations remain separate by the complete scoped identity.
- **AC-05:** **GIVEN** a feedback author exactly matches the configured PRMonitor automation identity for that server, **WHEN** F11 evaluates the version, **THEN** it records `PRMONITOR_AUTHORED` and never admits it to automatic analysis; a missing or mismatched identity does not cause unrelated authors to be filtered.
- **AC-06:** **GIVEN** a version has no semantic content, is a bodyless approval, or its author is in the exact configured ignored-account set, **WHEN** F11 evaluates it, **THEN** it records the corresponding deterministic reason (`EMPTY_EVENT`, `BODYLESS_APPROVAL`, or `IGNORED_ACCOUNT`) without keyword matching or AI judgment.
- **AC-07:** **GIVEN** the current authoritative PR state is closed or merged, **WHEN** F11 evaluates a new or replayed version, **THEN** it records `PR_CLOSED` or `PR_MERGED` and does not create an automatic claim.
- **AC-08:** **GIVEN** feedback is syntactically valid but its importance is semantic or ambiguous, **WHEN** F11 evaluates it, **THEN** F11 does not classify it by keywords, sentiment, or model judgment; it either admits it or rejects it only under an explicit deterministic rule.
- **AC-09:** **GIVEN** two automatic dispatches race for the same PR, **WHEN** both attempt to claim eligible versions, **THEN** one transaction wins the per-PR automatic-operation slot and the other receives a typed conflict/hold result with no second operation or worktree owner.
- **AC-10:** **GIVEN** a PR is `WORKING`, `READY_FOR_REVIEW`, or `NEEDS_ATTENTION`, **WHEN** a new immutable version is observed, **THEN** F11 retains it separately as `RETAINED_DURING_HOLD`, does not attach it to the active bundle, and does not release or mutate the hold/worktree.
- **AC-11:** **GIVEN** a held PR's renderer is closed, the application restarts, or the user opens another PR, **WHEN** F11 reloads eligibility state, **THEN** the same hold owner, reason, and held versions are restored and no automatic work starts solely because of the lifecycle event.
- **AC-12:** **GIVEN** a held PR receives several new versions, **WHEN** the hold is released by an allowed explicit outcome, **THEN** F11 exposes only retained versions that are still unhandled and otherwise eligible; already handled or filtered versions remain excluded.
- **AC-13:** **GIVEN** a version is assigned to a Review Bundle, **WHEN** that bundle is published, published with errors, or discarded, **THEN** F11 records the handled association permanently, preserves its bundle/outcome history, and rejects later automatic assignment of that exact version.
- **AC-14:** **GIVEN** a retained version is to be used in a new bundle after a hold, **WHEN** a human explicitly authorizes re-evaluation through the owning workflow, **THEN** F11 records the authorization and new bundle association; an automatic poll or scheduler cannot perform that transition implicitly.
- **AC-15:** **GIVEN** two managed PRs contain the same remote object ID or a concurrent evaluation is retried after a transaction conflict, **WHEN** F11 commits results, **THEN** each PR has isolated claims/holds and the losing retry can safely read the winner without duplicating associations.
- **AC-16:** **GIVEN** persistence fails, the process stops, or cancellation occurs before a claim/hold commit, **WHEN** the application recovers, **THEN** no version is falsely marked handled and no partially committed automatic operation is exposed as active; committed state remains authoritative and retryable.
- **AC-17:** **GIVEN** an eligibility request has malformed scope, unsupported state, secret-bearing data, or an unavailable required identity, **WHEN** F11 validates it, **THEN** it fails closed with a bounded actionable reason and performs no claim, hold release, AI call, worktree mutation, or publication effect.

## Functional Requirements

### FR-01: Scoped eligibility inputs and decisions

- FR-01.1: F11 SHALL evaluate only normalized immutable F10 event versions together with an explicit managed-PR identity, current authoritative PR status, server-scoped automation identity, ignored-account configuration, and persisted event/hold state.
- FR-01.2: F11 SHALL require server, repository, pull-request, source, remote-object, and semantic-version identity to be present before making an eligibility decision.
- FR-01.3: F11 SHALL produce a typed decision containing the event-version ID, decision (`ELIGIBLE`, `DEFERRED_BY_HOLD`, or `INELIGIBLE`), deterministic reason code, correlation/observation reference, and the next permitted action.
- FR-01.4: F11 SHALL record the decision against the immutable version and managed PR without rewriting the F10 snapshot or relying on free-form activity text as state.
- FR-01.5: F11 SHALL use a stable rule precedence so the same inputs produce the same primary reason when more than one exclusion applies.

### FR-02: Deterministic exclusion and no semantic guessing

- FR-02.1: F11 SHALL reject an exact immutable version already assigned to an active or completed Review Bundle from automatic eligibility.
- FR-02.2: F11 SHALL reject versions authored by the configured PRMonitor automation identity using exact server-scoped identity matching, without exposing credentials.
- FR-02.3: F11 SHALL reject an event with no semantic content and SHALL reject a review approval with no body as separate deterministic outcomes; it SHALL preserve other F10 fields needed to make that decision.
- FR-02.4: F11 SHALL reject authors in the configured ignored-account set using exact normalized account identity, not substring, wildcard, keyword, sentiment, or model matching.
- FR-02.5: F11 SHALL reject automatic eligibility for a PR whose authoritative remote state is closed or merged, with distinct safe reason codes.
- FR-02.6: F11 SHALL not infer whether a non-empty comment is important, trivial, actionable, or contradictory; semantic assessment belongs to the configured AI provider after explicit eligibility.
- FR-02.7: F11 SHALL preserve a changed semantic version of a previously seen remote object as a distinct candidate unless another explicit rule excludes that version.

### FR-03: Deduplication, claims, and handled history

- FR-03.1: F11 SHALL treat the complete scoped immutable version identity, not a remote object ID or timestamp alone, as the deduplication key.
- FR-03.2: F11 SHALL make repeated evaluation of the same version idempotent and SHALL prevent duplicate eligibility records, automatic claims, batch memberships, and operation dispatches.
- FR-03.3: F11 SHALL atomically associate an admitted version with one active automatic Review Bundle claim, or return a typed conflict without creating a second association.
- FR-03.4: F11 SHALL preserve a version's association history when a bundle is published, published with errors, or discarded.
- FR-03.5: F11 SHALL keep an exact version ineligible for ordinary automatic analysis once it is `HANDLED_BY_BUNDLE`.
- FR-03.6: F11 SHALL allow a retained version to be assigned to a new bundle only through an explicit human-authorized re-evaluation transition; normal polling and batching SHALL not authorize it.

### FR-04: Per-PR automatic holds

- FR-04.1: F11 SHALL maintain at most one automatic Review Bundle/AI operation slot and one associated hold owner for each managed PR.
- FR-04.2: F11 SHALL acquire the per-PR automatic-operation claim before downstream automatic work begins and SHALL reject or defer competing dispatches deterministically.
- FR-04.3: F11 SHALL keep a PR in an automatic hold while it is `WORKING`, `READY_FOR_REVIEW`, or `NEEDS_ATTENTION` for the associated operation/bundle.
- FR-04.4: F11 SHALL retain new immutable versions observed during a hold separately from the active bundle and SHALL expose them as deferred rather than eligible for the held operation.
- FR-04.5: F11 SHALL not release a hold because a renderer closes, the application restarts, the PR is selected, a notification is opened, or global watching is paused/resumed.
- FR-04.6: F11 SHALL accept hold release only from the owning workflow with an explicit human-associated `PUBLISHED`, `PUBLISHED_WITH_ERRORS`, or `DISCARDED` outcome and a valid bundle/worktree association.
- FR-04.7: On hold release, F11 SHALL make only still-unhandled retained versions available for a future automatic batch; it SHALL not automatically re-admit handled, filtered, or invalid versions.
- FR-04.8: F11 SHALL prevent an eligibility result from authorizing mutation of the active held worktree; downstream mutating work SHALL revalidate the hold/claim at its own boundary.

### FR-05: Concurrency, persistence, and downstream handoff

- FR-05.1: F11 SHALL scope every eligibility decision, claim, hold, and handled association to one managed PR and SHALL never use a global remote-object key.
- FR-05.2: F11 SHALL expose a stable read/claim contract for F12 and F18 that returns version IDs, decision reasons, hold state, operation/bundle owner, and retry/conflict state without requiring log parsing.
- FR-05.3: F11 SHALL make empty eligible claims a normal no-op and SHALL not create a Review Bundle, hold, or AI operation for an empty set.
- FR-05.4: F11 SHALL preserve the exact input-version set and rule/configuration snapshot used for a claim so a later configuration edit cannot change the meaning of an existing decision.
- FR-05.5: F11 SHALL record bounded structured activity for eligibility, deduplication, hold retention, claim conflict, release, and handled outcomes without storing credentials or uncontrolled remote payloads.

### FR-06: Failure, cancellation, and restart

- FR-06.1: F11 SHALL persist intent before handing an automatic claim to downstream work and SHALL use idempotent identities for retries and startup reconciliation.
- FR-06.2: A failure or cancellation before a claim/hold transaction commits SHALL leave no handled association, active operation, or false successful eligibility claim.
- FR-06.3: A failure after commit SHALL expose the committed claim/hold as the authoritative state and SHALL require deterministic reconciliation rather than silently releasing or duplicating it.
- FR-06.4: F11 SHALL restore holds, associations, decisions, and retained versions after renderer closure and ordinary process restart.

### FR-07: Trust boundary

- FR-07.1: F11 SHALL use deterministic code for identity comparison, rule evaluation, deduplication, locking, persistence, and recovery; it SHALL not import or invoke an AI provider.
- FR-07.2: F11 SHALL not call Git, worktree, validation, notification, GitHub mutation, commit, push, merge, or publication services.
- FR-07.3: F11 SHALL keep credentials, authorization headers, provider prompts/SDK objects, secret-bearing environment values, and raw uncontrolled remote payloads outside eligibility state, activity, IPC, UI state, and test evidence.

## Non-Functional Requirements

- **NFR-01: Determinism** - The same scoped event version, PR state, configuration snapshot, association state, and clock-independent inputs SHALL produce the same decision, reason, and legal transition.
- **NFR-02: Idempotency** - Replayed poll delivery, scheduler retries, transaction retries, renderer recreation, and process restart SHALL not create duplicate claims, holds, bundle associations, or handled records.
- **NFR-03: Durability** - Committed decisions, retained versions, claims, holds, and handled associations SHALL survive renderer closure and ordinary restart.
- **NFR-04: Isolation** - A decision, hold, duplicate, or persistence conflict for one server/repository/PR/source SHALL not affect another scope.
- **NFR-05: Bounded operation** - Eligibility evaluation and claim lookup SHALL be bounded by configured batch/page limits and SHALL not scan unbounded raw payloads or create unbounded concurrent operations.
- **NFR-06: Security and privacy** - Secret material and uncontrolled remote data SHALL be rejected or redacted at the F11 boundary; reason details SHALL remain safe for renderer display and diagnostics.
- **NFR-07: Recovery clarity** - Failure, cancellation, conflict, and held outcomes SHALL have actionable typed reasons and SHALL never be represented only by an ambiguous boolean or status label.
- **NFR-08: Testability** - The deep eligibility/association module SHALL accept injected clocks, repositories, current-PR snapshots, configuration, cancellation, and fault points without real GitHub, AI, Git, or credentials.

## Invariants

- **INV-01:** F11 is deterministic infrastructure and never invokes AI to decide eligibility, duplication, holds, or persistence outcomes.
- **INV-02:** An immutable event-version identity is scoped by server, repository, PR, source, remote object, and semantic version; a remote ID alone is insufficient.
- **INV-03:** Handling is append-only: publication or discard preserves the version-to-bundle association and cannot make the exact version automatically eligible again.
- **INV-04:** A version can have at most one active automatic bundle claim and one final handled owner; retries are idempotent no-ops or typed conflicts.
- **INV-05:** Eligibility and hold state are scoped to the owning managed PR; cross-PR data cannot satisfy a claim or release a hold.
- **INV-06:** `WORKING`, `READY_FOR_REVIEW`, and `NEEDS_ATTENTION` protect the owning PR with a durable automatic hold until an allowed explicit outcome or explicit continuation transition is recorded.
- **INV-07:** New versions observed during a hold are retained separately and cannot mutate the held bundle, worktree, or primary state.
- **INV-08:** Closing the UI, restarting, selecting a PR, or changing global pause never releases a per-PR hold or resets a claim.
- **INV-09:** F11 has no publication authority and cannot call GitHub mutation, Git, worktree, validation, notification, commit, push, merge, or publication services.
- **INV-10:** No credential, authorization header, provider object, prompt, secret-bearing environment value, or unbounded remote payload is persisted or exposed as F11 state.

## Out of Scope

- **Polling and immutable version construction** - F10 owns remote requests, conditional metadata, pagination, normalization, and content hashing.
- **Quiet periods, Check Now, global pause, and scheduler timers** - F12 owns when a poll or eligible batch is dispatched; F11 only supplies the deterministic eligible set and per-PR gate.
- **Semantic assessment** - F11 does not decide whether a comment is a bug, trivial, actionable, or worth a code change.
- **Worktrees, validation, AI operations, review proposals, responses, notifications, and publication** - F13-F23 own those effects and must revalidate F11 authorization at their boundaries.
- **Remote deletion or compaction of event history** - F11 retains handled association history for the MVP.
- **Per-hunk user patch selection and automatic rebase** - These remain application non-goals.

## Product Decisions

- **PD-01: Use an explicit deterministic rule order** - The primary reason is selected from scoped-invalid, already-handled/assigned, author, content, ignored-account, PR-status, hold, and eligible checks in a stable order so retries are explainable.
- **PD-02: Ignore accounts by exact server-scoped identity** - The configuration stores normalized GitHub login identities for the relevant server; it does not support keyword, substring, wildcard, or semantic matching.
- **PD-03: A hold is per managed PR, not global** - One PR can be held while other PRs continue to be evaluated; the global pause overlay is a separate F12 concern.
- **PD-04: Handled means handled forever for automatic analysis** - Publishing or discarding a bundle does not make its exact versions eligible again. Explicit re-evaluation is a distinct human-authorized path and is not ordinary automatic eligibility.
- **PD-05: Retain new feedback during a hold** - Polling remains useful while a PR is held, but retained versions do not modify the active bundle or release its hold.
- **PD-06: Closed and merged PRs are never automatically eligible** - The observed versions remain history, while any later user-directed workflow decides whether a separate action is appropriate.
- **PD-07: F11 has no dedicated UI** - F11 provides safe reason codes and read models; F08/F19/F20 decide how to present them accessibly.

## Implementation Decisions

- **IMP-01: Reuse the F02 event-version association state machine** - `UNASSIGNED`, `ASSIGNED_TO_ACTIVE_BUNDLE`, `RETAINED_DURING_HOLD`, and `HANDLED_BY_BUNDLE` are the authoritative association states; F11 does not create a parallel lifecycle.
- **IMP-02: Use transactionally acquired claims** - A claim records the exact version set, PR, bundle/operation owner, effective rule/configuration snapshot, and expected aggregate version before downstream work starts.
- **IMP-03: Keep eligibility decisions append-only and current read models derived** - Re-evaluation of a decision records a new event or association transition rather than rewriting the original evidence.
- **IMP-04: Keep F10, F12, and F02 boundaries explicit** - F10 supplies observations, F12 supplies scheduling, and F02 validates state transitions; F11 composes them through typed ports.
- **IMP-05: Recheck authorization before mutation** - F18/F21/F26 and publication features must verify the claim/hold owner and event-version set immediately before their own side effects.

## Testing Decisions

- **TST-01: Deep-test the rule evaluator** - Use a truth table for every exclusion rule, stable precedence, exact account matching, open/closed/merged state, null/empty/bodyless content, and no-keyword behavior.
- **TST-02: Deep-test the association state machine** - Exercise duplicate assignment, retention, explicit re-evaluation, handled outcomes, invalid owners, expected-version conflicts, and idempotent retries at the F02 boundary.
- **TST-03: Fault-inject claim and hold transactions** - Stop before request, before commit, after commit, during release, and during restart reconciliation; verify no false handled state and no duplicate operation.
- **TST-04: Prove cross-PR isolation** - Reuse remote IDs, bundle IDs, authors, and concurrent requests across servers/repositories/PRs and assert independent outcomes.
- **TST-05: Prove no-effect boundaries** - Use import checks and spies to show F11 cannot reach AI, Git, worktree, validation, notification, response, commit, push, merge, or publication code.
- **TST-06: Defer dedicated rendering tests** - F11 supplies typed safe data; F08/F19/F20 own visual, keyboard, screen-reader, notification, and user-facing action tests.

## Proposed Modules

- **MOD-01: Eligibility Rule Evaluator** - Applies the ordered deterministic rules to one immutable version and returns a typed decision/reason.
- **MOD-02: Eligibility Decision Repository** - Persists decisions, rule/configuration snapshots, and safe reason details without changing F10 history.
- **MOD-03: Event Association Gate** - Claims, retains, re-evaluates, and marks versions handled through the F02 association contract.
- **MOD-04: Per-PR Automatic Hold Coordinator** - Acquires the one-operation slot, validates hold ownership, and releases it only after an allowed outcome.
- **MOD-05: Eligibility Query/Claim Service** - Supplies F12/F18 stable eligible/deferred sets and atomic claim results without log parsing.
- **MOD-06: Safe Diagnostics Adapter** - Emits bounded activity for rules, claims, holds, retries, and conflicts while remaining non-authoritative.

## Workflows

### Workflow 1: Evaluate a newly observed version

```text
1. F10 supplies one immutable version, its managed-PR scope, current PR status, and configuration snapshot.
2. F11 validates scope and loads the event association and per-PR hold/operation state.
3. The ordered deterministic rules check duplicate/handled state, automation author, content, ignored account, PR status, and active hold.
4. F11 persists the decision and returns an eligible, deferred, or ineligible typed result with a safe reason.
5. F12 may later claim eligible versions; F11 does not invoke AI or start a bundle from the evaluation alone.
```

### Workflow 2: Claim one automatic operation

```text
1. F12 asks F11 for the current eligible set for one managed PR.
2. F11 atomically verifies that the PR is open, unheld, and has no active automatic operation.
3. F11 claims the exact immutable version IDs for one new bundle/operation and acquires the per-PR hold.
4. A competing request receives a typed conflict or hold result and cannot create a second owner.
5. F18 revalidates the claim before any worktree or AI mutation.
```

### Workflow 3: Observe feedback during a hold

```text
1. F10 observes a new version while the PR is WORKING, READY_FOR_REVIEW, or NEEDS_ATTENTION.
2. F11 records RETAINED_DURING_HOLD without changing the active bundle or worktree.
3. Restart, renderer closure, and global pause preserve the hold and retained version.
4. After an allowed explicit outcome releases the hold, F11 exposes only still-unhandled retained versions.
5. F12 may batch them; explicit re-evaluation of an older retained version requires a human authorization record.
```

### Workflow 4: Complete a handled version

```text
1. A claimed bundle completes publication, publication-with-errors, or discard.
2. The owning workflow asks F11 to mark each assigned version HANDLED_BY_BUNDLE with the outcome.
3. F11 commits the handled association and hold release transactionally and idempotently.
4. Later replay of the same immutable version returns an already-handled result and cannot re-enter automatic analysis.
```

## Contract-Test Criteria

- **CT-F11-01:** Ordered eligibility truth table covers valid scope, missing scope, duplicate/handled/assigned state, automation identity, empty content, bodyless approval, ignored account, open/closed/merged PR, active hold, and no-keyword behavior.
- **CT-F11-02:** Complete scoped identity and semantic-version matrix proves same remote IDs across servers/repositories/PRs/sources remain isolated and changed versions are not collapsed.
- **CT-F11-03:** Idempotent claim/association tests prove one exact version has at most one active bundle owner, duplicate retries are no-ops, and competing transactions return a typed conflict.
- **CT-F11-04:** Hold tests prove `WORKING`, `READY_FOR_REVIEW`, and `NEEDS_ATTENTION` retain new versions without active-bundle mutation, worktree effects, or automatic dispatch.
- **CT-F11-05:** Release/handled tests prove publish, publish-with-errors, and discard preserve handled history; release exposes only still-unhandled retained versions; explicit re-evaluation is human-authorized.
- **CT-F11-06:** Restart, cancellation, persistence fault, renderer-closure, and global-pause tests prove holds/claims/decisions survive and no pre-commit failure fabricates handled or active state.
- **CT-F11-07:** No-effect, redaction, bounded-result, downstream-contract, and cross-PR isolation tests prove F11 cannot call AI/Git/worktree/validation/publication or leak credentials/raw payloads.

## Requirement Traceability

| Requirement family | Observable coverage |
|---|---|
| FR-01 | AC-01-AC-04, AC-15-AC-17; CT-F11-01, CT-F11-02, CT-F11-06 |
| FR-02 | AC-02-AC-08, AC-17; CT-F11-01, CT-F11-02, CT-F11-07 |
| FR-03 | AC-02-AC-04, AC-09, AC-13-AC-15; CT-F11-02, CT-F11-03, CT-F11-05 |
| FR-04 | AC-09-AC-14, AC-16; CT-F11-03-CT-F11-06 |
| FR-05 | AC-01, AC-09, AC-12, AC-15-AC-17; CT-F11-03, CT-F11-06, CT-F11-07 |
| FR-06 | AC-11-AC-17; CT-F11-05-CT-F11-06 |
| FR-07 | AC-01-AC-08, AC-16-AC-17; CT-F11-01, CT-F11-07 |
| NFR-01-NFR-08 | AC-01-AC-17; CT-F11-01-CT-F11-07 |
| INV-01-INV-10 | AC-01-AC-17; CT-F11-01-CT-F11-07 |

