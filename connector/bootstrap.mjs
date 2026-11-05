// Match the user's existing Windows network route. Never disable TLS verification.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { runPowerShell } from './platform.mjs';
import { macProxy } from './mac-platform.mjs';
const base = path.dirname(fileURLToPath(import.meta.url));
const env = { ...process.env };
if (!env.HTTPS_PROXY && !env.https_proxy) {
  try { const proxy = process.platform === 'darwin' ? await macProxy() : (await runPowerShell(path.join(base, 'network.ps1'), {}, 15000)).proxy; if (proxy) { env.HTTPS_PROXY = proxy; env.HTTP_PROXY ||= proxy; } } catch {}
}
env.NO_PROXY = [env.NO_PROXY || env.no_proxy || '', '127.0.0.1', 'localhost', '::1'].filter(Boolean).join(',');
const child = spawn(process.execPath, ['--use-env-proxy', path.join(base, 'host.mjs'), ...process.argv.slice(2)], { env, stdio: 'inherit', windowsHide: true });
child.on('error', () => process.exit(4)); child.on('exit', code => process.exit(code || 0));
process.on('SIGTERM', () => child.kill()); process.on('SIGINT', () => child.kill());
