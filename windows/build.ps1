param(
    [string]$Configuration = "Release",
    [string]$Platform = "x64"
)

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "  Building Recall for Windows (Native C# / WinUI 3)" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    Write-Error ".NET 8 SDK was not found. Please install .NET 8 from https://dotnet.microsoft.com/download"
    exit 1
}

Write-Host "`n[1/2] Restoring NuGet packages..." -ForegroundColor Yellow
dotnet restore Recall.Windows.sln -p:Platform=$Platform

Write-Host "`n[2/2] Publishing standalone single-file win-$Platform executable..." -ForegroundColor Yellow
$outDir = "publish\win-$Platform"
dotnet publish Recall.Windows\Recall.Windows.csproj -c $Configuration -r win-$Platform -p:Platform=$Platform --self-contained -p:PublishSingleFile=true -o $outDir

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n===================================================" -ForegroundColor Green
    Write-Host "  BUILD SUCCESS!" -ForegroundColor Green
    Write-Host "  Standalone executable created at: $outDir\Recall.Windows.exe" -ForegroundColor Green
    Write-Host "===================================================" -ForegroundColor Green
} else {
    Write-Error "`nBuild failed. Review the output log above."
}
