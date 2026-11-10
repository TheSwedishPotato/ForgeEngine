#!/usr/bin/env node
/**
 * A scripted tour of the demo level, rendered headless on Node (Dawn) into PNG files: the same game as the page, the same keys,
 * no window. Useful for checking a change at a glance, for CI artefacts and for the README pictures.
 *
 *   node demo/screenshot.mjs [outDir] [--size 960x540] [--quality medium] [--settle 10] [--software]
 *   npm run shots
 *
 * Needs the optional `webgpu` package (npm i webgpu). With a real GPU it takes seconds. On a machine without one, `--software` points
 * Vulkan at the SwiftShader driver that comes with Chromium / Playwright (a frame then takes a second or so: most of the tour is
 * simulated without drawing and only each picture is drawn, `--settle` frames of it, enough for the temporal anti-aliasing to converge).
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const { useSoftwareGPU } = await import('../tools/software-gpu.mjs');

const { NodePlatform } = await import('../src/platform/node.js');
const { Engine, QUALITY } = await import('../src/index.js');
const { createGame } = await import('./game.js');

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DT = 1 / 60;

export function parseArgs(argv) {
  const o = { out: path.join(ROOT, 'demo', 'screenshots'), size: [960, 540], quality: 'medium', settle: 10, software: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--size') { const m = /^(\d+)x(\d+)$/.exec(argv[++i] ?? ''); if (!m) throw new Error('--size wants WIDTHxHEIGHT, e.g. 960x540'); o.size = [+m[1], +m[2]]; }
    else if (a === '--quality') { o.quality = argv[++i]; if (!QUALITY[o.quality]) throw new Error(`--quality is one of ${Object.keys(QUALITY).join(', ')}`); }
    else if (a === '--settle') o.settle = Math.max(1, Number(argv[++i]) | 0);
    else if (a === '--software') o.software = true;
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else o.out = path.resolve(a);
  }
  return o;
}

/** Plays the tour and writes one PNG per scene. Returns the file names, in order. */
export async function tour({ out, size, quality, settle, log = () => {} }) {
  fs.mkdirSync(out, { recursive: true });
  const platform = new NodePlatform({ width: size[0], height: size[1] });
  const engine = await Engine.create({ platform, quality, baseUrl: ROOT });
  const game = await createGame(engine);
  const { player, dummy } = game;
  const key = (code, down = true) => platform.emit('key', { code, key: code, down, repeat: false });
  const run = (seconds) => engine.run(Math.round(seconds / DT), DT, { draw: false });
  const tap = (code) => { key(code); run(DT * 2); key(code, false); run(DT * 2); };
  const files = [];
  let n = 0;
  const photo = async (name, note) => {
    engine.run(settle, DT);                       // drawn frames: let the temporal filter converge
    const file = `${String(++n).padStart(2, '0')}-${name}.png`;
    await engine.screenshotPNG(path.join(out, file));
    files.push(file);
    log(`${file.padEnd(22)} ${note}`);
  };

  run(1.5);
  await photo('follow', 'the third-person camera at the start, the player seen whole');

  key('KeyW'); run(1.1);
  await photo('run', 'running, mid-stride');
  key('KeyW', false); run(1.2);

  player.place([0, 0, 9], 180); run(0.5);
  tap('Space');
  for (let i = 0; i < 60 && player.grounded; i++) run(DT);   // the jump has an anticipation: wait for take-off
  run(0.18);
  await photo('jump', `in the air (${player.grounded ? 'NOT airborne' : `${player.position.y.toFixed(2)} m up`})`);
  run(1.2);

  player.place([3, 0, 3.7], 180); run(0.6);
  let hitAt = -1;
  player.on('hit', () => { hitAt = engine.time; });
  tap('KeyF');
  for (let i = 0; i < 90 && hitAt < 0; i++) run(DT);
  run(0.12);
  await photo('punch', 'the punch lands on the dummy');
  run(0.45);
  await photo('ragdoll', `the dummy ragdoll${dummy.ragdollActive ? '' : ' (not active: the hit missed)'} `);
  run(5.8);

  // the film cameras: the two-shot wants the ferryman close by, so the player walks over to the hut for the whole set
  player.place([-6.9, 0, -1.2], 270); run(0.8);
  const names = ['mcu', 'ws', 'two', 'pov'];
  for (let i = 0; i < 4; i++) {
    tap('KeyC'); run(2.2);
    await photo(`shot-${names[i]}`, `film camera ${i + 1}: ${names[i]}`);
  }
  tap('KeyC'); run(1.5);                           // back to the gameplay camera

  tap('KeyE'); run(2.5);
  await photo('talk', `the conversation: over the shoulder (${game.talking ? 'story running' : 'NOT talking'})`);

  const stats = { frames: engine.frame, draws: engine.stage.renderer.stats.drawCalls, errors: engine.stage.renderer.gpu.errors.slice() };
  engine.dispose();
  return { files, ...stats };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  if (opts.software && !useSoftwareGPU()) console.error('--software: no SwiftShader driver found (set VK_ICD_FILENAMES to a vk_*_icd.json yourself)');
  const t0 = Date.now();
  try {
    const r = await tour({ ...opts, log: (s) => console.log(s) });
    console.log(`\n${r.files.length} pictures in ${opts.out} (${((Date.now() - t0) / 1000).toFixed(0)} s, ${r.errors.length} GPU errors)`);
    if (r.errors.length) { console.error(r.errors.slice(0, 5).join('\n')); process.exitCode = 1; }
  } catch (e) {
    console.error(e.message ?? e);
    process.exit(1);
  }
}
