@echo off
setlocal
cd /d "%~dp0"
title GYEOL - Demo Server
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js LTS and run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm.cmd install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo.
echo Open http://localhost:5173 in your browser.
echo Keep this window open while using the demo.
echo If port 5173 is already in use, the demo may already be running.
echo.
call npm.cmd run dev -- --port 5173 --strictPort
pause
