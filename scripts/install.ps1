$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$extensionPath = Join-Path $projectRoot 'extension'
if (-not (Test-Path -LiteralPath (Join-Path $extensionPath 'manifest.json'))) { throw 'Extension folder is missing.' }
$chromePath = Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'
if (-not (Test-Path -LiteralPath $chromePath)) { $chromePath = Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe' }
if (Test-Path -LiteralPath $chromePath) {
  Start-Process -FilePath $chromePath -ArgumentList 'chrome://extensions'
} else {
  $edgePath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
  if (Test-Path -LiteralPath $edgePath) { Start-Process -FilePath $edgePath -ArgumentList 'edge://extensions' }
}
Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $extensionPath + '"')
Write-Host ''
Write-Host 'Enable Developer mode, choose Load unpacked, then select this folder:'
Write-Host $extensionPath
Write-Host ''
Write-Host 'Refresh an ordinary webpage after loading the extension.'
