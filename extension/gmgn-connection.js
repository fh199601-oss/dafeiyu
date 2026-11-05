/* Background-only GMGN connection/probe. Credentials never use shared storage. */
(function (root) {
  'use strict';
  const F = root.TrenchFinance || (typeof require === 'function' ? require('./finance-core.js') : null);
  const HOST = 'https://openapi.gmgn.ai';
  const REFRESH_INTERVAL_MS = 60000;
  const WALLET_CHECK_INTERVAL_MS = 60 * 60 * 1000;
  const REQUEST_GAP_MS = 2100;
  const PROFIT_CHAINS = new Set(['sol', 'bsc', 'base', 'eth', 'arbitrum', 'hyperevm', 'robinhood', 'arc', 'stable']);
  const SECRET = /api.?key|private|secret|password|passphrase|mnemonic|authorization|signature|cookie|access.?token|refresh.?token|credential|session|jwt|email|phone/i;
  const ADDRESS = /^(?:0x[\da-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;
  function sanitize(value, key) {
    let count = 0;
    function walk(item, name = '', depth = 0) {
      if (++count > 15000 || depth > 10) return '[已截断]';
      if (SECRET.test(name)) return '[已移除]';
      if (typeof item === 'string') {
        if (key && item.includes(key)) return '[已移除]';
        if (item.length > 200) return '[文本省略]';
        if (/^[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(item) || ADDRESS.test(item)) return item;
        if (/^(chain|network|symbol|currency|native_symbol|quote_symbol|period|unit|timezone|date|time|day|updated_at)$/i.test(name) && /^[\w :+./-]{1,80}$/.test(item)) return item;
        return '[文本省略]';
      }
      if (typeof item === 'number') return String(item) === key ? '[已移除]' : (Number.isFinite(item) ? item : null);
      if (typeof item === 'boolean' || item === null) return item;
      if (Array.isArray(item)) return item.slice(0, 1000).map(row => walk(row, '', depth + 1)).concat(item.length > 1000 ? ['[已截断]'] : []);
      if (item && typeof item === 'object') {
        const out = Object.create(null);
        for (const [field, data] of Object.entries(item).slice(0, 500)) {
          const safeName = field.length <= 100 && /^[\w.-]+$/.test(field) && !(key && field.includes(key)) && !['__proto__', 'constructor', 'prototype'].includes(field) ? field : '[字段名省略]';
          out[safeName] = walk(data, field, depth + 1);
        }
        return out;
      }
      return null;
    }
    return walk(value);
  }
  function discover(info) {
    const groups = new Map(); let ignored = 0;
    if (!Array.isArray(info?.wallets)) return { groups, ignored, recognized: false };
    for (const row of info.wallets) {
      const chain = row?.chain, address = row?.address;
      if (typeof chain !== 'string' || !/^[a-z][a-z0-9_-]{1,23}$/.test(chain) || typeof address !== 'string' || !ADDRESS.test(address)) { ignored++; continue; }
      if (!groups.has(chain)) groups.set(chain, new Set());
      groups.get(chain).add(address.startsWith('0x') ? address.toLowerCase() : address);
    }
    return { groups, ignored, recognized: true };
  }
  const privateStore = () => F.privateStore('trench-gmgn-connection');
  function create({ store = privateStore(), fetcher = (...args) => fetch(...args), now = Date.now,
    wait = ms => new Promise(resolve => setTimeout(resolve, ms)), uuid = () => crypto.randomUUID(), requestTimeoutMs = 15000, queryMaxAgeMs = 120000 } = {}) {
    let generation = 0, flight = null, active = null, writes = Promise.resolve(), permits = Promise.resolve(), activeRequests = 0, blockedUntil = 0;
    let walletCheckFlight = null;
    const financeFlights = new Map(), financeControllers = new Set(), progress = new Map(), financeRevisions = new Map(), jobs = [];
    const changedFinance = key => financeRevisions.set(key, (financeRevisions.get(key) || 0) + 1);
    const mutate = task => { const next = writes.then(task, task); writes = next.catch(() => {}); return next; };
    const activeCheck = job => { if (generation !== job.version || job.controller.signal.aborted) throw new Error('API 设置已变更，本次检测已取消'); };
    const deadlineCheck = (job, additionalMs = 0) => {
      if (job.expiresAt && now() + additionalMs >= job.expiresAt) {
        job.stop = true; throw new Error('GMGN 本次查询已超时，已停止剩余钱包请求；冷却结束后可重试');
      }
    };
    function cancel() { generation++; active?.abort(); flight = null; for (const controller of financeControllers) controller.abort(); financeFlights.clear(); progress.clear(); financeRevisions.clear(); }
    async function status() {
      const record = await store.get('account') || {};
      const cooldownUntil = Number(await store.get('cooldown')) || 0;
      const report = record.report;
      const manual = await store.get('manual-wallets');
      const legacy = await store.get('finance-wallets');
      const synced = manual ? { ...manual, syncedAt: manual.savedAt, lastChain: manual.defaultChain } : null;
      return { configured: !!record.apiKey, savedAt: record.savedAt || 0, cooldownUntil, testing: !!flight,
        manualWallets: manual || null, suggestedWallets: manual ? null : legacy, walletCheck: await store.get('wallet-check') || null,
        wallets: synced ? { syncedAt: synced.syncedAt, lastChain: synced.lastChain,
          chains: Object.fromEntries(Object.entries(synced.chains).map(([chain, data]) => [chain, { count: data.addresses.length, archived: data.archived, supported: !!F.CHAINS[chain] }])) } : null,
        last: report ? { testedAt: report.testedAt, accountOk: report.account.ok, chains: report.scope.chains,
          walletCount: report.scope.walletCount, walletsEmpty: Array.isArray(report.account.data?.wallets) && report.account.data.wallets.length === 0,
          message: report.message, profitChecks: report.profits.length } : null };
    }
    async function save(input, addresses, defaultChain) {
      const key = typeof input === 'string' ? input.trim() : '';
      if (key && (key.length < 8 || key.length > 1024 || /[^\x21-\x7e]/.test(key))) throw new Error('请粘贴有效的 GMGN API Key');
      const manual = addresses === undefined ? null : F.manualWallets(addresses, defaultChain);
      await writes;
      if (!key && !(await store.get('account'))?.apiKey) throw new Error('请先填写 GMGN API Key');
      return mutate(async () => {
        const old = await store.get('account') || {};
        const oldManual = await store.get('manual-wallets');
        // Saving an unchanged form is not a new account and must not bypass the
        // refresh gate. Actual edits still invalidate every old query and cache.
        if ((key || old.apiKey) === old.apiKey && (!manual || manual.identity === oldManual?.identity)) return status();
        cancel();
        await store.set('account', { apiKey: key || old.apiKey, savedAt: now(), revision: uuid(), report: null });
        if (manual) await store.set('manual-wallets', { ...manual, owner: oldManual?.owner, source: 'manual', savedAt: now() });
        return status();
      });
    }
    function clear() {
      cancel();
      return mutate(async () => { await store.set('account', {}); return status(); });
    }
    async function responseJSON(response, signal) {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('GMGN 返回内容不可读取');
      const chunks = []; let length = 0;
      while (true) {
        const { done, value } = await F.abortable(reader.read(), signal); if (done) break;
        length += value.length;
        if (length > 1024 * 1024) { reader.cancel().catch(() => {}); throw new Error('GMGN 返回内容过大，已停止本次检测'); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
    }
    function call(path, payload, job, query = {}) {
      return new Promise((resolve, reject) => { jobs.push({ path, payload, job, query, resolve, reject }); pump(); });
    }
    function pump() {
      while (activeRequests < 1 && jobs.length) {
        const task = jobs.shift(); activeRequests++;
        let admitted = false;
        const permit = permits.then(async () => {
          activeCheck(task.job);
          deadlineCheck(task.job);
          if (task.job.stop) throw new Error('GMGN 查询已停止，请稍后重试');
          const cooldown = Math.max(blockedUntil, Number(await store.get('cooldown')) || 0);
          if (cooldown > now()) throw new Error(`GMGN 限频，请在 ${new Date(cooldown).toLocaleTimeString('zh-CN')} 后重试`);
          const pacing = await store.get('request-pacing');
          // Live account reads were throttled at the documented token-bucket
          // pace. Serialize reads and leave 2.1s after the previous completion;
          // the one-minute result cache makes repeat clicks immediate.
          // Persist both edges so a worker restart cannot reset this spacing.
          const previousEnd = pacing?.completedAt || pacing?.at || 0;
          const delay = previousEnd ? Math.max(0, REQUEST_GAP_MS - Math.max(0, now() - previousEnd)) : 0;
          deadlineCheck(task.job, delay);
          await F.abortable(wait(delay), task.job.controller.signal);
          activeCheck(task.job);
          deadlineCheck(task.job);
          if (task.job.stop) throw new Error('GMGN 查询已停止，请稍后重试');
          const refreshedCooldown = Math.max(blockedUntil, Number(await store.get('cooldown')) || 0);
          if (refreshedCooldown > now()) throw new Error(`GMGN 限频，请在 ${new Date(refreshedCooldown).toLocaleTimeString('zh-CN')} 后重试`);
          await store.set('request-pacing', { at: now() }); admitted = true;
        });
        permits = permit.catch(() => {});
        const complete = async () => { if (admitted) await store.set('request-pacing', { at: now(), completedAt: now() }); };
        permit.then(() => performCall(task.path, task.payload, task.job, task.query)).then(
          async result => { await complete(); task.resolve(result); },
          async error => { await complete(); task.reject(error); }).catch(task.reject)
          .finally(() => { activeRequests--; pump(); });
      }
    }
    async function performCall(path, payload, job, query) {
      if (!['/v1/user/info', '/v1/user/wallet_profits', '/v1/user/wallet_token_balance'].includes(path)) throw new Error('此版本只允许账户、原币余额与盈亏查询');
      activeCheck(job);
      deadlineCheck(job);
      const cooldown = Math.max(blockedUntil, Number(await store.get('cooldown')) || 0);
      if (cooldown > now()) throw new Error(`GMGN 限频，请在 ${new Date(cooldown).toLocaleTimeString('zh-CN')} 后重试`);
      const url = new URL(HOST + path);
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
      url.searchParams.set('timestamp', Math.floor(now() / 1000)); url.searchParams.set('client_id', uuid());
      const timed = new AbortController(), cancelRequest = () => timed.abort();
      job.controller.signal.addEventListener('abort', cancelRequest, { once: true });
      const timer = setTimeout(cancelRequest, Math.min(requestTimeoutMs, job.expiresAt ? Math.max(1, job.expiresAt - now()) : requestTimeoutMs));
      const limited = async (response, body = null) => {
        const retry = response.headers.get('Retry-After');
        const retryAt = /^\d+$/.test(retry || '') ? now() + Number(retry) * 1000 : Date.parse(retry || '') || 0;
        const until = Math.max(Number(response.headers.get('X-RateLimit-Reset')) * 1000 || 0, Number(body?.reset_at) * 1000 || 0, retryAt, now() + 60000);
        job.stop = true; blockedUntil = Math.max(blockedUntil, until);
        await mutate(async () => { blockedUntil = Math.max(blockedUntil, Number(await store.get('cooldown')) || 0); await store.set('cooldown', blockedUntil); });
        return { ok: false, httpStatus: response.status, message: `GMGN 限频，请在 ${new Date(blockedUntil).toLocaleTimeString('zh-CN')} 后重试`, retryAt: blockedUntil };
      };
      try {
        const response = await F.abortable(fetcher(url.href, { method: payload ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error',
          headers: { 'X-APIKEY': job.key, 'Content-Type': 'application/json' }, ...(payload ? { body: JSON.stringify(payload) } : {}), signal: timed.signal }), timed.signal);
        // Respect a 429 immediately, even if the error body never finishes.
        if (response.status === 429) {
          const immediate = await limited(response);
          try { return await limited(response, await responseJSON(response, timed.signal)); }
          catch { activeCheck(job); return immediate; }
        }
        const body = await responseJSON(response, timed.signal); activeCheck(job);
        if (String(body?.code) === '429' || /^RATE_LIMIT_/.test(String(body?.error || '')) || /^RATE_LIMIT_/.test(String(body?.code || ''))) return await limited(response, body);
        if (body?.error === 'PLAN_UPGRADE_REQUIRED') return { ok: false, httpStatus: response.status, message: '当前 GMGN API 套餐不支持此接口' };
        if ([401, 403].includes(response.status) || ['401', '403'].includes(String(body?.code))) {
          job.stop = true;
          return { ok: false, httpStatus: response.status, message: 'GMGN 拒绝访问，请核对 API Key、IP 白名单、系统时间及 IPv4 网络' };
        }
        if (!response.ok || String(body?.code) !== '0' || !body.data || typeof body.data !== 'object') {
          return { ok: false, httpStatus: response.status, message: body ? 'GMGN 未返回成功的数据响应，请核对 API 配置' : 'GMGN 返回非 JSON 内容，请检查代理或网络' };
        }
        return { ok: true, httpStatus: response.status, raw: body.data };
      } catch (error) {
        activeCheck(job);
        deadlineCheck(job);
        if (error.name === 'AbortError') throw new Error('GMGN 请求超时，请稍后重试');
        // Never return exception text or upstream error bodies: they may echo secrets.
        throw new Error('无法连接 GMGN，请检查网络或代理后重试');
      } finally { clearTimeout(timer); job.controller.signal.removeEventListener('abort', cancelRequest); }
    }
    async function run(version) {
      await writes;
      const record = await store.get('account') || {};
      if (version !== generation) throw new Error('API 设置已变更，请重新检测');
      if (!record.apiKey) throw new Error('请先保存 GMGN API Key');
      const cooldown = Number(await store.get('cooldown')) || 0;
      if (cooldown > now()) throw new Error(`GMGN 限频，请在 ${new Date(cooldown).toLocaleTimeString('zh-CN')} 后重试`);
      if (record.report && now() - record.report.testedAt < REFRESH_INTERVAL_MS) return { report: record.report, cached: true };
      active = new AbortController();
      const job = { version, controller: active, key: record.apiKey, stop: false };
      const report = { format: 'trench-gmgn-diagnostic-v1', testedAt: now(), timezone: 'Asia/Shanghai',
        account: { ok: false }, scope: { recognized: false, chains: [], walletCount: 0, ignoredRows: 0 }, profits: [],
        interpretation: { allChainAssets: '待核对返回字段，未认定存在全链总资产', todayPnl: 'period=1d 的返回仅用于核对；尚未确认与 GMGN 今日盈亏及日界线一致',
          fallback: '若不能直接取得全链数据，按 GMGN 当前链与所选钱包显示原币余额和相同口径盈亏' } };
      try {
        const response = await call('/v1/user/info', null, job);
        const { raw, ...result } = response;
        report.account = { route: '/v1/user/info', ...result, ...(raw ? { data: sanitize(raw, job.key) } : {}) };
        if (response.ok) {
          const scope = discover(report.account.data);
          report.scope = { recognized: scope.recognized, chains: [...scope.groups.keys()], walletCount: [...scope.groups.values()].reduce((n, addresses) => n + addresses.size, 0), ignoredRows: scope.ignored };
          // Probe each recognized chain, without treating this sample as a total.
          for (const [chain, addresses] of [...scope.groups].slice(0, 20)) {
            activeCheck(job);
            if (job.stop) { report.profits.push({ chain, skipped: true, message: '认证或限频阻止了后续检测' }); continue; }
            if (!PROFIT_CHAINS.has(chain)) { report.profits.push({ chain, skipped: true, message: '账户返回了此链，但盈亏接口支持范围尚待核对' }); continue; }
            try {
              const checked = [...addresses].slice(0, 100);
              const response = await call('/v1/user/wallet_profits', { chain, wallet_addresses: checked, period: '1d' }, job);
              const { raw: profits, ...result } = response;
              report.profits.push({ chain, route: '/v1/user/wallet_profits', period: '1d', walletsChecked: checked.length,
                sampled: addresses.size > 100, ...result, ...(profits ? { data: sanitize(profits, job.key) } : {}) });
            } catch { activeCheck(job); job.stop = true; report.profits.push({ chain, ok: false, message: '盈亏检测中断，请检查网络后重试' }); }
          }
          report.message = Array.isArray(raw?.wallets) && raw.wallets.length === 0
            ? 'API 认证成功，账户接口返回空钱包列表（wallets: []）。可从 GMGN 自动同步账户钱包，再按地址查询余额与盈亏；无需开启交易权限。'
            : '账户接口连接成功。全链总资产与今日盈亏的字段含义仍待核对。';
          if (report.profits.some(row => !row.ok)) report.message += ' 部分链的盈亏检测未完成，请查看报告。';
        } else report.message = response.message;
      } catch (error) { activeCheck(job); report.message = error.message; report.account = { ok: false, route: '/v1/user/info', message: error.message }; }
      report.finishedAt = now(); activeCheck(job);
      await mutate(async () => { activeCheck(job); await store.set('account', { ...record, report }); });
      activeCheck(job); return { report, cached: false };
    }
    async function testManual(manual) {
      const version = generation, value = await finance(manual.defaultChain);
      const result = { format: 'trench-gmgn-manual-v1', testedAt: now(), account: { ok: value.balance !== null || value.pnl !== null },
        scope: { chains: Object.keys(manual.chains), walletCount: Object.values(manual.chains).reduce((n, item) => n + item.addresses.length, 0) },
        profits: [{ chain: value.chain, period: '1d', ok: value.pnl !== null }], finance: value,
        message: value.reason || '查询成功，已按手动填写的钱包统计主币余额和 1日已实现盈亏。' };
      await mutate(async () => { if (version !== generation) throw new Error('API 设置已变更'); const account = await store.get('account'); await store.set('account', { ...account, report: result }); });
      return { report: result, cached: value.cached === true };
    }
    async function test() {
      await writes;
      const version = generation;
      const manual = await store.get('manual-wallets');
      if (version !== generation) throw new Error('API 或钱包设置已变更，请重新检测');
      if (manual) return testManual(manual);
      if (flight) return flight;
      const pending = run(version); flight = pending;
      const done = () => { if (flight === pending) flight = null; };
      pending.then(done, done); return pending;
    }
    async function report() { return (await store.get('account'))?.report || null; }
    function checkWallets(read, requestedChain) {
      if (walletCheckFlight) return walletCheckFlight;
      const pending = (async () => {
        const claim = await mutate(async () => {
          const old = await store.get('wallet-check');
          if (old?.checkedAt > 0 && now() >= old.checkedAt && now() < old.nextCheckAt) return null;
          const gate = { checkedAt: now(), nextCheckAt: now() + WALLET_CHECK_INTERVAL_MS, status: 'checking', lastSuccessAt: old?.lastSuccessAt || 0 };
          // Persist before reading any tab: repeated clicks and worker restarts share this gate.
          await store.set('wallet-check', gate);
          return { gate, version: generation };
        });
        if (!claim) return { checked: false, changed: false };
        let snapshot = null;
        try { snapshot = F.validateSnapshot(await read()); } catch {}
        return mutate(async () => {
          if (claim.version !== generation) {
            await store.set('wallet-check', { ...claim.gate, status: 'cancelled' });
            return { checked: true, changed: false };
          }
          const entries = Object.entries(snapshot?.chains || {}).filter(([chain]) => Object.hasOwn(F.CHAINS, chain));
          if (!snapshot || !entries.length || entries.some(([, group]) => group.addresses.length > 20)) {
            await store.set('wallet-check', { ...claim.gate, status: 'unavailable' });
            return { checked: true, changed: false };
          }
          const old = await store.get('manual-wallets');
          const ownerChanged = !!old?.owner && old.owner !== snapshot.owner;
          // Missing groups can be an unloaded chain. Explicit empty groups remove that chain's wallets.
          const chains = ownerChanged ? {} : { ...old?.chains };
          for (const [chain, group] of entries) chains[chain] = { addresses: group.addresses, archived: 0 };
          const ordered = Object.fromEntries(Object.entries(chains).sort(([a], [b]) => a.localeCompare(b)));
          const defaultChain = ordered[old?.defaultChain]?.addresses.length ? old.defaultChain
            : ordered[requestedChain]?.addresses.length ? requestedChain
            : Object.keys(ordered).find(chain => ordered[chain].addresses.length) || (ordered[old?.defaultChain] ? old.defaultChain : Object.keys(ordered)[0]);
          const identity = JSON.stringify([defaultChain, ordered]);
          const oldIdentity = old ? JSON.stringify([old.defaultChain, Object.fromEntries(Object.entries(old.chains).sort(([a], [b]) => a.localeCompare(b)))]) : '';
          const changed = ownerChanged || identity !== oldIdentity;
          if (changed) {
            cancel();
            const account = await store.get('account') || {};
            // Retire old diagnostic fallbacks as well as the previous wallet set's cached amounts.
            await store.set('account', { ...account, revision: uuid(), report: null });
          }
          await store.set('manual-wallets', { ...old, chains: changed ? ordered : old.chains, defaultChain, identity: changed ? identity : old.identity,
            owner: snapshot.owner, source: 'gmgn', savedAt: changed ? now() : old.savedAt, syncedAt: now() });
          await store.set('wallet-check', { ...claim.gate, status: changed ? 'updated' : 'unchanged', lastSuccessAt: now() });
          return { checked: true, changed };
        });
      })();
      walletCheckFlight = pending;
      const done = () => { if (walletCheckFlight === pending) walletCheckFlight = null; };
      pending.then(done, done); return pending;
    }
    async function syncWallets(input, chain) {
      const snapshot = input === null ? null : F.validateSnapshot(input);
      if (input !== null && !snapshot) throw new Error('钱包列表格式不正确');
      return mutate(async () => {
        const old = await store.get('finance-wallets');
        const identity = snapshot ? JSON.stringify([snapshot.owner, snapshot.chains]) : '';
        if (!(await store.get('manual-wallets')) && (old?.identity || '') !== identity) cancel();
        const synced = snapshot ? { ...snapshot, identity, syncedAt: now(), lastChain: F.validChain(chain) ? chain : old?.lastChain || Object.keys(snapshot.chains)[0] } : null;
        if (identity !== (old?.identity || '') || (synced && (now() - (old?.syncedAt || 0) > 30000 || synced.lastChain !== old.lastChain))) await store.set('finance-wallets', synced);
        return { synced: !!synced };
      });
    }
    function previousValue(existing, account, key, chain) {
      const value = existing?.key === key && existing.at <= now() ? { ...existing.value } : null;
      const report = account?.report?.finance;
      // A saved account revision owns its diagnostic report (save clears it).
      // Recover its successful fields when an older release replaced the cache
      // with a rate-limit failure. Never borrow from another chain/account.
      if (!value) return report?.chain === chain && report.at <= now() ? { ...report } : null;
      for (const field of ['balance', 'pnl']) {
        if (F.decimal(value[field]) !== null) { value[field + 'At'] ||= value.at; continue; }
        if (report?.chain === chain && report.at <= now() && F.decimal(report[field]) !== null) {
          value[field] = report[field]; value[field + 'At'] = report[field + 'At'] || report.at;
          value.staleFields = [...new Set([...(value.staleFields || []), field])];
        }
      }
      return value;
    }
    async function peek(requestedChain) {
      await writes; const version = generation;
      const manual = await store.get('manual-wallets'), account = await store.get('account');
      if (!manual || !account?.apiKey) return null;
      const chain = F.validChain(requestedChain) ? requestedChain : manual.defaultChain;
      const key = JSON.stringify([manual.identity, account.revision || account.savedAt, chain]);
      let current, cached, running, cooldown;
      while (true) {
        const revision = financeRevisions.get(key) || 0;
        const persisted = await store.get('finance-cache-' + chain);
        cooldown = Math.max(blockedUntil, Number(await store.get('cooldown')) || 0);
        if (version !== generation) return null;
        current = progress.get(key); running = financeFlights.get(key);
        // IDB reads yield. A query can publish and finish while they are pending.
        // Never combine an earlier amount (often zero) with a later "finished"
        // flag. Read the new durable result when its in-memory progress is gone.
        if (!current && revision !== (financeRevisions.get(key) || 0)) continue;
        cached = current || persisted; break;
      }
      if (version !== generation || cached?.key !== key || now() < cached.at || now() - cached.at > 300000) return null;
      const value = current ? current.value : previousValue(cached, account, key, chain);
      return { ...value, nextRefreshAt: Math.max(value.nextRefreshAt || cached.at + REFRESH_INTERVAL_MS, cooldown),
        cooldownReason: cooldown > now() ? 'rate-limit' : 'interval', cached: !running, refreshing: !!running };
    }
    async function finance(requestedChain, { detach = false } = {}) {
      await writes;
      const version = generation;
      const manual = await store.get('manual-wallets');
      const synced = manual ? { ...manual, lastChain: manual.defaultChain } : null;
      if (version !== generation) throw new Error('钱包或 API 设置已变更，请重新点击');
      const chain = F.validChain(requestedChain) ? requestedChain : synced?.lastChain || '';
      const info = F.CHAINS[chain], addresses = synced?.chains?.[chain]?.addresses || [];
      const base = { chain, name: info?.[0] || chain.toUpperCase(), symbol: info?.[1] || '', count: addresses.length,
        archived: synced?.chains?.[chain]?.archived || 0, source: 'api', balance: null, pnl: null, at: now(), reason: '' };
      if (!synced) return { ...base, reason: '暂未取得钱包数据' };
      if (!info) return { ...base, reason: '该链暂未接入 API' };
      if (!addresses.length) return synced.source === 'gmgn' && synced.chains[chain]
        ? { ...base, balance: '0', pnl: '0' } : { ...base, reason: '暂未取得钱包数据' };
      if (addresses.length > 20) return { ...base, reason: '本版每条链最多查询 20 个钱包' };
      const record = await store.get('account');
      if (version !== generation) throw new Error('钱包或 API 设置已变更，请重新点击');
      if (!record?.apiKey) return { ...base, reason: '请在设置中填写 API Key' };
      const cacheKey = JSON.stringify([manual.identity, record.revision || record.savedAt, chain]);
      let existing, attempt, cooldown, revision;
      do {
        revision = financeRevisions.get(cacheKey) || 0;
        existing = await store.get('finance-cache-' + chain);
        attempt = await store.get('finance-attempt-' + chain);
        cooldown = Math.max(blockedUntil, Number(await store.get('cooldown')) || 0);
        if (version !== generation) throw new Error('钱包或 API 设置已变更，请重新点击');
      } while (revision !== (financeRevisions.get(cacheKey) || 0));
      const running = financeFlights.get(cacheKey);
      if (running && now() >= running.startedAt && now() - running.startedAt < queryMaxAgeMs) {
        return detach ? { ...progress.get(cacheKey).value, cached: false, refreshing: true } : running.promise;
      }
      if (running) { running.controller.abort(); financeFlights.delete(cacheKey); progress.delete(cacheKey); }
      const prior = previousValue(existing, record, cacheKey, chain);
      const cacheUntil = existing?.key === cacheKey ? existing.value.nextRefreshAt || existing.at + REFRESH_INTERVAL_MS : 0;
      const attemptUntil = attempt?.key === cacheKey ? attempt.nextRefreshAt : 0;
      const nextRefreshAt = Math.max(cacheUntil, attemptUntil || 0, cooldown);
      if (nextRefreshAt > now()) {
        const interrupted = attempt?.key === cacheKey && attempt.queryId !== existing?.value?.queryId;
        return { ...base, ...prior, queryId: attempt?.key === cacheKey ? attempt.queryId : prior?.queryId || uuid(),
          reason: cooldown > now() ? `GMGN 限频，请在 ${new Date(cooldown).toLocaleTimeString('zh-CN')} 后重试`
            : interrupted ? '上次查询中断，冷却结束后点击重试' : prior?.reason || '',
          nextRefreshAt, cooldownReason: cooldown > now() ? 'rate-limit' : 'interval', cached: true, refreshing: false };
      }
      const controller = new AbortController(); financeControllers.add(controller);
      const queryId = uuid();
      const job = { version, controller, key: record.apiKey, stop: false, expiresAt: now() + queryMaxAgeMs };
      const pending = (async () => {
        const result = { ...base, queryId, source: 'manual-api', at: now(), nextRefreshAt: now() + REFRESH_INTERVAL_MS, staleFields: [] }, balances = [];
        for (const field of ['balance', 'pnl']) if (F.decimal(prior?.[field]) !== null) {
          result[field] = prior[field]; result[field + 'At'] = prior[field + 'At'] || prior.at; result.staleFields.push(field);
        }
        let gotPnl = false, gotBalance = false;
        const publish = () => { activeCheck(job); result.at = now(); progress.set(cacheKey, { key: cacheKey, at: now(), value: structuredClone(result) }); changedFinance(cacheKey); };
        publish();
        try {
          // Record before admitting network work: a terminated MV3 worker must
          // not immediately repeat the whole group when the user clicks again.
          await mutate(async () => { activeCheck(job); await store.set('finance-attempt-' + chain,
            { key: cacheKey, queryId, at: now(), nextRefreshAt: result.nextRefreshAt }); });
          const profits = await call('/v1/user/wallet_profits', { chain, period: '1d', wallet_addresses: addresses }, job);
          const pnl = profits.ok ? F.profits(profits.raw, chain, addresses) : null;
          if (pnl !== null) { result.pnl = pnl; result.pnlAt = now(); gotPnl = true; result.staleFields = result.staleFields.filter(field => field !== 'pnl'); }
          else result.reason = profits.message;
          publish();
          // Keep every wallet in the result; never turn a failed/incomplete read
          // into a smaller total. The shared scheduler enforces rate + concurrency.
          if (!job.stop) await Promise.all(addresses.map(async address => {
            try {
              const response = await call('/v1/user/wallet_token_balance', null, job, { chain, wallet_address: address, token_address: F.native(chain) });
              const amount = response.ok ? F.balance(response.raw, chain, address) : null;
              if (amount === null) result.reason ||= response.message || '部分钱包余额未返回';
              else balances.push(amount);
            } catch (error) { activeCheck(job); result.reason ||= error.message; }
          }));
          if (balances.length === addresses.length) { result.balance = F.sum(balances); result.balanceAt = now(); gotBalance = true; result.staleFields = result.staleFields.filter(field => field !== 'balance'); }
          if (!gotPnl) result.reason ||= '盈亏接口未返回完整钱包数据';
          if (!gotBalance) result.reason ||= '余额接口未返回完整钱包数据';
        } catch (error) { activeCheck(job); result.reason = error.message; }
        activeCheck(job); result.at = now();
        const serverUntil = Math.max(blockedUntil, Number(await store.get('cooldown')) || 0);
        result.nextRefreshAt = Math.max(now() + REFRESH_INTERVAL_MS, serverUntil);
        result.cooldownReason = serverUntil > now() ? 'rate-limit' : 'interval'; publish();
        await mutate(async () => { activeCheck(job); await store.set('finance-cache-' + chain, { key: cacheKey, at: now(), failed: !gotPnl || !gotBalance, value: result }); });
        return result;
      })();
      const entry = { promise: pending, controller, startedAt: now(), queryId };
      financeFlights.set(cacheKey, entry);
      const done = () => { financeControllers.delete(controller); if (financeFlights.get(cacheKey) === entry) { financeFlights.delete(cacheKey); progress.delete(cacheKey); changedFinance(cacheKey); } };
      pending.then(done, done);
      return detach ? { ...progress.get(cacheKey).value, cached: false, refreshing: true } : pending;
    }
    const start = async chain => {
      const value = await finance(chain, { detach: true });
      return { ...value, queryId: value.queryId || uuid(), refreshing: value.refreshing === true };
    };
    return { status, save, clear, test, report, syncWallets, checkWallets, finance, peek, start };
  }
  const api = { create, sanitize, discover };
  root.TrenchGmgnConnection = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
