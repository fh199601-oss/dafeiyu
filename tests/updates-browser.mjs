import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve('test-results/updates');
await fs.mkdir(output, { recursive: true });
const run = await fs.mkdtemp(path.join(output, 'run-')), extension = path.join(run, 'extension');
await fs.cp('extension', extension, { recursive: true });
const bridge = path.join(extension, 'grok-connection.js');
await fs.writeFile(bridge, (await fs.readFile(bridge, 'utf8')).replaceAll('com.trenchwhale.grok', 'com.trenchwhale.updates_fixture'));
const context = await chromium.launchPersistentContext(path.join(run, 'profile'), {
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1200, height: 850 }, ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
});
context.setDefaultTimeout(15000);
const errors = [], passes = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  await worker.evaluate(() => {
    globalThis.updateFixture = { version: '0.5.30', status: 200, os: 'mac', calls: 0, downloads: [] };
    chrome.runtime.getPlatformInfo = async () => ({ os: updateFixture.os });
    chrome.downloads.download = async input => { updateFixture.downloads.push(input); return 123; };
    globalThis.fetch = async (url, init) => {
      if (url !== TrenchUpdates.API || init.credentials !== 'omit') throw Error('Unexpected fixture request');
      const f = updateFixture; f.calls++;
      if (f.status === 0) throw Error('offline');
      const base = 'https://github.com/' + TrenchUpdates.REPOSITORY;
      return Response.json({ tag_name: 'v' + f.version, html_url: `${base}/releases/tag/v${f.version}`, draft: false, prerelease: false,
        assets: ['', '-macOS'].map(suffix => { const name = `大肥鱼-v${f.version}${suffix}.zip`; return { name, state: 'uploaded', browser_download_url: `${base}/releases/download/v${f.version}/${encodeURIComponent(name)}` }; }) }, { status: f.status });
    };
  });
  const home = await context.newPage(); await home.goto(`chrome-extension://${id}/home.html`);
  await expect(home.locator('.topbar-actions #check-updates')).toBeVisible();
  await home.screenshot({ path: path.join(output, 'home.png') });
  await home.locator('#check-updates').click();
  await expect(home.locator('.update-status')).toHaveText('发现新版本 v0.5.30');
  await expect(home.locator('.update-download')).toHaveText('下载 Mac 新版');
  await home.locator('.update-download').click();
  await expect(home.locator('.update-status')).toContainText('下载已交给浏览器');
  const mac = await worker.evaluate(() => updateFixture.downloads.at(-1));
  expect(mac.filename).toBe('大肥鱼更新/大肥鱼-v0.5.30-macOS.zip'); expect(mac.saveAs).toBe(true);
  await home.screenshot({ path: path.join(output, 'download-mac.png') });
  await home.keyboard.press('Escape'); await expect(home.locator('.update-dialog')).not.toBeVisible();
  passes.push('Home header check opens Mac-specific release download and closes with Escape');

  await worker.evaluate(() => { updateFixture.os = 'win'; });
  const popup = await context.newPage(); await popup.setViewportSize({ width: 320, height: 360 }); await popup.goto(`chrome-extension://${id}/popup.html`);
  const layout = await popup.evaluate(() => {
    const button = document.querySelector('#check-updates').getBoundingClientRect(), author = document.querySelector('.author-link').getBoundingClientRect();
    return { width: document.body.scrollWidth, height: document.body.scrollHeight, button: { left: button.left, right: button.right, top: button.top }, author: { left: author.left, top: author.top } };
  });
  expect(layout.width).toBe(320); expect(layout.height).toBeLessThanOrEqual(360); expect(layout.button.left).toBeLessThan(20); expect(layout.button.right).toBeLessThan(layout.author.left);
  await popup.screenshot({ path: path.join(output, 'popup.png') });
  await popup.locator('#check-updates').click();
  await expect(popup.locator('.update-status')).toHaveText('发现新版本 v0.5.30');
  await popup.locator('.update-download').click();
  await expect(popup.locator('.update-status')).toContainText('下载已交给浏览器');
  const windows = await worker.evaluate(() => updateFixture.downloads.at(-1)); expect(windows.filename).toBe('大肥鱼更新/大肥鱼-v0.5.30.zip');
  expect(await worker.evaluate(() => updateFixture.calls)).toBe(1);
  const dialogFits = await popup.locator('.update-dialog').evaluate(n => n.scrollHeight <= n.clientHeight); expect(dialogFits).toBe(true);
  await popup.screenshot({ path: path.join(output, 'popup-update.png') });
  passes.push('Popup remains compact; checks share cache; Windows receives universal package');
  await popup.locator('.update-close').click();
  await worker.evaluate(async () => { updateFixture.version = chrome.runtime.getManifest().version; await chrome.storage.local.remove(TrenchUpdates.KEY); });
  await popup.locator('#check-updates').click(); await expect(popup.locator('.update-status')).toHaveText('已是最新版本'); await expect(popup.locator('.update-download')).toBeHidden();
  await popup.locator('.update-close').click();
  await worker.evaluate(async () => { updateFixture.status = 0; await chrome.storage.local.remove(TrenchUpdates.KEY); });
  await popup.locator('#check-updates').click(); await expect(popup.locator('.update-status')).toHaveClass(/error/); await expect(popup.locator('.update-actions a')).toHaveAttribute('href', 'https://github.com/fh199601-oss/dafeiyu/releases/latest'); await expect(popup.locator('.update-download')).toBeHidden();
  passes.push('Current version and offline states are truthful, with a release-page fallback');
  const denied = await worker.evaluate(async () => { try { await handle({ type: 'updates:download', url: 'https://evil.test/update.zip' }, { id: chrome.runtime.id, url: 'https://x.com/home', tab: { id: 123 } }); return false; } catch { return true; } });
  expect(denied).toBe(true); passes.push('Web-page content scripts cannot initiate updater downloads');
  expect(errors).toEqual([]);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passes, errors, mockedPublicMetadata: true, realAccounts: false }, null, 2));
  console.log(passes.join('\n'));
} finally { await context.close(); }
