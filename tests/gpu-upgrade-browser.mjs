import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve('test-results/gpu-upgrade');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true,
  args: ['--max-active-webgl-contexts=4'] });
const errors = [], warnings = [], passes = [];
let completed = false, failure = '';
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (['warning', 'error'].includes(m.type())) warnings.push(m.text()); });
  await page.setContent('<!doctype html><title>Original renderer upgrade regression</title>');
  for (const file of ['core.js', 'sprite.js', 'original-art-data.js', 'motion.js'])
    await page.addScriptTag({ path: path.resolve('extension', file) });
  // Use the shipped pre-disposal renderer, not a mock with destroy() stubbed out.
  await page.addScriptTag({ path: path.resolve('dist/trench-whale-v0.5.9/extension/original-mesh.js') });
  await page.addScriptTag({ path: path.resolve('extension/rig.js') });
  const legacy = await page.evaluate(async () => {
    const chart = document.createElement('canvas').getContext('webgl');
    const held = [];
    for (let i = 0; i < 20; i++) {
      const rig = WhaleRig.create(document.createElement('canvas'), 'data:image/png;base64,' + WhaleOriginalArtData);
      rig.schedule = () => {}; held.push(rig); await rig.ready;
      const old = rig.art.mesh, gl = old.gl;
      if (typeof old.destroy !== 'undefined') throw Error('Fixture is not the old renderer');
      rig.configure({ size: 180, enabled: false, reduced: false });
      if (!gl.isContextLost() || rig.art.mesh !== null) throw Error('Legacy renderer retained its context');
      rig.configure({ size: 180, enabled: true, reduced: false });
      rig.play('alert');
      if (rig.canvas.dataset.renderer !== 'original-mesh') throw Error('Returning to foreground lost the animation');
      const replacement = rig.art.mesh.gl;
      rig.destroy(); rig.destroy();
      if (!replacement.isContextLost() || rig.texture || rig.art) throw Error('Legacy disposal incomplete');
    }
    globalThis.upgradeHeld = held;
    return { chartIntact: !chart.isContextLost(), cycles: held.length };
  });
  assert.deepEqual(legacy, { chartIntact: true, cycles: 20 });
  passes.push('Twenty hide/resume/destroy cycles with the actual v0.5.9 renderer release GPU resources and preserve the website chart');

  await page.addScriptTag({ path: path.resolve('extension/original-mesh.js') });
  await page.addScriptTag({ path: path.resolve('extension/rig.js') });
  await page.evaluate(() => { globalThis.expectedMesh = WhaleOriginalMesh.Mesh; });
  // A late script from a previous injection must not change a live rig's renderer.
  await page.addScriptTag({ path: path.resolve('dist/trench-whale-v0.5.9/extension/original-mesh.js') });
  assert.equal(await page.evaluate(async () => {
    const r = WhaleRig.create(document.createElement('canvas'), 'data:image/png;base64,' + WhaleOriginalArtData);
    r.schedule = () => {}; await r.ready;
    const consistent = r.art.mesh instanceof expectedMesh;
    const gl = r.art.mesh.gl; r.destroy();
    return consistent && gl.isContextLost();
  }), true);
  passes.push('A later renderer script cannot replace the renderer captured by an existing rig module');
  await page.waitForTimeout(200);
  assert.deepEqual(errors, []); assert.deepEqual(warnings, []);
  completed = true;
  for (const pass of passes) console.log('PASS ' + pass);
} catch (error) { failure = error.stack || String(error); throw error; }
finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ completed, passes, errors, warnings, failure }, null, 2));
  await browser.close();
}
