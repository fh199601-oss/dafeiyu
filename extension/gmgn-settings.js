(async function () {
  'use strict';
  const $ = id => document.getElementById(id), api = TrenchPet.request, F = TrenchFinance;
  let connection = {}, report = null, busy = false, drafts = {}, editing = 'bsc', savedDraft = '', refreshingWallets = false;
  const draftStamp = () => JSON.stringify([$('gmgn-default-chain').value, Object.entries({ ...drafts, [editing]: $('gmgn-addresses').value }).filter(([, text]) => text.trim()).sort(([a], [b]) => a.localeCompare(b))]);
  for (const id of ['gmgn-wallet-chain', 'gmgn-default-chain']) for (const [chain, [name]] of Object.entries(F.CHAINS)) {
    const option = document.createElement('option'); option.value = chain; option.textContent = name; $(id).append(option);
  }
  function feedback(text, failed = false) {
    $('gmgn-feedback').textContent = text; $('gmgn-feedback').classList.toggle('error', failed);
    $('gmgn-inline-feedback').textContent = text; $('gmgn-inline-feedback').classList.toggle('error', failed);
  }
  function clearInput() { $('gmgn-key').value = ''; $('gmgn-key').type = 'password'; $('gmgn-reveal').textContent = '显示'; $('gmgn-reveal').setAttribute('aria-pressed', 'false'); }
  function fillDrafts() {
    const saved = connection.manualWallets, suggested = connection.suggestedWallets;
    drafts = Object.fromEntries(Object.entries((saved || suggested)?.chains || {}).filter(([chain]) => F.CHAINS[chain]).map(([chain, value]) => [chain, value.addresses.join('\n')]));
    editing = saved?.defaultChain || (drafts.bsc ? 'bsc' : Object.keys(drafts)[0]) || 'bsc';
    $('gmgn-wallet-chain').value = editing; $('gmgn-default-chain').value = editing; $('gmgn-addresses').value = drafts[editing] || '';
    $('gmgn-address-hint').textContent = !saved && suggested ? '已从旧版保存的名单预填，请核对后保存。保存前不会作为手动统计名单。' : '每条链最多 20 个地址，重复地址自动合并。切换网络分别填写，统一保存。';
    savedDraft = draftStamp();
  }
  function draw() {
    const ready = connection.configured && !!connection.manualWallets;
    $('gmgn-badge').textContent = busy ? '查询中…' : ready ? '已配置' : connection.configured ? '待识别钱包' : '未配置';
    $('gmgn-result-title').textContent = connection.preview ? '请先加载浏览器插件' : busy ? '正在处理' : ready ? '钱包查询' : connection.configured ? 'API 已保存 · 待识别钱包' : '等待配置';
    $('gmgn-key').placeholder = connection.configured ? 'API Key 已保存；留空保持不变' : '粘贴你的 GMGN API Key';
    $('gmgn-key-hint').textContent = 'API Key 只保存在插件专属存储中，查询时只发送给 GMGN；已保存的 Key 不回显。';
    for (const node of $('gmgn-form').querySelectorAll('button,input,select,textarea')) node.disabled = busy || !!connection.preview;
    $('gmgn-test').disabled ||= !ready; $('gmgn-clear').disabled ||= !connection.configured; $('gmgn-export').disabled ||= !report;
    $('gmgn-finance-test').disabled = busy || !!connection.preview || !ready;
    const check = connection.walletCheck;
    const checked = check?.checkedAt ? `上次检查：${new Date(check.checkedAt).toLocaleString('zh-CN', { hour12: false })}。` : '';
    $('gmgn-wallet-sync-status').textContent = checked + (check?.status === 'unavailable' ? '本次未识别到完整钱包名单，保留已保存名单。' : connection.manualWallets?.source === 'gmgn' ? '钱包名单已与 GMGN 同步。' : connection.manualWallets ? '使用此处保存的钱包名单。' : '保存 API 后，在已登录的 GMGN 页面单击大肥鱼，尝试识别钱包名单。') + ' 距上次检查满 1 小时后，再次单击大肥鱼时检查更新。';
    const node = $('gmgn-wallet-chains'); node.replaceChildren();
    for (const [chain, group] of Object.entries(connection.manualWallets?.chains || {})) {
      const tag = document.createElement('span'); tag.className = 'soft-tag'; tag.textContent = `${F.CHAINS[chain][0]} · ${group.addresses.length} 个`; node.append(tag);
    }
    $('gmgn-scope').textContent = connection.manualWallets ? `其他网页默认：${F.CHAINS[connection.manualWallets.defaultChain][0]}` : '';
    $('gmgn-tested-at').textContent = report ? `上次检测：${new Date(report.testedAt).toLocaleString('zh-CN')}` : '';
  }
  async function load() { connection = (await api({ type: 'gmgn:status' })).connection; report = connection.last ? (await api({ type: 'gmgn:report' })).report : null; }
  function downloadReport() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `大肥鱼-GMGN诊断-${report.testedAt}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function walletDraft() {
    drafts[editing] = $('gmgn-addresses').value;
    // First use may save only the API. Existing wallet lists still require explicit valid edits.
    if (!Object.values(drafts).some(text => text.trim()) && !Object.values(connection.manualWallets?.chains || {}).some(group => group.addresses.length)) return null;
    return F.manualWallets(drafts, $('gmgn-default-chain').value);
  }
  function pendingChanges() {
    const manual = walletDraft();
    return $('gmgn-key').value.trim() || (manual && manual.identity !== connection.manualWallets?.identity);
  }
  async function save() {
    const manual = walletDraft();
    connection = (await api({ type: 'gmgn:save', apiKey: $('gmgn-key').value.trim(), addresses: manual ? drafts : undefined, defaultChain: $('gmgn-default-chain').value })).connection;
    clearInput(); report = null; fillDrafts();
  }
  const waitingForWallets = () => feedback('API 已保存，尚未验证。请打开并登录 GMGN，等待钱包加载后单击大肥鱼；识别到地址后会查询数据并验证 API。');
  async function test() {
    feedback('正在读取钱包结果；冷却期内会显示上次结果…');
    const result = await api({ type: 'gmgn:test' }); report = result.report;
    const data = report.finance;
    const next = data?.nextRefreshAt > Date.now() ? ` ${new Date(data.nextRefreshAt).toLocaleTimeString('zh-CN')} 后再次点击才会刷新。` : '';
    const stale = (data?.staleFields || []).map(field => `${field === 'balance' ? '余额' : '盈亏'}保留 ${new Date(data[field + 'At'] || data.at).toLocaleString('zh-CN')} 的上次结果`).join('；');
    feedback(data ? `${data.name} · ${data.count} 个钱包：${data.symbol}余额 ${F.format(data.balance, 8) ?? '暂未取得'}；1日已实现 ${F.format(data.pnl, 2, true) ?? '暂未取得'}。${data.reason || (result.cached ? '冷却期内，显示上次结果。' : '查询成功。')}${stale ? ' ' + stale + '。' : ''}${next}` : report.message, !!data?.reason || !report.account.ok);
    await load(); if ($('gmgn-auto-report').checked) downloadReport();
  }
  async function run(task) {
    if (busy || connection.preview) return; busy = true; draw();
    try { await task(); } catch (error) { feedback(error.message, true); } finally { busy = false; draw(); }
  }
  $('gmgn-wallet-chain').addEventListener('change', () => { drafts[editing] = $('gmgn-addresses').value; editing = $('gmgn-wallet-chain').value; $('gmgn-addresses').value = drafts[editing] || ''; });
  $('gmgn-form').addEventListener('submit', event => { event.preventDefault(); run(async () => { await save(); if (connection.manualWallets) await test(); else waitingForWallets(); }); });
  $('gmgn-save').addEventListener('click', () => run(async () => { await save(); if (connection.manualWallets) feedback('API 和钱包地址已保存，点一下网页中的大肥鱼即可查询。'); else waitingForWallets(); }));
  for (const id of ['gmgn-test', 'gmgn-finance-test']) $(id).addEventListener('click', () => run(async () => { if (pendingChanges()) throw new Error('有未保存的修改，请点击“保存并检测”'); await test(); }));
  $('gmgn-clear').addEventListener('click', () => run(async () => { connection = (await api({ type: 'gmgn:clear' })).connection; report = null; clearInput(); feedback('已清除 API 和检测报告，钱包地址保留供你重新配置。'); }));
  $('gmgn-export').addEventListener('click', downloadReport);
  $('gmgn-reveal').addEventListener('click', () => { const visible = $('gmgn-key').type === 'password'; $('gmgn-key').type = visible ? 'text' : 'password'; $('gmgn-reveal').textContent = visible ? '隐藏' : '显示'; $('gmgn-reveal').setAttribute('aria-pressed', String(visible)); });
  async function refreshWalletsUI() {
    if (document.hidden || busy || refreshingWallets || $('gmgn-key').value.trim() || draftStamp() !== savedDraft) return;
    refreshingWallets = true;
    try { await load(); if (!busy && !$('gmgn-key').value.trim() && draftStamp() === savedDraft) { fillDrafts(); draw(); } }
    catch {} finally { refreshingWallets = false; }
  }
  window.addEventListener('focus', refreshWalletsUI);
  if (globalThis.chrome?.runtime?.id) chrome.runtime.onMessage.addListener(message => { if (message.type === 'gmgn:wallets-updated') refreshWalletsUI(); });
  try { await load(); fillDrafts(); if (connection.preview) feedback('本地预览不能填写真实 API。请从已安装的插件打开设置。'); }
  catch (error) { feedback(error.message, true); } draw();
})();
