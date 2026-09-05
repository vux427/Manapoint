using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Manapoint.Models;

namespace Manapoint.Collectors;

/// <summary>
/// 讀取 Claude Code 的 5 小時與每週用量。
/// 憑證取自使用者自己的 Claude Code 登入；過期時保留上次數字並顯示指示，
/// Claude Code 下次執行換發後自動恢復。詳見 docs/providers.md。
/// </summary>
public sealed class ClaudeCodeCollector(HttpClient http) : IUsageCollector
{
    private const string UsageUrl = "https://api.anthropic.com/api/oauth/usage";

    public string ProviderName => ClaudeCodeUsageParser.ProviderName;

    public async Task<ProviderUsage> CollectAsync(CancellationToken ct = default)
    {
        var token = ReadAccessToken();

        using var request = new HttpRequestMessage(HttpMethod.Get, UsageUrl);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        using var response = await http.SendAsync(request, ct);

        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            throw new ProviderNotReadyException("登入已失效，請在 Claude Code 執行 /login");

        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync(ct);
        return ClaudeCodeUsageParser.Parse(json, DateTimeOffset.UtcNow);
    }

    private static string ReadAccessToken()
    {
        var path = CredentialPath();
        if (!File.Exists(path))
            throw new ProviderNotReadyException("找不到 Claude Code，請先安裝並執行 /login");

        using var doc = JsonDocument.Parse(File.ReadAllText(path));

        if (!doc.RootElement.TryGetProperty("claudeAiOauth", out var oauth))
            throw new ProviderNotReadyException("尚未登入，請在 Claude Code 執行 /login");

        if (oauth.TryGetProperty("expiresAt", out var expiresAt)
            && expiresAt.ValueKind == JsonValueKind.Number)
        {
            var expiry = DateTimeOffset.FromUnixTimeMilliseconds(expiresAt.GetInt64());
            if (expiry <= DateTimeOffset.UtcNow)
                throw new ProviderNotReadyException("登入已過期，請開啟 Claude Code 重新整理登入");
        }

        var token = oauth.GetProperty("accessToken").GetString();
        if (string.IsNullOrWhiteSpace(token))
            throw new ProviderNotReadyException("尚未登入，請在 Claude Code 執行 /login");

        return token;
    }

    private static string CredentialPath() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        ".claude", ".credentials.json");
}
