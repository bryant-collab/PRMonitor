# Preview.2 Start menu shortcut investigation

The reported installation succeeded but had no Start menu entry. No Windows
computer or installed account was available for inspection. The report does
not establish whether this was a first install, reinstall or upgrade, which
account ran the installer, or whether a shortcut exists but Start search has
not indexed it.

## Source and release findings

Release `v0.1.0-preview.2` records source
`d3c770473371325c0091f16a3a404e2a505f9511`, electron-builder `26.15.3`, and
configuration SHA-256
`b6e2da1c299618b9d186af17c51ba0175159ec0370b2b3eba0ad09496ce9ddb1`, which
matches the source's `apps/desktop/electron-builder.yml`. The downloaded
installer's SHA-256 matches the manifest:
`c88f8eb67902475436f42ae875d4c9e18c7a9b0012dbf99849db84cb7086fba0`.
The artifact was read and hashed on Linux; it was never executed.

Shipping configuration enables both shortcuts, names the link `PRMonitor`,
uses stable identity `com.prmonitor.desktop`, and selects one-click per-user
installation. No custom template disabled the shipping shortcuts. NSIS uses
the installing account's Programs known folder for `PRMonitor.lnk`; its target
is `$INSTDIR\PRMonitor.exe`. It reuses that account's registered install path,
otherwise uses the UserProgramFiles known folder (normally under
`%LOCALAPPDATA%\Programs`) with the sanitized package name `@prmonitordesktop`.
`/D` can override that path. Another account's per-user installation does not
provide a shortcut in the current account.

The pinned templates expose a reproducible reinstall/upgrade defect:
`include/installUtil.nsh:setIsTryToKeepShortcuts` enables preservation;
`installSection.nsh` sets `keepShortcuts` when registration says
`KeepShortcuts=true` and the old executable exists. In that state,
`include/installer.nsh:addStartMenuLink` preserves an absent link instead of
creating it. `createStartMenuShortcut: true` alone cannot repair it, including
manual reinstalls of the same `0.1.0` package version used by both previews.
This is a confirmed source failure path, not proof of the customer's exact
installation history. A true fresh installation should take the creation
branch; account/path differences, shell indexing and shortcut-write failures
remain alternatives until the affected machine can be inspected.

The earlier `tests/installer-e2e.mjs` deliberately uses a unique identity,
disables both shortcuts and supplies an owned `/D` prefix. Its retained-history
evidence remains valid within that scope. Shipping identity and shortcuts were
explicitly unverified; the preview workflow packaged the installer but did not
install it. Existing checks did not catch this failure path.

The pinned dependency is the npm distribution
[`app-builder-lib-26.15.3.tgz`](https://registry.npmjs.org/app-builder-lib/-/app-builder-lib-26.15.3.tgz),
whose integrity is recorded in `package-lock.json`. The relevant installed
template paths are under `node_modules/app-builder-lib/templates/nsis`:
`include/installUtil.nsh:86`, `installSection.nsh:40`, and
`include/installer.nsh:189`. `registryAddInstallInfo` writes
`KeepShortcuts=true`; the matching uninstaller preserves links when invoked
with `--keep-shortcuts`. This explains why the missing link survives a manual
same-version reinstall.

## Fix and regression boundary

The shipping NSIS include repairs only an absent Start menu link after the
standard shortcut steps, using electron-builder's existing macro, resolved
paths and AppUserModelID. It restores the shortcut-preservation flag and does
not recreate a deleted desktop shortcut. A failed repair aborts installation
instead of returning a successful result with no launch entry. Existing links,
identity, installation scope and data-retention policy stay intact.

`npm run test:release` now loads the shipping YAML through the pinned builder,
asserts effective identity/shortcut/lifecycle settings and include wiring, and
compiles its actual templates with inert text payloads using the native NSIS
compiler. This is compile evidence, not Windows shortcut execution evidence.

Normal Windows PR CI builds the shipping installer with publication disabled
and runs `tests/installer-shortcuts.ps1`. It requires a disposable GitHub-hosted
runner and refuses existing shipping registration, shortcuts, program files or
app data. It exercises the normal UserProgramFiles default path without `/D`.
It downloads checksum-pinned preview.2, tests its fresh links/target/AppUserModelID,
then reproduces missing-link preservation after deleting both links and
reinstalling preview.2. The candidate repairs the Start link, preserves existing
links and desktop deletion, then a test-only incremented package version
exercises a real upgrade under the same shipping identity. Existing production
fixtures seed a saved review and SQLite settings with version/timestamps;
semantic readback and a sentinel hash must survive every reinstall/upgrade and
ordinary uninstall. Retention assertions require the folder and DB to exist
before opening persistence so full deletion cannot be masked. A fresh candidate
install is checked after verified uninstall and disposal of only owned fixture
data. It does not launch the application or alter security. No fixture installer
is published and no production package version is changed.

## Verification still required

Linux: all 20 release tests passed, including the real NSIS compile. Formatting
and `git diff --check` passed. `npm run check` stopped at its runtime gate:
this saved environment has Git `2.52.0` instead of required `2.55.0`; Node
`24.19.0` and locally installed npm `11.17.0` match. No gate was bypassed.
The initial commit `dfe7f45` passed Windows shortcut execution on its push run
and both Ubuntu repository checks. The strengthened default-path/preview.2/
upgrade/SQLite test is a later commit and must have its own exact-head CI
result before describing that broader acceptance as passed.

On an approved disposable Windows 11 account/VM, install the exact shipping
candidate with its normal default path (no `/D`), verify the current user's
Programs `PRMonitor.lnk`, target, AppUserModelID and Start-menu visibility, and
launch from the link. Repeat an upgrade/reinstall from checksum-verified
preview.2 with fixture history, including a missing Start link, then verify
history retention and ordinary uninstall. Hosted CI's file/registry assertions
do not establish Start indexing, default-path launch, physical Windows 11 UI,
or the affected customer's installation history. Do not use or erase customer
data for this acceptance.

A temporary workaround is to use the already located installed `PRMonitor.exe`
and create a personal shortcut or pin that executable to Start through the
current account's Windows UI. Do not guess the install path, reinstall under
another account, or delete `%APPDATA%\PRMonitor` to try to repair discovery.
