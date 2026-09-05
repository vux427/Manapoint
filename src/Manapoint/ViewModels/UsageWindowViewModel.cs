using Avalonia.Controls;
using Manapoint.Models;

namespace Manapoint.ViewModels;

/// <summary>單一窗口在卡片上的一條進度列。</summary>
public sealed partial class UsageWindowViewModel(UsageWindow window) : ViewModelBase
{
    public string Label => window.Kind switch
    {
        UsageWindowKind.Rolling => "5H",
        UsageWindowKind.Weekly => "WEEK",
        UsageWindowKind.Monthly => "MONTH",
        _ => throw new ArgumentOutOfRangeException(nameof(window)),
    };

    public int Percent => window.Percent;

    public string PercentText => $"{window.Percent}%";

    // 進度以兩欄星號比例呈現，避免 ProgressBar 模板的溢出問題。
    public GridLength UsedStar => new(window.Percent, GridUnitType.Star);
    public GridLength FreeStar => new(100 - window.Percent, GridUnitType.Star);

    /// <summary>距離重置的粗略倒數，例如 "4h" 或 "2d"。</summary>
    public string ResetsInText
    {
        get
        {
            var left = window.ResetsAt - DateTimeOffset.UtcNow;
            if (left <= TimeSpan.Zero) return "now";
            if (left.TotalHours < 1) return $"{(int)left.TotalMinutes}m";
            if (left.TotalDays < 1) return $"{(int)left.TotalHours}h";
            return $"{(int)left.TotalDays}d";
        }
    }
}
