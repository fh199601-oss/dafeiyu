import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const output = path.resolve('test-results/finance-multitab-query'); fs.mkdirSync(output, { recursive: true });
const extension = path.resolve('extension'), profile = fs.mkdtempSync(path.join(output, 'profile-'));
let context;
try {
  context = await chromium.launchPersistentContext(profile, { channel: 'msedge', headless: true,
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  await context.route('https://finance-peer.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Two-tab refresh fixture</title>' }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => {
    globalThis.fetch = async input => Response.json(new URL(input).pathname.endsWith('/time') ? { serverTime: Date.now() }
      : [{ walletName: 'Spot', balance: '42', activate: true }]);
  });
  const id = new URL(worker.url()).host, home = await context.newPage(); await home.goto(`chrome-extension://${id}/home.html#binance-settings`);
  await home.evaluate(async () => {
    await chrome.runtime.sendMessage({ type: 'binance:save', apiKey: 'fixtureapikey12345678', secret: 'fixturesecret12345678' });
    await chrome.runtime.sendMessage({ type: 'settings:patch', patch: { clickMode: 'binance', binanceView: 'assets' } });
  });
  const peer = await context.newPage(); await peer.goto('https://finance-peer.test/peer');
  const page = await context.newPage(); await page.goto('https://finance-peer.test/main'); await page.bringToFront();
  await worker.evaluate(async () => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === 'https://finance-peer.test/peer');
    const original = binance.peek;
    globalThis.peerRefreshes = 0;
    binance.peek = async mode => {
      const value = await original(mode);
      // Model the peer finishing a new query immediately before the main tab's
      // polling response. Requests still travel from a real second tab sender.
      if (value && !value.refreshing && peerRefreshes < 3) {
        peerRefreshes++;
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => chrome.runtime.sendMessage({ type: 'binance:finance' }) });
        return original(mode);
      }
      return value;
    };
  });
  await page.locator('#trench-pet-root .hit').click();
  const bubble = page.locator('#trench-pet-root .bubble');
  await expect(bubble).toContainText('总资产估值：42 USDT', { timeout: 10000 });
  await expect(bubble).not.toHaveAttribute('title',/更新中/);
  await expect(bubble).not.toContainText('后台连接已重建');
  expect(await worker.evaluate(() => peerRefreshes)).toBeGreaterThan(0);
  console.log('PASS A newer same-account result from another tab completes the pending bubble instead of being mistaken for a lost worker');
} finally { await context?.close(); }
