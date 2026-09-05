using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Manapoint.Models;

namespace Manapoint.Collectors;

/// <summary>
/// 讀取 Grok 的每週點數池（credits 形狀），有月結上限的帳號兼取 MONTH。
///
/// 憑證取自 opencode 儲存的 xAI OAuth 登入，不必另外安裝 Grok CLI。
/// 注意 opencode 授權在某些帳號上月結額度為 0，但 credits 形狀的
/// 每週點數池有數字，因此打 <c>?format=credits</c> 而非原形狀。
/// 本程式不換發 token；access token 過期時 opencode 下次執行會自動換發，
/// 每 5 分鐘重試即自動恢復。詳見 docs/providers.md。
/// </summary>
public sealed class GrokCollector(HttpClient http) : IUsageCollector
{
    private const string BillingUrl = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";

    public string ProviderName => GrokUsageParser.ProviderName;

    public async Task<ProviderUsage> CollectAsync(CancellationToken ct = default)
    {
        var token = ReadAccessToken();

        using var request = new HttpRequestMessage(HttpMethod.Get, BillingUrl);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.TryAddWithoutValidation("x-xai-token-auth", "xai-grok-cli");
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

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
            // access token 壽命只有幾小時；opencode 下次執行時會自己換發，
            // 所以這裡只是暫時拿不到，不需要使用者重新登入。
            throw new ProviderNotReadyException("xAI 登入已過期，跑一下 opencode 即自動換發恢復");
        }

        var token = entry.TryGetProperty("access", out var access) ? access.GetString() : null;
        if (string.IsNullOrWhiteSpace(token))
            throw new ProviderNotReadyException("xAI 的登入資料不完整，請重新登入");

        return token;
    }
}
