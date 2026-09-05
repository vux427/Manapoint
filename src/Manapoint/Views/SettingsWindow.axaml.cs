using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.VisualTree;
using Manapoint.ViewModels;

namespace Manapoint.Views;

public partial class SettingsWindow : Window
{
    /// <summary>行程內拖曳，不需要跨應用程式，用 in-process 格式即可。</summary>
    private static readonly DataFormat<string> ProviderFormat =
        DataFormat.CreateInProcessFormat<string>("manapoint.provider");

    public SettingsWindow()
    {
        InitializeComponent();

        // 拖放是附加事件，無法直接寫在 DataTemplate 的屬性上，
        // 因此掛在清單本身，再由事件來源回推是哪一列。
        ProviderList.AddHandler(DragDrop.DragOverEvent, OnProviderDragOver);
        ProviderList.AddHandler(DragDrop.DropEvent, OnProviderDrop);
    }

    /// <summary>只有握把會啟動拖曳，勾選框與其餘區域維持正常點擊。</summary>
    private async void OnGripPressed(object? sender, PointerPressedEventArgs e)
    {
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed) return;
        if (sender is not Control { DataContext: ProviderToggleViewModel vm }) return;

        var transfer = new DataTransfer();
        transfer.Add(DataTransferItem.Create(ProviderFormat, vm.Id));

        e.Handled = true;
        await DragDrop.DoDragDropAsync(e, transfer, DragDropEffects.Move);
    }

    private void OnProviderDragOver(object? sender, DragEventArgs e)
    {
        e.DragEffects = e.DataTransfer.Contains(ProviderFormat)
            ? DragDropEffects.Move
            : DragDropEffects.None;

        e.Handled = true;
    }

    private void OnProviderDrop(object? sender, DragEventArgs e)
    {
        if (DataContext is not SettingsViewModel settings) return;
        if (e.DataTransfer.TryGetValue(ProviderFormat) is not { } draggedId) return;
        if (TargetOf(e) is not { } target) return;

        var dragged = settings.Providers.FirstOrDefault(p => p.Id == draggedId);
        if (dragged is null || ReferenceEquals(dragged, target)) return;

        settings.MoveProvider(dragged, settings.Providers.IndexOf(target));
        e.Handled = true;
    }

    /// <summary>從事件來源往上找，第一個綁著服務的控制項就是放置目標。</summary>
    private static ProviderToggleViewModel? TargetOf(RoutedEventArgs e)
    {
        for (var visual = e.Source as Visual; visual is not null; visual = visual.GetVisualParent())
        {
            if (visual is Control { DataContext: ProviderToggleViewModel vm }) return vm;
        }

        return null;
    }
}
