using Avalonia.Media;
using CommunityToolkit.Mvvm.ComponentModel;
using Manapoint.Models;

namespace Manapoint.ViewModels;

/// <summary>一個服務的卡片。取數失敗時顯示指示而非靜默隱藏。</summary>
public sealed partial class ProviderCardViewModel(ProviderDescriptor descriptor) : ViewModelBase
{
    public string Provider => descriptor.Name;

    public string BadgeText => descriptor.Badge.Text;
    public IBrush BadgeBackground => new SolidColorBrush(descriptor.Badge.Background);
    public IBrush BadgeForeground => new SolidColorBrush(descriptor.Badge.Foreground);

    [ObservableProperty]
    public partial IReadOnlyList<UsageWindowViewModel> Windows { get; set; } = [];

    [ObservableProperty]
    public partial string? Error { get; set; }

    public bool HasError => Error is not null;

    public void Apply(ProviderUsage usage)
    {
        Windows = [.. usage.Windows.Select(w => new UsageWindowViewModel(w))];
        Error = null;
        OnPropertyChanged(nameof(HasError));
    }

    public void Fail(string message)
    {
        Windows = [];
        Error = message;
        OnPropertyChanged(nameof(HasError));
    }
}
