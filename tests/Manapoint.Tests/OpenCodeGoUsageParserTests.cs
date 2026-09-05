using Manapoint.Collectors;
using Manapoint.Models;

namespace Manapoint.Tests;

public class OpenCodeGoUsageParserTests
{
    /// <summary>取自實際回應（2026-09-05）。</summary>
    private const string RealResponse = """
    {
      "usage": {
        "rolling": { "status": "ok", "percent": 0,  "resetsAt": "2026-09-05T13:38:32.096Z" },
        "weekly":  { "status": "ok", "percent": 15, "resetsAt": "2026-09-07T00:00:00.096Z" },
        "monthly": { "status": "ok", "percent": 24, "resetsAt": "2026-09-10T06:10:40.096Z" }
      }
    }
    """;

    private static readonly DateTimeOffset At = new(2026, 9, 5, 8, 38, 32, TimeSpan.Zero);

    [Fact]
    public void Parse_ReturnsThreeWindowsInOrder()
    {
        var usage = OpenCodeGoUsageParser.Parse(RealResponse, At);

        Assert.Equal("opencode Go", usage.Provider);
        Assert.Equal(At, usage.CollectedAt);
        Assert.Equal(
            [UsageWindowKind.Rolling, UsageWindowKind.Weekly, UsageWindowKind.Monthly],
            usage.Windows.Select(w => w.Kind));
    }

    [Theory]
    [InlineData(0, 0d)]
    [InlineData(1, 15d)]
    [InlineData(2, 24d)]
    public void Parse_ReadsPercent(int index, double expected)
    {
        var usage = OpenCodeGoUsageParser.Parse(RealResponse, At);
        Assert.Equal(expected, usage.Windows[index].Percent);
    }

    [Fact]
    public void Parse_ReadsResetTimestampAsUtc()
    {
        var usage = OpenCodeGoUsageParser.Parse(RealResponse, At);

        Assert.Equal(
            new DateTimeOffset(2026, 9, 7, 0, 0, 0, 96, TimeSpan.Zero),
            usage.Windows[1].ResetsAt);
    }

    [Fact]
    public void RemainingPercent_IsComplementOfPercent()
    {
        var usage = OpenCodeGoUsageParser.Parse(RealResponse, At);
        Assert.Equal(85d, usage.Windows[1].RemainingPercent);
    }

    [Fact]
    public void Parse_ThrowsWhenUsageKeyMissing()
    {
        var ex = Assert.Throws<FormatException>(
            () => OpenCodeGoUsageParser.Parse("""{"other":{}}""", At));

        Assert.Contains("usage", ex.Message);
    }

    [Fact]
    public void Parse_ThrowsWhenWindowMissing()
    {
        const string missingMonthly = """
        {"usage":{
          "rolling":{"percent":0,"resetsAt":"2026-09-05T13:38:32Z"},
          "weekly":{"percent":15,"resetsAt":"2026-09-07T00:00:00Z"}
        }}
        """;

        var ex = Assert.Throws<FormatException>(
            () => OpenCodeGoUsageParser.Parse(missingMonthly, At));

        Assert.Contains("monthly", ex.Message);
    }

    [Fact]
    public void Parse_ThrowsOnMalformedJson()
    {
        Assert.ThrowsAny<Exception>(() => OpenCodeGoUsageParser.Parse("not json", At));
    }
}
