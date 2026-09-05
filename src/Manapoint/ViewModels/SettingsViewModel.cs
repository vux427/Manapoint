using System.Collections.ObjectModel;
using Avalonia;
using Avalonia.Media;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Manapoint.Models;
using Manapoint.Services;

namespace Manapoint.ViewModels;

/// <summary>外觀與服務偏好。變更即時反映到畫面並寫回設定檔。</summary>
public sealed partial class SettingsViewModel : ViewModelBase
{
    /// <summary>
    /// 保證可讀的下限。低於此值，文字對比在淺色桌面上就撐不住——
    /// 這是算出來的，不是估的，ThemeContrastTests 以此為判準。
    /// </summary>
    public const double SafeOpacity = 0.80;

    /// <summary>滑桿容許的最低值。介於此與 <see cref="SafeOpacity"/> 之間屬使用者自負風險。</summary>
    public const double MinOpacity = 0.30;

    public const double MaxOpacity = 1.0;

    private readonly AppSettings _settings;
    private readonly HashSet<string> _enabled;

    /// <summary>勾選的服務有變動時觸發，讓主畫面重建卡片。</summary>
    public event Action? EnabledProvidersChanged;

    /// <summary>主題換了要重畫，量表樣式與配色都由主題決定。</summary>
    public event Action? PresentationChanged;

    public IReadOnlyList<ThemeOptionViewModel> ThemeOptions { get; }

    /// <summary>設定頁的服務清單，順序即顯示順序，可拖曳調整。</summary>
    public ObservableCollection<ProviderToggleViewModel> Providers { get; } = [];

    public SettingsViewModel()
    {
        _settings = SettingsStore.Load();
        // 舊設定檔可能存有低於現行下限的值，載入時夾回範圍並寫回，
        // 避免畫面與設定檔長期不一致。
        var clamped = Math.Clamp(_settings.PanelOpacity, MinOpacity, MaxOpacity);
        var needsRewrite = Math.Abs(clamped - _settings.PanelOpacity) > 0.001;
        _settings.PanelOpacity = clamped;

        _enabled = [.. _settings.EnabledProviders ?? [.. ProviderRegistry.DefaultEnabled]];

        Theme = AppTheme.ByName(_settings.ThemeName);
        ThemeOptions = [.. AppTheme.All.Select(t => new ThemeOptionViewModel(t, this))];

        foreach (var descriptor in ProviderRegistry.InOrder(_settings.ProviderOrder))
            Providers.Add(new ProviderToggleViewModel(descriptor, this));

        RefreshThemeSelection();

        if (needsRewrite) Persist();
    }

    [ObservableProperty]
    public partial AppTheme Theme { get; set; }

    public double PanelOpacity
    {
        get => _settings.PanelOpacity;
        set
        {
            var clamped = Math.Clamp(value, MinOpacity, MaxOpacity);
            if (Math.Abs(clamped - _settings.PanelOpacity) < 0.001) return;

            _settings.PanelOpacity = clamped;
            OnPropertyChanged();
            OnPropertyChanged(nameof(PanelBrush));
            OnPropertyChanged(nameof(OpacityText));
            OnPropertyChanged(nameof(IsBelowSafeOpacity));
            Persist();
        }
    }

    public string OpacityText => $"{PanelOpacity * 100:0}%";

    /// <summary>低於安全下限時提醒使用者，但不阻止。</summary>
    public bool IsBelowSafeOpacity => PanelOpacity < SafeOpacity;

    // 面板底色套用不透明度；文字與強調色維持不透明，避免整體糊掉。
    public IBrush PanelBrush => new SolidColorBrush(Theme.Panel, PanelOpacity);
    public IBrush AccentBrush => new SolidColorBrush(Theme.Accent);
    public IBrush TextPrimaryBrush => new SolidColorBrush(Theme.TextPrimary);
    public IBrush TextSecondaryBrush => new SolidColorBrush(Theme.TextSecondary);
    public IBrush TextMutedBrush => new SolidColorBrush(Theme.TextMuted);
    public IBrush TrackBrush => new SolidColorBrush(Theme.Track);
    public IBrush PanelBorderBrush => new SolidColorBrush(Theme.Border);


    /// <summary>終端風格改用等寬字，其餘沿用系統介面字型。</summary>
    public FontFamily PanelFont => Theme.Monospace
        ? new FontFamily("Cascadia Mono, Consolas, DejaVu Sans Mono, monospace")
        : FontFamily.Default;

    /// <summary>精簡樣式窄很多，面板寬度由主題決定。</summary>
    public double PanelWidth => Theme.PanelWidth;

    /// <summary>勾選的服務，依使用者排定的順序。</summary>
    public IReadOnlyList<string> EnabledProviderIds =>
        [.. Providers.Where(p => _enabled.Contains(p.Id)).Select(p => p.Id)];

    /// <summary>把某個服務移到指定位置，並立即反映到主畫面。</summary>
    public void MoveProvider(ProviderToggleViewModel provider, int targetIndex)
    {
        var from = Providers.IndexOf(provider);
        if (from < 0) return;

        targetIndex = Math.Clamp(targetIndex, 0, Providers.Count - 1);
        if (from == targetIndex) return;

        Providers.Move(from, targetIndex);
        Persist();
        EnabledProvidersChanged?.Invoke();
    }

    public bool IsEnabled(string id) => _enabled.Contains(id);

    public void SetEnabled(string id, bool enabled)
    {
        var changed = enabled ? _enabled.Add(id) : _enabled.Remove(id);
        if (!changed) return;

        Persist();
        EnabledProvidersChanged?.Invoke();
    }

    public void SelectTheme(AppTheme theme)
    {
        if (theme == Theme) return;

        Theme = theme;
        _settings.ThemeName = theme.Name;
        Persist();
        RefreshThemeSelection();
        PresentationChanged?.Invoke();
    }

    partial void OnThemeChanged(AppTheme value)
    {
        OnPropertyChanged(nameof(PanelBrush));
        OnPropertyChanged(nameof(AccentBrush));
        OnPropertyChanged(nameof(TextPrimaryBrush));
        OnPropertyChanged(nameof(TextSecondaryBrush));
        OnPropertyChanged(nameof(TextMutedBrush));
        OnPropertyChanged(nameof(TrackBrush));
        OnPropertyChanged(nameof(PanelBorderBrush));
        OnPropertyChanged(nameof(PanelFont));
        OnPropertyChanged(nameof(PanelWidth));
    }

    private void Persist()
    {
        _settings.EnabledProviders = [.. EnabledProviderIds];
        _settings.ProviderOrder = [.. Providers.Select(p => p.Id)];
        SettingsStore.Save(_settings);
    }

    private void RefreshThemeSelection()
    {
        foreach (var option in ThemeOptions)
            option.Refresh();
    }
}

/// <summary>設定頁的一個配色色票。</summary>
public sealed partial class ThemeOptionViewModel(AppTheme theme, SettingsViewModel owner)
    : ViewModelBase
{
    public string Name => theme.Name;
    public string Description => theme.Description;
    public IBrush Swatch => new SolidColorBrush(theme.Accent);
    public IBrush Backdrop => new SolidColorBrush(theme.Panel);
    public IBrush TrackSwatch => new SolidColorBrush(theme.Track);
    public bool IsSegmented => theme.MeterStyle == MeterStyle.Segmented;
    public bool IsSmooth => theme.MeterStyle == MeterStyle.Smooth;
    public bool IsTextStyle => theme.MeterStyle == MeterStyle.Text;

    /// <summary>純文字樣式的預覽字樣。</summary>
    public string PreviewText => "5h:12%";
    public IBrush PreviewTextBrush => new SolidColorBrush(
        theme.Coloring == MeterColoring.Status ? theme.Status.For(12) : theme.Accent);
    public bool IsSelected => owner.Theme == theme;

    /// <summary>色票上的預覽格子：亮起的用狀態色，示意這個主題的樣子。</summary>
    public IReadOnlyList<MeterSegmentViewModel> PreviewSegments =>
    [
        .. Enumerable.Range(0, 5).Select(i => new MeterSegmentViewModel(
            i < 3,
            new SolidColorBrush(theme.Coloring == MeterColoring.Status
                ? theme.Status.For(60)
                : theme.Accent),
            new SolidColorBrush(theme.Track),
            new CornerRadius(theme.SegmentRadius)))
    ];

    [RelayCommand]
    private void Select() => owner.SelectTheme(theme);

    public void Refresh() => OnPropertyChanged(nameof(IsSelected));
}

/// <summary>設定頁的一個服務開關。</summary>
public sealed partial class ProviderToggleViewModel : ViewModelBase
{
    private readonly ProviderDescriptor _descriptor;
    private readonly SettingsViewModel _owner;

    public ProviderToggleViewModel(ProviderDescriptor descriptor, SettingsViewModel owner)
    {
        _descriptor = descriptor;
        _owner = owner;
    }

    public string Id => _descriptor.Id;
    public string Name => _descriptor.Name;
    public bool IsAvailable => _descriptor.IsAvailable;

    public bool HasBadgeIcon => _descriptor.Badge.HasIcon;
    public Geometry? BadgeIcon => _descriptor.Badge.IconPath is { } d ? Geometry.Parse(d) : null;
    public string? BadgeText => _descriptor.Badge.Text;
    public IBrush BadgeBackground => new SolidColorBrush(_descriptor.Badge.Background);
    public IBrush BadgeForeground => new SolidColorBrush(_descriptor.Badge.Foreground);

    public string Hint => _descriptor.IsAvailable
        ? _descriptor.CredentialHint
        : "尚未支援";

    public bool IsEnabled
    {
        get => _owner.IsEnabled(_descriptor.Id);
        set
        {
            if (!_descriptor.IsAvailable) return;

            _owner.SetEnabled(_descriptor.Id, value);
            OnPropertyChanged();
        }
    }
}
