using Avalonia.Media;

namespace Manapoint.Models;

/// <summary>
/// 一家可接入的訂閱服務。<see cref="IsAvailable"/> 為 false 代表
/// 取數器尚未實作，設定頁會列出但不讓勾選。
/// </summary>
/// <param name="Badge">卡片左側的識別標記。</param>
public sealed record ProviderDescriptor(
    string Id,
    string Name,
    string CredentialHint,
    bool IsAvailable,
    ProviderBadge Badge);

/// <summary>
/// 服務的視覺識別：品牌色底 + 官方標誌。
/// 尚未取得標誌的服務退回字母標記。
/// </summary>
/// <param name="IconPath">24x24 座標系的向量路徑；為 null 時改用 <paramref name="Text"/>。</param>
public sealed record ProviderBadge(
    string? IconPath,
    string? Text,
    Color Background,
    Color Foreground)
{
    private static readonly Color OnDark = Color.Parse("#FFFFFF");
    private static readonly Color OnLight = Color.Parse("#16181C");

    public bool HasIcon => IconPath is not null;

    /// <summary>官方標誌，白色描繪於品牌色底。</summary>
    public static ProviderBadge Icon(string iconPath, string background) =>
        new(iconPath, null, Color.Parse(background), OnDark);

    /// <summary>尚無標誌時的字母標記。</summary>
    public static ProviderBadge Monogram(string text, string background, bool darkText = false) =>
        new(null, text, Color.Parse(background), darkText ? OnLight : OnDark);
}
