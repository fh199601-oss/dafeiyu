const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../extension/finance-core.js');
const { create } = require('../extension/gmgn-connection.js');
const A = '0x' + '12'.repeat(20), B = '0x' + '34'.repeat(20), owner = 'a'.repeat(64);
const snapshot = addresses => ({ owner, chains: { bsc: { addresses, archived: 28 }, sol: { addresses: ['So11111111111111111111111111111111111111112'], archived: 4 } } });
function harness(handler) {
  const records = new Map(), calls = []; let clock = 1800000000000;
  const options = { store: { get: async key => structuredClone(records.get(key)), set: async (key, value) => records.set(key, structuredClone(value)) },
    now: () => clock, wait: async ms => { clock += ms; }, fetcher: async (url, options) => {
      const parsed = new URL(url), body = options.body ? JSON.parse(options.body) : null; calls.push({ url: parsed, body });
      const data = handler ? await handler(parsed, body) : parsed.pathname.endsWith('wallet_profits')
        ? { list: body.wallet_addresses.map(wallet_address => ({ wallet_address, realized_profit: wallet_address === A ? '-507.36' : '-94.58', total_profit: '-99000' })) }
        : { balances: [{ wallet_address: parsed.searchParams.get('wallet_address'), token_address: parsed.searchParams.get('token_address'), balance: parsed.searchParams.get('wallet_address') === A ? '0.889206085543872509' : '0.18519192302950768', decimal: 0 }] };
      return data instanceof Response ? data : new Response(JSON.stringify({ code: 0, data }));
    } };
  return { service: create(options), options, calls, records, advance: ms => { clock += ms; } };
}
test('own-wallet cache is explicit, owner-bound and chain-aware; EVM aliases do not change the container chain', () => {
  const cache = JSON.stringify({ bsc: { list: [{ user_id: 'owner', chain: 'bsc', address: A }, { user_id: 'owner', chain: 'bsc', address: A.toUpperCase().replace('0X', '0x') }], archive_count: 28 },
    base: { list: [{ user_id: 'owner', chain: 'bsc', address: A }], archive_count: 28 } });
  const data = F.walletCache(cache); assert.equal(data.chains.bsc.addresses.length, 1); assert.equal(data.chains.base.addresses[0], A);
  assert.equal(data.chains.bsc.archived, 28); assert.equal(F.walletCache('{}'), null);
  assert.equal(F.walletCache(JSON.stringify({ bsc: { list: [{ user_id: 'one', address: A }, { user_id: 'two', address: B }] } })), null);
  assert.equal(F.walletCache(JSON.stringify({ following_wallets: { [A]: {} } })), null);
  assert.equal(F.context('https://evilgmgn.ai/?chain=bsc'), null); assert.equal(F.context('https://gmgn.ai/profile/fixture-user?chain=base').chain, 'base');
});
test('decimal aggregation is exact, missing fields fail closed, display never substitutes all-time PnL', () => {
  assert.equal(F.sum(['0.1', '0.2']), '0.3'); assert.equal(F.sum(['-507.3630911731022866519', '-94.57826412865624723167']), '-601.94135530175853388357');
  assert.equal(F.format('-601.94135530175853388357', 2, true), '-$601.94'); assert.equal(F.format('1.103459540510144421', 8), '1.10345954');
  assert.equal(F.format('0', 2, true), '$0.00'); assert.equal(F.format(null), null); assert.equal(F.sum(['1', null]), null);
  assert.equal(F.profits({ list: [{ wallet_address: A, total_profit: '-1000' }] }, 'bsc', [A]), null);
  assert.equal(F.profits({ list: [{ wallet_address: A, realized_profit: '1' }, { wallet_address: A, realized_profit: '2' }] }, 'bsc', [A, B]), null);
  assert.equal(F.balance({ balances: [{ wallet_address: A, token_address: B, balance: '3' }] }, 'bsc', A), null);
});
test('API finance sums all configured chain wallets, deduplicates clicks, persists cache and ignores empty account discovery', async () => {
  const h = harness(); await h.service.save('unit-test-no-real-credential', { bsc: [A, B] }, 'bsc');
  const [a, b] = await Promise.all([h.service.finance('bsc'), h.service.finance('bsc')]);
  assert.deepEqual(a, b); assert.equal(a.balance, '1.074398008573380189'); assert.equal(a.pnl, '-601.94'); assert.equal(a.count, 2);
  assert.equal(h.calls.length, 3); assert.equal(h.calls[0].body.period, '1d');
  assert.ok(h.calls.every(call => call.url.origin === 'https://openapi.gmgn.ai' && !call.url.href.includes('credential')));
  const restarted = create(h.options); assert.deepEqual(await restarted.finance('bsc'), { ...a, cached: true, refreshing: false }); assert.equal(h.calls.length, 3);
  h.advance(61000); await restarted.finance('bsc'); assert.equal(h.calls.length, 6);
  const unsupported = await restarted.finance('xlayer'); assert.ok(unsupported.reason.includes('暂未')); assert.equal(unsupported.balance, null);
  assert.equal((await restarted.status()).wallets.chains.bsc.count, 2);
});
test('one missing wallet balance never becomes a smaller aggregate or zero', async () => {
  const h = harness((url, body) => body ? { list: body.wallet_addresses.map(wallet_address => ({ wallet_address, realized_profit: '0' })) }
    : { balances: url.searchParams.get('wallet_address') === B ? [] : [{ wallet_address: A, token_address: F.native('bsc'), balance: '1' }] });
  await h.service.save('unit-test-no-real-credential', { bsc: [A, B] }, 'bsc');
  const result = await h.service.finance('bsc'); assert.equal(result.balance, null); assert.equal(result.pnl, '0'); assert.ok(result.reason);
});
test('429 halts remaining wallet calls and keeps cooldown after service-worker restart', async () => {
  const h = harness(() => new Response(JSON.stringify({ code: 429, error: 'RATE_LIMIT_EXCEEDED' }), { status: 429 }));
  await h.service.save('unit-test-no-real-credential', { bsc: [A, B] }, 'bsc');
  const result = await h.service.finance('bsc'); assert.equal(result.balance, null); assert.equal(h.calls.length, 1);
  h.advance(20000); await create(h.options).finance('bsc'); assert.equal(h.calls.length, 1);
});
test('account switch cancels an in-flight result and cannot restore the prior account into cache', async () => {
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const h = harness(() => { started(); return new Promise(resolve => { release = () => resolve({ list: [{ wallet_address: A, realized_profit: '123' }] }); }); });
  await h.service.save('unit-test-no-real-credential', { bsc: [A] }, 'bsc');
  const pending = h.service.finance('bsc'); await entered; const rejects = assert.rejects(pending, /取消/);
  await h.service.clear(); release(); await rejects;
  const result = await h.service.finance('bsc'); assert.equal(result.balance, null); assert.ok(result.reason.includes('API Key'));
  assert.equal(h.records.get('finance-cache-bsc'), undefined);
});

test('manual lists validate each chain, deduplicate, survive legacy sync and invalidate previews on edit', async () => {
  assert.equal(F.manualWallets({ bsc: A + '\n' + A.toUpperCase().replace('0X', '0x') }, 'bsc').chains.bsc.addresses.length, 1);
  assert.throws(() => F.manualWallets({ bsc: 'not-an-address' }, 'bsc'), /格式错误/);
  assert.throws(() => F.manualWallets({ bsc: A }, 'sol'), /默认网络/);
  const h = harness(); await h.service.save('unit-test-no-real-credential', { bsc: [A, B] }, 'bsc');
  const value = await h.service.finance('bsc');
  assert.equal((await h.service.peek('bsc')).balance, value.balance);
  await h.service.syncWallets(snapshot([B]), 'bsc');
  assert.equal((await h.service.status()).wallets.chains.bsc.count, 2);
  assert.equal((await h.service.peek('bsc')).balance, value.balance);
  await h.service.save('', { bsc: [B] }, 'bsc'); assert.equal(await h.service.peek('bsc'), null);
  await h.service.finance('bsc'); h.advance(300001); assert.equal(await h.service.peek('bsc'), null);
  await h.service.clear(); assert.equal(await h.service.peek('bsc'), null);
});

test('manual diagnostic bypasses account enumeration and legacy force cannot bypass the refresh cooldown', async () => {
  const h = harness(); await h.service.save('unit-test-no-real-credential', { bsc: [A] }, 'bsc');
  const { report } = await h.service.test(); assert.equal(report.finance.count, 1);
  assert.ok(h.calls.every(call => !call.url.pathname.endsWith('/info')));
  const count = h.calls.length; await h.service.finance('bsc', { force: true }); assert.equal(h.calls.length, count);
  h.advance(61000); await h.service.finance('bsc', { force: true }); assert.equal(h.calls.length, count + 2);
});
