(function(){
  'use strict';
  const $=id=>document.getElementById(id), prepare=$('grok-install-prepare'), open=$('grok-install-open'), folder=$('grok-install-folder'), feedback=$('grok-install-feedback');
  const mac=/Mac/i.test(navigator.userAgentData?.platform||navigator.platform||'');
  let itemId=null, objectUrl=null, working=false;
  const storageKey='grokInstallerDownload';
  const version=globalThis.chrome?.runtime?.getManifest?.().version;
  const fileName=mac?'安装连接组件-Mac.zip':'安装连接组件.cmd';
  open.textContent=mac?'打开安装包':'运行安装器';
  folder.textContent=mac?'在 Finder 中显示':'打开安装位置';
  function tell(text){feedback.textContent=text;}
  function markLaunched(){window.dispatchEvent(new Event('trench-installer-launched'));}
  function trusted(item){return item&&item.byExtensionId===chrome.runtime.id&&item.id===itemId;}
  async function inspect(){
    if(itemId===null)return;
    const requested=itemId, [item]=await chrome.downloads.search({id:requested});
    if(requested!==itemId)return;
    if(!trusted(item)){itemId=null;open.disabled=true;folder.disabled=true;tell('请重新准备安装器。');return;}
    const complete=item.state==='complete'&&item.exists;
    open.disabled=!complete;folder.disabled=!complete;
    if(complete){tell(mac?'安装包已准备好。点击“打开安装包”，解压后双击唯一的安装脚本。':'安装器已准备好。点击“运行安装器”即可；也可打开只含这个安装文件的位置。');if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}}
    else if(item.state==='interrupted'){tell('安装器未保存完成。请按浏览器下载提示处理，然后重新准备。');}
    else tell('浏览器正在保存或检查安装器，请按下载提示确认。完成后这里会出现运行入口。');
  }
  prepare.addEventListener('click',async()=>{
    if(working)return;working=true;itemId=null;prepare.disabled=true;open.disabled=true;folder.disabled=true;tell('正在准备当前系统的安装器…');
    try{
      if(!globalThis.chrome?.downloads)throw Error('请从已加载插件的小屋打开安装入口。');
      const text=async name=>{const r=await fetch(chrome.runtime.getURL('installers/'+name));if(!r.ok)throw Error('安装文件缺失，请重新加载完整插件');return r.text();};
      let bytes;
      if(mac){const [locator,template]=await Promise.all([text('locate-mac.js'),text('launch-mac.command.template')]);bytes=TrenchInstallerKit.zipExecutable('安装连接组件.command',TrenchInstallerKit.mac(chrome.runtime.id,locator,template));}
      else bytes=TrenchInstallerKit.windows(chrome.runtime.id,await text('locate-windows.ps1'));
      if(objectUrl)URL.revokeObjectURL(objectUrl);
      objectUrl=URL.createObjectURL(new Blob([bytes],{type:mac?'application/zip':'application/octet-stream'}));
      // Every preparation gets its own folder, containing exactly this installer.
      const filename=`大肥鱼安装/${version}-${crypto.randomUUID().slice(0,8)}/${fileName}`;
      itemId=await chrome.downloads.download({url:objectUrl,filename,saveAs:false,conflictAction:'uniquify'});
      await chrome.storage.local.set({[storageKey]:{id:itemId,version,platform:mac?'mac':'win'}});await inspect();
    }catch(e){tell(e.message||'安装器准备失败，请重试');}finally{working=false;prepare.disabled=false;}
  });
  // Invoke directly from the click, preserving Chrome's user gesture requirement.
  open.addEventListener('click',()=>{
    if(itemId===null||open.disabled)return;
    chrome.downloads.open(itemId).then(()=>{tell(mac?'请双击解压后唯一的安装脚本。安装完成后这里会自动检测连接。':'已交给系统运行；请按系统提示完成安装，这里会自动检测连接。');markLaunched();})
      .catch(()=>{tell('浏览器未直接打开安装器。请点“'+folder.textContent+'”，在专用目录中双击安装文件。');folder.disabled=false;});
  });
  folder.addEventListener('click',()=>{if(itemId===null||folder.disabled)return;try{chrome.downloads.show(itemId);markLaunched();}catch{tell('暂时无法打开安装位置，请重新准备安装器。');}});
  if(globalThis.chrome?.downloads){
    chrome.downloads.onChanged.addListener(delta=>{if(delta.id===itemId)inspect().catch(()=>{});});
    chrome.storage.local.get(storageKey).then(data=>{if(working||itemId!==null)return;const saved=data[storageKey];if(saved?.version===version&&saved.platform===(mac?'mac':'win')&&Number.isInteger(saved.id)){itemId=saved.id;inspect().catch(()=>{});}});
  }else{prepare.disabled=true;tell('加载插件后，可在这里准备并运行连接组件。');}
})();
