// Screenshots of the illustrated story at a given moment.
//   node tools/story-shot.mjs out.png [seconds=14] [width=1280] [height=800] [chapter]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright')); }
const [, , out = 'shots/story.png', secs = '14', w = '1280', h = '800', chapter = ''] = process.argv;
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(server.resolvedUrls.local[0] + 'story.html' + (chapter ? `?chapter=${chapter}` : ''), { waitUntil: 'load' });
await page.click('#go');
await page.waitForTimeout(+secs * 1000);
await page.screenshot({ path: out });
console.log('saved', out);
await browser.close();
await server.close();
