using Manapoint.Collectors;
using Manapoint.Models;

namespace Manapoint.Tests;

public class CodexUsageParserTests
{
    /// <summary>取自實際回應（2026-09-05），已移除帳號個資欄位。</summary>
    private const string RealResponse = """
    {
      "plan_type": "team",
      "rate_limit": {
        "allowed": true,
        "limit_reached": false,
        "primary_window": {
          "used_percent": 0,
          "limit_window_seconds": 18000,
          "reset_after_seconds": 18000,
          "reset_at": 1788617477
        },
        "secondary_window": {
          "used_percent": 98,
          "limit_window_seconds": 604800,
          "reset_after_seconds": 156625,
          "reset_at": 1788756101
        }
      },
      "code_review_rate_limit": null,
      "credits": { "has_credits": false, "unlimited": false }
    }
    """;

    private static readonly DateTimeOffset At = new(2026, 9, 5, 9, 11, 0, TimeSpan.Zero);

    [Fact]
    public void Parse_MapsWindowsByDuration()
    {
        var usage = CodexUsageParser.Parse(RealResponse, At);

        Assert.Equal("Codex", usage.Provider);
        Assert.Equal(
            [UsageWindowKind.Rolling, UsageWindowKind.Weekly],
            usage.Windows.Select(w => w.Kind));
    }

    [Fact]
    public void Parse_ReadsUsedPercent()
    {
        var usage = CodexUsageParser.Parse(RealResponse, At);

        Assert.Equal(0d, usage.Windows[0].Percent);
        Assert.Equal(98d, usage.Windows[1].Percent);
    }

    [Fact]
    public void Parse_ConvertsUnixResetTimestamp()
    {
        var usage = CodexUsageParser.Parse(RealResponse, At);

        Assert.Equal(
            DateTimeOffset.FromUnixTimeSeconds(1788756101),
            usage.Windows[1].ResetsAt);
    }

    /// <summary>窗口類型看長度而非欄位順序，順序對調也要得到同樣結果。</summary>
    [Fact]
    public void Parse_IgnoresFieldOrderWhenClassifying()
    {
        const string swapped = """
        {"rate_limit":{
          "primary_window":{"used_percent":10,"limit_window_seconds":604800,"reset_at":1788756101},
          "secondary_window":{"used_percent":20,"limit_window_seconds":18000,"reset_at":1788617477}
        }}
        """;

        var usage = CodexUsageParser.Parse(swapped, At);

        Assert.Equal(UsageWindowKind.Weekly, usage.Windows[0].Kind);
        Assert.Equal(UsageWindowKind.Rolling, usage.Windows[1].Kind);
    }

    [Theory]
    [InlineData(18_000, UsageWindowKind.Rolling)]
    [InlineData(86_400, UsageWindowKind.Rolling)]
    [InlineData(604_800, UsageWindowKind.Weekly)]
    [InlineData(2_592_000, UsageWindowKind.Monthly)]
    public void Parse_ClassifiesWindowLengths(long seconds, UsageWindowKind expected)
    {
        var json =
            """{"rate_limit":{"primary_window":{"used_percent":1,"limit_window_seconds":"""
            + seconds
            + ""","reset_at":1788617477}}}""";

        Assert.Equal(expected, CodexUsageParser.Parse(json, At).Windows[0].Kind);
    }

    [Fact]
    public void Parse_AllowsMissingSecondaryWindow()
    {
        const string primaryOnly = """
        {"rate_limit":{"primary_window":{"used_percent":3,"limit_window_seconds":18000,"reset_at":1788617477},
                       "secondary_window":null}}
        """;

        var usage = CodexUsageParser.Parse(primaryOnly, At);

        Assert.Single(usage.Windows);
    }

    [Fact]
    public void Parse_ThrowsWhenRateLimitMissing()
    {
        var ex = Assert.Throws<FormatException>(
            () => CodexUsageParser.Parse("""{"plan_type":"team"}""", At));

        Assert.Contains("rate_limit", ex.Message);
    }

    [Fact]
    public void Parse_ThrowsWhenPrimaryWindowMissing()
    {
        var ex = Assert.Throws<FormatException>(
            () => CodexUsageParser.Parse("""{"rate_limit":{"secondary_window":null}}""", At));

        Assert.Contains("primary_window", ex.Message);
    }
}
