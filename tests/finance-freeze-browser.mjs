import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const output = path.resolve('test-results/finance-freeze'); fs.mkdirSync(output, { recursive: true });
const extension = path.resolve('extension'), profile = fs.mkdtempSync(path.join(output, 'profile-'));
let context, cdp;
try {
  context = await chromium.launchPersistentContext(profile, { channel: 'msedge', headless: true,
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  await context.route('https://finance-freeze.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Frozen-tab fixture</title>' }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host, home = await context.newPage(); await home.goto(`chrome-extension://${id}/home.html#gmgn-settings`);
  const page = await context.newPage(); await page.goto('https://finance-freeze.test/');
  await expect(page.locator('#trench-pet-root .hit')).toBeVisible();
  await home.bringToFront(); cdp = await context.newCDPSession(page);
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  const started = Date.now();
  const saved = home.evaluate(() => chrome.runtime.sendMessage({ type: 'gmgn:save', apiKey: 'fixture-not-real-api-key', addresses: { bsc: ['0x' + '12'.repeat(20)] }, defaultChain: 'bsc' }));
  const value = await Promise.race([saved, new Promise(resolve => setTimeout(() => resolve({ timedOut: true }), 3500))]);
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  await saved;
  expect(value.timedOut, 'Saving settings must not wait for a frozen background webpage').not.toBe(true);
  expect(value.ok).toBe(true);
  console.log('PASS Saving account settings completes with a frozen background tab in ' + (Date.now() - started) + 'ms');
} finally { try { await cdp?.send('Page.setWebLifecycleState', { state: 'active' }); } catch {} await context?.close(); }
