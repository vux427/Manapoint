using System.Text.Json;
using System.Text.Json.Serialization;
using Manapoint.Models;

namespace Manapoint.Services;

/// <summary>
/// 上次成功取數的快照（%APPDATA%/Manapoint/usage-snapshot.json，
/// 已在 .gitignore）。冷啟動或被限流時先顯示舊數字，不再整排紅字。
/// 快照只有百分比與重置時間，不含任何憑證。
/// </summary>
public static class UsageCacheStore
{
    public static string FilePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "Manapoint",
        "usage-snapshot.json");

    private static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() },
    };

    /// <summary>讀取快照。檔案不存在或損毀回傳空表——快取遺失不值得中斷程式。</summary>
    public static Dictionary<string, ProviderUsage> Load()
    {
        try
        {
            if (!File.Exists(FilePath)) return [];
            return Deserialize(File.ReadAllText(FilePath));
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            return [];
        }
    }

    /// <summary>寫入快照。失敗就地吞掉，下次成功再寫。</summary>
    public static void Save(Dictionary<string, ProviderUsage> snapshot)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            File.WriteAllText(FilePath, Serialize(snapshot));
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
        }
    }

    public static string Serialize(Dictionary<string, ProviderUsage> snapshot) =>
        JsonSerializer.Serialize(snapshot, Options);

    public static Dictionary<string, ProviderUsage> Deserialize(string json) =>
        JsonSerializer.Deserialize<Dictionary<string, ProviderUsage>>(json, Options) ?? [];
}
