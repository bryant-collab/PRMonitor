# Review fixes and additional Windows acceptance

The final follow-up fixes successful Add ownership: refresh the Inbox projection
and load the added record through the same stale-safe details/work/settings reader.
The native test actually submits two isolated Add requests and checks Back and
sidebar return, empty saved work, settings save and the original PR's unsaved draft.
Proposal acceptance uncovered an unbound F18 coordinator call; the owning method
now keeps its receiver. Instruction cards and Move controls follow the draft order
after the first reorder. Native conditional journeys verify the resulting commands
through real IPC and SQLite, not renderer-only callbacks.

Installer child diagnostics are bounded and private. Public failures use fixed
labels/digests, and canonical Temp paths propagate to builder, installer,
uninstaller and smoke children. Three focused release tests verify privacy,
stream/nonce/timeout handling and path aliases. The real Windows 8.3 alias run
passes both installed versions and owner-validated cleanup. A separate deeper
Temp-root experiment failed at INSTALL_0_1_1; its private diagnostics do not
establish a cause. Deep arbitrary install-path acceptance is not claimed.

The explicit [remaining acceptance matrix](remaining-acceptance.md) identifies
the physical requirements, evidence gaps, execution blockers and safe next steps,
plus the separate Ubuntu compatibility experiment. These requirements are retained.

The follow-up keeps the reviewed implementation and addresses four independent review findings, plus two issues found by native acceptance.

| Problem | Result and regression evidence |
| --- | --- |
| Add PR draft appeared in the inspected PR's configuration | Independent Add fields and clone-picker ownership; native existing PR edit → Add → Back/sidebar Inbox → Save retains both drafts and writes only the inspected PR. |
| A sync workspace changed its internal target behind the root route | Result/batch navigation dispatches typed root targets. Reopening or returning triggers a current read; native A → B → Activity → explicit A checks identity, isolated answers and persisted source-version advancement. Publication acknowledgments reset when the candidate changes. |
| Historical Activity owner queries disagreed with live predicates | SQL projects the same persisted recovery scope before owner filtering and LIMIT. SQLite reopen regression checks matching PR/application owner queries and unchanged original payload bytes. |
| Window/worktree actions claimed a notification was sent | Producer records have a closed nativeAction. Presentation handles four actual actions and known historical summaries. An actual coordinator → Activity persistence → presentation regression verifies distinct window, target, folder and notification text. |
| Saving one task profile reset drafts for other tasks | Draft retention compares saved profile revision, preserving unsaved fields across refreshed availability metadata. Native four-task editing/navigation/discard/save checks other drafts and saved revisions remain unchanged. |
| Conflict usage could not pass the persistence codec | F25 uses its existing usageUnits storage convention for nested conflict aggregate/turn counts; read restores the strict F26 schema and optional measurement fields. Credential-key rejection remains unchanged. Native saved conflict rehydration verifies numeric input/output counts through real SQLite and process restarts. |

The full aggregate check passed with 427 desktop, 43 contract, 17 spec-linter and 14 release tests. All TypeScript boundaries include root fixture TypeScript, lint/format pass, and the production artifact passes its existing sandboxed startup/accessibility smoke. No linter, credential, security or publication gate was removed.

Exact-head CI at `745bc64` exposed a Windows runner fixture issue after the PR job passed its aggregate: Temp used a `RUNNER~1` short-path alias while F13 correctly required the recorded canonical worktree path. The acceptance runner now canonicalizes its Temp and owned roots, passes canonical Temp inputs to its children, and verifies cleanup against that same root. Production path guards are unchanged. Local acceptance repeats all twelve stages using an actual Windows 8.3 Temp alias. The push job separately timed out in the unchanged five-second F23 publication and F25 SQLite tests; the parallel PR job passed those tests. Both original failures remain visible in runs [37260608088](https://github.com/bryant-collab/PRMonitor/actions/runs/37260608088) and [37260611946](https://github.com/bryant-collab/PRMonitor/actions/runs/37260611946); the corrected published head requires its own CI verification.

Native acceptance additionally checks all six final-review panes, 600 actual changed diff lines including the last line, worktree refresh, empty conflict-answer guarding, missing targets for every saved-work/PR kind, production rejection of publication without approval, and historical uncertain publication with reconciliation available and publication withheld. Fixed fixture preparation creates only local owned Git commits before the application effect guard; the application performs no commit/push, model call or unexpected network request.

The real Electron Tray's actual MenuItem callbacks reopen the closed window and run Shutdown. Shutdown persists COMPLETED, removes its tray and calls ordinary app.quit. Saved review/sync records compare unchanged before/after shutdown and cold restart. Native Home/End/arrow keys keep selected detail tabs and focus aligned; tablist/tabpanel relationships are exposed. The native accessibility tree contains named controls/headings. These checks do not simulate screen-reader speech or a physical taskbar click.

`node tests/installer-e2e.mjs` builds NSIS with `--publish never`, installs version 0.1.0 into an owned Temp prefix, upgrades to 0.1.1, checks actual saved review history plus a real SQLite settings record including version/timestamps, and launches the installed production app through sandboxed smoke after each install. [Results](installer-results.json) record its checksum and scope. Existing PRMonitor desktop/start-menu shortcuts were found, so the test uses a unique app identity with shortcuts disabled. It uninstalls only that test identity and validates the marked Temp root before cleanup. This does not certify an upgrade of an existing customer installation or shipping shortcut behavior.

Remaining physical acceptance is Windows DPI 125/150/200%, independent text scaling, screen-reader speech and Windows taskbar interaction. The selected execution exposes no desktop-control tool; native display scale is actually 1. No OS display/accessibility setting was changed. Chromium zoom and forced-color emulation are reported separately. Existing customer data and shortcuts remain untouched.

The 82 bridge operations and 174 original controls are mapped in [control-inventory](control-inventory.md). Native journeys exercise the main destinations and ownership/guard regressions; existing F13–F27 integration suites verify controlled provider, validation, discard, publication and retry effects. Source mapping alone does not certify every conditional control at every historical state. No live provider/publication acceptance is claimed under the no-contact/no-publication scope.

Ubuntu-latest still fails before application JavaScript with SIGTRAP/SANDBOX_SETUP_FAILED, also seen in baseline run 37238773164. Read-only diagnostics show restricted user namespaces and an unconfigured setuid helper; they do not establish a sole cause. The authorized separate Ubuntu 22.04 experiment at `27753dc` passes sandboxed production startup/accessibility smoke; both jobs subsequently fail the unchanged contract requiring ubuntu-latest. The pin is not adopted, and no gate is weakened. [The detailed matrix](remaining-acceptance.md) preserves every experiment failure, namespace comparison and temporary retirement constraint. Windows exact-head CI remains the production platform gate; the Ubuntu failure stays visible.
