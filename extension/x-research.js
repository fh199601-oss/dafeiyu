(function (root) {
  'use strict';
  const ARTICLES = 'article[data-testid="tweet"], article[role="article"]';
  const HEADERS = '[data-testid="User-Name"], [data-testid="UserName"]';
  const QUOTES = '[data-testid="quoteTweet"], [data-testid="quotedTweet"], [data-testid="tweetQuote"], blockquote';
  const SELECTION_TIMEOUT_MS = 5000;
  let cancelSelection;
  function parse(value) {
    try {
      if (typeof value !== 'string' || !value.trim()) return null;
      const u = new URL(value, location.href);
      const m = u.pathname.match(/^\/(?:([A-Za-z0-9_]{1,30})\/status|i\/web\/status)\/(\d{1,25})(?:\/.*)?$/);
      if (u.protocol !== 'https:' || !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(u.hostname) || u.username || u.password || u.port || !m) return null;
      return { id: m[2], url: `https://x.com/${(m[1] || 'i').toLowerCase()}/status/${m[2]}` };
    } catch { return null; }
  }
  function canonical(value) { return parse(value)?.url || ''; }
  function postId(value) { return parse(value)?.id || ''; }
  function visible(node) {
    if (!node?.isConnected || !node.getClientRects().length || node.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = getComputedStyle(node); return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse';
  }
  function quoted(node, article, header, primary) {
    // Scope quote detection to wrappers INSIDE this article. The permalink's own
    // <a role="link"> and an enclosing timeline card are ordinary X structure.
    for (let wrapper = node; wrapper && wrapper !== article; wrapper = wrapper.parentElement) {
      if (wrapper.matches(QUOTES)) return true;
      if (wrapper.getAttribute('role') !== 'link' || wrapper.tagName === 'A' || (wrapper.contains(header) && (!primary || wrapper.contains(primary)))) continue;
      // X uses a clickable non-anchor card for quoted posts. Do not reject every
      // role=link wrapper: only an embedded post with its own content/identity.
      // Image/video quotes have no tweetText; their identity + date still marks
      // a separate post, often before the main date in a detail-page layout.
      const body = wrapper.querySelector('[data-testid="tweetText"]');
      const identity = wrapper.querySelector(HEADERS);
      const date = wrapper.querySelector('a[href*="/status/"] time');
      if ((body && (identity || date)) || (identity && date)) return true;
    }
    return false;
  }
  function scope(article) {
    if (!article?.matches(ARTICLES) || article.parentElement?.closest(ARTICLES) || !visible(article)) return null;
    const owns = node => node.closest('article') === article;
    const header = [...article.querySelectorAll(HEADERS)].find(node => owns(node) && !node.closest(QUOTES)) || null;
    const outerAnchors = [...article.querySelectorAll('a[href]')].filter(anchor => {
      if (!owns(anchor) || !canonical(anchor.href) || anchor.closest(QUOTES + ', [data-testid="tweetText"], [data-testid="card.wrapper"]')) return false;
      for (let wrapper = anchor.parentElement; wrapper && wrapper !== article; wrapper = wrapper.parentElement) if (wrapper.getAttribute('role') === 'link' && wrapper.tagName !== 'A') return false;
      return true;
    });
    const primary = outerAnchors.find(anchor => anchor.querySelector('time')) || outerAnchors[0] || null;
    const own = node => owns(node) && !quoted(node, article, header, primary) && visible(node);
    return { header, own };
  }
  function permalink(article, own) {
    const times = [...article.querySelectorAll('time')].filter(own);
    for (const time of times) {
      const anchor = time.closest('a[href]');
      if (anchor && article.contains(anchor) && own(anchor)) { const url = canonical(anchor.href); if (url) return url; }
    }
    // Some detail/translated layouts render the date as plain text rather than a
    // <time>. Accept a unique OUTER permalink, never a link inside tweet text or
    // a quoted/card body. Ambiguous matches fail rather than selecting a reply.
    const candidates = [...article.querySelectorAll('a[href]')].filter(anchor => own(anchor) &&
      !anchor.closest('[data-testid="tweetText"], [data-testid="card.wrapper"]')).map(anchor => parse(anchor.href)).filter(Boolean);
    const ids = new Set(candidates.map(candidate => candidate.id));
    return ids.size === 1 ? candidates[0].url : '';
  }
  function read(article) {
    const context = scope(article); if (!context) return null;
    const { header, own } = context;
    const url = permalink(article, own);
    const bodies = [...article.querySelectorAll('[data-testid="tweetText"]')].filter(node => own(node) && !node.parentElement?.closest('[data-testid="tweetText"]'));
    const text = bodies.map(node => (typeof node.innerText === 'string' ? node.innerText : node.textContent || '').trim()).filter(Boolean).join('\n').slice(0, 12_000);
    if (!url || !text) return null;
    return { url, text, author: header && own(header) ? (header.innerText || '').trim().slice(0, 100) : '' };
  }
  function current() {
    const id = postId(location.href); if (!id) return null;
    for (const article of document.querySelectorAll(ARTICLES)) { const post = read(article); if (post && postId(post.url) === id) return post; }
    return null;
  }
  function waitCurrent({ timeout = 1500, signal } = {}) {
    if (signal?.aborted || document.hidden) return Promise.resolve(null);
    const first = current(), id = postId(location.href);
    if (first || !id) return Promise.resolve(first || null);
    return new Promise(resolve => {
      let finished = false, interval, deadline;
      function done(value) { if (finished) return; finished = true; clearInterval(interval); clearTimeout(deadline); signal?.removeEventListener('abort', abort); document.removeEventListener('visibilitychange', hidden); resolve(value); }
      function check() { if (signal?.aborted || document.hidden || postId(location.href) !== id) return done(null); const value = current(); if (value) done(value); }
      const abort = () => done(null), hidden = () => { if (document.hidden) done(null); };
      interval = setInterval(check, 100); deadline = setTimeout(() => { check(); done(null); }, Math.max(0, Math.min(1500, Number(timeout) || 0)));
      signal?.addEventListener('abort', abort, { once: true }); document.addEventListener('visibilitychange', hidden); check();
    });
  }
  function outerArticle(target) {
    let article = target?.closest?.(ARTICLES);
    for (let outer = article?.parentElement?.closest(ARTICLES); outer; outer = article.parentElement?.closest(ARTICLES)) article = outer;
    return article;
  }
  function select({ signal } = {}) {
    cancel();
    if (signal?.aborted || document.hidden) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      let marked, outline, priority, timer, finished = false;
      const deadline = performance.now() + SELECTION_TIMEOUT_MS;
      function highlight(article) {
        if (article === marked) return;
        if (marked) { if (outline) marked.style.setProperty('outline', outline, priority); else marked.style.removeProperty('outline'); }
        marked = article;
        if (marked) { outline = marked.style.getPropertyValue('outline'); priority = marked.style.getPropertyPriority('outline'); marked.style.setProperty('outline', '3px solid #5a85ce', 'important'); }
      }
      function finish(value, error) {
        if (finished) return; finished = true; clearTimeout(timer); highlight(null);
        document.removeEventListener('pointerover', over, true); document.removeEventListener('click', click, true); document.removeEventListener('keydown', key, true); document.removeEventListener('visibilitychange', visibility);
        signal?.removeEventListener('abort', abort);
        cancelSelection = null; if (error) reject(error); else resolve(value);
      }
      // Also check the deadline in event handlers: throttled timers must not
      // intercept an ordinary post click after the selection period has ended.
      const expired = () => { if (performance.now() < deadline) return false; finish(null); return true; };
      const over = event => { if (!expired()) highlight(outerArticle(event.target)); };
      const click = event => {
        if (expired()) return;
        if (event.button !== 0) return;
        const article = outerArticle(event.target); if (!article) return;
        event.preventDefault(); event.stopImmediatePropagation();
        const post = read(article); finish(post, post ? null : new Error('未能识别这条帖子的正文或链接，请打开帖子详情后再试。'));
      };
      const key = event => { if (event.key === 'Escape') finish(null); };
      const visibility = () => { if (document.hidden) finish(null); };
      const abort = () => finish(null);
      cancelSelection = abort;
      document.addEventListener('pointerover', over, true); document.addEventListener('click', click, true); document.addEventListener('keydown', key, true); document.addEventListener('visibilitychange', visibility);
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => finish(null), SELECTION_TIMEOUT_MS);
    });
  }
  function cancel() { cancelSelection?.(); }
  root.TrenchX = { canonical, postId, current, waitCurrent, read, select, cancel };
})(globalThis);
