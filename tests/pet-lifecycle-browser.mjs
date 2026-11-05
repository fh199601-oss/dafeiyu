import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const output = path.resolve('test-results/pet-lifecycle'); fs.mkdirSync(output, { recursive: true });
const extension = path.resolve('extension'), profile = fs.mkdtempSync(path.join(output, 'profile-'));
const errors = [], passes = []; let context;
const pass = text => { passes.push(text); console.log('PASS ' + text); };
try {
  context = await chromium.launchPersistentContext(profile, { channel: 'msedge', headless: true,
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  await context.route('https://pet-lifecycle.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Pet lifecycle fixture</title>' }));
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto('https://pet-lifecycle.test/');
  await expect(page.locator('#trench-pet-root .hit')).toBeVisible();
  const id = new URL(worker.url()).host;
  const inspect = () => worker.evaluate(async () => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith('https://pet-lifecycle.test/'));
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => chrome.runtime.id }); return results[0].result;
  });
  // Reload the actual extension, retaining the existing webpage and its old
  // invalidated content-script world. No account or native Bot is configured.
  await worker.evaluate(() => chrome.runtime.reload()).catch(() => {});
  const home = await context.newPage();
  await expect(async () => { await home.goto(`chrome-extension://${id}/home.html#settings`); }).toPass({ timeout: 10000, intervals: [250, 500] });
  await page.bringToFront();
  await expect(page.locator('#trench-pet-root')).toHaveCount(1);
  await expect(page.locator('#trench-pet-root .hit')).toBeVisible();
  worker = context.serviceWorkers().find(w => w.url().startsWith(`chrome-extension://${id}/`)) || await context.waitForEvent('serviceworker');
  await expect.poll(inspect).toBe(id);
  expect(errors).toEqual([]);
  pass('Actual extension reload replaces the invalidated old pet without page reload, duplicates or errors');
  const result = await worker.evaluate(async () => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith('https://pet-lifecycle.test/'));
    return (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
    try {
    TrenchPet.dispose();
    const create = WhaleRig.create, remove = chrome.runtime.onMessage.removeListener;
    let destroyedRigs = 0;
    WhaleRig.create = (...args) => { const rig = create(...args), destroy = rig.destroy; rig.destroy = () => { destroyedRigs++; destroy.call(rig); }; return rig; };
    const preview = TrenchPet.mount({ preview: true, settings: { enabled: true } }); preview.destroy(); preview.destroy();
    const pet = TrenchPet.mount({ settings: { enabled: true } });
    chrome.runtime.onMessage.removeListener = () => { throw new Error('Extension context invalidated.'); };
    let error = '';
    try { pet.destroy(); pet.destroy(); } catch (failure) { error = failure.message; }
    chrome.runtime.onMessage.removeListener = remove; WhaleRig.create = create;
    return { error, destroyedRigs, hosts: document.querySelectorAll('#trench-pet-root, #trench-pet-preview').length };
    } catch (error) { return { setupError: error.message, loaded: typeof globalThis.TrenchPet }; }
    } }))[0].result;
  });
  expect(result).toEqual({ error: '', destroyedRigs: 2, hosts: 0 });
  pass('Preview and runtime pets dispose idempotently even when extension listener removal fails');
  fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify({ passes, errors }, null, 2));
} finally { await context?.close(); }
