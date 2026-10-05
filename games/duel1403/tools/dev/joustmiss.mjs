import { Vector3 } from 'three';
import { JoustSim } from '../../src/joust/JoustSim.js';
import { JoustAI } from '../../src/joust/JoustAI.js';
import { JOUSTERS } from '../../src/data/joust.js';
const sim = new JoustSim({ riders: [{ ...JOUSTERS[3] }, { ...JOUSTERS[2] }], seed: 5 });
const ais = sim.riders.map((r) => new JoustAI(sim, r, { aim: 'body', skill: 1, rand: () => 0.5 }));
for (const l of sim.lances) l.strike.enabled = false;   // ghost lances: just measure
let best = [9, 9], at = [null, null];
let course = 1;
for (let i = 0; i < 60 * 40; i++) {
  for (const ai of ais) ai.update();
  for (const ai of ais) ai.err.set(0, 0, 0);
  sim.step();
  if (sim.course !== course) { console.log(`course ${course}: miss A ${best[0].toFixed(3)} ${at[0]} | B ${best[1].toFixed(3)} ${at[1]}`); best = [9, 9]; course = sim.course; for (const l of sim.lances) l.strike.enabled = false; }
  for (const [k, r] of sim.riders.entries()) {
    if (!r.ctrl.aim) continue;
    const o = r.opponent;
    const pt = o.b.chest.localToWorld(o.ecranche.offset, new Vector3());
    const tip = r.lance.tip;
    const d = tip.distanceTo(pt);
    if (d < best[k]) { best[k] = d; const l = o.b.chest.worldToLocal(tip, new Vector3()).sub(o.ecranche.offset); at[k] = `rel(${l.x.toFixed(2)},${l.y.toFixed(2)},${l.z.toFixed(2)}) close=${sim.closing().toFixed(2)} yaw=${(Math.atan2(r.lance.axis.z, r.lance.axis.x)*57.3).toFixed(0)}`; }
  }
}
