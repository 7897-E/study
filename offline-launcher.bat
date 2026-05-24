@echo off
setlocal
chcp 65001 >nul
title AI Chat CLide - Offline Launcher

echo ========================================
echo   AI Chat CLide Offline Launcher
echo ========================================
echo.
echo This starts local AI server only for offline usage.
echo.

set "CHAT_DIR=%~dp0"
if "%CHAT_DIR:~-1%"=="\" set "CHAT_DIR=%CHAT_DIR:~0,-1%"
set "SERVER_DIR=%CHAT_DIR%\OfflineServer"

if not exist "%SERVER_DIR%\server.py" (
  echo [ERROR] Could not find: %SERVER_DIR%\server.py
  pause
  exit /b 1
)

if not exist "%SERVER_DIR%\llama-server.exe" (
  echo [ERROR] Could not find: %SERVER_DIR%\llama-server.exe
  pause
  exit /b 1
)

echo [1/2] Checking if AI Chat CLide is already open...
set "CHAT_INDEX=%CHAT_DIR%\index.html"
set "CHAT_OPEN="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$chatPath = [System.IO.Path]::GetFullPath('%CHAT_INDEX%'); $chatPathFwd = $chatPath -replace '\\','/'; $chatPathEsc = [regex]::Escape($chatPath); $chatPathFwdEsc = [regex]::Escape($chatPathFwd); $patterns = @($chatPathEsc, $chatPathFwdEsc, [regex]::Escape('file:///' + $chatPathFwd)); $isOpen = Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(chrome|msedge|firefox|brave|opera)\.exe$' } | Where-Object { $cl = [string]($_.CommandLine); if (-not $cl) { return $false }; foreach ($pat in $patterns) { if ($cl -match $pat) { return $true } }; return $false } | Select-Object -First 1; if ($isOpen) { 'YES' }"`) do set "CHAT_OPEN=%%P"

if /I "%CHAT_OPEN%"=="YES" (
  echo AI Chat CLide is already open. Skipping browser launch.
) else (
  echo Opening AI Chat CLide...
  start "AI Chat CLide" "%CHAT_INDEX%"
)

echo.
echo Checking internet connectivity...
set "NET_ONLINE="
for /f "usebackq delims=" %%N in (`powershell -NoProfile -Command "if (Test-Connection -ComputerName 1.1.1.1 -Count 1 -Quiet) { 'YES' } else { 'NO' }"`) do set "NET_ONLINE=%%N"

if /I "%NET_ONLINE%"=="YES" (
  echo Internet detected. Skipping offline server startup.
  echo Launcher done.
  endlocal
  exit
)

echo [2/2] Starting local AI server in this same terminal...
echo Close the browser tab/window to trigger shutdown; this terminal will close when server exits.
echo.
cd /d "%SERVER_DIR%"
python server.py
if errorlevel 1 py server.py

echo.
echo Server stopped. Closing terminal...
echo.
endlocal
exit
