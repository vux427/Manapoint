$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'diagnose-quotas.ps1') -SkipAntigravity -SkipMuse | Out-Null

# The source fixture includes the kinds of secrets returned by both login APIs.
# Only field types and quota vocabulary may survive diagnostic serialization.
$fixture = @{
    status = 200
    data = [pscustomobject]@{
        access_token = 'synthetic-access-secret'
        api_key = 'synthetic-inference-secret'
        user_email = 'synthetic-account@example.invalid'
        groups = @([pscustomobject]@{
            displayName = 'Gemini Models'
            buckets = @([pscustomobject]@{
                bucketId = 'gemini-weekly'
                remainingFraction = 0.75
                remaining = [pscustomobject]@{ case = 'remainingFraction'; value = 0.75 }
            })
        })
    }
}
$safe = Get-SafeQuotaSummary $fixture
$json = $safe | ConvertTo-Json -Depth 14
foreach ($secret in @('synthetic-access-secret', 'synthetic-inference-secret', 'synthetic-account@example.invalid')) {
    if ($json.Contains($secret)) { throw 'A diagnostic leaked a synthetic secret' }
}
if ($safe.groups[0].buckets[0].remainingFraction -ne 0.75) { throw 'Quota fraction was lost' }
if ($safe.groups[0].displayName -ne 'Gemini Models') { throw 'Quota group was lost' }
$fixture.data.groups[0].buckets[0].remainingFraction = 'synthetic-access-secret'
$json = Get-SafeQuotaSummary $fixture | ConvertTo-Json -Depth 14
if ($json.Contains('synthetic-access-secret')) { throw 'A malformed fraction leaked a secret' }
$safeError = Get-SafeQuotaSummary @{ status = 403; error = 'request-failed' }
if ($safeError.status -ne 403 -or $safeError.Contains('shape')) { throw 'HTTP error was not sanitized' }
Write-Output 'Quota diagnostic redaction tests passed.'
