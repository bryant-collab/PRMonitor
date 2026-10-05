# Setup feature map

| User feature | Entry points | Executed drive | Observable evidence |
| --- | --- | --- | --- |
| Resume setup from committed state | StartupApp, SetupScreen; setup.read | fresh and partial Electron launches | Setup focus, five bounded checks, no ready inbox flash after bridge attachment, committed profile survives cold restart. |
| Complete required configuration | Preferences, GitHub server editor, SetupReadinessService | four independent task saves; GitHub.com/GHES fixture connections | Five complete checks, Open PR inbox, zero-PR No pull requests yet/Add PR. |
| Inspect setup without losing views | Settings > Setup, explicit open targets, HOME | ready restart and lost-auth launches | Ready data skips setup; explicit review target wins with attention banner; HOME returns to setup. Saved-review content remains covered by the existing review suites. |
| Recover failed local startup safely | main bootstrap recovery shell, setup.retry | obstructed database directory and repaired fresh launch | Bounded error, original bytes preserved, ordinary reads do not relaunch, repeated explicit retry coalesces, no normal services or external actions admitted. |
| Reject stale or unavailable readiness | renderer reader, typed IPC, local/provider ports | setup renderer/IPC/readiness/local tests | Out-of-order updates cannot regress state; invalid payloads and incomplete mandatory prerequisites cannot become ready. |

The project native test recipe is `tests/setup-e2e-README.md`. The evidence directory contains results and screenshot pairs. Physical DPI and screen-reader interaction require a native manual run; Chromium 125% zoom is reflow evidence only.
