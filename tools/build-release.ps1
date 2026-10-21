# Genera los dos artefactos distribuibles en dist/:
#
#   SuperUpdater_<version>_x64-setup.exe   instalador NSIS (por usuario, sin admin)
#   SuperUpdater_<version>_portable.exe    ejecutable autónomo, no instala nada
#
#   powershell -ExecutionPolicy Bypass -File tools/build-release.ps1
#
# La versión se toma de src-tauri/tauri.conf.json, que es la única fuente de
# verdad y la que el instalador escribe en el registro.
param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tauriDir = Join-Path $root 'src-tauri'
$dist = Join-Path $root 'dist'

if (-not $SkipBuild) {
  Push-Location $root
  try {
    & cargo tauri build
    if ($LASTEXITCODE -ne 0) { throw "cargo tauri build falló con código $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
}

$version = (Get-Content (Join-Path $tauriDir 'tauri.conf.json') -Raw | ConvertFrom-Json).version
$installer = Join-Path $tauriDir "target\release\bundle\nsis\SuperUpdater_${version}_x64-setup.exe"
$portable = Join-Path $tauriDir 'target\release\superupdaterapp.exe'

foreach ($file in @($installer, $portable)) {
  if (-not (Test-Path -LiteralPath $file)) { throw "No se generó: $file" }
}

New-Item -ItemType Directory -Force -Path $dist | Out-Null
$installerOut = Join-Path $dist "SuperUpdater_${version}_x64-setup.exe"
$portableOut = Join-Path $dist "SuperUpdater_${version}_portable.exe"
Copy-Item -LiteralPath $installer -Destination $installerOut -Force
Copy-Item -LiteralPath $portable -Destination $portableOut -Force

foreach ($file in @($installerOut, $portableOut)) {
  $info = Get-Item -LiteralPath $file
  $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Host ("{0,-40} {1,8:N2} MiB  sha256 {2}" -f $info.Name, ($info.Length / 1MB), $hash)
}
