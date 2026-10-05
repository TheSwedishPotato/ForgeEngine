// Plays a few minutes of town life in the browser with real keys: walk, enter the tavern, talk, buy.
//   node tools/lifeplay.mjs
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message, e.stack?.split('\n').slice(1, 3).join(' | ')));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 300)); });
await page.goto('http://127.0.0.1:5174/?manual=1&quality=low&life=1&begin=sedlak', { waitUntil: 'load' });
await page.waitForFunction(() => window.duel?.life?.sim, null, { timeout: 120000 });
const adv = (s) => page.evaluate((x) => window.duel.advance(x), s);
const st = () => page.evaluate(() => { const L = window.duel.life, P = L.sim.player; return { t: L.sim.date().clock, x: P.x.toFixed(1), z: P.z.toFixed(1), inside: P.inside, money: P.money, prompt: document.querySelector('.lprompt')?.textContent }; });
await adv(1);
console.log('start', await st());
await page.keyboard.down('w'); await adv(3); await page.keyboard.up('w');
console.log('after walking', await st());
// to the tavern door
await page.evaluate(() => { const P = window.duel.life.sim.player; P.x = 15.6; P.z = 90; P.yaw = Math.PI / 2; window.duel.life.camYaw = Math.PI / 2; });
await adv(0.5);
console.log('at tavern door', await st());
await page.keyboard.press('e'); await adv(0.5);
console.log('pressed E', await st());
await page.screenshot({ path: 'shots/lp_inside.png' });
// walk to the innkeeper's place and talk
const who = await page.evaluate(() => { const L = window.duel.life; const inn = L.sim.people.find((p) => p.role === 'innkeeper'); const s = L.interior.spotOf(inn); const P = L.sim.player; P.x = s.x - 1.2; P.z = s.z; return { inn: inn.fullName, inside: inn.agent.inside, act: inn.agent.act }; });
console.log('innkeeper', who);
await adv(0.3);
await page.keyboard.press('e'); await adv(0.3);
await page.fill('.ltinput', 'God give you good day. A mug of beer, please.');
await page.keyboard.press('Enter');
await adv(0.5);
await page.waitForTimeout(500);
console.log('talk', await page.evaluate(() => [...document.querySelectorAll('.ltlog p')].map((p) => p.textContent)), await st());
await page.screenshot({ path: 'shots/lp_talk.png' });
await browser.close();
