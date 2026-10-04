import { FightSim } from '../../src/game/FightSim.js';
import { PRESETS } from '../../src/data/armour.js';
import { Vector3 } from 'three';
const sep = Number(process.argv[2] ?? 1.75);
const sim = new FightSim({ separation: sep, fighters: [{ weapon: 'longsword', items: PRESETS.blossfechten.items }, { weapon: 'longsword', items: PRESETS.blossfechten.items }] });
sim.settle(1.5);
sim.a.swipe(-1, -1);
const W = sim.a.weapon, D = sim.a.drive;
const ax = new Vector3(), tax = new Vector3(), p = new Vector3();
for (let i = 0; i < 30; i++) {
  sim.step();
  W.axis(ax); tax.set(0, 1, 0).applyQuaternion(D.targetQ);
  W.body.localToWorld(D.point, p);
  const ang = Math.acos(Math.min(1, ax.dot(tax))) * 180 / Math.PI;
  const sp = W.worldPoint(W.strikeY, new Vector3());
  let hitStr = '';
  for (const imp of sim.world.impacts) if (imp.shapeA.userData.weapon || imp.shapeB.userData.weapon) hitStr += ` [${(imp.shapeA.userData.weapon ? imp.shapeB : imp.shapeA).userData.part} W${imp.work.toFixed(0)}]`;
  console.log(i, sim.a.attack?.phase?.padEnd(7), 'angErr', ang.toFixed(0).padStart(4), 'posErr', p.distanceTo(D.target).toFixed(2), 'ctrlV', W.body.velocityAt(p, new Vector3()).length().toFixed(1), 'tgtV', D.targetVel.length().toFixed(1), 'omega', W.body.omega.length().toFixed(1), 'tgtOm', D.targetOmega.length().toFixed(1), 'strikeV', W.body.velocityAt(sp, new Vector3()).length().toFixed(1), 'elbowR', (sim.a.j.elbowR.getRelative(new (sim.a.b.chest.q.constructor)()).w).toFixed(2), hitStr);
}
