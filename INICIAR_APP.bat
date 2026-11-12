@echo off
title View 3DPrint
cd /d "%~dp0"
echo ========================================
echo Iniciando View 3DPrint...
echo ========================================
node electron/launcher.cjs
if %errorlevel% neq 0 (
  echo.
  echo Erro ao iniciar. Pressione qualquer tecla para sair.
  pause
)

