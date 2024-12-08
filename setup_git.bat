@echo off
echo Setting up Git repository for Forge Engine...

:: Initialize Git repository
git init

:: Add all files
git add .

:: Create initial commit
git commit -m "Initial commit: Forge Engine medieval simulation"

:: Instructions for manual steps
echo.
echo ==============================================
echo Git repository has been initialized locally!
echo.
echo Next steps:
echo 1. Create a GitHub account if you don't have one
echo 2. Go to https://github.com/new
echo 3. Name your repository "ForgeEngine"
echo 4. Do not initialize with README (we already have one)
echo 5. After creating the repository, run these commands:
echo.
echo git remote add origin https://github.com/YOUR_USERNAME/ForgeEngine.git
echo git branch -M main
echo git push -u origin main
echo.
echo Replace YOUR_USERNAME with your GitHub username
echo ==============================================
