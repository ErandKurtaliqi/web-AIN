# Start the Python FastAPI microservice
# Run from the AIN_25-26 project root

Write-Host "Installing Python API dependencies..." -ForegroundColor Cyan
pip install -r python_api/requirements.txt

Write-Host ""
Write-Host "Starting FastAPI on http://localhost:8000" -ForegroundColor Green
Write-Host "Swagger UI: http://localhost:8000/docs" -ForegroundColor Yellow
Write-Host ""

uvicorn python_api.api:app --host 0.0.0.0 --port 8000 --reload
