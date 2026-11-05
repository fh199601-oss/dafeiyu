import {chromium,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const output=path.resolve('test-results/notification-interactions');await fs.mkdir(output,{recursive:true});
const run=await fs.mkdtemp(path.join(output,'run-')),extension=path.join(run,'extension');await fs.cp('extension',extension,{recursive:true});
const bridge=path.join(extension,'grok-connection.js');await fs.writeFile(bridge,(await fs.readFile(bridge,'utf8')).replaceAll('com.trenchwhale.grok','com.trenchwhale.notification_fixture'));
const context=await chromium.launchPersistentContext(path.join(run,'profile'),{channel:'msedge',headless:true,viewport:{width:1280,height:900},ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
const failures=[],passes=[],errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
async function check(name,fn){try{await fn();passes.push(name);console.log('PASS '+name);}catch(e){failures.push({name,error:e.message});console.log('FAIL '+name);}}
try{
 await context.route('https://notification.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Notification interaction fixture</title>'}));
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
 const home=await context.newPage();await home.goto(`chrome-extension://${id}/home.html`);
 await home.evaluate(()=>chrome.runtime.sendMessage({type:'settings:patch',patch:{clickMode:'companion',energy:'quiet',interactionSound:false}}));
 const page=await context.newPage();await page.goto('https://notification.test/');await page.bringToFront();await expect(page.locator('#trench-pet-root .hit')).toBeVisible();
 const bubble=page.locator('#trench-pet-root .bubble');
 async function inbox(ids,revision){await home.evaluate(({ids,revision})=>chrome.storage.local.set({grokNotificationInbox:{version:1,revision,connectionId:'fixture',items:ids.map((id,i)=>({id,status:'completed',botName:'研究助手',botUrl:'grokbot://app/v1/agent?id=fixture-'+id,title:'项目 '+id,summary:'研究完成',createdAt:Date.now()-1000,finishedAt:Date.now()+i,readAt:0}))}}),{ids,revision});}
 await inbox(['first'],1);await expect(bubble).toBeVisible();await expect(bubble.locator('small')).toContainText('1 条未读');
 await inbox(['first','second'],2);
 await check('New completion updates unread count without interrupting the current project',async()=>{await expect(bubble.locator('small')).toContainText('2 条未读',{timeout:2000});await expect(bubble.locator('.grok-result-link')).toHaveAttribute('href','grokbot://app/v1/agent?id=fixture-first');});
 await home.evaluate(()=>chrome.runtime.sendMessage({type:'binance:save',apiKey:'fixtureapikey12345678',secret:'fixturesecret12345678'}));
 await check('Saving an unrelated account must not hide an unread research notification',async()=>{await expect(bubble).toBeVisible({timeout:1000});});
 // A local close is an explicit read, including while another task just arrived.
 await page.reload();await expect(page.locator('#trench-pet-root .grok-result-link')).toBeVisible();await bubble.locator('.bubble-close').click();
 await check('Closing one notification immediately advances to the other unread project',async()=>{await expect(bubble).toBeVisible({timeout:2500});await expect(bubble.locator('small')).toContainText('1 条未读');});
 await home.evaluate(()=>chrome.runtime.sendMessage({type:'settings:patch',patch:{excludedSites:['notification.test']}}));
 await inbox(['third'],9);await home.evaluate(()=>chrome.runtime.sendMessage({type:'settings:patch',patch:{excludedSites:[]}}));
 await check('A completion received while a site is excluded appears when accompaniment resumes',async()=>{await expect(bubble).toBeVisible();await expect(bubble.locator('.grok-result-link')).toHaveAttribute('href','grokbot://app/v1/agent?id=fixture-third');});
  await bubble.screenshot({path:path.join(output,'completed-notification.png'),animations:'disabled'});
  await page.setViewportSize({width:320,height:240});
  await home.evaluate(()=>chrome.storage.local.set({grokNotificationInbox:{version:1,revision:10,connectionId:'fixture',items:[{id:'long-name',status:'completed',botName:'W'.repeat(80),botUrl:'grokbot://app/v1/agent?id=fixture',title:'需要阅读的一份项目报告'.repeat(8),createdAt:Date.now()-1000,finishedAt:Date.now(),readAt:0}]}}));
  await check('Long Bot names keep the unread count, close button, and report link inside a short narrow viewport',async()=>{
    await expect(bubble.locator('small')).toContainText('1 条未读');
    const boxes=await bubble.evaluate(n=>{const r=n.getBoundingClientRect();return {right:r.right,bottom:r.bottom,width:n.clientWidth,scrollWidth:n.scrollWidth,visibleHeight:innerHeight};});
    expect(boxes.right).toBeLessThanOrEqual(320);expect(boxes.bottom).toBeLessThanOrEqual(240);expect(boxes.scrollWidth).toBeLessThanOrEqual(boxes.width+1);
  });
  await home.evaluate(async()=>{await chrome.storage.local.set({grokNotificationInbox:{version:1,revision:11,connectionId:'fixture',items:[]}});await chrome.runtime.sendMessage({type:'settings:patch',patch:{clickMode:'binance',binanceView:'assets'}});});
  await worker.evaluate(()=>{globalThis.fetch=async input=>Response.json(new URL(input).pathname.endsWith('/time')?{serverTime:Date.now()}:[{walletName:'Spot',balance:'123456789.12',activate:true}]);});
  await page.locator('#trench-pet-root .hit').click();await expect(bubble).toContainText('123456789.12',{timeout:8000});
  await check('Large financial values remain completely readable without overflowing the two metric items',async()=>{
    const sizes=await bubble.evaluate(n=>({width:n.clientWidth,scrollWidth:n.scrollWidth,rows:n.querySelectorAll('.finance-row').length}));expect(sizes.rows).toBe(2);expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.width+1);
  });
 await page.screenshot({path:path.join(output,'notification.png')});
 expect(errors).toEqual([]);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passes,failures,errors},null,2));expect(failures).toEqual([]);
}finally{await context.close();}
