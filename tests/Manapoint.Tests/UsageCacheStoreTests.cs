using Manapoint.Models;
using Manapoint.Services;

namespace Manapoint.Tests;

public class UsageCacheStoreTests
{
    private static ProviderUsage Usage() => new(
        "Codex",
        [
            new UsageWindow(UsageWindowKind.Rolling, 10, DateTimeOffset.FromUnixTimeSeconds(1788617477)),
            new UsageWindow(UsageWindowKind.Weekly, 98, null),
        ],
        new DateTimeOffset(2026, 9, 6, 1, 0, 0, TimeSpan.Zero),
        Note: "n");

    [Fact]
    public void RoundTrip_PreservesEverything()
    {
        var snapshot = new Dictionary<string, ProviderUsage>
        {
            ["codex"] = Usage(),
        };

        var restored = UsageCacheStore.Deserialize(UsageCacheStore.Serialize(snapshot));

        var usage = Assert.Single(restored);
        Assert.Equal("codex", usage.Key);
        Assert.Equal("Codex", usage.Value.Provider);
        Assert.Equal(
            [UsageWindowKind.Rolling, UsageWindowKind.Weekly],
            usage.Value.Windows.Select(w => w.Kind));
        Assert.Equal(10d, usage.Value.Windows[0].Percent);
        Assert.Equal(
            DateTimeOffset.FromUnixTimeSeconds(1788617477),
            usage.Value.Windows[0].ResetsAt);
        Assert.Null(usage.Value.Windows[1].ResetsAt);
        Assert.Equal("n", usage.Value.Note);
        Assert.Equal(
            new DateTimeOffset(2026, 9, 6, 1, 0, 0, TimeSpan.Zero),
            usage.Value.CollectedAt);
    }

    [Fact]
    public void Serialized_KindsAreReadable()
    {
        var json = UsageCacheStore.Serialize(new Dictionary<string, ProviderUsage>
        {
            ["codex"] = Usage(),
        });

        Assert.Contains("\"Rolling\"", json);
    }

    [Fact]
    public void Deserialize_RejectsGarbage()
    {
        Assert.Throws<System.Text.Json.JsonException>(
            () => UsageCacheStore.Deserialize("{nope"));
    }
}
