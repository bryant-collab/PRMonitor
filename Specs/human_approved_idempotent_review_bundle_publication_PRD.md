# F23 Human-approved, Idempotent Review Bundle Publication - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F02 - Domain contracts and deterministic state machines | Provides legal Review Bundle, hold, publication-phase, reason, and uncertain-outcome transitions. |
| 2 | F03 - SQLite persistence, migrations, and transactional repositories | Provides approval, publication-intent, idempotency, phase, response-outcome, and recovery records that survive restart. |
| 3 | F06 - GitHub REST client and remote identity model | Provides exact PR/ref verification and narrowly typed GitHub response operations behind the authenticated server boundary. |
| 4 | F11 - Event eligibility, deduplication, and per-PR review holds | Provides the held-version associations and legal hold release/retention contract. |
| 5 | F13 - Operation-owned Git worktrees and change attribution | Provides canonical worktree ownership, fresh `WorktreeCondition`, three-SHA identity, and authoritative proposed-worktree diff evidence. |
| 6 | F14 - Deterministic validation runner and result model | Provides real validation results and any configured final publication recheck. |
| 7 | F18 - Automatic review-to-Review-Bundle vertical slice | Provides the committed final bundle, immutable feedback/input snapshots, final decisions, response drafts, and bundle hold. |
| 8 | F20 - Review Bundle workspace and complete diff viewer | Provides the accessible final-review surface, exact diff inspection, response-draft editing, and typed publication command entry point. |
| 9 | F21 - Read-only conversation and worktree-mutating review revisions | Provides the latest revision/evidence and blocks publication of an active or superseded revision. |
| 10 | F22 - Discard, stale detection, and re-evaluation with dirty-worktree choices | Provides stale/action gates and dirty-worktree evidence that publication must respect. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F28 - Restart, sleep, network-loss, and uncertain-outcome recovery | Reconciles publication records and external effects across process/network faults. |
| 2 | F29 - Security and trust-boundary hardening | Audits publication capabilities, Git/GitHub inputs, credentials, redaction, and fail-closed behavior. |
| 3 | F30 - Windows packaging, end-to-end acceptance, and release readiness | Verifies the complete approval-to-publication workflow on supported Windows and GitHub configurations. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-14 | FR-03.1-FR-03.8, FR-07.1-FR-07.5, INV-01 | AC-07-AC-08, AC-20-AC-22 | Shared: F18/F03 own Review Bundle creation and persistence; F23 owns the durable publication record and terminal publication outcome. |
| APP-AC-16 | FR-07.1-FR-07.5, INV-08 | AC-20-AC-22 | Shared: F11 owns the legal per-PR hold; F23 releases it only after a durable publication outcome is reconciled. |
| APP-AC-17 | FR-03.1-FR-03.8, FR-06.1-FR-06.8, NFR-02 | AC-08, AC-20-AC-22 | Shared: F04/F28 own process lifecycle; F23 keeps publication authoritative and recoverable without a renderer. |
| APP-AC-24 | FR-07.1-FR-07.5, INV-08 | AC-20-AC-21 | Shared: F11 owns handled-version history; F23 supplies the publication outcome that finalizes it. |
| APP-AC-25 | FR-07.1-FR-07.5, INV-08 | AC-20-AC-21 | Shared: F11 owns retained feedback; F23 releases the hold only after its publication outcome is durable. |
| APP-AC-26 | FR-02.1-FR-02.8, INV-04-INV-06 | AC-04-AC-06 | Shared: F22 detects stale work; F23 performs the final pre-publication freshness and worktree recheck. |
| APP-AC-30 | FR-06.1-FR-06.8, NFR-02 | AC-08, AC-22 | Shared: F04 owns application/window lifetime; F23 keeps publication records and recovery active after renderer closure. |
| APP-AC-27 | FR-01.1-FR-01.8, FR-03.1-FR-03.8, INV-02 | AC-01-AC-03, AC-07-AC-08 | Primary: F23 owns explicit approval of the complete proposed diff and selected response intents. |
| APP-AC-28 | FR-02.1-FR-02.8, FR-04.1-FR-04.8, FR-06.1-FR-06.8, INV-03-INV-07 | AC-04-AC-14, AC-20-AC-22 | Primary: F23 owns deterministic commit, non-force push, remote verification, and recovery. |
| APP-AC-29 | FR-01.4-FR-01.8, FR-05.1-FR-05.9, FR-06.1-FR-06.8, INV-03-INV-07 | AC-01-AC-03, AC-15-AC-22 | Primary: F23 owns selected-response publication, per-response outcomes, and response reconciliation. |
| APP-AC-53 | FR-03.2-FR-03.8, FR-04.6-FR-04.7, FR-05.6-FR-05.8, FR-06.1-FR-06.6, NFR-03 | AC-08, AC-13-AC-22 | Shared: F23 owns idempotent Review Bundle publication; F27 owns the parallel synchronization-publication path. |
| APP-AC-39 | FR-02.1-FR-02.8, FR-04.1-FR-04.8, INV-04-INV-06 | AC-04-AC-14 | Shared: F13 supplies actual worktree/diff truth and F22 owns dirty-worktree choices; F23 publishes only the freshly revalidated complete diff the user approved. |
| APP-AC-67 | FR-01.1-FR-01.8, FR-02.1-FR-02.8, FR-04.1-FR-04.8, INV-04-INV-06 | AC-01-AC-14 | Shared: F13/F20 own the three-SHA and diff views; F23 owns the final approved-diff selection and staging boundary. |
| APP-AC-68 | FR-03.1-FR-03.8, FR-04.1-FR-04.8, FR-05.1-FR-05.9, FR-06.1-FR-06.8, INV-03-INV-10 | AC-07-AC-22 | Primary with F28: F23 owns publication phases, idempotency, commit SHA, push reconciliation, and per-response remote IDs; F28 owns cross-feature startup hardening. |
| APP-AC-73 | FR-02.5, FR-07.1-FR-07.2, INV-12 | AC-01, AC-04-AC-05, AC-20-AC-23 | Shared: F14/F18/F20 own validation execution and presentation; F23 gates publication on real configured validation evidence. |
| APP-AC-75 | FR-06.1-FR-06.8, FR-07.1-FR-07.5, INV-01, INV-08 | AC-05-AC-06, AC-20-AC-22 | Shared: F20 owns the accessible presentation; F23 supplies truthful publication/attention reasons and permitted next actions. |

### Explicit coverage boundaries

F23 is the workflow owner for final publication approval, publication intent,
exact-diff revalidation, deterministic commit/push, approved response posting,
uncertain-outcome reconciliation, and the publication outcome handed to F11.
F02 remains authoritative for legal transitions, F03 for durable records and
uniqueness, F06 for authenticated GitHub calls, F13 for actual Git/worktree
truth, F14 for validation truth, F18/F20 for Review Bundle preparation and
presentation, F21 for revisions, and F22 for stale and dirty-worktree choices.

F23 does not own proposal decisions, per-hunk patch acceptance, worktree
cleanup, re-evaluation, automatic branch synchronization, merge conflict
resolution, GitHub review approval, conversation resolution, force push, or
autonomous publication. It never gives commit, push, or response authority to
an AI provider. A response draft excluded from publication remains in bundle
history but has no remote side effect.

## Executive Summary

The final Review Bundle is useful only when the developer can approve exactly
what will leave the machine. F23 turns that final inspection into a durable,
restart-safe publication workflow. It shows the complete proposed-worktree
diff relative to `worktreeBaselineSha`, the exact PR/repository/ref and SHA
identities, the commit message, and the proposed GitHub responses. A single
explicit approval records that snapshot before any commit, push, or response
request begins.

Before every side effect, deterministic code re-fetches and verifies the PR's
current state, destination repository/ref, recorded head SHA, worktree
condition, baseline, and exact candidate diff. A changed head, closed or
merged PR, unknown worktree state, changed candidate, or required validation
failure blocks publication with preserved evidence. Code publication uses a
non-force push to the exact PR head branch; an empty approved diff becomes a
response-only publication and never creates an empty commit.

Code and responses are tracked independently. Each included response has its
own durable pending/posted/failed/unknown record and remote ID when known.
Restart and network recovery reconcile the existing intent before retrying.
If code is already pushed but responses remain unresolved, the bundle becomes
`PUBLISHED_WITH_ERRORS`; code is never published a second time merely to retry
responses. The per-PR review hold is released only after the publication
outcome is durably recorded.

## User Stories

### Review and approve the exact publication candidate

- **US-01:** **GIVEN** a final `READY_FOR_REVIEW` Review Bundle has no blocking reason, **WHEN** the developer opens its publication surface, **THEN** they see the complete proposed-worktree diff, three SHA identities, target repository/ref, commit message, validation evidence, and every proposed response before any side effect.
  - **Acceptance Criteria:** AC-01-AC-03.
- **US-02:** **GIVEN** the candidate includes un-attributed or user-edited changes that remain within the operation worktree, **WHEN** the developer reviews approval, **THEN** the exact current diff and condition are called out and approval applies to that complete diff, not to an unseen or reconstructed patch.
  - **Acceptance Criteria:** AC-04-AC-06, AC-09.
- **US-03:** **GIVEN** the developer approves a candidate, **WHEN** approval is recorded, **THEN** the selected code diff, commit message, response choices, response text, target identities, expected SHAs, and evidence revisions are locked into one publication intent.
  - **Acceptance Criteria:** AC-07-AC-08.

### Publish approved code safely

- **US-04:** **GIVEN** an approved publication intent is current, **WHEN** publication begins, **THEN** PRMonitor stages only the approved complete proposed diff, creates a commit only when the diff is non-empty, and pushes it to the exact PR head branch without force.
  - **Acceptance Criteria:** AC-09-AC-14.
- **US-05:** **GIVEN** the remote head, PR state, target ref, worktree, or candidate changed, **WHEN** the preflight runs, **THEN** publication stops before the first side effect and explains what must be re-evaluated.
  - **Acceptance Criteria:** AC-04-AC-06, AC-12.

### Publish selected responses

- **US-06:** **GIVEN** proposed responses exist, **WHEN** the developer reviews the publication candidate, **THEN** each response is visibly included or excluded, editable before approval, bound to its exact GitHub target, and posted only when its inclusion decision is part of the approved intent.
  - **Acceptance Criteria:** AC-01-AC-03, AC-15-AC-17.
- **US-07:** **GIVEN** code publication succeeds or no code change is required, **WHEN** selected responses are posted, **THEN** each result records its remote ID or a truthful failure/unknown outcome and an excluded response is never sent.
  - **Acceptance Criteria:** AC-15-AC-19.

### Recover without duplicates

- **US-08:** **GIVEN** the window closes, the process restarts, or a network result is uncertain, **WHEN** PRMonitor resumes, **THEN** it reconciles the existing publication identity and known remote effects before retrying and never creates a duplicate commit, push, or already-posted response.
  - **Acceptance Criteria:** AC-08, AC-13-AC-18, AC-20-AC-22.
- **US-09:** **GIVEN** code is remote but one or more selected responses are not reconciled, **WHEN** the publication record is finalized, **THEN** the bundle is `PUBLISHED_WITH_ERRORS`, the code is not republished, and the developer can retry only the safely retryable response work.
  - **Acceptance Criteria:** AC-18-AC-22.

### Preserve holds, history, and safe boundaries

- **US-10:** **GIVEN** publication reaches `PUBLISHED` or `PUBLISHED_WITH_ERRORS`, **WHEN** the outcome is committed, **THEN** handled event-version history remains intact, retained feedback is not lost, and the per-PR hold is released exactly once.
  - **Acceptance Criteria:** AC-20-AC-22.
- **US-11:** **GIVEN** a renderer request, provider output, or response draft is malformed, stale, over-limit, or unauthorized, **WHEN** F23 evaluates it, **THEN** it fails closed without exposing credentials or creating an external effect.
  - **Acceptance Criteria:** AC-02, AC-05-AC-08, AC-21-AC-22.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** a final Review Bundle is eligible for publication, **WHEN** the developer opens the publication review, **THEN** the surface shows the exact proposed-worktree diff relative to `worktreeBaselineSha`, `prBaseSha`, `prHeadSha`, target head repository/ref, worktree path, validation results, commit message, and every proposed response with its target and inclusion state; opening the surface starts no external effect.
- **AC-02:** **GIVEN** a bundle is in proposal review, is not `FINAL_REVIEW`, has incomplete human decisions/answers, or has a blocking `NEEDS_ATTENTION`/stale reason, **WHEN** the developer requests publication, **THEN** F23 refuses it with a typed reason and permitted next action and creates no publication intent or side effect.
- **AC-03:** **GIVEN** a developer changes a commit message, response draft, inclusion choice, or other publication input before approval, **WHEN** the approval is submitted, **THEN** F23 requires the current bundle/item/evidence revision and records the complete latest candidate; a stale request cannot approve an earlier candidate.
- **AC-04:** **GIVEN** a publication request has a fresh candidate, **WHEN** preflight runs, **THEN** F23 fetches the explicit target remote, verifies the PR is still open and not merged, verifies the exact head repository/ref and current `prHeadSha`, compares it with the recorded SHA, refreshes F13 `WorktreeCondition`, verifies current HEAD and `worktreeBaselineSha`, and regenerates the complete proposed-worktree diff.
- **AC-05:** **GIVEN** preflight finds a changed head/ref/repository/PR state, missing or stale worktree, `MIXED_OR_OVERLAP` or `STALE_OR_UNKNOWN` condition, changed candidate hash, unavailable evidence, or a blocking validation result, **WHEN** F23 evaluates the request, **THEN** it persists a publication-blocking reason before any side effect, preserves the bundle/worktree/evidence, and exposes re-evaluate, inspect, or retry guidance without guessing.
- **AC-06:** **GIVEN** F13 reports `UNATTRIBUTED_CHANGES` or other non-clean but publishable evidence within the owned worktree, **WHEN** the developer reviews the candidate, **THEN** F23 requires an explicit acknowledgement that the complete freshly shown diff will be published; it never silently includes or removes user/build/test changes and still blocks conditions F13 marks unsafe.
- **AC-07:** **GIVEN** preflight passes and the developer explicitly approves the complete code candidate plus the selected response intents, **WHEN** F23 creates the publication record, **THEN** it durably stores the approval reference, actor/time, bundle/evidence revisions, expected repository/ref/SHAs, worktree condition/fingerprint, candidate diff hash and manifest, commit message, response selections/text hashes, stable publication idempotency key, and correlation identity before any commit, push, or response request.
- **AC-08:** **GIVEN** the same approval command or publication intent is replayed, or another publication is already active for the same bundle revision, **WHEN** F23 evaluates it, **THEN** it returns the existing publication/lock result or a typed conflict; it does not create a second publication key, commit intent, response-effect row, or external effect.
- **AC-09:** **GIVEN** an approved candidate has an empty proposed-worktree diff, **WHEN** publication executes, **THEN** F23 records `NO_CODE_CHANGE`, creates no empty commit, performs no push, and proceeds only with the selected response plan.
- **AC-10:** **GIVEN** an approved candidate has a non-empty current diff, **WHEN** code publication executes, **THEN** F23 stages only the recorded complete candidate relative to `worktreeBaselineSha`, rechecks the staged tree/hash, creates one commit with the approved bounded message, records its local commit SHA, and excludes unrelated or ignored files.
- **AC-11:** **GIVEN** a commit is ready to publish, **WHEN** F23 pushes it, **THEN** the push targets the recorded head repository and `prHeadBranch`, uses a non-force operation, requires the remote ref to still equal the expected old SHA, and verifies/records the resulting remote commit SHA; it never substitutes the base/default branch or a same-named ref.
- **AC-12:** **GIVEN** the PR is closed/merged, the target ref moved, the non-force push is rejected, or a final state check cannot prove the expected identity, **WHEN** code publication would begin, **THEN** F23 does not force, rebase, refresh, or guess; it records stale/attention evidence and leaves pending responses unposted unless an already-pushed commit has been reconciled.
- **AC-13:** **GIVEN** process termination or a local Git error occurs around commit creation, **WHEN** F23 reconciles the worktree and publication record, **THEN** it adopts a proven matching commit or retries the same intent only when no matching commit exists; an uncertain local outcome never creates a second commit blindly.
- **AC-14:** **GIVEN** a push request may have reached the remote before its result was lost, **WHEN** F23 recovers, **THEN** it re-fetches the exact target ref and marks the existing commit `PUSHED` when the remote equals the recorded candidate commit, retries the same non-force push only when the remote still equals the expected old SHA, and otherwise stops as unknown/stale without force pushing.
- **AC-15:** **GIVEN** the publication plan contains proposed responses, **WHEN** the developer approves it, **THEN** each response has an explicit `included` or `excluded` decision, bounded editable body, exact response target, draft revision/content hash, and independent publication identity; excluded responses remain historical and have no pending remote effect.
- **AC-16:** **GIVEN** code is pushed or `NO_CODE_CHANGE` is recorded, **WHEN** F23 starts response publication, **THEN** it posts only included responses through F06's typed response operation, in deterministic order, with a persisted `PENDING` record created before each request and no AI, renderer, or raw credential crossing the boundary.
- **AC-17:** **GIVEN** a response request succeeds, **WHEN** F06 validates the result, **THEN** F23 records the exact remote response ID and safe metadata once, marks that response `POSTED`, and treats a replay of the same response-effect identity as an idempotent read of the existing result.
- **AC-18:** **GIVEN** a response request times out or returns an uncertain outcome, **WHEN** F23 reconciles it, **THEN** it re-fetches the exact target scope and adopts a unique matching remote response only when deterministic evidence proves it; it never blind-reposts an unknown response, and it marks unresolved ambiguity `UNKNOWN` with an explicit developer action.
- **AC-19:** **GIVEN** a response is confirmed failed before its side effect or confirmed not posted, **WHEN** the developer chooses **Retry response**, **THEN** F23 reuses the original response/publication identity, revalidates the target, and retries only that response; it never republishes code.
- **AC-20:** **GIVEN** all included responses are posted or safely excluded and any code effect is reconciled, **WHEN** F23 finalizes the outcome, **THEN** it marks the bundle `PUBLISHED`, records `COMPLETED`, preserves all response/history records, marks the handled event versions through F11, releases the per-PR hold once, and returns the PR to `WATCHING`.
- **AC-21:** **GIVEN** code is pushed or no code was needed but one or more included responses remain failed or unknown, **WHEN** F23 finalizes the durable outcome, **THEN** it marks the bundle `PUBLISHED_WITH_ERRORS`, records the known commit/no-code result and every response state, releases the hold once, and exposes response-only retry/reconciliation without authorizing a second code publication.
- **AC-22:** **GIVEN** the renderer closes, the application restarts, or the machine sleeps between any durable publication phase, **WHEN** startup or a later user action loads the record, **THEN** the same approval, idempotency key, phase, expected SHAs, candidate hash, known commit SHA, per-response IDs/states, hold outcome, and recovery reason are available; no external effect is repeated solely because local state was previously `PENDING`.
- **AC-23:** **GIVEN** a publication fails before any external effect, is cancelled before side effects, or is blocked by stale evidence, **WHEN** F23 records the outcome, **THEN** the bundle remains inspectable and non-published, the hold is not released as if publication succeeded, and the user receives a safe retry, re-evaluate, or discard action.
- **AC-24:** **GIVEN** a publication command, response body, commit message, target, path, or diagnostic is malformed, over-limit, arbitrary, or secret-bearing, **WHEN** it crosses the F23 boundary, **THEN** F23 rejects it before persistence/effect, returns bounded safe reason data, and never stores or exposes credentials, SDK objects, authorization headers, arbitrary commands, or uncontrolled environment values.
- **AC-25:** **GIVEN** the publication review is used with keyboard navigation, a screen reader, forced colors/high contrast, reduced motion, zoom, or a narrow window, **WHEN** the developer inspects and confirms code/response publication, **THEN** the complete-diff authority, stale/attention reason, included/excluded response state, destructive consequences, focus order, and next action remain understandable without color, hover, animation, or horizontal overflow.

## Functional Requirements

### FR-01: Publication candidate and explicit human approval

- FR-01.1: F23 SHALL accept publication only from a committed `FINAL_REVIEW` Review Bundle whose owning workflow reports a publication-permitted action and no unresolved blocking reason.
- FR-01.2: F23 SHALL present the complete current proposed-worktree diff relative to `worktreeBaselineSha`, the separate `prBaseSha`/`prHeadSha`, exact head repository/ref, worktree condition, validation evidence, and bounded commit message before approval.
- FR-01.3: F23 SHALL treat approval as approval of one complete candidate diff; it SHALL not provide per-hunk acceptance, silent patch reconstruction, or approval based on a contextual PR diff.
- FR-01.4: F23 SHALL expose every proposed response with its exact target, bounded body, draft revision/content hash, and explicit included/excluded publication decision.
- FR-01.5: F23 SHALL require the current bundle, item, response-draft, diff, worktree-condition, and action-gate revisions when approval is submitted and SHALL reject stale approval requests.
- FR-01.6: F23 SHALL persist the actor, approval time, candidate evidence references, commit message, response choices, and a stable idempotency identity as one approval snapshot.
- FR-01.7: F23 SHALL lock the approved candidate against silent edits; changing any approval input SHALL require a new revision and explicit approval before side effects.
- FR-01.8: F23 SHALL make the publication surface and action semantics accessible through typed labels, required confirmations, focus behavior, and bounded text without color-only meaning.

### FR-02: Fresh preflight and exact publication target

- FR-02.1: Before creating a publication intent or starting an external effect, F23 SHALL obtain a fresh server-scoped PR/ref result through F06 and SHALL verify the PR is open, not merged, and still identifies the recorded head repository, head branch, and expected `prHeadSha`.
- FR-02.2: F23 SHALL obtain a fresh F13 `WorktreeCondition`, current HEAD, `worktreeBaselineSha`, and complete proposed-worktree diff; it SHALL verify the candidate hash and file manifest against the approved snapshot.
- FR-02.3: F23 SHALL treat `MIXED_OR_OVERLAP`, `STALE_OR_UNKNOWN`, missing worktree, unknown Git state, changed baseline, changed candidate, unavailable identity, or stale F22 gate as publication-blocking.
- FR-02.4: F23 SHALL describe `UNATTRIBUTED_CHANGES` as un-attributed evidence and SHALL require explicit approval of the complete freshly inspected diff before including it; it SHALL never infer manual ownership or silently discard such changes.
- FR-02.5: F23 SHALL consume configured F14 validation truth; a required missing, failed, interrupted, stale, or contradictory validation result SHALL block publication, while a model claim SHALL never create a pass.
- FR-02.6: F23 SHALL revalidate the exact destination repository/ref and expected old SHA immediately before code staging/push and SHALL never substitute the repository default branch, PR base branch, or a same-named ref.
- FR-02.7: F23 SHALL persist a bounded publication-block reason with what happened, why it matters, preserved evidence, and permitted next action before returning a refusal.
- FR-02.8: F23 SHALL never automatically rebase, refresh a stale snapshot, resolve a dirty worktree, force push, or continue after an uncertain preflight.

### FR-03: Durable approval, publication intent, and phase state

- FR-03.1: F23 SHALL persist a publication intent after explicit approval and before any commit, push, or response request, including bundle identity/revision, approval reference, expected identities/SHAs, candidate evidence, response plan, and correlation identity.
- FR-03.2: Every publication intent SHALL have a stable scoped idempotency key and a unique publication lock; an equal replay SHALL return the existing record and a competing active publication SHALL receive a typed conflict.
- FR-03.3: The publication domain phase SHALL use F02's `APPROVAL_REQUIRED`, `PREPARING`, `COMMITTING`, `PUSHING`, `POSTING_RESPONSES`, `RECOVERING`, `PUBLISHED`, `PUBLISHED_WITH_ERRORS`, `DISCARDED`, and `FAILED` vocabulary where applicable.
- FR-03.4: The persisted effect progress SHALL distinguish `PENDING`, `COMMIT_CREATED`, `NO_CODE_CHANGE`, `PUSHED`, `RESPONSES_PENDING`, `COMPLETED`, `FAILED`, and `UNKNOWN` without replacing the F02 domain phase.
- FR-03.5: Phase/effect transitions SHALL be append-only, revision-checked, and committed before the represented external effect; a cancellation or renderer close after commit SHALL not erase the intent.
- FR-03.6: F23 SHALL persist exact candidate, expected-ref, worktree, approval, response-plan, and validation snapshots rather than consulting mutable renderer/provider state during recovery.
- FR-03.7: F23 SHALL keep Review Bundle publication records independent from synchronization publication records and independent per-response effect records.
- FR-03.8: F23 SHALL expose the publication lock, phase, effect progress, reason, and permitted next action as a bounded main-process read model that remains valid after restart.

### FR-04: Exact code staging, commit, and non-force push

- FR-04.1: F23 SHALL stage only the approved complete proposed diff relative to `worktreeBaselineSha` after a fresh equality check; unrelated or ignored files SHALL not enter the commit.
- FR-04.2: If the approved proposed diff is empty, F23 SHALL record `NO_CODE_CHANGE` and SHALL not create an empty commit or push.
- FR-04.3: If the approved proposed diff is non-empty, F23 SHALL create exactly one commit using the approved bounded commit message and SHALL persist/prove its local commit SHA before moving to push.
- FR-04.4: F23 SHALL push only the recorded commit to the exact PR head repository and `prHeadBranch`, with a non-force operation whose expected old SHA is the recorded `prHeadSha`.
- FR-04.5: F23 SHALL verify the remote destination ref after push and SHALL record the resulting remote commit SHA or a safe failure/unknown outcome.
- FR-04.6: A local commit or push uncertainty SHALL be reconciled from actual Git/worktree/remote state before any retry; a known commit or push SHALL be adopted rather than recreated.
- FR-04.7: A stale/non-fast-forward/closed/merged/inaccessible target SHALL stop code publication without force push, automatic rebase, target substitution, or response posting that assumes code succeeded.
- FR-04.8: F23 SHALL preserve the approved worktree and evidence on code failure or cancellation and SHALL not use the developer's normal clone.

### FR-05: Selected response plan and response effects

- FR-05.1: F23 SHALL persist one response intent for every proposed response, including target identity, included/excluded decision, bounded body/content hash, draft revision, publication identity, and ordering.
- FR-05.2: Excluded responses SHALL remain in Review Bundle history with no pending remote effect and SHALL not be silently re-included by retry or restart.
- FR-05.3: F23 SHALL start response publication only after code is `PUSHED`/verified or `NO_CODE_CHANGE` is durable, and SHALL post only included responses through F06's typed response boundary.
- FR-05.4: Before each response request, F23 SHALL persist its `PENDING` effect record and SHALL verify the response target and current bundle/publication revision.
- FR-05.5: A confirmed response success SHALL persist the validated remote response ID and safe metadata exactly once and SHALL transition that response to `POSTED`.
- FR-05.6: A confirmed pre-effect failure or confirmed-not-posted outcome SHALL be retryable only through an explicit response-only action using the original response/publication identity.
- FR-05.7: An uncertain response outcome SHALL be reconciled by a fresh exact-target read and unique matching evidence when possible; absent proof, F23 SHALL retain `UNKNOWN` and SHALL not blind-repost.
- FR-05.8: Response retries SHALL never re-stage, recommit, repush, or otherwise republish code.
- FR-05.9: F23 SHALL support the two F06 response target kinds required by the MVP: issue-comment response and pull-request review-comment reply, without exposing arbitrary GitHub endpoints.

### FR-06: Failure, restart, and uncertain-outcome reconciliation

- FR-06.1: F23 SHALL reconcile publication intents on startup and after renderer replacement without requiring the renderer, an AI provider thread, or an in-memory lock.
- FR-06.2: Recovery SHALL use the original publication and per-response idempotency keys, expected identities, candidate hash, known commit SHA, remote ref, and remote response IDs; it SHALL not create a fresh identity merely because a result was lost.
- FR-06.3: A possible local commit SHALL be classified by actual worktree/commit evidence as adopted, absent-and-retryable, or unknown; unknown evidence SHALL require attention.
- FR-06.4: A possible push SHALL be classified by exact remote-ref evidence as adopted, absent-but-safe-to-retry, or unknown/stale; unknown/stale evidence SHALL never be force-pushed.
- FR-06.5: A possible response post SHALL be classified as uniquely reconciled, confirmed not posted, confirmed failed, or unknown; only uniquely reconciled or confirmed-not-posted/failed responses may leave recovery automatically.
- FR-06.6: If code is reconciled but one or more included responses remain failed or unknown, F23 SHALL reach `PUBLISHED_WITH_ERRORS` and SHALL prohibit a second code-publication effect.
- FR-06.7: A failure before any external effect SHALL remain distinct from an uncertain effect and SHALL preserve a safe explicit retry/re-evaluate/discard action.
- FR-06.8: Cancellation SHALL stop before the next side effect when safe; after an effect may have started, cancellation SHALL produce a recovery/attention result rather than claiming that the effect did not happen.

### FR-07: Bundle outcome, handled history, and hold handoff

- FR-07.1: A fully reconciled publication SHALL mark the Review Bundle `PUBLISHED`; code/no-code and every selected response outcome SHALL be durably recorded before the terminal transition.
- FR-07.2: A code-published/no-code result with unresolved selected responses SHALL mark the Review Bundle `PUBLISHED_WITH_ERRORS`; the known code outcome and every response state SHALL remain inspectable.
- FR-07.3: F23 SHALL ask F11 to finalize handled event-version associations and release the per-PR hold only after `PUBLISHED` or `PUBLISHED_WITH_ERRORS` is durably committed.
- FR-07.4: Hold release SHALL be idempotent and shall return the PR to `WATCHING` only through the legal F02/F11 outcome; navigation, restart, polling, or approval alone SHALL not release it.
- FR-07.5: New feedback observed during publication/hold SHALL remain separately retained and shall not be merged into the published bundle or lost when the hold releases.
- FR-07.6: Historical bundle, approval, diff, worktree, commit, response, and reason records SHALL remain inspectable after publication; F23 SHALL not delete or rewrite the reviewed history.

### FR-08: Trust boundary, diagnostics, and downstream read model

- FR-08.1: F23 SHALL run in the Electron main process and SHALL expose publication commands/results only through validated provider-neutral IPC/read-model contracts.
- FR-08.2: F23 SHALL not import or invoke an AI provider, expose publication authority to AI, or accept model prose as approval, Git, validation, or remote-effect truth.
- FR-08.3: Credentials SHALL remain behind F05/F06/Git credential infrastructure and SHALL not enter F23 persistence, prompts, structured AI output, renderer state, activity, or diagnostics.
- FR-08.4: F23 SHALL use typed F02/F03/F06/F11/F13/F14/F18/F20/F21/F22 ports and SHALL not parse activity logs, raw GitHub payloads, arbitrary Git commands, arbitrary paths, or provider SDK objects as authoritative input.
- FR-08.5: Every refusal, failure, uncertain outcome, recovery, and terminal result SHALL include bounded machine-readable what/why/next reason data and safe correlated activity.
- FR-08.6: F23 SHALL expose distinct code outcome, response outcome, publication phase, hold outcome, stale/condition gate, known IDs, and permitted actions so downstream UI does not infer state from one label.

## Non-Functional Requirements

- **NFR-01: Determinism** - Given the same committed approval snapshot, remote/worktree observations, typed dependency outcomes, and injected clock, F23 SHALL produce the same preflight, phase, effect, reason, and hold decision without AI judgment.
- **NFR-02: Durability and restart safety** - Approval, publication lock, intent, snapshots, phase history, known commit SHA, remote ref evidence, response states/IDs, reasons, and hold outcomes SHALL survive renderer closure and ordinary process restart.
- **NFR-03: Idempotency and concurrency** - Duplicate approval, command, restart recovery, commit/push/response results, and competing publication requests SHALL not create duplicate publication intents, commits, pushes, response-effect rows, or terminal outcomes.
- **NFR-04: Exactness and preservation** - The published code SHALL be exactly the freshly revalidated complete approved proposed diff relative to `worktreeBaselineSha`; manual/un-attributed changes are never silently included, removed, or reconstructed, and the developer clone remains untouched.
- **NFR-05: No-force and no-autonomy** - No F23 path SHALL force-push, automatically rebase, publish from stale evidence, or grant an AI provider commit/push/response authority.
- **NFR-06: Security and data minimization** - Publication records, IPC, activity, and error projections SHALL be provider-neutral, bounded, redacted, and free of credentials, SDK objects, arbitrary commands/paths, and uncontrolled environment data.
- **NFR-07: Main-process and Windows behavior** - Publication and recovery SHALL continue without a renderer and use the existing Windows-safe Git, credential, IPC, and shell adapters.
- **NFR-08: Accessibility and explainability** - Approval, response inclusion, stale/attention, failure, recovery, and retry states SHALL remain understandable and operable with keyboard navigation, screen readers, forced colors/high contrast, reduced motion, zoom, and narrow windows.
- **NFR-09: Testability** - Git, GitHub, persistence, validation, clock, cancellation, filesystem, renderer, and fault outcomes SHALL be injectable so the complete contract runs without live credentials or external publication.

## Invariants

- **INV-01:** Deterministic application code owns approval gating, preflight, staging, commit, push, response sequencing, retries, reconciliation, hold release, and publication state; AI is never publication authority.
- **INV-02:** Per-item accept/override decisions and implementation completion are not publication approval; F23 requires a separate explicit approval of the complete final candidate.
- **INV-03:** Publication intent and every mutable input snapshot are durably committed before the represented commit, push, or response effect.
- **INV-04:** Exact server/repository/PR/ref identity, expected SHAs, worktree baseline, current condition, and candidate diff hash must be freshly verified before code staging/push; stale or unknown evidence cannot publish.
- **INV-05:** The proposed-worktree diff relative to `worktreeBaselineSha` is the only code candidate; contextual and relevant diffs cannot authorize publication.
- **INV-06:** F23 never performs per-hunk acceptance, blind patch reconstruction, automatic rebase, force push, or silent cleanup of the operation worktree.
- **INV-07:** A known local commit, remote commit, or response remote ID is retained and reused for reconciliation; a retry never replaces known external identity with a new one.
- **INV-08:** The per-PR hold releases only after a durable `PUBLISHED` or `PUBLISHED_WITH_ERRORS` outcome and one successful F11 handoff; renderer closure, restart, polling, or approval does not release it.
- **INV-09:** `PUBLISHED_WITH_ERRORS` means code/no-code publication is reconciled while one or more selected responses remain unresolved; it forbids a second code-publication effect.
- **INV-10:** Excluded responses remain in immutable bundle history and have no remote publication intent; retries cannot silently re-include them.
- **INV-11:** Credentials, raw authorization headers, provider SDK objects, arbitrary commands/paths, uncontrolled environment values, and raw remote payloads never cross the F23 persistence, IPC, activity, or AI boundary.
- **INV-12:** A failure or uncertainty is never represented as success solely because a Git command started, a network request returned, a model claimed completion, or a renderer displayed a success state.

## Out of Scope

- Review proposal generation, per-item recommendation decisions, implementation turns, AI conversation, validation command discovery, and worktree mutation owned by F14-F21.
- Stale detection, dirty-worktree cleanup choices, discard, and re-evaluation owned by F22; F23 consumes their gates and performs its own final recheck.
- Branch synchronization source resolution, merges, conflict resolution, and synchronization-result publication owned by F24-F27.
- GitHub review approval, conversation resolution, issue closing, automatic branch synchronization, automatic rebasing, force push, webhook delivery, or autonomous publication.
- Per-hunk code acceptance, partial patch reconstruction, publishing the contextual PR diff, or silently deciding whether user edits are safe.
- Response bodies or commit messages exceeding published bounds, arbitrary endpoints, arbitrary shell/Git commands, arbitrary filesystem paths, or raw credentials.
- Automatic retry of an unknown response outcome when deterministic remote evidence cannot prove that the response was not posted.

## Product Decisions

- **PD-01 (Pending product approval): Per-response inclusion** - This draft assumes the recommended application-overview option: each proposed response has an explicit **Include response** decision. An excluded response remains in history and is not posted. If the product chooses all-or-none response approval instead, FR-01/FR-05, AC-01, AC-15-AC-19, and the PLAN's approval slice must be revised before implementation.
- **PD-02: One complete code candidate** - Publication approves the complete current proposed-worktree diff relative to `worktreeBaselineSha`; the MVP does not reconstruct or accept individual hunks.
- **PD-03: Code first, responses second** - Code is committed/pushed and verified before selected responses are posted; response-only publication is allowed when the approved code diff is empty.
- **PD-04: No empty commit** - An empty approved code diff records `NO_CODE_CHANGE` and never creates or pushes an empty commit.
- **PD-05: Staleness is a hard publication boundary** - A moved head/ref, changed PR state, changed candidate, or unsafe worktree condition requires re-evaluation or another explicit workflow; F23 never refreshes the reviewed candidate silently.
- **PD-06: Unknown effects are reconciled, not guessed** - An uncertain commit, push, or response result is inspected using the same durable identity. If it cannot be proven, the result remains attention/unknown rather than risking a duplicate.
- **PD-07: Partial response failure is independently recoverable** - Once code is reconciled, response retries operate per response and never repeat code publication.
- **PD-08: Hold release follows durable outcome** - `PUBLISHED` and `PUBLISHED_WITH_ERRORS` release the automatic review hold only after history, effect states, and the outcome are committed.
- **PD-09: Commit-message editing is part of approval** - A generated bounded message is shown and editable before approval; changing it after approval requires a new approval revision.

## Implementation Decisions

- **IMP-01: Separate publication candidate, intent, effect ledger, and read model** - The candidate is an immutable approved snapshot; the intent is the durable operation; effect rows track code and each response independently; the read model projects phase, reasons, known IDs, and permitted actions.
- **IMP-02: Reuse F02 publication vocabulary and add progress subphases** - F02 owns domain phases. F23 stores the application-overview progress distinctions (`PENDING`, `COMMIT_CREATED`, `NO_CODE_CHANGE`, `PUSHED`, `RESPONSES_PENDING`, `COMPLETED`, `FAILED`, `UNKNOWN`) as effect progress without creating a competing state machine.
- **IMP-03: Use a persisted publication lock and compare-and-swap revisions** - The lock is acquired in the same transaction as approval/intent creation; duplicate or stale commands return a typed existing/conflict result.
- **IMP-04: Use a narrow deterministic Git publication port** - F23 receives a canonical F13 worktree handle and exact candidate identity, then invokes allowlisted stage/commit/push operations. No caller supplies an arbitrary path, ref, command, or force option.
- **IMP-05: Revalidate candidate equality immediately before staging** - F23 compares current F13 diff manifest/hash and condition revision with the approval snapshot; a mismatch invalidates approval and requires a fresh review.
- **IMP-06: Reconcile local commit and push by exact identity** - Local recovery compares parent/baseline, tree/diff hash, target branch, and approved message evidence. Push recovery compares the exact remote ref with expected old SHA and recorded commit SHA; ambiguous evidence blocks.
- **IMP-07: Use per-response ledgers and fail-closed matching** - F23 persists one effect row per included response and adopts an uncertain post only when a unique exact-target/response match is proven. No match or multiple matches remains `UNKNOWN`.
- **IMP-08: Keep F06 mutation narrow** - F06 remains the only GitHub response transport. It receives a typed target/body/publication context from F23 and returns confirmed or uncertain safe outcomes; it owns no approval, retry, or idempotency policy.
- **IMP-09: Keep response retry code-free** - A response-only retry can touch only response rows whose prior outcome is confirmed failed/not-posted or uniquely reconciled as needed; it cannot call the code staging/commit/push port.
- **IMP-10: Publish bounded downstream projections** - F20 receives a versioned approval/result projection, F19/F28 receive outcome/recovery targets, and F11 receives an explicit terminal handoff; no consumer parses activity text for publication state.

## Testing Decisions

- **TST-01: Deep-test approval and exact candidate gates** - Cover stage/state/action revisions, three-SHA identity, complete proposed diff, response selection, commit-message edits, un-attributed changes, stale requests, and no side effects while reviewing.
- **TST-02: Deep-test deterministic Git publication** - Use temporary repositories to prove empty/no-code, added/deleted/renamed/binary/untracked changes, exact staging, one commit, target-repository/ref selection, non-force push, remote verification, and developer-clone preservation.
- **TST-03: Fault-test every durable boundary** - Inject persistence, cancellation, renderer closure, process termination, Git, network, and response failures before/after preflight, intent, commit, push, and each response effect.
- **TST-04: Deep-test uncertain-outcome reconciliation** - Cover adoption of known local/remote effects, absent-and-safe retry, stale/unknown remote ref, unique response match, no match, duplicate matches, and the no-blind-repost/no-republish guarantees.
- **TST-05: Deep-test partial publication** - Verify `PUBLISHED_WITH_ERRORS`, hold release, handled associations, response-only retry, and preservation of the pushed commit when responses fail.
- **TST-06: Defer final layout fidelity to F20** - F23 tests the typed approval/action/result contract and accessibility semantics; F20 owns visual workspace layout, diff rendering, focus, and response controls.
- **TST-07: Prove security and no-authority boundaries** - Scan imports, capabilities, serialized records, diagnostics, IPC, provider context, Git arguments, and test fixtures for credentials, SDK objects, arbitrary paths/commands, force options, and AI/publication coupling.

## Proposed Modules

- **MOD-01: Publication Candidate Projector** - Builds the bounded final candidate from the committed F18/F20/F13 evidence and response drafts.
- **MOD-02: Human Approval and Revision Gate** - Validates explicit approval, current revisions, complete-diff acknowledgement, response inclusion, commit message, and publication lock.
- **MOD-03: Fresh Publication Preflight** - Revalidates F06 PR/ref state, F13 worktree condition/diff, F14 validation, F22 stale gate, and exact target identity.
- **MOD-04: Publication Intent Repository Adapter** - Persists approval, idempotency key, effect ledger, phase history, snapshots, lock, reasons, and recovery markers through F03.
- **MOD-05: Deterministic Code Publisher** - Stages the exact candidate, creates/adopts one commit, performs a non-force push, and verifies the remote ref.
- **MOD-06: Response Plan and Effect Ledger** - Persists included/excluded decisions and per-response pending/posted/failed/unknown outcomes.
- **MOD-07: Response Reconciliation Coordinator** - Re-fetches exact response targets, adopts unique matches, and blocks ambiguous retries.
- **MOD-08: Bundle Outcome and Hold Handoff** - Maps publication completion to F02/F18/F11 outcome transitions and idempotent hold release.
- **MOD-09: Recovery Coordinator** - Reconciles intents and external effects on startup, renderer replacement, network restoration, and explicit response-only retry.
- **MOD-10: Publication Read Model and Capability Adapter** - Exposes bounded phase/effect/reason/action data to F20/F19/F28 without granting them publication authority.

## Workflows

### Workflow 1: Approve an exact final candidate

```text
1. F20 opens a committed FINAL_REVIEW bundle and requests a publication candidate.
2. F23 loads the proposed-worktree diff, three SHAs, F13 condition, validation,
   commit message, response drafts, and current action-gate revisions.
3. The developer inspects the complete diff, acknowledges any un-attributed
   changes, edits the bounded commit message/responses, and includes or excludes
   each response according to the approved product decision.
4. F23 validates the current revisions and obtains a fresh F06/F13/F14 preflight.
5. The developer confirms publication of the complete candidate and selected
   responses.
6. F23 atomically persists approval, publication lock, intent, snapshots, and
   per-response pending/excluded records before any effect.
```

### Workflow 2: Publish code or record no-code

```text
1. F23 revalidates target PR/ref state, worktree condition, baseline, and diff.
2. If the approved candidate is empty, F23 commits NO_CODE_CHANGE and skips Git
   commit/push. Otherwise it stages the exact candidate and records COMMITTING.
3. F23 adopts or creates exactly one local commit and records its SHA.
4. F23 records PUSHING, performs one non-force push to the exact head repository
   and branch, and verifies the remote SHA.
5. A stale, rejected, failed, or uncertain operation enters a truthful recovery
   or attention state; it never force-pushes or silently refreshes the target.
```

### Workflow 3: Post selected responses

```text
1. After PUSHED or NO_CODE_CHANGE is durable, F23 loads included response rows
   in deterministic order; excluded rows remain historical and are skipped.
2. Before each request, F23 records PENDING with the original response identity.
3. F23 calls F06 for the exact issue-comment or review-comment target.
4. A confirmed response ID becomes POSTED. A confirmed failure is retryable only
   through an explicit response-only command; an uncertain outcome is reconciled
   by exact-target matching and remains UNKNOWN if it cannot be proven.
5. F23 records COMPLETED/PUBLISHED when every included response is reconciled,
   or PUBLISHED_WITH_ERRORS when code is reconciled but a response remains failed
   or unknown.
```

### Workflow 4: Recover an interrupted publication

```text
1. Startup loads publication intents in PENDING, COMMIT_CREATED, PUSHED,
   RESPONSES_PENDING, RECOVERING, FAILED, or UNKNOWN progress.
2. F23 uses the existing idempotency key and exact candidate/target identities to
   inspect local HEAD, worktree state, the remote ref, PR state, and response data.
3. A proven effect is adopted; a proven absent effect may reuse the same intent;
   ambiguous evidence remains attention/unknown and is never blind-retried.
4. If code is known remote, only unresolved response rows may continue. The code
   publisher remains disabled for response-only recovery.
5. Once the durable terminal outcome is committed, F23 performs the idempotent
   F11 handled/hold handoff and exposes the final reason/next action.
```

## Contract-Test Criteria

- **CT-F23-01:** Candidate/approval fixtures cover final-stage/state gating, complete proposed-worktree versus contextual diff authority, three SHA identities, worktree conditions, validation truth, bounded commit messages, explicit complete-diff approval, response inclusion, revision races, stale renderer requests, and zero external effects before approval.
- **CT-F23-02:** Preflight fixtures cover open/closed/merged PRs, base/head/fork repository identities, exact head refs/SHAs, stale F22 gates, F13 `CLEAN`/`AI_ATTRIBUTED_ONLY`/`UNATTRIBUTED_CHANGES`/`MIXED_OR_OVERLAP`/`STALE_OR_UNKNOWN`, changed candidates, missing worktrees, validation failure/interruption, and no-effect refusal.
- **CT-F23-03:** Intent/lock/persistence fixtures cover persist-before-effect, stable-key uniqueness, duplicate commands, competing publication, approval-input lock, phase/effect projection, append-only history, renderer closure, restart, and optimistic-concurrency conflicts.
- **CT-F23-04:** Code-publication fixtures cover empty/no-code, exact staging, unrelated/ignored files, tracked/untracked/rename/delete/binary changes, one commit, local commit adoption, exact target repository/ref, expected-old-SHA non-force push, remote verification, push rejection, and developer-clone protection.
- **CT-F23-05:** Local commit recovery fixtures cover crash before/after commit, matching commit adoption, absent commit retry with the same identity, divergent/ambiguous HEAD, cancellation, Git failure, and no duplicate commit.
- **CT-F23-06:** Push recovery fixtures cover crash/network loss before/after remote acceptance, remote equals expected old SHA, remote equals recorded commit SHA, remote advances differently, ref deletion, closed/merged PR, and no-force/no-rebase behavior.
- **CT-F23-07:** Response-plan fixtures cover issue-comment and review-comment targets, included/excluded rows, edited drafts, deterministic order, bounded content, per-response pending/posted/failed/unknown states, remote IDs, duplicate command replay, and no response from excluded or stale rows.
- **CT-F23-08:** Response-reconciliation fixtures cover confirmed success, confirmed failure/not-posted, unique exact match, no match, multiple matches, timeout, cancellation, rate limit, malformed response, restart, response-only retry, and no blind repost.
- **CT-F23-09:** Partial/terminal fixtures cover code success with response failure, no-code response-only publication, `PUBLISHED`, `PUBLISHED_WITH_ERRORS`, `FAILED`, hold release ordering, handled associations, retained new feedback, history preservation, and no second code publication.
- **CT-F23-10:** Boundary/accessibility fixtures cover keyboard/screen-reader/focus/forced-colors/reduced-motion/zoom/narrow-window semantics, bounded/redacted read models, no credentials/SDK objects/raw payloads/arbitrary commands or paths, no AI/publication capability leakage, and F19/F20/F28 consumer conformance.

## Requirement Traceability

| Requirement family | Observable coverage | Named contract tests |
|---|---|---|
| FR-01 | AC-01-AC-03, AC-06-AC-08, AC-15, AC-25 | CT-F23-01, CT-F23-03, CT-F23-07, CT-F23-10 |
| FR-02 | AC-04-AC-06, AC-12, AC-24-AC-25 | CT-F23-01-CT-F23-02, CT-F23-10 |
| FR-03 | AC-07-AC-08, AC-20-AC-22 | CT-F23-03, CT-F23-09-CT-F23-10 |
| FR-04 | AC-09-AC-14, AC-22-AC-24 | CT-F23-04-CT-F23-06, CT-F23-09 |
| FR-05 | AC-15-AC-19, AC-21-AC-22, AC-24 | CT-F23-07-CT-F23-08, CT-F23-10 |
| FR-06 | AC-08, AC-13-AC-14, AC-18-AC-23 | CT-F23-03, CT-F23-05-CT-F23-09 |
| FR-07 | AC-20-AC-23 | CT-F23-09-CT-F23-10 |
| FR-08 | AC-02, AC-05-AC-08, AC-12, AC-18, AC-22, AC-24-AC-25 | CT-F23-01-CT-F23-03, CT-F23-06, CT-F23-08, CT-F23-10 |
| NFR-01-NFR-09 | AC-01-AC-25 | CT-F23-01-CT-F23-10 |
| INV-01-INV-12 | AC-01-AC-25 | CT-F23-01-CT-F23-10 |
