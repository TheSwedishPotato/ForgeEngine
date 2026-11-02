// Plays a whole episode headless (auto mode) through the real page and reports every page error,
// the chapters reached and a frame from each chapter.
//   node tools/playthrough.mjs [page=index.html] [outDir=shots/run]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright')); }
const [, , path = 'index.html?auto=1&q=low', out = 'shots/run'] = process.argv;
mkdirSync(out, { recursive: true });
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.log('[error]', m.text().slice(0, 400)); } });
const t0 = Date.now();
await page.goto(server.resolvedUrls.local[0] + path, { waitUntil: 'load' });
let last = null;
for (;;) {
  await new Promise((r) => setTimeout(r, 5000));
  const s = await page.evaluate(() => ({ ended: !!window.__ended, ch: window.vesper?.runner?.chapterId ?? window.story?.T?.runner?.chapterId ?? null, lines: window.vesper?.T?.lineCount ?? 0 })).catch(() => ({ ended: false }));
  if (s.ch && s.ch !== last) {
    last = s.ch;
    console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s chapter ${s.ch} (lines so far ${s.lines})`);
    await new Promise((r) => setTimeout(r, 20000));
    const url = await page.evaluate(() => (window.__capture ? window.__capture() : null)).catch(() => null);
    if (url) writeFileSync(`${out}/${s.ch}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
  }
  if (s.ended) break;
  if (Date.now() - t0 > 90 * 60 * 1000) { console.log('timeout'); break; }
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s, ${errors.length} errors`);
await browser.close();
await server.close();
process.exit(errors.length ? 1 : 0);
