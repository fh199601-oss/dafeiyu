const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../extension/core.js');

test('settings recover from missing values and constrain off-screen / excessive input', () => {
  assert.equal(C.sanitizeSettings(null).enabled, true);
  const a = C.sanitizeSettings({ size: 999, position: { x: -1, y: 4 }, sound: 'false', energy: 'unknown' });
  assert.equal(a.size, 280); assert.deepEqual(a.position, { x: 0, y: 1 }); assert.equal(a.sound, false); assert.equal(a.energy, 'gentle');
  const b = C.patchSettings(a, { sound: true }); assert.equal(b.size, 280); assert.equal(b.sound, true);
});
test('site exclusions include subdomains without matching suffix lookalikes', () => {
  const settings = C.sanitizeSettings({ excludedSites: ['https://GMGN.AI/trade', 'gmgn.ai', ''] });
  assert.deepEqual(settings.excludedSites, ['gmgn.ai']);
  assert.equal(C.isExcluded('www.gmgn.ai', settings.excludedSites), true);
  assert.equal(C.isExcluded('evilgmgn.ai', settings.excludedSites), false);
  assert.equal(C.allowedPage('chrome://extensions'), false);
  assert.equal(C.allowedPage('https://chromewebstore.google.com/detail/test'), false);
});
test('position survives resize and is clamped to the visible viewport', () => {
  const original = C.placement({ x: .4, y: .8 }, 1440, 900, 180);
  const saved = C.normalizedPosition(original.x, original.y, original);
  assert.ok(Math.abs(saved.x - .4) < 1e-8); assert.ok(Math.abs(saved.y - .8) < 1e-8);
  const small = C.placement(saved, 320, 300, 280);
  assert.ok(small.x >= 12); assert.ok(small.x + small.size <= 308); assert.ok(small.y + small.size <= 278);
});
test('BSC and Solana validations differ and base58 is checked as 32 bytes', () => {
  assert.equal(C.validateAddress('bsc', '0x' + '12'.repeat(20)), true);
  assert.equal(C.validateAddress('bsc', '0x1234'), false);
  assert.equal(C.validateAddress('solana', '11111111111111111111111111111111'), true);
  assert.equal(C.validateAddress('solana', 'So11111111111111111111111111111111111111112'), true);
  assert.equal(C.validateAddress('solana', '0'.repeat(44)), false);
  assert.equal(C.validateAddress('solana', 'z'.repeat(44)), false);
  assert.equal(C.validateAddress('eth', '0x' + '12'.repeat(20)), false);
});
test('wallet duplicates are case-insensitive on BSC but preserve Solana addresses', () => {
  const wallets = C.sanitizeWallets([
    { id: '1', chain: 'bsc', address: '0x' + 'ab'.repeat(20), label: '<script>label</script>' },
    { id: '2', chain: 'bsc', address: '0x' + 'AB'.repeat(20) },
    { id: '3', chain: 'solana', address: '11111111111111111111111111111111', kind: 'self' },
    { id: '4', chain: 'bsc', address: 'bad' }
  ]);
  assert.equal(wallets.length, 2); assert.equal(wallets[1].kind, 'self');
});
test('all demonstration events remain explicitly demo, including both chains', () => {
  for (const chain of ['bsc', 'solana']) for (const action of Object.keys(C.ACTIONS)) {
    const event = C.demoEvent(action, chain); assert.equal(event.source, 'demo'); assert.equal(event.chain, chain); assert.equal(event.action, action);
  }
  assert.throws(() => C.demoEvent('transfer')); assert.equal(Object.keys(C.ACTIONS).length, 12);
});

test('X research uses a safe three-click default and persists only one to five clicks',()=>{
 assert.equal(C.sanitizeSettings({clickMode:'auto',clickX:'grok'}).xResearchClicks,3);
 for(const count of [1,2,3,4,5]){
  const settings=C.patchSettings({}, {xResearchClicks:String(count)});assert.equal(settings.xResearchClicks,count);
  assert.equal(C.patchSettings(settings,{sound:true}).xResearchClicks,count);
 }
 for(const invalid of [0,6,-1,2.5,null,true,'bad',Infinity])assert.equal(C.sanitizeSettings({xResearchClicks:invalid}).xResearchClicks,3);
});

test('new installs route clicks by website instead of sharing a global GMGN action',()=>{
 const s=C.sanitizeSettings();
 assert.equal(s.clickMode,'auto');
 for(const [url,action] of [['https://gmgn.ai/?chain=bsc','gmgn'],['https://www.binance.com/en','binance'],['https://x.com/a/status/1','companion'],['https://example.com/','companion'],['https://gmgn.ai.fake.test/','companion']])assert.equal(C.clickAction(s,url),action);
});

test('legacy global GMGN is corrected once while website choices and explicit new fixed modes survive',()=>{
 const s=C.upgradeSettings({clickMode:'gmgn',clickX:'grok',size:220,excludedSites:['example.com'],xResearchClicks:4});
 assert.equal(s.clickMode,'auto');assert.equal(s.clickX,'grok');assert.equal(s.size,220);assert.equal(s.xResearchClicks,4);assert.deepEqual(s.excludedSites,['example.com']);
 assert.equal(C.upgradeSettings(s).clickMode,'auto');
 const fixed=C.patchSettings(s,{clickMode:'gmgn'});assert.equal(C.upgradeSettings(fixed).clickMode,'gmgn');
 assert.equal(C.clickAction(fixed,'https://www.binance.com/'),'gmgn');
 for(const mode of ['binance','companion','auto'])assert.equal(C.upgradeSettings({clickMode:mode}).clickMode,mode);
});
