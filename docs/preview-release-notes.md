# PRMonitor unsigned experimental preview

For an opt-in Windows 11 x64 trial. This is an unsigned, manually installed
preview, not a supported or release-certified build. Windows SmartScreen and
workplace security policy may block it. Follow your organization's approval
process; do not disable security controls to install it.

## Changes in preview.4

- Windows executable version resources identify PRMonitor while the installer
  remains unsigned.
- The shared setup flow adds named machine-local AI connections for Codex,
  Claude Code, and GitHub Copilot. Choose a default connection and configure
  task-specific overrides through the same setup and settings controls.
- Setup guides users through GitHub, AI, permissions, and completion, and
  preserves committed setup progress across restart.
- Provider selection and optional launch arguments are checked against each
  detected program's supported options; setup does not silently switch
  authentication or billing methods.

The desktop package version remains `0.1.0`; the distinct GitHub preview tag
identifies the source revision. This preview remains unsigned and manually
updated. It is not generally supported or release-certified.

## Download and install

1. Install the Git 2.55.0 prerequisite from the official Git for Windows site.
2. Download `PRMonitor-0.1.0-x64.exe`, `release-manifest.json`, and
   `checksums.sha256` into the same directory.
3. Verify the installer and manifest against `checksums.sha256` before
   installation.
4. Run the per-user installer only if workplace policy permits it. Start
   PRMonitor from the Start menu. Normal window close keeps it in the tray; use
   **Shutdown PRMonitor** to exit.

There is no automatic updater. Ordinary uninstall preserves application data.
See `windows-release.md` for data locations, upgrade/uninstall procedure, and
support diagnostics. Start with a disposable test repository and back up any
existing PRMonitor data before trying a new build.

## Verification scope

This isolated candidate builds on upstream PR10 head `77f9574` with a bounded
Codex app-server configuration-compatibility fallback and setup acceptance
harness reliability changes. The exact release source commit and build workflow
are appended below by the preview workflow and recorded in the manifest. Local
verification on Node.js 24.19.0 and npm 11.17.0 passed `npm ci`,
`npm run check` (571 desktop tests passed, one skipped; 33 release tests,
43 validation-contract tests, and 17 spec-linter tests passed),
`npm run security:gate`, and `npm audit --omit=dev --audit-level=high`
(zero vulnerabilities). The full isolated Electron setup journey passed all
21 stages with zero forbidden effects; its 43 screenshot captures completed.
The candidate's Windows foundation, Windows shipping installer acceptance,
and Ubuntu foundation CI jobs passed before this notes update. The preview
workflow repeats source checks, security and production audit, packaging, and
artifact hash verification on the final release commit before publication.
A bounded ordinary Codex CLI request using the connected ChatGPT sign-in
returned the expected response in an ephemeral read-only session. A disposable
app-server profile verified startup, the legacy configuration compatibility
retry, and clean shutdown without running a model prompt.

Physical clean-machine Windows 11 install/upgrade/uninstall and shortcut use,
physical DPI and text-scaling checks, Narrator/NVDA interaction, actual taskbar/tray
and file dialogs, virtual desktops, credentialed GitHub/GHES workflows, and
performance acceptance remain unverified. No final 77-criterion F30
acceptance trace or release-eligibility decision is claimed.
