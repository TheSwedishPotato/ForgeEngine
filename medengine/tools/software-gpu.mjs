/**
 * For machines without a GPU (CI, containers): points Vulkan at a software driver so the headless tools can still run. Dawn finds
 * Vulkan drivers through the VK_ICD_FILENAMES environment variable, and the SwiftShader driver that ships with every Chromium and
 * Playwright download is a fine one. It is slow and its timings say nothing about real GPUs - the tools that measure speed only
 * use it when told to (`--software`), never silently.
 *
 *   import { useSoftwareGPU } from '../tools/software-gpu.mjs';
 *   if (flags.software) useSoftwareGPU();      // before the first getGPU()
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** Looks for a vk_swiftshader_icd.json in the places Chromium builds and Playwright put it. Returns its path or null. */
export function findSoftwareICD() {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers', path.join(os.homedir(), '.cache', 'ms-playwright'),
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'), path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')].filter(Boolean);
  for (const root of roots) {
    let dirs;
    try { dirs = fs.readdirSync(root); } catch { continue; }
    for (const d of dirs.filter((n) => /^chromium/i.test(n)).sort().reverse()) {
      const base = path.join(root, d);
      let subs;
      try { subs = fs.readdirSync(base); } catch { continue; }
      for (const s of subs) {
        const f = path.join(base, s, 'vk_swiftshader_icd.json');
        if (fs.existsSync(f)) return f;
      }
    }
  }
  return null;
}

/** Sets VK_ICD_FILENAMES to a software driver (unless the caller already chose one). Returns the driver's path, or null when none was found. */
export function useSoftwareGPU() {
  if (process.env.VK_ICD_FILENAMES) return process.env.VK_ICD_FILENAMES;
  const icd = findSoftwareICD();
  if (icd) process.env.VK_ICD_FILENAMES = icd;
  return icd;
}

// `node tools/software-gpu.mjs` prints the driver's path, for VK_ICD_FILENAMES in a shell (Deno, other tools).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const icd = findSoftwareICD();
  if (icd) console.log(icd); else { console.error('no SwiftShader Vulkan driver found: install a Chromium with `npx playwright install chromium`'); process.exitCode = 1; }
}
