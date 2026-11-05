import {chromium,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const minutes=Number(process.env.SOAK_MINUTES||20);
if(!Number.isFinite(minutes)||minutes<1||minutes>90)throw Error('SOAK_MINUTES must be 1..90');
const label=String(process.env.SOAK_LABEL||'').replace(/[^a-z0-9_-]/gi,'').slice(0,48);
const output=path.resolve('test-results/extended-soak',label);await fs.mkdir(output,{recursive:true});
const source=path.resolve(process.env.SOAK_EXTENSION_ROOT||'extension');
const run=await fs.mkdtemp(path.join(output,'run-')),extension=path.join(run,'extension');await fs.cp(source,extension,{recursive:true});
// All remote finance and native Bot transport are replaced ONLY in this isolated
// test copy. The actual background, inbox, services and content scripts remain.
const fixture=`
globalThis.soakBoot=crypto.randomUUID();
globalThis.fetch=async(input,init={})=>{
 const u=new URL(input),{soakFixture:f={}}=await chrome.storage.local.get('soakFixture');
 if(f.hang)await new Promise(()=>{});
 await new Promise(r=>setTimeout(r,120));
 if(f.fail)return Response.json({message:'fixture temporary outage'},{status:503});
 const balance=f.balance||'1.25',pnl=f.pnl||'2.3';
 if(u.host.includes('binance'))return Response.json(u.pathname.endsWith('/time')?{serverTime:Date.now()}:[{walletName:'Spot',balance,activate:true}]);
 return Response.json({code:0,data:u.pathname.endsWith('wallet_profits')?{list:JSON.parse(init.body).wallet_addresses.map(wallet_address=>({wallet_address,realized_profit:pnl}))}:{balances:[{wallet_address:u.searchParams.get('wallet_address'),token_address:'0x0000000000000000000000000000000000000000',balance}]}});
};
`;
await fs.writeFile(path.join(extension,'soak-fixture.js'),fixture);
const bg=path.join(extension,'background.js');await fs.writeFile(bg,"importScripts('soak-fixture.js');\n"+await fs.readFile(bg,'utf8'));
await fs.writeFile(path.join(extension,'grok-connection.js'),`(function(root){root.TrenchGrok={create(onState){
 let state={installed:true,configured:true,connectionId:'soak-pair',bot:{id:'soak-bot',name:'耐久测试助手',url:'grokbot://app/v1/agent?id=soak-bot'},tasks:[],events:[]};
 chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.soakBot){state=changes.soakBot.newValue;onState(state);}});
 async function status(){const saved=await chrome.storage.local.get('soakBot');if(saved.soakBot)state=saved.soakBot;onState(state);return state;}
 status();return {peek:()=>state,status,enable:async()=>{},disable:async()=>{},async call(action){if(action!=='ack')throw Error('No real Bot operations in soak');return state;}};
}};})(globalThis);`);
const observations=[],errors=[],began=Date.now();let context,worker,home,cdp,versions=[],cycle=0;
const record=(event,details={})=>{const row={at:new Date().toISOString(),elapsedSeconds:Math.round((Date.now()-began)/1000),event,...details};observations.push(row);console.log(JSON.stringify(row));};
const persist=async()=>fs.writeFile(path.join(output,'progress.json'),JSON.stringify({startedAt:new Date(began).toISOString(),requestedMinutes:minutes,cycles:cycle,observations,errors,complete:false},null,2));
async function api(message){const result=await home.evaluate(m=>chrome.runtime.sendMessage(m),message);expect(result.ok,JSON.stringify(result)).toBe(true);return result;}
async function finishTask(id){await worker.evaluate(async id=>{
 const {soakBot:s={installed:true,configured:true,connectionId:'soak-pair',bot:{id:'soak-bot',name:'耐久测试助手'},tasks:[],events:[]}}=await chrome.storage.local.get('soakBot');
 const t={id,seq:Number(id.replace(/\D/g,'')),botName:'耐久测试助手',botUrl:'grokbot://app/v1/agent?id=soak-bot',title:'项目 '+id,status:'completed',summary:'隔离测试完成',createdAt:Date.now()-1000,finishedAt:Date.now()};
 await chrome.storage.local.set({soakBot:{...s,tasks:[...s.tasks,t].slice(-40),events:[t]}});
},id);}
try{
 context=await chromium.launchPersistentContext(path.join(run,'profile'),{channel:'msedge',headless:true,viewport:{width:1280,height:900},ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await context.route(/^https:\/\/(gmgn.ai|www.binance.com|[a-z]+\.soak.test)\//,r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><title>隔离长时测试</title><p>无真实账户或 Bot</p>'}));
 worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
 home=await context.newPage();await home.goto(`chrome-extension://${id}/home.html#click-settings`);
 await api({type:'settings:patch',patch:{clickMode:'auto',clickGmgn:'gmgn',clickBinance:'binance',clickOther:'companion',binanceView:'assets',energy:'quiet',sound:false,interactionSound:false}});
 await api({type:'gmgn:save',apiKey:'soak-fixture-not-real-key',addresses:{bsc:['0x'+'12'.repeat(20)]},defaultChain:'bsc'});
 await api({type:'binance:save',apiKey:'soakfixtureapikey12345678',secret:'soakfixturesecret12345678'});
 const pages=[];for(const url of ['https://gmgn.ai/?chain=bsc','https://www.binance.com/','https://idle.soak.test/','https://frozen.soak.test/']){const p=await context.newPage();await p.goto(url);await expect(p.locator('#trench-pet-root .hit')).toBeVisible();await p.evaluate(()=>window.soakDocumentToken=Math.random());pages.push(p);}
 const [gmgnPage,binancePage,idlePage,frozenPage]=pages,idleToken=await idlePage.evaluate(()=>window.soakDocumentToken);
 const frameCDP=await context.newCDPSession(frozenPage);cdp=await context.newCDPSession(gmgnPage);
 cdp.on('ServiceWorker.workerVersionUpdated',e=>{for(const v of e.versions){const i=versions.findIndex(x=>x.versionId===v.versionId);if(i<0)versions.push(v);else versions[i]=v;}});await cdp.send('ServiceWorker.enable');
 record('started',{minutes,isolated:true,sourceVersion:JSON.parse(await fs.readFile(path.join(source,'manifest.json'),'utf8')).version});await persist();
 while(Date.now()-began<minutes*60000){
  const cycleStart=Date.now();cycle++;const p=cycle%2?gmgnPage:binancePage,balance=String(cycle)+'.25';
  await worker.evaluate(async balance=>chrome.storage.local.set({soakFixture:{balance,pnl:Number(balance)%2?'2.3':'-2.3'}}),balance);
  await p.bringToFront();await p.locator('#trench-pet-root .hit').click();
  const bubble=p.locator('#trench-pet-root .bubble');await expect(bubble).toContainText(balance,{timeout:15000});await expect(bubble.locator('small')).not.toContainText('更新中',{timeout:15000});
  await bubble.locator('.bubble-close').click();
  await finishTask('soak'+cycle);await expect(bubble.locator('.grok-result-link')).toContainText('任务已完成',{timeout:10000});
  const other=cycle%2?binancePage:gmgnPage;await other.bringToFront();await expect(other.locator('#trench-pet-root .grok-result-link')).toContainText('任务已完成',{timeout:10000});
  await other.locator('#trench-pet-root .bubble-close').click();await expect.poll(async()=>(await api({type:'grok:inbox'})).events.length).toBe(0);
  if(cycle%5===0){
   await frameCDP.send('Page.setWebLifecycleState',{state:'frozen'});
   await finishTask('frozen'+cycle);await expect(other.locator('#trench-pet-root .grok-result-link')).toBeVisible({timeout:10000});await other.locator('#trench-pet-root .bubble-close').click();
   await frameCDP.send('Page.setWebLifecycleState',{state:'active'});record('frozen-tab-notification',{cycle});
  }
  if(cycle%7===0){
   await worker.evaluate(()=>chrome.storage.local.set({soakFixture:{hang:true}}));await p.bringToFront();await p.locator('#trench-pet-root .hit').click();
   await expect(bubble.locator('small')).toContainText('更新中',{timeout:5000});
   const before=await worker.evaluate(()=>soakBoot),version=versions.filter(v=>v.scriptURL===worker.url()&&v.runningStatus==='running').at(-1);expect(version).toBeTruthy();
   await cdp.send('ServiceWorker.stopWorker',{versionId:version.versionId});
   await api({type:'state:get'});expect(await worker.evaluate(()=>soakBoot)).not.toBe(before);
   await worker.evaluate(async balance=>chrome.storage.local.set({soakFixture:{balance}}),balance);
   await expect(bubble).toContainText(balance,{timeout:20000});await expect(bubble.locator('small')).not.toContainText('更新中',{timeout:20000});await bubble.locator('.bubble-close').click();record('actual-worker-restart',{cycle});
  }
  if(cycle%9===0){
   await api({type:'settings:patch',patch:{collapsed:true}});await finishTask('pocket'+cycle);
   await expect(other.locator('#trench-pet-root .bubble')).toBeHidden();await api({type:'settings:patch',patch:{collapsed:false}});await other.bringToFront();
   await expect(other.locator('#trench-pet-root .grok-result-link')).toBeVisible({timeout:10000});await other.locator('#trench-pet-root .bubble-close').click();record('pocket-retains-notification',{cycle});
  }
  expect(errors).toEqual([]);record('cycle-pass',{cycle,balance});await persist();
  await new Promise(r=>setTimeout(r,Math.max(0,30000-(Date.now()-cycleStart))));
 }
 await finishTask('idle999');await gmgnPage.bringToFront();await expect(gmgnPage.locator('#trench-pet-root .grok-result-link')).toBeVisible({timeout:10000});
 await idlePage.bringToFront();expect(await idlePage.evaluate(()=>window.soakDocumentToken)).toBe(idleToken);await expect(idlePage.locator('#trench-pet-root .grok-result-link')).toContainText('任务已完成',{timeout:10000});await idlePage.locator('#trench-pet-root .bubble-close').click();
 await api({type:'settings:patch',patch:{clickMode:'gmgn'}});await worker.evaluate(()=>chrome.storage.local.set({soakFixture:{balance:'999.75'}}));await idlePage.locator('#trench-pet-root .hit').click();await expect(idlePage.locator('#trench-pet-root .bubble')).toContainText('999.75',{timeout:15000});
 record('long-idle-page-restored-without-reload',{idleMinutes:Math.round((Date.now()-began)/60000),cycle});expect(errors).toEqual([]);
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({complete:true,startedAt:new Date(began).toISOString(),finishedAt:new Date().toISOString(),durationSeconds:Math.round((Date.now()-began)/1000),cycles:cycle,observations,errors,fixtureOnly:true},null,2));
 console.log('PASS extended soak completed');
}catch(error){errors.push(error.stack||error.message);await persist();throw error;}finally{await context?.close();}
