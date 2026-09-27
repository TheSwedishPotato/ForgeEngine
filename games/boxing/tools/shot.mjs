// Screenshot helper: node tools/shot.mjs <url-path> <out-prefix> t1,t2,...
// Needs the dev server (npm run dev). Uses the preinstalled Chromium.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const [, , path = '/lab.html', prefix = 'shots/lab', times = '1'] = process.argv;
const width = parseInt(process.env.W ?? '1100'), height = parseInt(process.env.H ?? '700');
mkdirSync(prefix.split('/').slice(0, -1).join('/') || '.', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width, height } });
page.on('console', (m) => { if (m.type() === 'error' || process.env.VERBOSE) console.log('[page]', m.type(), m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const sep = path.includes('?') ? '&' : '?';
await page.goto(`http://127.0.0.1:5173${path}${sep}manual=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.lab || window.game, null, { timeout: 60000 });
for (const t of times.split(',')) {
  await page.evaluate((tt) => (window.lab ?? window.game).stepTo(parseFloat(tt)), t);
  await page.screenshot({ path: `${prefix}_${t}.png` });
}
const log = await page.evaluate(() => (window.lab ?? window.game).log?.slice(-40) ?? []);
if (log.length) console.log(log.join('\n'));
await browser.close();
