// Headless screenshots through the real page (software WebGL2 via SwiftShader).
//   node tools/shot.mjs "lab.html?char=rook&shot=cu" out.jpg [frames=40] [w=1280] [h=720]
// Starts a Vite dev server unless BASE is given.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

// the pre-installed Playwright (global); a local install wins if there is one
let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  const root = execSync('npm root -g').toString().trim();
  ({ chromium } = createRequire(root + '/')('playwright'));
}

const [, , path = 'lab.html', out = 'shots/lab.jpg', framesArg = '40', w = '1280', h = '720'] = process.argv;
let base = process.env.BASE, server;
if (!base) {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
  await server.listen();
  base = server.resolvedUrls.local[0];
}
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
const t0 = Date.now();
const sep = path.includes('?') ? '&' : '?';
await page.goto(base + path + sep + 'frames=' + framesArg, { waitUntil: 'load' });
const want = +framesArg;
try {
  await page.waitForFunction((n) => (window.__stopping ? window.__shotReady : (window.__frames ?? 0) >= n), want, { timeout: 600000, polling: 500 });
} catch (e) { errors.push('timeout waiting for frames: ' + e.message); }
for (const e of [...new Set(errors)].slice(0, 30)) console.log(e.slice(0, 800));
errors.length = 0;
const url = await page.evaluate(() => window.__capture ? window.__capture() : document.querySelector('canvas').toDataURL('image/jpeg', 0.92));
const { writeFileSync } = await import('node:fs');
writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
// the page's own overlays (subtitles, UI) only exist in a real screenshot
if (process.env.FULL) await page.screenshot({ path: out.replace(/\.(jpg|png)$/, '-ui.$1'), type: 'jpeg', quality: 88, timeout: 600000 });
const frames = await page.evaluate(() => window.__frames ?? 0);
console.log(`${out}: ${frames} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const e of [...new Set(errors)].slice(0, 30)) console.log(e.slice(0, 800));
await browser.close();
await server?.close();
