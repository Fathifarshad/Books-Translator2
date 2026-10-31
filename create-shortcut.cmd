@echo off
rem Dozabaneh - double-click once to put a shortcut on the desktop.
cd /d "%~dp0"
node scripts\create-shortcut.mjs
pause
