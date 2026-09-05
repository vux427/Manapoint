namespace Manapoint.Collectors;

/// <summary>
/// opencode CLI 的認證檔位置。opencode Go 與 xAI 的登入都存在這裡，
/// 兩個取數器共用同一份路徑推導。
/// </summary>
public static class OpenCodeAuth
{
    public static string FilePath => Path.Combine(DataHome(), "opencode", "auth.json");

    private static string DataHome()
    {
        var xdg = Environment.GetEnvironmentVariable("XDG_DATA_HOME");
        if (!string.IsNullOrWhiteSpace(xdg)) return xdg;

        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".local", "share");
    }
}
