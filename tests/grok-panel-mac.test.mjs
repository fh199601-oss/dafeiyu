import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../connector/grok-panel-mac.js', import.meta.url), 'utf8');
const target = { id: 'verified-bot-id', name: '测试', routineId: 'official-routine-id', routineName: '大肥鱼连接·ABC123' };

function fixture(options = {}) {
  const calls = [], navigations = [];
  let mode = options.mode || 'panel', bot = options.bot || target.name, revealed = false, keyReads = 0, elapsed = 0;
  const url = options.url || 'https://api.cursor.com/automations/webhook/' + target.routineId;
  function node(name, role = 'AXStaticText', attrs = {}, action) {
    return {
      name: () => name, role: () => role, description: () => '', uiElements: () => [],
      attributes: { byName: key => ({ value: () => {
        if (name === 'Webhook 密钥' && key === 'AXValue') keyReads++;
        return typeof attrs[key] === 'function' ? attrs[key]() : attrs[key] || '';
      } }) },
      actions: { byName: () => ({ perform: () => {
        if (!action || options.denyPress) throw Error('denied');
        calls.push(name); action();
      } }) },
      click: () => { throw Error('denied'); }
    };
  }
  function nodes() {
    if (options.denyAccess) throw Error('access denied');
    const result = [node(bot, 'AXHeading', { AXIdentifier: 'sand-conversation-heading' })];
    if (mode === 'entry') {
      const entry = () => node('打开例行任务 ' + target.routineName, 'AXButton', {}, () => { mode = options.entryDirect ? 'panel' : 'list'; });
      result.push(entry()); if (options.duplicate) result.push(entry());
    }
    if (mode === 'list') result.push(node(target.routineName + ' 当 Webhook 被触发时', 'AXButton', {}, () => { mode = 'panel'; }));
    if (mode === 'panel') {
      result.push(node(target.routineName), node('Webhook URL', 'AXTextField', { AXPlaceholderValue: '加载中…', AXValue: () => elapsed < (options.urlReadyAfter || 0) ? '' : url }));
      if (!revealed) result.push(node('显示Webhook 密钥', 'AXButton', {}, () => { revealed = true; if(options.switchOnReveal) bot = '另一个 Bot'; }));
      else result.push(node('隐藏Webhook 密钥', 'AXButton', {}, () => { revealed = false; }));
      result.push(node('Webhook 密钥', 'AXTextField', { AXValue: () => revealed ? 'fixture-secret' : '••••' }));
    }
    return result;
  }
  const proc = { windows: [{ uiElements: nodes }], attributes: { byName: () => ({}) }, frontmost: false };
  function Application() { return { applicationProcesses: { whose: () => () => [proc] } }; }
  Application.currentApplication = () => ({ openLocation: location => {
    navigations.push(location);
    if (location.includes('/agent?')) { bot = target.name; mode = 'entry'; }
    if (location.includes('/sidebar?')) mode = 'list';
  } });
  const $ = { NSFileHandle: { fileHandleWithStandardInput: { readDataToEndOfFile: '{}' } }, NSString: { alloc: { initWithDataEncoding: () => JSON.stringify(target) } }, NSUTF8StringEncoding: 4 };
  const context = vm.createContext({ $, ObjC: { import: () => {}, unwrap: value => value }, Application, delay: seconds => { elapsed += seconds; if(options.switchWhileWaiting)bot='另一个 Bot'; } });
  vm.runInContext(source, context);
  return { run: () => JSON.parse(context.run()), calls, navigations, get keyReads() { return keyReads; }, get revealed() { return revealed; }, get elapsed() { return elapsed; } };
}

test('Mac preserves an already open matching routine without navigating and hides its key afterward', () => {
  const f = fixture();
  assert.deepEqual(f.run(), { url: 'https://api.cursor.com/automations/webhook/official-routine-id', key: 'fixture-secret' });
  assert.deepEqual(f.navigations, []);
  assert.deepEqual(f.calls, ['显示Webhook 密钥', '隐藏Webhook 密钥']);
  assert.equal(f.revealed, false);
});

test('Mac uses the selected conversation entry, then its one routine row, instead of a deep link', () => {
  const f = fixture({ mode: 'entry' }); f.run();
  assert.deepEqual(f.navigations, []);
  assert.deepEqual(f.calls.slice(0, 2), ['打开例行任务 大肥鱼连接·ABC123', '大肥鱼连接·ABC123 当 Webhook 被触发时']);
  const direct = fixture({ mode: 'entry', entryDirect: true }); direct.run();
  assert.equal(direct.calls.filter(name => name.startsWith('大肥鱼连接')).length, 0);
});

test('Mac falls back only when necessary, using the host-verified Bot ID', () => {
  const f = fixture({ mode: 'empty' }); f.run();
  assert.deepEqual(f.navigations, ['grokbot://app/v1/sidebar?agent=verified-bot-id&tab=routines']);
  const other = fixture({ mode: 'empty', bot: '其他' }); other.run();
  assert.deepEqual(other.navigations, ['grokbot://app/v1/agent?id=verified-bot-id']);
});

test('Mac rejects duplicate pairing entries rather than selecting an arbitrary routine', () => {
  const f = fixture({ mode: 'entry', duplicate: true });
  assert.throws(() => f.run(), /ROUTINE_NOT_FOUND/);
  assert.equal(f.calls.length, 0); assert.equal(f.keyReads, 0);
});

test('Mac verifies the routine ID and official endpoint before showing or reading any key', () => {
  for (const url of [
    'https://api.cursor.com/automations/webhook/another-routine',
    'https://api.cursor.com.evil.test/automations/webhook/official-routine-id',
    'https://user@api.cursor.com/automations/webhook/official-routine-id',
    'http://api.cursor.com/automations/webhook/official-routine-id',
    'https://api.cursor.com/automations/webhook/official-routine-id/../another-routine'
  ]) {
    const f = fixture({ url }); assert.throws(() => f.run(), /ROUTINE_MISMATCH/);
    assert.equal(f.calls.length, 0); assert.equal(f.keyReads, 0);
  }
});

test('Mac stops when the selected Bot changes during reveal and still hides the revealed key', () => {
  const f = fixture({ switchOnReveal: true });
  assert.throws(() => f.run(), /ROUTINE_MISMATCH/);
  assert.equal(f.keyReads, 0); assert.equal(f.revealed, false);
});

test('Mac access and AXPress failures remain explicit system authorization errors', () => {
  for (const options of [{ denyAccess: true }, { mode: 'entry', denyPress: true }]) {
    const f = fixture(options); assert.throws(() => f.run(), /ACCESS_REQUIRED/); assert.equal(f.keyReads, 0);
  }
});

test('Mac waits for an initially empty URL input, then verifies its loaded value before revealing the key', () => {
  const f=fixture({ urlReadyAfter:1.5, url:'https://api2.cursor.sh/automations/webhook/official-routine-id' });
  assert.equal(f.run().url,'https://api2.cursor.sh/automations/webhook/official-routine-id');
  assert.equal(f.elapsed,1.5); assert.equal(f.keyReads,1); assert.equal(f.revealed,false);
  const timeout=fixture({ urlReadyAfter:4 });
  assert.throws(()=>timeout.run(),/ROUTINE_NOT_FOUND/);
  assert.equal(timeout.elapsed,3); assert.equal(timeout.keyReads,0); assert.equal(timeout.calls.length,0);
});

test('Mac does not retry a nonempty incorrect URL and stops if the Bot changes while waiting', () => {
  const wrong=fixture({ url:'https://api2.cursor.sh/automations/webhook/wrong-routine' });
  assert.throws(()=>wrong.run(),/ROUTINE_MISMATCH/); assert.equal(wrong.elapsed,0); assert.equal(wrong.keyReads,0);
  const switched=fixture({urlReadyAfter:1,switchWhileWaiting:true});
  assert.throws(()=>switched.run(),/ROUTINE_MISMATCH/); assert.equal(switched.elapsed,0.5); assert.equal(switched.keyReads,0);
});
