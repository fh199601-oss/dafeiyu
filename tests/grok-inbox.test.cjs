const {test}=require('node:test');const assert=require('node:assert/strict');const {create}=require('../extension/grok-inbox.js');
const now=()=>1700000000000;
const event=(id='task1',status='completed')=>({id,status,botName:'测试',botUrl:'grokbot://app/v1/agent?id=bot1',title:'项目研究',summary:'完成',createdAt:now()-2000,finishedAt:now()-1000});
function storage(){const data={};return {data,async get(k){return k===null?structuredClone(data):{[k]:structuredClone(data[k])};},async set(v){Object.assign(data,structuredClone(v));},async remove(k){for(const key of Array.isArray(k)?k:[k])delete data[key];}};}
test('durable inbox backfills acknowledged completions and deduplicates native/history receipts',async()=>{const s=storage(),inbox=create(s,now);assert.equal((await inbox.ingest('c',[event()],[event()])).length,1);assert.equal((await create(s,now).list()).length,1);});
test('one explicit read persists across reload, new callback, and history backfill',async()=>{const s=storage(),a=create(s,now);await a.ingest('c',[event()]);await a.markRead('task1');const b=create(s,now);assert.deepEqual(await b.ingest('c',[event()],[event()]),[]);});
test('storage failure propagates so the caller cannot acknowledge a lost native completion',async()=>{const s=storage();s.set=async()=>{throw Error('disk full');};await assert.rejects(create(s,now).ingest('c',[event()]),/disk full/);});
test('different pairing drops stale inbox; expired and unsafe destinations are excluded',async()=>{const a=create(storage(),now);await a.ingest('old',[event()]);const old={...event('old'),finishedAt:now()-8*86400000};assert.deepEqual(await a.ingest('new',[old,{...event('bad'),botUrl:'https://evil.test'},event('pending','accepted')]),[]);});
test('concurrent read and ingestion preserve a read receipt and keep other pages unread',async()=>{const a=create(storage(),now);await a.ingest('c',[event()]);await Promise.all([a.markRead('task1'),a.ingest('c',[event(),event('task2')])]);assert.deepEqual((await a.list()).map(e=>e.id),['task2']);});
test('revision is durable and monotonic across read, clear, re-pair, and worker restart',async()=>{
  const s=storage(),a=create(s,now);assert.equal((await a.snapshot()).revision,0);
  await a.ingest('first',[event()]);const initial=(await a.snapshot()).revision;
  await a.ingest('first',[event()],[event()]);assert.equal((await a.snapshot()).revision,initial);
  await a.markRead('task1');const read=(await a.snapshot()).revision;assert.ok(read>initial);
  await a.clear();const cleared=await a.snapshot();assert.ok(cleared.revision>read);assert.deepEqual(cleared.events,[]);
  const restarted=create(s,now);await restarted.ingest('second',[event('task2')]);
  const paired=await restarted.snapshot();assert.ok(paired.revision>cleared.revision);assert.equal(paired.connectionId,'second');
});
test('only valid native events whose receipt is stored can be acknowledged, including already-read receipts',async()=>{
  const a=create(storage(),now),valid={...event(),seq:1};
  const unsafe={...event('unsafe'),seq:2,botUrl:'https://unsafe.test/'};
  const saved=await a.ingestWithReceipts('c',[valid,unsafe]);assert.deepEqual(saved.receipts,[{seq:1,id:'task1',status:'completed'}]);
  await a.markRead('task1');const duplicate=await a.ingestWithReceipts('c',[valid]);assert.deepEqual(duplicate.events,[]);assert.equal(duplicate.receipts.length,1);
});

const receiptKey=id=>'grokNotificationRead:'+id;
const intent=(e=event())=>({id:e.id,status:e.status,botUrl:e.botUrl,readAt:now()});
test('durable read outbox repairs a lost click message across worker restart and native replay',async()=>{
 const s=storage(),a=create(s,now);await a.ingest('c',[event(),event('task2')]);
 await s.set({[receiptKey('task1')]:intent()});
 const restarted=create(s,now);assert.deepEqual((await restarted.snapshot()).events.map(e=>e.id),['task2']);
 assert.equal(s.data[receiptKey('task1')],undefined);
 assert.equal(s.data.grokNotificationInbox.items.find(e=>e.id==='task1').readAt,now());
 assert.deepEqual((await restarted.ingest('c',[event()],[event()])).map(e=>e.id),['task2']);
});
test('failed inbox write retains the durable click intent until a successful retry',async()=>{
 const s=storage(),a=create(s,now);await a.ingest('c',[event()]);await s.set({[receiptKey('task1')]:intent()});
 const write=s.set;s.set=async()=>{throw Error('disk temporarily unavailable');};
 await assert.rejects(a.flushReads(),/disk temporarily/);assert(s.data[receiptKey('task1')]);assert.equal(s.data.grokNotificationInbox.items[0].readAt,0);
 s.set=write;assert.equal((await create(s,now).snapshot()).events.length,0);assert.equal(s.data[receiptKey('task1')],undefined);
});
test('simultaneous page closes retain separate intents and do not consume a different Bot message',async()=>{
 const s=storage(),a=create(s,now);await a.ingest('c',[event('a'),event('b'),event('c')]);
 await Promise.all([s.set({[receiptKey('a')]:intent(event('a'))}),s.set({[receiptKey('b')]:intent(event('b'))})]);
 await s.set({[receiptKey('c')]:{...intent(event('c')),botUrl:'grokbot://app/v1/agent?id=unrelated'}});
 assert.deepEqual((await a.snapshot()).events.map(e=>e.id),['c']);
});
test('an intent arriving before notification ingestion suppresses that later notification',async()=>{
 const s=storage(),a=create(s,now);await s.set({[receiptKey('task1')]:intent()});
 assert.deepEqual((await a.snapshot()).events,[]);assert(s.data[receiptKey('task1')]);
 assert.deepEqual(await a.ingest('c',[event()]),[]);assert.equal(s.data[receiptKey('task1')],undefined);
});
