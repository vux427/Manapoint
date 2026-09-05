using Avalonia.Media;
using CommunityToolkit.Mvvm.ComponentModel;
using Manapoint.Models;

namespace Manapoint.ViewModels;

/// <summary>一個服務的卡片。取數失敗時顯示指示而非靜默隱藏。</summary>
public sealed partial class ProviderCardViewModel(
    ProviderDescriptor descriptor,
    SettingsViewModel settings) : ViewModelBase
{
    private ProviderUsage? _latest;

    /// <summary>上次成功取數的原始資料（MarkStale 的說明文字不污染它），供快照寫檔。</summary>
    public ProviderUsage? LastGood => _latest;

    public string Id => descriptor.Id;
    public string Provider => descriptor.Name;

    /// <summary>精簡樣式把一家壓成一行，版面與其他樣式不同。</summary>
    public bool IsTextStyle => settings.Theme.MeterStyle == MeterStyle.Text;
    public bool IsRowStyle => !IsTextStyle;

    /// <summary>
    /// 橫向排列時每張卡片鎖成面板寬，星號欄（長條圖）才有寬度依據；
    /// 直向回傳 NaN 自動撐滿。版面切換走 PresentationChanged → Rerender → Notify。
    /// </summary>
    public double CardWidth => settings.IsHorizontalCards ? settings.PanelWidth : double.NaN;

    public bool HasBadgeIcon => descriptor.Badge.HasIcon;
    public Geometry? BadgeIcon => descriptor.Badge.IconPath is { } d ? Geometry.Parse(d) : null;
    public string? BadgeText => descriptor.Badge.Text;
    public IBrush BadgeBackground => new SolidColorBrush(descriptor.Badge.Background);
    public IBrush BadgeForeground => new SolidColorBrush(descriptor.Badge.Foreground);

    [ObservableProperty]
    public partial IReadOnlyList<UsageWindowViewModel> Windows { get; set; } = [];

    /// <summary>精簡樣式的固定欄位：每種窗口各佔一欄，缺席留空，欄位才對得齊。</summary>
    public UsageWindowViewModel? Rolling => Windows.FirstOrDefault(w => w.Kind == UsageWindowKind.Rolling);
    public UsageWindowViewModel? Weekly => Windows.FirstOrDefault(w => w.Kind == UsageWindowKind.Weekly);
    public UsageWindowViewModel? Monthly => Windows.FirstOrDefault(w => w.Kind == UsageWindowKind.Monthly);

    public bool HasRolling => Rolling is not null;
    public bool HasWeekly => Weekly is not null;
    public bool HasMonthly => Monthly is not null;

    /// <summary>沒有窗口可畫時的說明，例如帳號未設定額度上限。</summary>
    [ObservableProperty]
    public partial string? Note { get; set; }

    [ObservableProperty]
    public partial string? Error { get; set; }

    public bool HasError => Error is not null;
    public bool HasNote => Note is not null;

    public void Apply(ProviderUsage usage)
    {
        _latest = usage;
        Error = null;
        Render();
    }

    public void Fail(string message)
    {
        _latest = null;
        Windows = [];
        Note = null;
        Error = message;
        Notify();
    }

    /// <summary>
    /// 暫時性失敗（例如被限流）：留著上次數字，只加一行說明，
    /// 下次取數成功會自動蓋掉。完全沒拿過資料才比照 <see cref="Fail"/>。
    /// </summary>
    public void MarkStale(string message)
    {
        if (_latest is null)
        {
            Fail(message);
            return;
        }

        Error = null;
        Note = message;
        OnPropertyChanged(nameof(HasError));
        OnPropertyChanged(nameof(HasNote));
    }

    /// <summary>主題換了要重畫，量表樣式與配色都跟著主題走。</summary>
    public void Rerender()
    {
        if (_latest is not null) Render();
    }

    private void Render()
    {
        Windows = [.. _latest!.Windows.Select(w => new UsageWindowViewModel(w, settings.Theme))];
        Note = _latest.Note;
        Notify();
    }

    private void Notify()
    {
        OnPropertyChanged(nameof(HasError));
        OnPropertyChanged(nameof(HasNote));
        OnPropertyChanged(nameof(IsTextStyle));
        OnPropertyChanged(nameof(IsRowStyle));
        OnPropertyChanged(nameof(CardWidth));
        OnPropertyChanged(nameof(Rolling));
        OnPropertyChanged(nameof(Weekly));
        OnPropertyChanged(nameof(Monthly));
        OnPropertyChanged(nameof(HasRolling));
        OnPropertyChanged(nameof(HasWeekly));
        OnPropertyChanged(nameof(HasMonthly));
    }
}
