import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Engine, postUrl, webhookUrl } from '../connector/engine.mjs';
const tick = () => new Promise(r => setTimeout(r, 0));
function fixture(overrides = {}) {
  let saved, calls = [], timestamp = Date.now();
  const engine = new Engine({ store: { read: async () => saved, write: async d => { saved = structuredClone(d); } }, transport: { ensure: async () => 'https://fresh-session.trycloudflare.com', status: () => 'online', stop: async () => {} }, provision: async target => ({ botId: target.id, url: 'https://api.cursor.com/webhook/fixture', key: 'test-only-secret' }), fetcher: async (u, o) => { calls.push(JSON.parse(o.body)); return { status: 200 }; }, now: () => timestamp, ...overrides });
  return { engine, calls, advance: t => { timestamp += t; }, saved: () => saved };
}
async function pair(f) {
  await f.engine.beginPair(); const p = f.engine.pair;
  await f.engine.register(p.secret, { botId: randomUUID(), botName: '全新测试 Bot', routineId: randomUUID(), routineName: `大肥鱼连接·${p.code}` });
  await tick(); await f.engine.saves; assert.equal(f.engine.status().configured, true);
}
const post = { url: 'https://x.com/fixture/status/123/photo/1?s=1', text: '请研究一个项目', author: '@fixture' };
async function published(f,key,id,summary) {
  const report=`━━━━━━━━ 项目研究 · #${id.slice(0,8)} ━━━━━━━━\n这是用于确认完整报告发布流程的测试内容，不涉及真实投资或项目。\n━━━━ 本报告结束 ━━━━`;
  const {publicationToken}=await f.engine.complete(key,{taskId:id,status:'report_ready',summary,report});
  return f.engine.complete(key,{taskId:id,status:'completed',summary,publicationToken,publication:{method:'SendToUser',acknowledged:true,taskId:id}});
}
test('pairing is fresh, single-use, expiring, and exposes no webhook secrets', async () => {
  const f = fixture(); await f.engine.init(); const a = await f.engine.beginPair(), secret = f.engine.pair.secret;
  assert.match(a.prompt, /\/setup\/[a-f0-9]{64}/); assert.ok(f.engine.setup(secret));
  await f.engine.beginPair(); assert.equal(f.engine.setup(secret), null); f.advance(21 * 60_000); assert.equal(f.engine.setup(f.engine.pair.secret), null);
  await pair(f); assert.equal(f.engine.setup(f.engine.pair.secret), null);
  const status = JSON.stringify(f.engine.status()); assert.ok(!status.includes('test-only-secret')); assert.ok(!status.includes('api.cursor.com'));
});
test('late pairing result cannot restore a cancelled or disconnected connection', async () => {
  let finish; const f = fixture({ provision: () => new Promise(r => { finish = r; }) });
  await f.engine.beginPair(); const p = f.engine.pair;
  await f.engine.register(p.secret, { botId: randomUUID(), botName: '取消测试', routineId: 'fresh-routine', routineName: `大肥鱼连接·${p.code}` });
  await f.engine.disconnect(); finish({ url: 'https://api.cursor.com/webhook/fixture', key: 'never-restored' }); await tick();
  assert.equal(f.engine.status().configured, false);
});
test('selected-post task is deduplicated; only its authenticated completion creates one notification', async () => {
  const f = fixture(); await pair(f);
  const a = await f.engine.submit(post), b = await f.engine.submit(post);
  assert.equal(a.task.id, b.task.id); assert.equal(b.duplicate, true); assert.equal(f.calls.length, 1);
  assert.equal(f.engine.status().events.length, 0); assert.equal(f.calls[0].post.url, 'https://x.com/fixture/status/123');
  const secret = f.calls[0].callback_url.split('/').pop(); assert.equal(secret.length, 64);
  await assert.rejects(f.engine.complete('bad', { taskId: a.task.id }));
  await assert.rejects(f.engine.complete(secret, { taskId: 'other', status: 'completed', summary: 'bad' }));
  await published(f,secret,a.task.id,'报告已在当前 Bot');
  await f.engine.complete(secret, { taskId: a.task.id, status: 'completed', summary: '重复' });
  assert.equal(f.engine.status().events.length, 1); const e = f.engine.status().events[0];
  assert.equal(e.botUrl, a.task.botUrl); await f.engine.ack(e.seq); assert.equal(f.engine.status().events.length, 0);
});
test('timeout is uncertain and repeated clicks do not resend; callback may still complete it', async () => {
  let payload; const f = fixture({ fetcher: async (_u, o) => { payload = JSON.parse(o.body); throw new Error('Timeout'); } }); await pair(f);
  const a = await f.engine.submit(post); assert.equal(a.task.status, 'uncertain'); assert.equal((await f.engine.submit(post)).duplicate, true);
  await published(f,payload.callback_url.split('/').pop(),a.task.id,'迟到结果');
  assert.equal(f.engine.status().tasks[0].status, 'completed');
});
test('restart records interruption without replaying a task; re-pair invalidates old callbacks', async () => {
  const f = fixture(); await pair(f); const a = await f.engine.submit(post); const secret = f.calls[0].callback_url.split('/').pop();
  const restarted = fixture({ store: { read: async () => f.saved(), write: async () => {} } }); await restarted.engine.init();
  assert.equal(restarted.engine.status().tasks[0].status, 'interrupted'); assert.equal(restarted.calls.length, 0); assert.equal(restarted.engine.status().configured, true);
  await pair(f); await assert.rejects(f.engine.complete(secret, { taskId: a.task.id, status: 'completed', summary: '旧连接' })); assert.equal(f.engine.status().tasks.length, 0);
});
test('unsafe destinations and missing posts are rejected; failed tunnel can start new pairing', async () => {
  assert.equal(webhookUrl('https://cursor.com.evil.test/webhook'), ''); assert.equal(webhookUrl('http://api.cursor.com/webhook'), ''); assert.equal(webhookUrl('https://user:pass@api.cursor.com/webhook'), '');
  assert.equal(postUrl('https://x.com.evil.test/a/status/1'), '');
  const f = fixture({ transport: { ensure: async () => { throw new Error('offline'); } } }); await assert.rejects(f.engine.beginPair()); assert.equal(f.engine.pair, null);
  const ok = fixture(); await pair(ok); await assert.rejects(ok.engine.submit({ url: post.url }));
});
test('X status aliases identify the same task and credentialed URLs are rejected', async () => {
  assert.equal(postUrl('https://twitter.com/Fixture/status/123?s=2'), 'https://x.com/fixture/status/123');
  assert.equal(postUrl('https://x.com/i/web/status/123'), 'https://x.com/i/status/123');
  assert.equal(postUrl('https://user:pass@x.com/fixture/status/123'), '');
  assert.equal(postUrl('https://x.com:444/fixture/status/123'), '');
  const f = fixture(); await pair(f);
  const first = await f.engine.submit(post);
  const alias = await f.engine.submit({ ...post, url: 'https://x.com/i/web/status/123' });
  assert.equal(alias.duplicate, true); assert.equal(alias.task.id, first.task.id); assert.equal(f.calls.length, 1);
});
test('pairing stores and links to the locally verified Bot ID, never the guessed callback ID', async () => {
  const verifiedId=randomUUID();
  const f=fixture({provision:async()=>({botId:verifiedId,url:'https://api2.cursor.sh/automations/webhook/fixture',key:'verified-fixture-key'})});
  await pair(f);
  assert.equal(f.saved().connection.id,verifiedId);
  assert.equal(f.engine.status().bot.url,`grokbot://app/v1/agent?id=${verifiedId}`);
  const task=await f.engine.submit(post);assert.equal(task.task.botUrl,f.engine.status().bot.url);
});
test('a provision result without a verified Bot ID never completes pairing', async () => {
  const f=fixture({provision:async()=>({url:'https://api2.cursor.sh/automations/webhook/fixture',key:'unverified-fixture-key'})});
  await f.engine.beginPair();const p=f.engine.pair;
  await f.engine.register(p.secret,{botId:'guessed',botName:'Test',routineId:'routine',routineName:`大肥鱼连接·${p.code}`});
  await tick();assert.equal(f.engine.status().configured,false);assert.equal(f.engine.status().pair.stage,'needs-attention');
});
test('already paired Bots receive the one-message, separated report contract on every task', async()=>{
  const f=fixture();await pair(f);const result=await f.engine.submit(post),body=f.calls[0];
  assert.match(body.report_instructions,/只在当前 Bot 对话发布一条完整报告/);
  assert.match(body.report_instructions,/350–550/);assert.match(body.report_instructions,/本报告结束/);
  assert.ok(body.report_instructions.includes(result.task.id.slice(0,8)));
  assert.ok(!body.report_instructions.includes(post.text));assert.equal(body.post.text,post.text);
  assert.match(body.report_instructions,/报告成功发布后/);assert.match(body.callback_url,/\/result\/[a-f0-9]{64}$/);
});
