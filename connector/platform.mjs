import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { platformPaths } from './os-support.mjs';
export function runPowerShell(script, input, timeout = 60_000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = ''; const timer = setTimeout(() => { proc.kill(); reject(new Error('Grok Bot 面板连接超时，请保持桌面版打开后重试')); }, timeout);
    proc.stdout.setEncoding('utf8').on('data', c => { out += c; }); proc.stderr.setEncoding('utf8').on('data', c => { err += c; });
    proc.on('error', e => { clearTimeout(timer); reject(e); }); proc.on('close', code => { clearTimeout(timer); if (code) reject(new Error(err.trim().slice(-250) || '无法连接 Grok Bot 面板')); else { try { resolve(JSON.parse(out.replace(/^\uFEFF/, ''))); } catch { reject(new Error('连接组件返回格式错误')); } } });
    proc.stdin.end(JSON.stringify(input));
  });
}
export function protectedStore(directory, scriptsRoot) {
  const file = path.join(directory, 'account.dpapi');
  return { async read() { let missing = 0; for (const candidate of [file, file + '.next']) { try { const encrypted = await fs.readFile(candidate, 'utf8'); return await runPowerShell(path.join(scriptsRoot, 'protect.ps1'), { operation: 'read', value: encrypted }); } catch (e) { if (e.code === 'ENOENT') missing++; } } if (missing === 2) return null; throw new Error('本机连接资料无法读取，请重新连接'); },
    async write(data) { await fs.mkdir(directory, { recursive: true }); const result = await runPowerShell(path.join(scriptsRoot, 'protect.ps1'), { operation: 'write', value: data });
      await fs.writeFile(file + '.next', result.encrypted, { mode: 0o600 });
      try { await fs.rename(file + '.next', file); }
      catch (e) { if (e.code !== 'EXDEV') throw new Error('本机连接资料保存失败，请检查磁盘空间');
        // Some redirected Windows profiles reject replace-by-rename. Keep the complete
        // encrypted next file until the copy succeeds, so interrupted writes recover.
        await fs.copyFile(file + '.next', file); await fs.unlink(file + '.next'); }
    } };
}
export function postWebhook(url, options) {
  // Windows curl follows the inherited system proxy route. Credentials go through
  // stdin, never the process command line or a temporary plaintext file.
  const quote = value => '"' + String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\r', '\\r').replaceAll('\n', '\\n').replaceAll('\t', '\\t') + '"';
  return new Promise((resolve, reject) => {
    const platform = platformPaths();
    const proc = spawn(platform.curl, ['--silent', '--show-error', '--max-time', '20', '--connect-timeout', '10', '--proto', '=https', '--request', 'POST', '--config', '-', '--output', platform.nullDevice, '--write-out', '%{http_code}'], { windowsHide: true, stdio: ['pipe','pipe','pipe'] });
    let code = ''; proc.stdout.on('data', data => { code += data.toString(); }); proc.stderr.resume();
    const abort = () => { proc.kill(); reject(new Error('Bot 请求未确认')); };
    options.signal?.addEventListener('abort', abort, { once: true });
    proc.on('error', () => reject(new Error('系统网络组件无法启动')));
    proc.on('close', exitCode => { options.signal?.removeEventListener('abort', abort); if (exitCode || !/^\d{3}$/.test(code)) reject(Object.assign(new Error('Bot 请求未确认'), { code: exitCode, status: code })); else resolve({ status: Number(code) }); });
    proc.stdin.on('error', () => {});
    proc.stdin.end(`url = ${quote(url)}\nheader = ${quote('Content-Type: application/json')}\nheader = ${quote('Authorization: ' + options.headers.Authorization)}\ndata-binary = ${quote(options.body)}\n`);
  });
}
export function createTransport(binary, onRequest, onState = () => {}) {
  let server, child, address = '', pending, healthy = false;
  const healthPath = '/health/' + randomBytes(32).toString('hex');
  async function ensure() {
    if (address && child && !child.killed && healthy) return address;
    if (pending) return pending;
    pending = (async () => {
      if (!server) { server = http.createServer((req, res) => { if (req.url === healthPath && req.method === 'POST') { req.resume(); res.writeHead(204, { 'Cache-Control': 'no-store' }); res.end(); } else onRequest(req, res); }); server.requestTimeout = 15_000; await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); }
      if (child && !child.killed) child.kill(); address = ''; healthy = false;
      return await new Promise((resolve, reject) => {
        let log = '', checking = false; const current = spawn(binary, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${server.address().port}`, '--protocol', 'http2'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); child = current;
        const timer = setTimeout(() => { current.kill(); reject(new Error('网络通道未建立，请检查网络后重试')); }, 45_000);
        const data = chunk => { if (child !== current) return; log = (log + chunk.toString()).slice(-40_000); const match = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/); if (match) address = match[0];
          if (address && log.includes('Registered tunnel connection') && !checking) { checking = true;
            (async () => {
              // A registered tunnel can precede its DNS/TLS route by a few seconds.
              // Hand out a pairing sentence only after a real round trip succeeds.
              for (let i = 0; i < 10 && child === current && !current.killed; i++) {
                try { const response = await postWebhook(address + healthPath, { headers: { Authorization: '' }, body: '{}', signal: AbortSignal.timeout(5000) });
                  if (response.status === 204) { healthy = true; clearTimeout(timer); resolve(address); onState(); return; }
                } catch {} await new Promise(r => setTimeout(r, 1500));
              }
              current.kill(); reject(new Error('回传通道还未就绪，请检查网络后重试'));
            })().catch(() => { current.kill(); reject(new Error('网络通道检测失败，请重试')); });
          } };
        current.stdout.on('data', data); current.stderr.on('data', data);
        current.on('error', () => { clearTimeout(timer); reject(new Error('网络连接组件无法启动')); });
        current.on('close', () => { clearTimeout(timer); if (child === current) { child = null; healthy = false; address = ''; onState(); } reject(new Error('网络通道已关闭，请重试')); });
      });
    })().finally(() => { pending = null; }); return pending;
  }
  return { ensure, status: () => healthy ? 'online' : pending ? 'connecting' : 'offline', async stop() { if (child) child.kill(); child = null; address = ''; healthy = false; if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); server = null; } } };
}
