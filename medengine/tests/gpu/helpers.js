// Shared setup for GPU tests. They run on real Dawn through the optional "webgpu" package and are
// skipped when no adapter can be created (no GPU, no software Vulkan driver, package not installed).
import fs from 'node:fs';
import process from 'node:process';
import { NodePlatform } from '../../src/platform/node.js';
import { DenoPlatform } from '../../src/platform/deno.js';
import { GPU } from '../../src/gpu/Device.js';

/** The same tests run on Node (Dawn, through the `webgpu` package) and on Deno (wgpu): two independent WebGPU implementations. */
export const isDeno = typeof Deno !== 'undefined';
export const makePlatform = (opts = {}) => (isDeno ? new DenoPlatform({ headless: true, ...opts }) : new NodePlatform(opts));

const SWIFTSHADER = [
  '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/vk_swiftshader_icd.json',
  '/opt/pw-browsers/chromium-1243/chrome-linux64/vk_swiftshader_icd.json',
];
if (!process.env.VK_ICD_FILENAMES && !process.env.MED_REAL_GPU) {
  const icd = SWIFTSHADER.find((p) => fs.existsSync(p));
  if (icd) process.env.VK_ICD_FILENAMES = icd;
}

let cached;
/** Resolves to { platform, gpu } or null when WebGPU is unavailable. */
export async function gpuContext(opts = {}) {
  if (cached === undefined || opts.fresh) {
    cached = (async () => {
      try {
        const platform = makePlatform(opts);
        const gpu = await GPU.create({ gpu: await platform.getGPU() });
        return { platform, gpu };
      } catch (e) { console.warn('[gpu tests] skipped:', e.message); return null; }
    })();
  }
  return cached;
}
