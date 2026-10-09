# Windows executable branding

The shipping configuration disabled both Windows resource editing and signing with
`win.signAndEditExecutable: false`. In pinned electron-builder 26.15.3,
`WinPackager.signApp` returns before `signAndEditResources` in that case. The
result retains Electron version resources. Enabling resource editing while
retaining `signExecutable: false` and `forceCodeSigning: false` applies PRMonitor
metadata and keeps the executable unsigned. Application ID, executable name,
installer GUID and shortcut settings are unchanged.

Regression evidence uses the actual shipping YAML and pinned WinPackager to edit
an inert synthetic PE carrying Electron metadata; no Windows program is run.
The resulting product name, file description, internal name, cleared original
filename, string versions, numeric versions and absent certificate table are
asserted. Missing resources and wrong strings/numeric versions/certificate data
are rejected. Windows packaged smoke reads the actual executable resources; the
existing disposable Windows installer acceptance checks candidate and upgrade
metadata after installation. Preview.2 fixtures intentionally retain their old
branding.

Cloud Linux validation on 2026-10-09:

- `npm run test:release`: 23 passed on the final run, including the shipping NSIS
  template compile and new PE regression tests. An earlier concurrent run had a
  Node test-worker deserialization failure; focused and full reruns passed.
- `git diff --check`: passed.
- `npm run check`: stopped at the unchanged runtime gate because this environment
  has npm 11.9.0 and Git 2.52.0; required versions are npm 11.17.0 and Git 2.55.0.
  Node 24.19.0 matches. No gate was disabled.

Windows-native packaging, executable startup and installed metadata acceptance
are not established by these Linux checks. Existing Windows PR CI must pass on
the final pushed commit; it installs the pinned tools, runs aggregate checks,
packages the unsigned shipping installer and tests only a disposable hosted
account. No release is published and no user's installation is changed.

The first pushed commit's Windows and Ubuntu jobs reached desktop tests after
successful build/package/smoke. Their only desktop test failure was the old
foundation assertion that resource editing must be disabled. That contract now
requires editing enabled and executable signing disabled. Windows installed
acceptance was skipped after that failure and still needs a passing final run.

On commit e20485cf2724110df7ad6009105d5546094291a0, Ubuntu aggregate checks passed.
Windows aggregate checks, setup startup/restart acceptance, shipping installer
packaging and upgrade fixture packaging passed. Installed shortcut/metadata
acceptance refused pre-existing state at its safety preflight, before installing
a fixture; the log did not identify the conflicting surface. No installed
acceptance is claimed for that commit.

The newly branded executable can make native Electron resolve its default
PRMonitor profile before application JavaScript redirects app paths. Pinned
Electron v44.4.3 PreSandboxStartup honors --user-data-dir before browser/main JS
loads. Smoke now passes its already-owned fixture path at native launch, as well
as retaining the existing JS overrides, sandbox and nonce protocol. The shipping
installer preflight retains every refusal and reports only a closed category,
such as USER_DATA or INSTALL_PREFIX, if another conflict exists. This is a
source-supported cause to test, not proof of the unidentified CI conflict.

Source: https://raw.githubusercontent.com/electron/electron/v44.4.3/shell/app/electron_main_delegate.cc

Workspace-local npm 11.17.0 and upstream Git v2.55.0 now satisfy the unchanged
runtime gate. Xvfb was extracted from Debian packages verified by APT's signed
metadata into the workspace. Aggregate validation is being rerun; dependencies
and cache paths remain environment artifacts, not repository changes.
