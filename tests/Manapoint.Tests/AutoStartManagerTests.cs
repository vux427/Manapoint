using Manapoint.Services;

namespace Manapoint.Tests;

public class AutoStartManagerTests
{
    [Fact]
    public void Quote_AddsQuotesAroundSpacedPath() =>
        Assert.Equal(
            "\"C:\\Program Files\\Manapoint\\Manapoint.exe\"",
            AutoStartManager.Quote("C:\\Program Files\\Manapoint\\Manapoint.exe"));

    [Fact]
    public void Quote_DoesNotDoubleQuote() =>
        Assert.Equal(
            "\"C:\\Manapoint\\Manapoint.exe\"",
            AutoStartManager.Quote("\"C:\\Manapoint\\Manapoint.exe\""));

    [Theory]
    [InlineData("\"C:\\a b\\app.exe\"", "C:\\a b\\app.exe")]
    [InlineData("C:\\app.exe", "C:\\app.exe")]
    [InlineData(null, "")]
    [InlineData("  ", "")]
    public void Unquote_StripsOuterQuotes(string? entry, string expected) =>
        Assert.Equal(expected, AutoStartManager.Unquote(entry));

    [Fact]
    public void QuoteUnquote_RoundTrip()
    {
        const string path = "C:\\a b\\app.exe";

        Assert.Equal(path, AutoStartManager.Unquote(AutoStartManager.Quote(path)));
    }
}
