using Manapoint.Collectors;
using Manapoint.Models;

namespace Manapoint.Tests;

public class GrokUsageParserTests
{
    /// <summary>credits 形狀（欄位名取自實際回應，數值為虛構）。</summary>
    private const string CreditsResponse = """
    {
      "config": {
        "currentPeriod": { "end": "2026-09-12T00:00:00+00:00" },
        "creditUsagePercent": 35.5,
        "onDemandCap": { "val": 0 },
        "onDemandUsed": { "val": 0 },
        "isUnifiedBillingUser": false,
        "billingPeriodStart": "2026-09-01T00:00:00+00:00",
        "billingPeriodEnd": "2026-10-01T00:00:00+00:00"
      }
    }
    """;

    /// <summary>原形狀：有月結上限的帳號（2026-09-05 已驗證，數值為虛構）。</summary>
    private const string MonthlyResponse = """
    {
      "config": {
        "monthlyLimit": { "val": 60 },
        "used": { "val": 15 },
        "billingPeriodStart": "2026-09-01T00:00:00+00:00",
        "billingPeriodEnd": "2026-10-01T00:00:00+00:00",
        "history": []
      }
    }
    """;

    private static readonly DateTimeOffset At = new(2026, 9, 5, 9, 11, 0, TimeSpan.Zero);

    [Fact]
    public void Parse_MapsCreditPercentToWeekly()
    {
        var usage = GrokUsageParser.Parse(CreditsResponse, At);

        Assert.Equal("Grok", usage.Provider);
        Assert.Equal([UsageWindowKind.Weekly], usage.Windows.Select(w => w.Kind));
        Assert.Equal(35.5, usage.Windows[0].Percent);
    }

    [Fact]
    public void Parse_PrefersCurrentPeriodEndForWeeklyReset()
    {
        var usage = GrokUsageParser.Parse(CreditsResponse, At);

        Assert.Equal(
            DateTimeOffset.Parse("2026-09-12T00:00:00+00:00"),
            usage.Windows[0].ResetsAt);
    }

    [Fact]
    public void Parse_FallsBackToBillingPeriodEndWithoutCurrentPeriod()
    {
        const string json = """
        {"config":{
          "creditUsagePercent": 10,
          "billingPeriodEnd": "2026-10-01T00:00:00+00:00"
        }}
        """;

        var usage = GrokUsageParser.Parse(json, At);

        Assert.Equal(
            DateTimeOffset.Parse("2026-10-01T00:00:00+00:00"),
            usage.Windows[0].ResetsAt);
    }

    [Fact]
    public void Parse_KeepsMonthlyWhenLimitSet()
    {
        var usage = GrokUsageParser.Parse(MonthlyResponse, At);

        Assert.Equal([UsageWindowKind.Monthly], usage.Windows.Select(w => w.Kind));
        Assert.Equal(25d, usage.Windows[0].Percent);
    }

    /// <summary>兩種訊號都有時兩欄都顯示，WEEK 在前。</summary>
    [Fact]
    public void Parse_ShowsBothWindowsWhenBothSignalsPresent()
    {
        const string json = """
        {"config":{
          "creditUsagePercent": 35.5,
          "monthlyLimit": { "val": 60 },
          "used": { "val": 15 },
          "billingPeriodEnd": "2026-10-01T00:00:00+00:00"
        }}
        """;

        var usage = GrokUsageParser.Parse(json, At);

        Assert.Equal(
            [UsageWindowKind.Weekly, UsageWindowKind.Monthly],
            usage.Windows.Select(w => w.Kind));
    }

    /// <summary>缺欄位就跳過不斷線：credits 形狀因帳號而異。</summary>
    [Fact]
    public void Parse_SkipsMissingSignalsGracefully()
    {
        const string json = """{"config":{"onDemandCap": { "val": 5 }}}""";

        var usage = GrokUsageParser.Parse(json, At);

        Assert.Empty(usage.Windows);
        Assert.Equal("此帳號沒有 Grok 訂閱額度", usage.Note);
    }

    [Fact]
    public void Parse_NotesSpentAmountWithoutLimit()
    {
        const string json = """
        {"config":{
          "monthlyLimit": { "val": 0 },
          "used": { "val": 3.5 }
        }}
        """;

        var usage = GrokUsageParser.Parse(json, At);

        Assert.Empty(usage.Windows);
        Assert.Contains("本月已用", usage.Note);
    }

    [Fact]
    public void Parse_ThrowsWhenConfigMissing()
    {
        var ex = Assert.Throws<FormatException>(
            () => GrokUsageParser.Parse("""{"foo":1}""", At));

        Assert.Contains("config", ex.Message);
    }
}
