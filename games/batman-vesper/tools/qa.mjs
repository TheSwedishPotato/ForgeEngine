// Plays the film like a person, headless: New game, then at every choice it types its own words
// (or presses a number), answers quick-time events, and screenshots each kind of moment.
// Collects page errors, stuck states and layout problems (UI outside the window).
//   node tools/qa.mjs <width> <height> <minutes> <outDir> [chapter]
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright');
const [, , W = '1280', H = '720', MIN = '6', OUT = 'shots/qa', CH = ''] = process.argv;
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: process.cwd(), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +W, height: +H } });
const log = [], errors = [];
p.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
await p.addInitScript(() => { globalThis.MED_TEXTURE_UNIT_LIMIT = 16; localStorage.clear(); });
await p.goto(server.resolvedUrls.local[0] + 'index.html?q=low' + (CH ? '' : ''), { waitUntil: 'load' });
await p.waitForFunction(() => document.getElementById('menu')?.classList.contains('on'), null, { timeout: 300000 });
let shot = 0;
const snap = async (tag) => { try { await p.screenshot({ path: `${OUT}/${String(++shot).padStart(2, '0')}-${tag}.png`, timeout: 60000 }); } catch (e) { log.push('screenshot failed ' + tag); } };
// UI that sits outside the window (cut off, unreachable)
const offscreen = () => p.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('#ov button, #ov input, #ov .ov-sub, #menu button, .panel.on *')) {
    const r = el.getBoundingClientRect(), st = getComputedStyle(el);
    if (!r.width || !r.height || st.visibility === 'hidden' || st.display === 'none') continue;
    let o = 1; for (let e = el; e; e = e.parentElement) o *= +getComputedStyle(e).opacity; if (o < 0.05) continue;
    if (r.top < -2 || r.left < -2 || r.bottom > innerHeight + 2 || r.right > innerWidth + 2) out.push(`${el.tagName}.${el.className} "${(el.textContent || el.placeholder || '').trim().slice(0, 30)}" at ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return out;
});
await snap('menu');
log.push('menu offscreen: ' + JSON.stringify(await offscreen()));
if (CH) { await p.click('#chapters'); await p.click(`[data-ch="${CH}"]`).catch(() => p.evaluate((c) => window.vesper && null, CH)); }
else await p.evaluate(() => document.getElementById('new').click());   // the menu must be on screen: checked above
await p.evaluate(() => { window.vesper.T.timeScale = 3; });   // faster story time; the bot still waits for every beat
const seen = new Set(); let lastSub = '', sameSince = Date.now(), choices = 0, typed = 0;
const end = Date.now() + +MIN * 60000;
while (Date.now() < end) {
  await p.waitForTimeout(1500);
  const st = await p.evaluate(() => {
    const T = window.vesper.T, q = (s) => document.querySelector(s);
    const choice = q('.ov-choice.on'), qte = q('.ov-qte.on');
    return {
      sub: (q('.ov-sub')?.textContent ?? '').slice(0, 120), choice: !!choice, input: !!choice?.querySelector('input'),
      opts: choice ? [...choice.querySelectorAll('.ov-opt')].map((b) => b.textContent.slice(0, 40)) : [],
      qte: !!qte, qteKey: q('.ov-qte.on .ov-key:not(.done):not(.miss)')?.firstChild?.textContent?.trim() ?? null,
      explore: !!q('.ov-hint.on') && !choice, flow: !!q('.ov-flow.on'), timeScale: T.timeScale,
      card: (q('.ov-card.on, .ov-title.on')?.textContent ?? '').slice(0, 80),
    };
  }).catch((e) => ({ err: e.message }));
  if (st.err) { log.push('evaluate failed: ' + st.err); continue; }
  if (st.sub !== lastSub) { lastSub = st.sub; sameSince = Date.now(); if (st.sub) log.push('sub: ' + st.sub); }
  const kind = st.choice ? 'choice' : st.qte ? 'qte' : st.explore ? 'explore' : st.flow ? 'flowchart' : st.card ? 'card' : null;
  if (kind && !seen.has(kind)) { seen.add(kind); await snap(kind); log.push(`${kind} offscreen: ` + JSON.stringify(await offscreen())); }
  if (st.choice) {
    choices++;
    log.push('choice: ' + JSON.stringify(st.opts) + (st.input ? ' [text box]' : ' [NO text box]'));
    if (st.input && typed < 2) {
      typed++;
      // type a line with a number in it: it must stay text, not pick option 1
      await p.focus('.ov-choice.on input').catch(() => {});
      await p.keyboard.type('I count 3 guards and wait in the dark', { delay: 15 });
      const v = await p.inputValue('.ov-choice.on input').catch(() => '(input gone)');
      log.push('typed -> input now: ' + JSON.stringify(v));
      if (typed === 1) await snap('typing');
      await p.keyboard.press('Enter');
    } else await p.keyboard.press('1');
    sameSince = Date.now();
    continue;
  }
  if (st.qte) { log.push('qte key ' + st.qteKey); if (st.qteKey) await p.keyboard.press(/^space$/i.test(st.qteKey) ? 'Space' : st.qteKey.length === 1 ? 'Key' + st.qteKey.toUpperCase() : st.qteKey); continue; }
  if (st.explore) { await p.keyboard.down('KeyW'); await p.waitForTimeout(800); await p.keyboard.up('KeyW'); await p.keyboard.press('KeyE'); await p.keyboard.press('KeyC'); continue; }
  if (Date.now() - sameSince > 60000) { log.push('STUCK: nothing changed for 60 s'); await snap('stuck'); sameSince = Date.now(); }
}
await snap('end');
writeFileSync(`${OUT}/log.txt`, [...log, '', 'ERRORS:', ...errors].join('\n'));
console.log(`choices ${choices}, typed ${typed}, kinds ${[...seen].join(',')}, errors ${errors.length}`);
console.log(errors.slice(0, 10).join('\n'));
await b.close(); await server.close();
