// Clean-shot measurements against a fighter with his guard down.
// node tools/punchtest.mjs [dist]
import { Vector3 } from 'three';
import { FightSim } from '../src/game/FightSim.js';

const dist = parseFloat(process.argv[2] ?? '1.0');
const types = (process.argv[3] ?? 'jab,cross,leadHook,rearHook,leadUppercut,rearUppercut').split(',');
for (const type of types) {
  for (const level of ['head', 'body']) {
    const sim = new FightSim();
    const { a, b } = sim;
    b.debugNoGuard = true;
    a.placeAt(new Vector3(0, 0, -dist / 2), 0);
    b.placeAt(new Vector3(0, 0, dist / 2), Math.PI);
    const res = { J: 0, peak: 0, v: 0, parts: new Set(), dv: 0, dw: 0, gloveMax: 0, tContact: null, frames: 0 };
    const wPrev = new Vector3(), vPrev = new Vector3(), gp = new Vector3();
    let side = null, t0 = 0;
    for (let i = 0; i < 150; i++) {
      if (i === 70) { a.throwPunch(type, level); side = a.punch.side; t0 = sim.time; }
      wPrev.copy(b.b.head.omega); vPrev.copy(b.b.head.vel);
      sim.step();
      if (side && a.punch) {
        const fa = a.b['forearm' + side];
        fa.velocityAt(fa.localToWorld(a.ragdoll.bones['arm' + side].lowerEnd, gp), gp);
        res.gloveMax = Math.max(res.gloveMax, gp.length());
      }
      let hitHead = false, any = false;
      for (const imp of sim.world.impacts) {
        const ua = imp.shapeA.userData, ub = imp.shapeB.userData;
        const aGlove = (ua.boxer === 0 && ua.part === 'glove' && ub.boxer === 1) || (ub.boxer === 0 && ub.part === 'glove' && ua.boxer === 1);
        if (!aGlove) continue;
        any = true;
        res.J += imp.impulse; res.peak = Math.max(res.peak, imp.peakForce); res.v = Math.max(res.v, imp.approachSpeed);
        const part = ua.boxer === 1 ? ua.part : ub.part; res.parts.add(part);
        if (part === 'skull' || part === 'jaw') hitHead = true;
      }
      if (any) { res.frames++; if (res.tContact === null) res.tContact = sim.time - t0; }
      if (hitHead) {
        res.dw = Math.max(res.dw, b.b.head.omega.clone().sub(wPrev).length());
        res.dv = Math.max(res.dv, b.b.head.vel.clone().sub(vPrev).length());
      }
    }
    console.log(`${type.padEnd(13)} ${level.padEnd(5)} tHit=${res.tContact === null ? ' miss' : (res.tContact * 1000).toFixed(0).padStart(4) + 'ms'} vHit=${res.v.toFixed(1)} vMax=${res.gloveMax.toFixed(1)}m/s J=${res.J.toFixed(1)}Ns (${res.frames}f) peak=${res.peak.toFixed(0)}N head dv=${res.dv.toFixed(2)} dw=${res.dw.toFixed(1)} parts=${[...res.parts].join(',')}`);
  }
}
