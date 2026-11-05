import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine} from '../connector/engine.mjs';

const connection={id:'completion-bot',name:'Fixture Bot',generation:'fixture-generation',webhookUrl:'https://api.cursor.com/webhook/fixture',webhookKey:'fixture-not-real'};
const post={url:'https://x.com/fixture/status/98765',author:'fixture',text:'Research this fixture project'};
function fixture(options={}) {
 let saved={connection,tasks:[],events:[],nextSeq:1},failWrites=0,writeGate=null;const sent=[],emitted=[];
 const engine=new Engine({
  store:{read:async()=>structuredClone(saved),write:async data=>{if(writeGate)await writeGate;if(failWrites-->0)throw Error('fixture save failed');saved=structuredClone(data);}},
  transport:{ensure:async()=> 'https://fixture.trycloudflare.com'},provision:async()=>{},
  fetcher:async(url,opts)=>{sent.push(JSON.parse(opts.body));return options.fetcher?options.fetcher(url,opts):{status:200};},
  emit:event=>emitted.push(structuredClone(event))
 });
 return {engine,sent,emitted,saved:()=>saved,failWrite:()=>{failWrites=1;},holdWrite:()=>{let release;writeGate=new Promise(r=>{release=r;});return()=>{writeGate=null;release();};}};
}
const report=id=>`━━━━━━━━ 项目研究 · #${id.slice(0,8)} ━━━━━━━━\n测试项目｜测试网络\n项目资料不足，需要核实来源与市场热度。测试不涉及任何真实资产建议。\n━━━━ 本报告结束 ━━━━`;
async function submitted(f){await f.engine.init();const {task}=await f.engine.submit(post);return{task,key:new URL(f.sent[0].callback_url).pathname.split('/').at(-1)};}
const confirmed=(id,publicationToken)=>({taskId:id,status:'completed',summary:'报告已发送',publicationToken,publication:{method:'SendToUser',acknowledged:true,taskId:id}});

test('a model completed callback without a publication receipt never creates a completion notification',async()=>{
 const f=fixture(),{task,key}=await submitted(f);
 await assert.rejects(f.engine.complete(key,{taskId:task.id,status:'completed',summary:'我做完了'}),e=>e.code==='REPORT_NOT_PUBLISHED');
 assert.equal(f.engine.status().tasks[0].status,'publishing');assert.equal(f.engine.status().events.length,0);
 assert.ok(f.emitted.every(e=>e.state.events.length===0));
});

test('report staging and delayed publication stay quiet until a matching sequential send receipt arrives',async()=>{
 const f=fixture(),{task,key}=await submitted(f);
 const staged=await f.engine.complete(key,{taskId:task.id,status:'report_ready',summary:'已生成',report:report(task.id)});
 assert.equal(staged.status,'publishing');assert.equal(staged.publicationToken.length,64);
 assert.equal(f.engine.status().events.length,0);assert.equal(f.engine.status().tasks[0].finishedAt,undefined);
 await assert.rejects(f.engine.complete(key,confirmed(task.id,'wrong-token')),e=>e.code==='REPORT_NOT_PUBLISHED');
 const wrongTask=confirmed(task.id,staged.publicationToken);wrongTask.publication.taskId='other-task';
 await assert.rejects(f.engine.complete(key,wrongTask),e=>e.code==='REPORT_NOT_PUBLISHED');
 assert.equal(f.engine.status().events.length,0);
 await f.engine.complete(key,confirmed(task.id,staged.publicationToken));
 await f.engine.complete(key,confirmed(task.id,staged.publicationToken));
 assert.equal(f.engine.status().tasks[0].status,'completed');assert.equal(f.engine.status().events.length,1);
 assert.equal(f.saved().tasks[0].report,report(task.id));
 const publicState=JSON.stringify(f.engine.status());assert.ok(!publicState.includes(staged.publicationToken));assert.ok(!publicState.includes('测试不涉及任何真实资产建议'));
});

test('staging retries reuse their token; a different staged report invalidates an older send receipt',async()=>{
 const f=fixture(),{task,key}=await submitted(f);
 const input={taskId:task.id,status:'report_ready',summary:'Ready',report:report(task.id)};
 const a=await f.engine.complete(key,input),b=await f.engine.complete(key,input);assert.equal(a.publicationToken,b.publicationToken);
 const c=await f.engine.complete(key,{...input,report:input.report+'\n来源补充'});assert.notEqual(a.publicationToken,c.publicationToken);
 await assert.rejects(f.engine.complete(key,confirmed(task.id,a.publicationToken)),e=>e.code==='REPORT_NOT_PUBLISHED');
});

test('wrong-project and incomplete staged reports cannot be acknowledged as published',async()=>{
 const f=fixture(),{task,key}=await submitted(f);
 await assert.rejects(f.engine.complete(key,{taskId:task.id,status:'report_ready',summary:'Wrong',report:report('other-task-id')}));
 await assert.rejects(f.engine.complete(key,{taskId:task.id,status:'report_ready',summary:'Partial',report:report(task.id).replace('本报告结束','继续生成中')}));
 assert.equal(f.engine.status().tasks[0].status,'accepted');assert.equal(f.engine.status().events.length,0);
});

test('completion is emitted after durable save and a save-failure retry restores delivery exactly once',async()=>{
 const f=fixture(),{task,key}=await submitted(f);
 const {publicationToken}=await f.engine.complete(key,{taskId:task.id,status:'report_ready',summary:'Ready',report:report(task.id)});
 f.emitted.length=0;f.failWrite();await assert.rejects(f.engine.complete(key,confirmed(task.id,publicationToken)),/save failed/);
 assert.equal(f.emitted.length,0);assert.equal(f.saved().tasks[0].status,'publishing');
 assert.equal(f.engine.status().tasks[0].status,'publishing');assert.equal(f.engine.status().events.length,0);
 await f.engine.complete(key,confirmed(task.id,publicationToken));
 assert.equal(f.saved().tasks[0].status,'completed');assert.equal(f.emitted.length,1);assert.equal(f.engine.status().events.length,1);
});

test('native status polling and history cannot observe completion while its durable write is pending',async()=>{
 const f=fixture(),{task,key}=await submitted(f);
 const {publicationToken}=await f.engine.complete(key,{taskId:task.id,status:'report_ready',summary:'Ready',report:report(task.id)});
 f.emitted.length=0;const release=f.holdWrite(),completion=f.engine.complete(key,confirmed(task.id,publicationToken));
 await new Promise(r=>setTimeout(r,0));
 assert.equal(f.engine.status().tasks[0].status,'publishing');assert.equal(f.engine.status().tasks[0].finishedAt,undefined);
 assert.equal(f.engine.status().events.length,0);assert.equal(f.emitted.length,0);
 release();await completion;
 assert.equal(f.engine.status().tasks[0].status,'completed');assert.equal(f.engine.status().events.length,1);
 assert.equal(f.saved().tasks[0].status,'completed');assert.equal(f.emitted.length,1);
});

test('concurrent repeated clicks share the sending promise and receive the confirmed accepted state',async()=>{
 let finish;const f=fixture({fetcher:()=>new Promise(r=>{finish=r;})});await f.engine.init();
 const a=f.engine.submit(post),b=f.engine.submit(post);let duplicateSettled=false;b.then(()=>{duplicateSettled=true;});
 while(!finish)await new Promise(r=>setTimeout(r,0));assert.equal(duplicateSettled,false);assert.equal(f.sent.length,1);
 finish({status:200});const [first,second]=await Promise.all([a,b]);
 assert.equal(first.task.status,'accepted');assert.equal(second.task.status,'accepted');assert.equal(second.duplicate,true);assert.equal(first.task.id,second.task.id);
});

test('explicit failure can still notify without claiming a published report',async()=>{
 const f=fixture(),{task,key}=await submitted(f);
 await f.engine.complete(key,{taskId:task.id,status:'failed',summary:'Fixture source unavailable'});
 assert.equal(f.engine.status().events[0].status,'failed');
});
