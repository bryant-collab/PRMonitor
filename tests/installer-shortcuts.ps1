# Shipping identity acceptance is safe only on a fresh, disposable hosted runner.
param([Parameter(Mandatory = $true)][string]$Installer)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'This test requires a disposable GitHub-hosted Windows runner.'
}
$Installer = (Resolve-Path -LiteralPath $Installer).Path
$guid = 'f8d173c3-d555-534f-936f-68adc6bbdade'
$registration = "HKCU:\Software\$guid"
$uninstallRegistration = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid"
$startLink = Join-Path ([Environment]::GetFolderPath('Programs')) 'PRMonitor.lnk'
$desktopLink = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'PRMonitor.lnk'
$userData = Join-Path $env:APPDATA 'PRMonitor'
foreach ($existing in @(
  $registration, $uninstallRegistration, "HKLM:\Software\$guid",
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid",
  $startLink, $desktopLink, $userData,
  (Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'PRMonitor.lnk'),
  (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'PRMonitor.lnk')
)) {
  if (Test-Path -LiteralPath $existing) { throw 'Existing PRMonitor state: refusing shipping-identity test.' }
}
$root = Join-Path $env:RUNNER_TEMP ('prmonitor-shortcut-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$prefix = Join-Path $root 'installed'
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
function Install-Candidate {
  Run-InstallerProcess $Installer @('/S', "/D=$prefix")
  if (-not (Test-Path -LiteralPath $exe)) { throw 'Installed executable missing.' }
  if ((Get-ItemProperty -LiteralPath $registration).InstallLocation -ne $prefix) { throw 'Install registration mismatch.' }
  $link = $shell.CreateShortcut($startLink)
  if (-not (Test-Path -LiteralPath $startLink) -or $link.TargetPath -ne $exe) { throw 'Start menu shortcut target mismatch.' }
  $folder = $windowsShell.Namespace((Split-Path -Parent $startLink))
  $item = $folder.ParseName('PRMonitor.lnk')
  if ($item.ExtendedProperty('System.AppUserModel.ID') -ne 'com.prmonitor.desktop') { throw 'Shortcut application identity mismatch.' }
}
try {
  Install-Candidate
  if (-not (Test-Path -LiteralPath $desktopLink)) { throw 'Fresh desktop shortcut missing.' }
  $startHash = (Get-FileHash -LiteralPath $startLink -Algorithm SHA256).Hash
  New-Item -ItemType Directory -Path $userData | Out-Null
  $ownsUserData = $true
  $sentinel = Join-Path $userData 'installer-shortcut-test.txt'
  Set-Content -LiteralPath $sentinel -Value 'Owned disposable runner fixture.' -NoNewline
  $dataHash = (Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash
  Install-Candidate
  if ((Get-FileHash -LiteralPath $startLink -Algorithm SHA256).Hash -ne $startHash) { throw 'Existing Start menu link was replaced.' }
  Remove-Item -LiteralPath $startLink, $desktopLink
  Install-Candidate
  if (Test-Path -LiteralPath $desktopLink) { throw 'Reinstall reset desktop shortcut preference.' }
  if ((Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash -ne $dataHash) { throw 'Reinstall changed retained data.' }
  Write-Output 'Shipping identity: fresh install, existing-link preservation, missing Start-link repair, desktop deletion preference and retained data passed.'
} finally {
  if (Test-Path -LiteralPath $uninstaller) {
    Run-InstallerProcess $uninstaller @('/S', "_?=$prefix")
    foreach ($removed in @($startLink, $desktopLink, $registration, $uninstallRegistration, $exe)) {
      if (Test-Path -LiteralPath $removed) { throw 'Uninstall did not remove an owned installation surface.' }
    }
    if ($ownsUserData -and (Test-Path -LiteralPath $userData)) {
      if ((Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash -ne $dataHash) { throw 'Uninstall changed retained data.' }
      Remove-Item -LiteralPath $userData -Recurse
    }
  }
  Remove-Item -LiteralPath $root -Recurse
}
