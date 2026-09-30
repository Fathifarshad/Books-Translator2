@echo off
rem Dozabaneh - double-click to start. Details: README.fa.md
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install it with:  winget install OpenJS.NodeJS.LTS   or from https://nodejs.org
  echo Then double-click start.cmd again.
  pause
  exit /b 1
)
node scripts\start.mjs %*
pause
