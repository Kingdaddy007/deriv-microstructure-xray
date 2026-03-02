@echo off
title Touch Edge System Server
color 0B

echo ===================================================
echo     MICRO-STRUCTURE X-RAY DASHBOARD SERVER
echo ===================================================
echo.
echo The server is starting. Please wait a moment...
echo.
echo IMPORTANT INSTRUCTIONS:
echo 1. Keep this black window open while you trade.
echo 2. Go to http://127.0.0.1:8080 in your browser.
echo 3. If the dashboard freezes or you wake up the laptop from sleep:
echo    - Close this black window (click the X).
echo    - Double-click this script again to restart instantly.
echo.
echo Starting Node.js backend...
echo ---------------------------------------------------

node server/index.js

echo.
echo [SERVER STOPPED] 
echo Press any key to close this window.
pause > nul
