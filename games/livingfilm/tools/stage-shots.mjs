// Photographs every shot of the 3D stage test page.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const qs = process.argv[2] ?? '';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
let errs = 0; page.on('pageerror', (e) => { errs++; console.log('[err]', e.message, (e.stack ?? '').split('\n').slice(1, 3).join(' | ')); });
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || /warn/i.test(m.type())) console.log('[' + m.type() + ']', t.slice(0, 220)); });
await page.goto('http://127.0.0.1:5175/stage-test.html?' + qs);
await page.waitForFunction(() => window.S, null, { timeout: 120000 });
const tag = (process.argv[3] ?? 'stage');
for (let k = 0; k < 7; k++) {
  await page.waitForTimeout(k === 0 ? 9000 : 4500);
  await page.screenshot({ path: `shots/${tag}_${k}.png` });
  console.log(k, await page.evaluate(() => window.next()));
}
console.log('errors', errs);
await browser.close();
