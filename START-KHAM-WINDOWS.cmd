@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title KHAM Ticket Assistant

if not exist ".kham.env" copy /Y ".kham.env.example" ".kham.env" >nul

if exist "runtime\node.exe" (
  set "KHAM_NODE=%CD%\runtime\node.exe"
  goto run_app
)

where node >nul 2>nul
if errorlevel 1 goto missing_node
set "KHAM_NODE=node"

if not exist "node_modules\playwright-core\package.json" (
  echo First run: installing required files...
  where npm >nul 2>nul
  if errorlevel 1 goto missing_node
  call npm install
  if errorlevel 1 goto failed
)

:run_app
echo Starting KHAM Ticket Assistant...
"%KHAM_NODE%" "src\kham-control-server.js"
if errorlevel 1 goto failed
goto done

:missing_node
echo.
echo This source folder needs Node.js 20 or newer.
echo For users, use the portable Windows ZIP; it includes Node.js and requires no installation.
pause
exit /b 1

:failed
echo.
echo Startup failed. Keep this window open and send the error text to the maintainer.
pause
exit /b 1

:done
endlocal
