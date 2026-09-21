# PRMonitor MVP Implementation Checklist

This checklist decomposes [`Specs/application_overview.md`](Specs/application_overview.md) into dependency-ordered implementation units. The sequence is intentional: complete items from top to bottom unless a later item's PRD proves that its stated dependencies are already satisfied.

## How to use this checklist

This file is the dependency-ordered progress ledger.

A checked item means its behavior is implemented, persisted where required, exposed through the UI where applicable, tested at its service boundaries, and integrated into the running desktop application. Scaffolding or an isolated backend implementation is not sufficient.

## Global implementation invariants

These apply to every item and should be copied into each PRD when relevant:

- Use deterministic software for polling, state, Git, validation, retries, notifications, and publication. Invoke AI only for semantic judgment or code generation.
- AI may work only within its authorized operation-owned boundary and never receives publication authority.
- No commit, push, GitHub response, conversation resolution, review approval, or PR merge occurs without the required explicit human approval.
- The Electron main process owns durable state and long-running work; the renderer is a replaceable view/controller.
- Persist intent before external side effects. Design restart, retry, and uncertain-outcome recovery to be idempotent.
- Never discard, reset, replace, or publish user worktree edits without showing the actual changes and obtaining the specified decision.
- Snapshot mutable inputs used to produce a result, including remote event versions, SHAs, task profiles, execution policy, Common Instructions, and PR Intent / Context.
- Provider SDK types and behavior stay behind the provider adapter. GitHub and OS credentials stay behind deterministic infrastructure and out of prompts, structured AI output, and plaintext SQLite fields.
- Preserve the MVP non-goals in the application overview. In particular: no autonomous publication, force push, webhook requirement, automatic branch synchronization, partial patch acceptance, or automatic rebase of stale work.

## Ordered implementation items

### Phase 0 - Decisions and foundations

- [x] **F00 - Deterministic validation configuration contract**
  - **Depends on:** Nothing.
  - **Deliver:** Resolve the overview's pre-implementation TODO: define where validation commands come from, precedence and trust rules, user confirmation requirements, working-directory rules, timeouts, cancellation, output limits/redaction, manual-test records, and behavior when no safe command is configured. Record the decisions in the PRD and implement the minimal configuration contract needed by later features.
  - **Exit:** Later validation, review, revision, and synchronization features can consume one stable contract without inventing their own command-source or safety rules.
  - **Primary application criteria:** Enables APP-AC-13, APP-AC-48, APP-AC-49, and APP-AC-57.

- [x] **F01 - Application workspace and engineering foundation**
  - **Depends on:** F00.
  - **Deliver:** Establish the root Electron/React/TypeScript application alongside the existing spec-linter workspace; define main, preload, renderer, and shared-domain boundaries; add packaging-friendly configuration, linting, formatting, unit/integration test harnesses, temporary Git-repository fixtures, and CI-safe root scripts. Pin runtime dependencies and the eventual Codex SDK version through the lockfile.
  - **Exit:** A production-mode desktop shell and automated test suite build from a clean checkout without disturbing the standalone spec-linter.
  - **Primary application criteria:** Architectural enabler; no criterion is closed by scaffolding alone.

- [x] **F02 - Domain contracts and deterministic state machines**
  - **Depends on:** F01.
  - **Deliver:** Define provider-neutral domain IDs, clocks, errors, result/reason types, PR primary states, Review Bundle states, synchronization states, publication phases, and allowed transitions. Keep global pause and synchronization as overlays rather than competing PR state machines. Add transition and invariant tests.
  - **Exit:** Invalid transitions, concurrent automatic review work for one PR, and accidental hold release are rejected by deterministic domain code.
  - **Primary application criteria:** Enables APP-AC-16, APP-AC-24, APP-AC-25, APP-AC-49, and APP-AC-68.

- [x] **F03 - SQLite persistence, migrations, and transactional repositories**
  - **Depends on:** F02.
  - **Deliver:** Add SQLite initialization and versioned migrations for settings, servers, repositories, PRs, immutable remote-event versions, batches, bundles/items, AI operations/turns/conversations, validation, synchronization, publication/response state, and activity events. Implement transaction boundaries, uniqueness/idempotency constraints, restart-safe repositories, and migration/backup failure handling.
  - **Exit:** Representative state survives process restart; migration tests cover empty, current, and upgrade databases; concurrency and uniqueness constraints enforce the domain invariants.
  - **Primary application criteria:** Persistence enabler for APP-AC-14, APP-AC-24, APP-AC-49, APP-AC-55, APP-AC-64, APP-AC-68, and APP-AC-69.

- [x] **F04 - Persistent Electron shell, IPC boundary, and Windows virtual-desktop spike**
  - **Depends on:** F01-F03.
  - **Deliver:** Make the main process authoritative; expose a narrow validated preload/IPC API; create and destroy renderer windows on demand; keep background services alive after window close; implement single-instance/deep-link routing; and perform the required Desktop A/B/C tray/notification focus spike. Isolate any platform-specific window activation behind an OS adapter.
  - **Exit:** Closing destroys the visible window without exiting, reopening creates a new window on the active Windows virtual desktop, and renderer destruction cannot cancel or corrupt main-process work.
  - **Primary application criteria:** APP-AC-17, APP-AC-20, APP-AC-30.

### Phase 1 - GitHub setup and managed PRs

- [x] **F05 - Secure GitHub server profiles and authentication**
  - **Depends on:** F03-F04.
  - **Deliver:** Add GitHub.com/GHES server configuration and connection testing. Store tokens in the host secure credential store, persist only safe references/metadata in SQLite, redact secrets from logs and errors, and make authentication available only to deterministic GitHub infrastructure.
  - **Exit:** A user can configure and verify a GitHub Enterprise Server, restart the app, and reconnect without a plaintext credential entering SQLite, renderer state, or AI context.
  - **Primary application criteria:** APP-AC-01.

- [x] **F06 - GitHub REST client and remote identity model**
  - **Depends on:** F05.
  - **Deliver:** Implement the deterministic GitHub client for PR metadata, repositories, refs, review comments, reviews, issue comments, comment posting, pagination, conditional requests, rate-limit/error normalization, and current-remote verification. Represent base/head repositories explicitly so forks and GHES URL/API differences cannot select a same-named branch from the wrong repository.
  - **Exit:** Contract tests against fixtures/fakes prove resource independence, pagination, conditional metadata, retry classification, and explicit repository/ref identity.
  - **Primary application criteria:** Enables APP-AC-02, APP-AC-08, APP-AC-29, APP-AC-44, APP-AC-50, and APP-AC-65.

- [x] **F07 - Add and manage a pull request**
  - **Depends on:** F03, F05-F06.
  - **Deliver:** Build the add-PR vertical slice: parse GitHub/GHES PR URLs; fetch metadata; identify base/head branches, repositories, and SHAs; locate or let the user select an existing local clone; validate that clone; and persist the managed PR. Support editing optional multi-line PR Intent / Context and `syncSourceBranchOverride` while preserving historical snapshots used by existing results.
  - **Exit:** A PR can be added with minimal configuration, reopened after restart, edited safely, and rejected with actionable errors for malformed URLs, inaccessible PRs, or invalid clones.
  - **Primary application criteria:** APP-AC-02, APP-AC-40.

- [ ] **F08 - Managed-PR inbox and primary review-state presentation**
  - **Depends on:** F02-F04, F07.
  - **Deliver:** Create the main inbox read model and UI for multiple managed PRs, grouped by whether user action is needed and showing `WATCHING`, `WORKING`, `READY_FOR_REVIEW`, and `NEEDS_ATTENTION`. Reserve a separate synchronization-status overlay. Include empty, loading, error, and restart-restored states plus navigation to PR settings/details.
  - **Exit:** Multiple PRs remain visible and correctly ordered after restart, and overlays never hide or mutate the primary review state.
  - **Primary application criteria:** APP-AC-03.

- [ ] **F09 - Durable activity log and operation diagnostics**
  - **Depends on:** F03-F04, F08.
  - **Deliver:** Add structured deterministic activity events, correlation IDs, timestamps, severity/reason data, retention bounds, and an activity viewer. Support provider-neutral work-item references with Jira-style display when available and GitHub-native fallback. Redact credentials and sensitive environment data.
  - **Exit:** Polling, batching, AI turns, validation, notification, synchronization, and publication can append and display correlated events without using free-form logs as application state.
  - **Primary application criteria:** Cross-cutting diagnostic support; no unique APP-AC closes here.

### Phase 2 - Deterministic monitoring pipeline

- [ ] **F10 - Independent, efficient PR feedback polling**
  - **Depends on:** F03, F06-F09.
  - **Deliver:** Implement main-process polling for PR metadata, inline review comments, reviews/bodies, and issue comments. Maintain independent ETag/Last-Modified and pagination checkpoints for every resource; default to 10 minutes; normalize all objects; and persist scoped remote identities plus immutable, content-hashed semantic versions, including edits with unreliable timestamps.
  - **Exit:** Polling continues with no renderer, a PR-metadata `304` cannot suppress feedback checks, unchanged state uses zero AI tokens, network failure marks nothing processed, and edited semantic content creates exactly one new immutable version.
  - **Primary application criteria:** APP-AC-04, APP-AC-05, APP-AC-06, APP-AC-08, APP-AC-65, APP-AC-69.

- [ ] **F11 - Event eligibility, deduplication, and per-PR review holds**
  - **Depends on:** F02-F03, F10.
  - **Deliver:** Deterministically reject same-version duplicates, PRMonitor-authored items, empty items, bodyless approvals, configured ignored accounts, and closed/merged PRs without keyword-based semantic guessing. Associate handled immutable versions with bundles forever. Enforce one automatic bundle/AI operation per PR and preserve new versions observed during `WORKING`, `READY_FOR_REVIEW`, or `NEEDS_ATTENTION` for later eligibility.
  - **Exit:** Duplicate delivery never triggers duplicate analysis; holds survive UI closure/restart; background work cannot mutate a held bundle worktree; and releasing a hold schedules only still-unhandled versions.
  - **Primary application criteria:** APP-AC-07, APP-AC-16, APP-AC-24, APP-AC-25.

- [ ] **F12 - Review batching, scheduler, Check Now, and global pause**
  - **Depends on:** F10-F11.
  - **Deliver:** Add a persisted, configurable quiet-period batcher (10-minute default), job scheduling/recovery, manual **Check Now**, and global **Pause Watching**. Restart the debounce on new eligible feedback, avoid empty/duplicate batches, prevent paused automatic dispatch, and allow explicitly initiated work and permitted lightweight polling to follow the overview's pause rules.
  - **Exit:** Bursty comments produce one batch, timers recover after restart/sleep, pause prevents new automatic AI work without hiding state or cancelling user-started synchronization, and no batching code invokes AI.
  - **Primary application criteria:** APP-AC-09; completes the scheduling aspect of APP-AC-03 through APP-AC-07.

### Phase 3 - Local execution and AI platform

- [ ] **F13 - Operation-owned Git worktrees and change attribution**
  - **Depends on:** F03, F07, F11-F12.
  - **Deliver:** Implement a thin deterministic Git/worktree service that fetches refs, records `prBaseSha`, `prHeadSha`, and `worktreeBaselineSha`, creates clean review and synchronization worktrees under a configurable root, and never touches the developer workspace. Capture before/after snapshots for each mutating AI turn, inspect actual state before every mutation/validation/publication, expose open/reveal actions, and implement safe three-way removal of AI-attributable changes with overlap detection.
  - **Exit:** Concurrent operation types cannot reuse/overwrite a worktree; proposed and context diffs are reproducible; manual edits are preserved; and unsafe overlap blocks **Clear Only AI Changes** instead of guessing.
  - **Primary application criteria:** APP-AC-10, APP-AC-37, APP-AC-39; supplies the snapshot/diff foundation for APP-AC-67.

- [ ] **F14 - Deterministic validation runner and result model**
  - **Depends on:** F00, F03, F09, F13.
  - **Deliver:** Execute only validation allowed by F00's contract in the operation worktree; capture exact command, directory, times, exit code, bounded/redacted stdout/stderr, cancellation/timeout, and manual-test status. Persist and display `passed`, `failed`, `not_run`, and `interrupted`; never infer success from model prose.
  - **Exit:** Real exit statuses survive restart and are consumable by Review Bundles, AI progress evaluation, and synchronization results, including explicit no-safe-command behavior.
  - **Primary application criteria:** APP-AC-13.

- [ ] **F15 - Provider-neutral AI contracts and Codex adapter**
  - **Depends on:** F01-F03, F13-F14.
  - **Deliver:** Define Zod-first normalized request, capability, streaming-event, usage, conversation-reference, error, AI review result, and turn-report schemas, generating JSON Schema for structured output. Add an `AIProviderRegistry` and the sole MVP `@openai/codex-sdk` adapter, with explicit working directory and controlled child environment. Reject unsupported capabilities or invalid structured output before it can drive state.
  - **Exit:** A fake provider and Codex adapter satisfy the same contract; only the adapter imports the Codex SDK; every input event version must be accounted for; SDK objects and provider threads never become authoritative application state.
  - **Primary application criteria:** APP-AC-11, APP-AC-12, APP-AC-63, APP-AC-64.

- [ ] **F16 - AI preferences, task-profile snapshots, execution policies, and Common Instructions**
  - **Depends on:** F03-F04, F15.
  - **Deliver:** Build Preferences for the four task types, provider/model/reasoning compatibility validation, revisions, maximum-turn setting, named execution-policy presets, configurable worktree root, polling/quiet periods, and reusable Common Instruction profiles. Resolve and snapshot effective profiles/policies/instructions; enforce a read-only floor for read-only conversation; default mutating work to Autonomous Worktree; withhold GitHub credentials; and reject interactive policies unsupported by the direct SDK.
  - **Exit:** Preference edits affect only future segments/turns, every invocation is routed by declared task type, policy cannot be silently broadened, and persisted/user-visible snapshots make completed work reproducible.
  - **Primary application criteria:** APP-AC-32 through APP-AC-36, APP-AC-59 through APP-AC-62, APP-AC-70; completes snapshot behavior for APP-AC-41 and APP-AC-42.

- [ ] **F17 - Bounded AI Work Controller and deterministic progress evaluation**
  - **Depends on:** F03, F13-F16.
  - **Deliver:** Persist parent operations, bounded segments, 1-10 turn budgets (default 3, hard maximum 10), consumed counts, turn timeouts, snapshots, usage, actual file/command activity, completion predicates, state fingerprints, progress classifications, and machine-readable stop reasons. Detect repeated state and two consecutive no-material-progress turns. Require explicit continuation/new-budget authorization and preserve cumulative history.
  - **Exit:** Closure/restart cannot reset a budget; timeout/failure/repeated/no-progress/exhaustion becomes reviewable `NEEDS_ATTENTION`; deterministic evidence overrides claims; and a valid no-code semantic result can complete without false no-progress failure.
  - **Primary application criteria:** APP-AC-54 through APP-AC-58.

### Phase 4 - Review preparation and human review

- [ ] **F18 - Automatic review-to-Review-Bundle vertical slice**
  - **Depends on:** F07, F10-F17.
  - **Deliver:** Dispatch an eligible batch; prepare its isolated worktree; assemble PR metadata, immutable feedback versions, repository instructions, snapshotted PR Intent / Context and Common Instructions; invoke the Automatic Review profile through `AIWorkController`; inspect actual diff; run validation; and atomically persist a complete Review Bundle and item associations. Support `fixed`, `pushback`, `question`, and `no_change`, including all-no-code completion.
  - **Exit:** A simulated remote comment reaches `READY_FOR_REVIEW` or actionable `NEEDS_ATTENTION` with a restart-safe bundle, complete turn evidence, correct hold, and zero direct AI/GitHub coupling outside the declared boundaries.
  - **Primary application criteria:** APP-AC-14, APP-AC-41, APP-AC-42, APP-AC-66; integrates APP-AC-10 through APP-AC-17.

- [ ] **F19 - System tray, native notifications, deep links, and shutdown**
  - **Depends on:** F04, F08-F09, F12, F13, F18.
  - **Deliver:** Keep a tray icon whenever the main process runs; show attention/working items and paused state; implement **Open PRMonitor**, **Pause Watching**, and **Shutdown PRMonitor**; send outcome-oriented native notifications for review, validation, attention, and sync-batch outcomes; deep-link notification/tray selections; and expose **Open Worktree** through the OS shell adapter.
  - **Exit:** With no window open, background work continues, notifications arrive, clicks create a focused current-desktop window at the correct persisted result, worktree actions target only the recorded isolated path, and only **Shutdown PRMonitor** exits gracefully.
  - **Primary application criteria:** APP-AC-15, APP-AC-18, APP-AC-19, APP-AC-31, APP-AC-38; completes APP-AC-17 and APP-AC-30.

- [ ] **F20 - Review Bundle workspace and complete diff viewer**
  - **Depends on:** F13-F14, F16-F19.
  - **Deliver:** Build the core Review Bundle screen: item navigation; original immutable feedback; assessment/disposition; editable proposed replies; related files; validation; activity/turn reports and usage; effective AI configuration/policy; state/reason guidance; copy/open worktree path; and actions gated by state. Add read-only relevant, authoritative proposed-worktree, and contextual PR diff views with file navigation, line numbers, syntax highlighting, additions/removals, collapsed context, new/deleted markers, and open/reveal file actions.
  - **Exit:** The user can inspect every persisted input, output, actual validation result, and the exact complete diff eligible for publication; UI text never confuses the context diff with the proposed diff.
  - **Primary application criteria:** APP-AC-21, APP-AC-67; completes the UI aspects of APP-AC-38, APP-AC-58, and APP-AC-62.

- [ ] **F21 - Read-only conversation and worktree-mutating review revisions**
  - **Depends on:** F15-F20.
  - **Deliver:** Add per-entry instructions and chat. Route clarification/brainstorming through the Read-only Conversation profile with enforced read-only policy; route requested code/test/assessment/reply changes through Review Revision and `AIWorkController`. Persist conversations/turn snapshots, stream safe progress, consume budgets only for mutating turns, then refresh the bundle strictly from actual Git/validation state.
  - **Exit:** The user can converse and revise before publication; read-only turns cannot mutate files; revisions retain manual edits, produce turn reports, and return to `READY_FOR_REVIEW` or `NEEDS_ATTENTION` deterministically.
  - **Primary application criteria:** APP-AC-22; integrates APP-AC-33, APP-AC-55 through APP-AC-62.

- [ ] **F22 - Discard, stale detection, and re-evaluation with dirty-worktree choices**
  - **Depends on:** F10-F13, F16-F21.
  - **Deliver:** Detect remote head movement during polling and before action; mark bundles stale without deleting history/worktrees; block stale publication; and implement **Discard** and **Re-evaluate**. Before destructive replacement, show the actual changes and require **Clear All Changes**, **Clear Only AI Changes**, or **Keep Worktree and Cancel**; re-evaluate from current remote snapshots with the current Automatic Review profile while preserving original feedback versions and prior bundle history.
  - **Exit:** No stale bundle can publish, no dirty worktree is silently changed, handled versions remain handled after discard, and re-evaluation produces a newly snapshotted bundle while the PR remains held.
  - **Primary application criteria:** APP-AC-23, APP-AC-26; completes APP-AC-24, APP-AC-39, and APP-AC-67.

- [ ] **F23 - Human-approved, idempotent Review Bundle publication**
  - **Depends on:** F06, F13, F18, F20-F22.
  - **Deliver:** Add the final exact-diff/response/commit-message approval flow and deterministic publication state machine. Persist approval, lock, intent, idempotency keys, phases, baseline/head verification, commit SHA, push reconciliation, and per-response pending/posted/failed state/remote IDs before side effects. Stage only the approved proposed diff; support response-only publication; never force push; make replies editable; and represent partial response failure as `PUBLISHED_WITH_ERRORS` without republishing code.
  - **Exit:** Restart or uncertain network outcomes reconcile remote state before retry; duplicate commits/pushes/comments are impossible under tested fault injection; success/discard releases the hold correctly and exposes later feedback.
  - **Primary application criteria:** APP-AC-27, APP-AC-28, APP-AC-29, APP-AC-68.

### Phase 5 - Managed PR branch synchronization

- [ ] **F24 - Synchronization selection, source resolution, and confirmation**
  - **Depends on:** F06-F08, F13, F16.
  - **Deliver:** Add inbox selection/clear/select-all and **Synchronize PR Branch(es)**. Deterministically resolve override then `prBaseBranch`, never repository default branch; explicitly resolve source/destination repositories for forks; fetch current `syncSourceSha`/`prHeadSha`; classify every selected PR eligible/ineligible with actionable reason; and show a confirmation that authorizes preparation only.
  - **Exit:** The user sees selected count, source provenance, repositories, branches, both SHAs, and all skipped/ineligible PRs before starting; missing/ambiguous refs can never choose an implicit same-named branch.
  - **Primary application criteria:** APP-AC-43, APP-AC-44, APP-AC-45.

- [ ] **F25 - Independent deterministic synchronization and clean-merge results**
  - **Depends on:** F12-F14, F24.
  - **Deliver:** Persist batch/operation records; create a separate worktree per eligible PR at `prHeadSha`; perform explicit no-commit merges; distinguish already-up-to-date/no-op; record conflicts; inspect the actual merge; run validation; and continue other PRs after any skip/failure. Persist result, diff, reason, worktree, SHAs, repositories, validation, and statuses with plain-language next actions.
  - **Exit:** Clean merges reach `READY_TO_PUBLISH` using zero AI tokens, no-op merges create no empty merge commit, failures are isolated per PR, and every result survives window closure/restart.
  - **Primary application criteria:** APP-AC-46, APP-AC-47, APP-AC-49.

- [ ] **F26 - AI-assisted merge-conflict resolution**
  - **Depends on:** F15-F17, F25.
  - **Deliver:** On actual conflicts only, invoke Merge Conflict Resolution inside the synchronization worktree with exact branch/repository/SHA identities, conflicted paths, intent, and instructions. Use bounded segments and turn reports; deterministically require no unmerged paths, no unintended conflict markers, and recorded validation. Preserve stopped work for manual edits and expose explicitly confirmed **Retry Resolution** with prior history/usage.
  - **Exit:** A fixture with semantic conflicts can reach reviewable success or a concrete `NEEDS_ATTENTION` reason; provider claims alone cannot complete it; retry never resets or hides prior budget/evidence.
  - **Primary application criteria:** APP-AC-48; completes synchronization coverage for APP-AC-54 through APP-AC-64 and APP-AC-70.

- [ ] **F27 - Synchronization result review, staleness, and publication**
  - **Depends on:** F19-F20, F23-F26.
  - **Deliver:** Add batch/result review UI with status overlays, deterministic explanations, full diff/validation/worktree/AI evidence, discard/re-evaluate/dirty-worktree handling, and per-result **Publish Merge**. Re-fetch and verify PR openness, both SHAs, exact merge state, and non-force feasibility; persist/reconcile publication; mark older bundles stale after head movement; keep each PR outcome isolated.
  - **Exit:** Every merge is individually reviewable and explicitly approved; either SHA movement blocks publication; retry/resume cannot duplicate merge commits or pushes; successful publication preserves historical bundles and marks affected ones stale.
  - **Primary application criteria:** APP-AC-50, APP-AC-51, APP-AC-52, APP-AC-53.

### Phase 6 - Reliability, security, and release completion

- [ ] **F28 - Restart, sleep, network-loss, and uncertain-outcome recovery**
  - **Depends on:** F10-F27.
  - **Deliver:** Add startup reconciliation for timers, holds, jobs, worktrees, AI operations, validation, synchronization, and publication; resume only deterministic/recoverable phases; never auto-authorize a stopped AI segment; handle sleep/wake and offline/online transitions with bounded backoff; and surface orphaned/missing worktrees or unreconciled effects as actionable states.
  - **Exit:** Fault-injection tests kill/restart the app at every durable phase and demonstrate no lost feedback, reset budget, duplicate external effect, overwritten worktree, or falsely successful result.
  - **Primary application criteria:** Hardens APP-AC-04, APP-AC-17, APP-AC-24, APP-AC-25, APP-AC-49, APP-AC-53, APP-AC-55, and APP-AC-68.

- [ ] **F29 - Security and trust-boundary hardening**
  - **Depends on:** F05-F28.
  - **Deliver:** Threat-model preload/IPC, URL parsing, shell/file opening, Git arguments, validation commands, database paths, credential handling, provider environments, sandbox/policy translation, log/output redaction, and dependency supply chain. Enforce renderer isolation and schema validation at boundaries; verify AI has no application publication credentials; document the MVP's defense-in-depth limits.
  - **Exit:** Security tests and review demonstrate least-privilege IPC, safe process invocation, no secret persistence/leakage, no path escape from operation ownership, and fail-closed policy/capability behavior.
  - **Primary application criteria:** Hardens APP-AC-01, APP-AC-28, APP-AC-29, APP-AC-50, APP-AC-63, APP-AC-64, and APP-AC-70.

- [ ] **F30 - Windows packaging, end-to-end acceptance, and release readiness**
  - **Depends on:** F00-F29.
  - **Deliver:** Produce the installable Windows MVP with application identity/icons, upgrade-safe data paths, startup/shutdown behavior, signing/update decisions documented, clean-machine installation instructions, accessibility/keyboard/focus/error-state review, performance bounds, and support diagnostics. Run a requirements trace against all 70 application acceptance criteria plus the full workflow on GitHub.com and supported GHES test configurations.
  - **Exit:** A clean Windows machine can install, configure, run in the tray, monitor multiple PRs, prepare/revise/discard/publish Review Bundles, synchronize branches, recover from restart/network faults, and uninstall without losing externally published history. Every APP-AC has recorded passing evidence or the MVP is not complete.
  - **Primary application criteria:** Final verification of APP-AC-01 through APP-AC-70.

## Acceptance-criteria ownership ledger

This ledger is a completeness check, not a substitute for the PRD coverage linter. “Primary owner” identifies where the behavior should first become complete; later items may integrate or harden it.

| Application criteria | Primary checklist item(s) |
| --- | --- |
| APP-AC-01 | F05 |
| APP-AC-02 | F07 |
| APP-AC-03 | F08 |
| APP-AC-04, APP-AC-05, APP-AC-06 | F10 |
| APP-AC-07 | F11 |
| APP-AC-08 | F10 |
| APP-AC-09 | F12 |
| APP-AC-10 | F13 |
| APP-AC-11, APP-AC-12 | F15 |
| APP-AC-13 | F14 |
| APP-AC-14 | F18 |
| APP-AC-15 | F19 |
| APP-AC-16 | F11 |
| APP-AC-17 | F04, F19 |
| APP-AC-18, APP-AC-19, APP-AC-20 | F19, F04 |
| APP-AC-21 | F20 |
| APP-AC-22 | F21 |
| APP-AC-23 | F22 |
| APP-AC-24, APP-AC-25 | F11, F22 |
| APP-AC-26 | F22 |
| APP-AC-27, APP-AC-28, APP-AC-29 | F23 |
| APP-AC-30 | F04 |
| APP-AC-31 | F19 |
| APP-AC-32, APP-AC-33, APP-AC-34, APP-AC-35, APP-AC-36 | F16 |
| APP-AC-37 | F13, F16 |
| APP-AC-38 | F19, F20 |
| APP-AC-39 | F13, F22 |
| APP-AC-40 | F07 |
| APP-AC-41, APP-AC-42 | F16, F18 |
| APP-AC-43, APP-AC-44, APP-AC-45 | F24 |
| APP-AC-46, APP-AC-47 | F25 |
| APP-AC-48 | F26 |
| APP-AC-49 | F25 |
| APP-AC-50, APP-AC-51, APP-AC-52, APP-AC-53 | F27 |
| APP-AC-54, APP-AC-55, APP-AC-56, APP-AC-57, APP-AC-58 | F17 |
| APP-AC-59, APP-AC-60, APP-AC-61, APP-AC-62 | F16 |
| APP-AC-63, APP-AC-64 | F15 |
| APP-AC-65 | F10 |
| APP-AC-66 | F17, F18 |
| APP-AC-67 | F13, F20, F23 |
| APP-AC-68 | F23, F28 |
| APP-AC-69 | F10 |
| APP-AC-70 | F16, F29 |

## Completion rule

The MVP is complete only when every top-level item is checked, `npm run check` passes, the feature PRDs collectively cover every applicable `APP-AC-*` criterion without unresolved linter findings, and F30 has recorded end-to-end evidence for all 70 application acceptance criteria. Future-enhancement and non-goal work must not be added merely to make this checklist appear more complete.
