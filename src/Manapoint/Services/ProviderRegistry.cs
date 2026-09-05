using Manapoint.Collectors;
using Manapoint.Models;

namespace Manapoint.Services;

/// <summary>所有支援（或計畫支援）的服務。新增一家就在這裡註冊。</summary>
public static class ProviderRegistry
{
    public const string OpenCodeGo = "opencode-go";
    public const string ClaudeCode = "claude-code";
    public const string Codex = "codex";
    public const string Grok = "grok";

    // 三家的品牌色都偏黑，靠標誌形狀分辨即可；opencode 改用白底避免全黑一片。
    public static readonly IReadOnlyList<ProviderDescriptor> All =
    [
        new(OpenCodeGo, "opencode Go", "opencode CLI 登入狀態", IsAvailable: true,
            ProviderBadge.Icon(ProviderIcons.OpenCode, "#F2F2F2", darkGlyph: true)),
        new(ClaudeCode, "Claude Code", "Claude Code 登入狀態", IsAvailable: true,
            ProviderBadge.Icon(ProviderIcons.Claude, "#D97757")),
        new(Codex, "Codex", "Codex CLI 登入狀態", IsAvailable: true,
            ProviderBadge.Icon(ProviderIcons.OpenAI, "#000000")),
        new(Grok, "Grok", "opencode 的 xAI 登入", IsAvailable: true,
            ProviderBadge.Icon(ProviderIcons.Grok, "#1A1A1A")),
    ];

    /// <summary>預設開啟所有已實作的服務。</summary>
    public static IEnumerable<string> DefaultEnabled =>
        All.Where(p => p.IsAvailable).Select(p => p.Id);

    /// <summary>
    /// 依偏好順序排列所有服務。順序清單中沒提到的（例如新增的服務）
    /// 補在最後，順序清單中已不存在的 id 則略過。
    /// </summary>
    public static IReadOnlyList<ProviderDescriptor> InOrder(IEnumerable<string>? order)
    {
        if (order is null) return All;

        var known = All.ToDictionary(p => p.Id);
        var listed = order.Where(known.ContainsKey).Select(id => known[id]).ToList();
        var listedIds = listed.Select(p => p.Id).ToHashSet();

        return [.. listed, .. All.Where(p => !listedIds.Contains(p.Id))];
    }

    public static ProviderDescriptor Get(string id) =>
        All.FirstOrDefault(p => p.Id == id)
        ?? throw new ArgumentException($"未知的 provider：{id}", nameof(id));

    /// <summary>建立取數器。未實作的服務不應走到這裡。</summary>
    public static IUsageCollector CreateCollector(string id, HttpClient http) => id switch
    {
        OpenCodeGo => new OpenCodeGoCollector(http),
        ClaudeCode => new ClaudeCodeCollector(http),
        Codex => new CodexCollector(http),
        Grok => new GrokCollector(http),
        _ => throw new NotSupportedException($"{id} 的取數器尚未實作。"),
    };
}
