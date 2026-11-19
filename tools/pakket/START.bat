@echo off
chcp 65001 >nul
title Batch input GUI
cd /d "%~dp0"
set "NODE=node"
if exist "runtime\node.exe" set "NODE=runtime\node.exe"
if not "%NODE%"=="node" goto start
where node >nul 2>nul
if not errorlevel 1 goto start
echo.
echo Node.js ontbreekt. Pak het pakket opnieuw uit, of installeer Node.js 26 LTS van https://nodejs.org.
echo.
pause
exit /b 1
:start
"%NODE%" opstarten.mjs %*
echo.
pause
