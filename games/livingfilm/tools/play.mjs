// Plays the demo reel headless through the whole app: start, research, streamed scene, bubbles, sheet, second turn, status update.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const q = process.argv[2] ?? 'low';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +(process.env.W ?? 1100), height: +(process.env.H ?? 680) } });
let errs = 0;
page.on('pageerror', (e) => { errs++; console.log('[pageerror]', e.message, (e.stack ?? '').split('\n').slice(1, 3).join(' | ')); });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 240)); });
const shot = async (name) => { await page.screenshot({ path: `shots/play_${name}.png`, timeout: 60000 }); console.log('shot', name); };
await page.goto(`http://127.0.0.1:5175/?demo=1&q=${q}`);
await page.waitForSelector('.start .begin', { timeout: 120000 });
await page.evaluate(() => { localStorage.clear(); });
await shot('start');
await page.evaluate(() => document.querySelector('.start .begin').click());
let maxB = 0;
for (let i = 0; i < 60; i++) { await page.waitForTimeout(500); maxB = Math.max(maxB, await page.evaluate(() => document.querySelectorAll('.bubble.on').length)); if (maxB && i % 4 === 0) await shot('bubbles'); const t = await page.evaluate(() => document.querySelector('.sub')?.innerText ?? ''); if (/basket/.test(t)) break; }
console.log('bubbles seen at once (max):', maxB);
await shot('scene1');
await page.waitForFunction(() => document.querySelectorAll('.chips button').length === 5, null, { timeout: 90000 });
console.log('chips:', await page.evaluate(() => [...document.querySelectorAll('.chips button')].map((b) => b.innerText.replace(/\s+/g, ' ')).join(' | ')));
await page.evaluate(() => document.querySelector('.corner [data-a=sheet]').click());
await page.waitForSelector('.sheet .page', { timeout: 30000 });
await page.waitForTimeout(800);
await shot('sheet_person');
await page.evaluate(() => document.querySelector('.sheet [data-tab=people]').click()); await shot('sheet_people');
await page.evaluate(() => document.querySelector('.sheet [data-tab=book]').click()); await shot('sheet_book');
await page.evaluate(() => document.querySelector('.sheet .shut').click());
await page.evaluate(() => document.querySelector('.chips button').click());
for (let i = 0; i < 60; i++) { await page.waitForTimeout(1000); if (await page.evaluate(() => !!document.querySelector('.reckoning'))) break; await page.keyboard.press('Space'); }
await shot('reckoning');
const st = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('living-film-story')); return { turns: s.counters.turns, scenes: s.counters.scenes, places: Object.keys(s.places), reports: s.reports.length, chapters: s.chapters.map((c) => c.title + ':' + c.scenes.length), sheetAge: s.player.sheet.age, codex: s.codex.entries.length, built: [...(window.medStage ? [] : [])] }; });
console.log(JSON.stringify(st));
console.log('built places:', await page.evaluate(() => window.__stage ? [...window.__stage.places.keys()] : 'n/a'));
console.log('errors', errs);
await browser.close();
