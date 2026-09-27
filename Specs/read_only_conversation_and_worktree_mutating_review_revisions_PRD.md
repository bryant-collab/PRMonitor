# F21 - Read-only Conversation and Worktree-mutating Review Revisions - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F03 - SQLite persistence, migrations, and transactional repositories | Provides durable conversation, turn, revision, bundle, and expected-revision records with commit-before-effect semantics. |
| 2 | F13 - Operation-owned Git worktrees and change attribution | Supplies the canonical Review Bundle worktree, before/after snapshots, fresh `WorktreeCondition`, authoritative diffs, and manual-edit/overlap evidence. |
| 3 | F14 - Deterministic validation runner and result model | Supplies real post-change validation evidence after a worktree-mutating revision and explicit no-run/interrupted outcomes. |
| 4 | F15 - Provider-neutral AI contracts and Codex adapter | Supplies the read-only conversation, review-revision, streaming, usage, opaque conversation-reference, structured-result, cancellation, and safe-error contracts. |
| 5 | F16 - AI preferences, task-profile snapshots, execution policies, and Common Instructions | Resolves the current immutable Read-only Conversation or Review Revision profile/policy/context snapshot for each explicitly started turn. |
| 6 | F17 - Bounded AI Work Controller and deterministic progress evaluation | Owns mutating-operation budgets, timeouts, turn reports, progress/stop reasons, and explicit continuation or new-operation authorization. |
| 7 | F18 - Automatic review-to-Review-Bundle vertical slice | Owns the Review Bundle stage/state, proposal decisions, question-answer completion, finalization, per-PR hold, and atomic bundle read-model updates. |
| 8 | F20 - Review Bundle workspace and complete diff viewer | Provides the review workspace/action gate into which conversation, per-entry instructions, question answers, progress, and revision actions are exposed. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F22 - Discard, stale detection, and re-evaluation with dirty-worktree choices | Consumes F21's refreshed bundle state, worktree evidence, preserved history, and stale/attention outcomes when the user must discard or re-evaluate. |
| 2 | F23 - Human-approved, idempotent Review Bundle publication | Consumes the final refreshed proposed-worktree diff, response drafts, validation evidence, revision history, and publication preconditions. |
| 3 | F28-F30 - Recovery, security, and release readiness | Exercise conversation/revision restart recovery, provider/worktree boundaries, accessibility, and packaged Windows behavior. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-22 | FR-01.1-FR-03.8, FR-08.1-FR-08.5, INV-01-INV-03 | AC-01-AC-04, AC-09, AC-15-AC-18, AC-21-AC-24 | Primary: F21 owns the explicit conversation/revision workflow and routes both read-only and worktree-mutating turns before publication; F15 owns the provider contract and F20 owns the surrounding workspace presentation. |
| APP-AC-33 | FR-02.4, FR-03.2, FR-04.4, FR-08.2 | AC-03, AC-10, AC-19 | Shared: F16 resolves Common Instructions; F21 includes the immutable effective set in every new conversation, revision, and explicitly authorized continuation turn. |
| APP-AC-39 | FR-04.2-FR-04.6, FR-06.1-FR-06.4, INV-05 | AC-10-AC-14, AC-17, AC-22 | Shared: F13 owns attribution and actual worktree truth; F21 preserves the existing worktree and blocks unsafe mutation, while F22 owns destructive clear choices. |
| APP-AC-41 | FR-03.2, FR-04.3, FR-08.2 | AC-03, AC-09, AC-19 | Shared: F16/F18 own the original PR Intent / Context snapshot; F21 carries that snapshot into applicable follow-up turns without rewriting the bundle history. |
| APP-AC-42 | FR-03.2, FR-08.2-FR-08.3, INV-07 | AC-19, AC-21 | Shared: F21 keeps earlier conversation and revision records tied to their old snapshots; only a new explicit turn may use a newly resolved context snapshot. |
| APP-AC-55 | FR-03.4-FR-03.8, FR-05.4, FR-07.1-FR-07.4 | AC-04, AC-12-AC-14, AC-20-AC-22 | Shared: F17 owns bounded timeout, cancellation, and consumed-turn accounting; F21 admits work only through F17 and maps its outcomes to the Review Bundle. |
| APP-AC-56 | FR-05.2-FR-05.5, FR-07.2, FR-08.4 | AC-12-AC-14, AC-17, AC-20 | Shared: F17 assembles the authoritative AI Work Turn Report; F21 links it to the conversation/revision and refreshed bundle read model. |
| APP-AC-57 | FR-05.4-FR-05.6, FR-07.3-FR-07.4, INV-08 | AC-13-AC-14, AC-20-AC-22 | Shared: F17 produces machine-readable stop reasons; F21 preserves evidence, enters the appropriate attention outcome, and never retries automatically. |
| APP-AC-58 | FR-07.3-FR-07.5, FR-08.4 | AC-13, AC-20-AC-22 | Shared: F17 owns continuation authorization and history; F21 exposes the explicit Continue AI Work/revision route through F20 without resetting a budget. |
| APP-AC-59 | FR-03.1, FR-04.1, FR-08.2 | AC-02, AC-09, AC-19 | Shared: F16 owns four independent profile settings; F21 declares Read-only Conversation or Review Revision for every invocation and never selects a provider ad hoc. |
| APP-AC-60 | FR-03.1-FR-03.3, FR-04.1, FR-08.2 | AC-02-AC-03, AC-09, AC-19 | Shared: F21 passes the declared task/profile snapshot through F17/F15; F15 owns adapter translation and F16 owns resolution. |
| APP-AC-61 | FR-03.2-FR-03.4, FR-04.3, FR-08.2-FR-08.3 | AC-03, AC-09, AC-12, AC-19, AC-21 | Shared: F16/F17/F03 own immutable snapshots and lifecycle; F21 binds each conversation/revision turn to the snapshot used and never rereads mutable settings mid-turn. |
| APP-AC-62 | FR-03.3, FR-05.2, FR-08.4 | AC-03, AC-12-AC-14, AC-19-AC-20 | Shared: F21 links task type, provider, model, reasoning effort, profile revision, policy summary, and usage to the bundle; F20 presents them and deterministic paths remain zero-AI. |
| APP-AC-64 | FR-03.2-FR-03.8, FR-05.2-FR-05.5, FR-08.2-FR-08.5 | AC-03-AC-04, AC-12-AC-14, AC-19-AC-21 | Shared: F03/F17 persist provider-neutral metadata and usage; F21 owns the conversation/revision association and never persists SDK objects. |
| APP-AC-67 | FR-06.1-FR-06.4, INV-05-INV-06 | AC-14-AC-17 | Shared boundary: F13 refreshes the three SHA/diff identities; F21 requires and links the fresh proposed-worktree/context evidence, while F20/F23 own presentation and publication. |
| APP-AC-74 | FR-03.2, FR-04.3, FR-06.2, FR-08.2 | AC-03, AC-09, AC-14, AC-19 | Shared: F00/F16 own trusted Build & Validation configuration; F21 includes the effective snapshot as context and never turns free-form instructions into executable authority. |

### Explicit coverage boundaries

F21 is the primary workflow owner for user-directed conversation and review
revisions. It does not create the initial Review Proposal, own the Review Bundle
state machine, or grant publication authority. F18 remains authoritative for
proposal decisions, effective question-answer completion, stage/state changes,
hold retention, and atomic final bundle commits. F20 owns the general workspace
shell, accessibility treatment, and action presentation; F21 supplies typed
conversation/revision commands and read-model data.

F17 remains authoritative for mutating-turn budgets, timeouts, continuation
authorization, reports, progress, and stop reasons. F13 and F14 remain the
sources of truth for actual worktree/Git and validation state. F22 owns stale
handling, discard, re-evaluation, and the Clear All/Clear Only AI Changes/Keep
Worktree choices. F23 owns publication. F21 does not claim APP-AC-23 or
APP-AC-27-APP-AC-29, and it does not claim the full ownership of APP-AC-39,
APP-AC-41, APP-AC-42, APP-AC-67, or APP-AC-74.

## Executive Summary

After a Review Bundle is prepared, a developer needs two very different ways to
ask for help. They may want an explanation or a second opinion without changing
anything, or they may explicitly want the selected provider to revise code,
tests, assessments, or proposed replies in the isolated worktree. Treating both
requests as undifferentiated chat makes a read-only question risky and makes a
code revision difficult to bound and review.

F21 adds an explicit, durable conversation and revision workflow. The developer
chooses **Ask / clarify** for a read-only turn or **Revise worktree** for a
bounded Review Revision turn. Proposal-stage item instructions and question
answers are recorded against the current F18 decision revision; a chat message
never silently counts as an answer or implementation authorization. Every
mutating turn is admitted through F17, runs only in the recorded F13 worktree,
and is followed by fresh deterministic Git and validation evidence before the
bundle is refreshed.

The resulting bundle remains reviewable. Manual edits are preserved, provider
claims remain claims, conversation references are opaque, budgets and snapshots
survive restart, and publication remains a separate explicit F23 workflow.

## User Stories

### Ask without changing the worktree

- **US-01:** **GIVEN** a Review Bundle can accept a user-directed conversation, **WHEN** the developer chooses **Ask / clarify** and sends a message, **THEN** PRMonitor uses the Read-only Conversation task profile, shows safe progress and the bounded answer, and leaves files, diffs, validation, decisions, and publication state unchanged.
  - **Acceptance Criteria:** AC-01-AC-04, AC-09-AC-12, AC-21-AC-24.
- **US-02:** **GIVEN** the provider supports an opaque conversation reference, **WHEN** the developer explicitly sends a compatible follow-up, **THEN** PRMonitor may continue that provider conversation; a provider or policy mismatch fails safely or starts a new explicit conversation and never silently resumes incompatible context.
  - **Acceptance Criteria:** AC-03, AC-04, AC-19, AC-21.

### Complete proposal inputs safely

- **US-03:** **GIVEN** a bundle is in `PROPOSAL_REVIEW`, **WHEN** the developer adds per-entry implementation instructions or answers an effective question, **THEN** the bounded value is saved against the current item/decision revision and the implementation gate reflects the committed value.
  - **Acceptance Criteria:** AC-05-AC-08, AC-23.
- **US-04:** **GIVEN** a proposal item has a required question, **WHEN** the developer chats about it, **THEN** the conversation remains separate from the required answer until the developer explicitly applies a bounded answer to that item.
  - **Acceptance Criteria:** AC-05-AC-07, AC-23.

### Request a bounded revision

- **US-05:** **GIVEN** proposal decisions and required answers are complete, or a final bundle permits revision, **WHEN** the developer chooses **Revise worktree**, **THEN** PRMonitor starts one explicitly authorized Review Revision operation with the selected scope, final decisions, user instructions, and immutable configuration snapshot.
  - **Acceptance Criteria:** AC-08-AC-12, AC-19.
- **US-06:** **GIVEN** the worktree contains manual or earlier AI changes, **WHEN** a revision is requested, **THEN** PRMonitor inspects the actual current state, preserves the worktree, shows any unsafe condition, and requires the owning workflow to resolve mixed/overlapping or stale evidence before mutation.
  - **Acceptance Criteria:** AC-10-AC-11, AC-14, AC-22.
- **US-07:** **GIVEN** the provider is asked to revise code, tests, assessments, or proposed replies, **WHEN** the bounded turn finishes, **THEN** the Review Bundle is refreshed from actual Git/validation evidence and returns to final review or actionable attention without treating provider prose as truth.
  - **Acceptance Criteria:** AC-12-AC-18, AC-20-AC-22.

### Recover and continue deliberately

- **US-08:** **GIVEN** a revision times out, is cancelled, fails, or stops for repeated/no-progress state, **WHEN** the developer reopens the bundle, **THEN** the complete report, preserved worktree, usage, stop reason, and permitted continuation action are visible and no replacement turn starts automatically.
  - **Acceptance Criteria:** AC-13, AC-20-AC-22.
- **US-09:** **GIVEN** the renderer closes or the process restarts during a conversation or revision, **WHEN** the developer reopens PRMonitor, **THEN** committed conversation/revision records and bundle evidence rehydrate without a budget reset, duplicate provider turn, or silent provider resume.
  - **Acceptance Criteria:** AC-03-AC-04, AC-12-AC-13, AC-19-AC-23.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** a Review Bundle is openable and its state permits a user-directed conversation, **WHEN** the conversation panel opens, **THEN** it shows the bundle/item target, current evidence revision, distinct **Ask / clarify** and **Revise worktree** intents, and any required proposal inputs; opening the panel starts no provider, Git, validation, or publication effect.
- **AC-02:** **GIVEN** the developer chooses one conversation intent, **WHEN** a message is submitted, **THEN** the request contains exactly one declared task type and target scope: `READ_ONLY_CONVERSATION` for **Ask / clarify** or `REVIEW_REVISION` for **Revise worktree**; F21 never classifies mutation authority from message wording, provider prose, or thread state.
- **AC-03:** **GIVEN** a read-only message is valid and the current bundle/context revision is fresh, **WHEN** F21 admits it, **THEN** F03 records the conversation message and turn intent before F15 is called, F16 supplies an immutable Read-only Conversation profile/policy/Common Instructions/Build & Validation/context snapshot, and the request contains no mutation or publication capability.
- **AC-04:** **GIVEN** a read-only provider turn streams, completes, is cancelled, times out, or fails, **WHEN** F21 handles the outcome, **THEN** safe progress and one bounded terminal conversation record are persisted, the structured answer is shown when valid, usage and opaque reference metadata are retained when available, no worktree-mutating budget is consumed, and no automatic resume/retry occurs.
- **AC-05:** **GIVEN** a proposal item has an effective `question` disposition, **WHEN** the developer submits an answer, **THEN** F21 requires a non-empty bounded answer and the current item/decision revision, persists it through F18's decision contract, and marks the item complete only after the authoritative F18 read model confirms the write.
- **AC-06:** **GIVEN** the developer edits proposal-stage per-entry instructions, **WHEN** the value is saved, **THEN** it is bounded, associated with the selected item and current decision revision, visible as implementation input, and never treated as a remote response, publication approval, or hidden mutation command.
- **AC-07:** **GIVEN** a question is discussed in conversation, **WHEN** the provider returns an answer, **THEN** the answer remains conversation content until the developer explicitly chooses **Use as answer** and submits it through the item decision contract; an empty, stale, superseded, or over-limit answer cannot satisfy the implementation gate.
- **AC-08:** **GIVEN** a proposal bundle has undecided items or unanswered effective questions, **WHEN** the developer chooses **Revise worktree**, **THEN** F21 blocks the request, identifies every incomplete item, preserves all committed inputs, and starts no provider turn or worktree mutation.
- **AC-09:** **GIVEN** a revision request passes the proposal/final-state gate, **WHEN** F21 admits it, **THEN** the request contains the final human decisions, effective answers, per-entry instructions, selected user revision message, immutable bundle context, exact F13 worktree reference, and a fresh F16 Review Revision profile/policy snapshot; only accepted/overridden `fixed` decisions authorize code/test changes.
- **AC-10:** **GIVEN** a revision or conversation turn is about to start, **WHEN** F21 inspects the current worktree, **THEN** it uses fresh F13 evidence. `CLEAN` and `AI_ATTRIBUTED_ONLY` may proceed when the action capability permits; `UNATTRIBUTED_CHANGES` requires explicit confirmation to preserve/include the current worktree; `MIXED_OR_OVERLAP` and `STALE_OR_UNKNOWN` block mutation and route only the typed inspection or F22 decision available for that condition.
- **AC-11:** **GIVEN** a mutating revision is admitted, **WHEN** the provider runs, **THEN** it receives only the exact operation-owned worktree and resolved policy through F15, F21 never resets, replaces, deletes, or silently cleans the worktree, and F13 remains authoritative for actual files, diffs, attribution, and overlap.
- **AC-12:** **GIVEN** a Review Revision turn starts, **WHEN** it completes or reaches a bounded terminal outcome, **THEN** F17 records at most one consumed mutating turn with its timeout, usage, report, progress, and stop data; F21 does not create an unbounded follow-up loop, and a read-only turn never consumes that budget.
- **AC-13:** **GIVEN** a revision is cancelled, times out, fails, is policy-blocked, or is stopped by F17, **WHEN** F21 finalizes the attempt, **THEN** the worktree, reports, snapshots, conversation history, and usage remain available, the bundle exposes a machine-readable attention reason and permitted next action, and no automatic replacement turn starts.
- **AC-14:** **GIVEN** a provider turn may have changed the worktree, **WHEN** it reaches a terminal outcome, **THEN** F21 requests fresh F13 snapshots and proposed-worktree/PR-context diff evidence and requests applicable F14 post-change validation; the refreshed bundle uses actual evidence, records `not_run` or interrupted status explicitly when appropriate, and never carries a stale pass forward as a new pass.
- **AC-15:** **GIVEN** a Review Revision result is returned, **WHEN** F15 validates it, **THEN** every changed assessment, disposition-supporting explanation, proposed reply, or implementation outcome is keyed to an allowed bundle/item identity and bounded scope; malformed, out-of-scope, prose-only, or publication-claiming output is rejected without creating an authoritative result.
- **AC-16:** **GIVEN** a revision changes a proposed reply or assessment, **WHEN** F21 applies the valid result, **THEN** F18 persists it as a new bounded draft/evidence revision, keeps the original and prior revision history inspectable, and never posts, resolves, approves, commits, pushes, or publishes it.
- **AC-17:** **GIVEN** a revision completes with fresh Git and required validation evidence, **WHEN** F18 commits the refreshed aggregate, **THEN** the bundle remains in `FINAL_REVIEW` with `READY_FOR_REVIEW` when no blocking reason remains, or enters `NEEDS_ATTENTION` with preserved evidence and a permitted next action; the complete proposed-worktree diff and PR-context diff remain distinct.
- **AC-18:** **GIVEN** a revision request contains no eligible code/test decision and only asks for a semantic draft/assessment/reply change, **WHEN** the explicitly selected Review Revision turn completes without worktree changes, **THEN** F21 records the no-code actual state and valid semantic result without fabricating a diff or treating the absence of code edits as automatic failure.
- **AC-19:** **GIVEN** Preferences, Common Instructions, Build & Validation settings, PR Intent / Context, or a provider conversation reference changes after a turn snapshot, **WHEN** the turn or old bundle is read, **THEN** the original snapshot and result remain unchanged; a new explicitly authorized turn may use a new compatible F16 snapshot, while an incompatible provider reference is rejected or replaced explicitly.
- **AC-20:** **GIVEN** a revision stops with a continuation-permitted reason, **WHEN** the developer selects **Continue AI Work**, **THEN** F21 shows the complete turn history, remaining budget, usage, unresolved issues, and effective snapshot before sending a one-time F17 continuation authorization; after exhaustion, only a separately confirmed new parent operation may start.
- **AC-21:** **GIVEN** the renderer closes, reloads, or the process restarts during an active or completed conversation/revision, **WHEN** the main process reconciles the records, **THEN** it preserves committed intent, one terminal outcome, worktree evidence, report history, and budget; it never resumes a provider thread or starts a duplicate turn merely because the UI reopened.
- **AC-22:** **GIVEN** two equal commands, a stale renderer revision, or two competing revision requests arrive, **WHEN** the main process evaluates them, **THEN** an equal committed request returns its existing result, a stale request is rejected with refresh guidance, and only one active mutating revision can own the bundle worktree at a time.
- **AC-23:** **GIVEN** conversation, answer, instruction, or revision controls are used with keyboard navigation, screen readers, forced colors, reduced motion, a narrow window, or long bounded text, **WHEN** the workflow is exercised, **THEN** modes, targets, required fields, streaming/cancel states, stop reasons, and next actions remain understandable without color, hover, animation, or horizontal overflow.
- **AC-24:** **GIVEN** any conversation or revision value crosses an F03/F04/F15/F16/F17 bound, **WHEN** it is validated, **THEN** the value is accepted only when within the effective published bound; over-limit, secret-shaped, arbitrary-path, credential, SDK-object, raw-environment, or publication-capability data is rejected or excluded before persistence, IPC, or provider start.

## Functional Requirements

### FR-01: Explicit conversation and revision intents

- FR-01.1: The application SHALL expose distinct, user-visible **Ask / clarify** and **Revise worktree** intents for user-directed Review Bundle work.
- FR-01.2: Every intent SHALL identify one Review Bundle, an optional item or bounded item selection, the current bundle/item evidence revision, the user-authored message or field change, and the requested action.
- FR-01.3: Opening a conversation surface or drafting an instruction SHALL not start an AI provider, mutate a worktree, run validation, or create a publication intent.
- FR-01.4: F21 SHALL never infer mutation authority from message text, model output, provider thread state, or a UI route; only the explicit intent and owning workflow capability can authorize a revision.
- FR-01.5: F21 SHALL allow at most one active worktree-mutating revision for a Review Bundle and SHALL reject or safely serialize competing requests rather than sharing a mutable worktree.

### FR-02: Proposal-stage per-entry instructions and answers

- FR-02.1: F21 SHALL support bounded per-entry implementation instructions associated with the current F18 proposal decision revision.
- FR-02.2: F21 SHALL support a bounded required answer for every effective `question` disposition and SHALL keep the answer separate from conversation transcript content.
- FR-02.3: F21 SHALL delegate authoritative answer/instruction persistence and implementation-gate validation to F18; F21 SHALL not maintain a second decision state machine.
- FR-02.4: A conversation response SHALL not satisfy a required question or become implementation authority unless the developer explicitly applies and saves it through the typed item decision command.
- FR-02.5: Stale, duplicate, cancelled, over-limit, or invalid answer/instruction writes SHALL be safe, revision-checked, and free of provider or worktree effects.

### FR-03: Read-only Conversation turns

- FR-03.1: F21 SHALL route **Ask / clarify** through the declared `READ_ONLY_CONVERSATION` task type and the F16-resolved Read-only Conversation profile/policy.
- FR-03.2: Each read-only turn SHALL snapshot the applicable F16 profile, read-only policy, Common Instructions, Build & Validation context, PR Intent / Context, bundle evidence revision, and bounded conversation context before F15 invocation.
- FR-03.3: F21 SHALL include the relevant immutable Review Bundle inputs and selected item context without replacing them with mutable current settings or arbitrary renderer text.
- FR-03.4: A read-only turn SHALL be persist-before-effect, may inspect the recorded operation worktree under the read-only policy, and SHALL not modify files, consume the worktree-mutating budget, run publication, or authorize a mutating turn.
- FR-03.5: F21 SHALL persist bounded user/assistant messages, safe progress, structured `AIReadOnlyConversationResult`, usage, task/profile/policy metadata, opaque provider reference, and terminal reason through F03/F17 contracts.
- FR-03.6: F21 SHALL support explicit cancellation and provider failure handling with one terminal result, preserved transcript, and no automatic retry or resume.
- FR-03.7: A compatible opaque provider conversation reference MAY be reused only after explicit user action and F15 capability validation; provider identity, task type, and policy incompatibility SHALL fail closed or require a new explicit conversation.

### FR-04: Review Revision admission and routing

- FR-04.1: F21 SHALL route **Revise worktree** through the declared `REVIEW_REVISION` task type, F16's immutable Review Revision snapshot, F17's bounded mutating operation/segment, and F15's structured Review Revision contract.
- FR-04.2: Before admission, F21 SHALL require all proposal items to have final accepted/overridden decisions and all effective questions to have valid answers; final-stage revisions SHALL require a current bundle revision and a permitted action capability.
- FR-04.3: The revision input SHALL contain the final per-item decisions, answers, per-entry instructions, selected user request, immutable proposal/bundle context, relevant prior evidence, and exact F13 worktree reference.
- FR-04.4: Only final `fixed` decisions SHALL authorize code/test changes. Pushback, question, and no-change outcomes may inform semantic assessment or response work but SHALL not silently become code instructions.
- FR-04.5: A revision request SHALL persist its durable intent, target scope, snapshots, and F17 authorization before F15 can mutate the worktree or produce a represented external effect.
- FR-04.6: F21 SHALL not implement a second budget, timeout, retry, no-progress, or continuation loop; all mutating turn lifecycle decisions SHALL use F17.

### FR-05: Worktree safety and manual-edit preservation

- FR-05.1: Before a read-only or mutating turn that accesses the worktree, F21 SHALL request fresh F13 ownership, path, HEAD, revision, and `WorktreeCondition` evidence.
- FR-05.2: F21 SHALL permit mutation only when the current condition and owning capability permit it; an un-attributed condition SHALL require explicit user confirmation to preserve/include existing changes, and mixed/overlapping or stale/unknown evidence SHALL block mutation.
- FR-05.3: F21 SHALL never reset, replace, delete, clean, checkout, or overwrite the Review Bundle worktree as part of conversation or revision execution.
- FR-05.4: F21 SHALL request F13 before/after snapshots for every mutating turn and SHALL preserve manual, build/test-created, untracked, binary, rename, deletion, and overlapping changes for deterministic attribution.
- FR-05.5: Provider-reported files, commands, diffs, or completion SHALL remain model claims until F13 supplies actual state and diff evidence.
- FR-05.6: A failed or cancelled revision SHALL leave the complete worktree available for inspection and SHALL route dirty cleanup or replacement choices to F22.

### FR-06: Deterministic refresh and finalization

- FR-06.1: After every mutating revision terminal outcome, F21 SHALL request fresh F13 proposed-worktree and PR-context diff evidence, SHA/revision identities, and worktree condition data.
- FR-06.2: When a mutating turn could have changed code or tests, F21 SHALL request applicable F14 post-change validation; missing, unavailable, interrupted, stale, or failed results SHALL remain explicit non-passing evidence.
- FR-06.3: F21 SHALL send the actual deterministic evidence, F17 reports/usage, valid semantic result, and revision history to F18's atomic bundle-finalization boundary.
- FR-06.4: A successful refresh SHALL preserve separate `prBaseSha`, `prHeadSha`, and `worktreeBaselineSha` meanings and separate proposed-worktree and PR-context diff authority.
- FR-06.5: The refreshed bundle SHALL retain prior conversation, decision, turn, snapshot, and response history while making the latest revision/draft/evidence visible to F20 and F23.
- FR-06.6: A complete valid semantic revision with no code change SHALL be representable as a successful no-code refresh when its deterministic predicate is satisfied; F21 SHALL not fabricate a diff or a validation pass.

### FR-07: Bounded lifecycle, continuation, and recovery

- FR-07.1: F21 SHALL use F17's bounded timeout, cancellation, mutating-turn budget, progress evaluator, AI Work Turn Report, and stop-reason contracts for every Review Revision operation.
- FR-07.2: F21 SHALL map F17 success, attention, cancellation, failure, timeout, repeated-state, no-progress, policy, and uncertain outcomes to the appropriate Review Bundle evidence and permitted next action.
- FR-07.3: F21 SHALL require an explicit Continue AI Work action and one-time F17 authorization before any stopped operation continues; a parent-budget exhaustion SHALL require a separately confirmed new parent operation.
- FR-07.4: Renderer closure, navigation, sleep, restart, or notification opening SHALL not cancel, resume, duplicate, or reset an active or stopped conversation/revision.
- FR-07.5: Startup reconciliation SHALL use durable F03/F17/F13/F14/F15 identities and SHALL never represent an uncertain turn as success or automatically start a replacement.
- FR-07.6: Equal commands SHALL be idempotent; stale bundle/item/evidence revisions, duplicate turn identities, and competing active revisions SHALL return bounded typed refusals or existing results without new provider/worktree effects.

### FR-08: Conversation/revision evidence and downstream handoff

- FR-08.1: F21 SHALL expose a bounded provider-neutral read model containing target scope, mode, message/transcript status, task/profile/policy snapshot metadata, provider/reference metadata when available, usage, reports, worktree condition, diff/validation evidence, bundle revision, reason, and permitted next action.
- FR-08.2: Every new conversation or revision turn SHALL include the applicable Common Instructions, Build & Validation context, and PR Intent / Context snapshot or an explicit typed reason why that context is unavailable; the source settings remain application-owned and immutable snapshots remain historical.
- FR-08.3: F21 SHALL keep model-reported conversation/revision content separate from F13 Git evidence, F14 validation truth, F17 progress/stop decisions, and F18 bundle state.
- FR-08.4: F21 SHALL provide F20 with keyboard- and screen-reader-addressable semantic state for mode, target, required answer, streaming, cancellation, attention, continuation, and refreshed-review outcomes.
- FR-08.5: F21 SHALL provide F22/F23 only the typed refreshed bundle/worktree/diff/validation evidence they are authorized to consume and SHALL not pass effect capabilities through the read model.

### FR-09: Boundary and security behavior

- FR-09.1: F21 SHALL invoke providers only through F15, persist only through F03/F17/F18 contracts, inspect Git only through F13, and obtain validation only through F14.
- FR-09.2: F21 SHALL expose no provider SDK object, credential, GitHub token, arbitrary command, uncontrolled environment value, arbitrary filesystem path, commit, push, response-posting, conversation-resolution, review-approval, merge, force-push, or publication capability to the renderer or provider.
- FR-09.3: F21 SHALL validate and bound user messages, instructions, answers, transcript/progress data, result fields, paths, references, and diagnostics before persistence, IPC, provider handoff, or display.
- FR-09.4: F21 SHALL redact or reject secret-shaped values and SHALL fail closed when a required delegated bound, snapshot, authority, or evidence contract is unavailable or ambiguous.

## Non-Functional Requirements

- **NFR-01: Determinism** - For identical committed bundle/context revisions, explicit intent, dependency evidence, provider-normalized result, and injected clock, F21 SHALL produce equivalent routing, snapshot references, state mapping, refresh requirements, and next-action data without semantic AI deciding application state.
- **NFR-02: Durability and restart safety** - Committed conversation messages, turn intents/results, revision intents, snapshots, reports, worktree evidence, bundle revisions, and stop reasons SHALL survive renderer closure and ordinary process restart.
- **NFR-03: Bounded data and streaming** - User text, transcript entries, streamed progress, result fields, reports, paths, diagnostics, and refreshed evidence SHALL have published finite bounds; over-limit values SHALL be rejected or surfaced as explicit non-success and SHALL not be silently truncated.
- **NFR-04: Accessibility** - Conversation modes, target scope, per-entry fields, required answers, streaming/cancel states, attention reasons, continuation confirmation, and refreshed evidence SHALL remain operable with keyboard navigation, screen readers, forced colors/high contrast, reduced motion, zoom, and narrow windows.
- **NFR-05: Manual-work preservation** - F21 SHALL preserve the operation worktree and expose fresh attribution/overlap evidence; it SHALL not make a destructive cleanup decision as a side effect of sending a message or refreshing a bundle.
- **NFR-06: Idempotency and concurrency** - Duplicate sends, stale renderer actions, restart replay, uncertain provider outcomes, and competing revision requests SHALL not duplicate provider turns, consume extra budget, overwrite newer decisions, or create conflicting worktree owners.
- **NFR-07: Main-process operation** - Conversation and revision lifecycle, persistence, provider calls, cancellation, recovery, and bundle refresh SHALL remain safe without a renderer and SHALL use the Windows main-process/OS boundaries.
- **NFR-08: Provider neutrality and diagnosability** - F21 SHALL use the same normalized contracts for fake and Codex providers, retain safe machine-readable reasons, and expose enough evidence to explain what was requested, what the provider reported, what deterministic services observed, and what can happen next.

## Invariants

- **INV-01:** Only an explicit user-selected intent can grant Review Revision mutation authority; message wording, model output, or provider thread state cannot broaden a Read-only Conversation turn.
- **INV-02:** Read-only Conversation turns cannot mutate files, run publication, authorize mutation, or consume the worktree-mutating budget; their structured answer is never implementation or publication authority.
- **INV-03:** F21 persists intent and immutable input/configuration snapshots before the represented F15/F17 effect, and the main process/F03 records remain authoritative over renderer memory and provider thread state.
- **INV-04:** F15 is the only provider boundary, F17 is the only bounded mutating-work controller, F13 is the only Git/worktree truth owner, F14 is the only validation truth owner, and F18 is the only Review Bundle finalization/hold owner.
- **INV-05:** Manual and AI changes are never silently discarded, reset, replaced, or overwritten; unsafe attribution or overlap blocks mutation or routes an explicit owning-workflow decision.
- **INV-06:** Every mutating revision is followed by fresh F13 actual-state/diff evidence and applicable F14 validation evidence before F18 can expose the refreshed bundle as reviewable.
- **INV-07:** Profile, policy, Common Instructions, Build & Validation, PR Intent / Context, bundle, worktree, remote-SHA, conversation, and turn snapshots are immutable for the turn/result that references them; later settings affect only an explicitly new turn.
- **INV-08:** F21 never automatically retries, resumes a provider thread, continues a stopped operation, resets a budget, or changes a task/policy snapshot after timeout, cancellation, failure, restart, or uncertainty.
- **INV-09:** Conversation content, provider claims, F13 Git evidence, F14 validation evidence, F17 reports/progress, and F18 bundle state remain separate authorities and are never collapsed into one prose status.
- **INV-10:** F21 exposes no commit, push, response-posting, conversation-resolution, review-approval, merge, force-push, or publication authority to an AI provider or renderer.

## Out of Scope

- Initial automatic Review Proposal, feedback eligibility, per-PR holds, and proposal/final bundle state transitions owned by F10-F12 and F18.
- General Review Bundle workspace shell, complete diff rendering, native routing, and final visual accessibility treatment owned by F19/F20.
- Provider SDK implementation, provider authentication, structured-output normalization, and provider-specific event mapping owned by F15.
- Task-profile, policy, Common Instruction, Build & Validation, and PR Intent / Context source settings owned by F16/F00/F07.
- AI Work Operation budgets, timeouts, deterministic progress, stop reasons, continuation authorization, and usage aggregation owned by F17.
- Git commands, worktree creation/cleanup, attribution, current-state inspection, and diff generation owned by F13; validation execution owned by F14.
- Discard, stale re-evaluation, dirty-worktree clear choices, and automatic review replacement owned by F22.
- Commit, push, GitHub response posting, conversation resolution, review approval, merge, force push, and publication reconciliation owned by F23 and later features.
- Per-hunk patch acceptance, direct code editing in the Review Bundle UI, blind `ours`/`theirs` resolution, arbitrary shell commands, autonomous publication, and automatic resume/retry.

## Product Decisions

- **PD-01: Explicit mode prevents accidental mutation** - The conversation composer has separate **Ask / clarify** and **Revise worktree** intents. F21 does not infer mutation authority from natural-language text.
- **PD-02: Conversation answers are not automatic item answers** - A provider answer may be explicitly applied to a selected question item, but it never satisfies the required textbox or implementation gate by itself.
- **PD-03: Every explicit turn gets a reproducible snapshot** - A read-only turn or mutating revision records the effective profile, policy, Common Instructions, Build & Validation, applicable PR Intent / Context, bundle revision, and worktree/evidence references used for that turn.
- **PD-04: Revision works on the current preserved worktree** - F21 never reconstructs or silently replaces the worktree before a revision. A user may explicitly acknowledge un-attributed changes; mixed/overlapping or stale/unknown evidence requires F13/F22 handling.
- **PD-05: Review Revision is the path for requested changes** - Code, tests, assessments, and proposed-reply revisions use the Review Revision task profile and F17 bounded mutating-work contract even when a particular turn produces no code change.
- **PD-06: Refresh is evidence-first** - A revision is not complete merely because the provider reports completion. F13 actual state and F14 actual validation must be refreshed before F18 commits the new reviewable aggregate.
- **PD-07: Publication remains a separate approval** - Conversation, question answers, revision decisions, response drafts, and refreshed diffs never post, commit, push, resolve, or publish anything.
- **PD-08: One active mutating revision per bundle** - A bundle worktree cannot be shared by competing Review Revision turns; duplicate requests return the existing durable result or a typed conflict.

## Implementation Decisions

- **IMP-01: Use discriminated main-process intents** - `READ_ONLY_CONVERSATION`, `REVIEW_REVISION`, `APPLY_QUESTION_ANSWER`, and `SAVE_ENTRY_INSTRUCTION` are separate typed commands with bundle/item/evidence revisions and bounded payloads.
- **IMP-02: Use F16 for every new turn** - F21 requests the declared task type from F16 and passes the resulting immutable snapshot to F17/F15. It never reads mutable Preferences directly or constructs provider/model/policy values in a prompt.
- **IMP-03: Reuse F17 for both modes** - F17 supplies bounded read-only lifecycle/reporting and mutating operation/segment/continuation semantics; F21 does not add a second budget or retry loop.
- **IMP-04: Use F13 WorktreeCondition as the mutation gate** - F21 consumes fresh condition, fingerprint, revision, attribution, overlap, and permitted-action evidence and does not classify manual ownership in the renderer.
- **IMP-05: Finalize through F18** - F21 sends valid revision results plus fresh F13/F14/F17 evidence to F18's atomic finalization boundary; F21 does not update Review Bundle state through ad hoc persistence.
- **IMP-06: Keep provider thread state opaque** - A stored conversation reference is an optional F15 execution-context input. F21 may reuse it only after provider/task/policy compatibility validation and explicit user action.
- **IMP-07: Stream safe projections only** - The renderer receives bounded normalized progress and committed conversation/revision read models, never SDK events, process handles, raw prompts, credentials, or uncontrolled output.
- **IMP-08: Preserve semantic drafts separately from Git truth** - Assessment/reply changes are stored as bounded revision/draft evidence, while F13 diffs and F14 validation remain independent authoritative records.

## Testing Decisions

- **TST-01: Test intent routing as a safety boundary** - Contract tests prove that read-only and mutating modes use the correct task type, profile, policy floor, output contract, and capability set without classifying from message text.
- **TST-02: Use deterministic fakes** - F03/F13/F14/F15/F16/F17/F18/F20 ports, fake clocks, fake providers, temporary repositories, and temporary worktrees cover the feature without live credentials, GitHub, network, or the developer clone.
- **TST-03: Fault-test persist-before-effect and restart** - Inject faults before and after message/turn intent, provider terminal result, F13 refresh, F14 validation, and F18 finalization commits; prove no duplicate turn, false success, or budget reset.
- **TST-04: Test manual-edit and overlap evidence deeply** - Cover clean, AI-attributed-only, un-attributed, mixed/overlap, stale/unknown, manual edits, build/test-created files, untracked, binary, rename, deletion, and provider-claim mismatch cases.
- **TST-05: Test bounded work through F17** - Verify timeout, cancellation, one-turn consumption, repeated state, no progress, continuation, exhausted-budget new operation, usage, reports, and no automatic retry using F17 conformance fixtures rather than a second F21 implementation.
- **TST-06: Test structured semantic updates** - Cover valid and invalid read-only/revision results, item-scope mismatch, no-code semantic completion, assessment/reply draft updates, question-answer separation, and preservation of original history.
- **TST-07: Test accessibility semantics, not only pixels** - Verify keyboard focus, accessible names, required-field errors, forced-colors/non-color states, reduced motion, narrow widths, long bounded transcripts, and streaming/cancel/attention announcements through F20-compatible fixtures.
- **TST-08: Prove the negative authority boundary** - Static and runtime scans prove no SDK import, credential, arbitrary path, arbitrary command, GitHub transport, publication method, raw provider event, or renderer-owned state reaches F21's public contracts.

## Proposed Modules

- **MOD-01: Conversation and Revision Intent Gateway** - Validates explicit mode, target, bundle/item/evidence revisions, bounds, and permitted action capabilities.
- **MOD-02: Proposal Entry Input Coordinator** - Saves per-entry instructions and explicit question answers through F18's decision contract and exposes completeness results.
- **MOD-03: Conversation Context and Snapshot Builder** - Combines immutable bundle context with the F16 snapshot and selected item scope for each turn.
- **MOD-04: Read-only Conversation Runner** - Persists, invokes, streams, cancels, and finalizes bounded Read-only Conversation turns through F17/F15.
- **MOD-05: Review Revision Coordinator** - Admits explicit Review Revision work after decision gates and supplies final human intent to F17/F15.
- **MOD-06: Worktree Condition Gate** - Revalidates F13 owner/path/state before and after mutation and routes unsafe conditions to inspection or F22.
- **MOD-07: Revision Evidence Refresher** - Requests F13 diffs/snapshots and F14 validation, separates deterministic evidence from provider claims, and maps no-code outcomes.
- **MOD-08: Conversation/Revision Read Model** - Projects bounded transcript, turn, usage, report, snapshot, worktree, validation, reason, and next-action data to F20.
- **MOD-09: F18 Finalization Adapter** - Sends one typed aggregate update to F18 and receives the committed bundle revision or a safe refusal.

## Workflows

### Workflow 1: Add proposal inputs and ask a read-only question

```text
1. F20 opens the proposal bundle and F21 loads the current F18 item/decision
   revision.
2. The developer enters a per-entry instruction or required question answer, or
   selects Ask / clarify with a bundle/item target.
3. F21 validates the bounded input and expected revision. An explicit Use as
   answer action is required before conversation text can satisfy a question.
4. For a read-only message, F21 requests the current F16 Read-only Conversation
   snapshot, persists the conversation intent, and starts one F17/F15 read-only
   turn.
5. Safe progress and the structured answer are streamed/projected to F20; the
   proposal decision gate remains controlled by F18.
```

### Workflow 2: Start a Review Revision after human decisions

```text
1. The developer completes every F18 accept/override decision and effective
   question answer, then explicitly chooses Revise worktree.
2. F21 revalidates the bundle revision, action capability, PR hold, and F13
   WorktreeCondition.
3. If the condition is unsafe, F21 preserves the worktree and routes inspection
   or the F22 choice; it does not clean or replace anything.
4. F16 resolves the current Review Revision profile/policy/context snapshot and
   F17 commits the bounded operation/segment/turn intent before F15 starts.
5. F15 runs in the exact F13 worktree with only the authorized local policy.
6. F17 records the turn report and progress. F13 refreshes actual snapshots and
   diffs, and F14 runs applicable post-change validation.
7. F21 sends the valid semantic result and deterministic evidence to F18, which
   commits FINAL_REVIEW/READY_FOR_REVIEW or NEEDS_ATTENTION.
```

### Workflow 3: Revise an existing final bundle

```text
1. The developer opens the final bundle and chooses Revise worktree with a
   bounded request to change code, tests, an assessment, or a proposed reply.
2. F21 loads current reports, snapshots, responses, worktree condition, and
   action capabilities without treating the renderer as authoritative.
3. F21 starts one explicitly authorized Review Revision turn through F17/F15.
4. After the turn, F21 refreshes the actual worktree/diff/validation evidence and
   preserves prior conversation, revision, and response history.
5. F18 commits a new reviewable aggregate. F23 remains the only publication path.
```

### Workflow 4: Stop, reopen, and explicitly continue

```text
1. F17 stops a revision for timeout, cancellation, provider failure, repeated
   state, no progress, policy refusal, or uncertain evidence.
2. F21 preserves the worktree and maps the reason to NEEDS_ATTENTION with the
   complete reports, usage, remaining issues, and permitted action.
3. After renderer closure or restart, the main process reads the same durable
   records; it does not resume the provider thread or start a replacement.
4. The developer explicitly chooses Continue AI Work. F17 validates a one-time
   authorization and starts only a bounded continuation with preserved history;
   an exhausted parent requires a separately confirmed new operation.
5. The next terminal outcome again refreshes F13/F14 evidence before F18 commit.
```

## Contract-Test Criteria

- **CT-F21-01:** Intent fixtures cover Ask / clarify, Revise worktree, Apply question answer, and Save entry instruction; exact target scope, evidence revisions, bounds, permitted actions, duplicate commands, and no-effect opening are enforced.
- **CT-F21-02:** Proposal-input fixtures cover every disposition, required question answers, explicit Use as answer, per-entry instructions, superseded answers, stale/duplicate writes, over-limit values, and F18-only decision authority.
- **CT-F21-03:** Read-only conversation fixtures cover F16 snapshot inclusion, Read-only policy floor, Common Instructions, Build & Validation/PR context, F15 structured result, safe streaming, cancellation, timeout, usage/reference metadata, zero mutating-budget consumption, and no worktree change.
- **CT-F21-04:** Routing fixtures prove message wording cannot switch modes, Read-only Conversation and Review Revision use distinct profiles/output contracts, incompatible provider references fail safely, and no ad hoc provider/model/policy construction exists.
- **CT-F21-05:** Revision-admission fixtures cover incomplete proposal decisions, unanswered questions, final-stage permissions, fixed versus non-code dispositions, persist-before-F15, duplicate requests, active-operation uniqueness, and exact human-input snapshots.
- **CT-F21-06:** Worktree-condition fixtures cover clean, AI-attributed-only, un-attributed with confirmation, mixed/overlap, stale/unknown, manual edits, build/test churn, untracked, binary, rename, and deletion states; unsafe states do not mutate or clear the worktree.
- **CT-F21-07:** Revision-turn fixtures cover code/test edits, assessment/reply changes, no-code semantic completion, before/after F13 evidence, actual-vs-claimed files/commands, F14 post-change pass/fail/not-run/interrupted results, and F18 finalization.
- **CT-F21-08:** F17 conformance fixtures cover one-turn budget use, timeout, cancellation, provider failure, repeated state, no progress, reports, usage, Continue AI Work, exhausted-budget new operation, no auto-retry, and restart reconciliation.
- **CT-F21-09:** Snapshot/history fixtures cover changed Preferences/Common Instructions/Build & Validation/PR Intent, old-bundle immutability, new-turn snapshots, opaque provider reference compatibility, transcript/history preservation, and cumulative evidence.
- **CT-F21-10:** Boundary/accessibility fixtures cover main-process ownership, renderer replacement, keyboard/screen-reader/forced-colors/reduced-motion/narrow-width behavior, bounded/redacted projections, no SDK/credential/arbitrary-path/publication capability, and two-PR isolation.

## Requirement Traceability

| Requirement family | Observable acceptance criteria | Named contract-test criteria |
|---|---|---|
| FR-01 | AC-01-AC-02, AC-22-AC-24 | CT-F21-01, CT-F21-04, CT-F21-10 |
| FR-02 | AC-05-AC-08, AC-22-AC-24 | CT-F21-01, CT-F21-02, CT-F21-10 |
| FR-03 | AC-02-AC-04, AC-19, AC-21, AC-24 | CT-F21-03, CT-F21-04, CT-F21-09, CT-F21-10 |
| FR-04 | AC-08-AC-12, AC-19-AC-22, AC-24 | CT-F21-04, CT-F21-05, CT-F21-08, CT-F21-10 |
| FR-05 | AC-10-AC-14, AC-22, AC-24 | CT-F21-06, CT-F21-07, CT-F21-10 |
| FR-06 | AC-14-AC-18, AC-22, AC-24 | CT-F21-06, CT-F21-07, CT-F21-09 |
| FR-07 | AC-04, AC-12-AC-14, AC-20-AC-22 | CT-F21-03, CT-F21-08, CT-F21-09 |
| FR-08 | AC-03-AC-04, AC-12-AC-17, AC-19-AC-23 | CT-F21-03, CT-F21-07, CT-F21-09, CT-F21-10 |
| FR-09 | AC-02-AC-04, AC-09-AC-11, AC-21, AC-24 | CT-F21-04, CT-F21-06, CT-F21-10 |
| NFR-01-NFR-08 | AC-01-AC-04, AC-10-AC-24 | CT-F21-01-CT-F21-10 |
| INV-01-INV-10 | AC-02-AC-04, AC-08-AC-24 | CT-F21-01-CT-F21-10 |

