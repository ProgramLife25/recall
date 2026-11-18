using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using Recall.Windows.Models;
using Recall.Windows.Services;

namespace Recall.Windows;

public partial class MainWindow : Window
{
    private readonly HotKeyService _hotKeyService = new();
    private List<IndexedItem> _allItems = new();
    private string _currentMode = "Everything";

    private static readonly SolidColorBrush ActiveTabBrush = new(Color.FromRgb(99, 102, 241));
    private static readonly SolidColorBrush InactiveTabBrush = new(Color.FromRgb(30, 41, 59));

    public MainWindow()
    {
        InitializeComponent();
        _ = LoadItemsAsync();
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);

        // Register Alt+Space Hotkey
        var helper = new WindowInteropHelper(this);
        var hwnd = helper.Handle;

        _hotKeyService.Register(hwnd);
        _hotKeyService.HotKeyPressed += OnGlobalHotKeyPressed;

        var source = HwndSource.FromHwnd(hwnd);
        source?.AddHook(WndProc);
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        _hotKeyService.ProcessMessage(msg, wParam);
        return IntPtr.Zero;
    }

    private void OnGlobalHotKeyPressed()
    {
        if (IsVisible && WindowState != WindowState.Minimized)
        {
            Hide();
        }
        else
        {
            Show();
            WindowState = WindowState.Normal;
            Activate();
            SearchBox.Focus();
        }
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
            var rng = new Random();
            currentPool = _allItems.OrderBy(_ => rng.Next());
        }

        var results = SearchEngine.Search(SearchBox.Text, currentPool);
        CardsItemsControl.ItemsSource = results;

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
        TabEverything.Background = InactiveTabBrush;
        TabTopMind.Background = InactiveTabBrush;
        TabSerendipity.Background = InactiveTabBrush;

        active.Background = ActiveTabBrush;
    }

    private async void OnToggleFavoriteClicked(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement element && element.Tag is string itemId)
        {
            await DatabaseService.Instance.ToggleFavoriteAsync(itemId);
            await LoadItemsAsync();
        }
    }

    private void OnCardClicked(object sender, MouseButtonEventArgs e)
    {
        if (sender is FrameworkElement element && element.DataContext is SearchResult result)
        {
            if (File.Exists(result.Item.Path))
            {
                Process.Start(new ProcessStartInfo(result.Item.Path) { UseShellExecute = true });
            }
        }
    }

    #region Drag and Drop Ingestion

    private void OnWindowDragOver(object sender, DragEventArgs e)
    {
        if (e.Data.GetDataPresent(DataFormats.FileDrop))
        {
            e.Effects = DragDropEffects.Copy;
            e.Handled = true;
        }
        else
        {
            e.Effects = DragDropEffects.None;
        }
    }

    private async void OnWindowDrop(object sender, DragEventArgs e)
    {
        if (e.Data.GetDataPresent(DataFormats.FileDrop))
        {
            var files = (string[])e.Data.GetData(DataFormats.FileDrop);
            if (files != null)
            {
                foreach (var file in files)
                {
                    if (File.Exists(file))
                    {
                        StatusTextBlock.Text = $"Analyzing and indexing {Path.GetFileName(file)} with Windows OCR...";
                        await FileIndexerService.Instance.IngestFileAsync(file);
                    }
                }
                await LoadItemsAsync();
            }
        }
    }

    #endregion

    #region Action Buttons

    private async void OnImportFileClicked(object sender, RoutedEventArgs e)
    {
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Title = "Import Media into Recall",
            Filter = "Supported Media (*.png;*.jpg;*.jpeg;*.webp;*.pdf;*.md;*.txt)|*.png;*.jpg;*.jpeg;*.webp;*.pdf;*.md;*.txt|All Files (*.*)|*.*",
            Multiselect = true
        };

        if (dialog.ShowDialog(this) == true)
        {
            foreach (var file in dialog.FileNames)
            {
                StatusTextBlock.Text = $"Importing {Path.GetFileName(file)}...";
                await FileIndexerService.Instance.IngestFileAsync(file);
            }
            await LoadItemsAsync();
        }
    }

    private void OnNewNoteClicked(object sender, RoutedEventArgs e)
    {
        NoteTitleBox.Text = string.Empty;
        NoteContentBox.Text = string.Empty;
        NoteModalGrid.Visibility = Visibility.Visible;
        NoteTitleBox.Focus();
    }

    private void OnCancelNoteClicked(object sender, RoutedEventArgs e)
    {
        NoteModalGrid.Visibility = Visibility.Collapsed;
    }

    private async void OnSaveNoteClicked(object sender, RoutedEventArgs e)
    {
        string title = NoteTitleBox.Text.Trim();
        string content = NoteContentBox.Text;

        if (string.IsNullOrWhiteSpace(title))
        {
            title = "Untitled Note";
        }

        NoteModalGrid.Visibility = Visibility.Collapsed;
        StatusTextBlock.Text = $"Saving quick note: {title}...";
        await FileIndexerService.Instance.CreateQuickNoteAsync(title, content);
        await LoadItemsAsync();
    }

    #endregion

    protected override void OnClosed(EventArgs e)
    {
        _hotKeyService.Dispose();
        base.OnClosed(e);
    }
}