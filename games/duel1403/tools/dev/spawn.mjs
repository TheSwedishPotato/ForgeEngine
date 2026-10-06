// Side-on view of the player at the spawn of each start: are the feet on the ground?
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const starts = (process.argv[2] ?? 'podruh,sedlak,tovarys,burgher,panos').split(',');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const st of starts) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:5174/?life=1&begin=${st}&manual=1`);
  await page.waitForFunction(() => window.duel?.life?.sim, null, { timeout: 90000 });
  await page.waitForFunction(() => !window.medStage?.terrain || window.medStage.terrain.ready, null, { timeout: 180000 }).catch(() => {});
  const info = await page.evaluate(() => {
    const L = window.duel.life, P = L.sim.player;
    L._camera = function () { const cam = this.stage.camera, P = this.sim.player; cam.position.set(P.x + 2.6, P.y + 0.5, P.z + 0.4); cam.lookAt(P.x, P.y + 0.6, P.z); };
    window.duel.advance(1);
    const w = L.walker.b;
    return { x: P.x.toFixed(1), z: P.z.toFixed(1), y: P.y.toFixed(2), footL: (w.footL.pos.y - P.y).toFixed(3), inside: P.inside };
  });
  await page.evaluate(() => new Promise((r) => { let n = 0; const f = () => (++n > 20 ? r() : requestAnimationFrame(f)); f(); }));
  await page.screenshot({ path: `shots/spawn_${st}.png` });
  console.log(st, JSON.stringify(info));
  await page.close();
}
await browser.close();
