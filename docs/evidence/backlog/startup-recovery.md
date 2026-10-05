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

At `c60230e8198a8939b0161faaec9df0dc22211fe4`, both
[PR Windows](https://github.com/bryant-collab/PRMonitor/actions/runs/37275706059/job/111652142213)
and [push Windows](https://github.com/bryant-collab/PRMonitor/actions/runs/37275700227/job/111652123188)
pass aggregate and all eighteen native stages, including guarded discard and
re-evaluation previews/cancellation. Retained windows are created at 3,978/4,441
ms, Add at 4,140/4,321 ms, and settings at 4,284/5,020 ms (PR/push). All recovery
scopes complete; post-close audits observe zero descendants. The bounded I/O
observations show settings SQLite exec totals of 3,203/3,939 ms, longest
285/318 ms; filesystem operations and Git closes are much shorter in these
passing jobs. SQLite transaction calls are an observed contributor to startup
time, but these passes do not prove the cause of the earlier stalled runs.
No durability setting, transaction order, deadline or assertion changes.

At `06f44d1d872e7efcf1a95f9d2e723277db7592a2`, the
[PR Windows job](https://github.com/bryant-collab/PRMonitor/actions/runs/37281781644/job/111671284419)
passes aggregate and all eighteen native journeys. The
[push Windows job](https://github.com/bryant-collab/PRMonitor/actions/runs/37281776731/job/111671270168)
fails two unchanged aggregate tests at their existing five-second deadlines:
F03 durable-family round-trip takes 8,340 ms and F13 detached-worktree
preparation/idempotent replay takes 5,016 ms. Native acceptance never starts
in that push job. These are genuine failed tests, not dependency blockers.
The added dirty-handoff regression and cancellation completion test pass.

Vitest 5.0.1 derives file workers from available CPU count by default. The
desktop script first explicitly bounded file workers to two to reduce competing
Git processes and synchronous durable SQLite fixture I/O. Every test, assertion,
explicit concurrency scenario and existing deadline stays unchanged; no
transaction durability setting changes. Parallel fixture load is a plausible
contributor, not a proven sole cause of the earlier startup or aggregate stalls.
The failed job remains visible, and new exact-head aggregate/native CI must pass
before claiming the bounded run is successful.

At `c412f0bbd3758895291da088aac805d3c6dbf782`, the two-worker
[push Windows job](https://github.com/bryant-collab/PRMonitor/actions/runs/37282814451/job/111674609317)
fails three existing five-second aggregate cases: Activity filtering/pagination,
F13 Clear All/ignored-file preservation, and F13 durable recreation/released
mutation. The
[PR Windows job](https://github.com/bryant-collab/PRMonitor/actions/runs/37282820841/job/111674629590)
passes aggregate but fails the provider fixture's clean checkpoint: fixture Git
status is empty while production F13 reports UNATTRIBUTED_CHANGES. Its first
window appears at 6,424 ms, all 133 recovery scopes complete, and no owned
descendants survive; SQLite exec totals 14,800 ms with one 8,117-ms call.
This native failure is an assertion mismatch, not a widened startup deadline.

The owned Git fixture now commits `source.ts text eol=lf` in `.gitattributes`.
Fixture restore inherits system Git configuration; F13 excludes it. An isolated
reproduction with differing autocrlf policies and invalidated stat cache produces
CRLF bytes that one policy considers clean and the other dirty; repository
attributes restore LF bytes that both consider clean. No product Git policy or
worktree guard changes. Desktop file workers are now bounded to one as an
isolation experiment; explicit concurrent scenarios and all deadlines remain.
Both preceding failures remain evidence, and new exact-head CI is required.

At `c7a3a0dca4cf1d4aa7dcaf42b950a59770b4ddb1`, both
[push 37295102283](https://github.com/bryant-collab/PRMonitor/actions/runs/37295102283)
and [PR 37295109933](https://github.com/bryant-collab/PRMonitor/actions/runs/37295109933)
pass Windows aggregate and the first eighteen native journeys, then refuse the
publication fixture's initial F13 snapshot. The Ubuntu 22.04 jobs pass normal
installation and build checks and reach application JavaScript, then fail the
production accessibility probe. These failures remain required failures.

The follow-up reuses the accessibility probe's existing ten-second deadline to
wait for actual Add form readiness instead of a fixed 50-ms delay, and reports
only closed diagnostic categories for semantics, keyboard and forced colors.
It preserves every assertion and the parent smoke deadline. The owned native
fixture also reports the F13 refusal category and worktree classification without
private paths or content. A local checkout with command-local `core.autocrlf=true`
passes the focused ten-stage matrix; this does not confirm the CI root cause.
Product worktree guards, Git isolation and security settings are unchanged.

At `8ee3addf454faa61962b5937cb97cbeac2b36529`, the
[PR Ubuntu job](https://github.com/bryant-collab/PRMonitor/actions/runs/37297436822/job/111721889341)
passes aggregate and sandboxed production accessibility smoke; the
[push Ubuntu job](https://github.com/bryant-collab/PRMonitor/actions/runs/37297432909/job/111721876773)
fails the retained native keyboard assertion. The follow-up observes real
renderer focus after the same single Tab and Enter inputs, sharing the original
ten-second accessibility deadline instead of assuming one main-process event-loop
turn processes native renderer input. It neither assigns the expected focus
targets nor retries input to bypass the assertion.

The [PR Windows job](https://github.com/bryant-collab/PRMonitor/actions/runs/37297436822/job/111721889693)
passes aggregate and eighteen native stages, then reports
`WORKTREE_CONDITION_UNVERIFIED:UNATTRIBUTED_CHANGES:ATTRIBUTES_CRLF` for the
publication fixture. The fixture now pins `.gitattributes` itself to LF as well
as `source.ts`, exercises a command-local autocrlf checkout, and invalidates the
stat cache without changing bytes before production F13 inspection. Local full
Git and checksum-verified CI MinGit alone both passed the focused matrix before
this fix; the basic checkout reproduction confirms LF in the committed attribute
blob and CRLF in its worktree representation. CI proves the refusal and CRLF
observation; its precise cache-timing trigger is not established. No dirty-state
acknowledgment, F13 guard or product Git policy is changed. New exact-head required
Windows and Ubuntu push/PR runs must pass.

At `0ec6df65b10bcb9f12cd709ac291ab25614eb766`, both required Ubuntu jobs
pass. The [PR Windows aggregate](https://github.com/bryant-collab/PRMonitor/actions/runs/37298509661/job/111725382762)
passes 431 of 432 desktop cases and times out the existing untracked-file
content-change F13 test at its original 5,000-ms deadline. The push Windows
aggregate and all twenty-one native acceptance stages
[pass](https://github.com/bryant-collab/PRMonitor/actions/runs/37298504027/job/111725364853).
The owned unit fixture now supplies its synthetic identity
through child-process environment variables instead of two repository config
commands, and reads both immutable fixture revisions with one Git log command
instead of two rev-parse commands. This removes three redundant setup launches
per fixture. Real F13 commands, SQLite durability, assertions, isolation, test
count and deadlines remain unchanged. This is a bounded fixture-cost reduction,
not proof of a sole timeout cause; the failed run remains evidence.

After PR #4 merged at `8ce96f150261f34b46bd118e6469279a0f3a6d65`,
[post-merge run 37311380458](https://github.com/bryant-collab/PRMonitor/actions/runs/37311380458)
passes Ubuntu but Windows fails `ACCESSIBILITY_KEYBOARD_FAILED` before native
acceptance. Publication is withheld while this required gate is repaired.
The smoke probe now waits for the Add route's actual heading focus, then
observes the owned native window and document focus before sending one Tab
and one Enter. The temporary body's focusability is retained until input
completes and removed in `finally`. The original ten-second accessibility and
parent smoke deadlines, semantic/forced-color assertions, and sandbox remain
unchanged. Only closed focus/Tab/Enter categories may leave the child process;
the privacy contract checks them. Electron's pinned API requires its containing
BrowserWindow to be focused for native input. The preceding failure does not
establish whether native focus, route focus or navigation starting position
caused it, and remains evidence rather than a discarded retry.
