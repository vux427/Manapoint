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

    public string Id => descriptor.Id;
    public string Provider => descriptor.Name;

    /// <summary>精簡樣式把一家壓成一行，版面與其他樣式不同。</summary>
    public bool IsTextStyle => settings.Theme.MeterStyle == MeterStyle.Text;
    public bool IsRowStyle => !IsTextStyle;

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
        OnPropertyChanged(nameof(Rolling));
        OnPropertyChanged(nameof(Weekly));
        OnPropertyChanged(nameof(Monthly));
        OnPropertyChanged(nameof(HasRolling));
        OnPropertyChanged(nameof(HasWeekly));
        OnPropertyChanged(nameof(HasMonthly));
    }
}
