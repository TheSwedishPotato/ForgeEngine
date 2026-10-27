// Pictures of named views, headless: node tools/views.mjs <outdir> <view>... (views below)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT ?? 'playwright');
const [dir = 'shots', ...names] = process.argv.slice(2);
const VIEWS = {
  carOut: `P.mode = 'orbit'; Object.assign(P.orbit, { yaw: 0.55, pitch: 0.12, dist: 7.5, follow: true });`,
  carSide: `P.mode = 'orbit'; Object.assign(P.orbit, { yaw: 1.4, pitch: -0.05, dist: 6, follow: true });`,
  roof: `P.teleport([-0.3, h.yc + 2.63, 16.45], -Math.PI / 2 - 0.3); P.pitch = -0.45;`,
  pit: `P.teleport([1.5, -3.6, 16.9], -Math.PI + 0.5); P.pitch = 0.15;`,
  carIn: `P.teleport([-0.6, h.yc, 16.5], -Math.PI / 2 + 0.6); P.pitch = -0.2;`,
  cop: `P.teleport([0.75, h.yc, 15.75], -Math.PI / 2); P.pitch = -0.35;`,
  copNear: `P.teleport([0.72, h.yc, 15.52], -Math.PI / 2); P.pitch = -0.85;`,
  mr: `P.teleport([1.6, 121.6, 17.6], -Math.PI + 0.35); P.pitch = -0.3;`,
  mrPanel: `P.teleport([-2.2, 121.6, 14.8], -Math.PI / 2); P.pitch = -0.15;`,
};
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(`http://127.0.0.1:${process.env.PORT ?? 5180}/?manual=1&q=${process.env.Q ?? 'low'}&floor=${process.env.FLOOR ?? 3}`);
await page.waitForFunction(() => window.game?.ready, null, { timeout: 120000 });
for (const n of names) {
  await page.evaluate((code) => { const g = window.game.game, P = g.player, h = g.sim.hoist; new Function('g', 'P', 'h', code)(g, P, h); for (let i = 0; i < 30; i++) { g.sim.advance(1 / 30); P._walk(1 / 30); } for (let i = 0; i < 8; i++) g.frame(1 / 60); }, VIEWS[n]);
  await page.screenshot({ path: `${dir}/v-${n}.png`, timeout: 180000 });
  console.log('shot', n);
}
console.log(errors.join('\n') || 'no errors');
await browser.close();
