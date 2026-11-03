@echo off
rem Abre o novo Hub Vertice G: sobe o servidor local e abre o painel no navegador.
title Hub Vertice G (novo) - NAO FECHE esta janela enquanto usar o sistema
cd /d "%~dp0"
set "URL=http://127.0.0.1:3200"

where node >nul 2>nul
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
  for /d %%P in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\OpenJS.NodeJS*") do (
    for /d %%N in ("%%P\node-*") do if exist "%%N\node.exe" set "PATH=%%N;%PATH%"
  )
)
where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js nao foi encontrado. Instale o Node.js 22 LTS em https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo  Primeira execucao: instalando dependencias, aguarde...
  call npm ci
  if errorlevel 1 ( echo  Falha ao instalar as dependencias. & pause & exit /b 1 )
)

powershell -NoProfile -Command "try { Invoke-WebRequest '%URL%/saude' -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 ( start "" "%URL%" & exit /b 0 )

start "" /b powershell -NoProfile -Command "Start-Sleep 2; Start-Process '%URL%'"
node src\server.js
echo.
echo  O servidor parou. Veja a mensagem acima.
pause
