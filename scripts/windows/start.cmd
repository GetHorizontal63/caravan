@echo off
rem Run Caravan in the foreground (Ctrl+C to stop). Data goes to .\data by default.
cd /d "%~dp0\..\..\server"
if "%CARAVAN_PORT%"=="" set CARAVAN_PORT=8420
node src\index.ts
