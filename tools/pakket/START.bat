@echo off
chcp 65001 >nul
title Batch input GUI
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is niet gevonden. Installeer Node.js 26 LTS van https://nodejs.org en start dit bestand opnieuw.
  echo.
  pause
  exit /b 1
)
node opstarten.mjs %*
pause
