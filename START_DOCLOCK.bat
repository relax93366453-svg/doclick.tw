@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Doclick Local Server

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] Node.js was not found.
  echo Please install Node.js, then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "config.json" (
  echo.
  echo First setup: paste the JOB_ADMIN_TOKEN from Apps Script.
  echo The token will be saved only in this folder's config.json.
  echo.
  set /p JOB_TOKEN=JOB_ADMIN_TOKEN: 
  if "%JOB_TOKEN%"=="" (
    echo Token cannot be empty.
    pause
    exit /b 1
  )
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$o=[ordered]@{apiUrl='https://script.google.com/macros/s/AKfycbxf5sgRpnMaiU8lWPJ_0_n34jaJgc1-pKUnyjf5d7nvAIP5v0hF_ZRss-NJru5zLnux/exec';token='%JOB_TOKEN%'}; $j=$o|ConvertTo-Json; [IO.File]::WriteAllText((Join-Path (Get-Location) 'config.json'),$j,(New-Object Text.UTF8Encoding($false)))"
  echo Configuration saved.
)

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8765/index.html'"
node server.js

echo.
echo The local server has stopped.
pause
