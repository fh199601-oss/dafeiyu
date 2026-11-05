import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { platformPaths, extensionId } from '../connector/os-support.mjs';
import { keychainKey, macStore, parseMacProxy } from '../connector/mac-platform.mjs';
import { macManifest, launcherText } from '../connector/install-mac.mjs';
test('Windows and both Mac architectures have native paths and platform-specific extension IDs', () => {
  assert.equal(extensionId('E:\\小工具\\战壕精灵\\extension','win32'),'hpfnggmkcbhgpkodakgbdclhlmngipde');
  const macId=extensionId('/Users/test/战壕精灵/extension','darwin');assert.match(macId,/^[a-p]{32}$/);assert.notEqual(macId,extensionId('/Users/test/战壕精灵/extension','win32'));
  for(const arch of ['arm64','x64']){const p=platformPaths({platform:'darwin',home:'/Users/test',arch});assert.equal(p.curl,'/usr/bin/curl');assert.equal(p.nullDevice,'/dev/null');assert.equal(p.tunnel,'cloudflared');assert.equal(p.manifests[0],'/Users/test/Library/Application Support/Google/Chrome/NativeMessagingHosts');assert.equal(p.manifests[1],'/Users/test/Library/Application Support/Microsoft Edge/NativeMessagingHosts');assert.ok(!p.data.includes('\\'));}
  assert.throws(()=>platformPaths({platform:'linux'}));
});
test('Mac native registration binds only exact installed extension origins and quotes paths with spaces', () => {
  const id=extensionId('/Users/test/A B/extension','darwin'), origin='chrome-extension://'+id+'/';
  const m=macManifest('/Users/test/Library/Application Support/TrenchWhale/Connector/connector-host.sh',[origin,origin,'*','https://evil.test']);assert.deepEqual(m.allowed_origins,[origin]);assert.match(launcherText,/exec "\$connector_dir\/bin\/node"/);assert.match(launcherText,/"\$@"/);
});
test('Mac keychain creation sends keys over stdin, verifies them and never puts them in command arguments', async () => {
  const calls=[];let saved;
  const key=keychainKey('a'.repeat(32),async(binary,args,input)=>{calls.push({binary,args,input});if(args[0]==='find-generic-password')return saved?{code:0,out:saved+'\n'}:{code:44,out:''};saved=input.match(/-w ([a-f0-9]{64})/)[1];return{code:0,out:''};});
  const result=await key(true);assert.equal(result.length,32);assert.equal(result.toString('hex'),saved);assert.ok(calls.every(c=>!c.args.join(' ').includes(saved)));assert.equal((await key(false)),result);
  const denied=keychainKey('b'.repeat(32),async()=>({code:36,out:''}));await assert.rejects(denied(true),/钥匙串/);
});
test('Mac storage encrypts credential and task data with an authenticated keychain key; tampering fails closed', async () => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'trench-mac-store-'));const key=randomBytes(32);const store=macStore(directory,async()=>key);
  try{assert.equal(await store.read(),null);const data={connection:{webhookKey:'private-fixture-secret'},tasks:[{title:'私密研究'}]};await store.write(data);assert.deepEqual(await store.read(),data);const file=path.join(directory,'account.keychain'),raw=await fs.readFile(file,'utf8');assert.ok(!raw.includes('private-fixture-secret'));assert.ok(!raw.includes('私密研究'));const record=JSON.parse(raw);record.tag=Buffer.alloc(16).toString('base64');await fs.writeFile(file,JSON.stringify(record));await assert.rejects(store.read(),/无法解密/);}finally{if(path.dirname(path.resolve(directory))!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('trench-mac-store-'))throw Error('Unsafe cleanup path');await fs.rm(directory,{recursive:true,force:true});}
});
test('Mac system proxy parsing supports HTTP, HTTPS and IPv6 while rejecting malformed endpoints', () => {
  assert.equal(parseMacProxy('HTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 7890'),'http://127.0.0.1:7890');
  assert.equal(parseMacProxy('HTTPEnable : 1\nHTTPProxy : ::1\nHTTPPort : 1080'),'http://[::1]:1080');
  assert.equal(parseMacProxy('HTTPEnable : 0\nHTTPProxy : foo\nHTTPPort : 1080'),'');
  assert.equal(parseMacProxy('HTTPSEnable : 1\nHTTPSProxy : proxy/evil\nHTTPSPort : 7890'),'');
});
