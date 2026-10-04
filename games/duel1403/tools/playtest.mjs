// Plays as the user would: walks in, cuts with mouse drags, thrusts with clicks.
// node tools/playtest.mjs [foe] [kit] [weapon]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
const [foe = 'fencer', kit = 'blossfechten', weapon = 'longsword'] = process.argv.slice(2);
mkdirSync('shots', { recursive: true });
const W = 1100, H = 650;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:5174/?manual=1&quality=low&fight=1&foe=${foe}&kit=${kit}&weapon=${weapon}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.duel && window.duel.sim, null, { timeout: 90000 });
const adv = (s) => page.evaluate((x) => window.duel.advance(x), s);
const state = () => page.evaluate(() => { const d = window.duel; return { dist: d.player.center.distanceTo(d.foe.center).toFixed(2), pa: d.player.attack?.name ?? null, foeBlood: d.foe.blood.toFixed(2), foeState: d.foe.state, me: d.player.state, myBlood: d.player.blood.toFixed(2) }; });
await adv(4.5);
// Walk in until about 2 m apart.
await page.keyboard.down('w');
for (let i = 0; i < 20; i++) { await adv(0.1); const s = await state(); if (Number(s.dist) < 2.1) break; }
await page.keyboard.up('w');
console.log('after approach', await state());
// Where is his head on screen?
const head = () => page.evaluate(() => { const d = window.duel; const v = d.foe.b.head.pos.clone().project(d.rig.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; });
for (const [label, dx, dy] of [['Zornhau', -1, -1], ['Unterhau', -1, 1], ['Zwerchhau', -1, 0]]) {
  const [hx, hy] = await head();
  await page.mouse.move(hx - dx * 90, hy + dy * 90);
  await page.mouse.down();
  for (let k = 1; k <= 6; k++) await page.mouse.move(hx - dx * 90 + dx * 30 * k, hy + dy * 90 - dy * 30 * k);
  await page.mouse.up();
  await adv(0.02);
  console.log(label, 'started:', (await state()).pa);
  await adv(0.9);
  await page.screenshot({ path: `shots/play_${label}.png` });
  console.log(label, await state());
}
// Thrust: click his chest.
const chest = await page.evaluate(() => { const d = window.duel; const v = d.foe.b.chest.pos.clone().project(d.rig.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; });
await page.mouse.click(chest[0], chest[1]);
await adv(0.02);
console.log('thrust started', (await state()).pa);
await adv(1.0);
await page.screenshot({ path: 'shots/play_thrust.png' });
console.log('log:', await page.evaluate(() => [...document.querySelectorAll('.log .line')].map((x) => x.textContent)));
console.log(await state());
await browser.close();
