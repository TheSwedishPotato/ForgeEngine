// Inside views: node tools/dev/interiors.mjs tavern,smithy,h3
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const ids = (process.argv[2] ?? 'tavern,smithy,h3,bakery').split(',');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 520 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message, e.stack?.split('\n').slice(1, 3).join('|')));
await page.goto('http://127.0.0.1:5174/?life=1&begin=burgher&manual=1');
await page.waitForFunction(() => window.duel?.life?.sim, null, { timeout: 90000 });
for (const id of ids) {
  await page.evaluate(async (id) => {
    const L = window.duel.life; const { BUILDING } = await import('/src/world/town.js');
    if (L.interior) L._leave();
    L.sim.t = 10;
    L.sim.player.inside = id; L._buildInterior(BUILDING[id]);
    L.hud.hidden = true;
    L._camera = function () { const I = this.interior, cam = this.stage.camera; cam.position.set(I.origin.x + I.doorLocal.x * 0.9, I.origin.y + 2.0, I.origin.z + I.doorLocal.z * 0.9 + (I.doorLocal.x ? 0.01 : 0)); cam.lookAt(I.origin.x - I.doorLocal.x, I.origin.y + 0.7, I.origin.z - I.doorLocal.z); if (cam.fov !== 75) { cam.fov = 75; cam.updateProjectionMatrix(); } };
    window.duel.advance(0.3);
  }, id);
  await page.evaluate(() => new Promise((r) => { let n = 0; const f = () => (++n > 20 ? r() : requestAnimationFrame(f)); f(); }));
  await page.screenshot({ path: `shots/in_${id}.png` });
}
await browser.close();
