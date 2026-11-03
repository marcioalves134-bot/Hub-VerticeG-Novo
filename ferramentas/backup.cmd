@echo off
rem Backup do banco do Hub para o servidor (chamado pela tarefa agendada via backup-oculto.vbs).
rem O resultado fica em data\logs\backup.log; o codigo de saida vai para o Agendador (0 = ok).
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
  for /d %%P in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\OpenJS.NodeJS*") do (
    for /d %%N in ("%%P\node-*") do if exist "%%N\node.exe" set "PATH=%%N;%PATH%"
  )
)

node src\cli\backup.js
exit /b %errorlevel%
