using Avalonia;

namespace Manapoint.Services;

/// <summary>
/// 視窗角落磁吸的純計算：給定視窗位置與尺寸、工作區範圍，
/// 每軸獨立吸附（左右／上下），自然形成四角加四邊中點的吸附。
/// 不碰 UI，方便單元測試。
/// </summary>
public static class WindowSnap
{
    /// <param name="pos">視窗左上角（物理像素）。</param>
    /// <param name="size">視窗尺寸（物理像素）。</param>
    /// <param name="area">工作區範圍（物理像素）。</param>
    /// <param name="threshold">吸附距離（物理像素）。</param>
    public static PixelPoint Snap(PixelPoint pos, PixelSize size, PixelRect area, int threshold = 24)
    {
        var x = pos.X;
        if (Math.Abs(x - area.X) <= threshold)
            x = area.X;
        else if (Math.Abs(x + size.Width - area.Right) <= threshold)
            x = area.Right - size.Width;

        var y = pos.Y;
        if (Math.Abs(y - area.Y) <= threshold)
            y = area.Y;
        else if (Math.Abs(y + size.Height - area.Bottom) <= threshold)
            y = area.Bottom - size.Height;

        return new PixelPoint(x, y);
    }
}
