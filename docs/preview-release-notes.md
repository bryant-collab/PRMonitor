# PRMonitor unsigned experimental preview

For an opt-in Windows 11 x64 trial. This is an unsigned, manually installed
preview, not a supported or release-certified build. Windows SmartScreen and
workplace security policy may block it. Follow your organization's approval
process; do not disable security controls to install it.

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

## Verification scope

This workflow requires the repository checks (including packaged smoke), the
F29 static security gate, the production dependency audit at the high severity
threshold, installer packaging, payload scan, and exact-file SHA-256 checks.
Its Actions run records their results for the source commit below.

A GitHub-hosted Windows build is not clean-machine Windows 11 acceptance.
Clean install/upgrade/uninstall, Windows 11 tray/focus/virtual desktops,
credentialed GitHub/GHES workflows, manual accessibility, and performance
acceptance remain unverified. No passing 77-criterion F30 acceptance trace or
final release-eligibility decision is claimed by this prerelease.
