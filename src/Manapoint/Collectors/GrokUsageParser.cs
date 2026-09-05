using System.Text.Json;
using Manapoint.Models;

namespace Manapoint.Collectors;

/// <summary>
/// 解析 Grok 的 <c>GET /v1/billing</c> 回應。純函式，不做 IO。
///
/// Grok 只有月結額度，沒有滾動或每週窗口。
/// </summary>
public static class GrokUsageParser
{
    public const string ProviderName = "Grok";

    public static ProviderUsage Parse(string json, DateTimeOffset collectedAt)
    {
        using var doc = JsonDocument.Parse(json);

        if (!doc.RootElement.TryGetProperty("config", out var config)
            || config.ValueKind == JsonValueKind.Null)
        {
            throw new FormatException("Grok billing 回應缺少 'config'。");
        }

        var limit = ReadAmount(config, "monthlyLimit");
        var used = ReadAmount(config, "used");

        // 未設定上限的帳號無從計算比例，說明清楚比畫一條 0% 誠實。
        if (limit <= 0)
        {
            return new ProviderUsage(
                ProviderName, [], collectedAt,
                Note: used > 0
                    ? $"本月已用 ${used:0.##}，此帳號未設額度上限"
                    : "此帳號沒有 Grok 訂閱額度");
        }

        var window = new UsageWindow(
            UsageWindowKind.Monthly,
            Math.Clamp(used / limit * 100, 0, 100),
            ReadPeriodEnd(config));

        return new ProviderUsage(ProviderName, [window], collectedAt);
    }

    /// <summary>金額欄位一律包在 <c>{ "val": n }</c> 裡。</summary>
    private static double ReadAmount(JsonElement config, string key)
    {
        if (!config.TryGetProperty(key, out var wrapper) || wrapper.ValueKind == JsonValueKind.Null)
            throw new FormatException($"Grok billing 回應缺少 '{key}'。");

        return wrapper.GetProperty("val").GetDouble();
    }

    private static DateTimeOffset? ReadPeriodEnd(JsonElement config)
    {
        if (!config.TryGetProperty("billingPeriodEnd", out var value)
            || value.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return value.GetDateTimeOffset();
    }
}
