/* Durable, non-secret completion receipts. Native events are acknowledged only
 * after this inbox is saved; visibility of one tab never consumes another's copy. */
(function(root){
  'use strict';
  const KEY='grokNotificationInbox', MAX_AGE=7*24*60*60*1000;
  const READ_PREFIX='grokNotificationRead:';
  const terminal=new Set(['completed','failed','interrupted']);
  function create(storage, now=Date.now){
    let serial=Promise.resolve();
    const run=fn=>{const next=serial.then(fn,fn);serial=next.catch(()=>{});return next;};
    async function read(){const value=(await storage.get(KEY))[KEY];return value?.version===1&&Array.isArray(value.items)?{...value,revision:Number.isSafeInteger(value.revision)&&value.revision>=0?value.revision:0}:{version:1,revision:0,connectionId:'',items:[]};}
    function clean(event){
      if(!event||!terminal.has(event.status)||!/^[A-Za-z0-9_-]{1,128}$/.test(event.id||'')||!/^grokbot:\/\/app\/v1\/agent\?id=[A-Za-z0-9_-]{1,128}$/.test(event.botUrl||''))return null;
      const at=Number(event.finishedAt||event.createdAt);
      if(!Number.isFinite(at)||at<now()-MAX_AGE||at>now()+60000)return null;
      return {id:event.id,status:event.status,botUrl:event.botUrl,botName:String(event.botName||'Bot').slice(0,80),title:String(event.title||'项目研究').slice(0,90),summary:String(event.summary||'').slice(0,500),createdAt:Number(event.createdAt)||at,finishedAt:at,readAt:0};
    }
    const unread=data=>data.items.filter(item=>!item.readAt&&item.finishedAt>=now()-MAX_AGE).sort((a,b)=>b.finishedAt-a.finishedAt);
    const snapshot=data=>({revision:data.revision,connectionId:data.connectionId,events:unread(data)});
    async function flushReads(){
      const data=await read(), all=await storage.get(null), consumed=[];let changed=false;
      for(const [key,receipt] of Object.entries(all)){
        if(!key.startsWith(READ_PREFIX))continue;
        const id=key.slice(READ_PREFIX.length), at=Number(receipt?.readAt);
        if(!/^[A-Za-z0-9_-]{1,128}$/.test(id)||receipt?.id!==id||!Number.isFinite(at)||at<now()-MAX_AGE||at>now()+60000){consumed.push(key);continue;}
        const item=data.items.find(item=>item.id===id&&item.botUrl===receipt.botUrl&&item.status===receipt.status);
        if(!item)continue; // A valid click can arrive before native history ingestion.
        if(!item.readAt){item.readAt=at;changed=true;}
        consumed.push(key);
      }
      if(changed){data.revision++;await storage.set({[KEY]:data});}
      // Clear the outbox only after the authoritative inbox write succeeds.
      if(consumed.length)await storage.remove(consumed);
      return data;
    }
    async function merge(connectionId,events=[],history=[]){
      let data=await read();const before=JSON.stringify(data),revision=data.revision;
      if(data.connectionId!==connectionId)data={version:1,revision,connectionId,items:[]};
      const items=new Map(data.items.filter(item=>item.finishedAt>=now()-MAX_AGE).map(item=>[item.id,item]));
      for(const raw of [...history,...events]){const item=clean(raw);if(!item)continue;const previous=items.get(item.id);items.set(item.id,{...item,readAt:previous?.status===item.status?previous.readAt:0});}
      data.items=[...items.values()].sort((a,b)=>b.finishedAt-a.finishedAt).slice(0,100);
      if(JSON.stringify(data)!==before){data.revision=revision+1;await storage.set({[KEY]:data});}
      // Only receipts actually retained in durable storage may consume a native event.
      const receipts=events.filter(raw=>Number.isSafeInteger(raw?.seq)&&clean(raw)&&data.items.some(item=>item.id===raw.id&&item.status===raw.status&&item.botUrl===raw.botUrl))
        .map(raw=>({seq:raw.seq,id:raw.id,status:raw.status}));
      return {...snapshot(await flushReads()),receipts};
    }
    return {
      ingest(connectionId,events=[],history=[]){return run(async()=>{const result=await merge(connectionId,events,history);return result.events;});},
      ingestWithReceipts(connectionId,events=[],history=[]){return run(()=>merge(connectionId,events,history));},
      list(){return run(async()=>unread(await flushReads()));},
      snapshot(){return run(async()=>snapshot(await flushReads()));},
      flushReads(){return run(async()=>snapshot(await flushReads()));},
      markRead(id){return run(async()=>{const data=await read();const item=data.items.find(item=>item.id===id);if(item&&!item.readAt){item.readAt=now();data.revision++;await storage.set({[KEY]:data});}return unread(data);});},
      clear(){return run(async()=>{const data=await read();await storage.set({[KEY]:{version:1,revision:data.revision+1,connectionId:'',items:[]}});});}
    };
  }
  root.TrenchGrokInbox={create,READ_PREFIX};if(typeof module!=='undefined')module.exports=root.TrenchGrokInbox;
})(globalThis);
