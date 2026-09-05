using System.Text.Json;
using Manapoint.Models;

namespace Manapoint.Collectors;

/// <summary>
/// 解析 Grok 的 <c>GET /v1/billing?format=credits</c> 回應。純函式，不做 IO。
///
/// 同一個 endpoint 有兩種形狀：credits 形狀帶每週點數池
/// （<c>creditUsagePercent</c>），原形狀帶月結額度
/// （<c>monthlyLimit</c>／<c>used</c>）。opencode 的 xAI 登入在某些帳號上
/// 月結額度為 0，但每週點數池有數字，因此兩種訊號都要吃：
/// 有 weekly 百分比就顯示 WEEK，有月結上限就加 MONTH。
/// credits 形狀因帳號而異（預付／訂閱欄位不同），缺欄位就跳過，不斷線。
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

        var windows = new List<UsageWindow>(2);

        if (TryReadDouble(config, "creditUsagePercent", out var weeklyPercent))
        {
            windows.Add(new UsageWindow(
                UsageWindowKind.Weekly,
                Math.Clamp(weeklyPercent, 0, 100),
                ReadResetsAt(config)));
        }

        // 未設定上限的帳號無從計算比例，有上限才加 MONTH。
        if (TryReadAmount(config, "monthlyLimit", out var limit) && limit > 0)
        {
            TryReadAmount(config, "used", out var used);
            windows.Add(new UsageWindow(
                UsageWindowKind.Monthly,
                Math.Clamp(used / limit * 100, 0, 100),
                ReadPeriodEnd(config)));
        }

        if (windows.Count > 0)
            return new ProviderUsage(ProviderName, windows, collectedAt);

        // 兩種形狀都沒有可用訊號，說明清楚比畫一條 0% 誠實。
        TryReadAmount(config, "used", out var spent);
        return new ProviderUsage(
            ProviderName, [], collectedAt,
            Note: spent > 0
                ? $"本月已用 ${spent:0.##}，此帳號未設額度上限"
                : "此帳號沒有 Grok 訂閱額度");
    }

    private static bool TryReadDouble(JsonElement config, string key, out double value)
    {
        value = 0;
        return config.ValueKind == JsonValueKind.Object
            && config.TryGetProperty(key, out var element)
            && element.ValueKind == JsonValueKind.Number
            && (value = element.GetDouble()) >= 0;
    }

    /// <summary>金額欄位一律包在 <c>{ "val": n }</c> 裡；缺欄位回 false。</summary>
    private static bool TryReadAmount(JsonElement config, string key, out double value)
    {
        value = 0;
        return config.ValueKind == JsonValueKind.Object
            && config.TryGetProperty(key, out var wrapper)
            && wrapper.ValueKind == JsonValueKind.Object
            && wrapper.TryGetProperty("val", out var element)
            && element.ValueKind == JsonValueKind.Number
            && (value = element.GetDouble()) >= 0;
    }

    /// <summary>
    /// credits 形狀的重置時間：先看 <c>currentPeriod.end</c>，
    /// 沒有才退回 <c>billingPeriodEnd</c>，都沒有就留白。
    /// </summary>
    private static DateTimeOffset? ReadResetsAt(JsonElement config)
    {
        if (config.TryGetProperty("currentPeriod", out var period)
            && period.ValueKind == JsonValueKind.Object
            && period.TryGetProperty("end", out var end)
            && end.ValueKind == JsonValueKind.String
            && DateTimeOffset.TryParse(end.GetString(), out var currentEnd))
        {
            return currentEnd;
        }

        return ReadPeriodEnd(config);
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
