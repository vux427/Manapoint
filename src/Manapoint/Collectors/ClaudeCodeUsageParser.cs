using System.Text.Json;
using Manapoint.Models;

namespace Manapoint.Collectors;

/// <summary>
/// 解析 Claude Code 的 <c>GET /api/oauth/usage</c> 回應。
/// 純函式，不做 IO。
/// </summary>
public static class ClaudeCodeUsageParser
{
    public const string ProviderName = "Claude Code";

    private static readonly (string Key, UsageWindowKind Kind)[] WindowMap =
    [
        ("five_hour", UsageWindowKind.Rolling),
        ("seven_day", UsageWindowKind.Weekly),
    ];

    public static ProviderUsage Parse(string json, DateTimeOffset collectedAt)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        var windows = new List<UsageWindow>(WindowMap.Length);
        foreach (var (key, kind) in WindowMap)
        {
            if (!root.TryGetProperty(key, out var w) || w.ValueKind == JsonValueKind.Null)
                throw new FormatException($"Claude usage 回應缺少 '{key}' 窗口。");

            windows.Add(new UsageWindow(
                kind,
                w.GetProperty("utilization").GetDouble(),
                ReadResetsAt(w)));
        }

        return new ProviderUsage(ProviderName, windows, collectedAt);
    }

    /// <summary>Claude 對部分窗口會回傳 null 的重置時間。</summary>
    private static DateTimeOffset? ReadResetsAt(JsonElement window)
    {
        if (!window.TryGetProperty("resets_at", out var value)) return null;
        return value.ValueKind == JsonValueKind.Null ? null : value.GetDateTimeOffset();
    }
}
