using System.Text.Json;
using Manapoint.Models;

namespace Manapoint.Services;

/// <summary>把偏好存成使用者設定目錄下的 JSON。</summary>
public static class SettingsStore
{
    private static readonly JsonSerializerOptions Options = new() { WriteIndented = true };

    public static string FilePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "Manapoint",
        "settings.json");

    /// <summary>讀取偏好。檔案不存在或損毀時回傳預設值——偏好遺失不值得中斷程式。</summary>
    public static AppSettings Load()
    {
        if (!File.Exists(FilePath)) return new AppSettings();

        try
        {
            return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FilePath))
                   ?? new AppSettings();
        }
        catch (JsonException)
        {
            return new AppSettings();
        }
    }

    public static void Save(AppSettings settings)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
        File.WriteAllText(FilePath, JsonSerializer.Serialize(settings, Options));
    }
}
