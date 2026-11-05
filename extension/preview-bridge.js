/* Standalone local preview only. Installed extensions always use Chrome's real APIs. */
(function () {
  if (globalThis.chrome?.runtime?.id) return;
  const key = 'trench-whale-local-preview-v1';
  const listeners = new Set();
  let queue = Promise.resolve();
  function read() {
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
    return { settings: TrenchCore.sanitizeSettings(raw?.settings), wallets: TrenchCore.sanitizeWallets(raw?.wallets),
      connections: { bsc: 'not-connected', solana: 'not-connected', news: 'not-connected' } };
  }
  function write(state, changes) {
    localStorage.setItem(key, JSON.stringify({ settings: state.settings, wallets: state.wallets }));
    listeners.forEach(fn => fn(changes, 'local'));
  }
  async function handle(message) {
    const state = read();
    if (message.type === 'state:get') return { ok: true, ...state };
    if (message.type === 'gmgn:status') return { ok: true, connection: { configured: false, preview: true, last: null } };
    if (message.type === 'binance:status') return { ok: true, connection: { configured: false, preview: true, last: null } };
    if (message.type === 'settings:patch') {
      state.settings = TrenchCore.patchSettings(state.settings, message.patch);
      write(state, { settings: { newValue: state.settings } }); return { ok: true, settings: state.settings };
    }
    if (message.type === 'wallet:add') {
      if (!TrenchCore.validateAddress(message.wallet?.chain, message.wallet?.address)) throw new Error('请检查链和完整钱包地址');
      if (state.wallets.length >= 30) throw new Error('第一版最多保存 30 个地址');
      const wallets = TrenchCore.sanitizeWallets([...state.wallets, { ...message.wallet, id: crypto.randomUUID() }]);
      if (wallets.length === state.wallets.length) throw new Error('这个地址已经保存过了');
      state.wallets = wallets; write(state, { wallets: { newValue: wallets } }); return { ok: true, wallets };
    }
    if (message.type === 'wallet:remove') {
      state.wallets = state.wallets.filter(wallet => wallet.id !== message.id);
      write(state, { wallets: { newValue: state.wallets } }); return { ok: true, wallets: state.wallets };
    }
    if (message.type === 'open:home') { location.hash = 'room'; return { ok: true }; }
    throw new Error('此操作需要先加载浏览器插件');
  }
  globalThis.TrenchPreviewBridge = {
    send(message) { const next = queue.then(() => handle(message)); queue = next.catch(() => {}); return next; },
    listen(listener) { listeners.add(listener); }
  };
})();
