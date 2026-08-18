@echo off
setlocal

set IMAGE_NAME=playwright-windows-example
set CACHE_DIR=C:\work\Automated browsers\Containers\browser-cache

echo [1/2] Building Docker image: %IMAGE_NAME%
docker build -t %IMAGE_NAME% .
if %ERRORLEVEL% neq 0 (
    echo Build failed. Make sure Docker Desktop is in Windows Containers mode.
    exit /b 1
)

if not exist "%CACHE_DIR%" mkdir "%CACHE_DIR%"

echo.
echo [2/2] Running container (browser cache: %CACHE_DIR%)...
docker run --rm -v "%CACHE_DIR%:C:\browsers" %IMAGE_NAME%
