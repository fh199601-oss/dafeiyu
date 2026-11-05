import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { advanceGmgnFixtureTime } from './gmgn-fixture-time.mjs';
const output = path.resolve('test-results/finance-recovery'); fs.mkdirSync(output, { recursive: true });
const extension = path.resolve('extension'), profile = fs.mkdtempSync(path.join(output, 'profile-'));
const address = '0x' + '12'.repeat(20), passes = [], errors = [];
const pass = message => { passes.push(message); console.log('PASS ' + message); };
let context;
async function fixture(worker) {
  await worker.evaluate(() => {
    globalThis.financeFixture = { calls: 0, hang: false, balance: '3.5' };
    globalThis.fetch = async (input, init) => {
      const url = new URL(input), f = financeFixture; f.calls++;
      if (f.hang) await new Promise(() => {});
      if (url.host.includes('binance')) return Response.json(url.pathname.endsWith('/time') ? { serverTime: Date.now() } : [{ walletName: 'Spot', balance: f.balance, activate: true }]);
      return Response.json({ code: 0, data: url.pathname.endsWith('wallet_profits')
        ? { list: JSON.parse(init.body).wallet_addresses.map(wallet_address => ({ wallet_address, realized_profit: '-2.3' })) }
        : { balances: [{ wallet_address: url.searchParams.get('wallet_address'), token_address: '0x0000000000000000000000000000000000000000', balance: f.balance }] } });
    };
  });
}
try {
  context = await chromium.launchPersistentContext(profile, { channel: 'msedge', headless: true, viewport: { width: 1280, height: 900 },
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('https://finance-recovery.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Finance recovery fixture</title><p>Isolated browser fixture; no real credentials.</p>' }));
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'); await fixture(worker);
  const id = new URL(worker.url()).host, home = await context.newPage(); await home.goto(`chrome-extension://${id}/home.html#gmgn-settings`);
  await home.evaluate(async address => {
    const response = await chrome.runtime.sendMessage({ type: 'gmgn:save', apiKey: 'fixture-never-a-real-key', addresses: { bsc: [address] }, defaultChain: 'bsc' });
    if (!response.ok) throw new Error('Could not save fixture configuration');
  }, address);
  const page = await context.newPage(); await page.goto('https://finance-recovery.test/'); await page.bringToFront();
  const hit = page.locator('#trench-pet-root .hit'), bubble = page.locator('#trench-pet-root .bubble');
  await hit.click(); await expect(bubble).toContainText('BNB余额：3.5', { timeout: 10000 });
  const initialCalls = await worker.evaluate(() => financeFixture.calls);
  await advanceGmgnFixtureTime(worker);
  await worker.evaluate(() => { financeFixture.hang = true; }); await hit.click();
  await expect(bubble).toHaveAttribute('title',/更新中/);
  await expect.poll(() => worker.evaluate(() => financeFixture.calls)).toBeGreaterThan(initialCalls);
  const beforeStop = await home.evaluate(() => chrome.runtime.sendMessage({ type: 'gmgn:finance-peek' }));
  expect(beforeStop.finance.refreshing).toBe(true);
  // Stop the real extension service worker while the API fetch is unresolved.
  const cdp = await context.newCDPSession(page); let versions = [];
  cdp.on('ServiceWorker.workerVersionUpdated', event => { versions = event.versions; });
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => versions.find(row => row.scriptURL === worker.url() && row.runningStatus === 'running')?.versionId).toBeTruthy();
  const versionId = versions.find(row => row.scriptURL === worker.url() && row.runningStatus === 'running').versionId;
  await cdp.send('ServiceWorker.stopWorker', { versionId });
  // An ordinary extension message wakes the stopped worker; no page reload or
  // connection settings are required. The pet then detects the lost query ID.
  await home.evaluate(() => chrome.runtime.sendMessage({ type: 'gmgn:finance-peek' }));
  // Playwright keeps the Worker object for an extension version across restarts;
  // the lost global proves that its runtime was actually terminated.
  expect(await worker.evaluate(() => typeof globalThis.financeFixture)).toBe('undefined');
  await fixture(worker);
  await expect(bubble).toContainText('3.5', { timeout: 15000 });
  await expect(bubble).not.toHaveAttribute('title',/更新中/, { timeout: 15000 });
  expect(await worker.evaluate(() => financeFixture.calls)).toBe(0);
  await advanceGmgnFixtureTime(worker); await hit.click();
  await expect.poll(() => worker.evaluate(() => financeFixture.calls)).toBeGreaterThan(0);
  await expect(bubble).toContainText('BNB余额：3.5', { timeout: 15000 });
  const afterStop = await home.evaluate(() => chrome.runtime.sendMessage({ type: 'gmgn:finance-peek' }));
  expect(afterStop.finance.queryId).not.toBe(beforeStop.finance.queryId);
  pass('Actual worker termination preserves the GMGN cooldown and old value; the next eligible click recovers without page reload');
  await worker.evaluate(() => { financeFixture.balance = '4.75'; });
  await advanceGmgnFixtureTime(worker);
  await home.bringToFront(); await page.waitForTimeout(800); await page.bringToFront(); await hit.click();
  await expect(bubble).toContainText('BNB余额：4.75', { timeout: 10000 });
  pass('A backgrounded GMGN companion refreshes the new balance after returning without reloading the page');
  await home.evaluate(async () => {
    await chrome.runtime.sendMessage({ type: 'binance:save', apiKey: 'fixtureapikey12345678', secret: 'fixturesecret12345678' });
    await chrome.runtime.sendMessage({ type: 'settings:patch', patch: { clickMode: 'binance', binanceView: 'assets' } });
  });
  await page.bringToFront(); await hit.click(); await expect(bubble).toContainText('总资产估值：4.75 USDT', { timeout: 10000 });
  await home.bringToFront(); await worker.evaluate(() => { financeFixture.balance = '5.25'; });
  await page.waitForTimeout(800); await page.bringToFront(); await hit.click();
  await expect(bubble).toContainText('总资产估值：5.25 USDT', { timeout: 10000 });
  pass('Binance queries also refresh after background/foreground without reloading or exposing credentials');
  const binanceCalls = await worker.evaluate(() => financeFixture.calls);
  await worker.evaluate(() => { financeFixture.hang = true; }); await hit.click();
  await expect.poll(() => worker.evaluate(() => financeFixture.calls)).toBeGreaterThan(binanceCalls);
  const oldBinance = await home.evaluate(() => chrome.runtime.sendMessage({ type: 'binance:finance-peek' }));
  expect(oldBinance.finance.refreshing).toBe(true);
  await cdp.send('ServiceWorker.stopWorker', { versionId });
  await home.evaluate(() => chrome.runtime.sendMessage({ type: 'binance:finance-peek' }));
  expect(await worker.evaluate(() => typeof globalThis.financeFixture)).toBe('undefined');
  await fixture(worker); await worker.evaluate(() => { financeFixture.balance = '6.75'; });
  await expect(bubble).toContainText('总资产估值：6.75 USDT', { timeout: 15000 });
  await expect(bubble.locator('small')).not.toContainText('更新中');
  const newBinance = await home.evaluate(() => chrome.runtime.sendMessage({ type: 'binance:finance-peek' }));
  expect(newBinance.finance.queryId).not.toBe(oldBinance.finance.queryId);
  pass('A real worker restart also restores a hung Binance query with a fresh signed read');
  expect(errors).toEqual([]);
  fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify({ passed: passes.length, passes, errors, testedAt: new Date().toISOString(), source: 'isolated fixture API; real Edge MV3 worker stopped via CDP' }, null, 2));
} finally { await context?.close(); }
