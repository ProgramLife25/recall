@echo off
setlocal
echo ===================================================
echo   Building Recall for Windows (Native C# / WPF)
echo ===================================================

where dotnet >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] .NET 8 SDK was not found in your PATH!
    echo.
    echo 1. If you just installed .NET 8, please restart your terminal or computer so Windows updates the PATH.
    echo 2. If not installed yet, download .NET 8 SDK from: https://dotnet.microsoft.com/download/dotnet/8.0
    echo.
    pause
    exit /b 1
)

echo.
echo [1/2] Restoring NuGet packages...
dotnet restore Recall.Windows.sln
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Failed to restore NuGet packages. Check your internet connection.
    pause
    exit /b 1
)

echo.
echo [2/2] Publishing standalone single-file x64 executable...
dotnet publish Recall.Windows\Recall.Windows.csproj -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o publish\win-x64

if %errorlevel% equ 0 (
    echo.
    echo ===================================================
    echo   BUILD SUCCESS!
    echo   Standalone executable created at:
    echo   publish\win-x64\Recall.Windows.exe
    echo ===================================================
    echo.
) else (
    echo.
    echo [ERROR] Build failed. Please review the error log above.
    echo.
)

pause
