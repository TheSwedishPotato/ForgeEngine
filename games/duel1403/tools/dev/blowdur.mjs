import { Vector3 } from 'three';
import { FightSim } from '../../src/game/FightSim.js';
import { OPPONENTS } from '../../src/data/opponents.js';
const O = OPPONENTS.fencer;
const f = (o) => ({ name: o.name, items: o.items, weapon: o.weapon, offhand: o.offhand, skill: o.skill, height: o.body.height, mass: o.body.mass });
const sim = new FightSim({ fighters: [f(OPPONENTS.knight), f(O)], separation: 2.4 });
sim.settle(1.3);
const k = sim.a;
for (const [dx, dy] of [[1, 1], [1, -1], [1, 0]]) {
  k.swipe(dx, dy, sim.b.b.chest.pos.clone(), 'chest');
  let t = 0; const ph = [];
  while (k.attack && t < 4) { const p = k.attack.phase; if (ph[ph.length-1]?.[0] !== p) ph.push([p, t.toFixed(2)]); sim.step(); t += 1/60; }
  console.log(k.attack ? 'STILL' : 'done', t.toFixed(2), JSON.stringify(ph), 'dist', k.center.distanceTo(sim.b.center).toFixed(2));
  for (let i = 0; i < 60; i++) sim.step();
}
k.thrust(sim.b.b.chest.pos.clone()); let t=0; while (k.attack && t<4){sim.step(); t+=1/60;} console.log('thrust', t.toFixed(2));
