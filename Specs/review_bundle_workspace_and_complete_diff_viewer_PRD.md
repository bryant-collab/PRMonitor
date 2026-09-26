# F20 - Review Bundle Workspace and Complete Diff Viewer - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F13 - Operation-owned Git worktrees and change attribution | Supplies the operation-owned worktree reference, immutable SHA snapshots, actual-state inspections, authoritative proposed-worktree and contextual PR diffs, file identities, and safe open/reveal actions. |
| 2 | F14 - Deterministic validation runner and result model | Supplies phase-aware baseline/post-change validation results, exact command evidence, manual-check status, warnings, and next-action data. |
| 3 | F16 - AI preferences, task-profile snapshots, execution policies, and Common Instructions | Supplies immutable effective AI profile, policy, repository-instruction, Build & Validation, and PR Intent / Context snapshots. |
| 4 | F17 - Bounded AI Work Controller and deterministic progress evaluation | Supplies ordered AI Work Turn Reports, deterministic observations, progress/stop reasons, usage, cumulative history, and permitted continuation data. |
| 5 | F18 - Automatic review-to-Review-Bundle vertical slice | Supplies the committed proposal/final Review Bundle read model, immutable feedback versions, item assessments, decisions, stage/state, responses, and hold-linked outcome. |
| 6 | F19 - System tray, native notifications, deep links, and shutdown | Supplies safe navigation/deep-link delivery and the native worktree-opening entry path; F20 supplies the Review Bundle destination and in-screen worktree action. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F21 - Read-only conversation and worktree-mutating review revisions | Uses the workspace's selected bundle/item context and typed conversation/revision actions. |
| 2 | F22 - Discard, stale detection, and re-evaluation with dirty-worktree choices | Uses the workspace's current state, worktree evidence, dirty-change warnings, and typed discard/re-evaluate actions. |
| 3 | F23 - Human-approved, idempotent Review Bundle publication | Uses the final review surface's explicit approval state, authoritative proposed-worktree diff, response drafts, and publication-gating data. |
| 4 | F28-F30 - Recovery, security, and release readiness | Exercise workspace rehydration, accessibility, renderer replacement, security boundaries, and complete review workflows. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-14 | FR-01.1-FR-01.4, INV-01 | AC-01-AC-04 | Shared: F18 owns durable Review Bundle persistence; F20 owns the restart-safe workspace projection and inspection surface. |
| APP-AC-21 | FR-05.1-FR-05.6, INV-02-INV-03 | AC-15-AC-19 | Primary presentation owner: F20 exposes the complete read-only diff and its file/hunk navigation; F13 remains authoritative for the diff contents. |
| APP-AC-38 | FR-06.1-FR-06.3, INV-06 | AC-20-AC-21 | Shared: F13/F04 authorize the canonical OS action; F20 displays, copies, and invokes the typed worktree/file action. |
| APP-AC-39 | FR-05.5-FR-05.6, FR-06.5-FR-06.6, FR-07.2, INV-02-INV-04, INV-08 | AC-18-AC-19, AC-22, AC-25 | Shared: F13 supplies the fresh typed worktree condition and attribution evidence; F20 presents the condition and blocks misleading actions; F22 owns destructive dirty-worktree choices. |
| APP-AC-58 | FR-04.4, FR-07.2, INV-04 | AC-13-AC-14, AC-22 | Shared: F17 owns complete reports and continuation semantics; F20 presents the full evidence before routing a permitted continuation. |
| APP-AC-62 | FR-04.4, FR-06.4, INV-05 | AC-12-AC-14, AC-22 | Shared: F16/F17 own snapshots and usage; F20 presents task type, provider, model, reasoning effort when available, profile revision, policy summary, and deterministic zero-AI outcomes. |
| APP-AC-67 | FR-05.1-FR-05.6, INV-02-INV-03 | AC-15-AC-19, AC-22 | Shared: F13 owns the three SHA snapshots and diff truth; F20 distinguishes publication-authoritative proposed diff from contextual PR diff; F23 owns publication. |
| APP-AC-71 | FR-02.1-FR-02.5, FR-07.1, INV-03 | AC-05-AC-08, AC-22 | Shared: F18 enforces the proposal workflow; F20 makes proposal read-only and visibly prevents mutation/publication before decisions. |
| APP-AC-72 | FR-02.3-FR-02.5, FR-07.2, INV-03 | AC-09-AC-11, AC-22 | Primary UI owner: F20 exposes explicit Accept recommendation/Override recommendation controls and required question answers; F18 persists and validates the decisions. |
| APP-AC-73 | FR-03.1-FR-03.4, INV-04 | AC-12-AC-13, AC-16, AC-22 | Shared: F14 owns actual validation truth and F18 owns invocation timing; F20 keeps baseline and post-change evidence visibly separate. |
| APP-AC-75 | FR-01.5, FR-03.4, FR-07.1-FR-07.4, INV-07 | AC-03-AC-04, AC-14, AC-21-AC-22 | Primary presentation owner: F20 gives `READY_FOR_REVIEW` and `NEEDS_ATTENTION` distinct accessible treatments, explanations, evidence, and permitted next actions. |

### Explicit coverage boundaries

F20 is not the owner of Review Bundle creation, event handling, Git truth,
validation execution, AI invocation, conversation execution, discard or
re-evaluation, remote publication, or the per-PR hold. It consumes committed,
typed records from those owners and presents them without inferring state from
activity text, provider prose, cached Git output, or color alone. F20 does not
claim APP-AC-22 (conversation execution), APP-AC-23 (discard execution), or
APP-AC-27-APP-AC-29 (publication); F21-F23 own those behaviors.

For dirty-worktree behavior, F20 consumes F13's fresh `WorktreeCondition`
classification and evidence. It may show a persistent condition banner and
route the developer to **Review Worktree Changes**, **Refresh Evidence**, or
another typed owning-workflow action, but it never infers manual ownership from
filenames and never implements **Clear All Changes** or **Clear Only AI
Changes**. F22 owns the choice flow; F13 owns the safe cleanup mechanics.

## Executive Summary

The Review Bundle is where a developer decides whether automated review work is
understood, safe, and ready for the next explicit action. F20 provides one
reviewable workspace for both stages of that process: `PROPOSAL_REVIEW`, where
the developer decides what each feedback item means, and `FINAL_REVIEW`, where
the developer inspects the actual result before any later publication workflow.

The workspace must make the difference between semantic recommendations and
deterministic evidence obvious. A developer can inspect the original immutable
feedback, the assessment and disposition, the implementation or response
proposal, the human decision, validation results, turn-by-turn AI evidence,
effective configuration, worktree, and every change in the complete diff.

The proposed-worktree diff is the only diff that represents changes eligible
for publication. The relevant diff helps explain one feedback item, and the PR
context diff shows the PR's existing changes, but neither may be presented as a
separate publishable patch. The viewer is read-only and does not offer per-hunk
acceptance or code editing.

`READY_FOR_REVIEW` is a calm, explicit invitation to inspect or decide.
`NEEDS_ATTENTION` is a persistent warning that explains what happened, why it
matters, what evidence is preserved, and what action is permitted next. The
same semantic distinction must remain understandable with keyboard navigation,
screen readers, forced colors, reduced motion, and without relying on color.

## User Stories

### Open and understand a Review Bundle

- **US-01:** **GIVEN** F18 has committed a proposal or final Review Bundle, **WHEN** the developer opens it from the inbox, tray, notification, or a saved route, **THEN** the workspace shows the persisted PR, stage, primary state, reason, next action, item count, worktree reference, and evidence revision without starting new analysis.
  - **Acceptance Criteria:** AC-01-AC-04, AC-21-AC-22.
- **US-02:** **GIVEN** the bundle contains multiple feedback items, **WHEN** the developer navigates the item list, **THEN** every item is represented once, the selected item is stable, and the workspace makes undecided, answered, fixed, pushback, question, and no-change statuses understandable.
  - **Acceptance Criteria:** AC-02-AC-04.

### Decide proposal items safely

- **US-03:** **GIVEN** the bundle is in `PROPOSAL_REVIEW`, **WHEN** the developer reviews an item, **THEN** they can see the immutable original feedback, AI assessment, proposed disposition, proposed implementation, proposed reply, related files, and explicit Accept recommendation/Override recommendation controls.
  - **Acceptance Criteria:** AC-05-AC-08.
- **US-04:** **GIVEN** a recommendation is not acceptable as presented, **WHEN** the developer overrides it, **THEN** the workspace requires a final disposition and records bounded instructions; a `question` disposition also requires an answer before implementation can be authorized.
  - **Acceptance Criteria:** AC-09-AC-11.

### Inspect final evidence and changes

- **US-05:** **GIVEN** the bundle is in `FINAL_REVIEW`, **WHEN** the developer inspects it, **THEN** the workspace shows final human decisions, proposed replies, actual validation, AI reports, effective configuration, worktree path, and state-gated next actions.
  - **Acceptance Criteria:** AC-12-AC-14, AC-20-AC-22.
- **US-06:** **GIVEN** the worktree contains a proposed result, **WHEN** the developer opens the diff viewer, **THEN** they can inspect relevant, proposed-worktree, and PR-context views with file navigation, line numbers, syntax highlighting, additions/removals, collapsed context, new/deleted markers, and safe open/reveal actions.
  - **Acceptance Criteria:** AC-15-AC-20.
- **US-07:** **GIVEN** the developer edits a proposed response, **WHEN** the draft is saved, **THEN** the new draft is visible in the bundle and available to a later publication workflow without posting anything remotely.
  - **Acceptance Criteria:** AC-12, AC-14, AC-22.

### See attention states and recoverable next actions

- **US-08:** **GIVEN** validation, AI work, persistence, Git state, or a required user decision needs attention, **WHEN** the workspace is opened, **THEN** it distinguishes the problem from a normal ready state and shows preserved evidence plus the permitted next action.
  - **Acceptance Criteria:** AC-04, AC-13-AC-14, AC-21-AC-22.
- **US-09:** **GIVEN** the window closes or the process restarts, **WHEN** the developer reopens the same bundle, **THEN** the same committed inputs, decisions, drafts, evidence, diff references, and action gates are shown without duplicated work or silently changed meaning.
  - **Acceptance Criteria:** AC-01, AC-03-AC-04, AC-22.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** a committed proposal or final Review Bundle exists, **WHEN** the workspace opens it by a valid bundle identity, **THEN** it shows the persisted PR reference, stage, primary state, state revision, reason, permitted next actions, item count, and last committed evidence revision; it does not start AI, Git, GitHub, or validation work merely because the screen opened.
- **AC-02:** **GIVEN** the bundle has N persisted items, **WHEN** the item navigator renders, **THEN** it exposes exactly N stable item identities, deterministic ordering, status summaries, and a selected item or an explicit empty-selection state; no item is duplicated, silently omitted, or synthesized from activity text.
- **AC-03:** **GIVEN** the renderer closes, reloads, or is recreated, **WHEN** the workspace is reopened, **THEN** it rehydrates from the main-process read model with the same stage, state, item decisions, answer status, response drafts, evidence references, and action availability; stale renderer state cannot overwrite a newer committed revision.
- **AC-04:** **GIVEN** a required read model, diff reference, or evidence record is missing, inconsistent, stale, or over its published bound, **WHEN** the workspace attempts to render it, **THEN** it shows a bounded attention/error explanation and a permitted refresh or inspection action, never a guessed value, silently truncated authoritative diff, or false success.
- **AC-05:** **GIVEN** a proposal-stage item is selected, **WHEN** its detail view is shown, **THEN** it displays the exact immutable feedback snapshot used by F18, including author/source, body or review state, location metadata when available, version identity, assessment, proposed disposition, proposed implementation, proposed response, and related-file metadata.
- **AC-06:** **GIVEN** a proposal-stage item has a recommendation, **WHEN** the developer views its controls, **THEN** the controls are explicitly labeled **Accept recommendation** and **Override recommendation**, and the UI explains that the choice authorizes implementation planning only and is not publication approval.
- **AC-07:** **GIVEN** the developer chooses **Accept recommendation**, **WHEN** the typed decision succeeds, **THEN** the item records an accepted decision for the current bundle revision, the control becomes visibly selected, the action is idempotent for the same decision identity, and the original recommendation remains inspectable.
- **AC-08:** **GIVEN** the developer chooses **Override recommendation**, **WHEN** the override form is submitted, **THEN** the workspace requires a valid final disposition from `fixed`, `pushback`, `question`, or `no_change`, records bounded instructions when supplied, shows the resulting decision and its revision, and never silently implements the rejected recommendation.
- **AC-09:** **GIVEN** an item has an effective `question` disposition, **WHEN** the item is shown, **THEN** it exposes a clearly labeled bounded answer textbox; an empty or over-limit answer prevents implementation authorization and identifies the item and required next action.
- **AC-10:** **GIVEN** an item with a proposed `question` is overridden to a non-question disposition, **WHEN** the override commits, **THEN** the old question is visibly marked superseded and cannot remain hidden implementation authority; if the effective disposition remains `question`, its answer remains required.
- **AC-11:** **GIVEN** one or more items are undecided or have unanswered effective questions, **WHEN** the developer attempts to continue to implementation, **THEN** the workspace blocks the action, identifies every incomplete item, preserves all completed decisions, and does not invoke an AI provider or mutate the worktree.
- **AC-12:** **GIVEN** a final-stage bundle contains proposed responses, **WHEN** the developer edits and saves one response, **THEN** the bounded draft is persisted against the current bundle/item revision, visibly marked as a draft for later publication approval, and never posted, resolved, approved, or otherwise sent to GitHub by F20.
- **AC-13:** **GIVEN** baseline and/or post-change validation records exist, **WHEN** the Validation view renders, **THEN** it shows separate phase labels, exact command and working-directory evidence, timestamps, exit/status data, manual-check state, warnings, and next actions; a model statement cannot create a passing result.
- **AC-14:** **GIVEN** the bundle or an AI operation is `NEEDS_ATTENTION`, **WHEN** the workspace renders the state, **THEN** it shows the concrete deterministic reason, why it matters, preserved worktree/evidence status, complete turn history when applicable, usage, and only the actions permitted by the owning workflow; it does not present an attention result as ordinary ready-to-publish work.
- **AC-15:** **GIVEN** a diff reference is available, **WHEN** the developer selects a diff mode, **THEN** the workspace offers clearly labeled **Relevant Diff**, **Proposed Worktree Diff**, and **PR Context Diff** views with their purpose and authority stated in the view itself.
- **AC-16:** **GIVEN** the developer opens **Proposed Worktree Diff**, **WHEN** the diff is loaded, **THEN** it represents the actual current worktree compared with `worktreeBaselineSha`, includes every eligible file/change, and exposes the recorded `prBaseSha`, `prHeadSha`, and `worktreeBaselineSha` without substituting one for another.
- **AC-17:** **GIVEN** the developer opens **PR Context Diff**, **WHEN** the diff is loaded, **THEN** it represents the worktree compared with `prBaseSha`, clearly includes pre-existing PR changes as context, and explicitly states that it is not the publication-authoritative patch.
- **AC-18:** **GIVEN** the developer opens **Relevant Diff** for an item, **WHEN** the view is rendered, **THEN** it identifies the related files/hunks supplied by F18/F13 as context for that item, does not imply that the view is a complete independent patch, and provides a direct route to the complete proposed-worktree diff.
- **AC-19:** **GIVEN** any diff mode is rendered, **WHEN** the developer navigates it, **THEN** they can navigate files, see line numbers, syntax highlighting, additions/removals, collapsed unchanged context, new/deleted-file markers, selectable/copyable text, and explicit loading/error states; the viewer is read-only and has no per-hunk acceptance or code-editing operation.
- **AC-20:** **GIVEN** a related file is present in the operation-owned worktree, **WHEN** the developer chooses copy path, open file, reveal file, or open worktree, **THEN** F20 sends only the typed F13/F04 action for the recorded canonical target, displays the result, and never accepts or opens an arbitrary renderer-supplied path or the developer clone.
- **AC-21:** **GIVEN** the bundle is `READY_FOR_REVIEW`, **WHEN** the stage/state header renders, **THEN** it uses a calm accessible treatment and explains whether the user must decide proposal items or inspect the final complete diff; **GIVEN** the bundle is `NEEDS_ATTENTION`, **THEN** it uses a persistent warning treatment with a non-color status, concrete reason, evidence, and permitted next action.
- **AC-22:** **GIVEN** the workspace is used with keyboard navigation, a screen reader, forced colors/high contrast, reduced motion, a narrow window, or a long/large diff, **WHEN** every view and action is exercised, **THEN** labels, focus order, status semantics, validation/error text, scrolling, wrapping, and loading states remain operable and understandable without relying on color, hover, animation, or horizontal overflow; a large or over-limit diff is paged or rejected explicitly rather than silently truncated.
- **AC-23:** **GIVEN** the workspace receives a duplicate or stale decision, draft, navigation, or refresh request, **WHEN** the main process evaluates it, **THEN** an equal request returns the existing result, a stale revision is rejected with a refresh action, and no duplicate decision, draft, provider turn, worktree mutation, or external publication effect is created.
- **AC-24:** **GIVEN** a workspace read model contains provider data, paths, command output, or usage, **WHEN** it is persisted or sent to the renderer, **THEN** it contains only bounded provider-neutral snapshots and redacted safe evidence; it contains no credentials, SDK objects, arbitrary commands, uncontrolled environment values, or secret-bearing output.
- **AC-25:** **GIVEN** F13 returns a fresh `WorktreeCondition`, **WHEN** the workspace renders or a developer requests refresh, discard, re-evaluation, validation, or publication-related review, **THEN** it shows the condition, observed revision/fingerprint, dirty summary, attribution/overlap evidence, and permitted next action. `CLEAN` and `AI_ATTRIBUTED_ONLY` may expose their owning-workflow actions; `UNATTRIBUTED_CHANGES` is described as un-attributed rather than proven manual ownership; `MIXED_OR_OVERLAP` and `STALE_OR_UNKNOWN` visibly block any action that would clear, replace, validate against, or publish unverified state until the owning workflow obtains an explicit decision or fresh evidence.

## Functional Requirements

### FR-01: Review Bundle workspace projection and navigation

- **FR-01.1:** The workspace SHALL render a committed, versioned Review Bundle read model containing the PR reference, stage, primary state, state reason, permitted next actions, evidence revision, and worktree/diff references.
- **FR-01.2:** The workspace SHALL show every persisted Review Bundle item exactly once with deterministic ordering, item status, decision status, and selection state.
- **FR-01.3:** The workspace SHALL preserve the selected bundle/item and render the same committed values after renderer closure, reload, deep-link activation, or process restart.
- **FR-01.4:** The workspace SHALL fail closed on missing, inconsistent, stale, over-limit, or unknown read-model data and SHALL expose a bounded remediation rather than inventing state.
- **FR-01.5:** The workspace SHALL present `PROPOSAL_REVIEW` and `FINAL_REVIEW` as distinct stages and SHALL explain the stage-specific user decision in the primary action area.

### FR-02: Proposal-stage feedback and human decisions

- **FR-02.1:** During `PROPOSAL_REVIEW`, the workspace SHALL show the immutable feedback version used by the bundle, its assessment, proposed disposition, proposed implementation, proposed response, related files, and semantic metadata.
- **FR-02.2:** The workspace SHALL expose explicit **Accept recommendation** and **Override recommendation** controls for every proposal item and SHALL explain that these controls are not publication approval.
- **FR-02.3:** An override SHALL require a valid final disposition, SHALL accept only `fixed`, `pushback`, `question`, or `no_change`, and SHALL persist bounded developer instructions when supplied.
- **FR-02.4:** Every effective `question` disposition SHALL expose a required bounded answer field; implementation authorization SHALL remain unavailable until the answer is valid and durably accepted.
- **FR-02.5:** The workspace SHALL identify every undecided item and unanswered question and SHALL block the implementation route until the owning F18 decision contract confirms completeness.
- **FR-02.6:** Decision retries SHALL be revision-checked and idempotent; a stale renderer SHALL not overwrite a newer decision or make an overridden recommendation authoritative again.

### FR-03: Final review and proposed response drafts

- **FR-03.1:** During `FINAL_REVIEW`, the workspace SHALL show the final human decision, instruction, answer, assessment, disposition, and implementation outcome for every item.
- **FR-03.2:** The workspace SHALL allow proposed response drafts to be edited and saved within the bundle's bounded draft contract.
- **FR-03.3:** Saved response drafts SHALL be visibly distinguished from posted responses and SHALL be available to F23 without causing any GitHub side effect from F20.
- **FR-03.4:** Final-stage controls SHALL be enabled or disabled from the owning workflow's typed action availability and SHALL not infer publication readiness from a status label, provider prose, or a green color.

### FR-04: Validation, activity, AI-work, and configuration evidence

- **FR-04.1:** The workspace SHALL display baseline and post-change validation in separate views or clearly separated sections with phase, command, directory, timing, exit/status, manual-check, warning, and next-action evidence.
- **FR-04.2:** The workspace SHALL preserve the distinction between `passed`, `failed`, `not_run`, and `interrupted`, and SHALL show the deterministic reason for unavailable, skipped, or non-passing evidence.
- **FR-04.3:** The workspace SHALL label provider-reported claims separately from F13 actual Git observations and F14 deterministic validation results.
- **FR-04.4:** The workspace SHALL show ordered AI Work Turn Reports, cumulative and per-turn usage when available, progress classifications, stop reasons, unresolved issues, and permitted continuation/retry information before routing a continuation action.
- **FR-04.5:** When AI was used, the workspace SHALL show the task type, provider, model, supported reasoning effort when available, profile revision, and a user-readable effective execution-policy summary; deterministic paths SHALL show zero AI usage where applicable.
- **FR-04.6:** The workspace SHALL show the immutable PR Intent / Context, Common Instructions, Build & Validation, task-profile, execution-policy, remote-SHA, and worktree snapshots associated with the displayed result, without silently replacing them with current settings.

### FR-05: Complete, authoritative, read-only diff viewer

- **FR-05.1:** The workspace SHALL offer **Relevant Diff**, **Proposed Worktree Diff**, and **PR Context Diff** as separate labeled views with distinct purposes and authority.
- **FR-05.2:** **Proposed Worktree Diff** SHALL represent the actual operation worktree relative to `worktreeBaselineSha` and SHALL be the only F20 diff view described as eligible for later publication approval.
- **FR-05.3:** **PR Context Diff** SHALL represent the operation worktree relative to `prBaseSha`, SHALL retain the PR's pre-existing changes as context, and SHALL never be treated as a publication patch.
- **FR-05.4:** **Relevant Diff** SHALL use only the supplied related-file/hunk evidence, SHALL remain contextual, and SHALL provide a route to the complete Proposed Worktree Diff.
- **FR-05.5:** The viewer SHALL support file navigation, line numbers, syntax highlighting, additions/removals, collapsed unchanged context, new/deleted-file markers, text selection/copy, and explicit loading/error states for tracked, untracked, renamed, binary, or unavailable files as supported by F13's diff contract.
- **FR-05.6:** The viewer SHALL be read-only, SHALL not offer per-hunk acceptance or code editing, and SHALL not silently truncate or reconstruct an authoritative diff; a bounded/paged representation SHALL retain a path to every diff record or show an explicit non-success condition.
- **FR-05.7:** During `PROPOSAL_REVIEW`, the viewer SHALL state that implementation changes have not been authorized and SHALL not imply that a proposed implementation diff already exists.

### FR-06: Worktree, file actions, and reproducibility metadata

- **FR-06.1:** The workspace SHALL display the resolved isolated worktree path recorded by F13, allow the user to copy it, and keep it tied to the bundle snapshot even if the application-level worktree root later changes.
- **FR-06.2:** File and worktree actions SHALL invoke only typed F13/F04 open/reveal requests for recorded canonical targets and SHALL expose safe failure/remediation results.
- **FR-06.3:** The workspace SHALL never target the developer's normal clone, accept arbitrary renderer paths, or construct shell commands from displayed path text.
- **FR-06.4:** The workspace SHALL expose the immutable SHA identities and effective AI/configuration snapshots needed to reproduce what the user is reviewing.
- **FR-06.5:** The workspace SHALL consume and display F13's fresh typed `WorktreeCondition`, including condition classification, observed revision/fingerprint, dirty-change summary, attribution/overlap evidence, and permitted next actions; F20 SHALL not infer whether a change is manual from filenames, activity text, or provider claims.
- **FR-06.6:** When the condition is `UNATTRIBUTED_CHANGES`, `MIXED_OR_OVERLAP`, or `STALE_OR_UNKNOWN`, the workspace SHALL show a persistent warning and SHALL not route an action that clears, replaces, validates against, or publishes the worktree as if its state were verified; it SHALL route only the typed refresh, inspection, or owning-workflow decision permitted by F13/F22/F23.

### FR-07: State guidance, action gating, and accessibility

- **FR-07.1:** The workspace SHALL give `READY_FOR_REVIEW` a calm review-ready treatment and `NEEDS_ATTENTION` a persistent warning treatment, each with a non-color semantic label.
- **FR-07.2:** The workspace SHALL show what happened, why it matters, preserved evidence, and the permitted next action for any user-actionable state; it SHALL not present a disabled or unavailable action as available.
- **FR-07.3:** All controls, status labels, diff navigation, validation evidence, errors, and long text SHALL be operable with keyboard navigation and understandable to assistive technology, forced colors/high contrast, reduced motion, and narrow windows.
- **FR-07.4:** The workspace SHALL expose focus, loading, empty, unavailable, stale, over-limit, and failure states with actionable text and without requiring color, hover, animation, or free-form log interpretation.

### FR-08: Boundary, safety, and durable interaction behavior

- **FR-08.1:** The workspace SHALL use the main-process authoritative read model and typed IPC actions; renderer memory SHALL not own Review Bundle state or long-running work.
- **FR-08.2:** F20 SHALL not import or invoke a provider SDK, GitHub transport, Git command runner, validation runner, commit/push/response publisher, discard service, or re-evaluation service.
- **FR-08.3:** User actions SHALL be persisted or delegated through the owning service's revision/idempotency contract before any represented effect, and duplicate or stale requests SHALL be safe.
- **FR-08.4:** Renderer-facing and persisted workspace data SHALL be bounded, serializable, provider-neutral, redacted, and free of credentials, SDK objects, arbitrary commands, and uncontrolled environment values.

## Non-Functional Requirements

- **NFR-01: Review completeness** - The workspace SHALL allow a developer to inspect every persisted review input, assessment, human decision, answer/instruction, response draft, validation result, AI report, usage record, relevant diff reference, proposed-worktree diff record, and PR-context diff record that the owning services mark available.
- **NFR-02: Determinism** - Given the same read-model revision, injected clock, diff references, evidence, and action capabilities, the workspace SHALL produce equivalent ordering, labels, status explanations, authority labels, and enabled/disabled actions.
- **NFR-03: Bounded rendering** - Large item lists, reports, validation output, response drafts, paths, and diffs SHALL use explicit published bounds, paging, virtualization, collapsing, or safe rejection; no authoritative record SHALL be silently truncated.
- **NFR-04: Accessibility** - The workspace SHALL meet the application's keyboard, screen-reader, focus, forced-colors/high-contrast, reduced-motion, zoom, wrapping, and non-color status expectations on supported Windows configurations.
- **NFR-05: Security and data minimization** - The workspace SHALL expose only bounded safe projections and shall not persist or display credentials, provider SDK objects, arbitrary filesystem targets, uncontrolled environment values, or unredacted secret-shaped output.
- **NFR-06: Restart and renderer resilience** - Committed workspace state, decisions, drafts, evidence, diff identities, and action gates SHALL survive renderer closure and ordinary application restart without duplicate effects or budget/meaning resets.
- **NFR-07: Windows behavior** - Deep-link opening, current-desktop window recreation, file-manager open/reveal, keyboard focus, and long-diff scrolling SHALL remain usable on the supported Windows virtual-desktop configurations; platform-specific behavior SHALL remain behind the existing shell/OS adapters.
- **NFR-08: Diagnosability** - Every rejected, stale, unavailable, over-limit, or delegated action SHALL expose a bounded machine-readable reason and user-readable explanation without making activity text authoritative.

## Invariants

- **INV-01:** The F18/F03 committed Review Bundle read model is authoritative for displayed bundle state, item identity, stage, decision revision, and response-draft revision; renderer memory and activity text are never authoritative.
- **INV-02:** The Proposed Worktree Diff is the only publication-relevant diff shown by F20; Relevant Diff is contextual and PR Context Diff is explicitly non-authoritative for publication.
- **INV-03:** F20 never turns proposal-stage viewing, accepting, overriding, answering, or diff inspection into provider mutation, commit, push, response posting, publication, or conversation resolution.
- **INV-04:** F13 actual Git state and F14 actual validation state outrank provider-reported files, commands, completion, validation claims, and response text.
- **INV-05:** AI profile, policy, instructions, PR Intent / Context, remote metadata, SHA, validation, worktree, and evidence values shown for a bundle come from immutable snapshots associated with that result; current settings cannot silently rewrite history.
- **INV-06:** File and worktree actions can target only F13/F04-authorized canonical paths associated with the displayed bundle; displayed text is never path authority.
- **INV-07:** `READY_FOR_REVIEW` and `NEEDS_ATTENTION` remain semantically distinct even when color, icons, CSS, or native surfaces are unavailable.
- **INV-08:** A stale, duplicate, missing, inconsistent, or over-limit renderer request cannot create a second decision, response draft, AI turn, worktree mutation, or remote effect.
- **INV-09:** The workspace does not create a second Review Bundle, validation, AI-progress, publication, or per-PR hold state machine.

## Out of Scope

- Review Bundle creation, event eligibility, per-PR holds, and final-state persistence owned by F18/F11/F03.
- AI provider invocation, streaming, conversation execution, worktree mutation, turn budgeting, or progress evaluation owned by F15-F17 and F21.
- Discard, stale detection, re-evaluation, dirty-worktree clear choices, and worktree replacement owned by F22.
- Commit, push, GitHub response posting, review approval, conversation resolution, or publication reconciliation owned by F23.
- Per-hunk code-patch acceptance, inline diff comments, direct code editing, or independent per-item patch reconstruction.
- Creating or changing validation commands, AI profiles, execution policies, Common Instructions, or PR Intent / Context source settings.
- Replacing F13's Git/diff parser, F14's validation truth, F17's report semantics, or F19's window/deep-link lifecycle.

## Product Decisions

- **PD-01: One workspace, two explicit stages** - Proposal and final review share one Review Bundle destination but show different primary decisions so the user always knows whether they are deciding recommendations or inspecting publishable work.
- **PD-02: Proposed Worktree Diff is authoritative** - The diff relative to `worktreeBaselineSha` is the only code-change view that may feed later publication approval. The PR Context Diff is deliberately contextual even when it contains the same proposed changes.
- **PD-03: Relevant Diff is explanatory, not a patch** - A selected item may show likely related files/hunks, but the user is directed to the complete Proposed Worktree Diff for the full result.
- **PD-04: Responses remain drafts here** - F20 may edit and persist proposed replies, but only F23 can decide and perform remote response publication.
- **PD-05: No per-hunk acceptance in the MVP** - The developer approves the complete proposed diff in the later publication workflow; F20 supports inspection, not patch reconstruction.
- **PD-06: Truthful incomplete evidence** - Missing, stale, over-limit, unavailable, or interrupted evidence is shown as such with a next action; the workspace never smooths it into a ready or passing result.
- **PD-07: Evidence-based dirty-worktree presentation** - The workspace says “un-attributed” or “mixed/overlapping” when F13 cannot prove ownership. It does not call every non-AI change manual, and it never offers cleanup as an implicit consequence of opening or refreshing the screen.

## Implementation Decisions

- **IMP-01: Use a bounded Review Bundle workspace read model** - The renderer receives one versioned projection with explicit authority labels and action capabilities instead of querying individual persistence tables or inferring relationships locally.
- **IMP-02: Keep diff modes separate in the contract** - Relevant, proposed-worktree, and PR-context references use distinct discriminators and baseline identities so a UI label cannot accidentally turn contextual evidence into publication input.
- **IMP-03: Route mutations as typed intents** - Decision, draft, navigation, open/reveal, discard, re-evaluate, conversation, continuation, and publication requests use owning-service commands with bundle/item/evidence revisions; F20 does not carry service authority.
- **IMP-04: Render model claims and deterministic evidence in separate regions** - Turn reports, provider assessments, Git observations, validation results, and action decisions are never flattened into one prose timeline.
- **IMP-05: Make the complete diff inspectable without requiring one giant DOM** - File navigation, collapsed context, bounded chunks, and paging may be used, but the contract must preserve every authoritative file/hunk or return an explicit error.
- **IMP-06: Reuse F13's WorktreeCondition contract** - F20 consumes the condition, fingerprint, observed revision, dirty summary, attribution/overlap evidence, and permitted actions from F13. F20 does not add a renderer-side classifier or second source of truth.

## Testing Decisions

- **TST-01: Test semantic state and authority, not pixel snapshots alone** - Contract and component tests cover stage/state labels, action gating, authority labels, revision handling, and accessible names; a small Windows visual smoke suite covers layout and focus.
- **TST-02: Use F13/F14/F16/F17/F18 fakes and deterministic fixtures** - F20 tests must not require live GitHub credentials, a real AI provider, or a real publication effect.
- **TST-03: Exercise the complete diff corpus** - Tests cover clean, added, deleted, renamed, binary, untracked, large, over-limit, stale, missing, and manually changed worktree evidence without reconstructing patches in the UI.
- **TST-04: Fault-test renderer and revision races** - Close/reopen, duplicate click, stale revision, missing read model, partial projection, process restart, and delegated OS-action failures must preserve committed truth and avoid duplicate effects.
- **TST-05: Validate accessibility paths explicitly** - Keyboard-only navigation, screen-reader names/roles, focus restoration, forced colors, high contrast, reduced motion, zoom, narrow width, and non-color status semantics are contract evidence.
- **TST-06: Exercise dirty-worktree boundary cases** - Use clean, AI-attributed-only, un-attributed, mixed/overlapping, stale, manual-edit-after-turn, build/test-created, untracked, binary, rename, and deletion fixtures; assert the banner, action gate, refresh behavior, and F13/F22 delegation remain consistent.

## Proposed Modules

- **MOD-01: Review Bundle Workspace Read Model Gateway** - Loads the versioned F18/F03 projection and exposes bounded stage/state/item/evidence/action data to the renderer.
- **MOD-02: Item Navigator and Decision Surface** - Presents item ordering, selection, accept/override decisions, disposition/instruction fields, and question-answer completeness.
- **MOD-03: Review Evidence Panels** - Renders validation, AI Work Turn Reports, usage, configuration/policy, snapshots, reasons, and next actions with explicit authority labels.
- **MOD-04: Proposed Response Draft Editor** - Edits and persists bounded response drafts without remote publication authority.
- **MOD-05: Diff View Model and Viewer** - Selects relevant/proposed/context references and renders read-only file/hunk evidence with safe, accessible navigation.
- **MOD-06: Workspace Action Gate** - Maps read-model capabilities to typed F21/F22/F23/F13/F04 actions and rejects stale, unavailable, or unauthorized requests.
- **MOD-07: Accessible Status and Error Presentation** - Provides stable non-color semantics, focus behavior, loading/empty/error states, and bounded remediation text.
- **MOD-08: Worktree Condition Banner and Gate** - Presents F13's typed condition/evidence and maps permitted actions without inferring ownership or performing cleanup.

## Workflows

### Workflow 1: Open and inspect a proposal

```text
1. F19/F08 routes the developer to a Review Bundle identity.
2. The main process loads the committed F18 workspace read model.
3. The workspace renders the PR, PROPOSAL_REVIEW stage, primary state, reason,
   hold-safe next action, item list, and evidence revision.
4. The developer selects an item.
5. The workspace shows the immutable feedback, assessment, proposed disposition,
   implementation, response, related files, and decision controls.
6. The developer may inspect the relevant/context view, but the UI states that
   implementation changes have not been authorized.
```

### Workflow 2: Decide every proposal item

```text
1. The developer chooses Accept recommendation or Override recommendation.
2. An override requires a final disposition and optional bounded instructions.
3. A question disposition requires a bounded answer textbox.
4. The workspace submits a typed, revision-checked decision to F18.
5. The read model refreshes and shows accepted/overridden, answer, and revision
   status for the item.
6. Continue-to-implementation remains blocked until every item and required
   question is complete.
```

### Workflow 3: Inspect final changes

```text
1. F18 commits FINAL_REVIEW and the workspace reloads the new revision.
2. The developer reviews final decisions, proposed replies, validation, AI
   reports, effective configuration, worktree path, and state guidance.
3. The developer opens Relevant Diff for item context, Proposed Worktree Diff
   for the complete publication candidate, or PR Context Diff for comparison.
4. The developer navigates files/hunks, copies text/path, and uses only safe
   open/reveal actions.
5. The developer edits response drafts when needed.
6. F20 exposes only the typed next actions allowed by F21/F22/F23; it does not
   publish or mutate the worktree itself.
```

### Workflow 4: Reopen an attention result

```text
1. A notification, tray route, restart, or inbox selection opens the bundle.
2. The workspace shows NEEDS_ATTENTION, the deterministic reason, preserved
   worktree/evidence, reports and usage, and the allowed next action.
3. The workspace also renders the latest F13 WorktreeCondition banner and
   identifies whether inspection, refresh, or an F22/F23 decision is required.
4. The developer can inspect evidence and choose a typed owning-workflow action.
5. A stale or revision-conflicted request is rejected and the workspace reloads
   the newer committed revision.
```

## Contract-Test Criteria

- **CT-F20-01:** Workspace read-model fixtures cover proposal/final stages, all primary states, item ordering, empty/loading/error/unknown/over-limit records, restart readback, deep-link selection, and stale revision rejection.
- **CT-F20-02:** Proposal decision fixtures cover exact immutable feedback display, accept/override controls, all four dispositions, bounded instructions, required question answers, superseded questions, duplicate decisions, and implementation gating.
- **CT-F20-03:** Final-review fixtures cover human decision snapshots, editable response drafts, draft revisions, no-publication side effects, and state-gated downstream action routing.
- **CT-F20-04:** Validation/evidence fixtures cover separate baseline/post-change records, passed/failed/not-run/interrupted/manual statuses, exact command evidence, provider-claim versus deterministic-evidence labels, turn reports, usage, stop reasons, and policy/profile snapshots.
- **CT-F20-05:** Diff fixtures cover relevant/proposed/context authority labels, `prBaseSha`/`prHeadSha`/`worktreeBaselineSha`, every file type, line/hunk navigation, collapsed context, syntax metadata, full-diff coverage, over-limit behavior, stale/missing evidence, and no patch reconstruction.
- **CT-F20-06:** OS-action fixtures cover copy/open/reveal worktree and file targets, F13/F04 authorization, missing/moved/unauthorized paths, developer-clone negative cases, and delegated adapter failure.
- **CT-F20-07:** State/action fixtures cover calm `READY_FOR_REVIEW`, persistent `NEEDS_ATTENTION`, permitted next actions, disabled unavailable actions, no-color semantics, and reason/why/next guidance.
- **CT-F20-08:** Accessibility fixtures cover keyboard order, focus restoration, accessible names/roles, screen readers, forced colors/high contrast, reduced motion, zoom, narrow widths, wrapping, and long-diff scrolling.
- **CT-F20-09:** Boundary fixtures prove no provider SDK, GitHub, Git, validation, publication, discard, re-evaluation, arbitrary path, credential, or raw SDK/object path is reachable from F20.
- **CT-F20-10:** Dirty-worktree fixtures cover every F13 `WorktreeCondition`, fresh fingerprint/revision display, attribution/overlap evidence, persistent banner, clean/AI-only/un-attributed/mixed/stale action gates, refresh/revision races, F22 delegation for destructive choices, F23 publication blocking, and developer-clone preservation.

## Requirement Traceability

| Requirement family | Observable acceptance criteria | Named contract tests |
|---|---|---|
| FR-01 | AC-01-AC-04, AC-21-AC-23 | CT-F20-01, CT-F20-07 |
| FR-02 | AC-05-AC-11, AC-23 | CT-F20-02, CT-F20-09 |
| FR-03 | AC-12, AC-14, AC-23 | CT-F20-03, CT-F20-07 |
| FR-04 | AC-13-AC-14, AC-21-AC-24 | CT-F20-04, CT-F20-07 |
| FR-05 | AC-04, AC-15-AC-19, AC-22-AC-24 | CT-F20-05, CT-F20-08 |
| FR-06 | AC-01, AC-04, AC-20, AC-22-AC-25 | CT-F20-06, CT-F20-09, CT-F20-10 |
| FR-07 | AC-04, AC-11, AC-14, AC-21-AC-25 | CT-F20-07, CT-F20-08, CT-F20-10 |
| FR-08 | AC-01, AC-03-AC-04, AC-23-AC-24 | CT-F20-01, CT-F20-09 |
| NFR-01-NFR-08 | AC-01-AC-04, AC-12-AC-24 | CT-F20-01-CT-F20-09 |
| INV-01-INV-09 | AC-01-AC-04, AC-07-AC-11, AC-15-AC-24 | CT-F20-01-CT-F20-09 |
