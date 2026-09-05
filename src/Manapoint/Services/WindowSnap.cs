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

    /// <summary>已吸住後，要拉開「門檻＋這個距離」才脫鉤，避免在邊界抖動。</summary>
    public const int ReleaseMargin = 10;

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

    /// <summary>
    /// 有記憶的吸附：吸住後小幅來回不會反覆吸放。
    /// 另一個抖動源是視窗位移產生的假移動事件，那個由呼叫端
    /// （游標物理位置沒變就不處理）擋掉，這裡只管黏性。
    /// </summary>
    public sealed class Session
    {
        private int? _x;
        private int? _y;

        public PixelPoint Snap(PixelPoint raw, PixelSize size, PixelRect area)
        {
            return new PixelPoint(
                StickyAxis(raw.X, size.Width, area.X, area.Right, ref _x),
                StickyAxis(raw.Y, size.Height, area.Y, area.Bottom, ref _y));
        }

        public void Reset()
        {
            _x = null;
            _y = null;
        }

        private static int StickyAxis(int raw, int len, int lo, int hi, ref int? snapped)
        {
            if (snapped.HasValue)
            {
                if (Math.Abs(raw - snapped.Value) > DefaultThreshold + ReleaseMargin)
                    snapped = null;
                else
                    return snapped.Value;
            }

            var next = SnapAxis(raw, len, lo, hi, DefaultThreshold);
            if (next == lo || next == hi - len)
                snapped = next;
            return next;
        }
    }
}
