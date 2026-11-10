/**
 * The benchmark in a browser (open /bench/ while `npm run demo` is serving the package): the same scenes and the same measuring code
 * as bench/bench.mjs, on the real canvas and the real GPU process of the browser.
 *
 *   ?auto=1&scenes=ford,physics&frames=60&warmup=10&size=1280x720&quality=medium   runs by itself and sets window.benchResult
 *   (size: any WIDTHxHEIGHT; scenes: ford, crowd, lights, draws, physics)
 */
import { Engine, QUALITY } from '../src/index.js';
import { BrowserPlatform } from '../src/platform/browser.js';
import { SCENES, SCENE_NAMES } from './scenes.js';
import { runScene, describeAdapter } from './run.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const f1 = (v) => (v == null ? '-' : v.toFixed(v < 10 ? 2 : 1));
let last = null;

for (const n of SCENE_NAMES) {
  const l = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox'; box.value = n;
  box.checked = params.has('scenes') ? params.get('scenes').split(',').includes(n) : true;
  const small = document.createElement('small'); small.textContent = SCENES[n].about;
  l.append(box, document.createTextNode(n + ' '), small);
  $('scenes').append(l);
}
if (/^\d+x\d+$/.test(params.get('size') ?? '')) {                      // any WIDTHxHEIGHT: the menu only lists the usual ones
  const wanted = params.get('size');
  if (![...$('size').options].some((o) => o.value === wanted)) $('size').append(new Option(wanted.replace('x', ' × '), wanted));
  $('size').value = wanted;
}
if (QUALITY[params.get('quality')]) $('quality').value = params.get('quality');
if (params.has('frames')) $('frames').value = params.get('frames');
if (params.has('warmup')) $('warmup').value = params.get('warmup');

const status = (t) => { $('status').textContent = t; };

/** One scene on a fresh engine and canvas, disposed afterwards so that a long run does not pile up GPU devices. */
async function measure(name, size, quality, frames, warmup) {
  const needs = SCENES[name].needsGPU;
  const canvas = document.createElement('canvas');
  const stage = $('stage');
  stage.hidden = !needs;
  stage.replaceChildren();
  if (needs) {
    canvas.style.width = `${size[0]}px`; canvas.style.height = `${size[1]}px`;     // sized in CSS pixels; maxDpr 1 below makes that the render size on every display
    stage.append(canvas);
  }
  const engine = await Engine.create({ platform: new BrowserPlatform({ canvas, maxDpr: 1 }), render: needs, quality, baseUrl: new URL('../', import.meta.url).href });
  try {
    const result = await runScene(engine, name, { frames, warmup });
    const gpu = engine.stage?.renderer.gpu;
    return { result, adapter: gpu ? describeAdapter(gpu) : null };
  } finally { engine.dispose(); }
}

async function run() {
  $('run').disabled = true; $('save').disabled = true;
  const names = [...$('scenes').querySelectorAll('input:checked')].map((i) => i.value);
  const size = $('size').value.split('x').map(Number), quality = $('quality').value;
  const frames = Math.max(10, Number($('frames').value) | 0), warmup = Math.max(0, Number($('warmup').value) | 0);
  const results = [];
  let adapter = null;
  try {
    for (const [i, name] of names.entries()) {
      status(`${name} (${i + 1}/${names.length}) …`);
      const m = await measure(name, size, quality, frames, warmup);
      adapter ??= m.adapter;
      results.push(m.result);
      await new Promise((r) => setTimeout(r, 50));
    }
  } catch (e) {
    console.error(e);
    status(`failed: ${e.message}`);
    $('run').disabled = false;
    return null;
  }
  last = {
    date: new Date().toISOString(), engine: '3.0.0', userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency, dpr: devicePixelRatio, adapter, size, quality, results,
  };
  show(last);
  status(`done: ${results.length} scene${results.length === 1 ? '' : 's'}`);
  $('run').disabled = false; $('save').disabled = false;
  window.benchResult = last;
  return last;
}

function show(out) {
  const a = out.adapter;
  $('adapter').replaceChildren();
  const line = (k, v) => { const d = document.createElement('div'); const b = document.createElement('b'); b.textContent = v; d.append(`${k}: `, b); $('adapter').append(d); };
  line('adapter', a ? (a.description || [a.vendor, a.architecture, a.device].filter(Boolean).join(' ') || 'unknown') : 'none (no scene used the GPU)');
  line('target', `${out.size[0]} × ${out.size[1]}, quality ${out.quality}, GPU timestamps ${a?.timestamps ? 'available' : 'not available'}`);
  line('browser', out.userAgent);
  const warn = $('warn');
  warn.style.display = a?.software ? 'block' : 'none';
  warn.textContent = a?.software ? 'This adapter is a software renderer: the GPU numbers describe a CPU pretending to be a GPU. Run this on a machine with a GPU for results that mean anything.' : '';
  $('results').hidden = false;
  const rows = $('rows'); rows.replaceChildren();
  const passes = $('passes'); passes.replaceChildren();
  for (const r of out.results) {
    const tr = document.createElement('tr');
    for (const v of [r.scene, f1(r.msPerFrame), r.fps.toFixed(0), f1(r.cpu.simMs?.median), f1(r.cpu.renderMs?.median), f1(r.gpu?.spanMs.median), r.renderer ? r.renderer.drawCalls : '-', r.renderer ? r.renderer.triangles.toLocaleString('en') : '-']) {
      const td = document.createElement('td'); td.textContent = v; tr.append(td);
    }
    rows.append(tr);
    if (r.gpu) { const p = document.createElement('div'); p.className = 'passes'; p.textContent = `${r.scene}: ${r.gpu.passes.slice(0, 6).map((x) => `${x.name} ${f1(x.ms)}`).join(' · ')}`; passes.append(p); }
  }
}

$('run').addEventListener('click', run);
$('save').addEventListener('click', () => {
  if (!last) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(last, null, 2)], { type: 'application/json' }));
  a.download = `medengine-bench-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
});

if (!navigator.gpu) {
  status(isSecureContext ? 'This browser has no WebGPU.' : 'WebGPU needs https or http://localhost: serve the package with `npm run demo` and open /bench/.');
  $('run').textContent = 'Not available';
} else {
  $('run').textContent = 'Run benchmark'; $('run').disabled = false;
  if (params.get('auto') === '1') run();
}
