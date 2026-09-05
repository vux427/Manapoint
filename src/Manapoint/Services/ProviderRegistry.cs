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

    public static readonly IReadOnlyList<ProviderDescriptor> All =
    [
        new(OpenCodeGo, "opencode Go", "opencode CLI 登入狀態", IsAvailable: true),
        new(ClaudeCode, "Claude Code", "claude /login", IsAvailable: false),
        new(Codex, "Codex", "Codex CLI 登入狀態", IsAvailable: false),
        new(Grok, "Grok", "Grok CLI 登入狀態", IsAvailable: false),
    ];

    /// <summary>預設開啟所有已實作的服務。</summary>
    public static IEnumerable<string> DefaultEnabled =>
        All.Where(p => p.IsAvailable).Select(p => p.Id);

    public static ProviderDescriptor Get(string id) =>
        All.FirstOrDefault(p => p.Id == id)
        ?? throw new ArgumentException($"未知的 provider：{id}", nameof(id));

    /// <summary>建立取數器。未實作的服務不應走到這裡。</summary>
    public static IUsageCollector CreateCollector(string id, HttpClient http) => id switch
    {
        OpenCodeGo => new OpenCodeGoCollector(http),
        _ => throw new NotSupportedException($"{id} 的取數器尚未實作。"),
    };
}
