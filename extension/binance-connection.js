/* Background-only, read-only Binance account access. No order or transfer routes. */
(function (root) {
  'use strict';
  const F = root.TrenchFinance || (typeof require === 'function' ? require('./finance-core.js') : null);
  const P = root.TrenchBinancePnl || (typeof require === 'function' ? require('./binance-pnl.js') : null);
  const privateStore = () => F.privateStore('trench-binance-connection');
  function wallets(data) {
    if (!Array.isArray(data) || data.length > 50) throw new Error('币安未返回完整的钱包估值列表');
    if (!data.length) return { total: '0', spot: '0', wallets: [], empty: true };
    const names = new Set(), rows = [];
    for (const item of data) {
      if (typeof item.walletName !== 'string' || item.walletName.length > 80 || names.has(item.walletName) || F.decimal(item.balance) === null || typeof item.activate !== 'boolean') throw new Error('币安钱包数据格式不完整');
      names.add(item.walletName); rows.push({ name: item.walletName, balance: String(item.balance), active: item.activate });
    }
    return { total: F.sum(rows.map(row => row.balance)), spot: rows.find(row => row.name === 'Spot')?.balance ?? null, wallets: rows };
  }
  function futures(data) {
    if (!Array.isArray(data?.assets)) throw new Error('币安未返回合约资产数据');
    if (!data.assets.length) {
      if ((Array.isArray(data.positions) && data.positions.length) || ['totalWalletBalance', 'totalUnrealizedProfit', 'totalMarginBalance'].some(key => data[key] != null && data[key] !== '' && (F.decimal(data[key]) === null || Number(data[key]) !== 0))) throw new Error('币安空合约资产与汇总数据不一致');
      return { equity: '0', pnl: '0', empty: true };
    }
    const rows = data.assets.filter(row => row.asset === 'USDT');
    if (rows.length !== 1 || F.decimal(rows[0].marginBalance) === null || F.decimal(rows[0].unrealizedProfit) === null) throw new Error('未取得 USDT 合约权益与浮盈');
    return { equity: String(rows[0].marginBalance), pnl: String(rows[0].unrealizedProfit) };
  }
  function create({ store = privateStore(), fetcher = (...args) => fetch(...args), now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
    uuid = () => crypto.randomUUID(), requestTimeoutMs = 15000, queryMaxAgeMs = 120000 } = {}) {
    let version = 0, writes = Promise.resolve(), permits = Promise.resolve(), lastStart = 0, activeRequests = 0, blockedUntil = 0;
    const clockOffsets = new Map(), clockTimes = new Map(), historyPrices = new Map(), jobs = [], progress = new Map();
    const flights = new Map(), controllers = new Set(), progressOwners = new Map();
    const mutate = task => { const next = writes.then(task, task); writes = next.catch(() => {}); return next; };
    const cancel = () => { version++; controllers.forEach(controller => controller.abort()); flights.clear(); progress.clear(); progressOwners.clear(); };
    async function status() {
      await writes; const record = await store.get('account');
      return { configured: !!record?.apiKey, savedAt: record?.savedAt || 0, last: record?.last || null, cooldownUntil: await store.get('cooldown') || 0 };
    }
    async function save(apiKey, secret) {
      if (![apiKey, secret].every(value => typeof value === 'string' && /^[a-zA-Z0-9]{16,256}$/.test(value.trim()))) throw new Error('请填写系统生成的 API Key 和 Secret Key');
      cancel(); await mutate(async () => { await store.set('finance-results', null); await store.set('daily-baselines', null); await store.set('account', { apiKey: apiKey.trim(), secret: secret.trim(), savedAt: now() }); }); return status();
    }
    async function clear() { cancel(); await mutate(async () => { await store.set('account', null); await store.set('daily-baselines', null); }); return status(); }
    function schedule(route, controller, task) {
      return new Promise((resolve, reject) => { jobs.push({ route, controller, task, resolve, reject }); pump(); });
    }
    function pump() {
      while (activeRequests < 3 && jobs.length) {
        const job = jobs.shift(); activeRequests++;
        const permit = permits.then(async () => {
          if (job.controller.signal.aborted) throw new Error('币安连接已更改，请重新点击');
          if (Math.max(blockedUntil, await store.get('cooldown') || 0) > now()) throw new Error('币安请求限频，请稍后重试');
          await F.abortable(wait(Math.max(0, 100 - (now() - lastStart))), job.controller.signal);
          if (Math.max(blockedUntil, await store.get('cooldown') || 0) > now()) throw new Error('币安请求限频，请稍后重试');
          const bucket = ['futuresTime', 'futures', 'income'].includes(job.route) ? 'futures' : ['time', 'klines'].includes(job.route) ? 'spot' : job.route === 'withdrawals' ? 'withdrawals' : 'sapi';
          const weight = ({ wallets: 60, snapshot: 2400, futures: 5, income: 30, klines: 2, time: 2 })[job.route] || 1;
          const budget = (await store.get('request-budget') || []).filter(row => row.at > now() - 60000 && row.at <= now());
          const limit = bucket === 'sapi' ? 10000 : bucket === 'withdrawals' ? 60 : 1000;
          if (budget.length >= 120 || budget.filter(row => row.bucket === bucket).reduce((n, row) => n + row.weight, 0) + weight > limit) throw new Error('币安查询额度暂满，请稍后再刷新');
          if (job.controller.signal.aborted) throw new Error('币安连接已更改，请重新点击');
          budget.push({ bucket, weight, at: now() }); await store.set('request-budget', budget); lastStart = now();
        });
        permits = permit.catch(() => {});
        permit.then(job.task).then(job.resolve, job.reject).finally(() => { activeRequests--; pump(); });
      }
    }
    async function peek(mode = 'daily-pnl') {
      await writes; const current = version, account = await store.get('account');
      if (!account?.apiKey) return null;
      const saved = await store.get('finance-results');
      const owner = progressOwners.get(mode);
      const value = (owner?.key === account.apiKey && owner.at === account.savedAt ? progress.get(mode) : null) || (saved?.owner === account.apiKey && saved.savedAt === account.savedAt ? saved.results?.[mode] : null);
      if (current !== version || !value?.at || now() < value.at || now() - value.at > 300000) return null;
      if (['daily-pnl', 'spot-daily'].includes(mode)) {
        if (value.calculationVersion !== P.CALCULATION_VERSION) return null;
        const offset = Number.isFinite(value.daily?.utcOffsetMs) ? value.daily.utcOffsetMs : 0;
        const resultDay = value.daily?.start ?? Math.floor(value.at / P.DAY) * P.DAY;
        if (resultDay !== Math.floor((now() + offset) / P.DAY) * P.DAY) return null;
      }
      const rows = value.rows?.map(row => mode === 'daily-pnl' && ['现货+U今日估算', '今日账户总盈亏'].includes(row.label) ? { ...row, label: '今日总盈亏' } : row);
      return { ...value, rows, cached: !flights.has(mode), refreshing: flights.has(mode) };
    }
    async function call(route, query, account, controller) {
      const routes = { time: ['https://api.binance.com', '/api/v3/time', false], wallets: ['https://api.binance.com', '/sapi/v1/asset/wallet/balance', true],
        futuresTime: ['https://fapi.binance.com', '/fapi/v1/time', false], futures: ['https://fapi.binance.com', '/fapi/v3/account', true],
        snapshot: ['https://api.binance.com', '/sapi/v1/accountSnapshot', true], klines: ['https://api.binance.com', '/api/v3/klines', false],
        deposits: ['https://api.binance.com', '/sapi/v1/capital/deposit/hisrec', true], withdrawals: ['https://api.binance.com', '/sapi/v1/capital/withdraw/history', true],
        transfers: ['https://api.binance.com', '/sapi/v1/asset/transfer', true], income: ['https://fapi.binance.com', '/fapi/v1/income', true] };
      if (!Object.hasOwn(routes, route)) throw new Error('不支持的币安查询');
      const [origin, path, signed] = routes[route];
      if ((route === 'time' || route === 'futuresTime') && now() >= clockTimes.get(origin) && now() - clockTimes.get(origin) < 300000) return { serverTime: now() + clockOffsets.get(origin) };
      const priceKey = route === 'klines' && Number(query.endTime) < now() - 60000 ? JSON.stringify(query) : null;
      if (priceKey && historyPrices.has(priceKey)) return historyPrices.get(priceKey);
      const pending = schedule(route, controller, async () => {
        if (controller.signal.aborted) throw new Error('币安连接已更改，请重新点击');
        if (Math.max(blockedUntil, await store.get('cooldown') || 0) > now()) throw new Error('币安请求限频，请稍后重试');

        if (controller.signal.aborted) throw new Error('币安连接已更改，请重新点击');
        const params = new URLSearchParams(query);
        if (signed) {
          if (!clockOffsets.has(origin)) throw new Error('币安时间尚未校准');
          params.set('timestamp', String(now() + clockOffsets.get(origin)));
          params.set('recvWindow', '10000');
          const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(account.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
          const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(params.toString()));
          params.set('signature', [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join(''));
        }
        if (controller.signal.aborted) throw new Error('币安连接已更改，请重新点击');
        const timeout = new AbortController(), abort = () => timeout.abort();
        controller.signal.addEventListener('abort', abort, { once: true }); const timer = setTimeout(abort, requestTimeoutMs);
        try {
          const response = await F.abortable(fetcher(origin + path + (params.size ? '?' + params : ''), { method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store',
            headers: signed ? { 'X-MBX-APIKEY': account.apiKey } : {}, signal: timeout.signal }), timeout.signal);
          if ([418, 429].includes(response.status)) {
            const delay = Number(response.headers.get('Retry-After')) || (response.status === 418 ? 300 : 60);
            blockedUntil = Math.max(blockedUntil, now() + Math.max(60, delay) * 1000);
            await mutate(async () => { blockedUntil = Math.max(blockedUntil, await store.get('cooldown') || 0); await store.set('cooldown', blockedUntil); });
            throw new Error('币安请求限频，请稍后重试');
          }
          const reader = response.body?.getReader(); if (!reader) throw new Error('币安响应不可读取');
          let size = 0; const chunks = [];
          while (true) { const { done, value } = await F.abortable(reader.read(), timeout.signal); if (done) break; size += value.length; if (size > 1024 * 1024) { reader.cancel().catch(() => {}); throw new Error('币安响应过大'); } chunks.push(value); }
          const bytes = new Uint8Array(size); let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
          let data; try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('币安未返回可读取的数据'); }
          if (data?.code === -1021) { clockTimes.delete(origin); throw new Error('币安时间校验失败，请稍后重新查询'); }
          if (data?.code === -1022) throw new Error('币安签名校验失败，请检查 Secret Key');
          if ([401, 403].includes(response.status) || [-2014, -2015].includes(data?.code)) throw new Error('币安拒绝读取，请检查 Key、读取权限、IP 限制或账户类型');
          if (!response.ok || (typeof data?.code === 'number' && data.code < 0)) throw new Error('币安暂未返回成功结果，请检查账户接口权限');
          if (route === 'time' || route === 'futuresTime') {
            if (!Number.isSafeInteger(data?.serverTime) || data.serverTime <= 0) throw new Error('币安时间响应无效');
            clockOffsets.set(origin, data.serverTime - now()); clockTimes.set(origin, now());
          }
          if (priceKey) { if (historyPrices.size > 256) historyPrices.clear(); historyPrices.set(priceKey, data); }
          return data;
        } catch (error) {
          // Only locally generated Chinese messages leave this service; upstream bodies/URLs may echo secrets.
          if (controller.signal.aborted) throw new Error('币安连接已更改，请重新点击');
          if (timeout.signal.aborted) throw new Error('币安请求超时，请重新点击重试');
          throw new Error(/^币安/.test(error.message) && !error.message.includes(account.apiKey) && !error.message.includes(account.secret) ? error.message : '币安查询未完成，请检查网络后重试');
        } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); }
      });
      return pending;
    }
    async function finance(mode = 'daily-pnl', { detach = false } = {}) {
      mode = ['assets', 'assets-pnl', 'daily-pnl', 'spot-daily', 'futures'].includes(mode) ? mode : 'daily-pnl'; await writes; const current = version;
      const account = await store.get('account');
      if (current !== version) throw new Error('币安连接已更改，请重新点击');
      if (!account?.apiKey) return { provider: 'binance', mode, reason: '请在账户设置中连接币安 API', at: now(), rows: [], refreshing: false };
      const running = flights.get(mode);
      if (running && running.owner === account.apiKey && running.savedAt === account.savedAt && now() >= running.startedAt && now() - running.startedAt < queryMaxAgeMs) return detach ? { ...progress.get(mode), cached: false, refreshing: true } : running.promise;
      if (running) { running.controller.abort(); flights.delete(mode); progress.delete(mode); }
      const controller = new AbortController(); controllers.add(controller);
      const queryId = uuid(); let persisted = false;
      const pending = (async () => {
        const result = { provider: 'binance', mode, queryId, calculationVersion: P.CALCULATION_VERSION, at: now(), reason: '', rows: [], scope: '' };
        const publish = () => { if (current !== version || controller.signal.aborted) throw new Error('币安连接已更改'); result.at = now(); progress.set(mode, structuredClone(result)); progressOwners.set(mode, { key: account.apiKey, at: account.savedAt }); };
        publish();
        try {
          const futuresTask = mode !== 'assets' && mode !== 'spot-daily' ? (async () => {
            const time = await call('futuresTime', {}, account, controller);
            const value = futures(await call('futures', {}, account, controller)); return { time, value };
          })().then(value => ({ value }), error => ({ error })) : null;
          const time = mode === 'futures' ? await futuresTask.then(result => { if (result.error) throw result.error; return result.value.time; }) : await call('time', {}, account, controller);
          if (!Number.isSafeInteger(time?.serverTime) || time.serverTime <= 0) throw new Error('币安时间响应无效');
          const query = { timestamp: String(time.serverTime), recvWindow: '10000' };
          if (mode !== 'futures') {
            const parsed = wallets(await call('wallets', { quoteAsset: 'USDT', ...query }, account, controller));
            result.rows = [{ label: '总资产估值', amount: parsed.total, unit: 'USDT' }, { label: '现货估值', amount: parsed.spot, unit: 'USDT' }];
            result.scope = '仅汇总本 API 返回的账户钱包，不包含未返回的子账户。';
            if (mode === 'assets') result.scope += '第二行是其中的现货部分，不再与第一行相加。';
            result.walletNames = parsed.wallets.map(row => row.name);
            if (mode === 'daily-pnl' || mode === 'spot-daily') {
              result.rows[1] = { label: '现货今日估算', amount: null, unit: 'USDT', pnl: true };
              result.scope += P.SCOPE; publish();
              let reads = 0;
              const read = (route, query = {}) => {
                if (++reads > 120) throw new Error('币安今日资金流水较多，超过本次估算读取上限');
                return call(route, query, account, controller);
              };
              const cached = async (type, day, fetchData, { verify = false } = {}) => {
                await writes;
                let cache = await store.get('daily-baselines');
                if (cache?.owner !== account.apiKey || cache.day !== day || cache.revision !== P.CALCULATION_VERSION) cache = { owner: account.apiKey, day, revision: P.CALCULATION_VERSION, entries: {} };
                const entry = cache.entries[type];
                const ttl = entry?.valid ? P.BASELINE_TTL : 60000;
                if (entry && now() >= entry.at && entry.at + ttl > now() &&
                    (!verify || entry.verifiedAt && now() >= entry.verifiedAt && entry.verifiedAt + 60000 > now())) return entry.data;
                const data = await fetchData();
                if (data?.code !== 200 || !Array.isArray(data.snapshotVos)) throw new Error('币安日终快照不可用');
                await mutate(async () => {
                  if (current !== version || controller.signal.aborted) throw new Error('币安连接已更改，请重新点击');
                  const latest = await store.get('daily-baselines');
                  if (latest?.owner === account.apiKey && latest.day === day && latest.revision === P.CALCULATION_VERSION) cache = latest;
                  let valid = false; try { P.baseline(data, day, type); valid = true; } catch {}
                  cache.entries[type] = { data, valid, at: now(), verifiedAt: verify ? now() : 0 }; await store.set('daily-baselines', cache);
                });
                return data;
              };
              try {
                const contractTask = mode === 'daily-pnl' ? (async () => {
                  const fetched = await futuresTask; if (fetched.error) throw fetched.error;
                  return P.futuresToday({ read, cached, end: fetched.value.time.serverTime, current: fetched.value.value });
                })().then(value => ({ value }), error => ({ error })) : null;
                const daily = await P.spotToday({ read, cached, end: time.serverTime, spot: parsed.spot });
                result.rows[1].amount = daily.amount;
                result.daily = { start: daily.day, end: daily.end, scope: 'spot', openingSpot: daily.opening, netSpotFlows: daily.netFlows,
                  baselineRechecked: daily.baselineRechecked, baselineCorrected: daily.baselineCorrected,
                  utcOffsetMs: clockOffsets.get('https://api.binance.com') || 0 };
                if (mode === 'daily-pnl') {
                  try {
                    const settled = await contractTask; if (settled.error) throw settled.error;
                    const contract = settled.value;
                    if (contract.day !== daily.day) throw new Error('币安查询跨过 UTC 0 点，请重新查询');
                    result.rows[1].amount = F.sum([daily.amount, contract.amount]); result.rows[1].label = '今日总盈亏';
                    result.daily.scope = 'spot+USDT-futures';
                    result.scope += '合计现货与 USDT 合约；合约包含当日已实现盈亏、资金费、手续费和浮盈变化，不含币本位、USDC 合约及其他账户产品。';
                  } catch (error) { result.scope += '本次仅显示现货今日估算，合约未纳入：' + error.message; }
                }
              } catch (error) {
                result.reason = error.message;
                if (error.code === 'BASELINE_UNSTABLE') await mutate(async () => {
                  if (current !== version || controller.signal.aborted) return;
                  const cache = await store.get('daily-baselines');
                  if (cache?.owner === account.apiKey) { delete cache.entries.SPOT; await store.set('daily-baselines', cache); }
                });
              }
            }
            if (mode === 'assets-pnl') {
              result.rows[1] = { label: 'USDT合约浮盈', amount: null, unit: 'USDT', pnl: true };
              result.scope += '浮盈只统计 USDT 合约当前未实现盈亏，不是全账户今日盈亏。'; publish();
              try {
                const fetched = await futuresTask; if (fetched.error) throw fetched.error;
                const parsedFutures = fetched.value.value;
                result.rows[1].amount = parsedFutures.pnl;
              } catch (error) { result.reason = error.message; }
            }
          } else {
            const fetched = await futuresTask; if (fetched.error) throw fetched.error;
            const parsed = fetched.value.value;
            result.rows = [{ label: 'USDT合约权益', amount: parsed.equity, unit: 'USDT' }, { label: '持仓浮盈', amount: parsed.pnl, unit: 'USDT', pnl: true }];
            result.scope = '仅 USDT 合约资产，浮盈为当前未实现盈亏，不是全账户今日盈亏。';
          }
          result.at = now();
        } catch (error) { result.reason = error.message; }
        if (current !== version || controller.signal.aborted) throw new Error('币安连接已更改，请重新点击');
        // A slow history read can straddle UTC midnight. Its completed timestamp
        // must not relabel the prior day's estimate as today's profit.
        if (result.daily && result.daily.start !== Math.floor((now() + result.daily.utcOffsetMs) / P.DAY) * P.DAY) {
          for (const row of result.rows) if (row.pnl) row.amount = null;
          delete result.daily;
          result.reason = '币安查询跨过 UTC 0 点，请重新点击计算今日盈亏';
        }
        publish();
        await mutate(async () => { if (current !== version) return; await store.set('account', { ...account, last: { at: now(), ok: !result.reason, reason: result.reason, mode } });
          if (result.rows.some(row => row.amount !== null)) {
            let cached = await store.get('finance-results');
            if (cached?.owner !== account.apiKey || cached.savedAt !== account.savedAt) cached = { owner: account.apiKey, savedAt: account.savedAt, results: {} };
            cached.results[mode] = structuredClone(result); await store.set('finance-results', cached); persisted = true;
          } });
        if (current !== version || controller.signal.aborted) throw new Error('币安连接已更改，请重新点击');
        return result;
      })();
      const entry = { promise: pending, controller, queryId, startedAt: now(), owner: account.apiKey, savedAt: account.savedAt };
      flights.set(mode, entry);
      const done = () => {
        // A spot failure can finish this query before the parallel futures branch.
        // Cancel that branch before releasing the controller: otherwise clearing
        // credentials could leave it issuing signed reads with the old account.
        controller.abort(); controllers.delete(controller);
        if (flights.get(mode) === entry) { flights.delete(mode); if (persisted) { progress.delete(mode); progressOwners.delete(mode); } }
      };
      pending.then(done, done); return detach ? { ...progress.get(mode), cached: false, refreshing: true } : pending;
    }
    const start = async mode => {
      const value = await finance(mode, { detach: true });
      return { ...value, queryId: value.queryId || uuid(), refreshing: value.refreshing === true };
    };
    return { status, save, clear, finance, peek, start };
  }
  root.TrenchBinance = { create, wallets, futures };
  if (typeof module !== 'undefined') module.exports = root.TrenchBinance;
})(globalThis);
