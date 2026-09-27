// Parameter sweep for one punch: node tools/sweep.mjs cross 0.95 '{"force":[260,340],"armDelay":[0.1,0.25]}'
import { Vector3 } from 'three';
import { FightSim } from '../src/game/FightSim.js';
import { PUNCHES } from '../src/boxer/moves.js';

const [, , type = 'cross', distS = '0.95', spec = '{}'] = process.argv;
const dist = parseFloat(distS);
const grid = JSON.parse(spec);
const keys = Object.keys(grid);
const base = { ...PUNCHES[type] };
const combos = keys.reduce((acc, k) => acc.flatMap((c) => grid[k].map((v) => ({ ...c, [k]: v }))), [{}]);
for (const c of combos) {
  Object.assign(PUNCHES[type], base, Object.fromEntries(Object.entries(c).map(([k, v]) => [k, k.endsWith('Yaw') ? v * Math.PI / 180 : v])));
  const sim = new FightSim();
  const { a, b } = sim;
  b.debugNoGuard = true;
  a.placeAt(new Vector3(0, 0, -dist / 2), 0);
  b.placeAt(new Vector3(0, 0, dist / 2), Math.PI);
  let v = 0, dv = 0, dw = 0, peak = 0;
  const wPrev = new Vector3(), vPrev = new Vector3();
  for (let i = 0; i < 130; i++) {
    if (i === 70) a.throwPunch(type, 'head');
    wPrev.copy(b.b.head.omega); vPrev.copy(b.b.head.vel);
    sim.step();
    for (const imp of sim.world.impacts) {
      const ua = imp.shapeA.userData, ub = imp.shapeB.userData;
      const hit = (ua.boxer === 0 && ua.part === 'glove' && (ub.part === 'jaw' || ub.part === 'skull')) || (ub.boxer === 0 && ub.part === 'glove' && (ua.part === 'jaw' || ua.part === 'skull'));
      if (!hit) continue;
      v = Math.max(v, imp.approachSpeed); peak = Math.max(peak, imp.peakForce);
      dw = Math.max(dw, b.b.head.omega.clone().sub(wPrev).length());
      dv = Math.max(dv, b.b.head.vel.clone().sub(vPrev).length());
    }
  }
  console.log(JSON.stringify(c), `vHit=${v.toFixed(1)} peak=${peak.toFixed(0)} dv=${dv.toFixed(2)} dw=${dw.toFixed(1)}`);
}
