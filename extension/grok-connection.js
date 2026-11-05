/* Native messaging owns credentials. Pages receive only bot names, task status and deep links. */
(function (root) {
  'use strict';
  function create(onState) {
    let port, sequence = 0, state = { installed: false, configured: false, tasks: [], events: [] }, reconnect = false, statusPending = null;
    const pending = new Map();
    function connect() {
      if (port) return port;
      const current = chrome.runtime.connectNative('com.trenchwhale.grok'); port = current;
      current.onMessage.addListener(msg => {
        if (port !== current) return;
        if (msg.type === 'state' && msg.state) { state = { ...msg.state, installed: true }; onState?.(state); }
        if (Number.isSafeInteger(msg.id) && pending.has(msg.id)) {
          const p = pending.get(msg.id); pending.delete(msg.id); clearTimeout(p.timer);
          if (msg.ok && typeof msg.result?.configured === 'boolean') { state = { ...msg.result, installed: true }; onState?.(state); }
          if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error || '连接组件未能完成操作'));
        }
      });
      current.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError?.message || '连接组件已断开';
        if (port !== current) return; port = null;
        state = { ...state, installed: false, error: /not found|not registered|forbidden/i.test(error) ? '请先运行安装包中对应系统的“一键安装AI连接组件”，再检测连接。' : '连接组件已断开，请检测连接或重新安装。' };
        for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(state.error)); } pending.clear(); onState?.(state);
        if (reconnect) chrome.alarms.create('grok-reconnect', { delayInMinutes: 1 });
      }); return current;
    }
    async function call(action, payload = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(new Error('连接操作超时，请检测连接后查看状态')); }, action === 'status' ? 12_000 : 75_000);
        pending.set(id, { resolve, reject, timer });
        try { connect().postMessage({ ...payload, id, action }); } catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
      });
    }
    function status() {
      if (statusPending) return statusPending;
      statusPending = (async () => { try { state = { ...await call('status'), installed: true }; } catch {} return state; })().finally(() => { statusPending = null; });
      return statusPending;
    }
    async function enable() { reconnect = true; await chrome.storage.local.set({ grokEnabled: true }); }
    async function disable() { reconnect = false; await chrome.storage.local.remove('grokEnabled'); await chrome.alarms.clear('grok-reconnect'); }
    chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'grok-reconnect' && reconnect) status().catch(() => {}); });
    chrome.storage.local.get('grokEnabled').then(data => { if (data.grokEnabled) { reconnect = true; status().then(onState).catch(() => {}); } });
    return { call, status, enable, disable, peek: () => state };
  }
  root.TrenchGrok = { create };
})(globalThis);
