# Cria a tarefa agendada do backup do Hub para o usuario atual:
# todo dia as 12:30 e as 19:00 e ao fazer logon (10 min depois); so com o usuario conectado, sem guardar senha.
# Nao substitui tarefa existente: se ja houver uma com o mesmo nome, para e avisa.
# (Sem acentos: o PowerShell 5.1 le .ps1 sem BOM na codificacao antiga do Windows.)
$ErrorActionPreference = 'Stop'
$nome = 'Hub Vertice G - Backup'
$vbs = Join-Path $PSScriptRoot 'backup-oculto.vbs'

if (Get-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue) {
    Write-Output "Ja existe a tarefa '$nome'. Nada foi alterado."
    exit 1
}

$usuario = "$env:USERDOMAIN\$env:USERNAME"
$acao = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\wscript.exe" -Argument "`"$vbs`""

# Horarios a partir de amanha: evita uma execucao extra logo na criacao por "horario perdido".
$amanha = (Get-Date).Date.AddDays(1)
$gatilhos = @(
    (New-ScheduledTaskTrigger -Daily -At $amanha.AddHours(12).AddMinutes(30)),
    (New-ScheduledTaskTrigger -Daily -At $amanha.AddHours(19)),
    (New-ScheduledTaskTrigger -AtLogOn -User $usuario)
)
$gatilhos[2].Delay = 'PT10M'

# Interactive = so quando o usuario estiver conectado; nenhuma senha e guardada.
$principal = New-ScheduledTaskPrincipal -UserId $usuario -LogonType Interactive -RunLevel Limited
$config = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -Priority 7

Register-ScheduledTask -TaskName $nome -Description 'Backup do banco do Hub Vertice G para o servidor (registro em data\logs\backup.log).' `
    -Action $acao -Trigger $gatilhos -Principal $principal -Settings $config | Out-Null
Write-Output "Tarefa '$nome' criada."
