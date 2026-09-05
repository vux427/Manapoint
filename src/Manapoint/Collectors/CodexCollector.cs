using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Manapoint.Models;

namespace Manapoint.Collectors;

/// <summary>
/// 讀取 Codex 的 5 小時與每週用量。
/// 憑證取自使用者自己的 Codex CLI 登入；失效時保留上次數字並顯示指示。
/// 詳見 docs/providers.md。
/// </summary>
public sealed class CodexCollector(HttpClient http) : IUsageCollector
{
    private const string UsageUrl = "https://chatgpt.com/backend-api/wham/usage";

    public string ProviderName => CodexUsageParser.ProviderName;

    public async Task<ProviderUsage> CollectAsync(CancellationToken ct = default)
    {
        var (accessToken, accountId) = ReadCredentials();

        using var request = new HttpRequestMessage(HttpMethod.Get, UsageUrl);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        request.Headers.Add("chatgpt-account-id", accountId);

        using var response = await http.SendAsync(request, ct);

        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            throw new ProviderNotReadyException("登入已過期，請重新執行 codex 登入");

        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync(ct);
        return CodexUsageParser.Parse(json, DateTimeOffset.UtcNow);
    }

    private static (string AccessToken, string AccountId) ReadCredentials()
    {
        var path = CredentialPath();
        if (!File.Exists(path))
            throw new ProviderNotReadyException("找不到 Codex CLI，請先安裝並登入");

        using var doc = JsonDocument.Parse(File.ReadAllText(path));

        if (!doc.RootElement.TryGetProperty("tokens", out var tokens)
            || tokens.ValueKind == JsonValueKind.Null)
        {
            throw new ProviderNotReadyException("尚未登入，請執行 codex 登入");
        }

        var accessToken = tokens.TryGetProperty("access_token", out var a) ? a.GetString() : null;
        var accountId = tokens.TryGetProperty("account_id", out var b) ? b.GetString() : null;

        if (string.IsNullOrWhiteSpace(accessToken) || string.IsNullOrWhiteSpace(accountId))
            throw new ProviderNotReadyException("登入資料不完整，請重新執行 codex 登入");

        return (accessToken, accountId);
    }

    private static string CredentialPath() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        ".codex", "auth.json");
}
