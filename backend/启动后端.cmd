@echo off
cd /d "%~dp0"
rem Manual dependency repair from this directory:
rem .venv\Scripts\python.exe -m pip install --index-url https://pypi.org/simple -r requirements-lock.txt
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
pause
