(async function () {
  'use strict';
  const $ = id => document.getElementById(id), api = TrenchPet.request;
  let connection = {}, busy = false;
  function feedback(text, failed = false) {
    $('binance-feedback').textContent = text; $('binance-feedback').classList.toggle('error', failed);
    $('binance-inline-feedback').textContent = text; $('binance-inline-feedback').classList.toggle('error', failed);
  }
  function draw() {
    $('binance-badge').textContent = busy ? '查询中…' : connection.configured ? 'API 已保存' : '未配置';
    for (const input of $('binance-form').querySelectorAll('input,button')) input.disabled = busy || !!connection.preview;
    $('binance-test').disabled ||= !connection.configured; $('binance-clear').disabled ||= !connection.configured;
    $('binance-key').placeholder = connection.configured ? '已保存，留空保持不变' : '系统生成的 API Key';
    $('binance-secret').placeholder = connection.configured ? '已保存，不回显' : '配套的 Secret Key';
  }
  function clearInputs() { $('binance-key').value = ''; $('binance-secret').value = ''; }
  async function load() { connection = (await api({ type: 'binance:status' })).connection; }
  async function query() {
    feedback('正在查询币安，可能需要几秒钟…');
    const { finance } = await api({ type: 'binance:finance' });
    if (finance.scope) $('binance-scope').textContent = finance.scope;
    feedback('');
    const node = $('binance-feedback');
    for (const row of finance.rows || []) {
      const line = document.createElement('span'); line.className = 'binance-feedback-row';
      const amount = document.createElement('strong');
      amount.textContent = `${TrenchFinance.format(row.amount, 2) ?? '未取得'}${row.amount == null ? '' : ' ' + row.unit}`;
      amount.className = row.amount == null ? 'missing' : row.pnl ? Number(row.amount) < 0 ? 'negative' : Number(row.amount) > 0 ? 'positive' : '' : '';
      line.append(document.createTextNode(row.label + '：'), amount); node.append(line);
    }
    const note = document.createElement('span'); note.className = 'binance-feedback-note';
    note.textContent = finance.reason ? ((finance.rows || []).some(row => row.amount != null) ? '部分数据已取得。' : '') + finance.reason : '查询成功。';
    note.classList.toggle('error', !!finance.reason); node.append(note);
    $('binance-inline-feedback').textContent = note.textContent + (finance.reason ? '' : '最新金额已显示在下方连接状态。');
    $('binance-inline-feedback').classList.toggle('error', !!finance.reason);
    await load();
  }
  async function run(task) {
    if (busy || connection.preview) return; busy = true; draw();
    try { await task(); } catch (error) { feedback(error.message, true); }
    finally { busy = false; draw(); }
  }
  $('binance-form').addEventListener('submit', event => {
    event.preventDefault(); run(async () => {
      const apiKey = $('binance-key').value.trim(), secret = $('binance-secret').value.trim();
      if (apiKey || secret) { connection = (await api({ type: 'binance:save', apiKey, secret })).connection; clearInputs(); }
      else if (!connection.configured) throw new Error('请填写 API Key 与 Secret Key');
      await query();
    });
  });
  $('binance-test').addEventListener('click', () => run(async () => {
    if ($('binance-key').value.trim() || $('binance-secret').value.trim()) throw new Error('填写了新密钥，请点击“保存并检测币安”'); await query();
  }));
  $('binance-clear').addEventListener('click', () => run(async () => { connection = (await api({ type: 'binance:clear' })).connection; clearInputs(); feedback('已清除币安 API 配置。'); }));
  try { await load(); if (connection.preview) feedback('本地预览不能填写真实 API。请从已安装的插件打开设置。');
    else if (connection.configured) feedback('API 已保存。可重新检测或点击网页中的宠物查询。'); }
  catch (error) { feedback(error.message, true); } draw();
})();
