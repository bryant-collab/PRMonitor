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

CI logs emit closed event/status labels, numeric timings/counts and aggregate
memory/process observations. The process audit collects only PID ancestry,
creation time, name and working set, publishes only aggregate kinds, and does
not terminate descendants or inspect command lines, paths or credentials.
Raw application output remains bounded inside the verified test-owned Temp
root. These diagnostics do not widen any gate or suppress a failed stage.
