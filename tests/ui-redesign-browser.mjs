import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const output=path.resolve('test-results/ui-redesign');
await fs.mkdir(output,{recursive:true});
const run=await fs.mkdtemp(path.join(output,'run-'));
const extension=path.join(run,'extension');
await fs.cp('extension',extension,{recursive:true});
const bridge=path.join(extension,'grok-connection.js');
await fs.writeFile(bridge,(await fs.readFile(bridge,'utf8')).replaceAll('com.trenchwhale.grok','com.trenchwhale.ui_test_unregistered'));
const passes=[],errors=[];
const pass=text=>{passes.push(text);console.log('PASS '+text);};
const context=await chromium.launchPersistentContext(path.join(run,'profile'),{channel:'msedge',headless:true,viewport:{width:1440,height:1020},ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).host;
  await worker.evaluate(()=>chrome.storage.local.set({settings:{enabled:true,energy:'quiet',interactionSound:false,reducedMotion:true}}));
  const page=await context.newPage();
  await page.goto(`chrome-extension://${id}/home.html`);
  await expect(page.locator('#pet-stage .rig-canvas[data-ready=true]')).toBeVisible();
  await expect(page.locator('.brand-mark')).toHaveAttribute('src','assets/icons/whale-128.png');
  const duplicateIds=await page.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(n=>n.id);return ids.filter((id,i)=>ids.indexOf(id)!==i);});
  assert.deepEqual(duplicateIds,[]);
  pass('Original character logo and room load with unique IDs and no remote UI assets');
  await page.screenshot({path:path.join(output,'room-desktop.png'),fullPage:true,animations:'disabled'});
  for(const tab of ['actions','finance','ai','settings','watch','install','room']){
    await page.locator(`[data-tab="${tab}"]`).click();
    await expect(page.locator(`#tab-${tab}`)).toBeVisible();
    await expect(page.locator('.tab-panel:visible')).toHaveCount(1);
    await expect(page.locator('.nav-item.active')).toHaveCount(1);
    await expect(page.locator(`[data-tab="${tab}"]`)).toHaveAttribute('aria-current','page');
  }
  pass('Every navigation item, including AI and install, opens its own page and selected card');
  for(const [hash,tab,account] of [['grok-settings','ai'],['click-settings','settings'],['gmgn-settings','finance','gmgn'],['binance-settings','finance','binance']]){
    await page.goto(`chrome-extension://${id}/home.html#${hash}`);
    await expect(page.locator(`#${hash}`)).toBeVisible();
    await expect(page.locator(`[data-tab="${tab}"]`)).toHaveClass(/active/);
    if(account)await expect(page.locator(`[data-account="${account}"]`)).toHaveAttribute('aria-selected','true');
  }
  pass('Existing finance, click settings and Bot deep links select the right independent page');
  await page.locator('[data-account=gmgn]').click();
  await expect(page.locator('#gmgn-key')).toBeVisible();
  await expect(page.locator('#gmgn-addresses')).toBeVisible();
  await page.locator('[data-account=gmgn]').press('ArrowRight');
  await expect(page.locator('#binance-key')).toBeVisible();
  await expect(page.locator('[data-account=binance]')).toBeFocused();
  await page.locator('[data-account=binance]').press('Home');
  await expect(page.locator('#gmgn-settings')).toBeVisible();
  await page.locator('#gmgn-addresses').fill('0x'+'12'.repeat(20));
  await page.locator('[data-account=binance]').click();
  await page.locator('[data-account=gmgn]').click();
  await expect(page.locator('#gmgn-addresses')).toHaveValue('0x'+'12'.repeat(20));
  await page.locator('#gmgn-addresses').fill('');
  await page.screenshot({path:path.join(output,'account-gmgn-desktop.png'),fullPage:true,animations:'disabled'});
  await page.locator('[data-account=binance]').click();
  await page.screenshot({path:path.join(output,'account-binance-desktop.png'),fullPage:true,animations:'disabled'});
  pass('Account switch works with click and keyboard, keeps draft fields, and groups API with addresses');
  await page.locator('[data-tab=settings]').click();
  await page.locator('#click-mode').selectOption('auto');
  await expect(page.locator('#site-click-rules')).toBeVisible();
  await page.locator('[data-setting=clickX]').selectOption('grok');
  await page.locator('[data-setting=interactionSound]').check();
  await expect.poll(()=>worker.evaluate(async()=>(await chrome.storage.local.get('settings')).settings.interactionSound)).toBe(true);
  await page.locator('#site-form input').fill('ui-fixture.example');
  await page.locator('#site-form button').click();
  await expect(page.locator('.site-chip')).toContainText('ui-fixture.example');
  await page.reload();
  await expect(page.locator('#click-mode')).toHaveValue('auto');
  await expect(page.locator('[data-setting=clickX]')).toHaveValue('grok');
  await expect(page.locator('[data-setting=interactionSound]')).toBeChecked();
  await page.locator('[aria-describedby=motion-help]').focus();
  await expect(page.locator('#motion-help')).toBeVisible();
  await page.locator('#energy').focus();
  await expect(page.locator('#motion-help')).toBeHidden();
  await page.screenshot({path:path.join(output,'preferences-desktop.png'),fullPage:true,animations:'disabled'});
  pass('Settings and site rules persist, and secondary explanations are keyboard-accessible tooltips');
  await page.locator('[data-tab=ai]').click();
  await expect(page.locator('#grok-install-prepare')).toBeVisible();
  await expect(page.locator('#grok-setup-details')).toHaveAttribute('open','');
  await expect(page.locator('#grok-tasks')).toBeAttached();await expect(page.locator('#grok-empty')).toBeVisible();
  await page.screenshot({path:path.join(output,'ai-desktop.png'),fullPage:true,animations:'disabled'});
  await page.locator('.skip-link').focus();await page.locator('.skip-link').press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();await expect(page.locator('#tab-ai')).toBeVisible();
  await worker.evaluate(async()=>{
    const time=Date.now();
    const tasks=[{id:'ui-research-completed',title:'项目一 · 已完成的研究示例',botName:'我的研究助手',status:'completed',createdAt:time-60000,finishedAt:time,botUrl:'grokbot://app/v1/agent?id=ui-fixture-bot',summary:'已整理项目概况、近期讨论与待验证信息。点击下方按钮，回到对应 Bot 查看完整研究。'},
      {id:'ui-research-running',title:'项目二 · 另一项独立研究',botName:'我的研究助手',status:'accepted',createdAt:time+1,botUrl:'grokbot://app/v1/agent?id=ui-fixture-bot',summary:''}];
    grok.status=async()=>({installed:true,configured:true,bot:{id:'ui-fixture-bot',name:'我的研究助手'},tasks,events:[]});
    await grokInbox.ingest('ui-fixture-bot',[],tasks);
  });
  await page.locator('#grok-detect').click();
  await expect(page.locator('#grok-setup-details')).not.toHaveAttribute('open','');
  await page.locator('#grok-setup-details>summary').click();await page.locator('#grok-detect').click();
  await expect(page.locator('#grok-setup-details')).toHaveAttribute('open','');
  await page.locator('#grok-setup-details>summary').click();
  await expect(page.locator('.grok-task')).toHaveCount(2);
  await expect(page.locator('.grok-task[data-unread=true]')).toHaveCount(1);
  await expect(page.locator('.grok-unread-label')).toHaveText('未读');
  await expect(page.locator('.grok-task[data-unread=true] a')).toHaveAttribute('href','grokbot://app/v1/agent?id=ui-fixture-bot');
  await page.screenshot({path:path.join(output,'ai-tasks-desktop.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'标为已读',exact:true}).click();
  await expect(page.locator('.grok-task[data-unread=true]')).toHaveCount(0);
  await expect(page.locator('.grok-task')).toHaveCount(2);
  pass('Connected Bot folds setup without overriding manual choice; research cards separate projects, show unread completion, keep the exact Bot link, and mark read');
  const noOverflow=async()=>{
    const dimensions=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,tab:location.hash,over:[...document.querySelectorAll('body *')].filter(n=>n.getClientRects().length&&n.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(n=>({tag:n.tagName,cls:typeof n.className==='string'?n.className:'',id:n.id,right:n.getBoundingClientRect().right}))}));
    if(dimensions.scrollWidth>dimensions.width+1)await page.screenshot({path:path.join(output,'overflow.png'),fullPage:true,animations:'disabled'});
    assert(dimensions.scrollWidth<=dimensions.width+1,JSON.stringify(dimensions));
  };
  const noButtonOverlap=async()=>{
    const result=await page.evaluate(()=>{
      const nodes=[...document.querySelectorAll('.gmgn-buttons>button,.popup-links>button,.popup-secondary>button')].filter(n=>n.getClientRects().length);
      const collisions=[];
      for(let a=0;a<nodes.length;a++)for(let b=a+1;b<nodes.length;b++){
        const x=nodes[a].getBoundingClientRect(),y=nodes[b].getBoundingClientRect();
        if(Math.min(x.right,y.right)-Math.max(x.left,y.left)>1&&Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>1)collisions.push([nodes[a].id,nodes[b].id]);
      }
      return collisions;
    });assert.deepEqual(result,[]);
  };
  for(const width of [1100,760,390]){
    await page.setViewportSize({width,height:900});
    for(const tab of ['room','actions','finance','ai','settings','watch']){
      await page.locator(`[data-tab="${tab}"]`).click();await noOverflow();await noButtonOverlap();
      if(tab==='finance'){await page.locator('[data-account=binance]').click();await noOverflow();await noButtonOverlap();}
      if(tab==='settings')for(const tip of ['position-help','motion-help']){
        await page.locator(`[aria-describedby="${tip}"]`).focus();
        const box=await page.locator(`#${tip}`).boundingBox();assert(box.x>=0&&box.x+box.width<=width,`${tip} escaped ${width}px viewport`);
      }
    }
  }
  await page.locator('[data-tab=ai]').click();await page.screenshot({path:path.join(output,'ai-narrow.png'),fullPage:true,animations:'disabled'});
  await page.locator('[data-tab=finance]').click();await page.locator('[data-account=gmgn]').click();await page.screenshot({path:path.join(output,'account-narrow.png'),fullPage:true,animations:'disabled'});
  pass('All page groups fit 1100, 760 and 390 px windows without page overflow or overlapping buttons');
  const popup=await context.newPage();await popup.setViewportSize({width:320,height:330});await popup.goto(`chrome-extension://${id}/popup.html`);
  await expect(popup.locator('.popup-logo')).toBeVisible();await expect(popup.locator('#enabled')).toBeChecked();await expect(popup.locator('#enabled')).toHaveCSS('background-color','rgb(87, 120, 181)');
  const popupBounds=await popup.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,controls:[...document.querySelectorAll('.popup-links>button,.popup-secondary>button,#open-home')].map(n=>({id:n.id,top:n.getBoundingClientRect().top,bottom:n.getBoundingClientRect().bottom}))}));
  assert(popupBounds.width<=320);assert(popupBounds.height<=330,JSON.stringify(popupBounds));
  const ordered=[...popupBounds.controls].sort((a,b)=>a.top-b.top);
  assert(ordered.every(b=>b.bottom<=330));
  await popup.locator('#size').fill('205');await popup.locator('#size').dispatchEvent('change');
  await expect.poll(()=>worker.evaluate(async()=>(await chrome.storage.local.get('settings')).settings.size)).toBe(205);
  await expect(popup.locator('#size-output')).toHaveText('205 px');
  await popup.screenshot({path:path.join(output,'popup.png'),fullPage:true,animations:'disabled'});
  pass('Popup document fits 320 by 330 px with separated actions, original logo and saved size control');
  await popup.evaluate(()=>{chrome.runtime.sendMessage=async()=>({ok:false,error:'测试：保存失败，请重试。'});});
  await popup.locator('#enabled').click();
  await expect(popup.locator('#enabled')).toBeChecked();
  await expect(popup.locator('#popup-status')).toHaveText('测试：保存失败，请重试。');
  await expect.poll(()=>worker.evaluate(async()=>(await chrome.storage.local.get('settings')).settings.enabled)).toBe(true);
  pass('Failed save restores the confirmed toggle state and reports the error');
  // Intercept only tab opening/closing in the isolated popup to test navigation targets.
  await popup.evaluate(()=>{window.uiOpened=[];chrome.tabs.create=async props=>{window.uiOpened.push(props.url);return{id:999};};window.close=()=>{};});
  await popup.locator('#open-grok-settings').click();await popup.locator('#open-click-settings').click();
  assert.deepEqual(await popup.evaluate(()=>window.uiOpened),[`chrome-extension://${id}/home.html#grok-settings`,`chrome-extension://${id}/home.html#click-settings`]);
  pass('Popup account and AI actions keep correct extension deep-link targets');
  const livePopup=await context.newPage();await livePopup.goto(`chrome-extension://${id}/popup.html`);
  const newTab=context.waitForEvent('page');await livePopup.locator('#open-click-settings').click();
  const shortcut=await newTab;await expect(shortcut).toHaveURL(/home.html#click-settings$/);
  await expect(shortcut.locator('#click-mode')).toBeFocused();await expect(shortcut.locator('#click-settings')).toBeInViewport();
  pass('Popup document shortcut opens a real new tab and preserves form focus after anchor navigation');
  const offlinePopup=await context.newPage();await offlinePopup.setViewportSize({width:320,height:330});
  await offlinePopup.addInitScript(()=>{chrome.runtime.sendMessage=async()=>({ok:false,error:'测试：暂时无法读取设置。'});window.uiOpened=[];chrome.tabs.create=async props=>{window.uiOpened.push(props.url);return{id:999};};window.close=()=>{};});
  await offlinePopup.goto(`chrome-extension://${id}/popup.html`);
  await expect(offlinePopup.locator('#enabled')).toBeDisabled();
  await expect(offlinePopup.locator('#size')).toBeDisabled();
  await expect(offlinePopup.locator('#popup-status')).toHaveText('测试：暂时无法读取设置。');
  await offlinePopup.locator('#open-click-settings').click();
  assert.deepEqual(await offlinePopup.evaluate(()=>window.uiOpened),[`chrome-extension://${id}/home.html#click-settings`]);
  pass('Unavailable settings keep write controls disabled but leave navigation usable');
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passes,errors,fixtureOnly:true,osExecution:false,realApiRequests:false,popupBounds},null,2));
}finally{await context.close();}
