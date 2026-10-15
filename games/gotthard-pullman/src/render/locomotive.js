/**
 * SBB C 5/6 2978 "Elefant" and its tender, to the SBB Historic data sheet: 12.685 m over the
 * buffers (19.195 m with the tender), wheel arrangement 1'E (a pony truck with 850 mm wheels
 * and five coupled axles with 1330 mm drivers), four-cylinder compound with the two big
 * low-pressure cylinders outside, a three-axle tender for 18 m³ of water and 8 t of coal.
 * Black, with red wheels and buffer beams; brass number plates. (Positions of the axles,
 * boiler and domes are estimated from the class's general arrangement, see README.)
 *
 * The coupled wheels turn with the engine's crank angle from the physics, the coupling and
 * connecting rods and crossheads follow them; the pony truck and the tender's wheels turn
 * with the distance run. The cab is fitted out (backhead, firedoor, gauges, regulator,
 * reverser, brake valves) where cab.js puts the crew's controls.
 *
 * Coordinates: x forward from the engine's middle, y up from the rail head, z right.
 */
import { Group, Vector3, Matrix4, MeshStandardMaterial, MeshPhysicalMaterial, Color, Mesh, CircleGeometry, BoxGeometry, CylinderGeometry, CanvasTexture } from 'three';
import { Builder } from './geom.js';
import { letteringTexture } from './carArt.js';
import { CONTROLS } from '../crew/cab.js';

export const LOCO = {
  length: 12.685, half: 12.685 / 2,
  driverR: 0.665, ponyR: 0.425, tenderR: 0.515,
  axles: [4.15, 5.6, 7.05, 8.5, 9.95],      // coupled axles, metres behind the front buffer face
  pony: 2.25,
  mainAxle: 2,                               // the outside LP cylinders drive the third coupled axle (the inside HP ones the second)
  crank: 0.32, rod: 4.25,                    // crank radius (half the 640 mm stroke); connecting rod (estimated: the crosshead in its guides)
  cylY: 1.0, cylZ: 1.13, cylD: 1.5,          // outside (LP) cylinders: height, offset, distance behind the buffer face
  boilerY: 2.95,
};
const X = (d) => LOCO.half - d;
const CONTROLS_POS = Object.fromEntries(Object.entries(CONTROLS).map(([k, v]) => [k, v.pos]));              // distance behind the front buffer face -> x
const V = (x, y, z) => new Vector3(x, y, z);

let _mats = null;
export function locoMaterials() {
  if (_mats) return _mats;
  _mats = {
    black: new MeshPhysicalMaterial({ color: new Color(0.018, 0.018, 0.02), roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.3 }),
    smokebox: new MeshStandardMaterial({ color: new Color(0.03, 0.03, 0.032), roughness: 0.8, metalness: 0.2 }),
    red: new MeshPhysicalMaterial({ color: new Color(0.42, 0.03, 0.02), roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
    steel: new MeshStandardMaterial({ color: new Color(0.42, 0.42, 0.43), roughness: 0.3, metalness: 1.0 }),
    tyre: new MeshStandardMaterial({ color: new Color(0.5, 0.5, 0.51), roughness: 0.35, metalness: 1.0 }),
    brass: new MeshStandardMaterial({ color: new Color(0.8, 0.62, 0.32), roughness: 0.25, metalness: 1.0 }),
    copper: new MeshStandardMaterial({ color: new Color(0.75, 0.38, 0.22), roughness: 0.3, metalness: 1.0 }),
    cabwood: new MeshStandardMaterial({ color: new Color(0.42, 0.3, 0.18), roughness: 0.7 }),
    cabpaint: new MeshStandardMaterial({ color: new Color(0.2, 0.22, 0.2), roughness: 0.75 }),
    floor: new MeshStandardMaterial({ color: new Color(0.25, 0.2, 0.15), roughness: 0.9 }),
    coal: new MeshStandardMaterial({ color: new Color(0.012, 0.012, 0.013), roughness: 0.55, metalness: 0.0 }),
    glass: new MeshStandardMaterial({ color: new Color(0.05, 0.06, 0.065), roughness: 0.05, metalness: 0.0 }),
    lamp: new MeshStandardMaterial({ color: new Color(1, 0.95, 0.85), emissive: new Color(1, 0.9, 0.7), emissiveIntensity: 3.0, roughness: 0.2 }),
    fire: new MeshStandardMaterial({ color: new Color(0, 0, 0), emissive: new Color(1.0, 0.45, 0.12), emissiveIntensity: 6.0 }),
    gauge: new MeshStandardMaterial({ color: new Color(0.85, 0.83, 0.78), roughness: 0.35 }),
    plate: new MeshStandardMaterial({ map: letteringTexture('2978', { w: 512, h: 160, paint: '#0b0b0c', gold: '#d9b45a', size: 120, spacing: 0.08 }), roughness: 0.3, metalness: 0.6 }),
  };
  return _mats;
}

/** A spoked driving wheel (red centre, steel tyre, counterweight), axis along z, centred at origin. */
function wheel(b, R, { spokes = 16, width = 0.13, counterweight = true, centre = 'red' } = {}) {
  const t = width / 2;
  b.cylinder('tyre', V(0, 0, -t), V(0, 0, t), R, R, { segs: 32, open: true });
  b.cylinder('tyre', V(0, 0, -t - 0.035), V(0, 0, -t + 0.005), R + 0.03, R + 0.03, { segs: 32, open: true });   // flange (inside)
  // the faces of the rim (rings, so the spokes show between)
  for (const [z, sgn] of [[t, 1], [-t, -1]]) {
    for (let i = 0; i < 32; i++) {
      const a0 = (i / 32) * Math.PI * 2, a1 = ((i + 1) / 32) * Math.PI * 2;
      const P = (r, a) => V(Math.cos(a) * r, Math.sin(a) * r, z);
      if (sgn > 0) b.quad('tyre', P(R - 0.06, a0), P(R, a0), P(R, a1), P(R - 0.06, a1));
      else b.quad('tyre', P(R - 0.06, a1), P(R, a1), P(R, a0), P(R - 0.06, a0));
    }
  }
  b.cylinder(centre, V(0, 0, -t * 0.9), V(0, 0, t * 0.9), R - 0.06, R - 0.06, { segs: 32, open: true });
  b.cylinder(centre, V(0, 0, -t * 0.6), V(0, 0, t * 0.6), 0.16, 0.16, { segs: 16 });                 // hub
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const p1 = V(Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0), p2 = V(Math.cos(a) * (R - 0.07), Math.sin(a) * (R - 0.07), 0);
    b.cylinder(centre, p1, p2, 0.028, 0.02, { segs: 5 });
  }
  if (counterweight) {
    // a crescent filling the spokes opposite the crank
    for (let i = 0; i < 6; i++) {
      const a0 = Math.PI + (i - 3) * 0.16, a1 = a0 + 0.16;
      const r0 = R * 0.45, r1 = R - 0.07;
      const P = (r, a, z) => V(Math.cos(a) * r, Math.sin(a) * r, z);
      for (const z of [t * 0.55, -t * 0.55]) b.quad(centre, P(r0, a0, z), P(r1, a0, z), P(r1, a1, z), P(r0, a1, z));
    }
  }
}

/** The engine: { group, parts } with the moving parts to animate. */
export function buildLocomotive() {
  const M = locoMaterials();
  const b = new Builder();
  const h = LOCO.half;
  // ---- frame, buffer beams, running boards
  // plate frames (deep, between the wheels), the firebox's foundation ring and ashpan between the rear drivers
  for (const z of [-0.6, 0.6]) b.box('black', [X(12.3), 0.62, z - 0.05], [X(0.78), 1.56, z + 0.05]);
  b.box('black', [X(12.3), 0.75, -0.6], [X(0.78), 0.95, 0.6]);
  b.box('smokebox', [X(10.1), 1.05, -0.58], [X(8.45), 1.62, 0.58]);
  b.box('black', [X(10.15), 1.56, -0.98], [X(8.6), 2.1, 0.98]);
  b.box('red', [X(0.78), 0.82, -1.45], [X(0.62), 1.32, 1.45]);                             // front buffer beam
  for (const z of [-0.875, 0.875]) {
    b.cylinder('black', V(X(0.62), 1.06, z), V(X(0.2), 1.06, z), 0.11, 0.09, { segs: 12 });
    b.cylinder('steel', V(X(0.2), 1.06, z), V(X(0.0), 1.06, z), 0.19, 0.19, { segs: 16 });
  }
  b.box('steel', [X(0.62), 0.98, -0.07], [X(0.25), 1.12, 0.07]);                           // draw hook
  for (const z of [-1.3, 1.3]) b.box('black', [X(10.1), 1.56, z - 0.17], [X(0.9), 1.62, z + 0.17]);   // running boards
  b.box('black', [X(1.05), 1.32, -1.45], [X(0.78), 1.62, 1.45]);
  // ---- outside LP cylinders, slide bars
  for (const z of [-LOCO.cylZ, LOCO.cylZ]) {
    b.cylinder('black', V(X(LOCO.cylD + 0.5), LOCO.cylY, z), V(X(LOCO.cylD - 0.5), LOCO.cylY, z), 0.42, 0.42, { segs: 20 });
    b.cylinder('steel', V(X(LOCO.cylD - 0.52), LOCO.cylY, z), V(X(LOCO.cylD - 0.6), LOCO.cylY, z), 0.3, 0.3, { segs: 20 });   // front cover
    b.box('black', [X(LOCO.cylD + 0.45), LOCO.cylY + 0.38, z - 0.16], [X(LOCO.cylD - 0.45), LOCO.cylY + 0.62, z + 0.16]);      // valve chest
    b.box('steel', [X(3.25), LOCO.cylY + 0.1, z - 0.05], [X(LOCO.cylD + 0.5), LOCO.cylY + 0.14, z + 0.05]);                   // slide bars
    b.box('steel', [X(3.25), LOCO.cylY - 0.14, z - 0.05], [X(LOCO.cylD + 0.5), LOCO.cylY - 0.1, z + 0.05]);
  }
  // inside HP cylinders (between the frames, under the smokebox)
  b.box('black', [X(2.4), 0.85, -0.6], [X(1.0), 1.55, 0.6]);
  // ---- boiler: smokebox, barrel with bands, firebox
  const by = LOCO.boilerY;
  b.cylinder('smokebox', V(X(2.6), by, 0), V(X(0.95), by, 0), 0.93, 0.93, { segs: 32, open: true });
  b.lathe('smokebox', V(X(0.95), by, 0), V(1, 0, 0), [[0.93, 0], [0.9, 0.06], [0.75, 0.12], [0.0, 0.15]], { segs: 32 });   // door, slightly domed
  b.cylinder('steel', V(X(0.92), by, 0), V(X(0.82), by, 0), 0.06, 0.06, { segs: 10 });                                       // door handle boss
  b.cylinder('black', V(X(8.7), by, 0), V(X(2.6), by, 0), 0.86, 0.86, { segs: 32, open: true });
  for (const d of [3.4, 4.9, 6.4, 7.9]) b.cylinder('steel', V(X(d + 0.03), by, 0), V(X(d - 0.03), by, 0), 0.875, 0.875, { segs: 32, open: true });   // boiler bands
  b.box('black', [X(10.15), 1.6, -0.98], [X(8.6), by + 0.86, 0.98]);                                                         // firebox (round top as a box)
  b.cylinder('black', V(X(10.15), by, 0), V(X(8.6), by, 0), 0.98, 0.98, { segs: 32, open: true });
  // chimney, sand dome, steam dome, safety valves, whistle
  b.lathe('black', V(X(1.75), by + 0.8, 0), V(0, 1, 0), [[0.3, 0], [0.27, 0.25], [0.29, 0.55], [0.36, 0.66], [0.33, 0.7], [0.0, 0.7]], { segs: 20 });
  b.lathe('black', V(X(4.15), by + 0.75, 0), V(0, 1, 0), [[0.42, 0], [0.38, 0.35], [0.3, 0.48], [0.0, 0.52]], { segs: 20 });
  b.lathe('black', V(X(5.75), by + 0.75, 0), V(0, 1, 0), [[0.45, 0], [0.4, 0.42], [0.32, 0.56], [0.0, 0.6]], { segs: 20 });
  for (const z of [-0.18, 0.18]) b.cylinder('brass', V(X(9.3), by + 0.85, z), V(X(9.3), by + 1.22, z), 0.07, 0.06, { segs: 12 });
  b.cylinder('brass', V(X(9.75), by + 0.85, 0.35), V(X(9.75), by + 1.25, 0.35), 0.05, 0.06, { segs: 12 });                  // whistle
  // air pump on the right side, sand pipes, handrails
  b.cylinder('black', V(X(3.8), 1.75, 1.15), V(X(3.8), 2.85, 1.15), 0.17, 0.17, { segs: 14 });
  b.cylinder('steel', V(X(3.8), 2.85, 1.15), V(X(3.8), 2.95, 1.15), 0.12, 0.12, { segs: 14 });
  for (const z of [-0.98, 0.98]) b.cylinder('steel', V(X(9.9), by + 0.2, z), V(X(1.2), by + 0.2, z), 0.015, 0.015, { segs: 6 });
  // headlamps: two at the buffer beam, one high on the smokebox
  for (const [d, y, z] of [[0.7, 1.55, -0.8], [0.7, 1.55, 0.8], [0.95, by + 0.98, 0]]) {
    b.box('black', [X(d + 0.22), y - 0.17, z - 0.17], [X(d), y + 0.17, z + 0.17]);
    b.cylinder('lamp', V(X(d) + 0.01, y, z), V(X(d) + 0.02, y, z), 0.11, 0.11, { segs: 14 });
  }
  // ---- cab
  const c0 = 10.1, c1 = 12.3, cy0 = 1.62, cy1 = 4.25, cw = 1.45;
  // front wall with spectacle windows beside the boiler
  b.box('black', [X(c0 + 0.05), cy0, -cw], [X(c0), cy1 - 0.3, -1.0]);
  b.box('black', [X(c0 + 0.05), cy0, 1.0], [X(c0), cy1 - 0.3, cw]);
  b.box('black', [X(c0 + 0.05), 3.55, -1.0], [X(c0), cy1 - 0.3, 1.0]);
  // sides: lower panel and window frame, open behind (door opening toward the tender)
  for (const s of [-1, 1]) {
    const z = s * cw;
    b.box('black', [X(c1), cy0, Math.min(z, z - s * 0.04)], [X(c0), 2.65, Math.max(z, z - s * 0.04)]);
    b.box('black', [X(c0 + 0.65), 2.65, Math.min(z, z - s * 0.04)], [X(c0), cy1 - 0.3, Math.max(z, z - s * 0.04)]);
    b.box('black', [X(c1), 2.65, Math.min(z, z - s * 0.04)], [X(c1 - 0.25), cy1 - 0.3, Math.max(z, z - s * 0.04)]);
    b.box('black', [X(c1 - 0.25), 3.55, Math.min(z, z - s * 0.04)], [X(c0 + 0.65), cy1 - 0.3, Math.max(z, z - s * 0.04)]);
    // the number plate on the cab side
    const zp = z + s * 0.004;
    if (s > 0) b.quad('plate', V(X(11.6), 2.0, zp), V(X(10.7), 2.0, zp), V(X(10.7), 2.3, zp), V(X(11.6), 2.3, zp));
    else b.quad('plate', V(X(10.7), 2.0, zp), V(X(11.6), 2.0, zp), V(X(11.6), 2.3, zp), V(X(10.7), 2.3, zp));
  }
  // roof (arched)
  const roof = [];
  for (let i = 0; i <= 10; i++) { const a = Math.PI * (i / 10); roof.push([Math.cos(a) * (cw + 0.08), cy1 - 0.3 + Math.sin(a) * 0.32]); }
  b.extrudeX('black', roof, X(c1 + 0.25), X(c0 - 0.05), { closed: false });
  b.extrudeX('cabpaint', roof.map(([z, y]) => [z * 0.97, y - 0.03]).reverse(), X(c1 + 0.2), X(c0), { closed: false });
  b.box('floor', [X(c1), cy0, -cw], [X(c0), cy0 + 0.05, cw]);
  // the backhead plate; its fittings are where the crew's hands find them (cab.js), see cabFittings
  b.box('black', [X(c0 + 0.12), cy0, -0.95], [X(c0 + 0.05), by + 0.95, 0.95]);
  const controls = cabFittings(b, M);
  b.box('cabwood', [X(c0 + 1.9), 2.2, 0.85], [X(c0 + 1.5), 2.26, 1.35]);                                                    // driver's seat
  b.box('cabwood', [X(c0 + 1.9), 2.2, -1.35], [X(c0 + 1.5), 2.26, -0.85]);                                                  // fireman's seat
  // ---- the pony truck frame and the rods' fixed parts are below; the wheels are separate (they turn)
  const group = b.build(M);
  group.name = 'C 5/6 2978';
  const parts = { wheels: [], pony: null, rods: [], crossheads: [], mainRods: [], controls };
  for (const g of Object.values(controls)) if (g?.isObject3D) group.add(g);
  for (const w of controls.glassWater ?? []) group.add(w);
  // coupled wheelsets
  for (const d of LOCO.axles) {
    const ws = new Builder();
    for (const z of [-0.7175, 0.7175]) { ws.transform(new Matrix4().makeTranslation(0, 0, z + Math.sign(z) * 0.0)); wheel(ws, LOCO.driverR); ws.transform(null); }
    ws.cylinder('steel', V(0, 0, -0.66), V(0, 0, 0.66), 0.1, 0.1, { segs: 12 });
    // crank pins on the outside faces
    for (const z of [-0.8, 0.8]) ws.cylinder('steel', V(LOCO.crank, 0, z - Math.sign(z) * 0.05), V(LOCO.crank, 0, z + Math.sign(z) * 0.08), 0.055, 0.055, { segs: 10 });
    const g = ws.build(M);
    g.position.set(X(d), LOCO.driverR, 0);
    group.add(g);
    parts.wheels.push(g);
  }
  {
    const ws = new Builder();
    for (const z of [-0.7175, 0.7175]) { ws.transform(new Matrix4().makeTranslation(0, 0, z)); wheel(ws, LOCO.ponyR, { spokes: 10, counterweight: false }); ws.transform(null); }
    ws.cylinder('steel', V(0, 0, -0.66), V(0, 0, 0.66), 0.08, 0.08, { segs: 10 });
    const g = ws.build(M);
    g.position.set(X(LOCO.pony), LOCO.ponyR, 0);
    group.add(g);
    parts.pony = g;
  }
  // coupling rods (one per side) and connecting rods with their crossheads: moved each frame
  for (const s of [-1, 1]) {
    const z = s * 0.86;
    const rb = new Builder();
    const len = LOCO.axles[4] - LOCO.axles[0];
    rb.box('steel', [-len / 2 - 0.12, -0.06, -0.025], [len / 2 + 0.12, 0.06, 0.025]);
    const rod = rb.build(M); rod.userData.z = z; rod.userData.side = s;
    group.add(rod); parts.rods.push(rod);
    const cb = new Builder();
    cb.box('steel', [-0.18, -0.13, -0.07], [0.18, 0.13, 0.07]);
    const ch = cb.build(M); ch.userData.z = s * LOCO.cylZ; ch.userData.side = s;
    group.add(ch); parts.crossheads.push(ch);
    const mb = new Builder();
    mb.box('steel', [0, -0.065, -0.03], [LOCO.rod, 0.065, 0.03]);
    const mr = mb.build(M); mr.userData.z = s * 1.0; mr.userData.side = s;
    group.add(mr); parts.mainRods.push(mr);
  }
  return { group, parts };
}

/** Moves the wheels and the motion for the crank angle (theta: the physics' HP right crank) and the distance run. */
export function animateLocomotive(parts, theta, s) {
  for (const w of parts.wheels) w.rotation.z = -theta;
  if (parts.pony) parts.pony.rotation.z = -s / LOCO.ponyR;
  // the outside (LP) cranks: right side opposite the right HP crank, left side a quarter behind it
  const mid = (X(LOCO.axles[4]) + X(LOCO.axles[0])) / 2;
  for (const [k, rod] of parts.rods.entries()) {
    const a = theta + (rod.userData.side > 0 ? Math.PI : Math.PI / 2);
    rod.position.set(mid + Math.cos(-a) * LOCO.crank, LOCO.driverR + Math.sin(-a) * LOCO.crank, rod.userData.z);
    // crosshead and connecting rod: slider-crank from the main axle
    const ax = X(LOCO.axles[LOCO.mainAxle]), ay = LOCO.driverR;
    const px = ax + Math.cos(-a) * LOCO.crank, py = ay + Math.sin(-a) * LOCO.crank;
    const dy = LOCO.cylY - py, chx = px + Math.sqrt(Math.max(0, LOCO.rod * LOCO.rod - dy * dy));
    const ch = parts.crossheads[k];
    ch.position.set(chx, LOCO.cylY, ch.userData.z);
    const mr = parts.mainRods[k];
    mr.position.set(px, py, mr.userData.z);
    mr.rotation.z = Math.atan2(LOCO.cylY - py, chx - px);
  }
}

// ---- the footplate -------------------------------------------------------------------------------

/** cab.js's frame on the engine: its origin 11.37 m behind the front buffer face, on the cab floor. */
export const CAB = { d0: 11.37, floor: 1.67 };
/** A point of cab.js's frame (x right, y up from the floor, z toward the boiler) in the engine model. */
export const cabToModel = ([x, y, z]) => V(X(CAB.d0 - z), CAB.floor + y, x);

/** A small handwheel facing the cab (axis fore and aft), as its own group so it can turn. */
function handwheel(M, r, { spokes = 4, mat = 'steel', knob = false } = {}) {
  const w = new Builder();
  w.cylinder(mat, V(-0.012, 0, 0), V(0.012, 0, 0), r, r, { segs: 18, open: true });
  w.cylinder(mat, V(-0.016, 0, 0), V(0.016, 0, 0), r * 0.18, r * 0.18, { segs: 8 });
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    w.cylinder(mat, V(0, Math.cos(a) * r * 0.15, Math.sin(a) * r * 0.15), V(0, Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95), r * 0.06 + 0.004, r * 0.06 + 0.004, { segs: 5 });
  }
  if (knob) w.cylinder('cabwood', V(0, r, 0), V(-0.09, r, 0), 0.016, 0.016, { segs: 8 });
  return w.build(M);
}

/**
 * The gauges of a Swiss steam engine's backhead (positions on 2978 estimated): boiler pressure,
 * the compound's receiver, the brake's duplex gauge (main reservoir red, brake pipe black), the
 * brake cylinders, the train heating, and the Hasler speed indicator by the driver's window.
 * Scales in bar (gauge) and km/h; the needle sweeps 270 degrees clockwise.
 */
export const DIALS = [
  { id: 'gBoiler', pos: [0.0, 2.05, 1.06], r: 0.1, label: 'KESSEL', unit: 'bar', max: 20, major: 5, minor: 1, red: 15, needles: ['#111'] },
  { id: 'gReceiver', pos: [-0.34, 1.95, 1.08], r: 0.075, label: 'VERBINDER', unit: 'bar', max: 10, major: 2, minor: 0.5, red: 6, needles: ['#111'] },
  { id: 'gDuplex', pos: [0.62, 1.88, 1.08], r: 0.075, label: 'HL  HB', unit: 'bar', max: 10, major: 2, minor: 0.5, red: null, needles: ['#b01515', '#111'] },
  { id: 'gCylinder', pos: [0.38, 1.82, 1.08], r: 0.06, label: 'BREMSZYL.', unit: 'bar', max: 6, major: 1, minor: 0.5, red: null, needles: ['#111'] },
  { id: 'gHeat', pos: [-0.58, 1.84, 1.08], r: 0.06, label: 'HEIZUNG', unit: 'bar', max: 6, major: 1, minor: 0.5, red: 4, needles: ['#111'] },
  { id: 'gSpeed', pos: [0.92, 1.72, 1.0], r: 0.09, label: 'HASLER', unit: 'km/h', max: 90, major: 10, minor: 5, red: 65, needles: ['#111'] },
];

function dialTexture(d) {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), cx = S / 2, R = S / 2 - 4;
  g.fillStyle = '#f1ebdc'; g.beginPath(); g.arc(cx, cx, R, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#3a3226'; g.lineWidth = 4; g.stroke();
  const ang = (v) => (-135 + 270 * v / d.max) * Math.PI / 180 - Math.PI / 2;
  if (d.red != null) { g.strokeStyle = '#c0281e'; g.lineWidth = 10; g.beginPath(); g.arc(cx, cx, R - 16, ang(d.red), ang(d.max)); g.stroke(); }
  g.strokeStyle = '#1b1b1b'; g.fillStyle = '#1b1b1b';
  for (let v = 0; v <= d.max + 1e-6; v += d.minor) {
    const a = ang(v), major = Math.abs(v / d.major - Math.round(v / d.major)) < 1e-6;
    const r0 = R - (major ? 30 : 20), r1 = R - 8;
    g.lineWidth = major ? 4 : 2;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cx + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, cx + Math.sin(a) * r1); g.stroke();
    if (major) { g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(v), cx + Math.cos(a) * (R - 52), cx + Math.sin(a) * (R - 52)); }
  }
  g.font = 'bold 20px sans-serif'; g.textAlign = 'center'; g.fillText(d.label, cx, cx + 46);
  g.font = '18px sans-serif'; g.fillText(d.unit, cx, cx + 72);
  const t = new CanvasTexture(c);
  t.colorSpace = 'srgb';
  return t;
}

/**
 * The fittings of 2978's backhead and footplate at the positions of cab.js: what turns or swings
 * is a group of its own (returned by name), the rest goes into the engine's builder.
 */
function cabFittings(b, M) {
  const P = cabToModel;
  const out = {};
  const at = (g, p, name) => { g.position.copy(P(p)); g.name = name; out[name] = g; return g; };
  const face = X(CAB.d0 - 1.15);                       // the backhead plate's face, toward the cab
  // fire door: the firehole ring, the fire behind it, the door on its hinge (left edge)
  const fy0 = CAB.floor + 0.79, fy1 = CAB.floor + 1.11;
  for (const [y0, y1, z0, z1] of [[fy1, fy1 + 0.07, -0.3, 0.3], [fy0 - 0.07, fy0, -0.3, 0.3], [fy0, fy1, -0.3, -0.22], [fy0, fy1, 0.22, 0.3]]) b.box('steel', [face - 0.03, y0, z0], [face, y1, z1]);
  b.box('fire', [face - 0.004, fy0, -0.22], [face - 0.002, fy1, 0.22]);
  {
    const d = new Builder();
    d.box('steel', [-0.027, -0.2, 0], [0, 0.2, 0.46]);
    d.box('brass', [-0.05, -0.03, 0.36], [-0.027, 0.03, 0.42]);          // the handle
    const g = at(d.build(M), [-0.23, 0.95, 1.15], 'firedoor');
    g.position.x = face - 0.031;
  }
  // the manifold across the top of the firebox with the steam valves on it
  b.cylinder('copper', P([-0.7, 1.62, 1.1]), P([0.7, 1.62, 1.1]), 0.03, 0.03, { segs: 8 });
  for (const [name, r] of [['startingValve', 0.055], ['injectorR', 0.06], ['injectorL', 0.06], ['steamHeat', 0.05], ['blower', 0.05]]) {
    const p = CONTROLS_POS[name];
    b.cylinder('brass', P([p[0], p[1], 1.1]), P([p[0], p[1], p[2] + 0.04]), 0.018, 0.018, { segs: 6 });
    const g = at(handwheel(M, r, { mat: name === 'blower' ? 'brass' : 'steel' }), p, name);
    g.userData.turns = name === 'blower' ? 3 : 1.5;
  }
  // regulator: the shaft boss high on the backhead and the handle swinging across it
  b.cylinder('brass', P([0.0, 2.1, 1.15]), P([0.0, 2.1, 1.08]), 0.06, 0.06, { segs: 14 });
  {
    const h = new Builder();
    h.box('steel', [-0.075, -0.33, -0.018], [-0.045, 0.04, 0.018]);
    h.cylinder('cabwood', V(-0.06, -0.32, 0), V(-0.2, -0.32, 0), 0.02, 0.02, { segs: 8 });
    const g = at(h.build(M), [0.0, 2.1, 1.08], 'regulator');
    g.position.x = face - 0.02;
  }
  // the gauges, each a brass case on the backhead with its dial and needles (turned by animateGauges)
  out.dials = [];
  for (const d of DIALS) {
    const [x, y, z] = d.pos, r = d.r;
    b.cylinder('brass', P([x, y, 1.15]), P([x, y, z - 0.02]), r + 0.012, r + 0.012, { segs: 22 });
    const g = new Group();
    g.position.copy(P([x, y, z - 0.026]));
    g.rotation.y = -Math.PI / 2;                       // the face looks back into the cab
    const face = new Mesh(new CircleGeometry(r, 40), new MeshStandardMaterial({ map: dialTexture(d), roughness: 0.3 }));
    g.add(face);
    const needles = d.needles.map((col) => {
      const n = new Mesh(new BoxGeometry(r * 0.05, r * 0.86, 0.004).translate(0, r * 0.33, 0.006), new MeshStandardMaterial({ color: new Color(col), roughness: 0.4 }));
      g.add(n);
      return n;
    });
    g.add(new Mesh(new CircleGeometry(r * 0.08, 12).translate(0, 0, 0.011), new MeshStandardMaterial({ color: new Color('#222'), roughness: 0.4 })));
    g.name = d.id;
    out.dials.push({ d, g, needles });
    out[d.id] = g;
  }
  // the water in the gauge glasses: a column whose top is the level in the boiler
  out.glassWater = [];
  // the gauge glasses either side of the fire door
  for (const x of [-0.22, 0.22]) {
    b.cylinder('brass', P([x, 1.38, 1.1]), P([x, 1.42, 1.1]), 0.022, 0.022, { segs: 8 });
    b.cylinder('glass', P([x, 1.42, 1.1]), P([x, 1.68, 1.1]), 0.012, 0.012, { segs: 8 });
    b.cylinder('brass', P([x, 1.68, 1.1]), P([x, 1.72, 1.1]), 0.022, 0.022, { segs: 8 });
    // the water column (scaled up from the bottom fitting), with a red-and-white striped back plate
    const w = new Mesh(new CylinderGeometry(0.0085, 0.0085, 1, 8).translate(0, 0.5, 0), new MeshStandardMaterial({ color: new Color(0.55, 0.62, 0.62), roughness: 0.1, emissive: new Color(0.08, 0.1, 0.1) }));
    w.position.copy(P([x, 1.42, 1.1]));
    out.glassWater.push(w);
    b.box('gauge', [X(CAB.d0 - 1.115) - 0.002, CAB.floor + 1.42, x - 0.018], [X(CAB.d0 - 1.115), CAB.floor + 1.68, x + 0.018]);
  }
  // the reversing screw on its pedestal, its handwheel facing the driver
  {
    const p = CONTROLS_POS.reverser;
    b.box('black', [X(CAB.d0 - p[2]) - 0.05, CAB.floor, p[0] - 0.06], [X(CAB.d0 - p[2]) + 0.25, CAB.floor + p[1] - 0.16, p[0] + 0.06]);
    b.cylinder('steel', P([p[0], p[1], p[2] + 0.02]), P([p[0], p[1], p[2] + 0.32]), 0.03, 0.03, { segs: 8 });
    const g = at(handwheel(M, 0.16, { spokes: 4, knob: true }), p, 'reverser');
    g.userData.turns = 12;
  }
  // the driver's brake valve on its bracket by the right side window, the direct brake below
  for (const [name, r, len] of [['trainBrake', 0.07, 0.24], ['directBrake', 0.05, 0.18]]) {
    const p = CONTROLS_POS[name];
    b.cylinder('black', P([p[0], p[1] - 0.18, p[2]]), P([p[0], p[1] - 0.02, p[2]]), r, r, { segs: 14 });
    b.cylinder('black', P([p[0], 0, p[2]]), P([p[0], p[1] - 0.18, p[2]]), 0.025, 0.025, { segs: 8 });
    const h = new Builder();
    h.cylinder('steel', V(0, -0.02, 0), V(0, 0.02, 0), 0.03, 0.03, { segs: 10 });
    h.box('steel', [-0.012, 0, -0.012], [len, 0.02, 0.012]);
    h.cylinder('cabwood', V(len - 0.01, 0.02, 0), V(len - 0.01, 0.1, 0), 0.016, 0.016, { segs: 8 });
    at(h.build(M), [p[0], p[1], p[2]], name);
  }
  // sander and drain-cock levers, the dampers lever on the fireman's side
  for (const [name, len] of [['sander', 0.2], ['drainCocks', 0.55], ['dampers', 0.45]]) {
    const p = CONTROLS_POS[name];
    const h = new Builder();
    h.box('steel', [-0.012, 0, -0.012], [0.012, len, 0.012]);
    h.cylinder('cabwood', V(0, len, 0), V(0, len + 0.08, 0), 0.016, 0.016, { segs: 8 });
    const base = name === 'sander' ? [p[0], p[1] - 0.2, p[2]] : [p[0], 0, p[2]];
    const g = at(h.build(M), base, name);
    if (name === 'sander') b.cylinder('black', P([p[0], p[1] - 0.24, p[2]]), P([p[0], p[1] - 0.19, p[2]]), 0.03, 0.03, { segs: 8 });
    g.userData.len = len;
  }
  // the whistle's pull handle on its rod from the roof
  {
    const p = CONTROLS_POS.whistle;
    const h = new Builder();
    h.cylinder('steel', V(0, 0, 0), V(0, 0.5, 0), 0.006, 0.006, { segs: 5 });
    h.box('cabwood', [-0.06, -0.02, -0.015], [0.06, 0.0, 0.015]);
    at(h.build(M), p, 'whistle');
  }
  return out;
}

/** The gauges' needles and the gauge glasses from the engine and the brake (bar gauge, km/h). */
export function animateGauges(controls, loco, brake, speed, dt) {
  const C = controls;
  if (!C?.dials) return;
  const P_ATM = 1.013;
  const front = brake?.v?.[0];
  const values = {
    gBoiler: [loco.p - P_ATM],
    gReceiver: [loco.pRec - P_ATM],
    gDuplex: [loco.pMR - P_ATM, front?.pBP ?? 0],
    gCylinder: [Math.max(front?.pBC ?? 0, front?.pBCdirect ?? 0)],
    gHeat: [(loco.c.steamHeat ?? 0) * Math.min(4, Math.max(0, loco.p - P_ATM))],
    gSpeed: [Math.abs(speed) * 3.6],
  };
  for (const { d, needles } of C.dials) {
    const vals = values[d.id] ?? [0];
    needles.forEach((n, i) => {
      const v = Math.max(0, Math.min(d.max * 1.02, vals[i] ?? 0));
      const target = -(-135 + 270 * v / d.max) * Math.PI / 180;
      n.rotation.z += (target - n.rotation.z) * Math.min(1, dt * 6);
    });
  }
  // the glass shows about 0..200 mm above the lowest safe level (the crown sheet + 60 mm)
  const level = loco.out?.level ?? 120;
  const f = Math.max(0.02, Math.min(1, (level - 60) / 200));
  for (const w of C.glassWater ?? []) w.scale.y += (0.26 * f - w.scale.y) * Math.min(1, dt * 4);
}

/** Sets the footplate's handles and wheels from the controls (loco.c) and the brake. */
export function animateCab(controls, c, brake, dt) {
  const C = controls;
  if (!C) return;
  const ease = (o, key, v, rate = 8) => { o.userData[key] = (o.userData[key] ?? v) + (v - (o.userData[key] ?? v)) * Math.min(1, dt * rate); return o.userData[key]; };
  // regulator: closed hanging down-left, wide open swung across to the right
  if (C.regulator) C.regulator.rotation.x = -(0.44 + 1.22 * ease(C.regulator, 'v', c.regulator));
  if (C.reverser) C.reverser.rotation.x = ease(C.reverser, 'v', c.reverser, 3) * C.reverser.userData.turns * Math.PI * 2;
  for (const k of ['startingValve', 'injectorR', 'injectorL', 'steamHeat', 'blower']) {
    const g = C[k]; if (!g) continue;
    const v = k === 'injectorL' ? +c.injector[0] : k === 'injectorR' ? +c.injector[1] : +(c[k] ?? 0);
    g.rotation.x = ease(g, 'v', v, 3) * g.userData.turns * Math.PI * 2;
  }
  if (C.firedoor) C.firedoor.rotation.y = -1.35 * ease(C.firedoor, 'v', c.firedoor ? 1 : 0, 5);
  if (C.trainBrake && brake) {
    const h = brake.handle;
    const a = h === 'release' ? -0.9 : h === 'running' ? -0.45 : h === 'lap' ? 0 : h === 'emergency' ? 1.35 : 0.25 + 0.75 * Math.max(0, Math.min(1, (5.0 - 0.4 - brake.serviceTarget) / 1.1));
    C.trainBrake.rotation.y = -ease(C.trainBrake, 'v', a, 6);
  }
  if (C.directBrake && brake) C.directBrake.rotation.y = -ease(C.directBrake, 'v', (brake.direct ?? 0) * 1.3, 6);
  if (C.sander) C.sander.rotation.z = -ease(C.sander, 'v', c.sander ? 0.5 : 0, 6);
  if (C.drainCocks) C.drainCocks.rotation.z = -ease(C.drainCocks, 'v', c.drainCocks ? 0.45 : -0.1, 6);
  if (C.dampers) C.dampers.rotation.z = -ease(C.dampers, 'v', (c.dampers ?? 1) * 0.5 - 0.1, 4);
  if (C.whistle) { const u = C.whistle.userData; u.y0 ??= C.whistle.position.y; C.whistle.position.y = u.y0 - 0.05 * ease(C.whistle, 'v', c.whistle ?? 0, 12); }
}

/** The tender: 6.51 m over the buffers, three axles, a tank for 18 m³ and a coal space for 8 t. */
export function buildTender() {
  const M = locoMaterials();
  const b = new Builder();
  const hl = 6.51 / 2, R = LOCO.tenderR;
  b.box('black', [-hl + 0.62, 0.7, -0.7], [hl - 0.4, 1.25, 0.7]);                 // frame
  b.box('red', [-hl + 0.62, 0.82, -1.45], [-hl + 0.78, 1.32, 1.45]);              // rear buffer beam
  for (const z of [-0.875, 0.875]) {
    b.cylinder('black', V(-hl + 0.62, 1.06, z), V(-hl + 0.2, 1.06, z), 0.11, 0.09, { segs: 12 });
    b.cylinder('steel', V(-hl + 0.2, 1.06, z), V(-hl, 1.06, z), 0.19, 0.19, { segs: 16 });
  }
  // the tank, with the coal space at the front top
  b.box('black', [-hl + 0.7, 1.25, -1.4], [hl - 0.6, 3.05, 1.4]);
  b.box('black', [-hl + 0.7, 3.05, -1.4], [-hl + 2.6, 3.2, 1.4]);                 // tank top behind the coal
  for (const s of [-1, 1]) b.box('black', [-hl + 2.6, 3.05, s > 0 ? 1.32 : -1.4], [hl - 0.6, 3.6, s > 0 ? 1.4 : -1.32]);   // coal rails
  // the coal heap
  for (let i = 0; i < 7; i++) {
    const x0 = -hl + 2.7 + i * 0.5, top = 3.25 + 0.35 * Math.sin((i / 6) * Math.PI);
    b.box('coal', [x0, 3.05, -1.3], [x0 + 0.5, top, 1.3]);
  }
  b.box('black', [hl - 0.75, 1.25, -1.0], [hl - 0.6, 2.9, 1.0]);                 // front plate with the shovel opening
  b.box('steel', [hl - 0.62, 1.62, -0.3], [hl - 0.55, 1.66, 0.3]);                // shovel plate
  b.cylinder('black', V(-hl + 1.6, 3.2, 0.6), V(-hl + 1.6, 3.38, 0.6), 0.28, 0.28, { segs: 14 });   // water filler
  for (const z of [-1.05, 1.05]) b.box('black', [-hl + 0.5, 0.6, z - 0.07], [hl - 0.5, 0.95, z + 0.07]);   // outside frames
  const group = b.build(M);
  group.name = 'tender';
  const parts = { wheels: [] };
  for (const x of [-1.75, 0.05, 1.85]) {
    const ws = new Builder();
    for (const z of [-0.7175, 0.7175]) { ws.transform(new Matrix4().makeTranslation(0, 0, z)); wheel(ws, R, { spokes: 12, counterweight: false }); ws.transform(null); }
    ws.cylinder('steel', V(0, 0, -0.66), V(0, 0, 0.66), 0.08, 0.08, { segs: 10 });
    const g = ws.build(M);
    g.position.set(x, R, 0);
    group.add(g);
    parts.wheels.push(g);
  }
  return { group, parts };
}

export function animateTender(parts, s) { for (const w of parts.wheels) w.rotation.z = -s / LOCO.tenderR; }
