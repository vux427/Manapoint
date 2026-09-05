namespace Manapoint.Models;

/// <summary>持久化的使用者偏好。</summary>
public sealed class AppSettings
{
    public string ThemeName { get; set; } = AppTheme.Graphite.Name;

    /// <summary>面板底色的不透明度，0.15–1.0。</summary>
    public double PanelOpacity { get; set; } = 0.85;

    /// <summary>要顯示的服務 id。null 代表尚未設定過，套用預設。</summary>
    public List<string>? EnabledProviders { get; set; }

    /// <summary>服務的顯示順序（含未勾選者）。null 代表沿用註冊表順序。</summary>
    public List<string>? ProviderOrder { get; set; }
}
