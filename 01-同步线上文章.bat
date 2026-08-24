@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo   The Aden Family - Sync from GitHub
echo ========================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Git was not found. Install Git for Windows first.
  goto :failed
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [ERROR] This folder is not a Git repository.
  goto :failed
)

for /f "delims=" %%B in ('git branch --show-current') do set "CURRENT_BRANCH=%%B"
if /i not "%CURRENT_BRANCH%"=="source" (
  echo [ERROR] Current branch is %CURRENT_BRANCH%, not source.
  echo Switch to the source branch and run this file again.
  goto :failed
)

for /f "delims=" %%S in ('git status --porcelain') do goto :dirty
goto :clean

:dirty
echo [STOPPED] Uncommitted local changes were found.
echo Run 02-Submit-and-Publish first to avoid overwriting local work.
echo.
git status --short
goto :failed

:clean
echo Pulling the latest source branch from GitHub...
git pull --rebase origin source
if errorlevel 1 (
  echo.
  echo [ERROR] Sync failed. No files were force-overwritten.
  goto :failed
)

echo.
echo [DONE] Local posts are synchronized with GitHub source.
git status -sb
echo.
pause
exit /b 0

:failed
echo.
pause
exit /b 1
