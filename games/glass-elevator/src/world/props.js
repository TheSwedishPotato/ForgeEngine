/**
 * The loose things: what a lift engineer's day leaves lying about, and what people bring. In the
 * lobby, three 600 kg test-weight carts on castors (roll all three in and the car is overloaded:
 * 1800 kg in a 1600 kg car), six 25 kg cast-iron test weights, cardboard boxes, a suitcase, a
 * football, a traffic cone and a potted plant; a toolbox and a can of rope lubricant in the machine
 * room; a bucket in the pit; a box on the top floor. Every one of them can be picked up (or, if
 * too heavy, pushed), thrown, stacked, wheeled into the car, dropped down the hoistway.
 */
import { Group, Mesh, SphereGeometry } from 'three';
import { Body, MATERIALS } from '../physics/bodies.js';
import { boxMesh, cylGeo, Batch } from '../render/build.js';
import { floorY, MR, PIT_Y, FLOORS } from '../data/spec.js';

export function makeProps(world, M, scene) {
  const list = [];
  const add = (spec, look) => {
    const b = world.add(new Body(spec));
    b.home = [...spec.pos];
    const g = new Group(); scene.add(g);
    look(g, b);
    g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.userData.body = b; } });
    list.push({ b, g });
    return b;
  };
  // three test-weight carts: a steel frame on four castors, stacked with 25 kg weights (600 kg each)
  [[-5.2, 13.5], [-5.2, 12.3], [-6.4, 13.5]].forEach(([x, z], i) => add(
    { name: `Test-weight cart ${i + 1} (600 kg, on castors)`, kind: 'box', size: [0.8, 0.8, 0.6], mass: 600, pos: [x, 0.4, z], mu: MATERIALS.castors, e: 0.05 },
    (g) => {
      const b = new Batch();
      b.box(M.paintYellow, -0.4, -0.3, -0.3, 0.4, -0.25, 0.3);
      for (let k = 0; k < 12; k++) b.box(M.castIron, -0.36, -0.25 + k * 0.05, -0.26, 0.36, -0.205 + k * 0.05, 0.26);
      for (const s of [-1, 1]) b.box(M.paintYellow, s * 0.38 - 0.02, -0.3, -0.3, s * 0.38 + 0.02, 0.4, 0.3);
      for (const [x2, z2] of [[-0.32, -0.22], [0.32, -0.22], [-0.32, 0.22], [0.32, 0.22]]) b.add(cylGeo(0.05, 0.04, 'x', 12), M.rubber, x2, -0.35, z2);
      b.build(g);
    }));
  // six 25 kg test weights, stacked
  for (let k = 0; k < 6; k++) add(
    { name: '25 kg test weight (cast iron)', kind: 'box', size: [0.4, 0.11, 0.11], mass: 25, pos: [-2.6 + (k % 2) * 0.5, 0.055 + Math.floor(k / 2) * 0.112, 13.9], mu: MATERIALS.steel, e: 0.05 },
    (g) => { g.add(boxMesh(M.castIron, 0.4, 0.11, 0.11)); const h = new Mesh(cylGeo(0.012, 0.16, 'x', 8), M.steel); h.position.y = 0.075; g.add(h); });
  // cardboard boxes
  [[0.5, 0.4, 0.4, 6, 3.0, 12.6], [0.6, 0.45, 0.4, 9, 3.8, 13.2], [0.4, 0.3, 0.3, 3, 3.1, 13.4], [0.8, 0.6, 0.5, 15, 4.6, 12.3], [0.3, 0.3, 0.3, 2, 3.05, 12.6]].forEach(([w, h, d, m, x, z], i) => add(
    { name: `Cardboard box (${m} kg)`, kind: 'box', size: [w, h, d], mass: m, pos: [x, h / 2 + (i === 4 ? 0.4 : 0), z], mu: MATERIALS.cardboard, e: 0.1 },
    (g) => { g.add(boxMesh(M.cardboard, w, h, d)); const t = boxMesh(M.plastic, w * 0.2, 0.002, d + 0.002); t.position.y = h / 2; g.add(t); }));
  add({ name: 'Suitcase (18 kg)', kind: 'box', size: [0.45, 0.7, 0.26], mass: 18, pos: [1.8, 0.35, 11.8], mu: MATERIALS.plastic },
    (g) => { g.add(boxMesh(M.plastic, 0.45, 0.7, 0.26)); const h = boxMesh(M.steel, 0.16, 0.03, 0.03); h.position.y = 0.38; g.add(h); });
  add({ name: 'Football', kind: 'ball', r: 0.11, mass: 0.43, pos: [0.8, 0.11, 10.5], mu: MATERIALS.rubber, e: 0.72 },
    (g) => { g.add(new Mesh(new SphereGeometry(0.11, 20, 14), M.plaster)); });
  add({ name: 'Traffic cone (2.5 kg)', kind: 'cyl', size: [0.3, 0.5, 0.3], mass: 2.5, pos: [-1.6, 0.25, 11.0], mu: MATERIALS.rubber },
    (g) => { g.add(new Mesh(cylGeo(0.15, 0.48, 'y', 16, 0.03), M.orange)); const base = boxMesh(M.plastic, 0.34, 0.03, 0.34); base.position.y = -0.235; g.add(base); });
  add({ name: 'Potted plant (25 kg)', kind: 'cyl', size: [0.5, 0.5, 0.5], mass: 25, pos: [-7.2, 0.25, 8.0], mu: MATERIALS.wood },
    (g) => { g.add(new Mesh(cylGeo(0.22, 0.5, 'y', 16, 0.25), M.paintDark)); const l = new Mesh(new SphereGeometry(0.38, 14, 10), M.leaf); l.position.y = 0.55; g.add(l); });
  add({ name: 'Office chair (14 kg)', kind: 'box', size: [0.6, 0.95, 0.6], mass: 14, pos: [-4.6, 0.475, 9.6], mu: MATERIALS.plastic },
    (g) => { const s = boxMesh(M.plastic, 0.5, 0.08, 0.5); s.position.y = -0.0; g.add(s); const bk = boxMesh(M.plastic, 0.5, 0.5, 0.06); bk.position.set(0, 0.25, -0.25); g.add(bk); const p = new Mesh(cylGeo(0.03, 0.45, 'y', 8), M.steel); p.position.y = -0.25; g.add(p); const f = boxMesh(M.steel, 0.6, 0.03, 0.6); f.position.y = -0.46; g.add(f); });
  // the machine room's, the pit's, the top floor's
  add({ name: 'Toolbox (12 kg)', kind: 'box', size: [0.5, 0.25, 0.22], mass: 12, pos: [1.6, MR.floor + 0.125, 17.4], mu: MATERIALS.steel },
    (g) => { g.add(boxMesh(M.paintRed, 0.5, 0.25, 0.22)); const h = boxMesh(M.paintDark, 0.2, 0.03, 0.03); h.position.y = 0.14; g.add(h); });
  add({ name: 'Rope lubricant can (4 kg)', kind: 'cyl', size: [0.2, 0.26, 0.2], mass: 4, pos: [2.0, MR.floor + 0.13, 17.6], mu: MATERIALS.steel },
    (g) => { g.add(new Mesh(cylGeo(0.1, 0.26, 'y', 16), M.paintGreen)); });
  add({ name: 'Bucket (2 kg)', kind: 'cyl', size: [0.3, 0.3, 0.3], mass: 2, pos: [-1.8, PIT_Y + 0.15, 16.9], mu: MATERIALS.plastic },
    (g) => { g.add(new Mesh(cylGeo(0.15, 0.3, 'y', 16, 0.12), M.paintBlue)); });
  add({ name: 'Cardboard box (8 kg)', kind: 'box', size: [0.5, 0.5, 0.5], mass: 8, pos: [-2.2, floorY(FLOORS) + 0.25, 12.3], mu: MATERIALS.cardboard },
    (g) => { g.add(boxMesh(M.cardboard, 0.5, 0.5, 0.5)); });
  return {
    list,
    /** Draws each thing where it is (what rides the car is drawn where the car is now, between physics steps). */
    update(carY) {
      for (const { b, g } of list) {
        const dy = b.touching?.some((m) => m.car) ? carY - world.carY : 0;
        g.position.set(b.p[0], b.p[1] + dy, b.p[2]); g.quaternion.set(b.q[0], b.q[1], b.q[2], b.q[3]);
      }
    },
  };
}
