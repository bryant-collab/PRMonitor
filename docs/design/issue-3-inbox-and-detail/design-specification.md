## Decision and objective

**Approved by the product owner on 2026-10-04: Layout 1, Inbox and detail.** Implement this direction. No additional design brainstorming or choice among the other four layouts is required.

Replace the current single long page with a persistent navigation sidebar, a compact PR inbox, and a selected-PR detail pane. Give settings, Activity and connection/interrupted-work status their own destinations. Keep every current capability, state transition, guard, confirmation, history record and external-effect boundary. This is a navigation, information hierarchy, layout and customer-language change, not a workflow redesign.

## Approved design attachment

- [Approved interactive preview](inbox-and-detail.html)
- [Readable source fragment](inbox-and-detail-source.html)
- [Reference instructions](README.md)

The attached standalone HTML is the actual interactive preview the owner selected. Download it and open it in a browser; GitHub's file page shows source, not a running preview. The small source fragment is provided for implementation agents to inspect directly. Both are versioned in the repository on a design-reference branch and linked at an immutable commit. **The implementing agent does not need this conversation or the original local clone.**

The preview defines the information hierarchy and visual direction. Its example PRs are fictional and must never become production seed data. Its simulation buttons, placeholder forms, simplified counts, incidental help text and omitted advanced controls are not new business requirements. The full behavior-preservation matrix and requirements below take precedence over those simplifications. Apply the plain-language rules from #2 to the final copy. Keep production React/service architecture; do not embed the prototype HTML as the application.

## Related issues and ownership

- #1 owns mandatory setup criteria, safe readiness projection, resumable setup and default-startup routing. This issue supplies the shell and placement for that setup page and consumes its readiness contract; it must not invent a second completion flag or new prerequisites.
- #2 owns Activity provenance, PR-work/application-diagnostics separation, compact Activity presentation and ASD-STE100-inspired customer language. This issue places Activity in the shell and applies the same language policy to **all other touched customer surfaces**, including existing review/synchronization explanations. No feature IDs such as F16/F22, requirement IDs, internal enums or architecture boilerplate appear in customer-facing prose, tooltips or ordinary expanded explanations.
- These issues can be implemented in coordinated slices. Each owner preserves the other's requirements; integration of all three is required before calling the whole UI rework complete. This issue is not permission to alter polling, AI policies, review holds, Git behavior, validation, publication, credential storage or uninstall history preservation.

## Locked information architecture

Desktop inbox:

```text
PRMonitor                              Monitoring status / action-needed status
-------------------------------------------------------------------------------
PR inbox         PR inbox: counts, Check now, Pause/Resume, Sync selection, Add PR
Activity         --------------------------------------------------------------
Settings         PR list (existing order/groups) | Selected PR identity + state
                 Ready for review               | Overview | Review | Branch sync
Application      Needs attention                | Activity | PR settings
Connection       Working                        | Relevant summary, evidence and
 & work status   Watching                       | actions for this PR only
Setup                                           | Open full review workspace
-------------------------------------------------------------------------------
Compact background/connection status; link to Connection and work status
```

### FR-01 — Shell and navigation

- **FR-01.1:** Use one application shell with stable destinations **PR inbox**, **Activity**, **Settings**, **Connection and work status**, and **Setup**. Normal ready HOME opens PR inbox; incomplete HOME uses #1's setup routing. Sidebar main group contains PR inbox/Activity/Settings, with application links below. Keep current app branding and Windows desktop conventions; use Segoe UI, restrained blue accent, compact headings and readable text. Remove the giant centered startup card, oversized heading and vertical stacking of unrelated screens.
- **FR-01.2:** Header shows global watching/paused/offline/action-needed status from authoritative projections. A healthy application shows a compact status; expanded recovery counters, retention banners, diagnostics exports and preference forms do not occupy the inbox. Show actionable errors prominently with a destination link. Use distinct text/icons for ready-to-review versus needs-attention; never rely on color alone.
- **FR-01.3:** Keep the window within its client area with no whole-page horizontal scroll. At widths **1000 px and above**, show sidebar (168–184 px), PR list (260–300 px), and flexible detail pane (minimum 400 px) with 12–16 px gaps/padding. At widths below 1000 px, reflow navigation into a wrapping top navigation and show either inbox list or selected-PR detail, with **Back to PR inbox**. Do not stack a full long PR list above a full long detail screen. Support 320 px width and 200% text scaling by wrapping controls and reflowing forms, not shrinking essential text.
- **FR-01.4:** On the full desktop layout, keep shell navigation, inbox heading/toolbar and selected PR heading/tabs available while their relevant content scrolls. Give list and detail independently bounded scroll regions, with normal keyboard access and no nested scrolling inside a short summary. Full workspaces may scroll their content; a long code diff may use its own accessible horizontal scroll. No fixed-height content clipping. At narrower sizes, one content region scrolls beneath the navigation.
- **FR-01.5:** Global navigation selects a destination; it never triggers a workflow mutation. Closing the visible window keeps the background application running. Preserve tray reopen/current-virtual-desktop behavior and the existing **Shutdown PRMonitor** command. Do not rename Shutdown to Quit or turn window close into shutdown.

### FR-02 — Inbox and selected PR

- **FR-02.1:** Show each managed PR exactly once using the existing deterministic ordering and primary groups. Rows show repository/PR number, readable title, primary status and one concise progress/next-action summary. Preserve existing count/state/source/status fields through detail access. Synchronization remains a separate overlay and does not change the primary review state. Do not introduce board drag/drop, sorting semantics or new states.
- **FR-02.2:** Selecting a PR changes only the inspected PR. **Checkbox selection for branch synchronization is separate**; clicking a row never checks its checkbox, and checking a box never silently replaces the inspected PR. Keep individual selection, Select all, Clear selection, selected count, eligible/ineligible state and batch confirmation. Preserve selection across view changes to the extent supported by the current main-process selection session.
- **FR-02.3:** Inbox toolbar contains Add PR, global Check now, Pause/Resume watching and branch-sync selection/actions, using existing service/IPC controls and guards. Global/per-PR scope must be explicit in the label or nearby context. A paused state shows Resume watching; no navigation operation changes pause state. Preserve Check now's existing batching/hold/quiet-period semantics rather than treating it as authority to start AI work.
- **FR-02.4:** Detail tabs are **Overview**, **Review**, **Branch sync**, **Activity**, **PR settings**. Overview shows current state, a plain explanation, PR branch identities, relevant progress/attention and a contextual primary action. Review opens the saved review or explains that none exists; Branch sync opens saved batches/results or the existing source/head confirmation flow; Activity opens #2's PR-scoped history; PR settings contains existing PR/clone configuration. Do not show other PRs' stale details while the selected PR loads.
- **FR-02.5:** Initial ready inbox has no selected PR and says **Select a pull request to see its details**. Selection survives ordinary navigation within a renderer; restore it only if the PR still exists. If removed/unmanaged, clear it and show a factual empty state without changing other selections. An empty installation shows **No pull requests yet** and **Add PR**, without fixture data. No independent duplicate list of managed PRs remains elsewhere on the page.
- **FR-02.6:** Long review/diff/conversation screens use a dedicated full-width workspace within the same shell, entered through **Open full review workspace** or the contextual primary action. Provide **Back to PR inbox**, restoring inspected PR and list position. Do not cram a full diff or entire conversation into a narrow overview pane. Small summaries in the pane are read-only unless they expose the exact existing explicit operation control and its guards.

### FR-03 — Focused forms and settings

- **FR-03.1:** Add PR opens a focused page in the same shell with verified server choice and URL as primary fields. A labeled **Optional PR settings** disclosure contains intent/context, synchronization source override and existing clone path/browse. Keep all validations, duplicates, clone inspection, candidate choice, attach/clear, cancellation and Add PR recovery-attempt actions. Optional disclosure state must not change whether submitted values are included. Failed attempts are visible in context and linked from application attention when appropriate.
- **FR-03.2:** Settings uses a category navigation and renders only the selected category. Categories: **GitHub connections**, **AI task profiles**, **Execution policy**, **Monitoring and work limits**, **Common instructions**, **Repository build and validation**, **Setup**, **Support diagnostics**. The global worktree-root setting belongs under Monitoring and work limits; repository-specific instructions/commands belong under Repository build and validation. Do not hide an existing field because the preview only shows sample controls.
- **FR-03.3:** Edit the four AI task profiles independently, showing the selected task's editor and all existing enabled/provider/model/reasoning/options/availability/validation controls. Switching categories or PRs must not silently lose edits. Preserve committed state through restart; dirty drafts survive in-session navigation through renderer-owned draft state. For deliberate discard, provide an explicit discard/cancel flow. Native shutdown behavior and secret-clearing policies remain authoritative; never persist token drafts as ordinary settings.
- **FR-03.4:** Navigation unmounting is not operation cancellation. On returning to a screen, show current authoritative results, busy/failed/cancelled/recovery state and permitted actions. Repeated clicks while busy must retain current duplicate/idempotency protection. Distinguish form field errors from transient connection problems and operation outcomes.

### FR-04 — Understandable interrupted-work status

- **FR-04.1:** Replace the always-expanded **Restart and connection recovery / Durable recovery / scopes / Reconcile now** panel with Connection and work status. Healthy summary: **No interrupted work needs action**. Failed/interrupted items show affected PR/work, what happened, consequence, and the permitted next action. Present stopped AI work, uncertain publication and network waiting distinctly. Routine lifecycle checks must not create user attention.
- **FR-04.2:** Rename the existing global recovery command **Check interrupted work**. Before the button, show: **PRMonitor checks saved work against local files and GitHub. It then retries only work that the current recovery rules allow. Work that needs your decision stays stopped.** Also explain: **This check does not approve new changes or restart stopped AI work. It can check the outcome of changes you already approved.** Adapt the wording only to remain exactly true to the existing owner-specific behavior. Do not label this command read-only or promise no effects if current recovery can retry approved work.
- **FR-04.3:** Button shows **Checking interrupted work…** while busy, then the actual completed/partial/error result. Show a retry/remediation action on a failed request and an honest uncertain outcome; do not silently ignore IPC failure. Preserve the existing command and safe recovery semantics, scopes, retries and evidence. Technical keys/codes are raw support data, not explanations.
- **FR-04.4:** Specific commands such as Continue AI Work, Retry Resolution, discard/re-evaluate and publication outcome checking remain in their owning PR/review/result workspace. Global recovery is not a shortcut around their inspections/approvals. Support diagnostic export remains under Settings > Support diagnostics with destination picker, safe success/failure feedback and existing redaction.

## Complete behavior-preservation matrix

Use this matrix as a minimum. Inventory every existing renderer control and IPC action before refactoring and add any action not listed here to the implementation evidence with its destination and equivalence check. **A capability absent from the simplified prototype must not be deleted.** Do not invent behavior for prototype-only placeholders that have no existing supported contract.

| Existing capability | Required destination and preserved behavior |
| --- | --- |
| Startup health, secure-store/database/service readiness | Setup and compact shell status; preserve errors and authoritative service guards |
| All managed PR groups, counts, reasons, metadata, progress and synchronization overlays | Inbox rows + selected Overview; same values/order/group semantics |
| Add PR, optional context/source/clone, browse, duplicates, failed/recovery attempts | Focused Add PR page + selected PR settings; same committed operations and outcomes |
| Edit PR context/source, clone candidates, attach/clear clone, PR operation metadata | PR settings; preserve optionality, inspection and safe clone decisions |
| Select one/all PRs, Clear, source/head resolution, eligibility, revision confirmation, preparation intent | Inbox selection toolbar + explicit synchronization confirmation; no accidental batch start |
| Review proposal items, assessments, recommendation acceptance/override, required question answers, instructions and implementation start | Full Review workspace, with exact proposal-before-mutation guards |
| Final review/revision, response editing/inclusion, read-only conversation vs mutating revisions, continuation/cancellation | Full Review workspace; same operation snapshots, permissions, budgets and held state |
| Baseline vs post-change validation, complete proposed-worktree and PR-context diffs, files/open/reveal/copy/worktree actions | Full Review workspace, focused tabs/panes; no truncation or substitution of model claims for real validation |
| Discard/re-evaluate, stale branch checks, dirty-worktree Clear All/Clear Only AI/Keep and Cancel, recovery previews/evidence | Owning workspace; preserve explicit choices, confirmation and guarded transitions |
| Approval, publish, publication outcome checking, retry failed responses, partial/uncertain outcome and remote IDs | Full Review workspace; preserve approval snapshots, idempotency, freshness and no-force rules |
| Synchronization batches/results, source/head SHAs, worktree/diff/validation, conflict intent questions, user direction, bounded conflict retry/continue | Branch sync + full result workspace; preserve independent results, evidence and user decisions |
| Synchronization freshness/worktree checks, discard/re-evaluate/dirty choices, approval/push/outcome recovery | Full result workspace; unchanged guards, stale handling and publication semantics |
| GitHub.com/GHES add/update, token save/test/replace/remove, test cancellation, operation resume/cleanup | Settings > GitHub connections (reused by Setup); same secure credential handling and errors |
| Per-task AI settings, all policy presets/compatibility, turn limit, polling and quiet period, worktree root | Relevant Settings categories; same validation, independent profiles and immutable in-flight snapshots |
| Common instruction create/edit/enable/disable/delete/select/order and repository build/validation settings | Relevant Settings categories; same persisted values, revisions and snapshot semantics |
| Activity filters/history/pagination/subscription/details/target navigation; retention and raw support data | Activity and selected-PR Activity; integrate #2 without losing any existing query capability |
| Global recovery, owner-scoped attention, diagnostics export and retry/status | Connection and work status / Settings > Support diagnostics; explanation changes, same operational semantics |
| Tray, native notifications, deep links, open file manager, window close/reopen and Shutdown PRMonitor | Existing native lifecycle + shell routes; no new approval, no background cancellation on navigation |

## Navigation and lifecycle contracts

Implement a typed renderer view-state controller using the existing validated OpenTarget boundary. Maintain distinct destination, selected managed PR, detail tab, review bundle ID, synchronization batch/result ID, and synchronization selection. Resolve current records through main; do not infer authority from route strings or activity prose.

| Existing target | View to open |
| --- | --- |
| HOME | #1's Setup when incomplete; otherwise PR inbox |
| MANAGED_PR | PR inbox with the exact PR selected and Overview visible |
| MANAGED_PR_SETTINGS | PR inbox with the exact PR selected and PR settings visible |
| REVIEW_BUNDLE | Exact bundle in full Review workspace, selecting the owning PR when available |
| SYNCHRONIZATION_BATCH | Branch-sync batch workspace with its independent result list |
| SYNCHRONIZATION_RESULT | Exact synchronization result workspace |

Explicit notification/deep-link targets take precedence over default landing according to #1; incomplete setup remains visible as a banner/link without preventing read-only inspection. Missing/deleted targets show a factual not-found state and **Back to PR inbox**, with no fallback action on another record. Duplicate targets select a view only. Preserve draft state when an incoming target changes destination, but never save/approve/cancel a draft merely to navigate. Async results must be tied to the selected identity/revision so delayed PR A data cannot render as PR B.

Unsubscribe renderer-only listeners on unmount and rehydrate/subscription-sync on mount without stale-data flashes or duplicate callbacks. Navigation, tab changes, closing the window and reopening never stop main-process watching/AI/validation or release holds. Read/subscription failures use an explicit error and Refresh; last-known data is visibly labeled and cannot bypass existing action guards.

## Implementation plan

1. **Inventory and shell routing:** Record every current control/IPC method and destination; extract existing controllers/editors with their guards; add typed routes and layout shell. Visible exit: only one destination renders, all OpenTarget kinds land correctly, and no view selection changes domain state. Evidence: inventory, target/read-failure/stale-response tests.
2. **Inbox and PR workspace:** Integrate existing inbox read/subscription logic, row inspection, separate sync checkboxes, compact overview and detail tabs; move Add PR and PR configuration to their destinations. Visible exit: list/detail and all selection/clone/Add PR workflows work without global vertical stacking. Evidence: mixed-state fixture, multi-PR selection/confirmation, delayed read test, failed Add PR recovery.
3. **Review and synchronization workspaces:** Mount existing review/result components in dedicated full-width destinations and reorganize into focused sections/tabs without changing command semantics. Visible exit: complete evidence and all guarded actions remain reachable, with return-to-inbox state. Evidence: proposal, final review, needs-attention, stale/dirty, publication uncertainty and conflict-intent journeys.
4. **Settings, setup and status:** Extract focused preference/GitHub editors; integrate #1/#2; add clear connection/interrupted-work presentation and diagnostics destination. Visible exit: every configuration action has one home, navigation preserves drafts and operations, and no internal-feature language appears in customer prose. Evidence: complete settings mapping, setup/deep-link combinations, recovery failure/busy/partial cases, language review.
5. **Accessibility, packaged validation and handoff:** Verify desktop/narrow/scaled layout, keyboard focus, read/live-update states and native lifecycle. Update affected owning PRDs/PLANs where presentation changes require it; preserve application acceptance contracts. Evidence: comparison screenshots, behavioral equivalence matrix and relevant existing test/check results. No requirement is complete merely because the static mock looks similar.

Likely source boundaries: `apps/desktop/src/renderer/StartupApp.tsx`, `ManagedPrInbox.tsx`, `Preferences.tsx`, `ActivityViewer.tsx`, `ReviewBundleWorkspace.tsx`, `SynchronizationReview.tsx`, `styles.css`; routing/IPC/preload contracts; existing main services only as needed to expose already-supported controls safely. There is no legacy `checklist.md` in this checkout: do not invent a checkbox update. This issue is the self-contained approved implementation brief. Read the owning specs in `Specs/` for preserved business contracts, not as customer copy to paste into the UI.

Shared application-acceptance coverage: APP-AC-01/02/03 (connection/add/multiple-PR presentation), APP-AC-16–23/30/31 (holds/lifecycle/navigation/review access), APP-AC-27–29/39/43–45/49–53/58/67/68/71–75 (guarded review/sync/publication and evidence), APP-AC-32–42/59–62/70/74 (settings/snapshots/policy). This issue owns presentation/access paths only; existing features remain authoritative for the underlying outcomes. All other existing application criteria remain unchanged.

## Acceptance criteria and completion evidence

- **AC-01 (FR-01, FR-02):** At 1280×800 and 1024×768, navigation, Add PR, watching status, primary inbox actions, a PR row and selected-detail tabs/primary action are available without scrolling through unrelated screens. Twenty PRs and long detail data scroll in their own relevant regions. Settings/Activity/recovery forms are absent from the inbox DOM unless their destination is selected.
- **AC-02 (FR-01.3/4):** At 900×650, 320 px width and 200% text scaling, navigation and actions reflow without clipping/whole-page horizontal overflow. List/detail switch with a Back action; no long list is stacked above the entire detail screen. Complete diff content remains accessible even when horizontal diff scrolling is necessary.
- **AC-03 (FR-02):** Mixed READY_FOR_REVIEW/NEEDS_ATTENTION/WORKING/WATCHING data uses existing ordering/groups, all PRs exactly once, distinct labels/explanations and separate sync overlays. Selecting a PR does not select it for synchronization; sync checkboxes preserve inspected PR; all/clear/eligibility/confirmation act exactly as before.
- **AC-04 (FR-02, routing):** Every OpenTarget kind and stale/missing ID is exercised through tray/notification/IPC entry points. Ready HOME opens inbox, incomplete HOME opens #1 setup, explicit bundle/result targets open exact records with setup reminder when needed. Delayed reads cannot cross PR identities. Navigation/back restores selection and position without mutation or duplicate subscriptions.
- **AC-05 (FR-03, matrix):** Every inventoried control is reachable in its assigned destination and submits the same typed service operation with the same guards/confirmation. Compare before/after behavior for every row of the preservation matrix. Edit drafts survive in-session destination changes; secure token clearing and durable restart boundaries remain unchanged.
- **AC-06 (FR-02.6, matrix):** Proposal decisions/required answers, implementation, final diff/validation, conversation/revision, dirty/stale handling, explicit publication/response retry and bounded continuation remain functional. Complete diff and saved evidence are not truncated by the compact detail pane. Sync confirmation/results/conflict-intent questions/validation/approval preserve independent processing and no-force/idempotent behavior.
- **AC-07 (FR-04):** Healthy connection/work status stays compact. Offline, interrupted, stopped AI and uncertain approved publication show factual consequences and permitted next actions. Check interrupted work uses the existing recovery operation with explanatory text, busy state and actual success/partial/error feedback. It never grants new approval or silently continues stopped AI work. Diagnostic export remains available and redacted.
- **AC-08 (#1/#2 integration):** Fresh profile shows setup until mandatory readiness; ready zero-PR profile has genuine empty inbox and default PR Activity, with routine application diagnostics accessible separately. No mock fixture data, simulated handlers or example configuration is shipped as customer state.
- **AC-09 (language):** Review a before/after copy inventory for all touched surfaces using #2's ASD-STE100-inspired rules. No feature IDs/internal enums/architecture boilerplate appear in rendered explanatory prose or normal tooltips/details. Unknown/failure outcomes remain honest and actionable. Raw support evidence is clearly separate and redacted.
- **AC-10 (accessibility/lifecycle):** Keyboard-only users can select PRs, navigate tabs/destinations, use sync checkboxes, recover from errors and complete forms. Visible focus, semantic tab/selected-state labels, meaningful headings, polite status updates and error announcements work with a screen reader. Navigation restores meaningful focus; no keyboard trap in scroll regions. Window close/tray reopen/restart and Shutdown PRMonitor retain existing main-process behavior, holds and operation budgets.
- **AC-11 (validation):** Run meaningful renderer/IPC/lifecycle integration tests, relevant existing inbox/auth/preferences/review/sync/recovery/activity tests, and `npm run check:desktop`. Provide packaged Windows screenshots for desktop/narrow/scaled views and the complete control-equivalence matrix. Use isolated test-owned user-data/worktree roots; never test against customer storage or live external mutations. Run spec linters when owning PRD/PLAN documents are changed. Attach results and any concrete limitation; no silent feature removal is acceptable.

No new analytics, navigation framework, design system package, backend state machine, authentication mechanism, default policy change, automatic remote action, or product feature is required. Existing behavior remains the authority; the approved shell makes it discoverable and understandable.
