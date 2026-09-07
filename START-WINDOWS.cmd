@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Ticket Plus Assistant

if not exist ".env" copy /Y ".env.example" ".env" >nul

if exist "runtime\node.exe" (
  set "TICKET_NODE=%CD%\runtime\node.exe"
  goto run_app
)

where node >nul 2>nul
if errorlevel 1 goto missing_node
set "TICKET_NODE=node"

if not exist "node_modules\playwright-core\package.json" (
  echo First run: installing required files...
  where npm >nul 2>nul
  if errorlevel 1 goto missing_node
  call npm install
  if errorlevel 1 goto failed
)

:run_app
echo Starting Ticket Plus Assistant...
"%TICKET_NODE%" "src\control-server.js"
if errorlevel 1 goto failed
goto done

:missing_node
echo.
echo This source folder needs Node.js 20 or newer.
echo For users, please use the portable Windows ZIP; it includes Node.js and requires no installation.
echo Download Node.js only if you intentionally use the source folder:
echo https://nodejs.org/
pause
exit /b 1

:failed
echo.
echo Startup failed. Keep this window open and send the error text to the maintainer.
pause
exit /b 1

:done
endlocal
