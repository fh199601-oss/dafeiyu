import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { advanceGmgnFixtureTime } from './gmgn-fixture-time.mjs';
const output = path.resolve('test-results/finance-cross-context'); fs.mkdirSync(output, { recursive: true });
const extension = path.resolve('extension'), profile = fs.mkdtempSync(path.join(output, 'profile-'));
const A = '0x' + '12'.repeat(20), B = '0x' + '34'.repeat(20), SOL = 'So11111111111111111111111111111111111111112';
const passes = [], errors = []; let context;
const pass = text => { passes.push(text); console.log('PASS ' + text); };
try {
  context = await chromium.launchPersistentContext(profile, { channel: 'msedge', headless: true,
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('https://gmgn.ai/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Cross-chain finance fixture</title><p>Isolated simulated response data.</p>' }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => {
    globalThis.crossFixture = { calls: [], holdBsc: false, rateLimit: false, balanceEntered: false, release: null };
    globalThis.fetch = async (input, options) => {
      const url = new URL(input), body = options.body ? JSON.parse(options.body) : null;
      const chain = body?.chain || url.searchParams.get('chain'), f = crossFixture;
      f.calls.push({ chain, path: url.pathname, credential: options.headers['X-APIKEY'] });
      if (f.rateLimit && chain === 'bsc') return Response.json({ code: 429 }, { status: 429, headers: { 'Retry-After': '1' } });
      if (body) return Response.json({ code: 0, data: { list: body.wallet_addresses.map(wallet_address => ({ wallet_address, realized_profit: chain === 'bsc' ? '-2.5' : chain === 'sol' ? '12.5' : '0.5' })) } });
      const address = url.searchParams.get('wallet_address');
      if (f.holdBsc && chain === 'bsc' && address.endsWith('1212')) { f.balanceEntered = true; await new Promise(resolve => { f.release = resolve; }); }
      return Response.json({ code: 0, data: { balances: [{ wallet_address: address, token_address: url.searchParams.get('token_address'),
        balance: chain === 'sol' ? '52.4' : chain === 'base' ? '0.6' : address.endsWith('1212') ? '3.5' : '9.1' }] } });
    };
  });
  const id = new URL(worker.url()).host, home = await context.newPage(); await home.goto(`chrome-extension://${id}/home.html#gmgn-settings`);
  const save = (key, bsc) => home.evaluate(async ({ key, bsc, A, SOL }) => {
    const result = await chrome.runtime.sendMessage({ type: 'gmgn:save', apiKey: key, addresses: { bsc: [bsc], sol: [SOL], base: [A] }, defaultChain: 'bsc' });
    if (!result.ok) throw new Error(result.error);
  }, { key, bsc, A, SOL });
  await save('fixture-original-key-only', A);
  const pages = {};
  for (const chain of ['bsc', 'sol', 'base']) { pages[chain] = await context.newPage(); await pages[chain].goto('https://gmgn.ai/?chain=' + chain); }
  const query = async (chain, operation) => worker.evaluate(async ({ chain, operation }) => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === 'https://gmgn.ai/?chain=' + chain);
    return (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: operation => chrome.runtime.sendMessage({ type: 'gmgn:finance-' + operation }), args: [operation] }))[0].result;
  }, { chain, operation });
  const completed = async (chain, id) => {
    let value;
    await expect.poll(async () => { value = (await query(chain, 'peek')).finance; return value?.queryId === id && value.refreshing === false; }, { timeout: 20000 }).toBe(true);
    return value;
  };
  const starts = await Promise.all(['bsc', 'sol', 'base'].map(async chain => ({ chain, value: (await query(chain, 'start')).finance })));
  expect(new Set(starts.map(item => item.value.queryId)).size).toBe(3);
  const totals = Object.fromEntries(await Promise.all(starts.map(async ({ chain, value }) => [chain, await completed(chain, value.queryId)])));
  expect(totals.bsc.balance).toBe('3.5'); expect(totals.sol.balance).toBe('52.4'); expect(totals.base.balance).toBe('0.6');
  expect(totals.bsc.pnl).toBe('-2.5'); expect(totals.sol.pnl).toBe('12.5'); expect(totals.base.pnl).toBe('0.5');
  pass('Three real tab senders query BSC, Solana and Base concurrently without mixing balances or PnL');

  await advanceGmgnFixtureTime(worker);
  await worker.evaluate(() => { crossFixture.holdBsc = true; });
  const old = (await query('bsc', 'start')).finance;
  await expect.poll(() => worker.evaluate(() => crossFixture.balanceEntered)).toBe(true);
  const solStart = (await query('sol', 'start')).finance;
  expect((await completed('sol', solStart.queryId)).balance).toBe('52.4');
  await save('fixture-replaced-key-only', B);
  for (const chain of ['bsc', 'sol', 'base']) expect((await query(chain, 'peek')).finance).toBe(null);
  const callsAtSave = await worker.evaluate(() => crossFixture.calls.length);
  const fresh = (await query('bsc', 'start')).finance;
  expect(fresh.queryId).not.toBe(old.queryId);
  expect((await completed('bsc', fresh.queryId)).balance).toBe('9.1');
  await worker.evaluate(() => { crossFixture.holdBsc = false; crossFixture.release(); });
  await pages.bsc.waitForTimeout(100);
  expect((await query('bsc', 'peek')).finance.queryId).toBe(fresh.queryId);
  expect((await query('bsc', 'peek')).finance.balance).toBe('9.1');
  expect(await worker.evaluate(count => crossFixture.calls.slice(count).every(call => call.credential === 'fixture-replaced-key-only'), callsAtSave)).toBe(true);
  pass('Changing API/address settings while an old BSC response hangs invalidates all old cache identities and prevents late overwrite');

  await advanceGmgnFixtureTime(worker);
  await worker.evaluate(() => { crossFixture.rateLimit = true; });
  const beforeLimit = await worker.evaluate(() => crossFixture.calls.length);
  const limitedBsc = (await query('bsc', 'start')).finance;
  const limitedSol = (await query('sol', 'start')).finance;
  const [bsc, sol] = await Promise.all([limitedBsc.refreshing ? completed('bsc', limitedBsc.queryId) : limitedBsc, limitedSol.refreshing ? completed('sol', limitedSol.queryId) : limitedSol]);
  expect(bsc.balance).toBe('9.1'); expect(bsc.staleFields).toContain('balance'); expect(sol.balance).toBe(null); expect(bsc.reason).toContain('限频'); expect(sol.reason).toContain('限频');
  expect(await worker.evaluate(count => crossFixture.calls.length - count, beforeLimit)).toBe(1);
  await save('fixture-third-key-only', B);
  const afterChange = (await query('base', 'start')).finance;
  expect(afterChange.refreshing).toBe(false); expect(afterChange.reason).toContain('限频');
  expect(await worker.evaluate(count => crossFixture.calls.length - count, beforeLimit)).toBe(1);
  pass('A 429 in one tab halts queued requests in another chain and the cooldown survives credential replacement');
  expect(errors).toEqual([]);
  fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify({ passes, errors, testedAt: new Date().toISOString(), source: 'isolated fixture APIs; real extension message routing across three tabs' }, null, 2));
} finally { await context?.close(); }
