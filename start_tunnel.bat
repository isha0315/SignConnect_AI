@echo off
title Cloudflare Tunnel - SignConnect AI
echo ========================================================
echo       STARTING CLOUDFLARE PUBLIC TUNNEL
echo ========================================================
echo.
echo Checking connection to local server (http://127.0.0.1:5000)...
echo.
echo Connecting to Cloudflare network...
echo Your public link (https://xxxx.trycloudflare.com) will appear below!
echo.
cloudflared.exe tunnel --url http://127.0.0.1:5000
pause
