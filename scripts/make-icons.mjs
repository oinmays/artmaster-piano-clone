// Renders scripts/icon.svg to the PNG sizes iOS and the manifest need, using headless Chrome.
// Usage: node scripts/make-icons.mjs   (macOS; set CHROME=/path/to/chrome elsewhere)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const svg = readFileSync(resolve('scripts/icon.svg'), 'utf8');
const out = resolve('public/icons');
const work = mkdtempSync(join(tmpdir(), 'icons-'));

const sizes = { 'apple-touch-icon.png': 180, 'icon-192.png': 192, 'icon-512.png': 512, 'maskable-512.png': 512, 'favicon-32.png': 32 };

for (const [name, size] of Object.entries(sizes)) {
  // Maskable icons need the artwork inside the central 80% safe zone.
  const inner = name.startsWith('maskable') ? Math.round(size * 0.8) : size;
  const pad = (size - inner) / 2;
  const html = `<html><body style="margin:0;background:#151514;width:${size}px;height:${size}px;overflow:hidden">
    <div style="position:absolute;left:${pad}px;top:${pad}px;width:${inner}px;height:${inner}px">${svg.replace('width="512" height="512"', `width="${inner}" height="${inner}"`)}</div></body></html>`;
  const page = join(work, `${name}.html`);
  writeFileSync(page, html);
  const shot = join(work, name);
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${size},${size}`, `--screenshot=${shot}`, `file://${page}`], { stdio: 'ignore' });
  copyFileSync(shot, join(out, name));
  console.log('wrote', name);
}
