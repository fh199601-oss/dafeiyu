$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$proxy = ''
try {
  $settings = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
  if ($settings.ProxyEnable -eq 1 -and $settings.ProxyServer) {
    $value = [string]$settings.ProxyServer
    if ($value.Contains('=')) { $values = @{}; foreach($part in $value.Split(';')) { $kv=$part.Split('=',2); if($kv.Length -eq 2){$values[$kv[0]]=$kv[1]} }; $value = if($values['https']){$values['https']}else{$values['http']} }
    if ($value) { if($value -notmatch '^https?://'){$value='http://' + $value}; $uri=[uri]$value; if($uri.Scheme -in @('http','https')){$proxy=$uri.AbsoluteUri} }
  } elseif ($settings.AutoConfigURL) {
    $target=[uri]'https://api.cursor.com';$resolved=[Net.WebRequest]::GetSystemWebProxy().GetProxy($target)
    if($resolved -ne $target -and $resolved.Scheme -in @('http','https')){$proxy=$resolved.AbsoluteUri}
  }
} catch {}
@{proxy=$proxy} | ConvertTo-Json -Compress
