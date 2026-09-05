using Manapoint.Collectors;

namespace Manapoint.Tests;

public class XaiTokenStoreTests
{
    private static readonly DateTimeOffset Now =
        DateTimeOffset.FromUnixTimeMilliseconds(1788624612000);

    private static XaiEntry Entry(long expiresMs, string access = "a", string refresh = "r") =>
        new("oauth", access, refresh, expiresMs);

    private static long Ms(DateTimeOffset t) => t.ToUnixTimeMilliseconds();

    [Fact]
    public void NeedsRefresh_FreshToken()
    {
        var entry = Entry(Ms(Now.AddHours(2)));

        Assert.False(XaiTokenStore.NeedsRefresh(entry, Now));
    }

    [Fact]
    public void NeedsRefresh_ExpiredToken()
    {
        var entry = Entry(Ms(Now.AddHours(-1)));

        Assert.True(XaiTokenStore.NeedsRefresh(entry, Now));
    }

    /// <summary>到期前 5 分鐘內就提前換，避免用到一半過期。</summary>
    [Theory]
    [InlineData(4, true)]
    [InlineData(6, false)]
    public void NeedsRefresh_ProactiveSkew(int minutesLeft, bool expected)
    {
        var entry = Entry(Ms(Now.AddMinutes(minutesLeft)));

        Assert.Equal(expected, XaiTokenStore.NeedsRefresh(entry, Now));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void NeedsRefresh_MissingExpiry_AlwaysRefreshes(long expiresMs)
    {
        Assert.True(XaiTokenStore.NeedsRefresh(Entry(expiresMs), Now));
    }

    [Fact]
    public void NeedsRefresh_EmptyAccess_Refreshes()
    {
        Assert.True(XaiTokenStore.NeedsRefresh(Entry(Ms(Now.AddHours(2)), access: ""), Now));
    }

    [Fact]
    public void BuildRefreshRequest_PostsOAuthForm()
    {
        using var request = XaiTokenStore.BuildRefreshRequest("refresh-secret");

        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal(new Uri(XaiTokenStore.TokenUrl), request.RequestUri);
    }

    [Fact]
    public async Task BuildRefreshRequest_EncodesGrantAndPublicClient()
    {
        using var request = XaiTokenStore.BuildRefreshRequest("refresh-secret");
        var body = await request.Content!.ReadAsStringAsync();

        Assert.Contains("grant_type=refresh_token", body);
        Assert.Contains("refresh_token=refresh-secret", body);
        Assert.Contains("client_id=" + XaiTokenStore.ClientId, body);
    }

    [Fact]
    public void ApplyRefresh_RotatesTokens()
    {
        const string json = """
        {"access_token":"new-access","refresh_token":"new-refresh","expires_in":7200}
        """;

        var updated = XaiTokenStore.ApplyRefresh(Entry(Ms(Now)), json, Now);

        Assert.Equal("new-access", updated.Access);
        Assert.Equal("new-refresh", updated.Refresh);
        Assert.Equal(Ms(Now.AddHours(2)), updated.ExpiresMs);
    }

    /// <summary>沒給新 refresh 就沿用舊的；expires_in 缺席當 3600 秒（與 opencode 一致）。</summary>
    [Fact]
    public void ApplyRefresh_KeepsOldRefreshAndDefaultsExpiry()
    {
        const string json = """{"access_token":"new-access"}""";

        var updated = XaiTokenStore.ApplyRefresh(Entry(Ms(Now), refresh: "old-r"), json, Now);

        Assert.Equal("old-r", updated.Refresh);
        Assert.Equal(Ms(Now.AddHours(1)), updated.ExpiresMs);
    }

    [Fact]
    public void ApplyRefresh_RejectsMissingAccessToken()
    {
        var ex = Assert.Throws<ProviderNotReadyException>(
            () => XaiTokenStore.ApplyRefresh(Entry(0), """{"refresh_token":"x"}""", Now));

        Assert.Contains("access_token", ex.Message);
    }

    [Fact]
    public void MergeEntry_OnlyTouchesXai()
    {
        const string original = """
        {
          "opencode-go": { "key": "sk-keep" },
          "xai": { "type": "oauth", "access": "old", "refresh": "old-r", "expires": 1 }
        }
        """;

        var merged = XaiTokenStore.MergeEntry(original, Entry(2, "new", "new-r"));
        using var doc = System.Text.Json.JsonDocument.Parse(merged);

        Assert.Equal("sk-keep", doc.RootElement.GetProperty("opencode-go").GetProperty("key").GetString());
        var xai = doc.RootElement.GetProperty("xai");
        Assert.Equal("new", xai.GetProperty("access").GetString());
        Assert.Equal("new-r", xai.GetProperty("refresh").GetString());
        Assert.Equal(2, xai.GetProperty("expires").GetInt64());
    }
}
