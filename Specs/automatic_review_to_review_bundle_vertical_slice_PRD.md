# F18 - Automatic Review-to-Review-Bundle Vertical Slice - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F07 - Add and manage a pull request | Provides the managed PR, explicit base/head repository and branch identities, current PR metadata, validated local clone, and PR Intent / Context revisions. |
| 2 | F10 - Independent, efficient PR feedback polling | Provides immutable, content-hashed feedback-event versions and the current remote metadata used as review input. |
| 3 | F11 - Event eligibility, deduplication, and per-PR review holds | Provides the exact eligible-version claim, per-PR automatic-operation slot, hold contract, and handled/deferred association rules. |
| 4 | F12 - Review batching, scheduler, Check Now, and global pause | Provides the renderer-independent Review Batch dispatch handoff and distinguishes automatic dispatch from explicit user-directed work. |
| 5 | F13 - Operation-owned Git worktrees and change attribution | Creates and owns the isolated review worktree, records the three review SHA snapshots, inspects actual Git state, and materializes authoritative diffs. |
| 6 | F14 - Deterministic validation runner and result model | Runs only approved baseline/post-change validation and supplies real, phase-specific result evidence. |
| 7 | F15 - Provider-neutral AI contracts and Codex adapter | Supplies the normalized read-only Review Proposal and worktree-mutating Review Implementation boundaries, structured result validation, usage, and safe errors. |
| 8 | F16 - AI preferences, task-profile snapshots, execution policies, and Common Instructions | Resolves immutable Automatic Review / Re-evaluation and Review Revision snapshots, read-only floors, repository guidance, and PR context. |
| 9 | F17 - Bounded AI Work Controller and deterministic progress evaluation | Owns AI operation/segment lifecycle, timeouts, budgets, completion predicates, turn reports, progress, and stop reasons. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F19 - System tray, native notifications, deep links, and shutdown | Consumes F18's typed proposal/final/attention outcome handoff to produce outcome-oriented notifications and navigation targets. |
| 2 | F20 - Review Bundle workspace and complete diff viewer | Presents the F18 proposal/final read model, item decisions, validation evidence, turn reports, worktree path, and complete diffs. |
| 3 | F21 - Read-only conversation and worktree-mutating review revisions | Continues an existing bundle using the persisted snapshots, worktree, decisions, and F17 bounded-work records. |
| 4 | F22 - Discard, stale detection, and re-evaluation with dirty-worktree choices | Handles dirty-worktree decisions, stale bundles, discard, and explicit re-evaluation after F18 has preserved the bundle and evidence. |
| 5 | F23 - Human-approved, idempotent Review Bundle publication | Publishes only the final, explicitly approved proposed diff and selected responses after revalidation. |
| 6 | F28-F30 - Recovery, security, and release readiness | Hardens cross-feature recovery and validates the packaged Windows workflow using F18's durable evidence and boundary contracts. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-10 | FR-03.1-FR-03.5, INV-06 | AC-03-AC-05, AC-22 | Shared: F13 owns isolated-worktree creation and ownership; F18 requests the exact review worktree and refuses to continue without its typed handoff. |
| APP-AC-11 | FR-04.1-FR-04.5, FR-07.1-FR-07.4, INV-01, INV-10 | AC-06-AC-10, AC-14-AC-17 | Shared: F15 owns provider execution and the Codex adapter; F18 owns review task preparation, phase sequencing, and consumption of normalized results. |
| APP-AC-12 | FR-04.2-FR-04.4, INV-04, INV-08 | AC-07-AC-10 | Shared: F15 owns the structured-result contract; F18 requires exact input-event coverage and attaches each normalized item to its immutable bundle item. |
| APP-AC-13 | FR-03.3, FR-08.2, INV-08 | AC-05, AC-16-AC-17 | Shared: F14 owns command execution and exit-status truth; F18 owns baseline/post-change invocation timing and presents the phase distinction through its read model. |
| APP-AC-14 | FR-05.1-FR-05.4, FR-08.4, INV-02-INV-05 | AC-11, AC-18-AC-20 | Primary: F18 atomically persists the proposal and final Review Bundle records, item associations, decisions, snapshots, evidence, and hold-linked outcome. |
| APP-AC-15 | FR-05.3, FR-08.5 | AC-12, AC-24 | Shared: F18 emits a typed outcome/notification handoff after durable bundle state; F19 owns native notification delivery and deep-link behavior. |
| APP-AC-16 | FR-01.1-FR-01.5, FR-05.2-FR-05.4, FR-09.4, INV-09 | AC-01-AC-02, AC-11-AC-12, AC-19-AC-20 | Shared: F11/F02 own the durable hold and legal state transitions; F18 revalidates the claim, keeps the hold through proposal/final/attention outcomes, and never releases it implicitly. |
| APP-AC-17 | FR-01.5, FR-09.1-FR-09.3, INV-02 | AC-02, AC-11, AC-19, AC-23 | Shared: F04/F17 own process and bounded-work lifetime; F18 keeps orchestration in the main process and does not make renderer presence authoritative. |
| APP-AC-24 | FR-01.2, FR-05.1, FR-09.4, INV-05 | AC-02, AC-11, AC-19 | Shared: F11 owns permanent handled associations; F18 assigns the exact immutable versions to the bundle and supplies the final outcome needed for F11 completion. |
| APP-AC-25 | FR-01.2, FR-05.4, FR-09.4, INV-09 | AC-02, AC-19 | Shared: F11 retains feedback observed during the hold; F18 never absorbs those versions into the active bundle or releases the hold because of polling. |
| APP-AC-35 | FR-02.2, FR-05.1, INV-07 | AC-04, AC-11, AC-21 | Shared: F16 owns Common Instruction revisions; F18 snapshots and persists the effective text, IDs, revisions, and hashes used by the bundle. |
| APP-AC-36 | FR-02.2, FR-09.5, INV-07 | AC-04, AC-21 | Shared: F16 owns future-only settings semantics; F18 keeps an existing bundle tied to its immutable instruction snapshot. |
| APP-AC-37 | FR-03.1, FR-03.2, FR-09.1, INV-06 | AC-03, AC-10, AC-24 | Shared: F13 validates and snapshots the effective application-level worktree root; F18 carries the resolved root revision and operation path through the bundle, while F16 owns the preference surface and future-only setting changes. |
| APP-AC-39 | FR-03.2, FR-08.1, FR-09.2, INV-06 | AC-03, AC-05, AC-16, AC-19 | Shared: F13 owns manual-edit preservation and attribution; F18 inspects before handoffs and never resets, cleans, or replaces a dirty worktree. |
| APP-AC-38 | FR-03.1, FR-05.3, FR-08.1, INV-06 | AC-03, AC-10, AC-17, AC-24 | Shared: F13 owns canonical open/reveal safety; F18 persists the resolved bundle worktree path and exposes it in the downstream read model, while F19/F20 own the user action. |
| APP-AC-41 | FR-02.2, FR-02.3, INV-07 | AC-04, AC-21 | Shared: F07 owns editable PR Intent / Context; F16 resolves it and F18 includes its exact snapshot in the review input and bundle. |
| APP-AC-42 | FR-02.3, FR-09.5, INV-07 | AC-04, AC-21 | Shared: F07/F16 own future edits and revisioning; F18 never rewrites a completed bundle's context snapshot. |
| APP-AC-54 | FR-07.1, FR-09.2, INV-09 | AC-14, AC-17, AC-23 | Shared: F17 owns the persisted mutating-turn budget; F18 declares the proposal/implementation predicates and uses F17 rather than implementing a second loop. |
| APP-AC-55 | FR-04.1, FR-07.1, FR-09.1-FR-09.3 | AC-06, AC-10, AC-17, AC-19, AC-23 | Shared: F17 owns turn timeout and restart-safe accounting; F18 maps bounded stops to a bundle attention outcome without auto-retry. |
| APP-AC-56 | FR-05.1, FR-07.3, FR-08.4 | AC-11, AC-17, AC-20 | Shared: F17 owns complete AI Work Turn Reports; F18 persists and links proposal/implementation reports in the Review Bundle. |
| APP-AC-57 | FR-04.5, FR-07.4, FR-08.5, INV-08-INV-09 | AC-10, AC-17, AC-20 | Shared: F17 owns deterministic stop reasons; F18 turns a stop, invalid evidence, or provider failure into actionable `NEEDS_ATTENTION` while preserving worktree/evidence. |
| APP-AC-58 | FR-05.3, FR-07.4, FR-08.5 | AC-12, AC-17, AC-20, AC-24 | Shared: F17 supplies bounded history and permitted actions; F18 exposes them in the bundle outcome/read model and leaves final UI controls to F20/F21. |
| APP-AC-60 | FR-02.2, FR-04.1, FR-07.1, INV-07 | AC-04, AC-06, AC-14, AC-21 | Shared: F16/F15 own task routing and adapter translation; F18 declares Automatic Review / Re-evaluation or Review Revision explicitly for every turn. |
| APP-AC-61 | FR-02.2, FR-07.1, FR-09.5, INV-07 | AC-04, AC-06, AC-14, AC-21 | Shared: F16/F17 own immutable segment snapshots; F18 stores the proposal and implementation snapshot references and never rereads mutable Preferences mid-turn. |
| APP-AC-62 | FR-05.1, FR-07.1, FR-08.4 | AC-11, AC-17, AC-24 | Shared: F15-F17 supply provider-neutral execution metadata; F18 includes it in the bundle read model and deterministic/no-AI outcomes show zero AI usage. |
| APP-AC-64 | FR-02.2, FR-04.3, FR-05.1, FR-07.3, INV-10 | AC-04, AC-07, AC-11, AC-17, AC-20 | Shared: F03/F15/F17 own durable provider-neutral metadata; F18 links exact operation, profile, policy, conversation, usage, and report records without persisting SDK objects. |
| APP-AC-66 | FR-04.2, FR-07.3, FR-08.3, INV-11 | AC-08, AC-15 | Shared: F17 supplies the no-code completion predicate; F18 treats complete all-`pushback`/`question`/`no_change` proposals as valid outcomes rather than false no-progress. |
| APP-AC-67 | FR-03.1, FR-08.1, FR-08.4, INV-06 | AC-03, AC-05, AC-16-AC-18 | Shared: F13 owns SHA/diff truth and F20/F23 own presentation/publication; F18 records the three SHA snapshots and both diff references in the bundle. |
| APP-AC-69 | FR-01.2, FR-02.2, FR-05.1, INV-05 | AC-02, AC-04, AC-11 | Shared: F10/F11 own immutable version construction and handling; F18 references exact immutable version IDs and never uses a mutable remote object ID alone. |
| APP-AC-70 | FR-02.2, FR-04.1, FR-07.1, INV-10 | AC-04, AC-06, AC-14, AC-20 | Shared: F16 resolves the named policy and F15 enforces it; F18 supplies the operation-owned scope and refuses a missing or broadened policy. |
| APP-AC-71 | FR-03.5, FR-04.1-FR-04.5, FR-05.2, INV-04 | AC-06, AC-09-AC-11 | Primary workflow boundary: F18 keeps the Review Proposal read-only and prevents implementation, commit, push, or response posting before all item decisions. |
| APP-AC-72 | FR-06.1-FR-06.4, FR-07.2, INV-04 | AC-12-AC-14 | Primary workflow boundary: F18 records explicit accept/override decisions, final dispositions/instructions, and required question answers before implementation. |
| APP-AC-73 | FR-03.3, FR-08.2-FR-08.3, INV-08 | AC-05, AC-16-AC-17 | Primary workflow boundary: F18 orders baseline before proposal and post-change after accepted implementations; F14's real statuses remain authoritative. |
| APP-AC-74 | FR-02.2, FR-03.3, FR-05.1, INV-07-INV-08 | AC-04-AC-05, AC-11, AC-21 | Shared workflow boundary: F00/F16 own command trust and repository settings; F18 snapshots the effective instructions/profile and never treats free-form guidance as execution authority. |
| APP-AC-75 | FR-05.2, FR-08.5, INV-09 | AC-11-AC-12, AC-17, AC-20, AC-24 | Shared: F18 supplies distinct machine-readable `READY_FOR_REVIEW`/`NEEDS_ATTENTION` reasons and next actions; F20 owns the final visual treatment. |

## Executive Summary

F18 turns one deterministic, eligible review batch into a durable Review Bundle
that a developer can trust and inspect. It is the first end-to-end review
workflow: the exact immutable feedback versions are claimed, the PR is prepared
at a recorded head SHA in an operation-owned worktree, configured baseline
validation runs when available, and the selected AI provider produces a
read-only semantic proposal. The proposal is persisted before the developer is
asked to decide what should happen.

The developer must explicitly accept or override every proposal item. An item
whose effective disposition is `question` requires a bounded answer before
implementation can begin. Only final `fixed` decisions are implementation
instructions. Pushback, questions, and no-change decisions remain reviewable
semantic outcomes and are never silently turned into code edits.

After the decision gate, F18 may start a separately snapshotted, bounded Review
Revision operation. Deterministic Git inspection and validation then produce the
final bundle. A complete proposal with no code changes is valid. A provider
failure, policy stop, missing evidence, interrupted validation, or failed
post-change check produces `NEEDS_ATTENTION` with preserved evidence rather than
a guessed success. Nothing in this feature commits, pushes, posts a response,
resolves a conversation, or publishes to GitHub.

## User Stories

### Dispatch and reproducible preparation

- **US-01:** **GIVEN** F12 has handed off one exact eligible batch and F11's claim is still valid, **WHEN** the automatic review starts, **THEN** PRMonitor prepares one operation-owned worktree for that PR, records the exact PR and worktree SHAs, and includes every claimed immutable feedback version exactly once.
  - **Acceptance Criteria:** AC-01-AC-05, AC-11.
- **US-02:** **GIVEN** the PR, repository, instructions, and preferences may change later, **WHEN** the review input is assembled, **THEN** the bundle records the exact PR metadata, feedback versions, PR Intent / Context, Common Instructions, Build & Validation snapshot, task profile, and execution policy used for the evaluation.
  - **Acceptance Criteria:** AC-04, AC-21.

### Proposal before mutation

- **US-03:** **GIVEN** a clean review worktree and optional baseline evidence, **WHEN** the Automatic Review / Re-evaluation task runs, **THEN** it returns one structured assessment for every input version while the worktree remains unchanged and no publication capability is available.
  - **Acceptance Criteria:** AC-05-AC-10.
- **US-04:** **GIVEN** the provider returns pushback, question, no-change, or fixed recommendations, **WHEN** the proposal is saved, **THEN** each item shows its assessment, disposition, proposed implementation, proposed response when available, related files, and the immutable feedback it addresses.
  - **Acceptance Criteria:** AC-07-AC-11.

### Human decisions and implementation

- **US-05:** **GIVEN** a proposal-stage bundle is ready, **WHEN** the developer reviews it, **THEN** they can explicitly accept or override every recommendation, choose the final disposition and instructions for an override, and answer each still-effective question before implementation is enabled.
  - **Acceptance Criteria:** AC-12-AC-14.
- **US-06:** **GIVEN** all item decisions are complete, **WHEN** implementation starts, **THEN** the Review Revision task receives the final decisions and only accepted/overridden `fixed` decisions are eligible for code changes; the rejected recommendation is not silently reused.
  - **Acceptance Criteria:** AC-14-AC-16.
- **US-07:** **GIVEN** all final dispositions are pushback, question, or no-change, **WHEN** the decision gate completes, **THEN** no mutating AI turn is started, the unchanged worktree is inspected, and a valid final-review bundle is produced without being classified as generic no-progress.
  - **Acceptance Criteria:** AC-08, AC-15.

### Truthful outcomes and recovery

- **US-08:** **GIVEN** baseline or post-change validation is configured, unavailable, interrupted, or fails, **WHEN** F18 records the result, **THEN** the phase and real status remain visible and a model claim cannot create a pass.
  - **Acceptance Criteria:** AC-05, AC-16-AC-17.
- **US-09:** **GIVEN** the window closes, the process restarts, or a provider/Git/validation operation becomes uncertain, **WHEN** the review is reopened, **THEN** the same bundle, worktree, snapshots, decisions, reports, and reasons remain available; no automatic duplicate provider turn or hold release occurs.
  - **Acceptance Criteria:** AC-11, AC-18-AC-20, AC-23.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** F12 hands off an automatic batch, **WHEN** F18 admits it, **THEN** it revalidates one managed PR, the exact F11 claim/hold, the exact immutable version set, the current open/eligible PR state, and the scheduler revision; an empty, stale, cross-PR, already-handled, paused, or competing handoff is rejected without creating a worktree or starting AI.
- **AC-02:** **GIVEN** an eligible handoff passes revalidation, **WHEN** automatic review intent is created, **THEN** the operation/bundle identity and immutable input references are durably committed before F13, F14, F15, or F17 can cause the represented external effect; an equal retry returns the existing outcome and cannot create a second claim, bundle, worktree, or provider turn.
- **AC-03:** **GIVEN** a valid review operation owns a configured worktree root, **WHEN** preparation completes, **THEN** F13 has created or returned one clean isolated worktree at the explicit `prHeadSha`, recorded `prBaseSha`, `prHeadSha`, and `worktreeBaselineSha` separately, and proved that the developer's normal clone was not changed.
- **AC-04:** **GIVEN** the worktree is ready, **WHEN** F18 assembles review context, **THEN** the immutable input snapshot contains the PR title/description and explicit base/head identities, every claimed F10 version ID and semantic snapshot reference, PR Intent / Context, repository-native and Common Instructions snapshots, F00/F16 Build & Validation provenance, the Automatic Review task/profile revision, the read-only policy, the operation/worktree reference, and bounded hashes/revisions; it contains no credential, SDK object, or uncontrolled environment value.
- **AC-05:** **GIVEN** an authorized baseline profile has eligible commands, **WHEN** the review operation begins, **THEN** F14 runs baseline validation against the clean PR-head worktree before the Review Proposal, persists the real phase-specific results, and keeps baseline evidence separate from post-change evidence. A baseline failure or unavailable profile is an evidence-bearing attention condition rather than a hard pre-proposal hold: when the worktree and remaining evidence are safe, read-only semantic proposal analysis may continue with the attention reason visible; if the condition makes review unsafe, the bundle enters `NEEDS_ATTENTION`. It can never be shown as a post-change pass.
- **AC-06:** **GIVEN** F18 starts the initial proposal, **WHEN** the provider is invoked, **THEN** the declared task is Automatic Review / Re-evaluation, the effective policy is at least Read-only, F17 supplies bounded timeout/lifecycle handling, and F15 receives no commit, push, response-posting, publication, or writable-worktree authority.
- **AC-07:** **GIVEN** the proposal result is accepted, **WHEN** it is normalized, **THEN** it contains exactly one item for every claimed immutable feedback version and no unrequested item, with an allowed disposition of `fixed`, `pushback`, `question`, or `no_change`, an assessment, bounded proposed implementation/response fields, and related-file metadata when available. Missing, duplicate, out-of-scope, malformed, or prose-only output is rejected as non-success.
- **AC-08:** **GIVEN** the proposal accounts for every input version and all dispositions are `pushback`, `question`, or `no_change`, **WHEN** F17 evaluates the proposal predicate, **THEN** it completes successfully with the unchanged worktree, preserves any required question data, consumes no mutating-turn budget, and is not stopped as generic no-progress.
- **AC-09:** **GIVEN** the proposal provider times out, fails, is cancelled, violates policy, returns invalid output, or leaves uncertain evidence, **WHEN** F18 finalizes the proposal attempt, **THEN** it preserves the worktree, baseline evidence, provider metadata, usage, turn report, and safe reason, produces an actionable attention result, and starts no automatic replacement turn.
- **AC-10:** **GIVEN** a valid proposal is complete, **WHEN** F18 atomically commits the proposal stage, **THEN** the Review Bundle and all Review Bundle items, exact immutable event-version associations, context/configuration snapshots, baseline result, proposal result, operation/turn references, and `PROPOSAL_REVIEW` stage are committed together; the PR enters `READY_FOR_REVIEW` with its automatic hold, or enters `NEEDS_ATTENTION` with preserved evidence when the proposal cannot be reviewed safely.
- **AC-11:** **GIVEN** a proposal-stage bundle exists, **WHEN** the window closes, the process restarts, a notification is opened, or new feedback is polled, **THEN** the bundle and hold remain unchanged, no background worktree mutation or automatic analysis begins, and new immutable versions are retained separately for later eligibility.
- **AC-12:** **GIVEN** a proposal-stage bundle has N items, **WHEN** the developer records decisions, **THEN** every item must have exactly one explicit `accepted` or `overridden` decision before implementation; an override records the final disposition and bounded instructions, accepts only the declared four dispositions, and is idempotent for the same bundle version and decision identity.
- **AC-13:** **GIVEN** an item has a proposed or final `question` disposition, **WHEN** the decision surface is shown, **THEN** it exposes a required bounded answer textbox; implementation remains blocked while that question remains effective and unanswered. Overriding the item away from `question` records the superseding final disposition and does not silently retain the old question as implementation authority.
- **AC-14:** **GIVEN** every item has a valid final human decision and required effective question answers, **WHEN** implementation is authorized, **THEN** F18 persists the decision snapshot before the Review Revision turn, resolves the declared Review Revision profile/policy through F16, and passes F17/F15 only the final dispositions, answers, and instructions. A recommendation that was overridden is not sent as an instruction to implement.
- **AC-15:** **GIVEN** all final dispositions are non-code outcomes (`pushback`, `question`, or `no_change`), **WHEN** the decision gate is confirmed, **THEN** F18 starts no worktree-mutating provider turn, performs a fresh deterministic worktree inspection, records post-change validation as `not_run` with `NO_IMPLEMENTATION_CHANGES` when applicable, and persists a `FINAL_REVIEW` bundle that is valid for human review.
- **AC-16:** **GIVEN** at least one final disposition is `fixed`, **WHEN** the Review Revision operation completes or stops, **THEN** F13 supplies a fresh actual proposed-worktree diff and state, F14 runs the configured post-change validation after implementation, and F18 records the real result separately from provider claims. A failed, interrupted, unavailable, stale, or contradictory result cannot become a validation pass.
- **AC-17:** **GIVEN** the implementation predicate and required evidence are complete, **WHEN** the final bundle is committed, **THEN** it contains the final human decisions, answers/instructions, actual proposed-worktree and PR-context diff references, three SHA snapshots, post-change validation, proposed responses, all provider/turn/usage metadata, and a `FINAL_REVIEW` stage. It enters `READY_FOR_REVIEW` only when no blocking reason remains; otherwise it enters `NEEDS_ATTENTION` with what happened, why it matters, preserved evidence, and the permitted next action.
- **AC-18:** **GIVEN** a Review Revision turn times out, fails, is cancelled, exhausts its budget, repeats state, or makes insufficient deterministic progress, **WHEN** F17 stops it, **THEN** F18 preserves the operation history and worktree, maps the machine-readable reason to `NEEDS_ATTENTION`, and requires an explicit downstream continuation/retry/re-evaluation action; it never auto-retries or releases the hold.
- **AC-19:** **GIVEN** persistence, worktree, validation, provider-result, or process outcome is uncertain after intent commit, **WHEN** F18 recovers, **THEN** it reconciles by stable operation/bundle identity, retains the last committed truth and unresolved evidence, never creates a duplicate provider turn or bundle, and never represents uncertainty as success.
- **AC-20:** **GIVEN** the proposal or final bundle reaches `READY_FOR_REVIEW` or `NEEDS_ATTENTION`, **WHEN** its read model is consumed, **THEN** it distinguishes proposal versus final stage, provider claims versus deterministic evidence, baseline versus post-change validation, and permitted next actions using bounded semantic labels that do not require color or free-form log parsing.
- **AC-21:** **GIVEN** PR Intent / Context, Common Instructions, Build & Validation settings, profiles, policies, or remote metadata change after a snapshot is committed, **WHEN** the old bundle is reopened, **THEN** its prior text, IDs, revisions, hashes, SHAs, event versions, and validation provenance remain unchanged; a new evaluation or segment must explicitly request and persist a new snapshot.
- **AC-22:** **GIVEN** F18 is inspected at compile time and through a fixture run, **WHEN** its authority is evaluated, **THEN** it imports no provider SDK or direct GitHub transport, reads no credential, never targets the developer clone, and exposes no commit, push, response-posting, review-approval, merge, force-push, or publication capability.
- **AC-23:** **GIVEN** two automatic dispatches race for one PR or two PRs are processed concurrently, **WHEN** F18 handles them, **THEN** F11/F03 ownership and uniqueness allow at most one active automatic Review Bundle/AI operation per PR, preserve independent worktrees and records across PRs, and make losing/replayed requests safe to read.
- **AC-24:** **GIVEN** proposal/final/attention state is durably committed, **WHEN** F18 emits its downstream outcome handoff, **THEN** it provides a bounded PR/bundle target, stage, primary state, counts, validation summary, proposed-response drafts and inclusion metadata for display, attention reason, and permitted action for F19/F20 without sending an OS notification itself or using activity text as state.
- **AC-25:** **GIVEN** a context field, feedback body, instruction, proposed response, diagnostic, or downstream DTO is below, exactly at, or above its declared F03/F04/F09/F15/F16 bound, **WHEN** F18 validates the value, **THEN** values within the effective published bound are retained, over-limit or missing-bound values are rejected before persistence/provider/IPC handoff, and no authoritative value is silently truncated.
- **AC-26:** **GIVEN** the F19/F20/F21/F22/F23 consumer fixtures run against a committed F18 read model, **WHEN** each consumer deserializes the handoff, **THEN** it receives only the declared bounded DTO and cannot obtain notification, discard, re-evaluation, conversation-mutation, commit, push, response-posting, or publication authority through F18; a fixture proves the same handoff remains valid after restart.

## Functional Requirements

### FR-01: Automatic review admission and batch handoff

- FR-01.1: F18 SHALL consume one typed F12 automatic-dispatch handoff containing one managed PR, one exact F11 claim/hold identity, one immutable version set, one scheduler revision, and one idempotency/correlation identity.
- FR-01.2: F18 SHALL revalidate the claim, hold, current primary PR state, open/merged eligibility, exact version associations, and operation uniqueness before creating or changing a worktree; it SHALL never add, drop, reorder, or replace a claimed event version by remote object ID alone.
- FR-01.3: F18 SHALL treat an empty, stale, paused, held-by-another-operation, cross-PR, already-handled, or otherwise invalid handoff as a typed non-success with no worktree, validation, provider, or publication effect.
- FR-01.4: F18 SHALL persist automatic-review intent and the mutable-input snapshot before F13, F14, F15, or F17 causes the represented external effect; stable retries SHALL return the committed outcome.
- FR-01.5: F18 SHALL run in the Electron main process and SHALL not depend on a renderer window, renderer state, or renderer callback for admission, progress, persistence, or recovery.

### FR-02: Immutable review context and configuration snapshot

- FR-02.1: F18 SHALL assemble a bounded provider-neutral review context containing the managed PR metadata, explicit base/head repository and branch identities, observed SHAs, exact immutable F10 event-version references, and repository/worktree identity.
- FR-02.2: F18 SHALL request and retain an F16 snapshot for the declared Automatic Review / Re-evaluation task with the Read-only floor, including applicable PR Intent / Context, Common Instructions, Build & Validation provenance, profile/policy revisions, bounds revision, and content hashes.
- FR-02.3: F18 SHALL snapshot the exact context used by the proposal and persist a separate, explicit Review Revision snapshot when implementation starts; later settings or PR edits SHALL not rewrite earlier snapshots.
- FR-02.4: F18 SHALL reject or omit credentials, provider SDK objects, uncontrolled environment values, arbitrary paths, raw transport payloads, and unbounded text from review context, persistence, IPC, activity, and structured AI input.

### FR-03: Isolated worktree and baseline validation

- FR-03.1: F18 SHALL ask F13 to prepare one operation-owned review worktree at the explicit PR head SHA and SHALL retain `prBaseSha`, `prHeadSha`, `worktreeBaselineSha`, resolved path, ownership, and current-state evidence.
- FR-03.2: F18 SHALL require a fresh F13 inspection proving a clean baseline before baseline validation or Review Proposal invocation and SHALL leave manual or unexpected changes for an explicit downstream worktree decision.
- FR-03.3: When F00/F16 provides an authorized baseline profile, F18 SHALL request F14 baseline validation before the Review Proposal; when no safe command is available, it SHALL retain a visible `not_run` warning rather than invent a command or pass.
- FR-03.4: F18 SHALL preserve baseline results as a distinct phase and SHALL not use baseline evidence to make post-change validation pass.
- FR-03.5: The proposal phase SHALL not grant or cause worktree mutation; any provider-reported file or command activity SHALL be treated as a claim until F13 inspects actual state.

### FR-04: Structured, read-only Review Proposal

- FR-04.1: F18 SHALL invoke the declared Automatic Review / Re-evaluation task through F17 and F15 using the exact immutable context and a versioned Review Proposal completion predicate.
- FR-04.2: The accepted proposal result SHALL account for every input event version exactly once and SHALL contain only `fixed`, `pushback`, `question`, or `no_change` dispositions.
- FR-04.3: Each proposal item SHALL retain the immutable feedback reference, assessment, proposed implementation when relevant, proposed response when available, related-file metadata, and bounded model-reported explanations separately from deterministic evidence.
- FR-04.4: F18 SHALL treat F15 schema validation, F13 actual-state inspection, F14 validation results, and F17 completion/progress decisions as authoritative; provider prose SHALL not choose an application state or create a validation pass.
- FR-04.5: Invalid structured output, incomplete event coverage, unsupported policy, timeout, cancellation, provider failure, or uncertain evidence SHALL produce a preserved, actionable attention outcome and SHALL not trigger an automatic replacement turn.

### FR-05: Proposal-stage Review Bundle and hold

- FR-05.1: F18 SHALL atomically persist the proposal-stage Review Bundle, Review Bundle items, immutable event-version associations, input/configuration/worktree snapshots, baseline results, proposal result, AI operation/turn references, stage, state, and reason data.
- FR-05.2: A successfully persisted proposal SHALL use `PROPOSAL_REVIEW` stage, enter `READY_FOR_REVIEW`, and retain the F11 automatic review hold until an explicit allowed downstream outcome; an unsafe proposal SHALL enter `NEEDS_ATTENTION` with preserved evidence and the hold still active.
- FR-05.3: F18 SHALL expose a bounded Review Bundle read model and typed outcome handoff containing the target, stage, item counts, evidence references, validation summary, bounded proposed-response drafts and inclusion metadata for downstream display, usage/configuration metadata, reason, and permitted next action.
- FR-05.4: F18 SHALL not attach feedback versions observed after the claim or during a hold to the active bundle; F11 remains responsible for retaining and later re-eligibilizing those versions.

### FR-06: Explicit per-item human decisions

- FR-06.1: F18 SHALL require one explicit `accepted` or `overridden` decision for every proposal item before implementation admission.
- FR-06.2: An `overridden` decision SHALL record the final disposition, bounded instructions, decision identity, actor/action metadata, and the proposal version it supersedes; the final disposition SHALL be one of `fixed`, `pushback`, `question`, or `no_change`.
- FR-06.3: An item with an effective `question` disposition SHALL require a bounded non-empty answer before implementation admission; overriding it to another disposition SHALL record the superseding choice and SHALL not silently use the old question as implementation authority.
- FR-06.4: Decision writes SHALL be versioned and idempotent; a stale or duplicate renderer request SHALL not start implementation, erase an earlier decision, or release the hold.
- FR-06.5: A per-item accept/override decision SHALL control only review implementation input. It SHALL not approve a commit, push, GitHub response, review approval, conversation resolution, merge, or publication.

### FR-07: Review implementation and valid no-code path

- FR-07.1: After all decisions and effective question answers are durable, F18 SHALL resolve a Review Revision F16 snapshot and start a bounded F17/F15 Review Implementation operation only after the decision snapshot is committed.
- FR-07.2: The implementation input SHALL contain the final human disposition for every item, question answers, user instructions, immutable proposal context, and the exact operation-owned worktree; only final `fixed` decisions SHALL be eligible for code changes.
- FR-07.3: If no final disposition is `fixed`, F18 SHALL not invoke a worktree-mutating provider turn; it SHALL inspect the unchanged worktree and create the final-review result with a deterministic `NO_IMPLEMENTATION_CHANGES` post-change not-run reason when applicable.
- FR-07.4: F18 SHALL consume F17's bounded timeout, budget, cancellation, progress, report, and stop contracts and SHALL not implement a second automatic retry or progress loop.
- FR-07.5: Any implementation failure, policy stop, timeout, cancellation, invalid evidence, or uncertain outcome SHALL preserve the worktree and evidence, map to `NEEDS_ATTENTION`, and require explicit downstream action.

### FR-08: Actual diff, post-change validation, and final bundle

- FR-08.1: After implementation or a no-code path, F18 SHALL request fresh F13 state and authoritative proposed-worktree and PR-context diff evidence; the complete proposed diff SHALL remain distinct from contextual PR changes.
- FR-08.2: When accepted/overridden fixed decisions produce an implementation path, F18 SHALL invoke F14 post-change validation after implementation and before final publication review; no model claim or baseline result may create a pass.
- FR-08.3: F18 SHALL use a versioned implementation completion predicate requiring final decisions, fresh worktree inspection, and applicable F14 evidence; missing, stale, contradictory, or unsafe evidence SHALL be non-success.
- FR-08.4: F18 SHALL atomically persist the final Review Bundle stage/state, decisions, answers, proposed responses, actual diff references/hashes, three SHA snapshots, post-change results, complete F17 turn reports/usage, profile/policy/context metadata, and safe reasons.
- FR-08.5: F18 SHALL classify a complete, publish-reviewable result as `READY_FOR_REVIEW` with `FINAL_REVIEW` stage and a blocking or unresolved result as `NEEDS_ATTENTION`; both states SHALL retain the full evidence and permitted next action.

### FR-09: Hold, lifecycle, recovery, and idempotency

- FR-09.1: F18 SHALL preserve proposal/final/attention bundle state, operation identity, worktree path, snapshots, decisions, reports, validation, and usage across renderer closure and ordinary process restart.
- FR-09.2: F18 SHALL not resume a stopped/uncertain provider turn, rerun validation, refresh/reset a worktree, or release a hold solely because the renderer reopens or the process restarts.
- FR-09.3: When an intent or external outcome is uncertain, F18 SHALL reconcile using stable operation/bundle/turn identities and the authoritative F03/F13/F14/F15 records before any retry; it SHALL never turn uncertainty into success.
- FR-09.4: F18 SHALL keep the F11 hold while the automatic bundle is `WORKING`, `READY_FOR_REVIEW`, or `NEEDS_ATTENTION` and SHALL request release only through the explicit F11-approved outcome path.
- FR-09.5: F18 SHALL preserve immutable event-version associations and snapshot history; later polling, setting changes, or renderer actions SHALL not make handled input silently eligible again or mutate an existing result.

### FR-10: Trust boundary and downstream conformance

- FR-10.1: F18 SHALL use typed F03-F17 ports for persistence, PR/event/claim data, worktree/Git truth, validation, provider invocation, configuration snapshots, bounded AI work, and activity; it SHALL not import a provider SDK or implement a second GitHub client.
- FR-10.2: F18 SHALL expose no credential, raw authorization material, provider SDK object, uncontrolled environment value, arbitrary command, developer-clone path, commit, push, response-posting, review-approval, merge, force-push, or publication capability to AI or renderer callers.
- FR-10.3: F18 SHALL emit bounded correlated diagnostic events after authoritative state decisions, while downstream F19/F20/F21 consume typed read models rather than parsing activity text.
- FR-10.4: F18 SHALL provide consumer conformance fixtures for F19 notification handoff, F20 review presentation, F21 revision input, F22 discard/re-evaluation input, and F23 publication preconditions without granting any of those effects itself; each fixture SHALL prove that the consumer receives only the bounded typed read model and cannot invoke an F18-owned effect capability.

## Non-Functional Requirements

- **NFR-01: Determinism** - For the same committed batch, immutable inputs, typed dependency results, predicate versions, and injected clock, F18 SHALL produce the same admission, snapshot, stage, state, reason, and handoff outcome without semantic AI deciding application state.
- **NFR-02: Durability and restart safety** - Proposal/final bundle state, item decisions, immutable snapshots, operation references, worktree identity, validation, reports, usage, and reasons SHALL survive renderer closure and ordinary process restart; in-memory workflow state SHALL not be authoritative.
- **NFR-03: Bounded data** - Context, feedback, instructions, proposed responses, model explanations, diagnostics, read models, and serialized handoffs SHALL use the effective published F03/F04/F09/F15/F16 limits and fail closed rather than truncate authoritative values silently; a missing or ambiguous delegated bound is a refusal.
- **NFR-04: Security and least privilege** - The provider receives only the declared operation-owned scope and task policy; GitHub credentials and publication authority remain behind deterministic infrastructure, and secrets never enter prompts, structured output, bundle records, IPC, or activity.
- **NFR-05: Reproducibility** - A developer SHALL be able to reconstruct the exact feedback versions, PR/SHAs, task/policy/instruction/context revisions, worktree path, decision history, validation phases, diffs, usage, and turn reasons used to produce a bundle.
- **NFR-06: Idempotency and concurrency** - Duplicate dispatches, decision writes, provider results, persistence retries, restart recovery, and competing PR work SHALL not create duplicate bundles, worktrees, claims, provider turns, handled associations, or final outcomes.
- **NFR-07: Main-process operation** - Automatic review, validation handoffs, bounded AI work, persistence, and recovery SHALL continue without a renderer and SHALL remain safe on Windows through the declared platform adapters.
- **NFR-08: Accessibility handoff** - The F18 read model SHALL expose semantic labels, reason codes, stage, state, evidence authority, required decisions, and permitted next actions so downstream UI can support keyboard, screen-reader, and forced-colors users without color-only meaning.

## Invariants

- **INV-01:** Deterministic application code owns admission, snapshots, state, sequencing, validation timing, retries, and publication gating; AI is used only for semantic assessment or code generation.
- **INV-02:** The Electron main process and F03 authoritative records own Review Bundle state; the renderer is a replaceable view/controller and cannot create a successful outcome from local memory.
- **INV-03:** Review intent and every mutable-input snapshot are durably committed before the represented F13, F14, F15, or F17 effect.
- **INV-04:** The initial Review Proposal is read-only until every required per-item human decision is durable; no proposal response grants mutation or publication authority.
- **INV-05:** Bundle items refer to immutable, scoped feedback versions; associations and handled history are append-only and cannot be rewritten by retries, setting changes, or renderer actions.
- **INV-06:** Every active review operation uses one owned worktree; F18 never targets, resets, cleans, replaces, or publishes from the developer's normal working directory.
- **INV-07:** PR Intent / Context, Common Instructions, Build & Validation, task profiles, execution policies, remote metadata, and SHAs used by a bundle are immutable snapshots; later edits affect only explicitly new work.
- **INV-08:** F13 actual Git evidence, F14 actual validation evidence, F15 schema validation, and F17 deterministic progress outrank model prose, reported files, reported commands, and reported completion.
- **INV-09:** At most one automatic Review Bundle/AI operation is active per PR; `WORKING`, `READY_FOR_REVIEW`, and `NEEDS_ATTENTION` retain the per-PR hold until an explicit owning workflow outcome.
- **INV-10:** F18 has no commit, push, GitHub-response, review-approval, conversation-resolution, merge, force-push, or publication authority, and never passes such authority to a provider.
- **INV-11:** A schema-valid proposal that accounts for all input versions and has only `pushback`, `question`, or `no_change` dispositions is a valid no-code semantic completion, not an automatic no-progress failure.

## Out of Scope

- **Polling, GitHub REST transport, and feedback version construction** - F06 and F10 own remote calls, normalization, conditional requests, pagination, and immutable semantic versions.
- **Eligibility, claims, holds, and handled-association rules** - F11/F02 own the state-machine and claim contracts; F18 consumes and revalidates them.
- **SQLite migrations and generic persistence implementation** - F03 owns schema, transactions, optimistic concurrency, and repository mechanics.
- **Preferences and configuration editing** - F16/F00 own task profiles, policy presets, Common Instructions, PR context editing, and validation command trust.
- **Provider SDK implementation** - F15 owns the Codex adapter, capability admission, structured schemas, normalized events, and provider errors.
- **AI budget/progress implementation** - F17 owns turns, timeouts, usage, predicates, fingerprints, stop reasons, and continuation authorization.
- **Full Review Bundle workspace and diff-viewer styling** - F20 owns the dedicated screen, navigation, complete diff presentation, and visual treatment of `READY_FOR_REVIEW` versus `NEEDS_ATTENTION`; F18 supplies the semantic read model.
- **Read-only conversations, revisions, dirty-worktree discard, stale handling, and re-evaluation UX** - F21/F22 own those explicit downstream workflows.
- **Native notifications, tray behavior, deep links, shutdown, commits, pushes, GitHub responses, conversation resolution, review approval, merge, force push, and publication** - F19/F23 and later features own these effects.
- **Per-hunk acceptance, silent partial-patch reconstruction, blind conflict resolution, automatic rebase, webhooks, autonomous publication, and other MVP non-goals** - remain outside the application overview's MVP scope.

## Product Decisions

- **PD-01: One exact batch becomes one review bundle** - Automatic F18 work is scoped to the exact F11/F12 version set for one managed PR. New versions are retained for later work and never silently merged into the active bundle.
- **PD-02: Proposal-before-mutation is mandatory** - Automatic Review / Re-evaluation runs under the Read-only policy. No implementation turn starts until every item has an explicit accept/override decision and every still-effective question has an answer.
- **PD-03: Final human dispositions are the implementation authority** - Accept preserves the recommendation; override records the chosen disposition and instructions. Only final `fixed` dispositions are code-change inputs. A question answer informs the declared question outcome; it does not silently become a fix.
- **PD-04: Proposed replies are visible downstream but not published by F18** - F18 stores bounded provider-proposed response drafts and their response-inclusion metadata in the typed Review Bundle read model so F19/F20 can display them. Response editing, selection, approval, and posting remain downstream publication concerns; F18 never publishes a response.
- **PD-05: Baseline failure is evidence-bearing attention, not a hard pre-proposal hold** - A baseline failure or unavailable validation profile is preserved as real evidence and surfaced as an attention reason. If the remaining worktree and input evidence are safe, F18 may continue read-only semantic proposal analysis; if the condition makes review unsafe, F18 produces `NEEDS_ATTENTION`. It never becomes a validation pass and never authorizes mutation.
- **PD-06: No-code completion is explicit** - If no final item is `fixed`, F18 skips the mutating provider turn, records a deterministic no-implementation post-change status, and produces a final-review bundle rather than consuming a worktree-mutating budget.
- **PD-07: Implementation validation is required when implementation is attempted** - After accepted fixed work, F18 refreshes actual Git state and runs applicable post-change validation before the final bundle is considered review-ready. A failed or interrupted check produces `NEEDS_ATTENTION`.
- **PD-08: Holds survive every intermediate outcome** - Proposal, implementation, validation, renderer closure, restart, and notification navigation do not release the automatic hold. Only an explicit downstream publish, discard, or re-evaluation outcome may change it.
- **PD-09: Review-boundary decisions confirmed (2026-09-23)** - The developer confirmed that F19/F20 may display bounded proposed response drafts while F18 never publishes them; baseline failure/unavailable validation is evidence-bearing attention rather than an automatic pre-proposal hard hold; and F19-F23 consume only the bounded `ReviewBundleReadModel` without obtaining F18-owned notification, discard, re-evaluation, conversation-mutation, commit, push, response-posting, or publication authority. These decisions close the prior review prompts; the proposal-before-mutation flow, question override rule, no-code status, and downstream visual treatment remain governed by the surrounding requirements and owning features.

## Implementation Decisions

- **IMP-01: Use one main-process `AutomaticReviewCoordinator`** - It owns the typed handoff from F12 through proposal/final bundle transitions and delegates persistence, Git, validation, provider work, and policy to the upstream ports.
- **IMP-02: Build one immutable `ReviewInputSnapshot`** - The proposal operation stores exact F07/F10/F13/F14/F16 references and bounded hashes before the first proposal turn; the implementation segment stores its own Review Revision snapshot while retaining the proposal snapshot.
- **IMP-03: Use stage-specific completion predicates** - F17 receives a proposal predicate requiring exact event accounting and unchanged worktree, and an implementation predicate requiring final decisions, fresh Git evidence, and applicable validation. F18 never accepts a provider-supplied predicate.
- **IMP-04: Persist proposal and final aggregates transactionally** - Proposal bundle/items/associations/hold-linked state commit as one transaction; final decisions/diffs/validation/reports/state commit as another transaction with idempotent bundle/version identities.
- **IMP-05: Keep item decisions separate from publication approval** - Decision records are workflow inputs; they never carry commit/push/response/publication authority or imply approval of the complete proposed diff.
- **IMP-06: Treat `ReviewBundleReadModel` as the downstream boundary** - F19-F23 consume only bounded, provider-neutral data with explicit evidence authority, stage, reason, proposed-response visibility, and next action rather than activity-log parsing or SDK objects. The DTO grants no F18-owned external-effect capability.
- **IMP-07: Keep F18 free of direct provider/GitHub coupling** - F18 may coordinate typed F06/F07/F10-F17 ports but imports no Codex SDK, creates no child provider process, and performs no direct GitHub request.
- **IMP-08: Use explicit zero-effect paths** - All-non-code proposal/decision results do not start a mutating provider or post-change command merely to produce an artificial success signal; their no-code status is recorded explicitly.

## Testing Decisions

- **TST-01: Deep-test the orchestration reducer and snapshot builder** - Cover exact batch admission, snapshot hashes/revisions, proposal/final stage transitions, question/override semantics, no-code completion, reason mapping, and downstream handoff with injected ports and clocks.
- **TST-02: Use deterministic fakes at every upstream boundary** - F07/F10/F11/F12/F13/F14/F15/F16/F17/F03/F09 fakes and temporary Git repositories exercise the feature without live GitHub, provider credentials, or the developer worktree.
- **TST-03: Fault-inject every persist-before-effect boundary** - Test before/after claim handoff, worktree preparation, baseline run, proposal result, proposal transaction, decision write, implementation turn, diff inspection, post-change validation, and final transaction.
- **TST-04: Test authority negatively** - Static and fixture scans prove no provider SDK import, credential/raw payload leakage, direct GitHub transport, developer-clone path, publication method, model-claimed validation pass, or hidden retry loop is reachable from F18.
- **TST-05: Treat F13/F14/F17 as truth owners** - F18 tests that provider-reported files, commands, progress, completion, or validation cannot override actual Git, validation, or bounded-work evidence.
- **TST-06: Test semantic UI handoff, not final styling** - Verify stage/state labels, evidence authority, required decision flags, next-action data, usage, and forced-colors-safe semantic status. F20 owns pixel/layout and full diff rendering.
- **TST-07: Require cross-feature consumer conformance** - Thin F19/F20/F21/F22/F23 consumers must compile against the same F18 read model and must not gain publication, discard, re-evaluation, or notification authority through it.

## Proposed Modules

- **MOD-01: Automatic Review Coordinator** - Main-process workflow service for F12/F11 admission, operation identity, sequencing, and proposal/final outcome handoff.
- **MOD-02: Claim and Hold Revalidator** - Validates exact batch membership, per-PR ownership, state, scheduler revision, and hold/claim identity before every external-effect boundary.
- **MOD-03: Review Input Snapshot Builder** - Combines PR, immutable feedback, repository instructions, Common Instructions, Build & Validation, PR Intent / Context, task/policy, SHA, and worktree references into bounded immutable inputs.
- **MOD-04: Review Worktree and Baseline Coordinator** - Requests F13 preparation/inspection and F14 baseline execution while preserving phase-specific evidence.
- **MOD-05: Review Proposal Runner** - Builds the F15/F17 read-only request, registers the proposal predicate, normalizes exact item coverage, and maps safe provider/structured-output outcomes.
- **MOD-06: Proposal Bundle Committer** - Atomically persists the proposal aggregate, item associations, snapshots, baseline, operation evidence, stage, state, and hold-linked reason.
- **MOD-07: Human Decision Gate** - Validates accept/override completeness, final disposition/instruction fields, question answers, decision versions, and idempotent implementation authorization.
- **MOD-08: Review Implementation Coordinator** - Starts the F16 Review Revision/F17/F15 bounded operation or the explicit no-code path using only final human decisions.
- **MOD-09: Final Evidence and Bundle Finalizer** - Refreshes F13 diffs, invokes F14 post-change validation, evaluates the implementation predicate, and atomically commits the final bundle.
- **MOD-10: Review Bundle Read Model and Outcome Adapter** - Projects bounded proposal/final/attention data for F19-F23 and emits safe correlated activity without making diagnostics authoritative.

## Workflows

### Workflow 1: Automatic batch to proposal bundle

```text
1. F12 hands F18 one exact claimed batch for one managed PR.
2. F18 revalidates F11 claim/hold, PR state, version membership, scheduler
   revision, operation uniqueness, and idempotency identity.
3. F03 commits review intent and immutable input references before effects.
4. F13 prepares a clean worktree at the explicit PR head and records all three
   review SHA meanings and the resolved path.
5. F14 runs approved baseline validation, or records a safe not_run warning.
6. F16 resolves Automatic Review / Re-evaluation with a Read-only policy;
   F17 commits the bounded read-only turn intent and invokes F15.
7. F15 returns a structured result; F17 and F13/F14 provide normalized and
   deterministic evidence; F18 validates exact event coverage.
8. F18 atomically persists the proposal bundle/items/associations and returns
   READY_FOR_REVIEW plus PROPOSAL_REVIEW, or NEEDS_ATTENTION with evidence.
```

### Workflow 2: Human decision gate and implementation

```text
1. F20 reads the proposal bundle and records accepted/overridden decisions.
2. F18 requires a decision for every item and an answer for each still-effective
   question before implementation admission.
3. F03 commits the final decision snapshot and implementation intent.
4. F16 resolves the Review Revision profile/policy; F17 starts one bounded
   mutating operation through F15 with only final decisions and instructions.
5. If no final item is fixed, F18 skips the provider turn and records the
   explicit no-implementation path.
6. F13 inspects the actual worktree; F14 runs applicable post-change validation.
7. F18 commits FINAL_REVIEW with READY_FOR_REVIEW or NEEDS_ATTENTION and emits
   a typed downstream outcome. Publication remains a later explicit action.
```

### Workflow 3: Failure, hold, and restart recovery

```text
1. A provider, Git, validation, persistence, timeout, cancellation, or process
   interruption occurs at a durable boundary.
2. F18 records the committed intent/result and asks F03/F13/F14/F15/F17 for
   authoritative reconciliation by stable identity.
3. The worktree, reports, usage, snapshots, item associations, and safe reason
   remain available; no automatic retry or resume is authorized.
4. The PR remains held while the bundle is working or needs attention, and new
   F10 versions stay outside the active bundle.
5. A later explicit F20/F21/F22/F23 action may continue, retry, re-evaluate,
   discard, or publish under its own feature contract.
```

## Contract-Test Criteria

- **CT-F18-01:** Admission fixtures cover exact F12/F11 batch identity, one-PR scope, current-state/hold revalidation, empty/stale/paused/handled/competing claims, persist-before-effect, duplicate dispatch, and concurrent PR isolation.
- **CT-F18-02:** Snapshot fixtures cover PR/base/head repository identity, immutable F10 version coverage, PR Intent / Context, Common Instructions, F00/F16 Build & Validation provenance, task/profile/policy revisions, SHA/worktree references, bounds, hashes, and secret/SDK/environment exclusion.
- **CT-F18-03:** Worktree/baseline fixtures cover exact PR-head preparation, clean-state inspection, developer-clone preservation, all three SHA meanings, baseline-before-proposal ordering, no-safe-profile `not_run`, baseline failure, and phase separation.
- **CT-F18-04:** Proposal fixtures cover read-only policy, F17/F15 handoff, exact one-item-per-event validation, all four dispositions, proposed implementation/response fields, unchanged-worktree proof, no-publication authority, invalid/missing/duplicate output, provider failure, timeout, cancellation, and no automatic replacement.
- **CT-F18-05:** Proposal transaction fixtures cover atomic bundle/item/version-association/configuration/validation/turn persistence, `PROPOSAL_REVIEW`, `READY_FOR_REVIEW`/`NEEDS_ATTENTION`, hold ownership, outcome read model, restart readback, and new-version retention during the hold.
- **CT-F18-06:** Decision fixtures cover accepted/overridden records, all final dispositions, override instructions, question textbox bounds/requiredness, override-away-from-question behavior, stale/duplicate writes, missing decisions, and no implementation before the gate.
- **CT-F18-07:** Implementation fixtures cover Review Revision snapshot routing, final-decision-only inputs, accepted/overridden fixed selection, rejected recommendation exclusion, question answers, F17 budget/timeout/stop mapping, and no-code zero-mutating-turn behavior.
- **CT-F18-08:** Finalization fixtures cover fresh F13 proposed/context diffs, three SHA references, post-change phase ordering, real F14 pass/fail/not_run/interrupted results, model-claim rejection, final predicate truth, `FINAL_REVIEW`, and `READY_FOR_REVIEW` versus `NEEDS_ATTENTION` reasons.
- **CT-F18-09:** Recovery fixtures cover renderer closure, restart at every durable boundary, uncertain provider/Git/validation/persistence outcomes, no automatic resume/retry, idempotent reconciliation, hold preservation, immutable association history, and future-only setting/context edits.
- **CT-F18-10:** Boundary/conformance fixtures cover F03/F09 typed records, below/exact/above F03/F04/F09/F15/F16 bound cases, missing delegated bounds, F19/F20/F21/F22/F23 consumer DTOs, forbidden direct imports/effects, credential/raw-payload scans, bounded read models, accessibility semantics, and zero publication capability.

## Requirement Traceability

| Requirement family | Observable acceptance criteria | Named contract-test criteria |
|---|---|---|
| FR-01 | AC-01-AC-03, AC-11, AC-19, AC-23 | CT-F18-01, CT-F18-05, CT-F18-09 |
| FR-02 | AC-04, AC-21-AC-22 | CT-F18-02, CT-F18-09, CT-F18-10 |
| FR-03 | AC-03, AC-05-AC-06, AC-16, AC-22 | CT-F18-03, CT-F18-04, CT-F18-08 |
| FR-04 | AC-06-AC-10, AC-22 | CT-F18-04, CT-F18-07 |
| FR-05 | AC-10-AC-11, AC-20, AC-24 | CT-F18-05, CT-F18-10 |
| FR-06 | AC-12-AC-14, AC-20 | CT-F18-06, CT-F18-10 |
| FR-07 | AC-08, AC-14-AC-15, AC-18-AC-19 | CT-F18-07, CT-F18-09 |
| FR-08 | AC-15-AC-17, AC-20-AC-21 | CT-F18-08, CT-F18-09 |
| FR-09 | AC-02, AC-09, AC-11, AC-18-AC-19, AC-23 | CT-F18-01, CT-F18-05, CT-F18-09 |
| FR-10 | AC-20, AC-22, AC-24-AC-26 | CT-F18-01, CT-F18-02, CT-F18-10 |
| NFR-01-NFR-08 | AC-01-AC-26 | CT-F18-01-CT-F18-10 |
| INV-01-INV-11 | AC-02, AC-04, AC-06-AC-26 | CT-F18-01-CT-F18-10 |
