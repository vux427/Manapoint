using System.Net;
using System.Net.Http.Headers;
using Manapoint.Models;

namespace Manapoint.Collectors;

/// <summary>
/// 讀取 Grok 的每週點數池（credits 形狀），有月結上限的帳號兼取 MONTH。
///
/// 憑證取自 opencode 儲存的 xAI OAuth 登入，不必另外安裝 Grok CLI。
/// 注意 opencode 授權在某些帳號上月結額度為 0，但 credits 形狀的
/// 每週點數池有數字，因此打 <c>?format=credits</c> 而非原形狀。
/// access token 過期自動換發並寫回（見 <see cref="XaiTokenStore"/>）。
/// 詳見 docs/providers.md。
/// </summary>
public sealed class GrokCollector(HttpClient http) : IUsageCollector
{
    private const string BillingUrl = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";

    public string ProviderName => GrokUsageParser.ProviderName;

    public async Task<ProviderUsage> CollectAsync(CancellationToken ct = default)
    {
        // access 過期會在這裡自動換發並寫回（見 XaiTokenStore）。
        var token = await XaiTokenStore.GetAccessTokenAsync(http, ct);

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
}
