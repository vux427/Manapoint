using Avalonia.Controls;
using Avalonia.Input;

namespace Manapoint.Views;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
    }

    /// <summary>無邊框視窗靠拖曳面板本身移動。</summary>
    private void OnDragArea(object? sender, PointerPressedEventArgs e)
    {
        if (e.GetCurrentPoint(this).Properties.IsLeftButtonPressed)
            BeginMoveDrag(e);
    }
}
