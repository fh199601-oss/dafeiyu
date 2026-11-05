const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(){
 const messages=[],timers=[];let listener;
 const chrome={runtime:{connectNative:()=>({onMessage:{addListener:fn=>{listener=fn;}},onDisconnect:{addListener(){}},postMessage:msg=>messages.push(msg)})},alarms:{onAlarm:{addListener(){}},create(){},clear:async()=>{}},storage:{local:{get:async()=>({}),set:async()=>{},remove:async()=>{}}}};
 const scope={chrome,setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout(){}};vm.createContext(scope);vm.runInContext(fs.readFileSync('extension/grok-connection.js','utf8'),scope);
 return {api:scope.TrenchGrok.create(),messages,timers,reply:msg=>listener(msg)};
}
test('status callers share one bounded native request, then the next refresh reads new state',async()=>{
 const f=fixture(),a=f.api.status(),b=f.api.status();assert.equal(a,b);assert.equal(f.messages.length,1);assert.equal(f.timers[0].ms,12000);
 f.reply({id:f.messages[0].id,ok:true,result:{configured:true,tasks:[],events:[]}});assert.equal((await a).installed,true);await b;
 const next=f.api.status();assert.equal(f.messages.length,2);f.reply({id:f.messages[1].id,ok:true,result:{configured:true,tasks:[{status:'completed'}],events:[]}});assert.equal((await next).tasks[0].status,'completed');
});
test('a timed-out status request releases the coalescing slot without shortening submit timeout',async()=>{
 const f=fixture(),pending=f.api.status();f.timers[0].fn();await pending;
 const next=f.api.status();assert.equal(f.messages.length,2);f.reply({id:f.messages[1].id,ok:true,result:{configured:false}});await next;
 const sent=f.api.call('submit',{});assert.equal(f.timers.at(-1).ms,75000);f.reply({id:f.messages.at(-1).id,ok:true,result:{task:{status:'accepted'}}});await sent;
});
