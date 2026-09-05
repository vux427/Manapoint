namespace Manapoint.Models;

/// <summary>訂閱用量的重置窗口類型。</summary>
public enum UsageWindowKind
{
    /// <summary>滾動短窗口，多數方案為 5 小時。</summary>
    Rolling,
    Weekly,
    Monthly,
}

/// <summary>單一重置窗口的已用比例與下次重置時間。</summary>
/// <param name="Percent">已使用百分比，0–100。</param>
/// <param name="ResetsAt">下次重置時間；服務未提供時為 null。</param>
public sealed record UsageWindow(UsageWindowKind Kind, double Percent, DateTimeOffset? ResetsAt)
{
    public double RemainingPercent => 100 - Percent;
}

/// <summary>單一服務在各窗口的用量快照。</summary>
/// <param name="Note">
/// 沒有窗口可畫時的說明，例如帳號未設定額度上限。
/// 這不是錯誤，因此與 <c>Error</c> 分開表示。
/// </param>
public sealed record ProviderUsage(
    string Provider,
    IReadOnlyList<UsageWindow> Windows,
    DateTimeOffset CollectedAt,
    string? Note = null);
