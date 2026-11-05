import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../extension/installers/locate-mac.js', import.meta.url), 'utf8'), context);
const locator = context.MacInstallerLocator;
const id = 'abcdefghijklmnopabcdefghijklmnop';
const home = '/Users/测试 用户';
const standard = home + '/Library/Application Support/Google/Chrome';
const packageRoot = home + "/Downloads/鲸鱼 '安装包' $(do-not-run)";
const manifest = { name: '大肥鱼', manifest_version: 3 };
const installer = '一键安装AI连接组件-Mac.command';

function fakeIo({ root = standard, profile = 'Default', prefs = 'Preferences', entry = { path: packageRoot + '/extension', state: 1 }, extra = {}, missing = [] } = {}) {
  const json = {
    [root + '/' + profile + '/' + prefs]: { extensions: { settings: { [id]: entry } } },
    [packageRoot + '/extension/manifest.json']: manifest,
    ...extra
  };
  const files = [packageRoot + '/connector/install-mac.mjs', packageRoot + '/' + installer].filter(p => !missing.includes(p));
  return {
    canonical: p => p.replace(/\/$/, ''),
    children: p => p === root ? [profile] : [],
    readJson: p => json[p] || null,
    isFile: p => files.includes(p)
  };
}

test('user-data-dir parses equals, separate arguments, quoting, escaped spaces and flattened ps output', () => {
  for (const arg of [
    '--user-data-dir="/Users/me/My Profile" --no-first-run',
    "--user-data-dir '/Users/me/My Profile' --no-first-run",
    '"--user-data-dir=/Users/me/My Profile" --no-first-run',
    '--user-data-dir=/Users/me/My Profile --no-first-run',
    '--user-data-dir=/Users/me/My\\ Profile --no-first-run'
  ]) assert.equal(locator.userDataDir('Chrome ' + arg), '/Users/me/My Profile', arg);
  assert.equal(locator.userDataDir("Chrome --user-data-dir=/Users/O'Reilly/Profile"), "/Users/O'Reilly/Profile");
  assert.equal(locator.userDataDir('Chrome --user-data-dir=relative'), null);
  assert.equal(locator.userDataDir('Chrome --user-data-dir="/unfinished'), null);
});

test('process discovery accepts only main Chrome, Edge and Chrome for Testing executables', () => {
  const processes = [
    { executable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', command: 'Chrome --user-data-dir=/Users/me/Chrome Space --no-first-run' },
    { executable: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', command: 'Edge --user-data-dir "/Users/me/Edge Space"' },
    { executable: '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', command: 'Chrome --user-data-dir=/Users/me/Testing' },
    { executable: '/usr/bin/echo', command: '/usr/bin/echo /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/evil' },
    { executable: '/Applications/Google Chrome.app/Contents/Frameworks/Helpers/Google Chrome Helper', command: 'Helper --user-data-dir=/helper' }
  ];
  assert.deepEqual(Array.from(locator.browserRoots(processes)), ['/Users/me/Chrome Space', '/Users/me/Edge Space', '/Users/me/Testing']);
  const parsed = locator.browserProcesses(' 123 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n 456 /usr/bin/echo\n bad /Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  assert.deepEqual(Array.from(parsed, p => p.pid), ['123']);
});

test('standard profile locates exact package including Unicode, spaces and shell punctuation', () => {
  for (const name of ['大肥鱼', '战壕精灵 · 蓝鲸娘']) {
    assert.equal(locator.locatePackage(id, home, '', fakeIo({ extra: {
      [packageRoot + '/extension/manifest.json']: { ...manifest, name }
    } })), packageRoot);
  }
});

test('custom directory and arbitrary profile name can locate Secure Preferences', () => {
  const root = '/Volumes/Work Space/Chrome Data';
  const processes = [{ executable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', command: 'Chrome --user-data-dir="' + root + '"' }];
  assert.equal(locator.locatePackage(id, home, processes, fakeIo({ root, profile: '交易专用', prefs: 'Secure Preferences' })), packageRoot);
});

test('wrong extension, disabled entry, wrong product and incomplete package never run', () => {
  assert.throws(() => locator.locatePackage('x'.repeat(32), home, '', fakeIo()), /标识无效/);
  assert.throws(() => locator.locatePackage(id, home, '', fakeIo({ entry: { path: packageRoot + '/extension', state: 0 } })), /没有找到/);
  assert.throws(() => locator.locatePackage(id, home, '', fakeIo({ extra: { [packageRoot + '/extension/manifest.json']: { ...manifest, name: 'Other extension' } } })), /文件不齐/);
  assert.throws(() => locator.locatePackage(id, home, '', fakeIo({ missing: [packageRoot + '/' + installer] })), /文件不齐/);
  assert.throws(() => locator.locatePackage(id, home, '', fakeIo({ entry: { path: 'Extensions/' + id, state: 1 } })), /没有找到/);
});

test('ambiguous matching installations are rejected rather than picking an old package', () => {
  const second = '/Users/me/Old copy';
  const io = fakeIo({ extra: {
    [standard + '/Default/Secure Preferences']: { extensions: { settings: { [id]: { path: second + '/extension', state: 1 } } } },
    [second + '/extension/manifest.json']: manifest
  } });
  const originalIsFile = io.isFile;
  io.isFile = p => originalIsFile(p) || [second + '/connector/install-mac.mjs', second + '/' + installer].includes(p);
  assert.throws(() => locator.locatePackage(id, home, '', io), /多个/);
});

test('template invokes only the fixed original installer with a quoted path', () => {
  const text = fs.readFileSync(new URL('../extension/installers/launch-mac.command.template', import.meta.url), 'utf8');
  assert.match(text, /extension_id='__EXTENSION_ID__'/);
  assert.match(text, /'__LOCATOR_BASE64__'/);
  assert.match(text, /\/bin\/bash "\$installer"/);
  assert.match(text, /installer="\$package_root\/一键安装AI连接组件-Mac\.command"/);
  assert.doesNotMatch(text, /\beval\b|\bxattr\b|\bsudo\b|C:\\Users|\/Users\/10043/);
});
