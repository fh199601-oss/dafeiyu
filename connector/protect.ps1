$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Security
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$entropy = [Text.Encoding]::UTF8.GetBytes('TrenchWhale.GrokConnector.v1')
if ($request.operation -eq 'write') {
  $plain = [Text.Encoding]::UTF8.GetBytes(($request.value | ConvertTo-Json -Depth 30 -Compress))
  $protected = [Security.Cryptography.ProtectedData]::Protect($plain,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  @{encrypted=[Convert]::ToBase64String($protected)} | ConvertTo-Json -Compress
} elseif ($request.operation -eq 'read') {
  $plain = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($request.value),$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Write([Text.Encoding]::UTF8.GetString($plain))
} else { throw 'Invalid storage operation' }
