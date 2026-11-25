@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Hersteldiagnose: geen directe wachtwoordreset.
echo Bij een lege identiteitsadministratie volgt gecontroleerde MES-bootstrap.
call START.bat --beheerder
