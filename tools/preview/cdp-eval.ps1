# Evalúa una expresión JavaScript dentro del WebView real de SuperUpdater.
#
# El harness (tools/preview/harness.html) sirve para comprobar la interfaz con
# datos simulados, pero hay estados que sólo existen en la app real (datos de
# winget, fuentes locales, ventana nativa). Para inspeccionarlos se abre el
# puerto de depuración de WebView2 y se habla CDP (Chrome DevTools Protocol)
# con un cliente WebSocket sin cabecera `Origin` (el endpoint de DevTools
# rechaza los navegadores que envían una distinta).
#
#   powershell -ExecutionPolicy Bypass -File tools/preview/cdp-eval.ps1 `
#       -File tools/preview/probe.js
#
# Antes hay que lanzar la app con el puerto de depuración activo:
#
#   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
#   ./src-tauri/target/debug/superupdaterapp.exe
param(
  [string]$Expression = "",
  [string]$File = "",
  [int]$Port = 9222,
  [string]$Match = "tauri.localhost",
  [int]$TimeoutSeconds = 20
)

$ErrorActionPreference = "Stop"

if ($File) {
  $Expression = Get-Content -LiteralPath $File -Raw
}
if (-not $Expression.Trim()) {
  Write-Host "Falta la expresión: usa -Expression o -File."
  exit 1
}

$targets = Invoke-RestMethod "http://127.0.0.1:$Port/json"
$target = $targets |
  Where-Object { $_.type -eq "page" -and $_.url -like "*$Match*" } |
  Select-Object -First 1
if (-not $target) {
  Write-Host "No se encontró ninguna pestaña que coincida con '$Match'."
  Write-Host ($targets | ForEach-Object { $_.url } | Out-String)
  exit 1
}

$ws = New-Object System.Net.WebSockets.ClientWebSocket
$cts = New-Object System.Threading.CancellationTokenSource
$cts.CancelAfter([TimeSpan]::FromSeconds($TimeoutSeconds))

$ws.ConnectAsync([Uri]$target.webSocketDebuggerUrl, $cts.Token).GetAwaiter().GetResult()

$payload = @{
  id      = 1
  method  = "Runtime.evaluate"
  params = @{
    expression    = $Expression
    returnByValue = $true
    awaitPromise  = $true
  }
} | ConvertTo-Json -Depth 8 -Compress

$bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
$segment = New-Object "System.ArraySegment[byte]" -ArgumentList (,$bytes)
$ws.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).GetAwaiter().GetResult()

$buffer = New-Object byte[] 65536
$memory = New-Object System.IO.MemoryStream
do {
  $chunk = New-Object "System.ArraySegment[byte]" -ArgumentList (,$buffer)
  $result = $ws.ReceiveAsync($chunk, $cts.Token).GetAwaiter().GetResult()
  $memory.Write($buffer, 0, $result.Count)
} while (-not $result.EndOfMessage)

$text = [System.Text.Encoding]::UTF8.GetString($memory.ToArray())
$memory.Dispose()
$ws.Dispose()

# Se imprime el valor evaluado (no el sobre CDP) para poder leerlo de un vistazo.
$response = $text | ConvertFrom-Json
if ($response.result -and $response.result.result -and $null -ne $response.result.result.value) {
  Write-Host $response.result.result.value
} elseif ($response.result -and $response.result.exceptionDetails) {
  Write-Host "EXCEPCION: $($response.result.exceptionDetails.text)"
  $response.result.exceptionDetails | ConvertTo-Json -Depth 6 | Write-Host
} else {
  Write-Host $text
}
