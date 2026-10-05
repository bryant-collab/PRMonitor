# Shipping identity acceptance is safe only on a fresh, disposable hosted runner.
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$PreviewInstaller,
  [Parameter(Mandatory = $true)][string]$UpgradeInstaller,
  [Parameter(Mandatory = $true)][string]$CandidateVersion,
  [Parameter(Mandatory = $true)][string]$UpgradeVersion
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'This test requires a disposable GitHub-hosted Windows runner.'
}
$Installer = (Resolve-Path -LiteralPath $Installer).Path
$PreviewInstaller = (Resolve-Path -LiteralPath $PreviewInstaller).Path
$UpgradeInstaller = (Resolve-Path -LiteralPath $UpgradeInstaller).Path
$guid = 'f8d173c3-d555-534f-936f-68adc6bbdade'
$registration = "HKCU:\Software\$guid"
$uninstallRegistration = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid"
$startLink = Join-Path ([Environment]::GetFolderPath('Programs')) 'PRMonitor.lnk'
$desktopLink = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'PRMonitor.lnk'
$userData = Join-Path $env:APPDATA 'PRMonitor'
# Read the same known folder the pinned NSIS template uses, including redirects.
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PRMonitorKnownFolder {
  [DllImport("shell32.dll")]
  private static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)] Guid id, uint flags, IntPtr token, out IntPtr result);
  public static string UserPrograms() {
    IntPtr result;
    int status = SHGetKnownFolderPath(new Guid("5CD7AEE2-2219-4A67-B85D-6C9CE15660CB"), 0x4000, IntPtr.Zero, out result);
    try { Marshal.ThrowExceptionForHR(status); return Marshal.PtrToStringUni(result); }
    finally { if (result != IntPtr.Zero) Marshal.FreeCoTaskMem(result); }
  }
}
'@
$prefix = Join-Path ([PRMonitorKnownFolder]::UserPrograms()) '@prmonitordesktop'
foreach ($existing in @(
  $registration, $uninstallRegistration, "HKLM:\Software\$guid",
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid",
  $startLink, $desktopLink, $userData, $prefix,
  (Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'PRMonitor.lnk'),
  (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'PRMonitor.lnk')
)) {
  if (Test-Path -LiteralPath $existing) { throw 'Existing PRMonitor state: refusing shipping-identity test.' }
}
$root = Join-Path $env:RUNNER_TEMP ('prmonitor-shortcut-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$exe = Join-Path $prefix 'PRMonitor.exe'
$uninstaller = Join-Path $prefix 'Uninstall PRMonitor.exe'
$shell = New-Object -ComObject WScript.Shell
$windowsShell = New-Object -ComObject Shell.Application
$sentinel = $null
$dataHash = $null
$ownsUserData = $false
function Run-InstallerProcess([string]$Executable, [string[]]$Arguments) {
  $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -PassThru
  if (-not $process.WaitForExit(60000)) {
    $process.Kill()
    throw 'Owned installer process timed out.'
  }
  if ($process.ExitCode -ne 0) { throw "Installer process failed: $($process.ExitCode)" }
}
function Assert-RetainedData {
  if (-not (Test-Path -LiteralPath $userData -PathType Container) -or -not (Test-Path -LiteralPath $sentinel -PathType Leaf)) {
    throw 'Installer removed retained fixture data.'
  }
  if ((Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash -ne $dataHash) { throw 'Installer changed retained fixture data.' }
  & node "$PSScriptRoot/installer-shortcut-data.mjs" assert $userData $root
  if ($LASTEXITCODE -ne 0) { throw 'Installed saved review/settings readback failed.' }
}
function Install-Candidate([string]$Executable, [string]$ExpectedVersion, [bool]$ExpectStartLink = $true) {
  # No /D: exercise the shipping default path on the owned disposable account.
  Run-InstallerProcess $Executable @('/S')
  if (-not (Test-Path -LiteralPath $exe)) { throw 'Installed executable missing.' }
  if ((Get-ItemProperty -LiteralPath $registration).InstallLocation -ne $prefix) { throw 'Install registration mismatch.' }
  if ((Get-ItemProperty -LiteralPath $uninstallRegistration).DisplayVersion -ne $ExpectedVersion) { throw 'Installed version mismatch.' }
  if ($ownsUserData) { Assert-RetainedData }
  if (-not $ExpectStartLink) {
    if (Test-Path -LiteralPath $startLink) { throw 'Preview.2 did not reproduce missing-link preservation.' }
    Write-Output 'Checksum-verified preview.2 reproduced missing Start link on reinstall.'
    return
  }
  $link = $shell.CreateShortcut($startLink)
  if (-not (Test-Path -LiteralPath $startLink) -or $link.TargetPath -ne $exe) { throw 'Start menu shortcut target mismatch.' }
  $folder = $windowsShell.Namespace((Split-Path -Parent $startLink))
  $item = $folder.ParseName('PRMonitor.lnk')
  if ($item.ExtendedProperty('System.AppUserModel.ID') -ne 'com.prmonitor.desktop') { throw 'Shortcut application identity mismatch.' }
}
function Uninstall-Candidate {
  Run-InstallerProcess $uninstaller @('/S', "_?=$prefix")
  foreach ($removed in @($startLink, $desktopLink, $registration, $uninstallRegistration, $exe)) {
    if (Test-Path -LiteralPath $removed) { throw 'Uninstall did not remove an owned installation surface.' }
  }
  if ($ownsUserData) { Assert-RetainedData }
}
try {
  Install-Candidate $PreviewInstaller '0.1.0'
  if (-not (Test-Path -LiteralPath $desktopLink)) { throw 'Fresh desktop shortcut missing.' }
  $startHash = (Get-FileHash -LiteralPath $startLink -Algorithm SHA256).Hash
  New-Item -ItemType Directory -Path $userData | Out-Null
  $ownsUserData = $true
  $sentinel = Join-Path $userData 'installer-shortcut-test.txt'
  Set-Content -LiteralPath $sentinel -Value 'Owned disposable runner fixture.' -NoNewline
  $dataHash = (Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash
  @{ owner = 'prmonitor-installer-shortcuts'; root = $userData } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $userData '.installer-shortcut-owner.json')
  & node "$PSScriptRoot/installer-shortcut-data.mjs" seed $userData $root
  if ($LASTEXITCODE -ne 0) { throw 'Installed data fixture seed failed.' }
  Install-Candidate $PreviewInstaller '0.1.0'
  if ((Get-FileHash -LiteralPath $startLink -Algorithm SHA256).Hash -ne $startHash) { throw 'Existing Start menu link was replaced.' }
  Remove-Item -LiteralPath $startLink, $desktopLink
  Install-Candidate $PreviewInstaller '0.1.0' $false
  Install-Candidate $Installer $CandidateVersion
  if (Test-Path -LiteralPath $desktopLink) { throw 'Repair reset desktop shortcut preference.' }
  $startHash = (Get-FileHash -LiteralPath $startLink -Algorithm SHA256).Hash
  Install-Candidate $Installer $CandidateVersion
  if ((Get-FileHash -LiteralPath $startLink -Algorithm SHA256).Hash -ne $startHash) { throw 'Candidate replaced an existing Start menu link.' }
  Remove-Item -LiteralPath $startLink
  Install-Candidate $UpgradeInstaller $UpgradeVersion
  if (Test-Path -LiteralPath $desktopLink) { throw 'Reinstall reset desktop shortcut preference.' }
  Uninstall-Candidate
  Remove-Item -LiteralPath $userData -Recurse
  $ownsUserData = $false
  Install-Candidate $Installer $CandidateVersion
  if (-not (Test-Path -LiteralPath $desktopLink)) { throw 'Fresh candidate desktop shortcut missing.' }
  Write-Output 'Shipping identity: default-path preview.2 install/reinstall reproduction, candidate repair/fresh install, version upgrade, existing-link preservation, desktop deletion preference and retained SQLite data passed.'
} finally {
  if (Test-Path -LiteralPath $uninstaller) {
    Uninstall-Candidate
    if ($ownsUserData) {
      Remove-Item -LiteralPath $userData -Recurse
    }
    # NSIS cannot remove its own running uninstaller; after exit only our
    # preflight-empty, default installation prefix may be cleaned here.
    if (Test-Path -LiteralPath $prefix) { Remove-Item -LiteralPath $prefix -Recurse }
  }
  Remove-Item -LiteralPath $root -Recurse
}
