(async function () {
  const C = TrenchCore;
  let settings, host = '';
  const status = document.getElementById('popup-status');
  const tell = (text, error = false) => { status.textContent = text; status.title = text; status.classList.toggle('error', error); };
  async function send(payload) { const result = await chrome.runtime.sendMessage(payload); if (!result?.ok) throw new Error(result?.error || '无法连接插件'); return result; }
  function render() {
    document.getElementById('enabled').checked = settings.enabled;
    document.getElementById('enabled').disabled = false;
    document.getElementById('size').disabled = false;
    document.getElementById('reset-position').disabled = false;
    document.getElementById('companion-state').textContent = settings.enabled ? '陪伴已开启' : '陪伴已暂停';
    document.getElementById('size').value = settings.size;
    document.getElementById('size-output').value = settings.size + ' px';
    document.getElementById('toggle-site').textContent = host && C.isExcluded(host, settings.excludedSites) ? '恢复本站陪伴' : '本站不打扰';
    document.getElementById('toggle-site').disabled = !host;
  }
  async function patch(change) { try { const result = await send({ type: 'settings:patch', patch: change }); settings = result.settings; render(); } catch(error) { if(settings) render(); throw error; } }
  try {
    const state = await send({ type: 'state:get' }); settings = state.settings;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (C.allowedPage(tab?.url)) host = new URL(tab.url).hostname;
    else tell('此页面不支持显示大肥鱼，可到小屋体验。');
    render();
  } catch (error) { tell(error.message, true); }
  document.getElementById('enabled').addEventListener('change', event => patch({ enabled: event.target.checked }).catch(error => tell(error.message, true)));
  document.getElementById('size').addEventListener('input', event => { document.getElementById('size-output').value = event.target.value + ' px'; });
  document.getElementById('size').addEventListener('change', event => patch({ size: Number(event.target.value) }).catch(error => tell(error.message, true)));
  document.getElementById('reset-position').addEventListener('click', () => patch({ position: { x: 1, y: 1 }, collapsed: false, enabled: true }).then(() => tell('已经回到右下角啦。'), error => tell(error.message, true)));
  document.getElementById('toggle-site').addEventListener('click', () => {
    if (!host) return;
    const list = C.isExcluded(host, settings.excludedSites) ? settings.excludedSites.filter(site => !(host === site || host.endsWith(`.${site}`))) : [...settings.excludedSites, host];
    patch({ excludedSites: list }).then(() => tell('本站偏好已保存。'), error => tell(error.message, true));
  });
  document.getElementById('open-home').addEventListener('click', async () => { try { await chrome.runtime.openOptionsPage(); window.close(); } catch(error) { tell(error.message,true); } });
  document.getElementById('open-grok-settings').addEventListener('click', async () => { try { await chrome.tabs.create({ url: chrome.runtime.getURL('home.html#grok-settings') }); window.close(); } catch(error) { tell(error.message,true); } });
  document.getElementById('open-click-settings').addEventListener('click', async () => {
    try { await chrome.tabs.create({ url: chrome.runtime.getURL('home.html#click-settings') }); window.close(); }
    catch (error) { tell(error.message, true); }
  });
})();
