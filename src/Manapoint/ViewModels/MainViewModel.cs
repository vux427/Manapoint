using System.Collections.ObjectModel;
using Avalonia.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Manapoint.Collectors;

namespace Manapoint.ViewModels;

public sealed partial class MainViewModel : ViewModelBase
{
    private static readonly TimeSpan RefreshInterval = TimeSpan.FromMinutes(5);

    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(20) };
    private readonly List<(IUsageCollector Collector, ProviderCardViewModel Card)> _sources = [];
    private readonly DispatcherTimer _timer;

    public ObservableCollection<ProviderCardViewModel> Cards { get; } = [];

    [ObservableProperty]
    public partial string StatusText { get; set; } = "尚未更新";

    public MainViewModel()
    {
        Register(new OpenCodeGoCollector(_http));

        _timer = new DispatcherTimer { Interval = RefreshInterval };
        _timer.Tick += async (_, _) => await RefreshAsync();
        _timer.Start();

        _ = RefreshAsync();
    }

    private void Register(IUsageCollector collector)
    {
        var card = new ProviderCardViewModel(collector.ProviderName);
        _sources.Add((collector, card));
        Cards.Add(card);
    }

    [RelayCommand]
    public async Task RefreshAsync()
    {
        foreach (var (collector, card) in _sources)
        {
            try
            {
                card.Apply(await collector.CollectAsync());
            }
            catch (HttpRequestException ex)
            {
                card.Fail($"連線失敗：{ex.StatusCode?.ToString() ?? ex.Message}");
            }
            catch (FileNotFoundException)
            {
                card.Fail("未登入");
            }
            catch (InvalidOperationException ex)
            {
                card.Fail(ex.Message);
            }
        }

        StatusText = $"更新於 {DateTime.Now:HH:mm}";
    }
}
