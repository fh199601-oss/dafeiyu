import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const output = path.resolve('test-results/binance'); fs.mkdirSync(output, { recursive: true });
const run = fs.mkdtempSync(path.join(output, 'run-')), extension = path.join(run, 'extension'), profile = path.join(run, 'profile');
await fsp.cp('extension', extension, { recursive: true });
const bridge = path.join(extension, 'grok-connection.js');
fs.writeFileSync(bridge, fs.readFileSync(bridge, 'utf8').replaceAll('com.trenchwhale.grok', 'com.trenchwhale.binance_fixture_unregistered'));
const API = 'browserfixtureapikey123456789', SECRET = 'browserfixturesecret123456789';
let context; const passes = [], errors = [];
const pass = text => { passes.push(text); console.log('PASS ' + text); };
async function launch() {
  const browser = await chromium.launchPersistentContext(profile, { channel: 'msedge', headless: true, viewport: { width: 1440, height: 1100 },
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  browser.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await browser.route('https://**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>网站切换测试</title><h1>单击功能演示 · 示例金额</h1><p>测试页面。账户响应为固定示例，未连接真实币安账户。</p>' }));
  return browser;
}
async function fixture(worker) {
  await worker.evaluate(() => {
    globalThis.binanceCalls = []; globalThis.exampleBalance = '8452.12';
    globalThis.fetch = async (url, opts) => {
      const parsed = new URL(url); binanceCalls.push({ path: parsed.pathname, host: parsed.hostname, method: opts.method });
      if (globalThis.binanceDelay) await new Promise(resolve => setTimeout(resolve, globalThis.binanceDelay));
      let data;
      if (parsed.pathname.endsWith('/time')) data = { serverTime: Date.now() };
      else if (parsed.pathname.endsWith('/wallet/balance')) data = [{ walletName: 'Spot', activate: true, balance: exampleBalance }, { walletName: 'Funding', activate: true, balance: '100' }];
      else if (parsed.pathname === '/fapi/v3/account') data = { assets: globalThis.binanceEmptyFutures || globalThis.binanceDailyCase ? [] : globalThis.binanceMalformedFutures ? [{ asset: 'USDT', marginBalance: '5620' }] : [{ asset: 'USDT', marginBalance: '5620', unrealizedProfit: '-52.4' }] };
      else if (parsed.pathname === '/sapi/v1/accountSnapshot') {
        const btc = globalThis.binanceSnapshotValues?.length ? binanceSnapshotValues.length > 1 ? binanceSnapshotValues.shift() : binanceSnapshotValues[0] : '0.08';
        data = { code: 200, snapshotVos: [{ type: 'spot', updateTime: Math.floor(Date.now() / 86400000) * 86400000 - 1000, data: { totalAssetOfBtc: btc } }] };
      }
      else if (parsed.pathname === '/api/v3/klines') { const price=globalThis.binanceBtcPrice || '100000'; data = [[Number(parsed.searchParams.get('startTime')), price, price, price, price]]; }
      else if (parsed.pathname === '/sapi/v1/asset/transfer') data = { total: 0, rows: [] };
      else if (['/sapi/v1/capital/deposit/hisrec', '/sapi/v1/capital/withdraw/history', '/fapi/v1/income'].includes(parsed.pathname)) data = [];
      else throw new Error('Unexpected request');
      return new Response(JSON.stringify(data));
    };
  });
}
try {
  context = await launch(); let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'); await fixture(worker);
  const id = new URL(worker.url()).host;
  let home = await context.newPage(); await home.goto(`chrome-extension://${id}/home.html#settings`);
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  const shortcutOpened = context.waitForEvent('page');
  await popup.locator('#open-click-settings').click();
  const shortcutHome = await shortcutOpened;
  await expect(shortcutHome).toHaveURL(/home.html#click-settings$/);
  await expect(shortcutHome.locator('#click-mode')).toBeFocused();
  await expect(shortcutHome.locator('#click-settings')).toBeInViewport();
  await home.close(); home = shortcutHome;
  const section = async hash => { await home.evaluate(hash => { location.hash = hash; }, hash); };
  pass('Toolbar shortcut opens and focuses the visible click-content setting directly');
  await expect(home.locator('#click-mode')).toHaveValue('auto');
  await section('binance-settings');
  await expect(home.locator('#binance-view')).toHaveValue('daily-pnl');
  await home.locator('#binance-view').selectOption('assets-pnl');
  await expect(home.locator('#binance-key')).toHaveAttribute('type', 'password');
  await expect(home.locator('#binance-secret')).toHaveAttribute('type', 'password');
  await home.locator('#binance-key').fill(API); await home.locator('#binance-secret').fill(SECRET);
  await home.getByRole('button', { name: '保存并检测币安', exact: true }).click();
  await expect(home.locator('#binance-feedback')).toContainText('8552.12', { timeout: 15000 });
  await expect(home.locator('#binance-feedback')).toContainText('-52.4');
  await expect(home.locator('#binance-key')).toHaveValue(''); await expect(home.locator('#binance-secret')).toHaveValue('');
  await home.locator('[data-click-site="binance"]').click();
  await expect(home.locator('#click-mode')).toHaveValue('auto');
  await expect(home.locator('#binance-click-status')).toHaveText('当前单击：按网站自动切换');
  await home.locator('[data-click-mode="auto"]').click(); await section('click-settings'); await expect(home.locator('#site-click-rules')).toBeVisible();
  await home.locator('#click-settings').screenshot({ path: path.join(output, 'website-click-settings.png') });
  await section('binance-settings');
  await home.locator('#binance-settings').screenshot({ path: path.join(output, 'binance-settings-example.png') });
  pass('Read-only Binance form, per-site preferences and explicit PnL scope render and persist');
  await worker.evaluate(() => { globalThis.binanceEmptyFutures = true; });
  await home.locator('#binance-test').click();
  await expect(home.locator('.binance-feedback-row').nth(1)).toContainText('0 USDT', { timeout: 15000 });
  await expect(home.locator('#binance-feedback')).toContainText('查询成功');
  await worker.evaluate(() => { globalThis.binanceEmptyFutures = false; globalThis.binanceMalformedFutures = true; });
  await home.locator('#binance-test').click();
  await expect(home.locator('#binance-feedback')).toContainText('部分数据已取得', { timeout: 15000 });
  await expect(home.locator('.binance-feedback-row').first()).toContainText('8552.12 USDT');
  await expect(home.locator('.binance-feedback-row strong').first()).toHaveCSS('color', 'rgb(24, 38, 56)');
  await expect(home.locator('.binance-feedback-row').nth(1)).toContainText('未取得');
  await home.locator('#binance-settings [data-goto="click-settings"]').click();
  await expect(home.locator('#click-mode')).toBeFocused();
  await expect(home.locator('#click-settings')).toBeInViewport();
  await worker.evaluate(() => { globalThis.binanceMalformedFutures = false; });
  pass('Missing futures data keeps successful assets legible; the connection card links back to click settings');
  const page = await context.newPage(); await page.goto('https://www.binance.com/zh-CN');
  const hit = page.locator('#trench-pet-root .hit'), bubble = page.locator('#trench-pet-root .bubble');
  await hit.click(); await expect(bubble).toContainText('总资产估值：8552.12 USDT', { timeout: 15000 });
  await expect(bubble).toContainText('USDT合约浮盈：-52.4 USDT'); await expect(bubble.locator('.finance-row')).toHaveCount(2);
  await expect(bubble.locator('.finance-negative')).toHaveCSS('color', 'rgb(210, 53, 53)');
  await expect(bubble).toHaveAttribute('title', /不是全账户今日盈亏/);
  await page.screenshot({ path: path.join(output, 'binance-bubble-example.png') });
  await worker.evaluate(() => { globalThis.binanceEmptyFutures = true; globalThis.binanceDelay = 400; });
  const clickedAt = Date.now(); await hit.click();
  await expect(bubble.locator('small')).toContainText('上次', { timeout: 1000 });
  expect(Date.now() - clickedAt).toBeLessThan(1000);
  await expect(bubble).toContainText('USDT合约浮盈：0 USDT', { timeout: 10000 });
  await expect(bubble.locator('.finance-row').nth(1).locator('strong')).toHaveCSS('color', 'rgb(22, 22, 22)');
  await worker.evaluate(() => { globalThis.binanceEmptyFutures = false; globalThis.binanceDelay = 0; });
  pass('Binance cached result appears immediately during refresh; a successful zero PnL is neutral black');
  const count = (await worker.evaluate(() => binanceCalls)).length;
  await worker.evaluate(() => { exampleBalance = '9100'; }); await hit.click();
  await expect(bubble).toContainText('总资产估值：9200 USDT', { timeout: 15000 });
  expect((await worker.evaluate(() => binanceCalls)).length).toBeGreaterThan(count);
  pass('Every new Binance click requests fresh data and labels USDT futures PnL separately from account assets');
  await page.goto('https://x.com/example/status/123'); await hit.click(); await expect(bubble).not.toContainText('总资产估值');
  await home.locator('[data-setting="clickX"]').selectOption('binance'); await hit.click();
  await expect(bubble).toContainText('总资产估值：9200 USDT', { timeout: 15000 });
  await page.goto('https://binance.com.evil.test/'); await hit.click(); await expect(bubble).not.toContainText('总资产估值');
  await page.goto('https://gmgn.ai/?chain=bsc'); await hit.click(); await expect(bubble).toContainText('GMGN');
  await expect(bubble).not.toContainText('总资产估值');
  pass('GMGN, Binance, X and other sites follow independent choices; lookalike domains do not match');
  await home.locator('#click-mode').selectOption('binance'); await section('binance-settings'); await home.locator('#binance-view').selectOption('futures');
  await hit.click(); await expect(bubble).toContainText('USDT合约权益：5620 USDT', { timeout: 15000 });
  const shared = await home.evaluate(async () => ({ state: await chrome.runtime.sendMessage({ type: 'state:get' }), local: await chrome.storage.local.get(null) }));
  expect(JSON.stringify(shared)).not.toContain(API); expect(JSON.stringify(shared)).not.toContain(SECRET);
  const denied = await worker.evaluate(async () => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith('https://gmgn.ai/'));
    return (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: async () => Promise.all(['binance:status', 'binance:save', 'binance:clear'].map(type => chrome.runtime.sendMessage({ type }))) }))[0].result;
  });
  expect(denied.every(result => !result.ok)).toBe(true);
  pass('Fixed-source mode works across sites; website scripts cannot retrieve or change Binance credentials');
  await worker.evaluate(() => { globalThis.binanceDelay = 800; }); await hit.click(); await expect(bubble.locator('small')).toContainText('更新中');
  await section('click-settings'); await home.locator('#click-mode').selectOption('companion'); await expect(bubble).toBeHidden();
  await page.waitForTimeout(2500); await expect(bubble).toBeHidden();
  await home.locator('#click-mode').selectOption('binance');
  pass('Changing the click source during a pending request hides and invalidates the prior bubble');
  await worker.evaluate(() => { globalThis.binanceDelay = 0; globalThis.binanceDailyCase = true; });
  await section('binance-settings'); await home.locator('#binance-view').selectOption('daily-pnl'); await hit.click();
  await expect(bubble).toContainText('今日总盈亏：+1100 USDT', { timeout: 60000 });
  await expect(bubble.locator('.finance-positive')).toHaveCSS('color', 'rgb(19, 131, 72)');
  await expect(bubble).toHaveAttribute('title', /UTC 0 点/);
  await expect(bubble).toHaveAttribute('title', /未覆盖理财/);
  await worker.evaluate(() => { exampleBalance = '9200'; }); await hit.click();
  await expect(bubble).toContainText('今日总盈亏：+1200 USDT', { timeout: 60000 });
  expect((await worker.evaluate(() => binanceCalls)).filter(call => call.path === '/sapi/v1/accountSnapshot')).toHaveLength(1);
  pass('UTC daily estimates refresh live values, use zero for an empty contract account and reuse the expensive opening snapshot');
  // Use the same BTC price as the earlier query because historical prices are
  // deliberately cached. Only the snapshot itself changes in this regression.
  await worker.evaluate(async () => {
    exampleBalance='458.59'; binanceSnapshotValues=['0.00000586','0.0045857'];
    const store=TrenchFinance.privateStore('trench-binance-connection');
    await store.set('daily-baselines',null); await store.set('finance-results',null);
  });
  await hit.click(); await expect(bubble).toContainText('今日总盈亏：+0.02 USDT',{timeout:60000});
  await expect(bubble.locator('.finance-positive')).toHaveCSS('color','rgb(19, 131, 72)');
  const afterCorrection=await worker.evaluate(()=>binanceCalls.filter(x=>x.path==='/sapi/v1/accountSnapshot').length);
  expect(afterCorrection).toBe(3);
  await worker.evaluate(()=>{exampleBalance='458.5';});
  await hit.click(); await expect(bubble).toContainText('今日总盈亏：-0.07 USDT',{timeout:60000});
  await expect(bubble.locator('.finance-negative')).toHaveCSS('color','rgb(210, 53, 53)');
  expect(await worker.evaluate(()=>binanceCalls.filter(x=>x.path==='/sapi/v1/accountSnapshot').length)).toBe(afterCorrection);
  await page.screenshot({path:path.join(output,'corrected-daily-pnl.png')});
  pass('A partial snapshot is rechecked before displaying daily PnL; the corrected small gain/loss uses green/red and shares its cache');
  await home.locator('#binance-view').selectOption('futures');
  await context.close(); context = await launch(); worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'); await fixture(worker);
  home = await context.newPage(); await home.goto(`chrome-extension://${id}/home.html#settings`);
  await expect(home.locator('#click-mode')).toHaveValue('binance'); await expect(home.locator('#binance-view')).toHaveValue('futures');
  await section('binance-settings');
  expect((await home.evaluate(() => chrome.runtime.sendMessage({ type: 'binance:status' }))).connection.configured).toBe(true);
  await home.locator('#binance-clear').click(); await expect(home.locator('#binance-badge')).toHaveText('未配置');
  const none = await home.evaluate(() => chrome.runtime.sendMessage({ type: 'binance:finance' }));
  expect(none.finance.rows).toHaveLength(0); expect(none.finance.reason).toContain('连接币安');
  const preview = await context.newPage(); await preview.goto(pathToFileURL(path.join(extension, 'home.html')).href + '#binance-settings');
  await expect(preview.locator('#binance-key')).toBeDisabled(); await expect(preview.locator('#binance-secret')).toBeDisabled();
  pass('Credentials/preferences survive restart; clear removes credentials; standalone previews reject real keys');
  expect(errors).toEqual([]);
  fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify({ passed: passes.length, passes, errors, testedAt: new Date().toISOString(),
    limitation: 'Official response fixtures only; a real Binance user API is still required to validate account coverage and permissions.' }, null, 2));
} finally { await context?.close(); }
