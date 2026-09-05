using Avalonia;

namespace Manapoint.Services;

/// <summary>
/// 視窗角落磁吸的純計算：給定視窗位置與尺寸、工作區範圍，
/// 每軸獨立吸附（左右／上下），自然形成四角加四邊中點的吸附。
/// 不碰 UI，方便單元測試。
/// </summary>
public static class WindowSnap
{
    public const int DefaultThreshold = 24;

    /// <param name="pos">視窗左上角（物理像素）。</param>
    /// <param name="size">視窗尺寸（物理像素）。</param>
    /// <param name="area">工作區範圍（物理像素）。</param>
    /// <param name="threshold">吸附距離（物理像素）。</param>
    public static PixelPoint Snap(PixelPoint pos, PixelSize size, PixelRect area, int threshold = DefaultThreshold)
    {
        var x = SnapAxis(pos.X, size.Width, area.X, area.Right, threshold);
        var y = SnapAxis(pos.Y, size.Height, area.Y, area.Bottom, threshold);
        return new PixelPoint(x, y);
    }

    private static int SnapAxis(int raw, int len, int lo, int hi, int threshold)
    {
        if (Math.Abs(raw - lo) <= threshold) return lo;
        var hiPos = hi - len;
        if (Math.Abs(raw - hiPos) <= threshold) return hiPos;
        return raw;
    }
}
