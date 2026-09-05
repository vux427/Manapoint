using Manapoint.Views;

namespace Manapoint.Tests;

/// <summary>拖放插入點換算。情境以 [A, B, C, D] 為例，from/target 為拖放前下標。</summary>
public class DropIndexTests
{
    [Theory]
    [InlineData(0, 2, false, 1)] // A 放到 C 之前 → [B, A, C, D]
    [InlineData(0, 2, true, 2)]  // A 放到 C 之後 → [B, C, A, D]
    [InlineData(3, 1, false, 1)] // D 放到 B 之前 → [A, D, B, C]
    [InlineData(3, 1, true, 2)]  // D 放到 B 之後 → [A, B, D, C]
    [InlineData(1, 2, false, 1)] // B 本來就在 C 之前 → 不動
    [InlineData(2, 1, true, 2)]  // C 本來就在 B 之後 → 不動
    [InlineData(0, 3, true, 3)]  // A 放到 D 之後 → 移到最後
    [InlineData(3, 0, false, 0)] // D 放到 A 之前 → 移到最前
    public void ResolveDropIndex(int from, int target, bool insertAfter, int expected) =>
        Assert.Equal(expected, SettingsWindow.ResolveDropIndex(from, target, insertAfter));
}
