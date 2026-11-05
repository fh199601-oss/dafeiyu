const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../extension/binance-pnl.js');
const B = require('../extension/binance-connection.js');
const day = Date.UTC(2026, 9, 28), end = day + 12 * 3600000;
const snapshot = (type, data) => ({ code: 200, snapshotVos: [{ type: type.toLowerCase(), updateTime: day - 1000, data }] });
const cached = (_, __, get) => get();

test('successful empty assets mean zero, but missing or contradictory fields remain invalid', () => {
  assert.equal(B.wallets([]).total, '0');
  assert.deepEqual(B.futures({ assets: [], positions: [], totalUnrealizedProfit: '' }), { equity: '0', pnl: '0', empty: true });
  assert.throws(() => B.wallets(null)); assert.throws(() => B.futures({}));
  assert.throws(() => B.futures({ assets: [], totalUnrealizedProfit: '100' }));
  assert.throws(() => B.futures({ assets: [{ asset: 'USDT', marginBalance: '0' }] }));
});
test('UTC baseline must belong to the immediately preceding day; decimal valuation is exact', () => {
  assert.equal(P.multiply('0.00005449', '100000.12345678'), '5.4490067271599422');
  assert.equal(P.baseline(snapshot('SPOT', {}), day, 'SPOT').updateTime, day - 1000);
  assert.throws(() => P.baseline(snapshot('SPOT', {}), day + P.DAY, 'SPOT'), /基准/);
  assert.throws(() => P.baseline({ code: 200, snapshotVos: [] }, day, 'SPOT'), /基准/);
});
test('spot today subtracts deposits and inbound transfers, adds withdrawals and outgoing transfers', async () => {
  const read = async (route, query) => {
    if (route === 'snapshot') return snapshot('SPOT', { totalAssetOfBtc: '0.001' });
    if (route === 'klines') return [[Number(query.startTime), '100000', 0, 0, '100000']];
    if (route === 'deposits') return [{ id: 'deposit1', coin: 'USDT', amount: '20', status: 1, walletType: 0, completeTime: day + 1000 }];
    if (route === 'withdrawals') return [{ id: 'withdraw1', coin: 'USDT', amount: '10', status: 6, walletType: 0, completeTime: '2026-10-28 00:01:00' }];
    if (route === 'transfers') {
      const amount = query.type === 'FUNDING_MAIN' ? '25' : query.type === 'MAIN_FUNDING' ? '5' : null;
      return { total: amount ? 1 : 0, rows: amount ? [{ tranId: query.type, type: query.type, asset: 'USDT', amount, status: 'CONFIRMED', timestamp: day + 5000 }] : [] };
    }
    throw new Error('Unexpected route');
  };
  const result = await P.spotToday({ read, cached, end, spot: '150' });
  assert.equal(Number(result.amount), 20); assert.equal(Number(result.netFlows), 30);
  assert.equal(result.day, day); assert.match(result.scope, /未覆盖理财/);
});
test('incomplete cash-flow pages fail instead of treating missing transfers as zero', async () => {
  assert.deepEqual(await P.collect(async () => ({ total: 0 }), 'transfers', {}, true), []);
  await assert.rejects(P.collect(async () => ({ total: 1, rows: [] }), 'transfers', {}, true), /不完整/);
  await assert.rejects(P.collect(async () => [{ id: 'same' }, { id: 'same' }], 'deposits', {}), /重复/);
});
test('futures daily PnL includes realized PnL, fees, funding and only the change in unrealized PnL', async () => {
  const types = [['REALIZED_PNL', '20'], ['COMMISSION', '-2'], ['FUNDING_FEE', '-1'], ['TRANSFER', '1000']];
  const read = async route => route === 'income' ? types.map(([incomeType, income], i) => ({ incomeType, income, asset: 'USDT', tranId: i, time: day + 1000 }))
    : snapshot('FUTURES', { assets: [{ asset: 'USDT', marginBalance: '105', walletBalance: '100' }] });
  const result = await P.futuresToday({ read, cached, end, current: { pnl: '10' } });
  assert.equal(Number(result.amount), 22);
  const empty = await P.futuresToday({ read: async () => [], cached: () => { throw new Error('Empty account needs no baseline'); }, end, current: { pnl: '0', empty: true } });
  assert.equal(empty.amount, '0');
});
test('unsupported futures settlement assets cannot masquerade as combined account PnL', async () => {
  await assert.rejects(P.futuresToday({ read: async () => [{ incomeType: 'REALIZED_PNL', asset: 'USDC', income: '10', tranId: 1, time: day + 1 }], cached, end, current: { pnl: '0' } }), /未支持/);
});
test('daily service handles first use, caches only the opening baseline, falls back to spot and clears it on key change', async () => {
  const records = new Map(); let amount = '150', snapshots = 0, failFutures = false;
  const service = B.create({ now: () => end, wait: async () => {},
    store: { get: async key => structuredClone(records.get(key)), set: async (key, value) => records.set(key, structuredClone(value)) },
    fetcher: async (url, options) => {
      const u = new URL(url); assert.equal(options.method, 'GET'); let data;
      if (u.pathname.endsWith('/time')) data = { serverTime: end };
      else if (u.pathname.endsWith('/wallet/balance')) data = [{ walletName: 'Spot', balance: amount, activate: true }];
      else if (u.pathname.endsWith('/accountSnapshot')) { snapshots++; data = snapshot('SPOT', { totalAssetOfBtc: '0.001' }); }
      else if (u.pathname.endsWith('/klines')) data = [[Number(u.searchParams.get('startTime')), '100000', 0, 0, '100000']];
      else if (u.pathname.endsWith('/asset/transfer')) data = { total: 0 };
      else if (u.pathname === '/fapi/v3/account') { if (failFutures) return new Response('{"code":-2015}', { status: 401 }); data = { assets: [], positions: [] }; }
      else data = [];
      return new Response(JSON.stringify(data));
    } });
  await service.save('firstapikey1234567890', 'fixturesecret1234567890');
  let result = await service.finance('daily-pnl'); assert.equal(result.reason, ''); assert.equal(Number(result.rows[1].amount), 50);
  assert.equal(result.rows[1].label, '今日总盈亏');
  for (const oldLabel of ['现货+U今日估算', '今日账户总盈亏']) {
  records.get('finance-results').results['daily-pnl'].rows[1].label = oldLabel;
  const legacyCache = await service.peek('daily-pnl');
  assert.equal(legacyCache.rows[1].label, '今日总盈亏'); assert.equal(Number(legacyCache.rows[1].amount), 50);
  }
  amount = '160'; result = await service.finance('daily-pnl'); assert.equal(Number(result.rows[1].amount), 60); assert.equal(snapshots, 1);
  failFutures = true; result = await service.finance('daily-pnl'); assert.equal(result.reason, ''); assert.equal(result.rows[1].label, '现货今日估算'); assert.match(result.scope, /合约未纳入/);
  await service.save('secondapikey123456789', 'otherfixturesecret12345'); assert.equal(records.get('daily-baselines'), null);
  await service.finance('spot-daily'); assert.equal(snapshots, 2);
  assert.ok(!JSON.stringify(await service.status()).includes('secondapikey'));
  await service.clear(); assert.equal(records.get('daily-baselines'), null);
});

function baselineHarness({ balance = '458.59138025', snapshots = ['0.00000586', '0.00591076'], price = '77582.02', failCheck = false } = {}) {
  const records = new Map(), calls = []; let clock = end, count = 0;
  const options = { now: () => clock, wait: async () => {},
    store: { get: async key => structuredClone(records.get(key)), set: async (key,value) => records.set(key,structuredClone(value)) },
    fetcher: async (url, opts) => {
      const u = new URL(url); assert.equal(opts.method,'GET'); calls.push(u.pathname); let data;
      if (u.pathname.endsWith('/time')) data = { serverTime:clock };
      else if (u.pathname.endsWith('/wallet/balance')) data = [{ walletName:'Spot',balance,activate:true }];
      else if (u.pathname.endsWith('/accountSnapshot')) {
        count++;
        if (failCheck && count > 1) return Response.json({code:-1000},{status:503});
        data = snapshot('SPOT',{totalAssetOfBtc:snapshots[Math.min(count-1,snapshots.length-1)]});
      } else if (u.pathname.endsWith('/klines')) data = [[Number(u.searchParams.get('startTime')),price,0,0,price]];
      else if (u.pathname.endsWith('/asset/transfer')) data = {total:0};
      else if (u.pathname === '/fapi/v3/account') data = {assets:[],positions:[]};
      else data = [];
      return Response.json(data);
    } };
  return { service:B.create(options),options,records,calls,advance:ms=>{clock+=ms;},count:()=>count };
}

test('a partial opening snapshot cannot turn an unchanged USDT holding into hundreds of profit', async () => {
  const h=baselineHarness(); await h.service.save('fixtureapikey12345678','fixturesecret12345678');
  const value=await h.service.finance('daily-pnl');
  assert.equal(value.reason,''); assert.equal(value.rows[1].amount,'0.0226797148');
  assert.equal(value.daily.openingSpot,'458.5687005352');
  assert.equal(value.daily.baselineCorrected,true); assert.equal(value.daily.baselineRechecked,true); assert.equal(h.count(),2);
  await h.service.finance('daily-pnl'); assert.equal(h.count(),2,'Repeated clicks reuse the corrected baseline');
});

test('a failed baseline verification preserves total assets but never publishes the suspect PnL', async () => {
  const h=baselineHarness({failCheck:true}); await h.service.save('fixtureapikey12345678','fixturesecret12345678');
  const value=await h.service.finance('daily-pnl');
  assert.equal(value.rows[0].amount,'458.59138025'); assert.equal(value.rows[1].amount,null); assert.ok(value.reason);
  assert.equal((await h.service.peek('daily-pnl')).rows[1].amount,null);
});

test('a large genuine positive or negative move stays intact after consistent baseline checks', async () => {
  for (const [balance,btc,expected] of [['400','0.001',300],['100','0.004',-300]]) {
    const h=baselineHarness({balance,snapshots:[btc],price:'100000'}); await h.service.save('fixtureapikey12345678','fixturesecret12345678');
    const value=await h.service.finance('daily-pnl'); assert.equal(value.reason,''); assert.equal(Number(value.rows[1].amount),expected);
    assert.equal(h.count(),2); await h.service.finance('daily-pnl'); assert.equal(h.count(),2,'Verification is shared for one minute');
    h.advance(61000); await h.service.finance('daily-pnl'); assert.equal(h.count(),3);
  }
});

test('still-changing large baselines are invalidated, and do not become valid on the next click', async () => {
  const h=baselineHarness({balance:'400',snapshots:['0.0005','0.0007'],price:'100000'}); await h.service.save('fixtureapikey12345678','fixturesecret12345678');
  const value=await h.service.finance('daily-pnl'); assert.equal(value.rows[1].amount,null); assert.match(value.reason,/快照仍在修正/);
  assert.equal(h.records.get('daily-baselines').entries.SPOT,undefined);
});

test('daily baselines expire within fifteen minutes instead of staying frozen for the whole UTC day', async () => {
  const h=baselineHarness({balance:'100',snapshots:['0.001','0.00099'],price:'100000'}); await h.service.save('fixtureapikey12345678','fixturesecret12345678');
  await h.service.finance('spot-daily'); assert.equal(h.count(),1);
  h.advance(P.BASELINE_TTL-1); await h.service.finance('spot-daily'); assert.equal(h.count(),1);
  h.advance(2); const value=await h.service.finance('spot-daily'); assert.equal(h.count(),2); assert.equal(Number(value.rows[1].amount),1);
});

test('upgrades reject legacy daily results and all-day baselines without clearing credentials', async () => {
  const h=baselineHarness({balance:'100',snapshots:['0.001'],price:'100000'}); await h.service.save('fixtureapikey12345678','fixturesecret12345678');
  await h.service.finance('daily-pnl');
  const result=h.records.get('finance-results').results['daily-pnl']; delete result.calculationVersion; result.rows[1].amount='99';
  const baseline=h.records.get('daily-baselines'); delete baseline.revision; baseline.entries.SPOT.data=snapshot('SPOT',{totalAssetOfBtc:'0.00001'});
  const restarted=B.create(h.options); assert.equal(await restarted.peek('daily-pnl'),null);
  const value=await restarted.finance('daily-pnl'); assert.equal(Number(value.rows[1].amount),0); assert.equal(h.count(),2);
  assert.equal((await restarted.status()).configured,true);
});
