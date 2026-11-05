/* Public release metadata only. No account credentials or executable remote code. */
(function (root) {
  'use strict';
  const REPOSITORY = 'fh199601-oss/dafeiyu';
  const BASE = 'https://github.com/' + REPOSITORY;
  const RELEASES = BASE + '/releases/latest';
  const API = 'https://api.github.com/repos/' + REPOSITORY + '/releases/latest';
  const CACHE_MS = 5 * 60 * 1000;
  const KEY = 'dafeiyu-release-check-v1';
  function versionParts(value) {
    if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){1,3}$/.test(value)) return null;
    const parts = value.split('.').map(Number);
    return parts.every(n => n <= 65535) && parts.some(Boolean) ? [...parts, ...Array(4 - parts.length).fill(0)] : null;
  }
  function compare(a, b) {
    const left = versionParts(a), right = versionParts(b);
    if (!left || !right) throw Error('版本号格式无效');
    for (let i = 0; i < 4; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
    return 0;
  }
  function release(data) {
    const tag = data?.tag_name, version = typeof tag === 'string' ? tag.replace(/^v/, '') : '';
    if (!versionParts(version) || data.draft !== false || data.prerelease !== false || data.html_url !== BASE + '/releases/tag/' + tag) throw Error('发布信息不完整，请到发布页查看');
    const names = { universal: `大肥鱼-v${version}.zip`, mac: `大肥鱼-v${version}-macOS.zip` };
    const assets = {};
    for (const [platform, name] of Object.entries(names)) {
      const item = Array.isArray(data.assets) ? data.assets.find(a => a.name === name && a.state === 'uploaded') : null;
      const expected = BASE + '/releases/download/' + tag + '/' + encodeURIComponent(name);
      if (item && item.browser_download_url === expected) assets[platform] = { name, url: expected };
    }
    return { version, url: data.html_url, assets };
  }
  function create({ currentVersion, store, fetcher = (...args) => fetch(...args), now = Date.now, timeoutMs = 8000 } = {}) {
    let flight;
    const result = (data, checkedAt, cached) => ({ ...release(data), currentVersion, available: compare(release(data).version, currentVersion) > 0, checkedAt, cached });
    async function perform() {
      const saved = await store.get(KEY).catch(() => null), time = now();
      if (saved?.repository === REPOSITORY && saved.checkedAt <= time && saved.nextCheckAt > time && saved.nextCheckAt <= time + 60 * 60 * 1000) {
        if (saved.error) throw Error(saved.error);
        try { return result(saved.payload, saved.checkedAt, true); } catch { /* Recheck invalid or obsolete metadata. */ }
      }
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
      let retryMs = 60000;
      try {
        const response = await fetcher(API, { headers: { Accept: 'application/vnd.github+json' }, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal });
        if (response.status === 403 || response.status === 429) {
          const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000 - now();
          const retry = Number(response.headers.get('retry-after')) * 1000;
          retryMs = Math.min(60 * 60 * 1000, Math.max(60000, reset || 0, retry || 0));
          throw Error('GitHub 暂时限频，请稍后重试，也可直接查看发布页');
        }
        if (response.status === 404) throw Error('暂未找到正式版本，请到发布页查看');
        if (!response.ok) throw Error('GitHub 暂时不可用，请稍后重试');
        if (Number(response.headers.get('content-length')) > 512 * 1024) throw Error('发布信息过大，请到发布页查看');
        const text = await response.text();
        if (text.length > 512 * 1024) throw Error('发布信息过大，请到发布页查看');
        let data; try { data = JSON.parse(text); } catch { throw Error('发布信息不可读取，请到发布页查看'); }
        const parsed = release(data);
        // Keep only the public fields needed to validate the cached response.
        const payload = { tag_name: data.tag_name, html_url: parsed.url, draft: false, prerelease: false,
          assets: Object.values(parsed.assets).map(a => ({ name: a.name, browser_download_url: a.url, state: 'uploaded' })) };
        const checkedAt = now();
        await store.set(KEY, { repository: REPOSITORY, checkedAt, nextCheckAt: checkedAt + CACHE_MS, payload }).catch(() => {});
        return result(payload, checkedAt, false);
      } catch (error) {
        const message = controller.signal.aborted ? '连接 GitHub 超时，请稍后重试或查看发布页' :
          /^(GitHub|暂未|发布信息)/.test(error.message) ? error.message : '无法连接 GitHub，请检查网络或查看发布页';
        await store.set(KEY, { repository: REPOSITORY, checkedAt: now(), nextCheckAt: now() + retryMs, error: message }).catch(() => {});
        throw Error(message);
      } finally { clearTimeout(timer); }
    }
    function check() { if (!flight) flight = perform().finally(() => { flight = null; }); return flight; }
    return { check };
  }
  const api = { REPOSITORY, RELEASES, API, KEY, CACHE_MS, compare, release, create };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TrenchUpdates = api;
})(typeof globalThis === 'object' ? globalThis : this);
