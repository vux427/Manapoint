using Manapoint.Collectors;
using Manapoint.Models;
using Manapoint.Services;
using Manapoint.ViewModels;

namespace Manapoint.Tests;

public class ProviderCardTests
{
    private static ProviderCardViewModel CreateCard()
    {
        var settings = new SettingsViewModel();
        return new ProviderCardViewModel(ProviderRegistry.Get("codex"), settings);
    }

    private static void ApplyOneWindow(ProviderCardViewModel card) =>
        card.Apply(new ProviderUsage(
            "Codex",
            [new UsageWindow(UsageWindowKind.Rolling, 10, null)],
            DateTimeOffset.UtcNow));

    /// <summary>被限流時留著上次數字，只加說明，不洗成錯誤。</summary>
    [Fact]
    public void MarkStale_KeepsWindowsAndShowsNote()
    {
        var card = CreateCard();
        ApplyOneWindow(card);

        card.MarkStale("busy");

        Assert.Single(card.Windows);
        Assert.Null(card.Error);
        Assert.True(card.HasNote);
        Assert.Equal("busy", card.Note);
    }

    /// <summary>下次取數成功會蓋掉限流說明，不會殘留。</summary>
    [Fact]
    public void MarkStale_ClearedByNextApply()
    {
        var card = CreateCard();
        ApplyOneWindow(card);
        card.MarkStale("busy");

        ApplyOneWindow(card);

        Assert.False(card.HasNote);
        Assert.False(card.HasError);
    }

    /// <summary>完全沒拿過資料時，無數字可留，比照失敗顯示。</summary>
    [Fact]
    public void MarkStale_WithoutData_BehavesLikeFail()
    {
        var card = CreateCard();

        card.MarkStale("busy");

        Assert.Empty(card.Windows);
        Assert.Equal("busy", card.Error);
    }
}
