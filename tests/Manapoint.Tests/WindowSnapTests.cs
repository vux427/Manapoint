using Avalonia;
using Manapoint.Models;
using Manapoint.Services;

namespace Manapoint.Tests;

public class WindowSnapTests
{
    private static readonly PixelRect Area = new(0, 0, 1920, 1040);
    private static readonly PixelSize Size = new(252, 300);

    [Fact]
    public void Snap_TopLeftCorner()
    {
        Assert.Equal(
            new PixelPoint(0, 0),
            WindowSnap.Snap(new PixelPoint(10, 10), Size, Area));
    }

    [Fact]
    public void Snap_BottomRightCorner()
    {
        Assert.Equal(
            new PixelPoint(1920 - 252, 1040 - 300),
            WindowSnap.Snap(new PixelPoint(1680, 750), Size, Area));
    }

    /// <summary>每軸獨立吸附：只靠左邊時 y 不動（邊緣吸附）。</summary>
    [Fact]
    public void Snap_LeftEdgeOnly()
    {
        Assert.Equal(
            new PixelPoint(0, 500),
            WindowSnap.Snap(new PixelPoint(5, 500), Size, Area));
    }

    [Fact]
    public void Snap_RightEdgeOnly()
    {
        Assert.Equal(
            new PixelPoint(1920 - 252, 500),
            WindowSnap.Snap(new PixelPoint(1920 - 252 + 5, 500), Size, Area));
    }

    [Fact]
    public void Snap_OutsideThreshold_Unchanged()
    {
        var pos = new PixelPoint(100, 100);

        Assert.Equal(pos, WindowSnap.Snap(pos, Size, Area));
    }

    /// <summary>邊界值（含等於）會吸附。</summary>
    [Fact]
    public void Snap_AtThreshold_Snaps()
    {
        Assert.Equal(
            new PixelPoint(0, 100),
            WindowSnap.Snap(new PixelPoint(24, 100), Size, Area, threshold: 24));
    }

    [Fact]
    public void CardsLayout_DefaultsToVertical()
    {
        Assert.Equal(CardLayout.Vertical, new AppSettings().CardsLayout);
    }
}
