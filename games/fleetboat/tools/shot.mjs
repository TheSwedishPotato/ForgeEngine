// Screenshots of the game in headless Chromium (SwiftShader):
//   node tools/shot.mjs "<query>" <out.png> [frames=24]
// Needs the dev server: npx vite --port 5178 (or PORT=...)
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
await page.waitForFunction(() => window.game?.ready, null, { timeout: 240000 });
console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const n = parseInt(frames);
const t1 = Date.now();
for (let i = 0; i < n; i++) await page.evaluate(() => window.game.advance(1 / 30));
console.log(`${n} frames in ${((Date.now() - t1) / 1000).toFixed(1)} s`);
if (process.env.STATS) console.log(await page.evaluate(() => {
  const r = window.med, gl = r.gl, st = window.stage;
  let exposure = null;
  try {
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, r.exposureTex.tex, 0);
    const px = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px); exposure = Array.from(px.slice(0, 2)).map((v) => +v.toFixed(4));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb);
  } catch (e) { exposure = String(e); }
  const sh = Array.from(r.env.sh.slice(0, 9)).map((v) => +v.toFixed(3));
  return JSON.stringify({ stats: r.stats, terrain: st.terrainGL.stats, sun: { dir: r.sunDir.toArray().map((v) => +v.toFixed(3)), color: r.sunColor.toArray().map((v) => +v.toFixed(3)), I: +r.sunIntensity.toFixed(2), el: +st.sunPos.elevation.toFixed(2), az: +st.sunPos.azimuth.toFixed(1) }, shL00_L1: sh, exposure_avgLum: exposure, overcast: st.sky.overcast });
}));
await page.screenshot({ path: out, timeout: 300000, ...(out.endsWith('.jpg') ? { type: 'jpeg', quality: 86 } : {}) });
await browser.close();
console.log('wrote', out);
