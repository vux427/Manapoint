using System.Text.Json;
using Manapoint.Models;

namespace Manapoint.Collectors;

/// <summary>
/// 解析 opencode Go 的 <c>GET /zen/go/v1/usage</c> 回應。
/// 純函式，不做 IO，便於測試。
/// </summary>
public static class OpenCodeGoUsageParser
{
    public const string ProviderName = "opencode Go";

    private static readonly (string Key, UsageWindowKind Kind)[] WindowMap =
    [
        ("rolling", UsageWindowKind.Rolling),
        ("weekly", UsageWindowKind.Weekly),
        ("monthly", UsageWindowKind.Monthly),
    ];

    /// <summary>
    /// 解析回應 JSON。格式不符即拋例外，不做寬容處理。
    /// </summary>
    public static ProviderUsage Parse(string json, DateTimeOffset collectedAt)
    {
        using var doc = JsonDocument.Parse(json);

        if (!doc.RootElement.TryGetProperty("usage", out var usage))
            throw new FormatException("opencode Go usage 回應缺少 'usage' 欄位。");

        var windows = new List<UsageWindow>(WindowMap.Length);
        foreach (var (key, kind) in WindowMap)
        {
            if (!usage.TryGetProperty(key, out var w))
                throw new FormatException($"opencode Go usage 回應缺少 '{key}' 窗口。");

            windows.Add(new UsageWindow(
                kind,
                w.GetProperty("percent").GetInt32(),
                w.GetProperty("resetsAt").GetDateTimeOffset()));
        }

        return new ProviderUsage(ProviderName, windows, collectedAt);
    }
}
