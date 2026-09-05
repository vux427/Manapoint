using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Manapoint.Models;

namespace Manapoint.Collectors;

/// <summary>
/// 讀取 Grok 的月結額度。
///
/// 憑證取自 opencode 儲存的 xAI OAuth 登入——已驗證該 token 可通到
/// grok.com 的帳務介面，因此不必另外安裝 Grok CLI。
/// 本程式不換發 token，過期時請使用者回到 opencode 重新登入。
/// 詳見 docs/providers.md。
/// </summary>
public sealed class GrokCollector(HttpClient http) : IUsageCollector
{
    private const string BillingUrl = "https://cli-chat-proxy.grok.com/v1/billing";

    public string ProviderName => GrokUsageParser.ProviderName;

    public async Task<ProviderUsage> CollectAsync(CancellationToken ct = default)
    {
        var token = ReadAccessToken();

        using var request = new HttpRequestMessage(HttpMethod.Get, BillingUrl);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        using var response = await http.SendAsync(request, ct);

        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            throw new ProviderNotReadyException("登入已失效，請在 opencode 重新登入 xAI");

        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync(ct);
        return GrokUsageParser.Parse(json, DateTimeOffset.UtcNow);
    }

    private static string ReadAccessToken()
    {
        var path = OpenCodeAuth.FilePath;
        if (!File.Exists(path))
            throw new ProviderNotReadyException("找不到 opencode，請先安裝並登入 xAI");

        using var doc = JsonDocument.Parse(File.ReadAllText(path));

        if (!doc.RootElement.TryGetProperty("xai", out var entry))
            throw new ProviderNotReadyException("尚未登入 xAI，請在 opencode 登入");

        if (entry.TryGetProperty("expires", out var expires)
            && expires.ValueKind == JsonValueKind.Number
            && DateTimeOffset.FromUnixTimeMilliseconds(expires.GetInt64()) <= DateTimeOffset.UtcNow)
        {
            throw new ProviderNotReadyException("登入已過期，請在 opencode 重新登入 xAI");
        }

        var token = entry.TryGetProperty("access", out var access) ? access.GetString() : null;
        if (string.IsNullOrWhiteSpace(token))
            throw new ProviderNotReadyException("xAI 的登入資料不完整，請重新登入");

        return token;
    }
}
