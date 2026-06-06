@echo off
REM ============================================================
REM  ForgeDub - one-click launcher for Windows
REM  Just double-click this file. First run sets everything up.
REM ============================================================
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo Python was not found on your PC.
  echo Install Python 3.10+ from https://www.python.org/downloads/
  echo IMPORTANT: tick "Add python.exe to PATH" during the install.
  echo.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating environment (first run only)...
  python -m venv .venv
)

echo Installing app (first run can take a minute)...
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt

echo.
echo Starting ForgeDub...
".venv\Scripts\python.exe" app.py

echo.
echo ForgeDub closed. (If no window opened, open the http address shown above
echo in your browser.)
pause
endlocal
