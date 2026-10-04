// Headless smoke test: node tools/sim.mjs [weaponA] [presetA] [weaponB] [presetB]
import { FightSim } from '../src/game/FightSim.js';
import { PRESETS } from '../src/data/armour.js';
import { Vector3 } from 'three';

const [wa = 'longsword', pa = 'knight', wb = 'longsword', pb = 'blossfechten'] = process.argv.slice(2);
const sim = new FightSim({
  fighters: [
    { weapon: wa, items: PRESETS[pa].items, name: 'A' },
    { weapon: wb, items: PRESETS[pb].items, name: 'B' },
  ],
});
const t0 = performance.now();
sim.settle(1.5);
const f = (v) => v.toArray().map((x) => x.toFixed(2)).join(',');
for (const k of sim.knights) {
  const tip = k.weapon.worldPoint(k.weapon.tipY, new Vector3());
  console.log(k.name, 'mass', k.totalMass.toFixed(1), 'pelvis', f(k.b.pelvis.pos), 'head', f(k.b.head.pos), 'tip', f(tip), 'grips', Object.keys(k.weapon.joints).join(''), 'state', k.state);
}
sim.damage.on((e) => { if (e.type === 'hit' || e.type === 'parry' || e.type === 'clash') console.log(sim.time.toFixed(2), e.type, e.text ?? '', e.energy?.toFixed?.(1)); });
// walk A forward, then attack
for (let i = 0; i < 240; i++) {
  const d = sim.a.center.distanceTo(sim.b.center);
  sim.a.intent.moveY = d > 1.9 ? 1 : 0;
  if (i === 150) console.log('swipe', sim.a.swipe(-1, -1)?.name, 'dist', d.toFixed(2));
  if (i === 200) console.log('thrust', sim.a.thrust()?.name);
  sim.step();
  if (i % 30 === 0) {
    const k = sim.a;
    const tip = k.weapon.worldPoint(k.weapon.tipY, new Vector3());
    console.log(i, 'A pel', f(k.b.pelvis.pos), 'tip', f(tip), 'tipSpeed', k.weapon.body.velocityAt(tip, new Vector3()).length().toFixed(1), 'B state', sim.b.state, 'blood', sim.b.blood.toFixed(2));
  }
}
console.log('ms per frame', ((performance.now() - t0) / (240 + 90)).toFixed(2));
