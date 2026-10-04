// Loads every opponent and every armour item in the browser and reports errors.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(1, 3).join(' | ')));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('CERT')) errors.push(m.text()); });
await page.goto(`http://127.0.0.1:5174/?manual=1&quality=low`, { waitUntil: 'load' });
await page.waitForFunction(() => window.duel && window.duel.sim, null, { timeout: 90000 });
const res = await page.evaluate(async () => {
  const d = window.duel;
  const out = [];
  const { ARMOUR, SLOTS, ARMOUR_BY_SLOT } = await import('/src/data/armour.js');
  const { WEAPON_ORDER } = await import('/src/data/weapons.js');
  for (const id of d.OPPONENT_ORDER) {
    try { d.start({ opponent: id }); d.advance(7); out.push(`${id}: ${d.player.state}/${d.foe.state} blood ${d.player.blood.toFixed(2)}/${d.foe.blood.toFixed(2)} log=${document.querySelectorAll('.log .line').length}`); }
    catch (e) { out.push(`${id}: ERROR ${e.message}`); }
  }
  // Every armour item on the player, every weapon.
  for (const s of SLOTS) for (const item of ARMOUR_BY_SLOT[s.id]) {
    try { const items = { ...d.hud.config.player.items, [s.id]: item }; d.start({ player: { ...d.hud.config.player, items }, opponent: 'militia' }); d.advance(0.5); }
    catch (e) { out.push(`item ${item}: ERROR ${e.message}`); }
  }
  for (const w of WEAPON_ORDER) for (const off of ['none', 'buckler']) {
    try { d.start({ player: { ...d.hud.config.player, weapon: w, offhand: off }, opponent: 'priest' }); d.advance(5); out.push(`weapon ${w}/${off}: ok ${d.player.state}`); }
    catch (e) { out.push(`weapon ${w}: ERROR ${e.message}`); }
  }
  return out;
});
console.log(res.join('\n'));
console.log('errors:', errors.length ? errors.slice(0, 10).join('\n') : 'none');
await browser.close();
