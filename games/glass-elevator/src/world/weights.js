/**
 * The weights store east of the lobby: what a lift engineer loads a car with for a load test
 * (EN 81-20 calls for 125 % of rated load on the safety gear and brake tests). Cast-iron test
 * weights of 25, 50 and 100 kg, stacked, and test-weight carts on castors of 600 and 1000 kg.
 * All loose bodies: pick up the light ones, push the heavy ones, wheel the carts into the car.
 */
import { Group, Mesh } from 'three';
import { Body, MATERIALS } from '../physics/bodies.js';
import { Batch, boxMesh, cylGeo } from '../render/build.js';

export function makeWeights(world, scene, props, M) {
  const add = (spec, look) => {
    const body = world.add(new Body(spec)); body.home = [...spec.pos];
    const g = new Group(); scene.add(g); look(g);
    g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.userData.body = body; } });
    props.list.push({ b: body, g });
  };
  // a cast-iron block with its lifting handle
  const weight = (kg, [w, h, d], pos) => add({ name: `${kg} kg test weight (cast iron)`, kind: 'box', size: [w, h, d], mass: kg, pos, mu: MATERIALS.steel, e: 0.05 }, (g) => {
    g.add(boxMesh(M.castIron, w, h, d));
    const hd = new Mesh(cylGeo(0.014, w * 0.4, 'x', 8), M.steel); hd.position.y = h / 2 + 0.02; g.add(hd);
  });
  // 25 kg: two stacks of eight; 50 kg: two stacks of four; 100 kg: a row of four
  for (const x of [9.4, 9.9]) for (let k = 0; k < 8; k++) weight(25, [0.4, 0.11, 0.11], [x, 0.055 + k * 0.112, 8.6]);
  for (const x of [10.7, 11.3]) for (let k = 0; k < 4; k++) weight(50, [0.45, 0.15, 0.2], [x, 0.075 + k * 0.152, 8.6]);
  for (let i = 0; i < 4; i++) weight(100, [0.5, 0.2, 0.28], [12.2 + i * 0.6, 0.1, 8.6]);
  // test-weight carts: a steel frame on four castors, stacked with plates
  const cart = (kg, [w, h, d], pos) => add({ name: `Test-weight cart (${kg} kg, on castors)`, kind: 'box', size: [w, h, d], mass: kg, pos, mu: MATERIALS.castors, e: 0.05 }, (g) => {
    const b = new Batch(), x = w / 2, y = h / 2, z = d / 2, n = Math.round((h - 0.2) / 0.05);
    b.box(M.paintYellow, -x, -y + 0.1, -z, x, -y + 0.15, z);
    for (let k = 0; k < n; k++) b.box(M.castIron, -x + 0.04, -y + 0.15 + k * 0.05, -z + 0.04, x - 0.04, -y + 0.195 + k * 0.05, z - 0.04);
    for (const s of [-1, 1]) b.box(M.paintYellow, s * (x - 0.02) - 0.02, -y + 0.1, -z, s * (x - 0.02) + 0.02, y, z);
    for (const [cx, cz] of [[-x + 0.08, -z + 0.08], [x - 0.08, -z + 0.08], [-x + 0.08, z - 0.08], [x - 0.08, z - 0.08]]) b.add(cylGeo(0.05, 0.04, 'x', 12), M.rubber, cx, -y + 0.05, cz);
    b.build(g);
  });
  for (let i = 0; i < 3; i++) cart(600, [0.8, 0.8, 0.6], [9.8 + i * 1.0, 0.4, 11.0]);
  for (let i = 0; i < 2; i++) cart(1000, [0.9, 1.0, 0.8], [10.0 + i * 1.2, 0.5, 13.0]);
}
