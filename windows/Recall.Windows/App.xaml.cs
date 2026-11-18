using Microsoft.UI.Xaml;
using Recall.Windows.Services;

namespace Recall.Windows;

public partial class App : Application
{
    private MainWindow? _mainWindow;

    public App()
    {
        this.InitializeComponent();
    }

    protected override async void OnLaunched(LaunchActivatedEventArgs args)
    {
        // Initialize local SQLite database
        await DatabaseService.Instance.InitializeAsync();

        _mainWindow = new MainWindow();
        _mainWindow.Activate();
    }
}
