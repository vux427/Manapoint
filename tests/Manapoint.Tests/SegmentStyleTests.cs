using Avalonia.Media;
using Manapoint.Models;
using Manapoint.ViewModels;

namespace Manapoint.Tests;

/// <summary>血條走密集小方塊（參考 kcchien/claude-code-statusline 的密度），終端維持 10 格。</summary>
public class SegmentStyleTests
{
    [Fact]
    public void Vitals_UsesTwentyNarrowCells()
    {
        Assert.Equal(20, AppTheme.Vitals.SegmentCells);
        Assert.Equal(3.5, AppTheme.Vitals.SegmentWidth);
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
    public void Vitals_RendersTwentySegments()
    {
        Assert.Equal(20, Window(35).Segments.Count);
    }

    [Theory]
    [InlineData(98, 20)]
    [InlineData(50, 10)]
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
