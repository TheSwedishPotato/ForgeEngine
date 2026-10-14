// Screenshots of the game in headless Chromium (SwiftShader):
//   node tools/shot.mjs "<query>" <out.png> [frames=24]
// Needs the dev server: npx vite (PORT=... to pick another)
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [, , query = '', out = 'shots/shot.png', frames = '24'] = process.argv;
const width = parseInt(process.env.W ?? '1280'), height = parseInt(process.env.H ?? '720');
mkdirSync(dirname(out), { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width, height } });
const seen = new Set();
const once = (s) => { if (!seen.has(s)) { seen.add(s); console.log(s); } };
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || process.env.VERBOSE) once(`[page] ${m.type()} ${m.text().slice(0, 1500)}`); });
page.on('pageerror', (e) => once(`[pageerror] ${e.message.slice(0, 1500)} ${e.stack?.split('\n').slice(1, 4).join(' | ')}`));
const sep = query.includes('?') ? '&' : '?';
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${process.env.PORT ?? 5178}/${query}${sep}manual=1`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.game?.ready || window.game?.error, null, { timeout: 240000 });
const err = await page.evaluate(() => window.game.error);
if (err) { console.log('game error:', err); }
console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const n = parseInt(frames);
const t1 = Date.now();
if (process.env.ACTIONS) await page.evaluate((a) => window.game.script?.(a), process.env.ACTIONS);
for (let i = 0; i < n; i++) await page.evaluate(() => window.game.advance(1 / 30));
console.log(`${n} frames in ${((Date.now() - t1) / 1000).toFixed(1)} s`);
if (process.env.EVAL) console.log(await page.evaluate(process.env.EVAL));
await page.screenshot({ path: out, timeout: 300000 });
await browser.close();
console.log('wrote', out);
