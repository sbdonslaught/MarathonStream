@echo off
title MarathonStream - Build EXE
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is not installed or not in PATH.
    echo Download it from https://nodejs.org and try again.
    echo.
    pause
    exit /b 1
)

echo Building MarathonStream.exe ...
echo.
call npm run build
if errorlevel 1 (
    echo.
    echo Build FAILED. See the messages above.
) else (
    echo.
    echo Build complete: %~dp0dist\MarathonStream.exe
)
echo.
pause
