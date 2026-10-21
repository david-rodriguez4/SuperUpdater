# Mide cuánto tarda la app en estar usable tras abrirla.
#
# La queja original era "se traba mucho y no responde" al abrir. Este script
# mide de forma objetiva dos cosas:
#   1. Tiempo desde el arranque del proceso hasta que la lista se dibuja.
#   2. Que el WebView sigue respondiendo mientras winget consulta (la interfaz
#      no se congela aunque la consulta tarde).
#
#   powershell -ExecutionPolicy Bypass -File tools/preview/measure-startup.ps1
param(
  [string]$Exe = "src-tauri\target\debug\superupdaterapp.exe",
  [int]$Port = 9222,
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$exePath = Join-Path $root $Exe
if (-not (Test-Path $exePath)) { throw "No existe el ejecutable: $exePath" }

# 1. Por debajo de 1 ms es indistinguible; basta con el reloj del sistema.
$sw = [System.Diagnostics.Stopwatch]::StartNew()

$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port"
$proc = Start-Process -FilePath $exePath -PassThru -WorkingDirectory $root

# 2. Espera a que exista la pestaña del WebView.
$target = $null
while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
  try {
    $targets = Invoke-RestMethod "http://127.0.0.1:$Port/json" -ErrorAction Stop
    $target = $targets | Where-Object { $_.type -eq "page" -and $_.url -like "*tauri*" } | Select-Object -First 1
    if ($target) { break }
  } catch {
    # El puerto aún no escucha.
  }
  Start-Sleep -Milliseconds 100
}
if (-not $target) {
  Write-Host "El WebView no apareció en $TimeoutSeconds s."
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  exit 1
}
$webviewMs = [int]$sw.ElapsedMilliseconds

# 3. Consulta dentro de la página: espera a que se dibuje la primera fila y
#    comprueba que el hilo de la interfaz responde durante la espera.
$ws = New-Object System.Net.WebSockets.ClientWebSocket
$cts = New-Object System.Threading.CancellationTokenSource
$cts.CancelAfter([TimeSpan]::FromSeconds($TimeoutSeconds))
$ws.ConnectAsync([Uri]$target.webSocketDebuggerUrl, $cts.Token).GetAwaiter().GetResult() | Out-Null

$expression = @"
(async () => {
  const t0 = performance.now();
  let polls = 0;
  let responded = false;
  while (performance.now() - t0 < $TimeoutSeconds * 1000) {
    polls++;
    // Cada vuelta demuestra que el hilo de la interfaz sigue vivo.
    const sub = document.getElementById('subtitle').textContent;
    if (!responded) responded = true;
    const rows = document.querySelectorAll('.app-row').length;
    if (rows > 0) {
      return JSON.stringify({
        inPageMs: Math.round(performance.now() - t0),
        polls: polls,
        uiAliveDuringLoad: responded,
        rows: rows,
        subtitle: sub,
        titleVisible: document.getElementById('updates-title').getBoundingClientRect().top >= 0
      });
    }
    await new Promise(r => setTimeout(r, 50));
  }
  return JSON.stringify({ timeout: true, polls: polls, subtitle: document.getElementById('subtitle').textContent });
})()
"@

$payload = @{
  id      = 1
  method  = "Runtime.evaluate"
  params = @{ expression = $expression; returnByValue = $true; awaitPromise = $true }
} | ConvertTo-Json -Depth 8 -Compress

$bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
$segment = New-Object "System.ArraySegment[byte]" -ArgumentList (,$bytes)
$ws.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).GetAwaiter().GetResult() | Out-Null

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

$sw.Stop()
$response = $text | ConvertFrom-Json
Write-Host "Proceso -> WebView visible : $webviewMs ms"
Write-Host "Proceso -> lista dibujada  : $($sw.ElapsedMilliseconds) ms"
Write-Host "Detalle: $($response.result.result.value)"

Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
