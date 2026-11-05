param([string]$ExtensionRoot = (Join-Path (Split-Path $PSScriptRoot -Parent) 'extension'), [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'TrenchWhale\Connector'), [string]$HostName = 'com.trenchwhale.grok', [switch]$Quiet)
$ErrorActionPreference = 'Stop'
try {
  if ($HostName -notin @('com.trenchwhale.grok','com.trenchwhale.grok_test')) { throw 'Invalid host name.' }
  $ExtensionRoot = (Resolve-Path -LiteralPath $ExtensionRoot).Path.TrimEnd('\')
  if (-not (Test-Path -LiteralPath (Join-Path $ExtensionRoot 'manifest.json'))) { throw '找不到插件，请从完整解压的安装包运行。' }
  foreach ($name in @('node.exe','cloudflared.exe')) {
    $binary = Join-Path $PSScriptRoot ('bin\' + $name)
    if (-not (Test-Path -LiteralPath $binary)) { throw '连接组件不完整，请重新解压完整安装包。' }
    $hashes = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bin\checksums.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $hasher = [Security.Cryptography.SHA256]::Create()
    $binaryHash = -join ($hasher.ComputeHash([IO.File]::ReadAllBytes($binary)) | ForEach-Object { $_.ToString('x2') }); $hasher.Dispose()
    if ($binaryHash -ne $hashes.$name) { throw ('连接组件校验失败：' + $name) }
  }
  # Chromium hashes the UTF-16 native Windows path for unpacked-extension IDs.
  $sha = [Security.Cryptography.SHA256]::Create()
  $digest = $sha.ComputeHash([Text.Encoding]::Unicode.GetBytes($ExtensionRoot))
  $id = -join (0..15 | ForEach-Object { [char](97 + ($digest[$_] -shr 4)); [char](97 + ($digest[$_] -band 15)) })
  $sha.Dispose()
  $origins = @('chrome-extension://' + $id + '/')
  # Existing profile entries cover browser-resolved paths without changing the extension's ID.
  foreach ($dataRoot in @((Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'),(Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data'))) {
    if (-not (Test-Path -LiteralPath $dataRoot)) { continue }
    $profiles = Get-ChildItem -LiteralPath $dataRoot -Directory | Where-Object { $_.Name -eq 'Default' -or $_.Name -match '^Profile \d+$' }
    foreach ($profile in $profiles) { foreach ($file in @('Preferences','Secure Preferences')) {
      try {
        $prefs = Get-Content -LiteralPath (Join-Path $profile.FullName $file) -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($prop in $prefs.extensions.settings.PSObject.Properties) {
          if ($prop.Name -match '^[a-p]{32}$' -and $prop.Value.path -and [IO.Path]::GetFullPath($prop.Value.path).TrimEnd('\') -ieq $ExtensionRoot) { $origins += 'chrome-extension://' + $prop.Name + '/' }
        }
      } catch { }
    } }
  }
  $InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
  if ($InstallRoot.TrimEnd('\') -eq $PSScriptRoot.TrimEnd('\')) { throw '安装目标不能是安装包自身。' }
  New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
  $manifestPath = Join-Path $InstallRoot 'native-host.json'
  if (Test-Path -LiteralPath $manifestPath) { try { $previous=Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json; $origins += @($previous.allowed_origins | Where-Object { $_ -match '^chrome-extension://[a-p]{32}/$' }) } catch {} }
  foreach ($name in @('bootstrap.mjs','host.mjs','grok-identity.mjs','report-format.mjs','engine.mjs','platform.mjs','os-support.mjs','mac-platform.mjs','protect.ps1','grok-panel.ps1','network.ps1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $InstallRoot -Force }
  New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot 'bin') | Out-Null
  foreach ($runtimeFile in (Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'bin') -File)) {
    $destinationFile = Join-Path $InstallRoot ('bin\' + $runtimeFile.Name)
    $same = $false
    if ($runtimeFile.Name -in @('node.exe','cloudflared.exe') -and (Test-Path -LiteralPath $destinationFile)) {
      $hasher = [Security.Cryptography.SHA256]::Create()
      $existingHash = -join ($hasher.ComputeHash([IO.File]::ReadAllBytes($destinationFile)) | ForEach-Object { $_.ToString('x2') }); $hasher.Dispose()
      $same = $existingHash -eq $hashes.($runtimeFile.Name)
    }
    # Unchanged runtimes may be executing in Chrome; do not overwrite mapped EXEs.
    if (-not $same) { Copy-Item -LiteralPath $runtimeFile.FullName -Destination $destinationFile -Force }
  }
  $launcher = Join-Path $InstallRoot 'connector-host.cmd'
  [IO.File]::WriteAllText($launcher, "@echo off`r`n`"%~dp0bin\node.exe`" `"%~dp0bootstrap.mjs`" %*`r`n", [Text.Encoding]::ASCII)
  $manifest = @{name=$HostName;description='大肥鱼 Grok Bot 连接组件';path=$launcher;type='stdio';allowed_origins=@($origins | Select-Object -Unique)} | ConvertTo-Json -Depth 5
  [IO.File]::WriteAllText($manifestPath,$manifest,(New-Object Text.UTF8Encoding($false)))
  foreach ($vendor in @('Google\Chrome','Microsoft\Edge')) {
    $key = 'HKCU:\Software\' + $vendor + '\NativeMessagingHosts\' + $HostName
    New-Item -Path $key -Force | Out-Null
    Set-Item -LiteralPath $key -Value $manifestPath
  }
  Write-Output ('已安装，扩展 ID：' + $id)
  if (-not $Quiet) { Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.MessageBox]::Show('连接组件已安装。回到大肥鱼小屋的 AI 连接，点“检测连接”，再生成配对话。','大肥鱼') | Out-Null }
} catch {
  if (-not $Quiet) { Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.MessageBox]::Show($_.Exception.Message,'大肥鱼：安装未完成') | Out-Null }
  Write-Error $_; exit 1
}
