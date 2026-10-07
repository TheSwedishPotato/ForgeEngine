// Plays the test reel (?demo=1) headless and photographs each beat.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
let errs = 0; page.on('pageerror', (e) => { errs++; console.log('[err]', e.message, e.stack?.split('\n')[1]); });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 200)); });
await page.goto('http://127.0.0.1:5175/?demo=1');
await page.waitForSelector('.begin');
await page.screenshot({ path: 'shots/start.png' });
await page.evaluate(() => document.querySelector('.begin').click());
let shot = 0;
const snap = async (n) => { await page.waitForTimeout(n); await page.screenshot({ path: `shots/beat_${shot++}.png` }); };
await snap(3500);           // establishing (after the title card)
for (let i = 0; i < 3; i++) { await page.mouse.click(640, 300); await snap(1800); }
await page.mouse.click(640, 300); await page.waitForTimeout(800);
await page.screenshot({ path: `shots/controls.png` });
await page.evaluate(() => { const i = document.querySelector('.say input'); i.value = 'Only bread, sir.'; document.querySelector('.say').requestSubmit(); });
await snap(4200);
for (let i = 0; i < 3; i++) { await page.mouse.click(640, 300); await snap(1800); }
console.log('errors', errs);
await browser.close();
