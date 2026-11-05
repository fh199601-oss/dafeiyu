const { test } = require('node:test');
const assert = require('node:assert/strict');
const G = require('../extension/gmgn-connection.js');
const F = require('../extension/finance-core.js');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const ADDRESS = '0x' + '12'.repeat(20);

async function fixture() {
  let clock = 1800000000000, profit = '0', pauseProfit, pauseRead;
  const data = new Map(), calls = [];
  const store = {
    async get(key) {
      const value = structuredClone(data.get(key));
      if (pauseRead?.key === key) { const gate = pauseRead; pauseRead = null; gate.entered.resolve(); await gate.release.promise; }
      return value;
    },
    async set(key, value) { data.set(key, structuredClone(value)); }
  };
  const service = G.create({ store, now: () => clock, wait: async ms => { clock += ms; }, fetcher: async (input, init) => {
    const url = new URL(input); calls.push(url.pathname);
    if (init.body) {
      if (pauseProfit) { const gate = pauseProfit; pauseProfit = null; await gate.promise; }
      return Response.json({ code: 0, data: { list: [{ wallet_address: ADDRESS, realized_profit: profit }] } });
    }
    return Response.json({ code: 0, data: { balances: [{ wallet_address: ADDRESS, token_address: F.native('bsc'), balance: '1' }] } });
  } });
  await service.save('fixture-refresh-race-key', { bsc: [ADDRESS] }, 'bsc');
  await service.finance('bsc'); clock += 61000; profit = '-87.25'; pauseProfit = deferred();
  const releaseProfit = pauseProfit.resolve;
  await service.start('bsc');
  // Capture the same in-flight query without starting another API read.
  const final = service.finance('bsc');
  await new Promise(resolve => setImmediate(resolve));
  return { service, calls, final, releaseProfit, holdRead(key) {
    const gate = { key, entered: deferred(), release: deferred() }; pauseRead = gate; return gate;
  } };
}

test('GMGN poll cannot mark an old zero as finished when the current query completes during an IDB read', async () => {
  const h = await fixture();
  const gate = h.holdRead('cooldown');
  const polling = h.service.peek('bsc'); await gate.entered.promise;
  h.releaseProfit(); const final = await h.final; assert.equal(final.pnl, '-87.25');
  gate.release.resolve(); const visible = await polling;
  assert.equal(visible.pnl, '-87.25');
  assert.equal(visible.refreshing, false);
  assert.equal(visible.queryId, final.queryId);
  assert.equal(h.calls.length, 4);
});

test('GMGN repeat click and settings test use the just-finished cache, not a pre-refresh snapshot', async () => {
  const h = await fixture();
  const gate = h.holdRead('finance-attempt-bsc');
  const clicking = h.service.start('bsc'); await gate.entered.promise;
  h.releaseProfit(); const final = await h.final;
  gate.release.resolve(); const visible = await clicking;
  assert.equal(visible.pnl, final.pnl);
  assert.equal(visible.queryId, final.queryId);
  assert.equal(visible.refreshing, false);
  assert.equal((await h.service.test()).report.finance.pnl, final.pnl);
  assert.equal(h.calls.length, 4, 'The one-minute gate still prevents extra requests');
});
