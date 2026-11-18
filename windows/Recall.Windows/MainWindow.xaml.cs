using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Windows.ApplicationModel.DataTransfer;
using Windows.Storage.Pickers;
using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Recall.Windows.Models;
using Recall.Windows.Services;
using WinRT.Interop;

namespace Recall.Windows;

public partial class MainWindow : Window
{
    private readonly HotKeyService _hotKeyService = new();
    private List<IndexedItem> _allItems = new();
    private string _currentMode = "Everything"; // "Everything", "TopMind", "Serendipity"

    public MainWindow()
    {
        this.InitializeComponent();

        // Customize window size and title
        var appWindow = GetAppWindowForCurrentWindow();
        appWindow.Resize(new Windows.Graphics.SizeInt32(1380, 840));
        appWindow.Title = "Recall";

        // Setup Win32 HotKey (Alt + Space)
        IntPtr hwnd = WindowNative.GetWindowHandle(this);
        _hotKeyService.Register(hwnd);
        _hotKeyService.HotKeyPressed += OnGlobalHotKeyPressed;

        // Subclass window procedure to intercept WM_HOTKEY
        SubclassWindow(hwnd);

        // Load data on startup
        _ = LoadItemsAsync();
    }

    private async Task LoadItemsAsync()
    {
        _allItems = await DatabaseService.Instance.GetAllItemsAsync();
        UpdateView();
    }

    private void UpdateView()
    {
        IEnumerable<IndexedItem> currentPool = _allItems;

        if (_currentMode == "TopMind")
        {
            currentPool = _allItems.Where(x => x.IsFavorite);
        }
        else if (_currentMode == "Serendipity")
        {
            // Shuffled associative view
            var rng = new Random();
            currentPool = _allItems.OrderBy(_ => rng.Next());
        }

        var results = SearchEngine.Search(SearchBox.Text, currentPool);
        CardsGridView.ItemsSource = results;

        EmptyStatePanel.Visibility = results.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        StatusTextBlock.Text = $"Library: {_allItems.Count} memories saved • Showing {results.Count} results • GPU: {(VectorEmbeddingService.Instance.IsGpuAccelerated ? "Active (DirectML)" : "CPU Fallback")}";
    }

    private void OnSearchTextChanged(object sender, TextChangedEventArgs e)
    {
        UpdateView();
    }

    private void OnTabEverythingClicked(object sender, RoutedEventArgs e)
    {
        _currentMode = "Everything";
        UpdateTabButtons(TabEverything);
        UpdateView();
    }

    private void OnTabTopMindClicked(object sender, RoutedEventArgs e)
    {
        _currentMode = "TopMind";
        UpdateTabButtons(TabTopMind);
        UpdateView();
    }

    private void OnTabSerendipityClicked(object sender, RoutedEventArgs e)
    {
        _currentMode = "Serendipity";
        UpdateTabButtons(TabSerendipity);
        UpdateView();
    }

    private void UpdateTabButtons(Button active)
    {
        TabEverything.ClearValue(Button.StyleProperty);
        TabTopMind.ClearValue(Button.StyleProperty);
        TabSerendipity.ClearValue(Button.StyleProperty);

        active.Style = (Style)Application.Current.Resources["AccentButtonStyle"];
    }

    private async void OnToggleFavoriteClicked(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string itemId)
        {
            await DatabaseService.Instance.ToggleFavoriteAsync(itemId);
            await LoadItemsAsync();
        }
    }

    private void OnCardItemClicked(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is SearchResult result && File.Exists(result.Item.Path))
        {
            // Open in default Windows viewer
            Process.Start(new ProcessStartInfo(result.Item.Path) { UseShellExecute = true });
        }
    }

    #region Drag and Drop Ingestion

    private void OnGridDragOver(object sender, DragEventArgs e)
    {
        e.AcceptedOperation = DataPackageOperation.Copy;
        e.DragUIOverride.Caption = "Drop to remember in Recall";
    }

    private async void OnGridDrop(object sender, DragEventArgs e)
    {
        if (e.DataView.Contains(StandardDataFormats.StorageItems))
        {
            var items = await e.DataView.GetStorageItemsAsync();
            foreach (var storageItem in items)
            {
                if (File.Exists(storageItem.Path))
                {
                    StatusTextBlock.Text = $"Analyzing and indexing {storageItem.Name} with Windows OCR...";
                    await FileIndexerService.Instance.IngestFileAsync(storageItem.Path);
                }
            }
            await LoadItemsAsync();
        }
    }

    #endregion

    #region Action Buttons

    private async void OnImportFileClicked(object sender, RoutedEventArgs e)
    {
        var picker = new FileOpenPicker();
        IntPtr hwnd = WindowNative.GetWindowHandle(this);
        InitializeWithWindow.Initialize(picker, hwnd);

        picker.FileTypeFilter.Add(".png");
        picker.FileTypeFilter.Add(".jpg");
        picker.FileTypeFilter.Add(".jpeg");
        picker.FileTypeFilter.Add(".pdf");
        picker.FileTypeFilter.Add(".webp");

        var file = await picker.PickSingleFileAsync();
        if (file != null)
        {
            StatusTextBlock.Text = $"Importing {file.Name}...";
            await FileIndexerService.Instance.IngestFileAsync(file.Path);
            await LoadItemsAsync();
        }
    }

    private async void OnNewNoteClicked(object sender, RoutedEventArgs e)
    {
        var dialog = new ContentDialog
        {
            Title = "Create Quick Note",
            PrimaryButtonText = "Save to Recall",
            CloseButtonText = "Cancel",
            XamlRoot = this.Content.XamlRoot
        };

        var panel = new StackPanel { Spacing = 10 };
        var titleBox = new TextBox { PlaceholderText = "Note Title..." };
        var contentBox = new TextBox { PlaceholderText = "Markdown content or ideas...", AcceptsReturn = true, Height = 140 };

        panel.Children.Add(titleBox);
        panel.Children.Add(contentBox);
        dialog.Content = panel;

        if (await dialog.ShowAsync() == ContentDialogResult.Primary && !string.IsNullOrWhiteSpace(titleBox.Text))
        {
            await FileIndexerService.Instance.CreateQuickNoteAsync(titleBox.Text, contentBox.Text);
            await LoadItemsAsync();
        }
    }

    #endregion

    #region Global Hotkey & Window Management

    private void OnGlobalHotKeyPressed()
    {
        var appWindow = GetAppWindowForCurrentWindow();
        if (appWindow.IsVisible)
        {
            appWindow.Hide();
        }
        else
        {
            appWindow.Show();
            SearchBox.Focus(FocusState.Programmatic);
        }
    }

    private AppWindow GetAppWindowForCurrentWindow()
    {
        IntPtr hwnd = WindowNative.GetWindowHandle(this);
        WindowId windowId = Win32Interop.GetWindowIdFromWindow(hwnd);
        return AppWindow.GetFromWindowId(windowId);
    }

    // Win32 Window Subclassing to capture WM_HOTKEY
    private delegate IntPtr SubclassProc(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam, UIntPtr uIdSubclass, IntPtr dwRefData);

    [DllImport("comctl32.dll", SetLastError = true)]
    private static extern bool SetWindowSubclass(IntPtr hWnd, SubclassProc pfnSubclass, UIntPtr uIdSubclass, IntPtr dwRefData);

    [DllImport("comctl32.dll")]
    private static extern IntPtr DefSubclassProc(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam);

    private SubclassProc? _subclassDelegate;

    private void SubclassWindow(IntPtr hwnd)
    {
        _subclassDelegate = (h, msg, wp, lp, id, data) =>
        {
            _hotKeyService.ProcessMessage((int)msg, wp);
            return DefSubclassProc(h, msg, wp, lp);
        };
        SetWindowSubclass(hwnd, _subclassDelegate, UIntPtr.Zero, IntPtr.Zero);
    }

    #endregion
}
