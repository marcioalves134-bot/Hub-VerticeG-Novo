@echo off
rem Abre o novo Hub Vertice G: sobe o servidor local e abre o painel no navegador.
title Hub Vertice G (novo) - NAO FECHE esta janela enquanto usar o sistema
cd /d "%~dp0"
set "URL=http://127.0.0.1:3200"

rem O Hub roda sempre com o Node 22.23.2 (o better-sqlite3 foi compilado para ele), pelo caminho completo,
rem sem depender da ordem do PATH. Sem esse Node, o Hub nao e iniciado com outra versao.
set "NODE22_DIR=%LOCALAPPDATA%\Microsoft\WinGet\Packages\OpenJS.NodeJS.22_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v22.23.2-win-x64"
set "NODE22=%NODE22_DIR%\node.exe"
set "NODE22_VERSAO="
if exist "%NODE22%" for /f "usebackq delims=" %%V in (`"%NODE22%" -v`) do set "NODE22_VERSAO=%%V"
if not "%NODE22_VERSAO%"=="v22.23.2" (
  echo  ERRO: Node.js 22.23.2 nao encontrado em:
  echo  %NODE22%
  echo  O Hub NAO foi iniciado. Ele nao roda com outra versao do Node.
  echo  Reinstale o Node.js 22.23.2 pelo winget ou fale com o responsavel pelo sistema.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo  Primeira execucao: instalando dependencias, aguarde...
  rem So nesta janela: os scripts de instalacao (better-sqlite3) tambem precisam achar o Node 22 primeiro.
  set "PATH=%NODE22_DIR%;%PATH%"
  call "%NODE22_DIR%\npm.cmd" ci
  if errorlevel 1 ( echo  Falha ao instalar as dependencias. & pause & exit /b 1 )
)

powershell -NoProfile -Command "try { Invoke-WebRequest '%URL%/saude' -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 ( start "" "%URL%" & exit /b 0 )

start "" /b powershell -NoProfile -Command "Start-Sleep 2; Start-Process '%URL%'"
"%NODE22%" src\server.js
echo.
echo  O servidor parou. Veja a mensagem acima.
pause
