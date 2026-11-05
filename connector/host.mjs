import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine, VERSION } from './engine.mjs';
import { protectedStore, createTransport, runPowerShell, postWebhook } from './platform.mjs';
import { platformPaths } from './os-support.mjs';
import { macStore, provisionMac } from './mac-platform.mjs';
import { resolveGrokTarget } from './grok-identity.mjs';
const base = path.dirname(fileURLToPath(import.meta.url));
const origin = process.argv[2];
if (!/^chrome-extension:\/\/[a-p]{32}\/$/.test(origin || '')) process.exit(2);
const config = JSON.parse(await fs.readFile(path.join(base, 'native-host.json'), 'utf8'));
if (!config.allowed_origins.includes(origin)) process.exit(2);
const platform = platformPaths();
const directory = path.join(platform.data, origin.split('/')[2]);
await fs.mkdir(directory, { recursive: true });
const lock = path.join(directory, 'host.lock');
try { const handle = await fs.open(lock, 'wx'); await handle.writeFile(String(process.pid)); await handle.close(); }
catch { let running = false; try { const pid = Number(await fs.readFile(lock, 'utf8')); if (pid > 0) { process.kill(pid, 0); running = true; } } catch {}
  if (running) process.exit(3); await fs.writeFile(lock, String(process.pid)); }
function send(data) { const bytes = Buffer.from(JSON.stringify(data)); const size = Buffer.alloc(4); size.writeUInt32LE(bytes.length); process.stdout.write(Buffer.concat([size, bytes])); }
let engine;
const transport = createTransport(path.join(base, 'bin', platform.tunnel), async (req, res) => {
  const reply = (status, value, mime = 'application/json; charset=utf-8') => { res.writeHead(status, { 'Content-Type': mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(mime.startsWith('application/json') ? JSON.stringify(value) : value); };
  try {
    if (req.headers.origin) return reply(403, { error: 'Browser origins are not allowed' });
    const url = new URL(req.url, 'http://localhost');
    const match = url.pathname.match(/^\/(setup|pair|result)\/([a-f0-9]{64})$/);
    if (!match) return reply(404, {});
    if (match[1] === 'setup' && req.method === 'GET') { const value = engine.setup(match[2]); return value ? reply(200, value, 'text/plain; charset=utf-8') : reply(410, { error: 'Pairing expired' }); }
    if (req.method !== 'POST') return reply(405, {});
    const chunks = []; let length = 0; for await (const chunk of req) { length += chunk.length; if (length > 16_384) return reply(413, {}); chunks.push(chunk); }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (match[1] === 'pair') return reply(200, await engine.register(match[2], body));
    if (match[1] === 'result') return reply(200, await engine.complete(match[2], body));
    reply(404, {});
  } catch (error) { if (!res.headersSent) error?.code === 'REPORT_NOT_PUBLISHED' ? reply(409, { ok: false, error: error.code, status: 'publishing', instruction: error.message }) : reply(400, { error: 'Invalid or expired request' }); }
}, () => { if (engine) send({ type: 'state', state: engine.status() }); });
async function provisionSelectedBot(target) {
  const verified = await resolveGrokTarget(target);
  const credentials = platform.platform === 'darwin' ? await provisionMac(base, verified) : await runPowerShell(path.join(base, 'grok-panel.ps1'), verified);
  const after = await resolveGrokTarget(verified);
  if (after.id !== verified.id) throw new Error('连接期间切换了 Bot，请切回配对的 Bot 后重试');
  return { ...credentials, botId: verified.id };
}
engine = new Engine({ store: platform.platform === 'darwin' ? macStore(directory) : protectedStore(directory, base), transport, fetcher: postWebhook, provision: provisionSelectedBot, emit: send });
let readyError = '';
try { await engine.init(); } catch (e) { readyError = e.message; }
send({ type: 'state', state: { ...engine.status(), storageError: readyError } });
async function handle(msg) {
  if (!msg || !Number.isSafeInteger(msg.id)) return;
  try {
    if (readyError && !['status', 'disconnect'].includes(msg.action)) throw new Error(readyError);
    let result;
    switch (msg.action) {
      case 'status': result = { ...engine.status(), storageError: readyError }; break;
      case 'pair': result = await engine.beginPair(); break;
      case 'pair-retry': result = await engine.retryPair(); break;
      case 'pair-cancel': result = engine.cancelPair(); break;
      case 'disconnect': result = await engine.disconnect(); readyError = ''; break;
      case 'submit': result = await engine.submit(msg.post || {}); break;
      case 'ack': result = await engine.ack(msg.seq); break;
      default: throw new Error('不支持的连接操作');
    }
    send({ id: msg.id, ok: true, result });
  } catch (e) { send({ id: msg.id, ok: false, error: String(e.message || '连接失败').slice(0, 300) }); }
}
let buffer = Buffer.alloc(0), closing = false;
process.stdin.on('data', chunk => { buffer = Buffer.concat([buffer, chunk]); while (buffer.length >= 4) { const size = buffer.readUInt32LE(); if (size > 131_072) { shutdown(); return; } if (buffer.length < size + 4) break;
  const frame = buffer.subarray(4, size + 4); buffer = buffer.subarray(size + 4); try { handle(JSON.parse(frame)).catch(() => {}); } catch {} } });
async function shutdown() { if (closing) return; closing = true; await engine.saves.catch(() => {}); await transport.stop();
  try { if ((await fs.readFile(lock, 'utf8')) === String(process.pid)) await fs.unlink(lock); } catch {} process.exit(0); }
process.stdin.on('end', shutdown); process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
