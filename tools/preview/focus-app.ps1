# Trae la ventana de SuperUpdater al frente para poder capturarla.
#
#   powershell -ExecutionPolicy Bypass -File tools/preview/focus-app.ps1
param(
  [string]$Title = "SuperUpdater"
)

$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
"@

$procs = Get-Process | Where-Object { $_.MainWindowTitle -like "*$Title*" }
if (-not $procs) {
  Write-Host "No se encontró ninguna ventana con el título '$Title'."
  Get-Process | Where-Object { $_.MainWindowTitle } |
    Select-Object Id, ProcessName, MainWindowTitle | Format-Table -AutoSize | Out-String | Write-Host
  exit 1
}

foreach ($p in $procs) {
  Write-Host "Proceso $($p.Id) ($($p.ProcessName)) -> '$($p.MainWindowTitle)'"
  if ([Win]::IsIconic($p.MainWindowHandle)) { [Win]::ShowWindow($p.MainWindowHandle, 9) | Out-Null }
  [Win]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
}
Start-Sleep -Milliseconds 800
Write-Host "Ventana enfocada."
