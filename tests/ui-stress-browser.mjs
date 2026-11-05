import {chromium,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const output=path.resolve('test-results/ui-stress',process.env.UI_REVIEW_PHASE||'after');
await fs.mkdir(output,{recursive:true});
const run=await fs.mkdtemp(path.join(output,'run-')),extension=path.join(run,'extension');
await fs.cp('extension',extension,{recursive:true});
const bridge=path.join(extension,'grok-connection.js');
await fs.writeFile(bridge,(await fs.readFile(bridge,'utf8')).replaceAll('com.trenchwhale.grok','com.trenchwhale.ui_stress_unregistered'));
const context=await chromium.launchPersistentContext(path.join(run,'profile'),{channel:'msedge',headless:true,viewport:{width:1280,height:500},ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
const errors=[],audits=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const id=new URL(worker.url()).host;
 await worker.evaluate(async()=>{
  globalThis.uiConnection={installed:false,configured:false,tasks:[],events:[],error:'连接组件未找到，请检查安装包是否完整后重新安装。'};
  grok.status=async()=>uiConnection;
  await chrome.storage.local.set({settings:{enabled:true,energy:'quiet',reducedMotion:true,clickMode:'auto',excludedSites:['w'.repeat(63)+'.example']},wallets:Array.from({length:30},(_,n)=>({id:'ui-wallet-'+n,chain:'bsc',kind:'watch',label:'W'.repeat(24),address:'0x'+String(n+1).padStart(40,'0')}))});
  const addresses=Array.from({length:20},(_,n)=>'0x'+String(n+1).padStart(40,'0'));
  const manual=TrenchFinance.manualWallets(Object.fromEntries(Object.keys(TrenchFinance.CHAINS).filter(c=>c!=='sol').map(c=>[c,addresses])),'bsc');
  gmgn.status=async()=>({configured:true,manualWallets:manual,last:null});
  gmgn.test=async()=>{await new Promise(r=>setTimeout(r,1800));throw Error('上游数据接口暂时不可用，请稍后重试。此处为隔离界面测试，没有连接真实账户。');};
  binance.status=async()=>({configured:true});
  binance.finance=async()=>{await new Promise(r=>setTimeout(r,900));return{rows:[{label:'总资产',amount:0,unit:'USDT'},{label:'今日盈亏估算（UTC）',amount:12.3,pnl:true,unit:'USDT'}],scope:'隔离展示样例：现货及 USDT 合约，不连接实际账户。'};};
 });
 const page=await context.newPage();await page.goto(`chrome-extension://${id}/home.html#grok-settings`);await expect(page.locator('#grok-badge')).toHaveText('待安装组件');
 await worker.evaluate(()=>chrome.storage.local.set({settings:{enabled:true,energy:'quiet',reducedMotion:true,clickMode:'auto',excludedSites:['w'.repeat(63)+'.example']},wallets:Array.from({length:30},(_,n)=>({id:'ui-wallet-'+n,chain:'bsc',kind:'watch',label:'W'.repeat(24),address:'0x'+String(n+1).padStart(40,'0')}))}));
 await expect(page.locator('#wallet-count')).toHaveText('30');
 async function shot(name,{fullPage=false}={}){
  await page.screenshot({path:path.join(output,name+'.png'),fullPage,animations:'disabled'});
  audits.push(await page.evaluate(name=>({name,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,sidebarScroll:document.querySelector('.sidebar')?.scrollHeight,sidebarHeight:document.querySelector('.sidebar')?.clientHeight,active:document.activeElement?.id,visibleOutside:[...document.querySelectorAll('main button,main input,main select,main textarea,.grok-task,.wallet-item')].filter(n=>n.getClientRects().length).filter(n=>{const r=n.getBoundingClientRect();return r.right>innerWidth+1||r.left<0;}).slice(0,12).map(n=>({id:n.id,cls:n.className,text:n.textContent.slice(0,30)}))}),name));
 }
 await shot('new-user-short-window');
 await page.locator('#show-install').focus();await shot('keyboard-last-menu-short-window');
 await expect(page.locator('#show-install')).toBeInViewport();await page.keyboard.press('Enter');await expect(page.locator('#tab-install')).toBeVisible();
 await page.setViewportSize({width:320,height:760});await page.locator('[data-tab=actions]').click();await shot('actions-320',{fullPage:true});
 await page.locator('[data-tab=settings]').click();await shot('preferences-320',{fullPage:true});
 for(const name of ['position-help','motion-help']){
  const trigger=page.locator(`[aria-describedby=${name}]`);await trigger.focus();await trigger.scrollIntoViewIfNeeded();await shot(name+'-320');
  const bounds=await page.locator('#'+name).boundingBox();assert(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=320&&bounds.y+bounds.height<=760);
  await trigger.press('Escape');await expect(page.locator('#'+name)).toBeHidden();await page.keyboard.press('Tab');
  await trigger.evaluate(el=>{el.scrollIntoView({block:'end',behavior:'instant'});el.focus({preventScroll:true});});
  await expect(trigger.locator('..')).toHaveAttribute('data-above','true');
  await shot(name+'-near-bottom-320');
  const flipped=await page.locator('#'+name).boundingBox();assert(flipped.y>=0&&flipped.y+flipped.height<=760);
  await trigger.press('Escape');await page.keyboard.press('Tab');
 }
 await page.locator('[data-tab=watch]').click();await page.locator('.wallet-item').first().scrollIntoViewIfNeeded();await shot('wallets-long-labels-320');
 await page.locator('[data-tab=finance]').click();await page.locator('#gmgn-addresses').scrollIntoViewIfNeeded();await shot('wallet-settings-320');
 await page.locator('#gmgn-test').click();await shot('wallet-loading-320');await expect(page.locator('#gmgn-feedback')).toContainText('上游数据接口暂时不可用');await shot('wallet-error-320');
 await expect(page.locator('#gmgn-inline-feedback')).toContainText('上游数据接口暂时不可用');
 await page.locator('[data-account=binance]').click();await page.locator('#binance-test').click();await expect(page.locator('#binance-inline-feedback')).toContainText('正在查询');await shot('binance-loading-320');
 await expect(page.locator('#binance-feedback')).toContainText('12.3');await expect(page.locator('#binance-inline-feedback')).toContainText('查询成功');await page.locator('#binance-feedback').scrollIntoViewIfNeeded();await shot('binance-zero-and-profit-320');
 await page.locator('[data-tab=ai]').click();await page.locator('#grok-feedback').scrollIntoViewIfNeeded();await shot('bot-connection-failure-320');
 await worker.evaluate(()=>{uiConnection={installed:true,configured:false,pair:{stage:'preparing'},tasks:[],events:[]};});
 await page.locator('#grok-detect').click();await expect(page.locator('#grok-feedback')).toContainText('正在建立连接');await expect(page.locator('#grok-pair')).toBeDisabled();await shot('bot-connection-preparing-320');
 await worker.evaluate(()=>{uiConnection={installed:true,configured:false,pair:{stage:'needs-attention',error:'示例：请切回正在配对的 Bot，再继续连接。'},prompt:'这是隔离界面测试用的配对说明，不包含任何有效链接或真实连接资料。',tasks:[],events:[]};});
 await page.locator('#grok-detect').click();await expect(page.locator('#grok-retry')).toBeVisible();await expect(page.locator('#grok-cancel')).toBeVisible();await expect(page.locator('#grok-pair-box')).toBeVisible();await page.locator('#grok-feedback').scrollIntoViewIfNeeded();await shot('bot-connection-retry-320');
 await worker.evaluate(async()=>{
  const now=Date.now(),name='ResearchAssistant'+'W'.repeat(63);
  const tasks=Array.from({length:25},(_,n)=>({id:'ui-stress-task-'+n,title:'研究 '+n+' · 长项目标题用于观察在窄窗口中的分行与信息边界',botName:name,status:n%3?'completed':'failed',createdAt:now-n*60000,finishedAt:now,botUrl:'grokbot://app/v1/agent?id=ui-stress-bot',summary:n%3?'这份示例报告包含项目资料、近期热度和待验证条件。'.repeat(8):'研究暂未完成：测试网络连接中断，请在 Bot 中检查任务。'}));
  uiConnection={installed:true,configured:true,bot:{id:'ui-stress-bot',name},tasks,events:[]};await grokInbox.ingest('ui-stress-bot',[],tasks);
 });
 await page.locator('[data-tab=ai]').click();await page.locator('#grok-detect').click();await expect(page.locator('.grok-task')).toHaveCount(20);
 const focusLink=page.locator('.grok-task').first().locator('a');await focusLink.focus();
 await page.evaluate(()=>document.getElementById('grok-detect').click());
 await expect(focusLink).toBeFocused();
 const firstTask=page.locator('.grok-task').first();await firstTask.locator('button').focus();await page.keyboard.press('Enter');
 await expect(firstTask.locator('button')).toHaveCount(0);await expect(firstTask.locator('a')).toBeFocused();
 await shot('paired-long-name-320');await page.locator('.grok-task').first().scrollIntoViewIfNeeded();await shot('research-cards-320');
 await page.setViewportSize({width:390,height:844});await page.locator('[data-tab=ai]').click();await shot('paired-long-name-390');await page.locator('.grok-task').first().scrollIntoViewIfNeeded();await shot('research-cards-390');
 await page.setViewportSize({width:720,height:450});await page.locator('[data-tab=settings]').click();await shot('zoom-200-equivalent-settings');await page.locator('[data-tab=ai]').click();await shot('zoom-200-equivalent-ai');
 const popup=await context.newPage();await popup.setViewportSize({width:320,height:330});await popup.goto(`chrome-extension://${id}/popup.html`);await expect(popup.locator('#enabled')).toBeChecked();
 await popup.screenshot({path:path.join(output,'popup-320.png'),fullPage:true,animations:'disabled'});
 const popupAudit=await popup.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}));
 const keyboard=[];await popup.keyboard.press('Tab');for(let n=0;n<8;n++){keyboard.push(await popup.evaluate(()=>({id:document.activeElement.id,tag:document.activeElement.tagName,visible:!!document.activeElement.getClientRects().length})));await popup.keyboard.press('Tab');}
 await fs.writeFile(path.join(output,'audit.json'),JSON.stringify({audits,popupAudit,keyboard,errors,fixtureOnly:true,realAccount:false,osExecution:false},null,2));
 assert.deepEqual(errors,[]);
 assert(audits.every(a=>a.scrollWidth<=a.width+1),'No long fixture content may force horizontal page scrolling');
 assert.equal(popupAudit.scrollWidth,320);assert(popupAudit.height<=330);
 console.log(JSON.stringify({auditFile:path.join(output,'audit.json'),cases:audits.length,overflowCases:audits.filter(a=>a.scrollWidth>a.width+1).map(a=>a.name),popupAudit,errors}));
}finally{await context.close();}
