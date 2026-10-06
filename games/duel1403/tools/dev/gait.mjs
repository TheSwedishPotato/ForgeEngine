// Side-on frames of the player walking in Skalice, to judge the gait.
//   node tools/dev/gait.mjs [speed=normal|run] [out=shots/gait]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const run = process.argv[2] === 'run', out = process.argv[3] ?? 'shots/gait';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5174/?life=1&begin=burgher&manual=1');
await page.waitForFunction(() => window.duel?.life?.sim, null, { timeout: 90000 });
await page.evaluate((run) => {
  const L = window.duel.life, P = L.sim.player;
  P.x = 0; P.z = 96; P.yaw = 0; L.camYaw = 0;
  L.keys.add('w'); if (run) L.keys.add('shift');
  L._camera = function () {
    const cam = this.stage.camera, P = this.sim.player;
    cam.position.set(P.x + 3.4, P.y + 1.1, P.z + 0.2); cam.lookAt(P.x, P.y + 0.9, P.z + 0.2);
    if (cam.fov !== 40) { cam.fov = 40; cam.updateProjectionMatrix(); }
    this.stage.focusPoint = null; this.stage.shadowFocus = [this.walker.b.head.pos, this.walker.b.footL.pos];
  };
  window.duel.advance(2);
}, run);
for (let i = 0; i < 6; i++) {
  await page.evaluate(() => window.duel.advance(0.12));
  await page.evaluate(() => new Promise((r) => { let n = 0; const f = () => (++n > 6 ? r() : requestAnimationFrame(f)); f(); }));
  await page.screenshot({ path: `${out}_${i}.png`, clip: { x: 250, y: 120, width: 400, height: 520 } });
}
const info = await page.evaluate(() => { const w = window.duel.life.walker; return { v: w.v.toFixed(2), k: w.k.toFixed(2), run: w.run.toFixed(2), phase: w.phase.toFixed(2) }; });
console.log(info);
await browser.close();
