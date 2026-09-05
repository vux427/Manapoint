using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Input;
using Avalonia.Interactivity;
using Manapoint.ViewModels;

namespace Manapoint.Views;

public partial class MainWindow : Window
{
    private SettingsWindow? _settings;

    public MainWindow()
    {
        InitializeComponent();
    }

    /// <summary>無邊框視窗靠拖曳面板本身移動。右鍵留給選單。</summary>
    private void OnDragArea(object? sender, PointerPressedEventArgs e)
    {
        if (e.GetCurrentPoint(this).Properties.IsLeftButtonPressed)
            BeginMoveDrag(e);
    }

    private void OnOpenSettings(object? sender, RoutedEventArgs e)
    {
        if (DataContext is not MainViewModel main) return;

        if (_settings is { IsVisible: true })
        {
            _settings.Activate();
            return;
        }

        _settings = new SettingsWindow { DataContext = main.Settings };
        _settings.Closed += (_, _) => _settings = null;
        _settings.Show(this);
    }

    private void OnExit(object? sender, RoutedEventArgs e)
    {
        if (App.Current?.ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
            desktop.Shutdown();
    }
}
