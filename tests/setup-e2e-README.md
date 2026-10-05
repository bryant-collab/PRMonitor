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

Every run creates a marked temporary directory and isolates Electron user data,
session data and home before importing main. Windows bootstrap keeps its required
account path environment entries; the app never opens that account's PRMonitor
data. The parent strips secret-shaped environment variables.
GitHub.com and GHES return controlled GET identity fixtures; all other fetches
fail. The local auth preflight uses a fixed nonsecret fixture value. Codex
subprocesses and Git commit/push are denied. The shell fixture pauses watching before startup; the
scheduler cannot poll or dispatch the fixture PRs. Screenshots and safe assertions are written to
`docs/evidence/setup-readiness`; private child diagnostics stay inside the
marked temporary directory until cleanup. Each child has a bounded timeout and
can terminate only its own process tree. Before deleting its temporary state,
the runner verifies the ownership marker, temporary-directory containment, and
absence of reparse points. Evidence contains an opaque hash of the isolated data
root. It never accesses real app data or credentials.

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
