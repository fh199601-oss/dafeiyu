const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { create, wallets } = require('../extension/binance-connection.js');
const C = require('../extension/core.js');
const API = 'fixtureapikey1234567890', SECRET = 'fixturesecret1234567890';
function harness(handler) {
  const records = new Map(), calls = []; let now = 1800000000000;
  const options = { store: { get: async key => structuredClone(records.get(key)), set: async (key, value) => records.set(key, structuredClone(value)) },
    now: () => now, wait: async ms => { now += ms; }, fetcher: async (url, opts) => {
      const parsed = new URL(url); calls.push({ parsed, opts });
      const data = handler ? await handler(parsed, opts) : parsed.pathname.endsWith('/time') ? { serverTime: now }
        : parsed.pathname.includes('/wallet/balance') ? [{ walletName: 'Spot', balance: '8000.1', activate: true }, { walletName: 'Funding', balance: '0.2', activate: true }]
          : { assets: [{ asset: 'USDT', marginBalance: '301.23', unrealizedProfit: '-52.4' }, { asset: 'USDC', marginBalance: '100', unrealizedProfit: '99' }] };
      return data instanceof Response ? data : new Response(JSON.stringify(data));
    } };
  return { service: create(options), options, records, calls };
}
test('website rules match exact domains/subdomains, use automatic defaults and allow an independent X choice', () => {
  assert.equal(C.sanitizeSettings({}).clickMode, 'auto');
  const settings = C.sanitizeSettings({ clickMode: 'auto', clickX: 'binance' });
  assert.equal(C.clickAction(settings, 'https://www.gmgn.ai/?chain=bsc'), 'gmgn');
  assert.equal(C.clickAction(settings, 'https://www.binance.com/zh-CN'), 'binance');
  assert.equal(C.clickAction(settings, 'https://x.com/person/status/123'), 'binance');
  assert.equal(C.clickAction(settings, 'https://binance.com.evil.test/'), 'companion');
  assert.equal(C.clickAction(settings, 'https://notx.com/'), 'companion');
});
test('Binance signatures use only approved GET endpoints; total and USDT-only PnL remain distinct', async () => {
  const h = harness(); await h.service.save(API, SECRET);
  const result = await h.service.finance('assets-pnl');
  assert.equal(result.rows[0].amount, '8000.3'); assert.equal(result.rows[1].amount, '-52.4');
  assert.ok(result.scope.includes('不是全账户今日盈亏'));
  for (const { parsed, opts } of h.calls) {
    assert.equal(opts.method, 'GET'); assert.equal(opts.redirect, 'error'); assert.equal(opts.credentials, 'omit');
    assert.ok(['api.binance.com', 'fapi.binance.com'].includes(parsed.host));
    if (parsed.pathname.endsWith('/time')) { assert.equal(opts.headers['X-MBX-APIKEY'], undefined); continue; }
    const signature = parsed.searchParams.get('signature'); parsed.searchParams.delete('signature');
    assert.equal(signature, createHmac('sha256', SECRET).update(parsed.searchParams.toString()).digest('hex'));
    assert.equal(opts.headers['X-MBX-APIKEY'], API);
  }
  assert.ok(!JSON.stringify(await h.service.status()).includes(SECRET));
  const count = h.calls.length; await h.service.finance('assets-pnl'); assert.equal(h.calls.length, count + 2, 'second click refreshes both balances but reuses calibrated clocks');
});
test('a missing/duplicate balance is rejected; a failed futures request preserves valid asset total without inventing PnL', async () => {
  assert.throws(() => wallets([{ walletName: 'Spot', activate: true }]), /不完整/);
  assert.throws(() => wallets([{ walletName: 'Spot', balance: '1', activate: true }, { walletName: 'Spot', balance: '2', activate: true }]), /不完整/);
  const h = harness(url => url.pathname.endsWith('/time') ? { serverTime: 1800000000000 } : url.hostname === 'fapi.binance.com'
    ? new Response(JSON.stringify({ code: -2015, msg: SECRET }), { status: 401 }) : [{ walletName: 'Spot', balance: '42', activate: true }]);
  await h.service.save(API, SECRET); const result = await h.service.finance('assets-pnl');
  assert.equal(result.rows[0].amount, '42'); assert.equal(result.rows[1].amount, null); assert.ok(result.reason);
  assert.ok(!JSON.stringify(result).includes(SECRET));
});
test('rate-limit cooldown persists across restart; clearing a key prevents reuse of any financial results', async () => {
  const h = harness(() => new Response('{}', { status: 429, headers: { 'Retry-After': '120' } }));
  await h.service.save(API, SECRET); await h.service.finance('assets'); assert.equal(h.calls.length, 1);
  await create(h.options).finance('assets'); assert.equal(h.calls.length, 1);
  await h.service.clear(); const result = await h.service.finance(); assert.equal(result.rows.length, 0); assert.equal(h.calls.length, 1);
});
test('clearing credentials cancels an in-flight query and cannot restore its credential record', async () => {
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const h = harness(() => { entered(); return new Promise(resolve => { release = () => resolve({ serverTime: 1800000000000 }); }); });
  await h.service.save(API, SECRET); const pending = h.service.finance(); const rejected = assert.rejects(pending, /已更改/);
  await started; await h.service.clear(); release(); await rejected; assert.equal(h.records.get('account'), null);
});

test('cached previews persist but disappear after credential changes, clear, or age expiry', async () => {
  const h = harness(); await h.service.save(API, SECRET);
  await h.service.finance('assets-pnl'); const cached = await create(h.options).peek('assets-pnl');
  assert.equal(cached.cached, true); assert.equal(cached.rows[1].amount, '-52.4');
  const saved = h.records.get('finance-results'); saved.results['assets-pnl'].at -= 300001;
  assert.equal(await h.service.peek('assets-pnl'), null);
  await h.service.finance('assets'); await h.service.save(API, SECRET); assert.equal(await h.service.peek('assets'), null);
  await h.service.finance('assets'); await h.service.clear(); assert.equal(await h.service.peek('assets'), null);
});
