# Servidor estático mínimo para revisar la interfaz en un navegador.
#
# El proyecto no tiene Node ni Python disponibles, así que se usa PowerShell
# (siempre presente en Windows). Sirve la raíz del proyecto para poder cargar
# /src/index.html con el mock de Tauri en /tools/preview/mock-tauri.js.
#
#   powershell -ExecutionPolicy Bypass -File tools/preview/serve.ps1
#
param(
  [int]$Port = 8731,
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

$ErrorActionPreference = 'Stop'

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.svg'  = 'image/svg+xml'
  '.woff2'= 'font/woff2'
  '.woff' = 'font/woff'
  '.ico'  = 'image/x-icon'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Sirviendo $Root en http://localhost:$Port/  (Ctrl+C para parar)"

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $path = $context.Request.Url.AbsolutePath
    if ($path -eq '/' -or $path -eq '') { $path = '/tools/preview/harness.html' }

    $relative = $path.TrimStart('/') -replace '/', '\'
    $file = Join-Path $Root $relative

    if ((Test-Path -LiteralPath $file -PathType Leaf) -and
        $file.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $ext = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
      $context.Response.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $context.Response.ContentLength64 = $bytes.Length
      $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $context.Response.StatusCode = 404
      $body = [System.Text.Encoding]::UTF8.GetBytes('404')
      $context.Response.ContentLength64 = $body.Length
      $context.Response.OutputStream.Write($body, 0, $body.Length)
    }
    $context.Response.Close()
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
