// Headless fight simulation for tuning: node tools/sim.mjs
import { Vector3 } from 'three';
import { World, Body, Shape } from '../src/physics/index.js';
import { Boxer } from '../src/boxer/Boxer.js';

export function makeScene({ substeps = 20 } = {}) {
  const world = new World({ substeps });
  const ground = new Body({ name: 'canvas' });
  ground.addShape(Shape.plane(new Vector3(0, 1, 0), 0, { friction: 0.9, restitution: 0 }));
  world.addBody(ground);
  const a = new Boxer(world, { id: 0, name: 'A', position: new Vector3(0, 0, -0.55), yaw: 0 });
  const b = new Boxer(world, { id: 1, name: 'B', position: new Vector3(0, 0, 0.55), yaw: Math.PI });
  a.opponent = b; b.opponent = a;
  world.collisionFilter = (s1, s2) => {
    const u1 = s1.userData, u2 = s2.userData;
    if (u1.boxer === undefined || u2.boxer === undefined) return true;
    if (u1.boxer !== u2.boxer) return true;
    // self: only gloves vs own head
    return (u1.part === 'glove' && (u2.segment === 'head')) || (u2.part === 'glove' && (u1.segment === 'head'));
  };
  return { world, a, b };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { world, a, b } = makeScene();
  const dt = 1 / 60;
  const t0 = performance.now();
  const log = (t) => {
    const f = (v) => v.toArray().map((x) => x.toFixed(3)).join(',');
    console.log(`t=${t.toFixed(2)} A pel ${f(a.b.pelvis.pos)} head ${f(a.b.head.pos)} gloveL ${f(a.b.forearmL.pos)} | B pel ${f(b.b.pelvis.pos)} head y ${b.b.head.pos.y.toFixed(3)} state ${a.state}/${b.state}`);
  };
  for (let i = 0; i < 60 * 6; i++) {
    const t = i * dt;
    if (i === 120) a.throwPunch('jab');
    if (i === 160) a.throwPunch('cross');
    if (i === 210) a.throwPunch('leadHook');
    if (i === 260) a.throwPunch('rearUppercut');
    a.update(dt); b.update(dt);
    world.step(dt);
    for (const imp of world.impacts) {
      const ua = imp.shapeA.userData, ub = imp.shapeB.userData;
      if (ua.boxer !== undefined && ub.boxer !== undefined && ua.boxer !== ub.boxer && (ua.part === 'glove' || ub.part === 'glove')) {
        console.log(`  impact t=${t.toFixed(3)} ${ua.boxer}:${ua.part} <-> ${ub.boxer}:${ub.part} J=${imp.impulse.toFixed(2)}Ns peak=${imp.peakForce.toFixed(0)}N v=${imp.approachSpeed.toFixed(2)}m/s new=${imp.isNew}`);
      }
    }
    if (i % 30 === 0) log(t);
  }
  console.log('sim ms per frame', ((performance.now() - t0) / 360).toFixed(2));
}
