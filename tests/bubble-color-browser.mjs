import {chromium,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

// SOLVD declares a dark scheme in both metadata and CSS. Unlike merely setting
// body text to white, this changes the document's initial CanvasText color.
const output=path.resolve('test-results/bubble-color');await fs.mkdir(output,{recursive:true});
const run=await fs.mkdtemp(path.join(output,'regression-')),extension=path.join(run,'extension');
await fs.cp('extension',extension,{recursive:true});
const bridge=path.join(extension,'grok-connection.js');
await fs.writeFile(bridge,(await fs.readFile(bridge,'utf8')).replaceAll('com.trenchwhale.grok','com.trenchwhale.color_fixture_unregistered'));
await fs.appendFile(path.join(extension,'background.js'),`
const colorOriginalHandle=handle;
globalThis.colorFixture={pnl:'12.34'};
handle=async(message,sender)=>{
  if(/^gmgn:finance-(start|peek)$/.test(message.type))return {finance:{chain:'bsc',name:'BSC',symbol:'BNB',balance:'3.5',pnl:colorFixture.pnl,count:1,at:Date.now(),refreshing:false}};
  return colorOriginalHandle(message,sender);
};
`);
const context=await chromium.launchPersistentContext(path.join(run,'profile'),{
  channel:'msedge',headless:true,colorScheme:'dark',viewport:{width:1280,height:900},
  ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]
});
const passes=[],errors=[],observations=[];let completed=false,failure='';
context.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));
const pass=label=>{passes.push(label);console.log('PASS '+label);};
const hit=page=>page.locator('#trench-pet-root .hit');
const bubble=page=>page.locator('#trench-pet-root .bubble');
async function readable(page){
  await expect(bubble(page)).toBeVisible();
  await expect(bubble(page).locator('p')).toHaveCSS('color','rgb(37, 56, 88)');
  await expect(bubble(page).locator('p')).toHaveCSS('-webkit-text-fill-color','rgb(37, 56, 88)');
  await expect(bubble(page).locator('small')).toHaveCSS('color','rgb(113, 134, 165)');
  await expect(bubble(page).locator('small')).toBeHidden();
}
try{
  await context.route('https://color.test/**',route=>{
    const scheme=new URL(route.request().url()).searchParams.get('scheme')==='light'?'light':'dark';
    return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="${scheme}"><style>:root{color-scheme:${scheme};background:${scheme==='dark'?'#0d0d0c':'white'};color:${scheme==='dark'?'white':'black'}}body{color:inherit}*{box-sizing:border-box}</style><title>Theme fixture</title>`});
  });
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
  const home=await context.newPage();await home.goto(`chrome-extension://${id}/home.html`);
  const patch=async patch=>{const r=await home.evaluate(patch=>chrome.runtime.sendMessage({type:'settings:patch',patch}),patch);expect(r.ok).toBe(true);};
  await patch({clickMode:'companion',energy:'quiet',interactionSound:false});
  const page=await context.newPage();
  for(const scheme of ['dark','light']){
    await page.goto('https://color.test/?scheme='+scheme);await expect(hit(page)).toBeVisible();await hit(page).click();await readable(page);
    observations.push({documentScheme:scheme,...await bubble(page).locator('p').evaluate(p=>({color:getComputedStyle(p).color,fill:getComputedStyle(p).webkitTextFillColor}))});
    pass('Readable companion text when '+scheme+' metadata and CSS are present before pet injection');
  }
  for(const scheme of ['dark','light','dark']){
    await page.evaluate(s=>{document.querySelector('meta[name="color-scheme"]').content=s;document.documentElement.style.colorScheme=s;},scheme);
    await readable(page);
  }
  await page.emulateMedia({colorScheme:'light'});await readable(page);
  await page.emulateMedia({colorScheme:'dark'});await readable(page);
  pass('Changing document and system themes while a bubble is visible preserves its own palette');
  await page.reload();await hit(page).click();await readable(page);
  await bubble(page).screenshot({path:path.join(output,'fixed-companion.png'),animations:'disabled'});
  pass('Reloading the page also starts with readable text');
  await hit(page).click({button:'right'});
  await expect(page.locator('#trench-pet-root .menu-grid button').first()).toHaveCSS('color','rgb(37, 56, 88)');
  await page.keyboard.press('Escape');
  pass('Action menu buttons retain readable text on a dark document');

  await patch({clickMode:'gmgn'});await worker.evaluate(()=>{colorFixture.pnl='12.34';});
  await hit(page).click();await expect(bubble(page)).toContainText('3.5');
  await expect(bubble(page).locator('small')).toBeVisible();
  await expect(bubble(page).locator('small')).toHaveText(/^GMGN · \d{2}:\d{2}:\d{2}$/);
  await expect(bubble(page).locator('.finance-row').first()).toContainText('BNB余额');
  await expect(bubble(page)).toHaveAttribute('title',/GMGN.*BSC.*个钱包/);
  await expect(bubble(page).locator('.finance-neutral')).toHaveCSS('color','rgb(22, 22, 22)');
  await expect(bubble(page).locator('.finance-positive')).toHaveCSS('color','rgb(19, 131, 72)');
  await expect(bubble(page).locator('.finance-positive')).toHaveCSS('-webkit-text-fill-color','rgb(19, 131, 72)');
  await worker.evaluate(()=>{colorFixture.pnl='-12.34';});await hit(page).click();
  await expect(bubble(page).locator('.finance-negative')).toHaveCSS('color','rgb(210, 53, 53)');
  await expect(bubble(page).locator('.finance-negative')).toHaveCSS('-webkit-text-fill-color','rgb(210, 53, 53)');
  pass('Finance balances remain black, profits green, and losses red with no real API requests');

  await patch({clickMode:'companion'});
  await home.evaluate(()=>chrome.storage.local.set({grokNotificationInbox:{version:1,revision:1,connectionId:'color-fixture',items:[{id:'color-report',status:'completed',botName:'研究助手',botUrl:'grokbot://app/v1/agent?id=color-fixture',createdAt:Date.now()-1000,finishedAt:Date.now(),readAt:0}]}}));
  const link=bubble(page).locator('.grok-result-link');await expect(link).toBeVisible();
  await expect(link).toHaveCSS('color','rgb(36, 79, 133)');await expect(link).toHaveCSS('-webkit-text-fill-color','rgb(36, 79, 133)');
  await expect(link).toHaveAttribute('href','grokbot://app/v1/agent?id=color-fixture');
  await bubble(page).locator('.bubble-close').click();await expect(bubble(page)).toBeHidden();
  pass('Completed-task link stays blue and dismissible');

  if(process.argv.includes('--live-solvd')){
    await page.goto('https://solvd.fun/#/market',{waitUntil:'domcontentloaded',timeout:30000});
    await expect(hit(page)).toBeVisible();await page.waitForTimeout(2500);await hit(page).click();await readable(page);
    observations.push({url:page.url(),...await bubble(page).locator('p').evaluate(p=>({color:getComputedStyle(p).color,fill:getComputedStyle(p).webkitTextFillColor}))});
    await page.screenshot({path:path.join(output,'solvd-after.png'),animations:'disabled'});
    await bubble(page).screenshot({path:path.join(output,'solvd-after-bubble.png'),animations:'disabled'});
    pass('The exact SOLVD market page reproducer now shows readable dark text');
  }
  expect(errors).toEqual([]);completed=true;
}catch(error){failure=error.stack||String(error);throw error;}
finally{
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({completed,passes,errors,observations,failure,liveSolvd:process.argv.includes('--live-solvd'),realBotOrAccountRequests:false},null,2));
  await context.close();
}
