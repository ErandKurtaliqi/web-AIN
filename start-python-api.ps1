# Start the Python FastAPI microservice (run from project root)
Set-Location $PSScriptRoot

Write-Host "Installing Python API dependencies..." -ForegroundColor Cyan
python -m pip install -r python_api/requirements.txt

Write-Host ""
Write-Host "Starting FastAPI on http://localhost:8000" -ForegroundColor Green
Write-Host "Swagger UI: http://localhost:8000/docs" -ForegroundColor Yellow
Write-Host ""

python -m uvicorn python_api.api:app --host 0.0.0.0 --port 8000 --reload --reload-dir python_api
