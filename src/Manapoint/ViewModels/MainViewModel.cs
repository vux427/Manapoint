using System.Collections.ObjectModel;
using Avalonia.Threading;
using CommunityToolkit.Mvvm.Input;
using Manapoint.Collectors;
using Manapoint.Services;

namespace Manapoint.ViewModels;

public sealed partial class MainViewModel : ViewModelBase
{
    private static readonly TimeSpan RefreshInterval = TimeSpan.FromMinutes(5);

    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(20) };
    private readonly List<(IUsageCollector Collector, ProviderCardViewModel Card)> _sources = [];
    private readonly DispatcherTimer _timer;

    public SettingsViewModel Settings { get; } = new();

    public ObservableCollection<ProviderCardViewModel> Cards { get; } = [];

    public MainViewModel()
    {
        Settings.EnabledProvidersChanged += OnEnabledProvidersChanged;
        Settings.PresentationChanged += OnPresentationChanged;
        RebuildSources();

        _timer = new DispatcherTimer { Interval = RefreshInterval };
        _timer.Tick += async (_, _) => await RefreshAsync();
        _timer.Start();

        _ = RefreshAsync();
    }

    /// <summary>主題只影響呈現，不必重新取數。</summary>
    private void OnPresentationChanged()
    {
        foreach (var (_, card) in _sources) card.Rerender();
    }

    private void OnEnabledProvidersChanged()
    {
        RebuildSources();
        _ = RefreshAsync();
    }

    private void RebuildSources()
    {
        _sources.Clear();
        Cards.Clear();

        // EnabledProviderIds 已依使用者排定的順序，直接照序建立卡片。
        foreach (var id in Settings.EnabledProviderIds)
        {
            var descriptor = ProviderRegistry.Get(id);
            if (!descriptor.IsAvailable) continue;

            var card = new ProviderCardViewModel(descriptor, Settings);
            _sources.Add((ProviderRegistry.CreateCollector(id, _http), card));
            Cards.Add(card);
        }
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
            catch (ProviderNotReadyException ex)
            {
                // 訊息本身就是給使用者的指示，直接顯示。
                card.Fail(ex.Message);
            }
            catch (HttpRequestException ex)
            {
                card.Fail($"連線失敗：{ex.StatusCode?.ToString() ?? ex.Message}");
            }
            catch (TaskCanceledException)
            {
                card.Fail("連線逾時");
            }
        }
    }
}
