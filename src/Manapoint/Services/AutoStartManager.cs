using System.Runtime.Versioning;
using Microsoft.Win32;

namespace Manapoint.Services;

/// <summary>
/// 開機自動啟動（僅 Windows）：在 HKCU\...\Run 下寫一筆指向目前執行檔。
/// HKCU 是使用者層級，不需管理員權限；登錄本身就是儲存，不另存設定檔。
/// 非 Windows 平台一律回報不支援，呼叫端用 <see cref="IsSupported"/> 隱藏選項。
/// </summary>
public static class AutoStartManager
{
    public const string ValueName = "Manapoint";

    private const string RunKeyPath = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Run";

    public static bool IsSupported => OperatingSystem.IsWindows();

    /// <summary>已註冊且指向的檔案還存在才算啟用；殘留的舊路徑視為未啟用。</summary>
    public static bool IsEnabled()
    {
        // 直接用 OperatingSystem.IsWindows() 判斷，讓 CA1416 知道後面的登錄呼叫有守衛。
        if (!OperatingSystem.IsWindows()) return false;

        try
        {
            var entry = ReadEntry();
            return entry is not null && File.Exists(Unquote(entry));
        }
        catch
        {
            // 讀取探測失敗就當作沒開，不值得為此打擾使用者。
            return false;
        }
    }

    public static void SetEnabled(bool enabled)
    {
        // 直接用 OperatingSystem.IsWindows() 判斷，讓 CA1416 知道後面的登錄呼叫有守衛。
        if (!OperatingSystem.IsWindows())
            throw new InvalidOperationException("開機啟動只支援 Windows。");

        var exe = Environment.ProcessPath;
        if (enabled && string.IsNullOrWhiteSpace(exe))
            throw new InvalidOperationException("找不到目前執行檔路徑，無法註冊開機啟動。");

        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: true)
                ?? throw new InvalidOperationException("打不開啟動登錄。");

            if (enabled)
                key.SetValue(ValueName, Quote(exe!), RegistryValueKind.String);
            else
                key.DeleteValue(ValueName, throwOnMissingValue: false);
        }
        catch (Exception ex) when (ex is not InvalidOperationException)
        {
            throw new InvalidOperationException($"寫入啟動登錄失敗：{ex.Message}", ex);
        }
    }

    /// <summary>路徑含空白時加引號，登錄才能正確啟動。</summary>
    public static string Quote(string path) => "\"" + path.Trim('"') + "\"";

    /// <summary>去掉登錄值外層引號，剩餘部分拿去檢查檔案是否存在。</summary>
    public static string Unquote(string? entry) => (entry ?? "").Trim().Trim('"');

    [SupportedOSPlatform("windows")]
    private static string? ReadEntry()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: false);
        return key?.GetValue(ValueName) as string;
    }
}
