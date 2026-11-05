import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Real browser DOM and extension messages, isolated response fixtures only.
// Native Bot, account APIs, and the user's browser profile are never used.
const output = path.resolve('test-results/bubble-result-timing');
await fs.mkdir(output, { recursive: true });
const run = await fs.mkdtemp(path.join(output, 'run-'));
const extension = path.join(run, 'extension');
await fs.cp(process.env.BUBBLE_EXTENSION_SOURCE || 'extension', extension, { recursive: true });
const bridge = path.join(extension, 'grok-connection.js');
await fs.writeFile(bridge, (await fs.readFile(bridge, 'utf8')).replaceAll('com.trenchwhale.grok', 'com.trenchwhale.bubble_fixture_unregistered'));
await fs.appendFile(path.join(extension, 'background.js'), `
// Test-only message boundary: no finance requests or Bot submissions leave here.
const timingOriginalHandle = handle;
globalThis.timingFixture = { finance: {}, starts: {}, submits: 0, release: null, task: null };
handle = async function(message, sender) {
  if(message.type==='grok:notification-read'&&timingFixture.failReads){timingFixture.readAttempts=(timingFixture.readAttempts||0)+1;throw Error('Fixture: read message lost');}
  const provider = /^(gmgn|binance):finance-(start|peek)$/.exec(message?.type || '');
  if (provider) {
    if (provider[2] === 'start') timingFixture.starts[provider[1]] = (timingFixture.starts[provider[1]] || 0) + 1;
    return { finance: timingFixture.finance[provider[1]] || null };
  }
  if (message.type === 'grok:research') {
    timingFixture.submits++;
    return await new Promise(resolve => { timingFixture.release = resolve; });
  }
  if (message.type === 'grok:task') return { task: timingFixture.task };
  return timingOriginalHandle(message, sender);
};
`);
const context = await chromium.launchPersistentContext(path.join(run, 'profile'), {
  channel: 'msedge', headless: true, viewport: { width: 1280, height: 900 },
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
});
const passes = [], errors = [], timings = [];
let completed = false, failure = '';
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
const pass = label => { passes.push(label); console.log('PASS ' + label); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pet = page => page.locator('#trench-pet-root');
const bubble = page => pet(page).locator('.bubble');
async function expectReport(page, id) {
  await expect(bubble(page)).toBeVisible();
  // Report previews were removed from the bubble; their metadata remains on
  // the clickable link. Distinguish reports without requiring the old body.
  await expect(bubble(page).locator('.grok-result-link')).toHaveAttribute('title',new RegExp(id));
}
let worker, home;

async function instrument(page) {
  await expect(pet(page).locator('.hit')).toBeVisible();
  await page.evaluate(() => {
    const node = document.querySelector('#trench-pet-root').shadowRoot.querySelector('.bubble');
    window.bubbleTimeline = [];
    const record = () => window.bubbleTimeline.push({ at: performance.now(), hidden: node.hidden, text: node.textContent, refreshing: node.title.includes('更新中') });
    new MutationObserver(record).observe(node, { childList: true, characterData: true, attributes: true, subtree: true });
    record();
  });
}
async function updateSettings(patch) {
  const result = await home.evaluate(patch => chrome.runtime.sendMessage({ type: 'settings:patch', patch }), patch);
  assert.equal(result.ok, true);
}
async function finance(provider, data) {
  await worker.evaluate(({ provider, data }) => { timingFixture.finance[provider] = data; }, { provider, data });
}
async function assertFiveSeconds(page, marker, label, after = 0) {
  const node = bubble(page);
  await expect(node).toBeVisible();
  await expect(node).toContainText(marker);
  const first = await page.evaluate(({ marker, after }) => window.bubbleTimeline.find(row => row.at > after && !row.hidden && !row.refreshing && row.text.includes(marker) && !row.text.includes('更新中')), { marker, after });
  assert(first, 'The final result must be observed before its expiry: ' + label);
  const remaining = await page.evaluate(at => Math.max(0, at + 4800 - performance.now()), first.at);
  await sleep(remaining);
  await expect(node).toBeVisible({ timeout: 100 });
  await expect(node).toBeHidden({ timeout: 1800 });
  const hidden = await page.evaluate(at => window.bubbleTimeline.find(row => row.at > at && row.hidden), first.at);
  assert(hidden, 'Bubble hide must be recorded: ' + label);
  const elapsedMs = hidden.at - first.at;
  assert(elapsedMs >= 4850 && elapsedMs <= 6500, label + ' visible duration: ' + elapsedMs);
  timings.push({ label, elapsedMs });
}
async function simulatedVisibility(page, hidden) {
  const url = page.url();
  await worker.evaluate(async ({ url, hidden }) => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === url);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: hidden => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    }, args: [hidden] });
  }, { url, hidden });
}

try {
  await context.route('https://gmgn.ai/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Isolated GMGN timing fixture</title>' }));
  await context.route('https://www.binance.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Isolated Binance timing fixture</title>' }));
  await context.route('https://bubble.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Isolated notification timing fixture</title>' }));
  await context.route('https://x.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Isolated X timing fixture</title><article data-testid="tweet"><div data-testid="User-Name">作者 @project</div><a role="link" href="/project/status/123"><time>现在</time></a><div data-testid="tweetText">测试项目研究资料；不向真实 Bot 提交。</div></article>' }));
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  home = await context.newPage(); await home.goto(`chrome-extension://${id}/home.html`);
  await updateSettings({ clickMode: 'auto', clickGmgn: 'gmgn', clickBinance: 'binance', clickX: 'grok', xResearchClicks: 1, clickOther: 'companion', energy: 'quiet', interactionSound: false, sound: false });

  if (!process.env.BUBBLE_TIMING_EDGE_ONLY) {
  const gmgn = await context.newPage(); await gmgn.goto('https://gmgn.ai/?chain=bsc'); await instrument(gmgn);
  const base = { queryId: 'gmgn-timing', chain: 'bsc', symbol: 'BNB', name: 'BSC', count: 1, balance: null, pnl: null, at: Date.now(), refreshing: true };
  await finance('gmgn', base);
  await pet(gmgn).locator('.hit').click();
  await expect(bubble(gmgn)).toContainText('正在读取');
  await sleep(6100);
  await expect(bubble(gmgn)).toBeVisible();
  await finance('gmgn', { ...base, balance: '3.125', pnl: '6.25', refreshing: false });
  await assertFiveSeconds(gmgn, '3.125', 'GMGN fresh result');
  pass('GMGN waits beyond five seconds for final data, then remains visible for five seconds');

  await finance('gmgn', { ...base, balance: '3.125', pnl: '6.25', refreshing: false, cached: true, fresh: true });
  await pet(gmgn).locator('.hit').click(); await expect(bubble(gmgn)).toContainText('3.125');
  await sleep(2200);
  const secondClickAt = await gmgn.evaluate(() => performance.now());
  await pet(gmgn).locator('.hit').click();
  await sleep(3000); // The preceding bubble's original deadline has passed.
  await expect(bubble(gmgn)).toBeVisible();
  await assertFiveSeconds(gmgn, '3.125', 'GMGN cached result after second click', secondClickAt);
  pass('Cached result expires five seconds after the latest click; an older timer cannot close it');

  const binance = await context.newPage(); await binance.goto('https://www.binance.com/en/my/dashboard'); await instrument(binance);
  const binanceBase = { queryId: 'binance-timing', view: 'daily-pnl', at: Date.now(), refreshing: true, rows: [{ label: '总资产', amount: null, unit: 'USDT' }, { label: '今日估算', amount: null, pnl: true, unit: 'USDT' }] };
  await finance('binance', binanceBase); await pet(binance).locator('.hit').click();
  await sleep(6100); await expect(bubble(binance)).toBeVisible();
  await finance('binance', { ...binanceBase, refreshing: false, rows: [{ label: '总资产', amount: '125.75', unit: 'USDT' }, { label: '今日估算', amount: '-2.5', pnl: true, unit: 'USDT' }] });
  await assertFiveSeconds(binance, '125.75', 'Binance final result');
  await expect(bubble(binance).locator('.finance-negative')).toHaveText('-2.5 USDT');
  pass('Binance uses the same result-based five-second timer and retains negative PnL styling');

  const x = await context.newPage(); await x.goto('https://x.com/project/status/123'); await instrument(x);
  await pet(x).locator('.hit').click(); await expect(bubble(x)).toContainText('正在把这条帖子');
  await sleep(6100); await expect(bubble(x)).toBeVisible();
  await pet(x).locator('.hit').click(); await expect(bubble(x)).toContainText('正在');
  assert.equal(await worker.evaluate(() => timingFixture.submits), 1, 'Pending clicks must not duplicate research submission');
  await worker.evaluate(() => {
    timingFixture.task = { id: 'timing-task', botName: '研究助手', botUrl: 'grokbot://app/v1/agent?id=timing-bot', status: 'accepted' };
    timingFixture.release({ task: timingFixture.task });
  });
  await assertFiveSeconds(x, '已发送任务', 'X accepted task');
  pass('X waits for confirmed acceptance before starting five seconds, including a click while submission is pending');

  const first = await context.newPage(); await first.goto('https://bubble.test/first'); await instrument(first);
  const hidden = await context.newPage(); await hidden.goto('https://bubble.test/hidden'); await instrument(hidden);
  await simulatedVisibility(hidden, true);
  const inbox = revision => home.evaluate(revision => chrome.storage.local.set({ grokNotificationInbox: {
    version: 1, revision, connectionId: 'timing-connection', items: [{ id: 'timing-complete', status: 'completed', botName: '研究助手', botUrl: 'grokbot://app/v1/agent?id=timing-bot', title: '时序测试项目', summary: '最终报告完成：时序测试项目', createdAt: Date.now() - 10000, finishedAt: Date.now(), readAt: 0 }]
  } }), revision);
  await inbox(1);
  await expectReport(first,'时序测试项目');
  await sleep(6100);await expect(bubble(first)).toBeVisible();
  await expect(bubble(hidden)).toBeHidden();
  const stored = await home.evaluate(async () => (await chrome.storage.local.get('grokNotificationInbox')).grokNotificationInbox);
  assert.equal(stored.items[0].readAt, 0, 'Elapsed time must neither hide nor mark a report as read');
  await inbox(2); await sleep(1400); await expect(bubble(first)).toBeVisible();
  await simulatedVisibility(hidden, false);
  await expectReport(hidden,'时序测试项目');
  await sleep(6100);await expect(bubble(hidden)).toBeVisible();
  await inbox(3); await sleep(1400); await expect(bubble(first)).toBeVisible(); await expect(bubble(hidden)).toBeVisible();
  pass('Completion stays visible and unread beyond five seconds on every page, including after background delivery and inbox refresh');
  }

  const corner = await context.newPage(); await corner.goto('https://bubble.test/corner'); await instrument(corner);
  const notice = (id, revision) => home.evaluate(({ id, revision }) => chrome.storage.local.set({ grokNotificationInbox: {
    version: 1, revision, connectionId: 'timing-connection', items: [{ id, status: 'completed', botName: '研究助手', botUrl: 'grokbot://app/v1/agent?id=timing-bot', title: id, summary: '最终报告完成：'+id, createdAt: Date.now() - 10000, finishedAt: Date.now(), readAt: 0 }]
  } }), { id, revision });
  await notice('menu-interruption', 50);
  await expectReport(corner,'menu-interruption');
  await pet(corner).locator('.hit').click({ button: 'right' });
  await expect(pet(corner).locator('.menu')).toBeVisible();
  await sleep(5200);
  await pet(corner).locator('.menu-head button').click();
  await expect(bubble(corner)).toBeVisible({ timeout: 2500 });
  await expectReport(corner,'menu-interruption');
  pass('Closing the action menu resumes a temporarily covered unread notification without waiting for a periodic broadcast');

  await notice('visibility-interruption', 51);
  await expectReport(corner,'visibility-interruption');
  await sleep(1400); await simulatedVisibility(corner, true); await sleep(5200);
  await simulatedVisibility(corner, false);
  await expectReport(corner,'visibility-interruption');
  await sleep(6100);await expect(bubble(corner)).toBeVisible();
  pass('A tab hidden midway through a notification resumes a persistent unread reminder');

  const peer = await context.newPage(); await peer.goto('https://bubble.test/peer'); await instrument(peer);
  await notice('explicit-close', 52);
  await expectReport(corner,'explicit-close'); await expectReport(peer,'explicit-close');
  await bubble(corner).locator('.bubble-close').click();
  await expect(bubble(corner)).toBeHidden(); await expect(bubble(peer)).toBeHidden();
  const readInbox = await home.evaluate(() => chrome.runtime.sendMessage({ type: 'grok:inbox' }));
  assert.equal(readInbox.events.length, 0);
  const readAt = await home.evaluate(async () => (await chrome.storage.local.get('grokNotificationInbox')).grokNotificationInbox.items[0].readAt);
  assert(readAt > 0, 'Only explicit close/read should persist a global read receipt');
  pass('Explicit close marks the report read across every tab and survives a later inbox refresh');

  await notice('explicit-open', 54);
  await expectReport(corner,'explicit-open');await expectReport(peer,'explicit-open');
  const reportLink=bubble(corner).locator('.grok-result-link');
  await expect(reportLink).toHaveAttribute('href','grokbot://app/v1/agent?id=timing-bot');
  // Keep the isolated fixture from opening the real desktop Bot; exercise the
  // real link click/read handler and verify the intended deep-link separately.
  await reportLink.evaluate(link=>link.addEventListener('click',event=>event.preventDefault(),{once:true}));
  await reportLink.click();
  await expect(bubble(corner)).toBeHidden();await expect(bubble(peer)).toBeHidden();
  assert.equal((await home.evaluate(()=>chrome.runtime.sendMessage({type:'grok:inbox'}))).events.length,0);
  pass('Opening the report link retains the correct Bot destination and clears the persistent reminder across pages');

  const departing=await context.newPage();await departing.goto('https://bubble.test/departing');await instrument(departing);
  await notice('lost-read-request',56);
  await expectReport(departing,'lost-read-request');await expectReport(peer,'lost-read-request');
  await simulatedVisibility(peer,true);
  const cdp=await context.newCDPSession(peer);await cdp.send('Page.setWebLifecycleState',{state:'frozen'});
  await worker.evaluate(()=>{timingFixture.failReads=true;timingFixture.readAttempts=0;});
  await bubble(departing).locator('.bubble-close').click();
  await expect.poll(()=>worker.evaluate(()=>timingFixture.readAttempts)).toBeGreaterThan(0);
  await departing.close();
  await expect.poll(()=>home.evaluate(async()=>{const data=(await chrome.storage.local.get('grokNotificationInbox')).grokNotificationInbox;return data.items[0].readAt;})).toBeGreaterThan(0);
  await expect(bubble(corner)).toBeHidden();
  await cdp.send('Page.setWebLifecycleState',{state:'active'});
  const resumedAt=await peer.evaluate(()=>performance.now());await simulatedVisibility(peer,false);
  await sleep(1500);await expect(bubble(peer)).toBeHidden();
  assert.equal(await peer.evaluate(at=>window.bubbleTimeline.some(row=>row.at>=at&&!row.hidden&&row.text.includes('lost-read-request')),resumedAt),false,'Resuming a frozen page must not flash a stale notification');
  await worker.evaluate(()=>{timingFixture.failReads=false;});
  assert.equal((await home.evaluate(()=>chrome.runtime.sendMessage({type:'grok:inbox'}))).events.length,0);
  pass('A failed read message and closing source tab still persist global read; frozen pages resume without showing stale reminders');

  await updateSettings({ clickMode: 'gmgn' });
  const oldBalanceAt = Date.now() - 86400000;
  await finance('gmgn', { queryId: 'stale-balance-timing', chain: 'bsc', symbol: 'BNB', name: 'BSC', count: 1,
    balance: '1.2345', pnl: '9.2', at: Date.now(), balanceAt: oldBalanceAt, pnlAt: Date.now(),
    staleFields: ['balance'], nextRefreshAt: Date.now() + 60000, cached: true, refreshing: false });
  const startsBeforeCache = await worker.evaluate(() => timingFixture.starts.gmgn || 0);
  await pet(corner).locator('.hit').click();
  await expect(bubble(corner)).toContainText('BNB余额');
  await expect(bubble(corner).locator('small')).toHaveText(/^GMGN · 上次 \d{2}:\d{2}:\d{2}$/);
  await expect(bubble(corner)).toContainText('1日已实现');
  await expect(bubble(corner)).not.toContainText('1日已实现（上次）');
  await expect(bubble(corner)).toContainText('9.2');
  const title = await bubble(corner).getAttribute('title');
  assert(title.includes('余额为上次结果') && title.includes(String(new Date(oldBalanceAt).getFullYear())), 'Stale balance tooltip must disclose its full calendar date');
  assert(!title.includes('盈亏为上次结果'), 'Fresh PnL must not inherit stale balance labeling');
  const lastCachedClick = await corner.evaluate(() => performance.now());
  await pet(corner).locator('.hit').click();
  await expect(bubble(corner)).toContainText('1.2345');
  await expect(bubble(corner)).not.toContainText('刷新未完成');
  await expect(bubble(corner)).not.toHaveAttribute('title',/更新中/);
  assert.equal(await worker.evaluate(() => timingFixture.starts.gmgn || 0), startsBeforeCache, 'Fresh cooldown cache must bypass finance-start');
  await assertFiveSeconds(corner, '1.2345', 'GMGN stale balance with fresh PnL during cooldown', lastCachedClick);
  pass('Cooldown cache labels the last balance with its date, keeps fresh PnL, sends no refresh, and hides after five seconds');
  assert.deepEqual(errors, []);
  completed = true;
} catch (error) {
  failure = error.message;
  throw error;
} finally {
  await fs.writeFile(path.join(output, process.env.BUBBLE_TIMING_EDGE_ONLY ? 'edge-report.json' : 'report.json'), JSON.stringify({ completed, failure, passes, timings, errors, fixtureOnly: true, realApis: false, nativeBot: false, visibilityTest: 'document visibility event in isolated content-script world', realWallClockTiming: true }, null, 2));
  await context.close();
}
