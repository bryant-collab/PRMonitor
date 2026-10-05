# Temporary Ubuntu runner compatibility pin

Bryant approved adoption on 2026-10-05. Linux CI uses `ubuntu-22.04` temporarily;
Windows remains `windows-latest`. Both jobs retain normal `npm ci`, all pinned
runtime/dependency versions, aggregate tests, production artifact smoke and
failure gates. Production smoke requires Electron sandboxing. No host sysctl,
setuid-helper permission, credential, dependency installation mode, sandbox
flag or deadline changes are included. No job is optional.

The isolated experiment branch `codex/ubuntu22-compat-check`, commit
`0b13e9738f20c25955333fc39114d54000de0a7e`, retained the failing actual
`ubuntu-latest` job and added a required Ubuntu 22.04 job. In
[run 37267725882](https://github.com/bryant-collab/PRMonitor/actions/runs/37267725882),
Ubuntu 22.04 passed the aggregate and sandboxed production startup/accessibility
smoke; the same dependencies on `ubuntu-latest` failed before application
JavaScript. Earlier experiment `27753dc` passed smoke but failed the unchanged
literal runner contract. The adopted contract explicitly checks the approved
temporary matrix and rejects optional jobs, `--no-sandbox` and `--ignore-scripts`.

The inherited failure appears in [baseline 37238773164](https://github.com/bryant-collab/PRMonitor/actions/runs/37238773164)
and both jobs at `e783f4c`: [37285009333](https://github.com/bryant-collab/PRMonitor/actions/runs/37285009333)
and [37285004953](https://github.com/bryant-collab/PRMonitor/actions/runs/37285004953).
Read-only diagnostics observed restricted user namespaces and an unconfigured
setuid sandbox helper on the failing image. This establishes runner compatibility,
not a definitive single cause or a resolution of `ubuntu-latest`.

GitHub [announced deprecation beginning 2026-09-17 and retirement on
2027-04-17](https://github.com/actions/runner-images/issues/14254). Replace the pin
before the March 2027 brownouts and remove it before retirement. [Follow-up #5](https://github.com/bryant-collab/PRMonitor/issues/5):
reproduce the failure in an isolated supported current Ubuntu image, identify
a sandbox-compatible dependency or runner arrangement, then require normal clean
`npm ci`, unchanged aggregate and sandboxed production smoke on that image.
Preserve failures and diagnostics; do not make Linux optional or weaken privilege
gates. Verify green exact-head Windows and Linux push/PR runs for adoption.

This approved exception supersedes the literal `ubuntu-latest` label in F01
AC-17, FR-05.6 and TST-08 for this bounded period only. Their command, security,
clean-install, failure and evidence requirements remain mandatory.
