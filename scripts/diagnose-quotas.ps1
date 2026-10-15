<#
.SYNOPSIS
  Compare Antigravity quota requests and inspect Muse's quota response safely.
.DESCRIPTION
  Run on Windows with the same user as agy and muse. Reads their existing login
  into memory, never writes credentials, and never prints tokens or raw bodies.
  Only quota vocabulary, quota numbers, HTTP status and field types are emitted.
  Requires Windows PowerShell 5.1 or PowerShell 7; no tinyjs installation needed.
#>
[CmdletBinding()]
param([switch]$SkipAntigravity, [switch]$SkipMuse)

$ErrorActionPreference = 'Stop'

function Get-QuotaShape($Value, [int]$Depth = 0) {
    if ($null -eq $Value) { return 'null' }
    if ($Value -is [string]) { return "string($($Value.Length))" }
    if ($Value -is [bool]) { return 'boolean' }
    if ($Value -is [ValueType]) { return 'number' }
    if ($Depth -ge 5) { return 'object' }
    if ($Value -is [array]) {
        return ,@($Value | Select-Object -First 3 | ForEach-Object { Get-QuotaShape $_ ($Depth + 1) })
    }
    $fields = [ordered]@{}
    foreach ($property in $Value.PSObject.Properties) {
        $fields[$property.Name] = Get-QuotaShape $property.Value ($Depth + 1)
    }
    return $fields
}

function Invoke-QuotaPost([string]$Url, [string]$Token, [string]$Agent, $Body, $ExtraHeaders = @{}) {
    $headers = @{ Authorization = "Bearer $Token"; Accept = 'application/json' }
    foreach ($key in $ExtraHeaders.Keys) { $headers[$key] = $ExtraHeaders[$key] }
    try {
        $response = Invoke-WebRequest -Uri $Url -Method Post -UseBasicParsing -TimeoutSec 20 `
            -UserAgent $Agent -Headers $headers -ContentType 'application/json' `
            -Body ($Body | ConvertTo-Json -Depth 8 -Compress)
        try { $data = $response.Content | ConvertFrom-Json }
        catch { return @{ status = [int]$response.StatusCode; error = 'non-json-response' } }
        return @{ status = [int]$response.StatusCode; data = $data }
    } catch {
        $status = 0
        if ($null -ne $_.Exception.Response) {
            try { $status = [int]$_.Exception.Response.StatusCode } catch {}
        }
        # Exception text and error bodies can include credentials. Never emit them.
        return @{ status = $status; error = 'request-failed' }
    }
}

function Get-SafeQuotaSummary($Result) {
    $out = [ordered]@{ status = $Result.status }
    if (-not $Result.ContainsKey('data')) { $out.error = $Result.error; return $out }
    $root = $Result.data
    $out.shape = Get-QuotaShape $root
    if ($null -ne $root.response) { $root = $root.response }
    elseif ($null -ne $root.summary) { $root = $root.summary }
    $out.groups = @($root.groups | Where-Object { $null -ne $_ } | ForEach-Object {
        $group = $_
        [ordered]@{
            name = $group.name
            displayName = $group.displayName
            buckets = @($group.buckets | Where-Object { $null -ne $_ } | ForEach-Object {
                [ordered]@{
                    id = $_.id
                    bucketId = $_.bucketId
                    name = $_.name
                    displayName = $_.displayName
                    window = $_.window
                    disabled = $_.disabled
                    remainingFraction = if ($_.remainingFraction -is [ValueType]) { $_.remainingFraction } else { $null }
                    nestedFraction = if ($_.remaining.remainingFraction -is [ValueType]) { $_.remaining.remainingFraction } else { $null }
                    remainingCase = if ($_.remaining.case -in @('remainingFraction', 'remainingAmount')) { $_.remaining.case } else { $null }
                    oneofValue = if ($_.remaining.value -is [ValueType]) { $_.remaining.value } else { $null }
                }
            })
        }
    })
    return $out
}

$report = [ordered]@{ diagnosticVersion = 1 }

if (-not $SkipAntigravity) {
    try {
        if ([IntPtr]::Size -ne 8) { throw 'unsupported-architecture' }
        if (-not ('ManapointQuotaCredential' -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ManapointQuotaCredential {
    [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool Read(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll")] private static extern void CredFree(IntPtr credential);
    public static string Load() {
        IntPtr credential;
        if (!Read("gemini:antigravity", 1, 0, out credential)) return null;
        try {
            int size = Marshal.ReadInt32(credential, 32);
            IntPtr pointer = Marshal.ReadIntPtr(credential, 40);
            byte[] bytes = new byte[size];
            Marshal.Copy(pointer, bytes, 0, size);
            try { return Encoding.UTF8.GetString(bytes); }
            finally { Array.Clear(bytes, 0, bytes.Length); }
        } finally { CredFree(credential); }
    }
}
'@
        }
        $entryText = [ManapointQuotaCredential]::Load()
        if (-not $entryText) { throw 'login-not-found' }
        $entry = $entryText.TrimStart([char]0xFEFF) | ConvertFrom-Json
        $entryText = $null
        if ($null -ne $entry.token) { $entry = $entry.token }
        $token = $entry.access_token
        $expired = $true
        if ($entry.expiry) {
            try { $expired = [DateTimeOffset]::Parse($entry.expiry) -le [DateTimeOffset]::UtcNow.AddMinutes(5) }
            catch { $expired = $true }
        }
        if (-not $token -or $expired) {
            if (-not $entry.refresh_token) { throw 'sign-in-required' }
            $refresh = Invoke-RestMethod -Uri 'https://oauth2.googleapis.com/token' -Method Post -TimeoutSec 20 `
                -ContentType 'application/x-www-form-urlencoded' -Body @{
                    client_id = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com'
                    client_secret = ('GOCSPX-' + 'K58FWR486LdLJ1mLB8sXC4z6qDAf')
                    grant_type = 'refresh_token'
                    refresh_token = $entry.refresh_token
                }
            $token = $refresh.access_token
            $refresh = $null
            if (-not $token) { throw 'sign-in-required' }
        }
        $entry = $null
        $hub = 'antigravity/hub/2.9.1 windows/amd64'
        $hosts = @('https://daily-cloudcode-pa.googleapis.com', 'https://cloudcode-pa.googleapis.com')
        $setup = Invoke-QuotaPost ($hosts[0] + '/v1internal:loadCodeAssist') $token $hub @{
            metadata = @{ ideType = 'ANTIGRAVITY'; platform = 'PLATFORM_UNSPECIFIED'; pluginType = 'GEMINI' }
        }
        $project = $setup.data.cloudaicompanionProject
        if ($project -isnot [string]) { $project = $project.id }
        $results = @()
        foreach ($hostUrl in $hosts) {
            foreach ($agent in @('antigravity', $hub)) {
                $result = Invoke-QuotaPost ($hostUrl + '/v1internal:retrieveUserQuotaSummary') $token $agent @{}
                $safe = Get-SafeQuotaSummary $result
                $safe.host = $hostUrl
                $safe.client = $agent
                $safe.withProject = $false
                $results += $safe
            }
            if ($project) {
                $result = Invoke-QuotaPost ($hostUrl + '/v1internal:retrieveUserQuotaSummary') $token $hub @{ project = $project }
                $safe = Get-SafeQuotaSummary $result
                $safe.host = $hostUrl
                $safe.client = $hub
                $safe.withProject = $true
                $results += $safe
            }
        }
        $report.antigravity = @{ setupStatus = $setup.status; hasProject = [bool]$project; responses = $results }
    } catch {
        $report.antigravity = @{ error = 'Could not inspect agy login or quota; no credentials were printed.' }
    } finally {
        $token = $null; $entry = $null; $entryText = $null; $setup = $null; $result = $null
    }
}

if (-not $SkipMuse) {
    try {
        $authPath = $env:MUSE_AUTH_PATH
        if (-not $authPath) {
            $configRoot = $env:XDG_CONFIG_HOME
            if (-not $configRoot) { $configRoot = Join-Path $env:USERPROFILE '.config' }
            $authPath = Join-Path $configRoot 'muse/auth.json'
        }
        $auth = Get-Content -LiteralPath $authPath -Raw | ConvertFrom-Json
        $token = $auth.providers.meta.access_token
        if (-not $token -or -not $token.StartsWith('dca:')) { throw 'device-login-not-found' }
        $result = Invoke-QuotaPost 'https://api.meta.ai/muse-code/key' $token 'Manapoint' @{} @{ 'x-api-version' = '1.0.0' }
        $muse = [ordered]@{ status = $result.status }
        if ($result.ContainsKey('data')) {
            $muse.shape = Get-QuotaShape $result.data
            $muse.activeSubscription = $result.data.is_subs_active -eq $true
            $muse.hasUsage = $null -ne $result.data.subs_usage
        } else { $muse.error = $result.error }
        $report.muse = $muse
    } catch {
        $report.muse = @{ error = 'Could not inspect Muse device login or quota; no credentials were printed.' }
    } finally { $token = $null; $auth = $null; $result = $null }
}

$report | ConvertTo-Json -Depth 14
