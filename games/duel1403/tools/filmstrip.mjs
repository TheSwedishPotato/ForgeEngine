// Records an exchange as a contact sheet: node tools/filmstrip.mjs "<query>" out.png [start=3] [frames=24] [step=0.08] [cam=fighter]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
const [, , query = '?fight=1&foe=fencer', out = 'shots/strip.png', start = '3', frames = '24', step = '0.08', cam = ''] = process.argv;
const W = 640, H = 400, dir = 'shots/strip_tmp';
rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)));
await page.goto(`http://127.0.0.1:5174/${query}&manual=1&noui=1&quality=low`, { waitUntil: 'load' });
await page.waitForFunction(() => window.duel && window.duel.sim, null, { timeout: 90000 });
await page.evaluate(([s, c]) => { window.duel.advance(Number(s)); if (c.startsWith('{')) window.duel.cam = JSON.parse(c); else if (c) window.duel.rig.mode = c; }, [start, cam]);
const log = [];
for (let i = 0; i < Number(frames); i++) {
  await page.evaluate((dt) => window.duel.advance(dt), Number(step));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: `${dir}/f${String(i).padStart(3, '0')}.png` });
  log.push(await page.evaluate(() => { const d = window.duel, a = d.sim.a, b = d.sim.b; return `${d.sim.time.toFixed(2)} d=${a.center.distanceTo(b.center).toFixed(2)} A:${a.state}/${a.attack?.name ?? (a.parrying ? 'parry' : '-')} B:${b.state}/${b.attack?.name ?? (b.parrying ? 'parry' : '-')}`; }));
}
await browser.close();
const cols = 6;
execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '1', '-i', `${dir}/f%03d.png`, '-vf', `scale=320:200,tile=${cols}x${Math.ceil(Number(frames) / cols)}`, '-frames:v', '1', out]);
console.log(log.join('\n'));
