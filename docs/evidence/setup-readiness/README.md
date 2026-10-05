# Resumable startup setup evidence

Implements [issue #1](https://github.com/bryant-collab/PRMonitor/issues/1) using authoritative F03/F05/F13/F15/F16 configuration. No setup-completed flag or shadow credentials/profiles are persisted. Relevant F04/F15/F16 specs contain issue supplements; the existing credential, filesystem, publication and lifecycle owners retain their authority.

## Automated verification

`npm run check` runs the pinned runtime check, release regression tests, validation-contract tests, desktop types/lint/format/build, production Windows artifact smoke, desktop regression tests and spec-linter tests. `npm run test:setup` then imports built production main/preload/renderer and runs the bounded Electron journey documented in `tests/setup-e2e-README.md`. Windows CI runs both commands.

| Acceptance area | Evidence |
| --- | --- |
| Five mandatory checks, optional settings excluded | setup-readiness tests: Git/storage/root, secure-store availability, usable verified credential revision, registered provider/local auth, four enabled AVAILABLE profiles, task/model/options/policy compatibility. |
| Failures, current state and stale responses | setup-local-prerequisites, setup-readiness, setup-ipc and setup-renderer tests: malformed/unsafe/missing roots, unavailable provider, bounded reads, rejected payloads, out-of-order reads/events, Retry and cancelled/disposed readers. |
| Existing GitHub.com/GHES behavior | F05 regression suite plus real application service saves with controlled GET identity fixtures. Extra failing profiles do not block a usable one; transient network/rate-limit/timeout does not erase previous verification; confirmed auth errors do. |
| Durable task/policy settings | F16 regression suite plus separate process restart after one committed profile; completion saves all four independent profiles. Read-only and unsupported mutating policies cannot claim readiness. |
| Default setup, empty inbox and inspection | Fresh, partial, completed, ready restart and lost-auth Electron stages; painted screenshots accompany results. |
| Explicit targets and lifecycle | Lost-auth explicit review target wins over default setup with attention banner; HOME returns to setup. Existing F04/F19/review suites retain lifecycle/content coverage. Recovery retry serializes the latest accepted target; ordinary reads never restart. |
| Bootstrap failure without data reset | Real obstructed database-directory fixture: recovery-only setup, preserved obstruction bytes, no admitted domain work, coalesced explicit retry, healthy startup after external repair. |
| No unintended work | Electron harness blocks unexpected network, Codex subprocesses and Git commit/push; every stage requires zero forbidden effects. Projection tests spy on provider invocation. Setup does not pause scheduling or cancel operations. |
| Keyboard and narrow layout | Heading focus, live status, disabled readiness action, labeled Tab target, 720px window and Chromium 125% zoom with unclipped action geometry. |

`results.json` contains per-stage assertions and an opaque isolated-data identity. Screenshots show actual painted results. The runner removes only its marked temporary root after bounded process cleanup; proof remains readable outside that root. Fixtures contain fixed nonsecret values; real app data and credentials are never used.

Meaningful failing-before regressions were observed for missing provider preflight, unsafe roots and the incompatible Read-only mutating policy, followed by passing-after runs. This report does not use the specification linter as application behavior proof.

## Remaining manual coverage

Chromium zoom proves reflow, not physical Windows display scaling or native window chrome. In a disposable Windows profile, check 125%, 150% and 200% display scaling at a narrow supported window width; confirm the five statuses, remediation links, Retry and Open PR inbox remain visible/reachable without horizontal clipping. Exercise a screen reader through setup heading, live updates, validation/error focus and completion.

The automated explicit-target fixture now opens a real persisted historical review, enters an unsaved answer, navigates Home to incomplete setup and returns to the exact saved review. The answer survives without an AI/publication action. The separate shell stage covers twenty persisted PRs, sync-selection independence, unsaved PR context across Activity navigation, default empty PR Activity and genuine application diagnostics. DOM flash observation begins when the preload bridge becomes available; renderer coordination tests independently cover initial loading. Full final-review/sync/publication native journeys and screen-reader interaction remain separate acceptance work.

Physical DPI/text scaling, screen-reader speech and Windows taskbar clicks remain unverified because this execution environment exposes no desktop-control tool. [Additional review and installer evidence](../backlog/review-fixes.md) records completed guarded review/sync/settings, native lifecycle, retained restart and isolated NSIS acceptance. Source/control inventory is separate from proof of every conditional historical state. No legacy checklist entry was invented or closed.
