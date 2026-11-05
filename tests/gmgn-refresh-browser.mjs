import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { advanceGmgnFixtureTime } from './gmgn-fixture-time.mjs';

const output = path.resolve('test-results/gmgn-refresh');
await fs.mkdir(output, { recursive: true });
const run = await fs.mkdtemp(path.join(output, 'run-'));
const extension = path.join(run, 'extension');
await fs.cp('extension', extension, { recursive: true });
// All tests use a new browser profile, synthetic credentials and intercepted API
// responses. Never connect to the user's installed Bot/native host.
const bridge = path.join(extension, 'grok-connection.js');
await fs.writeFile(bridge, (await fs.readFile(bridge, 'utf8')).replaceAll('com.trenchwhale.grok', 'com.trenchwhale.refresh_fixture'));
const context = await chromium.launchPersistentContext(path.join(run, 'profile'), {
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1100, height: 850 },
  ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
});
const passes = [], errors = [];
const pass = text => { passes.push(text); console.log('PASS ' + text); };
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
try {
  await context.route('https://gmgn.ai/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>GMGN refresh fixture</title><body style="background:#161a20">Synthetic refresh fixture</body>' }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {
    globalThis.refreshFixture = { pnl: '0', calls: 0, delay: 0 };
    globalThis.fetch = async (input, init) => {
      const u = new URL(input), f = refreshFixture;
      if (u.origin !== 'https://openapi.gmgn.ai') throw Error('Unexpected fixture request');
      f.calls++; if (f.delay) await new Promise(r => setTimeout(r, f.delay));
      return Response.json({ code: 0, data: init.body
        ? { list: JSON.parse(init.body).wallet_addresses.map(wallet_address => ({ wallet_address, realized_profit: f.pnl })) }
        : { balances: [{ wallet_address: u.searchParams.get('wallet_address'), token_address: u.searchParams.get('token_address'), balance: '1.25' }] }
      });
    };
    await gmgn.save('fixture-gmgn-refresh-key', { bsc: ['0x' + '12'.repeat(20)] }, 'bsc');
    await chrome.storage.local.set({ settings: TrenchCore.patchSettings({}, { clickMode: 'auto', interactionSound: false, energy: 'quiet' }) });
  });
  const page = await context.newPage(); await page.goto('https://gmgn.ai/?chain=bsc');
  const pet = page.locator('#trench-pet-root'), hit = pet.locator('.hit'), bubble = pet.locator('.bubble');
  const pnl = bubble.locator('.finance-row').nth(1);
  await expect(hit).toBeVisible(); await hit.click();
  await expect(pnl).toHaveText('1日已实现：$0.00');
  await expect(bubble).not.toHaveAttribute('title', /更新中/, { timeout: 15000 });
  pass('Initial real-zero fixture completes directly from the GMGN pet');
  await advanceGmgnFixtureTime(worker);
  await worker.evaluate(() => { refreshFixture.pnl = '-87.25'; refreshFixture.delay = 400; });
  await hit.click();
  await expect(pnl).toHaveText('1日已实现：-$87.25', { timeout: 15000 });
  await expect(bubble).not.toHaveAttribute('title', /更新中/, { timeout: 15000 });
  await expect(pnl.locator('strong')).toHaveClass('finance-negative');
  const calls = await worker.evaluate(() => refreshFixture.calls);
  for (let i = 0; i < 3; i++) { await hit.click(); await expect(pnl).toHaveText('1日已实现：-$87.25'); }
  expect(await worker.evaluate(() => refreshFixture.calls)).toBe(calls);
  pass('A click refreshes cached zero to the new red loss; repeat clicks make no extra API calls');
  await bubble.screenshot({ path: path.join(output, 'negative.png') });
  await expect(bubble).toBeHidden({ timeout: 8000 });
  pass('The final result still closes after five seconds');
  const other = await context.newPage(); await other.goto('about:blank');
  await advanceGmgnFixtureTime(worker);
  await worker.evaluate(() => { refreshFixture.pnl = '32.50'; });
  await page.bringToFront(); await hit.click();
  await expect(pnl).toHaveText('1日已实现：+$32.50', { timeout: 15000 });
  await expect(bubble).not.toHaveAttribute('title', /更新中/, { timeout: 15000 });
  await expect(pnl.locator('strong')).toHaveClass('finance-positive');
  await bubble.screenshot({ path: path.join(output, 'positive.png') });
  const diagnostic = await worker.evaluate(async () => (await gmgn.test()).report.finance);
  expect(diagnostic.pnl).toBe('32.50');
  expect(await worker.evaluate(() => refreshFixture.calls)).toBe(calls + 2);
  pass('Returning from a background tab refreshes to a green profit without saving settings; diagnostics agree');
  expect(errors).toEqual([]);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passes, errors, fixtureOnly: true }, null, 2));
} finally { await context.close(); }
