using Avalonia.Media;
using Manapoint.Models;
using Manapoint.ViewModels;

namespace Manapoint.Tests;

/// <summary>
/// 面板是半透明的，文字實際的背景是「面板色 × α + 桌面色 × (1−α)」，
/// 而桌面是任意的。因此每個配色都必須在最低不透明度下，
/// 同時通過疊在純白與純黑兩個極端的 WCAG 對比要求。
///
/// 這些門檻是設計約束，不是建議值——調整任何顏色都要讓這裡繼續通過。
/// </summary>
public class ThemeContrastTests
{
    private const double TextRatio = 4.5;      // WCAG AA，一般文字
    private const double GraphicRatio = 3.0;   // WCAG AA，非文字圖形

    public static TheoryData<string> ThemeNames()
    {
        var data = new TheoryData<string>();
        foreach (var t in AppTheme.All) data.Add(t.Name);
        return data;
    }

    [Theory]
    [MemberData(nameof(ThemeNames))]
    public void TextTiersMeetContrastOverAnyDesktop(string themeName)
    {
        var theme = AppTheme.ByName(themeName);

        foreach (var (label, color, required) in new[]
        {
            ("TextPrimary", theme.TextPrimary, TextRatio),
            ("TextSecondary", theme.TextSecondary, TextRatio),
            ("TextMuted", theme.TextMuted, TextRatio),
            ("Accent", theme.Accent, GraphicRatio),
            // 狀態色會畫成量表填色，同樣要在任意桌面上看得見。
            ("Status.Good", theme.Status.Good, GraphicRatio),
            ("Status.Warning", theme.Status.Warning, GraphicRatio),
            ("Status.Critical", theme.Status.Critical, GraphicRatio),
        })
        {
            var worst = WorstCaseContrast(color, theme.Panel, SettingsViewModel.MinOpacity);

            Assert.True(
                worst >= required,
                $"{themeName} 的 {label} 在最低不透明度下最差對比為 {worst:0.00}，"
                + $"未達 {required:0.0}:1。請重新計算顏色，不要調低門檻。");
        }
    }

    /// <summary>最低不透明度本身也是設計約束的一部分。</summary>
    [Fact]
    public void OpacityFloorStaysWithinRange()
    {
        Assert.InRange(SettingsViewModel.MinOpacity, 0.5, SettingsViewModel.MaxOpacity);
    }

    private static double WorstCaseContrast(Color foreground, Color panel, double alpha)
    {
        var overWhite = Composite(panel, Colors.White, alpha);
        var overBlack = Composite(panel, Colors.Black, alpha);

        return Math.Min(
            ContrastRatio(foreground, overWhite),
            ContrastRatio(foreground, overBlack));
    }

    private static Color Composite(Color layer, Color backdrop, double alpha) => Color.FromRgb(
        (byte)Math.Round(alpha * layer.R + (1 - alpha) * backdrop.R),
        (byte)Math.Round(alpha * layer.G + (1 - alpha) * backdrop.G),
        (byte)Math.Round(alpha * layer.B + (1 - alpha) * backdrop.B));

    private static double ContrastRatio(Color a, Color b)
    {
        var (hi, lo) = (Luminance(a), Luminance(b)) switch
        {
            var (x, y) when x >= y => (x, y),
            var (x, y) => (y, x),
        };

        return (hi + 0.05) / (lo + 0.05);
    }

    private static double Luminance(Color c) =>
        0.2126 * Channel(c.R) + 0.7152 * Channel(c.G) + 0.0722 * Channel(c.B);

    private static double Channel(byte value)
    {
        var v = value / 255.0;
        return v <= 0.03928 ? v / 12.92 : Math.Pow((v + 0.055) / 1.055, 2.4);
    }
}
