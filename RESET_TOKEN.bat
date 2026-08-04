@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "config.json" del /q "config.json"
echo Token setting was cleared.
echo Run START_DOCLOCK_NO_NODE.bat to enter the current token again.
pause
