import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

const PREFIX = 'sand.client.slice.';
const MAX_BYTES = 8 * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const errors = {
  unavailable: '暂时无法确认当前 Bot。请保持 Grok Bot 打开，选中要连接的 Bot，稍等后点“继续连接”。',
  mismatch: 'Grok Bot 当前会话与配对的 Bot 不一致。请切回配对的 Bot，再点“继续连接”。',
  changed: '读取期间切换了 Grok Bot 账户或会话。请选中要连接的 Bot 后再点“继续连接”。'
};
function fail(kind) { const error = new Error(errors[kind]); error.code = 'GROK_IDENTITY_' + kind.toUpperCase(); return error; }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function base32(bytes) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'; let result = '', bits = 0, value = 0;
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { bits -= 5; result += alphabet[(value >>> bits) & 31]; } }
  return result + (bits ? alphabet[(value << (5 - bits)) & 31] : '');
}
// Grok Bot 0.78.1's client-persistence format: an exact key, never a path from input.
export function identityFile(key) {
  if (typeof key !== 'string' || !key.startsWith(PREFIX) || key.length > 5000) throw fail('unavailable');
  const bytes = Buffer.from(key, 'utf8'), direct = base32(bytes) + '.blob';
  return direct.length <= 240 ? { name: direct, framed: false } : { name: base32(createHash('sha256').update(bytes).digest()) + '.kblob', framed: true };
}
export function grokIdentityDirectory({ platform = process.platform, appData = process.env.APPDATA, home = os.homedir() } = {}) {
  if (platform === 'win32' && typeof appData === 'string' && path.win32.isAbsolute(appData)) return path.win32.join(appData, 'Grok Bot', 'sand-client-persistence');
  if (platform === 'darwin' && typeof home === 'string' && path.posix.isAbsolute(home)) return path.posix.join(home, 'Library', 'Application Support', 'Grok Bot', 'sand-client-persistence');
  throw fail('unavailable');
}
async function readSlice(directory, key, schemaVersion, io) {
  const item = identityFile(key), file = path.join(directory, item.name);
  const link = await io.lstat(file);
  if (!link.isFile() || link.isSymbolicLink() || link.size < 1 || link.size > MAX_BYTES) throw fail('unavailable');
  const handle = await io.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BYTES) throw fail('unavailable');
    const bytes = Buffer.alloc(Math.min(MAX_BYTES + 1, stat.size + 1)); let offset = 0;
    while (offset < bytes.length) { const read = await handle.read(bytes, offset, bytes.length - offset, offset); if (!read.bytesRead) break; offset += read.bytesRead; }
    // An atomic replacement is safe; a growing/partial write is not a snapshot.
    if (offset !== stat.size) throw fail('unavailable');
    let text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset));
    if (item.framed) { const line = text.indexOf('\n'); if (line < 0 || JSON.parse(text.slice(0, line)) !== key) throw fail('unavailable'); text = text.slice(line + 1); }
    const data = JSON.parse(text);
    if (!record(data) || data.schemaVersion !== schemaVersion || !Object.hasOwn(data, 'value')) throw fail('unavailable');
    return data.value;
  } finally { await handle.close(); }
}

export async function resolveGrokTarget(target, options = {}) {
  try {
    if (!record(target) || typeof target.name !== 'string' || !target.name.trim() || target.name.length > 200) throw fail('unavailable');
    const directory = options.directory || grokIdentityDirectory(options), io = options.io || fs;
    if (!path.isAbsolute(directory)) throw fail('unavailable');
    const slotKey = PREFIX + 'client-meta.account-slot';
    const slot = await readSlice(directory, slotKey, 1, io);
    if (typeof slot !== 'string' || !slot || slot.length > 512 || /[\x00-\x1f\x7f]/.test(slot)) throw fail('unavailable');
    const account = PREFIX + 'account.' + encodeURIComponent(slot) + '.';
    const selectionKey = account + 'selection.last-agent';
    const selected = await readSlice(directory, selectionKey, 1, io);
    if (!record(selected) || !ID.test(selected.agentId || '')) throw fail('unavailable');
    const roster = await readSlice(directory, account + 'roster.last-roster', 4, io);
    if (!record(roster) || !Array.isArray(roster.rows)) throw fail('unavailable');
    // Only the currently selected ID can match. Never find another Bot by name.
    const rows = roster.rows.filter(row => record(row) && row.id === selected.agentId);
    if (rows.length !== 1 || typeof rows[0].name !== 'string') throw fail('unavailable');
    if (rows[0].name !== target.name) throw fail('mismatch');
    const again = await readSlice(directory, selectionKey, 1, io);
    const slotAgain = await readSlice(directory, slotKey, 1, io);
    if (slotAgain !== slot || !record(again) || again.agentId !== selected.agentId) throw fail('changed');
    return { ...target, id: rows[0].id, name: rows[0].name };
  } catch (error) {
    // No paths, account slots, roster contents or underlying parse errors escape.
    if (Object.values(errors).includes(error?.message) && /^GROK_IDENTITY_/.test(error.code || '')) throw error;
    throw fail('unavailable');
  }
}
