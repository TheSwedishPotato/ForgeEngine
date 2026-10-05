import { FightSim } from '../../src/game/FightSim.js';
import { PRESETS } from '../../src/data/armour.js';
import { Vector3 } from 'three';
const sim = new FightSim({ fighters: [{ weapon: process.argv[2] ?? 'longsword', items: PRESETS.knight.items }, { weapon: 'longsword', items: PRESETS.blossfechten.items }], separation: 2.0 });
sim.settle(2);
const k = sim.a, up = new Vector3(0, 1, 0);
const lean = (b) => { const u = up.clone().applyQuaternion(b.q); return Math.atan2(u.dot(k.forward), u.y) * 180 / Math.PI; };
let line = [];
for (let i = 0; i < 150; i++) {
  if (i === 10) k.swipe(-1, -1);
  if (i === 80) k.thrust();
  sim.step();
  if (i % 6 === 0) line.push(`${(i / 60).toFixed(1)}:${k.attack?.phase ?? '-'} c${lean(k.b.chest).toFixed(0)} p${lean(k.b.pelvis).toFixed(0)} pel${k.b.pelvis.pos.clone().sub(k.center).dot(k.forward).toFixed(2)}`);
}
console.log(line.join('\n'));
