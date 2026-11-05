import {chromium,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

// This must be the browser's action popup, never popup.html in an ordinary tab.
// No viewport emulation is applied to the context or the popup page.
const output=path.resolve('test-results/popup-real',process.env.POPUP_PHASE||'current');
await fs.mkdir(output,{recursive:true});
const run=await fs.mkdtemp(path.join(output,'run-')),extension=path.join(run,'extension');
await fs.cp(process.env.POPUP_EXTENSION_SOURCE||'extension',extension,{recursive:true});
const bridge=path.join(extension,'grok-connection.js');
await fs.writeFile(bridge,(await fs.readFile(bridge,'utf8')).replaceAll('com.trenchwhale.grok','com.trenchwhale.popup_test_unregistered'));
const popupHtml=await fs.readFile(path.join(extension,'popup.html'),'utf8');
const stylesheet=popupHtml.match(/rel="stylesheet" href="([^"]+)"/)[1];
const sourceHash=createHash('sha256').update(popupHtml).update(await fs.readFile(path.join(extension,stylesheet))).update(await fs.readFile(path.join(extension,'popup.js'))).digest('hex');
const context=await chromium.launchPersistentContext(path.join(run,'profile'),{...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{channel:process.platform==='win32'?'msedge':'chromium'}),headless:true,viewport:null,ignoreDefaultArgs:['--disable-extensions'],args:['--window-size=1280,900',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
await context.route('https://popup-fixture.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><title>工具栏隔离测试</title><p>本页由测试本机提供，不访问外部服务。</p>'}));
const errors=[],report={sourceHash,actualActionPopup:true,viewportEmulated:false,realApi:false,nativeBot:false};
context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const extensionId=new URL(worker.url()).host;
 // First-install opens options asynchronously; let it finish so it cannot steal
 // focus and immediately dismiss the real toolbar popup under test.
 await expect.poll(()=>context.pages().some(page=>page.url().includes('/home.html'))).toBe(true);
 const main=context.pages().find(page=>page.url().includes('/home.html'));
 await expect(main.locator('#breadcrumb')).toBeVisible();await main.goto('https://popup-fixture.test/');
 const cdp=await context.newCDPSession(main);
 const commands=new Map();let nextCommand=1,rawSession,attaching=false;
 cdp.on('Target.receivedMessageFromTarget',({message})=>{const value=JSON.parse(message);if(value.method==='Runtime.exceptionThrown')errors.push(value.params.exceptionDetails.exception?.description||value.params.exceptionDetails.text);if(!value.id)return;const pending=commands.get(value.id);if(!pending)return;commands.delete(value.id);clearTimeout(pending.timer);value.error?pending.reject(Error(value.error.message)):pending.resolve(value.result);});
 const raw=(method,params={})=>new Promise((resolve,reject)=>{const id=nextCommand++,timer=setTimeout(()=>{commands.delete(id);reject(Error('Popup CDP command timed out: '+method));},5000);commands.set(id,{resolve,reject,timer});cdp.send('Target.sendMessageToTarget',{sessionId:rawSession,message:JSON.stringify({id,method,params})}).catch(error=>{clearTimeout(timer);commands.delete(id);reject(error);});});
 const evaluate=async expression=>{const value=await raw('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(value.exceptionDetails)throw Error(value.exceptionDetails.text);return value.result.value;};
 let attachResolve;const attached=new Promise(resolve=>{attachResolve=resolve;});
 report.targetEvents=[];
 cdp.on('Target.targetCreated',async({targetInfo})=>{
  report.targetEvents.push({event:'created',type:targetInfo.type,url:targetInfo.url});
  if(targetInfo.type==='other'&&!attaching){attaching=true;try{const result=await cdp.send('Target.attachToTarget',{targetId:targetInfo.targetId,flatten:false});rawSession=result.sessionId;attachResolve(true);}catch(error){report.attachError=error.message;attachResolve(false);}}
 });
 cdp.on('Target.targetInfoChanged',({targetInfo})=>report.targetEvents.push({event:'changed',type:targetInfo.type,url:targetInfo.url}));
 await cdp.send('Target.setDiscoverTargets',{discover:true});
 report.openResult=await worker.evaluate(async()=>{
  try{const windows=await chrome.windows.getAll();const selected=windows.find(window=>window.focused)||windows[0];await chrome.action.openPopup({windowId:selected.id});return{ok:true,windowId:selected.id};}
  catch(error){return{ok:false,error:error.message};}
 });
 let attachTimer;
 const hasRaw=await Promise.race([attached,new Promise(resolve=>{attachTimer=setTimeout(()=>resolve(false),8000);})]);clearTimeout(attachTimer);
 if(!hasRaw)throw Error('The browser did not expose an action popup target: '+JSON.stringify(report.openResult));
 await raw('Runtime.enable');await raw('Page.enable');
 await evaluate('(async()=>{if(document.readyState!=="complete")await new Promise(r=>addEventListener("load",r,{once:true}));await document.fonts.ready;const deadline=Date.now()+2000;while(document.getElementById("enabled").disabled&&Date.now()<deadline)await new Promise(r=>setTimeout(r,16));if(document.getElementById("enabled").disabled)throw Error("Popup settings stayed unavailable");await new Promise(r=>setTimeout(r,220));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true;})()');
 report.dimensions=await evaluate(`({
  url:location.href,popupView:chrome.extension.getViews({type:'popup'}).includes(window),
  width:innerWidth,height:innerHeight,dpr:devicePixelRatio,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,
  bodyWidth:document.body.getBoundingClientRect().width,bodyMaxWidth:getComputedStyle(document.body).maxWidth,
  switchChecked:document.getElementById('enabled').checked,switchBefore:getComputedStyle(document.getElementById('enabled'),'::before').transform,switchAfter:getComputedStyle(document.getElementById('enabled'),'::after').transform,
  controls:[...document.querySelectorAll('button,input')].map(node=>{const r=node.getBoundingClientRect();return{id:node.id,disabled:node.disabled,left:r.left,top:r.top,right:r.right,bottom:r.bottom};})
 })`);
 const shot=await raw('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'action-popup.png'),Buffer.from(shot.data,'base64'));
 report.supported=true;
 assert.equal(report.dimensions.url,`chrome-extension://${extensionId}/popup.html`);assert.equal(report.dimensions.popupView,true);
 report.errors=errors;
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
 if(process.env.POPUP_CAPTURE_ONLY==='1')process.exitCode=0;
 else{
  const d=report.dimensions;
  assert(d.width>=318&&d.width<=322,'The actual toolbar popup should have a stable 320px width');
  assert(d.height<=380,'The actual toolbar popup should remain compact');
  assert(d.scrollWidth<=d.width&&d.scrollHeight<=d.height,'The actual toolbar popup must not need scrolling');
  assert(d.controls.every(b=>b.left>=0&&b.top>=0&&b.right<=d.width&&b.bottom<=d.height),'Every control must be fully inside the actual popup');
  assert.equal(d.controls.find(b=>b.id==='toggle-site').disabled,false,'A regular allowed page must enable its site preference button');
  assert(d.switchChecked&&[d.switchBefore,d.switchAfter].some(value=>/matrix\(1, 0, 0, 1, (?:14|16), 0\)/.test(value)),'Wait for the enabled switch knob to settle on the right');
  assert.deepEqual(errors,[]);
  await evaluate('document.getElementById("enabled").click()');await expect.poll(()=>worker.evaluate(async()=>(await chrome.storage.local.get('settings')).settings.enabled)).toBe(false);
  await evaluate('document.getElementById("enabled").click();document.getElementById("size").value="205";document.getElementById("size").dispatchEvent(new Event("change"))');
  await expect.poll(()=>worker.evaluate(async()=>(await chrome.storage.local.get('settings')).settings.size)).toBe(205);
  await evaluate('document.getElementById("toggle-site").click()');await expect.poll(()=>worker.evaluate(async()=>(await chrome.storage.local.get('settings')).settings.excludedSites.includes('popup-fixture.test'))).toBe(true);
  await evaluate('document.getElementById("toggle-site").click()');await expect.poll(()=>worker.evaluate(async()=>(await chrome.storage.local.get('settings')).settings.excludedSites.includes('popup-fixture.test'))).toBe(false);
  report.controlsSaved=true;await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log('PASS Actual chrome.action.openPopup target fits without viewport emulation or scrolling, and controls save');
 }
}catch(error){report.failure=error.message;report.errors=errors;await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));throw error;}
finally{await context.close();}
