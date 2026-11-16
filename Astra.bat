@echo off
chcp 65001 >nul
title Astra
cd /d "%~dp0"

REM --- 1. проверяем node ---
where node >nul 2>nul
if errorlevel 1 (
  echo Не найден Node.js. Установите его с https://nodejs.org и запустите снова.
  pause
  exit /b 1
)

REM --- 2. если зависимости не стоят — ставим ---
if not exist "node_modules\express" (
  echo Первый запуск: устанавливаю зависимости...
  call npm install --no-audit --no-fund
)

REM --- 3. поднимаем бэкенд в фоне ---
start "" /min cmd /c "node server.js"

REM --- 4. ждём порт ---
timeout /t 2 /nobreak >nul

REM --- 5. запускаем приложение ---
if exist "data\app-build\Astra.exe" (
  start "" "data\app-build\Astra.exe"
) else (
  echo Собираю приложение...
  node -e "require('./app-native').build()"
  start "" "data\app-build\Astra.exe"
)
exit /b 0
