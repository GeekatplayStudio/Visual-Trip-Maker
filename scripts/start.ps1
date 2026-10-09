# Visual Trip Maker - start the app in the background (Windows PowerShell)
# Usage: .\scripts\start.ps1 [-Port 5173] [-Dev]
#   default  serves the production build from dist\ (builds it first if missing)
#   -Dev     runs the Vite development server with hot reload
param(
    [int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 5173 }),
    [switch]$Dev
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not (Test-Path 'node_modules')) {
    Write-Error 'Dependencies are missing. Run .\scripts\install.ps1 first.'
}

$runDir = '.run'
$pidFile = Join-Path $runDir 'server.pid'
$logFile = Join-Path $runDir 'server.log'
New-Item -ItemType Directory -Force $runDir | Out-Null

if (Test-Path $pidFile) {
    $old = [int](Get-Content $pidFile -ErrorAction SilentlyContinue)
    if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) {
        Write-Host "Already running (PID $old). Run .\scripts\stop.ps1 first."
        exit 0
    }
    Remove-Item $pidFile -Force
}

if (-not $Dev -and -not (Test-Path 'dist\index.html')) {
    Write-Host 'No production build found, building first...'
    & "$PSScriptRoot\build.ps1"
}

$vite = Join-Path (Get-Location) 'node_modules\vite\bin\vite.js'
$mode = if ($Dev) { @() } else { @('preview') }
$viteArgs = @($vite) + $mode + @('--host', '127.0.0.1', '--port', $Port, '--strictPort')

$errFile = Join-Path $runDir 'server.err.log'
$proc = Start-Process -FilePath 'node' -ArgumentList $viteArgs -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $logFile -RedirectStandardError $errFile
Set-Content -Path $pidFile -Value $proc.Id

$url = "http://127.0.0.1:$Port/"
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    if ($proc.HasExited) { break }
    try {
        Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 | Out-Null
        $ready = $true
        break
    } catch { }
}

if (-not $ready) {
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    if (-not $proc.HasExited) { & taskkill /PID $proc.Id /T /F | Out-Null }
    Write-Host (Get-Content $logFile, $errFile -ErrorAction SilentlyContinue | Out-String)
    Write-Error "The server did not start. Is port $Port already in use? Try -Port <other>."
}
Write-Host "Visual Trip Maker is running at $url (PID $($proc.Id))"
Write-Host 'Stop it with .\scripts\stop.ps1'
