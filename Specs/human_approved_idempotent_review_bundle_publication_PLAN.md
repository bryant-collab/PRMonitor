<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single level. The goal is to provide the AI and the user with a visible and testable result when the work is complete. Prefer vertical slices, while allowing contract-only slices where the behavior has no direct UI.
-->

# Plan: F23 Human-approved, Idempotent Review Bundle Publication

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** `Specs/human_approved_idempotent_review_bundle_publication_PRD.md`
>
> **Last revalidated against:** `Specs/application_overview.md` revision 2026-09-27, F02/F03/F06/F11/F13/F14/F18/F20/F21/F22 PRDs and PLANs, and checklist revision 2026-09-27
>
> **Entry/readiness gates:** F02 exposes the legal Review Bundle/publication/hold transitions and uncertain-outcome vocabulary. F03 exposes approval, publication-intent, effect-ledger, response-outcome, compare-and-swap, and restart-safe repositories. F06 exposes exact PR/ref reads and typed issue-comment/review-comment response operations. F11 exposes handled-version and hold release/retention handoffs. F13 exposes canonical worktree ownership, fresh `WorktreeCondition`, three-SHA identity, candidate diff, and no-developer-clone guarantees. F14 exposes real validation truth. F18 exposes a committed `FINAL_REVIEW` bundle and response-draft read model. F20 exposes final diff inspection, response editing, accessible approval controls, and typed publication commands. F21 exposes current revision/evidence status. F22 exposes stale and dirty-worktree gates. Test fakes can inject GitHub, Git, persistence, validation, renderer, cancellation, and uncertain network outcomes without credentials or real publication.
>
> **Approval gate:** The current PRD assumes the application overview's recommended per-response **Include response** decision. This remains a pending product decision; if all-or-none response approval is chosen, revise the PRD/PLAN before implementing the response slices.
>
> This PLAN cannot change product requirements. Resolve contradictions in the
> owning PRD before implementation and rerun both specification linters. This
> feature does not check the checklist item; implementation and approval are
> separate.

## Implementation Boundary

F23 owns the main-process Review Bundle publication workflow: final candidate
projection, explicit approval, publication locking, fresh preflight, durable
publication intent, exact proposed-diff staging, deterministic commit and
non-force push, selected response posting, uncertain-outcome reconciliation,
terminal publication outcome, and F11 hold/history handoff.

F02 remains authoritative for legal states and transitions. F03 owns schema,
transactions, uniqueness, and append-only records. F06 owns authenticated
GitHub transport and exact response/ref codecs. F11 owns handled event versions
and legal hold transitions. F13 owns path/worktree/Git inspection and
`WorktreeCondition`; F23 may use a narrow publication port over F13's
canonical worktree handle but does not create a second Git truth source. F14
owns validation truth. F18 owns Review Bundle preparation and finalization. F20
owns final visual layout and accessible diff/response controls. F21 owns
revision work. F22 owns stale detection, discard, re-evaluation, and dirty
worktree choices. F28 owns cross-feature startup/network recovery hardening.

F23 must not import an AI SDK, call an AI provider, infer approval from model
prose, parse activity text, accept arbitrary Git paths/commands, target the
developer clone, force-push, rebase automatically, publish a contextual diff,
resolve conversations, approve a GitHub review, or publish branch
synchronization results.

### Provider-neutral handoff shapes

| Contract | Required meaning |
|---|---|
| `ReviewPublicationCandidate` | Final bundle/revision, complete proposed-worktree diff relative to `worktreeBaselineSha`, three SHA identities, exact head repository/ref, F13 condition/fingerprint, validation summary, bounded commit message, response drafts/targets/inclusion, and evidence revisions. |
| `ReviewPublicationApproval` | Actor/time, candidate hash/manifest, bundle/item/draft/action revisions, complete-diff acknowledgement, un-attributed-change acknowledgement when applicable, commit message, response choices, and approval identity. |
| `ReviewPublicationIntent` | Publication identity, stable idempotency key, lock, approval reference, expected remote/worktree identities, candidate snapshot, response plan, domain phase, effect progress, owner, and correlation identity. |
| `CodePublicationEffect` | Candidate identity, local commit intent/SHA, target repository/ref, expected old SHA, remote SHA, non-force proof, status, and recovery evidence. |
| `ResponsePublicationEffect` | Response identity, exact F06 target, included/excluded decision, body/content hash, draft revision, state, attempt metadata, remote ID when known, and reconciliation evidence. |
| `ReviewPublicationReadModel` | Bounded phase/effect/lock/reason/known-ID/hold projection with separate code, response, stale/condition, and permitted-action fields for F20/F19/F28. |

### Publication phase mapping

F23 consumes the F02 publication domain vocabulary and stores the application
overview's effect progress as a separate field. This avoids creating a second
state machine.

| F02 domain phase | Effect progress examples | Meaning |
|---|---|---|
| `APPROVAL_REQUIRED` | `PENDING` | Candidate is reviewable; no publication intent has been authorized. |
| `PREPARING` | `PENDING` | Approval and exact preflight are being committed/rechecked. |
| `COMMITTING` | `PENDING` or `COMMIT_CREATED` | A non-empty candidate is being staged/committed and local evidence is being reconciled. |
| `PUSHING` | `COMMIT_CREATED` or `PUSHED` | The recorded commit is being pushed and the exact remote ref is being verified. |
| `POSTING_RESPONSES` | `NO_CODE_CHANGE`, `PUSHED`, or `RESPONSES_PENDING` | Code is reconciled; included responses are posted independently. |
| `RECOVERING` | `UNKNOWN` or a recoverable prior progress value | A possible effect requires deterministic reconciliation before retry. |
| `PUBLISHED` | `COMPLETED` | Code/no-code and every included response are reconciled. |
| `PUBLISHED_WITH_ERRORS` | `PUSHED`/`NO_CODE_CHANGE` plus unresolved response rows | Code/no-code is reconciled; response work remains without code republish authority. |
| `FAILED` | `FAILED` | No successful terminal publication was proven; the bundle remains reviewable and held until an allowed outcome. |

## Readiness Gates

- F02's publication reducer accepts explicit approval, rejects publication from proposal/incomplete/stale/attention states, distinguishes `RECOVERING`, `PUBLISHED`, and `PUBLISHED_WITH_ERRORS`, and prevents a second code effect after a partial response outcome.
- F03 can atomically persist approval, publication lock, publication intent, candidate/target snapshots, phase/effect history, per-response rows, and hold handoff references before an effect, with stable-key uniqueness and expected-revision conflicts.
- F06 can read current PR/ref state for the explicit head repository/ref and can send the two typed MVP response operations while returning confirmed versus uncertain mutation outcomes.
- F11 can finalize handled event versions and release the per-PR hold idempotently only after an owning terminal outcome; feedback observed during the hold remains separately retained.
- F13 can return a fresh `WorktreeCondition`, current HEAD, three SHA identities, complete proposed-worktree diff/hash/manifest, and a canonical operation-owned worktree handle; unsafe conditions block publication.
- F14 can expose required validation status and final recheck behavior without allowing provider prose to create a pass.
- F18 exposes a committed final bundle/read model with stable revisions, proposed responses, decisions, validation, and publication-permitted actions.
- F20/F21/F22 expose typed action/revision/stale/condition gates and can render the approval/recovery projection without owning publication effects.
- A deterministic Git publication fake can stage exact candidates, create/adopt a commit, push with an expected old SHA and no force option, and inspect local/remote outcomes without a live remote.
- The product decision in PRD PD-01 is resolved, or the PRD/PLAN is revised and linted for the selected response-inclusion model.

## Proposed Vertical Slices

1. **Final publication candidate, response plan, and explicit approval**
   - **Blocked by:** F18 final Review Bundle read model; F13 proposed-worktree diff/condition; F20 final-review controls; F21 revision contract; the PRD PD-01 response-inclusion decision.
   - **Stories / requirements / acceptance criteria:** US-01-US-03, US-06; FR-01.1-FR-01.8; AC-01-AC-03, AC-06-AC-08, AC-15, AC-25; NFR-01, NFR-04, NFR-08-NFR-09; INV-01-INV-02, INV-05-INV-06, INV-10-INV-12; CT-F23-01, CT-F23-07, CT-F23-10.
   - **Implementation:** Define `ReviewPublicationCandidate`, approval snapshot, response inclusion/draft contract, complete-diff acknowledgement, bounded commit-message edit, current revision checks, and the typed approval command/read model. Add the approval lock as a durable capability, not a renderer flag. Keep response drafts editable until approval and immutable after intent creation.
   - **Visible result:** The final Review Bundle exposes one clear publication review: complete proposed diff authority, three SHAs, exact destination, validation, commit message, and each response's target/body/included state. The user can approve the complete candidate or receive a precise stale/incomplete refusal; opening or editing causes no external effect.
   - **Durable records / external effects:** Persists candidate/approval revisions, response selections, bounded draft hashes, acknowledgements, and lock intent through F03. No Git, GitHub, validation, commit, push, or response effect.
   - **Failure / cancellation / restart:** Proposal-stage, incomplete, stale, attention, over-limit, or stale-revision requests are refused. Closing/reopening reloads the same committed candidate. Cancelling before intent leaves the bundle reviewable and unlocked; a post-intent cancellation is handled by later phase rules.
   - **Exact evidence:** Candidate authority table for proposed/context/relevant diffs; three-SHA and condition matrix; response inclusion/override fixture; commit-message revision race; un-attributed-change acknowledgement; keyboard-only and screen-reader approval flow; no-effect spies; CT-F23-01, CT-F23-07, CT-F23-10; `git diff --check`.
   - **Exit criterion:** AC-01-AC-03, AC-06-AC-08, AC-15, and AC-25 pass; a publication cannot start without explicit approval of the current complete candidate and selected responses.

2. **Fresh preflight, publication lock, and durable intent**
   - **Blocked by:** Slice 1; F02/F03 publication contracts; F06 current-ref/PR-state reads; F13 `WorktreeCondition`; F14 validation; F22 stale gate.
   - **Stories / requirements / acceptance criteria:** US-02-US-05, US-11; FR-02.1-FR-02.8, FR-03.1-FR-03.8; AC-04-AC-08, AC-12, AC-24-AC-25; NFR-01-NFR-04, NFR-06-NFR-09; INV-03-INV-06, INV-11-INV-12; CT-F23-02, CT-F23-03, CT-F23-10.
   - **Implementation:** Build one main-process preflight that refreshes exact PR/ref state, open/merged status, F13 condition/current HEAD/baseline/diff, F14 validation, and F22 action gate. Persist approval, lock, candidate/target snapshots, effect rows, and phase before any GitHub/Git effect. Use expected revisions and stable idempotency keys for duplicate/competing commands.
   - **Visible result:** The user sees a current success gate or a publication-blocking reason that names the mismatched SHA, unsafe condition, changed candidate, unavailable validation, or stale revision and offers only permitted next actions.
   - **Durable records / external effects:** Adds publication lock, preflight attempts, intent, expected identities, evidence hashes, response plan, and correlation records. Reads may contact F06/F13/F14; no commit/push/response effect begins until the intent transaction commits.
   - **Failure / cancellation / restart:** Any mismatch or unknown read blocks before effect. Duplicate approval returns the existing intent; competing publication receives a typed conflict. A crash after intent commit is recoverable; a crash before commit creates no publication intent.
   - **Exact evidence:** Preflight truth table; fork/head-repository matrix; stale/closed/merged/changed-candidate/unsafe-condition matrix; persist-before-effect fault injection; duplicate/competing lock race; redaction and arbitrary-input rejection; CT-F23-02-CT-F23-03, CT-F23-10.
   - **Exit criterion:** AC-04-AC-08, AC-12, and AC-24 pass; no publication side effect can start without a committed, revision-bound intent and fresh exact-target evidence.

3. **Deterministic code candidate staging, commit, and no-code path**
   - **Blocked by:** Slice 2; F13 canonical worktree/publication handle; F02/F03 phase records; temporary Git repositories; F14 required validation.
   - **Stories / requirements / acceptance criteria:** US-04; FR-04.1-FR-04.3, FR-04.8; FR-06.3, FR-06.7-FR-06.8; AC-09-AC-10, AC-13, AC-23-AC-24; NFR-04-NFR-07; INV-03-INV-06, INV-12; CT-F23-04-CT-F23-05, CT-F23-09-CT-F23-10.
   - **Implementation:** Add a narrow deterministic Git publication port that accepts only an F13-owned handle, approved candidate hash/manifest, baseline, exact target identity, and bounded message. Re-inspect immediately before staging; record `NO_CODE_CHANGE` for an empty diff; otherwise stage the complete candidate, verify the staged tree/hash, create/adopt one commit, and persist its SHA before push.
   - **Visible result:** A fixture shows either a response-only publication with no empty commit or one local commit whose tree is exactly the approved proposed diff and excludes unrelated/ignored changes.
   - **Durable records / external effects:** Updates `COMMITTING`, `COMMIT_CREATED`, or `NO_CODE_CHANGE`, local commit evidence, staged candidate hash, and worktree snapshot. The only filesystem/Git mutation is within the operation-owned worktree.
   - **Failure / cancellation / restart:** Candidate mismatch, unsafe condition, staging mismatch, Git failure, cancellation, or uncertain local commit preserves the worktree and enters failed/recovery evidence. Restart adopts a proven matching commit or retries only when no matching commit exists; it never blindly creates a second commit.
   - **Exact evidence:** Empty/no-code case; tracked/untracked/ignored/added/deleted/renamed/binary exact-staging corpus; staged-tree hash comparison; commit-message bound test; crash before/after commit; local adoption/ambiguous-HEAD matrix; developer-clone before/after hash; CT-F23-04-CT-F23-05.
   - **Exit criterion:** AC-09-AC-10, AC-13, and AC-23 pass; the code publisher cannot create an empty/duplicate/unapproved commit or mutate the developer clone.

4. **Exact non-force push and remote reconciliation**
   - **Blocked by:** Slice 3; F06 exact ref/PR-state reads; Git publication fake with expected-old-SHA push; F02/F03 recovery records.
   - **Stories / requirements / acceptance criteria:** US-04-US-05, US-08; FR-02.1, FR-02.6-FR-02.8, FR-04.4-FR-04.7, FR-06.2, FR-06.4, FR-08.4-FR-08.6; AC-04-AC-05, AC-11-AC-14, AC-22-AC-24; NFR-01-NFR-07; INV-03-INV-07, INV-12; CT-F23-02, CT-F23-04, CT-F23-06, CT-F23-10.
   - **Implementation:** Persist `PUSHING` before the push. Push the recorded commit to the exact head repository/ref with a non-force expected-old-SHA operation; fetch/inspect the exact remote ref and adopt the recorded remote SHA. Distinguish remote-still-old-and-safe-to-retry, remote-equals-commit/adopted, and remote-diverged/unknown/stale outcomes.
   - **Visible result:** A successful code publication shows the exact commit SHA and destination; a stale or rejected push shows what moved and offers re-evaluate/inspect/retry guidance without a force option.
   - **Durable records / external effects:** Persists push intent, expected old SHA, target identity, local/remote commit SHA, response ordering gate, push attempt/outcome, and recovery evidence. One non-force push may reach the remote; no provider/AI effect.
   - **Failure / cancellation / restart:** Network loss after push enters recovery. Restart re-fetches before retry. A remote ref equal to the recorded commit becomes `PUSHED`; a remote ref still at the expected old SHA may reuse the same intent; any other remote value is stale/unknown and blocks.
   - **Exact evidence:** Fork/head-repository target test; non-force argument/flag scan; expected-old-SHA matrix; remote-before/after/crash/network-loss fixtures; ref deletion/closed/merged/non-fast-forward cases; no response-before-code-success assertion; CT-F23-06.
   - **Exit criterion:** AC-11-AC-14 and AC-22 pass; no retry can create a duplicate commit/push or force a stale target.

5. **Selected response publication and per-response reconciliation**
   - **Blocked by:** Slice 4; F06 typed response operations; F03 response-effect rows; product decision PD-01; response collection/reconciliation fakes.
   - **Stories / requirements / acceptance criteria:** US-06-US-09; FR-05.1-FR-05.9, FR-06.5-FR-06.6; AC-15-AC-22, AC-24; NFR-02-NFR-06, NFR-09; INV-03, INV-07, INV-09-INV-12; CT-F23-07-CT-F23-09, CT-F23-10.
   - **Implementation:** After `PUSHED` or `NO_CODE_CHANGE`, load included responses in deterministic order. Persist each `PENDING` row before calling F06. Record confirmed remote IDs. For uncertain outcomes, re-fetch the exact target scope and adopt only a unique exact match; retain `UNKNOWN` on no/multiple match. Provide explicit response-only retry for confirmed failed/not-posted rows and disable all code effects on that path.
   - **Visible result:** Each response shows included/excluded, pending/posted/failed/unknown, target, body, remote ID, and next action. A failed response can be retried without republishing code; an unknown response asks for deterministic reconciliation rather than hiding duplication risk.
   - **Durable records / external effects:** Persists response plan and effect rows, target/body hashes, attempts, response IDs, F06 outcome, reconciliation evidence, and `RESPONSES_PENDING`/`COMPLETED` progress. Included rows may post through F06; excluded rows never call it.
   - **Failure / cancellation / restart:** Renderer closure/restart resumes the same rows. Rate limits, malformed responses, cancellation, or network loss preserve prior IDs/states. Confirmed failed/not-posted rows may retry; unknown rows remain attention until proven. A duplicate response command returns the existing row.
   - **Exact evidence:** Issue-comment and review-comment reply targets; included/excluded/edited drafts; deterministic order; confirmed success/failure; unique/no/multiple matching responses; timeout/restart; no-blind-repost and response-only-no-code-publish spies; CT-F23-07-CT-F23-08.
   - **Exit criterion:** AC-15-AC-19 and AC-22 pass; selected responses are independently recoverable and no response retry can touch code publication.

6. **Terminal bundle outcome, handled history, and hold release**
   - **Blocked by:** Slice 5; F02 terminal transitions; F11 handled/hold handoff; F18 bundle history; F20/F19 result projections.
   - **Stories / requirements / acceptance criteria:** US-09-US-10; FR-03.3-FR-03.8, FR-05.1-FR-05.8, FR-06.6-FR-06.8, FR-07.1-FR-07.6, FR-08.5-FR-08.6; AC-20-AC-23; NFR-01-NFR-08; INV-01, INV-03, INV-07-INV-12; CT-F23-09-CT-F23-10.
   - **Implementation:** Map complete code/no-code plus response reconciliation to `PUBLISHED`/`COMPLETED`; map code/no-code plus failed/unknown selected responses to `PUBLISHED_WITH_ERRORS` without code-republish capability; keep pre-effect failures held and reviewable. Commit the terminal outcome and effect/history records before asking F11 to mark handled associations and release the hold. Project retained feedback and independent response-only actions.
   - **Visible result:** The Review Bundle clearly distinguishes published, published-with-errors, failed, and recovering states, shows exact code/response outcomes and next actions, and returns to Watching only after the durable handoff.
   - **Durable records / external effects:** Persists terminal transitions, handled-version outcome, hold-release request/result, retained-feedback projection, known commit/no-code result, response states, and F19/F20/F28 targets. F11 may release the hold after the terminal commit.
   - **Failure / cancellation / restart:** Duplicate terminalization or hold release returns existing outcome. F11 refusal, persistence fault, or uncertain handoff keeps history and a recovery/attention state; it does not invent success or replay effects. New feedback during the hold remains separate.
   - **Exact evidence:** Complete/partial/no-code terminal matrix; `PUBLISHED_WITH_ERRORS` no-republish guard; handled association and retained-feedback fixture; hold release ordering/idempotency; history after restart; F20 accessible outcome/next-action projection; CT-F23-09-CT-F23-10.
   - **Exit criterion:** AC-20-AC-23 pass; APP-AC-24/25/27-29/68 publication and hold evidence is complete and independently reviewable.

7. **Cross-feature recovery, security, accessibility, and release gate**
   - **Blocked by:** Slices 1-6, F28 recovery seams, F29 boundary checks, F30 Windows harness, and final repository check/linter commands.
   - **Stories / requirements / acceptance criteria:** US-01-US-11; all FRs, NFRs, and INVs; APP-AC-14, APP-AC-16-APP-AC-17, APP-AC-24-APP-AC-29, APP-AC-39, APP-AC-67-APP-AC-68, APP-AC-75; AC-01-AC-25; CT-F23-01-CT-F23-10.
   - **Implementation:** Run complete fake workflows from final bundle through approval, no-code/code publication, response-only retry, partial response failure, stale/dirty refusal, renderer replacement, process restart, sleep/network interruption, and uncertain outcomes. Add import/capability/secret/force-option scans, typed IPC/read-model checks, and Windows accessibility/focus/narrow-width evidence. Record the pending response-inclusion decision and rerun both semantic linters after any change.
   - **Visible result:** A single report demonstrates that a developer can approve, publish, recover, or safely stop a Review Bundle with exact evidence and no duplicate external effect; response-only retry never republishes code.
   - **Durable records / external effects:** Uses only test-owned SQLite, temporary repositories/worktrees, fake F06/F14/F11/F18/F20/F21/F22/F28 ports, and bounded reports. It does not use live credentials, contact GitHub, edit `checklist.md`, or publish code/responses.
   - **Failure / cancellation / restart:** Any false success, duplicate effect, released hold, force flag, stale bypass, secret/SDK leak, developer-clone mutation, inaccessible approval, invalid mapping, or definite linter miss blocks the gate. A cancelled run leaves no success marker and is rerunnable from fresh fixtures.
   - **Exact evidence:** `npm run check`; F23 contract/integration report; approval/preflight/lock matrix; exact staging/commit/push report; response/reconciliation report; partial-publication and hold/history report; restart/fault-injection matrix; keyboard/screen-reader/forced-colors/reduced-motion/zoom/narrow-width evidence; forbidden-import/capability/secret/force scan; `git diff --check`; `npm run lint:prd-plan -- Specs/human_approved_idempotent_review_bundle_publication_PRD.md Specs/human_approved_idempotent_review_bundle_publication_PLAN.md`; `npm run lint:application-coverage -- Specs/application_overview.md Specs/human_approved_idempotent_review_bundle_publication_PRD.md`.
   - **Exit criterion:** All F23 requirements have direct or named contract evidence, all mapped application criteria have no definite missing/invalid result, both specification linters pass without definite missing/invalid results, the response-inclusion decision is resolved, and F23 remains unchecked pending implementation approval and completion.

## Cross-Slice Verification and Handoff

- F02 remains the only owner of Review Bundle/publication phase legality, reason vocabulary, explicit approval boundary, uncertain-outcome semantics, and hold-compatible terminal transitions. F23 persists and executes those decisions; it does not create a competing state machine.
- F03 remains the only owner of publication migrations, transactions, uniqueness, optimistic concurrency, append-only phase/effect history, and restart-safe records. F23 never treats a renderer flag, activity entry, provider thread, or in-memory lock as authoritative.
- F06 remains the only GitHub REST boundary. F23 supplies exact server/repository/PR/response target identity and persisted publication context; F06 does not decide approval, retry, or response idempotency.
- F11 remains authoritative for handled-version associations and legal per-PR hold release. F23 performs the handoff only after a durable terminal publication outcome and never replays handled versions.
- F13 remains authoritative for actual worktree state, `WorktreeCondition`, canonical paths, three-SHA meanings, complete proposed-worktree diff, and developer-clone protection. F23 consumes fresh evidence and invokes only a typed publication port over the owned worktree.
- F14 remains authoritative for validation truth. F23 decides when a required final recheck is needed and gates publication on the typed result; model claims never create a pass.
- F18/F20/F21/F22 remain authoritative for final bundle preparation, presentation, revisions, stale handling, dirty-worktree choices, discard, and re-evaluation. F23 rejects stale revisions and never silently changes the reviewed candidate.
- F19/F28 consume bounded outcome/recovery targets; they do not gain publication capability through a notification or read model. F29/F30 own cross-feature security and release evidence.
- Branch synchronization publication is separate and remains owned by F27. F23 never publishes a synchronization merge or marks synchronization results stale as a side effect of Review Bundle publication.
- The exact owning PRD is `Specs/human_approved_idempotent_review_bundle_publication_PRD.md`; these documents create no application code, do not change `checklist.md`, and do not claim that code, push, response, or publication behavior is implemented.

## Requirement-to-Slice Trace

| Requirement family | Owning slices |
|---|---|
| FR-01 | 1, 2, 7 |
| FR-02 | 2, 4, 7 |
| FR-03 | 1-2, 6-7 |
| FR-04 | 3-4, 7 |
| FR-05 | 5-7 |
| FR-06 | 3-7 |
| FR-07 | 6-7 |
| FR-08 | 1-2, 5-7 |
| NFR-01-NFR-09 | 1-7 |
| INV-01-INV-12 | 1-7 |
| APP-AC-14, APP-AC-16-APP-AC-17, APP-AC-30 | 1-7 |
| APP-AC-24-APP-AC-29, APP-AC-53 | 1-7 |
| APP-AC-39, APP-AC-67-APP-AC-68, APP-AC-73, APP-AC-75 | 1-7 |
