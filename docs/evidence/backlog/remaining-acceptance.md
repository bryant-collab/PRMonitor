# Remaining acceptance requirements and execution boundaries

Issues #1, #2 and #3 remain open. The overnight window authorizes use of the PC;
it does not authorize changing customer data, host security, or publication.
The following are acceptance requirements, not silently waived criteria.

| Requirement and source | Current evidence and why not fully verified | What prevents execution here | Safe next step / required observation |
| --- | --- | --- | --- |
| Physical Windows display scaling: 125%, 150% and 200%; setup statuses, remediation, Retry and Open PR inbox must remain reachable without clipping. #1 evidence/manual matrix; #3 AC-03/AC-11 desktop/narrow/scaled layouts. | Native display scale is 1. Chromium 125%/200% zoom and 320/900/1024/1280 layouts verify renderer reflow only. | No OS desktop-control tool is exposed. Editing display registry/settings in the customer's session would change host state without verifying the physical result. | Use an approved disposable Windows VM/session and a display-control tool. Record the actual display scale at each setting; inspect fresh/partial/ready setup, twenty PRs, all five detail tabs, saved review/sync and long forms. Capture painted screenshots, focus and overflow. Restore the guest's initial display settings. |
| Independent Windows text scaling must preserve readable labels, complete forms and reachable actions. #3 AC-03/AC-10/AC-11; explicit parent acceptance request. | Browser zoom changes more than the Windows text-size setting. It cannot establish independent text scaling. | No OS settings/control tool or disposable guest is available. | In the same approved disposable guest, vary Accessibility > Text size independently of display DPI. Record exact chosen values as test cases, inspect headings/labels/errors/live statuses and scroll/focus reachability, and restore the guest's original value. Do not treat an invented percentage as an approved pass criterion. |
| Screen-reader operation: meaningful headings/labels, selected detail tabs, live status/error announcements, keyboard forms and recovery, no keyboard trap. #1 manual matrix; #3 AC-10. | Production accessibility smoke, actual AX names/headings and native Tab/arrow/Home/End input pass. No Narrator/NVDA speech was listened to, and an AX tree does not prove announcement timing or intelligibility. | No screen-reader/desktop/audio-control tool is exposed. Process-local accessibility support does not start or operate a screen reader. | Run Narrator or an approved reader in a disposable guest; navigate setup, Inbox/check boxes, detail tabs, Activity disclosures, failed/save/recovery announcements and forms by keyboard. Record heard announcements and focus transitions. Turn the reader off afterward in the guest. |
| Windows taskbar notification-area interaction must preserve close/reopen/exact-target routing and Shutdown semantics. #1 launch/reopen; #3 AC-10; F19 native lifecycle. | Actual Electron Tray/MenuItem callbacks reopen a closed window, persist shutdown COMPLETED, remove the tray and preserve saved review/sync history through cold restart. A physical taskbar click was not performed. | No taskbar/desktop-control tool. Programmatic callback invocation verifies the callback, not Windows shell hit-testing, overflow-icon access or menu presentation. | In the approved disposable guest, close the isolated app, locate its real taskbar/overflow icon, open its real context menu, reopen the window/target and choose Shutdown. Observe the icon disappears, owned process exits, and saved history survives restart. Never act on an unrelated app's icon. |
| Shipping app identity install/upgrade/reinstall and shortcuts must preserve legitimate data. #2 retained-data upgrade/fresh-install distinction; #3 AC-11 packaged Windows; F30 installer policy. | Test-only NSIS identity/no-shortcuts install 0.1.0 then upgrade 0.1.1 preserves actual saved review history/settings and passes sandboxed installed smoke. It does not exercise the shipping identity/shortcuts or an existing customer installation. | Existing PRMonitor shortcuts/installation registration are present in the current account. Installing the shipping identity here could overwrite them even when /D points into Temp. No disposable Windows account/VM has been provided; creating accounts or changing host security is outside authorization. | Provision an approved disposable Windows VM/account externally. Install a reviewable unsigned build using the actual shipping appId/productName/shortcut policy, seed only fixture history, upgrade to the reviewed build, then reinstall retaining data and compare a separate true-fresh profile. Verify shortcut targets, registry identity, saved versions/timestamps/history and uninstall preservation. Signing/release still require separate authorization. |
| Every original capability/control must remain reachable with the same typed command, guards, confirmation, history and external-effect boundary across applicable states. #3 AC-05/AC-06/AC-07/AC-10 and preservation matrix; #2 Activity error/legacy/filter/disclosure states. | 82 bridge operations / 174 original controls are source-mapped; service integration suites and native main routes are covered. All fifteen native stages pass, including actual successful Add, proposal decision/input/conversation guards, instruction lifecycle and repository guidance. Source references and opening all panes alone cannot certify every historical conditional branch. | This is residual executable verification work, not a tooling waiver. Positive live provider/GitHub publication is forbidden; destructive choices must stay inside verified fixture-owned worktrees. Genuine OS folder/file pickers and support-export dialogs require desktop control. | Continue bounded production renderer/preload/main/persistence journeys using exact recorded states and owned local worktrees. Record each control family as native pass, deterministic service/IPC pass, guarded refusal, or unverified. For provider/remote success/uncertainty use deterministic controlled ports and adapter contracts, never live AI/publication. Supply the remaining state-specific cases to parent acceptance review rather than claiming complete equivalence. |

## Conditional-control coverage ledger

| Family / applicable state | Evidence | Remaining executable cases |
| --- | --- | --- |
| Setup and ready routing; missing explicit targets; Add and PR settings | Native fresh/partial/restart/lost-auth/bootstrap/shell/add-success journeys; actual metadata GET fixture, persisted identity/settings, independent drafts and missing-target refusal. | OS clone/folder picker and shipping retained/fresh identity distinction. |
| Activity PR/application/all, legacy owner mapping, live/query filters and disclosures | Native empty/nonempty destinations; real SQLite reopen/filter/live parity and producer-to-copy tests. | Native historical error/recovery/unknown families across every filter and pagination state. Source copy inventory is not a complete native pass. |
| Proposal decision, question answer, entry instruction and conversation modes | Conditional-review journey exercises required-answer refusal, real F18 Accept/Override, F21 saved inputs, immutable recommendation, empty conversation refusal and revision mode; service suites cover controlled provider effects. | Native waiting-provider Continue/Cancel, budget stop/new-operation and latest-answer transfer; service coverage does not establish renderer state reachability for each. |
| Final review, diff, worktree and publication | Native guarded journey covers six panes, full 600-line owned diff, worktree refresh, missing approval refusal and historical uncertain publication; controlled F13/F22/F23 suites verify effects/guards. | Native draft save, discard/re-evaluation preview/choice/confirm/cancel and every publication response/approval/retry state. Live publication remains forbidden; deterministic owned fixtures/ports can expand these cases. |
| Sync batch/result and conflict/worktree choices | Native result A/B exact target, isolated drafts, saved versions/usage, empty-answer refusal and uncertain publication; F24/F25 suites verify controlled conflict and publication effects. | Native positive Submit direction/manual edit/retry; discard/re-evaluate/worktree choices and approval/reconciliation across applicable persisted states. |
| Settings task/instruction/repository | Native four-task drafts/save/discard; conditional-settings creates/selects/reorders/revises/deletes only owned instructions and saves guidance without execution. | Native provider-unavailable, policy-preset, invalid-options and operational-error states; genuine OS support/export dialogs. |
| Lifecycle and accessibility | Actual tray MenuItem callbacks, close/reopen/Shutdown/cold restart; native keys and process-local AX. | Physical taskbar, screen-reader speech, DPI/text scaling as specified above. |

This ledger distinguishes current native cases from service evidence and residual
states. The three issues remain open; the 174-control inventory is not presented
as a blanket equivalence certification.

## Exact-head Windows CI observations

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

The explicitly authorized separate branch `codex/ubuntu22-compat-check`, latest
commit `27753dc5752210d18cb57e7bd9b249a6f49e6fc5`, changes runs-on to ubuntu-22.04
and adds read-only closed-label diagnostics. [Latest experiment](https://github.com/bryant-collab/PRMonitor/actions/runs/37264227675/job/111617528977)
passes production artifact startup/accessibility smoke with the sandbox enabled.
Read-only values show AppArmor restriction=0, namespace probe exit=0 and glibc
2.35; the helper remains uid=1001/mode=0755. Both jobs subsequently fail the
unchanged foundation-contract test requiring the literal ubuntu-latest matrix.
All gates remain intact. The linker probe exits 1 against an unavailable fixed
artifact name, so its empty library lists do not establish library compatibility.
Earlier run 37262131924 failed startup code=1/UNCLASSIFIED; the diagnostic revision
37263615899 stopped at formatting before startup. These failures stay visible.
The latest sandboxed startup pass supports an environment-sensitive failure;
it does not establish a sole application root cause or a full aggregate pass.
The pin is not adopted in PR #4, and no compatibility PR was opened.

Further safe diagnosis can classify fixed application startup reasons, dynamic
library availability and the Electron version without printing private child
output or changing host controls. An approved Linux runner with usable native
namespace support and supported libraries is the alternative; it must pass
the same production smoke and aggregate before any compatibility decision.
No AppArmor/sysctl/setuid/no-sandbox or skipped-gate change is authorized.

Ubuntu 22.04 deprecation began September 17, 2026 and retirement is April 17,
2027 ([GitHub runner-images announcement](https://github.com/actions/runner-images/issues/14254)).
Any future pin would need an explicit temporary compatibility decision and
migration before retirement, not a claim that the application root cause is fixed.
