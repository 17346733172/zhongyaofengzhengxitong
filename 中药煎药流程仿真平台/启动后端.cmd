powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -Port 8001@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
pause
