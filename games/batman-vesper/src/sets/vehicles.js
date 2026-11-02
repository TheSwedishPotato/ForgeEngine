import { Group, Mesh, CylinderGeometry, Color, MathUtils } from 'three';
import { extrude, mat, box } from '../../../../medengine/src/world/Kit.js';

/**
 * Vehicles built from profiles: a side silhouette extruded across the width, bevelled, with
 * glass, wheels, lights. Clear-coated paint, so wet garages and streets reflect in them.
 */

function wheel(r = 0.33, w = 0.22) {
  const g = new Group();
  const tyre = new Mesh(new CylinderGeometry(r, r, w, 24), mat(0x0c0c0c, { roughness: 0.85 }));
  tyre.rotation.z = Math.PI / 2;
  const rim = new Mesh(new CylinderGeometry(r * 0.62, r * 0.62, w + 0.02, 12), mat(0x9a9ea4, { roughness: 0.25, metalness: 0.9 }));
  rim.rotation.z = Math.PI / 2;
  g.add(tyre, rim);
  tyre.castShadow = rim.castShadow = true;
  return g;
}

function lights(g, { len, w, front, rear, h = 0.75, headOn = false, tailOn = true }) {
  const head = mat(0x111111, { emissive: headOn ? 0xfff1d6 : 0x444444, intensity: headOn ? 6 : 0.2, roughness: 0.1 });
  const tail = mat(0x220000, { emissive: 0xff1010, intensity: tailOn ? 2.5 : 0.15, roughness: 0.2 });
  for (const s of [-1, 1]) {
    g.add(box(0.05, 0.12, 0.28, head, [front, h, s * (w / 2 - 0.22)], { cast: false }));
    g.add(box(0.05, 0.16, 0.2, tail, [rear, h + 0.05, s * (w / 2 - 0.16)], { cast: false }));
  }
  void len;
}

/** A sedan, length along +x (front at +x). */
export function sedan(color = 0x2b3038, { headOn = false } = {}) {
  const g = new Group();
  const paint = mat(color, { roughness: 0.32, clearcoat: 1, metalness: 0.4 });
  const glass = mat(0x0a0d10, { roughness: 0.05, metalness: 0.0, clearcoat: 1 });
  const L = 4.6, W = 1.8;
  const body = extrude([[-2.3, 0.28], [2.3, 0.28], [2.32, 0.62], [2.0, 0.82], [0.95, 0.9], [0.35, 1.38], [-1.0, 1.42], [-1.75, 0.98], [-2.3, 0.92]], W - 0.1, paint, { bevel: 0.05 });
  body.position.z = -(W - 0.1) / 2;
  const cabin = extrude([[0.88, 0.92], [0.33, 1.34], [-0.98, 1.38], [-1.66, 0.97]], W - 0.24, glass, { bevel: 0.02 });
  cabin.position.z = -(W - 0.24) / 2;
  g.add(body, cabin);
  body.castShadow = cabin.castShadow = true;
  for (const [x, z] of [[1.42, 0.82], [1.42, -0.82], [-1.38, 0.82], [-1.38, -0.82]]) { const w = wheel(); w.position.set(x, 0.33, z); g.add(w); }
  lights(g, { len: L, w: W, front: 2.33, rear: -2.32, headOn });
  return g;
}

/**
 * A panel van (the white one): length along +x, rear doors at -x that can stand open.
 * Returns the group with .doors = [left, right] (hinged groups) and .glovebox point.
 */
export function van({ color = 0xe8e8e4, open = true, dirt = 0.2 } = {}) {
  const g = new Group();
  const paint = mat(new Color(color).lerp(new Color(0x8a8070), dirt), { roughness: 0.38, clearcoat: 0.8 });
  const glass = mat(0x0a0d10, { roughness: 0.05, clearcoat: 1 });
  const dark = mat(0x111214, { roughness: 0.8 });
  const L = 5.6, W = 2.0;
  const shell = extrude([[-2.8, 0.38], [2.8, 0.38], [2.85, 0.75], [2.62, 1.12], [1.85, 1.45], [1.45, 2.38], [-2.8, 2.42]], W, paint, { bevel: 0.05 });
  shell.position.z = -W / 2;
  const wind = extrude([[2.55, 1.18], [1.88, 1.47], [1.48, 2.3], [1.6, 2.32], [1.98, 1.58], [2.62, 1.2]], W - 0.18, glass, { bevel: 0.01 });
  wind.position.z = -(W - 0.18) / 2;
  g.add(shell, wind);
  shell.castShadow = true;
  // side windows of the cab
  for (const s of [-1, 1]) g.add(box(0.85, 0.5, 0.02, glass, [1.15, 1.75, s * (W / 2 + 0.03)], { cast: false }));
  // the cargo bay seen through the open doors: dark interior box
  g.add(box(3.9, 1.8, W - 0.12, dark, [-0.95, 1.38, 0], { cast: false }));
  // rear doors on hinges
  g.doors = [];
  for (const s of [-1, 1]) {
    const hinge = new Group();
    hinge.position.set(-2.82, 0, s * (W / 2 - 0.02));
    const door = box(0.05, 1.9, W / 2 - 0.04, paint, [0, 1.42, -s * (W / 4 - 0.01)]);
    const win = box(0.06, 0.45, W / 2 - 0.3, glass, [0, 1.95, -s * (W / 4 - 0.01)], { cast: false });
    hinge.add(door, win);
    if (open) hinge.rotation.y = s * MathUtils.degToRad(110);
    g.add(hinge); g.doors.push(hinge);
  }
  for (const [x, z] of [[1.9, 0.92], [1.9, -0.92], [-1.75, 0.92], [-1.75, -0.92]]) { const w = wheel(0.36, 0.24); w.position.set(x, 0.36, z); g.add(w); }
  // bumper and grille
  g.add(box(0.15, 0.22, W + 0.04, dark, [2.86, 0.48, 0]));
  g.add(box(0.12, 0.2, W + 0.04, dark, [-2.86, 0.48, 0]));
  lights(g, { len: L, w: W, front: 2.83, rear: -2.86, h: 0.95, tailOn: true });
  g.glovebox = [1.5, 1.05, 0.3];
  return g;
}
