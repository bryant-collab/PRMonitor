<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single level. The goal is to provide the AI and the user with a visible and testable result when the work is complete. This improves the reliability of AI's output by providing rapid feedback.
There might be slices that are needed to describe work that doesn't extend through a single level, that's fine, but the preference should be towards vertical slices.
-->

# Plan: F20 Review Bundle Workspace and Complete Diff Viewer

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** `Specs/review_bundle_workspace_and_complete_diff_viewer_PRD.md`
>
> **Last revalidated against:** `Specs/application_overview.md` revision 2026-09-25, F13-F19 PRDs/PLANs, and the F20 PRD above
>
> **Entry/readiness gates:** F18 exposes a committed, versioned proposal/final Review Bundle read model and typed decision/draft/action contracts. F13 exposes actual worktree inspection, immutable SHA/diff references, safe open/reveal, and manual-edit/stale evidence. F14 exposes phase-aware validation read models. F16 exposes immutable profile/policy/instruction snapshots. F17 exposes bounded reports, usage, progress/stop reasons, and continuation read models. F19/F04 expose validated navigation and renderer lifecycle. The desktop test harness supports deterministic renderer, IPC, accessibility, temporary worktree, and restart fixtures.
>
> This PLAN cannot change product requirements. Resolve contradictions in the owning PRD before implementation and rerun both specification linters. This feature does not check the checklist item; implementation and approval are separate.

## Implementation Boundary

F20 owns the renderer-facing Review Bundle workspace, the read-only projection
of committed Review Bundle evidence, proposal/final item navigation, typed
decision and response-draft interaction, diff-mode presentation, evidence
labels, state/action guidance, and accessible file/worktree actions.

F03/F18 remain authoritative for durable Review Bundle state, immutable event
associations, item decisions, response drafts, stage/state transitions, and
holds. F13 remains authoritative for worktree ownership, actual Git state,
three SHA identities, diff content, current-state refresh, and safe canonical
open/reveal requests. F14 remains authoritative for validation execution and
status. F16 owns effective profile/policy/instruction resolution and snapshots.
F17 owns AI operation/turn lifecycle, reports, usage, progress, and stop
reasons. F19/F04 own native routing and window lifecycle. F21 owns conversation
and worktree-mutating revisions; F22 owns discard/stale/re-evaluation and dirty
worktree choices; F23 owns publication.

F20 must not create a second state machine, parse raw Git/provider/activity
output as authoritative data, import a provider SDK, execute Git or validation
commands, accept arbitrary paths, or perform remote publication.

## Readiness Gates

- F18 has a stable workspace read model with explicit bundle/item/evidence
  revisions, proposal/final stage, primary state, deterministic reason, next
  actions, item decisions, question-answer status, response drafts, and
  persisted action capabilities.
- F13 has distinct proposed-worktree and PR-context diff contracts containing
  `prBaseSha`, `prHeadSha`, and `worktreeBaselineSha`, file/hunk identity,
  complete-diff/over-limit behavior, current-state inspection, a typed
  `WorktreeCondition` with attribution/overlap evidence, and safe worktree/file
  open/reveal ports.
- F14 has a renderer-safe validation projection with phase, exact command,
  working directory, status, exit evidence, manual status, warnings, and
  next-action data.
- F16 and F17 expose bounded immutable AI configuration, execution-policy,
  report, usage, stop-reason, and continuation projections without SDK types or
  credentials.
- F04/F19 expose validated route delivery, current-desktop window recreation,
  and renderer replacement semantics; F20 can be opened without a live prior
  renderer.
- The test harness can run keyboard/screen-reader semantic probes, forced-color
  and reduced-motion checks, narrow-width/long-diff fixtures, stale revisions,
  restart/readback, and two-PR isolation cases.

## Proposed Vertical Slices

1. **Versioned workspace read model, route entry, and stage/state shell**
   - **Blocked by:** F18 read-model/action contracts, F19/F04 route delivery, F03 expected-version reads, and the renderer shell.
   - **Stories / requirements / acceptance criteria:** US-01-US-02, US-08-US-09; FR-01.1-FR-01.5, FR-07.1-FR-07.4, FR-08.1-FR-08.4; NFR-01-NFR-03, NFR-06-NFR-08; INV-01, INV-07-INV-09; AC-01-AC-04, AC-21-AC-24; CT-F20-01, CT-F20-07, CT-F20-09.
   - **Implementation:** Add a main-process workspace query/command boundary and a renderer projection for PR reference, stage, state, reason, next actions, evidence revision, item summary, and safe action capabilities. Resolve deep-link/open routes through F04/F19, reload by bundle identity, and reject unknown or stale revisions. Keep loading, empty, unavailable, over-limit, and failure states explicit.
   - **Visible result:** Opening a proposal or final bundle from the inbox/notification shows a stable shell with stage/state guidance, item count, and permitted actions; closing/recreating the renderer shows the same committed projection.
   - **Durable records / external effects:** Reads F18/F03 projections and writes only typed owning-service intents where a command is explicitly selected. No AI, Git, validation, GitHub, publication, or worktree effect occurs on navigation or rendering.
   - **Failure / cancellation / restart:** Missing bundle, unknown schema, stale route, projection timeout, renderer closure, or restart produces a bounded error/reload path. Duplicate route delivery is idempotent. A failed read never creates a new Review Bundle or changes a hold.
   - **Exact evidence:** Read-model schema/unknown-field corpus; proposal/final/state matrix; route/restart/renderer-replacement trace; stale revision race; two-PR identity isolation; renderer-facing bound/redaction scan; CT-F20-01, CT-F20-07, CT-F20-09.
   - **Exit criterion:** AC-01-AC-04, AC-21-AC-24 pass, and all later slices consume one versioned workspace projection rather than individual persistence records.

2. **Proposal item navigation and explicit decision controls**
   - **Blocked by:** Slice 1, F18 item/decision contract, and the accessible form/control primitives.
   - **Stories / requirements / acceptance criteria:** US-02-US-04; FR-01.2, FR-02.1-FR-02.6, FR-07.2-FR-07.4, FR-08.3-FR-08.4; NFR-01-NFR-05, NFR-06, NFR-08; INV-01, INV-03, INV-05, INV-08-INV-09; AC-02, AC-05-AC-11, AC-23-AC-24; CT-F20-02, CT-F20-07, CT-F20-08, CT-F20-09.
   - **Implementation:** Render immutable feedback, assessment, recommendation, implementation, response, related files, and item metadata. Add explicit Accept recommendation and Override recommendation controls, disposition/instruction fields, required question answers, incomplete-item summary, and revision-checked/idempotent decision commands. Preserve the original recommendation beside the final human decision.
   - **Visible result:** A proposal bundle lets a developer decide each item and visibly shows which items are complete, overridden, answered, superseded, or blocking implementation.
   - **Durable records / external effects:** Persists decisions through F18's transaction/expected-version boundary and records no provider/GitHub effect. A saved question answer is review input, not publication approval.
   - **Failure / cancellation / restart:** Duplicate submit returns the committed decision; stale submit rejects and refreshes; cancellation before commit changes nothing; process/renderer restart retains completed decisions and leaves remaining items blocked. Over-limit text is rejected before persistence.
   - **Exact evidence:** Four-disposition matrix; accept/override idempotency; question-answer/supersession matrix; incomplete-decision gating; keyboard/focus/accessible-name report; stale renderer race; raw-path/secret/authority scan; CT-F20-02, CT-F20-07-CT-F20-09.
   - **Exit criterion:** AC-02, AC-05-AC-11, AC-21-AC-24 pass and F18 can receive complete final decisions without the renderer implementing decision semantics locally.

3. **Final review, response drafts, and downstream action gate**
   - **Blocked by:** Slices 1-2, F18 final read model, F21/F22/F23 typed consumer commands, and F17 permitted-action data.
   - **Stories / requirements / acceptance criteria:** US-05, US-07-US-09; FR-03.1-FR-03.4, FR-04.4-FR-04.6, FR-07.2-FR-07.4, FR-08.3-FR-08.4; NFR-01-NFR-03, NFR-05-NFR-08; INV-01, INV-03, INV-05, INV-08-INV-09; AC-01, AC-03-AC-04, AC-12, AC-14, AC-21-AC-24; CT-F20-03, CT-F20-04, CT-F20-07, CT-F20-09.
   - **Implementation:** Add final-decision/implementation outcome panels, bounded response draft editing/saving, explicit draft-versus-posted labels, and a capability-driven action bar for conversation, revision, discard, re-evaluate, continuation, and publication routes. F20 sends typed intents only; it does not enable a control from a status label alone.
   - **Visible result:** A final bundle shows what changed, what remains, response drafts, and the exact next actions the owning workflows permit; editing a draft survives reload and creates no remote effect.
   - **Durable records / external effects:** Draft revisions and typed action intents go through F18/F21-F23/F22 repositories/services. No F20 action commits, pushes, posts, resolves, discards, re-evaluates, or starts AI itself.
   - **Failure / cancellation / restart:** Draft save is idempotent and revision checked. A stale or unavailable action is disabled with a reason. Renderer close/restart preserves the last committed draft and does not duplicate a downstream command.
   - **Exact evidence:** Final-stage action-capability table; draft revision/idempotency matrix; publication/no-effect spy; stale/attention/closed-PR routing; restart readback; provider/publication reachability scan; CT-F20-03, CT-F20-07, CT-F20-09.
   - **Exit criterion:** AC-12, AC-14, AC-21, and AC-23-AC-24 pass, and downstream features can consume one safe action gate without inheriting renderer authority.

4. **Validation, AI-work, configuration, and worktree evidence panels**
   - **Blocked by:** Slice 1, F13/F14/F16/F17 read models, F09 safe activity query, and the bounded text/usage components.
   - **Stories / requirements / acceptance criteria:** US-01, US-05, US-08; FR-04.1-FR-04.6, FR-06.1-FR-06.6, FR-07.2-FR-07.4; NFR-01-NFR-05, NFR-08; INV-04-INV-06, INV-08; AC-01, AC-04, AC-12-AC-14, AC-20-AC-25; CT-F20-04, CT-F20-06, CT-F20-07, CT-F20-09, CT-F20-10.
   - **Implementation:** Render separate baseline/post-change validation sections with exact evidence; ordered AI Work Turn Reports with model/deterministic authority labels, usage, stop reasons, remaining issues, and continuation data; effective task profile/policy/instruction/SHA snapshots; the canonical worktree path with copy/open actions; and a persistent F13 WorktreeCondition banner that states whether the current state is clean, AI-attributed-only, un-attributed, mixed/overlapping, or stale/unknown.
   - **Visible result:** A developer can explain what was run before and after changes, what the provider claimed versus what the application observed, which configuration was effective, how much work was used, where the isolated worktree lives, and whether any action is blocked by current dirty/attribution evidence.
   - **Durable records / external effects:** Reads immutable F13/F14/F16/F17 records and delegates safe F13/F04 file actions. It does not rerun validation or AI and does not treat F09 activity as state.
   - **Failure / cancellation / restart:** Missing/failed/interrupted/not-run evidence remains visibly non-passing. Redaction/over-limit failures block the affected projection. Path movement or ownership failure returns a safe delegated result without falling back to the developer clone. An un-attributed, mixed/overlapping, or stale/unknown WorktreeCondition blocks unsafe downstream actions and preserves the worktree. Restart preserves ordering, usage, condition, and evidence revision.
   - **Exact evidence:** Baseline/post matrix; validation status/reason corpus; model-claim versus deterministic-evidence report; usage/turn ordering and stop-action report; snapshot immutability fixture; WorktreeCondition classification/banner/action matrix; path copy/open/reveal isolation; CT-F20-04, CT-F20-06, CT-F20-07, CT-F20-09, CT-F20-10.
   - **Exit criterion:** AC-12-AC-14, AC-20, AC-22, AC-24-AC-25 pass and F20 can explain a ready or attention result without parsing prose or rerunning an upstream service.

5. **Complete read-only diff viewer and file navigation**
   - **Blocked by:** Slices 1 and 4, F13 diff/reference contracts, F04 OS adapter, syntax/file-type metadata, and deterministic UI rendering fixtures.
   - **Stories / requirements / acceptance criteria:** US-05-US-06; FR-05.1-FR-05.7, FR-06.1-FR-06.6, FR-07.3-FR-07.4, FR-08.4; NFR-01-NFR-05, NFR-07-NFR-08; INV-02, INV-04, INV-06-INV-08; AC-04, AC-15-AC-20, AC-22-AC-25; CT-F20-05, CT-F20-06, CT-F20-08, CT-F20-09, CT-F20-10.
   - **Implementation:** Add distinct relevant/proposed/context diff selectors and authority labels. Render the F13 file/hunk model with file navigation, line numbers, syntax highlighting metadata, additions/removals, collapsed unchanged context, new/deleted/renamed/binary markers, selectable/copyable text, bounded loading, and explicit over-limit/error states. Route open/reveal file/worktree actions through F13/F04 and never reconstruct a patch in the renderer.
   - **Visible result:** The developer can inspect every authoritative proposed-worktree file/hunk, compare it with the PR context, understand item relevance, and open/reveal only the recorded operation-owned target.
   - **Durable records / external effects:** Reads immutable diff references and current-state refresh results; records only safe UI intent/delegated action outcomes. No file content is edited and no Git command is executed by F20.
   - **Failure / cancellation / restart:** Changed HEAD, stale worktree, missing file, binary/unsupported syntax, output limit, adapter failure, and cancellation remain explicit non-success states. Paging/collapse never hides an authoritative record without a discoverable continuation or error. A mixed/overlapping or stale/unknown WorktreeCondition keeps clear/replace/validate/publish actions blocked while the diff remains inspectable. Restart retains the selected mode/file and condition evidence when still valid.
   - **Exact evidence:** Complete diff corpus; proposed/context SHA truth table; item-relevance/no-patch-reconstruction fixture; added/deleted/renamed/binary/untracked matrix; over-limit and stale behavior; WorktreeCondition banner/action gate rendered beside the diff; line/file navigation and copy/open/reveal report; narrow-width/long-diff layout evidence; CT-F20-05, CT-F20-06, CT-F20-08, CT-F20-09, CT-F20-10.
   - **Exit criterion:** AC-15-AC-20 and AC-22-AC-25 pass, and the publication workflow can consume the proposed-worktree diff reference without accepting a context or relevant diff by mistake or bypassing an unverified worktree condition.

6. **State-specific guidance, accessibility, and Windows review behavior**
   - **Blocked by:** Slices 1-5, F04/F19 current-desktop route behavior, the application accessibility harness, and the supported Windows packaging configuration.
   - **Stories / requirements / acceptance criteria:** US-01, US-05, US-08-US-09; FR-01.5, FR-03.4, FR-06.5-FR-06.6, FR-07.1-FR-07.4, FR-08.1-FR-08.4; NFR-02, NFR-04-NFR-08; INV-01, INV-07-INV-09; AC-01-AC-04, AC-14, AC-21-AC-25; CT-F20-01, CT-F20-07-CT-F20-10.
   - **Implementation:** Apply the calm `READY_FOR_REVIEW` and persistent `NEEDS_ATTENTION` treatments; expose reason/why/evidence/next-action copy; restore focus after navigation and delegated actions; support keyboard, screen-reader, forced-colors/high-contrast, reduced-motion, zoom, narrow-width, and long-diff paths; verify opening from tray/notification on the current Windows virtual desktop.
   - **Visible result:** A developer can tell at a glance whether to decide, inspect, answer, retry, continue, re-evaluate, discard, or publish, and can complete the inspection without a mouse or color perception.
   - **Durable records / external effects:** Stores no additional state beyond typed UI/action intent and safe diagnostics. F04/F19 remain responsible for window/desktop behavior.
   - **Failure / cancellation / restart:** Focus/foreground failure, unsupported native action, reduced capability, renderer destruction, or restart preserves the target/read model and gives a retryable bounded explanation. No attention result becomes ready because a native surface is unavailable, and no dirty-worktree banner becomes actionable from a stale or missing condition.
   - **Exact evidence:** State/next-action matrix; WorktreeCondition state/banner/action semantics; keyboard/screen-reader/focus report; forced-colors/high-contrast/reduced-motion/zoom/narrow-width evidence; Windows Desktop A/B/C route trace; renderer close/reopen; no-color semantic scan; CT-F20-01, CT-F20-07, CT-F20-08, CT-F20-10.
   - **Exit criterion:** AC-01-AC-04, AC-14, AC-21-AC-25 pass on supported Windows configurations with distinct, actionable, accessible ready/attention states.

7. **Cross-feature conformance and implementation handoff**
   - **Blocked by:** Slices 1-6, final F13/F14/F16/F17/F18/F19 contracts, downstream F21-F23 consumer fakes, and repository check/linter commands.
   - **Stories / requirements / acceptance criteria:** US-01-US-09; all FRs, NFRs, and INVs; APP-AC-14, APP-AC-21, APP-AC-38-APP-AC-39, APP-AC-58, APP-AC-62, APP-AC-67, APP-AC-71-APP-AC-75; AC-01-AC-25; CT-F20-01-CT-F20-10.
   - **Implementation:** Run the complete proposal-to-final workspace with fakes for all upstream read models and downstream action owners. Verify no direct capability leaks, full diff authority labels, snapshot immutability, decisions/drafts/revision races, validation/report/config evidence, WorktreeCondition banner/gates and F22 choice delegation, worktree actions, state guidance, restart/deep-link behavior, accessibility, and two-PR isolation. Keep the F20 surface provider-neutral and publication-free.
   - **Visible result:** One evidence report demonstrates that a developer can open, decide, inspect, understand, and safely hand off a Review Bundle from both stages, including a complete proposed diff and an actionable attention outcome.
   - **Durable records / external effects:** Uses test-owned databases, temporary worktrees, fake read models, fake OS adapters, bounded evidence, and linter reports. It does not edit `checklist.md`, contact GitHub, invoke a live AI provider, publish code/responses, or mutate a developer worktree.
   - **Failure / cancellation / restart:** Any omitted item, authority-label mismatch, false validation pass, silently truncated diff, stale overwrite, duplicate command, arbitrary path, secret/SDK leak, inaccessible control, invalid mapping, or definite linter miss blocks the gate. A cancelled run leaves no success marker and can be rerun from clean fixtures.
   - **Exact evidence:** `npm run check`; F20 component/contract/integration report; full diff corpus report; validation/report/config projection report; WorktreeCondition classification/banner/action-gate/delegation report; state/action/accessibility/Windows evidence; restart/deep-link/revision-fault report; developer-clone negative scan; raw SDK/secret/arbitrary-path/publication-authority scan; `git diff --check`; `npm run lint:prd-plan -- Specs/review_bundle_workspace_and_complete_diff_viewer_PRD.md Specs/review_bundle_workspace_and_complete_diff_viewer_PLAN.md`; `npm run lint:application-coverage -- Specs/application_overview.md Specs/review_bundle_workspace_and_complete_diff_viewer_PRD.md`.
   - **Exit criterion:** All F20 requirements have direct acceptance or named contract-test evidence, mapped application criteria have no definite missing/invalid result, WorktreeCondition consumer/gate/delegation evidence passes, both specification linters have been run against the final pair, and F20 remains unchecked until implementation approval and completion.

## Cross-Slice Verification and Handoff

- The exact owning PRD is `Specs/review_bundle_workspace_and_complete_diff_viewer_PRD.md`; this PLAN does not add Review Bundle creation, polling, GitHub transport, AI invocation, validation execution, conversation, discard/re-evaluation, or publication requirements.
- F03/F18 remain authoritative for persisted bundle/item state, stage, primary state, decision revisions, response-draft records, event associations, and holds. F20 never infers those values from a route, activity event, or local component state.
- F13 remains authoritative for operation ownership, actual worktree state, `prBaseSha`, `prHeadSha`, `worktreeBaselineSha`, diff content, manual edits, stale conditions, safe open/reveal, and the fresh typed `WorktreeCondition` handoff. F20 consumes that condition as its only dirty/attribution source, presents the evidence and action gate, and never runs Git, reconstructs a patch, infers manual ownership from filenames/activity, or accepts a renderer path.
- F14 remains authoritative for validation commands, phase applicability, exit statuses, manual attestations, warnings, and aggregate status. F20 presents the result and never changes a validation pass from provider prose.
- F16 remains authoritative for effective profile, policy, instructions, PR Intent / Context, and future-only snapshot behavior. F20 displays the snapshot associated with the bundle and never rereads current settings as historical evidence.
- F17 remains authoritative for AI operation/segment/turn history, usage, progress, stop reasons, and continuation authorization. F20 presents the complete bounded history before routing a permitted action and never implements a retry or budget.
- F19/F04 remain authoritative for tray/notification navigation, window creation, current-desktop focus, and shell adapters. F20 provides the destination and typed action request only.
- F21 owns read-only conversation and worktree-mutating revisions; F22 owns stale/discard/re-evaluate/dirty-worktree choices, including Clear All Changes, Clear Only AI Changes, Keep Worktree, and Cancel; F23 owns final approval, commit, push, response publication, and uncertain-outcome reconciliation. F20 renders the F13 condition, gates unsafe actions, and routes typed intents without granting any of their authority; F23 revalidates the condition before publication.
- F28-F30 own full restart/network/security/packaging hardening. F20 contributes renderer replacement, evidence rehydration, accessibility, diff completeness, and authority-boundary evidence.
- Coverage decisions are explicit: F20 is primary for the Review Bundle visual/workspace aspects of APP-AC-21, APP-AC-71, APP-AC-72, and APP-AC-75; shared for APP-AC-14, APP-AC-38, APP-AC-39, APP-AC-58, APP-AC-62, APP-AC-67, and APP-AC-73; and not the full owner of conversation, discard, stale/re-evaluation, or publication criteria.
- The F20 checklist item remains unchecked. These documents create no application code, do not change `checklist.md`, and do not claim that the Review Bundle workspace, decision controls, or diff viewer is implemented. The F13 checklist item remains `[~]` until its shared WorktreeCondition consumer handoff is revalidated through F20/F22/F23 fixtures.

## Requirement-to-Slice Trace

| Requirement family | Owning slices |
|---|---|
| FR-01 | 1, 6-7 |
| FR-02 | 2, 7 |
| FR-03 | 3, 7 |
| FR-04 | 3-4, 7 |
| FR-05 | 5, 7 |
| FR-06 | 4-5, 7 |
| FR-07 | 1-3, 5-7 |
| FR-08 | 1-3, 5-7 |
| NFR-01-NFR-08 | 1-7 |
| INV-01-INV-09 | 1-7 |
| APP-AC-14 | 1-3, 7 |
| APP-AC-21 | 5-7 |
| APP-AC-38-APP-AC-39 | 4-7 |
| APP-AC-58, APP-AC-62 | 3-4, 6-7 |
| APP-AC-67 | 5-7 |
| APP-AC-71-APP-AC-75 | 1-7 |
