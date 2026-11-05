/* Read-only UTC daily estimates. This is not Binance's private website PnL API. */
(function (root) {
  'use strict';
  const F = root.TrenchFinance || (typeof require === 'function' ? require('./finance-core.js') : null);
  const DAY = 86400000;
  const CALCULATION_VERSION = 2;
  const BASELINE_TTL = 15 * 60000;
  // A large daily move triggers verification; it is never clamped or made zero.
  const needsBaselineCheck = (amount, opening, current) => Math.abs(Number(amount)) >= 25 &&
    Math.abs(Number(amount)) >= Math.max(Math.abs(Number(opening)), Math.abs(Number(current)), 1) * 0.5;
  const TRANSFERS = ['MAIN_UMFUTURE', 'UMFUTURE_MAIN', 'MAIN_CMFUTURE', 'CMFUTURE_MAIN', 'MAIN_MARGIN', 'MARGIN_MAIN',
    'MAIN_FUNDING', 'FUNDING_MAIN', 'MAIN_OPTION', 'OPTION_MAIN', 'MAIN_PORTFOLIO_MARGIN', 'PORTFOLIO_MARGIN_MAIN'];
  const SCOPE = 'UTC 0 点起算，USDT 估算。现货抵扣 API 可查的充值、提现和通用划转；未覆盖理财申赎、法币直接出入金、子账户及其他非通用资金路径，发生这些资金移动时不能作为准确盈亏。历史价格按分钟近似，日终快照存在精度误差。';
  const decimal = value => { if (F.decimal(value) === null) throw new Error('币安盈亏计算缺少金额'); return String(value); };
  const neg = value => String(value).startsWith('-') ? String(value).slice(1) : '-' + value;
  function multiply(a, b) {
    a = decimal(a); b = decimal(b);
    const scale = (a.split('.')[1] || '').length + (b.split('.')[1] || '').length;
    const value = BigInt(a.replace('.', '')) * BigInt(b.replace('.', ''));
    const digits = (value < 0n ? -value : value).toString().padStart(scale + 1, '0');
    return (value < 0n ? '-' : '') + (scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits);
  }
  function baseline(data, day, type) {
    if (data?.code !== 200 || !Array.isArray(data.snapshotVos)) throw new Error('币安未返回有效日终快照');
    const rows = data.snapshotVos.filter(row => String(row.type).toUpperCase() === type &&
      Number.isSafeInteger(row.updateTime) && row.updateTime >= day - 2000 && row.updateTime < day);
    if (rows.length !== 1 || !rows[0].data) throw new Error('币安尚未提供今日 UTC 0 点基准，暂不能计算今日盈亏');
    return rows[0];
  }
  async function collect(read, route, query, envelope = false) {
    const result = [], seen = new Set(), size = envelope ? 100 : 1000;
    let expected;
    for (let page = 1; page <= 10; page++) {
      const data = await read(route, { ...query, ...(envelope ? { current: String(page), size: String(size) } : { offset: String((page - 1) * size), limit: String(size) }) });
      const rows = envelope ? (data?.total === 0 && data.rows == null ? [] : data?.rows) : data;
      if (!Array.isArray(rows) || rows.length > size) throw new Error('币安资金流水不完整，暂不能计算盈亏');
      if (envelope) {
        if (!Number.isSafeInteger(data.total) || data.total < 0 || (expected !== undefined && expected !== data.total)) throw new Error('币安资金流水正在变化，请重新查询');
        expected = data.total;
      }
      for (const row of rows) {
        const key = String(row.id ?? row.tranId ?? '');
        if (!key || seen.has(key)) throw new Error('币安资金流水重复或缺少编号');
        seen.add(key); result.push(row);
      }
      if (envelope && result.length === expected) return result;
      if (!envelope && rows.length < size) return result;
      if (!rows.length || (envelope && result.length > expected)) throw new Error('币安资金流水分页不完整');
    }
    throw new Error('币安今日资金流水超过读取上限');
  }
  async function spotToday({ read, cached, end, spot }) {
    const day = Math.floor(end / DAY) * DAY;
    const getSnapshot = options => cached('SPOT', day, () => read('snapshot', { type: 'SPOT', limit: '7' }), options);
    const snapshot = baseline(await getSnapshot(), day, 'SPOT');
    const historical = new Map();
    async function price(asset, at, closing = false) {
      if (asset === 'USDT') return '1';
      if (!/^[A-Z0-9]{1,30}$/.test(asset) || !Number.isSafeInteger(at)) throw new Error('币安历史估值参数无效');
      const minute = Math.floor(at / 60000) * 60000, key = asset + ':' + minute + ':' + closing;
      if (historical.has(key)) return historical.get(key);
      const bars = await read('klines', { symbol: asset + 'USDT', interval: '1m', startTime: String(minute), endTime: String(minute + 59999), limit: '1' });
      if (!Array.isArray(bars) || bars.length !== 1 || bars[0][0] !== minute) throw new Error('币安缺少资金流水的历史行情，暂不能估算');
      const value = decimal(bars[0][closing ? 4 : 1]);
      if (Number(value) <= 0) throw new Error('币安历史行情无效');
      historical.set(key, value); return value;
    }
    let opening = multiply(decimal(snapshot.data.totalAssetOfBtc), await price('BTC', snapshot.updateTime, true));
    const query = { startTime: String(day - 89 * DAY), endTime: String(end) };
    const flows = [], stats = { deposits: 0, withdrawals: 0, transfers: 0 };
    const settled = await Promise.allSettled([collect(read, 'deposits', query), collect(read, 'withdrawals', query),
      ...TRANSFERS.map(type => collect(read, 'transfers', { type, startTime: String(day), endTime: String(end) }, true))]);
    const failure = settled.find(result => result.status === 'rejected'); if (failure) throw failure.reason;
    const [deposits, withdrawals, ...transferRows] = settled.map(result => result.value);
    for (const row of deposits) {
      if (![0, 1].includes(row.walletType)) throw new Error('币安充值记录缺少钱包范围');
      if (row.walletType !== 0) continue;
      if (![0, 1, 2, 6, 7, 8].includes(row.status)) throw new Error('币安充值状态无法确认');
      if (![1, 6].includes(row.status)) { if ([0, 8].includes(row.status)) throw new Error('币安有未完成充值，请稍后计算盈亏'); continue; }
      const at = row.completeTime || row.insertTime;
      if (!Number.isSafeInteger(at)) throw new Error('币安充值时间缺失');
      if (at < day || at > end) continue;
      flows.push(multiply(decimal(row.amount), await price(row.coin, at))); stats.deposits++;
    }
    for (const row of withdrawals) {
      if (![0, 1].includes(row.walletType)) throw new Error('币安提现记录缺少钱包范围');
      if (row.walletType !== 0) continue;
      if (![1, 3, 5, 6].includes(row.status)) throw new Error('币安有未完成提现，请稍后计算盈亏');
      if (row.status !== 6) continue;
      const raw = row.completeTime || row.applyTime;
      const text = String(raw).replace(' ', 'T');
      const at = typeof raw === 'number' ? raw : Date.parse(text + (/(?:Z|[+-]\d\d:\d\d)$/.test(text) ? '' : 'Z'));
      if (!Number.isSafeInteger(at)) throw new Error('币安提现时间缺失');
      if (at < day || at > end) continue;
      flows.push(neg(multiply(decimal(row.amount), await price(row.coin, at)))); stats.withdrawals++;
    }
    for (const type of TRANSFERS) {
      const rows = transferRows[TRANSFERS.indexOf(type)];
      for (const row of rows) {
        if (row.type !== type || !Number.isSafeInteger(row.timestamp) || row.timestamp < day || row.timestamp > end) throw new Error('币安划转范围不一致');
        if (row.status === 'FAILED') continue;
        if (row.status !== 'CONFIRMED') throw new Error('币安有未完成划转，请稍后计算盈亏');
        const value = multiply(decimal(row.amount), await price(row.asset, row.timestamp));
        flows.push(type.startsWith('MAIN_') ? neg(value) : value); stats.transfers++;
      }
    }
    const netFlows = F.sum(['0', ...flows]);
    const calculate = () => F.sum([decimal(spot), neg(opening), neg(netFlows)]);
    let amount = calculate(), baselineRechecked = false, baselineCorrected = false;
    if (needsBaselineCheck(amount, opening, spot)) {
      // Binance can revise a snapshot after initially returning only some assets.
      // Never keep that first partial value as an immutable all-day baseline.
      const previous = opening;
      const revised = baseline(await getSnapshot({ verify: true }), day, 'SPOT');
      opening = multiply(decimal(revised.data.totalAssetOfBtc), await price('BTC', revised.updateTime, true));
      baselineRechecked = true; baselineCorrected = Number(F.sum([opening, neg(previous)])) !== 0;
      amount = calculate();
      if (needsBaselineCheck(amount, opening, spot) && baselineCorrected &&
          Math.abs(Number(F.sum([opening, neg(previous)]))) > Math.max(0.01, Math.abs(Number(opening)) * 0.001)) {
        throw Object.assign(new Error('币安日初资产快照仍在修正，暂不能确认今日盈亏，请稍后再查'), { code: 'BASELINE_UNSTABLE' });
      }
    }
    return { amount, opening, netFlows, stats, day, end, baselineRechecked, baselineCorrected, scope: SCOPE };
  }
  async function futuresToday({ read, cached, end, current }) {
    const day = Math.floor(end / DAY) * DAY, incomes = [], ids = new Set();
    let complete = false;
    for (let page = 1; page <= 10; page++) {
      const rows = await read('income', { startTime: String(day), endTime: String(end), limit: '1000', page: String(page) });
      if (!Array.isArray(rows) || rows.length > 1000) throw new Error('币安合约收益记录不完整');
      for (const row of rows) {
        if (!Number.isSafeInteger(row.time) || row.time < day || row.time > end) throw new Error('币安合约收益时间不完整');
        const key = row.incomeType + ':' + row.tranId;
        if (row.tranId == null || ids.has(key)) throw new Error('币安合约收益分页重复');
        ids.add(key);
        const value = decimal(row.income);
        if (['TRANSFER', 'INTERNAL_TRANSFER', 'CROSS_COLLATERAL_TRANSFER'].includes(row.incomeType)) continue;
        if (Number(value) === 0) continue;
        if (row.asset !== 'USDT' || !['REALIZED_PNL', 'FUNDING_FEE', 'COMMISSION', 'INSURANCE_CLEAR', 'COMMISSION_REBATE', 'API_REBATE', 'REFERRAL_KICKBACK'].includes(row.incomeType)) throw new Error('币安存在未支持的合约计价资产或收益类型');
        incomes.push(value);
      }
      if (rows.length < 1000) { complete = true; break; }
    }
    if (!complete) throw new Error('币安合约收益记录超过读取上限');
    // Explicit user policy: a successful empty account and empty income return is zero.
    if (current.empty && ids.size === 0) return { amount: '0', day, empty: true };
    const snapshot = baseline(await cached('FUTURES', day, () => read('snapshot', { type: 'FUTURES', limit: '7' })), day, 'FUTURES');
    if (!Array.isArray(snapshot.data.assets)) throw new Error('币安缺少合约期初资产');
    const entries = snapshot.data.assets.filter(row => row.asset === 'USDT');
    let openingPnl;
    if (!snapshot.data.assets.length) openingPnl = '0';
    else if (entries.length === 1) openingPnl = F.sum([decimal(entries[0].marginBalance), neg(decimal(entries[0].walletBalance))]);
    else throw new Error('币安缺少 USDT 合约期初数据');
    return { amount: F.sum(['0', ...incomes, decimal(current.pnl), neg(openingPnl)]), day };
  }
  const api = { DAY, CALCULATION_VERSION, BASELINE_TTL, TRANSFERS, SCOPE, multiply, baseline, collect, spotToday, futuresToday };
  root.TrenchBinancePnl = api; if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
