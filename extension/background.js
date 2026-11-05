importScripts('core.js', 'finance-core.js', 'gmgn-connection.js', 'gmgn-wallet-sync.js', 'binance-pnl.js', 'binance-connection.js', 'grok-connection.js', 'grok-inbox.js', 'updates.js');
const C = TrenchCore;
const gmgn = TrenchGmgnConnection.create();
const binance = TrenchBinance.create();
const grok = TrenchGrok.create(() => deliverGrok().catch(() => {}));
const grokInbox = TrenchGrokInbox.create(chrome.storage.local);
const updates = TrenchUpdates.create({ currentVersion: chrome.runtime.getManifest().version,
  store: { get: async key => (await chrome.storage.local.get(key))[key], set: (key, value) => chrome.storage.local.set({ [key]: value }) } });
let updateDownload = null;
let deliveringGrok = false, deliverAgain = false, deliverForce = false, lastFanoutRevision = -1;
const pendingGrokAcks = new Map(), completedGrokAcks = new Set();
let acknowledgingGrok = false, ackRetryAt = 0;
let refreshingGrokNotifications = null, nextGrokRefreshAt = 0;
let flushingReadNotifications = null, flushReadsAgain=false;
function flushReadNotifications(){
  if(flushingReadNotifications){flushReadsAgain=true;return flushingReadNotifications;}
  flushingReadNotifications=(async()=>{
    do{flushReadsAgain=false;const inbox=await grokInbox.flushReads();await broadcastInbox(inbox);}while(flushReadsAgain);
  })().catch(()=>{chrome.alarms.create('grok-read-retry',{delayInMinutes:0.5});}).finally(()=>{flushingReadNotifications=null;});
  return flushingReadNotifications;
}
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='local'&&Object.entries(changes).some(([key,change])=>key.startsWith(TrenchGrokInbox.READ_PREFIX)&&change.newValue))flushReadNotifications();
});
function pageNotification(tabId, message) {
  let timer;
  const timeout = new Promise(resolve => { timer = setTimeout(resolve, 1800); });
  return Promise.race([chrome.tabs.sendMessage(tabId,message,{frameId:0}),timeout]).finally(()=>clearTimeout(timer));
}
async function broadcastInbox(inbox) {
  const { settings } = await snapshot();
  if (!settings.enabled) return;
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.filter(tab=>tab.id&&C.allowedPage(tab.url)&&!C.isExcluded(new URL(tab.url).hostname,settings.excludedSites))
    .map(tab=>pageNotification(tab.id,{type:'grok:notifications',events:inbox.events,revision:inbox.revision})));
  lastFanoutRevision=Math.max(lastFanoutRevision,inbox.revision);
}
function queueGrokAcks(connectionId, receipts) {
  for(const receipt of receipts){
    const key=connectionId+':'+receipt.seq;
    if(!completedGrokAcks.has(key)&&!pendingGrokAcks.has(key))pendingGrokAcks.set(key,{connectionId,seq:receipt.seq});
  }
  acknowledgeGrok().catch(()=>{});
}
async function acknowledgeGrok() {
  if(acknowledgingGrok||!pendingGrokAcks.size||Date.now()<ackRetryAt)return;
  acknowledgingGrok=true;
  let changed=false;
  try {
    for(const [key,receipt] of pendingGrokAcks){
      const state=grok.peek(),connectionId=state.connectionId||state.bot?.id;
      if(!state.configured||connectionId!==receipt.connectionId){pendingGrokAcks.delete(key);continue;}
      if(!state.installed)throw new Error('Native component disconnected');
      await grok.call('ack',{seq:receipt.seq});
      pendingGrokAcks.delete(key);completedGrokAcks.add(key);changed=true;
      if(completedGrokAcks.size>400)completedGrokAcks.delete(completedGrokAcks.values().next().value);
    }
    ackRetryAt=0;
  } catch {
    // The durable native event is retained. Alarms survive service-worker sleeps;
    // the cooldown also prevents state/error callbacks from creating a tight loop.
    ackRetryAt=Date.now()+5000;
    chrome.alarms.create('grok-ack-retry',{delayInMinutes:0.5});
  } finally {
    acknowledgingGrok=false;
    if(changed)grok.status().catch(()=>{});
  }
}
async function deliverGrok(force = false) {
  if (deliveringGrok) { deliverAgain=true;deliverForce ||= force;return; }
  const state=grok.peek(); if (!state.installed || !state.configured) {
    if(force)await broadcastInbox(await grokInbox.snapshot());
    return;
  }
  deliveringGrok = true;
  try {
    const connectionId=state.connectionId||state.bot.id;
    const saved=await grokInbox.ingestWithReceipts(connectionId,state.events,state.tasks);
    // Saving must succeed before enqueueing ACKs; delivery never waits for Native.
    queueGrokAcks(connectionId,saved.receipts);
    const inbox=await grokInbox.snapshot();
    if(force||inbox.revision>lastFanoutRevision)await broadcastInbox(inbox);
  } catch {} finally {
    deliveringGrok=false;
    if(deliverAgain){const nextForce=deliverForce;deliverAgain=deliverForce=false;setTimeout(()=>deliverGrok(nextForce).catch(()=>{}),0);}
  }
}
async function refreshGrokNotifications(force = false) {
  // A lost native push must heal without opening the options page. Durable
  // unread notifications remain available even while the connector is down.
  await deliverGrok(force);
  if(refreshingGrokNotifications)return refreshingGrokNotifications;
  if(Date.now()<nextGrokRefreshAt)return;
  nextGrokRefreshAt=Date.now()+15000;
  const run=(async()=>{
    if(!grok.peek().configured && !(await chrome.storage.local.get('grokEnabled')).grokEnabled)return;
    await grok.status();
    await deliverGrok(force);
  })();
  refreshingGrokNotifications=run;
  try{await run;}finally{if(refreshingGrokNotifications===run)refreshingGrokNotifications=null;}
}
chrome.tabs.onActivated.addListener(({tabId}) => {ensurePet(tabId).then(()=>refreshGrokNotifications(true)).catch(()=>{});});
chrome.tabs.onUpdated.addListener((id, change) => { if (change.status === 'complete') {ensurePet(id).then(()=>refreshGrokNotifications(true)).catch(()=>{});} });
chrome.windows.onFocusChanged.addListener(() => refreshGrokNotifications(true).catch(()=>{}));
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'grok-notifications') refreshGrokNotifications(true).catch(()=>{});if(a.name==='grok-ack-retry')acknowledgeGrok().catch(()=>{});if(a.name==='grok-read-retry')flushReadNotifications(); });
chrome.alarms.create('grok-notifications', { periodInMinutes: 0.5 });
let writes = Promise.resolve();
function serial(task) {
  const next = writes.then(task, task);
  writes = next.catch(() => {});
  return next;
}
const settingsReady = serial(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  if (settings?.clickRoutingVersion !== 1) await chrome.storage.local.set({ settings: C.upgradeSettings(settings) });
}).catch(() => {});
async function snapshot() {
  await settingsReady;
  const raw = await chrome.storage.local.get(['settings', 'wallets']);
  return { settings: C.upgradeSettings(raw.settings), wallets: C.sanitizeWallets(raw.wallets),
    connections: { bsc: 'not-connected', solana: 'not-connected', news: 'not-connected' } };
}
async function inject(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["core.js","sprite.js","original-mesh.js","click-audio.js","motion.js","rig.js","finance-core.js","x-research.js","pet.js"] });
}
const repairingTabs=new Map();
function ensurePet(tabId){
  if(repairingTabs.has(tabId))return repairingTabs.get(tabId);
  const task=(async()=>{
    const tab=await chrome.tabs.get(tabId);if(!C.allowedPage(tab.url)||tab.discarded)return;
    let timer;
    try{const result=await Promise.race([chrome.tabs.sendMessage(tabId,{type:'pet:ping'},{frameId:0}),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),1200);})]);if(result?.version===chrome.runtime.getManifest().version)return;}catch{}finally{clearTimeout(timer);}
    await inject(tabId);
  })().finally(()=>repairingTabs.delete(tabId));
  repairingTabs.set(tabId,task);return task;
}
async function invalidateFinance() {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.filter(tab => tab.id).map(tab => pageNotification(tab.id, { type: 'finance:invalidate' })));
}
async function handle(message, sender) {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') throw new Error('请求不可用');
  const extensionPage = sender.url?.startsWith(chrome.runtime.getURL(''));
  if (message.type === 'updates:check' || message.type === 'updates:download') {
    if (!extensionPage) throw new Error('请在插件面板或宠物小屋检查更新');
    const update = await updates.check();
    const platform = (await chrome.runtime.getPlatformInfo()).os === 'mac' ? 'mac' : 'universal';
    const asset = update.assets[platform] || update.assets.universal || null;
    if (message.type === 'updates:check') return { update: { ...update, platform, asset } };
    if (!update.available || !asset) throw new Error('暂无可下载的新版本，请到发布页查看');
    if (!updateDownload) updateDownload = chrome.downloads.download({ url: asset.url, filename: '大肥鱼更新/' + asset.name.replace(/^dafeiyu-/, '大肥鱼-'), saveAs: true, conflictAction: 'uniquify' }).finally(() => { updateDownload = null; });
    return { downloadId: await updateDownload };
  }
  if (message.type === 'state:get') return snapshot();
  if (message.type === 'grok:inbox' || message.type === 'grok:notification-read') {
    if(!extensionPage&&(!sender.tab?.id||!C.allowedPage(sender.tab.url)))throw new Error('通知请求不可用');
    if(message.type==='grok:notification-read'){
      await grokInbox.markRead(String(message.id||''));const inbox=await grokInbox.snapshot();await broadcastInbox(inbox);return inbox;
    }
    const inbox=await grokInbox.snapshot();refreshGrokNotifications().catch(()=>{});return inbox;
  }
  if (message.type === 'settings:patch') {
    const patch = message.patch && typeof message.patch === 'object' ? message.patch : {};
    return serial(async () => {
      const { settings: current } = await chrome.storage.local.get('settings');
      const settings = C.patchSettings(current, patch);
      await chrome.storage.local.set({ settings });
      return { settings };
    });
  }
  if (message.type === 'open:home') {
    if (message.section === 'grok') await chrome.tabs.create({ url: chrome.runtime.getURL('home.html#grok-settings') });
    else await chrome.runtime.openOptionsPage(); return {};
  }
  if (message.type === 'grok:research') {
    const tab = sender.tab?.id ? await chrome.tabs.get(sender.tab.id) : null;
    let host = ''; try { host = new URL(tab?.url).hostname; } catch {}
    const { settings } = await snapshot();
    if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(host) || C.clickAction(settings, tab.url) !== 'grok') throw new Error('请在 X 开启一键研究后选择帖子');
    return await grok.call('submit', { post: { url: String(message.post?.url || '').slice(0, 300), text: String(message.post?.text || '').slice(0, 12000), author: String(message.post?.author || '').slice(0, 100) } });
  }
  if (['gmgn:finance','gmgn:finance-peek','gmgn:finance-start'].includes(message.type)) {
    // Only the requesting GMGN tab chooses the chain; unrelated open tabs cannot override it.
    const tab = sender.tab?.id ? await chrome.tabs.get(sender.tab.id) : null;
    const chain = TrenchFinance.context(tab?.url || sender.url)?.chain || '';
    if (message.type === 'gmgn:finance-peek' && message.checkWallets === true) {
      try {
        const result = await gmgn.checkWallets(() => TrenchGmgnWalletSync.read(tab), chain);
        if (result.changed) chrome.runtime.sendMessage({ type: 'gmgn:wallets-updated' }).catch(() => {});
      } catch { /* Keep saved wallets and the balance query usable if discovery is unavailable. */ }
    }
    return { finance: message.type.endsWith('-peek') ? await gmgn.peek(chain) : message.type.endsWith('-start') ? await gmgn.start(chain) : await gmgn.finance(chain) };
  }
  if (['binance:finance','binance:finance-peek','binance:finance-start'].includes(message.type)) {
    const { settings } = await snapshot();
    return { finance: message.type.endsWith('-peek') ? await binance.peek(settings.binanceView) : message.type.endsWith('-start') ? await binance.start(settings.binanceView) : await binance.finance(settings.binanceView) };
  }
  if (!extensionPage) throw new Error('请在插件小屋中操作');
  if (message.type === 'grok:status') {const connection=await grok.status();await deliverGrok();return {connection,...await grokInbox.snapshot()};}
  if (message.type === 'grok:pair') { await grok.enable(); return { connection: { ...await grok.call('pair'), installed: true } }; }
  if (message.type === 'grok:retry') return { connection: { ...await grok.call('pair-retry'), installed: true } };
  if (message.type === 'grok:cancel') return { connection: { ...await grok.call('pair-cancel'), installed: true } };
  if (message.type === 'grok:disconnect') { const connection = { ...await grok.call('disconnect'), installed: true }; await grok.disable(); await grokInbox.clear();pendingGrokAcks.clear();completedGrokAcks.clear();lastFanoutRevision=-1;await broadcastInbox(await grokInbox.snapshot());return { connection }; }
  if (message.type === 'grok:enable-x') {
    const connection = await grok.status(); if (!connection.installed || !connection.configured) throw new Error('请先完成 Bot 配对');
    return serial(async () => { const { settings: old } = await snapshot(); const settings = C.patchSettings(old, { clickMode: 'auto', clickX: 'grok' }); await chrome.storage.local.set({ settings }); return { settings }; });
  }
  if (message.type === 'binance:status') return { connection: await binance.status() };
  if (message.type === 'binance:save') { const connection = await binance.save(message.apiKey, message.secret); await invalidateFinance(); return { connection }; }
  if (message.type === 'binance:clear') { const connection = await binance.clear(); await invalidateFinance(); return { connection }; }
  if (message.type === 'gmgn:status') return { connection: await gmgn.status() };
  if (message.type === 'gmgn:save') { const connection = await gmgn.save(message.apiKey, message.addresses, message.defaultChain); await invalidateFinance(); return { connection }; }
  if (message.type === 'gmgn:clear') { const connection = await gmgn.clear(); await invalidateFinance(); return { connection }; }
  if (message.type === 'gmgn:test') return await gmgn.test();
  if (message.type === 'gmgn:report') return { report: await gmgn.report() };
  if (message.type === 'wallet:add') {
    const wallet = message.wallet;
    if (!wallet || !C.validateAddress(wallet.chain, wallet.address)) throw new Error('请检查链和完整钱包地址');
    return serial(async () => {
      const { wallets: old } = await snapshot();
      if (old.length >= 30) throw new Error('第一版最多保存 30 个地址');
      const wallets = C.sanitizeWallets([...old, { ...wallet, id: crypto.randomUUID() }]);
      if (wallets.length === old.length) throw new Error('这个地址已经保存过了');
      await chrome.storage.local.set({ wallets }); return { wallets };
    });
  }
  if (message.type === 'wallet:remove') return serial(async () => {
    const { wallets: old } = await snapshot();
    const wallets = old.filter(wallet => wallet.id !== message.id);
    await chrome.storage.local.set({ wallets }); return { wallets };
  });
  if (message.type === 'demo:active') {
    if (!C.ACTIONS[message.action]) throw new Error('未知动作');
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id || !C.allowedPage(tab.url)) throw new Error('请先打开普通网页；也可以在宠物小屋里体验动作');
    const state = await snapshot();
    if (!state.settings.enabled) throw new Error('请先开启网页陪伴');
    if (C.isExcluded(new URL(tab.url).hostname, state.settings.excludedSites)) throw new Error('这个网站已被设为不打扰，请先从名单移除');
    const event = C.demoEvent(message.action, message.chain);
    try { return await chrome.tabs.sendMessage(tab.id, { type: 'pet:event', event }); }
    catch { await inject(tab.id); return chrome.tabs.sendMessage(tab.id, { type: 'pet:event', event }); }
  }
  throw new Error('不支持的操作');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(data => respond({ ok: true, ...data }),
    error => respond({ ok: false, error: error.message || '暂时无法完成操作' }));
  return true;
});
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const current = await snapshot();
  await chrome.storage.local.set({ settings: current.settings, wallets: current.wallets });
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.filter(tab => C.allowedPage(tab.url)).map(tab => inject(tab.id)));
  if (reason === 'install') await chrome.runtime.openOptionsPage();
});
