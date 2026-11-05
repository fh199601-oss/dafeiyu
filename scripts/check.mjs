import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = path.resolve('extension');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const files = [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page,
  ...Object.values(manifest.icons || {}), ...Object.values(manifest.action.default_icon || {}),
  ...manifest.content_scripts.flatMap(item => item.js), ...manifest.web_accessible_resources.flatMap(item => item.resources)];
for (const file of files) if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing ${file}`);
for (const file of fs.readdirSync(root).filter(file => file.endsWith('.js'))) execFileSync(process.execPath, ['--check', path.join(root, file)]);
for (const html of ['home.html', 'popup.html']) {
  const text = fs.readFileSync(path.join(root, html), 'utf8');
  if (/<script(?![^>]*\bsrc=)[^>]*>\s*\S/.test(text)) throw new Error(`Inline script in ${html}`);
  for (const [, file] of text.matchAll(/(?:src|href)="([^"#]+\.(?:js|css|png))"/g)) if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing ${file}`);
}
console.log(`Manifest references, CSP-compatible HTML, and JavaScript syntax: OK (${manifest.version})`);
