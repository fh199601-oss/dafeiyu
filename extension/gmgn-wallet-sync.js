/* Click-triggered reads of GMGN's own-wallet cache. No timers or API credentials. */
(function(root){
 'use strict';
 const F=root.TrenchFinance||(typeof require==='function'?require('./finance-core.js'):null);
 function pageWalletCache(){
  if(location.protocol!=='https:'||!['gmgn.ai','www.gmgn.ai'].includes(location.hostname))return null;
  try{
   const raw=localStorage.getItem('__multi_wallets_list_info__');
   if(!raw||raw.length>2*1024*1024)return null;
   const data=JSON.parse(raw);if(!data||typeof data!=='object'||Array.isArray(data))return null;
   const groups={};
   for(const [chain,group] of Object.entries(data)){
    if(!/^[a-z][a-z0-9_-]{1,23}$/.test(chain)||!Array.isArray(group?.list))continue;
    if(group.list.length>100||Object.keys(groups).length>=30)return null;
    groups[chain]={list:group.list.map(row=>({address:row?.address,user_id:row?.user_id})),archive_count:group.archive_count};
   }
   return JSON.stringify(groups);
  }catch{return null;}
 }
 async function read(sourceTab,{browser=root.chrome,timeoutMs=1800}={}){
  let timer;
  const task=(async()=>{
   let tab=sourceTab;
   if(!F.context(tab?.url)||!Number.isInteger(tab?.id)){
    const tabs=await browser.tabs.query({url:['https://gmgn.ai/*','https://www.gmgn.ai/*']});
    tab=tabs.filter(t=>!t.discarded&&F.context(t.url)).sort((a,b)=>Number(b.active)-Number(a.active)||(b.lastAccessed||0)-(a.lastAccessed||0))[0];
   }
   if(!tab||tab.discarded)return null;
   const results=await browser.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},world:'ISOLATED',func:pageWalletCache});
   const parsed=F.walletCache(results.find(item=>item.frameId===0)?.result);if(!parsed)return null;
   const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(parsed.owner));
   return {chains:parsed.chains,owner:[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('')};
  })().catch(()=>null);
  try{return await Promise.race([task,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),timeoutMs);})]);}
  finally{clearTimeout(timer);}
 }
 root.TrenchGmgnWalletSync={read,pageWalletCache};
 if(typeof module!=='undefined')module.exports=root.TrenchGmgnWalletSync;
})(globalThis);
