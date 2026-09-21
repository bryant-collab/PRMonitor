# PRMonitor

## Product Status

**Status:** MVP Specification
**Product type:** Local desktop developer tool
**Primary platform:** Windows, with architecture that does not prevent macOS/Linux support, which will be in V2
**Dependencies:** Electron (including its Node.js runtime), React, TypeScript, an AI provider integration (MVP: `@openai/codex-sdk`), SQLite, Zod, Git CLI, GitHub REST API (GitHub.com or GitHub Enterprise Server), and the host operating system's secure credential store

---

# 1. Product Summary

PRMonitor is a local desktop application that monitors one or more GitHub / GitHub Enterprise Server pull requests on behalf of a developer.

When new PR review feedback appears, the application automatically retrieves the feedback, prepares an isolated local working environment, runs any configured baseline validation, and invokes the configured AI provider first in a read-only proposal phase. The developer can accept or override each proposed disposition before the provider is allowed to make code changes. PRMonitor then implements the accepted decisions, runs post-change validation, and prepares proposed responses. In the MVP, that provider is OpenAI Codex through `@openai/codex-sdk`.

For the MVP, OpenAI Codex is the selected AI provider and is accessed through `@openai/codex-sdk`. Codex is an implementation choice at the provider boundary, not a requirement that should leak into the rest of the application. The architecture must leave room for future provider adapters, such as a GitHub Copilot-based integration or AWS Bedrock, without requiring changes to deterministic monitoring, worktree isolation, AI work policy, validation, review bundles, or publication. Those providers are future considerations and are not MVP dependencies.

Nothing is pushed to GitHub and no GitHub comments are posted without explicit human approval.

When an AI review proposal is ready, or when the final implemented changes are ready, the application sends a native operating-system notification. Clicking the notification opens the application directly to the relevant review screen showing:

* the review comments that were handled;
* the selected AI provider's assessment of each comment;
* whether the selected AI provider recommends fixing, pushing back, asking a question, or making no change;
* the developer's accept/override decision for each recommendation when one has been recorded;
* proposed GitHub responses;
* baseline and post-change validation/test results;
* relevant changed files;
* the complete local diff.

Before implementation, the developer may accept or override each recommendation, answer question items in their textboxes, discard the proposal, or provide additional instructions. Only after those decisions does the selected AI provider receive authority to modify the isolated worktree. After implementation, the developer may continue interacting with the provider, edit proposed responses, inspect the complete diff, discard the result, or explicitly publish it.

The application settings must allow the developer to choose the AI provider, model, and provider-supported reasoning effort independently for each kind of AI task PRMonitor supports. The selected settings are applied through the corresponding provider adapter and are visible in the resulting review or operation history.

The developer may also select one, several, or all managed PRs and ask PRMonitor to merge each PR's effective synchronization source branch into the PR head branch. By default, the synchronization source branch is the PR's GitHub `base.ref`; an individual PR override can select another source branch when needed. The PR head branch is the GitHub `head.ref` branch that the PR updates. Git performs the merge deterministically. When merge conflicts require semantic decisions, the selected AI provider resolves them only inside an isolated synchronization worktree. Each PR produces an independently reviewable result, and no merge is pushed without explicit human approval.

The application runs persistently in the system tray. Closing its visible window must not stop PR monitoring or active AI-provider work.

---

# 2. Core Product Principle

## Deterministic by Default, AI by Exception

Any behavior that can be implemented reliably using deterministic software must be implemented deterministically.

The AI must not be used merely for convenience when normal program logic can provide the same answer.

Deterministic operations include, but are not limited to:

* polling GitHub Enterprise;
* determining whether API responses have changed;
* detecting new comment IDs;
* detecting edited comments;
* deduplicating previously processed events;
* identifying the application's own comments;
* determining whether a PR is open, closed, or merged;
* determining whether a branch SHA has changed;
* resolving the effective synchronization source branch and current `syncSourceSha`/`prHeadSha` values;
* attempting a Git merge and detecting unmerged paths or conflict markers;
* cloning/fetching repositories;
* creating and deleting Git worktrees;
* calculating Git diffs;
* running commands and tests;
* recording command exit codes;
* tracking state;
* retries and backoff;
* notification delivery;
* application lifecycle;
* publishing Git commits;
* publishing approved GitHub replies.

AI should be invoked only for tasks requiring semantic reasoning, for example:

* understanding a reviewer concern;
* determining whether the concern represents a valid problem;
* identifying the underlying problem rather than blindly following a suggested implementation;
* deciding whether code should change;
* determining an appropriate implementation;
* deciding whether pushback or clarification is more appropriate;
* making code changes;
* resolving merge conflicts when the correct result depends on code meaning;
* selecting useful tests when this cannot be determined mechanically;
* explaining the proposed resolution;
* responding to additional instructions from the developer.

The desired result is that the application may remain running indefinitely while consuming **zero AI tokens when no semantic work exists**.

---

# 3. Product Philosophy

PRMonitor is not an autonomous developer operating independently on shared state.

It is an autonomous **local worker** with a human-controlled publication boundary.

The AI may freely investigate, edit, revert, test, and iterate within its private local Git worktree.

The AI must not directly:

* push commits;
* force-push branches;
* post GitHub comments;
* resolve GitHub conversations;
* approve reviews;
* merge PRs;
* change GitHub repository settings.

Those actions belong to deterministic application code and require the appropriate user authorization.

The primary trust boundary is:

> AI may change isolated local state autonomously. Human approval is required before changing shared remote state.

---

# 4. Primary User

The primary user is a software developer who:

* works with repositories on GitHub / GitHub Enterprise Server;
* owns or actively maintains pull requests;
* receives reviews from humans and AI reviewers such as GitHub Copilot;
* wants review feedback investigated and prepared while working on other tasks;
* frequently switches between Windows virtual desktops;
* wants a low-friction workflow with minimal configuration.

---

# 5. Primary User Experience

A typical workflow is:

1. The developer adds a PR to PRMonitor.
2. PRMonitor begins watching it.
3. The developer closes the application window. The window is destroyed, not hidden, so multiple virtual-desktop usage won't feel clunky.
4. PRMonitor remains active in the system tray.
5. A reviewer submits new feedback.
6. Deterministic polling detects the new feedback.
7. PRMonitor determines whether the feedback is new and requires analysis.
8. PRMonitor prepares an isolated worktree at the current PR head and runs configured baseline validation when available.
9. The configured AI provider performs a read-only Review Proposal using the configured **Automatic Review / Re-evaluation** task profile.
10. A proposal-stage Review Bundle is created. The AI has not modified the worktree.
11. The PR enters `READY_FOR_REVIEW` with `PROPOSAL_REVIEW` stage, which places it on an automatic per-PR review hold. No further automatic analysis or worktree mutation is started for that PR while the proposal awaits human decisions.
12. The developer receives a native OS notification, clicks it, and opens the relevant proposal bundle.
13. The developer reviews each comment, assessment, disposition, proposed implementation, baseline validation, and proposed reply.
14. The developer explicitly accepts or overrides every recommendation. Each `question` item requires an answer in its textbox. The developer may also provide implementation instructions or discard the proposal.
15. After all decisions are complete, the configured **Review Revision** profile implements only the accepted decisions in the isolated worktree.
16. Deterministic application code inspects the actual diff and runs post-change validation.
17. The Review Bundle enters `FINAL_REVIEW` and the developer reviews the final reasoning, replies, validation, and complete diff.
18. The developer may ask the selected AI provider for revisions. Worktree-mutating revisions use the configured **Review Revision** task profile. Read-only clarification or brainstorming uses the configured **Read-only Conversation** task profile and cannot modify the codebase.
19. When satisfied, the developer chooses **Push Changes**.
20. Deterministic application code verifies that the remote PR head has not unexpectedly changed.
21. The application commits and pushes the complete approved code diff and posts only selected approved responses.
22. The PR returns to Watching state and the automatic review hold is released.

The automatic review hold is tied to the Review Bundle and persists independently of whether the application window is open, whether the user has selected the PR, or whether the user has viewed the notification. The hold is released only by an explicit bundle outcome such as successful publication, discard, or a user-directed re-evaluation.

## Managed PR branch synchronization

The developer can select managed PRs from the inbox and start **Synchronize PR Branch** for the selected PRs or **Synchronize All PR Branches** for every eligible managed PR. The effective synchronization source branch is the per-PR override when present, otherwise the PR's GitHub base branch (`base.ref`). The destination is the PR head branch (`head.ref`). Before starting, the application shows the resolved synchronization source branch that will be used for each PR, the current synchronization-source SHA, the current PR-head SHA, and any PRs that are not eligible.

Each selected PR is processed independently in its own isolated synchronization worktree. A clean merge requires no AI. If Git reports conflicts, the configured AI provider may inspect the repository and resolve them in that worktree using the configured **Merge Conflict Resolution** task profile, after which deterministic checks verify that no unmerged paths remain and that validation commands actually pass or fail. The result is presented for human review before any branch is updated on GitHub.

The operation is not allowed to overwrite an existing Review Bundle worktree. If a merge is published, any older Review Bundle for that PR whose expected head no longer matches becomes stale and remains available for inspection or re-evaluation.

---

# 6. Desktop Application Lifecycle

PRMonitor must be implemented as a persistent desktop application rather than a browser-hosted application.

Electron with TypeScript is the preferred MVP technology.

The application consists conceptually of:

```text
Electron Main Process
│
├── PR Watcher
├── GitHub Enterprise Client
├── Job Manager
├── AI Provider Manager
├── Git / Worktree Manager
├── Validation Runner
├── SQLite Persistence
├── Notification Manager
└── System Tray Manager
        │
        │ IPC
        ▼
Electron Renderer
│
├── React UI
├── PR Inbox
├── Review Bundle
├── Diff Viewer
├── Activity Viewer
└── AI Conversation
```

The Electron main process is authoritative for background work.

The renderer is a view/controller for persisted application state and must not own long-running operations.

Closing the UI window must destroy or fully close the visible `BrowserWindow` while leaving the Electron main process running.

This is intentional so that opening the application again can create a new native window associated with the user's current virtual desktop rather than maintaining a hidden window associated with an older desktop.

The application exits only when the user explicitly selects:

**Shutdown PRMonitor**

The word **Quit** should not be used for this command.

---

# 7. System Tray Requirements

PRMonitor must have a system tray icon whenever its background process is running.

The tray context menu should contain at minimum:

```text
PRMonitor

<N> PRs need review

<PR requiring attention>
<PR currently working>

────────────────────

Open PRMonitor
Pause Watching

────────────────────

Shutdown PRMonitor
```

Selecting **Open PRMonitor** creates a new application window if none exists.

Selecting a PR or ready Review Bundle opens directly to that item.

Selecting **Pause Watching** prevents new automatic analysis jobs from starting. Existing state is retained.

This global pause is distinct from the automatic per-PR review hold. A PR in `READY_FOR_REVIEW` or `NEEDS_ATTENTION` is held automatically even when global watching is enabled. Opening or selecting that PR does not release the hold.

Selecting **Shutdown PRMonitor** gracefully terminates background jobs as appropriate, persists state, removes the tray icon, and exits the application.

Closing the normal application window must never be interpreted as Shutdown.

---

# 8. Native Notifications

The main process must be capable of sending native operating-system notifications without a renderer window being open.

Notifications should be outcome-oriented rather than activity-oriented.

Good notifications include:

**Changes ready for review**

> SYS-1234 Preferences
> Review proposal ready: 5 comments analyzed, 4 fix proposals, 1 proposed pushback.
> Baseline checks passing.

**Changes ready for final review**

> SYS-1234 Preferences
> 4 accepted fixes implemented; 1 pushback retained.
> Post-change validation passing.

**Need your input**

> SYS-1234 Preferences
> One review comment appears to require a developer decision.

**Validation failed**

> SYS-1234 Preferences
> Proposed changes are ready, but 2 tests are failing.

Routine events such as “new GitHub comment detected” should not normally generate notifications.

When a managed-PR synchronization batch reaches reviewable outcomes, PRMonitor should send an outcome-oriented notification summarizing counts such as merges ready to publish, conflicts needing attention, stale results, and failures. Clicking it must open the synchronization batch with the individual PR results visible.

Clicking a notification must create/open an application window and deep-link directly to the relevant PR or Review Bundle.

When a Review Bundle has an available isolated worktree, the notification should also expose a clickable **Open Worktree** link or action. Activating it must open the worktree directory in the operating system's default file manager, such as Windows File Explorer, macOS Finder, or the equivalent on another supported platform. The link must target the Review Bundle's isolated worktree, never the developer's normal working directory.

The Review Bundle screen should provide the same clickable worktree path and action. The path should be displayed clearly enough that the user can also copy it and open it in an IDE such as Visual Studio Code, Visual Studio, or another editor of their choice.

---

# 9. Virtual Desktop Behavior

Supporting frequent switching between Windows virtual desktops is an important UX requirement.

The preferred behavior is:

```text
User closes UI
       ↓
BrowserWindow is destroyed
       ↓
Electron main process continues
       ↓
user switches virtual desktops
       ↓
notification appears
       ↓
user clicks notification
       ↓
new BrowserWindow is created
       ↓
window appears on current desktop
       ↓
relevant Review Bundle opens
```

A technical spike must validate actual Windows behavior early in development.

At minimum test:

* launching on Desktop A;
* closing the UI;
* opening from tray on Desktop B;
* closing again;
* clicking a notification on Desktop C;
* foreground focus behavior;
* whether a newly created window appears on the currently active virtual desktop.

If platform-specific handling is required to reliably accomplish this, such handling is permitted, but the system should be architected such that other OSes can each have their own implementation for this aspect while keeping all of the other code common between them.

---

# 10. Adding a PR

The user should be able to add a PR by pasting its GitHub / GitHub Enterprise URL.

Example:

```text
https://github.company.com/team/project/pull/4821
```

The application should deterministically derive:

* GHES server;
* repository owner;
* repository;
* PR number.

The application retrieves PR metadata and determines the head branch and current SHA.

The application should locate an existing local clone when possible or allow the user to select one.

If no local clone exists, a later enhancement may provide automatic cloning.

Adding a PR should require as little configuration as possible.

The user may optionally specify a **Branch Synchronization Source Branch** for the PR when adding it, and may edit that override later from the PR's settings or details screen. When left blank, the PR synchronizes from its GitHub base branch (`base.ref`). This per-PR override is intended for cases where the PR should be synchronized from a feature or intermediate branch other than its GitHub base branch.

When adding a PR, the user should be able to provide optional multi-line **PR Intent / Context**. This field is intended for context that helps the selected AI provider understand why the PR exists, such as text copied from a JIRA ticket, GitHub issue, design note, or team discussion.

The field should be available during the Add PR flow and editable later from the PR's settings or details screen. It is associated with the individual PR, not stored as an application-wide Common Instruction. The user may leave it blank when the PR's intent is already clear from the repository and GitHub metadata.

PR Intent / Context is informative input for semantic reasoning. It must not be treated as authoritative when it conflicts with the actual repository, the current PR, review feedback, or deterministic validation results. The application should preserve the user's text without requiring a JIRA or issue-tracker integration.

The user should also be able to configure repository-specific **Build & Validation Instructions**. These settings are intended for large repositories and non-standard build layouts where a generic package-manifest guess would be unreliable. They should include:

* human-readable instructions that are supplied to the AI provider as context;
* structured, deterministic commands for the validation runner;
* whether each command is a baseline command, a post-change command, or both; and
* any required manual checks and their instructions.

Human-readable Build & Validation Instructions are guidance, not executable authority. Only valid, trusted structured commands may run. The effective instructions and command profile must be snapshotted with the Review Bundle so later preference changes do not change the meaning of an existing result.

---

# 11. Deterministic PR Watcher

The PR watcher must contain no AI logic. It should use traditional, deterministic code.

Its job is exclusively to determine whether new remote events exist.

GitHub treats different PR feedback forms as different API resources, so the watcher should monitor at least:

* inline pull-request review comments;
* pull-request reviews and their review bodies;
* general PR conversation comments, represented through GitHub's issue-comment APIs.

GitHub Enterprise exposes separate REST resources for these categories.

For each watched PR, persist identifiers and update timestamps for observed remote objects.

An example normalized event is:

```ts
interface ReviewEvent {
  serverId: string;
  repositoryId: string;
  pullRequestNumber: number;

  source:
    | "review_comment"
    | "review"
    | "issue_comment";

  remoteId: string;
  authorLogin: string;
  body: string | null;

  createdAt: string;
  updatedAt: string | null;
  contentHash: string;
  versionKey: string;

  reviewState?: string;
  reviewId?: string;
  inReplyToId?: string;
  path?: string;
  line?: number;
  startLine?: number;
  side?: string;

  observedAt: string;
}
```

A remote object and each observed version of that object must be persisted separately. The immutable version snapshot must contain the exact body, review state, location metadata, and other fields used for semantic analysis. This allows edited comments and changed review states to be treated as new input without losing the version that an earlier Review Bundle handled.

Conceptually:

```text
serverId + repositoryId + pullRequestNumber + source + remoteId
  + updatedAt-or-contentHash
```

`versionKey` should be derived from that scoped identity and a content hash over all semantically relevant fields, not only the comment body. A missing or unchanged remote timestamp must not prevent a changed snapshot from being observed. Each Review Bundle item must refer to the immutable event-version record, not only to the remote object ID.

---

# 12. Efficient Polling

PRMonitor should use polling rather than require inbound webhooks.

Polling is appropriate because PRMonitor is a local desktop application and should not require an externally reachable HTTP endpoint.

Polling must not invoke an AI provider.

Use GitHub conditional requests whenever supported.

Persist `ETag` and/or `Last-Modified` response information and send conditional GET requests on subsequent polls.

GitHub recommends conditional requests; unchanged authorized requests can return `304 Not Modified`, and those `304` responses do not count against the primary REST API rate limit.

The watcher should:

1. Request remote PR state.
2. Prefer conditional GETs.
3. For the resource that returned `304`, do nothing for that resource when unchanged.
4. When changed, retrieve applicable objects for each monitored feedback resource.
5. Normalize them.
6. Compare them against persisted observations.
7. create internal events only for unseen or meaningfully updated items.
8. schedule AI work only when at least one actionable semantic item exists and the PR is eligible for automatic work. A PR in `READY_FOR_REVIEW` or `NEEDS_ATTENTION` is not eligible until the user explicitly continues, re-evaluates, or discards the current work.

Conditional-request metadata and pagination checkpoints must be stored independently for PR metadata, inline review comments, reviews, and issue comments. A `304 Not Modified` response for PR metadata must not be treated as proof that all feedback resources are unchanged.

The polling interval must be configurable. The MVP default is 10 minutes.

The user should also have a **Check Now** action.

Network errors should gracefully resolve when connection is restored.

A network failure must never cause an item to be marked processed.

---

# 13. Deterministic Event Filtering

Before invoking an AI provider, deterministic filtering should eliminate events that clearly do not require AI.

Examples include:

* item already processed at the same version;
* comment authored by PRMonitor itself;
* empty event with no semantic content;
* pure approval with no review body;
* PR already closed or merged;
* configured bot/service accounts that should be ignored;
* duplicate delivery of an existing GitHub object.

The deterministic layer must **not** attempt semantic classification using keywords.

For example, code should not try to infer that:

> "Could we rename this?"

is trivial while:

> "I think this race can corrupt state"

is important.

That distinction requires semantic understanding and belongs to the configured AI provider.

When an event version is included in a Review Bundle, persist the association between that immutable version and the bundle that handled it. Publishing or discarding the bundle must preserve that handled record; it must not make the same event version eligible for automatic analysis again. New or meaningfully updated event versions observed while the PR is on a review hold remain separately persisted and may be scheduled after the hold is released.

---

# 14. Review Batching

Review activity should be grouped into batches before invoking an AI provider.

When a new review event arrives, start a configurable quiet-period timer.

Additional comments arriving during that period are added to the same pending batch.

A reasonable default quiet period is 10 minutes.

Example:

```text
comment A arrives
      ↓
10 minute debounce begins

8 seconds later:
comment B arrives
      ↓
timer restarts

5 minutes later:
comment C arrives
      ↓
timer restarts

10 minutes of silence
      ↓
one AI job containing A+B+C
```

This prevents a six-comment review from causing six independent AI jobs.

Batching logic is deterministic and uses no AI.

---
The quiet period should be a configurable application setting.

# 15. Git Worktree Isolation

Every watched PR being actively modified must use an isolated Git worktree controlled by PRMonitor.

An AI provider must never modify the developer's normal working directory.

Conceptually:

```text
C:\src\payments
    developer workspace

%APPDATA%\PRMonitor\worktrees\
    payments-4821\
        AI workspace
```

Before beginning a new Review Bundle:

1. fetch the remote;
2. determine the current PR base branch SHA and PR head branch SHA;
3. prepare the worktree at the PR head SHA;
4. confirm the worktree is clean;
5. begin AI-provider work.

Each Review Bundle must record these distinct snapshots:

* `prBaseSha` — the PR base branch commit observed when the bundle was prepared. This is useful for showing the PR's overall change in context.
* `prHeadSha` — the remote PR head commit observed when the bundle was prepared.
* `worktreeBaselineSha` — the exact commit checked out in the isolated worktree before PRMonitor or the user made proposed changes. For the normal review flow this equals `prHeadSha`, but it is stored separately so the publication baseline is explicit.

The authoritative proposed-change diff is the actual worktree state compared with `worktreeBaselineSha`. A separate context diff may compare that same worktree state with `prBaseSha` and will include the PR's pre-existing changes as well as the proposed changes. Publishing a Review Bundle must stage and publish only the reviewed proposed changes relative to `worktreeBaselineSha`, subject to the user's explicit decision about manual edits.

If manual edits are present, **Push Changes** must show the exact current proposed diff and require the user to approve that complete diff explicitly. The application must not publish user edits merely because they happen to be in the worktree, and it must not silently reconstruct partial patches. If the user does not want those edits included, they must use the worktree-change handling choices before publishing; per-hunk acceptance is outside the MVP.

The isolated worktree is also a user-accessible workspace. The user may open it in a file manager or IDE to inspect, edit, build, and test the proposed changes manually.

The user must be able to configure the root directory under which PRMonitor creates isolated worktrees. The default may be under the operating system's application-data directory, but the user must be able to select another local directory with sufficient space. The configured root is an application setting, while each Review Bundle records the resolved worktree path that was actually used.

When a PR-level synchronization-source override is blank, the PR uses its GitHub base branch (`base.ref`). The resolved `syncSourceBranch`, its repository, and its SHA must be recorded with each synchronization operation. The destination must be recorded as the PR's `prHeadBranch` (`head.ref`) and its exact `prHeadSha`.

While a Review Bundle or user-directed AI conversation is active, PRMonitor must not silently reset, replace, delete, or overwrite the isolated worktree. Before continuing AI work, running validation, refreshing a Review Bundle, or publishing, deterministic application code must inspect the actual worktree state and current Git diff so that manual edits are represented accurately. If the worktree has changed unexpectedly or contains edits that require a decision, the application should surface that condition and request user direction rather than discarding the changes.

PRMonitor must record worktree snapshots before and after each worktree-mutating AI turn so it can identify changes attributable to that operation. File ownership cannot be inferred safely from filenames alone; if user and AI edits overlap the same lines, the application must not silently overwrite either side.

When **Discard** or **Re-evaluate** would remove or replace a dirty worktree, the user must be shown the actual change summary and choose one of:

* **Clear All Changes** — remove all uncommitted worktree changes after an explicit destructive confirmation;
* **Clear Only AI Changes** — apply a deterministic three-way removal of changes attributable to PRMonitor while preserving user changes where they do not overlap; or
* **Keep Worktree and Cancel** — preserve the worktree and leave the current result available for later action.

If AI and user changes overlap and cannot be separated safely, **Clear Only AI Changes** must stop and require manual resolution or preservation of the complete worktree. The application must never guess which overlapping lines belong to the user.

### Synchronization worktrees

Merging the resolved synchronization source branch into a managed PR must use a separate, operation-owned worktree. It must not mutate the worktree belonging to an active Review Bundle, a developer conversation, or another synchronization operation. The worktree records the exact `prHeadBranch`, `prHeadSha`, `syncSourceBranch`, `syncSourceSha`, and source repository used to prepare the result.

The **Clear All Changes**, **Clear Only AI Changes**, and **Keep Worktree and Cancel** choices also apply when discarding or re-evaluating a dirty synchronization worktree. A synchronization merge and an AI conflict-resolution patch may overlap user edits, so the same three-way separation and no-guessing rule applies.

If a synchronization is published and changes the PR head, existing Review Bundles for that PR are not deleted or silently rebased. Deterministic polling marks bundles prepared against the previous head as stale, and the user may re-evaluate or discard them explicitly.

---

# 16. AI Invocation Boundary

An AI provider is invoked only after the deterministic watcher has established that new semantic review feedback exists.

The MVP AI provider is OpenAI Codex through `@openai/codex-sdk`. The application must access it through a provider adapter and provider-neutral contracts. Core orchestration, persistence, worktree management, validation, review bundles, and publication must not import or depend directly on the Codex SDK.

Future provider adapters may target GitHub Copilot or AWS Bedrock. They are not part of the MVP and must not be simulated by adding provider-specific branches throughout the application. A future adapter should be able to satisfy the same normalized request, event, structured-result, and usage-reporting contracts, while advertising its own capabilities and configuration requirements.

At minimum, the provider boundary must normalize:

* the task type and immutable task-profile snapshot;
* the immutable AI Execution Policy snapshot;
* the prepared prompt/context and interaction mode;
* the isolated worktree path when code access is allowed;
* streaming progress and turn lifecycle events when supported;
* structured semantic output;
* provider ID, model ID, opaque provider thread/session ID, and usage metadata when available; and
* provider capability limitations or execution errors as actionable, machine-readable results.

Provider-specific options, SDK objects, thread semantics, and event formats must remain inside the adapter. Optional capabilities such as streaming, reusable threads, or a provider-specific reasoning control must be checked through the capability contract; the domain workflow must not assume that every future provider supports them. Structured semantic output is different: it is a required capability for MVP review and conflict-resolution tasks because the application must not determine state by parsing prose. A provider that cannot return or be adapted to the required normalized schema must be rejected before work starts.

## AI Execution Policy

The application must own an application-level **AI Execution Policy** that is separate from an AI Task Profile. An AI Task Profile selects the provider, model, reasoning effort, and provider-specific options for a kind of semantic task. An AI Execution Policy controls what the selected provider may do while performing that task, including:

* the sandbox or equivalent execution boundary;
* whether approval prompts are allowed;
* whether network access is available;
* which operation-owned worktree paths may be written; and
* which environment variables and credentials are passed to the provider process.

The selected AI provider must not be allowed to broaden its own execution policy. The application resolves the policy, passes the provider-specific representation through the adapter, and records the effective policy with the AI Work Operation.

For the MVP Codex adapter, the default policy is **Autonomous Worktree**:

* Codex uses a `workspace-write` sandbox;
* the operation-owned isolated worktree is the only writable project location;
* Codex uses `approval_policy = "never"`, so normal worktree reads, edits, tests, and other permitted tool calls do not pause for user approval;
* network access is disabled unless the user explicitly selects a network-enabled policy; and
* the provider receives a controlled environment and no GitHub publication credentials.

The approval policy and sandbox are separate controls. `approval_policy = "never"` means that Codex does not stop to ask for approval; it does not grant unrestricted access. An action that exceeds the sandbox, requires blocked network access, or requires an unavailable permission must stop or fail with an actionable policy-blocked result. It must not silently prompt, widen the sandbox, or escalate to full access. The true full-access combination, `danger-full-access` with `approval_policy = "never"`, is an advanced option and is not the default MVP policy.

Preferences should expose named execution-policy presets rather than requiring users to understand provider-specific flags:

| Preset | Sandbox / boundary | Approval behavior | Intended use |
| --- | --- | --- | --- |
| **Read-only** | Read-only | No prompts | Inspection and read-only conversations. |
| **Autonomous Worktree** | Write access limited to the operation worktree | No prompts | Default for unattended review, revision, and conflict-resolution work. |
| **Autonomous Worktree with Network** | Write access limited to the operation worktree, with network enabled | No prompts | Tasks that explicitly require network access, such as permitted dependency or service access. |
| **Interactive Approvals** | Write access limited to the operation worktree | Ask when the boundary must be exceeded | User-attended work requiring approval decisions. |
| **Full Access** | No sandbox boundary | No prompts | Explicit advanced use only; not part of the normal unattended flow. |

The `Read-only Conversation` task type must always use a read-only policy even if a broader default is configured. Every worktree-mutating AI Work Operation segment must snapshot its effective execution policy when it starts. Changing Preferences must affect only future work. A user-directed continuation may select a different preset only after explicit confirmation and must never silently broaden an in-flight operation.

Automatic review has two distinct phases. The initial **Review Proposal** phase uses the configured **Automatic Review / Re-evaluation** task profile with the **Read-only** execution policy. It may inspect the isolated worktree and repository, but it must not modify files. After the developer has explicitly accepted or overridden every review-item recommendation, the **Review Implementation** phase may use the configured worktree-writing policy to implement only the accepted decisions. The proposal phase and implementation phase must have separate persisted evidence and configuration snapshots.

The MVP direct TypeScript SDK adapter is intended for non-interactive, isolated-worktree operation and does not need to implement live approval callbacks. If PRMonitor later exposes **Interactive Approvals**, that mode must use Codex App Server or another provider integration that exposes an equivalent host request/response approval channel. The application must not present an interactive preset while using an adapter that cannot receive and answer approval requests.

For the MVP, the Codex TypeScript SDK supports reusable threads, streaming events, structured output, explicit working directories, and controlled child-process environments. The Codex provider adapter should use these capabilities rather than building equivalent mechanisms manually.

For each watched PR, the application may maintain a provider-specific conversation reference so follow-up conversations can retain context. The reference must be stored with its provider ID and treated as opaque; it must not be assumed to be portable between providers.

The application's persisted database remains authoritative. Provider thread/session state is execution context, not application state.

## General AI Work Policy

Any application-controlled sequence in which the selected AI provider may inspect or modify an isolated worktree and may be invoked again based on the result is an **AI Work Operation**. This includes review implementation, follow-up repair or revision turns, semantic merge-conflict resolution, and future coding tasks. Read-only conversations that cannot modify a worktree are not AI Work Operations.

The initial Review Proposal phase is a bounded read-only semantic evaluation. It may inspect the repository and configured Build & Validation Instructions, but it cannot modify the worktree. Its provider turn, timeout, result, and usage are still persisted and reviewable; only the later worktree-mutating Review Implementation and revision turns consume the configured mutating-turn budget.

Every AI Work Operation must be bounded. The application must not keep invoking an AI provider indefinitely because the work appears incomplete, validation continues to fail, or the model keeps making changes without reaching a completion condition.

The user must be able to configure an application-level **Maximum AI Work Turns per Operation** preference. The MVP should allow values from 1 through 10, with a default of 3 worktree-mutating AI-provider turns per operation. The application must enforce 10 as the hard product maximum so a configuration error cannot create an unbounded loop. A turn is one AI-provider invocation that is allowed to modify the worktree; tool calls and shell commands inside that turn do not silently create additional budget.

The configured budget applies across UI closure, application restart, and automatic retries. It must be persisted with the AI Work Operation and must not reset merely because the process restarted. A per-operation override may be offered at confirmation time, but it must still respect the hard product maximum.

After every turn, deterministic application code must inspect the actual worktree and operation state. It must not rely on an AI provider claiming that it made progress or completed the task. Each operation supplies a deterministic completion predicate and, where possible, operation-specific progress signals. A valid semantic outcome that makes no code change is still allowed to complete an operation. For the read-only Review Proposal, completion means a schema-valid result accounts for every input event version, captures each assessment, proposed disposition, proposed implementation, and proposed response, and leaves the worktree unchanged. For Review Implementation, completion additionally requires that the final human decisions were the implementation input, the actual worktree state was inspected, and post-change validation evidence was recorded. All-`pushback`, all-`question`, or all-`no_change` results may therefore be complete. For conflict resolution, completion requires no unmerged paths, no unresolved conflict markers in the intended result, and recorded deterministic validation results.

The generic policy must at minimum detect:

* an unchanged worktree and unchanged problem state;
* a previously observed worktree/problem-state fingerprint repeating;
* a turn timeout, cancellation, provider failure, or controlled-process failure; and
* exhaustion of the configured turn budget.

Two consecutive turns with no material deterministic progress, when the operation-specific completion predicate is still false, must stop the automatic sequence. Unrelated file churn does not count as material progress. A repeated state must stop the sequence even if the repeated state is separated by another turn. A single AI-provider turn must also have a bounded execution timeout so a turn-level loop cannot bypass the operation-level turn budget.

When the policy stops an operation, the result becomes `NEEDS_ATTENTION` with a machine-readable stop reason such as `AI_TURN_BUDGET_EXHAUSTED`, `AI_NO_PROGRESS`, `AI_REPEATED_STATE`, `AI_TURN_TIMEOUT`, or `AI_EXECUTION_FAILED`. The application must preserve the worktree and all evidence needed for human review.

Each turn must produce a reviewable **AI Work Turn Report**. The report must distinguish model-reported information from deterministic observations and include at least:

* the turn number, start/end times, and token usage when available;
* the objective or problem the turn was asked to address;
* the approach the AI provider reported taking;
* problems the AI provider reported encountering;
* files and commands actually changed or executed, as observed by the application;
* validation and other deterministic results;
* the remaining unresolved problems after the turn;
* the deterministic progress classification and state fingerprint; and
* why the next turn was started or why the operation stopped.

The complete turn-by-turn report must be visible before the user authorizes more AI work. If an operation stops because of the policy, the user may choose an explicit **Continue AI Work** action. Branch synchronization should label this action **Retry Resolution**. That action starts another bounded AI Work Operation segment; it must never silently resume an exhausted or stopped loop. The consumed turn count and accumulated usage belong to the parent operation across UI closure, restart, and continuation segments; starting a segment must not reset them. If the user authorizes work after the parent operation's budget is exhausted, the application must create a new explicitly confirmed operation with a new budget and show the cumulative prior usage. The UI must show the prior attempts, reported approaches, encountered problems, remaining issues, and accumulated usage before confirmation. A human-directed continuation is therefore an explicit authorization decision, not an automatic retry.

The policy is a safety and cost boundary, not a semantic claim that the AI is wrong. It must preserve the local worktree for inspection and manual editing, and it must not grant any AI provider publication authority.

## Configurable AI Task Profiles

The application must provide an **AI Task Profiles** area in Preferences. A task profile maps a supported AI task type to:

* a provider identifier;
* a model identifier;
* an optional reasoning-effort value supported by that provider/model combination;
* provider-specific options that are kept behind the provider adapter; and
* a profile version or last-updated revision so the effective configuration can be identified later.

The MVP must expose these task types independently:

| Task type | Applies to |
| --- | --- |
| **Automatic Review / Re-evaluation** | The read-only proposal analysis for an initial review batch and a user-directed re-evaluation of review feedback. |
| **Review Revision** | Worktree-mutating implementation of accepted review decisions, plus follow-up, repair, or revision turns for an existing Review Bundle. |
| **Read-only Conversation** | Entry-level clarification, explanation, or brainstorming conversations that cannot modify a worktree. |
| **Merge Conflict Resolution** | Semantic conflict resolution inside a Branch Synchronization worktree. |

The Preferences UI should present one editable row for each task type, with the effective provider, model, and reasoning effort visible before the setting is saved. It must validate that the provider/model combination is usable and that the selected reasoning effort is supported when that provider exposes such a control. If the provider or configured model endpoint does not expose a model catalog, the model identifier may be entered as text, but invalid combinations must fail with an actionable error before AI work starts.

Every AI invocation must be routed through a task type and the corresponding resolved profile. The selected provider, model, reasoning effort, and provider-specific options must be passed through the provider adapter; putting them only in prompt text is not sufficient. A service must not silently choose its own provider or model, and deterministic paths must not create an AI invocation merely because a profile exists.

For a worktree-mutating **AI Work Operation**, the effective task type, provider, model, reasoning effort, provider-specific options, profile revision, and AI Execution Policy must be snapshotted when the operation segment starts. All turns in that segment use the snapshot, even if Preferences change while the operation is running. An explicit human continuation starts a new bounded segment that may snapshot the current Preferences; earlier turns retain their original configuration. Read-only conversation turns snapshot the profile and effective read-only policy used for that turn. Re-evaluation starts a new operation segment and therefore uses the current Automatic Review / Re-evaluation profile and current execution-policy preference.

The Review Bundle and Branch Synchronization result must show the effective task type, provider, model, reasoning effort when supported, profile revision, and a user-readable summary of the execution policy whenever an AI provider was used. This configuration is execution metadata for reproducibility and usage reporting; it must not be treated as a substitute for the model's semantic output or for deterministic validation.

---

# 17. Initial AI Task (MVP: Codex)

For a new review batch, the selected AI provider should receive:

* PR title;
* PR description;
* user-provided PR Intent / Context, when present;
* current review comments in the batch;
* enough metadata to locate referenced code;
* access to the isolated repository worktree;
* repository-native instructions such as `AGENTS.md`, when automatically discoverable;
* the effective repository-specific Build & Validation Instructions;
* previous relevant Review Bundle context when necessary.

The task receives the effective **Automatic Review / Re-evaluation** profile snapshot, including its provider, model, provider-supported reasoning effort, provider-specific options, and profile revision. The profile controls the provider-adapter invocation; it must not be supplied merely as natural-language instructions.

The user must not be required to manually create a PR dossier.

Optional integrations such as JIRA may later add context automatically, but they are not an MVP requirement.

## Configurable Common Instructions

The user must be able to define reusable **Common Instruction** profiles in the application's settings. These are general preferences for how the selected AI provider should work, not properties of individual PRs or tickets. This is necessary because PRMonitor may be used by multiple teams, repositories, or organizational groups that follow different conventions.

At minimum, a profile should contain:

* a human-readable name;
* the instruction text sent to the AI provider;
* whether it is enabled.

The UI should provide an application-level settings area where the user can create, edit, enable, disable, and select the active profile or profiles. The active Common Instructions apply to all applicable PR work; they must not need to be configured separately for each PR or copied into ticket records. If profiles are provided for different team conventions, switching the active profile is an application-settings change rather than a per-PR assignment.

Common Instructions are additional context and constraints for the AI provider. They must not override PRMonitor's system-level rules, the deterministic/AI boundary, the requirement for human approval before publication, repository-native instructions, or security controls.

The effective Common Instructions must be included in every relevant AI task, including follow-up turns and re-evaluations. The effective instruction text and profile version must be snapshotted with the Review Bundle solely for reproducibility; the editable source of truth remains the application settings. Editing a profile applies to future work unless the user explicitly starts a new evaluation using the edited instructions.

Common Instructions are guidance for semantic reasoning, not a deterministic semantic policy-enforcement engine. The selected AI provider must still investigate the repository and explain how the instructions affect its assessment.

For example, a team may provide instructions such as:

```text
For the LaunchDarklyFlag enum, don't worry about enum values changing when we retire LD flags by removing them. These aren't persisted.
```

The conceptual **Review Proposal** task should be:

```text
Investigate the new PR review feedback.

For each item:

1. Determine what concern the reviewer is raising.
2. Investigate the repository before deciding whether the concern is valid.
3. If code should change, explain the underlying problem and propose an
   implementation approach rather than applying the change yet.
4. If code should not change, explain why and propose an appropriate
   pushback or no-change response.
5. If the answer depends on information that cannot be reliably inferred,
   identify the question that requires human input.
6. Apply the applicable Common Instructions and Build & Validation
   Instructions while considering the feedback.
7. Use baseline validation evidence when available; do not claim that a
   proposed change passes post-change validation before implementation.
8. Review the relevant repository context before finishing.

Do not modify files.
Do not commit.
Do not push.
Do not interact directly with GitHub.

Return the required ReviewBundle structured response.
```

After the developer has accepted or overridden every item, a separate
worktree-mutating **Review Implementation** task receives the final per-item
decisions, question answers, and user instructions. It may implement accepted
fixes and tests only, then returns control to deterministic diff inspection and
post-change validation.

---

# 18. Structured AI Output

The selected AI provider must return machine-readable structured output.

The UI must not depend on parsing prose to determine application state.

An approximate schema is:

```ts
interface AIReviewBundle {
  summary: string;

  items: AIReviewItem[];

  validation: {
    commands: ValidationCommand[];
    overallStatus:
      | "passed"
      | "failed"
      | "partial"
      | "not_run";
  };

  requiresHumanInput: boolean;
}

interface AIReviewItem {
  remoteEventVersionId: string;
  remoteEventId: string;

  disposition:
    | "fixed"
    | "pushback"
    | "question"
    | "no_change";

  assessment: string;
  proposedImplementation?: string;

  proposedReply?: string;

  relatedFiles: string[];
}

interface AIWorkTurnReport {
  turnNumber: number;
  startedAt: string;
  completedAt: string;
  objective: string;

  // Returned by the AI provider and displayed as model-reported information.
  reportedApproach: string;
  reportedProblems: string[];
  reportedRemainingIssues: string[];

  // Added by deterministic application code.
  changedFiles: string[];
  executedCommands: ValidationCommand[];
  deterministicProblems: string[];
  progress:
    | "material_progress"
    | "no_progress"
    | "repeated_state"
    | "completed"
    | "failed";
  stateFingerprint: string;
  tokenUsage?: TokenUsage;
}

interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}
```

The final schema should be implemented using Zod and converted to JSON Schema for the selected provider's structured-output mechanism.

The MVP Codex adapter supports per-turn structured output schemas.

---

# 19. Review Bundle

A Review Bundle is the primary unit of human review.

It contains:

```text
Review Bundle
├── PR reference
├── `prBaseSha`, `prHeadSha`, and `worktreeBaselineSha`
├── review events
├── AI assessments
├── proposed implementation plans
├── per-item human accept/override decisions
├── question answers and user instructions
├── proposed responses
├── local code changes
├── full Git diff
├── validation results
├── turn-by-turn AI Work Reports
├── AI-provider activity summary
└── state
```

The Review Bundle must also retain the resolved isolated worktree path used for that bundle so the application can provide a reliable **Open Worktree** action even if the application-level worktree root changes later.

The Review Bundle must snapshot the PR Intent / Context used for the AI evaluation. Editing the PR's intent later must apply to future work and must not silently change the meaning or reproducibility of an existing bundle.

Possible states include:

```text
WORKING
READY_FOR_REVIEW
NEEDS_ATTENTION
STALE
PUBLISHING
PUBLISHED
PUBLISHED_WITH_ERRORS
DISCARDED
FAILED
```

The complete bundle-level Git diff is authoritative.

Individual review items may identify related files, but the application does not need to reconstruct separate independent patches for each comment in the MVP.

The bundle also records a review stage:

* `PROPOSAL_REVIEW` — the AI has analyzed the feedback but has not been
  permitted to modify the worktree. Every item requires an explicit human
  **Accept recommendation** or **Override recommendation** decision before
  implementation can begin.
* `FINAL_REVIEW` — accepted decisions have been implemented, the actual diff
  and post-change validation are available, and the user is deciding whether
  to publish the complete proposed diff and selected responses.

The PR may remain in `READY_FOR_REVIEW` during either stage; the stage is what
explains whether the user is approving recommendations before implementation or
approving the resulting code before publication. An item with disposition
`question` must expose a textbox for the developer's answer. That answer is
part of the implementation input and must be persisted with the item decision.

---

# 20. Main Application Screen

The home screen should behave like an inbox.

Example:

```text
PRMonitor

NEEDS YOUR REVIEW
─────────────────────────────────────────

SYS-1234 Preferences
Fix duplicate invoice generation

5 comments analyzed
4 fix proposals · 1 pushback
Baseline: 2 checks passing

                              [Review Proposal]

After implementation:

5 decisions implemented
4 fixes · 1 pushback
Post-change validation passing

                              [Review Changes]


WORKING
─────────────────────────────────────────

Checkout #4880
3 comments received

Running checkout tests...


WATCHING
─────────────────────────────────────────

Gateway #4701
No outstanding review feedback

Reporting #4698
Waiting for reviewers
```

The most important distinction is whether the developer currently needs to take action.

The inbox must also provide selection controls for managed PRs. The developer can select individual eligible PRs, clear the selection, or select all managed PRs. The toolbar must show the selected count and provide **Synchronize PR Branch**. Each selected PR must show the effective `syncSourceBranch`, including whether it comes from `syncSourceBranchOverride` or `prBaseBranch`. Selecting all must include an explicit confirmation summary that identifies ineligible PRs rather than silently ignoring them.

Each managed PR card should show any active branch-synchronization status, including waiting, merging, conflict resolution, ready for review, stale, failed, or published. A synchronization status is an operation overlay and must not hide the PR's normal watching or review-bundle state.

---

# 21. Review Bundle Screen

The Review Bundle screen is the core MVP interface.

Suggested layout:

```text
┌─────────────────────────────────────────────────────────────┐
│ SYS-1234 Preferences #4821                                             │
│ Fix duplicate invoice generation                           │
│                                                            │
│ 5 comments addressed        Tests ✓   Lint ✓              │
├──────────────────────┬──────────────────────────────────────┤
│ Review Items         │ Selected Item                        │
│                      │                                      │
│ ✓ Fixed              │ Reviewer comment                     │
│ Null handling        │ ...                                  │
│                      │                                      │
│ ✓ Fixed              │ AI assessment                        │
│ Race condition       │ ...                                  │
│                      │                                      │
│ ↩ Pushback           │ Resolution                           │
│ Rename service       │ FIXED                                │
│                      │                                      │
│ ? Question           │ Proposed reply                       │
│ Cache behavior       │ ...                                  │
│                      │                                      │
│                      │ Related files                         │
│                      │ ...                                  │
│                      │                                      │
│                      │ [View Relevant Diff]                  │
├──────────────────────┴──────────────────────────────────────┤
│ [Conversation] [Full Diff] [Validation]                    │
│                                                             │
│ [Discard]                              [Push Changes]        │
└─────────────────────────────────────────────────────────────┘
```

During `PROPOSAL_REVIEW`, each item must show the original feedback, the AI
assessment, the proposed disposition, the proposed implementation plan, and
explicit controls:

* **Accept recommendation** — preserve the AI's disposition for implementation
  planning;
* **Override recommendation** — choose a different disposition and optionally
  provide instructions explaining the override; and
* a required answer textbox for every `question` disposition.

The implementation phase must not start while any item remains undecided or a
required question answer is empty. An override is a semantic decision, not
publication approval. The implementation phase must use the final per-item
decisions and must not silently implement a rejected recommendation.

During `FINAL_REVIEW`, the screen must show the actual post-change validation,
the complete proposed-worktree diff, editable proposed responses, and the
explicit publication controls. The user approves the complete proposed diff
for publication; the MVP does not offer per-hunk code-patch acceptance.

The two primary states should have an unmistakable but accessible distinction:

* `READY_FOR_REVIEW` uses a calm review-ready treatment and explains what is
  ready for the user to inspect or approve. In `PROPOSAL_REVIEW`, the primary
  action is to decide the recommendations; in `FINAL_REVIEW`, it is to review
  the complete diff and publish or discard it.
* `NEEDS_ATTENTION` uses a persistent warning treatment and displays the
  concrete reason, why it matters, preserved evidence/worktree state, and the
  permitted next actions such as answering a question, fixing validation,
  continuing AI work, re-evaluating, or discarding. It must not look like a
  normal ready-to-publish result.

---

# 22. Diff Viewer

The developer must be able to inspect the complete proposed diff (read-only) before pushing.

The application should provide:

**Relevant Diff**

Shows code likely related to the selected review item.

**Proposed Worktree Diff**

Shows every proposed local change compared with `worktreeBaselineSha`. This is the authoritative diff for the Review Bundle and the diff eligible for publication after the user's explicit approval.

During `PROPOSAL_REVIEW`, this view must clearly state that no implementation
changes have been authorized yet. It may show the clean baseline and relevant
context, but it must not imply that an implementation diff exists.

**PR Context Diff**

Shows the worktree state compared with `prBaseSha`, including the PR's pre-existing changes plus the proposed changes. This is contextual and must not be used to decide which changes to commit.

The Proposed Worktree Diff is authoritative for publication.

The diff viewer should support:

* line numbers;
* syntax highlighting;
* file navigation;
* additions/removals;
* collapsed unchanged sections;
* clear indication of new/deleted files;
* ability to open the corresponding file from the Review Bundle worktree in the operating system's default application;
* ability to reveal the corresponding file in the operating system's default file manager.

A later version may support commenting directly on the proposed diff.

---

# 23. Developer Conversation

The developer must be able to continue interacting with the selected AI provider before publishing.

Example:

```text
AI:
I changed this because GetAccount() can return null for
records created before migration 34.

Developer:
I don't want another null branch here. Check whether the
migration guarantees this instead.
```

Sending a message that requests code or test changes starts another AI-provider turn in the PR's isolated worktree using the configured **Review Revision** profile. A read-only request for clarification or brainstorming uses the configured **Read-only Conversation** profile and must not be given worktree mutation authority.

The selected AI provider may revise code, tests, assessments, and proposed replies.

When the turn finishes, the Review Bundle must be refreshed from actual deterministic Git state rather than assuming the model's description of its modifications is correct. Any worktree-mutating follow-up turn is governed by the General AI Work Policy, produces an AI Work Turn Report, and consumes the active operation's turn budget. A user-directed follow-up is explicit authorization for that turn, but it must not create an unbounded automatic loop.

---

# 24. Validation

The developer may configure repository-specific Build & Validation Instructions
for non-standard repository layouts. Human-readable instructions help the AI
provider understand how the repository is built, but only the structured,
trusted command profile grants execution authority. The selected AI provider
may propose a command, but that proposal remains untrusted until the developer
chooses **Run once** or saves and confirms it through the validation settings.

Validation has two distinct purposes in the review workflow:

* **Baseline validation** runs against the clean PR-head worktree before the
  read-only Review Proposal when an approved baseline command is configured.
  It establishes which failures pre-existed the proposed implementation and
  is supplied to the AI and shown to the user. A baseline failure does not by
  itself prevent the AI from analyzing feedback.
* **Post-change validation** runs after accepted review decisions have been
  implemented and after every worktree-mutating revision. Its real results
  are shown in `FINAL_REVIEW` before the user approves publication. The
  publication path performs the applicable final validation/recheck again
  before side effects when the configured profile requires it.

Command execution itself is deterministic.

For every command capture:

```ts
interface ValidationCommand {
  executable: string;
  arguments: string[];
  workingDirectory: string;
  phase: "baseline" | "post_change" | "both";

  startedAt: string;
  completedAt: string;

  exitCode: number | null;

  stdout: string;
  stderr: string;
}
```

The UI must distinguish:

* passed;
* failed;
* not run;
* interrupted.

The application must never represent a test as passing based solely on an AI provider saying that it passed.

A test passes only when the deterministic command runner observes a successful exit status.

---

# 25. Managed PR Branch Synchronization

Branch synchronization is a user-directed operation. It is not started by ordinary PR polling and it is not an automatic rebase of a stale Review Bundle.

The synchronization terminology must use the GitHub PR identities explicitly:

* `prBaseBranch` — the PR's GitHub base branch, exposed as `base.ref`, in the base repository;
* `prHeadBranch` — the PR's GitHub head branch, exposed as `head.ref`, which is the branch that will receive the merge;
* `syncSourceBranch` — the branch to merge into `prHeadBranch`;
* `syncSourceBranchOverride` — the optional per-PR override for `syncSourceBranch`;
* `prHeadSha` — the exact commit currently at `prHeadBranch`; and
* `syncSourceSha` — the exact commit currently at `syncSourceBranch`; and
* `syncMergeBaseSha` — the exact merge base used to distinguish the source-side and PR-head-side changes.

The fallback `syncSourceBranch` is `prBaseBranch`. Each PR may optionally specify another source branch. The effective source branch is resolved deterministically using this precedence:

1. the PR-level `syncSourceBranchOverride`, when non-empty;
2. the PR's `prBaseBranch` (`base.ref`).

The GitHub API-reported repository `default_branch` may be retained as repository metadata, but it must not silently replace `prBaseBranch` or a configured `syncSourceBranchOverride`. The UI must show the base repository, PR base branch, PR head branch, resolved synchronization source branch, source repository, `syncSourceSha`, and `prHeadSha` before the operation starts. If the resolved source branch or the PR head branch cannot be found or fetched, that PR must be marked ineligible with an actionable error. Fork-based PRs must either be supported with explicit source/base repository identities or be rejected as ineligible; a same-named branch in the wrong repository must never be selected implicitly.

The workflow is:

1. The developer selects one, several, or all managed open PRs in the inbox.
2. The application presents an operation summary, including eligible and ineligible PRs, and obtains confirmation.
   This confirmation authorizes preparation only; it does not authorize publication. Each synchronization result requires its own explicit **Publish Merge** approval. A future batch-publish action, if added, must still persist a separate approval and publication outcome for every PR.
3. For each eligible PR, deterministic code resolves `syncSourceBranch` from the PR-level override or `prBaseBranch`, fetches the source and PR head refs, and records the branch names, repositories, and exact SHAs.
4. The application creates a separate synchronization worktree based on `prHeadSha`. It must not reset or reuse a Review Bundle worktree.
5. Git attempts to merge `syncSourceBranch` into `prHeadBranch`.
   The application must use an explicit no-commit merge workflow so that the merge result can be inspected and validated before the deterministic application creates the merge commit. An already-up-to-date or already-contained source branch must produce a distinct no-op result rather than an empty duplicate merge commit.
6. If Git reports no conflicts, the operation proceeds directly to deterministic diff inspection and validation; this path consumes zero AI-provider tokens.
7. If Git reports conflicts, the application records the conflicted paths and starts a bounded AI Work Operation in that synchronization worktree under the General AI Work Policy.
8. Each AI-provider turn may inspect the repository and edit files needed to resolve the conflicts, but it must not push, post GitHub comments, resolve GitHub conversations, approve, or merge the PR. After every turn, deterministic code inspects the actual worktree, records an AI Work Turn Report, evaluates progress, and decides whether the operation is complete, should continue within its budget, or needs human attention.
9. The application verifies that Git reports no unmerged paths, that conflict markers are not left in the intended result, and that validation commands have real recorded exit statuses. A model claim that the conflict is resolved is never sufficient.
10. The application persists an independently reviewable synchronization result for each PR and notifies the developer when human attention is required.

Before the first conflict-resolution turn, deterministic code must preserve the exact `syncMergeBaseSha`, source-side change set, PR-head-side change set, commit/message metadata, conflicted paths and hunks, repository state, and any available PR Intent / Context or source-branch intent context. The selected AI provider must receive the resolved `syncSourceBranch` and `prHeadBranch` identities, their repositories, `syncSourceSha`, `prHeadSha`, and `syncMergeBaseSha`. The conflict resolver must use the configured **Merge Conflict Resolution** profile.

Conflict resolution is intent-sensitive. The AI must inspect and explain the intent represented by both the source-side changes and the PR-head-side changes, preserve behavior from both where they are compatible, and avoid treating either side as disposable. It must not blindly choose `ours`, `theirs`, or a textual hunk winner, and it must not redesign unrelated code. Unrelated changes in the synchronization worktree must be surfaced for review rather than silently accepted. When the available code, history, or intent context does not establish a safe semantic resolution, the AI must return a structured ambiguity result instead of guessing.

An ambiguous conflict is a user-consultation outcome, not a successful merge. The synchronization result must enter `NEEDS_ATTENTION` with a reason such as `MERGE_CONFLICT_AMBIGUOUS` or `USER_DECISION_REQUIRED`, identify the conflicting paths/hunks, summarize the competing intents and the available resolution options, and tell the developer what input is needed. The user must be able to inspect the preserved worktree, answer the question or choose an explicit resolution direction, edit the worktree manually, retry the bounded resolver, or discard the result. No ambiguous result may become `READY_TO_PUBLISH` or be published until the user-directed path produces a newly inspected and validated merge.

Each conflict-resolution turn must report the problem it encountered, the approach it took, and the issues that remain. The application must add deterministic evidence showing the files changed, commands executed, validation results, actual unresolved paths, progress classification, and stop/continue decision. The synchronization result must present this turn-by-turn report before enabling **Retry Resolution**.

The application must continue processing other selected PRs when one PR fails, is skipped, or needs human attention. Each result must show at least:

* `SKIPPED` - the PR was not eligible or was excluded during confirmation;
* `MERGING` - Git is performing the deterministic merge;
* `RESOLVING_CONFLICTS` - the configured AI provider is working in the isolated synchronization worktree;
* `READY_TO_PUBLISH` - the merge result passed deterministic checks and awaits approval;
* `NEEDS_ATTENTION` - the configured AI provider could not produce a valid resolution, the AI Work Policy stopped the operation, validation failed, or the resolver reported an ambiguous semantic conflict requiring user input;
* `STALE` - `syncSourceSha` or `prHeadSha` changed before publication;
* `PUBLISHING`, `PUBLISHED`, `DISCARDED`, or `FAILED`.

Status labels are not sufficient on their own. For every result in a state that may require human action, including `SKIPPED`, `READY_TO_PUBLISH`, `NEEDS_ATTENTION`, `STALE`, and `FAILED`, the application must display a concise, plain-language explanation next to the status. The explanation must be generated from persisted deterministic reason data rather than inferred from the label or supplied only by the AI provider, and must identify:

* what happened;
* why the result cannot proceed or why the user should care; and
* what the user can do next.

At minimum, the application should explain these outcomes as follows:

* `SKIPPED` - identify whether the PR was ineligible, why it was ineligible, or whether it was excluded during confirmation;
* `READY_TO_PUBLISH` - explain that the merge was prepared and deterministic checks passed, then direct the user to review the result and choose **Publish Merge** or **Discard**;
* `NEEDS_ATTENTION` - identify the concrete stop reason, unresolved paths or failed validations when applicable, and offer the relevant next actions such as **Retry Resolution**, manual worktree editing, **Re-evaluate**, or **Discard**;
* `STALE` - identify whether `prHeadSha` or `syncSourceSha` moved, explain that the reviewed merge can no longer be pushed safely, and offer **Re-evaluate** or **Discard**;
* `FAILED` - identify the operation stage and error, distinguish a retryable failure from one requiring user intervention, and direct the user to the applicable next action.

The synchronization result must include the PR reference, `prHeadBranch` and `prHeadSha`, resolved `syncSourceBranch` and `syncSourceSha`, `syncMergeBaseSha`, their repositories, source-side and PR-head-side change evidence, merge outcome, conflicted paths, the complete turn-by-turn AI Work Report when an AI provider was used, AI activity summary, validation results, complete local diff or merge diff summary, resolved worktree path, current operation state, and any machine-readable AI Work Policy stop reason. It is distinct from a Review Bundle so that a branch update does not erase review-feedback history.

When the AI Work Policy stops conflict resolution, the user must be able to inspect the preserved worktree and choose **Retry Resolution**, edit the worktree manually, or discard the result. **Retry Resolution** requires explicit confirmation after showing the prior approaches, encountered problems, remaining issues, turn count, and token usage. It starts another bounded AI Work Operation segment and must not silently reset the prior operation's history.

Publishing a synchronization result requires an explicit **Publish Merge** action. Before pushing, deterministic code must fetch again and verify that:

* the PR is still open;
* the current commit at `prHeadBranch` still equals the recorded `prHeadSha`;
* the current commit at `syncSourceBranch` still equals the recorded `syncSourceSha`;
* the synchronization worktree contains only the intended merge result; and
* no force push is required.

If any check fails, the result becomes `STALE` or `NEEDS_ATTENTION` and cannot be pushed until the user re-evaluates it. A batch publish must preserve per-PR isolation: one rejected or failed push must not roll back or obscure successful results for other PRs.

The operation must be resumable across UI closure and application restart. Retries must reuse or explicitly supersede the persisted operation rather than creating duplicate merge commits or duplicate publication attempts. Resuming must preserve the accumulated AI Work Turn Reports and consumed turn budget; only an explicit human **Retry Resolution** action may authorize another bounded segment.

---

# 26. Publishing

The AI does not publish.

When the developer chooses **Push Changes**, deterministic application logic takes control.

Before publishing:

1. fetch the remote;
2. retrieve current `prHeadSha` at `prHeadBranch`;
3. compare it with the Review Bundle's recorded `prHeadSha` or the Branch Synchronization result's recorded `prHeadSha`;
4. verify the local worktree and the `worktreeBaselineSha`;
5. verify the exact proposed diff to be published;
6. acquire the persisted publication lock and create the publication intent before the first side effect.

If the remote PR head has changed since the bundle was prepared, publishing must stop.

The UI should say approximately:

```text
This PR changed after these changes were prepared.

3 new commits were pushed.

The proposed changes need to be re-evaluated against the
current branch before they can be published.

[Re-evaluate]
```

PRMonitor should not automatically merge or rebase stale Review Bundles.

For a Branch Synchronization result, publishing must also retrieve the current SHA of the resolved synchronization source branch and compare it with the recorded source SHA. A source-branch movement is stale work just like a PR-head movement. The application must not silently refresh the source and push a different merge than the one the developer reviewed.

Publication is a persisted state machine rather than one database transaction spanning Git and GitHub. Before performing an external side effect, deterministic code must persist the intended publication phase and an idempotency key. At minimum, publication must distinguish:

* `PENDING` — approved but no commit or response side effect started;
* `COMMIT_CREATED` — the exact local commit and proposed diff were recorded;
* `NO_CODE_CHANGE` — the approved proposed diff was empty and no commit is required;
* `PUSHED` — the remote commit SHA was verified;
* `RESPONSES_PENDING` — the commit is remote but one or more approved responses remain;
* `COMPLETED` — all approved side effects were reconciled; and
* `FAILED` or `UNKNOWN` — the outcome requires deterministic recovery before retrying.

If a process exits or a network failure occurs after an external operation may have succeeded, the application must re-fetch and inspect the remote state before retrying. It must never create or push another commit solely because the local record still says `PENDING`. Each approved GitHub response must have its own persisted pending/posted/failed state and resulting remote ID when available, so a retry cannot post an already successful response twice. If code publication (when applicable) succeeds but one or more approved responses cannot be reconciled, the Review Bundle becomes `PUBLISHED_WITH_ERRORS`; the user may retry the responses without republishing code.

---

# 27. Commit and Push

If the remote head is unchanged:

1. stage only the approved proposed diff relative to `worktreeBaselineSha`; if that diff is empty, record a response-only publication and do not create an empty commit;
2. if the proposed diff is non-empty, create the commit and push it to the existing `prHeadBranch` without force;
3. verify and record the resulting remote commit SHA, or record that no code commit was necessary;
4. post only approved GitHub responses whose publication state is still pending, recording each remote ID and outcome;
5. mark the Review Bundle `PUBLISHED` only after all approved side effects are reconciled, or `PUBLISHED_WITH_ERRORS` when code publication or response publication still needs attention;
6. return the PR to Watching only after the publication state is durably recorded.

No force push is allowed.

The developer should be able to edit the generated commit message before publishing if desired, but the application should provide a pre-filled commit message in the commit message box.

For an approved Branch Synchronization result:

1. verify the recorded merge result (including its merge commit when Git created one) and exact merge diff;
2. push the merge result to the existing `prHeadBranch` without force;
3. record the resulting remote commit SHA and publication outcome;
4. mark the synchronization result `PUBLISHED`;
5. mark any Review Bundle prepared against the previous PR head as stale without deleting it.

No GitHub response is implied by a branch synchronization, and no response should be posted unless the user separately approves one through the Review Bundle workflow.

---

# 28. GitHub Responses

Proposed responses should be visible and editable before publishing.

Response inclusion is a separate decision from code-diff approval. The
publication model already tracks each response independently for retry and
uncertain-outcome recovery, but the MVP requirements do not yet choose between
these two user experiences:

1. approve the complete set of edited responses together; or
2. show an **Include response** control for each response so the user can
   publish code while intentionally omitting a particular reply.

The second option is recommended because it lets a developer decline to speak
on a specific thread without turning response selection into partial code-patch
acceptance. An omitted response would remain in the Review Bundle history but
would have no publication intent. This choice needs explicit product
confirmation before F23 publication UX is finalized.

Example fixed response:

```text
Good catch. This path can receive a null account for records
created before version 1.5. I've added handling for that case
and coverage for it.
```

Example pushback:

```text
I kept this behavior as-is because retry policy is owned by
InvoiceProcessor. Moving it into this provider would duplicate
the retry behavior used by the other provider implementations.
```

The application posts selected responses only after explicit human approval.

---

# 29. Stale Work Handling

Remote changes invalidate assumptions.

A Review Bundle becomes stale when deterministic software detects that the current remote head SHA no longer matches the SHA against which the bundle was prepared.

A stale bundle cannot be published.

A Branch Synchronization result becomes stale when either its recorded `prHeadSha` or its recorded `syncSourceSha` no longer matches the current remote value. It cannot be published until the user chooses **Re-evaluate**, which performs a new merge attempt from the current source and PR-head states, or **Discard**.

The user may choose **Re-evaluate**.

Re-evaluation should:

1. ask how to handle any dirty worktree using **Clear All Changes**, **Clear Only AI Changes**, or **Keep Worktree and Cancel**;
2. update or create the worktree at the current PR head only after the user's choice is safely applied;
3. provide the selected AI provider with the original review feedback and new repository state, using the current **Automatic Review / Re-evaluation** profile;
4. create an updated Review Bundle with new `prBaseSha`, `prHeadSha`, and `worktreeBaselineSha` snapshots.

---

# 30. Persistence

Use SQLite for local application state.

Suggested conceptual entities:

```text
Settings
  - worktree root directory
  - maximum AI work turns per operation
  - hard AI work-turn maximum enforced by the application
  - default AI Execution Policy and available policy presets
  - AI Task Profiles, one for each supported AI task type
    - provider identifier
    - model identifier
    - provider-supported reasoning effort
    - provider-specific options
    - profile revision

GitHubServer
Repository
  - API-reported default branch (informational metadata only; not the synchronization source)
PullRequest
  - PR intent / context
  - optional `syncSourceBranchOverride`
  - `prBaseBranch` (`base.ref`)
  - `prHeadBranch` (`head.ref`)
  - base and head repository identities

RemoteReviewEvent
ObservedRemoteVersion
  - immutable event body, state, location, content hash, and version key

ReviewBatch
ReviewBundle
  - `prBaseSha`
  - `prHeadSha`
  - `worktreeBaselineSha`
  - proposed-worktree diff and PR-context diff metadata
  - handled remote event-version IDs
ReviewBundleItem
  - immutable remote event-version ID and remote object ID

AIWorkOperation
  - operation scope and parent operation, when continued by a human
  - task type, provider, model, provider-supported reasoning effort, provider-specific options, and profile revision snapshot
  - effective AI Execution Policy snapshot, including sandbox, approval, network, writable-root, and controlled-environment settings
  - configured turn budget and consumed turn count
  - current state and machine-readable stop reason
AIWorkTurn
  - AI Work Turn Report
  - effective task type, provider, model, provider-supported reasoning effort, profile revision, and execution-policy reference
  - opaque provider conversation reference and usage metadata when available
  - deterministic state fingerprint and progress classification

BranchSyncBatch
BranchSyncOperation
  - `syncSourceBranch`, source repository, and `syncSourceSha`
  - `prHeadBranch`, destination repository, and `prHeadSha`
  - associated AIWorkOperation, when an AI provider was used
BranchSyncConflict

CommonInstructionProfile

AIProviderConversation
AIProviderTurn
  - provider, task type, model, provider-supported reasoning effort, and profile revision used for the turn

ValidationRun
ValidationCommand

Publication
  - idempotency key, phase, commit SHA, and recovery status
  - per-response publication state and resulting remote IDs

ActivityEvent
```

The application must survive:

* UI window destruction;
* system sleep;
* application restart;
* network interruption.

Where possible, operations should be idempotent.

---

# 31. Security

GitHub API credentials must be owned by deterministic application infrastructure and must not be placed in AI prompts or exposed unnecessarily to the AI provider. The AI provider should not require the application's GitHub API token to modify the isolated local repository.

For the MVP, the rule that an AI provider must not publish is enforced through application architecture, deterministic publication services, controlled provider credentials, and the selected AI Execution Policy. Worktree-mutating operations should use the operation-owned sandbox boundary and `approval_policy = "never"` by default so permitted local work can proceed unattended. This is defense in depth, not publication authority: the MVP does not claim an absolute OS-level or network-level guarantee that a provider process could never attempt a direct Git or GitHub operation if the user's local Git tooling makes that possible. The provider still must not receive GitHub publication credentials, and all supported publication actions must go through deterministic application code.

Environment variables passed to the AI provider should still be explicitly controlled, and the provider should receive only the credentials needed for its configured provider interaction. GitHub API credentials and other secrets must remain outside prompts and structured AI output.

The MVP Codex SDK supports supplying a controlled environment instead of automatically inheriting all parent-process environment variables. Future provider adapters must provide an equivalent controlled execution boundary or fail with an actionable capability error.

Secrets must not be stored in plaintext SQLite fields when platform credential storage is available.

Use the operating system's appropriate secure credential mechanism.

---

# 32. Application States

At the PR level, keep the primary review state model intentionally small:

```text
WATCHING
WORKING
READY_FOR_REVIEW
NEEDS_ATTENTION
```

At the Review Bundle level, additional implementation states may exist. Only one automatic Review Bundle and one automatic review AI Work Operation may be active for a PR at a time. Remote event versions observed while that operation is active are persisted, but they are not silently added to the active operation or used to start a concurrent worktree mutation.

The active Review Bundle also records a review stage: `PROPOSAL_REVIEW` or
`FINAL_REVIEW`. A proposal-stage bundle contains read-only AI assessments and
awaits an explicit human decision for every item. A final-review bundle
contains the implementation diff and post-change validation. The stage is a
durable substate and does not expand the primary PR state set.

Branch synchronization has its own operation state and status overlay. It must not expand the PR's primary state into a second competing state machine: a PR can remain `READY_FOR_REVIEW` or `NEEDS_ATTENTION` while a separate synchronization result is `RESOLVING_CONFLICTS`, for example. Global `PAUSED` is an application-level monitoring flag; the inbox may display it as a derived overlay, but it is not a second per-PR workflow that competes with the review state.

Avoid building an unnecessarily elaborate state machine in the MVP.

`READY_FOR_REVIEW` and `NEEDS_ATTENTION` have an important operational meaning: each is an automatic per-PR review hold. While a Review Bundle is ready for human review or requires attention, the PR must not receive another automatic analysis job or have its AI worktree refreshed, reset, or otherwise mutated by background processing. This hold is separate from the user-controlled global `PAUSED` state.

The primary review-state transitions are:

| Current state | Deterministic or explicit trigger | Next state |
| --- | --- | --- |
| `WATCHING` | An eligible quiet-period batch is dispatched | `WORKING` |
| `WATCHING` | No actionable semantic event remains | `WATCHING` |
| `WORKING` | The operation-specific completion predicate succeeds and a bundle is reviewable | `READY_FOR_REVIEW` |
| `WORKING` | Policy stop, provider failure, timeout, unresolved validation, or another blocking condition | `NEEDS_ATTENTION` |
| `READY_FOR_REVIEW` with `PROPOSAL_REVIEW` stage | Every item has an explicit accept/override decision and required question answers are present | `WORKING` |
| `READY_FOR_REVIEW` or `NEEDS_ATTENTION` | Explicit **Continue AI Work**, **Retry Resolution**, or **Re-evaluate** | `WORKING` |
| `READY_FOR_REVIEW` or `NEEDS_ATTENTION` | Successful publication or explicit discard, after worktree handling is resolved | `WATCHING` |

New remote event versions do not change the state or release a hold by themselves. A user-directed revision may temporarily use `WORKING` and must return to `READY_FOR_REVIEW` or `NEEDS_ATTENTION` after deterministic inspection. A global pause is displayed as an overlay while preserving the underlying primary review state.

---

# 33. Pause Behavior

The developer must be able to pause:

* all watching;
* optionally, an individual PR in a later version.

While globally paused:

* no new automatic AI jobs start;
* existing ready bundles and `NEEDS_ATTENTION` results remain available;
* GitHub publishing still requires user action;
* manual **Check Now** may remain available.

An explicitly user-started Branch Synchronization is not an automatic review job. If that synchronization encounters conflicts, its requested AI-provider resolution may continue while global watching is paused; pausing must not cancel or silently discard the operation.

While an individual PR is in `READY_FOR_REVIEW` or `NEEDS_ATTENTION`:

* no new automatic AI job starts for that PR;
* no new review batch is created for that PR;
* background processing must not fetch, reset, replace, or otherwise mutate the bundle's isolated worktree;
* lightweight read-only polling may continue so the application can detect a changed PR head, newly arrived feedback, or a closed/merged PR;
* newly detected event versions are persisted for later processing but are not added to the current Review Bundle;
* the hold persists when the UI window is closed, the user navigates elsewhere, or the PR is not selected.

While a PR is `WORKING`, lightweight polling may continue, but newly detected event versions are persisted separately and do not start another automatic operation or mutate the active worktree. They become eligible for a later batch after the current operation reaches an explicit outcome and any applicable hold is released.

For `NEEDS_ATTENTION`, the only actions that may start more AI work are explicit user actions such as answering a required question, **Continue AI Work**, **Retry Resolution**, or **Re-evaluate**. These actions must show the preserved worktree, prior turn reports, remaining issues, and accumulated usage before confirmation.

The per-PR review hold is released only after an explicit outcome:

* successful **Push Changes** marks the Review Bundle `PUBLISHED` and returns the PR to `WATCHING`;
* **Push Changes** that completes code publication, or requires no code publication, but leaves approved responses unreconciled marks the Review Bundle `PUBLISHED_WITH_ERRORS` and returns the PR to `WATCHING`; code must not be republished while the user resolves the response failures;
* **Discard** marks the Review Bundle `DISCARDED` after the user chooses how to handle dirty worktree changes, then returns the PR to `WATCHING`;
* **Re-evaluate** keeps the PR held while the current bundle is archived or replaced and a new bundle is prepared against the current remote state;
* a stale or otherwise invalid bundle remains held until the user chooses **Re-evaluate** or **Discard**.

Publishing or discarding a bundle must not erase the historical review event versions it handled. Each event version remains recorded as handled by that bundle so that resuming monitoring cannot cause the same feedback version to be analyzed repeatedly. New event versions observed during the hold remain distinct and become eligible for a later batch after the hold is released.

The tray icon should clearly indicate the paused state.

---

# 34. AI Usage Visibility

Because minimizing token use is a product goal, the application should make AI activity observable.

For each Review Bundle, record:

* number of AI-provider turns;
* provider usage metadata and token usage when provided by the provider;
* start/end times;
* the task type, provider, model, provider-supported reasoning effort, and profile revision for each turn;
* the complete AI Work Turn Reports, including reported approaches, encountered problems, remaining issues, and deterministic progress decisions.

For each Branch Synchronization operation, record the same AI-provider usage fields when conflict resolution required AI, including the **Merge Conflict Resolution** provider, model, and provider-supported reasoning effort, plus whether the merge completed without AI, the configured and consumed AI Work turn budget, and any AI Work Policy stop reason.

A later dashboard may summarize:

```text
For the inclusive dates 8/1/2026 to 8/2/2026

42 deterministic PR checks
38 required no AI

4 AI jobs
9 AI turns

12 monitored PR records
7 unique PRs monitored
3 PRs successfully pushed
```

The dashboard should also report pull-request throughput for the selected time
period:

* **Monitored PR records** — the total number of pull-request monitoring
  records in the period, including repeated records for the same PR.
* **Unique PRs monitored** — the number of distinct pull requests with at
  least one monitoring record in the period.
* **PRs successfully pushed** — the number of distinct pull requests for
  which the user-approved **Push Changes** operation completed successfully in
  the period. Push attempts that failed or were cancelled must not count.

The point of this metric is not gamification. It is to verify that the architecture is actually honoring the deterministic-first principle, as well as to help the user track the number of tickets they've completed, so that management has a metric to use.

---

# 35. Activity Log

Maintain a lightweight deterministic activity log.

When a user-facing record includes an external work-item reference, prefer
Jira-style keys in the form `<PROJECT_KEY>-<ISSUE_NUMBER>` (for example,
`PRMON-4821`) for the current team's workflow. This is
only a display and linking convention: persisted identities and service
contracts must remain provider-neutral so GitHub-native references such as
`#4821` or `owner/repo#4821` remain supported when Jira is not used.

Example:

```text
10:02:30 Checked PRMON-4821 — no changes
10:03:00 Checked PRMON-4821 — 304 Not Modified
10:05:17 Detected review 99182
10:05:17 Waiting for review batch quiet period
10:05:38 Created batch RB-17 with 4 comments
10:05:39 Started AI-provider turn
10:07:12 AI-provider turn completed
10:07:13 Running npm test -- InvoiceService
10:07:28 Validation passed
10:07:29 Review Bundle ready
10:07:29 Notification displayed
```

The activity log will be especially useful for debugging polling and automation behavior.

---

# 36. MVP Non-Goals

The following are deliberately outside the MVP:

* centralized server;
* multi-user operation;
* web application;
* GitHub webhook receiver;
* GitHub App installation;
* fully autonomous publishing;
* autonomous merging;
* automatic branch synchronization without explicit user selection and approval;
* automatic approval of PRs;
* automatic CI repair after publishing;
* mandatory JIRA integration;
* mandatory requirements dossier;
* deterministic semantic scope-enforcement system beyond applying user-provided Common Instructions as AI-provider context;
* per-hunk or silent reconstruction of individual code patches (per-item
  semantic accept/override decisions are part of the revised review flow, but
  publication still approves one complete proposed diff);
* force pushing;
* automatic rebasing of stale bundles;
* team dashboards;
* browser-based remote access.

These features may be reconsidered after real-world MVP use.

---

# 37. Future Enhancements

Possible future additions include:

* GitHub webhooks as an alternative event source;
* a GitHub Copilot-backed AI provider adapter;
* an AWS Bedrock-backed AI provider adapter;
* JIRA or Git Issues context retrieved automatically from ticket IDs;
* reading repository specification files automatically;
* CI status monitoring after push;
* CI failure investigation;
* optional independent AI-provider verification pass;
* partial code-diff acceptance;
* GitHub review-thread resolution;
* GitHub App authentication;
* multi-machine synchronization;
* plugin architecture for additional source-control systems;
* macOS and Linux packages.

The architecture should avoid unnecessarily preventing these features but should not implement them prematurely.

---

# 38. Technical Stack

Preferred MVP stack:

```text
Electron
TypeScript
React
Node.js
AI provider SDK (MVP: `@openai/codex-sdk`)
SQLite
Zod
Git CLI
GitHub Enterprise REST API
```

For the MVP, the Codex SDK wraps the Codex CLI and exposes streaming events suitable for showing ongoing agent activity in the desktop UI. Only the MVP Codex provider adapter should depend directly on `@openai/codex-sdk`; the rest of the application should depend on the provider-neutral AI contracts. The dependency must be pinned to a tested version compatible with the Electron/Node runtime and recorded in the lockfile.

The MVP selects the direct TypeScript SDK adapter for unattended, isolated-worktree work. Codex App Server is not an MVP dependency. It remains the planned integration path if a future execution-policy preset needs live in-application approval requests, provider-managed authentication, or provider-native conversation/event control that the direct SDK adapter cannot expose. The direct adapter must reject or mark unsupported any policy requiring interactive approval callbacks rather than silently falling back to another permission mode.

Use direct Git subprocesses or a very thin Git abstraction rather than introducing a large Git framework unless implementation experience demonstrates the need.

---

# 39. Architectural Boundaries

Use explicit service boundaries approximately like:

```ts
interface PrWatcher {}

interface GitHubEnterpriseClient {}

interface ReviewEventStore {}

interface ReviewBatcher {}

interface WorktreeManager {}

interface BranchSyncService {}

interface MergeConflictResolver {}

interface AIProvider {}

interface AIProviderRegistry {}

interface CodexProviderAdapter extends AIProvider {}

interface AIExecutionPolicyResolver {}

interface AIReviewService {}

interface AITaskProfileResolver {}

interface AIWorkController {}

interface AIProgressEvaluator {}

interface ValidationRunner {}

interface ReviewBundleService {}

interface PublicationService {}

interface NotificationService {}

interface TrayService {}
```

The `PrWatcher` must not depend on any AI provider.

The `GitHubEnterpriseClient` must not depend on any AI provider.

The `WorktreeManager` must not depend on any AI provider.

`BranchSyncService` must use deterministic Git operations for branch discovery, fetching, merging, conflict detection, SHA verification, and publication. It may delegate only semantic conflict resolution to `MergeConflictResolver`.

`MergeConflictResolver` must operate only in the operation-owned isolated worktree and must not have publication authority.

`AIWorkController` owns the bounded-turn policy, persisted AI Work Operations, human-authorized continuation segments, turn timeouts, and stop reasons. It must not infer completion from model prose.

`AIProvider` is the only boundary through which application services invoke an AI provider. It must return normalized turn events and structured results, expose its capabilities, and have no publication authority. `AIProviderRegistry` resolves the selected provider adapter; the MVP registry contains the OpenAI Codex adapter, while future adapters may be added without changing the surrounding workflows.

`AITaskProfileResolver` owns the supported task-type mapping, validates provider/model/reasoning-effort combinations, and creates the immutable profile snapshot supplied to each AI invocation. Every AI-capable service must identify its task type and use this resolver; it must not bypass the resolver with ad hoc provider, model, or reasoning settings.

`AIExecutionPolicyResolver` owns the application-level execution-policy presets, applies task-type safety floors such as read-only conversation, creates the immutable policy snapshot for each AI Work Operation segment, and translates that snapshot into provider-specific sandbox, approval, network, writable-root, and environment settings. It must not permit an AI provider or model response to broaden the policy.

`AIProgressEvaluator` must use deterministic worktree, Git, and validation evidence to produce state fingerprints and progress classifications. Operation-specific services may provide stronger completion and progress predicates, but no service may bypass the generic budget or repeated-state safeguards.

The `ValidationRunner` must not trust an AI provider's claims about command success.

`AIReviewService` should receive prepared inputs and the resolved **Automatic Review / Re-evaluation** profile snapshot, then delegate to the selected `AIProvider` and return structured semantic results. The same profile-resolution boundary must be used by review revisions, read-only conversations, and merge-conflict resolution.

This separation is an explicit product requirement, not merely an implementation preference.

---

# 40. Deterministic / AI Boundary Example

The expected control flow is:

```text
10-minute timer
      │
      ▼
GET GitHub state ───────────────────────── deterministic
      │
      ▼
304?
 │
 ├── yes ──> done                              0 AI tokens
 │
 └── no
      │
      ▼
retrieve changed review objects ─────────── deterministic
      │
      ▼
deduplicate / filter / persist ───────────── deterministic
      │
      ▼
anything requiring semantic analysis?
 │
 ├── no ──> done                              0 AI tokens
 │
 └── yes
      │
      ▼
batch quiet period ───────────────────────── deterministic
      │
      ▼
prepare isolated worktree ───────────────── deterministic
      │
      ▼
AI provider proposes (read-only) ────────── AI
      │
      ▼
inspect actual Git diff ─────────────────── deterministic
      │
      ▼
run commands / capture results ──────────── deterministic
      │
      ▼
persist Review Bundle ───────────────────── deterministic
      │
      ▼
notify developer ────────────────────────── deterministic
      │
      ▼
human reviews
      │
      ▼
verify remote SHA ───────────────────────── deterministic
      │
      ▼
commit / push / comment ─────────────────── deterministic
```

This model should be preserved throughout implementation. For review work, the
review-specific sequence is refined as follows and takes precedence over any
older shorthand that combines proposal and implementation:

```text
prepare isolated worktree
        |
        v
baseline validation, when configured
        |
        v
read-only AI Review Proposal
        |
        v
persist proposal bundle and notify
        |
        v
human accepts/overrides every item
        |
        v
AI implements accepted decisions in worktree
        |
        v
inspect diff -> post-change validation
        |
        v
persist final bundle and notify
        |
        v
human reviews complete diff/responses
        |
        v
verify remote SHA -> commit/push/post selected responses
```

The `AI investigates/fixes` step is always mediated by `AIWorkController`. If the surrounding workflow invokes the selected AI provider again, the controller records a new AI Work Turn Report, evaluates deterministic progress, and enforces the operation budget before allowing the next turn. This applies equally to review work, developer-requested revisions that modify the worktree, and branch synchronization.

The branch synchronization path follows the same boundary:

```text
      |
      v
resolve `syncSourceBranch` + current `syncSourceSha`/`prHeadSha` ------- deterministic
      |
      v
create one isolated sync worktree per PR -------------------------- deterministic
      |
      v
attempt Git merge -------------------------------------------------- deterministic
      |
      +--> no conflicts --> inspect merge + run validation --------- deterministic
      |
      +--> conflicts
                |
                v
        AI provider resolves semantic conflicts in worktree ---------- AI
                |
                v
        verify no unmerged paths + inspect diff + run validation ---- deterministic
      |
      v
persist result and notify ------------------------------------------ deterministic
      |
      v
human approves
      |
      v
re-fetch `syncSourceBranch` and `prHeadBranch`, verify both SHAs, push without force ---- deterministic
```

---

# 41. MVP Acceptance Criteria

The MVP is considered successful when all of the following work reliably:

1. **APP-AC-01:** User can configure access to a GitHub Enterprise Server.
2. **APP-AC-02:** User can add a pull request by URL.
3. **APP-AC-03:** Application can watch multiple PRs.
4. **APP-AC-04:** Polling occurs while no UI window is open.
5. **APP-AC-05:** Polling consumes no AI-provider/API-model tokens.
6. **APP-AC-06:** Unchanged PRs do not invoke an AI provider.
7. **APP-AC-07:** Duplicate events do not invoke an AI provider twice.
8. **APP-AC-08:** New review feedback is detected deterministically.
9. **APP-AC-09:** Multiple comments arriving together can be batched.
10. **APP-AC-10:** An isolated Git worktree is created for AI modifications.
11. **APP-AC-11:** The MVP Codex provider can inspect the repository and make local changes through the provider boundary.
12. **APP-AC-12:** The selected AI provider returns structured assessments for review items through the normalized result contract.
13. **APP-AC-13:** Tests can be run and their real exit status recorded.
14. **APP-AC-14:** A Review Bundle is persisted.
15. **APP-AC-15:** A native notification is produced when human attention is useful.
16. **APP-AC-16:** A PR with a `READY_FOR_REVIEW` bundle or `NEEDS_ATTENTION` result automatically stops new analysis and worktree mutation for that PR until an explicit user action such as publish, discard, re-evaluate, continue, or retry.
17. **APP-AC-17:** Closing the visible UI does not stop watchers or AI jobs, and does not release a per-PR review hold.
18. **APP-AC-18:** Clicking a notification opens directly to its Review Bundle.
19. **APP-AC-19:** Opening from the tray recreates the UI window.
20. **APP-AC-20:** The application behaves acceptably across Windows virtual desktops.
21. **APP-AC-21:** User can inspect the complete Git diff.
22. **APP-AC-22:** User can continue conversing with the selected AI provider before publishing.
23. **APP-AC-23:** User can discard the pending changes.
24. **APP-AC-24:** Review event versions handled by a published or discarded bundle remain durably recorded as handled and are not analyzed again.
25. **APP-AC-25:** New feedback detected during a review hold is retained and becomes eligible for a later batch after the hold is released.
26. **APP-AC-26:** Remote branch movement prevents stale work from being pushed.
27. **APP-AC-27:** User can explicitly approve a bundle for publication.
28. **APP-AC-28:** Approved changes can be committed and pushed.
29. **APP-AC-29:** Approved GitHub responses can be posted.
30. **APP-AC-30:** Closing the UI does not shut down the application.
31. **APP-AC-31:** **Shutdown PRMonitor** terminates the background application.
32. **APP-AC-32:** User can create, edit, enable, disable, and select reusable Common Instruction profiles in application settings.
33. **APP-AC-33:** Applicable Common Instructions are included in new AI-provider turns, follow-up turns, and re-evaluations.
34. **APP-AC-34:** Common Instructions are stored as application settings rather than as mutable PR or ticket configuration.
35. **APP-AC-35:** A Review Bundle records the effective Common Instructions and profile version used to prepare it.
36. **APP-AC-36:** Editing a Common Instruction profile does not silently change the meaning or reproducibility of an existing Review Bundle.
37. **APP-AC-37:** The user can configure the application-level root directory for isolated worktrees.
38. **APP-AC-38:** Notifications and the Review Bundle screen provide a clickable action that opens the associated isolated worktree in the platform's default file manager.
39. **APP-AC-39:** Manual edits, builds, and tests in the isolated worktree are preserved and reflected in deterministic diff and validation checks; discarding or re-evaluating dirty work prompts for **Clear All Changes**, **Clear Only AI Changes**, or **Keep Worktree and Cancel**.
40. **APP-AC-40:** The user can provide optional multi-line PR Intent / Context when adding a PR and edit it later.
41. **APP-AC-41:** PR Intent / Context is included in relevant AI evaluations and snapshotted with the Review Bundle used to evaluate it.
42. **APP-AC-42:** Editing PR Intent / Context does not silently change the meaning or reproducibility of an existing Review Bundle.
43. **APP-AC-43:** The inbox shows all managed PRs and allows the user to select individual PRs, clear the selection, or select all managed PRs for branch synchronization.
44. **APP-AC-44:** Branch synchronization defaults to each PR's `prBaseBranch` (`base.ref`) and merges into `prHeadBranch` (`head.ref`); an optional `syncSourceBranchOverride` may select another source branch. The GitHub API-reported repository default branch must not silently override `prBaseBranch` or the configured override.
45. **APP-AC-45:** The user sees eligible and ineligible PRs, `syncSourceSha`, `prHeadSha`, and a confirmation summary before a synchronization batch starts.
46. **APP-AC-46:** Each selected PR is processed in an independent synchronization worktree, and one PR's failure or conflict does not prevent other selected PRs from reaching their own result.
47. **APP-AC-47:** A clean Git merge completes without invoking an AI provider and consumes zero AI tokens.
48. **APP-AC-48:** A conflicting merge can be resolved by the configured AI provider only in its isolated worktree, and deterministic checks verify no unmerged paths remain and record real validation results.
49. **APP-AC-49:** Every synchronization result is persisted with its `syncSourceBranch`/`syncSourceSha`, `prHeadBranch`/`prHeadSha`, status, worktree path, conflict details, diff, and validation results, and can be reviewed after UI closure or restart; user-actionable statuses also show a plain-language explanation of what happened, why it matters, and what the user can do next.
50. **APP-AC-50:** Publishing a synchronization result requires explicit human approval, re-verifies `syncSourceSha` and `prHeadSha`, and never uses force push.
51. **APP-AC-51:** Movement of `syncSourceBranch` or `prHeadBranch` marks the synchronization result stale and prevents publication until the user re-evaluates or discards it.
52. **APP-AC-52:** Publishing a synchronized PR marks older Review Bundles prepared against the previous PR head stale without deleting their history or worktrees.
53. **APP-AC-53:** Retrying or resuming a synchronization or publication operation is idempotent and does not create duplicate merge commits, duplicate pushes, or duplicate response publication attempts.
54. **APP-AC-54:** Every worktree-mutating AI Work Operation has a persisted, configurable turn budget with a safe default and an application-enforced hard maximum.
55. **APP-AC-55:** A single AI-provider turn has a bounded execution timeout, and UI closure or application restart cannot reset a consumed AI Work turn budget.
56. **APP-AC-56:** After every worktree-mutating AI-provider turn, the application records an AI Work Turn Report containing the reported approach, reported problems, remaining issues, actual file and command activity, deterministic results, progress classification, and state fingerprint.
57. **APP-AC-57:** Repeated worktree/problem state, two consecutive turns without material deterministic progress when the operation-specific completion predicate is still false, timeout, execution failure, or budget exhaustion stops automatic AI work and produces a machine-readable `NEEDS_ATTENTION` reason.
58. **APP-AC-58:** Before a user can continue stopped AI work, the UI shows the complete turn-by-turn report, encountered problems, remaining issues, and accumulated usage; **Continue AI Work** or **Retry Resolution** is an explicit human action that starts another bounded segment.
59. **APP-AC-59:** Preferences expose independent provider, model, and provider-supported reasoning-effort settings for Automatic Review / Re-evaluation, Review Revision, Read-only Conversation, and Merge Conflict Resolution task types.
60. **APP-AC-60:** Every AI invocation uses the profile for its declared task type, passes the resolved settings through the provider adapter, and records the profile revision used.
61. **APP-AC-61:** Worktree-mutating operation segments and read-only conversation turns snapshot their effective task profile and AI Execution Policy, and changing Preferences does not alter the configuration or reproducibility of work already in progress or already completed.
62. **APP-AC-62:** Review Bundles and Branch Synchronization results show the AI task type, provider, model, reasoning effort when supported, and a user-readable execution-policy summary whenever AI was used; deterministic paths continue to consume zero AI tokens.
63. **APP-AC-63:** The MVP uses OpenAI Codex through an isolated provider adapter; adding a future GitHub Copilot or AWS Bedrock adapter does not require changing deterministic monitoring, worktree, validation, AI Work Policy, review-bundle, or publication services.
64. **APP-AC-64:** Persisted AI work records retain provider-neutral execution metadata, including provider ID, model ID, profile revision, immutable AI Execution Policy snapshot, opaque provider conversation reference when available, and usage metadata when available.
65. **APP-AC-65:** The default polling interval is 10 minutes, conditional-request metadata and pagination checkpoints are maintained independently for each feedback resource, and a `304` for PR metadata cannot suppress checks for changed review comments, reviews, or issue comments.
66. **APP-AC-66:** A schema-valid review result covering every input event version may complete successfully without code changes when all items are `pushback`, `question`, or `no_change`; the generic no-progress safeguard does not misclassify that valid outcome as `NEEDS_ATTENTION`.
67. **APP-AC-67:** Every Review Bundle records `prBaseSha`, `prHeadSha`, and `worktreeBaselineSha`, exposes both the proposed-worktree diff and the PR-context diff, and publishes only the approved proposed diff relative to `worktreeBaselineSha`.
68. **APP-AC-68:** Publication phases, idempotency keys, commit SHAs, and per-response remote IDs survive UI closure, restart, and uncertain network outcomes; recovery never duplicates a commit or an already posted response, and a pushed commit with unreconciled responses is represented as `PUBLISHED_WITH_ERRORS`.
69. **APP-AC-69:** Remote event versions are immutable snapshots with scoped identities and content hashes, and Review Bundle items refer to those versions rather than only to mutable remote object IDs.
70. **APP-AC-70:** The user can select a named AI Execution Policy preset, the default permits uninterrupted provider tool use inside the operation-owned worktree without approval prompts, every AI Work Operation snapshots the effective policy, and a policy boundary violation never silently broadens access or grants publication authority.
71. **APP-AC-71:** The initial Review Proposal phase is read-only: before the user decides each item, the selected AI provider cannot modify the isolated worktree, commit, push, or post a response.
72. **APP-AC-72:** Every Review Proposal item exposes explicit **Accept recommendation** and **Override recommendation** controls; an override records the chosen disposition and instructions, and every `question` item exposes a required answer textbox before implementation can start.
73. **APP-AC-73:** When configured, baseline validation runs against the clean PR-head worktree before the Review Proposal and its real results are shown separately from post-change validation; post-change validation runs after accepted implementations and before final publication approval, with no model claim able to create a pass.
74. **APP-AC-74:** The user can configure repository-specific human-readable Build & Validation Instructions and structured baseline/post-change commands; the effective instructions and command profile are snapshotted with the Review Bundle, and free-form instructions never grant execution authority.
75. **APP-AC-75:** `READY_FOR_REVIEW` and `NEEDS_ATTENTION` are visually and semantically distinct: ready items explain what the user can inspect or approve, while attention items show what happened, why it matters, preserved evidence, and the permitted next action.
76. **APP-AC-76:** When resolving a merge conflict, the configured AI provider receives the exact source-side and PR-head-side change sets, merge-base identity, conflict details, and available intent context; it must preserve the compatible intent of both branches, must not blindly choose one side, and deterministic evidence must show what was resolved and how.
77. **APP-AC-77:** When the intent of conflicting changes is ambiguous, the synchronization result becomes `NEEDS_ATTENTION` with structured competing-intent and user-question data, preserves the worktree and prior evidence, alerts the developer, and blocks `READY_TO_PUBLISH` and publication until an explicit user-directed resolution is inspected and validated.

---

# 42. Guiding Rule for Implementation Agents

When implementing any new feature, first ask:

> Can this operation be performed correctly by ordinary deterministic software?

If yes, implement it deterministically.

Only use the selected AI provider when accomplishing the task requires understanding meaning, intent, code behavior, tradeoffs, or natural-language reasoning.

Do not use an LLM as a replacement for an API query, database lookup, Git command, state machine, parser, equality comparison, retry loop, scheduler, or other conventional computation.

The purpose of the selected AI provider in PRMonitor is to provide engineering judgment and code-generation capability—not to operate the machinery surrounding it. Codex supplies that capability for the MVP; future providers must fit the same boundary.

---

# 43. Pre-Implementation TODOs

* **Revalidate the staged review workflow.** Confirm the proposal-before-mutation interaction, per-item decision semantics, response inclusion choice, and exact visual treatment of `READY_FOR_REVIEW` versus `NEEDS_ATTENTION` before implementing F18-F23.
