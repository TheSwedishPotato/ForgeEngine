// In the browser: steal bread in the bakery, get seized, stand trial. Prints the modals; saves shots.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message, e.stack?.split('\n').slice(1, 3).join(' | ')));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 300)); });
await page.goto('http://127.0.0.1:5174/?life=1&begin=burgher&manual=1');
await page.waitForFunction(() => window.duel?.life?.sim, null, { timeout: 90000 });
const modal = () => page.evaluate(() => { const m = document.querySelector('.lmodal'); return m && !m.closest('[hidden]') ? { text: m.querySelector('.lede')?.textContent, buttons: [...m.querySelectorAll('button')].map((b) => b.textContent) } : null; });
const click = (label) => page.evaluate((l) => { const b = [...document.querySelectorAll('.lmodal button')].find((x) => x.textContent.startsWith(l)); b?.click(); return !!b; }, label);
await page.evaluate(() => {
  const s = window.duel.life.sim;
  s.t = 5.5 + 3;
  const b = s.people.find((p) => p.role === 'baker');
  b.agent.inside = 'bakery'; b.agent.route = []; b.agent.act = 'selling bread';
});
await page.evaluate(async () => {
  const L = window.duel.life, s = L.sim;
  const { BUILDING } = await import('/src/world/town.js');
  L._enter(BUILDING.bakery);
  for (let i = 0; i < 40; i++) { const r = s.justice.steal(); if (r.seen) break; }
  window.duel.advance(0.2);
});
await page.screenshot({ path: 'shots/crime_hue.png' });
console.log('log:', await page.evaluate(() => [...document.querySelectorAll('.log .line')].slice(0, 4).map((x) => x.textContent)));
for (let i = 0; i < 40 && !(await modal()); i++) await page.evaluate(() => window.duel.advance(0.5));
console.log('stopped:', await modal());
await page.screenshot({ path: 'shots/crime_stopped.png' });
await click('Go with them');
await page.evaluate(() => window.duel.advance(0.3));
console.log('trial:', await modal());
await page.screenshot({ path: 'shots/crime_trial.png' });
await click('Deny');
await page.evaluate(() => window.duel.advance(0.2));
console.log('verdict:', await modal());
await click('Bow');
await page.evaluate(() => window.duel.advance(0.3));
console.log('after:', await modal());
await page.screenshot({ path: 'shots/crime_after.png' });
await click('Go on');
await page.evaluate(() => window.duel.advance(0.5));
console.log('end:', await modal(), await page.evaluate(() => ({ money: window.duel.life.sim.player.money, wanted: window.duel.life.sim.player.wanted, inside: window.duel.life.sim.player.inside, trial: !!window.duel.life.sim.justice.trial })));
// talk: hand money to the beggar via the scripted path
await page.evaluate(() => { const L = window.duel.life, s = L.sim; const p = s.people.find((q) => q.role === 'beggar'); L.openTalk(p); });
await page.evaluate(() => window.duel.life.speak('Here, take a groschen.'));
await page.evaluate(() => window.duel.advance(0.3));
console.log('talk:', await page.evaluate(() => [...document.querySelectorAll('.ltlog p')].map((p) => p.textContent)));
await page.evaluate(() => window.duel.life.speak('Come with me.'));
await page.evaluate(() => window.duel.advance(0.3));
console.log('talk2:', await page.evaluate(() => [...document.querySelectorAll('.ltlog p')].slice(-2).map((p) => p.textContent)));
await page.screenshot({ path: 'shots/crime_talk.png' });
await browser.close();
