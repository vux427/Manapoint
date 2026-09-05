using System.Collections.ObjectModel;
using System.Net;
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
        Settings.ProviderOrderChanged += OnProviderOrderChanged;
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

    /// <summary>
    /// 只有順序變動：沿用既有卡片調換位置，不重建、不重取數，畫面不閃。
    /// 勾選集合變了才走 <see cref="OnEnabledProvidersChanged"/> 的重建路徑。
    /// </summary>
    private void OnProviderOrderChanged()
    {
        var order = Settings.EnabledProviderIds;
        if (Cards.Count != order.Count || order.Any(id => Cards.All(c => c.Id != id)))
        {
            // 集合不一致時退回重建（理論上只調順序不會走到這裡）。
            RebuildSources();
            _ = RefreshAsync();
            return;
        }

        var cardsById = Cards.ToDictionary(c => c.Id);
        for (var i = 0; i < order.Count; i++)
        {
            var card = cardsById[order[i]];
            var current = Cards.IndexOf(card);
            if (current != i) Cards.Move(current, i);
        }

        var rank = order.Select((id, i) => (id, i)).ToDictionary(t => t.id, t => t.i);
        _sources.Sort((a, b) => rank[a.Card.Id].CompareTo(rank[b.Card.Id]));
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
            catch (HttpRequestException ex) when (ex.StatusCode == HttpStatusCode.TooManyRequests)
            {
                // 被限流不洗掉上次數字（多半是一分鐘內打太多次，下一輪就會好）。
                card.MarkStale("請求太頻繁，顯示上次數字，稍後自動重試");
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
