# PRMonitor unsigned experimental preview

For an opt-in Windows 11 x64 trial. This is an unsigned, manually installed
preview, not a supported or release-certified build. Windows SmartScreen and
workplace security policy may block it. Follow your organization's approval
process; do not disable security controls to install it.

## Changes in preview.2

- Resumable startup setup checks Git, storage, connection and all four task
  profiles, preserves committed progress across restart, and keeps explicit
  saved-work targets available with setup attention.
- Activity defaults to PR work, with application diagnostics and raw redacted
  evidence separately labeled and historical ownership preserved.
- The Inbox and detail workspace provide isolated selection/drafts, saved
  review and synchronization history, foreground cancellation, and explicit
  guarded publication/recovery controls.

The desktop package version remains `0.1.0`; the distinct GitHub preview tag
identifies this source revision. This preview does not establish a tested
shipping-identity upgrade path from preview.1.

## Download and install

1. Install the Git 2.55.0 prerequisite from the official Git for Windows site.
2. Download `PRMonitor-0.1.0-x64.exe`, `release-manifest.json`, and
   `checksums.sha256` into the same directory.
3. In PowerShell, run `Get-FileHash .\PRMonitor-0.1.0-x64.exe -Algorithm SHA256`
   and compare it with the installer row in `checksums.sha256`. Verify the
   manifest the same way before installing.
4. Run the per-user installer only if your workplace policy permits it.
   Start PRMonitor from the Start menu. Normal window close keeps it in the
   tray; use **Shutdown PRMonitor** to exit.

There is no automatic updater. Ordinary uninstall preserves application data.
See the attached `windows-release.md` for data locations, upgrade/uninstall
procedure, and support diagnostics. Start with a disposable test repository
and back up any existing PRMonitor data before trying a new build.

Git is an external prerequisite. Configure a supported provider, model and
authentication through the application's setup flow before starting AI work.
The build pins Electron `44.4.3` and Codex SDK `0.155.1`.
`release-manifest.json` records the exact source commit and build runtimes;
the source `package-lock.json` at that commit records the complete dependency
versions.

## Verification scope

This workflow requires the repository checks (including packaged smoke), the
F29 static security gate, the production dependency audit at the high severity
threshold, installer packaging, payload scan, and exact-file SHA-256 checks.
Its Actions run records their results for the source commit below.

A GitHub-hosted Windows build is not clean-machine Windows 11 acceptance.
Shipping-identity clean install/upgrade/uninstall and shortcuts, physical
125/150/200% display DPI and independent Windows text scaling, spoken
Narrator/NVDA interaction, actual taskbar/tray and folder/file/export dialogs,
Windows 11 virtual desktops, credentialed GitHub/GHES workflows, and performance
acceptance remain unverified. Automated accessibility and process-local native
input do not establish those physical checks. No passing 77-criterion F30 acceptance trace or
final release-eligibility decision is claimed by this prerelease.
