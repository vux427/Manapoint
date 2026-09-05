using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Controls.Templates;
using Avalonia.Data;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Manapoint.Models;
using Manapoint.Services;
using Manapoint.ViewModels;

namespace Manapoint.Views;

public partial class MainWindow : Window
{
    private SettingsWindow? _settings;

    /// <summary>按住時的客戶區座標。放開時沒動過視為點擊，不觸發吸附。</summary>
    private Point? _pressClient;

    /// <summary>掛在 Application 上的托盤圖示（GetIcons 只認 Application）。</summary>
    private static TrayIcon Tray => TrayIcon.GetIcons(App.Current!)!.First();

    public MainWindow()
    {
        InitializeComponent();
        Activated += OnWindowActivated;
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);

        if (change.Property == DataContextProperty)
        {
            if (change.OldValue is MainViewModel oldMain)
                oldMain.Settings.PresentationChanged -= ApplyCardsPanel;

            if (change.NewValue is MainViewModel main)
            {
                main.Settings.PresentationChanged += ApplyCardsPanel;
                ApplyCardsPanel();
            }
        }
    }

    /// <summary>直／橫排列切換：換 ItemsPanel，橫向時寬度改隨內容自動調整。</summary>
    private void ApplyCardsPanel()
    {
        if (DataContext is not MainViewModel main) return;

        var horizontal = main.Settings.IsHorizontalCards;
        CardsList.ItemsPanel = horizontal
            ? new FuncTemplate<Panel?>(() => new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 })
            : new FuncTemplate<Panel?>(() => new StackPanel());

        if (horizontal)
        {
            ClearValue(WidthProperty);
            SizeToContent = SizeToContent.WidthAndHeight;
        }
        else
        {
            Bind(WidthProperty, new Binding("Settings.PanelWidth"));
            SizeToContent = SizeToContent.Height;
        }
    }

    /// <summary>
    /// 無邊框視窗靠拖曳面板本身移動（系統原生拖曳才跟手）。右鍵留給選單。
    /// 吸附只在放開瞬間做一次：拖曳中逐事件搬視窗又鈍又抖。
    /// </summary>
    private void OnDragArea(object? sender, PointerPressedEventArgs e)
    {
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed) return;

        _pressClient = e.GetPosition(this);
        BeginMoveDrag(e);
    }

    private void OnDragEnd(object? sender, PointerReleasedEventArgs e)
    {
        if (_pressClient is not { } pressed) return;
        _pressClient = null;

        var released = e.GetPosition(this);
        var moved = Math.Abs(released.X - pressed.X) + Math.Abs(released.Y - pressed.Y);
        if (moved <= 4) return; // 沒拖過，只是點擊

        Position = SnapToCorner(Position);
    }

    /// <summary>把位置吸到目前螢幕工作區的角落／邊緣。尺寸需換算成物理像素。</summary>
    private PixelPoint SnapToCorner(PixelPoint pos)
    {
        var screen = Screens.ScreenFromPoint(pos);
        if (screen is null) return pos;

        var scaling = screen.Scaling;
        var size = new PixelSize(
            (int)(Bounds.Width * scaling),
            (int)(Bounds.Height * scaling));
        return WindowSnap.Snap(pos, size, screen.WorkingArea);
    }

    /// <summary>
    /// 最小化：工作列和右下角托盤同時露出來當回家的路（平常兩邊都不佔）。
    /// 從任一邊恢復後都藏回去。
    /// </summary>
    private void OnMinimize(object? sender, RoutedEventArgs e)
    {
        Tray.IsVisible = true;
        ShowInTaskbar = true;
        WindowState = WindowState.Minimized;
    }

    private void OnWindowActivated(object? sender, EventArgs e)
    {
        if (WindowState == WindowState.Minimized) return;

        Tray.IsVisible = false;
        if (ShowInTaskbar) ShowInTaskbar = false;
    }

    /// <summary>叫回主面板（托盤/工作列共用）。</summary>
    public void ShowPanel()
    {
        Show();
        WindowState = WindowState.Normal;
        Activate();
    }

    /// <summary>打開設定視窗（托盤共用）。</summary>
    public void ShowSettings()
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

    private void OnOpenSettings(object? sender, RoutedEventArgs e) => ShowSettings();

    private void OnExit(object? sender, RoutedEventArgs e)
    {
        if (App.Current?.ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
            desktop.Shutdown();
    }
}
