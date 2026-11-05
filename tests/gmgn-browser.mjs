import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
const output = path.resolve('test-results/gmgn'); fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
const extension = path.resolve('extension'), fakeKey = 'browser-test-only-api-key';
const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>ordinary page</title><h1>Page</h1>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const errors = [], passes = []; let context;
const pass = message => { passes.push(message); console.log('PASS ' + message); };
const launch = () => chromium.launchPersistentContext(profile, { channel: 'msedge', headless: true, viewport: { width: 1440, height: 1100 }, acceptDownloads: true,
  ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
try {
  context = await launch();
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  // Responses use documented shapes plus explicitly hypothetical aggregate fields.
  // These fixtures validate plumbing, never claim a real GMGN total field exists.
  await worker.evaluate(() => {
    globalThis.probeCalls = [];
    globalThis.fetch = async (url, options) => {
      const parsed = new URL(url); globalThis.probeCalls.push({ host: parsed.host, path: parsed.pathname, body: options.body || '', credentials: options.credentials });
      const data = parsed.pathname.endsWith('/wallet_profits') ? { list: JSON.parse(options.body).wallet_addresses.map(wallet_address => ({ wallet_address, realized_profit: '562' })) }
        : { balances: [{ wallet_address: parsed.searchParams.get('wallet_address'), token_address: parsed.searchParams.get('token_address'), balance: '3.5' }] };
      return new Response(JSON.stringify({ code: 0, data }), { status: 200 });
    };
  });
  let home = await context.newPage(); await home.goto(`chrome-extension://${id}/home.html#gmgn-settings`);
  await expect(home.locator('#gmgn-settings')).toBeVisible(); await expect(home.locator('#gmgn-key')).toHaveAttribute('type', 'password');
  await home.locator('#gmgn-key').fill(fakeKey);
  await home.locator('#gmgn-addresses').fill('0x' + '12'.repeat(20));
  await home.locator('#gmgn-form details > summary').click();
  await home.locator('#gmgn-auto-report').check();
  const downloadWait = home.waitForEvent('download');
  await home.getByRole('button', { name: '保存并检测', exact: true }).click();
  const download = await downloadWait; await download.saveAs(path.join(output, 'fixture-diagnostic.json'));
  await expect(home.locator('#gmgn-badge')).toHaveText('已配置');
  await expect(home.locator('#gmgn-wallet-chains')).toContainText('BSC · 1 个');
  await expect(home.locator('#gmgn-key')).toHaveValue('');
  const reportText = fs.readFileSync(path.join(output, 'fixture-diagnostic.json'), 'utf8');
  expect(reportText).not.toContain(fakeKey); expect(reportText).toContain('3.5'); expect(reportText).toContain('562');
  expect(reportText).toContain('1日已实现');
  expect((await worker.evaluate(() => probeCalls)).some(call => call.path.endsWith('/info'))).toBe(false);
  await home.screenshot({ path: path.join(output, 'connected-fixture.png'), fullPage: true });
  pass('API and manual addresses save together; diagnostic queries addresses without the account-info endpoint');
  await home.reload(); await expect(home.locator('#gmgn-badge')).toHaveText('已配置');
  await expect(home.locator('#gmgn-key')).toHaveValue('');
  const local = await home.evaluate(() => chrome.storage.local.get(null));
  const shared = await home.evaluate(() => chrome.runtime.sendMessage({ type: 'state:get' }));
  expect(JSON.stringify(local)).not.toContain(fakeKey); expect(JSON.stringify(shared)).not.toContain(fakeKey);
  pass('Saved credential persists across page reload and stays out of shared settings/state');
  const page = await context.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`); await expect(page.locator('#trench-pet-root .hit')).toBeVisible();
  const denied = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({}); const tab = tabs.find(tab => tab.url?.startsWith('http://127.0.0.1:'));
    const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: async () => {
      const answers = [];
      for (const type of ['gmgn:status', 'gmgn:report', 'gmgn:test', 'gmgn:save', 'gmgn:clear']) answers.push(await chrome.runtime.sendMessage({ type, apiKey: 'attacker-example-key' }));
      return answers;
    } }); return result[0].result;
  });
  expect(denied.every(result => !result.ok)).toBe(true);
  expect((await worker.evaluate(() => globalThis.probeCalls)).length).toBe(2);
  pass('Ordinary-page content scripts cannot read, change, clear or exercise API credentials');
  await context.close(); context = await launch();
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  home = await context.newPage(); await home.goto(`chrome-extension://${id}/home.html#gmgn-settings`);
  await expect(home.locator('#gmgn-badge')).toHaveText('已配置');
  expect((await home.evaluate(() => chrome.runtime.sendMessage({ type: 'gmgn:status' }))).connection.configured).toBe(true);
  await expect(home.locator('#gmgn-key')).toHaveValue('');
  pass('Credential and sanitized report survive a full browser / service-worker restart');
  await home.bringToFront(); await home.locator('#gmgn-form details > summary').click(); await home.locator('#gmgn-clear').click(); await expect(home.locator('#gmgn-badge')).toHaveText('未配置');
  expect((await home.evaluate(() => chrome.runtime.sendMessage({ type: 'gmgn:report' }))).report).toBe(null);
  await home.reload(); await expect(home.locator('#gmgn-badge')).toHaveText('未配置');
  await home.locator('#gmgn-settings').screenshot({ path: path.join(output, 'gmgn-api-settings.png') });
  pass('Clear removes API and stored report; empty connection screen is ready for the user');
  const preview = await context.newPage(); await preview.goto(pathToFileURL(path.resolve('extension/home.html')).href + '#gmgn-settings');
  await expect(preview.locator('#gmgn-key')).toBeDisabled(); await expect(preview.locator('#gmgn-feedback')).toContainText('本地预览');
  pass('Standalone file preview disables credential entry and explains how to open the installed extension');
  expect(errors).toEqual([]);
  fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify({ passed: passes.length, passes, errors }, null, 2));
} finally { await context?.close(); await new Promise(resolve => server.close(resolve)); }
