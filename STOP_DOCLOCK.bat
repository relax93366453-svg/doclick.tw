@echo off
chcp 65001 >nul
title Stop Doclick Local Server

echo Closing any process using port 8765...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
"$pids = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if ($pids) { foreach ($pidValue in $pids) { try { Stop-Process -Id $pidValue -Force -ErrorAction Stop; Write-Host ('Stopped process ' + $pidValue) -ForegroundColor Green } catch { Write-Host $_.Exception.Message -ForegroundColor Red } } } else { Write-Host 'No server is currently using port 8765.' -ForegroundColor Yellow }"

echo.
echo Done. You can now run START_DOCLOCK_FIXED.bat.
pause
