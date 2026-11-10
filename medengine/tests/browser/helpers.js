// Shared by the browser tests: finds Playwright and its Chromium, starts the package's static server, and opens a page with the flags that
// give WebGPU on a machine without a GPU. Everything here is optional tooling: tests skip themselves when it is missing.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startServer } from '../../tools/serve.mjs';

const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* optional */ }
let exe = null;
try { exe = chromium && fs.existsSync(chromium.executablePath()) ? chromium.executablePath() : null; } catch { /* no browser downloaded */ }

/** A reason for `{ skip }`, or false when a browser is available. */
export const skip = exe ? false : 'Playwright with a Chromium build is not installed';

/** MED_REAL_GPU=1 leaves the machine's own GPU in charge instead of pointing Chromium at its bundled SwiftShader. */
export const REAL = !!process.env.MED_REAL_GPU;
const ARGS = ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--ignore-gpu-blocklist',
  ...(REAL ? [] : ['--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader'])];
const env = { ...process.env };
if (!REAL && !env.VK_ICD_FILENAMES) {
  // Without it Chromium's own Vulkan set-up finds no driver, and the first canvas it presents loses the WebGPU device.
  const icd = path.join(path.dirname(exe ?? ''), 'vk_swiftshader_icd.json');
  if (fs.existsSync(icd)) env.VK_ICD_FILENAMES = icd;
}

/** A fresh Chromium with the flags above. */
export const launch = () => chromium.launch({ args: ARGS, env });

/** MED_SHOTS=<dir> keeps the page screenshots, for looking at. */
export const SHOTS = process.env.MED_SHOTS ?? null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
export const photo = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), timeout: 120000 }); };

/**
 * Opens `<server>/<path>` in a fresh Chromium. `problems` collects console errors and warnings, uncaught errors and failed requests;
 * `gpu: false` hides navigator.gpu to see how the page copes without WebGPU.
 */
export async function open({ path: pagePath = 'demo/', query = '', gpu = true, size = [640, 360] } = {}) {
  const server = await startServer({ port: 0 });
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: size[0], height: size[1] } });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  if (!gpu) await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true }); });
  await page.goto(`${server.url}${pagePath}${query}`);
  return { page, problems, url: server.url, close: async () => { await browser.close(); await server.close(); } };
}
