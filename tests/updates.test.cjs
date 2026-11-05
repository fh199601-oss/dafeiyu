const { test } = require('node:test');
const assert = require('node:assert/strict');
const U = require('../extension/updates.js');
function release(version = '0.5.30') {
  const base = 'https://github.com/' + U.REPOSITORY;
  return { tag_name: 'v' + version, html_url: base + '/releases/tag/v' + version, draft: false, prerelease: false,
    assets: ['', '-macOS'].map(suffix => { const name = `大肥鱼-v${version}${suffix}.zip`; return { name, state: 'uploaded', browser_download_url: `${base}/releases/download/v${version}/${encodeURIComponent(name)}` }; }) };
}
function fixture() {
  let time = 1800000000000, calls = 0, reply = () => Response.json(release()); const rows = new Map(), requests = [];
  const options = { currentVersion: '0.5.29', now: () => time, timeoutMs: 30,
    store: { get: async k => rows.get(k), set: async (k, v) => rows.set(k, v) },
    fetcher: async (...args) => { calls++; requests.push(args); return reply(...args); } };
  return { make: () => U.create(options), rows, requests, options, calls: () => calls, advance: ms => { time += ms; }, reply: fn => { reply = fn; } };
}
test('versions compare numerically, accept Chrome four-part versions and reject non-release identifiers', () => {
  assert.equal(U.compare('0.5.10', '0.5.9'), 1);
  assert.equal(U.compare('0.5.29', '0.5.29.0'), 0);
  assert.equal(U.compare('1.0', '2.0'), -1);
  for (const v of ['1.2-beta', '01.2', '65536.0', '1.2.3.4.5', '0.0', 'NaN.1']) assert.throws(() => U.compare(v, '1.0'));
});
test('checks merge, survive service-worker restarts, expire after five minutes and send no credentials', async () => {
  const h = fixture(), service = h.make();
  const values = await Promise.all([service.check(), service.check(), service.check()]);
  assert.equal(h.calls(), 1); assert.ok(values.every(v => v.available && v.version === '0.5.30'));
  assert.ok(values[0].assets.mac.name.endsWith('-macOS.zip'));
  assert.equal((await h.make().check()).cached, true); assert.equal(h.calls(), 1);
  h.advance(U.CACHE_MS + 1); await h.make().check(); assert.equal(h.calls(), 2);
  for (const [url, init] of h.requests) { assert.equal(url, U.API); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.headers.Authorization, undefined); assert.equal(init.body, undefined); }
});
test('same or older official releases do not downgrade, unpublished and foreign links are rejected', async () => {
  for (const v of ['0.5.29', '0.5.28']) { const h = fixture(); h.reply(() => Response.json(release(v))); assert.equal((await h.make().check()).available, false); }
  for (const change of [{ draft: true }, { prerelease: true }, { tag_name: 'v0.6.0-beta' }, { html_url: 'https://evil.test/latest' }]) assert.throws(() => U.release({ ...release(), ...change }));
  const data = release(); data.assets[0].browser_download_url = 'https://evil.test/update.zip'; data.assets[1].browser_download_url += '?redirect=evil';
  assert.deepEqual(U.release(data).assets, {});
});
test('rate limits persist across restarts and recover after Retry-After', async () => {
  const h = fixture(); h.reply(() => new Response('', { status: 429, headers: { 'retry-after': '120' } }));
  await assert.rejects(h.make().check(), /限频/); await assert.rejects(h.make().check(), /限频/); assert.equal(h.calls(), 1);
  h.advance(120001); h.reply(() => Response.json(release())); assert.equal((await h.make().check()).available, true); assert.equal(h.calls(), 2);
});
test('offline, missing releases, invalid JSON and timeout report failures instead of claiming up-to-date', async () => {
  for (const reply of [() => { throw Error('network'); }, () => new Response('', { status: 404 }), () => new Response('oops'),
    (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('abort'))))]) {
    const h = fixture(); h.reply(reply); await assert.rejects(h.make().check(), /GitHub|发布|正式版本/);
    assert.equal(h.calls(), 1); await assert.rejects(h.make().check()); assert.equal(h.calls(), 1);
    h.advance(60001); h.reply(() => Response.json(release())); assert.equal((await h.make().check()).available, true);
  }
});
test('invalid saved metadata cannot redirect downloads and failed persistence does not hide a successful check', async () => {
  const h = fixture(); h.rows.set(U.KEY, { repository: U.REPOSITORY, checkedAt: 1800000000000, nextCheckAt: 1800000060000, payload: { ...release(), html_url: 'https://evil.test/' } });
  assert.equal((await h.make().check()).available, true); assert.equal(h.calls(), 1);
  const options = { ...h.options, store: { get: async () => { throw Error('storage'); }, set: async () => { throw Error('storage'); } } };
  assert.equal((await U.create(options).check()).available, true);
});
