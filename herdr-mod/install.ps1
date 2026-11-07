<#
.SYNOPSIS
  Install Manapoint embedded usage mod for Herdr Desktop.

.DESCRIPTION
  Installs the Manapoint status bar mod, usage details popup mod, and the
  "manapoint" layout into ~/.config/herdr-app/. If Herdr is running, switches
  to the layout immediately.
  Supports both local file execution and one-liner remote execution:
    irm https://raw.githubusercontent.com/vux427/Manapoint/master/herdr-mod/install.ps1 | iex
#>

[CmdletBinding()]
param(
  [string]$HerdrHome = ""
)

$ErrorActionPreference = 'Stop'
if (-not $HerdrHome) {
  $HerdrHome = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $HOME '.config\herdr-app' }
}

$scriptDir = $PSScriptRoot
$tempDirToClean = $null

# If running via `irm ... | iex` (empty $scriptDir) or without local mod files
if (-not $scriptDir -or -not (Test-Path (Join-Path $scriptDir 'mods\manapoint-status'))) {
  Write-Host "==> Downloading latest Manapoint Herdr mod from GitHub..." -ForegroundColor Cyan
  $tempZip = Join-Path $env:TEMP "manapoint-herdr-mod-$PID.zip"
  $tempDirToClean = Join-Path $env:TEMP "manapoint-herdr-mod-$PID"
  try {
    Invoke-WebRequest -Uri "https://github.com/vux427/Manapoint/archive/refs/heads/master.zip" -OutFile $tempZip -UseBasicParsing
    Expand-Archive -Path $tempZip -DestinationPath $tempDirToClean -Force
    $scriptDir = Join-Path $tempDirToClean 'Manapoint-master\herdr-mod'
    Remove-Item $tempZip -Force -ErrorAction SilentlyContinue
  } catch {
    throw "Failed to download mod archive from GitHub: $_"
  }
}

if (-not (Test-Path $HerdrHome)) {
  Write-Warning "Herdr directory not found at $HerdrHome; creating it."
  New-Item -ItemType Directory -Force -Path $HerdrHome | Out-Null
}

$destMods = Join-Path $HerdrHome 'mods'
$destLayouts = Join-Path $HerdrHome 'layouts'
New-Item -ItemType Directory -Force -Path $destMods, $destLayouts | Out-Null

Write-Host "==> Installing Manapoint mods to $destMods" -ForegroundColor Cyan
Copy-Item (Join-Path $scriptDir 'mods\manapoint-status') $destMods -Recurse -Force
Copy-Item (Join-Path $scriptDir 'mods\manapoint-popup') $destMods -Recurse -Force

Write-Host "==> Installing Manapoint layout to $destLayouts\manapoint.json" -ForegroundColor Cyan
Copy-Item (Join-Path $scriptDir 'layouts\manapoint.json') (Join-Path $destLayouts 'manapoint.json') -Force

if ($tempDirToClean -and (Test-Path $tempDirToClean)) {
  Remove-Item -Path $tempDirToClean -Recurse -Force -ErrorAction SilentlyContinue
}

# Verify mod with herdr-app check if available
$herdrApp = Get-Command herdr-app -ErrorAction SilentlyContinue
if ($null -ne $herdrApp) {
  Write-Host "==> Verifying Herdr mods" -ForegroundColor Cyan
  & herdr-app check (Join-Path $destMods 'manapoint-status')
  & herdr-app check (Join-Path $destMods 'manapoint-popup')

  Write-Host "==> Switching Herdr layout to manapoint" -ForegroundColor Green
  & herdr-app do layout.switch --name manapoint
} else {
  Write-Host "Done: launch Herdr and switch to the manapoint layout." -ForegroundColor Green
}

Write-Host "==> Manapoint Herdr embedded mod installed successfully!" -ForegroundColor Green
