<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends
through all levels: database, logic, UI (as applicable). This is as opposed to
a horizontal layer, which addresses only a single level. The goal of vertical
layers is to provide the AI and the user with a visible and testable result
when the work is complete.
-->

# Plan: F21 Read-only Conversation and Worktree-mutating Review Revisions

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** `Specs/read_only_conversation_and_worktree_mutating_review_revisions_PRD.md`
>
> **Last revalidated against:** `Specs/application_overview.md` revision 2026-09-25, F15-F20 contracts, F21 checklist item, and the owning PRD revision 2026-09-26
>
> **Entry/readiness gates:** F03 exposes bounded conversation/turn/revision repositories, expected-version writes, commit-before-effect transactions, and restart-safe records. F13 exposes the Review Bundle worktree, fresh `WorktreeCondition`, before/after snapshots, authoritative proposed/context diffs, and safe path evidence. F14 exposes phase-aware post-change validation. F15 exposes `READ_ONLY_CONVERSATION` and `REVIEW_REVISION` contracts, streaming, structured results, cancellation, usage, and opaque conversation references. F16 exposes immutable task/profile/policy/Common Instruction/Build & Validation/PR Intent snapshots. F17 exposes bounded read-only and mutating turn lifecycle, budgets, reports, progress, stop reasons, and continuation authorization. F18 exposes proposal decision/question/instruction commands and atomic final bundle finalization. F20 exposes the Review Bundle workspace/action gate and accessible renderer seams. The desktop test harness supports fake providers, temporary worktrees, restart/fault fixtures, and Windows accessibility probes. `npm run check` is green and the semantic specification linter can run without credentials in fixtures or evidence.
>
> This PLAN cannot change product requirements. Resolve contradictions in the
> owning PRD before implementation and rerun both specification linters. This
> feature does not check the checklist item; implementation and approval are
> separate.

## Implementation Boundary

F21 implements the main-process workflow for two explicit user-directed Review
Bundle actions: a bounded, read-only conversation and a bounded, worktree-
mutating Review Revision. It owns the intent/target gate, proposal-stage
instruction and question-answer handoff, conversation/revision orchestration,
pre-turn worktree-condition checks, result association, evidence refresh
coordination, and the downstream handoff to F18/F20.

F03 remains authoritative for SQLite, migrations, transactions, expected
revisions, immutable records, and restart recovery. F13 remains authoritative
for canonical worktree ownership, current Git state, snapshots, attribution,
overlap, and diff content. F14 remains authoritative for command execution and
validation status. F15 remains the only provider boundary. F16 resolves the
effective immutable task/context snapshot. F17 owns budgets, timeouts, reports,
progress, stop reasons, and explicit continuation. F18 owns item decisions,
question completeness, Review Bundle state/stage, hold retention, and atomic
finalization. F20 owns the general workspace shell and accessible visual
presentation. F22 owns stale/discard/re-evaluate/dirty-worktree choices, and
F23 owns publication.

F21 must not import a provider SDK, run Git or validation commands, create or
clean worktrees, infer mutation authority from prose, maintain a second budget
or state machine, or perform any remote publication effect.

### Provider-neutral handoff shapes

| Contract | Required meaning |
|---|---|
| `ReviewUserIntent` | Explicit mode (`READ_ONLY_CONVERSATION` or `REVIEW_REVISION`), bundle/item scope, expected bundle/item/evidence revision, bounded user text, and one-time command identity. |
| `ProposalEntryInputCommand` | Item identity, decision revision, bounded instruction or explicit question answer, whether a conversation answer is being applied, and expected read-model revision. |
| `ReviewConversationTurnRecord` | Message identity, bundle/item scope, immutable F16 snapshot reference, F15/F17 turn identity, bounded transcript/progress/result status, usage/reference metadata, and terminal reason. |
| `ReviewRevisionRequest` | Final F18 decisions, effective answers/instructions, selected user request, immutable bundle context, current F13 worktree reference, F16 Review Revision snapshot, F17 predicate, and expected evidence revision. |
| `ReviewRevisionOutcome` | F15 structured semantic result, F17 reports/progress/stop data, F13 before/after condition and diff references, F14 validation evidence, and an F18 finalization request/result. |
| `ReviewConversationReadModel` | Bounded ordered turns/messages, mode and target labels, profile/policy metadata, usage, worktree condition, bundle revision, required fields, reason, and permitted next actions; no SDK objects or effect capabilities. |

### Mode and worktree-condition rules

The composer exposes two explicit modes. **Ask / clarify** resolves the
`READ_ONLY_CONVERSATION` task and always receives a read-only policy floor.
**Revise worktree** resolves `REVIEW_REVISION` and enters F17's mutating work
controller. The message itself is never used to select the mode.

Before a Review Revision, F21 requests a fresh F13 condition. `CLEAN` and
`AI_ATTRIBUTED_ONLY` may proceed when the current action capability permits it.
`UNATTRIBUTED_CHANGES` requires a recorded user acknowledgement that the
existing worktree is preserved/included. `MIXED_OR_OVERLAP` and
`STALE_OR_UNKNOWN` block mutation and route to inspection or F22; F21 never
clears or replaces the worktree.

## Readiness Gates

- F03 has versioned, bounded records for user intents, conversation messages and turns, revision intents/results, snapshot references, expected revisions, and idempotency keys. A committed intent can be read after renderer closure or process restart.
- F13 can return the current owner, canonical worktree path, HEAD/revision, `WorktreeCondition`, before/after turn snapshots, proposed-worktree diff, PR-context diff, and permitted actions without treating provider claims as Git truth.
- F14 can run or explicitly record post-change `passed`, `failed`, `not_run`, and `interrupted` evidence against the current F13 worktree revision.
- F15 can admit and normalize both F21 task types, validate structured results, stream bounded events, expose usage and opaque references, and cancel without automatic retry.
- F16 can resolve a new immutable snapshot for each explicitly authorized conversation/revision turn, including Common Instructions, Build & Validation, and applicable PR Intent / Context.
- F17 can persist read-only and mutating turns, enforce timeouts and budgets, assemble reports, classify progress, preserve history, and authorize continuation without a second consumer policy.
- F18 can accept bounded per-entry instructions/question answers and atomically finalize a refreshed Review Bundle without losing prior decisions, responses, conversations, or evidence.
- F20 can render the current workspace read model, route typed actions, show streaming/attention/continuation states, and preserve accessible focus through renderer replacement.
- Test fixtures can inject manual edits, build/test churn, overlap, stale HEAD, provider failure, timeout, cancellation, persistence failure, uncertain outcomes, duplicate commands, and changed Preferences without real credentials or GitHub effects.

## Proposed Vertical Slices

1. **Versioned user intents, proposal inputs, and safe read-model boundary**
   - **Blocked by:** F03 bounded repositories/transactions, F18 item decision and finalization ports, F20 workspace action capabilities, F04 validated IPC, and the shared F16/F17/F15 schemas.
   - **Stories / requirements / acceptance criteria:** US-01-US-04, FR-01.1-FR-02.5, FR-08.1-FR-09.4; NFR-01-NFR-04, NFR-06-NFR-08; INV-01-INV-04, INV-07-INV-10; AC-01-AC-08, AC-22-AC-24; CT-F21-01, CT-F21-02, CT-F21-10.
   - **Implementation:** Define the discriminated intent, target, expected-revision, proposal-entry, conversation-turn, and bounded read-model schemas. Add main-process commands and action capabilities for opening, drafting, saving an instruction, applying a question answer, starting a read-only turn, and requesting a revision. Make duplicate/equal requests idempotent and stale requests refreshable. Build the two-mode composer and proposal-entry field handoff against fakes without starting a provider.
   - **Visible result:** F20 shows separate Ask / clarify and Revise worktree choices, item-scoped fields, required-answer status, target scope, current evidence revision, and safe disabled reasons. Opening or drafting never creates AI/Git/validation/publication work.
   - **Durable records / external effects:** F03 stores only bounded user intent and proposal-input records through F18/F21 contracts. No provider, worktree, validation, GitHub, or publication effect is allowed in this slice.
   - **Failure / cancellation / restart:** Unknown mode, missing scope, stale revision, duplicate identity, over-limit value, secret-shaped text, persistence failure, renderer closure, or process restart yields a typed non-success or existing result with no partial decision. A cancelled write creates no success marker.
   - **Exact evidence:** Intent schema/unknown-key/bound corpus; mode/target/action matrix; proposal input and question-answer revision table; duplicate/stale writer race; renderer-close/restart readback; accessible names/focus/errors; raw path/credential/SDK/publication scan; CT-F21-01, CT-F21-02, and CT-F21-10.
   - **Exit criterion:** AC-01-AC-08 and AC-22-AC-24 pass, and later slices use one main-process intent/read-model boundary rather than renderer-owned state.

2. **Proposal-stage instructions, question answers, and explicit revision gate**
   - **Blocked by:** Slice 1, F18 decision/question contracts, F16 bounds, and F20 proposal-stage controls.
   - **Stories / requirements / acceptance criteria:** US-03-US-04; FR-02.1-FR-02.5, FR-04.2-FR-04.4; NFR-01-NFR-04, NFR-06; INV-01, INV-03, INV-07, INV-10; AC-05-AC-09, AC-22-AC-24; CT-F21-01, CT-F21-02, CT-F21-05, CT-F21-10.
   - **Implementation:** Extend the F20 proposal surface with per-entry instruction and required question-answer interactions. Delegate writes to F18 with item/decision revisions. Add explicit Use as answer behavior for conversation text and a deterministic completeness projection. Make Revise worktree unavailable until every item has an accepted/overridden decision and every effective question answer is valid.
   - **Visible result:** A developer can add bounded instructions, answer questions, see superseded/remaining fields, and understand exactly why a revision is blocked or permitted. Chat content never silently satisfies an item.
   - **Durable records / external effects:** F18 commits the authoritative decision/input revision; F21 stores only typed command/evidence association. No provider or worktree effect occurs until the explicit revision gate passes.
   - **Failure / cancellation / restart:** Stale item revision, duplicate save, override-away-from-question, missing answer, over-limit text, process restart, or renderer replacement preserves prior committed decisions and leaves incomplete items blocked. No hold is released.
   - **Exact evidence:** All dispositions and answer-required truth table; Use as answer separation; supersession/idempotency/stale races; no-provider/no-worktree spy; restart readback; keyboard/screen-reader/forced-colors form report; CT-F21-01, CT-F21-02, CT-F21-05, and CT-F21-10.
   - **Exit criterion:** AC-05-AC-09 and AC-22-AC-24 pass, and F18 remains the sole authority for implementation eligibility.

3. **Read-only Conversation end-to-end turn**
   - **Blocked by:** Slices 1-2, F15 read-only/structured-output/streaming contracts, F16 snapshot resolver, F17 bounded read-only lifecycle, and F03 conversation persistence.
   - **Stories / requirements / acceptance criteria:** US-01-US-02, US-04; FR-03.1-FR-03.7, FR-08.1-FR-08.4, FR-09.1-FR-09.4; NFR-01-NFR-04, NFR-07-NFR-08; INV-01-INV-04, INV-07-INV-10; AC-01-AC-04, AC-07, AC-09, AC-12, AC-19, AC-21, AC-23-AC-24; CT-F21-03, CT-F21-04, CT-F21-09, CT-F21-10.
   - **Implementation:** Build the F21 read-only runner. Resolve the current F16 Read-only Conversation snapshot while retaining immutable bundle/item context, persist the message/turn intent, call F17/F15, project safe streaming events, validate `AIReadOnlyConversationResult`, store usage/reference metadata, and attach the terminal turn to the bundle conversation read model. Keep the worktree, Review Bundle decisions, validation, and publication state unchanged.
   - **Visible result:** The developer can ask a bounded question, see progress and the structured answer, inspect which profile/policy/instructions were used, and reopen the transcript after renderer closure or restart. The worktree-mutating budget remains unchanged.
   - **Durable records / external effects:** F03/F17 persist message, turn, snapshot, terminal result, usage, reference, and safe reason. The only external effect is the explicitly requested F15 read-only provider turn after durable intent; no Git/validation/publication effect is created.
   - **Failure / cancellation / restart:** Invalid capability, policy refusal, malformed result, timeout, cancellation, provider failure, stream over-limit, renderer closure, or restart yields one bounded terminal record and no automatic retry/resume. A compatible provider reference is reused only after explicit validation.
   - **Exact evidence:** Read-only policy and task-routing matrix; Common Instructions/Build & Validation/PR context snapshot table; F15 structured result corpus; stream/cancel/timeout/restart trace; zero mutating-budget and no-worktree-change spy; opaque-reference mismatch cases; usage/unavailable fields; CT-F21-03, CT-F21-04, CT-F21-09, and CT-F21-10.
   - **Exit criterion:** AC-01-AC-04, AC-09, AC-12, AC-19, AC-21, AC-23, and AC-24 pass with no mutation or publication capability reachable from the read-only path.

4. **Review Revision admission and first worktree-mutating turn**
   - **Blocked by:** Slice 2, F13 WorktreeCondition and before-turn snapshot contracts, F15 Review Revision structured output, F16 Review Revision snapshot, F17 mutating admission/budget, and F18 final-decision handoff.
   - **Stories / requirements / acceptance criteria:** US-05-US-07; FR-04.1-FR-05.6, FR-07.1-FR-07.2, FR-09.1-FR-09.4; NFR-01-NFR-03, NFR-05-NFR-08; INV-03-INV-06, INV-08-INV-10; AC-08-AC-13, AC-19-AC-22, AC-24; CT-F21-04, CT-F21-05, CT-F21-06, CT-F21-08, CT-F21-10.
   - **Implementation:** Add the explicit Revise worktree admission flow. Revalidate F18 stage/state/action capability and F13 owner/path/HEAD/condition. Require the un-attributed acknowledgement or route unsafe conditions to F22. Resolve and persist the F16 Review Revision snapshot; hand final decisions, answers, instructions, selected user request, and worktree reference to F17. Start exactly one Review Revision turn through F15 after intent commit, with F13 before/after snapshots and no publication capability.
   - **Visible result:** A developer can explicitly request code/test/assessment/reply changes, see the selected scope and immutable configuration before the turn, watch safe progress, and see the preserved worktree/report outcome afterward.
   - **Durable records / external effects:** F03/F17 persist operation/segment/turn intent and snapshots before the F15 effect. F13 records before/after worktree evidence. The provider may edit only the operation-owned worktree under the resolved policy; no commit, push, GitHub, or publication effect exists.
   - **Failure / cancellation / restart:** Incomplete decisions, stale bundle, unsafe condition, invalid snapshot/policy, duplicate admission, known pre-start refusal, uncertain start, timeout, cancellation, or provider failure preserves all history and worktree state. Known pre-start refusal consumes no turn; uncertain start follows F17 conservative accounting. Renderer closure does not cancel the main-process turn.
   - **Exact evidence:** Admission/state/action matrix; fixed/non-code decision input matrix; F13 condition and before/after snapshot trace; persist-before-F15 spy; exact profile/policy/worktree request; budget/timeout/cancellation/restart fault injection; no-publication/credential/arbitrary-path scan; CT-F21-04 through CT-F21-08 and CT-F21-10.
   - **Exit criterion:** AC-08-AC-13, AC-19-AC-22, and AC-24 pass, with no Review Revision provider call before a durable intent and no unsafe worktree replacement.

5. **Actual-state refresh, semantic revision results, and final Review Bundle handoff**
   - **Blocked by:** Slice 4, F13 actual diff/attribution contracts, F14 post-change validation, F17 completion/predicate/report handoff, F15 `AIReviewImplementation`, and F18 atomic finalization.
   - **Stories / requirements / acceptance criteria:** US-07; FR-04.3-FR-04.4, FR-05.4-FR-05.6, FR-06.1-FR-06.6, FR-08.3-FR-08.5; NFR-01-NFR-05, NFR-08; INV-04-INV-06, INV-09-INV-10; AC-14-AC-18, AC-22, AC-24; CT-F21-06, CT-F21-07, CT-F21-09, CT-F21-10.
   - **Implementation:** Assemble the terminal revision outcome from F15 structured semantic data, F17 reports/progress, F13 fresh condition/snapshots/proposed/context diffs, and F14 current post-change evidence. Reject provider claims that are not supported by deterministic state. Preserve original and prior assessment/reply drafts, persist valid semantic updates by item identity, and send one atomic refresh request to F18. Project `FINAL_REVIEW`/`READY_FOR_REVIEW` or `NEEDS_ATTENTION` to F20 with explicit evidence authority labels.
   - **Visible result:** After a revision, the developer sees the actual complete proposed-worktree diff, contextual PR diff, current validation result, updated assessment/reply drafts, AI report, usage, and a clear ready/attention outcome. A valid no-code semantic revision remains reviewable without a fabricated code change.
   - **Durable records / external effects:** F03/F18 persist the new bundle/read-model revision, semantic draft/result revision, F13 diff/snapshot references, F14 validation run, F17 report/usage, and reason. No remote response, commit, push, or publication effect occurs.
   - **Failure / cancellation / restart:** Missing/stale/contradictory F13/F14 evidence, invalid item scope, malformed structured result, failed validation, overlap, persistence uncertainty, or finalization failure preserves the last committed bundle and worktree and yields a bounded attention/reconciliation result. No stale validation pass is carried forward.
   - **Exact evidence:** Actual-vs-claimed file/command table; proposed/context SHA and diff authority matrix; code/test/assessment/reply/no-code result corpus; F14 pass/fail/not-run/interrupted phase matrix; F18 atomic finalization and draft-history readback; model-claim negative tests; CT-F21-06, CT-F21-07, CT-F21-09, and CT-F21-10.
   - **Exit criterion:** AC-14-AC-18, AC-22, and AC-24 pass, and F18 can commit a truthful refreshed bundle without F21 creating a competing Review Bundle state machine.

6. **Bounded stops, continuation, renderer replacement, and restart recovery**
   - **Blocked by:** Slices 3-5, F17 continuation/read-model contracts, F04 main-process lifecycle, F03 reconciliation, and F22/F23 consumer action fakes.
   - **Stories / requirements / acceptance criteria:** US-08-US-09; FR-03.6, FR-07.1-FR-08.5; NFR-02-NFR-08; INV-03, INV-07-INV-10; AC-04, AC-12-AC-14, AC-19-AC-23; CT-F21-03, CT-F21-08, CT-F21-09, CT-F21-10.
   - **Implementation:** Wire F17 stop reasons and complete turn reports into F21's conversation/revision read model. Add the explicit Continue AI Work action, displayed-history revision, remaining-budget summary, one-time authorization, and exhausted-budget new-parent route. Add startup reconciliation and renderer replacement handling that rehydrates committed data without provider resume or automatic retry. Route dirty/stale conditions to F22 and final publication preconditions to F23.
   - **Visible result:** A stopped revision opens as a persistent attention result showing every turn, approach/problems/remaining issues, actual files/commands, validation, progress/fingerprint, usage, preserved worktree, and the only permitted next action. A valid continuation preserves history and budget; an exhausted operation asks for a new budget.
   - **Durable records / external effects:** F03/F17 persist reports, usage, stop/recovery reason, authorization, segment/new-parent link, and F18 outcome. Only a valid explicit authorization can cause another F15 turn.
   - **Failure / cancellation / restart:** Duplicate/stale continuation, renderer close, process stop, uncertain provider/inspection/validation result, changed policy, or persistence failure cannot reset history, start a duplicate, broaden scope, or turn uncertainty into success. A cancelled authorization leaves no provider effect.
   - **Exact evidence:** Stop-reason/action matrix; full report and usage readback; continuation-before-exhaustion and new-parent-after-exhaustion table; stale/duplicate authorization races; crash/restart at every intent/result/finalization boundary; no-auto-resume/no-budget-reset trace; F22/F23 typed-consumer negative authority scan; CT-F21-03, CT-F21-08, CT-F21-09, and CT-F21-10.
   - **Exit criterion:** AC-04, AC-12-AC-14, AC-19-AC-23 pass and every path to more AI work is explicit, bounded, durable, and reviewable.

7. **Cross-feature conformance and implementation handoff**
   - **Blocked by:** Slices 1-6, final F03/F13/F14/F15/F16/F17/F18/F20 contracts, downstream F22/F23 fakes, and the repository check/linter commands.
   - **Stories / requirements / acceptance criteria:** US-01-US-09; all FRs, NFRs, and INVs; APP-AC-22, APP-AC-33, APP-AC-39, APP-AC-41-APP-AC-42, APP-AC-55-APP-AC-62, APP-AC-64, APP-AC-67, APP-AC-74; AC-01-AC-24; CT-F21-01-CT-F21-10.
   - **Implementation:** Run the same conformance suite through read-only conversation, proposal-input, first Review Revision, final-bundle revision, no-code semantic revision, stopped/continued revision, and restart fixtures. Verify F16 snapshot inclusion, F15-only invocation, F17 budget/timeout/report authority, F13/F14 actual-state authority, F18 atomic finalization, F20 accessibility/action routing, and F22/F23 capability isolation. Keep conversation/revision records provider-neutral and publication-free.
   - **Visible result:** One evidence report demonstrates a developer can ask, answer, instruct, revise, inspect, recover, and return to a reviewable bundle without accidental worktree loss or remote publication.
   - **Durable records / external effects:** Uses test-owned application data, fake providers, temporary worktrees, deterministic validation fixtures, fake OS/UI adapters, and bounded evidence. It does not use live credentials, GitHub, a live model, publication, or the developer clone, and it does not edit `checklist.md`.
   - **Failure / cancellation / restart:** Any mode misrouting, false read-only mutation, hidden question satisfaction, budget reset, duplicate provider turn, stale diff, false validation pass, manual-change loss, raw secret/SDK leak, arbitrary path, inaccessible control, invalid mapping, or definite specification-linter miss blocks the gate. A cancelled run leaves no success marker and can be rerun from clean fixtures.
   - **Exact evidence:** `npm run check`; F21 unit/contract/integration report; intent and proposal-input report; read-only routing/stream/restart report; revision admission/worktree-condition report; F13/F14 actual-state refresh report; F17 bounded-work/continuation report; accessibility/forced-colors/reduced-motion/narrow-width report; secret/SDK/arbitrary-path/publication scan; `git diff --check`; `npm run lint:prd-plan -- Specs/read_only_conversation_and_worktree_mutating_review_revisions_PRD.md Specs/read_only_conversation_and_worktree_mutating_review_revisions_PLAN.md`; `npm run lint:application-coverage -- Specs/application_overview.md Specs/read_only_conversation_and_worktree_mutating_review_revisions_PRD.md`.
   - **Exit criterion:** All F21 requirements have direct acceptance or named contract-test evidence, mapped application criteria have no definite missing/invalid result, both specification linters have been run against the final pair, and F21 remains unchecked pending implementation approval and completion.

## Cross-Slice Verification and Handoff

- F03 remains the only owner of migrations, transactions, optimistic concurrency, durable conversation/revision records, and restart-safe repository mechanics. F21 supplies typed intent and finalization requests and never treats an in-memory transcript or activity row as authoritative.
- F13 remains authoritative for operation-worktree ownership, current HEAD, actual file state, before/after turn snapshots, attribution/overlap, `WorktreeCondition`, proposed-worktree diff, PR-context diff, and safe path evidence. F21 consumes fresh evidence and never clears, resets, replaces, or infers manual ownership.
- F14 remains authoritative for validation admission and real status. F21 requests applicable post-change evidence and preserves `not_run`, failed, interrupted, and stale outcomes rather than interpreting provider prose as a pass.
- F15 remains the only provider invocation boundary. F21 supplies declared task types and immutable snapshots, consumes normalized results/events, and never imports `@openai/codex-sdk` or provider-specific objects.
- F16 remains authoritative for current task profiles, policy floors, Common Instructions, Build & Validation, PR Intent / Context, bounds, and future-only snapshot semantics. F21 resolves one snapshot per explicit turn and never reconstructs it from the renderer or activity text.
- F17 remains authoritative for AI Work Operation/segment/turn lifecycle, budgets, timeout, cancellation, reports, progress, stop reasons, usage, and continuation/new-operation authorization. F21 routes actions and maps outcomes but never implements a retry or budget policy.
- F18 remains authoritative for item decisions, required-question completeness, Review Bundle stage/state, per-PR hold, and atomic finalization. F21 never creates a parallel bundle state machine or silently releases a hold.
- F20 remains authoritative for the overall workspace, accessible presentation, complete diff viewer, and typed downstream action surface. F21 supplies the conversation/revision projection and action contracts.
- F22 owns stale/discard/re-evaluate and dirty-worktree clear choices; F23 owns publication and final revalidation. F21 routes typed evidence/capabilities and never grants their effects.
- The application-coverage decisions are explicit: F21 is primary for APP-AC-22; shared for APP-AC-33, APP-AC-39, APP-AC-41, APP-AC-42, APP-AC-55-APP-AC-62, APP-AC-64, APP-AC-67, and APP-AC-74; and not the full owner of item decisions, worktree cleanup, stale re-evaluation, diff presentation, or publication.
- The F21 checklist item remains unchecked. These documents create no application code, do not change `checklist.md`, and do not claim that conversation, review revisions, bounded continuation, or refreshed Review Bundle evidence is implemented.

## Requirement-to-Slice Trace

| Requirement family | Owning slices |
|---|---|
| FR-01 | 1, 7 |
| FR-02 | 1-2, 7 |
| FR-03 | 1, 3, 6-7 |
| FR-04 | 2, 4-5, 7 |
| FR-05 | 4-6, 7 |
| FR-06 | 5-7 |
| FR-07 | 3-4, 6-7 |
| FR-08 | 1, 3, 5-7 |
| FR-09 | 1, 3-7 |
| NFR-01-NFR-08 | 1-7 |
| INV-01-INV-10 | 1-7 |
| APP-AC-22 | 1-7 |
| APP-AC-33, APP-AC-39, APP-AC-41-APP-AC-42 | 2-7 |
| APP-AC-55-APP-AC-62 | 3-7 |
| APP-AC-64, APP-AC-67, APP-AC-74 | 3-7 |

