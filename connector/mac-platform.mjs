import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export function runMac(binary, args, input = '', timeout = 60000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(binary, args, { stdio: ['pipe','pipe','pipe'] }); let out = '', error = '';
    const timer = setTimeout(() => { proc.kill(); reject(new Error('Mac 连接操作超时，请完成系统授权后重试')); }, timeout);
    proc.stdout.setEncoding('utf8').on('data', s => { out += s; }); proc.stderr.setEncoding('utf8').on('data', s => { error += s; });
    proc.stdin.on('error', () => {}); proc.stdin.end(input);
    proc.on('error', () => { clearTimeout(timer); reject(new Error('Mac 系统组件无法启动')); });
    proc.on('close', code => { clearTimeout(timer); resolve({ code, out, error }); });
  });
}
export function parseMacProxy(text) {
  const field = key => text.match(new RegExp('\\b' + key + '\\s*:\\s*([^\\r\\n]+)'))?.[1].trim();
  const protocol = field('HTTPSEnable') === '1' ? 'HTTPS' : field('HTTPEnable') === '1' ? 'HTTP' : '';
  if (!protocol) return '';
  const host = field(protocol + 'Proxy'), port = field(protocol + 'Port');
  if (!host || !/^\d{1,5}$/.test(port || '') || Number(port) > 65535 || Number(port) < 1 || /[\s/@?#]/.test(host)) return '';
  return `http://${host.includes(':') && !host.startsWith('[') ? '[' + host + ']' : host}:${port}`;
}
export async function macProxy() { const r = await runMac('/usr/sbin/scutil', ['--proxy'], '', 10000); return r.code === 0 ? parseMacProxy(r.out) : ''; }

export function keychainKey(account, execute = runMac) {
  if (!/^[a-p]{32}$/.test(account)) throw new Error('扩展标识无效');
  const service = 'com.trenchwhale.grok.storage'; let cached;
  return async create => {
    if (cached) return cached;
    const read = () => execute('/usr/bin/security', ['find-generic-password','-a',account,'-s',service,'-w']);
    let result = await read();
    if (result.code === 44 && create) {
      const value = randomBytes(32).toString('hex');
      // Interactive stdin keeps the encryption key out of the process argument list.
      await execute('/usr/bin/security', ['-i'], `add-generic-password -U -a ${account} -s ${service} -w ${value}\n`);
      result = await read();
      if (result.code || result.out.trim() !== value) throw new Error('无法保存到 Mac 钥匙串，请允许访问并重试');
    }
    if (result.code || !/^[a-f0-9]{64}$/.test(result.out.trim())) throw new Error('Mac 钥匙串暂不可用，请解锁并允许访问后重试');
    cached = Buffer.from(result.out.trim(), 'hex'); return cached;
  };
}
export function macStore(directory, getKey = keychainKey(path.basename(directory))) {
  const file = path.join(directory,'account.keychain');
  const aad = Buffer.from('TrenchWhale.GrokConnector.v1');
  return {
    async read() {
      let record; try { record = JSON.parse(await fs.readFile(file,'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw new Error('Mac 本机连接资料损坏，请清除后重新配对'); }
      try {
        const key = await getKey(false); if (record.version !== 1) throw new Error('version');
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv,'base64')); decipher.setAAD(aad); decipher.setAuthTag(Buffer.from(record.tag,'base64'));
        return JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.data,'base64')),decipher.final()]).toString('utf8'));
      } catch { throw new Error('无法解密 Mac 本机连接，请解锁钥匙串；仍失败时可清除后重新配对'); }
    },
    async write(value) {
      const key = await getKey(true), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm',key,iv); cipher.setAAD(aad);
      const data = Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
      const record = { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
      await fs.mkdir(directory,{recursive:true,mode:0o700}); await fs.writeFile(file+'.next',JSON.stringify(record),{mode:0o600}); await fs.rename(file+'.next',file);
    }
  };
}
export async function provisionMac(base, target) {
  const r = await runMac('/usr/bin/osascript',['-l','JavaScript',path.join(base,'grok-panel-mac.js')],JSON.stringify(target),75000);
  if (r.code !== 0) {
    const known = ['GROK_NOT_OPEN','ACCESS_REQUIRED','BOT_MISMATCH','ROUTINE_NOT_FOUND','ROUTINE_MISMATCH','KEY_NOT_VISIBLE'];
    const code = known.find(k => r.error.includes(k));
    throw new Error(({ GROK_NOT_OPEN:'请打开并登录 Grok Bot 桌面版，再点继续连接', ACCESS_REQUIRED:'请在 Mac 系统设置的隐私与安全性中，允许当前浏览器或连接组件的辅助功能／自动化访问，再点继续连接', BOT_MISMATCH:'请关闭 Grok Bot 设置弹窗，并切回配对的 Bot', ROUTINE_NOT_FOUND:'请在 Bot 详情打开本次大肥鱼连接例程，再点继续连接', ROUTINE_MISMATCH:'例程标识与配对信息不匹配，已停止读取。请重新生成配对话。', KEY_NOT_VISIBLE:'无法读取当前例程的连接信息，请保持例程面板打开后重试' })[code] || 'Mac Grok Bot 面板连接未完成，请保持桌面版打开并检查系统授权');
  }
  try { return JSON.parse(r.out.trim()); } catch { throw new Error('Mac 面板返回格式无效，请重试'); }
}
