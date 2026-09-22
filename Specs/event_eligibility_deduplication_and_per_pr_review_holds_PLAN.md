<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single level. The goal is to provide the AI and the user with a visible and testable result when the work is complete.
There might be slices that are needed to describe work that doesn't extend through all levels, that's fine, but the preference should be towards vertical slices since this will result in the best quality output.
-->

# Plan: F11 Event Eligibility, Deduplication, and Per-PR Review Holds

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** `Specs/event_eligibility_deduplication_and_per_pr_review_holds_PRD.md`
>
> **Last revalidated against:** `Specs/application_overview.md` revision 2026-09-21 and F11 PRD revision 2026-09-21
>
> **Entry/readiness gates:** F02 exposes the event-version association and primary review-hold transitions with expected-version conflict handling. F03 exposes transactional repositories, migrations, uniqueness constraints, fault injection, and restart-safe records. F10 exposes scoped immutable remote-event versions, current PR state, observation references, and renderer-independent outcomes. Test fixtures can inject account configuration, current PR status, concurrent claims, cancellation, persistence faults, renderer closure, process restart, and no-effect spies.
>
> This PLAN cannot change product requirements. Resolve contradictions in the owning PRD before implementation and rerun both specification linters. This feature does not check the checklist item; implementation and approval are separate.

## Implementation Boundary

F11 adds the deterministic eligibility gate between F10 observation and F12/F18
automatic work. It evaluates immutable versions, records safe reasoned
decisions, composes F02 event-version association transitions, enforces one
automatic operation and hold per managed PR, retains new versions during a
hold, and exposes atomic query/claim/release contracts.

F02 remains authoritative for legal aggregate transitions and expected-version
conflicts. F03 remains authoritative for SQLite, migrations, transactions,
uniqueness, and restart durability. F10 remains authoritative for remote
transport, normalization, semantic hashing, and immutable event snapshots.
F12 owns quiet periods, Check Now, global pause, and scheduler timing. F18-F23
own worktree/AI mutation and must revalidate F11 authorization before their own
side effects. F11 does not create a UI, call an AI provider, mutate a worktree,
run validation, or publish anything.

## Readiness Gates

- F02's `EventVersionAssociation` state machine supports idempotent assignment, hold retention, explicit human-authorized re-evaluation, and permanent handled outcomes; the primary PR state machine represents the same automatic hold owner.
- F03 can atomically persist a decision/association/claim/hold outcome with an expected aggregate version and can expose committed-versus-uncommitted results after injected failure.
- F10 supplies one immutable event-version ID and complete scope for every candidate, preserves changed semantic versions, and provides authoritative current PR open/closed/merged status or a typed unavailable outcome.
- The automation identity and ignored-account configuration are server-scoped, normalized, bounded, and available without exposing a credential or authorization header.
- Downstream test doubles can prove F12 consumes typed eligibility results and F18 refuses mutation when a claim/hold is missing, stale, or owned by another operation.
- No test requires real GitHub, AI, Git, worktree, validation, notification, response, commit, push, merge, or publication side effects.

## Proposed Vertical Slices

1. **Eligibility contract and ordered rule evaluator**
   - **Blocked by:** F02 event-version types, F10 normalized version contract, and the server-scoped identity/configuration input.
   - **Stories / requirements / acceptance criteria:** US-01-US-03, US-08; FR-01.1-FR-01.5, FR-02.1-FR-02.7, FR-07.1; NFR-01, NFR-05-NFR-08; INV-01-INV-02, INV-05, INV-09-INV-10; AC-01-AC-08, AC-15, AC-17; CT-F11-01, CT-F11-02, CT-F11-07.
   - **Visible result:** A deterministic evaluator accepts a bounded immutable-version input and returns one stable eligible/ineligible reason, with no AI or renderer dependency.
   - **Durable records / external effects:** No external provider effect. Test-owned decision records may be written through an injected repository; raw F10 payloads and credentials never enter the result.
   - **Failure / cancellation / restart:** Missing scope, unavailable identity, unsupported state, oversized content, and secret-shaped data fail closed with a safe reason. The same input after restart produces the same decision.
   - **Exact evidence:** Rule-precedence truth table; empty/null/bodyless approval matrix; exact/case-normalized account matching; open/closed/merged matrix; keyword and AI import scan; bounded/redacted DTO snapshot; CT-F11-01, CT-F11-02, and CT-F11-07.
   - **Exit criterion:** AC-01-AC-08 and AC-17 pass at the pure evaluator boundary and every FR-02 rule has a named reason code and contract-test case.

2. **Durable decision ledger and scoped association lookup**
   - **Blocked by:** Slice 1 and F03 migrations/repositories.
   - **Stories / requirements / acceptance criteria:** US-01-US-03, US-07-US-08; FR-01.2-FR-01.5, FR-03.1-FR-03.6, FR-05.1-FR-05.5; NFR-02-NFR-04, NFR-06-NFR-07; INV-02-INV-05, INV-10; AC-01-AC-04, AC-13, AC-15-AC-17; CT-F11-01, CT-F11-02, CT-F11-05, CT-F11-07.
   - **Visible result:** Repeated evaluation of a version reads the same decision and association; changed versions of one remote object remain separate; two PRs with the same remote ID do not collide.
   - **Durable records / external effects:** Adds F03-backed eligibility decisions, rule/configuration snapshots, association references, and safe reason data. F10 event snapshots remain append-only and authoritative for content.
   - **Failure / cancellation / restart:** Unique-key conflicts resolve to the existing scoped record; predecessor versions are never overwritten; migration and readback failures surface as actionable persistence outcomes rather than an eligibility success.
   - **Exact evidence:** Schema/migration fixture; same-version replay; changed-hash replay; cross-server/repository/PR/source collision matrix; expected-version conflict; redaction scan; restart readback; CT-F11-02, CT-F11-05, and CT-F11-07.
   - **Exit criterion:** AC-02-AC-04, AC-13, AC-15, and AC-16 pass with durable evidence and no record can be found by remote ID alone.

3. **Atomic eligible claims and one automatic operation per PR**
   - **Blocked by:** Slices 1-2, F02 primary-state transitions, F03 transaction support, and F12/F18 typed test ports.
   - **Stories / requirements / acceptance criteria:** US-02, US-04, US-08; FR-03.2-FR-03.3, FR-04.1-FR-04.2, FR-05.1-FR-05.4, FR-06.1-FR-06.3; NFR-01-NFR-04, NFR-08; INV-03-INV-05, INV-09; AC-01-AC-02, AC-09, AC-15-AC-17; CT-F11-03, CT-F11-06, CT-F11-07.
   - **Visible result:** F12 can request a non-empty eligible set and atomically claim it for one bundle/operation; a concurrent request gets a typed conflict/hold result and never creates a second owner.
   - **Durable records / external effects:** Persists the exact version IDs, managed PR, bundle/operation IDs, expected versions, effective rule/configuration snapshot, claim time, and safe correlation. No AI/worktree effect occurs in the claim transaction.
   - **Failure / cancellation / restart:** Empty claims are no-ops. A conflict or pre-commit cancellation leaves no active owner. A post-commit failure leaves the committed owner authoritative for startup reconciliation; retry returns it rather than creating another.
   - **Exact evidence:** Two-writer race; empty/filtered batch; claim-before-downstream probe; transaction fault matrix; retry after restart; F18 mutation refusal without valid claim; CT-F11-03, CT-F11-06, and CT-F11-07.
   - **Exit criterion:** AC-01, AC-02, AC-09, AC-15, and AC-16 pass, and the one-operation-per-PR invariant is enforced by the persistence boundary rather than an in-memory lock alone.

4. **Hold retention and explicit release**
   - **Blocked by:** Slice 3, F02 primary hold transitions, and F10 observed-version handoff.
   - **Stories / requirements / acceptance criteria:** US-04-US-06; FR-04.3-FR-04.8, FR-05.2-FR-05.5; NFR-02-NFR-04, NFR-07; INV-06-INV-08; AC-10-AC-12, AC-14, AC-16; CT-F11-04, CT-F11-05, CT-F11-06.
   - **Visible result:** A PR in `WORKING`, `READY_FOR_REVIEW`, or `NEEDS_ATTENTION` keeps its hold after new feedback, renderer closure, and restart; new versions appear as retained/deferred rather than changing the active bundle.
   - **Durable records / external effects:** Persists hold owner/reason, retained version associations, primary-operation identity, release action, and safe transition history. No worktree or AI effect is authorized by retention.
   - **Failure / cancellation / restart:** Selecting a PR, opening a notification, closing the window, or changing global pause cannot release the hold. Release requires the owning bundle and an explicit allowed outcome; invalid release is a typed no-op/error.
   - **Exact evidence:** Three-state hold matrix; new-version-during-hold fixture; active-bundle immutability assertion; window close/restart/global-pause probes; valid/invalid release matrix; CT-F11-04, CT-F11-05, and CT-F11-06.
   - **Exit criterion:** AC-10-AC-12, AC-14, and AC-16 pass, and retained versions cannot be accidentally claimed by the held operation or another PR.

5. **Handled outcomes and explicit re-evaluation handoff**
   - **Blocked by:** Slice 4, F18 Review Bundle association, and F22 discard/re-evaluation contracts.
   - **Stories / requirements / acceptance criteria:** US-06-US-08; FR-03.4-FR-03.6, FR-04.6-FR-04.7, FR-05.2, FR-06.3-FR-06.4; NFR-02-NFR-04, NFR-07; INV-03-INV-08; AC-10-AC-14, AC-16; CT-F11-04, CT-F11-05, CT-F11-06.
   - **Visible result:** Publish, publish-with-errors, and discard all preserve handled associations; releasing a hold exposes only still-unhandled versions, while a retained version can enter a new bundle only through a human-authorized re-evaluation handoff.
   - **Durable records / external effects:** Stores final handled outcome, bundle identity, re-evaluation authorization, new bundle identity, and transition history. F11 itself performs no GitHub publication.
   - **Failure / cancellation / restart:** Repeated completion is idempotent for the owning bundle. A different bundle cannot mark the version handled. A failed release/re-evaluation remains held and retryable with prior history intact.
   - **Exact evidence:** Outcome matrix; duplicate completion; wrong-owner completion; release-with-new/handled/filtered versions; explicit-human versus automatic re-evaluation; restart readback; CT-F11-05 and CT-F11-06.
   - **Exit criterion:** AC-10-AC-14 and AC-16 pass, and F12/F18/F22 can consume a single typed contract without interpreting association history themselves.

6. **Conformance, recovery, and implementation handoff**
   - **Blocked by:** Slices 1-5, all readiness gates, and the final application-coverage report.
   - **Stories / requirements / acceptance criteria:** US-01-US-08; all FRs, NFRs, and INVs; AC-01-AC-17; CT-F11-01-CT-F11-07; APP-AC-03, APP-AC-05, APP-AC-07-APP-AC-09, APP-AC-16-APP-AC-17, APP-AC-24-APP-AC-25, APP-AC-69.
   - **Visible result:** A machine-readable conformance report proves deterministic filtering, exactly-once version claiming, durable per-PR holds, retained feedback, permanent handled history, and zero provider/mutation effects.
   - **Durable records / external effects:** Uses temporary test databases, fake F10 inputs, fake F12/F18 ports, and bounded activity/evidence files only; no checklist edit, credential, live GitHub, AI, Git, or publication effect.
   - **Failure / cancellation / restart:** Any false eligibility, duplicate claim, cross-PR collision, hold release on lifecycle event, handled replay, secret leak, AI import, or missing coverage mapping blocks the gate. A cancelled run leaves no success marker and is rerunnable.
   - **Exact evidence:** `npm run build`, `npm test`, `npm run check`; CT-F11-01 through CT-F11-07; transaction/restart/fault reports; import and secret scan; `git diff --check`; `npm run lint:prd-plan -- Specs/event_eligibility_deduplication_and_per_pr_review_holds_PRD.md Specs/event_eligibility_deduplication_and_per_pr_review_holds_PLAN.md`; `npm run lint:application-coverage -- Specs/application_overview.md Specs/event_eligibility_deduplication_and_per_pr_review_holds_PRD.md`.
   - **Exit criterion:** All F11 requirements have direct evidence, both specification linters report no definite missing/invalid result, unresolved product choices are recorded, and F11 remains unchecked pending implementation approval and completion.

## Cross-Slice Verification and Handoff

- The exact owning PRD is `Specs/event_eligibility_deduplication_and_per_pr_review_holds_PRD.md`; this PLAN does not add polling, batching timers, semantic review, AI work, worktrees, validation, notifications, responses, publication, or a new primary state machine.
- F02 remains authoritative for event-version association and primary-state transitions. F11 must call those contracts and must not duplicate transition logic in repositories or UI code.
- F03 remains authoritative for migrations, transactions, uniqueness, expected-version conflicts, fault injection, and restart recovery. F11 must not use an in-memory lock as its only concurrency control.
- F10 remains authoritative for immutable remote-event content, source scope, semantic hashing, current PR metadata, and observation checkpoints. F11 must not reconstruct a version from mutable GitHub objects or activity prose.
- F12 owns quiet-period batching, Check Now, global pause, and automatic scheduling. F11 supplies eligible/deferred/held results and atomically claims a set when F12 dispatches.
- F18/F21/F26 and publication features own all worktree/provider/GitHub mutation. They must revalidate the F11 claim and hold before side effects, and F11 never grants publication authority.
- F22 may request a human-authorized re-evaluation of retained versions. That explicit path must retain prior history and must not turn ordinary polling into automatic replay of handled versions.
- F08/F19/F20 own the presentation and accessibility of reason codes, holds, retained versions, and next actions. F11 has no dedicated renderer surface.
- F28-F30 own full startup/sleep/network recovery, threat-model hardening, packaging, and release acceptance. F11 supplies concrete deterministic fault and redaction evidence.
- The F11 checklist item remains unchecked. This specification phase creates only the PRD/PLAN pair and does not claim that event filtering, batching, AI review, or publication is implemented.

## Requirement-to-Slice Trace

| Requirement family | Owning slices |
|---|---|
| FR-01 | 1-2, 6 |
| FR-02 | 1-2, 6 |
| FR-03 | 2-5, 6 |
| FR-04 | 3-5, 6 |
| FR-05 | 2-6 |
| FR-06 | 2-6 |
| FR-07 | 1-6 |
| NFR-01-NFR-08 | 1-6 |
| INV-01-INV-10 | 1-6 |
| APP-AC-03 | 2-3, 6 |
| APP-AC-05 | 1-3, 6 |
| APP-AC-07 | 1-5, 6 |
| APP-AC-08 | 1-2, 6 |
| APP-AC-09 | 3-5, 6 |
| APP-AC-16-APP-AC-17 | 3-6 |
| APP-AC-24-APP-AC-25 | 4-6 |
| APP-AC-69 | 2-5, 6 |
