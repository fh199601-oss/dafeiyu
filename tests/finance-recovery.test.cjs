const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../extension/finance-core.js');
const GMGN = require('../extension/gmgn-connection.js');
const Binance = require('../extension/binance-connection.js');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const addresses = Array.from({ length: 6 }, (_, i) => '0x' + String(i + 1).padStart(40, '0'));

function storage() {
  const rows = new Map();
  return { rows, get: async key => structuredClone(rows.get(key)), set: async (key, value) => rows.set(key, structuredClone(value)) };
}
function fixture(provider, overrides = {}) {
  const store = storage(), calls = []; let clock = 1800000000000, handler;
  const options = { store, now: () => clock, wait: async ms => { clock += ms; }, requestTimeoutMs: 35,
    fetcher: async (input, init) => {
      const url = new URL(input); calls.push({ path: url.pathname, at: clock });
      if (handler) { const response = await handler(url, init); if (response) return response; }
      if (provider === 'binance') return Response.json(url.pathname.endsWith('/time') ? { serverTime: clock }
        : [{ walletName: 'Spot', balance: '42.5', activate: true }]);
      return Response.json({ code: 0, data: url.pathname.endsWith('wallet_profits')
        ? { list: JSON.parse(init.body).wallet_addresses.map(wallet_address => ({ wallet_address, realized_profit: '2.1' })) }
        : { balances: [{ wallet_address: url.searchParams.get('wallet_address'), token_address: F.native('bsc'), balance: '0.100000000000000001' }] } });
    }, ...overrides };
  const make = () => (provider === 'gmgn' ? GMGN : Binance).create(options);
  return { options, service: make(), make, store, calls, mode: provider === 'gmgn' ? 'bsc' : 'assets',
    advance: ms => { clock += ms; }, handler: value => { handler = value; },
    async save(service = this.service, wallets = addresses.slice(0, 2)) {
      if (provider === 'gmgn') await service.save('fixture-only-not-a-real-key', { bsc: wallets }, 'bsc');
      else await service.save('fixtureapikey12345678', 'fixturesecret12345678');
    } };
}
async function finished(service, mode, id) {
  const until = Date.now() + 3000;
  while (Date.now() < until) {
    const value = await service.peek(mode);
    if (value?.queryId === id && !value.refreshing) return value;
    await delay(5);
  }
  assert.fail('query did not leave refreshing state');
}

for (const provider of ['gmgn', 'binance']) {
  test(`${provider}: detached start is immediate, merges a live query, and a new worker never reports an old job as running`, async () => {
    const h = fixture(provider); await h.save();
    let release, entered;
    const held = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
    h.handler(async () => { entered(); await held; });
    const first = await h.service.start(h.mode); await started;
    assert.equal(first.refreshing, true); assert.ok(first.queryId);
    const second = await h.service.start(h.mode); assert.equal(second.queryId, first.queryId);
    assert.equal((await h.service.peek(h.mode)).refreshing, true);
    const newWorker = h.make(); assert.equal(await newWorker.peek(h.mode), null);
    release(); const result = await finished(h.service, h.mode, first.queryId);
    assert.equal(result.refreshing, false);
    const cached = await newWorker.peek(h.mode); assert.equal(cached.queryId, first.queryId); assert.equal(cached.refreshing, false);
    h.handler(null); if (provider === 'gmgn') h.advance(61000);
    const fresh = await newWorker.start(h.mode); assert.notEqual(fresh.queryId, first.queryId);
    await finished(newWorker, h.mode, fresh.queryId);
  });

  test(`${provider}: a hung fetch releases its flight and permits; the next click queries successfully`, async () => {
    const h = fixture(provider); await h.save();
    h.handler(() => new Promise(() => {}));
    const first = await h.service.start(h.mode), failed = await finished(h.service, h.mode, first.queryId);
    assert.match(failed.reason, /超时/);
    assert.equal(provider === 'gmgn' ? failed.balance : failed.rows[0]?.amount, provider === 'gmgn' ? null : undefined);
    h.handler(null); if (provider === 'gmgn') h.advance(61000);
    const fresh = await h.service.start(h.mode);
    const recovered = await finished(h.service, h.mode, fresh.queryId);
    assert.equal(recovered.reason, ''); assert.notEqual(fresh.queryId, first.queryId);
    assert.equal(provider === 'gmgn' ? recovered.balance : recovered.rows[0].amount, provider === 'gmgn' ? '0.200000000000000002' : '42.5');
  });

  test(`${provider}: a stalled response stream cannot keep a query pending forever`, async () => {
    const h = fixture(provider); await h.save();
    h.handler(() => new Response(new ReadableStream({ start() {} })));
    const first = await h.service.start(h.mode), failed = await finished(h.service, h.mode, first.queryId);
    assert.match(failed.reason, /超时/);
    h.handler(null); if (provider === 'gmgn') h.advance(61000);
    const next = await h.service.start(h.mode);
    assert.equal((await finished(h.service, h.mode, next.queryId)).reason, '');
  });

  test(`${provider}: returning after a long suspension supersedes the stale query and ignores its late result`, async () => {
    const h = fixture(provider, { requestTimeoutMs: 5000 }); await h.save();
    let release;
    const held = new Promise(resolve => { release = resolve; });
    h.handler(async () => { await held; });
    const old = await h.service.start(h.mode);
    h.advance(180001); h.handler(null);
    const fresh = await h.service.start(h.mode); assert.notEqual(fresh.queryId, old.queryId);
    const value = await finished(h.service, h.mode, fresh.queryId);
    release(); await delay(10);
    assert.equal((await h.service.peek(h.mode)).queryId, value.queryId);
    assert.equal(value.reason, '');
  });
}

test('GMGN six-wallet reads are serial with a full 2.1-second gap after completion and retain exact totals', async t => {
  const store = storage(), starts = []; let active = 0, maxActive = 0, clock = 1800000000000;
  const service = GMGN.create({ store, now: () => clock, wait: async ms => { clock += ms; }, fetcher: async (input, init) => {
    const url = new URL(input), profit = url.pathname.endsWith('wallet_profits');
    starts.push({ at: clock, weight: profit ? 3 : 2 }); active++; maxActive = Math.max(active, maxActive);
    clock += 650; await Promise.resolve(); active--;
    return Response.json({ code: 0, data: profit ? { list: addresses.map(wallet_address => ({ wallet_address, realized_profit: '1.2' })) }
      : { balances: [{ wallet_address: url.searchParams.get('wallet_address'), token_address: F.native('bsc'), balance: '0.100000000000000001' }] } });
  } });
  await service.save('fixture-no-real-credential', { bsc: addresses }, 'bsc');
  const begin = clock, result = await service.finance('bsc'), elapsed = clock - begin;
  assert.equal(result.balance, '0.600000000000000006'); assert.equal(result.pnl, '7.2'); assert.equal(starts.length, 7);
  assert.equal(maxActive, 1);
  let bucket = 0, previous = starts[0].at;
  for (const row of starts) { bucket = Math.max(0, bucket - (row.at - previous) * .005) + row.weight; assert.ok(bucket <= 5.02, `Free-plan capacity exceeded: ${bucket}`); previous = row.at; }
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i].at - starts[i - 1].at >= 650 + 2100);
  assert.equal(elapsed, 7 * 650 + 6 * 2100);
  t.diagnostic(`simulated six-wallet query: RTT=650ms, completed-to-next gap=2100ms, total=${elapsed}ms; peak concurrent=${maxActive}; full totals validated`);
});

test('GMGN 429 during the wallet group stops queued reads, preserves prior cooldown, and never returns a partial balance', async () => {
  const h = fixture('gmgn'); await h.save(h.service, addresses);
  h.handler(url => url.pathname.endsWith('wallet_token_balance') ? Response.json({ code: 429 }, { status: 429, headers: { 'Retry-After': '120' } }) : null);
  const result = await h.service.finance('bsc'); assert.equal(result.balance, null); assert.equal(result.pnl, '12.6');
  assert.ok(h.calls.length <= 4, 'only already admitted requests may reach the network');
  const count = h.calls.length; await h.make().finance('bsc', { force: true }); assert.equal(h.calls.length, count);
  assert.ok(h.store.rows.get('cooldown') > 1800000000000 + 60000);
});

test('GMGN enforces 429 headers before reading a stalled body and retains a longer body reset time', async () => {
  const h = fixture('gmgn'); await h.save();
  h.handler(() => new Response(new ReadableStream({ start() {} }), { status: 429, headers: { 'Retry-After': '120' } }));
  const started = await h.service.start('bsc');
  await delay(10); assert.ok(h.store.rows.get('cooldown') >= 1800000120000);
  const result = await finished(h.service, 'bsc', started.queryId); assert.match(result.reason, /限频/); assert.equal(h.calls.length, 1);
  h.advance(150000);
  h.handler(() => Response.json({ code: 429, reset_at: 1800001000 }, { status: 429, headers: { 'Retry-After': '60' } }));
  await h.service.finance('bsc', { force: true }); assert.equal(h.store.rows.get('cooldown'), 1800001000000);
});

test('IndexedDB storage reopens closed connections and settles/retries aborted or hung transactions', async () => {
  const values = new Map(), databases = []; let hang = false, fail = false;
  const factory = { open() {
    const request = {};
    const db = { closed: false, objectStoreNames: { contains: () => true }, close() { this.closed = true; }, transaction() {
      if (this.closed || fail) { fail = false; throw new DOMException('closed', 'InvalidStateError'); }
      const tx = { abort() { this.onabort?.(); }, objectStore() { return {
        get: key => operation(key, undefined, false), put: (value, key) => operation(key, value, true)
      }; } };
      function operation(key, value, write) {
        const req = {};
        if (hang) { hang = false; return req; }
        queueMicrotask(() => { if (write) values.set(key, value); req.result = values.get(key); req.onsuccess?.(); tx.oncomplete?.(); }); return req;
      }
      return tx;
    } };
    databases.push(db); queueMicrotask(() => { request.result = db; request.onsuccess?.(); }); return request;
  } };
  const store = F.privateStore('fixture-only', { factory, timeoutMs: 20 });
  await store.set('x', 1); assert.equal(await store.get('x'), 1);
  databases.at(-1).onversionchange(); assert.equal(await store.get('x'), 1); assert.equal(databases.length, 2);
  databases.at(-1).onclose(); await store.set('x', 2); assert.equal(databases.length, 3);
  fail = true; assert.equal(await store.get('x'), 2); assert.equal(databases.length, 4);
  hang = true; assert.equal(await store.get('x'), 2); assert.equal(databases.length, 5);
});
