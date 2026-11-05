import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { PNG } from 'pngjs';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
const artifacts = path.join(root, 'test-results');
fs.mkdirSync(artifacts, { recursive: true });
const profile = fs.mkdtempSync(path.join(artifacts, 'profile-'));
const extension = path.join(root, 'extension');
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>普通网页 · 插件验证</title><link rel="stylesheet" href="/fixture.css"></head><body><header><b>WEB / DAILY</b><span>普通网页兼容测试</span></header><main><small>YOUR EVERYDAY BROWSING</small><h1>网页照常，陪伴刚好。</h1><p>这是本机测试页面，用来检查宠物的透明背景、点击穿透、拖动边界和多标签页设置。</p><button id="underlying">正常网页按钮</button><div class="grid"><article><i>01 / READ</i><h2>继续阅读</h2><p>她会安静待在角落。</p></article><article><i>02 / WORK</i><h2>专心做事</h2><p>需要安静时，把她收进口袋。</p></article><article><i>03 / REST</i><h2>休息一下</h2><p>摸摸头，让小鲸鱼陪你发个呆。</p></article></div><div class="lines"></div></main></body></html>`;
const css = `*{box-sizing:border-box}body{margin:0;background:#f7f9fc;color:#293d5a;font-family:'Segoe UI','Microsoft YaHei',sans-serif}header{height:76px;padding:0 70px;border-bottom:1px solid #e3e9f2;display:flex;align-items:center;justify-content:space-between;font-size:12px;color:#8b9ab0}header b{letter-spacing:3px}main{padding:90px 100px}small{letter-spacing:3px;font-size:10px;color:#8f9eb3}h1{font-size:40px;font-weight:600;margin:15px 0}p{color:#8b98ad;font-size:13px;line-height:1.9}button{border:0;padding:12px 20px;border-radius:10px;background:#587cb7;color:white;margin:18px 0 45px;cursor:pointer}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}article{background:white;padding:25px;border:1px solid #e2e9f2;border-radius:18px}i{font-style:normal;color:#9aacbf;font-size:10px;letter-spacing:2px}h2{font-size:20px;font-weight:500}.lines{height:160px;margin-top:45px;background:repeating-linear-gradient(transparent 0 28px,#e6edf5 29px 30px)}`;
const server = http.createServer((req, res) => {
  if (req.url === '/fixture.css') { res.writeHead(200, { 'content-type': 'text/css' }); res.end(css); return; }
  const headers = { 'content-type': 'text/html; charset=utf-8' };
  if (req.url === '/strict') headers['content-security-policy'] = "default-src 'self'; script-src 'none'; style-src 'self'; img-src 'self'; connect-src 'none';";
  res.writeHead(200, headers); res.end(html);
});
await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
const port = server.address().port;
const errors = [];
const steps = [];
let context;
const launch = () => chromium.launchPersistentContext(profile, { channel: process.env.PW_CHANNEL || 'msedge', headless: true, viewport: { width: 1440, height: 1000 },
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
const log = title => { steps.push(title); console.log(`PASS ${title}`); };
try {
  const png = PNG.sync.read(fs.readFileSync(path.join(extension, 'assets/whale-poses.png')));
  expect(png.data[3]).toBe(0); expect(png.width).toBe(1448); log('Production sprite has real alpha transparency');
  context = await launch();
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const home = await context.newPage();
  await home.goto(`chrome-extension://${id}/home.html`);
  await expect(home.locator('#pet-stage #trench-pet-preview .rig-canvas[data-ready="true"]')).toBeVisible();
  await expect(home.locator('#action-gallery .action-card')).toHaveCount(12);
  await home.screenshot({ path: path.join(artifacts, '01-pet-home.png'), fullPage: true, animations: 'disabled' });
  log('Extension starts; home and all 12 pose entries load');
  await home.getByRole('button', { name: '动作图鉴', exact: false }).click();
  await home.locator('#demo-chain').selectOption('solana');
  await home.locator('.action-card[data-play="alert"]').click();
  await expect(home.locator('#gallery-stage .pet')).toHaveAttribute('data-action', 'alert');
  await expect(home.locator('#gallery-stage .bubble small')).toHaveText('动作体验 · Solana');
  await home.screenshot({ path: path.join(artifacts, '02-action-gallery.png'), fullPage: true, animations: 'disabled' });
  log('Action gallery uses explicit demo labels and Solana scene');
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  const pet = page.locator('#trench-pet-root');
  const hit = pet.locator('.hit');
  await expect(hit).toBeVisible();
  await expect(pet.locator('.rig-canvas')).toHaveAttribute('data-renderer','original-mesh');
  await page.bringToFront(); await hit.click();
  await expect(pet.locator('.pet')).toHaveAttribute('data-action', 'pat');
  await page.screenshot({ path: path.join(artifacts, '03-pet-on-webpage.png'), fullPage: true, animations: 'disabled' });
  await page.locator('#underlying').click();
  log('Pet appears on a real HTTP page; click interaction and underlying page remain usable');
  const box = await hit.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(300, 420, { steps: 12 }); await page.mouse.up();
  await expect.poll(async () => worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings.position.x)).toBeLessThan(.4);
  const savedPosition = await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings.position);
  await page.reload(); await expect(hit).toBeVisible();
  const afterReload = await pet.locator('.pet').boundingBox(); expect(afterReload.x).toBeLessThan(400);
  log('Drag position is stored and restored after navigation');
  const second = await context.newPage(); await second.goto(`http://localhost:${port}/`);
  await expect.poll(async () => Math.abs((await second.locator('#trench-pet-root .pet').boundingBox()).x - afterReload.x)).toBeLessThan(1);
  // Headless Edge keeps pages visible. Exercise the actual content-script listener in
  // its isolated world with a controlled visibility event, then restore native state.
  await worker.evaluate(async targetUrl => {
    const [tab] = (await chrome.tabs.query({})).filter(tab => tab.url === targetUrl);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    } });
  }, page.url());
  await expect(pet.locator('.world')).toHaveClass(/paused/);
  await worker.evaluate(async targetUrl => {
    const [tab] = (await chrome.tabs.query({})).filter(tab => tab.url === targetUrl);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
      delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));
    } });
  }, page.url());
  log('Second tab shares position; simulated visibility event pauses animations');
  await home.bringToFront();
  await home.evaluate(async () => Promise.all([
    chrome.runtime.sendMessage({ type: 'settings:patch', patch: { size: 220 } }),
    chrome.runtime.sendMessage({ type: 'settings:patch', patch: { reducedMotion: true } })
  ]));
  await expect(second.locator('#trench-pet-root .pet')).toHaveCSS('width', '220px');
  await expect(second.locator('#trench-pet-root .motion')).toHaveCSS('animation-name', 'none');
  log('Concurrent settings changes survive; size and reduced motion propagate');
  await home.locator('[data-tab="settings"]').click();
  await home.locator('#site-form input').fill('127.0.0.1'); await home.locator('#site-form button').click();
  await expect(pet).toHaveCSS('visibility', 'hidden');
  await expect(second.locator('#trench-pet-root')).toHaveCSS('visibility', 'visible');
  await home.getByRole('button', { name: '取消屏蔽 127.0.0.1' }).click();
  await expect(pet).toHaveCSS('visibility', 'visible');
  log('Per-site exclusion hides only matching sites and can be removed');
  await home.locator('#tab-settings [data-setting="collapsed"]').check();
  await expect(second.locator('#trench-pet-root .pocket')).toBeVisible();
  await second.bringToFront(); await second.locator('#trench-pet-root .pocket').click();
  await expect(second.locator('#trench-pet-root .hit')).toBeVisible();
  log('Pocket collapse and restore work across tabs');
  await second.setViewportSize({ width: 320, height: 400 });
  await expect.poll(async () => { const box = await second.locator('#trench-pet-root .pet').boundingBox(); return box.x + box.width; }).toBeLessThanOrEqual(320);
  const resized = await second.locator('#trench-pet-root .pet').boundingBox();
  expect(resized.x).toBeGreaterThanOrEqual(0); expect(resized.x + resized.width).toBeLessThanOrEqual(320);
  expect(resized.y + resized.height).toBeLessThanOrEqual(400);
  log('Pet remains reachable in a narrow resized viewport');
  await home.bringToFront(); await home.locator('[data-tab="watch"]').click();
  await home.locator('#wallet-form [name="label"]').fill('测试 BSC 地址');
  await home.locator('#wallet-form [name="address"]').fill('0x' + '12'.repeat(20));
  await home.locator('#wallet-form [type="submit"]').click();
  await expect(home.locator('.wallet-item')).toHaveCount(1);
  await home.locator('#wallet-form [name="chain"]').selectOption('solana');
  await home.locator('#wallet-form [name="label"]').fill('<b>只作为文字显示</b>');
  await home.locator('#wallet-form [name="address"]').fill('11111111111111111111111111111111');
  await home.locator('#wallet-form [type="submit"]').click();
  await expect(home.locator('.wallet-item')).toHaveCount(2);
  await expect(home.locator('.wallet-info strong').nth(1)).toHaveText('<b>只作为文字显示</b>');
  expect(await home.locator('.wallet-info strong b').count()).toBe(0);
  await home.locator('#wallet-form [name="address"]').fill('bad'); await home.locator('#wallet-form [type="submit"]').click();
  await expect(home.locator('#wallet-error')).toContainText('不匹配');
  log('Both chain lists save locally; invalid addresses rejected; names rendered as text');
  const strict = await context.newPage(); await strict.goto(`http://localhost:${port}/strict`);
  await expect(strict.locator('#trench-pet-root .hit')).toBeVisible();
  await expect(strict.locator('#trench-pet-root .rig-canvas')).toHaveAttribute('data-ready', 'true');
  await expect(strict.locator('#trench-pet-root .rig-canvas')).toHaveAttribute('data-renderer', 'original-mesh');
  await strict.screenshot({ path: path.join(artifacts, '04-strict-csp.png') });
  log('Pet styles load on a strict-CSP page');
  const routed = await home.evaluate(async () => chrome.runtime.sendMessage({ type: 'demo:active', action: 'profit', chain: 'solana' }));
  expect(routed.ok).toBe(true);
  await expect(strict.locator('#trench-pet-root .pet')).toHaveAttribute('data-action', 'profit');
  await expect(strict.locator('#trench-pet-root .bubble small')).toHaveText('动作体验 · Solana');
  log('Toolbar demo route reaches only the active webpage and labels the chain');
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.setViewportSize({ width: 350, height: 620 });
  await expect(popup.locator('.popup-logo')).toBeVisible();
  await expect(popup.locator('#popup-status')).toContainText('不支持');
  await expect(popup.locator('#enabled')).toBeChecked();
  await popup.screenshot({ path: path.join(artifacts, '05-popup.png'), animations: 'disabled' });
  log('Popup handles protected pages explicitly');
  const stateBefore = await worker.evaluate(async () => chrome.storage.local.get(['settings', 'wallets']));
  await context.close(); context = await launch();
  const restored = await context.newPage(); await restored.goto(`chrome-extension://${id}/home.html#watch`);
  await expect(restored.locator('.wallet-item')).toHaveCount(2);
  const stateAfter = await restored.evaluate(async () => chrome.storage.local.get(['settings', 'wallets']));
  expect(stateAfter.settings).toEqual(stateBefore.settings); expect(stateAfter.wallets).toEqual(stateBefore.wallets);
  expect(savedPosition.x).toBeLessThan(.4);
  log('Settings and chain lists survive full browser / worker restart');
  // Produce a clean first-run screenshot, not a view containing test addresses.
  await restored.evaluate(async () => {
    await chrome.storage.local.set({ settings: TrenchCore.sanitizeSettings(), wallets: [] });
  });
  await restored.goto(`chrome-extension://${id}/home.html`);
  await expect(restored.locator('#pet-stage .rig-canvas[data-ready="true"]')).toBeVisible();
  await restored.screenshot({ path: path.join(artifacts, '01-pet-home.png'), fullPage: true, animations: 'disabled' });
  const preview = await context.newPage();
  await preview.goto(pathToFileURL(path.join(extension, 'home.html')).href);
  await expect(preview.locator('#version-label')).toContainText('本地预览');
  await expect(preview.locator('#pet-stage .rig-canvas[data-ready="true"]')).toBeVisible();
  await preview.locator('[data-play="pat"]').first().click();
  await expect(preview.locator('#pet-stage .pet')).toHaveAttribute('data-action', 'pat');
  log('Standalone local preview works without loading a second extension or a server');
  expect(errors).toEqual([]);
  const report = { passed: steps.length, steps, pageErrors: errors, testedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(artifacts, 'browser-report.json'), JSON.stringify(report, null, 2));
  console.log(`Browser verification passed: ${steps.length} scenarios.`);
} catch (error) {
  if (context) for (const [index, page] of context.pages().entries()) {
    try { await page.screenshot({ path: path.join(artifacts, `failure-${index}.png`) }); } catch {}
  }
  console.error(error); process.exitCode = 1;
} finally {
  if (context) await context.close();
  await new Promise(resolve => server.close(resolve));
}
