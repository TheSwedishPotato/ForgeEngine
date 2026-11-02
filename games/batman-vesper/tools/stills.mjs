// Renders the illustrated story's pictures with the 3D engine (stills.html), then mattes and
// paints them (tools/paint.py): portraits with alpha, background plates.
//   node tools/stills.mjs [filter]      -> public/stills/*.webp
import { createRequire } from 'node:module';
import { execSync, execFileSync } from 'node:child_process';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright')); }

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RAW = process.env.RAW ?? '/tmp/vesper-raw';
const OUT = ROOT + 'public/stills';
mkdirSync(RAW, { recursive: true }); mkdirSync(OUT, { recursive: true });

export const PORTRAITS = {
  batman: ['grim', 'determined', 'worried'], rook: ['grim', 'fury', 'desperate'], nadia: ['smirk', 'determined', 'afraid'],
  cruz: ['cold', 'determined', 'worried'], marrow: ['cold', 'contempt', 'surprised'], kow: ['grim', 'fury', 'pained'],
  dez: ['worried', 'angry', 'afraid'], deckhand: ['grim', 'fury', 'pained'],
};
export const PLATES = {
  cathedral: { set: 'cathedral', cam: { pos: [-4.5, 2.2, -1.5], target: [6, -6, 40], fov: 55 } },
  cathedral_dawn: { set: 'cathedral', time: 'dawn', cam: { pos: [-4.5, 2.2, -1.5], target: [6, -6, 40], fov: 55 } },
  garage: { set: 'garage', cam: { pos: [-17, 1.6, -2.5], target: [6, 1.0, 1.0], fov: 55 } },
  garage_dark: { set: 'garage', lights: 'emergency', cam: { pos: [-17, 1.6, -2.5], target: [6, 1.0, 1.0], fov: 55 } },
  garageRoof: { set: 'garageRoof', cam: { pos: [6, 1.7, 4], target: [-6, 0.6, -16], fov: 55 } },
  harbour: { set: 'harbour', cam: { pos: [-90, 4, 60], target: [0, 10, 0], fov: 50 }, lightning: 0.4 },
  acheron: { set: 'acheron', cam: { pos: [-49, 12, 6], target: [-30, 11.5, -2], fov: 58 } },
};

const filter = process.argv[2];
const server = await createServer({ root: ROOT, server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 1600 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 300)); });
await page.goto(base + 'stills.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
const save = (name, url) => writeFileSync(`${RAW}/${name}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
const t0 = Date.now();
for (const [name, p] of Object.entries(PLATES)) {
  if (filter && !name.includes(filter)) continue;
  if (existsSync(`${OUT}/bg_${name}.webp`) && !process.env.FORCE) continue;
  // plates are landscape-ish backgrounds cropped to portrait by the page; render tall
  const url = await page.evaluate((s) => window.renderStill({ kind: 'plate', ...s }), p);
  save('bg_' + name, url);
  execFileSync('python3', ['-I', ROOT + 'tools/paint.py', 'plate', `${RAW}/bg_${name}.jpg`, `${OUT}/bg_${name}.webp`]);
  console.log('plate', name, ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
for (const [who, emos] of Object.entries(PORTRAITS)) {
  if (filter && !who.includes(filter)) continue;
  for (const emo of emos) {
    if (existsSync(`${OUT}/${who}_${emo}.webp`) && !process.env.FORCE) continue;
    for (const bg of [0, 1]) save(`${who}_${emo}_${bg}`, await page.evaluate((s) => window.renderStill(s), { kind: 'portrait', who, emo, bg }));
    execFileSync('python3', ['-I', ROOT + 'tools/paint.py', 'portrait', `${RAW}/${who}_${emo}_0.jpg`, `${RAW}/${who}_${emo}_1.jpg`, `${OUT}/${who}_${emo}.webp`]);
    console.log('portrait', who, emo, ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
}
await browser.close();
await server.close();
