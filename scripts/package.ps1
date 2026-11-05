$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $projectRoot 'extension\manifest.json') | ConvertFrom-Json
$releaseName = '大肥鱼-v' + $manifest.version
$dist = Join-Path $projectRoot 'dist'
$release = Join-Path $dist $releaseName
$archive = Join-Path $dist ($releaseName + '.zip')
if ((Test-Path -LiteralPath $release) -or (Test-Path -LiteralPath $archive)) { throw 'Release already exists. Bump the version before packaging again.' }
New-Item -ItemType Directory -Force -Path (Join-Path $release 'scripts') | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'extension') -Destination $release -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'connector') -Destination $release -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination $release
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs') -Destination $release -Recurse
Get-ChildItem -LiteralPath $projectRoot -Filter '*.cmd' | Copy-Item -Destination $release
Get-ChildItem -LiteralPath $projectRoot -Filter '*.command' | Copy-Item -Destination $release
foreach ($script in @('install.ps1', 'preview.ps1')) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $script) -Destination (Join-Path $release 'scripts')
}
Compress-Archive -Path (Join-Path $release '*') -DestinationPath $archive -CompressionLevel Optimal
node (Join-Path $PSScriptRoot 'fix-zip-modes.mjs') $archive
if ($LASTEXITCODE -ne 0) { throw 'Cross-platform ZIP metadata validation failed.' }
$hash = Get-FileHash -LiteralPath $archive -Algorithm SHA256
($hash.Hash + '  ' + (Split-Path -Leaf $archive)) | Set-Content -LiteralPath (Join-Path $dist ($releaseName + '.sha256.txt')) -Encoding utf8
Write-Output $archive
Write-Output $hash.Hash
$macRelease = Join-Path $dist ($releaseName + '-macOS')
$macArchive = Join-Path $dist ($releaseName + '-macOS.zip')
if ((Test-Path -LiteralPath $macRelease) -or (Test-Path -LiteralPath $macArchive)) { throw 'Mac release already exists.' }
New-Item -ItemType Directory -Force -Path (Join-Path $macRelease 'connector\bin') | Out-Null
Copy-Item -LiteralPath (Join-Path $release 'extension') -Destination $macRelease -Recurse
Copy-Item -LiteralPath (Join-Path $release 'README.md') -Destination $macRelease
Copy-Item -LiteralPath (Join-Path $release 'docs') -Destination $macRelease -Recurse
Get-ChildItem -LiteralPath $release -Filter '*.command' | Copy-Item -Destination $macRelease
foreach ($file in @('bootstrap.mjs','host.mjs','grok-identity.mjs','report-format.mjs','engine.mjs','platform.mjs','os-support.mjs','mac-platform.mjs','install-mac.mjs','grok-panel-mac.js')) { Copy-Item -LiteralPath (Join-Path $release ('connector\' + $file)) -Destination (Join-Path $macRelease 'connector') }
foreach ($arch in @('darwin-arm64','darwin-x64')) { Copy-Item -LiteralPath (Join-Path $release ('connector\bin\' + $arch)) -Destination (Join-Path $macRelease 'connector\bin') -Recurse }
foreach ($license in @('NODE-LICENSE.txt','CLOUDFLARED-LICENSE.txt')) { Copy-Item -LiteralPath (Join-Path $release ('connector\bin\' + $license)) -Destination (Join-Path $macRelease 'connector\bin') }
Compress-Archive -Path (Join-Path $macRelease '*') -DestinationPath $macArchive -CompressionLevel Optimal
node (Join-Path $PSScriptRoot 'fix-zip-modes.mjs') $macArchive
if ($LASTEXITCODE -ne 0) { throw 'Mac ZIP metadata validation failed.' }
$macHash = Get-FileHash -LiteralPath $macArchive -Algorithm SHA256
($macHash.Hash + '  ' + (Split-Path -Leaf $macArchive)) | Set-Content -LiteralPath (Join-Path $dist ($releaseName + '-macOS.sha256.txt')) -Encoding utf8
Write-Output $macArchive
Write-Output $macHash.Hash
