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

    /// <summary>自訂拖曳中：按住點的客戶區座標與當時視窗位置（位移用差值算）。</summary>
    private bool _moving;
    private Point _grabClient;
    private PixelPoint _grabPosition;

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

        _grabClient = e.GetPosition(this);
        _grabPosition = Position;
        _moving = true;
        e.Pointer.Capture(area);
        e.Handled = true;
    }

    private void OnDragMove(object? sender, PointerEventArgs e)
    {
        if (!_moving) return;

        // 客戶區差值是邏輯像素，乘縮放才是物理位移。
        var scaling = Screens.ScreenFromWindow(this)?.Scaling ?? 1.0;
        var current = e.GetPosition(this);
        var pos = new PixelPoint(
            _grabPosition.X + (int)((current.X - _grabClient.X) * scaling),
            _grabPosition.Y + (int)((current.Y - _grabClient.Y) * scaling));
        Position = SnapToCorner(pos);
        e.Handled = true;
    }

    private void OnDragEnd(object? sender, PointerReleasedEventArgs e)
    {
        if (!_moving) return;

        _moving = false;
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
        return WindowSnap.Snap(pos, size, screen.WorkingArea);
    }

    /// <summary>
    /// 平常不佔工作列，最小化時才暫時露出來（不然縮了以後叫不回來）；
    /// 從工作列恢復後藏回去。
    /// </summary>
    private void OnMinimize(object? sender, RoutedEventArgs e)
    {
        ShowInTaskbar = true;
        WindowState = WindowState.Minimized;
    }

    private void OnWindowActivated(object? sender, EventArgs e)
    {
        if (WindowState != WindowState.Minimized && ShowInTaskbar)
            ShowInTaskbar = false;
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
