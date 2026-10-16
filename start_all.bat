@echo off
title SignConnect AI - Complete Launcher
echo ========================================================
echo        SIGN CONNECT AI - COMPLETE LAUNCHER
echo ========================================================
echo.

set PYTHON_CMD=python
if exist "venv_py311\Scripts\python.exe" set PYTHON_CMD=venv_py311\Scripts\python.exe
if exist "venv\Scripts\python.exe" set PYTHON_CMD=venv\Scripts\python.exe

echo [1/2] Starting SignConnect AI Server with %PYTHON_CMD%...
start "SignConnect Server" cmd /k "%PYTHON_CMD% communication_server.py"

echo.
echo [2/2] Waiting 6 seconds for models to load...
timeout /t 6 /nobreak >nul

echo.
echo Starting Cloudflare Tunnel for public sharing...
start "Cloudflare Tunnel" cmd /k "cloudflared.exe tunnel --url http://127.0.0.1:5000"

echo.
echo ========================================================
echo READY!
echo Look at the 'Cloudflare Tunnel' window for your link.
echo It will display: https://xxxx.trycloudflare.com
echo.
echo Open that link and join or share with any device:
echo   https://xxxx.trycloudflare.com/test-ui?room=myroom
echo ========================================================
pause
