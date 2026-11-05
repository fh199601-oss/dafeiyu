import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const output = path.resolve('test-results/finance'); fs.mkdirSync(output, { recursive: true });
const extension = path.resolve('extension'), profile = fs.mkdtempSync(path.join(output, 'profile-'));
const passes = [], errors = []; let context;
const pass = text => { passes.push(text); console.log('PASS ' + text); };
const fixture = `<!doctype html><meta charset="utf-8"><title>GMGN account DOM fixture</title>
<style>body{margin:0;background:#f2f5fa;font:15px sans-serif}header{height:90px;display:flex;justify-content:flex-end;align-items:center;gap:25px;padding-right:35px;background:white}main{padding:40px}.row{display:flex;gap:10px;align-items:center}.small{color:#64748b}</style>
<header><div class="row" id="balance"><span id="balance-label">BNB余额：</span><span id="balance-number">3.5</span></div><div class="row" id="pnl"><span id="pnl-label">今日盈亏：</span><span id="pnl-number">+$562</span></div></header>
<main><h1>气泡测试页 · 示例数据</h1><p class="small">此页面用于验证显示与交互，不是真实账户。</p><div>BNB余额：99 今日盈亏：+$9999</div><button id="trade">交易测试按钮</button></main>`;
try {
  context = await chromium.launchPersistentContext(profile, { channel: 'msedge', headless: true, viewport: { width: 1440, height: 950 },
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('https://gmgn.ai/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await context.route('https://companion.test/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Ordinary webpage</h1>' }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
  const page = await context.newPage(); await page.goto('https://gmgn.ai/?chain=bsc');
  const hit = page.locator('#trench-pet-root .hit'), bubble = page.locator('#trench-pet-root .bubble');
  await expect(hit).toBeVisible(); await hit.click();
  await expect(bubble.locator('.finance-row')).toHaveCount(2);
  await expect(bubble).toContainText('BNB余额：3.5'); await expect(bubble).toContainText('今日盈亏：+$562');
  await expect(bubble.locator('.finance-positive')).toHaveCSS('color', 'rgb(19, 131, 72)');
  await expect(bubble.locator('.finance-neutral')).toHaveCSS('color', 'rgb(22, 22, 22)');
  await page.waitForTimeout(220); await page.screenshot({ path: path.join(output, 'bubble-example-bsc.png') });
  pass('Two rows match the selected page values, positive PnL green and native balance black; token rows ignored');
  await page.evaluate(() => { document.querySelector('#balance-number').textContent = '8.25'; document.querySelector('#pnl-number').textContent = '-$42'; });
  await expect(bubble).toContainText('BNB余额：8.25'); await expect(bubble).toContainText('今日盈亏：-$42');
  await expect(bubble.locator('.finance-negative')).toHaveCSS('color', 'rgb(210, 53, 53)');
  pass('Visible bubble updates after account numbers change; negative PnL is red');
  await page.evaluate(() => { history.replaceState({}, '', '/?chain=sol'); });
  await expect(bubble).toContainText('SOL余额：未读到'); await expect(bubble).toContainText('今日盈亏：未读到');
  await page.evaluate(() => { document.querySelector('#balance-label').textContent = 'SOL余额：'; document.querySelector('#balance-number').textContent = '52.4'; document.querySelector('#pnl-label').textContent = '24h PnL: '; document.querySelector('#pnl-number').textContent = '+0.2 SOL'; });
  await hit.click(); await expect(bubble).toContainText('SOL余额：52.4'); await expect(bubble).toContainText('24h盈亏：+0.2 SOL');
  pass('SPA chain switch cannot carry BNB into Solana; 24h and native-unit PnL retain their meaning');
  await page.evaluate(() => { history.replaceState({}, '', '/?chain=base'); document.querySelector('#balance-label').textContent = 'ETH余额：'; document.querySelector('#balance-number').textContent = '1.25'; document.querySelector('#pnl-label').textContent = '今日盈亏：'; document.querySelector('#pnl-number').textContent = '$0'; });
  await hit.click(); await expect(bubble).toContainText('ETH余额：1.25'); await expect(bubble).toContainText('今日盈亏：$0');
  await expect(bubble.locator('.finance-neutral')).toHaveCount(2);
  pass('Base works beyond the first two chains; a real zero is distinct from unavailable');
  await page.evaluate(() => { document.querySelector('#balance-number').textContent = '****'; });
  await hit.click(); await expect(bubble).toContainText('ETH余额：未读到');
  await page.evaluate(() => { document.querySelector('#balance-number').textContent = '1.25'; document.querySelector('#pnl').style.display = 'none'; });
  await hit.click(); await expect(bubble).toContainText('今日盈亏：未读到');
  pass('Hidden or masked page values are not treated as zero and stale PnL is discarded');
  // Calibration fixture deliberately lacks readable labels. Choosing it must not activate the page's button.
  await page.evaluate(() => {
    document.querySelector('#balance').innerHTML = '<button id="chosen-balance">2.25</button>';
    document.querySelector('#pnl').style.display = ''; document.querySelector('#pnl').innerHTML = '<span id="chosen-pnl">-$6</span>';
    window.clickedBalance = 0; document.querySelector('#chosen-balance').addEventListener('click', () => window.clickedBalance++);
  });
  await hit.click(); await expect(bubble).toContainText('ETH余额：未读到');
  await hit.click({ button: 'right' }); await page.locator('#trench-pet-root').getByRole('button', { name: '选择余额位置' }).click();
  await page.locator('#chosen-balance').click(); await expect(bubble).toContainText('已选定');
  expect(await page.evaluate(() => window.clickedBalance)).toBe(0);
  await hit.click({ button: 'right' }); await page.locator('#trench-pet-root').getByRole('button', { name: '选择盈亏位置' }).click();
  await page.locator('#chosen-pnl').click(); await expect(bubble).toContainText('已选定');
  await hit.click(); await expect(bubble).toContainText('ETH余额：2.25'); await expect(bubble).toContainText('页面盈亏：-$6');
  const saved = await worker.evaluate(() => chrome.storage.local.get('gmgnPageBindings'));
  expect(JSON.stringify(saved)).not.toContain('2.25'); expect(JSON.stringify(saved)).not.toContain('-$6');
  pass('Point selection calibrates unlabeled numbers without triggering site buttons or saving financial values');
  await page.evaluate(() => { document.querySelector('#chosen-balance').textContent = '4.5'; document.querySelector('#chosen-pnl').textContent = '+$20'; });
  await expect(bubble).toContainText('ETH余额：4.5'); await expect(bubble).toContainText('页面盈亏：+$20');
  await page.evaluate(() => { document.querySelector('#chosen-balance').id = 'changed-layout'; });
  await expect(bubble).toContainText('ETH余额：未读到');
  pass('Calibrated values update with the page; missing source fails closed instead of reusing old numbers');
  await page.evaluate(() => { document.querySelector('#changed-layout').id = 'chosen-balance'; });
  const ordinary = await context.newPage(); await ordinary.goto('https://companion.test/'); await ordinary.bringToFront();
  await ordinary.locator('#trench-pet-root .hit').click();
  const remote = ordinary.locator('#trench-pet-root .bubble');
  await expect(remote).toContainText('ETH余额：4.5'); await expect(remote).toContainText('页面盈亏：+$20');
  await expect(remote.locator('small')).toContainText('页面显示值');
  await page.close(); await ordinary.locator('#trench-pet-root .hit').click();
  await expect(remote).toContainText('请先打开 GMGN');
  pass('Other sites read the open GMGN tab, mark background page values, and drop data when the source closes');
  // Actual API response fixture from this task, with no real credentials.
  await worker.evaluate(() => { globalThis.fetch = async () => new Response(JSON.stringify({ code: 0, data: { wallets: [] } })); });
  const home = await context.newPage(); await home.goto(`chrome-extension://${id}/home.html#settings`);
  await home.locator('#gmgn-auto-report').uncheck(); await home.locator('#gmgn-key').fill('empty-wallet-fixture-only');
  await home.getByRole('button', { name: '保存并检测', exact: true }).click();
  await expect(home.locator('#gmgn-badge')).toHaveText('已认证 · 无钱包数据'); await expect(home.locator('#gmgn-feedback')).toContainText('无需开启交易权限');
  pass('Empty API wallet list has an accurate status and never asks for trading permission');
  expect(errors).toEqual([]);
  fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify({ passed: passes.length, passes, errors, data: 'synthetic DOM fixtures; not a live account-layout verification' }, null, 2));
} finally { await context?.close(); }
