using Avalonia;
using System;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace Manapoint;

sealed class Program
{
    // Initialization code. Don't use any Avalonia, third-party APIs or any
    // SynchronizationContext-reliant code before AppMain is called: things aren't initialized
    // yet and stuff might break.
    [STAThread]
    public static void Main(string[] args)
    {
        // 同一支執行檔只跑一份：最小化躲到托盤後，使用者常以為沒開而連點。
        // 以執行檔路徑區分，開發版和散布版可各跑一份互不影響。
        using var mutex = new Mutex(true, MutexName(), out var createdNew);
        if (!createdNew) return;

        BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }

    private static string MutexName()
    {
        var path = Environment.ProcessPath ?? "Manapoint";
        var tag = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(path)));
        return $"Local\\Manapoint_{tag}";
    }

    // Avalonia configuration, don't remove; also used by visual designer.
    public static AppBuilder BuildAvaloniaApp()
        => AppBuilder.Configure<App>()
            .UsePlatformDetect()
#if DEBUG
            .WithDeveloperTools()
#endif
            .WithInterFont()
            .LogToTrace();
}
