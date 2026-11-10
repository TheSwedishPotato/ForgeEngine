/**
 * The measuring part of the benchmark: runs one scene for a number of frames and reports what the CPU and the GPU did.
 * Platform-neutral (bench.mjs runs it headless on Node, index.html in a browser).
 *
 *   cpu.simMs      JS time for input, fixed steps (physics, animation) and the update hooks, per frame
 *   cpu.renderMs   JS time to walk the scene and record + submit the frame's commands, per frame
 *   gpu.spanMs     time the frame occupied the GPU (first pass begins to last pass ends), from timestamp queries; null without support
 *   gpu.passes     the passes that cost the most, in ms
 *   msPerFrame     wall-clock time per frame with the CPU and the GPU running ahead of each other (the queue is drained every
 *                  `sync` frames): what a game that never waits for vsync would achieve. This is the number to quote.
 */
import { SCENES } from './scenes.js';

const now = () => performance.now();

export function summarize(values) {
  if (!values.length) return null;
  const a = values.slice().sort((x, y) => x - y), n = a.length, at = (q) => a[Math.min(n - 1, Math.floor(q * n))];
  return { mean: a.reduce((s, v) => s + v, 0) / n, median: at(0.5), p95: at(0.95), p99: at(0.99), max: a[n - 1] };
}

/** What the adapter says about itself, and whether that looks like a software renderer (whose numbers mean nothing about real GPUs). */
export function describeAdapter(gpu) {
  const i = gpu?.adapter?.info ?? {};
  const text = [i.vendor, i.architecture, i.device, i.description].filter(Boolean).join(' ');
  return {
    vendor: i.vendor ?? '', architecture: i.architecture ?? '', device: i.device ?? '', description: i.description ?? '',
    isFallbackAdapter: !!(gpu?.adapter?.isFallbackAdapter ?? i.isFallbackAdapter),
    software: /swiftshader|llvmpipe|lavapipe|softpipe|software|cpu|basic render/i.test(text) || !!(gpu?.adapter?.isFallbackAdapter ?? i.isFallbackAdapter),
    timestamps: !!gpu?.hasTimestamps,
  };
}

/**
 * @param {Engine} engine        a fresh engine (the scene is built into it)
 * @param {string} name          a key of SCENES
 * @param {object} [o]
 * @param {number} [o.frames]    measured frames (default 120)
 * @param {number} [o.warmup]    frames before that: shaders compile, textures upload, the physics settles (default 30)
 * @param {number} [o.dt]        simulated seconds per frame (default 1/60)
 * @param {number} [o.sync]      wait for the GPU every this many frames (default 4): bounds the queue without serialising CPU and GPU
 * @param {object} [o.scene]     options for the scene's builder (a smaller crowd, fewer lights ...)
 */
export async function runScene(engine, name, { frames = 120, warmup = 30, dt = 1 / 60, sync = 4, scene: sceneOptions = {} } = {}) {
  const def = SCENES[name];
  if (!def) throw new Error(`unknown scene "${name}"`);
  const scene = await def.build(engine, sceneOptions);
  const stage = engine.stage, gpu = stage?.renderer.gpu, draw = !!stage && def.needsGPU;
  const timed = draw && stage.enableGpuTiming(true);
  const drain = async () => { if (draw) await gpu.idle(); };

  for (let i = 0; i < warmup; i++) {
    scene.frame(i, dt);
    engine.tick(dt, draw);
    if (draw && i % sync === sync - 1) await gpu.idle();
  }
  await drain();
  if (timed) { await stage.renderer.timer.flush(); stage.renderer.timer.reset(); }
  const gpuSamples = [];
  if (timed) stage.renderer.timer.onSample = (s) => gpuSamples.push(s);
  if (gpu) gpu.errors.length = 0;

  const sim = [], render = [];
  const t0 = now();
  for (let i = 0; i < frames; i++) {
    scene.frame(warmup + i, dt);
    const a = now();
    engine.tick(dt, false);
    const b = now();
    sim.push(b - a);
    if (draw) {
      stage.render(dt);
      render.push(now() - b);
      if (i % sync === sync - 1) await gpu.idle();
    }
  }
  await drain();
  const wall = now() - t0;
  if (timed) { await stage.renderer.timer.flush(); stage.renderer.timer.onSample = null; }

  // per-pass GPU time, averaged over the measured frames
  const total = {};
  for (const s of gpuSamples) for (const [k, v] of Object.entries(s.passes)) total[k] = (total[k] ?? 0) + v;
  const passes = Object.entries(total).map(([k, v]) => ({ name: k, ms: v / gpuSamples.length })).sort((x, y) => y.ms - x.ms);
  const rs = stage?.renderer.stats;
  const result = {
    scene: name, about: def.about, frames, warmup,
    wallMs: wall, msPerFrame: wall / frames, fps: 1000 / (wall / frames),
    cpu: { simMs: summarize(sim), renderMs: summarize(render) },
    gpu: timed && gpuSamples.length ? { frames: gpuSamples.length, spanMs: summarize(gpuSamples.map((s) => s.spanMs)), passes: passes.slice(0, 10), untimed: stage.renderer.timer.untimed } : null,
    renderer: rs ? { drawCalls: rs.drawCalls, triangles: rs.triangles, items: rs.items, culled: rs.culled, lights: rs.lights, shadowedLights: rs.shadowedLights } : null,
    bodies: engine.physics.bodies?.length ?? null,
    gpuErrors: gpu ? gpu.errors.slice(0, 5) : [],
  };
  scene.dispose?.();
  if (timed) stage.enableGpuTiming(false);
  return result;
}
