@echo off
rem Starts eAPMCounter without npm. A double-click is enough.
cd /d "%~dp0"
node --import tsx src/main.ts
pause
