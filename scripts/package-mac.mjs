import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';import{createHash}from'node:crypto';
import{portableZip}from'./fix-zip-modes.mjs';
if(process.platform!=='darwin')throw Error('macOS only; Windows uses scripts/package.ps1');
const version=JSON.parse(await fs.readFile('extension/manifest.json','utf8')).version;
let files=[];
async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){if(e.name.startsWith('.'))continue;const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else if(e.isFile())files.push(p);}}
await walk('extension');await walk('connector');files.push('README.md','docs/RELEASING.md','scripts/install.ps1','scripts/preview.ps1');files.push(...(await fs.readdir('.')).filter(f=>/\.(cmd|command)$/.test(f)));
const macModules=new Set(['bootstrap.mjs','host.mjs','grok-identity.mjs','report-format.mjs','engine.mjs','platform.mjs','os-support.mjs','mac-platform.mjs','install-mac.mjs','grok-panel-mac.js']);
const mac=files.filter(p=>p.startsWith('extension/')||p==='README.md'||p==='docs/RELEASING.md'||!p.includes('/')&&p.endsWith('.command')||path.dirname(p)==='connector'&&macModules.has(path.basename(p))||/^connector\/bin\/darwin-(arm64|x64)\//.test(p)||['connector/bin/NODE-LICENSE.txt','connector/bin/CLOUDFLARED-LICENSE.txt'].includes(p));
function run(cmd,args,input){return new Promise((resolve,reject)=>{const c=spawn(cmd,args,{stdio:['pipe','pipe','pipe']});let err='';c.stderr.on('data',d=>err+=d);c.stdout.resume();c.on('error',reject);c.on('exit',code=>code?reject(Error(cmd+' failed: '+err)):resolve());c.stdin.end(input);});}
await fs.mkdir('dist',{recursive:true});const report=[];
for(const[suffix,entries]of[['',files],['-macOS',mac]]){
 const archive=path.resolve('dist',`大肥鱼-v${version}${suffix}.zip`);try{await fs.access(archive);throw Error('Archive already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
 await run('/usr/bin/zip',['-q','-6','-X',archive,'-@'],entries.sort().join('\n')+'\n');
 const bytes=await fs.readFile(archive);const verified=portableZip(bytes);
 // Mark UTF-8 names consistently in both ZIP records for Windows extraction.
 let end=bytes.length-22;while(bytes.readUInt32LE(end)!==0x06054b50)end--;
 let offset=bytes.readUInt32LE(end+16);
 for(let i=0;i<bytes.readUInt16LE(end+10);i++){
  const local=bytes.readUInt32LE(offset+42);bytes.writeUInt16LE(bytes.readUInt16LE(offset+8)|0x800,offset+8);bytes.writeUInt16LE(bytes.readUInt16LE(local+6)|0x800,local+6);
  offset+=46+bytes.readUInt16LE(offset+28)+bytes.readUInt16LE(offset+30)+bytes.readUInt16LE(offset+32);
 }
 await fs.writeFile(archive,bytes);await run('/usr/bin/unzip',['-tqq',archive]);
 const sha256=createHash('sha256').update(bytes).digest('hex');await fs.writeFile(archive.replace(/\.zip$/,'.sha256.txt'),sha256+'  '+path.basename(archive)+'\n');
 report.push({archive,sha256,entries:verified.length,bytes:bytes.length});console.log(JSON.stringify(report.at(-1)));
}
await fs.writeFile(`dist/packages-v${version}.json`,JSON.stringify(report,null,2)+'\n');
