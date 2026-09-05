using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Controls.Templates;
using Avalonia.Data;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Manapoint.Services;
using Manapoint.ViewModels;

namespace Manapoint.Views;

public partial class MainWindow : Window
{
    private SettingsWindow? _settings;

    /// <summary>自訂拖曳中：上次處理的客戶區座標。位移一律用「這次減上次」套到目前位置，錨定按住點會越算越偏。</summary>
    private bool _moving;
    private Point _lastClient;

    /// <summary>上次處理的游標物理位置。視窗位移會在游標不動時產生假移動事件，位置沒變就跳過。</summary>
    private double _lastPhysX;
    private double _lastPhysY;

    private readonly WindowSnap.Session _snap = new();

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

    /// <summary>無邊框視窗靠拖曳面板本身移動。右鍵留給選單。</summary>
    private void OnDragArea(object? sender, PointerPressedEventArgs e)
    {
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed) return;
        if (sender is not Control area) return;

        _lastClient = e.GetPosition(this);
        _moving = true;
        _snap.Reset();
        var scaling = Screens.ScreenFromWindow(this)?.Scaling ?? 1.0;
        _lastPhysX = Position.X + _lastClient.X * scaling;
        _lastPhysY = Position.Y + _lastClient.Y * scaling;
        e.Pointer.Capture(area);
        e.Handled = true;
    }

    private void OnDragMove(object? sender, PointerEventArgs e)
    {
        if (!_moving) return;

        // 客戶區差值是邏輯像素，乘縮放才是物理位移。
        var scaling = Screens.ScreenFromWindow(this)?.Scaling ?? 1.0;
        var current = e.GetPosition(this);
        var physX = Position.X + current.X * scaling;
        var physY = Position.Y + current.Y * scaling;

        // 游標沒動（視窗被吸附位移產生的假事件）就不搬視窗；
        // 但 _lastClient 仍要更新到新座標系，否則下次差值會混到兩個座標系。
        if (physX == _lastPhysX && physY == _lastPhysY)
        {
            _lastClient = current;
            return;
        }

        var pos = new PixelPoint(
            Position.X + (int)Math.Round((current.X - _lastClient.X) * scaling),
            Position.Y + (int)Math.Round((current.Y - _lastClient.Y) * scaling));
        _lastClient = current;
        _lastPhysX = physX;
        _lastPhysY = physY;
        Position = SnapToCorner(pos);
        e.Handled = true;
    }

    private void OnDragEnd(object? sender, PointerReleasedEventArgs e)
    {
        if (!_moving) return;

        _moving = false;
        _snap.Reset();
        e.Pointer.Capture(null);
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
        return _snap.Snap(pos, size, screen.WorkingArea);
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
