import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
export function extensionId(directory, platform = process.platform) {
  return [...createHash('sha256').update(directory, platform === 'win32' ? 'utf16le' : 'utf8').digest().subarray(0,16)]
    .map(b => String.fromCharCode(97 + (b >> 4), 97 + (b & 15))).join('');
}
export function platformPaths({ platform = process.platform, home = os.homedir(), local = process.env.LOCALAPPDATA, arch = process.arch } = {}) {
  if (platform === 'win32') { const base = path.win32.join(local || path.win32.join(home,'AppData','Local'), 'TrenchWhale'); return { platform, arch, base, data: path.win32.join(base,'GrokData'), curl: path.win32.join(process.env.SystemRoot || 'C:\\Windows','System32','curl.exe'), tunnel: 'cloudflared.exe', nullDevice: 'NUL' }; }
  if (platform === 'darwin' && ['arm64','x64'].includes(arch)) {
    const base = path.posix.join(home,'Library','Application Support','TrenchWhale');
    return { platform, arch, base, data: path.posix.join(base,'GrokData'), curl: '/usr/bin/curl', tunnel: 'cloudflared', nullDevice: '/dev/null',
      manifests: ['Google/Chrome','Microsoft Edge'].map(browser => path.posix.join(home,'Library','Application Support',browser,'NativeMessagingHosts')) };
  }
  throw new Error('连接组件目前支持 Windows 与 macOS（Apple Silicon / Intel）');
}
