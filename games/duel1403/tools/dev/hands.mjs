import { Vector3 } from 'three';
import { FightSim } from '../../src/game/FightSim.js';
import { OPPONENTS } from '../../src/data/opponents.js';
const f = (o) => ({ name: o.name, items: o.items, weapon: o.weapon, offhand: o.offhand, skill: o.skill, height: o.body.height, mass: o.body.mass });
const sim = new FightSim({ fighters: [f(OPPONENTS.knight), f(OPPONENTS.fencer)], separation: 3.6 });
sim.settle(1.3);
const k = sim.a;
for (let g = 0; g < k.guards.length; g++) {
  k.setGuard(g); for (let i = 0; i < 90; i++) sim.step();
  const ch = k.toFightFrame(k.b.chest.pos, new Vector3()).clone();
  const hR = k.toFightFrame(k.b.forearmR.localToWorld(k.ragdoll.bones.armR.lowerEnd.clone(), new Vector3()), new Vector3());
  const cmd = k.cmd.hand;
  console.log(k.guard.name.padEnd(14), 'chest', ch.toArray().map(v=>v.toFixed(2)).join(','), 'handR', hR.toArray().map(v=>v.toFixed(2)).join(','), 'cmd', cmd.toArray().map(v=>v.toFixed(2)).join(','), 'fwd of chest', (hR.x-ch.x).toFixed(2));
}
