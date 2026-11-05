import {chromium,expect} from '@playwright/test';
import fs from 'node:fs/promises';import path from 'node:path';
const out=path.resolve('test-results/site-click-routing');await fs.mkdir(out,{recursive:true});
const run=await fs.mkdtemp(path.join(out,'run-')),extension=path.join(run,'extension'),profile=path.join(run,'profile');
await fs.cp('extension',extension,{recursive:true});
const bridge=path.join(extension,'grok-connection.js');await fs.writeFile(bridge,(await fs.readFile(bridge,'utf8')).replaceAll('com.trenchwhale.grok','com.trenchwhale.site_routing_unregistered'));
await fs.appendFile(path.join(extension,'background.js'),`
const routeOriginal=handle;globalThis.routeFixture={finance:[],posts:[]};
handle=async(message,sender)=>{
 if(/^(gmgn|binance):finance-(start|peek)$/.test(message.type)){
  routeFixture.finance.push({type:message.type,url:sender.tab?.url});
  return {finance:message.type.startsWith('gmgn:')?{chain:'bsc',symbol:'BNB',name:'BSC',count:1,balance:'3.5',pnl:'2',at:Date.now(),nextRefreshAt:Date.now()+60000,refreshing:false}:{at:Date.now(),refreshing:false,rows:[{label:'总资产估值',amount:'42',unit:'USDT'},{label:'今日总盈亏',amount:'-2',pnl:true,unit:'USDT'}]}};
 }
 if(message.type==='grok:research'){routeFixture.posts.push(message.post);return {task:{id:'routing-fixture',status:'accepted',botName:'测试 Bot',botUrl:'grokbot://app/v1/agent?id=routing-fixture'}};}
 return routeOriginal(message,sender);
};
`);
let context,worker,home;const passes=[],errors=[];
const pass=text=>{passes.push(text);console.log('PASS '+text);};
async function launch(){
 context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,viewport:{width:1280,height:1000},ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await context.route('https://**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Site routing fixture</title><article data-testid="tweet"><div data-testid="User-Name">Project <a href="/project">@project</a></div><div data-testid="tweetText">A test project with public information for research.</div><a href="/project/status/123"><time>now</time></a></article>'}));
 worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 home=await context.newPage();await home.goto(`chrome-extension://${new URL(worker.url()).host}/home.html#click-settings`);
}
const settings=()=>home.evaluate(async()=>(await chrome.runtime.sendMessage({type:'state:get'})).settings);
const patch=change=>home.evaluate(async patch=>{const result=await chrome.runtime.sendMessage({type:'settings:patch',patch});if(!result.ok)throw Error(result.error);},change);
const hit=p=>p.locator('#trench-pet-root .hit'),bubble=p=>p.locator('#trench-pet-root .bubble');
const click=async(p,n=1)=>{await p.bringToFront();for(let i=0;i<n;i++)await hit(p).click();};
const page=async(url)=>{const p=await context.newPage();await p.goto(url);await expect(hit(p)).toBeVisible();return p;};
try{
 await launch();await expect(home.locator('#click-mode')).toHaveValue('auto');await patch({interactionSound:false,energy:'quiet'});
 pass('A fresh install starts in automatic website mode');
 const gmgn=await page('https://gmgn.ai/?chain=bsc'),binance=await page('https://www.binance.com/en'),x=await page('https://x.com/project/status/123'),other=await page('https://ordinary.test/');
 await click(gmgn);await expect(bubble(gmgn)).toContainText('BNB余额：3.5');
 await click(binance);await expect(bubble(binance)).toContainText('总资产估值：42 USDT');await expect(bubble(binance)).not.toContainText('BNB余额');
 const count=await worker.evaluate(()=>routeFixture.finance.length);
 for(const p of [x,other]){await click(p);await expect(bubble(p)).toBeVisible();await expect(bubble(p).locator('.finance-row')).toHaveCount(0);}
 expect(await worker.evaluate(()=>routeFixture.finance.length)).toBe(count);
 await click(gmgn);await expect(bubble(gmgn)).toContainText('BNB余额：3.5');
 pass('After GMGN is clicked, Binance still shows Binance while X and ordinary pages remain companion-only');
 await patch({clickX:'grok'});await home.bringToFront();await home.goto(home.url().split('#')[0]+'#gmgn-settings');await home.locator('[data-click-site=gmgn]').click();
 expect((await settings()).clickMode).toBe('auto');expect((await settings()).clickX).toBe('grok');expect((await settings()).clickOther).toBe('companion');
 await home.locator('[data-account=binance]').click();await home.locator('[data-click-site=binance]').click();
 expect((await settings()).clickMode).toBe('auto');expect((await settings()).clickGmgn).toBe('gmgn');expect((await settings()).clickX).toBe('grok');
 await click(x);expect(await worker.evaluate(()=>routeFixture.posts.length)).toBe(0);await click(x,2);
 await expect(bubble(x)).toContainText('已发送任务');expect(await worker.evaluate(()=>routeFixture.posts.length)).toBe(1);
 await click(other);await expect(bubble(other).locator('.finance-row')).toHaveCount(0);
 pass('Account shortcuts keep independent site rules and X still requires three clicks before a simulated Bot task');
 const mimic=await page('https://gmgn.ai.fake.test/');await click(mimic);await expect(bubble(mimic).locator('.finance-row')).toHaveCount(0);
 pass('Lookalike domains cannot trigger an account query');
 // Simulate the persisted settings written by 0.5.24, then start a new worker/browser.
 await worker.evaluate(()=>chrome.storage.local.set({settings:{clickMode:'gmgn',clickX:'grok',xResearchClicks:4,size:210,interactionSound:false,energy:'quiet'}}));
 await context.close();await launch();await expect(home.locator('#click-mode')).toHaveValue('auto');
 const migrated=await settings();expect(migrated.clickX).toBe('grok');expect(migrated.xResearchClicks).toBe(4);expect(migrated.size).toBe(210);
 expect(await worker.evaluate(async()=>(await chrome.storage.local.get('settings')).settings.clickRoutingVersion)).toBe(1);
 const repaired=await page('https://www.binance.com/en');await click(repaired);await expect(bubble(repaired)).toContainText('总资产估值：42 USDT');
 pass('Upgrade repairs persisted legacy global GMGN mode without losing website or companion preferences');
 await home.bringToFront();await home.locator('#click-mode').selectOption('gmgn');await context.close();await launch();
 await expect(home.locator('#click-mode')).toHaveValue('gmgn');
 const fixed=await page('https://ordinary.test/');await click(fixed);await expect(bubble(fixed)).toContainText('BNB余额：3.5');
 pass('An intentionally selected fixed mode in the new version survives restart');
 expect(errors).toEqual([]);await fs.writeFile(path.join(out,'report.json'),JSON.stringify({passes,errors,fixtureOnly:true,realApi:false,realBot:false,physicalMacTest:false},null,2));
}finally{await context?.close();}
