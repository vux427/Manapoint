using Avalonia.Media;
using Manapoint.Models;
using Manapoint.ViewModels;

namespace Manapoint.Tests;

/// <summary>魔力走藍色小方塊，終端維持原樣。格數邏輯共用主題參數。</summary>
public class SegmentStyleTests
{
    [Fact]
    public void Vitals_UsesTenCells()
    {
        Assert.Equal(10, AppTheme.Vitals.SegmentCells);
        Assert.Equal(7, AppTheme.Vitals.SegmentWidth);
    }

    [Fact]
    public void Terminal_KeepsTenWideCells()
    {
        Assert.Equal(10, AppTheme.Terminal.SegmentCells);
        Assert.Equal(7, AppTheme.Terminal.SegmentWidth);
    }

    private static UsageWindowViewModel Window(double percent) =>
        new(new UsageWindow(UsageWindowKind.Weekly, percent, null), AppTheme.Vitals);

    [Fact]
    public void Vitals_RendersTenSegments()
    {
        Assert.Equal(10, Window(35).Segments.Count);
    }

    [Theory]
    [InlineData(98, 10)]
    [InlineData(50, 5)]
    [InlineData(3, 1)]
    [InlineData(0, 0)]
    public void Vitals_LitMathScalesWithCellCount(double percent, int expectedLit)
    {
        var segments = Window(percent).Segments;
        var fill = AppTheme.Vitals.Status.For(percent);
        var litCount = segments.Count(s => ((SolidColorBrush)s.Brush).Color == fill);

        Assert.Equal(expectedLit, litCount);
    }
}
