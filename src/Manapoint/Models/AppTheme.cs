using Avalonia.Media;

namespace Manapoint.Models;

/// <summary>
/// 一組完整的配色。所有顏色都在這裡定義，View 只綁定不寫死。
///
/// 文字階層依 WCAG 反推，判準是面板在最低不透明度
/// （<see cref="ViewModels.SettingsViewModel.MinOpacity"/>）下
/// 分別疊在純白與純黑桌面上的兩個極端：
/// 文字需 4.5:1，強調色需 3:1。改色時請重新驗算，不要憑感覺。
/// </summary>
public sealed record AppTheme(
    string Name,
    Color Panel,
    Color Accent,
    Color TextPrimary,
    Color TextSecondary,
    Color TextMuted,
    Color Track,
    Color Border)
{
    public static readonly AppTheme Graphite = new(
        "石墨",
        Panel: Color.Parse("#1B1E24"),
        Accent: Color.Parse("#6FA8DC"),
        TextPrimary: Color.Parse("#E4E9F0"),
        TextSecondary: Color.Parse("#C8D0DA"),
        TextMuted: Color.Parse("#B7BBC2"),
        Track: Color.Parse("#2E333C"),
        Border: Color.Parse("#3A404A"));

    public static readonly AppTheme Midnight = new(
        "午夜",
        Panel: Color.Parse("#0F1724"),
        Accent: Color.Parse("#4FD1C5"),
        TextPrimary: Color.Parse("#E2E8F0"),
        TextSecondary: Color.Parse("#A8B6C8"),
        TextMuted: Color.Parse("#ABB4BE"),
        Track: Color.Parse("#1E2A3C"),
        Border: Color.Parse("#2A3A50"));

    public static readonly AppTheme Ember = new(
        "餘燼",
        Panel: Color.Parse("#16130F"),
        Accent: Color.Parse("#E0A45C"),
        TextPrimary: Color.Parse("#F0E9E0"),
        TextSecondary: Color.Parse("#D2C6B6"),
        TextMuted: Color.Parse("#B5AEA5"),
        Track: Color.Parse("#2C2620"),
        Border: Color.Parse("#3D342A"));

    public static readonly AppTheme Paper = new(
        "紙白",
        Panel: Color.Parse("#F4F4F2"),
        Accent: Color.Parse("#357191"),
        TextPrimary: Color.Parse("#1A1D21"),
        TextSecondary: Color.Parse("#41474F"),
        TextMuted: Color.Parse("#4E5156"),
        Track: Color.Parse("#DCDCD8"),
        Border: Color.Parse("#C8C8C4"));

    public static readonly IReadOnlyList<AppTheme> All = [Graphite, Midnight, Ember, Paper];

    public static AppTheme ByName(string name) =>
        All.FirstOrDefault(t => t.Name == name) ?? Graphite;
}
