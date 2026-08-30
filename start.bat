@echo off
cd /d "%~dp0"

rem Enhancor.ai is built and working but switched off. Set this to 1 to put its tabs back
rem in the nav - nothing else needs changing, and there is no switch for it in the page.
set ENHANCOR=0

rem setup.bat drops cloudflared.exe next to this file rather than installing it, so look
rem here first; an installed copy on PATH still wins if there is no local one.
set "PATH=%~dp0;%PATH%"

if not exist .env (
  echo No .env found - run setup.bat first.
  pause & exit /b 1
)

set PY=
py -3 --version >nul 2>&1 && set "PY=py -3"
if not defined PY (python --version >nul 2>&1 && set "PY=python")
if not defined PY (
  echo Python not found - run setup.bat first.
  pause & exit /b 1
)

rem open the browser a few seconds in, once the port is actually bound
start "" /b cmd /c "timeout /t 4 /nobreak >nul & start "" http://127.0.0.1:8787"
%PY% server.py
pause
