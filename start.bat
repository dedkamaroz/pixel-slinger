@echo off
cd /d "%~dp0"

rem Enhancor.ai is built and working but switched off. Set this to 1 to put its tabs back
rem in the nav - nothing else needs changing, and there is no switch for it in the page.
set ENHANCOR=0

rem open the browser a few seconds in, once the port is actually bound
start "" /b cmd /c "timeout /t 4 /nobreak >nul & start "" http://127.0.0.1:8787"
python server.py
pause
