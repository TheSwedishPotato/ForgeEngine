@echo off
rem DubForge launcher.  Usage:
rem   dubforge.bat gui
rem   dubforge.bat dub "C:\movie.mkv" --to sv [--review] [--lipsync wav2lip]
rem   dubforge.bat test "C:\movie.mkv" [start-time like 00:10:00]   (30-second test into Swedish)
rem   dubforge.bat doctor
cd /d "%~dp0"
call conda activate dubforge
if errorlevel 1 (
  echo Open "Anaconda Prompt" and run setup_windows.bat first.
  exit /b 1
)
if /i "%~1"=="test" (
  if "%~3"=="" (set START=00:10:00) else (set START=%~3)
  python scripts\test_clip.py "%~2" --start %START% --to sv
  exit /b %errorlevel%
)
python main.py %*
