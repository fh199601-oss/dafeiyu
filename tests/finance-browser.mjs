import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { advanceGmgnFixtureTime } from './gmgn-fixture-time.mjs';
const output = path.resolve('test-results/finance-api'); fs.mkdirSync(output, { recursive: true });
const extension = path.resolve('extension'), profile = fs.mkdtempSync(path.join(output, 'profile-'));
const A = '0x' + '12'.repeat(20), B = '0x' + '34'.repeat(20), S = 'So11111111111111111111111111111111111111112';
const cache = { bsc: { list: [A, B].map(address => ({ address, chain: 'bsc', user_id: 'test-owner' })), archive_count: 28 },
  base: { list: [A, B].map(address => ({ address, chain: 'bsc', user_id: 'test-owner' })), archive_count: 28 },
  sol: { list: [{ address: S, chain: 'sol', user_id: 'test-owner' }], archive_count: 4 } };
const passes = [], errors = []; let context;
const pass = text => { passes.push(text); console.log('PASS ' + text); };
async function launch() {
  const browser = await chromium.launchPersistentContext(profile, { channel: 'msedge', headless: true, viewport: { width: 1440, height: 950 },
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  browser.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await browser.route('https://gmgn.ai/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><h1>GMGN 钱包同步测试页</h1><p>示例数据。此页面没有余额、盈亏或钱包地址的可见元素。</p>' }));
  await browser.route('https://companion.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><h1>普通网页 · API 气泡示例</h1><p>GMGN 页面已关闭，数据仍由 API 提供。</p>' }));
  return browser;
}
async function fixture(worker) {
  await worker.evaluate(() => {
    globalThis.financeCalls = [];
    globalThis.fetch = async (url, options) => {
      const u = new URL(url), body = options.body ? JSON.parse(options.body) : null;
      financeCalls.push({ path: u.pathname, chain: body?.chain || u.searchParams.get('chain') });
      if (globalThis.financeDelay) await new Promise(resolve => setTimeout(resolve, financeDelay));
      let data;
      if (u.pathname.endsWith('/wallet_profits')) data = { list: body.wallet_addresses.map(wallet_address => ({ wallet_address,
        realized_profit: body.chain === 'sol' ? '12.5' : wallet_address.endsWith('1212') ? '-507.3630911731022866519' : '-94.57826412865624723167', total_profit: '999999' })) };
      else if (u.pathname.endsWith('/wallet_token_balance')) data = { balances: [{ wallet_address: u.searchParams.get('wallet_address'), token_address: u.searchParams.get('token_address'),
        balance: globalThis.financeBalance || (u.searchParams.get('chain') === 'sol' ? '52.4' : u.searchParams.get('wallet_address').endsWith('1212') ? '0.889206085543872509' : '0.18519192302950768'), decimal: 0 }] };
      else if (u.pathname.endsWith('/info')) data = { wallets: [] };
      else throw new Error('Unexpected endpoint');
      return new Response(JSON.stringify({ code: 0, data }));
    };
  });
}
try {
  context = await launch();
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
  await fixture(worker);
  let home = await context.newPage(); await home.goto('chrome-extension://' + id + '/home.html#gmgn-settings');
  await home.locator('#gmgn-key').fill('finance-test-key-not-real');
  await home.locator('#gmgn-addresses').fill(A + '\n' + B + '\n' + A);
  await home.locator('#gmgn-wallet-chain').selectOption('sol'); await home.locator('#gmgn-addresses').fill(S);
  await home.locator('#gmgn-wallet-chain').selectOption('base'); await home.locator('#gmgn-addresses').fill(A + '\n' + B);
  await home.locator('#gmgn-save').click(); await expect(home.locator('#gmgn-feedback')).toContainText('已保存');
  await expect(home.locator('#gmgn-wallet-chains')).toContainText('BSC · 2 个');
  await expect(home.locator('#gmgn-wallet-chains')).toContainText('Solana · 1 个');
  await home.locator('#gmgn-settings').screenshot({ path: path.join(output, 'manual-settings.png') });
  pass('API and chain-specific manual addresses share one form; duplicates merge and switching editors preserves drafts');
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('__multi_wallets_list_info__', JSON.stringify({bsc:{list:[]}})));
  await page.goto('https://gmgn.ai/?chain=bsc');
  const hit = page.locator('#trench-pet-root .hit'), bubble = page.locator('#trench-pet-root .bubble');
  await hit.click(); await expect(bubble).toContainText('1日已实现：-$601.94');
  await expect(bubble).toHaveAttribute('title',/更新中/); await expect(bubble).not.toContainText('BNB余额：1.07439801');
  await expect(bubble).toContainText('BNB余额：1.07439801', { timeout: 15000 });
  await expect(bubble.locator('.finance-row')).toHaveCount(2);
  await expect(bubble.locator('.finance-neutral')).toHaveCSS('color', 'rgb(22, 22, 22)');
  await expect(bubble.locator('.finance-negative')).toHaveCSS('color', 'rgb(210, 53, 53)');
  pass('First query displays PnL before the complete balance; partial wallet balances never appear as a total');
  await worker.evaluate(() => { globalThis.financeDelay = 500; globalThis.financeBalance = '2'; });
  const calls = (await worker.evaluate(() => financeCalls)).length, clicked = Date.now();
  await hit.click(); await expect(bubble).toHaveAttribute('title',/上次/, { timeout: 1000 });
  expect(Date.now() - clicked).toBeLessThan(1000);
  await expect(bubble).toContainText('BNB余额：1.07439801');
  await hit.click(); await page.waitForTimeout(700);
  expect((await worker.evaluate(() => financeCalls)).length).toBe(calls);
  await advanceGmgnFixtureTime(worker); await hit.click();
  await expect(bubble.locator('.finance-row').first()).toHaveText('BNB余额：4', { timeout: 15000 });
  expect((await worker.evaluate(() => financeCalls)).length).toBe(calls + 3);
  await worker.evaluate(() => { globalThis.financeDelay = 0; globalThis.financeBalance = null; });
  pass('Cooldown clicks show the last result within one second without API calls; the first click after 60 seconds refreshes all wallets');
  const switched = await context.newPage(); await switched.goto('https://gmgn.ai/?chain=sol');
  const sh = switched.locator('#trench-pet-root .hit'), sb = switched.locator('#trench-pet-root .bubble');
  await sh.click(); await expect(sb).toContainText('SOL余额：52.4', { timeout: 10000 });
  await expect(sb.locator('.finance-positive')).toHaveCSS('color', 'rgb(19, 131, 72)');
  const ordinary = await context.newPage(); await ordinary.goto('https://companion.test/');
  await ordinary.locator('#trench-pet-root .hit').click();
  await expect(ordinary.locator('#trench-pet-root .bubble')).toContainText('BNB余额');
  pass('Other pages use the saved default chain even while an unrelated Solana GMGN tab is open');
  await switched.evaluate(() => history.replaceState({}, '', '/?chain=base')); await sh.click();
  await expect(sb).toContainText('ETH余额：1.07439801', { timeout: 15000 });
  await switched.evaluate(() => history.replaceState({}, '', '/?chain=xlayer')); await sh.click();
  await expect(sb).toContainText('暂未接入'); await expect(sb).not.toContainText('601.94');
  pass('Each GMGN tab follows its live chain; unsupported chains never reuse another chain total');
  const denied = await worker.evaluate(async () => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith('https://companion.test/'));
    return (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: async () => Promise.all(['gmgn:save', 'gmgn:wallets-sync', 'gmgn:status'].map(type => chrome.runtime.sendMessage({ type }))) }))[0].result;
  }); expect(denied.every(value => !value.ok)).toBe(true);
  await home.locator('#gmgn-wallet-chain').selectOption('bsc'); await home.locator('#gmgn-addresses').fill(B); await home.locator('#gmgn-save').click();
  await expect(home.locator('#gmgn-wallet-chains')).toContainText('BSC · 1 个');
  await expect(ordinary.locator('#trench-pet-root .bubble')).toBeHidden();
  await ordinary.locator('#trench-pet-root .hit').click();
  await expect(ordinary.locator('#trench-pet-root .bubble')).toContainText('BNB余额：0.18519192', { timeout: 12000 });
  pass('Only trusted settings can edit addresses; saving invalidates visible bubbles and cached totals');
  const state = await home.evaluate(() => chrome.runtime.sendMessage({ type: 'state:get' }));
  expect(JSON.stringify(state)).not.toContain('finance-test-key'); expect(JSON.stringify(state)).not.toContain(B);
  await context.close(); context = await launch(); worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'); await fixture(worker);
  const restarted = await context.newPage(); await restarted.goto('https://companion.test/'); await restarted.locator('#trench-pet-root .hit').click();
  await expect(restarted.locator('#trench-pet-root .bubble')).toContainText('BNB余额：0.18519192', { timeout: 1000 });
  pass('Manual configuration and timestamped cache survive browser restart without exposing keys in shared state');
  expect(errors).toEqual([]);
  fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify({ passed: passes.length, passes, errors, testedAt: new Date().toISOString(), source: 'simulated API/browser fixtures' }, null, 2));
} finally { await context?.close(); }
