# Setup acceptance journey

From the repository root, after dependencies are installed:

```powershell
npm run build:validation-contract
npm run build:desktop
node tests/setup-e2e.mjs
```

The harness imports the **built production main process**, uses its real preload,
renderer, readiness services and SQLite persistence, and makes configuration
changes through validated preload IPC. It does not add a product bypass flag.
Six setup Electron processes exercise fresh installation, interrupted setup,
completion, ready restart, prerequisite loss, and blocked initialization followed
by external path remediation. UI actions inspect setup from
Settings, open the empty inbox, and route an explicit review target before HOME.
The fresh journey closes and reopens the production window after one committed
profile; prerequisite loss also reloads the renderer before target navigation.
One additional shell process seeds twenty real managed PRs in the owned fixture,
pauses watching before production startup and verifies inspection, sync selection,
draft retention, Activity views, desktop/narrow/zoom layout and forced colors.
Five more processes cover exact sync-result navigation and draft ownership,
complete owned Git diff and guarded final review, independent task-setting
drafts, native tray/Shutdown, retained cold restart and historical uncertain
publication. Three more processes submit actual Add requests, exercise proposal
decision/input/conversation guards, and create/reorder/revise/delete owned
instructions plus save repository guidance. The exact eighteen-stage assertions
are in the evidence JSON. The conditional proposal uses a fixed historical F22
observation, not a live remote check; owning decision/input guards remain active.

The guarded Git fixture creates a baseline commit and registered operation-owned
source/worktree before the application effect guard is installed. Once production
main starts, Codex subprocesses, commit/push and unexpected network are forbidden.
Historical approval/outcome fixtures never issue an external effect. Native
MenuItem callbacks exercise the real tray adapter; actual Windows taskbar clicks,
physical DPI/text scaling and screen-reader speech remain separate tooling limits.

For isolated local NSIS acceptance after the desktop build:

```powershell
node tests/installer-e2e.mjs
```

This uses a unique test app identity and disables shortcuts to protect any
existing PRMonitor installation. It installs/upgrades an owned Temp prefix,
preserves a real SQLite record, runs installed sandboxed smoke, uninstalls its
own identity, and validates ownership/path boundaries before temporary cleanup.

Every run creates a marked temporary directory and isolates Electron user data,
session data and home before importing main. Windows bootstrap keeps its required
account path environment entries; the app never opens that account's PRMonitor
data. The parent strips secret-shaped environment variables.
GitHub.com and GHES return controlled GET identity fixtures; the Add stage also
allowlists exactly two fixed PR metadata GETs. All other fetches fail. The local
auth preflight uses a fixed nonsecret fixture value. Codex
subprocesses and Git commit/push are denied. The shell fixture pauses watching before startup; the
scheduler cannot poll or dispatch the fixture PRs. Screenshots and safe assertions are written to
`docs/evidence/setup-readiness`; private child diagnostics stay inside the
marked temporary directory until cleanup. Each child has a bounded timeout and
can terminate only its own process tree. Before deleting its temporary state,
the runner verifies the ownership marker, temporary-directory containment, and
absence of reparse points. Evidence contains an opaque hash of the isolated data
root. It never accesses real app data or credentials.

The runner resolves Windows short-path Temp aliases before marking or persisting
owned paths. Its children receive canonical Temp inputs, and cleanup checks the
same canonical temporary root. This retains production path-movement guards;
an actual 8.3 Temp alias is included in local Windows acceptance.

The installer also canonicalizes Temp and propagates that path to every owned
child. Its bounded smoke reader requires the nonce-bearing ready marker after
both output streams close. Public failures use fixed labels/digests; private
diagnostics remain only in marked local Temp. Focused release tests verify
privacy, timeout/output bounds, marker matching and alias propagation.

The initialization fixture obstructs the owned database directory with a file.
Readiness reads do not trigger relaunch. Two explicit retries coalesce into one
relaunch request, intercepted only by the harness, and leave obstruction bytes
unchanged. The parent repairs the fixture and launches a separate process to
confirm normal setup resumes. Normal production IPC and UI handle the failure;
no failure-only product environment flag is introduced.

Limits are recorded alongside results: DOM flash observation starts after the
renderer bridge becomes available; unit coordination tests cover initial
loading. The lost-auth journey loads a real saved review through production
persistence, edits an answer, and checks that Home/return retain the unsaved
answer. This fixture is not a managed polling target. Chromium 125% zoom
is a reproducible reflow check, not physical Windows DPI verification. Service
and renderer tests provide the independent prerequisite/failure matrix.

Three additional stages cover controlled provider answer/usage/explicit transfer, historical Activity scope/filter/pagination/disclosure, and guarded discard/re-evaluation previews and cancellation. Provider and F22 stages use a test-owned build of the same production main sources with only the F15 provider and F22 remote-read effect ports replaced, plus a delegating observational F21 wrapper. The other sixteen use ordinary production main. Actual F11 holds, F13 worktrees, typed IPC, persistence and domain guards remain active. See docs/evidence/backlog/conditional-provider.md and conditional-f22.md. Read-only lifecycle diagnostics publish only known phases/reasons and never persisted session identifiers. Bounded I/O observations retain original promise/value/error objects, aggregate only fixed filesystem/SQLite method names and timings, and never record paths, SQL or data.
