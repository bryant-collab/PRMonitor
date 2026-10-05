# Remaining acceptance requirements and execution boundaries

Issues #1, #2 and #3 remain open. Command-line work uses isolated fixture profiles;
it does not authorize changing customer data, host security, or live publication.
The following are acceptance requirements, not silently waived criteria.

| Requirement and source | Current evidence and why not fully verified | What prevents execution here | Safe next step / required observation |
| --- | --- | --- | --- |
| Physical Windows display scaling: 125%, 150% and 200%; setup statuses, remediation, Retry and Open PR inbox must remain reachable without clipping. #1 evidence/manual matrix; #3 AC-03/AC-11 desktop/narrow/scaled layouts. | Native display scale is 1. Chromium 125%/200% zoom and 320/900/1024/1280 layouts verify renderer reflow only. | No OS desktop-control tool is exposed. Editing display registry/settings in the customer's session would change host state without verifying the physical result. | Use an approved disposable Windows VM/session and a display-control tool. Record the actual display scale at each setting; inspect fresh/partial/ready setup, twenty PRs, all five detail tabs, saved review/sync and long forms. Capture painted screenshots, focus and overflow. Restore the guest's initial display settings. |
| Independent Windows text scaling must preserve readable labels, complete forms and reachable actions. #3 AC-03/AC-10/AC-11; explicit parent acceptance request. | Browser zoom changes more than the Windows text-size setting. It cannot establish independent text scaling. | No OS settings/control tool or disposable guest is available. | In the same approved disposable guest, vary Accessibility > Text size independently of display DPI. Record exact chosen values as test cases, inspect headings/labels/errors/live statuses and scroll/focus reachability, and restore the guest's original value. Do not treat an invented percentage as an approved pass criterion. |
| Screen-reader operation: meaningful headings/labels, selected detail tabs, live status/error announcements, keyboard forms and recovery, no keyboard trap. #1 manual matrix; #3 AC-10. | Production accessibility smoke, actual AX names/headings and native Tab/arrow/Home/End input pass. No Narrator/NVDA speech was listened to, and an AX tree does not prove announcement timing or intelligibility. | No screen-reader/desktop/audio-control tool is exposed. Process-local accessibility support does not start or operate a screen reader. | Run Narrator or an approved reader in a disposable guest; navigate setup, Inbox/check boxes, detail tabs, Activity disclosures, failed/save/recovery announcements and forms by keyboard. Record heard announcements and focus transitions. Turn the reader off afterward in the guest. |
| Windows taskbar notification-area interaction must preserve close/reopen/exact-target routing and Shutdown semantics. #1 launch/reopen; #3 AC-10; F19 native lifecycle. | Actual Electron Tray/MenuItem callbacks reopen a closed window, persist shutdown COMPLETED, remove the tray and preserve saved review/sync history through cold restart. A physical taskbar click was not performed. | No taskbar/desktop-control tool. Programmatic callback invocation verifies the callback, not Windows shell hit-testing, overflow-icon access or menu presentation. | In the approved disposable guest, close the isolated app, locate its real taskbar/overflow icon, open its real context menu, reopen the window/target and choose Shutdown. Observe the icon disappears, owned process exits, and saved history survives restart. Never act on an unrelated app's icon. |
| Shipping app identity install/upgrade/reinstall and shortcuts must preserve legitimate data. #2 retained-data upgrade/fresh-install distinction; #3 AC-11 packaged Windows; F30 installer policy. | Test-only NSIS identity/no-shortcuts install 0.1.0 then upgrade 0.1.1 preserves actual saved review history/settings and passes sandboxed installed smoke. It does not exercise the shipping identity/shortcuts or an existing customer installation. | Existing PRMonitor shortcuts/installation registration are present in the current account. Installing the shipping identity here could overwrite them even when /D points into Temp. No disposable Windows account/VM has been provided; creating accounts or changing host security is outside authorization. | Provision an approved disposable Windows VM/account externally. Install a reviewable unsigned build using the actual shipping appId/productName/shortcut policy, seed only fixture history, upgrade to the reviewed build, then reinstall retaining data and compare a separate true-fresh profile. Verify shortcut targets, registry identity, saved versions/timestamps/history and uninstall preservation. Signing/release still require separate authorization. |
| Original control preservation: #3 AC-05/AC-06/AC-07/AC-10 and approved preservation matrix; #2 Activity states. | 82 bridge operations / 174 original controls are source-mapped. The finite ledger below identifies executed renderer/IPC journeys, guarded refusals and separate owning service tests. These are complementary evidence, not a claim that every historical permutation was natively replayed. | OS clone/folder/file/support-export dialogs require a desktop-control tool, which is not exposed. Live provider and GitHub publication are outside authorization. | Parent acceptance can review the finite ledger and exact results. Complete physical dialog checks with fixture data in an approved disposable session; retain the controlled-port boundary for provider/publication outcomes. |

## Conditional-control coverage ledger

| Family / applicable state | Finite executed evidence | Remaining requirement or separate evidence boundary |
| --- | --- | --- |
| Setup and ready routing; missing explicit targets; Add and PR settings | Native fresh/partial/restart/lost-auth/bootstrap/shell/add-success journeys; actual metadata GET fixture, persisted identity/settings, independent drafts and missing-target refusal. | OS clone/folder picker and shipping retained/fresh identity distinction. |
| Activity PR/application/all, legacy owner mapping, live/query filters and disclosures | Native empty/nonempty, historical failure/uncertain/recovery/unknown scope isolation, combined severity/stage/correlation and actual 50/65-row pagination. Real SQLite failure preserves last-known rows; restoring unchanged rows and explicit Refresh recovers. Real F13 delivers one live event without Refresh. Reopen/filter/live parity and the closed producer/message catalog have separate integration coverage. | No remaining executable family is inferred from arbitrary filter permutations. Physical screen-reader disclosures and genuine export dialogs remain unverified. |
| Proposal decision, question answer, entry instruction and conversation modes | Native required-answer refusal, real F18 Accept/Override, F21 saved input and immutable recommendation; empty-input refusal; controlled read-only answer/usage/transfer, provider failure and invalid output with retained history and explicit retry; dirty-worktree admission, budget exhaustion/new operation, background Cancel/Continue and foreground Cancel while React awaits its own request. | Controlled provider evidence invokes no actual model. Owning F15/F17/F21 suites independently cover provider/admission contracts. Physical announcements remain unverified. |
| Final review, diff and F22 worktree handling | Native six panes, full 600-line owned diff, worktree refresh, response draft save/reload; actual stale-gate refusal, discard/re-evaluation previews and both cancellation paths; acknowledged Clear all completes on an owned worktree, clears intent/releases hold and verifies actual clean Git state. | Positive replacement transfer/compensation and unsafe/mixed/stale refusals have owning F22 service evidence. This does not claim a native completed replacement. Live publication remains forbidden. |
| F23 guarded publication | Native acknowledgement refusal, actual CANDIDATE_CHANGED refusal without success copy, explicit reread and new acknowledgement, durable approval without effects; controlled uncertain push, reconciliation, failed-response-only retry, terminal replay, released F11 hold and unchanged owned bytes. | Git/response effects are controlled ports, not actual commit/push/post. Owning F23 suites separately cover preflight and adapter/uncertainty contracts. |
| Sync batch/result and conflict/worktree choices | Native exact targets/isolated drafts/saved versions/usage; four versioned historical conflict actions, blank-answer refusal, refresh, Keep and Cancel, actual Clear AI, unattributed-change refusal, acknowledged Clear All and terminal discard/history retention; controlled exact approval, uncertain push/reconcile/replay; durable re-evaluation handoff and old-history retention. | Preparation port acknowledgement does not claim a new F25 batch or actual AI resolution. Owning F24/F25/F26/F27 suites separately verify preparation, conflict and effect contracts. |
| Settings task/instruction/repository | Native four-task drafts/save/discard; owned instruction CRUD/selection/order and repository guidance; malformed/invalid-shaped options without persistence; controlled disabled-provider classification and explicit revalidation; all five policy presets with original restored and invariant scope/publication authority; invalid/stale policy and operational turn/root/timer refusal without persistence, then valid retry. | Genuine OS clone/folder/file/support-export dialogs remain unverified because no desktop-control tool is exposed. No provider runs or customer settings change. |
| Lifecycle and accessibility | Actual tray MenuItem callbacks, close/reopen/Shutdown/cold restart; native keys and process-local AX. | Physical taskbar, screen-reader speech, DPI/text scaling as specified above. |

This ledger distinguishes current native cases from service evidence and residual
states. The three issues remain open; the 174-control inventory is not presented
as a blanket equivalence certification.

The finite cases are based on the approved preservation matrix, not an added
requirement to replay all possible historical combinations. Native cases use
actual typed commands, SQLite and owned worktrees. Owning service evidence is
identified separately: F22 has exact ownership/freshness, transfer-once,
compensation, mixed/unsafe and interrupted-effect tests; F24/F25/F26 cover
preparation and conflict persistence; F27 covers no-op/changed publication and
uncertain push without a second push. These tests run in the required aggregate.

## Exact-head Windows CI observations

At `85d6697282c28308f49ac15dbbaea3b18c8e2a14`, both the
[PR Windows job](https://github.com/bryant-collab/PRMonitor/actions/runs/37269333527/job/111632779119)
and [push Windows job](https://github.com/bryant-collab/PRMonitor/actions/runs/37269330282/job/111632769367)
pass aggregate and all fifteen native stages. The session reconciliation fix
reduces settings startup from 161 repeated Git probes in failed CI to 16,
preserving 133 individual recovery outcomes and every deadline/security gate.
See [bounded startup observations](startup-recovery.md) for timings and the
preceding failed jobs. This records the observed passes without erasing history
or claiming that all original controls have been exercised.

At `60520d5ec7771238e5b168b63fc15fb2eed4df1a`, the [push Windows job](https://github.com/bryant-collab/PRMonitor/actions/runs/37265645328/job/111621787195)
passes aggregate and all fifteen native stages. The [PR first attempt](https://github.com/bryant-collab/PRMonitor/actions/runs/37265647986/attempts/1)
passes aggregate but times out waiting for the retained-restart window after
Shutdown. Its unchanged [Windows rerun](https://github.com/bryant-collab/PRMonitor/actions/runs/37265647986/job/111623533676)
instead stops at production smoke, code=1/category=UNCLASSIFIED, before native
acceptance. No root cause is established, and no timeout/assertion/security gate
is widened. The subsequent diagnostic change emits only exact, closed startup
protocol labels; private child output stays private. The successful push proves
this head can pass, but does not erase either PR failure or prove startup stability.

## Ubuntu runner evidence and safe alternative

At implementation head `2cea5c6`, both Windows CI jobs pass the aggregate and
twelve native stages. Ubuntu-latest fails before application JavaScript with
SIGTRAP / SANDBOX_SETUP_FAILED / HELPER_OWNERSHIP_OR_MODE. Read-only values are:
userNamespaceEnabled=1, apparmorUserNamespaceRestriction=1, NoNewPrivs=0,
Seccomp=0, sandbox helper uid=1001/mode=0755, namespace probe exit=1.
The same pre-JavaScript failure exists in baseline run 37238773164.

The explicitly authorized separate branch `codex/ubuntu22-compat-check`, earlier
commit `27753dc5752210d18cb57e7bd9b249a6f49e6fc5`, changed runs-on to ubuntu-22.04
and added read-only closed-label diagnostics. [Earlier experiment](https://github.com/bryant-collab/PRMonitor/actions/runs/37264227675/job/111617528977)
passes production artifact startup/accessibility smoke with the sandbox enabled.
Read-only values show AppArmor restriction=0, namespace probe exit=0 and glibc
2.35; the helper remains uid=1001/mode=0755. Both jobs subsequently fail the
unchanged foundation-contract test requiring the literal ubuntu-latest matrix.
All gates remain intact. The linker probe exits 1 against an unavailable fixed
artifact name, so its empty library lists do not establish library compatibility.
Earlier run 37262131924 failed startup code=1/UNCLASSIFIED; the diagnostic revision
37263615899 stopped at formatting before startup. These failures stay visible.
The subsequent experiment `0b13e9738f20c25955333fc39114d54000de0a7e` retains the
actual Windows and ubuntu-latest jobs and adds a separate Ubuntu 22.04 job,
preserving the unchanged foundation contract. Its [Ubuntu 22.04 job](https://github.com/bryant-collab/PRMonitor/actions/runs/37267725882/job/111627957924)
passes the full pinned aggregate, including production sandboxed startup and
accessibility smoke. The [Windows job](https://github.com/bryant-collab/PRMonitor/actions/runs/37267725882/job/111627957636)
passes aggregate and all fifteen native stages. The retained
[ubuntu-latest job](https://github.com/bryant-collab/PRMonitor/actions/runs/37267725882/job/111627957835)
still fails before application JavaScript. The compatibility result establishes
a safe environment alternative with all gates intact; it does not establish a
sole application root cause. No host security setting changed. The artifact
linker probe now uses the correct executable name. Bryant subsequently approved
the temporary Ubuntu 22.04 pin in PR #4; [adoption and retirement criteria](ubuntu-runner-pin.md)
record the precise exception. The separate experiment branch remains unchanged.

Further safe diagnosis can classify fixed application startup reasons, dynamic
library availability and the Electron version without printing private child
output or changing host controls. An approved Linux runner with usable native
namespace support and supported libraries is the alternative; it must pass
the same production smoke and aggregate before any compatibility decision.
No AppArmor/sysctl/setuid/no-sandbox or skipped-gate change is authorized.

Ubuntu 22.04 deprecation began September 17, 2026 and retirement is April 17,
2027 ([GitHub runner-images announcement](https://github.com/actions/runner-images/issues/14254)).
The approved pin requires migration before the March 2027 brownouts and removal
before retirement; it does not claim that the application root cause is fixed.
