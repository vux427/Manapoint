<#
.SYNOPSIS
  Build, sign and stage the portable Manapoint.exe for a GitHub release.

.DESCRIPTION
  An unsigned, zero-reputation executable is what makes Microsoft Defender and
  SmartScreen flag Manapoint, so this script refuses to stage silently: it signs
  the binary when a signing command is configured and reports loudly when it is
  not. It also prints the SHA-256 so the release notes can carry a hash users
  are able to verify.

  Configure signing by setting MANAPOINT_SIGN_CMD to a command line containing
  {} where the target file goes, for example Azure Trusted Signing:

    $env:MANAPOINT_SIGN_CMD = 'signtool sign /v /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib "C:\ats\Azure.CodeSigning.Dlib.dll" /dmdf "C:\ats\metadata.json" "{}"'

  or a certificate already in the local store:

    $env:MANAPOINT_SIGN_CMD = 'signtool sign /v /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /sha1 <thumbprint> "{}"'

.PARAMETER SkipBuild
  Stage whatever is already in target/release instead of rebuilding.
#>
[CmdletBinding()]
param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$crate = Join-Path $repo 'manapoint-tauri\src-tauri'
$built = Join-Path $crate 'target\release\manapoint.exe'
$dist = Join-Path $repo 'dist'
$staged = Join-Path $dist 'Manapoint.exe'

if (-not $SkipBuild) {
    Write-Host '==> cargo build --release' -ForegroundColor Cyan
    Push-Location $crate
    try { cargo build --release; if ($LASTEXITCODE -ne 0) { throw "cargo build failed ($LASTEXITCODE)" } }
    finally { Pop-Location }
}
if (-not (Test-Path $built)) { throw "missing $built" }

New-Item -ItemType Directory -Force -Path $dist | Out-Null
Copy-Item $built $staged -Force

# --- version resource -------------------------------------------------------
# Defender's ML classifiers treat a binary with no publisher or copyright as a
# stronger candidate for a generic detection, so fail the release if the
# resource came out empty.
$vi = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($staged)
Write-Host '==> version resource' -ForegroundColor Cyan
$vi | Format-List CompanyName, ProductName, FileDescription, FileVersion, LegalCopyright | Out-String | Write-Host
foreach ($field in 'CompanyName', 'ProductName', 'FileDescription', 'LegalCopyright') {
    if ([string]::IsNullOrWhiteSpace($vi.$field)) {
        throw "$field is empty - check bundle.publisher / bundle.copyright in tauri.conf.json"
    }
}

# --- signing ----------------------------------------------------------------
if ($env:MANAPOINT_SIGN_CMD) {
    Write-Host '==> signing' -ForegroundColor Cyan
    $cmd = $env:MANAPOINT_SIGN_CMD.Replace('{}', $staged)
    & pwsh -NoProfile -Command $cmd
    if ($LASTEXITCODE -ne 0) { throw "signing failed ($LASTEXITCODE)" }
}

$sig = Get-AuthenticodeSignature $staged
if ($sig.Status -eq 'Valid') {
    Write-Host "==> signed by $($sig.SignerCertificate.Subject)" -ForegroundColor Green
} else {
    Write-Warning @"
Manapoint.exe is NOT signed (status: $($sig.Status)).
Defender and SmartScreen will very likely flag this build. Set
MANAPOINT_SIGN_CMD (see the comment at the top of this script) before
publishing, or expect to file a false-positive report at
https://www.microsoft.com/en-us/wdsi/filesubmission
"@
}

# --- release notes fragment -------------------------------------------------
$hash = (Get-FileHash $staged -Algorithm SHA256).Hash.ToLower()
$size = [math]::Round((Get-Item $staged).Length / 1MB, 1)
Write-Host ''
Write-Host "==> $staged  ($size MB)" -ForegroundColor Cyan
Write-Host "SHA-256: $hash"
Write-Host ''
Write-Host 'Paste into the release notes:' -ForegroundColor Cyan
@"

``````
Manapoint.exe  $size MB
SHA-256  $hash
``````
"@ | Write-Host
