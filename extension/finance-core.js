(function (root) {
  'use strict';
  const CHAINS = {
    bsc: ['BSC', 'BNB'], sol: ['Solana', 'SOL'], eth: ['Ethereum', 'ETH'], base: ['Base', 'ETH'],
    arbitrum: ['Arbitrum', 'ETH'], hyperevm: ['HyperEVM', 'HYPE'], robinhood: ['Robinhood', 'ETH'],
    arc: ['Arc', 'USDC'], stable: ['Stable', 'USDT']
  };
  const ADDRESS = /^0x[\da-fA-F]{40}$/, SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const native = chain => chain === 'sol' ? 'So11111111111111111111111111111111111111112' : '0x' + '0'.repeat(40);
  const validChain = chain => typeof chain === 'string' && /^[a-z][a-z0-9_-]{1,23}$/.test(chain);
  const validAddress = (chain, address) => {
    if (typeof address !== 'string' || !(chain === 'sol' ? SOL : ADDRESS).test(address)) return false;
    if (chain !== 'sol') return true;
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let value = 0n; for (const char of address) value = value * 58n + BigInt(alphabet.indexOf(char));
    let bytes = 0; while (value) { bytes++; value >>= 8n; }
    return bytes + (address.match(/^1*/)?.[0].length || 0) === 32;
  };
  const canonical = (chain, address) => chain === 'sol' ? address : address.toLowerCase();
  function manualWallets(input, defaultChain = 'bsc') {
    if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.hasOwn(CHAINS, defaultChain)) throw new Error('请选择支持的默认网络');
    const chains = {};
    for (const [chain, raw] of Object.entries(input)) {
      if (!Object.hasOwn(CHAINS, chain)) throw new Error('钱包网络暂不支持');
      if (typeof raw !== 'string' && !Array.isArray(raw)) throw new Error('请填写完整钱包地址');
      if ((typeof raw === 'string' && raw.length > 12000) || (Array.isArray(raw) && raw.length > 200)) throw new Error('钱包地址过多');
      const values = typeof raw === 'string' ? raw.split(/[\s,，;；]+/).filter(Boolean) : raw;
      if (values.some(value => !validAddress(chain, value))) throw new Error(`${CHAINS[chain][0]} 地址格式错误，请每行填写一个完整公开地址`);
      const addresses = [...new Set(values.map(value => canonical(chain, value)))].sort();
      if (addresses.length > 20) throw new Error(`${CHAINS[chain][0]} 每条链最多填写 20 个钱包`);
      if (addresses.length) chains[chain] = { addresses, archived: 0 };
    }
    if (!Object.keys(chains).length) throw new Error('请至少填写一个钱包地址');
    if (!chains[defaultChain]) throw new Error('默认网络还没有填写钱包地址');
    return { chains, defaultChain, identity: JSON.stringify([defaultChain, chains]) };
  }
  function context(href) {
    try {
      const url = new URL(href); if (url.protocol !== 'https:' || !['gmgn.ai', 'www.gmgn.ai'].includes(url.hostname)) return null;
      const parts = url.pathname.split('/').filter(Boolean);
      const raw = url.searchParams.get('chain') || (/^(token|address)$/.test(parts[1] || '') ? parts[0] : '');
      const chain = ({ solana: 'sol', ethereum: 'eth' })[raw] || raw;
      return { chain: validChain(chain) ? chain : '' };
    } catch { return null; }
  }
  function walletCache(raw) {
    if (typeof raw !== 'string' || raw.length > 2 * 1024 * 1024) return null;
    let data; try { data = JSON.parse(raw); } catch { return null; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const chains = {}, owners = new Set();
    for (const [chain, group] of Object.entries(data).slice(0, 30)) {
      if (!validChain(chain) || !Array.isArray(group?.list)) continue;
      if (group.list.length > 100) return null;
      const addresses = new Set();
      for (const row of group.list) {
        if (!validAddress(chain, row?.address) || typeof row.user_id !== 'string' || !row.user_id || row.user_id.length > 100) return null;
        owners.add(row.user_id); addresses.add(canonical(chain, row.address));
      }
      chains[chain] = { addresses: [...addresses].sort(), archived: Math.max(0, Number.isSafeInteger(group.archive_count) ? group.archive_count : 0) };
    }
    if (owners.size !== 1 || !Object.keys(chains).length) return null;
    return { chains, owner: [...owners][0] };
  }
  function validateSnapshot(input) {
    if (!input || !/^[\da-f]{64}$/.test(input.owner || '') || !input.chains || typeof input.chains !== 'object') return null;
    const chains = {};
    for (const [chain, group] of Object.entries(input.chains).slice(0, 30)) {
      if (!validChain(chain) || !Array.isArray(group?.addresses) || group.addresses.length > 100 || group.addresses.some(address => !validAddress(chain, address))) return null;
      chains[chain] = { addresses: [...new Set(group.addresses.map(address => canonical(chain, address)))].sort(),
        archived: Math.max(0, Number.isSafeInteger(group.archived) ? group.archived : 0) };
    }
    if (!Object.keys(chains).length) return null;
    return { owner: input.owner, chains };
  }
  function decimal(value) { return (typeof value === 'string' || typeof value === 'number') && /^-?\d+(?:\.\d{1,80})?$/.test(String(value)) ? String(value) : null; }
  function sum(values) {
    if (!values.length || values.some(value => decimal(value) === null)) return null;
    values = values.map(String);
    const scale = Math.max(...values.map(value => (value.split('.')[1] || '').length));
    const total = values.reduce((n, value) => {
      const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
      return n + (value.startsWith('-') ? -1n : 1n) * BigInt(whole + fraction.padEnd(scale, '0'));
    }, 0n);
    const digits = (total < 0n ? -total : total).toString().padStart(scale + 1, '0');
    return (total < 0n ? '-' : '') + (scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits);
  }
  function profits(data, chain, addresses) {
    if (!Array.isArray(data?.list) || data.list.length !== addresses.length) return null;
    const found = new Map();
    for (const row of data.list) {
      if (!validAddress(chain, row?.wallet_address)) return null;
      const address = canonical(chain, row.wallet_address);
      if (!addresses.includes(address) || found.has(address) || decimal(row.realized_profit) === null) return null;
      found.set(address, row.realized_profit);
    }
    return found.size === addresses.length ? sum([...found.values()]) : null;
  }
  function balance(data, chain, address) {
    const rows = data?.balances;
    if (!Array.isArray(rows)) return null;
    const matches = rows.filter(row => validAddress(chain, row?.wallet_address) && canonical(chain, row.wallet_address) === address &&
      validAddress(chain, row.token_address) && canonical(chain, row.token_address) === canonical(chain, native(chain)));
    if (matches.length !== 1 || decimal(matches[0].balance) === null || Number(matches[0].balance) < 0) return null;
    // This endpoint returns human units, confirmed against native_balance in wallet_stats.
    return String(matches[0].balance);
  }
  function format(value, places = 2, signed = false) {
    if (decimal(value) === null) return null;
    const negative = String(value).startsWith('-'), [whole, fraction = ''] = String(value).replace(/^-/, '').split('.');
    let units = BigInt(whole + fraction.padEnd(places + 1, '0').slice(0, places));
    if (Number(fraction.padEnd(places + 1, '0')[places]) >= 5) units++;
    const digits = units.toString().padStart(places + 1, '0');
    let text = places ? digits.slice(0, -places) + '.' + digits.slice(-places) : digits;
    if (!signed) text = text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return (units === 0n ? '' : negative ? '-' : signed ? '+' : '') + (signed ? '$' : '') + text;
  }
  // Abort must settle the consumer even if a suspended network stream ignores abort.
  function abortable(promise, signal) {
    return new Promise((resolve, reject) => {
      const abort = () => { cleanup(); reject(new DOMException('Request aborted', 'AbortError')); };
      const cleanup = () => signal.removeEventListener('abort', abort);
      Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    });
  }
  // MV3 workers and sleeping browsers may close IDB connections. Never retain a
  // closed database (or an unresolved transaction) for the lifetime of the worker.
  function privateStore(name, { factory = root.indexedDB, timeoutMs = 5000 } = {}) {
    let database = null, opening = null;
    const reset = db => { if (database === db) { database = null; opening = null; } try { db?.close(); } catch {} };
    function open() {
      if (database) return Promise.resolve(database);
      if (opening) return opening;
      const pending = new Promise((resolve, reject) => {
        let settled = false;
        const fail = () => { if (settled) return; settled = true; clearTimeout(timer); reject(new Error('无法打开插件本地存储，请重试')); };
        const timer = setTimeout(fail, timeoutMs);
        let request;
        try { request = factory.open(name, 1); } catch { fail(); return; }
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('private')) request.result.createObjectStore('private'); };
        request.onerror = fail;
        request.onsuccess = () => {
          const db = request.result;
          if (settled) { db.close(); return; }
          settled = true; clearTimeout(timer); database = db;
          db.onclose = () => reset(db); db.onversionchange = () => reset(db);
          resolve(db);
        };
      });
      opening = pending;
      pending.catch(() => { if (opening === pending) opening = null; });
      return pending;
    }
    async function access(key, value, write, retry = true) {
      const db = await open();
      try {
        return await new Promise((resolve, reject) => {
          let tx, result, settled = false;
          const finish = error => {
            if (settled) return; settled = true; clearTimeout(timer);
            if (error) reject(error); else resolve(result);
          };
          const timer = setTimeout(() => {
            const error = new Error('插件本地存储响应超时，请重试'); error.name = 'TimeoutError';
            finish(error); try { tx?.abort(); } catch {} reset(db);
          }, timeoutMs);
          try {
            tx = db.transaction('private', write ? 'readwrite' : 'readonly');
            const request = write ? tx.objectStore('private').put(value, key) : tx.objectStore('private').get(key);
            request.onsuccess = () => { result = write ? undefined : request.result; };
            tx.oncomplete = () => finish();
            tx.onabort = tx.onerror = () => finish(tx.error || new DOMException('Storage transaction aborted', 'AbortError'));
          } catch (error) { finish(error); }
        });
      } catch (error) {
        if (['InvalidStateError', 'AbortError', 'UnknownError', 'TimeoutError'].includes(error.name)) {
          reset(db); if (retry) return access(key, value, write, false);
        }
        throw new Error(write ? '无法保存插件本地存储，请重试' : '无法读取插件本地存储，请重试');
      }
    }
    return { get: key => access(key, undefined, false), set: (key, value) => access(key, value, true) };
  }
  const api = { CHAINS, native, validChain, validAddress, context, walletCache, validateSnapshot, manualWallets, decimal, sum, profits, balance, format, abortable, privateStore };
  root.TrenchFinance = api; if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
