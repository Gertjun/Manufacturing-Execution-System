@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Dit maakt een lege fabriek: alleen stappen, velden, accounts, operators en pc's, geen batches.
echo Bij het starten wordt eerst een back-up gemaakt van wat er nu in staat.
choice /M "Doorgaan"
if errorlevel 2 exit /b 0
call START.bat --leeg
