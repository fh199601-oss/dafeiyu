import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { identityFile, grokIdentityDirectory, resolveGrokTarget } from '../connector/grok-identity.mjs';

const prefix = 'sand.client.slice.', slotKey = prefix + 'client-meta.account-slot';
const target = { id: 'wrong-id-from-model', name: '测试', routineName: '大肥鱼连接·ABC123', routineId: 'routine-only' };
async function fixture(t, slot = 'grok|user_fixture') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trench-grok-identity-'));
  t.after(async () => { if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('trench-grok-identity-')) throw Error('Unsafe cleanup path'); await fs.rm(directory, { recursive: true, force: true }); });
  const account = prefix + 'account.' + encodeURIComponent(slot) + '.';
  const write = async (key, schemaVersion, value) => { const spec = identityFile(key); await fs.writeFile(path.join(directory, spec.name), (spec.framed ? JSON.stringify(key) + '\n' : '') + JSON.stringify({ schemaVersion, value })); };
  await write(slotKey, 1, slot);
  await write(account + 'selection.last-agent', 1, { agentId: 'actual-selected-bot' });
  await write(account + 'roster.last-roster', 4, { rows: [{ id: 'actual-selected-bot', name: '测试' }, { id: 'same-name-other-bot', name: '测试' }] });
  return { directory, account, write, file: key => path.join(directory, identityFile(key).name), resolve: options => resolveGrokTarget(target, { directory, ...options }) };
}
test('Grok identity default paths are separate Windows and macOS user-data directories', () => {
  assert.equal(grokIdentityDirectory({ platform: 'win32', appData: 'C:\\Users\\测试\\AppData\\Roaming' }), 'C:\\Users\\测试\\AppData\\Roaming\\Grok Bot\\sand-client-persistence');
  assert.equal(grokIdentityDirectory({ platform: 'darwin', home: '/Users/测试' }), '/Users/测试/Library/Application Support/Grok Bot/sand-client-persistence');
  assert.throws(() => grokIdentityDirectory({ platform: 'linux' }), /暂时无法确认/);
});
test('identity file names match Grok lower-case base32 and frame long keys', () => {
  assert.deepEqual(identityFile('sand.client.slice.ui-layout'), { name: 'onqw4zbomnwgszlooqxhg3djmnss45ljfvwgc6lpov2a.blob', framed: false });
  const long = identityFile(prefix + 'account.' + 'x'.repeat(300) + '.selection.last-agent');
  assert.match(long.name, /^[a-z2-7]{52}\.kblob$/); assert.equal(long.framed, true);
  assert.throws(() => identityFile('../../credentials'), /暂时无法确认/);
});
test('currently selected official ID replaces model ID; same-name other Bot is never selected', async t => {
  const f = await fixture(t); const result = await f.resolve();
  assert.deepEqual(result, { ...target, id: 'actual-selected-bot' });
  assert.equal(target.id, 'wrong-id-from-model');
});
test('name mismatch, absent selected row and duplicate ID reject rather than matching by name', async t => {
  const f = await fixture(t);
  await f.write(f.account + 'roster.last-roster', 4, { rows: [{ id: 'actual-selected-bot', name: '另一个 Bot' }, { id: 'same-name-other-bot', name: target.name }] });
  await assert.rejects(f.resolve(), { code: 'GROK_IDENTITY_MISMATCH' });
  await f.write(f.account + 'roster.last-roster', 4, { rows: [{ id: 'same-name-other-bot', name: target.name }] });
  await assert.rejects(f.resolve(), { code: 'GROK_IDENTITY_UNAVAILABLE' });
  await f.write(f.account + 'roster.last-roster', 4, { rows: [{ id: 'actual-selected-bot', name: target.name }, { id: 'actual-selected-bot', name: target.name }] });
  await assert.rejects(f.resolve(), { code: 'GROK_IDENTITY_UNAVAILABLE' });
});
test('account and selection are reread; either mid-read switch rejects', async t => {
  for (const changingSlot of [true, false]) {
    const f = await fixture(t), watched = f.file(changingSlot ? slotKey : f.account + 'selection.last-agent'); let opens = 0;
    const io = { ...fs, open: async (file, mode) => {
      if (file === watched && ++opens === 2) await f.write(changingSlot ? slotKey : f.account + 'selection.last-agent', 1, changingSlot ? 'grok|another-account' : { agentId: 'same-name-other-bot' });
      return fs.open(file, mode);
    } };
    await assert.rejects(f.resolve({ io }), { code: 'GROK_IDENTITY_CHANGED' });
  }
});
test('missing or invalid metadata never falls back to the supplied ID or reveals raw errors', async t => {
  const f = await fixture(t);
  await fs.unlink(f.file(f.account + 'selection.last-agent'));
  await assert.rejects(f.resolve(), error => error.code === 'GROK_IDENTITY_UNAVAILABLE' && !error.message.includes(f.directory) && !error.message.includes('ENOENT'));
  await f.write(f.account + 'selection.last-agent', 2, { agentId: 'actual-selected-bot' });
  await assert.rejects(f.resolve(), { code: 'GROK_IDENTITY_UNAVAILABLE' });
  await fs.writeFile(f.file(f.account + 'selection.last-agent'), 'SENSITIVE_PARSE_CONTENT');
  await assert.rejects(f.resolve(), error => !error.message.includes('SENSITIVE') && !error.message.includes('JSON'));
});
test('only three exact metadata keys are opened; encoded slots cannot traverse directories', async t => {
  const f = await fixture(t, '../../a/b\\用户'), opened = [];
  const io = { ...fs, open: async (file, mode) => { opened.push(file); assert.equal(path.dirname(file), f.directory); assert.equal(mode, 'r'); return fs.open(file, mode); } };
  assert.equal((await f.resolve({ io })).id, 'actual-selected-bot');
  assert.equal(new Set(opened).size, 3); assert.equal(opened.length, 5);
});
test('long-key frame is supported and mismatched embedded key is rejected', async t => {
  const f = await fixture(t, 'grok|' + 'x'.repeat(180));
  assert.equal((await f.resolve()).id, 'actual-selected-bot');
  const file = f.file(f.account + 'selection.last-agent'); assert.ok(file.endsWith('.kblob'));
  await fs.writeFile(file, JSON.stringify('sand.wrong-key') + '\n' + JSON.stringify({ schemaVersion: 1, value: { agentId: 'actual-selected-bot' } }));
  await assert.rejects(f.resolve(), { code: 'GROK_IDENTITY_UNAVAILABLE' });
});
test('oversized, non-file and malformed shape metadata are refused before parsing', async t => {
  const f = await fixture(t), file = f.file(f.account + 'selection.last-agent');
  await fs.truncate(file, 8 * 1024 * 1024 + 1); await assert.rejects(f.resolve(), { code: 'GROK_IDENTITY_UNAVAILABLE' });
  await fs.unlink(file); await fs.mkdir(file); await assert.rejects(f.resolve(), { code: 'GROK_IDENTITY_UNAVAILABLE' });
  await fs.rmdir(file); await f.write(f.account + 'selection.last-agent', 1, []); await assert.rejects(f.resolve(), { code: 'GROK_IDENTITY_UNAVAILABLE' });
});
