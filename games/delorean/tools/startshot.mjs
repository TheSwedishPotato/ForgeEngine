// The start screen, at a phone's size: node tools/startshot.mjs out.png
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const out = process.argv[2] ?? 'shots/start.png';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 390), height: Number(process.env.H ?? 844) }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${process.env.PORT ?? 5178}/`, { waitUntil: 'load' });
await page.waitForSelector('.start .go', { timeout: 60000 });
await page.screenshot({ path: out });
await browser.close();
console.log('wrote', out);
