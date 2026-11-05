const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const turn = () => new Promise(resolve => setImmediate(resolve));
const terminal = (id, at = Date.now()) => ({ id, seq: Number(id.replace(/\D/g, '')) || 1, status: 'completed', botName: 'Fixture Bot', botUrl: 'grokbot://app/v1/agent?id=fixture', title: id, createdAt: at - 1000, finishedAt: at });
function gate() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
function worker({ events = [terminal('task1')], tasks = events, ack, send, statusUpdate, failSave = false, data: suppliedData } = {}) {
  const data = suppliedData || { settings: { enabled: true, excludedSites: ['excluded.test'] } };
  const sent = [], calls = [], order = [];
  let statusReads=0,timestamp=Date.now(),state = { installed: true, configured: true, connectionId: 'pair1', bot: { id: 'fixture' }, events, tasks }, changed;
  const listeners = { addListener() {}, removeListener() {} };
  const tabs = [{ id: 1, url: 'https://visible.test/' }, { id: 2, url: 'https://background.test/', active: false }, { id: 3, url: 'https://excluded.test/' }, { id: 4, url: 'chrome://settings/' }];
  const storage = {
    async get(keys) { return keys===null?structuredClone(data):Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, structuredClone(data[k])])); },
    async set(values) { if (failSave) throw Error('fixture storage unavailable'); Object.assign(data, structuredClone(values)); order.push('saved'); },
    async remove(key) { for(const k of Array.isArray(key)?key:[key])delete data[k]; }
  };
  const context = vm.createContext({ console, URL, setTimeout, clearTimeout, queueMicrotask, structuredClone, Date:class extends Date { static now(){return timestamp;} }, crypto: require('node:crypto').webcrypto,
    chrome: { storage: { local: storage, onChanged:listeners }, tabs: { query: async () => tabs, get: async id => tabs.find(t => t.id === id), onActivated: listeners, onUpdated: listeners, sendMessage: async (id, message) => { sent.push({ id, message: structuredClone(message) }); if(send)return send(id,message);return { queued: true, version: 'fixture' }; } }, windows: { onFocusChanged: listeners }, alarms: { onAlarm: listeners, create() {} }, runtime: { id: 'fixture-extension', getURL: p => 'chrome-extension://fixture-extension/' + p, getManifest: () => ({ version: 'fixture' }), onMessage: listeners, onInstalled: listeners }, scripting: { executeScript: async () => {} } },
    TrenchGmgnConnection: { create: () => ({}) }, TrenchBinance: { create: () => ({}) },
    TrenchGrok: { create(onState) { changed = onState; return { peek: () => state, async call(action, input) { calls.push({ action, input }); order.push(action); if (action === 'ack') { await ack?.(input); state = { ...state, events: state.events.filter(event => event.seq !== input.seq) }; } return {}; }, async status() { statusReads++;if(statusUpdate)state={...state,...await statusUpdate(statusReads)};changed(state); return state; } }; } }
  });
  context.importScripts = (...files) => { for (const file of files) if (['core.js', 'grok-inbox.js', 'updates.js'].includes(file)) vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension', file), 'utf8'), context, { filename: file }); };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8') + '\nglobalThis.fixtureApi = { deliverGrok, handle, acknowledgeGrok, refreshGrokNotifications };', context);
  return { api: context.fixtureApi, data, sent, calls, order, statusReads:()=>statusReads, sender: { id: 'fixture-extension', tab: tabs[0], url: tabs[0].url }, advance(ms){timestamp+=ms;},update(next) { state = { ...state, ...next }; changed(state); } };
}

test('durable receipt is saved before native ack and fans out to all allowed foreground/background tabs', async () => {
  const f = worker(); await f.api.deliverGrok();
  assert.ok(f.order.indexOf('saved') < f.order.indexOf('ack'));
  assert.deepEqual([...new Set(f.sent.map(x => x.id))].sort(), [1, 2]);
  assert.equal(f.data.grokNotificationInbox.items[0].readAt, 0);
});

test('persistence failure leaves native events unacknowledged', async () => {
  const f = worker({ failSave: true }); await f.api.deliverGrok();
  assert.equal(f.calls.length, 0);
});

test('a second native completion arriving during acknowledgment is ingested without waiting for an alarm', async () => {
  const blocked = gate(), first = terminal('task1'), second = terminal('task2');
  const f = worker({ events: [first], ack: () => blocked.promise });
  const running = f.api.deliverGrok(); await turn();
  f.update({ events: [first, second], tasks: [first, second] });
  blocked.release(); await running; await new Promise(resolve=>setTimeout(resolve,15));
  assert.deepEqual(f.data.grokNotificationInbox.items.map(e => e.id).sort(), ['task1', 'task2']);
});

test('native updates during an unfinished tab fanout schedule a follow-up ingestion',async()=>{
  const blocked=gate(),first=terminal('task1'),second=terminal('task2');
  const f=worker({events:[first],send:()=>blocked.promise});
  const running=f.api.deliverGrok();await turn();
  f.update({events:[second],tasks:[first,second]});
  blocked.release();await running;await new Promise(resolve=>setTimeout(resolve,15));
  assert.deepEqual(f.data.grokNotificationInbox.items.map(e=>e.id).sort(),['task1','task2']);
});

test('a page can read the durable inbox while native acknowledgment is stalled', async () => {
  const blocked = gate(), f = worker({ ack: () => blocked.promise });
  await f.api.deliverGrok();
  const resultPromise = f.api.handle({ type: 'grok:inbox' }, f.sender);
  const outcome = await Promise.race([resultPromise.then(value => ({ value })), new Promise(resolve => setTimeout(() => resolve({ delayed: true }), 80))]);
  blocked.release(); await resultPromise; await turn();
  assert.equal(outcome.delayed, undefined, 'Persisted unread items must not wait for a slow native ack');
  assert.equal(outcome.value.events[0].id, 'task1');
});

test('an explicit read during native ack is never followed by broadcasting the stale unread snapshot', async () => {
  const blocked = gate(), f = worker({ ack: () => blocked.promise });
  const running = f.api.deliverGrok(); await turn();
  await f.api.handle({ type: 'grok:notification-read', id: 'task1' }, f.sender);
  blocked.release(); await running; await turn();
  const last = f.sent.filter(e => e.id === 1 && e.message.type === 'grok:notifications').at(-1);
  assert.deepEqual(last.message.events, []);
});

test('a frozen tab cannot hold fanout open beyond two seconds or block other pages',async()=>{
  const frozen=gate(),f=worker({send:id=>id===2?frozen.promise:Promise.resolve({queued:true})});
  const start=Date.now();await f.api.deliverGrok();
  const duration=Date.now()-start;frozen.release();
  assert.ok(duration<2050,`Frozen page blocked delivery for ${duration}ms`);
  assert.equal(f.sent.some(x=>x.id===1&&x.message.events.length===1),true);
});

test('failed native acknowledgment remains retryable without blocking receipt delivery or spinning',async()=>{
  let attempts=0;
  const f=worker({ack:async()=>{if(++attempts===1)throw Error('fixture native outage');}});
  await f.api.deliverGrok();await turn();
  assert.equal(f.sent[0].message.events[0].id,'task1');
  await f.api.deliverGrok();await turn();assert.equal(attempts,1);
  f.advance(6000);await f.api.acknowledgeGrok();await turn();
  assert.equal(attempts,2);
  await f.api.deliverGrok();assert.equal(attempts,2);
});

test('invalid or expired native events are never acknowledged as durably received',async()=>{
  const f=worker({events:[{...terminal('bad'),botUrl:'https://unsafe.test/'},{...terminal('old'),finishedAt:Date.now()-8*86400000}]});
  await f.api.deliverGrok();await turn();assert.equal(f.calls.length,0);
});

test('worker restart keeps monotonic read receipts and cannot resurrect completed history',async()=>{
  const first=worker();await first.api.deliverGrok();
  const read=await first.api.handle({type:'grok:notification-read',id:'task1'},first.sender);
  const restarted=worker({data:first.data,events:[],tasks:first.data.grokNotificationInbox.items});
  await restarted.api.deliverGrok();
  const result=await restarted.api.handle({type:'grok:inbox'},restarted.sender);
  assert.equal(result.events.length,0);assert.equal(result.revision,read.revision);
});

test('an already-paired Bot receives the current one-message report contract on every new task', async () => {
  const { Engine } = await import(pathToFileURL(path.join(__dirname, '../connector/engine.mjs')));
  const sent = [];
  const engine = new Engine({
    store: { read: async () => ({ connection: { id: 'fixture', name: 'Old paired bot', generation: 'old-pair', webhookUrl: 'https://api.cursor.com/webhook/fixture', webhookKey: 'fixture-only' }, tasks: [], events: [], nextSeq: 1 }), write: async () => {} },
    transport: { ensure: async () => 'https://fixture.trycloudflare.com' },
    provision: async () => { throw Error('Must not pair again'); },
    fetcher: async (_url, options) => { sent.push(JSON.parse(options.body)); return { status: 200 }; }
  });
  await engine.init();
  const task = await engine.submit({ url: 'https://x.com/fixture/status/123', author: 'Fixture', text: 'Untrusted post content.' });
  assert.equal(sent.length, 1);
  assert.match(sent[0].report_instructions, /最终只在当前 Bot 对话发布一条完整报告/);
  assert.match(sent[0].report_instructions, /本报告结束/);
  assert.match(sent[0].report_instructions, new RegExp(task.task.id.slice(0, 8)));
  assert.equal(sent[0].post.text, 'Untrusted post content.');
  assert.match(sent[0].callback_url, /^https:\/\/fixture\.trycloudflare\.com\/result\/[a-f0-9]{64}$/);
});

test('notification reconciliation recovers a lost native push without opening settings',async()=>{
  const item=terminal('task9');
  const f=worker({events:[],statusUpdate:n=>n===1?{events:[item],tasks:[item]}:{}});
  await f.api.refreshGrokNotifications(true);await turn();await turn();
  assert.equal(f.data.grokNotificationInbox.items[0].id,'task9');
  assert.ok(f.sent.some(x=>x.id===1&&x.message.events.some(e=>e.id==='task9')));
  const reads=f.statusReads();
  await Promise.all([f.api.refreshGrokNotifications(true),f.api.refreshGrokNotifications(true)]);
  assert.equal(f.statusReads(),reads,'Focus and page requests within cooldown must not repoll Native');
  f.advance(15001);await f.api.refreshGrokNotifications();assert.equal(f.statusReads(),reads+1);
});

test('a hung native status pull cannot block reading already durable notifications',async()=>{
  const blocked=gate(),f=worker({statusUpdate:()=>blocked.promise});
  await f.api.deliverGrok();await turn();
  const refresh=f.api.refreshGrokNotifications(true);
  const read=f.api.handle({type:'grok:inbox'},f.sender);
  const result=await Promise.race([read,new Promise(resolve=>setTimeout(()=>resolve(null),100))]);
  blocked.release({});await refresh;
  assert.equal(result.events[0].id,'task1');
});

test('durable inbox still fans out while native connector is disconnected',async()=>{
  const f=worker();await f.api.deliverGrok();await turn();f.sent.length=0;
  f.update({installed:false});await f.api.deliverGrok(true);
  assert.deepEqual([...new Set(f.sent.map(x=>x.id))].sort(),[1,2]);
  assert.equal(f.sent[0].message.events[0].id,'task1');
});
