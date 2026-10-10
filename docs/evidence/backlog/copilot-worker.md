# Copilot supervised SDK worker

## Authorized result and verified admission

The pinned Copilot SDK's public forced stop does not provide a descendant-tree
cleanup receipt. PRMonitor must own a worker outside the SDK, establish Windows
Job ownership before SDK initialization, and await process cleanup before
releasing its saved connection. This implements the approved supervised-worker
design. The temporary Copilot task admission gate was removed after hosted
Windows native, packaged and desktop acceptance passed on
`ef1b79928b76b0e59de7290f7f299f1e99688b47`, with fresh independent review.
Ownership, permission and cleanup failures still fail closed at runtime.

SDK 1.0.13, subscription authentication, existing sign-in selection, fixed
stdio launch options, and operation-scoped file tools remain unchanged. No SDK
private field, alternate TCP listener, runtime download, real provider request,
security change, release, or merge is part of this work.

## Lifecycle and permissions

`CopilotProcess` creates an unnamed noninheritable Windows Job with
`KILL_ON_JOB_CLOSE` and no breakaway flags before launching the Node-mode Electron
worker. The bootstrap loads only its protocol and native bridge. It reports PID
and creation time over its application-owned IPC channel. The owner opens that
PID, compares creation time, assigns it, verifies membership and exactly one
active process, then sends activation. Only activation dynamically imports and
initializes the SDK. Failed ownership cannot start the SDK. Bootstrap IPC loss
or an unactivated bootstrap deadline terminates the bootstrap.

The worker uses the SDK's public stdio/session APIs. Session restrictions are
reconstructed from a bounded operation descriptor rather than transporting
callbacks or arbitrary SDK options. Permission requests remain deny-only.
Pre-tool hooks ask the original host path guard for a boolean decision, bound
to the operation scope, canonical directory and bound session ID. Unknown or
changed scope/session/directory, thrown validators, oversize messages,
timeouts, cancellation, and late/replayed replies cannot grant authority.
Messages are capped at 2 MiB, permission packets at 256 KiB, outstanding
requests and validators at 32, and permission decisions at three seconds.
Timed-out validators remain charged until their actual promise settles.

SDK abort/disconnect/stop is advisory. Closure rejects pending requests, clears
scope authority, bounds graceful SDK stop, terminates the OS owner, awaits the
owned worker's public `close` event and zero active Job processes, then closes
the Job handle. Partial assignment failure still cleans both the Job and the
possibly unassigned child. Unconfirmed cleanup retains the Job handle and the
connection lease, quarantines that connection, and rejects queued/subsequent
work until restart. Standalone Copilot checks serialize under the same saved
connection lease; task checks run inside their already-held lease.
The standalone check's 15-second deadline includes waiting for that lease and
resolving the provider home. A timed-out queued check launches no provider and
cannot release the running task's ownership. Cancellation before a SDK wait
still observes any later rejection from the already-started promise.

Application quit closes worker admission even when the current worker set is
empty, and drains registered workers before continuing. Owner crash
closes the noninherited Job handle and kills its assigned descendants. POSIX
uses an owned process group and confirms no running group members after worker
closure; Linux zombie entries are not running processes. This POSIX guarantee
covers ordinary inherited SDK descendants, not arbitrary process-group escape.

## Fixture acceptance

`copilot-supervisor.test.ts` runs the real pinned SDK against synthetic stdio
programs in disposable Temp roots, without Copilot installed or provider access.
The runtime spawns a child and grandchild that ignore termination and retain
streams; an independent heartbeat must stop before cleanup resolves. Cases
cover fresh/resumed sessions, unchanged safety options, auth/model projection,
scoped inside/outside/drift/oversize permissions, callback errors/timeouts and
cap saturation, startup/task cancellation, stop hangs, early runtime exit,
worker crash, owner crash before and after assignment, partial/native ownership
failure, uncertain accounting, and application shutdown admission.

Windows-only cases verify creation-time mismatch rejection, native Job counts
covering all four worker/runtime/descendant processes, zero accounting before
handle release, and the actual packaged Electron worker/native bridge. A
packaged SDK probe waits for assignment before importing the packaged public
SDK module. These fixtures test packaging and lifecycle, not a live user's
Copilot subscription or provider responses.

`subscription-provider-adapters.test.ts` drives real supervised workers through
the production adapter during startup/task cancellation and verifies queued
work receives the lease only after all descendants have stopped. An uncertain
cleanup test verifies quarantine and rejection of queued/subsequent ownership.
`codex-app-server.test.ts` verifies standalone-check serialization and quarantine
occurring during deferred home-directory resolution.

Initial Windows evidence at `97e548805e4b317d80dc19f346bb6aa902fc2a94`:
[PR foundation run](https://github.com/bryant-collab/PRMonitor/actions/runs/38014968210)
executed all 20 worker cases successfully, including the three Windows-native
cases; desktop totals were 562 passed and one unrelated platform skip. Its
shipping installer acceptance and Ubuntu foundation jobs passed. The Windows
foundation job subsequently failed in the controlled-provider startup fixture:
its separate esbuild bundle relocated Koffi away from its native binary. The
fixture now preserves the real native wrapper as an external absolute module;
normal shipping packaging is unchanged. These initial results did not constitute
a green final build.

Gated implementation `ef1b79928b76b0e59de7290f7f299f1e99688b47` passed
[PR CI](https://github.com/bryant-collab/PRMonitor/actions/runs/38015853640)
and [push CI](https://github.com/bryant-collab/PRMonitor/actions/runs/38015851568):
Ubuntu foundation, Windows foundation and shipping installer acceptance. Windows
executed all 22 worker tests and 565 desktop tests, with one unrelated platform
skip. Every startup/restart/conditional-provider stage passed. Earlier attempts
hit unchanged five-second worktree/recovery test deadlines and a 15-second
conditional-review startup deadline (window created at 16.523 seconds, 842
SQLite commits totaling 15.400 seconds). Same-commit retries passed without
changing those tests, timing assertions, database code or security settings.
Independent review confirmed the startup miss precedes the changed controlled
provider entry, and worker registration triggers no startup database work.
The final enabled-source commit must pass its own normal CI as well.

## Safe focused Windows procedure

After the coordinating parent approves fetching the identified PR10 commit,
use an isolated checkout of `codex/ai-connections`. Preserve any local changes.
Check Node 24.19.0, npm 11.17.0 and repository-supported Git/dependencies first.
No Copilot installation, sign-in, app installation or user profile cleanup is
needed. From the repository root:

```powershell
npm run check:runtime
npm run build:validation-contract
npm run build:desktop
npm --workspace @prmonitor/desktop run package
npm --workspace @prmonitor/desktop run test -- tests/copilot-supervisor.test.ts tests/subscription-provider-adapters.test.ts tests/codex-app-server.test.ts
```

Packaging creates an unpacked review artifact in this checkout, without
publication or installation. It is required for the packaged-worker test.
Fixtures create and remove only their own canonical Temp directories. Expect
every Windows-native case to execute, all owned PID/heartbeat assertions to
pass, no provider/network calls, and no surviving fixture processes. Record the
exact source commit, command exit status and test totals. Do not run the
shipping-identity installer harness on a user account; it requires a disposable
GitHub-hosted runner.

The normal Windows PR foundation check runs these tests after its shipping
package build. Exact-head hosted Windows CI and fresh independent review are
required for Copilot task admission. Actual user-PC/provider
subscription acceptance remains distinct and must not be inferred from these
synthetic fixtures.
