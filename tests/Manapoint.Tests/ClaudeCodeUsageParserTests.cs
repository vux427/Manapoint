using Manapoint.Collectors;
using Manapoint.Models;

namespace Manapoint.Tests;

public class ClaudeCodeUsageParserTests
{
    /// <summary>取自實際回應（2026-09-05），保留原始欄位以便偵測格式變動。</summary>
    private const string RealResponse = """
    {
      "five_hour": {
        "utilization": 5.0,
        "resets_at": "2026-09-05T20:00:00.469547+08:00",
        "limit_dollars": null, "used_dollars": null, "locked_reason": null
      },
      "seven_day": {
        "utilization": 1.0,
        "resets_at": "2026-09-11T09:00:00.469575+08:00",
        "limit_dollars": null, "used_dollars": null, "locked_reason": null
      },
      "seven_day_opus": null,
      "nimbus_quill": { "utilization": 0.0, "resets_at": null },
      "member_dashboard_available": false
    }
    """;

    private static readonly DateTimeOffset At = new(2026, 9, 5, 8, 57, 0, TimeSpan.Zero);

    [Fact]
    public void Parse_ReturnsFiveHourThenWeekly()
    {
        var usage = ClaudeCodeUsageParser.Parse(RealResponse, At);

        Assert.Equal("Claude Code", usage.Provider);
        Assert.Equal(
            [UsageWindowKind.Rolling, UsageWindowKind.Weekly],
            usage.Windows.Select(w => w.Kind));
    }

    [Fact]
    public void Parse_ReadsFractionalUtilisation()
    {
        var usage = ClaudeCodeUsageParser.Parse(RealResponse, At);

        Assert.Equal(5d, usage.Windows[0].Percent);
        Assert.Equal(1d, usage.Windows[1].Percent);
    }

    [Fact]
    public void Parse_KeepsResetOffset()
    {
        var usage = ClaudeCodeUsageParser.Parse(RealResponse, At);

        Assert.Equal(
            DateTimeOffset.Parse("2026-09-05T20:00:00.469547+08:00"),
            usage.Windows[0].ResetsAt);
    }

    [Fact]
    public void Parse_ThrowsWhenWindowMissing()
    {
        var ex = Assert.Throws<FormatException>(
            () => ClaudeCodeUsageParser.Parse("""{"five_hour":{"utilization":5,"resets_at":null}}""", At));

        Assert.Contains("seven_day", ex.Message);
    }

    [Fact]
    public void Parse_ThrowsWhenWindowIsExplicitNull()
    {
        const string nulled = """{"five_hour":null,"seven_day":null}""";

        Assert.Throws<FormatException>(() => ClaudeCodeUsageParser.Parse(nulled, At));
    }

    [Fact]
    public void Parse_AllowsNullResetTimestamp()
    {
        const string noReset = """
        {"five_hour":{"utilization":2.5,"resets_at":null},
         "seven_day":{"utilization":0,"resets_at":null}}
        """;

        var usage = ClaudeCodeUsageParser.Parse(noReset, At);

        Assert.Null(usage.Windows[0].ResetsAt);
        Assert.Equal(2.5d, usage.Windows[0].Percent);
    }
}
