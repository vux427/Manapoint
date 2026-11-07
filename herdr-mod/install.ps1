<#
.SYNOPSIS
  Install Manapoint embedded usage mod for Herdr Desktop.

.DESCRIPTION
  Installs the Manapoint status bar mod, usage details popup mod, and the
  "manapoint" layout into ~/.config/herdr-app/. If Herdr is running, switches
  to the layout immediately.
#>

[CmdletBinding()]
param(
  [string]$HerdrHome = (if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $HOME '.config\herdr-app' })
)

$ErrorActionPreference = 'Stop'
$scriptDir = $PSScriptRoot

if (-not (Test-Path $HerdrHome)) {
  Write-Warning "Herdr 配置目錄不存在 ($HerdrHome)，將自動建立。"
  New-Item -ItemType Directory -Force -Path $HerdrHome | Out-Null
}

$destMods = Join-Path $HerdrHome 'mods'
$destLayouts = Join-Path $HerdrHome 'layouts'
New-Item -ItemType Directory -Force -Path $destMods, $destLayouts | Out-Null

Write-Host "==> 安裝 Manapoint mods 到 $destMods" -ForegroundColor Cyan
Copy-Item (Join-Path $scriptDir 'mods\manapoint-status') $destMods -Recurse -Force
Copy-Item (Join-Path $scriptDir 'mods\manapoint-popup') $destMods -Recurse -Force

Write-Host "==> 安裝 Manapoint 佈局到 $destLayouts\manapoint.json" -ForegroundColor Cyan
Copy-Item (Join-Path $scriptDir 'layouts\manapoint.json') (Join-Path $destLayouts 'manapoint.json') -Force

# Verify mod with herdr-app check if available
$herdrApp = Get-Command herdr-app -ErrorAction SilentlyContinue
if ($herdrApp) {
  Write-Host "==> 驗證 Herdr mod" -ForegroundColor Cyan
  & herdr-app check (Join-Path $destMods 'manapoint-status')
  & herdr-app check (Join-Path $destMods 'manapoint-popup')

  try {
    Write-Host "==> 切換 Herdr 佈局為 manapoint" -ForegroundColor Green
    & herdr-app do layout.switch --name manapoint
  } catch {
    Write-Host "提示: 請在 Herdr 視窗中按 Ctrl+Shift+L 或使用命令切換至 manapoint 佈局。" -ForegroundColor Yellow
  }
} else {
  Write-Host "提示: 安裝完成。啟動 Herdr 後可切換至 manapoint 佈局。" -ForegroundColor Green
}

Write-Host "==> Manapoint Herdr 內嵌用量模組安裝完成！" -ForegroundColor Green
