using Avalonia.Media;

namespace Manapoint.Models;

/// <summary>量表的呈現方式。</summary>
public enum MeterStyle
{
    /// <summary>連續長條。</summary>
    Smooth,

    /// <summary>分段方塊，血條式。</summary>
    Segmented,

    /// <summary>不畫圖形，一行文字帶完一家。</summary>
    Text,
}

/// <summary>量表的上色依據。</summary>
public enum MeterColoring
{
    /// <summary>一律使用主題強調色。</summary>
    Accent,

    /// <summary>依用量落在良好／注意／危險而變色。</summary>
    Status,
}

/// <summary>
/// 狀態色。顏色不是唯一編碼——每條量表旁都有百分比數字，
/// 色盲使用者仍讀得到值。
/// </summary>
public sealed record StatusColors(Color Good, Color Warning, Color Critical)
{
    /// <summary>進入「注意」的用量門檻。</summary>
    public const double WarningAt = 60;

    /// <summary>進入「危險」的用量門檻。</summary>
    public const double CriticalAt = 85;

    public Color For(double percent) => percent switch
    {
        >= CriticalAt => Critical,
        >= WarningAt => Warning,
        _ => Good,
    };
}

/// <summary>
/// 一種完整的呈現風格：配色加上量表的樣式與上色規則。
/// View 只綁定，不寫死任何顏色或形狀。
///
/// 文字階層依 WCAG 反推，判準是面板在最低不透明度
/// （<see cref="ViewModels.SettingsViewModel.MinOpacity"/>）下
/// 分別疊在純白與純黑桌面上的兩個極端：
/// 文字需 4.5:1，量表等圖形需 3:1。
/// 改色時請重新驗算，ThemeContrastTests 會擋住不合格的值。
/// </summary>
public sealed record AppTheme(
    string Name,
    string Description,
    Color Panel,
    Color Accent,
    Color TextPrimary,
    Color TextSecondary,
    Color TextMuted,
    Color Track,
    Color Border,
    MeterStyle MeterStyle,
    MeterColoring Coloring,
    StatusColors Status,
    bool Monospace = false,
    double SegmentRadius = 2.0,
    bool Brackets = false,
    double PanelWidth = 252)
{
    /// <summary>分段樣式的格數。</summary>
    public const int SegmentCount = 10;

    private static readonly StatusColors DarkStatus = new(
        Good: Color.Parse("#4ADE80"),
        Warning: Color.Parse("#FBBF24"),
        Critical: Color.Parse("#F87171"));

    private static readonly StatusColors LightStatus = new(
        Good: Color.Parse("#137839"),
        Warning: Color.Parse("#975C07"),
        Critical: Color.Parse("#B91C1C"));

    public static readonly AppTheme Graphite = new(
        "石墨", "連續長條，單一強調色",
        Panel: Color.Parse("#1B1E24"),
        Accent: Color.Parse("#6FA8DC"),
        TextPrimary: Color.Parse("#E4E9F0"),
        TextSecondary: Color.Parse("#C8D0DA"),
        TextMuted: Color.Parse("#B7BBC2"),
        Track: Color.Parse("#2E333C"),
        Border: Color.Parse("#3A404A"),
        MeterStyle.Smooth, MeterColoring.Accent, DarkStatus);

    public static readonly AppTheme Vitals = new(
        "血條", "分段方塊，依用量變色",
        Panel: Color.Parse("#12151A"),
        Accent: Color.Parse("#4ADE80"),
        TextPrimary: Color.Parse("#E8EDF2"),
        TextSecondary: Color.Parse("#BFC8D2"),
        TextMuted: Color.Parse("#B3B9C1"),
        Track: Color.Parse("#252A32"),
        Border: Color.Parse("#39404A"),
        MeterStyle.Segmented, MeterColoring.Status, DarkStatus, SegmentRadius: 2.5);

    public static readonly AppTheme Terminal = new(
        "終端", "方塊分段，等寬字，磷光綠",
        Panel: Color.Parse("#0A0E0A"),
        Accent: Color.Parse("#00FF66"),
        TextPrimary: Color.Parse("#D7FFD7"),
        TextSecondary: Color.Parse("#8CE68C"),
        TextMuted: Color.Parse("#86B386"),
        Track: Color.Parse("#1B2A1B"),
        Border: Color.Parse("#2C452C"),
        MeterStyle.Segmented, MeterColoring.Status,
        new StatusColors(
            Good: Color.Parse("#00FF66"),
            Warning: Color.Parse("#FFD400"),
            Critical: Color.Parse("#FF4D4D")),
        Monospace: true, SegmentRadius: 0, Brackets: true);

    public static readonly AppTheme Compact = new(
        "精簡", "一行一家，只有數字",
        Panel: Color.Parse("#16191E"),
        Accent: Color.Parse("#6FA8DC"),
        TextPrimary: Color.Parse("#E4E9F0"),
        TextSecondary: Color.Parse("#C8D0DA"),
        TextMuted: Color.Parse("#B7BBC2"),
        Track: Color.Parse("#2E333C"),
        Border: Color.Parse("#3A404A"),
        MeterStyle.Text, MeterColoring.Status, DarkStatus,
        Monospace: true, PanelWidth: 232);

    public static readonly AppTheme Paper = new(
        "紙白", "連續長條，淺色底",
        Panel: Color.Parse("#F4F4F2"),
        Accent: Color.Parse("#357191"),
        TextPrimary: Color.Parse("#1A1D21"),
        TextSecondary: Color.Parse("#41474F"),
        TextMuted: Color.Parse("#4E5156"),
        Track: Color.Parse("#DCDCD8"),
        Border: Color.Parse("#C8C8C4"),
        MeterStyle.Smooth, MeterColoring.Accent, LightStatus);

    public static readonly IReadOnlyList<AppTheme> All = [Graphite, Vitals, Terminal, Compact, Paper];

    public static AppTheme ByName(string name) =>
        All.FirstOrDefault(t => t.Name == name) ?? Graphite;
}
