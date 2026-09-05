using Avalonia;

namespace Manapoint.Services;

/// <summary>
/// 視窗貼齊螢幕邊緣的純計算。每軸各自看離工作區哪一端夠近，只吸較近的那一端，
/// 兩端都遠就原地不動——四角與四邊都吸得到，拖到中間完全不受干擾。
/// 不碰 UI，方便單元測試。
/// </summary>
public static class WindowSnap
{
    /// <summary>吸附距離，邏輯像素。比對前要用 <see cref="ThresholdFor"/> 換成物理像素。</summary>
    public const int DefaultThreshold = 24;

    /// <summary>判定「還切齊著邊」的容差，吸收 DPI 換算的整數誤差。</summary>
    private const int FlushTolerance = 2;

    /// <summary>
    /// 門檻定義在邏輯像素、比對走物理像素：高 DPI 螢幕上手感才跟 100% 一樣，
    /// 不會因為縮放 150% 就只剩三分之二的吸附範圍。
    /// </summary>
    public static int ThresholdFor(double scaling) =>
        Math.Max(1, (int)Math.Round(DefaultThreshold * scaling));

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

    /// <summary>
    /// 尺寸變了、位置沒動時維持原本切齊的邊：重新整理讓卡片長高，
    /// 貼底的面板不該就這樣長出畫面外。只處理本來就切齊的那一端，其餘一律不動。
    /// </summary>
    public static PixelPoint KeepEdges(PixelPoint pos, PixelSize oldSize, PixelSize newSize, PixelRect area)
    {
        var x = KeepAxis(pos.X, oldSize.Width, newSize.Width, area.X, area.Right);
        var y = KeepAxis(pos.Y, oldSize.Height, newSize.Height, area.Y, area.Bottom);
        return new PixelPoint(x, y);
    }

    private static int SnapAxis(int raw, int len, int lo, int hi, int threshold)
    {
        var hiPos = hi - len;
        var toLo = Math.Abs(raw - lo);
        var toHi = Math.Abs(raw - hiPos);

        if (toLo > threshold && toHi > threshold) return raw;
        return toLo <= toHi ? lo : hiPos;
    }

    private static int KeepAxis(int raw, int oldLen, int newLen, int lo, int hi)
    {
        if (Math.Abs(raw - lo) <= FlushTolerance) return lo;
        if (Math.Abs(raw + oldLen - hi) <= FlushTolerance) return hi - newLen;
        return raw;
    }
}
