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
        ProviderList.AddHandler(DragDrop.DragLeaveEvent, OnProviderDragLeave);
    }

    /// <summary>只有握把會啟動拖曳，勾選框與其餘區域維持正常點擊。</summary>
    private async void OnGripPressed(object? sender, PointerPressedEventArgs e)
    {
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed) return;
        if (sender is not Control { DataContext: ProviderToggleViewModel vm }) return;

        var transfer = new DataTransfer();
        transfer.Add(DataTransferItem.Create(ProviderFormat, vm.Id));

        e.Handled = true;
        vm.IsDragging = true;
        try
        {
            await DragDrop.DoDragDropAsync(e, transfer, DragDropEffects.Move);
        }
        finally
        {
            vm.IsDragging = false;
            ClearDropTargets();
        }
    }

    private void OnProviderDragOver(object? sender, DragEventArgs e)
    {
        if (!e.DataTransfer.Contains(ProviderFormat))
        {
            e.DragEffects = DragDropEffects.None;
            e.Handled = true;
            return;
        }

        e.DragEffects = DragDropEffects.Move;

        if (DataContext is SettingsViewModel settings && TargetOf(e) is { } target)
        {
            // 拖到自己身上不顯示插入線，避免誤導。
            var draggedId = e.DataTransfer.TryGetValue(ProviderFormat);
            if (draggedId == target.Id)
            {
                ClearDropTargets();
            }
            else
            {
                // 指標在列的上半放上面、下半放下面，插入線跟著走。
                if (TargetControl(e) is Control row)
                {
                    var position = e.GetPosition(row);
                    target.DropAfter = position.Y > row.Bounds.Height / 2;
                }

                foreach (var provider in settings.Providers)
                    provider.IsDropTarget = ReferenceEquals(provider, target);
            }
        }

        e.Handled = true;
    }

    private void OnProviderDragLeave(object? sender, RoutedEventArgs e)
    {
        ClearDropTargets();
    }

    private void ClearDropTargets()
    {
        if (DataContext is not SettingsViewModel settings) return;

        foreach (var provider in settings.Providers)
            provider.IsDropTarget = false;
    }

    private void OnProviderDrop(object? sender, DragEventArgs e)
    {
        if (DataContext is not SettingsViewModel settings) return;
        if (e.DataTransfer.TryGetValue(ProviderFormat) is not { } draggedId) return;
        if (TargetOf(e) is not { } target) return;

        var dragged = settings.Providers.FirstOrDefault(p => p.Id == draggedId);
        var insertAfter = target.DropAfter;
        ClearDropTargets();
        if (dragged is null || ReferenceEquals(dragged, target)) return;

        // 插入點是「目標列之前或之後」；移除被拖列後下標前移，需扣回來。
        var from = settings.Providers.IndexOf(dragged);
        var insertion = settings.Providers.IndexOf(target) + (insertAfter ? 1 : 0);
        var to = insertion > from ? insertion - 1 : insertion;
        if (to == from) return;

        settings.MoveProvider(dragged, to);
        e.Handled = true;
    }

    /// <summary>從事件來源往上找，第一個綁著服務的控制項就是放置目標。</summary>
    private static ProviderToggleViewModel? TargetOf(RoutedEventArgs e) =>
        TargetControl(e)?.DataContext as ProviderToggleViewModel;

    /// <summary>
    /// 從事件來源往上找，最外層綁著服務的控制項就是列容器。
    /// 內層控制項（勾選框、文字）同樣繼承該 DataContext，
    /// 量測指標上下半區必須用列容器，取第一個會失準。
    /// </summary>
    private static Control? TargetControl(RoutedEventArgs e)
    {
        Control? found = null;
        for (var visual = e.Source as Visual; visual is not null; visual = visual.GetVisualParent())
        {
            if (visual is Control { DataContext: ProviderToggleViewModel } control) found = control;
        }

        return found;
    }
}
