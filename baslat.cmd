@echo off
chcp 65001 >nul
echo Satis Akademisi test sunucusu baslatiliyor...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
echo.
echo Sunucu durdu. Hata mesaji varsa yukarida gorunur.
pause
