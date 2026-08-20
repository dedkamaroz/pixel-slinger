@echo off
cd /d "%~dp0"
python -c "import json,os,signal,pathlib;p=pathlib.Path('.server.pid');d=json.loads(p.read_text()) if p.exists() else {};[__import__('subprocess').run(['taskkill','/F','/PID',str(v)],capture_output=True) for v in d.values()];p.unlink(missing_ok=True);print('stopped:',d or 'nothing was running')"
echo.
echo Tunnel closed. uploads/ is no longer reachable from the internet.
echo Files are still on disk - run: del /q uploads\*
echo.
pause
