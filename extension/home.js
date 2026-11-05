(async function () {
  'use strict';
  const C = TrenchCore;
  const api = TrenchPet.request;
  let state, roomPet, galleryPet, toastTimer, currentAccount = 'gmgn';
  const descriptions = { idle: '慢慢眨眼，轻轻呼吸', sleep: '尾巴就是自己的小枕头', pat: '再摸一下，也可以', buy: '双手握拳，认真打气', profit: '举手跳起来，撒一场彩带雨', close: '鞠一躬，这一站收工', comfort: '递张纸巾，陪你缓缓', pout: '有一点点小脾气', alert: '有动静！小跑来报告', news: '眼睛跟着报纸一行行看', drag: '拎起来会挣扎，短腿随惯性摆动', peek: '偷偷看看你在忙什么' };
  const thumbnailResize = new ResizeObserver(entries => {
    for (const { target } of entries) {
      const size = Number(target.dataset.spriteSize), width = Math.min(size, target.getBoundingClientRect().width);
      if (!size || !width) continue;
      target.style.height = `${width}px`;
      const frame = target.querySelector('.sprite-frame'); frame.style.transform = 'none';
      WhaleSprite.paint(frame, Number(frame.dataset.poseIndex), width);
    }
  });
  function toast(text, error = false) {
    const node = document.getElementById('toast');
    node.textContent = text; node.classList.toggle('error', error); node.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { node.hidden = true; }, 3200);
  }
  async function patch(patch) {
    const result = await api({ type: 'settings:patch', patch });
    state.settings = result.settings; renderSettings(); return result;
  }
  function renderSettings() {
    document.querySelectorAll('[data-setting]').forEach(input => {
      const value = state.settings[input.dataset.setting];
      if (input.type === 'checkbox') input.checked = value;
      else input.value = value;
    });
    document.getElementById('size-value').textContent = `${state.settings.size} px`;
    document.getElementById('site-click-rules').hidden = state.settings.clickMode !== 'auto';
    document.getElementById('x-research-click-setting').hidden=state.settings.clickMode!=='auto'||state.settings.clickX!=='grok';
    const modes = { gmgn: '固定显示 GMGN 数据', binance: '固定显示币安数据', auto: '按网站自动切换', companion: '普通陪伴' };
    document.getElementById('binance-click-status').textContent = '当前单击：' + modes[state.settings.clickMode];
    document.querySelectorAll('[data-click-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.clickMode === state.settings.clickMode)));
    document.querySelectorAll('[data-click-site]').forEach(button => { const site = button.dataset.clickSite; button.setAttribute('aria-pressed', String(state.settings.clickMode === 'auto' && state.settings[site === 'gmgn' ? 'clickGmgn' : 'clickBinance'] === site)); });
    const preview = { ...state.settings, enabled: true, collapsed: false };
    roomPet?.update(preview); galleryPet?.update(preview);
    renderSites();
  }
  function makeSprite(parent, action, size) {
    const node = document.createElement('div'); node.className = 'sprite-frame';
    WhaleSprite.paint(node, C.ACTIONS[action].index, size); parent.append(node);
    parent.dataset.spriteSize = size; thumbnailResize.observe(parent);
  }
  function renderWallets() {
    const list = document.getElementById('wallet-list'); list.replaceChildren();
    document.getElementById('wallet-count').textContent = state.wallets.length;
    if (!state.wallets.length) {
      const empty = document.createElement('div'); empty.className = 'empty-list';
      empty.textContent = '名单还空着。先记下一个想关注的公开地址吧。'; list.append(empty); return;
    }
    for (const wallet of state.wallets) {
      const row = document.createElement('div'); row.className = 'wallet-item';
      const badge = document.createElement('span'); badge.className = `chain-icon ${wallet.chain === 'bsc' ? 'bsc' : 'sol'}`; badge.textContent = wallet.chain === 'bsc' ? 'B' : 'S';
      const info = document.createElement('div'); info.className = 'wallet-info';
      const label = document.createElement('strong'); label.textContent = wallet.label;
      const kind = document.createElement('small'); kind.textContent = wallet.kind === 'self' ? '我的钱包' : '关注地址';
      const address = document.createElement('code'); address.textContent = wallet.address;
      info.append(label, kind, address);
      const remove = document.createElement('button'); remove.textContent = '移除'; remove.setAttribute('aria-label', `移除 ${wallet.label}`);
      remove.addEventListener('click', async () => {
        try { const result = await api({ type: 'wallet:remove', id: wallet.id }); state.wallets = result.wallets; renderWallets(); toast('已移除地址'); }
        catch (error) { toast(error.message, true); }
      });
      row.append(badge, info, remove); list.append(row);
    }
  }
  function renderSites() {
    const list = document.getElementById('site-list'); list.replaceChildren();
    for (const domain of state.settings.excludedSites) {
      const chip = document.createElement('span'); chip.className = 'site-chip';
      const text = document.createElement('span'); text.textContent = domain;
      const remove = document.createElement('button'); remove.textContent = '×'; remove.setAttribute('aria-label', `取消屏蔽 ${domain}`);
      remove.addEventListener('click', () => patch({ excludedSites: state.settings.excludedSites.filter(site => site !== domain) }).catch(error => toast(error.message, true)));
      chip.append(text, remove); list.append(chip);
    }
    if (!state.settings.excludedSites.length) {
      const note = document.createElement('span'); note.className = 'microcopy'; note.textContent = '还没有不打扰的网站。'; list.append(note);
    }
  }
  function account(name, updateHash = true) {
    currentAccount = name === 'binance' ? 'binance' : 'gmgn';
    document.querySelectorAll('[data-account-panel]').forEach(panel => { panel.hidden = panel.dataset.accountPanel !== currentAccount; });
    document.querySelectorAll('[data-account]').forEach(button => {
      const selected = button.dataset.account === currentAccount;
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    });
    if (updateHash) history.replaceState(null, '', `#${currentAccount}-settings`);
  }
  function activate(tab, updateHash = true) {
    const destinations = { 'click-settings': 'settings', 'grok-settings': 'ai', 'gmgn-settings': 'finance', 'binance-settings': 'finance' };
    const section = destinations[tab] ? document.getElementById(tab) : null;
    if (section) { if (destinations[tab] === 'finance') account(tab.startsWith('binance') ? 'binance' : 'gmgn', false); tab = destinations[tab]; }
    if (!['room', 'actions', 'watch', 'settings', 'install', 'finance', 'ai'].includes(tab)) tab = 'room';
    document.querySelectorAll('.tab-panel').forEach(panel => { panel.hidden = panel.id !== `tab-${tab}`; });
    document.querySelectorAll('[data-tab]').forEach(button => { button.classList.toggle('active', button.dataset.tab === tab); button.setAttribute('aria-current', button.dataset.tab === tab ? 'page' : 'false'); });
    document.getElementById('breadcrumb').textContent = ({ room: '宠物小屋', actions: '动作图鉴', watch: '关注名单 · 本地地址备忘', settings: '陪伴设置', install: '安装与使用', finance: '账户数据', ai: 'AI 连接与任务' })[tab];
    if (updateHash) history.replaceState(null, '', `#${section ? section.id : tab}`);
    if (tab === 'actions' && !galleryPet) {
      galleryPet = TrenchPet.mount({ container: document.getElementById('gallery-stage'), preview: true,
        settings: { ...state.settings, enabled: true, collapsed: false }, patch });
    }
    if (tab !== 'actions' && galleryPet) { galleryPet.destroy(); galleryPet = null; }
    if (tab !== 'room') roomPet?.play('idle', { silent: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (section) {
      const focusId = { 'grok-settings': 'grok-detect', 'click-settings': 'click-mode', 'gmgn-settings': 'gmgn-key', 'binance-settings': 'binance-key' }[section.id];
      const focusSection = () => {
        if (!section.closest('.tab-panel').hidden && location.hash === `#${section.id}`) document.getElementById(focusId)?.focus({ preventScroll: true });
      };
      focusSection();
      // A new extension tab can apply its URL anchor after scripts finish loading.
      // Restore the useful form focus once that native navigation has completed.
      if (document.readyState !== 'complete') window.addEventListener('load', () => requestAnimationFrame(focusSection), { once: true });
    }
  }
  try { state = await api({ type: 'state:get' }); }
  catch (error) { toast(`请通过已加载的扩展打开小屋：${error.message}`, true); return; }
  roomPet = TrenchPet.mount({ container: document.getElementById('pet-stage'), preview: true,
    settings: { ...state.settings, enabled: true, collapsed: false }, patch,
    onAction(action) { document.getElementById('pose-badge').textContent = C.ACTIONS[action].name; }
  });
  for (const [key, action] of Object.entries(C.ACTIONS)) {
    const card = document.createElement('button'); card.className = 'action-card'; card.dataset.play = key;
    const number = document.createElement('span'); number.className = 'action-number'; number.textContent = String(action.index + 1).padStart(2, '0');
    const art = document.createElement('div'); art.className = 'action-sprite-wrap'; makeSprite(art, key, 160);
    const title = document.createElement('strong'); title.textContent = action.name;
    const caption = document.createElement('small'); caption.textContent = descriptions[key];
    card.append(number, art, title, caption); document.getElementById('action-gallery').append(card);
  }
  document.querySelectorAll('[data-play]').forEach(button => button.addEventListener('click', () => {
    const action = button.dataset.play;
    const target = document.getElementById('tab-actions').hidden ? roomPet : galleryPet;
    target?.unlockAudio();
    target?.play(action, { demo: true, temporary: action === 'drag', chain: document.getElementById('demo-chain').value });
    document.querySelectorAll('.action-card').forEach(card => card.classList.toggle('active', card.dataset.play === action));
  }));
  document.getElementById('stop-action').addEventListener('click', () => { galleryPet?.play('idle', { silent: true }); document.querySelectorAll('.action-card').forEach(card => card.classList.remove('active')); });
  document.querySelectorAll('[data-tab],[data-goto]').forEach(button => button.addEventListener('click', () => activate(button.dataset.tab || button.dataset.goto)));
  document.querySelectorAll('[data-account]').forEach(button => {
    button.addEventListener('click', () => account(button.dataset.account));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      account(event.key === 'Home' ? 'gmgn' : event.key === 'End' ? 'binance' : currentAccount === 'gmgn' ? 'binance' : 'gmgn');
      document.querySelector(`[data-account="${currentAccount}"]`).focus();
    });
  });
  document.querySelectorAll('[data-click-mode]').forEach(button => button.addEventListener('click', async () => {
    try {
      await patch({ clickMode: button.dataset.clickMode });
      toast(({ binance: '已设置：单击大肥鱼显示币安数据', gmgn: '已设置：单击大肥鱼显示 GMGN 数据', auto: '已设置：按当前网站自动切换' })[button.dataset.clickMode]);
    }
    catch (error) { toast(error.message, true); }
  }));
  document.querySelectorAll('[data-click-site]').forEach(button => button.addEventListener('click', async () => {
    const site = button.dataset.clickSite;
    try {
      await patch({ clickMode: 'auto', [site === 'gmgn' ? 'clickGmgn' : 'clickBinance']: site });
      toast(`已设置：在 ${site === 'gmgn' ? 'GMGN' : '币安'} 网站查看对应账户，其他网站沿用各自设置`);
    } catch (error) { toast(error.message, true); }
  }));
  window.addEventListener('hashchange', () => {
    if (location.hash !== '#main-content') activate(location.hash.slice(1), false);
  });
  document.querySelector('.skip-link').addEventListener('click', event => {
    event.preventDefault(); document.getElementById('main-content').focus();
  });
  function placeHelp(tip) {
    const box = tip.querySelector('[role=tooltip]');
    box.style.left = ''; tip.removeAttribute('data-above');
    if (!box.getClientRects().length) return;
    const trigger = tip.getBoundingClientRect();
    if (trigger.bottom + 8 + box.offsetHeight > innerHeight - 8 && trigger.top > box.offsetHeight + 8) tip.dataset.above = 'true';
    const bounds = box.getBoundingClientRect();
    const correction = bounds.left < 8 ? 8 - bounds.left : bounds.right > innerWidth - 8 ? innerWidth - 8 - bounds.right : 0;
    if (correction) box.style.left = `${parseFloat(getComputedStyle(box).left) + correction}px`;
  }
  document.querySelectorAll('.help-tip').forEach(tip => {
    const reveal = () => { tip.removeAttribute('data-dismissed'); placeHelp(tip); };
    tip.addEventListener('mouseenter', reveal); tip.addEventListener('focusin', reveal);
    tip.addEventListener('mouseleave', () => tip.removeAttribute('data-dismissed'));
    tip.addEventListener('focusout', () => tip.removeAttribute('data-dismissed'));
    tip.addEventListener('keydown', event => { if (event.key === 'Escape') { tip.dataset.dismissed = 'true'; event.stopPropagation(); } });
  });
  const repositionHelp = () => document.querySelectorAll('.help-tip').forEach(placeHelp);
  window.addEventListener('resize', repositionHelp); window.addEventListener('scroll', repositionHelp, { passive: true });
  document.querySelectorAll('[data-setting]').forEach(input => {
    input.addEventListener('change', async () => {
      const key = input.dataset.setting;
      const value = input.type === 'checkbox' ? input.checked : ['size','xResearchClicks'].includes(key) ? Number(input.value) : input.value;
      try { await patch({ [key]: value }); toast('已保存'); } catch (error) { renderSettings(); toast(error.message, true); }
    });
    if (input.type === 'range') input.addEventListener('input', () => { document.getElementById('size-value').textContent = `${input.value} px`; });
  });
  document.querySelectorAll('[data-position]').forEach(button => button.addEventListener('click', () => {
    patch({ position: { x: button.dataset.position === 'left' ? 0 : 1, y: 1 }, collapsed: false }).then(() => toast('位置已更新'), error => toast(error.message, true));
  }));
  document.getElementById('wallet-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form));
    const errorNode = document.getElementById('wallet-error'); errorNode.textContent = '';
    if (!C.validateAddress(values.chain, values.address)) { errorNode.textContent = '地址格式与所选网络不匹配，请粘贴完整公开地址。'; return; }
    const button = form.querySelector('[type="submit"]'); button.disabled = true;
    try {
      const result = await api({ type: 'wallet:add', wallet: values }); state.wallets = result.wallets;
      form.elements.address.value = ''; form.elements.label.value = ''; renderWallets(); toast('地址已保存；真实监控尚未连接');
    } catch (error) { errorNode.textContent = error.message; }
    finally { button.disabled = false; }
  });
  document.getElementById('site-form').addEventListener('submit', async event => {
    event.preventDefault(); const input = event.currentTarget.elements.site; const site = C.normalizeSite(input.value);
    if (!site) { toast('请输入有效域名，例如 example.com', true); return; }
    try { await patch({ excludedSites: [...state.settings.excludedSites, site] }); input.value = ''; toast('已加入不打扰名单'); }
    catch (error) { toast(error.message, true); }
  });
  const storageChanged = (changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) { state.settings = C.sanitizeSettings(changes.settings.newValue); renderSettings(); }
    if (changes.wallets) { state.wallets = C.sanitizeWallets(changes.wallets.newValue); renderWallets(); }
  };
  if (globalThis.chrome?.runtime?.id) chrome.storage.onChanged.addListener(storageChanged);
  else {
    TrenchPreviewBridge.listen(storageChanged);
    document.getElementById('version-label').textContent = '本地预览 · 加载插件后可在其他网页陪伴';
  }
  renderSettings(); renderWallets(); activate(location.hash.slice(1) || 'room');
})();
