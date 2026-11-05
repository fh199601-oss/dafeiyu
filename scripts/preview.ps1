$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$previewPath = Join-Path $projectRoot 'extension\home.html'
if (-not (Test-Path -LiteralPath $previewPath)) { throw 'Preview page is missing.' }
Start-Process -FilePath $previewPath
