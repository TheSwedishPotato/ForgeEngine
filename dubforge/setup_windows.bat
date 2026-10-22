@echo off
rem DubForge one-shot setup for Windows. Run from the "Anaconda Prompt" (or Miniconda Prompt).
setlocal
cd /d "%~dp0"
echo.
echo === DubForge setup (about 20-40 minutes, ~15 GB of downloads) ===
echo.

where conda >nul 2>nul
if errorlevel 1 (
  echo [!] conda not found. Install Miniconda from https://docs.conda.io/en/latest/miniconda.html
  echo     then open "Anaconda Prompt" and run this script again.
  goto :fail
)

echo [1/5] Creating the conda environment "dubforge" ...
conda env list | findstr /b /c:"dubforge " >nul
if errorlevel 1 (
  call conda env create -f environment.yml
  if errorlevel 1 goto :fail
) else (
  echo     already exists, reusing it.
)
call conda activate dubforge
if errorlevel 1 goto :fail

where nvidia-smi >nul 2>nul
if errorlevel 1 (
  echo [2/5] No NVIDIA GPU found - installing the CPU build of PyTorch.
  echo       DubForge still works, but is much slower: expect roughly 10-20 minutes of waiting per minute of video.
  pip install torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cpu
) else (
  echo [2/5] NVIDIA GPU found - installing PyTorch with CUDA ...
  pip install torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cu124
)
if errorlevel 1 goto :fail

echo [3/5] Installing the AI libraries ...
pip install -r requirements-models.txt
if errorlevel 1 goto :fail
pip install --no-deps demucs==4.0.1
if errorlevel 1 goto :fail

echo [4/5] Checking the install ...
python main.py doctor

echo [5/5] Downloading models (needs internet, only this once) ...
python main.py models download
if errorlevel 1 goto :fail

echo.
echo === Setup finished. Next: ===
echo   dubforge.bat test "C:\path\to\movie.mkv"     (30-second test, Swedish)
echo   dubforge.bat gui                              (web interface)
echo   dubforge.bat dub "C:\path\to\movie.mkv" --to sv
echo.
pause
exit /b 0

:fail
echo.
echo [!] Setup stopped because of an error (see above). Copy the last ~20 lines and send them to me.
pause
exit /b 1
