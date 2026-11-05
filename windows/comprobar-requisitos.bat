@echo off
rem Cerebro Studio - comprobar requisitos (solo lee informacion; no instala ni cambia nada).
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0diagnostico.ps1"
echo.
pause
