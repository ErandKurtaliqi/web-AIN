# Start the ASP.NET Core backend (requires .NET 8 SDK)
Set-Location $PSScriptRoot

Write-Host "Starting ASP.NET Core backend on http://localhost:5000" -ForegroundColor Green
Write-Host ""

Set-Location backend/SchedulingAPI
dotnet run --urls "http://localhost:5000"
