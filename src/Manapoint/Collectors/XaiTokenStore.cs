using System.Net;
using System.Text.Json;

namespace Manapoint.Collectors;

/// <summary>
/// opencode 存的 xAI OAuth 登入（auth.json 的 "xai" 節）。
/// expires 缺席視為未知、一律換發（與 opencode 本身行為一致）。
/// </summary>
public sealed record XaiEntry(string Type, string Access, string Refresh, long ExpiresMs);

/// <summary>
/// opencode xAI 登入的讀取與自動換發。
///
/// 換發規格抄自 opencode 開源的 plugin/xai.ts：POST
/// https://auth.x.ai/oauth2/token，公開的 Grok-CLI client_id，
/// form 參數 grant_type / refresh_token / client_id；
/// 回傳 access_token（必填）、refresh_token（輪換，未必每次都給）、
/// expires_in 秒數（缺席當 3600）。
///
/// 這是憑證政策唯一的例外：只限 opencode xAI 這一組——同機同使用者、
/// 寫回 opencode 自己管理的同一個檔案、client_id 是公開值。
/// 並發換發造成舊 refresh token 被消費時，重讀檔案用贏家的那組，
/// 只有檔案也救不回來才叫使用者重新登入。
/// </summary>
public static class XaiTokenStore
{
    /// <summary>公開的 Grok-CLI OAuth client（opencode 開源碼內嵌此值，非密鑰）。</summary>
    public const string ClientId = "b1a00492-073a-47ea-816f-4c329264a828";

    public const string TokenUrl = "https://auth.x.ai/oauth2/token";

    /// <summary>到期前多久就提前換發，避免 token 用到一半過期。輪詢是 5 分鐘一次。</summary>
    public static readonly TimeSpan RefreshSkew = TimeSpan.FromMinutes(5);

    private const long DefaultExpiresInSeconds = 3600;

    /// <summary>讀檔，拿可用 access token；需要就換發並寫回。只拋 <see cref="ProviderNotReadyException"/>。</summary>
    public static async Task<string> GetAccessTokenAsync(HttpClient http, CancellationToken ct = default)
    {
        var path = OpenCodeAuth.FilePath;
        if (!File.Exists(path))
            throw new ProviderNotReadyException("找不到 opencode，請先安裝並登入 xAI");

        var entry = ReadEntry(path);
        if (entry is null)
            throw new ProviderNotReadyException("尚未登入 xAI，請在 opencode 登入");

        if (!NeedsRefresh(entry, DateTimeOffset.UtcNow))
            return entry.Access;

        if (string.IsNullOrWhiteSpace(entry.Refresh))
            throw new ProviderNotReadyException("xAI 登入已過期，請在 opencode 重新登入");

        HttpResponseMessage response;
        try
        {
            using var request = BuildRefreshRequest(entry.Refresh);
            response = await http.SendAsync(request, ct);
        }
        catch (HttpRequestException ex)
        {
            throw new ProviderNotReadyException($"xAI 換發連線失敗，稍後自動重試（{ex.Message}）");
        }

        if (response.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.Unauthorized)
        {
            // refresh token 已被消費或作廢（可能 opencode 那邊先換發了）。
            // 重讀檔案：贏家寫的新 token 能用就直接用，不行才叫人重登入。
            response.Dispose();
            var latest = SafeReadEntry(path);
            if (latest is not null
                && latest.Access != entry.Access
                && !NeedsRefresh(latest, DateTimeOffset.UtcNow))
            {
                return latest.Access;
            }

            throw new ProviderNotReadyException("xAI 登入已失效，請在 opencode 重新登入");
        }

        string body;
        try
        {
            response.EnsureSuccessStatusCode();
            body = await response.Content.ReadAsStringAsync(ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            throw new ProviderNotReadyException("xAI 換發失敗，稍後自動重試");
        }
        finally
        {
            response.Dispose();
        }

        var refreshed = ApplyRefresh(entry, body, DateTimeOffset.UtcNow);
        Persist(path, refreshed);
        return refreshed.Access;
    }

    /// <summary>過期或即將過期（± skew）就該換發；expires 缺席視為未知、一律換發。</summary>
    public static bool NeedsRefresh(XaiEntry entry, DateTimeOffset now) =>
        string.IsNullOrWhiteSpace(entry.Access)
        || entry.ExpiresMs <= 0
        || DateTimeOffset.FromUnixTimeMilliseconds(entry.ExpiresMs) <= now + RefreshSkew;

    /// <summary>標準 OAuth refresh 換發請求（form 編碼）。</summary>
    public static HttpRequestMessage BuildRefreshRequest(string refreshToken) =>
        new(HttpMethod.Post, TokenUrl)
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "refresh_token",
                ["refresh_token"] = refreshToken,
                ["client_id"] = ClientId,
            }),
        };

    /// <summary>
    /// 把換發回應套用到舊 entry：access_token 必填；refresh_token 沒給就沿用舊的
    /// （輪換制下舊的已被消費，但留著比清空好，下次 4xx 會走重讀路徑）；
    /// expires_in 缺席當 3600 秒（與 opencode 一致）。
    /// </summary>
    public static XaiEntry ApplyRefresh(XaiEntry old, string responseJson, DateTimeOffset now)
    {
        string access, refresh;
        long expiresIn;
        try
        {
            using var doc = JsonDocument.Parse(responseJson);
            var root = doc.RootElement;
            access = root.TryGetProperty("access_token", out var a) ? a.GetString() ?? "" : "";
            refresh = root.TryGetProperty("refresh_token", out var r) && !string.IsNullOrWhiteSpace(r.GetString())
                ? r.GetString()!
                : old.Refresh;
            expiresIn = root.TryGetProperty("expires_in", out var e) && e.ValueKind == JsonValueKind.Number
                ? e.GetInt64()
                : DefaultExpiresInSeconds;
        }
        catch (JsonException ex)
        {
            throw new ProviderNotReadyException($"xAI 換發回應異常，稍後自動重試（{ex.Message}）");
        }

        if (string.IsNullOrWhiteSpace(access))
            throw new ProviderNotReadyException("xAI 換發回應缺少 access_token，稍後自動重試");

        return old with
        {
            Access = access,
            Refresh = refresh,
            ExpiresMs = now.AddSeconds(Math.Max(expiresIn, 0)).ToUnixTimeMilliseconds(),
        };
    }

    /// <summary>把新 entry 合併回檔案 JSON，只動 "xai" 節，其他服務原樣保留。</summary>
    public static string MergeEntry(string originalFileJson, XaiEntry updated)
    {
        using var doc = JsonDocument.Parse(originalFileJson);
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Indented = true }))
        {
            writer.WriteStartObject();
            foreach (var property in doc.RootElement.EnumerateObject())
            {
                if (property.NameEquals("xai"))
                {
                    writer.WritePropertyName("xai");
                    writer.WriteStartObject();
                    writer.WriteString("type", updated.Type);
                    writer.WriteString("access", updated.Access);
                    writer.WriteString("refresh", updated.Refresh);
                    writer.WriteNumber("expires", updated.ExpiresMs);
                    writer.WriteEndObject();
                }
                else
                {
                    property.WriteTo(writer);
                }
            }
            writer.WriteEndObject();
        }

        return System.Text.Encoding.UTF8.GetString(stream.ToArray());
    }

    private static XaiEntry? ReadEntry(string path)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        return ParseEntry(doc.RootElement);
    }

    private static XaiEntry? SafeReadEntry(string path)
    {
        try
        {
            return ReadEntry(path);
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static XaiEntry? ParseEntry(JsonElement root)
    {
        if (!root.TryGetProperty("xai", out var entry) || entry.ValueKind != JsonValueKind.Object)
            return null;

        var access = entry.TryGetProperty("access", out var a) ? a.GetString() : null;
        if (string.IsNullOrWhiteSpace(access)) return null;

        var expires = entry.TryGetProperty("expires", out var e) && e.ValueKind == JsonValueKind.Number
            ? e.GetInt64()
            : 0;

        return new XaiEntry(
            entry.TryGetProperty("type", out var t) ? t.GetString() ?? "oauth" : "oauth",
            access,
            entry.TryGetProperty("refresh", out var r) ? r.GetString() ?? "" : "",
            expires);
    }

    /// <summary>
    /// 原子寫回：同目錄暫存檔＋搬移覆蓋，避免寫一半當掉毀掉憑證檔。
    /// 寫回失敗不致命（記憶體裡的新 token 這輪照用），吞掉只求不中斷取數。
    /// </summary>
    private static void Persist(string path, XaiEntry updated)
    {
        try
        {
            // 寫之前重讀一次，opencode 可能在我們換發的同時自己也寫過。
            var latest = File.ReadAllText(path);
            var merged = MergeEntry(latest, updated);
            var tmp = path + ".tmp";
            File.WriteAllText(tmp, merged);
            File.Move(tmp, path, overwrite: true);
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
        }
    }
}
