import { FightSim } from '../../src/game/FightSim.js';
import { PRESETS } from '../../src/data/armour.js';
import { Vector3 } from 'three';
const sim = new FightSim({ separation: 1.75, fighters: [{ weapon: 'longsword', items: PRESETS.blossfechten.items }, { weapon: 'longsword', items: PRESETS.blossfechten.items }] });
sim.settle(1.5);
sim.a.swipe(-1, -1);
const W = sim.a.weapon;
for (let i = 0; i < 40; i++) {
  sim.step();
  for (const imp of sim.world.impacts) {
    const A = imp.shapeA.userData, B = imp.shapeB.userData;
    if (A.fighter === undefined || B.fighter === undefined) continue;
    if (!(A.weapon || B.weapon)) continue;
    const w = A.weapon ? A : B, b = A.weapon ? B : A;
    console.log(i, w.weaponPart, '->', b.segment, b.part, b.mat, 'J', imp.impulse.toFixed(2), 'Jt', imp.impulseT.toFixed(2), 'W', imp.work.toFixed(1), 'vn', imp.approachSpeed.toFixed(1), 'F', imp.peakForce.toFixed(0), 'new', imp.isNew);
  }
  const p = W.worldPoint(W.strikeY, new Vector3());
  if (i % 3 === 0) console.log(i, 'strike', p.toArray().map(x=>x.toFixed(2)).join(','), 'v', W.body.velocityAt(p, new Vector3()).length().toFixed(1), 'phase', sim.a.attack?.phase, 'head', sim.b.b.head.pos.toArray().map(x=>x.toFixed(2)).join(','));
}
