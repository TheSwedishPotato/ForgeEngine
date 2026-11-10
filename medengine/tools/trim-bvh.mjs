#!/usr/bin/env node
// Shrinks a BVH for shipping: fewer frames per second, fewer decimals. The capture's own rest frame (frame 0) is kept.
//   node tools/trim-bvh.mjs in.bvh out.bvh [--fps 30] [--decimals 2]
import fs from 'node:fs';
import { parseBVH, writeBVH } from '../src/anim/BVH.js';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? +args[i + 1] : d; };
const files = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (files.length < 2) { console.error('usage: trim-bvh in.bvh out.bvh [--fps 30] [--decimals 2]'); process.exit(1); }
const bvh = parseBVH(fs.readFileSync(files[0], 'utf8'), files[0]);
const text = writeBVH(bvh, { fps: opt('fps', 30), decimals: opt('decimals', 2) });
fs.writeFileSync(files[1], text);
console.log(`${files[0]} (${bvh.frames} frames @ ${bvh.fps.toFixed(0)} fps) -> ${files[1]} (${(text.length / 1024).toFixed(0)} KB)`);
