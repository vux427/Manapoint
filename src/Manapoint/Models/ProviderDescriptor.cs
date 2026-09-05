using Avalonia.Media;

namespace Manapoint.Models;

/// <summary>
/// 一家可接入的訂閱服務。<see cref="IsAvailable"/> 為 false 代表
/// 取數器尚未實作，設定頁會列出但不讓勾選。
/// </summary>
/// <param name="Badge">卡片左側的識別標記：品牌色底 + 短字母。</param>
public sealed record ProviderDescriptor(
    string Id,
    string Name,
    string CredentialHint,
    bool IsAvailable,
    ProviderBadge Badge);

/// <summary>
/// 服務的視覺識別。用品牌色與字母標記，不內嵌他人商標圖檔。
/// </summary>
public sealed record ProviderBadge(string Text, Color Background, Color Foreground)
{
    private static readonly Color OnDark = Color.Parse("#FFFFFF");
    private static readonly Color OnLight = Color.Parse("#16181C");

    public static ProviderBadge Dark(string text, string background) =>
        new(text, Color.Parse(background), OnDark);

    public static ProviderBadge Light(string text, string background) =>
        new(text, Color.Parse(background), OnLight);
}
