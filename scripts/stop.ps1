# Visual Trip Maker - stop the background server started by start.ps1 (Windows PowerShell)
# Usage: .\scripts\stop.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$pidFile = '.run\server.pid'
if (-not (Test-Path $pidFile)) {
    Write-Host 'Not running (no PID file).'
    exit 0
}

$serverPid = [int](Get-Content $pidFile)
if ($serverPid -and (Get-Process -Id $serverPid -ErrorAction SilentlyContinue)) {
    & taskkill /PID $serverPid /T /F | Out-Null
    Write-Host "Stopped (PID $serverPid)."
} else {
    Write-Host 'The recorded process is no longer running.'
}
Remove-Item $pidFile -Force
