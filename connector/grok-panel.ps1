$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$target = [Console]::In.ReadToEnd() | ConvertFrom-Json
if ($target.id -notmatch '^[A-Za-z0-9_-]{1,128}$' -or $target.routineId -notmatch '^[A-Za-z0-9_-]{1,150}$' -or $target.routineName -notmatch '^(?:大肥鱼连接|精灵连接)·[A-F0-9]{6}$' -or [string]::IsNullOrWhiteSpace($target.name)) { throw '配对信息无效' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class TrenchGrokAccessibility {
[DllImport("user32.dll",SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hwnd,uint msg,UIntPtr w,IntPtr l,uint flags,uint timeout,out UIntPtr result);
}
'@
$grok = Get-Process -Name 'Grok Bot' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $grok) { throw '请打开并登录 Grok Bot 桌面版，再点继续连接' }
[UIntPtr]$result = [UIntPtr]::Zero
[TrenchGrokAccessibility]::SendMessageTimeout($grok.MainWindowHandle,0x003D,[UIntPtr]::Zero,[IntPtr](-25),2,1000,[ref]$result) | Out-Null
$processCondition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$grok.Id)
$window=[System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children,$processCondition)
function Find-Named([string]$name) { $c=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,$name); $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$c) }
function Wait-Named([string]$name,[int]$seconds=8) { $end=(Get-Date).AddSeconds($seconds); do { $e=Find-Named $name; if($e){return $e}; Start-Sleep -Milliseconds 250 } while((Get-Date) -lt $end); throw '没有找到对应的例程面板，请在 Grok Bot 打开刚创建的大肥鱼连接例程，再点继续连接' }
function Assert-Bot {
  $c=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'sand-conversation-heading')
  $heading=$window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$c)
  if(-not $heading -or $heading.Current.Name -ne $target.name){ throw 'Grok Bot 当前会话不匹配，请切回配对的 Bot 再继续连接' }
}
function Invoke-Control($element) {
  $pattern=$null
  if($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){ $pattern.Invoke(); return }
  if($element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$pattern)){ $pattern.Expand(); return }
  throw '当前控件暂时无法操作，请在 Grok Bot 打开本次大肥鱼连接例程后重试'
}
# The host has resolved this ID from Grok Bot's selected-agent metadata.
# Keep the selected conversation in place; do not navigate using a Bot-supplied ID.
Assert-Bot
if(-not (Find-Named 'Webhook URL')) {
  $entry=Find-Named ('打开例行任务 ' + $target.routineName)
  if(-not $entry){ $entry=Find-Named ('Open routine ' + $target.routineName) }
  if($entry){ Invoke-Control $entry }
  else {
    $link='grokbot://app/v1/sidebar?agent=' + [uri]::EscapeDataString($target.id) + '&tab=routines'
    Start-Process -FilePath $link -WindowStyle Hidden
  }
}
# Only the unique pairing routine in this selected bot is accepted.
$end=(Get-Date).AddSeconds(10); $row=$null
do {
  if((Find-Named 'Webhook URL') -and (Find-Named $target.routineName)){ break }
  $buttons=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Button)))
  $rows=@($buttons | Where-Object { $_.Current.Name -eq $target.routineName -or $_.Current.Name.StartsWith($target.routineName + ' ') })
  if($rows.Count -eq 1){$row=$rows[0]; break}; Start-Sleep -Milliseconds 250
}while((Get-Date) -lt $end)
if($row){ Invoke-Control $row }
elseif(-not ((Find-Named 'Webhook URL') -and (Find-Named $target.routineName))){ throw '没有找到本次配对例程，请打开 Bot 详情中的大肥鱼连接例程，再点继续连接' }
$urlField=Wait-Named 'Webhook URL'
Assert-Bot
if(-not (Find-Named $target.routineName)){ throw '例程名称不匹配，已停止连接' }
$revealed=$false
try {
  $url='';$valueUntil=(Get-Date).AddSeconds(3)
  do {
    Assert-Bot
    $url=$urlField.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
    if($url.StartsWith('https://')){break};Start-Sleep -Milliseconds 150
  } while((Get-Date) -lt $valueUntil)
  $uri=[uri]$url
  $validHost=$uri.Host -eq 'cursor.com' -or $uri.Host.EndsWith('.cursor.com') -or $uri.Host -eq 'cursor.sh' -or $uri.Host.EndsWith('.cursor.sh') -or $uri.Host -eq 'x.ai' -or $uri.Host.EndsWith('.x.ai') -or $uri.Host -eq 'grok.com' -or $uri.Host.EndsWith('.grok.com')
  if($uri.Scheme -ne 'https' -or -not $validHost -or $uri.UserInfo -or -not $uri.IsDefaultPort -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -ne ('/automations/webhook/' + [uri]::EscapeDataString($target.routineId))) { throw '例程标识与配对信息不匹配，已停止读取。请重新生成配对话。' }
  $show=Find-Named '显示Webhook 密钥'
  if($show){$show.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke();$revealed=$true}
  $field=Wait-Named 'Webhook 密钥'
  Assert-Bot
  if(-not (Find-Named $target.routineName)){throw '读取期间切换了例程，已停止连接'}
  $key=$field.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
  if([string]::IsNullOrWhiteSpace($key) -or $key -match '^[●•*]+$'){throw '无法读取本次例程的连接信息，请重试'}
  @{url=$url;key=$key} | ConvertTo-Json -Compress
} finally {
  $key=$null
  if($revealed){$hide=Find-Named '隐藏Webhook 密钥';if($hide){$hide.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()}}
}
