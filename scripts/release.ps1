<#
.SYNOPSIS
  Build Manapoint with tinyjs and stage the portable zip for a GitHub release.

.DESCRIPTION
  tinyjs builds a portable folder: Manapoint.exe (the compiled txiki.js backend,
  with the frontend and icon bundled inside) plus launcher.exe (the WebView2
  window). Both must ship side by side, so the release artefact is a zip of that
  folder, and this script prints its SHA-256 for the release notes.

  An unsigned, zero-reputation executable is what makes Microsoft Defender and
  SmartScreen flag an app, so the script signs launcher.exe when MANAPOINT_SIGN_CMD
  is set and reports loudly when it is not. Manapoint.exe is left unsigned on
  purpose: txiki.js appends the app bundle after the PE image and reads it back from
  the end of the file, and whether an Authenticode signature appended after that
  keeps the bundle readable is unverified (tinyjs lists signing as open work).

    $env:MANAPOINT_SIGN_CMD = 'signtool sign /v /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /sha1 <thumbprint> "{}"'

.PARAMETER SkipBuild
  Package whatever is already in manapoint\dist instead of rebuilding.
#>
[CmdletBinding()]
param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$app = Join-Path $repo 'manapoint'
$built = Join-Path $app 'dist'
$tinyjs = Join-Path $env:LOCALAPPDATA 'tinyjs\tinyjs.cmd'
$version = (Get-Content (Join-Path $app 'tinyjs.json') -Raw | ConvertFrom-Json).version

if (-not $SkipBuild) {
    if (-not (Test-Path $tinyjs)) { throw "tinyjs not found at $tinyjs (irm https://tinyjs.app/install.ps1 | iex)" }
    Write-Host '==> node --test' -ForegroundColor Cyan
    Push-Location $app
    try {
        node --test (Get-ChildItem test\*.test.mjs | ForEach-Object FullName)
        if ($LASTEXITCODE -ne 0) { throw "tests failed ($LASTEXITCODE)" }
        Write-Host '==> tinyjs build' -ForegroundColor Cyan
        & $tinyjs build
        if ($LASTEXITCODE -ne 0) { throw "tinyjs build failed ($LASTEXITCODE)" }
    } finally { Pop-Location }
}
foreach ($f in 'Manapoint.exe', 'launcher.exe') {
    if (-not (Test-Path (Join-Path $built $f))) { throw "missing $built\$f" }
}

# --- signing ----------------------------------------------------------------
$launcher = Join-Path $built 'launcher.exe'
if ($env:MANAPOINT_SIGN_CMD) {
    Write-Host '==> signing launcher.exe' -ForegroundColor Cyan
    & pwsh -NoProfile -Command $env:MANAPOINT_SIGN_CMD.Replace('{}', $launcher)
    if ($LASTEXITCODE -ne 0) { throw "signing failed ($LASTEXITCODE)" }
}
$sig = Get-AuthenticodeSignature $launcher
if ($sig.Status -eq 'Valid') {
    Write-Host "==> launcher.exe signed by $($sig.SignerCertificate.Subject)" -ForegroundColor Green
} else {
    Write-Warning @"
launcher.exe is NOT signed (status: $($sig.Status)), and Manapoint.exe never is.
Defender and SmartScreen will likely flag this build. Expect to file a
false-positive report at https://www.microsoft.com/en-us/wdsi/filesubmission
"@
}

# --- zip + release notes fragment ------------------------------------------
$dist = Join-Path $repo 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$zip = Join-Path $dist "Manapoint-$version-win.zip"
$stage = Join-Path $env:TEMP "manapoint-release-$PID\Manapoint"
New-Item -ItemType Directory -Force -Path $stage | Out-Null
try {
    Copy-Item (Join-Path $built 'Manapoint.exe'), $launcher $stage
    if (Test-Path $zip) { Remove-Item $zip }
    Compress-Archive -Path $stage -DestinationPath $zip
} finally { Remove-Item -Recurse -Force (Split-Path $stage) }

$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
$size = [math]::Round((Get-Item $zip).Length / 1MB, 1)
$unpacked = [math]::Round(((Get-ChildItem $built -File | Measure-Object Length -Sum).Sum) / 1MB, 1)
Write-Host ''
Write-Host "==> $zip  ($size MB zipped, $unpacked MB unpacked)" -ForegroundColor Cyan
Write-Host "SHA-256: $hash"
Write-Host ''
Write-Host 'Paste into the release notes:' -ForegroundColor Cyan
@"

``````
Manapoint-$version-win.zip  $size MB (unzip, run Manapoint.exe)
SHA-256  $hash
``````
"@ | Write-Host
