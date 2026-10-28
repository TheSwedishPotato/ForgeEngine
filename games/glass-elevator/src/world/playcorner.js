/**
 * The play corner east of the lobby: a wall of boxes to knock down, bowling pins and balls, beach
 * balls, basketballs, barrels, crates, a pallet of potato sacks and watermelons. All loose bodies:
 * pick up, throw, push, wheel into the car.
 */
import { Group, Mesh, SphereGeometry, MeshStandardMaterial } from 'three';
import { Body, MATERIALS } from '../physics/bodies.js';
import { boxMesh, cylGeo } from '../render/build.js';

export function makePlayCorner(world, scene, props) {
  const mats = new Map();
  const mat = (hex) => { if (!mats.has(hex)) mats.set(hex, new MeshStandardMaterial({ color: hex, roughness: 0.6, metalness: 0 })); return mats.get(hex); };
  const add = (spec, look) => {
    const body = world.add(new Body(spec)); body.home = [...spec.pos];
    const g = new Group(); scene.add(g); look(g);
    g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.userData.body = body; } });
    props.list.push({ b: body, g });
  };
  // the play corner east of the lobby: a wall of boxes to knock down, bowling, balls, barrels, crates, sacks
  const thing = (name, kind, dim, mass, pos, col, mu = MATERIALS.cardboard, e = 0.15, deco) => add({ name, kind, ...dim, mass, pos, mu, e }, (g) => {
    g.add(kind === 'ball' ? new Mesh(new SphereGeometry(dim.r, 18, 12), mat(col)) : kind === 'cyl' ? new Mesh(cylGeo(dim.size[0] / 2, dim.size[1], 'y', 18), mat(col)) : boxMesh(mat(col), ...dim.size));
    deco?.(g);
  });
  for (const z of [9.2, 9.62]) for (let row = 0; row < 4; row++) for (let i = 0; i < 4 - row; i++) thing('Cardboard box (3 kg)', 'box', { size: [0.4, 0.4, 0.4] }, 3, [9.6 + i * 0.42 + row * 0.21, 0.2 + row * 0.402, z], 0xa47a4c);
  const pin = (g) => { const st = new Mesh(cylGeo(0.062, 0.04, 'y', 18), mat(0xc0281c)); st.position.y = 0.09; g.add(st); };
  [[0, 0], [-1, 1], [1, 1], [-2, 2], [0, 2], [2, 2], [-3, 3], [-1, 3], [1, 3], [3, 3]].forEach(([u, v]) => thing('Bowling pin (1.5 kg)', 'cyl', { size: [0.12, 0.38, 0.12] }, 1.5, [15.2 + u * 0.15, 0.19, 12.4 + v * 0.26], 0xf4f2ec, MATERIALS.plastic, 0.3, pin));
  thing('Bowling ball (7 kg)', 'ball', { r: 0.11 }, 7, [15.2, 0.11, 8.4], 0x1c2a6e, MATERIALS.plastic, 0.2);
  thing('Bowling ball (5 kg)', 'ball', { r: 0.1 }, 5, [14.7, 0.1, 8.4], 0x7a1c4a, MATERIALS.plastic, 0.2);
  for (let i = 0; i < 4; i++) thing('Beach ball', 'ball', { r: 0.25 }, 0.3, [10 + i * 0.7, 0.25, 12.8], [0xe0561b, 0x2a6bd8, 0xf2c21b, 0x2f9b4a][i], MATERIALS.rubber, 0.85);
  for (let i = 0; i < 3; i++) thing('Basketball (0.6 kg)', 'ball', { r: 0.12 }, 0.6, [12.8 + i * 0.3, 0.12, 11.2], 0xd2691e, MATERIALS.rubber, 0.8);
  for (let i = 0; i < 3; i++) thing('Oil barrel (20 kg, empty)', 'cyl', { size: [0.58, 0.88, 0.58] }, 20, [16.6, 0.44, 9 + i * 0.7], [0x1f4f8a, 0xa3201b, 0x2f6b3d][i], MATERIALS.steel, 0.1);
  for (let i = 0; i < 4; i++) thing('Wooden crate (12 kg)', 'box', { size: [0.5, 0.5, 0.5] }, 12, [12.6 + (i % 2) * 0.55, 0.25 + Math.floor(i / 2) * 0.505, 13.8], 0x9a6a3a, MATERIALS.wood);
  thing('Pallet (20 kg)', 'box', { size: [1.2, 0.15, 0.8] }, 20, [10.4, 0.075, 14.0], 0xb08a5a, MATERIALS.wood);
  for (let i = 0; i < 3; i++) thing('Sack of potatoes (25 kg)', 'box', { size: [0.45, 0.25, 0.65] }, 25, [10.4, 0.15 + 0.125 + i * 0.255, 14.0], 0x8a7a55, MATERIALS.cardboard, 0.05);
  for (let i = 0; i < 6; i++) thing('Watermelon (4 kg)', 'ball', { r: 0.13 }, 4, [9.2 + (i % 3) * 0.28, 0.13, 11.4 + Math.floor(i / 3) * 0.28], 0x2f6b2a, MATERIALS.cardboard, 0.2);
  thing('Traffic cone (2.5 kg)', 'cyl', { size: [0.3, 0.5, 0.3] }, 2.5, [14.0, 0.25, 10.0], 0xe0561b, MATERIALS.rubber);
  thing('Gym ball (1 kg)', 'ball', { r: 0.33 }, 1, [11.6, 0.33, 11.0], 0x7d4f8c, MATERIALS.rubber, 0.7);
}
