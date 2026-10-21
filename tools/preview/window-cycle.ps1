# Cicla la ventana de SuperUpdater: minimizar -> restaurar (y opcionalmente
# cambiar el tamaño) para reproducir lo que ocurre al volver a la app desde la
# barra de tareas. Se usa junto con tools/preview/cdp-eval.ps1 para comprobar
# que el contenido vuelve arriba y no se queda a media lista.
#
#   powershell -ExecutionPolicy Bypass -File tools/preview/window-cycle.ps1
param(
  [string]$Title = "SuperUpdater",
  [int]$MinimizeDelayMs = 1500,
  [int]$RestoreDelayMs = 1500,
  [int]$ResizeWidth = 0,
  [int]$ResizeHeight = 0
)

$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WC {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool repaint);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$p = Get-Process | Where-Object { $_.MainWindowTitle -like "*$Title*" } | Select-Object -First 1
if (-not $p) {
  Write-Host "Ventana '$Title' no encontrada."
  exit 1
}
$h = $p.MainWindowHandle

[WC]::ShowWindow($h, 6) | Out-Null   # SW_MINIMIZE
Start-Sleep -Milliseconds $MinimizeDelayMs
[WC]::ShowWindow($h, 9) | Out-Null   # SW_RESTORE
[WC]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds $RestoreDelayMs

if ($ResizeWidth -gt 0 -and $ResizeHeight -gt 0) {
  $r = New-Object WC+RECT
  [WC]::GetWindowRect($h, [ref]$r) | Out-Null
  [WC]::MoveWindow($h, $r.Left, $r.Top, $ResizeWidth, $ResizeHeight, $true) | Out-Null
  Start-Sleep -Milliseconds 800
}

Write-Host "Ciclo minimize/restore completado."
