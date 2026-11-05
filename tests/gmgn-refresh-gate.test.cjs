const { test } = require('node:test');
const assert = require('node:assert/strict');
const G = require('../extension/gmgn-connection.js');
const F = require('../extension/finance-core.js');
const A = '0x' + '12'.repeat(20), B = '0x' + '34'.repeat(20);
function fixture() {
  const rows = new Map(), calls = []; let clock = 1800000000000, handler;
  const store = { get: async k => structuredClone(rows.get(k)), set: async (k, v) => rows.set(k, structuredClone(v)) };
  const options = { store, now: () => clock, wait: async ms => { clock += ms; }, requestTimeoutMs: 50,
    fetcher: async (input, init) => {
      const url = new URL(input); calls.push(url.pathname);
      const special = await handler?.(url, init); if (special) return special;
      return Response.json({ code: 0, data: init.body ? { list: JSON.parse(init.body).wallet_addresses.map(wallet_address => ({ wallet_address, realized_profit: '2.5' })) }
        : { balances: [{ wallet_address: url.searchParams.get('wallet_address'), token_address: F.native(url.searchParams.get('chain')), balance: '0.100000000000000001' }] } });
    } };
  return { rows, calls, options, service: G.create(options), now: () => clock, advance: ms => { clock += ms; }, handler: fn => { handler = fn; } };
}
async function finish(h, id) {
  for (let i = 0; i < 200; i++) { const v = await h.service.peek('bsc'); if (v?.queryId === id && !v.refreshing) return v; await new Promise(r => setTimeout(r, 2)); }
  assert.fail('query failed to finish');
}
test('GMGN repeat clicks, manual tests and unchanged saves reuse one result for at least 60 seconds across worker restarts', async () => {
  const h = fixture(); await h.service.save('fixture-not-a-real-api-key', { bsc: [A, B] }, 'bsc');
  const starts = await Promise.all(Array.from({ length: 10 }, () => h.service.start('bsc')));
  assert.equal(new Set(starts.map(v => v.queryId)).size, 1);
  const value = await finish(h, starts[0].queryId); assert.equal(h.calls.length, 3);
  assert.ok(value.nextRefreshAt >= value.at + 60000);
  for (let i = 0; i < 10; i++) {
    const again = await h.service.start('bsc'); assert.equal(again.queryId, value.queryId); assert.equal(again.refreshing, false); assert.equal(again.balance, value.balance);
  }
  await h.service.save('', { bsc: [B, A, A] }, 'bsc');
  assert.equal((await h.service.test()).cached, true);
  h.service = G.create(h.options); assert.equal((await h.service.start('bsc')).queryId, value.queryId);
  h.advance(59999); await h.service.finance('bsc', { force: true }); assert.equal(h.calls.length, 3);
  h.advance(1); const fresh = await h.service.start('bsc'); assert.notEqual(fresh.queryId, value.queryId);
  await finish(h, fresh.queryId); assert.equal(h.calls.length, 6);
});
test('GMGN 429 retains exact previous balance, current valid PnL and field timestamps; Retry-After outranks the local gate on every chain', async () => {
  const h = fixture(); await h.service.save('fixture-not-a-real-api-key', { bsc: [A, B], eth: [A] }, 'bsc');
  const first = await h.service.finance('bsc'); h.advance(61000);
  h.handler(url => url.pathname.endsWith('wallet_token_balance') ? Response.json({ code: 429, reset_at: (h.now() + 180000) / 1000 }, { status: 429, headers: { 'Retry-After': '120' } }) : undefined);
  const limited = await h.service.finance('bsc');
  assert.equal(limited.balance, first.balance); assert.equal(limited.balanceAt, first.balanceAt); assert.ok(limited.pnlAt > first.pnlAt);
  assert.deepEqual(limited.staleFields, ['balance']); assert.match(limited.reason, /限频/); assert.equal(limited.cooldownReason, 'rate-limit');
  assert.ok(limited.nextRefreshAt >= h.now() + 170000);
  const count = h.calls.length;
  h.service = G.create(h.options); h.advance(61000);
  assert.equal((await h.service.start('bsc')).balance, first.balance);
  const other = await h.service.start('eth'); assert.equal(other.balance, null); assert.equal(other.refreshing, false); assert.match(other.reason, /限频/);
  await h.service.save('fixture-new-account-api-key', { bsc: [B] }, 'bsc');
  const edited = await h.service.start('bsc'); assert.equal(edited.balance, null); assert.equal(h.calls.length, count);
  h.advance(180000); h.handler(null); assert.equal((await h.service.finance('bsc')).balance, '0.100000000000000001');
});
test('GMGN interrupted MV3 attempt remains gated without being reported as permanently running', async () => {
  const h = fixture(); await h.service.save('fixture-not-a-real-api-key', { bsc: [A] }, 'bsc');
  let enter; const entered = new Promise(r => { enter = r; });
  h.handler(() => { enter(); return new Promise(() => {}); });
  const start = await h.service.start('bsc'); await entered;
  const restart = G.create(h.options), cached = await restart.start('bsc');
  assert.equal(cached.queryId, start.queryId); assert.equal(cached.refreshing, false); assert.match(cached.reason, /中断/); assert.equal(h.calls.length, 1);
  await finish(h, start.queryId); h.advance(61000); h.handler(null);
  assert.equal((await restart.finance('bsc')).balance, '0.100000000000000001');
});
test('GMGN missing first-time balance never becomes zero and does not cause repeated requests inside the gate', async () => {
  const h = fixture(); await h.service.save('fixture-not-a-real-api-key', { bsc: [A, B] }, 'bsc');
  h.handler(url => url.pathname.endsWith('wallet_token_balance') ? Response.json({ code: 0, data: { balances: [] } }) : undefined);
  const first = await h.service.finance('bsc'); assert.equal(first.balance, null); assert.equal(first.pnl, '5.0');
  const count = h.calls.length;
  for (let i = 0; i < 5; i++) { const value = await h.service.start('bsc'); assert.equal(value.balance, null); assert.equal(value.refreshing, false); }
  assert.equal(h.calls.length, count);
});
test('GMGN upgrade recovers a failed old cache from its same-account diagnostic without inventing a new timestamp', async () => {
  const h = fixture(); await h.service.save('fixture-not-a-real-api-key', { bsc: [A] }, 'bsc');
  const report = (await h.service.test()).report; const cache = h.rows.get('finance-cache-bsc');
  h.advance(900000); cache.at = h.now(); cache.value = { ...cache.value, at: h.now(), balance: null, reason: 'GMGN 限频', nextRefreshAt: h.now() + 60000 };
  h.rows.set('finance-cache-bsc', cache);
  const value = await h.service.start('bsc'); assert.equal(value.balance, report.finance.balance); assert.equal(value.balanceAt, report.finance.balanceAt); assert.deepEqual(value.staleFields, ['balance']);
  await h.service.save('', { bsc: [B] }, 'bsc'); h.handler(url => url.pathname.endsWith('wallet_token_balance') ? Response.json({ code: 0, data: { balances: [] } }) : undefined);
  assert.equal((await h.service.finance('bsc')).balance, null);
});
test('live BSC response sample remains human units and native zero is accepted only with a matching complete row', () => {
  const values = ['0', '0.00000054134761545', '0.889206085543872509', '0.021486902380506314', '0.057806368804568112', '0.18519192302950768'];
  const balances = values.map(balance => F.balance({ balances: [{ wallet_address: A, token_address: F.native('bsc'), balance, decimal: 0 }] }, 'bsc', A));
  assert.equal(F.sum(balances), '1.153691821106070065');
  assert.equal(F.balance({ balances: [] }, 'bsc', A), null);
  assert.equal(F.balance({ balances: [{ wallet_address: B, token_address: F.native('bsc'), balance: '0' }] }, 'bsc', A), null);
});
test('GMGN HTTP 200 rate-limit envelopes also halt queued balance work and preserve reset_at', async () => {
  for (const code of [429, '429', 'RATE_LIMIT_BANNED']) {
    const h = fixture(); await h.service.save('fixture-not-a-real-api-key', { bsc: [A, B] }, 'bsc');
    const reset = h.now() + 300000;
    h.handler(() => Response.json({ code, reset_at: reset / 1000 }));
    const value = await h.service.finance('bsc'); assert.match(value.reason, /限频/); assert.equal(value.nextRefreshAt, reset); assert.equal(h.calls.length, 1);
    await h.service.start('bsc'); h.advance(61000); await G.create(h.options).start('bsc'); assert.equal(h.calls.length, 1);
  }
});
test('GMGN a 20-wallet group stops admitting calls at its deadline and leaves a terminal cached result', async () => {
  const h = fixture(); h.service = G.create({ ...h.options, queryMaxAgeMs: 8000 });
  const wallets = Array.from({ length: 20 }, (_, i) => '0x' + String(i + 1).padStart(40, '0'));
  await h.service.save('fixture-not-a-real-api-key', { bsc: wallets }, 'bsc');
  h.handler(() => { h.advance(1000); });
  const startedAt = h.now(), value = await h.service.finance('bsc');
  assert.ok(h.now() - startedAt < 8000); assert.ok(h.calls.length <= 3);
  assert.equal(value.balance, null); assert.equal(value.pnl, '50.0'); assert.match(value.reason, /超时/);
  assert.equal((await h.service.peek('bsc')).refreshing, false);
  const count = h.calls.length; const cached = await h.service.start('bsc'); assert.equal(cached.queryId, value.queryId); assert.equal(h.calls.length, count);
});
