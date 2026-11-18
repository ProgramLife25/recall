using System.Windows;
using Recall.Windows.Services;

namespace Recall.Windows;

public partial class App : Application
{
    private async void Application_Startup(object sender, StartupEventArgs e)
    {
        await DatabaseService.Instance.InitializeAsync();
        var mainWindow = new MainWindow();
        mainWindow.Show();
    }
}
