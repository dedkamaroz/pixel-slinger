@echo off
cd /d "%~dp0"
title Pixel Slinger - setup
echo.
echo   Pixel Slinger setup - this only has to be run once.
echo.

rem --- 1. Python -----------------------------------------------------------------
set PY=
py -3 --version >nul 2>&1 && set "PY=py -3"
if not defined PY (python --version >nul 2>&1 && set "PY=python")
if not defined PY (
  echo   [ ] Python is not installed. Installing it now...
  winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo.
    echo   Automatic install failed. Get Python from https://www.python.org/downloads/
    echo   and TICK "Add python.exe to PATH" on the first screen. Then run setup.bat again.
    start "" https://www.python.org/downloads/
    pause & exit /b 1
  )
  echo.
  echo   Python installed. Close this window and run setup.bat again so Windows
  echo   picks it up.
  pause & exit /b 0
)
%PY% -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" || (
  echo   [ ] Your Python is older than 3.10. Update it at https://www.python.org/downloads/
  pause & exit /b 1
)
echo   [x] Python

rem --- 2. cloudflared ------------------------------------------------------------
rem Providers download your dropped files over a tunnel, so this is not optional.
rem Dropped next to start.bat rather than installed - nothing to uninstall later.
if exist cloudflared.exe goto :haveCF
where cloudflared >nul 2>&1 && goto :haveCF
echo   [ ] Downloading cloudflared (about 20 MB)...
curl -L --fail -o cloudflared.exe https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
if errorlevel 1 (
  del /q cloudflared.exe 2>nul
  echo   Download failed - check the internet connection and run setup.bat again.
  pause & exit /b 1
)
:haveCF
echo   [x] cloudflared

rem --- 3. keys --------------------------------------------------------------------
if not exist .env copy /y .env.example .env >nul
findstr /r /c:"^KLINGAI_API_KEY=." /c:"^FAL_KEY=." /c:"^BYTEPLUS_API_KEY=." /c:"^QWENCLOUD_API_KEY=." .env >nul 2>&1 && goto :haveKeys
echo   [ ] No API keys yet. Notepad is opening .env now - paste your keys after
echo       the = signs, one per line, then save and close it.
echo.
echo       You need at least one of: KLINGAI_API_KEY, FAL_KEY, BYTEPLUS_API_KEY, QWENCLOUD_API_KEY.
echo       Tabs for a provider with no key just refuse to run; the others work.
echo.
pause
notepad .env
findstr /r /c:"^KLINGAI_API_KEY=." /c:"^FAL_KEY=." /c:"^BYTEPLUS_API_KEY=." /c:"^QWENCLOUD_API_KEY=." .env >nul 2>&1 || (
  echo.
  echo   Still no keys in .env - nothing will run until there is at least one.
  echo   Run setup.bat again when you have them.
  pause & exit /b 1
)
:haveKeys
echo   [x] .env
echo.
echo   Done. Double-click start.bat to run it.
echo.
pause
