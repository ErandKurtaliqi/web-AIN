# Start the Angular web simulator (requires Node.js 18+)
Set-Location $PSScriptRoot

Write-Host "Installing Angular dependencies..." -ForegroundColor Cyan
Set-Location frontend/scheduling-dashboard
npm install

Write-Host ""
Write-Host "Starting Angular dev server on http://localhost:4200" -ForegroundColor Green
Write-Host ""

npx ng serve --open
