const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');
const G=require('../extension/gmgn-connection.js'),F=require('../extension/finance-core.js'),Reader=require('../extension/gmgn-wallet-sync.js');
const A='0x'+'12'.repeat(20),B='0x'+'34'.repeat(20),S='So11111111111111111111111111111111111111112',HOUR=3600000;
const snap=(addresses,owner='a'.repeat(64),extra={})=>({owner,chains:{bsc:{addresses},...extra}});
function fixture(){
 const records=new Map(),calls=[];let clock=1800000000000,handler;
 const options={now:()=>clock,wait:async()=>{},store:{get:async k=>structuredClone(records.get(k)),set:async(k,v)=>records.set(k,structuredClone(v))},fetcher:async(url,init)=>{
  calls.push(url);if(handler)return handler(url,init);const u=new URL(url);
  return Response.json({code:0,data:init.body?{list:JSON.parse(init.body).wallet_addresses.map(wallet_address=>({wallet_address,realized_profit:'2'}))}:{balances:[{wallet_address:u.searchParams.get('wallet_address'),token_address:F.native(u.searchParams.get('chain')),balance:'1'}]}});
 }};
 return {service:G.create(options),options,records,calls,advance:n=>clock+=n,handler:fn=>handler=fn};
}
test('first click checks once; all tabs and a restarted worker share the exact one-hour gate',async()=>{
 const h=fixture();await h.service.save('fixture-key-12345',{bsc:[A]},'bsc');let reads=0;const read=async()=>{reads++;return snap([B]);};
 const results=await Promise.all(Array.from({length:20},()=>h.service.checkWallets(read,'bsc')));assert.equal(reads,1);assert(results.every(v=>v.changed));
 assert.deepEqual((await h.service.status()).manualWallets.chains.bsc.addresses,[B]);
 h.advance(HOUR-1);assert.equal((await G.create(h.options).checkWallets(read,'sol')).checked,false);assert.equal(reads,1);
 h.advance(1);await G.create(h.options).checkWallets(read,'bsc');assert.equal(reads,2);
});
test('add, delete and replace lists invalidate old amounts and reports; unchanged lists preserve the amount cooldown',async()=>{
 const h=fixture();await h.service.save('fixture-key-12345',{bsc:[A]},'bsc');await h.service.test();
 assert.equal((await h.service.peek('bsc')).balance,'1');
 await h.service.checkWallets(async()=>snap([A,B]),'bsc');assert.equal(await h.service.peek('bsc'),null);assert.equal(await h.service.report(),null);
 assert.equal((await h.service.finance('bsc')).balance,'2');
 h.advance(HOUR);await h.service.finance('bsc');const calls=h.calls.length;
 const unchanged=await h.service.checkWallets(async()=>snap([B,A]),'bsc');assert.equal(unchanged.changed,false);
 await h.service.finance('bsc');assert.equal(h.calls.length,calls);
 h.advance(HOUR);await h.service.checkWallets(async()=>snap([B]),'bsc');assert.deepEqual((await h.service.status()).manualWallets.chains.bsc.addresses,[B]);assert.equal(await h.service.peek('bsc'),null);
});
test('explicit empty chain clears it, missing chains survive, and another owner cannot retain prior account wallets',async()=>{
 const h=fixture();await h.service.save('fixture-key-12345',{bsc:[A],sol:[S]},'bsc');
 await h.service.checkWallets(async()=>snap([A]),'bsc');assert.deepEqual((await h.service.status()).manualWallets.chains.sol.addresses,[S]);
 h.advance(HOUR);await h.service.checkWallets(async()=>snap([],undefined,{sol:{addresses:[S]}}),'bsc');
 assert.equal((await h.service.finance('bsc')).balance,'0');assert.equal(h.calls.length,0);
 h.advance(HOUR);await h.service.checkWallets(async()=>snap([B],'b'.repeat(64)),'bsc');
 assert.deepEqual(Object.keys((await h.service.status()).manualWallets.chains),['bsc']);
});
test('unavailable and oversized lists preserve saved wallets and still consume the hour interval',async()=>{
 const h=fixture();await h.service.save('fixture-key-12345',{bsc:[A]},'bsc');let reads=0;
 await h.service.checkWallets(async()=>{reads++;throw Error('storage unavailable');},'bsc');
 await h.service.checkWallets(async()=>{reads++;return snap([B]);},'bsc');assert.equal(reads,1);
 assert.deepEqual((await h.service.status()).manualWallets.chains.bsc.addresses,[A]);
 h.advance(HOUR);const addresses=Array.from({length:21},(_,i)=>'0x'+(i+1).toString(16).padStart(40,'0'));
 await h.service.checkWallets(async()=>snap(addresses),'bsc');assert.deepEqual((await h.service.status()).manualWallets.chains.bsc.addresses,[A]);
 assert.equal((await h.service.status()).walletCheck.status,'unavailable');
});
test('manual edits made during discovery win over its late result',async()=>{
 const h=fixture();await h.service.save('fixture-key-12345',{bsc:[A]},'bsc');let release,entered;const start=new Promise(r=>entered=r);
 const pending=h.service.checkWallets(()=>{entered();return new Promise(r=>release=r);},'bsc');await start;
 await h.service.save('',{bsc:[B]},'bsc');release(snap([A]));assert.equal((await pending).changed,false);
 assert.deepEqual((await h.service.status()).manualWallets.chains.bsc.addresses,[B]);
});
test('wallet change cancels in-flight finance; late old-wallet amounts never return to cache',async()=>{
 const h=fixture();await h.service.save('fixture-key-12345',{bsc:[A]},'bsc');let entered,release;const start=new Promise(r=>entered=r);
 h.handler(()=>{entered();return new Promise(r=>release=r);});const query=h.service.finance('bsc');await start;const rejected=assert.rejects(query,/取消|变更/);
 await h.service.checkWallets(async()=>snap([B]),'bsc');release(Response.json({code:0,data:{list:[{wallet_address:A,realized_profit:'9000'}]}}));await rejected;
 assert.equal(await h.service.peek('bsc'),null);
});
test('reader uses only own-wallet key and strips unrelated fields before leaving the GMGN page',()=>{
 const raw=JSON.stringify({bsc:{list:[{address:A,user_id:'owner',private_key:'never-copy',balance:'1'}],archive_count:0},watchlist:{address:B}});
 const context={location:{protocol:'https:',hostname:'gmgn.ai'},localStorage:{getItem:key=>{assert.equal(key,'__multi_wallets_list_info__');return raw;}}};
 const value=vm.runInNewContext('('+Reader.pageWalletCache.toString()+')()',context);
 assert(!value.includes('private_key'));assert(!value.includes('never-copy'));assert.deepEqual(F.walletCache(value).chains.bsc.addresses,[A]);
 context.location.hostname='evilgmgn.ai';assert.equal(vm.runInNewContext('('+Reader.pageWalletCache.toString()+')()',context),null);
 assert.equal(F.walletCache(JSON.stringify({bsc:{list:[]}})),null,'An ownerless empty/loading cache is not proof that all wallets were deleted');
});
test('reader prefers the initiating GMGN tab, hashes owner IDs, and bounds suspended-page waits',async()=>{
 let target;const browser={tabs:{query:async()=>{throw Error('Should not inspect unrelated tabs');}},scripting:{executeScript:async args=>{target=args.target;return [{frameId:0,result:JSON.stringify({bsc:{list:[{address:A,user_id:'owner-id'}]}})}];}}};
 const result=await Reader.read({id:7,url:'https://gmgn.ai/?chain=bsc'},{browser});assert.equal(target.tabId,7);assert.deepEqual(target.frameIds,[0]);assert.match(result.owner,/^[a-f0-9]{64}$/);assert(!JSON.stringify(result).includes('owner-id'));
 browser.scripting.executeScript=()=>new Promise(()=>{});assert.equal(await Reader.read({id:7,url:'https://gmgn.ai/'},{browser,timeoutMs:15}),null);
});
