# Startup recovery work and bounded observations

The original main-process F28 owners discovered one recovery scope per managed
PR, but each scope called global `reconcileStartup()` methods that scan all
durable work. With the unchanged 22-PR acceptance fixture, local diagnostics at
`656b518c9953538b472deea337eefce6ca00b405` measured 163 Git probes, first window
at 5,189 ms, and 133 completed recovery scopes. No descendant process remained
after any of the fifteen stages. This identifies repeated work; it does not
establish a sole cause for every previously observed CI or production smoke
failure.

F28 now supports an explicit session reconciliation phase. The six production
owners perform their global scan once per owner within the recovery execution;
per-PR outcome generation, attempts, attribution, retries and persistence remain
individual. The session-local promise retains a failure for every affected
scope and is discarded when execution returns. Offline owners never run either
phase. Neither phase grants provider invocation, publication, force push,
arbitrary commands or worktree replacement.

The same local native fixture now measures 16 Git probes, first window at
1,013 ms, and the same 133 completed scopes. All fifteen stages pass with the
existing 15-second wait, 55-second child and 65-second parent deadlines. Native
restart/settings checks bound the Git probe count; integration tests verify
twenty independent PR outcomes, a fresh scan on wake, failure propagation and
offline refusal. Aggregate: 430 desktop, 43 contract, 17 spec-linter and 16
release tests pass, along with types, lint, format, artifact build and the
separate sandboxed production startup/accessibility smoke.

At `85d6697282c28308f49ac15dbbaea3b18c8e2a14`, both the
[PR Windows job](https://github.com/bryant-collab/PRMonitor/actions/runs/37269333527/job/111632779119)
and [push Windows job](https://github.com/bryant-collab/PRMonitor/actions/runs/37269330282/job/111632769367)
pass aggregate and all fifteen native stages. Retained-restart/settings first
windows appear at 5,548/6,400 ms in PR CI and 4,773/6,043 ms in push CI; each uses
16 Git probes and completes its unchanged 121/133 scopes. Every stage closes
with zero observed owned descendants.

The preceding `656b518` failures remain evidence: push CI reached recovery
LOCAL_WORK with 41 of 121 scopes complete and no window at 22,203 ms; PR CI
completed 133 scopes but created the settings window at 27,670 ms, after its
existing wait expired. Its settings process ran 161 Git probes. Memory was
available and preceding children left no observed descendants. The new head's
two passing jobs support the bounded repeated-work fix without identifying a
sole cause for all earlier failures.

CI logs emit closed event/status labels, numeric timings/counts and aggregate
memory/process observations. The process audit collects only PID ancestry,
creation time, name and working set, publishes only aggregate kinds, and does
not terminate descendants or inspect command lines, paths or credentials.
Raw application output remains bounded inside the verified test-owned Temp
root. These diagnostics do not widen any gate or suppress a failed stage.

At `146015a2fe5bc0525d33156a193eca73708fc738`, the
[PR Windows job](https://github.com/bryant-collab/PRMonitor/actions/runs/37271857070/job/111640356298)
passes aggregate and all sixteen native journeys. The
[push Windows job](https://github.com/bryant-collab/PRMonitor/actions/runs/37271853388/job/111640344560)
passes aggregate and its first nine stages, then fails waiting for native
Shutdown completion. At failure the window had reopened, recovery completed
121 scopes, all 24 Git processes had exited and closed, and no owned descendants
remained afterward. This is a separate lifecycle observation; its cause is not
established from that job. New read-only diagnostics expose only known persisted
F04 phases and F19 shutdown states/reasons, with a privacy regression. The native
test now fails immediately on an observed recovery-required state and still
requires successful Shutdown, COMPLETED persistence and retained history.

At `608bc25db1d637be14d63661511a47f5b62514c4`, the
[PR Windows job](https://github.com/bryant-collab/PRMonitor/actions/runs/37272722780/job/111642977539)
passes aggregate and all seventeen native journeys. The
[push Windows job](https://github.com/bryant-collab/PRMonitor/actions/runs/37272716150/job/111642958989)
passes aggregate and Shutdown, then fails waiting for the Add-stage window.
At 15,824 ms, recovery was LOCAL_WORK with 41/121 scopes complete; all eight
observed Git processes had closed (longest 50 ms), and no window existed.
F04 was RUNNING, the previous F19 shutdown was COMPLETED, free memory was about
13 GB, and the post-close audit found no descendants. This does not identify
the remaining wait. The subsequent harness observes owned filesystem promises
and SQLite run/get/all/exec timing, including transaction calls, using fixed
method labels only. Observation preserves return values and errors; it records
no paths, statements, identifiers or stored values. No deadline, startup gate,
security setting or product behavior changes.
