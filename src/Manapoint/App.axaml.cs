using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using Manapoint.ViewModels;
using Manapoint.Views;

namespace Manapoint;

public partial class App : Application
{
    public override void Initialize()
    {
        AvaloniaXamlLoader.Load(this);
    }

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            desktop.MainWindow = new MainWindow
            {
                DataContext = new MainViewModel(),
            };
        }

        base.OnFrameworkInitializationCompleted();
    }

    /// <summary>托盤左鍵或「顯示面板」：叫回主面板。</summary>
    private void OnTrayRestore(object? sender, EventArgs e)
    {
        if (Current?.ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop
            && desktop.MainWindow is MainWindow main)
        {
            main.ShowPanel();
        }
    }

    private void OnTraySettings(object? sender, EventArgs e)
    {
        if (Current?.ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop
            && desktop.MainWindow is MainWindow main)
        {
            main.ShowPanel();
            main.ShowSettings();
        }
    }

    private void OnTrayExit(object? sender, EventArgs e)
    {
        if (Current?.ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
            desktop.Shutdown();
    }
}