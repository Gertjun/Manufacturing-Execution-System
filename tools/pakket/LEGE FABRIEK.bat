@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Dit maakt een lege fabriek: alleen stappen, velden, operators en pc's. Geen batches en geen testaccounts.
echo Daarna volgt gecontroleerde MES-bootstrap met drie afzonderlijke beheeridentiteiten.
echo Bij het starten wordt eerst een back-up gemaakt van wat er nu in staat.
choice /M "Doorgaan"
if errorlevel 2 exit /b 0
call START.bat --leeg
