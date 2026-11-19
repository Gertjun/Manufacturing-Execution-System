@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Dit maakt de database leeg en laadt verse fictieve testdata (90 dagen).
echo Bij het starten wordt eerst een back-up gemaakt van wat er nu in staat.
choice /M "Doorgaan"
if errorlevel 2 exit /b 0
call START.bat --opnieuw
