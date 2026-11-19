@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Noodsleutel: geef een beheerder een nieuw wachtwoord, of maak een nieuwe beheerder aan.
echo Dit kan alleen op deze computer en komt in het logboek.
call START.bat --beheerder
