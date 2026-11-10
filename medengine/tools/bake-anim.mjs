#!/usr/bin/env node
// Bakes the shipped motion-capture clips for the default mannequin:
//   node tools/bake-anim.mjs [--in assets/mocap/cmu] [--out assets/anim/humanoid] [--height 1.75]
// Reads <in>/clips.json and the BVH files it names, retargets, loops, detects events and writes one
// .medclip per clip plus <out>/manifest.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBVH } from '../src/anim/BVH.js';
import { Humanoid } from '../src/anim/Humanoid.js';
import { bakeAll } from '../src/anim/Bake.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const inDir = path.resolve(root, opt('in', 'assets/mocap/cmu')), outDir = path.resolve(root, opt('out', 'assets/anim/humanoid'));
const manifest = JSON.parse(fs.readFileSync(path.join(inDir, 'clips.json'), 'utf8'));
const hum = new Humanoid({ height: +opt('height', 1.75) });
const cache = new Map();
const bvh = (file) => { if (!cache.has(file)) cache.set(file, parseBVH(fs.readFileSync(path.join(inDir, file), 'utf8'), file)); return cache.get(file); };
const clips = bakeAll(manifest, { bvh, rig: hum.rig });
fs.mkdirSync(outDir, { recursive: true });
const out = { credit: manifest.credit, license: manifest.license, skeleton: 'medengine-humanoid', clips: {} };
for (const [name, clip] of clips) {
  const bin = Buffer.from(clip.toBinary());
  fs.writeFileSync(path.join(outDir, `${name}.medclip`), bin);
  out.clips[name] = {
    file: `${name}.medclip`, duration: +clip.duration.toFixed(3), loop: clip.loop, rootTravel: +clip.rootTravel.toFixed(3),
    events: clip.events.map((e) => ({ time: +e.time.toFixed(3), name: e.name, data: e.data })), bytes: bin.length, description: clip.meta.description, credit: clip.meta.credit ?? '',
  };
  console.log(name.padEnd(6), `${clip.duration.toFixed(2)} s`.padStart(8), clip.loop ? 'loop' : '    ', `${(bin.length / 1024).toFixed(0)} KB`.padStart(7), `travel ${clip.rootTravel.toFixed(2)} m`.padStart(16), `events: ${clip.events.map((e) => e.name + '@' + e.time.toFixed(2)).join(' ') || '-'}`);
}
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(out, null, 1));
