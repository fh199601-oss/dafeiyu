const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create, sanitize } = require('../extension/gmgn-connection.js');
const KEY = 'unit-test-api-key-never-real';
const address = '0x' + '12'.repeat(20);
function memory() {
  const values = new Map();
  return { get: async key => structuredClone(values.get(key)), set: async (key, value) => { values.set(key, structuredClone(value)); } };
}
function fixture(handler) {
  let clock = Date.parse('2026-10-28T06:00:00Z'); const calls = [], store = memory();
  const options = { store, now: () => clock, wait: async ms => { clock += ms; }, fetcher: async (url, options) => {
    calls.push({ url: new URL(url), options }); return handler(new URL(url), options, clock);
  } };
  return { service: create(options), options, store, calls, advance: n => { clock += n; } };
}
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
test('real empty-wallet response is authentication success, not a zero balance or a profitable account', async () => {
  const f = fixture(() => json({ code: 0, data: { wallets: [] } }));
  await f.service.save(KEY); const { report } = await f.service.test();
  assert.equal(report.account.ok, true); assert.equal(report.scope.walletCount, 0);
  assert.ok(report.message.includes('空钱包列表')); assert.ok(report.message.includes('无需开启交易权限'));
  assert.equal(f.calls.length, 1); assert.deepEqual(report.profits, []);
});
test('diagnostic preserves money/unknown total fields but strips echoed secrets and unrelated identity', () => {
  const value = sanitize({ total_assets_usd: '8452.123', daily_profit: '+562', api_key: KEY, arbitrary: `echo=${KEY}`,
    email: 'person@example.com', wallets: [{ chain: 'base', address, balance: '3.5' }], token: { symbol: 'ETH', price: '3000' },
    nested: { session: { value: 'secret' }, name: 'Private Display Name' }, [KEY]: 123 }, KEY);
  assert.equal(value.total_assets_usd, '8452.123'); assert.equal(value.wallets[0].balance, '3.5');
  assert.equal(value.wallets[0].address, address); assert.equal(value.token.symbol, 'ETH');
  for (const secret of [KEY, 'person@example.com', 'Private Display Name', 'secret']) assert.ok(!JSON.stringify(value).includes(secret));
});
test('connection probes all returned documented chains, deduplicates concurrent tests, never claims 1d is today', async () => {
  const f = fixture((url, opts) => url.pathname.endsWith('/info') ? json({ code: 0, data: { wallets: [
    { chain: 'bsc', address }, { chain: 'base', address }, { chain: 'eth', address }, { chain: 'tron', address: 'T' + '1'.repeat(33) },
    { chain: 'bsc', address }, { chain: KEY, address }], total_value: '8452' } }) : json({ code: 0, data: { list: [{ wallet_address: address, realized_profit: '-12' }] } }));
  await f.service.save(KEY);
  const [a, b] = await Promise.all([f.service.test(), f.service.test()]);
  assert.deepEqual(a, b); assert.equal(f.calls.length, 4);
  assert.deepEqual(a.report.scope.chains, ['bsc', 'base', 'eth', 'tron']);
  assert.equal(a.report.scope.walletCount, 4); assert.ok(a.report.interpretation.todayPnl.includes('尚未确认'));
  assert.ok(a.report.profits.find(row => row.chain === 'tron').skipped);
  for (const call of f.calls) {
    assert.equal(call.url.origin, 'https://openapi.gmgn.ai'); assert.ok(call.url.searchParams.get('client_id'));
    assert.ok(!call.url.href.includes(KEY)); assert.equal(call.options.headers['X-APIKEY'], KEY);
    assert.equal(call.options.credentials, 'omit'); assert.equal(call.options.redirect, 'error');
    if (call.options.body) assert.equal(JSON.parse(call.options.body).period, '1d');
  }
  const restarted = create(f.options);
  assert.equal((await restarted.status()).configured, true);
  assert.ok(!JSON.stringify(await restarted.status()).includes(KEY));
  assert.ok(!JSON.stringify(await restarted.report()).includes(KEY));
  await restarted.test(); assert.equal(f.calls.length, 4, 'short cache survives service-worker restart');
  await restarted.clear(); assert.equal((await restarted.status()).configured, false); assert.equal(await restarted.report(), null);
});
test('401 response cannot echo the API key into report, status or error text', async () => {
  const f = fixture(() => json({ code: 401, message: `bad credentials ${KEY}`, error: KEY }, 401));
  await f.service.save(KEY); const { report } = await f.service.test();
  assert.equal(report.account.ok, false); assert.ok(!JSON.stringify(report).includes(KEY)); assert.equal(f.calls.length, 1);
});
test('429 stops probes and persists cooldown across worker restarts and clearing credentials', async () => {
  const f = fixture((url, opts, clock) => json({ code: 429, error: 'RATE_LIMIT_BANNED', reset_at: clock / 1000 + 300 }, 429));
  await f.service.save(KEY); const result = await f.service.test(); assert.equal(result.report.account.ok, false);
  const restarted = create(f.options); await assert.rejects(restarted.test(), /限频/); assert.equal(f.calls.length, 1);
  await restarted.clear(); await restarted.save('another-valid-test-key'); await assert.rejects(restarted.test(), /限频/);
  assert.equal(f.calls.length, 1);
});
test('new credentials and clear cancel an in-flight response so it cannot restore old account data', async () => {
  let release, entered;
  const fetching = new Promise(resolve => { entered = resolve; });
  const f = fixture(() => { entered(); return new Promise(resolve => { release = () => resolve(json({ code: 0, data: { wallets: [] } })); }); });
  await f.service.save(KEY); const pending = f.service.test(); await fetching;
  const rejection = assert.rejects(pending, /取消/);
  await f.service.clear(); release(); await rejection;
  assert.equal((await f.service.status()).configured, false); assert.equal(await f.service.report(), null);
});
