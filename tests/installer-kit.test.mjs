import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const kit = require('../extension/installer-kit.js');
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const locatorPath = fileURLToPath(new URL('../extension/installers/locate-windows.ps1', import.meta.url));
const macLocator = fs.readFileSync(new URL('../extension/installers/locate-mac.js', import.meta.url), 'utf8');
const macTemplate = fs.readFileSync(new URL('../extension/installers/launch-mac.command.template', import.meta.url), 'utf8');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trench-installer-test-'));
let fixtureNumber = 0;

test.after(() => {
  // Only this test's newly created, verified temporary directory can be removed.
  const resolved = path.resolve(temporaryRoot);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.match(path.basename(resolved), /^trench-installer-test-/);
  fs.rmSync(resolved, { recursive: true, force: true });
});

function tempCase(name) {
  const directory = path.join(temporaryRoot, `${++fixtureNumber}-${name}`);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function powershellQuote(value) {
  return "'" + value.replaceAll("'", "''") + "'";
}

function runPowerShell(script, directory) {
  const harness = path.join(directory, 'test-harness.ps1');
  fs.writeFileSync(harness, '\ufeff' + script, 'utf8');
  return spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harness], {
    cwd: directory,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20_000
  });
}

function writePackage(directory, name = '大肥鱼') {
  const extension = path.join(directory, 'extension');
  const connector = path.join(directory, 'connector');
  fs.mkdirSync(extension, { recursive: true });
  fs.mkdirSync(connector, { recursive: true });
  fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify({ name, manifest_version: 3 }), 'utf8');
  fs.writeFileSync(path.join(connector, 'install.ps1'), '# Isolated fixture. Never installs a real connector.\n', 'utf8');
  fs.writeFileSync(path.join(directory, '一键安装AI连接组件.cmd'), '@exit /b 0\r\n', 'utf8');
  return extension;
}

function writePreferences(browserRoot, profile, filename, entryPath, id = extensionId) {
  const directory = path.join(browserRoot, profile);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, filename), JSON.stringify({ extensions: { settings: { [id]: { path: entryPath, state: 1 } } } }), 'utf8');
}

function runLocator(directory, browserRoots, id = extensionId) {
  const script = `$ErrorActionPreference='Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
. ([scriptblock]::Create([IO.File]::ReadAllText(${powershellQuote(locatorPath)},[Text.Encoding]::UTF8)))
try {
  $found=Find-TrenchExtension -ExtensionId ${powershellQuote(id)} -BrowserRoots @(${browserRoots.map(powershellQuote).join(',')})
  @{path=$found} | ConvertTo-Json -Compress
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`;
  return runPowerShell(script, directory);
}

function assertSuccess(result) {
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('Windows hybrid launcher skips exactly five lines and keeps the command line short', () => {
  const locator = fs.readFileSync(locatorPath, 'utf8');
  const generated = Buffer.from(kit.windows(extensionId, locator)).toString('utf8');
  const lines = generated.split('\r\n');
  assert.equal(lines[0], '@echo off');
  assert.equal(lines[1], 'setlocal DisableDelayedExpansion');
  assert.equal(lines[2], 'set "TRENCH_INSTALL_SCRIPT=%~f0"');
  assert.match(lines[3], /ReadAllLines\(\$env:TRENCH_INSTALL_SCRIPT,\[Text.Encoding\]::UTF8\)/);
  assert.match(lines[3], /Select-Object -Skip 5/);
  assert.ok(lines[3].length < 1024, 'Only the fixed loader belongs in the cmd.exe command line');
  assert.doesNotMatch(lines[3], /-EncodedCommand/i);
  assert.equal(lines[4], 'exit /b %errorlevel%');
  assert.equal(lines[5], "$ErrorActionPreference='Stop'");
  assert.ok(generated.includes(locator.replace(/\r?\n/g, '\r\n')));
  assert.throws(() => kit.windows('invalid', locator), /扩展标识/);
});

test('Mac output substitutes the exact extension ID and a lossless UTF-8 locator payload', () => {
  const generated = Buffer.from(kit.mac(extensionId, macLocator, macTemplate)).toString('utf8');
  assert.ok(generated.startsWith('#!/bin/bash\n'));
  assert.ok(generated.includes(`extension_id='${extensionId}'`));
  assert.doesNotMatch(generated, /__EXTENSION_ID__|__LOCATOR_BASE64__/);
  const encoded = /printf '%s' '([A-Za-z0-9+/=]+)' \| \/usr\/bin\/base64 -D/.exec(generated)?.[1];
  assert.ok(encoded, 'The locator is encoded as data, not interpolated as shell code');
  assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), macLocator);
  assert.throws(() => kit.mac('x'.repeat(32), macLocator, macTemplate), /扩展标识/);
});

test('Mac ZIP contains exactly one UTF-8 named, stored executable with CRC and Unix 0755', () => {
  assert.equal(kit.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const filename = '安装AI连接组件.command';
  const content = Buffer.from(kit.mac(extensionId, macLocator, macTemplate));
  const zip = Buffer.from(kit.zipExecutable(filename, content));
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  assert.equal(zip.readUInt16LE(end + 4), 0);
  assert.equal(zip.readUInt16LE(end + 6), 0);
  assert.equal(zip.readUInt16LE(end + 8), 1);
  assert.equal(zip.readUInt16LE(end + 10), 1);
  assert.equal(zip.readUInt16LE(end + 20), 0);
  const central = zip.readUInt32LE(end + 16);
  const centralSize = zip.readUInt32LE(end + 12);
  assert.equal(central + centralSize, end);
  assert.equal(zip.readUInt32LE(central), 0x02014b50);
  assert.equal(zip[central + 5], 3, 'Creator OS is Unix');
  assert.equal(zip.readUInt16LE(central + 8) & 0x800, 0x800);
  assert.equal(zip.readUInt16LE(central + 10), 0, 'Stored file requires no decompression');
  assert.equal(zip.readUInt32LE(central + 38) >>> 16, 0o100755);
  assert.equal(zip.readUInt16LE(central + 30), 0);
  assert.equal(zip.readUInt16LE(central + 32), 0);
  const nameLength = zip.readUInt16LE(central + 28);
  assert.equal(46 + nameLength, centralSize);
  assert.equal(zip.subarray(central + 46, central + 46 + nameLength).toString('utf8'), filename);
  const local = zip.readUInt32LE(central + 42);
  assert.equal(local, 0);
  assert.equal(zip.readUInt32LE(local), 0x04034b50);
  assert.equal(zip.readUInt16LE(local + 6) & 0x800, 0x800);
  assert.equal(zip.readUInt16LE(local + 8), 0);
  assert.equal(zip.readUInt16LE(local + 26), nameLength);
  assert.equal(zip.readUInt16LE(local + 28), 0);
  assert.equal(zip.subarray(local + 30, local + 30 + nameLength).toString('utf8'), filename);
  const data = zip.subarray(local + 30 + nameLength, central);
  assert.deepEqual(data, content);
  assert.equal(zip.readUInt32LE(local + 14), kit.crc32(data));
  assert.equal(zip.readUInt32LE(central + 16), zip.readUInt32LE(local + 14));
  assert.equal(zip.readUInt32LE(local + 18), content.length);
  assert.equal(zip.readUInt32LE(local + 22), content.length);
  assert.equal(zip.readUInt32LE(central + 20), content.length);
  assert.equal(zip.readUInt32LE(central + 24), content.length);
});

test('Windows locator reads isolated Preferences and Secure Preferences, with exact ID and special paths', { skip: process.platform !== 'win32' }, () => {
  const directory = tempCase('路径 空格 & !');
  const extension = writePackage(path.join(directory, "完整 安装包 & ! '中文'"));
  const browserRoot = path.join(directory, '伪浏览器 资料 & !');
  writePreferences(browserRoot, 'Default', 'Preferences', extension);
  writePreferences(browserRoot, 'Profile 1', 'Secure Preferences', extension);
  writePreferences(browserRoot, 'Profile 2', 'Preferences', path.join(directory, 'ignored'), 'p'.repeat(32));
  const result = runLocator(directory, [browserRoot]);
  assertSuccess(result);
  assert.equal(JSON.parse(result.stdout.trim()).path, extension);
  const missing = runLocator(directory, [browserRoot], 'a'.repeat(32));
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /未找到/);
  const invalid = runLocator(directory, [browserRoot], 'X'.repeat(32));
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /标识无效/);
});

test('Windows locator rejects multiple distinct matching packages', { skip: process.platform !== 'win32' }, () => {
  const directory = tempCase('ambiguous');
  const first = writePackage(path.join(directory, 'first'));
  const second = writePackage(path.join(directory, 'second'));
  const browserRoot = path.join(directory, 'browser');
  writePreferences(browserRoot, 'Default', 'Preferences', first);
  writePreferences(browserRoot, 'Profile 1', 'Secure Preferences', second);
  const result = runLocator(directory, [browserRoot]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /多个不同/);
});

test('Windows locator rejects incomplete packages and a manifest for another extension', { skip: process.platform !== 'win32' }, () => {
  const directory = tempCase('invalid-packages');
  const incomplete = writePackage(path.join(directory, 'incomplete'));
  fs.unlinkSync(path.join(path.dirname(incomplete), 'connector', 'install.ps1'));
  const other = writePackage(path.join(directory, 'other'), 'Some other extension');
  const browserRoot = path.join(directory, 'browser');
  writePreferences(browserRoot, 'Default', 'Preferences', incomplete);
  writePreferences(browserRoot, 'Profile 1', 'Secure Preferences', other);
  const result = runLocator(directory, [browserRoot]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /未找到/);
});

test('generated hybrid CMD executes only an isolated marker installer from a Unicode & ! path', {
  skip: process.platform !== 'win32' ? 'Windows only' : process.env.RUN_INSTALLER_EXECUTION !== '1'
    ? 'Opt-in only: real CMD/PowerShell launch may trigger local security software; RUN_INSTALLER_EXECUTION=1 requires an intentional manual test.'
    : false
}, () => {
  const directory = tempCase('仅测试启动器 中文 & !');
  const extension = writePackage(path.join(directory, "完整 包 & ! '中文'"));
  const marker = path.join(path.dirname(extension), 'marker.json');
  const fakeInstaller = `param([Parameter(Mandatory=$true)][string]$ExtensionRoot)
$record=@{extensionRoot=$ExtensionRoot; fixtureOnly=$true} | ConvertTo-Json -Compress
[IO.File]::WriteAllText(${powershellQuote(marker)},$record,(New-Object Text.UTF8Encoding($false)))
`;
  fs.writeFileSync(path.join(path.dirname(extension), 'connector', 'install.ps1'), '\ufeff' + fakeInstaller, 'utf8');
  // If a regression reaches the production error handler, fail instead of
  // opening a modal dialog. No real browser, host, registry or Bot is touched.
  const fakeLocator = `function Add-Type { throw 'Fixture forbids GUI dialogs' }
function Find-TrenchExtension {
  param([string]$ExtensionId)
  if($ExtensionId -cne '${extensionId}') { throw 'Fixture received wrong ID' }
  return ${powershellQuote(extension)}
}
`;
  const launcher = path.join(directory, '开始 安装 & !.cmd');
  const launcherBytes = kit.windows(extensionId, fakeLocator);
  fs.writeFileSync(launcher, launcherBytes);
  // /s removes the outer quote pair; retain the inner pair around the path.
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/v:off', '/s', '/c', `""${launcher}""`], {
    cwd: directory,
    windowsVerbatimArguments: true,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 20_000
  });
  assertSuccess(result);
  assert.deepEqual(JSON.parse(fs.readFileSync(marker, 'utf8')), { fixtureOnly: true, extensionRoot: extension });
});
