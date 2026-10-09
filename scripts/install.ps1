# Visual Trip Maker - install dependencies (Windows PowerShell)
# Usage: .\scripts\install.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error 'Node.js is not installed. Install Node.js 20 or newer from https://nodejs.org and run this script again.'
}
$major = [int]((node -p "process.versions.node.split('.')[0]").Trim())
if ($major -lt 20) {
    Write-Error "Node.js 20 or newer is required (found $(node -v))."
}

Write-Host "Node $(node -v), npm $(npm -v)"
Write-Host 'Installing dependencies...'
if (Test-Path 'package-lock.json') { npm ci --no-audit --no-fund } else { npm install --no-audit --no-fund }
if ($LASTEXITCODE -ne 0) { Write-Error 'npm install failed.' }
Write-Host 'Done. Next: .\scripts\build.ps1 then .\scripts\start.ps1'
