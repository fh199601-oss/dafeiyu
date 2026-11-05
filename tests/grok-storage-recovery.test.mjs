import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Engine} from '../connector/engine.mjs';
const connection={id:'prior-bot',name:'Prior Bot',generation:'prior-pair',webhookUrl:'https://api.cursor.com/webhook/prior',webhookKey:'fixture-only-key'};
const post={url:'https://x.com/fixture/status/123',text:'Fixture project',author:'Fixture'};
function fixture({badProvision=false}={}){
 let persisted={connection,tasks:[{id:'old-task',postUrl:'https://x.com/fixture/status/1',title:'Previous project',botId:connection.id,botName:connection.name,generation:connection.generation,status:'completed',createdAt:Date.now()-1000,finishedAt:Date.now()}],events:[],nextSeq:1},failWrites=0;
 const sent=[];
 const engine=new Engine({store:{read:async()=>structuredClone(persisted),write:async data=>{if(failWrites>0){failWrites--;throw Error('fixture disk temporarily busy');}persisted=structuredClone(data);}},transport:{ensure:async()=> 'https://fixture.trycloudflare.com'},provision:async()=>({url:'https://api.cursor.com/webhook/new',key:'new-fixture-key',...(badProvision?{}:{botId:'new-bot'})}),fetcher:async(_url,options)=>{sent.push(JSON.parse(options.body));return {status:200};}});
 return {engine,sent,read:()=>persisted,failNextWrite:()=>{failWrites++;}};
}
test('a malformed new pairing cannot erase the already-connected Bot task history',async()=>{
 const f=fixture({badProvision:true});await f.engine.init();const p={stage:'connecting',target:{id:'guessed',name:'New Bot'}};f.engine.pair=p;
 await f.engine.finishPair(p);
 assert.equal(f.engine.status().bot.id,'prior-bot');assert.equal(f.engine.status().tasks.length,1);assert.equal(f.read().tasks.length,1);
});
test('retrying a completion after failed storage must actually persist the completed state',async()=>{
 const f=fixture();await f.engine.init();const {task}=await f.engine.submit(post),key=new URL(f.sent[0].callback_url).pathname.split('/').at(-1);
 const {publicationToken}=await f.engine.complete(key,{taskId:task.id,status:'report_ready',summary:'Ready',report:`━━━━━━━━ 项目研究 · #${task.id.slice(0,8)} ━━━━━━━━\n这是完整的存储恢复测试报告，不涉及真实项目、资产或投资建议。\n━━━━ 本报告结束 ━━━━`});
 const completion={taskId:task.id,status:'completed',summary:'Ready',publicationToken,publication:{method:'SendToUser',acknowledged:true,taskId:task.id}};
 f.failNextWrite();await assert.rejects(f.engine.complete(key,completion),/temporarily busy/);
 assert.equal(f.read().tasks.at(-1).status,'publishing');
 const reply=await f.engine.complete(key,completion);
 assert.equal(reply.duplicate,true);assert.equal(f.read().tasks.at(-1).status,'completed');assert.equal(f.engine.status().events.filter(e=>e.id===task.id).length,1);
});
