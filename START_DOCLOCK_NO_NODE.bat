@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Doclick Local System - No Node
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
