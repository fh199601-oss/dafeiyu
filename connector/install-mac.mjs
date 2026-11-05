import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { platformPaths, extensionId } from './os-support.mjs';
import { runMac } from './mac-platform.mjs';

export function macManifest(launcher, origins) {
  return { name:'com.trenchwhale.grok',description:'大肥鱼 Grok Bot 连接组件',path:launcher,type:'stdio',allowed_origins:[...new Set(origins)].filter(o=>/^chrome-extension:\/\/[a-p]{32}\/$/.test(o)) };
}
export const launcherText = '#!/bin/sh\nconnector_dir="$(CDPATH= cd -P "$(dirname "$0")" && pwd)"\nexec "$connector_dir/bin/node" "$connector_dir/bootstrap.mjs" "$@"\n';
export async function installMac(source) {
  const platform = platformPaths(); if (platform.platform !== 'darwin') throw new Error('此安装器用于 macOS');
  const version = await runMac('/usr/bin/sw_vers',['-productVersion']); const [major,minor] = version.out.trim().split('.').map(Number);
  if(version.code || !Number.isFinite(major) || !Number.isFinite(minor))throw new Error('无法检测 macOS 版本，请从完整安装包重新运行');
  if (major < 13 || major === 13 && minor < 5) throw new Error('本连接组件需要 macOS 13.5 或更高版本');
  const extension = await fs.realpath(path.join(source,'..','extension'));
  await fs.access(path.join(extension,'manifest.json'));
  const runtime = path.join(source,'bin','darwin-'+platform.arch), hashes=JSON.parse(await fs.readFile(path.join(runtime,'checksums.json'),'utf8'));
  for (const name of ['node','cloudflared']) { const bytes=await fs.readFile(path.join(runtime,name)); if(createHash('sha256').update(bytes).digest('hex')!==hashes[name])throw new Error('组件校验失败，请重新解压完整安装包'); }
  const directory=path.join(platform.base,'Connector'), manifestPath=path.join(directory,'native-host.json');
  let origins=['chrome-extension://'+extensionId(extension,'darwin')+'/'];
  for(const dir of platform.manifests) {
    const profilesRoot=path.dirname(dir); let profiles=[]; try{profiles=await fs.readdir(profilesRoot);}catch{}
    for(const profile of profiles.filter(n=>n==='Default'||/^Profile \d+$/.test(n)))for(const name of ['Preferences','Secure Preferences']) {
      try { const config=JSON.parse(await fs.readFile(path.join(profilesRoot,profile,name),'utf8'));
        for(const [id,entry]of Object.entries(config.extensions?.settings||{}))if(/^[a-p]{32}$/.test(id)&&entry.path&&await fs.realpath(entry.path).catch(()=>null)===extension)origins.push('chrome-extension://'+id+'/');
      } catch{}
    }
  }
  try{origins.push(...JSON.parse(await fs.readFile(manifestPath,'utf8')).allowed_origins);}catch{}
  await fs.mkdir(path.join(directory,'bin'),{recursive:true,mode:0o700});
  for(const name of ['bootstrap.mjs','host.mjs','grok-identity.mjs','report-format.mjs','engine.mjs','platform.mjs','os-support.mjs','mac-platform.mjs','grok-panel-mac.js'])await fs.copyFile(path.join(source,name),path.join(directory,name));
  for(const name of ['node','cloudflared']){const installed=path.join(directory,'bin',name);let same=false;try{same=createHash('sha256').update(await fs.readFile(installed)).digest('hex')===hashes[name];}catch{}if(!same)await fs.copyFile(path.join(runtime,name),installed);await fs.chmod(installed,0o755);}
  for(const name of ['NODE-LICENSE.txt','CLOUDFLARED-LICENSE.txt'])await fs.copyFile(path.join(source,'bin',name),path.join(directory,'bin',name));
  const launcher=path.join(directory,'connector-host.sh');await fs.writeFile(launcher,launcherText,{mode:0o755});await fs.chmod(launcher,0o755);
  const manifest=JSON.stringify(macManifest(launcher,origins),null,2);await fs.writeFile(manifestPath,manifest,{mode:0o600});
  for(const folder of platform.manifests){await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,'com.trenchwhale.grok.json'),manifest,{mode:0o600});}
  // Check the executable that will actually run, without pairing or creating a keychain entry.
  const check=await runMac(path.join(directory,'bin','node'),['--version']);if(check.code)throw new Error('Mac 尚未允许连接组件运行，请按系统提示允许后重新安装');
  console.log('已安装 macOS '+platform.arch+' 连接组件；尚未连接任何 Bot。');
  await runMac('/usr/bin/osascript',['-e','display dialog "连接组件已安装。回到大肥鱼小屋的 AI 连接，点检测连接，再生成配对话。首次连接时请按系统提示允许辅助功能或自动化访问。" with title "大肥鱼" buttons {"好"} default button "好"']);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{await installMac(path.dirname(fileURLToPath(import.meta.url)));}catch(e){console.error(e.message);process.exitCode=1;}
}
