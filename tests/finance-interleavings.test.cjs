const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../extension/finance-core.js');
const Binance = require('../extension/binance-connection.js');
const GMGN = require('../extension/gmgn-connection.js');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function storeFixture() {
  const data = new Map();
  return { data, get: async key => structuredClone(data.get(key)), set: async (key, value) => data.set(key, structuredClone(value)) };
}
const KEY = 'fixtureoldapikey12345678', SECRET = 'fixtureoldsecret12345678';

test('a Binance daily query that finishes after UTC midnight never labels yesterday as today', async () => {
  const DAY = 86400000, day = Math.floor(1800000000000 / DAY) * DAY, store = storeFixture();
  let clock = day + DAY - 200;
  const service = Binance.create({ store, now: () => clock, wait: async () => {}, fetcher: async input => {
    const url = new URL(input); let data;
    if (url.pathname.endsWith('/time')) data = { serverTime: clock };
    else if (url.pathname.endsWith('/wallet/balance')) data = [{ walletName: 'Spot', balance: '150', activate: true }];
    else if (url.pathname.endsWith('/accountSnapshot')) { clock += 1000; data = { code: 200, snapshotVos: [{ type: 'SPOT', updateTime: day - 1000, data: { totalAssetOfBtc: '0.001' } }] }; }
    else if (url.pathname.endsWith('/klines')) data = [[Number(url.searchParams.get('startTime')), '100000', 0, 0, '100000']];
    else if (url.pathname.endsWith('/asset/transfer')) data = { total: 0 };
    else data = [];
    return Response.json(data);
  } });
  await service.save(KEY, SECRET); const result = await service.finance('spot-daily');
  assert.equal(result.rows[0].amount, '150', 'The valid asset read remains available');
  assert.equal(result.rows[1].amount, null, 'Yesterday PnL must not be displayed under today');
  assert.match(result.reason, /UTC 0 点/);
});

test('a failed spot branch cannot leave an orphan futures query using a cleared Binance credential', async () => {
  const store = storeFixture(), futuresTime = deferred(), entered = deferred(), calls = []; let clock = 1800000000000;
  const service = Binance.create({ store, now: () => clock, wait: async ms => { clock += ms; }, fetcher: async (input, options) => {
    const url = new URL(input); calls.push({ path: url.pathname, key: options.headers['X-MBX-APIKEY'] });
    if (url.pathname === '/fapi/v1/time') { entered.resolve(); await futuresTime.promise; return Response.json({ serverTime: clock }); }
    if (url.pathname === '/api/v3/time') return Response.json({ code: -1000 }, { status: 503 });
    return Response.json({ assets: [{ asset: 'USDT', marginBalance: '1', unrealizedProfit: '0' }] });
  } });
  await service.save(KEY, SECRET);
  const reading = service.finance('assets-pnl'); await entered.promise;
  const result = await reading; assert.ok(result.reason); assert.equal(result.rows.length, 0);
  await service.clear(); futuresTime.resolve(); await pause(25);
  assert.equal(calls.filter(call => call.path === '/fapi/v3/account').length, 0, 'No signed request may start after this query finishes and its credential is cleared');
  assert.equal(store.data.get('account'), null); assert.equal(await service.peek('assets-pnl'), null);
});

test('a restarted Binance service expires daily PnL at server UTC midnight even when the local clock is behind', async () => {
  const DAY = 86400000, day = Math.floor(1800000000000 / DAY) * DAY, store = storeFixture();
  let clock = day + DAY - 35000;
  const options = { store, now: () => clock, wait: async () => {}, fetcher: async input => {
    const url = new URL(input); let data;
    if (url.pathname.endsWith('/time')) data = { serverTime: clock + 30000 };
    else if (url.pathname.endsWith('/wallet/balance')) data = [{ walletName: 'Spot', balance: '150', activate: true }];
    else if (url.pathname.endsWith('/accountSnapshot')) data = { code: 200, snapshotVos: [{ type: 'SPOT', updateTime: day - 1000, data: { totalAssetOfBtc: '0.001' } }] };
    else if (url.pathname.endsWith('/klines')) data = [[Number(url.searchParams.get('startTime')), '100000', 0, 0, '100000']];
    else if (url.pathname.endsWith('/asset/transfer')) data = { total: 0 };
    else data = [];
    return Response.json(data);
  } };
  const service = Binance.create(options); await service.save(KEY, SECRET);
  const value = await service.finance('spot-daily'); assert.equal(value.rows[1].amount, '50.000');
  const restarted = Binance.create(options); assert.equal((await restarted.peek('spot-daily')).queryId, value.queryId);
  clock += 10000;
  assert.equal(await restarted.peek('spot-daily'), null, 'UTC-day validity follows the calibrated server clock, including after worker restart');
});

test('a GMGN diagnostic interrupted by a settings change cannot save a report for the previous wallet list', async () => {
  const store = storeFixture(), readOld = deferred(), entered = deferred(); let intercept = false;
  const originalGet = store.get;
  store.get = async key => {
    const value = await originalGet(key);
    if (intercept && key === 'manual-wallets') { intercept = false; entered.resolve(); await readOld.promise; }
    return value;
  };
  const service = GMGN.create({ store, wait: async () => {}, fetcher: async () => { throw new Error('No request should be sent by a cancelled diagnostic'); } });
  await service.save('fixture-gmgn-api-key', { bsc: ['0x' + '12'.repeat(20)] }, 'bsc');
  intercept = true; const checking = service.test(); const cancelled = assert.rejects(checking, /设置已变更|已取消/);
  await entered.promise;
  await service.save('', { sol: ['So11111111111111111111111111111111111111112'] }, 'sol');
  readOld.resolve(); await cancelled;
  assert.equal((await service.status()).last, null);
});

test('a dropped GMGN balance stream never produces a partial total; the next click after cooldown recovers every wallet', async () => {
  const store = storeFixture(), A = '0x' + '12'.repeat(20), B = '0x' + '34'.repeat(20); let broken = true, clock = 1800000000000;
  const service = GMGN.create({ store, now: () => clock, wait: async ms => { clock += ms; }, fetcher: async (input, options) => {
    const url = new URL(input);
    if (options.body) return Response.json({ code: 0, data: { list: [A, B].map(wallet_address => ({ wallet_address, realized_profit: '1.2' })) } });
    const address = url.searchParams.get('wallet_address');
    if (broken && address === B) return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"code":0,"data":{"balances":['));
      queueMicrotask(() => controller.error(new Error('fixture socket closed')));
    } }));
    return Response.json({ code: 0, data: { balances: [{ wallet_address: address, token_address: F.native('bsc'), balance: address === A ? '2' : '3' }] } });
  } });
  await service.save('fixture-gmgn-api-key', { bsc: [A, B] }, 'bsc');
  const failed = await service.finance('bsc'); assert.equal(failed.balance, null); assert.equal(failed.pnl, '2.4'); assert.ok(failed.reason);
  broken = false; clock += 61000; const recovered = await service.finance('bsc', { force: true });
  assert.equal(recovered.balance, '5'); assert.equal(recovered.reason, ''); assert.notEqual(recovered.queryId, failed.queryId);
});

test('IDB timeout recovery during GMGN admission cannot resurrect a request cancelled by new settings', async () => {
  const values = new Map(), databases = [], blocked = deferred(); let hangPacing = false, clock = 1800000000000;
  const factory = { open() {
    const req = {};
    const db = { closed: false, close() { this.closed = true; }, objectStoreNames: { contains: () => true }, transaction() {
      if (this.closed) throw new DOMException('closed fixture connection', 'InvalidStateError');
      let aborted = false;
      const tx = { abort() { aborted = true; this.onabort?.(); }, objectStore() { return { get: key => op(key), put: (value, key) => op(key, value, true) }; } };
      function op(key, value, write = false) {
        const request = {};
        if (!write && key === 'request-pacing' && hangPacing) { hangPacing = false; blocked.resolve(); return request; }
        queueMicrotask(() => { if (aborted) return; if (write) values.set(key, structuredClone(value)); request.result = structuredClone(values.get(key)); request.onsuccess?.(); tx.oncomplete?.(); });
        return request;
      }
      return tx;
    } };
    databases.push(db); queueMicrotask(() => { req.result = db; req.onsuccess?.(); }); return req;
  } };
  const store = F.privateStore('fixture-finance-cross-idb', { factory, timeoutMs: 30 }), calls = [];
  const service = GMGN.create({ store, now: () => clock, wait: async ms => { clock += ms; }, fetcher: async (input, options) => {
    calls.push(options.headers['X-APIKEY']); const url = new URL(input);
    const data = options.body ? { list: JSON.parse(options.body).wallet_addresses.map(wallet_address => ({ wallet_address, realized_profit: '2' })) }
      : { balances: [{ wallet_address: url.searchParams.get('wallet_address'), token_address: F.native('bsc'), balance: '7' }] };
    return Response.json({ code: 0, data });
  } });
  await service.save('fixture-old-gmgn-key', { bsc: ['0x' + '12'.repeat(20)] }, 'bsc');
  hangPacing = true; const old = service.finance('bsc'); const cancelled = assert.rejects(old, /已取消/);
  await blocked.promise;
  await service.save('fixture-new-gmgn-key', { bsc: ['0x' + '34'.repeat(20)] }, 'bsc');
  const result = await service.finance('bsc', { force: true }); await cancelled;
  assert.equal(result.balance, '7'); assert.equal(calls.length, 2); assert.ok(calls.every(key => key === 'fixture-new-gmgn-key'));
  assert.ok(databases.length >= 2, 'The timed-out database must have reopened');
});
