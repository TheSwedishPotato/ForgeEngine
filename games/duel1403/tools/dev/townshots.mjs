// Views of the town, the church and the castle with a free camera.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const views = {
  square: [[8, 4.5, 84], [-6, 1.2, 96]],
  market: [[-4, 2.2, 86], [-12, 1.2, 90]],
  street: [[30, 3, 115], [44, 2, 96]],
  farm: [[46, 7, 76], [44, 1, 92]],
  church: [[-4, 8, 92], [-20, 6, 110]],
  castle: [[10, 70, 170], [30, 58, 230]],
  bailey: [[24.3, 57.5, 222.5], [37, 58, 236]],
  gate: [[19, 56.5, 205], [24, 58, 216]],
  shop: [[12, 2.2, 66], [7, 1.5, 72]],
};
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message, e.stack?.split('\n').slice(1, 3).join('|')));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('CERT')) console.log('[console]', m.text().slice(0, 300)); });
await page.goto('http://127.0.0.1:5174/?life=1&begin=burgher&manual=1');
await page.waitForFunction(() => window.duel?.life?.sim, null, { timeout: 90000 });
await page.waitForFunction(() => !window.medStage?.terrain || window.medStage.terrain.ready, null, { timeout: 180000 }).catch(() => console.log('terrain not ready'));
await page.evaluate(() => { const L = window.duel.life; L.sim.t = 10; L.hud.hidden = true; });
for (const [name, [pos, at]] of Object.entries(views)) {
  if (process.argv[2] && !process.argv[2].split(',').includes(name)) continue;
  await page.evaluate(([pos, at]) => {
    const L = window.duel.life;
    L._camera = function () { const cam = this.stage.camera; cam.position.set(...pos); cam.lookAt(...at); if (cam.fov !== 55) { cam.fov = 55; cam.updateProjectionMatrix(); } this.stage.shadowFocus = null; };
    window.duel.advance(0.5);
  }, [pos, at]);
  await page.evaluate(() => new Promise((r) => { let n = 0; const f = () => (++n > 24 ? r() : requestAnimationFrame(f)); f(); }));
  await page.screenshot({ path: `shots/town_${name}.png` });
  console.log('shot', name);
}
await browser.close();
