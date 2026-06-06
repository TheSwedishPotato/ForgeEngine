# ForgeDub - one-click launcher (PowerShell)
# Run with:  powershell -ExecutionPolicy Bypass -File .\start.ps1
Set-Location -Path $PSScriptRoot

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "Python not found. Install Python 3.10+ from https://www.python.org/downloads/" -ForegroundColor Yellow
    Write-Host "Tick 'Add python.exe to PATH' during install." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    Write-Host "Creating environment (first run only)..."
    python -m venv .venv
}

Write-Host "Installing app (first run can take a minute)..."
& ".venv\Scripts\python.exe" -m pip install --upgrade pip
& ".venv\Scripts\python.exe" -m pip install -r requirements.txt

Write-Host "Starting ForgeDub..."
& ".venv\Scripts\python.exe" app.py
