@echo off
cd /d "%~dp0"
rem open the browser a few seconds in, once the port is actually bound
start "" /b cmd /c "timeout /t 4 /nobreak >nul & start "" http://127.0.0.1:8787"
python server.py
pause
