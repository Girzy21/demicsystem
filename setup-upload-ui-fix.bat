@echo off
REM ============================================================
REM  1. Removes the "Jenis modul" toggle from the top of the
REM     upload form. File upload is now the default; a small
REM     "+ Tambah link" link near the submit button switches to
REM     link mode instead.
REM  2. Makes the upload submit logic defensive against any
REM     draft field being undefined/null, fixing a ".trim() of
REM     undefined" crash when clicking upload after attaching a
REM     file.
REM  Run this from your project ROOT folder (same level as
REM  package.json).
REM ============================================================

setlocal
set SCRIPT_DIR=%~dp0

if not exist "%SCRIPT_DIR%setup-upload-ui-fix.ps1" (
    echo ERROR: setup-upload-ui-fix.ps1 not found next to this .bat file.
    pause
    exit /b 1
)

if not exist "package.json" (
    echo WARNING: No package.json found in the current folder.
    echo This script should be run from your Next.js project ROOT.
    echo.
    set /p CONTINUE="Continue anyway? (y/n): "
    if /i not "%CONTINUE%"=="y" (
        echo Cancelled.
        pause
        exit /b 1
    )
)

echo This will OVERWRITE src\app\components\Homepage.jsx
set /p CONTINUE2="Continue? (y/n): "
if /i not "%CONTINUE2%"=="y" (
    echo Cancelled.
    pause
    exit /b 1
)

echo Running setup...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%setup-upload-ui-fix.ps1"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Something went wrong. Scroll up to see the error above.
    pause
    exit /b 1
)

echo.
pause
