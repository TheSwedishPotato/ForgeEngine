// Deterministic screenshots: node tools/shot.mjs "<query>" <out-prefix> <seconds,...> [js-run-each-shot]
// Uses ?manual=1 so the game advances exactly to each time before the shot.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const [, , query = '', prefix = 'shots/s', times = '3', script = ''] = process.argv;
const width = parseInt(process.env.W ?? '1280'), height = parseInt(process.env.H ?? '760');
mkdirSync(prefix.split('/').slice(0, -1).join('/') || '.', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width, height } });
const seen = new Set();
const once = (s) => { if (!seen.has(s)) { seen.add(s); console.log(s); } };
page.on('console', (m) => { if ((m.type() === 'error' && !m.text().includes('CERT')) || process.env.VERBOSE) once(`[page] ${m.type()} ${m.text().slice(0, 600)}`); });
page.on('pageerror', (e) => once(`[pageerror] ${e.message.slice(0, 800)} ${e.stack?.split('\n').slice(1, 4).join(' | ')}`));
const sep = query.includes('?') ? '&' : '?';
await page.goto(`http://127.0.0.1:${process.env.PORT ?? 5174}/${query}${sep}manual=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.duel && (window.duel.sim || window.duel.joust || window.duel.life), null, { timeout: 90000 });
// wait for the terrain worker (Med Engine) before shooting
await page.waitForFunction(() => !window.medStage?.terrain || window.medStage.terrain.ready, null, { timeout: 180000 }).catch(() => console.log('terrain not ready'));
let prev = 0;
for (const t of times.split(',')) {
  const s = parseFloat(t);
  await page.evaluate(([dt, sc]) => { window.duel.advance(dt); if (sc) (0, eval)(sc); }, [s - prev, script]);
  prev = s;
  // let the temporal passes (TAA, GI, volumetrics) and probes settle
  const settle = parseInt(process.env.SETTLE ?? '24');
  await page.evaluate((n) => new Promise((res) => { const f0 = window.med ? window.med.frame : 0; const tick = () => (!window.med || window.med.frame - f0 >= n ? res() : requestAnimationFrame(tick)); tick(); }), settle);
  await page.screenshot({ path: `${prefix}_${t}.png`, timeout: 300000 });
}
const info = await page.evaluate(() => { const d = window.duel; return d.player ? { mode: d.mode, p: d.player.state, f: d.foe.state, pb: d.player.blood.toFixed(2), fb: d.foe.blood.toFixed(2), log: [...document.querySelectorAll('.log .line')].map((x) => x.textContent) } : null; });
console.log(JSON.stringify(info, null, 1));
await browser.close();
