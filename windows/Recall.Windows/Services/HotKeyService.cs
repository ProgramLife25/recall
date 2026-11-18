using System;
using System.Runtime.InteropServices;

namespace Recall.Windows.Services;

public class HotKeyService : IDisposable
{
    private const int WM_HOTKEY = 0x0312;
    private const uint MOD_ALT = 0x0001;
    private const uint VK_SPACE = 0x20;
    private const int HOTKEY_ID = 9001;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    private IntPtr _hwnd;
    private bool _isRegistered;
    public event Action? HotKeyPressed;

    public void Register(IntPtr hwnd)
    {
        _hwnd = hwnd;
        _isRegistered = RegisterHotKey(_hwnd, HOTKEY_ID, MOD_ALT, VK_SPACE);
        if (!_isRegistered)
        {
            int error = Marshal.GetLastWin32Error();
            System.Diagnostics.Debug.WriteLine($"[HotKey Error] Failed to register Alt+Space: {error}");
        }
    }

    public void ProcessMessage(int msg, IntPtr wParam)
    {
        if (msg == WM_HOTKEY && wParam.ToInt32() == HOTKEY_ID)
        {
            HotKeyPressed?.Invoke();
        }
    }

    public void Dispose()
    {
        if (_isRegistered && _hwnd != IntPtr.Zero)
        {
            UnregisterHotKey(_hwnd, HOTKEY_ID);
            _isRegistered = false;
        }
    }
}
