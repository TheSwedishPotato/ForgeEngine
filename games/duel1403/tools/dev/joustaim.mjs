import { Vector3 } from 'three';
import { JoustSim } from '../../src/joust/JoustSim.js';
import { JoustAI } from '../../src/joust/JoustAI.js';
import { JOUSTERS } from '../../src/data/joust.js';
const sim = new JoustSim({ riders: [{ ...JOUSTERS[3] }, { ...JOUSTERS[2] }], seed: 5 });
const ais = sim.riders.map((r) => new JoustAI(sim, r, { aim: 'body', rand: () => 0.5 }));
for (let i = 0; i < 60 * 9; i++) {
  for (const ai of ais) ai.update();
  sim.step();
  if (i % 20 === 0 || (sim.closing() < 4 && sim.closing() > -1)) {
    const r = sim.a, l = r.lance, o = sim.b;
    const tip = l.tip, aim = r.ctrl.aim;
    const want = aim ? sim._aimDir(0, aim, new Vector3()) : null;
    const ax = l.axis.clone();
    const ang = want ? (ax.angleTo(want) * 180 / Math.PI).toFixed(1) : '-';
    const tl = o.b.chest.worldToLocal(tip, new Vector3());
    console.log(`t=${sim.time.toFixed(2)} ph=${sim.phase} close=${sim.closing().toFixed(2)} v=${sim.horses[0].speed.toFixed(1)} couch=${r.couch.toFixed(2)} tip=(${tip.x.toFixed(2)},${tip.y.toFixed(2)},${tip.z.toFixed(2)}) aimErr=${ang}deg tipInFoeChest=(${tl.x.toFixed(2)},${tl.y.toFixed(2)},${tl.z.toFixed(2)}) chestY=${o.b.chest.pos.y.toFixed(2)} rest=${l.restPoint.y.toFixed(2)} seat=${(r.displacement().seat*100).toFixed(1)}cm back=${r.displacement().back.toFixed(2)}`);
  }
}
