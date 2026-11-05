import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve('test-results/extension-upgrade');
await fs.mkdir(output, { recursive: true });
const passes = [], observations = [];
const version = JSON.parse(await fs.readFile('extension/manifest.json', 'utf8')).version;
for (const oldVersion of ['0.5.9', '0.5.10']) {
  const run = await fs.mkdtemp(path.join(output, 'from-' + oldVersion + '-'));
  const extension = path.join(run, 'extension');
  const install = async source => {
    await fs.cp(source, extension, { recursive: true });
    const bridge = path.join(extension, 'grok-connection.js');
    await fs.writeFile(bridge, (await fs.readFile(bridge, 'utf8')).replaceAll('com.trenchwhale.grok', 'com.trenchwhale.upgrade_fixture_unregistered'));
  };
  await install(path.resolve('dist/trench-whale-v' + oldVersion + '/extension'));
  const context = await chromium.launchPersistentContext(path.join(run, 'profile'), {
    channel: 'msedge', headless: true, ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const errors = [], warnings = [];
  let upgraded = false;
  try {
    await context.route('https://upgrade.test/**', route => route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><title>Extension upgrade fixture</title><style>body{background:#151820}</style>' }));
    let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const inspect = tabId => worker.evaluate(async ({ tabId }) => {
      return chrome.scripting.executeScript({ target: { tabId }, func: () => ({
        version: TrenchPet.version,
        meshesHaveDisposal: typeof WhaleOriginalMesh.Mesh.prototype.destroy === 'function',
        renderer: document.querySelector('#trench-pet-root')?.shadowRoot.querySelector('canvas')?.dataset.renderer
      }) }).then(r => r[0].result);
    }, { tabId });
    const pages = [];
    for (let i = 0; i < 3; i++) {
      const page = await context.newPage(); pages.push(page);
      const session = await context.newCDPSession(page);
      await session.send('Runtime.enable'); await session.send('Log.enable');
      session.on('Runtime.exceptionThrown', e => { if (upgraded) errors.push(e.exceptionDetails.exception?.description || e.exceptionDetails.text); });
      session.on('Log.entryAdded', e => { if (upgraded && /WebGL|context|rig\.js|mesh/i.test(e.entry.text)) warnings.push(e.entry.text); });
      await page.goto('https://upgrade.test/' + i);
      await expect(page.locator('#trench-pet-root .hit')).toBeVisible();
    }
    // Keep all webpages alive while changing the files and reloading the real extension.
    await install(path.resolve('extension')); upgraded = true;
    await worker.evaluate(() => chrome.runtime.reload()).catch(() => {});
    const home = await context.newPage();
    await expect(async () => { await home.goto(`chrome-extension://${id}/home.html#settings`); }).toPass({ timeout: 10000 });
    worker = context.serviceWorkers().find(w => w.url().startsWith(`chrome-extension://${id}/`)) || await context.waitForEvent('serviceworker');
    const tabs = await worker.evaluate(() => chrome.tabs.query({}));
    for (const page of pages) {
      await page.bringToFront();
      const tab = tabs.find(t => t.url === page.url());
      await expect.poll(async () => (await inspect(tab.id)).version).toBe(version);
      await expect(page.locator('#trench-pet-root')).toHaveCount(1);
      await expect(page.locator('#trench-pet-root .hit')).toBeVisible();
      await page.locator('#trench-pet-root .hit').click();
      await expect(page.locator('#trench-pet-root canvas')).toHaveAttribute('data-renderer', 'original-mesh');
      expect((await inspect(tab.id)).meshesHaveDisposal).toBe(true);
      // Headless Chromium leaves every tab document.visible even after
      // bringToFront(). Drive the real content-script visibility listener as
      // well, so the upgrade test actually covers hide/release/resume.
      const visibility = await worker.evaluate(async tabId => (await chrome.scripting.executeScript({
        target: { tabId }, func: () => {
          const proto = WhaleOriginalMesh.Mesh.prototype, destroy = proto.destroy;
          const hidden = Object.getOwnPropertyDescriptor(document, 'hidden');
          let released = 0, lost = false;
          proto.destroy = function () {
            const gl = this.gl; destroy.call(this); released++;
            lost = gl.isContextLost();
          };
          try {
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
            document.dispatchEvent(new Event('visibilitychange'));
          } finally {
            if (hidden) Object.defineProperty(document, 'hidden', hidden); else delete document.hidden;
            proto.destroy = destroy;
            document.dispatchEvent(new Event('visibilitychange'));
          }
          return { released, lost, renderer: document.querySelector('#trench-pet-root').shadowRoot.querySelector('canvas').dataset.renderer };
        }
      }))[0].result, tab.id);
      expect(visibility).toEqual({ released: 1, lost: true, renderer: 'original-mesh' });
      await home.bringToFront();
    }
    await pages[0].bringToFront(); await pages[0].waitForTimeout(250);
    expect(errors).toEqual([]); expect(warnings).toEqual([]);
    const label = `Upgrade ${oldVersion} to ${version}: three existing pages replaced without duplicates, exceptions or WebGL warnings; click animations survive tab changes`;
    passes.push(label); console.log('PASS ' + label);
  } finally {
    observations.push({ oldVersion, version, errors, warnings });
    await context.close();
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passes, observations }, null, 2));
  }
}
