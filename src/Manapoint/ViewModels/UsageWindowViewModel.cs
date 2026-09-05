using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Manapoint.Models;

namespace Manapoint.ViewModels;

/// <summary>單一窗口在卡片上的一條量表。呈現方式由主題決定。</summary>
public sealed partial class UsageWindowViewModel(UsageWindow window, AppTheme theme) : ViewModelBase
{
    public UsageWindowKind Kind => window.Kind;

    public string Label => window.Kind switch
    {
        UsageWindowKind.Rolling => "5H",
        UsageWindowKind.Weekly => "WEEK",
        UsageWindowKind.Monthly => "MONTH",
        _ => throw new ArgumentOutOfRangeException(nameof(window)),
    };

    /// <summary>精簡樣式用的短標籤。</summary>
    public string ShortLabel => window.Kind switch
    {
        UsageWindowKind.Rolling => "5h",
        UsageWindowKind.Weekly => "7d",
        UsageWindowKind.Monthly => "30d",
        _ => throw new ArgumentOutOfRangeException(nameof(window)),
    };

    /// <summary>精簡樣式的一段文字，例如 "5h:12%"。</summary>
    public string CompactText => $"{ShortLabel}:{PercentText}";

    /// <summary>未滿 1% 但已動用時顯示 &lt;1%，避免看起來完全沒用。</summary>
    public string PercentText => window.Percent switch
    {
        0 => "0%",
        < 1 => "<1%",
        _ => $"{window.Percent:0}%",
    };

    /// <summary>接近上限時附一個符號，讓警示不只靠顏色。</summary>
    public string AlertText =>
        theme.Coloring == MeterColoring.Status && window.Percent >= StatusColors.CriticalAt
            ? "!"
            : "";

    public bool HasAlert => AlertText.Length > 0;

    public bool IsSegmented => theme.MeterStyle == MeterStyle.Segmented;
    public bool IsSmooth => theme.MeterStyle == MeterStyle.Smooth;

    /// <summary>終端風格在量表兩側加括號，強化字元介面的感覺。</summary>
    public bool HasBrackets => theme.Brackets;

    public CornerRadius SegmentRadius => new(theme.SegmentRadius);

    /// <summary>量表填色：依主題設定為固定強調色或狀態色。</summary>
    public IBrush FillBrush => new SolidColorBrush(
        theme.Coloring == MeterColoring.Status
            ? theme.Status.For(window.Percent)
            : theme.Accent);

    public IBrush TrackBrush => new SolidColorBrush(theme.Track);

    // 連續長條以兩欄星號比例呈現，避免 ProgressBar 模板的溢出問題。
    public GridLength UsedStar => new(window.Percent, GridUnitType.Star);
    public GridLength FreeStar => new(100 - window.Percent, GridUnitType.Star);

    /// <summary>分段樣式的格子。已用量四捨五入取格數，但只要動用過就至少亮一格。</summary>
    public IReadOnlyList<MeterSegmentViewModel> Segments
    {
        get
        {
            var count = AppTheme.SegmentCount;
            var lit = (int)Math.Round(window.Percent / 100 * count);
            if (window.Percent > 0) lit = Math.Max(lit, 1);
            lit = Math.Clamp(lit, 0, count);

            return [.. Enumerable.Range(0, count)
                .Select(i => new MeterSegmentViewModel(
                    i < lit, FillBrush, TrackBrush, SegmentRadius))];
        }
    }

    /// <summary>距離重置的粗略倒數，例如 "4h" 或 "2d"。服務未提供時留白。</summary>
    public string ResetsInText
    {
        get
        {
            if (window.ResetsAt is not { } resetsAt) return "";

            var left = resetsAt - DateTimeOffset.UtcNow;
            if (left <= TimeSpan.Zero) return "now";
            if (left.TotalHours < 1) return $"{(int)left.TotalMinutes}m";
            if (left.TotalDays < 1) return $"{(int)left.TotalHours}h";
            return $"{(int)left.TotalDays}d";
        }
    }
}

/// <summary>分段量表的一格。</summary>
public sealed class MeterSegmentViewModel(
    bool isLit, IBrush fill, IBrush track, CornerRadius radius)
{
    public IBrush Brush => isLit ? fill : track;
    public CornerRadius Radius => radius;
}
