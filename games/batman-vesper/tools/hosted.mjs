// Emulates the claude.ai artifact host for a packaged page: the host's document skeleton around the
// page, its files served beside it, a CSP that blocks other origins, and a strict stand-in for
// window.claude's `sample` (rejects malformed calls the way the contract says the runtime does).
//   npm run build:artifact && node tools/hosted.mjs . story shots/hosted.png
//   PLAY=150 node tools/hosted.mjs . film shots/hosted.jpg 90     (film: starts a new game, captures the canvas)
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const { chromium } = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright');
const [, , game, name, out, secs = '20'] = process.argv;
const DIST = join(game, 'dist');
const page = readFileSync(join(game, 'dist-artifact', name + '.html'), 'utf8');
const list = JSON.parse(readFileSync(join(game, 'dist-artifact', name + '.publish.json'), 'utf8'));
const files = Object.fromEntries(list.map((e) => [e.path, e]));
const doc = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}body{margin:0}</style></head><body>' + page + '</body></html>';
// only what the host serves; anything else in the list is a packaging bug
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.txt': 'text/plain' };
const CSP = "default-src 'self' blob: data:; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' blob: data:; img-src 'self' blob: data:; media-src 'self' blob: data:";
let missing = [], served = [];
const srv = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '');
  if (p === '' || p === 'index.html') { res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': CSP }); return res.end(doc); }
  const src = join(game, 'dist-artifact', name, p);
  if (!(p in files) || !existsSync(src)) { missing.push(p); res.writeHead(404); return res.end(); }
  const type = files[p].contentType ?? TYPES[extname(p)];
  if (!type) throw new Error('unserved type: ' + p);
  served.push(p);
  res.writeHead(200, { 'content-type': type });
  res.end(readFileSync(src));
}).listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const url = `http://127.0.0.1:${srv.address().port}/`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const tab = await browser.newPage({ viewport: name === 'story' ? { width: 430, height: 900 } : { width: 1280, height: 720 } });
const errors = [];
tab.on('pageerror', (e) => errors.push(e.message));
tab.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
await tab.addInitScript(() => {
  globalThis.MED_TEXTURE_UNIT_LIMIT = 16;   // what Chrome on Windows (Direct3D) and many phones allow
  const calls = (window.__calls = []);
  const TIERS = ['quick', 'default', 'complex'];
  const check = (input, o) => {
    if (!(typeof input === 'string' && input.trim()) && !(Array.isArray(input) && input.length && input[0].role === 'user' && input.at(-1).role === 'user')) throw { code: 'invalid_request', message: 'input' };
    if (o === undefined) return;
    if (Object.getPrototypeOf(o) !== Object.prototype) throw { code: 'invalid_request', message: 'options not plain' };
    for (const [k, v] of Object.entries(o)) if (v === undefined) throw { code: 'invalid_request', message: `option ${k} is undefined` };
    if ('signal' in o && !(o.signal instanceof AbortSignal)) throw { code: 'invalid_request', message: 'signal' };
    if ('onText' in o && typeof o.onText !== 'function') throw { code: 'invalid_request', message: 'onText' };
    if ('modelTier' in o && !TIERS.includes(o.modelTier)) throw { code: 'invalid_request', message: 'modelTier ' + o.modelTier };
  };
  const sample = async (input, o) => { check(input, o); calls.push({ verb: 'sample', bytes: JSON.stringify(input).length, o: Object.keys(o ?? {}) }); const text = 'The rain keeps falling.'; o?.onText?.({ text, delta: text }); return { text, truncated: false, modelTierApplied: o?.modelTier ?? 'default' }; };
  sample.json = async (input, o) => {
    check(input, o); calls.push({ verb: 'json', bytes: JSON.stringify(input).length, o: Object.keys(o ?? {}), tier: o?.modelTier });
    return { mapped: null, speech: 'Not tonight.', emotion: 'grim', reply: { who: 'rook', text: 'MOCK REPLY FROM CLAUDE', emotion: 'afraid' } };
  };
  sample.limits = async () => ({ maxPromptBytes: 262144 });
  const store = (window.__db = {});
  const db = { doc: (path) => ({ set: async (d) => { if (JSON.stringify(d).length > 262144) throw { code: 'invalid_argument' }; store[path] = d; } }) };
  Object.defineProperty(window, 'claude', { value: Object.freeze({ use: async (n) => (n === 'sample' ? sample : n === 'db' ? db : null) }) });
});
await tab.goto(url + (name === 'film' ? '?q=' + (process.env.Q ?? 'low') : ''), { waitUntil: 'load' });
if (name === 'story') {
  await tab.waitForFunction(() => document.getElementById('cstat')?.textContent.includes('Claude'), null, { timeout: 30000 });
  console.log('status:', await tab.textContent('#cstat'), '| key row hidden:', await tab.$eval('#keyrow', (e) => e.style.display === 'none'));
  await tab.click('#go');
  await tab.waitForFunction(() => { const t = document.querySelector('.st-input textarea'); return t && !t.disabled; }, null, { timeout: +secs * 1000 * 6 });
  await tab.fill('.st-input textarea', 'I wait in the dark and listen before I move.');
  await tab.click('.st-send');
  await tab.waitForFunction(() => document.body.innerText.includes('MOCK REPLY FROM CLAUDE'), null, { timeout: 60000 }).then(() => console.log('Claude reply shown on screen'), () => console.log('Claude reply NOT shown'));
  await tab.waitForTimeout(1500);
  await tab.screenshot({ path: out });
} else {
  const t0 = Date.now();
  await tab.waitForFunction(() => document.getElementById('menu')?.classList.contains('on'), null, { timeout: +secs * 1000 }).catch(() => {});
  console.log('menu after', ((Date.now() - t0) / 1000).toFixed(1), 's');
  const state = await tab.evaluate(() => ({ title: document.title, menu: document.getElementById('menu')?.classList.contains('on'), loading: document.getElementById('loading')?.className, claude: document.getElementById('claude-status')?.textContent, keyRowHidden: document.getElementById('claude-key-row')?.style.display === 'none' }));
  console.log('film state:', JSON.stringify(state));
  if (process.env.PLAY) { await tab.click('#new', { timeout: 300000 }); await tab.waitForTimeout(+process.env.PLAY * 1000); console.log('subtitle:', await tab.evaluate(() => document.querySelector('[class*=sub]')?.textContent?.slice(0, 120))); }
  const jpg = await tab.evaluate(() => window.__capture());
  (await import('node:fs')).writeFileSync(out, Buffer.from(jpg.split(',')[1], 'base64'));
}
console.log('sample calls:', JSON.stringify(await tab.evaluate(() => window.__calls)));
console.log('packed binaries fetched:', served.filter((x) => x.endsWith('.b64.txt')).length, served.filter((x) => x.endsWith('.b64.txt')).map((x) => x.split('/').pop().replace('.b64.txt', '')).join(' '));
const dbDocs = await tab.evaluate(() => window.__db).catch(() => ({}));
for (const [k, v] of Object.entries(dbDocs ?? {})) console.log('db', k, JSON.stringify({ ready: v.ready, gl: v.gl, steps: v.steps, errors: v.errors }).slice(0, 900));
console.log('missing files:', missing.length ? missing.slice(0, 10) : 'none');
console.log('errors:', errors.length ? errors.slice(0, 8) : 'none');
await browser.close(); srv.close();
