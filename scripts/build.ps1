# Visual Trip Maker - type-check, lint and build the production bundle (Windows PowerShell)
# Usage: .\scripts\build.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not (Test-Path 'node_modules')) {
    Write-Error 'Dependencies are missing. Run .\scripts\install.ps1 first.'
}

Write-Host 'Linting...'
npm run lint
if ($LASTEXITCODE -ne 0) { Write-Error 'Lint failed.' }

Write-Host 'Building...'
npm run build
if ($LASTEXITCODE -ne 0) { Write-Error 'Build failed.' }
Write-Host 'Build finished: dist\'
