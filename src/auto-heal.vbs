' Antigravity Korean Patch Auto-Heal Background Launcher
' Runs powershell -Action watch invisibly in background (0 console window)
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
patchPs1 = fso.BuildPath(fso.GetParentFolderName(scriptDir), "patch.ps1")

If WScript.Arguments.Count > 0 Then
    patchPs1 = WScript.Arguments(0)
End If

cmd = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & patchPs1 & """ -Action watch"
WshShell.Run cmd, 0, False
