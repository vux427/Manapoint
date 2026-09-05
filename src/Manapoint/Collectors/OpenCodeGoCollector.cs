using System.Net.Http.Headers;
using System.Text.Json;
using Manapoint.Models;

namespace Manapoint.Collectors;

/// <summary>
/// 從 opencode Go 讀取 rolling / weekly / monthly 三個窗口。
/// 憑證取自 opencode CLI 既有的登入狀態，本程式不另外要求 API key。
/// 詳見 docs/providers.md。
/// </summary>
public sealed class OpenCodeGoCollector(HttpClient http) : IUsageCollector
{
    private const string UsageUrl = "https://opencode.ai/zen/go/v1/usage";

    public string ProviderName => OpenCodeGoUsageParser.ProviderName;

    public async Task<ProviderUsage> CollectAsync(CancellationToken ct = default)
    {
        var key = ReadApiKey();

        using var request = new HttpRequestMessage(HttpMethod.Get, UsageUrl);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);

        using var response = await http.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync(ct);
        return OpenCodeGoUsageParser.Parse(json, DateTimeOffset.UtcNow);
    }

    /// <summary>讀取 opencode CLI 存放的 Go API key。找不到即拋例外。</summary>
    private static string ReadApiKey()
    {
        var path = AuthFilePath();
        if (!File.Exists(path))
            throw new FileNotFoundException($"找不到 opencode 認證檔，請先執行 `opencode` 登入。", path);

        using var doc = JsonDocument.Parse(File.ReadAllText(path));

        if (!doc.RootElement.TryGetProperty("opencode-go", out var entry))
            throw new InvalidOperationException("opencode 認證檔中沒有 opencode-go，請先訂閱並登入 Go。");

        var key = entry.GetProperty("key").GetString();
        if (string.IsNullOrWhiteSpace(key))
            throw new InvalidOperationException("opencode-go 的 key 為空。");

        return key;
    }

    private static string AuthFilePath()
    {
        var dataHome = Environment.GetEnvironmentVariable("XDG_DATA_HOME");
        if (string.IsNullOrWhiteSpace(dataHome))
        {
            dataHome = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                ".local", "share");
        }

        return Path.Combine(dataHome, "opencode", "auth.json");
    }
}
