' Roda ferramentas\backup.cmd sem abrir janela e devolve o codigo de saida ao Agendador de Tarefas.
Set fso = CreateObject("Scripting.FileSystemObject")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
codigo = CreateObject("WScript.Shell").Run("""" & pasta & "\backup.cmd""", 0, True)
WScript.Quit codigo
