# F22 - Discard, Stale Detection, and Re-evaluation with Dirty-Worktree Choices - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F03 - SQLite persistence, migrations, and transactional repositories | Provides durable operation intents, expected-revision checks, immutable history, and restart-safe transactions for stale, discard, and re-evaluation actions. |
| 2 | F10 - Independent, efficient PR feedback polling | Provides the current server-scoped PR metadata/head observations and immutable feedback versions observed while a bundle is held. |
| 3 | F11 - Event eligibility, deduplication, and per-PR review holds | Provides handled-version associations, retained-during-hold versions, explicit re-evaluation authorization, and the per-PR hold release/transfer contract. |
| 4 | F13 - Operation-owned Git worktrees and change attribution | Provides fresh `WorktreeCondition` evidence, authoritative diffs, immutable before/after snapshots, and the three safe dirty-worktree choices. |
| 5 | F16 - AI preferences, task-profile snapshots, execution policies, and Common Instructions | Provides the current Automatic Review / Re-evaluation profile, policy, instructions, Build & Validation, and PR Intent / Context snapshots for a new evaluation. |
| 6 | F18 - Automatic review-to-Review-Bundle vertical slice | Provides the Review Bundle lifecycle, proposal/final stage, immutable item inputs, re-evaluation handoff, and bundle read model. |
| 7 | F20 - Review Bundle workspace and complete diff viewer | Provides the accessible action surface that displays stale evidence, dirty changes, and the explicit discard/re-evaluation choices. |
| 8 | F21 - Read-only conversation and worktree-mutating review revisions | Provides the active-operation/revision status and refreshed evidence that F22 must not replace or race while work is in progress. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F19 - System tray, native notifications, deep links, and shutdown | Consumes bounded stale/attention outcomes and routes the developer to the affected bundle without granting discard or re-evaluation authority. |
| 2 | F23 - Human-approved, idempotent Review Bundle publication | Consumes F22's stale/action gate and must refuse publication of a bundle whose recorded head is no longer current. |
| 3 | F28-F30 - Recovery, security, and release readiness | Reconcile interrupted choices, verify the no-loss worktree boundary, and exercise the complete stale/discard/re-evaluation workflow on Windows. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-10 | FR-04.4, INV-05 | AC-14 | Shared: F13/F18 own worktree creation and isolation; F22 requests a distinct operation-owned worktree for re-evaluation and never reuses the old path. |
| APP-AC-14 | FR-04.4-FR-04.8, FR-06.1-FR-06.5, INV-01, INV-10 | AC-14-AC-18 | Shared: F18 owns Review Bundle persistence; F22 creates the linked re-evaluation handoff and preserves the prior bundle. |
| APP-AC-16 | FR-05.3-FR-05.5, FR-06.1-FR-06.3, INV-06-INV-07 | AC-11, AC-14-AC-16 | Shared: F11/F18 own the legal hold transitions; F22 preserves the hold through stale handling and transfers it to an explicit re-evaluation, or releases it only after a completed discard. |
| APP-AC-17 | FR-06.1-FR-06.7, INV-01-INV-04 | AC-17-AC-19 | Shared: F04/F28 own application lifecycle; F22 makes its action intents and outcomes restart-safe without renderer authority. |
| APP-AC-21 | FR-01.7, FR-03.8, FR-04.4, INV-03-INV-05 | AC-05, AC-08-AC-09, AC-14-AC-16 | Shared: F13/F20 own complete diff truth and presentation; F22 preserves old evidence and requests fresh diff identity for re-evaluation. |
| APP-AC-23 | FR-03.1-FR-03.9, FR-07.1-FR-07.4, INV-05-INV-08 | AC-06-AC-11, AC-19-AC-20 | Primary: F22 owns the explicit discard flow and its dirty-worktree choice contract; F13 performs the safe clear operation and F20 presents it. |
| APP-AC-24 | FR-05.1-FR-05.6, INV-06-INV-07 | AC-11, AC-14-AC-16 | Shared: F11 remains authoritative for permanent handled associations; F22 supplies the discard/re-evaluation outcome and never replays handled versions through ordinary eligibility. |
| APP-AC-25 | FR-02.5, FR-05.4-FR-05.6, INV-07 | AC-01, AC-11, AC-14-AC-16 | Shared: F10 stores versions during a hold, F11 exposes them after release, and F22 includes them only through an explicit re-evaluation or later eligible batch. |
| APP-AC-26 | FR-02.1-FR-02.8, FR-04.1-FR-04.5, FR-07.2, INV-02-INV-04, INV-09 | AC-01-AC-05, AC-12-AC-15 | Primary: F22 detects proven PR-head movement, marks the bundle stale, and supplies the publication-blocking gate; F23 performs its final pre-publication recheck. |
| APP-AC-39 | FR-03.3-FR-03.9, FR-04.2-FR-04.4, FR-07.1-FR-07.4, INV-05-INV-06 | AC-06-AC-10, AC-12-AC-13, AC-19 | Shared: F22 owns the user choice and no-silent-change flow; F13 owns attribution/clear mechanics and F20 owns the visual presentation. |
| APP-AC-60 | FR-04.5-FR-04.6, FR-08.1-FR-08.3, INV-10 | AC-14-AC-16 | Shared: F16/F18 own task-profile routing and provider execution; F22 ensures re-evaluation uses the declared current Automatic Review / Re-evaluation snapshot. |
| APP-AC-61 | FR-04.5-FR-04.8, FR-08.3, INV-10 | AC-14-AC-16, AC-19 | Shared: F16/F18 own immutable configuration snapshots; F22 keeps old and new snapshots separate across re-evaluation. |
| APP-AC-62 | FR-04.5-FR-04.6, FR-07.1-FR-07.2, INV-09-INV-10 | AC-12, AC-14-AC-16 | Shared: F16/F18/F20 own AI metadata and presentation; F22 supplies the new task/profile/policy snapshot and deterministic no-publication boundary. |
| APP-AC-64 | FR-04.5-FR-04.8, FR-06.1-FR-06.5, INV-01, INV-10 | AC-14-AC-18 | Shared: F03/F16/F17/F18 own provider-neutral execution records; F22 links the current re-evaluation snapshot and preserves prior metadata. |
| APP-AC-69 | FR-04.7, FR-05.1-FR-05.4, INV-07 | AC-11, AC-14-AC-16 | Shared: F10/F11 own immutable event versions; F22 passes exact version identities through discard and explicitly authorized re-evaluation without rewriting them. |
| APP-AC-70 | FR-04.5-FR-04.6, FR-08.1-FR-08.4, INV-09-INV-10 | AC-14-AC-16, AC-20 | Shared: F16/F15 own policy resolution/enforcement; F22 requires a new bounded snapshot and never grants publication authority. |
| APP-AC-71 | FR-04.6, FR-08.2-FR-08.3, INV-09 | AC-15, AC-20 | Shared: F18/F15 own the read-only proposal floor; F22's re-evaluation confirmation authorizes preparation only and cannot authorize mutation or publication. |
| APP-AC-41 | FR-04.6-FR-04.7, FR-08.2, INV-10 | AC-14-AC-16 | Shared: F16/F18 own context resolution and bundle snapshots; F22 ensures a re-evaluation receives a new explicit snapshot while the original remains inspectable. |
| APP-AC-42 | FR-04.7, FR-05.5, FR-08.2, INV-10 | AC-14-AC-16, AC-19 | Shared: F22 preserves the old bundle's meaning and history; only the explicitly authorized re-evaluation may use the edited context. |
| APP-AC-74 | FR-04.5-FR-04.7, FR-07.1, FR-08.3, INV-10 | AC-12, AC-14-AC-16 | Shared: F00/F16/F18 own validation configuration and execution; F22 snapshots the current trusted context for re-evaluation without turning prose into authority. |
| APP-AC-67 | FR-02.4-FR-02.8, FR-04.4-FR-04.7, FR-07.2, INV-03-INV-04 | AC-03-AC-05, AC-12-AC-16 | Shared: F13 owns the three SHA/diff records, F22 creates fresh re-evaluation snapshots and blocks stale use, and F23 owns publication selection. |
| APP-AC-73 | FR-04.5-FR-04.7, FR-08.1-FR-08.3 | AC-14-AC-16 | Shared: F14/F18 own validation execution and phase ordering; F22 starts re-evaluation through those typed contracts and never treats a prior result as current. |
| APP-AC-75 | FR-02.6-FR-02.8, FR-07.1-FR-07.4 | AC-03-AC-05, AC-12-AC-15, AC-19 | Shared: F22 supplies deterministic stale/attention reasons and next actions; F20 owns the accessible ready/attention treatment. |

### Explicit coverage boundaries

F22 is the workflow owner for Review Bundle discard, proven stale detection,
re-evaluation, and the decision required before a dirty operation worktree is
cleared or replaced. F13 remains the only authority for actual Git state,
attribution, three-way removal, and canonical worktree paths. F11 remains the
only authority for handled-version associations and legal per-PR hold
transitions. F18 remains the only owner of Review Bundle proposal/finalization
and invokes the current Automatic Review / Re-evaluation task. F20 presents
the flow, F21 owns active conversation/revision work, and F23 owns final
publication.

F22 does not claim initial review preparation, semantic review, provider
execution, validation execution, commits, pushes, response posting, branch
synchronization, merge-conflict resolution, or publication. It does not make
ordinary polling re-analyze a handled version. It supplies the explicit
human-authorized re-evaluation path required to revisit prior inputs.

## Executive Summary

Review work becomes unsafe when the remote PR head moves or when a developer
has edited the isolated worktree. Publishing the old result after a remote
change could overwrite work the developer has not reviewed. Replacing a dirty
worktree without a visible choice could discard manual edits, build outputs, or
earlier investigation.

F22 gives the developer a durable way to handle those situations. It compares
the bundle's recorded `prHeadSha` with a fresh server-scoped observation during
polling and immediately before an action. A proven mismatch makes the bundle
stale, preserves its history and worktree, and blocks publication until the
developer explicitly re-evaluates or discards it. A failed or unavailable
freshness check is not treated as proof of movement; it becomes a bounded
attention condition and still blocks unsafe action.

When the developer chooses **Discard** or **Re-evaluate**, F22 first obtains a
fresh F13 `WorktreeCondition`. If the worktree is dirty, the developer must
choose **Clear All Changes**, **Clear Only AI Changes**, or **Keep Worktree and
Cancel**. F22 delegates the first two choices to F13 and fails closed when
three-way attribution cannot safely separate AI changes from other changes.
Discard preserves handled-version history and releases the hold only after the
choice completes. Re-evaluation keeps the hold, creates a new operation-owned
worktree at the current PR head, uses a new current Automatic Review /
Re-evaluation snapshot, and links the new bundle to the old one without
rewriting either history.

## User Stories

### Detect and understand stale work

- **US-01:** **GIVEN** a Review Bundle records a PR head SHA, **WHEN** polling or a user action obtains a newer authoritative head SHA, **THEN** the bundle is marked stale with the expected and observed identities, its history/worktree remain available, and publication is blocked.
  - **Acceptance Criteria:** AC-01-AC-05, AC-12.
- **US-02:** **GIVEN** a remote-head check fails or is unavailable, **WHEN** the developer opens or acts on the bundle, **THEN** PRMonitor does not guess that the head moved and instead shows a bounded attention reason with a safe next action.
  - **Acceptance Criteria:** AC-02-AC-05, AC-19.

### Discard without losing work

- **US-03:** **GIVEN** a developer no longer wants a pending Review Bundle, **WHEN** they choose **Discard**, **THEN** PRMonitor shows the current worktree condition and requires an explicit confirmation before completing the discard.
  - **Acceptance Criteria:** AC-06-AC-08, AC-11.
- **US-04:** **GIVEN** a dirty operation worktree, **WHEN** the developer chooses a dirty-worktree option, **THEN** **Clear All Changes** and **Clear Only AI Changes** invoke their named deterministic F13 behavior, while **Keep Worktree and Cancel** leaves every change and the bundle available.
  - **Acceptance Criteria:** AC-07-AC-10, AC-19.
- **US-05:** **GIVEN** a discard completes, **WHEN** monitoring resumes, **THEN** event versions handled by the discarded bundle remain handled, new versions observed during the hold are not lost, and only still-eligible feedback can enter a later automatic batch.
  - **Acceptance Criteria:** AC-11, AC-16.

### Re-evaluate against current remote state

- **US-06:** **GIVEN** a stale or attention Review Bundle, **WHEN** the developer chooses **Re-evaluate**, **THEN** PRMonitor shows the current remote identities, dirty-worktree evidence, feedback scope, and new configuration boundary before any replacement work begins.
  - **Acceptance Criteria:** AC-03-AC-05, AC-12-AC-14.
- **US-07:** **GIVEN** the re-evaluation confirmation and worktree choice are complete, **WHEN** re-evaluation starts, **THEN** it creates a new operation-owned worktree at the current PR head, snapshots the current Automatic Review / Re-evaluation inputs, and asks F18 to prepare a new read-only proposal.
  - **Acceptance Criteria:** AC-14-AC-16.
- **US-08:** **GIVEN** a re-evaluation fails, is cancelled, or becomes stale again, **WHEN** the developer reopens PRMonitor, **THEN** prior bundle history and the new attempt's evidence remain visible, the hold remains active, and no replacement attempt starts automatically.
  - **Acceptance Criteria:** AC-15, AC-17-AC-19.

### Preserve explicit ownership and restart safety

- **US-09:** **GIVEN** the renderer closes, two commands race, or a process stops at a durable boundary, **WHEN** F22 reconciles, **THEN** it returns the existing intent or a truthful attention result without duplicating a clear, worktree, bundle, provider, or hold effect.
  - **Acceptance Criteria:** AC-11, AC-17-AC-20.
- **US-10:** **GIVEN** a keyboard, screen-reader, high-contrast, or narrow-window user opens a stale/dirty bundle, **WHEN** they inspect and confirm an action, **THEN** the choices, destructive consequences, reason, evidence, and next action remain understandable without color, hover, or horizontal overflow.
  - **Acceptance Criteria:** AC-19-AC-20.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** F10 has committed a current PR metadata observation whose server-scoped `prHeadSha` differs from a non-terminal Review Bundle's recorded `prHeadSha`, **WHEN** F22 consumes that observation, **THEN** F22 commits one stale transition containing the expected SHA, observed SHA, observation revision/time, deterministic reason, and bundle revision; it does not delete, reset, replace, or mutate the bundle worktree.
- **AC-02:** **GIVEN** polling or an action-time remote-head read fails, is cancelled, is malformed, or is too old for the action's freshness bound, **WHEN** F22 evaluates freshness, **THEN** it does not claim that the head moved, records a bounded `REMOTE_HEAD_CHECK_UNAVAILABLE` or equivalent attention reason, and blocks any action that relies on current remote identity until a fresh check succeeds.
- **AC-03:** **GIVEN** a stale transition has been committed, **WHEN** the same mismatch is observed again or the renderer repeats the action, **THEN** the existing stale result is returned idempotently, the stale reason is not silently cleared even if the remote later returns to the old SHA, and no second stale event, provider turn, worktree replacement, or publication intent is created.
- **AC-04:** **GIVEN** a Review Bundle is `WORKING` with an active F18/F21 operation, **WHEN** polling observes a changed remote head, **THEN** F22 records the invalidation evidence without cancelling or mutating the active operation; after the owning operation reaches a stable outcome, the result is stale or attention-blocked before any further user action.
- **AC-05:** **GIVEN** a bundle is stale or has an unresolved freshness/condition reason, **WHEN** F20 or F23 requests action availability, **THEN** the typed projection says why the recorded result is unsafe, preserves inspection/discard/re-evaluation actions only where permitted, and refuses publication or continuation of the old work as if it were current.
- **AC-06:** **GIVEN** the developer chooses **Discard** for a bundle and F22 has a fresh worktree/remote-condition read, **WHEN** the user confirms the discard and the worktree requires no destructive change, **THEN** F22 persists the discard intent, asks F11 to record the bundle outcome and release the hold, marks the bundle `DISCARDED`, and preserves the bundle, feedback-version associations, and recorded worktree path for history.
- **AC-07:** **GIVEN** **Discard** or **Re-evaluate** would affect a non-clean operation worktree, **WHEN** F22 presents the decision, **THEN** the UI shows the actual bounded dirty summary, current fingerprint/revision, attribution/overlap evidence, and exactly **Clear All Changes**, **Clear Only AI Changes**, and **Keep Worktree and Cancel**; no Git or file mutation occurs before the choice is durably confirmed.
- **AC-08:** **GIVEN** the developer explicitly confirms **Clear All Changes**, **WHEN** F22 delegates the choice to F13, **THEN** F13 re-inspects the owned worktree, removes only the supported tracked/staged and non-ignored untracked changes in that worktree, preserves ignored files and the developer clone, records the clear result, and F22 continues only after a fresh post-clear condition is safe.
- **AC-09:** **GIVEN** the developer explicitly chooses **Clear Only AI Changes**, **WHEN** F13 compares the recorded before/after AI snapshots with the current worktree, **THEN** only safely separable AI-attributable changes are removed; independent other changes are preserved; any line/file/binary/rename/delete/untracked overlap or unknown condition leaves the worktree unchanged and returns an actionable attention result.
- **AC-10:** **GIVEN** the developer chooses **Keep Worktree and Cancel**, **WHEN** the choice is committed, **THEN** F22 performs no clear, reset, replacement, deletion, or re-evaluation, leaves the bundle and all evidence available, and keeps the per-PR hold and current state unchanged except for a recorded cancelled-action event.
- **AC-11:** **GIVEN** a discard succeeds after the selected worktree choice, **WHEN** F11 commits the outcome, **THEN** every version handled by the discarded bundle remains permanently associated with that bundle for automatic eligibility purposes, new versions observed during the hold remain retained/unhandled as appropriate, and a later automatic batch cannot replay the discarded bundle's exact versions.
- **AC-12:** **GIVEN** a stale or attention bundle can be re-evaluated, **WHEN** the developer opens the confirmation, **THEN** the preview shows the current PR/base/head repository identities, current `prBaseSha`/`prHeadSha`, original feedback-version IDs, retained feedback selected by the explicit re-evaluation contract, current worktree condition, and the fact that publication is not authorized by confirmation.
- **AC-13:** **GIVEN** the developer cancels the re-evaluation preview or selects **Keep Worktree and Cancel**, **WHEN** the command completes, **THEN** no new worktree, provider turn, validation run, or bundle is created and the previous bundle/worktree/history/hold remain available.
- **AC-14:** **GIVEN** the developer confirms re-evaluation and the dirty-worktree choice completes safely, **WHEN** F22 starts the operation, **THEN** it persists a new re-evaluation identity before effects, obtains a new operation-owned worktree at the current `prHeadSha`, records fresh `prBaseSha`, `prHeadSha`, and `worktreeBaselineSha`, and resolves the current Automatic Review / Re-evaluation profile, policy, Common Instructions, Build & Validation, and PR Intent / Context snapshots through F16.
- **AC-15:** **GIVEN** a re-evaluation operation is admitted, **WHEN** F18 prepares it, **THEN** the new proposal contains the exact original feedback versions plus the explicitly authorized retained versions, references the old bundle and prior history, runs the applicable baseline/review-proposal flow read-only, and keeps the per-PR hold transferred to the new bundle without making the old bundle publishable.
- **AC-16:** **GIVEN** re-evaluation reaches a proposal or attention outcome, **WHEN** the new bundle is committed, **THEN** the new bundle has immutable current snapshots and a new operation/bundle identity, the prior bundle remains inspectable and linked as superseded/stale history, new feedback not selected remains available for later eligibility, and the PR remains held until a later explicit publish, discard, or re-evaluation outcome.
- **AC-17:** **GIVEN** a clear, discard, or re-evaluation intent is cancelled, interrupted, or has an uncertain delegated result, **WHEN** F22 restarts or reconciles, **THEN** it distinguishes uncommitted from committed intent, reuses the same identity, preserves the worktree and evidence, never reports an unproven clear/replacement as successful, and never starts an automatic replacement provider turn.
- **AC-18:** **GIVEN** a duplicate command or a competing discard/re-evaluation request targets the same bundle, **WHEN** the main process evaluates it, **THEN** an equal request returns the existing result, a stale bundle/action revision is rejected with refresh guidance, and only one choice/re-evaluation owner can mutate the workflow at a time.
- **AC-19:** **GIVEN** the F22 read model is rendered or a choice is submitted, **WHEN** the user uses keyboard navigation, a screen reader, forced colors/high contrast, reduced motion, zoom, or a narrow window, **THEN** stale versus attention status, expected/observed SHAs, dirty changes, destructive consequences, required confirmation, errors, focus, and next actions remain operable and understandable without color, hover, animation, or horizontal overflow.
- **AC-20:** **GIVEN** an F22 request contains arbitrary paths, credentials, provider objects, raw remote payloads, unsupported commands, oversized text, or publication authority, **WHEN** it crosses the main-process, persistence, provider, or renderer boundary, **THEN** it is rejected or excluded with a bounded safe reason before any effect, and no F22 path can commit, push, post, resolve, merge, or publish.

## Functional Requirements

### FR-01: Stale observation and remote-head identity

- FR-01.1: F22 SHALL consume only explicit server-scoped managed-PR identity and F10/F06 typed current-remote metadata; it SHALL not infer a PR head from a display label, local branch name, cached activity text, or same-named repository.
- FR-01.2: F22 SHALL compare the immutable bundle `prHeadSha` with a fresh authoritative remote PR-head SHA and SHALL record expected SHA, observed SHA, repository identity, observation revision, and a bounded reason for every mismatch or unavailable check.
- FR-01.3: F22 SHALL detect a proven head movement from renderer-independent polling and SHALL also perform a bounded fresh remote-head check at every action boundary that depends on current remote identity.
- FR-01.4: F22 SHALL not classify an unavailable, malformed, cancelled, or stale freshness read as proof of remote movement; it SHALL expose an attention/blocking condition until a fresh authoritative result is available.
- FR-01.5: Once a bundle is marked stale because its assumptions were invalidated, F22 SHALL retain that stale classification until an explicit re-evaluation or discard outcome supersedes it; a later matching SHA SHALL not silently restore publication eligibility.
- FR-01.6: A head movement observed while F18/F21 work is active SHALL be recorded as invalidation evidence without F22 cancelling, resetting, replacing, or mutating the active worktree or provider operation.
- FR-01.7: F22 SHALL preserve the bundle's original history, worktree path, SHA snapshots, feedback associations, reports, decisions, drafts, and validation evidence when it marks the bundle stale or attention-blocked.
- FR-01.8: F22 SHALL expose a typed freshness/action-gate result to F20/F21/F23; consumers SHALL not parse F10 activity, GitHub responses, or reason prose to decide whether stale work is safe.

### FR-02: Action-time revalidation and publication blocking

- FR-02.1: Before starting discard or re-evaluation, F22 SHALL revalidate the owning bundle/action revision, per-PR hold, active operation status, explicit remote-head identity, and F13 `WorktreeCondition`.
- FR-02.2: F22 SHALL reject a stale, competing, missing-owner, or unsupported action with a typed safe reason and a refresh/inspection/owning-workflow next action rather than guessing a current state.
- FR-02.3: F22 SHALL block any attempt to continue the old Review Bundle as current when the remote head or worktree evidence is stale/unknown, while still permitting a safe discard when its own required checks and user choice succeed.
- FR-02.4: F22 SHALL make `STALE`, `REMOTE_HEAD_CHECK_UNAVAILABLE`, `MIXED_OR_OVERLAP`, and `STALE_OR_UNKNOWN` conditions visible in the typed action projection and SHALL ensure F23 cannot treat them as publication-ready.
- FR-02.5: F22 SHALL persist an intent and immutable input snapshot before requesting F13 clear/replacement or F18 re-evaluation effects.
- FR-02.6: F22 SHALL use expected bundle/evidence/condition revisions and stable idempotency identities so a repeated request returns the committed result and a stale renderer cannot overwrite a newer decision.
- FR-02.7: F22 SHALL never use a local branch, provider claim, prior validation pass, or cached condition as a substitute for the fresh remote and worktree checks required by the action.
- FR-02.8: F22 SHALL preserve the distinction between a stale Review Bundle, the PR's primary review state, the per-PR hold, and any active synchronization overlay.

### FR-03: Explicit discard and dirty-worktree choices

- FR-03.1: F22 SHALL expose **Discard** only as an explicit user-directed action for a bundle state and operation status that the owning F18/F21 contract permits.
- FR-03.2: F22 SHALL persist the discard intent, bundle revision, remote/worktree evidence revision, and user confirmation requirement before any delegated clear or handled-outcome effect.
- FR-03.3: When the owned worktree is dirty or its condition requires a choice, F22 SHALL show the bounded actual change summary and SHALL require exactly one of **Clear All Changes**, **Clear Only AI Changes**, or **Keep Worktree and Cancel**.
- FR-03.4: F22 SHALL delegate **Clear All Changes** to F13 only after explicit destructive confirmation and SHALL continue only after F13 reports a fresh safe post-clear condition.
- FR-03.5: F22 SHALL delegate **Clear Only AI Changes** to F13's deterministic three-way attribution contract and SHALL treat overlap, un-attributed unsafe evidence, binary/rename ambiguity, or uncertain cleanup as a non-success that preserves the complete worktree.
- FR-03.6: F22 SHALL treat **Keep Worktree and Cancel** as a completed cancellation of the discard/replacement action, not as permission to clear later or as a successful discard.
- FR-03.7: F22 SHALL never silently reset, clean, checkout, overwrite, delete, or replace a worktree, and SHALL never target the developer's normal clone.
- FR-03.8: After a safe clear choice, F22 SHALL refresh F13 evidence and SHALL record what was removed, preserved, ignored, or left unresolved before finalizing the bundle outcome.
- FR-03.9: A successful discard SHALL preserve the recorded worktree and history by default; F22 SHALL not make worktree deletion an implicit side effect of releasing the bundle hold.

### FR-04: Re-evaluation preparation and current snapshots

- FR-04.1: F22 SHALL expose **Re-evaluate** only through an explicit user action and a typed F11/F18 authorization path; ordinary polling SHALL never start re-evaluation.
- FR-04.2: F22 SHALL provide a preview containing current remote repositories/branches/SHAs, the original feedback-version IDs, explicitly eligible retained versions, current worktree condition, and the fact that confirmation authorizes preparation/review only and not publication.
- FR-04.3: F22 SHALL cancel without effect when the developer closes the preview, chooses **Keep Worktree and Cancel**, or fails to provide the required confirmation.
- FR-04.4: After confirmation, F22 SHALL create a distinct re-evaluation operation/worktree at the current exact `prHeadSha`; it SHALL not reuse or overwrite the old Review Bundle worktree and SHALL record fresh `prBaseSha`, `prHeadSha`, and `worktreeBaselineSha` values.
- FR-04.5: F22 SHALL request the current Automatic Review / Re-evaluation profile, execution policy, Common Instructions, Build & Validation, and PR Intent / Context snapshot from F16 after the explicit authorization and before F18 starts the new proposal.
- FR-04.6: F22 SHALL ask F18 to run the new proposal/baseline workflow in read-only proposal mode and SHALL not grant implementation, commit, push, response, conversation-resolution, or publication authority as a result of re-evaluation confirmation.
- FR-04.7: The new re-evaluation input SHALL contain the original immutable feedback versions plus only the retained versions allowed by the explicit F11 authorization; original snapshots and the old bundle's meaning SHALL remain immutable.
- FR-04.8: F22 SHALL link the new operation/bundle to the prior bundle and preserve the old bundle as inspectable stale/superseded history rather than silently replacing its records.
- FR-04.9: A new bundle that is prepared after another head movement SHALL become stale or attention-blocked from fresh deterministic evidence and SHALL require another explicit outcome; F22 SHALL not loop automatically.

### FR-05: Hold and handled-version outcomes

- FR-05.1: F22 SHALL use F11's typed outcome contract to mark every version handled by a discarded bundle without deleting or rewriting the original immutable association.
- FR-05.2: F22 SHALL not make a handled version automatically eligible again because the bundle was discarded, marked stale, or re-evaluated.
- FR-05.3: F22 SHALL request F11's explicit re-evaluation authorization when original handled versions are included in a new evaluation, and SHALL preserve both the original handled association and the new re-evaluation link.
- FR-05.4: Versions observed during the hold that are not selected into the re-evaluation SHALL remain retained/unhandled according to F11 and SHALL become eligible only after the hold is released and the normal eligibility rules pass.
- FR-05.5: A successful discard SHALL release the per-PR hold only after the dirty-worktree choice, outcome persistence, and handled-association handoff are complete.
- FR-05.6: Re-evaluation SHALL keep the per-PR hold active while the old bundle is superseded and the new proposal is prepared; opening a screen, receiving a notification, or changing global pause SHALL not release it.

### FR-06: Failure, cancellation, restart, and idempotency

- FR-06.1: F22 SHALL persist intent and correlation data before F13 clear, F16 snapshot resolution, F18 re-evaluation, or F11 outcome effects.
- FR-06.2: F22 SHALL distinguish uncommitted, committed, cancelled, failed, interrupted, and uncertain results for every discard/re-evaluation phase.
- FR-06.3: A retry after renderer closure, process restart, timeout, network loss, provider failure, persistence failure, or uncertain delegated outcome SHALL reconcile the existing identity before starting any new effect.
- FR-06.4: F22 SHALL never auto-retry a clear, provider turn, validation run, worktree replacement, or re-evaluation after cancellation, failure, or uncertainty.
- FR-06.5: F22 SHALL preserve the old bundle, old worktree, retained feedback, reports, decisions, usage, and reasons when re-evaluation fails or is abandoned.
- FR-06.6: F22 SHALL reject a discard/re-evaluation request that races an active mutating F18/F21 operation unless the owning workflow first supplies a legal terminal/cancellation handoff; F22 SHALL not steal or share the active worktree.
- FR-06.7: F22 SHALL remain authoritative in the Electron main process and SHALL complete or reconcile its durable work when the renderer is absent or recreated.

### FR-07: Read model, accessibility, and downstream boundaries

- FR-07.1: F22 SHALL expose bounded provider-neutral projections for freshness evidence, WorktreeCondition, dirty choices, confirmations, action availability, prior/new bundle links, hold status, and deterministic next actions.
- FR-07.2: The projection SHALL state what happened, why it matters, what evidence is preserved, what the developer chose, and what action is permitted next; it SHALL distinguish stale from attention-unavailable.
- FR-07.3: F20-facing choices and confirmations SHALL have programmatic labels, destructive-action text, focus/error behavior, keyboard navigation, screen-reader semantics, forced-colors/high-contrast support, reduced-motion behavior, bounded wrapping, and no horizontal overflow.
- FR-07.4: F22 SHALL provide F19/F20/F23 typed target/action data without passing arbitrary paths, raw URLs, provider SDK objects, credentials, shell commands, or external-effect capabilities.

### FR-08: Trust boundary and deterministic re-evaluation handoff

- FR-08.1: F22 SHALL use F10/F06 for remote observation, F11/F18 for holds and bundle outcomes, F13 for worktree truth/clear, F16 for current snapshots, and F20/F21/F23 only through typed ports; it SHALL not import a provider SDK or implement duplicate Git/GitHub logic.
- FR-08.2: F22 SHALL not invoke an AI provider directly, run validation directly, commit, push, post responses, resolve conversations, merge branches, or publish remote state.
- FR-08.3: F22 SHALL make F18/F17/F14 evidence and the current re-evaluation snapshot authoritative over any provider prose, cached activity, old validation status, or renderer state.
- FR-08.4: F22 SHALL reject or redact credentials, authorization headers, SDK objects, secret-bearing environment values, arbitrary commands/paths, raw remote payloads, and unbounded diagnostic text before persistence or IPC.

## Non-Functional Requirements

- NFR-01: Determinism - Given the same remote-head observations, bundle/worktree revisions, user choice, F11 authorization, and injected clock, F22 SHALL produce equivalent stale, action-gate, discard, and re-evaluation decisions without AI judgment.
- NFR-02: Durability and recovery - Committed stale evidence, choice intents, clear outcomes, re-evaluation snapshots, bundle links, hold transitions, and safe reasons SHALL survive renderer closure and ordinary process restart.
- NFR-03: Idempotency and concurrency - Replayed polling, duplicate commands, stale renderer requests, persistence retries, and competing actions SHALL not create duplicate clear effects, worktrees, bundles, provider turns, handled associations, or hold releases.
- NFR-04: Safety and preservation - Manual edits, build/test changes, untracked files, ignored files, binary changes, rename/delete changes, and uncertain Git outcomes SHALL be preserved or handled only by the explicit F13 contract; the developer clone SHALL remain untouched.
- NFR-05: Bounded behavior - Remote evidence, dirty summaries, paths, feedback-version lists, preview text, diagnostics, and read models SHALL have finite published bounds and SHALL fail closed rather than silently truncate authoritative data.
- NFR-06: Security and least privilege - F22 SHALL expose no credentials, provider SDK objects, arbitrary filesystem/process authority, publication authority, or uncontrolled environment data to persistence, IPC, AI, or native surfaces.
- NFR-07: Main-process and Windows behavior - Stale/discard/re-evaluation work SHALL remain safe without a renderer and SHALL preserve typed current-desktop/deep-link and keyboard/accessibility contracts on supported Windows configurations.
- NFR-08: Explainability - Every user-actionable stale, unavailable, dirty, cancellation, failure, supersession, and re-evaluation outcome SHALL retain machine-readable reason data and a user-readable what/why/next explanation.

## Invariants

- INV-01: The Electron main process and F03 records are authoritative for F22 intents, revisions, stale outcomes, dirty choices, re-evaluation links, and hold handoffs; renderer memory and activity text are never authoritative.
- INV-02: A bundle is stale only when deterministic software has proven a remote-head mismatch or an explicit superseding re-evaluation invalidates the old result; unavailable evidence is not silently treated as movement.
- INV-03: A stale, unavailable, mixed/overlap, or stale/unknown condition cannot be treated as current or publication-ready; explicit re-evaluation or discard is required.
- INV-04: Stale detection and action-time checks preserve the exact server/repository/PR identity and compare exact SHAs; a repository default branch, local branch, provider claim, or cached label cannot substitute for the authoritative identity.
- INV-05: No discard or re-evaluation may clear, reset, replace, delete, or overwrite a worktree without the named user choice and F13's ownership/condition checks.
- INV-06: **Clear Only AI Changes** is fail-closed on overlap or uncertain attribution and never guesses which changes belong to the developer or AI.
- INV-07: Discard preserves immutable feedback versions and handled associations; re-evaluation revisits prior versions only through an explicit F11 authorization and never rewrites the old bundle.
- INV-08: The per-PR hold remains active through stale handling and re-evaluation and is released only after a successful explicit discard or a later publication outcome owned by another feature.
- INV-09: F22 has no AI, validation, commit, push, GitHub response, conversation-resolution, merge, or publication authority; confirmation of re-evaluation authorizes preparation/review only.
- INV-10: Original bundle/profile/policy/PR Intent / Context/validation/worktree snapshots remain immutable; a re-evaluation uses a new current snapshot and a new bundle identity.
- INV-11: F22 never automatically retries or loops after cancellation, failure, uncertainty, stale detection, or a second head movement; every further destructive or semantic action requires an explicit permitted command.

## Out of Scope

- Initial automatic Review Proposal, feedback polling, eligibility rules, quiet-period batching, and ordinary automatic re-analysis.
- Provider SDK invocation, semantic review, code generation, conversation execution, bounded AI turns, and conflict-resolution reasoning owned by F15-F18/F21/F26.
- Git/worktree creation, path canonicalization, current-state inspection, attribution, three-way removal, and OS open/reveal actions owned by F13/F04.
- Validation command discovery or execution owned by F00/F14.
- Commit, push, GitHub response posting, review/conversation resolution, merge, force push, and publication reconciliation owned by F23/F27.
- Managed PR branch synchronization source resolution and merge-result handling owned by F24-F27.
- Per-hunk patch acceptance, silent patch reconstruction, automatic rebase, blind `ours`/`theirs` conflict selection, webhook delivery, and worktree deletion as an implicit discard side effect.

## Product Decisions

- PD-01: Proven movement is required for `STALE` - A failed or old remote-head check produces a bounded attention condition and blocks unsafe action, but it does not invent an expected/observed mismatch.
- PD-02: Staleness is monotonic until explicit resolution - Once a result is invalidated, a later return to the old SHA cannot silently restore publication eligibility; the developer must re-evaluate or discard.
- PD-03: Dirty work is never implicitly cleared - Every destructive replacement path shows the actual current condition and requires one named choice: **Clear All Changes**, **Clear Only AI Changes**, or **Keep Worktree and Cancel**.
- PD-04: AI-only clearing is fail-closed - F13 may remove independently attributable AI changes and preserve other work, but overlap or uncertainty leaves the complete worktree untouched.
- PD-05: Re-evaluation receives a new operation/worktree - The old worktree and bundle remain historical evidence; a new worktree at the current PR head prevents manual edits or old Git state from being silently carried into the new baseline.
- PD-06: Re-evaluation may revisit old inputs only explicitly - The original immutable feedback versions can be included again only through F11's human-authorized re-evaluation contract, alongside the explicitly selected versions retained during the hold.
- PD-07: Current settings apply only to the new evaluation - The current Automatic Review / Re-evaluation profile, policy, Common Instructions, Build & Validation, and PR Intent / Context are snapshotted for the new bundle; the old bundle keeps its original snapshots.
- PD-08: The hold transfers, not releases - Re-evaluation supersedes the old bundle while keeping the PR held until the new bundle reaches an explicit publication, discard, or further re-evaluation outcome.
- PD-09: Discard does not mean automatic re-analysis - Handled versions remain handled after discard; only later still-eligible versions can enter ordinary automatic work.
- PD-10: Worktree paths are retained by default - F22 may clear contents through F13 after confirmation but does not delete the operation worktree as an unreviewed side effect of discard or re-evaluation.

## Implementation Decisions

- IMP-01: Use one main-process `StaleDiscardReevaluationCoordinator` - It owns durable action intents, expected-revision checks, action sequencing, safe reason mapping, and typed handoff to F10/F11/F13/F16/F18.
- IMP-02: Use a dedicated remote-head verification port - The port consumes F10/F06's explicit server/repository/PR identity and current metadata contract, performs no remote mutation, and returns proven mismatch versus unavailable as distinct outcomes.
- IMP-03: Reuse F13 `WorktreeCondition` - F22 never builds a second manual-versus-AI classifier. The current fingerprint, revision, dirty summary, attribution evidence, and permitted actions come from F13.
- IMP-04: Model discard and re-evaluation as durable sagas - Persist the action intent and phase before clear, new-worktree, snapshot, F18, or F11 effects; reconcile by stable identity after uncertain outcomes.
- IMP-05: Use an F11 re-evaluation authorization token - The token binds the old bundle, original/retained version set, hold owner, and expected revision. F18 consumes it to create the new bundle without rewriting handled history.
- IMP-06: Create a fresh re-evaluation worktree - F22 asks F13 for a distinct operation-owned path at the current exact head and retains the old path for inspection; no implicit reset or path reuse is allowed.
- IMP-07: Treat F18 as the proposal owner - F22 prepares the current snapshots and typed re-evaluation request, then F18 owns baseline/review-proposal sequencing, bundle commit, stage/state, and provider boundary.
- IMP-08: Expose one action-gate projection - F20, F21, and F23 consume the same freshness/condition/action result with explicit revision, reason, and next-action fields rather than deriving their own stale logic.

## Testing Decisions

- TST-01: Deep-test proven versus unavailable remote movement - Use F10/F06 fakes for same SHA, changed SHA, stale data, missing metadata, cancellation, malformed results, and a head that returns to an old SHA.
- TST-02: Deep-test dirty choices at the F13 boundary - Cover clean, AI-attributed-only, un-attributed, mixed/overlap, manual edits, build/test churn, untracked, binary, rename, deletion, ignored files, and developer-clone preservation.
- TST-03: Fault-inject persist-before-effect phases - Stop before/after stale transition, choice commit, F13 clear, post-clear inspection, F16 snapshot, F18 creation, F11 outcome, and hold transfer; prove no false success or duplicate effect.
- TST-04: Test handled-version and hold semantics - Verify discard preserves handled associations, retained versions remain available, explicit re-evaluation can revisit only authorized inputs, and the hold never releases on navigation, restart, or re-evaluation start.
- TST-05: Test fresh re-evaluation snapshots - Verify old/current settings, PR Intent / Context, SHA/diff, validation, reports, and worktree paths remain distinct and that the new proposal is read-only before decisions.
- TST-06: Test action races and restart - Cover duplicate commands, stale renderer revisions, concurrent discard/re-evaluate, active F21 revision, renderer closure, process restart, uncertain delegated outcomes, and no automatic retry.
- TST-07: Test accessibility and security semantics - Verify destructive confirmations, labels, focus, forced colors, keyboard/screen-reader operation, bounded data, path/credential rejection, and absence of publication authority.
- TST-08: Defer visual styling to F20 - F22 tests the typed read model, action capabilities, reason/next text, and delegation; F20 owns final layout and visual treatment.

## Proposed Modules

- MOD-01: Remote Head Freshness Verifier - Reads explicit current PR metadata through F10/F06 and distinguishes proven movement, unchanged, unavailable, and malformed outcomes.
- MOD-02: Stale Transition Projector - Persists monotonic stale/attention evidence and produces the shared action-gate projection.
- MOD-03: Action Revision and Ownership Gate - Validates bundle, hold, active-operation, condition, remote, and renderer revisions before an action.
- MOD-04: Dirty-Worktree Choice Coordinator - Presents/records the three named choices and delegates clear/re-inspection to F13.
- MOD-05: Discard Outcome Coordinator - Commits discard, handled-version, hold-release, and retained-worktree outcomes through F11/F18/F03.
- MOD-06: Re-evaluation Preview and Authorization Builder - Builds the user-visible preview and obtains the F11 authorization for original/retained inputs.
- MOD-07: Re-evaluation Operation Handoff - Resolves current F16 snapshots, requests a distinct F13 worktree, and hands the bounded request to F18.
- MOD-08: History and Hold Transfer Projector - Links old/new bundles, preserves old snapshots, and exposes hold transfer and retained-version state.
- MOD-09: Recovery and Idempotency Coordinator - Reconciles committed intents, uncertain effects, duplicate actions, and restart outcomes.
- MOD-10: F22 Read Model and Downstream Adapter - Exposes bounded stale, condition, choice, reason, next-action, F19 target, F20 UI, F21 gate, and F23 publication-block contracts.

## Workflows

### Workflow 1: Mark a bundle stale from polling

```text
1. F10 commits a current PR metadata observation for the explicit managed-PR scope.
2. F22 loads bundles and active-operation records whose recorded prHeadSha may be affected.
3. F22 compares exact server/repository/PR/head identity and SHA values.
4. If the head differs, F22 persists one monotonic stale transition and an
   action-gate revision; if the read is unavailable, it persists attention /
   freshness-unavailable evidence instead of guessing movement.
5. F20/F19 show the reason and preserved worktree/history. F23 receives a
   publication-blocking projection. No worktree or provider effect starts.
```

### Workflow 2: Discard a dirty Review Bundle

```text
1. The developer chooses Discard from an allowed bundle state.
2. F22 persists the discard intent, refreshes the remote head and F13 condition,
   and displays the expected/observed state and actual dirty summary.
3. The developer confirms a clean discard, Clear All Changes, Clear Only AI
   Changes, or Keep Worktree and Cancel.
4. F22 delegates a clear choice to F13 only after the required confirmation.
5. F13 re-inspects and returns the actual clear/preserve/overlap result.
6. If safe, F22 asks F11/F18 to record DISCARDED, preserve handled versions,
   and release the hold. If not safe, F22 preserves the bundle and attention
   evidence for another explicit action.
```

### Workflow 3: Re-evaluate against the current PR head

```text
1. The developer chooses Re-evaluate for a stale or attention result.
2. F22 refreshes remote identity and F13 WorktreeCondition and shows a preview
   of SHAs, feedback-version scope, current configuration, and consequences.
3. The developer confirms or cancels. A dirty worktree must first pass one of
   the three named choices; Keep Worktree and Cancel stops the flow.
4. F22 persists a re-evaluation intent and obtains F11's explicit authorization.
5. F16 snapshots current Automatic Review / Re-evaluation inputs. F13 creates
   a distinct clean worktree at the current prHeadSha.
6. F22 hands F18 the original/authorized retained versions and new snapshots.
   F18 runs baseline validation and a read-only proposal, then commits a new
   bundle linked to the old bundle.
7. The old bundle remains inspectable stale/superseded history and the PR hold
   remains active until a later explicit outcome.
```

### Workflow 4: Recover an interrupted action

```text
1. Startup loads pending/active/unknown F22 intents by stable action identity.
2. F22 reconciles the persisted phase with F13 path/condition, F11 hold/outcome,
   F16 snapshot, and F18 bundle records.
3. A proven committed effect is adopted; a proven uncommitted effect may retry
   the same identity; an ambiguous effect remains attention/unknown.
4. Renderer closure or restart does not reset the choice, create a second
   worktree/bundle, duplicate a clear, release the hold, or start AI.
```

## Contract-Test Criteria

- CT-F22-01: Remote-head fixtures cover unchanged, proven movement, cross-repository identity, missing/malformed/stale/cancelled reads, metadata `304` interaction, active `WORKING` operations, and a returned-to-old-SHA case; only proven movement becomes `STALE`.
- CT-F22-02: Stale transition fixtures cover expected/observed SHA evidence, monotonic state, duplicate observations, action-gate projection, preserved history/worktree, F20/F21/F23 typed consumers, and no publication/continuation effect.
- CT-F22-03: Action-boundary fixtures cover fresh remote/worktree revalidation, bundle/hold/evidence revisions, active-operation conflicts, stale renderer requests, duplicate requests, and discard-versus-re-evaluate permission matrices.
- CT-F22-04: Discard fixtures cover clean worktrees, explicit confirmation, handled-version preservation, hold release ordering, retained new feedback, stale bundles, response drafts, restart readback, and no automatic re-analysis.
- CT-F22-05: Dirty-choice fixtures cover **Clear All Changes**, **Clear Only AI Changes**, and **Keep Worktree and Cancel**, including ignored files, build/test churn, untracked/binary/rename/delete overlap, uncertain Git outcomes, byte-for-byte preservation on unsafe cases, and developer-clone protection.
- CT-F22-06: Re-evaluation preview fixtures cover current remote repositories/branches/SHAs, original and retained version scopes, current F16 snapshot summary, dirty evidence, publication-not-authorized wording, cancel/confirmation, and accessibility semantics.
- CT-F22-07: Re-evaluation handoff fixtures cover F11 authorization, new operation identity, distinct F13 worktree, fresh three SHA snapshots, current Automatic Review / Re-evaluation configuration, F18 read-only proposal, old/new bundle linkage, hold transfer, and no old-history rewrite.
- CT-F22-08: Snapshot/history fixtures cover changed Preferences, Common Instructions, Build & Validation, PR Intent / Context, remote head, validation, reports, usage, decisions, drafts, and old/new worktree paths; old bundle meaning remains immutable.
- CT-F22-09: Recovery fixtures cover persistence faults before/after each phase, renderer closure, restart, network loss, provider/F18 failure, F13 uncertainty, duplicate commands, competing actions, active F21 work, no auto-retry, and idempotent reconciliation.
- CT-F22-10: Boundary/accessibility fixtures cover bounded/redacted projections, no SDK/credential/raw-payload/arbitrary-path/command/publication capability, keyboard/screen-reader/forced-colors/reduced-motion/narrow-width choices, focus/error behavior, and F19/F20/F21/F23 consumer conformance.

## Requirement Traceability

| Requirement family | Observable coverage | Named contract tests |
|---|---|---|
| FR-01 | AC-01-AC-05, AC-12, AC-17 | CT-F22-01, CT-F22-02, CT-F22-09 |
| FR-02 | AC-02-AC-05, AC-12, AC-17-AC-18 | CT-F22-02, CT-F22-03, CT-F22-09 |
| FR-03 | AC-06-AC-11, AC-19 | CT-F22-03-CT-F22-05, CT-F22-09 |
| FR-04 | AC-12-AC-16, AC-18 | CT-F22-06-CT-F22-08 |
| FR-05 | AC-11, AC-14-AC-16 | CT-F22-04, CT-F22-07, CT-F22-08 |
| FR-06 | AC-13, AC-17-AC-20 | CT-F22-04, CT-F22-09, CT-F22-10 |
| FR-07 | AC-05, AC-07, AC-10, AC-12-AC-20 | CT-F22-02, CT-F22-06, CT-F22-10 |
| FR-08 | AC-14-AC-16, AC-20 | CT-F22-07, CT-F22-09, CT-F22-10 |
| NFR-01-NFR-08 | AC-01-AC-20 | CT-F22-01-CT-F22-10 |
| INV-01-INV-11 | AC-01-AC-20 | CT-F22-01-CT-F22-10 |
