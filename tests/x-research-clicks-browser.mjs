import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// Exercise the actual content scripts and settings in an isolated browser.
// Only the outgoing Bot/finance message boundary is replaced; no real task is sent.
const output=path.resolve('test-results/x-research-clicks');
await fs.mkdir(output,{recursive:true});
const run=await fs.mkdtemp(path.join(output,'run-')),extension=path.join(run,'extension');
await fs.cp('extension',extension,{recursive:true});
const bridge=path.join(extension,'grok-connection.js');
await fs.writeFile(bridge,(await fs.readFile(bridge,'utf8')).replaceAll('com.trenchwhale.grok','com.trenchwhale.x_click_fixture_unregistered'));
await fs.appendFile(path.join(extension,'background.js'),`
const clicksOriginalHandle=handle;
globalThis.clicksFixture={posts:[],hold:false,release:null,finance:[]};
handle=async(message,sender)=>{
  if(message.type==='grok:research'){
    clicksFixture.posts.push(message.post);
    const task={id:'click-fixture-'+clicksFixture.posts.length,status:'accepted',botName:'隔离测试',botUrl:'grokbot://app/v1/agent?id=click-fixture'};
    if(clicksFixture.hold)return new Promise(resolve=>{clicksFixture.release=()=>resolve({task});});
    return {task};
  }
  if(/^(gmgn|binance):finance-(start|peek)$/.test(message.type)){
    clicksFixture.finance.push(message.type);
    return {finance:message.type.startsWith('gmgn:')?
      {chain:'bsc',symbol:'BNB',name:'BSC',count:1,balance:'3.5',pnl:'2',at:Date.now(),refreshing:false}:
      {view:'daily-pnl',at:Date.now(),refreshing:false,rows:[{label:'总资产',amount:'42',unit:'USDT'},{label:'今日估算',amount:'-2',pnl:true,unit:'USDT'}]}};
  }
  return clicksOriginalHandle(message,sender);
};
`);
const context=await chromium.launchPersistentContext(path.join(run,'profile'),{
  channel:'msedge',headless:true,viewport:{width:1280,height:950},
  ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]
});
const passes=[],errors=[];let completed=false,failure='',worker,home,x;
const pass=label=>{passes.push(label);console.log('PASS '+label);};
context.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));
const hit=page=>page.locator('#trench-pet-root .hit');
const bubble=page=>page.locator('#trench-pet-root .bubble');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const total=()=>worker.evaluate(()=>clicksFixture.posts.length);
async function click(page,n=1){for(let i=0;i<n;i++)await hit(page).click();}
async function count(expected){await expect.poll(total).toBe(expected);}
async function unchanged(expected){await sleep(100);assert.equal(await total(),expected);}
async function visibility(page,hidden){
  await worker.evaluate(async({url,hidden})=>{
    const tab=(await chrome.tabs.query({})).find(t=>t.url===url);
    await chrome.scripting.executeScript({target:{tabId:tab.id},func:hidden=>{
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});
      document.dispatchEvent(new Event('visibilitychange'));
    },args:[hidden]});
  },{url:page.url(),hidden});
}
async function patch(value){const result=await home.evaluate(patch=>chrome.runtime.sendMessage({type:'settings:patch',patch}),value);assert.equal(result.ok,true);await sleep(60);}
async function fresh(threshold=3,url='https://x.com/project/status/123'){
  await patch({xResearchClicks:threshold,clickMode:'auto',clickX:'grok'});
  await x.goto(url);await x.bringToFront();await expect(hit(x)).toBeVisible();
}
try{
  await context.route('https://x.com/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><style>article{margin:24px;padding:24px;max-width:600px;border:1px solid #abc}</style>
    <article data-testid="tweet" id="first"><div data-testid="User-Name">作者甲 @project</div><a role="link" href="/project/status/123"><time>现在</time></a><div data-testid="tweetText">项目甲：这是点击门槛测试，不发送到真实 Bot。</div></article>
    <article data-testid="tweet" id="second"><div data-testid="User-Name">作者乙 @other</div><a role="link" href="/other/status/456"><time>刚刚</time></a><div data-testid="tweetText">项目乙：信息流里选择的帖子。</div></article>`}));
  for(const origin of ['https://gmgn.ai','https://www.binance.com'])await context.route(origin+'/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Isolated account fixture</title>'}));
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).host;
  home=await context.newPage();await home.goto(`chrome-extension://${id}/home.html`);
  await patch({clickMode:'auto',clickX:'grok',energy:'quiet',interactionSound:false,sound:false});
  await expect(home.locator('#grok-research-clicks')).toHaveValue('3');
  x=await context.newPage();await x.goto('https://x.com/project/status/123');await expect(hit(x)).toBeVisible();
  await click(x);await unchanged(0);await expect(bubble(x)).toBeVisible();
  await click(x);await unchanged(0);await click(x);await count(1);
  await expect(bubble(x)).toContainText('已发送任务');
  assert.equal(await worker.evaluate(()=>clicksFixture.posts[0].url),'https://x.com/project/status/123');
  pass('An existing configuration without a threshold defaults to three clicks; first and second clicks only pet');

  await fresh();let base=await total();
  await click(x);await sleep(900);await click(x);await sleep(900);await click(x);await unchanged(base);
  await click(x,2);await count(base+1);
  pass('The 1.5-second deadline starts with the first click; successive short gaps cannot extend it');
  await fresh();base=await total();
  await click(x,2);await sleep(1600);await click(x);await unchanged(base);await click(x,2);await count(base+1);
  pass('An expired two-click sequence starts again at one instead of sending');

  for(const threshold of [1,2,4,5]){
    await fresh(threshold);base=await total();
    if(threshold>1){await click(x,threshold-1);await unchanged(base);}
    await click(x);await count(base+1);await expect(bubble(x)).toContainText('已发送任务');
  }
  pass('All configurable thresholds from one to five are honored');

  await home.bringToFront();await home.locator('[data-tab="ai"]').click();
  await home.locator('#grok-research-clicks').selectOption('2');
  await expect(home.locator('#x-research-clicks')).toHaveValue('2');
  await home.locator('[data-tab="settings"]').click();await expect(home.locator('#x-research-click-setting')).toBeVisible();
  await home.locator('#x-research-clicks').selectOption('4');await expect(home.locator('#grok-research-clicks')).toHaveValue('4');
  await home.reload();await expect(home.locator('#x-research-clicks')).toHaveValue('4');
  await home.locator('[data-tab="ai"]').click();await expect(home.locator('#grok-research-clicks')).toHaveValue('4');
  await home.locator('#grok-research-clicks').selectOption('3');
  await home.locator('#grok-click-help').scrollIntoViewIfNeeded();
  await home.screenshot({path:path.join(output,'ai-click-setting.png')});
  await home.locator('[data-tab="settings"]').click();await home.locator('#x-research-click-setting').scrollIntoViewIfNeeded();
  await home.screenshot({path:path.join(output,'companion-click-setting.png')});
  pass('Both settings entries save the same preference, synchronize, and persist after reload');

  await fresh(3,'https://x.com/home');base=await total();await click(x);
  await expect(bubble(x)).not.toContainText('点一下要研究');await unchanged(base);
  await click(x,2);await expect(bubble(x)).toContainText('点一下要研究的帖子');await unchanged(base);
  await x.locator('#second [data-testid="tweetText"]').click();await count(base+1);
  assert.equal(await worker.evaluate(()=>clicksFixture.posts.at(-1).url),'https://x.com/other/status/456');
  pass('The timeline waits for the threshold before entering selection and sends only the selected post');

  await fresh(3,'https://x.com/home');base=await total();await click(x,3);
  await expect(bubble(x)).toContainText('5 秒未选择自动退出');
  await x.locator('#first').hover();await sleep(4400);await expect(bubble(x)).toBeVisible();
  await expect(bubble(x)).toBeHidden({timeout:1800});await unchanged(base);
  await x.locator('#first [data-testid="tweetText"]').click();await unchanged(base);
  await click(x,3);await expect(bubble(x)).toContainText('点一下要研究的帖子');
  await x.keyboard.press('Escape');await expect(bubble(x)).toBeHidden({timeout:500});await unchanged(base);
  await sleep(3000);await click(x,3);await expect(bubble(x)).toBeVisible();
  await sleep(2200);await expect(bubble(x)).toContainText('点一下要研究的帖子');await unchanged(base);
  await x.locator('#second [data-testid="tweetText"]').click();await count(base+1);
  await expect(bubble(x)).toContainText('已发送任务');
  pass('The selection bubble expires at five seconds; immediate Escape and restarting cannot leak an old timer or submit a task');

  await fresh(3,'https://x.com/home');base=await total();await click(x,3);
  await expect(bubble(x)).toContainText('点一下要研究的帖子');await bubble(x).locator('.bubble-close').click();
  await x.locator('#first [data-testid="tweetText"]').click();await unchanged(base);
  await click(x,3);await x.locator('#first [data-testid="tweetText"]').click();await count(base+1);
  pass('Closing the selection hint releases the page and allows a new selection immediately');

  await fresh();base=await total();await click(x,2);
  await x.evaluate(()=>history.pushState({},'', '/other/status/456'));
  await click(x);await unchanged(base);await click(x,2);await count(base+1);
  assert.equal(await worker.evaluate(()=>clicksFixture.posts.at(-1).url),'https://x.com/other/status/456');
  pass('SPA navigation to a different post resets the pending sequence');

  await fresh();base=await total();await click(x,2);
  await patch({xResearchClicks:2});await click(x);await unchanged(base);await click(x);await count(base+1);
  pass('Changing the threshold discards an unfinished sequence');

  for(const reset of ['drag','escape','menu','blur','hidden']){
    await fresh();base=await total();await click(x,2);
    if(reset==='drag'){
      const box=await hit(x).boundingBox(),px=box.x+box.width/2,py=box.y+box.height/2;
      await x.mouse.move(px,py);await x.mouse.down();await x.mouse.move(px-40,py-25,{steps:5});await x.mouse.up();
    }else if(reset==='escape')await x.keyboard.press('Escape');
    else if(reset==='menu'){await hit(x).click({button:'right'});await x.locator('#trench-pet-root .menu-head button').click();}
    else if(reset==='blur'){await x.evaluate(()=>window.dispatchEvent(new Event('blur')));}
    else{
      await worker.evaluate(async url=>{
        const tab=(await chrome.tabs.query({})).find(t=>t.url===url);
        await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{
          Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));
          delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));
        }});
      },x.url());
    }
    await click(x);await unchanged(base);await click(x,2);await count(base+1);
  }
  pass('Dragging, Escape, the action menu, blur, and hiding the page reset the sequence');

  await fresh();base=await total();await click(x,2);
  // Headless Edge keeps all tabs visible; deliver the browser's tab lifecycle explicitly.
  await visibility(x,true);
  const other=await context.newPage();await other.goto('https://x.com/other/status/456');await other.bringToFront();
  await expect(hit(other)).toBeVisible();await click(other);await unchanged(base);
  await visibility(other,true);await visibility(x,false);
  await x.bringToFront();await click(x);await unchanged(base);await click(x,2);await count(base+1);await other.close();
  pass('Clicks on different tabs never accumulate and returning to a tab begins a new sequence');

  await fresh();base=await total();await hit(x).focus();await x.keyboard.down('Enter');
  await x.keyboard.down('Enter');await x.keyboard.down('Enter');await x.keyboard.up('Enter');await unchanged(base);
  await x.keyboard.press('Enter');await unchanged(base);await x.keyboard.press('Enter');await count(base+1);
  pass('Keyboard auto-repeat is ignored; deliberate Enter presses follow the chosen threshold');

  await fresh();base=await total();await worker.evaluate(()=>{clicksFixture.hold=true;});
  await click(x,3);await count(base+1);await expect(bubble(x)).toContainText('正在把这条帖子');
  await click(x,7);await unchanged(base+1);
  await worker.evaluate(()=>{clicksFixture.hold=false;clicksFixture.release();clicksFixture.release=null;});
  await expect(bubble(x)).toContainText('已发送任务');await click(x);await unchanged(base+1);
  pass('Clicks while a submission is pending neither duplicate it nor carry over toward a new task');

  await patch({clickGmgn:'gmgn',clickBinance:'binance'});
  for(const [url,marker] of [['https://gmgn.ai/?chain=bsc','3.5'],['https://www.binance.com/en/my/dashboard','42']]){
    const page=await context.newPage();await page.goto(url);await page.bringToFront();await expect(hit(page)).toBeVisible();
    await click(page);await expect(bubble(page)).toContainText(marker);await page.close();
  }
  await fresh();await patch({clickX:'companion'});base=await total();await click(x,5);await unchanged(base);
  pass('Account queries remain single-click, and X companion mode never sends a task');
  assert.deepEqual(errors,[]);completed=true;
}catch(error){failure=error.stack||String(error);throw error;}
finally{
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({completed,passes,errors,failure,fixtureOnly:true},null,2));
  await context.close();
}
