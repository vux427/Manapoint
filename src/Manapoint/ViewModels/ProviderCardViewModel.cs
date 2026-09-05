using CommunityToolkit.Mvvm.ComponentModel;
using Manapoint.Models;

namespace Manapoint.ViewModels;

/// <summary>一個服務的卡片。取數失敗時顯示錯誤而非靜默隱藏。</summary>
public sealed partial class ProviderCardViewModel(string provider) : ViewModelBase
{
    public string Provider { get; } = provider;

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
