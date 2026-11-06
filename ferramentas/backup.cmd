@echo off
rem Backup do banco do Hub para o servidor (chamado pela tarefa agendada via backup-oculto.vbs).
rem O resultado fica em data\logs\backup.log; o codigo de saida vai para o Agendador (0 = ok).
cd /d "%~dp0.."

rem Sempre o Node 22.23.2 (o better-sqlite3 foi compilado para ele), pelo caminho completo, sem depender do PATH.
rem Sem esse Node, o backup nao roda com outra versao e o Agendador recebe o codigo 1.
set "NODE22=%LOCALAPPDATA%\Microsoft\WinGet\Packages\OpenJS.NodeJS.22_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v22.23.2-win-x64\node.exe"
set "NODE22_VERSAO="
if exist "%NODE22%" for /f "usebackq delims=" %%V in (`"%NODE22%" -v`) do set "NODE22_VERSAO=%%V"
if not "%NODE22_VERSAO%"=="v22.23.2" (
  echo ERRO: Node.js 22.23.2 nao encontrado em %NODE22%. Backup NAO executado. 1>&2
  exit /b 1
)

"%NODE22%" src\cli\backup.js
exit /b %errorlevel%
