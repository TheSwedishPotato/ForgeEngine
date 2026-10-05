import { Vector3 } from 'three';
import { JoustSim } from '../../src/joust/JoustSim.js';
import { JoustAI } from '../../src/joust/JoustAI.js';
import { JOUSTERS } from '../../src/data/joust.js';
let hitsP = 0, hitsA = 0, n = 0;
for (let k = 0; k < 6; k++) {
  const sim = new JoustSim({ riders: [{ name: 'P', heraldry: 'bohemia', skill: 0.85, coat: 'bay' }, { ...JOUSTERS[2] }], seed: k * 7 + 1 });
  const ai = new JoustAI(sim, sim.b, { aim: 'mixed' });
  sim.player = sim.a; sim.a.ctrl.speed = 7.2;
  let best = 9;
  sim.on((e) => { if (e.type === 'score') { n++; if (e.results[0].strike) hitsP++; if (e.results[1].strike) hitsA++; console.log(e.results.map((r) => r.text).join(' | '), 'closest', best.toFixed(2)); best = 9; } });
  for (let i = 0; i < 60 * 55 && !sim.over; i++) {
    const o = sim.b;
    const pt = o.b.chest.localToWorld(o.ecranche.offset, new Vector3());
    sim.a.ctrl.aim = sim.phase === 'charge' ? pt : null;
    ai.update();
    sim.step();
    if (sim.phase === 'charge') best = Math.min(best, sim.a.lance.tip.distanceTo(pt));
  }
}
console.log({ n, hitsP, hitsA });
