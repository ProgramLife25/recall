@echo off
echo ===================================================
echo   Building Recall for Windows (Native C# / WinUI 3)
echo ===================================================

where dotnet >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] .NET 8 SDK was not found. Please install .NET 8 from https://dotnet.microsoft.com/download
    exit /b 1
)

echo [1/2] Restoring NuGet packages...
dotnet restore Recall.Windows.sln

echo [2/2] Publishing standalone single-file x64 executable...
dotnet publish Recall.Windows\Recall.Windows.csproj -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -o publish\win-x64

if %errorlevel% equ 0 (
    echo.
    echo ===================================================
    echo   BUILD SUCCESS!
    echo   Standalone executable created at: publish\win-x64\Recall.Windows.exe
    echo ===================================================
) else (
    echo.
    echo [ERROR] Build failed. Review the output log above.
)
