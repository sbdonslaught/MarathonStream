@echo off
title MarathonStream - Build Electron EXE
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is not installed or not in PATH.
    echo Download it from https://nodejs.org and try again.
    echo.
    pause
    exit /b 1
)

rem close the app if it's running, otherwise the build can't overwrite the exe
tasklist /fi "imagename eq MarathonStream.exe" 2>nul | find /i "MarathonStream.exe" >nul
if not errorlevel 1 (
    echo MarathonStream is currently running - close it and run this again.
    echo.
    pause
    exit /b 1
)

if not exist node_modules (
    echo First run: installing Electron ^(this downloads ~100 MB, one time only^)...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo npm install FAILED. See the messages above.
        echo.
        pause
        exit /b 1
    )
)

echo Building the Electron app...
echo.
call npm run dist
if errorlevel 1 (
    echo.
    echo Build FAILED. See the messages above.
) else (
    echo.
    echo Build complete! Files in %~dp0dist :
    echo   - MarathonStream Setup 1.0.0.exe  ^(installer - give THIS to friends^)
    echo   - MarathonStream 1.0.0.exe        ^(portable - runs without installing^)
)
echo.
pause
