// Screenshots of the commercial at chosen times: node tools/shots.mjs 2 9 18 ...
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
import { serve } from './serve.mjs';

const times = process.argv.slice(2).map(Number);
const out = new URL('../shots/', import.meta.url);
await mkdir(out, { recursive: true });
const server = await serve(5192);
const browser = await chromium.launch();
const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 1000 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
// Fonts come from Google Fonts; retry until every face the canvas uses has arrived.
for (let attempt = 1; ; attempt++) {
  await page.goto('http://localhost:5192/commercial.html?render=1');
  await page.waitForFunction(() => window.commercial);
  if (await page.evaluate(() => window.commercial.ready())) break;
  if (attempt === 4) throw new Error('fonts did not load');
}
for (const t of times.length ? times : [2, 9, 18, 26, 34, 41, 45, 50, 56, 61, 64.5]) {
  const url = await page.evaluate((t) => window.commercial.frame(t), t);
  await writeFile(new URL(`t${String(t).padStart(5, '0')}.jpg`, out), Buffer.from(url.split(',')[1], 'base64'));
}
await page.goto('http://localhost:5192/commercial.html');
await page.waitForTimeout(1500);
await page.screenshot({ path: new URL('page.png', out).pathname, fullPage: true });
console.log(errors.filter((e) => !/fonts|ERR_CERT|net::/.test(e)).join('\n') || 'no errors');
await browser.close();
server.close();
