// Starts every chapter headless with the 16-texture limit many GPUs have (Chrome on Windows,
// phones), so a shader that needs more fails here instead of on a player's machine.
//   node tools/limit-check.mjs [high] [seconds per chapter=70]
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const { chromium } = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright');
const q = process.argv[2] ?? 'high', secs = +(process.argv[3] ?? 70);
const server = await createServer({ root: process.cwd(), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let bad = 0;
for (const ch of ['prologue', 'ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'epilogue']) {
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  await p.addInitScript(() => { globalThis.MED_TEXTURE_UNIT_LIMIT = 16; });
  await p.goto(server.resolvedUrls.local[0] + `index.html?auto=1&chapter=${ch}&q=${q}`);
  await p.waitForTimeout(secs * 1000);
  const lighting = await p.evaluate(() => JSON.stringify(window.vesper?.T?.stageE?.r?.lightingFeatures ?? null)).catch(() => '?');
  console.log(ch, errs.length ? 'ERRORS ' + JSON.stringify(errs) : 'ok', 'lighting', lighting);
  bad += errs.length;
  await p.close();
}
await b.close(); await server.close();
process.exit(bad ? 1 : 0);
