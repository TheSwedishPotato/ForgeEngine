// Scripted gameplay capture: node tools/play.mjs out-prefix "t:action,t:action..." [shotTimes]
// actions: key:KeyJ | down:KeyW | up:KeyW | shot
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const [, , prefix = 'shots/play', script = '', query = ''] = process.argv;
mkdirSync('shots', { recursive: true });
const W = +(process.env.W ?? 1280), H = +(process.env.H ?? 720);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CERT') && !m.text().includes('fonts')) console.log('[console]', m.text().slice(0, 300)); });
await page.goto(`http://127.0.0.1:5173/index.html?manual=1&autostart=1${query}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.sim, null, { timeout: 60000 });
const steps = script.split(',').filter(Boolean).map((s) => {
  const [t, ...rest] = s.split(':');
  return { t: parseFloat(t), a: rest.join(':') };
}).sort((a, b) => a.t - b.t);
let n = 0;
for (const st of steps) {
  await page.evaluate((t) => window.game.stepTo(t), st.t);
  const [kind, arg] = st.a.split(':');
  if (kind === 'key') await page.keyboard.press(arg);
  else if (kind === 'down') await page.keyboard.down(arg);
  else if (kind === 'up') await page.keyboard.up(arg);
  else if (kind === 'shot') {
    await page.screenshot({ path: `${prefix}_${String(n++).padStart(2, '0')}_${st.t}.png` });
  } else if (kind === 'eval') {
    console.log(await page.evaluate(arg));
  }
}
const info = await page.evaluate(() => {
  const g = window.game;
  return { t: g.match.state, clock: g.match.clock.toFixed(1), a: { hp: g.sim.a.health.toFixed(0), st: g.sim.a.stamina.toFixed(0), stats: g.sim.a.stats }, b: { hp: g.sim.b.health.toFixed(0), st: g.sim.b.stamina.toFixed(0), stats: g.sim.b.stats } };
});
console.log(JSON.stringify(info));
await browser.close();
