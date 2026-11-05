/* Read visible GMGN account labels only. No cookies, page state or network hooks. */
(function (root) {
  'use strict';
  if (root.TrenchGmgnPage) return;
  const SYMBOLS = { bsc: 'BNB', sol: 'SOL', eth: 'ETH', base: 'ETH', arbitrum: 'ETH', hyperevm: 'HYPE',
    tron: 'TRX', monad: 'MON', megaeth: 'ETH', xlayer: 'OKB', arc: 'USDC', stable: 'USDT' };
  const NAMES = { bsc: 'BSC', sol: 'Solana', eth: 'Ethereum', base: 'Base', arbitrum: 'Arbitrum', hyperevm: 'HyperEVM',
    tron: 'Tron', monad: 'Monad', megaeth: 'MegaETH', xlayer: 'X Layer', arc: 'Arc', stable: 'Stable', robinhood: 'Robinhood' };
  const normalize = text => String(text || '').replace(/[\u2212\u2013\uff0d]/g, '-').replace(/\uff0b/g, '+').replace(/\s+/g, ' ').trim();
  function context(href) {
    try {
      const url = new URL(href);
      if (url.protocol !== 'https:' || !['gmgn.ai', 'www.gmgn.ai'].includes(url.hostname)) return null;
      const canonical = chain => ({ solana: 'sol', ethereum: 'eth' })[chain] || chain;
      const query = canonical((url.searchParams.get('chain') || '').toLowerCase());
      const segment = url.pathname.split('/').filter(Boolean), pathChain = /^(token|address)$/.test(segment[1] || '') ? canonical(segment[0]) : '';
      const chain = query && pathChain && query !== pathChain ? '' : query || pathChain;
      if (!/^[a-z][a-z0-9_-]{1,23}$/.test(chain)) return { chain: '', name: '链待确认', symbol: '' };
      return { chain, name: NAMES[chain] || chain.toUpperCase(), symbol: SYMBOLS[chain] || '' };
    } catch { return null; }
  }
  function amount(text, symbol = '', pnl = false) {
    let value = normalize(text);
    // Reject tiny-number subscripts rather than silently interpreting 0.0₅123 as 0.
    if (!value || value.length > 90 || /[₀-₉⁰-⁹•*…]|0x[\da-f]{6}/i.test(value)) return null;
    value = value.replace(/\s*\([+-]?\s*\d[\d,.]*\s*%\)$/, '').trim();
    let remainder = '';
    for (const unit of [symbol, 'USD'].filter(Boolean)) {
      if (value.toUpperCase().endsWith(unit)) { remainder = unit; value = value.slice(0, -unit.length).trim(); break; }
    }
    const raw = value.replace(/^\$\s*([+-])/, '$1$').replace(/\s/g, '');
    if (!/^[+-]?\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?[KMB]?$/i.test(raw)) return null;
    if (!pnl && (/[-+$%]/.test(raw) || remainder === 'USD')) return null;
    const n = Number(raw.replace(/[$,KMB]/gi, '')) * ({ K: 1e3, M: 1e6, B: 1e9 }[raw.slice(-1).toUpperCase()] || 1);
    if (!Number.isFinite(n) || (!pnl && n < 0)) return null;
    const suffix = pnl && remainder && remainder !== 'USD' ? ` ${remainder}` : pnl && remainder === 'USD' && !raw.includes('$') ? ' USD' : '';
    return { text: (pnl && n > 0 && !raw.startsWith('+') ? '+' : '') + raw + suffix, sign: n === 0 ? 0 : n > 0 ? 1 : -1 };
  }
  const PNL_LABEL = /^(今日(?:已实现)?(?:盈亏|收益|利润)|当日(?:盈亏|收益)|(?:Today(?:'s)?|Daily)\s*(?:P\s*&\s*L|PnL|Profit)|24\s*[hH小时]+\s*(?:盈亏|收益|P\s*&\s*L|PnL|Profit))\s*[:：]?\s*/i;
  function parse(text, kind, symbol, bare = false) {
    text = normalize(text);
    let label, rest;
    if (kind === 'balance') {
      if (!symbol) return null;
      label = `${symbol}余额`;
      const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const prefix = new RegExp(`^(?:${escaped}\\s*(?:余额|Balance)?|(?:余额|Balance)\\s*${escaped})\\s*[:：]?\\s*`, 'i');
      const match = text.match(prefix);
      rest = match ? text.slice(match[0].length) : text;
      if (!match && !new RegExp(`\\s${escaped}$`, 'i').test(text) && !bare) return null;
    } else {
      const match = text.match(PNL_LABEL);
      if (!match && !bare) return null;
      label = match ? /^24/i.test(match[1]) ? '24h盈亏' : '今日盈亏' : '页面盈亏';
      rest = match ? text.slice(match[0].length) : text;
    }
    const result = amount(rest, symbol, kind === 'pnl');
    return result ? { label, ...result } : null;
  }
  function visible(element) {
    if (!element?.isConnected || element.closest('#trench-pet-root,#trench-gmgn-picker,script,style,input,textarea,[hidden],[aria-hidden="true"]')) return false;
    if (typeof element.checkVisibility === 'function' && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = element.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  }
  function textOf(element) { return normalize(element.innerText); }
  function accountZone(element) {
    const r = element.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= 180 && r.left >= innerWidth * .45 &&
      !element.closest('[role="dialog"],[role="menu"],[role="listbox"],main,article,table');
  }
  function iconCurrency(element, symbol) {
    const aliases = symbol === 'BNB' ? ['bnb', 'bsc'] : symbol === 'SOL' ? ['sol', 'solana'] : [symbol.toLowerCase()];
    return [...element.querySelectorAll('img')].some(img => {
      const alt = normalize(img.alt).toLowerCase();
      let filename = ''; try { filename = new URL(img.src).pathname.split('/').pop().split('.')[0].toLowerCase(); } catch {}
      return aliases.includes(alt) || aliases.includes(filename);
    });
  }
  function automatic(ctx) {
    const found = { balance: [], pnl: [] };
    // Account header only; token rows and other wallets' profile statistics are not account data.
    let visited = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, { acceptNode(el) {
      if (++visited > 5000 || el.matches('#trench-pet-root,#trench-gmgn-picker,script,style,input,textarea,main,article,table,[hidden],[aria-hidden="true"],[role="dialog"],[role="menu"],[role="listbox"]')) return NodeFilter.FILTER_REJECT;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && (r.top >= 180 || r.bottom <= 0 || r.right < innerWidth * .45)) return NodeFilter.FILTER_REJECT;
      return visible(el) && accountZone(el) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    } });
    let el;
    while ((el = walker.nextNode())) {
      const text = textOf(el); if (!text || text.length > 120) continue;
      for (const kind of ['balance', 'pnl']) {
        const result = parse(text, kind, ctx.symbol, kind === 'balance' && iconCurrency(el, ctx.symbol));
        if (result) found[kind].push({ ...result, method: 'auto' });
      }
    }
    const unique = rows => {
      const values = new Map(rows.map(row => [row.label + '|' + row.text, row]));
      return values.size === 1 ? [...values.values()][0] : null;
    };
    return { balance: unique(found.balance), pnl: unique(found.pnl) };
  }
  function selector(element) {
    const parts = [];
    for (let el = element; el && el !== document.documentElement; el = el.parentElement) {
      if (el.id && !/[:\s]/.test(el.id)) { parts.unshift('#' + CSS.escape(el.id)); break; }
      const tag = el.localName; if (!tag) return '';
      const siblings = [...(el.parentElement?.children || [])].filter(child => child.localName === tag);
      parts.unshift(tag + (siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(el) + 1})` : ''));
    }
    return parts.join(' > ');
  }
  function signature(element) {
    // Static text next to the chosen value guards against an index pointing at a different metric after a layout change.
    const parent = element.parentElement;
    const labels = parent ? [...parent.children].filter(el => el !== element).slice(0, 16)
      .map(el => textOf(el)).filter(text => text && text.length < 50 && !/\d/.test(text)).join('|') : '';
    const icons = parent ? [...parent.querySelectorAll('img')].slice(0, 3).map(img => {
      try { return new URL(img.src).pathname.split('/').pop(); } catch { return ''; }
    }).join('|') : '';
    return `${element.localName}|${labels}|${icons}`.slice(0, 220);
  }
  async function bindings() { try { return (await chrome.storage.local.get('gmgnPageBindings')).gmgnPageBindings || {}; } catch { return {}; } }
  function calibrated(binding, kind, ctx) {
    if (!binding || typeof binding.selector !== 'string' || binding.selector.length > 1800) return null;
    let matches; try { matches = document.querySelectorAll(binding.selector); } catch { return null; }
    if (matches.length !== 1 || !visible(matches[0]) || signature(matches[0]) !== binding.signature) return null;
    const value = parse(textOf(matches[0]), kind, ctx.symbol, true);
    // Do not silently change a calibrated Today metric into another period.
    return value && value.label === binding.label ? { ...value, method: 'picked' } : null;
  }
  async function read() {
    const href = location.href, ctx = context(href);
    if (!ctx) return null;
    const saved = await bindings();
    if (href !== location.href) return read();
    if (!ctx.chain) return { ...ctx, balance: null, pnl: null, readAt: Date.now(), foreground: !document.hidden };
    const selected = saved[ctx.chain] || {}, auto = selected.balance && selected.pnl ? {} : automatic(ctx);
    // A broken explicit binding must fail visibly rather than choose a different account field.
    const balance = selected.balance ? calibrated(selected.balance, 'balance', ctx) : auto.balance;
    const pnl = balance ? (selected.pnl ? calibrated(selected.pnl, 'pnl', ctx) : auto.pnl) : null;
    return { ...ctx, balance, pnl, readAt: Date.now(), foreground: !document.hidden };
  }
  let stopPicker = null;
  function pick(kind, onComplete) {
    const ctx = context(location.href);
    if (!ctx?.chain || !ctx.symbol) { onComplete?.('请先打开带有明确链名称的 GMGN 战壕页面'); return; }
    stopPicker?.();
    const host = document.createElement('div'); host.id = 'trench-gmgn-picker';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    const shadow = host.attachShadow({ mode: 'closed' });
    const banner = document.createElement('div');
    banner.style.cssText = 'pointer-events:auto;position:fixed;top:190px;left:50%;transform:translateX(-50%);max-width:90vw;background:#fff;color:#172234;padding:14px 18px;border:2px solid #759dd9;border-radius:14px;font:14px/1.6 "Microsoft YaHei",sans-serif;box-shadow:0 8px 30px #0003';
    const instruction = document.createElement('div'), preview = document.createElement('div'), cancel = document.createElement('button');
    instruction.textContent = kind === 'balance' ? `请点选账户的 ${ctx.symbol} 余额数字。Esc 取消。` : '请点选账户“今日盈亏”所在一行。Esc 取消。';
    preview.textContent = '只读取你点选的显示值，不会触发网页按钮。';
    cancel.textContent = '取消'; cancel.style.cssText = 'margin-top:8px;padding:4px 12px;cursor:pointer';
    banner.append(instruction, preview, cancel);
    const outline = document.createElement('div'); outline.style.cssText = 'position:fixed;border:2px solid #6c9ce2;background:#6c9ce21a;border-radius:4px;pointer-events:none;display:none';
    shadow.append(outline, banner); document.documentElement.append(host);
    let candidate = null;
    const find = target => {
      let fallback = null;
      for (let el = target, n = 0; el && el !== document.body && n < 4; el = el.parentElement, n++) {
        if (!visible(el)) break;
        const text = textOf(el); if (text.length > 120) break;
        const explicit = parse(text, kind, ctx.symbol, false);
        if (explicit) return { el, value: explicit };
        const raw = parse(text, kind, ctx.symbol, true);
        if (!fallback && raw) fallback = { el, value: raw };
      }
      return fallback;
    };
    const move = event => {
      if (event.composedPath().includes(host)) return;
      candidate = find(event.target);
      if (!candidate) { outline.style.display = 'none'; preview.textContent = '这里没有识别到单个金额，请移到数字或金额所在的一行。'; return; }
      const r = candidate.el.getBoundingClientRect();
      Object.assign(outline.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      preview.textContent = `${candidate.value.label}：${candidate.value.text} · 点击选定`;
    };
    const block = event => { if (!event.composedPath().includes(host)) { event.preventDefault(); event.stopImmediatePropagation(); } };
    const finish = () => {
      document.removeEventListener('pointermove', move, true); document.removeEventListener('click', choose, true);
      for (const name of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick']) document.removeEventListener(name, block, true);
      document.removeEventListener('keydown', key, true); host.remove(); stopPicker = null;
    };
    const choose = async event => {
      if (event.composedPath().includes(host)) return;
      block(event);
      if (context(location.href)?.chain !== ctx.chain) { finish(); onComplete?.('已切换链，请重新选择'); return; }
      candidate = find(event.target); if (!candidate) return;
      const binding = { selector: selector(candidate.el), signature: signature(candidate.el), label: candidate.value.label };
      finish();
      try {
        const saved = await bindings(); saved[ctx.chain] = { ...saved[ctx.chain], [kind]: binding };
        await chrome.storage.local.set({ gmgnPageBindings: saved });
        onComplete?.(`${binding.label}已选定，点一下大肥鱼查看。`);
      } catch { onComplete?.('保存未完成，请刷新网页再试'); }
    };
    const key = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); finish(); } };
    cancel.addEventListener('click', finish); document.addEventListener('pointermove', move, true);
    document.addEventListener('click', choose, true); document.addEventListener('keydown', key, true);
    for (const name of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick']) document.addEventListener(name, block, true);
    stopPicker = finish;
  }
  async function reset() {
    const ctx = context(location.href); if (!ctx?.chain) return;
    const saved = await bindings(); delete saved[ctx.chain]; await chrome.storage.local.set({ gmgnPageBindings: saved });
  }
  root.TrenchGmgnPage = { context, amount, parse, read, pick, reset, stop: () => stopPicker?.() };
  if (typeof module !== 'undefined') module.exports = root.TrenchGmgnPage;
})(globalThis);
