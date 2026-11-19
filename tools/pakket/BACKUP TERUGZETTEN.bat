@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Kies hierna welke back-up je wilt terugzetten. De huidige database blijft bewaard in de map data.
call START.bat --herstel
