namespace Manapoint.Models;

/// <summary>
/// 一家可接入的訂閱服務。<see cref="IsAvailable"/> 為 false 代表
/// 取數器尚未實作，設定頁會列出但不讓勾選。
/// </summary>
public sealed record ProviderDescriptor(
    string Id,
    string Name,
    string CredentialHint,
    bool IsAvailable);
