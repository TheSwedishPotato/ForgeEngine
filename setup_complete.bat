@echo off
echo Setting up Forge Engine development environment...

:: Refresh environment variables
call RefreshEnv.cmd

:: Initialize Git repository
echo Initializing Git repository...
git init

:: Configure Git (you'll need to modify these)
echo Please enter your GitHub username:
set /p GITHUB_USERNAME=
echo Please enter your Git email:
set /p GIT_EMAIL=

:: Configure Git user
git config user.name "%GITHUB_USERNAME%"
git config user.email "%GIT_EMAIL%"

:: Add all files
echo Adding files to Git...
git add .

:: Create initial commit
echo Creating initial commit...
git commit -m "Initial commit: Forge Engine medieval simulation"

:: Instructions for GitHub setup
echo.
echo ==============================================
echo Next steps:
echo 1. Go to https://github.com/new
echo 2. Create a new repository named "ForgeEngine"
echo 3. Do not initialize with README
echo.
echo After creating the repository, press any key to continue...
pause

:: Add remote and push
echo Setting up remote repository...
git remote add origin https://github.com/%GITHUB_USERNAME%/ForgeEngine.git
git branch -M main
git push -u origin main

echo.
echo Setup complete! Your code is now on GitHub.
echo Repository URL: https://github.com/%GITHUB_USERNAME%/ForgeEngine
echo.
