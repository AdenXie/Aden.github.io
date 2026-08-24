@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo   The Aden Family - Submit and Publish
echo ========================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Git was not found. Install Git for Windows first.
  goto :failed
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js/npm was not found. The build cannot be checked.
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

echo Local changes to process:
git status --short
echo.
choice /C YN /N /M "Continue with submit and publish? [Y/N] "
if errorlevel 2 (
  echo Cancelled. Git history and the live site were not changed.
  goto :cancelled
)

git add -A
git diff --cached --quiet
if errorlevel 1 (
  set "COMMIT_MSG="
  set /p "COMMIT_MSG=Commit message (Enter for post: update blog): "
  if not defined COMMIT_MSG set "COMMIT_MSG=post: update blog"

  git commit -m "%COMMIT_MSG%"
  if errorlevel 1 (
    echo [ERROR] Could not create the local commit.
    goto :failed
  )
) else (
  echo No uncommitted files. Existing local commits will still be synced and checked.
)

echo.
echo Merging posts created by the cloud automation...
git pull --rebase origin source
if errorlevel 1 (
  git rebase --abort >nul 2>&1
  echo.
  echo [ERROR] Local and online changes conflict. Automatic merge was stopped.
  echo Your local commit is preserved and nothing was pushed.
  goto :failed
)

echo.
echo Running the Hexo build check...
call npm run clean
if errorlevel 1 goto :build_failed

call npm run build
if errorlevel 1 goto :build_failed

echo.
echo Pushing the source branch...
git push origin source
if errorlevel 1 (
  echo.
  echo [ERROR] Push failed. Your local commit is preserved; run this file again after fixing access.
  goto :failed
)

echo.
echo [DONE] The source branch was pushed successfully.
echo GitHub Actions will build main and update GitHub Pages and Vercel.
git status -sb
echo.
pause
exit /b 0

:build_failed
echo.
echo [ERROR] The Hexo build failed, so nothing was pushed.
echo Your local commit is preserved. Fix the error and run this file again.
goto :failed

:cancelled
echo.
pause
exit /b 0

:failed
echo.
pause
exit /b 1
