# Loaded as UTF-8 from the generated installer. Never evaluates browser preference values.
function Get-TrenchBrowserRoots {
  $roots = @()
  try {
    foreach ($process in (Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe' OR Name = 'msedge.exe'" -ErrorAction Stop)) {
      $match = [regex]::Match([string]$process.CommandLine, '"--user-data-dir=([^"\r\n]+)"|--user-data-dir="([^"\r\n]+)"|--user-data-dir=([^\s"]+)')
      if ($match.Success) { foreach ($group in $match.Groups | Select-Object -Skip 1) { if ($group.Success) { $roots += $group.Value; break } } }
    }
  } catch { }
  $roots += @((Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'), (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data'), (Join-Path $env:LOCALAPPDATA 'Google\Chrome for Testing\User Data'))
  @($roots | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) } | Select-Object -Unique)
}
function Find-TrenchExtension {
  param([Parameter(Mandatory=$true)][string]$ExtensionId, [string[]]$BrowserRoots = @())
  if ($ExtensionId -notmatch '^[a-p]{32}$') { throw '扩展标识无效，请回到小屋重新准备安装器。' }
  if (-not $BrowserRoots.Count) { $BrowserRoots = @(Get-TrenchBrowserRoots) }
  $matches = @()
  foreach ($root in $BrowserRoots) {
    $profiles = @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | Select-Object -First 200)
    foreach ($profile in $profiles) { foreach ($name in @('Preferences','Secure Preferences')) {
      $file = Join-Path $profile.FullName $name
      try {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Item -LiteralPath $file).Length -gt 52428800) { continue }
        $preferences = [IO.File]::ReadAllText($file, [Text.Encoding]::UTF8) | ConvertFrom-Json
        $entry = $preferences.extensions.settings.PSObject.Properties[$ExtensionId].Value
        if (-not $entry.path -or -not [IO.Path]::IsPathRooted([string]$entry.path)) { continue }
        $directory = (Resolve-Path -LiteralPath $entry.path -ErrorAction Stop).Path.TrimEnd('\')
        $manifestPath = Join-Path $directory 'manifest.json'
        $manifest = [IO.File]::ReadAllText($manifestPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
        # Accept the previous display name for in-place upgrades, still with exact ID/path checks.
        if ($manifest.name -notin @('大肥鱼', '战壕精灵 · 蓝鲸娘') -or $manifest.manifest_version -ne 3) { continue }
        $package = Split-Path -Parent $directory
        if (-not (Test-Path -LiteralPath (Join-Path $package 'connector\install.ps1') -PathType Leaf)) { continue }
        if (-not (Test-Path -LiteralPath (Join-Path $package '一键安装AI连接组件.cmd') -PathType Leaf)) { continue }
        $matches += $directory
      } catch { }
    } }
  }
  $matches = @($matches | Sort-Object -Unique)
  if ($matches.Count -eq 1) { return $matches[0] }
  if ($matches.Count -gt 1) { throw '找到了多个不同的安装目录。请关闭重复加载的旧版大肥鱼，回小屋重新准备安装器。' }
  throw '未找到已加载的完整安装包。请保持浏览器打开，并确认加载的是完整解压包中的 extension 文件夹，然后重试。'
}
