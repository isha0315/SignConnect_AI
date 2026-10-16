@echo off
title SignConnect AI - Server Launcher
echo ========================================================
echo             SIGN CONNECT AI SERVER
echo ========================================================
echo.

set PYTHON_CMD=python
if exist "venv_py311\Scripts\python.exe" set PYTHON_CMD=venv_py311\Scripts\python.exe
if exist "venv\Scripts\python.exe" set PYTHON_CMD=venv\Scripts\python.exe

echo Starting SignConnect AI Server with %PYTHON_CMD%...
%PYTHON_CMD% communication_server.py
pause
