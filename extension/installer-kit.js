(function(root){
  'use strict';
  function validateId(id) { if (!/^[a-p]{32}$/.test(id || '')) throw Error('扩展标识无效'); return id; }
  const utf8 = s => new TextEncoder().encode(s);
  function base64(bytes) { let s=''; for(const b of bytes)s+=String.fromCharCode(b); return btoa(s); }
  function windows(id, locator) {
    validateId(id);
    const script = `$ErrorActionPreference='Stop'\n${locator}\ntry {\nWrite-Host '大肥鱼：正在定位当前浏览器的插件…'\n$directory = Find-TrenchExtension -ExtensionId '${id}'\n$installer = Join-Path (Split-Path -Parent $directory) 'connector\\install.ps1'\nWrite-Host '已找到插件，正在校验并安装连接组件…'\n& $installer -ExtensionRoot $directory\n} catch {\nAdd-Type -AssemblyName System.Windows.Forms\n[Windows.Forms.MessageBox]::Show($_.Exception.Message,'大肥鱼：安装未完成') | Out-Null\nexit 1\n}\n`;
    // The body stays in this file: a long EncodedCommand exceeds cmd.exe's 8191 limit.
    const header = ['@echo off','setlocal DisableDelayedExpansion','set "TRENCH_INSTALL_SCRIPT=%~f0"',
      'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$lines=[IO.File]::ReadAllLines($env:TRENCH_INSTALL_SCRIPT,[Text.Encoding]::UTF8); & ([scriptblock]::Create(($lines | Select-Object -Skip 5) -join [Environment]::NewLine))"',
      'exit /b %errorlevel%'];
    return utf8(header.join('\r\n')+'\r\n'+script.replace(/\r?\n/g,'\r\n'));
  }
  function mac(id, locator, template) { return utf8(template.replaceAll('__EXTENSION_ID__',validateId(id)).replaceAll('__LOCATOR_BASE64__',base64(utf8(locator)))); }
  function crc32(bytes) { let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0; }
  // A one-file, uncompressed ZIP. UTF-8 names and Unix 0755 survive Archive Utility.
  function zipExecutable(name, content) {
    const n=utf8(name), crc=crc32(content), local=new Uint8Array(30+n.length+content.length), l=new DataView(local.buffer);
    l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint16(12,33,true);l.setUint32(14,crc,true);l.setUint32(18,content.length,true);l.setUint32(22,content.length,true);l.setUint16(26,n.length,true);local.set(n,30);local.set(content,30+n.length);
    const central=new Uint8Array(46+n.length), c=new DataView(central.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(4,0x314,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,33,true);c.setUint32(16,crc,true);c.setUint32(20,content.length,true);c.setUint32(24,content.length,true);c.setUint16(28,n.length,true);c.setUint32(38,0o100755*65536,true);central.set(n,46);
    const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,1,true);e.setUint16(10,1,true);e.setUint32(12,central.length,true);e.setUint32(16,local.length,true);
    const zip=new Uint8Array(local.length+central.length+end.length);zip.set(local);zip.set(central,local.length);zip.set(end,local.length+central.length);return zip;
  }
  root.TrenchInstallerKit={windows,mac,zipExecutable,crc32};
  if(typeof module!=='undefined')module.exports=root.TrenchInstallerKit;
})(globalThis);
