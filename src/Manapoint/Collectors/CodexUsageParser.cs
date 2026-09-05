using System.Text.Json;
using Manapoint.Models;

namespace Manapoint.Collectors;

/// <summary>
/// 解析 Codex 的 <c>GET /backend-api/wham/usage</c> 回應。
/// 純函式，不做 IO。
///
/// 回應含帳號 email 等個資，此處只取用量欄位，其餘一律不保留。
/// </summary>
public static class CodexUsageParser
{
    public const string ProviderName = "Codex";

    private const long OneDay = 86_400;
    private const long TenDays = 864_000;

    public static ProviderUsage Parse(string json, DateTimeOffset collectedAt)
    {
        using var doc = JsonDocument.Parse(json);

        if (!doc.RootElement.TryGetProperty("rate_limit", out var rateLimit)
            || rateLimit.ValueKind == JsonValueKind.Null)
        {
            throw new FormatException("Codex usage 回應缺少 'rate_limit'。");
        }

        var windows = new List<UsageWindow>(2);

        if (!TryReadWindow(rateLimit, "primary_window", out var primary))
            throw new FormatException("Codex usage 回應缺少 'primary_window'。");
        windows.Add(primary);

        // 部分方案沒有第二個窗口。
        if (TryReadWindow(rateLimit, "secondary_window", out var secondary))
            windows.Add(secondary);

        return new ProviderUsage(ProviderName, windows, collectedAt);
    }

    private static bool TryReadWindow(JsonElement rateLimit, string key, out UsageWindow window)
    {
        window = default!;

        if (!rateLimit.TryGetProperty(key, out var w) || w.ValueKind == JsonValueKind.Null)
            return false;

        var seconds = w.GetProperty("limit_window_seconds").GetInt64();

        window = new UsageWindow(
            KindFor(seconds),
            w.GetProperty("used_percent").GetDouble(),
            ReadResetAt(w));

        return true;
    }

    /// <summary>依窗口長度判斷類型，而非依欄位順序。</summary>
    private static UsageWindowKind KindFor(long windowSeconds) => windowSeconds switch
    {
        <= OneDay => UsageWindowKind.Rolling,
        <= TenDays => UsageWindowKind.Weekly,
        _ => UsageWindowKind.Monthly,
    };

    private static DateTimeOffset? ReadResetAt(JsonElement window)
    {
        if (!window.TryGetProperty("reset_at", out var value)
            || value.ValueKind != JsonValueKind.Number)
        {
            return null;
        }

        return DateTimeOffset.FromUnixTimeSeconds(value.GetInt64());
    }
}
