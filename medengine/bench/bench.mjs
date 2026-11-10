#!/usr/bin/env node
/**
 * Med Engine benchmark, headless on Node (Dawn): CPU time, GPU time per pass and throughput for a handful of scenes.
 *
 *   node bench/bench.mjs [--scenes ford,crowd,lights,draws,physics] [--size 1920x1080] [--quality high]
 *                        [--frames 120] [--warmup 30] [--json results.json] [--software]
 *   npm run bench
 *
 * Needs the optional `webgpu` package (npm i webgpu). It uses your GPU. `--software` points Vulkan at SwiftShader for machines
 * without one: that only proves the benchmark runs - its GPU timings are those of a CPU pretending to be a GPU.
 * To measure in a browser instead (real canvas, real compositor), serve the package (npm run demo) and open /bench/.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { useSoftwareGPU } from '../tools/software-gpu.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

export function parseArgs(argv) {
  const o = { scenes: null, size: [1280, 720], quality: 'high', frames: 120, warmup: 30, json: null, software: false };
  const need = (i, what) => { if (argv[i] === undefined) throw new Error(`${argv[i - 1]} wants ${what}`); return argv[i]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scenes') o.scenes = need(++i, 'a comma separated list').split(',').filter(Boolean);
    else if (a === '--size') { const m = /^(\d+)x(\d+)$/.exec(need(++i, 'WIDTHxHEIGHT')); if (!m) throw new Error('--size wants WIDTHxHEIGHT, e.g. 1920x1080'); o.size = [+m[1], +m[2]]; }
    else if (a === '--quality') o.quality = need(++i, 'a quality name');
    else if (a === '--frames') o.frames = Number(need(++i, 'a number'));
    else if (a === '--warmup') o.warmup = Number(need(++i, 'a number'));
    else if (a === '--json') o.json = need(++i, 'a file name');
    else if (a === '--software') o.software = true;
    else throw new Error(`unknown option ${a}`);
  }
  if (!(o.frames >= 1) || !(o.warmup >= 0)) throw new Error('--frames must be at least 1 and --warmup at least 0');
  return o;
}

const f1 = (v) => (v == null ? '-' : v.toFixed(v < 10 ? 2 : 1));

export function table(results) {
  const rows = [['scene', 'ms/frame', 'fps', 'cpu sim', 'cpu draw', 'gpu span', 'draws', 'triangles']];
  for (const r of results) {
    rows.push([r.scene, f1(r.msPerFrame), r.fps.toFixed(0), f1(r.cpu.simMs?.median), f1(r.cpu.renderMs?.median), f1(r.gpu?.spanMs.median),
      r.renderer ? String(r.renderer.drawCalls) : '-', r.renderer ? r.renderer.triangles.toLocaleString('en') : '-']);
  }
  const w = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
  return rows.map((r, i) => r.map((v, c) => (c === 0 ? v.padEnd(w[c]) : v.padStart(w[c]))).join('  ') + (i === 0 ? '\n' + w.map((x) => '-'.repeat(x)).join('  ') : '')).join('\n');
}

export async function main(argv) {
  const o = parseArgs(argv);
  if (o.software && !useSoftwareGPU()) console.error('--software: no SwiftShader driver found (set VK_ICD_FILENAMES to a vk_*_icd.json yourself)');
  const { NodePlatform } = await import('../src/platform/node.js');
  const { Engine, QUALITY } = await import('../src/index.js');
  const { SCENES, SCENE_NAMES } = await import('./scenes.js');
  const { runScene, describeAdapter } = await import('./run.js');
  if (!QUALITY[o.quality]) throw new Error(`--quality is one of ${Object.keys(QUALITY).join(', ')}`);
  const names = o.scenes ?? SCENE_NAMES;
  for (const n of names) if (!SCENES[n]) throw new Error(`unknown scene "${n}" (have: ${SCENE_NAMES.join(', ')})`);

  const results = [];
  let adapter = null;
  for (const name of names) {
    const platform = new NodePlatform({ width: o.size[0], height: o.size[1] });
    let engine;
    try {
      engine = await Engine.create({ platform, render: SCENES[name].needsGPU, quality: o.quality, baseUrl: ROOT });
    } catch (e) {
      throw new Error(`${e.message}\nNo WebGPU adapter? Install the optional package (npm i webgpu), or on a machine without a GPU add --software to use a software Vulkan driver.`);
    }
    if (engine.stage && !adapter) {
      adapter = describeAdapter(engine.stage.renderer.gpu);
      console.log(`adapter   ${adapter.description || [adapter.vendor, adapter.architecture].filter(Boolean).join(' ') || 'unknown'}${adapter.software ? '   *** SOFTWARE RENDERER: GPU numbers below say nothing about real hardware ***' : ''}`);
      console.log(`target    ${o.size[0]}x${o.size[1]}, quality ${o.quality}, ${o.frames} frames after ${o.warmup} warm-up, GPU timestamps ${adapter.timestamps ? 'available' : 'NOT available (no gpu column)'}`);
      console.log(`host      ${os.cpus()[0]?.model ?? 'cpu'} x${os.cpus().length}, node ${process.version}\n`);
    }
    process.stdout.write(`${name.padEnd(8)} ${SCENES[name].about}\n`);
    const r = await runScene(engine, name, { frames: o.frames, warmup: o.warmup });
    results.push(r);
    engine.dispose();
    if (r.gpuErrors.length) console.error(`  GPU errors in ${name}:`, r.gpuErrors.join(' | '));
  }
  console.log('\n' + table(results) + '\n');
  console.log('times in ms (medians); cpu sim = input + physics + animation + update hooks, cpu draw = recording and submitting the frame,');
  console.log('gpu span = time the frame occupied the GPU, ms/frame = wall clock per frame with CPU and GPU overlapped (no vsync).');
  for (const r of results) {
    if (!r.gpu) continue;
    console.log(`\n${r.scene}: most expensive GPU passes   ` + r.gpu.passes.slice(0, 6).map((p) => `${p.name} ${f1(p.ms)}`).join(' | '));
  }
  if (adapter?.software) console.log('\n*** These numbers come from a software renderer. They prove the benchmark runs; run it on a machine with a GPU for results that mean anything. ***');
  if (o.json) {
    const out = { date: new Date().toISOString(), engine: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version, node: process.version, host: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, platform: process.platform }, adapter, size: o.size, quality: o.quality, results };
    fs.mkdirSync(path.dirname(path.resolve(o.json)), { recursive: true });
    fs.writeFileSync(o.json, JSON.stringify(out, null, 2));
    console.log(`\nwrote ${o.json}`);
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message ?? e); process.exit(1); });
}
