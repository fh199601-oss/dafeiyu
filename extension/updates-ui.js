(function () {
  'use strict';
  const button = document.getElementById('check-updates');
  if (!button) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'update-dialog';
  dialog.setAttribute('aria-labelledby', 'update-heading');
  const heading = document.createElement('h2'); heading.id = 'update-heading'; heading.textContent = '检查更新';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'update-close'; close.textContent = '×'; close.setAttribute('aria-label', '关闭更新提示');
  const current = document.createElement('p'); current.className = 'update-current';
  const status = document.createElement('p'); status.className = 'update-status'; status.setAttribute('role', 'status');
  const hint = document.createElement('p'); hint.className = 'update-hint';
  const actions = document.createElement('div'); actions.className = 'update-actions';
  const download = document.createElement('button'); download.type = 'button'; download.className = 'update-download'; download.textContent = '下载新版'; download.hidden = true;
  const link = document.createElement('a'); link.href = TrenchUpdates.RELEASES; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = '查看发布页 ↗';
  actions.append(download, link); dialog.append(close, heading, current, status, hint, actions); document.body.append(dialog);
  let checking = false, downloading = false;
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  async function send(type) {
    if (!globalThis.chrome?.runtime?.id) throw Error('请在已安装的大肥鱼插件中检查更新');
    const reply = await chrome.runtime.sendMessage({ type });
    if (!reply?.ok) throw Error(reply?.error || '暂时无法检查更新，请到发布页查看');
    return reply;
  }
  button.addEventListener('click', async () => {
    if (!dialog.open) dialog.showModal();
    if (checking || downloading) return;
    checking = true; button.disabled = true; download.hidden = true;
    current.textContent = '当前版本 v' + (globalThis.chrome?.runtime?.getManifest?.().version || '—');
    status.textContent = '正在检查 GitHub 正式版本…'; status.classList.remove('error'); hint.textContent = '只检查版本信息，不发送账户或钱包数据。'; link.href = TrenchUpdates.RELEASES;
    try {
      const { update } = await send('updates:check');
      status.textContent = update.available ? `发现新版本 v${update.version}` : TrenchUpdates.compare(update.currentVersion, update.version) > 0 ? '当前版本比公开版本更新' : '已是最新版本';
      link.href = update.url;
      download.hidden = !update.available || !update.asset;
      download.textContent = update.platform === 'mac' ? '下载 Mac 新版' : '下载新版';
      hint.textContent = update.available ? '下载解压后，覆盖原插件目录，再重新加载扩展。无需卸载，设置会保留。' : '连续检查会复用 5 分钟内的结果。';
      if (update.available && !update.asset) hint.textContent = '安装包尚未就绪，请到发布页查看。';
    } catch (error) { status.textContent = error.message; status.classList.add('error'); hint.textContent = '检查失败不影响现有功能，稍后可再试。'; }
    finally { checking = false; button.disabled = false; }
  });
  download.addEventListener('click', async () => {
    if (downloading) return;
    downloading = true; download.disabled = true;
    try { await send('updates:download'); status.classList.remove('error'); status.textContent = '下载已交给浏览器，请查看下载列表'; hint.textContent = '下载完成后覆盖原插件目录，再重新加载扩展。下载不代表已安装更新。'; }
    catch (error) { status.textContent = error.message; status.classList.add('error'); }
    finally { downloading = false; download.disabled = false; }
  });
})();
