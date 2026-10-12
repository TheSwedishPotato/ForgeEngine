/**
 * The four heavyweight cars, built in the manner of Pullman's steel cars of the 1920s:
 * a riveted steel body painted dark blue-green, a steel clerestory ("railroad") roof with
 * its row of small deck lights, enclosed vestibules with diaphragms at both ends, and
 * three-axle trucks. Being built for the Swiss line, they have side buffers and screw
 * couplings and keep within the European loading gauge (2.92 m wide, 4.02 m over the roof).
 *
 * Inside, in mahogany and brass: the parlor car's revolving armchairs in green plush by the
 * windows, a drawing room, a pantry; the diner's tables laid in white; the sleeper's corridor
 * and compartments; the observation car's lounge and open rear platform.
 *
 * Vehicle coordinates: x forward, y up from the rail head, z right. The car is 25.3 m over
 * the buffers; its truck centres are 9.0 m either side of the middle.
 */
import { Group, Vector3, Matrix4, MeshStandardMaterial, MeshPhysicalMaterial, Color, DoubleSide } from 'three';
import { Builder } from './geom.js';
import { rivetNormalMap, letteringTexture, mahoganyTexture, carpetTexture } from './carArt.js';

import { BODY, LAYOUTS, doorsOf } from '../world/carLayout.js';
export { BODY, LAYOUTS };

// ---------------------------------------------------------------------------------------------

let _mats = null;
/** Materials shared by all the cars (built once). */
export function carMaterials() {
  if (_mats) return _mats;
  const teal = new Color('#1d3a43');
  _mats = {
    paint: new MeshPhysicalMaterial({ color: teal, roughness: 0.45, metalness: 0.0, clearcoat: 0.5, clearcoatRoughness: 0.35, normalMap: rivetNormalMap(), normalScale: { x: 0.35, y: 0.35 } }),
    letter: new MeshPhysicalMaterial({ map: letteringTexture('PULLMAN'), roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.35 }),
    roof: new MeshStandardMaterial({ color: new Color(0.045, 0.047, 0.05), roughness: 0.65, metalness: 0.2 }),
    under: new MeshStandardMaterial({ color: new Color(0.03, 0.03, 0.03), roughness: 0.75, metalness: 0.3 }),
    steel: new MeshStandardMaterial({ color: new Color(0.35, 0.35, 0.36), roughness: 0.35, metalness: 1.0 }),
    wheel: new MeshStandardMaterial({ color: new Color(0.06, 0.055, 0.05), roughness: 0.55, metalness: 0.6 }),
    tread: new MeshStandardMaterial({ color: new Color(0.55, 0.55, 0.56), roughness: 0.3, metalness: 1.0 }),
    rubber: new MeshStandardMaterial({ color: new Color(0.02, 0.02, 0.02), roughness: 0.9 }),
    brass: new MeshStandardMaterial({ color: new Color(0.78, 0.6, 0.3), roughness: 0.28, metalness: 1.0 }),
    wood: new MeshPhysicalMaterial({ map: mahoganyTexture(), roughness: 0.5, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
    woodDark: new MeshPhysicalMaterial({ map: mahoganyTexture(8), color: new Color(0.55, 0.5, 0.5), roughness: 0.55, clearcoat: 0.6, clearcoatRoughness: 0.25 }),
    ceiling: new MeshStandardMaterial({ color: new Color(0.78, 0.72, 0.58), roughness: 0.85 }),
    carpet: new MeshStandardMaterial({ map: carpetTexture(), roughness: 1.0 }),
    plush: new MeshPhysicalMaterial({ color: new Color(0.085, 0.17, 0.09), roughness: 0.9, sheen: 0.8, sheenRoughness: 0.5, sheenColor: new Color(0.2, 0.32, 0.2) }),
    linen: new MeshStandardMaterial({ color: new Color(0.86, 0.85, 0.82), roughness: 0.85 }),
    leather: new MeshStandardMaterial({ color: new Color(0.12, 0.045, 0.03), roughness: 0.62 }),
    chairWood: new MeshStandardMaterial({ map: mahoganyTexture(8), color: new Color(0.42, 0.33, 0.3), roughness: 0.6 }),
    shade: new MeshStandardMaterial({ color: new Color(0.25, 0.32, 0.22), roughness: 0.9, side: DoubleSide }),
    lamp: new MeshStandardMaterial({ color: new Color(1, 0.92, 0.75), emissive: new Color(1.0, 0.82, 0.55), emissiveIntensity: 0.0, roughness: 0.4 }),
    frosted: new MeshStandardMaterial({ color: new Color(0.7, 0.72, 0.72), roughness: 0.3, emissive: new Color(0.2, 0.22, 0.24), emissiveIntensity: 0.4 }),
    bellows: new MeshStandardMaterial({ color: new Color(0.035, 0.035, 0.035), roughness: 0.95 }),
    floorSteel: new MeshStandardMaterial({ color: new Color(0.12, 0.12, 0.12), roughness: 0.6, metalness: 0.5 }),
  };
  return _mats;
}

// ---------------------------------------------------------------------------------------------

const V = (x, y, z) => new Vector3(x, y, z);

/** A wall panel in a plane z = const, facing +z or -z. */
function wallZ(b, name, z, x0, x1, y0, y1, facePlus, uvFn = null) {
  const uv = uvFn ? uvFn(x0, x1, y0, y1) : [x0, y0, x1, y1];
  if (facePlus) b.quad(name, V(x0, y0, z), V(x1, y0, z), V(x1, y1, z), V(x0, y1, z), uv);
  else b.quad(name, V(x1, y0, z), V(x0, y0, z), V(x0, y1, z), V(x1, y1, z), [uv[2], uv[1], uv[0], uv[3]]);
}
/** A wall panel in a plane x = const, facing +x or -x. */
function wallX(b, name, x, z0, z1, y0, y1, facePlus) {
  if (facePlus) b.quad(name, V(x, y0, z1), V(x, y0, z0), V(x, y1, z0), V(x, y1, z1), [z1, y0, z0, y1]);
  else b.quad(name, V(x, y0, z0), V(x, y0, z1), V(x, y1, z1), V(x, y1, z0), [z0, y0, z1, y1]);
}

/** Panels of a wall from x0 to x1, y0 to y1, around rectangular openings [{x0,x1,y0,y1}]. */
function holedWall(b, name, z, x0, x1, y0, y1, holes, facePlus, uvFn) {
  const hs = holes.filter((h) => h.x1 > x0 && h.x0 < x1).sort((a, c) => a.x0 - c.x0);
  let x = x0;
  for (const h of hs) {
    if (h.x0 > x) wallZ(b, name, z, x, h.x0, y0, y1, facePlus, uvFn);
    if (h.y0 > y0) wallZ(b, name, z, h.x0, h.x1, y0, h.y0, facePlus, uvFn);
    if (h.y1 < y1) wallZ(b, name, z, h.x0, h.x1, h.y1, y1, facePlus, uvFn);
    x = h.x1;
  }
  if (x < x1) wallZ(b, name, z, x, x1, y0, y1, facePlus, uvFn);
}

/** The roof cross-section, right eaves over the top to left eaves (outer surface), [[z, y]]. */
function roofProfile(inset = 0) {
  const B = BODY, h = B.half - inset;
  const pts = [];
  // lower deck: a quarter-round from the eaves up to the clerestory base
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    pts.push([h - (h - 0.9) * (1 - Math.cos(t * Math.PI / 2)), B.eaves - inset * 0.5 + (B.clerBase - B.eaves) * Math.sin(t * Math.PI / 2)]);
  }
  // clerestory wall
  pts.push([0.9 - inset, B.clerTop - inset]);
  // upper deck: an arc
  for (let i = 1; i <= 6; i++) { const t = i / 7; pts.push([(0.95 - inset) * Math.cos(t * Math.PI), B.clerTop + (B.roofTop - B.clerTop) * Math.sin(t * Math.PI) - inset]); }
  pts.push([-(0.9 - inset), B.clerTop - inset]);
  for (let i = 5; i >= 0; i--) {
    const t = i / 5;
    pts.push([-(h - (h - 0.9) * (1 - Math.cos(t * Math.PI / 2))), B.eaves - inset * 0.5 + (B.clerBase - B.eaves) * Math.sin(t * Math.PI / 2)]);
  }
  return pts;
}

/** One car: { group, info } where info has the seats, doors, windows and lamps in car coordinates. */
export function buildCar(type, name) {
  const L = LAYOUTS[type]();
  const B = BODY, M = carMaterials();
  const b = new Builder();
  const h = B.half, t = B.wall, xe = B.bodyHalf;
  // ---- the openings
  const doorsX = doorsOf(L);
  const doorHoles = doorsX.map((x) => ({ x0: x - 0.38, x1: x + 0.38, y0: B.sill, y1: 3.02, door: true }));
  const sideHoles = (list) => [...list.map((w) => ({ x0: w.x - w.w / 2, x1: w.x + w.w / 2, y0: w.y0, y1: w.y1, frosted: !!w.frosted })), ...doorHoles];
  const holesR = sideHoles(L.right), holesL = sideHoles(L.left);
  const bodyX0 = L.openRear ? -(xe - 1.3) : -xe;
  // the side's uvs: u along the car in window pitches, v from the side sill to the eaves (rivet map)
  const uvSide = (x0, x1, y0, y1) => [x0 / 1.1, (y0 - B.sill) / (B.eaves - B.sill), x1 / 1.1, (y1 - B.sill) / (B.eaves - B.sill)];
  // ---- outer sides (paint), the letterboard band separately (gold lettering)
  for (const [z, holes, plus] of [[h, holesR, true], [-h, holesL, false]]) {
    holedWall(b, 'paint', z, bodyX0, xe, B.sill, 2.95, holes, plus, uvSide);
    wallZ(b, 'paint', z, bodyX0, -5.4, 2.95, B.eaves, plus, uvSide);
    wallZ(b, 'paint', z, 5.4, xe, 2.95, B.eaves, plus, uvSide);
    // "PULLMAN" on the letterboard, centred
    if (plus) b.quad('letter', V(-5.4, 2.95, z + 0.002), V(5.4, 2.95, z + 0.002), V(5.4, B.eaves, z + 0.002), V(-5.4, B.eaves, z + 0.002), [0, 0, 1, 1]);
    else b.quad('letter', V(5.4, 2.95, z - 0.002), V(-5.4, 2.95, z - 0.002), V(-5.4, B.eaves, z - 0.002), V(5.4, B.eaves, z - 0.002), [0, 0, 1, 1]);
    // inner faces of the sides (mahogany below the belt and between the windows, cream above)
    const zi = z - Math.sign(z) * t;
    holedWall(b, 'wood', zi, bodyX0 + 0.05, xe - 0.05, B.floor, B.winTop + 0.05, holes.map((q) => ({ ...q, y0: Math.max(q.y0, B.floor) })), !plus);
    wallZ(b, 'ceiling', zi, bodyX0 + 0.05, xe - 0.05, B.winTop + 0.05, B.eaves, !plus);
    // window and door reveals (the thickness of the wall)
    for (const q of holes) {
      const y0 = Math.max(q.y0, B.floor);
      const zo = z, zin = zi;
      const s = Math.sign(z);
      // sill and head
      b.quad('woodDark', V(q.x0, y0, plus ? zin : zo), V(q.x1, y0, plus ? zin : zo), V(q.x1, y0, plus ? zo : zin), V(q.x0, y0, plus ? zo : zin), [0, 0, 1, 1]);
      b.quad('woodDark', V(q.x0, q.y1, plus ? zo : zin), V(q.x1, q.y1, plus ? zo : zin), V(q.x1, q.y1, plus ? zin : zo), V(q.x0, q.y1, plus ? zin : zo), [0, 0, 1, 1]);
      // jambs
      for (const [xx, f] of [[q.x0, 1], [q.x1, -1]]) {
        const a = V(xx, y0, zo), c = V(xx, q.y1, zin);
        if ((f > 0) === (s > 0)) b.quad('woodDark', V(xx, y0, zin), V(xx, y0, zo), V(xx, q.y1, zo), c, [0, 0, 1, 1]);
        else b.quad('woodDark', a, V(xx, y0, zin), c, V(xx, q.y1, zo), [0, 0, 1, 1]);
      }
      if (q.frosted) {
        const zf = (zo + zin) / 2;
        wallZ(b, 'frosted', zf, q.x0, q.x1, q.y0, q.y1, plus);
        wallZ(b, 'frosted', zf - Math.sign(z) * 0.001, q.x0, q.x1, q.y0, q.y1, !plus);
      }
    }
  }
  // ---- roof (outer), ceiling (inner), with the deck lights' frames
  const prof = roofProfile(0);
  b.extrudeX('roof', prof, bodyX0, xe, { closed: false });
  const inner = roofProfile(0.07).reverse();
  b.extrudeX('ceiling', inner, bodyX0 + 0.05, xe - 0.05, { closed: false });
  // ---- end walls (with the end door) and the vestibule bulkheads
  const endWall = (x, facePlus, name) => {
    wallX(b, name, x, -h, -0.42, B.sill, B.eaves, facePlus);
    wallX(b, name, x, 0.42, h, B.sill, B.eaves, facePlus);
    wallX(b, name, x, -0.42, 0.42, 3.05, B.eaves, facePlus);
    // the roof's end cap above the eaves
    const pr = roofProfile(0);
    for (let i = 0; i + 1 < pr.length; i++) {
      const a = V(x, B.eaves, 0), p1 = V(x, pr[i][1], pr[i][0]), p2 = V(x, pr[i + 1][1], pr[i + 1][0]);
      if (facePlus) b.tri(name, a, p1, p2); else b.tri(name, a, p2, p1);
    }
  };
  endWall(xe, true, 'paint');
  endWall(xe - 0.06, false, 'woodDark');
  if (!L.openRear) { endWall(-xe, false, 'paint'); endWall(-xe + 0.06, true, 'woodDark'); }
  else {
    // the observation end: the body ends at the platform's bulkhead with a door and wide windows
    const xr = bodyX0;
    wallX(b, 'paint', xr, -h, -0.42, B.sill, B.belt, false); wallX(b, 'paint', xr, 0.42, h, B.sill, B.belt, false);
    wallX(b, 'paint', xr, -h, h, B.winTop, B.eaves, false);
    wallX(b, 'paint', xr, -h, -1.0, B.belt, B.winTop, false); wallX(b, 'paint', xr, 1.0, h, B.belt, B.winTop, false);
    wallX(b, 'paint', xr, -0.42, -0.36, B.belt, B.winTop, false); wallX(b, 'paint', xr, 0.36, 0.42, B.belt, B.winTop, false);
    const pr = roofProfile(0);
    for (let i = 0; i + 1 < pr.length; i++) b.tri('paint', V(xr, B.eaves, 0), V(xr, pr[i + 1][1], pr[i + 1][0]), V(xr, pr[i][1], pr[i][0]));
    // the open platform: floor, brass railing, an awning (the roof runs on over it)
    b.box('floorSteel', [-xe - 0.1, B.floor - 0.12, -h + 0.05], [xr, B.floor, h - 0.05]);
    for (const z of [-h + 0.1, h - 0.1]) b.cylinder('brass', V(-xe - 0.05, B.floor + 1.0, z), V(xr, B.floor + 1.0, z), 0.025, 0.025, { segs: 8 });
    b.cylinder('brass', V(-xe - 0.05, B.floor + 1.0, -h + 0.1), V(-xe - 0.05, B.floor + 1.0, h - 0.1), 0.025, 0.025, { segs: 8 });
    for (let k = 0; k <= 8; k++) { const z = -h + 0.1 + (2 * h - 0.2) * (k / 8); b.cylinder('brass', V(-xe - 0.05, B.floor, z), V(-xe - 0.05, B.floor + 1.0, z), 0.012, 0.012, { segs: 6 }); }
    for (const z of [-h + 0.1, h - 0.1]) for (let k = 0; k <= 2; k++) { const x = -xe - 0.05 + (xr + xe + 0.05) * (k / 2); b.cylinder('brass', V(x, B.floor, z), V(x, B.floor + 1.0, z), 0.012, 0.012, { segs: 6 }); }
    b.extrudeX('roof', roofProfile(0), -xe - 0.15, xr, { closed: false });
    b.extrudeX('ceiling', roofProfile(0.06).reverse(), -xe - 0.1, xr, { closed: false });
  }
  // the vestibule bulkheads (between vestibule and the rooms) are partitions in the layout
  // ---- floor (carpet in the rooms, steel in the vestibules)
  b.quad('carpet', V(bodyX0 + 0.05, B.floor, h - t), V(xe - B.vest, B.floor, h - t), V(xe - B.vest, B.floor, -h + t), V(bodyX0 + 0.05, B.floor, -h + t), [bodyX0, h, xe - B.vest, -h]);
  b.quad('floorSteel', V(xe - B.vest, B.floor, h - t), V(xe, B.floor, h - t), V(xe, B.floor, -h + t), V(xe - B.vest, B.floor, -h + t));
  // ---- partitions
  for (const p of L.partitions) {
    const z0 = Math.max(p.z0, -h + t), z1 = Math.min(p.z1, h - t);
    for (const face of [true, false]) {
      const x = p.x + (face ? 0.03 : -0.03);
      if (p.door) {
        if (p.door[0] > z0) wallX(b, 'wood', x, z0, p.door[0], B.floor, B.eaves + 0.1, face);
        if (p.door[1] < z1) wallX(b, 'wood', x, p.door[1], z1, B.floor, B.eaves + 0.1, face);
        wallX(b, 'wood', x, p.door[0], p.door[1], 3.02, B.eaves + 0.1, face);
      } else wallX(b, 'wood', x, z0, z1, B.floor, B.eaves + 0.1, face);
    }
  }
  for (const c of L.corridors) {
    // the corridor wall along z = c.z, with doors to the rooms
    const doors = (c.doors ?? []).map((x) => ({ x0: x - 0.32, x1: x + 0.32, y0: B.floor, y1: 3.0 }));
    holedWall(b, 'wood', c.z + 0.03, c.x0, c.x1, B.floor, B.eaves + 0.1, doors, true);
    holedWall(b, 'wood', c.z - 0.03, c.x0, c.x1, B.floor, B.eaves + 0.1, doors, false);
  }
  // ---- furniture
  const chairs = L.chairs.map((c) => ({ ...c }));
  for (const c of chairs) (type === 'diner' ? diningChair : armchair)(b, c);
  for (const s of L.sofas) sofa(b, s);
  for (const tb of L.tables) table(b, tb);
  // luggage racks: brass rods above the windows along both sides of the saloon
  for (const z of [h - 0.32, -h + 0.32]) {
    const x0 = Math.min(...chairs.map((c) => c.x), 0) - 0.4, x1 = Math.max(...chairs.map((c) => c.x), 0) + 0.4;
    if (chairs.length) for (const dz of [0, Math.sign(z) * -0.12, Math.sign(z) * -0.24]) b.cylinder('brass', V(x0, 3.0, z + dz), V(x1, 3.0, z + dz), 0.008, 0.008, { segs: 5, open: true });
  }
  // ceiling lamps (frosted globes on brass), along the clerestory
  for (const x of L.lamps) {
    b.cylinder('brass', V(x, 3.78, 0), V(x, 3.6, 0), 0.02, 0.02, { segs: 6 });
    b.lathe('lamp', V(x, 3.6, 0), V(0, -1, 0), [[0.03, 0], [0.12, 0.05], [0.14, 0.12], [0.1, 0.2], [0.0, 0.22]], { segs: 12 });
  }
  // window shades, half drawn on a few windows (the right side's last ones)
  // ---- underframe, trucks, buffers, steps, diaphragms
  b.box('under', [-xe, B.sill - 0.18, -h + 0.04], [xe, B.sill, h - 0.04]);
  for (const x of [-3.5, 0, 3.5]) b.box('under', [x - 0.8, 0.55, -0.7], [x + 0.8, B.sill - 0.18, 0.7]);     // battery boxes, reservoir, water tank
  b.cylinder('under', V(-6.5, 0.72, 0.6), V(-4.3, 0.72, 0.6), 0.22, 0.22, { segs: 12 });                    // air reservoir
  for (const sx of [1, -1]) {
    const x = sx * xe;
    // headstock with buffers and the screw coupling's hook
    b.box('under', [Math.min(x, x + sx * 0.08), 0.82, -1.35], [Math.max(x, x + sx * 0.08), 1.3, 1.35]);
    if (!(L.openRear && sx < 0)) for (const z of [-B.buffer.z, B.buffer.z]) {
      b.cylinder('under', V(x, B.buffer.y, z), V(x + sx * 0.42, B.buffer.y, z), 0.11, 0.09, { segs: 12 });
      b.cylinder('steel', V(x + sx * 0.42, B.buffer.y, z), V(x + sx * 0.62, B.buffer.y, z), 0.19, 0.19, { segs: 16 });
    }
    b.box('under', [Math.min(x, x + sx * 0.35), 0.98, -0.06], [Math.max(x, x + sx * 0.35), 1.12, 0.06]);
    // diaphragm (gangway bellows) at the closed ends
    if (!(L.openRear && sx < 0)) {
      const x2 = x + sx * 0.32;
      for (const [za, zb] of [[-0.62, -0.5], [0.5, 0.62]]) b.box('bellows', [Math.min(x, x2), B.floor - 0.05, za], [Math.max(x, x2), 3.25, zb]);
      b.box('bellows', [Math.min(x, x2), 3.1, -0.62], [Math.max(x, x2), 3.25, 0.62]);
      b.box('floorSteel', [Math.min(x, x2), B.floor - 0.06, -0.5], [Math.max(x, x2), B.floor, 0.5]);
    }
  }
  // steps at the vestibule doors
  for (const x of doorsX) for (const z of [h, -h]) {
    const s = Math.sign(z);
    b.box('under', [x - 0.38, 0.62, Math.min(z, z + s * 0.02)], [x + 0.38, B.sill, Math.max(z, z + s * 0.02)]);
    for (const [yy, dz] of [[0.62, 0.22], [0.86, 0.12]]) b.box('floorSteel', [x - 0.36, yy - 0.03, Math.min(z - s * 0.02, z + s * dz)], [x + 0.36, yy, Math.max(z - s * 0.02, z + s * dz)]);
    b.cylinder('brass', V(x - 0.42, 1.25, z + s * 0.06), V(x - 0.42, 2.6, z + s * 0.06), 0.014, 0.014, { segs: 6 });
    b.cylinder('brass', V(x + 0.42, 1.25, z + s * 0.06), V(x + 0.42, 2.6, z + s * 0.06), 0.014, 0.014, { segs: 6 });
  }
  const group = b.build(M);
  // the trucks (separate: they turn under the car)
  const trucks = [B.truck, -B.truck].map((x) => { const tr = truck(M); tr.position.x = x; group.add(tr); return tr; });
  // the car's name on its side, centred under the windows (both sides)
  const nameMat = new MeshPhysicalMaterial({ map: letteringTexture(name.toUpperCase(), { w: 1024, h: 128, size: 84, spacing: 0.12 }), roughness: 0.4, clearcoat: 0.55 });
  const nb = new Builder();
  nb.quad('name', V(-1.6, 1.42, h + 0.003), V(1.6, 1.42, h + 0.003), V(1.6, 1.82, h + 0.003), V(-1.6, 1.82, h + 0.003), [0, 0, 1, 1]);
  nb.quad('name', V(1.6, 1.42, -h - 0.003), V(-1.6, 1.42, -h - 0.003), V(-1.6, 1.82, -h - 0.003), V(1.6, 1.82, -h - 0.003), [0, 0, 1, 1]);
  group.add(...nb.build({ name: nameMat }).children);
  group.name = `car-${type}`;
  const info = {
    type, name, chairs, sofas: L.sofas, lamps: L.lamps,
    windows: { right: holesR.filter((q) => !q.door), left: holesL.filter((q) => !q.door) },
    doors: doorsX, trucks, length: 25.3, openRear: !!L.openRear,
  };
  return { group, info };
}

/** A revolving parlor armchair on its brass pedestal (seat 0.46 m, back 1.08 m). */
/**
 * The parlor car's revolving armchair (facing +x of the chair): overstuffed in green plush, with
 * rolled arms and a loose seat cushion, the back a little reclined with a linen cloth where the
 * head rests, on a cast brass pedestal and swivel.
 */
function armchair(b, c) {
  const m = new Matrix4().makeRotationY(c.yaw ?? 0).setPosition(c.x, BODY.floor, c.z);
  b.transform(m);
  b.lathe('brass', V(0, 0, 0), V(0, 1, 0), [[0, 0], [0.235, 0], [0.235, 0.012], [0.2, 0.03], [0.09, 0.06], [0.05, 0.09], [0.045, 0.22], [0.11, 0.25], [0.11, 0.27], [0, 0.27]], { segs: 20 });
  b.soft('plush', [-0.31, 0.26, -0.3], [0.27, 0.4, 0.3], 0.04, { k: 1 });
  b.soft('plush', [-0.27, 0.37, -0.25], [0.28, 0.47, 0.25], 0.045);
  for (const s of [-1, 1]) b.soft('plush', [-0.33, 0.36, s > 0 ? 0.24 : -0.335], [0.27, 0.66, s > 0 ? 0.335 : -0.24], 0.045);
  // the back, reclined 5 degrees about its foot
  b.transform(m.clone().multiply(new Matrix4().makeTranslation(-0.28, 0.38, 0)).multiply(new Matrix4().makeRotationZ(0.09)).multiply(new Matrix4().makeTranslation(0.28, -0.38, 0)));
  b.soft('plush', [-0.38, 0.36, -0.315], [-0.215, 1.08, 0.315], 0.07);
  b.soft('linen', [-0.392, 0.85, -0.19], [-0.203, 1.092, 0.19], 0.08);     // draped over the head of the back, front and rear
  b.transform(null);
}

/** The diner's chair (facing +x): a mahogany frame, the seat and back upholstered in leather. */
function diningChair(b, c) {
  const m = new Matrix4().makeRotationY(c.yaw ?? 0).setPosition(c.x, BODY.floor, c.z);
  b.transform(m);
  for (const x of [-0.2, 0.2]) for (const z of [-0.2, 0.2]) b.box('chairWood', [x - 0.02, 0, z - 0.02], [x + 0.02, 0.42, z + 0.02]);
  for (const z of [-0.2, 0.2]) b.box('chairWood', [-0.24, 0.42, z - 0.02], [-0.2, 0.98, z + 0.02]);     // the back legs run up as the back's stiles
  b.box('chairWood', [-0.24, 0.92, -0.22], [-0.2, 0.98, 0.22]);                                      // the top rail
  b.box('chairWood', [-0.22, 0.36, -0.22], [0.22, 0.42, 0.22]);                                      // the seat frame
  b.soft('leather', [-0.21, 0.4, -0.21], [0.23, 0.47, 0.21], 0.03);
  b.soft('leather', [-0.225, 0.52, -0.18], [-0.19, 0.9, 0.18], 0.02, { k: 1 });
  b.transform(null);
}

/** A sofa (the drawing room's, the lounge's) or a made-up berth, facing +x. */
function sofa(b, s) {
  const m = new Matrix4().makeRotationY(s.yaw ?? 0).setPosition(s.x, BODY.floor, s.z);
  b.transform(m);
  const w = (s.w ?? 1.5) / 2;
  b.soft('plush', [-0.32, 0.0, -w], [0.32, 0.4, w], 0.035, { k: 1 });
  b.soft('plush', [-0.3, 0.36, -w + 0.04], [0.33, 0.46, w - 0.04], 0.04);
  b.soft('plush', [-0.42, 0.3, -w], [-0.24, 1.0, w], 0.06);
  if (s.berth) b.soft('linen', [-0.28, 0.45, -w + 0.06], [0.31, 0.5, w - 0.06], 0.02, { k: 1 });
  b.transform(null);
}

function table(b, t) {
  b.transform(new Matrix4().setPosition(t.x, BODY.floor, t.z));
  b.cylinder('woodDark', V(0, 0, 0), V(0, 0.72, 0), 0.04, 0.04, { segs: 8 });
  b.box('linen', [-t.w / 2, 0.72, -t.d / 2], [t.w / 2, 0.76, t.d / 2]);
  b.box('linen', [-t.w / 2 - 0.01, 0.55, -t.d / 2 - 0.01], [t.w / 2 + 0.01, 0.76, -t.d / 2]);
  b.box('linen', [-t.w / 2 - 0.01, 0.55, t.d / 2], [t.w / 2 + 0.01, 0.76, t.d / 2 + 0.01]);
  b.transform(null);
}

/** A three-axle truck (cast steel side frames, equalizers, 36-inch wheels). Wheelsets are children (spin). */
export function truck(M) {
  const b = new Builder();
  const A = BODY.axle, R = BODY.wheelR;
  for (const z of [-1.0, 1.0]) {
    b.box('under', [-A - 0.6, R - 0.12, z - 0.07], [A + 0.6, R + 0.18, z + 0.07]);          // side frame
    for (const x of [-A, 0, A]) b.box('under', [x - 0.16, R - 0.14, z - 0.11], [x + 0.16, R + 0.14, z + 0.11]);   // journal boxes
    for (const x of [-A / 2, A / 2]) b.cylinder('steel', V(x, R + 0.2, z), V(x, R + 0.42, z), 0.09, 0.09, { segs: 10 });   // springs
  }
  b.box('under', [-0.45, R + 0.2, -1.1], [0.45, R + 0.45, 1.1]);                             // bolster
  b.box('under', [-A - 0.4, R - 0.02, -0.95], [-A + 0.4, R + 0.1, 0.95]);
  b.box('under', [A - 0.4, R - 0.02, -0.95], [A + 0.4, R + 0.1, 0.95]);
  const g = b.build(M);
  g.userData.wheelsets = [];
  for (const x of [-A, 0, A]) {
    const ws = wheelset(M);
    ws.position.set(x, R, 0);
    g.add(ws);
    g.userData.wheelsets.push(ws);
  }
  return g;
}

let _wheelset = null;
function wheelset(M) {
  if (!_wheelset) {
    const b = new Builder(), R = BODY.wheelR;
    for (const z of [-0.7175, 0.7175]) {
      const s = Math.sign(z);
      b.cylinder('wheel', V(0, 0, z - s * 0.07), V(0, 0, z + s * 0.065), R, R, { segs: 20 });
      b.cylinder('tread', V(0, 0, z - s * 0.072), V(0, 0, z - s * 0.04), R + 0.025, R + 0.025, { segs: 20 });    // flange
      b.cylinder('steel', V(0, 0, z + s * 0.065), V(0, 0, z + s * 0.09), 0.09, 0.09, { segs: 10 });
    }
    b.cylinder('under', V(0, 0, -0.65), V(0, 0, 0.65), 0.075, 0.075, { segs: 10 });
    _wheelset = b.build(M);
  }
  return _wheelset.clone();
}
