# PRMonitor Windows MVP release

This document is the clean-machine and support handoff for the F30 release
candidate. The supported target is Windows 11 x64 with Git installed. macOS,
Linux, ARM Windows, portable archives, and Microsoft Store distribution are not
part of the MVP release gate.

## Distribution policy

The MVP is an unsigned internal preview distributed through versioned manual
installers. It does not ship an updater, background downloader, boot auto-start,
or a generally supported/trusted public-release label. Windows SmartScreen may
display a warning because the installer has no Authenticode signature. Verify
the SHA-256 checksum in the release manifest before running an installer.

The installer uses the stable application identity `com.prmonitor.desktop` and
the product name `PRMonitor`. The per-user NSIS install keeps replaceable
program files separate from authoritative per-user application data.

## Data and lifecycle policy

The application-data root is the Electron per-user `userData` directory. On a
default Windows installation this is under `%APPDATA%\PRMonitor`; the exact
resolved path is shown by the installed application and is never inferred from
the install directory. SQLite lives below `database\prmonitor.sqlite`,
migration backups below `backups`, secure-store references below the secure
credential boundary, and operation-owned worktrees below `worktrees`.

Installing a newer candidate over an existing installation preserves compatible
application data, migration history, opaque secure-store references, operation
records, worktree records, and published-history references. A migration is
applied at most once and fails closed if its backup or integrity verification
cannot be proven.

Ordinary uninstall removes program files, shortcuts, and registration surfaces
but preserves application data by default. It does not purge credentials,
worktrees, local history, or published history. Any future data-purge action
must be separate, clearly named, and explicitly confirmed.

## Clean-machine procedure

1. Start with a Windows 11 x64 machine or VM snapshot with no PRMonitor
   checkout. Install the documented Git prerequisite.
2. Verify the candidate's `release-manifest.json` and `checksums.sha256`.
3. Run the per-user NSIS installer. Confirm the Start-menu entry, executable,
   taskbar identity, tray identity, and PRMonitor application icon.
4. Launch PRMonitor, close the window to the tray, reopen it from the tray, and
   use **Shutdown PRMonitor** for the explicit process exit.
5. For an upgrade run, seed a test-owned database and secure-store reference,
   install the newer candidate over it, reopen the application, and record the
   schema/migration and history readback. Do not use a developer repository or
   credential.
6. Use **Export Support Diagnostics** when support evidence is needed. Scan the
   resulting report before sharing it.
7. Uninstall the program and verify that application data and externally
   published-history references remain recoverable. Reinstall and repeat the
   readback.

## Build and evidence commands

From a clean checkout with the pinned Node.js and npm versions:

```powershell
npm ci
npm run check
npm run security:gate
npm run f30:package
npm run f30:trace-template
```

`f30:package` builds the x64 NSIS installer, generates the deterministic
application icon, scans the unpacked payload for credentials and checkout
paths, writes artifact hashes, and records the unsigned/manual-update policy.
The release output is under the ignored `release\f30\<release-id>` directory.
Packaging refuses a dirty source revision unless `--allow-dirty` is supplied
for local inspection; a dirty run is never an eligible release.

F30 evidence is tiered and must not be silently substituted:

- credential-free automated contract and fault evidence;
- packaged local install/lifecycle evidence;
- controlled GitHub.com and supported GHES evidence using dedicated test
  resources and secure runtime credential injection;
- manual accessibility, focus, forced-colors, screen-reader, zoom, and
  virtual-desktop evidence;
- release-operator attestations.

The final release trace contains one row for every `APP-AC-01` through
`APP-AC-77`. Missing, contradictory, unredactable, or unapproved evidence
blocks the release gate.

## Opt-in trial prereleases

The manually dispatched **Windows unsigned preview** Actions workflow accepts
an unused `v<desktop-version>-preview.<number>` tag, runs automated checks, and
publishes the NSIS installer and verified hashes as a GitHub prerelease. It
never replaces an existing preview tag. The release notes list the missing
Windows 11 and controlled acceptance evidence; this trial does not establish
F30 release eligibility. Public hosting does not make the unsigned artifact a
generally supported or trusted release. No npm package is published.

CI and preview builds install Git 2.55.0 explicitly from checksum-verified
upstream archives rather than relying on the hosted runner's Git version.
The normal F30 final gate and its individual acceptance evidence requirements
remain unchanged.
