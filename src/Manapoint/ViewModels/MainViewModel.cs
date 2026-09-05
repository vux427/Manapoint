using System.Collections.ObjectModel;
using System.Net;
using Avalonia.Threading;
using CommunityToolkit.Mvvm.Input;
using Manapoint.Collectors;
using Manapoint.Models;
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

        SeedFromCache();
    }

    /// <summary>
    /// 用上次成功的快照先墊著，冷啟動或被限流時也有舊數字看；
    /// 取數回來（不論成功失敗）都會蓋掉這行說明。
    /// </summary>
    private void SeedFromCache()
    {
        var cache = UsageCacheStore.Load();
        if (cache.Count == 0) return;

        foreach (var (_, card) in _sources)
        {
            if (cache.TryGetValue(card.Id, out var snapshot))
            {
                card.Apply(snapshot);
                card.MarkStale("上次數字，更新中");
            }
        }
    }

    /// <summary>把有資料的卡片寫回快照，供下次冷啟動墊檔。</summary>
    private void SaveSnapshot()
    {
        var snapshot = new Dictionary<string, ProviderUsage>();
        foreach (var (_, card) in _sources)
        {
            if (card.LastGood is { } usage)
                snapshot[card.Id] = usage;
        }

        if (snapshot.Count > 0)
            UsageCacheStore.Save(snapshot);
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
                // 訊息本身就是給使用者的指示；有舊數字就留著顯示，
                // 等 CLI 自動換發後下一輪重試即恢復。
                card.MarkStale(ex.Message);
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

        SaveSnapshot();
    }
}
