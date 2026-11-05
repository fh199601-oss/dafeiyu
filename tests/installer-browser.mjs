import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// Real extension/download APIs in a disposable profile. Installer execution and
// Finder/Explorer opening are intercepted; this is not a native-install test.
const output = path.resolve('test-results/installer');
await fs.mkdir(output, { recursive: true });
const run = await fs.mkdtemp(path.join(output, 'run-'));
const extension = path.join(run, 'extension'), foreign = path.join(run, 'foreign-extension');
const profile = path.join(run, 'profile'), downloads = path.join(profile, 'Downloads');
await fs.cp('extension', extension, { recursive: true });
const bridge = path.join(extension, 'grok-connection.js');
const originalBridge = await fs.readFile(bridge, 'utf8');
assert(originalBridge.includes("connectNative('com.trenchwhale.grok')"), 'Native host fixture substitution must match');
await fs.writeFile(bridge, originalBridge.replaceAll('com.trenchwhale.grok', 'com.trenchwhale.grok_nonexistent_installer_test'));
await fs.mkdir(foreign, { recursive: true });
await fs.writeFile(path.join(foreign, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Isolated foreign-download fixture', version: '1.0', permissions: ['downloads'], background: { service_worker: 'foreign-background.js' } }));
await fs.writeFile(path.join(foreign, 'foreign-background.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
await fs.mkdir(path.join(profile, 'Default'), { recursive: true });
await fs.mkdir(downloads, { recursive: true });
await fs.writeFile(path.join(profile, 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false } }));
const passes = [], errors = [], artifacts = [];
const pass = name => { passes.push(name); console.log('PASS ' + name); };
let context, home, worker, id, version, completed = false;

async function openHome(platform) {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ platform }) => {
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => platform === 'mac' ? 'MacIntel' : 'Win32' });
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, get: () => ({ platform: platform === 'mac' ? 'macOS' : 'Windows' }) });
    window.installerSpy = { opened: [], shown: [], launches: 0, rejectOpen: false, rejectShow: false };
    window.addEventListener('trench-installer-launched', () => window.installerSpy.launches++);
    chrome.downloads.open = downloadId => {
      window.installerSpy.opened.push(downloadId);
      return window.installerSpy.rejectOpen ? Promise.reject(Error('Fixture: browser declined opening')) : Promise.resolve();
    };
    // downloads.show returns void, not a Promise.
    chrome.downloads.show = downloadId => {
      window.installerSpy.shown.push(downloadId);
      if (window.installerSpy.rejectShow) throw Error('Fixture: cannot reveal file');
    };
  }, { platform });
  await page.goto(`chrome-extension://${id}/home.html#grok-settings`);
  await expect(page.locator('#grok-install-prepare')).toBeEnabled();
  await expect(page.locator('#grok-badge')).toHaveText('待安装组件');
  return page;
}

async function saved(page) { return page.evaluate(async () => (await chrome.storage.local.get('grokInstallerDownload')).grokInstallerDownload); }
async function downloadItem(page, downloadId) { return page.evaluate(async id => (await chrome.downloads.search({ id }))[0], downloadId); }
async function prepare(page, platform) {
  await page.locator('#grok-install-prepare').click();
  await expect(page.locator('#grok-install-open')).toBeEnabled({ timeout: 20000 });
  await expect(page.locator('#grok-install-folder')).toBeEnabled();
  const record = await saved(page), item = await downloadItem(page, record.id);
  assert.equal(record.version, version); assert.equal(record.platform, platform);
  assert.equal(item.byExtensionId, id); assert.equal(item.state, 'complete'); assert.equal(item.exists, true);
  const relative = path.relative(downloads, item.filename);
  assert(!relative.startsWith('..') && !path.isAbsolute(relative), 'Download must stay under isolated profile/Downloads');
  assert.deepEqual(await fs.readdir(path.dirname(item.filename)), [path.basename(item.filename)], 'Dedicated directory must contain exactly one installer');
  artifacts.push(item.filename);
  return item;
}

function inspectSingleExecutableZip(bytes) {
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50, 'ZIP end record');
  assert.equal(bytes.readUInt16LE(end + 8), 1); assert.equal(bytes.readUInt16LE(end + 10), 1);
  const central = bytes.readUInt32LE(end + 16);
  assert.equal(bytes.readUInt32LE(central), 0x02014b50);
  assert.equal(bytes.readUInt16LE(central + 4) >> 8, 3, 'ZIP declares Unix permissions');
  assert.equal(bytes.readUInt32LE(central + 38) >>> 16, 0o100755, 'ZIP command is a regular executable file with mode 0755');
  assert(bytes.readUInt16LE(central + 8) & 0x800, 'UTF-8 filename flag');
  assert.equal(bytes.readUInt16LE(central + 10), 0, 'Stored entry');
  const nameLength = bytes.readUInt16LE(central + 28);
  const name = bytes.subarray(central + 46, central + 46 + nameLength).toString('utf8');
  assert.equal(name, '安装连接组件.command');
  const local = bytes.readUInt32LE(central + 42);
  assert.equal(bytes.readUInt32LE(local), 0x04034b50);
  assert.equal(bytes.readUInt16LE(local + 26), nameLength);
  assert.equal(bytes.subarray(local + 30, local + 30 + nameLength).toString('utf8'), name);
  const contentStart = local + 30 + nameLength + bytes.readUInt16LE(local + 28);
  const content = bytes.subarray(contentStart, contentStart + bytes.readUInt32LE(central + 24));
  assert.equal(contentStart + content.length, central, 'No hidden second local file');
  assert.equal(central + 46 + nameLength, end, 'Exactly one central-directory entry');
  let crc = 0xffffffff;
  for (const value of content) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  assert.equal((crc ^ 0xffffffff) >>> 0, bytes.readUInt32LE(central + 16), 'ZIP payload CRC');
  return content.toString('utf8');
}

try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'msedge', headless: true, acceptDownloads: true, downloadsPath: downloads,
    viewport: { width: 1450, height: 1100 }, ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension},${foreign}`, `--load-extension=${extension},${foreign}`]
  });
  const cdp = await context.newCDPSession(await context.newPage());
  const { targetInfo } = await cdp.send('Target.getTargetInfo');
  // Playwright's allowAndName (and CDP allow) can replace extension filenames
  // with blob UUIDs. Use Chrome's normal download handling and isolated prefs.
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default', browserContextId: targetInfo.browserContextId, eventsEnabled: true });
  await expect.poll(() => context.serviceWorkers().filter(w => w.url().endsWith('/background.js')).length).toBe(1);
  worker = context.serviceWorkers().find(w => w.url().endsWith('/background.js'));
  id = new URL(worker.url()).host;
  version = JSON.parse(await fs.readFile(path.join(extension, 'manifest.json'), 'utf8')).version;
  home = await openHome('win');
  await expect(home.locator('#grok-install-open')).toBeDisabled();
  await expect(home.locator('#grok-install-folder')).toBeDisabled();
  await expect(home.locator('#grok-pair')).toBeDisabled();
  pass('Fresh settings show the installer entry and keep execution disabled until a download completes');

  const win = await prepare(home, 'win');
  assert.equal(path.basename(win.filename), '安装连接组件.cmd');
  const command = await fs.readFile(win.filename, 'utf8');
  assert(command.startsWith('@echo off\r\nsetlocal DisableDelayedExpansion\r\n'));
  assert(command.includes('powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command'));
  assert(!command.includes('-WindowStyle Hidden'));
  assert(command.includes(`Find-TrenchExtension -ExtensionId '${id}'`));
  assert(command.includes("'connector\\install.ps1'"));
  assert(!command.includes(path.resolve('.')), 'Generated installer must locate the user package, not embed the test/source checkout');
  assert.equal((await home.evaluate(() => installerSpy)).opened.length, 0, 'Preparing must not automatically run a file');
  pass('Windows preparation uses the real downloads API and writes one self-contained CMD tied to the current extension ID');

  await home.locator('#grok-install-open').click();
  await expect(home.locator('#grok-install-feedback')).toContainText('已交给系统运行');
  await home.locator('#grok-install-folder').click();
  let spy = await home.evaluate(() => installerSpy);
  assert.deepEqual(spy.opened, [win.id]); assert.deepEqual(spy.shown, [win.id]); assert.equal(spy.launches, 2);
  pass('Run and reveal buttons target the current completed download; void downloads.show starts connection detection without error (OS calls intercepted)');

  await home.evaluate(() => { installerSpy.rejectOpen = true; });
  await home.locator('#grok-install-open').click();
  await expect(home.locator('#grok-install-feedback')).toContainText('请点“打开安装位置”');
  await expect(home.locator('#grok-install-folder')).toBeEnabled();
  await home.evaluate(() => { installerSpy.rejectShow = true; });
  await home.locator('#grok-install-folder').click();
  await expect(home.locator('#grok-install-feedback')).toContainText('暂时无法打开安装位置');
  pass('Browser refusal to open or reveal shows a usable fallback without a rejected-Promise page error');

  await home.reload();
  await expect(home.locator('#grok-install-open')).toBeEnabled();
  await expect(home.locator('#grok-install-folder')).toBeEnabled();
  assert.equal((await saved(home)).id, win.id);
  assert.deepEqual((await home.evaluate(() => installerSpy)).opened, []);
  pass('Reload restores a completed owned download without preparing or executing it again');

  const second = await prepare(home, 'win');
  assert.notEqual(second.id, win.id); assert.notEqual(path.dirname(second.filename), path.dirname(win.filename));
  pass('Preparing again creates another directory with only its one installer');
  await home.evaluate(async downloadId => chrome.downloads.removeFile(downloadId), second.id);
  await expect.poll(async () => (await downloadItem(home, second.id)).exists).toBe(false);
  await home.reload();
  await expect(home.locator('#grok-install-open')).toBeDisabled();
  await expect(home.locator('#grok-install-folder')).toBeDisabled();
  pass('A removed download cannot be run or revealed after settings reload');

  await expect.poll(() => context.serviceWorkers().filter(w => w.url().endsWith('/foreign-background.js')).length).toBe(1);
  const foreignWorker = context.serviceWorkers().find(w => w.url().endsWith('/foreign-background.js'));
  const foreignId = await foreignWorker.evaluate(() => chrome.downloads.download({ url: 'data:text/plain,foreign-download-fixture', filename: 'foreign-download-fixture.txt', saveAs: false }));
  await expect.poll(async () => (await downloadItem(home, foreignId))?.state).toBe('complete');
  assert.equal((await downloadItem(home, foreignId)).byExtensionId, new URL(foreignWorker.url()).host);
  await home.evaluate(record => chrome.storage.local.set({ grokInstallerDownload: record }), { id: foreignId, version, platform: 'win' });
  await home.reload();
  await expect(home.locator('#grok-install-feedback')).toContainText('请重新准备安装器');
  await expect(home.locator('#grok-install-open')).toBeDisabled();
  await expect(home.locator('#grok-install-folder')).toBeDisabled();
  await home.evaluate(() => { document.getElementById('grok-install-open').dispatchEvent(new Event('click')); document.getElementById('grok-install-folder').dispatchEvent(new Event('click')); });
  spy = await home.evaluate(() => installerSpy);
  assert.deepEqual(spy.opened, []); assert.deepEqual(spy.shown, []);
  pass('A real download created by another extension is rejected even when its ID is put in saved state');

  await home.evaluate(record => chrome.storage.local.set({ grokInstallerDownload: record }), { id: win.id, version: '0.0.0-stale', platform: 'win' });
  await home.reload();
  await expect(home.locator('#grok-install-open')).toBeDisabled();
  await expect(home.locator('#grok-install-folder')).toBeDisabled();
  pass('Downloads from an older extension version are not restored');

  await home.evaluate(record => chrome.storage.local.set({ grokInstallerDownload: record }), { id: win.id, version, platform: 'win' });
  const mac = await openHome('mac');
  await expect(mac.locator('#grok-install-open')).toHaveText('打开安装包');
  await expect(mac.locator('#grok-install-folder')).toHaveText('在 Finder 中显示');
  await expect(mac.locator('#grok-install-open')).toBeDisabled();
  const macDownload = await prepare(mac, 'mac');
  assert.equal(path.basename(macDownload.filename), '安装连接组件-Mac.zip');
  const macCommand = inspectSingleExecutableZip(await fs.readFile(macDownload.filename));
  assert(macCommand.startsWith('#!/bin/bash\n')); assert(!macCommand.includes('\r'), 'Mac shell payload must use LF');
  assert(macCommand.includes(`extension_id='${id}'`));
  assert(!macCommand.includes('__EXTENSION_ID__') && !macCommand.includes('__LOCATOR_BASE64__'));
  assert(macCommand.includes('/usr/bin/osascript -l JavaScript'));
  assert(macCommand.includes('一键安装AI连接组件-Mac.command'));
  assert(!macCommand.includes(path.resolve('.')));
  pass('Mac platform branch downloads a valid ZIP containing exactly one UTF-8 .command with Unix 0755 and the current extension ID');
  await mac.locator('#grok-install-open').click();
  await expect(mac.locator('#grok-install-feedback')).toContainText('请双击解压后唯一的安装脚本');
  await mac.locator('#grok-install-folder').click();
  spy = await mac.evaluate(() => installerSpy);
  assert.deepEqual(spy.opened, [macDownload.id]); assert.deepEqual(spy.shown, [macDownload.id]);
  await mac.reload();
  await expect(mac.locator('#grok-install-open')).toBeEnabled();
  pass('Mac open/reveal labels, completion recovery and detection callbacks work under platform override (no Mac OS execution)');
  await mac.locator('#grok-settings').screenshot({ path: path.join(output, 'mac-installer-settings.png') });
  await home.reload();
  await expect(home.locator('#grok-install-open')).toBeDisabled();
  await prepare(home, 'win');
  await home.locator('#grok-settings').screenshot({ path: path.join(output, 'windows-installer-settings.png') });
  assert.deepEqual(errors, []);
  completed = true;
} catch (error) {
  errors.push(error.stack || error.message);
  throw error;
} finally {
  if (context) await context.close();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ completed, passes, errors, artifacts, run, realDownloadApi: true, osOpenCallsIntercepted: true, macPlatformOverride: true, actualMacTested: false, realNativeOrBotCalls: false }, null, 2));
}
console.log(`${passes.length} installer browser checks passed. OS execution was intercepted; Mac was platform-simulated.`);
